//! Copies of the database: albireo backup writes one to the bucket, and albireo restore loads it
//! into an empty database, which then holds the same library.

mod common;

use albireo::backup::{self, BackupError, TABLES};
use albireo::time::now;
use async_compression::tokio::bufread::GzipDecoder;
use async_compression::tokio::write::GzipEncoder;
use axum::http::{Method, StatusCode};
use common::TestApp;
use serde_json::json;
use sqlx::{AssertSqlSafe, PgPool};
use tokio::io::{AsyncReadExt, AsyncWriteExt, BufReader};

/// A fingerprint of each table: the hash of its rows as text, in order.
async fn fingerprints(db: &PgPool) -> Vec<(String, String)> {
    let mut result = Vec::new();
    for table in TABLES {
        let sum: Option<String> = sqlx::query_scalar(AssertSqlSafe(format!(
            "SELECT md5(string_agg(t::text, '|' ORDER BY t::text)) FROM public.{table} t"
        )))
        .fetch_one(db)
        .await
        .unwrap();
        result.push((table.to_string(), sum.unwrap_or_default()));
    }
    result
}

async fn empty_the_database(db: &PgPool) {
    sqlx::query(AssertSqlSafe(format!("TRUNCATE {}", TABLES.join(", "))))
        .execute(db)
        .await
        .unwrap();
}

async fn gunzip(bytes: &[u8]) -> String {
    let mut text = String::new();
    GzipDecoder::new(BufReader::new(bytes)).read_to_string(&mut text).await.unwrap();
    text
}

async fn gzip(text: &str) -> Vec<u8> {
    let mut encoder = GzipEncoder::new(Vec::new());
    encoder.write_all(text.as_bytes()).await.unwrap();
    encoder.shutdown().await.unwrap();
    encoder.into_inner()
}

fn refusal(result: Result<backup::RestoreSummary, BackupError>) -> String {
    match result {
        Err(BackupError::Refused(message)) => message,
        other => panic!("the restore was not refused: {other:?}"),
    }
}

/// A small library with a row in each table but the setup codes.
async fn fill_library(app: &TestApp) {
    let admin = app.admin().await;
    let member = app.invite(&admin, "sam@example.com", "Sam", false).await;
    let series = app
        .post("/api/series", json!({ "title": "Onboarding", "description": "Week one" }), &member)
        .await
        .json();
    let series_id = series["series"]["id"].as_str().unwrap().to_string();
    let video = app.upload(&member, "Welcome\twith a tab", b"0123456789", Some(&series_id)).await;
    let id = video["id"].as_str().unwrap().to_string();
    app.patch(
        &format!("/api/videos/{id}"),
        json!({ "description": "Line one\nLine two \\ with a backslash" }),
        &member,
    )
    .await;
    app.post(
        &format!("/api/videos/{id}/comments"),
        json!({ "body": "At 0:02, the plan." }),
        &admin,
    )
    .await;
    app.post(&format!("/api/videos/{id}/comments"), json!({ "body": "Thanks!" }), &member)
        .await;
    app.put(&format!("/api/videos/{id}/rating"), json!({ "stars": 4 }), &admin).await;
    let attachment = app
        .post(
            &format!("/api/videos/{id}/attachments"),
            json!({ "fileName": "notes.md", "fileSize": 4 }),
            &member,
        )
        .await
        .json();
    app.put_file(attachment["url"].as_str().unwrap(), b"# Hi".to_vec(), "text/markdown", &member)
        .await;
    app.post(
        &format!("/api/attachments/{}/commit", attachment["attachmentId"].as_str().unwrap()),
        json!({}),
        &member,
    )
    .await;
    let playlist = app
        .post("/api/playlists", json!({ "title": "Later", "description": "" }), &admin)
        .await
        .json();
    app.post(
        &format!("/api/playlists/{}/videos", playlist["playlist"]["id"].as_str().unwrap()),
        json!({ "videoId": id }),
        &admin,
    )
    .await;
    app.post(&format!("/api/videos/{id}/watched"), json!({}), &admin).await;
    app.post("/api/invitations", json!({ "isAdmin": true }), &admin).await;
}

#[sqlx::test(migrations = "../migrations")]
async fn restores_a_copy_into_an_empty_database(db: PgPool) {
    let app = TestApp::new(db.clone());
    fill_library(&app).await;
    let before = fingerprints(&db).await;
    for (table, sum) in &before {
        assert!(table == "setup_codes" || !sum.is_empty(), "the library has no rows in {table}");
    }

    let copy = backup::write_copy(&db, &app.store, now()).await.unwrap();
    assert!(backup::is_copy_key(&copy.key), "{}", copy.key);
    let object = app.store.object(&copy.key).unwrap();
    assert_eq!(object.content_type, "application/gzip");
    assert_eq!(object.bytes.len() as u64, copy.bytes);
    // The copy is SQL that psql reads too.
    let text = gunzip(&object.bytes).await;
    assert!(text.starts_with("-- A copy of the database of albireo."), "{text}");
    assert!(text.contains("\n-- albireo-copy: {\"format\":1,"), "{text}");
    assert!(text.contains("\nCOPY public.users (id, email, "), "{text}");
    assert!(text.contains("Line one\\nLine two \\\\ with a backslash"), "{text}");

    empty_the_database(&db).await;
    let restored = backup::restore_copy(&db, &app.store, &copy.key).await.unwrap();
    assert_eq!(restored.tables, TABLES.len());
    assert_eq!(restored.rows, copy.rows);
    // The same rows, with the numbers of comments and attachments that the videos keep.
    assert_eq!(fingerprints(&db).await, before);

    let signed_in = app
        .call(
            Method::POST,
            "/api/sign-in",
            Some(json!({ "email": "sam@example.com", "password": "a long password" })),
            None,
        )
        .await;
    assert_eq!(signed_in.status, StatusCode::OK);
    let sam = common::Person {
        id: signed_in.json()["me"]["id"].as_str().unwrap().into(),
        token: signed_in.session(),
    };
    let videos = app.get("/api/videos", &sam).await.json();
    assert_eq!(videos["videos"][0]["commentCount"], 2);
    assert_eq!(videos["videos"][0]["attachmentCount"], 1);
}

#[sqlx::test(migrations = "../migrations")]
async fn refuses_to_restore_into_a_database_with_a_library(db: PgPool) {
    let app = TestApp::new(db.clone());
    app.admin().await;
    let copy = backup::write_copy(&db, &app.store, now()).await.unwrap();
    let message = refusal(backup::restore_copy(&db, &app.store, &copy.key).await);
    assert!(message.starts_with("Please restore into an empty database"), "{message}");
}

#[sqlx::test(migrations = "../migrations")]
async fn refuses_copies_that_this_albireo_cannot_load(db: PgPool) {
    let app = TestApp::new(db.clone());
    fill_library(&app).await;
    let copy = backup::write_copy(&db, &app.store, now()).await.unwrap();
    let text = gunzip(&app.store.object(&copy.key).unwrap().bytes).await;
    empty_the_database(&db).await;

    let message = refusal(backup::restore_copy(&db, &app.store, "videos/abcdefghij012345/original.mp4").await);
    assert!(message.starts_with("Please name a copy under backups/"), "{message}");
    let message = refusal(backup::restore_copy(&db, &app.store, "backups/albireo-20200101T000000Z.sql.gz").await);
    assert!(message.starts_with("Please name a copy that is in the bucket"), "{message}");

    // A copy of a database with another migration, as from another version of albireo.
    let other = text.replacen("\"migrations\":[1]", "\"migrations\":[1,2]", 1);
    app.store.put("backups/other-version.sql.gz", &gzip(&other).await);
    let message = refusal(backup::restore_copy(&db, &app.store, "backups/other-version.sql.gz").await);
    assert!(message.starts_with("Please restore this copy with albireo"), "{message}");

    // A copy that stops in the middle of the rows of a table.
    let cut = &text[..text.find("COPY public.comments").unwrap() + 120];
    app.store.put("backups/cut.sql.gz", &gzip(cut).await);
    let message = refusal(backup::restore_copy(&db, &app.store, "backups/cut.sql.gz").await);
    assert!(message.starts_with("Please restore a whole copy"), "{message}");

    // A file that is no copy of albireo.
    app.store.put("backups/notes.sql.gz", &gzip("DROP TABLE users;\n").await);
    let message = refusal(backup::restore_copy(&db, &app.store, "backups/notes.sql.gz").await);
    assert!(message.starts_with("Please name a copy that albireo backup wrote"), "{message}");

    // Nothing of the refused copies stayed, so the whole copy still goes in.
    assert_eq!(fingerprints(&db).await.iter().filter(|(_, sum)| !sum.is_empty()).count(), 0);
    backup::restore_copy(&db, &app.store, &copy.key).await.unwrap();
}

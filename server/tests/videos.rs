//! Videos through the API: uploads, lists, edits, deletion, thumbnails, attachments, comments,
//! ratings, search, history, recommendations, and the files of the library.

mod common;

use albireo::repo::videos::{MediaInfo, NewUpload, insert_uploading, mark_ready};
use axum::body::Body;
use axum::http::{Method, Request, StatusCode, header};
use chrono::TimeDelta;
use common::{Person, TestApp};
use serde_json::{Value, json};
use sqlx::PgPool;

fn id_of(value: &Value) -> String {
    value["id"].as_str().unwrap().to_string()
}

/// Puts ready videos in the database without files, from the oldest, a minute apart.
async fn add_videos(app: &TestApp, uploader: &Person, titles: &[String]) -> Vec<String> {
    let start = albireo::time::now() - TimeDelta::days(1);
    let mut ids = Vec::new();
    for (index, title) in titles.iter().enumerate() {
        let id = albireo::ids::random_id();
        let key = format!("videos/{id}/original.mp4");
        let video = NewUpload {
            id: &id,
            title,
            object_key: &key,
            upload_id: "upload",
            content_type: "video/mp4",
            file_size: 10,
            part_size: 16 * 1024 * 1024,
            part_count: 1,
            created_at: start + TimeDelta::minutes(index as i64),
            uploader_id: &uploader.id,
            series_id: None,
        };
        insert_uploading(&app.db, &video).await.unwrap();
        let media = MediaInfo {
            duration_sec: Some(8.0),
            width: Some(1280),
            height: Some(720),
        };
        assert!(
            mark_ready(&app.db, &id, &media, start + TimeDelta::minutes(index as i64))
                .await
                .unwrap()
        );
        ids.push(id);
    }
    ids
}

async fn rate(app: &TestApp, id: &str, stars: Value, person: &Person) -> common::Answer {
    app.put(&format!("/api/videos/{id}/rating"), json!({ "stars": stars }), person)
        .await
}

async fn search(app: &TestApp, query: &str, person: &Person) -> common::Answer {
    app.get(&format!("/api/search?q={query}"), person).await
}

fn ids_in(answer: &Value, field: &str) -> Vec<String> {
    answer[field].as_array().unwrap().iter().map(id_of).collect()
}

#[sqlx::test(migrations = "../migrations")]
async fn uploads_a_video_in_parts_through_albireo(db: PgPool) {
    let app = TestApp::new(db);
    let admin = app.admin().await;
    let member = app.invite(&admin, "sam@example.com", "Sam", false).await;

    let start = |content_type: &str, size: u64| json!({ "title": "Weekly sync", "fileName": "clip.MP4", "fileSize": size, "contentType": content_type });
    assert_eq!(
        app.post("/api/uploads", start("application/pdf", 10), &member).await.status,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        app.post("/api/uploads", start("video/mp4", 0), &member).await.status,
        StatusCode::BAD_REQUEST
    );

    // Two parts of 16 MiB and a last part of 5 bytes.
    let bytes: Vec<u8> = (0..(32 * 1024 * 1024 + 5)).map(|index: u32| (index % 251) as u8).collect();
    let created = app.post("/api/uploads", start("video/mp4", bytes.len() as u64), &member).await;
    assert_eq!(created.status, StatusCode::CREATED, "{:?}", created.json());
    let created = created.json();
    let id = created["videoId"].as_str().unwrap().to_string();
    assert_eq!(created["partSize"], 16 * 1024 * 1024);
    assert_eq!(created["partCount"], 3);
    assert_eq!(app.get(&format!("/api/videos/{id}"), &member).await.status, StatusCode::NOT_FOUND);

    let urls = app
        .post(&format!("/api/uploads/{id}/parts"), json!({ "partNumbers": [1, 2, 3] }), &member)
        .await
        .json();
    let urls: Vec<String> = urls["parts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|part| part["url"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(urls[2], format!("/api/uploads/{id}/parts/3"));
    assert_eq!(
        app.post(&format!("/api/uploads/{id}/parts"), json!({ "partNumbers": [4] }), &member)
            .await
            .status,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        app.post(&format!("/api/uploads/{id}/parts"), json!({ "partNumbers": [1] }), &admin)
            .await
            .status,
        StatusCode::OK
    );
    let stranger = app.invite(&admin, "kim@example.com", "Kim", false).await;
    assert_eq!(
        app.post(&format!("/api/uploads/{id}/parts"), json!({ "partNumbers": [1] }), &stranger)
            .await
            .status,
        StatusCode::FORBIDDEN
    );

    let part_size = 16 * 1024 * 1024;
    // Each part must have its size: a short first part, and no part 0 or 4.
    assert_eq!(
        app.put_file(&urls[0], bytes[..10].to_vec(), "application/octet-stream", &member)
            .await
            .status,
        StatusCode::BAD_REQUEST
    );
    for path in [
        format!("/api/uploads/{id}/parts/0"),
        format!("/api/uploads/{id}/parts/4"),
        format!("/api/uploads/{id}/parts/01"),
    ] {
        assert_eq!(
            app.put_file(&path, bytes[..5].to_vec(), "application/octet-stream", &member)
                .await
                .status,
            StatusCode::NOT_FOUND,
            "{path}"
        );
    }
    let mut parts = Vec::new();
    for (index, url) in urls.iter().enumerate() {
        let end = ((index + 1) * part_size).min(bytes.len());
        let sent = app
            .put_file(url, bytes[index * part_size..end].to_vec(), "application/octet-stream", &member)
            .await;
        assert_eq!(sent.status, StatusCode::NO_CONTENT, "part {}", index + 1);
        parts.push(json!({ "partNumber": index + 1, "etag": sent.headers[header::ETAG].to_str().unwrap() }));
    }

    let complete = |parts: Vec<Value>| json!({ "parts": parts, "durationSec": 8.5, "width": 1280, "height": 720 });
    let missing = app
        .post(&format!("/api/uploads/{id}/complete"), complete(parts[..2].to_vec()), &member)
        .await;
    assert_eq!(missing.status, StatusCode::BAD_REQUEST);
    let twice = vec![parts[0].clone(), parts[0].clone(), parts[2].clone()];
    assert_eq!(
        app.post(&format!("/api/uploads/{id}/complete"), complete(twice), &member)
            .await
            .status,
        StatusCode::BAD_REQUEST
    );
    let completed = app.post(&format!("/api/uploads/{id}/complete"), complete(parts), &member).await;
    assert_eq!(completed.status, StatusCode::OK, "{:?}", completed.json());
    let video = &completed.json()["video"];
    assert_eq!(video["fileSize"], bytes.len());
    assert_eq!(video["durationSec"], 8.5);
    assert_eq!(video["playbackUrl"], format!("/api/files/videos/{id}/original.mp4"));
    assert_eq!(video["uploader"]["displayName"], "Sam");
    assert_eq!(video["canEdit"], true);
    assert_eq!(app.store.object(&format!("videos/{id}/original.mp4")).unwrap().bytes, bytes);
    assert_eq!(
        app.get(&format!("/api/videos/{id}"), &stranger).await.json()["video"]["canEdit"],
        false
    );
    assert_eq!(app.get(&format!("/api/videos/{id}"), &admin).await.json()["video"]["canEdit"], true);
}

#[sqlx::test(migrations = "../migrations")]
async fn cancels_an_upload(db: PgPool) {
    let app = TestApp::new(db);
    let admin = app.admin().await;
    let body = json!({ "title": "Weekly sync", "fileName": "clip.mp4", "fileSize": 10, "contentType": "video/mp4" });
    let id = app.post("/api/uploads", body, &admin).await.json()["videoId"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(
        app.post(&format!("/api/uploads/{id}/abort"), json!({}), &admin).await.status,
        StatusCode::NO_CONTENT
    );
    assert!(app.store.bucket.lock().unwrap().uploads.is_empty());
    assert_eq!(
        app.post(&format!("/api/uploads/{id}/parts"), json!({ "partNumbers": [1] }), &admin)
            .await
            .status,
        StatusCode::NOT_FOUND
    );
}

#[sqlx::test(migrations = "../migrations")]
async fn lists_videos_a_page_at_a_time(db: PgPool) {
    let app = TestApp::new(db);
    let admin = app.admin().await;
    let member = app.invite(&admin, "sam@example.com", "Sam", false).await;
    let titles: Vec<String> = (1..=50).map(|number| format!("Video {number}")).collect();
    let ids = add_videos(&app, &admin, &titles).await;
    let own = vec![id_of(&app.upload(&member, "Sam's video", b"0123456789", None).await)];

    let first = app.get("/api/videos", &member).await.json();
    let first_ids = ids_in(&first, "videos");
    assert_eq!(first_ids.len(), 48);
    assert_eq!(first_ids[0], own[0]);
    assert_eq!(first_ids[1], ids[49]);
    let cursor = first["nextCursor"].as_str().unwrap();
    let second = app.get(&format!("/api/videos?cursor={cursor}"), &member).await.json();
    assert_eq!(ids_in(&second, "videos"), vec![ids[2].clone(), ids[1].clone(), ids[0].clone()]);
    assert_eq!(second["nextCursor"], Value::Null);

    let oldest = app.get("/api/videos?sort=oldest", &member).await.json();
    assert_eq!(ids_in(&oldest, "videos")[0], ids[0]);
    let by_member = app.get(&format!("/api/videos?uploader={}", member.id), &admin).await.json();
    assert_eq!(ids_in(&by_member, "videos"), own);

    let oldest_of_one = format!("uploader={}&sort=oldest", member.id);
    for query in ["sort=bogus", "cursor=bogus", oldest_of_one.as_str(), "uploader=nobody!"] {
        assert_eq!(
            app.get(&format!("/api/videos?{query}"), &member).await.status,
            StatusCode::BAD_REQUEST,
            "{query}"
        );
    }
    let random = app.get("/api/videos/random", &member).await.json();
    assert_eq!(random["videos"].as_array().unwrap().len(), 48);
}

#[sqlx::test(migrations = "../migrations")]
async fn lets_the_uploader_and_admins_edit_a_video(db: PgPool) {
    let app = TestApp::new(db);
    let admin = app.admin().await;
    let uploader = app.invite(&admin, "sam@example.com", "Sam", false).await;
    let other = app.invite(&admin, "kim@example.com", "Kim", false).await;
    let id = id_of(&app.upload(&uploader, "Weekly sync", b"0123456789", None).await);
    let path = format!("/api/videos/{id}");

    assert_eq!(
        app.patch(&path, json!({ "title": "Renamed" }), &other).await.status,
        StatusCode::FORBIDDEN
    );
    assert_eq!(app.patch(&path, json!({}), &uploader).await.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        app.patch(&path, json!({ "title": "  " }), &uploader).await.status,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        app.patch(&path, json!({ "seriesId": "0123456789abcdef" }), &uploader).await.status,
        StatusCode::BAD_REQUEST
    );
    let edited = app
        .patch(&path, json!({ "title": "Weekly sync 2026", "description": "Notes" }), &uploader)
        .await;
    assert_eq!(edited.status, StatusCode::OK);
    assert_eq!(edited.json()["video"]["title"], "Weekly sync 2026");
    assert_eq!(edited.json()["video"]["description"], "Notes");
    let by_admin = app.patch(&path, json!({ "description": "Notes of an admin" }), &admin).await;
    assert_eq!(by_admin.json()["video"]["title"], "Weekly sync 2026");
    assert_eq!(by_admin.json()["video"]["description"], "Notes of an admin");
}

#[sqlx::test(migrations = "../migrations")]
async fn deletes_a_video_with_its_files(db: PgPool) {
    let app = TestApp::new(db);
    let admin = app.admin().await;
    let uploader = app.invite(&admin, "sam@example.com", "Sam", false).await;
    let other = app.invite(&admin, "kim@example.com", "Kim", false).await;
    let id = id_of(&app.upload(&uploader, "Weekly sync", b"0123456789", None).await);
    let thumbnail = app.post(&format!("/api/videos/{id}/thumbnail"), json!({}), &uploader).await.json();
    app.put_file(thumbnail["url"].as_str().unwrap(), vec![0xff, 0xd8], "image/jpeg", &uploader)
        .await;
    let attachment = app
        .post(
            &format!("/api/videos/{id}/attachments"),
            json!({ "fileName": "notes.md", "fileSize": 4 }),
            &uploader,
        )
        .await
        .json();
    app.put_file(attachment["url"].as_str().unwrap(), b"# Hi".to_vec(), "text/markdown", &uploader)
        .await;

    assert_eq!(app.delete(&format!("/api/videos/{id}"), &other).await.status, StatusCode::FORBIDDEN);
    assert_eq!(
        app.delete(&format!("/api/videos/{id}"), &uploader).await.status,
        StatusCode::NO_CONTENT
    );
    assert_eq!(app.get(&format!("/api/videos/{id}"), &uploader).await.status, StatusCode::NOT_FOUND);
    let attachment_id = attachment["attachmentId"].as_str().unwrap();
    for key in [
        format!("videos/{id}/original.mp4"),
        format!("thumbnails/{id}.jpg"),
        format!("attachments/{id}/{attachment_id}"),
    ] {
        assert!(app.store.object(&key).is_none(), "{key}");
    }
}

#[sqlx::test(migrations = "../migrations")]
async fn changes_the_thumbnail(db: PgPool) {
    let app = TestApp::new(db);
    let admin = app.admin().await;
    let other = app.invite(&admin, "kim@example.com", "Kim", false).await;
    let id = id_of(&app.upload(&admin, "Weekly sync", b"0123456789", None).await);

    assert_eq!(
        app.post(&format!("/api/videos/{id}/thumbnail"), json!({}), &other).await.status,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        app.post(&format!("/api/videos/{id}/thumbnail/commit"), json!({}), &admin)
            .await
            .status,
        StatusCode::CONFLICT
    );
    let upload = app.post(&format!("/api/videos/{id}/thumbnail"), json!({}), &admin).await.json();
    assert_eq!(upload["contentType"], "image/jpeg");
    let url = upload["url"].as_str().unwrap();
    assert_eq!(
        app.put_file(url, vec![0xff, 0xd8], "image/jpeg", &other).await.status,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        app.put_file(url, vec![0xff, 0xd8], "image/jpeg", &admin).await.status,
        StatusCode::NO_CONTENT
    );
    let committed = app
        .post(&format!("/api/videos/{id}/thumbnail/commit"), json!({}), &admin)
        .await
        .json();
    let thumbnail_url = committed["video"]["thumbnailUrl"].as_str().unwrap();
    assert!(
        thumbnail_url.starts_with(&format!("/api/files/thumbnails/{id}.jpg?v=")),
        "{thumbnail_url}"
    );
    let list = app.get("/api/videos", &other).await.json();
    assert_eq!(list["videos"][0]["thumbnailUrl"], thumbnail_url);
}

#[sqlx::test(migrations = "../migrations")]
async fn attaches_files_to_a_video(db: PgPool) {
    let app = TestApp::new(db);
    let admin = app.admin().await;
    let other = app.invite(&admin, "kim@example.com", "Kim", false).await;
    let id = id_of(&app.upload(&admin, "Weekly sync", b"0123456789", None).await);
    let path = format!("/api/videos/{id}/attachments");

    assert_eq!(
        app.post(&path, json!({ "fileName": "notes.md", "fileSize": 12 }), &other)
            .await
            .status,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        app.post(&path, json!({ "fileName": "big.zip", "fileSize": 600 * 1024 * 1024 }), &admin)
            .await
            .status,
        StatusCode::BAD_REQUEST
    );
    let started = app
        .post(&path, json!({ "fileName": "会議 notes.md", "fileSize": 12 }), &admin)
        .await;
    assert_eq!(started.status, StatusCode::CREATED, "{:?}", started.json());
    let started = started.json();
    assert_eq!(started["contentType"], "text/markdown; charset=utf-8");
    let attachment_id = started["attachmentId"].as_str().unwrap().to_string();
    let url = started["url"].as_str().unwrap();
    assert_eq!(
        app.put_file(url, b"# Notes".to_vec(), "text/markdown", &admin).await.status,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        app.put_file(url, b"# Notes here".to_vec(), "text/markdown", &admin).await.status,
        StatusCode::NO_CONTENT
    );
    let committed = app
        .post(&format!("/api/attachments/{attachment_id}/commit"), json!({}), &admin)
        .await;
    assert_eq!(committed.status, StatusCode::OK, "{:?}", committed.json());
    let attachment = &committed.json()["attachment"];
    assert_eq!(attachment["fileName"], "会議 notes.md");
    assert_eq!(attachment["viewUrl"], format!("/api/files/attachments/{id}/{attachment_id}"));
    assert_eq!(
        attachment["downloadUrl"],
        format!("/api/files/attachments/{id}/{attachment_id}?download")
    );
    assert_eq!(
        app.post(&format!("/api/attachments/{attachment_id}/commit"), json!({}), &admin)
            .await
            .status,
        StatusCode::CONFLICT
    );

    let detail = app.get(&format!("/api/videos/{id}"), &other).await.json();
    assert_eq!(detail["video"]["attachments"].as_array().unwrap().len(), 1);
    assert_eq!(app.get("/api/videos", &other).await.json()["videos"][0]["attachmentCount"], 1);
    let download = app
        .get(&format!("/api/files/attachments/{id}/{attachment_id}?download"), &other)
        .await;
    assert_eq!(download.status, StatusCode::OK);
    assert_eq!(download.bytes, b"# Notes here");
    assert_eq!(
        download.headers[header::CONTENT_DISPOSITION],
        "attachment; filename=\"__ notes.md\"; filename*=UTF-8''%E4%BC%9A%E8%AD%B0%20notes.md"
    );

    assert_eq!(
        app.delete(&format!("/api/attachments/{attachment_id}"), &other).await.status,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        app.delete(&format!("/api/attachments/{attachment_id}"), &admin).await.status,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        app.get(&format!("/api/videos/{id}"), &other).await.json()["video"]["attachments"],
        json!([])
    );
    assert!(app.store.object(&format!("attachments/{id}/{attachment_id}")).is_none());
}

#[sqlx::test(migrations = "../migrations")]
async fn lets_authors_uploaders_and_admins_delete_comments(db: PgPool) {
    let app = TestApp::new(db);
    let admin = app.admin().await;
    let uploader = app.invite(&admin, "sam@example.com", "Sam", false).await;
    let author = app.invite(&admin, "kim@example.com", "Kim", false).await;
    let other = app.invite(&admin, "lee@example.com", "Lee", false).await;
    let id = id_of(&app.upload(&uploader, "Weekly sync", b"0123456789", None).await);
    let path = format!("/api/videos/{id}/comments");

    assert_eq!(
        app.post(&path, json!({ "body": "   " }), &author).await.status,
        StatusCode::BAD_REQUEST
    );
    let mut comment_ids = Vec::new();
    for text in ["First at 0:05", "Second", "Third"] {
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        let posted = app.post(&path, json!({ "body": text }), &author).await;
        assert_eq!(posted.status, StatusCode::CREATED);
        assert_eq!(posted.json()["comment"]["canDelete"], true);
        comment_ids.push(id_of(&posted.json()["comment"]));
    }
    let listed = app.get(&path, &other).await.json();
    assert_eq!(listed["comments"][0]["body"], "Third");
    assert_eq!(listed["comments"][0]["canDelete"], false);
    assert_eq!(listed["comments"][0]["author"]["displayName"], "Kim");
    assert_eq!(app.get(&path, &uploader).await.json()["comments"][0]["canDelete"], true);
    assert_eq!(app.get("/api/videos", &other).await.json()["videos"][0]["commentCount"], 3);

    let path_of = |comment: &str| format!("/api/comments/{comment}");
    assert_eq!(app.delete(&path_of(&comment_ids[0]), &other).await.status, StatusCode::FORBIDDEN);
    assert_eq!(app.delete(&path_of(&comment_ids[0]), &author).await.status, StatusCode::NO_CONTENT);
    assert_eq!(
        app.delete(&path_of(&comment_ids[1]), &uploader).await.status,
        StatusCode::NO_CONTENT
    );
    assert_eq!(app.delete(&path_of(&comment_ids[2]), &admin).await.status, StatusCode::NO_CONTENT);
    assert_eq!(app.delete(&path_of(&comment_ids[2]), &admin).await.status, StatusCode::NOT_FOUND);
    assert_eq!(app.get("/api/videos", &other).await.json()["videos"][0]["commentCount"], 0);
}

#[sqlx::test(migrations = "../migrations")]
async fn rates_a_video_once_for_each_person(db: PgPool) {
    let app = TestApp::new(db);
    let admin = app.admin().await;
    let member = app.invite(&admin, "sam@example.com", "Sam", false).await;
    let low = id_of(&app.upload(&admin, "Low", b"0123456789", None).await);
    let high = id_of(&app.upload(&admin, "High", b"0123456789", None).await);
    let unrated = id_of(&app.upload(&admin, "Unrated", b"0123456789", None).await);
    for stars in [json!(0), json!(6), json!(2.5), json!("4")] {
        assert_eq!(
            rate(&app, &low, stars.clone(), &admin).await.status,
            StatusCode::BAD_REQUEST,
            "{stars}"
        );
    }
    assert_eq!(
        rate(&app, &low, json!(4), &admin).await.json()["rating"],
        json!({ "average": 4.0, "count": 1, "mine": 4 })
    );
    assert_eq!(
        rate(&app, &low, json!(1), &member).await.json()["rating"],
        json!({ "average": 2.5, "count": 2, "mine": 1 })
    );
    assert_eq!(rate(&app, &high, json!(5), &member).await.json()["rating"]["count"], 1);

    let by_rating = app.get("/api/videos?sort=rating", &member).await.json();
    assert_eq!(ids_in(&by_rating, "videos"), vec![high.clone(), low.clone(), unrated]);
    assert_eq!(by_rating["videos"][1]["ratingAverage"], 2.5);

    let cleared = app.delete(&format!("/api/videos/{low}/rating"), &member).await;
    assert_eq!(cleared.json()["rating"], json!({ "average": 4.0, "count": 1, "mine": null }));
    let detail = app.get(&format!("/api/videos/{low}"), &admin).await.json();
    assert_eq!(detail["video"]["rating"]["mine"], 4);
}

#[sqlx::test(migrations = "../migrations")]
async fn finds_videos_by_every_word_of_the_query(db: PgPool) {
    let app = TestApp::new(db);
    let admin = app.admin().await;
    let titled = id_of(&app.upload(&admin, "Weekly sync 2026", b"0123456789", None).await);
    let described = id_of(&app.upload(&admin, "Design review", b"0123456789", None).await);
    app.patch(
        &format!("/api/videos/{described}"),
        json!({ "description": "After the weekly SYNC" }),
        &admin,
    )
    .await;
    let japanese = id_of(&app.upload(&admin, "週次の定例 100%", b"0123456789", None).await);

    let found = |answer: common::Answer| ids_in(&answer.json(), "videos");
    // Titles that hold every word come first, then the newest.
    assert_eq!(found(search(&app, "sync", &admin).await), vec![titled.clone(), described.clone()]);
    assert_eq!(found(search(&app, "weekly%20review", &admin).await), vec![described.clone()]);
    // The wide space of Japanese text separates words too.
    assert_eq!(
        found(search(&app, "%E5%AE%9A%E4%BE%8B%E3%80%80%E9%80%B1%E6%AC%A1", &admin).await),
        vec![japanese.clone()]
    );
    // % is a character, not a pattern.
    assert_eq!(found(search(&app, "100%25", &admin).await), vec![japanese]);
    assert_eq!(found(search(&app, "1%25", &admin).await), Vec::<String>::new());

    let eleven_words = (1..=11).map(|word| word.to_string()).collect::<Vec<_>>().join("+");
    let too_long = "a".repeat(101);
    for query in [
        "",
        "%20",
        eleven_words.as_str(),
        too_long.as_str(),
        "sync&cursor=x",
        "sync&cursor=10001",
    ] {
        assert_eq!(search(&app, query, &admin).await.status, StatusCode::BAD_REQUEST, "{query}");
    }
    assert_eq!(search(&app, "sync&cursor=48", &admin).await.json()["videos"], json!([]));
}

#[sqlx::test(migrations = "../migrations")]
async fn keeps_a_history_for_each_person(db: PgPool) {
    let app = TestApp::new(db);
    let admin = app.admin().await;
    let member = app.invite(&admin, "sam@example.com", "Sam", false).await;
    let first = id_of(&app.upload(&admin, "First", b"0123456789", None).await);
    let second = id_of(&app.upload(&admin, "Second", b"0123456789", None).await);

    for id in [&first, &second, &first] {
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        assert_eq!(
            app.post(&format!("/api/videos/{id}/watched"), json!({}), &member).await.status,
            StatusCode::NO_CONTENT
        );
    }
    let history = app.get("/api/history", &member).await.json();
    assert_eq!(ids_in(&history, "videos"), vec![first, second]);
    assert!(history["videos"][0]["watchedAt"].is_string());
    assert_eq!(app.get("/api/history", &admin).await.json()["videos"], json!([]));
}

#[sqlx::test(migrations = "../migrations")]
async fn recommends_the_next_episode_first(db: PgPool) {
    let app = TestApp::new(db);
    let admin = app.admin().await;
    let member = app.invite(&admin, "sam@example.com", "Sam", false).await;
    let series = app
        .post("/api/series", json!({ "title": "Onboarding", "description": "" }), &admin)
        .await
        .json();
    let series_id = series["series"]["id"].as_str().unwrap().to_string();
    let episodes: Vec<String> = {
        let mut ids = Vec::new();
        for title in ["Episode 1", "Episode 2", "Episode 3"] {
            ids.push(id_of(&app.upload(&admin, title, b"0123456789", Some(&series_id)).await));
        }
        ids
    };
    let newest = id_of(&app.upload(&admin, "Newest", b"0123456789", None).await);

    app.post(&format!("/api/videos/{}/watched", episodes[0]), json!({}), &member).await;
    let picks = ids_in(&app.get("/api/recommendations", &member).await.json(), "videos");
    // The next episode, the videos of the series that is being watched, the newest, and the watched one last.
    assert_eq!(picks, vec![episodes[1].clone(), episodes[2].clone(), newest, episodes[0].clone()]);
}

#[sqlx::test(migrations = "../migrations")]
async fn serves_the_files_of_the_library_from_the_bucket(db: PgPool) {
    let app = TestApp::new(db);
    let admin = app.admin().await;
    let bytes: Vec<u8> = (0..1000u32).map(|index| b"albireo"[index as usize % 7]).collect();
    let id = id_of(&app.upload(&admin, "Weekly sync", &bytes, None).await);
    let path = format!("/api/files/videos/{id}/original.mp4");
    let request = |headers: &[(&str, &str)]| {
        let mut request = Request::builder()
            .uri(&path)
            .header(header::COOKIE, format!("albireo_session={}", admin.token));
        for (name, value) in headers {
            request = request.header(*name, *value);
        }
        request.body(Body::empty()).unwrap()
    };

    let whole = app.send(request(&[("accept-encoding", "gzip, br")])).await;
    assert_eq!(whole.status, StatusCode::OK);
    assert_eq!(whole.bytes, bytes);
    // A video goes as it is, so that ranges count its bytes.
    assert!(!whole.headers.contains_key(header::CONTENT_ENCODING));
    assert_eq!(whole.headers[header::CACHE_CONTROL], "private, no-cache");
    assert_eq!(whole.headers[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
    assert!(whole.headers[header::CONTENT_SECURITY_POLICY].to_str().unwrap().contains("sandbox"));

    let range = app.send(request(&[("range", "bytes=7-13")])).await;
    assert_eq!(range.status, StatusCode::PARTIAL_CONTENT);
    assert_eq!(range.bytes, b"albireo");
    assert_eq!(range.headers[header::CONTENT_RANGE], "bytes 7-13/1000");
    let etag = whole.headers[header::ETAG].to_str().unwrap().to_string();
    assert_eq!(
        app.send(request(&[("if-none-match", &etag)])).await.status,
        StatusCode::NOT_MODIFIED
    );

    for missing in [
        "/api/files/videos/../secret",
        "/api/files/albireo-check/x",
        "/api/files/thumbnails/0123456789abcdef.jpg",
    ] {
        assert_eq!(app.get(missing, &admin).await.status, StatusCode::NOT_FOUND, "{missing}");
    }
    assert_eq!(app.call(Method::GET, &path, None, None).await.status, StatusCode::UNAUTHORIZED);
}

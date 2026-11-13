//! Series and playlists through the API.

mod common;

use axum::http::StatusCode;
use common::{Person, TestApp};
use serde_json::{Value, json};
use sqlx::PgPool;

fn id_of(value: &Value) -> String {
    value["id"].as_str().unwrap().to_string()
}

fn ids_of(list: &Value) -> Vec<String> {
    list.as_array().unwrap().iter().map(id_of).collect()
}

async fn create(app: &TestApp, path: &str, title: &str, person: &Person) -> Value {
    let created = app.post(path, json!({ "title": title, "description": "" }), person).await;
    assert_eq!(created.status, StatusCode::CREATED, "{:?}", created.json());
    created.json()
}

#[sqlx::test(migrations = "../migrations")]
async fn numbers_the_episodes_of_a_series_and_reorders_them(db: PgPool) {
    let app = TestApp::new(db);
    let admin = app.admin().await;
    let owner = app.invite(&admin, "sam@example.com", "Sam", false).await;
    let other = app.invite(&admin, "kim@example.com", "Kim", false).await;
    assert_eq!(
        app.post("/api/series", json!({ "title": "", "description": "" }), &owner)
            .await
            .status,
        StatusCode::BAD_REQUEST
    );
    let series = create(&app, "/api/series", "Onboarding", &owner).await;
    let series_id = id_of(&series["series"]);
    assert_eq!(series["series"]["canEdit"], true);
    let mut episodes = Vec::new();
    for title in ["Welcome", "Tools", "Wrap-up"] {
        episodes.push(id_of(&app.upload(&owner, title, b"0123456789", Some(&series_id)).await));
    }
    let path = format!("/api/series/{series_id}");

    let detail = app.get(&path, &other).await.json();
    assert_eq!(ids_of(&detail["series"]["episodes"]), episodes);
    assert_eq!(detail["series"]["episodes"][2]["episode"], 3);
    assert_eq!(detail["series"]["canEdit"], false);
    let video = app.get(&format!("/api/videos/{}", episodes[1]), &other).await.json();
    assert_eq!(video["video"]["series"]["episode"], 2);
    assert_eq!(video["video"]["series"]["previous"]["title"], "Welcome");
    assert_eq!(video["video"]["series"]["next"]["title"], "Wrap-up");

    let move_path = |video: &str| format!("{path}/episodes/{video}/move");
    assert_eq!(
        app.post(&move_path(&episodes[2]), json!({ "direction": "earlier" }), &other)
            .await
            .status,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        app.post(&move_path(&episodes[0]), json!({ "direction": "earlier" }), &owner)
            .await
            .status,
        StatusCode::CONFLICT
    );
    assert_eq!(
        app.post(&move_path(&episodes[0]), json!({ "direction": "up" }), &owner)
            .await
            .status,
        StatusCode::BAD_REQUEST
    );
    let moved = app
        .post(&move_path(&episodes[2]), json!({ "direction": "earlier" }), &owner)
        .await
        .json();
    assert_eq!(
        ids_of(&moved["series"]["episodes"]),
        vec![episodes[0].clone(), episodes[2].clone(), episodes[1].clone()]
    );
    let moved = app
        .post(&move_path(&episodes[0]), json!({ "direction": "later" }), &admin)
        .await
        .json();
    assert_eq!(
        ids_of(&moved["series"]["episodes"]),
        vec![episodes[2].clone(), episodes[0].clone(), episodes[1].clone()]
    );

    let edited = app.patch(&path, json!({ "title": "Onboarding 2026" }), &owner).await;
    assert_eq!(edited.json()["series"]["title"], "Onboarding 2026");
    assert_eq!(
        app.patch(&path, json!({ "title": "Mine now" }), &other).await.status,
        StatusCode::FORBIDDEN
    );
    let listed = app.get(&format!("/api/series?owner={}", owner.id), &other).await.json();
    assert_eq!(listed["series"][0]["title"], "Onboarding 2026");
    assert!(listed["series"][0]["coverUrl"].is_null());
    assert_eq!(
        app.get(&format!("/api/series?owner={}", other.id), &other).await.json()["series"],
        json!([])
    );
}

#[sqlx::test(migrations = "../migrations")]
async fn takes_videos_out_of_a_series_and_keeps_them_when_it_goes(db: PgPool) {
    let app = TestApp::new(db);
    let admin = app.admin().await;
    let owner = app.invite(&admin, "sam@example.com", "Sam", false).await;
    let uploader = app.invite(&admin, "kim@example.com", "Kim", false).await;
    let other = app.invite(&admin, "lee@example.com", "Lee", false).await;
    let series_id = id_of(&create(&app, "/api/series", "Onboarding", &owner).await["series"]);
    let own = id_of(&app.upload(&owner, "Welcome", b"0123456789", Some(&series_id)).await);
    let theirs = id_of(&app.upload(&uploader, "Tools", b"0123456789", Some(&series_id)).await);

    let episode = |video: &str| format!("/api/series/{series_id}/episodes/{video}");
    assert_eq!(app.delete(&episode(&theirs), &other).await.status, StatusCode::FORBIDDEN);
    // The uploader of a video takes it out of a series that someone else made.
    let left = app.delete(&episode(&theirs), &uploader).await;
    assert_eq!(left.status, StatusCode::OK);
    assert_eq!(ids_of(&left.json()["series"]["episodes"]), vec![own.clone()]);
    assert_eq!(app.delete(&episode(&theirs), &owner).await.status, StatusCode::NOT_FOUND);

    assert_eq!(
        app.delete(&format!("/api/series/{series_id}"), &other).await.status,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        app.delete(&format!("/api/series/{series_id}"), &owner).await.status,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        app.get(&format!("/api/series/{series_id}"), &owner).await.status,
        StatusCode::NOT_FOUND
    );
    let video = app.get(&format!("/api/videos/{own}"), &owner).await.json();
    assert!(video["video"]["series"].is_null());
}

#[sqlx::test(migrations = "../migrations")]
async fn keeps_playlists_in_their_order(db: PgPool) {
    let app = TestApp::new(db);
    let admin = app.admin().await;
    let owner = app.invite(&admin, "sam@example.com", "Sam", false).await;
    let other = app.invite(&admin, "kim@example.com", "Kim", false).await;
    let first = id_of(&app.upload(&other, "First", b"0123456789", None).await);
    let second = id_of(&app.upload(&other, "Second", b"0123456789", None).await);
    let playlist_id = id_of(&create(&app, "/api/playlists", "Watch later", &owner).await["playlist"]);
    let path = format!("/api/playlists/{playlist_id}");
    let videos = format!("{path}/videos");

    assert_eq!(
        app.post(&videos, json!({ "videoId": first }), &other).await.status,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        app.post(&videos, json!({ "videoId": "0123456789abcdef" }), &owner).await.status,
        StatusCode::BAD_REQUEST
    );
    for video in [&first, &second] {
        assert_eq!(app.post(&videos, json!({ "videoId": video }), &owner).await.status, StatusCode::OK);
    }
    assert_eq!(
        app.post(&videos, json!({ "videoId": first }), &owner).await.status,
        StatusCode::CONFLICT
    );
    let detail = app.get(&path, &other).await.json();
    assert_eq!(ids_of(&detail["playlist"]["videos"]), vec![first.clone(), second.clone()]);
    assert_eq!(detail["playlist"]["videos"][1]["position"], 2);
    assert_eq!(detail["playlist"]["canEdit"], false);

    let choices = app.get(&format!("/api/videos/{second}/playlists"), &owner).await.json();
    assert_eq!(
        choices["playlists"],
        json!([{ "id": playlist_id, "title": "Watch later", "hasVideo": true }])
    );
    assert_eq!(
        app.get(&format!("/api/videos/{second}/playlists"), &other).await.json()["playlists"],
        json!([])
    );

    let moved = app
        .post(&format!("{videos}/{second}/move"), json!({ "direction": "earlier" }), &owner)
        .await
        .json();
    assert_eq!(ids_of(&moved["playlist"]["videos"]), vec![second.clone(), first.clone()]);
    assert_eq!(
        app.post(&format!("{videos}/{second}/move"), json!({ "direction": "earlier" }), &owner)
            .await
            .status,
        StatusCode::CONFLICT
    );
    let removed = app.delete(&format!("{videos}/{second}"), &admin).await.json();
    assert_eq!(ids_of(&removed["playlist"]["videos"]), vec![first.clone()]);
    assert_eq!(
        app.delete(&format!("{videos}/{second}"), &owner).await.status,
        StatusCode::NOT_FOUND
    );

    let listed = app.get(&format!("/api/playlists?owner={}", owner.id), &other).await.json();
    assert_eq!(listed["playlists"][0]["owner"]["displayName"], "Sam");
    assert_eq!(app.get("/api/playlists?owner=bogus!", &other).await.status, StatusCode::BAD_REQUEST);
    assert_eq!(app.delete(&path, &other).await.status, StatusCode::FORBIDDEN);
    assert_eq!(app.delete(&path, &owner).await.status, StatusCode::NO_CONTENT);
    // The videos stay in the library.
    assert_eq!(app.get(&format!("/api/videos/{first}"), &owner).await.status, StatusCode::OK);
}

//! The pages of the browser app, the health check, and what every answer carries.

mod common;

use axum::body::Body;
use axum::http::{Method, Request, StatusCode, header};
use common::{PAGE_HTML, TestApp};
use sqlx::PgPool;

fn get(path: &str) -> Request<Body> {
    Request::builder().uri(path).body(Body::empty()).unwrap()
}

#[sqlx::test(migrations = "../migrations")]
async fn serves_the_pages_with_their_security_headers(db: PgPool) {
    let app = TestApp::new(db);
    for path in ["/", "/videos/0123456789abcdef", "/join/some-token"] {
        let page = app.send(get(path)).await;
        assert_eq!(page.status, StatusCode::OK, "{path}");
        assert_eq!(page.bytes, PAGE_HTML.as_bytes(), "{path}");
        assert_eq!(page.headers[header::CACHE_CONTROL], "no-cache");
        assert_eq!(page.headers[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
        assert!(
            page.headers[header::CONTENT_SECURITY_POLICY]
                .to_str()
                .unwrap()
                .starts_with("default-src 'self'")
        );
    }
    let etag = app.send(get("/")).await.headers[header::ETAG].to_str().unwrap().to_string();
    let request = Request::builder()
        .uri("/")
        .header(header::IF_NONE_MATCH, &etag)
        .body(Body::empty())
        .unwrap();
    let unchanged = app.send(request).await;
    assert_eq!(unchanged.status, StatusCode::NOT_MODIFIED);
    assert!(unchanged.headers.contains_key(header::CONTENT_SECURITY_POLICY));

    let script = app.send(get("/assets/app.js")).await;
    assert_eq!(script.headers[header::CACHE_CONTROL], "public, max-age=31536000, immutable");
    assert_eq!(app.send(get("/assets/missing.js")).await.status, StatusCode::NOT_FOUND);

    let posted = app
        .send(Request::builder().method(Method::POST).uri("/videos").body(Body::empty()).unwrap())
        .await;
    assert_eq!(posted.status, StatusCode::METHOD_NOT_ALLOWED);
    assert_eq!(posted.headers[header::ALLOW], "GET, HEAD");
}

#[sqlx::test(migrations = "../migrations")]
async fn answers_unknown_api_paths_with_json(db: PgPool) {
    let app = TestApp::new(db);
    let answer = app.send(get("/api/nothing")).await;
    assert_eq!(answer.status, StatusCode::NOT_FOUND);
    assert_eq!(answer.json()["error"]["code"], "not_found");
    assert_eq!(answer.headers[header::CACHE_CONTROL], "no-store");
    let answer = app.send(get("/api")).await;
    assert_eq!(answer.status, StatusCode::NOT_FOUND);
}

#[sqlx::test(migrations = "../migrations")]
async fn answers_the_health_check(db: PgPool) {
    let app = TestApp::new(db);
    let answer = app.send(get("/healthz")).await;
    assert_eq!(answer.status, StatusCode::OK);
    assert_eq!(answer.bytes, b"ok");
}

#[sqlx::test(migrations = "../migrations")]
async fn compresses_the_answers_of_the_api(db: PgPool) {
    let app = TestApp::new(db);
    let admin = app.admin().await;
    for title in ["Weekly sync", "Design review", "Onboarding"] {
        app.upload(&admin, title, b"0123456789", None).await;
    }
    let request = Request::builder()
        .uri("/api/videos")
        .header(header::COOKIE, format!("albireo_session={}", admin.token))
        .header(header::ACCEPT_ENCODING, "gzip")
        .body(Body::empty())
        .unwrap();
    let answer = app.send(request).await;
    assert_eq!(answer.status, StatusCode::OK);
    assert_eq!(answer.headers[header::CONTENT_ENCODING], "gzip");
}

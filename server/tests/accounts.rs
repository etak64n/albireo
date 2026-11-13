//! The first admin, signing in and out, invitations, people, passwords, sessions, and the
//! profile, through the API.

mod common;

use axum::body::Body;
use axum::http::{Method, Request, StatusCode, header};
use common::{Person, TestApp};
use serde_json::json;
use sqlx::PgPool;

fn sign_in_body(email: &str, password: &str) -> serde_json::Value {
    json!({ "email": email, "password": password })
}

async fn sign_in(app: &TestApp, email: &str, password: &str) -> common::Answer {
    app.call(Method::POST, "/api/sign-in", Some(sign_in_body(email, password)), None)
        .await
}

#[sqlx::test(migrations = "../migrations")]
async fn asks_for_the_setup_until_albireo_has_its_first_admin(db: PgPool) {
    let app = TestApp::new(db);
    let answer = app.call(Method::GET, "/api/me", None, None).await;
    assert_eq!(answer.status, StatusCode::UNAUTHORIZED);
    assert_eq!(answer.json()["error"]["code"], "setup_needed");

    let code = albireo::auth::new_setup_code(&app.db, albireo::time::now()).await.unwrap().unwrap();
    let setup = |code: String| json!({ "setupCode": code, "email": " Admin@Example.com ", "displayName": "Admin", "password": "correct horse battery" });
    let wrong = app.call(Method::POST, "/api/setup", Some(setup("ZZZZ-ZZZZ".into())), None).await;
    assert_eq!(wrong.status, StatusCode::FORBIDDEN);
    assert_eq!(wrong.json()["error"]["code"], "wrong_setup_code");

    // The code works as a person types it: in lowercase, with a space for the hyphen.
    let typed = code.to_lowercase().replace('-', " ");
    let created = app.call(Method::POST, "/api/setup", Some(setup(typed)), None).await;
    assert_eq!(created.status, StatusCode::CREATED, "{:?}", created.json());
    let me = &created.json()["me"];
    assert_eq!(me["email"], "admin@example.com");
    assert_eq!(me["isAdmin"], true);
    let admin = Person {
        id: me["id"].as_str().unwrap().into(),
        token: created.session(),
    };
    assert_eq!(app.get("/api/me", &admin).await.json()["me"]["displayName"], "Admin");

    let again = app.call(Method::POST, "/api/setup", Some(setup(code)), None).await;
    assert_eq!(again.status, StatusCode::CONFLICT);
    let signed_out = app.call(Method::GET, "/api/me", None, None).await;
    assert_eq!(signed_out.json()["error"]["code"], "signed_out");
}

#[sqlx::test(migrations = "../migrations")]
async fn signs_in_with_the_email_and_the_password_only(db: PgPool) {
    let app = TestApp::new(db);
    app.admin().await;

    let unknown = sign_in(&app, "nobody@example.com", "correct horse battery").await;
    assert_eq!(unknown.status, StatusCode::UNAUTHORIZED);
    assert_eq!(unknown.json()["error"]["code"], "wrong_password");
    let wrong = sign_in(&app, "admin@example.com", "wrong horse battery").await;
    assert_eq!(wrong.status, StatusCode::UNAUTHORIZED);
    assert_eq!(wrong.json()["error"]["code"], "wrong_password");

    let signed_in = sign_in(&app, "ADMIN@example.com", "correct horse battery").await;
    assert_eq!(signed_in.status, StatusCode::OK, "{:?}", signed_in.json());
    let cookie = signed_in.headers[header::SET_COOKIE].to_str().unwrap().to_string();
    assert!(cookie.starts_with("albireo_session="), "{cookie}");
    assert!(
        cookie.contains("HttpOnly") && cookie.contains("SameSite=Lax") && !cookie.contains("Secure"),
        "{cookie}"
    );
    let person = Person {
        id: signed_in.json()["me"]["id"].as_str().unwrap().into(),
        token: signed_in.session(),
    };
    assert_eq!(app.get("/api/me", &person).await.status, StatusCode::OK);
}

#[sqlx::test(migrations = "../migrations")]
async fn sends_the_cookie_over_https_only_behind_a_proxy_with_https(db: PgPool) {
    let app = TestApp::new(db);
    app.admin().await;
    let request = Request::builder()
        .method(Method::POST)
        .uri("/api/sign-in")
        .header(header::CONTENT_TYPE, "application/json")
        .header("x-forwarded-proto", "https")
        .body(Body::from(sign_in_body("admin@example.com", "correct horse battery").to_string()))
        .unwrap();
    let answer = app.send(request).await;
    assert_eq!(answer.status, StatusCode::OK);
    assert!(answer.headers[header::SET_COOKIE].to_str().unwrap().contains("; Secure"));
}

#[sqlx::test(migrations = "../migrations")]
async fn locks_the_account_after_ten_wrong_passwords(db: PgPool) {
    let app = TestApp::new(db);
    app.admin().await;
    for _ in 0..10 {
        assert_eq!(
            sign_in(&app, "admin@example.com", "wrong horse battery").await.status,
            StatusCode::UNAUTHORIZED
        );
    }
    let locked = sign_in(&app, "admin@example.com", "correct horse battery").await;
    assert_eq!(locked.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(locked.json()["error"]["code"], "locked");
}

#[sqlx::test(migrations = "../migrations")]
async fn signs_out_this_browser(db: PgPool) {
    let app = TestApp::new(db);
    let admin = app.admin().await;
    let answer = app.call(Method::POST, "/api/sign-out", None, Some(&admin)).await;
    assert_eq!(answer.status, StatusCode::NO_CONTENT);
    assert!(answer.headers[header::SET_COOKIE].to_str().unwrap().contains("Max-Age=0"));
    let after = app.get("/api/me", &admin).await;
    assert_eq!(after.status, StatusCode::UNAUTHORIZED);
    assert_eq!(after.json()["error"]["code"], "signed_out");
}

#[sqlx::test(migrations = "../migrations")]
async fn refuses_changes_that_pages_of_other_sites_send(db: PgPool) {
    let app = TestApp::new(db);
    app.admin().await;
    for site in ["cross-site", "same-site"] {
        let request = Request::builder()
            .method(Method::POST)
            .uri("/api/sign-in")
            .header(header::CONTENT_TYPE, "application/json")
            .header("sec-fetch-site", site)
            .body(Body::from(sign_in_body("admin@example.com", "correct horse battery").to_string()))
            .unwrap();
        let answer = app.send(request).await;
        assert_eq!(answer.status, StatusCode::FORBIDDEN, "{site}");
        assert!(!answer.headers.contains_key(header::SET_COOKIE));
    }
    let request = Request::builder()
        .method(Method::POST)
        .uri("/api/sign-in")
        .header(header::CONTENT_TYPE, "application/json")
        .header("sec-fetch-site", "same-origin")
        .body(Body::from(sign_in_body("admin@example.com", "correct horse battery").to_string()))
        .unwrap();
    assert_eq!(app.send(request).await.status, StatusCode::OK);
}

#[sqlx::test(migrations = "../migrations")]
async fn lets_people_join_with_an_invitation_once(db: PgPool) {
    let app = TestApp::new(db);
    let admin = app.admin().await;

    let created = app.post("/api/invitations", json!({ "isAdmin": false }), &admin).await;
    assert_eq!(created.status, StatusCode::CREATED);
    let token = created.json()["token"].as_str().unwrap().to_string();
    let invitation_id = created.json()["invitation"]["id"].as_str().unwrap().to_string();
    assert_eq!(created.json()["invitation"]["invitedBy"]["displayName"], "Admin");

    let info = app.call(Method::GET, &format!("/api/join/{token}"), None, None).await;
    assert_eq!(info.status, StatusCode::OK);
    assert_eq!(info.json()["invitation"]["invitedBy"], "Admin");
    assert_eq!(info.json()["invitation"]["isAdmin"], false);
    let listed = app.get("/api/invitations", &admin).await.json();
    assert_eq!(listed["invitations"][0]["id"], invitation_id.as_str());

    // An email that has an account already does not use up the invitation.
    let taken = json!({ "email": "admin@example.com", "displayName": "Someone", "password": "a long password" });
    let refused = app.call(Method::POST, &format!("/api/join/{token}"), Some(taken), None).await;
    assert_eq!(refused.status, StatusCode::CONFLICT);
    let short = json!({ "email": "sam@example.com", "displayName": "Sam", "password": "short" });
    assert_eq!(
        app.call(Method::POST, &format!("/api/join/{token}"), Some(short), None)
            .await
            .status,
        StatusCode::BAD_REQUEST
    );

    let body = json!({ "email": "sam@example.com", "displayName": "Sam", "password": "a long password" });
    let joined = app
        .call(Method::POST, &format!("/api/join/{token}"), Some(body.clone()), None)
        .await;
    assert_eq!(joined.status, StatusCode::CREATED, "{:?}", joined.json());
    assert_eq!(joined.json()["me"]["isAdmin"], false);
    assert!(joined.headers.contains_key(header::SET_COOKIE));

    let reused = app.call(Method::POST, &format!("/api/join/{token}"), Some(body), None).await;
    assert_eq!(reused.status, StatusCode::NOT_FOUND);
    assert_eq!(
        app.call(Method::GET, &format!("/api/join/{token}"), None, None).await.status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(app.get("/api/invitations", &admin).await.json()["invitations"], json!([]));
}

#[sqlx::test(migrations = "../migrations")]
async fn lets_admins_alone_invite_and_delete_invitations(db: PgPool) {
    let app = TestApp::new(db);
    let admin = app.admin().await;
    let member = app.invite(&admin, "sam@example.com", "Sam", false).await;
    assert_eq!(
        app.post("/api/invitations", json!({ "isAdmin": false }), &member).await.status,
        StatusCode::FORBIDDEN
    );
    assert_eq!(app.get("/api/invitations", &member).await.status, StatusCode::FORBIDDEN);
    assert_eq!(app.get("/api/people", &member).await.status, StatusCode::FORBIDDEN);

    let created = app.post("/api/invitations", json!({ "isAdmin": true }), &admin).await.json();
    let id = created["invitation"]["id"].as_str().unwrap();
    let token = created["token"].as_str().unwrap();
    assert_eq!(
        app.call(Method::DELETE, &format!("/api/invitations/{id}"), None, Some(&member))
            .await
            .status,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        app.call(Method::DELETE, &format!("/api/invitations/{id}"), None, Some(&admin))
            .await
            .status,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        app.call(Method::GET, &format!("/api/join/{token}"), None, None).await.status,
        StatusCode::NOT_FOUND
    );
}

#[sqlx::test(migrations = "../migrations")]
async fn keeps_at_least_one_admin(db: PgPool) {
    let app = TestApp::new(db);
    let admin = app.admin().await;
    let member = app.invite(&admin, "sam@example.com", "Sam", false).await;

    let demoted = app
        .call(
            Method::PATCH,
            &format!("/api/people/{}", admin.id),
            Some(json!({ "isAdmin": false })),
            Some(&admin),
        )
        .await;
    assert_eq!(demoted.status, StatusCode::CONFLICT);
    assert_eq!(
        app.call(Method::DELETE, &format!("/api/people/{}", admin.id), None, Some(&admin))
            .await
            .status,
        StatusCode::CONFLICT
    );

    let promoted = app
        .call(
            Method::PATCH,
            &format!("/api/people/{}", member.id),
            Some(json!({ "isAdmin": true })),
            Some(&admin),
        )
        .await;
    assert_eq!(promoted.status, StatusCode::OK, "{:?}", promoted.json());
    assert_eq!(promoted.json()["person"]["isAdmin"], true);
    // With a second admin, the first one can become a member.
    let demoted = app
        .call(
            Method::PATCH,
            &format!("/api/people/{}", admin.id),
            Some(json!({ "isAdmin": false })),
            Some(&admin),
        )
        .await;
    assert_eq!(demoted.status, StatusCode::OK);
    assert_eq!(app.get("/api/people", &admin).await.status, StatusCode::FORBIDDEN);

    let people = app.get("/api/people", &member).await.json();
    let emails: Vec<&str> = people["people"]
        .as_array()
        .unwrap()
        .iter()
        .map(|person| person["email"].as_str().unwrap())
        .collect();
    assert_eq!(emails.len(), 2);
    assert!(emails.contains(&"admin@example.com") && emails.contains(&"sam@example.com"));
}

#[sqlx::test(migrations = "../migrations")]
async fn removes_a_person_and_lets_them_come_back_with_their_videos(db: PgPool) {
    let app = TestApp::new(db);
    let admin = app.admin().await;
    let member = app.invite(&admin, "sam@example.com", "Sam", false).await;
    let video = app.upload(&member, "Weekly sync", b"0123456789", None).await;

    assert_eq!(
        app.call(Method::DELETE, &format!("/api/people/{}", member.id), None, Some(&member))
            .await
            .status,
        StatusCode::FORBIDDEN
    );
    let removed = app
        .call(Method::DELETE, &format!("/api/people/{}", member.id), None, Some(&admin))
        .await;
    assert_eq!(removed.status, StatusCode::NO_CONTENT);
    assert_eq!(app.get("/api/me", &member).await.status, StatusCode::UNAUTHORIZED);
    assert_eq!(
        sign_in(&app, "sam@example.com", "a long password").await.status,
        StatusCode::UNAUTHORIZED
    );
    let people = app.get("/api/people", &admin).await.json();
    assert_eq!(people["people"].as_array().unwrap().len(), 1);
    // The video stays in the library, with its uploader.
    let detail = app
        .get(&format!("/api/videos/{}", video["id"].as_str().unwrap()), &admin)
        .await
        .json();
    assert_eq!(detail["video"]["uploader"]["displayName"], "Sam");

    let back = app.invite(&admin, "sam@example.com", "Sam again", false).await;
    assert_eq!(back.id, member.id);
    let detail = app
        .get(&format!("/api/videos/{}", video["id"].as_str().unwrap()), &back)
        .await
        .json();
    assert_eq!(detail["video"]["canEdit"], true);
    assert_eq!(detail["video"]["uploader"]["displayName"], "Sam again");
}

#[sqlx::test(migrations = "../migrations")]
async fn changes_the_password_and_ends_the_other_sessions(db: PgPool) {
    let app = TestApp::new(db);
    let admin = app.admin().await;
    let other = sign_in(&app, "admin@example.com", "correct horse battery").await;
    let other = Person {
        id: admin.id.clone(),
        token: other.session(),
    };

    let change = |current: &str, new: &str| json!({ "currentPassword": current, "newPassword": new });
    let wrong = app
        .call(
            Method::POST,
            "/api/me/password",
            Some(change("wrong horse battery", "a new long password")),
            Some(&admin),
        )
        .await;
    assert_eq!(wrong.status, StatusCode::FORBIDDEN);
    let short = app
        .call(
            Method::POST,
            "/api/me/password",
            Some(change("correct horse battery", "short")),
            Some(&admin),
        )
        .await;
    assert_eq!(short.status, StatusCode::BAD_REQUEST);
    let changed = app
        .call(
            Method::POST,
            "/api/me/password",
            Some(change("correct horse battery", "a new long password")),
            Some(&admin),
        )
        .await;
    assert_eq!(changed.status, StatusCode::NO_CONTENT);

    assert_eq!(app.get("/api/me", &admin).await.status, StatusCode::OK);
    assert_eq!(app.get("/api/me", &other).await.status, StatusCode::UNAUTHORIZED);
    assert_eq!(
        sign_in(&app, "admin@example.com", "correct horse battery").await.status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        sign_in(&app, "admin@example.com", "a new long password").await.status,
        StatusCode::OK
    );
}

#[sqlx::test(migrations = "../migrations")]
async fn lists_and_ends_the_sessions_of_the_person(db: PgPool) {
    let app = TestApp::new(db);
    let admin = app.admin().await;
    let request = Request::builder()
        .method(Method::POST)
        .uri("/api/sign-in")
        .header(header::CONTENT_TYPE, "application/json")
        .header(
            header::USER_AGENT,
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
        )
        .body(Body::from(sign_in_body("admin@example.com", "correct horse battery").to_string()))
        .unwrap();
    let phone = Person {
        id: admin.id.clone(),
        token: app.send(request).await.session(),
    };

    let sessions = app.get("/api/me/sessions", &admin).await.json();
    let sessions = sessions["sessions"].as_array().unwrap().clone();
    assert_eq!(sessions.len(), 2);
    let current: Vec<_> = sessions.iter().filter(|session| session["current"] == true).collect();
    assert_eq!(current.len(), 1);
    let on_phone = sessions.iter().find(|session| session["current"] == false).unwrap();
    assert_eq!(on_phone["browser"], "Safari");
    assert_eq!(on_phone["os"], "iOS");

    let ended = app
        .call(
            Method::DELETE,
            &format!("/api/me/sessions/{}", on_phone["id"].as_str().unwrap()),
            None,
            Some(&admin),
        )
        .await;
    assert_eq!(ended.status, StatusCode::NO_CONTENT);
    assert!(!ended.headers.contains_key(header::SET_COOKIE));
    assert_eq!(app.get("/api/me", &phone).await.status, StatusCode::UNAUTHORIZED);

    let own = current[0]["id"].as_str().unwrap();
    let ended = app
        .call(Method::DELETE, &format!("/api/me/sessions/{own}"), None, Some(&admin))
        .await;
    assert_eq!(ended.status, StatusCode::NO_CONTENT);
    assert!(ended.headers[header::SET_COOKIE].to_str().unwrap().contains("Max-Age=0"));
    assert_eq!(app.get("/api/me", &admin).await.status, StatusCode::UNAUTHORIZED);
}

#[sqlx::test(migrations = "../migrations")]
async fn edits_the_profile_and_the_picture(db: PgPool) {
    let app = TestApp::new(db);
    let admin = app.admin().await;
    let updated = app
        .call(
            Method::PATCH,
            "/api/me",
            Some(json!({ "displayName": "Alex", "bio": "Films the weekly sync.", "language": "ja" })),
            Some(&admin),
        )
        .await;
    assert_eq!(updated.status, StatusCode::OK, "{:?}", updated.json());
    assert_eq!(updated.json()["me"]["displayName"], "Alex");
    assert_eq!(updated.json()["me"]["language"], "ja");
    assert_eq!(
        app.call(Method::PATCH, "/api/me", Some(json!({ "language": "fr" })), Some(&admin))
            .await
            .status,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        app.call(Method::PATCH, "/api/me", Some(json!({})), Some(&admin)).await.status,
        StatusCode::BAD_REQUEST
    );

    let upload = app.call(Method::POST, "/api/me/avatar", None, Some(&admin)).await.json();
    let url = upload["url"].as_str().unwrap();
    assert_eq!(
        app.put_file(url, vec![0xff, 0xd8, 0xff], "image/png", &admin).await.status,
        StatusCode::UNSUPPORTED_MEDIA_TYPE
    );
    assert_eq!(
        app.put_file(url, vec![0xff, 0xd8, 0xff], "image/jpeg", &admin).await.status,
        StatusCode::NO_CONTENT
    );
    let committed = app.call(Method::POST, "/api/me/avatar/commit", None, Some(&admin)).await;
    let avatar_url = committed.json()["me"]["avatarUrl"].as_str().unwrap().to_string();
    assert!(
        avatar_url.starts_with(&format!("/api/files/avatars/{}.jpg?v=", admin.id)),
        "{avatar_url}"
    );
    let profile = app.get(&format!("/api/users/{}", admin.id), &admin).await.json();
    assert_eq!(profile["user"]["bio"], "Films the weekly sync.");
    assert_eq!(profile["user"]["avatarUrl"], avatar_url.as_str());

    let removed = app.call(Method::DELETE, "/api/me/avatar", None, Some(&admin)).await;
    assert_eq!(removed.json()["me"]["avatarUrl"], serde_json::Value::Null);
    assert!(app.store.object(&format!("avatars/{}.jpg", admin.id)).is_none());
}

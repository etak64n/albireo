//! The HTTP API of albireo under /api, the health check, and the pages of the browser app.
//!
//! Everyone who signs in watches every video, uploads videos, rates them, and comments on them. A
//! person edits and deletes the videos that they uploaded and the series and playlists that they
//! made; admins edit and delete everything, and invite and remove people. A comment can be deleted
//! by its author, the uploader of the video, and admins.

mod account;
mod library;
mod videos;

use std::sync::Arc;
use std::time::Instant;

use axum::Json;
use axum::Router;
use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, Uri, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, patch, post, put};
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower_http::compression::CompressionLayer;
use tower_http::compression::predicate::{DefaultPredicate, Predicate};

use crate::auth::{self, Viewer};
use crate::error::{ApiError, AppError, error_body};
use crate::ids::{is_id, random_id};
use crate::log::{Level, REQUEST_ID, log};
use crate::model::FILES_PATH;
use crate::pages::Pages;
use crate::repo::people;
use crate::repo::videos::{ListCursor, RatingCursor};
use crate::security::page_headers;
use crate::storage::ObjectStore;
use crate::time::{iso, now, parse_iso};

/// What every request may use.
#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub store: Arc<dyn ObjectStore>,
    pub pages: Arc<Pages>,
}

pub fn router(state: AppState) -> Router {
    let signed_in = Router::new()
        .route("/api/me", get(account::me).patch(account::update_me))
        .route("/api/me/password", post(account::change_password))
        .route("/api/me/sessions", get(account::sessions))
        .route("/api/me/sessions/{id}", delete(account::end_session))
        .route("/api/sign-out", post(account::sign_out))
        .route("/api/me/avatar", post(account::avatar_upload).delete(account::remove_avatar))
        .route("/api/me/avatar/file", put(account::put_avatar))
        .route("/api/me/avatar/commit", post(account::commit_avatar))
        .route("/api/users/{id}", get(account::user))
        .route("/api/people", get(account::people))
        .route("/api/people/{id}", patch(account::update_person).delete(account::remove_person))
        .route("/api/invitations", get(account::invitations).post(account::create_invitation))
        .route("/api/invitations/{id}", delete(account::delete_invitation))
        .route("/api/history", get(videos::history))
        .route("/api/recommendations", get(videos::recommendations))
        .route("/api/videos", get(videos::list))
        .route("/api/videos/random", get(videos::random))
        .route("/api/videos/{id}", get(videos::detail).patch(videos::edit).delete(videos::remove))
        .route("/api/videos/{id}/watched", post(videos::watched))
        .route("/api/videos/{id}/rating", put(videos::rate).delete(videos::clear_rating))
        .route("/api/videos/{id}/comments", get(videos::comments).post(videos::post_comment))
        .route("/api/comments/{id}", delete(videos::delete_comment))
        .route("/api/videos/{id}/attachments", post(videos::start_attachment))
        .route("/api/attachments/{id}/file", put(videos::put_attachment))
        .route("/api/attachments/{id}/commit", post(videos::commit_attachment))
        .route("/api/attachments/{id}", delete(videos::remove_attachment))
        .route("/api/search", get(videos::search))
        .route("/api/uploads", post(videos::start_upload))
        .route("/api/uploads/{id}/parts", post(videos::part_urls))
        .route("/api/uploads/{id}/parts/{part}", put(videos::put_part))
        .route("/api/uploads/{id}/complete", post(videos::complete_upload))
        .route("/api/uploads/{id}/abort", post(videos::abort_upload))
        .route("/api/videos/{id}/thumbnail", post(videos::thumbnail_upload))
        .route("/api/videos/{id}/thumbnail/file", put(videos::put_thumbnail))
        .route("/api/videos/{id}/thumbnail/commit", post(videos::commit_thumbnail))
        .route("/api/videos/{id}/playlists", get(library::playlist_choices))
        .route("/api/series", get(library::list_series).post(library::create_series))
        .route(
            "/api/series/{id}",
            get(library::series).patch(library::edit_series).delete(library::delete_series),
        )
        .route("/api/series/{id}/episodes/{video}/move", post(library::move_episode))
        .route("/api/series/{id}/episodes/{video}", delete(library::remove_episode))
        .route("/api/playlists", get(library::list_playlists).post(library::create_playlist))
        .route(
            "/api/playlists/{id}",
            get(library::playlist)
                .patch(library::edit_playlist)
                .delete(library::delete_playlist),
        )
        .route("/api/playlists/{id}/videos", post(library::add_to_playlist))
        .route("/api/playlists/{id}/videos/{video}", delete(library::remove_from_playlist))
        .route("/api/playlists/{id}/videos/{video}/move", post(library::move_in_playlist))
        .route("/api/files/{*key}", get(videos::file))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_viewer));

    let open = Router::new()
        .route("/healthz", get(healthz))
        .route("/api/setup", post(account::setup))
        .route("/api/sign-in", post(account::sign_in))
        .route("/api/join/{token}", get(account::join_info).post(account::join));

    // Text goes compressed to a browser that accepts it: the pages, their scripts and styles,
    // and the answers of the API. The files of the bucket go as they are, since a video is
    // compressed already and a range must count the bytes of the file.
    let compression = CompressionLayer::new().compress_when(DefaultPredicate::new().and(
        |_: StatusCode, _: axum::http::Version, headers: &HeaderMap, _: &axum::http::Extensions| {
            !headers.contains_key(header::ACCEPT_RANGES)
        },
    ));

    Router::new()
        .merge(open)
        .merge(signed_in)
        .fallback(pages)
        .layer(middleware::from_fn(refuse_other_sites))
        .layer(compression)
        .layer(middleware::from_fn(request_context))
        .with_state(state)
}

/// Gives each request an ID for the log, keeps the answers of the API out of caches, and writes
/// one line for each request of the API, apart from the files, which a page asks for by the dozen.
async fn request_context(request: Request, next: Next) -> Response {
    let id = random_id();
    let method = request.method().clone();
    let path = request.uri().path().to_string();
    let started = Instant::now();
    let mut response = REQUEST_ID.scope(id.clone(), next.run(request)).await;
    if path.starts_with("/api/") && !path.starts_with(FILES_PATH) {
        response
            .headers_mut()
            .entry(header::CACHE_CONTROL)
            .or_insert(HeaderValue::from_static("no-store"));
        let fields = [
            ("method", Value::String(method.to_string())),
            ("path", Value::String(path)),
            ("status", Value::from(response.status().as_u16())),
            ("durationMs", Value::from(started.elapsed().as_millis() as u64)),
        ];
        REQUEST_ID.sync_scope(id, || log(Level::Info, "Request", &fields));
    }
    response
}

/// Refuses every change of the API that a page of another site asks for. A browser marks the
/// requests that a page of another site sends, and a page of albireo sends same-origin, so another
/// site cannot make the browser of a person change the library, nor sign them in.
async fn refuse_other_sites(request: Request, next: Next) -> Response {
    let changes = !matches!(*request.method(), Method::GET | Method::HEAD);
    let site = request
        .headers()
        .get("sec-fetch-site")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if changes && request.uri().path().starts_with("/api/") && (site == "cross-site" || site == "same-site") {
        return AppError::from(ApiError::forbidden("albireo accepts changes only from its own pages.")).into_response();
    }
    next.run(request).await
}

/// Lets a request through only with a session, which it then carries as the Viewer.
async fn require_viewer(State(state): State<AppState>, mut request: Request, next: Next) -> Result<Response, AppError> {
    match auth::viewer_of(&state.db, request.headers(), now()).await? {
        Some(viewer) => {
            request.extensions_mut().insert(viewer);
            Ok(next.run(request).await)
        }
        None if people::has_users(&state.db).await? => {
            Err(ApiError::new(StatusCode::UNAUTHORIZED, "signed_out", "Sign in to use albireo.").into())
        }
        None => Err(ApiError::new(
            StatusCode::UNAUTHORIZED,
            "setup_needed",
            "albireo has nobody yet. Create the first admin with the setup code from the log of albireo.",
        )
        .into()),
    }
}

/// Docker and a proxy in front of albireo ask this to know that albireo answers and reaches its database.
async fn healthz(State(state): State<AppState>) -> Result<&'static str, AppError> {
    sqlx::query("SELECT 1").execute(&state.db).await?;
    Ok("ok")
}

/// Pages of the browser app and the files that it is built of. Every page leaves with the
/// security headers, also as a 304, which the browser uses to update the headers of the page
/// that it keeps. Pages hold no data, which the API serves after a sign-in.
async fn pages(State(state): State<AppState>, method: Method, uri: Uri, headers: HeaderMap) -> Response {
    let path = uri.path();
    if path == "/api" || path.starts_with("/api/") {
        return (
            StatusCode::NOT_FOUND,
            Json(error_body("not_found", "No API endpoint matches this request.")),
        )
            .into_response();
    }
    if method != Method::GET && method != Method::HEAD {
        let mut response = (StatusCode::METHOD_NOT_ALLOWED, "albireo serves its pages for GET and HEAD.\n").into_response();
        response.headers_mut().insert(header::ALLOW, HeaderValue::from_static("GET, HEAD"));
        return response;
    }
    let mut response = state.pages.respond(path, method == Method::HEAD, &headers);
    let html = response
        .headers()
        .get(header::CONTENT_TYPE)
        .is_some_and(|value| value.as_bytes().starts_with(b"text/html"));
    if html || response.status() == StatusCode::NOT_MODIFIED {
        for (name, value) in page_headers() {
            response.headers_mut().insert(name.clone(), value.clone());
        }
    }
    response
}

/// An ID from the path, or 404 when it has no form of an ID.
fn path_id(value: &str, what: &str) -> Result<String, ApiError> {
    if is_id(value) {
        Ok(value.to_string())
    } else {
        Err(ApiError::not_found(format!("No {what} has this ID.")))
    }
}

fn encode_json(value: Value) -> String {
    URL_SAFE_NO_PAD.encode(value.to_string())
}

fn decode_json(cursor: &str) -> Option<Vec<Value>> {
    let bytes = URL_SAFE_NO_PAD.decode(cursor.trim_end_matches('=')).ok()?;
    match serde_json::from_slice(&bytes).ok()? {
        Value::Array(items) => Some(items),
        _ => None,
    }
}

fn invalid_cursor() -> ApiError {
    ApiError::bad_request("The cursor is not valid. Pass nextCursor from the previous page.")
}

fn encode_cursor(cursor: &ListCursor) -> String {
    encode_json(json!([iso(&cursor.time), cursor.id]))
}

fn decode_cursor(text: &str) -> Result<ListCursor, ApiError> {
    let items = decode_json(text).ok_or_else(invalid_cursor)?;
    match items.as_slice() {
        [Value::String(time), Value::String(id)] if is_id(id) => Ok(ListCursor {
            time: parse_iso(time).ok_or_else(invalid_cursor)?,
            id: id.clone(),
        }),
        _ => Err(invalid_cursor()),
    }
}

fn encode_rating_cursor(cursor: &RatingCursor) -> String {
    encode_json(json!([cursor.score, cursor.count, iso(&cursor.created_at), cursor.id]))
}

fn decode_rating_cursor(text: &str) -> Result<RatingCursor, ApiError> {
    let items = decode_json(text).ok_or_else(invalid_cursor)?;
    match items.as_slice() {
        [score, count, Value::String(time), Value::String(id)] if is_id(id) => Ok(RatingCursor {
            score: score
                .as_i64()
                .and_then(|score| i32::try_from(score).ok())
                .ok_or_else(invalid_cursor)?,
            count: count
                .as_i64()
                .and_then(|count| i32::try_from(count).ok())
                .ok_or_else(invalid_cursor)?,
            created_at: parse_iso(time).ok_or_else(invalid_cursor)?,
            id: id.clone(),
        }),
        _ => Err(invalid_cursor()),
    }
}

/// The length of a request that sends a file, which must be from min to max bytes. The body
/// streams to the bucket, which needs its length first, so the request must carry Content-Length.
fn file_length(headers: &HeaderMap, min: i64, max: i64) -> Result<u64, ApiError> {
    let length = headers
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<i64>().ok())
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::LENGTH_REQUIRED,
                "length_required",
                "Send the file with a Content-Length header.",
            )
        })?;
    if length < min || length > max {
        return Err(ApiError::bad_request(if min == max {
            format!("The file must be {min} bytes long.")
        } else {
            format!("The file must be {min} to {max} bytes long.")
        }));
    }
    Ok(length as u64)
}

fn require_content_type(headers: &HeaderMap, content_type: &str) -> Result<(), ApiError> {
    let sent = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(str::trim);
    if sent.is_some_and(|sent| sent.eq_ignore_ascii_case(content_type)) {
        Ok(())
    } else {
        Err(ApiError::new(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "unsupported_media_type",
            format!("Send the file as {content_type}."),
        ))
    }
}

/// An answer with the JSON and the status.
fn json_response(status: StatusCode, value: Value) -> Response {
    (status, Json(value)).into_response()
}

fn no_content() -> Response {
    Response::builder()
        .status(StatusCode::NO_CONTENT)
        .body(Body::empty())
        .expect("an empty answer is valid")
}

/// The viewer as the browser app sees itself.
fn me_of(viewer: &Viewer) -> crate::model::Me {
    let user = &viewer.user;
    crate::model::Me {
        id: user.id.clone(),
        display_name: user.display_name.clone(),
        avatar_url: crate::model::versioned_url(user.avatar_key.as_deref(), &user.updated_at),
        bio: user.bio.clone(),
        email: user.email.clone(),
        is_admin: user.is_admin,
        joined_at: iso(&user.created_at),
        language: if crate::shared::LANGUAGES.contains(&user.language.as_str()) {
            user.language.clone()
        } else {
            "en".into()
        },
    }
}

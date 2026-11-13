//! Who uses albireo: the setup of the first admin, signing in and out, joining with an invitation,
//! the profile and the password of the person, their sessions, and the people and the invitations
//! that admins manage.

use axum::Extension;
use axum::body::{Body, Bytes};
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::Response;
use chrono::TimeDelta;
use serde_json::{Value, json};

use super::{AppState, file_length, json_response, me_of, no_content, path_id, require_content_type};
use crate::auth::{self, Viewer};
use crate::error::{ApiError, AppError, AppResult};
use crate::ids::{random_id, random_token, sha256_hex};
use crate::json::{Rule, read_bool, read_object, read_optional_string, read_string};
use crate::log::{Level, log};
use crate::model::{Invitation, JoinInfo, Person, Session, UserProfile, UserSummary, versioned_url};
use crate::repo::people::{self, InvitationRecord, NewUser};
use crate::shared::{BIO_MAX_LENGTH, DISPLAY_NAME_MAX_LENGTH, EMAIL_MAX_LENGTH, LANGUAGES, PASSWORD_MAX_LENGTH};
use crate::time::{iso, now};

/// An invitation works for this long.
const INVITATION_DAYS: i64 = 7;
/// Thumbnails and pictures are JPEG images that the browser makes, of at most this many bytes.
pub const IMAGE_CONTENT_TYPE: &str = "image/jpeg";
pub const IMAGE_MAX_BYTES: i64 = 32 * 1024 * 1024;

fn avatar_key(user_id: &str) -> String {
    format!("avatars/{user_id}.jpg")
}

fn wrong_password() -> AppError {
    ApiError::new(
        StatusCode::UNAUTHORIZED,
        "wrong_password",
        "The email or the password is not right.",
    )
    .into()
}

fn invitation_gone() -> AppError {
    ApiError::not_found("This invitation does not work: someone used it, it expired, or an admin deleted it. Ask an admin for a new one.")
        .into()
}

fn require_admin(viewer: &Viewer, what: &str) -> Result<(), ApiError> {
    if viewer.is_admin() {
        Ok(())
    } else {
        Err(ApiError::forbidden(format!("Only admins can {what}.")))
    }
}

/// The answer that signs the browser in: the person, and the cookie of the new session.
fn signed_in(status: StatusCode, viewer: &Viewer, token: &str, headers: &HeaderMap) -> Response {
    let mut response = json_response(status, json!({ "me": me_of(viewer) }));
    response
        .headers_mut()
        .insert(header::SET_COOKIE, auth::session_cookie(token, auth::is_https(headers)));
    response
}

fn password_rule() -> Rule {
    Rule {
        min: 0,
        max: PASSWORD_MAX_LENGTH * 4,
        trim: false,
    }
}

/// The first admin, with the setup code that albireo writes to its log while it has nobody.
pub async fn setup(State(state): State<AppState>, headers: HeaderMap, body: Bytes) -> AppResult<Response> {
    let body = read_object(&body, &["setupCode", "email", "displayName", "password"])?;
    let code = read_string(
        &body,
        "setupCode",
        Rule {
            min: 1,
            max: 40,
            trim: true,
        },
    )?;
    let email = auth::normalize_email(&read_string(
        &body,
        "email",
        Rule {
            min: 1,
            max: EMAIL_MAX_LENGTH,
            trim: true,
        },
    )?)?;
    let display_name = read_string(
        &body,
        "displayName",
        Rule {
            min: 1,
            max: DISPLAY_NAME_MAX_LENGTH,
            trim: true,
        },
    )?;
    let password = read_string(&body, "password", password_rule())?;
    auth::check_new_password(&password, "password")?;
    let password_hash = auth::hash_password(password).await?;
    let now = now();
    let id = random_id();

    let mut transaction = state.db.begin().await?;
    people::lock_people(&mut transaction).await?;
    if people::has_users_in(&mut transaction).await? {
        return Err(ApiError::conflict("albireo has its first admin already. Sign in instead.").into());
    }
    if !people::setup_code_exists(&mut transaction, &auth::setup_code_hash(&code)).await? {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "wrong_setup_code",
            "The setup code is not right. Find it in the log of albireo, in the line that says that albireo has nobody yet.",
        )
        .into());
    }
    let user = NewUser {
        id: &id,
        email: &email,
        password_hash: &password_hash,
        display_name: &display_name,
        is_admin: true,
        now,
    };
    people::insert_user(&mut transaction, &user).await?;
    people::delete_setup_codes(&mut transaction).await?;
    transaction.commit().await?;

    log(Level::Info, "The first admin joined", &[("userId", Value::String(id.clone()))]);
    let token = auth::start_session(&state.db, &id, &headers, now).await?;
    let viewer = viewer_of_new_session(&state, &id, &token).await?;
    Ok(signed_in(StatusCode::CREATED, &viewer, &token, &headers))
}

async fn viewer_of_new_session(state: &AppState, user_id: &str, token: &str) -> AppResult<Viewer> {
    let user = people::find_user(&state.db, user_id)
        .await?
        .ok_or_else(|| AppError::Internal(format!("The person {user_id} is missing.")))?;
    Ok(Viewer {
        user,
        session_id: sha256_hex(token),
    })
}

pub async fn sign_in(State(state): State<AppState>, headers: HeaderMap, body: Bytes) -> AppResult<Response> {
    let body = read_object(&body, &["email", "password"])?;
    let email = read_string(
        &body,
        "email",
        Rule {
            min: 1,
            max: EMAIL_MAX_LENGTH,
            trim: true,
        },
    )?
    .to_lowercase();
    let password = read_string(&body, "password", password_rule())?;
    let now = now();
    let user = people::find_user_by_email(&state.db, &email)
        .await?
        .filter(|user| user.removed_at.is_none());
    let Some(user) = user else {
        auth::check_against_nothing(password).await;
        return Err(wrong_password());
    };
    if user.locked_until.is_some_and(|until| until > now) {
        return Err(ApiError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "locked",
            format!(
                "Too many sign-ins with a wrong password. Try again in {} minutes.",
                auth::LOCK_MINUTES
            ),
        )
        .into());
    }
    if !auth::verify_password(password, user.password_hash.clone()).await {
        people::record_failed_sign_in(&state.db, &user.id, now + TimeDelta::minutes(auth::LOCK_MINUTES)).await?;
        return Err(wrong_password());
    }
    people::reset_failed_sign_ins(&state.db, &user.id).await?;
    let token = auth::start_session(&state.db, &user.id, &headers, now).await?;
    let viewer = viewer_of_new_session(&state, &user.id, &token).await?;
    Ok(signed_in(StatusCode::OK, &viewer, &token, &headers))
}

/// Ends the session of this browser.
pub async fn sign_out(State(state): State<AppState>, Extension(viewer): Extension<Viewer>, headers: HeaderMap) -> AppResult<Response> {
    people::delete_session(&state.db, viewer.id(), &viewer.session_id).await?;
    let mut response = no_content();
    response
        .headers_mut()
        .insert(header::SET_COOKIE, auth::clearing_cookie(auth::is_https(&headers)));
    Ok(response)
}

/// What the page of an invitation link shows before the person joins.
pub async fn join_info(State(state): State<AppState>, Path(token): Path<String>) -> AppResult<Response> {
    let invitation = people::find_invitation_by_token(&state.db, &sha256_hex(&token), now())
        .await?
        .ok_or_else(invitation_gone)?;
    let info = JoinInfo {
        is_admin: invitation.is_admin,
        invited_by: invitation.inviter_name,
        expires_at: iso(&invitation.expires_at),
    };
    Ok(json_response(StatusCode::OK, json!({ "invitation": info })))
}

/// Makes the account of a person with an invitation, which works once. A person whom an admin
/// removed joins again with their old email, and their videos and comments are theirs again.
pub async fn join(State(state): State<AppState>, Path(token): Path<String>, headers: HeaderMap, body: Bytes) -> AppResult<Response> {
    let body = read_object(&body, &["email", "displayName", "password"])?;
    let email = auth::normalize_email(&read_string(
        &body,
        "email",
        Rule {
            min: 1,
            max: EMAIL_MAX_LENGTH,
            trim: true,
        },
    )?)?;
    let display_name = read_string(
        &body,
        "displayName",
        Rule {
            min: 1,
            max: DISPLAY_NAME_MAX_LENGTH,
            trim: true,
        },
    )?;
    let password = read_string(&body, "password", password_rule())?;
    auth::check_new_password(&password, "password")?;
    let password_hash = auth::hash_password(password).await?;
    let now = now();

    let mut transaction = state.db.begin().await?;
    people::lock_people(&mut transaction).await?;
    let existing: Option<(String, Option<crate::time::Time>)> = sqlx::query_as("SELECT id, removed_at FROM users WHERE email = $1")
        .bind(&email)
        .fetch_optional(&mut *transaction)
        .await?;
    if existing.as_ref().is_some_and(|(_, removed_at)| removed_at.is_none()) {
        return Err(ApiError::conflict("This email has an account already. Sign in with it.").into());
    }
    let Some(is_admin) = people::take_invitation(&mut transaction, &sha256_hex(&token), now).await? else {
        return Err(invitation_gone());
    };
    let id = existing.as_ref().map_or_else(random_id, |(id, _)| id.clone());
    let user = NewUser {
        id: &id,
        email: &email,
        password_hash: &password_hash,
        display_name: &display_name,
        is_admin,
        now,
    };
    if existing.is_some() {
        people::restore_user(&mut transaction, &id, &user).await?;
    } else {
        people::insert_user(&mut transaction, &user).await?;
    }
    transaction.commit().await?;

    log(
        Level::Info,
        "A person joined with an invitation",
        &[("userId", Value::String(id.clone()))],
    );
    let token = auth::start_session(&state.db, &id, &headers, now).await?;
    let viewer = viewer_of_new_session(&state, &id, &token).await?;
    Ok(signed_in(StatusCode::CREATED, &viewer, &token, &headers))
}

pub async fn me(Extension(viewer): Extension<Viewer>) -> Response {
    json_response(StatusCode::OK, json!({ "me": me_of(&viewer) }))
}

pub async fn update_me(State(state): State<AppState>, Extension(viewer): Extension<Viewer>, body: Bytes) -> AppResult<Response> {
    let body = read_object(&body, &["displayName", "bio", "language"])?;
    let display_name = read_optional_string(
        &body,
        "displayName",
        Rule {
            min: 1,
            max: DISPLAY_NAME_MAX_LENGTH,
            trim: true,
        },
    )?;
    let bio = read_optional_string(
        &body,
        "bio",
        Rule {
            min: 0,
            max: BIO_MAX_LENGTH,
            trim: false,
        },
    )?;
    let language = match body.get("language") {
        None => None,
        Some(Value::String(language)) if LANGUAGES.contains(&language.as_str()) => Some(language.clone()),
        Some(_) => return Err(ApiError::bad_request("language must be \"en\" or \"ja\".").into()),
    };
    if display_name.is_none() && bio.is_none() && language.is_none() {
        return Err(ApiError::bad_request("Send at least one of displayName, bio, and language.").into());
    }
    people::update_profile(
        &state.db,
        viewer.id(),
        display_name.as_deref(),
        bio.as_deref(),
        language.as_deref(),
        now(),
    )
    .await?;
    let viewer = reload(&state, &viewer).await?;
    Ok(json_response(StatusCode::OK, json!({ "me": me_of(&viewer) })))
}

async fn reload(state: &AppState, viewer: &Viewer) -> AppResult<Viewer> {
    let user = people::find_user(&state.db, viewer.id())
        .await?
        .ok_or_else(|| AppError::Internal(format!("The person {} is missing.", viewer.id())))?;
    Ok(Viewer {
        user,
        session_id: viewer.session_id.clone(),
    })
}

/// Changes the password, and ends every other session of the person.
pub async fn change_password(State(state): State<AppState>, Extension(viewer): Extension<Viewer>, body: Bytes) -> AppResult<Response> {
    let body = read_object(&body, &["currentPassword", "newPassword"])?;
    let current = read_string(&body, "currentPassword", password_rule())?;
    let new_password = read_string(&body, "newPassword", password_rule())?;
    auth::check_new_password(&new_password, "newPassword")?;
    if !auth::verify_password(current, viewer.user.password_hash.clone()).await {
        return Err(ApiError::new(StatusCode::FORBIDDEN, "wrong_password", "The current password is not right.").into());
    }
    let hash = auth::hash_password(new_password).await?;
    people::set_password(&state.db, viewer.id(), &hash, now()).await?;
    people::delete_other_sessions(&state.db, viewer.id(), &viewer.session_id).await?;
    Ok(no_content())
}

/// The sessions of the person, from the last used, with the one of this browser marked.
pub async fn sessions(State(state): State<AppState>, Extension(viewer): Extension<Viewer>) -> AppResult<Response> {
    let sessions: Vec<Session> = people::list_sessions(&state.db, viewer.id(), now())
        .await?
        .into_iter()
        .map(|session| Session {
            current: session.id == viewer.session_id,
            id: session.id,
            browser: session.browser,
            os: session.os,
            signed_in_at: iso(&session.created_at),
            last_active_at: iso(&session.last_seen_at),
            expires_at: iso(&session.expires_at),
        })
        .collect();
    Ok(json_response(StatusCode::OK, json!({ "sessions": sessions })))
}

/// Ends one session of the person. Ending the session of this browser signs it out.
pub async fn end_session(
    State(state): State<AppState>,
    Extension(viewer): Extension<Viewer>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> AppResult<Response> {
    if !people::delete_session(&state.db, viewer.id(), &id).await? {
        return Err(ApiError::not_found("No session of yours has this ID.").into());
    }
    let mut response = no_content();
    if id == viewer.session_id {
        response
            .headers_mut()
            .insert(header::SET_COOKIE, auth::clearing_cookie(auth::is_https(&headers)));
    }
    Ok(response)
}

/// The picture of the person: the browser sends a JPEG to the URL of the answer, then commits it.
pub async fn avatar_upload() -> Response {
    json_response(
        StatusCode::OK,
        json!({ "url": "/api/me/avatar/file", "contentType": IMAGE_CONTENT_TYPE }),
    )
}

pub async fn put_avatar(
    State(state): State<AppState>,
    Extension(viewer): Extension<Viewer>,
    headers: HeaderMap,
    body: Body,
) -> AppResult<Response> {
    require_content_type(&headers, IMAGE_CONTENT_TYPE)?;
    let length = file_length(&headers, 1, IMAGE_MAX_BYTES)?;
    state
        .store
        .put_object(&avatar_key(viewer.id()), IMAGE_CONTENT_TYPE, body, length, &[])
        .await?;
    Ok(no_content())
}

pub async fn commit_avatar(State(state): State<AppState>, Extension(viewer): Extension<Viewer>) -> AppResult<Response> {
    let key = avatar_key(viewer.id());
    if state.store.head_object(&key).await?.is_none() {
        return Err(ApiError::conflict("Send the picture to its URL before committing it.").into());
    }
    people::set_avatar(&state.db, viewer.id(), Some(&key), now()).await?;
    let viewer = reload(&state, &viewer).await?;
    Ok(json_response(StatusCode::OK, json!({ "me": me_of(&viewer) })))
}

/// Goes back to the default person icon, and deletes the picture from the bucket.
pub async fn remove_avatar(State(state): State<AppState>, Extension(viewer): Extension<Viewer>) -> AppResult<Response> {
    state.store.delete_object(&avatar_key(viewer.id())).await?;
    people::set_avatar(&state.db, viewer.id(), None, now()).await?;
    let viewer = reload(&state, &viewer).await?;
    Ok(json_response(StatusCode::OK, json!({ "me": me_of(&viewer) })))
}

pub async fn user(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Response> {
    let user = people::find_user(&state.db, &path_id(&id, "user")?)
        .await?
        .ok_or_else(|| ApiError::not_found("No user has this ID."))?;
    let profile = UserProfile {
        avatar_url: versioned_url(user.avatar_key.as_deref(), &user.updated_at),
        id: user.id,
        display_name: user.display_name,
        bio: user.bio,
    };
    Ok(json_response(StatusCode::OK, json!({ "user": profile })))
}

/// The people who may sign in, for the admins.
pub async fn people(State(state): State<AppState>, Extension(viewer): Extension<Viewer>) -> AppResult<Response> {
    require_admin(&viewer, "see the people of albireo")?;
    let people: Vec<Person> = people::list_people(&state.db).await?.into_iter().map(person_of).collect();
    Ok(json_response(StatusCode::OK, json!({ "people": people })))
}

fn person_of(person: people::PersonRecord) -> Person {
    Person {
        avatar_url: versioned_url(person.avatar_key.as_deref(), &person.updated_at),
        id: person.id,
        display_name: person.display_name,
        email: person.email,
        is_admin: person.is_admin,
        joined_at: iso(&person.created_at),
        last_active_at: person.last_active_at.as_ref().map(iso),
    }
}

/// Makes a person an admin, or makes an admin a member. albireo keeps at least one admin.
pub async fn update_person(
    State(state): State<AppState>,
    Extension(viewer): Extension<Viewer>,
    Path(id): Path<String>,
    body: Bytes,
) -> AppResult<Response> {
    require_admin(&viewer, "change who is an admin")?;
    let id = path_id(&id, "person")?;
    let body = read_object(&body, &["isAdmin"])?;
    let is_admin = read_bool(&body, "isAdmin")?;
    if people::find_user(&state.db, &id)
        .await?
        .filter(|user| user.removed_at.is_none())
        .is_none()
    {
        return Err(ApiError::not_found("No person has this ID.").into());
    }
    if !people::set_admin(&state.db, &id, is_admin, now()).await? {
        return Err(ApiError::conflict("albireo needs at least one admin. Make someone else an admin first.").into());
    }
    let person = people::list_people(&state.db)
        .await?
        .into_iter()
        .find(|person| person.id == id)
        .map(person_of);
    Ok(json_response(StatusCode::OK, json!({ "person": person })))
}

/// Removes a person: they cannot sign in, and their sessions end. Their videos and comments stay.
pub async fn remove_person(
    State(state): State<AppState>,
    Extension(viewer): Extension<Viewer>,
    Path(id): Path<String>,
) -> AppResult<Response> {
    require_admin(&viewer, "remove people")?;
    let id = path_id(&id, "person")?;
    if id == viewer.id() {
        return Err(ApiError::conflict("You cannot remove yourself. Another admin can.").into());
    }
    if people::find_user(&state.db, &id)
        .await?
        .filter(|user| user.removed_at.is_none())
        .is_none()
    {
        return Err(ApiError::not_found("No person has this ID.").into());
    }
    if !people::remove_user(&state.db, &id, now()).await? {
        return Err(ApiError::conflict("albireo needs at least one admin. Make someone else an admin first.").into());
    }
    log(Level::Info, "A person was removed", &[("userId", Value::String(id))]);
    Ok(no_content())
}

fn invitation_of(invitation: InvitationRecord) -> Invitation {
    Invitation {
        invited_by: UserSummary {
            avatar_url: versioned_url(invitation.inviter_avatar_key.as_deref(), &invitation.inviter_updated_at),
            id: invitation.invited_by,
            display_name: invitation.inviter_name,
        },
        id: invitation.id,
        is_admin: invitation.is_admin,
        created_at: iso(&invitation.created_at),
        expires_at: iso(&invitation.expires_at),
    }
}

/// The invitations that nobody has used yet, for the admins.
pub async fn invitations(State(state): State<AppState>, Extension(viewer): Extension<Viewer>) -> AppResult<Response> {
    require_admin(&viewer, "see the invitations")?;
    let invitations: Vec<Invitation> = people::list_invitations(&state.db, now())
        .await?
        .into_iter()
        .map(invitation_of)
        .collect();
    Ok(json_response(StatusCode::OK, json!({ "invitations": invitations })))
}

/// Makes an invitation, and answers its token once: the link of the invitation is /join/<token>.
pub async fn create_invitation(State(state): State<AppState>, Extension(viewer): Extension<Viewer>, body: Bytes) -> AppResult<Response> {
    require_admin(&viewer, "invite people")?;
    let body = read_object(&body, &["isAdmin"])?;
    let is_admin = read_bool(&body, "isAdmin")?;
    let id = random_id();
    let token = random_token();
    let now = now();
    people::insert_invitation(
        &state.db,
        &id,
        &sha256_hex(&token),
        is_admin,
        viewer.id(),
        now,
        now + TimeDelta::days(INVITATION_DAYS),
    )
    .await?;
    let invitation = people::find_invitation(&state.db, &id)
        .await?
        .ok_or_else(|| AppError::Internal(format!("The invitation {id} is missing.")))?;
    Ok(json_response(
        StatusCode::CREATED,
        json!({ "invitation": invitation_of(invitation), "token": token }),
    ))
}

pub async fn delete_invitation(
    State(state): State<AppState>,
    Extension(viewer): Extension<Viewer>,
    Path(id): Path<String>,
) -> AppResult<Response> {
    require_admin(&viewer, "delete invitations")?;
    if !people::delete_invitation(&state.db, &path_id(&id, "invitation")?).await? {
        return Err(ApiError::not_found("No invitation has this ID.").into());
    }
    Ok(no_content())
}

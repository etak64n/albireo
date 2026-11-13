//! Reads and writes the people of albireo, their sessions, the invitations, and the setup codes.

use sqlx::{FromRow, PgPool, Postgres, Transaction};

use crate::time::Time;

#[derive(Clone, Debug, FromRow)]
pub struct UserRecord {
    pub id: String,
    pub email: String,
    pub password_hash: String,
    pub display_name: String,
    pub bio: String,
    pub avatar_key: Option<String>,
    pub language: String,
    pub is_admin: bool,
    pub failed_sign_ins: i32,
    pub locked_until: Option<Time>,
    pub removed_at: Option<Time>,
    pub created_at: Time,
    pub updated_at: Time,
}

macro_rules! user_columns {
    () => {
        "id, email, password_hash, display_name, bio, avatar_key, language, is_admin, failed_sign_ins, locked_until, \
         removed_at, created_at, updated_at"
    };
}

pub async fn find_user(db: &PgPool, id: &str) -> Result<Option<UserRecord>, sqlx::Error> {
    sqlx::query_as(concat!("SELECT ", user_columns!(), " FROM users WHERE id = $1"))
        .bind(id)
        .fetch_optional(db)
        .await
}

/// The person with the email, which albireo keeps in lowercase, removed or not.
pub async fn find_user_by_email(db: &PgPool, email: &str) -> Result<Option<UserRecord>, sqlx::Error> {
    sqlx::query_as(concat!("SELECT ", user_columns!(), " FROM users WHERE email = $1"))
        .bind(email)
        .fetch_optional(db)
        .await
}

pub async fn has_users(db: &PgPool) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM users)").fetch_one(db).await
}

pub struct NewUser<'a> {
    pub id: &'a str,
    pub email: &'a str,
    pub password_hash: &'a str,
    pub display_name: &'a str,
    pub is_admin: bool,
    pub now: Time,
}

pub async fn insert_user(transaction: &mut Transaction<'_, Postgres>, user: &NewUser<'_>) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO users (id, email, password_hash, display_name, bio, avatar_key, language, is_admin, created_at, updated_at) \
         VALUES ($1, $2, $3, $4, '', NULL, 'en', $5, $6, $6)",
    )
    .bind(user.id)
    .bind(user.email)
    .bind(user.password_hash)
    .bind(user.display_name)
    .bind(user.is_admin)
    .bind(user.now)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

/// Lets a person whom an admin removed sign in again, with a new password, a new display name,
/// and the role of their invitation. Their videos and comments are theirs again.
pub async fn restore_user(transaction: &mut Transaction<'_, Postgres>, id: &str, user: &NewUser<'_>) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE users SET password_hash = $1, display_name = $2, is_admin = $3, removed_at = NULL, failed_sign_ins = 0, \
         locked_until = NULL, updated_at = $4 WHERE id = $5",
    )
    .bind(user.password_hash)
    .bind(user.display_name)
    .bind(user.is_admin)
    .bind(user.now)
    .bind(id)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

/// Changes the display name, the bio, the language, or some of them.
pub async fn update_profile(
    db: &PgPool,
    id: &str,
    display_name: Option<&str>,
    bio: Option<&str>,
    language: Option<&str>,
    now: Time,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE users SET display_name = COALESCE($1, display_name), bio = COALESCE($2, bio), language = COALESCE($3, language), \
         updated_at = $4 WHERE id = $5",
    )
    .bind(display_name)
    .bind(bio)
    .bind(language)
    .bind(now)
    .bind(id)
    .execute(db)
    .await?;
    Ok(())
}

/// Sets the key of the picture, or None to go back to the default person icon.
pub async fn set_avatar(db: &PgPool, id: &str, avatar_key: Option<&str>, now: Time) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE users SET avatar_key = $1, updated_at = $2 WHERE id = $3")
        .bind(avatar_key)
        .bind(now)
        .bind(id)
        .execute(db)
        .await?;
    Ok(())
}

pub async fn set_password(db: &PgPool, id: &str, password_hash: &str, now: Time) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE users SET password_hash = $1, updated_at = $2 WHERE id = $3")
        .bind(password_hash)
        .bind(now)
        .bind(id)
        .execute(db)
        .await?;
    Ok(())
}

/// Counts a sign-in with a wrong password. The tenth in a row locks the account until `lock_until`.
pub async fn record_failed_sign_in(db: &PgPool, id: &str, lock_until: Time) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE users SET failed_sign_ins = CASE WHEN failed_sign_ins + 1 >= 10 THEN 0 ELSE failed_sign_ins + 1 END, \
         locked_until = CASE WHEN failed_sign_ins + 1 >= 10 THEN $1 ELSE locked_until END WHERE id = $2",
    )
    .bind(lock_until)
    .bind(id)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn reset_failed_sign_ins(db: &PgPool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE users SET failed_sign_ins = 0, locked_until = NULL WHERE id = $1")
        .bind(id)
        .execute(db)
        .await?;
    Ok(())
}

/// A person as the admins see them, with the last request of their sessions.
#[derive(Clone, Debug, FromRow)]
pub struct PersonRecord {
    pub id: String,
    pub email: String,
    pub display_name: String,
    pub avatar_key: Option<String>,
    pub updated_at: Time,
    pub is_admin: bool,
    pub created_at: Time,
    pub last_active_at: Option<Time>,
}

/// The people who may sign in, from the one who joined first.
pub async fn list_people(db: &PgPool) -> Result<Vec<PersonRecord>, sqlx::Error> {
    sqlx::query_as(
        "SELECT u.id, u.email, u.display_name, u.avatar_key, u.updated_at, u.is_admin, u.created_at, \
         (SELECT MAX(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_active_at \
         FROM users u WHERE u.removed_at IS NULL ORDER BY u.created_at, u.id",
    )
    .fetch_all(db)
    .await
}

/// Changes whether a person is an admin, unless it would leave albireo without one. Returns
/// false when the person is the last admin and would stop being one.
pub async fn set_admin(db: &PgPool, id: &str, is_admin: bool, now: Time) -> Result<bool, sqlx::Error> {
    let mut transaction = db.begin().await?;
    lock_people(&mut transaction).await?;
    if !is_admin && is_last_admin(&mut transaction, id).await? {
        return Ok(false);
    }
    sqlx::query("UPDATE users SET is_admin = $1, updated_at = $2 WHERE id = $3 AND removed_at IS NULL")
        .bind(is_admin)
        .bind(now)
        .bind(id)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    Ok(true)
}

/// Removes a person: they cannot sign in, and their sessions end. Their videos and comments stay.
/// Returns false when the person is the last admin.
pub async fn remove_user(db: &PgPool, id: &str, now: Time) -> Result<bool, sqlx::Error> {
    let mut transaction = db.begin().await?;
    lock_people(&mut transaction).await?;
    if is_last_admin(&mut transaction, id).await? {
        return Ok(false);
    }
    sqlx::query("UPDATE users SET removed_at = $1, updated_at = $1 WHERE id = $2 AND removed_at IS NULL")
        .bind(now)
        .bind(id)
        .execute(&mut *transaction)
        .await?;
    sqlx::query("DELETE FROM sessions WHERE user_id = $1")
        .bind(id)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    Ok(true)
}

/// Lets one change of the people run at a time, so that two admins cannot demote each other at
/// once and leave albireo without one. The lock ends with the transaction.
pub async fn lock_people(transaction: &mut Transaction<'_, Postgres>) -> Result<(), sqlx::Error> {
    // Any number works, as long as albireo uses it for this lock alone.
    sqlx::query("SELECT pg_advisory_xact_lock(4417211)")
        .execute(&mut **transaction)
        .await?;
    Ok(())
}

async fn is_last_admin(transaction: &mut Transaction<'_, Postgres>, id: &str) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT u.is_admin AND (SELECT COUNT(*) FROM users WHERE is_admin AND removed_at IS NULL) = 1 \
         FROM users u WHERE u.id = $1 AND u.removed_at IS NULL",
    )
    .bind(id)
    .fetch_optional(&mut **transaction)
    .await
    .map(|last| last.unwrap_or(false))
}

/// A session with its person, for a request.
#[derive(Clone, Debug, FromRow)]
pub struct SessionRecord {
    pub id: String,
    pub user_id: String,
    pub browser: String,
    pub os: String,
    pub created_at: Time,
    pub last_seen_at: Time,
    pub expires_at: Time,
}

pub async fn insert_session(
    db: &PgPool,
    id: &str,
    user_id: &str,
    device: (&str, &str),
    now: Time,
    expires_at: Time,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO sessions (id, user_id, browser, os, created_at, last_seen_at, expires_at) VALUES ($1, $2, $3, $4, $5, $5, $6)",
    )
    .bind(id)
    .bind(user_id)
    .bind(device.0)
    .bind(device.1)
    .bind(now)
    .bind(expires_at)
    .execute(db)
    .await?;
    Ok(())
}

/// The session with the ID that has not expired, with its person, who must not be removed.
pub async fn find_session(db: &PgPool, id: &str, now: Time) -> Result<Option<(SessionRecord, UserRecord)>, sqlx::Error> {
    let session: Option<SessionRecord> = sqlx::query_as(
        "SELECT s.id, s.user_id, s.browser, s.os, s.created_at, s.last_seen_at, s.expires_at FROM sessions s \
         JOIN users u ON u.id = s.user_id WHERE s.id = $1 AND s.expires_at > $2 AND u.removed_at IS NULL",
    )
    .bind(id)
    .bind(now)
    .fetch_optional(db)
    .await?;
    let Some(session) = session else { return Ok(None) };
    Ok(find_user(db, &session.user_id).await?.map(|user| (session, user)))
}

/// Moves the last request of a session forward, and its end with it.
pub async fn touch_session(db: &PgPool, id: &str, now: Time, expires_at: Time) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE sessions SET last_seen_at = $1, expires_at = $2 WHERE id = $3")
        .bind(now)
        .bind(expires_at)
        .bind(id)
        .execute(db)
        .await?;
    Ok(())
}

/// The sessions of the person that have not expired, from the last used.
pub async fn list_sessions(db: &PgPool, user_id: &str, now: Time) -> Result<Vec<SessionRecord>, sqlx::Error> {
    sqlx::query_as(
        "SELECT id, user_id, browser, os, created_at, last_seen_at, expires_at FROM sessions \
         WHERE user_id = $1 AND expires_at > $2 ORDER BY last_seen_at DESC, created_at DESC",
    )
    .bind(user_id)
    .bind(now)
    .fetch_all(db)
    .await
}

pub async fn delete_session(db: &PgPool, user_id: &str, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM sessions WHERE user_id = $1 AND id = $2")
        .bind(user_id)
        .bind(id)
        .execute(db)
        .await?;
    Ok(result.rows_affected() > 0)
}

/// Ends every session of the person but one.
pub async fn delete_other_sessions(db: &PgPool, user_id: &str, keep: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM sessions WHERE user_id = $1 AND id <> $2")
        .bind(user_id)
        .bind(keep)
        .execute(db)
        .await?;
    Ok(())
}

/// Forgets the sessions that have expired, of everyone.
pub async fn delete_expired_sessions(db: &PgPool, now: Time) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM sessions WHERE expires_at <= $1")
        .bind(now)
        .execute(db)
        .await?;
    Ok(())
}

#[derive(Clone, Debug, FromRow)]
pub struct InvitationRecord {
    pub id: String,
    pub is_admin: bool,
    pub invited_by: String,
    pub inviter_name: String,
    pub inviter_avatar_key: Option<String>,
    pub inviter_updated_at: Time,
    pub created_at: Time,
    pub expires_at: Time,
}

macro_rules! invitation_select {
    () => {
        "SELECT i.id, i.is_admin, i.invited_by, u.display_name AS inviter_name, u.avatar_key AS inviter_avatar_key, \
         u.updated_at AS inviter_updated_at, i.created_at, i.expires_at FROM invitations i JOIN users u ON u.id = i.invited_by"
    };
}

pub async fn insert_invitation(
    db: &PgPool,
    id: &str,
    token_hash: &str,
    is_admin: bool,
    invited_by: &str,
    now: Time,
    expires_at: Time,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO invitations (id, token_hash, is_admin, invited_by, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6)")
        .bind(id)
        .bind(token_hash)
        .bind(is_admin)
        .bind(invited_by)
        .bind(now)
        .bind(expires_at)
        .execute(db)
        .await?;
    Ok(())
}

pub async fn find_invitation(db: &PgPool, id: &str) -> Result<Option<InvitationRecord>, sqlx::Error> {
    sqlx::query_as(concat!(invitation_select!(), " WHERE i.id = $1"))
        .bind(id)
        .fetch_optional(db)
        .await
}

/// The invitation of a token that has not expired.
pub async fn find_invitation_by_token(db: &PgPool, token_hash: &str, now: Time) -> Result<Option<InvitationRecord>, sqlx::Error> {
    sqlx::query_as(concat!(invitation_select!(), " WHERE i.token_hash = $1 AND i.expires_at > $2"))
        .bind(token_hash)
        .bind(now)
        .fetch_optional(db)
        .await
}

/// The invitations that nobody has used and that have not expired, from the newest.
pub async fn list_invitations(db: &PgPool, now: Time) -> Result<Vec<InvitationRecord>, sqlx::Error> {
    sqlx::query_as(concat!(
        invitation_select!(),
        " WHERE i.expires_at > $1 ORDER BY i.created_at DESC, i.id DESC"
    ))
    .bind(now)
    .fetch_all(db)
    .await
}

pub async fn delete_invitation(db: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM invitations WHERE id = $1").bind(id).execute(db).await?;
    Ok(result.rows_affected() > 0)
}

/// Takes an invitation for a person who joins: the invitation goes, so it works once.
pub async fn take_invitation(
    transaction: &mut Transaction<'_, Postgres>,
    token_hash: &str,
    now: Time,
) -> Result<Option<bool>, sqlx::Error> {
    sqlx::query_scalar("DELETE FROM invitations WHERE token_hash = $1 AND expires_at > $2 RETURNING is_admin")
        .bind(token_hash)
        .bind(now)
        .fetch_optional(&mut **transaction)
        .await
}

pub async fn insert_setup_code(db: &PgPool, code_hash: &str, now: Time) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO setup_codes (code_hash, created_at) VALUES ($1, $2) ON CONFLICT DO NOTHING")
        .bind(code_hash)
        .bind(now)
        .execute(db)
        .await?;
    Ok(())
}

pub async fn setup_code_exists(transaction: &mut Transaction<'_, Postgres>, code_hash: &str) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM setup_codes WHERE code_hash = $1)")
        .bind(code_hash)
        .fetch_one(&mut **transaction)
        .await
}

pub async fn delete_setup_codes(transaction: &mut Transaction<'_, Postgres>) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM setup_codes").execute(&mut **transaction).await?;
    Ok(())
}

pub async fn has_users_in(transaction: &mut Transaction<'_, Postgres>) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM users)")
        .fetch_one(&mut **transaction)
        .await
}

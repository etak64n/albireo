//! Signing in. Each person signs in with an email and a password, which albireo keeps as an
//! Argon2id hash. A sign-in starts a session: a random token in a cookie that only the server
//! reads, whose SHA-256 the database keeps. A session ends 30 days after its last request, when
//! the person signs out, and when an admin removes the person.

use std::sync::OnceLock;

use argon2::Argon2;
use argon2::password_hash::{PasswordHasher, PasswordVerifier};
use axum::http::{HeaderMap, HeaderValue, header};
use chrono::TimeDelta;
use sqlx::PgPool;

use crate::error::{ApiError, AppError};
use crate::ids::{random_token, setup_code, sha256_hex};
use crate::json::text_length;
use crate::repo::people::{self, UserRecord};
use crate::shared::{EMAIL_MAX_LENGTH, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH};
use crate::time::Time;

pub const SESSION_COOKIE: &str = "albireo_session";
/// A session ends this long after its last request.
pub const SESSION_DAYS: i64 = 30;
/// albireo writes the last request of a session at most this often, to keep writes few.
const TOUCH_MINUTES: i64 = 5;
/// Ten sign-ins in a row with a wrong password lock the account for this long.
pub const LOCK_MINUTES: i64 = 15;

/// The person who sent the request, with the session of the request.
#[derive(Clone, Debug)]
pub struct Viewer {
    pub user: UserRecord,
    pub session_id: String,
}

impl Viewer {
    pub fn id(&self) -> &str {
        &self.user.id
    }

    pub fn is_admin(&self) -> bool {
        self.user.is_admin
    }
}

pub async fn hash_password(password: String) -> Result<String, AppError> {
    tokio::task::spawn_blocking(move || Argon2::default().hash_password(password.as_bytes()).map(|hash| hash.to_string()))
        .await
        .map_err(|error| AppError::Internal(error.to_string()))?
        .map_err(|error| AppError::Internal(format!("Hashing a password failed: {error}")))
}

pub async fn verify_password(password: String, hash: String) -> bool {
    tokio::task::spawn_blocking(move || Argon2::default().verify_password(password.as_bytes(), hash.as_str()).is_ok())
        .await
        .unwrap_or(false)
}

/// A hash that matches no password, which a sign-in with an unknown email checks against, so
/// that it takes as long as one with a known email and does not tell which emails have accounts.
pub async fn check_against_nothing(password: String) {
    static NOBODY: OnceLock<String> = OnceLock::new();
    let hash = match NOBODY.get() {
        Some(hash) => hash.clone(),
        None => {
            let Ok(hash) = hash_password(random_token()).await else { return };
            NOBODY.get_or_init(|| hash).clone()
        }
    };
    verify_password(password, hash).await;
}

/// Reads an email: trimmed, in lowercase, with one @ between a name and a domain.
pub fn normalize_email(text: &str) -> Result<String, ApiError> {
    let email = text.trim().to_lowercase();
    let valid = text_length(&email) <= EMAIL_MAX_LENGTH
        && !email.chars().any(char::is_whitespace)
        && email
            .split_once('@')
            .is_some_and(|(name, domain)| !name.is_empty() && !domain.is_empty() && !domain.contains('@'));
    if valid {
        Ok(email)
    } else {
        Err(ApiError::bad_request("email must be an email address, such as alex@example.com."))
    }
}

/// Checks the length of a new password.
pub fn check_new_password(password: &str, name: &str) -> Result<(), ApiError> {
    let length = text_length(password);
    if (PASSWORD_MIN_LENGTH..=PASSWORD_MAX_LENGTH).contains(&length) {
        Ok(())
    } else {
        Err(ApiError::bad_request(format!(
            "{name} must be {PASSWORD_MIN_LENGTH} to {PASSWORD_MAX_LENGTH} characters long."
        )))
    }
}

/// The token of the session cookie of the request, if it has one.
pub fn session_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .find_map(|pair| {
            let (name, value) = pair.trim().split_once('=')?;
            (name == SESSION_COOKIE && !value.is_empty()).then(|| value.to_string())
        })
}

/// Whether the browser reached albireo over HTTPS, as a proxy in front of it says. The cookie of
/// a session then goes only over HTTPS.
pub fn is_https(headers: &HeaderMap) -> bool {
    headers
        .get("x-forwarded-proto")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| {
            value
                .split(',')
                .next()
                .is_some_and(|first| first.trim().eq_ignore_ascii_case("https"))
        })
}

/// The cookie that keeps a session. Scripts cannot read it, and the browser sends it only with
/// requests from the pages of albireo and with links that open albireo.
pub fn session_cookie(token: &str, https: bool) -> HeaderValue {
    let secure = if https { "; Secure" } else { "" };
    let max_age = SESSION_DAYS * 24 * 60 * 60;
    HeaderValue::from_str(&format!(
        "{SESSION_COOKIE}={token}; Path=/; Max-Age={max_age}; HttpOnly; SameSite=Lax{secure}"
    ))
    .expect("the cookie is ASCII")
}

/// The cookie that makes the browser forget the session.
pub fn clearing_cookie(https: bool) -> HeaderValue {
    let secure = if https { "; Secure" } else { "" };
    HeaderValue::from_str(&format!("{SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax{secure}")).expect("the cookie is ASCII")
}

/// Starts a session for the person and returns its token, for the cookie.
pub async fn start_session(db: &PgPool, user_id: &str, headers: &HeaderMap, now: Time) -> Result<String, sqlx::Error> {
    let token = random_token();
    let user_agent = headers.get(header::USER_AGENT).and_then(|value| value.to_str().ok()).unwrap_or("");
    people::insert_session(
        db,
        &sha256_hex(&token),
        user_id,
        device_of(user_agent),
        now,
        now + TimeDelta::days(SESSION_DAYS),
    )
    .await?;
    Ok(token)
}

/// The person of the session of the request, or None without a session that works. A session in
/// use stays: albireo moves its end forward at most every five minutes.
pub async fn viewer_of(db: &PgPool, headers: &HeaderMap, now: Time) -> Result<Option<Viewer>, sqlx::Error> {
    let Some(token) = session_token(headers) else { return Ok(None) };
    let session_id = sha256_hex(&token);
    let Some((session, user)) = people::find_session(db, &session_id, now).await? else {
        return Ok(None);
    };
    if session.last_seen_at < now - TimeDelta::minutes(TOUCH_MINUTES) {
        people::touch_session(db, &session_id, now, now + TimeDelta::days(SESSION_DAYS)).await?;
    }
    Ok(Some(Viewer { user, session_id }))
}

/// When albireo has nobody, writes a setup code to the database and returns it for the log, so
/// that the person who runs albireo can create the first admin.
pub async fn new_setup_code(db: &PgPool, now: Time) -> Result<Option<String>, sqlx::Error> {
    if people::has_users(db).await? {
        return Ok(None);
    }
    let code = setup_code();
    people::insert_setup_code(db, &setup_code_hash(&code), now).await?;
    Ok(Some(code))
}

/// The hash of a setup code as a person types it: without spaces and hyphens, in capitals.
pub fn setup_code_hash(text: &str) -> String {
    let normalized: String = text
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|c| c.to_ascii_uppercase())
        .collect();
    sha256_hex(&normalized)
}

/// The browser and the operating system that a User-Agent header names, each as "" when albireo
/// does not recognize it. The order of the checks matters: Edge and Opera also say Chrome, and
/// Chrome also says Safari.
pub fn device_of(agent: &str) -> (&'static str, &'static str) {
    let has = |needle: &str| agent.contains(needle);
    let browser = if has("Edg/") || has("Edge/") || has("EdgA/") || has("EdgiOS/") {
        "Edge"
    } else if has("OPR/") || has("Opera") {
        "Opera"
    } else if has("Firefox/") || has("FxiOS/") {
        "Firefox"
    } else if has("Chrome/") || has("CriOS/") {
        "Chrome"
    } else if has("Safari/") && has("Version/") {
        "Safari"
    } else {
        ""
    };
    let os = if has("iPhone") {
        "iOS"
    } else if has("iPad") {
        "iPadOS"
    } else if has("Android") {
        "Android"
    } else if has("CrOS") {
        "ChromeOS"
    } else if has("Windows NT") {
        "Windows"
    } else if has("Macintosh") || has("Mac OS X") {
        "macOS"
    } else if has("Linux") {
        "Linux"
    } else {
        ""
    };
    (browser, os)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_emails_in_lowercase() {
        assert_eq!(normalize_email("  Alex@Example.COM ").unwrap(), "alex@example.com");
        for bad in ["alex", "@example.com", "alex@", "a b@example.com", "a@b@c"] {
            assert!(normalize_email(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn finds_the_session_cookie_among_others() {
        let mut headers = HeaderMap::new();
        headers.insert(header::COOKIE, HeaderValue::from_static("theme=dark; albireo_session=abc; other=1"));
        assert_eq!(session_token(&headers).as_deref(), Some("abc"));
    }

    #[test]
    fn reads_setup_codes_as_people_type_them() {
        assert_eq!(setup_code_hash("abcd-2345"), setup_code_hash("ABCD 2345"));
    }

    #[test]
    fn names_browsers_and_systems() {
        let chrome_mac =
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36";
        assert_eq!(device_of(chrome_mac), ("Chrome", "macOS"));
        let safari_iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1";
        assert_eq!(device_of(safari_iphone), ("Safari", "iOS"));
        assert_eq!(device_of("curl/8.0"), ("", ""));
    }

    #[test]
    fn marks_cookies_secure_behind_https() {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-proto", HeaderValue::from_static("https"));
        assert!(is_https(&headers));
        assert!(session_cookie("t", true).to_str().unwrap().ends_with("; Secure"));
        assert!(!is_https(&HeaderMap::new()));
    }
}

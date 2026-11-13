//! Errors that map to HTTP responses. Every error answers JSON: {"error":{"code","message"}}.

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

use crate::log::{Level, error_fields, log};
use crate::storage::StorageError;

/// An answer of the API that is not a success, with its code and a message for people.
#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: String,
}

impl ApiError {
    pub fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
        }
    }

    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, "bad_request", message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, "not_found", message)
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new(StatusCode::CONFLICT, "conflict", message)
    }

    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new(StatusCode::FORBIDDEN, "forbidden", message)
    }
}

/// What can stop a request: a refusal of the API, the bucket, or the database.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{}", .0.message)]
    Api(ApiError),
    #[error(transparent)]
    Storage(#[from] StorageError),
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error("{0}")]
    Internal(String),
}

impl From<ApiError> for AppError {
    fn from(error: ApiError) -> Self {
        Self::Api(error)
    }
}

pub type AppResult<T> = Result<T, AppError>;

pub fn error_body(code: &str, message: &str) -> serde_json::Value {
    json!({ "error": { "code": code, "message": message } })
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        match self {
            Self::Api(error) => (error.status, Json(error_body(error.code, &error.message))).into_response(),
            Self::Storage(error) => {
                log(Level::Error, "A storage request failed", &error_fields(&error));
                (StatusCode::BAD_GATEWAY, Json(error_body("storage_error", &error.to_string()))).into_response()
            }
            Self::Database(error) => {
                log(Level::Error, "A request failed", &error_fields(&error));
                let body = error_body("internal_error", "The request failed. The log of albireo has the details.");
                (StatusCode::INTERNAL_SERVER_ERROR, Json(body)).into_response()
            }
            Self::Internal(message) => {
                log(Level::Error, "A request failed", &[("errorMessage", message.into())]);
                let body = error_body("internal_error", "The request failed. The log of albireo has the details.");
                (StatusCode::INTERNAL_SERVER_ERROR, Json(body)).into_response()
            }
        }
    }
}

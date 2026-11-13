//! When albireo starts, it checks that it can do with the bucket what it does while it runs:
//! write and read files, upload videos in parts, and delete files. The check works on keys under
//! albireo-check/, deletes what it writes, and stops albireo before it serves anything when a
//! setting is wrong, with an instruction that names the setting to change.

use axum::body::Body;
use axum::http::HeaderMap;

use crate::storage::{ObjectStore, StorageError};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Permission {
    DeleteObjects,
    WriteObjects,
    ReadObjects,
    UploadInParts,
}

impl Permission {
    fn name(self) -> &'static str {
        match self {
            Self::DeleteObjects => "delete objects",
            Self::WriteObjects => "write objects",
            Self::ReadObjects => "read objects",
            Self::UploadInParts => "upload videos in parts",
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum StorageProblem {
    /// The storage service did not answer, or answered with a failure of its own.
    Unreachable(String),
    NoBucket(String),
    RejectedKey(String),
    WrongRegion(String),
    MissingPermissions(Vec<(Permission, String)>),
}

const CHECK_BODY: &str = "albireo checks the access key of the bucket.";

/// Returns what keeps albireo from using the bucket, or None when nothing does. Deleting comes
/// first, on a key that holds no object, so that a key that may not delete stops the check
/// before it writes anything that it could not remove.
pub async fn check_storage(store: &dyn ObjectStore, check_id: &str) -> Option<StorageProblem> {
    let key = format!("albireo-check/{check_id}");
    let mut missing: Vec<(Permission, String)> = Vec::new();
    let mut fatal: Option<StorageProblem> = None;

    macro_rules! attempt {
        ($permission:expr, $action:expr) => {{
            if fatal.is_some() {
                false
            } else {
                match $action.await {
                    Ok(()) => true,
                    Err(error) => {
                        fatal = fatal_problem(&error);
                        if fatal.is_none() && !missing.iter().any(|(permission, _)| *permission == $permission) {
                            missing.push(($permission, error.message.clone()));
                        }
                        false
                    }
                }
            }
        }};
    }

    if !attempt!(Permission::DeleteObjects, store.delete_object(&format!("{key}-none"))) {
        return fatal.or(Some(StorageProblem::MissingPermissions(missing)));
    }
    let written = attempt!(
        Permission::WriteObjects,
        store.put_object(&key, "text/plain", Body::from(CHECK_BODY), CHECK_BODY.len() as u64, &[])
    );
    if written {
        attempt!(Permission::ReadObjects, async {
            let answer = store.get_object(&key, false, &HeaderMap::new()).await?;
            let Some(answer) = answer else {
                return Err(StorageError::new("The object that albireo had just written was not there."));
            };
            let bytes = axum::body::to_bytes(answer.body, 1024)
                .await
                .map_err(|error| StorageError::new(error.to_string()))?;
            if bytes != CHECK_BODY.as_bytes() {
                return Err(StorageError::new("A read returned other bytes than the write sent."));
            }
            Ok(())
        });
        attempt!(Permission::DeleteObjects, store.delete_object(&key));
    }
    attempt!(Permission::UploadInParts, async {
        let parts_key = format!("{key}-parts");
        let upload_id = store.create_multipart_upload(&parts_key, "video/mp4").await?;
        store.abort_multipart_upload(&parts_key, &upload_id).await
    });
    fatal.or(if missing.is_empty() {
        None
    } else {
        Some(StorageProblem::MissingPermissions(missing))
    })
}

/// Whether running the check again later may pass: the storage service did not answer, or failed itself.
pub fn may_pass_later(problem: &StorageProblem) -> bool {
    matches!(problem, StorageProblem::Unreachable(_))
}

/// The instruction that stops albireo, with what the storage service answered.
pub fn problem_message(problem: &StorageProblem, bucket: &str) -> String {
    match problem {
        StorageProblem::Unreachable(reason) => {
            format!("Please check that S3_ENDPOINT is the URL of your storage service and that this container can reach it. {reason}")
        }
        StorageProblem::NoBucket(reason) => {
            format!("Please create the bucket {bucket}, or set S3_BUCKET to a bucket that exists. {reason}")
        }
        StorageProblem::RejectedKey(reason) => {
            format!("Please check S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY: the storage service did not accept the access key. {reason}")
        }
        StorageProblem::WrongRegion(reason) => format!("Please set S3_REGION to the region of the bucket {bucket}. {reason}"),
        StorageProblem::MissingPermissions(missing) => {
            let names: Vec<&str> = missing.iter().map(|(permission, _)| permission.name()).collect();
            let list = match names.as_slice() {
                [one] => (*one).to_string(),
                [rest @ .., last] => format!("{} and {last}", rest.join(", ")),
                [] => String::new(),
            };
            let reasons: Vec<String> = missing
                .iter()
                .map(|(permission, reason)| format!("{}: {reason}", permission.name()))
                .collect();
            format!(
                "Please give the access key in S3_ACCESS_KEY_ID permission to {list} in the bucket {bucket}. {}",
                reasons.join(" ")
            )
        }
    }
}

fn fatal_problem(error: &StorageError) -> Option<StorageProblem> {
    let reason = error.message.clone();
    match error.code.as_deref() {
        Some("NoSuchBucket") => return Some(StorageProblem::NoBucket(reason)),
        Some("InvalidAccessKeyId" | "SignatureDoesNotMatch" | "InvalidToken" | "ExpiredToken") => {
            return Some(StorageProblem::RejectedKey(reason));
        }
        Some(
            "AuthorizationHeaderMalformed"
            | "AuthorizationQueryParametersError"
            | "PermanentRedirect"
            | "IllegalLocationConstraintException",
        ) => {
            return Some(StorageProblem::WrongRegion(reason));
        }
        _ => {}
    }
    // No answer, too many requests, or a failure of the storage service itself.
    match error.status {
        None => Some(StorageProblem::Unreachable(reason)),
        Some(status) if status == 429 || status >= 500 => Some(StorageProblem::Unreachable(reason)),
        Some(_) => None,
    }
}

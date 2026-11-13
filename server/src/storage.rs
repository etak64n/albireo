//! Talks to the S3-compatible bucket.
//!
//! Every file passes through albireo. The browser sends the parts of a video, thumbnails,
//! pictures, and attachments to albireo, which writes them to the bucket as they arrive, and it
//! reads every file from albireo, which streams it from the bucket. The browser talks to albireo
//! alone, so the bucket needs no CORS rules, and the access key never leaves the server.
//!
//! albireo signs each request to the bucket with Signature Version 4 in its query string, and
//! sends the body unsigned, so it streams a body without holding it in memory.

use std::collections::BTreeMap;
use std::time::Duration;

use async_trait::async_trait;
use axum::body::Body;
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode};
use futures_util::TryStreamExt;
use rusty_s3::actions::{CreateMultipartUpload, S3Action};
use rusty_s3::{Bucket, Credentials};

use crate::config::{StorageConfig, UrlStyle};

#[derive(Clone, Debug)]
pub struct CompletedPart {
    pub part_number: u16,
    pub etag: String,
}

/// What a HEAD of an object tells.
#[derive(Clone, Debug)]
pub struct ObjectInfo {
    pub size: u64,
    /// When the bucket wrote the object, or None when it did not tell.
    pub last_modified: Option<String>,
    /// The user metadata of the object, by name in lowercase, such as albireo-library.
    pub metadata: BTreeMap<String, String>,
}

/// The answer of the bucket to a read: 200, 206, 304, 412, or 416, with the headers that albireo
/// passes on to the browser.
pub struct ObjectResponse {
    pub status: StatusCode,
    pub headers: HeaderMap,
    pub body: Body,
}

/// The headers of a read that albireo passes on to the bucket, so that ranges and revalidation work.
pub const FORWARDED_REQUEST_HEADERS: [&str; 4] = ["range", "if-range", "if-none-match", "if-modified-since"];

/// The headers of the answer of the bucket that albireo passes on to the browser.
pub const FORWARDED_RESPONSE_HEADERS: [&str; 6] = [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "etag",
    "last-modified",
];

/// A request to the bucket that failed.
#[derive(Debug, thiserror::Error)]
#[error("{message}")]
pub struct StorageError {
    pub message: String,
    /// The HTTP status that the bucket answered, or None when albireo could not reach it.
    pub status: Option<u16>,
    /// The error code in the answer of the bucket, such as NoSuchBucket or AccessDenied.
    pub code: Option<String>,
}

impl StorageError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            status: None,
            code: None,
        }
    }
}

#[async_trait]
pub trait ObjectStore: Send + Sync {
    /// Starts a multipart upload and returns its upload ID.
    async fn create_multipart_upload(&self, key: &str, content_type: &str) -> Result<String, StorageError>;
    /// Writes one part of a multipart upload, the `length` bytes of the body, and returns its ETag.
    async fn upload_part(&self, key: &str, upload_id: &str, part_number: u16, body: Body, length: u64) -> Result<String, StorageError>;
    async fn complete_multipart_upload(&self, key: &str, upload_id: &str, parts: &[CompletedPart]) -> Result<(), StorageError>;
    async fn abort_multipart_upload(&self, key: &str, upload_id: &str) -> Result<(), StorageError>;
    /// Writes the object, the `length` bytes of the body, with its content type and user metadata.
    async fn put_object(
        &self,
        key: &str,
        content_type: &str,
        body: Body,
        length: u64,
        metadata: &[(&str, &str)],
    ) -> Result<(), StorageError>;
    /// Reads the object, or a range of it, with the headers of FORWARDED_REQUEST_HEADERS that the
    /// browser sent. Returns None when the object does not exist.
    async fn get_object(&self, key: &str, head: bool, headers: &HeaderMap) -> Result<Option<ObjectResponse>, StorageError>;
    /// Returns the size, the time, and the user metadata of the object, or None when it does not exist.
    async fn head_object(&self, key: &str) -> Result<Option<ObjectInfo>, StorageError>;
    /// Deletes the object. Deleting a key that holds no object succeeds.
    async fn delete_object(&self, key: &str) -> Result<(), StorageError>;
}

// How long each signed URL lasts. albireo signs a URL for each request and uses it at once.
const SIGNATURE_LIFETIME: Duration = Duration::from_secs(15 * 60);
// A read, a deletion, and the steps of a multipart upload run again after an answer of 429 or
// 5xx, or a lost connection, twice at most. A write of a body runs once, and the browser sends
// a failed part or file again.
const ATTEMPTS: u32 = 3;
const METADATA_PREFIX: &str = "x-amz-meta-";

pub struct S3ObjectStore {
    bucket: Bucket,
    credentials: Credentials,
    client: reqwest::Client,
    origin: String,
}

impl S3ObjectStore {
    pub fn new(storage: &StorageConfig) -> Result<Self, StorageError> {
        let endpoint = storage
            .endpoint
            .parse()
            .map_err(|error| StorageError::new(format!("S3_ENDPOINT is not a URL: {error}")))?;
        let style = match storage.url_style {
            UrlStyle::Path => rusty_s3::UrlStyle::Path,
            UrlStyle::VirtualHosted => rusty_s3::UrlStyle::VirtualHost,
        };
        let bucket = Bucket::new(endpoint, style, storage.bucket.clone(), storage.region.clone())
            .map_err(|error| StorageError::new(format!("The bucket settings do not make a URL: {error}")))?;
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .read_timeout(Duration::from_secs(120))
            .build()
            .map_err(|error| StorageError::new(format!("albireo could not make an HTTP client: {error}")))?;
        let origin = bucket.base_url().origin().ascii_serialization();
        Ok(Self {
            bucket,
            credentials: Credentials::new(storage.access_key_id.clone(), storage.secret_access_key.clone()),
            client,
            origin,
        })
    }

    fn unreachable(&self, operation: &str, error: &reqwest::Error) -> StorageError {
        let mut reason = error.to_string();
        let mut source = std::error::Error::source(error);
        while let Some(cause) = source {
            reason = format!("{reason}: {cause}");
            source = cause.source();
        }
        StorageError::new(format!(
            "{operation} could not reach the storage service at {}: {reason}",
            self.origin
        ))
    }

    /// Sends a request without a streamed body, again after a passing failure.
    async fn send(&self, operation: &str, build: impl Fn() -> reqwest::RequestBuilder) -> Result<reqwest::Response, StorageError> {
        let mut attempt = 1;
        loop {
            let result = build().send().await;
            let passing = match &result {
                Ok(response) => is_passing(response.status()),
                Err(error) => !error.is_builder(),
            };
            if !passing || attempt >= ATTEMPTS {
                return result.map_err(|error| self.unreachable(operation, &error));
            }
            tokio::time::sleep(Duration::from_millis(100 * 2u64.pow(attempt - 1))).await;
            attempt += 1;
        }
    }

    async fn write(
        &self,
        operation: &str,
        url: url::Url,
        headers: &[(String, String)],
        body: Body,
        length: u64,
    ) -> Result<reqwest::Response, StorageError> {
        let mut request = self.client.put(url).header(reqwest::header::CONTENT_LENGTH, length);
        for (name, value) in headers {
            request = request.header(name.as_str(), value.as_str());
        }
        let stream = body.into_data_stream().map_err(|error| std::io::Error::other(error.to_string()));
        let response = request
            .body(reqwest::Body::wrap_stream(stream))
            .send()
            .await
            .map_err(|error| self.unreachable(operation, &error))?;
        if !response.status().is_success() {
            return Err(failure(operation, response).await);
        }
        Ok(response)
    }
}

fn is_passing(status: reqwest::StatusCode) -> bool {
    matches!(status.as_u16(), 429 | 500 | 502 | 503 | 504)
}

/// The error of an answer that is not a success, with the code and the message of its XML.
async fn failure(operation: &str, response: reqwest::Response) -> StorageError {
    let status = response.status().as_u16();
    let body = response.text().await.unwrap_or_default();
    failure_of(operation, status, &body)
}

fn failure_of(operation: &str, status: u16, body: &str) -> StorageError {
    let code = xml_element(body, "Code");
    let message = xml_element(body, "Message");
    let detail: Vec<&str> = [code.as_deref(), message.as_deref()].into_iter().flatten().collect();
    let detail = if detail.is_empty() {
        String::new()
    } else {
        format!(" ({})", detail.join(": "))
    };
    StorageError {
        message: format!("{operation} failed with HTTP {status}{detail}."),
        status: Some(status),
        code,
    }
}

/// Text of the first element with the given name, or None when there is none.
pub fn xml_element(xml: &str, name: &str) -> Option<String> {
    let open = format!("<{name}>");
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&format!("</{name}>"))? + start;
    let text = &xml[start..end];
    if text.contains('<') {
        return None;
    }
    Some(
        text.replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&apos;", "'")
            .replace("&amp;", "&"),
    )
}

#[async_trait]
impl ObjectStore for S3ObjectStore {
    async fn create_multipart_upload(&self, key: &str, content_type: &str) -> Result<String, StorageError> {
        let mut action = self.bucket.create_multipart_upload(Some(&self.credentials), key);
        action.headers_mut().insert("content-type", content_type.to_string());
        let url = action.sign(SIGNATURE_LIFETIME);
        let response = self
            .send("CreateMultipartUpload", || {
                self.client.post(url.clone()).header("content-type", content_type)
            })
            .await?;
        if !response.status().is_success() {
            return Err(failure("CreateMultipartUpload", response).await);
        }
        let body = response
            .text()
            .await
            .map_err(|error| self.unreachable("CreateMultipartUpload", &error))?;
        let parsed =
            CreateMultipartUpload::parse_response(&body).map_err(|_| StorageError::new("CreateMultipartUpload returned no UploadId."))?;
        Ok(parsed.upload_id().to_string())
    }

    async fn upload_part(&self, key: &str, upload_id: &str, part_number: u16, body: Body, length: u64) -> Result<String, StorageError> {
        let url = self
            .bucket
            .upload_part(Some(&self.credentials), key, part_number, upload_id)
            .sign(SIGNATURE_LIFETIME);
        let response = self.write("UploadPart", url, &[], body, length).await?;
        response
            .headers()
            .get("etag")
            .and_then(|value| value.to_str().ok())
            .filter(|etag| !etag.is_empty())
            .map(str::to_string)
            .ok_or_else(|| StorageError::new("UploadPart returned no ETag."))
    }

    async fn complete_multipart_upload(&self, key: &str, upload_id: &str, parts: &[CompletedPart]) -> Result<(), StorageError> {
        let mut sorted = parts.to_vec();
        sorted.sort_by_key(|part| part.part_number);
        let action = self.bucket.complete_multipart_upload(
            Some(&self.credentials),
            key,
            upload_id,
            sorted.iter().map(|part| part.etag.as_str()),
        );
        let url = action.sign(SIGNATURE_LIFETIME);
        let xml = action.body();
        let response = self
            .send("CompleteMultipartUpload", || self.client.post(url.clone()).body(xml.clone()))
            .await?;
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|error| self.unreachable("CompleteMultipartUpload", &error))?;
        // S3 can answer 200 OK and still report an error in the body.
        if !status.is_success() || body.contains("<Error>") {
            return Err(failure_of("CompleteMultipartUpload", status.as_u16(), &body));
        }
        Ok(())
    }

    async fn abort_multipart_upload(&self, key: &str, upload_id: &str) -> Result<(), StorageError> {
        let url = self
            .bucket
            .abort_multipart_upload(Some(&self.credentials), key, upload_id)
            .sign(SIGNATURE_LIFETIME);
        let response = self.send("AbortMultipartUpload", || self.client.delete(url.clone())).await?;
        // 404 means that the upload is already gone, which is what aborting wants.
        if !response.status().is_success() && response.status().as_u16() != 404 {
            return Err(failure("AbortMultipartUpload", response).await);
        }
        Ok(())
    }

    async fn put_object(
        &self,
        key: &str,
        content_type: &str,
        body: Body,
        length: u64,
        metadata: &[(&str, &str)],
    ) -> Result<(), StorageError> {
        let mut action = self.bucket.put_object(Some(&self.credentials), key);
        let mut headers = vec![("content-type".to_string(), content_type.to_string())];
        for (name, value) in metadata {
            headers.push((format!("{METADATA_PREFIX}{name}"), (*value).to_string()));
        }
        // Every header that the request carries is signed, so nobody can change it on the way.
        for (name, value) in &headers {
            action.headers_mut().insert(name.clone(), value.clone());
        }
        let url = action.sign(SIGNATURE_LIFETIME);
        self.write("PutObject", url, &headers, body, length).await?;
        Ok(())
    }

    async fn get_object(&self, key: &str, head: bool, headers: &HeaderMap) -> Result<Option<ObjectResponse>, StorageError> {
        let url = if head {
            self.bucket.head_object(Some(&self.credentials), key).sign(SIGNATURE_LIFETIME)
        } else {
            self.bucket.get_object(Some(&self.credentials), key).sign(SIGNATURE_LIFETIME)
        };
        let method = if head { reqwest::Method::HEAD } else { reqwest::Method::GET };
        let response = self
            .send("GetObject", || {
                let mut request = self.client.request(method.clone(), url.clone());
                for name in FORWARDED_REQUEST_HEADERS {
                    if let Some(value) = headers.get(name) {
                        request = request.header(name, value.as_bytes());
                    }
                }
                request
            })
            .await?;
        let status = response.status().as_u16();
        if status == 404 {
            return Ok(None);
        }
        // 304 answers a revalidation, 412 an If-Range that no longer matches, and 416 a range past the end.
        if !(response.status().is_success() || matches!(status, 304 | 412 | 416)) {
            return Err(failure("GetObject", response).await);
        }
        let mut forwarded = HeaderMap::new();
        for name in FORWARDED_RESPONSE_HEADERS {
            if let Some(value) = response
                .headers()
                .get(name)
                .and_then(|value| HeaderValue::from_bytes(value.as_bytes()).ok())
            {
                forwarded.insert(HeaderName::from_static(name), value);
            }
        }
        let body = if head {
            Body::empty()
        } else {
            Body::from_stream(response.bytes_stream())
        };
        Ok(Some(ObjectResponse {
            status: StatusCode::from_u16(status).unwrap_or(StatusCode::OK),
            headers: forwarded,
            body,
        }))
    }

    async fn head_object(&self, key: &str) -> Result<Option<ObjectInfo>, StorageError> {
        let url = self.bucket.head_object(Some(&self.credentials), key).sign(SIGNATURE_LIFETIME);
        let response = self.send("HeadObject", || self.client.head(url.clone())).await?;
        if response.status().as_u16() == 404 {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(failure("HeadObject", response).await);
        }
        let size = response
            .headers()
            .get("content-length")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse().ok())
            .ok_or_else(|| StorageError::new("HeadObject returned no Content-Length."))?;
        let last_modified = response
            .headers()
            .get("last-modified")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| chrono::DateTime::parse_from_rfc2822(value).ok())
            .map(|time| crate::time::iso(&time.with_timezone(&chrono::Utc)));
        let metadata = response
            .headers()
            .iter()
            .filter_map(|(name, value)| {
                let name = name.as_str().strip_prefix(METADATA_PREFIX)?;
                Some((name.to_string(), value.to_str().ok()?.to_string()))
            })
            .collect();
        Ok(Some(ObjectInfo {
            size,
            last_modified,
            metadata,
        }))
    }

    async fn delete_object(&self, key: &str) -> Result<(), StorageError> {
        let url = self.bucket.delete_object(Some(&self.credentials), key).sign(SIGNATURE_LIFETIME);
        let response = self.send("DeleteObject", || self.client.delete(url.clone())).await?;
        // S3 answers 204 for a key that holds no object too. Some compatible services answer 404.
        if !response.status().is_success() && response.status().as_u16() != 404 {
            return Err(failure("DeleteObject", response).await);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_and_unescapes_an_element() {
        assert_eq!(xml_element("<Result><Key>a&lt;b</Key></Result>", "Key").as_deref(), Some("a<b"));
        assert_eq!(xml_element("<Result/>", "Key"), None);
    }

    #[test]
    fn describes_a_failure_by_its_code_and_message() {
        let error = failure_of(
            "DeleteObject",
            403,
            "<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>",
        );
        assert_eq!(error.message, "DeleteObject failed with HTTP 403 (AccessDenied: Access Denied).");
        assert_eq!(error.status, Some(403));
        assert_eq!(error.code.as_deref(), Some("AccessDenied"));
    }
}

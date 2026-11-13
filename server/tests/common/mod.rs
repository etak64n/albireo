//! A bucket in memory and the app around a test database, for the tests of the API.

#![allow(dead_code)]

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};

use albireo::api::{AppState, router};
use albireo::auth;
use albireo::pages::Pages;
use albireo::storage::{CompletedPart, ObjectInfo, ObjectResponse, ObjectStore, StorageError};
use albireo::time::now;
use async_trait::async_trait;
use axum::Router;
use axum::body::Body;
use axum::http::{HeaderMap, HeaderValue, Method, Request, StatusCode, header};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;

#[derive(Clone, Debug)]
pub struct StoredObject {
    pub bytes: Vec<u8>,
    pub content_type: String,
    pub metadata: BTreeMap<String, String>,
    pub etag: String,
}

/// A multipart upload that is not complete: its key, its type, and the parts that arrived, by number.
pub struct PendingUpload {
    pub key: String,
    pub content_type: String,
    pub parts: BTreeMap<u16, Vec<u8>>,
}

#[derive(Default)]
pub struct Bucket {
    pub objects: HashMap<String, StoredObject>,
    /// Multipart uploads by ID.
    pub uploads: HashMap<String, PendingUpload>,
    pub deleted: Vec<String>,
    next: u32,
}

#[derive(Clone, Default)]
pub struct MemoryStore {
    pub bucket: Arc<Mutex<Bucket>>,
}

impl MemoryStore {
    pub fn object(&self, key: &str) -> Option<StoredObject> {
        self.bucket.lock().unwrap().objects.get(key).cloned()
    }

    pub fn put(&self, key: &str, bytes: &[u8]) {
        let mut bucket = self.bucket.lock().unwrap();
        bucket.next += 1;
        let etag = format!("\"v{}\"", bucket.next);
        bucket.objects.insert(
            key.into(),
            StoredObject {
                bytes: bytes.to_vec(),
                content_type: "application/octet-stream".into(),
                metadata: BTreeMap::new(),
                etag,
            },
        );
    }
}

async fn read_body(body: Body, length: u64) -> Result<Vec<u8>, StorageError> {
    let bytes = body
        .collect()
        .await
        .map_err(|error| StorageError::new(error.to_string()))?
        .to_bytes()
        .to_vec();
    if bytes.len() as u64 != length {
        return Err(StorageError {
            message: format!("received {} bytes, not {length}", bytes.len()),
            status: Some(400),
            code: Some("IncompleteBody".into()),
        });
    }
    Ok(bytes)
}

#[async_trait]
impl ObjectStore for MemoryStore {
    async fn create_multipart_upload(&self, key: &str, content_type: &str) -> Result<String, StorageError> {
        let mut bucket = self.bucket.lock().unwrap();
        bucket.next += 1;
        let id = format!("upload-{}", bucket.next);
        bucket.uploads.insert(
            id.clone(),
            PendingUpload {
                key: key.into(),
                content_type: content_type.into(),
                parts: BTreeMap::new(),
            },
        );
        Ok(id)
    }

    async fn upload_part(&self, key: &str, upload_id: &str, part_number: u16, body: Body, length: u64) -> Result<String, StorageError> {
        let bytes = read_body(body, length).await?;
        let mut bucket = self.bucket.lock().unwrap();
        let upload = bucket
            .uploads
            .get_mut(upload_id)
            .filter(|upload| upload.key == key)
            .ok_or_else(|| StorageError::new("no such upload"))?;
        upload.parts.insert(part_number, bytes);
        Ok(format!("\"etag-{part_number}\""))
    }

    async fn complete_multipart_upload(&self, key: &str, upload_id: &str, parts: &[CompletedPart]) -> Result<(), StorageError> {
        let mut bucket = self.bucket.lock().unwrap();
        let upload = bucket
            .uploads
            .remove(upload_id)
            .ok_or_else(|| StorageError::new("no such upload"))?;
        assert_eq!(upload.key, key);
        let mut bytes = Vec::new();
        for part in parts {
            bytes.extend(upload.parts.get(&part.part_number).cloned().unwrap_or_default());
        }
        let content_type = upload.content_type;
        bucket.next += 1;
        let etag = format!("\"v{}\"", bucket.next);
        bucket.objects.insert(
            key.into(),
            StoredObject {
                bytes,
                content_type,
                metadata: BTreeMap::new(),
                etag,
            },
        );
        Ok(())
    }

    async fn abort_multipart_upload(&self, _key: &str, upload_id: &str) -> Result<(), StorageError> {
        self.bucket.lock().unwrap().uploads.remove(upload_id);
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
        let bytes = read_body(body, length).await?;
        let mut bucket = self.bucket.lock().unwrap();
        bucket.next += 1;
        let etag = format!("\"v{}\"", bucket.next);
        let metadata = metadata
            .iter()
            .map(|(name, value)| ((*name).to_string(), (*value).to_string()))
            .collect();
        bucket.objects.insert(
            key.into(),
            StoredObject {
                bytes,
                content_type: content_type.into(),
                metadata,
                etag,
            },
        );
        Ok(())
    }

    async fn get_object(&self, key: &str, head: bool, headers: &HeaderMap) -> Result<Option<ObjectResponse>, StorageError> {
        let Some(object) = self.object(key) else { return Ok(None) };
        let mut answer = HeaderMap::new();
        answer.insert(header::CONTENT_TYPE, HeaderValue::from_str(&object.content_type).unwrap());
        answer.insert(header::ETAG, HeaderValue::from_str(&object.etag).unwrap());
        answer.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
        if headers
            .get(header::IF_NONE_MATCH)
            .is_some_and(|value| value.as_bytes() == object.etag.as_bytes())
        {
            return Ok(Some(ObjectResponse {
                status: StatusCode::NOT_MODIFIED,
                headers: answer,
                body: Body::empty(),
            }));
        }
        let length = object.bytes.len();
        let range = headers
            .get(header::RANGE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("bytes="));
        let (status, slice) = match range.and_then(|range| range.split_once('-')) {
            Some((start, end)) => {
                let start: usize = start.parse().unwrap();
                if start >= length {
                    answer.insert(header::CONTENT_RANGE, HeaderValue::from_str(&format!("bytes */{length}")).unwrap());
                    return Ok(Some(ObjectResponse {
                        status: StatusCode::RANGE_NOT_SATISFIABLE,
                        headers: answer,
                        body: Body::empty(),
                    }));
                }
                let end = if end.is_empty() {
                    length - 1
                } else {
                    end.parse::<usize>().unwrap().min(length - 1)
                };
                answer.insert(
                    header::CONTENT_RANGE,
                    HeaderValue::from_str(&format!("bytes {start}-{end}/{length}")).unwrap(),
                );
                (StatusCode::PARTIAL_CONTENT, object.bytes[start..=end].to_vec())
            }
            None => (StatusCode::OK, object.bytes.clone()),
        };
        answer.insert(header::CONTENT_LENGTH, HeaderValue::from(slice.len()));
        Ok(Some(ObjectResponse {
            status,
            headers: answer,
            body: if head { Body::empty() } else { Body::from(slice) },
        }))
    }

    async fn head_object(&self, key: &str) -> Result<Option<ObjectInfo>, StorageError> {
        Ok(self.object(key).map(|object| ObjectInfo {
            size: object.bytes.len() as u64,
            last_modified: None,
            metadata: object.metadata,
        }))
    }

    async fn delete_object(&self, key: &str) -> Result<(), StorageError> {
        let mut bucket = self.bucket.lock().unwrap();
        bucket.objects.remove(key);
        bucket.deleted.push(key.into());
        Ok(())
    }
}

pub const PAGE_HTML: &str = "<!doctype html><title>albireo</title>";

pub struct TestApp {
    pub router: Router,
    pub store: MemoryStore,
    pub db: PgPool,
}

/// An answer of the app, with its body as JSON when it is JSON.
pub struct Answer {
    pub status: StatusCode,
    pub headers: HeaderMap,
    pub bytes: Vec<u8>,
}

impl Answer {
    pub fn json(&self) -> Value {
        serde_json::from_slice(&self.bytes).unwrap_or(Value::Null)
    }

    /// The token of the session cookie that the answer sets.
    pub fn session(&self) -> String {
        let cookie = self
            .headers
            .get(header::SET_COOKIE)
            .expect("the answer sets a cookie")
            .to_str()
            .unwrap();
        cookie.split(';').next().unwrap().split_once('=').unwrap().1.to_string()
    }
}

/// A person who signed in: the token of their session.
#[derive(Clone)]
pub struct Person {
    pub id: String,
    pub token: String,
}

impl TestApp {
    pub fn new(db: PgPool) -> Self {
        let store = MemoryStore::default();
        let pages = Pages::from_files(vec![
            ("/index.html".into(), PAGE_HTML.as_bytes().to_vec()),
            ("/assets/app.js".into(), b"1;".to_vec()),
        ]);
        let router = router(AppState {
            db: db.clone(),
            store: Arc::new(store.clone()),
            pages: Arc::new(pages),
        });
        Self { router, store, db }
    }

    pub async fn send(&self, request: Request<Body>) -> Answer {
        let response = self.router.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let headers = response.headers().clone();
        let bytes = response.into_body().collect().await.unwrap().to_bytes().to_vec();
        Answer { status, headers, bytes }
    }

    /// A request with a JSON body, or none, from the session of the person, or from nobody.
    pub async fn call(&self, method: Method, path: &str, body: Option<Value>, person: Option<&Person>) -> Answer {
        let mut request = Request::builder().method(method).uri(path);
        if let Some(person) = person {
            request = request.header(header::COOKIE, format!("{}={}", auth::SESSION_COOKIE, person.token));
        }
        let body = match body {
            Some(body) => {
                request = request.header(header::CONTENT_TYPE, "application/json");
                Body::from(body.to_string())
            }
            None => Body::empty(),
        };
        self.send(request.body(body).unwrap()).await
    }

    pub async fn get(&self, path: &str, person: &Person) -> Answer {
        self.call(Method::GET, path, None, Some(person)).await
    }

    pub async fn post(&self, path: &str, body: Value, person: &Person) -> Answer {
        self.call(Method::POST, path, Some(body), Some(person)).await
    }

    pub async fn patch(&self, path: &str, body: Value, person: &Person) -> Answer {
        self.call(Method::PATCH, path, Some(body), Some(person)).await
    }

    pub async fn put(&self, path: &str, body: Value, person: &Person) -> Answer {
        self.call(Method::PUT, path, Some(body), Some(person)).await
    }

    pub async fn delete(&self, path: &str, person: &Person) -> Answer {
        self.call(Method::DELETE, path, None, Some(person)).await
    }

    /// A PUT of the bytes with their length, as a browser sends a file.
    pub async fn put_file(&self, path: &str, bytes: Vec<u8>, content_type: &str, person: &Person) -> Answer {
        let request = Request::builder()
            .method(Method::PUT)
            .uri(path)
            .header(header::COOKIE, format!("{}={}", auth::SESSION_COOKIE, person.token))
            .header(header::CONTENT_TYPE, content_type)
            .header(header::CONTENT_LENGTH, bytes.len())
            .body(Body::from(bytes))
            .unwrap();
        self.send(request).await
    }

    /// Sets albireo up with its first admin, who is signed in.
    pub async fn admin(&self) -> Person {
        let code = auth::new_setup_code(&self.db, now()).await.unwrap().expect("albireo has nobody");
        let answer = self
            .call(
                Method::POST,
                "/api/setup",
                Some(
                    json!({ "setupCode": code, "email": "admin@example.com", "displayName": "Admin", "password": "correct horse battery" }),
                ),
                None,
            )
            .await;
        assert_eq!(answer.status, StatusCode::CREATED, "{:?}", answer.json());
        Person {
            id: answer.json()["me"]["id"].as_str().unwrap().into(),
            token: answer.session(),
        }
    }

    /// Invites a person, who joins and is signed in.
    pub async fn invite(&self, admin: &Person, email: &str, name: &str, is_admin: bool) -> Person {
        let invitation = self.post("/api/invitations", json!({ "isAdmin": is_admin }), admin).await;
        assert_eq!(invitation.status, StatusCode::CREATED, "{:?}", invitation.json());
        let token = invitation.json()["token"].as_str().unwrap().to_string();
        let joined = self
            .call(
                Method::POST,
                &format!("/api/join/{token}"),
                Some(json!({ "email": email, "displayName": name, "password": "a long password" })),
                None,
            )
            .await;
        assert_eq!(joined.status, StatusCode::CREATED, "{:?}", joined.json());
        Person {
            id: joined.json()["me"]["id"].as_str().unwrap().into(),
            token: joined.session(),
        }
    }

    /// Uploads a video of the given bytes in its parts, and returns its detail.
    pub async fn upload(&self, person: &Person, title: &str, bytes: &[u8], series_id: Option<&str>) -> Value {
        let created = self
            .post(
                "/api/uploads",
                json!({ "title": title, "fileName": "clip.MP4", "fileSize": bytes.len(), "contentType": "video/mp4", "seriesId": series_id }),
                person,
            )
            .await;
        assert_eq!(created.status, StatusCode::CREATED, "{:?}", created.json());
        let created = created.json();
        let id = created["videoId"].as_str().unwrap().to_string();
        let part_size = created["partSize"].as_u64().unwrap() as usize;
        let mut parts = Vec::new();
        for (index, chunk) in bytes.chunks(part_size).enumerate() {
            let number = index + 1;
            let urls = self
                .post(&format!("/api/uploads/{id}/parts"), json!({ "partNumbers": [number] }), person)
                .await
                .json();
            let url = urls["parts"][0]["url"].as_str().unwrap().to_string();
            let sent = self.put_file(&url, chunk.to_vec(), "application/octet-stream", person).await;
            assert_eq!(sent.status, StatusCode::NO_CONTENT);
            parts.push(json!({ "partNumber": number, "etag": sent.headers[header::ETAG].to_str().unwrap() }));
        }
        let completed = self
            .post(
                &format!("/api/uploads/{id}/complete"),
                json!({ "parts": parts, "durationSec": 8, "width": 1280, "height": 720 }),
                person,
            )
            .await;
        assert_eq!(completed.status, StatusCode::OK, "{:?}", completed.json());
        completed.json()["video"].clone()
    }
}

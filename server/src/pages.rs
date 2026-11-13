//! The files of the browser app, which `vite build` writes to dist/, held in memory. index.html is
//! the page of every path of the app, such as /videos/<ID>. The names of the files under /assets/
//! change with their content, so a browser keeps them for a year; it asks again for the other
//! files, such as index.html, every time, and gets 304 while they are the same.

use std::collections::HashMap;
use std::path::Path;

use axum::body::Body;
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::Response;
use bytes::Bytes;
use sha2::{Digest, Sha256};

#[derive(Clone)]
struct PageFile {
    bytes: Bytes,
    content_type: &'static str,
    etag: String,
    immutable: bool,
}

pub struct Pages {
    files: HashMap<String, PageFile>,
}

fn content_type_of(path: &str) -> &'static str {
    match path
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("html") => "text/html; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("wasm") => "application/wasm",
        Some("txt") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

impl Pages {
    /// Reads every file of the folder. The folder must hold index.html.
    pub fn load(dir: &Path) -> std::io::Result<Self> {
        let mut entries = Vec::new();
        collect(dir, dir, &mut entries)?;
        let pages = Self::from_files(entries);
        if !pages.files.contains_key("/index.html") {
            return Err(std::io::Error::other(format!(
                "{} has no index.html. Build the browser app with `pnpm exec vite build` first.",
                dir.display()
            )));
        }
        Ok(pages)
    }

    /// Files by their paths, such as /index.html.
    pub fn from_files(entries: Vec<(String, Vec<u8>)>) -> Self {
        let files = entries
            .into_iter()
            .map(|(path, bytes)| {
                let etag = format!("\"{}\"", &hex::encode(Sha256::digest(&bytes))[..32]);
                let file = PageFile {
                    content_type: content_type_of(&path),
                    etag,
                    immutable: path.starts_with("/assets/"),
                    bytes: Bytes::from(bytes),
                };
                (path, file)
            })
            .collect();
        Self { files }
    }

    /// Answers a request for a page of the app or a file of the build.
    pub fn respond(&self, path: &str, head: bool, request_headers: &HeaderMap) -> Response {
        // A missing file of the build is an error, not a page of the app.
        let file = match self.files.get(path) {
            Some(file) => file,
            None if path.starts_with("/assets/") => return not_found(),
            None => match self.files.get("/index.html") {
                Some(index) => index,
                None => return not_found(),
            },
        };
        let mut response = Response::new(Body::empty());
        let headers = response.headers_mut();
        headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(file.content_type));
        headers.insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static(if file.immutable {
                "public, max-age=31536000, immutable"
            } else {
                "no-cache"
            }),
        );
        if let Ok(etag) = HeaderValue::from_str(&file.etag) {
            headers.insert(header::ETAG, etag);
        }
        let known = request_headers
            .get(header::IF_NONE_MATCH)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("");
        if known.split(',').any(|tag| tag.trim().trim_start_matches("W/") == file.etag) {
            *response.status_mut() = StatusCode::NOT_MODIFIED;
            return response;
        }
        headers.insert(header::CONTENT_LENGTH, HeaderValue::from(file.bytes.len()));
        if !head {
            *response.body_mut() = Body::from(file.bytes.clone());
        }
        response
    }
}

fn not_found() -> Response {
    let mut response = Response::new(Body::from("No file has this path.\n"));
    *response.status_mut() = StatusCode::NOT_FOUND;
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static("text/plain; charset=utf-8"));
    response
}

fn collect(root: &Path, dir: &Path, entries: &mut Vec<(String, Vec<u8>)>) -> std::io::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if entry.file_type()?.is_dir() {
            collect(root, &path, entries)?;
        } else if entry.file_type()?.is_file() {
            let relative = path.strip_prefix(root).map_err(std::io::Error::other)?;
            let url_path = format!("/{}", relative.to_string_lossy().replace('\\', "/"));
            entries.push((url_path, std::fs::read(&path)?));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pages() -> Pages {
        Pages::from_files(vec![
            ("/index.html".into(), b"<!doctype html>".to_vec()),
            ("/assets/index-abc.js".into(), b"console.log(1);".to_vec()),
        ])
    }

    #[test]
    fn answers_index_html_for_every_path_of_the_app() {
        let response = pages().respond("/videos/abc", false, &HeaderMap::new());
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "text/html; charset=utf-8");
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-cache");
    }

    #[test]
    fn keeps_assets_for_a_year_and_answers_404_for_a_missing_one() {
        let pages = pages();
        assert_eq!(
            pages.respond("/assets/index-abc.js", false, &HeaderMap::new()).headers()[header::CACHE_CONTROL],
            "public, max-age=31536000, immutable"
        );
        assert_eq!(
            pages.respond("/assets/index-old.js", false, &HeaderMap::new()).status(),
            StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn answers_304_while_the_browser_holds_the_same_file() {
        let pages = pages();
        let etag = pages.respond("/", false, &HeaderMap::new()).headers()[header::ETAG].clone();
        let mut headers = HeaderMap::new();
        headers.insert(header::IF_NONE_MATCH, etag);
        assert_eq!(pages.respond("/", false, &headers).status(), StatusCode::NOT_MODIFIED);
    }
}

//! Security headers of the pages of the browser app and of the files that albireo serves. They
//! are in shared/security-headers.json, which the check of the demo reads too
//! (scripts/demo-csp.ts), so that the demo runs under the policy of albireo.
//!
//! The Content-Security-Policy of a page names what it may load and where its scripts may
//! connect. The browser reads every video, picture, and attachment from albireo itself, and sends
//! every upload there, so the policy allows nothing outside the origin of albireo. Beyond that:
//! 'wasm-unsafe-eval' lets the preview of slides run its WebAssembly, the components and the
//! player add style elements and style attributes, and blob: and data: are pictures and videos
//! that the browser makes from a chosen file.
//!
//! The policy of a file from the bucket lets a file that is opened on its own run no script and
//! load nothing but itself: the sandbox puts it in an origin of its own. The browser shows a
//! picture or plays a video that is opened on its own in a page that it makes, which needs the
//! file and inline styles. Inside a page, the policy of the page applies.

use std::sync::LazyLock;

use axum::http::{HeaderName, HeaderValue};
use serde::Deserialize;

pub type Headers = Vec<(HeaderName, HeaderValue)>;

#[derive(Deserialize)]
struct SecurityHeaders {
    page: serde_json::Map<String, serde_json::Value>,
    file: serde_json::Map<String, serde_json::Value>,
}

fn headers_of(map: &serde_json::Map<String, serde_json::Value>) -> Headers {
    map.iter()
        .map(|(name, value)| {
            let value = value.as_str().expect("each header of shared/security-headers.json is a string");
            (
                HeaderName::from_bytes(name.as_bytes()).expect("shared/security-headers.json names valid headers"),
                HeaderValue::from_str(value).expect("shared/security-headers.json holds valid header values"),
            )
        })
        .collect()
}

static HEADERS: LazyLock<(Headers, Headers)> = LazyLock::new(|| {
    let parsed: SecurityHeaders =
        serde_json::from_str(include_str!("../../shared/security-headers.json")).expect("shared/security-headers.json is valid");
    (headers_of(&parsed.page), headers_of(&parsed.file))
});

/// Headers that every page of the browser app carries.
pub fn page_headers() -> &'static Headers {
    &HEADERS.0
}

/// Headers of the files from the bucket.
pub fn file_headers() -> &'static Headers {
    &HEADERS.1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_headers_of_pages_and_files() {
        let csp = |headers: &Headers| {
            headers
                .iter()
                .find(|(name, _)| name == "content-security-policy")
                .map(|(_, value)| value.clone())
        };
        assert!(csp(page_headers()).unwrap().to_str().unwrap().starts_with("default-src 'self'"));
        assert!(csp(file_headers()).unwrap().to_str().unwrap().ends_with("sandbox"));
        assert_eq!(page_headers().len(), 4);
    }
}

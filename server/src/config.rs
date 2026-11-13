//! Reads the settings of albireo from the environment variables of the container: the
//! S3-compatible bucket and the PostgreSQL database. Every variable is required, and albireo has
//! no default values, so a container behaves exactly as its variables say.

use url::Url;

/// The S3-compatible API and the bucket that keep the videos and the other files.
#[derive(Clone, Debug)]
pub struct StorageConfig {
    /// An http:// or https:// URL.
    pub endpoint: String,
    pub region: String,
    pub bucket: String,
    pub url_style: UrlStyle,
    pub access_key_id: String,
    pub secret_access_key: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UrlStyle {
    Path,
    VirtualHosted,
}

#[derive(Clone, Debug)]
pub struct Config {
    pub storage: StorageConfig,
    /// The connection string of the database, such as postgres://albireo:secret@db:5432/albireo.
    pub database_url: String,
}

/// The names of the environment variables, in the order that the documentation lists them.
pub const SETTING_NAMES: [&str; 7] = [
    "DATABASE_URL",
    "S3_ENDPOINT",
    "S3_REGION",
    "S3_BUCKET",
    "S3_URL_STYLE",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
];

// What to set when a variable is missing. Each one says what the value is and gives an example.
fn missing(name: &str) -> String {
    match name {
        "DATABASE_URL" => "Please set DATABASE_URL to the connection string of the PostgreSQL database of albireo, such as postgres://albireo:secret@db:5432/albireo.",
        "S3_ENDPOINT" => "Please set S3_ENDPOINT to the URL of the S3-compatible API of your storage service, such as https://s3.example.com.",
        "S3_REGION" => "Please set S3_REGION to the region that your storage service expects in request signatures, such as us-east-1.",
        "S3_BUCKET" => "Please set S3_BUCKET to the name of the bucket that keeps the videos, such as albireo-videos.",
        "S3_URL_STYLE" => "Please set S3_URL_STYLE to path, which puts the bucket name in the path of each URL, or to virtual-hosted, which puts it in the hostname.",
        "S3_ACCESS_KEY_ID" => "Please set S3_ACCESS_KEY_ID to the ID of an access key that can read, write, and delete the objects of the bucket.",
        _ => "Please set S3_SECRET_ACCESS_KEY to the secret of the access key in S3_ACCESS_KEY_ID.",
    }
    .to_string()
}

/// Reads the settings, or returns every problem, each one an instruction that starts with "Please".
pub fn read_config(env: impl Fn(&str) -> Option<String>) -> Result<Config, Vec<String>> {
    let mut problems = Vec::new();
    let mut value = |name: &str| -> String {
        let text = env(name).unwrap_or_default();
        if text.is_empty() {
            problems.push(missing(name));
        }
        text
    };
    let database_url = value("DATABASE_URL");
    let endpoint = value("S3_ENDPOINT");
    let region = value("S3_REGION");
    let bucket = value("S3_BUCKET");
    let url_style = value("S3_URL_STYLE");
    let access_key_id = value("S3_ACCESS_KEY_ID");
    let secret_access_key = value("S3_SECRET_ACCESS_KEY");

    if !database_url.is_empty() && !(database_url.starts_with("postgres://") || database_url.starts_with("postgresql://")) {
        problems.push("Please set DATABASE_URL to a connection string that starts with postgres://, such as postgres://albireo:secret@db:5432/albireo.".into());
    }
    if !endpoint.is_empty() && !is_endpoint(&endpoint) {
        problems.push(format!(
            "Please set S3_ENDPOINT to an http:// or https:// URL without a query or a fragment, such as https://s3.example.com. It is now {endpoint:?}."
        ));
    }
    if !bucket.is_empty() && !is_bucket_name(&bucket) {
        problems.push(format!(
            "Please set S3_BUCKET to a bucket name of 3 to 63 lowercase letters, digits, dots, and hyphens that starts and ends with a letter or a digit. It is now {bucket:?}."
        ));
    }
    let style = match url_style.as_str() {
        "path" | "" => UrlStyle::Path,
        "virtual-hosted" => UrlStyle::VirtualHosted,
        other => {
            problems.push(format!("Please set S3_URL_STYLE to path or virtual-hosted. It is now {other:?}."));
            UrlStyle::Path
        }
    };
    if !problems.is_empty() {
        return Err(problems);
    }
    Ok(Config {
        storage: StorageConfig {
            endpoint,
            region,
            bucket,
            url_style: style,
            access_key_id,
            secret_access_key,
        },
        database_url,
    })
}

fn is_endpoint(text: &str) -> bool {
    let Ok(url) = Url::parse(text) else { return false };
    matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some()
        && url.query().is_none()
        && url.fragment().is_none()
        && url.username().is_empty()
        && url.password().is_none()
}

// The rules of S3 for bucket names: 3 to 63 lowercase letters, digits, dots, and hyphens,
// starting and ending with a letter or a digit.
fn is_bucket_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    let edge = |byte: u8| byte.is_ascii_lowercase() || byte.is_ascii_digit();
    (3..=63).contains(&bytes.len())
        && bytes.iter().all(|byte| edge(*byte) || *byte == b'.' || *byte == b'-')
        && edge(bytes[0])
        && edge(bytes[bytes.len() - 1])
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn complete() -> HashMap<&'static str, &'static str> {
        HashMap::from([
            ("DATABASE_URL", "postgres://albireo:secret@db:5432/albireo"),
            ("S3_ENDPOINT", "https://s3.example.com"),
            ("S3_REGION", "us-east-1"),
            ("S3_BUCKET", "albireo-videos"),
            ("S3_URL_STYLE", "path"),
            ("S3_ACCESS_KEY_ID", "AKIDEXAMPLE"),
            ("S3_SECRET_ACCESS_KEY", "secret"),
        ])
    }

    fn read(vars: &HashMap<&str, &str>) -> Result<Config, Vec<String>> {
        read_config(|name| vars.get(name).map(|value| value.to_string()))
    }

    #[test]
    fn reads_the_settings() {
        let config = read(&complete()).unwrap();
        assert_eq!(config.storage.bucket, "albireo-videos");
        assert_eq!(config.storage.url_style, UrlStyle::Path);
        assert_eq!(config.database_url, "postgres://albireo:secret@db:5432/albireo");
    }

    #[test]
    fn names_every_missing_variable_with_an_instruction() {
        let problems = read(&HashMap::new()).unwrap_err();
        assert_eq!(problems.len(), SETTING_NAMES.len());
        for (problem, name) in problems.iter().zip(SETTING_NAMES) {
            assert!(problem.starts_with(&format!("Please set {name} to ")), "{problem}");
        }
    }

    #[test]
    fn refuses_malformed_values() {
        let mut vars = complete();
        vars.insert("S3_ENDPOINT", "s3.example.com");
        vars.insert("S3_BUCKET", "Albireo_Videos");
        vars.insert("S3_URL_STYLE", "Path");
        vars.insert("DATABASE_URL", "mysql://db");
        let problems = read(&vars).unwrap_err();
        assert_eq!(problems.len(), 4, "{problems:?}");
    }
}

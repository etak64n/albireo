//! Copies of the database in the bucket. `albireo backup` writes one, and `albireo restore`
//! loads one into an empty database.
//!
//! A copy is SQL that psql also reads, compressed with gzip: a COPY statement for each table of
//! albireo, followed by its rows in the text format of COPY. Its first lines are comments, and
//! one of them holds the version of albireo and the migrations of the database that it comes from.
//! The copy of every table comes from one snapshot of the database, so it is the library as it
//! was at one moment, while albireo keeps serving.

use std::io;
use std::path::Path;

use async_compression::tokio::bufread::GzipDecoder;
use async_compression::tokio::write::GzipEncoder;
use axum::body::Body;
use axum::http::{HeaderMap, StatusCode};
use futures_util::{StreamExt, TryStreamExt};
use serde::{Deserialize, Serialize};
use sqlx::{AssertSqlSafe, PgPool, Postgres, Transaction};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio_util::io::{ReaderStream, StreamReader};

use crate::db::{applied_migrations, known_migrations};
use crate::ids::random_id;
use crate::repo::people;
use crate::storage::{ObjectStore, StorageError};
use crate::time::{Time, iso};

/// The tables of albireo, in an order that puts every row after the rows that it refers to.
pub const TABLES: [&str; 12] = [
    "users",
    "setup_codes",
    "sessions",
    "invitations",
    "series",
    "videos",
    "watch_history",
    "comments",
    "ratings",
    "attachments",
    "playlists",
    "playlist_videos",
];

/// Copies go under this prefix of the bucket, which the files of the library never use, and
/// which albireo never serves.
pub const PREFIX: &str = "backups/";
pub const CONTENT_TYPE: &str = "application/gzip";
/// The line of a copy that holds what it is, after this mark.
const INFO_MARK: &str = "-- albireo-copy: ";
const FORMAT: u32 = 1;
const VERSION: &str = env!("CARGO_PKG_VERSION");
/// The rows of a table go to PostgreSQL in chunks of about this many bytes.
const CHUNK_BYTES: usize = 1024 * 1024;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CopyInfo {
    format: u32,
    albireo_version: String,
    created_at: String,
    migrations: Vec<i64>,
}

#[derive(Debug, thiserror::Error)]
pub enum BackupError {
    /// Something that the person who runs albireo must change, in an instruction that starts with "Please".
    #[error("{0}")]
    Refused(String),
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Storage(#[from] StorageError),
    #[error(transparent)]
    Io(#[from] io::Error),
}

/// What `albireo backup` wrote.
#[derive(Debug)]
pub struct CopySummary {
    pub key: String,
    pub bytes: u64,
    pub rows: u64,
}

/// What `albireo restore` loaded.
#[derive(Debug)]
pub struct RestoreSummary {
    pub tables: usize,
    pub rows: u64,
}

/// Whether the key names a copy that `albireo backup` writes.
pub fn is_copy_key(key: &str) -> bool {
    key.strip_prefix(PREFIX).is_some_and(|name| {
        !name.is_empty() && name.ends_with(".sql.gz") && name.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
    })
}

/// The key of a copy made at the moment, such as backups/albireo-20261114T031500Z.sql.gz.
pub fn copy_key(now: Time) -> String {
    format!("{PREFIX}albireo-{}.sql.gz", now.format("%Y%m%dT%H%M%SZ"))
}

/// The columns of a table, in their order.
async fn columns_of(transaction: &mut Transaction<'_, Postgres>, table: &str) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT column_name::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position",
    )
    .bind(table)
    .fetch_all(&mut **transaction)
    .await
}

/// Writes a copy of the database to the bucket, through a file of its own in the folder of
/// temporary files, which goes away after.
pub async fn write_copy(db: &PgPool, store: &dyn ObjectStore, now: Time) -> Result<CopySummary, BackupError> {
    let path = std::env::temp_dir().join(format!("albireo-copy-{}.sql.gz", random_id()));
    let result = write_copy_through(db, store, now, &path).await;
    let _ = tokio::fs::remove_file(&path).await;
    result
}

async fn write_copy_through(db: &PgPool, store: &dyn ObjectStore, now: Time, path: &Path) -> Result<CopySummary, BackupError> {
    let mut transaction = db.begin().await?;
    // One snapshot for every table, so that the rows of a table match those of the others.
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        .execute(&mut *transaction)
        .await?;
    let migrations = applied_migrations(&mut transaction).await?;
    if migrations != known_migrations() {
        return Err(BackupError::Refused(format!(
            "Please run albireo backup with the version of albireo that serves the database. The database has the migrations {migrations:?}, and albireo {VERSION} has {:?}.",
            known_migrations()
        )));
    }

    let mut file = GzipEncoder::new(BufWriter::new(tokio::fs::File::create(path).await?));
    let info = CopyInfo {
        format: FORMAT,
        albireo_version: VERSION.into(),
        created_at: iso(&now),
        migrations,
    };
    let header = format!(
        "-- A copy of the database of albireo. albireo restore loads it into an empty database.\n{INFO_MARK}{}\n\n",
        serde_json::to_string(&info).expect("the information of a copy is JSON")
    );
    file.write_all(header.as_bytes()).await?;
    let mut rows = 0;
    for table in TABLES {
        let columns = columns_of(&mut transaction, table).await?.join(", ");
        file.write_all(format!("COPY public.{table} ({columns}) FROM stdin;\n").as_bytes())
            .await?;
        let mut stream = transaction
            .copy_out_raw(&format!("COPY public.{table} ({columns}) TO STDOUT"))
            .await?;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            // Each row ends with a newline, and a newline in a value is written as \n.
            rows += chunk.iter().filter(|byte| **byte == b'\n').count() as u64;
            file.write_all(&chunk).await?;
        }
        drop(stream);
        file.write_all(b"\\.\n\n").await?;
    }
    file.shutdown().await?;
    transaction.rollback().await?;

    let key = copy_key(now);
    let bytes = tokio::fs::metadata(path).await?.len();
    let body = Body::from_stream(ReaderStream::new(tokio::fs::File::open(path).await?));
    store.put_object(&key, CONTENT_TYPE, body, bytes, &[]).await?;
    Ok(CopySummary { key, bytes, rows })
}

/// Reads the next line, or None at the end of the copy.
async fn next_line(reader: &mut (impl AsyncBufRead + Unpin), line: &mut Vec<u8>) -> Result<bool, io::Error> {
    line.clear();
    Ok(reader.read_until(b'\n', line).await? > 0)
}

fn not_a_copy(key: &str) -> BackupError {
    BackupError::Refused(format!(
        "Please name a copy that albireo backup wrote: {key} does not start with the line that names a copy of albireo."
    ))
}

/// A table and its columns, from a line such as `COPY public.users (id, email) FROM stdin;`.
fn copy_statement(line: &str) -> Option<(&str, Vec<&str>)> {
    let rest = line.strip_prefix("COPY public.")?.strip_suffix(") FROM stdin;")?;
    let (table, columns) = rest.split_once(" (")?;
    let columns: Vec<&str> = columns.split(", ").collect();
    let identifier = |name: &str| {
        !name.is_empty()
            && name
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
    };
    (identifier(table) && columns.iter().all(|column| identifier(column))).then_some((table, columns))
}

/// Loads a copy from the bucket into a database that has no library yet. albireo applies its
/// migrations to the database first. The copy goes in in one transaction, so the database ends
/// with the whole copy or with nothing.
pub async fn restore_copy(db: &PgPool, store: &dyn ObjectStore, key: &str) -> Result<RestoreSummary, BackupError> {
    if !is_copy_key(key) {
        return Err(BackupError::Refused(format!(
            "Please name a copy under {PREFIX} that ends with .sql.gz, such as {}. It is now {key:?}.",
            copy_key(chrono::DateTime::UNIX_EPOCH)
        )));
    }
    let answer = store
        .get_object(key, false, &HeaderMap::new())
        .await?
        .filter(|answer| answer.status == StatusCode::OK)
        .ok_or_else(|| BackupError::Refused(format!("Please name a copy that is in the bucket: {key} is not there.")))?;
    let stream = answer.body.into_data_stream().map_err(io::Error::other);
    let mut reader = BufReader::new(GzipDecoder::new(StreamReader::new(stream)));
    let mut line = Vec::new();

    // The copy starts with comments, one of which says what it is.
    let mut info = None;
    while info.is_none() {
        if !next_line(&mut reader, &mut line).await? || !line.starts_with(b"--") {
            return Err(not_a_copy(key));
        }
        if let Some(json) = std::str::from_utf8(&line)
            .ok()
            .and_then(|text| text.trim_end().strip_prefix(INFO_MARK))
        {
            info = Some(serde_json::from_str::<CopyInfo>(json).map_err(|_| not_a_copy(key))?);
        }
    }
    let info = info.expect("the loop ends with the information");
    if info.format != FORMAT || info.migrations != known_migrations() {
        return Err(BackupError::Refused(format!(
            "Please restore this copy with albireo {}, which made it, and then start the version that you want, which updates the database. The copy has the migrations {:?}, and albireo {VERSION} has {:?}.",
            info.albireo_version,
            info.migrations,
            known_migrations()
        )));
    }

    let mut transaction = db.begin().await?;
    // Nobody can create the first admin while the people of the copy go in.
    people::lock_people(&mut transaction).await?;
    for table in TABLES.iter().filter(|table| **table != "setup_codes") {
        let found: bool = sqlx::query_scalar(AssertSqlSafe(format!("SELECT EXISTS (SELECT 1 FROM public.{table})")))
            .fetch_one(&mut *transaction)
            .await?;
        if found {
            return Err(BackupError::Refused(format!(
                "Please restore into an empty database: the database of DATABASE_URL has rows in {table} already. Create a new database, and set DATABASE_URL to it."
            )));
        }
    }
    // A server that started on the empty database wrote a setup code, which the copy replaces.
    sqlx::query("DELETE FROM setup_codes").execute(&mut *transaction).await?;

    let mut loaded: Vec<&str> = Vec::new();
    let mut rows = 0;
    while next_line(&mut reader, &mut line).await? {
        let text = String::from_utf8_lossy(&line);
        let text = text.trim_end();
        if text.is_empty() || text.starts_with("--") {
            continue;
        }
        let Some((table, columns)) = copy_statement(text) else {
            return Err(BackupError::Refused(format!(
                "Please name a copy that albireo backup wrote: {key} holds a line that is no COPY statement of albireo: {text:?}."
            )));
        };
        let Some(table) = TABLES.iter().copied().find(|known| *known == table && !loaded.contains(known)) else {
            return Err(BackupError::Refused(format!(
                "Please name a copy that albireo backup wrote: {key} holds the table {table:?} twice, or a table that albireo does not have."
            )));
        };
        let known = columns_of(&mut transaction, table).await?;
        if let Some(column) = columns.iter().find(|column| !known.iter().any(|name| name == *column)) {
            return Err(BackupError::Refused(format!(
                "Please restore this copy with the version of albireo that made it: the table {table} of this albireo has no column {column}."
            )));
        }

        let mut copy = transaction
            .copy_in_raw(&format!("COPY public.{table} ({}) FROM STDIN", columns.join(", ")))
            .await?;
        let mut chunk = Vec::with_capacity(CHUNK_BYTES);
        loop {
            if !next_line(&mut reader, &mut line).await? {
                copy.abort("the copy ends inside a table").await?;
                return Err(BackupError::Refused(format!(
                    "Please restore a whole copy: {key} ends inside the rows of {table}."
                )));
            }
            if line == b"\\.\n" {
                break;
            }
            rows += 1;
            chunk.extend_from_slice(&line);
            if chunk.len() >= CHUNK_BYTES {
                copy.send(chunk.as_slice()).await?;
                chunk.clear();
            }
        }
        if !chunk.is_empty() {
            copy.send(chunk.as_slice()).await?;
        }
        copy.finish().await?;
        loaded.push(table);
    }
    if let Some(missing) = TABLES.iter().find(|table| !loaded.contains(table)) {
        return Err(BackupError::Refused(format!(
            "Please restore a whole copy: {key} has no rows of the table {missing}."
        )));
    }
    // A trigger counts each comment as it goes in, on top of the counts that the copy holds.
    sqlx::query(
        "UPDATE videos SET comment_count = (SELECT COUNT(*) FROM comments WHERE comments.video_id = videos.id), \
         attachment_count = (SELECT COUNT(*) FROM attachments WHERE attachments.video_id = videos.id AND attachments.status = 'ready')",
    )
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(RestoreSummary {
        tables: loaded.len(),
        rows,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_copies_by_their_time() {
        let time = chrono::DateTime::parse_from_rfc3339("2026-11-14T03:15:00Z").unwrap().to_utc();
        assert_eq!(copy_key(time), "backups/albireo-20261114T031500Z.sql.gz");
        assert!(is_copy_key("backups/albireo-20261114T031500Z.sql.gz"));
        for key in [
            "backups/",
            "backups/../videos/x.sql.gz",
            "videos/albireo.sql.gz",
            "backups/albireo.sql",
            "backups/a b.sql.gz",
        ] {
            assert!(!is_copy_key(key), "{key}");
        }
    }

    #[test]
    fn reads_the_copy_statements_of_albireo_only() {
        assert_eq!(
            copy_statement("COPY public.users (id, email) FROM stdin;"),
            Some(("users", vec!["id", "email"]))
        );
        assert_eq!(copy_statement("COPY public.users (id; DROP TABLE x) FROM stdin;"), None);
        assert_eq!(copy_statement("DROP TABLE users;"), None);
        assert_eq!(copy_statement("COPY other.users (id) FROM stdin;"), None);
    }
}

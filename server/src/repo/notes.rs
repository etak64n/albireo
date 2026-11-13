//! Reads and writes what people add to a video: comments, ratings, and attachments.

use sqlx::{FromRow, PgPool, Postgres, QueryBuilder};

use crate::repo::videos::ListCursor;
use crate::time::Time;

#[derive(Clone, Debug, FromRow)]
pub struct CommentRecord {
    pub id: String,
    pub video_id: String,
    pub author_id: String,
    pub author_name: String,
    pub author_avatar_key: Option<String>,
    pub author_updated_at: Time,
    pub body: String,
    pub created_at: Time,
}

// Every read joins the author, so that the list shows names without one query per comment.
macro_rules! comment_select {
    () => {
        "SELECT c.id, c.video_id, c.author_id, u.display_name AS author_name, u.avatar_key AS author_avatar_key, \
         u.updated_at AS author_updated_at, c.body, c.created_at FROM comments c JOIN users u ON u.id = c.author_id"
    };
}

pub async fn insert_comment(db: &PgPool, id: &str, video_id: &str, author_id: &str, body: &str, now: Time) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO comments (id, video_id, author_id, body, created_at) VALUES ($1, $2, $3, $4, $5)")
        .bind(id)
        .bind(video_id)
        .bind(author_id)
        .bind(body)
        .bind(now)
        .execute(db)
        .await?;
    Ok(())
}

pub async fn find_comment(db: &PgPool, id: &str) -> Result<Option<CommentRecord>, sqlx::Error> {
    sqlx::query_as(concat!(comment_select!(), " WHERE c.id = $1"))
        .bind(id)
        .fetch_optional(db)
        .await
}

/// The comments on a video, from the newest, starting after the cursor.
pub async fn list_comments(db: &PgPool, video_id: &str, limit: i64, after: Option<&ListCursor>) -> Result<Vec<CommentRecord>, sqlx::Error> {
    let mut query = QueryBuilder::<Postgres>::new(concat!(comment_select!(), " WHERE c.video_id = "));
    query.push_bind(video_id.to_string());
    if let Some(after) = after {
        query
            .push(" AND (c.created_at, c.id) < (")
            .push_bind(after.time)
            .push(", ")
            .push_bind(after.id.clone())
            .push(")");
    }
    query.push(" ORDER BY c.created_at DESC, c.id DESC LIMIT ").push_bind(limit);
    query.build_query_as().fetch_all(db).await
}

pub async fn delete_comment(db: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM comments WHERE id = $1").bind(id).execute(db).await?;
    Ok(result.rows_affected() > 0)
}

/// The ratings of a video, and the stars of one person.
#[derive(Clone, Debug, FromRow)]
pub struct RatingSummary {
    /// The mean of everyone's stars, or None when nobody rated the video.
    pub average: Option<f64>,
    pub count: i64,
    /// The stars of the one person asked about, or None when they did not rate the video.
    pub mine: Option<i32>,
}

pub async fn rating_summary(db: &PgPool, video_id: &str, user_id: &str) -> Result<RatingSummary, sqlx::Error> {
    sqlx::query_as(
        "SELECT AVG(stars)::float8 AS average, COUNT(*) AS count, \
         (SELECT stars FROM ratings WHERE video_id = $1 AND user_id = $2) AS mine FROM ratings WHERE video_id = $1",
    )
    .bind(video_id)
    .bind(user_id)
    .fetch_one(db)
    .await
}

/// Gives the video the stars, in place of the person's earlier rating.
pub async fn set_rating(db: &PgPool, video_id: &str, user_id: &str, stars: i32, now: Time) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO ratings (video_id, user_id, stars, rated_at) VALUES ($1, $2, $3, $4) \
         ON CONFLICT (video_id, user_id) DO UPDATE SET stars = EXCLUDED.stars, rated_at = EXCLUDED.rated_at",
    )
    .bind(video_id)
    .bind(user_id)
    .bind(stars)
    .bind(now)
    .execute(db)
    .await?;
    recount_ratings(db, video_id).await
}

pub async fn clear_rating(db: &PgPool, video_id: &str, user_id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM ratings WHERE video_id = $1 AND user_id = $2")
        .bind(video_id)
        .bind(user_id)
        .execute(db)
        .await?;
    recount_ratings(db, video_id).await
}

/// Keeps the number of ratings of the video and their average on the video, which the list of
/// all videos sorts by. It reads the ratings of this one video only.
async fn recount_ratings(db: &PgPool, video_id: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE videos SET rating_count = (SELECT COUNT(*) FROM ratings WHERE video_id = $1), \
         rating_score = COALESCE((SELECT SUM(stars) * 1000 / COUNT(*) FROM ratings WHERE video_id = $1), 0) WHERE id = $1",
    )
    .bind(video_id)
    .execute(db)
    .await?;
    Ok(())
}

#[derive(Clone, Debug, FromRow)]
pub struct AttachmentRecord {
    pub id: String,
    pub video_id: String,
    pub file_name: String,
    pub content_type: String,
    pub file_size: i64,
    /// 'uploading' or 'ready'.
    pub status: String,
    pub created_at: Time,
}

macro_rules! attachment_select {
    () => {
        "SELECT id, video_id, file_name, content_type, file_size, status, created_at FROM attachments"
    };
}

pub async fn insert_attachment(
    db: &PgPool,
    id: &str,
    video_id: &str,
    file_name: &str,
    content_type: &str,
    file_size: i64,
    now: Time,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO attachments (id, video_id, file_name, content_type, file_size, status, created_at) \
         VALUES ($1, $2, $3, $4, $5, 'uploading', $6)",
    )
    .bind(id)
    .bind(video_id)
    .bind(file_name)
    .bind(content_type)
    .bind(file_size)
    .bind(now)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn find_attachment(db: &PgPool, id: &str) -> Result<Option<AttachmentRecord>, sqlx::Error> {
    sqlx::query_as(concat!(attachment_select!(), " WHERE id = $1"))
        .bind(id)
        .fetch_optional(db)
        .await
}

/// The ready attachments of a video, in the order that they were attached.
pub async fn list_ready_attachments(db: &PgPool, video_id: &str) -> Result<Vec<AttachmentRecord>, sqlx::Error> {
    sqlx::query_as(concat!(
        attachment_select!(),
        " WHERE video_id = $1 AND status = 'ready' ORDER BY created_at, id"
    ))
    .bind(video_id)
    .fetch_all(db)
    .await
}

/// Every attachment of a video, also the ones that still upload, whose files can be in the bucket already.
pub async fn list_all_attachments(db: &PgPool, video_id: &str) -> Result<Vec<AttachmentRecord>, sqlx::Error> {
    sqlx::query_as(concat!(attachment_select!(), " WHERE video_id = $1 ORDER BY created_at, id"))
        .bind(video_id)
        .fetch_all(db)
        .await
}

/// Records the size that the bucket reports and shows the attachment.
pub async fn mark_attachment_ready(db: &PgPool, id: &str, file_size: i64) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("UPDATE attachments SET status = 'ready', file_size = $1 WHERE id = $2 AND status = 'uploading'")
        .bind(file_size)
        .bind(id)
        .execute(db)
        .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn delete_attachment(db: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM attachments WHERE id = $1").bind(id).execute(db).await?;
    Ok(result.rows_affected() > 0)
}

// The types that browsers show or open. Other files, HTML and SVG among them, download as plain
// bytes, so that nothing that a person uploads runs as a page.
pub fn content_type_of(file_name: &str) -> &'static str {
    let extension = file_name.rsplit_once('.').map(|(_, extension)| extension.to_lowercase());
    match extension.as_deref() {
        Some("pdf") => "application/pdf",
        Some("ppt") => "application/vnd.ms-powerpoint",
        Some("pptx") => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        Some("doc") => "application/msword",
        Some("docx") => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        Some("xls") => "application/vnd.ms-excel",
        Some("xlsx") => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        Some("key") => "application/vnd.apple.keynote",
        Some("md" | "markdown") => "text/markdown; charset=utf-8",
        Some("txt") => "text/plain; charset=utf-8",
        Some("csv") => "text/csv; charset=utf-8",
        Some("json") => "application/json",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("zip") => "application/zip",
        _ => "application/octet-stream",
    }
}

/// The Content-Disposition that makes the browser save the file under its name. Old browsers read
/// the ASCII name, in which other characters become underscores.
pub fn download_disposition(file_name: &str) -> String {
    let ascii: String = file_name
        .chars()
        .map(|c| {
            if (' '..='~').contains(&c) && c != '"' && c != '\\' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let mut encoded = String::new();
    for byte in file_name.bytes() {
        let unreserved = byte.is_ascii_alphanumeric() || b"-_.!~".contains(&byte);
        if unreserved {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    format!("attachment; filename=\"{ascii}\"; filename*=UTF-8''{encoded}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_the_type_from_the_extension_and_keeps_pages_from_running() {
        assert_eq!(content_type_of("notes.md"), "text/markdown; charset=utf-8");
        assert_eq!(
            content_type_of("Deck.PPTX"),
            "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        );
        assert_eq!(content_type_of("page.html"), "application/octet-stream");
        assert_eq!(content_type_of("README"), "application/octet-stream");
    }

    #[test]
    fn names_a_download_in_ascii_and_in_utf8() {
        assert_eq!(
            download_disposition("Slides.pdf"),
            "attachment; filename=\"Slides.pdf\"; filename*=UTF-8''Slides.pdf"
        );
        assert_eq!(
            download_disposition("資料 \"最終\".pptx"),
            "attachment; filename=\"__ ____.pptx\"; filename*=UTF-8''%E8%B3%87%E6%96%99%20%22%E6%9C%80%E7%B5%82%22.pptx"
        );
    }
}

//! Reads and writes the videos table, and the watch history that points at it. Deleting a video
//! also deletes the rows of the other tables that point at it.

use sqlx::{FromRow, PgPool, Postgres, QueryBuilder};

use crate::time::Time;

#[derive(Clone, Debug, FromRow)]
pub struct VideoRecord {
    pub id: String,
    pub title: String,
    pub description: String,
    /// 'uploading' or 'ready'.
    pub status: String,
    pub object_key: String,
    pub upload_id: Option<String>,
    pub content_type: String,
    pub file_size: i64,
    pub part_size: i64,
    pub part_count: i32,
    pub duration_sec: Option<f64>,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub thumbnail_key: Option<String>,
    pub created_at: Time,
    pub updated_at: Time,
    pub uploader_id: Option<String>,
    pub uploader_name: Option<String>,
    pub uploader_avatar_key: Option<String>,
    pub uploader_updated_at: Option<Time>,
    pub series_id: Option<String>,
    pub series_title: Option<String>,
    pub series_position: Option<i32>,
    pub rating_count: i32,
    /// The average stars times 1000, rounded down, and 0 when nobody rated the video.
    pub rating_score: i32,
    pub comment_count: i32,
    pub attachment_count: i32,
}

impl VideoRecord {
    pub fn is_ready(&self) -> bool {
        self.status == "ready"
    }
}

/// A ready video with the last time that one person watched it.
#[derive(Clone, Debug, FromRow)]
pub struct WatchedVideoRecord {
    #[sqlx(flatten)]
    pub video: VideoRecord,
    pub watched_at: Time,
}

/// A ready video of a playlist with its place there.
#[derive(Clone, Debug, FromRow)]
pub struct PlaylistVideoRecord {
    #[sqlx(flatten)]
    pub video: VideoRecord,
    pub playlist_position: i32,
}

/// Position in a list that runs by time, from the newest or from the oldest.
#[derive(Clone, Debug, PartialEq)]
pub struct ListCursor {
    pub time: Time,
    pub id: String,
}

/// Position in the list of ready videos that runs from the highest rated.
#[derive(Clone, Debug, PartialEq)]
pub struct RatingCursor {
    pub score: i32,
    pub count: i32,
    pub created_at: Time,
    pub id: String,
}

pub struct NewUpload<'a> {
    pub id: &'a str,
    pub title: &'a str,
    pub object_key: &'a str,
    pub upload_id: &'a str,
    pub content_type: &'a str,
    pub file_size: i64,
    pub part_size: i64,
    pub part_count: i32,
    pub created_at: Time,
    pub uploader_id: &'a str,
    pub series_id: Option<&'a str>,
}

pub struct MediaInfo {
    pub duration_sec: Option<f64>,
    pub width: Option<i32>,
    pub height: Option<i32>,
}

// Every read joins the uploader and the series, so that lists show their names without one
// query per video.
macro_rules! columns {
    () => {
        "v.id, v.title, v.description, v.status, v.object_key, v.upload_id, v.content_type, v.file_size, \
         v.part_size, v.part_count, v.duration_sec, v.width, v.height, v.thumbnail_key, v.created_at, \
         v.updated_at, v.uploader_id, u.display_name AS uploader_name, u.avatar_key AS uploader_avatar_key, \
         u.updated_at AS uploader_updated_at, v.series_id, s.title AS series_title, v.series_position, \
         v.rating_count, v.rating_score, v.comment_count, v.attachment_count"
    };
}

macro_rules! joins {
    () => {
        " LEFT JOIN users u ON u.id = v.uploader_id LEFT JOIN series s ON s.id = v.series_id"
    };
}

macro_rules! select {
    () => {
        concat!("SELECT ", columns!(), " FROM videos v", joins!())
    };
}

/// Adds an upload in progress. A video in a series becomes its last episode.
pub async fn insert_uploading(db: &PgPool, video: &NewUpload<'_>) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO videos (id, title, description, status, object_key, upload_id, content_type, file_size, part_size, \
         part_count, created_at, updated_at, uploader_id, series_id, series_position) \
         VALUES ($1, $2, '', 'uploading', $3, $4, $5, $6, $7, $8, $9, $9, $10, $11, \
         CASE WHEN $11::text IS NULL THEN NULL ELSE (SELECT COALESCE(MAX(series_position), 0) + 1 FROM videos WHERE series_id = $11) END)",
    )
    .bind(video.id)
    .bind(video.title)
    .bind(video.object_key)
    .bind(video.upload_id)
    .bind(video.content_type)
    .bind(video.file_size)
    .bind(video.part_size)
    .bind(video.part_count)
    .bind(video.created_at)
    .bind(video.uploader_id)
    .bind(video.series_id)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn find(db: &PgPool, id: &str) -> Result<Option<VideoRecord>, sqlx::Error> {
    sqlx::query_as(concat!(select!(), " WHERE v.id = $1"))
        .bind(id)
        .fetch_optional(db)
        .await
}

/// Lists ready videos from the newest or from the oldest, starting after the cursor. The cursor
/// compares as one row value, so that the query starts at it in the index and a later page reads
/// no more rows than the first.
pub async fn list_ready(
    db: &PgPool,
    limit: i64,
    after: Option<&ListCursor>,
    uploader_id: Option<&str>,
    oldest_first: bool,
) -> Result<Vec<VideoRecord>, sqlx::Error> {
    let mut query = QueryBuilder::<Postgres>::new(concat!(select!(), " WHERE v.status = 'ready'"));
    if let Some(uploader_id) = uploader_id {
        query.push(" AND v.uploader_id = ").push_bind(uploader_id.to_string());
    }
    if let Some(after) = after {
        query.push(if oldest_first {
            " AND (v.created_at, v.id) > ("
        } else {
            " AND (v.created_at, v.id) < ("
        });
        query.push_bind(after.time).push(", ").push_bind(after.id.clone()).push(")");
    }
    query.push(if oldest_first {
        " ORDER BY v.created_at ASC, v.id ASC LIMIT "
    } else {
        " ORDER BY v.created_at DESC, v.id DESC LIMIT "
    });
    query.push_bind(limit);
    query.build_query_as().fetch_all(db).await
}

/// Lists ready videos from the highest average rating, starting after the cursor: more ratings
/// first among equal averages, then the newest. The videos that nobody rated come last.
pub async fn list_by_rating(db: &PgPool, limit: i64, after: Option<&RatingCursor>) -> Result<Vec<VideoRecord>, sqlx::Error> {
    let mut query = QueryBuilder::<Postgres>::new(concat!(select!(), " WHERE v.status = 'ready'"));
    if let Some(after) = after {
        query.push(" AND (v.rating_score, v.rating_count, v.created_at, v.id) < (");
        query.push_bind(after.score).push(", ").push_bind(after.count).push(", ");
        query.push_bind(after.created_at).push(", ").push_bind(after.id.clone()).push(")");
    }
    query
        .push(" ORDER BY v.rating_score DESC, v.rating_count DESC, v.created_at DESC, v.id DESC LIMIT ")
        .push_bind(limit);
    query.build_query_as().fetch_all(db).await
}

/// Picks ready videos at random. The IDs are random, so the videos from a random place among
/// them, in the order of their IDs, are a random pick; past the last ID, the pick goes on from
/// the first. The index videos_status_id holds this order, so it reads about one row a video.
pub async fn sample_ready(db: &PgPool, limit: i64, start: &str) -> Result<Vec<VideoRecord>, sqlx::Error> {
    let mut picked: Vec<VideoRecord> = sqlx::query_as(concat!(
        select!(),
        " WHERE v.status = 'ready' AND v.id >= $1 ORDER BY v.id LIMIT $2"
    ))
    .bind(start)
    .bind(limit)
    .fetch_all(db)
    .await?;
    if (picked.len() as i64) < limit {
        let rest: Vec<VideoRecord> = sqlx::query_as(concat!(select!(), " WHERE v.status = 'ready' AND v.id < $1 ORDER BY v.id LIMIT $2"))
            .bind(start)
            .bind(limit - picked.len() as i64)
            .fetch_all(db)
            .await?;
        picked.extend(rest);
    }
    Ok(picked)
}

/// Records that a person watched a video now. A video appears once in a history, at its last time.
pub async fn record_watch(db: &PgPool, user_id: &str, video_id: &str, now: Time) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO watch_history (user_id, video_id, watched_at) VALUES ($1, $2, $3) \
         ON CONFLICT (user_id, video_id) DO UPDATE SET watched_at = EXCLUDED.watched_at",
    )
    .bind(user_id)
    .bind(video_id)
    .bind(now)
    .execute(db)
    .await?;
    Ok(())
}

/// The ready videos that a person watched, from the last watched, starting after the cursor.
pub async fn list_watched(
    db: &PgPool,
    user_id: &str,
    limit: i64,
    after: Option<&ListCursor>,
) -> Result<Vec<WatchedVideoRecord>, sqlx::Error> {
    let mut query = QueryBuilder::<Postgres>::new(concat!(
        "SELECT ",
        columns!(),
        ", h.watched_at FROM watch_history h JOIN videos v ON v.id = h.video_id",
        joins!(),
        " WHERE v.status = 'ready' AND h.user_id = "
    ));
    query.push_bind(user_id.to_string());
    if let Some(after) = after {
        query
            .push(" AND (h.watched_at, h.video_id) < (")
            .push_bind(after.time)
            .push(", ")
            .push_bind(after.id.clone())
            .push(")");
    }
    query.push(" ORDER BY h.watched_at DESC, h.video_id DESC LIMIT ").push_bind(limit);
    query.build_query_as().fetch_all(db).await
}

/// A LIKE pattern that finds the text anywhere, with its own % and _ as plain characters.
pub fn contains_pattern(text: &str) -> String {
    let escaped = text.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
    format!("%{escaped}%")
}

/// The ready videos whose title or description contains every term, ignoring case: those whose
/// title contains every term first, then from the newest. The trigram indexes look up terms of
/// three or more characters; shorter terms are checked in the rows that the others leave.
pub async fn search(db: &PgPool, terms: &[String], limit: i64, offset: i64) -> Result<Vec<VideoRecord>, sqlx::Error> {
    let patterns: Vec<String> = terms.iter().map(|term| contains_pattern(term)).collect();
    let mut query = QueryBuilder::<Postgres>::new(concat!(select!(), " WHERE v.status = 'ready'"));
    for pattern in &patterns {
        query
            .push(" AND (v.title ILIKE ")
            .push_bind(pattern.clone())
            .push(" OR v.description ILIKE ")
            .push_bind(pattern.clone())
            .push(")");
    }
    query.push(" ORDER BY CASE WHEN TRUE");
    for pattern in &patterns {
        query.push(" AND v.title ILIKE ").push_bind(pattern.clone());
    }
    query
        .push(" THEN 0 ELSE 1 END, v.created_at DESC, v.id DESC LIMIT ")
        .push_bind(limit)
        .push(" OFFSET ")
        .push_bind(offset);
    query.build_query_as().fetch_all(db).await
}

/// The ready episodes of a series, in their order.
pub async fn list_episodes(db: &PgPool, series_id: &str) -> Result<Vec<VideoRecord>, sqlx::Error> {
    sqlx::query_as(concat!(
        select!(),
        " WHERE v.series_id = $1 AND v.status = 'ready' ORDER BY v.series_position, v.id"
    ))
    .bind(series_id)
    .fetch_all(db)
    .await
}

/// The ready videos of a playlist, in their order.
pub async fn list_in_playlist(db: &PgPool, playlist_id: &str) -> Result<Vec<PlaylistVideoRecord>, sqlx::Error> {
    sqlx::query_as(concat!(
        "SELECT ",
        columns!(),
        ", pv.position AS playlist_position FROM playlist_videos pv JOIN videos v ON v.id = pv.video_id",
        joins!(),
        " WHERE pv.playlist_id = $1 AND v.status = 'ready' ORDER BY pv.position, pv.video_id"
    ))
    .bind(playlist_id)
    .fetch_all(db)
    .await
}

/// Takes every video of a series out of it, the ones that still upload included, so the series
/// can go. The videos stay in the library.
pub async fn leave_series(db: &PgPool, series_id: &str, now: Time) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE videos SET series_id = NULL, series_position = NULL, updated_at = $1 WHERE series_id = $2")
        .bind(now)
        .bind(series_id)
        .execute(db)
        .await?;
    Ok(())
}

/// Moves a video to the end of a series, or out of its series when series_id is None.
pub async fn set_series(db: &PgPool, id: &str, series_id: Option<&str>, now: Time) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE videos SET series_id = $1, series_position = CASE WHEN $1::text IS NULL THEN NULL ELSE \
         (SELECT COALESCE(MAX(series_position), 0) + 1 FROM videos WHERE series_id = $1) END, updated_at = $2 WHERE id = $3",
    )
    .bind(series_id)
    .bind(now)
    .bind(id)
    .execute(db)
    .await?;
    Ok(result.rows_affected() == 1)
}

/// Swaps the places of two episodes of the same series in one statement.
pub async fn swap_episodes(db: &PgPool, first: &VideoRecord, second: &VideoRecord) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE videos SET series_position = CASE id WHEN $1 THEN $2 WHEN $3 THEN $4 END \
         WHERE id IN ($1, $3) AND series_id = $5",
    )
    .bind(&first.id)
    .bind(second.series_position)
    .bind(&second.id)
    .bind(first.series_position)
    .bind(&first.series_id)
    .execute(db)
    .await?;
    Ok(())
}

/// Marks an uploading video as ready. Returns false when no uploading video has the ID.
pub async fn mark_ready(db: &PgPool, id: &str, media: &MediaInfo, now: Time) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE videos SET status = 'ready', upload_id = NULL, duration_sec = $1, width = $2, height = $3, updated_at = $4 \
         WHERE id = $5 AND status = 'uploading'",
    )
    .bind(media.duration_sec)
    .bind(media.width)
    .bind(media.height)
    .bind(now)
    .bind(id)
    .execute(db)
    .await?;
    Ok(result.rows_affected() == 1)
}

/// Changes the title, the description, or both of a ready video.
pub async fn update_details(db: &PgPool, id: &str, title: Option<&str>, description: Option<&str>, now: Time) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE videos SET title = COALESCE($1, title), description = COALESCE($2, description), updated_at = $3 \
         WHERE id = $4 AND status = 'ready'",
    )
    .bind(title)
    .bind(description)
    .bind(now)
    .bind(id)
    .execute(db)
    .await?;
    Ok(result.rows_affected() == 1)
}

pub async fn set_thumbnail(db: &PgPool, id: &str, key: &str, now: Time) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("UPDATE videos SET thumbnail_key = $1, updated_at = $2 WHERE id = $3 AND status = 'ready'")
        .bind(key)
        .bind(now)
        .bind(id)
        .execute(db)
        .await?;
    Ok(result.rows_affected() == 1)
}

/// Deletes a video and every row that points at it: its places in the histories and the
/// playlists, its comments, its ratings, and its attachments. One transaction, so the database
/// deletes all of the rows or none of them.
pub async fn delete(db: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let mut transaction = db.begin().await?;
    for statement in [
        "DELETE FROM watch_history WHERE video_id = $1",
        "DELETE FROM playlist_videos WHERE video_id = $1",
        "DELETE FROM comments WHERE video_id = $1",
        "DELETE FROM ratings WHERE video_id = $1",
        "DELETE FROM attachments WHERE video_id = $1",
    ] {
        sqlx::query(statement).bind(id).execute(&mut *transaction).await?;
    }
    let result = sqlx::query("DELETE FROM videos WHERE id = $1")
        .bind(id)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    Ok(result.rows_affected() == 1)
}

/// Deletes the row of an upload that never completed.
pub async fn delete_uploading(db: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM videos WHERE id = $1 AND status = 'uploading'")
        .bind(id)
        .execute(db)
        .await?;
    Ok(result.rows_affected() == 1)
}

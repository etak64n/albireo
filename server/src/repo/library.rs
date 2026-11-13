//! Reads and writes the series and the playlists. The episodes of a series are the videos whose
//! series_id names it, and playlist_videos puts videos in playlists; repo/videos.rs reads both in
//! their order.

use sqlx::{FromRow, PgPool};

use crate::time::Time;

/// A series or a playlist, with its owner and its cover: the thumbnail of its first ready video
/// that has one.
#[derive(Clone, Debug, FromRow)]
pub struct CollectionRecord {
    pub id: String,
    pub title: String,
    pub description: String,
    pub owner_id: String,
    pub owner_name: String,
    pub owner_avatar_key: Option<String>,
    pub owner_updated_at: Time,
    pub cover_key: Option<String>,
    pub cover_updated_at: Option<Time>,
    pub created_at: Time,
    pub updated_at: Time,
}

/// A playlist of one person, and whether it holds a given video.
#[derive(Clone, Debug, FromRow)]
pub struct PlaylistChoiceRecord {
    pub id: String,
    pub title: String,
    pub has_video: bool,
}

macro_rules! series_select {
    () => {
        "SELECT s.id, s.title, s.description, s.owner_id, u.display_name AS owner_name, u.avatar_key AS owner_avatar_key, \
         u.updated_at AS owner_updated_at, cover.thumbnail_key AS cover_key, cover.updated_at AS cover_updated_at, \
         s.created_at, s.updated_at \
         FROM series s JOIN users u ON u.id = s.owner_id \
         LEFT JOIN LATERAL (SELECT v.thumbnail_key, v.updated_at FROM videos v \
           WHERE v.series_id = s.id AND v.status = 'ready' AND v.thumbnail_key IS NOT NULL \
           ORDER BY v.series_position, v.id LIMIT 1) cover ON TRUE"
    };
}

macro_rules! playlist_select {
    () => {
        "SELECT p.id, p.title, p.description, p.owner_id, u.display_name AS owner_name, u.avatar_key AS owner_avatar_key, \
         u.updated_at AS owner_updated_at, cover.thumbnail_key AS cover_key, cover.updated_at AS cover_updated_at, \
         p.created_at, p.updated_at \
         FROM playlists p JOIN users u ON u.id = p.owner_id \
         LEFT JOIN LATERAL (SELECT v.thumbnail_key, v.updated_at FROM playlist_videos pv JOIN videos v ON v.id = pv.video_id \
           WHERE pv.playlist_id = p.id AND v.status = 'ready' AND v.thumbnail_key IS NOT NULL \
           ORDER BY pv.position, pv.video_id LIMIT 1) cover ON TRUE"
    };
}

pub async fn insert_series(db: &PgPool, id: &str, title: &str, description: &str, owner_id: &str, now: Time) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO series (id, title, description, owner_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)")
        .bind(id)
        .bind(title)
        .bind(description)
        .bind(owner_id)
        .bind(now)
        .execute(db)
        .await?;
    Ok(())
}

pub async fn find_series(db: &PgPool, id: &str) -> Result<Option<CollectionRecord>, sqlx::Error> {
    sqlx::query_as(concat!(series_select!(), " WHERE s.id = $1"))
        .bind(id)
        .fetch_optional(db)
        .await
}

/// Lists every series, or the series of one owner, from the one that changed last.
pub async fn list_series(db: &PgPool, owner_id: Option<&str>) -> Result<Vec<CollectionRecord>, sqlx::Error> {
    sqlx::query_as(concat!(
        series_select!(),
        " WHERE ($1::text IS NULL OR s.owner_id = $1) ORDER BY s.updated_at DESC, s.id DESC"
    ))
    .bind(owner_id)
    .fetch_all(db)
    .await
}

pub async fn update_series(db: &PgPool, id: &str, title: Option<&str>, description: Option<&str>, now: Time) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE series SET title = COALESCE($1, title), description = COALESCE($2, description), updated_at = $3 WHERE id = $4",
    )
    .bind(title)
    .bind(description)
    .bind(now)
    .bind(id)
    .execute(db)
    .await?;
    Ok(result.rows_affected() == 1)
}

/// Records that the episodes of a series changed, so the series moves to the front of the list.
pub async fn touch_series(db: &PgPool, id: &str, now: Time) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE series SET updated_at = $1 WHERE id = $2")
        .bind(now)
        .bind(id)
        .execute(db)
        .await?;
    Ok(())
}

/// Deletes a series that no video belongs to any more (videos::leave_series).
pub async fn delete_series(db: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM series WHERE id = $1").bind(id).execute(db).await?;
    Ok(result.rows_affected() == 1)
}

pub async fn insert_playlist(db: &PgPool, id: &str, title: &str, description: &str, owner_id: &str, now: Time) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO playlists (id, title, description, owner_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)")
        .bind(id)
        .bind(title)
        .bind(description)
        .bind(owner_id)
        .bind(now)
        .execute(db)
        .await?;
    Ok(())
}

pub async fn find_playlist(db: &PgPool, id: &str) -> Result<Option<CollectionRecord>, sqlx::Error> {
    sqlx::query_as(concat!(playlist_select!(), " WHERE p.id = $1"))
        .bind(id)
        .fetch_optional(db)
        .await
}

/// Lists every playlist, or the playlists of one owner, from the one that changed last.
pub async fn list_playlists(db: &PgPool, owner_id: Option<&str>) -> Result<Vec<CollectionRecord>, sqlx::Error> {
    sqlx::query_as(concat!(
        playlist_select!(),
        " WHERE ($1::text IS NULL OR p.owner_id = $1) ORDER BY p.updated_at DESC, p.id DESC"
    ))
    .bind(owner_id)
    .fetch_all(db)
    .await
}

/// The playlists of one owner, from the one that changed last, each with whether it holds the video.
pub async fn playlist_choices(db: &PgPool, owner_id: &str, video_id: &str) -> Result<Vec<PlaylistChoiceRecord>, sqlx::Error> {
    sqlx::query_as(
        "SELECT p.id, p.title, EXISTS (SELECT 1 FROM playlist_videos pv WHERE pv.playlist_id = p.id AND pv.video_id = $1) AS has_video \
         FROM playlists p WHERE p.owner_id = $2 ORDER BY p.updated_at DESC, p.id DESC",
    )
    .bind(video_id)
    .bind(owner_id)
    .fetch_all(db)
    .await
}

pub async fn update_playlist(
    db: &PgPool,
    id: &str,
    title: Option<&str>,
    description: Option<&str>,
    now: Time,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE playlists SET title = COALESCE($1, title), description = COALESCE($2, description), updated_at = $3 WHERE id = $4",
    )
    .bind(title)
    .bind(description)
    .bind(now)
    .bind(id)
    .execute(db)
    .await?;
    Ok(result.rows_affected() == 1)
}

/// Puts a video at the end of a playlist, and moves the playlist to the front of the lists.
/// Returns false when the playlist holds the video already.
pub async fn add_to_playlist(db: &PgPool, playlist_id: &str, video_id: &str, now: Time) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "INSERT INTO playlist_videos (playlist_id, video_id, position, added_at) \
         VALUES ($1, $2, (SELECT COALESCE(MAX(position), 0) + 1 FROM playlist_videos WHERE playlist_id = $1), $3) \
         ON CONFLICT (playlist_id, video_id) DO NOTHING",
    )
    .bind(playlist_id)
    .bind(video_id)
    .bind(now)
    .execute(db)
    .await?;
    if result.rows_affected() != 1 {
        return Ok(false);
    }
    touch_playlist(db, playlist_id, now).await?;
    Ok(true)
}

/// Takes a video out of a playlist. Returns false when the playlist does not hold it.
pub async fn remove_from_playlist(db: &PgPool, playlist_id: &str, video_id: &str, now: Time) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM playlist_videos WHERE playlist_id = $1 AND video_id = $2")
        .bind(playlist_id)
        .bind(video_id)
        .execute(db)
        .await?;
    if result.rows_affected() != 1 {
        return Ok(false);
    }
    touch_playlist(db, playlist_id, now).await?;
    Ok(true)
}

/// Swaps the places of two videos of a playlist in one statement.
pub async fn swap_in_playlist(db: &PgPool, playlist_id: &str, first: (&str, i32), second: (&str, i32)) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE playlist_videos SET position = CASE video_id WHEN $1 THEN $2 WHEN $3 THEN $4 END \
         WHERE playlist_id = $5 AND video_id IN ($1, $3)",
    )
    .bind(first.0)
    .bind(second.1)
    .bind(second.0)
    .bind(first.1)
    .bind(playlist_id)
    .execute(db)
    .await?;
    Ok(())
}

/// Records that the videos of a playlist changed, so the playlist moves to the front of the lists.
pub async fn touch_playlist(db: &PgPool, id: &str, now: Time) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE playlists SET updated_at = $1 WHERE id = $2")
        .bind(now)
        .bind(id)
        .execute(db)
        .await?;
    Ok(())
}

/// Deletes a playlist. Its videos stay in the library. One transaction, so the database deletes
/// both or neither.
pub async fn delete_playlist(db: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let mut transaction = db.begin().await?;
    sqlx::query("DELETE FROM playlist_videos WHERE playlist_id = $1")
        .bind(id)
        .execute(&mut *transaction)
        .await?;
    let result = sqlx::query("DELETE FROM playlists WHERE id = $1")
        .bind(id)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    Ok(result.rows_affected() == 1)
}

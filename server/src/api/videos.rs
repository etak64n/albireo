//! Videos: the lists, a video and its edits, its upload through albireo, its thumbnail, its
//! attachments, its comments and ratings, search, and the files of the library.

use std::collections::{HashMap, HashSet};

use axum::Extension;
use axum::body::{Body, Bytes};
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, header};
use axum::response::Response;
use serde_json::{Value, json};

use super::account::{IMAGE_CONTENT_TYPE, IMAGE_MAX_BYTES};
use super::{
    AppState, decode_cursor, decode_rating_cursor, encode_cursor, encode_rating_cursor, file_length, json_response, no_content, path_id,
    require_content_type,
};
use crate::auth::Viewer;
use crate::error::{ApiError, AppError, AppResult};
use crate::ids::{is_id, random_id};
use crate::json::{
    Rule, read_array, read_integer, read_nullable_id, read_nullable_number, read_object, read_optional_nullable_id, read_optional_string,
    read_string, text_length, whole_number,
};
use crate::log::{Level, error_fields, log};
use crate::model::{
    EpisodeLink, FILES_PATH, VideoComment, VideoDetail, VideoSeries, WatchedVideo, attachment_key, attachment_of, file_url, summary_of,
    uploader_of, versioned_url,
};
use crate::repo::library;
use crate::repo::notes::{self, AttachmentRecord, CommentRecord, content_type_of, download_disposition};
use crate::repo::videos::{self, ListCursor, MediaInfo, NewUpload, RatingCursor, VideoRecord, WatchedVideoRecord};
use crate::security::file_headers;
use crate::shared::{
    ATTACHMENT_MAX_BYTES, ATTACHMENT_NAME_MAX_LENGTH, COMMENT_MAX_LENGTH, DESCRIPTION_MAX_LENGTH, LIST_PAGE_SIZE, MAX_OBJECT_SIZE,
    MAX_PART_URLS_PER_REQUEST, RATING_MAX_STARS, SEARCH_QUERY_MAX_LENGTH, TITLE_MAX_LENGTH, plan_parts,
};
use crate::storage::CompletedPart;
use crate::time::{iso, now};

const FILE_NAME_MAX_LENGTH: usize = 1024;
const ETAG_MAX_LENGTH: usize = 256;
const MAX_DURATION_SEC: f64 = 10_000_000.0;
const MAX_DIMENSION: f64 = 100_000.0;
// Recommendations look at this many of the newest videos and of the last watched ones, and
// continue this many series. The home page shows 48 of them.
const RECOMMENDATION_POOL: i64 = 100;
const SERIES_TO_CONTINUE: usize = 8;
// A search takes at most this many words, and pages reach at most this far into the results.
const SEARCH_MAX_TERMS: usize = 10;
const SEARCH_MAX_OFFSET: i64 = 10_000;

pub fn can_edit_video(viewer: &Viewer, video: &VideoRecord) -> bool {
    viewer.is_admin() || video.uploader_id.as_deref() == Some(viewer.id())
}

fn can_delete_comment(viewer: &Viewer, comment: &CommentRecord, video: Option<&VideoRecord>) -> bool {
    viewer.is_admin() || comment.author_id == viewer.id() || video.is_some_and(|video| video.uploader_id.as_deref() == Some(viewer.id()))
}

fn thumbnail_key(video_id: &str) -> String {
    format!("thumbnails/{video_id}.jpg")
}

fn is_video_type(content_type: &str) -> bool {
    content_type.strip_prefix("video/").is_some_and(|subtype| {
        !subtype.is_empty() && subtype.len() <= 100 && subtype.bytes().all(|byte| byte.is_ascii_alphanumeric() || b".+-".contains(&byte))
    })
}

fn extension_of(file_name: &str) -> String {
    match file_name.rsplit_once('.') {
        Some((_, extension)) if (1..=10).contains(&extension.len()) && extension.bytes().all(|byte| byte.is_ascii_alphanumeric()) => {
            format!(".{}", extension.to_ascii_lowercase())
        }
        _ => String::new(),
    }
}

pub async fn find_ready(state: &AppState, id: &str) -> AppResult<VideoRecord> {
    let id = path_id(id, "video")?;
    videos::find(&state.db, &id)
        .await?
        .filter(VideoRecord::is_ready)
        .ok_or_else(|| ApiError::not_found("No ready video has this ID.").into())
}

/// Where a video sits in its series. The episode number counts ready videos only.
async fn series_of(state: &AppState, video: &VideoRecord) -> AppResult<Option<VideoSeries>> {
    let Some(series_id) = &video.series_id else { return Ok(None) };
    let Some(series) = library::find_series(&state.db, series_id).await? else {
        return Ok(None);
    };
    let episodes = videos::list_episodes(&state.db, series_id).await?;
    let Some(index) = episodes.iter().position(|episode| episode.id == video.id) else {
        return Ok(None);
    };
    let link = |episode: Option<&VideoRecord>| {
        episode.map(|episode| EpisodeLink {
            id: episode.id.clone(),
            title: episode.title.clone(),
        })
    };
    Ok(Some(VideoSeries {
        id: series.id,
        title: series.title,
        episode: index + 1,
        previous: link(index.checked_sub(1).and_then(|previous| episodes.get(previous))),
        next: link(episodes.get(index + 1)),
    }))
}

pub async fn detail_of(state: &AppState, video: &VideoRecord, viewer: &Viewer) -> AppResult<VideoDetail> {
    let rating = notes::rating_summary(&state.db, &video.id, viewer.id()).await?;
    let attachments = notes::list_ready_attachments(&state.db, &video.id).await?;
    Ok(VideoDetail {
        id: video.id.clone(),
        title: video.title.clone(),
        description: video.description.clone(),
        duration_sec: video.duration_sec,
        width: video.width,
        height: video.height,
        file_size: video.file_size,
        content_type: video.content_type.clone(),
        created_at: iso(&video.created_at),
        updated_at: iso(&video.updated_at),
        playback_url: file_url(&video.object_key),
        thumbnail_url: versioned_url(video.thumbnail_key.as_deref(), &video.updated_at),
        uploader: uploader_of(video),
        series: series_of(state, video).await?,
        rating: rating.into(),
        attachments: attachments.iter().map(attachment_of).collect(),
        can_edit: can_edit_video(viewer, video),
    })
}

async fn detail_response(state: &AppState, id: &str, viewer: &Viewer) -> AppResult<Response> {
    let video = find_ready(state, id).await?;
    Ok(json_response(
        StatusCode::OK,
        json!({ "video": detail_of(state, &video, viewer).await? }),
    ))
}

fn page_and_cursor<T>(mut rows: Vec<T>, cursor: impl Fn(&T) -> String) -> (Vec<T>, Option<String>) {
    let more = rows.len() as i64 > LIST_PAGE_SIZE;
    rows.truncate(LIST_PAGE_SIZE as usize);
    let next = if more { rows.last().map(cursor) } else { None };
    (rows, next)
}

/// The history of the person, from the last watched. Nobody sees the history of someone else.
pub async fn history(
    State(state): State<AppState>,
    Extension(viewer): Extension<Viewer>,
    Query(query): Query<HashMap<String, String>>,
) -> AppResult<Response> {
    let after = query.get("cursor").map(|cursor| decode_cursor(cursor)).transpose()?;
    let rows = videos::list_watched(&state.db, viewer.id(), LIST_PAGE_SIZE + 1, after.as_ref()).await?;
    let (page, next) = page_and_cursor(rows, |row| {
        encode_cursor(&ListCursor {
            time: row.watched_at,
            id: row.video.id.clone(),
        })
    });
    let videos: Vec<WatchedVideo> = page
        .iter()
        .map(|row| WatchedVideo {
            summary: summary_of(&row.video),
            watched_at: iso(&row.watched_at),
        })
        .collect();
    Ok(json_response(StatusCode::OK, json!({ "videos": videos, "nextCursor": next })))
}

/// Orders videos for one person, from the most likely to be wanted:
/// 1. the next episode of each series that they are watching, from the series watched last,
/// 2. the videos that they have not watched, first those of the series and the uploaders that
///    they watched before, then from the newest,
/// 3. the videos that they watched, from the one watched longest ago.
async fn recommend(state: &AppState, recent: Vec<VideoRecord>, history: Vec<WatchedVideoRecord>) -> AppResult<Vec<VideoRecord>> {
    let watched: HashSet<&str> = history.iter().map(|row| row.video.id.as_str()).collect();
    let mut picked: HashSet<String> = HashSet::new();
    let mut result: Vec<VideoRecord> = Vec::new();
    let mut take = |video: &VideoRecord, result: &mut Vec<VideoRecord>| {
        if picked.insert(video.id.clone()) {
            result.push(video.clone());
        }
    };

    // The history runs from the last watched, so the first video of a series in it is the episode watched last.
    let mut last_watched: Vec<(String, String)> = Vec::new();
    for row in &history {
        if let Some(series_id) = &row.video.series_id
            && !last_watched.iter().any(|(series, _)| series == series_id)
        {
            last_watched.push((series_id.clone(), row.video.id.clone()));
        }
    }
    for (series_id, video_id) in last_watched.iter().take(SERIES_TO_CONTINUE) {
        let episodes = videos::list_episodes(&state.db, series_id).await?;
        let start = episodes
            .iter()
            .position(|episode| &episode.id == video_id)
            .map_or(0, |index| index + 1);
        if let Some(next) = episodes[start.min(episodes.len())..]
            .iter()
            .find(|episode| !watched.contains(episode.id.as_str()))
        {
            take(next, &mut result);
        }
    }

    let familiar_series: HashSet<&str> = last_watched.iter().map(|(series, _)| series.as_str()).collect();
    let familiar_uploaders: HashSet<&str> = history.iter().filter_map(|row| row.video.uploader_id.as_deref()).collect();
    let familiarity = |video: &VideoRecord| {
        (if video.series_id.as_deref().is_some_and(|series| familiar_series.contains(series)) {
            2
        } else {
            0
        }) + (if video
            .uploader_id
            .as_deref()
            .is_some_and(|uploader| familiar_uploaders.contains(uploader))
        {
            1
        } else {
            0
        })
    };
    let mut fresh: Vec<(usize, &VideoRecord)> = recent
        .iter()
        .filter(|video| !watched.contains(video.id.as_str()))
        .enumerate()
        .collect();
    fresh.sort_by(|(a_newness, a), (b_newness, b)| familiarity(b).cmp(&familiarity(a)).then(a_newness.cmp(b_newness)));
    for (_, video) in fresh {
        take(video, &mut result);
    }
    for row in history.iter().rev() {
        take(&row.video, &mut result);
    }
    Ok(result)
}

pub async fn recommendations(State(state): State<AppState>, Extension(viewer): Extension<Viewer>) -> AppResult<Response> {
    let recent = videos::list_ready(&state.db, RECOMMENDATION_POOL, None, None, false).await?;
    let history = videos::list_watched(&state.db, viewer.id(), RECOMMENDATION_POOL, None).await?;
    let picks = recommend(&state, recent, history).await?;
    let videos: Vec<_> = picks.iter().take(LIST_PAGE_SIZE as usize).map(summary_of).collect();
    Ok(json_response(StatusCode::OK, json!({ "videos": videos })))
}

/// Videos at random from the whole library, for Home between its recommendations. It reads about one page of videos.
pub async fn random(State(state): State<AppState>) -> AppResult<Response> {
    let mut picks = videos::sample_ready(&state.db, LIST_PAGE_SIZE, &random_id()).await?;
    // Shuffles the pick, with the random bytes of the operating system.
    for index in (1..picks.len()).rev() {
        let mut bytes = [0u8; 4];
        getrandom::fill(&mut bytes).map_err(|error| AppError::Internal(error.to_string()))?;
        let other = u32::from_le_bytes(bytes) as usize % (index + 1);
        picks.swap(index, other);
    }
    let videos: Vec<_> = picks.iter().map(summary_of).collect();
    Ok(json_response(StatusCode::OK, json!({ "videos": videos })))
}

/// The player calls this when playback starts, so the video moves to the front of the history.
pub async fn watched(State(state): State<AppState>, Extension(viewer): Extension<Viewer>, Path(id): Path<String>) -> AppResult<Response> {
    let video = find_ready(&state, &id).await?;
    videos::record_watch(&state.db, viewer.id(), &video.id, now()).await?;
    Ok(no_content())
}

/// Every order reads one page from an index, starting at the cursor.
pub async fn list(State(state): State<AppState>, Query(query): Query<HashMap<String, String>>) -> AppResult<Response> {
    let sort = query.get("sort").map_or("newest", String::as_str);
    let uploader = query.get("uploader");
    if uploader.is_some_and(|uploader| !is_id(uploader)) {
        return Err(ApiError::bad_request("uploader must be a user ID.").into());
    }
    if !matches!(sort, "newest" | "oldest" | "rating") {
        return Err(ApiError::bad_request("sort must be one of newest, oldest, rating.").into());
    }
    if uploader.is_some() && sort != "newest" {
        return Err(ApiError::bad_request("The videos of one person list from the newest only.").into());
    }
    let cursor = query.get("cursor");
    let (page, next) = if sort == "rating" {
        let after = cursor.map(|cursor| decode_rating_cursor(cursor)).transpose()?;
        let rows = videos::list_by_rating(&state.db, LIST_PAGE_SIZE + 1, after.as_ref()).await?;
        page_and_cursor(rows, |video| {
            encode_rating_cursor(&RatingCursor {
                score: video.rating_score,
                count: video.rating_count,
                created_at: video.created_at,
                id: video.id.clone(),
            })
        })
    } else {
        let after = cursor.map(|cursor| decode_cursor(cursor)).transpose()?;
        let rows = videos::list_ready(
            &state.db,
            LIST_PAGE_SIZE + 1,
            after.as_ref(),
            uploader.map(String::as_str),
            sort == "oldest",
        )
        .await?;
        page_and_cursor(rows, |video| {
            encode_cursor(&ListCursor {
                time: video.created_at,
                id: video.id.clone(),
            })
        })
    };
    let videos: Vec<_> = page.iter().map(summary_of).collect();
    Ok(json_response(StatusCode::OK, json!({ "videos": videos, "nextCursor": next })))
}

pub async fn detail(State(state): State<AppState>, Extension(viewer): Extension<Viewer>, Path(id): Path<String>) -> AppResult<Response> {
    detail_response(&state, &id, &viewer).await
}

pub async fn edit(
    State(state): State<AppState>,
    Extension(viewer): Extension<Viewer>,
    Path(id): Path<String>,
    body: Bytes,
) -> AppResult<Response> {
    let body = read_object(&body, &["title", "description", "seriesId"])?;
    let title = read_optional_string(
        &body,
        "title",
        Rule {
            min: 1,
            max: TITLE_MAX_LENGTH,
            trim: true,
        },
    )?;
    let description = read_optional_string(
        &body,
        "description",
        Rule {
            min: 0,
            max: DESCRIPTION_MAX_LENGTH,
            trim: false,
        },
    )?;
    let series_id = read_optional_nullable_id(&body, "seriesId")?;
    if title.is_none() && description.is_none() && series_id.is_none() {
        return Err(ApiError::bad_request("Send a title, a description, a seriesId, or more than one of them.").into());
    }
    let video = find_ready(&state, &id).await?;
    if !can_edit_video(&viewer, &video) {
        return Err(ApiError::forbidden("Only the uploader of the video or an admin can edit it.").into());
    }
    let now = now();
    if title.is_some() || description.is_some() {
        videos::update_details(&state.db, &video.id, title.as_deref(), description.as_deref(), now).await?;
    }
    if let Some(series_id) = series_id
        && series_id != video.series_id
    {
        if let Some(series_id) = &series_id
            && library::find_series(&state.db, series_id).await?.is_none()
        {
            return Err(ApiError::bad_request("No series has this seriesId.").into());
        }
        videos::set_series(&state.db, &video.id, series_id.as_deref(), now).await?;
        for changed in [video.series_id.as_ref(), series_id.as_ref()].into_iter().flatten() {
            library::touch_series(&state.db, changed, now).await?;
        }
    }
    detail_response(&state, &video.id, &viewer).await
}

/// Deletes a video for good, with its files in the bucket: the video, its thumbnail, and its
/// attachments. The files go first, so a deletion that stops halfway leaves the video in the
/// library, and deleting it again finishes the work.
pub async fn remove(State(state): State<AppState>, Extension(viewer): Extension<Viewer>, Path(id): Path<String>) -> AppResult<Response> {
    let video = find_ready(&state, &id).await?;
    if !can_edit_video(&viewer, &video) {
        return Err(ApiError::forbidden("Only the uploader of the video or an admin can delete it.").into());
    }
    let attachments = notes::list_all_attachments(&state.db, &video.id).await?;
    // The key of a thumbnail never changes, so this also deletes one that was sent and never committed.
    let mut keys = vec![video.object_key.clone(), thumbnail_key(&video.id)];
    keys.extend(attachments.iter().map(|attachment| attachment_key(&video.id, &attachment.id)));
    for key in &keys {
        state.store.delete_object(key).await?;
    }
    videos::delete(&state.db, &video.id).await?;
    if let Some(series_id) = &video.series_id {
        library::touch_series(&state.db, series_id, now()).await?;
    }
    log(
        Level::Info,
        "Video deleted",
        &[("videoId", Value::String(video.id.clone())), ("files", Value::from(keys.len()))],
    );
    Ok(no_content())
}

/// Each person gives a video 1 to 5 stars, or takes their rating back.
pub async fn rate(
    State(state): State<AppState>,
    Extension(viewer): Extension<Viewer>,
    Path(id): Path<String>,
    body: Bytes,
) -> AppResult<Response> {
    let body = read_object(&body, &["stars"])?;
    let stars = read_integer(&body, "stars", 1, RATING_MAX_STARS)?;
    let video = find_ready(&state, &id).await?;
    notes::set_rating(&state.db, &video.id, viewer.id(), stars as i32, now()).await?;
    let rating: crate::model::VideoRating = notes::rating_summary(&state.db, &video.id, viewer.id()).await?.into();
    Ok(json_response(StatusCode::OK, json!({ "rating": rating })))
}

pub async fn clear_rating(
    State(state): State<AppState>,
    Extension(viewer): Extension<Viewer>,
    Path(id): Path<String>,
) -> AppResult<Response> {
    let video = find_ready(&state, &id).await?;
    notes::clear_rating(&state.db, &video.id, viewer.id()).await?;
    let rating: crate::model::VideoRating = notes::rating_summary(&state.db, &video.id, viewer.id()).await?.into();
    Ok(json_response(StatusCode::OK, json!({ "rating": rating })))
}

fn comment_of(comment: &CommentRecord, video: Option<&VideoRecord>, viewer: &Viewer) -> VideoComment {
    VideoComment {
        id: comment.id.clone(),
        body: comment.body.clone(),
        created_at: iso(&comment.created_at),
        author: crate::model::UserSummary {
            id: comment.author_id.clone(),
            display_name: comment.author_name.clone(),
            avatar_url: versioned_url(comment.author_avatar_key.as_deref(), &comment.author_updated_at),
        },
        can_delete: can_delete_comment(viewer, comment, video),
    }
}

pub async fn comments(
    State(state): State<AppState>,
    Extension(viewer): Extension<Viewer>,
    Path(id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> AppResult<Response> {
    let video = find_ready(&state, &id).await?;
    let after = query.get("cursor").map(|cursor| decode_cursor(cursor)).transpose()?;
    let rows = notes::list_comments(&state.db, &video.id, LIST_PAGE_SIZE + 1, after.as_ref()).await?;
    let (page, next) = page_and_cursor(rows, |comment| {
        encode_cursor(&ListCursor {
            time: comment.created_at,
            id: comment.id.clone(),
        })
    });
    let comments: Vec<VideoComment> = page.iter().map(|comment| comment_of(comment, Some(&video), &viewer)).collect();
    Ok(json_response(StatusCode::OK, json!({ "comments": comments, "nextCursor": next })))
}

pub async fn post_comment(
    State(state): State<AppState>,
    Extension(viewer): Extension<Viewer>,
    Path(id): Path<String>,
    body: Bytes,
) -> AppResult<Response> {
    let body = read_object(&body, &["body"])?;
    let text = read_string(
        &body,
        "body",
        Rule {
            min: 1,
            max: COMMENT_MAX_LENGTH,
            trim: true,
        },
    )?;
    let video = find_ready(&state, &id).await?;
    let comment_id = random_id();
    notes::insert_comment(&state.db, &comment_id, &video.id, viewer.id(), &text, now()).await?;
    let comment = notes::find_comment(&state.db, &comment_id)
        .await?
        .ok_or_else(|| AppError::Internal(format!("The new comment {comment_id} is missing.")))?;
    Ok(json_response(
        StatusCode::CREATED,
        json!({ "comment": comment_of(&comment, Some(&video), &viewer) }),
    ))
}

pub async fn delete_comment(
    State(state): State<AppState>,
    Extension(viewer): Extension<Viewer>,
    Path(id): Path<String>,
) -> AppResult<Response> {
    let comment = notes::find_comment(&state.db, &path_id(&id, "comment")?)
        .await?
        .ok_or_else(|| ApiError::not_found("No comment has this ID."))?;
    let video = videos::find(&state.db, &comment.video_id).await?;
    if !can_delete_comment(&viewer, &comment, video.as_ref()) {
        return Err(ApiError::forbidden("Only the author of the comment, the uploader of the video, or an admin can delete it.").into());
    }
    notes::delete_comment(&state.db, &comment.id).await?;
    Ok(no_content())
}

/// Only the uploader of the video and admins send, commit, and remove its attachments.
async fn find_attachment(state: &AppState, id: &str, viewer: &Viewer) -> AppResult<AttachmentRecord> {
    let attachment = notes::find_attachment(&state.db, &path_id(id, "attachment")?)
        .await?
        .ok_or_else(|| ApiError::not_found("No attachment has this ID."))?;
    let video = videos::find(&state.db, &attachment.video_id).await?;
    if !video.is_some_and(|video| can_edit_video(viewer, &video)) {
        return Err(ApiError::forbidden("Only the uploader of the video or an admin can change its attachments.").into());
    }
    Ok(attachment)
}

/// The browser sends an attachment to the URL of the answer, then commits it.
pub async fn start_attachment(
    State(state): State<AppState>,
    Extension(viewer): Extension<Viewer>,
    Path(id): Path<String>,
    body: Bytes,
) -> AppResult<Response> {
    let body = read_object(&body, &["fileName", "fileSize"])?;
    let file_name = read_string(
        &body,
        "fileName",
        Rule {
            min: 1,
            max: ATTACHMENT_NAME_MAX_LENGTH,
            trim: true,
        },
    )?;
    let file_size = read_integer(&body, "fileSize", 0, ATTACHMENT_MAX_BYTES)?;
    let video = find_ready(&state, &id).await?;
    if !can_edit_video(&viewer, &video) {
        return Err(ApiError::forbidden("Only the uploader of the video or an admin can attach files to it.").into());
    }
    let attachment_id = random_id();
    let content_type = content_type_of(&file_name);
    notes::insert_attachment(&state.db, &attachment_id, &video.id, &file_name, content_type, file_size, now()).await?;
    Ok(json_response(
        StatusCode::CREATED,
        json!({ "attachmentId": attachment_id, "url": format!("/api/attachments/{attachment_id}/file"), "contentType": content_type }),
    ))
}

/// Writes the file of an attachment to the bucket as it arrives: as many bytes as were announced.
pub async fn put_attachment(
    State(state): State<AppState>,
    Extension(viewer): Extension<Viewer>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Body,
) -> AppResult<Response> {
    let attachment = find_attachment(&state, &id, &viewer).await?;
    if attachment.status != "uploading" {
        return Err(ApiError::conflict("The attachment is already committed.").into());
    }
    let length = file_length(&headers, attachment.file_size, attachment.file_size)?;
    state
        .store
        .put_object(
            &attachment_key(&attachment.video_id, &attachment.id),
            &attachment.content_type,
            body,
            length,
            &[],
        )
        .await?;
    Ok(no_content())
}

pub async fn commit_attachment(
    State(state): State<AppState>,
    Extension(viewer): Extension<Viewer>,
    Path(id): Path<String>,
) -> AppResult<Response> {
    let attachment = find_attachment(&state, &id, &viewer).await?;
    if attachment.status != "uploading" {
        return Err(ApiError::conflict("The attachment is already committed.").into());
    }
    let object = state
        .store
        .head_object(&attachment_key(&attachment.video_id, &attachment.id))
        .await?
        .ok_or_else(|| ApiError::conflict("The file is not in the bucket. Send it to its URL first."))?;
    if object.size as i64 > ATTACHMENT_MAX_BYTES {
        return Err(ApiError::bad_request(format!("Attachments can be at most {ATTACHMENT_MAX_BYTES} bytes.")).into());
    }
    notes::mark_attachment_ready(&state.db, &attachment.id, object.size as i64).await?;
    let ready = AttachmentRecord {
        status: "ready".into(),
        file_size: object.size as i64,
        ..attachment
    };
    Ok(json_response(StatusCode::OK, json!({ "attachment": attachment_of(&ready) })))
}

pub async fn remove_attachment(
    State(state): State<AppState>,
    Extension(viewer): Extension<Viewer>,
    Path(id): Path<String>,
) -> AppResult<Response> {
    let attachment = find_attachment(&state, &id, &viewer).await?;
    state
        .store
        .delete_object(&attachment_key(&attachment.video_id, &attachment.id))
        .await?;
    notes::delete_attachment(&state.db, &attachment.id).await?;
    Ok(no_content())
}

/// The words of a query are separated by spaces, also the wide space of Japanese text. The cursor
/// of a search is how many results the earlier pages held.
pub async fn search(State(state): State<AppState>, Query(query): Query<HashMap<String, String>>) -> AppResult<Response> {
    let text = query.get("q").map_or("", |q| q.trim());
    if text.is_empty() || text_length(text) > SEARCH_QUERY_MAX_LENGTH {
        return Err(ApiError::bad_request(format!("q must be 1 to {SEARCH_QUERY_MAX_LENGTH} characters long.")).into());
    }
    let mut terms: Vec<String> = Vec::new();
    for term in text.split_whitespace() {
        if !terms.iter().any(|known| known == term) {
            terms.push(term.to_string());
        }
    }
    if terms.len() > SEARCH_MAX_TERMS {
        return Err(ApiError::bad_request(format!("q can have at most {SEARCH_MAX_TERMS} words.")).into());
    }
    let offset = match query.get("cursor") {
        None => 0,
        Some(cursor) => cursor
            .parse::<i64>()
            .ok()
            .filter(|offset| {
                (0..=SEARCH_MAX_OFFSET).contains(offset) && cursor.len() <= 6 && cursor.bytes().all(|byte| byte.is_ascii_digit())
            })
            .ok_or_else(|| ApiError::bad_request("cursor must be a cursor that the API returned."))?,
    };
    let rows = videos::search(&state.db, &terms, LIST_PAGE_SIZE + 1, offset).await?;
    let next = (rows.len() as i64 > LIST_PAGE_SIZE).then(|| (offset + LIST_PAGE_SIZE).to_string());
    let videos: Vec<_> = rows.iter().take(LIST_PAGE_SIZE as usize).map(summary_of).collect();
    Ok(json_response(StatusCode::OK, json!({ "videos": videos, "nextCursor": next })))
}

pub async fn start_upload(State(state): State<AppState>, Extension(viewer): Extension<Viewer>, body: Bytes) -> AppResult<Response> {
    let body = read_object(&body, &["title", "fileName", "fileSize", "contentType", "seriesId"])?;
    let title = read_string(
        &body,
        "title",
        Rule {
            min: 1,
            max: TITLE_MAX_LENGTH,
            trim: true,
        },
    )?;
    let file_name = read_string(
        &body,
        "fileName",
        Rule {
            min: 1,
            max: FILE_NAME_MAX_LENGTH,
            trim: false,
        },
    )?;
    let file_size = read_integer(&body, "fileSize", 1, MAX_OBJECT_SIZE)?;
    let content_type = read_string(
        &body,
        "contentType",
        Rule {
            min: 1,
            max: 120,
            trim: false,
        },
    )?;
    let series_id = read_nullable_id(&body, "seriesId")?;
    if !is_video_type(&content_type) {
        return Err(ApiError::bad_request("contentType must be a video type, such as video/mp4.").into());
    }
    if let Some(series_id) = &series_id
        && library::find_series(&state.db, series_id).await?.is_none()
    {
        return Err(ApiError::bad_request("No series has this seriesId.").into());
    }
    let (part_size, part_count) = plan_parts(file_size).map_err(ApiError::bad_request)?;
    let id = random_id();
    let object_key = format!("videos/{id}/original{}", extension_of(&file_name));
    let upload_id = state.store.create_multipart_upload(&object_key, &content_type).await?;
    videos::insert_uploading(
        &state.db,
        &NewUpload {
            id: &id,
            title: &title,
            object_key: &object_key,
            upload_id: &upload_id,
            content_type: &content_type,
            file_size,
            part_size,
            part_count: part_count as i32,
            created_at: now(),
            uploader_id: viewer.id(),
            series_id: series_id.as_deref(),
        },
    )
    .await?;
    log(
        Level::Info,
        "Upload started",
        &[
            ("videoId", Value::String(id.clone())),
            ("fileSize", Value::from(file_size)),
            ("partCount", Value::from(part_count)),
        ],
    );
    Ok(json_response(
        StatusCode::CREATED,
        json!({ "videoId": id, "partSize": part_size, "partCount": part_count }),
    ))
}

/// Only the person who started an upload, or an admin, continues or cancels it.
async fn find_uploading(state: &AppState, id: &str, viewer: &Viewer) -> AppResult<(VideoRecord, String)> {
    let id = path_id(id, "upload")?;
    let video = videos::find(&state.db, &id).await?.filter(|video| video.status == "uploading");
    let Some(video) = video else {
        return Err(ApiError::not_found("No upload in progress has this ID.").into());
    };
    let Some(upload_id) = video.upload_id.clone() else {
        return Err(ApiError::not_found("No upload in progress has this ID.").into());
    };
    if !can_edit_video(viewer, &video) {
        return Err(ApiError::forbidden("Only the person who started the upload can continue or cancel it.").into());
    }
    Ok((video, upload_id))
}

/// The URL of each part, on albireo.
pub async fn part_urls(
    State(state): State<AppState>,
    Extension(viewer): Extension<Viewer>,
    Path(id): Path<String>,
    body: Bytes,
) -> AppResult<Response> {
    let (video, _) = find_uploading(&state, &id, &viewer).await?;
    let body = read_object(&body, &["partNumbers"])?;
    let mut parts = Vec::new();
    for value in read_array(&body, "partNumbers", 1, MAX_PART_URLS_PER_REQUEST)? {
        let part = whole_number(value).filter(|part| *part >= 1 && *part <= i64::from(video.part_count));
        let Some(part) = part else {
            return Err(ApiError::bad_request(format!("partNumbers must hold whole numbers from 1 to {}.", video.part_count)).into());
        };
        if parts.iter().any(|known: &Value| known["partNumber"] == part) {
            return Err(ApiError::bad_request("partNumbers must not repeat a part number.").into());
        }
        parts.push(json!({ "partNumber": part, "url": format!("/api/uploads/{}/parts/{part}", video.id) }));
    }
    Ok(json_response(StatusCode::OK, json!({ "parts": parts })))
}

/// Writes one part of an upload to the bucket as it arrives, and answers with its ETag, which the
/// browser sends back to complete the upload. Each part but the last has the size of the plan of
/// the upload, and the last one holds the rest of the file.
pub async fn put_part(
    State(state): State<AppState>,
    Extension(viewer): Extension<Viewer>,
    Path((id, part)): Path<(String, String)>,
    headers: HeaderMap,
    body: Body,
) -> AppResult<Response> {
    let (video, upload_id) = find_uploading(&state, &id, &viewer).await?;
    let part_number = part
        .parse::<i64>()
        .ok()
        .filter(|number| !part.starts_with('0') && (1..=i64::from(video.part_count)).contains(number));
    let Some(part_number) = part_number else {
        return Err(ApiError::not_found(format!("The upload has parts 1 to {}.", video.part_count)).into());
    };
    let size = if part_number < i64::from(video.part_count) {
        video.part_size
    } else {
        video.file_size - video.part_size * (i64::from(video.part_count) - 1)
    };
    let length = file_length(&headers, size, size)?;
    let etag = state
        .store
        .upload_part(&video.object_key, &upload_id, part_number as u16, body, length)
        .await?;
    let mut response = no_content();
    response.headers_mut().insert(
        header::ETAG,
        HeaderValue::from_str(&etag).map_err(|_| AppError::Internal("The bucket answered an ETag that is no header.".into()))?,
    );
    Ok(response)
}

/// The browser must report every part exactly once, with the ETag that albireo answered.
fn read_completed_parts(body: &crate::json::JsonObject, part_count: i64) -> Result<Vec<CompletedPart>, ApiError> {
    let items = read_array(body, "parts", part_count as usize, part_count as usize)?;
    let mut parts = Vec::new();
    for item in items {
        let Value::Object(part) = item else {
            return Err(ApiError::bad_request(
                "Each item of parts must be an object with partNumber and etag.",
            ));
        };
        let number = part
            .get("partNumber")
            .and_then(whole_number)
            .filter(|number| (1..=part_count).contains(number));
        let Some(number) = number else {
            return Err(ApiError::bad_request(format!(
                "Each partNumber must be a whole number from 1 to {part_count}."
            )));
        };
        let etag = part
            .get("etag")
            .and_then(Value::as_str)
            .filter(|etag| !etag.is_empty() && etag.len() <= ETAG_MAX_LENGTH);
        let Some(etag) = etag else {
            return Err(ApiError::bad_request(format!(
                "Each etag must be a string of 1 to {ETAG_MAX_LENGTH} characters."
            )));
        };
        parts.push(CompletedPart {
            part_number: number as u16,
            etag: etag.to_string(),
        });
    }
    let distinct: HashSet<u16> = parts.iter().map(|part| part.part_number).collect();
    if distinct.len() as i64 != part_count {
        return Err(ApiError::bad_request("parts must list every part number exactly once."));
    }
    parts.sort_by_key(|part| part.part_number);
    Ok(parts)
}

pub async fn complete_upload(
    State(state): State<AppState>,
    Extension(viewer): Extension<Viewer>,
    Path(id): Path<String>,
    body: Bytes,
) -> AppResult<Response> {
    let (video, upload_id) = find_uploading(&state, &id, &viewer).await?;
    let body = read_object(&body, &["parts", "durationSec", "width", "height"])?;
    let parts = read_completed_parts(&body, i64::from(video.part_count))?;
    let media = MediaInfo {
        duration_sec: read_nullable_number(&body, "durationSec", 0.0, MAX_DURATION_SEC, false)?,
        width: read_nullable_number(&body, "width", 1.0, MAX_DIMENSION, true)?.map(|width| width as i32),
        height: read_nullable_number(&body, "height", 1.0, MAX_DIMENSION, true)?.map(|height| height as i32),
    };
    state.store.complete_multipart_upload(&video.object_key, &upload_id, &parts).await?;
    let stored = state.store.head_object(&video.object_key).await?;
    if stored.as_ref().map(|object| object.size as i64) != Some(video.file_size) {
        let found = stored.map_or_else(|| "no object".to_string(), |object| format!("{} bytes", object.size));
        return Err(crate::storage::StorageError::new(format!(
            "The bucket holds {found} after the upload, not the {} bytes that were announced.",
            video.file_size
        ))
        .into());
    }
    let now = now();
    if !videos::mark_ready(&state.db, &video.id, &media, now).await? {
        return Err(ApiError::conflict("The upload is no longer in progress.").into());
    }
    if let Some(series_id) = &video.series_id {
        library::touch_series(&state.db, series_id, now).await?;
    }
    log(
        Level::Info,
        "Upload completed",
        &[
            ("videoId", Value::String(video.id.clone())),
            ("fileSize", Value::from(video.file_size)),
        ],
    );
    detail_response(&state, &video.id, &viewer).await
}

pub async fn abort_upload(
    State(state): State<AppState>,
    Extension(viewer): Extension<Viewer>,
    Path(id): Path<String>,
) -> AppResult<Response> {
    let (video, upload_id) = find_uploading(&state, &id, &viewer).await?;
    if let Err(error) = state.store.abort_multipart_upload(&video.object_key, &upload_id).await {
        // The row goes away regardless. A lifecycle rule on the bucket removes parts left behind.
        let mut fields = vec![("videoId", Value::String(video.id.clone()))];
        fields.extend(error_fields(&error));
        log(Level::Warn, "Could not abort the multipart upload", &fields);
    }
    videos::delete_uploading(&state.db, &video.id).await?;
    log(Level::Info, "Upload canceled", &[("videoId", Value::String(video.id.clone()))]);
    Ok(no_content())
}

pub async fn thumbnail_upload(
    State(state): State<AppState>,
    Extension(viewer): Extension<Viewer>,
    Path(id): Path<String>,
) -> AppResult<Response> {
    let video = find_ready(&state, &id).await?;
    if !can_edit_video(&viewer, &video) {
        return Err(ApiError::forbidden("Only the uploader of the video or an admin can change its thumbnail.").into());
    }
    Ok(json_response(
        StatusCode::OK,
        json!({ "url": format!("/api/videos/{}/thumbnail/file", video.id), "contentType": IMAGE_CONTENT_TYPE }),
    ))
}

pub async fn put_thumbnail(
    State(state): State<AppState>,
    Extension(viewer): Extension<Viewer>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Body,
) -> AppResult<Response> {
    let video = find_ready(&state, &id).await?;
    if !can_edit_video(&viewer, &video) {
        return Err(ApiError::forbidden("Only the uploader of the video or an admin can change its thumbnail.").into());
    }
    require_content_type(&headers, IMAGE_CONTENT_TYPE)?;
    let length = file_length(&headers, 1, IMAGE_MAX_BYTES)?;
    state
        .store
        .put_object(&thumbnail_key(&video.id), IMAGE_CONTENT_TYPE, body, length, &[])
        .await?;
    Ok(no_content())
}

pub async fn commit_thumbnail(
    State(state): State<AppState>,
    Extension(viewer): Extension<Viewer>,
    Path(id): Path<String>,
) -> AppResult<Response> {
    let video = find_ready(&state, &id).await?;
    if !can_edit_video(&viewer, &video) {
        return Err(ApiError::forbidden("Only the uploader of the video or an admin can change its thumbnail.").into());
    }
    let key = thumbnail_key(&video.id);
    if state.store.head_object(&key).await?.is_none() {
        return Err(ApiError::conflict("Send the thumbnail to its URL before committing it.").into());
    }
    videos::set_thumbnail(&state.db, &video.id, &key, now()).await?;
    detail_response(&state, &video.id, &viewer).await
}

/// Whether the key names a file of the library: a video, a thumbnail, a picture, or an attachment.
fn is_file_key(key: &str) -> bool {
    let parts: Vec<&str> = key.split('/').collect();
    match parts.as_slice() {
        ["videos", id, file] => {
            is_id(id)
                && file.strip_prefix("original").is_some_and(|rest| {
                    rest.is_empty()
                        || rest.strip_prefix('.').is_some_and(|extension| {
                            (1..=10).contains(&extension.len())
                                && extension.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
                        })
                })
        }
        ["thumbnails" | "avatars", file] => file.strip_suffix(".jpg").is_some_and(is_id),
        ["attachments", video, attachment] => is_id(video) && is_id(attachment),
        _ => false,
    }
}

/// The files of the library, from the bucket: videos, thumbnails, pictures, and attachments. The
/// bucket answers ranges and revalidations, so a video plays from any point, and a browser that
/// holds a file asks only whether it changed. With ?download, an attachment comes with its name,
/// so that the browser saves it under that name.
pub async fn file(
    State(state): State<AppState>,
    Path(key): Path<String>,
    Query(query): Query<HashMap<String, String>>,
    method: Method,
    headers: HeaderMap,
) -> AppResult<Response> {
    if !is_file_key(&key) {
        return Err(ApiError::not_found("No file has this path.").into());
    }
    let mut disposition = None;
    if query.contains_key("download") {
        let parts: Vec<&str> = key.split('/').collect();
        let attachment = match parts.as_slice() {
            ["attachments", video_id, attachment_id] => notes::find_attachment(&state.db, attachment_id)
                .await?
                .filter(|attachment| attachment.video_id == *video_id),
            _ => None,
        };
        let attachment = attachment.ok_or_else(|| ApiError::not_found("No attachment has this path."))?;
        disposition = Some(download_disposition(&attachment.file_name));
    }
    let head = method == Method::HEAD;
    let answer = state
        .store
        .get_object(&key, head, &headers)
        .await?
        .ok_or_else(|| ApiError::not_found("No file has this path."))?;
    let mut response = Response::new(answer.body);
    *response.status_mut() = answer.status;
    *response.headers_mut() = answer.headers;
    for (name, value) in file_headers() {
        response.headers_mut().insert(name.clone(), value.clone());
    }
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("private, no-cache"));
    if let Some(disposition) = disposition {
        let value = HeaderValue::from_str(&disposition).map_err(|_| AppError::Internal("A download name made no header.".into()))?;
        response.headers_mut().insert(header::CONTENT_DISPOSITION, value);
    }
    // The paths of files start with this, which the log of requests leaves out.
    debug_assert!(FILES_PATH.starts_with("/api/"));
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knows_the_keys_of_the_files_of_the_library() {
        for key in [
            "videos/abcdefghij012345/original.mp4",
            "videos/abcdefghij012345/original",
            "thumbnails/abcdefghij012345.jpg",
            "avatars/abcdefghij012345.jpg",
            "attachments/abcdefghij012345/0123456789abcdef",
        ] {
            assert!(is_file_key(key), "{key}");
        }
        for key in [
            "albireo-check/x",
            "videos/../secrets",
            "thumbnails/x.jpg",
            "",
            "database/albireo.dump",
            "videos/abcdefghij012345/original.MP4",
            "backups/albireo-20261114T031500Z.sql.gz",
        ] {
            assert!(!is_file_key(key), "{key}");
        }
    }

    #[test]
    fn takes_video_types_and_lowercase_extensions() {
        assert!(is_video_type("video/mp4"));
        assert!(!is_video_type("application/pdf"));
        assert!(!is_video_type("video/"));
        assert_eq!(extension_of("weekly-sync.MP4"), ".mp4");
        assert_eq!(extension_of("notes"), "");
    }
}

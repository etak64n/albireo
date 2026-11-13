//! Series, which group videos as numbered episodes, and playlists, the lists of videos that people
//! make. The owner of a series or a playlist and admins change it, and everyone sees it.

use std::collections::HashMap;

use axum::Extension;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Response;
use serde_json::{Value, json};

use super::videos::{can_edit_video, find_ready};
use super::{AppState, json_response, no_content, path_id};
use crate::auth::Viewer;
use crate::error::{ApiError, AppResult};
use crate::ids::{is_id, random_id};
use crate::json::{Rule, read_object, read_optional_string, read_string};
use crate::log::{Level, log};
use crate::model::{Episode, PlaylistChoice, PlaylistDetail, PlaylistVideo, SeriesDetail, collection_summary_of, owner_of, summary_of};
use crate::repo::library::{self, CollectionRecord};
use crate::repo::videos;
use crate::shared::{DESCRIPTION_MAX_LENGTH, TITLE_MAX_LENGTH};
use crate::time::{iso, now};

fn can_edit(viewer: &Viewer, collection: &CollectionRecord) -> bool {
    viewer.is_admin() || collection.owner_id == viewer.id()
}

fn title_rule() -> Rule {
    Rule {
        min: 1,
        max: TITLE_MAX_LENGTH,
        trim: true,
    }
}

fn description_rule() -> Rule {
    Rule {
        min: 0,
        max: DESCRIPTION_MAX_LENGTH,
        trim: false,
    }
}

/// Reads "earlier" or "later".
fn read_direction(body: &Bytes) -> Result<bool, ApiError> {
    let body = read_object(body, &["direction"])?;
    match read_string(
        &body,
        "direction",
        Rule {
            min: 1,
            max: 10,
            trim: false,
        },
    )?
    .as_str()
    {
        "earlier" => Ok(true),
        "later" => Ok(false),
        _ => Err(ApiError::bad_request("direction must be \"earlier\" or \"later\".")),
    }
}

fn owner_filter(query: &HashMap<String, String>) -> Result<Option<&str>, ApiError> {
    match query.get("owner") {
        None => Ok(None),
        Some(owner) if is_id(owner) => Ok(Some(owner.as_str())),
        Some(_) => Err(ApiError::bad_request("owner must be a user ID.")),
    }
}

async fn find_series(state: &AppState, id: &str) -> AppResult<CollectionRecord> {
    let id = path_id(id, "series")?;
    library::find_series(&state.db, &id)
        .await?
        .ok_or_else(|| ApiError::not_found("No series has this ID.").into())
}

async fn series_detail(state: &AppState, series: &CollectionRecord, viewer: &Viewer) -> AppResult<SeriesDetail> {
    let episodes = videos::list_episodes(&state.db, &series.id).await?;
    Ok(SeriesDetail {
        id: series.id.clone(),
        title: series.title.clone(),
        description: series.description.clone(),
        owner: owner_of(series),
        created_at: iso(&series.created_at),
        updated_at: iso(&series.updated_at),
        can_edit: can_edit(viewer, series),
        episodes: episodes
            .iter()
            .enumerate()
            .map(|(index, episode)| Episode {
                summary: summary_of(episode),
                episode: index + 1,
            })
            .collect(),
    })
}

async fn series_response(state: &AppState, id: &str, viewer: &Viewer, status: StatusCode) -> AppResult<Response> {
    let series = find_series(state, id).await?;
    Ok(json_response(
        status,
        json!({ "series": series_detail(state, &series, viewer).await? }),
    ))
}

pub async fn list_series(State(state): State<AppState>, Query(query): Query<HashMap<String, String>>) -> AppResult<Response> {
    let series: Vec<_> = library::list_series(&state.db, owner_filter(&query)?)
        .await?
        .iter()
        .map(collection_summary_of)
        .collect();
    Ok(json_response(StatusCode::OK, json!({ "series": series })))
}

pub async fn create_series(State(state): State<AppState>, Extension(viewer): Extension<Viewer>, body: Bytes) -> AppResult<Response> {
    let body = read_object(&body, &["title", "description"])?;
    let title = read_string(&body, "title", title_rule())?;
    let description = read_string(&body, "description", description_rule())?;
    let id = random_id();
    library::insert_series(&state.db, &id, &title, &description, viewer.id(), now()).await?;
    series_response(&state, &id, &viewer, StatusCode::CREATED).await
}

pub async fn series(State(state): State<AppState>, Extension(viewer): Extension<Viewer>, Path(id): Path<String>) -> AppResult<Response> {
    series_response(&state, &id, &viewer, StatusCode::OK).await
}

pub async fn edit_series(
    State(state): State<AppState>,
    Extension(viewer): Extension<Viewer>,
    Path(id): Path<String>,
    body: Bytes,
) -> AppResult<Response> {
    let body = read_object(&body, &["title", "description"])?;
    let title = read_optional_string(&body, "title", title_rule())?;
    let description = read_optional_string(&body, "description", description_rule())?;
    if title.is_none() && description.is_none() {
        return Err(ApiError::bad_request("Send a title, a description, or both.").into());
    }
    let series = find_series(&state, &id).await?;
    if !can_edit(&viewer, &series) {
        return Err(ApiError::forbidden("Only the creator of the series or an admin can edit it.").into());
    }
    library::update_series(&state.db, &series.id, title.as_deref(), description.as_deref(), now()).await?;
    series_response(&state, &series.id, &viewer, StatusCode::OK).await
}

/// Deletes a series. Its videos stay in the library, out of any series.
pub async fn delete_series(
    State(state): State<AppState>,
    Extension(viewer): Extension<Viewer>,
    Path(id): Path<String>,
) -> AppResult<Response> {
    let series = find_series(&state, &id).await?;
    if !can_edit(&viewer, &series) {
        return Err(ApiError::forbidden("Only the creator of the series or an admin can delete it.").into());
    }
    videos::leave_series(&state.db, &series.id, now()).await?;
    library::delete_series(&state.db, &series.id).await?;
    log(Level::Info, "Series deleted", &[("seriesId", Value::String(series.id.clone()))]);
    Ok(no_content())
}

/// Moves an episode one place earlier or later.
pub async fn move_episode(
    State(state): State<AppState>,
    Extension(viewer): Extension<Viewer>,
    Path((id, video_id)): Path<(String, String)>,
    body: Bytes,
) -> AppResult<Response> {
    let series = find_series(&state, &id).await?;
    let video_id = path_id(&video_id, "video")?;
    let earlier = read_direction(&body)?;
    if !can_edit(&viewer, &series) {
        return Err(ApiError::forbidden("Only the creator of the series or an admin can reorder it.").into());
    }
    let episodes = videos::list_episodes(&state.db, &series.id).await?;
    let index = episodes
        .iter()
        .position(|episode| episode.id == video_id)
        .ok_or_else(|| ApiError::not_found("The series has no ready episode with this ID."))?;
    let neighbor = if earlier {
        index.checked_sub(1).and_then(|other| episodes.get(other))
    } else {
        episodes.get(index + 1)
    };
    let Some(neighbor) = neighbor else {
        return Err(ApiError::conflict(format!(
            "The episode is already the {} one.",
            if earlier { "first" } else { "last" }
        ))
        .into());
    };
    videos::swap_episodes(&state.db, &episodes[index], neighbor).await?;
    library::touch_series(&state.db, &series.id, now()).await?;
    series_response(&state, &series.id, &viewer, StatusCode::OK).await
}

/// Takes a video out of a series. The creator of the series, the uploader of the video, and admins can.
pub async fn remove_episode(
    State(state): State<AppState>,
    Extension(viewer): Extension<Viewer>,
    Path((id, video_id)): Path<(String, String)>,
) -> AppResult<Response> {
    let series = find_series(&state, &id).await?;
    let video = find_ready(&state, &video_id).await?;
    if video.series_id.as_deref() != Some(series.id.as_str()) {
        return Err(ApiError::not_found("The series has no episode with this ID.").into());
    }
    if !can_edit(&viewer, &series) && !can_edit_video(&viewer, &video) {
        return Err(ApiError::forbidden("Only the creator of the series, the uploader of the video, or an admin can take it out.").into());
    }
    let now = now();
    videos::set_series(&state.db, &video.id, None, now).await?;
    library::touch_series(&state.db, &series.id, now).await?;
    series_response(&state, &series.id, &viewer, StatusCode::OK).await
}

/// The playlists of the person, each with whether it holds the video, for adding the video to them.
pub async fn playlist_choices(
    State(state): State<AppState>,
    Extension(viewer): Extension<Viewer>,
    Path(id): Path<String>,
) -> AppResult<Response> {
    let video = find_ready(&state, &id).await?;
    let choices: Vec<PlaylistChoice> = library::playlist_choices(&state.db, viewer.id(), &video.id)
        .await?
        .into_iter()
        .map(|choice| PlaylistChoice {
            id: choice.id,
            title: choice.title,
            has_video: choice.has_video,
        })
        .collect();
    Ok(json_response(StatusCode::OK, json!({ "playlists": choices })))
}

async fn find_playlist(state: &AppState, id: &str) -> AppResult<CollectionRecord> {
    let id = path_id(id, "playlist")?;
    library::find_playlist(&state.db, &id)
        .await?
        .ok_or_else(|| ApiError::not_found("No playlist has this ID.").into())
}

async fn playlist_response(state: &AppState, id: &str, viewer: &Viewer, status: StatusCode) -> AppResult<Response> {
    let playlist = find_playlist(state, id).await?;
    let videos = videos::list_in_playlist(&state.db, &playlist.id).await?;
    let detail = PlaylistDetail {
        id: playlist.id.clone(),
        title: playlist.title.clone(),
        description: playlist.description.clone(),
        owner: owner_of(&playlist),
        created_at: iso(&playlist.created_at),
        updated_at: iso(&playlist.updated_at),
        can_edit: can_edit(viewer, &playlist),
        videos: videos
            .iter()
            .enumerate()
            .map(|(index, row)| PlaylistVideo {
                summary: summary_of(&row.video),
                position: index + 1,
            })
            .collect(),
    };
    Ok(json_response(status, json!({ "playlist": detail })))
}

pub async fn list_playlists(State(state): State<AppState>, Query(query): Query<HashMap<String, String>>) -> AppResult<Response> {
    let playlists: Vec<_> = library::list_playlists(&state.db, owner_filter(&query)?)
        .await?
        .iter()
        .map(collection_summary_of)
        .collect();
    Ok(json_response(StatusCode::OK, json!({ "playlists": playlists })))
}

pub async fn create_playlist(State(state): State<AppState>, Extension(viewer): Extension<Viewer>, body: Bytes) -> AppResult<Response> {
    let body = read_object(&body, &["title", "description"])?;
    let title = read_string(&body, "title", title_rule())?;
    let description = read_string(&body, "description", description_rule())?;
    let id = random_id();
    library::insert_playlist(&state.db, &id, &title, &description, viewer.id(), now()).await?;
    playlist_response(&state, &id, &viewer, StatusCode::CREATED).await
}

pub async fn playlist(State(state): State<AppState>, Extension(viewer): Extension<Viewer>, Path(id): Path<String>) -> AppResult<Response> {
    playlist_response(&state, &id, &viewer, StatusCode::OK).await
}

pub async fn edit_playlist(
    State(state): State<AppState>,
    Extension(viewer): Extension<Viewer>,
    Path(id): Path<String>,
    body: Bytes,
) -> AppResult<Response> {
    let body = read_object(&body, &["title", "description"])?;
    let title = read_optional_string(&body, "title", title_rule())?;
    let description = read_optional_string(&body, "description", description_rule())?;
    if title.is_none() && description.is_none() {
        return Err(ApiError::bad_request("Send a title, a description, or both.").into());
    }
    let playlist = find_playlist(&state, &id).await?;
    if !can_edit(&viewer, &playlist) {
        return Err(ApiError::forbidden("Only the owner of the playlist or an admin can edit it.").into());
    }
    library::update_playlist(&state.db, &playlist.id, title.as_deref(), description.as_deref(), now()).await?;
    playlist_response(&state, &playlist.id, &viewer, StatusCode::OK).await
}

/// Deletes a playlist. Its videos stay in the library and in other playlists.
pub async fn delete_playlist(
    State(state): State<AppState>,
    Extension(viewer): Extension<Viewer>,
    Path(id): Path<String>,
) -> AppResult<Response> {
    let playlist = find_playlist(&state, &id).await?;
    if !can_edit(&viewer, &playlist) {
        return Err(ApiError::forbidden("Only the owner of the playlist or an admin can delete it.").into());
    }
    library::delete_playlist(&state.db, &playlist.id).await?;
    log(
        Level::Info,
        "Playlist deleted",
        &[("playlistId", Value::String(playlist.id.clone()))],
    );
    Ok(no_content())
}

/// Puts a ready video at the end of a playlist. Any video can be in any number of playlists.
pub async fn add_to_playlist(
    State(state): State<AppState>,
    Extension(viewer): Extension<Viewer>,
    Path(id): Path<String>,
    body: Bytes,
) -> AppResult<Response> {
    let playlist = find_playlist(&state, &id).await?;
    let body = read_object(&body, &["videoId"])?;
    let video_id = read_string(
        &body,
        "videoId",
        Rule {
            min: 1,
            max: 100,
            trim: false,
        },
    )?;
    if !can_edit(&viewer, &playlist) {
        return Err(ApiError::forbidden("Only the owner of the playlist or an admin can change it.").into());
    }
    let video = if is_id(&video_id) {
        videos::find(&state.db, &video_id).await?
    } else {
        None
    };
    let Some(video) = video.filter(videos::VideoRecord::is_ready) else {
        return Err(ApiError::bad_request("No ready video has this videoId.").into());
    };
    if !library::add_to_playlist(&state.db, &playlist.id, &video.id, now()).await? {
        return Err(ApiError::conflict("The playlist holds the video already.").into());
    }
    playlist_response(&state, &playlist.id, &viewer, StatusCode::OK).await
}

pub async fn remove_from_playlist(
    State(state): State<AppState>,
    Extension(viewer): Extension<Viewer>,
    Path((id, video_id)): Path<(String, String)>,
) -> AppResult<Response> {
    let playlist = find_playlist(&state, &id).await?;
    let video_id = path_id(&video_id, "video")?;
    if !can_edit(&viewer, &playlist) {
        return Err(ApiError::forbidden("Only the owner of the playlist or an admin can change it.").into());
    }
    if !library::remove_from_playlist(&state.db, &playlist.id, &video_id, now()).await? {
        return Err(ApiError::not_found("The playlist does not hold a video with this ID.").into());
    }
    playlist_response(&state, &playlist.id, &viewer, StatusCode::OK).await
}

/// Moves a video of a playlist one place earlier or later.
pub async fn move_in_playlist(
    State(state): State<AppState>,
    Extension(viewer): Extension<Viewer>,
    Path((id, video_id)): Path<(String, String)>,
    body: Bytes,
) -> AppResult<Response> {
    let playlist = find_playlist(&state, &id).await?;
    let video_id = path_id(&video_id, "video")?;
    let earlier = read_direction(&body)?;
    if !can_edit(&viewer, &playlist) {
        return Err(ApiError::forbidden("Only the owner of the playlist or an admin can reorder it.").into());
    }
    let rows = videos::list_in_playlist(&state.db, &playlist.id).await?;
    let index = rows
        .iter()
        .position(|row| row.video.id == video_id)
        .ok_or_else(|| ApiError::not_found("The playlist has no ready video with this ID."))?;
    let neighbor = if earlier {
        index.checked_sub(1).and_then(|other| rows.get(other))
    } else {
        rows.get(index + 1)
    };
    let Some(neighbor) = neighbor else {
        return Err(ApiError::conflict(format!("The video is already the {} one.", if earlier { "first" } else { "last" })).into());
    };
    let current = &rows[index];
    library::swap_in_playlist(
        &state.db,
        &playlist.id,
        (&current.video.id, current.playlist_position),
        (&neighbor.video.id, neighbor.playlist_position),
    )
    .await?;
    library::touch_playlist(&state.db, &playlist.id, now()).await?;
    playlist_response(&state, &playlist.id, &viewer, StatusCode::OK).await
}

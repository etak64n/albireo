//! The shapes of the answers of the API, which shared/api.ts describes for the browser app.
//! Times are ISO 8601 strings to the millisecond, and names are in camelCase.

use serde::Serialize;

use crate::repo::library::CollectionRecord;
use crate::repo::notes::{AttachmentRecord, RatingSummary};
use crate::repo::videos::VideoRecord;
use crate::time::{Time, iso, millis};

/// The paths of the files of the library: a video, a thumbnail, a picture, or an attachment.
pub const FILES_PATH: &str = "/api/files/";

pub fn file_url(key: &str) -> String {
    format!("{FILES_PATH}{key}")
}

/// The URL of a thumbnail or a picture. They keep their keys when they change, so the URL carries
/// the time of the last change of their row, and a page shows a new one at once rather than the
/// one that the browser holds.
pub fn versioned_url(key: Option<&str>, updated_at: &Time) -> Option<String> {
    key.map(|key| format!("{}?v={}", file_url(key), millis(updated_at)))
}

/// The URL of an attachment that makes the browser save the file under its name.
pub fn download_url(key: &str) -> String {
    format!("{}?download", file_url(key))
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserSummary {
    pub id: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserProfile {
    pub id: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub bio: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Me {
    pub id: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub bio: String,
    pub email: String,
    pub is_admin: bool,
    pub joined_at: String,
    pub language: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesLink {
    pub id: String,
    pub title: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoSummary {
    pub id: String,
    pub title: String,
    pub duration_sec: Option<f64>,
    pub thumbnail_url: Option<String>,
    pub created_at: String,
    pub uploader: Option<UserSummary>,
    pub series: Option<SeriesLink>,
    pub rating_average: f64,
    pub rating_count: i32,
    pub comment_count: i32,
    pub attachment_count: i32,
}

pub fn uploader_of(video: &VideoRecord) -> Option<UserSummary> {
    let id = video.uploader_id.clone()?;
    Some(UserSummary {
        id,
        display_name: video.uploader_name.clone().unwrap_or_default(),
        avatar_url: video
            .uploader_updated_at
            .as_ref()
            .and_then(|updated| versioned_url(video.uploader_avatar_key.as_deref(), updated)),
    })
}

pub fn summary_of(video: &VideoRecord) -> VideoSummary {
    VideoSummary {
        id: video.id.clone(),
        title: video.title.clone(),
        duration_sec: video.duration_sec,
        thumbnail_url: versioned_url(video.thumbnail_key.as_deref(), &video.updated_at),
        created_at: iso(&video.created_at),
        uploader: uploader_of(video),
        series: match (&video.series_id, &video.series_title) {
            (Some(id), Some(title)) => Some(SeriesLink {
                id: id.clone(),
                title: title.clone(),
            }),
            _ => None,
        },
        rating_average: if video.rating_count == 0 {
            0.0
        } else {
            f64::from(video.rating_score) / 1000.0
        },
        rating_count: video.rating_count,
        comment_count: video.comment_count,
        attachment_count: video.attachment_count,
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedVideo {
    #[serde(flatten)]
    pub summary: VideoSummary,
    pub watched_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpisodeLink {
    pub id: String,
    pub title: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoSeries {
    pub id: String,
    pub title: String,
    /// 1 for the first ready video of the series.
    pub episode: usize,
    pub previous: Option<EpisodeLink>,
    pub next: Option<EpisodeLink>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoRating {
    pub average: Option<f64>,
    pub count: i64,
    pub mine: Option<i32>,
}

impl From<RatingSummary> for VideoRating {
    fn from(summary: RatingSummary) -> Self {
        Self {
            average: summary.average,
            count: summary.count,
            mine: summary.mine,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoAttachment {
    pub id: String,
    pub file_name: String,
    pub content_type: String,
    pub file_size: i64,
    pub created_at: String,
    pub view_url: String,
    pub download_url: String,
}

pub fn attachment_key(video_id: &str, id: &str) -> String {
    format!("attachments/{video_id}/{id}")
}

pub fn attachment_of(attachment: &AttachmentRecord) -> VideoAttachment {
    let key = attachment_key(&attachment.video_id, &attachment.id);
    VideoAttachment {
        id: attachment.id.clone(),
        file_name: attachment.file_name.clone(),
        content_type: attachment.content_type.clone(),
        file_size: attachment.file_size,
        created_at: iso(&attachment.created_at),
        view_url: file_url(&key),
        download_url: download_url(&key),
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoDetail {
    pub id: String,
    pub title: String,
    pub description: String,
    pub duration_sec: Option<f64>,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub file_size: i64,
    pub content_type: String,
    pub created_at: String,
    pub updated_at: String,
    pub playback_url: String,
    pub thumbnail_url: Option<String>,
    pub uploader: Option<UserSummary>,
    pub series: Option<VideoSeries>,
    pub rating: VideoRating,
    pub attachments: Vec<VideoAttachment>,
    pub can_edit: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoComment {
    pub id: String,
    pub body: String,
    pub created_at: String,
    pub author: UserSummary,
    pub can_delete: bool,
}

/// A series or a playlist as a list shows it.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionSummary {
    pub id: String,
    pub title: String,
    pub owner: UserSummary,
    pub cover_url: Option<String>,
    pub updated_at: String,
}

pub fn owner_of(collection: &CollectionRecord) -> UserSummary {
    UserSummary {
        id: collection.owner_id.clone(),
        display_name: collection.owner_name.clone(),
        avatar_url: versioned_url(collection.owner_avatar_key.as_deref(), &collection.owner_updated_at),
    }
}

pub fn collection_summary_of(collection: &CollectionRecord) -> CollectionSummary {
    CollectionSummary {
        id: collection.id.clone(),
        title: collection.title.clone(),
        owner: owner_of(collection),
        cover_url: collection
            .cover_updated_at
            .as_ref()
            .and_then(|updated| versioned_url(collection.cover_key.as_deref(), updated)),
        updated_at: iso(&collection.updated_at),
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Episode {
    #[serde(flatten)]
    pub summary: VideoSummary,
    pub episode: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesDetail {
    pub id: String,
    pub title: String,
    pub description: String,
    pub owner: UserSummary,
    pub created_at: String,
    pub updated_at: String,
    pub can_edit: bool,
    pub episodes: Vec<Episode>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistVideo {
    #[serde(flatten)]
    pub summary: VideoSummary,
    pub position: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistDetail {
    pub id: String,
    pub title: String,
    pub description: String,
    pub owner: UserSummary,
    pub created_at: String,
    pub updated_at: String,
    pub can_edit: bool,
    pub videos: Vec<PlaylistVideo>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistChoice {
    pub id: String,
    pub title: String,
    pub has_video: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub browser: String,
    pub os: String,
    pub signed_in_at: String,
    pub last_active_at: String,
    pub expires_at: String,
    pub current: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub id: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub email: String,
    pub is_admin: bool,
    pub joined_at: String,
    pub last_active_at: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Invitation {
    pub id: String,
    pub is_admin: bool,
    pub invited_by: UserSummary,
    pub created_at: String,
    pub expires_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinInfo {
    pub is_admin: bool,
    pub invited_by: String,
    pub expires_at: String,
}

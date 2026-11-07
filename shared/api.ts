// Request and response shapes of the albireo API, shared by the browser app
// and the Worker so that both sides agree at compile time.

export const TITLE_MAX_LENGTH = 200;
export const DESCRIPTION_MAX_LENGTH = 5000;
export const DISPLAY_NAME_MAX_LENGTH = 50;
export const BIO_MAX_LENGTH = 1000;
export const LIST_PAGE_SIZE = 48;
export const MAX_PART_URLS_PER_REQUEST = 100;
export const COMMENT_MAX_LENGTH = 2000;
/** Ratings are whole stars from 1 to this number. */
export const RATING_MAX_STARS = 5;
export const SEARCH_QUERY_MAX_LENGTH = 100;
export const ATTACHMENT_MAX_BYTES = 500 * 1024 * 1024;
export const ATTACHMENT_NAME_MAX_LENGTH = 255;
/** IDs of videos, users, series, comments, and attachments: 16 digits and lowercase letters. */
export const ID_PATTERN = /^[0-9a-z]{16}$/;

/** A person as other people see them: the uploader of a video or the owner of a series. */
export interface UserSummary {
  id: string;
  displayName: string;
  /** The picture that the person chose, or null for the default person icon. */
  avatarUrl: string | null;
}

/** A person with what they wrote about themselves, for their page. */
export interface UserProfile extends UserSummary {
  bio: string;
}

/** The signed-in person. */
export interface Me extends UserProfile {
  email: string;
  isAdmin: boolean;
  /** When the person first signed in, which made their record in the library. */
  joinedAt: string;
  /** Where to send the browser to sign out, or null when nobody signs in, as under `cf dev`. */
  logoutUrl: string | null;
}

export interface MeResponse {
  me: Me;
}

/** How the signed-in person signed in, as Cloudflare Access reports it. */
export interface SignIn {
  /** The type of the login method, such as passkeys, onetimepin, or github. */
  method: string;
  /** When the person signed in. */
  signedInAt: string;
  /** The passkeys of the person, or null when Access does not report them. */
  passkeys: Passkey[] | null;
}

/** A session of the signed-in person, as albireo saw it: one Access token on one device. */
export interface Session {
  /** The browser and the operating system, each "" when albireo does not know it. */
  browser: string;
  os: string;
  /** The city and the two-letter country code of the first request, each "" when Cloudflare did not tell. */
  city: string;
  country: string;
  signedInAt: string;
  /** The last request of the session, which albireo writes at most every five minutes. */
  lastActiveAt: string;
  expiresAt: string;
  /** True for the session of this request. */
  current: boolean;
}

export interface SessionsResponse {
  /** null when nobody signs in through Access, as under `cf dev`. */
  sessions: Session[] | null;
}

/** A passkey that the person registered with Access, to sign in without a code or a password. */
export interface Passkey {
  name: string;
  addedAt: string;
  /** null when the passkey was never used. */
  lastUsedAt: string | null;
}

export interface SignInResponse {
  /** null when nobody signs in through Access, as under `cf dev`. */
  signIn: SignIn | null;
}

export interface UpdateMeRequest {
  displayName?: string;
  bio?: string;
}

export interface UserResponse {
  user: UserProfile;
}

/** A ready video as the library page lists it. */
export interface VideoSummary {
  id: string;
  title: string;
  durationSec: number | null;
  thumbnailUrl: string | null;
  createdAt: string;
  /** Null for videos that were uploaded before albireo recorded uploaders. */
  uploader: UserSummary | null;
}

/** A video in the history of the signed-in person. */
export interface WatchedVideo extends VideoSummary {
  watchedAt: string;
}

/** Videos for the signed-in person, from the most likely to be wanted. */
export interface RecommendationsResponse {
  videos: VideoSummary[];
}

export interface HistoryResponse {
  videos: WatchedVideo[];
  /** Pass this as the cursor query parameter to get the next page, or null on the last page. */
  nextCursor: string | null;
}

/** A neighboring episode in a series. */
export interface EpisodeLink {
  id: string;
  title: string;
}

/** The series that a video belongs to, and where the video sits in it. */
export interface VideoSeries {
  id: string;
  title: string;
  /** 1 for the first ready video of the series. */
  episode: number;
  previous: EpisodeLink | null;
  next: EpisodeLink | null;
}

/** A ready video with signed URLs for playback. */
export interface VideoDetail {
  id: string;
  title: string;
  description: string;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  fileSize: number;
  contentType: string;
  createdAt: string;
  updatedAt: string;
  playbackUrl: string;
  thumbnailUrl: string | null;
  uploader: UserSummary | null;
  series: VideoSeries | null;
  rating: VideoRating;
  attachments: VideoAttachment[];
  /** Whether the signed-in person can edit the video: its uploader or an admin. */
  canEdit: boolean;
}

/** A file that goes with a video, such as its slides or notes. */
export interface VideoAttachment {
  id: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  createdAt: string;
  /** Reads the file, for previews. */
  viewUrl: string;
  /** Reads the file and asks the storage service to have the browser save it under its name. */
  downloadUrl: string;
}

export interface StartAttachmentRequest {
  fileName: string;
  fileSize: number;
}

/** Where the browser uploads the file with a PUT of this Content-Type, and the attachment to commit afterwards. */
export interface StartAttachmentResponse {
  attachmentId: string;
  url: string;
  contentType: string;
}

export interface AttachmentResponse {
  attachment: VideoAttachment;
}

/** How people rated a video. */
export interface VideoRating {
  /** The mean of everyone's stars, or null when nobody rated the video. */
  average: number | null;
  count: number;
  /** The stars that the signed-in person gave, or null when they did not rate the video. */
  mine: number | null;
}

export interface RateVideoRequest {
  stars: number;
}

export interface RatingResponse {
  rating: VideoRating;
}

/** A comment under a video. */
export interface VideoComment {
  id: string;
  body: string;
  createdAt: string;
  author: UserSummary;
  /** Whether the signed-in person can delete it: its author, the uploader of the video, or an admin. */
  canDelete: boolean;
}

export interface ListCommentsResponse {
  /** From the newest. */
  comments: VideoComment[];
  nextCursor: string | null;
}

export interface CreateCommentRequest {
  body: string;
}

export interface CommentResponse {
  comment: VideoComment;
}

/** Ready videos whose title or description contains every word of the query, title matches first. */
export interface SearchResponse {
  videos: VideoSummary[];
  nextCursor: string | null;
}

export interface ListVideosResponse {
  videos: VideoSummary[];
  /** Pass this as the cursor query parameter to get the next page, or null on the last page. */
  nextCursor: string | null;
}

export interface VideoResponse {
  video: VideoDetail;
}

export interface UpdateVideoRequest {
  title?: string;
  description?: string;
  /** Moves the video to the end of a series, or out of its series with null. */
  seriesId?: string | null;
}

export interface CreateUploadRequest {
  title: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  /** The series that the video joins as its last episode, or null. */
  seriesId: string | null;
}

export interface CreateUploadResponse {
  videoId: string;
  /** Size of every part except the last one, in bytes. */
  partSize: number;
  partCount: number;
}

export interface PartUrlsRequest {
  partNumbers: number[];
}

export interface PartUrlsResponse {
  parts: { partNumber: number; url: string }[];
}

export interface CompleteUploadRequest {
  parts: { partNumber: number; etag: string }[];
  durationSec: number | null;
  width: number | null;
  height: number | null;
}

/** A signed URL for one image upload: a thumbnail or the picture of a person. */
export interface ImageUploadResponse {
  url: string;
  /** Content type that the PUT request to url must send. */
  contentType: string;
}

export type ThumbnailUploadResponse = ImageUploadResponse;

/** A series as the library page lists it. */
export interface SeriesSummary {
  id: string;
  title: string;
  owner: UserSummary;
  /** The thumbnail of the first episode that has one. */
  coverUrl: string | null;
  updatedAt: string;
}

export interface Episode extends VideoSummary {
  /** 1 for the first ready video of the series. */
  episode: number;
}

export interface SeriesDetail {
  id: string;
  title: string;
  description: string;
  owner: UserSummary;
  createdAt: string;
  updatedAt: string;
  /** Whether the signed-in person can edit the series: its owner or an admin. */
  canEdit: boolean;
  episodes: Episode[];
}

export interface ListSeriesResponse {
  series: SeriesSummary[];
}

export interface SeriesResponse {
  series: SeriesDetail;
}

export interface CreateSeriesRequest {
  title: string;
  description: string;
}

export interface UpdateSeriesRequest {
  title?: string;
  description?: string;
}

export interface MoveEpisodeRequest {
  direction: "earlier" | "later";
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}

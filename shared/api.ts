// Request and response shapes of the albireo API, shared by the browser app
// and the server so that both sides agree at compile time.

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
/** A password has 10 to 200 characters. */
export const PASSWORD_MAX_LENGTH = 200;
export const EMAIL_MAX_LENGTH = 254;
/** IDs of videos, users, series, comments, and attachments: 16 digits and lowercase letters. */
export const ID_PATTERN = /^[0-9a-z]{16}$/;
/** The languages of the browser app. Each person chooses one on the account page. */
export const LANGUAGES = ["en", "ja"] as const;
export type Language = (typeof LANGUAGES)[number];

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

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
  /** Admins edit every video, series, and playlist, and invite and remove people. */
  isAdmin: boolean;
  /** When the person joined: the setup of albireo for the first admin, and the use of their invitation for the others. */
  joinedAt: string;
  /** The language of the browser app that the person chose. Only they see it. */
  language: Language;
}

export interface MeResponse {
  me: Me;
}

/**
 * Whom the browser app shows its pages to. GET /api/me answers 401 with the code
 * "signed_out" without a session, and with "setup_needed" before albireo has its first admin.
 */
export type SignedOutCode = "signed_out" | "setup_needed";

/** The first admin, with the setup code that albireo writes to its log while it has nobody. */
export interface SetupRequest {
  setupCode: string;
  email: string;
  displayName: string;
  password: string;
}

export interface SignInRequest {
  email: string;
  password: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/** A session of the signed-in person: one browser where they signed in. */
export interface Session {
  id: string;
  /** The browser and the operating system from the User-Agent header, each "" when albireo does not know it. */
  browser: string;
  os: string;
  signedInAt: string;
  /** The last request of the session, which albireo writes at most every five minutes. */
  lastActiveAt: string;
  expiresAt: string;
  /** True for the session of this request. */
  current: boolean;
}

export interface SessionsResponse {
  sessions: Session[];
}

/** A person of the library, as the admins manage them. */
export interface Person extends UserSummary {
  email: string;
  isAdmin: boolean;
  joinedAt: string;
  /** The last request of any of their sessions, or null when they have none. */
  lastActiveAt: string | null;
}

export interface ListPeopleResponse {
  people: Person[];
}

export interface PersonResponse {
  person: Person;
}

export interface UpdatePersonRequest {
  isAdmin: boolean;
}

/** An invitation that nobody has used yet. It works once, until it expires. */
export interface Invitation {
  id: string;
  isAdmin: boolean;
  invitedBy: UserSummary;
  createdAt: string;
  expiresAt: string;
}

export interface CreateInvitationRequest {
  isAdmin: boolean;
}

export interface CreateInvitationResponse {
  invitation: Invitation;
  /** The secret of the link, which albireo answers only now: the link is /join/<token>. */
  token: string;
}

export interface ListInvitationsResponse {
  invitations: Invitation[];
}

/** What the page of an invitation link shows before the person joins. */
export interface JoinInfo {
  isAdmin: boolean;
  /** The display name of the person who invited them. */
  invitedBy: string;
  expiresAt: string;
}

export interface JoinInfoResponse {
  invitation: JoinInfo;
}

export interface JoinRequest {
  email: string;
  displayName: string;
  password: string;
}

export interface UpdateMeRequest {
  displayName?: string;
  bio?: string;
  language?: Language;
}

export interface UserResponse {
  user: UserProfile;
}

/** A series by its name, which a video in a list names. */
export interface SeriesLink {
  id: string;
  title: string;
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
  /** The series of the video, or null. */
  series: SeriesLink | null;
  /** The average stars, such as 4.333, and 0 when nobody rated the video. */
  ratingAverage: number;
  ratingCount: number;
  commentCount: number;
  /** The attachments that finished uploading. */
  attachmentCount: number;
}

/** A video in the history of the person. */
export interface WatchedVideo extends VideoSummary {
  watchedAt: string;
}

/** Videos for the person, from the most likely to be wanted. */
export interface RecommendationsResponse {
  videos: VideoSummary[];
}

/** Videos picked at random from the whole library, in a random order. */
export interface RandomVideosResponse {
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

/** A ready video, with the URL that plays it. */
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
  /** Whether the person can edit the video: its uploader or an admin. */
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
  /** The stars that the person gave, or null when they did not rate the video. */
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
  /** Whether the person can delete it: its author, the uploader of the video, or an admin. */
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

/**
 * The orders of the list of all videos: from the newest, from the oldest, or from the
 * highest average rating, where more ratings come first among equal averages and the
 * videos that nobody rated come last.
 */
export const VIDEO_SORTS = ["newest", "oldest", "rating"] as const;
export type VideoSort = (typeof VIDEO_SORTS)[number];

export function isVideoSort(value: string): value is VideoSort {
  return (VIDEO_SORTS as readonly string[]).includes(value);
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

/** The URL that takes one image: a thumbnail or the picture of the person. */
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
  /** Whether the person can edit the series: its owner or an admin. */
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

/** A playlist as lists show it. */
export interface PlaylistSummary {
  id: string;
  title: string;
  owner: UserSummary;
  /** The thumbnail of the first video that has one. */
  coverUrl: string | null;
  updatedAt: string;
}

/** A video of a playlist. */
export interface PlaylistVideo extends VideoSummary {
  /** 1 for the first ready video of the playlist. */
  position: number;
}

export interface PlaylistDetail {
  id: string;
  title: string;
  description: string;
  owner: UserSummary;
  createdAt: string;
  updatedAt: string;
  /** Whether the person can change the playlist: its owner or an admin. */
  canEdit: boolean;
  videos: PlaylistVideo[];
}

export interface ListPlaylistsResponse {
  playlists: PlaylistSummary[];
}

export interface PlaylistResponse {
  playlist: PlaylistDetail;
}

export interface CreatePlaylistRequest {
  title: string;
  description: string;
}

export interface UpdatePlaylistRequest {
  title?: string;
  description?: string;
}

export interface AddToPlaylistRequest {
  videoId: string;
}

export interface MovePlaylistVideoRequest {
  direction: "earlier" | "later";
}

/** A playlist of the person, and whether it holds the video. */
export interface PlaylistChoice {
  id: string;
  title: string;
  hasVideo: boolean;
}

export interface PlaylistChoicesResponse {
  playlists: PlaylistChoice[];
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}

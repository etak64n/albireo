// Calls the albireo API from the browser.

import type {
  AddToPlaylistRequest,
  ApiErrorBody,
  AttachmentResponse,
  CommentResponse,
  CompleteUploadRequest,
  CreateCommentRequest,
  CreatePlaylistRequest,
  CreateSeriesRequest,
  CreateUploadRequest,
  CreateUploadResponse,
  HistoryResponse,
  ImageUploadResponse,
  ListCommentsResponse,
  ListPlaylistsResponse,
  ListSeriesResponse,
  ListVideosResponse,
  MeResponse,
  MoveEpisodeRequest,
  MovePlaylistVideoRequest,
  PartUrlsResponse,
  PlaylistChoicesResponse,
  PlaylistResponse,
  RateVideoRequest,
  RatingResponse,
  RandomVideosResponse,
  RecommendationsResponse,
  SearchResponse,
  StartAttachmentRequest,
  StartAttachmentResponse,
  SeriesResponse,
  ThumbnailUploadResponse,
  UpdateMeRequest,
  UpdatePlaylistRequest,
  UpdateSeriesRequest,
  UpdateVideoRequest,
  UserResponse,
  VideoResponse,
  VideoSort,
} from "../shared/api.ts";
import { isPassingStatus, retry } from "../shared/retry.ts";
import { currentMessages } from "./i18n.ts";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

// Reads, and PUTs that put the same thing in the same place, run again after a lost connection
// or a busy server, twice at most. Other changes run once: a change that reached the API before
// its answer got lost must not happen twice, such as a comment.
const RETRIED_METHODS = new Set(["GET", "PUT"]);

async function request<T>(path: string, method: string, body?: unknown): Promise<T> {
  // The demo on GitHub Pages answers from sample data in the browser. The production
  // build drops this branch, and with it the module of the demo.
  if (import.meta.env.MODE === "demo") {
    const { demoResponse } = await import("./demo/api.ts");
    return (await demoResponse(path, method, body)) as T;
  }
  if (!RETRIED_METHODS.has(method)) return send<T>(path, method, body);
  return retry(() => send<T>(path, method, body), {
    attempts: 3,
    firstDelayMs: 500,
    retryable: (error) => error instanceof ApiError && (error.status === 0 || isPassingStatus(error.status)),
  });
}

async function send<T>(path: string, method: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? null : JSON.stringify(body),
    });
  } catch {
    // The network failed, or albireo is not running.
    throw new ApiError(0, "network_error", currentMessages().api.unreachable);
  }
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = isErrorBody(data)
      ? data.error
      : { code: "http_error", message: currentMessages().api.failed(response.status) };
    throw new ApiError(response.status, error.code, error.message);
  }
  return data as T;
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const error: unknown = value.error;
  return typeof error === "object" && error !== null && "code" in error && "message" in error
    && typeof error.code === "string" && typeof error.message === "string";
}

export const api = {
  getMe: () => request<MeResponse>("/api/me", "GET"),
  updateMe: (changes: UpdateMeRequest) => request<MeResponse>("/api/me", "PATCH", changes),
  avatarUpload: () => request<ImageUploadResponse>("/api/me/avatar", "POST"),
  commitAvatar: () => request<MeResponse>("/api/me/avatar/commit", "POST"),
  removeAvatar: () => request<MeResponse>("/api/me/avatar", "DELETE"),
  getUser: (id: string) => request<UserResponse>(`/api/users/${id}`, "GET"),
  getHistory: (cursor: string | null) =>
    request<HistoryResponse>(cursor === null ? "/api/history" : `/api/history?cursor=${encodeURIComponent(cursor)}`, "GET"),
  recordWatch: (videoId: string) => request<void>(`/api/videos/${videoId}/watched`, "POST"),

  /** Lists videos from the newest, or in another order of the whole library (VideoSort). */
  listVideos: (cursor: string | null, uploaderId: string | null = null, sort: VideoSort = "newest") => {
    const query = new URLSearchParams();
    if (sort !== "newest") query.set("sort", sort);
    if (cursor !== null) query.set("cursor", cursor);
    if (uploaderId !== null) query.set("uploader", uploaderId);
    const search = query.toString();
    return request<ListVideosResponse>(search === "" ? "/api/videos" : `/api/videos?${search}`, "GET");
  },
  getRecommendations: () => request<RecommendationsResponse>("/api/recommendations", "GET"),
  /** A page of videos at random from the whole library. */
  getRandomVideos: () => request<RandomVideosResponse>("/api/videos/random", "GET"),
  getVideo: (id: string) => request<VideoResponse>(`/api/videos/${id}`, "GET"),
  updateVideo: (id: string, changes: UpdateVideoRequest) => request<VideoResponse>(`/api/videos/${id}`, "PATCH", changes),
  /** Deletes a video for good, with its files in the bucket. */
  deleteVideo: (id: string) => request<void>(`/api/videos/${id}`, "DELETE"),
  search: (query: string, cursor: string | null) => {
    const search = new URLSearchParams({ q: query });
    if (cursor !== null) search.set("cursor", cursor);
    return request<SearchResponse>(`/api/search?${search.toString()}`, "GET");
  },

  rateVideo: (id: string, stars: number) =>
    request<RatingResponse>(`/api/videos/${id}/rating`, "PUT", { stars } satisfies RateVideoRequest),
  clearRating: (id: string) => request<RatingResponse>(`/api/videos/${id}/rating`, "DELETE"),
  listComments: (videoId: string, cursor: string | null) =>
    request<ListCommentsResponse>(
      cursor === null ? `/api/videos/${videoId}/comments` : `/api/videos/${videoId}/comments?cursor=${encodeURIComponent(cursor)}`,
      "GET",
    ),
  createComment: (videoId: string, body: string) =>
    request<CommentResponse>(`/api/videos/${videoId}/comments`, "POST", { body } satisfies CreateCommentRequest),
  deleteComment: (id: string) => request<void>(`/api/comments/${id}`, "DELETE"),

  startAttachment: (videoId: string, file: StartAttachmentRequest) =>
    request<StartAttachmentResponse>(`/api/videos/${videoId}/attachments`, "POST", file),
  commitAttachment: (id: string) => request<AttachmentResponse>(`/api/attachments/${id}/commit`, "POST"),
  removeAttachment: (id: string) => request<void>(`/api/attachments/${id}`, "DELETE"),

  createUpload: (upload: CreateUploadRequest) => request<CreateUploadResponse>("/api/uploads", "POST", upload),
  partUrls: (id: string, partNumbers: number[]) =>
    request<PartUrlsResponse>(`/api/uploads/${id}/parts`, "POST", { partNumbers }),
  completeUpload: (id: string, completion: CompleteUploadRequest) =>
    request<VideoResponse>(`/api/uploads/${id}/complete`, "POST", completion),
  abortUpload: (id: string) => request<void>(`/api/uploads/${id}/abort`, "POST"),
  thumbnailUpload: (id: string) => request<ThumbnailUploadResponse>(`/api/videos/${id}/thumbnail`, "POST"),
  commitThumbnail: (id: string) => request<VideoResponse>(`/api/videos/${id}/thumbnail/commit`, "POST"),

  listSeries: (ownerId: string | null = null) =>
    request<ListSeriesResponse>(ownerId === null ? "/api/series" : `/api/series?owner=${ownerId}`, "GET"),
  createSeries: (series: CreateSeriesRequest) => request<SeriesResponse>("/api/series", "POST", series),
  getSeries: (id: string) => request<SeriesResponse>(`/api/series/${id}`, "GET"),
  updateSeries: (id: string, changes: UpdateSeriesRequest) => request<SeriesResponse>(`/api/series/${id}`, "PATCH", changes),
  /** Deletes a series. Its videos stay in the library, out of any series. */
  deleteSeries: (id: string) => request<void>(`/api/series/${id}`, "DELETE"),
  moveEpisode: (seriesId: string, videoId: string, direction: MoveEpisodeRequest["direction"]) =>
    request<SeriesResponse>(`/api/series/${seriesId}/episodes/${videoId}/move`, "POST", { direction }),
  removeEpisode: (seriesId: string, videoId: string) =>
    request<SeriesResponse>(`/api/series/${seriesId}/episodes/${videoId}`, "DELETE"),

  listPlaylists: (ownerId: string | null = null) =>
    request<ListPlaylistsResponse>(ownerId === null ? "/api/playlists" : `/api/playlists?owner=${ownerId}`, "GET"),
  createPlaylist: (playlist: CreatePlaylistRequest) => request<PlaylistResponse>("/api/playlists", "POST", playlist),
  getPlaylist: (id: string) => request<PlaylistResponse>(`/api/playlists/${id}`, "GET"),
  updatePlaylist: (id: string, changes: UpdatePlaylistRequest) => request<PlaylistResponse>(`/api/playlists/${id}`, "PATCH", changes),
  /** Deletes a playlist. Its videos stay in the library. */
  deletePlaylist: (id: string) => request<void>(`/api/playlists/${id}`, "DELETE"),
  addToPlaylist: (playlistId: string, videoId: string) =>
    request<PlaylistResponse>(`/api/playlists/${playlistId}/videos`, "POST", { videoId } satisfies AddToPlaylistRequest),
  removeFromPlaylist: (playlistId: string, videoId: string) =>
    request<PlaylistResponse>(`/api/playlists/${playlistId}/videos/${videoId}`, "DELETE"),
  movePlaylistVideo: (playlistId: string, videoId: string, direction: MovePlaylistVideoRequest["direction"]) =>
    request<PlaylistResponse>(`/api/playlists/${playlistId}/videos/${videoId}/move`, "POST", { direction }),
  /** The playlists of the person, each with whether it holds the video. */
  playlistChoices: (videoId: string) => request<PlaylistChoicesResponse>(`/api/videos/${videoId}/playlists`, "GET"),
};

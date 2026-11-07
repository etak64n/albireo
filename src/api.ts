// Calls the albireo API from the browser.

import type {
  ApiErrorBody,
  AttachmentResponse,
  CommentResponse,
  CompleteUploadRequest,
  CreateCommentRequest,
  CreateSeriesRequest,
  CreateUploadRequest,
  CreateUploadResponse,
  HistoryResponse,
  ImageUploadResponse,
  ListCommentsResponse,
  ListSeriesResponse,
  ListVideosResponse,
  MeResponse,
  MoveEpisodeRequest,
  PartUrlsResponse,
  RateVideoRequest,
  RatingResponse,
  RecommendationsResponse,
  SearchResponse,
  StartAttachmentRequest,
  StartAttachmentResponse,
  SeriesResponse,
  SessionsResponse,
  SignInResponse,
  ThumbnailUploadResponse,
  UpdateMeRequest,
  UpdateSeriesRequest,
  UpdateVideoRequest,
  UserResponse,
  VideoResponse,
} from "../shared/api.ts";
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

async function request<T>(path: string, method: string, body?: unknown): Promise<T> {
  // The demo on GitHub Pages answers from sample data in the browser. The production
  // build drops this branch, and with it the module of the demo.
  if (import.meta.env.MODE === "demo") {
    const { demoResponse } = await import("./demo/api.ts");
    return demoResponse(path, method, body) as T;
  }
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? null : JSON.stringify(body),
    });
  } catch {
    // Cloudflare Access redirects to its sign-in page when the session expires,
    // and fetch cannot follow that redirect to another origin.
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
  getSignIn: () => request<SignInResponse>("/api/me/sign-in", "GET"),
  getSessions: () => request<SessionsResponse>("/api/me/sessions", "GET"),
  endSession: () => request<void>("/api/me/sessions/current", "DELETE"),
  getUser: (id: string) => request<UserResponse>(`/api/users/${id}`, "GET"),
  getHistory: (cursor: string | null) =>
    request<HistoryResponse>(cursor === null ? "/api/history" : `/api/history?cursor=${encodeURIComponent(cursor)}`, "GET"),
  recordWatch: (videoId: string) => request<void>(`/api/videos/${videoId}/watched`, "POST"),

  listVideos: (cursor: string | null, uploaderId: string | null = null) => {
    const query = new URLSearchParams();
    if (cursor !== null) query.set("cursor", cursor);
    if (uploaderId !== null) query.set("uploader", uploaderId);
    const search = query.toString();
    return request<ListVideosResponse>(search === "" ? "/api/videos" : `/api/videos?${search}`, "GET");
  },
  getRecommendations: () => request<RecommendationsResponse>("/api/recommendations", "GET"),
  getVideo: (id: string) => request<VideoResponse>(`/api/videos/${id}`, "GET"),
  updateVideo: (id: string, changes: UpdateVideoRequest) => request<VideoResponse>(`/api/videos/${id}`, "PATCH", changes),
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
  moveEpisode: (seriesId: string, videoId: string, direction: MoveEpisodeRequest["direction"]) =>
    request<SeriesResponse>(`/api/series/${seriesId}/episodes/${videoId}/move`, "POST", { direction }),
  removeEpisode: (seriesId: string, videoId: string) =>
    request<SeriesResponse>(`/api/series/${seriesId}/episodes/${videoId}`, "DELETE"),
};

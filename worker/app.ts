// HTTP API of albireo, served under /api.
//
// createApp() takes Cloudflare Access, the storage service, the clock, and ID
// generation as dependencies, so tests can replace them.
//
// Everyone who signs in can watch everything, upload videos, rate them, and
// comment on them. A person edits the videos that they uploaded and the series
// that they created; admins edit everything. A comment can be deleted by its
// author, the uploader of the video, and admins. The uploader of a video and admins
// attach files to it, and everyone downloads them.

import { Hono } from "hono";
import type { JWTVerifyGetKey } from "jose";
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_NAME_MAX_LENGTH,
  BIO_MAX_LENGTH,
  COMMENT_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  DISPLAY_NAME_MAX_LENGTH,
  ID_PATTERN,
  LIST_PAGE_SIZE,
  MAX_PART_URLS_PER_REQUEST,
  RATING_MAX_STARS,
  SEARCH_QUERY_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  type ApiErrorBody,
  type AttachmentResponse,
  type CommentResponse,
  type CreateUploadResponse,
  type EpisodeLink,
  type HistoryResponse,
  type ImageUploadResponse,
  type ListCommentsResponse,
  type ListSeriesResponse,
  type ListVideosResponse,
  type Me,
  type MeResponse,
  type PartUrlsResponse,
  type RatingResponse,
  type RecommendationsResponse,
  type SearchResponse,
  type StartAttachmentResponse,
  type SeriesDetail,
  type SeriesResponse,
  type SeriesSummary,
  type ThumbnailUploadResponse,
  type UserProfile,
  type UserResponse,
  type UserSummary,
  type VideoAttachment,
  type VideoComment,
  type VideoDetail,
  type VideoResponse,
  type VideoSeries,
  type VideoSummary,
  type WatchedVideo,
} from "../shared/api.ts";
import { AccessDeniedError, isLocalhost, verifyAccessToken } from "./access.ts";
import { AttachmentRepository, contentTypeOf, downloadDisposition, type AttachmentRecord } from "./attachments.ts";
import { CommentRepository, type CommentRecord } from "./comments.ts";
import type { D1Database, Env } from "./env.ts";
import {
  badRequest,
  conflict,
  forbidden,
  HttpError,
  notFound,
  readArray,
  readInteger,
  readJsonObject,
  readNullableId,
  readNullableNumber,
  readOptionalNullableId,
  readOptionalString,
  readString,
  type JsonObject,
} from "./http.ts";
import { errorFields, log } from "./log.ts";
import { RatingRepository } from "./ratings.ts";
import { ConfigurationError, readRuntimeConfig, type RuntimeConfig } from "./runtime-config.ts";
import { SeriesRepository, type SeriesRecord } from "./series.ts";
import { StorageError, type CompletedPart, type ObjectStore } from "./storage.ts";
import { MAX_OBJECT_SIZE, planParts, type PartPlan } from "./upload-plan.ts";
import { UserRepository, type UserRecord } from "./users.ts";
import { VideoRepository, type ListCursor, type VideoRecord, type WatchedVideoRecord } from "./videos.ts";

export type IdKind = "video" | "user" | "series" | "comment" | "attachment";

export interface AppDependencies {
  /** Signing keys of the Access team that protects the deployment. */
  keySetFor: (teamDomain: string) => JWTVerifyGetKey;
  objectStoreFor: (config: RuntimeConfig) => ObjectStore;
  now: () => Date;
  /** Returns a new ID for a video, a user, a series, a comment, or an attachment. */
  newId: (kind: IdKind) => string;
}

/** The signed-in person who sent the request. */
interface Viewer {
  id: string;
  email: string;
  displayName: string;
  bio: string;
  avatarKey: string | null;
  isAdmin: boolean;
}

interface AppEnv {
  Bindings: Env;
  Variables: { requestId: string; config: RuntimeConfig; viewer: Viewer };
}

type UploadingVideo = VideoRecord & { uploadId: string };

// Thumbnails and the pictures of people are JPEG images that the browser makes.
const THUMBNAIL_CONTENT_TYPE = "image/jpeg";
const VIDEO_CONTENT_TYPE = /^video\/[A-Za-z0-9.+-]{1,100}$/;
const FILE_NAME_MAX_LENGTH = 1024;
const ETAG_MAX_LENGTH = 256;
const MAX_DURATION_SEC = 10_000_000;
const MAX_DIMENSION = 100_000;
// Recommendations look at this many of the newest videos and of the last watched ones,
// and continue this many series. The limits keep one request quick in a large library.
const RECOMMENDATION_POOL = 500;
const SERIES_TO_CONTINUE = 8;
// A search takes at most this many words, and pages reach at most this far into the results.
const SEARCH_MAX_TERMS = 10;
const SEARCH_MAX_OFFSET = 10_000;
// Access serves this path on every domain that it protects. It ends the session of the person.
const ACCESS_LOGOUT_PATH = "/cdn-cgi/access/logout";

export function createApp(deps: AppDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const now = () => deps.now().toISOString();
  const store = (config: RuntimeConfig): ObjectStore => deps.objectStoreFor(config);

  // Every API request needs complete configuration and a signed-in person.
  app.use("/api/*", async (c, next) => {
    c.set("requestId", c.req.header("cf-ray") ?? crypto.randomUUID());
    c.header("Cache-Control", "no-store");
    const config = readRuntimeConfig(c.env, c.req.url);
    c.set("config", config);
    let email: string;
    if (config.authMode === "local-development") {
      if (!isLocalhost(new URL(c.req.url))) {
        throw new HttpError(403, "forbidden", "Local development mode answers requests to localhost only.");
      }
      if (config.localUserEmail === null) throw new ConfigurationError(["LOCAL_USER_EMAIL is not set."]);
      email = config.localUserEmail;
    } else {
      const token = c.req.header("cf-access-jwt-assertion");
      const identity = await verifyAccessToken(token, config.access, deps.keySetFor(config.access.teamDomain));
      if (identity.email === null) {
        throw new AccessDeniedError("The Cloudflare Access token names no person. albireo needs a person who signs in.");
      }
      email = identity.email.toLowerCase();
    }
    const user = await new UserRepository(c.env.DB).ensure(email, () => deps.newId("user"), now());
    c.set("viewer", { ...viewerOf(user), isAdmin: config.admins.has(user.email) });
    await next();
  });

  app.get("/api/me", async (c) => c.json<MeResponse>({ me: await toMe(c.get("viewer"), c.get("config"), store(c.get("config"))) }));

  app.patch("/api/me", async (c) => {
    const body = await readJsonObject(c.req.raw, ["displayName", "bio"]);
    const displayName = readOptionalString(body, "displayName", { min: 1, max: DISPLAY_NAME_MAX_LENGTH, trim: true });
    const bio = readOptionalString(body, "bio", { min: 0, max: BIO_MAX_LENGTH, trim: false });
    if (displayName === undefined && bio === undefined) throw badRequest("Send a displayName, a bio, or both.");
    const viewer = c.get("viewer");
    const users = new UserRepository(c.env.DB);
    await users.updateProfile(viewer.id, { displayName, bio }, now());
    return c.json<MeResponse>({ me: await toMe(await reloadViewer(users, viewer), c.get("config"), store(c.get("config"))) });
  });

  // The picture of a person: the browser uploads a JPEG to the signed URL, then commits it.
  app.post("/api/me/avatar", async (c) => {
    const url = await store(c.get("config")).presignPut(avatarKey(c.get("viewer").id), THUMBNAIL_CONTENT_TYPE);
    return c.json<ImageUploadResponse>({ url, contentType: THUMBNAIL_CONTENT_TYPE });
  });

  app.post("/api/me/avatar/commit", async (c) => {
    const viewer = c.get("viewer");
    const objectStore = store(c.get("config"));
    const key = avatarKey(viewer.id);
    if ((await objectStore.headObject(key)) === null) throw conflict("Upload the picture to the signed URL before committing it.");
    const users = new UserRepository(c.env.DB);
    await users.setAvatar(viewer.id, key, now());
    return c.json<MeResponse>({ me: await toMe(await reloadViewer(users, viewer), c.get("config"), objectStore) });
  });

  // Goes back to the default person icon. The old picture stays in the bucket until the next upload replaces it.
  app.delete("/api/me/avatar", async (c) => {
    const viewer = c.get("viewer");
    const users = new UserRepository(c.env.DB);
    await users.setAvatar(viewer.id, null, now());
    return c.json<MeResponse>({ me: await toMe(await reloadViewer(users, viewer), c.get("config"), store(c.get("config"))) });
  });

  app.get("/api/users/:id", async (c) => {
    const user = await new UserRepository(c.env.DB).find(pathId(c.req.param("id"), "user"));
    if (user === null) throw notFound("No user has this ID.");
    return c.json<UserResponse>({ user: await toProfile(user, store(c.get("config"))) });
  });

  // The history of the signed-in person. Nobody sees the history of someone else.
  app.get("/api/history", async (c) => {
    const cursor = c.req.query("cursor");
    const rows = await new VideoRepository(c.env.DB).listWatched(
      c.get("viewer").id,
      LIST_PAGE_SIZE + 1,
      cursor === undefined ? null : decodeCursor(cursor),
    );
    const page = rows.slice(0, LIST_PAGE_SIZE);
    const objectStore = store(c.get("config"));
    const videos = await Promise.all(
      page.map(async (video): Promise<WatchedVideo> => ({ ...(await toSummary(video, objectStore)), watchedAt: video.watchedAt })),
    );
    const last = page.at(-1);
    const nextCursor = rows.length > LIST_PAGE_SIZE && last !== undefined
      ? encodeCursor({ createdAt: last.watchedAt, id: last.id })
      : null;
    return c.json<HistoryResponse>({ videos, nextCursor });
  });

  app.get("/api/recommendations", async (c) => {
    const videos = new VideoRepository(c.env.DB);
    const [recent, history] = await Promise.all([
      videos.listReady(RECOMMENDATION_POOL, null, { uploaderId: null }),
      videos.listWatched(c.get("viewer").id, RECOMMENDATION_POOL, null),
    ]);
    const picks = (await recommend(videos, recent, history)).slice(0, LIST_PAGE_SIZE);
    const objectStore = store(c.get("config"));
    return c.json<RecommendationsResponse>({ videos: await Promise.all(picks.map((video) => toSummary(video, objectStore))) });
  });

  // The player calls this when playback starts, so the video moves to the front of the history.
  app.post("/api/videos/:id/watched", async (c) => {
    const repository = new VideoRepository(c.env.DB);
    const video = await findReady(repository, pathId(c.req.param("id"), "video"));
    await repository.recordWatch(c.get("viewer").id, video.id, now());
    return c.body(null, 204);
  });

  app.get("/api/videos", async (c) => {
    const cursor = c.req.query("cursor");
    const uploader = c.req.query("uploader");
    if (uploader !== undefined && !ID_PATTERN.test(uploader)) throw badRequest("uploader must be a user ID.");
    const rows = await new VideoRepository(c.env.DB).listReady(
      LIST_PAGE_SIZE + 1,
      cursor === undefined ? null : decodeCursor(cursor),
      { uploaderId: uploader ?? null },
    );
    const page = rows.slice(0, LIST_PAGE_SIZE);
    const objectStore = store(c.get("config"));
    const videos = await Promise.all(page.map((video) => toSummary(video, objectStore)));
    const last = page.at(-1);
    const nextCursor = rows.length > LIST_PAGE_SIZE && last !== undefined
      ? encodeCursor({ createdAt: last.createdAt, id: last.id })
      : null;
    return c.json<ListVideosResponse>({ videos, nextCursor });
  });

  app.get("/api/videos/:id", async (c) => {
    const video = await findReady(new VideoRepository(c.env.DB), pathId(c.req.param("id"), "video"));
    return c.json<VideoResponse>({ video: await toDetail(c.env.DB, video, c.get("viewer"), store(c.get("config"))) });
  });

  app.patch("/api/videos/:id", async (c) => {
    const id = pathId(c.req.param("id"), "video");
    const body = await readJsonObject(c.req.raw, ["title", "description", "seriesId"]);
    const title = readOptionalString(body, "title", { min: 1, max: TITLE_MAX_LENGTH, trim: true });
    const description = readOptionalString(body, "description", { min: 0, max: DESCRIPTION_MAX_LENGTH, trim: false });
    const seriesId = readOptionalNullableId(body, "seriesId", ID_PATTERN);
    if (title === undefined && description === undefined && seriesId === undefined) {
      throw badRequest("Send a title, a description, a seriesId, or more than one of them.");
    }
    const repository = new VideoRepository(c.env.DB);
    const video = await findReady(repository, id);
    const viewer = c.get("viewer");
    if (!canEditVideo(viewer, video)) throw forbidden("Only the uploader of the video or an admin can edit it.");
    const time = now();
    if (title !== undefined || description !== undefined) await repository.updateDetails(id, { title, description }, time);
    if (seriesId !== undefined && seriesId !== video.seriesId) {
      const seriesRepository = new SeriesRepository(c.env.DB);
      if (seriesId !== null && (await seriesRepository.find(seriesId)) === null) throw badRequest("No series has this seriesId.");
      await repository.setSeries(id, seriesId, time);
      for (const changed of [video.seriesId, seriesId]) {
        if (changed !== null) await seriesRepository.touch(changed, time);
      }
    }
    const edited = await findReady(repository, id);
    return c.json<VideoResponse>({ video: await toDetail(c.env.DB, edited, viewer, store(c.get("config"))) });
  });

  // Each person gives a video 1 to 5 stars, or takes their rating back.
  app.put("/api/videos/:id/rating", async (c) => {
    const body = await readJsonObject(c.req.raw, ["stars"]);
    const stars = readInteger(body, "stars", 1, RATING_MAX_STARS);
    const video = await findReady(new VideoRepository(c.env.DB), pathId(c.req.param("id"), "video"));
    const ratings = new RatingRepository(c.env.DB);
    const viewer = c.get("viewer");
    await ratings.set(video.id, viewer.id, stars, now());
    return c.json<RatingResponse>({ rating: await ratings.summary(video.id, viewer.id) });
  });

  app.delete("/api/videos/:id/rating", async (c) => {
    const video = await findReady(new VideoRepository(c.env.DB), pathId(c.req.param("id"), "video"));
    const ratings = new RatingRepository(c.env.DB);
    const viewer = c.get("viewer");
    await ratings.clear(video.id, viewer.id);
    return c.json<RatingResponse>({ rating: await ratings.summary(video.id, viewer.id) });
  });

  app.get("/api/videos/:id/comments", async (c) => {
    const video = await findReady(new VideoRepository(c.env.DB), pathId(c.req.param("id"), "video"));
    const cursor = c.req.query("cursor");
    const comments = new CommentRepository(c.env.DB);
    const rows = await comments.list(video.id, LIST_PAGE_SIZE + 1, cursor === undefined ? null : decodeCursor(cursor));
    const page = rows.slice(0, LIST_PAGE_SIZE);
    const viewer = c.get("viewer");
    const objectStore = store(c.get("config"));
    const last = page.at(-1);
    return c.json<ListCommentsResponse>({
      comments: await Promise.all(page.map((comment) => toComment(comment, video, viewer, objectStore))),
      nextCursor: rows.length > LIST_PAGE_SIZE && last !== undefined
        ? encodeCursor({ createdAt: last.createdAt, id: last.id })
        : null,
    });
  });

  app.post("/api/videos/:id/comments", async (c) => {
    const body = await readJsonObject(c.req.raw, ["body"]);
    const text = readString(body, "body", { min: 1, max: COMMENT_MAX_LENGTH, trim: true });
    const video = await findReady(new VideoRepository(c.env.DB), pathId(c.req.param("id"), "video"));
    const comments = new CommentRepository(c.env.DB);
    const viewer = c.get("viewer");
    const id = deps.newId("comment");
    await comments.insert({ id, videoId: video.id, authorId: viewer.id, body: text, createdAt: now() });
    const comment = await comments.find(id);
    if (comment === null) throw new Error(`The new comment ${id} is missing.`);
    return c.json<CommentResponse>({ comment: await toComment(comment, video, viewer, store(c.get("config"))) }, 201);
  });

  app.delete("/api/comments/:id", async (c) => {
    const comments = new CommentRepository(c.env.DB);
    const comment = await comments.find(pathId(c.req.param("id"), "comment"));
    if (comment === null) throw notFound("No comment has this ID.");
    const video = await new VideoRepository(c.env.DB).find(comment.videoId);
    if (!canDeleteComment(c.get("viewer"), comment, video)) {
      throw forbidden("Only the author of the comment, the uploader of the video, or an admin can delete it.");
    }
    await comments.delete(comment.id);
    return c.body(null, 204);
  });

  // The browser uploads an attachment straight to the bucket, then commits it.
  app.post("/api/videos/:id/attachments", async (c) => {
    const body = await readJsonObject(c.req.raw, ["fileName", "fileSize"]);
    const fileName = readString(body, "fileName", { min: 1, max: ATTACHMENT_NAME_MAX_LENGTH, trim: true });
    const fileSize = readInteger(body, "fileSize", 0, ATTACHMENT_MAX_BYTES);
    const video = await findReady(new VideoRepository(c.env.DB), pathId(c.req.param("id"), "video"));
    if (!canEditVideo(c.get("viewer"), video)) throw forbidden("Only the uploader of the video or an admin can attach files to it.");
    const id = deps.newId("attachment");
    const contentType = contentTypeOf(fileName);
    await new AttachmentRepository(c.env.DB).insertUploading({ id, videoId: video.id, fileName, contentType, fileSize, createdAt: now() });
    const url = await store(c.get("config")).presignPut(attachmentKey(video.id, id), contentType);
    return c.json<StartAttachmentResponse>({ attachmentId: id, url, contentType }, 201);
  });

  app.post("/api/attachments/:id/commit", async (c) => {
    const attachments = new AttachmentRepository(c.env.DB);
    const attachment = await findAttachment(attachments, new VideoRepository(c.env.DB), pathId(c.req.param("id"), "attachment"), c.get("viewer"));
    if (attachment.status !== "uploading") throw conflict("The attachment is already committed.");
    const objectStore = store(c.get("config"));
    const object = await objectStore.headObject(attachmentKey(attachment.videoId, attachment.id));
    if (object === null) throw conflict("The file is not in the storage service. Upload it with the signed URL first.");
    if (object.size > ATTACHMENT_MAX_BYTES) throw badRequest(`Attachments can be at most ${ATTACHMENT_MAX_BYTES} bytes.`);
    await attachments.markReady(attachment.id, object.size);
    return c.json<AttachmentResponse>({
      attachment: await toAttachment({ ...attachment, status: "ready", fileSize: object.size }, objectStore),
    });
  });

  app.delete("/api/attachments/:id", async (c) => {
    const attachments = new AttachmentRepository(c.env.DB);
    const attachment = await findAttachment(attachments, new VideoRepository(c.env.DB), pathId(c.req.param("id"), "attachment"), c.get("viewer"));
    await attachments.delete(attachment.id);
    return c.body(null, 204);
  });

  // The cursor of a search is how many results the earlier pages held.
  app.get("/api/search", async (c) => {
    const terms = searchTerms(c.req.query("q"));
    const offset = searchOffset(c.req.query("cursor"));
    const rows = await new VideoRepository(c.env.DB).search(terms, LIST_PAGE_SIZE + 1, offset);
    const page = rows.slice(0, LIST_PAGE_SIZE);
    const objectStore = store(c.get("config"));
    return c.json<SearchResponse>({
      videos: await Promise.all(page.map((video) => toSummary(video, objectStore))),
      nextCursor: rows.length > LIST_PAGE_SIZE ? String(offset + LIST_PAGE_SIZE) : null,
    });
  });

  app.post("/api/uploads", async (c) => {
    const body = await readJsonObject(c.req.raw, ["title", "fileName", "fileSize", "contentType", "seriesId"]);
    const title = readString(body, "title", { min: 1, max: TITLE_MAX_LENGTH, trim: true });
    const fileName = readString(body, "fileName", { min: 1, max: FILE_NAME_MAX_LENGTH, trim: false });
    const fileSize = readInteger(body, "fileSize", 1, MAX_OBJECT_SIZE);
    const contentType = readString(body, "contentType", { min: 1, max: 120, trim: false });
    const seriesId = readNullableId(body, "seriesId", ID_PATTERN);
    if (!VIDEO_CONTENT_TYPE.test(contentType)) throw badRequest("contentType must be a video type, such as video/mp4.");
    if (seriesId !== null && (await new SeriesRepository(c.env.DB).find(seriesId)) === null) {
      throw badRequest("No series has this seriesId.");
    }
    const plan = planUpload(fileSize);
    const id = deps.newId("video");
    const objectKey = `videos/${id}/original${extensionOf(fileName)}`;
    const uploadId = await store(c.get("config")).createMultipartUpload(objectKey, contentType);
    await new VideoRepository(c.env.DB).insertUploading({
      id,
      title,
      description: "",
      objectKey,
      uploadId,
      contentType,
      fileSize,
      partSize: plan.partSize,
      partCount: plan.partCount,
      createdAt: now(),
      uploaderId: c.get("viewer").id,
      seriesId,
    });
    log("INFO", "Upload started", c.get("requestId"), { videoId: id, fileSize, partCount: plan.partCount });
    return c.json<CreateUploadResponse>({ videoId: id, partSize: plan.partSize, partCount: plan.partCount }, 201);
  });

  app.post("/api/uploads/:id/parts", async (c) => {
    const upload = await findUploading(new VideoRepository(c.env.DB), pathId(c.req.param("id"), "upload"), c.get("viewer"));
    const body = await readJsonObject(c.req.raw, ["partNumbers"]);
    const partNumbers = readArray(body, "partNumbers", 1, MAX_PART_URLS_PER_REQUEST).map((value) => {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > upload.partCount) {
        throw badRequest(`partNumbers must hold whole numbers from 1 to ${upload.partCount}.`);
      }
      return value;
    });
    if (new Set(partNumbers).size !== partNumbers.length) throw badRequest("partNumbers must not repeat a part number.");
    const objectStore = store(c.get("config"));
    const parts = await Promise.all(
      partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await objectStore.presignUploadPart(upload.objectKey, upload.uploadId, partNumber),
      })),
    );
    return c.json<PartUrlsResponse>({ parts });
  });

  app.post("/api/uploads/:id/complete", async (c) => {
    const id = pathId(c.req.param("id"), "upload");
    const repository = new VideoRepository(c.env.DB);
    const viewer = c.get("viewer");
    const upload = await findUploading(repository, id, viewer);
    const body = await readJsonObject(c.req.raw, ["parts", "durationSec", "width", "height"]);
    const parts = readCompletedParts(body, upload.partCount);
    const media = {
      durationSec: readNullableNumber(body, "durationSec", 0, MAX_DURATION_SEC, false),
      width: readNullableNumber(body, "width", 1, MAX_DIMENSION, true),
      height: readNullableNumber(body, "height", 1, MAX_DIMENSION, true),
    };
    const objectStore = store(c.get("config"));
    await objectStore.completeMultipartUpload(upload.objectKey, upload.uploadId, parts);
    const stored = await objectStore.headObject(upload.objectKey);
    if (stored === null || stored.size !== upload.fileSize) {
      const found = stored === null ? "no object" : `${stored.size} bytes`;
      throw new StorageError(`The storage service holds ${found} after the upload, not the ${upload.fileSize} bytes that were announced.`);
    }
    const time = now();
    if (!(await repository.markReady(id, media, time))) {
      throw conflict("The upload is no longer in progress.");
    }
    if (upload.seriesId !== null) await new SeriesRepository(c.env.DB).touch(upload.seriesId, time);
    log("INFO", "Upload completed", c.get("requestId"), { videoId: id, fileSize: upload.fileSize });
    const video = await findReady(repository, id);
    return c.json<VideoResponse>({ video: await toDetail(c.env.DB, video, viewer, objectStore) });
  });

  app.post("/api/uploads/:id/abort", async (c) => {
    const id = pathId(c.req.param("id"), "upload");
    const repository = new VideoRepository(c.env.DB);
    const upload = await findUploading(repository, id, c.get("viewer"));
    try {
      await store(c.get("config")).abortMultipartUpload(upload.objectKey, upload.uploadId);
    } catch (error) {
      // The row goes away regardless. A lifecycle rule on the bucket removes parts left behind.
      log("WARN", "Could not abort the multipart upload", c.get("requestId"), { videoId: id, ...errorFields(error) });
    }
    await repository.deleteUploading(id);
    log("INFO", "Upload canceled", c.get("requestId"), { videoId: id });
    return c.body(null, 204);
  });

  app.post("/api/videos/:id/thumbnail", async (c) => {
    const video = await findReady(new VideoRepository(c.env.DB), pathId(c.req.param("id"), "video"));
    if (!canEditVideo(c.get("viewer"), video)) throw forbidden("Only the uploader of the video or an admin can change its thumbnail.");
    const url = await store(c.get("config")).presignPut(thumbnailKey(video.id), THUMBNAIL_CONTENT_TYPE);
    return c.json<ThumbnailUploadResponse>({ url, contentType: THUMBNAIL_CONTENT_TYPE });
  });

  app.post("/api/videos/:id/thumbnail/commit", async (c) => {
    const id = pathId(c.req.param("id"), "video");
    const repository = new VideoRepository(c.env.DB);
    const viewer = c.get("viewer");
    const video = await findReady(repository, id);
    if (!canEditVideo(viewer, video)) throw forbidden("Only the uploader of the video or an admin can change its thumbnail.");
    const objectStore = store(c.get("config"));
    const key = thumbnailKey(id);
    if ((await objectStore.headObject(key)) === null) {
      throw conflict("Upload the thumbnail to the signed URL before committing it.");
    }
    await repository.setThumbnail(id, key, now());
    const committed = await findReady(repository, id);
    return c.json<VideoResponse>({ video: await toDetail(c.env.DB, committed, viewer, objectStore) });
  });

  app.get("/api/series", async (c) => {
    const owner = c.req.query("owner");
    if (owner !== undefined && !ID_PATTERN.test(owner)) throw badRequest("owner must be a user ID.");
    const objectStore = store(c.get("config"));
    const list = await new SeriesRepository(c.env.DB).list(owner ?? null);
    return c.json<ListSeriesResponse>({ series: await Promise.all(list.map((series) => toSeriesSummary(series, objectStore))) });
  });

  app.post("/api/series", async (c) => {
    const body = await readJsonObject(c.req.raw, ["title", "description"]);
    const title = readString(body, "title", { min: 1, max: TITLE_MAX_LENGTH, trim: true });
    const description = readString(body, "description", { min: 0, max: DESCRIPTION_MAX_LENGTH, trim: false });
    const repository = new SeriesRepository(c.env.DB);
    const id = deps.newId("series");
    await repository.insert({ id, title, description, ownerId: c.get("viewer").id, createdAt: now() });
    const series = await findSeries(repository, id);
    return c.json<SeriesResponse>({ series: await toSeriesDetail(c.env.DB, series, c.get("viewer"), store(c.get("config"))) }, 201);
  });

  app.get("/api/series/:id", async (c) => {
    const series = await findSeries(new SeriesRepository(c.env.DB), pathId(c.req.param("id"), "series"));
    return c.json<SeriesResponse>({ series: await toSeriesDetail(c.env.DB, series, c.get("viewer"), store(c.get("config"))) });
  });

  app.patch("/api/series/:id", async (c) => {
    const id = pathId(c.req.param("id"), "series");
    const body = await readJsonObject(c.req.raw, ["title", "description"]);
    const title = readOptionalString(body, "title", { min: 1, max: TITLE_MAX_LENGTH, trim: true });
    const description = readOptionalString(body, "description", { min: 0, max: DESCRIPTION_MAX_LENGTH, trim: false });
    if (title === undefined && description === undefined) throw badRequest("Send a title, a description, or both.");
    const repository = new SeriesRepository(c.env.DB);
    const viewer = c.get("viewer");
    if (!canEditSeries(viewer, await findSeries(repository, id))) {
      throw forbidden("Only the creator of the series or an admin can edit it.");
    }
    await repository.updateDetails(id, { title, description }, now());
    return c.json<SeriesResponse>({
      series: await toSeriesDetail(c.env.DB, await findSeries(repository, id), viewer, store(c.get("config"))),
    });
  });

  // Moves an episode one place earlier or later.
  app.post("/api/series/:id/episodes/:videoId/move", async (c) => {
    const seriesRepository = new SeriesRepository(c.env.DB);
    const series = await findSeries(seriesRepository, pathId(c.req.param("id"), "series"));
    const videoId = pathId(c.req.param("videoId"), "video");
    const body = await readJsonObject(c.req.raw, ["direction"]);
    const direction = readString(body, "direction", { min: 1, max: 10, trim: false });
    if (direction !== "earlier" && direction !== "later") throw badRequest('direction must be "earlier" or "later".');
    const viewer = c.get("viewer");
    if (!canEditSeries(viewer, series)) throw forbidden("Only the creator of the series or an admin can reorder it.");
    const videos = new VideoRepository(c.env.DB);
    const episodes = await videos.listEpisodes(series.id);
    const index = episodes.findIndex((episode) => episode.id === videoId);
    const episode = episodes[index];
    if (episode === undefined) throw notFound("The series has no ready episode with this ID.");
    const neighbor = episodes[direction === "earlier" ? index - 1 : index + 1];
    if (neighbor === undefined) throw conflict(`The episode is already the ${direction === "earlier" ? "first" : "last"} one.`);
    await videos.swapEpisodes(episode, neighbor);
    await seriesRepository.touch(series.id, now());
    return c.json<SeriesResponse>({
      series: await toSeriesDetail(c.env.DB, await findSeries(seriesRepository, series.id), viewer, store(c.get("config"))),
    });
  });

  // Takes a video out of a series. The creator of the series, the uploader of the video, and admins can.
  app.delete("/api/series/:id/episodes/:videoId", async (c) => {
    const seriesRepository = new SeriesRepository(c.env.DB);
    const series = await findSeries(seriesRepository, pathId(c.req.param("id"), "series"));
    const videos = new VideoRepository(c.env.DB);
    const video = await findReady(videos, pathId(c.req.param("videoId"), "video"));
    if (video.seriesId !== series.id) throw notFound("The series has no episode with this ID.");
    const viewer = c.get("viewer");
    if (!canEditSeries(viewer, series) && !canEditVideo(viewer, video)) {
      throw forbidden("Only the creator of the series, the uploader of the video, or an admin can take it out.");
    }
    const time = now();
    await videos.setSeries(video.id, null, time);
    await seriesRepository.touch(series.id, time);
    return c.json<SeriesResponse>({
      series: await toSeriesDetail(c.env.DB, await findSeries(seriesRepository, series.id), viewer, store(c.get("config"))),
    });
  });

  app.notFound((c) => c.json<ApiErrorBody>(errorBody("not_found", "No API endpoint matches this request."), 404));

  app.onError((error, c) => {
    const requestId: string | undefined = c.get("requestId");
    if (error instanceof HttpError) {
      return c.json<ApiErrorBody>(errorBody(error.code, error.message), error.status);
    }
    if (error instanceof AccessDeniedError) {
      return c.json<ApiErrorBody>(errorBody("unauthorized", error.message), 401);
    }
    if (error instanceof StorageError) {
      log("ERROR", "A storage request failed", requestId ?? null, errorFields(error));
      return c.json<ApiErrorBody>(errorBody("storage_error", error.message), 502);
    }
    if (error instanceof ConfigurationError) {
      log("ERROR", "The Worker configuration is incomplete", requestId ?? null, { problems: error.problems });
      return c.json<ApiErrorBody>(
        errorBody("misconfigured", "The Worker configuration is incomplete. The Worker logs list the problems."),
        500,
      );
    }
    log("ERROR", "A request failed", requestId ?? null, { method: c.req.method, path: c.req.path, ...errorFields(error) });
    return c.json<ApiErrorBody>(errorBody("internal_error", "The request failed. The Worker logs have the details."), 500);
  });

  return app;
}

/**
 * Orders videos for one person, from the most likely to be wanted:
 * 1. the next episode of each series that they are watching, from the series watched last,
 * 2. the videos that they have not watched, first those of the series and the uploaders that
 *    they watched before, then from the newest,
 * 3. the videos that they watched, from the one watched longest ago.
 */
async function recommend(videos: VideoRepository, recent: VideoRecord[], history: WatchedVideoRecord[]): Promise<VideoRecord[]> {
  const watched = new Set(history.map((video) => video.id));
  const picked = new Set<string>();
  const result: VideoRecord[] = [];
  const take = (video: VideoRecord) => {
    if (picked.has(video.id)) return;
    picked.add(video.id);
    result.push(video);
  };

  // The history runs from the last watched, so the first video of a series in it is the episode watched last.
  const lastWatched = new Map<string, string>();
  for (const video of history) {
    if (video.seriesId !== null && !lastWatched.has(video.seriesId)) lastWatched.set(video.seriesId, video.id);
  }
  for (const [seriesId, videoId] of [...lastWatched].slice(0, SERIES_TO_CONTINUE)) {
    const episodes = await videos.listEpisodes(seriesId);
    const index = episodes.findIndex((episode) => episode.id === videoId);
    const next = episodes.slice(index + 1).find((episode) => !watched.has(episode.id));
    if (next !== undefined) take(next);
  }

  const familiarUploaders = new Set(history.flatMap((video) => (video.uploaderId === null ? [] : [video.uploaderId])));
  const familiarity = (video: VideoRecord) =>
    (video.seriesId !== null && lastWatched.has(video.seriesId) ? 2 : 0)
    + (video.uploaderId !== null && familiarUploaders.has(video.uploaderId) ? 1 : 0);
  recent
    .filter((video) => !watched.has(video.id))
    .map((video, newness) => ({ video, newness, score: familiarity(video) }))
    .sort((a, b) => b.score - a.score || a.newness - b.newness)
    .forEach(({ video }) => take(video));

  [...history].reverse().forEach(take);
  return result;
}

function canEditVideo(viewer: Viewer, video: VideoRecord): boolean {
  return viewer.isAdmin || video.uploaderId === viewer.id;
}

function canEditSeries(viewer: Viewer, series: SeriesRecord): boolean {
  return viewer.isAdmin || series.ownerId === viewer.id;
}

// Only the uploader of the video and admins can commit and remove its attachments.
async function findAttachment(
  attachments: AttachmentRepository,
  videos: VideoRepository,
  id: string,
  viewer: Viewer,
): Promise<AttachmentRecord> {
  const attachment = await attachments.find(id);
  if (attachment === null) throw notFound("No attachment has this ID.");
  const video = await videos.find(attachment.videoId);
  if (video === null || !canEditVideo(viewer, video)) {
    throw forbidden("Only the uploader of the video or an admin can change its attachments.");
  }
  return attachment;
}

async function toAttachment(attachment: AttachmentRecord, store: ObjectStore): Promise<VideoAttachment> {
  const key = attachmentKey(attachment.videoId, attachment.id);
  return {
    id: attachment.id,
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    fileSize: attachment.fileSize,
    createdAt: attachment.createdAt,
    viewUrl: await store.presignGet(key),
    downloadUrl: await store.presignGet(key, downloadDisposition(attachment.fileName)),
  };
}

function canDeleteComment(viewer: Viewer, comment: CommentRecord, video: VideoRecord | null): boolean {
  return viewer.isAdmin || comment.authorId === viewer.id || (video !== null && video.uploaderId === viewer.id);
}

async function toComment(comment: CommentRecord, video: VideoRecord, viewer: Viewer, store: ObjectStore): Promise<VideoComment> {
  return {
    id: comment.id,
    body: comment.body,
    createdAt: comment.createdAt,
    author: { id: comment.authorId, displayName: comment.authorName, avatarUrl: await signedOrNull(store, comment.authorAvatarKey) },
    canDelete: canDeleteComment(viewer, comment, video),
  };
}

// The words of a query are separated by spaces, also the wide space of Japanese text.
function searchTerms(query: string | undefined): string[] {
  const text = (query ?? "").trim();
  if (text === "" || text.length > SEARCH_QUERY_MAX_LENGTH) {
    throw badRequest(`q must be 1 to ${SEARCH_QUERY_MAX_LENGTH} characters long.`);
  }
  const terms = [...new Set(text.split(/\s+/u))];
  if (terms.length > SEARCH_MAX_TERMS) throw badRequest(`q can have at most ${SEARCH_MAX_TERMS} words.`);
  return terms;
}

function searchOffset(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const offset = /^\d{1,6}$/.test(cursor) ? Number(cursor) : Number.NaN;
  if (Number.isNaN(offset) || offset > SEARCH_MAX_OFFSET) throw badRequest("cursor must be a cursor that the API returned.");
  return offset;
}

function viewerOf(user: UserRecord): Omit<Viewer, "isAdmin"> {
  return { id: user.id, email: user.email, displayName: user.displayName, bio: user.bio, avatarKey: user.avatarKey };
}

async function reloadViewer(users: UserRepository, viewer: Viewer): Promise<Viewer> {
  const user = await users.find(viewer.id);
  if (user === null) throw new Error(`The signed-in user ${viewer.id} is missing.`);
  return { ...viewerOf(user), isAdmin: viewer.isAdmin };
}

async function toMe(viewer: Viewer, config: RuntimeConfig, store: ObjectStore): Promise<Me> {
  return {
    id: viewer.id,
    displayName: viewer.displayName,
    avatarUrl: await signedOrNull(store, viewer.avatarKey),
    bio: viewer.bio,
    email: viewer.email,
    isAdmin: viewer.isAdmin,
    logoutUrl: config.authMode === "cloudflare-access" ? ACCESS_LOGOUT_PATH : null,
  };
}

async function toProfile(user: UserRecord, store: ObjectStore): Promise<UserProfile> {
  return { id: user.id, displayName: user.displayName, avatarUrl: await signedOrNull(store, user.avatarKey), bio: user.bio };
}

async function signedOrNull(store: ObjectStore, key: string | null): Promise<string | null> {
  return key === null ? null : store.presignGet(key);
}

function pathId(value: string | undefined, what: string): string {
  if (value === undefined || !ID_PATTERN.test(value)) throw notFound(`No ${what} has this ID.`);
  return value;
}

async function findReady(repository: VideoRepository, id: string): Promise<VideoRecord> {
  const video = await repository.find(id);
  if (video === null || video.status !== "ready") throw notFound("No ready video has this ID.");
  return video;
}

// Only the person who started an upload, or an admin, can continue or cancel it.
async function findUploading(repository: VideoRepository, id: string, viewer: Viewer): Promise<UploadingVideo> {
  const video = await repository.find(id);
  if (video === null || video.status !== "uploading" || video.uploadId === null) {
    throw notFound("No upload in progress has this ID.");
  }
  if (!canEditVideo(viewer, video)) throw forbidden("Only the person who started the upload can continue or cancel it.");
  return { ...video, uploadId: video.uploadId };
}

async function findSeries(repository: SeriesRepository, id: string): Promise<SeriesRecord> {
  const series = await repository.find(id);
  if (series === null) throw notFound("No series has this ID.");
  return series;
}

function planUpload(fileSize: number): PartPlan {
  try {
    return planParts(fileSize);
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : String(error));
  }
}

// The browser must report every part exactly once, with the ETag that the storage service returned.
function readCompletedParts(body: JsonObject, partCount: number): CompletedPart[] {
  const parts = readArray(body, "parts", partCount, partCount).map((value): CompletedPart => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw badRequest("Each item of parts must be an object with partNumber and etag.");
    }
    const part = value as JsonObject;
    const partNumber = part["partNumber"];
    const etag = part["etag"];
    if (typeof partNumber !== "number" || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > partCount) {
      throw badRequest(`Each partNumber must be a whole number from 1 to ${partCount}.`);
    }
    if (typeof etag !== "string" || etag === "" || etag.length > ETAG_MAX_LENGTH) {
      throw badRequest(`Each etag must be a string of 1 to ${ETAG_MAX_LENGTH} characters.`);
    }
    return { partNumber, etag };
  });
  if (new Set(parts.map((part) => part.partNumber)).size !== partCount) {
    throw badRequest("parts must list every part number exactly once.");
  }
  return parts.sort((a, b) => a.partNumber - b.partNumber);
}

async function uploaderOf(video: VideoRecord, store: ObjectStore): Promise<UserSummary | null> {
  if (video.uploaderId === null) return null;
  return {
    id: video.uploaderId,
    displayName: video.uploaderName ?? "",
    avatarUrl: await signedOrNull(store, video.uploaderAvatarKey),
  };
}

async function toSummary(video: VideoRecord, store: ObjectStore): Promise<VideoSummary> {
  return {
    id: video.id,
    title: video.title,
    durationSec: video.durationSec,
    thumbnailUrl: await signedOrNull(store, video.thumbnailKey),
    createdAt: video.createdAt,
    uploader: await uploaderOf(video, store),
  };
}

async function toDetail(db: D1Database, video: VideoRecord, viewer: Viewer, store: ObjectStore): Promise<VideoDetail> {
  return {
    id: video.id,
    title: video.title,
    description: video.description,
    durationSec: video.durationSec,
    width: video.width,
    height: video.height,
    fileSize: video.fileSize,
    contentType: video.contentType,
    createdAt: video.createdAt,
    updatedAt: video.updatedAt,
    playbackUrl: await store.presignGet(video.objectKey),
    thumbnailUrl: await signedOrNull(store, video.thumbnailKey),
    uploader: await uploaderOf(video, store),
    series: await seriesOf(db, video),
    rating: await new RatingRepository(db).summary(video.id, viewer.id),
    attachments: await Promise.all(
      (await new AttachmentRepository(db).listReady(video.id)).map((attachment) => toAttachment(attachment, store)),
    ),
    canEdit: canEditVideo(viewer, video),
  };
}

// Where a video sits in its series. The episode number counts ready videos only.
async function seriesOf(db: D1Database, video: VideoRecord): Promise<VideoSeries | null> {
  if (video.seriesId === null) return null;
  const series = await new SeriesRepository(db).find(video.seriesId);
  if (series === null) return null;
  const episodes = await new VideoRepository(db).listEpisodes(series.id);
  const index = episodes.findIndex((episode) => episode.id === video.id);
  if (index === -1) return null;
  const link = (episode: VideoRecord | undefined): EpisodeLink | null =>
    episode === undefined ? null : { id: episode.id, title: episode.title };
  return {
    id: series.id,
    title: series.title,
    episode: index + 1,
    previous: link(episodes[index - 1]),
    next: link(episodes[index + 1]),
  };
}

async function ownerOf(series: SeriesRecord, store: ObjectStore): Promise<UserSummary> {
  return { id: series.ownerId, displayName: series.ownerName, avatarUrl: await signedOrNull(store, series.ownerAvatarKey) };
}

async function toSeriesSummary(series: SeriesRecord, store: ObjectStore): Promise<SeriesSummary> {
  return {
    id: series.id,
    title: series.title,
    owner: await ownerOf(series, store),
    coverUrl: await signedOrNull(store, series.coverKey),
    updatedAt: series.updatedAt,
  };
}

async function toSeriesDetail(db: D1Database, series: SeriesRecord, viewer: Viewer, store: ObjectStore): Promise<SeriesDetail> {
  const episodes = await new VideoRepository(db).listEpisodes(series.id);
  return {
    id: series.id,
    title: series.title,
    description: series.description,
    owner: await ownerOf(series, store),
    createdAt: series.createdAt,
    updatedAt: series.updatedAt,
    canEdit: canEditSeries(viewer, series),
    episodes: await Promise.all(
      episodes.map(async (episode, index) => ({ ...(await toSummary(episode, store)), episode: index + 1 })),
    ),
  };
}

function attachmentKey(videoId: string, id: string): string {
  return `attachments/${videoId}/${id}`;
}

function thumbnailKey(id: string): string {
  return `thumbnails/${id}.jpg`;
}

// One key per person, so a new picture replaces the old one in the bucket.
function avatarKey(userId: string): string {
  return `avatars/${userId}.jpg`;
}

function extensionOf(fileName: string): string {
  const extension = /\.([A-Za-z0-9]{1,10})$/.exec(fileName)?.[1];
  return extension === undefined ? "" : `.${extension.toLowerCase()}`;
}

function encodeCursor(cursor: ListCursor): string {
  return btoa(JSON.stringify([cursor.createdAt, cursor.id])).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeCursor(value: string): ListCursor {
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const parsed: unknown = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
    if (Array.isArray(parsed) && parsed.length === 2) {
      const [createdAt, id]: unknown[] = parsed;
      if (typeof createdAt === "string" && typeof id === "string" && ID_PATTERN.test(id)) {
        return { createdAt, id };
      }
    }
  } catch {
    // An unreadable cursor gets the same answer as a well-formed but wrong one.
  }
  throw badRequest("The cursor is not valid. Pass nextCursor from the previous page.");
}

function errorBody(code: string, message: string): ApiErrorBody {
  return { error: { code, message } };
}

// HTTP API of albireo, served under /api, and the pages of the browser app.
//
// createApp() takes the database, the bucket, the person of albireo, the clock, ID
// generation, and the pages of the browser app as dependencies, so tests can replace them.
//
// albireo has no sign-in. Everyone who opens it is the one person of the users table, who
// watches, uploads, rates, comments on, edits, and deletes everything. Deleting a video, an
// attachment, or a picture deletes its files from the bucket too. Every file passes through
// albireo: uploads go to albireo, which writes them to the bucket, and /api/files/ streams
// them back, so the browser never talks to the bucket.

import { Hono, type MiddlewareHandler } from "hono";
import { compress } from "hono/compress";
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_NAME_MAX_LENGTH,
  BIO_MAX_LENGTH,
  COMMENT_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  DISPLAY_NAME_MAX_LENGTH,
  ID_PATTERN,
  isLanguage,
  isVideoSort,
  LANGUAGES,
  LIST_PAGE_SIZE,
  MAX_PART_URLS_PER_REQUEST,
  RATING_MAX_STARS,
  SEARCH_QUERY_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  VIDEO_SORTS,
  type ApiErrorBody,
  type AttachmentResponse,
  type CommentResponse,
  type CreateUploadResponse,
  type EpisodeLink,
  type HistoryResponse,
  type ImageUploadResponse,
  type Language,
  type ListCommentsResponse,
  type ListPlaylistsResponse,
  type ListSeriesResponse,
  type ListVideosResponse,
  type Me,
  type MeResponse,
  type PartUrlsResponse,
  type PlaylistChoicesResponse,
  type PlaylistDetail,
  type PlaylistResponse,
  type PlaylistSummary,
  type RatingResponse,
  type RandomVideosResponse,
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
import { AttachmentRepository, contentTypeOf, downloadDisposition, type AttachmentRecord } from "./attachments.ts";
import { CommentRepository, type CommentRecord } from "./comments.ts";
import type { Database } from "./database.ts";
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
import { randomId } from "./ids.ts";
import { errorFields, log } from "./log.ts";
import { PlaylistRepository, type PlaylistRecord } from "./playlists.ts";
import { RatingRepository } from "./ratings.ts";
import { fileHeaders, pageHeaders } from "./security-headers.ts";
import { SeriesRepository, type SeriesRecord } from "./series.ts";
import { FORWARDED_RESPONSE_HEADERS, StorageError, type CompletedPart, type ObjectStore } from "./storage.ts";
import { MAX_OBJECT_SIZE, planParts, type PartPlan } from "./upload-plan.ts";
import { UserRepository, type UserRecord } from "./users.ts";
import { VideoRepository, type ListCursor, type RatingCursor, type VideoRecord, type WatchedVideoRecord } from "./videos.ts";

export type IdKind = "video" | "user" | "series" | "comment" | "attachment" | "playlist";

export interface AppDependencies {
  db: Database;
  store: ObjectStore;
  /** The ID of the one person of albireo, whom the server adds when it starts the first time. */
  ownerId: string;
  now: () => Date;
  /** Returns a new ID for a video, a user, a series, a comment, an attachment, or a playlist. */
  newId: (kind: IdKind) => string;
  /** Answers a request for a page of the browser app or one of its files, such as index.html for /videos/<ID>. */
  pages: (request: Request) => Promise<Response>;
}

/** The person who sent the request: the one person of albireo, who edits everything. */
interface Viewer {
  id: string;
  displayName: string;
  bio: string;
  avatarKey: string | null;
  joinedAt: string;
  updatedAt: string;
  language: Language;
}

interface AppEnv {
  Variables: { requestId: string; viewer: Viewer };
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
// and continue this many series. The limits keep the rows that the database reads for one
// visit of the home page low in a large library: about two for each video and three for
// each watched one. The home page shows 48 of them.
const RECOMMENDATION_POOL = 100;
const SERIES_TO_CONTINUE = 8;
// A search takes at most this many words, and pages reach at most this far into the results.
const SEARCH_MAX_TERMS = 10;
const SEARCH_MAX_OFFSET = 10_000;
// The methods that read and change nothing.
const SAFE_METHODS = new Set(["GET", "HEAD"]);
// A thumbnail or a picture is a JPEG that the browser makes from a frame or a chosen image.
const IMAGE_MAX_BYTES = 32 * 1024 * 1024;
// The paths of the files of the library under /api/files/: a video, a thumbnail, a picture, or an attachment.
const FILES_PATH = "/api/files/";
const FILE_KEYS = [
  /^videos\/[0-9a-z]{16}\/original(\.[a-z0-9]{1,10})?$/,
  /^thumbnails\/[0-9a-z]{16}\.jpg$/,
  /^avatars\/[0-9a-z]{16}\.jpg$/,
  /^attachments\/[0-9a-z]{16}\/[0-9a-z]{16}$/,
];
const ATTACHMENT_KEY = /^attachments\/([0-9a-z]{16})\/([0-9a-z]{16})$/;

export function createApp(deps: AppDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const now = () => deps.now().toISOString();
  const db = deps.db;
  const compressed = compress();

  // Text goes compressed to a browser that accepts it: the pages, their scripts and styles, and
  // the answers of the API. The files of the bucket go as they are, since a video is compressed
  // already and a range must count the bytes of the file.
  app.use("*", async (c, next) => (c.req.path.startsWith(FILES_PATH) ? next() : compressed(c, next)));

  // One line for each request of the API, apart from the files, which a page asks for by the dozen.
  app.use("/api/*", logRequests);

  // Docker and a proxy in front of albireo ask this to know that albireo answers.
  app.get("/healthz", async (c) => {
    await db.prepare("SELECT 1").first();
    return c.text("ok");
  });

  // Every API request comes from the one person of albireo. A browser marks a request that a
  // page of another site sends, and albireo refuses every change that such a request asks for,
  // so another site cannot make the browser of the person change the library.
  app.use("/api/*", async (c, next) => {
    c.set("requestId", crypto.randomUUID());
    // The files of /api/files/ name their own caching.
    if (!c.req.path.startsWith(FILES_PATH)) c.header("Cache-Control", "no-store");
    const site = c.req.header("sec-fetch-site");
    if (!SAFE_METHODS.has(c.req.method) && (site === "cross-site" || site === "same-site")) {
      throw forbidden("albireo accepts changes only from its own pages.");
    }
    const user = await new UserRepository(db).find(deps.ownerId);
    if (user === null) throw new Error(`The person of albireo ${deps.ownerId} is missing.`);
    c.set("viewer", viewerOf(user));
    await next();
  });

  app.get("/api/me", async (c) => c.json<MeResponse>({ me: toMe(c.get("viewer")) }));

  app.patch("/api/me", async (c) => {
    const body = await readJsonObject(c.req.raw, ["displayName", "bio", "language"]);
    const displayName = readOptionalString(body, "displayName", { min: 1, max: DISPLAY_NAME_MAX_LENGTH, trim: true });
    const bio = readOptionalString(body, "bio", { min: 0, max: BIO_MAX_LENGTH, trim: false });
    const language = readOptionalLanguage(body);
    if (displayName === undefined && bio === undefined && language === undefined) {
      throw badRequest("Send at least one of displayName, bio, and language.");
    }
    const viewer = c.get("viewer");
    const users = new UserRepository(db);
    await users.update(viewer.id, { displayName, bio, language }, now());
    return c.json<MeResponse>({ me: toMe(await reloadViewer(users, viewer)) });
  });

  // The picture of the person: the browser sends a JPEG to the URL of the answer, then commits it.
  app.post("/api/me/avatar", async (c) => c.json<ImageUploadResponse>({ url: "/api/me/avatar/file", contentType: THUMBNAIL_CONTENT_TYPE }));

  app.put("/api/me/avatar/file", async (c) => {
    requireContentType(c.req.raw, THUMBNAIL_CONTENT_TYPE);
    const { body, length } = requestBody(c.req.raw, 1, IMAGE_MAX_BYTES);
    await deps.store.putObject(avatarKey(c.get("viewer").id), THUMBNAIL_CONTENT_TYPE, body, length);
    return c.body(null, 204);
  });

  app.post("/api/me/avatar/commit", async (c) => {
    const viewer = c.get("viewer");
    const key = avatarKey(viewer.id);
    if ((await deps.store.headObject(key)) === null) throw conflict("Send the picture to its URL before committing it.");
    const users = new UserRepository(db);
    await users.setAvatar(viewer.id, key, now());
    return c.json<MeResponse>({ me: toMe(await reloadViewer(users, viewer)) });
  });

  // Goes back to the default person icon, and deletes the picture from the bucket.
  app.delete("/api/me/avatar", async (c) => {
    const viewer = c.get("viewer");
    await deps.store.deleteObject(avatarKey(viewer.id));
    const users = new UserRepository(db);
    await users.setAvatar(viewer.id, null, now());
    return c.json<MeResponse>({ me: toMe(await reloadViewer(users, viewer)) });
  });

  app.get("/api/users/:id", async (c) => {
    const user = await new UserRepository(db).find(pathId(c.req.param("id"), "user"));
    if (user === null) throw notFound("No user has this ID.");
    return c.json<UserResponse>({ user: await toProfile(user) });
  });

  // The history of the person, from the last watched.
  app.get("/api/history", async (c) => {
    const cursor = c.req.query("cursor");
    const rows = await new VideoRepository(db).listWatched(
      c.get("viewer").id,
      LIST_PAGE_SIZE + 1,
      cursor === undefined ? null : decodeCursor(cursor),
    );
    const page = rows.slice(0, LIST_PAGE_SIZE);
    const videos = await Promise.all(
      page.map(async (video): Promise<WatchedVideo> => ({ ...(await toSummary(video)), watchedAt: video.watchedAt })),
    );
    const last = page.at(-1);
    const nextCursor = rows.length > LIST_PAGE_SIZE && last !== undefined
      ? encodeCursor({ createdAt: last.watchedAt, id: last.id })
      : null;
    return c.json<HistoryResponse>({ videos, nextCursor });
  });

  app.get("/api/recommendations", async (c) => {
    const videos = new VideoRepository(db);
    const [recent, history] = await Promise.all([
      videos.listReady(RECOMMENDATION_POOL, null, { uploaderId: null }),
      videos.listWatched(c.get("viewer").id, RECOMMENDATION_POOL, null),
    ]);
    const picks = (await recommend(videos, recent, history)).slice(0, LIST_PAGE_SIZE);
    return c.json<RecommendationsResponse>({ videos: await Promise.all(picks.map((video) => toSummary(video))) });
  });

  // Videos at random from the whole library, for Home between its recommendations
  // (src/pages/HomePage.tsx). It reads about one page of videos.
  app.get("/api/videos/random", async (c) => {
    const picks = shuffled(await new VideoRepository(db).sampleReady(LIST_PAGE_SIZE, randomId()));
    return c.json<RandomVideosResponse>({ videos: await Promise.all(picks.map((video) => toSummary(video))) });
  });

  // The player calls this when playback starts, so the video moves to the front of the history.
  app.post("/api/videos/:id/watched", async (c) => {
    const repository = new VideoRepository(db);
    const video = await findReady(repository, pathId(c.req.param("id"), "video"));
    await repository.recordWatch(c.get("viewer").id, video.id, now());
    return c.body(null, 204);
  });

  // Every order reads one page from an index, starting at the cursor, and no ratings.
  app.get("/api/videos", async (c) => {
    const cursor = c.req.query("cursor");
    const uploader = c.req.query("uploader");
    const sort = c.req.query("sort") ?? "newest";
    if (uploader !== undefined && !ID_PATTERN.test(uploader)) throw badRequest("uploader must be a user ID.");
    if (!isVideoSort(sort)) throw badRequest(`sort must be one of ${VIDEO_SORTS.join(", ")}.`);
    if (uploader !== undefined && sort !== "newest") throw badRequest("The videos of one person list from the newest only.");
    const repository = new VideoRepository(db);
    const rows = sort === "rating"
      ? await repository.listByRating(LIST_PAGE_SIZE + 1, cursor === undefined ? null : decodeRatingCursor(cursor))
      : await repository.listReady(
        LIST_PAGE_SIZE + 1,
        cursor === undefined ? null : decodeCursor(cursor),
        { uploaderId: uploader ?? null },
        sort,
      );
    const page = rows.slice(0, LIST_PAGE_SIZE);
    const videos = await Promise.all(page.map((video) => toSummary(video)));
    const last = page.at(-1);
    let nextCursor: string | null = null;
    if (rows.length > LIST_PAGE_SIZE && last !== undefined) {
      nextCursor = sort === "rating"
        ? encodeRatingCursor({ score: last.ratingScore, count: last.ratingCount, createdAt: last.createdAt, id: last.id })
        : encodeCursor({ createdAt: last.createdAt, id: last.id });
    }
    return c.json<ListVideosResponse>({ videos, nextCursor });
  });

  app.get("/api/videos/:id", async (c) => {
    const video = await findReady(new VideoRepository(db), pathId(c.req.param("id"), "video"));
    return c.json<VideoResponse>({ video: await toDetail(db, video, c.get("viewer")) });
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
    const repository = new VideoRepository(db);
    const video = await findReady(repository, id);
    const viewer = c.get("viewer");
    const time = now();
    if (title !== undefined || description !== undefined) await repository.updateDetails(id, { title, description }, time);
    if (seriesId !== undefined && seriesId !== video.seriesId) {
      const seriesRepository = new SeriesRepository(db);
      if (seriesId !== null && (await seriesRepository.find(seriesId)) === null) throw badRequest("No series has this seriesId.");
      await repository.setSeries(id, seriesId, time);
      for (const changed of [video.seriesId, seriesId]) {
        if (changed !== null) await seriesRepository.touch(changed, time);
      }
    }
    const edited = await findReady(repository, id);
    return c.json<VideoResponse>({ video: await toDetail(db, edited, viewer) });
  });

  // Deletes a video for good, with its files in the bucket: the video, its thumbnail, and its
  // attachments. The files go first, so a deletion that stops halfway leaves the video in the
  // library, and deleting it again finishes the work.
  app.delete("/api/videos/:id", async (c) => {
    const repository = new VideoRepository(db);
    const video = await findReady(repository, pathId(c.req.param("id"), "video"));
    const attachments = await new AttachmentRepository(db).listAll(video.id);
    // The key of a thumbnail never changes, so this also deletes one that was uploaded and never committed.
    const keys = [video.objectKey, thumbnailKey(video.id), ...attachments.map((attachment) => attachmentKey(video.id, attachment.id))];
    await Promise.all(keys.map((key) => deps.store.deleteObject(key)));
    await repository.delete(video.id);
    if (video.seriesId !== null) await new SeriesRepository(db).touch(video.seriesId, now());
    log("INFO", "Video deleted", c.get("requestId"), { videoId: video.id, files: keys.length });
    return c.body(null, 204);
  });

  // Each person gives a video 1 to 5 stars, or takes their rating back.
  app.put("/api/videos/:id/rating", async (c) => {
    const body = await readJsonObject(c.req.raw, ["stars"]);
    const stars = readInteger(body, "stars", 1, RATING_MAX_STARS);
    const video = await findReady(new VideoRepository(db), pathId(c.req.param("id"), "video"));
    const ratings = new RatingRepository(db);
    const viewer = c.get("viewer");
    await ratings.set(video.id, viewer.id, stars, now());
    return c.json<RatingResponse>({ rating: await ratings.summary(video.id, viewer.id) });
  });

  app.delete("/api/videos/:id/rating", async (c) => {
    const video = await findReady(new VideoRepository(db), pathId(c.req.param("id"), "video"));
    const ratings = new RatingRepository(db);
    const viewer = c.get("viewer");
    await ratings.clear(video.id, viewer.id);
    return c.json<RatingResponse>({ rating: await ratings.summary(video.id, viewer.id) });
  });

  app.get("/api/videos/:id/comments", async (c) => {
    const video = await findReady(new VideoRepository(db), pathId(c.req.param("id"), "video"));
    const cursor = c.req.query("cursor");
    const comments = new CommentRepository(db);
    const rows = await comments.list(video.id, LIST_PAGE_SIZE + 1, cursor === undefined ? null : decodeCursor(cursor));
    const page = rows.slice(0, LIST_PAGE_SIZE);
    const last = page.at(-1);
    return c.json<ListCommentsResponse>({
      comments: await Promise.all(page.map((comment) => toComment(comment))),
      nextCursor: rows.length > LIST_PAGE_SIZE && last !== undefined
        ? encodeCursor({ createdAt: last.createdAt, id: last.id })
        : null,
    });
  });

  app.post("/api/videos/:id/comments", async (c) => {
    const body = await readJsonObject(c.req.raw, ["body"]);
    const text = readString(body, "body", { min: 1, max: COMMENT_MAX_LENGTH, trim: true });
    const video = await findReady(new VideoRepository(db), pathId(c.req.param("id"), "video"));
    const comments = new CommentRepository(db);
    const viewer = c.get("viewer");
    const id = deps.newId("comment");
    await comments.insert({ id, videoId: video.id, authorId: viewer.id, body: text, createdAt: now() });
    const comment = await comments.find(id);
    if (comment === null) throw new Error(`The new comment ${id} is missing.`);
    return c.json<CommentResponse>({ comment: await toComment(comment) }, 201);
  });

  app.delete("/api/comments/:id", async (c) => {
    const comments = new CommentRepository(db);
    const comment = await comments.find(pathId(c.req.param("id"), "comment"));
    if (comment === null) throw notFound("No comment has this ID.");
    await comments.delete(comment.id);
    return c.body(null, 204);
  });

  // The browser sends an attachment to the URL of the answer, then commits it.
  app.post("/api/videos/:id/attachments", async (c) => {
    const body = await readJsonObject(c.req.raw, ["fileName", "fileSize"]);
    const fileName = readString(body, "fileName", { min: 1, max: ATTACHMENT_NAME_MAX_LENGTH, trim: true });
    const fileSize = readInteger(body, "fileSize", 0, ATTACHMENT_MAX_BYTES);
    const video = await findReady(new VideoRepository(db), pathId(c.req.param("id"), "video"));
    const id = deps.newId("attachment");
    const contentType = contentTypeOf(fileName);
    await new AttachmentRepository(db).insertUploading({ id, videoId: video.id, fileName, contentType, fileSize, createdAt: now() });
    return c.json<StartAttachmentResponse>({ attachmentId: id, url: `/api/attachments/${id}/file`, contentType }, 201);
  });

  // Writes the file of an attachment to the bucket as it arrives: as many bytes as were announced.
  app.put("/api/attachments/:id/file", async (c) => {
    const attachment = await findAttachment(new AttachmentRepository(db), pathId(c.req.param("id"), "attachment"));
    if (attachment.status !== "uploading") throw conflict("The attachment is already committed.");
    const { body, length } = requestBody(c.req.raw, attachment.fileSize, attachment.fileSize);
    await deps.store.putObject(attachmentKey(attachment.videoId, attachment.id), attachment.contentType, body, length);
    return c.body(null, 204);
  });

  app.post("/api/attachments/:id/commit", async (c) => {
    const attachments = new AttachmentRepository(db);
    const attachment = await findAttachment(attachments, pathId(c.req.param("id"), "attachment"));
    if (attachment.status !== "uploading") throw conflict("The attachment is already committed.");
    const object = await deps.store.headObject(attachmentKey(attachment.videoId, attachment.id));
    if (object === null) throw conflict("The file is not in the bucket. Send it to its URL first.");
    if (object.size > ATTACHMENT_MAX_BYTES) throw badRequest(`Attachments can be at most ${ATTACHMENT_MAX_BYTES} bytes.`);
    await attachments.markReady(attachment.id, object.size);
    return c.json<AttachmentResponse>({
      attachment: await toAttachment({ ...attachment, status: "ready", fileSize: object.size }),
    });
  });

  app.delete("/api/attachments/:id", async (c) => {
    const attachments = new AttachmentRepository(db);
    const attachment = await findAttachment(attachments, pathId(c.req.param("id"), "attachment"));
    await deps.store.deleteObject(attachmentKey(attachment.videoId, attachment.id));
    await attachments.delete(attachment.id);
    return c.body(null, 204);
  });

  // The cursor of a search is how many results the earlier pages held.
  app.get("/api/search", async (c) => {
    const terms = searchTerms(c.req.query("q"));
    const offset = searchOffset(c.req.query("cursor"));
    const rows = await new VideoRepository(db).search(terms, LIST_PAGE_SIZE + 1, offset);
    const page = rows.slice(0, LIST_PAGE_SIZE);
    return c.json<SearchResponse>({
      videos: await Promise.all(page.map((video) => toSummary(video))),
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
    if (seriesId !== null && (await new SeriesRepository(db).find(seriesId)) === null) {
      throw badRequest("No series has this seriesId.");
    }
    const plan = planUpload(fileSize);
    const id = deps.newId("video");
    const objectKey = `videos/${id}/original${extensionOf(fileName)}`;
    const uploadId = await deps.store.createMultipartUpload(objectKey, contentType);
    await new VideoRepository(db).insertUploading({
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
    const upload = await findUploading(new VideoRepository(db), pathId(c.req.param("id"), "upload"));
    const body = await readJsonObject(c.req.raw, ["partNumbers"]);
    const partNumbers = readArray(body, "partNumbers", 1, MAX_PART_URLS_PER_REQUEST).map((value) => {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > upload.partCount) {
        throw badRequest(`partNumbers must hold whole numbers from 1 to ${upload.partCount}.`);
      }
      return value;
    });
    if (new Set(partNumbers).size !== partNumbers.length) throw badRequest("partNumbers must not repeat a part number.");
    const parts = partNumbers.map((partNumber) => ({ partNumber, url: `/api/uploads/${upload.id}/parts/${partNumber}` }));
    return c.json<PartUrlsResponse>({ parts });
  });

  // Writes one part of an upload to the bucket as it arrives, and answers with its ETag, which
  // the browser sends back to complete the upload. Each part but the last has the size of the
  // plan of the upload, and the last one holds the rest of the file.
  app.put("/api/uploads/:id/parts/:partNumber", async (c) => {
    const upload = await findUploading(new VideoRepository(db), pathId(c.req.param("id"), "upload"));
    const partText = c.req.param("partNumber");
    const partNumber = /^[1-9][0-9]{0,4}$/.test(partText) ? Number(partText) : 0;
    if (partNumber < 1 || partNumber > upload.partCount) throw notFound(`The upload has parts 1 to ${upload.partCount}.`);
    const size = partNumber < upload.partCount ? upload.partSize : upload.fileSize - upload.partSize * (upload.partCount - 1);
    const { body, length } = requestBody(c.req.raw, size, size);
    const etag = await deps.store.uploadPart(upload.objectKey, upload.uploadId, partNumber, body, length);
    c.header("ETag", etag);
    return c.body(null, 204);
  });

  app.post("/api/uploads/:id/complete", async (c) => {
    const id = pathId(c.req.param("id"), "upload");
    const repository = new VideoRepository(db);
    const viewer = c.get("viewer");
    const upload = await findUploading(repository, id);
    const body = await readJsonObject(c.req.raw, ["parts", "durationSec", "width", "height"]);
    const parts = readCompletedParts(body, upload.partCount);
    const media = {
      durationSec: readNullableNumber(body, "durationSec", 0, MAX_DURATION_SEC, false),
      width: readNullableNumber(body, "width", 1, MAX_DIMENSION, true),
      height: readNullableNumber(body, "height", 1, MAX_DIMENSION, true),
    };
    await deps.store.completeMultipartUpload(upload.objectKey, upload.uploadId, parts);
    const stored = await deps.store.headObject(upload.objectKey);
    if (stored === null || stored.size !== upload.fileSize) {
      const found = stored === null ? "no object" : `${stored.size} bytes`;
      throw new StorageError(`The storage service holds ${found} after the upload, not the ${upload.fileSize} bytes that were announced.`);
    }
    const time = now();
    if (!(await repository.markReady(id, media, time))) {
      throw conflict("The upload is no longer in progress.");
    }
    if (upload.seriesId !== null) await new SeriesRepository(db).touch(upload.seriesId, time);
    log("INFO", "Upload completed", c.get("requestId"), { videoId: id, fileSize: upload.fileSize });
    const video = await findReady(repository, id);
    return c.json<VideoResponse>({ video: await toDetail(db, video, viewer) });
  });

  app.post("/api/uploads/:id/abort", async (c) => {
    const id = pathId(c.req.param("id"), "upload");
    const repository = new VideoRepository(db);
    const upload = await findUploading(repository, id);
    try {
      await deps.store.abortMultipartUpload(upload.objectKey, upload.uploadId);
    } catch (error) {
      // The row goes away regardless. A lifecycle rule on the bucket removes parts left behind.
      log("WARN", "Could not abort the multipart upload", c.get("requestId"), { videoId: id, ...errorFields(error) });
    }
    await repository.deleteUploading(id);
    log("INFO", "Upload canceled", c.get("requestId"), { videoId: id });
    return c.body(null, 204);
  });

  app.post("/api/videos/:id/thumbnail", async (c) => {
    const video = await findReady(new VideoRepository(db), pathId(c.req.param("id"), "video"));
    return c.json<ThumbnailUploadResponse>({ url: `/api/videos/${video.id}/thumbnail/file`, contentType: THUMBNAIL_CONTENT_TYPE });
  });

  app.put("/api/videos/:id/thumbnail/file", async (c) => {
    const video = await findReady(new VideoRepository(db), pathId(c.req.param("id"), "video"));
    requireContentType(c.req.raw, THUMBNAIL_CONTENT_TYPE);
    const { body, length } = requestBody(c.req.raw, 1, IMAGE_MAX_BYTES);
    await deps.store.putObject(thumbnailKey(video.id), THUMBNAIL_CONTENT_TYPE, body, length);
    return c.body(null, 204);
  });

  app.post("/api/videos/:id/thumbnail/commit", async (c) => {
    const id = pathId(c.req.param("id"), "video");
    const repository = new VideoRepository(db);
    const viewer = c.get("viewer");
    await findReady(repository, id);
    const key = thumbnailKey(id);
    if ((await deps.store.headObject(key)) === null) {
      throw conflict("Send the thumbnail to its URL before committing it.");
    }
    await repository.setThumbnail(id, key, now());
    const committed = await findReady(repository, id);
    return c.json<VideoResponse>({ video: await toDetail(db, committed, viewer) });
  });

  app.get("/api/series", async (c) => {
    const owner = c.req.query("owner");
    if (owner !== undefined && !ID_PATTERN.test(owner)) throw badRequest("owner must be a user ID.");
    const list = await new SeriesRepository(db).list(owner ?? null);
    return c.json<ListSeriesResponse>({ series: await Promise.all(list.map((series) => toSeriesSummary(series))) });
  });

  app.post("/api/series", async (c) => {
    const body = await readJsonObject(c.req.raw, ["title", "description"]);
    const title = readString(body, "title", { min: 1, max: TITLE_MAX_LENGTH, trim: true });
    const description = readString(body, "description", { min: 0, max: DESCRIPTION_MAX_LENGTH, trim: false });
    const repository = new SeriesRepository(db);
    const id = deps.newId("series");
    await repository.insert({ id, title, description, ownerId: c.get("viewer").id, createdAt: now() });
    const series = await findSeries(repository, id);
    return c.json<SeriesResponse>({ series: await toSeriesDetail(db, series) }, 201);
  });

  app.get("/api/series/:id", async (c) => {
    const series = await findSeries(new SeriesRepository(db), pathId(c.req.param("id"), "series"));
    return c.json<SeriesResponse>({ series: await toSeriesDetail(db, series) });
  });

  app.patch("/api/series/:id", async (c) => {
    const id = pathId(c.req.param("id"), "series");
    const body = await readJsonObject(c.req.raw, ["title", "description"]);
    const title = readOptionalString(body, "title", { min: 1, max: TITLE_MAX_LENGTH, trim: true });
    const description = readOptionalString(body, "description", { min: 0, max: DESCRIPTION_MAX_LENGTH, trim: false });
    if (title === undefined && description === undefined) throw badRequest("Send a title, a description, or both.");
    const repository = new SeriesRepository(db);
    await repository.updateDetails(id, { title, description }, now());
    return c.json<SeriesResponse>({
      series: await toSeriesDetail(db, await findSeries(repository, id)),
    });
  });

  // Deletes a series. Its videos stay in the library, out of any series.
  app.delete("/api/series/:id", async (c) => {
    const repository = new SeriesRepository(db);
    const series = await findSeries(repository, pathId(c.req.param("id"), "series"));
    await new VideoRepository(db).leaveSeries(series.id, now());
    await repository.delete(series.id);
    log("INFO", "Series deleted", c.get("requestId"), { seriesId: series.id });
    return c.body(null, 204);
  });

  // Moves an episode one place earlier or later.
  app.post("/api/series/:id/episodes/:videoId/move", async (c) => {
    const seriesRepository = new SeriesRepository(db);
    const series = await findSeries(seriesRepository, pathId(c.req.param("id"), "series"));
    const videoId = pathId(c.req.param("videoId"), "video");
    const body = await readJsonObject(c.req.raw, ["direction"]);
    const direction = readString(body, "direction", { min: 1, max: 10, trim: false });
    if (direction !== "earlier" && direction !== "later") throw badRequest('direction must be "earlier" or "later".');
    const videos = new VideoRepository(db);
    const episodes = await videos.listEpisodes(series.id);
    const index = episodes.findIndex((episode) => episode.id === videoId);
    const episode = episodes[index];
    if (episode === undefined) throw notFound("The series has no ready episode with this ID.");
    const neighbor = episodes[direction === "earlier" ? index - 1 : index + 1];
    if (neighbor === undefined) throw conflict(`The episode is already the ${direction === "earlier" ? "first" : "last"} one.`);
    await videos.swapEpisodes(episode, neighbor);
    await seriesRepository.touch(series.id, now());
    return c.json<SeriesResponse>({
      series: await toSeriesDetail(db, await findSeries(seriesRepository, series.id)),
    });
  });

  // Takes a video out of a series. The video stays in the library.
  app.delete("/api/series/:id/episodes/:videoId", async (c) => {
    const seriesRepository = new SeriesRepository(db);
    const series = await findSeries(seriesRepository, pathId(c.req.param("id"), "series"));
    const videos = new VideoRepository(db);
    const video = await findReady(videos, pathId(c.req.param("videoId"), "video"));
    if (video.seriesId !== series.id) throw notFound("The series has no episode with this ID.");
    const time = now();
    await videos.setSeries(video.id, null, time);
    await seriesRepository.touch(series.id, time);
    return c.json<SeriesResponse>({
      series: await toSeriesDetail(db, await findSeries(seriesRepository, series.id)),
    });
  });

  // The playlists, each with whether it holds the video, for adding the video to them.
  app.get("/api/videos/:id/playlists", async (c) => {
    const video = await findReady(new VideoRepository(db), pathId(c.req.param("id"), "video"));
    const playlists = await new PlaylistRepository(db).choicesFor(c.get("viewer").id, video.id);
    return c.json<PlaylistChoicesResponse>({ playlists });
  });

  app.get("/api/playlists", async (c) => {
    const owner = c.req.query("owner");
    if (owner !== undefined && !ID_PATTERN.test(owner)) throw badRequest("owner must be a user ID.");
    const list = await new PlaylistRepository(db).list(owner ?? null);
    return c.json<ListPlaylistsResponse>({ playlists: await Promise.all(list.map((playlist) => toPlaylistSummary(playlist))) });
  });

  app.post("/api/playlists", async (c) => {
    const body = await readJsonObject(c.req.raw, ["title", "description"]);
    const title = readString(body, "title", { min: 1, max: TITLE_MAX_LENGTH, trim: true });
    const description = readString(body, "description", { min: 0, max: DESCRIPTION_MAX_LENGTH, trim: false });
    const repository = new PlaylistRepository(db);
    const id = deps.newId("playlist");
    await repository.insert({ id, title, description, ownerId: c.get("viewer").id, createdAt: now() });
    const playlist = await findPlaylist(repository, id);
    return c.json<PlaylistResponse>({ playlist: await toPlaylistDetail(db, playlist) }, 201);
  });

  app.get("/api/playlists/:id", async (c) => {
    const playlist = await findPlaylist(new PlaylistRepository(db), pathId(c.req.param("id"), "playlist"));
    return c.json<PlaylistResponse>({ playlist: await toPlaylistDetail(db, playlist) });
  });

  app.patch("/api/playlists/:id", async (c) => {
    const id = pathId(c.req.param("id"), "playlist");
    const body = await readJsonObject(c.req.raw, ["title", "description"]);
    const title = readOptionalString(body, "title", { min: 1, max: TITLE_MAX_LENGTH, trim: true });
    const description = readOptionalString(body, "description", { min: 0, max: DESCRIPTION_MAX_LENGTH, trim: false });
    if (title === undefined && description === undefined) throw badRequest("Send a title, a description, or both.");
    const repository = new PlaylistRepository(db);
    await repository.updateDetails(id, { title, description }, now());
    return c.json<PlaylistResponse>({
      playlist: await toPlaylistDetail(db, await findPlaylist(repository, id)),
    });
  });

  // Deletes a playlist. Its videos stay in the library and in other playlists.
  app.delete("/api/playlists/:id", async (c) => {
    const repository = new PlaylistRepository(db);
    const playlist = await findPlaylist(repository, pathId(c.req.param("id"), "playlist"));
    await repository.delete(playlist.id);
    log("INFO", "Playlist deleted", c.get("requestId"), { playlistId: playlist.id });
    return c.body(null, 204);
  });

  // Puts a ready video at the end of a playlist. Any video can be in any number of playlists.
  app.post("/api/playlists/:id/videos", async (c) => {
    const repository = new PlaylistRepository(db);
    const playlist = await findPlaylist(repository, pathId(c.req.param("id"), "playlist"));
    const body = await readJsonObject(c.req.raw, ["videoId"]);
    const videoId = readString(body, "videoId", { min: 1, max: 100, trim: false });
    const video = ID_PATTERN.test(videoId) ? await new VideoRepository(db).find(videoId) : null;
    if (video === null || video.status !== "ready") throw badRequest("No ready video has this videoId.");
    if (!(await repository.addVideo(playlist.id, video.id, now()))) throw conflict("The playlist holds the video already.");
    return c.json<PlaylistResponse>({
      playlist: await toPlaylistDetail(db, await findPlaylist(repository, playlist.id)),
    });
  });

  app.delete("/api/playlists/:id/videos/:videoId", async (c) => {
    const repository = new PlaylistRepository(db);
    const playlist = await findPlaylist(repository, pathId(c.req.param("id"), "playlist"));
    const videoId = pathId(c.req.param("videoId"), "video");
    if (!(await repository.removeVideo(playlist.id, videoId, now()))) throw notFound("The playlist does not hold a video with this ID.");
    return c.json<PlaylistResponse>({
      playlist: await toPlaylistDetail(db, await findPlaylist(repository, playlist.id)),
    });
  });

  // Moves a video of a playlist one place earlier or later.
  app.post("/api/playlists/:id/videos/:videoId/move", async (c) => {
    const repository = new PlaylistRepository(db);
    const playlist = await findPlaylist(repository, pathId(c.req.param("id"), "playlist"));
    const videoId = pathId(c.req.param("videoId"), "video");
    const body = await readJsonObject(c.req.raw, ["direction"]);
    const direction = readString(body, "direction", { min: 1, max: 10, trim: false });
    if (direction !== "earlier" && direction !== "later") throw badRequest('direction must be "earlier" or "later".');
    const videos = await new VideoRepository(db).listInPlaylist(playlist.id);
    const index = videos.findIndex((video) => video.id === videoId);
    const video = videos[index];
    if (video === undefined) throw notFound("The playlist has no ready video with this ID.");
    const neighbor = videos[direction === "earlier" ? index - 1 : index + 1];
    if (neighbor === undefined) throw conflict(`The video is already the ${direction === "earlier" ? "first" : "last"} one.`);
    await repository.swapVideos(
      playlist.id,
      { id: video.id, position: video.playlistPosition },
      { id: neighbor.id, position: neighbor.playlistPosition },
    );
    await repository.touch(playlist.id, now());
    return c.json<PlaylistResponse>({
      playlist: await toPlaylistDetail(db, await findPlaylist(repository, playlist.id)),
    });
  });

  // The files of the library, from the bucket: videos, thumbnails, pictures, and attachments.
  // The bucket answers ranges and revalidations, so a video plays from any point, and a browser
  // that holds a file asks only whether it changed. With ?download, an attachment comes with its
  // name, so that the browser saves it under that name.
  app.on(["GET", "HEAD"], "/api/files/*", async (c) => {
    const key = c.req.path.slice(FILES_PATH.length);
    if (!FILE_KEYS.some((pattern) => pattern.test(key))) throw notFound("No file has this path.");
    let disposition: string | null = null;
    if (c.req.query("download") !== undefined) {
      const match = ATTACHMENT_KEY.exec(key);
      const attachment = match === null ? null : await new AttachmentRepository(db).find(match[2] ?? "");
      if (match === null || attachment === null || attachment.videoId !== match[1]) throw notFound("No attachment has this path.");
      disposition = downloadDisposition(attachment.fileName);
    }
    const method = c.req.method === "HEAD" ? "HEAD" : "GET";
    const answer = await deps.store.getObject(key, method, c.req.raw.headers);
    if (answer === null) throw notFound("No file has this path.");
    const headers = new Headers({ ...fileHeaders(), "Cache-Control": "private, no-cache" });
    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = answer.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    if (disposition !== null) headers.set("Content-Disposition", disposition);
    return new Response(method === "HEAD" ? null : answer.body, { status: answer.status, headers });
  });

  // Pages of the browser app and the files that it is built of. Every page leaves with the
  // security headers of security-headers.ts, also as a 304, which the browser uses to update
  // the headers of the page that it keeps. Pages hold no data, which the API serves.
  app.all("*", async (c) => {
    if (c.req.path === "/api" || c.req.path.startsWith("/api/")) return c.notFound();
    if (!SAFE_METHODS.has(c.req.method)) return c.text("albireo serves its pages for GET and HEAD.", 405, { Allow: "GET, HEAD" });
    const page = await deps.pages(c.req.raw);
    if (page.headers.get("content-type")?.startsWith("text/html") !== true && page.status !== 304) return page;
    const response = new Response(page.body, page);
    for (const [name, value] of Object.entries(pageHeaders())) response.headers.set(name, value);
    return response;
  });

  app.notFound((c) => c.json<ApiErrorBody>(errorBody("not_found", "No API endpoint matches this request."), 404));

  app.onError((error, c) => {
    const requestId: string | undefined = c.get("requestId");
    if (error instanceof HttpError) {
      return c.json<ApiErrorBody>(errorBody(error.code, error.message), error.status);
    }
    if (error instanceof StorageError) {
      log("ERROR", "A storage request failed", requestId ?? null, errorFields(error));
      return c.json<ApiErrorBody>(errorBody("storage_error", error.message), 502);
    }
    log("ERROR", "A request failed", requestId ?? null, { method: c.req.method, path: c.req.path, ...errorFields(error) });
    return c.json<ApiErrorBody>(errorBody("internal_error", "The request failed. The logs of albireo have the details."), 500);
  });

  return app;
}

const logRequests: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.path.startsWith(FILES_PATH)) return next();
  const started = performance.now();
  await next();
  log("INFO", "Request", c.get("requestId") ?? null, {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs: Math.round(performance.now() - started),
  });
};

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

/** The items in a random order. */
function shuffled<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) % (index + 1);
    const item = result[index] as T;
    result[index] = result[other] as T;
    result[other] = item;
  }
  return result;
}

async function findAttachment(attachments: AttachmentRepository, id: string): Promise<AttachmentRecord> {
  const attachment = await attachments.find(id);
  if (attachment === null) throw notFound("No attachment has this ID.");
  return attachment;
}

async function toAttachment(attachment: AttachmentRecord): Promise<VideoAttachment> {
  const key = attachmentKey(attachment.videoId, attachment.id);
  return {
    id: attachment.id,
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    fileSize: attachment.fileSize,
    createdAt: attachment.createdAt,
    viewUrl: fileUrl(key),
    downloadUrl: downloadUrl(key),
  };
}

async function toComment(comment: CommentRecord): Promise<VideoComment> {
  return {
    id: comment.id,
    body: comment.body,
    createdAt: comment.createdAt,
    author: { id: comment.authorId, displayName: comment.authorName, avatarUrl: fileUrlOrNull(comment.authorAvatarKey) },
    // The one person of albireo deletes every comment.
    canDelete: true,
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

function viewerOf(user: UserRecord): Viewer {
  return {
    id: user.id,
    displayName: user.displayName,
    bio: user.bio,
    avatarKey: user.avatarKey,
    joinedAt: user.createdAt,
    updatedAt: user.updatedAt,
    language: user.language,
  };
}

async function reloadViewer(users: UserRepository, viewer: Viewer): Promise<Viewer> {
  const user = await users.find(viewer.id);
  if (user === null) throw new Error(`The person of albireo ${viewer.id} is missing.`);
  return viewerOf(user);
}

function toMe(viewer: Viewer): Me {
  return {
    id: viewer.id,
    displayName: viewer.displayName,
    avatarUrl: avatarUrlOf(viewer.avatarKey, viewer.updatedAt),
    bio: viewer.bio,
    joinedAt: viewer.joinedAt,
    language: viewer.language,
  };
}

async function toProfile(user: UserRecord): Promise<UserProfile> {
  return { id: user.id, displayName: user.displayName, avatarUrl: avatarUrlOf(user.avatarKey, user.updatedAt), bio: user.bio };
}

function fileUrl(key: string): string {
  return `${FILES_PATH}${key}`;
}

function fileUrlOrNull(key: string | null): string | null {
  return key === null ? null : fileUrl(key);
}

/** The URL of an attachment that makes the browser save the file under its name. */
function downloadUrl(key: string): string {
  return `${fileUrl(key)}?download`;
}

// A thumbnail and a picture keep their keys when they change. So that a page shows a new one
// at once, rather than the one that the browser holds, their URLs carry the time of the last
// change of their row: of the video, and of the person.
function thumbnailUrlOf(video: VideoRecord): string | null {
  return video.thumbnailKey === null ? null : `${fileUrl(video.thumbnailKey)}?v=${Date.parse(video.updatedAt)}`;
}

function avatarUrlOf(key: string | null, updatedAt: string): string | null {
  return key === null ? null : `${fileUrl(key)}?v=${Date.parse(updatedAt)}`;
}

/** The language of the browser app in a request body, which must be one that the app has. */
function readOptionalLanguage(body: JsonObject): Language | undefined {
  if (!("language" in body)) return undefined;
  const language = body.language;
  if (!isLanguage(language)) throw badRequest(`language must be ${LANGUAGES.map((name) => `"${name}"`).join(" or ")}.`);
  return language;
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

async function findUploading(repository: VideoRepository, id: string): Promise<UploadingVideo> {
  const video = await repository.find(id);
  if (video === null || video.status !== "uploading" || video.uploadId === null) {
    throw notFound("No upload in progress has this ID.");
  }
  return { ...video, uploadId: video.uploadId };
}

async function findSeries(repository: SeriesRepository, id: string): Promise<SeriesRecord> {
  const series = await repository.find(id);
  if (series === null) throw notFound("No series has this ID.");
  return series;
}

async function findPlaylist(repository: PlaylistRepository, id: string): Promise<PlaylistRecord> {
  const playlist = await repository.find(id);
  if (playlist === null) throw notFound("No playlist has this ID.");
  return playlist;
}

/**
 * The body of a request that sends a file, with its length, which must be from min to max bytes.
 * The body streams to the bucket, which needs its length first, so the request must carry a
 * Content-Length header.
 */
function requestBody(request: Request, min: number, max: number): { body: ReadableStream<Uint8Array>; length: number } {
  const header = request.headers.get("content-length");
  if (header === null || !/^[0-9]{1,15}$/.test(header)) {
    throw new HttpError(411, "length_required", "Send the file with a Content-Length header.");
  }
  const length = Number(header);
  if (length < min || length > max) {
    throw badRequest(min === max ? `The file must be ${min} bytes long.` : `The file must be ${min} to ${max} bytes long.`);
  }
  return { body: request.body ?? new Blob([]).stream(), length };
}

function requireContentType(request: Request, contentType: string): void {
  const sent = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (sent !== contentType) throw new HttpError(415, "unsupported_media_type", `Send the file as ${contentType}.`);
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

async function uploaderOf(video: VideoRecord): Promise<UserSummary | null> {
  if (video.uploaderId === null) return null;
  return {
    id: video.uploaderId,
    displayName: video.uploaderName ?? "",
    avatarUrl: fileUrlOrNull(video.uploaderAvatarKey),
  };
}

async function toSummary(video: VideoRecord): Promise<VideoSummary> {
  return {
    id: video.id,
    title: video.title,
    durationSec: video.durationSec,
    thumbnailUrl: thumbnailUrlOf(video),
    createdAt: video.createdAt,
    uploader: await uploaderOf(video),
    series: video.seriesId === null || video.seriesTitle === null ? null : { id: video.seriesId, title: video.seriesTitle },
    ratingAverage: video.ratingCount === 0 ? 0 : video.ratingScore / 1000,
    ratingCount: video.ratingCount,
    commentCount: video.commentCount,
    attachmentCount: video.attachmentCount,
  };
}

async function toDetail(db: Database, video: VideoRecord, viewer: Viewer): Promise<VideoDetail> {
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
    playbackUrl: fileUrl(video.objectKey),
    thumbnailUrl: thumbnailUrlOf(video),
    uploader: await uploaderOf(video),
    series: await seriesOf(db, video),
    rating: await new RatingRepository(db).summary(video.id, viewer.id),
    attachments: await Promise.all(
      (await new AttachmentRepository(db).listReady(video.id)).map((attachment) => toAttachment(attachment)),
    ),
    // The one person of albireo edits everything.
    canEdit: true,
  };
}

// Where a video sits in its series. The episode number counts ready videos only.
async function seriesOf(db: Database, video: VideoRecord): Promise<VideoSeries | null> {
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

/** The person who made a series or a playlist. */
async function ownerOf(owned: SeriesRecord | PlaylistRecord): Promise<UserSummary> {
  return { id: owned.ownerId, displayName: owned.ownerName, avatarUrl: fileUrlOrNull(owned.ownerAvatarKey) };
}

async function toSeriesSummary(series: SeriesRecord): Promise<SeriesSummary> {
  return {
    id: series.id,
    title: series.title,
    owner: await ownerOf(series),
    coverUrl: fileUrlOrNull(series.coverKey),
    updatedAt: series.updatedAt,
  };
}

async function toSeriesDetail(db: Database, series: SeriesRecord): Promise<SeriesDetail> {
  const episodes = await new VideoRepository(db).listEpisodes(series.id);
  return {
    id: series.id,
    title: series.title,
    description: series.description,
    owner: await ownerOf(series),
    createdAt: series.createdAt,
    updatedAt: series.updatedAt,
    canEdit: true,
    episodes: await Promise.all(
      episodes.map(async (episode, index) => ({ ...(await toSummary(episode)), episode: index + 1 })),
    ),
  };
}

async function toPlaylistSummary(playlist: PlaylistRecord): Promise<PlaylistSummary> {
  return {
    id: playlist.id,
    title: playlist.title,
    owner: await ownerOf(playlist),
    coverUrl: fileUrlOrNull(playlist.coverKey),
    updatedAt: playlist.updatedAt,
  };
}

async function toPlaylistDetail(db: Database, playlist: PlaylistRecord): Promise<PlaylistDetail> {
  const videos = await new VideoRepository(db).listInPlaylist(playlist.id);
  return {
    id: playlist.id,
    title: playlist.title,
    description: playlist.description,
    owner: await ownerOf(playlist),
    createdAt: playlist.createdAt,
    updatedAt: playlist.updatedAt,
    canEdit: true,
    videos: await Promise.all(videos.map(async (video, index) => ({ ...(await toSummary(video)), position: index + 1 }))),
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

function encodeRatingCursor(cursor: RatingCursor): string {
  const json = JSON.stringify([cursor.score, cursor.count, cursor.createdAt, cursor.id]);
  return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeRatingCursor(value: string): RatingCursor {
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const parsed: unknown = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
    if (Array.isArray(parsed) && parsed.length === 4) {
      const [score, count, createdAt, id]: unknown[] = parsed;
      if (
        Number.isSafeInteger(score) && Number.isSafeInteger(count) && typeof createdAt === "string"
        && typeof id === "string" && ID_PATTERN.test(id)
      ) {
        return { score: score as number, count: count as number, createdAt, id };
      }
    }
  } catch {
    // An unreadable cursor gets the same answer as a well-formed but wrong one.
  }
  throw badRequest("The cursor is not valid. Pass nextCursor from the previous page.");
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

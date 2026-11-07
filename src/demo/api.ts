// Answers of the albireo API for the demo on GitHub Pages, from the made-up library of
// data.ts, so that the demo shows the real screens without a Worker, Cloudflare Access,
// or storage. Changes, such as a rating, a comment, a new series, or the language, stay
// in memory until the page reloads. The videos, the pictures, and the attachments are
// files beside the demo (media.ts) in place of signed URLs, with their sizes in a list
// beside them, and the demo keeps no files of its own, so uploads fail with a short
// message. Only the demo build imports this file (src/api.ts).

import {
  BIO_MAX_LENGTH,
  COMMENT_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  DISPLAY_NAME_MAX_LENGTH,
  isLanguage,
  LANGUAGES,
  LIST_PAGE_SIZE,
  RATING_MAX_STARS,
  SEARCH_QUERY_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  type CommentResponse,
  type EpisodeLink,
  type HistoryResponse,
  type ListCommentsResponse,
  type ListSeriesResponse,
  type ListVideosResponse,
  type Me,
  type MeResponse,
  type RatingResponse,
  type RecommendationsResponse,
  type SearchResponse,
  type SeriesDetail,
  type SeriesResponse,
  type SeriesSummary,
  type SessionsResponse,
  type SignInResponse,
  type UserProfile,
  type UserResponse,
  type UserSummary,
  type VideoAttachment,
  type VideoComment,
  type VideoDetail,
  type VideoRating,
  type VideoResponse,
  type VideoSeries,
  type VideoSummary,
} from "../../shared/api.ts";
import { ApiError } from "../api.ts";
import { createLibrary, type DemoAttachment, type DemoComment, type DemoPerson, type DemoSeries, type DemoVideo } from "./data.ts";
import { ATTACHMENT_FILES, MEDIA_PATHS, VIDEO_SECONDS } from "./media.ts";

const library = createLibrary(new Date());

const NO_FILES = "The demo does not keep files, so uploads are off.";
// Every sample video is 720p.
const SAMPLE_WIDTH = 1280;
const SAMPLE_HEIGHT = 720;
const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

// The sizes of the files beside the demo, by their paths, which scripts/demo-media.ts lists
// once it has made them. Without the list, sizes show as 0 bytes, and the rest still works.
let fileSizes: Record<string, number> = {};
const sizesLoaded = fetch(mediaUrl(MEDIA_PATHS.sizes))
  .then(async (response) => {
    if (response.ok) fileSizes = (await response.json()) as Record<string, number>;
  })
  .catch(() => undefined);

type Fields = Record<string, unknown>;

interface DemoRequest {
  /** The IDs in the path, in order. */
  ids: string[];
  query: URLSearchParams;
  body: Fields;
}

const ID = "([0-9a-z]{16})";
const route = (method: string, path: string, answer: (request: DemoRequest) => unknown) =>
  ({ method, path: new RegExp(`^${path.replaceAll(":id", ID)}$`), answer }) as const;

const ROUTES = [
  route("GET", "/api/me", () => ({ me: me() }) satisfies MeResponse),
  route("PATCH", "/api/me", ({ body }) => updateMe(body)),
  route("POST", "/api/me/avatar", noFiles),
  route("POST", "/api/me/avatar/commit", noFiles),
  route("DELETE", "/api/me/avatar", () => removePicture()),
  route("GET", "/api/me/sign-in", () => ({ signIn: library.signIn }) satisfies SignInResponse),
  route("GET", "/api/me/sessions", () => ({ sessions: library.sessions }) satisfies SessionsResponse),
  // The demo has no session of Access to forget.
  route("DELETE", "/api/me/sessions/current", () => undefined),
  route("GET", "/api/users/:id", ({ ids: [id = ""] }) => ({ user: profile(findPerson(id)) }) satisfies UserResponse),
  route("GET", "/api/history", ({ query }) => history(query.get("cursor"))),
  route("GET", "/api/recommendations", () => ({ videos: recommend().map(summary) }) satisfies RecommendationsResponse),
  route("POST", "/api/videos/:id/watched", ({ ids: [id = ""] }) => recordWatch(id)),
  route("GET", "/api/videos", ({ query }) => listVideos(query.get("uploader"), query.get("cursor"))),
  route("GET", "/api/videos/:id", ({ ids: [id = ""] }) => ({ video: detail(findVideo(id)) }) satisfies VideoResponse),
  route("PATCH", "/api/videos/:id", ({ ids: [id = ""], body }) => updateVideo(id, body)),
  route("GET", "/api/search", ({ query }) => search(query.get("q") ?? "", query.get("cursor"))),
  route("PUT", "/api/videos/:id/rating", ({ ids: [id = ""], body }) => rate(id, body)),
  route("DELETE", "/api/videos/:id/rating", ({ ids: [id = ""] }) => clearRating(id)),
  route("GET", "/api/videos/:id/comments", ({ ids: [id = ""], query }) => listComments(id, query.get("cursor"))),
  route("POST", "/api/videos/:id/comments", ({ ids: [id = ""], body }) => addComment(id, body)),
  route("DELETE", "/api/comments/:id", ({ ids: [id = ""] }) => deleteComment(id)),
  route("POST", "/api/videos/:id/attachments", noFiles),
  route("POST", "/api/attachments/:id/commit", noFiles),
  route("DELETE", "/api/attachments/:id", ({ ids: [id = ""] }) => removeAttachment(id)),
  route("POST", "/api/uploads", noFiles),
  route("POST", "/api/uploads/:id/parts", noFiles),
  route("POST", "/api/uploads/:id/complete", noFiles),
  route("POST", "/api/uploads/:id/abort", noFiles),
  route("POST", "/api/videos/:id/thumbnail", noFiles),
  route("POST", "/api/videos/:id/thumbnail/commit", noFiles),
  route("GET", "/api/series", ({ query }) => listSeries(query.get("owner"))),
  route("POST", "/api/series", ({ body }) => createSeries(body)),
  route("GET", "/api/series/:id", ({ ids: [id = ""] }) => ({ series: seriesDetail(findSeries(id)) }) satisfies SeriesResponse),
  route("PATCH", "/api/series/:id", ({ ids: [id = ""], body }) => updateSeries(id, body)),
  route("POST", "/api/series/:id/episodes/:id/move", ({ ids: [seriesId = "", videoId = ""], body }) => moveEpisode(seriesId, videoId, body)),
  route("DELETE", "/api/series/:id/episodes/:id", ({ ids: [seriesId = "", videoId = ""] }) => removeEpisode(seriesId, videoId)),
];

/**
 * The answer to a request for the API, such as GET /api/videos?cursor=48, as the Worker
 * would give it: a copy of the data, so that a page can keep it while the library changes,
 * or undefined where the Worker answers 204. Errors are an ApiError, as from the Worker.
 */
export async function demoResponse(path: string, method: string, body: unknown): Promise<unknown> {
  await sizesLoaded;
  const url = new URL(path, "https://demo.invalid");
  for (const candidate of ROUTES) {
    const match = candidate.path.exec(url.pathname);
    if (match === null || candidate.method !== method) continue;
    const fields = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Fields) : {};
    return structuredClone(candidate.answer({ ids: match.slice(1), query: url.searchParams, body: fields }));
  }
  throw new ApiError(404, "not_found", "No API endpoint matches this request.");
}

function noFiles(): never {
  throw new ApiError(403, "demo_keeps_no_files", NO_FILES);
}

function notFound(message: string): ApiError {
  return new ApiError(404, "not_found", message);
}

function badRequest(message: string): ApiError {
  return new ApiError(400, "bad_request", message);
}

function now(): string {
  return new Date().toISOString();
}

function newId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => ID_ALPHABET.charAt(byte % ID_ALPHABET.length)).join("");
}

/** A file beside the demo, under the base of the site, such as /albireo/media/videos/mandelbrot.mp4. */
function mediaUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

/** Reads a string field of a request, as the Worker checks it. */
function readText(body: Fields, key: string, min: number, max: number, trim: boolean): string {
  const value = body[key];
  if (typeof value !== "string") throw badRequest(`${key} must be a string.`);
  const text = trim ? value.trim() : value;
  if (text.length < min || text.length > max) throw badRequest(`${key} must be ${min} to ${max} characters long.`);
  return text;
}

/** A page of a list. The cursor is the number of items on the pages before it. */
function pageOf<T>(items: T[], cursor: string | null): { page: T[]; nextCursor: string | null } {
  const offset = cursor === null ? 0 : Number(cursor);
  if (!Number.isInteger(offset) || offset < 0) throw badRequest("The cursor is not valid. Pass nextCursor from the previous page.");
  const end = offset + LIST_PAGE_SIZE;
  return { page: items.slice(offset, end), nextCursor: end < items.length ? String(end) : null };
}

function findPerson(id: string): DemoPerson {
  const person = library.people.find((candidate) => candidate.id === id);
  if (person === undefined) throw notFound("No user has this ID.");
  return person;
}

function findVideo(id: string): DemoVideo {
  const video = library.videos.find((candidate) => candidate.id === id);
  if (video === undefined) throw notFound("No ready video has this ID.");
  return video;
}

function findSeries(id: string): DemoSeries {
  const series = library.series.find((candidate) => candidate.id === id);
  if (series === undefined) throw notFound("No series has this ID.");
  return series;
}

function personSummary(id: string): UserSummary {
  const person = findPerson(id);
  return { id: person.id, displayName: person.displayName, avatarUrl: person.picture === null ? null : mediaUrl(MEDIA_PATHS.picture(person.picture)) };
}

function profile(person: DemoPerson): UserProfile {
  return { ...personSummary(person.id), bio: person.bio };
}

function me(): Me {
  return {
    ...profile(findPerson(library.me.id)),
    email: library.me.email,
    isAdmin: library.me.isAdmin,
    joinedAt: library.me.joinedAt,
    language: library.me.language,
    // The demo has no Access session to end, so Log out opens the demo again.
    logoutUrl: import.meta.env.BASE_URL,
  };
}

function updateMe(body: Fields): MeResponse {
  const person = findPerson(library.me.id);
  if (!("displayName" in body) && !("bio" in body) && !("language" in body)) {
    throw badRequest("Send at least one of displayName, bio, and language.");
  }
  if ("displayName" in body) person.displayName = readText(body, "displayName", 1, DISPLAY_NAME_MAX_LENGTH, true);
  if ("bio" in body) person.bio = readText(body, "bio", 0, BIO_MAX_LENGTH, false);
  if ("language" in body) {
    const language = body["language"];
    if (!isLanguage(language)) throw badRequest(`language must be ${LANGUAGES.map((name) => `"${name}"`).join(" or ")}.`);
    library.me.language = language;
  }
  return { me: me() };
}

function removePicture(): MeResponse {
  findPerson(library.me.id).picture = null;
  return { me: me() };
}

function canEditVideo(video: DemoVideo): boolean {
  return library.me.isAdmin || video.uploaderId === library.me.id;
}

function canEditSeries(series: DemoSeries): boolean {
  return library.me.isAdmin || series.ownerId === library.me.id;
}

function summary(video: DemoVideo): VideoSummary {
  return {
    id: video.id,
    title: video.title,
    durationSec: VIDEO_SECONDS[video.media],
    thumbnailUrl: mediaUrl(MEDIA_PATHS.poster(video.media)),
    createdAt: video.createdAt,
    uploader: personSummary(video.uploaderId),
  };
}

function detail(video: DemoVideo): VideoDetail {
  return {
    id: video.id,
    title: video.title,
    description: video.description,
    durationSec: VIDEO_SECONDS[video.media],
    width: SAMPLE_WIDTH,
    height: SAMPLE_HEIGHT,
    fileSize: fileSizes[MEDIA_PATHS.video(video.media)] ?? 0,
    contentType: "video/mp4",
    createdAt: video.createdAt,
    updatedAt: video.updatedAt,
    playbackUrl: mediaUrl(MEDIA_PATHS.video(video.media)),
    thumbnailUrl: mediaUrl(MEDIA_PATHS.poster(video.media)),
    uploader: personSummary(video.uploaderId),
    series: placeInSeries(video),
    rating: ratingOf(video.id),
    attachments: video.attachments.map(attachment),
    canEdit: canEditVideo(video),
  };
}

function attachment(item: DemoAttachment): VideoAttachment {
  const file = ATTACHMENT_FILES[item.file];
  const path = MEDIA_PATHS.attachment(file.fileName);
  const url = mediaUrl(path);
  return {
    id: item.id,
    fileName: file.fileName,
    contentType: file.contentType,
    fileSize: fileSizes[path] ?? 0,
    createdAt: item.createdAt,
    viewUrl: url,
    downloadUrl: url,
  };
}

/** The ready videos, from the newest, as the library lists them. */
function newestFirst(): DemoVideo[] {
  return [...library.videos].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || (a.id < b.id ? 1 : -1));
}

function listVideos(uploaderId: string | null, cursor: string | null): ListVideosResponse {
  const videos = newestFirst().filter((video) => uploaderId === null || video.uploaderId === uploaderId);
  const { page, nextCursor } = pageOf(videos, cursor);
  return { videos: page.map(summary), nextCursor };
}

/** The videos that Alex watched, from the last watched. */
function watched(): { video: DemoVideo; watchedAt: string }[] {
  return [...library.history]
    .sort((a, b) => b.watchedAt.localeCompare(a.watchedAt))
    .flatMap((entry) => {
      const video = library.videos.find((candidate) => candidate.id === entry.videoId);
      return video === undefined ? [] : [{ video, watchedAt: entry.watchedAt }];
    });
}

function history(cursor: string | null): HistoryResponse {
  const { page, nextCursor } = pageOf(watched(), cursor);
  return { videos: page.map(({ video, watchedAt }) => ({ ...summary(video), watchedAt })), nextCursor };
}

function recordWatch(id: string): undefined {
  const video = findVideo(id);
  library.history = [...library.history.filter((entry) => entry.videoId !== video.id), { videoId: video.id, watchedAt: now() }];
  return undefined;
}

/**
 * The order of the home page, as the Worker makes it (recommend in worker/app.ts): the
 * next episode of each series that Alex is watching, then the videos that they did not
 * watch, those of familiar series and uploaders first, then the videos that they watched,
 * from the one watched longest ago.
 */
function recommend(): DemoVideo[] {
  const seen = watched().map((entry) => entry.video);
  const watchedIds = new Set(seen.map((video) => video.id));
  const picks: DemoVideo[] = [];
  const take = (video: DemoVideo) => {
    if (!picks.includes(video)) picks.push(video);
  };

  const lastWatched = new Map<string, string>();
  for (const video of seen) {
    if (video.seriesId !== null && !lastWatched.has(video.seriesId)) lastWatched.set(video.seriesId, video.id);
  }
  for (const [seriesId, videoId] of lastWatched) {
    const episodes = episodesOf(seriesId);
    const index = episodes.findIndex((episode) => episode.id === videoId);
    const next = episodes.slice(index + 1).find((episode) => !watchedIds.has(episode.id));
    if (next !== undefined) take(next);
  }

  const familiarUploaders = new Set(seen.map((video) => video.uploaderId));
  const familiarity = (video: DemoVideo) =>
    (video.seriesId !== null && lastWatched.has(video.seriesId) ? 2 : 0) + (familiarUploaders.has(video.uploaderId) ? 1 : 0);
  newestFirst()
    .filter((video) => !watchedIds.has(video.id))
    .map((video, newness) => ({ video, newness, score: familiarity(video) }))
    .sort((a, b) => b.score - a.score || a.newness - b.newness)
    .forEach(({ video }) => take(video));

  [...seen].reverse().forEach(take);
  return picks;
}

/** Videos whose title or description has every word of the query, those with the words in the title first. */
function search(query: string, cursor: string | null): SearchResponse {
  const text = query.trim();
  if (text === "" || text.length > SEARCH_QUERY_MAX_LENGTH) throw badRequest(`q must be 1 to ${SEARCH_QUERY_MAX_LENGTH} characters long.`);
  const terms = [...new Set(text.toLowerCase().split(/\s+/u))];
  const inTitle = (video: DemoVideo) => terms.filter((term) => video.title.toLowerCase().includes(term)).length;
  const found = newestFirst()
    .filter((video) => terms.every((term) => `${video.title}\n${video.description}`.toLowerCase().includes(term)))
    .sort((a, b) => inTitle(b) - inTitle(a));
  const { page, nextCursor } = pageOf(found, cursor);
  return { videos: page.map(summary), nextCursor };
}

function updateVideo(id: string, body: Fields): VideoResponse {
  const video = findVideo(id);
  if (!canEditVideo(video)) throw new ApiError(403, "forbidden", "Only the uploader of the video or an admin can edit it.");
  const title = "title" in body ? readText(body, "title", 1, TITLE_MAX_LENGTH, true) : video.title;
  const description = "description" in body ? readText(body, "description", 0, DESCRIPTION_MAX_LENGTH, false) : video.description;
  const time = now();
  if ("seriesId" in body) {
    const seriesId = body["seriesId"];
    if (seriesId !== null && typeof seriesId !== "string") throw badRequest("seriesId must be a series ID or null.");
    if (seriesId !== video.seriesId) {
      if (seriesId !== null && !library.series.some((series) => series.id === seriesId)) throw badRequest("No series has this seriesId.");
      const before = video.seriesId;
      // A video that joins a series becomes its last episode.
      video.seriesPosition = seriesId === null ? null : Math.max(0, ...episodesOf(seriesId).map((episode) => episode.seriesPosition ?? 0)) + 1;
      video.seriesId = seriesId;
      for (const changed of [before, seriesId]) {
        if (changed !== null) findSeries(changed).updatedAt = time;
      }
    }
  }
  video.title = title;
  video.description = description;
  video.updatedAt = time;
  return { video: detail(video) };
}

function ratingOf(videoId: string): VideoRating {
  const ratings = library.ratings.filter((rating) => rating.videoId === videoId);
  const total = ratings.reduce((sum, rating) => sum + rating.stars, 0);
  return {
    average: ratings.length === 0 ? null : total / ratings.length,
    count: ratings.length,
    mine: ratings.find((rating) => rating.personId === library.me.id)?.stars ?? null,
  };
}

function rate(id: string, body: Fields): RatingResponse {
  const stars = body["stars"];
  if (typeof stars !== "number" || !Number.isInteger(stars) || stars < 1 || stars > RATING_MAX_STARS) {
    throw badRequest(`stars must be a whole number from 1 to ${RATING_MAX_STARS}.`);
  }
  const video = findVideo(id);
  library.ratings = [...library.ratings.filter((rating) => rating.videoId !== video.id || rating.personId !== library.me.id), { videoId: video.id, personId: library.me.id, stars }];
  return { rating: ratingOf(video.id) };
}

function clearRating(id: string): RatingResponse {
  const video = findVideo(id);
  library.ratings = library.ratings.filter((rating) => rating.videoId !== video.id || rating.personId !== library.me.id);
  return { rating: ratingOf(video.id) };
}

function toComment(comment: DemoComment): VideoComment {
  const video = library.videos.find((candidate) => candidate.id === comment.videoId);
  return {
    id: comment.id,
    body: comment.body,
    createdAt: comment.createdAt,
    author: personSummary(comment.authorId),
    canDelete: library.me.isAdmin || comment.authorId === library.me.id || video?.uploaderId === library.me.id,
  };
}

function listComments(videoId: string, cursor: string | null): ListCommentsResponse {
  const video = findVideo(videoId);
  const comments = library.comments
    .filter((comment) => comment.videoId === video.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || (a.id < b.id ? 1 : -1));
  const { page, nextCursor } = pageOf(comments, cursor);
  return { comments: page.map(toComment), nextCursor };
}

function addComment(videoId: string, body: Fields): CommentResponse {
  const video = findVideo(videoId);
  const comment = { id: newId(), videoId: video.id, authorId: library.me.id, body: readText(body, "body", 1, COMMENT_MAX_LENGTH, true), createdAt: now() };
  library.comments.push(comment);
  return { comment: toComment(comment) };
}

function deleteComment(id: string): undefined {
  const comment = library.comments.find((candidate) => candidate.id === id);
  if (comment === undefined) throw notFound("No comment has this ID.");
  if (!toComment(comment).canDelete) {
    throw new ApiError(403, "forbidden", "Only the author of the comment, the uploader of the video, or an admin can delete it.");
  }
  library.comments = library.comments.filter((candidate) => candidate.id !== id);
  return undefined;
}

function removeAttachment(id: string): undefined {
  const video = library.videos.find((candidate) => candidate.attachments.some((item) => item.id === id));
  if (video === undefined) throw notFound("No attachment has this ID.");
  if (!canEditVideo(video)) throw new ApiError(403, "forbidden", "Only the uploader of the video or an admin can change its attachments.");
  video.attachments = video.attachments.filter((item) => item.id !== id);
  return undefined;
}

/** The ready episodes of a series, in their order. */
function episodesOf(seriesId: string): DemoVideo[] {
  return library.videos
    .filter((video) => video.seriesId === seriesId)
    .sort((a, b) => (a.seriesPosition ?? 0) - (b.seriesPosition ?? 0) || (a.id < b.id ? -1 : 1));
}

function placeInSeries(video: DemoVideo): VideoSeries | null {
  if (video.seriesId === null) return null;
  const series = findSeries(video.seriesId);
  const episodes = episodesOf(series.id);
  const index = episodes.findIndex((episode) => episode.id === video.id);
  const link = (episode: DemoVideo | undefined): EpisodeLink | null => (episode === undefined ? null : { id: episode.id, title: episode.title });
  return { id: series.id, title: series.title, episode: index + 1, previous: link(episodes[index - 1]), next: link(episodes[index + 1]) };
}

function seriesSummary(series: DemoSeries): SeriesSummary {
  const cover = episodesOf(series.id)[0];
  return {
    id: series.id,
    title: series.title,
    owner: personSummary(series.ownerId),
    coverUrl: cover === undefined ? null : mediaUrl(MEDIA_PATHS.poster(cover.media)),
    updatedAt: series.updatedAt,
  };
}

function seriesDetail(series: DemoSeries): SeriesDetail {
  return {
    id: series.id,
    title: series.title,
    description: series.description,
    owner: personSummary(series.ownerId),
    createdAt: series.createdAt,
    updatedAt: series.updatedAt,
    canEdit: canEditSeries(series),
    episodes: episodesOf(series.id).map((video, index) => ({ ...summary(video), episode: index + 1 })),
  };
}

/** Every series, or those of one person, from the one that changed last. */
function listSeries(ownerId: string | null): ListSeriesResponse {
  const series = library.series
    .filter((item) => ownerId === null || item.ownerId === ownerId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || (a.id < b.id ? 1 : -1));
  return { series: series.map(seriesSummary) };
}

function createSeries(body: Fields): SeriesResponse {
  const time = now();
  const series: DemoSeries = {
    id: newId(),
    title: readText(body, "title", 1, TITLE_MAX_LENGTH, true),
    description: readText(body, "description", 0, DESCRIPTION_MAX_LENGTH, false),
    ownerId: library.me.id,
    createdAt: time,
    updatedAt: time,
  };
  library.series.push(series);
  return { series: seriesDetail(series) };
}

function updateSeries(id: string, body: Fields): SeriesResponse {
  const series = findSeries(id);
  if (!canEditSeries(series)) throw new ApiError(403, "forbidden", "Only the creator of the series or an admin can edit it.");
  if ("title" in body) series.title = readText(body, "title", 1, TITLE_MAX_LENGTH, true);
  if ("description" in body) series.description = readText(body, "description", 0, DESCRIPTION_MAX_LENGTH, false);
  series.updatedAt = now();
  return { series: seriesDetail(series) };
}

function moveEpisode(seriesId: string, videoId: string, body: Fields): SeriesResponse {
  const series = findSeries(seriesId);
  const direction = body["direction"];
  if (direction !== "earlier" && direction !== "later") throw badRequest('direction must be "earlier" or "later".');
  if (!canEditSeries(series)) throw new ApiError(403, "forbidden", "Only the creator of the series or an admin can reorder it.");
  const episodes = episodesOf(series.id);
  const index = episodes.findIndex((episode) => episode.id === videoId);
  const episode = episodes[index];
  if (episode === undefined) throw notFound("The series has no ready episode with this ID.");
  const neighbor = episodes[direction === "earlier" ? index - 1 : index + 1];
  if (neighbor === undefined) throw new ApiError(409, "conflict", `The episode is already the ${direction === "earlier" ? "first" : "last"} one.`);
  [episode.seriesPosition, neighbor.seriesPosition] = [neighbor.seriesPosition, episode.seriesPosition];
  series.updatedAt = now();
  return { series: seriesDetail(series) };
}

function removeEpisode(seriesId: string, videoId: string): SeriesResponse {
  const series = findSeries(seriesId);
  const video = findVideo(videoId);
  if (video.seriesId !== series.id) throw notFound("The series has no episode with this ID.");
  if (!canEditSeries(series) && !canEditVideo(video)) {
    throw new ApiError(403, "forbidden", "Only the creator of the series, the uploader of the video, or an admin can take it out.");
  }
  const time = now();
  video.seriesId = null;
  video.seriesPosition = null;
  video.updatedAt = time;
  series.updatedAt = time;
  return { series: seriesDetail(series) };
}

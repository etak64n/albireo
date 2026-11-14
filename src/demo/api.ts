// Answers of the albireo API for the demo on GitHub Pages, from the made-up library of
// data.ts, so that the demo shows the real screens without the server, a database, or a
// bucket. Changes, such as a rating, a comment, a new series or playlist, the language, a role,
// or an invitation, stay in memory until the page reloads. The videos, the pictures, and the
// attachments are files beside the demo (media.ts), with their sizes in a list beside them,
// and the demo keeps no files of its own, so uploads fail with a short message. The demo
// signs in with any email and password, and makes no accounts. Only the demo build imports
// this file (src/api.ts).

import {
  BIO_MAX_LENGTH,
  COMMENT_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  DISPLAY_NAME_MAX_LENGTH,
  isLanguage,
  isVideoSort,
  LANGUAGES,
  LIST_PAGE_SIZE,
  PASSWORD_MAX_LENGTH,
  RATING_MAX_STARS,
  SEARCH_QUERY_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  VIDEO_SORTS,
  type CommentResponse,
  type CreateInvitationResponse,
  type EpisodeLink,
  type HistoryResponse,
  type Invitation,
  type JoinInfoResponse,
  type ListCommentsResponse,
  type ListInvitationsResponse,
  type ListPeopleResponse,
  type ListPlaylistsResponse,
  type ListSeriesResponse,
  type ListVideosResponse,
  type Me,
  type MeResponse,
  type Person,
  type PersonResponse,
  type PlaylistChoicesResponse,
  type PlaylistDetail,
  type PlaylistResponse,
  type PlaylistSummary,
  type RatingResponse,
  type RandomVideosResponse,
  type RecommendationsResponse,
  type SearchResponse,
  type SeriesDetail,
  type SeriesResponse,
  type SeriesSummary,
  type SessionsResponse,
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
import {
  createLibrary,
  type DemoAttachment,
  type DemoComment,
  type DemoInvitation,
  type DemoPerson,
  type DemoPlaylist,
  type DemoSeries,
  type DemoVideo,
} from "./data.ts";
import { ATTACHMENT_FILES, MEDIA_PATHS, VIDEO_SECONDS } from "./media.ts";

const library = createLibrary(new Date());

const NO_FILES = "The demo does not keep files, so uploads are off.";
const NO_ACCOUNTS = "The demo makes no accounts. Its invitation links show the page of an invitation only.";
const INVITATION_MS = 7 * 24 * 3_600_000;
// The tokens of the invitations made in the demo, for the page of their links.
const invitationTokens = new Map<string, string>();
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
  // The demo signs in with any email and password, as the one person who is signed in.
  route("POST", "/api/sign-in", () => ({ me: me() }) satisfies MeResponse),
  route("POST", "/api/sign-out", () => undefined),
  route("GET", "/api/join/([A-Za-z0-9_-]+)", ({ ids: [token = ""] }) => joinInfo(token)),
  route("POST", "/api/join/([A-Za-z0-9_-]+)", () => {
    throw new ApiError(403, "demo_makes_no_accounts", NO_ACCOUNTS);
  }),
  route("GET", "/api/me", () => ({ me: me() }) satisfies MeResponse),
  route("PATCH", "/api/me", ({ body }) => updateMe(body)),
  route("POST", "/api/me/avatar", noFiles),
  route("POST", "/api/me/avatar/commit", noFiles),
  route("DELETE", "/api/me/avatar", () => removePicture()),
  route("POST", "/api/me/password", ({ body }) => changePassword(body)),
  route("GET", "/api/me/sessions", () => ({ sessions: library.sessions }) satisfies SessionsResponse),
  route("DELETE", "/api/me/sessions/:id", ({ ids: [id = ""] }) => endSession(id)),
  route("GET", "/api/users/:id", ({ ids: [id = ""] }) => ({ user: profile(findPerson(id)) }) satisfies UserResponse),
  route("GET", "/api/people", () => listPeople()),
  route("PATCH", "/api/people/:id", ({ ids: [id = ""], body }) => updatePerson(id, body)),
  route("DELETE", "/api/people/:id", ({ ids: [id = ""] }) => removePerson(id)),
  route("GET", "/api/invitations", () => listInvitations()),
  route("POST", "/api/invitations", ({ body }) => createInvitation(body)),
  route("DELETE", "/api/invitations/:id", ({ ids: [id = ""] }) => deleteInvitation(id)),
  route("GET", "/api/history", ({ query }) => history(query.get("cursor"))),
  route("GET", "/api/recommendations", () => ({ videos: recommend().map(summary) }) satisfies RecommendationsResponse),
  // Before /api/videos/:id, which would take "random" for an ID.
  route("GET", "/api/videos/random", () => ({ videos: randomPicks().map(summary) }) satisfies RandomVideosResponse),
  route("POST", "/api/videos/:id/watched", ({ ids: [id = ""] }) => recordWatch(id)),
  route("GET", "/api/videos", ({ query }) => listVideos(query.get("uploader"), query.get("cursor"), query.get("sort") ?? "newest")),
  route("GET", "/api/videos/:id", ({ ids: [id = ""] }) => ({ video: detail(findVideo(id)) }) satisfies VideoResponse),
  route("PATCH", "/api/videos/:id", ({ ids: [id = ""], body }) => updateVideo(id, body)),
  route("DELETE", "/api/videos/:id", ({ ids: [id = ""] }) => deleteVideo(id)),
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
  route("DELETE", "/api/series/:id", ({ ids: [id = ""] }) => deleteSeries(id)),
  route("POST", "/api/series/:id/episodes/:id/move", ({ ids: [seriesId = "", videoId = ""], body }) => moveEpisode(seriesId, videoId, body)),
  route("DELETE", "/api/series/:id/episodes/:id", ({ ids: [seriesId = "", videoId = ""] }) => removeEpisode(seriesId, videoId)),
  route("GET", "/api/videos/:id/playlists", ({ ids: [id = ""] }) => playlistChoices(id)),
  route("GET", "/api/playlists", ({ query }) => listPlaylists(query.get("owner"))),
  route("POST", "/api/playlists", ({ body }) => createPlaylist(body)),
  route("GET", "/api/playlists/:id", ({ ids: [id = ""] }) => ({ playlist: playlistDetail(findPlaylist(id)) }) satisfies PlaylistResponse),
  route("PATCH", "/api/playlists/:id", ({ ids: [id = ""], body }) => updatePlaylist(id, body)),
  route("DELETE", "/api/playlists/:id", ({ ids: [id = ""] }) => deletePlaylist(id)),
  route("POST", "/api/playlists/:id/videos", ({ ids: [id = ""], body }) => addToPlaylist(id, body)),
  route("DELETE", "/api/playlists/:id/videos/:id", ({ ids: [playlistId = "", videoId = ""] }) => removeFromPlaylist(playlistId, videoId)),
  route("POST", "/api/playlists/:id/videos/:id/move", ({ ids: [playlistId = "", videoId = ""], body }) => movePlaylistVideo(playlistId, videoId, body)),
];

/**
 * The answer to a request for the API, such as GET /api/videos?cursor=48, as the server
 * would give it: a copy of the data, so that a page can keep it while the library changes,
 * or undefined where the server answers 204. Errors are an ApiError, as from the server.
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

/** A file beside the demo, under the base of the site, such as /albireo-on-cloudflare/media/videos/mandelbrot.mp4. */
function mediaUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

/** Reads a string field of a request, as the server checks it. */
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

function findPlaylist(id: string): DemoPlaylist {
  const playlist = library.playlists.find((candidate) => candidate.id === id);
  if (playlist === undefined) throw notFound("No playlist has this ID.");
  return playlist;
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
  const person = findPerson(library.me.id);
  return { ...profile(person), email: person.email, isAdmin: person.isAdmin, joinedAt: person.joinedAt, language: library.me.language };
}

function isAdmin(): boolean {
  return findPerson(library.me.id).isAdmin;
}

function requireAdmin(what: string): void {
  if (!isAdmin()) throw new ApiError(403, "forbidden", `Only admins can ${what}.`);
}

/** Checks the new password as the server does. The demo has no password, so any current one is right. */
function changePassword(body: Fields): undefined {
  readText(body, "currentPassword", 0, PASSWORD_MAX_LENGTH * 4, false);
  const password = readText(body, "newPassword", 0, PASSWORD_MAX_LENGTH * 4, false);
  if (password.length === 0) {
    throw badRequest("newPassword is required.");
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw badRequest(`newPassword must be at most ${PASSWORD_MAX_LENGTH} characters long.`);
  }
  // A new password ends the sessions of the other browsers.
  library.sessions = library.sessions.filter((session) => session.current);
  return undefined;
}

function endSession(id: string): undefined {
  const session = library.sessions.find((candidate) => candidate.id === id);
  if (session === undefined) throw notFound("No session of yours has this ID.");
  // The demo keeps the session of this browser, so that the demo stays signed in.
  if (!session.current) library.sessions = library.sessions.filter((other) => other.id !== id);
  return undefined;
}

function person(record: DemoPerson): Person {
  return {
    ...personSummary(record.id),
    email: record.email,
    isAdmin: record.isAdmin,
    joinedAt: record.joinedAt,
    lastActiveAt: record.lastActiveAt,
  };
}

function listPeople(): ListPeopleResponse {
  requireAdmin("see the people of albireo");
  return { people: library.people.filter((record) => !record.removed).map(person) };
}

/** Changes the role of a person, as the server does: albireo keeps at least one admin. */
function updatePerson(id: string, body: Fields): PersonResponse {
  requireAdmin("change who is an admin");
  const record = findPerson(id);
  if (record.removed) throw notFound("No person has this ID.");
  const value = body["isAdmin"];
  if (typeof value !== "boolean") throw badRequest("isAdmin must be true or false.");
  const admins = library.people.filter((other) => other.isAdmin && !other.removed);
  if (!value && record.isAdmin && admins.length === 1) {
    throw new ApiError(409, "conflict", "albireo needs at least one admin. Make someone else an admin first.");
  }
  record.isAdmin = value;
  return { person: person(record) };
}

/** Removes a person, as the server does: their videos, comments, series, and playlists stay. */
function removePerson(id: string): undefined {
  requireAdmin("remove people");
  if (id === library.me.id) throw new ApiError(409, "conflict", "You cannot remove yourself. Another admin can.");
  const record = findPerson(id);
  if (record.removed) throw notFound("No person has this ID.");
  const admins = library.people.filter((other) => other.isAdmin && !other.removed);
  if (record.isAdmin && admins.length === 1) {
    throw new ApiError(409, "conflict", "albireo needs at least one admin. Make someone else an admin first.");
  }
  record.removed = true;
  return undefined;
}

function invitation(record: DemoInvitation): Invitation {
  return {
    id: record.id,
    isAdmin: record.isAdmin,
    invitedBy: personSummary(record.invitedById),
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  };
}

function listInvitations(): ListInvitationsResponse {
  requireAdmin("see the invitations");
  return { invitations: library.invitations.map(invitation) };
}

/** Makes an invitation. Its link opens the page of the invitation in the demo, which makes no account. */
function createInvitation(body: Fields): CreateInvitationResponse {
  requireAdmin("invite people");
  const value = body["isAdmin"];
  if (typeof value !== "boolean") throw badRequest("isAdmin must be true or false.");
  const record: DemoInvitation = {
    id: newId(),
    isAdmin: value,
    invitedById: library.me.id,
    createdAt: now(),
    expiresAt: new Date(Date.now() + INVITATION_MS).toISOString(),
  };
  library.invitations.unshift(record);
  const token = newId() + newId();
  invitationTokens.set(token, record.id);
  return { invitation: invitation(record), token };
}

function deleteInvitation(id: string): undefined {
  requireAdmin("delete invitations");
  if (!library.invitations.some((record) => record.id === id)) throw notFound("No invitation has this ID.");
  library.invitations = library.invitations.filter((record) => record.id !== id);
  return undefined;
}

function joinInfo(token: string): JoinInfoResponse {
  const record = library.invitations.find((candidate) => candidate.id === invitationTokens.get(token));
  if (record === undefined) {
    throw notFound("This invitation does not work: someone used it, it expired, or an admin deleted it. Ask an admin for a new one.");
  }
  return { invitation: { isAdmin: record.isAdmin, invitedBy: findPerson(record.invitedById).displayName, expiresAt: record.expiresAt } };
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
  return isAdmin() || video.uploaderId === library.me.id;
}

function canEditSeries(series: DemoSeries): boolean {
  return isAdmin() || series.ownerId === library.me.id;
}

function summary(video: DemoVideo): VideoSummary {
  const series = library.series.find((item) => item.id === video.seriesId);
  const rating = ratingOf(video.id);
  return {
    id: video.id,
    title: video.title,
    durationSec: VIDEO_SECONDS[video.media],
    thumbnailUrl: mediaUrl(MEDIA_PATHS.poster(video.media)),
    createdAt: video.createdAt,
    uploader: personSummary(video.uploaderId),
    series: series === undefined ? null : { id: series.id, title: series.title },
    ratingAverage: rating.average ?? 0,
    ratingCount: rating.count,
    commentCount: library.comments.filter((comment) => comment.videoId === video.id).length,
    attachmentCount: video.attachments.length,
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

/** Lists the videos in the order that the server uses for the sort (server/src/repo/videos.rs). */
function listVideos(uploaderId: string | null, cursor: string | null, sort: string): ListVideosResponse {
  if (!isVideoSort(sort)) throw badRequest(`sort must be one of ${VIDEO_SORTS.join(", ")}.`);
  if (uploaderId !== null && sort !== "newest") throw badRequest("The videos of one person list from the newest only.");
  const newest = newestFirst().filter((video) => uploaderId === null || video.uploaderId === uploaderId);
  const videos = sort === "newest" ? newest : sort === "oldest" ? [...newest].reverse() : byRating(newest);
  const { page, nextCursor } = pageOf(videos, cursor);
  return { videos: page.map(summary), nextCursor };
}

/** The highest average first, as its stars times 1000 rounded down, then more ratings, then the newest. */
function byRating(newest: DemoVideo[]): DemoVideo[] {
  const keyOf = (video: DemoVideo) => {
    const { average, count } = ratingOf(video.id);
    return { score: average === null ? 0 : Math.floor(average * 1000), count };
  };
  // The sort is stable, so videos with the same score and count keep the order from the newest.
  return [...newest].sort((a, b) => {
    const first = keyOf(a);
    const second = keyOf(b);
    return second.score - first.score || second.count - first.count;
  });
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
 * The order of the home page, as the server makes it (recommend in server/src/api/videos.rs): the
 * next episode of each series that Alex is watching, then the videos that they did not
 * watch, those of familiar series and uploaders first, then the videos that they watched,
 * from the one watched longest ago.
 */
/** A page of videos at random, as the server picks them for Home between its recommendations. */
function randomPicks(): DemoVideo[] {
  const videos = [...library.videos];
  for (let index = videos.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    const video = videos[index] as DemoVideo;
    videos[index] = videos[other] as DemoVideo;
    videos[other] = video;
  }
  return videos.slice(0, LIST_PAGE_SIZE);
}

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
    canDelete: isAdmin() || comment.authorId === library.me.id || video?.uploaderId === library.me.id,
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

// The demo keeps no files, so deleting a video forgets it and everything that points at it.
function deleteVideo(id: string): undefined {
  const video = findVideo(id);
  if (!canEditVideo(video)) throw new ApiError(403, "forbidden", "Only the uploader of the video or an admin can delete it.");
  library.videos = library.videos.filter((item) => item.id !== video.id);
  library.comments = library.comments.filter((item) => item.videoId !== video.id);
  library.ratings = library.ratings.filter((item) => item.videoId !== video.id);
  library.history = library.history.filter((item) => item.videoId !== video.id);
  for (const playlist of library.playlists) playlist.videoIds = playlist.videoIds.filter((videoId) => videoId !== video.id);
  const series = library.series.find((item) => item.id === video.seriesId);
  if (series !== undefined) series.updatedAt = now();
  return undefined;
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

/** Deletes a series, as the server does: its videos stay in the library, out of any series. */
function deleteSeries(id: string): undefined {
  const series = findSeries(id);
  if (!canEditSeries(series)) throw new ApiError(403, "forbidden", "Only the creator of the series or an admin can delete it.");
  const time = now();
  for (const video of library.videos) {
    if (video.seriesId !== series.id) continue;
    video.seriesId = null;
    video.seriesPosition = null;
    video.updatedAt = time;
  }
  library.series = library.series.filter((item) => item.id !== series.id);
  return undefined;
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

function canEditPlaylist(playlist: DemoPlaylist): boolean {
  return isAdmin() || playlist.ownerId === library.me.id;
}

/** The videos of a playlist, in their order, without the ones that the library no longer has. */
function videosOf(playlist: DemoPlaylist): DemoVideo[] {
  return playlist.videoIds.flatMap((id) => library.videos.find((video) => video.id === id) ?? []);
}

function playlistSummary(playlist: DemoPlaylist): PlaylistSummary {
  const cover = videosOf(playlist)[0];
  return {
    id: playlist.id,
    title: playlist.title,
    owner: personSummary(playlist.ownerId),
    coverUrl: cover === undefined ? null : mediaUrl(MEDIA_PATHS.poster(cover.media)),
    updatedAt: playlist.updatedAt,
  };
}

function playlistDetail(playlist: DemoPlaylist): PlaylistDetail {
  return {
    id: playlist.id,
    title: playlist.title,
    description: playlist.description,
    owner: personSummary(playlist.ownerId),
    createdAt: playlist.createdAt,
    updatedAt: playlist.updatedAt,
    canEdit: canEditPlaylist(playlist),
    videos: videosOf(playlist).map((video, index) => ({ ...summary(video), position: index + 1 })),
  };
}

function newestPlaylistsFirst(): DemoPlaylist[] {
  return [...library.playlists].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || (a.id < b.id ? 1 : -1));
}

/** Every playlist, or those of one person, from the one that changed last. */
function listPlaylists(ownerId: string | null): ListPlaylistsResponse {
  const playlists = newestPlaylistsFirst().filter((item) => ownerId === null || item.ownerId === ownerId);
  return { playlists: playlists.map(playlistSummary) };
}

/** The playlists of the signed-in person, each with whether it holds the video. */
function playlistChoices(videoId: string): PlaylistChoicesResponse {
  const video = findVideo(videoId);
  const mine = newestPlaylistsFirst().filter((item) => item.ownerId === library.me.id);
  return { playlists: mine.map((item) => ({ id: item.id, title: item.title, hasVideo: item.videoIds.includes(video.id) })) };
}

function createPlaylist(body: Fields): PlaylistResponse {
  const time = now();
  const playlist: DemoPlaylist = {
    id: newId(),
    title: readText(body, "title", 1, TITLE_MAX_LENGTH, true),
    description: readText(body, "description", 0, DESCRIPTION_MAX_LENGTH, false),
    ownerId: library.me.id,
    createdAt: time,
    updatedAt: time,
    videoIds: [],
  };
  library.playlists.push(playlist);
  return { playlist: playlistDetail(playlist) };
}

function editablePlaylist(id: string, action: string): DemoPlaylist {
  const playlist = findPlaylist(id);
  if (!canEditPlaylist(playlist)) throw new ApiError(403, "forbidden", `Only the owner of the playlist or an admin can ${action} it.`);
  return playlist;
}

function updatePlaylist(id: string, body: Fields): PlaylistResponse {
  const playlist = editablePlaylist(id, "edit");
  if ("title" in body) playlist.title = readText(body, "title", 1, TITLE_MAX_LENGTH, true);
  if ("description" in body) playlist.description = readText(body, "description", 0, DESCRIPTION_MAX_LENGTH, false);
  playlist.updatedAt = now();
  return { playlist: playlistDetail(playlist) };
}

/** Deletes a playlist, as the server does: its videos stay in the library. */
function deletePlaylist(id: string): undefined {
  const playlist = editablePlaylist(id, "delete");
  library.playlists = library.playlists.filter((item) => item.id !== playlist.id);
  return undefined;
}

function addToPlaylist(id: string, body: Fields): PlaylistResponse {
  const playlist = editablePlaylist(id, "change");
  const videoId = body["videoId"];
  const video = library.videos.find((candidate) => candidate.id === videoId);
  if (video === undefined) throw badRequest("No ready video has this videoId.");
  if (playlist.videoIds.includes(video.id)) throw new ApiError(409, "conflict", "The playlist holds the video already.");
  playlist.videoIds.push(video.id);
  playlist.updatedAt = now();
  return { playlist: playlistDetail(playlist) };
}

function removeFromPlaylist(id: string, videoId: string): PlaylistResponse {
  const playlist = editablePlaylist(id, "change");
  if (!playlist.videoIds.includes(videoId)) throw notFound("The playlist does not hold a video with this ID.");
  playlist.videoIds = playlist.videoIds.filter((item) => item !== videoId);
  playlist.updatedAt = now();
  return { playlist: playlistDetail(playlist) };
}

function movePlaylistVideo(id: string, videoId: string, body: Fields): PlaylistResponse {
  const playlist = findPlaylist(id);
  const direction = body["direction"];
  if (direction !== "earlier" && direction !== "later") throw badRequest('direction must be "earlier" or "later".');
  editablePlaylist(id, "reorder");
  const index = playlist.videoIds.indexOf(videoId);
  if (index === -1) throw notFound("The playlist has no ready video with this ID.");
  const other = direction === "earlier" ? index - 1 : index + 1;
  const neighbor = playlist.videoIds[other];
  if (neighbor === undefined) throw new ApiError(409, "conflict", `The video is already the ${direction === "earlier" ? "first" : "last"} one.`);
  playlist.videoIds[other] = videoId;
  playlist.videoIds[index] = neighbor;
  playlist.updatedAt = now();
  return { playlist: playlistDetail(playlist) };
}

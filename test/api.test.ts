import { describe, expect, it } from "vitest";
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_NAME_MAX_LENGTH, COMMENT_MAX_LENGTH, LIST_PAGE_SIZE } from "../shared/api.ts";
import type {
  ApiErrorBody,
  AttachmentResponse,
  CommentResponse,
  CreateUploadResponse,
  HistoryResponse,
  ImageUploadResponse,
  ListCommentsResponse,
  ListPlaylistsResponse,
  ListSeriesResponse,
  ListVideosResponse,
  MeResponse,
  PartUrlsResponse,
  PlaylistChoicesResponse,
  PlaylistResponse,
  RandomVideosResponse,
  RatingResponse,
  RecommendationsResponse,
  SearchResponse,
  StartAttachmentResponse,
  SeriesResponse,
  ThumbnailUploadResponse,
  UserResponse,
  VideoResponse,
} from "../shared/api.ts";
import type { Database, Statement } from "../server/database.ts";
import { VideoRepository } from "../server/videos.ts";
import { createTestApp, file, json, type TestApp } from "./support/app.ts";

const MIB = 1024 * 1024;
const OWNER_ID = "user000000000001";

async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function startUpload(app: TestApp, title: string, fileSize: number, seriesId: string | null = null): Promise<CreateUploadResponse> {
  const response = await app.request(
    "/api/uploads",
    json({ title, fileName: "weekly-sync.MP4", fileSize, contentType: "video/mp4", seriesId }),
  );
  expect(response.status).toBe(201);
  return body<CreateUploadResponse>(response);
}

function allParts(upload: CreateUploadResponse) {
  return Array.from({ length: upload.partCount }, (_, index) => ({ partNumber: index + 1, etag: `"etag-${index + 1}"` }));
}

/** Uploads a video without sending its parts: the bucket in memory makes an object of its size. */
async function uploadVideo(app: TestApp, title = "Weekly sync", fileSize = 40 * MIB, seriesId: string | null = null): Promise<VideoResponse> {
  const upload = await startUpload(app, title, fileSize, seriesId);
  app.store.sizeOfCompletedObject = fileSize;
  const response = await app.request(
    `/api/uploads/${upload.videoId}/complete`,
    json({ parts: allParts(upload), durationSec: 3600, width: 1920, height: 1080 }),
  );
  expect(response.status).toBe(200);
  app.store.sizeOfCompletedObject = null;
  return body<VideoResponse>(response);
}

async function createSeries(app: TestApp, title: string): Promise<SeriesResponse> {
  const response = await app.request("/api/series", json({ title, description: "" }));
  expect(response.status).toBe(201);
  return body<SeriesResponse>(response);
}

async function createPlaylist(app: TestApp, title: string): Promise<PlaylistResponse> {
  const response = await app.request("/api/playlists", json({ title, description: "" }));
  expect(response.status).toBe(201);
  return body<PlaylistResponse>(response);
}

async function episodeTitles(app: TestApp, seriesId: string): Promise<string[]> {
  const { series } = await body<SeriesResponse>(await app.request(`/api/series/${seriesId}`));
  return series.episodes.map((episode) => `${episode.episode}. ${episode.title}`);
}

function bytesOf(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => index % 251);
}

describe("api", () => {
  it("marks API responses as not cacheable", async () => {
    const app = await createTestApp();
    expect((await app.request("/api/videos")).headers.get("cache-control")).toBe("no-store");
  });

  it("refuses a change that a page of another site asks for", async () => {
    const app = await createTestApp();
    for (const site of ["cross-site", "same-site"]) {
      const response = await app.request("/api/series", { ...json({ title: "Spam", description: "" }), headers: { "content-type": "application/json", "sec-fetch-site": site } });
      expect(response.status).toBe(403);
    }
    // Reads stay open, and so do changes from albireo's own pages and from clients that are no browser.
    expect((await app.request("/api/videos", { headers: { "sec-fetch-site": "cross-site" } })).status).toBe(200);
    const own = await app.request("/api/series", { ...json({ title: "Mine", description: "" }), headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" } });
    expect(own.status).toBe(201);
    expect((await app.request("/api/series", json({ title: "From curl", description: "" }))).status).toBe(201);
  });

  it("answers the health check", async () => {
    const app = await createTestApp();
    const response = await app.request("/healthz");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  it("answers 404 with JSON for an unknown endpoint of the API", async () => {
    const app = await createTestApp();
    const response = await app.request("/api/nothing");
    expect(response.status).toBe(404);
    expect((await body<ApiErrorBody>(response)).error.code).toBe("not_found");
  });
});

describe("the person", () => {
  it("is the one person of albireo, whom the server added", async () => {
    const app = await createTestApp();
    const { me } = await body<MeResponse>(await app.request("/api/me"));
    expect(me).toEqual({
      id: OWNER_ID,
      displayName: "Me",
      avatarUrl: null,
      bio: "",
      joinedAt: "2026-11-04T00:00:01.000Z",
      language: "en",
    });
  });

  it("changes the display name and the bio, which the channel shows", async () => {
    const app = await createTestApp();
    const response = await app.request("/api/me", json({ displayName: "  Shii  ", bio: "Recordings of my meetings" }, "PATCH"));
    expect((await body<MeResponse>(response)).me).toMatchObject({ displayName: "Shii", bio: "Recordings of my meetings" });
    const { user } = await body<UserResponse>(await app.request(`/api/users/${OWNER_ID}`));
    expect(user).toEqual({ id: OWNER_ID, displayName: "Shii", avatarUrl: null, bio: "Recordings of my meetings" });
  });

  it("changes the language of the browser app", async () => {
    const app = await createTestApp();
    const response = await app.request("/api/me", json({ language: "ja" }, "PATCH"));
    expect((await body<MeResponse>(response)).me).toMatchObject({ displayName: "Me", bio: "", language: "ja" });
    expect((await body<MeResponse>(await app.request("/api/me"))).me.language).toBe("ja");
  });

  it("refuses a language that the browser app does not have", async () => {
    const app = await createTestApp();
    const response = await app.request("/api/me", json({ language: "fr" }, "PATCH"));
    expect(response.status).toBe(400);
    expect((await body<ApiErrorBody>(response)).error.message).toBe('language must be "en" or "ja".');
    expect((await app.request("/api/me", json({ language: null }, "PATCH"))).status).toBe(400);
    expect((await app.request("/api/me", json({}, "PATCH"))).status).toBe(400);
    expect((await body<MeResponse>(await app.request("/api/me"))).me.language).toBe("en");
  });

  it("sets and removes the picture, which goes to albireo and from there to the bucket", async () => {
    const app = await createTestApp();
    const key = `avatars/${OWNER_ID}.jpg`;
    const target = await body<ImageUploadResponse>(await app.request("/api/me/avatar", { method: "POST" }));
    expect(target).toEqual({ url: "/api/me/avatar/file", contentType: "image/jpeg" });

    // Committing before the picture is in the bucket fails.
    expect((await app.request("/api/me/avatar/commit", { method: "POST" })).status).toBe(409);
    expect((await app.request(target.url, file(bytesOf(10), "image/png"))).status).toBe(415);
    expect((await app.request(target.url, file(bytesOf(4096), "image/jpeg"))).status).toBe(204);
    expect(app.store.objects.get(key)).toMatchObject({ size: 4096, contentType: "image/jpeg" });

    const committed = await body<MeResponse>(await app.request("/api/me/avatar/commit", { method: "POST" }));
    expect(committed.me.avatarUrl).toMatch(new RegExp(`^/api/files/${key}\\?v=\\d+$`));
    const removed = await body<MeResponse>(await app.request("/api/me/avatar", { method: "DELETE" }));
    expect(removed.me.avatarUrl).toBeNull();
    expect(app.store.objects.has(key)).toBe(false);
  });
});

describe("uploads", () => {
  it("starts a multipart upload with parts sized for the file", async () => {
    const app = await createTestApp();
    const upload = await startUpload(app, "Weekly sync", 40 * MIB);
    expect(upload).toEqual({ videoId: "video00000000001", partSize: 16 * MIB, partCount: 3 });
    expect([...app.store.uploads.values()]).toMatchObject([
      { key: "videos/video00000000001/original.mp4", contentType: "video/mp4", state: "open", parts: [] },
    ]);
  });

  it("answers with the URL on albireo of each requested part", async () => {
    const app = await createTestApp();
    const upload = await startUpload(app, "Weekly sync", 40 * MIB);
    const response = await app.request(`/api/uploads/${upload.videoId}/parts`, json({ partNumbers: [1, 3] }));
    expect(response.status).toBe(200);
    expect(await body<PartUrlsResponse>(response)).toEqual({
      parts: [
        { partNumber: 1, url: `/api/uploads/${upload.videoId}/parts/1` },
        { partNumber: 3, url: `/api/uploads/${upload.videoId}/parts/3` },
      ],
    });
  });

  it("refuses part numbers outside the upload or repeated", async () => {
    const app = await createTestApp();
    const upload = await startUpload(app, "Weekly sync", 40 * MIB);
    for (const partNumbers of [[0], [4], [1, 1], []]) {
      const response = await app.request(`/api/uploads/${upload.videoId}/parts`, json({ partNumbers }));
      expect(response.status).toBe(400);
    }
  });

  it("passes each part on to the bucket, and answers with its ETag", async () => {
    const app = await createTestApp();
    const upload = await startUpload(app, "Weekly sync", 17 * MIB);
    expect(upload.partCount).toBe(2);
    const first = await app.request(`/api/uploads/${upload.videoId}/parts/1`, file(bytesOf(16 * MIB)));
    expect(first.status).toBe(204);
    expect(first.headers.get("etag")).toBe('"etag-1"');
    const last = await app.request(`/api/uploads/${upload.videoId}/parts/2`, file(bytesOf(MIB)));
    expect(last.headers.get("etag")).toBe('"etag-2"');

    const completed = await app.request(
      `/api/uploads/${upload.videoId}/complete`,
      json({ parts: allParts(upload), durationSec: 8, width: 1280, height: 720 }),
    );
    expect(completed.status).toBe(200);
    expect(app.store.objects.get("videos/video00000000001/original.mp4")?.size).toBe(17 * MIB);
  });

  it("refuses a part of the wrong size, a part without its length, and a part that the upload does not have", async () => {
    const app = await createTestApp();
    const upload = await startUpload(app, "Weekly sync", 17 * MIB);
    expect((await app.request(`/api/uploads/${upload.videoId}/parts/2`, file(bytesOf(10)))).status).toBe(400);
    const unsized = await app.request(`/api/uploads/${upload.videoId}/parts/2`, { method: "PUT", body: bytesOf(MIB) });
    expect(unsized.status).toBe(411);
    for (const part of ["0", "3", "01", "x"]) {
      expect((await app.request(`/api/uploads/${upload.videoId}/parts/${part}`, file(bytesOf(MIB)))).status).toBe(404);
    }
    expect([...(app.store.uploads.get("upload-1")?.sent.keys() ?? [])]).toEqual([]);
  });

  it("keeps an upload out of the library until it completes", async () => {
    const app = await createTestApp();
    await startUpload(app, "Weekly sync", 40 * MIB);
    expect((await body<ListVideosResponse>(await app.request("/api/videos"))).videos).toEqual([]);
  });

  it("completes an upload and lists the video", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app, "Weekly sync", 40 * MIB);
    expect(video).toMatchObject({
      id: "video00000000001",
      title: "Weekly sync",
      description: "",
      durationSec: 3600,
      width: 1920,
      height: 1080,
      fileSize: 40 * MIB,
      contentType: "video/mp4",
      playbackUrl: "/api/files/videos/video00000000001/original.mp4",
      thumbnailUrl: null,
      uploader: { id: OWNER_ID, displayName: "Me", avatarUrl: null },
      canEdit: true,
    });
    const [stored] = app.store.uploads.values();
    expect(stored?.state).toBe("completed");
    expect(stored?.parts.map((part) => part.partNumber)).toEqual([1, 2, 3]);

    const list = await body<ListVideosResponse>(await app.request("/api/videos"));
    expect(list).toEqual({
      videos: [
        {
          id: "video00000000001",
          title: "Weekly sync",
          durationSec: 3600,
          thumbnailUrl: null,
          createdAt: video.createdAt,
          uploader: { id: OWNER_ID, displayName: "Me", avatarUrl: null },
          series: null,
          ratingAverage: 0,
          ratingCount: 0,
          commentCount: 0,
          attachmentCount: 0,
        },
      ],
      nextCursor: null,
    });
  });

  it("refuses to complete an upload that misses a part", async () => {
    const app = await createTestApp();
    const upload = await startUpload(app, "Weekly sync", 40 * MIB);
    const response = await app.request(
      `/api/uploads/${upload.videoId}/complete`,
      json({ parts: allParts(upload).slice(0, 2), durationSec: null, width: null, height: null }),
    );
    expect(response.status).toBe(400);
    expect(app.store.uploads.get("upload-1")?.state).toBe("open");
  });

  it("refuses to finish an upload whose stored object has another size", async () => {
    const app = await createTestApp();
    const upload = await startUpload(app, "Weekly sync", 40 * MIB);
    app.store.sizeOfCompletedObject = 1;
    const response = await app.request(
      `/api/uploads/${upload.videoId}/complete`,
      json({ parts: allParts(upload), durationSec: null, width: null, height: null }),
    );
    expect(response.status).toBe(502);
    expect((await body<ApiErrorBody>(response)).error.code).toBe("storage_error");
  });

  it("cancels an upload and forgets it", async () => {
    const app = await createTestApp();
    const upload = await startUpload(app, "Weekly sync", 40 * MIB);
    expect((await app.request(`/api/uploads/${upload.videoId}/abort`, { method: "POST" })).status).toBe(204);
    expect(app.store.uploads.get("upload-1")?.state).toBe("aborted");
    expect((await app.request(`/api/uploads/${upload.videoId}/parts`, json({ partNumbers: [1] }))).status).toBe(404);
    expect((await app.request(`/api/uploads/${upload.videoId}/parts/1`, file(bytesOf(16 * MIB)))).status).toBe(404);
  });

  it("refuses a file that is not a video", async () => {
    const app = await createTestApp();
    const response = await app.request(
      "/api/uploads",
      json({ title: "Slides", fileName: "slides.pdf", fileSize: 1024, contentType: "application/pdf", seriesId: null }),
    );
    expect(response.status).toBe(400);
  });

  it("refuses fields that the API does not know", async () => {
    const app = await createTestApp();
    const response = await app.request(
      "/api/uploads",
      json({ title: "Weekly sync", fileName: "weekly-sync.mp4", fileSize: 1024, contentType: "video/mp4", folder: "work" }),
    );
    expect(response.status).toBe(400);
    expect((await body<ApiErrorBody>(response)).error.message).toContain("folder");
  });
});

describe("library", () => {
  it("lists videos from the newest, one page at a time", async () => {
    const app = await createTestApp();
    for (let number = 1; number <= 50; number += 1) await uploadVideo(app, `Video ${number}`, MIB);

    const first = await body<ListVideosResponse>(await app.request("/api/videos"));
    expect(first.videos).toHaveLength(48);
    expect(first.videos[0]?.title).toBe("Video 50");
    expect(first.nextCursor).not.toBeNull();

    const second = await body<ListVideosResponse>(await app.request(`/api/videos?cursor=${encodeURIComponent(first.nextCursor ?? "")}`));
    expect(second.videos.map((video) => video.title)).toEqual(["Video 2", "Video 1"]);
    expect(second.nextCursor).toBeNull();
  });

  it("lists videos from the oldest", async () => {
    const app = await createTestApp();
    for (const title of ["Week 1", "Week 2", "Week 3"]) await uploadVideo(app, title, MIB);
    const { videos } = await body<ListVideosResponse>(await app.request("/api/videos?sort=oldest"));
    expect(videos.map((video) => video.title)).toEqual(["Week 1", "Week 2", "Week 3"]);
  });

  it("lists videos from the highest rated, from the newest among equals, and the unrated last", async () => {
    const app = await createTestApp();
    const ids: Record<string, string> = {};
    for (const title of ["A", "B", "C", "D"]) ids[title] = (await uploadVideo(app, title, MIB)).video.id;
    const rate = (title: string, stars: number) => app.request(`/api/videos/${ids[title]}/rating`, json({ stars }, "PUT"));
    await rate("A", 4);
    await rate("B", 5);
    await rate("C", 4);
    const titles = async () =>
      (await body<ListVideosResponse>(await app.request("/api/videos?sort=rating"))).videos.map((video) => video.title);
    expect(await titles()).toEqual(["B", "C", "A", "D"]);

    // Without its rating, B joins the unrated videos, from the newest.
    await app.request(`/api/videos/${ids["B"]}/rating`, { method: "DELETE" });
    expect(await titles()).toEqual(["C", "A", "D", "B"]);
  });

  it("pages through the highest rated videos", async () => {
    const app = await createTestApp();
    const ids: string[] = [];
    for (let number = 1; number <= 50; number += 1) ids.push((await uploadVideo(app, `Video ${number}`, MIB)).video.id);
    await app.request(`/api/videos/${ids[0]}/rating`, json({ stars: 5 }, "PUT"));

    const first = await body<ListVideosResponse>(await app.request("/api/videos?sort=rating"));
    expect(first.videos.map((video) => video.title).slice(0, 2)).toEqual(["Video 1", "Video 50"]);
    expect(first.videos).toHaveLength(48);
    const second = await body<ListVideosResponse>(
      await app.request(`/api/videos?sort=rating&cursor=${encodeURIComponent(first.nextCursor ?? "")}`),
    );
    expect(second.videos.map((video) => video.title)).toEqual(["Video 3", "Video 2"]);
    expect(second.nextCursor).toBeNull();
  });

  it("refuses an unknown order, another order for the videos of one person, and a cursor of another order", async () => {
    const app = await createTestApp();
    for (let number = 1; number <= 49; number += 1) await uploadVideo(app, `Video ${number}`, MIB);
    expect((await app.request("/api/videos?sort=title")).status).toBe(400);
    expect((await app.request(`/api/videos?sort=oldest&uploader=${OWNER_ID}`)).status).toBe(400);
    const { nextCursor } = await body<ListVideosResponse>(await app.request("/api/videos"));
    expect((await app.request(`/api/videos?sort=rating&cursor=${encodeURIComponent(nextCursor ?? "")}`)).status).toBe(400);
  });

  it("lists the videos of the person, for their channel", async () => {
    const app = await createTestApp();
    await uploadVideo(app, "Week 1", MIB);
    await uploadVideo(app, "Week 2", MIB);
    const { videos } = await body<ListVideosResponse>(await app.request(`/api/videos?uploader=${OWNER_ID}`));
    expect(videos.map((video) => video.title)).toEqual(["Week 2", "Week 1"]);
  });

  it("refuses a cursor that it did not issue", async () => {
    const app = await createTestApp();
    expect((await app.request("/api/videos?cursor=not-a-cursor")).status).toBe(400);
  });

  it("answers 404 for a video that does not exist", async () => {
    const app = await createTestApp();
    expect((await app.request("/api/videos/video99999999999")).status).toBe(404);
    expect((await app.request("/api/videos/NOT-AN-ID")).status).toBe(404);
  });

  it("changes the title and the description", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app);
    const response = await app.request(`/api/videos/${video.id}`, json({ title: "  Retro  ", description: "Notes" }, "PATCH"));
    expect(response.status).toBe(200);
    const { video: edited } = await body<VideoResponse>(response);
    expect(edited).toMatchObject({ title: "Retro", description: "Notes" });
    expect(edited.updatedAt > video.updatedAt).toBe(true);
  });

  it("refuses an empty title and an edit that changes nothing", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app);
    expect((await app.request(`/api/videos/${video.id}`, json({ title: "   " }, "PATCH"))).status).toBe(400);
    expect((await app.request(`/api/videos/${video.id}`, json({}, "PATCH"))).status).toBe(400);
  });
});

describe("thumbnails", () => {
  it("takes a JPEG, and shows it after the commit under a URL that changes with it", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app);
    const key = `thumbnails/${video.id}.jpg`;

    const target = await body<ThumbnailUploadResponse>(await app.request(`/api/videos/${video.id}/thumbnail`, { method: "POST" }));
    expect(target).toEqual({ url: `/api/videos/${video.id}/thumbnail/file`, contentType: "image/jpeg" });

    // Committing before the thumbnail is in the bucket fails.
    expect((await app.request(`/api/videos/${video.id}/thumbnail/commit`, { method: "POST" })).status).toBe(409);
    expect((await app.request(target.url, file(bytesOf(10), "text/html"))).status).toBe(415);
    expect((await app.request(target.url, file(new Uint8Array(0), "image/jpeg"))).status).toBe(400);
    expect((await app.request(target.url, file(bytesOf(2048), "image/jpeg"))).status).toBe(204);

    const committed = await app.request(`/api/videos/${video.id}/thumbnail/commit`, { method: "POST" });
    expect(committed.status).toBe(200);
    const { video: first } = await body<VideoResponse>(committed);
    expect(first.thumbnailUrl).toBe(`/api/files/${key}?v=${Date.parse(first.updatedAt)}`);

    await app.request(target.url, file(bytesOf(4096), "image/jpeg"));
    const { video: second } = await body<VideoResponse>(await app.request(`/api/videos/${video.id}/thumbnail/commit`, { method: "POST" }));
    expect(second.thumbnailUrl).not.toBe(first.thumbnailUrl);
  });
});

describe("files", () => {
  async function videoWithFile(app: TestApp, bytes: Uint8Array): Promise<string> {
    const { video } = await uploadVideo(app, "Clip", MIB);
    app.store.objects.set(`videos/${video.id}/original.mp4`, { size: bytes.length, contentType: "video/mp4", bytes, etag: '"clip"' });
    return video.playbackUrl;
  }

  it("streams a video and any range of it from the bucket", async () => {
    const app = await createTestApp();
    const bytes = bytesOf(1000);
    const url = await videoWithFile(app, bytes);

    const whole = await app.request(url);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-type")).toBe("video/mp4");
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    expect(new Uint8Array(await whole.arrayBuffer())).toEqual(bytes);

    const part = await app.request(url, { headers: { range: "bytes=100-199" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 100-199/1000");
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(bytes.slice(100, 200));

    expect((await app.request(url, { headers: { range: "bytes=5000-" } })).status).toBe(416);
  });

  it("answers 304 to a browser that holds the file, and HEAD without a body", async () => {
    const app = await createTestApp();
    const url = await videoWithFile(app, bytesOf(10));
    expect((await app.request(url, { headers: { "if-none-match": '"clip"' } })).status).toBe(304);
    const head = await app.request(url, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("10");
    expect(await head.text()).toBe("");
  });

  it("serves files that run nothing when opened on their own, and that the browser asks about again", async () => {
    const app = await createTestApp();
    const response = await app.request(await videoWithFile(app, bytesOf(10)));
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
  });

  it("answers 404 for other paths and for files that the bucket does not hold", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app, "Clip", MIB);
    app.store.objects.delete(`videos/${video.id}/original.mp4`);
    expect((await app.request(video.playbackUrl)).status).toBe(404);
    for (const path of ["/api/files/albireo-check/x", "/api/files/videos/../secrets", "/api/files/thumbnails/x.jpg", "/api/files/"]) {
      expect((await app.request(path)).status).toBe(404);
    }
  });
});

describe("series", () => {
  it("numbers episodes in the order that they join", async () => {
    const app = await createTestApp();
    const { series } = await createSeries(app, "Weekly syncs");
    expect(series).toMatchObject({ id: "series0000000001", owner: { displayName: "Me" }, canEdit: true, episodes: [] });
    const first = await uploadVideo(app, "Week 1", MIB, series.id);
    const second = await uploadVideo(app, "Week 2", MIB, series.id);
    expect(await episodeTitles(app, series.id)).toEqual(["1. Week 1", "2. Week 2"]);

    const { video } = await body<VideoResponse>(await app.request(`/api/videos/${second.video.id}`));
    expect(video.series).toEqual({
      id: series.id,
      title: "Weekly syncs",
      episode: 2,
      previous: { id: first.video.id, title: "Week 1" },
      next: null,
    });
  });

  it("lists every series from the one changed last, or those of the person", async () => {
    const app = await createTestApp();
    await createSeries(app, "Course");
    await createSeries(app, "Retros");
    const titles = async (query: string) =>
      (await body<ListSeriesResponse>(await app.request(`/api/series${query}`))).series.map((item) => `${item.title} by ${item.owner.displayName}`);
    expect(await titles("")).toEqual(["Retros by Me", "Course by Me"]);
    expect(await titles(`?owner=${OWNER_ID}`)).toEqual(["Retros by Me", "Course by Me"]);
  });

  it("moves an episode one place earlier or later", async () => {
    const app = await createTestApp();
    const { series } = await createSeries(app, "Weekly syncs");
    await uploadVideo(app, "Week 1", MIB, series.id);
    const second = await uploadVideo(app, "Week 2", MIB, series.id);
    const move = (direction: string) => app.request(`/api/series/${series.id}/episodes/${second.video.id}/move`, json({ direction }));
    expect((await move("earlier")).status).toBe(200);
    expect(await episodeTitles(app, series.id)).toEqual(["1. Week 2", "2. Week 1"]);
    expect((await move("earlier")).status).toBe(409);
  });

  it("takes an episode out of its series", async () => {
    const app = await createTestApp();
    const { series } = await createSeries(app, "Weekly syncs");
    const { video } = await uploadVideo(app, "Week 1", MIB, series.id);
    expect((await app.request(`/api/series/${series.id}/episodes/${video.id}`, { method: "DELETE" })).status).toBe(200);
    expect(await episodeTitles(app, series.id)).toEqual([]);
    expect((await app.request(`/api/series/${series.id}/episodes/${video.id}`, { method: "DELETE" })).status).toBe(404);
  });

  it("moves a video to the end of another series", async () => {
    const app = await createTestApp();
    const { series: course } = await createSeries(app, "Course");
    const { series: retros } = await createSeries(app, "Retros");
    await uploadVideo(app, "Retro 1", MIB, retros.id);
    const { video } = await uploadVideo(app, "Lesson 1", MIB, course.id);
    const moved = await app.request(`/api/videos/${video.id}`, json({ seriesId: retros.id }, "PATCH"));
    expect((await body<VideoResponse>(moved)).video.series?.episode).toBe(2);
    expect(await episodeTitles(app, course.id)).toEqual([]);
    expect(await episodeTitles(app, retros.id)).toEqual(["1. Retro 1", "2. Lesson 1"]);
  });

  it("refuses a series that does not exist", async () => {
    const app = await createTestApp();
    const response = await app.request(
      "/api/uploads",
      json({ title: "Week 1", fileName: "week-1.mp4", fileSize: MIB, contentType: "video/mp4", seriesId: "series9999999999" }),
    );
    expect(response.status).toBe(400);
  });

  it("renames a series", async () => {
    const app = await createTestApp();
    const { series } = await createSeries(app, "Weekly syncs");
    const renamed = await app.request(`/api/series/${series.id}`, json({ title: "Syncs" }, "PATCH"));
    expect((await body<SeriesResponse>(renamed)).series.title).toBe("Syncs");
  });

  it("deletes a series, and keeps its videos in the library out of any series", async () => {
    const app = await createTestApp();
    const { series } = await createSeries(app, "Weekly syncs");
    const { video } = await uploadVideo(app, "Week 1", MIB, series.id);
    expect((await app.request(`/api/series/${series.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await app.request(`/api/series/${series.id}`)).status).toBe(404);
    expect((await app.request(`/api/videos/${video.id}`)).status).toBe(200);
    const row = await app.db.prepare("SELECT series_id, series_position FROM videos WHERE id = ?").bind(video.id).first();
    expect({ ...row }).toEqual({ series_id: null, series_position: null });
  });
});

describe("video summaries", () => {
  const summaryOf = async (app: TestApp) => (await body<ListVideosResponse>(await app.request("/api/videos"))).videos[0];

  it("name the series, give the stars, and count the comments and the attachments that finished uploading", async () => {
    const app = await createTestApp();
    const { series } = await createSeries(app, "Weekly syncs");
    const { video } = await uploadVideo(app, "Week 1", MIB, series.id);
    await app.request(`/api/videos/${video.id}/comments`, json({ body: "One" }));
    const second = await body<CommentResponse>(await app.request(`/api/videos/${video.id}/comments`, json({ body: "Two" })));
    await app.request(`/api/videos/${video.id}/rating`, json({ stars: 4 }, "PUT"));
    const started = await body<StartAttachmentResponse>(
      await app.request(`/api/videos/${video.id}/attachments`, json({ fileName: "notes.pdf", fileSize: 10 })),
    );
    expect(await summaryOf(app)).toMatchObject({
      series: { id: series.id, title: "Weekly syncs" },
      ratingAverage: 4,
      ratingCount: 1,
      commentCount: 2,
      attachmentCount: 0,
    });

    expect((await app.request(started.url, file(bytesOf(10)))).status).toBe(204);
    expect((await app.request(`/api/attachments/${started.attachmentId}/commit`, { method: "POST" })).status).toBe(200);
    expect((await app.request(`/api/comments/${second.comment.id}`, { method: "DELETE" })).status).toBe(204);
    expect(await summaryOf(app)).toMatchObject({ commentCount: 1, attachmentCount: 1 });
    expect((await app.request(`/api/attachments/${started.attachmentId}`, { method: "DELETE" })).status).toBe(204);
    expect(await summaryOf(app)).toMatchObject({ commentCount: 1, attachmentCount: 0 });
  });

  it("have no series, no average, and no counts for a new video out of any series", async () => {
    const app = await createTestApp();
    await uploadVideo(app, "Week 1", MIB);
    expect(await summaryOf(app)).toMatchObject({ series: null, ratingAverage: 0, ratingCount: 0, commentCount: 0, attachmentCount: 0 });
  });
});

describe("deleting videos", () => {
  const remove = (app: TestApp, videoId: string) => app.request(`/api/videos/${videoId}`, { method: "DELETE" });
  const rowsOf = async (app: TestApp, videoId: string) => {
    const counts: Record<string, unknown> = {};
    for (const table of ["watch_history", "playlist_videos", "comments", "ratings", "attachments", "video_search"]) {
      counts[table] = (await app.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE video_id = ?`).bind(videoId).first())?.["n"];
    }
    return counts;
  };

  it("deletes a video with its files and every row that points at it", async () => {
    const app = await createTestApp();
    const { series } = await createSeries(app, "Weekly syncs");
    const { video } = await uploadVideo(app, "Week 1", MIB, series.id);
    await uploadVideo(app, "Week 2", MIB, series.id);
    const thumbnail = `thumbnails/${video.id}.jpg`;
    app.store.put(thumbnail, 10, "image/jpeg");
    const attachment = await body<StartAttachmentResponse>(
      await app.request(`/api/videos/${video.id}/attachments`, json({ fileName: "notes.pdf", fileSize: 10 })),
    );
    const attachmentKey = `attachments/${video.id}/${attachment.attachmentId}`;
    expect((await app.request(attachment.url, file(bytesOf(10)))).status).toBe(204);
    expect((await app.request(`/api/attachments/${attachment.attachmentId}/commit`, { method: "POST" })).status).toBe(200);
    await app.request(`/api/videos/${video.id}/comments`, json({ body: "Thanks" }));
    await app.request(`/api/videos/${video.id}/rating`, json({ stars: 4 }, "PUT"));
    await app.request(`/api/videos/${video.id}/watched`, { method: "POST" });
    const { playlist } = await createPlaylist(app, "Keep");
    await app.request(`/api/playlists/${playlist.id}/videos`, json({ videoId: video.id }));
    expect(await rowsOf(app, video.id)).toEqual({
      watch_history: 1, playlist_videos: 1, comments: 1, ratings: 1, attachments: 1, video_search: 1,
    });

    expect((await remove(app, video.id)).status).toBe(204);

    expect((await app.request(`/api/videos/${video.id}`)).status).toBe(404);
    const videoKey = `videos/${video.id}/original.mp4`;
    expect([...app.store.deletedKeys].sort()).toEqual([attachmentKey, thumbnail, videoKey].sort());
    expect([thumbnail, attachmentKey, videoKey].filter((key) => app.store.objects.has(key))).toEqual([]);
    expect(await rowsOf(app, video.id)).toEqual({
      watch_history: 0, playlist_videos: 0, comments: 0, ratings: 0, attachments: 0, video_search: 0,
    });
    expect(await episodeTitles(app, series.id)).toEqual(["1. Week 2"]);
    expect((await body<PlaylistResponse>(await app.request(`/api/playlists/${playlist.id}`))).playlist.videos).toEqual([]);
    expect((await remove(app, video.id)).status).toBe(404);
  });

  it("keeps the video when the bucket refuses to delete a file, so deleting it again finishes", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app, "Week 1", MIB);
    app.store.failDeletionOf = `videos/${video.id}/original.mp4`;
    const refused = await remove(app, video.id);
    expect(refused.status).toBe(502);
    expect((await body<ApiErrorBody>(refused)).error.code).toBe("storage_error");
    expect((await app.request(`/api/videos/${video.id}`)).status).toBe(200);

    app.store.failDeletionOf = null;
    expect((await remove(app, video.id)).status).toBe(204);
  });

  it("leaves an upload in progress to the cancel of the upload", async () => {
    const app = await createTestApp();
    const upload = await startUpload(app, "Week 1", MIB);
    expect((await remove(app, upload.videoId)).status).toBe(404);
    expect((await app.request(`/api/uploads/${upload.videoId}/abort`, { method: "POST" })).status).toBe(204);
  });
});

describe("playlists", () => {
  const add = (app: TestApp, playlistId: string, videoId: string) => app.request(`/api/playlists/${playlistId}/videos`, json({ videoId }));
  const titlesOf = async (app: TestApp, playlistId: string) =>
    (await body<PlaylistResponse>(await app.request(`/api/playlists/${playlistId}`))).playlist.videos.map(
      (video) => `${video.position}. ${video.title}`,
    );
  const choicesOf = async (app: TestApp, videoId: string) =>
    (await body<PlaylistChoicesResponse>(await app.request(`/api/videos/${videoId}/playlists`))).playlists.map(
      (choice) => `${choice.title}: ${choice.hasVideo ? "in" : "out"}`,
    );

  it("holds videos in the order that they join, and a video in many playlists", async () => {
    const app = await createTestApp();
    const { video: first } = await uploadVideo(app, "Keynote", MIB);
    const { video: second } = await uploadVideo(app, "Panel", MIB);
    const { playlist: talks } = await createPlaylist(app, "Talks");
    const { playlist: again } = await createPlaylist(app, "Watch again");
    expect(talks).toMatchObject({ title: "Talks", description: "", canEdit: true, videos: [], owner: { displayName: "Me" } });

    expect((await add(app, talks.id, second.id)).status).toBe(200);
    expect((await add(app, talks.id, first.id)).status).toBe(200);
    expect((await add(app, again.id, first.id)).status).toBe(200);
    expect(await titlesOf(app, talks.id)).toEqual(["1. Panel", "2. Keynote"]);
    expect(await titlesOf(app, again.id)).toEqual(["1. Keynote"]);
    expect((await add(app, talks.id, first.id)).status).toBe(409);

    // The playlist changed last comes first.
    expect(await choicesOf(app, first.id)).toEqual(["Watch again: in", "Talks: in"]);
    expect(await choicesOf(app, second.id)).toEqual(["Watch again: out", "Talks: in"]);
  });

  it("renames a playlist, and takes a video out of it", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app, "Keynote", MIB);
    const { playlist } = await createPlaylist(app, "Talks");
    const renamed = await app.request(`/api/playlists/${playlist.id}`, json({ title: "Best talks" }, "PATCH"));
    expect((await body<PlaylistResponse>(renamed)).playlist.title).toBe("Best talks");
    await add(app, playlist.id, video.id);
    const remove = () => app.request(`/api/playlists/${playlist.id}/videos/${video.id}`, { method: "DELETE" });
    expect((await remove()).status).toBe(200);
    expect((await remove()).status).toBe(404);
  });

  it("moves a video one place earlier or later", async () => {
    const app = await createTestApp();
    const { playlist } = await createPlaylist(app, "Course");
    const ids: string[] = [];
    for (const title of ["Intro", "Setup", "Wrap-up"]) {
      const { video } = await uploadVideo(app, title, MIB);
      await add(app, playlist.id, video.id);
      ids.push(video.id);
    }
    const move = (videoId: string | undefined, direction: string) =>
      app.request(`/api/playlists/${playlist.id}/videos/${videoId}/move`, json({ direction }));
    expect((await move(ids[2], "earlier")).status).toBe(200);
    expect(await titlesOf(app, playlist.id)).toEqual(["1. Intro", "2. Wrap-up", "3. Setup"]);
    expect((await move(ids[0], "earlier")).status).toBe(409);
    expect((await move(ids[1], "later")).status).toBe(409);
    expect((await move(ids[0], "sideways")).status).toBe(400);
  });

  it("lists every playlist, or those of the person, from the one changed last", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app, "Keynote", MIB);
    const { playlist: first } = await createPlaylist(app, "First");
    await createPlaylist(app, "Second");
    await add(app, first.id, video.id);
    const titles = async (query: string) =>
      (await body<ListPlaylistsResponse>(await app.request(`/api/playlists${query}`))).playlists.map((playlist) => playlist.title);
    expect(await titles("")).toEqual(["First", "Second"]);
    expect(await titles(`?owner=${OWNER_ID}`)).toEqual(["First", "Second"]);
    expect((await app.request("/api/playlists?owner=nobody")).status).toBe(400);
  });

  it("deletes a playlist, and keeps its videos", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app, "Keynote", MIB);
    const { playlist } = await createPlaylist(app, "Talks");
    await add(app, playlist.id, video.id);
    expect((await app.request(`/api/playlists/${playlist.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await app.request(`/api/playlists/${playlist.id}`)).status).toBe(404);
    expect((await app.request(`/api/videos/${video.id}`)).status).toBe(200);
  });

  it("takes only ready videos, and needs a title", async () => {
    const app = await createTestApp();
    const { playlist } = await createPlaylist(app, "Talks");
    const upload = await startUpload(app, "Still uploading", MIB);
    expect((await add(app, playlist.id, upload.videoId)).status).toBe(400);
    expect((await add(app, playlist.id, "nonexistent00000")).status).toBe(400);
    expect((await app.request("/api/playlists", json({ title: "  ", description: "" }))).status).toBe(400);
    expect((await app.request("/api/playlists/nonexistent00000")).status).toBe(404);
  });
});

describe("random videos", () => {
  it("picks every ready video of a small library once, and no upload in progress", async () => {
    const app = await createTestApp();
    for (const title of ["A", "B", "C"]) await uploadVideo(app, title, MIB);
    await startUpload(app, "Still uploading", MIB);
    const { videos } = await body<RandomVideosResponse>(await app.request("/api/videos/random"));
    expect(videos.map((video) => video.title).sort()).toEqual(["A", "B", "C"]);
  });

  it("picks a page of different videos from a larger library", async () => {
    const app = await createTestApp();
    for (let number = 1; number <= 50; number += 1) await uploadVideo(app, `Video ${number}`, MIB);
    const { videos } = await body<RandomVideosResponse>(await app.request("/api/videos/random"));
    expect(videos).toHaveLength(48);
    expect(new Set(videos.map((video) => video.id)).size).toBe(48);
  });
});

describe("history", () => {
  it("lists the videos that the person watched, from the last watched, once each", async () => {
    const app = await createTestApp();
    const first = await uploadVideo(app, "Week 1", MIB);
    const second = await uploadVideo(app, "Week 2", MIB);
    for (const id of [first.video.id, second.video.id, first.video.id]) {
      expect((await app.request(`/api/videos/${id}/watched`, { method: "POST" })).status).toBe(204);
    }
    const { videos } = await body<HistoryResponse>(await app.request("/api/history"));
    expect(videos.map((video) => video.title)).toEqual(["Week 1", "Week 2"]);
  });
});

describe("recommendations", () => {
  const titles = async (app: TestApp) =>
    (await body<RecommendationsResponse>(await app.request("/api/recommendations"))).videos.map((video) => video.title);
  const watch = (app: TestApp, id: string) => app.request(`/api/videos/${id}/watched`, { method: "POST" });

  it("starts from the newest videos for a person who watched nothing", async () => {
    const app = await createTestApp();
    await uploadVideo(app, "Old", MIB);
    await uploadVideo(app, "New", MIB);
    expect(await titles(app)).toEqual(["New", "Old"]);
  });

  it("puts the next episode first and the watched videos last", async () => {
    const app = await createTestApp();
    const { series } = await createSeries(app, "Weekly syncs");
    const first = await uploadVideo(app, "Week 1", MIB, series.id);
    await uploadVideo(app, "Week 2", MIB, series.id);
    await uploadVideo(app, "Week 3", MIB, series.id);
    await uploadVideo(app, "Unrelated", MIB);
    await watch(app, first.video.id);
    // The uploader of every video is the person, so the series decides the order.
    expect(await titles(app)).toEqual(["Week 2", "Week 3", "Unrelated", "Week 1"]);
  });
});

describe("ratings", () => {
  const rate = (app: TestApp, videoId: string, stars: number) => app.request(`/api/videos/${videoId}/rating`, json({ stars }, "PUT"));

  it("gives a video stars, replaces them, and takes them back", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app, "Weekly sync", MIB);
    expect(video.rating).toEqual({ average: null, count: 0, mine: null });
    await rate(app, video.id, 1);
    expect((await body<RatingResponse>(await rate(app, video.id, 4))).rating).toEqual({ average: 4, count: 1, mine: 4 });
    expect((await body<VideoResponse>(await app.request(`/api/videos/${video.id}`))).video.rating).toEqual({ average: 4, count: 1, mine: 4 });
    const cleared = await app.request(`/api/videos/${video.id}/rating`, { method: "DELETE" });
    expect((await body<RatingResponse>(cleared)).rating).toEqual({ average: null, count: 0, mine: null });
  });

  it("accepts whole stars from 1 to 5 on ready videos", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app, "Weekly sync", MIB);
    for (const stars of [0, 6, 2.5]) expect((await rate(app, video.id, stars)).status).toBe(400);
    const upload = await startUpload(app, "Still uploading", 40 * MIB);
    expect((await rate(app, upload.videoId, 3)).status).toBe(404);
  });
});

describe("comments", () => {
  const post = (app: TestApp, videoId: string, text: string) => app.request(`/api/videos/${videoId}/comments`, json({ body: text }));
  const list = async (app: TestApp, videoId: string, cursor?: string) =>
    body<ListCommentsResponse>(await app.request(`/api/videos/${videoId}/comments${cursor === undefined ? "" : `?cursor=${cursor}`}`));

  it("lists comments from the newest with their author, who can delete them", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app, "Weekly sync", MIB);
    expect((await post(app, video.id, "  First!  ")).status).toBe(201);
    await post(app, video.id, "Second\nline");
    const { comments } = await list(app, video.id);
    expect(comments.map((comment) => [comment.body, comment.author.displayName, comment.canDelete])).toEqual([
      ["Second\nline", "Me", true],
      ["First!", "Me", true],
    ]);
  });

  it("rejects empty and too long comments", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app, "Weekly sync", MIB);
    expect((await post(app, video.id, "   ")).status).toBe(400);
    expect((await post(app, video.id, "x".repeat(COMMENT_MAX_LENGTH + 1))).status).toBe(400);
    expect((await post(app, "video99999999999", "Hello")).status).toBe(404);
  });

  it("deletes a comment", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app, "Weekly sync", MIB);
    const { comment } = await body<CommentResponse>(await post(app, video.id, "one"));
    expect((await app.request(`/api/comments/${comment.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await app.request(`/api/comments/${comment.id}`, { method: "DELETE" })).status).toBe(404);
    expect((await list(app, video.id)).comments).toEqual([]);
  });

  it("pages through many comments", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app, "Weekly sync", MIB);
    for (let index = 1; index <= LIST_PAGE_SIZE + 1; index += 1) await post(app, video.id, `Comment ${index}`);
    const first = await list(app, video.id);
    expect(first.comments).toHaveLength(LIST_PAGE_SIZE);
    expect(first.comments[0]?.body).toBe(`Comment ${LIST_PAGE_SIZE + 1}`);
    const second = await list(app, video.id, first.nextCursor ?? "");
    expect(second.comments.map((comment) => comment.body)).toEqual(["Comment 1"]);
    expect(second.nextCursor).toBeNull();
  });
});

describe("search", () => {
  const search = async (app: TestApp, q: string, cursor?: string) =>
    body<SearchResponse>(await app.request(`/api/search?q=${encodeURIComponent(q)}${cursor === undefined ? "" : `&cursor=${cursor}`}`));
  const titles = async (app: TestApp, q: string) => (await search(app, q)).videos.map((video) => video.title);
  const describeVideo = (app: TestApp, id: string, description: string) => app.request(`/api/videos/${id}`, json({ description }, "PATCH"));

  it("finds words inside titles and descriptions, ignoring case, title matches first", async () => {
    const app = await createTestApp();
    await uploadVideo(app, "Weekly sync", MIB);
    const { video } = await uploadVideo(app, "Retro", MIB);
    await describeVideo(app, video.id, "Notes from the weekly retrospective");
    await uploadVideo(app, "Holiday", MIB);
    expect(await titles(app, "WEEK")).toEqual(["Weekly sync", "Retro"]);
  });

  it("finds Japanese words of any length and needs every word", async () => {
    const app = await createTestApp();
    await uploadVideo(app, "週次会議の録画", MIB);
    await uploadVideo(app, "英語の学習", MIB);
    expect(await titles(app, "会議")).toEqual(["週次会議の録画"]);
    expect(await titles(app, "週次会議")).toEqual(["週次会議の録画"]);
    expect(await titles(app, "英語　学習")).toEqual(["英語の学習"]);
    expect(await titles(app, "英語 会議")).toEqual([]);
  });

  it("follows edits and leaves out uploads in progress", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app, "Draft title", MIB);
    await app.request(`/api/videos/${video.id}`, json({ title: "Final title" }, "PATCH"));
    await startUpload(app, "Final cut", 40 * MIB);
    expect(await titles(app, "draft")).toEqual([]);
    expect(await titles(app, "final")).toEqual(["Final title"]);
  });

  it("pages through many matches", async () => {
    const app = await createTestApp();
    for (let index = 1; index <= LIST_PAGE_SIZE + 1; index += 1) await uploadVideo(app, `Lecture ${index}`, MIB);
    const first = await search(app, "lecture");
    expect(first.videos).toHaveLength(LIST_PAGE_SIZE);
    const second = await search(app, "lecture", first.nextCursor ?? "");
    expect(second.videos).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const seen = new Set([...first.videos, ...second.videos].map((video) => video.id));
    expect(seen.size).toBe(LIST_PAGE_SIZE + 1);
  });

  // The plan of the query of a search, step by step, as SQLite describes it.
  const planOf = async (app: TestApp, terms: string[]) => {
    const plan: string[] = [];
    const explaining: Database = {
      ...app.db,
      prepare: (query) =>
        ({
          bind: (...values: unknown[]) => ({
            all: async () => {
              const { results } = await app.db.prepare(`EXPLAIN QUERY PLAN ${query}`).bind(...values).all<{ detail: string }>();
              plan.push(...results.map((row) => row.detail));
              return { results: [], meta: {} };
            },
          }),
        }) as unknown as Statement,
    };
    await new VideoRepository(explaining).search(terms, LIST_PAGE_SIZE + 1, 0);
    return plan;
  };

  it("reads each video at most once for words too short for the index", async () => {
    const app = await createTestApp();
    await uploadVideo(app, "英語の学習", MIB);
    expect((await planOf(app, ["英語"])).filter((step) => step.includes("video_search"))).toEqual([]);
  });

  it("starts from the index for longer words, and reads the videos that it finds by ID", async () => {
    const app = await createTestApp();
    await uploadVideo(app, "英語の学習", MIB);
    const plan = await planOf(app, ["英語の学習", "英語"]);
    expect(plan[0]).toContain("video_search");
    expect(plan.filter((step) => /^SCAN (TABLE videos|v)\b/.test(step))).toEqual([]);
  });

  it("needs a query of 1 to 100 characters", async () => {
    const app = await createTestApp();
    expect((await app.request("/api/search?q=%20")).status).toBe(400);
    expect((await app.request(`/api/search?q=${"x".repeat(101)}`)).status).toBe(400);
    expect((await app.request("/api/search?q=sync&cursor=abc")).status).toBe(400);
  });
});

describe("attachments", () => {
  const start = (app: TestApp, videoId: string, fileName: string, fileSize = 2048) =>
    app.request(`/api/videos/${videoId}/attachments`, json({ fileName, fileSize }));
  const commit = (app: TestApp, id: string) => app.request(`/api/attachments/${id}/commit`, { method: "POST" });
  const attachmentsOf = async (app: TestApp, videoId: string) =>
    (await body<VideoResponse>(await app.request(`/api/videos/${videoId}`))).video.attachments;

  it("takes the file, and lists it with its links after the commit", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app, "Lecture 1", MIB);
    const started = await start(app, video.id, "Slides.pdf", 4096);
    expect(started.status).toBe(201);
    const target = await body<StartAttachmentResponse>(started);
    const key = `attachments/${video.id}/${target.attachmentId}`;
    expect(target).toEqual({ attachmentId: "attachment000001", url: "/api/attachments/attachment000001/file", contentType: "application/pdf" });
    expect(await attachmentsOf(app, video.id)).toEqual([]);

    // Committing before the file is in the bucket fails, and the file must have the size that was announced.
    expect((await commit(app, target.attachmentId)).status).toBe(409);
    expect((await app.request(target.url, file(bytesOf(4095)))).status).toBe(400);
    expect((await app.request(target.url, file(bytesOf(4096)))).status).toBe(204);
    expect(app.store.objects.get(key)).toMatchObject({ size: 4096, contentType: "application/pdf" });
    const { attachment } = await body<AttachmentResponse>(await commit(app, target.attachmentId));
    expect(attachment).toMatchObject({
      fileName: "Slides.pdf",
      contentType: "application/pdf",
      fileSize: 4096,
      viewUrl: `/api/files/${key}`,
      downloadUrl: `/api/files/${key}?download`,
    });
    expect((await attachmentsOf(app, video.id)).map((item) => item.fileName)).toEqual(["Slides.pdf"]);
    expect((await commit(app, target.attachmentId)).status).toBe(409);
    expect((await app.request(target.url, file(bytesOf(4096)))).status).toBe(409);

    const download = await app.request(attachment.downloadUrl);
    expect(download.headers.get("content-disposition")).toBe(`attachment; filename="Slides.pdf"; filename*=UTF-8''Slides.pdf`);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytesOf(4096));
    expect((await app.request(attachment.viewUrl)).headers.get("content-disposition")).toBeNull();
  });

  it("names the type from the extension and keeps other names for downloads", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app, "Lecture 1", MIB);
    const types: Record<string, string> = {
      "notes.md": "text/markdown; charset=utf-8",
      "Deck.PPTX": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "page.html": "application/octet-stream",
      README: "application/octet-stream",
    };
    for (const [fileName, contentType] of Object.entries(types)) {
      expect((await body<StartAttachmentResponse>(await start(app, video.id, fileName))).contentType).toBe(contentType);
    }
    const name = '資料 "最終".pptx';
    const target = await body<StartAttachmentResponse>(await start(app, video.id, name, 10));
    await app.request(target.url, file(bytesOf(10)));
    const { attachment } = await body<AttachmentResponse>(await commit(app, target.attachmentId));
    expect((await app.request(attachment.downloadUrl)).headers.get("content-disposition")).toBe(
      `attachment; filename="__ ____.pptx"; filename*=UTF-8''${encodeURIComponent(name)}`,
    );
  });

  it("downloads with ?download only attachments that exist", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app, "Lecture 1", MIB);
    expect((await app.request(`${video.playbackUrl}?download`)).status).toBe(404);
    expect((await app.request(`/api/files/attachments/${video.id}/attachment000009?download`)).status).toBe(404);
  });

  it("removes a file from the video and from the bucket", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app, "Lecture 1", MIB);
    const target = await body<StartAttachmentResponse>(await start(app, video.id, "notes.pdf", 10));
    await app.request(target.url, file(bytesOf(10)));
    expect((await commit(app, target.attachmentId)).status).toBe(200);
    const remove = () => app.request(`/api/attachments/${target.attachmentId}`, { method: "DELETE" });
    expect((await remove()).status).toBe(204);
    expect(await attachmentsOf(app, video.id)).toEqual([]);
    expect(app.store.objects.has(`attachments/${video.id}/${target.attachmentId}`)).toBe(false);
    expect((await remove()).status).toBe(404);
  });

  it("rejects files that are too large and names that are empty or too long", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app, "Lecture 1", MIB);
    expect((await start(app, video.id, "big.pdf", ATTACHMENT_MAX_BYTES + 1)).status).toBe(400);
    expect((await start(app, video.id, "  ")).status).toBe(400);
    expect((await start(app, video.id, `${"x".repeat(ATTACHMENT_NAME_MAX_LENGTH)}.pdf`)).status).toBe(400);
    // The bucket reports the real size, which a commit checks again.
    const target = await body<StartAttachmentResponse>(await start(app, video.id, "small.pdf", 10));
    app.store.put(`attachments/${video.id}/${target.attachmentId}`, ATTACHMENT_MAX_BYTES + 1);
    expect((await commit(app, target.attachmentId)).status).toBe(400);
  });
});

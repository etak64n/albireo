import { afterEach, describe, expect, it, vi } from "vitest";
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_NAME_MAX_LENGTH, COMMENT_MAX_LENGTH, LIST_PAGE_SIZE } from "../shared/api.ts";
import type {
  ApiErrorBody,
  AttachmentResponse,
  CommentResponse,
  CreateUploadResponse,
  HistoryResponse,
  ImageUploadResponse,
  ListCommentsResponse,
  ListSeriesResponse,
  ListVideosResponse,
  MeResponse,
  PartUrlsResponse,
  RatingResponse,
  RecommendationsResponse,
  SearchResponse,
  StartAttachmentResponse,
  SeriesResponse,
  SessionsResponse,
  SignInResponse,
  ThumbnailUploadResponse,
  UserResponse,
  VideoResponse,
} from "../shared/api.ts";
import { S3ObjectStore } from "../worker/storage.ts";
import { ADMIN_EMAIL, TEAM_DOMAIN, VIEWER_EMAIL } from "./support/access.ts";
import { createTestApp, json, SIGNED_IN_IDENTITY, type TestApp } from "./support/app.ts";

const MIB = 1024 * 1024;

async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

const OTHER_EMAIL = "other@example.com";

interface UploadOptions {
  /** The person who uploads. The default is viewer@example.com. */
  email?: string;
  seriesId?: string | null;
}

async function startUpload(app: TestApp, title: string, fileSize: number, options: UploadOptions = {}): Promise<CreateUploadResponse> {
  const response = await app.requestAs(
    options.email ?? VIEWER_EMAIL,
    "/api/uploads",
    json({ title, fileName: "weekly-sync.MP4", fileSize, contentType: "video/mp4", seriesId: options.seriesId ?? null }),
  );
  expect(response.status).toBe(201);
  return body<CreateUploadResponse>(response);
}

function allParts(upload: CreateUploadResponse) {
  return Array.from({ length: upload.partCount }, (_, index) => ({ partNumber: index + 1, etag: `"etag-${index + 1}"` }));
}

async function uploadVideo(
  app: TestApp,
  title = "Weekly sync",
  fileSize = 40 * MIB,
  options: UploadOptions = {},
): Promise<VideoResponse> {
  const upload = await startUpload(app, title, fileSize, options);
  app.store.sizeOfCompletedObject = fileSize;
  const response = await app.requestAs(
    options.email ?? VIEWER_EMAIL,
    `/api/uploads/${upload.videoId}/complete`,
    json({ parts: allParts(upload), durationSec: 3600, width: 1920, height: 1080 }),
  );
  expect(response.status).toBe(200);
  return body<VideoResponse>(response);
}

async function createSeries(app: TestApp, title: string, email = VIEWER_EMAIL): Promise<SeriesResponse> {
  const response = await app.requestAs(email, "/api/series", json({ title, description: "" }));
  expect(response.status).toBe(201);
  return body<SeriesResponse>(response);
}

async function episodeTitles(app: TestApp, seriesId: string): Promise<string[]> {
  const { series } = await body<SeriesResponse>(await app.signedRequest(`/api/series/${seriesId}`));
  return series.episodes.map((episode) => `${episode.episode}. ${episode.title}`);
}

describe("access", () => {
  it("refuses API requests without a Cloudflare Access token", async () => {
    const app = await createTestApp();
    const response = await app.request("/api/videos");
    expect(response.status).toBe(401);
    expect((await body<ApiErrorBody>(response)).error.code).toBe("unauthorized");
  });

  it("refuses a token for another Access application", async () => {
    const app = await createTestApp();
    const token = await app.access.sign({ audience: "another-application" });
    const response = await app.request("/api/videos", { headers: { "cf-access-jwt-assertion": token } });
    expect(response.status).toBe(401);
  });

  it("answers localhost without a token in local development mode", async () => {
    const app = await createTestApp({ env: { AUTH_MODE: "local-development", LOCAL_USER_EMAIL: "dev@example.com" } });
    expect((await app.request("/api/videos")).status).toBe(200);
  });

  it("refuses other hosts in local development mode", async () => {
    const app = await createTestApp({ env: { AUTH_MODE: "local-development", LOCAL_USER_EMAIL: "dev@example.com" } });
    expect((await app.request("https://videos.example.com/api/videos")).status).toBe(403);
  });

  it("stops every request when a binding is missing", async () => {
    const app = await createTestApp({ env: { S3_BUCKET: "" } });
    const response = await app.signedRequest("/api/videos");
    expect(response.status).toBe(500);
    expect((await body<ApiErrorBody>(response)).error.code).toBe("misconfigured");
  });

  it("marks API responses as not cacheable", async () => {
    const app = await createTestApp();
    expect((await app.signedRequest("/api/videos")).headers.get("cache-control")).toBe("no-store");
  });
});

describe("uploads", () => {
  it("starts a multipart upload with parts sized for the file", async () => {
    const app = await createTestApp();
    const upload = await startUpload(app, "Weekly sync", 40 * MIB);
    expect(upload).toEqual({ videoId: "video00000000001", partSize: 16 * MIB, partCount: 3 });
    expect([...app.store.uploads.values()]).toEqual([
      { key: "videos/video00000000001/original.mp4", contentType: "video/mp4", state: "open", parts: [] },
    ]);
  });

  it("signs a URL for each requested part", async () => {
    const app = await createTestApp();
    const upload = await startUpload(app, "Weekly sync", 40 * MIB);
    const response = await app.signedRequest(`/api/uploads/${upload.videoId}/parts`, json({ partNumbers: [1, 3] }));
    expect(response.status).toBe(200);
    const { parts } = await body<PartUrlsResponse>(response);
    expect(parts.map((part) => part.partNumber)).toEqual([1, 3]);
    expect(parts[1]?.url).toContain("partNumber=3");
  });

  it("refuses part numbers outside the upload or repeated", async () => {
    const app = await createTestApp();
    const upload = await startUpload(app, "Weekly sync", 40 * MIB);
    for (const partNumbers of [[0], [4], [1, 1], []]) {
      const response = await app.signedRequest(`/api/uploads/${upload.videoId}/parts`, json({ partNumbers }));
      expect(response.status).toBe(400);
    }
  });

  it("keeps an upload out of the library until it completes", async () => {
    const app = await createTestApp();
    await startUpload(app, "Weekly sync", 40 * MIB);
    expect((await body<ListVideosResponse>(await app.signedRequest("/api/videos"))).videos).toEqual([]);
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
      playbackUrl: "https://storage.test/videos/video00000000001/original.mp4?op=get",
      thumbnailUrl: null,
    });
    const [stored] = app.store.uploads.values();
    expect(stored?.state).toBe("completed");
    expect(stored?.parts.map((part) => part.partNumber)).toEqual([1, 2, 3]);

    const list = await body<ListVideosResponse>(await app.signedRequest("/api/videos"));
    expect(list).toEqual({
      videos: [
        {
          id: "video00000000001",
          title: "Weekly sync",
          durationSec: 3600,
          thumbnailUrl: null,
          createdAt: video.createdAt,
          uploader: { id: "user000000000001", displayName: "viewer", avatarUrl: null },
        },
      ],
      nextCursor: null,
    });
  });

  it("refuses to complete an upload that misses a part", async () => {
    const app = await createTestApp();
    const upload = await startUpload(app, "Weekly sync", 40 * MIB);
    const response = await app.signedRequest(
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
    const response = await app.signedRequest(
      `/api/uploads/${upload.videoId}/complete`,
      json({ parts: allParts(upload), durationSec: null, width: null, height: null }),
    );
    expect(response.status).toBe(502);
    expect((await body<ApiErrorBody>(response)).error.code).toBe("storage_error");
  });

  it("cancels an upload and forgets it", async () => {
    const app = await createTestApp();
    const upload = await startUpload(app, "Weekly sync", 40 * MIB);
    expect((await app.signedRequest(`/api/uploads/${upload.videoId}/abort`, { method: "POST" })).status).toBe(204);
    expect(app.store.uploads.get("upload-1")?.state).toBe("aborted");
    const parts = await app.signedRequest(`/api/uploads/${upload.videoId}/parts`, json({ partNumbers: [1] }));
    expect(parts.status).toBe(404);
  });

  it("refuses a file that is not a video", async () => {
    const app = await createTestApp();
    const response = await app.signedRequest(
      "/api/uploads",
      json({ title: "Slides", fileName: "slides.pdf", fileSize: 1024, contentType: "application/pdf", seriesId: null }),
    );
    expect(response.status).toBe(400);
  });

  it("refuses fields that the API does not know", async () => {
    const app = await createTestApp();
    const response = await app.signedRequest(
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

    const first = await body<ListVideosResponse>(await app.signedRequest("/api/videos"));
    expect(first.videos).toHaveLength(48);
    expect(first.videos[0]?.title).toBe("Video 50");
    expect(first.nextCursor).not.toBeNull();

    const second = await body<ListVideosResponse>(
      await app.signedRequest(`/api/videos?cursor=${encodeURIComponent(first.nextCursor ?? "")}`),
    );
    expect(second.videos.map((video) => video.title)).toEqual(["Video 2", "Video 1"]);
    expect(second.nextCursor).toBeNull();
  });

  it("refuses a cursor that it did not issue", async () => {
    const app = await createTestApp();
    expect((await app.signedRequest("/api/videos?cursor=not-a-cursor")).status).toBe(400);
  });

  it("answers 404 for a video that does not exist", async () => {
    const app = await createTestApp();
    expect((await app.signedRequest("/api/videos/video99999999999")).status).toBe(404);
    expect((await app.signedRequest("/api/videos/NOT-AN-ID")).status).toBe(404);
  });

  it("changes the title and the description", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app);
    const response = await app.signedRequest(`/api/videos/${video.id}`, json({ title: "  Retro  ", description: "Notes" }, "PATCH"));
    expect(response.status).toBe(200);
    const { video: edited } = await body<VideoResponse>(response);
    expect(edited).toMatchObject({ title: "Retro", description: "Notes" });
    expect(edited.updatedAt > video.updatedAt).toBe(true);
  });

  it("refuses an empty title and an edit that changes nothing", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app);
    expect((await app.signedRequest(`/api/videos/${video.id}`, json({ title: "   " }, "PATCH"))).status).toBe(400);
    expect((await app.signedRequest(`/api/videos/${video.id}`, json({}, "PATCH"))).status).toBe(400);
  });
});

describe("thumbnails", () => {
  it("signs a thumbnail upload and shows the thumbnail after the commit", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app);
    const key = `thumbnails/${video.id}.jpg`;

    const signed = await body<ThumbnailUploadResponse>(
      await app.signedRequest(`/api/videos/${video.id}/thumbnail`, { method: "POST" }),
    );
    expect(signed).toEqual({ url: `https://storage.test/${key}?op=put&type=image%2Fjpeg`, contentType: "image/jpeg" });

    // Committing before the browser uploads the image fails.
    expect((await app.signedRequest(`/api/videos/${video.id}/thumbnail/commit`, { method: "POST" })).status).toBe(409);

    app.store.objects.set(key, { size: 2048 });
    const committed = await app.signedRequest(`/api/videos/${video.id}/thumbnail/commit`, { method: "POST" });
    expect(committed.status).toBe(200);
    expect((await body<VideoResponse>(committed)).video.thumbnailUrl).toBe(`https://storage.test/${key}?op=get`);
  });
});

describe("local R2 bucket of cf dev", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the S3-compatible API that cf dev serves on the origin of the request", async () => {
    const fetchMock = vi.fn(async (_request: Request) =>
      new Response("<InitiateMultipartUploadResult><UploadId>local-1</UploadId></InitiateMultipartUploadResult>"),
    );
    vi.stubGlobal("fetch", fetchMock);
    const app = await createTestApp({
      env: {
        AUTH_MODE: "local-development",
        LOCAL_USER_EMAIL: "dev@example.com",
        STORAGE_TYPE: "local-r2",
        S3_BUCKET: "albireo-local",
      },
      objectStoreFor: (config) => new S3ObjectStore(config.storage, config.signedUrlTtlSeconds),
    });
    const localApi = /^http:\/\/localhost\/cdn-cgi\/local\/r2\/s3\/albireo-local\/videos\//;

    const created = await app.request(
      "/api/uploads",
      json({ title: "Weekly sync", fileName: "weekly-sync.mp4", fileSize: 40 * MIB, contentType: "video/mp4", seriesId: null }),
    );
    expect(created.status).toBe(201);
    expect(fetchMock.mock.calls[0]?.[0].url).toMatch(localApi);

    const upload = await body<CreateUploadResponse>(created);
    const parts = await app.request(`/api/uploads/${upload.videoId}/parts`, json({ partNumbers: [1] }));
    expect(parts.status).toBe(200);
    expect((await body<PartUrlsResponse>(parts)).parts[0]?.url).toMatch(localApi);
  });

  it("works only in local development mode", async () => {
    const app = await createTestApp({ env: { STORAGE_TYPE: "local-r2" } });
    const response = await app.signedRequest("/api/videos");
    expect(response.status).toBe(500);
    expect((await body<ApiErrorBody>(response)).error.code).toBe("misconfigured");
  });
});

describe("sign-in", () => {
  it("tells how and when the person signed in, from the identity of the session at Access", async () => {
    const asked: { teamDomain: string; token: string }[] = [];
    const app = await createTestApp({
      fetchIdentity: async (teamDomain, token) => {
        asked.push({ teamDomain, token });
        return SIGNED_IN_IDENTITY;
      },
    });
    const token = await app.access.sign({ email: VIEWER_EMAIL });
    const response = await app.request("/api/me/sign-in", { headers: { "cf-access-jwt-assertion": token } });
    expect(response.status).toBe(200);
    expect(await body<SignInResponse>(response)).toEqual({
      signIn: {
        method: "passkeys",
        signedInAt: "2026-11-07T05:42:45.000Z",
        passkeys: [{ name: "1Password", addedAt: "2026-11-07T05:42:26.602Z", lastUsedAt: "2026-11-07T05:42:46.792Z" }],
      },
    });
    expect(asked).toEqual([{ teamDomain: TEAM_DOMAIN, token }]);
  });

  it("leaves out the passkeys when Access does not report them, and a passkey that was never used", async () => {
    const reported = await createTestApp({
      fetchIdentity: async () => ({ ...SIGNED_IN_IDENTITY, passkeys: [{ name: "Laptop", created_at: "2026-11-01T00:00:00Z", last_used_at: null }] }),
    });
    expect((await body<SignInResponse>(await reported.signedRequest("/api/me/sign-in"))).signIn?.passkeys).toEqual([
      { name: "Laptop", addedAt: "2026-11-01T00:00:00.000Z", lastUsedAt: null },
    ]);
    const silent = await createTestApp({ fetchIdentity: async () => ({ idp: SIGNED_IN_IDENTITY.idp, iat: SIGNED_IN_IDENTITY.iat }) });
    expect((await body<SignInResponse>(await silent.signedRequest("/api/me/sign-in"))).signIn?.passkeys).toBeNull();
  });

  it("answers 502 when Access does not tell the login method", async () => {
    const app = await createTestApp({ fetchIdentity: async () => ({ email: VIEWER_EMAIL, iat: 1_794_030_165 }) });
    const response = await app.signedRequest("/api/me/sign-in");
    expect(response.status).toBe(502);
    expect((await body<ApiErrorBody>(response)).error.code).toBe("access_error");
  });

  it("answers 502 when Access cannot be reached", async () => {
    const app = await createTestApp({
      fetchIdentity: async () => {
        throw new Error("Cloudflare Access answered 503 for the identity of the session.");
      },
    });
    const response = await app.signedRequest("/api/me/sign-in");
    expect(response.status).toBe(502);
    expect((await body<ApiErrorBody>(response)).error.message).toContain("Cloudflare Access answered 503");
  });

  it("has no sign-in in local development mode, where Access does not run", async () => {
    const app = await createTestApp({
      env: { AUTH_MODE: "local-development", LOCAL_USER_EMAIL: "dev@example.com" },
      fetchIdentity: async () => {
        throw new Error("Local development mode must not ask Access.");
      },
    });
    const response = await app.request("/api/me/sign-in");
    expect(response.status).toBe(200);
    expect(await body<SignInResponse>(response)).toEqual({ signIn: null });
  });
});

describe("sessions", () => {
  const MAC_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  const IPHONE_SAFARI =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
  // Two tokens of one person, issued a minute apart and lasting a day, as from two devices.
  const ISSUED = Math.floor(Date.now() / 1000) - 120;
  const DAY = 24 * 60 * 60;

  async function sessionsWith(app: TestApp, token: string): Promise<SessionsResponse> {
    return body<SessionsResponse>(await app.request("/api/me/sessions", { headers: { "cf-access-jwt-assertion": token } }));
  }

  it("writes down each Access token as a session, with its device and its times, and marks the current one", async () => {
    const app = await createTestApp();
    const mac = await app.access.sign({ issuedAt: ISSUED, expiresAt: ISSUED + DAY });
    const phone = await app.access.sign({ issuedAt: ISSUED + 60, expiresAt: ISSUED + 60 + DAY });
    await app.request("/api/me", { headers: { "cf-access-jwt-assertion": mac, "user-agent": MAC_CHROME } });
    await app.request("/api/me", { headers: { "cf-access-jwt-assertion": phone, "user-agent": IPHONE_SAFARI } });

    const { sessions } = await sessionsWith(app, mac);
    expect(sessions?.map((session) => [session.browser, session.os, session.current])).toEqual([
      ["Safari", "iOS", false],
      ["Chrome", "macOS", true],
    ]);
    expect(sessions?.[1]).toMatchObject({
      city: "",
      country: "",
      signedInAt: new Date(ISSUED * 1000).toISOString(),
      expiresAt: new Date((ISSUED + DAY) * 1000).toISOString(),
    });
  });

  it("forgets the session of the request when the person logs out of it", async () => {
    const app = await createTestApp();
    const mac = await app.access.sign({ issuedAt: ISSUED, expiresAt: ISSUED + DAY });
    const phone = await app.access.sign({ issuedAt: ISSUED + 60, expiresAt: ISSUED + 60 + DAY });
    await app.request("/api/me", { headers: { "cf-access-jwt-assertion": mac, "user-agent": MAC_CHROME } });
    const response = await app.request("/api/me/sessions/current", { method: "DELETE", headers: { "cf-access-jwt-assertion": mac } });
    expect(response.status).toBe(204);

    const { sessions } = await sessionsWith(app, phone);
    expect(sessions?.map((session) => session.current)).toEqual([true]);
  });

  it("has no sessions in local development mode, where Access does not run", async () => {
    const app = await createTestApp({ env: { AUTH_MODE: "local-development", LOCAL_USER_EMAIL: "dev@example.com" } });
    expect(await body<SessionsResponse>(await app.request("/api/me/sessions"))).toEqual({ sessions: null });
  });
});

describe("people", () => {
  it("adds a person the first time they use the API", async () => {
    const app = await createTestApp();
    const { me } = await body<MeResponse>(await app.signedRequest("/api/me"));
    expect(me).toEqual({
      id: "user000000000001",
      displayName: "viewer",
      avatarUrl: null,
      bio: "",
      email: VIEWER_EMAIL,
      isAdmin: false,
      joinedAt: "2026-11-04T00:00:01.000Z",
      logoutUrl: "/cdn-cgi/access/logout",
    });
    // The second request finds the same person.
    expect((await body<MeResponse>(await app.signedRequest("/api/me"))).me.id).toBe("user000000000001");
  });

  it("compares emails in lowercase", async () => {
    const app = await createTestApp();
    const { me } = await body<MeResponse>(await app.requestAs("Admin@Example.com", "/api/me"));
    expect(me).toMatchObject({ email: ADMIN_EMAIL, isAdmin: true });
  });

  it("refuses a token that names no person, such as a service token", async () => {
    const app = await createTestApp();
    const token = await app.access.sign({ email: null });
    expect((await app.request("/api/me", { headers: { "cf-access-jwt-assertion": token } })).status).toBe(401);
  });

  it("changes the display name", async () => {
    const app = await createTestApp();
    const response = await app.signedRequest("/api/me", json({ displayName: "  Shii  " }, "PATCH"));
    expect((await body<MeResponse>(response)).me.displayName).toBe("Shii");
    const { user } = await body<UserResponse>(await app.signedRequest("/api/users/user000000000001"));
    expect(user).toEqual({ id: "user000000000001", displayName: "Shii", avatarUrl: null, bio: "" });
  });

  it("changes the bio, which the page of the person shows", async () => {
    const app = await createTestApp();
    await app.signedRequest("/api/me", json({ bio: "Recordings of our meetings" }, "PATCH"));
    const { user } = await body<UserResponse>(await app.requestAs(OTHER_EMAIL, "/api/users/user000000000001"));
    expect(user.bio).toBe("Recordings of our meetings");
  });

  it("sets and removes the picture of a person", async () => {
    const app = await createTestApp();
    const key = "avatars/user000000000001.jpg";
    const signed = await body<ImageUploadResponse>(await app.signedRequest("/api/me/avatar", { method: "POST" }));
    expect(signed).toEqual({ url: `https://storage.test/${key}?op=put&type=image%2Fjpeg`, contentType: "image/jpeg" });

    // Committing before the browser uploads the picture fails.
    expect((await app.signedRequest("/api/me/avatar/commit", { method: "POST" })).status).toBe(409);

    app.store.objects.set(key, { size: 4096 });
    const committed = await body<MeResponse>(await app.signedRequest("/api/me/avatar/commit", { method: "POST" }));
    expect(committed.me.avatarUrl).toBe(`https://storage.test/${key}?op=get`);
    const removed = await body<MeResponse>(await app.signedRequest("/api/me/avatar", { method: "DELETE" }));
    expect(removed.me.avatarUrl).toBeNull();
  });

  it("signs in the configured email in local development mode", async () => {
    const app = await createTestApp({ env: { AUTH_MODE: "local-development", LOCAL_USER_EMAIL: "dev@example.com" } });
    const { me } = await body<MeResponse>(await app.request("/api/me"));
    expect(me).toMatchObject({ email: "dev@example.com", logoutUrl: null });
  });
});

describe("permissions", () => {
  it("records the uploader and lets the uploader edit", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app);
    expect(video).toMatchObject({ uploader: { id: "user000000000001", displayName: "viewer" }, canEdit: true });
  });

  it("lets only the uploader or an admin edit a video", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app);
    const { video: seen } = await body<VideoResponse>(await app.requestAs(OTHER_EMAIL, `/api/videos/${video.id}`));
    expect(seen.canEdit).toBe(false);
    const refused = await app.requestAs(OTHER_EMAIL, `/api/videos/${video.id}`, json({ title: "Mine" }, "PATCH"));
    expect(refused.status).toBe(403);
    const edited = await app.requestAs(ADMIN_EMAIL, `/api/videos/${video.id}`, json({ title: "Fixed" }, "PATCH"));
    expect(edited.status).toBe(200);
  });

  it("keeps an upload to the person who started it", async () => {
    const app = await createTestApp();
    const upload = await startUpload(app, "Weekly sync", 40 * MIB);
    const parts = await app.requestAs(OTHER_EMAIL, `/api/uploads/${upload.videoId}/parts`, json({ partNumbers: [1] }));
    expect(parts.status).toBe(403);
  });

  it("lists the videos of one uploader", async () => {
    const app = await createTestApp();
    await uploadVideo(app, "Mine");
    await uploadVideo(app, "Theirs", MIB, { email: OTHER_EMAIL });
    const list = await body<ListVideosResponse>(await app.signedRequest("/api/videos?uploader=user000000000002"));
    expect(list.videos.map((video) => video.title)).toEqual(["Theirs"]);
  });
});

describe("series", () => {
  it("numbers episodes in the order that they join", async () => {
    const app = await createTestApp();
    const { series } = await createSeries(app, "Weekly syncs");
    expect(series).toMatchObject({ id: "series0000000001", owner: { displayName: "viewer" }, canEdit: true, episodes: [] });
    const first = await uploadVideo(app, "Week 1", MIB, { seriesId: series.id });
    const second = await uploadVideo(app, "Week 2", MIB, { seriesId: series.id });
    expect(await episodeTitles(app, series.id)).toEqual(["1. Week 1", "2. Week 2"]);

    const { video } = await body<VideoResponse>(await app.signedRequest(`/api/videos/${second.video.id}`));
    expect(video.series).toEqual({
      id: series.id,
      title: "Weekly syncs",
      episode: 2,
      previous: { id: first.video.id, title: "Week 1" },
      next: null,
    });
  });

  it("lists the series of one owner", async () => {
    const app = await createTestApp();
    await createSeries(app, "Course");
    await createSeries(app, "Retros", OTHER_EMAIL);
    const { series } = await body<ListSeriesResponse>(await app.signedRequest("/api/series?owner=user000000000002"));
    expect(series.map((item) => item.title)).toEqual(["Retros"]);
  });

  it("lists every series with its owner", async () => {
    const app = await createTestApp();
    await createSeries(app, "Course");
    await createSeries(app, "Retros", OTHER_EMAIL);
    const { series } = await body<ListSeriesResponse>(await app.signedRequest("/api/series"));
    expect(series.map((item) => `${item.title} by ${item.owner.displayName}`)).toEqual(["Retros by other", "Course by viewer"]);
  });

  it("lets anyone add their own video but only the creator reorder", async () => {
    const app = await createTestApp();
    const { series } = await createSeries(app, "Weekly syncs");
    await uploadVideo(app, "Week 1", MIB, { seriesId: series.id });
    const theirs = await uploadVideo(app, "Week 2", MIB, { email: OTHER_EMAIL, seriesId: series.id });
    const move = (email: string, direction: string) =>
      app.requestAs(email, `/api/series/${series.id}/episodes/${theirs.video.id}/move`, json({ direction }));

    expect((await move(OTHER_EMAIL, "earlier")).status).toBe(403);
    expect((await move(VIEWER_EMAIL, "earlier")).status).toBe(200);
    expect(await episodeTitles(app, series.id)).toEqual(["1. Week 2", "2. Week 1"]);
    expect((await move(VIEWER_EMAIL, "earlier")).status).toBe(409);
  });

  it("takes an episode out for the creator or the uploader only", async () => {
    const app = await createTestApp();
    const { series } = await createSeries(app, "Weekly syncs");
    const mine = await uploadVideo(app, "Week 1", MIB, { seriesId: series.id });
    const theirs = await uploadVideo(app, "Week 2", MIB, { email: OTHER_EMAIL, seriesId: series.id });
    const remove = (email: string, videoId: string) =>
      app.requestAs(email, `/api/series/${series.id}/episodes/${videoId}`, { method: "DELETE" });

    expect((await remove("third@example.com", theirs.video.id)).status).toBe(403);
    expect((await remove(OTHER_EMAIL, theirs.video.id)).status).toBe(200);
    expect((await remove(VIEWER_EMAIL, mine.video.id)).status).toBe(200);
    expect(await episodeTitles(app, series.id)).toEqual([]);
  });

  it("moves a video to the end of another series", async () => {
    const app = await createTestApp();
    const { series: course } = await createSeries(app, "Course");
    const { series: retros } = await createSeries(app, "Retros");
    await uploadVideo(app, "Retro 1", MIB, { seriesId: retros.id });
    const { video } = await uploadVideo(app, "Lesson 1", MIB, { seriesId: course.id });
    const moved = await app.signedRequest(`/api/videos/${video.id}`, json({ seriesId: retros.id }, "PATCH"));
    expect((await body<VideoResponse>(moved)).video.series?.episode).toBe(2);
    expect(await episodeTitles(app, course.id)).toEqual([]);
    expect(await episodeTitles(app, retros.id)).toEqual(["1. Retro 1", "2. Lesson 1"]);
  });

  it("refuses a series that does not exist", async () => {
    const app = await createTestApp();
    const response = await app.signedRequest(
      "/api/uploads",
      json({ title: "Week 1", fileName: "week-1.mp4", fileSize: MIB, contentType: "video/mp4", seriesId: "series9999999999" }),
    );
    expect(response.status).toBe(400);
  });

  it("lets only the creator or an admin rename a series", async () => {
    const app = await createTestApp();
    const { series } = await createSeries(app, "Weekly syncs");
    const rename = (email: string) => app.requestAs(email, `/api/series/${series.id}`, json({ title: "Syncs" }, "PATCH"));
    expect((await rename(OTHER_EMAIL)).status).toBe(403);
    expect((await rename(ADMIN_EMAIL)).status).toBe(200);
  });
});

describe("history", () => {
  it("lists the videos that a person watched, from the last watched, once each", async () => {
    const app = await createTestApp();
    const first = await uploadVideo(app, "Week 1", MIB);
    const second = await uploadVideo(app, "Week 2", MIB);
    for (const id of [first.video.id, second.video.id, first.video.id]) {
      expect((await app.signedRequest(`/api/videos/${id}/watched`, { method: "POST" })).status).toBe(204);
    }
    const { videos } = await body<HistoryResponse>(await app.signedRequest("/api/history"));
    expect(videos.map((video) => video.title)).toEqual(["Week 1", "Week 2"]);
  });

  it("keeps the history of each person to themselves", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app);
    await app.signedRequest(`/api/videos/${video.id}/watched`, { method: "POST" });
    const theirs = await body<HistoryResponse>(await app.requestAs(OTHER_EMAIL, "/api/history"));
    expect(theirs.videos).toEqual([]);
  });
});

describe("recommendations", () => {
  const titles = async (app: TestApp) =>
    (await body<RecommendationsResponse>(await app.signedRequest("/api/recommendations"))).videos.map((video) => video.title);
  const watch = (app: TestApp, id: string) => app.signedRequest(`/api/videos/${id}/watched`, { method: "POST" });

  it("starts from the newest videos for a person who watched nothing", async () => {
    const app = await createTestApp();
    await uploadVideo(app, "Old", MIB);
    await uploadVideo(app, "New", MIB);
    expect(await titles(app)).toEqual(["New", "Old"]);
  });

  it("puts the next episode first and the watched videos last", async () => {
    const app = await createTestApp();
    const { series } = await createSeries(app, "Weekly syncs");
    const first = await uploadVideo(app, "Week 1", MIB, { seriesId: series.id });
    await uploadVideo(app, "Week 2", MIB, { seriesId: series.id });
    await uploadVideo(app, "Week 3", MIB, { seriesId: series.id });
    await uploadVideo(app, "Unrelated", MIB, { email: OTHER_EMAIL });
    await watch(app, first.video.id);
    expect(await titles(app)).toEqual(["Week 2", "Week 3", "Unrelated", "Week 1"]);
  });
});

describe("ratings", () => {
  const rate = (app: TestApp, email: string, videoId: string, stars: number) =>
    app.requestAs(email, `/api/videos/${videoId}/rating`, json({ stars }, "PUT"));
  const ratingOn = async (app: TestApp, email: string, videoId: string) =>
    (await body<VideoResponse>(await app.requestAs(email, `/api/videos/${videoId}`))).video.rating;

  it("averages everyone's stars and shows each person their own", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app, "Weekly sync", MIB);
    expect(await ratingOn(app, VIEWER_EMAIL, video.id)).toEqual({ average: null, count: 0, mine: null });
    await rate(app, VIEWER_EMAIL, video.id, 5);
    expect((await body<RatingResponse>(await rate(app, OTHER_EMAIL, video.id, 2))).rating).toEqual({ average: 3.5, count: 2, mine: 2 });
    expect(await ratingOn(app, VIEWER_EMAIL, video.id)).toEqual({ average: 3.5, count: 2, mine: 5 });
  });

  it("replaces a rating and takes it back", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app, "Weekly sync", MIB);
    await rate(app, VIEWER_EMAIL, video.id, 1);
    expect((await body<RatingResponse>(await rate(app, VIEWER_EMAIL, video.id, 4))).rating).toEqual({ average: 4, count: 1, mine: 4 });
    const cleared = await app.signedRequest(`/api/videos/${video.id}/rating`, { method: "DELETE" });
    expect((await body<RatingResponse>(cleared)).rating).toEqual({ average: null, count: 0, mine: null });
  });

  it("accepts whole stars from 1 to 5 on ready videos", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app, "Weekly sync", MIB);
    for (const stars of [0, 6, 2.5]) expect((await rate(app, VIEWER_EMAIL, video.id, stars)).status).toBe(400);
    const upload = await startUpload(app, "Still uploading", 40 * MIB);
    expect((await rate(app, VIEWER_EMAIL, upload.videoId, 3)).status).toBe(404);
  });
});

describe("comments", () => {
  const post = (app: TestApp, email: string, videoId: string, text: string) =>
    app.requestAs(email, `/api/videos/${videoId}/comments`, json({ body: text }));
  const list = async (app: TestApp, videoId: string, email = VIEWER_EMAIL, cursor?: string) =>
    body<ListCommentsResponse>(
      await app.requestAs(email, `/api/videos/${videoId}/comments${cursor === undefined ? "" : `?cursor=${cursor}`}`),
    );

  it("lists comments from the newest with their authors", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app, "Weekly sync", MIB);
    expect((await post(app, VIEWER_EMAIL, video.id, "  First!  ")).status).toBe(201);
    await post(app, OTHER_EMAIL, video.id, "Second\nline");
    const { comments } = await list(app, video.id);
    expect(comments.map((comment) => [comment.body, comment.author.displayName])).toEqual([
      ["Second\nline", "other"],
      ["First!", "viewer"],
    ]);
  });

  it("rejects empty and too long comments", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app, "Weekly sync", MIB);
    expect((await post(app, VIEWER_EMAIL, video.id, "   ")).status).toBe(400);
    expect((await post(app, VIEWER_EMAIL, video.id, "x".repeat(COMMENT_MAX_LENGTH + 1))).status).toBe(400);
    expect((await post(app, VIEWER_EMAIL, "video99999999999", "Hello")).status).toBe(404);
  });

  it("lets the author, the uploader of the video, and admins delete a comment", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app, "Weekly sync", MIB);
    const ids: string[] = [];
    for (const text of ["one", "two", "three"]) {
      ids.push((await body<CommentResponse>(await post(app, OTHER_EMAIL, video.id, text))).comment.id);
    }
    const remove = (email: string, id: string | undefined) => app.requestAs(email, `/api/comments/${id}`, { method: "DELETE" });
    expect((await remove("third@example.com", ids[0])).status).toBe(403);
    expect((await remove(OTHER_EMAIL, ids[0])).status).toBe(204);
    expect((await remove(VIEWER_EMAIL, ids[1])).status).toBe(204);
    expect((await remove(ADMIN_EMAIL, ids[2])).status).toBe(204);
    expect((await remove(ADMIN_EMAIL, ids[2])).status).toBe(404);
    expect((await list(app, video.id)).comments).toEqual([]);
  });

  it("tells each person which comments they can delete", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app, "Weekly sync", MIB);
    await post(app, OTHER_EMAIL, video.id, "Nice");
    expect((await list(app, video.id, "third@example.com")).comments[0]?.canDelete).toBe(false);
    expect((await list(app, video.id, OTHER_EMAIL)).comments[0]?.canDelete).toBe(true);
    expect((await list(app, video.id, VIEWER_EMAIL)).comments[0]?.canDelete).toBe(true);
  });

  it("pages through many comments", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app, "Weekly sync", MIB);
    for (let index = 1; index <= LIST_PAGE_SIZE + 1; index += 1) await post(app, VIEWER_EMAIL, video.id, `Comment ${index}`);
    const first = await list(app, video.id);
    expect(first.comments).toHaveLength(LIST_PAGE_SIZE);
    expect(first.comments[0]?.body).toBe(`Comment ${LIST_PAGE_SIZE + 1}`);
    const second = await list(app, video.id, VIEWER_EMAIL, first.nextCursor ?? "");
    expect(second.comments.map((comment) => comment.body)).toEqual(["Comment 1"]);
    expect(second.nextCursor).toBeNull();
  });
});

describe("search", () => {
  const search = async (app: TestApp, q: string, cursor?: string) =>
    body<SearchResponse>(
      await app.signedRequest(`/api/search?q=${encodeURIComponent(q)}${cursor === undefined ? "" : `&cursor=${cursor}`}`),
    );
  const titles = async (app: TestApp, q: string) => (await search(app, q)).videos.map((video) => video.title);
  const describeVideo = (app: TestApp, id: string, description: string) =>
    app.signedRequest(`/api/videos/${id}`, json({ description }, "PATCH"));

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
    expect(await titles(app, "英語\u3000学習")).toEqual(["英語の学習"]);
    expect(await titles(app, "英語 会議")).toEqual([]);
  });

  it("follows edits and leaves out uploads in progress", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app, "Draft title", MIB);
    await app.signedRequest(`/api/videos/${video.id}`, json({ title: "Final title" }, "PATCH"));
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

  it("needs a query of 1 to 100 characters", async () => {
    const app = await createTestApp();
    expect((await app.signedRequest("/api/search?q=%20")).status).toBe(400);
    expect((await app.signedRequest(`/api/search?q=${"x".repeat(101)}`)).status).toBe(400);
    expect((await app.signedRequest("/api/search?q=sync&cursor=abc")).status).toBe(400);
  });
});

describe("attachments", () => {
  const start = (app: TestApp, email: string, videoId: string, fileName: string, fileSize = 2048) =>
    app.requestAs(email, `/api/videos/${videoId}/attachments`, json({ fileName, fileSize }));
  const commit = (app: TestApp, email: string, id: string) =>
    app.requestAs(email, `/api/attachments/${id}/commit`, { method: "POST" });
  const attachmentsOf = async (app: TestApp, videoId: string) =>
    (await body<VideoResponse>(await app.signedRequest(`/api/videos/${videoId}`))).video.attachments;

  it("signs an upload and lists the file with its links after the commit", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app, "Lecture 1", MIB);
    const started = await start(app, VIEWER_EMAIL, video.id, "Slides.pdf");
    expect(started.status).toBe(201);
    const signed = await body<StartAttachmentResponse>(started);
    const key = `attachments/${video.id}/${signed.attachmentId}`;
    expect(signed).toEqual({
      attachmentId: "attachment000001",
      url: `https://storage.test/${key}?op=put&type=application%2Fpdf`,
      contentType: "application/pdf",
    });
    expect(await attachmentsOf(app, video.id)).toEqual([]);

    // Committing before the browser uploads the file fails.
    expect((await commit(app, VIEWER_EMAIL, signed.attachmentId)).status).toBe(409);
    app.store.objects.set(key, { size: 4096 });
    const { attachment } = await body<AttachmentResponse>(await commit(app, VIEWER_EMAIL, signed.attachmentId));
    expect(attachment).toMatchObject({ fileName: "Slides.pdf", contentType: "application/pdf", fileSize: 4096 });
    expect(attachment.viewUrl).toBe(`https://storage.test/${key}?op=get`);
    expect(new URL(attachment.downloadUrl).searchParams.get("disposition")).toBe(
      `attachment; filename="Slides.pdf"; filename*=UTF-8''Slides.pdf`,
    );
    expect((await attachmentsOf(app, video.id)).map((item) => item.fileName)).toEqual(["Slides.pdf"]);
    expect((await commit(app, VIEWER_EMAIL, signed.attachmentId)).status).toBe(409);
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
      expect((await body<StartAttachmentResponse>(await start(app, VIEWER_EMAIL, video.id, fileName))).contentType).toBe(contentType);
    }
    const name = '資料 "最終".pptx';
    const signed = await body<StartAttachmentResponse>(await start(app, VIEWER_EMAIL, video.id, name));
    app.store.objects.set(`attachments/${video.id}/${signed.attachmentId}`, { size: 10 });
    const { attachment } = await body<AttachmentResponse>(await commit(app, VIEWER_EMAIL, signed.attachmentId));
    expect(new URL(attachment.downloadUrl).searchParams.get("disposition")).toBe(
      `attachment; filename="__ ____.pptx"; filename*=UTF-8''${encodeURIComponent(name)}`,
    );
  });

  it("lets only the uploader of the video and admins attach and remove files", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app, "Lecture 1", MIB);
    expect((await start(app, OTHER_EMAIL, video.id, "notes.pdf")).status).toBe(403);
    const signed = await body<StartAttachmentResponse>(await start(app, ADMIN_EMAIL, video.id, "notes.pdf"));
    app.store.objects.set(`attachments/${video.id}/${signed.attachmentId}`, { size: 10 });
    expect((await commit(app, OTHER_EMAIL, signed.attachmentId)).status).toBe(403);
    expect((await commit(app, ADMIN_EMAIL, signed.attachmentId)).status).toBe(200);
    const remove = (email: string) => app.requestAs(email, `/api/attachments/${signed.attachmentId}`, { method: "DELETE" });
    expect((await remove(OTHER_EMAIL)).status).toBe(403);
    expect((await remove(VIEWER_EMAIL)).status).toBe(204);
    expect(await attachmentsOf(app, video.id)).toEqual([]);
    expect((await remove(VIEWER_EMAIL)).status).toBe(404);
  });

  it("rejects files that are too large and names that are empty or too long", async () => {
    const app = await createTestApp();
    const { video } = await uploadVideo(app, "Lecture 1", MIB);
    expect((await start(app, VIEWER_EMAIL, video.id, "big.pdf", ATTACHMENT_MAX_BYTES + 1)).status).toBe(400);
    expect((await start(app, VIEWER_EMAIL, video.id, "  ")).status).toBe(400);
    expect((await start(app, VIEWER_EMAIL, video.id, `${"x".repeat(ATTACHMENT_NAME_MAX_LENGTH)}.pdf`)).status).toBe(400);
    // The storage service reports the real size, which can be larger than the browser said.
    const signed = await body<StartAttachmentResponse>(await start(app, VIEWER_EMAIL, video.id, "small.pdf", 10));
    app.store.objects.set(`attachments/${video.id}/${signed.attachmentId}`, { size: ATTACHMENT_MAX_BYTES + 1 });
    expect((await commit(app, VIEWER_EMAIL, signed.attachmentId)).status).toBe(400);
  });
});

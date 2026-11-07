import { describe, expect, it } from "vitest";
import { deviceOf, placeOf, SessionRepository, sessionIdOf, type SeenSession } from "../worker/sessions.ts";
import { createTestDatabase } from "./support/d1.ts";

const T0 = new Date("2026-11-07T05:00:00.000Z");
const minutes = (count: number) => new Date(T0.getTime() + count * 60_000);

async function repositoryWithUser(): Promise<SessionRepository> {
  const db = createTestDatabase();
  await db
    .prepare("INSERT INTO users (id, email, display_name, bio, avatar_key, created_at, updated_at) VALUES (?, ?, ?, '', NULL, ?, ?)")
    .bind("user-1", "viewer@example.com", "viewer", T0.toISOString(), T0.toISOString())
    .run();
  return new SessionRepository(db);
}

function seen(id: string, expiresAt: Date): SeenSession {
  return {
    id,
    userId: "user-1",
    browser: "Chrome",
    os: "macOS",
    city: "Tokyo",
    country: "JP",
    signedInAt: T0.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

describe("SessionRepository", () => {
  it("moves the last request of a session forward at most every five minutes", async () => {
    const sessions = await repositoryWithUser();
    await sessions.record(seen("s-1", minutes(60)), T0);
    await sessions.record(seen("s-1", minutes(60)), minutes(4));
    expect((await sessions.listActive("user-1", T0.toISOString()))[0]?.lastSeenAt).toBe(T0.toISOString());
    await sessions.record(seen("s-1", minutes(60)), minutes(6));
    expect((await sessions.listActive("user-1", T0.toISOString()))[0]?.lastSeenAt).toBe(minutes(6).toISOString());
  });

  it("lists the sessions that have not expired, from the last used, and forgets the expired ones", async () => {
    const sessions = await repositoryWithUser();
    await sessions.record(seen("old", minutes(10)), T0);
    await sessions.record(seen("new", minutes(60)), minutes(1));
    await sessions.record(seen("ended", minutes(2)), minutes(1));
    expect((await sessions.listActive("user-1", minutes(5).toISOString())).map((session) => session.id)).toEqual(["new", "old"]);
    await sessions.removeExpired("user-1", minutes(30).toISOString());
    expect((await sessions.listActive("user-1", T0.toISOString())).map((session) => session.id)).toEqual(["new"]);
  });

  it("forgets one session of the person", async () => {
    const sessions = await repositoryWithUser();
    await sessions.record(seen("s-1", minutes(60)), T0);
    await sessions.record(seen("s-2", minutes(60)), T0);
    await sessions.remove("user-1", "s-1");
    expect((await sessions.listActive("user-1", T0.toISOString())).map((session) => session.id)).toEqual(["s-2"]);
  });
});

describe("sessionIdOf", () => {
  it("is the SHA-256 of the token in hexadecimal", async () => {
    expect(await sessionIdOf("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("deviceOf", () => {
  it.each([
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      { browser: "Chrome", os: "macOS" },
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
      { browser: "Safari", os: "iOS" },
    ],
    [
      "Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1",
      { browser: "Chrome", os: "iPadOS" },
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
      { browser: "Edge", os: "Windows" },
    ],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0", { browser: "Firefox", os: "Linux" }],
    [
      "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
      { browser: "Chrome", os: "Android" },
    ],
    ["curl/8.7.1", { browser: "", os: "" }],
    [undefined, { browser: "", os: "" }],
  ])("reads %s", (userAgent, device) => {
    expect(deviceOf(userAgent)).toEqual(device);
  });
});

describe("placeOf", () => {
  it("reads the city and the country that Cloudflare adds, and leaves out what is missing", () => {
    expect(placeOf({ city: "Tokyo", country: "JP", colo: "NRT" })).toEqual({ city: "Tokyo", country: "JP" });
    expect(placeOf({ country: "JP" })).toEqual({ city: "", country: "JP" });
    expect(placeOf(undefined)).toEqual({ city: "", country: "" });
  });
});

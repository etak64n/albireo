import { describe, expect, it } from "vitest";
import { AccessDeniedError, isLocalhost, verifyAccessToken } from "../worker/access.ts";
import { AUD, createAccessKeys, TEAM_DOMAIN } from "./support/access.ts";

const access = { teamDomain: TEAM_DOMAIN, aud: AUD };

describe("verifyAccessToken", () => {
  it("accepts a token that the team signed for the application", async () => {
    const keys = await createAccessKeys();
    await expect(verifyAccessToken(await keys.sign(), access, keys.keySet)).resolves.toEqual({
      email: "viewer@example.com",
    });
  });

  it("refuses a request without a token", async () => {
    const keys = await createAccessKeys();
    await expect(verifyAccessToken(undefined, access, keys.keySet)).rejects.toThrow(AccessDeniedError);
  });

  it("refuses a token for another application", async () => {
    const keys = await createAccessKeys();
    const token = await keys.sign({ audience: "another-application" });
    await expect(verifyAccessToken(token, access, keys.keySet)).rejects.toThrow(AccessDeniedError);
  });

  it("refuses a token from another team", async () => {
    const keys = await createAccessKeys();
    const token = await keys.sign({ issuer: "https://another-team.cloudflareaccess.com" });
    await expect(verifyAccessToken(token, access, keys.keySet)).rejects.toThrow(AccessDeniedError);
  });

  it("refuses an expired token", async () => {
    const keys = await createAccessKeys();
    const token = await keys.sign({ expiresAt: Math.floor(Date.now() / 1000) - 60 });
    await expect(verifyAccessToken(token, access, keys.keySet)).rejects.toThrow(AccessDeniedError);
  });

  it("refuses a token signed with another key", async () => {
    const team = await createAccessKeys();
    const impostor = await createAccessKeys();
    await expect(verifyAccessToken(await impostor.sign(), access, team.keySet)).rejects.toThrow(AccessDeniedError);
  });
});

describe("isLocalhost", () => {
  it("accepts the addresses of this machine", () => {
    for (const url of ["http://localhost:5173/api/videos", "http://127.0.0.1:5173/", "http://[::1]:5173/"]) {
      expect(isLocalhost(new URL(url))).toBe(true);
    }
  });

  it("refuses other hosts", () => {
    expect(isLocalhost(new URL("https://videos.example.com/api/videos"))).toBe(false);
    expect(isLocalhost(new URL("https://localhost.example.com/"))).toBe(false);
  });
});

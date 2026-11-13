import { describe, expect, it } from "vitest";
import { fileHeaders, pageHeaders } from "../server/security-headers.ts";
import { createTestApp, PAGE_HTML } from "./support/app.ts";

/** The sources of one directive of a policy, such as ["'self'", "blob:"] for media-src. */
function directive(policy: string | null | undefined, name: string): string[] | undefined {
  for (const part of (policy ?? "").split(";")) {
    const [key, ...sources] = part.trim().split(/\s+/);
    if (key === name) return sources;
  }
  return undefined;
}

describe("pages", () => {
  it("returns a page of the browser app with a policy that allows only the origin of albireo", async () => {
    const app = await createTestApp();
    const response = await app.request("/videos/video00000000001");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toBe(PAGE_HTML);
    const policy = response.headers.get("content-security-policy");
    expect(directive(policy, "connect-src")).toEqual(["'self'"]);
    expect(directive(policy, "media-src")).toEqual(["'self'", "blob:"]);
    expect(directive(policy, "img-src")).toEqual(["'self'", "data:", "blob:"]);
    expect(directive(policy, "script-src")).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    expect(directive(policy, "frame-ancestors")).toEqual(["'none'"]);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("puts the headers on a 304, which updates the headers of the page that the browser keeps", async () => {
    const app = await createTestApp();
    const response = await app.request("/", { headers: { "if-none-match": '"page"' } });
    expect(response.status).toBe(304);
    expect(response.headers.get("content-security-policy")).toBe(pageHeaders()["Content-Security-Policy"]);
  });

  it("leaves the files of the build as they are, such as the script of a Web Worker", async () => {
    const app = await createTestApp();
    const response = await app.request("/assets/app.js");
    expect(response.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(response.headers.get("content-security-policy")).toBeNull();
  });

  it("answers only GET and HEAD for pages", async () => {
    const app = await createTestApp();
    const response = await app.request("/", { method: "POST" });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  });
});

describe("fileHeaders", () => {
  it("runs nothing in a file that is opened on its own, and lets the browser show a picture or a video", () => {
    const policy = fileHeaders()["Content-Security-Policy"];
    expect(directive(policy, "default-src")).toEqual(["'none'"]);
    expect(directive(policy, "sandbox")).toEqual([]);
    expect(directive(policy, "img-src")).toEqual(["'self'"]);
    expect(directive(policy, "media-src")).toEqual(["'self'"]);
    expect(fileHeaders()["X-Content-Type-Options"]).toBe("nosniff");
  });
});

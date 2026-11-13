import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { staticFiles } from "../server/static-files.ts";

let dir = "";
let serve: (request: Request) => Promise<Response>;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "albireo-dist-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>albireo</title>");
  writeFileSync(join(dir, "favicon.svg"), "<svg/>");
  writeFileSync(join(dir, "assets", "index-abc123.js"), "console.log(1);");
  serve = staticFiles(dir);
});

afterAll(() => rmSync(dir, { recursive: true }));

const get = (path: string, headers: Record<string, string> = {}) => serve(new Request(`http://albireo.test${path}`, { headers }));

describe("staticFiles", () => {
  it("answers index.html for every path of the app", async () => {
    for (const path of ["/", "/videos/video00000000001", "/settings/account"]) {
      const response = await get(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(response.headers.get("cache-control")).toBe("no-cache");
      expect(await response.text()).toBe("<!doctype html><title>albireo</title>");
    }
  });

  it("keeps the files under /assets/ for a year, since their names change with them", async () => {
    const response = await get("/assets/index-abc123.js");
    expect(response.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await response.text()).toBe("console.log(1);");
    expect((await get("/favicon.svg")).headers.get("content-type")).toBe("image/svg+xml");
  });

  it("answers 404 for a file of /assets/ that the build does not have", async () => {
    expect((await get("/assets/index-old.js")).status).toBe(404);
  });

  it("answers 304 while the browser holds the same file", async () => {
    const etag = (await get("/")).headers.get("etag") ?? "";
    expect((await get("/", { "if-none-match": etag })).status).toBe(304);
    expect((await get("/", { "if-none-match": `W/${etag}` })).status).toBe(304);
    expect((await get("/", { "if-none-match": '"other"' })).status).toBe(200);
  });

  it("needs index.html", () => {
    const empty = mkdtempSync(join(tmpdir(), "albireo-dist-"));
    try {
      expect(() => staticFiles(empty)).toThrow(/has no index\.html/);
    } finally {
      rmSync(empty, { recursive: true });
    }
  });
});

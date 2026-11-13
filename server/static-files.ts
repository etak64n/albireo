// The files of the browser app, which `vite build` writes to dist/. index.html is the page of
// every path of the app, such as /videos/<ID>. The names of the files under /assets/ change
// with their content, so a browser keeps them for a year; it asks again for the other files,
// such as index.html, every time, and gets 304 while they are the same.

import { createReadStream, readdirSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { Readable } from "node:stream";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

interface StaticFile {
  path: string;
  contentType: string;
  size: number;
  etag: string;
  immutable: boolean;
}

/** Answers a request for a page of the app or a file of dist/. dist/ must hold index.html. */
export function staticFiles(dir: string): (request: Request) => Promise<Response> {
  const files = new Map<string, StaticFile>();
  for (const path of listFiles(dir)) {
    const urlPath = `/${relative(dir, path).split(sep).join("/")}`;
    const stats = statSync(path);
    files.set(urlPath, {
      path,
      contentType: CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream",
      size: stats.size,
      etag: `"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`,
      immutable: urlPath.startsWith("/assets/"),
    });
  }
  const index = files.get("/index.html");
  if (index === undefined) throw new Error(`${dir} has no index.html. Build the browser app with \`pnpm exec vite build\` first.`);

  return async (request) => {
    let path: string;
    try {
      path = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      path = "";
    }
    // A missing file of the build is an error, not a page of the app.
    const file = files.get(path) ?? (path.startsWith("/assets/") ? undefined : index);
    if (file === undefined) return new Response("No file has this path.\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    const headers: Record<string, string> = {
      "Content-Type": file.contentType,
      "Cache-Control": file.immutable ? "public, max-age=31536000, immutable" : "no-cache",
      ETag: file.etag,
    };
    const known = request.headers.get("if-none-match");
    if (known !== null && known.split(",").some((tag) => tag.trim().replace(/^W\//, "") === file.etag)) {
      return new Response(null, { status: 304, headers });
    }
    headers["Content-Length"] = String(file.size);
    const body = request.method === "HEAD" ? null : (Readable.toWeb(createReadStream(file.path)) as ReadableStream<Uint8Array>);
    return new Response(body, { status: 200, headers });
  };
}

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(path);
    return entry.isFile() ? [path] : [];
  });
}

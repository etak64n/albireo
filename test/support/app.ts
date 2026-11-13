// Builds the API with a database in memory, a bucket in memory, a clock, IDs that tests can
// predict, and pages in place of the build of the browser app.

import { fileURLToPath } from "node:url";
import { createApp, type IdKind } from "../../server/app.ts";
import { openMemoryDatabase, type Database } from "../../server/database.ts";
import { UserRepository } from "../../server/users.ts";
import { MemoryObjectStore } from "./object-store.ts";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations/", import.meta.url));

export interface TestApp {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  db: Database;
  store: MemoryObjectStore;
  /** The ID of the person of albireo, user000000000001. */
  ownerId: string;
}

export async function createTestApp(): Promise<TestApp> {
  const store = new MemoryObjectStore();
  const db = openMemoryDatabase(MIGRATIONS_DIR);
  let tick = 0;
  const counters = new Map<IdKind, number>();
  // Each call is one second later, so creation order is unambiguous.
  const now = () => {
    tick += 1;
    return new Date(Date.UTC(2026, 10, 4, 0, 0, tick));
  };
  // IDs read as their kind and a counter, such as video00000000001 and user000000000001.
  const newId = (kind: IdKind) => {
    const next = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, next);
    return `${kind}${String(next).padStart(16 - kind.length, "0")}`;
  };
  // The server adds the person of albireo before it serves anything.
  const owner = await new UserRepository(db).ensureOwner(() => newId("user"), now().toISOString());
  const app = createApp({ db, store, ownerId: owner.id, now, newId, pages: async (request) => pageFromBuild(request) });
  return { request: async (path, init) => app.request(path, init), db, store, ownerId: owner.id };
}

/** The page of the browser app, which the build answers for every path of the app. */
export const PAGE_HTML = '<!doctype html><html lang="en"><body><div id="root"></div></body></html>';

function pageFromBuild(request: Request): Response {
  const path = new URL(request.url).pathname;
  if (path.startsWith("/assets/")) {
    return new Response("console.log(1);", { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=31536000, immutable" } });
  }
  // A request that repeats the ETag of the page gets 304, as the build answers it.
  if (request.headers.get("if-none-match") === '"page"') return new Response(null, { status: 304, headers: { "content-type": "text/html; charset=utf-8", etag: '"page"' } });
  return new Response(PAGE_HTML, { headers: { "content-type": "text/html; charset=utf-8", etag: '"page"' } });
}

export function json(body: unknown, method = "POST"): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

/** A PUT of the bytes with their length, as a browser sends a file. */
export function file(bytes: Uint8Array, contentType = "application/octet-stream"): RequestInit {
  return { method: "PUT", headers: { "content-type": contentType, "content-length": String(bytes.length) }, body: bytes };
}

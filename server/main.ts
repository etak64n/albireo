// Starts albireo in its container: reads the settings from the environment, opens the
// database in the data volume, checks the bucket, and serves the browser app and the API
// on port 8080. A wrong setting stops albireo before it serves anything, with an
// instruction in the log that starts with "Please".

import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { readConfig } from "./config.ts";
import { openDatabase, type OpenDatabase } from "./database.ts";
import { randomId } from "./ids.ts";
import { errorFields, log } from "./log.ts";
import { staticFiles } from "./static-files.ts";
import { checkStorage, mayPassLater, storageProblemMessage, type StorageProblem } from "./storage-check.ts";
import { S3ObjectStore } from "./storage.ts";
import { UserRepository } from "./users.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
/** The volume of the container, which holds the database. */
const DATA_DIR = "/data";
const DATABASE_FILE = join(DATA_DIR, "albireo.sqlite");
const PORT = 8080;
// While the bucket does not answer, as when it starts with albireo, the check runs again
// after these waits, in seconds, and albireo stops after the last one.
const STORAGE_CHECK_WAITS = [2, 4, 8, 16];
// Docker stops a container 10 seconds after it asks it to stop. albireo ends the requests
// that are still running, such as a video that plays, a little before that.
const STOP_WAIT_MS = 8_000;

function stop(message: string, fields: Record<string, unknown> = {}): never {
  log("ERROR", message, null, fields);
  process.exit(1);
}

async function main(): Promise<void> {
  const version = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string }).version;
  const configured = readConfig(process.env);
  if ("problems" in configured) {
    for (const problem of configured.problems) log("ERROR", problem, null);
    process.exit(1);
  }
  const { storage } = configured.config;

  let database: OpenDatabase;
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    database = openDatabase(DATABASE_FILE, join(ROOT, "migrations"));
  } catch (error) {
    stop(`Please mount a volume at ${DATA_DIR} that the user ${process.getuid?.() ?? "of albireo"} can write, such as -v albireo-data:${DATA_DIR}. albireo keeps its database there.`, errorFields(error));
  }

  const store = new S3ObjectStore(storage);
  let problem: StorageProblem | null = null;
  for (let attempt = 0; ; attempt += 1) {
    problem = await checkStorage(store, randomId());
    const wait = STORAGE_CHECK_WAITS[attempt];
    if (problem === null || !mayPassLater(problem) || wait === undefined) break;
    log("WARN", `The bucket did not answer. albireo checks it again in ${wait} seconds.`, null, { reason: problemReason(problem) });
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
  }
  if (problem !== null) stop(storageProblemMessage(problem, storage.bucket));

  const owner = await new UserRepository(database.db).ensureOwner(randomId, new Date().toISOString());
  const app = createApp({
    db: database.db,
    store,
    ownerId: owner.id,
    now: () => new Date(),
    newId: () => randomId(),
    pages: staticFiles(join(ROOT, "dist")),
  });

  const server = serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0", overrideGlobalObjects: false }, () => {
    log("INFO", `albireo ${version} is ready on port ${PORT}`, null, { version, bucket: storage.bucket, endpoint: storage.endpoint });
  });
  // A part of a large video can take minutes to arrive on a slow connection.
  if ("requestTimeout" in server) server.requestTimeout = 60 * 60 * 1000;

  let stopping = false;
  const shutDown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    log("INFO", "albireo is stopping", null, { signal });
    server.close(() => {
      database.close();
      process.exit(0);
    });
    if ("closeIdleConnections" in server) server.closeIdleConnections();
    setTimeout(() => {
      if ("closeAllConnections" in server) server.closeAllConnections();
    }, STOP_WAIT_MS).unref();
  };
  process.on("SIGTERM", () => shutDown("SIGTERM"));
  process.on("SIGINT", () => shutDown("SIGINT"));
}

function problemReason(problem: StorageProblem): string {
  return problem.kind === "missing-permissions" ? problem.missing.map((item) => item.reason).join(" ") : problem.reason;
}

process.on("uncaughtException", (error) => stop("albireo stopped after an error that nothing handled", errorFields(error)));
process.on("unhandledRejection", (error) => stop("albireo stopped after an error that nothing handled", errorFields(error)));

await main();

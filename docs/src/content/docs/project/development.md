---
title: "Local development"
description: "What changes when albireo runs on your machine with cf dev."
---

This page explains what changes when albireo runs on your machine with `cf dev`.

## Architecture with cf dev

Under `cf dev` with the `"local-r2"` development storage, three things differ from production.

1. Access does not run. The Worker answers requests to localhost without an Access token.
2. D1 and the bucket are local. `cf dev` keeps both in `.cloudflare/state`.
3. The S3-compatible API of the local bucket has the same origin as the app, so the browser needs no CORS settings.

The next sections explain each difference.

## Sign-in on localhost

`cf dev` runs albireo in the "development" mode (cloudflare.config.ts, `AUTH_MODE`).

In this mode, the Worker answers requests to localhost without an Access token, because Access does not run on your machine.
It signs every request in as the person in `development.signInAs` (cloudflare.config.ts, `LOCAL_USER_EMAIL`).

The Worker refuses requests to any other host, so that this mode cannot open a library to others (worker/app.ts).

```ts
// worker/access.ts: the hosts that count as localhost
return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
```

## Development storage

`development.storage` takes one of two kinds (config/settings.ts).

1. `"local-r2"`: a bucket on your machine
2. `"s3"`: a real bucket that you use for development

With `"local-r2"`, `cf dev` keeps an R2 bucket named albireo-local on your machine.

- `cf dev` serves this bucket with an S3-compatible API at `/cdn-cgi/local/r2/s3` on the dev server (worker/runtime-config.ts, `LOCAL_R2_S3_PATH`).
- The Worker signs URLs for that API with fixed local keys, so development takes the same presigned-URL path as production (cloudflare.config.ts, `LOCAL_R2`).
- The API has the same origin as the app, so it needs no CORS settings and no `.env` file.

> Note: the local S3-compatible API is an experimental feature of Cloudflare's local development tools, so it may change.

With `"s3"`, you write a storage like `production.storage`, for a bucket that holds no production videos.

- Its endpoint may also be an `http://` origin on localhost, 127.0.0.1, or [::1], such as a storage server on your machine (config/settings.ts).
- Copy `.env.example` to `.env` and fill in the keys of that bucket.
- Add the address of the dev server to the CORS settings of that bucket.

## Local data

`cf dev` keeps the local D1 database and the local bucket in `.cloudflare/state`, which Git ignores.
`pnpm db:migrate:local` passes `--persist-to .cloudflare/state`, so the tables go where `cf dev` reads them (package.json).

```bash
# Start over with empty local data. Stop cf dev first.
# Delete the local D1 database and the local bucket.
# -rf : delete the folder and everything in it, without asking
rm -rf .cloudflare/state
# Create the tables again
pnpm db:migrate:local
```

## Checks

Run these commands to check the code.

```bash
# Type-check three TypeScript projects: the browser app, the Worker, and the configuration with the tests
pnpm typecheck

# Run the Vitest tests. They use node:sqlite in place of D1, and fakes in place of the bucket and Access.
pnpm test
```

The tests apply the real migrations to node:sqlite, the search index included, because the SQLite in Node.js has FTS5 (test/support/d1.ts).

CI runs on pushes to main, on pull requests, and on each release (.github/workflows/ci.yml).
It copies the example settings, then runs the type checks, the tests, and `cf build` on Node.js 24.

## Scripts

package.json defines these scripts.

- `pnpm stack:deploy`: creates or updates the D1 database, the Access application, and the Worker of the stack
- `pnpm stack:delete`: deletes the Worker, the Access application, and the D1 database of the stack
- `pnpm db:migrate:local`: applies migrations/ to the local D1 database that `cf dev` uses
- `pnpm typecheck`: type-checks the browser app, the Worker, and the configuration with the tests
- `pnpm test`: runs the Vitest tests once

## Project layout

- worker/: the Worker, with the API, the Access check, the storage client, and the D1 queries
- src/: the browser app
- shared/: API types and limits that the Worker and the browser app share
- config/: the settings types and their validation
- migrations/: the D1 schema
- themes/: the light and dark themes
- test/: the Vitest tests
- examples/: the bucket CORS example
- stack/: `pnpm stack:deploy` and `pnpm stack:delete`, which create and delete the Cloudflare resources of a deployment
- cloudflare.config.ts: the Worker configuration that `cf` reads, built from albireo.config.ts
- albireo.config.example.ts: the example settings

---
title: "Development"
description: "Run albireo from its source, check it, and find your way in the code."
---

This page runs albireo from its source on your machine, and describes the checks and the layout of the code.
You need Docker, Node.js 24 or later, and pnpm.

## Run from the source

Build the image from the source, and run it with a bucket of RustFS, as the [quick start](../../getting-started/quickstart/) does with the published image.

```bash
# Install the dependencies of albireo
pnpm install

# Build an image from the source, under the name albireo:dev
# -t albireo:dev : the name of the image
docker build -t albireo:dev .
```

In the compose.yaml of the quick start, replace `image: ghcr.io/etak64n/albireo:0.1` with `image: albireo:dev`, and start it with `docker compose up -d`.

To change the browser app, run the dev server of Vite next to that container.
It serves the app with hot reload on http://localhost:5173, and passes `/api` and `/healthz` on to albireo on port 8080 (vite.config.ts).

```bash
# Serve the browser app from src/, with the API of the container on port 8080
pnpm exec vite
```

A change to the server needs a new image: build it again, and run `docker compose up -d` to replace the container.

## Checks

Run these commands to check the code.

```bash
# Type-check three TypeScript projects: the browser app, the server, and the build settings with the tests
pnpm typecheck

# Run the Vitest tests. They use a database in memory and a bucket in memory.
pnpm test

# Run an image end to end: wrong settings, an upload in two parts, ranges, restarts, and deletions.
# Needs docker, curl, jq, and the AWS CLI.
./test/e2e.sh albireo:dev

# Use the browser app of an image in Google Chrome, and keep a screenshot of each step in test/browser/out/.
# Needs ffmpeg and Google Chrome, and `pnpm --dir test/browser install` before.
./test/browser/run.sh albireo:dev
```

The tests apply the real migrations to node:sqlite, the search index included, because the SQLite in Node.js has FTS5 (test/support/app.ts).

CI runs on pushes to main and on pull requests (.github/workflows/ci.yml).

1. It runs the type checks, the tests, and the build of the browser app on Node.js 24.
2. It builds the image on amd64 and on arm64, each on a runner of that architecture, and runs test/e2e.sh with it.
3. It runs test/browser/run.sh with the image of amd64, and keeps the screenshots with the run.

The Pages workflow checks the Content-Security-Policy of the pages on each push to main (.github/workflows/pages.yml).
It serves the demo with the policy of albireo on its pages and opens it in Chromium: the pages of the app, the video of the demo with the most kinds of attachments and the preview of each, a search, and the choice of a video and a picture (scripts/demo-csp.ts).
When the browser blocks anything in a page, the workflow fails and names what was blocked, and the demo does not go out.

## Scripts

package.json defines these scripts.

- `pnpm typecheck`: type-checks the browser app, the server, and the build settings with the tests
- `pnpm test`: runs the Vitest tests once

## Project layout

- server/: the server, with the API, the storage client, the database, and the queries
- src/: the browser app
- shared/: API types and limits that the server and the browser app share
- migrations/: the schema of the database
- themes/: the light and dark themes of the browser app
- test/: the Vitest tests, test/e2e.sh, and the browser test in test/browser/
- scripts/: the sample media of the demo, and the check of its policy
- docs/: this documentation site
- Dockerfile: the image, which builds the browser app and runs the server
- compose.yaml and .env.example: the example settings

---
title: "Development"
description: "Run albireo from its source, check it, and find your way in the code."
---

This page runs albireo from its source on your machine, and describes the checks and the layout of the code.
You need Docker, and the versions of Rust, Node.js, and pnpm that mise.toml names.

## Install the tools

mise.toml names the versions of Rust, Node.js, and pnpm that albireo builds with.
With [mise](https://mise.jdx.dev/), one command installs them.

```bash
# Install the versions of Rust, Node.js, and pnpm that mise.toml names
mise install
```

## Run from the source

The server needs PostgreSQL, a bucket, and the built browser app in dist/.
Start PostgreSQL and RustFS in containers first.

```bash
# Start PostgreSQL on port 5432 of this machine, with the database albireo
# -p 127.0.0.1:5432:5432 : publish the port on this machine alone
docker run -d --name albireo-dev-db -p 127.0.0.1:5432:5432 \
  -e POSTGRES_USER=albireo -e POSTGRES_PASSWORD=albireo -e POSTGRES_DB=albireo postgres:18

# Start RustFS on port 9000, and create the bucket albireo with its default key
docker run -d --name albireo-dev-bucket -p 127.0.0.1:9000:9000 rustfs/rustfs:1.0.4
AWS_ACCESS_KEY_ID=rustfsadmin AWS_SECRET_ACCESS_KEY=rustfsadmin \
  aws --endpoint-url http://127.0.0.1:9000 --region us-east-1 s3api create-bucket --bucket albireo
```

Then build the browser app, and run the server from the root of the repository, where it finds dist/.

```bash
# Install the dependencies of the browser app, and build it into dist/
pnpm install
pnpm exec vite build

# The settings of the server, for the containers above
export DATABASE_URL=postgres://albireo:albireo@127.0.0.1:5432/albireo
export S3_ENDPOINT=http://127.0.0.1:9000 S3_REGION=us-east-1 S3_BUCKET=albireo S3_URL_STYLE=path
export S3_ACCESS_KEY_ID=rustfsadmin S3_SECRET_ACCESS_KEY=rustfsadmin

# Build and run the server on port 8080
# --manifest-path server/Cargo.toml : the server is in server/, and dist/ in the root
# -- serve : the command of the server, as in the image
cargo run --manifest-path server/Cargo.toml -- serve
```

The log of the server holds the setup code of the first admin, and albireo answers on http://localhost:8080.

To change the browser app, run the dev server of Vite next to the server.
It serves the app with hot reload on http://localhost:5173, and passes `/api` and `/healthz` on to the server on port 8080 (vite.config.ts).

```bash
# Serve the browser app from src/, with the API of the server on port 8080
pnpm exec vite
```

## Checks

Run these commands to check the browser app.

```bash
# Type-check the browser app, and the build settings with the scripts and the tests
pnpm typecheck

# Run the Vitest tests of the logic of the browser app
pnpm test
```

Run these commands in server/ to check the server.
The tests of the API make a database of their own in the PostgreSQL of `DATABASE_URL` for each test, and drop it after, so the user of the URL needs permission to create databases.

```bash
# Check the format and the lints of the Rust code
cargo fmt --check
cargo clippy --all-targets -- --deny warnings

# Run the tests, with the PostgreSQL that "Run from the source" started
DATABASE_URL=postgres://albireo:albireo@127.0.0.1:5432/albireo cargo test
```

The tests of the API run the router of albireo against a bucket in memory, so they need no S3 server (server/tests/common/mod.rs).

Two scripts check an image of albireo.

```bash
# Build an image from the source, under the name albireo:dev
# -t albireo:dev : the name of the image
docker build -t albireo:dev .

# Run the image end to end: wrong settings, the first admin, two containers on one database,
# an upload in two parts, ranges, an invitation, restarts, and deletions.
# Needs docker, curl, jq, and the AWS CLI.
./test/e2e.sh albireo:dev

# Use the browser app of the image in Google Chrome, and keep a screenshot of each step in test/browser/out/.
# Needs ffmpeg, jq, and Google Chrome, and `pnpm --dir test/browser install` before.
./test/browser/run.sh albireo:dev
```

CI runs on pushes to main and on pull requests (.github/workflows/ci.yml).

1. It runs the type checks, the tests, and the build of the browser app on Node.js 24.
2. It checks the format and the lints of the server, and runs its tests against PostgreSQL 18.
3. It builds the image on amd64 and on arm64, each on a runner of that architecture, and runs test/e2e.sh with it.
4. It runs test/browser/run.sh with the image of amd64, and keeps the screenshots with the run.

The Pages workflow checks the Content-Security-Policy of the pages on each push to main (.github/workflows/pages.yml).
It serves the demo with the policy of albireo on its pages and opens it in Chromium: the pages of the app, the video of the demo with the most kinds of attachments and the preview of each, a search, and the choice of a video and a picture (scripts/demo-csp.ts).
When the browser blocks anything in a page, the workflow fails and names what was blocked, and the demo does not go out.

## Scripts

package.json defines these scripts.

- `pnpm typecheck`: type-checks the browser app, and the build settings with the scripts and the tests
- `pnpm test`: runs the Vitest tests once

## Project layout

- server/: the server in Rust
  - server/src/api/: the routes of the API, by area: accounts, videos, and the series and playlists
  - server/src/repo/: the queries of the database
  - server/src/storage.rs and server/src/storage_check.rs: the client of the bucket, and the check of the key when albireo starts
  - server/src/backup.rs: the copies of the database that the commands backup and restore write and load
  - server/tests/: the tests of the API
- src/: the browser app
- shared/: the API types, the limits, and the security headers that the server and the browser app share
- migrations/: the schema of the database
- themes/: the light and dark themes of the browser app
- test/: the Vitest tests, test/e2e.sh, and the browser test in test/browser/
- scripts/: the sample media of the demo, and the check of its policy
- docs/: this documentation site
- Dockerfile: the image, which builds the browser app and the server, and runs the server
- compose.yaml and .env.example: the example settings

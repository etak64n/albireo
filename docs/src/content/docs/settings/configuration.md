---
title: "Configuration"
description: "The environment variables of albireo, its database, its port, and its health check."
---

albireo reads seven environment variables: the database, the bucket, and the access key of the bucket.
Every variable is required, and albireo has no default values, so a container behaves exactly as its variables say (server/src/config.rs).

## Example

This is the albireo service of compose.yaml in the repository.
The secrets come from .env, which keeps them out of compose.yaml.

```yaml
# compose.yaml: the settings of albireo, with the secrets from .env
services:
  albireo:
    image: ghcr.io/etak64n/albireo:0.1
    restart: unless-stopped
    ports:
      - "127.0.0.1:8080:8080"
    environment:
      DATABASE_URL: postgres://albireo:${POSTGRES_PASSWORD:?Please write POSTGRES_PASSWORD in .env}@postgres:5432/albireo
      S3_ENDPOINT: https://s3.example.com
      S3_REGION: us-east-1
      S3_BUCKET: albireo-videos
      S3_URL_STYLE: path
      S3_ACCESS_KEY_ID: ${S3_ACCESS_KEY_ID:?Please write S3_ACCESS_KEY_ID in .env}
      S3_SECRET_ACCESS_KEY: ${S3_SECRET_ACCESS_KEY:?Please write S3_SECRET_ACCESS_KEY in .env}
```

## Environment variables

- `DATABASE_URL`
  - The connection string of the PostgreSQL database of albireo, such as `postgres://albireo:secret@postgres:5432/albireo`
  - A URL that starts with `postgres://` or `postgresql://`. A password with characters other than letters and digits must be percent-encoded, as in any URL.
  - Parameters of PostgreSQL go in its query, such as `?sslmode=require` for a database that takes connections over TLS alone.
- `S3_ENDPOINT`
  - The URL of the S3-compatible API of your storage service, such as `https://s3.example.com`
  - An `http://` or `https://` URL without a query or a fragment. A path, when the API has one, comes before the bucket in every URL.
- `S3_REGION`
  - The region that the storage service expects in request signatures, such as `us-east-1`
  - Services that have no regions usually take `us-east-1`.
- `S3_BUCKET`
  - The bucket that keeps the videos, the thumbnails, the pictures of the channels, and the attachments
  - 3 to 63 lowercase letters, digits, dots, and hyphens, starting and ending with a letter or a digit
- `S3_URL_STYLE`
  - `path` puts the bucket name in the path of each URL, as in `https://s3.example.com/albireo-videos/...`.
  - `virtual-hosted` puts it in the hostname, as in `https://albireo-videos.s3.example.com/...`.
  - The documentation of your storage service names the style that it takes. Servers that you run yourself usually take `path`.
- `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`
  - The access key that albireo signs its requests with, by Signature Version 4
  - The key needs permission to read, write, and delete the objects of the bucket, and to upload in parts.

When a variable is missing or malformed, albireo stops before it serves anything, and its log says what to set, starting with "Please".

## Database

albireo keeps the library in the PostgreSQL database of `DATABASE_URL`, and nothing in its container.
CI tests albireo with PostgreSQL 18.

- When albireo starts, it creates its tables and applies the migrations that the database does not have yet (server/src/db.rs). The user of `DATABASE_URL` therefore needs permission to create tables in the database.
- The search uses the extension pg_trgm, which comes with PostgreSQL. The first start creates it in the database, which needs a user that may create extensions, such as the owner of the database on most services.
- Several containers of albireo can share one database. Each one opens up to 10 connections to it.

## Port

albireo listens on port 8080 inside the container.
Publish it on the address that the proxy in front of albireo reaches, such as `127.0.0.1:8080:8080` when the proxy runs on the same machine.
People sign in with passwords, so they reach albireo through a proxy that serves HTTPS, as [Deploy](../../getting-started/deploy/) describes.

## Health check

albireo answers `GET /healthz` with `ok` while it runs and reaches its database.
The image runs `albireo healthcheck` every 30 seconds, which asks the albireo of its container, so `docker ps` shows the container as healthy or unhealthy.

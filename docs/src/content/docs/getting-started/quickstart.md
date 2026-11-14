---
title: "Quick start"
description: "Try albireo on your machine, with PostgreSQL and a bucket of RustFS in other containers."
---

This page starts albireo on your machine with Docker Compose, together with PostgreSQL and RustFS, an S3-compatible server, so you need no database or bucket of your own.
To keep your videos, use the bucket of a storage service instead, as [Deploy](../deploy/) describes.

## Start albireo, its database, and a bucket

Save this file as compose.yaml in an empty folder.
It runs four services: PostgreSQL, RustFS, a one-time job that creates the bucket, and albireo.

```yaml
# compose.yaml: albireo with PostgreSQL and a bucket of RustFS, to try albireo on this machine
services:
  postgres:
    image: postgres:18
    environment:
      POSTGRES_USER: albireo
      POSTGRES_PASSWORD: try-albireo
      POSTGRES_DB: albireo
    healthcheck:
      test: ["CMD-SHELL", "pg_isready --username albireo --dbname albireo"]
      interval: 2s
      retries: 30
  rustfs:
    image: rustfs/rustfs:1.0.4
  # Creates the bucket albireo once, with the default key of RustFS, then stops.
  bucket:
    image: amazon/aws-cli
    depends_on: [rustfs]
    environment:
      AWS_ACCESS_KEY_ID: rustfsadmin
      AWS_SECRET_ACCESS_KEY: rustfsadmin
      AWS_DEFAULT_REGION: us-east-1
    entrypoint: ["sh", "-c", "until aws --endpoint-url http://rustfs:9000 s3api head-bucket --bucket albireo 2>/dev/null || aws --endpoint-url http://rustfs:9000 s3api create-bucket --bucket albireo; do sleep 1; done"]
  albireo:
    image: ghcr.io/etak64n/albireo:0.1
    depends_on:
      postgres:
        condition: service_healthy
      bucket:
        condition: service_completed_successfully
    ports:
      - "127.0.0.1:8080:8080"
    environment:
      DATABASE_URL: postgres://albireo:try-albireo@postgres:5432/albireo
      S3_ENDPOINT: http://rustfs:9000
      S3_REGION: us-east-1
      S3_BUCKET: albireo
      S3_URL_STYLE: path
      S3_ACCESS_KEY_ID: rustfsadmin
      S3_SECRET_ACCESS_KEY: rustfsadmin
```

Then start the services, and read the setup code that albireo writes to its log.

```bash
# Start the four services in the background
# -d : return to the shell and leave the services running
docker compose up -d

# Show the line of the log that holds the setup code
# grep setupCode : keep only that line of the log of albireo
docker compose logs albireo | grep setupCode
```

The line says that albireo has nobody yet, and holds a code such as `"setupCode":"7KQ4-M2XW"`.

## Create the first admin

Open http://localhost:8080.
The page asks for the setup code and the account of the first admin: an email, a display name, and a password.
After Create admin, the page says that the library has no videos yet.
Drop a video file on the page, or choose it with Upload.

To try albireo as a second person, open People in the menu under your picture, create an invitation link, and open the link in a private window of your browser.

## What the file sets

- `ports` publishes albireo on 127.0.0.1 only, so other machines cannot reach it. A deployment puts a proxy with HTTPS in front of albireo, as [Deploy](../deploy/) describes.
- `DATABASE_URL` and `S3_ENDPOINT` reach PostgreSQL and RustFS by their service names inside the network of the project.
- The file names no volumes, so `docker compose down -v` removes the library and the files with the containers. This is fine for a try, and not for your videos.

## Stop and remove

```bash
# Stop the services, and remove their containers, the library, and the files
# -v : remove the volumes too, so the next start begins with nobody and no videos
docker compose down -v
```

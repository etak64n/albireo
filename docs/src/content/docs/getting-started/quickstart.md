---
title: "Quick start"
description: "Try albireo on your machine, with a bucket of RustFS in another container."
---

This page starts albireo on your machine with Docker Compose, together with RustFS, an S3-compatible server, so you need no bucket of your own.
To keep your videos, use the bucket of a storage service instead, as [Deploy](../deploy/) describes.

## Start albireo and a bucket

Save this file as compose.yaml in an empty folder.
It runs three services: RustFS, a one-time job that creates the bucket, and albireo.

```yaml
# compose.yaml: albireo with a bucket of RustFS, to try albireo on this machine
services:
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
      bucket:
        condition: service_completed_successfully
    ports:
      - "127.0.0.1:8080:8080"
    environment:
      S3_ENDPOINT: http://rustfs:9000
      S3_REGION: us-east-1
      S3_BUCKET: albireo
      S3_URL_STYLE: path
      S3_ACCESS_KEY_ID: rustfsadmin
      S3_SECRET_ACCESS_KEY: rustfsadmin
    volumes:
      - albireo-data:/data

volumes:
  albireo-data:
```

Then start the services, and open http://localhost:8080.

```bash
# Start the three services in the background
# -d : return to the shell and leave the services running
docker compose up -d
```

The first page says that the library has no videos yet.
Drop a video file on the page, or choose it with Upload.

## What the file sets

- `ports` publishes albireo on 127.0.0.1 only. albireo has no sign-in, so this keeps other machines out.
- `S3_ENDPOINT` reaches RustFS by its service name, rustfs, inside the network of the project.
- `albireo-data` is the volume that keeps the database of albireo, so the library survives a new container.
- RustFS keeps its files in its container, so they go away with it. This is fine for a try, and not for your videos.

## Stop and remove

```bash
# Stop the services, and remove their containers and the volume of the database
# -v : remove the volumes too, so the next start begins with an empty library
docker compose down -v
```

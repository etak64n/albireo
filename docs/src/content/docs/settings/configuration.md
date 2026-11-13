---
title: "Configuration"
description: "The environment variables of albireo, its volume, and its port."
---

albireo reads six environment variables, which name the bucket and its access key.
Every variable is required, and albireo has no default values, so a container behaves exactly as its variables say (server/config.ts).

## Example

This is the albireo service of compose.yaml in the repository.
The access key comes from .env, which keeps it out of compose.yaml.

```yaml
# compose.yaml: the settings of albireo, with the access key from .env
services:
  albireo:
    image: ghcr.io/etak64n/albireo:0.1
    restart: unless-stopped
    ports:
      - "127.0.0.1:8080:8080"
    environment:
      S3_ENDPOINT: https://s3.example.com
      S3_REGION: us-east-1
      S3_BUCKET: albireo-videos
      S3_URL_STYLE: path
      S3_ACCESS_KEY_ID: ${S3_ACCESS_KEY_ID:?Please write S3_ACCESS_KEY_ID in .env}
      S3_SECRET_ACCESS_KEY: ${S3_SECRET_ACCESS_KEY:?Please write S3_SECRET_ACCESS_KEY in .env}
    volumes:
      - albireo-data:/data

volumes:
  albireo-data:
```

## Environment variables

- `S3_ENDPOINT`
  - The URL of the S3-compatible API of your storage service, such as `https://s3.example.com`
  - An `http://` or `https://` URL without a query or a fragment. A path, when the API has one, comes before the bucket in every URL.
- `S3_REGION`
  - The region that the storage service expects in request signatures, such as `us-east-1`
  - Services that have no regions usually take `us-east-1`.
- `S3_BUCKET`
  - The bucket that keeps the videos, the thumbnails, the picture of your channel, and the attachments
  - 3 to 63 lowercase letters, digits, dots, and hyphens, starting and ending with a letter or a digit
- `S3_URL_STYLE`
  - `path` puts the bucket name in the path of each URL, as in `https://s3.example.com/albireo-videos/...`.
  - `virtual-hosted` puts it in the hostname, as in `https://albireo-videos.s3.example.com/...`.
  - The documentation of your storage service names the style that it takes. Servers that you run yourself usually take `path`.
- `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`
  - The access key that albireo signs its requests with, by Signature Version 4
  - The key needs permission to read, write, and delete the objects of the bucket, and to upload in parts.

When a variable is missing or malformed, albireo stops before it serves anything, and its log says what to set, starting with "Please".

## Volume

albireo keeps its database in `/data/albireo.sqlite`, in the volume of the container (server/main.ts).
The image declares `/data` as a volume, so mount a named volume there, such as `-v albireo-data:/data`.

- A named volume keeps the library when you replace the container, as an update does.
- Without one, Docker makes a new anonymous volume for each new container, and the library seems gone.
- albireo runs as the user node, with the ID 1000. A folder of the host that you mount at `/data` must be writable by that ID.

## Port

albireo listens on port 8080 inside the container.
Publish it with `ports`, on the address that the people of albireo reach, such as `127.0.0.1:8080:8080` on one machine.
albireo has no sign-in, so publish it nowhere that others reach.

## Health check

albireo answers `GET /healthz` with `ok` while it runs and reads its database.
The image runs this check every 30 seconds, so `docker ps` shows the container as healthy or unhealthy.

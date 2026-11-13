---
title: "Deploy"
description: "Run albireo with PostgreSQL and your own bucket behind HTTPS, run more containers, update it, and back it up."
---

This page runs albireo on a server of yours, with PostgreSQL beside it and a bucket at an S3-compatible storage service.
albireo needs four things: the bucket, an access key for it, a PostgreSQL database, and a proxy that serves HTTPS in front of albireo.

## 1. Create the bucket

Create a bucket for albireo alone in the console of your storage service, such as albireo-videos.
albireo writes its files under these prefixes (server/src/api/videos.rs, server/src/api/account.rs).

- `videos/`: the videos as people uploaded them
- `thumbnails/`: a JPEG for each video
- `avatars/`: the pictures of the channels
- `attachments/`: the files attached to the videos
- `albireo-check/`: a short file that albireo writes and deletes when it starts, to check the key

Add a lifecycle rule that aborts incomplete multipart uploads after a day or more.
When an upload stops halfway, as when the browser closes, the parts that reached the bucket stay there until the rule removes them.

The bucket needs no CORS rules: the browser never talks to it.

## 2. Make an access key

Make an access key with these permissions on the objects of the bucket, and on no other bucket.

1. Read objects: albireo streams the files to the browser.
2. Write objects: albireo writes thumbnails, pictures, and attachments.
3. Upload in parts: albireo writes each video as a multipart upload, and aborts the upload of a video that someone cancels.
4. Delete objects: deleting a video, an attachment, or a picture deletes its file.

The key needs no permission on the bucket itself: albireo never lists the bucket, and never creates or deletes buckets.
When albireo starts, it tries each permission under `albireo-check/`, and stops with the permissions that the key lacks (server/src/storage_check.rs).

## 3. Write the settings

Download compose.yaml and .env.example from the repository, and copy .env.example to .env.

```bash
# Download the example settings
curl -fsSLO https://raw.githubusercontent.com/etak64n/albireo/main/compose.yaml
curl -fsSLO https://raw.githubusercontent.com/etak64n/albireo/main/.env.example

# The secrets go in .env, which compose.yaml reads
cp .env.example .env
```

compose.yaml runs albireo and PostgreSQL, which keeps its data in the volume postgres-data.
In compose.yaml, replace the endpoint, the region, the bucket, and the URL style with those of your bucket.
[Configuration](../../settings/configuration/) describes each variable.

```yaml
# compose.yaml: albireo with PostgreSQL, and its files in an S3-compatible bucket
services:
  albireo:
    # 0.1 follows the fixes of 0.1; latest follows every release.
    image: ghcr.io/etak64n/albireo:0.1
    restart: unless-stopped
    ports:
      # A proxy with HTTPS in front of albireo reaches it here, so that passwords and
      # sessions never cross the network in plain text.
      - "127.0.0.1:8080:8080"
    environment:
      DATABASE_URL: postgres://albireo:${POSTGRES_PASSWORD:?Please write POSTGRES_PASSWORD in .env}@postgres:5432/albireo
      S3_ENDPOINT: https://s3.example.com
      S3_REGION: us-east-1
      S3_BUCKET: albireo-videos
      S3_URL_STYLE: path
      S3_ACCESS_KEY_ID: ${S3_ACCESS_KEY_ID:?Please write S3_ACCESS_KEY_ID in .env}
      S3_SECRET_ACCESS_KEY: ${S3_SECRET_ACCESS_KEY:?Please write S3_SECRET_ACCESS_KEY in .env}
    depends_on:
      postgres:
        condition: service_healthy

  postgres:
    # 18 follows the fixes of PostgreSQL 18. A new major version needs an upgrade of the data.
    image: postgres:18
    restart: unless-stopped
    environment:
      POSTGRES_USER: albireo
      POSTGRES_DB: albireo
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Please write POSTGRES_PASSWORD in .env}
    volumes:
      - postgres-data:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready --username albireo --dbname albireo"]
      interval: 5s
      timeout: 5s
      retries: 12

volumes:
  postgres-data:
```

Then write the secrets in .env.
The password of the database goes into the URL of `DATABASE_URL`, so make it of letters and digits only.

```bash
# Print a password of 48 letters and digits for POSTGRES_PASSWORD
# rand -hex 24 : 24 random bytes, written as 48 hexadecimal digits
openssl rand -hex 24
```

```dotenv
# .env: the secrets of albireo. Keep this file out of Git.
POSTGRES_PASSWORD=the-output-of-openssl-rand
S3_ACCESS_KEY_ID=your-access-key-id
S3_SECRET_ACCESS_KEY=your-secret-access-key
```

The `${POSTGRES_PASSWORD:?...}` form makes Docker Compose stop with that message when .env lacks the value, so a missing secret never reaches albireo.

## 4. Start albireo

```bash
# Start albireo and PostgreSQL in the background
# -d : return to the shell and leave them running
docker compose up -d

# Follow the log until albireo says that it is ready
# -f : keep printing new lines; stop with Ctrl+C
docker compose logs -f albireo
```

albireo writes one JSON object per line.
When the settings are right, albireo prepares the tables of the database, checks the bucket, and writes `albireo 0.1.0 is ready on port 8080`.

When a setting is wrong, albireo stops before it serves anything, and the log says what to change, starting with "Please".

- A missing or malformed variable names the variable and an example value (server/src/config.rs).
- A database that refuses the password, or that does not exist, stops albireo at once, with the reason from PostgreSQL (server/src/main.rs).
- A bucket that does not exist, a key that the service does not accept, a wrong region, and a key without a permission each have their own instruction (server/src/storage_check.rs).
- When the database or the bucket does not answer, albireo tries again after 2, 4, 8, 16, and 30 seconds before it stops, so a database that starts at the same time does not stop it.

## 5. Create the first admin

While albireo has nobody, it writes a setup code to its log each time it starts.

```bash
# Show the lines of the log that hold a setup code
# grep setupCode : keep only those lines of the log of albireo
docker compose logs albireo | grep setupCode
```

Open albireo in a browser, and enter the code with the email, the display name, and the password of the first admin.
The code works once: after the first admin, albireo writes no more codes.
The first admin then invites the others, as [People and sign-in](../../guides/people/) describes.

## 6. Serve albireo over HTTPS

People sign in with a password, and the browser keeps their session in a cookie, so albireo must be reached over HTTPS.
Put a reverse proxy in front of albireo that serves HTTPS, and keep `127.0.0.1:8080:8080`, so that only the proxy reaches albireo.

The proxy needs three things from its settings.

1. It sends the header `X-Forwarded-Proto: https` with each request. albireo then marks the cookie of a session as `Secure`, so the browser sends it over HTTPS alone (server/src/auth.rs). Many proxies send this header without a setting.
2. It passes request bodies of any size: a part of a video is 16 MiB or more.
3. It keeps long requests open: a video streams for as long as it plays.

## Run more containers

albireo keeps nothing in its container: the library and the sessions are in PostgreSQL, and the files in the bucket.
Several containers can therefore serve one library behind a proxy that spreads the requests among them, for a library that stays up while one container restarts, or for more people at once.

- Each container needs the same settings: the same database and the same bucket.
- A person stays signed in on every container, since each one reads the session from the database.
- When containers of a new version start together, the first one applies the migrations of the database, and the others wait for it (server/src/db.rs).

## Update

Read the notes of the release first: until version 1.0.0, a minor version, such as 0.2.0, may need a change to the settings.
Then change the version in `image`, and start the new image.

```bash
# Download the image that compose.yaml names
docker compose pull

# Replace the container of albireo. PostgreSQL and its volume stay.
docker compose up -d
```

albireo applies the new migrations of its database when it starts.

## Back up

The library lives in two places: the database in PostgreSQL, and the files in the bucket.
The database alone tells who the people are, and the titles, the series, the comments, and the other details of the videos, so back it up with the bucket.

```bash
# Write a copy of the database to albireo.dump in this folder, while albireo runs
# exec -T : run in the container without a terminal, so the output goes to the file
# --format custom : a compressed dump that pg_restore reads
docker compose exec -T postgres pg_dump --username albireo --format custom albireo > albireo.dump
```

To restore the copy into an empty database, stop albireo, and pass the dump to pg_restore.

```bash
# Stop albireo, so that nothing writes to the database while it fills
docker compose stop albireo

# Fill the database from the dump
# --clean --if-exists : replace the tables that are there with those of the dump
docker compose exec -T postgres pg_restore --username albireo --dbname albireo --clean --if-exists < albireo.dump

# Start albireo again
docker compose start albireo
```

## Uninstall

```bash
# Stop albireo and PostgreSQL, and remove their containers. The volume and the bucket stay.
docker compose down

# Remove the volume too, which deletes the database for good
docker compose down -v
```

The files stay in the bucket until you delete them in the console of your storage service.

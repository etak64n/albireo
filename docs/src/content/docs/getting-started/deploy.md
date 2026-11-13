---
title: "Deploy"
description: "Run albireo with PostgreSQL and your own bucket behind HTTPS, run more containers, update it, and back it up and restore it."
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
- `backups/`: the copies of the database that `albireo backup` writes
- `albireo-check/`: a short file that albireo writes and deletes when it starts, to check the key

Add two lifecycle rules to the bucket.

1. A rule that aborts incomplete multipart uploads after a day or more. When an upload stops halfway, as when the browser closes, the parts that reached the bucket stay there until the rule removes them.
2. A rule that deletes the objects under `backups/` after the days that you keep copies of the database, such as 30. albireo never deletes a copy itself.

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
Make a copy of the database with `albireo backup`, as [Back up](#back-up) describes, since a new version may change the database when it starts.
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
`albireo backup` writes a copy of the database to the bucket, under `backups/`, and exits (server/src/backup.rs).

```bash
# Write a copy of the database to the bucket, while albireo keeps serving
# run --rm : start a container of the albireo service for this command alone, and remove it after
docker compose run --rm albireo backup
```

- The copy is the database as it was at one moment. Its name holds that moment in UTC, such as `backups/albireo-20261114T031500Z.sql.gz`, and the last line of the log names it too.
- albireo makes a copy only when the command runs. To make one every day, run the command from the scheduler of the server, as the example below does with cron.
- The lifecycle rule of `backups/` deletes the old copies, as [Create the bucket](#1-create-the-bucket) describes.
- A copy holds the hashes of the passwords and of the sessions, as the database does, so keep the bucket private. albireo never serves a copy at `/api/files/`.
- A copy is SQL, compressed with gzip: a `COPY` statement for each table, with its rows. psql also reads it into the tables that albireo makes.

```text
# crontab of the server: a copy of the database at 03:00 every day
# cd /srv/albireo : the folder of compose.yaml, where docker compose finds the services
0 3 * * * cd /srv/albireo && docker compose run --rm albireo backup
```

## Restore

`albireo restore <key>` loads a copy into an empty database: it prepares the tables of albireo, and loads the whole copy or nothing.
After a loss of the database, such as of the volume postgres-data, PostgreSQL starts with an empty database, which the restore fills.

```bash
# Stop albireo, so that nobody changes the library while it goes in
docker compose stop albireo

# Load the copy into the empty database of DATABASE_URL
# restore <key> : the copy to load, by its name in the bucket
docker compose run --rm albireo restore backups/albireo-20261114T031500Z.sql.gz

# Start albireo again
docker compose start albireo
```

- The people sign in with the passwords of the copy, and the sessions of the copy work again.
- The restore stops with an instruction when the database has a library already. To keep a database that has one, create an empty database beside it, such as with `docker compose exec postgres createdb --username albireo albireo_restored`, and point `DATABASE_URL` at it.
- The restore also stops when the copy comes from a version of albireo with other migrations. Restore such a copy with the version that made it, which the instruction names, then start the version that you want, which updates the database.

## Uninstall

```bash
# Stop albireo and PostgreSQL, and remove their containers. The volume and the bucket stay.
docker compose down

# Remove the volume too, which deletes the database for good
docker compose down -v
```

The files stay in the bucket until you delete them in the console of your storage service.

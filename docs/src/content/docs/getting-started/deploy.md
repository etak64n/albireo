---
title: "Deploy"
description: "Run albireo with your own bucket, keep others out, update it, and back it up."
---

This page runs albireo on a server of yours, with a bucket at an S3-compatible storage service.
albireo needs three things: the bucket, an access key for it, and a Docker volume for its database.

## 1. Create the bucket

Create a bucket for albireo alone in the console of your storage service, such as albireo-videos.
albireo writes its files under these prefixes (server/app.ts).

- `videos/`: the videos as you uploaded them
- `thumbnails/`: a JPEG for each video
- `avatars/`: the picture of your channel
- `attachments/`: the files attached to the videos
- `albireo-check/`: a short file that albireo writes and deletes when it starts, to check the key

Add a lifecycle rule that aborts incomplete multipart uploads after a day or more.
When an upload stops halfway, as when the browser closes, the parts that reached the bucket stay there until the rule removes them.

The bucket needs no CORS rules: the browser never talks to it.

## 2. Make an access key

Make an access key with these permissions on the objects of the bucket, and on no other bucket.

1. Read objects: albireo streams the files to the browser.
2. Write objects: albireo writes thumbnails, pictures, and attachments.
3. Upload in parts: albireo writes each video as a multipart upload, and aborts the upload of a video that you cancel.
4. Delete objects: deleting a video, an attachment, or a picture deletes its file.

The key needs no permission on the bucket itself: albireo never lists the bucket, and never creates or deletes buckets.
When albireo starts, it tries each permission under `albireo-check/`, and stops with the permissions that the key lacks (server/storage-check.ts).

## 3. Write the settings

Download compose.yaml and .env.example from the repository, and copy .env.example to .env.

```bash
# Download the example settings
curl -fsSLO https://raw.githubusercontent.com/etak64n/albireo/main/compose.yaml
curl -fsSLO https://raw.githubusercontent.com/etak64n/albireo/main/.env.example

# The access key goes in .env, which compose.yaml reads
cp .env.example .env
```

In compose.yaml, replace the endpoint, the region, the bucket, and the URL style with those of your bucket.
[Configuration](../../settings/configuration/) describes each variable.

```yaml
# compose.yaml: albireo with its database in a volume and its files in an S3-compatible bucket
services:
  albireo:
    # 0.1 follows the fixes of 0.1; latest follows every release.
    image: ghcr.io/etak64n/albireo:0.1
    restart: unless-stopped
    ports:
      # albireo has no sign-in, so only this host reaches it.
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

Then write the access key in .env.

```dotenv
# .env: the access key of the bucket. Keep this file out of Git.
S3_ACCESS_KEY_ID=your-access-key-id
S3_SECRET_ACCESS_KEY=your-secret-access-key
```

The `${S3_ACCESS_KEY_ID:?...}` form makes Docker Compose stop with that message when .env lacks the value, so a missing key never reaches albireo.

## 4. Start albireo

```bash
# Start albireo in the background
# -d : return to the shell and leave albireo running
docker compose up -d

# Follow the log until albireo says that it is ready
# -f : keep printing new lines; stop with Ctrl+C
docker compose logs -f albireo
```

albireo writes one JSON object per line.
When the settings are right, the message of the last line is `albireo 0.1.0 is ready on port 8080`.

When a setting is wrong, albireo stops before it serves anything, and the log says what to change, starting with "Please".

- A missing or malformed variable names the variable and an example value (server/config.ts).
- A bucket that does not exist, a key that the service does not accept, a wrong region, and a key without a permission each have their own instruction (server/storage-check.ts).
- When the service does not answer, albireo tries again after 2, 4, 8, and 16 seconds before it stops, so a bucket that starts at the same time does not stop it.

## 5. Keep others out

albireo has no sign-in: everyone who reaches port 8080 can watch, upload, and delete everything.
Choose one of these ways to reach it.

1. On the server itself: keep `127.0.0.1:8080:8080`, and open http://localhost:8080 there.
2. On a private network, such as a VPN between your devices: publish the port on the address of that network only, such as `100.64.0.10:8080:8080`.
3. From the internet: put a reverse proxy in front of albireo that serves HTTPS and signs people in, and keep `127.0.0.1:8080:8080` so that only the proxy reaches albireo.

albireo refuses a change that a page of another site asks a browser to make, by the `Sec-Fetch-Site` header that browsers send (server/app.ts).
This keeps other sites from changing your library through your browser, but it does not keep out anyone who reaches the port.

## Update

Read the notes of the release first: until version 1.0.0, a minor version, such as 0.2.0, may need a change to the settings.
Then change the version in `image`, and start the new image.

```bash
# Download the image that compose.yaml names
docker compose pull

# Replace the container. The volume, and with it the library, stays.
docker compose up -d
```

albireo applies the new migrations of its database when it starts (server/database.ts).

## Back up

The library lives in two places: the database in the volume, and the files in the bucket.
The database alone tells the titles, the series, the comments, and the other details of the videos, so back it up with the bucket.

```bash
# Stop albireo, so that the database file does not change while you copy it
docker compose stop albireo

# Copy the volume into albireo-data.tar.gz in this folder
# --rm : remove the helper container when it ends
# -v albireo-data:/data : mount the volume of the database (Compose names it <project>_albireo-data)
docker run --rm -v "$(basename "$PWD")_albireo-data:/data" -v "$PWD:/backup" alpine tar -czf /backup/albireo-data.tar.gz -C /data .

# Start albireo again
docker compose start albireo
```

## Uninstall

```bash
# Stop albireo and remove its container. The volume and the bucket stay.
docker compose down

# Remove the volume too, which deletes the database for good
docker compose down -v
```

The files stay in the bucket until you delete them in the console of your storage service.

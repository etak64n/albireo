---
title: "Architecture"
description: "How albireo works: its parts, the path of a video, and its design choices."
---

albireo is one container with a server, a browser app, and a database.
Every file passes through the server between the browser and the bucket.

## Parts

```
  Browser  ──── HTTP ────▶  albireo container  ──── S3 API ────▶  Bucket
  pages, the player,        server on port 8080                   videos, thumbnails,
  uploads                   browser app (dist/)                   pictures, attachments
                            SQLite in /data (volume)
```

albireo has three parts.

1. The server
2. The database
3. The bucket

The server is Node.js, which runs the TypeScript of server/ as it is, with the Hono framework (server/main.ts, server/app.ts).
It answers `/api/*` itself, and serves the browser app for every other path: its built files from dist/, and index.html for the pages of the app (server/static-files.ts).
The browser app is a React single-page app built with Vite.

The database is SQLite in one file, `/data/albireo.sqlite`, which node:sqlite opens (server/database.ts).
It uses write-ahead logging, so a read sees the last commit while a write runs.
When albireo starts, it applies each file of migrations/ that the database does not have yet, each in a transaction.

The database keeps these tables (migrations/0001_create_tables.sql).

- videos: one row per video, with its title, description, size, duration, resolution, thumbnail, series, and upload state, and the numbers of its ratings, comments, and attachments
- users: the one person, with the display name, the bio, the picture, and the language of the app
- series: one row per series, with its title and description
- playlists and playlist_videos: one row per playlist, and one row for each video in a playlist, with its place there
- watch_history: the videos that the person watched, with the last time
- comments and ratings: the comments under videos, and the stars that the person gave them
- attachments: the files of each video, with their names, types, and sizes
- video_search: the full-text index of the titles and descriptions

The bucket holds the files (server/app.ts).

- A video goes to `videos/<ID>/original<extension>`, and its thumbnail to `thumbnails/<ID>.jpg`.
- The picture of the person goes to `avatars/<user ID>.jpg`.
- An attachment goes to `attachments/<video ID>/<attachment ID>`.

The server signs its requests to the bucket with AWS Signature Version 4, using the aws4fetch library (server/storage.ts).

## The path of a video

Upload:

1. The browser asks the server to start an upload. The server starts a multipart upload in the bucket, and answers with the size of the parts.
2. The browser sends each part to the server, 4 at a time.
3. The server passes each part on to the bucket as it arrives, and answers with the ETag that the bucket gave the part.
4. The browser asks the server to finish the upload with the ETags. The server completes the upload in the bucket, and checks the size of the file.

Playback:

1. The browser opens a video, and the server answers with the URL of its file under `/api/files/`.
2. The player reads the file in byte ranges. The server passes each range on to the bucket, and streams the answer back.

Thumbnails, pictures, and attachments take a shorter path: one PUT to the server each, which writes the file to the bucket, then a commit.
On the commit, the server checks that the file is in the bucket before albireo shows it.

## Design choices

- The browser talks to albireo alone. The bucket needs no CORS rules and no public access, and the access key never leaves the server. The cost is that every byte of a video crosses the server twice, from the bucket and to the browser.
- The server streams files and never holds a whole file or part in memory. A write to the bucket carries the length of the part, which S3 needs, and an unsigned payload, so the server can send the bytes as they arrive (server/storage.ts).
- The database holds the library, so the pages never list the bucket.
- albireo stores each file as it is. It does not transcode the file or turn it into HLS (HTTP Live Streaming), a format that splits a video into many small files. Each video stays one object, and the container needs no video tools.
- Search runs in SQLite, with its full-text search FTS5 and the trigram tokenizer. The trigram tokenizer finds words inside longer text, so it also works for languages that do not put spaces between words, such as Japanese.
- Previews of attachments run in the browser, so the server needs no converters, and the files go to no other service.
- albireo serves the files of the bucket from its own origin, so a file that a person uploads could run as a page there. albireo gives every attachment a type from a list of safe types, and serves every file with `X-Content-Type-Options: nosniff` and a policy with `sandbox`, which runs no script in a file that opens on its own (server/attachments.ts, server/security-headers.ts).
- Deleting a video, an attachment, or a picture deletes its file from the bucket too. The server deletes the files of a video before its rows, so a deletion that stops halfway leaves the video in the library, and deleting it again finishes the work.
- Every setting is required, and albireo has no default values (server/config.ts). When a setting is wrong, albireo stops before it serves anything, and says what to change.
- A request to the bucket that fails in a way that may pass, an answer of 429 or 5xx, runs again, twice at most (server/storage.ts). Writes run once, and the browser sends a failed part or file again. The browser runs its reads of the API again after a lost connection or an answer of 429 or 5xx (shared/retry.ts).

A video plays if the browser supports its format, such as MP4 with H.264 video and AAC audio.

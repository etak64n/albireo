---
title: "Architecture"
description: "How albireo works: its parts, sign-in, the path of a video, and its design choices."
---

albireo is a server in a container, with a browser app, a PostgreSQL database, and a bucket.
Every file passes through the server between the browser and the bucket.

## Parts

```
  Browser ── HTTPS ──▶ Proxy ── HTTP ──▶ albireo containers ──────▶ PostgreSQL
  pages, the player,                     server on port 8080         people, sessions,
  uploads                                browser app (dist/)         the library
                                                  │
                                                  └──── S3 API ────▶ Bucket
                                                                     videos, thumbnails,
                                                                     pictures, attachments
```

albireo has four parts.

1. The server
2. The browser app
3. The database
4. The bucket

The server is one program in Rust, built on the axum framework (server/src/main.rs, server/src/api/mod.rs).
It answers `/api/*` itself, and serves the browser app for every other path: its built files from dist/, and index.html for the pages of the app (server/src/pages.rs).
The browser app is a React single-page app built with Vite.

The database is PostgreSQL, which the server reaches through the sqlx library (server/src/db.rs).
When the server starts, it applies each file of migrations/ that the database does not have yet.
The server keeps nothing else, so any number of containers can serve one library.

The database keeps these tables (migrations/0001_create_tables.sql).

- users: one row per person, with the email, the hash of the password, the role, the display name, the bio, the picture, and the language of the app
- sessions, invitations, and setup_codes: the hashes of the sessions of the browsers, of the links of the invitations, and of the setup codes
- videos: one row per video, with its title, description, size, duration, resolution, thumbnail, uploader, series, and upload state, and the numbers of its ratings, comments, and attachments
- series: one row per series, with its title, description, and creator
- playlists and playlist_videos: one row per playlist, and one row for each video in a playlist, with its place there
- watch_history: the videos that each person watched, with the last time
- comments and ratings: the comments under videos, and the stars that each person gave them
- attachments: the files of each video, with their names, types, and sizes

The bucket holds the files (server/src/api/videos.rs, server/src/api/account.rs).

- A video goes to `videos/<ID>/original<extension>`, and its thumbnail to `thumbnails/<ID>.jpg`.
- The picture of a person goes to `avatars/<user ID>.jpg`.
- An attachment goes to `attachments/<video ID>/<attachment ID>`.

The server signs its requests to the bucket with AWS Signature Version 4, using the rusty-s3 library (server/src/storage.rs).

## Sign-in

A sign-in checks the password against its Argon2id hash, and starts a session (server/src/auth.rs).

1. The server makes a random token of 32 bytes, keeps its SHA-256 hash in the table sessions, and gives the token to the browser in a cookie.
2. Each request carries the cookie. The server finds the session by the hash of the token, and acts as its person.
3. A session ends 30 days after its last request. The server moves the end forward at most every 5 minutes, to keep the writes few.

The database keeps hashes alone, of the tokens of the sessions, of the links of the invitations, and of the setup codes, so a copy of the database signs nobody in.

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
- The server streams files and never holds a whole file or part in memory. A write to the bucket carries the length of the part, which S3 needs, and an unsigned payload, so the server can send the bytes as they arrive (server/src/storage.rs).
- The database holds the library, so the pages never list the bucket.
- A container keeps no state. Two containers that serve one library can each answer any request, as the end-to-end tests check with two containers (test/e2e.sh). The changes that must not interleave, such as the last admin who stops being one, take a lock in the database (server/src/repo/people.rs).
- albireo stores each file as it is. It does not transcode the file or turn it into HLS (HTTP Live Streaming), a format that splits a video into many small files. Each video stays one object, and the container needs no video tools.
- Search runs in PostgreSQL, with `ILIKE` for each word and the trigram indexes of pg_trgm. A word matches anywhere inside a title, so search also works for languages that do not put spaces between words, such as Japanese.
- Previews of attachments run in the browser, so the server needs no converters, and the files go to no other service.
- albireo serves the files of the bucket from its own origin, so a file that a person uploads could run as a page there. albireo gives every attachment a type from a list of safe types, and serves every file with `X-Content-Type-Options: nosniff` and a policy with `sandbox`, which runs no script in a file that opens on its own (server/src/repo/notes.rs, shared/security-headers.json).
- Deleting a video, an attachment, or a picture deletes its file from the bucket too. The server deletes the files of a video before its rows, so a deletion that stops halfway leaves the video in the library, and deleting it again finishes the work.
- Every setting is required, and albireo has no default values (server/src/config.rs). When a setting is wrong, albireo stops before it serves anything, and says what to change.
- A request to the bucket without a body that fails in a way that may pass, an answer of 429 or 5xx or a lost connection, runs again, twice at most (server/src/storage.rs). A write streams its body as it arrives, so it runs once, and the browser sends a failed part or file again. The browser also runs its reads of the API again after a lost connection or an answer of 429 or 5xx (shared/retry.ts).

A video plays if the browser supports its format, such as MP4 with H.264 video and AAC audio.

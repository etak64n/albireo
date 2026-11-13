<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="images/albireo-wordmark-dark.png">
    <img src="images/albireo-wordmark.png" alt="albireo" width="400">
  </picture>
</h1>

<p align="center">albireo is a private video library for a team, with your videos in S3-compatible storage.</p>

<p align="center">
  <a href="https://github.com/etak64n/albireo/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/etak64n/albireo/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://github.com/etak64n/albireo/actions/workflows/pages.yml"><img alt="Pages" src="https://github.com/etak64n/albireo/actions/workflows/pages.yml/badge.svg" /></a>
  <a href="https://github.com/etak64n/albireo/releases"><img alt="Release" src="https://img.shields.io/github/v/release/etak64n/albireo" /></a>
  <a href="https://github.com/etak64n/albireo/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/etak64n/albireo" /></a>
</p>

<p align="center">
  <a href="https://etak64n.github.io/albireo/">Live Demo</a>
  · <a href="https://etak64n.github.io/albireo/docs/">Docs</a>
  · <a href="#quick-start">Quick start</a>
  · <a href="https://github.com/etak64n/albireo/releases">Releases</a>
</p>

Upload, watch, rate, and comment on videos together, group them in series and playlists, and attach files such as slides to them. The videos stay in your bucket as you uploaded them, and the only settings are the database, the bucket, and its access key. The app speaks English or Japanese.

## How it works

```
  Browser ── HTTPS ──▶ albireo containers ──────▶ PostgreSQL
  pages, the player,   server on port 8080         people, sessions, the library
  uploads                       │
                                └──── S3 API ────▶ Bucket
                                                   videos, thumbnails, pictures, attachments
```

- A container serves the app and its API, and keeps nothing of its own: the library is in PostgreSQL, and the files are in the bucket. Run one container, or several for a library that stays up while one restarts.
- Every file passes through albireo, so the browser talks to albireo alone. The bucket needs no CORS rules, and the access key stays on the server.
- People sign in with an email and a password. The first admin signs up with a setup code from the log of albireo, and admins invite everyone else with a link. Members edit what they made, and admins edit everything.

## Features

### Watch

[![Playing the video that the home page of the demo recommends first](images/tour-watch.gif)](https://etak64n.github.io/albireo/)

The home page recommends what to watch next: the next episode of a series that you are watching, then the videos that you have not watched yet.

### Series

[![A series of 20 lessons in the demo, and the list of its episodes beside a lesson](images/tour-series.gif)](https://etak64n.github.io/albireo/)

A series groups videos as numbered episodes. The video page lists every episode of its series, and the next episode plays when one ends.

### Attachments

[![Files of several kinds attached to a video of the demo, each in the preview](images/tour-attachments.gif)](https://etak64n.github.io/albireo/)

Attach slides, documents, pictures, and data to a video. PDF, PowerPoint, Markdown, text, CSV, JSON, and pictures open in a preview over the page, and every file downloads.

### Comments

[![A comment with a time, posted in the demo, and the video playing from that time](images/tour-comments.gif)](https://etak64n.github.io/albireo/)

A time in a comment, such as 0:05, becomes a link that plays the video from there.

### Search

[![A search from the top bar of the demo, and the videos that it finds](images/tour-search.gif)](https://etak64n.github.io/albireo/)

Search finds the series whose title contains every word of the query, and the videos whose title or description does.

## Quick start

You need Docker with Docker Compose, an empty bucket at an S3-compatible storage service, and an access key that can read, write, and delete the objects of that bucket.

1. Download compose.yaml and .env.example, and copy .env.example to .env.

   ```bash
   # Download the example settings, and make .env for the secrets
   curl -fsSLO https://raw.githubusercontent.com/etak64n/albireo/main/compose.yaml
   curl -fsSLO https://raw.githubusercontent.com/etak64n/albireo/main/.env.example
   cp .env.example .env
   ```

2. In compose.yaml, replace the endpoint, the region, the bucket, and the URL style with those of your bucket. In .env, write a password for the database and the access key.

   ```yaml
   # compose.yaml: the bucket of albireo
   S3_ENDPOINT: https://s3.example.com
   S3_REGION: us-east-1
   S3_BUCKET: albireo-videos
   S3_URL_STYLE: path
   ```

   ```dotenv
   # .env: the password of the database, such as the output of `openssl rand -hex 24`, and the access key of the bucket
   POSTGRES_PASSWORD=a-password-of-letters-and-digits
   S3_ACCESS_KEY_ID=your-access-key-id
   S3_SECRET_ACCESS_KEY=your-secret-access-key
   ```

3. Start albireo and PostgreSQL, and read the setup code of the first admin from the log.

   ```bash
   # Start albireo and its database in the background
   docker compose up -d

   # Show the line of the log that holds the setup code
   docker compose logs albireo | grep setupCode
   ```

4. Open http://localhost:8080, and create the first admin with the setup code.

When a setting is wrong, albireo stops at once, and `docker compose logs albireo` says what to change. compose.yaml publishes albireo on this machine alone: to reach it from other devices, put a proxy with HTTPS in front of it, as the [deployment guide](https://etak64n.github.io/albireo/docs/getting-started/deploy/) describes. To try albireo without a bucket of your own, see the [quick start with a local bucket](https://etak64n.github.io/albireo/docs/getting-started/quickstart/).

## Documentation

The [documentation](https://etak64n.github.io/albireo/docs/) covers the deployment behind a proxy with HTTPS, several containers, every setting, updates and backups, people and sign-in, each feature, and how albireo works.

## License

[MIT](LICENSE)

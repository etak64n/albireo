<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="images/albireo-wordmark-dark.png">
    <img src="images/albireo-wordmark.png" alt="albireo" width="400">
  </picture>
</h1>

<p align="center">albireo is a private video library in one Docker container, with your videos in S3-compatible storage.</p>

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

Upload, watch, rate, and comment on your videos, group them in series and playlists, and attach files such as slides to them. The videos stay in your bucket as you uploaded them, and the only settings are the bucket and its access key. The app speaks English or Japanese.

## How it works

```
  Browser  ──── HTTP ────▶  albireo container  ──── S3 API ────▶  Bucket
  pages, the player,        server on port 8080                   videos, thumbnails,
  uploads                   SQLite in a volume                    pictures, attachments
```

- The container serves the app and its API, and keeps the library in a SQLite database in its volume: the titles, series, playlists, comments, ratings, history, and a search index.
- Every file passes through the container, so the browser talks to albireo alone. The bucket needs no CORS rules, and the access key stays on the server.
- albireo has no sign-in. Run it where only you can reach it, such as on localhost or a private network, or behind a proxy that signs people in.

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
   # Download the example settings, and make .env for the access key
   curl -fsSLO https://raw.githubusercontent.com/etak64n/albireo/main/compose.yaml
   curl -fsSLO https://raw.githubusercontent.com/etak64n/albireo/main/.env.example
   cp .env.example .env
   ```

2. In compose.yaml, replace the endpoint, the region, the bucket, and the URL style with those of your bucket, and write the access key in .env.

   ```yaml
   # compose.yaml: the bucket of albireo
   S3_ENDPOINT: https://s3.example.com
   S3_REGION: us-east-1
   S3_BUCKET: albireo-videos
   S3_URL_STYLE: path
   ```

   ```dotenv
   # .env: the access key of the bucket
   S3_ACCESS_KEY_ID=your-access-key-id
   S3_SECRET_ACCESS_KEY=your-secret-access-key
   ```

3. Start albireo, and open http://localhost:8080.

   ```bash
   # Start albireo in the background
   docker compose up -d
   ```

When a setting is wrong, albireo stops at once, and `docker compose logs albireo` says what to change. To try albireo without a bucket of your own, see the [quick start with a local bucket](https://etak64n.github.io/albireo/docs/getting-started/quickstart/).

## Documentation

The [documentation](https://etak64n.github.io/albireo/docs/) covers the deployment behind a proxy, every setting, updates and backups, each feature, and how albireo works.

## License

[MIT](LICENSE)

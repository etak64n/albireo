---
title: "Overview"
description: "A private video library in one Docker container, with videos in S3-compatible storage."
---

albireo is a private video library that runs in one Docker container and keeps its files in an S3-compatible bucket.
You upload, watch, rate, and comment on videos, group them in series and playlists, and attach files such as slides to them.

Try the [demo](/albireo/), which shows every page with sample data in your browser.

## In short

- albireo is one container that serves a browser app and an API on port 8080. A SQLite database in the volume of the container holds the library: videos, series, playlists, comments, ratings, the watch history, attachments, and a search index.
- The bucket holds the files: the videos as you uploaded them, their thumbnails, the picture of your channel, and the attachments. Every file passes through albireo, so the browser talks to albireo alone, and the bucket needs no CORS rules.
- albireo has no sign-in. Everyone who reaches it is its one person, who can do everything. Run it where only you can reach it, or behind a proxy that signs people in.
- The settings are six environment variables that name the bucket and its access key.

A typical use is keeping your own recordings, such as meeting or lecture recordings with their slides, in one private place.

## Features

albireo has these features.

1. [Upload](guides/upload/)
2. [Home and lists](guides/home-and-lists/)
3. [Search](guides/search/)
4. [Series](guides/series/)
5. [Playlists](guides/playlists/)
6. [Play](guides/play/)
7. [Ratings and comments](guides/ratings-and-comments/)
8. [Attachments](guides/attachments/)
9. [Channel and account](guides/channels/)

[One person, no sign-in](guides/one-person/) describes who albireo serves, and how to keep others out.

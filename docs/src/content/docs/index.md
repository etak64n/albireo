---
title: "Overview"
description: "A private video library for a team, with videos in S3-compatible storage."
---

albireo is a private video library for a team. A server in a Docker container keeps the library in PostgreSQL and the files in an S3-compatible bucket.
People sign in to upload, watch, rate, and comment on videos, group them in series and playlists, and attach files such as slides to them.

Try the [demo](/albireo/), which shows every page with sample data in your browser.

## In short

- albireo is a container that serves a browser app and an API on port 8080. It keeps nothing of its own, so several containers can serve one library, for a server that stays up while another restarts, or for more people at once.
- PostgreSQL holds the library: the people and their sessions, the videos, series, playlists, comments, ratings, the watch history, and the attachments.
- The bucket holds the files: the videos as people uploaded them, their thumbnails, the pictures of the channels, and the attachments. Every file passes through albireo, so the browser talks to albireo alone, and the bucket needs no CORS rules.
- People sign in with an email and a password. The first admin signs up with a setup code from the log of albireo, and admins invite everyone else with a link.
- The settings are seven environment variables: the database, the bucket, and its access key.

A typical use is a team that keeps its recordings, such as meetings, talks, and lectures with their slides, in one private place.

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
10. [People and sign-in](guides/people/)

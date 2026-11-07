---
title: "Overview"
description: "A private video library on Cloudflare Workers."
---

albireo is a private video library that runs on Cloudflare Workers and keeps videos in S3-compatible object storage.
The people you allow sign in with Cloudflare Access, then upload, watch, rate, and comment on videos, and attach files such as slides to them.

Try the [demo](/albireo/), which shows every page with sample data.

## In short

- albireo is one Cloudflare Worker that serves a browser app and an API. D1 holds the library: videos, people, series, comments, ratings, watch history, attachments, and a search index.
- Videos and attached files stay in your S3-compatible bucket as you uploaded them. The browser sends and reads them directly, so their bytes never pass through the Worker.
- Cloudflare Access decides who can open the library. albireo keeps a profile for each person who signs in, but it has no passwords of its own.

A typical use is keeping your own recordings, such as meeting or lecture recordings with their slides, in one private place.

## Features

albireo has these features.

1. [Upload](guides/upload/)
2. [Home and lists](guides/home-and-lists/)
3. [Search](guides/search/)
4. [Series](guides/series/)
5. [Play](guides/play/)
6. [Ratings and comments](guides/ratings-and-comments/)
7. [Attachments](guides/attachments/)
8. [Channels](guides/channels/)

[People and permissions](guides/people-and-permissions/) describes who can do what.

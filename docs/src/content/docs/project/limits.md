---
title: "Limits"
description: "The limits of albireo, and what it does not do."
---

## Limits

These constants set the limits.

```ts
// server/upload-plan.ts: each part is at least 16 MiB, and a file has at most 10,000 parts and 5 TiB
export const MIN_PART_SIZE = 16 * MIB;
export const MAX_PART_COUNT = 10_000;
export const MAX_OBJECT_SIZE = 5 * 1024 * 1024 * MIB;

// src/lib/upload.ts: the browser sends 4 parts at a time and tries each part up to 3 times
const PART_CONCURRENCY = 4;
const PART_ATTEMPTS = 3;

// server/app.ts: a thumbnail or a picture is at most 32 MiB
const IMAGE_MAX_BYTES = 32 * 1024 * 1024;

// shared/api.ts: limits that the browser app and the server share
export const TITLE_MAX_LENGTH = 200;
export const DESCRIPTION_MAX_LENGTH = 5000;
export const DISPLAY_NAME_MAX_LENGTH = 50;
export const BIO_MAX_LENGTH = 1000;
export const LIST_PAGE_SIZE = 48;
export const COMMENT_MAX_LENGTH = 2000;
export const RATING_MAX_STARS = 5;
export const SEARCH_QUERY_MAX_LENGTH = 100;
export const ATTACHMENT_MAX_BYTES = 500 * 1024 * 1024;
export const ATTACHMENT_NAME_MAX_LENGTH = 255;
```

## What albireo does not do

- albireo has no sign-in and serves one person.
- albireo does not transcode videos or create HLS streams.
- albireo has no editing of comments, and it sends no notifications or emails.
- albireo has no previews of Word and Excel files. They download only.
- albireo does not back up its database. Back up the volume and the bucket yourself.

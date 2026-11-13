---
title: "Limits"
description: "The limits of albireo, and what it does not do."
---

## Limits

These constants set the limits.

```rust
// server/src/shared.rs: each part is at least 16 MiB, and a file has at most 10,000 parts and 5 TiB
pub const MIN_PART_SIZE: i64 = 16 * MIB;
pub const MAX_PART_COUNT: i64 = 10_000;
pub const MAX_OBJECT_SIZE: i64 = 5 * 1024 * 1024 * MIB;

// server/src/api/account.rs: a thumbnail or a picture is at most 32 MiB
pub const IMAGE_MAX_BYTES: i64 = 32 * 1024 * 1024;

// server/src/auth.rs: a session lasts 30 days after its last request, and ten wrong
// passwords in a row lock an account for 15 minutes
pub const SESSION_DAYS: i64 = 30;
pub const LOCK_MINUTES: i64 = 15;

// server/src/api/account.rs: an invitation works for 7 days
const INVITATION_DAYS: i64 = 7;
```

```ts
// src/lib/upload.ts: the browser sends 4 parts at a time and tries each part up to 3 times
const PART_CONCURRENCY = 4;
const PART_ATTEMPTS = 3;

// shared/api.ts: limits that the browser app and the server share (server/src/shared.rs)
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
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;
export const EMAIL_MAX_LENGTH = 254;
```

## What albireo does not do

- albireo sends no email, so it has no reset of a forgotten password and no notifications. An admin removes a person and invites them again, which gives them a new password.
- albireo has no sign-in through another service, and no second factor.
- albireo does not transcode videos or create HLS streams.
- albireo has no editing of comments.
- albireo has no previews of Word and Excel files. They download only.
- albireo makes a copy of its database only when `albireo backup` runs, and never deletes a copy. The scheduler of the server runs the command, and a lifecycle rule of the bucket deletes the old copies.
- albireo does not back up the files of the bucket. Use the versioning or the replication of your storage service.

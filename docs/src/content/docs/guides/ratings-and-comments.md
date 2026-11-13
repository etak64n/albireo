---
title: "Ratings and comments"
description: "Stars and comments under each video."
---

## Ratings

Each person gives a video 1 to 5 stars, and can change the rating or clear it (server/src/repo/notes.rs, src/components/StarRating.tsx).
Once someone has rated a video, its average and the number of ratings show beside the stars, such as `4.0 (3)`.
A change shows at once, with the average and the number counted in the browser, and saves behind (src/lib/rating.ts). When the API answers, its numbers, which count everyone's stars, take their place; when it fails, the rating goes back and a message says why.

## Comments

Comments are a flat list under the video, from the newest, 48 per page (server/src/repo/notes.rs, src/components/Comments.tsx).
A comment has at most 2,000 characters, and nobody can edit it after posting.
Its author, the uploader of the video, and admins can delete it.

A time in a comment, such as 1:23 or 1:02:03, is a link that plays the video from that point (src/lib/timestamps.ts).
A time past the end of the video stays plain text.

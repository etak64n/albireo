---
title: "Ratings and comments"
description: "Stars and comments under each video."
---

## Ratings

You give a video 1 to 5 stars, and can change the rating or clear it (server/ratings.ts, src/components/StarRating.tsx).
Once you have rated a video, the stars show beside it, such as `4.0 (1)`.
A change shows at once and saves behind (src/lib/rating.ts). When the save fails, the rating goes back and a message says why.

## Comments

Comments are a flat list under the video, from the newest, 48 per page (server/comments.ts, src/components/Comments.tsx).
They serve as notes on the video. A comment has at most 2,000 characters, and it cannot be edited after posting, only deleted.

A time in a comment, such as 1:23 or 1:02:03, is a link that plays the video from that point (src/lib/timestamps.ts).
A time past the end of the video stays plain text.

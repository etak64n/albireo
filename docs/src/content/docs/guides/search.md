---
title: "Search"
description: "Full-text search of titles and descriptions in D1."
---

The search box in the header opens `/search?q=<query>`.
The results are the ready videos whose title or description contains every word of the query, ignoring case, with title matches first (worker/app.ts, worker/videos.ts).

- A query has 1 to 100 characters and at most 10 words. Spaces separate the words, including the wide space of Japanese text.
- Words of three or more characters use the trigram index. FTS5 orders those results by bm25, its relevance score, and counts a match in the title ten times a match in the description.
- Shorter words, such as two-character Japanese words, are too short for the index, so D1 checks them row by row.
- Triggers keep the index the same as the videos table, so new titles and edits are found at once (migrations/0006_video_search.sql).

---
title: "Search"
description: "Search of series in the browser, and full-text search of videos in the database."
---

The search box in the header opens `/search?q=<query>`.
The results show the series whose title contains every word of the query, and under them the ready videos whose title or description contains every word, ignoring case, with title matches first (src/pages/SearchPage.tsx, server/app.ts, server/videos.ts).

- A query has 1 to 100 characters and at most 10 words. Spaces separate the words, including the wide space of Japanese text.
- The browser finds the series in the list of every series that it loaded for the sidebar, so the series cost the database no reads (src/lib/search.ts). Until Show all, the results show one row of them: one, two, or three, as the width of the page gives the grid columns.
- For the videos, words of three or more characters use the trigram index of FTS5, the full-text search of SQLite, which indexes every run of three characters. FTS5 orders those results by bm25, its relevance score, and counts a match in the title ten times a match in the description.
- Shorter words, such as two-character Japanese words, are too short for the index, so the database checks them row by row: in the videos that the index found, or, when the query has no longer word, in each ready video once, from the newest. Either way a search reads each video at most once.
- Triggers keep the index the same as the videos table, so new titles and edits are found at once (migrations/0001_create_tables.sql).

---
title: "Search"
description: "Search of series in the browser, and search of videos in the database."
---

The search box in the header opens `/search?q=<query>`.
The results show the series whose title contains every word of the query, and under them the ready videos whose title or description contains every word, ignoring case (src/pages/SearchPage.tsx, server/src/api/videos.rs, server/src/repo/videos.rs).

- A query has 1 to 100 characters and at most 10 words. Spaces separate the words, including the wide space of Japanese text.
- The browser finds the series in the list of every series that it loaded for the sidebar, so the series cost the database no reads (src/lib/search.ts). Until Show all, the results show one row of them: one, two, or three, as the width of the page gives the grid columns.
- The videos whose title contains every word come first, then the others, each group from the newest. The results come 48 at a time, up to the first 10,000.
- A word matches anywhere inside a title or a description, so it also finds words in languages that do not put spaces between words, such as Japanese. `%` and `_` in a word are plain characters.
- Trigram indexes of the PostgreSQL extension pg_trgm, which index every run of three characters, let PostgreSQL find words of three or more characters without reading every video (migrations/0001_create_tables.sql).
- A word of one or two characters, such as a two-character Japanese word, is too short for the indexes. PostgreSQL then checks it in the videos that the other words of the query leave, or in every ready video when the query has no longer word.
- The search reads the tables themselves, so new titles and edits are found at once.

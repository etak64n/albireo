---
title: "Attachments"
description: "Files that go with a video, such as its slides."
---

An attachment is a file that goes with a video, such as its slides or notes (server/attachments.ts, src/components/Attachments.tsx).
A file of any type can be attached, up to 500 MiB, with a name of at most 255 characters.

- The browser sends the file to albireo, which writes it to the bucket, then commits it. albireo checks that the file is in the bucket and records its size.
- albireo picks the content type from the file extension. HTML, SVG, and unknown types are stored as `application/octet-stream`, so that no uploaded file runs as a page.
- albireo serves every file with a policy that runs no script and loads nothing when the file opens on its own, and with `X-Content-Type-Options: nosniff`, so the browser takes the type as albireo gives it (server/security-headers.ts).

The Preview button opens the file over the page (src/components/AttachmentPreview.tsx).

- PDF: every page, drawn by pdf.js through react-pdf. Unlike a PDF in a frame, this also shows every page on iPhone and iPad.
- PowerPoint (.pptx and .ppt): @extend-ai/react-pptx. albireo serves its WebAssembly parser itself, so the file goes to no other site.
- Markdown: react-markdown with GitHub's tables and task lists (remark-gfm). HTML in the file stays text.
- Text: as text
- CSV: as a table, with the first row as its head and columns of numbers to the right. A long file shows its first 2,000 rows.
- JSON and code: in colors by highlight.js, and JSON laid out with two spaces. The code is JavaScript, TypeScript, Python, Ruby, Go, Rust, Java, Kotlin, Swift, C, C++, C#, PHP, shell, SQL, YAML, TOML, INI, HTML, XML, SVG, CSS, SCSS, or a diff, by the extension of the file (src/lib/attachments.ts).
- PNG, JPEG, GIF, and WebP: as images

Word, Excel, and other files have no preview, and they download only.
Each viewer loads when a file of its kind opens, so the video page stays light.

The Download button saves the file under its name.
albireo sends the file with a `Content-Disposition` header that names it, so the browser saves the file as it arrives, however large it is (`/api/files/<key>?download`).

Removing an attachment takes it out of albireo and deletes its file from the bucket.

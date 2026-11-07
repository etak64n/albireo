---
title: "Attachments"
description: "Files that go with a video, such as its slides."
---

An attachment is a file that goes with a video, such as its slides or notes (worker/attachments.ts, src/components/Attachments.tsx).
A file of any type can be attached, up to 500 MiB, with a name of at most 255 characters.

- The browser uploads the file straight to the bucket with a presigned PUT, then commits it. The Worker checks that the file is in the bucket and records its size.
- The Worker picks the content type from the file extension. HTML, SVG, and unknown types are stored as `application/octet-stream`, so that no uploaded file runs as a page.

The Preview button opens the file over the page (src/components/AttachmentPreview.tsx).

- PDF: every page, drawn by pdf.js through react-pdf. Unlike a PDF in a frame, this also shows every page on iPhone and iPad.
- PowerPoint (.pptx and .ppt): @extend-ai/react-pptx. albireo serves its WebAssembly parser itself, so the file goes to no other site.
- Markdown: react-markdown with GitHub's tables and task lists (remark-gfm). HTML in the file stays text.
- Text and CSV: as text
- PNG, JPEG, GIF, and WebP: as images

Word, Excel, and other files have no preview, and they download only.
Each viewer loads when a file of its kind opens, so the video page stays light.

The Download button saves the file under its name.
Not every storage service honors the file name in a signed URL, and the local bucket of `cf dev` ignores it.

So the browser reads the file first, then saves it under its name itself (src/lib/download.ts).
When the browser cannot read the file, it opens the signed URL instead.

Removing an attachment takes it out of albireo, and the file stays in the bucket.

---
title: "Upload"
description: "How videos go up, from the browser through albireo to the bucket."
---

Upload in the sidebar opens the upload page (src/pages/UploadPage.tsx).
There you choose the series that the videos join, or none, and then drop video files on the page or choose them with Choose files.
The menu of series lists the series from the one updated last. With more than 10 series, it has a search field at its top (src/components/ui/select.tsx).
The Upload button on the page of a series opens the upload page with that series chosen.

Video files dropped on any other page join the queue too (src/uploads.tsx): on the page of a series, they join that series, and elsewhere no series.
A file must have a `video/*` content type (server/src/api/videos.rs, `is_video_type`).
Files of other types stay out, and the upload panel names them.

## The queue

The videos join a queue and go up one at a time (src/uploads.tsx).

- The files that you choose or drop together join the end of the queue in the order of their names. A number in a name counts by its value, so "Day 2" comes before "Day 10" (src/lib/upload-queue.ts).
- Files that you add while videos upload join the end of the queue.
- The upload panel shows each video with its state: waiting, its progress, uploaded, or failed with the reason. You can cancel one video, or every video at once.
- A video that fails stays in the panel with the reason, and the next video starts. To try it again, choose the file again.
- When the queue runs out, the uploaded videos leave the panel. The failed ones stay until you dismiss them.
- On the page of a series, the videos that you add become the last episodes of that series, in the order of the queue. Each video joins the series whose page was open when you added it.
- The queue keeps running while you move to other pages. The browser asks before you close the tab while videos wait or upload, because closing it stops the queue.

## One video

- The file name without its extension becomes the title (src/lib/format.ts, `titleFromFileName`).
- Before the upload, the browser reads the duration and the resolution of the video (src/lib/media.ts).
- The browser also takes a thumbnail. The thumbnail is a JPEG frame from 10% into the video, at most 300 seconds in, at most 640 pixels wide (src/lib/media.ts).
- albireo starts a multipart upload in the bucket: a way to send one file in several parts, each of at least 16 MiB, which the bucket joins into one object at the end (server/src/shared.rs, `plan_parts`).
- The browser sends 4 parts at a time to albireo, and tries each part up to 3 times (src/lib/upload.ts). albireo passes each part on to the bucket as it arrives, so it never holds a whole part in memory (server/src/storage.rs).
- After the last part, albireo completes the upload. It then checks that the stored object has the size that the browser announced (server/src/api/videos.rs).
- When you cancel a video, albireo aborts its multipart upload. Only the person who started an upload, or an admin, continues or cancels it.

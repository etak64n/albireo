---
title: "Upload"
description: "How a video goes up, straight from the browser to the bucket."
---

You drop a video file anywhere on the page, or press Upload in the header to select a file (src/uploads.tsx, src/components/VideoUpload.tsx).
The file must have a `video/*` content type (worker/app.ts, `VIDEO_CONTENT_TYPE`).

- The file name without its extension becomes the title (src/lib/format.ts, `titleFromFileName`).
- Before the upload, the browser reads the duration and the resolution of the video (src/lib/media.ts).
- The browser also takes a thumbnail. The thumbnail is a JPEG frame from 10% into the video, at most 300 seconds in, at most 640 pixels wide (src/lib/media.ts).
- The browser sends 4 parts at a time and tries each part up to 3 times. You can cancel an upload, and the Worker then aborts the multipart upload (src/lib/upload.ts).
- After the last part, the Worker completes the upload. It then checks that the stored object has the size that the browser announced (worker/app.ts).
- On the page of a series, the uploaded video becomes the last episode of that series.
- The upload keeps running while you move to other pages. The browser asks before you close the tab during an upload, because closing it stops the upload (src/uploads.tsx).

---
title: "People and permissions"
description: "Who signs in, and who can do what."
---

Everyone who signs in through Access gets a profile in D1, under the lowercase email that Access reports (worker/app.ts, worker/users.ts).
The first request creates the profile, with the part of the email before `@` as the display name.

People can do these things (worker/app.ts, header comment).

- Everyone who signs in watches every video, uploads videos, rates them, and comments on them.
- A person edits the videos that they uploaded and the series that they created.
- Admins edit every video and every series. The `admins` setting lists them by email.
- A comment can be deleted by its author, the uploader of the video, and admins.
- The uploader of a video and admins attach files to it and remove them. Everyone previews and downloads them.

An Access token without an email, such as a service token, gets a 401 answer, because albireo needs a person behind every request.

---
title: "People and sign-in"
description: "Signing in, the first admin, invitations, roles, removing people, passwords, and sessions."
---

albireo serves the people whom an admin invited.
Each person signs in with an email and a password, and everything that they do carries their name.

## Sign in

The sign-in page asks for an email and a password (src/pages/SignInPages.tsx, server/src/api/account.rs).

- A session lasts 30 days after its last request, so a person who uses albireo stays signed in (server/src/auth.rs). Each browser has a session of its own.
- Ten sign-ins in a row with a wrong password lock the account for 15 minutes. The page says so, and the right password works again after the lock.
- albireo keeps each password as an Argon2id hash, a slow one-way function, so the database never holds a password itself.
- The cookie of a session is `HttpOnly`, so no script reads it, and `SameSite=Lax`, so the browser leaves it out of the requests that pages of other sites send.

## The first admin

While albireo has nobody, it writes a setup code to its log each time it starts, and every page asks for the code with the account of the first admin (server/src/main.rs).

- The code is two groups of four letters and digits, such as `7KQ4-M2XW`. It also works in lowercase and without the hyphen.
- The database keeps a hash of each code, so each container that serves the library writes a code of its own, and any of them works.
- Once the first admin exists, the codes stop working, and albireo writes no more.

## Invite people

Admins invite people on the People page (`/settings/people`), which the menu under their picture opens (src/pages/PeoplePage.tsx).

1. Choose the role of the person: Member or Admin.
2. Choose Create invitation link. The page shows a link such as `https://videos.example.com/join/<token>`, with Copy.
3. Send the link to the person, such as in a chat.

The person opens the link, enters their email, display name, and password, and is signed in.

- A link works once, for 7 days.
- albireo keeps only a hash of the link, so the page shows a link only when it is made.
- Invitations lists the links that nobody has used, with who made each one and when it expires. Delete stops a link from working.

## Roles

Each person is an admin or a member (server/src/api/videos.rs, server/src/api/library.rs).

1. A member watches every video, uploads videos, rates and comments on them, and makes series and playlists. A member edits and deletes what they made.
2. An admin does everything that a member does, edits and deletes everything, invites people, changes their roles, and removes them.

The details of what a member changes are these.

- The uploader of a video edits it, deletes it, and changes its thumbnail and its attachments.
- The creator of a series edits it, reorders its episodes, and deletes it. The uploader of a video also takes the video out of any series.
- The owner of a playlist adds, reorders, and removes its videos, edits it, and deletes it.
- The author of a comment, the uploader of the video, and admins delete a comment.

Everyone sees the whole library: every video, series, and playlist, and the channel of every person.
The watch history of each person is theirs alone.

The menu on a row of the People page makes a member an admin, or an admin a member.
albireo keeps at least one admin, so the last admin cannot become a member.

## Remove people

An admin removes a person with Remove in the menu on their row of the People page.

- The person can no longer sign in, and their sessions end at once.
- Their videos, comments, ratings, series, and playlists stay, under their name.
- A new invitation that they accept with the same email brings them back as the same person, with everything that they made.
- An admin cannot remove themselves, and albireo keeps at least one admin.

## Password and sessions

The account page (`/settings/account`) changes the password and lists the sessions (src/pages/AccountPage.tsx).

- A new password has 10 to 200 characters. The change asks for the current password, and ends the sessions of every other browser.
- Sessions lists each browser that is signed in as the person: the browser and the operating system, when it signed in, and its last request. Log out on a row ends that session.
- Log out in the menu under the picture ends the session of this browser.

albireo sends no email, so it has no reset of a forgotten password.
An admin removes the person and invites them again: they come back as the same person, with a new password.

## Requests from other sites

A page of another site can make a browser send requests to albireo, as a form that posts to it does.
albireo refuses every change that such a request asks for (server/src/api/mod.rs).

- Browsers mark each request with the `Sec-Fetch-Site` header: `same-origin` for the pages of albireo, and `cross-site` or `same-site` for the pages of other sites.
- albireo answers 403 to a request that changes anything and carries `cross-site` or `same-site`. This includes a sign-in, so another site cannot sign a browser in.
- Reads need a session, and another site cannot read the answers: the browser keeps them from its scripts.

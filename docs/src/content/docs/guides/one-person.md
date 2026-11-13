---
title: "One person, no sign-in"
description: "Who albireo serves, and how to keep others out."
---

albireo serves one person and has no sign-in.
Everyone who reaches it acts as that person, so keeping others out is the work of the network around albireo.

## The one person

When albireo starts for the first time, it adds one person to its database, with the name Me (server/users.ts).
Every request acts as that person: the uploads, the comments, the ratings, the history, and the playlists are theirs (server/app.ts).

- The person can edit and delete every video, series, playlist, comment, and attachment.
- The channel of the person shows their name, bio, and picture, which they change in the channel settings.
- albireo keeps no passwords, sessions, or cookies.

## Keep others out

Anyone who reaches the port of albireo can watch, upload, and delete everything, so choose where albireo listens.

1. On one machine: publish the port on 127.0.0.1, such as `127.0.0.1:8080:8080`, and open albireo on that machine.
2. On a private network, such as a VPN between your devices: publish the port on the address of that network only.
3. From the internet: put a reverse proxy in front of albireo that serves HTTPS and signs people in, and publish the port of albireo on 127.0.0.1, so that only the proxy reaches it.

## Requests from other sites

A page of another site can make your browser send requests to albireo, as a form that posts to it does.
albireo refuses every change that such a request asks for (server/app.ts).

- Browsers mark each request with the `Sec-Fetch-Site` header: `same-origin` for the pages of albireo, and `cross-site` or `same-site` for the pages of other sites.
- albireo answers 403 to a request that changes anything and carries `cross-site` or `same-site`.
- Reads stay open, since another site cannot read the answers: the browser keeps them from its scripts.
- A request without the header, such as one from curl, passes, since it comes from no page.

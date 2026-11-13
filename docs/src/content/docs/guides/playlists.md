---
title: "Playlists"
description: "Lists of videos that each person makes, with any video in any number of them."
---

A playlist is a list of videos that a person makes, such as the talks to watch again (server/src/api/library.rs, server/src/repo/library.rs, src/pages/PlaylistPage.tsx).
Unlike a series, a playlist holds anyone's videos, and a video can be in any number of playlists.

- Everyone sees every playlist. Playlists (`/playlists`) lists your playlists from the one changed last, and Everyone in its Owner filter lists the playlists of everyone (`/playlists?owner=everyone`). The channel of a person lists their playlists.
- The sidebar lists the 5 playlists of yours changed last, and Show all under them opens Playlists. New playlist, at the end of them, opens a dialog that makes a playlist from its title.
- Add to playlist, beside the title of a video, lists your playlists from the one changed last, each with a box that shows whether it holds the video. Checking a box puts the video at the end of that playlist, and clearing it takes the video out. New playlist in the same list makes a playlist with the video in it. With more than 10 playlists, the list has a search field at its top.
- The owner of a playlist and admins rename it, move its videos up and down, take videos out, and delete it, all from its page. Deleting a playlist keeps its videos in the library.
- Play all, on the page of a playlist, plays its videos from the first. While a video plays in a playlist, its address ends with `?playlist=<ID>`, the video page lists the videos of the playlist and marks the one that plays, and the next video of the playlist starts when one ends.
- Deleting a video takes it out of every playlist.

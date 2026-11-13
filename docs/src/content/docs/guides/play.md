---
title: "Play"
description: "The video page and its player."
---

The video page has six parts, from the top (src/pages/VideoPage.tsx).

1. The player
2. The videos of the playlist, in a list that marks the video that plays, when the video plays in a playlist
3. The episodes of the series, in a list that marks the episode that plays, when the video is in a series
4. The title with Add to playlist, the uploader, and the rating
5. The length, the resolution, the date, and the description
6. The attachments and the comments

When a video ends, the next video of its playlist starts, or without a playlist, the next episode of its series.

The player is Video.js 10 with its neutral skin (src/components/VideoPlayer.tsx).
It changes the playback speed and plays in picture-in-picture and in full screen.

These keys work while the player has focus.

- Space or k: play and pause
- j and l, or the left and right arrows: go back or ahead 10 seconds
- m: mute
- f: full screen
- 0 to 9: jump to that tenth of the video
- < and >: slower and faster

The player takes the corners and the accent color of the theme (src/styles.css, `.albireo-player`).
Video.js loads only with a video page, so the other pages open without it.

- albireo streams the video from the bucket, and passes on the ranges that the player asks for, so the player starts at once and jumps to any point (server/src/api/videos.rs, `/api/files/`).
- When playback fails, as while albireo restarts, the player loads the video again and resumes where it stopped.
- The player tries again at most once a minute, so a video that cannot play cannot cause a loop (src/components/VideoPlayer.tsx).

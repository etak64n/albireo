---
title: "Play"
description: "The video page and its player."
---

The video page has five parts, from the top (src/pages/VideoPage.tsx).

1. The player
2. The series bar, with the previous and the next episodes, when the video is in a series
3. The title, the uploader, and the rating
4. The length, the resolution, the date, and the description
5. The attachments and the comments

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

- When playback fails, for example because the URL expired, the player asks for a new URL and resumes where it stopped.
- The player asks at most once a minute, so a broken URL cannot cause a loop (src/components/VideoPlayer.tsx).

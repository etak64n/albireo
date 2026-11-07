---
title: "Home and lists"
description: "The home page, all videos, and the history."
---

albireo has three lists of videos.

1. Home
2. All videos
3. History

Home (`/`) recommends videos to the person who signed in. The first video shows large, and the rest follow below it.
The recommendations come in this order, up to 48 videos (worker/app.ts, `recommend`).

1. In each series that the person is watching, the next episode that they have not watched, from the series watched last, for up to 8 series
2. The videos that they have not watched: first those of the series and the uploaders that they watched before, then the rest from the newest
3. The videos that they watched, from the one watched longest ago

All videos (`/videos`) lists every series, then every video from the newest, 48 per page (worker/videos.ts, shared/api.ts).

History (`/history`) lists the videos that the person watched, from the last watched.
The player records a video when its playback starts, and each person sees only their own history (worker/app.ts).

The sidebar on the left links to the three lists and to every series.
On screens narrower than 1024px, the sidebar hides, and the menu button in the upper left corner opens it over the page.
Dates show as YYYY/MM/DD (src/lib/format.ts, `formatDate`).

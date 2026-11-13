---
title: "Series"
description: "Videos grouped as numbered episodes."
---

A series groups videos as numbered episodes, such as the recordings of a course (server/src/api/library.rs, src/pages/SeriesPage.tsx).

- Everyone sees every series, and a video belongs to at most one series. A list of videos that holds any video, in any number of lists, is a [playlist](../playlists/).
- Series (`/series`) lists every series, from the one changed last. Show all, under the 5 series that the sidebar lists, opens it.
- New series, at the end of the series in the sidebar, opens a dialog that makes a series from its title. The new series opens, and comes first in the sidebar.
- The episodes keep the order in which they joined. The creator of the series and admins move them up and down.
- Anyone can add their own videos to any series: with Add to series beside the title of a video, from the edit page of a video, or by uploading from the page of the series. Upload, at the right under the episodes of the series, opens the upload page with the series chosen. Videos dropped on the page of the series join it at once.
- Add to series lists No series and every series, from the one changed last. Choosing a series makes the video its last episode, out of the series that the video was in, and No series takes the video out of its series. New series in the same list makes a series with the video in it. With more than 10 series, the list has a search field at its top (src/components/AddToSeries.tsx).
- The page of a series without videos says so, with a button that uploads videos into it.
- The creator of the series, admins, and the uploader of the video can take a video out of a series. The video stays in the library.
- The creator of the series and admins delete it from its page. Its videos stay in the library, out of any series.
- When an episode ends, the next one starts. The video page lists every episode of the series and marks the one that plays.

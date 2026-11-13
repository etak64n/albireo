---
title: "Home and lists"
description: "The home page, all videos, and the history."
---

albireo has three lists of videos.

1. Home
2. All videos
3. History

Home (`/`) shows up to 48 videos in a grid, without a title (src/pages/HomePage.tsx).
When the page loads for the first time in 15 minutes, as when you open albireo or reload it, Home shows the recommendations. When the page loads again before then, Home shows videos at random from the whole library.
The browser keeps the time of the last recommendations, so each browser counts its own 15 minutes, and the database keeps nothing for it.
Coming back to Home from another page shows the same videos again, and asks albireo nothing. The list loads again only when the page loads, and when an upload finishes.

The recommendations come from the newest 100 videos and the last 100 videos that you watched, in this order, up to 48 videos (server/app.ts, `recommend`).

1. In each series that you are watching, the next episode that you have not watched, from the series watched last, for up to 8 series
2. The videos that you have not watched: first those of the series that you watched before, then the rest from the newest
3. The videos that you watched, from the one watched longest ago

The random videos start at a random place among the IDs of the videos, which are random, and take the next ready videos in the order of their IDs, then shuffle them. A load of the list reads about 48 rows of the database (server/videos.ts, `sampleReady`).

All videos (`/videos`) lists every video, 48 per page, in the order that you choose: from the newest, from the oldest, or from the highest rated (server/videos.ts, shared/api.ts).
The highest rated come by their stars, from the newest among equal stars, and the videos that you did not rate come last.
The order stays in the address, such as `/videos?sort=rating`.

Each video in a list shows its picture, its title, the uploader and the date, and its series. At the right end of the line of the uploader and the date, outlined stars filled as far as the rating, and icons with the numbers of comments and attachments in a badge, a gray 0 when there are none (src/components/VideoCard.tsx). On a card too narrow for both, the stars and the icons move under the uploader and the date.
The videos table keeps the numbers of comments and attachments, which triggers update, so a list reads no comments or attachments (migrations/0001_create_tables.sql).

The lists load their next page by themselves as you scroll near the end, as do the search results, the videos of a person, and the comments (src/components/LoadMore.tsx).

Before the library has its first video, Home and All videos say that it has none yet, with a button that uploads one (src/components/EmptyLibrary.tsx).

History (`/history`) lists the videos that you watched, from the last watched.
The player records a video when its playback starts (server/app.ts).

The sidebar on the left links to the three lists, to the upload page, to the series, and to the playlists.
Under the headings Series and Playlists, the sidebar lists the 5 changed last, a series by its episodes or its title and description, so it stays short however many there are. Show all under them opens the page that lists every series (`/series`) or the playlists (`/playlists`) (src/components/Shell.tsx).
On screens narrower than 1024px, the sidebar hides, and the menu button in the upper left corner opens it over the page.
Dates show as YYYY/MM/DD (src/lib/format.ts, `formatDate`).

A change that you make shows a short message in the lower right corner, or along the bottom of a narrow screen (src/components/ui/toast.tsx): an upload that finishes, with Open to go to the video, a save, a deletion, a new series or playlist, a video that joins or leaves a playlist or a series, an attachment, and a comment.
A success shows for 3 seconds with a green mark. A failure shows for 6 seconds with a red mark and the reason, also for a rating or a move. Ratings and moves of videos up and down that succeed show in place, without a message.

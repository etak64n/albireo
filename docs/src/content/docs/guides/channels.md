---
title: "Channel and account"
description: "Your channel, its settings, and the account page."
---

Your channel (`/users/<ID>`) shows your picture, name, and bio, with your series, playlists, and videos (src/pages/UserPage.tsx).
The person of albireo starts with the name Me, no bio, and no picture (server/users.ts).

The channel settings (`/settings/channel`) change the picture, the display name, and the bio of your channel (src/pages/ChannelSettingsPage.tsx).

- The display name has 1 to 50 characters, and the bio at most 1,000.
- You move and zoom the picture to choose a circle. The browser turns it into a JPEG of 256 by 256 pixels (src/lib/image.ts).
- Removing the picture brings back the default person icon, and deletes the picture from the bucket.

The account page (`/settings/account`) has two sections (src/pages/AccountPage.tsx).

- Details: the day that albireo added you, which is the day that it first started
- Preferences: the language of the app, English or Japanese

The app starts in English.
A choice of language saves at once, and the app switches to it without a reload: the menus, the pages, the messages of the browser, and the controls of the player (src/i18n.ts).
Errors that the API returns, such as a refused request, stay in English.

The menu under your picture in the header links to your channel, to the channel settings, and to the account page.

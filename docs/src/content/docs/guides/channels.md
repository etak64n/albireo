---
title: "Channel and account"
description: "Your channel, its settings, and the account page."
---

The channel of each person (`/users/<ID>`) shows their picture, name, and bio, with their series, playlists, and videos (src/pages/UserPage.tsx).
A person starts with the display name that they gave when they joined, no bio, and no picture.

The channel settings (`/settings/channel`) change the picture, the display name, and the bio of your channel (src/pages/ChannelSettingsPage.tsx).

- The display name has 1 to 50 characters, and the bio at most 1,000.
- You move and zoom the picture to choose a circle. The browser turns it into a JPEG of 256 by 256 pixels (src/lib/image.ts).
- Removing the picture brings back the default person icon, and deletes the picture from the bucket.

The account page (`/settings/account`) has four sections, which only you see (src/pages/AccountPage.tsx).

1. Details: your email, your role, and the day that you joined
2. Preferences: the language of the app, English or Japanese
3. Password: the change of your password
4. Sessions: the browsers that are signed in as you, each with Log out

[People and sign-in](../people/) describes the password and the sessions.

Before a person signs in, the pages speak the first language of the browser that albireo has, or English.
After the sign-in, they speak the language that the person chose.
A choice of language saves at once, and the app switches to it without a reload: the menus, the pages, the messages of the browser, and the controls of the player (src/i18n.ts).
Errors that the API returns, such as a refused request, stay in English.

The menu under your picture in the header links to your channel, to the channel settings, and to the account page.
For admins, it also links to the People page.
Its last item, Log out, ends the session of this browser.

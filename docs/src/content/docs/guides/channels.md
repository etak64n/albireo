---
title: "Channels"
description: "The channel of each person, the channel settings, and the account page."
---

Each person has a channel (`/users/<ID>`) with their picture, name, bio, series, and videos (src/pages/UserPage.tsx).

The channel settings (`/settings/channel`) change the picture, the display name, and the bio that others see on your channel (src/pages/ChannelSettingsPage.tsx).

- The display name has 1 to 50 characters, and the bio at most 1,000.
- You move and zoom the picture to choose a circle. The browser turns it into a JPEG of 256 by 256 pixels (src/lib/image.ts).
- Removing the picture brings back the default person icon. The file stays in the bucket.

The account page (`/settings/account`) shows what only you see, in five sections (src/pages/AccountPage.tsx).

- Details: your email, your role, Admin or Member, and the day you joined, which is the day of your first sign-in
- Preferences: the language of the app, English or Japanese
- Sign-in: the login method of the session, such as a passkey, and the time of the sign-in
- Passkeys: the passkeys that you registered with Access, with the day each was added and the last time it was used
- Sessions: the sessions that albireo saw, with the browser and the operating system, the place, the time of the sign-in, and the last request. The session of this device carries a mark.

The token that Access adds to each request leaves out the login method and the passkeys, so the Worker asks Access for the identity of the session (`/cdn-cgi/access/get-identity` on the team domain).
A Worker cannot list the sessions that Access keeps, so albireo writes down each Access token that it sees as a session in D1 (worker/sessions.ts).
It stores the SHA-256 of the token, never the token, and writes the last request at most every five minutes.
Logging out, from the menu or from the account page, removes the session of this device from the list. albireo cannot end the other sessions: they last until Access ends them.
Under `cf dev`, where Access does not run, the page has only Details and Preferences.

Each person chooses their own language, and new people start in English.
A choice saves at once, and the app switches to it without a reload: the menus, the pages, the messages of the browser, and the controls of the player (src/i18n.ts).
Errors that the API returns, such as a refused request, stay in English.

The menu under your picture in the header links to your channel, to the channel settings, to the account page, and, with Access, to logging out.

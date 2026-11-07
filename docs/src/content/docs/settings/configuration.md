---
title: "Configuration"
description: "Every setting of albireo.config.ts."
---

albireo.config.ts holds every setting of one deployment.
Storage keys do not go in this file: they go in `.env` for `cf dev`, and in `.env.production` for `pnpm stack:deploy`.

## Example

This is albireo.config.example.ts. Copy it to albireo.config.ts and replace every value.

```ts
// Settings of this albireo deployment.
//
// Copy this file to albireo.config.ts and replace every value. Git ignores
// albireo.config.ts. Storage access keys are secrets, so they do not go here:
// see .env.example.

import { defineAlbireoConfig } from "./config/settings.ts";

export default defineAlbireoConfig({
  // Cloudflare account that owns the Worker, the domain, and the D1 database
  accountId: "0123456789abcdef0123456789abcdef",
  workerName: "albireo",
  // D1 database that stores the list of videos. `pnpm stack:deploy` creates it
  // when the account has no database of this name.
  database: {
    name: "albireo",
  },
  // Lifetime of the signed URLs that the browser uses to upload and play videos.
  // The player gets a new URL when one expires, but a lifetime longer than
  // your longest video avoids that pause.
  signedUrlTtlSeconds: 21600,
  // People who can edit every video and every series, by the email that Cloudflare
  // Access reports. Everyone else edits only the videos and series of their own.
  admins: ["admin@example.com"],
  // How the library looks: its name, and the theme folder with theme.css (colors,
  // corners, shadows, and fonts) and logo.svg. albireo includes ./themes/light and
  // ./themes/dark, and a theme folder of your own works the same way.
  appearance: {
    siteName: "albireo",
    theme: "./themes/light",
  },
  production: {
    domain: "videos.example.com",
    storage: {
      type: "s3",
      endpoint: "https://s3.example.com",
      region: "us-east-1",
      bucket: "albireo-videos",
      urlStyle: "path",
    },
    // Cloudflare Access, which lets only these people open albireo
    access: {
      // The team domain of your Zero Trust organization
      teamDomain: "https://example.cloudflareaccess.com",
      // The emails that may sign in. They include every admin.
      allow: ["admin@example.com"],
      // The login methods of your Zero Trust organization that the sign-in page offers,
      // by type, such as "onetimepin", "github", or "passkeys"
      loginMethods: ["onetimepin"],
    },
  },
  // `cf dev` serves albireo on localhost without Cloudflare Access.
  // "local-r2" keeps videos in a simulated R2 bucket on this machine and needs
  // no keys. To develop against real storage, write an "s3" storage here as in
  // production, with a bucket that holds no production videos.
  development: {
    // Cloudflare Access does not run on this machine, so cf dev signs you in as this email.
    signInAs: "admin@example.com",
    storage: {
      type: "local-r2",
    },
  },
});
```

## Settings

config/settings.ts validates the settings.
Every setting is required, and a key that albireo does not read is an error, which catches misspelled keys.

- `accountId`
  - The Cloudflare account that owns the Worker, the domain, and the D1 database
  - 32 lowercase hexadecimal characters
- `workerName`
  - The name of the Worker
  - Lowercase letters, digits, and hyphens, at most 63 characters, starting and ending with a letter or a digit
- `database.name`
  - The name of the D1 database. `pnpm stack:deploy` finds the database of this name in the account, or creates it.
  - Letters, digits, underscores, and hyphens, 1 to 64 characters
- `signedUrlTtlSeconds`
  - The lifetime of presigned URLs, in seconds
  - From 60 to 604800. 604800 seconds, seven days, is the longest that Signature Version 4 allows.
  - A lifetime longer than your longest video avoids the pause when the player gets a new URL.
- `admins`
  - The people who edit every video and every series, by the email that Access reports
  - A list of lowercase email addresses. The list may be empty.
  - Every admin must also be in `production.access.allow`, so that they can sign in.
- `appearance.siteName`
  - The name in the sidebar and in the title of every page
  - 1 to 40 characters that do not start or end with a space
- `appearance.theme`
  - The theme folder, relative to the project root. [Themes](../themes/) describes its files.
  - A path that starts with `./` or `../`, without spaces
- `production.domain`
  - The hostname that serves albireo, in lowercase, without a scheme or a path
  - Its zone must be in the same Cloudflare account.
- `production.storage.type`
  - Always `"s3"`. The `"local-r2"` bucket exists only in `cf dev`.
- `production.storage.endpoint`
  - The `https://` origin of the S3-compatible API, without a path
- `production.storage.region`
  - The region name that the storage service expects in request signatures
- `production.storage.bucket`
  - The bucket that holds the videos, the thumbnails, the pictures, and the attachments
  - 3 to 63 lowercase letters, digits, dots, and hyphens, starting and ending with a letter or a digit
- `production.storage.urlStyle`
  - `"path"` puts the bucket name in the URL path.
  - `"virtual-hosted"` puts the bucket name in the hostname.
- `production.access.teamDomain`
  - The `https://` origin of your Access team domain
- `production.access.allow`
  - The people who may sign in, by email. `pnpm stack:deploy` gives the domain an Access application whose only policy allows them.
  - A list of one or more lowercase email addresses, every admin included
- `production.access.loginMethods`
  - The login methods that the sign-in page offers. The Access application allows only these.
  - A list of one or more login methods of your Zero Trust organization, each by its type, such as `"onetimepin"`, `"github"`, or `"passkeys"`. When the organization has more than one login method of a type, write the ID of the one to allow.
  - `pnpm stack:deploy` looks them up in the organization, and stops before it changes anything if one of them does not exist. `pnpm exec cf zero-trust identity-providers list` lists the type and the ID of each login method.
- `development.signInAs`
  - The person that `cf dev` signs in, because Access does not run on your machine
  - A lowercase email address
- `development.storage`
  - `{ type: "local-r2" }`, or an `"s3"` storage written like `production.storage`
  - An `"s3"` endpoint here may also be an `http://` origin on localhost.

cloudflare.config.ts turns these settings into the Worker configuration that `cf` reads.
A deployment does not edit cloudflare.config.ts.

---
title: "Try it locally"
description: "Run albireo on your machine without a Cloudflare account or a bucket."
---

You can run albireo on your machine with Node.js and pnpm alone. You need no Cloudflare account and no bucket.

albireo needs Node.js ^22.23.0, ^24.22.0, or ^26.12.0 (package.json, `engines`), and the pnpm version in package.json (`packageManager`).
The project installs the Cloudflare CLI, `cf`, as a development dependency, so you run it with `pnpm exec cf`.

```bash
# Install the dependency versions that pnpm-lock.yaml records
pnpm install

# Create your settings from the example. The example values work locally as they are.
cp albireo.config.example.ts albireo.config.ts

# Create the tables in the local D1 database that cf dev uses
pnpm db:migrate:local

# Start the dev server. Open the address that it prints, http://localhost:5173 by default.
pnpm exec cf dev
```

The example values work locally because `cf dev` needs none of the production values.
The example sets the development storage to `"local-r2"`, a bucket that `cf dev` keeps on your machine.

`cf dev` signs you in as `development.signInAs`, admin@example.com in the example.
The example also lists that email in `admins`, so you can edit everything on your machine.

> Note: albireo pins beta versions of the Cloudflare CLI (1.0.0-beta.27) and the Cloudflare Vite plugin (2.0.0-beta.v.11) (package.json).

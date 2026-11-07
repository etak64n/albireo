---
title: "Deploy"
description: "Deploy albireo to your own domain as one stack."
---

This page deploys albireo to your own domain. It lists what you need first, then the steps in order.

## What you need

You need four things.

1. A Cloudflare account that also holds the zone of your domain (config/settings.ts, `production.domain`)
2. A Zero Trust organization in that account, which runs the sign-in of Cloudflare Access. `pnpm stack:deploy` reads its team domain.
3. An S3-compatible bucket that supports Signature Version 4 presigned URLs, multipart uploads, and CORS
4. An access key for that bucket

CORS (Cross-Origin Resource Sharing) is the browser rule that decides which other sites a page may send requests to.
The bucket needs CORS settings because the albireo page uploads files to the bucket and reads attachments from it, and the bucket has another origin.

Give the access key permission to read and write objects in this bucket only.
The Worker uses the key only to sign reads, uploads, and multipart operations, and albireo never deletes objects, so the key needs nothing more.

## The stack

albireo deploys as one stack, as in AWS CloudFormation: one command creates or updates every Cloudflare resource that the settings describe, and one command deletes them all.

A stack has three resources.

- The D1 database of `database.name`, which keeps the library
- The Access application of `production.domain`, whose only policy allows the emails in `production.access.allow`, and whose sign-in page offers the login methods in `production.access.loginMethods`
- The Worker, which serves the browser app and the API on `production.domain`

Each resource carries the tag `albireo.stack=<workerName>` (Cloudflare Resource Tagging), so Cloudflare keeps the list of the resources, and your machine keeps no state.
A resource that carries the tag of another stack is never taken over: the deploy stops before it changes anything.
The bucket stays outside the stack, because it can be at any S3-compatible provider.

Resource Tagging is in public beta at Cloudflare.

## Steps

The deployment has five steps.

1. Sign in the CLI
2. Write the settings
3. Set CORS on the bucket
4. Write the keys
5. Deploy the stack

Step 1: sign in the CLI to your Cloudflare account.

```bash
# Sign the Cloudflare CLI in to your account. The commands in the next steps use this sign-in.
pnpm exec cf auth login
```

Step 2: copy the example settings, and fill in every value.
Commands that only call the Cloudflare API read the account from `accountId` (cloudflare.config.ts, header comment).

```bash
# Create your settings from the example. Git ignores albireo.config.ts.
cp albireo.config.example.ts albireo.config.ts
```

In `production.access.allow`, write the emails of the people who may sign in, every admin included: Access lets in only these people.
In `production.access.loginMethods`, write `"all"` to offer every login method of your organization on the sign-in page, or a list of the ones to offer, by type, such as `"passkeys"`.
Zero Trust > Integrations > Identity providers in the Cloudflare dashboard lists the login methods of your organization, and `pnpm stack:deploy` stops if the list names one that the organization lacks.
[Configuration](../../settings/configuration/) describes every setting.

Step 3: set CORS on the bucket with the rules in examples/bucket-cors.json.
Replace `https://videos.example.com` in the file with your domain.

```jsonc
{
  "CORSRules": [
    {
      // The albireo page on your domain, and the default address of cf dev.
      // Keep http://localhost:5173 only on a bucket that you use for development.
      "AllowedOrigins": ["https://videos.example.com", "http://localhost:5173"],
      // GET plays videos and reads attachments for previews and downloads.
      // PUT uploads the parts of videos, the thumbnails, the pictures, and the attachments.
      "AllowedMethods": ["GET", "HEAD", "PUT"],
      // The uploads of thumbnails, pictures, and attachments sign their Content-Type,
      // so the browser must send that header.
      "AllowedHeaders": ["content-type"],
      // The browser reads the ETag of each uploaded part. Completing the upload needs every ETag.
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3600
    }
  ]
}
```

The file holds the same rules without the comments, because JSON does not allow comments.
It uses the CORS format of the S3 API, which the AWS CLI accepts.

If your storage service has its own way to set CORS, apply the same rules with it.

```bash
# Apply the CORS rules to the bucket with the AWS CLI.
# --endpoint-url                  : the S3-compatible API of your storage service (production.storage.endpoint)
# --bucket                        : the bucket that holds the videos (production.storage.bucket)
# --cors-configuration file://... : the rules to apply, read from the file
aws s3api put-bucket-cors \
  --endpoint-url https://s3.example.com \
  --bucket albireo-videos \
  --cors-configuration file://examples/bucket-cors.json
```

Step 4: write the access key in `.env.production`, with the names in `.env.example`.

```dotenv
# .env.production: the access key of the production bucket
S3_ACCESS_KEY_ID=your-access-key-id
S3_SECRET_ACCESS_KEY=your-secret-access-key
```

Git ignores `.env` and `.env.*` files (.gitignore).
Keep the keys out of albireo.config.ts: `pnpm stack:deploy` uploads them as Worker secrets, not as plain settings (cloudflare.config.ts, `bindings.secret`).

Step 5: deploy the stack.

```bash
# Create or update the D1 database, the Access application, and the Worker
pnpm stack:deploy
```

`pnpm stack:deploy` does these things in order (stack/stack.ts).

1. Finds the D1 database of `database.name`, or creates it, and applies the files in migrations/ to it
2. Creates the Access application of `production.domain`, or updates it to the settings
3. Deploys the Worker with the keys of `.env.production`, the AUD tag of the Access application, and the ID of the database
4. Tags each resource with the name of the stack

The Access application exists before the Worker serves the domain, so the domain is never served without Access.
`cf deploy` attaches `production.domain` to the Worker (cloudflare.config.ts, `domains`).

Deploy with `pnpm stack:deploy`, not with `cf deploy` alone: a production build needs the ID of the database, which `pnpm stack:deploy` passes in `ALBIREO_DATABASE_ID` (cloudflare.config.ts).

## Update a deployment

Each version of albireo is a release with a tag such as v0.2.0 ([Releases](../../project/releases/)).
Before you update, read the notes of every release after the one you run: they say what a deployment must change, such as the settings.
Then check out the tag of the new release, and deploy the stack again.

```bash
# Fetch the tags of new releases, and switch to the release to deploy
git fetch --tags
git checkout v0.2.0

# Install the dependency versions of that release
pnpm install

# Apply the new migrations, then deploy the new code
pnpm stack:deploy
```

`pnpm stack:deploy` applies the new files in migrations/ before the new code goes live, and it updates the Access application to `production.access.allow` and `production.access.loginMethods`.

## Delete a deployment

`pnpm stack:delete` deletes every resource of the stack.

```bash
# List the resources of the stack, and delete them after you type the stack name
pnpm stack:delete
```

It deletes the Worker first, then the Access application, then the D1 database, and it removes their tags.
Deleting the database erases the library: the titles, the series, the comments, and the history.
The videos stay in the bucket, and the command names the bucket and the keys for you to delete.
A resource that is already gone counts as deleted, so a delete that stopped halfway can run again.

Where nobody can type, such as in CI, pass the stack name with `--confirm`.

```bash
# Delete the stack named albireo without a prompt
pnpm stack:delete --confirm albireo
```

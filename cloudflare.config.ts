// Worker configuration that the Cloudflare CLI (cf) reads.
//
// The values come from albireo.config.ts, so a deployment does not edit this
// file. `cf dev` runs in the "development" mode: it uses the development
// storage and answers localhost without Cloudflare Access. `cf build` and
// `pnpm stack:deploy`, which runs `cf deploy`, use the "production" mode.
// Commands that only call the Cloudflare API, such as `cf d1 list`, load this
// file without a mode and read the production settings, which name the account.

import { bindings, defineConfig } from "cf/config";
import albireoConfig from "./albireo.config.ts";
import { validateSettings, type StorageSettings } from "./config/settings.ts";

// `cf dev` keeps this bucket on this machine and serves it with an S3-compatible
// API at /cdn-cgi/local/r2/s3 on the dev server, so development signs URLs and
// uploads parts as production does. The API accepts these keys for this bucket
// only, and the bucket exists only on this machine, so the keys are not secrets.
const LOCAL_R2 = {
  bucket: "albireo-local",
  accessKeyId: "albireo-local",
  secretAccessKey: "albireo-local-secret",
};

// `cf dev` keeps its D1 database on this machine under this ID, and
// `pnpm db:migrate:local` (package.json) applies the migrations to the same ID.
const LOCAL_D1_ID = "00000000-0000-4000-8000-000000000000";

/**
 * The ID of the production D1 database. `pnpm stack:deploy` finds the database of
 * `database.name`, or creates it, and passes its ID here, so the settings hold no ID.
 */
function productionDatabaseId(): string {
  const id = process.env["ALBIREO_DATABASE_ID"] ?? "";
  if (id === "") {
    throw new Error("Deploy albireo with `pnpm stack:deploy`, which passes the ID of the D1 database in ALBIREO_DATABASE_ID.");
  }
  return id;
}

export default defineConfig(({ mode }) => {
  const settings = validateSettings(albireoConfig);
  if (mode !== undefined && mode !== "development" && mode !== "production") {
    throw new Error(`albireo runs in the "development" or "production" mode, not "${mode}".`);
  }
  const isDevelopment = mode === "development";
  const storage: StorageSettings = isDevelopment ? settings.development.storage : settings.production.storage;

  return {
    accountId: settings.accountId,
    worker: {
      name: settings.workerName,
      entrypoint: "./worker/index.ts",
      compatibilityDate: "2026-11-01",
      domains: [settings.production.domain],
      workersDev: false,
      previewUrls: false,
      observability: { enabled: true },
      // The browser app is static assets. Only /api/* runs the Worker.
      assets: {
        notFoundHandling: "single-page-application",
        runWorkerFirst: ["/api/*"],
      },
      env: {
        // API-only commands run without a mode and need no database ID.
        DB: bindings.d1({
          name: settings.database.name,
          ...(isDevelopment ? { id: LOCAL_D1_ID } : mode === "production" ? { id: productionDatabaseId() } : {}),
        }),
        // "local-development" lets the Worker answer localhost without an Access token.
        AUTH_MODE: bindings.text(isDevelopment ? "local-development" : "cloudflare-access"),
        ...(isDevelopment
          ? {}
          : {
            ACCESS_TEAM_DOMAIN: bindings.text(settings.production.access.teamDomain),
            // The AUD tag of the Access application that `pnpm stack:deploy` creates for the domain.
            ACCESS_AUD: bindings.secret(),
          }),
        SIGNED_URL_TTL_SECONDS: bindings.text(String(settings.signedUrlTtlSeconds)),
        // A JSON list, so that a deployment without admins still has the binding.
        ADMIN_EMAILS: bindings.text(JSON.stringify(settings.admins)),
        // Access does not run under `cf dev`, so the Worker signs in this email instead.
        ...(isDevelopment ? { LOCAL_USER_EMAIL: bindings.text(settings.development.signInAs) } : {}),
        ...(storage.type === "s3"
          ? {
            STORAGE_TYPE: bindings.text("s3"),
            S3_ENDPOINT: bindings.text(storage.endpoint),
            S3_REGION: bindings.text(storage.region),
            S3_BUCKET: bindings.text(storage.bucket),
            S3_URL_STYLE: bindings.text(storage.urlStyle),
            // Secrets: .env for `cf dev`, and .env.production, which `pnpm stack:deploy` uploads.
            S3_ACCESS_KEY_ID: bindings.secret(),
            S3_SECRET_ACCESS_KEY: bindings.secret(),
          }
          : {
            // Only `cf dev` uses this storage. The Worker reaches the bucket through
            // the S3-compatible API, and the binding only makes `cf dev` serve that API.
            STORAGE_TYPE: bindings.text("local-r2"),
            LOCAL_BUCKET: bindings.r2({
              name: LOCAL_R2.bucket,
              dev: {
                experimentalS3Credentials: {
                  accessKeyId: LOCAL_R2.accessKeyId,
                  secretAccessKey: LOCAL_R2.secretAccessKey,
                },
              },
            }),
            S3_REGION: bindings.text("auto"),
            S3_BUCKET: bindings.text(LOCAL_R2.bucket),
            S3_URL_STYLE: bindings.text("path"),
            S3_ACCESS_KEY_ID: bindings.text(LOCAL_R2.accessKeyId),
            S3_SECRET_ACCESS_KEY: bindings.text(LOCAL_R2.secretAccessKey),
          }),
      },
    },
  };
});

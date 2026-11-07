// Entry point of the albireo Worker. Cloudflare serves the browser app from
// static assets and runs this Worker only for /api/* requests.

import { fetchAccessIdentity, remoteKeySet } from "./access.ts";
import { createApp } from "./app.ts";
import { randomId } from "./ids.ts";
import { S3ObjectStore } from "./storage.ts";

export default createApp({
  keySetFor: remoteKeySet,
  fetchIdentity: fetchAccessIdentity,
  objectStoreFor: (config) => new S3ObjectStore(config.storage, config.signedUrlTtlSeconds),
  now: () => new Date(),
  newId: randomId,
});

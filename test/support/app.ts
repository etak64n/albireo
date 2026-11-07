// Builds the API with fakes for Access, the storage service, the clock, and IDs.

import { createApp, type AppDependencies, type IdKind } from "../../worker/app.ts";
import type { Env } from "../../worker/env.ts";
import { ADMIN_EMAIL, AUD, createAccessKeys, TEAM_DOMAIN, VIEWER_EMAIL, type AccessKeys } from "./access.ts";
import { createTestDatabase } from "./d1.ts";
import { MemoryObjectStore } from "./object-store.ts";

export interface TestApp {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  /** Sends a request that carries a valid Access token for viewer@example.com. */
  signedRequest: (path: string, init?: RequestInit) => Promise<Response>;
  /** Sends a request that carries a valid Access token for the email. */
  requestAs: (email: string, path: string, init?: RequestInit) => Promise<Response>;
  env: Env;
  store: MemoryObjectStore;
  access: AccessKeys;
}

export interface TestAppOptions {
  /** Bindings that replace the defaults, which describe S3-compatible storage behind Access. */
  env?: Partial<Env>;
  /** Storage that the app uses. The default is a MemoryObjectStore. */
  objectStoreFor?: AppDependencies["objectStoreFor"];
  /** Answers for the identity of a session. The default is SIGNED_IN_IDENTITY. */
  fetchIdentity?: AppDependencies["fetchIdentity"];
}

/** The identity that Access reports by default: a sign-in with a passkey at 2026-11-07T05:42:45Z. */
export const SIGNED_IN_IDENTITY = {
  idp: { id: "idp-passkeys", type: "passkeys" },
  iat: 1_794_030_165,
  passkeys: [{ id: "passkey-1", name: "1Password", created_at: "2026-11-07T05:42:26.602Z", last_used_at: "2026-11-07T05:42:46.792Z" }],
};

export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const access = await createAccessKeys();
  const store = new MemoryObjectStore();
  let tick = 0;
  const counters = new Map<IdKind, number>();
  const app = createApp({
    keySetFor: () => access.keySet,
    fetchIdentity: options.fetchIdentity ?? (async () => SIGNED_IN_IDENTITY),
    objectStoreFor: options.objectStoreFor ?? (() => store),
    // Each call is one second later, so creation order is unambiguous.
    now: () => {
      tick += 1;
      return new Date(Date.UTC(2026, 10, 4, 0, 0, tick));
    },
    // IDs read as their kind and a counter, such as video00000000001 and user000000000001.
    newId: (kind) => {
      const next = (counters.get(kind) ?? 0) + 1;
      counters.set(kind, next);
      return `${kind}${String(next).padStart(16 - kind.length, "0")}`;
    },
  });
  const env: Env = {
    DB: createTestDatabase(),
    AUTH_MODE: "cloudflare-access",
    ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
    ACCESS_AUD: AUD,
    SIGNED_URL_TTL_SECONDS: "3600",
    ADMIN_EMAILS: JSON.stringify([ADMIN_EMAIL]),
    STORAGE_TYPE: "s3",
    S3_ENDPOINT: "https://s3.example.com",
    S3_REGION: "us-east-1",
    S3_BUCKET: "albireo-videos",
    S3_URL_STYLE: "path",
    S3_ACCESS_KEY_ID: "test-access-key",
    S3_SECRET_ACCESS_KEY: "test-secret-key",
    ...options.env,
  };
  const request = async (path: string, init?: RequestInit) => app.request(path, init, env);
  const requestAs = async (email: string, path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("cf-access-jwt-assertion", await access.sign({ email }));
    return request(path, { ...init, headers });
  };
  const signedRequest = async (path: string, init?: RequestInit) => requestAs(VIEWER_EMAIL, path, init);
  return { request, signedRequest, requestAs, env, store, access };
}

export function json(body: unknown, method = "POST"): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

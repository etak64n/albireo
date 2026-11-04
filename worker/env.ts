// Bindings that cloudflare.config.ts gives the Worker, and the part of the D1
// API that albireo uses. Declaring this subset here lets the tests run the
// same code against an in-memory database.

export interface D1Result<T> {
  results: T[];
  meta: { changes?: number };
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result<unknown>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface Env {
  DB: D1Database;
  AUTH_MODE: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  SIGNED_URL_TTL_SECONDS: string;
  /** JSON list of the lowercase emails of admins. */
  ADMIN_EMAILS: string;
  /** Only under `cf dev`: the email that the Worker signs in, because Access does not run there. */
  LOCAL_USER_EMAIL?: string;
  /** "s3" for S3-compatible storage, or "local-r2" for the local R2 bucket of `cf dev`. */
  STORAGE_TYPE: string;
  /** Only with "s3". The local R2 bucket has its S3-compatible API on the origin of the request. */
  S3_ENDPOINT?: string;
  S3_REGION: string;
  S3_BUCKET: string;
  S3_URL_STYLE: string;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
}

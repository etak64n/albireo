// Reads the Worker bindings into typed configuration. A missing or invalid
// binding stops every API request, so the Worker never runs half configured.

import type { Env } from "./env.ts";

export type AuthMode = "cloudflare-access" | "local-development";

/**
 * Path of the S3-compatible API that `cf dev` serves for its local R2 buckets,
 * on the same origin as the app. Object URLs add the bucket name and the key.
 */
export const LOCAL_R2_S3_PATH = "/cdn-cgi/local/r2/s3";

/** The S3-compatible API that stores videos and thumbnails. */
export interface StorageConfig {
  /** URL of the API. It has a path when the API is the local one of `cf dev`. */
  endpoint: string;
  region: string;
  bucket: string;
  urlStyle: "path" | "virtual-hosted";
  accessKeyId: string;
  secretAccessKey: string;
}

export interface AccessConfig {
  teamDomain: string;
  aud: string;
}

export interface RuntimeConfig {
  authMode: AuthMode;
  access: AccessConfig;
  storage: StorageConfig;
  signedUrlTtlSeconds: number;
  /** Lowercase emails of the people who can edit every video and every series. */
  admins: ReadonlySet<string>;
  /** In local development mode, the email that the Worker signs in. Null otherwise. */
  localUserEmail: string | null;
}

export class ConfigurationError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`The Worker configuration has ${problems.length} problem(s): ${problems.join(" ")}`);
    this.name = "ConfigurationError";
    this.problems = problems;
  }
}

type TextBinding = Exclude<keyof Env, "DB">;

const EMAIL = /^[^\sA-Z@]+@[^\sA-Z@]+\.[^\sA-Z@]+$/;

/** Reads the configuration for one request. The local R2 bucket of `cf dev` answers on the origin of that request. */
export function readRuntimeConfig(env: Env, requestUrl: string): RuntimeConfig {
  const problems: string[] = [];
  const text = (name: TextBinding): string => {
    const value: unknown = env[name];
    if (typeof value !== "string" || value === "") {
      problems.push(`${name} is not set.`);
      return "";
    }
    return value;
  };

  const authModeText = text("AUTH_MODE");
  if (authModeText !== "" && authModeText !== "cloudflare-access" && authModeText !== "local-development") {
    problems.push(`AUTH_MODE must be "cloudflare-access" or "local-development".`);
  }
  const authMode: AuthMode = authModeText === "local-development" ? "local-development" : "cloudflare-access";
  const ttlText = text("SIGNED_URL_TTL_SECONDS");
  const ttl = Number(ttlText);
  if (ttlText !== "" && (!Number.isInteger(ttl) || ttl < 60 || ttl > 604_800)) {
    problems.push("SIGNED_URL_TTL_SECONDS must be a whole number from 60 to 604800.");
  }

  const storageType = text("STORAGE_TYPE");
  let endpoint = "";
  if (storageType === "local-r2") {
    if (authMode !== "local-development") {
      problems.push('STORAGE_TYPE "local-r2" works only with AUTH_MODE "local-development".');
    }
    endpoint = new URL(LOCAL_R2_S3_PATH, requestUrl).href;
  } else {
    if (storageType !== "" && storageType !== "s3") problems.push('STORAGE_TYPE must be "s3" or "local-r2".');
    endpoint = text("S3_ENDPOINT");
  }
  const admins = readAdmins(text("ADMIN_EMAILS"), problems);
  let localUserEmail: string | null = null;
  if (authMode === "local-development") {
    localUserEmail = text("LOCAL_USER_EMAIL");
    if (localUserEmail !== "" && !EMAIL.test(localUserEmail)) {
      problems.push("LOCAL_USER_EMAIL must be a lowercase email address.");
    }
  }
  const urlStyle = text("S3_URL_STYLE");
  if (urlStyle !== "" && urlStyle !== "path" && urlStyle !== "virtual-hosted") {
    problems.push(`S3_URL_STYLE must be "path" or "virtual-hosted".`);
  }

  const config: RuntimeConfig = {
    authMode,
    access: { teamDomain: text("ACCESS_TEAM_DOMAIN"), aud: text("ACCESS_AUD") },
    storage: {
      endpoint,
      region: text("S3_REGION"),
      bucket: text("S3_BUCKET"),
      urlStyle: urlStyle === "virtual-hosted" ? "virtual-hosted" : "path",
      accessKeyId: text("S3_ACCESS_KEY_ID"),
      secretAccessKey: text("S3_SECRET_ACCESS_KEY"),
    },
    signedUrlTtlSeconds: ttl,
    admins,
    localUserEmail,
  };
  const db: unknown = env.DB;
  if (db === undefined || db === null) problems.push("DB is not bound to a D1 database.");
  if (problems.length > 0) throw new ConfigurationError(problems);
  return config;
}

function readAdmins(json: string, problems: string[]): ReadonlySet<string> {
  if (json === "") return new Set();
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    value = null;
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && EMAIL.test(item))) {
    problems.push("ADMIN_EMAILS must be a JSON list of lowercase email addresses.");
    return new Set();
  }
  return new Set(value as string[]);
}

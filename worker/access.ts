// Checks the Cloudflare Access token on API requests.
//
// Access adds a signed JWT to every request it lets through, in the
// Cf-Access-Jwt-Assertion header. The Worker verifies it on every API request,
// so a deployment that forgot to set up Access returns nothing instead of
// exposing the library.

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { AccessConfig } from "./runtime-config.ts";

export type KeySetProvider = (teamDomain: string) => JWTVerifyGetKey;

export interface AccessIdentity {
  email: string | null;
}

export class AccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessDeniedError";
  }
}

const keySets = new Map<string, JWTVerifyGetKey>();

/** Loads the signing keys of an Access team and keeps them for the life of the isolate. */
export const remoteKeySet: KeySetProvider = (teamDomain) => {
  let keySet = keySets.get(teamDomain);
  if (keySet === undefined) {
    keySet = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", teamDomain));
    keySets.set(teamDomain, keySet);
  }
  return keySet;
};

export async function verifyAccessToken(
  token: string | undefined,
  access: AccessConfig,
  keySet: JWTVerifyGetKey,
): Promise<AccessIdentity> {
  if (token === undefined || token === "") {
    throw new AccessDeniedError("The request has no Cloudflare Access token.");
  }
  try {
    const { payload } = await jwtVerify(token, keySet, { issuer: access.teamDomain, audience: access.aud });
    return { email: typeof payload["email"] === "string" ? payload["email"] : null };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new AccessDeniedError(`The Cloudflare Access token is not valid: ${reason}`);
  }
}

/** True for requests to this machine, the only place where local development mode answers. */
export function isLocalhost(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
}

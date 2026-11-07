// Reads and writes the sessions table in D1. Cloudflare Access keeps the sessions
// of people, but a Worker cannot list them, so albireo writes down each session
// that it sees: the browser, the place, and the times of one Access token.

import type { D1Database } from "./env.ts";

export interface SessionRecord {
  browser: string;
  os: string;
  city: string;
  country: string;
  signedInAt: string;
  expiresAt: string;
  lastSeenAt: string;
}

/** A session that a request belongs to, before albireo writes it down. */
export interface SeenSession {
  id: string;
  userId: string;
  browser: string;
  os: string;
  city: string;
  country: string;
  signedInAt: string;
  expiresAt: string;
}

interface SessionRow {
  id: string;
  browser: string;
  os: string;
  city: string;
  country: string;
  signed_in_at: string;
  expires_at: string;
  last_seen_at: string;
}

// albireo writes the last request of a session at most this often, to keep D1 writes few.
const LAST_SEEN_INTERVAL_MS = 5 * 60 * 1000;

export class SessionRepository {
  readonly #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  /** Adds the session the first time, and later moves its last request forward, at most every five minutes. */
  async record(session: SeenSession, now: Date): Promise<void> {
    const seenAt = now.toISOString();
    const staleBefore = new Date(now.getTime() - LAST_SEEN_INTERVAL_MS).toISOString();
    await this.#db
      .prepare(
        "INSERT INTO sessions (id, user_id, browser, os, city, country, signed_in_at, expires_at, last_seen_at) "
          + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) "
          + "ON CONFLICT (id) DO UPDATE SET last_seen_at = excluded.last_seen_at WHERE sessions.last_seen_at < ?",
      )
      .bind(
        session.id,
        session.userId,
        session.browser,
        session.os,
        session.city,
        session.country,
        session.signedInAt,
        session.expiresAt,
        seenAt,
        staleBefore,
      )
      .run();
  }

  /** The sessions of the user that have not expired, from the last used, with the IDs to tell the current one. */
  async listActive(userId: string, now: string): Promise<(SessionRecord & { id: string })[]> {
    const { results } = await this.#db
      .prepare(
        "SELECT id, browser, os, city, country, signed_in_at, expires_at, last_seen_at FROM sessions "
          + "WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC, signed_in_at DESC",
      )
      .bind(userId, now)
      .all<SessionRow>();
    return results.map((row) => ({
      id: row.id,
      browser: row.browser,
      os: row.os,
      city: row.city,
      country: row.country,
      signedInAt: row.signed_in_at,
      expiresAt: row.expires_at,
      lastSeenAt: row.last_seen_at,
    }));
  }

  /** Forgets the sessions of the user that have expired. */
  async removeExpired(userId: string, now: string): Promise<void> {
    await this.#db.prepare("DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?").bind(userId, now).run();
  }

  /** Forgets one session of the user, when the person logs out of it. */
  async remove(userId: string, id: string): Promise<void> {
    await this.#db.prepare("DELETE FROM sessions WHERE user_id = ? AND id = ?").bind(userId, id).run();
  }
}

/** The ID of the session of a token: the SHA-256 of the token, so that albireo never stores the token. */
export async function sessionIdOf(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The browser and the operating system that a User-Agent header names, each as "" when
 * albireo does not recognize it. The order of the checks matters: Edge and Opera also say
 * Chrome, and Chrome also says Safari.
 */
export function deviceOf(userAgent: string | undefined): { browser: string; os: string } {
  const agent = userAgent ?? "";
  const browser = /Edg(e|A|iOS)?\//.test(agent)
    ? "Edge"
    : /OPR\/|Opera/.test(agent)
      ? "Opera"
      : /Firefox\/|FxiOS\//.test(agent)
        ? "Firefox"
        : /Chrome\/|CriOS\//.test(agent)
          ? "Chrome"
          : /Safari\//.test(agent) && /Version\//.test(agent)
            ? "Safari"
            : "";
  const os = /iPhone/.test(agent)
    ? "iOS"
    : /iPad/.test(agent)
      ? "iPadOS"
      : /Android/.test(agent)
        ? "Android"
        : /CrOS/.test(agent)
          ? "ChromeOS"
          : /Windows NT/.test(agent)
            ? "Windows"
            : /Macintosh|Mac OS X/.test(agent)
              ? "macOS"
              : /Linux/.test(agent)
                ? "Linux"
                : "";
  return { browser, os };
}

/** The city and the country code that Cloudflare adds to a request, each as "" when it is missing. */
export function placeOf(cf: unknown): { city: string; country: string } {
  if (typeof cf !== "object" || cf === null) return { city: "", country: "" };
  const { city, country } = cf as { city?: unknown; country?: unknown };
  return { city: typeof city === "string" ? city : "", country: typeof country === "string" ? country : "" };
}

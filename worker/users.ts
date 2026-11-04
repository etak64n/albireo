// Reads and writes the users table in D1. Cloudflare Access signs people in,
// so a user is only an email with a display name that the person chooses.

import { DISPLAY_NAME_MAX_LENGTH } from "../shared/api.ts";
import type { D1Database } from "./env.ts";

export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  bio: string;
  /** Key of the picture in the bucket, or null for the default person icon. */
  avatarKey: string | null;
  createdAt: string;
  updatedAt: string;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  bio: string;
  avatar_key: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS = "id, email, display_name, bio, avatar_key, created_at, updated_at";

export class UserRepository {
  readonly #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  async find(id: string): Promise<UserRecord | null> {
    const row = await this.#db.prepare(`SELECT ${COLUMNS} FROM users WHERE id = ?`).bind(id).first<UserRow>();
    return row === null ? null : toRecord(row);
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const row = await this.#db.prepare(`SELECT ${COLUMNS} FROM users WHERE email = ?`).bind(email).first<UserRow>();
    return row === null ? null : toRecord(row);
  }

  /**
   * Returns the user with the email, and adds the user the first time. The first
   * display name is the part of the email before the @ sign.
   */
  async ensure(email: string, newId: () => string, now: string): Promise<UserRecord> {
    const existing = await this.findByEmail(email);
    if (existing !== null) return existing;
    const displayName = (email.split("@")[0] ?? email).slice(0, DISPLAY_NAME_MAX_LENGTH);
    // Two first requests can arrive at once. The second insert does nothing, and both read the same row.
    await this.#db
      .prepare(
        "INSERT INTO users (id, email, display_name, bio, avatar_key, created_at, updated_at) "
          + "VALUES (?, ?, ?, '', NULL, ?, ?) ON CONFLICT (email) DO NOTHING",
      )
      .bind(newId(), email, displayName, now, now)
      .run();
    const user = await this.findByEmail(email);
    if (user === null) throw new Error(`The user ${email} is missing right after it was added.`);
    return user;
  }

  /** Changes the display name, the bio, or both. */
  async updateProfile(
    id: string,
    profile: { displayName: string | undefined; bio: string | undefined },
    now: string,
  ): Promise<boolean> {
    const assignments: string[] = [];
    const values: unknown[] = [];
    if (profile.displayName !== undefined) {
      assignments.push("display_name = ?");
      values.push(profile.displayName);
    }
    if (profile.bio !== undefined) {
      assignments.push("bio = ?");
      values.push(profile.bio);
    }
    assignments.push("updated_at = ?");
    values.push(now, id);
    const result = await this.#db.prepare(`UPDATE users SET ${assignments.join(", ")} WHERE id = ?`).bind(...values).run();
    return result.meta.changes === 1;
  }

  /** Sets the key of the picture, or null to go back to the default person icon. */
  async setAvatar(id: string, avatarKey: string | null, now: string): Promise<boolean> {
    const result = await this.#db
      .prepare("UPDATE users SET avatar_key = ?, updated_at = ? WHERE id = ?")
      .bind(avatarKey, now, id)
      .run();
    return result.meta.changes === 1;
  }
}

function toRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    bio: row.bio,
    avatarKey: row.avatar_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

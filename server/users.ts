// Reads and writes the users table. albireo has no sign-in, so the table holds one person:
// everyone who opens albireo is that person. albireo adds them when it starts the first time.

import { isLanguage, type Language } from "../shared/api.ts";
import type { Database } from "./database.ts";

export interface UserRecord {
  id: string;
  displayName: string;
  bio: string;
  /** Key of the picture in the bucket, or null for the default person icon. */
  avatarKey: string | null;
  /** The language of the browser app that the person chose. */
  language: Language;
  createdAt: string;
  updatedAt: string;
}

interface UserRow {
  id: string;
  display_name: string;
  bio: string;
  avatar_key: string | null;
  language: string;
  created_at: string;
  updated_at: string;
}

/** The display name of the person until they choose one on the settings page of their channel. */
export const OWNER_DISPLAY_NAME = "Me";

const COLUMNS = "id, display_name, bio, avatar_key, language, created_at, updated_at";

export class UserRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async find(id: string): Promise<UserRecord | null> {
    const row = await this.#db.prepare(`SELECT ${COLUMNS} FROM users WHERE id = ?`).bind(id).first<UserRow>();
    return row === null ? null : toRecord(row);
  }

  /**
   * Returns the person of albireo, and adds them the first time, with the display name "Me",
   * no bio, no picture, and English as the language of the app.
   */
  async ensureOwner(newId: () => string, now: string): Promise<UserRecord> {
    const existing = await this.#first();
    if (existing !== null) return existing;
    await this.#db
      .prepare(
        "INSERT INTO users (id, display_name, bio, avatar_key, language, created_at, updated_at) "
          + "VALUES (?, ?, '', NULL, 'en', ?, ?)",
      )
      .bind(newId(), OWNER_DISPLAY_NAME, now, now)
      .run();
    const owner = await this.#first();
    if (owner === null) throw new Error("The person of albireo is missing right after it was added.");
    return owner;
  }

  async #first(): Promise<UserRecord | null> {
    const row = await this.#db.prepare(`SELECT ${COLUMNS} FROM users ORDER BY created_at, id LIMIT 1`).first<UserRow>();
    return row === null ? null : toRecord(row);
  }

  /** Changes the display name, the bio, the language, or some of them. */
  async update(
    id: string,
    changes: { displayName: string | undefined; bio: string | undefined; language: Language | undefined },
    now: string,
  ): Promise<boolean> {
    const assignments: string[] = [];
    const values: unknown[] = [];
    if (changes.displayName !== undefined) {
      assignments.push("display_name = ?");
      values.push(changes.displayName);
    }
    if (changes.bio !== undefined) {
      assignments.push("bio = ?");
      values.push(changes.bio);
    }
    if (changes.language !== undefined) {
      assignments.push("language = ?");
      values.push(changes.language);
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
    displayName: row.display_name,
    bio: row.bio,
    avatarKey: row.avatar_key,
    // The server writes only the languages of the browser app. Anything else reads as English.
    language: isLanguage(row.language) ? row.language : "en",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

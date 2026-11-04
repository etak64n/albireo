// Reads and writes the series table in D1. The episodes of a series are the
// videos whose series_id names it; worker/videos.ts orders them.

import type { D1Database } from "./env.ts";

export interface SeriesRecord {
  id: string;
  title: string;
  description: string;
  ownerId: string;
  ownerName: string;
  ownerAvatarKey: string | null;
  /** Thumbnail key of the first ready episode that has one. */
  coverKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewSeries {
  id: string;
  title: string;
  description: string;
  ownerId: string;
  createdAt: string;
}

interface SeriesRow {
  id: string;
  title: string;
  description: string;
  owner_id: string;
  owner_name: string;
  owner_avatar_key: string | null;
  cover_key: string | null;
  created_at: string;
  updated_at: string;
}

const SELECT = `SELECT s.id, s.title, s.description, s.owner_id, u.display_name AS owner_name, u.avatar_key AS owner_avatar_key,
    (SELECT v.thumbnail_key FROM videos v
      WHERE v.series_id = s.id AND v.status = 'ready' AND v.thumbnail_key IS NOT NULL
      ORDER BY v.series_position, v.id LIMIT 1) AS cover_key,
    s.created_at, s.updated_at
  FROM series s JOIN users u ON u.id = s.owner_id`;

export class SeriesRepository {
  readonly #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  async insert(series: NewSeries): Promise<void> {
    await this.#db
      .prepare("INSERT INTO series (id, title, description, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(series.id, series.title, series.description, series.ownerId, series.createdAt, series.createdAt)
      .run();
  }

  async find(id: string): Promise<SeriesRecord | null> {
    const row = await this.#db.prepare(`${SELECT} WHERE s.id = ?`).bind(id).first<SeriesRow>();
    return row === null ? null : toRecord(row);
  }

  /** Lists every series, or the series of one owner, from the one that changed last. */
  async list(ownerId: string | null): Promise<SeriesRecord[]> {
    const statement = ownerId === null
      ? this.#db.prepare(`${SELECT} ORDER BY s.updated_at DESC, s.id DESC`)
      : this.#db.prepare(`${SELECT} WHERE s.owner_id = ? ORDER BY s.updated_at DESC, s.id DESC`).bind(ownerId);
    const { results } = await statement.all<SeriesRow>();
    return results.map(toRecord);
  }

  async updateDetails(
    id: string,
    details: { title: string | undefined; description: string | undefined },
    now: string,
  ): Promise<boolean> {
    const assignments: string[] = [];
    const values: unknown[] = [];
    if (details.title !== undefined) {
      assignments.push("title = ?");
      values.push(details.title);
    }
    if (details.description !== undefined) {
      assignments.push("description = ?");
      values.push(details.description);
    }
    assignments.push("updated_at = ?");
    values.push(now, id);
    const result = await this.#db.prepare(`UPDATE series SET ${assignments.join(", ")} WHERE id = ?`).bind(...values).run();
    return result.meta.changes === 1;
  }

  /** Records that the episodes of a series changed, so the series moves to the front of the list. */
  async touch(id: string, now: string): Promise<void> {
    await this.#db.prepare("UPDATE series SET updated_at = ? WHERE id = ?").bind(now, id).run();
  }
}

function toRecord(row: SeriesRow): SeriesRecord {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    ownerAvatarKey: row.owner_avatar_key,
    coverKey: row.cover_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

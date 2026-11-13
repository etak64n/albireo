// Reads and writes the comments table. Comments are listed from the newest.

import type { Database } from "./database.ts";
import type { ListCursor } from "./videos.ts";

export interface CommentRecord {
  id: string;
  videoId: string;
  authorId: string;
  authorName: string;
  authorAvatarKey: string | null;
  body: string;
  createdAt: string;
}

export interface NewComment {
  id: string;
  videoId: string;
  authorId: string;
  body: string;
  createdAt: string;
}

interface CommentRow {
  id: string;
  video_id: string;
  author_id: string;
  author_name: string;
  author_avatar_key: string | null;
  body: string;
  created_at: string;
}

// Every read joins the author, so that the list shows names without one query per comment.
const SELECT = `SELECT c.id, c.video_id, c.author_id, u.display_name AS author_name, u.avatar_key AS author_avatar_key,
    c.body, c.created_at
  FROM comments c JOIN users u ON u.id = c.author_id`;

export class CommentRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async insert(comment: NewComment): Promise<void> {
    await this.#db
      .prepare("INSERT INTO comments (id, video_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(comment.id, comment.videoId, comment.authorId, comment.body, comment.createdAt)
      .run();
  }

  async find(id: string): Promise<CommentRecord | null> {
    const row = await this.#db.prepare(`${SELECT} WHERE c.id = ?`).bind(id).first<CommentRow>();
    return row === null ? null : toRecord(row);
  }

  /** The comments on a video, from the newest, starting after the cursor. */
  async list(videoId: string, limit: number, after: ListCursor | null): Promise<CommentRecord[]> {
    const conditions = ["c.video_id = ?"];
    const values: unknown[] = [videoId];
    if (after !== null) {
      conditions.push("(c.created_at < ? OR (c.created_at = ? AND c.id < ?))");
      values.push(after.createdAt, after.createdAt, after.id);
    }
    values.push(limit);
    const { results } = await this.#db
      .prepare(`${SELECT} WHERE ${conditions.join(" AND ")} ORDER BY c.created_at DESC, c.id DESC LIMIT ?`)
      .bind(...values)
      .all<CommentRow>();
    return results.map(toRecord);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.#db.prepare("DELETE FROM comments WHERE id = ?").bind(id).run();
    return (result.meta.changes ?? 0) > 0;
  }
}

function toRecord(row: CommentRow): CommentRecord {
  return {
    id: row.id,
    videoId: row.video_id,
    authorId: row.author_id,
    authorName: row.author_name,
    authorAvatarKey: row.author_avatar_key,
    body: row.body,
    createdAt: row.created_at,
  };
}

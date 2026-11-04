// Reads and writes the ratings table in D1: the stars, from 1 to 5, that each person gave a video.

import type { D1Database } from "./env.ts";

export interface RatingSummary {
  /** The mean of everyone's stars, or null when nobody rated the video. */
  average: number | null;
  count: number;
  /** The stars of the one person asked about, or null when they did not rate the video. */
  mine: number | null;
}

export class RatingRepository {
  readonly #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  async summary(videoId: string, userId: string): Promise<RatingSummary> {
    const row = await this.#db
      .prepare(
        "SELECT AVG(stars) AS average, COUNT(*) AS count, "
          + "(SELECT stars FROM ratings WHERE video_id = ? AND user_id = ?) AS mine FROM ratings WHERE video_id = ?",
      )
      .bind(videoId, userId, videoId)
      .first<{ average: number | null; count: number; mine: number | null }>();
    return { average: row?.average ?? null, count: row?.count ?? 0, mine: row?.mine ?? null };
  }

  /** Gives the video the stars, in place of the person's earlier rating. */
  async set(videoId: string, userId: string, stars: number, now: string): Promise<void> {
    await this.#db
      .prepare(
        "INSERT INTO ratings (video_id, user_id, stars, rated_at) VALUES (?, ?, ?, ?) "
          + "ON CONFLICT (video_id, user_id) DO UPDATE SET stars = excluded.stars, rated_at = excluded.rated_at",
      )
      .bind(videoId, userId, stars, now)
      .run();
  }

  async clear(videoId: string, userId: string): Promise<void> {
    await this.#db.prepare("DELETE FROM ratings WHERE video_id = ? AND user_id = ?").bind(videoId, userId).run();
  }
}

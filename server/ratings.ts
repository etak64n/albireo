// Reads and writes the ratings table: the stars, from 1 to 5, that each person gave a video.

import type { Database } from "./database.ts";

export interface RatingSummary {
  /** The mean of everyone's stars, or null when nobody rated the video. */
  average: number | null;
  count: number;
  /** The stars of the one person asked about, or null when they did not rate the video. */
  mine: number | null;
}

export class RatingRepository {
  readonly #db: Database;

  constructor(db: Database) {
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
    await this.#recount(videoId);
  }

  async clear(videoId: string, userId: string): Promise<void> {
    await this.#db.prepare("DELETE FROM ratings WHERE video_id = ? AND user_id = ?").bind(videoId, userId).run();
    await this.#recount(videoId);
  }

  /**
   * Keeps the number of ratings of the video and their average on the video, which the
   * list of all videos sorts by (migrations/0010_video_ratings.sql). It reads the ratings
   * of this one video only.
   */
  async #recount(videoId: string): Promise<void> {
    await this.#db
      .prepare(
        "UPDATE videos SET rating_count = (SELECT COUNT(*) FROM ratings WHERE video_id = ?), "
          + "rating_score = COALESCE((SELECT SUM(stars) * 1000 / COUNT(*) FROM ratings WHERE video_id = ?), 0) WHERE id = ?",
      )
      .bind(videoId, videoId, videoId)
      .run();
  }
}

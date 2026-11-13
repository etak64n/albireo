// Reads and writes the videos table, and the watch history that points at it.
// Deleting a video also deletes the rows of the other tables that point at it.

import type { Database } from "./database.ts";

export type VideoStatus = "uploading" | "ready";

export interface VideoRecord {
  id: string;
  title: string;
  description: string;
  status: VideoStatus;
  objectKey: string;
  uploadId: string | null;
  contentType: string;
  fileSize: number;
  partSize: number;
  partCount: number;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  thumbnailKey: string | null;
  createdAt: string;
  updatedAt: string;
  /** Null for videos that were uploaded before albireo recorded uploaders. */
  uploaderId: string | null;
  uploaderName: string | null;
  uploaderAvatarKey: string | null;
  seriesId: string | null;
  /** The title of the series of the video, or null. */
  seriesTitle: string | null;
  seriesPosition: number | null;
  /** How many people rated the video (migrations/0010_video_ratings.sql). */
  ratingCount: number;
  /** The average stars times 1000, rounded down, and 0 when nobody rated the video. */
  ratingScore: number;
  /** How many comments the video has (migrations/0013_video_counts.sql). */
  commentCount: number;
  /** How many attachments the video has, without the ones that still upload. */
  attachmentCount: number;
}

export interface NewUpload {
  id: string;
  title: string;
  description: string;
  objectKey: string;
  uploadId: string;
  contentType: string;
  fileSize: number;
  partSize: number;
  partCount: number;
  createdAt: string;
  uploaderId: string;
  seriesId: string | null;
}

export interface MediaInfo {
  durationSec: number | null;
  width: number | null;
  height: number | null;
}

/** Position in a list that runs by the time of upload, from the newest or from the oldest. */
export interface ListCursor {
  createdAt: string;
  id: string;
}

/** Position in the list of ready videos that runs from the highest rated. */
export interface RatingCursor {
  score: number;
  count: number;
  createdAt: string;
  id: string;
}

/** A ready video with the last time that one person watched it. */
export type WatchedVideoRecord = VideoRecord & { watchedAt: string };

/** A ready video of a playlist with its place there, which orders the playlist from 1. */
export type PlaylistVideoRecord = VideoRecord & { playlistPosition: number };

/** Narrows a list of videos. */
export interface ListFilter {
  uploaderId: string | null;
}

interface VideoRow {
  id: string;
  title: string;
  description: string;
  status: string;
  object_key: string;
  upload_id: string | null;
  content_type: string;
  file_size: number;
  part_size: number;
  part_count: number;
  duration_sec: number | null;
  width: number | null;
  height: number | null;
  thumbnail_key: string | null;
  created_at: string;
  updated_at: string;
  uploader_id: string | null;
  uploader_name: string | null;
  uploader_avatar_key: string | null;
  series_id: string | null;
  series_title: string | null;
  series_position: number | null;
  rating_count: number;
  rating_score: number;
  comment_count: number;
  attachment_count: number;
}

const COLUMNS =
  "id, title, description, status, object_key, upload_id, content_type, file_size, part_size, part_count, "
  + "duration_sec, width, height, thumbnail_key, created_at, updated_at, uploader_id, series_id, series_position, "
  + "rating_count, rating_score, comment_count, attachment_count";

// Every read joins the uploader and the series, so that lists show their names without one
// query per video.
const SELECT = `SELECT ${COLUMNS.split(", ").map((column) => `v.${column}`).join(", ")},
    u.display_name AS uploader_name, u.avatar_key AS uploader_avatar_key, s.title AS series_title
  FROM videos v LEFT JOIN users u ON u.id = v.uploader_id LEFT JOIN series s ON s.id = v.series_id`;

export class VideoRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  /** Adds an upload in progress. A video in a series becomes its last episode. */
  async insertUploading(video: NewUpload): Promise<void> {
    await this.#db
      .prepare(
        `INSERT INTO videos (${COLUMNS}) VALUES (?, ?, ?, 'uploading', ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, `
          + "CASE WHEN ? IS NULL THEN NULL ELSE "
          + "(SELECT COALESCE(MAX(series_position), 0) + 1 FROM videos WHERE series_id = ?) END, 0, 0, 0, 0)",
      )
      .bind(
        video.id,
        video.title,
        video.description,
        video.objectKey,
        video.uploadId,
        video.contentType,
        video.fileSize,
        video.partSize,
        video.partCount,
        video.createdAt,
        video.createdAt,
        video.uploaderId,
        video.seriesId,
        video.seriesId,
        video.seriesId,
      )
      .run();
  }

  async find(id: string): Promise<VideoRecord | null> {
    const row = await this.#db.prepare(`${SELECT} WHERE v.id = ?`).bind(id).first<VideoRow>();
    return row === null ? null : toRecord(row);
  }

  /**
   * Lists ready videos from the newest or from the oldest, starting after the cursor. The
   * cursor compares as one row value, so that the query starts at it in the index and a
   * later page reads no more rows than the first.
   */
  async listReady(
    limit: number,
    after: ListCursor | null,
    filter: ListFilter,
    order: "newest" | "oldest" = "newest",
  ): Promise<VideoRecord[]> {
    const conditions = ["v.status = 'ready'"];
    const values: unknown[] = [];
    if (filter.uploaderId !== null) {
      conditions.push("v.uploader_id = ?");
      values.push(filter.uploaderId);
    }
    if (after !== null) {
      conditions.push(`(v.created_at, v.id) ${order === "newest" ? "<" : ">"} (?, ?)`);
      values.push(after.createdAt, after.id);
    }
    values.push(limit);
    const direction = order === "newest" ? "DESC" : "ASC";
    const { results } = await this.#db
      .prepare(`${SELECT} WHERE ${conditions.join(" AND ")} ORDER BY v.created_at ${direction}, v.id ${direction} LIMIT ?`)
      .bind(...values)
      .all<VideoRow>();
    return results.map(toRecord);
  }

  /**
   * Lists ready videos from the highest average rating, starting after the cursor: more
   * ratings first among equal averages, then the newest. The videos that nobody rated come
   * last. The index videos_status_rating holds this order.
   */
  async listByRating(limit: number, after: RatingCursor | null): Promise<VideoRecord[]> {
    const conditions = ["v.status = 'ready'"];
    const values: unknown[] = [];
    if (after !== null) {
      conditions.push("(v.rating_score, v.rating_count, v.created_at, v.id) < (?, ?, ?, ?)");
      values.push(after.score, after.count, after.createdAt, after.id);
    }
    values.push(limit);
    const { results } = await this.#db
      .prepare(
        `${SELECT} WHERE ${conditions.join(" AND ")} `
          + "ORDER BY v.rating_score DESC, v.rating_count DESC, v.created_at DESC, v.id DESC LIMIT ?",
      )
      .bind(...values)
      .all<VideoRow>();
    return results.map(toRecord);
  }

  /**
   * Picks ready videos at random. The IDs are random, so the videos from a random place among
   * them, in the order of their IDs, are a random pick; past the last ID, the pick goes on from
   * the first. The index videos_status_id holds this order, so it reads about one row a video.
   */
  async sampleReady(limit: number, start: string): Promise<VideoRecord[]> {
    const pick = async (condition: string, count: number) => {
      const { results } = await this.#db
        .prepare(`${SELECT} WHERE v.status = 'ready' AND ${condition} ORDER BY v.id LIMIT ?`)
        .bind(start, count)
        .all<VideoRow>();
      return results.map(toRecord);
    };
    const after = await pick("v.id >= ?", limit);
    return after.length === limit ? after : [...after, ...(await pick("v.id < ?", limit - after.length))];
  }

  /** Records that a person watched a video now. A video appears once in a history, at its last time. */
  async recordWatch(userId: string, videoId: string, now: string): Promise<void> {
    await this.#db
      .prepare(
        "INSERT INTO watch_history (user_id, video_id, watched_at) VALUES (?, ?, ?) "
          + "ON CONFLICT (user_id, video_id) DO UPDATE SET watched_at = excluded.watched_at",
      )
      .bind(userId, videoId, now)
      .run();
  }

  /** The ready videos that a person watched, from the last watched, starting after the cursor. */
  async listWatched(userId: string, limit: number, after: ListCursor | null): Promise<WatchedVideoRecord[]> {
    const conditions = ["h.user_id = ?", "v.status = 'ready'"];
    const values: unknown[] = [userId];
    if (after !== null) {
      conditions.push("(h.watched_at < ? OR (h.watched_at = ? AND h.video_id < ?))");
      values.push(after.createdAt, after.createdAt, after.id);
    }
    values.push(limit);
    const { results } = await this.#db
      .prepare(
        `${SELECT.replace("FROM videos v", "FROM watch_history h JOIN videos v ON v.id = h.video_id")
          .replace("SELECT ", "SELECT h.watched_at, ")} `
          + `WHERE ${conditions.join(" AND ")} ORDER BY h.watched_at DESC, h.video_id DESC LIMIT ?`,
      )
      .bind(...values)
      .all<VideoRow & { watched_at: string }>();
    return results.map((row) => ({ ...toRecord(row), watchedAt: row.watched_at }));
  }

  /**
   * The ready videos whose title or description contains every term, ignoring case.
   * The trigram index looks up terms of three or more characters and ranks title matches
   * first. Shorter terms, which it cannot look up, are checked row by row: in the videos
   * that the index found, or without a longer term, in each ready video once, from the newest.
   */
  async search(terms: readonly string[], limit: number, offset: number): Promise<VideoRecord[]> {
    const indexed = terms.filter((term) => [...term].length >= 3);
    const short = terms.filter((term) => [...term].length < 3);
    const conditions = ["v.status = 'ready'"];
    const values: unknown[] = [];
    let from = "FROM videos v";
    let rank = "";
    if (indexed.length > 0) {
      // CROSS JOIN keeps the index first, so each row that it finds reads its video by ID. In
      // the other order, each video would read the whole index, which does not index the IDs:
      // with 1,600 videos, a search read 2.6 million rows.
      from = "FROM video_search CROSS JOIN videos v ON v.id = video_search.video_id";
      // Each term is a quoted phrase, so characters such as * and : are plain text.
      conditions.push("video_search MATCH ?");
      values.push(indexed.map((term) => `"${term.replace(/"/g, '""')}"`).join(" "));
      // bm25 weighs a match in the title ten times a match in the description.
      rank = "bm25(video_search, 0, 10, 1), ";
    }
    for (const term of short) {
      conditions.push("instr(lower(v.title || char(10) || v.description), ?) > 0");
      values.push(term.toLowerCase());
    }
    values.push(limit, offset);
    const { results } = await this.#db
      .prepare(
        `${SELECT.replace("FROM videos v", from)} `
          + `WHERE ${conditions.join(" AND ")} ORDER BY ${rank}v.created_at DESC, v.id DESC LIMIT ? OFFSET ?`,
      )
      .bind(...values)
      .all<VideoRow>();
    return results.map(toRecord);
  }

  /** The ready episodes of a series, in their order. */
  async listEpisodes(seriesId: string): Promise<VideoRecord[]> {
    const { results } = await this.#db
      .prepare(`${SELECT} WHERE v.series_id = ? AND v.status = 'ready' ORDER BY v.series_position, v.id`)
      .bind(seriesId)
      .all<VideoRow>();
    return results.map(toRecord);
  }

  /** The ready videos of a playlist, in their order. */
  async listInPlaylist(playlistId: string): Promise<PlaylistVideoRecord[]> {
    const { results } = await this.#db
      .prepare(
        `${SELECT.replace("FROM videos v", "FROM playlist_videos pv JOIN videos v ON v.id = pv.video_id")
          .replace("SELECT ", "SELECT pv.position AS playlist_position, ")} `
          + "WHERE pv.playlist_id = ? AND v.status = 'ready' ORDER BY pv.position, pv.video_id",
      )
      .bind(playlistId)
      .all<VideoRow & { playlist_position: number }>();
    return results.map((row) => ({ ...toRecord(row), playlistPosition: row.playlist_position }));
  }

  /**
   * Takes every video of a series out of it, the ones that still upload included, so the
   * series can go. The videos stay in the library.
   */
  async leaveSeries(seriesId: string, now: string): Promise<void> {
    await this.#db
      .prepare("UPDATE videos SET series_id = NULL, series_position = NULL, updated_at = ? WHERE series_id = ?")
      .bind(now, seriesId)
      .run();
  }

  /** Moves a video to the end of a series, or out of its series when seriesId is null. */
  async setSeries(id: string, seriesId: string | null, now: string): Promise<boolean> {
    const result = await this.#db
      .prepare(
        "UPDATE videos SET series_id = ?, series_position = CASE WHEN ? IS NULL THEN NULL ELSE "
          + "(SELECT COALESCE(MAX(series_position), 0) + 1 FROM videos WHERE series_id = ?) END, updated_at = ? "
          + "WHERE id = ?",
      )
      .bind(seriesId, seriesId, seriesId, now, id)
      .run();
    return result.meta.changes === 1;
  }

  /** Swaps the places of two episodes of the same series in one statement. */
  async swapEpisodes(first: VideoRecord, second: VideoRecord): Promise<void> {
    await this.#db
      .prepare(
        "UPDATE videos SET series_position = CASE id WHEN ? THEN ? WHEN ? THEN ? END "
          + "WHERE id IN (?, ?) AND series_id = ?",
      )
      .bind(first.id, second.seriesPosition, second.id, first.seriesPosition, first.id, second.id, first.seriesId)
      .run();
  }

  /** Marks an uploading video as ready. Returns false when no uploading video has the ID. */
  async markReady(id: string, media: MediaInfo, updatedAt: string): Promise<boolean> {
    const result = await this.#db
      .prepare(
        "UPDATE videos SET status = 'ready', upload_id = NULL, duration_sec = ?, width = ?, height = ?, updated_at = ? "
          + "WHERE id = ? AND status = 'uploading'",
      )
      .bind(media.durationSec, media.width, media.height, updatedAt, id)
      .run();
    return result.meta.changes === 1;
  }

  /** Changes the title, the description, or both of a ready video. */
  async updateDetails(
    id: string,
    details: { title: string | undefined; description: string | undefined },
    updatedAt: string,
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
    values.push(updatedAt, id);
    const result = await this.#db
      .prepare(`UPDATE videos SET ${assignments.join(", ")} WHERE id = ? AND status = 'ready'`)
      .bind(...values)
      .run();
    return result.meta.changes === 1;
  }

  async setThumbnail(id: string, thumbnailKey: string, updatedAt: string): Promise<boolean> {
    const result = await this.#db
      .prepare("UPDATE videos SET thumbnail_key = ?, updated_at = ? WHERE id = ? AND status = 'ready'")
      .bind(thumbnailKey, updatedAt, id)
      .run();
    return result.meta.changes === 1;
  }

  /**
   * Deletes a video and every row that points at it: its places in the histories and the
   * playlists, its comments, its ratings, and its attachments. The trigger of the search
   * index deletes its entry. One transaction, so the database deletes all of the rows or none of them.
   */
  async delete(id: string): Promise<boolean> {
    const results = await this.#db.batch([
      ...["watch_history", "playlist_videos", "comments", "ratings", "attachments"].map((table) =>
        this.#db.prepare(`DELETE FROM ${table} WHERE video_id = ?`).bind(id),
      ),
      this.#db.prepare("DELETE FROM videos WHERE id = ?").bind(id),
    ]);
    return results.at(-1)?.meta.changes === 1;
  }

  /** Deletes the row of an upload that never completed. */
  async deleteUploading(id: string): Promise<boolean> {
    const result = await this.#db.prepare("DELETE FROM videos WHERE id = ? AND status = 'uploading'").bind(id).run();
    return result.meta.changes === 1;
  }
}

function toRecord(row: VideoRow): VideoRecord {
  if (row.status !== "uploading" && row.status !== "ready") {
    throw new Error(`Video ${row.id} has an unknown status: ${row.status}`);
  }
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    objectKey: row.object_key,
    uploadId: row.upload_id,
    contentType: row.content_type,
    fileSize: row.file_size,
    partSize: row.part_size,
    partCount: row.part_count,
    durationSec: row.duration_sec,
    width: row.width,
    height: row.height,
    thumbnailKey: row.thumbnail_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    uploaderId: row.uploader_id,
    uploaderName: row.uploader_name,
    uploaderAvatarKey: row.uploader_avatar_key,
    seriesId: row.series_id,
    seriesTitle: row.series_title,
    seriesPosition: row.series_position,
    ratingCount: row.rating_count,
    ratingScore: row.rating_score,
    commentCount: row.comment_count,
    attachmentCount: row.attachment_count,
  };
}

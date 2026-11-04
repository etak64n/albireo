// Reads and writes the videos table in D1, and the watch history that points at it.

import type { D1Database } from "./env.ts";

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
  seriesPosition: number | null;
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

/** Position in the list of ready videos, which runs from the newest. */
export interface ListCursor {
  createdAt: string;
  id: string;
}

/** A ready video with the last time that one person watched it. */
export type WatchedVideoRecord = VideoRecord & { watchedAt: string };

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
  series_position: number | null;
}

const COLUMNS =
  "id, title, description, status, object_key, upload_id, content_type, file_size, part_size, part_count, "
  + "duration_sec, width, height, thumbnail_key, created_at, updated_at, uploader_id, series_id, series_position";

// Every read joins the uploader, so that lists show names without one query per video.
const SELECT = `SELECT ${COLUMNS.split(", ").map((column) => `v.${column}`).join(", ")},
    u.display_name AS uploader_name, u.avatar_key AS uploader_avatar_key
  FROM videos v LEFT JOIN users u ON u.id = v.uploader_id`;

export class VideoRepository {
  readonly #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  /** Adds an upload in progress. A video in a series becomes its last episode. */
  async insertUploading(video: NewUpload): Promise<void> {
    await this.#db
      .prepare(
        `INSERT INTO videos (${COLUMNS}) VALUES (?, ?, ?, 'uploading', ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, `
          + "CASE WHEN ? IS NULL THEN NULL ELSE "
          + "(SELECT COALESCE(MAX(series_position), 0) + 1 FROM videos WHERE series_id = ?) END)",
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

  /** Lists ready videos from the newest, starting after the cursor. */
  async listReady(limit: number, after: ListCursor | null, filter: ListFilter): Promise<VideoRecord[]> {
    const conditions = ["v.status = 'ready'"];
    const values: unknown[] = [];
    if (filter.uploaderId !== null) {
      conditions.push("v.uploader_id = ?");
      values.push(filter.uploaderId);
    }
    if (after !== null) {
      conditions.push("(v.created_at < ? OR (v.created_at = ? AND v.id < ?))");
      values.push(after.createdAt, after.createdAt, after.id);
    }
    values.push(limit);
    const { results } = await this.#db
      .prepare(`${SELECT} WHERE ${conditions.join(" AND ")} ORDER BY v.created_at DESC, v.id DESC LIMIT ?`)
      .bind(...values)
      .all<VideoRow>();
    return results.map(toRecord);
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
   * first. Shorter terms, which it cannot look up, are checked row by row.
   */
  async search(terms: readonly string[], limit: number, offset: number): Promise<VideoRecord[]> {
    const indexed = terms.filter((term) => [...term].length >= 3);
    const short = terms.filter((term) => [...term].length < 3);
    const conditions = ["v.status = 'ready'"];
    const values: unknown[] = [];
    if (indexed.length > 0) {
      // Each term is a quoted phrase, so characters such as * and : are plain text.
      conditions.push("video_search MATCH ?");
      values.push(indexed.map((term) => `"${term.replace(/"/g, '""')}"`).join(" "));
    }
    for (const term of short) {
      conditions.push("instr(lower(video_search.title || char(10) || video_search.description), ?) > 0");
      values.push(term.toLowerCase());
    }
    // bm25 weighs a match in the title ten times a match in the description.
    const rank = indexed.length > 0 ? "bm25(video_search, 0, 10, 1), " : "";
    values.push(limit, offset);
    const { results } = await this.#db
      .prepare(
        `${SELECT.replace("FROM videos v", "FROM video_search JOIN videos v ON v.id = video_search.video_id")} `
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
    seriesPosition: row.series_position,
  };
}

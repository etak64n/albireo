// Reads and writes the playlists: the playlists table, and playlist_videos, which puts
// videos in playlists. server/videos.ts reads the videos of a playlist in their order.

import type { Database } from "./database.ts";

export interface PlaylistRecord {
  id: string;
  title: string;
  description: string;
  ownerId: string;
  ownerName: string;
  ownerAvatarKey: string | null;
  /** Thumbnail key of the first ready video that has one. */
  coverKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewPlaylist {
  id: string;
  title: string;
  description: string;
  ownerId: string;
  createdAt: string;
}

/** A playlist of one person, and whether it holds a given video. */
export interface PlaylistChoiceRecord {
  id: string;
  title: string;
  hasVideo: boolean;
}

interface PlaylistRow {
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

const SELECT = `SELECT p.id, p.title, p.description, p.owner_id, u.display_name AS owner_name, u.avatar_key AS owner_avatar_key,
    (SELECT v.thumbnail_key FROM playlist_videos pv JOIN videos v ON v.id = pv.video_id
      WHERE pv.playlist_id = p.id AND v.status = 'ready' AND v.thumbnail_key IS NOT NULL
      ORDER BY pv.position, pv.video_id LIMIT 1) AS cover_key,
    p.created_at, p.updated_at
  FROM playlists p JOIN users u ON u.id = p.owner_id`;

export class PlaylistRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async insert(playlist: NewPlaylist): Promise<void> {
    await this.#db
      .prepare("INSERT INTO playlists (id, title, description, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(playlist.id, playlist.title, playlist.description, playlist.ownerId, playlist.createdAt, playlist.createdAt)
      .run();
  }

  async find(id: string): Promise<PlaylistRecord | null> {
    const row = await this.#db.prepare(`${SELECT} WHERE p.id = ?`).bind(id).first<PlaylistRow>();
    return row === null ? null : toRecord(row);
  }

  /** Lists every playlist, or the playlists of one owner, from the one that changed last. */
  async list(ownerId: string | null): Promise<PlaylistRecord[]> {
    const statement = ownerId === null
      ? this.#db.prepare(`${SELECT} ORDER BY p.updated_at DESC, p.id DESC`)
      : this.#db.prepare(`${SELECT} WHERE p.owner_id = ? ORDER BY p.updated_at DESC, p.id DESC`).bind(ownerId);
    const { results } = await statement.all<PlaylistRow>();
    return results.map(toRecord);
  }

  /** The playlists of one owner, from the one that changed last, each with whether it holds the video. */
  async choicesFor(ownerId: string, videoId: string): Promise<PlaylistChoiceRecord[]> {
    const { results } = await this.#db
      .prepare(
        "SELECT p.id, p.title, EXISTS (SELECT 1 FROM playlist_videos pv WHERE pv.playlist_id = p.id AND pv.video_id = ?) AS has_video "
          + "FROM playlists p WHERE p.owner_id = ? ORDER BY p.updated_at DESC, p.id DESC",
      )
      .bind(videoId, ownerId)
      .all<{ id: string; title: string; has_video: number }>();
    return results.map((row) => ({ id: row.id, title: row.title, hasVideo: row.has_video === 1 }));
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
    const result = await this.#db.prepare(`UPDATE playlists SET ${assignments.join(", ")} WHERE id = ?`).bind(...values).run();
    return result.meta.changes === 1;
  }

  /**
   * Puts a video at the end of a playlist, and moves the playlist to the front of the lists.
   * Returns false when the playlist holds the video already.
   */
  async addVideo(playlistId: string, videoId: string, now: string): Promise<boolean> {
    const result = await this.#db
      .prepare(
        "INSERT INTO playlist_videos (playlist_id, video_id, position, added_at) "
          + "VALUES (?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM playlist_videos WHERE playlist_id = ?), ?) "
          + "ON CONFLICT (playlist_id, video_id) DO NOTHING",
      )
      .bind(playlistId, videoId, playlistId, now)
      .run();
    if (result.meta.changes !== 1) return false;
    await this.touch(playlistId, now);
    return true;
  }

  /** Takes a video out of a playlist. Returns false when the playlist does not hold it. */
  async removeVideo(playlistId: string, videoId: string, now: string): Promise<boolean> {
    const result = await this.#db
      .prepare("DELETE FROM playlist_videos WHERE playlist_id = ? AND video_id = ?")
      .bind(playlistId, videoId)
      .run();
    if (result.meta.changes !== 1) return false;
    await this.touch(playlistId, now);
    return true;
  }

  /** Swaps the places of two videos of a playlist in one statement. */
  async swapVideos(playlistId: string, first: { id: string; position: number }, second: { id: string; position: number }): Promise<void> {
    await this.#db
      .prepare(
        "UPDATE playlist_videos SET position = CASE video_id WHEN ? THEN ? WHEN ? THEN ? END "
          + "WHERE playlist_id = ? AND video_id IN (?, ?)",
      )
      .bind(first.id, second.position, second.id, first.position, playlistId, first.id, second.id)
      .run();
  }

  /** Records that the videos of a playlist changed, so the playlist moves to the front of the lists. */
  async touch(id: string, now: string): Promise<void> {
    await this.#db.prepare("UPDATE playlists SET updated_at = ? WHERE id = ?").bind(now, id).run();
  }

  /** Deletes a playlist. Its videos stay in the library. One transaction, so the database deletes both or neither. */
  async delete(id: string): Promise<boolean> {
    const results = await this.#db.batch([
      this.#db.prepare("DELETE FROM playlist_videos WHERE playlist_id = ?").bind(id),
      this.#db.prepare("DELETE FROM playlists WHERE id = ?").bind(id),
    ]);
    return results.at(-1)?.meta.changes === 1;
  }
}

function toRecord(row: PlaylistRow): PlaylistRecord {
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

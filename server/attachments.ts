// Reads and writes the attachments table, and names the files for browsers:
// the content type from the file extension, and the Content-Disposition of downloads.

import type { Database } from "./database.ts";

export type AttachmentStatus = "uploading" | "ready";

export interface AttachmentRecord {
  id: string;
  videoId: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  status: AttachmentStatus;
  createdAt: string;
}

interface AttachmentRow {
  id: string;
  video_id: string;
  file_name: string;
  content_type: string;
  file_size: number;
  status: AttachmentStatus;
  created_at: string;
}

const SELECT = "SELECT id, video_id, file_name, content_type, file_size, status, created_at FROM attachments";

export class AttachmentRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async insertUploading(attachment: Omit<AttachmentRecord, "status">): Promise<void> {
    await this.#db
      .prepare(
        "INSERT INTO attachments (id, video_id, file_name, content_type, file_size, status, created_at) "
          + "VALUES (?, ?, ?, ?, ?, 'uploading', ?)",
      )
      .bind(attachment.id, attachment.videoId, attachment.fileName, attachment.contentType, attachment.fileSize, attachment.createdAt)
      .run();
  }

  async find(id: string): Promise<AttachmentRecord | null> {
    const row = await this.#db.prepare(`${SELECT} WHERE id = ?`).bind(id).first<AttachmentRow>();
    return row === null ? null : toRecord(row);
  }

  /** The ready attachments of a video, in the order that they were attached. */
  async listReady(videoId: string): Promise<AttachmentRecord[]> {
    const { results } = await this.#db
      .prepare(`${SELECT} WHERE video_id = ? AND status = 'ready' ORDER BY created_at, id`)
      .bind(videoId)
      .all<AttachmentRow>();
    return results.map(toRecord);
  }

  /** Every attachment of a video, also the ones that still upload, whose files can be in the bucket already. */
  async listAll(videoId: string): Promise<AttachmentRecord[]> {
    const { results } = await this.#db.prepare(`${SELECT} WHERE video_id = ? ORDER BY created_at, id`).bind(videoId).all<AttachmentRow>();
    return results.map(toRecord);
  }

  /** Records the size that the storage service reports and shows the attachment. */
  async markReady(id: string, fileSize: number): Promise<boolean> {
    const result = await this.#db
      .prepare("UPDATE attachments SET status = 'ready', file_size = ? WHERE id = ? AND status = 'uploading'")
      .bind(fileSize, id)
      .run();
    return (result.meta.changes ?? 0) > 0;
  }

  /** Deletes the row. The API deletes the file from the bucket before it. */
  async delete(id: string): Promise<boolean> {
    const result = await this.#db.prepare("DELETE FROM attachments WHERE id = ?").bind(id).run();
    return (result.meta.changes ?? 0) > 0;
  }
}

function toRecord(row: AttachmentRow): AttachmentRecord {
  return {
    id: row.id,
    videoId: row.video_id,
    fileName: row.file_name,
    contentType: row.content_type,
    fileSize: row.file_size,
    status: row.status,
    createdAt: row.created_at,
  };
}

// The types that browsers show or open. Other files, HTML and SVG among them, download as
// plain bytes, so that nothing that a person uploads runs as a page.
const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  key: "application/vnd.apple.keynote",
  md: "text/markdown; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  zip: "application/zip",
};

export function contentTypeOf(fileName: string): string {
  const extension = /\.([^.]+)$/.exec(fileName)?.[1]?.toLowerCase();
  return (extension === undefined ? undefined : CONTENT_TYPES[extension]) ?? "application/octet-stream";
}

/**
 * The Content-Disposition that makes the browser save the file under its name. Old
 * browsers read the ASCII name, in which other characters become underscores.
 */
export function downloadDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

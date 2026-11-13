// A bucket in memory. It records multipart uploads and objects with their bytes, and answers
// reads with ranges and revalidations as a storage service does, so tests can check them.

import { StorageError, type CompletedPart, type ObjectStore } from "../../server/storage.ts";

interface Upload {
  key: string;
  contentType: string;
  state: "open" | "completed" | "aborted";
  /** The parts that the server sent, by number, with the size of each. */
  sent: Map<number, number>;
  /** The parts that completed the upload. */
  parts: CompletedPart[];
}

export interface StoredObject {
  size: number;
  contentType: string;
  /** The bytes of the object, or null when a test made the object without them. */
  bytes: Uint8Array | null;
  etag: string;
}

export class MemoryObjectStore implements ObjectStore {
  readonly uploads = new Map<string, Upload>();
  readonly objects = new Map<string, StoredObject>();
  /** The keys that deleteObject was called with, in order. */
  readonly deletedKeys: string[] = [];
  /** A key whose deletion fails, as a storage service that refuses it does. */
  failDeletionOf: string | null = null;
  /**
   * The size of the object that completing a multipart upload creates, so that a test can complete
   * an upload without sending its parts. Null makes the object of the parts that the server sent.
   */
  sizeOfCompletedObject: number | null = null;
  #nextUploadId = 1;
  #nextVersion = 1;

  /** Puts an object in the bucket, as a browser that sent a file would. */
  put(key: string, size: number, contentType = "application/octet-stream"): void {
    this.objects.set(key, { size, contentType, bytes: null, etag: this.#etag() });
  }

  async createMultipartUpload(key: string, contentType: string): Promise<string> {
    const uploadId = `upload-${this.#nextUploadId}`;
    this.#nextUploadId += 1;
    this.uploads.set(uploadId, { key, contentType, state: "open", sent: new Map(), parts: [] });
    return uploadId;
  }

  async uploadPart(key: string, uploadId: string, partNumber: number, body: ReadableStream<Uint8Array>, length: number): Promise<string> {
    const upload = this.#openUpload(key, uploadId);
    const bytes = await readAll(body);
    if (bytes.length !== length) throw new StorageError(`UploadPart received ${bytes.length} bytes, not ${length}.`, 400, "IncompleteBody");
    upload.sent.set(partNumber, length);
    return `"etag-${partNumber}"`;
  }

  async completeMultipartUpload(key: string, uploadId: string, parts: CompletedPart[]): Promise<void> {
    const upload = this.#openUpload(key, uploadId);
    upload.state = "completed";
    upload.parts = parts;
    const size = this.sizeOfCompletedObject ?? [...upload.sent.values()].reduce((sum, part) => sum + part, 0);
    this.objects.set(key, { size, contentType: upload.contentType, bytes: null, etag: this.#etag() });
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    this.#openUpload(key, uploadId).state = "aborted";
  }

  async putObject(key: string, contentType: string, body: ReadableStream<Uint8Array>, length: number): Promise<void> {
    const bytes = await readAll(body);
    if (bytes.length !== length) throw new StorageError(`PutObject received ${bytes.length} bytes, not ${length}.`, 400, "IncompleteBody");
    this.objects.set(key, { size: length, contentType, bytes, etag: this.#etag() });
  }

  async getObject(key: string, method: "GET" | "HEAD", headers: Headers): Promise<Response | null> {
    const object = this.objects.get(key);
    if (object === undefined) return null;
    const bytes = object.bytes ?? new Uint8Array(object.size);
    const common = { "content-type": object.contentType, etag: object.etag, "accept-ranges": "bytes" };
    if (headers.get("if-none-match") === object.etag) return new Response(null, { status: 304, headers: { etag: object.etag } });
    const range = /^bytes=(\d+)-(\d*)$/.exec(headers.get("range") ?? "");
    if (range !== null) {
      const start = Number(range[1]);
      const end = range[2] === "" ? bytes.length - 1 : Math.min(Number(range[2]), bytes.length - 1);
      if (start >= bytes.length) {
        return new Response(null, { status: 416, headers: { "content-range": `bytes */${bytes.length}` } });
      }
      const slice = bytes.slice(start, end + 1);
      return new Response(method === "HEAD" ? null : slice, {
        status: 206,
        headers: { ...common, "content-length": String(slice.length), "content-range": `bytes ${start}-${end}/${bytes.length}` },
      });
    }
    return new Response(method === "HEAD" ? null : bytes, { status: 200, headers: { ...common, "content-length": String(bytes.length) } });
  }

  async headObject(key: string): Promise<{ size: number } | null> {
    const object = this.objects.get(key);
    return object === undefined ? null : { size: object.size };
  }

  async deleteObject(key: string): Promise<void> {
    if (key === this.failDeletionOf) throw new StorageError("DeleteObject failed with HTTP 403 (AccessDenied: Access Denied).", 403, "AccessDenied");
    this.deletedKeys.push(key);
    this.objects.delete(key);
  }

  #etag(): string {
    const etag = `"v${this.#nextVersion}"`;
    this.#nextVersion += 1;
    return etag;
  }

  #openUpload(key: string, uploadId: string): Upload {
    const upload = this.uploads.get(uploadId);
    if (upload === undefined || upload.key !== key || upload.state !== "open") {
      throw new Error(`No open upload ${uploadId} for ${key}.`);
    }
    return upload;
  }
}

async function readAll(body: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(body).arrayBuffer());
}

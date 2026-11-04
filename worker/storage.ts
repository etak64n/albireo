// Talks to S3-compatible object storage with Signature Version 4.
//
// Videos never pass through the Worker. The Worker starts and completes
// multipart uploads, and signs URLs that the browser uses to send the parts
// and to play the finished video directly from the storage service.

import { AwsClient } from "aws4fetch";
import type { StorageConfig } from "./runtime-config.ts";

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

export interface ObjectStore {
  /** Starts a multipart upload and returns its upload ID. */
  createMultipartUpload(key: string, contentType: string): Promise<string>;
  /** Signs a URL that uploads one part with an HTTP PUT. */
  presignUploadPart(key: string, uploadId: string, partNumber: number): Promise<string>;
  completeMultipartUpload(key: string, uploadId: string, parts: CompletedPart[]): Promise<void>;
  abortMultipartUpload(key: string, uploadId: string): Promise<void>;
  /**
   * Signs a URL that reads the object with an HTTP GET. With a Content-Disposition, the
   * storage service answers with it, so the browser saves or shows the file under that name.
   */
  presignGet(key: string, contentDisposition?: string): Promise<string>;
  /** Signs a URL that writes the object with an HTTP PUT of the given content type. */
  presignPut(key: string, contentType: string): Promise<string>;
  /** Returns the size of the object, or null when it does not exist. */
  headObject(key: string): Promise<{ size: number } | null>;
}

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

// aws4fetch retries 5xx and 429 responses. Two retries keep a request that the
// browser waits on from hanging when the storage service is down.
const STORAGE_RETRIES = 2;

export class S3ObjectStore implements ObjectStore {
  readonly #client: AwsClient;
  readonly #storage: StorageConfig;
  readonly #ttlSeconds: number;

  constructor(storage: StorageConfig, ttlSeconds: number) {
    this.#storage = storage;
    this.#ttlSeconds = ttlSeconds;
    this.#client = new AwsClient({
      accessKeyId: storage.accessKeyId,
      secretAccessKey: storage.secretAccessKey,
      service: "s3",
      region: storage.region,
      retries: STORAGE_RETRIES,
    });
  }

  async createMultipartUpload(key: string, contentType: string): Promise<string> {
    const url = objectUrl(this.#storage, key);
    url.search = "uploads";
    const response = await this.#send("CreateMultipartUpload", url, {
      method: "POST",
      headers: { "content-type": contentType },
    });
    const body = await response.text();
    if (!response.ok) throw failure("CreateMultipartUpload", response.status, body);
    const uploadId = readXmlElement(body, "UploadId");
    if (uploadId === null) throw new StorageError("CreateMultipartUpload returned no UploadId.");
    return uploadId;
  }

  async presignUploadPart(key: string, uploadId: string, partNumber: number): Promise<string> {
    const url = objectUrl(this.#storage, key);
    url.searchParams.set("partNumber", String(partNumber));
    url.searchParams.set("uploadId", uploadId);
    return this.#presign(url, "PUT", {});
  }

  async completeMultipartUpload(key: string, uploadId: string, parts: CompletedPart[]): Promise<void> {
    const url = objectUrl(this.#storage, key);
    url.searchParams.set("uploadId", uploadId);
    const response = await this.#send("CompleteMultipartUpload", url, {
      method: "POST",
      headers: { "content-type": "application/xml" },
      body: buildCompleteMultipartUploadXml(parts),
    });
    const body = await response.text();
    // S3 can answer 200 OK and still report an error in the body.
    if (!response.ok || body.includes("<Error>")) throw failure("CompleteMultipartUpload", response.status, body);
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    const url = objectUrl(this.#storage, key);
    url.searchParams.set("uploadId", uploadId);
    const response = await this.#send("AbortMultipartUpload", url, { method: "DELETE" });
    const body = await response.text();
    // 404 means that the upload is already gone, which is what aborting wants.
    if (!response.ok && response.status !== 404) throw failure("AbortMultipartUpload", response.status, body);
  }

  async presignGet(key: string, contentDisposition?: string): Promise<string> {
    const url = objectUrl(this.#storage, key);
    if (contentDisposition !== undefined) url.searchParams.set("response-content-disposition", contentDisposition);
    return this.#presign(url, "GET", {});
  }

  async presignPut(key: string, contentType: string): Promise<string> {
    return this.#presign(objectUrl(this.#storage, key), "PUT", { "content-type": contentType });
  }

  async headObject(key: string): Promise<{ size: number } | null> {
    const response = await this.#send("HeadObject", objectUrl(this.#storage, key), { method: "HEAD" });
    if (response.status === 404) return null;
    if (!response.ok) throw failure("HeadObject", response.status, "");
    const size = Number(response.headers.get("content-length"));
    if (!Number.isSafeInteger(size)) throw new StorageError("HeadObject returned no Content-Length.");
    return { size };
  }

  // A request that cannot reach the storage service is a storage failure, not a bug in the Worker.
  async #send(operation: string, url: URL, init: RequestInit): Promise<Response> {
    try {
      return await this.#client.fetch(url.toString(), init);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new StorageError(`${operation} could not reach the storage service at ${url.origin}: ${reason}`);
    }
  }

  // Every header passed here is signed, including Content-Type, which aws4fetch
  // leaves out unless allHeaders is set. The browser must send them unchanged.
  async #presign(url: URL, method: string, headers: Record<string, string>): Promise<string> {
    url.searchParams.set("X-Amz-Expires", String(this.#ttlSeconds));
    const signed = await this.#client.sign(url.toString(), {
      method,
      headers,
      aws: { signQuery: true, allHeaders: true },
    });
    return signed.url;
  }
}

/** URL of an object, with the bucket in the path or in the hostname. Both follow the path of the endpoint. */
export function objectUrl(storage: Pick<StorageConfig, "endpoint" | "bucket" | "urlStyle">, key: string): URL {
  const endpoint = new URL(storage.endpoint);
  const base = endpoint.pathname.replace(/\/+$/, "");
  const path = key.split("/").map(encodeURIComponent).join("/");
  if (storage.urlStyle === "path") return new URL(`${endpoint.origin}${base}/${storage.bucket}/${path}`);
  return new URL(`${endpoint.protocol}//${storage.bucket}.${endpoint.host}${base}/${path}`);
}

export function buildCompleteMultipartUploadXml(parts: CompletedPart[]): string {
  const items = [...parts]
    .sort((a, b) => a.partNumber - b.partNumber)
    .map((part) => `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${escapeXml(part.etag)}</ETag></Part>`)
    .join("");
  return `<CompleteMultipartUpload xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${items}</CompleteMultipartUpload>`;
}

/** Text of the first element with the given name, or null when there is none. */
export function readXmlElement(xml: string, name: string): string | null {
  const match = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml);
  const text = match?.[1];
  return text === undefined ? null : unescapeXml(text);
}

function failure(operation: string, status: number, body: string): StorageError {
  const code = readXmlElement(body, "Code");
  const message = readXmlElement(body, "Message");
  const detail = [code, message].filter((part) => part !== null).join(": ");
  return new StorageError(`${operation} failed with HTTP ${status}${detail === "" ? "" : ` (${detail})`}.`);
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

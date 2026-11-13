// Talks to the S3-compatible bucket with Signature Version 4.
//
// Every file passes through albireo. The browser sends the parts of a video, thumbnails,
// pictures, and attachments to albireo, which writes them to the bucket, and it reads every
// file from albireo, which streams it from the bucket. The browser talks to albireo alone,
// so the bucket needs no CORS rules, and the access key never leaves the server.

import { once } from "node:events";
import { request as httpRequest, type ClientRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { AwsClient } from "aws4fetch";
import type { StorageConfig } from "./config.ts";

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

/** The headers of a read that albireo passes on to the bucket, so that ranges and revalidation work. */
export const FORWARDED_REQUEST_HEADERS = ["range", "if-range", "if-none-match", "if-modified-since"] as const;

/** The headers of the answer of the bucket that albireo passes on to the browser. */
export const FORWARDED_RESPONSE_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"] as const;

export interface ObjectStore {
  /** Starts a multipart upload and returns its upload ID. */
  createMultipartUpload(key: string, contentType: string): Promise<string>;
  /** Writes one part of a multipart upload, the `length` bytes of the body, and returns its ETag. */
  uploadPart(key: string, uploadId: string, partNumber: number, body: ReadableStream<Uint8Array>, length: number): Promise<string>;
  completeMultipartUpload(key: string, uploadId: string, parts: CompletedPart[]): Promise<void>;
  abortMultipartUpload(key: string, uploadId: string): Promise<void>;
  /** Writes the object, the `length` bytes of the body, with its content type. */
  putObject(key: string, contentType: string, body: ReadableStream<Uint8Array>, length: number): Promise<void>;
  /**
   * Reads the object, or a range of it, with the headers of FORWARDED_REQUEST_HEADERS that the
   * browser sent. Returns the answer of the bucket, such as 200, 206, 304, or 416, or null when
   * the object does not exist.
   */
  getObject(key: string, method: "GET" | "HEAD", headers: Headers): Promise<Response | null>;
  /** Returns the size of the object, or null when it does not exist. */
  headObject(key: string): Promise<{ size: number } | null>;
  /** Deletes the object. Deleting a key that holds no object succeeds. */
  deleteObject(key: string): Promise<void>;
}

/** A request to the bucket that failed. */
export class StorageError extends Error {
  /** The HTTP status that the bucket answered, or null when albireo could not reach it. */
  readonly status: number | null;
  /** The error code in the answer of the bucket, such as NoSuchBucket or AccessDenied, or null. */
  readonly code: string | null;

  constructor(message: string, status: number | null = null, code: string | null = null) {
    super(message);
    this.name = "StorageError";
    this.status = status;
    this.code = code;
  }
}

// aws4fetch sends a request again after an answer of 5xx or 429. Two more tries keep a
// request that the browser waits on from hanging while the storage service is down.
const STORAGE_RETRIES = 2;
// A write that receives nothing from the bucket, and can send nothing to it, for this long stops.
const WRITE_IDLE_TIMEOUT_MS = 120_000;

export class S3ObjectStore implements ObjectStore {
  readonly #client: AwsClient;
  readonly #storage: StorageConfig;

  constructor(storage: StorageConfig) {
    this.#storage = storage;
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
    const response = await this.#send("CreateMultipartUpload", url, { method: "POST", headers: { "content-type": contentType } });
    const body = await response.text();
    if (!response.ok) throw failure("CreateMultipartUpload", response.status, body);
    const uploadId = readXmlElement(body, "UploadId");
    if (uploadId === null) throw new StorageError("CreateMultipartUpload returned no UploadId.", response.status);
    return uploadId;
  }

  async uploadPart(key: string, uploadId: string, partNumber: number, body: ReadableStream<Uint8Array>, length: number): Promise<string> {
    const url = objectUrl(this.#storage, key);
    url.searchParams.set("partNumber", String(partNumber));
    url.searchParams.set("uploadId", uploadId);
    const answer = await this.#write("UploadPart", url, {}, body, length);
    const etag = answer.headers["etag"];
    if (typeof etag !== "string" || etag === "") throw new StorageError("UploadPart returned no ETag.", answer.status);
    return etag;
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

  async putObject(key: string, contentType: string, body: ReadableStream<Uint8Array>, length: number): Promise<void> {
    await this.#write("PutObject", objectUrl(this.#storage, key), { "content-type": contentType }, body, length);
  }

  async getObject(key: string, method: "GET" | "HEAD", headers: Headers): Promise<Response | null> {
    const forwarded: Record<string, string> = {};
    for (const name of FORWARDED_REQUEST_HEADERS) {
      const value = headers.get(name);
      if (value !== null) forwarded[name] = value;
    }
    const response = await this.#send("GetObject", objectUrl(this.#storage, key), { method, headers: forwarded });
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    // 304 answers a revalidation, 412 an If-Range that no longer matches, and 416 a range past the end.
    if (response.ok || response.status === 304 || response.status === 412 || response.status === 416) return response;
    throw failure("GetObject", response.status, method === "GET" ? await response.text() : "");
  }

  async headObject(key: string): Promise<{ size: number } | null> {
    const response = await this.#send("HeadObject", objectUrl(this.#storage, key), { method: "HEAD" });
    if (response.status === 404) return null;
    if (!response.ok) throw failure("HeadObject", response.status, "");
    const size = Number(response.headers.get("content-length"));
    if (!Number.isSafeInteger(size)) throw new StorageError("HeadObject returned no Content-Length.", response.status);
    return { size };
  }

  async deleteObject(key: string): Promise<void> {
    const response = await this.#send("DeleteObject", objectUrl(this.#storage, key), { method: "DELETE" });
    const body = await response.text();
    // S3 answers 204 for a key that holds no object too. Some compatible services answer 404.
    if (!response.ok && response.status !== 404) throw failure("DeleteObject", response.status, body);
  }

  // A request that cannot reach the storage service is a storage failure, not a bug in albireo.
  async #send(operation: string, url: URL, init: RequestInit): Promise<Response> {
    try {
      return await this.#client.fetch(url.toString(), init);
    } catch (error) {
      throw unreachable(operation, url, error);
    }
  }

  // Sends a body as it arrives, without holding it in memory: the signature leaves the payload
  // unsigned, and node:http sends exactly `length` bytes with that Content-Length, which S3
  // needs. A write runs once. The browser sends a failed part or file again.
  async #write(
    operation: string,
    url: URL,
    headers: Record<string, string>,
    body: ReadableStream<Uint8Array>,
    length: number,
  ): Promise<{ status: number; headers: IncomingMessage["headers"] }> {
    const signed = await this.#client.sign(url.toString(), { method: "PUT", headers });
    const outgoing: Record<string, string> = {};
    signed.headers.forEach((value, name) => {
      outgoing[name] = value;
    });
    outgoing["content-length"] = String(length);
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
      // Set when the request to the bucket fails, which rejects with what went wrong there.
      let requestFailed = false;
      const request = send(url, { method: "PUT", headers: outgoing, timeout: WRITE_IDLE_TIMEOUT_MS }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("error", (error) => reject(unreachable(operation, url, error)));
        response.on("end", () => {
          const status = response.statusCode ?? 0;
          if (status >= 200 && status < 300) resolve({ status, headers: response.headers });
          else reject(failure(operation, status, Buffer.concat(chunks).toString("utf8")));
        });
      });
      // A body shorter or longer than its length fails before the bucket takes it.
      // Node.js has the property, and its types do not declare it.
      (request as typeof request & { strictContentLength: boolean }).strictContentLength = true;
      request.on("timeout", () => request.destroy(new Error(`no data moved for ${WRITE_IDLE_TIMEOUT_MS / 1000} seconds`)));
      request.on("error", (error) => {
        requestFailed = true;
        reject(unreachable(operation, url, error));
      });
      void sendBody(request, body).catch((error: unknown) => {
        if (requestFailed) return;
        request.destroy();
        reject(new StorageError(`${operation} stopped because the file did not arrive whole: ${reasonOf(error)}`));
      });
    });
  }
}

// Writes the body to the request as it arrives, waiting while the request has more than it can
// send. A write past the length, an end before it, and a failure of the body all reject.
async function sendBody(request: ClientRequest, body: ReadableStream<Uint8Array>): Promise<void> {
  const reader = body.getReader();
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (request.destroyed) throw new Error("the request to the bucket ended");
      if (!request.write(chunk.value)) await once(request, "drain");
    }
    request.end();
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
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
  return new StorageError(`${operation} failed with HTTP ${status}${detail === "" ? "" : ` (${detail})`}.`, status, code);
}

function unreachable(operation: string, url: URL, error: unknown): StorageError {
  return new StorageError(`${operation} could not reach the storage service at ${url.origin}: ${reasonOf(error)}`);
}

function reasonOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  // fetch reports "fetch failed" and keeps the reason, such as ECONNREFUSED, in the cause.
  const cause: unknown = error.cause;
  return cause instanceof Error ? `${error.message} (${cause.message})` : error.message;
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

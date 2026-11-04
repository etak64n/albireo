// A storage service in memory. It records multipart uploads and objects, and
// returns signed URLs that name the operation, so tests can check them.

import type { CompletedPart, ObjectStore } from "../../worker/storage.ts";

interface Upload {
  key: string;
  contentType: string;
  state: "open" | "completed" | "aborted";
  parts: CompletedPart[];
}

export class MemoryObjectStore implements ObjectStore {
  readonly uploads = new Map<string, Upload>();
  readonly objects = new Map<string, { size: number }>();
  /** Size of the object that completing a multipart upload creates. */
  sizeOfCompletedObject = 0;
  #nextUploadId = 1;

  async createMultipartUpload(key: string, contentType: string): Promise<string> {
    const uploadId = `upload-${this.#nextUploadId}`;
    this.#nextUploadId += 1;
    this.uploads.set(uploadId, { key, contentType, state: "open", parts: [] });
    return uploadId;
  }

  async presignUploadPart(key: string, uploadId: string, partNumber: number): Promise<string> {
    return `https://storage.test/${key}?uploadId=${uploadId}&partNumber=${partNumber}`;
  }

  async completeMultipartUpload(key: string, uploadId: string, parts: CompletedPart[]): Promise<void> {
    const upload = this.#openUpload(key, uploadId);
    upload.state = "completed";
    upload.parts = parts;
    this.objects.set(key, { size: this.sizeOfCompletedObject });
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    this.#openUpload(key, uploadId).state = "aborted";
  }

  async presignGet(key: string, contentDisposition?: string): Promise<string> {
    const disposition = contentDisposition === undefined ? "" : `&disposition=${encodeURIComponent(contentDisposition)}`;
    return `https://storage.test/${key}?op=get${disposition}`;
  }

  async presignPut(key: string, contentType: string): Promise<string> {
    return `https://storage.test/${key}?op=put&type=${encodeURIComponent(contentType)}`;
  }

  async headObject(key: string): Promise<{ size: number } | null> {
    return this.objects.get(key) ?? null;
  }

  #openUpload(key: string, uploadId: string): Upload {
    const upload = this.uploads.get(uploadId);
    if (upload === undefined || upload.key !== key || upload.state !== "open") {
      throw new Error(`No open upload ${uploadId} for ${key}.`);
    }
    return upload;
  }
}

// Uploads a video from the browser to albireo, which writes it to the bucket.
//
// albireo starts a multipart upload in the bucket and answers with the URL of each
// part. The browser sends the parts in parallel with PUT requests, retries failed
// parts, and asks albireo to complete the upload with the ETag of every part.

import type { CreateUploadResponse, VideoDetail } from "../../shared/api.ts";
import { isPassingStatus, retry } from "../../shared/retry.ts";
import { api } from "../api.ts";
import { currentMessages } from "../i18n.ts";
import { titleFromFileName } from "./format.ts";
import { inspectVideo } from "./media.ts";

export type UploadPhase = "reading" | "uploading" | "finishing";

export interface UploadProgress {
  phase: UploadPhase;
  uploadedBytes: number;
  totalBytes: number;
}

export interface UploadTask {
  done: Promise<VideoDetail>;
  cancel: () => void;
}

const PART_CONCURRENCY = 4;
const PART_ATTEMPTS = 3;

/** Uploads a video. With a seriesId, the video joins that series as its last episode. */
export function startUpload(file: File, seriesId: string | null, onProgress: (progress: UploadProgress) => void): UploadTask {
  const controller = new AbortController();
  return { done: upload(file, seriesId, onProgress, controller.signal), cancel: () => controller.abort() };
}

async function upload(
  file: File,
  seriesId: string | null,
  onProgress: (progress: UploadProgress) => void,
  signal: AbortSignal,
): Promise<VideoDetail> {
  if (!file.type.startsWith("video/")) {
    throw new Error(currentMessages().upload.notVideo);
  }
  onProgress({ phase: "reading", uploadedBytes: 0, totalBytes: file.size });
  const metadata = await inspectVideo(file);
  signal.throwIfAborted();

  const created = await api.createUpload({
    title: titleFromFileName(file.name),
    fileName: file.name,
    fileSize: file.size,
    contentType: file.type,
    seriesId,
  });
  let video: VideoDetail;
  try {
    // A cancel while the upload was being created lands here and aborts it.
    signal.throwIfAborted();
    const parts = await uploadParts(file, created, signal, (uploadedBytes) =>
      onProgress({ phase: "uploading", uploadedBytes, totalBytes: file.size }));
    onProgress({ phase: "finishing", uploadedBytes: file.size, totalBytes: file.size });
    ({ video } = await api.completeUpload(created.videoId, {
      parts,
      durationSec: metadata.durationSec,
      width: metadata.width,
      height: metadata.height,
    }));
  } catch (error) {
    await api.abortUpload(created.videoId).catch(() => undefined);
    throw error;
  }

  if (metadata.thumbnail !== null) {
    try {
      video = await uploadThumbnail(video.id, metadata.thumbnail);
    } catch {
      // The video is complete and plays without a thumbnail.
    }
  }
  return video;
}

async function uploadParts(
  file: File,
  plan: CreateUploadResponse,
  signal: AbortSignal,
  onUploaded: (bytes: number) => void,
): Promise<{ partNumber: number; etag: string }[]> {
  // One failed part stops the others, and canceling stops them all.
  const stop = new AbortController();
  const onCancel = () => stop.abort(signal.reason);
  if (signal.aborted) onCancel();
  signal.addEventListener("abort", onCancel, { once: true });

  const sentBytes = new Map<number, number>();
  const report = () => onUploaded([...sentBytes.values()].reduce((sum, bytes) => sum + bytes, 0));
  const parts: { partNumber: number; etag: string }[] = [];
  let nextPart = 1;

  async function sendParts(): Promise<void> {
    while (nextPart <= plan.partCount) {
      stop.signal.throwIfAborted();
      const partNumber = nextPart;
      nextPart += 1;
      const start = (partNumber - 1) * plan.partSize;
      const blob = file.slice(start, Math.min(start + plan.partSize, file.size));
      const etag = await sendPart(plan.videoId, partNumber, blob, stop.signal, (bytes) => {
        sentBytes.set(partNumber, bytes);
        report();
      });
      sentBytes.set(partNumber, blob.size);
      report();
      parts.push({ partNumber, etag });
    }
  }

  try {
    const workers = Array.from({ length: Math.min(PART_CONCURRENCY, plan.partCount) }, () =>
      sendParts().catch((error: unknown) => {
        stop.abort(error);
        throw error;
      }));
    await Promise.all(workers);
  } finally {
    signal.removeEventListener("abort", onCancel);
  }
  return parts.sort((a, b) => a.partNumber - b.partNumber);
}

async function sendPart(
  videoId: string,
  partNumber: number,
  blob: Blob,
  signal: AbortSignal,
  onBytes: (bytes: number) => void,
): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      // The URL of the part on every attempt, as albireo answers it.
      const { parts } = await api.partUrls(videoId, [partNumber]);
      const url = parts[0]?.url;
      if (url === undefined) throw new Error(currentMessages().upload.noPartUrl(partNumber));
      const etag = await put(url, blob, null, signal, onBytes);
      if (etag === null) throw new Error(currentMessages().upload.etagHidden);
      return etag;
    } catch (error) {
      if (signal.aborted || attempt >= PART_ATTEMPTS) throw error;
      onBytes(0);
      await wait(1000 * 2 ** (attempt - 1), signal);
    }
  }
}

/** Sends a new thumbnail of a video to albireo, commits it, and returns the video with it. */
export async function uploadThumbnail(videoId: string, thumbnail: Blob): Promise<VideoDetail> {
  const { url, contentType } = await api.thumbnailUpload(videoId);
  await putAgainWhileBusy(url, thumbnail, contentType, () => undefined);
  const { video } = await api.commitThumbnail(videoId);
  return video;
}

/** A PUT of a file that failed: status is 0 when the connection failed, or the status that albireo answered. */
export class TransferError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "TransferError";
    this.status = status;
  }
}

/**
 * Sends a whole file with a PUT, and again after a lost connection or a busy server, twice at
 * most. A PUT of the same file to the same URL may run twice without harm. The parts of a video
 * run again on their own (sendPart).
 */
export function putAgainWhileBusy(url: string, body: Blob, contentType: string | null, onBytes: (bytes: number) => void): Promise<string | null> {
  return retry(() => put(url, body, contentType, new AbortController().signal, onBytes), {
    attempts: 3,
    firstDelayMs: 1000,
    retryable: (error) => error instanceof TransferError && (error.status === 0 || isPassingStatus(error.status)),
  });
}

/** Sends a PUT with upload progress and returns the ETag response header. */
export function put(
  url: string,
  body: Blob,
  contentType: string | null,
  signal: AbortSignal,
  onBytes: (bytes: number) => void,
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    xhr.open("PUT", url);
    if (contentType !== null) xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (event) => onBytes(event.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.getResponseHeader("ETag"));
      else reject(new TransferError(currentMessages().upload.rejected(xhr.status), xhr.status));
    };
    xhr.onerror = () => reject(new TransferError(currentMessages().upload.failed, 0));
    xhr.onabort = () => reject(new DOMException("The upload was canceled.", "AbortError"));
    xhr.onloadend = () => signal.removeEventListener("abort", onAbort);
    if (signal.aborted) {
      reject(new DOMException("The upload was canceled.", "AbortError"));
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    xhr.send(body);
  });
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("The upload was canceled.", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function isCancellation(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

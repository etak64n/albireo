// Reads the length and size of a video in the browser and captures a
// thumbnail, so the Worker never has to decode video.

export interface VideoMetadata {
  durationSec: number | null;
  width: number | null;
  height: number | null;
  thumbnail: Blob | null;
}

const UNKNOWN: VideoMetadata = { durationSec: null, width: null, height: null, thumbnail: null };
const WAIT_MS = 15_000;
const THUMBNAIL_WIDTH = 640;
const THUMBNAIL_QUALITY = 0.82;

/** Returns what the browser can read. Videos it cannot decode upload without metadata. */
export async function inspectVideo(file: File): Promise<VideoMetadata> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  try {
    const loaded = waitFor(video, "loadeddata");
    video.src = url;
    await loaded;
    const durationSec = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
    const width = video.videoWidth > 0 ? video.videoWidth : null;
    const height = video.videoHeight > 0 ? video.videoHeight : null;
    const thumbnail = width !== null && height !== null ? await captureThumbnail(video, durationSec, width, height) : null;
    return { durationSec, width, height, thumbnail };
  } catch {
    return UNKNOWN;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

// Recordings often open on a blank screen, so the frame comes from a tenth of the way in.
async function captureThumbnail(video: HTMLVideoElement, durationSec: number | null, width: number, height: number): Promise<Blob | null> {
  try {
    if (durationSec !== null) {
      const seeked = waitFor(video, "seeked");
      video.currentTime = Math.min(durationSec * 0.1, 300);
      await seeked;
    }
    const scale = Math.min(1, THUMBNAIL_WIDTH / width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext("2d");
    if (context === null) return null;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", THUMBNAIL_QUALITY));
  } catch {
    return null;
  }
}

function waitFor(video: HTMLVideoElement, eventName: "loadeddata" | "seeked"): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => finish(new Error(`The browser did not fire ${eventName} in time.`)), WAIT_MS);
    const onEvent = () => finish(null);
    const onError = () => finish(new Error("The browser cannot decode this video."));
    function finish(error: Error | null) {
      window.clearTimeout(timer);
      video.removeEventListener(eventName, onEvent);
      video.removeEventListener("error", onError);
      if (error === null) resolve();
      else reject(error);
    }
    video.addEventListener(eventName, onEvent);
    video.addEventListener("error", onError);
  });
}

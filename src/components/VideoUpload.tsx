// Uploading: the Upload button in the top bar, the panel that shows the progress or
// the error, and the cover while a video is dragged over the page. The upload itself
// runs in src/uploads.tsx, above the pages.

import { Upload, X } from "lucide-react";
import { useRef, type ChangeEvent } from "react";
import { formatBytes } from "../lib/format.ts";
import { useUploads } from "../uploads.tsx";
import { Button } from "./ui/button.tsx";

/** Opens the file picker and uploads the chosen video. */
export function UploadButton() {
  const uploader = useUploads();
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) uploader.start(file);
  }

  return (
    <>
      <input ref={inputRef} type="file" accept="video/*" onChange={handleChange} className="hidden" />
      <Button variant="primary" onClick={() => inputRef.current?.click()} disabled={uploader.progress !== null} aria-label="Upload">
        <Upload aria-hidden="true" />
        <span className="max-md:hidden">Upload</span>
      </Button>
    </>
  );
}

/** Progress of the running upload, or why the last one failed. Nothing when idle. */
export function UploadPanel() {
  const uploader = useUploads();
  const { progress, error } = uploader;
  if (progress === null) {
    if (error === "") return null;
    return (
      <div className="error-box flex items-start justify-between gap-3">
        <p className="min-w-0 break-words">{error}</p>
        <Button variant="ghost" size="icon" className="-my-1 size-7 shrink-0 text-danger hover:bg-transparent" aria-label="Dismiss" onClick={uploader.dismissError}>
          <X />
        </Button>
      </div>
    );
  }

  const percent = progress.totalBytes === 0 ? 0 : Math.floor((progress.uploadedBytes / progress.totalBytes) * 100);
  const label = progress.phase === "reading"
    ? "Reading the video..."
    : progress.phase === "finishing"
      ? "Finishing the upload..."
      : `Uploading ${percent}% (${formatBytes(progress.uploadedBytes)} of ${formatBytes(progress.totalBytes)})`;

  return (
    <section className="panel grid gap-2 p-3" aria-label="Upload">
      <div className="flex min-h-[30px] items-center justify-between gap-3">
        <p role="status" className="min-w-0 truncate font-bold tabular-nums">{label}</p>
        {progress.phase !== "finishing" && (
          <Button variant="secondary" onClick={uploader.cancel}>
            Cancel
          </Button>
        )}
      </div>
      <div className="h-1.5 overflow-hidden rounded-ui bg-raised">
        <div className="h-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
      </div>
    </section>
  );
}

/** Covers the page while a video can be dropped on it. */
export function DropOverlay() {
  const uploader = useUploads();
  if (!uploader.dragging || uploader.progress !== null) return null;
  return (
    <div className="pointer-events-none fixed inset-3 z-50 grid place-items-center rounded-ui border-2 border-dashed border-accent bg-page/90 backdrop-blur-sm">
      <p className="flex items-center gap-2 font-heading text-lg font-bold text-heading">
        <Upload aria-hidden="true" />
        Drop to upload
      </p>
    </div>
  );
}

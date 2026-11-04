// The video upload that runs. It lives above the pages, so the upload goes on, and its
// progress stays in view, while you move around the library.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isCancellation, startUpload, type UploadProgress, type UploadTask } from "./lib/upload.ts";
import { useLibrary } from "./library.tsx";

export interface Uploads {
  /** Progress of the running upload, or null when no upload runs. */
  progress: UploadProgress | null;
  /** Why the last upload failed, or "" when it did not fail. */
  error: string;
  /** Whether files are being dragged over the page. */
  dragging: boolean;
  /** How many uploads finished. Lists that show new videos load again when it changes. */
  completed: number;
  start: (file: File) => void;
  cancel: () => void;
  dismissError: () => void;
  /** Names the series that uploads join: the one whose page is open, or null. */
  setTargetSeries: (seriesId: string | null) => void;
}

const UploadsContext = createContext<Uploads | null>(null);

export function UploadsProvider({ children }: { children: ReactNode }) {
  const { refresh } = useLibrary();
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [completed, setCompleted] = useState(0);
  const taskRef = useRef<UploadTask | null>(null);
  const seriesRef = useRef<string | null>(null);

  const start = useCallback(
    (file: File) => {
      // One upload runs at a time.
      if (taskRef.current !== null) return;
      setError("");
      const task = startUpload(file, seriesRef.current, setProgress);
      taskRef.current = task;
      task.done
        .then(() => {
          setCompleted((count) => count + 1);
          // A new episode can change the cover of its series.
          void refresh();
        })
        .catch((err: unknown) => {
          if (!isCancellation(err)) setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          taskRef.current = null;
          setProgress(null);
        });
    },
    [refresh],
  );

  // A video dropped anywhere on the page starts an upload.
  useEffect(() => {
    // dragenter and dragleave also fire when the pointer moves between elements,
    // so the page counts them to know when the files leave the window.
    let depth = 0;
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;

    function onDragEnter(event: DragEvent) {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setDragging(true);
    }
    function onDragOver(event: DragEvent) {
      if (hasFiles(event)) event.preventDefault();
    }
    function onDragLeave(event: DragEvent) {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    }
    function onDrop(event: DragEvent) {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      if (taskRef.current !== null) return;
      const file = event.dataTransfer?.files[0];
      if (file?.type.startsWith("video/")) start(file);
      else setError("Please drop a video file.");
    }

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [start]);

  // Closing or reloading the tab stops the upload, so the browser asks first.
  const uploading = progress !== null;
  useEffect(() => {
    if (!uploading) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uploading]);

  const cancel = useCallback(() => taskRef.current?.cancel(), []);
  const dismissError = useCallback(() => setError(""), []);
  const setTargetSeries = useCallback((seriesId: string | null) => {
    seriesRef.current = seriesId;
  }, []);

  const value = useMemo(
    () => ({ progress, error, dragging, completed, start, cancel, dismissError, setTargetSeries }),
    [progress, error, dragging, completed, start, cancel, dismissError, setTargetSeries],
  );
  return <UploadsContext.Provider value={value}>{children}</UploadsContext.Provider>;
}

export function useUploads(): Uploads {
  const uploads = useContext(UploadsContext);
  if (uploads === null) throw new Error("useUploads needs an UploadsProvider around the page.");
  return uploads;
}

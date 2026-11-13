// The queue of video uploads. It lives above the pages, so the uploads go on, and their
// progress stays in view, while you move around the library. The videos upload one at a
// time, each with its parts in parallel (src/lib/upload.ts). The files chosen or dropped
// together join the end of the queue in the order of their names (src/lib/upload-queue.ts),
// and a video that fails leaves the next one to start.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useToast } from "./components/ui/toast.tsx";
import { currentMessages } from "./i18n.ts";
import { isCancellation, startUpload, type UploadProgress, type UploadTask } from "./lib/upload.ts";
import { inNameOrder, isVideo } from "./lib/upload-queue.ts";
import { useLibrary } from "./library.tsx";

export type UploadState = "waiting" | "uploading" | "done" | "failed";

/** A video in the queue. */
export interface QueuedUpload {
  id: number;
  file: File;
  /** The series that the video joins: the one whose page was open when it was added, or null. */
  seriesId: string | null;
  state: UploadState;
  /** Progress while the video uploads, or null. */
  progress: UploadProgress | null;
  /** Why the upload failed, or "". */
  error: string;
}

export interface Uploads {
  /**
   * The videos in the order that they upload. Uploaded ones stay until the queue runs out,
   * and failed ones until they are dismissed.
   */
  queue: QueuedUpload[];
  /** Names the chosen files that are not videos, which the queue left out, or "". */
  notice: string;
  /** Whether files are being dragged over the page. */
  dragging: boolean;
  /** How many uploads finished. Lists that show new videos load again when it changes. */
  completed: number;
  /**
   * Puts the videos among the files at the end of the queue, in the order of their names.
   * They join the series that is named, no series for null, or else the series whose page is open.
   */
  add: (files: ArrayLike<File>, seriesId?: string | null) => void;
  /** Stops the upload of a video, or takes the video out of the queue before it starts. */
  cancel: (id: number) => void;
  /** Stops the upload that runs, and takes every waiting video out of the queue. */
  cancelAll: () => void;
  /** Takes the failed uploads and the notice off the panel. */
  dismiss: () => void;
  /** Names the series that the videos added from now on join: the one whose page is open, or null. */
  setTargetSeries: (seriesId: string | null) => void;
}

const UploadsContext = createContext<Uploads | null>(null);

export function UploadsProvider({ children }: { children: ReactNode }) {
  const { refresh } = useLibrary();
  const toast = useToast();
  const [queue, setQueue] = useState<QueuedUpload[]>([]);
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const [completed, setCompleted] = useState(0);
  const running = useRef<{ id: number; task: UploadTask } | null>(null);
  const lastId = useRef(0);
  const seriesRef = useRef<string | null>(null);

  const add = useCallback((files: ArrayLike<File>, target?: string | null) => {
    const chosen = Array.from(files);
    const others = chosen.filter((file) => !isVideo(file));
    setNotice(others.length === 0 ? "" : currentMessages().upload.notVideos(others.map((file) => file.name)));
    const seriesId = target === undefined ? seriesRef.current : target;
    const added = inNameOrder(chosen.filter(isVideo)).map((file): QueuedUpload => {
      lastId.current += 1;
      return { id: lastId.current, file, seriesId, state: "waiting", progress: null, error: "" };
    });
    if (added.length > 0) setQueue((items) => [...items, ...added]);
  }, []);

  // Starts the next video when none uploads. When the queue runs out, the uploaded videos
  // leave the panel, which keeps the failed ones until they are dismissed.
  useEffect(() => {
    if (running.current !== null) return;
    const next = queue.find((item) => item.state === "waiting");
    if (next === undefined) {
      if (queue.some((item) => item.state === "done")) setQueue((items) => items.filter((item) => item.state !== "done"));
      return;
    }
    const update = (fields: Partial<QueuedUpload>) =>
      setQueue((items) => items.map((item) => (item.id === next.id ? { ...item, ...fields } : item)));
    const task = startUpload(next.file, next.seriesId, (progress) => update({ progress }));
    running.current = { id: next.id, task };
    update({ state: "uploading" });
    task.done.then(
      (video) => {
        running.current = null;
        update({ state: "done", progress: null });
        setCompleted((count) => count + 1);
        const messages = currentMessages();
        toast.success(messages.toast.uploaded(video.title), { label: messages.toast.open, to: `/videos/${video.id}` });
        // A new episode can change the cover of its series.
        void refresh();
      },
      (err: unknown) => {
        running.current = null;
        if (isCancellation(err)) {
          setQueue((items) => items.filter((item) => item.id !== next.id));
          return;
        }
        update({ state: "failed", progress: null, error: err instanceof Error ? err.message : String(err) });
        toast.error(currentMessages().toast.uploadFailed(next.file.name));
      },
    );
  }, [queue, refresh, toast]);

  // Videos dropped anywhere on the page join the queue.
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
      add(event.dataTransfer?.files ?? []);
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
  }, [add]);

  // Closing or reloading the tab stops the queue, so the browser asks first.
  const busy = queue.some((item) => item.state === "waiting" || item.state === "uploading");
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  const cancel = useCallback((id: number) => {
    if (running.current?.id === id) running.current.task.cancel();
    else setQueue((items) => items.filter((item) => item.id !== id || item.state !== "waiting"));
  }, []);
  const cancelAll = useCallback(() => {
    setQueue((items) => items.filter((item) => item.state !== "waiting"));
    running.current?.task.cancel();
  }, []);
  const dismiss = useCallback(() => {
    setNotice("");
    setQueue((items) => items.filter((item) => item.state !== "failed"));
  }, []);
  const setTargetSeries = useCallback((seriesId: string | null) => {
    seriesRef.current = seriesId;
  }, []);

  const value = useMemo(
    () => ({ queue, notice, dragging, completed, add, cancel, cancelAll, dismiss, setTargetSeries }),
    [queue, notice, dragging, completed, add, cancel, cancelAll, dismiss, setTargetSeries],
  );
  return <UploadsContext.Provider value={value}>{children}</UploadsContext.Provider>;
}

export function useUploads(): Uploads {
  const uploads = useContext(UploadsContext);
  if (uploads === null) throw new Error("useUploads needs an UploadsProvider around the page.");
  return uploads;
}

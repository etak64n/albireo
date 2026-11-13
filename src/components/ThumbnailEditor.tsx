import { Film } from "lucide-react";
import { useRef, useState } from "react";
import type { VideoDetail } from "../../shared/api.ts";
import { useT } from "../i18n.ts";
import { formatDuration } from "../lib/format.ts";
import { frameToJpeg } from "../lib/media.ts";
import { uploadThumbnail } from "../lib/upload.ts";
import { Thumbnail } from "./Thumbnail.tsx";
import { Button } from "./ui/button.tsx";
import { Slider } from "./ui/slider.tsx";
import { useToast } from "./ui/toast.tsx";

/**
 * The thumbnail of a video on its edit page. Choose a frame shows the video in its place with
 * a slider under it, and Use this frame makes the frame that the video shows the thumbnail.
 */
export function ThumbnailEditor({ video, onChange }: { video: VideoDetail; onChange: (video: VideoDetail) => void }) {
  const [choosing, setChoosing] = useState(false);
  const t = useT();

  if (choosing) {
    return (
      <FramePicker
        video={video}
        onDone={(changed) => {
          if (changed !== null) onChange(changed);
          setChoosing(false);
        }}
      />
    );
  }
  return (
    <div className="grid gap-3">
      <Thumbnail url={video.thumbnailUrl} durationSec={video.durationSec} />
      <div>
        <Button onClick={() => setChoosing(true)}>
          <Film aria-hidden="true" />
          {t.thumbnail.chooseFrame}
        </Button>
      </div>
    </div>
  );
}

/**
 * The video without its controls, and a slider that moves it to any place. It opens a tenth of
 * the way in, as the thumbnail of an upload does, since recordings often open on a blank screen.
 * The video comes from albireo, the origin of the page, so the page may read the pixels of a frame.
 */
function FramePicker({ video, onDone }: { video: VideoDetail; onDone: (changed: VideoDetail | null) => void }) {
  const t = useT();
  const toast = useToast();
  const element = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(video.durationSec ?? 0);
  const [time, setTime] = useState(() => Math.min((video.durationSec ?? 0) * 0.1, 300));
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);

  function seek(seconds: number) {
    setTime(seconds);
    const current = element.current;
    if (current !== null) current.currentTime = seconds;
  }

  async function saveFrame() {
    const current = element.current;
    if (current === null) return;
    setSaving(true);
    try {
      // A frame that is still on its way would give the picture of the place before.
      if (current.seeking) await new Promise((resolve) => current.addEventListener("seeked", resolve, { once: true }));
      const thumbnail = await frameToJpeg(current);
      if (thumbnail === null) throw new Error(t.thumbnail.cannotRead);
      const changed = await uploadThumbnail(video.id, thumbnail);
      toast.success(t.toast.thumbnailChanged);
      onDone(changed);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-3">
      <video
        ref={element}
        src={video.playbackUrl}
        preload="auto"
        muted
        playsInline
        className="aspect-video w-full rounded-md bg-black object-contain"
        onLoadedData={(event) => {
          const current = event.currentTarget;
          if (Number.isFinite(current.duration) && current.duration > 0) setDuration(current.duration);
          current.currentTime = time;
          setReady(true);
        }}
        onError={() => toast.error(t.thumbnail.cannotRead)}
      />
      <Slider
        min={0}
        max={Math.max(duration, 0.1)}
        step={0.1}
        value={[time]}
        onValueChange={([value]) => seek(value ?? 0)}
        disabled={!ready}
        aria-label={t.thumbnail.place}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="numeric text-xs text-label">
          {formatDuration(time)} / {formatDuration(duration)}
        </span>
        <div className="flex gap-2">
          <Button onClick={() => onDone(null)}>{t.common.cancel}</Button>
          <Button variant="primary" onClick={() => void saveFrame()} disabled={!ready || saving}>
            {saving ? t.common.saving : t.thumbnail.useFrame}
          </Button>
        </div>
      </div>
    </div>
  );
}

import { Play } from "lucide-react";
import { formatDuration } from "../lib/format.ts";

/** A 16:9 picture of a video. Without a thumbnail, a play mark stands in for it. */
export function Thumbnail({ url, durationSec = null }: { url: string | null; durationSec?: number | null }) {
  return (
    <div className="relative aspect-video overflow-hidden bg-raised">
      {url !== null ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          className="size-full object-cover transition duration-500 ease-out group-hover:scale-[1.03]"
        />
      ) : (
        <div className="grid size-full place-items-center text-accent">
          <Play className="size-8 fill-current" aria-hidden="true" />
        </div>
      )}
      {durationSec !== null && (
        <span className="absolute right-1.5 bottom-1.5 rounded-ui bg-black/70 px-1.5 py-0.5 text-[11px] font-bold text-white tabular-nums backdrop-blur-sm">
          {formatDuration(durationSec)}
        </span>
      )}
    </div>
  );
}

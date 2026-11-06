import { Play } from "lucide-react";
import { formatDuration } from "../lib/format.ts";
import { cn } from "../lib/utils.ts";

/**
 * A 16:9 picture of a video, with its length over the lower right corner. Without a
 * thumbnail, a play mark stands in for it.
 */
export function Thumbnail({ url, durationSec = null, className }: { url: string | null; durationSec?: number | null; className?: string }) {
  return (
    <div className={cn("relative aspect-video overflow-hidden rounded-md bg-surface-subdued", className)}>
      {url !== null ? (
        <img src={url} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        <div className="grid size-full place-items-center text-placeholder">
          <Play className="size-8 fill-current" aria-hidden="true" />
        </div>
      )}
      {durationSec !== null && (
        <span className="numeric absolute right-1.5 bottom-1.5 rounded-xs bg-overlay px-1.5 text-xs leading-5 text-on-overlay">
          {formatDuration(durationSec)}
        </span>
      )}
    </div>
  );
}

import type { VideoSummary } from "../../shared/api.ts";
import { useT } from "../i18n.ts";
import { Skeleton } from "./ui/skeleton.tsx";
import { VideoCard } from "./VideoCard.tsx";

/**
 * The columns of every grid of cards, by the width of the page beside the sidebar: one
 * on phones, two from 448px, and three from 768px.
 */
export const GRID_CLASS = "grid grid-cols-1 gap-x-6 gap-y-8 @md:grid-cols-2 @3xl:grid-cols-3";

export function VideoGrid({ videos }: { videos: VideoSummary[] }) {
  if (videos.length === 0) return null;
  return (
    <div className={GRID_CLASS}>
      {videos.map((video) => (
        <VideoCard key={video.id} video={video} />
      ))}
    </div>
  );
}

/** Cards of gray blocks in place of videos that load. */
export function VideoGridSkeleton({ count = 6 }: { count?: number }) {
  const t = useT();
  return (
    <div className={GRID_CLASS} role="status" aria-label={t.common.loading}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="grid content-start gap-3">
          <Skeleton className="aspect-video rounded-md" />
          <div className="flex gap-3">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="grid flex-1 content-start gap-2 pt-0.5">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-3 w-2/5" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

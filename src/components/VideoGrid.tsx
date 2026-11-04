import type { VideoSummary } from "../../shared/api.ts";
import { Skeleton } from "./ui/skeleton.tsx";
import { VideoCard } from "./VideoCard.tsx";

/** The columns of every grid of cards: one on phones, two on tablets, three from laptops. */
export const GRID_CLASS = "grid grid-cols-1 gap-x-5 gap-y-6 sm:grid-cols-2 lg:grid-cols-3";

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
  return (
    <div className={GRID_CLASS} role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="card">
          <Skeleton className="aspect-video" />
          <div className="flex gap-3 px-4 py-3.5">
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

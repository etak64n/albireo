import { Play } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { VideoSummary } from "../../shared/api.ts";
import { api } from "../api.ts";
import { Shell } from "../components/Shell.tsx";
import { Thumbnail } from "../components/Thumbnail.tsx";
import { buttonVariants } from "../components/ui/button.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { VideoGrid, VideoGridSkeleton } from "../components/VideoGrid.tsx";
import { formatDate } from "../lib/format.ts";
import { usePageTitle } from "../lib/title.ts";
import { Link } from "../router.tsx";
import { useUploads } from "../uploads.tsx";

/** Videos recommended to the signed-in person: the first one large, then the rest. */
export function HomePage() {
  const [videos, setVideos] = useState<VideoSummary[] | null>(null);
  const [error, setError] = useState("");
  const { completed } = useUploads();
  usePageTitle(null);

  const load = useCallback(async () => {
    try {
      setVideos((await api.getRecommendations()).videos);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // The list loads again when an upload finishes, so the new video shows up.
  useEffect(() => {
    void load();
  }, [load, completed]);

  const [first, ...rest] = videos ?? [];

  return (
    <Shell>
      <h1 className="sr-only">Home</h1>
      {error && <p className="error-box">{error}</p>}
      {videos === null && error === "" && (
        <>
          <FeatureSkeleton />
          <VideoGridSkeleton />
        </>
      )}
      {videos !== null &&
        first !== undefined && (
          <>
            <Feature video={first} />
            {rest.length > 0 && (
              <section className="grid gap-3">
                <h2 className="heading text-xl">Recommended</h2>
                <VideoGrid videos={rest} />
              </section>
            )}
          </>
        )}
    </Shell>
  );
}

function FeatureSkeleton() {
  return (
    <div className="card grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" aria-hidden="true">
      <Skeleton className="aspect-video" />
      <div className="grid content-center gap-3 p-6 lg:p-8">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="mt-2 h-9 w-24" />
      </div>
    </div>
  );
}

/** The video recommended first, large: its picture, and beside it the title and the way to play it. */
function Feature({ video }: { video: VideoSummary }) {
  const byline = [video.uploader?.displayName, formatDate(video.createdAt)].filter((part) => part !== undefined && part !== "").join(" · ");
  return (
    <Link
      to={`/videos/${video.id}`}
      className="group card grid animate-appear hover:shadow-lift lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
    >
      <Thumbnail url={video.thumbnailUrl} durationSec={video.durationSec} />
      <div className="grid content-center gap-3 p-6 lg:p-8">
        <h2 className="line-clamp-3 font-heading text-2xl leading-tight font-bold text-heading lg:text-3xl">{video.title}</h2>
        <p className="text-[13px] font-bold text-muted">{byline}</p>
        <span className={buttonVariants({ variant: "primary", size: "lg", className: "mt-2 w-fit" })}>
          <Play className="fill-current" aria-hidden="true" />
          Play
        </span>
      </div>
    </Link>
  );
}

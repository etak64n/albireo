import { Play } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { VideoSummary } from "../../shared/api.ts";
import { api } from "../api.ts";
import { Section } from "../components/Page.tsx";
import { Shell } from "../components/Shell.tsx";
import { Thumbnail } from "../components/Thumbnail.tsx";
import { buttonVariants } from "../components/ui/button.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { VideoGrid, VideoGridSkeleton } from "../components/VideoGrid.tsx";
import { useT } from "../i18n.ts";
import { formatDate } from "../lib/format.ts";
import { usePageTitle } from "../lib/title.ts";
import { Link } from "../router.tsx";
import { useUploads } from "../uploads.tsx";

/** Videos recommended to the signed-in person: the first one large, then the rest. */
export function HomePage() {
  const [videos, setVideos] = useState<VideoSummary[] | null>(null);
  const [error, setError] = useState("");
  const { completed } = useUploads();
  const t = useT();
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
      <h1 className="sr-only">{t.shell.home}</h1>
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
              <Section title={t.home.recommended}>
                <VideoGrid videos={rest} />
              </Section>
            )}
          </>
        )}
    </Shell>
  );
}

function FeatureSkeleton() {
  return (
    <div className={FEATURE_CLASS} aria-hidden="true">
      <Skeleton className="aspect-video rounded-lg" />
      <div className="grid content-center gap-3">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="mt-2 h-9 w-24" />
      </div>
    </div>
  );
}

/** The picture of the first video takes two thirds of a wide page, and the title the rest. */
const FEATURE_CLASS = "-m-3 grid gap-x-8 gap-y-4 rounded-lg p-3 @3xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]";

/** The video recommended first, large: its picture, and beside it the title and the way to play it. */
function Feature({ video }: { video: VideoSummary }) {
  const t = useT();
  const byline = [video.uploader?.displayName, formatDate(video.createdAt)].filter((part) => part !== undefined && part !== "").join(" · ");
  return (
    <Link to={`/videos/${video.id}`} className={`${FEATURE_CLASS} transition-colors duration-150 hover:bg-surface-hover`}>
      <Thumbnail url={video.thumbnailUrl} durationSec={video.durationSec} className="rounded-lg" />
      <div className="grid content-center justify-items-start gap-2">
        <h2 className="line-clamp-3 text-display font-bold break-words text-heading">{video.title}</h2>
        <p className="numeric text-base text-label">{byline}</p>
        <span className={buttonVariants({ variant: "primary", size: "lg", className: "mt-3" })}>
          <Play className="fill-current" aria-hidden="true" />
          {t.home.play}
        </span>
      </div>
    </Link>
  );
}

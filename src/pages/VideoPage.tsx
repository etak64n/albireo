import { ChevronLeft, ChevronRight } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { EpisodeLink, VideoDetail, VideoSeries } from "../../shared/api.ts";
import { ApiError, api } from "../api.ts";
import { Attachments } from "../components/Attachments.tsx";
import { Comments } from "../components/Comments.tsx";
import { Shell } from "../components/Shell.tsx";
import { VideoEditForm } from "../components/VideoEditForm.tsx";
import { Button } from "../components/ui/button.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { usePageTitle } from "../lib/title.ts";
import { Link, navigate } from "../router.tsx";
import { NotFoundPage } from "./NotFoundPage.tsx";

// Video.js loads with the first video page, so the other pages open without it.
const VideoPlayer = lazy(async () => ({ default: (await import("../components/VideoPlayer.tsx")).VideoPlayer }));

/** History state of a page that the end of the previous episode opened. */
interface ContinueState {
  autoplay: true;
}

function isContinueState(state: unknown): state is ContinueState {
  return typeof state === "object" && state !== null && "autoplay" in state && state.autoplay === true;
}

export function VideoPage({ id }: { id: string }) {
  const [video, setVideo] = useState<VideoDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  // The page plays at once when the previous episode of the series just ended.
  const [autoPlay] = useState(() => isContinueState(window.history.state));
  const player = useRef<HTMLVideoElement>(null);
  usePageTitle(video?.title ?? null);

  useEffect(() => {
    let active = true;
    api
      .getVideo(id)
      .then(({ video: loaded }) => {
        if (active) setVideo(loaded);
      })
      .catch((err: unknown) => {
        if (active) setError(err);
      });
    return () => {
      active = false;
    };
  }, [id]);

  // A time in a comment plays the video from there, and the page scrolls up to the player.
  function seek(seconds: number) {
    const element = player.current;
    if (element === null) return;
    element.currentTime = seconds;
    void element.play().catch(() => undefined);
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: calm ? "auto" : "smooth" });
  }

  function playNext() {
    const next = video?.series?.next;
    if (next !== undefined && next !== null) navigate(`/videos/${next.id}`, { autoplay: true } satisfies ContinueState);
  }

  if (error instanceof ApiError && error.status === 404) return <NotFoundPage />;

  return (
    <Shell>
      <div className="mx-auto grid w-full max-w-[1000px] gap-4">
        {error !== null ? (
          <p className="error-box">{error instanceof Error ? error.message : String(error)}</p>
        ) : video === null ? (
          <>
            <PlayerPlaceholder />
            <div className="panel grid gap-3 p-5" role="status" aria-label="Loading">
              <Skeleton className="h-7 w-2/3" />
              <Skeleton className="h-4 w-1/4" />
            </div>
          </>
        ) : (
          <>
            {/* On phones the player spans the screen from edge to edge. */}
            <div className="-mx-4 sm:mx-0">
              <Suspense fallback={<PlayerPlaceholder />}>
                <VideoPlayer video={video} videoRef={player} autoPlay={autoPlay} onEnded={playNext} />
              </Suspense>
            </div>
            {video.series !== null && <SeriesBar series={video.series} />}
            <VideoEditForm video={video} onSaved={setVideo} />
            <Attachments video={video} onChange={(attachments) => setVideo((current) => current && { ...current, attachments })} />
            <Comments videoId={video.id} durationSec={video.durationSec} onSeek={seek} />
          </>
        )}
      </div>
    </Shell>
  );
}

/** The box of the player while the video or the player loads. */
function PlayerPlaceholder() {
  return <Skeleton className="-mx-4 aspect-video sm:mx-0" />;
}

/** The series of the video, and the previous and the next episodes. */
function SeriesBar({ series }: { series: VideoSeries }) {
  return (
    <nav className="panel flex flex-wrap items-center justify-between gap-2 px-4 py-2.5" aria-label="Series">
      <Link to={`/series/${series.id}`} className="group flex min-w-0 items-baseline gap-2">
        <span className="truncate font-heading text-[15px] font-bold text-heading group-hover:underline">{series.title}</span>
        <span className="shrink-0 text-xs font-bold text-muted">Episode {series.episode}</span>
      </Link>
      <div className="flex gap-2">
        <EpisodeButton episode={series.previous} direction="previous" />
        <EpisodeButton episode={series.next} direction="next" />
      </div>
    </nav>
  );
}

function EpisodeButton({ episode, direction }: { episode: EpisodeLink | null; direction: "previous" | "next" }) {
  const label = direction === "previous" ? "Previous" : "Next";
  const content = direction === "previous" ? (
    <>
      <ChevronLeft aria-hidden="true" />
      {label}
    </>
  ) : (
    <>
      {label}
      <ChevronRight aria-hidden="true" />
    </>
  );
  if (episode === null) return <Button disabled>{content}</Button>;
  return (
    <Button asChild>
      <Link to={`/videos/${episode.id}`}>
        <span className="sr-only">{`${label}: ${episode.title}`}</span>
        <span aria-hidden="true" className="flex items-center gap-1.5">
          {content}
        </span>
      </Link>
    </Button>
  );
}

import { ChevronLeft, ChevronRight } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { EpisodeLink, VideoDetail, VideoSeries } from "../../shared/api.ts";
import { ApiError, api } from "../api.ts";
import { Attachments } from "../components/Attachments.tsx";
import { Avatar } from "../components/Avatar.tsx";
import { Comments } from "../components/Comments.tsx";
import { Breadcrumb, DetailList, Section } from "../components/Page.tsx";
import { Shell } from "../components/Shell.tsx";
import { StarRating } from "../components/StarRating.tsx";
import { VideoEditForm } from "../components/VideoEditForm.tsx";
import { Button } from "../components/ui/button.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { formatDate, formatDuration } from "../lib/format.ts";
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

/**
 * The page of one video: the player, the title and the description, the attachments,
 * and the comments, and beside them on wide pages the details and the series. On
 * narrow pages the details come after the description.
 */
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
      {error !== null ? (
        <p className="error-box">{error instanceof Error ? error.message : String(error)}</p>
      ) : video === null ? (
        <VideoSkeleton />
      ) : (
        <div className="grid gap-10 @4xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="grid min-w-0 content-start gap-10">
            <div className="grid gap-6">
              {video.series !== null ? (
                <Breadcrumb to={`/series/${video.series.id}`}>{video.series.title}</Breadcrumb>
              ) : (
                <Breadcrumb to="/videos">All videos</Breadcrumb>
              )}
              {/* On phones the player spans the screen from edge to edge. */}
              <div className="-mx-4 sm:mx-0">
                <Suspense fallback={<PlayerPlaceholder />}>
                  <VideoPlayer video={video} videoRef={player} autoPlay={autoPlay} onEnded={playNext} />
                </Suspense>
              </div>
              <VideoEditForm video={video} onSaved={setVideo} />
            </div>
            <div className="@4xl:hidden">
              <VideoAside video={video} onChange={setVideo} layout="row" />
            </div>
            <Attachments video={video} onChange={(attachments) => setVideo((current) => current && { ...current, attachments })} />
            <Comments videoId={video.id} durationSec={video.durationSec} onSeek={seek} />
          </div>
          <aside className="hidden @4xl:block">
            <VideoAside video={video} onChange={setVideo} layout="column" />
          </aside>
        </div>
      )}
    </Shell>
  );
}

function VideoSkeleton() {
  return (
    <div className="grid gap-10 @4xl:grid-cols-[minmax(0,1fr)_280px]" role="status" aria-label="Loading">
      <div className="grid content-start gap-6">
        <Skeleton className="h-5 w-24" />
        <PlayerPlaceholder />
        <Skeleton className="h-9 w-2/3" />
      </div>
      <div className="hidden content-start gap-4 @4xl:grid">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-10 w-32" />
      </div>
    </div>
  );
}

/** The box of the player while the video or the player loads. */
function PlayerPlaceholder() {
  return <Skeleton className="-mx-4 aspect-video rounded-md sm:mx-0" />;
}

/**
 * The details of the video, and its series with the previous and the next episodes: in
 * the narrow column beside the video on wide pages, and in rows under the title on
 * narrow pages.
 */
function VideoAside({ video, onChange, layout }: { video: VideoDetail; onChange: (video: VideoDetail) => void; layout: "column" | "row" }) {
  const details = [
    {
      label: "Uploaded by",
      value:
        video.uploader === null ? (
          "—"
        ) : (
          <Link to={`/users/${video.uploader.id}`} className="flex w-fit items-center gap-2 font-semibold text-accent hover:underline">
            <Avatar url={video.uploader.avatarUrl} size="tiny" />
            {video.uploader.displayName}
          </Link>
        ),
    },
    { label: "Date", value: <span className="numeric">{formatDate(video.createdAt)}</span> },
    ...(video.durationSec === null ? [] : [{ label: "Length", value: <span className="numeric">{formatDuration(video.durationSec)}</span> }]),
    ...(video.width === null || video.height === null
      ? []
      : [{ label: "Resolution", value: <span className="numeric">{`${video.width}×${video.height}`}</span> }]),
    { label: "Rating", value: <StarRating videoId={video.id} rating={video.rating} onRated={(rating) => onChange({ ...video, rating })} /> },
  ];
  return (
    <div className={layout === "column" ? "grid content-start gap-10" : "grid content-start gap-8"}>
      <Section title="Details">
        <DetailList items={details} layout={layout} />
      </Section>
      {video.series !== null && <SeriesNav series={video.series} />}
    </div>
  );
}

/** The series of the video: its name, the number of the episode, and the previous and the next episodes. */
function SeriesNav({ series }: { series: VideoSeries }) {
  return (
    <Section title="Series">
      <nav className="grid gap-3" aria-label="Series">
        <div className="grid gap-1">
          <Link to={`/series/${series.id}`} className="w-fit text-sm font-bold break-words text-accent hover:underline">
            {series.title}
          </Link>
          <span className="text-sm text-label">Episode {series.episode}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <EpisodeButton episode={series.previous} direction="previous" />
          <EpisodeButton episode={series.next} direction="next" />
        </div>
      </nav>
    </Section>
  );
}

function EpisodeButton({ episode, direction }: { episode: EpisodeLink | null; direction: "previous" | "next" }) {
  const label = direction === "previous" ? "Previous" : "Next";
  const content =
    direction === "previous" ? (
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
        <span aria-hidden="true" className="flex items-center gap-1">
          {content}
        </span>
      </Link>
    </Button>
  );
}

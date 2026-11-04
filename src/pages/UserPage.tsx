import { useCallback, useEffect, useState } from "react";
import type { SeriesSummary, UserProfile, VideoSummary } from "../../shared/api.ts";
import { ApiError, api } from "../api.ts";
import { Avatar } from "../components/Avatar.tsx";
import { SeriesGrid } from "../components/SeriesGrid.tsx";
import { Shell } from "../components/Shell.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { VideoGrid, VideoGridSkeleton } from "../components/VideoGrid.tsx";
import { usePageTitle } from "../lib/title.ts";
import { Link } from "../router.tsx";
import { useSession } from "../session.tsx";
import { useUploads } from "../uploads.tsx";
import { NotFoundPage } from "./NotFoundPage.tsx";
import { Button } from "../components/ui/button.tsx";

/** The page of one person: their picture, name, and bio, and the series and videos that they made. */
export function UserPage({ id }: { id: string }) {
  const { me } = useSession();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [series, setSeries] = useState<SeriesSummary[]>([]);
  const [videos, setVideos] = useState<VideoSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const isMe = id === me.id;
  const { completed } = useUploads();

  const load = useCallback(async () => {
    try {
      const [loaded, theirSeries, page] = await Promise.all([api.getUser(id), api.listSeries(id), api.listVideos(null, id)]);
      setUser(loaded.user);
      setSeries(theirSeries.series);
      setVideos(page.videos);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err);
    }
  }, [id]);

  // The videos load again when an upload finishes, so a new one shows on your own page.
  useEffect(() => {
    void load();
  }, [load, completed]);

  async function loadMore() {
    if (nextCursor === null) return;
    setLoadingMore(true);
    try {
      const page = await api.listVideos(nextCursor, id);
      setVideos((current) => [...current, ...page.videos]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err);
    } finally {
      setLoadingMore(false);
    }
  }

  if (error instanceof ApiError && error.status === 404) return <NotFoundPage />;
  // Your own page shows your latest profile at once, as you may have just changed it in the settings.
  const profile = isMe ? me : user;
  usePageTitle(user === null ? null : (profile?.displayName ?? null));

  return (
    <Shell>
      {error !== null ? (
        <p className="error-box">{error instanceof Error ? error.message : String(error)}</p>
      ) : user === null || profile === null ? (
        <>
          <div className="flex items-center gap-6 border-b border-line pb-8" role="status" aria-label="Loading">
            <Skeleton className="size-24 rounded-full" />
            <div className="grid flex-1 gap-3">
              <Skeleton className="h-9 w-1/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          </div>
          <VideoGridSkeleton count={3} />
        </>
      ) : (
        <>
          <section className="flex animate-appear flex-wrap items-center gap-6 border-b border-line pb-8">
            <Avatar url={profile.avatarUrl} size="huge" />
            <div className="grid min-w-0 flex-1 gap-2">
              <h1 className="heading truncate text-4xl leading-tight">{profile.displayName}</h1>
              {profile.bio && <p className="max-w-2xl text-[15px] leading-relaxed whitespace-pre-wrap text-ink">{profile.bio}</p>}
            </div>
            {isMe && (
              <Button asChild>
                <Link to="/settings">Edit profile</Link>
              </Button>
            )}
          </section>
          {series.length > 0 && (
            <section className="grid gap-3">
              <h2 className="heading text-xl">Series</h2>
              <SeriesGrid series={series} />
            </section>
          )}
          <section className="grid gap-3">
            <h2 className="heading text-xl">Videos</h2>
            <VideoGrid videos={videos} />
            {nextCursor !== null && (
              <div className="text-center">
                <Button variant="secondary" onClick={() => void loadMore()} disabled={loadingMore}>
                  {loadingMore ? "Loading..." : "Load more"}
                </Button>
              </div>
            )}
          </section>
        </>
      )}
    </Shell>
  );
}

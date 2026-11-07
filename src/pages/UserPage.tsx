import { useCallback, useEffect, useState } from "react";
import type { SeriesSummary, UserProfile, VideoSummary } from "../../shared/api.ts";
import { ApiError, api } from "../api.ts";
import { Avatar } from "../components/Avatar.tsx";
import { Section } from "../components/Page.tsx";
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

/** The channel of one person: their picture, name, and bio, and the series and videos that they made. */
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

  // The videos load again when an upload finishes, so a new one shows on your own channel.
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
  // Your own channel shows your latest picture, name, and bio at once, as you may have just changed them in the channel settings.
  const profile = isMe ? me : user;
  usePageTitle(user === null ? null : (profile?.displayName ?? null));

  return (
    <Shell>
      {error !== null ? (
        <p className="error-box">{error instanceof Error ? error.message : String(error)}</p>
      ) : user === null || profile === null ? (
        <>
          <div className="flex items-center gap-4" role="status" aria-label="Loading">
            <Skeleton className="size-14 rounded-full" />
            <Skeleton className="h-9 w-1/3" />
          </div>
          <VideoGridSkeleton count={3} />
        </>
      ) : (
        <>
          <header className="grid gap-4">
            <div className="flex items-center gap-4">
              <Avatar url={profile.avatarUrl} size="large" />
              <h1 className="min-w-0 flex-1 truncate text-display font-bold text-strong">{profile.displayName}</h1>
              {isMe && (
                <Button asChild>
                  <Link to="/settings/channel">Channel settings</Link>
                </Button>
              )}
            </div>
            {profile.bio && <p className="max-w-[75ch] text-sm leading-relaxed break-words whitespace-pre-wrap">{profile.bio}</p>}
          </header>
          {series.length > 0 && (
            <Section title="Series">
              <SeriesGrid series={series} />
            </Section>
          )}
          {videos.length > 0 && (
            <Section title="Videos">
              <VideoGrid videos={videos} />
              {nextCursor !== null && (
                <div className="pt-4 text-center">
                  <Button onClick={() => void loadMore()} disabled={loadingMore}>
                    {loadingMore ? "Loading..." : "Load more"}
                  </Button>
                </div>
              )}
            </Section>
          )}
        </>
      )}
    </Shell>
  );
}

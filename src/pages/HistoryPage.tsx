import { useCallback, useEffect, useState } from "react";
import type { WatchedVideo } from "../../shared/api.ts";
import { api } from "../api.ts";
import { Shell } from "../components/Shell.tsx";
import { VideoGrid, VideoGridSkeleton } from "../components/VideoGrid.tsx";
import { usePageTitle } from "../lib/title.ts";
import { Button } from "../components/ui/button.tsx";

/** The videos that the signed-in person watched, from the last watched. */
export function HistoryPage() {
  const [videos, setVideos] = useState<WatchedVideo[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  usePageTitle("History");

  const load = useCallback(async (cursor: string | null) => {
    try {
      const page = await api.getHistory(cursor);
      setVideos((current) => (cursor === null ? page.videos : [...(current ?? []), ...page.videos]));
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load]);

  async function loadMore() {
    setLoadingMore(true);
    await load(nextCursor);
    setLoadingMore(false);
  }

  return (
    <Shell>
      <h1 className="heading text-3xl">History</h1>
      {error && <p className="error-box">{error}</p>}
      {videos === null && error === "" && <VideoGridSkeleton />}
      {videos !== null && (
        <section className="grid gap-3">
          <VideoGrid videos={videos} />
          {nextCursor !== null && (
            <div className="text-center">
              <Button variant="secondary" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? "Loading..." : "Load more"}
              </Button>
            </div>
          )}
        </section>
      )}
    </Shell>
  );
}

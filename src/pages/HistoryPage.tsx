import { useCallback, useEffect, useState } from "react";
import type { WatchedVideo } from "../../shared/api.ts";
import { api } from "../api.ts";
import { LoadMore } from "../components/LoadMore.tsx";
import { PageHeader } from "../components/Page.tsx";
import { Shell } from "../components/Shell.tsx";
import { VideoGrid, VideoGridSkeleton } from "../components/VideoGrid.tsx";
import { useT } from "../i18n.ts";
import { usePageTitle } from "../lib/title.ts";

/** The videos that the person watched, from the last watched. */
export function HistoryPage() {
  const [videos, setVideos] = useState<WatchedVideo[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const t = useT();
  usePageTitle(t.shell.history);

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
      <PageHeader title={t.shell.history} />
      {error && <p className="error-box">{error}</p>}
      {videos === null && error === "" && <VideoGridSkeleton />}
      {videos !== null && (
        <section className="grid gap-4">
          <VideoGrid videos={videos} />
          {nextCursor !== null && <LoadMore loading={loadingMore} onLoad={loadMore} />}
        </section>
      )}
    </Shell>
  );
}

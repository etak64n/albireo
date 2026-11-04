import { useCallback, useEffect, useState } from "react";
import type { VideoSummary } from "../../shared/api.ts";
import { api } from "../api.ts";
import { SeriesGrid } from "../components/SeriesGrid.tsx";
import { Shell } from "../components/Shell.tsx";
import { Button } from "../components/ui/button.tsx";
import { VideoGrid, VideoGridSkeleton } from "../components/VideoGrid.tsx";
import { useLibrary } from "../library.tsx";
import { usePageTitle } from "../lib/title.ts";
import { useUploads } from "../uploads.tsx";

/** Every series and every video of the library, the videos from the newest. */
export function AllVideosPage() {
  const { series } = useLibrary();
  const [videos, setVideos] = useState<VideoSummary[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const { completed } = useUploads();
  usePageTitle("All videos");

  const load = useCallback(async (cursor: string | null) => {
    try {
      const page = await api.listVideos(cursor);
      setVideos((current) => (cursor === null ? page.videos : [...(current ?? []), ...page.videos]));
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // The list loads again when an upload finishes, so the new video shows up.
  useEffect(() => {
    void load(null);
  }, [load, completed]);

  async function loadMore() {
    setLoadingMore(true);
    await load(nextCursor);
    setLoadingMore(false);
  }

  return (
    <Shell>
      <h1 className="heading text-3xl">All videos</h1>
      {error && <p className="error-box">{error}</p>}
      {series !== null && series.length > 0 && (
        <section className="grid gap-3">
          <h2 className="heading text-xl">Series</h2>
          <SeriesGrid series={series} />
        </section>
      )}
      {videos === null && error === "" && <VideoGridSkeleton />}
      {videos !== null && (
        <section className="grid gap-3">
          <h2 className="heading text-xl">Videos</h2>
          <VideoGrid videos={videos} />
          {nextCursor !== null && (
            <div className="text-center">
              <Button onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? "Loading..." : "Load more"}
              </Button>
            </div>
          )}
        </section>
      )}
    </Shell>
  );
}

import { useCallback, useEffect, useState } from "react";
import type { VideoSummary } from "../../shared/api.ts";
import { api } from "../api.ts";
import { PageHeader } from "../components/Page.tsx";
import { Shell } from "../components/Shell.tsx";
import { Button } from "../components/ui/button.tsx";
import { VideoGrid, VideoGridSkeleton } from "../components/VideoGrid.tsx";
import { usePageTitle } from "../lib/title.ts";
import { useLocationSearch } from "../router.tsx";

/** The videos whose title or description contains every word of the query in the address, ?q=. */
export function SearchPage() {
  const query = (new URLSearchParams(useLocationSearch()).get("q") ?? "").trim();
  const [videos, setVideos] = useState<VideoSummary[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  usePageTitle(query === "" ? "Search" : query);

  const load = useCallback(
    async (cursor: string | null) => {
      try {
        const page = await api.search(query, cursor);
        setVideos((current) => (cursor === null ? page.videos : [...(current ?? []), ...page.videos]));
        setNextCursor(page.nextCursor);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [query],
  );

  // A new query starts over from its first page.
  useEffect(() => {
    setVideos(null);
    setNextCursor(null);
    setError("");
    if (query !== "") void load(null);
  }, [load, query]);

  async function loadMore() {
    setLoadingMore(true);
    await load(nextCursor);
    setLoadingMore(false);
  }

  return (
    <Shell>
      {query !== "" && <PageHeader title={`Results for “${query}”`} />}
      {error && <p className="error-box">{error}</p>}
      {videos === null && query !== "" && error === "" && <VideoGridSkeleton />}
      {videos !== null && (
        <section className="grid gap-4">
          <VideoGrid videos={videos} />
          {nextCursor !== null && (
            <div className="pt-4 text-center">
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

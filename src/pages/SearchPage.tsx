import { useCallback, useEffect, useState } from "react";
import type { VideoSummary } from "../../shared/api.ts";
import { api } from "../api.ts";
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
      {query !== "" && <h1 className="heading text-2xl break-words">Results for “{query}”</h1>}
      {error && <p className="error-box">{error}</p>}
      {videos === null && query !== "" && error === "" && <VideoGridSkeleton />}
      {videos !== null && (
        <section className="grid gap-3">
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

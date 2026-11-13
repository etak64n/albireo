import { useCallback, useEffect, useRef, useState } from "react";
import { isVideoSort, VIDEO_SORTS, type VideoSort, type VideoSummary } from "../../shared/api.ts";
import { api } from "../api.ts";
import { EmptyLibrary } from "../components/EmptyLibrary.tsx";
import { LoadMore } from "../components/LoadMore.tsx";
import { PageHeader } from "../components/Page.tsx";
import { Shell } from "../components/Shell.tsx";
import { Filter } from "../components/ui/filter.tsx";
import { VideoGrid, VideoGridSkeleton } from "../components/VideoGrid.tsx";
import { useT } from "../i18n.ts";
import { usePageTitle } from "../lib/title.ts";
import { navigate, useLocationSearch } from "../router.tsx";
import { useUploads } from "../uploads.tsx";

/**
 * Every video of the library in the order that the person chooses: from the newest, from
 * the oldest, or from the highest rated. The order stays in the address (?sort=), so a
 * reload keeps it. The series are in the sidebar.
 */
export function AllVideosPage() {
  const [videos, setVideos] = useState<VideoSummary[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const { completed } = useUploads();
  const t = useT();
  const search = useLocationSearch();
  const asked = new URLSearchParams(search).get("sort");
  const sort: VideoSort = asked !== null && isVideoSort(asked) ? asked : "newest";
  // Only the answer to the last request shows, when the order changes before a page arrives.
  const latest = useRef(0);
  usePageTitle(t.common.allVideos);

  const load = useCallback(
    async (cursor: string | null) => {
      const request = (latest.current += 1);
      if (cursor === null) setNextCursor(null);
      try {
        const page = await api.listVideos(cursor, null, sort);
        if (request !== latest.current) return;
        setVideos((current) => (cursor === null ? page.videos : [...(current ?? []), ...page.videos]));
        setNextCursor(page.nextCursor);
      } catch (err) {
        if (request === latest.current) setError(err instanceof Error ? err.message : String(err));
      }
    },
    [sort],
  );

  // The list loads again when the order changes, and when an upload finishes, so the new video shows up.
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
      <div className="grid gap-4">
        <PageHeader title={t.common.allVideos} />
        {/* The filters of the page stand under its title. */}
        <div className="flex flex-wrap gap-2">
          <Filter
            name={t.sort.label}
            value={sort}
            options={VIDEO_SORTS.map((option) => ({ value: option, label: t.sort[option] }))}
            onChange={(next) => navigate(next === "newest" ? "/videos" : `/videos?sort=${next}`)}
          />
        </div>
      </div>
      {error && <p className="error-box">{error}</p>}
      {videos === null && error === "" && <VideoGridSkeleton />}
      {videos !== null && videos.length === 0 && <EmptyLibrary />}
      {videos !== null && videos.length > 0 && (
        <div className="grid gap-4">
          <VideoGrid videos={videos} />
          {nextCursor !== null && <LoadMore loading={loadingMore} onLoad={loadMore} />}
        </div>
      )}
    </Shell>
  );
}

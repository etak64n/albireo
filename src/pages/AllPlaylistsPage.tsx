import { useEffect, useState } from "react";
import type { PlaylistSummary } from "../../shared/api.ts";
import { api } from "../api.ts";
import { PageHeader } from "../components/Page.tsx";
import { PlaylistGrid } from "../components/SeriesGrid.tsx";
import { Shell } from "../components/Shell.tsx";
import { VideoGridSkeleton } from "../components/VideoGrid.tsx";
import { useT } from "../i18n.ts";
import { usePageTitle } from "../lib/title.ts";

/** Every playlist, from the one changed last. */
export function AllPlaylistsPage() {
  const [playlists, setPlaylists] = useState<PlaylistSummary[] | null>(null);
  const [error, setError] = useState("");
  const t = useT();
  usePageTitle(t.common.playlists);

  useEffect(() => {
    let active = true;
    api.listPlaylists(null).then(
      (loaded) => {
        if (active) setPlaylists(loaded.playlists);
      },
      (err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      active = false;
    };
  }, []);

  return (
    <Shell>
      <PageHeader title={t.common.playlists} />
      {error && <p className="error-box">{error}</p>}
      {playlists === null && error === "" && <VideoGridSkeleton />}
      {playlists !== null && playlists.length > 0 && <PlaylistGrid playlists={playlists} />}
    </Shell>
  );
}

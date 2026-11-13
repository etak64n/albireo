import { useEffect, useState } from "react";
import type { PlaylistSummary } from "../../shared/api.ts";
import { api } from "../api.ts";
import { PageHeader } from "../components/Page.tsx";
import { PlaylistGrid } from "../components/SeriesGrid.tsx";
import { Shell } from "../components/Shell.tsx";
import { Filter } from "../components/ui/filter.tsx";
import { VideoGridSkeleton } from "../components/VideoGrid.tsx";
import { useT } from "../i18n.ts";
import { usePageTitle } from "../lib/title.ts";
import { navigate, useLocationSearch } from "../router.tsx";
import { useSession } from "../session.tsx";

type Owner = "you" | "everyone";

/**
 * The playlists from the one changed last: those of the signed-in person, or with the filter
 * under the title, those of everyone, each with the person who made it. The choice stays in
 * the address (?owner=everyone), so a reload keeps it.
 */
export function AllPlaylistsPage() {
  const { me } = useSession();
  const [loaded, setLoaded] = useState<{ owner: Owner; playlists: PlaylistSummary[] } | null>(null);
  const [error, setError] = useState("");
  const t = useT();
  const owner: Owner = new URLSearchParams(useLocationSearch()).get("owner") === "everyone" ? "everyone" : "you";
  usePageTitle(t.common.playlists);

  useEffect(() => {
    let active = true;
    setError("");
    api.listPlaylists(owner === "you" ? me.id : null).then(
      ({ playlists }) => {
        if (active) setLoaded({ owner, playlists });
      },
      (err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      active = false;
    };
  }, [owner, me.id]);

  // The playlists of the other choice never show while the new choice loads.
  const playlists = loaded?.owner === owner ? loaded.playlists : null;

  return (
    <Shell>
      <div className="grid gap-4">
        <PageHeader title={t.common.playlists} />
        <div className="flex flex-wrap gap-2">
          <Filter
            name={t.playlists.owner}
            value={owner}
            options={[
              { value: "you", label: t.playlists.ownerYou },
              { value: "everyone", label: t.playlists.ownerEveryone },
            ]}
            onChange={(next) => navigate(next === "you" ? "/playlists" : "/playlists?owner=everyone")}
          />
        </div>
      </div>
      {error && <p className="error-box">{error}</p>}
      {playlists === null && error === "" && <VideoGridSkeleton />}
      {playlists !== null && playlists.length > 0 && <PlaylistGrid playlists={playlists} />}
    </Shell>
  );
}

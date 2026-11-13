// The series of the library and the playlists of the signed-in person, loaded once and
// shared by the sidebar and the pages. A page that creates or changes a series or a
// playlist calls refresh, so every list shows the change.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { PlaylistSummary, SeriesSummary } from "../shared/api.ts";
import { api } from "./api.ts";
import { useSession } from "./session.tsx";

interface Library {
  /** Every series, from the one that changed last. Null until the first load. */
  series: SeriesSummary[] | null;
  /** The playlists of the signed-in person, from the one that changed last. Null until the first load. */
  playlists: PlaylistSummary[] | null;
  error: string;
  refresh: () => Promise<void>;
}

const LibraryContext = createContext<Library | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const [series, setSeries] = useState<SeriesSummary[] | null>(null);
  const [playlists, setPlaylists] = useState<PlaylistSummary[] | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [loadedSeries, loadedPlaylists] = await Promise.all([api.listSeries(), api.listPlaylists(me.id)]);
      setSeries(loadedSeries.series);
      setPlaylists(loadedPlaylists.playlists);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [me.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return <LibraryContext.Provider value={{ series, playlists, error, refresh }}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): Library {
  const library = useContext(LibraryContext);
  if (library === null) throw new Error("useLibrary needs a LibraryProvider around the page.");
  return library;
}

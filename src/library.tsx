// The series of the library, loaded once and shared by the side pane and the pages.
// A page that creates or changes a series calls refresh, so every list shows the change.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { SeriesSummary } from "../shared/api.ts";
import { api } from "./api.ts";

interface Library {
  /** Every series, from the one that changed last. Null until the first load. */
  series: SeriesSummary[] | null;
  error: string;
  refresh: () => Promise<void>;
}

const LibraryContext = createContext<Library | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [series, setSeries] = useState<SeriesSummary[] | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setSeries((await api.listSeries()).series);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return <LibraryContext.Provider value={{ series, error, refresh }}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): Library {
  const library = useContext(LibraryContext);
  if (library === null) throw new Error("useLibrary needs a LibraryProvider around the page.");
  return library;
}

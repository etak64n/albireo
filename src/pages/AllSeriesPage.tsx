import { PageHeader } from "../components/Page.tsx";
import { SeriesGrid } from "../components/SeriesGrid.tsx";
import { Shell } from "../components/Shell.tsx";
import { VideoGridSkeleton } from "../components/VideoGrid.tsx";
import { useT } from "../i18n.ts";
import { usePageTitle } from "../lib/title.ts";
import { useLibrary } from "../library.tsx";

/** Every series of the library, from the one changed last. The sidebar loaded them already. */
export function AllSeriesPage() {
  const { series, error } = useLibrary();
  const t = useT();
  usePageTitle(t.common.series);

  return (
    <Shell>
      <PageHeader title={t.common.series} />
      {error && <p className="error-box">{error}</p>}
      {series === null && error === "" && <VideoGridSkeleton />}
      {series !== null && series.length > 0 && <SeriesGrid series={series} />}
    </Shell>
  );
}

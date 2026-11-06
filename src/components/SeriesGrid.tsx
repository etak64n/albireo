import type { SeriesSummary } from "../../shared/api.ts";
import { Link } from "../router.tsx";
import { GRID_CLASS } from "./VideoGrid.tsx";
import { Thumbnail } from "./Thumbnail.tsx";

export function SeriesGrid({ series }: { series: SeriesSummary[] }) {
  return (
    <div className={GRID_CLASS}>
      {series.map((item) => (
        <SeriesCard key={item.id} series={item} />
      ))}
    </div>
  );
}

// Two edges of pictures behind the cover show a series as a stack of videos.
function SeriesCard({ series }: { series: SeriesSummary }) {
  return (
    <Link to={`/series/${series.id}`} className="-m-2 grid content-start gap-3 rounded-lg p-2 transition-colors duration-150 hover:bg-surface-hover">
      <div className="grid">
        <div aria-hidden="true" className="mx-4 h-1 rounded-t-xs bg-border" />
        <div aria-hidden="true" className="mx-2 mt-0.5 h-1 rounded-t-xs bg-placeholder" />
        <Thumbnail url={series.coverUrl} className="mt-0.5" />
      </div>
      <div className="grid min-w-0 gap-0.5">
        <h3 className="line-clamp-2 text-sm font-semibold text-heading">{series.title}</h3>
        <p className="truncate text-xs text-subdued">{series.owner.displayName}</p>
      </div>
    </Link>
  );
}

import type { SeriesSummary } from "../../shared/api.ts";
import { Link } from "../router.tsx";
import { GRID_CLASS } from "./VideoGrid.tsx";
import { Thumbnail } from "./Thumbnail.tsx";

export function SeriesGrid({ series }: { series: SeriesSummary[] }) {
  return (
    <div className={`${GRID_CLASS} pt-2`}>
      {series.map((item) => (
        <SeriesCard key={item.id} series={item} />
      ))}
    </div>
  );
}

// A series card has two cards behind it, so a series reads as a stack of videos.
function SeriesCard({ series }: { series: SeriesSummary }) {
  return (
    <Link to={`/series/${series.id}`} className="group relative block animate-appear">
      <div aria-hidden="true" className="absolute inset-x-4 -top-2 h-6 rounded-ui border border-line bg-raised/60" />
      <div aria-hidden="true" className="absolute inset-x-2 -top-1 h-6 rounded-ui border border-line bg-raised" />
      <div className="card relative group-hover:-translate-y-1 group-hover:shadow-lift">
        <Thumbnail url={series.coverUrl} />
        <div className="grid gap-1 px-4 py-3.5">
          <h3 className="line-clamp-2 font-heading text-base leading-snug font-bold text-heading">{series.title}</h3>
          <p className="truncate text-[13px] font-bold text-muted">{series.owner.displayName}</p>
        </div>
      </div>
    </Link>
  );
}

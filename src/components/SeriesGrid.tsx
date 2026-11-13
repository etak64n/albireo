import type { PlaylistSummary, SeriesSummary } from "../../shared/api.ts";
import { cn } from "../lib/utils.ts";
import { Link } from "../router.tsx";
import { GRID_CLASS } from "./VideoGrid.tsx";
import { Thumbnail } from "./Thumbnail.tsx";

export function SeriesGrid({ series, className }: { series: SeriesSummary[]; className?: string }) {
  return (
    <div className={cn(GRID_CLASS, className)}>
      {series.map((item) => (
        <StackCard key={item.id} to={`/series/${item.id}`} title={item.title} coverUrl={item.coverUrl} ownerName={item.owner.displayName} />
      ))}
    </div>
  );
}

export function PlaylistGrid({ playlists }: { playlists: PlaylistSummary[] }) {
  return (
    <div className={GRID_CLASS}>
      {playlists.map((item) => (
        <StackCard key={item.id} to={`/playlists/${item.id}`} title={item.title} coverUrl={item.coverUrl} ownerName={item.owner.displayName} />
      ))}
    </div>
  );
}

// Two edges of pictures behind the cover show a series or a playlist as a stack of videos.
function StackCard({ to, title, coverUrl, ownerName }: { to: string; title: string; coverUrl: string | null; ownerName: string }) {
  return (
    <Link to={to} className="-m-2 grid content-start gap-3 rounded-lg p-2 transition-colors duration-150 hover:bg-surface-hover">
      <div className="grid">
        <div aria-hidden="true" className="mx-4 h-1 rounded-t-xs bg-border" />
        <div aria-hidden="true" className="mx-2 mt-0.5 h-1 rounded-t-xs bg-placeholder" />
        <Thumbnail url={coverUrl} className="mt-0.5" />
      </div>
      <div className="grid min-w-0 gap-0.5">
        <h3 className="line-clamp-2 text-sm font-semibold text-heading">{title}</h3>
        <p className="truncate text-xs text-subdued">{ownerName}</p>
      </div>
    </Link>
  );
}

import { ChevronDown, ChevronUp, EllipsisVertical, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { DESCRIPTION_MAX_LENGTH, TITLE_MAX_LENGTH, type Episode, type SeriesDetail } from "../../shared/api.ts";
import { ApiError, api } from "../api.ts";
import { Avatar } from "../components/Avatar.tsx";
import { Shell } from "../components/Shell.tsx";
import { Thumbnail } from "../components/Thumbnail.tsx";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../components/ui/dropdown-menu.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { formatDate } from "../lib/format.ts";
import { usePageTitle } from "../lib/title.ts";
import { useLibrary } from "../library.tsx";
import { Link } from "../router.tsx";
import { useSession } from "../session.tsx";
import { useUploads } from "../uploads.tsx";
import { NotFoundPage } from "./NotFoundPage.tsx";
import { Button } from "../components/ui/button.tsx";

export function SeriesPage({ id }: { id: string }) {
  const { refresh } = useLibrary();
  const [series, setSeries] = useState<SeriesDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState("");
  const [editing, setEditing] = useState(false);
  const { completed } = useUploads();
  usePageTitle(series?.title ?? null);

  const load = useCallback(async () => {
    try {
      setSeries((await api.getSeries(id)).series);
    } catch (err) {
      setError(err);
    }
  }, [id]);

  // The episodes load again when an upload finishes: an upload from this page joins the series.
  useEffect(() => {
    void load();
  }, [load, completed]);

  // Reordering and removing change the episodes, and the first one gives the series its cover.
  async function change(action: Promise<{ series: SeriesDetail }>) {
    setActionError("");
    try {
      setSeries((await action).series);
      void refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  if (error instanceof ApiError && error.status === 404) return <NotFoundPage />;
  const cover = series?.episodes.find((episode) => episode.thumbnailUrl !== null)?.thumbnailUrl ?? null;

  return (
    // Uploads from this page join the series as its last episode.
    <Shell seriesId={id}>
      {error !== null ? (
        <p className="error-box">{error instanceof Error ? error.message : String(error)}</p>
      ) : series === null ? (
        <SeriesSkeleton />
      ) : (
        <>
          {editing ? (
            <SeriesEditForm
              series={series}
              onSaved={(saved) => {
                setSeries(saved);
                setEditing(false);
                void refresh();
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <section className="panel flex animate-appear flex-col gap-5 p-5 sm:flex-row sm:items-start">
              <div className="w-full shrink-0 overflow-hidden rounded-ui shadow-card sm:w-64">
                <Thumbnail url={cover} />
              </div>
              <div className="grid min-w-0 flex-1 gap-1.5">
                <div className="flex items-start justify-between gap-3">
                  <h1 className="heading min-w-0 text-3xl leading-tight break-words">{series.title}</h1>
                  {series.canEdit && (
                    <Button variant="secondary" onClick={() => setEditing(true)}>
                      Edit
                    </Button>
                  )}
                </div>
                <Link to={`/users/${series.owner.id}`} className="flex w-fit items-center gap-2 text-[13px] font-bold text-muted hover:text-heading">
                  <Avatar url={series.owner.avatarUrl} size="tiny" />
                  {series.owner.displayName}
                </Link>
                {series.description && <p className="mt-1 text-[15px] leading-relaxed whitespace-pre-wrap">{series.description}</p>}
              </div>
            </section>
          )}
          {actionError && <p className="error-box">{actionError}</p>}
          <EpisodeList
            series={series}
            onMove={(episode, direction) => void change(api.moveEpisode(series.id, episode.id, direction))}
            onRemove={(episode) => void change(api.removeEpisode(series.id, episode.id))}
          />
        </>
      )}
    </Shell>
  );
}

function SeriesSkeleton() {
  return (
    <div className="grid gap-8" role="status" aria-label="Loading">
      <div className="panel flex flex-col gap-5 p-5 sm:flex-row">
        <Skeleton className="aspect-video w-full shrink-0 sm:w-64" />
        <div className="grid flex-1 content-start gap-3">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-4 w-1/4" />
        </div>
      </div>
      <div className="grid gap-2.5">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-24" />
        ))}
      </div>
    </div>
  );
}

function EpisodeList({
  series,
  onMove,
  onRemove,
}: {
  series: SeriesDetail;
  onMove: (episode: Episode, direction: "earlier" | "later") => void;
  onRemove: (episode: Episode) => void;
}) {
  const { me } = useSession();
  if (series.episodes.length === 0) return null;
  const last = series.episodes.length - 1;
  return (
    <ol className="grid gap-2.5">
      {series.episodes.map((episode, index) => {
        // The creator of the series reorders it. The creator and the uploader can take a video out.
        const canRemove = series.canEdit || episode.uploader?.id === me.id;
        return (
          <li key={episode.id} className="card flex animate-appear items-center gap-3 p-2.5 pr-2 hover:shadow-lift sm:gap-4 sm:pr-3">
            <span className="w-6 shrink-0 text-center font-heading text-lg font-bold text-accent tabular-nums sm:w-8 sm:text-2xl">{episode.episode}</span>
            <Link to={`/videos/${episode.id}`} className="group flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
              <div className="w-24 shrink-0 overflow-hidden rounded-ui sm:w-36">
                <Thumbnail url={episode.thumbnailUrl} durationSec={episode.durationSec} />
              </div>
              <div className="grid min-w-0 gap-1">
                <span className="line-clamp-2 font-heading text-base leading-snug font-bold text-heading">{episode.title}</span>
                <span className="truncate text-xs font-bold text-muted">
                  {[episode.uploader?.displayName, formatDate(episode.createdAt)]
                    .filter((part) => part !== undefined && part !== "")
                    .join(" · ")}
                </span>
              </div>
            </Link>
            {(series.canEdit || canRemove) && (
              <EpisodeActions
                canMove={series.canEdit}
                canRemove={canRemove}
                first={index === 0}
                last={index === last}
                onMove={(direction) => onMove(episode, direction)}
                onRemove={() => onRemove(episode)}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Moving and removing an episode: buttons in the row, and in a menu on phones, where the row is narrow. */
function EpisodeActions({
  canMove,
  canRemove,
  first,
  last,
  onMove,
  onRemove,
}: {
  canMove: boolean;
  canRemove: boolean;
  first: boolean;
  last: boolean;
  onMove: (direction: "earlier" | "later") => void;
  onRemove: () => void;
}) {
  return (
    <>
      <div className="hidden shrink-0 items-center gap-0.5 sm:flex">
        {canMove && (
          <>
            <Button variant="ghost" size="icon" onClick={() => onMove("earlier")} disabled={first} aria-label="Move earlier">
              <ChevronUp aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => onMove("later")} disabled={last} aria-label="Move later">
              <ChevronDown aria-hidden="true" />
            </Button>
          </>
        )}
        {canRemove && (
          <Button variant="ghost" size="icon" onClick={onRemove} aria-label="Remove from the series">
            <X aria-hidden="true" />
          </Button>
        )}
      </div>
      <div className="shrink-0 sm:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Episode actions">
              <EllipsisVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            {canMove && (
              <>
                <DropdownMenuItem disabled={first} onSelect={() => onMove("earlier")}>
                  <ChevronUp />
                  Move earlier
                </DropdownMenuItem>
                <DropdownMenuItem disabled={last} onSelect={() => onMove("later")}>
                  <ChevronDown />
                  Move later
                </DropdownMenuItem>
              </>
            )}
            {canRemove && (
              <DropdownMenuItem onSelect={onRemove}>
                <X />
                Remove from the series
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}

function SeriesEditForm({
  series,
  onSaved,
  onCancel,
}: {
  series: SeriesDetail;
  onSaved: (series: SeriesDetail) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(series.title);
  const [description, setDescription] = useState(series.description);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    try {
      onSaved((await api.updateSeries(series.id, { title, description })).series);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <section className="panel grid gap-2 p-5">
      <input
        type="text"
        value={title}
        maxLength={TITLE_MAX_LENGTH}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="Series title"
        placeholder="Series title"
        className="field h-9 font-bold"
      />
      <textarea
        value={description}
        maxLength={DESCRIPTION_MAX_LENGTH}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        aria-label="Description"
        placeholder="Description"
        className="field resize-y py-2"
      />
      {error && <p className="error-box">{error}</p>}
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => void save()} disabled={saving || title.trim() === ""}>
          {saving ? "Saving..." : "Save"}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

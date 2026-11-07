import { ChevronDown, ChevronUp, Ellipsis, X } from "lucide-react";
import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { DESCRIPTION_MAX_LENGTH, TITLE_MAX_LENGTH, type Episode, type SeriesDetail } from "../../shared/api.ts";
import { ApiError, api } from "../api.ts";
import { Avatar } from "../components/Avatar.tsx";
import { Breadcrumb, Section } from "../components/Page.tsx";
import { Shell } from "../components/Shell.tsx";
import { Thumbnail } from "../components/Thumbnail.tsx";
import { Button } from "../components/ui/button.tsx";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../components/ui/dropdown-menu.tsx";
import { Input, Label, Textarea } from "../components/ui/field.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { useT } from "../i18n.ts";
import { formatDate, formatDuration } from "../lib/format.ts";
import { usePageTitle } from "../lib/title.ts";
import { useLibrary } from "../library.tsx";
import { Link, navigate } from "../router.tsx";
import { useSession } from "../session.tsx";
import { useUploads } from "../uploads.tsx";
import { NotFoundPage } from "./NotFoundPage.tsx";

/** The page of a series: its cover, title, and creator, its description, and the table of its episodes. */
export function SeriesPage({ id }: { id: string }) {
  const { refresh } = useLibrary();
  const [series, setSeries] = useState<SeriesDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState("");
  const [editing, setEditing] = useState(false);
  const { completed } = useUploads();
  const t = useT();
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
          <div className="grid gap-6">
            <Breadcrumb to="/videos">{t.common.allVideos}</Breadcrumb>
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
              <header className="grid gap-4">
                <div className="flex items-start gap-4">
                  <Thumbnail url={cover} className="w-[100px] shrink-0 rounded-sm" />
                  <div className="grid min-w-0 flex-1 gap-1">
                    <div className="flex items-start justify-between gap-3">
                      <h1 className="min-w-0 text-display font-bold break-words text-strong">{series.title}</h1>
                      {series.canEdit && (
                        <Button className="mt-1" onClick={() => setEditing(true)}>
                          {t.common.edit}
                        </Button>
                      )}
                    </div>
                    <Link to={`/users/${series.owner.id}`} className="flex w-fit items-center gap-2 text-base text-label hover:underline">
                      <Avatar url={series.owner.avatarUrl} size="tiny" />
                      {series.owner.displayName}
                    </Link>
                  </div>
                </div>
                {series.description && <p className="max-w-[75ch] text-sm leading-relaxed break-words whitespace-pre-wrap">{series.description}</p>}
              </header>
            )}
          </div>
          {actionError && <p className="error-box">{actionError}</p>}
          <EpisodeTable
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
  const t = useT();
  return (
    <div className="grid gap-12" role="status" aria-label={t.common.loading}>
      <div className="grid gap-6">
        <Skeleton className="h-5 w-20" />
        <div className="flex items-start gap-4">
          <Skeleton className="aspect-video w-[100px] shrink-0 rounded-sm" />
          <div className="grid flex-1 content-start gap-2">
            <Skeleton className="h-9 w-1/2" />
            <Skeleton className="h-5 w-32" />
          </div>
        </div>
      </div>
      <div className="grid gap-2">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-14" />
        ))}
      </div>
    </div>
  );
}

const HEAD = "h-9 px-2 text-left align-middle text-xs font-semibold whitespace-nowrap text-label";
const CELL = "px-2 py-2 align-middle";

/**
 * The episodes in order, one row each. A click anywhere on a row opens the episode.
 * The creator of the series moves an episode, and the creator and the uploader take it
 * out, from the menu at the end of the row.
 */
function EpisodeTable({
  series,
  onMove,
  onRemove,
}: {
  series: SeriesDetail;
  onMove: (episode: Episode, direction: "earlier" | "later") => void;
  onRemove: (episode: Episode) => void;
}) {
  const { me } = useSession();
  const t = useT();
  if (series.episodes.length === 0) return null;
  const last = series.episodes.length - 1;
  const canRemove = (episode: Episode) => series.canEdit || episode.uploader?.id === me.id;
  const hasActions = series.episodes.some(canRemove);

  function open(event: MouseEvent<HTMLTableRowElement>, episode: Episode) {
    // The link and the menu button handle their own clicks. Clicks in the open menu reach
    // the row through React too, though the menu is elsewhere on the page.
    const target = event.target;
    if (!(target instanceof Element) || !event.currentTarget.contains(target) || target.closest("a, button") !== null) return;
    navigate(`/videos/${episode.id}`);
  }

  return (
    <Section title={t.series.episodes}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className={`${HEAD} w-12`}>{t.series.episode}</th>
            <th className={HEAD}>{t.common.title}</th>
            <th className={`${HEAD} max-sm:hidden`}>{t.common.uploadedBy}</th>
            <th className={`${HEAD} max-md:hidden`}>{t.common.date}</th>
            <th className={`${HEAD} text-right`}>{t.common.length}</th>
            {hasActions && (
              <th className={`${HEAD} w-10`}>
                <span className="sr-only">{t.series.actions}</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {series.episodes.map((episode, index) => (
            <tr
              key={episode.id}
              onClick={(event) => open(event, episode)}
              className="group cursor-pointer border-b border-hairline transition-colors duration-150 hover:bg-surface-hover has-aria-expanded:bg-surface-hover"
            >
              <td className={`${CELL} numeric font-semibold text-strong`}>{episode.episode}</td>
              <td className={CELL}>
                <Link to={`/videos/${episode.id}`} className="flex min-w-0 items-center gap-3">
                  <Thumbnail url={episode.thumbnailUrl} className="w-20 shrink-0 rounded-xs" />
                  <span className="line-clamp-2 font-semibold break-words text-strong">{episode.title}</span>
                </Link>
              </td>
              <td className={`${CELL} whitespace-nowrap text-strong max-sm:hidden`}>{episode.uploader?.displayName ?? "—"}</td>
              <td className={`${CELL} numeric whitespace-nowrap text-strong max-md:hidden`}>{formatDate(episode.createdAt)}</td>
              <td className={`${CELL} numeric text-right whitespace-nowrap text-strong`}>
                {episode.durationSec === null ? "—" : formatDuration(episode.durationSec)}
              </td>
              {hasActions && (
                <td className={`${CELL} px-1 text-right`}>
                  {canRemove(episode) && (
                    <EpisodeMenu
                      title={episode.title}
                      canMove={series.canEdit}
                      first={index === 0}
                      last={index === last}
                      onMove={(direction) => onMove(episode, direction)}
                      onRemove={() => onRemove(episode)}
                    />
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

/** The menu at the end of a row. It shows while the pointer is over the row, and always on touch screens. */
function EpisodeMenu({
  title,
  canMove,
  first,
  last,
  onMove,
  onRemove,
}: {
  title: string;
  canMove: boolean;
  first: boolean;
  last: boolean;
  onMove: (direction: "earlier" | "later") => void;
  onRemove: () => void;
}) {
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t.series.actionsFor(title)}
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 pointer-coarse:opacity-100"
        >
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        {canMove && (
          <>
            <DropdownMenuItem disabled={first} onSelect={() => onMove("earlier")}>
              <ChevronUp />
              {t.series.moveEarlier}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={last} onSelect={() => onMove("later")}>
              <ChevronDown />
              {t.series.moveLater}
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuItem onSelect={onRemove}>
          <X />
          {t.series.removeFromSeries}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
  const t = useT();

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
    <form
      className="grid max-w-[75ch] gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (title.trim() !== "") void save();
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="series-title">{t.common.title}</Label>
        <Input id="series-title" value={title} maxLength={TITLE_MAX_LENGTH} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="series-description">{t.common.description}</Label>
        <Textarea id="series-description" value={description} maxLength={DESCRIPTION_MAX_LENGTH} onChange={(e) => setDescription(e.target.value)} rows={4} />
      </div>
      {error && <p className="error-box">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={saving || title.trim() === ""}>
          {saving ? t.common.saving : t.common.save}
        </Button>
        <Button onClick={onCancel}>{t.common.cancel}</Button>
      </div>
    </form>
  );
}

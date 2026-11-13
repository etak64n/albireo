import { LayersPlus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TITLE_MAX_LENGTH, type SeriesLink, type VideoDetail } from "../../shared/api.ts";
import { api } from "../api.ts";
import { useT } from "../i18n.ts";
import { useLibrary } from "../library.tsx";
import { cn } from "../lib/utils.ts";
import { Button } from "./ui/button.tsx";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "./ui/dialog.tsx";
import { Input } from "./ui/field.tsx";
import { SEARCH_ABOVE, searchable } from "./ui/select.tsx";
import { Skeleton } from "./ui/skeleton.tsx";
import { useToast } from "./ui/toast.tsx";

/**
 * Puts the video in a series, moves it to another one, or takes it out of its series. A video
 * belongs to one series at most, so the dialog lists No series and the series of the library,
 * from the one changed last, as rows of which one is chosen, and a row that makes a new series
 * with the video in it. More than 10 series get a search field at the top, as the dialog of
 * playlists has. On small screens the button shows its icon only.
 */
export function AddToSeries({ video, onChange }: { video: VideoDetail; onChange: (video: VideoDetail) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} className="max-md:w-7 max-md:px-0">
        <LayersPlus aria-hidden="true" />
        <span className="max-md:sr-only">{t.series.addToSeries}</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          // The dialog opens on the row of the series of the video, as a select opens on its choice,
          // so Enter right away changes nothing.
          onOpenAutoFocus={(event) => {
            const chosen = (event.target as HTMLElement).querySelector<HTMLElement>('[aria-pressed="true"]');
            if (chosen === null) return;
            event.preventDefault();
            chosen.focus();
          }}
        >
          <DialogTitle>{t.series.addToSeries}</DialogTitle>
          {open && <SeriesChoices video={video} onChange={onChange} />}
          <div className="flex justify-end">
            <DialogClose asChild>
              <Button>{t.common.done}</Button>
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The ID of the row No series, which takes the video out of its series. */
const NO_SERIES = "";

function linksOf(series: readonly SeriesLink[]): SeriesLink[] {
  return series.map(({ id, title }) => ({ id, title }));
}

/** No series, the series of the library, and the row for a new series. */
function SeriesChoices({ video, onChange }: { video: VideoDetail; onChange: (video: VideoDetail) => void }) {
  const { series: library, error: libraryError, refresh } = useLibrary();
  const toast = useToast();
  const t = useT();
  // The series that the sidebar loaded, in their order when the dialog opened: a change here
  // moves a series up in the sidebar, but not in this list, under the pointer.
  const [choices, setChoices] = useState<SeriesLink[] | null>(() => (library === null ? null : linksOf(library)));
  // The row whose change is saved now, or "new" while a new series is made. The rows wait for it.
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  // When the form for a new series closes, focus goes back to the row that opened it, not to the dialog.
  const newRow = useRef<HTMLButtonElement>(null);
  const [backToNewRow, setBackToNewRow] = useState(false);
  const chosen = video.series?.id ?? NO_SERIES;

  // A dialog opened before the sidebar loaded the series waits for them.
  useEffect(() => {
    if (choices === null && library !== null) setChoices(linksOf(library));
  }, [choices, library]);

  useEffect(() => {
    if (creating || !backToNewRow) return;
    newRow.current?.focus();
    setBackToNewRow(false);
  }, [creating, backToNewRow]);

  function closeForm() {
    setCreating(false);
    setBackToNewRow(true);
  }

  // The video joins the chosen series as its last episode.
  async function choose(choice: SeriesLink) {
    if (busy !== null || choice.id === chosen) return;
    const before = video.series;
    setBusy(choice.id);
    try {
      const { video: changed } = await api.updateVideo(video.id, { seriesId: choice.id === NO_SERIES ? null : choice.id });
      onChange(changed);
      toast.success(changed.series === null ? t.toast.removedFrom(before?.title ?? "") : t.toast.addedTo(changed.series.title));
      // The series changed, which moves it up in the sidebar.
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    setBusy("new");
    try {
      const { series } = await api.createSeries({ title, description: "" });
      setChoices((current) => [{ id: series.id, title: series.title }, ...(current ?? [])]);
      setTitle("");
      closeForm();
      void refresh();
      const { video: changed } = await api.updateVideo(video.id, { seriesId: series.id });
      onChange(changed);
      toast.success(t.toast.addedTo(series.title));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const rows = choices === null ? null : [{ id: NO_SERIES, title: t.video.noSeries }, ...choices];
  const withSearch = choices !== null && choices.length > SEARCH_ABOVE;
  const words = searchable(query.trim());
  const shown = rows === null || words === "" ? rows : rows.filter((row) => searchable(row.title).includes(words));

  return (
    <div className="grid gap-3">
      {withSearch && (
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t.shell.search}
          aria-label={t.shell.search}
          autoComplete="off"
          className="field"
        />
      )}
      {rows === null && libraryError === "" && (
        <div className="grid gap-2" role="status" aria-label={t.common.loading}>
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
        </div>
      )}
      {shown !== null && shown.length > 0 && (
        <ul className="-mx-2 grid max-h-72 gap-0.5 overflow-y-auto">
          {shown.map((row) => {
            const isChosen = row.id === chosen;
            return (
              <li key={row.id === NO_SERIES ? "none" : row.id}>
                {/* aria-disabled rather than disabled, so a row keeps the focus while its change is saved. */}
                <button
                  type="button"
                  aria-pressed={isChosen}
                  aria-disabled={busy !== null}
                  onClick={() => void choose(row)}
                  className={cn(
                    "flex h-9 w-full cursor-pointer items-center rounded-sm px-2 text-left text-sm transition-colors duration-150 aria-disabled:cursor-default pointer-coarse:h-11",
                    // The chosen series keeps its accent under the pointer, as in the menus of the app.
                    isChosen ? "bg-accent-subtle text-accent" : "text-strong hover:bg-surface-hover",
                  )}
                >
                  <span className="truncate">{row.title}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {creating ? (
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (title.trim() !== "") void create();
          }}
        >
          <Input
            value={title}
            maxLength={TITLE_MAX_LENGTH}
            onChange={(e) => setTitle(e.target.value)}
            aria-label={t.shell.seriesTitle}
            placeholder={t.shell.seriesTitle}
            autoFocus
          />
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={busy !== null || title.trim() === ""}>
              {busy === "new" ? t.shell.creating : t.shell.create}
            </Button>
            <Button onClick={closeForm}>{t.common.cancel}</Button>
          </div>
        </form>
      ) : (
        <button
          ref={newRow}
          type="button"
          onClick={() => setCreating(true)}
          className="-mx-2 flex h-9 items-center gap-3 rounded-sm px-2 text-sm text-subdued transition-colors duration-150 hover:bg-surface-hover hover:text-strong pointer-coarse:h-11 [&_svg]:size-4 [&_svg]:shrink-0"
        >
          <Plus aria-hidden="true" />
          {t.shell.newSeries}
        </button>
      )}
      {libraryError && <p className="error-box">{libraryError}</p>}
    </div>
  );
}

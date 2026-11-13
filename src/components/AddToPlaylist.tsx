import { ListPlus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TITLE_MAX_LENGTH, type PlaylistChoice } from "../../shared/api.ts";
import { api } from "../api.ts";
import { useT } from "../i18n.ts";
import { useLibrary } from "../library.tsx";
import { Button } from "./ui/button.tsx";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "./ui/dialog.tsx";
import { Input } from "./ui/field.tsx";
import { SEARCH_ABOVE, searchable } from "./ui/select.tsx";
import { useToast } from "./ui/toast.tsx";
import { Skeleton } from "./ui/skeleton.tsx";

/**
 * Puts the video in the playlists of the person and takes it out of them. The
 * button opens their playlists from the one changed last, each with a box that shows whether
 * it holds the video, and a row that makes a new playlist with the video in it. More than 10
 * playlists get a search field at the top, as the menus of select fields do. On small screens
 * the button shows its icon only.
 */
export function AddToPlaylist({ videoId }: { videoId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} className="max-md:w-7 max-md:px-0">
        <ListPlus aria-hidden="true" />
        <span className="max-md:sr-only">{t.playlists.addToPlaylist}</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>{t.playlists.addToPlaylist}</DialogTitle>
          {/* The list loads each time the dialog opens, so it shows the changes made elsewhere. */}
          {open && <PlaylistChoices videoId={videoId} />}
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

/** The playlists of the person, from the one changed last, and the row for a new one. */
function PlaylistChoices({ videoId }: { videoId: string }) {
  const { refresh } = useLibrary();
  const toast = useToast();
  const t = useT();
  const [choices, setChoices] = useState<PlaylistChoice[] | null>(null);
  // The playlist that changes now, or "new" while a new playlist is made. The boxes wait for it.
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  // When the form for a new playlist closes, focus goes back to the row that opened it, not to the dialog.
  const newRow = useRef<HTMLButtonElement>(null);
  const [backToNewRow, setBackToNewRow] = useState(false);

  useEffect(() => {
    if (creating || !backToNewRow) return;
    newRow.current?.focus();
    setBackToNewRow(false);
  }, [creating, backToNewRow]);

  function closeForm() {
    setCreating(false);
    setBackToNewRow(true);
  }

  useEffect(() => {
    let active = true;
    api.playlistChoices(videoId).then(
      ({ playlists }) => {
        if (active) setChoices(playlists);
      },
      (err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      active = false;
    };
  }, [videoId]);

  async function toggle(choice: PlaylistChoice) {
    setBusy(choice.id);
    try {
      if (choice.hasVideo) await api.removeFromPlaylist(choice.id, videoId);
      else await api.addToPlaylist(choice.id, videoId);
      setChoices((current) => current?.map((item) => (item.id === choice.id ? { ...item, hasVideo: !choice.hasVideo } : item)) ?? null);
      toast.success(choice.hasVideo ? t.toast.removedFrom(choice.title) : t.toast.addedTo(choice.title));
      // The playlist changed, which moves it up in the sidebar.
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
      const { playlist } = await api.createPlaylist({ title, description: "" });
      await api.addToPlaylist(playlist.id, videoId);
      setChoices((current) => [{ id: playlist.id, title: playlist.title, hasVideo: true }, ...(current ?? [])]);
      toast.success(t.toast.addedTo(playlist.title));
      setTitle("");
      closeForm();
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const withSearch = choices !== null && choices.length > SEARCH_ABOVE;
  const words = searchable(query.trim());
  const shown = choices === null || words === "" ? choices : choices.filter((choice) => searchable(choice.title).includes(words));

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
      {choices === null && error === "" && (
        <div className="grid gap-2" role="status" aria-label={t.common.loading}>
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
        </div>
      )}
      {shown !== null && shown.length > 0 && (
        <ul className="-mx-2 grid max-h-72 gap-0.5 overflow-y-auto">
          {shown.map((choice) => (
            <li key={choice.id}>
              <label className="flex h-9 cursor-pointer items-center gap-3 rounded-sm px-2 text-sm text-strong transition-colors duration-150 hover:bg-surface-hover pointer-coarse:h-11">
                <input
                  type="checkbox"
                  className="size-4 shrink-0 accent-accent"
                  checked={choice.hasVideo}
                  disabled={busy !== null}
                  onChange={() => void toggle(choice)}
                />
                <span className="truncate">{choice.title}</span>
              </label>
            </li>
          ))}
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
            aria-label={t.shell.playlistTitle}
            placeholder={t.shell.playlistTitle}
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
          {t.shell.newPlaylist}
        </button>
      )}
      {error && <p className="error-box">{error}</p>}
    </div>
  );
}

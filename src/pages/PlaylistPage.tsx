import { ChevronDown, ChevronUp, Ellipsis, Play, X } from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";
import { DESCRIPTION_MAX_LENGTH, TITLE_MAX_LENGTH, type PlaylistDetail, type PlaylistResponse, type PlaylistVideo } from "../../shared/api.ts";
import { ApiError, api } from "../api.ts";
import { Avatar } from "../components/Avatar.tsx";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { Section } from "../components/Page.tsx";
import { Shell } from "../components/Shell.tsx";
import { Thumbnail } from "../components/Thumbnail.tsx";
import { Button } from "../components/ui/button.tsx";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../components/ui/dropdown-menu.tsx";
import { Input, Label, Textarea } from "../components/ui/field.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { useToast } from "../components/ui/toast.tsx";
import { useT } from "../i18n.ts";
import { formatDate, formatDuration } from "../lib/format.ts";
import { usePageTitle } from "../lib/title.ts";
import { useLibrary } from "../library.tsx";
import { Link, navigate } from "../router.tsx";
import { NotFoundPage } from "./NotFoundPage.tsx";

/** The page of a video that plays it in a playlist, which goes on to the next video of the playlist. */
export function playlistVideoPath(videoId: string, playlistId: string): string {
  return `/videos/${videoId}?playlist=${playlistId}`;
}

/**
 * The page of a playlist: its cover, title, and owner, its description, and the table of its
 * videos, which Play all plays from the first. Its owner and admins edit it, reorder and
 * remove its videos, and delete it; deleting it keeps its videos in the library.
 */
export function PlaylistPage({ id }: { id: string }) {
  const { refresh } = useLibrary();
  const toast = useToast();
  const [playlist, setPlaylist] = useState<PlaylistDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const t = useT();
  usePageTitle(playlist?.title ?? null);

  useEffect(() => {
    let active = true;
    api.getPlaylist(id).then(
      ({ playlist: loaded }) => {
        if (active) setPlaylist(loaded);
      },
      (err: unknown) => {
        if (active) setError(err);
      },
    );
    return () => {
      active = false;
    };
  }, [id]);

  // Reordering and removing change the videos, and the first one gives the playlist its cover.
  // Removing says so; a move shows in the table.
  async function change(action: Promise<PlaylistResponse>, done?: string) {
    try {
      setPlaylist((await action).playlist);
      if (done !== undefined) toast.success(done);
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  if (error instanceof ApiError && error.status === 404) return <NotFoundPage />;
  const cover = playlist?.videos.find((video) => video.thumbnailUrl !== null)?.thumbnailUrl ?? null;
  const first = playlist?.videos[0];

  return (
    <Shell>
      {error !== null ? (
        <p className="error-box">{error instanceof Error ? error.message : String(error)}</p>
      ) : playlist === null ? (
        <PlaylistSkeleton />
      ) : (
        <>
          <div className="grid gap-6">
            {editing ? (
              <PlaylistEditForm
                playlist={playlist}
                onSaved={(saved) => {
                  setPlaylist(saved);
                  toast.success(t.toast.saved);
                  setEditing(false);
                  void refresh();
                }}
                onCancel={() => setEditing(false)}
              />
            ) : (
              <header className="grid gap-4">
                <div className="flex items-start gap-4">
                  <Thumbnail url={cover} className="w-[100px] shrink-0" />
                  <div className="grid min-w-0 flex-1 gap-1">
                    <div className="flex items-start justify-between gap-3">
                      <h1 className="min-w-0 text-display font-bold break-words text-strong">{playlist.title}</h1>
                      <div className="mt-1 flex shrink-0 gap-2">
                        {first !== undefined && (
                          <Button asChild variant="primary">
                            <Link to={playlistVideoPath(first.id, playlist.id)}>
                              <Play aria-hidden="true" />
                              {t.playlists.playAll}
                            </Link>
                          </Button>
                        )}
                        {playlist.canEdit && (
                          <>
                            <Button onClick={() => setEditing(true)}>{t.common.edit}</Button>
                            <Button onClick={() => setDeleting(true)}>{t.common.delete}</Button>
                          </>
                        )}
                      </div>
                    </div>
                    <Link to={`/users/${playlist.owner.id}`} className="flex w-fit items-center gap-2 text-base text-label hover:underline">
                      <Avatar url={playlist.owner.avatarUrl} size="tiny" />
                      {playlist.owner.displayName}
                    </Link>
                  </div>
                </div>
                {playlist.description && <p className="max-w-[75ch] text-sm leading-relaxed break-words whitespace-pre-wrap">{playlist.description}</p>}
              </header>
            )}
          </div>
          <PlaylistTable
            playlist={playlist}
            onMove={(video, direction) => void change(api.movePlaylistVideo(playlist.id, video.id, direction))}
            onRemove={(video) => void change(api.removeFromPlaylist(playlist.id, video.id), t.toast.removedFrom(playlist.title))}
          />
          <ConfirmDialog
            open={deleting}
            title={t.playlists.deleteQuestion}
            confirmLabel={t.common.delete}
            onClose={() => setDeleting(false)}
            onConfirm={async () => {
              await api.deletePlaylist(playlist.id);
              await refresh();
              toast.success(t.toast.deleted(playlist.title));
              navigate("/playlists");
            }}
          >
            <p className="text-sm">{t.playlists.deleteKeepsVideos}</p>
          </ConfirmDialog>
        </>
      )}
    </Shell>
  );
}

function PlaylistSkeleton() {
  const t = useT();
  return (
    <div className="grid gap-12" role="status" aria-label={t.common.loading}>
      <div className="grid gap-6">
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
 * The videos of the playlist in order, one row each. A click anywhere on a row plays the video
 * in the playlist. The owner of the playlist and admins move and remove a video from the menu
 * at the end of its row.
 */
function PlaylistTable({
  playlist,
  onMove,
  onRemove,
}: {
  playlist: PlaylistDetail;
  onMove: (video: PlaylistVideo, direction: "earlier" | "later") => void;
  onRemove: (video: PlaylistVideo) => void;
}) {
  const t = useT();
  if (playlist.videos.length === 0) return null;
  const last = playlist.videos.length - 1;

  function open(event: MouseEvent<HTMLTableRowElement>, video: PlaylistVideo) {
    // The link and the menu button handle their own clicks. Clicks in the open menu reach
    // the row through React too, though the menu is elsewhere on the page.
    const target = event.target;
    if (!(target instanceof Element) || !event.currentTarget.contains(target) || target.closest("a, button") !== null) return;
    navigate(playlistVideoPath(video.id, playlist.id));
  }

  return (
    <Section title={t.common.videos}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className={`${HEAD} w-12`}>{t.playlists.number}</th>
            <th className={HEAD}>{t.common.title}</th>
            <th className={`${HEAD} max-sm:hidden`}>{t.common.uploadedBy}</th>
            <th className={`${HEAD} max-md:hidden`}>{t.common.date}</th>
            <th className={`${HEAD} text-right`}>{t.common.length}</th>
            {playlist.canEdit && (
              <th className={`${HEAD} w-10`}>
                <span className="sr-only">{t.series.actions}</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {playlist.videos.map((video, index) => (
            <tr
              key={video.id}
              onClick={(event) => open(event, video)}
              className="group cursor-pointer border-b border-hairline transition-colors duration-150 hover:bg-surface-hover has-aria-expanded:bg-surface-hover"
            >
              <td className={`${CELL} numeric font-semibold text-strong`}>{video.position}</td>
              <td className={CELL}>
                <Link to={playlistVideoPath(video.id, playlist.id)} className="flex min-w-0 items-center gap-3">
                  <Thumbnail url={video.thumbnailUrl} className="w-20 shrink-0" />
                  <span className="line-clamp-2 font-semibold break-words text-strong">{video.title}</span>
                </Link>
              </td>
              <td className={`${CELL} whitespace-nowrap text-strong max-sm:hidden`}>{video.uploader?.displayName ?? "—"}</td>
              <td className={`${CELL} numeric whitespace-nowrap text-strong max-md:hidden`}>{formatDate(video.createdAt)}</td>
              <td className={`${CELL} numeric text-right whitespace-nowrap text-strong`}>
                {video.durationSec === null ? "—" : formatDuration(video.durationSec)}
              </td>
              {playlist.canEdit && (
                <td className={`${CELL} px-1 text-right`}>
                  <PlaylistVideoMenu
                    title={video.title}
                    first={index === 0}
                    last={index === last}
                    onMove={(direction) => onMove(video, direction)}
                    onRemove={() => onRemove(video)}
                  />
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
function PlaylistVideoMenu({
  title,
  first,
  last,
  onMove,
  onRemove,
}: {
  title: string;
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
        <DropdownMenuItem disabled={first} onSelect={() => onMove("earlier")}>
          <ChevronUp />
          {t.series.moveEarlier}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={last} onSelect={() => onMove("later")}>
          <ChevronDown />
          {t.series.moveLater}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onRemove}>
          <X />
          {t.playlists.removeFromPlaylist}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PlaylistEditForm({
  playlist,
  onSaved,
  onCancel,
}: {
  playlist: PlaylistDetail;
  onSaved: (playlist: PlaylistDetail) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(playlist.title);
  const [description, setDescription] = useState(playlist.description);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const t = useT();

  async function save() {
    setSaving(true);
    try {
      onSaved((await api.updatePlaylist(playlist.id, { title, description })).playlist);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
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
        <Label htmlFor="playlist-title">{t.common.title}</Label>
        <Input id="playlist-title" value={title} maxLength={TITLE_MAX_LENGTH} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="playlist-description">{t.common.description}</Label>
        <Textarea id="playlist-description" value={description} maxLength={DESCRIPTION_MAX_LENGTH} onChange={(e) => setDescription(e.target.value)} rows={4} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={saving || title.trim() === ""}>
          {saving ? t.common.saving : t.common.save}
        </Button>
        <Button onClick={onCancel}>{t.common.cancel}</Button>
      </div>
    </form>
  );
}

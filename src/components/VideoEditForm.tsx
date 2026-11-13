import { Layers, Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { DESCRIPTION_MAX_LENGTH, TITLE_MAX_LENGTH, type SeriesSummary, type UpdateVideoRequest, type VideoDetail } from "../../shared/api.ts";
import { api } from "../api.ts";
import { useT } from "../i18n.ts";
import { cn } from "../lib/utils.ts";
import { Link } from "../router.tsx";
import { AddToPlaylist } from "./AddToPlaylist.tsx";
import { AddToSeries } from "./AddToSeries.tsx";
import { Button, buttonVariants } from "./ui/button.tsx";
import { Input, Label, Textarea } from "./ui/field.tsx";
import { Select } from "./ui/select.tsx";
import { useToast } from "./ui/toast.tsx";

/**
 * The title, the series, and the description of a video on its page. Beside the title, Add to
 * playlist puts the video in the playlists of the signed-in person. For the uploader of the video
 * and admins, Add to series puts it in a series, and a small pencil opens the edit page of the
 * video. The series leads to its page.
 */
export function VideoTitle({ video, onChange }: { video: VideoDetail; onChange: (video: VideoDetail) => void }) {
  const t = useT();
  return (
    <header className="grid gap-4">
      <div className="flex items-start justify-between gap-3">
        {/* The title under the player takes the size of a section heading, not of a page heading. */}
        <h1 className="min-w-0 text-figure font-bold break-words text-strong">{video.title}</h1>
        <div className="flex shrink-0 items-center gap-1">
          <AddToPlaylist videoId={video.id} />
          {video.canEdit && <AddToSeries video={video} onChange={onChange} />}
          {video.canEdit && (
            <Link to={`/videos/${video.id}/edit`} className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "text-subdued")}>
              <Pencil aria-hidden="true" />
              <span className="sr-only">{t.common.edit}</span>
            </Link>
          )}
        </div>
      </div>
      {video.series !== null && (
        <Link to={`/series/${video.series.id}`} className="flex w-fit items-center gap-1.5 text-sm font-semibold text-accent hover:underline [&_svg]:size-4">
          <Layers aria-hidden="true" />
          {video.series.title}
          <span className="font-normal text-label">· {t.video.episode(video.series.episode)}</span>
        </Link>
      )}
      {video.description && <p className="max-w-[75ch] text-sm leading-relaxed break-words whitespace-pre-wrap">{video.description}</p>}
    </header>
  );
}

/** The form of the edit page that changes the title, the description, and the series of a video. */
export function VideoEditForm({
  video,
  onSaved,
  onCancel,
}: {
  video: VideoDetail;
  onSaved: (video: VideoDetail) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(video.title);
  const [description, setDescription] = useState(video.description);
  const [seriesId, setSeriesId] = useState(video.series?.id ?? "");
  const [seriesList, setSeriesList] = useState<SeriesSummary[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();
  const t = useT();

  // The list of series loads when the form opens, so the video page itself needs one request.
  useEffect(() => {
    let active = true;
    api
      .listSeries()
      .then(({ series }) => {
        if (active) setSeriesList(series);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, []);

  async function save() {
    setSaving(true);
    const changes: UpdateVideoRequest = { title, description };
    const chosen = seriesId === "" ? null : seriesId;
    if (chosen !== (video.series?.id ?? null)) changes.seriesId = chosen;
    try {
      onSaved((await api.updateVideo(video.id, changes)).video);
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
        if (title.trim() !== "" && seriesList !== null) void save();
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="video-title">{t.common.title}</Label>
        <Input id="video-title" value={title} maxLength={TITLE_MAX_LENGTH} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="video-description">{t.common.description}</Label>
        <Textarea id="video-description" value={description} maxLength={DESCRIPTION_MAX_LENGTH} onChange={(e) => setDescription(e.target.value)} rows={5} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="video-series">{t.common.series}</Label>
        {/* Until the list of series loads, the field shows the series of the video. */}
        <Select
          id="video-series"
          value={seriesId}
          options={[
            { value: "", label: t.video.noSeries },
            ...(seriesList ?? (video.series === null ? [] : [video.series])).map((series) => ({ value: series.id, label: series.title })),
          ]}
          onChange={setSeriesId}
          disabled={seriesList === null}
        />
      </div>
      {error && <p className="error-box">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={saving || title.trim() === "" || seriesList === null}>
          {saving ? t.common.saving : t.common.save}
        </Button>
        <Button onClick={onCancel}>{t.common.cancel}</Button>
      </div>
    </form>
  );
}

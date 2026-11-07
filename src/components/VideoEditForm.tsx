import { useEffect, useState } from "react";
import { DESCRIPTION_MAX_LENGTH, TITLE_MAX_LENGTH, type SeriesSummary, type UpdateVideoRequest, type VideoDetail } from "../../shared/api.ts";
import { api } from "../api.ts";
import { useT } from "../i18n.ts";
import { Button } from "./ui/button.tsx";
import { Input, Label, Textarea } from "./ui/field.tsx";

/**
 * The title and the description of a video, and the form that edits them with the
 * series. Only the uploader of the video and admins see the Edit button.
 */
export function VideoEditForm({ video, onSaved }: { video: VideoDetail; onSaved: (video: VideoDetail) => void }) {
  const [editing, setEditing] = useState(false);
  const t = useT();

  if (!editing) {
    return (
      <header className="grid gap-4">
        <div className="flex items-start justify-between gap-3">
          <h1 className="min-w-0 text-display font-bold break-words text-strong">{video.title}</h1>
          {video.canEdit && (
            <Button className="mt-1" onClick={() => setEditing(true)}>
              {t.common.edit}
            </Button>
          )}
        </div>
        {video.description && <p className="max-w-[75ch] text-sm leading-relaxed break-words whitespace-pre-wrap">{video.description}</p>}
      </header>
    );
  }

  return (
    <EditForm
      video={video}
      onSaved={(saved) => {
        onSaved(saved);
        setEditing(false);
      }}
      onCancel={() => setEditing(false)}
    />
  );
}

function EditForm({
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
    setError("");
    const changes: UpdateVideoRequest = { title, description };
    const chosen = seriesId === "" ? null : seriesId;
    if (chosen !== (video.series?.id ?? null)) changes.seriesId = chosen;
    try {
      onSaved((await api.updateVideo(video.id, changes)).video);
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
        <select id="video-series" value={seriesId} onChange={(e) => setSeriesId(e.target.value)} disabled={seriesList === null} className="field">
          <option value="">{t.video.noSeries}</option>
          {seriesList?.map((series) => (
            <option key={series.id} value={series.id}>
              {series.title}
            </option>
          ))}
        </select>
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

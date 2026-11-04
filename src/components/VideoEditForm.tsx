import { useEffect, useState } from "react";
import { DESCRIPTION_MAX_LENGTH, TITLE_MAX_LENGTH, type SeriesSummary, type UpdateVideoRequest, type VideoDetail } from "../../shared/api.ts";
import { api } from "../api.ts";
import { formatDate, formatDuration } from "../lib/format.ts";
import { Link } from "../router.tsx";
import { Avatar } from "./Avatar.tsx";
import { StarRating } from "./StarRating.tsx";
import { Button } from "./ui/button.tsx";

/**
 * The title, facts, and description of a video, and the form that edits them.
 * Only the uploader of the video and admins see the Edit button.
 */
export function VideoEditForm({ video, onSaved }: { video: VideoDetail; onSaved: (video: VideoDetail) => void }) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <section className="panel grid gap-2 p-5">
        <div className="flex items-start justify-between gap-3">
          <h1 className="heading min-w-0 text-2xl leading-tight break-words">{video.title}</h1>
          {video.canEdit && (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {video.uploader === null ? (
            <span />
          ) : (
            <Link to={`/users/${video.uploader.id}`} className="flex w-fit items-center gap-2.5 py-1 text-[13px] font-bold text-heading hover:underline">
              <Avatar url={video.uploader.avatarUrl} />
              {video.uploader.displayName}
            </Link>
          )}
          <StarRating videoId={video.id} rating={video.rating} onRated={(rating) => onSaved({ ...video, rating })} />
        </div>
        <p className="flex flex-wrap gap-x-3 text-xs font-bold text-muted">
          {video.durationSec !== null && <span className="tabular-nums">{formatDuration(video.durationSec)}</span>}
          {video.width !== null && video.height !== null && (
            <span className="tabular-nums">
              {video.width}x{video.height}
            </span>
          )}
          <span className="tabular-nums">{formatDate(video.createdAt)}</span>
        </p>
        {video.description && <p className="max-w-3xl text-[15px] leading-relaxed whitespace-pre-wrap">{video.description}</p>}
      </section>
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
    <section className="panel grid gap-2 p-5">
      <input
        type="text"
        value={title}
        maxLength={TITLE_MAX_LENGTH}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="Title"
        placeholder="Title"
        className="field h-9 font-bold"
      />
      <textarea
        value={description}
        maxLength={DESCRIPTION_MAX_LENGTH}
        onChange={(e) => setDescription(e.target.value)}
        rows={4}
        aria-label="Description"
        placeholder="Description"
        className="field resize-y py-2 leading-relaxed"
      />
      <select
        value={seriesId}
        onChange={(e) => setSeriesId(e.target.value)}
        disabled={seriesList === null}
        aria-label="Series"
        className="field h-9"
      >
        <option value="">No series</option>
        {seriesList?.map((series) => (
          <option key={series.id} value={series.id}>
            {series.title}
          </option>
        ))}
      </select>
      {error && <p className="error-box">{error}</p>}
      <div className="flex gap-2">
        <Button variant="primary"
          onClick={() => void save()}
          disabled={saving || title.trim() === "" || seriesList === null}>
          {saving ? "Saving..." : "Save"}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

import { Clapperboard } from "lucide-react";
import { useT } from "../i18n.ts";
import { UploadButton } from "./VideoUpload.tsx";

/**
 * The library, or a series, before its first video: that it has none yet, and the button
 * that uploads videos. For a series, the uploaded videos join it.
 */
export function EmptyLibrary({ seriesId }: { seriesId?: string }) {
  const t = useT();
  return (
    <div className="grid justify-items-center gap-4 rounded-lg border border-dashed border-border px-6 py-16 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-surface-subdued text-label">
        <Clapperboard className="size-6" aria-hidden="true" />
      </span>
      <p className="text-figure font-bold text-heading">{seriesId === undefined ? t.common.noVideosYet : t.series.noEpisodesYet}</p>
      <UploadButton prominent seriesId={seriesId} />
    </div>
  );
}

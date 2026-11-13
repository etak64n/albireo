import { Upload } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { PageHeader } from "../components/Page.tsx";
import { Shell } from "../components/Shell.tsx";
import { Button } from "../components/ui/button.tsx";
import { Label } from "../components/ui/field.tsx";
import { Select } from "../components/ui/select.tsx";
import { UploadPanel } from "../components/VideoUpload.tsx";
import { useT } from "../i18n.ts";
import { usePageTitle } from "../lib/title.ts";
import { cn } from "../lib/utils.ts";
import { useLibrary } from "../library.tsx";
import { useLocationSearch } from "../router.tsx";
import { useUploads } from "../uploads.tsx";

/**
 * The upload page: the series that the videos join, the place to drop videos or to choose
 * them, and the queue. The Upload button of a series opens it with that series chosen
 * (?series=). The list of series is the one that the sidebar has loaded.
 */
export function UploadPage() {
  const { series } = useLibrary();
  const uploader = useUploads();
  const t = useT();
  const search = useLocationSearch();
  const [chosen, setChosen] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  usePageTitle(t.upload.upload);

  // The address chooses the series, also when the page opens again from another Upload button.
  useEffect(() => setChosen(new URLSearchParams(search).get("series")), [search]);

  // A series that the library does not have, such as one deleted since, is no choice.
  const seriesId = chosen !== null && series !== null && !series.some((item) => item.id === chosen) ? null : chosen;

  function choose(event: ChangeEvent<HTMLInputElement>) {
    // Clearing the input empties its list of files, so the files are taken first.
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    uploader.add(files, seriesId);
  }

  return (
    // Videos dropped anywhere on the page join the chosen series (src/uploads.tsx).
    <Shell seriesId={seriesId} uploadPage>
      <PageHeader title={t.upload.upload} />
      <div className="grid gap-6">
        <div className="grid max-w-sm gap-1.5">
          <Label htmlFor="upload-series">{t.common.series}</Label>
          <Select
            id="upload-series"
            value={seriesId ?? ""}
            options={[{ value: "", label: t.video.noSeries }, ...(series ?? []).map((item) => ({ value: item.id, label: item.title }))]}
            onChange={(next) => setChosen(next === "" ? null : next)}
            disabled={series === null}
          />
        </div>
        <div
          className={cn(
            "grid justify-items-center gap-4 rounded-lg border-2 border-dashed px-6 py-16 text-center transition-colors duration-150",
            uploader.dragging ? "border-accent bg-surface-subdued" : "border-border",
          )}
        >
          <span className="grid size-12 place-items-center rounded-full bg-surface-subdued text-label">
            <Upload className="size-6" aria-hidden="true" />
          </span>
          <p className="text-figure font-bold text-heading">{t.upload.dropHere}</p>
          <input ref={inputRef} type="file" accept="video/*" multiple onChange={choose} className="hidden" />
          <Button variant="primary" size="lg" onClick={() => inputRef.current?.click()}>
            {t.upload.chooseFiles}
          </Button>
        </div>
        <UploadPanel />
      </div>
    </Shell>
  );
}

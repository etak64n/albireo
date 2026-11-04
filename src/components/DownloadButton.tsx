import { Download, LoaderCircle } from "lucide-react";
import { useState, type MouseEvent } from "react";
import type { VideoAttachment } from "../../shared/api.ts";
import { downloadFile } from "../lib/download.ts";
import { Button } from "./ui/button.tsx";

/**
 * Saves an attachment under its name. A click reads the file first; when that fails,
 * as without CORS rules for GET, the browser opens the signed URL instead. A compact
 * button shows only its icon on phones.
 */
export function DownloadButton({ attachment, compact = false }: { attachment: VideoAttachment; compact?: boolean }) {
  const [busy, setBusy] = useState(false);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    // Let the browser handle new tabs and its own menu as usual.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    downloadFile(attachment.downloadUrl, attachment.fileName)
      .catch(() => window.location.assign(attachment.downloadUrl))
      .finally(() => setBusy(false));
  }

  return (
    <Button asChild size="sm">
      <a href={attachment.downloadUrl} download={attachment.fileName} onClick={handleClick} aria-busy={busy}>
        {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
        <span className={compact ? "max-sm:sr-only" : undefined}>Download</span>
      </a>
    </Button>
  );
}

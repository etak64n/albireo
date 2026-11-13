import { Download } from "lucide-react";
import type { VideoAttachment } from "../../shared/api.ts";
import { useT } from "../i18n.ts";
import { Button } from "./ui/button.tsx";

/**
 * Saves an attachment under its name. albireo sends the file with that name, so the
 * browser saves it as it arrives, however large it is. A compact button shows only its
 * icon on phones.
 */
export function DownloadButton({ attachment, compact = false }: { attachment: VideoAttachment; compact?: boolean }) {
  const t = useT();
  return (
    <Button asChild>
      <a href={attachment.downloadUrl} download={attachment.fileName}>
        <Download aria-hidden="true" />
        <span className={compact ? "max-sm:sr-only" : undefined}>{t.attachments.download}</span>
      </a>
    </Button>
  );
}

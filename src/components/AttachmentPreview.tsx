import { X } from "lucide-react";
import { lazy, Suspense } from "react";
import type { VideoAttachment } from "../../shared/api.ts";
import { previewKindOf } from "../lib/attachments.ts";
import { DownloadButton } from "./DownloadButton.tsx";
import { Button } from "./ui/button.tsx";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "./ui/dialog.tsx";
import { Spinner } from "./ui/spinner.tsx";

// Each viewer loads only when a file of its kind is opened, because the PDF and the
// slide viewers are large.
const PdfPreview = lazy(() => import("./previews/PdfPreview.tsx"));
const SlidesPreview = lazy(() => import("./previews/SlidesPreview.tsx"));
const MarkdownPreview = lazy(() => import("./previews/MarkdownPreview.tsx"));
const TextPreview = lazy(() => import("./previews/TextPreview.tsx"));

/** An attachment over the page, almost as large as the window, with its download button. */
export function AttachmentPreview({ attachment, onClose }: { attachment: VideoAttachment | null; onClose: () => void }) {
  const kind = attachment === null ? null : previewKindOf(attachment.fileName);
  return (
    <Dialog open={attachment !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0">
        {attachment !== null && (
          <>
            <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
              <DialogTitle className="min-w-0 flex-1 truncate text-base">{attachment.fileName}</DialogTitle>
              <DownloadButton attachment={attachment} />
              <DialogClose asChild>
                <Button variant="ghost" size="icon" aria-label="Close the preview">
                  <X />
                </Button>
              </DialogClose>
            </header>
            <div className="min-h-0 flex-1 overflow-auto bg-raised">
              <Suspense fallback={<Spinner />}>
                {kind === "pdf" && <PdfPreview url={attachment.viewUrl} />}
                {kind === "slides" && <SlidesPreview url={attachment.viewUrl} />}
                {kind === "markdown" && <MarkdownPreview url={attachment.viewUrl} />}
                {kind === "text" && <TextPreview url={attachment.viewUrl} />}
                {kind === "image" && (
                  <div className="grid h-full place-items-center p-4">
                    <img src={attachment.viewUrl} alt={attachment.fileName} className="max-h-full max-w-full object-contain" />
                  </div>
                )}
              </Suspense>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

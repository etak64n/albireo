import { Eye, File, FileImage, FileText, Paperclip, Presentation, Trash2 } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";
import { ATTACHMENT_MAX_BYTES, type VideoAttachment, type VideoDetail } from "../../shared/api.ts";
import { api } from "../api.ts";
import { useT } from "../i18n.ts";
import { previewKindOf, type PreviewKind } from "../lib/attachments.ts";
import { formatBytes } from "../lib/format.ts";
import { put } from "../lib/upload.ts";
import { AttachmentPreview } from "./AttachmentPreview.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { DownloadButton } from "./DownloadButton.tsx";
import { Section } from "./Page.tsx";
import { Button } from "./ui/button.tsx";

/**
 * The files that go with a video, such as its slides or notes. Everyone can preview and
 * download them; the uploader of the video and admins attach and remove them.
 */
export function Attachments({ video, onChange }: { video: VideoDetail; onChange: (attachments: VideoAttachment[]) => void }) {
  const [uploading, setUploading] = useState<{ fileName: string; percent: number } | null>(null);
  const [error, setError] = useState("");
  const [previewing, setPreviewing] = useState<VideoAttachment | null>(null);
  const [removing, setRemoving] = useState<VideoAttachment | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const t = useT();

  if (video.attachments.length === 0 && !video.canEdit) return null;

  async function attach(file: globalThis.File) {
    setError("");
    if (file.size > ATTACHMENT_MAX_BYTES) {
      setError(t.attachments.tooLarge(formatBytes(ATTACHMENT_MAX_BYTES)));
      return;
    }
    setUploading({ fileName: file.name, percent: 0 });
    try {
      const started = await api.startAttachment(video.id, { fileName: file.name, fileSize: file.size });
      await put(started.url, file, started.contentType, new AbortController().signal, (bytes) =>
        setUploading({ fileName: file.name, percent: file.size === 0 ? 100 : Math.floor((bytes / file.size) * 100) }),
      );
      const { attachment } = await api.commitAttachment(started.attachmentId);
      onChange([...video.attachments, attachment]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(null);
    }
  }

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file !== undefined) void attach(file);
  }

  return (
    <Section
      title={t.attachments.attachments}
      actions={
        video.canEdit ? (
          <>
            <input ref={input} type="file" onChange={choose} className="hidden" />
            <Button onClick={() => input.current?.click()} disabled={uploading !== null}>
              <Paperclip aria-hidden="true" />
              {t.attachments.attach}
            </Button>
          </>
        ) : undefined
      }
    >
      {uploading !== null && (
        <p role="status" className="numeric truncate text-xs text-subdued">
          {t.attachments.uploading(uploading.fileName, uploading.percent)}
        </p>
      )}
      {error && <p className="error-box">{error}</p>}
      {video.attachments.length > 0 && (
        <ul className="grid divide-y divide-hairline border-y border-hairline">
          {video.attachments.map((attachment) => {
            const kind = previewKindOf(attachment.fileName);
            return (
              <li key={attachment.id} className="flex items-center gap-3 py-2">
                <KindIcon kind={kind} />
                <div className="grid min-w-0 flex-1">
                  <span className="truncate text-sm font-semibold text-strong">{attachment.fileName}</span>
                  <span className="numeric text-xs text-subdued">{formatBytes(attachment.fileSize)}</span>
                </div>
                {kind !== null && (
                  <Button onClick={() => setPreviewing(attachment)}>
                    <Eye aria-hidden="true" />
                    <span className="max-sm:sr-only">{t.attachments.preview}</span>
                  </Button>
                )}
                <DownloadButton attachment={attachment} compact />
                {video.canEdit && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-subdued"
                    aria-label={t.attachments.removeFile(attachment.fileName)}
                    onClick={() => setRemoving(attachment)}
                  >
                    <Trash2 />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <AttachmentPreview attachment={previewing} onClose={() => setPreviewing(null)} />
      <ConfirmDialog
        open={removing !== null}
        title={t.attachments.removeQuestion}
        confirmLabel={t.common.remove}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (removing === null) return;
          await api.removeAttachment(removing.id);
          onChange(video.attachments.filter((attachment) => attachment.id !== removing.id));
          setRemoving(null);
        }}
      >
        {removing !== null && <p className="truncate text-sm text-label">{removing.fileName}</p>}
      </ConfirmDialog>
    </Section>
  );
}

function KindIcon({ kind }: { kind: PreviewKind | null }) {
  const className = "size-4 shrink-0 text-subdued";
  if (kind === "slides") return <Presentation className={className} aria-hidden="true" />;
  if (kind === "image") return <FileImage className={className} aria-hidden="true" />;
  if (kind === null) return <File className={className} aria-hidden="true" />;
  return <FileText className={className} aria-hidden="true" />;
}

import { useEffect, useState } from "react";
import type { VideoDetail } from "../../shared/api.ts";
import { ApiError, api } from "../api.ts";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { PageHeader, Section } from "../components/Page.tsx";
import { Shell } from "../components/Shell.tsx";
import { ThumbnailEditor } from "../components/ThumbnailEditor.tsx";
import { Button } from "../components/ui/button.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { useToast } from "../components/ui/toast.tsx";
import { VideoEditForm } from "../components/VideoEditForm.tsx";
import { useT } from "../i18n.ts";
import { usePageTitle } from "../lib/title.ts";
import { useLibrary } from "../library.tsx";
import { navigate } from "../router.tsx";
import { forgetDeletedVideo } from "./HomePage.tsx";
import { NotFoundPage } from "./NotFoundPage.tsx";

/**
 * The edit page of a video: its title, its description, and its series beside its thumbnail,
 * which a frame of the video can replace, and the deletion of the video. Saving or canceling
 * goes back to the video, and deleting it goes to all videos.
 */
export function VideoEditPage({ id }: { id: string }) {
  const [video, setVideo] = useState<VideoDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [deleting, setDeleting] = useState(false);
  const { refresh } = useLibrary();
  const toast = useToast();
  const t = useT();
  usePageTitle(video === null ? null : t.video.editVideo);

  useEffect(() => {
    let active = true;
    api.getVideo(id).then(
      ({ video: loaded }) => {
        if (active) setVideo(loaded);
      },
      (err: unknown) => {
        if (active) setError(err);
      },
    );
    return () => {
      active = false;
    };
  }, [id]);

  if ((error instanceof ApiError && error.status === 404) || (video !== null && !video.canEdit)) return <NotFoundPage />;
  const back = () => navigate(`/videos/${id}`);

  return (
    <Shell>
      {error !== null ? (
        <p className="error-box">{error instanceof Error ? error.message : String(error)}</p>
      ) : video === null ? (
        <div className="grid gap-8" role="status" aria-label={t.common.loading}>
          <Skeleton className="h-9 w-1/3" />
          <div className="grid gap-10 @3xl:grid-cols-[minmax(0,1fr)_360px]">
            <Skeleton className="h-72" />
            <Skeleton className="aspect-video" />
          </div>
        </div>
      ) : (
        <div className="grid gap-8">
          <PageHeader title={t.video.editVideo} actions={<Button onClick={() => setDeleting(true)}>{t.common.delete}</Button>} />
          {/* The details on the left, and the thumbnail beside them on wide pages or under them on narrow ones. */}
          <div className="grid content-start gap-10 @3xl:grid-cols-[minmax(0,1fr)_360px]">
            <Section title={t.video.details}>
              <VideoEditForm
                video={video}
                onSaved={() => {
                  toast.success(t.toast.saved);
                  back();
                }}
                onCancel={back}
              />
            </Section>
            <Section title={t.thumbnail.thumbnail}>
              <ThumbnailEditor video={video} onChange={setVideo} />
            </Section>
          </div>
          <ConfirmDialog
            open={deleting}
            title={t.video.deleteQuestion}
            confirmLabel={t.common.delete}
            onClose={() => setDeleting(false)}
            onConfirm={async () => {
              await api.deleteVideo(video.id);
              forgetDeletedVideo(video.id);
              toast.success(t.toast.deleted(video.title));
              // The series of the video changed, which moves it up in the sidebar.
              if (video.series !== null) await refresh();
              navigate("/videos");
            }}
          >
            <p className="text-sm">{t.video.deleteRemovesAll}</p>
          </ConfirmDialog>
        </div>
      )}
    </Shell>
  );
}

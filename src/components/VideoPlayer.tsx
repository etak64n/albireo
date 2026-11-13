import "@videojs/react/video/neutral-skin.css";
import { I18nProvider } from "@videojs/react/i18n";
import { NeutralVideoSkin, Video, VideoPlayer as Player } from "@videojs/react/video";
import { useRef, useState, type RefObject } from "react";
import type { VideoDetail } from "../../shared/api.ts";
import { api } from "../api.ts";
import { useLanguage } from "../i18n.ts";

// When playback fails, as while albireo restarts, the player loads the video again and
// resumes where it stopped, at most once a minute so a video that cannot play cannot loop.
const REFRESH_INTERVAL_MS = 60_000;

/**
 * The player of Video.js with its neutral skin. The skin brings the controls, the
 * playback speed, picture-in-picture, full screen, and keyboard shortcuts once the
 * player has focus. Video passes the events of the native video element through. The
 * controls speak the language of the app, from the translations that Video.js brings.
 */
export function VideoPlayer({
  video,
  videoRef,
  autoPlay,
  onEnded,
}: {
  video: VideoDetail;
  /** The video element, for the page to move the playback position, as a time in a comment does. */
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Starts playing at once, as when the previous episode of a series ended. */
  autoPlay: boolean;
  onEnded: () => void;
}) {
  const [src, setSrc] = useState(video.playbackUrl);
  const resumeAt = useRef<number | null>(null);
  const lastRefresh = useRef(0);
  const recorded = useRef(false);
  const language = useLanguage();

  // The first playback on the page puts the video at the front of the history.
  function handlePlay() {
    if (recorded.current) return;
    recorded.current = true;
    void api.recordWatch(video.id).catch(() => undefined);
  }

  async function handleError() {
    if (Date.now() - lastRefresh.current < REFRESH_INTERVAL_MS) return;
    lastRefresh.current = Date.now();
    resumeAt.current = videoRef.current?.currentTime ?? null;
    try {
      const { video: fresh } = await api.getVideo(video.id);
      // A new source clears the error that the skin shows.
      setSrc(fresh.playbackUrl);
    } catch {
      // The skin keeps showing the playback error.
    }
  }

  function handleLoadedMetadata() {
    const element = videoRef.current;
    if (element === null || resumeAt.current === null) return;
    element.currentTime = resumeAt.current;
    resumeAt.current = null;
    void element.play().catch(() => undefined);
  }

  return (
    <I18nProvider locale={language}>
      <Player poster={video.thumbnailUrl}>
        <NeutralVideoSkin className="albireo-player">
          <Video
            ref={videoRef}
            src={src}
            playsInline
            autoPlay={autoPlay}
            preload="metadata"
            onError={() => void handleError()}
            onLoadedMetadata={handleLoadedMetadata}
            onPlay={handlePlay}
            onEnded={onEnded}
          />
        </NeutralVideoSkin>
      </Player>
    </I18nProvider>
  );
}

import { useEffect, useState } from "react";
import type { VideoSummary } from "../../shared/api.ts";
import { api } from "../api.ts";
import { EmptyLibrary } from "../components/EmptyLibrary.tsx";
import { Shell } from "../components/Shell.tsx";
import { VideoGrid, VideoGridSkeleton } from "../components/VideoGrid.tsx";
import { useT } from "../i18n.ts";
import { usePageTitle } from "../lib/title.ts";
import { useUploads } from "../uploads.tsx";

// Home shows the recommendations when the page loads for the first time in this long, as
// this browser recorded it, and videos at random from the whole library when the page loads
// again before then.
const RECOMMENDATIONS_EVERY_MS = 15 * 60 * 1000;
const RECOMMENDED_AT = "albireo.home.recommendedAt";

type HomeMode = "recommended" | "random";

// What Home shows in this load of the page, kept in memory until the page loads again: the
// kind of its list, decided when Home opens for the first time, and the videos that it showed
// last, with the number of uploads that had finished then. Coming back to Home from another
// page shows the same videos, and asks the API nothing.
let loadMode: HomeMode | null = null;
let shown: { videos: VideoSummary[]; completed: number } | null = null;

/** Takes a deleted video out of the videos that Home keeps, so coming back to Home does not show it. */
export function forgetDeletedVideo(id: string): void {
  if (shown !== null) shown = { ...shown, videos: shown.videos.filter((video) => video.id !== id) };
}

/** The kind of list of this load of the page, the same each time Home opens in it. */
function modeOfThisLoad(): HomeMode {
  loadMode ??= modeByLastRecommendations(Date.now());
  return loadMode;
}

/** The recommendations, unless this browser showed them within RECOMMENDATIONS_EVERY_MS. */
function modeByLastRecommendations(now: number): HomeMode {
  try {
    const last = Number(window.localStorage.getItem(RECOMMENDED_AT));
    return last > 0 && now - last < RECOMMENDATIONS_EVERY_MS ? "random" : "recommended";
  } catch {
    // A browser that keeps no storage gets the recommendations on every load.
    return "recommended";
  }
}

function rememberRecommendations(now: number): void {
  try {
    window.localStorage.setItem(RECOMMENDED_AT, String(now));
  } catch {
    // Without storage, every load is a first one.
  }
}

/**
 * The videos of Home, in a grid without a title: the recommendations for the signed-in person
 * when the page loads for the first time in a while, and videos at random when it loads again
 * before then. Coming back to Home from another page shows the same videos again.
 */
export function HomePage() {
  const { completed } = useUploads();
  const mode = modeOfThisLoad();
  const [videos, setVideos] = useState(() => shown?.videos ?? null);
  const [error, setError] = useState("");
  const t = useT();
  usePageTitle(null);

  // The list loads when Home opens for the first time in this load of the page, and again
  // when an upload has finished since, so the new video shows up.
  useEffect(() => {
    if (shown !== null && shown.completed === completed) return;
    let active = true;
    const load = async () => {
      try {
        const loaded = mode === "recommended" ? (await api.getRecommendations()).videos : (await api.getRandomVideos()).videos;
        if (mode === "recommended") rememberRecommendations(Date.now());
        shown = { videos: loaded, completed };
        if (active) setVideos(loaded);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : String(err));
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [mode, completed]);

  return (
    <Shell>
      <h1 className="sr-only">{t.shell.home}</h1>
      {error && <p className="error-box">{error}</p>}
      {videos === null && error === "" && <VideoGridSkeleton />}
      {videos !== null && videos.length === 0 && <EmptyLibrary />}
      {videos !== null && videos.length > 0 && <VideoGrid videos={videos} />}
    </Shell>
  );
}

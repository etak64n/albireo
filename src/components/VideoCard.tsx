import type { VideoSummary } from "../../shared/api.ts";
import { formatDate } from "../lib/format.ts";
import { Link } from "../router.tsx";
import { Avatar } from "./Avatar.tsx";
import { Thumbnail } from "./Thumbnail.tsx";

/** A video in a grid: its picture, and under it the uploader, the title, and the date. The gray of hover shows that it opens. */
export function VideoCard({ video }: { video: VideoSummary }) {
  const byline = [video.uploader?.displayName, formatDate(video.createdAt)].filter((part) => part !== undefined && part !== "");
  return (
    <Link to={`/videos/${video.id}`} className="-m-2 grid content-start gap-3 rounded-lg p-2 transition-colors duration-150 hover:bg-surface-hover">
      <Thumbnail url={video.thumbnailUrl} durationSec={video.durationSec} />
      <div className="flex gap-3">
        {video.uploader !== null && <Avatar url={video.uploader.avatarUrl} />}
        <div className="grid min-w-0 content-start gap-0.5">
          <h3 className="line-clamp-2 text-sm font-semibold text-heading">{video.title}</h3>
          <p className="numeric truncate text-xs text-subdued">{byline.join(" · ")}</p>
        </div>
      </div>
    </Link>
  );
}

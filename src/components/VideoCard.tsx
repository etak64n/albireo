import type { VideoSummary } from "../../shared/api.ts";
import { formatDate } from "../lib/format.ts";
import { Link } from "../router.tsx";
import { Avatar } from "./Avatar.tsx";
import { Thumbnail } from "./Thumbnail.tsx";

export function VideoCard({ video }: { video: VideoSummary }) {
  const byline = [video.uploader?.displayName, formatDate(video.createdAt)].filter((part) => part !== undefined && part !== "");
  return (
    <Link to={`/videos/${video.id}`} className="group card block animate-appear hover:-translate-y-1 hover:shadow-lift">
      <Thumbnail url={video.thumbnailUrl} durationSec={video.durationSec} />
      <div className="flex gap-3 px-4 py-3.5">
        {video.uploader !== null && <Avatar url={video.uploader.avatarUrl} />}
        <div className="grid min-w-0 gap-1">
          <h3 className="line-clamp-2 font-heading text-base leading-snug font-bold text-heading">{video.title}</h3>
          <p className="truncate text-[13px] font-bold text-muted">{byline.join(" · ")}</p>
        </div>
      </div>
    </Link>
  );
}

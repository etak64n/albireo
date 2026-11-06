import { Trash2 } from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";
import { COMMENT_MAX_LENGTH, type VideoComment } from "../../shared/api.ts";
import { api } from "../api.ts";
import { formatDate } from "../lib/format.ts";
import { splitTimes } from "../lib/timestamps.ts";
import { Link } from "../router.tsx";
import { useSession } from "../session.tsx";
import { Avatar } from "./Avatar.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { Section } from "./Page.tsx";
import { Button } from "./ui/button.tsx";
import { Textarea } from "./ui/field.tsx";

/**
 * The comments under a video, from the newest, and the form that adds one.
 * A time in a comment, such as 1:23, plays the video from there.
 */
export function Comments({
  videoId,
  durationSec,
  onSeek,
}: {
  videoId: string;
  durationSec: number | null;
  onSeek: (seconds: number) => void;
}) {
  const [comments, setComments] = useState<VideoComment[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<VideoComment | null>(null);

  const load = useCallback(
    async (cursor: string | null) => {
      try {
        const page = await api.listComments(videoId, cursor);
        setComments((current) => (cursor === null ? page.comments : [...(current ?? []), ...page.comments]));
        setNextCursor(page.nextCursor);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [videoId],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  async function loadMore() {
    setLoadingMore(true);
    await load(nextCursor);
    setLoadingMore(false);
  }

  return (
    <Section title="Comments">
      <CommentForm
        videoId={videoId}
        onPosted={(comment) => setComments((current) => [comment, ...(current ?? [])])}
      />
      {error && <p className="error-box">{error}</p>}
      {comments !== null && comments.length > 0 && (
        <ul className="grid gap-6 pt-2">
          {comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              durationSec={durationSec}
              onSeek={onSeek}
              onDelete={() => setDeleting(comment)}
            />
          ))}
        </ul>
      )}
      {nextCursor !== null && (
        <div className="pt-2 text-center">
          <Button onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? "Loading..." : "Load more"}
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this comment?"
        confirmLabel="Delete"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (deleting === null) return;
          await api.deleteComment(deleting.id);
          setComments((current) => (current ?? []).filter((comment) => comment.id !== deleting.id));
          setDeleting(null);
        }}
      >
        {deleting !== null && <p className="line-clamp-4 text-sm break-words whitespace-pre-wrap text-label">{deleting.body}</p>}
      </ConfirmDialog>
    </Section>
  );
}

function CommentForm({ videoId, onPosted }: { videoId: string; onPosted: (comment: VideoComment) => void }) {
  const { me } = useSession();
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");

  async function post() {
    setPosting(true);
    setError("");
    try {
      onPosted((await api.createComment(videoId, text)).comment);
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPosting(false);
    }
  }

  return (
    <form
      className="flex gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim() !== "") void post();
      }}
    >
      <Avatar url={me.avatarUrl} />
      <div className="grid min-w-0 flex-1 gap-2">
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={COMMENT_MAX_LENGTH}
          rows={2}
          placeholder="Add a comment"
          aria-label="Comment"
        />
        {error && <p className="text-xs font-semibold text-critical">{error}</p>}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={posting || text.trim() === ""}>
            {posting ? "Posting..." : "Comment"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function CommentItem({
  comment,
  durationSec,
  onSeek,
  onDelete,
}: {
  comment: VideoComment;
  durationSec: number | null;
  onSeek: (seconds: number) => void;
  onDelete: () => void;
}) {
  const author = `/users/${comment.author.id}`;
  return (
    <li className="flex gap-3">
      <Link to={author} className="shrink-0 self-start rounded-full">
        <Avatar url={comment.author.avatarUrl} />
      </Link>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <Link to={author} className="text-sm font-semibold text-strong hover:underline">
            {comment.author.displayName}
          </Link>
          <time dateTime={comment.createdAt} className="numeric text-xs text-subdued">
            {formatDate(comment.createdAt)}
          </time>
        </p>
        <p className="max-w-[75ch] text-sm leading-relaxed break-words whitespace-pre-wrap">
          {splitTimes(comment.body, durationSec).map((part, index) =>
            part.kind === "text" ? (
              <Fragment key={index}>{part.text}</Fragment>
            ) : (
              <button
                key={index}
                type="button"
                onClick={() => onSeek(part.seconds)}
                aria-label={`Play from ${part.text}`}
                className="numeric cursor-pointer rounded-xs font-semibold text-accent hover:underline"
              >
                {part.text}
              </button>
            ),
          )}
        </p>
      </div>
      {comment.canDelete && (
        <Button variant="ghost" size="icon" className="shrink-0 text-subdued" aria-label="Delete the comment" onClick={onDelete}>
          <Trash2 />
        </Button>
      )}
    </li>
  );
}

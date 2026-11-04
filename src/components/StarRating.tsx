import { Star } from "lucide-react";
import { RadioGroup } from "radix-ui";
import { useState } from "react";
import { RATING_MAX_STARS, type RatingResponse, type VideoRating } from "../../shared/api.ts";
import { api } from "../api.ts";
import { cn } from "../lib/utils.ts";
import { Button } from "./ui/button.tsx";

const STARS = Array.from({ length: RATING_MAX_STARS }, (_, index) => index + 1);

/**
 * The stars that the signed-in person gives a video, and beside them everyone's average
 * and the number of ratings, once someone rated it.
 * The stars are radio buttons, so the arrow keys move between them as well.
 */
export function StarRating({
  videoId,
  rating,
  onRated,
}: {
  videoId: string;
  rating: VideoRating;
  onRated: (rating: VideoRating) => void;
}) {
  // While the pointer is over a star, the stars up to it light up to show the rating that a click gives.
  const [hovered, setHovered] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const lit = hovered ?? rating.mine ?? 0;

  async function save(change: () => Promise<RatingResponse>) {
    setSaving(true);
    setError("");
    try {
      onRated((await change()).rating);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid justify-items-end gap-1">
      <div className="flex items-center gap-2.5">
        <RadioGroup.Root
          value={rating.mine === null ? "" : String(rating.mine)}
          onValueChange={(value) => void save(() => api.rateVideo(videoId, Number(value)))}
          disabled={saving}
          orientation="horizontal"
          aria-label="Your rating"
          className="flex"
          onPointerLeave={() => setHovered(null)}
        >
          {STARS.map((stars) => (
            <RadioGroup.Item
              key={stars}
              value={String(stars)}
              aria-label={stars === 1 ? "1 star" : `${stars} stars`}
              onPointerEnter={() => setHovered(stars)}
              className="cursor-pointer p-0.5 transition duration-150 hover:scale-110 disabled:cursor-default pointer-coarse:p-2.5"
            >
              <Star
                aria-hidden="true"
                className={cn("size-5", stars <= lit ? "fill-current text-accent" : "fill-transparent text-muted")}
              />
            </RadioGroup.Item>
          ))}
        </RadioGroup.Root>
        {rating.average !== null && (
          <span className="text-xs font-bold whitespace-nowrap text-muted tabular-nums">
            {rating.average.toFixed(1)} ({rating.count})
          </span>
        )}
        {rating.mine !== null && (
          <Button variant="ghost" size="sm" onClick={() => void save(() => api.clearRating(videoId))} disabled={saving}>
            Clear
          </Button>
        )}
      </div>
      {error && <p className="text-xs font-bold text-danger">{error}</p>}
    </div>
  );
}

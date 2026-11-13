import { Star } from "lucide-react";
import { RadioGroup } from "radix-ui";
import { useRef, useState } from "react";
import { RATING_MAX_STARS, type RatingResponse, type VideoRating } from "../../shared/api.ts";
import { api } from "../api.ts";
import { useT } from "../i18n.ts";
import { withMine } from "../lib/rating.ts";
import { cn } from "../lib/utils.ts";
import { Button } from "./ui/button.tsx";
import { useToast } from "./ui/toast.tsx";

const STARS = Array.from({ length: RATING_MAX_STARS }, (_, index) => index + 1);


/**
 * The stars that the signed-in person gives a video, and beside them everyone's average
 * and the number of ratings, once someone rated it.
 * The stars are radio buttons, so the arrow keys move between them as well. A change shows at
 * once and saves behind: the answer of the API, which counts everyone's stars, takes its place,
 * and a failure puts the rating back and says why. Of quick changes, the last one counts.
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
  const latest = useRef(0);
  const toast = useToast();
  const t = useT();
  const lit = hovered ?? rating.mine ?? 0;

  async function save(stars: number | null) {
    latest.current += 1;
    const change = latest.current;
    const before = rating;
    onRated(withMine(rating, stars));
    try {
      const answer: RatingResponse = stars === null ? await api.clearRating(videoId) : await api.rateVideo(videoId, stars);
      if (change === latest.current) onRated(answer.rating);
    } catch (err) {
      if (change !== latest.current) return;
      onRated(before);
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="grid justify-items-start gap-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <RadioGroup.Root
          value={rating.mine === null ? "" : String(rating.mine)}
          onValueChange={(value) => void save(Number(value))}
          orientation="horizontal"
          aria-label={t.rating.yourRating}
          className="-ml-0.5 flex"
          onPointerLeave={() => setHovered(null)}
        >
          {STARS.map((stars) => (
            <RadioGroup.Item
              key={stars}
              value={String(stars)}
              aria-label={t.rating.stars(stars)}
              onPointerEnter={() => setHovered(stars)}
              className="cursor-pointer rounded-xs p-0.5 disabled:cursor-default pointer-coarse:p-2.5"
            >
              <Star
                aria-hidden="true"
                className={cn("size-[18px] transition-colors duration-150", stars <= lit ? "fill-current text-accent" : "fill-transparent text-placeholder")}
              />
            </RadioGroup.Item>
          ))}
        </RadioGroup.Root>
        {rating.average !== null && (
          <span className="numeric text-xs whitespace-nowrap text-subdued">
            {rating.average.toFixed(1)} ({rating.count})
          </span>
        )}
        {rating.mine !== null && (
          <Button variant="ghost" size="sm" className="text-subdued" onClick={() => void save(null)}>
            {t.rating.clear}
          </Button>
        )}
      </div>
    </div>
  );
}

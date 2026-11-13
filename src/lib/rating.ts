// The rating of a video as the page shows it right after the signed-in person changes their
// stars, before the API answers with the ratings of everyone.

import type { VideoRating } from "../../shared/api.ts";

/** The rating once the stars of the signed-in person count, or no longer count for null. */
export function withMine(rating: VideoRating, stars: number | null): VideoRating {
  const total = (rating.average ?? 0) * rating.count - (rating.mine ?? 0) + (stars ?? 0);
  const count = rating.count - (rating.mine === null ? 0 : 1) + (stars === null ? 0 : 1);
  return { average: count === 0 ? null : total / count, count, mine: stars };
}

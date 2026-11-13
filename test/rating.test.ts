import { describe, expect, it } from "vitest";
import { withMine } from "../src/lib/rating.ts";

describe("withMine", () => {
  it("adds the first rating of the person to the average", () => {
    expect(withMine({ average: 4, count: 2, mine: null }, 1)).toEqual({ average: 3, count: 3, mine: 1 });
    expect(withMine({ average: null, count: 0, mine: null }, 5)).toEqual({ average: 5, count: 1, mine: 5 });
  });

  it("replaces the rating of the person, and takes it back", () => {
    expect(withMine({ average: 4, count: 2, mine: 5 }, 1)).toEqual({ average: 2, count: 2, mine: 1 });
    expect(withMine({ average: 4, count: 2, mine: 5 }, null)).toEqual({ average: 3, count: 1, mine: null });
    expect(withMine({ average: 5, count: 1, mine: 5 }, null)).toEqual({ average: null, count: 0, mine: null });
  });
});

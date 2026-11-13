import { describe, expect, it } from "vitest";
import { splitTimes } from "../src/lib/timestamps.ts";

describe("splitTimes", () => {
  it("finds minutes and seconds, and hours in front", () => {
    expect(splitTimes("Look at 1:23 and 1:02:03!", null)).toEqual([
      { kind: "text", text: "Look at " },
      { kind: "time", text: "1:23", seconds: 83 },
      { kind: "text", text: " and " },
      { kind: "time", text: "1:02:03", seconds: 3723 },
      { kind: "text", text: "!" },
    ]);
  });

  it("finds times next to Japanese text and at both ends", () => {
    expect(splitTimes("0:05あたりから2:10", null)).toEqual([
      { kind: "time", text: "0:05", seconds: 5 },
      { kind: "text", text: "あたりから" },
      { kind: "time", text: "2:10", seconds: 130 },
    ]);
  });

  it("leaves impossible times, times past the end, and parts of longer numbers as text", () => {
    expect(splitTimes("10:75 1:75:00 3:00 2026:11", 120)).toEqual([{ kind: "text", text: "10:75 1:75:00 3:00 2026:11" }]);
  });

  it("returns the text alone when it has no times", () => {
    expect(splitTimes("Nice video", 120)).toEqual([{ kind: "text", text: "Nice video" }]);
    expect(splitTimes("", 120)).toEqual([]);
  });
});

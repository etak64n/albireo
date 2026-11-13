import { describe, expect, it } from "vitest";
import { inNameOrder, isVideo } from "../src/lib/upload-queue.ts";

const names = (...list: string[]) => list.map((name) => ({ name }));
const ordered = (...list: string[]) => inNameOrder(names(...list)).map((file) => file.name);

describe("inNameOrder", () => {
  it("counts a number in a name by its value", () => {
    expect(ordered("Day 10.mp4", "Day 2.mp4", "Day 1.mp4")).toEqual(["Day 1.mp4", "Day 2.mp4", "Day 10.mp4"]);
  });

  it("orders Japanese names with numbers the same way", () => {
    expect(ordered("勉強会 第10日目.mp4", "勉強会 第2日目.mp4", "勉強会 第1日目.mp4")).toEqual([
      "勉強会 第1日目.mp4",
      "勉強会 第2日目.mp4",
      "勉強会 第10日目.mp4",
    ]);
  });

  it("orders letters without their case", () => {
    expect(ordered("b.mp4", "A.mp4", "C.mp4")).toEqual(["A.mp4", "b.mp4", "C.mp4"]);
  });

  it("leaves the list that it is given as it was", () => {
    const files = names("2.mp4", "1.mp4");
    inNameOrder(files);
    expect(files.map((file) => file.name)).toEqual(["2.mp4", "1.mp4"]);
  });
});

describe("isVideo", () => {
  it("takes a file with a video type, and nothing else", () => {
    expect(isVideo({ type: "video/mp4" })).toBe(true);
    expect(isVideo({ type: "video/quicktime" })).toBe(true);
    expect(isVideo({ type: "application/pdf" })).toBe(false);
    expect(isVideo({ type: "" })).toBe(false);
  });
});

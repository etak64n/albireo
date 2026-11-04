import { describe, expect, it } from "vitest";
import { MAX_OBJECT_SIZE, MAX_PART_COUNT, MIN_PART_SIZE, planParts } from "../worker/upload-plan.ts";

const MIB = 1024 * 1024;

describe("planParts", () => {
  it("uses one part for a file up to the minimum part size", () => {
    expect(planParts(1)).toEqual({ partSize: MIN_PART_SIZE, partCount: 1 });
    expect(planParts(MIN_PART_SIZE)).toEqual({ partSize: MIN_PART_SIZE, partCount: 1 });
  });

  it("adds a part for the bytes after the last full part", () => {
    expect(planParts(MIN_PART_SIZE + 1)).toEqual({ partSize: MIN_PART_SIZE, partCount: 2 });
  });

  it("keeps the minimum part size while 10,000 parts cover the file", () => {
    expect(planParts(MIN_PART_SIZE * MAX_PART_COUNT)).toEqual({ partSize: MIN_PART_SIZE, partCount: MAX_PART_COUNT });
  });

  it("grows the parts so that a 5 TiB file fits in 10,000 parts", () => {
    const plan = planParts(MAX_OBJECT_SIZE);
    expect(plan.partCount).toBeLessThanOrEqual(MAX_PART_COUNT);
    expect(plan.partSize * plan.partCount).toBeGreaterThanOrEqual(MAX_OBJECT_SIZE);
    expect(plan.partSize % MIB).toBe(0);
  });

  it("refuses empty, fractional, and oversized files", () => {
    expect(() => planParts(0)).toThrow(RangeError);
    expect(() => planParts(1.5)).toThrow(RangeError);
    expect(() => planParts(MAX_OBJECT_SIZE + 1)).toThrow(RangeError);
  });
});

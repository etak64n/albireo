// Splits an upload into parts that S3-compatible storage accepts: at most
// 10,000 parts, each at most 5 GiB, for an object of at most 5 TiB.

const MIB = 1024 * 1024;

export const MIN_PART_SIZE = 16 * MIB;
export const MAX_PART_COUNT = 10_000;
export const MAX_OBJECT_SIZE = 5 * 1024 * 1024 * MIB;

export interface PartPlan {
  partSize: number;
  partCount: number;
}

export function planParts(fileSize: number): PartPlan {
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0) {
    throw new RangeError("The file size must be a positive whole number of bytes.");
  }
  if (fileSize > MAX_OBJECT_SIZE) {
    throw new RangeError("The file is larger than 5 TiB, the largest object that S3-compatible storage accepts.");
  }
  // Round up to whole mebibytes so that 10,000 parts always cover the file.
  const smallestForCount = Math.ceil(fileSize / MAX_PART_COUNT / MIB) * MIB;
  const partSize = Math.max(MIN_PART_SIZE, smallestForCount);
  return { partSize, partCount: Math.ceil(fileSize / partSize) };
}

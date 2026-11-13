// Which of the chosen files the upload queue takes, and in what order (src/uploads.tsx).

/** A file with a video type. The queue takes these and names the others in a notice. */
export function isVideo(file: { type: string }): boolean {
  return file.type.startsWith("video/");
}

const NAMES = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * The files in the order of their names as a person reads them: a number counts by its
 * value, so that "Day 2" comes before "Day 10", and letters count without their case.
 * Episodes that go up together join their series in this order.
 */
export function inNameOrder<T extends { name: string }>(files: readonly T[]): T[] {
  return [...files].sort((a, b) => NAMES.compare(a.name, b.name));
}

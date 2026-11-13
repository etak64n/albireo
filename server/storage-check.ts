// When albireo starts, it checks that it can do with the bucket what it does while it runs:
// write and read files, upload videos in parts, and delete files. The check works on keys
// under albireo-check/, deletes what it writes, and stops albireo before it serves anything
// when a setting is wrong, with an instruction that names the setting to change.

import { StorageError, type ObjectStore } from "./storage.ts";

/** What the access key must be allowed to do in the bucket. */
export type StoragePermission = "delete objects" | "write objects" | "read objects" | "upload videos in parts";

export type StorageProblem =
  /** The storage service did not answer, or answered with a failure of its own. */
  | { kind: "unreachable"; reason: string }
  | { kind: "no-bucket"; reason: string }
  | { kind: "rejected-key"; reason: string }
  | { kind: "wrong-region"; reason: string }
  | { kind: "missing-permissions"; missing: { permission: StoragePermission; reason: string }[] };

const CHECK_BODY = "albireo checks the access key of the bucket.";

// The codes of S3 errors that mean a setting is wrong, whatever the request was.
const NO_BUCKET = new Set(["NoSuchBucket"]);
const REJECTED_KEY = new Set(["InvalidAccessKeyId", "SignatureDoesNotMatch", "InvalidToken", "ExpiredToken"]);
const WRONG_REGION = new Set(["AuthorizationHeaderMalformed", "PermanentRedirect", "IllegalLocationConstraintException"]);

/**
 * Returns what keeps albireo from using the bucket, or null when nothing does. Deleting comes
 * first, on a key that holds no object, so that a key that may not delete stops the check
 * before it writes anything that it could not remove.
 */
export async function checkStorage(store: ObjectStore, checkId: string): Promise<StorageProblem | null> {
  const key = `albireo-check/${checkId}`;
  const missing: { permission: StoragePermission; reason: string }[] = [];
  // A failure that no permission explains ends the check at once.
  let fatal: StorageProblem | null = null;
  const attempt = async (permission: StoragePermission, action: () => Promise<void>): Promise<boolean> => {
    if (fatal !== null) return false;
    try {
      await action();
      return true;
    } catch (error) {
      fatal = fatalProblem(error);
      if (fatal === null && !missing.some((item) => item.permission === permission)) {
        missing.push({ permission, reason: error instanceof Error ? error.message : String(error) });
      }
      return false;
    }
  };

  if (!(await attempt("delete objects", () => store.deleteObject(`${key}-none`)))) return fatal ?? missingPermissions(missing);
  const bytes = new TextEncoder().encode(CHECK_BODY);
  const written = await attempt("write objects", () => store.putObject(key, "text/plain", new Blob([bytes]).stream(), bytes.length));
  if (written) {
    await attempt("read objects", async () => {
      const response = await store.getObject(key, "GET", new Headers());
      if (response === null) throw new Error("The object that albireo had just written was not there.");
      if ((await response.text()) !== CHECK_BODY) throw new Error("A read returned other bytes than the write sent.");
    });
    await attempt("delete objects", () => store.deleteObject(key));
  }
  await attempt("upload videos in parts", async () => {
    const uploadId = await store.createMultipartUpload(`${key}-parts`, "video/mp4");
    await store.abortMultipartUpload(`${key}-parts`, uploadId);
  });
  return fatal ?? missingPermissions(missing);
}

/** Whether running the check again later may pass: the storage service did not answer, or failed itself. */
export function mayPassLater(problem: StorageProblem): boolean {
  return problem.kind === "unreachable";
}

/** The instruction that stops albireo, with what the storage service answered. */
export function storageProblemMessage(problem: StorageProblem, bucket: string): string {
  switch (problem.kind) {
    case "unreachable":
      return `Please check that S3_ENDPOINT is the URL of your storage service and that this container can reach it. ${problem.reason}`;
    case "no-bucket":
      return `Please create the bucket ${bucket}, or set S3_BUCKET to a bucket that exists. ${problem.reason}`;
    case "rejected-key":
      return `Please check S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY: the storage service did not accept the access key. ${problem.reason}`;
    case "wrong-region":
      return `Please set S3_REGION to the region of the bucket ${bucket}. ${problem.reason}`;
    case "missing-permissions": {
      const names = problem.missing.map((item) => item.permission);
      const list = names.length === 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
      return [
        `Please give the access key in S3_ACCESS_KEY_ID permission to ${list} in the bucket ${bucket}.`,
        ...problem.missing.map((item) => `${item.permission}: ${item.reason}`),
      ].join(" ");
    }
  }
}

function missingPermissions(missing: { permission: StoragePermission; reason: string }[]): StorageProblem | null {
  return missing.length === 0 ? null : { kind: "missing-permissions", missing };
}

function fatalProblem(error: unknown): StorageProblem | null {
  const reason = error instanceof Error ? error.message : String(error);
  if (!(error instanceof StorageError)) return null;
  if (error.code !== null && NO_BUCKET.has(error.code)) return { kind: "no-bucket", reason };
  if (error.code !== null && REJECTED_KEY.has(error.code)) return { kind: "rejected-key", reason };
  if (error.code !== null && WRONG_REGION.has(error.code)) return { kind: "wrong-region", reason };
  // No answer, too many requests, or a failure of the storage service itself.
  if (error.status === null || error.status === 429 || error.status >= 500) return { kind: "unreachable", reason };
  return null;
}

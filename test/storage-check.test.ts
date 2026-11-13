import { describe, expect, it } from "vitest";
import { checkStorage, mayPassLater, storageProblemMessage } from "../server/storage-check.ts";
import { StorageError, type ObjectStore } from "../server/storage.ts";
import { MemoryObjectStore } from "./support/object-store.ts";

/** The bucket in memory, with one operation that fails with the error. */
function failing(operation: keyof ObjectStore, error: Error): MemoryObjectStore {
  const store = new MemoryObjectStore();
  Object.defineProperty(store, operation, { value: async () => Promise.reject(error) });
  return store;
}

const denied = (operation: string) => new StorageError(`${operation} failed with HTTP 403 (AccessDenied: Access Denied).`, 403, "AccessDenied");

describe("checkStorage", () => {
  it("passes a key that can do everything, and leaves nothing in the bucket", async () => {
    const store = new MemoryObjectStore();
    expect(await checkStorage(store, "check1")).toBeNull();
    expect([...store.objects.keys()]).toEqual([]);
    expect([...store.uploads.values()].map((upload) => upload.state)).toEqual(["aborted"]);
  });

  it("names each permission that the key lacks", async () => {
    const problem = await checkStorage(failing("createMultipartUpload", denied("CreateMultipartUpload")), "check1");
    expect(problem).toEqual({
      kind: "missing-permissions",
      missing: [{ permission: "upload videos in parts", reason: "CreateMultipartUpload failed with HTTP 403 (AccessDenied: Access Denied)." }],
    });
    expect(storageProblemMessage(problem!, "albireo-videos")).toBe(
      "Please give the access key in S3_ACCESS_KEY_ID permission to upload videos in parts in the bucket albireo-videos. "
        + "upload videos in parts: CreateMultipartUpload failed with HTTP 403 (AccessDenied: Access Denied).",
    );
  });

  it("stops at once when the key may not delete, before it writes anything", async () => {
    const store = failing("deleteObject", denied("DeleteObject"));
    const problem = await checkStorage(store, "check1");
    expect(problem).toMatchObject({ kind: "missing-permissions", missing: [{ permission: "delete objects" }] });
    expect([...store.objects.keys()]).toEqual([]);
  });

  it("tells a missing bucket, a key that the service does not accept, and a wrong region apart", async () => {
    const cases: [string, string, RegExp][] = [
      ["NoSuchBucket", "no-bucket", /^Please create the bucket albireo-videos, or set S3_BUCKET to a bucket that exists\./],
      ["InvalidAccessKeyId", "rejected-key", /^Please check S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY: /],
      ["SignatureDoesNotMatch", "rejected-key", /^Please check S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY: /],
      ["AuthorizationHeaderMalformed", "wrong-region", /^Please set S3_REGION to the region of the bucket albireo-videos\./],
    ];
    for (const [code, kind, message] of cases) {
      const problem = await checkStorage(failing("deleteObject", new StorageError(`DeleteObject failed with HTTP 400 (${code}).`, 400, code)), "check1");
      expect(problem?.kind).toBe(kind);
      expect(storageProblemMessage(problem!, "albireo-videos")).toMatch(message);
      expect(mayPassLater(problem!)).toBe(false);
    }
  });

  it("reports a storage service that does not answer, which may pass later", async () => {
    const problem = await checkStorage(failing("deleteObject", new StorageError("DeleteObject could not reach the storage service at http://s3:9000: fetch failed")), "check1");
    expect(problem).toEqual({ kind: "unreachable", reason: "DeleteObject could not reach the storage service at http://s3:9000: fetch failed" });
    expect(mayPassLater(problem!)).toBe(true);
    expect(storageProblemMessage(problem!, "albireo-videos")).toMatch(/^Please check that S3_ENDPOINT is the URL of your storage service /);
    const busy = await checkStorage(failing("deleteObject", new StorageError("DeleteObject failed with HTTP 503.", 503)), "check1");
    expect(busy?.kind).toBe("unreachable");
  });
});

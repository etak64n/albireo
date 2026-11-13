import { describe, expect, it } from "vitest";
import { isPassingStatus, retry } from "../shared/retry.ts";

describe("retry", () => {
  it("runs an action again after a failure that may pass, waiting twice as long each time", async () => {
    const waits: number[] = [];
    let attempts = 0;
    const result = await retry(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("busy");
        return "done";
      },
      { attempts: 3, firstDelayMs: 100, retryable: () => true, wait: async (ms) => void waits.push(ms) },
    );
    expect(result).toBe("done");
    expect(waits).toEqual([100, 200]);
  });

  it("stops at a failure that cannot pass, and after the last attempt", async () => {
    let attempts = 0;
    const failing = () =>
      retry(
        async () => {
          attempts += 1;
          throw new Error(attempts === 1 ? "busy" : "gone");
        },
        { attempts: 3, firstDelayMs: 1, retryable: (error) => error instanceof Error && error.message === "busy", wait: async () => undefined },
      );
    await expect(failing()).rejects.toThrow("gone");
    expect(attempts).toBe(2);
  });

  it("counts 429 and the failures of a server as passing, and the mistakes of a request as not", () => {
    expect([429, 500, 502, 503, 504].every(isPassingStatus)).toBe(true);
    expect([400, 401, 403, 404, 409, 501].some(isPassingStatus)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { readConfig, SETTING_NAMES } from "../server/config.ts";

const COMPLETE = {
  S3_ENDPOINT: "https://s3.example.com",
  S3_REGION: "us-east-1",
  S3_BUCKET: "albireo-videos",
  S3_URL_STYLE: "path",
  S3_ACCESS_KEY_ID: "AKIDEXAMPLE",
  S3_SECRET_ACCESS_KEY: "secret",
};

function problemsOf(env: Record<string, string | undefined>): string[] {
  const result = readConfig(env);
  return "problems" in result ? result.problems : [];
}

describe("readConfig", () => {
  it("reads the bucket from the environment", () => {
    expect(readConfig(COMPLETE)).toEqual({
      config: {
        storage: {
          endpoint: "https://s3.example.com",
          region: "us-east-1",
          bucket: "albireo-videos",
          urlStyle: "path",
          accessKeyId: "AKIDEXAMPLE",
          secretAccessKey: "secret",
        },
      },
    });
    expect(readConfig({ ...COMPLETE, S3_URL_STYLE: "virtual-hosted", S3_ENDPOINT: "http://minio:9000/s3" })).toMatchObject({
      config: { storage: { urlStyle: "virtual-hosted", endpoint: "http://minio:9000/s3" } },
    });
  });

  it("names every missing variable, each with an instruction that starts with Please", () => {
    const problems = problemsOf({});
    expect(problems).toHaveLength(SETTING_NAMES.length);
    for (const [index, name] of SETTING_NAMES.entries()) {
      expect(problems[index]).toMatch(new RegExp(`^Please set ${name} to `));
    }
    // An empty value is missing too.
    expect(problemsOf({ ...COMPLETE, S3_REGION: "" })).toEqual([
      "Please set S3_REGION to the region that your storage service expects in request signatures, such as us-east-1.",
    ]);
  });

  it("refuses an endpoint that is no http or https URL, or that has a query", () => {
    for (const endpoint of ["s3.example.com", "ftp://s3.example.com", "https://s3.example.com/?region=x", "https://key:secret@s3.example.com"]) {
      expect(problemsOf({ ...COMPLETE, S3_ENDPOINT: endpoint })).toEqual([
        `Please set S3_ENDPOINT to an http:// or https:// URL without a query or a fragment, such as https://s3.example.com. It is now ${JSON.stringify(endpoint)}.`,
      ]);
    }
  });

  it("refuses a bucket name that S3 does not allow, and an unknown URL style", () => {
    expect(problemsOf({ ...COMPLETE, S3_BUCKET: "Albireo_Videos" })[0]).toMatch(/^Please set S3_BUCKET to a bucket name of 3 to 63 /);
    expect(problemsOf({ ...COMPLETE, S3_URL_STYLE: "Path" })).toEqual(['Please set S3_URL_STYLE to path or virtual-hosted. It is now "Path".']);
  });
});

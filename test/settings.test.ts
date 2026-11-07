import { describe, expect, it } from "vitest";
import exampleSettings from "../albireo.config.example.ts";
import { SettingsError, validateSettings } from "../config/settings.ts";

// Returns the example settings with some values replaced. undefined removes a setting.
function settingsWith(changes: Record<string, unknown>): unknown {
  const settings = structuredClone(exampleSettings) as unknown as Record<string, unknown>;
  for (const [path, value] of Object.entries(changes)) {
    const keys = path.split(".");
    const last = keys.pop() ?? "";
    let target = settings;
    for (const key of keys) target = target[key] as Record<string, unknown>;
    if (value === undefined) delete target[last];
    else target[last] = value;
  }
  return settings;
}

// S3-compatible storage on this machine, such as MinIO, for development.
const localS3Storage = {
  type: "s3",
  endpoint: "http://localhost:9000",
  region: "us-east-1",
  bucket: "albireo-videos-dev",
  urlStyle: "path",
};

function problemsOf(input: unknown): string[] {
  try {
    validateSettings(input);
  } catch (error) {
    if (error instanceof SettingsError) return error.problems;
    throw error;
  }
  return [];
}

describe("validateSettings", () => {
  it("accepts the example settings", () => {
    expect(validateSettings(exampleSettings)).toEqual(exampleSettings);
  });

  it("names a missing setting", () => {
    expect(problemsOf(settingsWith({ "production.domain": undefined }))).toEqual(["production.domain is missing."]);
  });

  it("names a setting that albireo does not read, such as a misspelled one", () => {
    expect(problemsOf(settingsWith({ "production.domian": "videos.example.com" }))).toEqual([
      "production.domian is not a setting that albireo reads.",
    ]);
  });

  it("reports every problem at once", () => {
    expect(problemsOf(settingsWith({ accountId: "not-an-account", workerName: "Not A Name" }))).toEqual([
      "accountId must be a 32-character lowercase hexadecimal account ID.",
      "workerName must be lowercase letters, digits, and hyphens (at most 63 characters).",
    ]);
  });

  it("requires https for production storage", () => {
    expect(problemsOf(settingsWith({ "production.storage.endpoint": "http://s3.example.com" }))).toEqual([
      "production.storage.endpoint must be an https:// origin.",
    ]);
  });

  it("allows http on localhost for development storage", () => {
    const settings = validateSettings(settingsWith({ "development.storage": localS3Storage }));
    expect(settings.development.storage).toEqual(localS3Storage);
  });

  it("refuses http on other hosts for development storage", () => {
    const storage = { ...localS3Storage, endpoint: "http://s3.example.com" };
    expect(problemsOf(settingsWith({ "development.storage": storage }))).toEqual([
      "development.storage.endpoint must be an https:// origin, or an http:// origin on localhost.",
    ]);
  });

  it("keeps the local R2 bucket out of production", () => {
    expect(problemsOf(settingsWith({ "production.storage": { type: "local-r2" } }))).toEqual([
      'production.storage.type must be "s3". The local R2 bucket exists only in cf dev.',
    ]);
  });

  it("names a missing storage type", () => {
    expect(problemsOf(settingsWith({ "development.storage.type": undefined }))).toEqual([
      "development.storage.type is missing.",
    ]);
  });

  it("refuses an endpoint with a path", () => {
    expect(problemsOf(settingsWith({ "production.storage.endpoint": "https://s3.example.com/albireo" }))).toEqual([
      "production.storage.endpoint must be an https:// origin.",
    ]);
  });

  it("drops a trailing slash from an origin", () => {
    const settings = validateSettings(settingsWith({ "production.access.teamDomain": "https://example.cloudflareaccess.com/" }));
    expect(settings.production.access.teamDomain).toBe("https://example.cloudflareaccess.com");
  });

  it("lets every admin sign in through Access", () => {
    expect(problemsOf(settingsWith({ admins: ["admin@example.com", "editor@example.com"] }))).toEqual([
      "production.access.allow must include every admin, so that they can sign in: editor@example.com.",
    ]);
  });

  it("allows at least one person to sign in", () => {
    expect(problemsOf(settingsWith({ admins: [], "production.access.allow": [] }))).toEqual([
      "production.access.allow must name at least one person.",
    ]);
  });

  it("offers at least one login method", () => {
    expect(problemsOf(settingsWith({ "production.access.loginMethods": [] }))).toEqual([
      "production.access.loginMethods must name at least one login method.",
    ]);
  });

  it("names each login method once", () => {
    expect(problemsOf(settingsWith({ "production.access.loginMethods": ["onetimepin", "github", "onetimepin"] }))).toEqual([
      "production.access.loginMethods must name each login method once: onetimepin.",
    ]);
  });

  it("names login methods by a type or an ID without spaces", () => {
    expect(problemsOf(settingsWith({ "production.access.loginMethods": ["one-time pin"] }))).toEqual([
      'production.access.loginMethods must be a list of login method types or IDs, such as "onetimepin".',
    ]);
  });

  it("accepts no admins", () => {
    expect(validateSettings(settingsWith({ admins: [] })).admins).toEqual([]);
  });

  it("requires lowercase emails, which albireo compares with the email from Access", () => {
    expect(problemsOf(settingsWith({ admins: ["Admin@Example.com"], "development.signInAs": "not an email" }))).toEqual([
      "admins must be a list of lowercase email addresses.",
      "development.signInAs must be a lowercase email address.",
    ]);
  });

  it("requires a theme folder relative to the project", () => {
    expect(problemsOf(settingsWith({ "appearance.theme": "/etc/theme" }))).toEqual([
      'appearance.theme must be a folder path that starts with "./" or "../", without spaces.',
    ]);
  });

  it("limits signed URLs to seven days", () => {
    expect(problemsOf(settingsWith({ signedUrlTtlSeconds: 604_801 }))).toEqual([
      "signedUrlTtlSeconds must be a whole number from 60 to 604800.",
    ]);
  });
});

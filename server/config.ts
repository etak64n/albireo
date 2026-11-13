// Reads the settings of albireo from the environment variables of the container. albireo
// has one group of settings, the S3-compatible bucket. Every variable is required, and
// albireo has no default values, so a container behaves exactly as its variables say.

/** The S3-compatible API and the bucket that keep the videos and the other files. */
export interface StorageConfig {
  /** The URL of the API, an http:// or https:// origin, with a path when the API has one. */
  endpoint: string;
  region: string;
  bucket: string;
  urlStyle: "path" | "virtual-hosted";
  accessKeyId: string;
  secretAccessKey: string;
}

export interface Config {
  storage: StorageConfig;
}

/** The names of the environment variables, in the order that the documentation lists them. */
export const SETTING_NAMES = [
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_BUCKET",
  "S3_URL_STYLE",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
] as const;

type SettingName = (typeof SETTING_NAMES)[number];

// What to set when a variable is missing. Each one says what the value is and gives an example.
const MISSING: Record<SettingName, string> = {
  S3_ENDPOINT: "Please set S3_ENDPOINT to the URL of the S3-compatible API of your storage service, such as https://s3.example.com.",
  S3_REGION: "Please set S3_REGION to the region that your storage service expects in request signatures, such as us-east-1.",
  S3_BUCKET: "Please set S3_BUCKET to the name of the bucket that keeps the videos, such as albireo-videos.",
  S3_URL_STYLE:
    "Please set S3_URL_STYLE to path, which puts the bucket name in the path of each URL, or to virtual-hosted, which puts it in the hostname.",
  S3_ACCESS_KEY_ID: "Please set S3_ACCESS_KEY_ID to the ID of an access key that can read, write, and delete the objects of the bucket.",
  S3_SECRET_ACCESS_KEY: "Please set S3_SECRET_ACCESS_KEY to the secret of the access key in S3_ACCESS_KEY_ID.",
};

// The rules of S3 for bucket names: 3 to 63 lowercase letters, digits, dots, and hyphens,
// starting and ending with a letter or a digit.
const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

/** Reads the settings, or returns every problem, each one an instruction that starts with "Please". */
export function readConfig(env: Readonly<Record<string, string | undefined>>): { config: Config } | { problems: string[] } {
  const problems: string[] = [];
  const value = (name: SettingName): string => {
    const text = env[name] ?? "";
    if (text === "") problems.push(MISSING[name]);
    return text;
  };

  const endpoint = value("S3_ENDPOINT");
  if (endpoint !== "" && !isEndpoint(endpoint)) {
    problems.push(
      `Please set S3_ENDPOINT to an http:// or https:// URL without a query or a fragment, such as https://s3.example.com. It is now ${JSON.stringify(endpoint)}.`,
    );
  }
  const region = value("S3_REGION");
  const bucket = value("S3_BUCKET");
  if (bucket !== "" && !BUCKET_NAME.test(bucket)) {
    problems.push(
      `Please set S3_BUCKET to a bucket name of 3 to 63 lowercase letters, digits, dots, and hyphens that starts and ends with a letter or a digit. It is now ${JSON.stringify(bucket)}.`,
    );
  }
  const urlStyle = value("S3_URL_STYLE");
  if (urlStyle !== "" && urlStyle !== "path" && urlStyle !== "virtual-hosted") {
    problems.push(`Please set S3_URL_STYLE to path or virtual-hosted. It is now ${JSON.stringify(urlStyle)}.`);
  }
  const accessKeyId = value("S3_ACCESS_KEY_ID");
  const secretAccessKey = value("S3_SECRET_ACCESS_KEY");

  if (problems.length > 0) return { problems };
  return {
    config: {
      storage: {
        endpoint,
        region,
        bucket,
        urlStyle: urlStyle === "virtual-hosted" ? "virtual-hosted" : "path",
        accessKeyId,
        secretAccessKey,
      },
    },
  };
}

function isEndpoint(text: string): boolean {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  return (url.protocol === "http:" || url.protocol === "https:") && url.search === "" && url.hash === "" && !text.includes("?")
    && !text.includes("#") && url.username === "" && url.password === "";
}

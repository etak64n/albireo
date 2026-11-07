import { describe, expect, it } from "vitest";
import example from "../albireo.config.example.ts";
import { validateSettings } from "../config/settings.ts";
import { CfError, type Cf } from "../stack/cf.ts";
import { parseEnvFile } from "../stack/env-file.ts";
import { deleteStack, deployStack, loginMethodIds, STACK_TAG, stackResources, type LoginMethod, type StackResource } from "../stack/stack.ts";

const settings = validateSettings(example);
const SECRETS = { s3AccessKeyId: "key-id", s3SecretAccessKey: "secret" };
// The login methods of the organization. The example settings name "onetimepin".
const LOGIN_METHODS: LoginMethod[] = [
  { id: "idp-otp", type: "onetimepin", name: "" },
  { id: "idp-github", type: "github", name: "GitHub" },
];

/** Answers cf commands from a function, and records every command with its extra environment. */
class FakeCf implements Cf {
  readonly calls: string[][] = [];
  readonly envs: Record<string, string>[] = [];
  readonly answer: (args: string[]) => unknown;

  constructor(answer: (args: string[]) => unknown) {
    this.answer = answer;
  }

  json(args: readonly string[]): unknown {
    this.calls.push([...args]);
    const answer = this.answer([...args]);
    if (answer instanceof Error) throw answer;
    return answer;
  }

  run(args: readonly string[], env: Record<string, string> = {}): void {
    this.calls.push([...args]);
    this.envs.push(env);
    const answer = this.answer([...args]);
    if (answer instanceof Error) throw answer;
  }

  /** The commands that start with these words. */
  callsOf(...words: string[]): string[][] {
    return this.calls.filter((call) => words.every((word, index) => call[index] === word));
  }
}

const notFound = (args: string[]) => new CfError(args, "[10007] This Worker does not exist on your account.\n404 Not Found · HTTP /accounts/x/workers/workers/albireo");
const untagged = (args: string[]) => new CfError(args, "500 Internal Server Error · HTTP /accounts/x/tags");

function tagBodies(cf: FakeCf): { resource_type: string; resource_id: string; tags: Record<string, string> }[] {
  return cf.callsOf("tags", "account-resources", "update").map((call) => JSON.parse(call[call.indexOf("--body") + 1] ?? "{}"));
}

function writeSecretsFile(written: Record<string, string>[], removed: string[]) {
  return (values: Record<string, string>) => {
    written.push(values);
    return { path: "/tmp/albireo-test/secrets.json", remove: () => removed.push("/tmp/albireo-test/secrets.json") };
  };
}

describe("deployStack", () => {
  it("creates the database and the Access application, migrates, deploys with the IDs, and tags each resource", () => {
    let deployed = false;
    const cf = new FakeCf((args) => {
      const command = args.slice(0, 3).join(" ");
      if (command === "d1 list") return [{ uuid: "db-other", name: "notes" }];
      if (command === "zero-trust identity-providers list") return LOGIN_METHODS;
      if (args[0] === "d1" && args[1] === "create") return { uuid: "db-1", name: "albireo" };
      if (command === "zero-trust access applications") {
        if (args[3] === "list") return [];
        if (args[3] === "create") return { id: "app-1", aud: "aud-1" };
      }
      if (command === "workers get albireo") return deployed ? { id: "worker-1", name: "albireo" } : notFound(args);
      if (command === "tags account-resources get") return untagged(args);
      if (args[0] === "deploy") deployed = true;
      return {};
    });
    const written: Record<string, string>[] = [];
    const removed: string[] = [];

    const resources = deployStack({ settings, secrets: SECRETS, cf, log: () => {}, writeSecretsFile: writeSecretsFile(written, removed) });

    expect(cf.callsOf("d1", "create")).toEqual([["d1", "create", "--name", "albireo"]]);
    expect(cf.callsOf("d1", "migrations", "apply")).toEqual([["d1", "migrations", "apply", "db-1", "--dir", "migrations"]]);
    const created = cf.callsOf("zero-trust", "access", "applications", "create")[0] ?? [];
    expect(JSON.parse(created[created.indexOf("--body") + 1] ?? "{}")).toEqual({
      name: "albireo",
      domain: "videos.example.com",
      type: "self_hosted",
      allowed_idps: ["idp-otp"],
      policies: [{ name: "Allowed people", decision: "allow", include: [{ email: { email: "admin@example.com" } }] }],
    });
    // Migrations run before the new code goes live.
    const order = cf.calls.map((call) => call.slice(0, 3).join(" "));
    expect(order.indexOf("d1 migrations apply")).toBeLessThan(order.indexOf("deploy --secrets-file /tmp/albireo-test/secrets.json"));
    expect(cf.callsOf("deploy")).toEqual([["deploy", "--secrets-file", "/tmp/albireo-test/secrets.json"]]);
    expect(cf.envs.at(-1)).toEqual({ ALBIREO_DATABASE_ID: "db-1" });
    expect(written).toEqual([{ S3_ACCESS_KEY_ID: "key-id", S3_SECRET_ACCESS_KEY: "secret", ACCESS_AUD: "aud-1" }]);
    expect(removed).toHaveLength(1);
    expect(tagBodies(cf)).toEqual([
      { resource_type: "d1_database", resource_id: "db-1", tags: { [STACK_TAG]: "albireo" } },
      { resource_type: "access_application", resource_id: "app-1", tags: { [STACK_TAG]: "albireo" } },
      { resource_type: "worker", resource_id: "worker-1", tags: { [STACK_TAG]: "albireo" } },
    ]);
    expect(resources.map((resource) => resource.type)).toEqual(["d1_database", "access_application", "worker"]);
  });

  it("keeps the database of the name, updates the Access application of the domain, and keeps the other tags", () => {
    const cf = new FakeCf((args) => {
      const command = args.slice(0, 3).join(" ");
      if (command === "d1 list") return [{ uuid: "db-9", name: "albireo" }];
      if (command === "zero-trust identity-providers list") return LOGIN_METHODS;
      if (command === "zero-trust access applications") {
        if (args[3] === "list") return [{ id: "app-9", domain: "videos.example.com", aud: "aud-9" }];
        if (args[3] === "update") return { id: "app-9", aud: "aud-9" };
      }
      if (command === "workers get albireo") return { id: "worker-1", name: "albireo" };
      if (command === "tags account-resources get") return { tags: { owner: "media" } };
      return {};
    });

    deployStack({ settings, secrets: SECRETS, cf, log: () => {}, writeSecretsFile: writeSecretsFile([], []) });

    expect(cf.callsOf("d1", "create")).toEqual([]);
    expect(cf.callsOf("d1", "migrations", "apply")[0]?.[3]).toBe("db-9");
    expect(cf.callsOf("zero-trust", "access", "applications", "update")[0]?.[4]).toBe("app-9");
    expect(cf.envs.at(-1)).toEqual({ ALBIREO_DATABASE_ID: "db-9" });
    expect(tagBodies(cf).map((body) => body.tags)).toEqual([
      { owner: "media", [STACK_TAG]: "albireo" },
      { owner: "media", [STACK_TAG]: "albireo" },
      { owner: "media", [STACK_TAG]: "albireo" },
    ]);
  });

  it("changes nothing when a resource belongs to another stack", () => {
    const cf = new FakeCf((args) => {
      const command = args.slice(0, 3).join(" ");
      if (command === "d1 list") return [{ uuid: "db-9", name: "albireo" }];
      if (command === "zero-trust access applications") return [];
      if (command === "workers get albireo") return notFound(args);
      if (command === "tags account-resources get") return { tags: { [STACK_TAG]: "den" } };
      return {};
    });

    expect(() => deployStack({ settings, secrets: SECRETS, cf, log: () => {}, writeSecretsFile: writeSecretsFile([], []) })).toThrow(
      "D1 database albireo belongs to the stack den",
    );
    expect(cf.calls.filter((call) => call.some((word) => ["create", "update", "delete", "deploy", "apply"].includes(word)))).toEqual([]);
  });
  it("changes nothing when the organization lacks a login method of the settings", () => {
    const cf = new FakeCf((args) => {
      const command = args.slice(0, 3).join(" ");
      if (command === "d1 list") return [];
      if (command === "zero-trust identity-providers list") return [{ id: "idp-github", type: "github", name: "GitHub" }];
      if (command === "zero-trust access applications") return [];
      if (command === "workers get albireo") return notFound(args);
      return {};
    });

    expect(() => deployStack({ settings, secrets: SECRETS, cf, log: () => {}, writeSecretsFile: writeSecretsFile([], []) })).toThrow(
      "production.access.loginMethods names onetimepin, but the Zero Trust organization has no login method of that type or ID.",
    );
    expect(cf.calls.filter((call) => call.some((word) => ["create", "update", "delete", "deploy", "apply"].includes(word)))).toEqual([]);
  });
});

describe("loginMethodIds", () => {
  const methods: LoginMethod[] = [
    ...LOGIN_METHODS,
    { id: "idp-passkeys", type: "passkeys", name: "Passkeys" },
    { id: "idp-okta", type: "oidc", name: "Okta" },
    { id: "idp-entra", type: "oidc", name: "Entra ID" },
  ];

  it("finds each login method by its type or its ID, in the order of the settings", () => {
    expect(loginMethodIds(["passkeys", "idp-okta", "onetimepin"], methods)).toEqual(["idp-passkeys", "idp-okta", "idp-otp"]);
  });

  it("allows a login method once when the settings name it by its type and by its ID", () => {
    expect(loginMethodIds(["github", "idp-github"], methods)).toEqual(["idp-github"]);
  });

  it("asks for the ID when the organization has several login methods of the type", () => {
    expect(() => loginMethodIds(["oidc"], methods)).toThrow(
      "The Zero Trust organization has 2 login methods of the type oidc: idp-okta (Okta), idp-entra (Entra ID). Write the ID of the one to allow in production.access.loginMethods.",
    );
  });

  it("names every login method that the organization lacks", () => {
    expect(() => loginMethodIds(["google", "onetimepin", "saml"], methods)).toThrow(
      [
        "production.access.loginMethods names google, but the Zero Trust organization has no login method of that type or ID. Add it in Zero Trust > Integrations > Identity providers.",
        "production.access.loginMethods names saml, but the Zero Trust organization has no login method of that type or ID. Add it in Zero Trust > Integrations > Identity providers.",
      ].join("\n"),
    );
  });
});

describe("stackResources", () => {
  it("finds the resources by the tag of the stack, in the order of deletion", () => {
    const cf = new FakeCf(() => [
      { type: "d1_database", id: "db-1", name: "albireo" },
      { type: "worker", id: "worker-1", name: "albireo" },
      { type: "r2_bucket", id: "videos", name: "videos" },
      { type: "access_application", id: "app-1", name: "albireo" },
    ]);
    const { resources, others } = stackResources(cf, "albireo");
    expect(cf.calls).toEqual([["tags", "resources", "list", "--tag", `${STACK_TAG}=albireo`]]);
    expect(resources.map((resource) => resource.type)).toEqual(["worker", "access_application", "d1_database"]);
    expect(others).toEqual(["r2_bucket videos"]);
  });
});

describe("deleteStack", () => {
  const resources: StackResource[] = [
    { type: "worker", id: "worker-1", name: "albireo" },
    { type: "access_application", id: "app-1", name: "albireo" },
    { type: "d1_database", id: "db-1", name: "albireo" },
  ];
  const untag = (type: string, id: string) => ["tags", "account-resources", "delete", "--resource-type", type, "--resource-id", id, "--force"];

  it("deletes the Worker, the Access application, and the database, and removes their tags", () => {
    const cf = new FakeCf(() => ({}));
    deleteStack({ cf, log: () => {}, resources });
    expect(cf.calls).toEqual([
      ["workers", "delete", "worker-1", "--force"],
      untag("worker", "worker-1"),
      ["zero-trust", "access", "applications", "delete", "app-1", "--force"],
      untag("access_application", "app-1"),
      ["d1", "delete", "db-1", "--force"],
      untag("d1_database", "db-1"),
    ]);
  });

  it("counts a resource that is already gone as deleted, and removes its tag", () => {
    const gone = (args: string[]) => new CfError(args, "[7404] The database could not be found.\n404 Not Found · HTTP /accounts/x/d1/database/db-1");
    const cf = new FakeCf((args) => (args[0] === "tags" ? {} : gone(args)));
    const lines: string[] = [];
    deleteStack({ cf, log: (line) => lines.push(line), resources: [resources[2] as StackResource] });
    expect(cf.calls.at(-1)).toEqual(untag("d1_database", "db-1"));
    expect(lines).toEqual(["D1 database albireo: already gone"]);
  });
});

describe("parseEnvFile", () => {
  it("reads KEY=VALUE lines and skips comments and blank lines", () => {
    const values = parseEnvFile("# Keys of the production bucket\nS3_ACCESS_KEY_ID=abc\n\nS3_SECRET_ACCESS_KEY='a=b'\n");
    expect([...values]).toEqual([
      ["S3_ACCESS_KEY_ID", "abc"],
      ["S3_SECRET_ACCESS_KEY", "a=b"],
    ]);
  });
});

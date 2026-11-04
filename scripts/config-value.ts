// Prints one value from albireo.config.ts so that shell commands can use it.
//
// Usage: node scripts/config-value.ts database.id

import albireoConfig from "../albireo.config.ts";
import { validateSettings } from "../config/settings.ts";

const path = process.argv[2];
if (path === undefined) {
  console.error("Usage: node scripts/config-value.ts <setting>, for example database.id");
  process.exit(2);
}

let value: unknown = validateSettings(albireoConfig);
for (const key of path.split(".")) {
  if (typeof value !== "object" || value === null || !(key in value)) {
    console.error(`albireo.config.ts has no setting named ${path}.`);
    process.exit(2);
  }
  value = (value as Record<string, unknown>)[key];
}
if (typeof value === "object") {
  console.error(`${path} holds more than one value. Name a setting inside it.`);
  process.exit(2);
}
process.stdout.write(String(value));

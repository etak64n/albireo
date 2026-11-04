import { defineConfig } from "vitest/config";

// Tests run in Node.js. The API tests use an in-memory SQLite database in
// place of D1 and a fake storage service, so they need no Cloudflare account.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});

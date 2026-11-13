import { defineConfig } from "vitest/config";

// The tests of the logic of the browser app, which run in Node.js. The tests of the server
// are in Rust, in server/tests.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});

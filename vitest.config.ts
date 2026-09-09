import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Must exceed MISTRAL_RETRY_CONFIG.maxElapsedTime (30_000ms, shared.ts) with
    // margin — otherwise a live test that legitimately exhausts its retry budget
    // hits this timeout first and fails as a false timeout instead of a real error.
    testTimeout: 45_000,
    hookTimeout: 15_000,
    environment: "node",
  },
  resolve: {
    conditions: ["node", "import"],
  },
});

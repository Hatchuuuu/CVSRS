import { defineConfig } from "vitest/config";

// Database tests run against the disposable local cluster (see scripts/db.ts) using real role switches.
export default defineConfig({
  test: {
    include: ["tests/db/**/*.test.ts"],
    globalSetup: ["tests/db/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});

import { defineConfig, devices } from "@playwright/test";

/**
 * Started by `npm run test:e2e` (scripts/e2e.ts), which prepares the isolated Supabase stack and the app server and passes their
 * addresses in E2E_* variables. Running `playwright test` directly fails at the first helper that needs them (tests/e2e/support.ts).
 * Journeys build on each other's accounts, so they run in order in one worker.
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    navigationTimeout: 60_000,
    actionTimeout: 20_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

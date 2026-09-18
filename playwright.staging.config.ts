import { defineConfig, devices } from "@playwright/test";
import { stagingOptInRequested } from "./tests/e2e/staging/support/environment.ts";

export default defineConfig({
  testDir: "./tests/e2e/staging",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { outputFolder: "playwright-report/staging", open: "never" }]],
  outputDir: "test-results/staging",
  globalSetup: stagingOptInRequested() ? "./tests/e2e/staging/global-setup.ts" : undefined,
  use: {
    baseURL: process.env.E2E_STAGING_BASE_URL || "http://127.0.0.1:9",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "staging-chromium", use: { ...devices["Desktop Chrome"] } }],
});

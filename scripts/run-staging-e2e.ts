import { spawn } from "node:child_process";
import { readStagingEnvironment, StagingGateError } from "../tests/e2e/staging/support/environment.ts";

try {
  readStagingEnvironment();
} catch (error) {
  if (error instanceof StagingGateError) {
    if (process.env.E2E_STAGING_ALLOW_SKIP === "true") {
      console.warn(`SKIPPED staging E2E by explicit local override: ${error.message}`);
      process.exit(0);
    }
    console.error(`STAGING E2E GATE FAILED: ${error.message}`);
    process.exit(1);
  }
  throw error;
}

const executable = process.platform === "win32" ? "npx.cmd" : "npx";
const child = spawn(executable, ["playwright", "test", "--config=playwright.staging.config.ts"], {
  stdio: "inherit",
  env: process.env,
});

child.on("error", (error) => {
  console.error(`Could not start Playwright: ${error.message}`);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Playwright stopped by signal ${signal}.`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});

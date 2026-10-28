import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { readStagingEnvironment, StagingGateError } from "./e2e/staging/support/environment.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const runnerPath = fileURLToPath(new URL("../scripts/run-staging-e2e.ts", import.meta.url));
const playwrightCli = fileURLToPath(import.meta.resolve("@playwright/test/cli"));
const remote = {
  E2E_STAGING_ENABLED: "true",
  E2E_STAGING_MUTATION_CONFIRM: "seed-isolated-staging-fixtures",
  E2E_STAGING_BASE_URL: "https://acceptance.invalid",
  E2E_STAGING_SUPABASE_URL: "https://acceptancefixture.supabase.co",
  E2E_STAGING_SUPABASE_SERVICE_ROLE_KEY: "synthetic-staging-key",
  E2E_STAGING_PROJECT_REF: "acceptancefixture",
  E2E_STAGING_PRIMARY_EMAIL: "primary@example.invalid",
  E2E_STAGING_PRIMARY_PASSWORD: "synthetic-primary-password",
  E2E_STAGING_SECONDARY_EMAIL: "secondary@example.invalid",
  E2E_STAGING_SECONDARY_PASSWORD: "synthetic-secondary-password",
};
const local = {
  ...remote,
  E2E_STAGING_TARGET: "local",
  E2E_STAGING_BASE_URL: "http://127.0.0.1:3410",
  E2E_STAGING_SUPABASE_URL: "http://127.0.0.1:55431",
  E2E_STAGING_PROJECT_REF: "extrusionos-acceptance-20261020",
};

function cleanEnvironment(overrides = {}) {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !key.startsWith("E2E_STAGING_") && !["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].includes(key))),
    ...overrides,
  };
}

function readWithEnvironment(environment) {
  const saved = { ...process.env };
  try {
    process.env = cleanEnvironment(environment);
    return readStagingEnvironment();
  } finally {
    process.env = saved;
  }
}

function run(environment, launch = null) {
  const args = ["--no-warnings", "--experimental-strip-types"];
  if (launch !== null) {
    const source = `
      import assert from 'node:assert/strict';
      import childProcess from 'node:child_process';
      import { syncBuiltinESMExports } from 'node:module';
      const spawn = childProcess.spawn;
      childProcess.spawn = (executable, args, options) => {
        assert.equal(executable, process.execPath, 'Use the running Node executable, not an OS shell shim.');
        assert.deepEqual(args, [${JSON.stringify(playwrightCli)}, 'test', '--config=playwright.staging.config.ts']);
        assert.equal(options.shell, undefined, 'Do not invoke a shell.');
        assert.equal(options.stdio, 'inherit');
        assert.equal(options.env.E2E_STAGING_SUPABASE_SERVICE_ROLE_KEY, 'synthetic-staging-key');
        ${launch}
      };
      syncBuiltinESMExports();
    `;
    args.push("--import", `data:text/javascript,${encodeURIComponent(source)}`);
  }
  args.push(runnerPath);
  return spawnSync(process.execPath, args, {
    cwd: root,
    env: cleanEnvironment(environment),
    encoding: "utf8",
    timeout: 30_000,
  });
}

test("staging target defaults to the existing remote boundary", () => {
  assert.equal(readWithEnvironment(remote).baseUrl, remote.E2E_STAGING_BASE_URL);
  assert.throws(() => readWithEnvironment({ ...local, E2E_STAGING_TARGET: undefined }), StagingGateError);
});

test("explicit local staging accepts separate loopback application and Supabase ports", () => {
  const environment = readWithEnvironment(local);
  assert.equal(environment.baseUrl, local.E2E_STAGING_BASE_URL);
  assert.equal(environment.supabaseUrl, local.E2E_STAGING_SUPABASE_URL);
  assert.equal(environment.projectRef, local.E2E_STAGING_PROJECT_REF);
});

for (const [name, overrides] of [
  ["missing mutation opt-in", { E2E_STAGING_MUTATION_CONFIRM: "" }],
  ["disabled staging", { E2E_STAGING_ENABLED: "false" }],
  ["unknown target", { E2E_STAGING_TARGET: "production" }],
  ["remote application in local mode", { E2E_STAGING_BASE_URL: "https://example.com" }],
  ["remote database in local mode", { E2E_STAGING_SUPABASE_URL: remote.E2E_STAGING_SUPABASE_URL }],
  ["loopback-looking hostname", { E2E_STAGING_SUPABASE_URL: "http://127.0.0.1.example.com:55431" }],
  ["same application and database origin", { E2E_STAGING_BASE_URL: local.E2E_STAGING_SUPABASE_URL }],
  ["application URL credentials", { E2E_STAGING_BASE_URL: "http://user:secret@127.0.0.1:3410" }],
  ["database URL credentials", { E2E_STAGING_SUPABASE_URL: "http://user:secret@127.0.0.1:55431" }],
  ["database URL path", { E2E_STAGING_SUPABASE_URL: "http://127.0.0.1:55431/rest/v1" }],
  ["database URL query", { E2E_STAGING_SUPABASE_URL: "http://127.0.0.1:55431?target=production" }],
  ["malformed URL", { E2E_STAGING_SUPABASE_URL: "not-a-url" }],
  ["reused current database", { NEXT_PUBLIC_SUPABASE_URL: local.E2E_STAGING_SUPABASE_URL }],
  ["reused current database through a loopback alias", { NEXT_PUBLIC_SUPABASE_URL: "http://localhost:55431/" }],
  ["reused current key", { SUPABASE_SERVICE_ROLE_KEY: local.E2E_STAGING_SUPABASE_SERVICE_ROLE_KEY }],
  ["identical users", { E2E_STAGING_SECONDARY_EMAIL: remote.E2E_STAGING_PRIMARY_EMAIL.toUpperCase() }],
  ["missing password", { E2E_STAGING_SECONDARY_PASSWORD: "" }],
]) {
  test(`local staging rejects ${name}`, () => {
    assert.throws(() => readWithEnvironment({ ...local, ...overrides }), StagingGateError);
  });
}

test("remote staging still rejects mismatched Supabase project identity", () => {
  assert.throws(() => readWithEnvironment({ ...remote, E2E_STAGING_PROJECT_REF: "other" }), StagingGateError);
});

test("remote staging normalizes URL casing before rejecting the current project", () => {
  assert.throws(() => readWithEnvironment({ ...remote, NEXT_PUBLIC_SUPABASE_URL: "HTTPS://ACCEPTANCEFIXTURE.SUPABASE.CO/" }), StagingGateError);
});

test("runner exits before launching without dedicated configuration", () => {
  const result = run({}, "throw new Error('The gate launched a child.');");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /STAGING E2E GATE FAILED/);
  assert.doesNotMatch(result.stderr, /The gate launched a child/);
});

test("explicit local skip remains visibly skipped and launches no child", () => {
  const result = run({ E2E_STAGING_ALLOW_SKIP: "true" }, "throw new Error('The skip launched a child.');");
  assert.equal(result.status, 0);
  assert.match(result.stderr, /SKIPPED staging E2E/);
  assert.doesNotMatch(result.stderr, /The skip launched a child/);
});

test("runner launches the installed Playwright CLI and discovers the real staging suite", () => {
  // Listing loads the real config/specs without executing setup, signing in or seeding data.
  const result = run(remote, "return spawn(executable, [...args, '--list', '--reporter=list'], options);");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Total: 4 tests in 1 file/);
  assert.doesNotMatch(result.stdout + result.stderr, /synthetic-staging-key|synthetic-primary-password/);
});

test("runner preserves a failing child exit code", () => {
  const result = run(remote, "return spawn(executable, ['-e', 'process.exit(7)'], options);");
  assert.equal(result.status, 7, result.stderr);
});

test("runner reports a child startup failure", () => {
  const result = run(remote, "return spawn(executable + '.missing', [], options);");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Could not start Playwright/);
});

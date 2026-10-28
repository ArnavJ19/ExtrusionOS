import assert from "node:assert/strict";
import test from "node:test";
import { getLocalDevelopmentSupabaseOrigin } from "../lib/security/local-development-csp.ts";

for (const url of ["http://127.0.0.1:55431", "http://localhost:55431/", "https://[::1]:55431/"]) {
  test(`development CSP accepts the exact local Supabase origin ${url}`, () => {
    assert.equal(getLocalDevelopmentSupabaseOrigin("development", url), new URL(url).origin);
  });
}
for (const environment of ["production", "test", undefined]) {
  test(`CSP adds no loopback exception in ${environment}`, () => {
    assert.equal(getLocalDevelopmentSupabaseOrigin(environment, "http://127.0.0.1:55431"), null);
  });
}
for (const url of [undefined, "", "not-a-url", "file:///tmp/supabase", "http://127.0.0.1", "http://127.0.0.1:80",
  "https://production.supabase.co", "http://0.0.0.0:55431", "http://127.0.0.1.example.com:55431",
  "http://user:secret@localhost:55431", "http://localhost:55431/rest/v1", "http://localhost:55431?allow=all", "http://localhost:55431#fragment"]) {
  test(`development CSP rejects an invalid or non-local configured URL ${url}`, () => {
    assert.equal(getLocalDevelopmentSupabaseOrigin("development", url), null);
  });
}

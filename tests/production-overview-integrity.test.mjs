import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/(dashboard)/production/page.tsx", import.meta.url), "utf8");
const detailPage = readFileSync(new URL("../app/(dashboard)/production/[id]/page.tsx", import.meta.url), "utf8");
const outputWorkflow = readFileSync(new URL("../components/modules/production-output-workflow.tsx", import.meta.url), "utf8");

test("production overview joins the real profile relation", () => {
  assert.match(page, /profile:aluminium_profiles\(profile_code\)/);
  assert.doesNotMatch(page, /profile:profiles\(/);
});

test("production overview uses local business dates", () => {
  assert.match(page, /todayIso\(new Date\(now\.getFullYear\(\), now\.getMonth\(\), 1\)\)/);
  assert.match(page, /const today = todayIso\(now\)/);
  assert.doesNotMatch(page, /toISOString\(\)\.slice\(0, 10\)/);
});

test("production query failures cannot masquerade as an empty factory", () => {
  assert.match(page, /const queryError = \[allJobs, recentJobs, monthlyCompleted/);
  assert.match(page, /if \(queryError\) throw new Error/);
});

test("production completion shows the billet input target used by mass-balance validation", () => {
  assert.match(detailPage, /from\("foundry_billets"\)/);
  assert.match(detailPage, /linked_billet_input_kg/);
  assert.match(outputWorkflow, /Linked billet input/);
  assert.match(outputWorkflow, /Good output plus process scrap must reconcile/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { forecastInput, msmeDeadline, stockCommands, accountsCommands, planningCommands } from "../lib/autopilot-batch5/operations.ts";
import { planBilletInput } from "../lib/calculations/production-performance.ts";

test("billet input reuses the canonical recovery calculation and keeps missing values unknown", () => {
  for (const v of [null, 0, -1, NaN, Infinity]) assert.equal(forecastInput(100, v), null);
  assert.equal(forecastInput(null, 80), null);
  for (let kg = 1; kg < 10000; kg += 97) for (const recovery of [50, 75, 89.5, 100]) {
    assert.equal(forecastInput(kg, recovery), planBilletInput({ goodOutputKg: kg, recoveryPercent: recovery }).plannedInputKg);
  }
});
test("MSME aid uses acceptance, the capped agreed period or no-agreement period across month and leap-year boundaries", () => {
  assert.equal(msmeDeadline("2026-11-01", 90), "2026-12-16");
  assert.equal(msmeDeadline("2026-11-01", null), "2026-11-16");
  assert.equal(msmeDeadline("2028-02-20", 15), "2028-03-06");
  assert.equal(msmeDeadline("2026-12-31", 30, 20), "2027-01-20");
  assert.equal(msmeDeadline(null, 30), null);
  assert.equal(msmeDeadline("2026-02-30", 30), null);
});
test("command schemas reject caller authority, unbounded values and absent review evidence", () => {
  assert.equal(planningCommands.billet_forecast.safeParse({ company_id: "forged" }).success, false);
  assert.equal(stockCommands.request_adjustment.safeParse({ quantity: 0 }).success, false);
  assert.equal(accountsCommands.save_msme_policy.safeParse({ statutory_limit: 60, no_agreement_days: 15, reason: "Reviewed the statutory cap" }).success, false);
  assert.equal(accountsCommands.save_msme_vendor.safeParse({ vendor_id: "bd000000-0000-4000-8000-000000000080", category: "micro", reason: "Certificate reviewed" }).success, false);
  assert.equal(accountsCommands.save_msme_vendor.safeParse({ vendor_id: "bd000000-0000-4000-8000-000000000080", category: "none", reason: "Certificate not applicable" }).success, true);
});

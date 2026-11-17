import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { createBatch6BrowserFixture } from "../scripts/lib/autopilot-batch6-browser-fixture.mjs";
import { pIds as i, istDay } from "../scripts/lib/autopilot-batch6-fixture.mjs";

let fixture, browser; const contexts = []; const evidence = "docs/evidence/AUTOPILOT_BATCH_6";
test.before(async () => { fixture = await createBatch6BrowserFixture("floor"); browser = await chromium.launch({ headless: true }); mkdirSync(evidence, { recursive: true }); });
test.after(async () => { await browser?.close(); await fixture?.close(); });
test.beforeEach(async () => { await fixture.start(); });
test.afterEach(async () => { for (const context of contexts.splice(0)) await context.close(); await fixture.rollback(); });
const setup = work => fixture.run(() => work(fixture.f));
const count = sql => fixture.run(async () => (await fixture.f.one(sql)).n);
async function open(width, screen, actor, options = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: "Asia/Kolkata" }); contexts.push(context);
  const page = await context.newPage(); const errors = []; page.setDefaultTimeout(20000); page.on("pageerror", e => errors.push(e.message));
  await page.goto(fixture.base); await page.evaluate(([s, u, o]) => window.mount(s, u, o), [screen, actor, { today: istDay(), ...options }]);
  return { page, context, done: async name => { assert.deepEqual(errors, []); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no horizontal page scroll"); await page.screenshot({ path: `${evidence}/${name}-${width}.png`, fullPage: true }); } };
}
const press2 = { machine_id: i.press2, min_billet_mm: 400, max_billet_mm: 1100, standard_billet_mm: 900, container_diameter_mm: 185, butt_mm: 25, runout_m: 70, front_crop_m: 0.5, back_crop_m: 0.5, step_mm: 10 };

for (const width of [375, 1280]) {
  test(`AP-061 the planner reviews the draft with reasons and publishes it at ${width}px`, async () => {
    await setup(async f => { await f.shifts(); await f.plannedJob({ die: i.die, kg: 300, due: 1, number: "PJ-PLAN-1" }); await f.plannedJob({ die: i.die2, kg: 200, due: 2, billetsShort: 3, number: "PJ-SHORT" }); });
    const v = await open(width, "plan", i.productionManager);
    await v.page.getByRole("button", { name: "Prepare draft now" }).click();
    await expect(v.page.getByRole("link", { name: "PJ-PLAN-1" })).toBeVisible();
    await expect(v.page.getByText("Could not be scheduled")).toBeVisible();
    await expect(v.page.getByText(/Billets short: 3/)).toBeVisible();
    await v.page.getByRole("button", { name: /Publish \d+ slot/ }).click();
    await expect(v.page.getByText(/slot\(s\) published with 0 edit/)).toBeVisible();
    await expect.poll(() => count("select count(*)::int n from production_plan_slots s join production_jobs j on j.id=s.production_job_id where j.job_number='PJ-PLAN-1'")).toBe(1);
    await v.done("press-plan");
  });

  test(`AP-029 billet options and the planner's choice at ${width}px`, async () => {
    await setup(f => f.ap("ap_billet_length", "save_press", press2));
    const v = await open(width, "billet", i.productionManager, { jobId: i.jobC });
    await expect(v.page.getByText("Recommended", { exact: true }).first()).toBeVisible();
    await v.page.getByRole("button", { name: /^Use \d+ mm$/ }).first().click();
    await expect(v.page.getByText(/recorded for this job/)).toBeVisible();
    await expect.poll(() => count("select count(*)::int n from job_billet_length_choices where superseded_at is null")).toBe(1);
    await v.done("billet-length");
  });

  test(`AP-094 a push made without signal is kept and posted once when the signal returns at ${width}px`, async () => {
    const v = await open(width, "station", i.production, { sessionId: i.session, companyId: i.company });
    await expect(v.page.getByRole("button", { name: /Billet loaded/ })).toBeVisible();
    await v.context.setOffline(true);
    await v.page.getByRole("button", { name: /Billet loaded/ }).click();
    await expect(v.page.getByRole("status").filter({ hasText: /The tap is saved on this station/ })).toBeVisible();
    await expect(v.page.getByText("1 tap(s) waiting to send from this station.")).toBeVisible();
    assert.equal(await count("select count(*)::int n from production_push_events where production_job_id='" + i.jobA + "'"), 0);
    await v.done("offline-queued");
    await v.context.setOffline(false);
    await expect.poll(() => count("select count(*)::int n from production_push_events where production_job_id='" + i.jobA + "'"), { timeout: 30000 }).toBe(1);
    await expect(v.page.getByText(/waiting to send from this station/)).toHaveCount(0, { timeout: 20000 });
    assert.equal(await count("select count(*)::int n from offline_receipts where state='applied'"), 1);
  });
}

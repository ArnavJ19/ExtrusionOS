import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { createPressBrowserFixture } from "../scripts/lib/autopilot-batch2-browser-fixture.mjs";
import { pIds as i, istDay } from "../scripts/lib/autopilot-batch2-fixture.mjs";

let fixture, browser;
const evidence = "docs/evidence/AUTOPILOT_BATCH_2";
const today = istDay(0);
test.before(async () => { fixture = await createPressBrowserFixture(); browser = await chromium.launch({ headless: true }); mkdirSync(evidence, { recursive: true }); });
test.after(async () => { await browser?.close(); await fixture?.close(); });
test.beforeEach(async () => { await fixture.start(); });
const contexts = [];
// A failed test must not leave a polling page running into the next test's transaction.
test.afterEach(async () => { for (const context of contexts.splice(0)) await context.close().catch(() => {}); await fixture.rollback(); });

const f = () => fixture.f;
const q = (sql, params = []) => fixture.f.db.query(sql, params);
async function seed(sql, params = []) {
  await q("set session_replication_role = replica");
  try { await q(sql, params); } finally { await q("set session_replication_role = origin"); }
}
async function open(width, screen, userId, options = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: "Asia/Kolkata" });
  contexts.push(context);
  const page = await context.newPage();
  const errors = [];
  page.setDefaultTimeout(15000); page.on("pageerror", error => errors.push(error.message));
  await page.goto(fixture.base);
  await page.evaluate(([screen, userId, options]) => window.mount(screen, userId, options), [screen, userId, { today, ...options }]);
  await expect(page.getByRole("heading", { name: `Press fixture: ${screen}` })).toBeVisible();
  return { page, errors, done: async () => { assert.deepEqual(errors, []); await page.context().close(); } };
}
const noOverflow = async page => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no sideways page scroll");
const pushes = async (offsets, job = i.jobA) => { for (const offset of offsets) await f().push(offset, {}, i.production, i.session, job); };

for (const width of [375, 1280]) {
  test(`AP-011/087 station: one tap per billet, undo, offline queue and closing the job with only rejects on the keypad, at ${width}px`, async () => {
    const { page, done } = await open(width, "station", i.production, { sessionId: i.session });
    const tap = page.getByRole("button", { name: /Billet loaded/ });
    await expect(page.getByRole("heading", { name: "PJ-A" })).toBeVisible();
    await tap.click();
    if (process.env.DEBUG_PRESS) console.log(await page.locator("main").innerText());
    await expect(page.getByText("3 of 4 linked billets left")).toBeVisible();
    await page.getByRole("button", { name: /Undo push 1/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "Push 1 undone" })).toBeVisible();
    await page.evaluate(() => { window.offline = true; });
    await tap.click();
    await expect(page.getByText("1 tap(s) waiting to send from this station.")).toBeVisible();
    await page.evaluate(() => { window.offline = false; });
    await page.evaluate(([userId, sessionId]) => window.mount("station", userId, { today: new Date().toISOString().slice(0, 10), sessionId }), [i.production, i.session]);
    await expect(page.getByText("3 of 4 linked billets left")).toBeVisible();
    assert.equal(Number((await q("select count(*) c from private.ap2_pushes where production_job_id=$1", [i.jobA])).rows[0].c), 1, "the queued tap was sent once");
    await pushes([-300, -200, -100]);
    await page.evaluate(([userId, sessionId]) => window.mount("station", userId, { today: new Date().toISOString().slice(0, 10), sessionId }), [i.production, i.session]);
    await page.getByRole("button", { name: "Close job from pushes" }).click();
    await page.getByRole("button", { name: "Enter rejects" }).click();
    await page.getByLabel("Reject pieces").click();
    await page.getByRole("group", { name: "Keypad for Reject pieces" }).getByRole("button", { name: "2", exact: true }).click();
    await page.getByRole("button", { name: "Surface" }).click();
    await noOverflow(page);
    await page.screenshot({ path: `${evidence}/station-close-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Confirm output with these rejects" }).click();
    await expect(page.getByText("Accepted with changes").first()).toBeVisible();
    const job = (await q("select status, actual_pieces from production_jobs where id=$1", [i.jobA])).rows[0];
    assert.deepEqual(job, { status: "completed", actual_pieces: 38 });
    await done();
  });

  test(`AP-014/066 station asks why an idle press stopped and shows the shift target, at ${width}px`, async () => {
    await seed(`insert into production_push_events(id,company_id,production_job_id,machine_id,die_id,kind,source,seq,operator_id,billet_id,billet_kg,billet_kg_basis,billet_diameter_mm,event_at,recorded_at)
      values(gen_random_uuid(),$1,$2,$3,$4,'push','tap',1,$5,$6,60,'linked_billet',178,now()-interval '25 minutes',now()-interval '25 minutes')`, [i.company, i.jobA, i.press, i.die, i.production, i.billets[0]]);
    const shift = (await q("select * from private.ap2_shift_window($1, clock_timestamp())", [i.company])).rows[0];
    await seed("insert into production_plan_slots(id,company_id,production_job_id,machine_id,planned_start_at,planned_end_at,sequence_number,capacity_kg,status) values(gen_random_uuid(),$1,$2,$3,$4,$5,0,456,'released')", [i.company, i.jobA, i.press, shift.starts_at, shift.ends_at]);
    const { page, done } = await open(width, "station", i.production, { sessionId: i.session });
    await expect(page.getByText(/No push for \d+ minutes/)).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "Pushes" })).toBeVisible();
    await expect(page.getByText(/From the published plan/)).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: `${evidence}/station-idle-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Breakdown" }).click();
    await expect(page.getByText(/reason: Breakdown/)).toBeVisible();
    assert.equal((await q("select reason from press_idle_intervals where machine_id=$1", [i.press])).rows[0].reason, "breakdown");
    await done();
  });

  test(`AP-012/013/016 job record: expected output with engineering scrap, sampling compliance and a supervisor void, at ${width}px`, async () => {
    await f().call("ap_sampling", "trigger_save", { plan_id: i.plan, kind: "every_n_pushes", every_n: 2, blocks_release: true }, i.quality);
    await pushes([-400, -300, -200, -100]);
    const { page, done } = await open(width, "job", i.productionManager, { jobId: i.jobA, role: "production_manager" });
    await expect(page.getByRole("heading", { name: "Press capture" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Butt end" })).toBeVisible();
    await expect(page.getByText(/2 required/)).toBeVisible();
    await page.getByRole("button", { name: "Prepare expected output to close the job" }).click();
    await expect(page.getByText("Expected 40 good pieces", { exact: false })).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: `${evidence}/job-panel-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Void" }).first().click();
    await page.getByLabel("Why is this push wrong?").fill("Tapped during a die trial billet");
    await page.getByRole("button", { name: "Void push" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Push voided" })).toBeVisible();
    await done();
  });

  test(`AP-014/015/066 press floor: plan vs actual, unexplained idle gaps answered by a supervisor, die changes, at ${width}px`, async () => {
    await seed(`insert into production_push_events(id,company_id,production_job_id,machine_id,die_id,kind,source,seq,operator_id,billet_id,billet_kg,billet_kg_basis,billet_diameter_mm,event_at,recorded_at)
      values(gen_random_uuid(),$1,$2,$3,$4,'push','tap',1,$5,$6,60,'linked_billet',178,now()-interval '90 minutes',now()-interval '90 minutes')`, [i.company, i.jobB, i.press, i.die2, i.production, i.billetsB[0]]);
    await pushes([-120]);
    await f().call("ap_jobs", "run_now", { job_key: "press.idle_reconcile" }, i.owner);
    const { page, done } = await open(width, "floor", i.productionManager, { role: "production_manager" });
    await expect(page.getByRole("heading", { name: /Plan vs actual/ })).toBeVisible();
    await expect(page.getByText("Press 1 (1460 T)").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /Gaps without a reason \(1\)/ })).toBeVisible();
    await expect(page.getByText("A die change was recorded at this gap", { exact: false })).toBeVisible();
    await expect(page.getByText(/D-2045-B → D-2045-A/)).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: `${evidence}/floor-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Die change", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Gaps without a reason \(0\)/ })).toBeVisible();
    await done();
  });

  test(`AP-013 scrap standards: propose, owner approval and a scrap-yard weighing, at ${width}px`, async () => {
    const { page, done } = await open(width, "standards", i.owner);
    await page.getByLabel("Butt length").fill("28");
    await page.getByLabel("Front crop").fill("450");
    await page.getByLabel("Back crop").fill("650");
    await page.getByLabel("Saw kerf").fill("4.5");
    await page.getByLabel("Rationale").fill("Trial on Press 1, November week 2");
    await page.getByRole("button", { name: "Propose for owner approval" }).click();
    await expect(page.getByText("Standard proposed", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("Approved. New expected output uses this version", { exact: false })).toBeVisible();
    await page.getByLabel("Weighed kg").fill("1250.5");
    await page.getByRole("button", { name: "Record weighing" }).click();
    await expect(page.getByText("Weighing recorded.")).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: `${evidence}/scrap-standards-${width}.png`, fullPage: true });
    assert.equal((await q("select count(*) c from scrap_standards where status='approved'")).rows[0].c, 1);
    await done();
  });

  test(`AP-028 die service: due flag, proposal accepted into a booking, and recording the service, at ${width}px`, async () => {
    await seed(`insert into die_service_thresholds(id,company_id,die_type,basis,service_event,warn_at,rationale,status,proposed_by,proposed_at,approved_by,approved_at)
      values($1,$2,'solid','pushes_since_service','nitriding',3,'Nitride solid dies every 3 pushes (fixture)','approved',$3,now(),$4,now())`, [i.threshold, i.company, i.productionManager, i.owner]);
    await pushes([-300, -200, -100]);
    await f().call("ap_jobs", "run_now", { job_key: "dies.predict_service" }, i.owner);
    const flags = await open(width, "flags", i.productionManager);
    await expect(flags.page.getByText("Service due now and not booked.")).toBeVisible();
    await flags.done();
    const { page, done } = await open(width, "die", i.productionManager, { dieId: i.die });
    await expect(page.getByText("Book nitriding for die D-2045-A")).toBeVisible();
    await expect(page.getByRole("img", { name: /Cycle time per push/ })).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: `${evidence}/die-service-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Accept" }).click();
    await expect(page.getByText(/Service due; booked for/).first()).toBeVisible();
    await page.getByRole("button", { name: "Mark done" }).click();
    await page.getByLabel("What was done (vendor, result)").fill("Shree Nitriding, 0.12 mm case");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Service recorded in the die history", { exact: false })).toBeVisible();
    await done();
  });

  test(`AP-054 preventive maintenance: add a plan, accept the due window, record completion and compliance, at ${width}px`, async () => {
    const { page, done } = await open(width, "pm", i.productionManager);
    await page.getByLabel("Press", { exact: true }).selectOption(i.press);
    await page.getByLabel("Task").fill("Puller chain check");
    await page.getByLabel("Counted in").selectOption("pushes");
    await page.getByLabel("Interval").fill("2");
    await page.getByRole("button", { name: "Save plan" }).click();
    await expect(page.getByText("Plan saved.", { exact: false })).toBeVisible();
    await q("update pm_plans set counter_start_at=now()-interval '1 hour'");
    await pushes([-200, -100]);
    await f().call("ap_jobs", "run_now", { job_key: "maintenance.propose_pm" }, i.owner);
    await page.evaluate(([userId, today]) => window.mount("pm", userId, { today }), [i.productionManager, today]);
    await expect(page.getByText(/Schedule Puller chain check on Press 1/)).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: `${evidence}/pm-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Accept" }).click();
    await expect(page.getByText(/Booked /)).toBeVisible();
    await page.getByRole("button", { name: "Record completion" }).click();
    await page.getByLabel("What was done").fill("Chain tensioned and greased");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Completion recorded", { exact: false })).toBeVisible();
    await expect(page.getByRole("cell", { name: "100%" })).toBeVisible();
    await done();
  });

  test(`AP-016 QC sample queue and recording readings against the plan, at ${width}px`, async () => {
    await f().call("ap_sampling", "trigger_save", { plan_id: i.plan, kind: "every_n_pushes", every_n: 1, blocks_release: true }, i.quality);
    await pushes([-100]);
    const list = await open(width, "samples", i.quality);
    await expect(list.page.getByText("Blocks release")).toBeVisible();
    await noOverflow(list.page);
    await list.page.screenshot({ path: `${evidence}/samples-${width}.png`, fullPage: true });
    await list.done();
    const sample = (await q("select id from qc_sample_requirements limit 1")).rows[0];
    const { page, done } = await open(width, "sample", i.quality, { sampleId: sample.id });
    await page.getByLabel("Measured").fill("1.42");
    await page.getByRole("button", { name: "OK", exact: true }).click();
    await noOverflow(page);
    await page.screenshot({ path: `${evidence}/sample-record-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Record sample" }).click();
    await expect(page.getByText("Recorded on time.")).toBeVisible();
    assert.equal((await q("select status from qc_sample_requirements where id=$1", [sample.id])).rows[0].status, "recorded");
    await done();
  });
}

test("AP-087 the workstation keypad has large keys and builds the number without the phone keyboard", async () => {
  const { page, done } = await open(375, "keypad", i.production);
  const input = page.getByLabel("Reject pieces");
  assert.equal(await input.getAttribute("inputmode"), "none");
  await input.click();
  const keypad = page.getByRole("group", { name: "Keypad for Reject pieces" });
  for (const key of ["1", "2"]) await keypad.getByRole("button", { name: key, exact: true }).click();
  await keypad.getByRole("button", { name: "Delete last digit" }).click();
  await keypad.getByRole("button", { name: "7", exact: true }).click();
  await expect(page.getByTestId("value")).toHaveText("17");
  const box = await keypad.getByRole("button", { name: "5", exact: true }).boundingBox();
  assert.ok(box.height >= 60 && box.width >= 60, `keys are at least 60 px (${box.width}x${box.height})`);
  assert.equal(await keypad.getByRole("button", { name: "Decimal point" }).isDisabled(), true);
  await page.screenshot({ path: `${evidence}/keypad-375.png`, fullPage: true });
  await done();
});

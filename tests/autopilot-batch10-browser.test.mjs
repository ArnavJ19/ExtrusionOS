import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { createBatch10BrowserFixture } from "../scripts/lib/autopilot-batch10-browser-fixture.mjs";
import { ids as i, istAt, istDay } from "../scripts/lib/autopilot-batch10-fixture.mjs";

let fixture, browser; const contexts = []; const evidence = "docs/evidence/AUTOPILOT_BATCH_10";
test.before(async () => { fixture = await createBatch10BrowserFixture(); browser = await chromium.launch({ headless: true }); mkdirSync(evidence, { recursive: true }); });
test.after(async () => { await browser?.close(); await fixture?.close(); });
test.beforeEach(async () => { await fixture.start(); });
test.afterEach(async () => { for (const context of contexts.splice(0)) await context.close(); await fixture.rollback(); });
const setup = work => fixture.run(() => work(fixture.f));
async function open(width, screen, actor = i.owner, options = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: "Asia/Kolkata" }); contexts.push(context);
  const page = await context.newPage(); const errors = []; page.setDefaultTimeout(20000); page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(fixture.base); await page.evaluate(([s, u, o]) => window.mount(s, u, o), [screen, actor, options]);
  return { page, done: async name => {
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no horizontal page scroll");
    await page.screenshot({ path: `${evidence}/${name}-${width}.png`, fullPage: true });
  } };
}
const WIDTHS = [375, 1280];

for (const width of WIDTHS) {
  test(`AP-021 meter readings: opening offered, closing saved, energy shared by job (${width}px)`, async () => {
    await setup(async f => {
      const press = await f.press({ name: "Press 1" }); await f.shifts(press, 1000);
      const a = await f.job({ machine: press, status: "in_progress", plannedIn: 0 }), b = await f.job({ machine: press, status: "in_progress", plannedIn: 0 });
      await f.pushes({ job: a.job, machine: press, at: ["06:10", "06:15", "06:20"].map(t => istAt(0, t)) });
      await f.pushes({ job: b.job, machine: press, at: ["06:25", "06:31"].map(t => istAt(0, t)) });
      await f.ap("ap_energy", "save", { machine_id: press, shift_day: istDay(0), shift_name: "A", opening_kwh: 1000 }, i.production);
      return { press };
    });
    const { page, done } = await open(width, "meters", i.production, { today: istDay(0) });
    const card = page.getByRole("listitem").filter({ hasText: "Press 1 · Shift A" });
    await expect(card.getByText("Closing reading pending")).toBeVisible();
    await card.getByLabel("Closing reading (kWh)").fill("1400");
    await card.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("400 kWh").first()).toBeVisible();
    await expect(page.getByText(/kWh\/kg pressed/).first()).toBeVisible();
    // The next shift is offered the closing reading as its opening value.
    const next = page.getByRole("listitem").filter({ hasText: "Press 1 · Shift B" });
    await expect(next.getByLabel("Opening reading (kWh)")).toHaveValue("1400");
    await expect(next.getByText(/Opening value offered from the closing reading/)).toBeVisible();
    // The operator cannot change a closed reading.
    await expect(page.getByRole("listitem").filter({ hasText: "Press 1 · Shift A" }).getByRole("button", { name: "Correct" })).toBeDisabled();
    await done("press-meters");
  });

  test(`AP-022 press crew: sign in, supervisor adds crew, crew and output by shift (${width}px)`, async () => {
    const d = await setup(async f => {
      const press = await f.press({ name: "Press 2" });
      const j = await f.job({ machine: press, status: "in_progress", plannedIn: 0 });
      await f.pushes({ job: j.job, machine: press, at: [new Date(Date.now() - 120000).toISOString(), new Date(Date.now() - 30000).toISOString()] });
      return { press };
    });
    const { page, done } = await open(width, "crew", i.productionManager, { machine: d.press, name: "Press 2", today: istDay(0) });
    await expect(page.getByText("Nobody is signed in on this press.")).toBeVisible();
    await page.getByLabel("My work on this press").selectOption("supervisor");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText(/You are signed in as/)).toBeVisible();
    await page.getByRole("button", { name: "Add crew member" }).click();
    await page.getByRole("listitem").filter({ hasText: "Fixture backup" }).getByRole("button", { name: "Add" }).click();
    await expect(page.getByText("Fixture backup added to the press.")).toBeVisible();
    await expect(page.getByText(/Press assignment only\. This is not an attendance or payroll record\./).first()).toBeVisible();
    await done("press-crew");
  });

  test(`AP-049 equivalents: propose, another person approves, consent recorded on the short order line (${width}px)`, async () => {
    const d = await setup(async f => {
      const other = await f.profile({ code: "OM-2045-B" });
      await f.stock({ pieces: 60, profile: other });
      const eq = await f.ap("ap_equivalents", "propose", { profile_id: i.profile2, equivalent_profile_id: other, basis: "same_section", note: "Same die drawing, export code" }, i.sales);
      const o = await f.order({ kg: 285, pieces: 50, length: 6 });
      await f.seed("update production_job_draft_lines set status='removed' where order_id=$1", [o.order]);
      return { eq: eq.id, order: o.order };
    });
    const profile = await open(width, "equivalents", i.quality, { profile: i.profile2 });
    await expect(profile.page.getByText("Waiting for approval")).toBeVisible();
    await profile.page.getByRole("button", { name: "Approve" }).click();
    await expect(profile.page.getByText("Approved.", { exact: true })).toBeVisible();
    await expect(profile.page.getByText(/Free stock: 342 kg/)).toBeVisible();
    await profile.done("equivalents-profile");
    const order = await open(width, "order-equivalents", i.sales, { order: d.order, today: istDay(0) });
    await expect(order.page.getByText(/is short by/)).toBeVisible();
    await order.page.getByRole("button", { name: "Record customer consent" }).click();
    await order.page.getByLabel("Who agreed").fill("Ramesh Sharma");
    await order.page.getByRole("button", { name: "Record consent" }).click();
    await expect(order.page.getByText(/Consent recorded for/)).toBeVisible();
    await expect(order.page.getByText(/The order line is not changed automatically/)).toBeVisible();
    await order.done("equivalents-order");
  });

  test(`AP-068 stock runs: idle capacity, a suggestion with its basis, approval creates a planning task (${width}px)`, async () => {
    await setup(async f => {
      const press = await f.press({ name: "Press 3" }); await f.shifts(press, 1000);
      await f.order({ kg: 900 }); await f.billets({ kg: 3000 });
      await f.ap("ap_stock_runs", "save_target", { profile_id: i.profile2, piece_length_m: 6, target_kg: 2000, max_kg: 2500 }, i.productionManager);
      await f.ap("ap_stock_runs", "suggest", {}, i.productionManager);
    });
    const { page, done } = await open(width, "stock-runs", i.productionManager);
    await expect(page.getByText("Idle hours")).toBeVisible();
    await expect(page.getByText(/make 2,000 kg/)).toBeVisible();
    await expect(page.getByText(/The quantity fills the target\./)).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText(/Approved\. A planning task was created/)).toBeVisible();
    await expect(page.getByText(/No suggestion is waiting/)).toBeVisible();
    await done("stock-runs");
  });

  test(`AP-055 coating runs: grouped by shade, late jobs shown before confirming, reason required (${width}px)`, async () => {
    await setup(async f => {
      await f.ap("ap_coating", "save_settings", { capacity_kg_per_hour: 100, changeover_minutes: 60, day_start: "08:00", hours_per_day: 8 }, i.productionManager);
      for (const [shade, kg, due] of [["RAL 9010", 800, 1], ["RAL 7016", 800, 2], ["RAL 9010", 800, 3]]) await f.coatingJob({ shade, kg, due });
    });
    const { page, done } = await open(width, "coating", i.productionManager);
    await expect(page.getByText("Colour changes", { exact: true })).toBeVisible();
    await expect(page.getByText(/would finish after the promised date in this order/)).toBeVisible();
    await page.getByRole("button", { name: /Confirm run order/ }).click();
    await expect(page.getByText(/Give the reason for running these jobs after their promised date/)).toBeVisible();
    await page.getByLabel("Reason for confirming anyway").fill("Customer agreed to a later date");
    await page.getByRole("button", { name: /Confirm run order/ }).click();
    await expect(page.getByText(/Run order confirmed for .*: 1 colour change\(s\) instead of 2/)).toBeVisible();
    await done("coating-runs");
  });

  test(`AP-067 combined cuts: choose jobs, work out a pattern with fewer pushes, accept it (${width}px)`, async () => {
    await setup(async f => {
      const press = await f.press({ name: "Press 4" }); await f.pressSettings(press);
      await f.seed("update aluminium_profiles set billet_diameter_mm=178 where id=$1", [i.profile2]);
      const a = await f.job({ machine: press, plannedIn: 1 }), b = await f.job({ machine: press, plannedIn: 2 });
      await f.seed("update production_jobs set length_per_piece_m=6, pieces=40 where id=$1", [a.job]);
      await f.seed("update production_jobs set length_per_piece_m=3.2, pieces=40 where id=$1", [b.job]);
    });
    const { page, done } = await open(width, "cut", i.productionManager);
    await page.getByRole("button", { name: "Combine" }).first().click();
    await page.getByRole("button", { name: "Work out combined pattern" }).click();
    await expect(page.getByText(/Combined pattern prepared: \d+ pushes instead of 10\./)).toBeVisible();
    await page.getByRole("button", { name: /Waiting for acceptance/ }).click();
    await expect(page.getByText("Pieces by job (unchanged from the orders)")).toBeVisible();
    await page.getByRole("button", { name: "Accept pattern" }).click();
    await expect(page.getByText("Pattern accepted. Run these jobs to this pattern.")).toBeVisible();
    await done("combined-cuts");
  });

  test(`AP-070 configurator order: off by default, the owner turns it on, lines of stock lengths with free stock, order linked (${width}px)`, async () => {
    const d = await setup(async f => {
      const cfg = await f.configuration({ cuts: [[i.profile2, 1750, 4], [i.profile2, 1450, 4]] });
      await f.stock({ pieces: 2, length: 6 });
      return { cfg };
    });
    const owner = await open(width, "system", i.owner, { id: d.cfg });
    await expect(owner.page.getByText(/Turned off: the owner has not confirmed/)).toBeVisible();
    await owner.page.getByRole("button", { name: "Turn on" }).click();
    await expect(owner.page.getByText("Turned on: projects can be opened as orders.")).toBeVisible();
    await owner.done("system-order-setting");
    const sales = await open(width, "system-form", i.sales, { id: d.cfg });
    await expect(sales.page.getByText(/3 × 6 m \(8 cuts/)).toBeVisible();
    await expect(sales.page.getByText(/2 free in stock · 1 to produce/)).toBeVisible();
    await sales.page.getByLabel("Agreed net rate (INR/kg)").fill("310");
    await sales.page.getByLabel("HSN code").fill("7604");
    await sales.done("system-order-form");
    await sales.page.getByRole("button", { name: "Create Direct Order" }).click();
    await expect(sales.page.getByText(/Project linked to O-/)).toBeVisible();
    const sent = await sales.page.evaluate(() => window.directOrders[0]);
    assert.deepEqual([sent.items.length, sent.items[0].quantity_pieces, sent.items[0].length_per_piece_m, sent.items[0].net_rate], [1, 3, 6, 310], "the order carries the stock-length line and the rate sales typed");
    assert.match(sent.order.notes, /Hardware: H-101 Roller x 4 pcs/);
  });

  test(`AP-088 arithmetic in numeric fields: the result is kept, the expression is a hint, a broken one is reported (${width}px)`, async () => {
    const { page, done } = await open(width, "numbers", i.sales);
    await page.getByLabel("Weight (kg)").fill("=12*6.4"); await page.getByLabel("Weight (kg)").blur();
    await expect(page.getByLabel("Weight (kg)")).toHaveValue("76.8");
    await expect(page.getByText("= 12*6.4")).toBeVisible();
    await page.getByLabel("Pieces").fill("250+180"); await page.getByLabel("Pieces").blur();
    await expect(page.getByLabel("Pieces")).toHaveValue("430");
    await page.getByLabel("Rate per kg").fill("300/0"); await page.getByLabel("Rate per kg").blur();
    await expect(page.getByText("Cannot divide by zero")).toBeVisible();
    await expect(page.getByLabel("Rate per kg")).toHaveValue("300/0");
    await page.getByLabel("Weight (kg)").fill("alert(1)");
    await expect(page.getByLabel("Weight (kg)")).toHaveValue("(1)", "letters cannot be typed");
    await done("arithmetic");
  });

  test(`AP-023 dictation: the microphone appears only with speech recognition and adds the spoken text (${width}px)`, async () => {
    const without = await open(width, "voice", i.production, { speech: "false" });
    await expect(without.page.getByRole("button", { name: "Dictate the text" })).toHaveCount(0);
    const { page, done } = await open(width, "voice", i.production, { speech: "true" });
    await expect(page.getByText(/speech service may process the audio/)).toBeVisible();
    await page.getByRole("button", { name: "English" }).click();
    await page.getByRole("button", { name: "Dictate the text" }).click();
    await expect(page.getByTestId("text")).toHaveText("Billet short. press ruk gaya");
    await done("dictation");
  });

  test(`AP-093 undo: a task move and a read notification can be undone; a posting action offers no undo (${width}px)`, async () => {
    const d = await setup(async f => {
      const id = f.next();
      await f.seed("insert into notifications(id,company_id,recipient_user_id,title,is_read,read_at) values($1,$2,$3,'Dispatch ready',true,now())", [id, i.company, i.sales]);
      return { id };
    });
    const { page, done } = await open(width, "undo", i.sales, { notification: d.id });
    await page.getByRole("button", { name: "Complete task" }).click();
    await expect(page.getByTestId("status")).toHaveText("Task status: completed");
    await done("undo");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByTestId("status")).toHaveText("Task status: open");
    await page.getByRole("button", { name: "Mark notification read" }).click();
    await page.getByRole("button", { name: "Undo" }).last().click();
    await expect(page.getByTestId("read")).toHaveText("Notification: unread");
    const row = await setup(f => f.db.query("select is_read from notifications where id=$1", [d.id]));
    assert.equal(row.rows[0].is_read, false, "the database marked it unread again");
    await page.getByRole("button", { name: "Post invoice" }).click();
    await expect(page.getByText("Invoice posted")).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0, { timeout: 12000 });
  });
}

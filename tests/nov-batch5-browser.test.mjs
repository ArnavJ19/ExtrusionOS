import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { createNov5BrowserFixture } from "../scripts/lib/nov-batch5-browser-fixture.mjs";
import { nids as i } from "../scripts/lib/nov-batch5-fixture.mjs";

let fixture, browser, page, errors;
const evidence = "docs/evidence/NOV_UPGRADES_BATCH_5";
test.before(async () => { fixture = await createNov5BrowserFixture(); browser = await chromium.launch({ headless: true }); mkdirSync(evidence, { recursive: true }); });
test.after(async () => { await browser?.close(); await fixture?.close(); });
test.beforeEach(async () => { await fixture.start(); errors = []; page = await (await browser.newContext({ viewport: { width: 375, height: 900 }, timezoneId: "Asia/Kolkata" })).newPage(); page.setDefaultTimeout(15000); page.on("pageerror", error => errors.push(error.message)); await page.goto(fixture.base); });
test.afterEach(async () => { await page?.context().close(); await fixture.rollback(); assert.deepEqual(errors, []); });
const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
const noteLabel = "Reason or supporting evidence";
const note = "Reviewed with the responsible department";
async function review() { await page.getByRole("button", { name: "Review this action", exact: true }).click(); await expect(page.getByRole("heading", { name: "Review before confirming", exact: true })).toBeVisible(); }
async function confirm() { await page.getByRole("button", { name: "Confirm reviewed action", exact: true }).click(); await expect(page.getByRole("heading", { name: "Action confirmed", exact: true })).toBeVisible(); }
const as = (role, userId) => page.evaluate(([role, userId]) => window.mount({ role, userId }), [role, userId]);
const open = (view, id) => page.evaluate(([view, id]) => window.loadDetail(view, id), [view, id]);
const tomorrow = hour => { const d = new Date(Date.now() + 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); return new Date(`${d}T${String(hour).padStart(2, "0")}:00:00+05:30`).toISOString(); };

test("every assurance record view renders at phone width without errors or overflow", async () => {
  const f = fixture.f;
  const drawing = (await f.apply({ action: "drawing.register", drawing_id: i.drawing, revision_label: "R1", file_sha256: "a".repeat(64), customer_approval_required: true, profile_id: i.profile, note }, i.quality)).request_id;
  const change = (await f.apply({ action: "change.propose", order_item_id: i.line1, changes: { cut_length: 5800 }, note }, i.sales)).request_id;
  await f.apply({ action: "instrument.register", code: "MIC-1", name: "Micrometer 0-25", unit: "mm", range_min: 0, range_max: 25, note }, i.quality);
  const instrument = (await f.db.query("select id from measuring_instruments")).rows[0].id;
  await f.seed("insert into production_plan_slots(id,company_id,production_job_id,machine_id,planned_start_at,planned_end_at,shift,capacity_kg,status) values($1,$2,$3,$4,$5,$6,'Day',500,'scheduled')", [i.slot1, i.company, i.job1, i.press1, tomorrow(10), tomorrow(14)]);
  await f.seed("insert into factory_maintenance_blocks(id,company_id,machine_id,starts_at,ends_at,reason,status,created_by) values($1,$2,$3,$4,$5,'Container liner change','planned',$6)", [i.block, i.company, i.press1, tomorrow(9), tomorrow(16), i.factory]);
  const count = (await f.apply({ action: "count.open", location: "Rack 4", blind: true, note }, i.inventory)).request_id;
  const ret = (await f.apply({ action: "return.authorize", packing_item_id: i.bundle2, expected_kg: 120, response: "credit", note }, i.salesManager)).request_id;
  const views = [["drawings", drawing], ["incoming", i.receiptLine], ["deliveries", i.dispatch1], ["revisions", change], ["capability", i.competency], ["instruments", instrument],
    ["capacity", i.block], ["counts", count], ["packs", i.dispatch1], ["returns", ret]];
  await as("owner", i.owner);
  for (const [view, id] of views) {
    await open(view, id);
    await expect(page.getByText("Current authorized read as of", { exact: false })).toBeVisible();
    await noOverflow();
    if (["capacity", "revisions", "packs"].includes(view)) await page.screenshot({ path: `${evidence}/${view}-record-phone.png`, fullPage: true });
  }
});

test("NOV-069: a quality decision is validated on the phone, reviewed, confirmed and reflected in the balance", async () => {
  await as("quality", i.quality); await open("incoming", i.receiptLine);
  await expect(page.getByText(/950 awaiting quality decision/)).toBeVisible();
  await page.getByLabel("Decision").selectOption("accept"); await page.getByLabel("Quantity (purchase unit)").fill("600");
  await page.getByLabel("Evidence (document, slip, photo or call reference)").fill("Diameter and surface checked"); await page.getByLabel(noteLabel).fill(note);
  await page.getByRole("button", { name: "Review this action", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("mill test certificate");
  await page.getByLabel("Mill test certificate reference (optional)").fill("MTC-7781");
  await review(); await expect(page.getByText("600 kg")).toBeVisible();
  assert.equal(Number((await fixture.f.db.query("select count(*) n from incoming_dispositions")).rows[0].n), 0, "review alone records nothing");
  await page.screenshot({ path: `${evidence}/incoming-review-phone.png`, fullPage: true });
  await confirm();
  await expect(page.getByText(/350 awaiting quality decision/)).toBeVisible(); await noOverflow();
});

test("NOV-062: the drawing file checksum is computed on the device and registered with the revision", async () => {
  await page.evaluate(id => window.mount({ role: "quality", userId: id, action: "drawing.register", fixed: {}, screen: "form" }), i.quality);
  await page.getByRole("combobox", { name: "Drawing" }).click(); await page.getByRole("option", { name: /DWG-NOV5-1/ }).click();
  await page.getByLabel("Revision label").fill("R2");
  const file = Buffer.from("%PDF-1.4 synthetic sliding track drawing revision R2");
  await page.getByLabel("Drawing file").setInputFiles({ name: "track-r2.pdf", mimeType: "application/pdf", buffer: file });
  const checksum = createHash("sha256").update(file).digest("hex");
  await expect(page.getByText(`Checksum ${checksum.slice(0, 16)}`)).toBeVisible();
  await page.getByLabel("Customer approval required before release").selectOption("true"); await page.getByLabel(noteLabel).fill("Radius change agreed in TQ-14");
  await review(); await confirm();
  assert.deepEqual((await fixture.f.db.query("select file_sha256,file_name from drawing_revisions")).rows, [{ file_sha256: checksum, file_name: "track-r2.pdf" }]);
});

test("NOV-076: an over-disposition is refused by the server and the bundle form stays usable", async () => {
  await as("dispatch", i.dispatch); await open("deliveries", i.dispatch1);
  await page.locator("summary", { hasText: "Record bundle B1" }).click();
  const form = page.locator("details", { hasText: "Record bundle B1" });
  await form.getByLabel("Disposition").selectOption("refused"); await form.getByLabel("Quantity (kg)").fill("400");
  await form.getByLabel("Received or reported by").fill("Site store keeper"); await form.getByLabel("Evidence (document, slip, photo or call reference)").fill("Signed POD 4471");
  await form.getByLabel(noteLabel).fill(note); await form.getByRole("button", { name: "Review this action" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Only 300 kg" })).toBeVisible();
  await expect(form.getByRole("button", { name: "Review this action" })).toBeEnabled();
  await form.getByLabel("Quantity (kg)").fill("300"); await review(); await confirm();
  await expect(page.getByText(/300 kg refused, damaged or reported short/)).toBeVisible(); await noOverflow();
});

test("NOV-030: counters on a blind count never see expected quantities on screen", async () => {
  const count = (await fixture.f.apply({ action: "count.open", location: "Rack 4", blind: true, note }, i.inventory)).request_id;
  await as("inventory_manager", i.inventory); await open("counts", count);
  await expect(page.getByText(/S1 · AL-NOV5 · pending/)).toBeVisible();
  assert.equal(await page.getByText(/expected \d+ pcs/).count(), 0);
  await as("accounts", i.accounts); await open("counts", count);
  await expect(page.getByText(/expected 10 pcs/).first()).toBeVisible();
});

test("shared protocol: a lost commit response resolves from the original request without a duplicate", async () => {
  await page.getByLabel("Stock location (as recorded on bundles)").fill("Rack 4"); await page.getByLabel("Hide expected quantities from counters").selectOption("true");
  await page.getByLabel(noteLabel).fill("Monthly count of rack 4"); await review();
  await page.evaluate(() => { window.lostCommand = "commit"; const button = [...document.querySelectorAll("button")].find(entry => entry.textContent === "Confirm reviewed action"); button.click(); button.click(); });
  await expect(page.getByRole("heading", { name: "Outcome needs checking" })).toBeVisible();
  assert.equal(await page.evaluate(() => window.calls.filter(call => call.command === "commit").length), 1);
  await page.reload(); await expect(page.getByRole("heading", { name: "Outcome needs checking" })).toBeVisible();
  await page.getByRole("button", { name: "Check original request" }).click(); await expect(page.getByRole("heading", { name: "Action confirmed" })).toBeVisible();
  assert.equal(Number((await fixture.f.db.query("select count(*) n from cycle_counts")).rows[0].n), 1);
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { createNov4BrowserFixture } from "../scripts/lib/nov-batch4-browser-fixture.mjs";
import { nids as i } from "../scripts/lib/nov-batch4-fixture.mjs";

let fixture, browser, page, errors;
const evidence = "docs/evidence/NOV_UPGRADES_BATCH_4";
test.before(async () => { fixture = await createNov4BrowserFixture(); browser = await chromium.launch({ headless: true }); mkdirSync(evidence, { recursive: true }); });
test.after(async () => { await browser?.close(); await fixture?.close(); });
test.beforeEach(async () => { await fixture.start(); errors = []; page = await (await browser.newContext({ viewport: { width: 375, height: 900 }, timezoneId: "Asia/Kolkata" })).newPage(); page.setDefaultTimeout(15000); page.on("pageerror", error => errors.push(error.message)); await page.goto(fixture.base); });
test.afterEach(async () => { await page?.context().close(); await fixture.rollback(); assert.deepEqual(errors, []); });
const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
const noteLabel = "Reason or supporting evidence";
async function review() { await page.getByRole("button", { name: "Review this action", exact: true }).click(); await expect(page.getByRole("heading", { name: "Review before confirming", exact: true })).toBeVisible(); }
async function confirm() { await page.getByRole("button", { name: "Confirm reviewed action", exact: true }).click(); await expect(page.getByRole("heading", { name: "Action confirmed", exact: true })).toBeVisible(); }
const observations = async () => Number((await fixture.f.db.query("select count(*) n from wip_location_observations where production_job_id=$1", [i.job3])).rows[0].n);

test("NOV-028: a phone user records a WIP location through review and the stage is unchanged", async () => {
  await page.getByRole("combobox", { name: "Observed location" }).click();
  await page.getByRole("option", { name: /Bay 2 ageing rack/ }).click();
  await page.getByLabel("Quantity seen (kg) (optional)").fill("85.5");
  await page.getByLabel(noteLabel).fill("Seen on rack B during the shift walk");
  await review(); assert.equal(await observations(), 0, "review alone records nothing");
  await expect(page.getByText("85.5 kg")).toBeVisible(); await noOverflow();
  await page.screenshot({ path: `${evidence}/wip-observe-review-phone.png`, fullPage: true });
  await confirm(); assert.equal(await observations(), 1);
  assert.equal((await fixture.f.db.query("select status from production_jobs where id=$1", [i.job3])).rows[0].status, "in_progress");
});

test("NOV-028: blank optional quantity stays unknown and a refused review releases the request", async () => {
  await page.getByRole("combobox", { name: "Observed location" }).click(); await page.getByRole("option", { name: /Bay 2 ageing rack/ }).click();
  await page.getByLabel(noteLabel).fill("Seen but not weighed");
  await review(); await expect(page.getByText("not measured")).toBeVisible();
  await page.getByRole("button", { name: "Cancel this review" }).click(); await expect(page.getByText(/made no operational change/)).toBeVisible();
  await page.getByRole("button", { name: "Start another action" }).click();
  await page.evaluate(() => window.mount({ fixed: { job_id: window.ids.job2 } }));
  await page.getByRole("combobox", { name: "Observed location" }).click(); await page.getByRole("option", { name: /Bay 2 ageing rack/ }).click();
  await page.getByLabel(noteLabel).fill("Trying to locate a planned job");
  await page.getByRole("button", { name: "Review this action", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Only started or unfinished material can be located");
  await expect(page.getByRole("button", { name: "Review this action", exact: true })).toBeEnabled();
  assert.equal(Number((await fixture.f.db.query("select count(*) n from wip_location_observations")).rows[0].n), 0);
});

test("NOV-098 for controls: a lost commit response resolves from the original request without a duplicate", async () => {
  await page.getByRole("combobox", { name: "Observed location" }).click(); await page.getByRole("option", { name: /Bay 2 ageing rack/ }).click();
  await page.getByLabel(noteLabel).fill("Seen on rack B during the shift walk"); await review();
  await page.evaluate(() => { window.lostCommand = "commit"; const button = [...document.querySelectorAll("button")].find(entry => entry.textContent === "Confirm reviewed action"); button.click(); button.click(); });
  await expect(page.getByRole("heading", { name: "Outcome needs checking" })).toBeVisible();
  assert.equal(await page.evaluate(() => window.calls.filter(call => call.command === "commit").length), 1);
  await page.reload(); await expect(page.getByRole("heading", { name: "Outcome needs checking" })).toBeVisible();
  await page.getByRole("button", { name: "Check original request" }).click(); await expect(page.getByRole("heading", { name: "Action confirmed" })).toBeVisible();
  assert.equal(await observations(), 1);
});

test("NOV-031: vendor custody record shows the balance and an over-explanation is refused before review", async () => {
  await fixture.f.seed(`insert into finishing_jobs(id,company_id,order_id,production_job_id,finishing_type,vendor_id,status,input_weight_kg,output_weight_kg,rejection_weight_kg,sent_date,received_date)
    values($1,$2,$3,$4,'anodizing',$5,'received',320,300,10,current_date-10,current_date-2)`, [i.finishing2, i.company, i.order, i.job1, i.vendor]);
  await page.evaluate(async () => { window.mount({ role: "inventory_manager", userId: window.ids.inventory }); await window.loadDetail("custody", window.ids.finishing2); });
  await expect(page.getByText("Not yet accounted (kg)")).toBeVisible(); await expect(page.getByText(/10 kg not yet accounted/)).toBeVisible();
  await page.locator("summary", { hasText: "Explain a vendor custody difference" }).click();
  await page.getByLabel("Explanation").selectOption("process_loss"); await page.getByLabel("Quantity (kg)").fill("12");
  await page.getByLabel("Evidence (slip, gate pass or claim reference)").fill("Vendor weighment slip 4411"); await page.getByLabel(noteLabel).fill("Agreed with the vendor on call");
  await page.getByRole("button", { name: "Review this action", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Only 10 kg is not yet accounted for");
  await page.getByLabel("Quantity (kg)").fill("6"); await review(); await confirm();
  await expect(page.getByText(/4 kg not yet accounted/)).toBeVisible(); await noOverflow();
  await page.screenshot({ path: `${evidence}/custody-record-phone.png`, fullPage: true });
});

test("NOV-005: ledger record shows separate stage balances and marks unavailable sources", async () => {
  await page.evaluate(async () => { window.mount({ role: "sales", userId: window.ids.sales }); await window.loadDetail("ledger", window.ids.order); });
  const ledger = page.getByRole("region", { name: "Order fulfilment ledger" });
  await expect(ledger.getByRole("heading", { name: "Track 6 m" })).toBeVisible(); await expect(ledger.getByText("Remaining to depart kg").first()).toBeVisible();
  await expect(ledger.getByText(/1 production job\(s\)/)).toBeVisible(); await noOverflow();
  await page.screenshot({ path: `${evidence}/ledger-phone.png`, fullPage: true });
  await fixture.f.db.exec("alter table public.production_job_holds rename to production_job_holds_offline");
  await page.evaluate(async () => { await window.loadDetail("ledger", window.ids.order); });
  await expect(ledger.getByRole("alert")).toContainText("Could not read: holds");
  await expect(ledger.getByText("Unavailable").first()).toBeVisible();
});

test("NOV-042: authority limits are entered per permitted role and published through review", async () => {
  await page.evaluate(() => window.mount({ role: "admin", userId: window.ids.admin, action: "authority.publish", fixed: {} }));
  await page.getByLabel("Decision").selectOption("overdue_dispatch");
  await expect(page.getByLabel("accounts")).toBeVisible(); await expect(page.getByLabel("owner")).toHaveCount(0);
  await page.getByLabel("accounts").fill("100000");
  const soon = await page.evaluate(() => { const d = new Date(Date.now() + 3600000 + 5.5 * 3600000); return d.toISOString().slice(0, 16); });
  await page.getByLabel("Effective from (IST)").fill(soon); await page.getByLabel(noteLabel).fill("Credit committee decision 3 Nov");
  await review(); await expect(page.getByText("accounts 100000")).toBeVisible(); await confirm();
  assert.deepEqual((await fixture.f.db.query("select limits from decision_authority_revisions")).rows[0].limits, { accounts: 100000 });
});

test("NOV-013: drafts save after edits, restore after reload, exclude rates and clear only after a confirmed save", async () => {
  await page.goto(`${fixture.base}/?screen=draft`);
  await expect(page.getByRole("status")).toContainText("saved on this device as you type");
  await page.getByLabel("batch_number").fill("QC-77"); await page.getByLabel("notes").fill("Bow within limits"); await page.getByLabel("unit_rate").fill("210");
  await expect(page.getByRole("status")).toContainText("Draft saved on this device");
  const stored = await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.startsWith("eos:form-draft:record_quality:"))?.[1]);
  assert.ok(stored); assert.equal(JSON.parse(stored).payload.unit_rate, undefined); assert.equal(JSON.parse(stored).payload.batch_number, "QC-77");
  await page.reload(); await expect(page.getByRole("button", { name: "Restore saved draft" })).toBeVisible();
  await page.getByRole("button", { name: "Restore saved draft" }).click();
  await expect(page.getByLabel("batch_number")).toHaveValue("QC-77"); await expect(page.getByLabel("unit_rate")).toHaveValue("");
  await page.evaluate(() => { window.saveFails = true; }); await page.getByRole("button", { name: "Save inspection" }).click();
  assert.ok(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith("eos:form-draft:"))), "an uncertain save keeps the draft");
  await page.evaluate(() => { window.saveFails = false; }); await page.getByRole("button", { name: "Save inspection" }).click();
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith("eos:form-draft:")))).toBe(false);
  await page.screenshot({ path: `${evidence}/draft-recovery-phone.png`, fullPage: true });
});

test("NOV-013: a second tab's newer draft is not silently overwritten and another employee cannot restore it", async () => {
  await page.goto(`${fixture.base}/?screen=draft`);
  await page.getByLabel("batch_number").fill("TAB-A"); await expect(page.getByRole("status")).toContainText("Draft saved on this device");
  const second = await page.context().newPage(); second.on("pageerror", error => errors.push(error.message));
  await second.goto(`${fixture.base}/?screen=draft`); await second.getByRole("button", { name: "Restore saved draft" }).click();
  await second.getByLabel("batch_number").fill("TAB-B"); await expect(second.getByRole("status")).toContainText("Draft saved on this device");
  await page.getByLabel("notes").fill("Edited in the first tab");
  await expect(page.getByRole("status")).toContainText("Another tab changed this draft");
  assert.equal(JSON.parse(await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.startsWith("eos:form-draft:"))[1])).payload.batch_number, "TAB-B");
  await expect(page.getByLabel("notes")).toHaveValue("Edited in the first tab");
  await page.evaluate(() => window.mount({ screen: "draft", userId: window.ids.quality }));
  await expect(page.getByRole("button", { name: "Restore saved draft" })).toHaveCount(0);
  await second.close();
});

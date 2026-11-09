import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { createNov9BrowserFixture } from "../scripts/lib/nov-batch9-browser-fixture.mjs";
import { nids as i, day } from "../scripts/lib/nov-batch9-fixture.mjs";

let fixture, browser, page, errors;
const evidence = "docs/evidence/NOV_UPGRADES_BATCH_9";
test.before(async () => { fixture = await createNov9BrowserFixture(); browser = await chromium.launch({ headless: true }); mkdirSync(evidence, { recursive: true }); });
test.after(async () => { await browser?.close(); await fixture?.close(); });
test.beforeEach(async () => {
  await fixture.start(); errors = [];
  page = await (await browser.newContext({ viewport: { width: 375, height: 900 }, timezoneId: "Asia/Kolkata", acceptDownloads: true })).newPage();
  page.setDefaultTimeout(15000); page.on("pageerror", error => errors.push(error.message)); await page.goto(fixture.base);
});
test.afterEach(async () => { await page?.context().close(); await fixture.rollback(); assert.deepEqual(errors, []); });
const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
const note = "Reviewed with the responsible department";
const as = (role, userId, patch = {}) => page.evaluate(([role, userId, patch]) => window.mount({ role, userId, ...patch }), [role, userId, patch]);
const open = (view, id) => page.evaluate(([view, id]) => window.loadDetail(view, id), [view, id]);
async function review() { await page.getByRole("button", { name: "Review this action", exact: true }).click(); await expect(page.getByRole("heading", { name: "Review before confirming", exact: true })).toBeVisible(); }
async function confirm() { await page.getByRole("button", { name: "Confirm reviewed action", exact: true }).click(); await expect(page.getByRole("heading", { name: "Action confirmed", exact: true })).toBeVisible(); }
async function choose(name, option) { await page.getByRole("combobox", { name, exact: true }).click(); await page.getByRole("option", { name: option }).first().click(); }
const idOf = result => result.result.href.split("/").pop();
const q = (sql, params = []) => fixture.f.db.query(sql, params);

test("every commercial record view renders at phone width without errors or overflow", async () => {
  const f = fixture.f;
  const rule = idOf(await f.apply({ action: "pricing.define", code: "vol_kg", name: "Standard volume rate", charge_type: "bracket_rate", unit_basis: "kg", precedence: 0, effective_from: day(-30), brackets: [{ from: 0, to: 100, rate: 250 }, { from: 100, rate: 230 }], note }, i.salesManager));
  await f.apply({ action: "pricing.approve", id: rule, note }, i.accounts);
  const calc = idOf(await f.apply({ action: "pricing.price", customer_id: i.customer, unit_basis: "kg", quantity: 120 }, i.sales));
  const claim = idOf(await f.apply({ action: "claim.submit", purchase_order_line_id: i.poLine, claim_type: "shortage", quantity: 300, amount: 63000, remedy: "credit", owner_id: i.inventory, response_due: day(7), note }, i.inventory));
  await f.apply({ action: "claim.respond", id: claim, response: "agreed", agreed_quantity: 0, agreed_amount: 20000, note }, i.inventory);
  await f.apply({ action: "claim.link", id: claim, kind: "credit", credit_id: i.credit1, note }, i.inventory);
  const lot = idOf(await f.apply({ action: "remnant.record", profile_id: i.profile, length_mm: 3500, pieces: 10, finish: "anodizing", origin_type: "cutting_remnant", location: "Rack R4", note }, i.production));
  await f.apply({ action: "remnant.reserve", id: lot, order_item_id: i.line1, pieces: 3, note }, i.productionManager);
  const mapping = idOf(await f.apply({ action: "mapping.define", sales_ledger: "Sales - aluminium", tax_ledger: "Output GST", party_key: "gst_number", note }, i.accounts));
  await f.apply({ action: "mapping.approve", id: mapping, note }, i.admin);
  const batch = idOf(await f.apply({ action: "transfer.prepare", count: 2, note }, i.accounts));
  const group = (await f.command("list", { view: "runs" }, i.productionManager)).rows.find(r => r.details.group.die_number === "DIE-NOV8-C");
  const scenario = idOf(await f.apply({ action: "scenario.create", name: "Press A breakdown", horizon_days: 7, changes: [{ type: "machine_down", machine_id: i.press1, from_date: day(1), days: 1 }], note }, i.productionManager));
  const cohort = (await f.command("list", { view: "cohorts" }, i.owner)).rows[0];
  await as("owner", i.owner);
  for (const [view, id] of [["pricing", rule], ["pricing", calc], ["claims", claim], ["profitability", i.orderProfit], ["reliability", i.vendor2], ["outcomes", i.quoteSent], ["cohorts", cohort.id], ["remnants", lot], ["transfers", mapping],
    ["transfers", batch], ["runs", group.id], ["scenarios", scenario]]) {
    await open(view, id);
    await expect(page.getByText("Current authorized read as of", { exact: false })).toBeVisible();
    await noOverflow();
    await page.screenshot({ path: `${evidence}/${view}-${view === "pricing" && id === calc ? "calculation" : view === "transfers" && id === batch ? "batch" : "record"}-phone.png`, fullPage: true });
  }
  await open("pricing", calc);
  await expect(page.getByText("Prices exclude GST", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("INR 27,600.00").first()).toBeVisible();
  await open("profitability", i.orderProfit);
  await expect(page.getByText("A blank is missing information, not zero.", { exact: false })).toBeVisible();
  await open("remnants", lot);
  await expect(page.getByText("does not post to the profile stock ledger", { exact: false })).toBeVisible();
  await open("scenarios", scenario);
  await expect(page.getByText("Everything below is hypothetical", { exact: false })).toBeVisible();
  await expect(page.getByText("No recorded capacity for this press").first()).toBeVisible();
  await open("runs", group.id);
  await expect(page.getByText("Advisory only", { exact: false })).toBeVisible();
});

test("NOV-064: a rule is defined and reviewed by sales, approved by a second person, and a price is reviewed with its breakdown", async () => {
  await as("sales_manager", i.salesManager, { screen: "form", action: "pricing.define" });
  await page.getByLabel("Code", { exact: true }).fill("vol_kg");
  await page.getByLabel("Name", { exact: true }).fill("Standard volume rate");
  await page.getByLabel("Charge", { exact: true }).selectOption("bracket_rate");
  await page.getByLabel("Priced per", { exact: true }).selectOption("kg");
  await page.getByLabel("Precedence (0 to 100)").fill("0");
  await page.getByLabel("Effective from").fill(day(-5));
  await page.getByLabel("Quantity brackets").fill("0 | 100 | 250\n100 | 500 | 230\n500 | | 210");
  await page.getByLabel("Reason or supporting evidence").fill(note);
  await review();
  await expect(page.getByText("0 to 100 at INR 250; 100 to 500 at INR 230; 500 to and above at INR 210", { exact: false })).toBeVisible();
  await page.screenshot({ path: `${evidence}/rule-review-phone.png`, fullPage: true });
  await confirm();
  const rule = (await q("select id from pricing_rules")).rows[0].id;
  // The defining person sees no approval button; a second person does.
  await open("pricing", rule);
  await expect(page.getByRole("button", { name: "Approve this rule" })).toHaveCount(0);
  await as("accounts", i.accounts);
  await open("pricing", rule);
  await page.getByRole("button", { name: "Approve this rule" }).click();
  await page.getByLabel("Reason or supporting evidence").fill("Matches the signed price list");
  await review(); await confirm();
  assert.equal((await q("select status from pricing_rules")).rows[0].status, "approved");
  await page.getByRole("button", { name: "Start another action", exact: true }).click();
  // A sales user prices 120 kg and reviews the breakdown, including the next-bracket note.
  await as("sales", i.sales, { screen: "form", action: "pricing.price" });
  await choose("Customer", "Fixture fabricator");
  await page.getByLabel("Priced per", { exact: true }).selectOption("kg");
  await page.getByLabel("Quantity", { exact: true }).fill("99");
  await review();
  await expect(page.getByText("INR 24,750.00").first()).toBeVisible();
  await expect(page.getByText(/1 more kg reaches the next bracket/)).toBeVisible();
  await expect(page.getByLabel("Reason or supporting evidence")).toHaveCount(0);
  await page.screenshot({ path: `${evidence}/price-review-phone.png`, fullPage: true });
  await confirm();
  assert.equal(Number((await q("select final_total from pricing_calculations")).rows[0].final_total), 24750);
  await page.getByRole("button", { name: "Start another action", exact: true }).click();
  // The override fields are not offered to a role that may not override.
  await as("sales", i.sales, { screen: "form", action: "pricing.price" });
  await page.getByLabel("Override rate (optional)").fill("200");
  await page.getByLabel("Override reason").fill("Match competitor quote");
  await choose("Customer", "Fixture fabricator");
  await page.getByLabel("Priced per", { exact: true }).selectOption("kg");
  await page.getByLabel("Quantity", { exact: true }).fill("120");
  await page.getByRole("button", { name: "Review this action", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Only a sales manager, admin or owner may override a rate");
  await noOverflow();
});

test("NOV-078: a claim is submitted for the quantity still open and a credit is linked only after the supplier agrees", async () => {
  await as("inventory_manager", i.inventory, { screen: "form", action: "claim.submit" });
  await choose("Purchase order line", "PO-NOV5-1 · line 1");
  await page.getByLabel("Claim", { exact: true }).selectOption("shortage");
  await page.getByLabel("Quantity claimed").fill("900");
  await page.getByLabel("Amount claimed (INR)").fill("189000");
  await page.getByLabel("Remedy requested").selectOption("credit");
  await choose("Follow-up owner", "Fixture inventory");
  await page.getByLabel("Supplier response due").fill(day(7));
  await page.getByLabel("Reason or supporting evidence").fill("Short delivery against the delivery challan");
  await page.getByRole("button", { name: "Review this action", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(/Only 600 kg are open to claim/);
  await page.getByLabel("Quantity claimed").fill("400");
  await page.getByLabel("Amount claimed (INR)").fill("84000");
  await review();
  await expect(page.getByText(/Nothing is credited or replaced until a receipt or an approved credit is linked/)).toBeVisible();
  await page.screenshot({ path: `${evidence}/claim-review-phone.png`, fullPage: true });
  await confirm();
  const claim = (await q("select id from supplier_claims")).rows[0].id;
  await open("claims", claim);
  await page.getByRole("button", { name: "Start another action", exact: true }).click();
  await expect(page.getByRole("button", { name: "Link a recovery" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Record the supplier response" })).toBeVisible();
  await page.getByRole("button", { name: "Record the supplier response" }).click();
  await page.getByLabel("Response", { exact: true }).selectOption("agreed");
  await page.getByLabel("Agreed quantity").fill("0");
  await page.getByLabel("Agreed amount (INR)").fill("10000");
  await page.getByLabel("Reason or supporting evidence").fill("Supplier confirmed by email");
  await review(); await confirm();
  await page.getByRole("button", { name: "Start another action", exact: true }).click();
  await open("claims", claim);
  await page.getByRole("button", { name: "Link a recovery" }).click();
  await page.getByLabel("Recovery", { exact: true }).selectOption("credit");
  await choose("Posted supplier credit", "Credit note INR 10,000.00");
  await page.getByLabel("Reason or supporting evidence").fill("Credit note CN-4412 posted by accounts");
  await review();
  await expect(page.getByText(/does not create or post anything in stores or finance/)).toBeVisible();
  await confirm();
  assert.equal((await q("select status,close_note from supplier_claims")).rows[0].close_note, "Fully recovered");
  await noOverflow();
});

test("NOV-029: pieces are reserved for a matching order line straight from the lot, and the waste is stated", async () => {
  const lot = idOf(await fixture.f.apply({ action: "remnant.record", profile_id: i.profile, length_mm: 3500, pieces: 10, finish: "anodizing", origin_type: "cutting_remnant", location: "Rack R4", note }, i.production));
  await as("production_manager", i.productionManager); await open("remnants", lot);
  await expect(page.getByText("Requirements this lot can cover")).toBeVisible();
  await expect(page.getByRole("cell", { name: "500", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reserve", exact: true }).click();
  await page.getByLabel("Pieces to reserve").fill("6");
  await page.getByLabel("Reason or supporting evidence").fill("Cover the first delivery of the order");
  await review();
  await expect(page.getByText(/Each piece leaves 500 mm of waste from a 3500 mm remnant/)).toBeVisible();
  await page.screenshot({ path: `${evidence}/remnant-review-phone.png`, fullPage: true });
  await confirm();
  assert.equal((await q("select pieces,cut_length_mm from remnant_allocations")).rows[0].pieces, 6);
  await page.getByRole("button", { name: "Start another action", exact: true }).click();
  await open("remnants", lot);
  await expect(page.getByRole("cell", { name: "reserved" })).toBeVisible();
  await as("production", i.production); await open("remnants", lot);
  await expect(page.getByRole("button", { name: "Reserve", exact: true })).toHaveCount(0);
  await noOverflow();
});

test("NOV-020: the export file is downloaded safely and each invoice result is recorded from the batch", async () => {
  const f = fixture.f;
  const mapping = idOf(await f.apply({ action: "mapping.define", sales_ledger: "Sales - aluminium", tax_ledger: "Output GST", party_key: "customer_name", note }, i.accounts));
  await f.apply({ action: "mapping.approve", id: mapping, note }, i.admin);
  await q("update customers set customer_name='=SUM(A1)' where id=$1", [i.customer]);
  const batch = idOf(await f.apply({ action: "transfer.prepare", count: 2, note }, i.accounts));
  await as("accounts", i.accounts); await open("transfers", batch);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download the file for the accounting package" }).click()]);
  const csv = readFileSync(await download.path(), "utf8");
  assert.match(csv.split("\r\n")[0], /^External reference,Invoice number,Invoice date,Party,Sales ledger,Taxable amount,Tax ledger,Tax amount,Total$/);
  assert.match(csv, /EOS-INV-[0-9A-F]{32},INV-NOV9-/);
  assert.match(csv, /'=SUM\(A1\)/, "a formula in a party name is neutralised");
  assert.equal(csv.split("\r\n").length, 3);
  await page.getByRole("button", { name: "Record as exported" }).click();
  await page.getByLabel("Reason or supporting evidence").fill("Downloaded and imported into the package");
  await review(); await confirm();
  await page.getByRole("button", { name: "Start another action", exact: true }).click();
  await open("transfers", batch);
  await page.getByRole("button", { name: "Record result" }).first().click();
  await page.getByLabel("Result", { exact: true }).selectOption("accepted");
  await page.getByLabel("Reference given by the package").fill("TALLY-4412");
  await page.getByLabel("Reason or supporting evidence").fill("Voucher posted in the package");
  await review(); await confirm();
  assert.equal((await q("select count(*) c from transfer_items where state='accepted' and external_reference='TALLY-4412'")).rows[0].c, 1);
  await page.screenshot({ path: `${evidence}/transfer-result-phone.png`, fullPage: true });
  await noOverflow();
});

test("NOV-024: hypothetical changes are added one at a time, reviewed, and saved without touching the live plan", async () => {
  await as("production_manager", i.productionManager, { screen: "form", action: "scenario.create" });
  await page.getByLabel("Scenario name").fill("Press A breakdown");
  await page.getByLabel("Horizon (days from today)").fill("7");
  await page.getByRole("button", { name: "Add this change" }).click();
  await expect(page.getByRole("alert").first()).toContainText("Complete every field of this change first");
  await choose("Press", "Press A");
  await page.getByLabel("First day down").fill(day(1));
  await page.getByLabel("Days down").fill("1");
  await page.getByRole("button", { name: "Add this change" }).click();
  await expect(page.getByText(/1\. Press down from/)).toBeVisible();
  await page.getByLabel("Kind of change").selectOption("extra_shift");
  await choose("Press", "Press A");
  await page.getByLabel("Day of the extra shift").fill(day(2));
  await page.getByLabel("Extra capacity (kg)").fill("300");
  await page.getByRole("button", { name: "Add this change" }).click();
  await expect(page.getByText(/2\. Extra 300 kg/)).toBeVisible();
  await page.getByRole("button", { name: "Remove" }).first().click();
  await expect(page.getByText(/1\. Extra 300 kg/)).toBeVisible();
  await page.getByLabel("Reason or supporting evidence").fill("Planning for the breakdown notice");
  await review();
  await expect(page.getByText(/Everything in this scenario is hypothetical/)).toBeVisible();
  await expect(page.getByText(/no recorded shift capacity/)).toBeVisible();
  await page.screenshot({ path: `${evidence}/scenario-review-phone.png`, fullPage: true });
  const before = (await q("select md5(string_agg(to_jsonb(j)::text,',' order by id)) h from production_jobs j")).rows[0].h;
  await confirm();
  assert.equal((await q("select md5(string_agg(to_jsonb(j)::text,',' order by id)) h from production_jobs j")).rows[0].h, before);
  assert.equal((await q("select jsonb_array_length(changes) n from planning_scenarios")).rows[0].n, 1);
  await as("viewer", i.viewer, { screen: "form", action: "scenario.create" });
  await expect(page.getByRole("button", { name: "Review this action" })).toHaveCount(0);
  await noOverflow();
});

test("NOV-082: density is a per-device choice with a reset, never compacts on touch screens and survives blocked storage", async () => {
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 }, timezoneId: "Asia/Kolkata" });
  const wide = await desktop.newPage(); const wideErrors = []; wide.on("pageerror", error => wideErrors.push(error.message));
  await wide.goto(fixture.base);
  await wide.evaluate(() => window.mount({ screen: "density" }));
  const height = () => wide.locator(".form-input").first().evaluate(element => element.getBoundingClientRect().height);
  const rowHeight = () => wide.locator(".industrial-table td").first().evaluate(element => element.getBoundingClientRect().height);
  const comfortable = await height(); const comfortableRow = await rowHeight();
  assert.equal(await wide.evaluate(() => document.documentElement.dataset.density), "comfortable");
  await wide.getByRole("button", { name: "Compact", exact: true }).click();
  assert.equal(await wide.evaluate(() => document.documentElement.dataset.density), "compact");
  assert.ok(await height() < comfortable, "compact fields are shorter on a mouse-driven screen");
  assert.ok(await rowHeight() < comfortableRow, "compact table rows are shorter");
  assert.equal(await wide.getByRole("button", { name: "Compact", exact: true }).getAttribute("aria-pressed"), "true");
  assert.ok(await height() >= 30, "text stays readable and the control stays usable");
  // The choice is remembered for this user on this device, and a reload restores it.
  assert.equal(await wide.evaluate(() => localStorage.getItem(`extrusionos:density:v1:${window.ids.company}:${window.ids.salesManager}`)), "compact");
  await wide.reload(); await wide.evaluate(() => window.mount({ screen: "density" }));
  // The stored choice is applied by an effect after mount; wait for it rather than reading too early.
  await expect.poll(() => wide.evaluate(() => document.documentElement.dataset.density)).toBe("compact");
  // Another user on the same device keeps their own choice.
  await wide.evaluate(() => { window.mount({ screen: "density", userId: window.ids.owner }); });
  await expect.poll(() => wide.evaluate(() => document.documentElement.dataset.density)).toBe("comfortable");
  await wide.evaluate(() => { window.mount({ screen: "density", userId: window.ids.salesManager }); });
  await expect.poll(() => wide.evaluate(() => document.documentElement.dataset.density)).toBe("compact");
  await wide.getByRole("button", { name: "Reset", exact: true }).click();
  assert.equal(await wide.evaluate(() => document.documentElement.dataset.density), "comfortable");
  assert.equal(await wide.evaluate(() => localStorage.getItem(`extrusionos:density:v1:${window.ids.company}:${window.ids.salesManager}`)), null);
  assert.equal(await height(), comfortable);
  assert.deepEqual(wideErrors, []);
  await desktop.close();
  // Touch screens keep comfortable controls even when compact is chosen.
  const touch = await browser.newContext({ viewport: { width: 375, height: 800 }, isMobile: true, hasTouch: true, timezoneId: "Asia/Kolkata" });
  const phone = await touch.newPage(); await phone.goto(fixture.base); await phone.evaluate(() => window.mount({ screen: "density" }));
  const phoneComfortable = await phone.locator(".form-input").first().evaluate(element => element.getBoundingClientRect().height);
  await phone.getByRole("button", { name: "Compact", exact: true }).click();
  assert.equal(await phone.evaluate(() => document.documentElement.dataset.density), "compact");
  assert.equal(await phone.locator(".form-input").first().evaluate(element => element.getBoundingClientRect().height), phoneComfortable, "touch layouts keep their comfortable minimum");
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await phone.screenshot({ path: `${evidence}/density-touch-phone.png`, fullPage: true });
  await touch.close();
  // Blocked storage: the choice still applies for the session and the control says it is not saved.
  const blocked = await browser.newContext({ viewport: { width: 1280, height: 800 }, timezoneId: "Asia/Kolkata" });
  await blocked.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error("blocked"); }; Storage.prototype.getItem = () => { throw new Error("blocked"); }; });
  const locked = await blocked.newPage(); const lockedErrors = []; locked.on("pageerror", error => lockedErrors.push(error.message));
  await locked.goto(fixture.base); await locked.evaluate(() => window.mount({ screen: "density" }));
  await locked.getByRole("button", { name: "Compact", exact: true }).click();
  await expect(locked.getByText("Not saved on this device")).toBeVisible();
  assert.equal(await locked.evaluate(() => document.documentElement.dataset.density), "compact");
  assert.deepEqual(lockedErrors, []);
  await blocked.close();
});

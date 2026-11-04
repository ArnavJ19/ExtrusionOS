import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { createNov6BrowserFixture } from "../scripts/lib/nov-batch6-browser-fixture.mjs";
import { nids as i } from "../scripts/lib/nov-batch6-fixture.mjs";

let fixture, browser, page, errors;
const evidence = "docs/evidence/NOV_UPGRADES_BATCH_6";
test.before(async () => { fixture = await createNov6BrowserFixture(); browser = await chromium.launch({ headless: true }); mkdirSync(evidence, { recursive: true }); });
test.after(async () => { await browser?.close(); await fixture?.close(); });
test.beforeEach(async () => { await fixture.start(); errors = []; page = await (await browser.newContext({ viewport: { width: 375, height: 900 }, timezoneId: "Asia/Kolkata" })).newPage(); page.setDefaultTimeout(15000); page.on("pageerror", error => errors.push(error.message)); await page.goto(fixture.base); });
test.afterEach(async () => { await page?.context().close(); await fixture.rollback(); assert.deepEqual(errors, []); });
const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
const noteLabel = "Reason or supporting evidence";
const note = "Reviewed with the responsible department";
const day = offset => new Date(Date.now() + offset * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
async function review(scope = page) { await scope.getByRole("button", { name: "Review this action", exact: true }).click(); await expect(page.getByRole("heading", { name: "Review before confirming", exact: true })).toBeVisible(); }
async function confirm() { await page.getByRole("button", { name: "Confirm reviewed action", exact: true }).click(); await expect(page.getByRole("heading", { name: "Action confirmed", exact: true })).toBeVisible(); }
const as = (role, userId) => page.evaluate(([role, userId]) => window.mount({ role, userId }), [role, userId]);
const open = (view, id) => page.evaluate(([view, id]) => window.loadDetail(view, id), [view, id]);
const form = (action, role, userId, fixed = {}) => page.evaluate(([action, role, userId, fixed]) => window.mount({ action, role, userId, fixed, screen: "form" }), [action, role, userId, fixed]);
async function choose(name, option) { await page.getByRole("combobox", { name }).click(); await page.getByRole("option", { name: option }).first().click(); }
async function template(f) {
  const id = (await f.apply({ action: "template.create", scope: "company", instructions: "Stretch film with timber spacers", spacer_required: true, label_fields: ["bundle_number", "order_number", "customer", "profile_code", "pieces", "net_kg", "destination"], note }, i.quality)).request_id;
  await f.apply({ action: "template.approve", id, note }, i.dispatchManager);
  return id;
}

test("every lifecycle record view renders at phone width without errors or overflow", async () => {
  const f = fixture.f;
  const sample = (await f.apply({ action: "sample.require", order_id: i.order2, profile_id: i.profile2, die_id: i.dieA, reason: "new_die", quantity_pieces: 5, authority: "customer", gates_production: true, response_days: 7, note }, i.salesManager)).request_id;
  const tpl = await template(f);
  const promise = (await f.apply({ action: "promise.propose", order_id: i.orderP, tranches: [{ date: day(5), kg: 1000 }, { date: day(10), kg: 1000 }], note }, i.salesManager)).request_id;
  const trace = (await f.apply({ action: "trace.open", node_type: "foundry_billet", node_id: i.billet, note }, i.quality)).request_id;
  const bundle = (await f.apply({ action: "bundle.split", stock_batch_id: i.stock2, outputs: [{ bundle_number: "S2-A", pieces: 8, kg: 57.6 }, { bundle_number: "S2-B", pieces: 12, kg: 86.4 }], note }, i.inventory)).request_id;
  const journey = (await f.apply({ action: "journey.open", order_id: i.orderC, title: "SO-NOV6-C walk-through", participants: "Sales, press, dispatch", baseline_from: day(-30), baseline_to: day(-1), note }, i.factory)).request_id;
  for (const id of [sample, tpl, promise, trace, bundle, journey]) assert.ok(id);
  await as("owner", i.owner);
  for (const [view, id] of [["closure", i.orderC], ["samples", sample], ["templates", tpl], ["labels", i.packed1], ["promises", promise], ["trace", trace], ["bundles", bundle], ["journeys", journey]]) {
    await open(view, id);
    await expect(page.getByText("Current authorized read as of", { exact: false })).toBeVisible();
    await noOverflow();
    if (["closure", "promises", "trace", "journeys"].includes(view)) await page.screenshot({ path: `${evidence}/${view}-record-phone.png`, fullPage: true });
  }
});

test("NOV-058: an order is closed operationally from its readiness review on the phone", async () => {
  await as("sales_manager", i.salesManager); await open("closure", i.orderC);
  await expect(page.getByText(/Invoice INV-NOV6-C has an outstanding balance · does not block/)).toBeVisible();
  await page.getByLabel("Closure").selectOption("operational"); await page.getByLabel(noteLabel).fill(note);
  await review(); await expect(page.getByText(/INR 59000 stays receivable in accounts/)).toBeVisible();
  assert.equal(Number((await fixture.f.db.query("select count(*) n from order_closures")).rows[0].n), 0, "review alone records nothing");
  await page.screenshot({ path: `${evidence}/closure-review-phone.png`, fullPage: true });
  await confirm();
  await expect(page.getByText("Closed operationally", { exact: true })).toBeVisible(); await noOverflow();
  assert.equal((await fixture.f.db.query("select current_stage from orders where id=$1", [i.orderC])).rows[0].current_stage, "closed");
});

test("NOV-079: packing is checked against the template and the bound label really prints", async () => {
  await template(fixture.f);
  await as("dispatch", i.dispatch); await open("labels", i.packed1);
  await expect(page.getByText("Stretch film with timber spacers")).toBeVisible();
  await page.getByLabel("Spacers used").selectOption("false"); await page.getByLabel("Wrapping done").selectOption("true"); await page.getByLabel(noteLabel).fill(note);
  await page.getByRole("button", { name: "Review this action", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "spacers are required" })).toBeVisible();
  await page.getByLabel("Spacers used").selectOption("true"); await review(); await confirm();
  const label = page.locator("#lifecycle-label");
  await expect(label).toContainText("PB-1"); await expect(label).toContainText("Riverside site"); await expect(label).toContainText("Print 1");
  assert.equal(/rate|price|cost|margin/i.test(await label.innerText()), false, "the printed label carries business facts only");
  await page.evaluate(() => { window.printed = 0; window.print = () => { window.printed++; }; });
  await page.getByRole("button", { name: "Print label" }).click();
  assert.equal(await page.evaluate(() => window.printed), 1);
  await page.emulateMedia({ media: "print" });
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#lifecycle-label")).visibility), "visible");
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("h1")).visibility), "hidden", "only the label prints");
  await page.emulateMedia({ media: "screen" });
  await page.screenshot({ path: `${evidence}/label-printed-phone.png`, fullPage: true }); await noOverflow();
});

test("NOV-021: delivery parts are entered on the phone and the server check is shown before acceptance", async () => {
  await form("promise.propose", "sales_manager", i.salesManager);
  await choose("Order", /SO-NOV6-P/);
  await page.getByLabel("Part 1 date").fill(day(5)); await page.getByLabel("Part 1 kg").fill("1000");
  await page.getByRole("button", { name: "Add a delivery part" }).click();
  await page.getByLabel("Part 2 date").fill(day(4)); await page.getByLabel("Part 2 kg").fill("1000"); await page.getByLabel(noteLabel).fill(note);
  await page.getByRole("button", { name: "Review this action", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "must increase" })).toBeVisible();
  await page.getByLabel("Part 2 date").fill(day(10)); await review();
  await expect(page.getByText("Remaining to deliver (kg)")).toBeVisible();
  await page.screenshot({ path: `${evidence}/promise-review-phone.png`, fullPage: true });
  await confirm(); await noOverflow();
  const rows = (await fixture.f.db.query("select verdict,status from delivery_promises")).rows;
  assert.deepEqual(rows, [{ verdict: "feasible", status: "proposed" }]);
  assert.equal(Number((await fixture.f.db.query("select count(*) n from profile_stock_reservations")).rows[0].n), 0, "a proposal reserves nothing");
});

test("NOV-068: a split that loses a piece is refused by the server and corrected without retyping", async () => {
  await form("bundle.split", "inventory_manager", i.inventory);
  await choose("Bundle to split", /^S2 · AL-NOV5/);
  await page.getByLabel("Bundle 1 tag").fill("s2-a"); await page.getByLabel("Pieces").nth(0).fill("8"); await page.getByLabel("Net kg").nth(0).fill("57.6");
  await page.getByLabel("Bundle 2 tag").fill("S2-B"); await page.getByLabel("Pieces").nth(1).fill("11"); await page.getByLabel("Net kg").nth(1).fill("86.4");
  await page.getByLabel(noteLabel).fill(note);
  await page.getByRole("button", { name: "Review this action", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "exactly the 20 pieces" })).toBeVisible();
  await expect(page.getByLabel("Bundle 1 tag")).toHaveValue("s2-a");
  await page.getByLabel("Pieces").nth(1).fill("12"); await review(); await confirm(); await noOverflow();
  assert.deepEqual((await fixture.f.db.query("select bundle_number from profile_stock_batches where bundle_number like 'S2-%' order by 1")).rows.map(r => r.bundle_number), ["S2-A", "S2-B"]);
});

test("shared protocol: a lost commit response resolves from the original request without a duplicate", async () => {
  await choose("Order to walk through", /SO-NOV6-C/);
  await page.getByLabel("Title").fill("SO-NOV6-C walk-through"); await page.getByLabel("People involved").fill("Sales, press and dispatch");
  await page.getByLabel("Baseline from").fill(day(-30)); await page.getByLabel("Baseline to").fill(day(-1)); await page.getByLabel(noteLabel).fill(note);
  await review();
  await page.evaluate(() => { window.lostCommand = "commit"; const button = [...document.querySelectorAll("button")].find(entry => entry.textContent === "Confirm reviewed action"); button.click(); button.click(); });
  await expect(page.getByRole("heading", { name: "Outcome needs checking" })).toBeVisible();
  assert.equal(await page.evaluate(() => window.calls.filter(call => call.command === "commit").length), 1);
  await page.reload(); await expect(page.getByRole("heading", { name: "Outcome needs checking" })).toBeVisible();
  await page.getByRole("button", { name: "Check original request" }).click(); await expect(page.getByRole("heading", { name: "Action confirmed" })).toBeVisible();
  assert.equal(Number((await fixture.f.db.query("select count(*) n from journey_reviews")).rows[0].n), 1);
});

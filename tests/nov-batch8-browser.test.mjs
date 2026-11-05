import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { createNov8BrowserFixture } from "../scripts/lib/nov-batch8-browser-fixture.mjs";
import { nids as i, day } from "../scripts/lib/nov-batch8-fixture.mjs";

let fixture, browser, page, errors;
const evidence = "docs/evidence/NOV_UPGRADES_BATCH_8";
test.before(async () => { fixture = await createNov8BrowserFixture(); browser = await chromium.launch({ headless: true }); mkdirSync(evidence, { recursive: true }); });
test.after(async () => { await browser?.close(); await fixture?.close(); });
test.beforeEach(async () => {
  await fixture.start(); errors = [];
  page = await (await browser.newContext({ viewport: { width: 375, height: 900 }, timezoneId: "Asia/Kolkata" })).newPage();
  page.setDefaultTimeout(15000); page.on("pageerror", error => errors.push(error.message)); await page.goto(fixture.base);
});
test.afterEach(async () => { await page?.context().close(); await fixture.rollback(); assert.deepEqual(errors, []); });
const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
const note = "Reviewed with the responsible department";
const as = (role, userId, patch = {}) => page.evaluate(([role, userId, patch]) => window.mount({ role, userId, ...patch }), [role, userId, patch]);
const open = (view, id) => page.evaluate(([view, id]) => window.loadDetail(view, id), [view, id]);
async function review(scope = page) { await scope.getByRole("button", { name: "Review this action", exact: true }).click(); await expect(page.getByRole("heading", { name: "Review before confirming", exact: true })).toBeVisible(); }
async function confirm() { await page.getByRole("button", { name: "Confirm reviewed action", exact: true }).click(); await expect(page.getByRole("heading", { name: "Action confirmed", exact: true })).toBeVisible(); }
async function choose(name, option) { await page.getByRole("combobox", { name, exact: true }).click(); await page.getByRole("option", { name: option }).first().click(); }
const ist = hours => new Date(Date.now() + hours * 3600000).toISOString().slice(0, 19) + "Z";
const idOf = result => result.result.href.split("/").pop();

test("every execution record view renders at phone width without errors or overflow", async () => {
  const f = fixture.f;
  const appointment = idOf(await f.apply({ action: "appointment.request", order_id: i.order, dispatch_id: i.dispatchPending, requested_start: ist(30), requested_end: ist(34), owner_id: i.dispatch, contact_name: "Site store keeper", contact_phone: "9820011122", note }, i.dispatchManager));
  const pass = idOf(await f.apply({ action: "gatepass.issue", item_kind: "die", die_id: i.dieC, item_label: "DIE-NOV8-C", quantity: 1, custodian_name: "Nitriding House", custodian_kind: "vendor", purpose: "Nitriding cycle 2", due_date: day(4), owner_id: i.productionManager, note }, i.productionManager));
  const policy = idOf(await f.apply({ action: "window.set", horizon_hours: 48, enforce: false, note: "Protect the next two days" }, i.productionManager));
  const change = idOf(await f.apply({ action: "window.request", job_id: i.jobWin1, new_date: day(4), customer_effect: "Delivery moves by three days", note: "Die not ready" }, i.productionManager));
  const limit = idOf(await f.apply({ action: "wip.set_limit", stage: "at_press", unit: "kg", limit_value: 1000, basis: "One shift of press work", note }, i.productionManager));
  const rule = idOf(await f.apply({ action: "rule.set", task_type: "inspection", allowed_roles: ["quality"], competency_id: i.competency, estimate_minutes: 30, note }, i.productionManager));
  const away = idOf(await f.apply({ action: "availability.record", employee_id: i.quality, starts_on: day(0), ends_on: day(2), kind: "leave", note }, i.productionManager));
  const family = idOf(await f.apply({ action: "route.define", code: "stock_sale", name: "Stock sale", applies_when: "Sold from finished stock", required_stages: ["order_confirmed", "packing", "dispatched", "delivered"], note }, i.productionManager));
  const message = idOf(await f.apply({ action: "message.prepare", template: "order_confirmation", entity_id: i.order }, i.sales));
  await f.apply({ action: "loadplan.stop", load_id: i.load1, order_id: i.order, stop_seq: 1, note }, i.dispatchManager);
  await as("owner", i.owner);
  for (const [view, id] of [["appointments", appointment], ["gate_passes", pass], ["loads", i.load1], ["windows", policy], ["windows", change], ["wip", limit], ["assignments", i.taskIns], ["rules", rule], ["rules", away], ["routes", family], ["messages", message]]) {
    await open(view, id);
    await expect(page.getByText("Current authorized read as of", { exact: false })).toBeVisible();
    await noOverflow();
    await page.screenshot({ path: `${evidence}/${view}-record-phone.png`, fullPage: true });
  }
  await open("appointments", appointment);
  await expect(page.getByText("+919820011122")).toBeVisible();
  await expect(page.getByText(/does not release the dispatch or bypass stock, quality, credit or vehicle checks/)).toBeVisible();
  await open("assignments", i.taskIns);
  await expect(page.getByText(/not a performance measure/)).toBeVisible();
  await open("messages", message);
  await expect(page.getByText(/Sending, delivery and reading are not tracked/)).toBeVisible();
  await expect(page.getByLabel("Message text")).toContainText("SO-NOV5-01");
});

test("NOV-075: dispatch requests a slot, reviews it and confirms; the roles without the action see no form", async () => {
  await as("dispatch_manager", i.dispatchManager, { screen: "form", action: "appointment.request" });
  await choose("Order", "SO-NOV5-01");
  await page.getByLabel("Slot starts (IST)").fill(ist(30).slice(0, 16));
  await page.getByLabel("Slot ends (IST)").fill(ist(34).slice(0, 16));
  await choose("Who secures the confirmation", "Fixture dispatch");
  await page.getByLabel("Contact mobile (optional)").fill("98200 11122");
  await page.getByLabel("Reason or supporting evidence").fill(note);
  await review();
  await expect(page.getByText("Plot 14, MIDC Road", { exact: false })).toBeVisible();
  await expect(page.getByText(/becomes an appointment when the site confirms it/)).toBeVisible();
  await page.screenshot({ path: `${evidence}/appointment-review-phone.png`, fullPage: true });
  await confirm();
  assert.equal((await fixture.f.db.query("select status,contact_phone from delivery_appointments")).rows[0].contact_phone, "+919820011122");
  await as("production", i.production, { screen: "form", action: "appointment.request" });
  await expect(page.getByRole("button", { name: "Review this action" })).toHaveCount(0);
  await as("viewer", i.viewer, { screen: "form", action: "appointment.request" });
  await expect(page.getByRole("button", { name: "Review this action" })).toHaveCount(0);
});

test("NOV-077: a partial return is reviewed and confirmed from the pass and the balance updates", async () => {
  const f = fixture.f;
  const pass = idOf(await f.apply({ action: "gatepass.issue", item_kind: "pallet", item_label: "Aluminium pallets", quantity: 10, custodian_name: "Shree Finishers", custodian_kind: "vendor", purpose: "Carrying bundles", due_date: day(5), owner_id: i.inventory, note }, i.inventory));
  await f.apply({ action: "gatepass.depart", id: pass, note }, i.inventory);
  await as("inventory_manager", i.inventory); await open("gate_passes", pass);
  await expect(page.getByText("Outstanding", { exact: true })).toBeVisible();
  const returning = page.locator("details", { hasText: "Record a return" });
  await returning.getByLabel("Quantity returned").fill("4");
  await returning.getByLabel("Condition").selectOption("damaged");
  await returning.getByLabel("Reason or supporting evidence").fill("Four broken pallets counted at the gate");
  await review(returning);
  await expect(page.getByText(/Damaged items stay on record/)).toBeVisible();
  await confirm();
  assert.equal((await f.db.query("select returned_quantity,damaged_quantity from returnable_gate_passes where id=$1", [pass])).rows[0].damaged_quantity, 4);
  await open("gate_passes", pass);
  await expect(page.getByText("Partly returned").first()).toBeVisible();
  await noOverflow();
});

test("NOV-036: a bundle is confirmed on a load by hand and the plan review reports what is still open", async () => {
  const f = fixture.f;
  await as("dispatch_manager", i.dispatchManager); await open("loads", i.load1);
  await expect(page.getByText("Orders without a stop", { exact: true })).toBeVisible();
  const loading = page.locator("details", { hasText: "Record loading of B1" });
  await loading.locator("summary").click();
  await loading.getByLabel("Result").selectOption("loaded");
  await loading.getByLabel("How it was confirmed").selectOption("manual");
  await loading.getByLabel("Reason or supporting evidence").fill("Label damaged; checked against the list");
  await review(loading);
  await expect(page.getByText(/Confirmed by hand: the bundle label was not scanned/)).toBeVisible();
  await confirm();
  assert.equal((await f.db.query("select status,method from load_item_confirmations")).rows[0].method, "manual");
  await page.getByRole("button", { name: "Start another action", exact: true }).click();
  await open("loads", i.load1);
  const departure = page.locator("details", { hasText: "Review this load for departure" });
  if (!(await departure.getAttribute("open") !== null)) await departure.locator("summary").click();
  await departure.getByLabel("Reason or supporting evidence").fill("Checking before the driver arrives");
  await review(departure);
  await expect(page.getByText(/Blocker: .*no unloading stop/).first()).toBeVisible();
  await page.screenshot({ path: `${evidence}/load-review-phone.png`, fullPage: true });
});

test("NOV-014: tasks are selected, reviewed with a line for each, and every identity is reported after confirmation", async () => {
  await as("production_manager", i.productionManager);
  await page.evaluate(() => window.loadQueue());
  await expect(page.getByText("Update selected tasks")).toBeVisible();
  await page.getByLabel("Select Sweep press bay").check();
  await page.getByLabel("Select Update die register").check();
  await expect(page.getByText(/2 task\(s\) selected/)).toBeVisible();
  await page.getByLabel("New priority").selectOption("urgent");
  await page.getByRole("button", { name: "Review the update" }).click();
  await expect(page.getByRole("heading", { name: "Review before confirming", exact: true })).toBeVisible();
  await expect(page.getByText("Sweep press bay").first()).toBeVisible();
  await expect(page.getByText("Update die register").first()).toBeVisible();
  await expect(page.getByText("Will change").first()).toBeVisible();
  await page.screenshot({ path: `${evidence}/queue-review-phone.png`, fullPage: true });
  // One task changes while the review is open: it is reported, not overwritten.
  await fixture.f.db.query("update tasks set updated_at=now() where id=$1", [i.taskPrio2]);
  await page.getByRole("button", { name: "Confirm reviewed action", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Action confirmed", exact: true })).toBeVisible();
  await expect(page.getByText("Outcome for every selected task")).toBeVisible();
  await expect(page.getByText(/Changed since the list was loaded/)).toBeVisible();
  assert.equal((await fixture.f.db.query("select priority from tasks where id=$1", [i.taskPrio])).rows[0].priority, "urgent");
  assert.equal((await fixture.f.db.query("select priority from tasks where id=$1", [i.taskPrio2])).rows[0].priority, "low");
  await page.screenshot({ path: `${evidence}/queue-outcome-phone.png`, fullPage: true });
  await noOverflow();
});

test("NOV-014: the queue refuses an oversized page selection and offers no update to roles that cannot update", async () => {
  await as("production_manager", i.productionManager);
  await page.evaluate(() => window.loadQueue());
  await page.getByLabel("Select every task on this page").check();
  await expect(page.getByText(/10 task\(s\) selected|task\(s\) selected/)).toBeVisible();
  await page.getByRole("button", { name: "Review the update" }).click();
  await expect(page.getByRole("alert")).toContainText("Choose the new priority");
  await page.evaluate(() => window.mount({ role: "viewer", userId: window.ids.viewer }));
  await expect(page.getByText("Update selected tasks")).toHaveCount(0);
});

test("NOV-087: the progress strip scrolls inside its own region on a phone and names missing evidence", async () => {
  const progress = await fixture.f.progress(i.order);
  await as("owner", i.owner, { screen: "strip", progress });
  await expect(page.getByRole("region", { name: "Order progress" })).toBeVisible();
  await expect(page.getByText("Now: Extrusion planned.")).toBeVisible();
  await expect(page.getByText("Evidence unavailable").first()).toBeVisible();
  await expect(page.locator('[aria-current="step"]')).toHaveCount(1);
  await noOverflow();
  await page.screenshot({ path: `${evidence}/progress-strip-phone.png`, fullPage: true });
});

test("NOV-019: a prepared message is recorded as copied through the reviewed action and is never shown as sent", async () => {
  const message = idOf(await fixture.f.apply({ action: "message.prepare", template: "order_confirmation", entity_id: i.order }, i.sales));
  await as("sales", i.sales); await open("messages", message);
  await expect(page.getByText("Prepared, not sent").first()).toBeVisible();
  await expect(page.getByLabel("Reason or supporting evidence")).toHaveCount(0);
  await page.getByLabel("What you did").selectOption("copied");
  await review();
  await expect(page.getByText(/not a record that the customer received it/)).toBeVisible();
  await confirm();
  assert.equal((await fixture.f.db.query("select state from document_communications")).rows[0].state, "copied");
  await open("messages", message);
  await expect(page.getByText("Copied for sending by hand")).toBeVisible();
  await noOverflow();
});

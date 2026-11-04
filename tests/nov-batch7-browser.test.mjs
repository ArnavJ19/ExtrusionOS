import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { createNov7BrowserFixture } from "../scripts/lib/nov-batch7-browser-fixture.mjs";
import { nids as i } from "../scripts/lib/nov-batch7-fixture.mjs";

let fixture, browser, page, errors;
const evidence = "docs/evidence/NOV_UPGRADES_BATCH_7";
test.before(async () => { fixture = await createNov7BrowserFixture(); browser = await chromium.launch({ headless: true }); mkdirSync(evidence, { recursive: true }); });
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
async function review() { await page.getByRole("button", { name: "Review this action", exact: true }).click(); await expect(page.getByRole("heading", { name: "Review before confirming", exact: true })).toBeVisible(); }
async function confirm() { await page.getByRole("button", { name: "Confirm reviewed action", exact: true }).click(); await expect(page.getByRole("heading", { name: "Action confirmed", exact: true })).toBeVisible(); }
async function reset() { await page.getByRole("button", { name: "Start another action", exact: true }).click(); }
async function choose(name, option) { await page.getByRole("combobox", { name, exact: true }).click(); await page.getByRole("option", { name: option }).first().click(); }

test("every improvement record view renders at phone width without errors or overflow", async () => {
  const f = fixture.f;
  const problem = (await f.apply({ action: "problem.open", title: "Drag marks on sliding track", category: "surface", description: "Drag marks after start-up", owner_id: i.quality, note }, i.quality)).request_id;
  await f.apply({ action: "problem.link", id: problem, source_type: "quality_inspection", source_id: i.qiR1, note }, i.quality);
  const suggestion = (await f.apply({ action: "suggestion.submit", category: "repeated_lookup", source_path: "/production/new", description: "Die rack location is not shown when I pick a die" }, i.production)).request_id;
  const threshold = (await f.apply({ action: "threshold.propose", die_type: "hollow", basis: "kg_since_service", service_event: "nitriding", warn_at: 250, rationale: "Hollow dies every 250 kg in trial", note }, i.quality)).request_id;
  await f.apply({ action: "threshold.approve", id: threshold, note }, i.factory);
  const outcome = (await f.command("list", { view: "outcomes", state: "all" }, i.owner)).rows.find(row => row.details.metric_key === "dispatch_on_time").id;
  await as("owner", i.owner);
  for (const [view, id] of [["problems", problem], ["suggestions", suggestion], ["outcomes", outcome], ["dies", i.dieA], ["thresholds", threshold]]) {
    await open(view, id);
    await expect(page.getByText("Current authorized read as of", { exact: false })).toBeVisible();
    await noOverflow();
    await page.screenshot({ path: `${evidence}/${view}-record-phone.png`, fullPage: true });
  }
  await open("dies", i.dieA);
  await expect(page.getByText(/Service check due: 300 kg since the last nitriding/).first()).toBeVisible();
  await expect(page.getByText(/J-NOV7-X cancelled \(not counted\)/)).toBeVisible();
});

test("NOV-059: an employee sends a suggestion from a screen, the owner responds, and the contributor sees the answer", async () => {
  await as("production", i.production, { screen: "form", action: "suggestion.submit", fixed: { source_path: "/dispatches/new" } });
  await expect(page.getByLabel("Reason or supporting evidence")).toHaveCount(0);
  await page.getByLabel("What kind of friction").selectOption("repeated_lookup");
  await page.getByLabel("What happened and what would help").fill("I type the order number again\nfor every bundle on the load");
  await review();
  await expect(page.getByText("/dispatches/new", { exact: true })).toBeVisible();
  await page.screenshot({ path: `${evidence}/suggestion-review-phone.png`, fullPage: true });
  await confirm();
  const id = (await fixture.f.db.query("select id from improvement_suggestions")).rows[0].id;
  await reset();
  await as("owner", i.owner); await open("suggestions", id);
  // A new suggestion opens its response form directly.
  await expect(page.getByLabel("Move to")).toBeVisible();
  const options = await page.getByLabel("Move to").locator("option").allTextContents();
  assert.deepEqual(options.slice(1), ["Acknowledged", "Ask for clarification", "Trial the change", "Adopted", "Declined with reason"], "only transitions from submitted are offered");
  await page.getByLabel("Move to").selectOption("declined");
  await page.getByLabel("Response to the contributor").fill("We will scan bundles instead");
  // The form refuses before any request: a decline needs its reason.
  await page.getByRole("button", { name: "Review this action", exact: true }).click();
  assert.equal(await page.getByLabel("Why it is declined").evaluate(element => element.validity.valueMissing), true, "the decline reason is required before any request");
  await expect(page.getByRole("button", { name: "Confirm reviewed action" })).toHaveCount(0);
  await page.getByLabel("Why it is declined").fill("Scanning bundle tags removes the typing");
  await page.getByLabel("Internal note (process owners only, optional)").fill("Ask stores to print tags for every bundle");
  await review(); await confirm();
  await reset();
  await as("production", i.production); await open("suggestions", id);
  await expect(page.getByText("Scanning bundle tags removes the typing")).toBeVisible();
  await expect(page.getByText(/Ask stores to print tags/)).toHaveCount(0);
  await noOverflow();
});

test("NOV-053: an occurrence is chosen by kind and linked from the phone", async () => {
  const problem = (await fixture.f.apply({ action: "problem.open", title: "Scratched bundles at site", category: "dispatch", description: "Bundles arrive scratched", owner_id: i.dispatchManager, note }, i.quality)).request_id;
  await as("dispatch_manager", i.dispatchManager); await open("problems", problem);
  await expect(page.getByText("No occurrences linked yet.")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Occurrence", exact: true })).toBeDisabled();
  await page.getByLabel("Kind of occurrence").selectOption("delivery_disposition");
  await choose("Occurrence", /Delivery damaged/);
  await page.locator("form", { hasText: "Link an occurrence" }).getByLabel("Reason or supporting evidence").fill(note);
  await review(); await confirm();
  await open("problems", problem);
  await expect(page.getByText(/Refused, damaged or short delivery: Delivery damaged · D-NOV5-1/)).toBeVisible();
  await noOverflow();
});

test("NOV-003: search opens from any screen, ignores typing in fields, discards stale answers and opens with the keyboard", async () => {
  await page.evaluate(() => {
    window.findImpl = async query => {
      if (query === "SO") await new Promise(resolve => setTimeout(resolve, 600));
      const items = query.startsWith("SO-1") ? [{ id: "a", resource: "orders", title: "SO-100", detail: "Kaveri", status: "packing", href: "/orders/a" }, { id: "b", resource: "orders", title: "SO-1001", detail: "Mira", status: "planned", href: "/orders/b" }]
        : [{ id: "z", resource: "orders", title: "STALE", detail: "", status: "", href: "/orders/z" }];
      return { query: query.trim(), items, unavailable: [] };
    };
    window.mount({ screen: "find" });
  });
  await page.getByLabel("Unrelated field").fill("a/b");
  await expect(page.getByRole("dialog", { name: "Find a record" })).toHaveCount(0);
  await page.getByLabel("Unrelated field").blur();
  await page.keyboard.press("/");
  const dialog = page.getByRole("dialog", { name: "Find a record" });
  await expect(dialog).toBeVisible();
  await page.getByRole("combobox", { name: "Find records" }).fill("SO");
  await page.waitForTimeout(300);
  await page.getByRole("combobox", { name: "Find records" }).fill("SO-1");
  await expect(page.getByRole("option", { name: /SO-100 Kaveri/ })).toBeVisible();
  await page.waitForTimeout(700);
  await expect(page.getByText("STALE")).toHaveCount(0);
  await noOverflow();
  await page.screenshot({ path: `${evidence}/global-find-phone.png` });
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option", { name: /SO-1001 Mira/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  assert.deepEqual(await page.evaluate(() => window.navigations), ["/orders/b"]);
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press("Control+k");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Find a record", "focus returns to the trigger");
});

test("NOV-089: the preview is a bottom sheet on phones, closes with Back and reports changed or removed records", async () => {
  const row = { id: i.order, order_number: "SO-NOV5-01", current_stage: "extrusion_planned", billets_required: 10, billets_allocated: 3, updated_at: "2026-11-05T04:00:00Z" };
  await page.evaluate(([row]) => { window.verifyImpl = async () => ({ found: true, updatedAt: "2026-11-05T05:00:00Z" }); window.mount({ screen: "preview", role: "owner", userId: window.ids.owner, open: true, row, verify: true }); }, [row]);
  const dialog = page.getByRole("dialog", { name: /SO-NOV5-01/ });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  assert.ok(Math.abs(box.y + box.height - 900) < 2 && box.width >= 370, "the sheet sits at the bottom across the phone width");
  await expect(page.getByText("Billets not fully allocated: 3 of 10.")).toBeVisible();
  await expect(page.getByText(/changed after the list loaded/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Prepare a dispatch" })).toBeVisible();
  await noOverflow();
  await page.screenshot({ path: `${evidence}/record-preview-phone.png` });
  await page.goBack();
  await expect(dialog).toHaveCount(0);
  await page.evaluate(([row]) => { window.verifyImpl = async () => ({ found: false, updatedAt: null }); window.mount({ open: true, row }); }, [row]);
  await expect(page.getByText(/removed or is no longer available to you/)).toBeVisible();
  await expect(page.getByText("Quick details")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Prepare a dispatch" })).toHaveCount(0);
  await page.getByRole("button", { name: "Close record preview" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("NOV-011: pasted bundles are reviewed, an ambiguous source is chosen, and only checked rows are added", async () => {
  const sources = [{ id: i.jobC1, sourceKind: "production", sourceLabel: "JOB-1", profileId: i.profile, profileLabel: "AL-NOV5", stockBatchId: null, stockBatchLabel: null, availableWeightKg: 500, availablePieces: 50, availableLengthM: 300 },
    { id: i.jobC2, sourceKind: "production", sourceLabel: "JOB-2", profileId: i.profile, profileLabel: "AL-NOV5", stockBatchId: null, stockBatchLabel: null, availableWeightKg: 500, availablePieces: 50, availableLengthM: 300 }];
  await page.evaluate(([sources]) => window.mount({ screen: "paste", sources, existing: ["OLD-1"] }), [sources]);
  await page.getByText("Paste bundles from Excel").click();
  await page.getByLabel("Pasted bundle rows").fill("Bundle\tSource\tPieces\tMetres\tGross kg\tTare kg\nB-1\tJOB-1\t10\t60\t72\t1\nB-2\t\t5\t30\t36\t1\nOLD-1\tJOB-1\t5\t30\t36\t1");
  await page.getByRole("button", { name: "Check pasted rows" }).click();
  await expect(page.getByText("Choose which source this bundle came from")).toBeVisible();
  await expect(page.getByText(/Bundle OLD-1 is already on this load/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add 1 checked row" })).toBeVisible();
  await page.getByLabel("Source for pasted row 3").selectOption(i.jobC2);
  await noOverflow();
  await page.screenshot({ path: `${evidence}/bundle-paste-phone.png`, fullPage: true });
  await page.getByRole("button", { name: "Add 2 checked rows" }).click();
  const added = await page.evaluate(() => window.added);
  assert.deepEqual(added[0].map(row => [row.bundle_number, row.source_line_id]), [["B-1", i.jobC1], ["B-2", i.jobC2]]);
  await expect(page.getByLabel("Pasted bundle rows")).toHaveValue("Bundle\tSource\tPieces\tMetres\tGross kg\tTare kg\nOLD-1\tJOB-1\t5\t30\t36\t1");
});

test("NOV-017: a typed code opens the record's permitted task, and a session lists each label once before recording", async () => {
  await page.evaluate(() => {
    window.scanImpl = async code => code === "BAD" ? { ok: false, error: "This is a link, not an ExtrusionOS label. Links from labels are never opened." }
      : { ok: true, qrId: null, entityType: "inventory_batch", entityTypeLabel: "Inventory Batch", entityId: code === "SB-2" ? "b2" : "b1", label: code, details: { status: "available", qc_status: code === "SB-2" ? "on_hold" : "released", location: "Rack 4" },
        warnings: code === "SB-2" ? [{ tone: "critical", text: "This bundle is on QC hold. Do not load or use it until quality releases it." }] : [], actions: [{ label: "Stock balances", href: "/inventory/stock-balances" }] };
    window.sessionImpl = async () => ({ ok: true, recorded: [{ label: "SB-1", warnings: [] }], refused: [{ code: "SB-2", reason: "SB-2: This bundle is on QC hold." }] });
    window.mount({ screen: "scan", role: "dispatch", userId: window.ids.dispatch });
  });
  const code = page.getByLabel("Type or paste the code");
  await code.fill("BAD"); await page.getByRole("button", { name: "Check code" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /never opened/ })).toBeVisible();
  await code.fill("SB-1"); await page.getByRole("button", { name: "Check code" }).click();
  await expect(page.getByText("Verified Inventory Batch")).toBeVisible();
  await page.getByRole("link", { name: /Stock balances/ }).click();
  assert.deepEqual(await page.evaluate(() => window.navigations), ["/inventory/stock-balances"]);
  await noOverflow();
  await page.screenshot({ path: `${evidence}/scan-result-phone.png`, fullPage: true });
  await page.getByRole("button", { name: "Scan another label" }).click();
  await page.getByLabel("What are you doing?").selectOption("loaded_for_dispatch");
  for (const value of ["SB-1", "SB-2", "SB-1"]) { await code.fill(value); await page.getByRole("button", { name: "Check code" }).click(); await expect(code).toHaveValue(""); }
  await expect(page.getByText(/SB-1 was already scanned at/)).toBeVisible();
  await expect(page.getByText(/Dispatch loading check: 2 label\(s\) scanned/)).toBeVisible();
  await page.getByRole("button", { name: "Review 2 scan(s)" }).click();
  await page.getByRole("button", { name: "Log these scans" }).click();
  await expect(page.getByText("1 scan event(s) logged.")).toBeVisible();
  await expect(page.getByText(/Not logged: SB-2/)).toBeVisible();
  assert.deepEqual(await page.evaluate(() => window.sessions), [{ task: "loaded_for_dispatch", codes: ["SB-1", "SB-2"] }]);
  await noOverflow();
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { createNovBrowserFixture } from "../scripts/lib/nov-upgrades-browser-fixture.mjs";

let fixture, browser, page, errors;
const evidence = "docs/evidence/NOV_UPGRADES_BATCH_1";
test.before(async () => { fixture = await createNovBrowserFixture(); browser = await chromium.launch({ headless: true }); mkdirSync(evidence, { recursive: true }); });
test.after(async () => { await browser?.close(); await fixture?.close(); });
test.beforeEach(async () => { errors = []; page = await browser.newPage({ viewport: { width: 375, height: 900 }, timezoneId: "Asia/Kolkata" }); page.setDefaultTimeout(15000); page.on("pageerror", (error) => errors.push(error.message)); });
test.afterEach(async () => { await page?.close(); assert.deepEqual(errors, []); });
const open = (query = "") => page.goto(`${fixture.base}/?${query}`);
const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

test("NOV-086/088/093: actual phone database shows ten selective cards with unambiguous zero, missing and blocked states", async () => {
  await open("screen=database&module=orders");
  await expect(page.getByRole("button", { name: "O-001", exact: true })).toBeVisible();
  const cards = page.locator("article");
  await expect(cards).toHaveCount(10);
  const first = cards.first();
  await expect(first.getByText("Not captured", { exact: true })).toBeVisible();
  await expect(first.getByText("Order Value", { exact: true })).not.toBeVisible();
  await first.locator("summary").filter({ hasText: "More details" }).click();
  await expect(first.getByText("Order Value", { exact: true })).toBeVisible();
  await expect(first.getByText("0", { exact: true })).toBeVisible();
  await expect(first.getByText("\u20b91,23,456.78", { exact: true })).toBeVisible();
  await expect(first.locator('[data-status="packing"]')).toHaveCount(1);
  await noOverflow();
  await first.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${evidence}/database-phone.png` });
});

test("NOV-088: disclosure and nested controls do not open the record, with keyboard navigation on desktop", async () => {
  await open("screen=table");
  await page.getByText("More details", { exact: false }).click();
  await page.getByRole("button", { name: "Nested action", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.navigations), []);
  await page.getByRole("button", { name: "ROW-1", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.navigations), ["record"]);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Nested action", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.navigations), ["record"]);
  await page.getByRole("link", { name: "Open record ROW-1", exact: true }).focus();
  await page.keyboard.press("Enter");
  assert.deepEqual(await page.evaluate(() => window.navigations), ["record", "record"]);
});

test("NOV-091: filter removal resets page, keeps other filters, and Clear all recovers a matched empty view", async () => {
  await open("screen=database&module=orders&status=packing&secondary=normal&page=2");
  await expect(page.getByRole("button", { name: "O-011", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove Priority: Normal", exact: true }).click();
  await expect(page.getByRole("button", { name: "O-001", exact: true })).toBeVisible();
  assert.equal(new URL(page.url()).searchParams.get("page"), null);
  assert.equal(new URL(page.url()).searchParams.get("status"), "packing");
  await page.getByRole("textbox", { name: "Search database", exact: true }).fill("none");
  await expect(page.getByText("No matching records", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search database", exact: true })).toHaveValue("none");
  await page.getByRole("button", { name: "Clear all filters", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "O-001", exact: true })).toBeVisible();
  assert.equal(new URL(page.url()).searchParams.get("status"), null);
});

test("NOV-091/099: stale responses cannot replace a newer search and a failed refresh retains successful rows", async () => {
  await open("screen=database&module=orders");
  const search = page.getByRole("textbox", { name: "Search database", exact: true });
  await expect(page.getByRole("button", { name: "O-001", exact: true })).toBeVisible();
  await search.fill("old");
  await expect.poll(() => page.evaluate(() => window.rpcCalls.some((call) => call.p.p_search === "old"))).toBe(true);
  await search.fill("new");
  await expect(page.getByRole("button", { name: "NEW-O-001", exact: true })).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.getByRole("button", { name: "OLD-O-001", exact: true })).toHaveCount(0);
  await page.evaluate(() => { window.rpcMode = "failed"; });
  await page.getByRole("button", { name: "Refresh page", exact: true }).click();
  await expect(page.getByText("Some information is unavailable", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "NEW-O-001", exact: true })).toBeVisible();
  await expect(search).toHaveValue("new");
  await expect(page.locator("body")).not.toContainText("SQL SECRET");
  await page.evaluate(() => { window.rpcMode = "normal"; });
  await page.getByRole("button", { name: "Retry refresh", exact: true }).click();
  await expect(page.getByText("Some information is unavailable", { exact: true })).toHaveCount(0);
});

test("NOV-099: denied reads remove cached rows and do not masquerade as an empty database", async () => {
  await open("screen=database&module=orders");
  await expect(page.getByRole("button", { name: "O-001", exact: true })).toBeVisible();
  await page.evaluate(() => { window.rpcMode = "denied"; });
  await page.getByRole("button", { name: "Refresh page", exact: true }).click();
  await expect(page.getByText("Access unavailable", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "O-001", exact: true })).toHaveCount(0);
  await expect(page.getByText("No orders yet", { exact: true })).toHaveCount(0);
});

test("NOV-092: similar names expose identifying context and keyboard selection skips inactive choices", async () => {
  await open("screen=selector");
  const selector = page.getByRole("combobox", { name: "Customer", exact: true });
  await selector.focus();
  await expect(selector).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("option").filter({ hasText: "Mumbai" })).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator("#chosen")).toHaveText("pune");
  await expect(page.getByText("Similar Aluminium | Pune | 9123456780", { exact: true })).toBeVisible();
  await selector.fill("Delhi");
  await expect(page.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator("#chosen")).toHaveText("delhi");
  await page.setViewportSize({ width: 320, height: 900 });
  await noOverflow();
  await page.screenshot({ path: `${evidence}/selector-phone.png`, fullPage: true });
});

test("NOV-092/099: failed lookup retains the selection, blocks choice and supports recovery", async () => {
  await open("screen=selector");
  await page.evaluate(() => window.setSelected("delhi"));
  const selector = page.getByRole("combobox", { name: "Customer", exact: true });
  await selector.focus();
  await page.evaluate(() => window.failLookup());
  await expect(page.getByText(/Lookup unavailable. Your selection is retained/)).toBeVisible();
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
  await expect(page.locator("#chosen")).toHaveText("delhi");
  await page.getByRole("button", { name: "Retry lookup", exact: true }).click();
  await expect(page.getByRole("option")).toHaveCount(3);
  await page.evaluate(() => window.setSelected("missing-reference"));
  await expect(page.getByText(/Selected record details unavailable/)).toBeVisible();
});

test("NOV-083/084/085: real edit form keeps identity and values, uses one save, and does not cover the final field", async () => {
  await open("screen=form&module=customers");
  const identity = page.getByRole("region", { name: "Current record", exact: true });
  await expect(identity).toContainText("Synthetic aluminium customer 1");
  await page.getByRole("textbox", { name: /Customer name/ }).fill("Edited factory contact");
  const notes = page.getByRole("textbox", { name: "Notes", exact: true });
  await notes.fill("My retained unsaved entries");
  await notes.focus();
  await expect(notes).toHaveValue("My retained unsaved entries");
  const bar = page.getByRole("group", { name: "Form actions", exact: true });
  await expect(bar).toBeVisible();
  const focused = await notes.boundingBox(); const actionBox = await bar.boundingBox();
  assert.ok(focused.y + focused.height <= actionBox.y || focused.y >= actionBox.y + actionBox.height, "The action bar must not cover the focused field");
  await noOverflow();
  const identityBox = await identity.boundingBox();
  assert.ok(identityBox.y >= 80 && identityBox.y < 450, "Record identity remains below application navigation while editing");
  await page.screenshot({ path: `${evidence}/form-phone.png` });
  await page.evaluate(() => { const button = [...document.querySelectorAll("button")].find((item) => item.textContent === "Update record"); button.click(); button.click(); });
  await expect.poll(() => page.evaluate(() => window.writes.length)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.navigations.length)).toBe(1);
  assert.equal(await page.evaluate(() => window.writes[0].write.notes), "My retained unsaved entries");
});

test("NOV-084: switching records or company cannot retain the previous record identity or unsaved text", async () => {
  await open("screen=form&module=customers");
  await expect(page.getByRole("region", { name: "Current record", exact: true })).toContainText("Synthetic aluminium customer 1");
  await page.getByRole("textbox", { name: /Customer name/ }).fill("Unsaved for first record");
  await page.evaluate(() => window.mount({ recordId: "10000000-0000-4000-8000-000000000002" }));
  await expect(page.getByRole("region", { name: "Current record", exact: true })).toContainText("Synthetic aluminium customer 2");
  await expect(page.getByRole("textbox", { name: /Customer name/ })).toHaveValue("Factory Contact 2");
  await page.evaluate(() => window.mount({ companyId: "10000000-0000-4000-8000-000000000200", recordId: undefined }));
  await expect(page.getByRole("region", { name: "Current record", exact: true })).toContainText("unsaved entries");
  await expect(page.getByRole("textbox", { name: /Customer name/ })).toHaveValue("");
});

test("NOV-085: a lost save response prevents blind duplicate submission and retains entered values", async () => {
  await open("screen=form&module=customers");
  await expect(page.getByRole("button", { name: "Update record", exact: true })).toBeVisible();
  await page.evaluate(() => { window.uncertainSave = true; });
  await page.getByRole("button", { name: "Update record", exact: true }).click();
  await expect(page.getByText(/Save outcome uncertain. Check the database/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Update record", exact: true })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Check saved records", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Check saved records", exact: true })).toHaveAttribute("target", "_blank");
  assert.equal(await page.evaluate(() => window.writes.length), 1);
  await expect(page.getByRole("textbox", { name: /Customer name/ })).toHaveValue("Factory Contact 1");
});

test("NOV-016: blockers name a responsible team, hide forbidden edits and disappear after authoritative refresh", async () => {
  await open("screen=readiness&role=viewer");
  await expect(page.getByText(/Team: Technical and quality/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Open profile", exact: true })).toBeVisible();
  await page.evaluate(() => { window.readiness = { ...window.readiness, start_issues: [] }; });
  await page.getByRole("button", { name: "Refresh readiness", exact: true }).click();
  await expect(page.getByText("Approved drawing evidence is missing", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Ready to start", { exact: true })).toBeVisible();
  await page.evaluate(() => { window.readinessFailure = true; });
  await page.getByRole("button", { name: "Refresh readiness", exact: true }).click();
  await expect(page.getByText("Readiness unavailable - last successful check shown", { exact: true })).toBeVisible();
  await expect(page.getByText("Ready to start", { exact: true })).toHaveCount(0);
});

test("NOV-083: sales, stores, production and accounts use the shared composition at phone and enlarged desktop widths", async () => {
  for (const moduleKey of ["customers", "inventory", "production", "invoices"]) {
    await open(`screen=database&module=${moduleKey}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("textbox", { name: "Search database", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Back to/ })).toHaveAttribute("href", `/${moduleKey}`);
    await noOverflow();
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "24px"; });
  await expect(page.getByRole("textbox", { name: "Search database", exact: true })).toBeVisible();
  await noOverflow();
  await page.screenshot({ path: `${evidence}/database-desktop-enlarged.png`, fullPage: true });
});

test("NOV-088/091: hidden table columns cannot hide workflow warnings, and saved-view reset differs from clearing filters", async () => {
  await page.addInitScript(() => {
    const id = (n) => "10000000-0000-4000-8000-" + String(n).padStart(12, "0");
    const state = { search: "", status: "packing", secondary: "", dateFrom: "", dateTo: "", page: 1, sort: "expected_dispatch_date", direction: "asc", relationFilters: {} };
    localStorage.setItem(`extrusionos:workspace:v1:${id(100)}:${id(101)}`, JSON.stringify({ pinned: [], recent: [], columns: { orders: { order: [], hidden: ["current_stage", "billet_allocation_status"], widths: {} } }, views: [{ href: "/orders/database?status=packing", label: "Packing", moduleKey: "orders", updatedAt: 1, state }] }));
  });
  await page.goto(`${fixture.base}/orders/database?status=packing`);
  await expect(page.locator("article").first().locator('[data-status="packing"]')).toBeVisible();
  await expect(page.locator("article").first().locator('[data-status="partially_allocated"]')).toBeVisible();
  await page.getByRole("button", { name: "Clear all filters", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove Current Stage: packing", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Reset to saved view", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove Current Stage: packing", exact: true })).toBeVisible();
  await page.evaluate(() => { history.pushState(null, "", "/orders/database?status=packing&page=2"); dispatchEvent(new PopStateEvent("popstate")); });
  await expect(page.getByRole("button", { name: "O-011", exact: true })).toBeVisible();
  assert.equal(new URL(page.url()).searchParams.get("page"), "2");
});

test("NOV-099/084: failed connected reads keep the authorized record visible and never show a false zero", async () => {
  await open("screen=table");
  await page.evaluate(() => { window.relatedFail = true; window.mount({ screen: "detail", module: "customers" }); });
  await expect(page.getByRole("heading", { level: 1, name: "Synthetic aluminium customer 1" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Current record", exact: true })).toContainText("Synthetic aluminium customer 1");
  await expect(page.getByText(/Some connected counts could not be loaded/)).toBeVisible();
  await expect(page.getByText("Unavailable", { exact: true }).first()).toBeVisible();
  await page.evaluate(() => { window.relatedFail = false; });
  await page.getByRole("button", { name: "Retry connected reads", exact: true }).click();
  await expect(page.getByText(/Some connected counts could not be loaded/)).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Synthetic aluminium customer 1" })).toBeVisible();
});

test("NOV-084/093: record context keeps a missing source quantity explicit rather than displaying zero", async () => {
  await open("screen=detail&module=production");
  const identity = page.getByRole("region", { name: "Current record", exact: true });
  await expect(identity).toContainText("JOB-1");
  await expect(identity).toContainText("Not captured");
  await expect(identity).not.toContainText("0.000 kg");
});

test("NOV-088: the separate die database keeps status, profile and retrieval location in its compact phone card", async () => {
  await open("screen=die-database");
  const card = page.locator("article").first();
  await expect(card.getByRole("button", { name: "D-1", exact: true })).toBeVisible();
  await expect(card.locator('[data-status="blocked"]')).toBeVisible();
  await expect(card.getByText(/AL-101/)).toBeVisible();
  await expect(card.getByText("Rack 8", { exact: true })).toBeVisible();
  await expect(card.getByText("Production", { exact: true })).not.toBeVisible();
  await card.locator("summary").filter({ hasText: "More details" }).click();
  await expect(card.getByText("Not captured", { exact: true }).last()).toBeVisible();
  await noOverflow();
  assert.deepEqual(await page.evaluate(() => window.fromCalls.find((call) => call.table === "dies").range), [0, 9]);
});

test("NOV-099: a failed form read can be retried repeatedly and recovers to the same record", async () => {
  await open("screen=table");
  await page.evaluate(() => { window.formReadFailure = true; window.mount({ screen: "form", module: "customers" }); });
  await expect(page.getByRole("alert")).toContainText("Customer source unavailable");
  const before = await page.evaluate(() => window.fromCalls.length);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Customer source unavailable");
  await expect.poll(() => page.evaluate(() => window.fromCalls.length)).toBeGreaterThan(before);
  await page.evaluate(() => { window.formReadFailure = false; });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /Customer name/ })).toHaveValue("Factory Contact 1");
  await expect(page.getByRole("region", { name: "Current record", exact: true })).toContainText("Synthetic aluminium customer 1");
  await expect(page.getByRole("button", { name: "Update record", exact: true })).toBeEnabled();
});

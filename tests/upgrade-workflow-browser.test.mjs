import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { buildWorkflowBrowserBundle } from "../scripts/lib/workflow-browser-bundle.mjs";
import { workflowIds as ids } from "../scripts/lib/upgrade-workflow-actions-fixture.mjs";

let browser, page, script, errors;
test.before(async () => { script = await buildWorkflowBrowserBundle(); const executablePath = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync); browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) }); });
test.beforeEach(async () => { page = await browser.newPage(); page.setDefaultTimeout(5000); errors = []; page.on("pageerror", (error) => errors.push(error.message)); await page.setContent('<main id="app"></main><div id="fixture-message" role="status"></div>'); await page.evaluate(() => { window.process = { env: { NODE_ENV: "test", __NEXT_IMAGE_OPTS: { deviceSizes: [], imageSizes: [], path: "/_next/image", loader: "default", remotePatterns: [], unoptimized: true } } }; Object.defineProperty(window, "crypto", { configurable: true, value: { randomUUID: () => "00000000-0000-4000-8000-000000008888" } }); }); await page.addScriptTag({ content: script }); });
test.afterEach(async () => { await page.close(); assert.deepEqual(errors, []); }); test.after(async () => browser.close());
const screen = async (name) => { await page.evaluate((name) => window.renderWorkflow(name), name); };
const noWrites = async () => assert.deepEqual(await page.evaluate(() => [window.fixture.quoteWrites, window.fixture.dispatchWrites]), [[], []]);

test("instant search updates without submit and offers an exact preselected source action", async () => {
  await page.getByRole("textbox", { name: "Find records" }).fill("ORD");
  const action = page.getByRole("link", { name: "Check dispatch readiness", exact: true }); await expect(action).toBeVisible(); assert.equal(await action.getAttribute("href"), `/dispatches/new?order_id=${ids.order}`); await noWrites();
  await page.getByRole("textbox", { name: "Find records" }).fill("x"); await expect(action).toHaveCount(0);
});
test("late instant results cannot replace a newer query; failed resources are not empty evidence", async () => {
  await page.evaluate(() => { window.fixture.findHandler = (query) => new Promise((resolve) => { (window.fixture.pendingFind ??= {})[query] = resolve; }); });
  const input = page.getByRole("textbox", { name: "Find records" }); await input.fill("Older"); await page.waitForFunction(() => window.fixture.pendingFind?.Older); await input.fill("Newer"); await page.waitForFunction(() => window.fixture.pendingFind?.Newer);
  await page.evaluate(() => { window.fixture.pendingFind.Newer({ query: "Newer", items: [], unavailable: ["orders"] }); window.fixture.pendingFind.Older({ query: "Older", items: [{ id: "old", resource: "orders", title: "OLD RECORD", detail: "", status: "packing", href: "/orders/old" }], unavailable: [] }); });
  await expect(page.getByRole("alert")).toContainText("not verified empty"); await expect(page.getByText("OLD RECORD")).toHaveCount(0); await noWrites();
});
test("repeated quotation keeps structural lines and requires renewed commercial review after edits", async () => {
  await screen("repeat"); await expect(page.getByRole("region", { name: "Review repeated quotation" })).toBeVisible();
  await expect(page.getByText(/source quotation has expired/)).toBeVisible(); await expect(page.getByLabel("Qty pcs", { exact: true })).toHaveValue("10"); await expect(page.getByLabel("Kg/m", { exact: true })).toHaveValue("0.8"); await expect(page.getByLabel("Die charge", { exact: true })).toHaveValue("0"); await noWrites();
  await page.getByRole("button", { name: "Save quote", exact: true }).click(); assert.equal(await page.evaluate(() => window.fixture.quoteWrites.length), 0);
  const review = page.getByRole("checkbox", { name: /reviewed the copied rates/ }); await review.check(); await page.getByLabel("Qty pcs", { exact: true }).fill("12"); await expect(review).not.toBeChecked();
  await review.check(); await page.getByRole("button", { name: "Save quote", exact: true }).click(); await page.waitForFunction(() => window.fixture.quoteWrites.length === 1);
  const saved = await page.evaluate(() => window.fixture.quoteWrites[0]); assert.equal(saved.editing_id, null); assert.equal(saved.status, "draft"); assert.equal(saved.items[0].quantity_pieces, 12); assert.equal("quote_id" in saved.items[0], false);
});
test("a failed repeat never falls back to a partially copied editable draft", async () => {
  await page.evaluate(() => { window.fixture.repeatHandler = async () => ({ success: false, error: "Source no longer available" }); }); await screen("repeat"); await expect(page.getByRole("alert")).toHaveText("Source no longer available"); await expect(page.getByRole("button", { name: "Save quote", exact: true })).toHaveCount(0); await noWrites();
});
test("contextual quotation guidance is available by keyboard and states units and save semantics", async () => {
  await screen("repeat"); const help = page.getByText("Quotation entry help: units, margin, and saving", { exact: true }); await help.press("Enter"); await expect(page.getByText(/kg\/m is the section weight/)).toBeVisible(); await expect(page.getByText(/Save quote records a draft/)).toBeVisible(); await noWrites();
});
test("stage history is fetched on demand and missing entry is not shown as zero waiting", async () => {
  await screen("stage"); assert.equal(await page.evaluate(() => window.fixture.stageQueries.length), 0); await page.getByText("Time in current order stage", { exact: true }).click(); await expect(page.getByText("Stage entry not recorded", { exact: true })).toBeVisible(); await expect(page.getByText(/2 d 1 h/)).toBeVisible(); await expect(page.getByText("Dispatch due: Not recorded", { exact: true })).toBeVisible(); await noWrites();
});

async function fillDispatch() {
  await screen("dispatch"); await expect(page.getByPlaceholder("Search order or customer PO")).toHaveValue(/ORD-100/);
  await page.getByPlaceholder("Select production job or stock batch").click(); await page.getByRole("button", { name: /AL-101 Window section.*JOB-100/ }).click();
  for (const [name, value] of [["Scan / Bundle ID *", "BUNDLE-1"], ["Actual pieces *", "10"], ["Actual metres *", "60"], ["Gross kg *", "110"], ["Tare kg *", "10"]]) await page.getByLabel(name, { exact: true }).fill(value);
}
test("linked dispatch opens on its verified order and the review lists bundles, totals and source balance", async () => {
  await fillDispatch(); await page.getByRole("button", { name: "Review dispatch", exact: true }).click(); const dialog = page.getByRole("dialog", { name: "Review physical dispatch" }); await expect(dialog).toBeVisible(); await expect(dialog.getByText("BUNDLE-1", { exact: true })).toBeVisible(); await expect(dialog.getByRole("region", { name: "Source balances after proposed load" })).toContainText("900"); await noWrites(); assert.equal(await page.evaluate(() => window.fixture.sourceQueries.length), 2);
  await dialog.getByRole("button", { name: "Back to editing" }).click(); await expect(page.getByLabel("Gross kg *", { exact: true })).toHaveValue("110"); await noWrites();
});

test("dispatch review shows remaining order demand separately from selected source availability", async () => {
  await fillDispatch(); await page.getByRole("button", { name: "Review dispatch", exact: true }).click();
  const balance = page.getByRole("region", { name: "Order balance after proposed load" });
  await expect(balance).toContainText("90 pcs / 540.000 m");
  await expect(balance).toContainText("Previously dispatched: 20 pcs / 120.000 m");
  await noWrites();
});

test("a changed shipped balance at confirmation refreshes review and requires another confirmation", async () => {
  await fillDispatch(); await page.getByRole("button", { name: "Review dispatch", exact: true }).click();
  await page.evaluate(() => { window.fixture.balanceHandler = async (orderId) => ({ success: true, balance: { orderId, orderLabel: "ORD-100 - Mira Aluminium Window Systems", ordered: { pieces: 120, metres: 720 }, shipped: { pieces: 30, metres: 180 } } }); });
  await page.getByRole("button", { name: "Confirm dispatch and consume stock", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("quantities changed");
  await expect(page.getByRole("region", { name: "Order balance after proposed load" })).toContainText("80 pcs / 480.000 m");
  await noWrites();
  await page.getByRole("button", { name: "Confirm dispatch and consume stock", exact: true }).click();
  await page.waitForFunction(() => window.fixture.dispatchWrites.length === 1);
});

test("unavailable order demand cannot be presented as a verified zero balance", async () => {
  await fillDispatch(); await page.evaluate(() => { window.fixture.balanceHandler = async () => ({ success: false, error: "Order quantities are unavailable" }); });
  await page.getByRole("button", { name: "Review dispatch", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Order quantities are unavailable");
  await expect(page.getByRole("dialog")).toHaveCount(0); await noWrites();
});
test("a stale preview is rejected before confirmation when the new source check has less material", async () => {
  await fillDispatch(); await page.evaluate(() => { window.fixture.sourceHandler = async () => ({ success: true, sources: [] }); }); await page.getByRole("button", { name: "Review dispatch", exact: true }).click(); await expect(page.getByRole("alert")).toBeVisible(); await expect(page.getByRole("dialog")).toHaveCount(0); await expect(page.getByLabel("Gross kg *", { exact: true })).toHaveValue("110"); await noWrites();
});
test("only explicit dispatch confirmation posts; server rejection retains the entered manifest", async () => {
  await fillDispatch(); await page.getByRole("button", { name: "Review dispatch", exact: true }).click(); await noWrites(); await page.evaluate(() => { window.fixture.dispatchHandler = async () => ({ success: false, error: "Material was reserved after preview" }); }); await page.getByRole("button", { name: "Confirm dispatch and consume stock", exact: true }).click(); await expect(page.getByRole("alert")).toContainText("reserved after preview"); assert.equal(await page.evaluate(() => window.fixture.dispatchWrites.length), 1); await expect(page.getByLabel("Scan / Bundle ID *", { exact: true })).toHaveValue("BUNDLE-1"); await expect(page.getByRole("dialog")).toHaveCount(0);
});

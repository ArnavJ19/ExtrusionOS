import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { createOperatorBrowserFixture } from "../scripts/lib/operator-browser-fixture.mjs";
import { workflowIds as ids, workflowId as id } from "../scripts/lib/operator-workflow-fixture.mjs";
let f, browser, page, errors;
test.before(async () => { f = await createOperatorBrowserFixture(); const executablePath = process.env.CHROME_PATH ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync); browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) }); });
test.beforeEach(async () => { await f.reset(); page = await browser.newPage(); page.setDefaultTimeout(7000); errors = []; page.on("pageerror", error => errors.push(error.message)); });
test.afterEach(async () => { await page.close(); assert.deepEqual(errors, []); });
test.after(async () => { await browser?.close(); await f?.close(); });

test("the actual customer code form saves one mapping through the real action and retains deactivated history", async () => {
  await page.goto(`${f.base}/customer`);
  await page.getByText("Add a customer profile code", { exact: true }).click();
  await page.getByLabel("Customer code or alias", { exact: true }).fill("Old local section 45"); await page.getByLabel("Exact canonical profile code", { exact: true }).fill("AL-101");
  await page.getByRole("button", { name: "Save customer code", exact: true }).click();
  await expect(page.getByText("Old local section 45 → AL-101", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Deactivate code", exact: true }).click();
  await expect(page.getByText("Deactivated; retained in history", { exact: false })).toBeVisible();
  assert.equal((await f.db.query("select count(*)::int n from customer_profile_aliases")).rows[0].n, 1);
});

test("actual quotation alias selection requires clarification and populates current canonical profile weight without saving", async () => {
  await f.seedQuoteAliases(); await page.goto(`${f.base}/quote`);
  await page.getByPlaceholder("Select customer", { exact: true }).click();
  await page.getByRole("button", { name: /Mira Aluminium Window Systems/ }).click();
  const line = page.locator("[data-quote-line]").first();
  await line.getByText("Find a customer code", { exact: true }).click();
  await line.getByLabel("Exact customer profile code or alias", { exact: true }).fill("Customer 45");
  await line.getByRole("button", { name: "Check customer code", exact: true }).click();
  await expect(line.getByText("This code has multiple matches.", { exact: false })).toBeVisible();
  await line.getByRole("button", { name: "Customer 45 → AL-202 · Door section", exact: true }).click();
  await expect(line.getByRole("textbox", { name: "Search aluminium profile by code or name", exact: true })).toHaveValue(/AL-202/);
  await expect(line.getByLabel("Kg/m", { exact: true })).toHaveValue("1.2");
  assert.deepEqual(await page.evaluate(() => window.entryFixture.posts), []);
});

test("actual location move updates retrieval guidance and keeps the original location and stock quantity", async () => {
  await page.goto(`${f.base}/inventory`);
  await expect(page.getByText("Shed B / Rack 4", { exact: true })).toBeVisible();
  await page.getByText("Record a location move", { exact: true }).click();
  await page.getByLabel("New physical location", { exact: true }).fill("Shed C / Rack 04 / Level 2"); await page.getByLabel("Reason for move", { exact: true }).fill("Move close to packing");
  await page.getByRole("button", { name: "Confirm location move", exact: true }).click();
  await expect(page.getByText("Shed B / Rack 4 → Shed C / Rack 04 / Level 2", { exact: true })).toBeVisible();
  assert.equal((await f.db.query("select current_stock from inventory_items where id=$1", [ids.item])).rows[0].current_stock, "420");
});

test("actual exception reporting preserves an uncertain request and retries without a second observation", async () => {
  await page.goto(`${f.base}/production`); await page.getByText("Record an exception", { exact: true }).click();
  await page.getByLabel("Exception note (optional)", { exact: true }).fill("Material absent from the recorded rack");
  f.controls.loseNextWrite = true; await page.getByRole("button", { name: "Record exception", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry the same request", exact: true })).toBeVisible();
  await expect(page.getByLabel("Exception reason", { exact: true })).toBeDisabled();
  assert.equal((await f.db.query("select count(*)::int n from production_exceptions")).rows[0].n, 1);
  await page.getByRole("button", { name: "Retry the same request", exact: true }).click();
  await expect(page.getByText("Material absent from the recorded rack", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Exception note (optional)", { exact: true })).toHaveValue("");
  assert.equal((await f.db.query("select count(*)::int n from production_exceptions")).rows[0].n, 1);
  assert.equal((await f.db.query("select status from production_jobs where id=$1", [ids.job])).rows[0].status, "in_progress");
});

test("the actual commitment form preserves the first deadline and reschedule reason before recording a completion outcome", async () => {
  await page.goto(`${f.base}/customer`); await page.getByText("Record a customer promise", { exact: true }).click();
  await page.getByLabel("Promised action", { exact: true }).fill("Send revised sample"); await page.getByLabel("Promised date", { exact: true }).fill("2026-10-23");
  await page.getByRole("button", { name: "Record customer promise", exact: true }).click();
  await expect(page.getByText("Send revised sample", { exact: true })).toBeVisible();
  await page.getByText("Reschedule or close commitment", { exact: true }).click(); await page.getByLabel("Revised due date", { exact: true }).fill("2026-10-25"); await page.getByLabel("Reason for rescheduling", { exact: true }).fill("Customer requested a trial first");
  await page.getByRole("button", { name: "Confirm reschedule", exact: true }).click();
  await expect(page.getByText("Original promised date: 2026-10-23", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show change history", exact: true }).click();
  await expect(page.getByText("Customer requested a trial first", { exact: true })).toBeVisible();
  await page.getByText("Reschedule or close commitment", { exact: true }).click(); await page.getByLabel("Commitment action", { exact: true }).selectOption("completed"); await page.getByLabel("Commitment outcome", { exact: true }).fill("Sample delivered and acknowledged");
  await page.getByRole("button", { name: "Record completion", exact: true }).click(); await page.getByLabel("Commitment status", { exact: true }).selectOption("completed");
  await expect(page.getByText("Outcome: Sample delivered and acknowledged", { exact: true })).toBeVisible();
});

test("notification source resolution updates in place while personal read receipts remain separate", async () => {
  await page.goto(`${f.base}/notifications`);
  await expect(page.getByRole("link", { name: "Open source record", exact: true })).toHaveAttribute("href", /\/invoices\//);
  await page.getByRole("button", { name: "Mark as read", exact: true }).click();
  f.controls.settledInvoice = true; await page.getByRole("button", { name: "Refresh screen", exact: true }).click();
  await expect(page.getByText("Resolved in source", { exact: true })).toBeVisible();
  await expect(page.getByText("Recorded overdue invoice alert", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark as read", exact: true })).toHaveCount(0);
});

test("missing migration is explicit and a read-only role sees no write forms", async () => {
  f.controls.unavailable = true; await page.goto(`${f.base}/production`);
  await expect(page.getByRole("alert")).toContainText("not available on this database yet");
  await page.getByText("Record an exception", { exact: true }).click(); await expect(page.getByRole("button", { name: "Record exception", exact: true })).toBeDisabled();
  f.controls.unavailable = false; await page.goto(`${f.base}/customer?role=viewer`);
  await expect(page.getByRole("heading", { name: "Customer commitments", exact: true })).toBeVisible();
  await expect(page.getByText("Record a customer promise", { exact: true })).toHaveCount(0); await expect(page.getByText("Add a customer profile code", { exact: true })).toHaveCount(0);
});

test("actual source styles keep long phone locations and exception notes within the document", async () => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${f.base}/inventory`); await page.getByText("Record a location move", { exact: true }).click();
  await page.getByLabel("New physical location", { exact: true }).fill("Shed B / " + "RackReference".repeat(10)); await page.getByLabel("Reason for move", { exact: true }).fill("Phone picking check"); await page.getByRole("button", { name: "Confirm location move", exact: true }).click();
  await expect(page.getByText("Phone picking check", { exact: true })).toBeVisible();
  const widths = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth })); assert.ok(widths.scroll <= widths.width + 1, JSON.stringify(widths));
});

test("the actual personal queue paginates, searches and opens the exact later promise", async () => {
  for (let n = 0; n < 23; n++) await f.command("commitments.create", { customer_id: ids.customer, title: `Follow up sample ${String(n).padStart(2, "0")}`, due_date: "2026-10-23", request_id: id(2000 + n) });
  await page.goto(`${f.base}/tasks/commitments`);
  await expect(page.getByText("Follow up sample 00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Follow up sample 10", { exact: true })).toBeVisible();
  await page.getByLabel("Search promise or customer", { exact: true }).fill("sample 22"); await page.getByRole("button", { name: "Search promises", exact: true }).click();
  await expect(page.getByText("Follow up sample 22", { exact: true })).toBeVisible();
  const link = page.getByRole("link", { name: "Open this promise", exact: true }); await expect(link).toHaveAttribute("href", new RegExp(`commitment=${id(2022)}`));
  await link.click();
  await expect(page.getByText("Showing the selected promise.", { exact: true })).toBeVisible();
  await expect(page.getByText("Follow up sample 22", { exact: true })).toBeVisible();
  await expect(page.getByText("Follow up sample 00", { exact: true })).toHaveCount(0);
});

test("a recovered creation confirmation clears the promise form and retains one authoritative promise", async () => {
  await page.goto(`${f.base}/customer`); await page.getByText("Record a customer promise", { exact: true }).click();
  await page.getByLabel("Promised action", { exact: true }).fill("Confirm sample dispatch"); await page.getByLabel("Promised date", { exact: true }).fill("2026-10-23");
  f.controls.loseNextWrite = true; await page.getByRole("button", { name: "Record customer promise", exact: true }).click();
  await page.getByRole("button", { name: "Retry the same request", exact: true }).click();
  await expect(page.getByText("Confirm sample dispatch", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Promised action", { exact: true })).toHaveValue(""); await expect(page.getByLabel("Promised date", { exact: true })).toHaveValue("");
  assert.equal((await f.db.query("select count(*)::int n from customer_commitments")).rows[0].n, 1);
});

test("an obsolete alias response cannot replace the result of a later customer-code search", async () => {
  await f.seedQuoteAliases(); await page.goto(`${f.base}/quote`);
  await page.getByPlaceholder("Select customer", { exact: true }).click(); await page.getByRole("button", { name: /Mira Aluminium Window Systems/ }).click();
  await page.getByText("Find a customer code", { exact: true }).click();
  const field = page.getByLabel("Exact customer profile code or alias", { exact: true });
  f.controls.delayAlias = 150; await field.fill("Customer 45"); await page.getByRole("button", { name: "Check customer code", exact: true }).click();
  await field.fill("No such code"); await page.getByRole("button", { name: "Check customer code", exact: true }).click();
  await expect(page.getByText("No active exact match for this customer.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: /Customer 45 →/ })).toHaveCount(0);
  assert.deepEqual(await page.evaluate(() => window.entryFixture.posts), []);
});

test("failed source revalidation removes an earlier resolved claim without erasing the historical alert", async () => {
  f.controls.settledInvoice = true; await page.goto(`${f.base}/notifications`); await expect(page.getByText("Resolved in source", { exact: true })).toBeVisible();
  f.controls.failSource = true; await page.getByRole("button", { name: "Refresh screen", exact: true }).click();
  await expect(page.getByText("The current source state could not be verified.", { exact: false })).toBeVisible();
  await expect(page.getByText("Resolved in source", { exact: true })).toHaveCount(0); await expect(page.getByText("Recorded overdue invoice alert", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open source record", exact: true })).toHaveCount(0);
});

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { buildPurchaseLifecycleBrowserBundle } from "../scripts/lib/purchase-lifecycle-browser-fixture.mjs";

let browser;
let script;

test.before(async () => {
  script = await buildPurchaseLifecycleBrowserBundle();
  const executablePath = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
});

test.after(async () => browser?.close());

async function mountedPage() {
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent('<main id="app"></main>');
  await page.evaluate(() => Object.defineProperty(window, "crypto", { configurable: true, value: { randomUUID: () => "bc000000-0000-4000-8000-000000000991" } }));
  await page.addScriptTag({ content: script });
  await expect(page.getByRole("heading", { name: "Purchase orders with a receiving trail" })).toBeVisible();
  return { page, errors };
}

test("mounted receiving form records each actual disposition and never merges rejected or held quantities", async () => {
  const { page, errors } = await mountedPage();
  await page.getByRole("button", { name: "Record this receipt" }).click();
  await page.getByLabel("Actual received").fill("12");
  await page.getByLabel("Accepted", { exact: true }).fill("10");
  await page.getByLabel("Rejected", { exact: true }).fill("1");
  await page.getByLabel("Held pending review").fill("1");
  await page.getByLabel("GRN / weighment reference").fill("GRN-44");
  await page.getByRole("button", { name: "Save receipt" }).click();
  assert.deepEqual(errors, []);
  const calls = await page.evaluate(() => window.fixture.calls);
  assert.ok(calls.some((call) => call.command === "receipt.record"), JSON.stringify({ calls, errors, body: await page.locator("body").innerText() }));
  const receipt = await page.evaluate(() => window.fixture.calls.find((call) => call.command === "receipt.record"));
  assert.deepEqual(receipt.payload.lines[0], {
    purchase_order_line_id: "bc000000-0000-4000-8000-000000000930", received_quantity: 12,
    accepted_quantity: 10, rejected_quantity: 1, held_quantity: 1, note: ""
  });
  assert.deepEqual(errors, []);
  await page.close();
});

test("an edited draft bill cannot post its previously matched version", async () => {
  const { page, errors } = await mountedPage();
  await page.getByRole("button", { name: "Review supplier bill", exact: true }).click();
  await page.getByLabel("Invoice text or CSV").setInputFiles({ name: "supplier-invoice.txt", mimeType: "text/plain", buffer: Buffer.from("Invoice Number: INV-001") });
  const form = page.locator("form").filter({ hasText: "Three way match" });
  await form.locator("select").nth(0).selectOption("bc000000-0000-4000-8000-000000000950");
  await form.getByRole("checkbox").check();
  await form.getByRole("button", { name: "Save reviewed bill and match" }).click();
  await form.getByRole("button", { name: "Recheck current receipts" }).click();
  await expect(form.getByRole("button", { name: "Post to expenses" })).toBeVisible();
  await form.getByRole("textbox", { name: "Invoice number" }).fill("INV-002");
  await expect(form.getByRole("button", { name: "Post to expenses" })).toHaveCount(0);
  await expect(form.getByRole("button", { name: "Recheck current receipts" })).toHaveCount(0);
  await expect(form.getByRole("checkbox")).not.toBeChecked();
  assert.equal(await page.evaluate(() => window.fixture.calls.filter(call => call.command === "bill.post").length), 0);
  assert.deepEqual(errors, []);
  await page.close();
});

test("mounted supplier document review keeps unmatched bills on hold and posts only after a fresh match", async () => {
  const { page, errors } = await mountedPage();
  await page.getByRole("button", { name: "Review supplier bill", exact: true }).click();
  await page.getByLabel("Invoice text or CSV").setInputFiles({ name: "supplier-invoice.txt", mimeType: "text/plain", buffer: Buffer.from("Invoice Number: INV-001") });
  await expect(page.getByText(/SHA-256/)).toBeVisible();
  await expect(page.getByText(/Review flags: vendor_id, purchase_order_id/)).toBeVisible();

  const reviewForm = page.locator("form").filter({ hasText: "Three way match" });
  await reviewForm.locator("select").nth(0).selectOption("bc000000-0000-4000-8000-000000000950");
  await reviewForm.getByRole("textbox", { name: "Invoice number" }).fill("INV-001");
  await reviewForm.getByRole("checkbox").check();
  await expect(reviewForm.getByRole("button", { name: "Save reviewed bill and match" })).toBeEnabled();
  await reviewForm.getByRole("button", { name: "Save reviewed bill and match" }).click();
  await expect(page.getByText("On hold", { exact: true })).toBeVisible();
  await expect(reviewForm.getByRole("button", { name: "Post to expenses" })).toHaveCount(0);
  await expect(page.getByText(/Accepted receipt quantity is short/)).toBeVisible();

  await reviewForm.getByRole("button", { name: "Recheck current receipts" }).click();
  await expect(reviewForm.getByRole("button", { name: "Post to expenses" })).toBeVisible();
  await reviewForm.getByRole("button", { name: "Post to expenses" }).click();
  await expect(page.getByText(/posted to expenses as pending finance approval/)).toBeVisible();
  const calls = await page.evaluate(() => window.fixture.calls.map((call) => call.command));
  assert.deepEqual(calls.filter((command) => ["document.review", "bill.create", "bill.match", "bill.post"].includes(command)), ["document.review", "bill.create", "bill.match", "bill.post"]);
  assert.deepEqual(errors, []);
  await page.close();
});

for (const failure of ["throw", "action-result"]) {
  test(`receiving retains the exact request after ${failure} and resumes after confirmation`, async () => {
    const { page, errors } = await mountedPage();
    await page.getByRole("button", { name: "Record this receipt" }).click();
    await page.getByLabel("Actual received").fill("8");
    await page.getByLabel("Accepted", { exact: true }).fill("8");
    await page.evaluate(failure => { window.fixture.failCommand = "receipt.record"; window.fixture.failure = failure; }, failure);
    await page.getByRole("button", { name: "Save receipt" }).click();
    await expect(page.getByRole("button", { name: "Retry exact request" })).toBeEnabled();
    await expect(page.getByLabel("Actual received")).toBeDisabled();
    await page.getByRole("button", { name: "Retry exact request" }).click();
    await expect(page.getByRole("button", { name: "Retry exact request" })).toHaveCount(0);
    const calls = await page.evaluate(() => window.fixture.calls.filter(call => call.command === "receipt.record"));
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1], calls[0]);
    await expect(page.getByRole("button", { name: "New purchase order", exact: true })).toBeEnabled();
    assert.deepEqual(errors, []);
    await page.close();
  });
}

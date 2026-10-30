import assert from "node:assert/strict";
import test from "node:test";
import { expect } from "@playwright/test";
import { createFinancialWorkflowReviewBrowserFixture } from "../scripts/lib/financial-workflow-review-browser-fixture.mjs";

let fixture;
let page;
test.before(async () => { fixture = await createFinancialWorkflowReviewBrowserFixture(); });
test.after(async () => { await fixture?.close(); });
test.beforeEach(async () => { await fixture.open("payments/receipts"); page = fixture.page; });
test.afterEach(async () => { assert.deepEqual(fixture.errors, []); });

test("mounted receipt allocation retries the same request and reconciles accounting CSV failures", async () => {
  await expect(page.getByRole("heading", { name: "Receipts and allocations", exact: true })).toBeVisible();
  await page.getByLabel("Actual received amount (INR) *").fill("100");
  await page.getByLabel("Receipt method *").selectOption("bank_transfer");
  await page.getByLabel("Bank / UPI / cheque reference *").fill("UTR-BROWSER-100");
  await page.getByLabel("Allocate to INV-FIN-006", { exact: true }).check();
  await page.getByLabel("Allocation amount for INV-FIN-006", { exact: true }).fill("60");
  await page.getByLabel("Allocate to INV-FIN-007", { exact: true }).check();
  await page.getByLabel("Allocation amount for INV-FIN-007", { exact: true }).fill("40");
  await expect(page.getByText(/allocation must balance exactly/)).not.toBeVisible();

  await page.evaluate(() => { window.__financial.postResult = { success: false, error: "Synthetic acknowledgement lost" }; });
  await page.getByRole("button", { name: "Post receipt", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__financial.calls.filter((call) => call.name === "post").length)).toBe(1);
  await page.evaluate(() => window.__financial.calls.find((call) => call.name === "post").input);
  await page.evaluate(() => { window.__financial.postResult = { success: true, data: {
    receipt_id: "f1000000-0000-4000-8000-000000000020", received_amount: 100, payment_method: "bank_transfer", status: "posted", idempotent_replay: true,
    allocations: [{ invoice_id: "f1000000-0000-4000-8000-000000000006", payment_id: "f1000000-0000-4000-8000-000000000008", amount: 60, payment_status: "PAID", balance_due: 58, invoice_status: "partially_paid" }, { invoice_id: "f1000000-0000-4000-8000-000000000007", payment_id: "f1000000-0000-4000-8000-000000000021", amount: 40, payment_status: "PAID", balance_due: 196, invoice_status: "partially_paid" }]
  } }; });
  await page.getByRole("button", { name: "Post receipt", exact: true }).click();
  await expect(page.getByText(/retry confirmed/, { exact: false })).toBeVisible();
  const posts = await page.evaluate(() => window.__financial.calls.filter((call) => call.name === "post").map((call) => call.input));
  assert.equal(posts.length, 2);
  assert.equal(posts[0].idempotency_key, posts[1].idempotency_key);
  assert.deepEqual(posts[0].allocations, [
    { invoice_id: fixture.ids.invoiceA, amount: 60 },
    { invoice_id: fixture.ids.invoiceB, amount: 40 }
  ]);

  await page.setInputFiles('input[type="file"]', {
    name: "collections.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Invoice Number,Receipt Date,Amount,Method,UTR,Remarks\nINV-FIN-006,29/10/2026,25.50,Bank Transfer,UTR-CSV-1,Matched\nNO-SUCH-INVOICE,29/10/2026,10.00,Cash,,Needs review")
  });
  await expect(page.getByText("2 rows · 2 valid · 0 need review", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Import mapped receipts", exact: true }).click();
  await expect(page.getByText("Import reconciled · 1 posted · 1 failed", { exact: true })).toBeVisible();
  await expect(page.getByText(/Row 3: Invoice number was not found/)).toBeVisible();
  const importCall = await page.evaluate(() => window.__financial.calls.find((call) => call.name === "import"));
  assert.equal(importCall.input.mapping.date_format, "dmy");
  assert.equal(importCall.input.csv_text.includes("NO-SUCH-INVOICE"), true);

  await page.getByLabel("Record ID", { exact: true }).fill(fixture.ids.payment);
  await page.getByRole("button", { name: "Preview correction", exact: true }).click();
  await expect(page.getByText("posted receipt", { exact: true })).toBeVisible();
  await page.getByLabel("Correction reason *", { exact: true }).fill("Bank confirmed the duplicate transfer");
  await page.getByRole("button", { name: "Reverse posted receipt", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__financial.calls.filter((call) => call.name === "correctionApply").length)).toBe(1);
  const correction = await page.evaluate(() => window.__financial.calls.find((call) => call.name === "correctionApply").input);
  assert.equal(correction.reason, "Bank confirmed the duplicate transfer");
  assert.equal(correction.fingerprint, "cc".repeat(32));
});

test("mounted non-cash adjustment stays separate from cash collection", async () => {
  await page.getByLabel("Actual received amount (INR) *").fill("12");
  await page.getByLabel("Receipt method *").selectOption("credit_note");
  await page.getByLabel("Notes and adjustment reason *", { exact: true }).fill("Approved customer credit");
  await page.getByLabel("Allocate to INV-FIN-006", { exact: true }).check();
  await page.getByLabel("Allocation amount for INV-FIN-006", { exact: true }).fill("12");
  await expect(page.getByRole("button", { name: "Post credit adjustment", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Post credit adjustment", exact: true }).click();
  const posted = await page.evaluate(() => window.__financial.calls.find((call) => call.name === "post").input);
  assert.equal(posted.payment_method, "credit_note");
  assert.equal(posted.reference_number, null);
  assert.match(await page.locator("body").innerText(), /keep credit adjustments separate from cash collection/i);
});

test("mounted invoice eligibility reviews exact dispatch lines and prepares a fingerprinted invoice", async () => {
  await fixture.open("invoices/eligibility");
  await expect(page.getByRole("heading", { name: "Invoice eligibility", exact: true })).toBeVisible();
  await page.getByLabel("Eligible order", { exact: true }).selectOption(fixture.ids.order);
  await page.getByLabel("Eligible dispatch", { exact: true }).selectOption(fixture.ids.dispatch);
  await page.getByRole("button", { name: "Review exact billable lines", exact: true }).click();
  await expect(page.getByText("Extrusion profile bundle", { exact: true })).toBeVisible();
  await expect(page.getByText("Source verified", { exact: true })).toBeVisible();
  await expect(page.getByText("INR 1180.00", { exact: false })).toBeVisible();
  const link = page.getByRole("link", { name: "Prepare invoice", exact: false });
  await expect(link).toHaveAttribute("href", new RegExp(`order_id=${fixture.ids.order}.*dispatch_id=${fixture.ids.dispatch}.*source_fingerprint=${"a1".repeat(16)}`));
  const reviewed = await page.evaluate(() => window.__financial.calls.find((call) => call.name === "review").input);
  assert.deepEqual(reviewed, { order_id: fixture.ids.order, dispatch_id: fixture.ids.dispatch });
});

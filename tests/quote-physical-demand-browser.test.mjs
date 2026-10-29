import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { createQuotePhysicalBrowserFixture, physicalQuoteId } from "../scripts/lib/quote-physical-browser-fixture.mjs";
let fixture, browser;
test.before(async () => {
  fixture = await createQuotePhysicalBrowserFixture();
  const executablePath = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
});
test.after(async () => { await browser?.close(); await fixture?.close(); });
for (const width of [1280, 375]) test(`89: ${width}px order review separates 480 physical kg from 700 billing kg`, async () => {
  const page = await browser.newPage({ viewport: { width, height: 900 } }), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(`${fixture.base}/?quoteId=${physicalQuoteId}`);
    await expect(page.getByText("Physical Profile Demand", { exact: true }).locator("..")).toContainText("480.000 kg");
    await expect(page.getByText("Commercial Billing Weight", { exact: true }).locator("..")).toContainText("700.000 kg");
    await expect(page.getByText("Factory Manufacturing Weight", { exact: true }).locator("..")).toContainText("480.000 kg");
    await expect(page.locator("body")).not.toContainText("@ 75% efficiency");
    await page.getByRole("button", { name: "Create Order", exact: true }).click();
    const posts = await page.evaluate(() => window.physicalFixture.posts);
    assert.equal(posts.length, 1); assert.equal(posts[0].input.p_quote_id, physicalQuoteId);
    assert.equal(Object.hasOwn(posts[0].input, "p_company_id"), false); assert.equal(Object.hasOwn(posts[0].input, "p_manufacturing_weight_kg"), false);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
test("89: missing physical source cannot enable conversion using the commercial minimum", async () => {
  const page = await browser.newPage();
  try {
    await page.goto(`${fixture.base}/?quoteId=${physicalQuoteId}&missing=1`);
    await expect(page.getByRole("alert").filter({ hasText: "physical profile weight" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create Order", exact: true })).toBeDisabled();
    assert.deepEqual(await page.evaluate(() => window.physicalFixture.posts), []);
  } finally { await page.close(); }
});

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { createEntryAcceptanceServer, entryLongCode } from "../scripts/lib/entry-acceptance-browser-fixture.mjs";

let fixture, browser, page, errors;
test.before(async () => {
  fixture = await createEntryAcceptanceServer({ styled: false, compileStyles: true });
  const executablePath = process.env.CHROME_PATH ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
});
test.beforeEach(async () => { page = await browser.newPage(); page.setDefaultTimeout(5000); errors = []; page.on("pageerror", (error) => errors.push(error.message)); });
test.afterEach(async () => { await page.close(); assert.deepEqual(errors, []); });
test.after(async () => { await browser?.close(); await fixture?.close(); });
const noPosts = async () => assert.deepEqual(await page.evaluate(() => window.entryFixture.posts), []);

test("actual quotation paste preserves an existing line and imports only after every profile is resolved", async () => {
  await page.goto(fixture.base);
  const existing = page.locator("[data-quote-line]").first();
  await existing.getByText("Costing and recovery for item 1", { exact: true }).click();
  await existing.getByLabel("Die charge", { exact: true }).fill("999");
  await existing.getByLabel("Sales override", { exact: true }).fill("777");
  await page.getByLabel("Paste quote lines from Excel").fill("Profile Code\tQuantity (pcs)\tLength (mm)\tFinish\nAL-101\t100\t6000\tMill finish\nUNKNOWN\t5\t6000\tAnodizing");
  await page.getByRole("button", { name: "Check profile codes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Import 2 lines into draft", exact: true })).toBeDisabled();
  await expect(page.locator("[data-quote-line]")).toHaveCount(1);
  await page.getByLabel("Row 3 profile code", { exact: true }).fill("AL-202");
  await page.getByRole("button", { name: "Check profile codes", exact: true }).click();
  await page.getByRole("button", { name: "Import 2 lines into draft", exact: true }).click();
  await expect(page.locator("[data-quote-line]")).toHaveCount(3);
  await expect(existing.getByLabel("Die charge", { exact: true })).toHaveValue("999");
  await expect(existing.getByLabel("Sales override", { exact: true })).toHaveValue("777");
  const imported = page.locator("[data-quote-line]").nth(1);
  await expect(imported.getByLabel("Length m", { exact: true })).toHaveValue("6");
  await expect(imported.getByLabel("Die charge", { exact: true })).toHaveValue("0");
  await expect(imported.getByLabel("Sales override", { exact: true })).toHaveValue("");
  await expect(imported).toContainText("480.000 kg");
  await expect(page.locator("[data-quote-line]").nth(2)).toContainText("36.000 kg");
  await noPosts();
});

test("actual profile selection distinguishes master quantity, a manual override and a missing weight", async () => {
  await page.goto(fixture.base);
  const line = page.locator("[data-quote-line]").first();
  await line.getByRole("textbox", { name: "Search aluminium profile by code or name", exact: true }).click();
  await page.getByRole("button", { name: /AL-101.*Window section/ }).click();
  await line.getByLabel("Qty pcs", { exact: true }).fill("100");
  await line.getByLabel("Length m", { exact: true }).fill("6");
  await expect(line).toContainText("600.00 m x 0.8 kg/m from the company profile master = 480.000 kg");
  await line.getByLabel("Length m", { exact: true }).fill("3");
  await expect(line).toContainText("300.00 m x 0.8 kg/m from the company profile master = 240.000 kg");
  await line.getByLabel("Kg/m", { exact: true }).fill("1");
  await expect(line).toContainText(/manual 1 kg\/m/);
  await line.getByLabel("Kg/m", { exact: true }).fill("");
  await expect(line).toContainText("Section weight is missing");
  await noPosts();
});

test("actual database preview retains page two and filters, omits private fields, and restores trigger focus", async () => {
  await page.goto(`${fixture.base}/inventory/database?page=2&search=AL`);
  const trigger = page.locator("table").getByRole("button", { name: `Preview ${entryLongCode}`, exact: true });
  await expect(trigger).toBeVisible(); const before = page.url();
  const readsBefore = await page.evaluate(() => window.entryFixture.rpcCalls.length);
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: entryLongCode, exact: true });
  await expect(dialog).toBeVisible(); await expect(dialog).toContainText("420.125");
  await expect(dialog).not.toContainText(/99999|INTERNAL-FIXTURE-PRIVATE/);
  assert.equal(page.url(), before);
  assert.equal(await page.evaluate(() => window.entryFixture.rpcCalls.length), readsBefore);
  const href = await dialog.getByRole("link", { name: "Open full record", exact: true }).getAttribute("href");
  const returnTo = new URL(href, fixture.base).searchParams.get("returnTo");
  assert.equal(new URL(returnTo, fixture.base).searchParams.get("page"), "2");
  assert.equal(new URL(returnTo, fixture.base).searchParams.get("search"), "AL");
  await dialog.getByRole("button", { name: "Close record preview", exact: true }).press("Escape");
  await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused(); assert.equal(page.url(), before);
  await noPosts();
});

test("actual database refresh retains old observation evidence and never advances success time on error", async () => {
  await page.goto(`${fixture.base}/inventory/database?page=2&search=AL`);
  const row = page.locator("table tbody tr").filter({ has: page.getByRole("button", { name: `Preview ${entryLongCode}`, exact: true }) });
  await row.getByText("Data age", { exact: false }).click();
  await expect(row).toContainText("31 Jan 2024"); await expect(row).toContainText("Legacy spreadsheet import, January 2024");
  const firstTime = await page.locator("time").getAttribute("datetime");
  await page.getByRole("button", { name: "Refresh page", exact: true }).click();
  await expect(page.locator("time")).not.toHaveAttribute("datetime", firstTime);
  await expect(row).toContainText("31 Jan 2024");
  const successTime = await page.locator("time").getAttribute("datetime");
  await page.getByRole("button", { name: "Fail next page refresh", exact: true }).click();
  await page.getByRole("button", { name: "Refresh page", exact: true }).click();
  await expect(page.getByText("Synthetic page refresh failure", { exact: true }).last()).toBeVisible();
  assert.equal(await page.locator("time").getAttribute("datetime"), successTime);
  await page.getByRole("button", { name: "Restore page responses", exact: true }).click();
  await page.getByRole("button", { name: "Refresh page", exact: true }).click();
  await expect(page.locator("table").getByRole("button", { name: `Preview ${entryLongCode}`, exact: true })).toBeVisible();
  await noPosts();
});

test("actual foundry form keeps unit display separate from batch configuration and missing density", async () => {
  await page.goto(`${fixture.base}/?screen=foundry`);
  const estimate = page.getByRole("region", { name: "Theoretical billet weight", exact: true });
  await expect(estimate).toBeVisible();
  const original = await estimate.locator("dd").allTextContents();
  assert.equal(original.length, 2);
  await estimate.getByRole("combobox", { name: "Display dimensions in", exact: true }).selectOption("in");
  await expect(estimate).toContainText("diameter 6 in"); assert.deepEqual(await estimate.locator("dd").allTextContents(), original);
  await expect(page.getByLabel("Billet diameter mm *", { exact: true })).toHaveValue("152.4");
  await estimate.getByText("Show calculation and precision", { exact: true }).click(); await expect(estimate).toContainText("0.1524 m");
  await page.getByLabel("Alloy density kg/m3 *", { exact: true }).fill("");
  await expect(estimate.getByRole("status")).toContainText("Estimate unavailable");
  await expect(estimate.locator("dd")).toHaveCount(0); await expect(estimate).toContainText("Actual measured mass is recorded separately");
  await noPosts();
});

test("phone database keeps long identifiers and expanded source evidence within the page", async () => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${fixture.base}/inventory/database?page=2&search=AL`);
  const card = page.locator('[role="button"]').filter({ has: page.getByRole("button", { name: `Preview ${entryLongCode}`, exact: true }) });
  await card.getByText("Data age", { exact: false }).click();
  const sizes = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, width: document.documentElement.scrollWidth }));
  assert.ok(sizes.width <= sizes.viewport, `Expanded evidence overflows phone: ${JSON.stringify(sizes)}`);
  await card.getByRole("button", { name: `Preview ${entryLongCode}`, exact: true }).click();
  const title = page.getByRole("dialog").getByRole("heading", { name: entryLongCode, exact: true });
  const heading = await title.evaluate((element) => ({ width: element.clientWidth, contentWidth: element.scrollWidth, height: element.clientHeight, contentHeight: element.scrollHeight }));
  assert.ok(heading.contentWidth <= heading.width && heading.contentHeight <= heading.height, `Identifier is clipped: ${JSON.stringify(heading)}`);
  await noPosts();
});

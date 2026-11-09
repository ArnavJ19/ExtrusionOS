import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { createAutopilotBrowserFixture } from "../scripts/lib/autopilot-batch1-browser-fixture.mjs";
import { apIds as i, istDay } from "../scripts/lib/autopilot-batch1-fixture.mjs";

let fixture, browser;
const evidence = "docs/evidence/AUTOPILOT_BATCH_1";
const today = istDay(0);
test.before(async () => { fixture = await createAutopilotBrowserFixture(); browser = await chromium.launch({ headless: true }); mkdirSync(evidence, { recursive: true }); });
test.after(async () => { await browser?.close(); await fixture?.close(); });
test.beforeEach(async () => { await fixture.start(); });
test.afterEach(async () => { await fixture.rollback(); });

async function open(width, screen, userId, options = {}) {
  const page = await (await browser.newContext({ viewport: { width, height: 900 }, timezoneId: "Asia/Kolkata" })).newPage();
  const errors = [];
  page.setDefaultTimeout(15000); page.on("pageerror", error => errors.push(error.message));
  await page.goto(fixture.base);
  await page.evaluate(([screen, userId, options]) => window.mount(screen, userId, options), [screen, userId, { today, ...options }]);
  await expect(page.getByRole("heading", { name: `Autopilot fixture: ${screen}` })).toBeVisible();
  return { page, errors, done: async () => { assert.deepEqual(errors, []); await page.context().close(); } };
}
const noOverflow = async page => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no sideways page scroll");
const q = (sql, params = []) => fixture.f.db.query(sql, params);

for (const width of [375, 1280]) {
  test(`AP-002/005 proposal cards: batch accept with one excluded, at ${width}px`, async () => {
    await fixture.f.call("ap_jobs", "run_now", { job_key: "series.propose" }, i.owner);
    const { page, done } = await open(width, "proposals", i.accounts, { type: "series.adopt" });
    await expect(page.getByText("5 of 5 selected", { exact: false })).toBeVisible();
    await page.getByLabel("Include Quotation numbers by financial year (for example Q/26-27/0001) in the batch").uncheck();
    await page.getByText("Why this was proposed").first().click();
    await expect(page.getByText("GST allows at most 16 characters", { exact: false }).first()).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: `${evidence}/proposals-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Accept selected (4)" }).click();
    await expect(page.getByRole("status")).toContainText("4 accepted");
    assert.deepEqual((await q("select doc_key from document_series where status='active' order by doc_key")).rows.map(r => r.doc_key), ["credit_notes", "dispatches", "invoices", "orders"]);
    await expect(page.getByText("Quotation numbers by financial year", { exact: false })).toBeVisible();
    await done();
  });

  test(`AP-001 scheduled jobs: real run now and the run ledger, at ${width}px`, async () => {
    const { page, done } = await open(width, "jobs", i.owner);
    await expect(page.getByText("Not run yet").first()).toBeVisible();
    const card = page.getByRole("listitem").filter({ hasText: "Propose financial-year numbering" });
    await card.getByRole("button", { name: "Run now (real run)" }).click();
    await expect(page.getByRole("status")).toContainText("Propose financial-year numbering ran: 5 checked, 5 proposal(s)");
    await expect(card.getByText("Healthy")).toBeVisible();
    await expect(page.getByRole("cell", { name: "series.propose" })).toBeVisible();
    await card.getByRole("button", { name: "Run now (real run)" }).click();
    await expect(page.getByRole("status")).toContainText("already ran this minute");
    assert.equal(Number((await q("select count(*) c from system_job_runs where job_key='series.propose'")).rows[0].c), 1);
    await noOverflow(page);
    await page.screenshot({ path: `${evidence}/jobs-${width}.png`, fullPage: true });
    await done();
  });

  test(`AP-004 factory calendar: a shutdown moves the promise, at ${width}px`, async () => {
    const { page, done } = await open(width, "calendar", i.factory);
    await page.getByLabel("From", { exact: true }).first().fill(today);
    await page.getByLabel("Lead days").fill("5");
    const before = await page.getByText("5 working days →").textContent();
    await page.getByLabel("From", { exact: true }).nth(1).fill(istDay(1));
    await page.getByLabel("To (optional)").fill(istDay(5));
    await page.getByLabel("Kind").selectOption("shutdown");
    await page.getByLabel("Label").fill("Diwali shutdown");
    await page.getByRole("button", { name: "Add to calendar" }).click();
    await expect(page.getByRole("status")).toContainText("Planned shutdown added");
    await expect(page.getByText("Diwali shutdown", { exact: false })).toBeVisible();
    const after = await page.getByText("5 working days →").textContent();
    assert.notEqual(before, after, "the working-day promise moves");
    await noOverflow(page);
    await page.screenshot({ path: `${evidence}/calendar-${width}.png`, fullPage: true });
    await done();
    const viewer = await open(width, "calendar", i.sales);
    await expect(viewer.page.getByText("Only the owner, admin, factory manager or production manager can change the calendar.")).toBeVisible();
    await expect(viewer.page.getByRole("button", { name: "Add to calendar" })).toHaveCount(0);
    await viewer.done();
  });

  test(`AP-059 month close and an approved reopen by a second person, at ${width}px`, async () => {
    const { page, done } = await open(width, "periods", i.accounts);
    const card = page.getByRole("listitem").filter({ hasText: "Ended, not closed" }).first();
    await card.getByRole("button", { name: "Close month" }).click();
    await card.getByRole("button", { name: "Close month" }).last().click();
    await expect(page.getByRole("status")).toContainText("closed.");
    const closed = page.getByRole("listitem").filter({ hasText: "Closed" }).first();
    await closed.getByRole("button", { name: "Request a reopen" }).click();
    await closed.getByLabel("Why must an entry be dated in this month?").fill("Supplier bill received late for this month");
    await closed.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByRole("status")).toContainText("another person decides it");
    await expect(page.getByRole("button", { name: "Decide" })).toHaveCount(0);
    await noOverflow(page);
    await page.screenshot({ path: `${evidence}/periods-${width}.png`, fullPage: true });
    await done();
    const owner = await open(width, "periods", i.owner);
    await owner.page.getByRole("button", { name: "Decide" }).click();
    await owner.page.getByPlaceholder("Decision note").fill("Approved for the late bill");
    await owner.page.getByRole("button", { name: "Approve" }).click();
    await expect(owner.page.getByRole("status")).toContainText("Reopen approved");
    await expect(owner.page.getByText("Open for an approved exception")).toBeVisible();
    await owner.done();
  });

  test(`AP-042 role navigation saved by an admin, at ${width}px`, async () => {
    const destinations = { sales: [{ href: "/dashboard", label: "Dashboard" }, { href: "/quotes", label: "Quotes" }, { href: "/customers", label: "Customers" }], owner: [{ href: "/dashboard", label: "Dashboard" }] };
    await fixture.f.call("ap_navigation", "visit", { route: "/quotes" }, i.sales);
    const { page, done } = await open(width, "navigation", i.admin, { destinations });
    await page.getByLabel("Role").selectOption("sales");
    await expect(page.getByText("Quotes /quotes")).toBeVisible();
    await page.getByLabel("Add a destination").selectOption("/quotes");
    await page.getByLabel("Add a destination").selectOption("/customers");
    await page.getByRole("button", { name: "Move Customers up" }).click();
    await page.getByRole("button", { name: "Save for sales" }).click();
    await expect(page.getByRole("status")).toContainText("Navigation saved");
    assert.deepEqual((await q("select items from role_navigation where role='sales'")).rows[0].items, ["/customers", "/quotes"]);
    await noOverflow(page);
    await page.screenshot({ path: `${evidence}/navigation-${width}.png`, fullPage: true });
    await done();
  });

  test(`AP-006 import a customer sheet with rejected rows, then import the valid ones, at ${width}px`, async () => {
    const { page, done } = await open(width, "import", i.owner);
    await page.getByRole("radio", { name: "Customers" }).click();
    const sheet = "Party Name,GST No,City,Type,GST registration\nPatel Aluminium,27AAPFU0939F1ZV,Surat,Dealer,\nMehta Windows,,Nashik,Fabricator,Unregistered\nBad Digit Traders,27AAPFU0939F1ZW,Pune,Dealer,\nSharma Fabricators,,Pune,Fabricator,Unregistered\n";
    await page.getByLabel("2. Upload the sheet (.xlsx or .csv, up to 4 MB)").setInputFiles({ name: "omalco-customers.csv", mimeType: "text/csv", buffer: Buffer.from(sheet) });
    await page.getByRole("button", { name: "Check the sheet" }).click();
    await expect(page.getByText("row(s) ready to import", { exact: false })).toContainText("2 row(s) ready to import · 2 row(s) rejected of 4");
    await expect(page.locator("li").filter({ hasText: "Row 4:" })).toContainText("check digit");
    await expect(page.locator("li").filter({ hasText: "Row 5:" })).toContainText("name and city already exists");
    await noOverflow(page);
    await page.screenshot({ path: `${evidence}/import-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Import 2 valid row(s)" }).click();
    await expect(page.getByRole("status")).toContainText("2 customers imported");
    await expect(page.getByRole("cell", { name: /omalco-customers\.csv/ })).toBeVisible();
    assert.equal((await q("select state from customers where customer_name='Patel Aluminium'")).rows[0].state, "Maharashtra");
    await done();
  });

  test(`AP-007 cut-over: stores loads stock, a second person signs it off, at ${width}px`, async () => {
    const accounts = await open(width, "cutover", i.accounts);
    await accounts.page.getByRole("button", { name: "Start cut-over plan" }).click();
    await expect(accounts.page.getByRole("status")).toContainText("Cut-over plan started");
    await accounts.done();
    const stores = await open(width, "cutover", i.inventory);
    const section = stores.page.getByRole("listitem", { name: "Finished profile stock" });
    await section.getByLabel("Section sheet (.xlsx or .csv)").setInputFiles({ name: "stock.csv", mimeType: "text/csv", buffer: Buffer.from("Profile code,Piece length (m),Pieces,Weight (kg),Location\nOM-2045,6,40,228,Rack 4\nOM-2045,5.8,20,110.2,Rack 5\n") });
    await section.getByLabel("Lines on sheet").fill("2");
    await section.getByLabel("Total kg").fill("338.2");
    await section.getByRole("button", { name: "Load section" }).click();
    await expect(stores.page.getByRole("status")).toContainText("Finished profile stock loaded: 2 line(s)");
    await expect(section.getByRole("button", { name: "Sign off and post" })).toBeVisible();
    await noOverflow(stores.page);
    await stores.page.screenshot({ path: `${evidence}/cutover-${width}.png`, fullPage: true });
    await stores.done();
    const admin = await open(width, "cutover", i.admin);
    await admin.page.getByRole("listitem", { name: "Finished profile stock" }).getByRole("button", { name: "Sign off and post" }).click();
    await expect(admin.page.getByRole("status")).toContainText("signed off and posted as opening entries");
    await expect(admin.page.getByText("Posted to the ledgers: 2 line(s)", { exact: false })).toBeVisible();
    assert.equal(Number((await q("select count(*) c from profile_stock_batches where origin_type='opening_balance'")).rows[0].c), 2);
    await admin.done();
  });

  test(`AP-005 confirm a number series directly, at ${width}px`, async () => {
    const { page, done } = await open(width, "numbering", i.accounts);
    await page.getByLabel("Format").fill("OMX/INV/{FY}/");
    await expect(page.getByText("18 characters; GST allows at most 16", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm this series" })).toBeDisabled();
    await page.getByLabel("Format").fill("OMX/{FY}/");
    await page.getByRole("button", { name: "Confirm this series" }).click();
    await expect(page.getByRole("status")).toContainText("Tax invoices now number as OMX/");
    await noOverflow(page);
    await page.screenshot({ path: `${evidence}/numbering-${width}.png`, fullPage: true });
    await done();
  });
}

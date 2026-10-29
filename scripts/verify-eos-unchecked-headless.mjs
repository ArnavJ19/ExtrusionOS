// Independent offscreen regression checks. This never attaches to a desktop browser.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { createEntryAcceptanceServer, entryLongCode } from "./lib/entry-acceptance-browser-fixture.mjs";
import { createOperatorBrowserFixture } from "./lib/operator-browser-fixture.mjs";
import { workflowIds } from "./lib/operator-workflow-fixture.mjs";
import { createProductionVisualFixture } from "./lib/production-visual-fixture.mjs";
import { createQuotePhysicalBrowserFixture, physicalQuoteId } from "./lib/quote-physical-browser-fixture.mjs";

const output = path.resolve("docs/evidence/EOS_UNCHECKED_ACCEPTANCE_2026-10-29");
mkdirSync(output, { recursive: true });
const report = { date: "2026-10-29", scope: "Independent headless Playwright with actual components, source CSS and local fonts. Synthetic auth/data and disposable PGlite; no hosted acceptance.", checks: [], captures: [], errors: [] };
const save = () => writeFileSync(path.join(output, "headless-verification.json"), JSON.stringify(report, null, 2) + "\n");
const entry = await createEntryAcceptanceServer({ styled: false, compileStyles: true });
const operator = await createOperatorBrowserFixture();
const production = await createProductionVisualFixture();
const physical = await createQuotePhysicalBrowserFixture();
const executablePath = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });

async function newContext(width) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  for (const weight of [400, 700, 800]) {
    const font = readFileSync(path.resolve(`node_modules/@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-${weight}-normal.woff2`));
    await context.route(`**/__acceptance-${weight}.woff2`, route => route.fulfill({ contentType: "font/woff2", body: font }));
  }
  await context.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    style.textContent = [400, 700, 800].map(weight => `@font-face{font-family:AcceptanceJakarta;src:url("/__acceptance-${weight}.woff2") format("woff2");font-weight:${weight};font-display:swap}`).join("") + ":root{--font-jakarta:AcceptanceJakarta}body{font-family:var(--font-jakarta),sans-serif}";
    document.head.append(style);
  }));
  return context;
}

async function capture(page, feature, name, region) {
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  if (!region) await page.evaluate(async () => {
    const original = scrollY;
    // Full-page captures must let viewport-triggered quantity tickers reach their recorded values.
    for (let top = 0; top < document.documentElement.scrollHeight; top += innerHeight * 0.8) {
      scrollTo(0, top);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    scrollTo(0, original);
    await new Promise(resolve => setTimeout(resolve, 1000));
  });
  const metrics = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, font: getComputedStyle(document.body).fontFamily, fonts: document.fonts.status }));
  const file = `f${feature}-${name}-${metrics.viewport}.png`;
  if (region) await region.screenshot({ path: path.join(output, file) });
  else await page.screenshot({ path: path.join(output, file), fullPage: true });
  report.captures.push({ file, feature, ...metrics }); save();
  assert.ok(metrics.document <= metrics.viewport + 1, `${file}: document overflows ${JSON.stringify(metrics)}`);
}

async function check(context, feature, width, name, run) {
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(12000); page.setDefaultNavigationTimeout(90000);
  page.on("pageerror", error => errors.push(error.message));
  try {
    await run(page);
    assert.deepEqual(errors, [], "Browser runtime errors");
    report.checks.push({ feature, width, name, status: "passed" });
    console.log(`PASS ${feature} ${width}px ${name}`);
  } catch (error) {
    report.checks.push({ feature, width, name, status: "failed", error: error.message, text: (await page.locator("body").innerText().catch(() => "")).slice(0, 12000) });
    report.errors.push(...errors.map(message => ({ feature, width, message })));
    console.log(`FAIL ${feature} ${width}px ${error.message}`);
  } finally { save(); await page.close(); }
}

const noEntryWrites = async page => assert.deepEqual(await page.evaluate(() => window.entryFixture.posts), []);
const previewButton = page => page.locator(`button[aria-label=${JSON.stringify(`Preview ${entryLongCode}`)}]:visible`);

try {
  for (const width of [1280, 375]) {
    const context = await newContext(width);
    await check(context, 23, width, "mixed paste requires correction before atomic append", async page => {
      await page.goto(entry.base);
      await page.getByLabel("Paste quote lines from Excel").fill("Profile Code\tQuantity (pcs)\tLength (mm)\tFinish\nAL-101\t100\t6000\tMill finish\nUNKNOWN\t5\t6000\tAnodizing");
      await page.getByRole("button", { name: "Check profile codes", exact: true }).click();
      await expect(page.getByRole("button", { name: "Import 2 lines into draft", exact: true })).toBeDisabled();
      await expect(page.locator("[data-quote-line]")).toHaveCount(1);
      await capture(page, 23, "unmatched-preview");
      await page.getByLabel("Row 3 profile code", { exact: true }).fill("AL-202");
      await page.getByRole("button", { name: "Check profile codes", exact: true }).click();
      await page.getByRole("button", { name: "Import 2 lines into draft", exact: true }).click();
      await expect(page.locator("[data-quote-line]")).toHaveCount(3);
      await expect(page.locator("[data-quote-line]").nth(1).getByLabel("Length m", { exact: true })).toHaveValue("6");
      await expect(page.locator("[data-quote-line]").nth(1)).toContainText("480.000 kg");
      await noEntryWrites(page);
    });
    await check(context, 83, width, "pieces and length recalculate without recording a measurement", async page => {
      await page.goto(entry.base); const line = page.locator("[data-quote-line]").first();
      await line.getByRole("textbox", { name: "Search aluminium profile by code or name", exact: true }).click();
      await page.getByRole("button", { name: /AL-101.*Window section/ }).click();
      await line.getByLabel("Qty pcs", { exact: true }).fill("100"); await line.getByLabel("Length m", { exact: true }).fill("6");
      await expect(line).toContainText("600.00 m x 0.8 kg/m from the company profile master = 480.000 kg");
      await capture(page, 83, "theoretical", line);
      await line.getByLabel("Length m", { exact: true }).fill("3"); await expect(line).toContainText("240.000 kg");
      await line.getByLabel("Kg/m", { exact: true }).fill("1"); await expect(line).toContainText("manual 1 kg/m");
      await line.getByLabel("Kg/m", { exact: true }).fill(""); await expect(line).toContainText("Section weight is missing");
      await noEntryWrites(page);
    });
    await check(context, 41, width, "preview preserves query and restores focus without a new read", async page => {
      await page.goto(`${entry.base}/inventory/database?page=2&search=AL`); const trigger = previewButton(page);
      await expect(trigger).toBeVisible(); const url = page.url(), reads = await page.evaluate(() => window.entryFixture.rpcCalls.length);
      await trigger.click(); const dialog = page.getByRole("dialog", { name: entryLongCode, exact: true });
      await expect(dialog).toBeVisible(); await expect(dialog).not.toContainText(/99999|INTERNAL-FIXTURE-PRIVATE/);
      assert.equal(page.url(), url); assert.equal(await page.evaluate(() => window.entryFixture.rpcCalls.length), reads);
      await capture(page, 41, "long-identifier");
      await dialog.getByRole("button", { name: "Close record preview", exact: true }).press("Escape");
      await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused(); assert.equal(page.url(), url);
    });
    await check(context, 50, width, "refresh cannot renew old physical evidence or advance on failure", async page => {
      await page.goto(`${entry.base}/inventory/database?page=2&search=AL`);
      await expect(previewButton(page)).toBeVisible(); await page.locator("summary:visible").filter({ hasText: "Data age" }).first().click();
      await expect(page.locator("p:visible").filter({ hasText: "31 Jan 2024" }).first()).toBeVisible();
      if (width < 768) {
        const card = page.locator('[role="button"]').filter({ has: previewButton(page) });
        assert.ok(await card.evaluate(element => element.scrollWidth <= element.clientWidth), "Expanded source evidence must fit inside its mobile record card");
      }
      await capture(page, 50, "old-observation");
      const firstRefresh = await page.locator("time").getAttribute("datetime");
      await page.getByRole("button", { name: "Refresh page", exact: true }).click();
      await expect(page.locator("time")).not.toHaveAttribute("datetime", firstRefresh);
      const previous = await page.locator("time").getAttribute("datetime");
      await page.getByRole("button", { name: "Fail next page refresh", exact: true }).click();
      await page.getByRole("button", { name: "Refresh page", exact: true }).click();
      await expect(page.getByText("Synthetic page refresh failure", { exact: true }).last()).toBeVisible();
      assert.equal(await page.locator("time").getAttribute("datetime"), previous);
      await capture(page, 50, "failed-refresh");
    });
    await check(context, 90, width, "equivalent dimension units preserve mass; missing density has no estimate", async page => {
      await page.goto(`${entry.base}/?screen=foundry`); const region = page.getByRole("region", { name: "Theoretical billet weight", exact: true });
      await expect(region).toBeVisible(); const mass = await region.locator("dd").allTextContents();
      await region.getByRole("combobox", { name: "Display dimensions in", exact: true }).selectOption("in");
      await expect(region).toContainText("diameter 6 in"); assert.deepEqual(await region.locator("dd").allTextContents(), mass);
      await region.getByText("Show calculation and precision", { exact: true }).click(); await capture(page, 90, "geometry", region);
      await page.getByLabel("Alloy density kg/m3 *", { exact: true }).fill(""); await expect(region.getByRole("status")).toContainText("Estimate unavailable");
      await expect(region.locator("dd")).toHaveCount(0); await noEntryWrites(page);
    });

    await operator.reset();
    await check(context, 22, width, "customer aliases retain history and require an explicit canonical choice", async page => {
      await page.goto(`${operator.base}/customer`); await page.getByText("Add a customer profile code", { exact: true }).click();
      await page.getByLabel("Customer code or alias", { exact: true }).fill("Old local section 45"); await page.getByLabel("Exact canonical profile code", { exact: true }).fill("AL-101");
      await page.getByRole("button", { name: "Save customer code", exact: true }).click(); await expect(page.getByText("Old local section 45 → AL-101", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Deactivate code", exact: true }).click(); await expect(page.getByText("Deactivated; retained in history", { exact: false })).toBeVisible();
      await operator.seedQuoteAliases(); await page.goto(`${operator.base}/quote`);
      await page.getByPlaceholder("Select customer", { exact: true }).click(); await page.getByRole("button", { name: /Mira Aluminium Window Systems/ }).click();
      const line = page.locator("[data-quote-line]").first(); await line.getByText("Find a customer code", { exact: true }).click();
      await line.getByLabel("Exact customer profile code or alias", { exact: true }).fill("Customer 45"); await line.getByRole("button", { name: "Check customer code", exact: true }).click();
      await expect(line.getByText("This code has multiple matches.", { exact: false })).toBeVisible(); await capture(page, 22, "ambiguous-code", line);
      await line.getByRole("button", { name: "Customer 45 → AL-202 · Door section", exact: true }).click(); await expect(line.getByLabel("Kg/m", { exact: true })).toHaveValue("1.2");
      await noEntryWrites(page);
    });
    await operator.reset();
    await check(context, 32, width, "location changes retain history and do not change stock quantity", async page => {
      await page.goto(`${operator.base}/inventory`); await page.getByText("Record a location move", { exact: true }).click();
      await page.getByLabel("New physical location", { exact: true }).fill("Shed C / Rack 04 / Level 2"); await page.getByLabel("Reason for move", { exact: true }).fill("Move close to packing");
      await page.getByRole("button", { name: "Confirm location move", exact: true }).click();
      await expect(page.getByText("Shed B / Rack 4 → Shed C / Rack 04 / Level 2", { exact: true })).toBeVisible();
      assert.equal((await operator.db.query("select current_stock from inventory_items where id=$1", [workflowIds.item])).rows[0].current_stock, "420");
      await capture(page, 32, "recorded-move");
      await page.goto(`${operator.base}/die`); await expect(page.getByText("Shed A / Rack 1", { exact: true })).toBeVisible();
    });
    await operator.reset();
    await check(context, 33, width, "uncertain exception confirmation replays one attributed observation", async page => {
      await page.goto(`${operator.base}/production`); await page.getByText("Record an exception", { exact: true }).click();
      await page.getByLabel("Exception note (optional)", { exact: true }).fill("Material absent from the recorded rack"); operator.controls.loseNextWrite = true;
      await page.getByRole("button", { name: "Record exception", exact: true }).click(); await expect(page.getByRole("button", { name: "Retry the same request", exact: true })).toBeVisible();
      await capture(page, 33, "uncertain-retry"); await page.getByRole("button", { name: "Retry the same request", exact: true }).click();
      await expect(page.getByText("Material absent from the recorded rack", { exact: true })).toBeVisible();
      assert.equal((await operator.db.query("select count(*)::int n from production_exceptions")).rows[0].n, 1);
      assert.equal((await operator.db.query("select status from production_jobs where id=$1", [workflowIds.job])).rows[0].status, "in_progress");
    });
    await operator.reset();
    await check(context, 47, width, "rescheduling retains the original deadline, reason and completed outcome", async page => {
      await page.goto(`${operator.base}/customer`); await page.getByText("Record a customer promise", { exact: true }).click();
      await page.getByLabel("Promised action", { exact: true }).fill("Send revised sample"); await page.getByLabel("Promised date", { exact: true }).fill("2026-11-02");
      await page.getByRole("button", { name: "Record customer promise", exact: true }).click(); await expect(page.getByText("Send revised sample", { exact: true })).toBeVisible();
      await page.getByText("Reschedule or close commitment", { exact: true }).click(); await page.getByLabel("Revised due date", { exact: true }).fill("2026-11-05");
      await page.getByLabel("Reason for rescheduling", { exact: true }).fill("Customer requested a trial first"); await page.getByRole("button", { name: "Confirm reschedule", exact: true }).click();
      await expect(page.getByText("Original promised date: 2026-11-02", { exact: true })).toBeVisible(); await page.getByRole("button", { name: "Show change history", exact: true }).click();
      await expect(page.getByText("Customer requested a trial first", { exact: true })).toBeVisible(); await capture(page, 47, "retained-deadline");
      await page.getByText("Reschedule or close commitment", { exact: true }).click(); await page.getByLabel("Commitment action", { exact: true }).selectOption("completed");
      await page.getByLabel("Commitment outcome", { exact: true }).fill("Sample delivered and acknowledged"); await page.getByRole("button", { name: "Record completion", exact: true }).click();
      await page.getByLabel("Commitment status", { exact: true }).selectOption("completed"); await expect(page.getByText("Outcome: Sample delivered and acknowledged", { exact: true })).toBeVisible();
    });
    await operator.reset();
    await check(context, 15, width, "alert resolution comes from source state and stays separate from read receipts", async page => {
      await page.goto(`${operator.base}/notifications`); await expect(page.getByRole("link", { name: "Open source record", exact: true })).toHaveAttribute("href", /\/invoices\//);
      await page.getByRole("button", { name: "Mark as read", exact: true }).click(); operator.controls.settledInvoice = true;
      await page.getByRole("button", { name: "Refresh screen", exact: true }).click(); await expect(page.getByText("Resolved in source", { exact: true })).toBeVisible();
      await expect(page.getByText("Recorded overdue invoice alert", { exact: true })).toBeVisible(); await capture(page, 15, "resolved-source");
      operator.controls.failSource = true; await page.getByRole("button", { name: "Refresh screen", exact: true }).click(); await expect(page.getByText("Resolved in source", { exact: true })).toHaveCount(0);
      await capture(page, 15, "source-unavailable");
    });

    for (const [feature, screen, expected] of [[6,"order","Remaining: 130 pcs, 780.20 m"], [84,"finishing","1,614.587 sq ft"], [89,"billets","40 billets (rounded up)"], [91,"performance","78.04%"], [92,"reversed","69.500 kg unaccounted"]]) {
      await check(context, feature, width, "recorded quantities and honest missing-data states", async page => {
        await page.goto(`${production.base}/?screen=${screen}`); await expect(page.locator("main")).toContainText(expected); await capture(page, feature, screen);
        if (feature === 84) { await page.goto(`${production.base}/?screen=perimeter-missing`); await expect(page.getByRole("alert")).toContainText("finishing charge is incomplete (not zero)"); await capture(page, feature, "missing-perimeter"); }
        if (feature === 89) { await page.goto(`${production.base}/?screen=recovery-invalid`); await expect(page.locator("main")).toContainText("Expected recovery must be greater than 0% and at most 100%."); }
        if (feature === 91) { await page.goto(`${production.base}/?screen=missing`); await expect(page.locator("main")).toContainText("Not captured"); await capture(page, feature, "missing-input"); await page.goto(`${production.base}/?screen=zero`); await expect(page.getByText("0%", { exact: true })).toHaveCount(2); }
        if (feature === 92) { await page.goto(`${production.base}/?screen=completion`); await page.getByLabel("Good output kg *").fill("780"); await page.getByLabel("Butt end kg").fill("205"); await expect(page.getByRole("status")).toContainText("5.000 kg more than the linked input"); assert.equal(await page.evaluate(() => window.fixture.completions.length), 0); await capture(page, feature, "completion-preview"); }
      });
    }
    await check(context, 89, width, "actual quote conversion review keeps billing minima out of physical demand", async page => {
      await page.goto(`${physical.base}/?quoteId=${physicalQuoteId}`);
      await expect(page.getByText("Physical Profile Demand", { exact: true }).locator("..")).toContainText("480.000 kg");
      await expect(page.getByText("Commercial Billing Weight", { exact: true }).locator("..")).toContainText("700.000 kg");
      await expect(page.getByText("Factory Manufacturing Weight", { exact: true }).locator("..")).toContainText("480.000 kg");
      await expect(page.getByRole("button", { name: "Create Order", exact: true })).toBeEnabled();
      await capture(page, 89, "physical-commercial-review");
    });
    await context.close();
  }

  const context = await newContext(1280);
  for (const width of [1280, 375]) await check(context, 4, width, "real Next routes preserve the filtered order page, scroll and scope", async page => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("http://127.0.0.1:3581/session/owner/populated");
    const query = "search=ORD&status=order_confirmed&secondary=high&dateFrom=2026-10-01&dateTo=2026-11-01&page=2&sort=order_number&direction=desc";
    await page.goto(`http://127.0.0.1:3580/orders/database?${query}`);
    const row = width >= 768 ? page.locator("table tbody tr[role=link]").first() : page.locator('div[role="button"]').filter({ has: page.locator('button[aria-label^="Preview ORD"]') }).first();
    await expect(row).toBeVisible(); const before = page.url();
    await page.getByLabel("Saved view name", { exact: true }).fill("Verification priority queue"); await page.getByRole("button", { name: "Save view", exact: true }).click();
    const pin = page.getByRole("button", { name: "Pin view", exact: true });
    if (await pin.count()) await pin.click();
    await page.evaluate(() => window.scrollTo(0, 380)); const scroll = await page.evaluate(() => scrollY);
    await row.click({ position: { x: 8, y: 8 } }); await expect(page).toHaveURL(/\/orders\/[a-f0-9-]+\?/);
    await page.goBack(); await expect(row).toBeVisible(); assert.equal(page.url(), before);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThanOrEqual(Math.max(0, scroll - 5)); await capture(page, 4, "order-return");
    await page.goto("http://127.0.0.1:3581/session/owner/other_user"); await expect(page.getByRole("link", { name: "Verification priority queue", exact: true })).toHaveCount(0);
    await page.goto("http://127.0.0.1:3581/session/owner/other_company"); await expect(page.getByRole("link", { name: "Verification priority queue", exact: true })).toHaveCount(0);
  });
  await check(context, 42, 1280, "real accounts and dispatch layouts persist permitted column controls", async page => {
    const defaults = [];
    for (const role of ["accounts", "dispatch"]) {
      await page.goto(`http://127.0.0.1:3581/session/${role}/populated`); await page.goto("http://127.0.0.1:3580/dispatches/database");
      await expect(page.locator("table tbody tr").first()).toBeVisible(); defaults.push(await page.locator("table th").allTextContents()); await capture(page, 42, `${role}-defaults`);
    }
    assert.notDeepEqual(defaults[0], defaults[1]);
    await page.getByText("Columns", { exact: true }).click(); const panel = page.getByRole("region", { name: "Table column preferences", exact: true });
    await panel.getByRole("checkbox", { name: "Vehicle", exact: true }).uncheck(); await panel.getByRole("checkbox", { name: "Vehicle", exact: true }).check();
    await panel.getByRole("button", { name: "Move Vehicle up", exact: true }).click(); await panel.getByRole("slider", { name: "Width for Vehicle", exact: true }).press("End");
    await expect(panel.getByRole("slider", { name: "Width for Vehicle", exact: true })).toHaveValue("480");
    await page.reload(); await page.getByText("Columns", { exact: true }).click(); await expect(panel.getByRole("checkbox", { name: "Vehicle", exact: true })).toBeChecked();
    await expect(panel.getByRole("slider", { name: "Width for Vehicle", exact: true })).toHaveValue("480"); await capture(page, 42, "persisted-controls");
    await page.setViewportSize({ width: 375, height: 900 });
    await panel.getByRole("checkbox", { name: "Vehicle", exact: true }).uncheck(); await panel.getByRole("checkbox", { name: "Vehicle", exact: true }).check();
    await capture(page, 42, "phone-controls");
  });
  await context.close();
} finally {
  report.passed = report.checks.filter(check => check.status === "passed").length;
  report.failed = report.checks.filter(check => check.status === "failed").length;
  report.features_exercised = [...new Set(report.checks.map(check => check.feature))].sort((a,b) => a-b);
  report.acceptance_limits = ["Computer Use native browser input is unavailable because URL detection fails.", "Real signed-in employee and physical factory trials are not simulated by these fixtures.", "The feature 89 correction is separately exercised through full-schema SQL; its new migration has not been applied to hosted Supabase."];
  save(); await browser.close(); await entry.close(); await operator.close(); await production.close(); await physical.close();
}
console.log(JSON.stringify({ passed: report.passed, failed: report.failed, features: report.features_exercised, captures: report.captures.length, scope: report.scope }, null, 2));
if (report.failed) process.exitCode = 1;

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { createNov2BrowserFixture } from "../scripts/lib/nov-batch2-browser-fixture.mjs";

let fixture, browser, page, errors;
const evidence = "docs/evidence/NOV_UPGRADES_BATCH_2";
test.before(async () => { fixture = await createNov2BrowserFixture(); browser = await chromium.launch({ headless: true }); mkdirSync(evidence, { recursive: true }); });
test.after(async () => { await browser?.close(); await fixture?.close(); });
test.beforeEach(async () => { errors = []; page = await browser.newPage({ viewport: { width: 375, height: 900 }, timezoneId: "Asia/Kolkata" }); page.setDefaultTimeout(12000); page.on("pageerror", error => errors.push(error.message)); page.on("dialog", dialog => dialog.accept()); });
test.afterEach(async () => { await page?.close(); assert.deepEqual(errors, []); });
const open = query => page.goto(`${fixture.base}/?${query || ""}`);
const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
async function choose(label, text) { const input = page.getByRole("combobox", { name: label, exact: true }); await input.click(); await page.getByRole("option", { name: text, exact: true }).click(); }
async function production() { await open("screen=form&module=production"); await choose("Order", "ORD-010"); await expect(page.getByRole("spinbutton", { name: "Planned kg", exact: true })).toHaveValue("480"); }
const measurement = () => page.getByRole("textbox", { name: "Measured Wall thickness" });

test("NOV-018/095: phone task keeps approved reference beside a blank physical observation and reviews before saving", async () => {
  await open(); await expect(measurement()).toHaveValue(""); await expect(page.getByText("Approved plan v1: 1.5 – 1.7 mm", { exact: true })).toBeVisible();
  await measurement().fill("1.6"); await page.getByRole("button", { name: "Next check" }).click();
  await page.getByRole("combobox", { name: "Surface finish result" }).selectOption("pass");
  await page.getByRole("button", { name: "Previous check" }).click(); await expect(measurement()).toHaveValue("1.6");
  await page.getByRole("button", { name: "Review observations", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review actual observations" })).toBeVisible(); assert.equal(await page.evaluate(() => window.actionCalls.length), 0);
  await page.getByRole("button", { name: "Confirm and save observations" }).click();
  await expect(page.getByText(/Observations saved and confirmed/)).toBeVisible();
  assert.equal(await page.evaluate(() => window.actionCalls.filter(call => call.command === "results.record").length), 1);
  await noOverflow(); await page.screenshot({ path: `${evidence}/inspection-phone-confirmed.png`, fullPage: true });
});

test("NOV-018: same-event repeated confirmation sends one write and a lost response is resolved by a read", async () => {
  await open(); await measurement().fill("1.6"); await page.getByRole("button", { name: "Review observations", exact: true }).click();
  await page.evaluate(() => { window.observationMode = "uncertain"; const button = [...document.querySelectorAll('button')].find(button => button.textContent === 'Confirm and save observations'); button.click(); button.click(); });
  await expect(page.getByText(/save outcome is uncertain/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm and save observations" })).toBeDisabled();
  await page.getByRole("button", { name: "Check current observations" }).click();
  await expect(page.getByText(/No additional save was sent/)).toBeVisible();
  assert.equal(await page.evaluate(() => window.actionCalls.filter(call => call.command === "results.record").length), 1);
});

test("NOV-018: device drafts recover on reload, while user/company/plan switches cannot restore old measurements", async () => {
  await open(); await measurement().fill("1.62"); await expect.poll(() => page.evaluate(() => sessionStorage.length)).toBe(1);
  await page.reload(); await expect(measurement()).toHaveValue("1.62"); await expect(page.getByText(/Recovered unsubmitted/)).toBeVisible();
  await page.evaluate(() => window.mount({ companyId: window.id(2) })); await expect(measurement()).toHaveValue("");
  await page.evaluate(() => window.mount({ companyId: window.id(1), userId: window.id(4) })); await expect(measurement()).toHaveValue("");
  await page.evaluate(() => { window.evaluation = { ...window.evaluation, plan_id: window.id(99), plan_version: 2 }; window.mount({ userId: window.id(3) }); }); await expect(measurement()).toHaveValue("");
  await expect(page.getByRole("heading", { name: /Inspection plan v2/ })).toBeVisible();
});

test("NOV-018: reload after an interrupted save requires an outcome read before any new submission", async () => {
  await open(); await measurement().fill("1.6"); await page.getByRole("button", { name: "Review observations", exact: true }).click();
  await page.evaluate(() => { window.observationMode = 'uncertain'; }); await page.getByRole("button", { name: "Confirm and save observations" }).click();
  await expect(page.getByText(/save outcome is uncertain/)).toBeVisible(); await page.reload();
  await expect(page.getByText(/Recovered observations from an interrupted save/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Review observations", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Check current observations" }).click(); await expect(page.getByText(/No additional save was sent/)).toBeVisible();
  assert.equal(await page.evaluate(() => window.actionCalls.filter(call => call.command === 'results.record').length), 0);
});

test("NOV-018/096: rejected observations retain entries, offline posting is disabled and references do not submit", async () => {
  await open(); await measurement().fill("1.64");
  const link = page.getByRole("link", { name: /Open approved plan v1/ }); await expect(link).toHaveAttribute("target", "_blank"); assert.equal(await page.evaluate(() => window.actionCalls.length), 0);
  await page.evaluate(() => { window.observationMode = 'reject'; }); await page.getByRole("button", { name: "Review observations", exact: true }).click(); await page.getByRole("button", { name: "Confirm and save observations" }).click();
  await expect(page.getByText(/applicable inspection plan changed/)).toBeVisible(); await expect(measurement()).toHaveValue("1.64");
  await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }); window.dispatchEvent(new Event('offline')); });
  await expect(page.getByText(/no offline posting is available/)).toBeVisible(); await expect(page.getByRole("button", { name: "Review observations", exact: true })).toBeDisabled();
});

test("NOV-095/100: read-only role sees evidence without an observation input, and missing references are explicit", async () => {
  await open("role=viewer"); await expect(measurement()).toHaveCount(0); await expect(page.getByRole("button", { name: "Review observations" })).toHaveCount(0);
  await page.evaluate(() => { window.evaluation = { state: 'no_plan', plan_id: null }; window.mount(); });
  await expect(page.getByRole("heading", { name: "Inspection reference unavailable" })).toBeVisible();
});

test("NOV-012/094: explicit theoretical plan applies pieces/length/kg while source refresh retains manual overrides", async () => {
  await production(); const planned = page.getByRole("spinbutton", { name: "Planned kg", exact: true }); await planned.fill("450");
  await page.getByText("Optional details", { exact: true }).click(); await page.getByRole("textbox", { name: "Remarks", exact: true }).fill("Keep manual run instructions");
  await page.evaluate(() => { window.rows.order_items_authorized[0].manufacturing_weight_kg = 490; });
  await page.getByRole("button", { name: "Refresh order suggestions (keep manual overrides)" }).click();
  await expect(page.getByText(/Manual override; source suggests ORD-010.*490/)).toBeVisible(); await expect(planned).toHaveValue("450");
  await expect(page.getByRole("textbox", { name: "Remarks", exact: true })).toHaveValue("Keep manual run instructions");
  await page.getByRole("button", { name: "Restore source value for Planned kg" }).click(); await expect(planned).toHaveValue("490");
  await page.getByText("Plan from pieces and cut length", { exact: true }).click();
  await page.getByLabel("Known pieces", { exact: true }).fill("100"); await page.getByLabel("Cut length per piece", { exact: true }).fill("6000"); await page.getByLabel("Length unit", { exact: true }).selectOption("mm");
  // Unit switching converts an already valid length. Enter the intended value in the selected unit.
  await page.getByLabel("Cut length per piece", { exact: true }).fill("6000");
  await expect(page.getByText(/480.000 kg theoretical planned output/)).toBeVisible(); await page.getByRole("button", { name: "Apply theoretical plan" }).click();
  await expect(planned).toHaveValue("480");
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.savedInputs.length)).toBe(1);
  const input = await page.evaluate(() => window.savedInputs[0]); assert.equal(input.quantity_basis.unit, "mm"); assert.equal(input.length_per_piece_m, 6); assert.equal(input.planned_quantity_kg, 480); assert.equal("actual_quantity_kg" in input, false);
});

test("NOV-012: missing section weight leaves manual planning intact and disables theoretical application", async () => {
  await open('screen=form&module=production&missingWeight=1');
  await choose('Order', 'ORD-010'); await expect(page.getByRole('spinbutton', { name: 'Planned kg', exact: true })).toHaveValue('480');
  await page.getByText('Plan from pieces and cut length', { exact: true }).click();
  await page.getByLabel('Known pieces', { exact: true }).fill('100'); await page.getByLabel('Cut length per piece', { exact: true }).fill('6');
  await expect(page.getByRole('button', { name: 'Apply theoretical plan' })).toBeDisabled();
  await expect(page.getByText('Section weight: Unavailable', { exact: true })).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'Planned kg', exact: true })).toHaveValue('480');
});

test("NOV-012: an estimate cannot replace an order-line cut length with a different customer specification", async () => {
  await production(); await page.getByText('Plan from pieces and cut length', { exact: true }).click();
  await page.getByLabel('Known pieces', { exact: true }).fill('100'); await page.getByLabel('Cut length per piece', { exact: true }).fill('3');
  await expect(page.getByRole('button', { name: 'Apply theoretical plan' })).toBeDisabled();
  await expect(page.getByText('Cut length differs from the order line. Use the specified length or review the order first.', { exact: true })).toBeVisible();
  await page.getByLabel('Cut length per piece', { exact: true }).fill('6'); await expect(page.getByRole('button', { name: 'Apply theoretical plan' })).toBeEnabled();
  await expect(page.getByText(/Uses order-line technical reference/)).toBeVisible();
});

test("NOV-018: unavailable device draft storage is explicit and observation saving still uses the server action", async () => {
  await page.addInitScript(() => Object.defineProperty(window, 'sessionStorage', { configurable: true, get() { throw Error('Synthetic device storage unavailable'); } }));
  await open(); await expect(page.getByText(/Device draft storage is unavailable/)).toBeVisible();
  await measurement().fill('1.6'); await page.getByRole('button', { name: 'Review observations', exact: true }).click(); await page.getByRole('button', { name: 'Confirm and save observations' }).click();
  await expect(page.getByText(/Observations saved and confirmed/)).toBeVisible();
});

test("NOV-094: late responses cannot overwrite a newly selected order and source-specific input is cleared", async () => {
  await open("screen=form&module=production"); await page.evaluate(() => { window.delays['orders_authorized:' + window.id(10)] = 450; });
  await choose("Order", "ORD-010"); await choose("Order", "ORD-012");
  await expect(page.getByRole("spinbutton", { name: "Planned kg", exact: true })).toHaveValue("960");
  await expect.poll(() => page.evaluate(() => window.completedReads.filter(call => call.table === 'foundry_billets' && call.filters.some(([, key, value]) => key === 'order_id' && value === window.id(10))).length)).toBeGreaterThan(0);
  await expect(page.getByRole("combobox", { name: "Profile", exact: true })).toHaveValue("AL-021 · Door section");
  await expect(page.getByRole("spinbutton", { name: "Planned kg", exact: true })).toHaveValue("960");
});

test("NOV-006/096/100: collapsed invalid measurements expand and receive focus without losing other entries", async () => {
  await open("screen=form&module=quality"); await choose("Completed production job", "JOB-040");
  const summary = page.getByText("Measurements and observations (optional while pending)", { exact: true }); await summary.click();
  await page.getByLabel("Hardness", { exact: true }).fill("0"); await page.getByLabel("Dimensional variance", { exact: true }).fill("Keep this observation"); await summary.click();
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await expect(page.getByLabel("Hardness", { exact: true })).toBeFocused(); await expect(page.getByLabel("Hardness", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("link", { name: /Hardness:/ })).toBeVisible();
  await expect(page.getByLabel("Dimensional variance", { exact: true })).toHaveValue("Keep this observation");
  await page.getByLabel("Hardness", { exact: true }).fill("12"); await expect(page.getByLabel("Hardness", { exact: true })).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText(/Number must be greater than 0/)).toHaveCount(0);
  await noOverflow(); await page.screenshot({ path: `${evidence}/validation-phone.png`, fullPage: true });
});

test("NOV-006: stage changes expose observations and optional details keep values when collapsed", async () => {
  await open("screen=form&module=quality"); await choose("Completed production job", "JOB-040");
  await page.getByText("Optional details", { exact: true }).click(); await page.getByLabel("Notes", { exact: true }).fill("Retain on collapse"); await page.getByText("Optional details", { exact: true }).click(); await page.getByText("Optional details", { exact: true }).click(); await expect(page.getByLabel("Notes", { exact: true })).toHaveValue("Retain on collapse");
  await choose("Inspection result", "Approved"); await expect(page.getByLabel("Hardness", { exact: true })).toBeVisible(); await expect(page.getByText("Measurements and observations (optional while pending)", { exact: true })).toHaveCount(0);
});

test("NOV-001: partial refresh retains marked prior tasks and removes their stale action links", async () => {
  await open("screen=work"); await page.evaluate(() => { window.nextWork = structuredClone(window.work); window.nextWork.assigned.items = []; window.nextWork.assigned.error = 'Queue unavailable'; window.nextWork.assigned.errorKind = 'unavailable'; });
  await page.getByRole("button", { name: "Refresh my work" }).click(); await expect(page.getByText(/Previous entries are shown/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Review production JOB-040" })).toBeVisible(); await expect(page.getByRole("link", { name: /Review start and completion conditions/ })).toHaveCount(0);
  await page.evaluate(() => { window.nextWork.assigned.errorKind = 'denied'; }); await page.getByRole("button", { name: "Refresh my work" }).click(); await expect(page.getByRole("heading", { name: "Review production JOB-040" })).toHaveCount(0);
});

test("NOV-001: a mismatched refreshed session removes old work and same-event refresh taps stay bounded", async () => {
  await open("screen=work"); await page.evaluate(() => { window.refreshScope = 'another-company:user:owner'; const button = [...document.querySelectorAll('button')].find(button => button.textContent === 'Refresh my work'); button.click(); button.click(); });
  await expect(page.getByText(/workspace session changed/)).toBeVisible(); assert.equal(await page.evaluate(() => window.refreshCalls), 1); await expect(page.getByRole("heading", { name: "Review production JOB-040" })).toHaveCount(0);
});

test("NOV-001: transport failure marks retained queues and disables their stale record actions", async () => {
  await open('screen=work'); await page.evaluate(() => { window.refreshThrows = true; }); await page.getByRole('button', { name: 'Refresh my work' }).click();
  await expect(page.getByRole('heading', { name: 'Review production JOB-040' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Review start and completion conditions/ })).toHaveCount(0);
});

test("NOV-002: unavailable preference storage does not claim a pin was saved", async () => {
  await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw Error('Synthetic blocked preference storage'); } }));
  await open('screen=workspace'); await page.getByRole('button', { name: 'Pin Orders', exact: true }).click();
  await expect(page.getByText(/This pin could not be saved/)).toBeVisible(); await expect(page.getByRole('button', { name: 'Pin Orders', exact: true })).toBeVisible();
});

test("NOV-002/100: permitted workspace pins support explicit keyboard reordering and company isolation", async () => {
  await open("screen=workspace"); await page.getByRole("button", { name: "Pin Orders", exact: true }).click(); await page.getByRole("button", { name: "Pin Production", exact: true }).click();
  const pinned = page.getByRole("region", { name: "Pinned", exact: true });
  await pinned.getByRole("button", { name: "Move Orders earlier", exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(pinned.getByRole("link").first()).toHaveText("Orders");
  await page.evaluate(() => window.mount({ companyId: window.id(2) })); await expect(page.getByRole("region", { name: "Pinned", exact: true }).getByRole("link")).toHaveCount(0);
  await page.evaluate(() => window.mount({ companyId: window.id(1), allowedRoutes: ['/quality'] })); await expect(page.getByRole("link", { name: "Orders", exact: true })).toHaveCount(0);
  await noOverflow();
});

test("NOV-100: enlarged text and keyboard review keep focused controls visible without page overflow", async () => {
  await open(); await page.setViewportSize({ width: 800, height: 900 }); await page.addStyleTag({ content: 'html{font-size:24px}' });
  await measurement().focus(); await page.keyboard.type("1.63"); await page.getByRole("button", { name: "Review observations", exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Review actual observations" }).locator("..")).toBeFocused();
  await noOverflow(); await page.screenshot({ path: `${evidence}/inspection-enlarged-desktop.png`, fullPage: true });
});

test("NOV-100: keyboard navigation to the next phone check is not covered by the sticky action bar", async () => {
  await open(); await measurement().focus(); await page.keyboard.press('Tab');
  const next = page.getByRole('button', { name: 'Next check', exact: true }); await expect(next).toBeFocused();
  const button = await next.boundingBox(); const bar = await page.getByRole('group', { name: 'Form actions', exact: true }).boundingBox();
  assert.ok(button.y + button.height <= bar.y || button.y >= bar.y + bar.height, 'focused next-check control must remain outside the sticky action bar');
});

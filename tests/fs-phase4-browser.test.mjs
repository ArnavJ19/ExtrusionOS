import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { createPhase4BrowserFixture } from "../scripts/lib/fs-phase4-browser-fixture.mjs";
import { ids as i } from "../scripts/lib/fs-phase4-fixture.mjs";

// FABLE_SUGGESTIONS Phase 4 screens rendered in Chromium at phone and desktop widths, driving the real server actions
// against the replayed SQL. Each check fails on a page error, a console error or horizontal page scroll.
let fixture, browser; const contexts = []; const evidence = "docs/evidence/FS_PHASE_4";
test.before(async () => { fixture = await createPhase4BrowserFixture(); browser = await chromium.launch({ headless: true }); mkdirSync(evidence, { recursive: true }); });
test.after(async () => { await browser?.close(); await fixture?.close(); });
test.beforeEach(async () => { await fixture.start(); });
test.afterEach(async () => { for (const context of contexts.splice(0)) await context.close(); await fixture.rollback(); });
const setup = work => fixture.run(() => work(fixture.f));
async function open(width, screen, actor = i.owner, options = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: "Asia/Kolkata" }); contexts.push(context);
  const page = await context.newPage(); const errors = []; page.setDefaultTimeout(20000); page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(fixture.base); await page.evaluate(([s, u, o]) => window.mount(s, u, o), [screen, actor, options]);
  return { page, done: async name => {
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no horizontal page scroll");
    await page.screenshot({ path: `${evidence}/${name}-${width}.png`, fullPage: true });
  } };
}

for (const width of [375, 1280]) {
  test(`FS-68 OTIF shows a late line against its first promise and records the cause at ${width}px`, async () => {
    const line = await setup(async f => { const b = await f.order({ kg: 570 }); await f.promise(b.order, -6); await f.promise(b.order, -2); await f.dispatchLine({ order: b.order, line: b.line, kg: 570, daysAgo: 3 }); return b.line; });
    const v = await open(width, "otif", i.salesManager);
    await expect(v.page.getByText("Delivered late")).toBeVisible();
    await v.page.getByRole("button", { name: "History" }).first().click();
    await expect(v.page.getByText(/order date/).first()).toBeVisible();
    await v.page.getByLabel("Cause of the delay").selectOption("die");
    await v.page.getByRole("button", { name: "Record cause" }).click();
    await expect(v.page.getByText("Delay cause recorded.")).toBeVisible();
    const rows = await fixture.run(() => fixture.f.db.query("select cause from order_line_delay_causes where order_item_id=$1", [line]));
    assert.deepEqual(rows.rows.map(r => r.cause), ["die"]);
    await v.done("otif");
  });

  test(`FS-73 thirteen-week cash forecast with a minimum balance at ${width}px`, async () => {
    await setup(f => f.invoice({ kg: 570, rate: 300 }));
    const v = await open(width, "cash", i.accounts);
    await expect(v.page.getByText("Next thirteen weeks")).toBeVisible();
    assert.equal(await v.page.locator("tbody").first().locator("tr").count(), 13);
    await v.page.getByLabel("Balance ₹").fill("100000"); await v.page.getByRole("button", { name: "Save balance" }).click();
    await v.page.getByLabel("Minimum ₹").fill("99999999"); await v.page.getByRole("button", { name: "Save minimum" }).click();
    await expect(v.page.getByText("Below minimum").first()).toBeVisible();
    await expect(v.page.getByText(/first falls below in the week of/)).toBeVisible();
    await v.done("cash-13-weeks");
  });

  test(`FS-72 metal exposure books metal against an order at ${width}px`, async () => {
    await setup(f => f.order({ kg: 1000 }));
    const v = await open(width, "metal", i.owner, { limit: true });
    await expect(v.page.getByText("Net open position", { exact: true })).toBeVisible();
    await v.page.getByRole("button", { name: "Book metal" }).first().click();
    await v.page.getByLabel("Rate ₹/kg").fill("246.5"); await v.page.getByLabel("Supplier and reference").fill("Hindalco PO-778");
    await v.page.getByRole("button", { name: "Record booking" }).click();
    await expect(v.page.getByText("Booking recorded.")).toBeVisible();
    await expect(v.page.getByText("Hindalco PO-778").first()).toBeVisible();
    await v.done("metal-exposure");
  });

  test(`FS-71, FS-16, FS-27 and FS-26 read models render for their roles at ${width}px`, async () => {
    for (const [screen, actor, text, options] of [["order-book", i.salesManager, "Load by press", { set: true }], ["die-life", i.productionManager, "Die life", { lead: true, makers: true }],
      ["mrp", i.inventory, "Billet by alloy and diameter", {}], ["promise", i.sales, "Promise-date calculator", { lists: { profiles: [{ id: i.profile2, label: "Sliding track" }] } }]]) {
      const v = await open(width, screen, actor, options);
      await expect(v.page.getByRole("heading", { name: text }).first()).toBeVisible();
      await v.done(screen);
    }
  });

  test(`FS-54 a development is recorded, shown on the board and moved with a note at ${width}px`, async () => {
    const lists = { customers: [{ id: i.customer2, label: "Sharma Fabricators" }], users: [], dies: [], profiles: [], vendors: [], presses: [] };
    const v = await open(width, "development", i.sales, { lists });
    await v.page.getByLabel("Title").fill("3-track sliding sash"); await v.page.getByLabel("Customer").selectOption(i.customer2);
    await v.page.getByRole("button", { name: "Record" }).click();
    await expect(v.page.getByText("Development recorded.")).toBeVisible();
    await expect(v.page.getByText("3-track sliding sash").first()).toBeVisible();
    const id = (await fixture.run(() => fixture.f.db.query("select id from development_projects where title='3-track sliding sash'"))).rows[0].id;
    const d = await open(width, "development-detail", i.sales, { id, lists });
    await d.page.getByLabel("Note", { exact: true }).fill("Drawing received, checking feasibility");
    await d.page.getByRole("button", { name: "Move" }).click();
    await expect(d.page.getByText("Moved.")).toBeVisible();
    await expect(d.page.getByText(/Enquiry with drawing → Feasibility/)).toBeVisible();
    await d.page.evaluate(() => window.presence(["Ravi (production manager)"]));
    await expect(d.page.getByText(/Also open by Ravi/)).toBeVisible();
    await d.done("development");
  });

  test(`FS-38 cockpit and FS-36 wall render; a live change refreshes the screen at ${width}px`, async () => {
    const c = await open(width, "cockpit", i.owner);
    await expect(c.page.getByText("Yesterday").first()).toBeVisible();
    await expect(c.page.getByRole("link", { name: "Open in WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\/\?text=Omalco%20owner%20brief/);
    await c.done("cockpit");
    const w = await open(width, "wall", i.production);
    await expect(w.page.getByText(/Live · updated/)).toBeVisible();
    const before = await w.page.evaluate(() => window.calls.filter(x => x.rpc === "fs_wall").length);
    await w.page.evaluate(() => window.liveChange("production_push_events"));
    await expect.poll(() => w.page.evaluate(() => window.calls.filter(x => x.rpc === "fs_wall").length), { timeout: 5000 }).toBeGreaterThan(before);
    await w.done("wall");
  });
}

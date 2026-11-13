import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { createBatch7BrowserFixture } from "../scripts/lib/autopilot-batch7-browser-fixture.mjs";
import { ids as i, istDay, lastMonthRange } from "../scripts/lib/autopilot-batch7-fixture.mjs";

let fixture, browser; const contexts = []; const evidence = "docs/evidence/AUTOPILOT_BATCH_7";
test.before(async () => { fixture = await createBatch7BrowserFixture(); browser = await chromium.launch({ headless: true }); mkdirSync(evidence, { recursive: true }); });
test.after(async () => { await browser?.close(); await fixture?.close(); });
test.beforeEach(async () => { await fixture.start(); });
test.afterEach(async () => { for (const context of contexts.splice(0)) await context.close(); await fixture.rollback(); });
const setup = work => fixture.run(() => work(fixture.f));
async function open(width, screen, actor = i.owner, options = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, permissions: ["clipboard-read", "clipboard-write"], timezoneId: "Asia/Kolkata" }); contexts.push(context);
  const page = await context.newPage(); const errors = []; page.setDefaultTimeout(20000); page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(fixture.base); await page.evaluate(([s, u, o]) => window.mount(s, u, o), [screen, actor, options]);
  return { page, done: async name => {
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no horizontal page scroll");
    await page.screenshot({ path: `${evidence}/${name}-${width}.png`, fullPage: true });
  } };
}
const one = sql => fixture.run(async () => fixture.f.one(sql));

for (const width of [375, 1280]) {
  test(`AP-003 acceptance by type and role, corrections, and a recorded rule change at ${width}px`, async () => {
    await setup(async f => {
      for (const s of ["accepted", "accepted", "rejected", "rejected", "rejected", "expired"]) await f.proposal({ status: s, decidedBy: i.salesManager, role: "sales_manager" });
      await f.proposal({ status: "edited", edited: ["rate_day"], payload: { rate_day: "a" }, decision: { rate_day: "b" } });
    });
    const v = await open(width, "quality", i.owner);
    await expect(v.page.getByRole("button", { name: "Reprice draft quotations" })).toBeVisible();
    await expect(v.page.getByText(/Overridden more than accepted/)).toBeVisible();
    await v.page.getByRole("button", { name: "Reprice draft quotations" }).click();
    await expect(v.page.getByText(/changed 1 time\(s\); most often to/)).toBeVisible();
    await expect(v.page.getByRole("cell", { name: "sales manager" })).toBeVisible();
    await v.page.getByLabel("Proposal type changed").selectOption("quote.reprice");
    await v.page.getByLabel("What changed").fill("Repricing proposes only above a 1% rate move");
    await v.page.getByRole("button", { name: "Record" }).click();
    await expect(v.page.getByText("Rule change recorded.")).toBeVisible();
    await expect(v.page.getByText(/Changed today; the comparison starts tomorrow/)).toBeVisible();
    await v.done("automation-quality");
    const fm = await open(width, "quality", i.factory, { canRecord: false });
    await expect(fm.page.getByText("The owner or an admin records rule changes.")).toBeVisible();
  });

  test(`AP-057 last prices on a PO line, the reason on a flagged price, and the price-check list at ${width}px`, async () => {
    const po = await setup(async f => {
      await f.purchaseOrder({ vendor: i.transporter, lines: [{ description: "Stretch film 23 micron", unit: "kg", rate: 100 }], daysAgo: 20 });
      return f.purchaseOrder({ vendor: i.transporter, lines: [{ description: "Stretch film 23 micron", unit: "kg", rate: 120 }], issue: false });
    });
    const v = await open(width, "po-line", i.accounts);
    await v.page.getByLabel("Material / service").fill("Stretch film 23 micron");
    await v.page.getByLabel("Rate INR / unit").fill("118");
    await expect(v.page.getByText(/Last prices \(issued purchase orders\)/)).toBeVisible();
    await expect(v.page.getByText(/\+18% against the last price ₹100.00/)).toBeVisible();
    await expect(v.page.getByTestId("flag")).toHaveText("flagged");
    await expect(v.page.getByLabel(/Why is this price higher/)).toBeVisible();
    await v.page.getByLabel("Rate INR / unit").fill("101");
    await expect(v.page.getByTestId("flag")).toHaveText("clear");
    await v.done("po-line-price");
    const c = await open(width, "po-checks", i.accounts, { orderId: po });
    await expect(c.page.getByText(/1 line\(s\) are priced above the last purchase price without a reason/)).toBeVisible();
    await c.page.getByLabel("Price reason for line 1").fill("Spot purchase for an urgent export order");
    await c.page.getByRole("button", { name: "Record reason" }).click();
    await expect(c.page.getByText("Reason recorded.")).toBeVisible();
    await expect(c.page.getByText(/Reason: Spot purchase for an urgent export order/)).toBeVisible();
    await c.done("po-price-checks");
    const p = await open(width, "prices", i.inventory, { canSet: false });
    await expect(p.page.getByRole("cell", { name: "Spot purchase for an urgent export order" })).toBeVisible();
    await expect(p.page.getByText("Only the owner or an admin changes the threshold.")).toBeVisible();
    await p.done("purchase-prices");
  });

  test(`AP-064 a delay notice is edited, copied and recorded as sent; the order shows it at ${width}px`, async () => {
    const o = await setup(async f => { const r = await f.redLine({ estimate: 7 }); await f.ap("ap_delay", "prepare", {}, i.owner); return r; });
    const v = await open(width, "delay", i.sales, { canPrepare: false });
    await expect(v.page.getByText(/1 late line\(s\)/)).toBeVisible();
    const message = v.page.getByLabel("Delay notice message");
    await expect(message).toHaveValue(/now expected/);
    await message.fill("Dear Mr Sharma,\nYour order is now expected on " + istDay(7) + ".\nRegards, Omalco");
    await v.page.getByRole("button", { name: "Save changes" }).click();
    await expect(v.page.getByText("Notice updated.")).toBeVisible();
    await v.page.getByRole("button", { name: "Copy message" }).click();
    await expect(v.page.getByText(/Copied\. Mark it sent/)).toBeVisible();
    await v.page.getByLabel("Sent by").selectOption("whatsapp");
    await v.page.getByRole("button", { name: "Mark sent" }).click();
    await expect(v.page.getByText("Recorded as sent.")).toBeVisible();
    assert.equal((await one("select status, sent_via from order_delay_notices order by created_at desc limit 1")).status, "sent");
    await expect(v.page.getByText(/1 told/)).toBeVisible();
    await v.done("delay-notices");
    const d = await open(width, "order-delay", i.dispatchManager, { orderId: o.order });
    await expect(d.page.getByRole("heading", { name: "Customer delay notices" })).toBeVisible();
    await expect(d.page.getByText(/Sent by WhatsApp/)).toBeVisible();
    await d.done("order-delay");
  });

  test(`AP-079 a monthly statement is reviewed, its provider email fails honestly, and it is recorded as sent at ${width}px`, async () => {
    await setup(async f => { await f.seed("update customers set email='accounts@sharma.invalid' where id=$1", [i.customer2]); await f.ap("ap_statement", "prepare", { period: lastMonthRange().period }, i.accounts); });
    const v = await open(width, "statements", i.accounts);
    await expect(v.page.getByText("Sharma Fabricators").first()).toBeVisible();
    await expect(v.page.getByRole("link", { name: "Download PDF" }).first()).toHaveAttribute("href", /\/api\/pdf\/statement\//);
    const card = v.page.locator("article", { hasText: "Sharma Fabricators" });
    await card.getByRole("button", { name: /Email to accounts@sharma.invalid/ }).click();
    await expect(card.getByText(/The email was not sent: .*Download the PDF and send it yourself/)).toBeVisible();
    await card.getByLabel("Statement sent by").selectOption("email");
    await card.getByRole("button", { name: "Mark sent" }).click();
    await expect(v.page.getByText("Recorded as sent.")).toBeVisible();
    assert.equal((await one(`select sent_via from customer_statements where customer_id='${i.customer2}' and status='sent'`)).sent_via, "email");
    await expect(v.page.getByText(/sent ·/).first()).toBeVisible();
    await v.done("statements");
  });

  test(`AP-086, 090, 025, 099, 039 and 040 shared inputs: date chips, recent values, wedge scan, paste, PIN and length at ${width}px`, async () => {
    const v = await open(width, "shared", i.dispatchManager);
    const { page } = v;
    // AP-086
    await page.getByRole("button", { name: "This month" }).click();
    await expect(page.getByTestId("range")).toHaveText(`${istDay(0).slice(0, 8)}01|${istDay(0)}`);
    await expect(page.getByRole("button", { name: "This month" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "This month" }).click();
    await expect(page.getByTestId("range")).toHaveText("|");
    // AP-090
    const customer = page.getByRole("combobox", { name: "Customer" });
    await customer.click(); await page.getByRole("option", { name: "Rao Facades" }).click();
    await expect(page.getByTestId("pick")).toHaveText("c5");
    await page.getByRole("button", { name: "Clear selection" }).first().click();
    await customer.click();
    await expect(page.getByText("Recently used")).toBeVisible();
    await expect(page.getByRole("option").first()).toHaveAccessibleName("Rao Facades");
    await page.keyboard.press("Escape");
    // AP-025: a scanner burst fills the bundle selector; an unknown label is explained; plain text fields are left alone.
    await page.evaluate(() => { window.labels = { "EO2:inventory_batch:bd000000-0000-4000-8000-000000000777:n1": { entityType: "inventory_batch", entityId: "batch-7", entityTypeLabel: "Stock bundle", label: "B-7", actions: [] } }; });
    await page.getByRole("combobox", { name: "Exact material source" }).click();
    await page.keyboard.type("EO2:inventory_batch:bd000000-0000-4000-8000-000000000777:n1"); await page.keyboard.press("Enter");
    await expect(page.getByTestId("src")).toHaveText("src-stock");
    await expect(page.getByText("Scanned Stock bundle B-7.")).toBeVisible();
    await page.getByRole("combobox", { name: "Exact material source" }).click();
    await page.keyboard.type("EO2:inventory_batch:bd000000-0000-4000-8000-000000000999:n1"); await page.keyboard.press("Enter");
    await expect(page.getByText(/No current record uses this code/)).toBeVisible();
    await expect(page.getByTestId("src")).toHaveText("src-stock", { timeout: 2000 });
    await page.getByLabel("Notes").click(); await page.keyboard.type("EO2:inventory_batch:bd000000-0000-4000-8000-000000000777:n1"); await page.keyboard.press("Enter");
    await expect(page.getByLabel("Notes")).toHaveValue("EO2:inventory_batch:bd000000-0000-4000-8000-000000000777:n1");
    assert.equal(await page.evaluate(() => window.scans.length), 2, "a scan into a plain text field is not intercepted");
    // AP-099: paste a screenshot into the attachment area.
    const zone = page.getByRole("button", { name: /Choose, drop or paste a file/ });
    await zone.focus();
    await page.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], "image.png", { type: "image/png" })); document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true })); });
    await expect.poll(() => page.evaluate(() => window.attached[0] ?? "")).toMatch(/^pasted-\d{8}-\d{6}\.png:image\/png:4$/);
    await page.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(["%PDF"], "die-drawing.pdf", { type: "application/pdf" })); document.activeElement.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true })); });
    await expect.poll(() => page.evaluate(() => window.attached[1] ?? "")).toBe("die-drawing.pdf:application/pdf:4");
    // AP-039
    const pin = page.getByLabel("PIN code", { exact: true });
    await pin.fill("411001");
    await expect(page.getByLabel("State", { exact: true })).toHaveValue("Maharashtra");
    await pin.fill("380001");
    await expect(page.getByText(/PIN 380001 is in Gujarat, but the state says Maharashtra/)).toBeVisible();
    await page.getByRole("button", { name: "Use Gujarat" }).click();
    await expect(page.getByLabel("State", { exact: true })).toHaveValue("Gujarat");
    await pin.fill("160017");
    await expect(page.getByRole("button", { name: "Chandigarh" })).toBeVisible();
    // AP-040
    const length = page.getByLabel("Length m", { exact: true });
    await length.fill("21ft");
    await expect(page.getByText("21 ft = 6,400.8 mm.")).toBeVisible();
    await expect(page.getByTestId("length")).toHaveText("6.4008|21ft");
    await length.fill("6400");
    await expect(page.getByTestId("length")).toHaveText("6.4|6400");
    await length.fill("12' 6\"");
    await expect(page.getByTestId("length")).toHaveText(`3.81|12' 6"`);
    await v.done("shared-inputs");
    // With nothing focused, a scan opens the record through the authorised lookup.
    await page.evaluate(() => { window.labels["EO2:die:bd000000-0000-4000-8000-000000000082:n1"] = { entityType: "die", entityId: "die-1", entityTypeLabel: "Die", label: "D-2045-A", actions: [{ label: "Open die record", href: "/dies/die-1" }] }; document.activeElement.blur(); });
    await page.keyboard.type("EO2:die:bd000000-0000-4000-8000-000000000082:n1"); await page.keyboard.press("Enter");
    await expect.poll(() => page.evaluate(() => window.navigations.at(-1))).toBe("/dies/die-1");
  });
}

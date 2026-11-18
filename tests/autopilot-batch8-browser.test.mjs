import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createBatch8BrowserFixture } from "../scripts/lib/autopilot-batch8-browser-fixture.mjs";
import { ids as i, istDay } from "../scripts/lib/autopilot-batch8-fixture.mjs";

let fixture, browser; const contexts = []; const evidence = "docs/evidence/AUTOPILOT_BATCH_8";
test.before(async () => { fixture = await createBatch8BrowserFixture(); browser = await chromium.launch({ headless: true }); mkdirSync(evidence, { recursive: true }); });
test.after(async () => { await browser?.close(); await fixture?.close(); });
test.beforeEach(async () => { await fixture.start(); fixture.printRequests.length = 0; });
test.afterEach(async () => { for (const context of contexts.splice(0)) await context.close(); await fixture.rollback(); });
const setup = work => fixture.run(() => work(fixture.f));
async function open(width, screen, actor = i.owner, options = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: "Asia/Kolkata" }); contexts.push(context);
  const page = await context.newPage(); const errors = []; page.setDefaultTimeout(20000); page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(fixture.base); await page.evaluate(([s, u, o]) => window.mount(s, u, o), [screen, actor, options]);
  return { page, done: async name => {
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no horizontal page scroll");
    await page.screenshot({ path: `${evidence}/${name}-${width}.png`, fullPage: true });
  } };
}
const CERT = ["MILL TEST CERTIFICATE", "Alloy: AA6063 Temper: F", "Cast No: H24-5521", "Element Si Fe Cu Mn Mg Zn Ti", "Spec Min 0.20 0.00 0.00 0.00 0.45 0.00 0.00", "Actual 0.42 0.18 0.01 0.02 0.52 0.01 0.01"];
async function certificatePdf() {
  const pdf = await PDFDocument.create(); const page = pdf.addPage(); const font = await pdf.embedFont(StandardFonts.Helvetica);
  CERT.forEach((r, n) => page.drawText(r, { x: 40, y: 760 - n * 18, size: 11, font }));
  return Buffer.from(await pdf.save());
}

for (const width of [375, 1280]) {
  test(`AP-020 upload a certificate, review what was read and confirm it at ${width}px`, async () => {
    const r = await setup(f => f.receiptLine());
    const up = await open(width, "upload", i.quality, { line: r.line });
    await expect(up.page.getByText(/PO-8-.* line 1 · 6063 billet/)).toBeVisible();
    await up.page.locator("input[type=file]").setInputFiles({ name: "mtc-h24.pdf", mimeType: "application/pdf", buffer: await certificatePdf() });
    await expect.poll(() => up.page.evaluate(() => window.navigations.at(-1) ?? "")).toMatch(/^\/quality\/certificates\/[0-9a-f-]{36}$/);
    await up.done("certificate-upload");
    const id = (await up.page.evaluate(() => window.navigations.at(-1))).split("/").pop();
    const v = await open(width, "certificate", i.quality, { id });
    await expect(v.page.getByText("Read from the PDF text", { exact: false })).toBeVisible();
    await expect(v.page.getByLabel("Value for heat_number")).toHaveValue("H24-5521");
    await expect(v.page.getByLabel("Value for mg")).toHaveValue("0.52");
    await expect(v.page.getByText("In specification").first()).toBeVisible();
    await v.page.getByLabel("Value for si").fill("0.95");
    await expect(v.page.getByText("0.95% outside 0.2–0.6%")).toBeVisible();
    await v.page.getByLabel("Value for si").fill("0.42");
    await v.page.getByRole("button", { name: "Confirm certificate" }).click();
    await expect(v.page.getByText(/Confirmed by .* every value as read/)).toBeVisible();
    await v.done("certificate-confirmed");
    const list = await open(width, "certificates", i.inventory);
    await expect(list.page.getByRole("link", { name: /Heat H24-5521/ })).toBeVisible();
    await expect(list.page.getByText(/1 of 1 confirmed as read/)).toBeVisible();
    await list.done("certificates");
  });

  test(`AP-020 an out-of-specification certificate tells quality to decide the line at ${width}px`, async () => {
    const draft = await setup(async f => { const r = await f.receiptLine(); return f.certificate({ line: r.line, extracted: { heat_number: { value: "H-77", confidence: "high", source: "Heat H-77" }, alloy: { value: "6063", confidence: "high", source: "6063" } } }); });
    const v = await open(width, "certificate", i.quality, { id: draft.id });
    for (const [k, value] of Object.entries({ si: "0.95", fe: "0.18", cu: "0.01", mn: "0.02", mg: "0.52", zn: "0.01", ti: "0.01" })) await v.page.getByLabel(`Value for ${k}`).fill(value);
    await v.page.getByRole("button", { name: "Confirm certificate" }).click();
    await expect(v.page.getByText("Out of specification").first()).toBeVisible();
    await expect(v.page.getByText(/an authorised concession, or reject\. It cannot be accepted as is/)).toBeVisible();
    await v.done("certificate-out-of-spec");
    const ro = await open(width, "certificate", i.inventory, { id: draft.id, role: "inventory_manager" });
    await expect(ro.page.getByRole("button", { name: "Confirm certificate" })).toHaveCount(0);
  });

  test(`AP-052 control charts with plan limits, an alarm raised and reviewed at ${width}px`, async () => {
    await setup(async f => {
      const { plan, items } = await f.plan({ items: [{ characteristic: "Wall thickness", unit: "mm", nominal: 1.4, lower: 1.3, upper: 1.5 }] });
      const j = await f.job({ status: "in_progress" });
      await f.readings({ job: j.job, plan, item: items[0], values: [1.42, 1.43, 1.44, 1.43, 1.45, 1.46, 1.47] });
    });
    const v = await open(width, "spc", i.quality);
    await expect(v.page.getByRole("img", { name: /Wall thickness control chart for Die D-2045-A: 7 readings/ })).toBeVisible();
    await expect(v.page.getByText(/Seven readings in a row are above the centre line/).first()).toBeVisible();
    await v.page.getByRole("button", { name: "Check now" }).click();
    await expect(v.page.getByText(/Checked 1 chart\(s\)/)).toBeVisible();
    await expect(v.page.getByText("Seven readings in a row on one side of the centre", { exact: false })).toBeVisible();
    await v.page.getByLabel("What QC did").fill("Die bearing worn; sent the die for correction");
    await v.page.getByLabel("Finding").selectOption("die_sent_for_correction");
    await v.page.getByRole("button", { name: "Record review" }).click();
    await expect(v.page.getByText("Alarm reviewed.")).toBeVisible();
    await expect(v.page.getByText("No alarm is waiting for review.")).toBeVisible();
    await v.done("spc");
    const pm = await open(width, "spc", i.productionManager);
    await expect(pm.page.getByRole("button", { name: "Check now" })).toHaveCount(0);
  });

  test(`AP-065 a die away with an expected return warns planned jobs; marking it back clears them at ${width}px`, async () => {
    const j = await setup(f => f.job({ plannedIn: 2, due: 4 }));
    const v = await open(width, "die", i.productionManager, { die: i.die, today: istDay(0), job: j.job });
    await expect(v.page.getByText("In the plant and available.")).toBeVisible();
    await v.page.getByLabel("Why away").selectOption("nitriding");
    await v.page.getByLabel("Expected back").fill(istDay(5));
    await v.page.getByLabel("Note").fill("Shree Nitriding Works");
    await v.page.getByRole("button", { name: "Record die away" }).click();
    await expect(v.page.getByText(/Saved\. Planned jobs on this die are checked/)).toBeVisible();
    await expect(v.page.getByText(/^Nitriding: expected back/)).toBeVisible();
    await expect(v.page.getByText(/Die D-2045-A is at nitriding on .*; expected back/).first()).toBeVisible();
    await v.done("die-availability");
    await v.page.getByLabel("What was done on return").fill("Nitrided and inspected");
    await v.page.getByRole("button", { name: "Mark back in plant" }).click();
    await expect(v.page.getByText("Marked back in the plant.")).toBeVisible();
    await expect(v.page.getByText("In the plant and available.")).toBeVisible();
    const sales = await open(width, "die", i.sales, { die: i.die, today: istDay(0), role: "sales" });
    await expect(sales.page.getByRole("button", { name: "Record die away" })).toHaveCount(0);
  });

  test(`AP-050 customers at risk with reasons, and a recorded follow-up at ${width}px`, async () => {
    await setup(async f => {
      await f.orderHistory(i.customer3, [[100, 1000], [130, 1000], [160, 1000], [190, 1000], [220, 1000]]);
      await f.seed("insert into invoices(id,company_id,customer_id,invoice_number,invoice_date,due_date,subtotal,tax_total,grand_total,amount_paid,status) values($1,$2,$3,'INV-8-B',current_date-120,current_date-75,10000,1800,11800,0,'sent')", [f.next(), i.company, i.customer3]);
    });
    const v = await open(width, "health", i.salesManager, { customer: i.customer3 });
    await v.page.getByRole("button", { name: "Score now" }).click();
    await expect(v.page.getByText(/Scored \d+ customer\(s\)\./)).toBeVisible();
    await expect(v.page.getByText(/No order for 100 days; usually orders every 30 days/).first()).toBeVisible();
    await v.page.getByRole("button", { name: "Record follow-up" }).first().click();
    await v.page.getByLabel("What was said").first().fill("Called purchase; project restarts in January");
    await v.page.getByRole("button", { name: "Record" }).first().click();
    await expect(v.page.getByText("Follow-up recorded.").first()).toBeVisible();
    await v.done("customer-health");
    const record = await open(width, "health", i.salesManager, { customer: i.customer3 });
    await expect(record.page.getByText(/Order rhythm · −30 of 30/)).toBeVisible();
    await expect(record.page.getByText(/Called · Called purchase; project restarts in January/)).toBeVisible();
    await record.done("customer-health-record");
    const sales = await open(width, "health", i.sales);
    await expect(sales.page.getByRole("button", { name: "Score now" })).toHaveCount(0);
  });

  test(`AP-069 press load by week and the earliest realistic week on a quotation at ${width}px`, async () => {
    const q = await setup(async f => {
      const p1 = await f.press({ name: "Press 1", code: "P1" }); await f.shifts(p1, 1000);
      await f.seed("update aluminium_profiles set compatible_presses=array['P1'] where id=$1", [i.profile2]);
      const quote = await f.draftQuote({});
      await f.seed("update quote_items set billing_weight_kg=800 where quote_id=$1", [quote.quote]);
      return quote.quote;
    });
    const v = await open(width, "capacity", i.sales, { quote: q, profile: i.profile2, kg: "800" });
    await expect(v.page.getByText(/Earliest realistic press week for 800 kg: week of/).first()).toBeVisible();
    await expect(v.page.getByText(/Press 1 \(presses named on the profile\)/).first()).toBeVisible();
    await v.page.getByRole("button", { name: "Use this week to promise" }).click();
    await expect(v.page.getByText(/Recorded\. The promised week is compared with actual completion/)).toBeVisible();
    await expect(v.page.getByText(/\(used to promise\)/)).toBeVisible();
    await v.done("capacity");
  });

  test(`AP-092 save a view as my default; the page opens with it; AP-091 print selected challans at ${width}px`, async () => {
    const v = await open(width, "views", i.sales, { query: "status=packing&secondary=urgent", hasFilters: "1", rows: "00000000-0000-4000-8000-000000000101,00000000-0000-4000-8000-000000000102", day: istDay(0) });
    await v.page.getByRole("button", { name: /My views/ }).click();
    await v.page.getByLabel("Saved view name").fill("Urgent packing");
    await v.page.getByLabel("Open this page with it by default").check();
    await v.page.getByRole("button", { name: "Save view" }).click();
    await expect(v.page.getByText("Saved as your default view.")).toBeVisible();
    await expect(v.page.getByRole("button", { name: "Urgent packing (default)" })).toBeVisible();
    await v.page.keyboard.press("Escape");
    await expect(v.page.getByLabel("Saved view name")).toHaveCount(0);
    await v.page.getByRole("checkbox", { name: "Select DSP-0101 for printing" }).check();
    await v.page.getByRole("checkbox", { name: "Select DSP-0102 for printing" }).check();
    const popup = v.page.context().waitForEvent("page");
    await v.page.getByRole("button", { name: "Print selected (2)" }).click();
    await popup;
    await expect.poll(() => fixture.printRequests.length).toBe(1);
    assert.deepEqual(fixture.printRequests[0], { kind: "challan", ids: ["00000000-0000-4000-8000-000000000101", "00000000-0000-4000-8000-000000000102"] });
    await expect(v.page.getByRole("button", { name: /Print all challans for/ })).toBeVisible();
    await v.done("views-print");
    // Returning without filters restores the default view.
    const back = await open(width, "views", i.sales, { query: "" });
    await expect(back.page.getByTestId("query")).toHaveText("status=packing&secondary=urgent");
    await expect(back.page.getByRole("button", { name: "My views: Urgent packing" })).toBeVisible();
    const other = await open(width, "views", i.salesManager, { query: "" });
    await expect(other.page.getByTestId("query")).toHaveText("", { timeout: 3000 });
  });
}

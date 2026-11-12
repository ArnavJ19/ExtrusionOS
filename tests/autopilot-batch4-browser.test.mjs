import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { createDispatchBrowserFixture } from "../scripts/lib/autopilot-batch4-browser-fixture.mjs";
import { dIds as i, istDay, nid } from "../scripts/lib/autopilot-batch4-fixture.mjs";

let fixture, browser;
const evidence = "docs/evidence/AUTOPILOT_BATCH_4";
const today = istDay(0);
test.before(async () => { fixture = await createDispatchBrowserFixture(); browser = await chromium.launch({ headless: true }); mkdirSync(evidence, { recursive: true }); });
test.after(async () => { await browser?.close(); await fixture?.close(); });
test.beforeEach(async () => { await fixture.start(); });
const contexts = [];
test.afterEach(async () => { for (const context of contexts.splice(0)) await context.close().catch(() => {}); await fixture.rollback(); });

const q = (sql, params = []) => fixture.run(() => fixture.f.db.query(sql, params));
const setup = work => fixture.run(() => work(fixture.f));
async function open(width, screen, userId, options = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: "Asia/Kolkata", permissions: ["clipboard-read", "clipboard-write"] });
  contexts.push(context);
  const page = await context.newPage();
  const errors = [];
  page.setDefaultTimeout(15000); page.on("pageerror", error => errors.push(error.message));
  await page.goto(fixture.base);
  await page.evaluate(([screen, userId, options]) => window.mount(screen, userId, options), [screen, userId, { today, ...options }]);
  await expect(page.getByRole("heading", { name: `Dispatch fixture: ${screen}` })).toBeVisible();
  return { page, errors, done: async () => { assert.deepEqual(errors, []); await noOverflow(page); } };
}
const noOverflow = async page => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no sideways page scroll");
const shot = (page, name, width) => page.screenshot({ path: `${evidence}/${name}-${width === 375 ? "phone" : "desktop"}.png`, fullPage: true });

/** An order of 100 pcs, a released job and bundles recorded against it. */
async function readyOrder({ tags = ["W-1", "W-2"], approvedKg = 570, customer = i.customer2 } = {}) {
  return setup(async f => {
    const o = await f.order({ customer });
    const job = await f.readyJob({ order: o.order, line: o.line, kg: 570, approvedKg });
    const bundles = [];
    for (const tag of tags) bundles.push(await f.bundle({ order: o.order, job, tag }));
    return { ...o, job, bundles };
  });
}
const approveTemplate = () => setup(f => f.seed(`insert into packing_label_templates(id,company_id,scope,revision,status,instructions,label_fields,spacer_required,created_by,approved_by,approved_at)
  values($1,$2,'company',1,'approved','Wrap and label both ends',$3,false,$4,$5,now())`, [nid(7300), i.company, ["bundle_number", "order_number", "customer", "profile_code", "pieces", "net_kg"], i.dispatchManager, i.owner]));

for (const width of [375, 1280]) {
  test(`AP-018 the loader scans bundles, sees refusals and planned vs loaded, and completes the dispatch from the scans, at ${width}px`, async () => {
    const o = await readyOrder({ tags: ["W-1", "W-2"] });
    await readyOrder({ tags: ["W-OTHER"], customer: i.customer });
    const session = await setup(f => f.ap("ap_dispatch", "start", { order_id: o.order, vehicle_number: "MH12AB1234", transporter_name: "VRL Logistics" }));
    const s = await open(width, "station", i.dispatchUser, { sessionId: session.id });
    const tag = s.page.getByLabel("Bundle tag");
    await tag.fill("w-1"); await tag.press("Enter");
    await expect(s.page.getByRole("status").filter({ hasText: "Loaded W-1" })).toBeVisible();
    await tag.fill("W-OTHER"); await tag.press("Enter");
    await expect(s.page.getByRole("alert").filter({ hasText: "Do not load" })).toBeVisible();
    await tag.fill("W-2"); await tag.press("Enter");
    await expect(s.page.getByText("2 bdl · 40 pcs")).toBeVisible();
    await shot(s.page, "loading-station", width);
    await s.page.getByRole("button", { name: /Complete loading \(2 bundles\)/ }).click();
    await expect(s.page.getByRole("status").filter({ hasText: "Dispatch written from the scanned bundles" })).toBeVisible();
    const d = (await q("select d.delivery_status, d.number_of_bundles from loading_sessions s join dispatches d on d.id=s.dispatch_id where s.id=$1", [session.id])).rows[0];
    assert.equal(d.delivery_status, "dispatched");
    assert.equal(d.number_of_bundles, 2, "the dispatch lines came from the two scans");
    await s.done();
    const list = await open(width, "loads", i.dispatchUser);
    await list.page.getByLabel("Status").selectOption("completed");
    await expect(list.page.getByText(/MH12AB1234/)).toBeVisible();
    await list.done();
  });

  test(`AP-019 security checks the plate and lets the vehicle out with an e-way reason; the register lists it, at ${width}px`, async () => {
    const o = await readyOrder({ tags: ["G-1"] });
    await setup(async f => {
      const s = await f.ap("ap_dispatch", "start", { order_id: o.order, vehicle_number: "MH12AB1234" });
      await f.ap("ap_dispatch", "scan", { session_id: s.id, tag: "G-1" });
      const dispatchId = await f.writeDispatch(s.id);
      await f.ap("ap_dispatch", "complete", { id: s.id, dispatch_id: dispatchId });
    });
    const g = await open(width, "gate", i.dispatchUser, { supervisor: false });
    await expect(g.page.getByText("MH12AB1234").first()).toBeVisible();
    await g.page.getByLabel(/Number plate for/).fill("MH12AB9999");
    await expect(g.page.getByRole("alert").filter({ hasText: "This is not the dispatch vehicle" })).toBeVisible();
    await g.page.getByLabel(/Number plate for/).fill("mh 12 ab 1234");
    await g.page.getByLabel("Why it leaves without an e-way bill").fill("Portal down; generated from the mobile app");
    await shot(g.page, "gate", width);
    await g.page.getByRole("button", { name: "Vehicle out" }).click();
    await expect(g.page.getByRole("status").filter({ hasText: "left with dispatch" })).toBeVisible();
    await g.page.getByRole("button", { name: "Gate register" }).click();
    await expect(g.page.getByText("Missing: Portal down", { exact: false })).toBeVisible();
    await shot(g.page, "gate-register", width);
    await g.done();
  });

  test(`AP-051 dispatch plans from the ready list with released and held kilograms and credit marked, at ${width}px`, async () => {
    const o = await readyOrder({ tags: ["R-1", "R-2"] });
    await readyOrder({ tags: ["R-H"], approvedKg: 0 });
    await setup(f => f.seed("insert into order_credit_holds(company_id,order_id,customer_id,status,reasons,exposure,credit_limit,overdue_beyond_grace,requested_by) values($1,$2,$3,'held',array['over_limit'],1,0,0,$4)",
      [i.company, o.order, i.customer2, i.sales]));
    const r = await open(width, "ready", i.sales);
    await expect(r.page.getByRole("heading", { name: /Sharma Fabricators/ })).toBeVisible();
    await expect(r.page.getByText("Credit hold")).toBeVisible();
    await r.page.getByLabel("Only lines with released material").uncheck();
    await expect(r.page.getByText(/kg held: QC has not released/)).toBeVisible();
    await shot(r.page, "ready-to-ship", width);
    await r.done();
  });

  test(`AP-017 a recorded bundle's label prints from the station queue and the audit counts it, at ${width}px`, async () => {
    await approveTemplate();
    await setup(f => f.ap("ap_dispatch", "save_station", { name: "Packing table 1", is_default: true, auto_print: false }, i.dispatchManager));
    await readyOrder({ tags: ["L-1"] });
    const l = await open(width, "labels", i.dispatchUser);
    await expect(l.page.locator(".bundle-label").filter({ hasText: "L-1" }).first()).toBeVisible();
    await expect(l.page.getByText("Sharma Fabricators").first()).toBeVisible();
    await shot(l.page, "label-station", width);
    await l.page.getByRole("button", { name: "Print" }).first().click();
    await expect(l.page.getByRole("status").filter({ hasText: "Label L-1 printed" })).toBeVisible();
    assert.equal((await q("select count(*)::int c from packing_label_prints p join prepared_physical_bundles b on b.id=p.bundle_id where b.bundle_number='L-1'")).rows[0].c, 1);
    await expect(l.page.getByText("1 of 1 bundles recorded in 7 days have a label", { exact: false })).toBeVisible();
    await l.done();
  });

  test(`AP-035 the order shows the packing standard from the customer spec and the deviations, at ${width}px`, async () => {
    const spec = await open(width, "spec", i.dispatchManager, { customerId: i.customer2 });
    await spec.page.getByRole("button", { name: "Set spec" }).click();
    await spec.page.getByLabel("Max bundle kg").fill("120");
    await spec.page.getByLabel("Max pieces per bundle").fill("25");
    await spec.page.getByLabel("Interleaving paper between pieces").check();
    await spec.page.getByLabel(/SF-23/).check();
    await spec.page.getByLabel("Why it changes").fill("Customer packing sheet dated 1 Nov");
    await spec.page.getByRole("button", { name: "Save revision" }).click();
    await expect(spec.page.getByText("Revision 1: ≤ 120 kg", { exact: false })).toBeVisible();
    await spec.done();
    const o = await setup(f => f.order({ pieces: 100 }));
    const order = await open(width, "order", i.dispatchManager, { orderId: o.order });
    await expect(order.page.getByText("Pack 21 pieces per bundle (about 119.7 kg); 5 bundles, last one 16 pcs", { exact: false })).toBeVisible();
    await shot(order.page, "packing-plan", width);
    await order.done();
    const p = await open(width, "packing", i.dispatchManager);
    await expect(p.page.getByRole("heading", { name: "Packing deviations" })).toBeVisible();
    await p.done();
  });

  test(`AP-036 freight is proposed from the cheapest card and the override needs a reason, at ${width}px`, async () => {
    await setup(f => f.ap("ap_freight", "save_card", { transporter_id: i.transporter, basis: "per_kg", destination_state: "27", destination_city: "Pune", rate: 3.8, min_charge: 1500, effective_from: istDay(-5) }, i.dispatchManager));
    const cards = await open(width, "freight", i.dispatchManager);
    await expect(cards.page.getByRole("cell", { name: "VRL Logistics" }).first()).toBeVisible();
    await shot(cards.page, "freight-cards", width);
    await cards.done();
    const o = await readyOrder({ tags: ["F-1"] });
    const dispatchId = await setup(async f => {
      const s = await f.ap("ap_dispatch", "start", { order_id: o.order, vehicle_number: "MH12AB1234" });
      await f.ap("ap_dispatch", "scan", { session_id: s.id, tag: "F-1" });
      return f.writeDispatch(s.id);
    });
    const d = await open(width, "dispatch", i.dispatchManager, { dispatchId });
    await d.page.getByRole("button", { name: "Estimate freight" }).click();
    await expect(d.page.getByText("Freight ₹1,500.00 with VRL Logistics", { exact: false })).toBeVisible();
    await d.page.getByRole("button", { name: "Edit" }).click();
    await d.page.getByLabel("Freight agreed (₹)").fill("1800");
    await d.page.getByRole("button", { name: "Accept with these changes" }).click();
    await expect(d.page.getByRole("alert").filter({ hasText: "Say why the estimate is overridden" })).toBeVisible();
    await d.page.getByLabel("Reason for the change").fill("Transporter added a loading charge");
    await d.page.getByRole("button", { name: "Accept with these changes" }).click();
    await expect(d.page.getByText(/₹1,800.00 with VRL Logistics/)).toBeVisible();
    await shot(d.page, "freight-dispatch", width);
    await d.done();
  });

  test(`AP-081 accounts downloads the e-way bill file for a posted dispatch and records the EWB number back, at ${width}px`, async () => {
    const o = await readyOrder({ tags: ["E-1"] });
    const dispatchId = await setup(async f => {
      const s = await f.ap("ap_dispatch", "start", { order_id: o.order, vehicle_number: "MH12AB1234" });
      await f.ap("ap_dispatch", "scan", { session_id: s.id, tag: "E-1" });
      const id = await f.writeDispatch(s.id);
      const invoice = f.next();
      await f.seed(`insert into invoices(id,company_id,customer_id,order_id,dispatch_id,invoice_number,invoice_date,status,subtotal,tax_total,grand_total,amount_paid,igst_amount,place_of_supply_state_code,supplier_state_code)
        values($1,$2,$3,$4,$5,'OMX/26-27/0301',current_date,'generated',34200,6156,40356,0,6156,'27','07')`, [invoice, i.company, i.customer2, o.order, id]);
      await f.seed(`insert into invoice_items(company_id,invoice_id,profile_id,item_description,quantity,quantity_kg,unit_rate,line_total,gst_percent,hsn_code,line_kind) values($1,$2,$3,'Sliding track',114,114,300,34200,18,'7604','goods')`,
        [i.company, invoice, i.profile2]);
      return id;
    });
    const e = await open(width, "eway", i.accounts);
    await e.page.getByLabel(/Distance for/).fill("1420");
    await e.page.getByRole("button", { name: "Confirm" }).click();
    await e.page.getByLabel(/Select DC|Select/).first().check();
    await shot(e.page, "eway-queue", width);
    await e.page.getByRole("button", { name: /Download e-way bill file \(1\)/ }).click();
    await expect(e.page.getByRole("status").filter({ hasText: "1 e-way bill(s) in the file" })).toBeVisible();
    const file = JSON.parse(await e.page.evaluate(() => window.downloads.at(-1)));
    assert.equal(file.billLists[0].docNo, "OMX/26-27/0301");
    assert.equal(file.billLists[0].transDistance, 1420);
    await e.page.getByLabel("Portal result").fill("OMX/26-27/0301\t3410 0000 5678");
    await e.page.getByRole("button", { name: "Record numbers" }).click();
    await expect(e.page.getByText("recorded on", { exact: false })).toBeVisible();
    assert.equal((await q("select eway_bill_number from dispatches where id=$1", [dispatchId])).rows[0].eway_bill_number, "341000005678");
    await e.done();
  });

  test(`AP-083 accounts maps ledgers and downloads the Tally XML; exported vouchers leave the pending list, at ${width}px`, async () => {
    const t = await open(width, "tally", i.accounts);
    await t.page.getByLabel("From", { exact: true }).fill(istDay(-28));
    await t.page.getByLabel("To", { exact: true }).fill(istDay(0));
    await expect(t.page.getByText(/Sales pending/)).toBeVisible();
    await t.page.getByRole("button", { name: "Download Tally XML" }).click();
    await expect(t.page.getByText("Kept back (they stay pending):")).toBeVisible();
    for (const [kind, name] of [["sales", "Sales"], ["output_igst", "Output IGST"]]) {
      await t.page.getByLabel("Ledger for").selectOption(kind);
      await t.page.getByLabel("Tally ledger name").fill(name);
      await t.page.getByRole("button", { name: "Save mapping" }).click();
      await expect(t.page.getByRole("status").filter({ hasText: "Ledger mapped" })).toBeVisible();
    }
    await t.page.getByRole("button", { name: "Download Tally XML" }).click();
    await expect(t.page.getByRole("status").filter({ hasText: "voucher(s) in the file" })).toBeVisible();
    const xml = await t.page.evaluate(() => window.downloads.at(-1));
    assert.match(xml, /<TALLYREQUEST>Import Data<\/TALLYREQUEST>/);
    assert.match(xml, /<VOUCHERNUMBER>OMX\/26-27\/0103<\/VOUCHERNUMBER>/);
    assert.match(xml, /<LEDGERNAME>Sales<\/LEDGERNAME><ISDEEMEDPOSITIVE>No<\/ISDEEMEDPOSITIVE>/, "the mapped sales ledger is credited");
    await expect(t.page.getByText("Nothing pending for these dates.")).toBeVisible();
    await shot(t.page, "tally", width);
    await t.done();
  });

  test(`AP-089 and AP-060 the order copies a customer summary and shares a status link, at ${width}px`, async () => {
    const o = await readyOrder({ tags: ["S-1"] });
    await setup(f => f.seed("update orders set notes='Keep this internal' where id=$1", [o.order]));
    const order = await open(width, "order", i.sales, { orderId: o.order });
    await order.page.getByRole("button", { name: "Copy summary", exact: true }).click();
    const summary = order.page.getByLabel("Customer summary");
    await expect(summary).toContainText("*Order ");
    await expect(summary).not.toContainText("Keep this internal");
    await order.page.getByRole("button", { name: "Copy internal summary" }).click();
    await expect(order.page.getByLabel("Internal summary")).toContainText("Keep this internal");
    await order.page.getByRole("button", { name: "Share status" }).click();
    await expect(order.page.getByText("/status/", { exact: false })).toBeVisible();
    await expect(order.page.getByText("Send on WhatsApp")).toBeVisible();
    await shot(order.page, "order-share", width);
    assert.equal((await q("select count(*)::int c from order_status_links where order_id=$1", [o.order])).rows[0].c, 1);
    await order.done();
  });
}

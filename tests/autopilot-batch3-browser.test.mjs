import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { createCashBrowserFixture } from "../scripts/lib/autopilot-batch3-browser-fixture.mjs";
import { cIds as i, istDay, nid } from "../scripts/lib/autopilot-batch3-fixture.mjs";

let fixture, browser;
const evidence = "docs/evidence/AUTOPILOT_BATCH_3";
const today = istDay(0);
test.before(async () => { fixture = await createCashBrowserFixture(); browser = await chromium.launch({ headless: true }); mkdirSync(evidence, { recursive: true }); });
test.after(async () => { await browser?.close(); await fixture?.close(); });
test.beforeEach(async () => { await fixture.start(); });
const contexts = [];
test.afterEach(async () => { for (const context of contexts.splice(0)) await context.close().catch(() => {}); await fixture.rollback(); });


const q = (sql, params = []) => fixture.run(() => fixture.f.db.query(sql, params));
const setup = work => fixture.run(() => work(fixture.f));
async function open(width, screen, userId, options = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: "Asia/Kolkata" });
  contexts.push(context);
  const page = await context.newPage();
  const errors = [];
  page.setDefaultTimeout(15000); page.on("pageerror", error => errors.push(error.message));
  await page.goto(fixture.base);
  await page.evaluate(([screen, userId, options]) => window.mount(screen, userId, options), [screen, userId, { today, ...options }]);
  await expect(page.getByRole("heading", { name: `Cash fixture: ${screen}` })).toBeVisible();
  return { page, errors, done: async () => { assert.deepEqual(errors, []); await noOverflow(page); } };
}
const noOverflow = async page => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no sideways page scroll");
const shot = (page, name, width) => page.screenshot({ path: `${evidence}/${name}-${width === 375 ? "phone" : "desktop"}.png`, fullPage: true });
const setLimit = (limit = "50000") => setup(x => x.call("ap_credit", "set_limit", { customer_id: i.customer2, credit_limit: limit, grace_days: "30", reason: "Agreed at review" }, i.accounts));

for (const width of [375, 1280]) {
  test(`AP-032 an approver decides a credit hold from the queue; the order and customer show exposure and history, at ${width}px`, async () => {
    await setLimit();
    await setup(x => x.confirmOrder({ id: nid(5000), value: 30000 }));
    const holds = await open(width, "holds", i.owner);
    await expect(holds.page.getByText("Exposure INR 65,000.00 is above the INR 50,000.00 credit limit")).toBeVisible();
    await holds.page.getByRole("button", { name: "Refuse" }).click();
    await expect(holds.page.getByRole("alert")).toContainText("Say why credit is refused");
    await holds.page.getByLabel("Decision note").fill("Advance cheque received today");
    await holds.page.getByRole("button", { name: "Approve credit" }).click();
    await expect(holds.page.getByRole("status").filter({ hasText: "Credit approved" })).toBeVisible();
    assert.equal((await q("select status from order_credit_holds where order_id=$1", [nid(5000)])).rows[0].status, "approved");
    await shot(holds.page, "credit-holds", width);
    await holds.done();
    const order = await open(width, "order", i.sales, { orderId: nid(5000) });
    await expect(order.page.getByRole("heading", { name: "Credit check" })).toBeVisible();
    await expect(order.page.getByText("approval valid until", { exact: false })).toBeVisible();
    await order.done();
    const customer = await open(width, "customer", i.accounts, { customerId: i.customer2 });
    await expect(customer.page.getByText("Limit ₹50,000.00", { exact: false })).toBeVisible();
    await customer.page.getByText("Change the credit limit").click();
    await customer.page.getByLabel("Limit (₹)").fill("80000");
    await customer.page.getByLabel("Reason").fill("Raised after two months on time");
    await customer.page.getByRole("button", { name: "Save limit" }).click();
    await expect(customer.page.getByRole("status").filter({ hasText: "Credit limit saved" })).toBeVisible();
    await shot(customer.page, "customer-credit", width);
    await customer.done();
  });

  test(`AP-045 the planner releases a draft group as planned jobs; a held order is skipped with the reason, at ${width}px`, async () => {
    await setLimit();
    await setup(async x => {
      await x.confirmOrder({ id: nid(5100), value: 10000, lines: [{ id: nid(5101), kg: 570, pieces: 100, die: i.die }] });
      await x.confirmOrder({ id: nid(5102), value: 90000, lines: [{ id: nid(5103), kg: 285, pieces: 50, die: i.die }] });
    });
    const { page, done } = await open(width, "drafts", i.productionManager);
    await expect(page.getByText("Die D-2045-A", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: /Review/ }).click();
    await expect(page.getByText("Order on credit hold: released only after credit is approved.")).toBeVisible();
    await page.getByLabel("Planned date (optional)").fill(istDay(1));
    await page.getByRole("button", { name: /Release 2 lines as planned jobs/ }).click();
    await expect(page.getByRole("status").filter({ hasText: /Created J-/ })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: /credit hold/ })).toBeVisible();
    await shot(page, "draft-jobs", width);
    assert.equal(Number((await q("select count(*) c from production_jobs where order_id=$1 and status='planned'", [nid(5100)])).rows[0].c), 1);
    await done();
  });

  test(`AP-046 accounts sees the gate-out draft with totals and explains an unbilled dispatch, at ${width}px`, async () => {
    await setup(async x => {
      await x.confirmOrder({ id: nid(5200), value: 1000, lines: [{ id: nid(5201), kg: 100 }] });
      await x.packDispatch({ id: nid(5202), order: nid(5200), lines: [{ id: nid(5203), kg: 100, rate: 300, item: nid(5201) }] });
      await x.gateOut(nid(5202));
      await x.seed("update dispatches set actual_dispatched_at=now()-interval '6 days' where id=$1", [nid(5202)]);
    });
    const { page, done } = await open(width, "invoices", i.accounts);
    await expect(page.getByText("= ₹35,400.00", { exact: false })).toBeVisible();
    await expect(page.getByText("place of supply Maharashtra", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Post", exact: true }).click();
    await expect(page.getByText("Posting runs the reviewed invoice save", { exact: false })).toBeVisible();
    await shot(page, "invoice-drafts", width);
    await page.getByRole("tab", { name: "Unbilled dispatches" }).click();
    await expect(page.getByText("1 late without explanation", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Explain why it is not invoiced" }).click();
    await page.getByLabel("Why it is not invoiced yet").fill("Customer asked to bill with the next load");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Explained: Customer asked to bill with the next load")).toBeVisible();
    await shot(page, "unbilled", width);
    await done();
  });

  test(`AP-037 accounts confirms the place-of-supply rule; the invoice form shows the derived state and records an override, at ${width}px`, async () => {
    const gst = await open(width, "gst", i.accounts);
    await expect(gst.page.getByText("Not confirmed yet", { exact: false })).toBeVisible();
    await gst.page.getByLabel("Note").fill("Confirmed with the CA");
    await gst.page.getByRole("button", { name: "Confirm the rule" }).click();
    await expect(gst.page.getByText("Confirmed v1", { exact: false })).toBeVisible();
    await shot(gst.page, "gst-rule", width);
    await gst.done();
    await setup(async x => {
      await x.confirmOrder({ id: nid(5300), value: 1000 });
      await x.packDispatch({ id: nid(5301), order: nid(5300), lines: [{ id: nid(5302), kg: 10 }] });
    });
    const supply = await open(width, "supply", i.accounts, { orderId: nid(5300), dispatchId: nid(5301), chosen: "07" });
    await expect(supply.page.getByText("Derived:", { exact: false })).toContainText("Maharashtra");
    await supply.page.getByLabel("Reason for a different place of supply").fill("Bill-to party instructed delivery to Delhi branch");
    await supply.page.getByRole("button", { name: "Record override" }).click();
    await expect(supply.page.getByRole("status").filter({ hasText: "Override recorded" })).toBeVisible();
    await supply.page.getByRole("button", { name: "Use Maharashtra" }).click();
    await expect(supply.page.getByLabel("Place of supply")).toHaveValue("27");
    await supply.done();
  });

  test(`AP-024 / AP-058 a bank match is accepted on the card, an unknown remitter is assigned, and money is received by hand oldest first, at ${width}px`, async () => {
    await setup(x => x.call("ap_cash", "bank_import", { source_name: "HDFC.csv", file_fingerprint: (width === 375 ? "a" : "b").repeat(32), rows: [
      { line_no: 1, txn_date: istDay(-1), narration: "NEFT CR-SBIN0001234-SHARMA FABRICATORS-OMX/26-27/0101", reference: "SBIN123456789", credit: "10000" },
      { line_no: 2, txn_date: istDay(-1), narration: "IMPS 998877 RAJ ENTERPRISES", credit: "700" }] }, i.accounts));
    const bank = await open(width, "bank", i.accounts);
    await expect(bank.page.getByText("Receipt INR 10,000.00 from Sharma Fabricators")).toBeVisible();
    await shot(bank.page, "bank-matches", width);
    await bank.page.getByRole("button", { name: /^Accept/ }).first().click();
    await expect.poll(async () => (await q("select state from bank_statement_lines where reference='SBIN123456789'")).rows[0].state).toBe("receipted");
    await bank.page.getByRole("button", { name: "Assign customer" }).first().click();
    await bank.page.getByLabel("Search customer").fill("Fix");
    await bank.page.getByRole("button", { name: /Fixture customer/ }).click();
    await expect(bank.page.getByRole("status").filter({ hasText: '"RAJ ENTERPRISES" will be recognised next time' })).toBeVisible();
    await bank.done();
    const receive = await open(width, "receive", i.accounts);
    await receive.page.getByLabel("Find customer").fill("Sharma");
    await receive.page.getByRole("combobox", { name: "Customer", exact: true }).selectOption(i.customer2);
    await receive.page.getByLabel("Amount received (₹)").fill("26000");
    await receive.page.getByLabel("UTR / cheque no.").fill("UTR-HAND-1");
    await receive.page.getByRole("button", { name: "Propose allocation" }).click();
    await expect(receive.page.getByLabel("Amount for OMX/26-27/0102")).toHaveValue("20000");
    await expect(receive.page.getByText("on account ₹1,000.00", { exact: false })).toBeVisible();
    await shot(receive.page, "receive-money", width);
    await receive.page.getByRole("button", { name: "Record receipt" }).click();
    await expect(receive.page.getByRole("status").filter({ hasText: "₹1,000.00 on account" })).toBeVisible();
    await expect(receive.page.getByRole("button", { name: "Apply to oldest invoices" }).or(receive.page.getByText("no open invoice"))).toBeVisible();
    await receive.done();
  });

  test(`AP-084 the reminder queue is copied, sent and covered; AP-031 an expired quotation is extended with approval; AP-097/098 audits show, at ${width}px`, async () => {
    await setup(x => x.call("ap_cash", "prepare_reminders", {}, i.accounts));
    const rem = await open(width, "reminders", i.accounts);
    await expect(rem.page.getByRole("link", { name: "Sharma Fabricators" }).first()).toBeVisible();
    await rem.page.getByText("Prepared message").click();
    await expect(rem.page.getByText("This is a gentle reminder", { exact: false })).toBeVisible();
    await expect(rem.page.getByRole("link", { name: "Open in WhatsApp" })).toHaveAttribute("href", /wa\.me\/919820000002/);
    await rem.page.getByRole("button", { name: "Mark sent" }).click();
    await expect(rem.page.getByRole("status").filter({ hasText: "marked sent" })).toBeVisible();
    await shot(rem.page, "reminders", width);
    await rem.done();
    await setup(async x => {
      await x.seed(`insert into quotes(id,company_id,quote_number,customer_id,quote_date,valid_until,status,subtotal,total_before_gst,gst_percent,gst_amount,grand_total,revision_number,created_by)
        values($1,$2,'Q-B3-LAPSED',$3,$4,$5,'expired',23000,23000,18,4140,27140,1,$6)`, [nid(5400), i.company, i.customer2, istDay(-16), istDay(-1), i.sales]);
      await x.seed(`insert into quote_items(id,company_id,quote_id,profile_id,item_description,quantity_pieces,length_per_piece_m,section_weight_kg_per_m,total_weight_kg,billet_rate_per_kg,conversion_charge_per_kg,
          gst_percent,hsn_code,drawing_approval_status,costing_complete,revision_number,expected_recovery_percent,margin_percent)
        values($1,$2,$3,$4,'Sliding track',100,6,0.95,570,230,35,18,'7604','Approved',true,1,90,10)`, [nid(5401), i.company, nid(5400), i.profile2]);
    });
    const quote = await open(width, "quote", i.sales, { quoteId: nid(5400) });
    await quote.page.getByText("Extend validity (needs approval)").click();
    await quote.page.getByLabel("New date").fill(istDay(10));
    await quote.page.getByLabel("Reason").fill("Customer confirms the order after site visit");
    await quote.page.getByRole("button", { name: "Request extension" }).click();
    await expect(quote.page.getByRole("status").filter({ hasText: "Extension requested" })).toBeVisible();
    await quote.done();
    const manager = await open(width, "quote", i.salesManager, { quoteId: nid(5400) });
    await manager.page.getByRole("button", { name: "Approve" }).click();
    await expect(manager.page.getByRole("status").filter({ hasText: "Extension approved" })).toBeVisible();
    await shot(manager.page, "quote-validity", width);
    assert.equal((await q("select status from quotes where id=$1", [nid(5400)])).rows[0].status, "sent");
    await manager.done();
    const audit = await open(width, "audit", i.owner);
    await expect(audit.page.getByRole("heading", { name: "Possible duplicates in the last 90 days" })).toBeVisible();
    await expect(audit.page.getByRole("heading", { name: "Closed by the system" })).toBeVisible();
    await shot(audit.page, "audit", width);
    await audit.done();
  });
}

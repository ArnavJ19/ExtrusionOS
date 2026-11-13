import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { createDispatchBrowserFixture } from "../scripts/lib/autopilot-batch4-browser-fixture.mjs";
import { dIds as i, istDay, nid } from "../scripts/lib/autopilot-batch4-fixture.mjs";

// Autopilot batch 5 screens (AP-026, AP-056, AP-071, AP-072) on the batch 4 browser fixture.
let fixture, browser;
const evidence = "docs/evidence/AUTOPILOT_BATCH_5";
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
  return { page, errors, done: async () => { assert.deepEqual(errors, []); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no sideways page scroll"); } };
}
const shot = (page, name, width) => page.screenshot({ path: `${evidence}/${name}-${width === 375 ? "phone" : "desktop"}.png`, fullPage: true });

async function quote({ status = "sent", sentDaysAgo = 3, rate = 38 } = {}) {
  return setup(async f => {
    const id = f.next();
    await f.seed(`insert into quotes(id,company_id,quote_number,customer_id,quote_date,valid_until,status,sent_at,grand_total,created_by,revision_number)
      values($1,$2,$3,$4,current_date-$5::int,current_date+10,$6,case when $6='sent' then now()-make_interval(days=>$5::int) end,59000,$7,1)`, [id, i.company, `Q-B-${id.slice(-4)}`, i.customer2, sentDaysAgo, status, i.sales]);
    await f.seed(`insert into quote_items(id,company_id,quote_id,profile_id,quantity_pieces,length_per_piece_m,section_weight_kg_per_m,total_weight_kg,effective_weight_kg,billing_weight_kg,conversion_charge_per_kg,finishing_type)
      values($1,$2,$3,$4,100,6,0.95,500,500,500,$5,'mill_finish')`, [f.next(), i.company, id, i.profile2, rate]);
    return id;
  });
}

for (const width of [375, 1280]) {
  test(`AP-026 the quotation form offers the customer's usual finish and payment terms with where they came from, at ${width}px`, async () => {
    await setup(async f => {
      for (const days of [1, 4, 9]) {
        const id = f.next();
        await f.seed(`insert into orders(id,company_id,order_number,customer_id,order_date,priority,current_stage,order_value) values($1,$2,$3,$4,current_date-$5::int,'normal','delivered',1000)`, [id, i.company, `SO-H-${days}`, i.customer2, days]);
        await f.seed("insert into order_items(company_id,order_id,profile_id,quantity_kg,finishing_type) values($1,$2,$3,100,'powder_coating')", [i.company, id, i.profile2]);
        await f.seed("insert into quotes(company_id,quote_number,customer_id,quote_date,status,payment_terms) values($1,$2,$3,current_date-$4::int,'sent','30 days credit')", [i.company, `Q-H-${days}`, i.customer2, days]);
      }
    });
    const u = await open(width, "usual", i.sales, { customerId: i.customer2 });
    await expect(u.page.getByText("used in 3 of the last 3 orders")).toBeVisible();
    await shot(u.page, "usual-choices", width);
    await u.page.getByRole("listitem").filter({ hasText: "Finish" }).getByRole("button", { name: "Use" }).click();
    await u.page.getByRole("listitem").filter({ hasText: "Payment terms" }).getByRole("button", { name: "Not now" }).click();
    await expect(u.page.getByTestId("form-state")).toHaveText("Payment terms: blank · Finish: powder_coating");
    await expect.poll(async () => (await q("select field, decision from customer_usual_choice_events order by field")).rows.map(r => `${r.field}:${r.decision}`).join(",")).toBe("finish:used,payment_terms:dismissed");
    await u.done();
  });

  test(`AP-056 production sees late vendor material with a prepared message and records the vendor's date, at ${width}px`, async () => {
    const jobId = await setup(async f => {
      const vendor = nid(8100);
      await f.seed("insert into vendors(id,company_id,vendor_name,vendor_type,phone,is_active) values($1,$2,'Shine Anodisers','anodizing','9876543210',true)", [vendor, i.company]);
      await f.seed("insert into factory_finishing_lead_times(company_id,finishing_type,lead_days,updated_by) values($1,'anodizing',3,$2)", [i.company, i.owner]);
      const o = await f.order({});
      const job = await f.readyJob({ order: o.order, line: o.line, kg: 570, number: "JOB-ANOD-7" });
      const fj = f.next();
      await f.seed(`insert into finishing_jobs(id,company_id,order_id,production_job_id,finishing_type,shade_name,vendor_id,sent_date,input_weight_kg,status) values($1,$2,$3,$4,'anodizing','Silver',$5,current_date-12,500,'sent_to_vendor')`,
        [fj, i.company, o.order, job, vendor]);
      return fj;
    });
    const c = await open(width, "chase", i.productionManager);
    await expect(c.page.getByRole("heading", { name: "Shine Anodisers" })).toBeVisible();
    await expect(c.page.getByText("1 late or unaccounted job(s); 1 without a current promise.", { exact: false })).toBeVisible();
    await c.page.getByRole("button", { name: "Copy message" }).click();
    await expect(c.page.getByRole("status").filter({ hasText: "It is not marked sent" })).toBeVisible();
    await shot(c.page, "vendor-chase", width);
    await c.page.getByLabel("Promised date").fill(istDay(2));
    await c.page.getByRole("button", { name: "Record promise (1)" }).click();
    await expect(c.page.getByRole("status").filter({ hasText: "Promise from Shine Anodisers recorded" })).toBeVisible();
    await expect(c.page.getByText("No vendor-held material needs a chase today.")).toBeVisible();
    assert.equal((await q("select count(*)::int c from finishing_vendor_followups where finishing_job_id=$1 and kind='promise'", [jobId])).rows[0].c, 1);
    await c.done();
  });

  test(`AP-071 a due follow-up shows in the queue with the prepared message and recording the result schedules the next, at ${width}px`, async () => {
    const id = await quote({ sentDaysAgo: 3 });
    await setup(f => f.one("select private.ap5_followups_job($1) v", [i.company]));
    const fq = await open(width, "followups", i.sales);
    await expect(fq.page.getByText("1 of 1 open quotation(s) have a next follow-up date.")).toBeVisible();
    await expect(fq.page.getByText("Day 2 after sending", { exact: false })).toBeVisible();
    await shot(fq.page, "followup-queue", width);
    await fq.page.getByRole("button", { name: "Record result" }).first().click();
    await fq.page.getByLabel("What happened").selectOption("considering");
    await fq.page.getByLabel("Next follow-up (optional)").fill(istDay(3));
    await fq.page.getByRole("button", { name: "Record result" }).last().click();
    await expect(fq.page.getByRole("status").filter({ hasText: "Recorded. Next follow-up" })).toBeVisible();
    await fq.done();
    const panel = await open(width, "quote-sales", i.sales, { quoteId: id });
    await expect(panel.page.getByRole("listitem").filter({ hasText: "Still considering" })).toBeVisible();
    await panel.done();
  });

  test(`AP-072 sales requests a below-floor approval and the owner approves it on the quotation, at ${width}px`, async () => {
    await setup(f => f.call("ap_quote_sales", "save_floor", { alloy: "6063", finishing_type: "mill_finish", floor_per_kg: 40, reason: "6063 mill finish floor" }, i.owner));
    const id = await quote({ status: "internal_review", rate: 38 });
    const s = await open(width, "quote-sales", i.sales, { quoteId: id });
    await expect(s.page.getByText("1 line(s) below floor")).toBeVisible();
    await s.page.getByLabel("Why below the floor").fill("Repeat project; competitor quoted 37 per kg");
    await s.page.getByRole("button", { name: "Request approval" }).click();
    await expect(s.page.getByRole("status").filter({ hasText: "Approval requested" })).toBeVisible();
    await shot(s.page, "floor-request", width);
    await s.done();
    const floors = await open(width, "floors", i.owner, { canDecide: true });
    await expect(floors.page.getByText("Repeat project; competitor quoted 37 per kg", { exact: false })).toBeVisible();
    await floors.done();
    const o = await open(width, "quote-sales", i.owner, { quoteId: id });
    await o.page.getByRole("button", { name: "Decide" }).click();
    await o.page.getByRole("button", { name: "Approve" }).click();
    await expect(o.page.getByText("Approved below floor")).toBeVisible();
    assert.equal((await q("select status from quote_floor_exceptions where quote_id=$1", [id])).rows[0].status, "approved");
    await shot(o.page, "floor-approved", width);
    await o.done();
  });
}

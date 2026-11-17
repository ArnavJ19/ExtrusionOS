import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { createBatch6BrowserFixture } from "../scripts/lib/autopilot-batch6-browser-fixture.mjs";
import { ids as i, istDay } from "../scripts/lib/autopilot-batch6-fixture.mjs";

let fixture, browser; const contexts = []; const evidence = "docs/evidence/AUTOPILOT_BATCH_6";
test.before(async () => { fixture = await createBatch6BrowserFixture("ops"); browser = await chromium.launch({ headless: true }); mkdirSync(evidence, { recursive: true }); });
test.after(async () => { await browser?.close(); await fixture?.close(); });
test.beforeEach(async () => { await fixture.start(); });
test.afterEach(async () => { for (const context of contexts.splice(0)) await context.close(); await fixture.rollback(); });
const setup = work => fixture.run(() => work(fixture.f));
async function open(width, screen, actor = i.owner, options = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, permissions: ["clipboard-read", "clipboard-write"], timezoneId: "Asia/Kolkata", acceptDownloads: true }); contexts.push(context);
  const page = await context.newPage(); const errors = []; page.setDefaultTimeout(20000); page.on("pageerror", e => errors.push(e.message));
  await page.goto(fixture.base); await page.evaluate(([s, u, o]) => window.mount(s, u, o), [screen, actor, { today: istDay(), ...options }]);
  return { page, done: async name => { assert.deepEqual(errors, []); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no horizontal page scroll"); await page.screenshot({ path: `${evidence}/${name}-${width}.png`, fullPage: true }); } };
}
const count = sql => fixture.run(async () => (await fixture.f.one(sql)).n);
const SNAPSHOTS = [{ legal_name: "Omalco Extrusion Pvt Ltd", gst_number: "07AAACX1234A1ZZ", billing_address: "Plot 7, Industrial Area", city: "Delhi", pincode: "110020" },
  { company_name: "Sharma Fabricators", gst_number: "27ABCDE1234F1Z0", billing_address: "Gate 3, Chakan MIDC", city: "Pune", pincode: "411001" }];

for (const width of [375, 1280]) {
  test(`AP-027 section weight by die, trend and the drift decision at ${width}px`, async () => {
    await setup(async f => { await f.seed("update aluminium_profiles set weight_tolerance_percent=2 where id=$1", [i.profile2]); await f.dieJob({ kgms: [1.0, 1.01, 0.99, 1.0] }); });
    const v = await open(width, "weight", i.quality);
    await expect(v.page.getByText("D-2045-A", { exact: true })).toBeVisible();
    await expect(v.page.getByText("Heavier than the master").first()).toBeVisible();
    await v.page.getByRole("button", { name: "Check drift now" }).click();
    await expect(v.page.getByText(/Section weight heavy on die D-2045-A/)).toBeVisible();
    await v.page.getByRole("button", { name: "Accept", exact: true }).click();
    await expect.poll(() => count("select count(*)::int n from tasks where title='Inspect die for section-weight drift'")).toBe(1);
    await v.done("weight-drift");
    const d = await open(width, "die-weight", i.productionManager, { dieId: i.die });
    await expect(d.page.getByRole("img", { name: /Actual kg per metre/ })).toBeVisible();
    await expect(d.page.getByText("±2% (profile master)", { exact: false })).toBeVisible();
    await d.done("die-weight");
  });

  test(`AP-030 reprice drafts in one action with an impact list at ${width}px`, async () => {
    await setup(async f => { await f.draftQuote({ rate: 230 }); await f.sentQuote({ boundRate: 230 }); });
    const v = await open(width, "reprice", i.owner);
    await expect(v.page.getByRole("cell", { name: "₹245.00" }).first()).toBeVisible();
    await expect(v.page.getByText("Sent quotations: rate moved since sent")).toBeVisible();
    await v.page.getByRole("button", { name: /Reprice 1 draft/ }).click();
    await expect(v.page.getByText(/1 draft\(s\) repriced/)).toBeVisible();
    await expect.poll(() => count("select count(*)::int n from quote_reprice_runs")).toBe(1);
    await v.done("reprice");
    const s = await open(width, "reprice", i.sales, { canApply: false });
    await expect(s.page.getByText(/An owner or admin applies/)).toBeVisible();
    await s.done("reprice-sales");
  });

  test(`AP-100 the owner sees a failed job on the health page at ${width}px`, async () => {
    await setup(f => f.seed(`insert into system_job_runs(company_id,job_key,window_key,trigger_source,status,started_at,finished_at,examined,proposals_created,alerts_created,error_message)
      values($1,'quotes.expire','day:20261114','cron','failed',now(),now(),0,0,0,'synthetic failure')`, [i.company]));
    const v = await open(width, "health", i.owner);
    await expect(v.page.getByText("Last run failed")).toBeVisible();
    await expect(v.page.getByText("synthetic failure")).toBeVisible();
    await expect(v.page.getByText(/cannot read Supabase backup status/)).toBeVisible();
    await v.done("health");
  });

  test(`AP-033 lead time, suggested reorder point and approval at ${width}px`, async () => {
    await setup(f => f.consumable({ stock: 100 }));
    const v = await open(width, "reorder", i.inventory);
    await expect(v.page.getByText("Enter the supplier lead time").first()).toBeVisible();
    const card = v.page.locator("article").filter({ hasText: "Traceable consumable" }).first();
    await card.getByLabel("Supplier lead time (days)").fill("10");
    await card.getByRole("button", { name: "Save lead time" }).click();
    await expect(card.getByText(/Suggested point 15 kg/)).toBeVisible();
    await card.getByRole("button", { name: "Approve these levels" }).click();
    await expect(v.page.getByText("Reorder point approved.")).toBeVisible();
    await v.done("reorder");
  });

  test(`AP-053 drafted NCR, confirmation, cause and close at ${width}px`, async () => {
    const ncr = await setup(async f => {
      await f.dieJob({ rejected: 20, actual: 180 });
      await f.call("ap_ncr", "save_settings", { job_reject_percent: 5 }, i.quality);
      await f.call("ap_ncr", "detect", {}, i.quality);
      return (await f.one("select id from quality_ncrs limit 1")).id;
    });
    const list = await open(width, "ncrs", i.quality);
    await expect(list.page.getByText(/Rejections above threshold on job/)).toBeVisible();
    await list.done("ncrs");
    const v = await open(width, "ncr", i.quality, { ncrId: ncr });
    await v.page.getByRole("button", { name: "Confirm NCR" }).click();
    await v.page.getByLabel("Cause").fill("Die bearing wear on port 2");
    await v.page.getByLabel("Corrective action").fill("Die corrected and first piece checked");
    await v.page.getByRole("button", { name: "Save cause and action" }).click();
    await v.page.getByRole("button", { name: "Close NCR" }).click();
    await expect.poll(() => count("select count(*)::int n from quality_ncrs where status='closed'")).toBe(1);
    await v.done("ncr-record");
  });

  test(`AP-077 TDS on a part-paid invoice and the register at ${width}px`, async () => {
    await setup(async f => { await f.call("ap_tds", "save_settings", { sections: ["194Q"], default_section: "194Q", default_rate_percent: 0.1, basis: "taxable", tolerance_inr: 1 }, i.accounts); await f.receipt(i.inv1, 9990); });
    const v = await open(width, "tds", i.accounts, { customers: [{ id: i.customer2, name: "Sharma Fabricators" }] });
    await expect(v.page.getByText(/OMX\/26-27\/0101/).first()).toBeVisible();
    await v.page.getByRole("button", { name: "Record for this customer" }).click();
    await v.page.getByRole("button", { name: "₹10.00" }).click();
    await v.page.getByRole("button", { name: /Record TDS on 1 invoice/ }).click();
    await expect(v.page.getByText(/TDS recorded for FY/)).toBeVisible();
    await expect.poll(() => count("select count(*)::int n from tds_deductions")).toBe(1);
    await v.done("tds");
  });

  test(`AP-082 applicability, export and IRN import at ${width}px`, async () => {
    await setup(f => f.seed("update invoices set issued_at=now(), subtotal=10000, tax_total=1800, grand_total=11800, igst_amount=1800, supplier_snapshot=$2, customer_snapshot=$3 where id=$1", [i.inv1, SNAPSHOTS[0], SNAPSHOTS[1]]));
    await setup(f => f.seed("insert into invoice_items(company_id,invoice_id,item_description,hsn_code,quantity,unit_rate,line_total,gst_percent,line_kind) values($1,$2,'Sliding track 6 m','7604',40,250,10000,18,'goods')", [i.company, i.inv1]));
    const v = await open(width, "einvoice", i.accounts);
    await v.page.getByLabel("E-invoicing applies").selectOption("true");
    await v.page.getByLabel("From invoice date").fill(istDay(-90));
    await v.page.getByLabel("Basis (turnover, notification)").fill("Aggregate turnover above the notified limit");
    await v.page.getByRole("button", { name: "Record applicability" }).click();
    await expect(v.page.getByText("Invoices for the IRP")).toBeVisible();
    await v.page.locator("li").filter({ hasText: "OMX/26-27/0101" }).getByRole("checkbox").check();
    await v.page.getByRole("button", { name: /Export 1 invoice/ }).click();
    await expect.poll(() => v.page.evaluate(() => window.downloads.length)).toBe(1);
    const file = JSON.parse(await v.page.evaluate(() => window.downloads[0]));
    assert.equal(file[0].DocDtls.No, "OMX/26-27/0101"); assert.equal(file[0].ValDtls.TotInvVal, 11800);
    const irn = "a".repeat(64), b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
    const qr = `${b64({ alg: "RS256" })}.${b64({ data: JSON.stringify({ DocNo: "OMX/26-27/0101", Irn: irn }) })}.sig`;
    await v.page.getByLabel("Response JSON").fill(JSON.stringify([{ Irn: irn, AckNo: "112010012345678", AckDt: "2026-11-14 10:30:00", SignedQRCode: qr }]));
    await v.page.getByRole("button", { name: "Import response" }).click();
    await expect(v.page.getByText(/1 IRN\(s\) recorded/)).toBeVisible();
    await v.done("einvoice");
  });
}

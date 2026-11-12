import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { createDispatchBrowserFixture } from "../scripts/lib/autopilot-batch4-browser-fixture.mjs";
import { addOperationsHelpers, ids as i, istDay } from "../scripts/lib/autopilot-batch5-operations-fixture.mjs";

let fixture, browser; const contexts = []; const evidence = "docs/evidence/AUTOPILOT_BATCH_5_COMPLETION";
test.before(async () => { fixture = await createDispatchBrowserFixture(); fixture.ops = addOperationsHelpers(fixture.f); browser = await chromium.launch({ headless: true }); mkdirSync(evidence, { recursive: true }); });
test.after(async () => { await browser?.close(); await fixture?.close(); });
test.beforeEach(async () => { await fixture.start(); });
test.afterEach(async () => { for (const context of contexts.splice(0)) await context.close(); await fixture.rollback(); });
const setup = work => fixture.run(() => work(fixture.ops));
async function open(width, screen, actor = i.owner, options = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, permissions: ["clipboard-read", "clipboard-write"], timezoneId: "Asia/Kolkata" }); contexts.push(context);
  const page = await context.newPage(); const errors = []; page.setDefaultTimeout(20000); page.on("pageerror", e => errors.push(e.message));
  await page.goto(fixture.base); await page.evaluate(([s,u,o]) => window.mount(s,u,o), [screen,actor,{today:istDay(),...options}]);
  return { page, done: async name => { assert.deepEqual(errors, []); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await page.screenshot({ path: `${evidence}/${name}-${width}.png`, fullPage: true }); } };
}
for (const width of [375,1280]) {
  test(`AP-080 owner reads and copies the timestamped digest at ${width}px`, async () => {
    await setup(f => f.call("ap_digest","prepare_digest",{},i.owner));
    const v = await open(width,"digest"); await expect(v.page.getByText(/Figures as of/)).toBeVisible();
    await v.page.getByRole("button",{name:"Copy digest"}).click(); await expect(v.page.getByRole("status").filter({hasText:"Nothing has been sent"})).toBeVisible();
    await v.done("digest");
  });
  test(`AP-062 seven-day requirements, sources and shared proposal confirmation at ${width}px`, async () => {
    await setup(f => f.plannedJob({})); const v = await open(width,"billet-forecast",i.productionManager);
    await expect(v.page.getByRole("heading",{name:"6063 / 7 inch"})).toBeVisible();
    await v.page.getByRole("button",{name:"Prepare shortage proposals"}).click();
    await expect(v.page.getByText(/1,000 kg of 6063/)).toBeVisible();
    await v.page.getByRole("button",{name:"Accept",exact:true}).click();
    await expect.poll(async () => (await fixture.run(() => fixture.f.one("select count(*)::int n from proposals where proposal_type='billet.shortage' and status='accepted'"))).n).toBe(1);
    await v.done("billet-forecast");
  });
  test(`AP-063 risk list shows line due date, blocking stage and evidence at ${width}px`, async () => {
    await setup(async f => { const j = await f.plannedJob({}); await f.seed("update orders set expected_dispatch_date=current_date+1 where id=$1",[j.order]); await f.call("ap_planning","predict",{},i.productionManager); });
    const v = await open(width,"red-list",i.productionManager); await expect(v.page.getByText("production not planned",{exact:true})).toBeVisible();
    await v.page.getByText("Calculation and source evidence",{exact:true}).click(); await expect(v.page.getByText(/stage-plan-v1/)).toBeVisible();
    await v.done("red-list");
  });
  test(`AP-085 close is blocked, then an exception can be requested at ${width}px`, async () => {
    const v = await open(width,"close-checklist",i.owner); await expect(v.page.getByText(/blocking item\(s\)/)).toBeVisible();
    await v.page.getByLabel("Reason or approval note").fill("Tally export is pending a reviewed reconciliation");
    await v.page.getByRole("button",{name:"Close checked month"}).click(); await expect(v.page.getByRole("alert")).toContainText("blockers");
    await v.page.getByRole("button",{name:"Request close exception"}).click(); await expect(v.page.getByRole("status").filter({hasText:"Exception requested"})).toBeVisible();
    await v.done("close-checklist");
  });
  test(`AP-078 missing acceptance stays unknown and accounts can record it at ${width}px`, async () => {
    await setup(async f => { await f.supplierBill(); await f.call("ap_accounts","save_msme_vendor",{vendor_id:i.vendor,category:"micro",udyam:"UDYAM-DL-01-0000001",reason:"Certificate and written terms verified"},i.accounts); });
    const v = await open(width,"msme",i.accounts); await expect(v.page.getByText(/Unknown: confirm acceptance/)).toBeVisible();
    await v.page.getByText("Confirm acceptance or record reason",{exact:true}).click(); await v.page.getByLabel("Actual acceptance date").fill(istDay(-20));
    await v.page.getByLabel("Evidence or reason").fill("Signed goods receipt and inspection checked"); await v.page.getByRole("button",{name:"Record acceptance"}).click();
    await expect(v.page.getByText("Overdue",{exact:true})).toBeVisible(); await v.done("msme");
  });
  test(`AP-047 employee requests a correction without posting stock at ${width}px`, async () => {
    const id = await setup(f => f.item()); const v = await open(width,"stock-movements",i.inventory,{itemId:id});
    await expect(v.page.getByText(/rebuilt from movements: 100/)).toBeVisible(); await v.page.getByText("Request stock correction",{exact:true}).click();
    await v.page.getByLabel("Quantity",{exact:true}).fill("5"); await v.page.getByLabel("Reason",{exact:true}).fill("Physical count checked at shift end");
    await v.page.getByRole("button",{name:"Review and request correction"}).click(); await expect(v.page.getByRole("status").filter({hasText:"stock is unchanged"})).toBeVisible();
    await expect.poll(async () => Number((await fixture.run(() => fixture.f.one("select current_stock n from inventory_items where id=$1",[id]))).n)).toBe(100);
    await v.done("stock-movements");
  });
  test(`owner sets the stock threshold and nominates the accounts head through named choices at ${width}px`, async () => {
    const stock = await open(width,"stock-ledger",i.owner);
    await stock.page.getByLabel("Maximum quantity without second approval").fill("5");
    await stock.page.getByLabel("Reason",{exact:true}).fill("Small count corrections reviewed by stores");
    await stock.page.getByRole("button",{name:"Save approval threshold"}).click();
    await expect(stock.page.getByText("Current threshold: 5 item units.")).toBeVisible(); await stock.done("stock-policy");
    const close = await open(width,"close-checklist",i.owner);
    await close.page.getByText("Nominate the accounts head",{exact:true}).click();
    await close.page.getByLabel("Employee").selectOption(i.accounts);
    await close.page.getByRole("button",{name:"Nominate accounts head",exact:true}).click();
    await expect(close.page.getByRole("status").filter({hasText:"Accounts head nominated"})).toBeVisible();
    await expect(close.page.getByRole("button",{name:"Close checked month"})).toHaveCount(0);
    await close.done("accounts-head");
  });
}

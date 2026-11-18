import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { createBatch9BrowserFixture } from "../scripts/lib/autopilot-batch9-browser-fixture.mjs";
import { ids as i, istDay } from "../scripts/lib/autopilot-batch9-fixture.mjs";

let fixture, browser; const contexts = []; const evidence = "docs/evidence/AUTOPILOT_BATCH_9";
test.before(async () => { fixture = await createBatch9BrowserFixture(); browser = await chromium.launch({ headless: true }); mkdirSync(evidence, { recursive: true }); });
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
async function pick(page, label, text, option) {
  await page.getByLabel(label, { exact: true }).first().click();
  await page.getByLabel(label, { exact: true }).first().fill(text);
  await page.getByRole("option", { name: new RegExp(option) }).first().click();
}
const pairs = list => list.map(([c, v]) => `${c}\n${v}`).join("\n");
const tubeDxf = pairs([[0, "SECTION"], [2, "HEADER"], [9, "$INSUNITS"], [70, "4"], [0, "ENDSEC"], [0, "SECTION"], [2, "ENTITIES"],
  [0, "LWPOLYLINE"], [90, "4"], [70, "1"], [10, "0"], [20, "0"], [10, "40"], [20, "0"], [10, "40"], [20, "40"], [10, "0"], [20, "40"],
  [0, "LWPOLYLINE"], [90, "4"], [70, "1"], [10, "2"], [20, "2"], [10, "38"], [20, "2"], [10, "38"], [20, "38"], [10, "2"], [20, "38"], [0, "ENDSEC"], [0, "EOF"]]);
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

for (const width of [375, 1280]) {
  test(`AP-073 preview a customer's rate card and prepare it at ${width}px`, async () => {
    await setup(async f => { await f.rate({ type: "conversion", rate: 42, customer: i.customer2 }); await f.rate({ type: "finishing", rate: 30, finishing: "powder_coating" }); });
    const v = await open(width, "rate-cards", i.sales);
    await pick(v.page, "Customer", "Sharma", "Sharma Fabricators");
    await expect(v.page.getByRole("cell", { name: "₹287.00" }).first()).toBeVisible();
    await expect(v.page.getByRole("cell", { name: "₹317.00" }).first()).toBeVisible();
    await v.page.getByRole("button", { name: "Prepare rate card" }).click();
    await expect(v.page.getByText(/Prepared: rate card RC-\d{6}-001/)).toBeVisible();
    await expect(v.page.getByRole("link", { name: /RC-\d{6}-001/ })).toBeVisible();
    await v.done("rate-cards");
  });

  test(`AP-074 accept the best scrap offer, weigh and invoice at ${width}px`, async () => {
    const sale = await setup(async f => {
      await f.scrap({ kg: 300, category: "butt_end", daysAgo: 5 }); await f.scrap({ kg: 200, type: "coating_rejection" });
      const g = (await f.call("ap_scrap_sale", "stock", {}, i.inventory)).grades.find(x => x.code === "EXT-CLEAN");
      await f.call("ap_scrap_sale", "offer", { grade_id: g.grade_id, buyer_id: i.customer2, rate_per_kg: 180, quantity_kg: 250, valid_until: istDay(3) }, i.inventory);
      return g;
    });
    const v = await open(width, "scrap", i.inventory);
    await expect(v.page.getByRole("cell", { name: /EXT-CLEAN/ })).toBeVisible();
    await v.page.getByRole("button", { name: "Record offer" }).first().click();
    await pick(v.page, "Buyer", "Sharma", "Sharma Fabricators");
    await v.page.getByLabel("Rate ₹/kg").fill("192.5"); await v.page.getByLabel("Quantity kg").fill("250"); await v.page.getByLabel("Valid until").fill(istDay(2));
    await v.page.getByRole("button", { name: "Record offer" }).last().click();
    await expect(v.page.getByText("Best", { exact: true })).toBeVisible();
    await v.done("scrap-offers");
    const offers = await setup(f => f.call("ap_scrap_sale", "offers", { grade_id: sale.grade_id }, i.inventory));
    const best = offers.rows.find(o => Number(o.rate_per_kg) === 192.5);
    const s = await setup(f => f.call("ap_scrap_sale", "accept_offer", { offer_id: best.id }, i.inventory));
    const r = await open(width, "scrap-sale", i.accounts, { id: s.id, money: "true" });
    await r.page.getByLabel("Gross kg").fill("8250"); await r.page.getByLabel("Tare kg").fill("8000"); await r.page.getByLabel("Slip number").fill("WB-11");
    await r.page.getByRole("button", { name: "Record weight" }).click();
    await expect(r.page.getByText("Weight recorded and drawn from stock.")).toBeVisible();
    await r.page.getByRole("button", { name: "Raise invoice" }).click();
    await expect(r.page.getByText(/Invoice SCR\/\d{2}-\d{2}\/0001/)).toBeVisible();
    await expect(r.page.getByText(/IGST ₹8,662\.50/)).toBeVisible();
    await r.done("scrap-sale");
  });

  test(`AP-075 record the customer's weight on the invoice; accounts approves the credit note at ${width}px`, async () => {
    const inv = await setup(async f => { await f.call("ap_weight_note", "save_tolerance", { tolerance_percent: 0.5, reason: "Company default per terms" }, i.accounts); return f.invoice({ kg: 570, rate: 300 }); });
    const v = await open(width, "weight", i.sales, { invoice: inv.invoice, decide: "false" });
    await v.page.getByLabel("Customer's weight kg").fill("560"); await v.page.getByLabel("Their weighbridge slip or GRN").fill("WB-778");
    await v.page.getByRole("button", { name: "Record" }).click();
    await expect(v.page.getByText("Credit note of ₹3,540.00 drafted for accounts.")).toBeVisible();
    await v.done("weight-note-draft");
    const a = await open(width, "weight", i.accounts, { invoice: inv.invoice, decide: "true" });
    await a.page.getByRole("button", { name: "Approve credit note" }).first().click();
    await expect(a.page.getByText("Credit note approved.")).toBeVisible();
    await a.done("weight-note-approved");
  });

  test(`AP-076 the four-week forecast with a fixed expense and an opening balance at ${width}px`, async () => {
    await setup(f => f.bill({ amount: 85000, due: 9 }));
    const v = await open(width, "cash", i.accounts);
    await expect(v.page.getByText("This week")).toBeVisible();
    await v.page.getByLabel("Expense").fill("Salaries"); await v.page.getByLabel("₹", { exact: true }).first().fill("450000");
    await v.page.getByRole("button", { name: "Add" }).first().click();
    await expect(v.page.getByText("Fixed expense added.")).toBeVisible();
    await v.page.getByLabel("Balance ₹").fill("1200000"); await v.page.getByRole("button", { name: "Save balance" }).click();
    await expect(v.page.getByText("Closing").first()).toBeVisible();
    await v.page.getByRole("button", { name: /Show \d+ item/ }).first().click();
    await expect(v.page.getByText(/OMX\/26-27\/0101/)).toBeVisible();
    await v.done("cash-forecast");
  });

  test(`AP-008 paste a WhatsApp enquiry, map the unknown code and open it as a quotation at ${width}px`, async () => {
    const v = await open(width, "enquiries", i.sales);
    await v.page.getByLabel("Enquiry text").fill("[12/11/2026, 10:15:20] +91 98200 00002: Sir pls send rate\n[12/11/2026, 10:16:01] +91 98200 00002: OM-2045 6.4 mtr 200 pcs RAL 9010, XX-999 21 ft 100 pcs mill");
    await v.page.getByRole("button", { name: "Read enquiry" }).click();
    await expect.poll(() => v.page.evaluate(() => window.navigations.at(-1) ?? "")).toMatch(/^\/quotes\/enquiries\/[0-9a-f-]{36}$/);
    await v.done("enquiry-paste");
    const id = (await v.page.evaluate(() => window.navigations.at(-1))).split("/").pop();
    const r = await open(width, "enquiry", i.owner, { id });
    await expect(r.page.getByText(/Customer Sharma Fabricators \(found from the WhatsApp number\)/)).toBeVisible();
    await expect(r.page.getByText("Read with confidence").first()).toBeVisible();
    await expect(r.page.getByText("Which profile is “XX999”?")).toBeVisible();
    await pick(r.page, "Profile", "OM-2045", "OM-2045");
    await r.page.getByRole("button", { name: "Map code" }).click();
    await expect(r.page.getByText("Which profile is “XX999”?")).toHaveCount(0);
    await expect(r.page.getByRole("link", { name: "Open as quotation" })).toHaveAttribute("href", `/quotes/new?enquiry=${id}`);
    await r.done("enquiry-record");
  });

  test(`AP-009 photograph a shift register, type the cells and confirm at ${width}px`, async () => {
    const j = await setup(async f => { const press = await f.press({ name: "Press 9" }); const job = await f.job({ machine: press, plannedIn: 0, status: "in_progress" }); return { press, ...job }; });
    const v = await open(width, "registers", i.productionManager, { today: istDay(0) });
    await pick(v.page, "Press", "Press 9", "Press 9");
    await v.page.locator("input[type=file]").setInputFiles({ name: "sheet.png", mimeType: "image/png", buffer: PNG });
    await expect.poll(() => v.page.evaluate(() => window.navigations.at(-1) ?? "")).toMatch(/^\/production\/registers\/[0-9a-f-]{36}$/);
    await v.done("register-new");
    const id = (await v.page.evaluate(() => window.navigations.at(-1))).split("/").pop();
    const r = await open(width, "register", i.productionManager, { id });
    await expect(r.page.getByAltText(/Register REG-/)).toBeVisible();
    await r.page.getByLabel(/^Pushes row/).first().fill("3"); await r.page.getByLabel(/^Output pcs row/).first().fill("300");
    await r.page.getByRole("button", { name: "Confirm register" }).click();
    await expect(r.page.getByText("Register confirmed.")).toBeVisible();
    await expect(r.page.getByText(/3 push\(es\) added to the jobs/)).toBeVisible();
    await r.done("register-confirmed");
    assert.equal(Number((await setup(f => f.one("select count(*) n from production_push_events where production_job_id=$1 and source='backfill'", [j.job]))).n), 3);
  });

  test(`AP-010 the packing scale settles, captures the gross weight, and typed or heavy bundles are listed at ${width}px`, async () => {
    await setup(async f => {
      await f.seed("insert into section_weight_settings(company_id,tolerance_percent,window_bundles,min_bundles,updated_by) values($1,2,10,3,$2) on conflict (company_id) do update set tolerance_percent=2", [i.company, i.owner]);
      const heavy = await f.preparedBundle({ gross: 130, tare: 6, length: 120 }); await f.call("ap_scale", "record", { bundle_id: heavy, source: "manual" }, i.dispatchUser);
    });
    const v = await open(width, "scale", i.dispatchUser);
    await v.page.getByRole("button", { name: "Connect scale" }).click();
    await expect(v.page.getByText("120.000 kg")).toBeVisible();
    await expect(v.page.getByText("Stable", { exact: true })).toBeVisible();
    await v.page.getByRole("button", { name: "Capture gross weight" }).click();
    const captured = await v.page.evaluate(() => window.captures.at(-1));
    assert.deepEqual([captured.kg, captured.raw], [120, "ST,GS,+0120.00kg"]);
    await expect(v.page.getByText(/8\.772% from theoretical/)).toBeVisible();
    await v.done("scale");
  });

  test(`AP-034 arriving stock is proposed to the waiting order and reserved in one acceptance at ${width}px`, async () => {
    await setup(async f => { await f.order({ kg: 285, pieces: 50, length: 6 }); const b = await f.stock({ pieces: 50, qc: "on_hold" });
      await f.raw("update profile_stock_batches set qc_status='released', qc_released_at=now() where id=$1", [b]); });
    const v = await open(width, "arrivals", i.inventory, { today: istDay(0) });
    await expect(v.page.getByText(/Reserve 50 pcs .* of OM-2045 from STK-/)).toBeVisible();
    await v.page.getByRole("button", { name: /^Accept/ }).first().click();
    await expect(v.page.getByText(/Accepted/).first()).toBeVisible();
    await v.done("arrival-reservation");
  });

  test(`AP-048 upload the die drawing; kg/m is proposed with a preview and accepted at ${width}px`, async () => {
    const v = await open(width, "geometry", i.owner, { profile: i.profile2, today: istDay(0) });
    await v.page.locator("input[type=file]").setInputFiles({ name: "OM-2045.dxf", mimeType: "", buffer: Buffer.from(tubeDxf) });
    await expect(v.page.getByText("Read: 0.8208 kg/m proposed.")).toBeVisible();
    await expect(v.page.getByAltText("Section preview")).toBeVisible();
    await expect(v.page.getByText(/Set OM-2045 to 0\.821 kg\/m and perimeter 160 mm/)).toBeVisible();
    await v.done("drawing-geometry");
    await v.page.getByRole("button", { name: /^Accept/ }).first().click();
    await expect(v.page.getByText(/Accepted/).first()).toBeVisible();
    assert.equal(Number((await setup(f => f.one("select section_weight_kg_per_m w from aluminium_profiles where id=$1", [i.profile2]))).w), 0.821);
  });

  test(`AP-095 the press workstation and the scale panel in Hindi; the switch saves the person's choice at ${width}px`, async () => {
    const v = await open(width, "workstation", i.production, { today: istDay(0), lang: "hi" });
    await expect(v.page.getByRole("heading", { name: "प्रेस वर्कस्टेशन" })).toBeVisible();
    await expect(v.page.getByRole("button", { name: "लॉक करें और ऑपरेटर बदलें" })).toBeVisible();
    await expect(v.page.getByRole("button", { name: "ऑपरेटर पहचानें और स्टेशन खोलें" })).toBeVisible();
    await v.done("workstation-hindi");
    await v.page.getByRole("button", { name: "English" }).click();
    await expect.poll(async () => (await setup(f => f.one("select language from user_language_preferences where user_id=$1", [i.production])))?.language).toBe("en");
    const s = await open(width, "scale", i.dispatchUser, { lang: "hi" });
    await expect(s.page.getByRole("button", { name: "तराज़ू जोड़ें" })).toBeVisible();
    await s.done("scale-hindi");
  });
}

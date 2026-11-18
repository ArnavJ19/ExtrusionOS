import test from "node:test";
import assert from "node:assert/strict";
import { createBatch9Fixture, ids as i, istDay } from "../scripts/lib/autopilot-batch9-fixture.mjs";

let f;
test.before(async () => { f = await createBatch9Fixture(); });
test.after(async () => { await f?.close(); });
test.beforeEach(async () => { await f.start(); });
test.afterEach(async () => { await f.rollback(); });
const denied = e => e.code === "42501";
const num = v => (v === null || v === undefined ? v : Number(v));

// ---------------------------------------------------------------- AP-073
test("AP-073 a rate card prices billet + agreed conversion + finishing per kg, leaves off lines below the floor or without a rate, and shows selling prices only", async () => {
  await f.rate({ type: "conversion", rate: 42, customer: i.customer2 });
  await f.rate({ type: "finishing", rate: 30, finishing: "powder_coating" });
  await f.rate({ type: "finishing", basis: "per_sqft", rate: 12, finishing: "anodizing" });
  const preview = await f.ap("ap_rate_card", "preview", { customer_id: i.customer2 }, i.sales);
  const mill = preview.lines.find(l => l.finish === "mill_finish" && l.alloy === "6063");
  assert.equal(num(mill.rate_per_kg), 245 + 42, "the customer's agreed conversion beats the general 38");
  assert.equal(num(preview.lines.find(l => l.finish === "powder_coating" && l.alloy === "6063").rate_per_kg), 245 + 42 + 30);
  const anod = preview.lines.find(l => l.finish === "anodizing" && l.alloy === "6063");
  assert.deepEqual([num(anod.rate_per_kg), num(anod.finish_extra.rate), anod.finish_extra.basis], [287, 12, "per_sqft"], "a per-sq-ft finish is quoted beside the kg rate");
  for (const l of preview.lines) assert.deepEqual(Object.keys(l).sort(), ["alloy", "families", "finish", "finish_extra", "finish_label", "rate_per_kg"], "no cost, margin or rate ids");
  const card = await f.ap("ap_rate_card", "generate", { customer_id: i.customer2, valid_days: 2, fingerprint: preview.fingerprint }, i.sales);
  assert.equal(card.state, "generated");
  assert.match(card.card.card_number, /^RC-\d{6}-001$/);
  assert.equal(card.card.valid_until, istDay(2));
  const again = await f.ap("ap_rate_card", "generate", { customer_id: i.customer2, valid_days: 2 }, i.sales);
  assert.deepEqual([again.state, again.card.id], ["unchanged", card.card.id], "generating again without a rate change returns the same card");
  // A rate change after the preview makes the old preview stale.
  await f.seed("update costing_rates set rate=250 where id=$1", [i.rateBillet]);
  assert.equal((await f.ap("ap_rate_card", "generate", { customer_id: i.customer2, fingerprint: preview.fingerprint }, i.sales)).state, "stale");
  // Below the floor: the 6063 conversion floor of 50 takes those lines off the card and lists them internally.
  await f.floor({ alloy: "6063", perKg: 50 });
  const floored = await f.ap("ap_rate_card", "preview", { customer_id: i.customer2 }, i.sales);
  assert.ok(!floored.lines.some(l => l.alloy === "6063"));
  assert.ok(floored.excluded.some(e => e.alloy === "6063" && /below the floor/.test(e.reason)));
  await f.ap("ap_rate_card", "shared", { id: card.card.id, channel: "whatsapp" }, i.sales);
  assert.equal((await f.ap("ap_rate_card", "list", { page: 1 }, i.accounts)).rows[0].shared_channel, "whatsapp");
  await assert.rejects(() => f.ap("ap_rate_card", "generate", { customer_id: i.customer2 }, i.accounts), denied);
  await assert.rejects(() => f.ap("ap_rate_card", "preview", { customer_id: i.customer2 }, i.production), denied);
  await assert.rejects(() => f.ap("ap_rate_card", "get", { id: card.card.id }, i.foreign), /not found/);
});

test("AP-073 one click prepares a card for every customer of a category; a day without approved rates prices nothing and says why", async () => {
  const all = await f.ap("ap_rate_card", "generate_all", { customer_type: "fabricator" }, i.salesManager);
  assert.ok(all.generated >= 1);
  assert.equal((await f.ap("ap_rate_card", "generate_all", { customer_type: "fabricator" }, i.salesManager)).generated, 0, "a second click with the same rates makes no new cards");
  await f.seed("update costing_rates set status='withdrawn' where company_id=$1 and rate_type='billet'", [i.company]);
  const none = await f.ap("ap_rate_card", "generate", { customer_id: i.customer2 }, i.sales);
  assert.equal(none.state, "no_lines");
  assert.match(none.message, /No approved billet rate/);
});

// ---------------------------------------------------------------- AP-074
test("AP-074 scrap stock by grade reconciles generation - remelt - sales; the best offer is accepted, the weighbridge weight draws yard then foundry lots, and the invoice carries HSN 7602 and GST", async () => {
  const butt = await f.scrap({ kg: 300, category: "butt_end", daysAgo: 5 });
  await f.scrap({ kg: 200, type: "coating_rejection" });
  await f.scrap({ kg: 100, category: "saw_cut", daysAgo: 1 });
  // The foundry charged 50 kg of the butt-end lot into a furnace.
  await f.seed("update foundry_aluminium_scrap set available_weight_kg=250 where id=$1", [butt.lot]);
  const stock = (await f.ap("ap_scrap_sale", "stock", {}, i.inventory)).grades;
  const clean = stock.find(g => g.code === "EXT-CLEAN"), painted = stock.find(g => g.code === "PAINTED");
  assert.deepEqual([clean.generated_kg, clean.pool_kg, clean.remelted_kg, clean.on_hand_kg].map(num), [400, 400, 50, 350]);
  assert.deepEqual([painted.generated_kg, painted.yard_available_kg, painted.on_hand_kg].map(num), [200, 200, 200], "coating rejections stay in the yard");
  const low = await f.ap("ap_scrap_sale", "offer", { grade_id: clean.grade_id, buyer_id: i.customer2, rate_per_kg: 180, quantity_kg: 300, valid_until: istDay(3) }, i.inventory);
  const best = await f.ap("ap_scrap_sale", "offer", { grade_id: clean.grade_id, buyer_id: i.customer2, rate_per_kg: 192.5, quantity_kg: 300, valid_until: istDay(3) }, i.inventory);
  await assert.rejects(() => f.ap("ap_scrap_sale", "accept_offer", { offer_id: low.id }, i.inventory), /better offer of ₹192.5/);
  const sale = await f.ap("ap_scrap_sale", "accept_offer", { offer_id: best.id }, i.inventory);
  assert.equal(sale.status, "ordered");
  await assert.rejects(() => f.ap("ap_scrap_sale", "accept_offer", { offer_id: best.id }, i.inventory), /no longer open/);
  await assert.rejects(() => f.ap("ap_scrap_sale", "weigh", { id: sale.id, gross_kg: 9000, tare_kg: 8600, weighbridge_ref: "WB-1" }, i.inventory), /Only 350 kg/);
  const weighed = await f.ap("ap_scrap_sale", "weigh", { id: sale.id, gross_kg: 8320, tare_kg: 8000, weighbridge_ref: "WB-1", vehicle_registration: "mh 12 ab 1234" }, i.inventory);
  assert.deepEqual([weighed.status, num(weighed.net_kg), weighed.vehicle_registration], ["weighed", 320, "MH12AB1234"]);
  // Oldest lot first: 250 kg from the butt-end lot, 70 kg from the saw-cut lot.
  assert.deepEqual(weighed.allocations.map(a => [num(a.kg), a.source]), [[250, "foundry_lot"], [70, "foundry_lot"]]);
  assert.equal(num((await f.one("select available_weight_kg v from foundry_aluminium_scrap where id=$1", [butt.lot])).v), 0, "the foundry cannot remelt what was sold");
  const after = (await f.ap("ap_scrap_sale", "stock", {}, i.inventory)).grades.find(g => g.code === "EXT-CLEAN");
  assert.equal(num(after.on_hand_kg), 30);
  assert.equal(num(after.generated_kg) - num(after.remelted_kg) - num(after.sold_pool_kg) - num(after.sold_yard_kg), num(after.on_hand_kg), "stock = generation - remelt - sales");
  await assert.rejects(() => f.ap("ap_scrap_sale", "invoice", { id: sale.id }, i.inventory), denied);
  const inv = await f.ap("ap_scrap_sale", "invoice", { id: sale.id }, i.accounts);
  assert.match(inv.invoice_number, /^SCR\/\d{2}-\d{2}\/0001$/);
  assert.deepEqual([inv.hsn_code, num(inv.taxable_value), num(inv.igst_amount), num(inv.cgst_amount), num(inv.invoice_total)], ["7602", 61600, 11088, 0, 72688], "Maharashtra buyer from Delhi: IGST 18%");
  await assert.rejects(() => f.ap("ap_scrap_sale", "cancel", { id: sale.id, reason: "Buyer backed out" }, i.inventory), /cannot be cancelled/);
  await assert.rejects(() => f.ap("ap_scrap_sale", "receipt", { id: sale.id, amount: 80000, method: "upi" }, i.accounts), /more than/);
  const paid = await f.ap("ap_scrap_sale", "receipt", { id: sale.id, amount: 72688, method: "bank_transfer", reference: "NEFT-1" }, i.accounts);
  assert.equal(paid.status, "paid");
});

test("AP-074 a cancelled weighed sale gives its kilograms back to the foundry lots; reversed scrap and other companies are excluded", async () => {
  const lot = await f.scrap({ kg: 120, category: "saw_cut" });
  const grade = (await f.ap("ap_scrap_sale", "stock", {}, i.factory)).grades.find(g => g.code === "EXT-CLEAN");
  const offer = await f.ap("ap_scrap_sale", "offer", { grade_id: grade.grade_id, buyer_id: i.customer2, rate_per_kg: 190, quantity_kg: 100, valid_until: istDay(1) }, i.factory);
  const sale = await f.ap("ap_scrap_sale", "accept_offer", { offer_id: offer.id }, i.factory);
  await f.ap("ap_scrap_sale", "weigh", { id: sale.id, gross_kg: 1100, tare_kg: 1000, weighbridge_ref: "WB-2" }, i.factory);
  assert.equal(num((await f.one("select available_weight_kg v from foundry_aluminium_scrap where id=$1", [lot.lot])).v), 20);
  await f.ap("ap_scrap_sale", "cancel", { id: sale.id, reason: "Truck did not come" }, i.factory);
  assert.equal(num((await f.one("select available_weight_kg v from foundry_aluminium_scrap where id=$1", [lot.lot])).v), 120);
  await f.seed("insert into scrap_record_reversals(company_id,scrap_record_id,reversed_weight_kg,retired_lot_count,reason,reversed_by,reversed_by_role) values($1,$2,120,1,'Recorded twice by mistake','" + i.owner + "','owner')", [i.company, lot.record]);
  assert.equal(num((await f.ap("ap_scrap_sale", "stock", {}, i.factory)).grades.find(g => g.code === "EXT-CLEAN").generated_kg), 0);
  await assert.rejects(() => f.ap("ap_scrap_sale", "sale", { id: sale.id }, i.foreign), /not found/);
  await assert.rejects(() => f.ap("ap_scrap_sale", "stock", {}, i.sales), denied);
  await assert.rejects(() => f.ap("ap_scrap_sale", "offer", { grade_id: grade.grade_id, buyer_id: i.customer2, rate_per_kg: 190, quantity_kg: 100, valid_until: istDay(-1) }, i.factory), /past its validity/);
});

// ---------------------------------------------------------------- AP-075
test("AP-075 a customer weight outside the agreed tolerance drafts a credit note at the invoice rate with GST; accounts (another person) approves and the invoice is credited", async () => {
  const inv = await f.invoice({ kg: 570, rate: 300 });
  await assert.rejects(() => f.ap("ap_weight_note", "report", { invoice_id: inv.invoice, reported_kg: 560, customer_reference: "WB-778" }, i.sales), /Set the agreed weight tolerance/);
  await f.ap("ap_weight_note", "save_tolerance", { tolerance_percent: 0.5, reason: "Company default per terms" }, i.accounts);
  await f.ap("ap_weight_note", "save_tolerance", { customer_id: i.customer2, tolerance_kg: 2, reason: "Agreed with Sharma Fabricators" }, i.accounts);
  const within = await f.ap("ap_weight_note", "report", { invoice_id: inv.invoice, reported_kg: 568.5, customer_reference: "WB-777" }, i.sales);
  assert.deepEqual([within.outcome, within.status, within.tolerance_source, num(within.allowed_kg)], ["within_tolerance", "recorded", "customer", 2], "1.5 kg short against 2 kg agreed: recorded, no note");
  const note = await f.ap("ap_weight_note", "report", { invoice_id: inv.invoice, reported_kg: 560, customer_reference: "WB-778" }, i.sales);
  assert.deepEqual([note.outcome, note.status, num(note.difference_kg), num(note.rate_per_kg), num(note.taxable_value), num(note.tax_amount), num(note.total_amount)],
    ["credit", "draft", -10, 300, 3000, 540, 3540]);
  await assert.rejects(() => f.ap("ap_weight_note", "report", { invoice_id: inv.invoice, reported_kg: 559, customer_reference: "WB-779" }, i.sales), /waiting for accounts/);
  assert.ok((await f.one("select count(*)::int n from notifications where condition_key=$1 and resolved_at is null", [`weight-note:${note.id}`])).n > 0);
  await assert.rejects(() => f.ap("ap_weight_note", "approve", { id: note.id }, i.sales), denied);
  const approved = await f.ap("ap_weight_note", "approve", { id: note.id, note: "Checked the weighbridge slip" }, i.accounts);
  assert.equal(approved.status, "approved");
  assert.match(approved.credit_note_number, /\S+/);
  const cn = await f.one("select grand_total, reason, invoice_id, dispatch_id from credit_notes where id=$1", [approved.credit_note_id]);
  assert.deepEqual([num(cn.grand_total), cn.invoice_id, cn.dispatch_id], [3540, inv.invoice, inv.dispatch]);
  assert.match(cn.reason, /560 kg against 570 kg/);
  assert.equal(num((await f.one("select credited_amount v from invoices where id=$1", [inv.invoice])).v), 3540);
  assert.equal((await f.one("select count(*)::int n from notifications where condition_key=$1 and resolved_at is null", [`weight-note:${note.id}`])).n, 0, "the alert closes with the decision");
  await assert.rejects(() => f.ap("ap_weight_note", "approve", { id: note.id }, i.accounts), /already approved/);
});

test("AP-075 more weight received drafts a debit note; the reporter cannot approve their own note; rejection needs a reason and keeps the outcome", async () => {
  const inv = await f.invoice({ kg: 1000, rate: 250 });
  await f.ap("ap_weight_note", "save_tolerance", { tolerance_percent: 0.2, reason: "Company default per terms" }, i.accounts);
  const debit = await f.ap("ap_weight_note", "report", { invoice_id: inv.invoice, reported_kg: 1006, customer_reference: "GRN-55" }, i.accounts2);
  assert.deepEqual([debit.outcome, num(debit.allowed_kg), num(debit.total_amount)], ["debit", 2, 1770]);
  await assert.rejects(() => f.ap("ap_weight_note", "approve", { id: debit.id }, i.accounts2), /Another person/);
  const ok = await f.ap("ap_weight_note", "approve", { id: debit.id }, i.accounts);
  assert.match(ok.debit_note_number, /^DN\/\d{2}-\d{2}\/0001$/);
  const second = await f.ap("ap_weight_note", "report", { invoice_id: inv.invoice, reported_kg: 990, customer_reference: "GRN-56" }, i.sales);
  await assert.rejects(() => f.ap("ap_weight_note", "reject", { id: second.id, note: "" }, i.accounts));
  const rejected = await f.ap("ap_weight_note", "reject", { id: second.id, note: "Customer's scale not calibrated" }, i.accounts);
  assert.equal(rejected.status, "rejected");
  const list = await f.ap("ap_weight_note", "list", { status: "all" }, i.accounts);
  assert.equal(list.total_count, 2);
  await assert.rejects(() => f.ap("ap_weight_note", "invoice", { invoice_id: inv.invoice }, i.foreign), /not found/);
  await assert.rejects(() => f.ap("ap_weight_note", "list", {}, i.production), denied);
});

// ---------------------------------------------------------------- AP-076
test("AP-076 the four-week forecast places receipts at due date plus each customer's usual delay, payables, unbilled purchase orders, fixed expenses and one-offs; the running balance needs an opening balance", async () => {
  await f.bill({ amount: 5000, due: 9 });
  await f.purchaseOrder({ lines: [{ description: "Stretch film 23 micron", unit: "kg", rate: 100, quantity: 10 }], daysAgo: 30 });
  await f.ap("ap_cash_forecast", "save_fixed", { label: "Factory rent", amount: 150000, frequency: "monthly", day_of_month: 1 }, i.accounts);
  await f.ap("ap_cash_forecast", "save_fixed", { label: "Contract labour", amount: 60000, frequency: "weekly", weekday: 6 }, i.accounts);
  await f.ap("ap_cash_forecast", "save_one_off", { on_date: istDay(8), direction: "out", amount: 25000, label: "Die advance to Precision Die Works" }, i.accounts);
  const v = await f.ap("ap_cash_forecast", "forecast", {}, i.owner);
  assert.equal(v.weeks.length, 4);
  assert.equal(v.opening_balance, null);
  assert.ok(v.weeks.every(w => w.closing === undefined), "no opening balance: no running balance, never zero");
  const items = v.weeks.flatMap(w => w.items);
  assert.ok(items.some(x => x.kind === "receivable" && x.label.startsWith("OMX/26-27/0101")), "an overdue invoice is expected in the first week");
  assert.equal(v.weeks[0].items.find(x => x.label.startsWith("OMX/26-27/0101")).expected_on, v.from);
  assert.ok(items.some(x => x.kind === "payable" && Number(x.amount) === 5000));
  assert.ok(items.some(x => x.kind === "purchase_order" && /not yet billed/.test(x.basis)));
  assert.equal(items.filter(x => x.label === "Contract labour").length, 4, "weekly expense once a week");
  assert.ok(items.some(x => x.label.startsWith("Die advance")));
  await f.ap("ap_cash_forecast", "save_opening", { opening_balance: 500000 }, i.accounts);
  const withBalance = await f.ap("ap_cash_forecast", "forecast", { weeks: 2 }, i.accounts);
  assert.equal(num(withBalance.weeks[0].closing), Math.round((500000 + num(withBalance.weeks[0].net)) * 100) / 100);
  assert.equal(num(withBalance.weeks[1].closing), Math.round((num(withBalance.weeks[0].closing) + num(withBalance.weeks[1].net)) * 100) / 100);
  await assert.rejects(() => f.ap("ap_cash_forecast", "forecast", {}, i.sales), denied);
  await assert.rejects(() => f.ap("ap_cash_forecast", "forecast", {}, i.productionManager), denied);
});

test("AP-076 the weekly snapshot is kept once per week and compared with actual receipts and payments", async () => {
  const first = await f.ap("ap_cash_forecast", "snapshot_now", {}, i.accounts);
  assert.equal(first.snapshots, 1);
  assert.equal((await f.ap("ap_cash_forecast", "snapshot_now", {}, i.accounts)).snapshots, 0, "one snapshot per week");
  await f.seed("update cash_forecast_snapshots set week_start=week_start-14 where company_id=$1", [i.company]);
  const snap = await f.one("select week_start from cash_forecast_snapshots where company_id=$1", [i.company]);
  await f.seed("insert into payments(company_id,invoice_id,payment_date,amount,payment_method,payment_status) values($1,$2,$3,4000,'bank_transfer','COMPLETED')", [i.company, i.inv1, snap.week_start]);
  const acc = await f.ap("ap_cash_forecast", "accuracy", {}, i.owner);
  assert.equal(acc.total_count, 1);
  assert.equal(num(acc.rows[0].actual_in), 4000);
  assert.ok(num(acc.rows[0].expected_in) >= 0);
});

// ---------------------------------------------------------------- AP-095
test("AP-095 each person's floor language is their own; only English and Hindi are accepted", async () => {
  assert.equal((await f.ap("ap_language", "get", {}, i.production)).language, "en");
  await f.ap("ap_language", "set", { language: "hi" }, i.production);
  assert.equal((await f.ap("ap_language", "get", {}, i.production)).language, "hi");
  assert.equal((await f.ap("ap_language", "get", {}, i.productionManager)).language, "en", "another person keeps their own");
  await assert.rejects(() => f.ap("ap_language", "set", { language: "fr" }, i.production), /English or Hindi/);
  await assert.rejects(() => f.ap("ap_language", "get", {}, i.dealer), denied);
  await assert.rejects(() => f.asUser("select * from user_language_preferences", [], i.production), /permission denied/);
});

// ---------------------------------------------------------------- AP-008
test("AP-008 the enquiry finds the customer by WhatsApp number, resolves codes (exact, by number, remembered) and remembers a mapping for next time", async () => {
  const ctx = await f.ap("ap_enquiry", "context", { codes: ["OM-2045", "2045", "XX-999"], phone: "+91 98200 00002" }, i.sales);
  assert.deepEqual([ctx.customer.id, ctx.customer.basis], [i.customer2, "phone"]);
  assert.equal(ctx.codes.OM2045.basis, "code");
  assert.equal(ctx.codes["2045"].basis, "code_number");
  assert.equal(ctx.codes.XX999.profile_id, null);
  const line = (seq, extra) => ({ seq, text: "line", code: null, code_key: null, profile_id: null, profile_code: null, basis: null, length_m: 6.4, length_text: "6.4 m", pieces: 200, kg: null,
    finish: "mill_finish", shade: null, alloy: null, confidence: "low", issues: [], ...extra });
  const e = await f.ap("ap_enquiry", "save", { raw_text: "OM-2045 6.4 mtr 200 pcs mill, XX-999 6 m 50 kg", source: "paste", customer_id: i.customer2, customer_basis: "phone",
    lines: [line(1, { code: "OM-2045", code_key: "OM2045", profile_id: i.profile2, profile_code: "OM-2045", basis: "code", confidence: "high" }),
      line(2, { code: "XX-999", code_key: "XX999", length_m: 6, pieces: null, kg: 50, issues: ["Unknown code XX-999"] })], unknown_codes: ["XX999"] }, i.sales);
  assert.match(e.enquiry_number, /^ENQ-\d{6}-001$/);
  const mapped = await f.ap("ap_enquiry", "map", { id: e.id, code_key: "XX999", profile_id: i.profile2, remember: "customer" }, i.sales);
  assert.deepEqual(mapped.unknown_codes, []);
  assert.deepEqual([mapped.lines[1].basis, mapped.lines[1].confidence, mapped.lines[1].issues], ["chosen", "high", []]);
  const next = await f.ap("ap_enquiry", "context", { codes: ["XX999"], customer_id: i.customer2 }, i.sales);
  assert.equal(next.codes.XX999.basis, "remembered_customer", "the mapping is used next time for this customer");
  assert.equal((await f.ap("ap_enquiry", "context", { codes: ["XX999"], customer_id: i.customer }, i.sales)).codes.XX999.profile_id, null, "and only for this customer");
  // The draft carries today's approved rates and pieces from kg; pricing itself stays with the quotation calculation.
  await assert.rejects(() => f.ap("ap_enquiry", "draft", { id: e.id }, i.sales), denied);
  const d = await f.ap("ap_enquiry", "draft", { id: e.id }, i.owner);
  assert.equal(d.items.length, 2);
  assert.deepEqual([d.items[0].quantity_pieces, num(d.items[0].billet_rate_per_kg), num(d.items[0].conversion_charge_per_kg)], [200, 245, 38]);
  assert.equal(d.items[1].quantity_pieces, Math.ceil(50 / (6 * 0.95)), "pieces from kg, rounded up");
  await assert.rejects(() => f.ap("ap_enquiry", "save", { raw_text: "x y z", source: "paste", lines: [line(1, { profile_id: f.next() })], unknown_codes: [] }, i.sales), /not in this company/);
  await assert.rejects(() => f.ap("ap_enquiry", "save", { raw_text: "x y z", source: "paste", lines: [line(1, { pieces: 2.5 })], unknown_codes: [] }, i.sales), /whole number/);
  await assert.rejects(() => f.ap("ap_enquiry", "get", { id: e.id }, i.foreign), /not found/);
  await assert.rejects(() => f.ap("ap_enquiry", "list", {}, i.production), denied);
});

test("AP-008 a quotation saved from the enquiry closes it; another customer's or an older quotation cannot", async () => {
  const e = await f.ap("ap_enquiry", "save", { raw_text: "OM-2045 6 m 10 pcs", source: "paste", customer_id: i.customer2, lines: [], unknown_codes: [] }, i.sales);
  const old = await f.draftQuote({ customer: i.customer2 });
  await f.seed("update quotes set created_at=now()-interval '1 day' where id=$1", [old.quote ?? old]);
  await assert.rejects(() => f.ap("ap_enquiry", "link_quote", { id: e.id, quote_id: old.quote ?? old }, i.owner), /not prepared from this enquiry/);
  const fresh = await f.draftQuote({ customer: i.customer2 });
  const linked = await f.ap("ap_enquiry", "link_quote", { id: e.id, quote_id: fresh.quote ?? fresh }, i.owner);
  assert.deepEqual([linked.status, linked.quote_id], ["quoted", fresh.quote ?? fresh]);
  await assert.rejects(() => f.ap("ap_enquiry", "discard", { id: e.id, reason: "Duplicate" }, i.sales), /not found/);
});

// ---------------------------------------------------------------- AP-009
test("AP-009 a register photo opens a draft with that shift's jobs; confirming adds only the pushes not already tapped; blank cells stay blank; the same photo cannot be captured twice", async () => {
  const press = await f.press({ name: "Press 9" });
  const j = await f.job({ machine: press, plannedIn: 0, status: "in_progress" });
  const sha = "a".repeat(64);
  const payload = { machine_id: press, shift_day: istDay(0), storage_path: `${i.company}/register-photos/${press}/sheet.jpg`, file_name: "sheet.jpg", mime_type: "image/jpeg", file_sha256: sha };
  const draft = await f.ap("ap_register", "create", payload, i.production);
  assert.match(draft.capture_number, /^REG-\d{6}-001$/);
  assert.equal(draft.rows.length, 1);
  assert.deepEqual([draft.rows[0].job_id, draft.rows[0].pushes, draft.rows[0].output_pcs, draft.rows[0].cells.job_id.source], [j.job, null, null, "system"]);
  await assert.rejects(() => f.ap("ap_register", "create", payload, i.production), /already captured/);
  await assert.rejects(() => f.ap("ap_register", "create", { ...payload, file_sha256: "b".repeat(64), storage_path: `${i.foreign}/register-photos/x.jpg` }, i.production), /Upload the photo again/);
  const rows = [{ id: draft.rows[0].id, job_id: j.job, die_no: draft.rows[0].die_no, pushes: 3, output_pcs: 300, rejects: 4, downtime_min: 25, billets: 3, cells: { pushes: { source: "typed" } } }];
  await assert.rejects(() => f.ap("ap_register", "confirm", { id: draft.id, rows }, i.production), denied);
  const done = await f.ap("ap_register", "confirm", { id: draft.id, rows }, i.productionManager);
  assert.equal(done.status, "confirmed");
  assert.deepEqual([done.summary.pushes_added, done.summary.output_pcs, done.summary.rejects, done.summary.downtime_min].map(num), [3, 300, 4, 25]);
  const pushes = await f.one("select count(*)::int n, min(source) s, min(reason) r from production_push_events where production_job_id=$1 and kind='push'", [j.job]);
  assert.deepEqual([pushes.n, pushes.s], [3, "backfill"]);
  assert.match(pushes.r, /Shift register REG-/);
  await assert.rejects(() => f.ap("ap_register", "confirm", { id: draft.id, rows }, i.productionManager), /already confirmed/);
  // A second register for the same shift that shows fewer pushes than were tapped is refused, not silently reduced.
  const again = await f.ap("ap_register", "create", { ...payload, file_sha256: "c".repeat(64) }, i.production);
  await assert.rejects(() => f.ap("ap_register", "confirm", { id: again.id, rows: [{ job_id: j.job, pushes: 2 }] }, i.productionManager), /already tapped/);
  await assert.rejects(() => f.ap("ap_register", "confirm", { id: again.id, rows: [{ pushes: 2 }] }, i.productionManager), /Choose the job/);
  const job = await f.ap("ap_register", "job", { job_id: j.job }, i.production);
  assert.equal(job.rows.length, 1);
  await assert.rejects(() => f.ap("ap_register", "get", { id: draft.id }, i.foreign), /not found/);
  await assert.rejects(() => f.ap("ap_register", "list", {}, i.sales), denied);
});

// ---------------------------------------------------------------- AP-010
test("AP-010 each bundle records whether its weight came from the scale or was typed, checked against theoretical with the approved tolerance; manual vs scale share is reportable", async () => {
  await f.seed("insert into section_weight_settings(company_id,tolerance_percent,window_bundles,min_bundles,updated_by) values($1,2,10,3,$2) on conflict (company_id) do update set tolerance_percent=2", [i.company, i.owner]);
  const good = await f.preparedBundle({ gross: 120, tare: 6, length: 120 });
  const heavy = await f.preparedBundle({ gross: 130, tare: 6, length: 120 });
  await assert.rejects(() => f.ap("ap_scale", "record", { bundle_id: good, source: "scale", raw_reading: "US,GS,+120.00kg", stable: false }, i.dispatchUser), /stable reading/);
  const a = await f.ap("ap_scale", "record", { bundle_id: good, source: "scale", raw_reading: "ST,GS,+0120.00kg", stable: true, indicator_ref: "usb 1a86:7523 @9600", readings_count: 6 }, i.dispatchUser);
  assert.deepEqual([a.source, num(a.theoretical_kg), num(a.deviation_percent), a.flagged, a.tolerance_source], ["scale", 114, 0, false, "section_weight_policy"]);
  const b = await f.ap("ap_scale", "record", { bundle_id: heavy, source: "manual" }, i.dispatchUser);
  assert.deepEqual([b.source, b.flagged, num(b.deviation_percent)], ["manual", true, 8.772]);
  assert.ok((await f.one("select count(*)::int n from notifications where condition_key=$1", [`bundle-weight:${heavy}`])).n > 0);
  const replay = await f.ap("ap_scale", "record", { bundle_id: heavy, source: "scale", raw_reading: "ST,GS,+130", stable: true }, i.dispatchUser);
  assert.deepEqual([replay.replayed, replay.source], [true, "manual"], "a resent bundle keeps its first record");
  const share = await f.ap("ap_scale", "share", {}, i.quality);
  assert.deepEqual([share.total, share.scale, share.manual, share.flagged, num(share.scale_share_percent)], [2, 1, 1, 1, 50]);
  assert.equal((await f.ap("ap_scale", "list", {}, i.quality)).rows[0].bundle_id, heavy);
  await assert.rejects(() => f.ap("ap_scale", "record", { bundle_id: good, source: "manual" }, i.foreign), /not found/);
  await assert.rejects(() => f.ap("ap_scale", "share", {}, i.sales), denied);
});

// ---------------------------------------------------------------- AP-034
test("AP-034 released stock proposes reservations to waiting lines by priority then promise date; one acceptance reserves through the stock allocation; a mismatched finish or held stock is not proposed", async () => {
  const late = await f.order({ kg: 285, pieces: 50, length: 6 });
  const urgent = await f.order({ kg: 114, pieces: 20, length: 6 });
  await f.seed("update orders set priority='urgent', expected_dispatch_date=current_date+20 where id=$1", [urgent.order]);
  await f.seed("update orders set expected_dispatch_date=current_date+5 where id=$1", [late.order]);
  const held = await f.stock({ pieces: 50, qc: "on_hold" });
  assert.equal((await f.openProposals("stock.reservation")).length, 0, "held stock is not offered");
  await f.raw("update profile_stock_batches set qc_status='released', qc_released_at=now() where id=$1", [held]);
  const open = await f.openProposals("stock.reservation");
  const byOrder = Object.fromEntries(open.map(p => [p.payload.order_id, p]));
  assert.deepEqual([byOrder[urgent.order]?.payload.pieces, byOrder[late.order]?.payload.pieces], [20, 30], "the urgent line is served in full first, the rest of the 50 pieces go to the next");
  open.sort((a, b) => (a.payload.order_id === urgent.order ? -1 : 1) - (b.payload.order_id === urgent.order ? -1 : 1));
  await f.stock({ pieces: 10, finish: "powder_coating" });
  assert.equal((await f.openProposals("stock.reservation")).length, 2, "a different finish serves no waiting line");
  await assert.rejects(() => f.decide(open[0].id, "accept", i.sales), /not available to you/);
  const accepted = await f.decide(open[0].id, "accept", i.inventory);
  assert.equal(accepted.state, "accepted");
  assert.equal(accepted.outcome.kind, "allocated");
  const reserved = await f.one("select reserved_pieces, status from profile_stock_reservations where profile_stock_batch_id=$1", [held]);
  assert.deepEqual([reserved.reserved_pieces, reserved.status], [20, "active"]);
  // The other line's proposal is still valid after the first acceptance; the allocation rechecks the balance under its lock.
  assert.equal((await f.decide(open[1].id, "accept", i.factory)).state, "accepted");
  assert.equal((await f.one("select sum(reserved_pieces)::int n from profile_stock_reservations where profile_stock_batch_id=$1 and status='active'", [held])).n, 50);
});

test("AP-034 an edited quantity larger than the batch's remaining pieces is refused by the allocation and nothing is reserved", async () => {
  const o = await f.order({ kg: 570, pieces: 100, length: 6 });
  const batch = await f.stock({ pieces: 30 });
  await f.call("ap_jobs", "run_now", { job_key: "stock.arrival_reservations" }, i.owner);
  const [p] = await f.openProposals("stock.reservation");
  assert.deepEqual([p.payload.order_id, p.payload.pieces], [o.order, 30]);
  await assert.rejects(() => f.decide(p.id, "edit", i.inventory, { payload: { pieces: 31 } }), /exceeds available|Allocation exceeds/);
  assert.equal((await f.one("select count(*)::int n from profile_stock_reservations where profile_stock_batch_id=$1", [batch])).n, 0);
  assert.equal((await f.one("select status from proposals where id=$1", [p.id])).status, "open", "a refused acceptance leaves the proposal open");
});

// ---------------------------------------------------------------- AP-048
test("AP-048 a drawing read proposes kg/m from net area x alloy density and the outer perimeter; the owner accepts through the specification approval; a newer read makes the old proposal stale", async () => {
  const geometry = { units: "mm", outer_area_mm2: 1600, void_area_mm2: 1296, outer_perimeter_mm: 160, void_count: 1, entity_count: 2, warnings: [] };
  const base = { profile_id: i.profile2, file_name: "OM-2045.dxf", storage_path: `${i.company}/profile-drawings/${i.profile2}/a.dxf`, file_sha256: "d".repeat(64) };
  await assert.rejects(() => f.ap("ap_geometry", "draft", { ...base, geometry }, i.sales), denied);
  const read = await f.ap("ap_geometry", "draft", { ...base, geometry }, i.quality);
  assert.deepEqual([read.status, num(read.net_area_mm2), num(read.density_kg_m3), read.density_source, num(read.kg_per_m), num(read.finishing_area_m2_per_m)],
    ["proposed", 304, 2700, "standard", 0.8208, 0.16]);
  await f.ap("ap_geometry", "set_density", { alloy: "6063", density_kg_m3: 2690 }, i.quality);
  const second = await f.ap("ap_geometry", "draft", { ...base, file_sha256: "e".repeat(64), geometry }, i.quality);
  assert.deepEqual([second.density_source, num(second.kg_per_m)], ["alloy_master", 0.8178]);
  const [p] = await f.openProposals("profile.geometry");
  assert.equal(p.payload.read_id, second.id, "the newer read replaced the first proposal");
  assert.equal((await f.one("select status from profile_drawing_reads where id=$1", [read.id])).status, "superseded");
  await assert.rejects(() => f.decide(p.id, "accept", i.quality), /not available to you/);
  const out = await f.decide(p.id, "accept", i.owner);
  assert.equal(out.state, "accepted");
  const profile = await f.one("select section_weight_kg_per_m w, section_perimeter_mm per, surface_area_per_meter_sqm a from aluminium_profiles where id=$1", [i.profile2]);
  assert.deepEqual([num(profile.w), num(profile.per), num(profile.a)], [0.818, 160, 0.16], "the master keeps three decimals");
  assert.equal((await f.one("select count(*)::int n from profile_spec_change_approvals where profile_id=$1", [i.profile2])).n, 1, "the master weight change is on record with before and after");
  const unreadable = await f.ap("ap_geometry", "draft", { ...base, file_sha256: "f".repeat(64), geometry: { units: "unknown", entity_count: 3, warnings: ["No closed outline was found in the drawing."] } }, i.quality);
  assert.deepEqual([unreadable.status, unreadable.kg_per_m, unreadable.net_area_mm2], ["unreadable", null, null], "blank, never zero");
  await assert.rejects(() => f.ap("ap_geometry", "draft", { ...base, file_sha256: "1".repeat(64), geometry: { ...geometry, void_area_mm2: 1700 } }, i.quality), /out of range/);
  await assert.rejects(() => f.ap("ap_geometry", "reads", { profile_id: i.profile2 }, i.production), denied);
});

// ---------------------------------------------------------------- wiring
test("Batch 9 jobs are registered, tables are company-scoped with RLS and no client grants, gateways pin search_path and refuse dealers", async () => {
  const jobs = (await f.db.query("select job_key, schedule from private.ap_job_registry() where job_key in ('stock.arrival_reservations','cash.forecast_snapshot') order by 1")).rows;
  assert.deepEqual(jobs, [{ job_key: "cash.forecast_snapshot", schedule: "nightly" }, { job_key: "stock.arrival_reservations", schedule: "hourly" }]);
  for (const t of ["rate_cards", "scrap_grades", "scrap_offers", "scrap_sales", "scrap_sale_allocations", "scrap_sale_receipts", "scrap_invoice_counters", "customer_weight_tolerances",
    "weight_difference_notes", "weight_debit_note_counters", "cash_forecast_settings", "cash_fixed_expenses", "cash_one_offs", "cash_forecast_snapshots", "quote_enquiries", "enquiry_code_mappings",
    "register_templates", "register_captures", "register_capture_rows", "bundle_weight_captures", "profile_drawing_reads", "user_language_preferences"]) {
    const r = await f.one("select relrowsecurity rls from pg_class where oid=$1::regclass", [`public.${t}`]);
    assert.equal(r.rls, true, `${t} has RLS`);
    const grants = await f.one("select count(*)::int n from information_schema.role_table_grants where table_schema='public' and table_name=$1 and grantee in ('anon','authenticated')", [t]);
    assert.equal(grants.n, 0, `${t} has no client grants`);
  }
  for (const fn of ["ap_rate_card", "ap_scrap_sale", "ap_weight_note", "ap_cash_forecast", "ap_language", "ap_enquiry", "ap_register", "ap_scale", "ap_geometry"]) {
    const p = await f.one("select proconfig, has_function_privilege('anon', oid, 'EXECUTE') anon from pg_proc where proname=$1 and pronamespace='public'::regnamespace", [fn]);
    assert.ok(p.proconfig.some(c => c.startsWith("search_path=")), fn);
    assert.equal(p.anon, false, fn);
  }
  // Batch 3's receipts gateway is untouched by the cash forecast.
  assert.equal((await f.one("select count(*)::int n from pg_proc where proname='ap_cash' and pronamespace='public'::regnamespace")).n, 1);
  await assert.rejects(() => f.ap("ap_rate_card", "status", {}, i.dealer), denied);
  await assert.rejects(() => f.ap("ap_enquiry", "list", {}, i.inactive), denied);
});

test("Every batch 9 read command answers for its working role (no plpgsql name clashes)", async () => {
  const reads = [["ap_rate_card", "status", {}, i.sales], ["ap_rate_card", "list", {}, i.sales], ["ap_scrap_sale", "grades", {}, i.inventory], ["ap_scrap_sale", "offers", {}, i.inventory],
    ["ap_scrap_sale", "sales", {}, i.inventory], ["ap_weight_note", "tolerances", {}, i.accounts], ["ap_weight_note", "list", {}, i.accounts], ["ap_cash_forecast", "fixed", {}, i.accounts],
    ["ap_cash_forecast", "accuracy", {}, i.accounts], ["ap_enquiry", "list", { status: "all" }, i.sales], ["ap_register", "templates", {}, i.production], ["ap_register", "list", {}, i.production],
    ["ap_scale", "list", { show: "all" }, i.quality], ["ap_scale", "share", { days: 7 }, i.quality], ["ap_geometry", "reads", { profile_id: i.profile2 }, i.quality], ["ap_geometry", "densities", {}, i.quality]];
  for (const [rpc, command, payload, actor] of reads) await f.ap(rpc, command, payload, actor);
  assert.equal((await f.ap("ap_register", "save_template", { name: "Day register", columns: ["die_no", "pushes"] }, i.productionManager)).columns.length, 2);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPhase4Fixture, ids as i, istDay } from "../scripts/lib/fs-phase4-fixture.mjs";

// FABLE_SUGGESTIONS Phase 4 database behaviour (FS-68, 73, 72, 71, 27, 16, 26, 54, 38, 36). Expected values are worked out
// by hand in each test from the seeded quantities, not read back from the functions under test.
let f;
test.before(async () => { f = await createPhase4Fixture(); });
test.after(async () => { await f?.close(); });
test.beforeEach(async () => { await f.start(); });
test.afterEach(async () => { await f.rollback(); });
const denied = e => e.code === "42501";
const num = v => (v === null || v === undefined ? v : Number(v));
const window = { from: istDay(-20), to: istDay(0) };

// ---------------------------------------------------------------- FS-68
test("FS-68 OTIF is measured against the first promise, which later changes never move; in full uses the owner's tolerance", async () => {
  // A: promised 10 days ago, dispatched in full 12 days ago -> on time in full.
  const a = await f.order({ kg: 570 }); await f.promise(a.order, -10); await f.dispatchLine({ order: a.order, line: a.line, kg: 570, daysAgo: 12 });
  // B: first promised 6 days ago, then moved to 2 days ago; dispatched in full 3 days ago -> late against the FIRST promise.
  const b = await f.order({ kg: 570 }); await f.promise(b.order, -6); await f.promise(b.order, -2); await f.dispatchLine({ order: b.order, line: b.line, kg: 570, daysAgo: 3 });
  // C: promised 4 days ago; 520 of 570 kg dispatched 5 days ago (8.8% short) -> not complete at 0% tolerance.
  const c = await f.order({ kg: 570 }); await f.promise(c.order, -4); await f.dispatchLine({ order: c.order, line: c.line, kg: 520, daysAgo: 5 });

  const first = (await f.db.query("select order_item_id, first_promised_date::text d, source from order_line_first_promises where order_item_id = any($1)", [[a.line, b.line, c.line]])).rows;
  assert.equal(first.find(r => r.order_item_id === b.line).d, istDay(-6), "the first promise stays at the first date set");
  assert.ok(first.every(r => r.source === "captured"));
  const changes = (await f.db.query("select previous_date::text p, new_date::text n, cause, source from order_promise_changes where order_item_id=$1", [b.line])).rows;
  assert.deepEqual(changes, [{ p: istDay(-6), n: istDay(-2), cause: "not_recorded", source: "order_date" }]);

  const lines = (await f.ap("fs_otif", "lines", { ...window, outcome: "all" }, i.owner)).rows.filter(r => [a.line, b.line, c.line].includes(r.order_item_id));
  assert.deepEqual(Object.fromEntries(lines.map(r => [r.order_item_id, r.outcome])), { [a.line]: "otif", [b.line]: "late", [c.line]: "open_late" });
  let s = await f.ap("fs_otif", "summary", window, i.salesManager);
  assert.deepEqual([s.due, s.otif, s.late, s.open_late, num(s.otif_percent)], [3, 1, 1, 1, 33.3], "1 of 3 = 33.3%");

  // In full = dispatched >= ordered x (1 - tolerance): at 5% C needs 541.5 kg (not met); at 10% it needs 513 kg (met).
  await assert.rejects(() => f.ap("fs_otif", "save_settings", { in_full_tolerance_percent: 50, reason: "Owner decision" }, i.salesManager), denied);
  await assert.rejects(() => f.ap("fs_otif", "save_settings", { in_full_tolerance_percent: 11, reason: "Too wide" }, i.owner), /between 0 and 10/);
  await f.ap("fs_otif", "save_settings", { in_full_tolerance_percent: 5, reason: "Owner decision" }, i.owner);
  assert.equal((await f.ap("fs_otif", "summary", window, i.owner)).otif, 1, "520 < 541.5");
  await f.ap("fs_otif", "save_settings", { in_full_tolerance_percent: 10, reason: "Owner revised decision" }, i.owner);
  assert.equal((await f.db.query("select count(*)::int n from otif_setting_events where company_id=$1", [i.company])).rows[0].n, 2, "each change is recorded");
  s = await f.ap("fs_otif", "summary", window, i.owner);
  assert.deepEqual([s.otif, num(s.otif_percent)], [2, 66.7]);

  // Causes: the unrecorded change is annotated once; a delay cause is attributed to the late line.
  const change = (await f.ap("fs_otif", "history", { order_item_id: b.line }, i.owner)).changes[0];
  await f.ap("fs_otif", "annotate_change", { id: change.id, cause: "customer_request", agreed_with: "Mr Sharma (purchase)" }, i.salesManager);
  await assert.rejects(() => f.ap("fs_otif", "annotate_change", { id: change.id, cause: "die" }, i.salesManager), /already recorded/);
  await f.ap("fs_otif", "set_cause", { order_item_id: b.line, cause: "die", note: "Die under correction" }, i.productionManager);
  s = await f.ap("fs_otif", "summary", window, i.owner);
  assert.deepEqual(s.by.cause.map(g => [g.key, g.due]), [["die", 1]], "the explicit delay cause wins over the change annotation");

  // History is append-only; reads are role-scoped; another company sees nothing.
  await assert.rejects(() => f.raw("update order_line_first_promises set first_promised_date=current_date where order_item_id=$1", [b.line]), /cannot be changed/);
  await assert.rejects(() => f.raw("delete from order_promise_changes where order_item_id=$1", [b.line]), /cannot be deleted/);
  await assert.rejects(() => f.ap("fs_otif", "summary", window, i.production), denied);
  await assert.rejects(() => f.ap("fs_otif", "set_cause", { order_item_id: b.line, cause: "die" }, i.accounts), denied);
  assert.equal((await f.ap("fs_otif", "summary", window, i.foreign)).due, 0);
});

test("FS-68 a line's own date change is captured from its audited schedule event with the reason and the person", async () => {
  const o = await f.order({ kg: 400 }); await f.promise(o.order, 5);
  await f.raw(`insert into order_line_schedule_events(company_id,order_id,order_item_id,request_id,previous_required_date,new_required_date,reason,changed_by,changed_by_name)
    values($1,$2,$3,gen_random_uuid(),null,current_date+9,'Customer asked for later delivery',$4,'Fixture sales')`, [i.company, o.order, o.line, i.sales]);
  const h = await f.ap("fs_otif", "history", { order_item_id: o.line }, i.owner);
  assert.equal(h.first.first_promised_date, istDay(5));
  assert.deepEqual(h.changes.map(c => [c.previous_date, c.new_date, c.source, c.reason]), [[istDay(5), istDay(9), "line_schedule", "Customer asked for later delivery"]]);
});

// ---------------------------------------------------------------- FS-73
test("FS-73 thirteen weeks: an open collection promise dates the promised part, payments since the promise reduce it, and weeks below the minimum are flagged", async () => {
  const inv = await f.invoice({ kg: 570, rate: 300 }); // 171,000 + 18% = 201,780 due in 27 days
  await f.seed(`insert into collection_promises(id,company_id,invoice_id,employee_id,original_due_date,due_date,amount,baseline_paid,baseline_cash,baseline_credited)
    values(gen_random_uuid(),$1,$2,$3,current_date+10,current_date+10,50000,0,0,0)`, [i.company, inv.invoice, i.accounts]);
  let v = await f.ap("ap_cash_forecast", "forecast", { weeks: 13 }, i.accounts);
  assert.equal(v.weeks.length, 13);
  let items = v.weeks.flatMap(w => w.items).filter(x => x.ref_id === inv.invoice);
  assert.deepEqual(items.map(x => [num(x.amount), x.expected_on, x.basis.startsWith("Customer promised")]).sort((p, q) => p[0] - q[0]), [[50000, istDay(10), true], [151780, istDay(27), false]]);
  // 20,000 received after the promise: 30,000 of the promise remains; the invoice balance is 181,780.
  await f.seed("update invoices set amount_paid=20000, status='partially_paid' where id=$1", [inv.invoice]);
  v = await f.ap("ap_cash_forecast", "forecast", { weeks: 13 }, i.accounts);
  items = v.weeks.flatMap(w => w.items).filter(x => x.ref_id === inv.invoice);
  assert.deepEqual(items.map(x => num(x.amount)).sort((p, q) => p - q), [30000, 151780]);
  assert.equal(items.reduce((s, x) => s + num(x.amount), 0), 181780);

  await f.ap("ap_cash_forecast", "save_opening", { opening_balance: 100000 }, i.accounts);
  await f.ap("ap_cash_forecast", "save_minimum", { minimum_balance: 250000 }, i.accounts);
  v = await f.ap("ap_cash_forecast", "forecast", { weeks: 13 }, i.owner);
  let running = 100000;
  for (const w of v.weeks) { running = Math.round((running + num(w.net)) * 100) / 100; assert.equal(num(w.closing), running); assert.equal(w.below_minimum, running < 250000); }
  assert.equal(v.first_week_below_minimum, v.weeks.find(w => w.below_minimum)?.week_start ?? null);
  await assert.rejects(() => f.ap("ap_cash_forecast", "forecast", { weeks: 14 }, i.accounts), /from 1 to 13/);
  await assert.rejects(() => f.ap("ap_cash_forecast", "save_minimum", { minimum_balance: 1 }, i.sales), denied);
  assert.equal((await f.ap("ap_cash_forecast", "forecast", {}, i.accounts)).weeks.length, 4, "the AP-076 default stays four weeks");
});

// ---------------------------------------------------------------- FS-72
test("FS-72 the net open position nets uncovered fixed-price metal against metal held and on order; bookings cannot over-cover; the owner's limit alerts and clears", async () => {
  const base = await f.ap("fs_metal_exposure", "position", {}, i.owner);
  const o = await f.order({ kg: 1000 });
  let p = await f.ap("fs_metal_exposure", "position", {}, i.accounts);
  assert.equal(num(p.sold_open_kg) - num(base.sold_open_kg), 1000);
  await f.ap("fs_metal_exposure", "book", { order_id: o.order, supplier_reference: "Hindalco PO-778", quantity_kg: 400, rate_per_kg: 246.5 }, i.accounts);
  await assert.rejects(() => f.ap("fs_metal_exposure", "book", { order_id: o.order, supplier_reference: "Second", quantity_kg: 700, rate_per_kg: 246 }, i.accounts), /needs 600/);
  await f.billetStock({ kg: 250 });
  p = await f.ap("fs_metal_exposure", "position", {}, i.owner);
  assert.equal(num(p.uncovered_kg) - num(base.uncovered_kg), 600, "1000 sold - 400 booked");
  assert.equal(num(p.stock.total_kg) - num(base.stock.total_kg), 250);
  assert.equal(Math.round((num(p.net_kg) - num(base.net_kg)) * 1000) / 1000, 350, "600 uncovered - 250 held");
  assert.equal(num(p.impact_of_step), Math.round(Math.abs(num(p.net_kg)) * 5 * 100) / 100, "a ₹5/kg move on the net position");

  // Limit below the position: the morning check alerts once; a wider limit clears it.
  await assert.rejects(() => f.ap("fs_metal_exposure", "save_settings", { open_position_limit_kg: 1, reason: "Owner limit" }, i.accounts), denied);
  await f.ap("fs_metal_exposure", "save_settings", { open_position_limit_kg: 1, price_step_per_kg: 2.5, reason: "Owner limit" }, i.owner);
  await f.db.query("select private.fs4_exposure_snapshot($1)", [i.company]);
  const open = () => f.db.query("select count(*)::int n from notifications where company_id=$1 and condition_key='fs4:metal-exposure' and resolved_at is null", [i.company]).then(r => r.rows[0].n);
  assert.equal(await open(), Math.abs(num(p.net_kg)) > 1 ? 1 : 0);
  p = await f.ap("fs_metal_exposure", "position", {}, i.owner);
  assert.equal(num(p.impact_of_step), Math.round(Math.abs(num(p.net_kg)) * 2.5 * 100) / 100);
  await f.ap("fs_metal_exposure", "save_settings", { open_position_limit_kg: 100000000, reason: "Wider limit" }, i.owner);
  assert.equal(await open(), 0, "back within the limit closes the alert");

  // A price-linked order leaves the fixed-price position; cancelling the booking uncovers it again.
  await f.ap("fs_metal_exposure", "set_terms", { order_id: o.order, basis: "price_linked", note: "LME-linked contract" }, i.accounts);
  p = await f.ap("fs_metal_exposure", "position", {}, i.owner);
  assert.equal(num(p.uncovered_kg), num(base.uncovered_kg));
  assert.equal(num(p.price_linked_kg) - num(base.price_linked_kg), 1000);
  const bookings = (await f.ap("fs_metal_exposure", "bookings", {}, i.accounts)).rows;
  await f.ap("fs_metal_exposure", "cancel_booking", { id: bookings[0].id, reason: "Supplier withdrew" }, i.accounts);
  assert.equal((await f.ap("fs_metal_exposure", "bookings", { status: "cancelled" }, i.owner)).total_count, 1);
  await assert.rejects(() => f.ap("fs_metal_exposure", "position", {}, i.sales), denied);
});

// ---------------------------------------------------------------- FS-71
test("FS-71 win rates are measured from decided quotes (at least ten), a set probability is used as set, and the order book counts kg not yet dispatched", async () => {
  const before = await f.ap("fs_order_book", "overview", {}, i.owner);
  for (let k = 0; k < 6; k++) await f.quote({ status: "customer_approved" });
  for (let k = 0; k < 4; k++) await f.quote({ status: "customer_rejected" });
  await f.quote({ status: "sent", kg: 2000, value: 400000 });
  const counted = (await f.db.query(`select count(*) filter (where status in ('customer_approved','converted_to_order'))::int won, count(*)::int decided from quotes
    where company_id=$1 and deleted_at is null and sent_at is not null and quote_date >= current_date-365 and status in ('customer_approved','converted_to_order','customer_rejected','expired')`, [i.company])).rows[0];
  let v = await f.ap("fs_order_book", "overview", {}, i.salesManager);
  assert.ok(counted.decided >= 10);
  assert.equal(num(v.pipeline.win_rates.sent.percent), Math.round(counted.won * 1000 / counted.decided) / 10);
  await f.ap("fs_order_book", "save_settings", { probability_sent_percent: 25, reason: "Sales manager judgement for Q3" }, i.salesManager);
  v = await f.ap("fs_order_book", "overview", {}, i.owner);
  const sent = v.pipeline.stages.find(s => s.stage === "sent");
  assert.deepEqual([num(sent.probability_percent), sent.probability_source], [25, "set"]);
  assert.equal(num(sent.weighted_value), Math.round(num(sent.value) * 25) / 100);
  assert.ok(num(sent.kg) - num(before.pipeline.stages.find(s => s.stage === "sent").kg) >= 2000);

  const o = await f.order({ kg: 570 });
  v = await f.ap("fs_order_book", "overview", {}, i.owner);
  assert.equal(Math.round((num(v.order_book.open_kg) - num(before.order_book.open_kg)) * 10) / 10, 570);
  await f.dispatchLine({ order: o.order, line: o.line, kg: 200, daysAgo: 1 });
  v = await f.ap("fs_order_book", "overview", {}, i.owner);
  assert.equal(Math.round((num(v.order_book.open_kg) - num(before.order_book.open_kg)) * 10) / 10, 370);

  // Press load: 3,000 kg of open jobs on a press with two 1,000 kg shifts on seven weekdays = 3000 / 14000 weeks.
  const press = await f.press({ name: "Press P4" }); await f.shifts(press, 1000);
  await f.job({ machine: press, kg: 3000 });
  v = await f.ap("fs_order_book", "overview", {}, i.owner);
  const row = v.presses.find(x => x.machine_id === press);
  assert.deepEqual([num(row.weekly_capacity_kg), num(row.weeks_of_load)], [14000, 0.2]);

  // Concentration: an independent sum over the same invoices.
  const top = (await f.db.query(`with c as (select customer_id, sum(subtotal) v from invoices where company_id=$1 and deleted_at is null and opening_cutover_id is null
    and status in ('generated','sent','partially_paid','paid','overdue') and invoice_date > current_date-365 group by customer_id)
    select round(coalesce((select sum(v) from (select v from c order by v desc limit 5) t),0)*100/nullif(sum(v),0),1) s from c`, [i.company])).rows[0].s;
  assert.equal(num(v.concentration.top5_share_percent), num(top));

  // A customer with three orders in the prior 270 days and none in the last 90 is listed as dropping.
  await f.orderHistory(i.customer4, [[120, 900], [180, 900], [240, 900]]);
  v = await f.ap("fs_order_book", "overview", {}, i.owner);
  const drop = v.dropping.find(d => d.customer_id === i.customer4);
  assert.deepEqual([num(drop.recent_90_kg), num(drop.average_90_kg), num(drop.change_percent)], [0, 900, -100]);
  await assert.rejects(() => f.ap("fs_order_book", "save_settings", { reason: "Not mine to set" }, i.sales), denied);
});

// ---------------------------------------------------------------- FS-27
test("FS-27 billet demand by week explains every kilogram, separates firm from uncertain, lists what cannot be calculated and needs the owner's approval of the current plan", async () => {
  const prof = await f.profile({ code: "OM-P4-27", alloy: "6082" });
  await f.seed("update aluminium_profiles set billet_diameter_required_inch=9 where id=$1", [prof]);
  // Firm: a job of 950 kg at a recorded 95% recovery needs 1,000 kg of billet; 300 kg is in stock.
  const job = await f.job({ profile: prof, kg: 950, plannedIn: 1 });
  await f.seed("update production_jobs set extrusion_efficiency_percent=95 where id=$1", [job.job]);
  await f.billetStock({ kg: 300, alloy: "6082", diameterMm: 228.6 });
  // Unknown: a job on a profile with no billet diameter recorded is listed, not guessed.
  const bare = await f.profile({ code: "OM-P4-NODIA", alloy: "6082" });
  await f.seed("update aluminium_profiles set billet_diameter_required_inch=null where id=$1", [bare]);
  const unknown = await f.job({ profile: bare, kg: 500, plannedIn: 2 });
  await f.seed("update production_jobs set job_number='JOB-NO-DIAMETER' where id=$1", [unknown.job]);
  await f.seed("update order_items set profile_id=$2 where order_id=$1", [unknown.order, bare]);
  await f.seed("update order_items set profile_id=$2 where order_id=$1", [job.order, prof]);
  await f.seed("insert into inventory_items(company_id,item_code,item_name,item_category,unit,current_stock,reorder_level,is_active) values($1,'PK-STRETCH','Stretch film','packing_material','roll',40,100,true)", [i.company]);

  const plan = await f.ap("fs_mrp", "plan", {}, i.inventory);
  const g = plan.billet.find(b => b.alloy === "6082" && num(b.diameter_inch) === 9);
  assert.equal(num(g.free_kg), 300);
  assert.equal(num(g.firm_shortfall_kg), 700, "1000 needed - 300 free");
  assert.equal(g.action, "buy");
  assert.ok(g.drivers.some(d => d.reference.startsWith("JOB-8-") && num(d.kg) === 1000 && d.firm));
  assert.ok(plan.unknown.some(u => u.reference === "JOB-NO-DIAMETER" && /billet diameter/.test(u.missing)), JSON.stringify(plan.unknown));
  const film = plan.consumables.find(c => c.item_code === "PK-STRETCH");
  assert.equal(num(film.suggest_quantity), 60, "back up to the reorder level of 100");

  await assert.rejects(() => f.ap("fs_mrp", "approve", { fingerprint: plan.fingerprint }, i.inventory), denied);
  assert.equal((await f.ap("fs_mrp", "approve", { fingerprint: "0".repeat(32) }, i.owner)).state, "stale");
  const ok = await f.ap("fs_mrp", "approve", { fingerprint: plan.fingerprint, note: "Buy from usual supplier" }, i.owner);
  assert.equal(ok.state, "approved");
  const after = await f.ap("fs_mrp", "plan", {}, i.owner);
  assert.equal(after.approved.current, true);
  await assert.rejects(() => f.ap("fs_mrp", "action", { plan_id: ok.id, line_key: g.line_key, action: "not_needed" }, i.inventory), /why it is not needed/);
  await f.ap("fs_mrp", "action", { plan_id: ok.id, line_key: g.line_key, action: "po_raised", reference: "PO-2611-041" }, i.inventory);
  await assert.rejects(() => f.ap("fs_mrp", "action", { plan_id: ok.id, line_key: g.line_key, action: "po_raised", reference: "PO-again" }, i.inventory), /already actioned/);
  assert.equal((await f.ap("fs_mrp", "plan", {}, i.owner)).approved.actions[g.line_key].reference, "PO-2611-041");
  await assert.rejects(() => f.ap("fs_mrp", "plan", {}, i.sales), denied);
});

// ---------------------------------------------------------------- FS-16
test("FS-16 remaining die life against open demand raises one replacement warning; peer life needs three retired dies; costs are hidden from the floor", async () => {
  const d = await f.die({ number: "D-P4-LIFE", lifeTons: 10, cost: 120000, maker: "Precision Die Works", ownership: "customer_owned" });
  await f.completedRun({ die: d, kg: 9000, daysAgo: 7 });
  const o = await f.order({ kg: 2000 });
  await f.seed("update order_items set die_id=$2 where id=$1", [o.line, d]);
  const inv = await f.invoice({ kg: 100, rate: 300 });
  await f.seed("insert into invoice_items(company_id,invoice_id,die_id,item_description,quantity,unit_rate,line_total,gst_percent,line_kind) values($1,$2,$3,'Die charge',1,25000,25000,18,'die_charge')", [i.company, inv.invoice, d]);
  let rows = (await f.ap("fs_die_life", "dies", { search: "D-P4-LIFE" }, i.owner)).rows;
  assert.equal(rows.length, 1);
  const x = rows[0];
  assert.deepEqual([num(x.used_kg), num(x.life_kg), num(x.remaining_kg), num(x.open_demand_kg), x.replace_flag], [9000, 10000, 1000, 2000, true]);
  assert.equal(num(x.weekly_kg), 1125, "9000 kg in the last eight weeks");
  assert.equal(num(x.recovered_amount), 25000);
  assert.match(x.replace_reason, /less than open order demand/);
  const floor = (await f.ap("fs_die_life", "dies", { search: "D-P4-LIFE" }, i.production)).rows[0];
  assert.ok(!("die_cost" in floor) && !("recovered_amount" in floor), "no cost on the floor");

  const warn = () => f.db.query("select count(*)::int n from notifications where company_id=$1 and condition_key=$2 and resolved_at is null", [i.company, `fs4:die-replace:${d}`]).then(r => r.rows[0].n);
  await f.db.query("select private.ap_job_execute($1,'intelligence.morning',null)", [i.company]);
  await f.db.query("select private.ap_job_execute($1,'intelligence.morning',null)", [i.company]);
  assert.equal(await warn(), 1, "one warning, not one per run");
  await f.seed("update dies set die_life_tons=100 where id=$1", [d]);
  await f.db.query("select private.ap_job_execute($1,'intelligence.morning',null)", [i.company]);
  assert.equal(await warn(), 0, "cleared when life covers demand");

  // Peer life: median of 3 retired hollow dies with 5,000, 7,000 and 9,000 kg is 7,000 kg.
  for (const kg of [5000, 7000, 9000]) { const r = await f.die({ type: "hollow", status: "retired" }); await f.completedRun({ die: r, kg, daysAgo: 400 }); }
  const fresh = await f.die({ number: "D-P4-PEER", type: "hollow" });
  rows = (await f.ap("fs_die_life", "dies", { search: "D-P4-PEER" }, i.productionManager)).rows;
  assert.deepEqual([num(rows[0].life_kg), rows[0].life_basis], [7000, "Median life of 3 retired hollow dies"]);
  const lone = await f.die({ number: "D-P4-LONE", type: "porthole" });
  assert.equal((await f.ap("fs_die_life", "dies", { search: "D-P4-LONE" }, i.owner)).rows[0].life_kg, null, "no life is invented");
  assert.ok(fresh && lone);

  const makers = (await f.ap("fs_die_life", "makers", {}, i.owner)).rows;
  const pdw = makers.find(m => m.maker === "Precision Die Works");
  assert.equal(num(pdw.kg_per_1000_inr), Math.round(9000 / 120000 * 1000 * 10) / 10, "75 kg per ₹1,000");
  await assert.rejects(() => f.ap("fs_die_life", "makers", {}, i.production), denied);
  await assert.rejects(() => f.ap("fs_die_life", "save_settings", { replacement_lead_days: 45, reason: "Die shop" }, i.production), denied);
});

// ---------------------------------------------------------------- FS-26
test("FS-26 the promise date waits for an away die; a breakdown lists scheduled work whose slack is shorter than the stoppage", async () => {
  const press = await f.press({ name: "Press P4-26" }); await f.shifts(press, 1000);
  await f.seed("update production_jobs set machine_id=$2 where company_id=$1 and profile_id=$3 and machine_id is null", [i.company, press, i.profile2]);
  const plain = await f.ap("fs_promise", "estimate", { profile_id: i.profile2, quantity_kg: 500 }, i.sales);
  assert.ok(plain.earliest_dispatch, JSON.stringify(plain.constraints));
  await f.seed(`insert into die_availability_windows(company_id,die_id,reason,starts_on,expected_return,status,set_by) values($1,$2,'nitriding',current_date,current_date+40,'open',$3)`, [i.company, i.die, i.productionManager]);
  const away = await f.ap("fs_promise", "estimate", { profile_id: i.profile2, quantity_kg: 500 }, i.sales);
  assert.equal(away.die_ready, istDay(40));
  assert.ok(away.earliest_dispatch > istDay(40), "dispatch after the die returns");
  assert.ok(away.constraints.some(c => c.kind === "die"));

  const job = await f.job({ machine: press, kg: 400, plannedIn: 1, due: 2 });
  await f.seed(`insert into production_plan_slots(company_id,production_job_id,machine_id,planned_start_at,planned_end_at,sequence_number,status,created_by)
    values($1,$2,$3,(current_date+1+time '08:00') at time zone 'Asia/Kolkata',(current_date+1+time '12:00') at time zone 'Asia/Kolkata',1,'scheduled',$4)`, [i.company, job.job, press, i.productionManager]);
  await f.seed(`insert into breakdown_logs(company_id,machine_id,machine_ref_id,machine_type,breakdown_date,start_time,issue_description,status)
    values($1,$3,$2,'extrusion_press',current_date-2,now()-interval '2 days','Main ram seal leak','open')`, [i.company, press, String(press)]);
  const r = await f.ap("fs_promise", "reflow", {}, i.productionManager);
  const w = r.breakdowns.flatMap(b => b.work).find(x => x.job_id === job.job);
  assert.equal(num(w.slack_days), 1, "promise in 2 days, planned end tomorrow");
  assert.equal(w.at_risk, true, "1 day of slack < 2 days down");
  await assert.rejects(() => f.ap("fs_promise", "reflow", {}, i.accounts), denied);
});

// ---------------------------------------------------------------- FS-54
test("FS-54 a development moves one stage at a time and each stage needs its evidence; history is append-only", async () => {
  const d = await f.ap("fs_development", "create", { title: "3-track sliding sash", customer_id: i.customer2, drawing_reference: "CUST-DRG-114 rev B" }, i.sales);
  assert.match(d.project_number, /^DEV-\d{4}-001$/);
  const move = (to, note = "Moved on", actor = i.salesManager) => f.ap("fs_development", "move", { id: d.id, to_stage: to, note }, actor);
  await assert.rejects(() => move("die_quotation"), /one stage at a time/);
  await move("feasibility");
  await assert.rejects(() => move("die_quotation"), /feasible verdict/);
  await f.ap("fs_development", "update", { id: d.id, feasibility: { ccd_mm: 145, weight_kg_per_m: 1.12, min_wall_mm: 1.4, tongue_ratio: 2.1, verdict: "feasible" } }, i.productionManager);
  await move("die_quotation");
  await assert.rejects(() => move("die_ordered"), /die cost, who pays/);
  await f.ap("fs_development", "update", { id: d.id, die_cost: 145000, die_cost_payer: "customer", amortisation_terms: "Refunded after 10 t", expected_die_date: istDay(21) }, i.salesManager);
  await assert.rejects(() => move("die_ordered"), /customer's approval of the die cost/);
  await f.ap("fs_development", "update", { id: d.id, die_cost_approved_by_customer_at: istDay(0) }, i.salesManager);
  await move("die_ordered");
  await assert.rejects(() => move("die_received"), /Link the received die/);
  const die = await f.die({ number: "D-DEV-1", status: "under_trial" });
  await f.ap("fs_development", "update", { id: d.id, die_id: die }, i.productionManager);
  await move("die_received"); await move("trial", "Trial 1");
  await move("trial", "Trial 2 after bearing correction");
  await assert.rejects(() => move("sample_submitted"), /at least one trial/);
  await f.seed("insert into die_trials(company_id,die_id,trial_date,trial_result) values($1,$2,current_date,'pass')", [i.company, die]);
  await assert.rejects(() => move("sample_submitted"), /sample reference/);
  await f.ap("fs_development", "update", { id: d.id, sample_reference: "SMP-0042" }, i.quality);
  await move("sample_submitted"); await move("customer_approval");
  await assert.rejects(() => move("released"), /customer's approval and link the profile/);
  await f.ap("fs_development", "update", { id: d.id, customer_approval_reference: "Email 14 Nov from buyer", profile_id: i.profile2 }, i.salesManager);
  const done = await move("released", "Approved for production");
  assert.equal(done.trial_count, 2);
  await assert.rejects(() => move("trial"), /closed/);
  const full = await f.ap("fs_development", "get", { id: d.id }, i.production);
  assert.deepEqual(full.events.map(e => e.to_stage), ["enquiry", "feasibility", "die_quotation", "die_ordered", "die_received", "trial", "trial", "sample_submitted", "customer_approval", "released"]);
  assert.equal(num(full.events.at(-1).evidence.die_cost), 145000);
  await assert.rejects(() => f.raw("update development_events set note='edited' where project_id=$1", [d.id]), /cannot be changed/);
  await assert.rejects(() => f.ap("fs_development", "create", { title: "Not allowed", customer_id: i.customer2 }, i.production), denied);
  await assert.rejects(() => f.ap("fs_development", "get", { id: d.id }, i.foreign), /not found/);
});

// ---------------------------------------------------------------- FS-38
test("FS-38 the cockpit's yesterday figures are the stored digest and its live figures equal the detailed screens", async () => {
  const c = await f.ap("fs_cockpit", "today", {}, i.owner);
  const stored = (await f.db.query("select metrics, generated_at from owner_daily_digests where company_id=$1 and digest_date=$2", [i.company, istDay(0)])).rows[0];
  assert.deepEqual(c.yesterday, stored.metrics);
  const otif = await f.ap("fs_otif", "summary", { from: istDay(-29), to: istDay(0) }, i.owner);
  assert.deepEqual([c.otif.due, num(c.otif.percent)], [otif.due, num(otif.otif_percent)]);
  const metal = await f.ap("fs_metal_exposure", "position", {}, i.owner);
  assert.equal(num(c.metal.net_kg), num(metal.net_kg));
  const book = await f.ap("fs_order_book", "overview", {}, i.owner);
  assert.equal(num(c.order_book.open_kg), num(book.order_book.open_kg));
  assert.match(c.message, /Omalco owner brief/);
  assert.match(c.message, /Internal management summary/);
  assert.equal((await f.ap("fs_cockpit", "today", {}, i.admin)).digest_generated_at, c.digest_generated_at, "the same stored digest on every read that day");
  await assert.rejects(() => f.ap("fs_cockpit", "today", {}, i.accounts), denied);
  await assert.rejects(() => f.ap("fs_cockpit", "today", {}, i.salesManager), denied);
  assert.ok((await f.ap("fs_cockpit", "trend", {}, i.owner)).basis);
});

// ---------------------------------------------------------------- FS-36
test("FS-36 the wall shows each press with a stoppage in red, and the Realtime block publishes only the live-screen tables", async () => {
  const press = await f.press({ name: "Press Wall" });
  await f.seed(`insert into breakdown_logs(company_id,machine_id,machine_ref_id,machine_type,breakdown_date,start_time,issue_description,status)
    values($1,$3,$2,'extrusion_press',current_date,now()-interval '1 hour','Puller fault','in_progress')`, [i.company, press, String(press)]);
  const w = await f.ap("fs_wall", "board", {}, i.production);
  assert.equal(w.presses.find(p => p.machine_id === press).stoppage.issue, "Puller fault");
  await assert.rejects(() => f.ap("fs_wall", "board", {}, i.dealer), denied);

  // PGlite has no supabase_realtime publication, so the migration skipped it; replay the same block against one.
  const sql = readFileSync(new URL("../supabase/migrations/20261118120000_fs_phase4_planning_cockpit.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const start = sql.indexOf("do $$\ndeclare t text;");
  assert.ok(start > 0, "the Realtime block is in the migration");
  const block = sql.slice(start, sql.indexOf("$$;", start) + 3);
  await f.db.exec("create publication supabase_realtime");
  await f.db.exec(block); await f.db.exec(block);
  const published = (await f.db.query("select c.relname from pg_publication_rel pr join pg_publication p on p.oid=pr.prpubid join pg_class c on c.oid=pr.prrelid where p.pubname='supabase_realtime' order by 1")).rows.map(r => r.relname);
  assert.deepEqual(published, ["action_requests", "approval_decisions", "breakdown_logs", "dispatches", "notifications", "orders", "production_jobs", "production_plan_slots", "production_push_events"]);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createBatch8Fixture, ids as i, istDay } from "../scripts/lib/autopilot-batch8-fixture.mjs";

let f;
test.before(async () => { f = await createBatch8Fixture(); });
test.after(async () => { await f?.close(); });
test.beforeEach(async () => { await f.start(); });
test.afterEach(async () => { await f.rollback(); });
const denied = e => e.code === "42501";

// ---------------------------------------------------------------- AP-092
test("AP-092 saved views belong to one person; one default per page; names are unique; bad queries and the 21st view are refused", async () => {
  const a = await f.ap("ap_views", "save", { page_key: "orders", name: "Packing", query: "status=packing", make_default: true }, i.sales);
  const b = await f.ap("ap_views", "save", { page_key: "orders", name: "Urgent", query: "secondary=urgent", make_default: true }, i.sales);
  assert.equal((await f.ap("ap_views", "default", { page_key: "orders" }, i.sales)).view.id, b.id, "a new default replaces the old one");
  const listed = await f.ap("ap_views", "list", { page_key: "orders" }, i.sales);
  assert.deepEqual(listed.views.map(v => [v.name, v.is_default]), [["Urgent", true], ["Packing", false]]);
  const again = await f.ap("ap_views", "save", { page_key: "orders", name: "packing", query: "status=packing&sort=order_number" }, i.sales);
  assert.equal(again.id, a.id, "saving the same name (any case) updates that view");
  assert.equal((await f.ap("ap_views", "list", { page_key: "orders" }, i.salesManager)).views.length, 0, "another person sees none of them");
  await assert.rejects(() => f.ap("ap_views", "delete", { id: a.id }, i.salesManager), /not found/);
  await assert.rejects(() => f.ap("ap_views", "set_default", { id: a.id }, i.foreign), /not found/);
  await assert.rejects(() => f.ap("ap_views", "save", { page_key: "orders", name: "Bad", query: "status=<script>" }, i.sales), /cannot be saved/);
  await assert.rejects(() => f.ap("ap_views", "save", { page_key: "Orders!", name: "Bad", query: "" }, i.sales), /Unknown list page/);
  for (let n = 0; n < 18; n++) await f.ap("ap_views", "save", { page_key: "orders", name: `View ${n}`, query: `page=${n}` }, i.sales);
  await assert.rejects(() => f.ap("ap_views", "save", { page_key: "orders", name: "One too many", query: "" }, i.sales), /20 saved views/);
  await f.ap("ap_views", "clear_default", { page_key: "orders" }, i.sales);
  assert.equal((await f.ap("ap_views", "default", { page_key: "orders" }, i.sales)).view, null);
  await assert.rejects(() => f.ap("ap_views", "list", { page_key: "orders" }, i.dealer), denied);
  // Reads go through the gateway only (the row policy is the second layer).
  await assert.rejects(() => f.asUser("select count(*) from saved_list_views", [], i.sales), /permission denied/);
});

// ---------------------------------------------------------------- AP-065
test("AP-065 a die away is unavailable until marked back; an overdue return stays unavailable; planned jobs are warned and the alert closes itself", async () => {
  const j = await f.job({ plannedIn: 2, due: 4 });
  const away = await f.ap("ap_die_window", "set", { die_id: i.die, reason: "nitriding", starts_on: istDay(0), expected_return: istDay(5), note: "Sent to Shree Nitriding" }, i.productionManager);
  assert.equal(away.today.state, "unavailable");
  const view = await f.ap("ap_die_window", "die", { die_id: i.die }, i.sales);
  const warnings = view.jobs.find(x => x.id === j.job).warnings;
  assert.deepEqual(warnings.map(w => w.code).sort(), ["die_unavailable", "due_depends_on_return"]);
  assert.match(warnings.find(w => w.code === "die_unavailable").message, /at nitriding .*expected back/);
  const alert = await f.one("select count(*)::int n from notifications where condition_key=$1 and resolved_at is null", [`die-unavailable:${j.job}`]);
  assert.ok(alert.n > 0, "planners are told");
  // Moving the job after the return clears the plan warning; the due date still depends on the return.
  await f.raw("update production_jobs set planned_date=current_date+6 where id=$1", [j.job]);
  const moved = (await f.ap("ap_die_window", "jobs", { job_ids: [j.job] }, i.productionManager)).warnings[j.job];
  assert.deepEqual(moved.map(w => w.code), ["due_depends_on_return"]);
  // Overdue: the expected return passed and the die never came back, so it is still unavailable on any date.
  await f.seed("update die_availability_windows set starts_on=current_date-10, expected_return=current_date-2 where id=$1", [away.id]);
  const late = (await f.ap("ap_die_window", "jobs", { job_ids: [j.job] }, i.productionManager)).warnings[j.job];
  assert.ok(late.some(w => w.code === "return_overdue" && /has not returned/.test(w.message)), "overdue returns are highlighted, never assumed back");
  assert.equal((await f.ap("ap_die_window", "conflicts", {}, i.productionManager)).overdue, 1);
  await assert.rejects(() => f.ap("ap_die_window", "set", { die_id: i.die, reason: "nitriding", starts_on: istDay(0) }, i.sales), denied);
  await assert.rejects(() => f.ap("ap_die_window", "close", { id: away.id, note: "ok" }, i.productionManager), /3 to 300|Note/);
  await f.ap("ap_die_window", "close", { id: away.id, note: "Nitrided and inspected" }, i.quality);
  assert.equal((await f.ap("ap_die_window", "die", { die_id: i.die })).today.state, "available");
  await f.call("ap_jobs", "run_now", { job_key: "dies.availability" }, i.owner);
  assert.equal((await f.one("select count(*)::int n from notifications where condition_key=$1 and resolved_at is null", [`die-unavailable:${j.job}`])).n, 0, "the alert closed once the die was back");
  await assert.rejects(() => f.ap("ap_die_window", "close", { id: away.id, note: "Again" }, i.quality), /already marked back/);
  await assert.rejects(() => f.ap("ap_die_window", "die", { die_id: i.die }, i.foreign), /not found/);
});

test("AP-065 an open returnable gate pass and a blocking die status make the die unavailable; a booked service without a return date is flagged", async () => {
  const j = await f.job({ plannedIn: 3 });
  await f.seed(`insert into returnable_gate_passes(company_id,pass_number,item_kind,die_id,item_label,quantity,custodian_name,custodian_kind,purpose,due_date,original_due_date,follow_up_owner,status,issued_by,departed_at)
    values($1,'RGP-8-1','die',$2,'Die D-2045-A',1,'Precision Die Works','vendor','Correction of bearing',current_date+7,current_date+7,$3,'out',$3,now())`, [i.company, i.die, i.owner]);
  const s = (await f.ap("ap_die_window", "die", { die_id: i.die })).today;
  assert.deepEqual([s.state, s.source, s.custodian], ["unavailable", "gate_pass", "Precision Die Works"]);
  assert.ok((await f.ap("ap_die_window", "jobs", { job_ids: [j.job] })).warnings[j.job].some(w => w.code === "die_unavailable"));
  await f.seed("update returnable_gate_passes set status='closed', closed_at=now() where company_id=$1 and die_id=$2", [i.company, i.die]);
  await f.seed("update dies set die_status='correction' where id=$1", [i.die]);
  assert.equal((await f.ap("ap_die_window", "die", { die_id: i.die })).today.until, null, "status without a return date: return unknown");
  await f.seed("update dies set die_status='active' where id=$1", [i.die]);
  await f.seed("insert into die_service_bookings(company_id,die_id,service_event,scheduled_for,booked_by) values($1,$2,'nitriding',current_date+1,$3)", [i.company, i.die, i.owner]);
  const w = (await f.ap("ap_die_window", "jobs", { job_ids: [j.job] })).warnings[j.job];
  assert.deepEqual(w.map(x => x.code), ["service_booked"]);
});

// ---------------------------------------------------------------- AP-069
test("AP-069 weekly booked and available kg for the profile's presses, unscheduled work first, the earliest week and the accuracy read", async () => {
  const p1 = await f.press({ name: "Press 1", code: "P1" }); const p2 = await f.press({ name: "Press 2" });
  await f.seed("update aluminium_profiles set compatible_presses=array['P1'] where id=$1", [i.profile2]);
  const none = await f.ap("ap_capacity", "profile", { profile_id: i.profile2, quantity_kg: 500 }, i.sales);
  assert.equal(none.configured, false, "no shift capacity: no suggestion, never a zero-capacity week");
  assert.equal(none.earliest_week, null);
  await f.shifts(p1, 1000); await f.shifts(p2, 1000);
  await f.seed("insert into factory_finishing_lead_times(company_id,finishing_type,lead_days,updated_by) values($1,'mill_finish',2,$2) on conflict do nothing", [i.company, i.owner]);
  const empty = await f.ap("ap_capacity", "profile", { profile_id: i.profile2, quantity_kg: 500 }, i.sales);
  assert.deepEqual([empty.press_group.basis, empty.press_group.machines.map(m => m.name)], ["profile", ["Press 1"]]);
  assert.ok(empty.weeks.length === 8 && empty.weeks[1].available_kg > 0);
  assert.equal(empty.earliest_week, empty.weeks[0].free_kg >= 500 ? empty.weeks[0].week_start : empty.weeks[1].week_start);
  // Book the whole of next week on Press 1, and leave more unscheduled work than this week can take: the quote moves out.
  const nextWeek = empty.weeks[1];
  const booked = await f.job({ plannedIn: Math.round((Date.parse(nextWeek.week_start) - Date.parse(istDay(0))) / 86400000) + 1, machine: p1, kg: nextWeek.available_kg });
  const unscheduled = await f.job({ plannedIn: null, machine: p1, kg: empty.weeks[0].free_kg + 1000 });
  const busy = await f.ap("ap_capacity", "profile", { profile_id: i.profile2, quantity_kg: 500 }, i.sales);
  assert.equal(busy.weeks[1].free_kg, 0);
  assert.equal(busy.unscheduled_kg, empty.weeks[0].free_kg + 1000);
  assert.equal(busy.earliest_week, busy.weeks[2].week_start, "this week goes to unscheduled work, next week is full");
  assert.ok(busy.ready_by > busy.earliest_week, "finishing lead time gives a dispatch estimate");
  const q = await f.draftQuote({});
  await f.seed("update quote_items set profile_id=$2, billing_weight_kg=500 where quote_id=$1", [q.quote ?? q, i.profile2]);
  const quoteId = q.quote ?? q;
  const view = await f.ap("ap_capacity", "quote", { quote_id: quoteId }, i.salesManager);
  assert.equal(view.lines[0].earliest_week, busy.earliest_week);
  const rec = await f.ap("ap_capacity", "record", { quote_id: quoteId, profile_id: i.profile2, used: true }, i.sales);
  assert.ok(rec.check_id);
  assert.equal((await f.ap("ap_capacity", "accuracy", {}, i.sales)).summary.compared, 0, "nothing compared until the quote is an order with finished jobs");
  await assert.rejects(() => f.ap("ap_capacity", "profile", { profile_id: i.profile2 }, i.dispatchManager), denied);
  await assert.rejects(() => f.ap("ap_capacity", "quote", { quote_id: quoteId }, i.foreign), /not found/);
  void booked; void unscheduled;
});

// ---------------------------------------------------------------- AP-050
test("AP-050 health falls on a slower order rhythm, lower volume, overdue invoices, complaints and lost quotations; healthy history costs nothing", async () => {
  // Customer 3: ordered every ~30 days for a year, then nothing for 100 days.
  await f.orderHistory(i.customer3, [[100, 1000], [130, 1000], [160, 1000], [190, 1000], [220, 1000], [250, 1000], [280, 1000]]);
  await f.seed("insert into invoices(id,company_id,customer_id,invoice_number,invoice_date,due_date,subtotal,tax_total,grand_total,amount_paid,status) values($1,$2,$3,'INV-8-OD',current_date-120,current_date-75,10000,1800,11800,0,'sent')",
    [f.next(), i.company, i.customer3]);
  for (let n = 0; n < 2; n++) await f.seed("insert into customer_complaints(id,company_id,customer_id,description,logged_by,logged_at,fingerprint) values($5,$1,$2,'Surface lines on last lot',$3,now()-interval '10 days',$4)", [i.company, i.customer3, i.sales, f.next(), f.next()]);
  for (const status of ["customer_rejected", "expired", "customer_rejected", "converted_to_order"]) {
    await f.seed("insert into quotes(id,company_id,quote_number,customer_id,quote_date,valid_until,status) values($1,$2,$3,$4,current_date-30,current_date-1,$5)", [f.next(), i.company, `Q-8-${f.next().slice(-4)}`, i.customer3, status]);
  }
  // Customer 4: a steady monthly customer still ordering.
  await f.orderHistory(i.customer4, [[5, 1000], [35, 1000], [65, 1000], [95, 1000], [125, 1000]]);
  const out = await f.ap("ap_customer_health", "score_now", {}, i.salesManager);
  assert.ok(out.examined >= 2);
  const risk = await f.ap("ap_customer_health", "at_risk", {}, i.sales);
  const c3 = risk.rows.find(r => r.customer_id === i.customer3);
  assert.ok(c3, "customer 3 is at risk");
  assert.equal(c3.band, "at_risk");
  assert.ok(c3.reasons.some(r => /No order for 100 days; usually orders every 30 days/.test(r)), c3.reasons.join(" | "));
  assert.ok(c3.reasons.some(r => /overdue by 75 days/.test(r)));
  assert.ok(c3.reasons.some(r => /2 complaint/.test(r)));
  assert.ok(c3.reasons.some(r => /Won only 1 of 4/.test(r)));
  const detail = await f.ap("ap_customer_health", "customer", { customer_id: i.customer4 }, i.sales);
  assert.equal(detail.latest.components.frequency.points, 0);
  assert.equal(detail.latest.band, "healthy");
  assert.match(detail.latest.components.quotes.explain, /Fewer than three/, "too little history costs no points");
  await f.ap("ap_customer_health", "follow_up", { customer_id: i.customer3, outcome: "called", note: "Purchase head says a project starts in January" }, i.sales);
  assert.equal((await f.ap("ap_customer_health", "at_risk", {}, i.sales)).rows.find(r => r.customer_id === i.customer3).last_follow_up.outcome, "called");
  await assert.rejects(() => f.ap("ap_customer_health", "score_now", {}, i.sales), denied);
  await assert.rejects(() => f.ap("ap_customer_health", "at_risk", {}, i.production), denied);
  assert.equal((await f.ap("ap_customer_health", "at_risk", { band: "all" }, i.foreign)).rows.length, 0);
  // Scoring twice on one day keeps one row per customer per day.
  await f.ap("ap_customer_health", "score_now", {}, i.owner);
  assert.equal((await f.one("select count(*)::int n from customer_health_scores where customer_id=$1", [i.customer3])).n, 1);
});

test("AP-050 Monday tells sales how many customers are at risk, once per week; other days are quiet", async () => {
  await f.orderHistory(i.customer3, [[100, 1000], [130, 1000], [160, 1000], [190, 1000]]);
  await f.seed("insert into invoices(id,company_id,customer_id,invoice_number,invoice_date,due_date,subtotal,tax_total,grand_total,amount_paid,status) values($1,$2,$3,'INV-8-M',current_date-120,current_date-75,10000,1800,11800,0,'sent')", [f.next(), i.company, i.customer3]);
  const day = async offset => (await f.one("select (current_date - (extract(isodow from current_date)::int - 1) + $1::int)::text d", [offset])).d;
  const notices = async () => (await f.one("select count(distinct condition_key)::int n from notifications where notification_type='customer_health'")).n;
  await f.one("select private.ap8_health_run($1, null, $2::date) v", [i.company, await day(2)]);
  assert.equal(await notices(), 0, "Wednesday: scored, nobody told");
  const monday = await f.one("select private.ap8_health_run($1, null, $2::date) v", [i.company, await day(0)]);
  assert.ok(monday.v.alerts > 0, "Monday: sales is told");
  await f.one("select private.ap8_health_run($1, null, $2::date) v", [i.company, await day(0)]);
  assert.equal(await notices(), 1, "once per week");
  const n = await f.one("select title, action_link, recipient_role from notifications where notification_type='customer_health' and recipient_role='sales' limit 1");
  assert.match(n.title, /at risk this week/); assert.equal(n.action_link, "/crm#at-risk");
});

// ---------------------------------------------------------------- AP-052
test("AP-052 charts per characteristic and die with plan limits; outside-limit and run-of-seven alarms raised once; QC review closes the notice", async () => {
  const { plan, items } = await f.plan({ items: [{ characteristic: "Wall thickness", unit: "mm", nominal: 1.4, lower: 1.3, upper: 1.5 }, { characteristic: "Coating thickness", unit: "micron", nominal: 70, lower: 60, upper: 90 }] });
  const j = await f.job({ status: "in_progress" });
  await f.readings({ job: j.job, plan, item: items[0], values: [1.42, 1.43, 1.44, 1.43, 1.45, 1.46, 1.44], endMinutesAgo: 120 });
  const charts = await f.ap("ap_spc", "charts", {}, i.quality);
  assert.equal(charts.active_characteristics, 2, "every active characteristic has a chart");
  const wall = charts.rows.find(c => c.characteristic === "Wall thickness");
  assert.equal(wall.subgroup, `die:${i.die}`);
  assert.equal(wall.subgroup_label, "Die D-2045-A");
  assert.deepEqual([Number(wall.lower_limit), Number(wall.upper_limit), Number(wall.center), wall.count], [1.3, 1.5, 1.4, 7]);
  assert.deepEqual(wall.rules.map(r => r.rule), ["run_of_seven"], "seven readings above the centre: alarm before any reject");
  assert.ok(charts.rows.some(c => c.characteristic === "Coating thickness" && c.count === 0 && c.subgroup === "finish:mill_finish"));
  const run = await f.ap("ap_spc", "check", {}, i.quality);
  assert.equal(run.examined, 1);
  const again = await f.ap("ap_spc", "check", {}, i.quality);
  assert.equal(again.alerts, 0, "an open alarm is not raised twice");
  await f.readings({ job: j.job, plan, item: items[0], values: [1.56] });
  await f.ap("ap_spc", "check", {}, i.quality);
  const open = await f.ap("ap_spc", "alarms", {}, i.productionManager);
  assert.deepEqual(open.rows.map(a => a.rule).sort(), ["outside_limits", "run_of_seven"]);
  assert.equal(open.can_review, false);
  const alarm = open.rows.find(a => a.rule === "outside_limits");
  assert.ok((await f.one("select count(*)::int n from notifications where condition_key=$1 and resolved_at is null", [`spc:${alarm.id}`])).n > 0);
  await assert.rejects(() => f.ap("ap_spc", "review", { id: alarm.id, outcome: "process_adjusted", note: "Adjusted puller speed" }, i.productionManager), denied);
  await f.ap("ap_spc", "review", { id: alarm.id, outcome: "die_sent_for_correction", note: "Bearing worn; die sent for correction" }, i.quality);
  assert.equal((await f.one("select count(*)::int n from notifications where condition_key=$1 and resolved_at is null", [`spc:${alarm.id}`])).n, 0);
  await assert.rejects(() => f.ap("ap_spc", "review", { id: alarm.id, outcome: "no_action_needed", note: "Second review" }, i.quality), /already reviewed/);
  await f.ap("ap_spc", "check", {}, i.quality);
  assert.equal((await f.ap("ap_spc", "alarms", {}, i.quality)).rows.filter(a => a.rule === "outside_limits").length, 0, "a reviewed reading does not raise again");
  const dieCharts = await f.ap("ap_spc", "charts", { die_id: i.die }, i.quality);
  assert.equal(dieCharts.total_count, 1);
  await assert.rejects(() => f.ap("ap_spc", "charts", {}, i.sales), denied);
  assert.equal((await f.ap("ap_spc", "charts", {}, i.foreign)).total_count, 0);
});

// ---------------------------------------------------------------- AP-020
test("AP-020 a certificate draft keeps what was read; confirming checks the spec in the database, records typed fields and fills the batch heat", async () => {
  const r = await f.receiptLine();
  const draft = await f.certificate({ line: r.line, extracted: { heat_number: { value: "H24-5521", confidence: "high", source: "Cast No: H24-5521" }, alloy: { value: "6063", confidence: "high", source: "Alloy: AA6063" },
    si: { value: 0.42, confidence: "medium", source: "Actual" }, fe: { value: 0.18, confidence: "medium", source: "Actual" }, mg: { value: null, confidence: null, source: null } } });
  assert.deepEqual([draft.status, draft.heat_number, draft.alloy, Number(draft.si), draft.mg], ["draft", "H24-5521", "6063", 0.42, null], "unreadable stays blank, never zero");
  assert.equal(draft.live_check.result, "incomplete");
  await assert.rejects(() => f.certificate({ line: r.line, sha: draft.file_sha256 }), /already attached/);
  await assert.rejects(() => f.ap("ap_mtc", "draft", { receipt_line_id: r.line, file_name: "x.pdf", storage_path: `${i.foreignCompany}/x/x.pdf`, mime_type: "application/pdf", file_sha256: "b".repeat(64), source_kind: "pdf_text", extracted: {} }, i.quality), /Upload the certificate again/);
  await assert.rejects(() => f.ap("ap_mtc", "confirm", { id: draft.id, heat_number: "H24-5521", alloy: "6063" }, i.inventory), denied);
  const ok = await f.ap("ap_mtc", "confirm", { id: draft.id, heat_number: "H24-5521", alloy: "6063", si: 0.42, fe: 0.18, cu: 0.01, mn: 0.02, mg: 0.52, zn: 0.01, ti: 0.01 }, i.quality);
  assert.equal(ok.spec_result, "in_spec");
  assert.deepEqual(ok.edited_fields.sort(), ["cu", "mg", "mn", "ti", "zn"], "the fields the person had to type");
  // Releasing the accepted material links the batch; its empty heat number is filled from the certificate.
  const batch = f.next();
  await f.seed("insert into billet_batches(id,company_id,batch_number,alloy,temper,total_weight_kg,available_weight_kg,received_date,status) values($1,$2,'B-8-1','6063','F',1000,1000,current_date,'available')", [batch, i.company]);
  await f.seed("insert into incoming_stock_releases(company_id,receipt_line_id,billet_batch_id,quantity_kg,released_by) values($1,$2,$3,1000,$4)", [i.company, r.line, batch, i.inventory]);
  const coverage = await f.ap("ap_mtc", "coverage", {}, i.quality);
  assert.equal(coverage.traced, coverage.batches, "every billet batch traces to a certificate");
  const again = await f.ap("ap_mtc", "get", { id: draft.id }, i.accounts);
  assert.deepEqual(again.batches.map(b => b.batch_number), ["B-8-1"]);
  await assert.rejects(() => f.ap("ap_mtc", "discard", { id: draft.id, reason: "Wrong file uploaded" }, i.quality), /Only a draft/);
  await assert.rejects(() => f.ap("ap_mtc", "get", { id: draft.id }, i.sales), denied);
  await assert.rejects(() => f.ap("ap_mtc", "get", { id: draft.id }, i.foreign), /not found/);
});

test("AP-020 an out-of-specification certificate routes to quality and the line can only be taken as a concession or rejected", async () => {
  const r = await f.receiptLine();
  const draft = await f.certificate({ line: r.line });
  const bad = await f.ap("ap_mtc", "confirm", { id: draft.id, heat_number: "H-77", alloy: "6063", si: 0.95, fe: 0.18, cu: 0.01, mn: 0.02, mg: 0.52, zn: 0.01, ti: 0.01 }, i.quality);
  assert.equal(bad.spec_result, "out_of_spec");
  assert.deepEqual(bad.spec_check.out.map(o => [o.element, Number(o.value)]), [["Si", 0.95]]);
  assert.ok((await f.one("select count(*)::int n from notifications where condition_key=$1", [`mtc-out-of-spec:${draft.id}`])).n > 0);
  await assert.rejects(() => f.assurance({ action: "incoming.dispose", receipt_line_id: r.line, disposition: "accept", quantity: 1000, evidence: "Visual check of billets", certificate_ref: "MTC-H-77", note: "Accepting against the mill certificate" }, i.quality),
    /out of specification/);
  const conceded = await f.assurance({ action: "incoming.dispose", receipt_line_id: r.line, disposition: "concession", quantity: 1000, evidence: "Silicon high; accepted for 6060-grade orders only", certificate_ref: "MTC-H-77", note: "Concession agreed by the plant head" }, i.factory);
  assert.equal(conceded.state, "confirmed");
  // A newer confirmed certificate replaces the earlier one on the same line.
  const second = await f.certificate({ line: r.line });
  await f.ap("ap_mtc", "confirm", { id: second.id, heat_number: "H-77", alloy: "6063", si: 0.45, fe: 0.18, cu: 0.01, mn: 0.02, mg: 0.52, zn: 0.01, ti: 0.01, note: "Retest certificate from the mill" }, i.quality);
  assert.equal((await f.ap("ap_mtc", "get", { id: draft.id }, i.quality)).status, "superseded");
  const list = await f.ap("ap_mtc", "list", { spec: "in_spec" }, i.quality);
  assert.deepEqual(list.rows.map(x => x.id), [second.id]);
});

test("AP-020 database alloy limits equal the calculations library; supplier templates are kept per supplier", async () => {
  const { standardAlloyCompositions, alloyChemistrySpec } = await import("../lib/calculations/alloy-composition.ts");
  for (const alloy of Object.keys(standardAlloyCompositions)) {
    const sql = (await f.one("select private.ap8_alloy_spec($1) v", [alloy])).v;
    const ts = alloyChemistrySpec(alloy);
    for (const e of Object.keys(sql)) assert.deepEqual(sql[e].map(Number), ts[e], `${alloy} ${e}`);
  }
  assert.equal((await f.one("select private.ap8_alloy_spec('7075') v")).v, null);
  const t = await f.ap("ap_mtc", "save_template", { vendor_id: i.vendor, heat_labels: ["Melt No"], alloy_labels: ["Grade"], element_order: ["Si", "Fe", "Cu", "Mn", "Mg", "Zn", "Ti"], decimal_comma: true }, i.quality);
  assert.deepEqual(t.heat_labels, ["Melt No"]);
  const r = await f.receiptLine();
  assert.deepEqual((await f.ap("ap_mtc", "target", { receipt_line_id: r.line }, i.inventory)).template.element_order, ["Si", "Fe", "Cu", "Mn", "Mg", "Zn", "Ti"]);
  await assert.rejects(() => f.ap("ap_mtc", "save_template", { vendor_id: i.vendor, heat_labels: [], alloy_labels: [], element_order: [], decimal_comma: false }, i.inventory), denied);
});

// ---------------------------------------------------------------- wiring
test("Batch 8 jobs are registered, tables are company-scoped with RLS and no client grants, and gateways pin search_path", async () => {
  const jobs = (await f.db.query("select job_key, schedule from private.ap_job_registry() where job_key in ('crm.customer_health','quality.spc_check','dies.availability') order by 1")).rows;
  assert.deepEqual(jobs, [{ job_key: "crm.customer_health", schedule: "nightly" }, { job_key: "dies.availability", schedule: "hourly" }, { job_key: "quality.spc_check", schedule: "hourly" }]);
  for (const t of ["saved_list_views", "die_availability_windows", "quote_capacity_checks", "customer_health_scores", "customer_health_followups", "spc_alarms", "mtc_templates", "billet_certificates"]) {
    const r = await f.one("select relrowsecurity rls from pg_class where oid=$1::regclass", [`public.${t}`]);
    assert.equal(r.rls, true, `${t} has RLS`);
    const grants = await f.one("select count(*)::int n from information_schema.role_table_grants where table_schema='public' and table_name=$1 and grantee in ('anon','authenticated')", [t]);
    assert.equal(grants.n, 0, `${t} has no client grants`);
    await assert.rejects(() => f.asUser(`select * from ${t}`, [], i.owner), /permission denied/);
  }
  for (const fn of ["ap_views", "ap_die_window", "ap_capacity", "ap_customer_health", "ap_spc", "ap_mtc"]) {
    const p = await f.one("select proconfig, has_function_privilege('anon', oid, 'EXECUTE') anon from pg_proc where proname=$1 and pronamespace='public'::regnamespace", [fn]);
    assert.ok(p.proconfig.some(c => c.startsWith("search_path=")));
    assert.equal(p.anon, false);
  }
  await assert.rejects(() => f.ap("ap_spc", "charts", {}, i.dealer), denied);
  await assert.rejects(() => f.ap("ap_mtc", "list", {}, i.inactive), denied);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createBatch10Fixture, ids as i, istAt, istDay } from "../scripts/lib/autopilot-batch10-fixture.mjs";
import { compareCutPlans, usableLengthPerPush } from "../lib/calculations/cut-combination.ts";
import { planCoatingRuns } from "../lib/workflow/coating-batches.ts";

let f;
test.before(async () => { f = await createBatch10Fixture(); });
test.after(async () => { await f?.close(); });
test.beforeEach(async () => { await f.start(); });
test.afterEach(async () => { await f.rollback(); });
const denied = e => e.code === "42501";
const num = v => (v === null || v === undefined ? v : Number(v));

// ---------------------------------------------------------------- AP-021
test("AP-021 a shift's kWh is shared between the jobs that pressed in it by running time; a missing closing reading leaves energy blank", async () => {
  const press = await f.press({ name: "Press E" }); await f.shifts(press, 1000);
  const a = await f.job({ machine: press, status: "in_progress", plannedIn: 0 }), b = await f.job({ machine: press, status: "in_progress", plannedIn: 0 });
  // Job A: pushes at 07:00, 07:05, 07:10 (then B starts at 07:15); job B: 07:15, 07:20, then a 3-hour stoppage, 10:20.
  await f.pushes({ job: a.job, machine: press, at: [istAt(0, "07:00"), istAt(0, "07:05"), istAt(0, "07:10")], kg: 30 });
  await f.pushes({ job: b.job, machine: press, at: [istAt(0, "07:15"), istAt(0, "07:20"), istAt(0, "10:20")], kg: 30 });
  const opened = await f.ap("ap_energy", "save", { machine_id: press, shift_day: istDay(0), shift_name: "A", opening_kwh: 1000 }, i.production);
  assert.equal(opened.kwh, null);
  let alloc = await f.ap("ap_energy", "allocation", { day: istDay(0) }, i.production);
  assert.deepEqual([alloc.readings[0].kwh, alloc.readings[0].jobs.length], [null, 0], "no closing reading: no energy and no allocation, not zero");
  await assert.rejects(() => f.ap("ap_energy", "save", { machine_id: press, shift_day: istDay(0), shift_name: "A", closing_kwh: 900 }, i.production), /cannot be below the opening/);
  await f.ap("ap_energy", "save", { machine_id: press, shift_day: istDay(0), shift_name: "A", closing_kwh: 1400 }, i.production);
  alloc = await f.ap("ap_energy", "allocation", { day: istDay(0) }, i.accounts);
  const jobs = Object.fromEntries(alloc.readings[0].jobs.map(j => [j.job_id, j]));
  // A: 300+300+300 s = 900 s. B: 300 s + 1200 s (stoppage capped at 20 min) + last push at the shift's mean gap (2400/5 = 480 s) = 1980 s.
  assert.deepEqual([num(jobs[a.job].runtime_min), num(jobs[b.job].runtime_min)], [15, 33]);
  assert.equal(num(jobs[a.job].kwh) + num(jobs[b.job].kwh), 400, "the whole reading is allocated");
  assert.equal(num(jobs[a.job].kwh), 125);
  assert.equal(num(jobs[a.job].kwh_per_kg), Number((125 / 90).toFixed(3)), "kWh per kg uses the billet kilograms pressed");
  const month = await f.ap("ap_energy", "monthly", {}, i.accounts);
  const row = month.presses.find(p => p.machine_id === press);
  assert.deepEqual([row.readings_closed, num(row.kwh), num(row.kwh_per_kg)], [1, 400, Number((400 / 180).toFixed(3))]);
  assert.equal(num((await f.ap("ap_energy", "job", { job_id: a.job }, i.production)).kwh), 125);
  // A closed reading is a record: the operator cannot change it, a manager corrects it and the correction is marked.
  await assert.rejects(() => f.ap("ap_energy", "save", { machine_id: press, shift_day: istDay(0), shift_name: "A", closing_kwh: 1500 }, i.production), /closed/);
  await f.ap("ap_energy", "save", { machine_id: press, shift_day: istDay(0), shift_name: "A", closing_kwh: 1500 }, i.productionManager);
  assert.equal((await f.ap("ap_energy", "list", {}, i.accounts)).rows[0].corrected, true);
  await assert.rejects(() => f.ap("ap_energy", "save", { machine_id: press, shift_day: istDay(0), shift_name: "B", opening_kwh: 5 }, i.accounts), denied, "accounts reads, production writes");
  await assert.rejects(() => f.ap("ap_energy", "shifts", {}, i.sales), denied);
});

test("AP-021 the next shift is offered the previous closing reading, and a press with readings but no pushes shows no kWh per kg", async () => {
  const press = await f.press({ name: "Press F" }); await f.shifts(press, 1000);
  await f.ap("ap_energy", "save", { machine_id: press, shift_day: istDay(0), shift_name: "A", opening_kwh: 200, closing_kwh: 260 }, i.production);
  const shifts = await f.ap("ap_energy", "shifts", { day: istDay(0) }, i.production);
  const next = shifts.rows.find(r => r.machine_id === press && r.shift_name === "B");
  assert.equal(num(next.previous_closing.kwh), 260);
  const month = await f.ap("ap_energy", "monthly", {}, i.accounts);
  const row = month.presses.find(p => p.machine_id === press);
  assert.deepEqual([num(row.kwh), row.kwh_per_kg], [60, null], "no production recorded: kWh known, kWh per kg blank");
  await assert.rejects(() => f.ap("ap_energy", "save", { machine_id: press, shift_day: istDay(1), shift_name: "A", opening_kwh: 1 }, i.production), /last 45 days/);
});

// ---------------------------------------------------------------- AP-022
test("AP-022 a person is on one press at a time; crew per shift and per job comes from the sign-ins", async () => {
  const p1 = await f.press({ name: "Press C1" }), p2 = await f.press({ name: "Press C2" });
  const j = await f.job({ machine: p1, status: "in_progress", plannedIn: 0 });
  const first = await f.ap("ap_crew", "sign_in", { machine_id: p1, crew_role: "operator" }, i.production);
  assert.equal(first.state, "signed_in");
  assert.equal((await f.ap("ap_crew", "sign_in", { machine_id: p1, crew_role: "operator" }, i.production)).state, "already_signed_in", "a second tap does not create a second sign-in");
  await f.ap("ap_crew", "add", { machine_id: p1, user_id: i.backup, crew_role: "helper" }, i.productionManager);
  await assert.rejects(() => f.ap("ap_crew", "add", { machine_id: p1, user_id: i.backup, crew_role: "helper" }, i.production), denied, "only a supervisor adds other people");
  const station = await f.ap("ap_crew", "station", { machine_id: p1 }, i.production);
  assert.deepEqual(station.crew.map(m => [m.name, m.crew_role, m.method]).sort(), [["Fixture backup", "helper", "supervisor"], ["Fixture production", "operator", "self"]]);
  // Pushes now, then the crew of the job and of the day.
  const now = new Date();
  await f.pushes({ job: j.job, machine: p1, at: [new Date(now.getTime() - 60000).toISOString(), now.toISOString()] });
  const crew = await f.ap("ap_crew", "job", { job_id: j.job }, i.quality);
  assert.equal(crew.crew.length, 2);
  const day = await f.ap("ap_crew", "shift", { day: istDay(0) }, i.productionManager);
  assert.match(day.label, /not an attendance or payroll record/);
  assert.ok(day.rows.filter(r => r.machine_id === p1).some(r => r.crew.length === 2 && r.pushes === 2), "crew and output are shown together for the shift");
  // Signing in on another press ends the first assignment.
  await f.ap("ap_crew", "sign_in", { machine_id: p2, crew_role: "puller" }, i.production);
  assert.deepEqual((await f.ap("ap_crew", "station", { machine_id: p1 }, i.production)).crew.map(m => m.name), ["Fixture backup"]);
  assert.equal((await f.db.query("select sign_out_reason from press_crew_sessions where id=$1", [first.id])).rows[0].sign_out_reason, "moved");
  const helperSession = (await f.ap("ap_crew", "station", { machine_id: p1 }, i.production)).crew[0].id;
  await assert.rejects(() => f.ap("ap_crew", "sign_out", { id: helperSession }, i.production), denied, "an operator cannot sign someone else out");
  await f.ap("ap_crew", "sign_out", {}, i.production);
  await assert.rejects(() => f.ap("ap_crew", "sign_out", {}, i.production), /No open press sign-in/);
  await assert.rejects(() => f.ap("ap_crew", "station", { machine_id: p1 }, i.sales), denied);
});

test("AP-022 a forgotten sign-in counts for at most 14 hours and the competency for starting production is flagged", async () => {
  const p1 = await f.press({ name: "Press C3" });
  const s = await f.ap("ap_crew", "sign_in", { machine_id: p1, crew_role: "operator" }, i.production);
  assert.equal(s.competent, null, "no requirement set: no flag");
  await f.seed("update press_crew_sessions set signed_in_at = now() - interval '20 hours' where id=$1", [s.id]);
  assert.equal((await f.ap("ap_crew", "station", { machine_id: p1 }, i.production)).crew.length, 0, "a stale sign-in is not shown as current crew");
  await f.ap("ap_crew", "sign_in", { machine_id: p1, crew_role: "operator" }, i.production);
  const old = (await f.db.query("select sign_out_reason, extract(epoch from signed_out_at - signed_in_at)/3600 h from press_crew_sessions where id=$1", [s.id])).rows[0];
  assert.deepEqual([old.sign_out_reason, Math.round(Number(old.h))], ["auto_shift_end", 14]);
  const competency = f.next();
  await f.seed("insert into competencies(id,company_id,code,name,created_by) values($1,$2,'PRESS-OP','Press operation',$3)", [competency, i.company, i.owner]);
  await f.seed("insert into competency_requirements(company_id,action,competency_id,set_by) values($1,'production_start',$2,$3)", [i.company, competency, i.owner]);
  assert.equal((await f.ap("ap_crew", "station", { machine_id: p1 }, i.production)).crew[0].competent, false);
});

// ---------------------------------------------------------------- AP-049
test("AP-049 an equivalent is approved by someone else, suggested for a short line with its free stock, and consent is recorded before substitution", async () => {
  const other = await f.profile({ code: "OM-2045-B" });
  const o = await f.order({ kg: 285, pieces: 50, length: 6 });
  await f.seed("update production_job_draft_lines set status='removed' where order_id=$1", [o.order]);
  await f.stock({ pieces: 60, profile: other });
  const proposed = await f.ap("ap_equivalents", "propose", { profile_id: i.profile2, equivalent_profile_id: other, basis: "same_section", note: "Same die drawing, export code" }, i.sales);
  let order = await f.ap("ap_equivalents", "order", { order_id: o.order }, i.sales);
  const line = order.lines.find(l => l.order_item_id === o.line);
  assert.ok(line && num(line.short_kg) > 0);
  assert.equal(line.equivalents.length, 0, "an equivalence waiting for approval is not suggested");
  await assert.rejects(() => f.ap("ap_equivalents", "approve", { id: proposed.id }, i.sales), denied, "sales cannot approve");
  await assert.rejects(() => f.ap("ap_equivalents", "propose", { profile_id: other, equivalent_profile_id: i.profile2, basis: "same_section" }, i.quality), /already listed/, "the reverse pair is the same pair");
  await f.ap("ap_equivalents", "approve", { id: proposed.id }, i.quality);
  order = await f.ap("ap_equivalents", "order", { order_id: o.order }, i.sales);
  const offer = order.lines.find(l => l.order_item_id === o.line).equivalents[0];
  assert.deepEqual([offer.profile_code, num(offer.free.pieces)], ["OM-2045-B", 60]);
  assert.equal((await f.ap("ap_equivalents", "shortages", {}, i.salesManager)).rows.some(r => r.order_item_id === o.line), true);
  await assert.rejects(() => f.ap("ap_equivalents", "consent", { order_item_id: o.line, equivalence_id: offer.equivalence_id, consent_by_name: "Ramesh", consent_channel: "whatsapp", consented_on: istDay(1) }, i.sales), /future/);
  await assert.rejects(() => f.ap("ap_equivalents", "consent", { order_item_id: o.line, equivalence_id: offer.equivalence_id, consent_by_name: "Ramesh", consent_channel: "whatsapp", consented_on: istDay(0) }, i.quality), denied, "consent is recorded by sales");
  const before = (await f.db.query("select profile_id from order_items where id=$1", [o.line])).rows[0].profile_id;
  const consent = await f.ap("ap_equivalents", "consent", { order_item_id: o.line, equivalence_id: offer.equivalence_id, consent_by_name: "Ramesh Sharma", consent_channel: "whatsapp", consent_reference: "WA 15 Nov", consented_on: istDay(0) }, i.sales);
  assert.equal((await f.db.query("select profile_id from order_items where id=$1", [o.line])).rows[0].profile_id, before, "recording consent never changes the order line");
  await assert.rejects(() => f.ap("ap_equivalents", "consent", { order_item_id: o.line, equivalence_id: offer.equivalence_id, consent_by_name: "Again", consent_channel: "phone", consented_on: istDay(0) }, i.sales), /already recorded/);
  await f.ap("ap_equivalents", "withdraw_consent", { id: consent.id, reason: "Customer changed their mind" }, i.sales);
  await f.ap("ap_equivalents", "retire", { id: proposed.id, reason: "Section revised" }, i.quality);
  assert.equal((await f.ap("ap_equivalents", "order", { order_id: o.order }, i.sales)).lines.find(l => l.order_item_id === o.line).equivalents.length, 0);
});

test("AP-049 a customer-approved alternative is offered only to that customer, and the proposer cannot approve their own proposal", async () => {
  const other = await f.profile({ code: "OM-ALT-1", name: "Customer alternative" });
  await f.stock({ pieces: 40, profile: other });
  await assert.rejects(() => f.ap("ap_equivalents", "propose", { profile_id: i.profile2, equivalent_profile_id: other, basis: "customer_approved" }, i.quality), /names the customer/);
  const p = await f.ap("ap_equivalents", "propose", { profile_id: i.profile2, equivalent_profile_id: other, basis: "customer_approved", customer_id: i.customer3 }, i.quality);
  await assert.rejects(() => f.ap("ap_equivalents", "approve", { id: p.id }, i.quality), /someone other than the person who proposed/);
  await f.ap("ap_equivalents", "approve", { id: p.id }, i.productionManager);
  const o = await f.order({ kg: 285, pieces: 50, length: 6 });   // an order of customer2
  await f.seed("update production_job_draft_lines set status='removed' where order_id=$1", [o.order]);
  assert.equal((await f.ap("ap_equivalents", "order", { order_id: o.order }, i.sales)).lines.find(l => l.order_item_id === o.line).equivalents.length, 0, "another customer's alternative is not offered");
  await assert.rejects(() => f.ap("ap_equivalents", "consent", { order_item_id: o.line, equivalence_id: p.id, consent_by_name: "Someone", consent_channel: "phone", consented_on: istDay(0) }, i.sales), /different customer/);
});

// ---------------------------------------------------------------- AP-068
test("AP-068 idle capacity suggests a run for a fast mover below target, within billets and the holding limit; approval hands the planner a task", async () => {
  const press = await f.press({ name: "Press S" }); await f.shifts(press, 1000);
  await f.order({ kg: 900 });
  await f.billets({ kg: 1000 });
  await assert.rejects(() => f.ap("ap_stock_runs", "save_target", { profile_id: i.profile2, piece_length_m: 6, target_kg: 2000 }, i.salesManager), denied, "sales reads; the planner or owner sets targets");
  await assert.rejects(() => f.ap("ap_stock_runs", "save_target", { profile_id: i.profile2, piece_length_m: 6, target_kg: 2000, max_kg: 1500 }, i.productionManager), /holding limit/);
  await f.ap("ap_stock_runs", "save_target", { profile_id: i.profile2, piece_length_m: 6, target_kg: 2000, max_kg: 2500 }, i.productionManager);
  const idle = await f.ap("ap_stock_runs", "idle", {}, i.salesManager);
  assert.ok(num(idle.free_kg) > 0 && num(idle.idle_hours) > 0, "idle hours are reported");
  const run = await f.ap("ap_stock_runs", "suggest", {}, i.productionManager);
  assert.equal(run.proposals, 1);
  assert.equal((await f.ap("ap_stock_runs", "suggest", {}, i.productionManager)).proposals, 0, "running it again does not suggest twice");
  const s = (await f.ap("ap_stock_runs", "list", {}, i.salesManager)).rows[0];
  // 1,000 kg of billets at the default 80% recovery limit the run to 800 kg, below the 2,000 kg target.
  assert.deepEqual([num(s.suggested_kg), s.basis.limited_by, num(s.basis.stock_kg)], [800, "billets", 0]);
  await assert.rejects(() => f.ap("ap_stock_runs", "approve", { id: s.id }, i.salesManager), denied);
  const jobsBefore = (await f.db.query("select count(*) n from production_jobs")).rows[0].n;
  const approved = await f.ap("ap_stock_runs", "approve", { id: s.id }, i.owner);
  assert.equal((await f.db.query("select count(*) n from production_jobs")).rows[0].n, jobsBefore, "approval does not create a job");
  const task = (await f.db.query("select title, assigned_to from tasks where id=$1", [approved.task_id])).rows[0];
  assert.match(task.title, /Plan make-to-stock run: OM-2045 800 kg/);
  await assert.rejects(() => f.ap("ap_stock_runs", "approve", { id: s.id }, i.owner), /no longer open/);
  assert.equal((await f.ap("ap_stock_runs", "suggest", {}, i.productionManager)).proposals, 0, "an approved run counts against the target until it is made");
});

test("AP-068 nothing is suggested without demand, above the target, or without free capacity; the nightly job is registered", async () => {
  const press = await f.press({ name: "Press T" });
  await f.billets({ kg: 5000 });
  await f.ap("ap_stock_runs", "save_target", { profile_id: i.profile2, piece_length_m: 6, target_kg: 500 }, i.owner);
  await f.order({ kg: 900 });
  assert.equal((await f.ap("ap_stock_runs", "suggest", {}, i.owner)).proposals, 0, "no shift capacity configured: no free capacity, no suggestion");
  assert.equal((await f.ap("ap_stock_runs", "idle", {}, i.owner)).configured, false);
  await f.shifts(press, 1000);
  await f.stock({ pieces: 100, length: 6 });   // 570 kg free, above the 500 kg target
  assert.equal((await f.ap("ap_stock_runs", "suggest", {}, i.owner)).proposals, 0, "stock already above the target");
  const run = await f.ap("ap_jobs", "run_now", { job_key: "stock.make_to_stock" }, i.owner);
  assert.equal(run.state, "succeeded");
  const registry = (await f.db.query("select schedule from private.ap_job_registry() where job_key='stock.make_to_stock'")).rows[0];
  assert.equal(registry.schedule, "nightly");
});

// ---------------------------------------------------------------- AP-055
test("AP-055 the confirmed run order groups by shade, counts colour changes against due-date order, and late jobs need a reason", async () => {
  const a = await f.coatingJob({ shade: "RAL 9010", kg: 400, due: 2 }), b = await f.coatingJob({ shade: "RAL 7016", kg: 400, due: 3 }), c = await f.coatingJob({ shade: "ral  9010", kg: 400, due: 4 });
  await f.coatingJob({ shade: "RAL 9010", kg: 100, due: 3, vendor: i.vendor });   // at a vendor: not on the in-house line
  await f.ap("ap_coating", "save_settings", { capacity_kg_per_hour: 100, changeover_minutes: 60, day_start: "08:00", hours_per_day: 8 }, i.productionManager);
  await f.ap("ap_coating", "set_brand", { finishing_job_id: a.finishing, powder_brand: "Asian" }, i.production);
  await f.ap("ap_coating", "set_brand", { finishing_job_id: c.finishing, powder_brand: "ASIAN" }, i.production);
  const q = await f.ap("ap_coating", "queue", {}, i.production);
  assert.equal(q.rows.length, 3, "vendor jobs stay out unless the plant includes them");
  assert.equal(q.rows.find(r => r.id === c.finishing).shade_key, "RAL 9010", "shade spelling is normalised for grouping");
  const plan = planCoatingRuns(q.rows.map(r => ({ ...r, kg: num(r.kg) })), { runDay: q.working_days[0], settings: { capacity_kg_per_hour: 100, changeover_minutes: 60, day_start: "08:00", hours_per_day: 8 }, workingDays: q.working_days });
  assert.deepEqual([plan.groups.length, plan.shade_changes, plan.baseline_changes], [2, 1, 2], "two runs and one colour change instead of two");
  const payload = (over = {}) => ({ run_day: q.working_days[0], fingerprint: q.fingerprint, shade_changes: plan.shade_changes, baseline_changes: plan.baseline_changes, total_kg: plan.total_kg,
    groups: plan.groups.map((g, n) => ({ seq: n + 1, key: g.key, shade_key: g.shade_key, shade: g.shade, brand: g.brand, job_ids: g.job_ids, kg: g.kg })), breaches: [], ...over });
  await assert.rejects(() => f.ap("ap_coating", "confirm", payload(), i.production), denied, "the supervisor confirms");
  await assert.rejects(() => f.ap("ap_coating", "confirm", payload({ breaches: [{ job_id: b.finishing, due: istDay(3), finish_day: istDay(5), days_late: 2 }] }), i.productionManager), /Give the reason/);
  const mixed = payload(); mixed.groups = [{ ...mixed.groups[0], job_ids: [...mixed.groups[0].job_ids, ...mixed.groups[1].job_ids] }]; mixed.shade_changes = 0;
  await assert.rejects(() => f.ap("ap_coating", "confirm", mixed, i.productionManager), /mixes shades/);
  const confirmed = await f.ap("ap_coating", "confirm", payload({ breaches: [{ job_id: b.finishing, due: istDay(3), finish_day: istDay(5), days_late: 2 }], breach_note: "Customer agreed to Friday" }), i.productionManager);
  assert.deepEqual([confirmed.shade_changes, confirmed.baseline_changes, confirmed.jobs], [1, 2, 3]);
  assert.equal((await f.db.query("select status from finishing_jobs where id=$1", [a.finishing])).rows[0].status, "planned", "confirming the order does not move a finishing job");
  // The queue changes: the old fingerprint is refused and the confirmed order is marked stale.
  await f.coatingJob({ shade: "RAL 3020", kg: 50, due: 1 });
  await assert.rejects(() => f.ap("ap_coating", "confirm", payload(), i.productionManager), /queue changed/);
  assert.equal((await f.ap("ap_coating", "queue", {}, i.production)).confirmed.stale, true);
  assert.equal(num((await f.ap("ap_coating", "runs", {}, i.quality)).saved_changes_30d), 1);
});

// ---------------------------------------------------------------- AP-067
test("AP-067 a combined pattern gives every job exactly its pieces in fewer pushes; changed jobs make it stale", async () => {
  const press = await f.press({ name: "Press K" }); await f.pressSettings(press);
  await f.seed("update aluminium_profiles set billet_diameter_mm=178 where id=$1", [i.profile2]);
  const a = await f.job({ machine: press, plannedIn: 1 }), b = await f.job({ machine: press, plannedIn: 2 });
  await f.seed("update production_jobs set length_per_piece_m=6, pieces=40 where id=$1", [a.job]);
  await f.seed("update production_jobs set length_per_piece_m=3.2, pieces=40 where id=$1", [b.job]);
  const cands = await f.ap("ap_cut_combine", "candidates", {}, i.productionManager);
  assert.ok(cands.rows.some(r => r.die_id === i.die && r.jobs >= 2));
  const inputs = await f.ap("ap_cut_combine", "inputs", { die_id: i.die, job_ids: [a.job, b.job] }, i.productionManager);
  assert.equal(inputs.machine_id, press, "the press both jobs are planned on");
  const usable = usableLengthPerPush({ billet_mm: 700, billet_diameter_mm: num(inputs.billet_diameter_mm), butt_mm: num(inputs.press.butt_mm), kg_per_m: num(inputs.kg_per_m), runout_m: num(inputs.press.runout_m), front_crop_m: 0.5, back_crop_m: 0.5 });
  assert.equal(usable, 44, "45 m run-out less the two crops");
  const cmp = compareCutPlans(inputs.jobs.map(j => ({ job_id: j.job_id, length_m: num(j.cut_length_m), pieces: num(j.pieces) })), usable, 5);
  assert.ok(cmp.ok && cmp.improves && cmp.combined.pushes < cmp.separate.pushes);
  const record = (over = {}) => ({ die_id: i.die, machine_id: press, job_ids: [a.job, b.job], fingerprint: inputs.fingerprint, usable_m: usable, kerf_mm: 5, billet_mm: 700, patterns: cmp.combined.patterns,
    separate_pushes: cmp.separate.pushes, combined_pushes: cmp.combined.pushes, separate_recovery: cmp.separate.recovery_percent, combined_recovery: cmp.combined.recovery_percent, ...over });
  await assert.rejects(() => f.ap("ap_cut_combine", "record", record(), i.production), denied, "planning prepares patterns");
  // A pattern that changes an order quantity or length is refused by the database.
  const short = JSON.parse(JSON.stringify(cmp.combined.patterns)); short[0].cuts[0].pieces -= 1;
  await assert.rejects(() => f.ap("ap_cut_combine", "record", record({ patterns: short }), i.productionManager), /Order quantities are never changed/);
  const longer = JSON.parse(JSON.stringify(cmp.combined.patterns)); longer[0].cuts[0].length_m += 0.1;
  await assert.rejects(() => f.ap("ap_cut_combine", "record", record({ patterns: longer }), i.productionManager), /Order lengths are never changed/);
  const row = await f.ap("ap_cut_combine", "record", record(), i.productionManager);
  assert.deepEqual([row.status, row.combined_pushes, row.stale], ["proposed", cmp.combined.pushes, false]);
  assert.ok(num(row.combined_recovery) > num(row.separate_recovery), "combined jobs show higher planned recovery than separate ones");
  const jobsBefore = (await f.db.query("select pieces, length_per_piece_m from production_jobs where id=$1", [a.job])).rows[0];
  const accepted = await f.ap("ap_cut_combine", "accept", { id: row.id }, i.productionManager);
  assert.equal(accepted.status, "accepted");
  assert.deepEqual((await f.db.query("select pieces, length_per_piece_m from production_jobs where id=$1", [a.job])).rows[0], jobsBefore, "accepting changes no job");
  assert.equal((await f.ap("ap_cut_combine", "job", { job_id: b.job }, i.production)).combination.id, row.id);
  // A job's pieces change after acceptance: the pattern is shown as stale.
  await f.seed("update production_jobs set pieces=44 where id=$1", [b.job]);
  assert.equal((await f.ap("ap_cut_combine", "get", { id: row.id }, i.production)).stale, true);
  await assert.rejects(() => f.ap("ap_cut_combine", "record", record(), i.productionManager), /changed since this pattern was prepared/);
});

test("AP-067 a job that started pressing cannot be combined, and combining that saves no push is refused", async () => {
  const press = await f.press({ name: "Press L" }); await f.pressSettings(press);
  const a = await f.job({ machine: press, plannedIn: 1 }), b = await f.job({ machine: press, plannedIn: 1 });
  const inputs = await f.ap("ap_cut_combine", "inputs", { die_id: i.die, job_ids: [a.job, b.job] }, i.productionManager);
  const one = [{ pushes: 15, cuts: [{ job_id: a.job, length_m: 6, pieces: 7 }] }, { pushes: 15, cuts: [{ job_id: b.job, length_m: 6, pieces: 7 }] }];
  await assert.rejects(() => f.ap("ap_cut_combine", "record", { die_id: i.die, machine_id: press, job_ids: [a.job, b.job], fingerprint: inputs.fingerprint, usable_m: 44, kerf_mm: 5, patterns: one,
    separate_pushes: 30, combined_pushes: 30, separate_recovery: 90, combined_recovery: 90 }, i.productionManager), /gives job .* 105 pieces against 100/);
  await f.pushes({ job: a.job, machine: press, at: [new Date().toISOString()] });
  const after = await f.ap("ap_cut_combine", "inputs", { die_id: i.die, job_ids: [a.job, b.job] }, i.productionManager);
  assert.equal(after.jobs.length, 1, "a job with pushes is no longer offered");
});

// ---------------------------------------------------------------- AP-070
test("AP-070 ordering from a configurator project is off until the owner turns it on; the saved order is linked once to the project", async () => {
  const cfg = await f.configuration({ cuts: [[i.profile2, 1750, 4], [i.profile2, 1450, 4], [null, 900, 2, "UNLINKED"]] });
  await f.stock({ pieces: 2, length: 6 });
  assert.equal((await f.ap("ap_systems_order", "settings", {}, i.sales)).enabled, false);
  assert.match((await f.ap("ap_systems_order", "status", { configuration_id: cfg }, i.sales)).blocked, /Turned off/);
  await assert.rejects(() => f.ap("ap_systems_order", "draft", { configuration_id: cfg }, i.sales), /turned off until the owner confirms/);
  await assert.rejects(() => f.ap("ap_systems_order", "save_settings", { enabled: true }, i.salesManager), denied, "only the owner or an admin decides");
  await f.ap("ap_systems_order", "save_settings", { enabled: true, note: "Omalco supplies sliding systems" }, i.owner);
  const draft = await f.ap("ap_systems_order", "draft", { configuration_id: cfg }, i.sales);
  assert.equal(draft.cuts.length, 3);
  assert.equal(num(draft.profiles[i.profile2].free.pieces), 2, "free stock is shown for each profile");
  assert.equal(draft.hardware[0].item_code, "H-101");
  assert.ok(!JSON.stringify(draft).match(/internal_cost|margin|calculated_price/), "no cost or margin in the order draft");
  // The order saved through the normal order entry is linked; a different customer's order or a second link is refused.
  const other = await f.order({ customer: i.customer3 });
  await assert.rejects(() => f.ap("ap_systems_order", "link", { configuration_id: cfg, order_id: other.order, lines: [] }, i.sales), /different customer/);
  const o = await f.order({ customer: i.customer2 });
  const linked = await f.ap("ap_systems_order", "link", { configuration_id: cfg, order_id: o.order, lines: [{ profile_code: "OM-2045", stock_length_m: 6, pieces: 3, free_pieces: 2 }] }, i.sales);
  assert.equal(linked.configuration_updated, true);
  assert.deepEqual((await f.db.query("select status, order_id from system_configurations where id=$1", [cfg])).rows[0], { status: "converted_to_order", order_id: o.order });
  await assert.rejects(() => f.ap("ap_systems_order", "link", { configuration_id: cfg, order_id: o.order, lines: [] }, i.sales), /already/);
  assert.match((await f.ap("ap_systems_order", "status", { configuration_id: cfg }, i.sales)).blocked, /already has an order/);
  await assert.rejects(() => f.ap("ap_systems_order", "status", { configuration_id: cfg }, i.production), denied);
});

// ---------------------------------------------------------------- AP-093
test("AP-093 only registered low-risk kinds are recorded, and a notification is marked unread only by its own reader within two minutes", async () => {
  await f.ap("ap_undo", "record", { kind: "task.status", target: i.task }, i.sales);
  await assert.rejects(() => f.ap("ap_undo", "record", { kind: "payment.post", target: "x" }, i.accounts), /cannot be undone/);
  const mine = f.next(), old = f.next();
  await f.seed("insert into notifications(id,company_id,recipient_user_id,title,is_read,read_at) values($1,$2,$3,'Mine',true,now()),($4,$2,$3,'Old',true,now()-interval '10 minutes')", [mine, i.company, i.sales, old]);
  await assert.rejects(() => f.ap("ap_undo", "notification_unread", { id: mine }, i.salesManager), /can no longer be marked unread/, "someone else's notification");
  await assert.rejects(() => f.ap("ap_undo", "notification_unread", { id: old }, i.sales), /can no longer be marked unread/, "read too long ago");
  await f.ap("ap_undo", "notification_unread", { id: mine }, i.sales);
  assert.deepEqual((await f.db.query("select is_read, read_at from notifications where id=$1", [mine])).rows[0], { is_read: false, read_at: null });
  const summary = await f.ap("ap_undo", "summary", {}, i.owner);
  assert.deepEqual(summary.kinds.map(k => [k.kind, Number(k.count)]).sort(), [["notification.read", 1], ["task.status", 1]]);
  await assert.rejects(() => f.ap("ap_undo", "summary", {}, i.sales), denied);
});

// ---------------------------------------------------------------- wiring, RLS and grants
test("batch 10 tables have row security with a company policy and no client grants; gateways refuse dealers and anonymous callers", async () => {
  const tables = ["press_meter_readings", "press_crew_sessions", "profile_equivalents", "profile_substitution_consents", "stock_targets", "stock_run_suggestions", "coating_line_settings",
    "finishing_job_powder", "coating_runs", "cut_combinations", "systems_order_settings", "system_order_links", "undo_events"];
  for (const t of tables) {
    const rls = (await f.db.query("select relrowsecurity from pg_class where oid=('public.'||$1)::regclass", [t])).rows[0].relrowsecurity;
    assert.equal(rls, true, `${t} has row security`);
    const policies = (await f.db.query("select count(*) n from pg_policies where schemaname='public' and tablename=$1 and cmd='SELECT'", [t])).rows[0].n;
    assert.equal(Number(policies), 1, `${t} has one read policy`);
    const grants = (await f.db.query("select count(*) n from information_schema.role_table_grants where table_schema='public' and table_name=$1 and grantee in ('anon','authenticated','PUBLIC')", [t])).rows[0].n;
    assert.equal(Number(grants), 0, `${t} is written and read through its gateway only`);
    assert.ok((await f.db.query("select 1 from information_schema.columns where table_schema='public' and table_name=$1 and column_name='company_id'", [t])).rows.length, `${t} has company_id`);
  }
  for (const fn of ["ap_energy", "ap_crew", "ap_equivalents", "ap_stock_runs", "ap_coating", "ap_cut_combine", "ap_systems_order", "ap_undo"]) {
    const acl = (await f.db.query("select has_function_privilege('anon', ('public.'||$1||'(text,jsonb)')::regprocedure, 'execute') a, has_function_privilege('authenticated', ('public.'||$1||'(text,jsonb)')::regprocedure, 'execute') b", [fn])).rows[0];
    assert.deepEqual([acl.a, acl.b], [false, true], `${fn} is for signed-in staff only`);
  }
  await assert.rejects(() => f.ap("ap_energy", "shifts", {}, i.dealer), e => e.code === "42501" || /not permitted|Not permitted/i.test(e.message));
  await assert.rejects(() => f.ap("ap_undo", "record", { kind: "task.status", target: "x" }, i.inactive), e => e.code === "42501" || /not/i.test(e.message));
  // A company-scoped read: another company's user sees nothing of ours.
  const press = await f.press({ name: "Press Z" });
  await f.ap("ap_energy", "save", { machine_id: press, shift_day: istDay(0), shift_name: "Day", opening_kwh: 10 }, i.production);
  await assert.rejects(() => f.ap("ap_energy", "save", { machine_id: press, shift_day: istDay(0), shift_name: "Day", closing_kwh: 20 }, i.foreign), e => /Press not found|not/i.test(e.message));
});

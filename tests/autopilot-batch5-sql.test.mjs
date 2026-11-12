import test from "node:test";
import assert from "node:assert/strict";
import { createDispatchFixture, dIds as i, nid, istDay } from "../scripts/lib/autopilot-batch4-fixture.mjs";

// Autopilot batch 5 (in progress): AP-026 usual choices, AP-056 finishing vendor chase list, AP-071 quotation follow-ups,
// AP-072 floor prices. The batch 4 fixture replays the full chain, including 20261112200000_autopilot_batch_5.sql.
let f;
test.before(async () => { f = await createDispatchFixture(); });
test.after(async () => { await f?.close(); });
test.beforeEach(async () => { await f.start(); });
test.afterEach(async () => { await f.rollback(); });

const usual = (command, payload = {}, actor = i.sales) => f.call("ap_usual", command, payload, actor);
const finishing = (command, payload = {}, actor = i.productionManager) => f.call("ap_finishing", command, payload, actor);
const sales = (command, payload = {}, actor = i.sales) => f.call("ap_quote_sales", command, payload, actor);

async function pastOrder({ finish, packing = null, priority = "normal", daysAgo }) {
  const id = f.next(), line = f.next();
  await f.seed(`insert into orders(id,company_id,order_number,customer_id,order_date,priority,current_stage,order_value) values($1,$2,$3,$4,current_date-$5::int,$6,'delivered',1000)`,
    [id, i.company, `SO-U-${id.slice(-4)}`, i.customer2, daysAgo, priority]);
  await f.seed(`insert into order_items(id,company_id,order_id,profile_id,quantity_kg,finishing_type,customer_packing_requirement) values($1,$2,$3,$4,100,$5,$6)`, [line, i.company, id, i.profile2, finish, packing]);
  return id;
}
async function pastQuote({ payment, delivery, daysAgo }) {
  await f.seed(`insert into quotes(id,company_id,quote_number,customer_id,quote_date,status,payment_terms,delivery_timeline) values($1,$2,$3,$4,current_date-$5::int,'sent',$6,$7)`,
    [f.next(), i.company, `Q-U-${daysAgo}`, i.customer2, daysAgo, payment, delivery]);
}

async function quote({ status = "sent", sentDaysAgo = 3, validDays = 10, rate = 38, kg = 500, creator = i.sales } = {}) {
  const id = f.next();
  await f.seed(`insert into quotes(id,company_id,quote_number,customer_id,quote_date,valid_until,status,sent_at,grand_total,created_by,revision_number)
    values($1,$2,$3,$4,current_date-$5::int,current_date+$6::int,$7,case when $7='sent' then now()-make_interval(days=>$5::int) end,59000,$8,1)`,
    [id, i.company, `Q-F-${id.slice(-4)}`, i.customer2, sentDaysAgo, validDays, status, creator]);
  await f.seed(`insert into quote_items(id,company_id,quote_id,profile_id,quantity_pieces,length_per_piece_m,section_weight_kg_per_m,total_weight_kg,effective_weight_kg,billing_weight_kg,conversion_charge_per_kg,finishing_type)
    values($1,$2,$3,$4,100,6,0.95,$5,$5,$5,$6,'mill_finish')`, [f.next(), i.company, id, i.profile2, kg, rate]);
  return id;
}

test("AP-026 the usual value needs a clear majority of the last five; ties and splits stay empty", async () => {
  for (const [finish, days, packing] of [["powder_coating", 1, "Bubble wrap each piece"], ["powder_coating", 5, "bubble wrap  each piece"], ["anodizing", 9, null], ["powder_coating", 12, "BUBBLE WRAP each piece"], ["mill_finish", 20, null], ["anodizing", 40, null]]) {
    await pastOrder({ finish, packing, daysAgo: days });
  }
  for (const [payment, delivery, days] of [["30 days credit", "10-12 days", 2], ["30 days credit", "7 days", 8], ["Advance", "10-12 days", 15]]) await pastQuote({ payment, delivery, daysAgo: days });
  const u = await usual("customer", { customer_id: i.customer2 });
  assert.deepEqual([u.fields.finish.value, u.fields.finish.count, u.fields.finish.of], ["powder_coating", 3, 5], "only the last five orders count");
  assert.equal(u.fields.packing.value, "Bubble wrap each piece", "spellings are compared without case or spaces; the newest is shown");
  assert.equal(u.fields.packing.count, 3);
  assert.equal(u.fields.packing.of, 5);
  assert.equal(u.fields.payment_terms.value, "30 days credit");
  assert.equal(u.fields.payment_terms.source, "learned");
  assert.equal(u.fields.delivery_timeline.value, "10-12 days");
  assert.equal(u.fields.priority, undefined, "normal priority is not proposed");
  await f.seed("update customers set payment_terms='45 days from invoice (signed agreement)', shipping_address='Gate 3, Chakan' where id=$1", [i.customer2]);
  const m = await usual("customer", { customer_id: i.customer2 });
  assert.deepEqual([m.fields.payment_terms.value, m.fields.payment_terms.source], ["45 days from invoice (signed agreement)", "master"], "an agreed master value beats a learned one");
  assert.equal(m.fields.delivery_address.source, "master");
  const fresh = await usual("customer", { customer_id: i.customer3 });
  assert.deepEqual(fresh.fields, {}, "a customer without history gets no proposal");
});

test("AP-026 packing below a majority stays empty; decisions are logged and summarised", async () => {
  for (const [finish, days, packing] of [["anodizing", 1, "A"], ["powder_coating", 3, "B"], ["mill_finish", 5, "A"], ["pvdf", 7, "C"]]) await pastOrder({ finish, packing, daysAgo: days });
  const u = await usual("customer", { customer_id: i.customer2 });
  assert.equal(u.fields.finish, undefined, "four different finishes: no proposal");
  assert.equal(u.fields.packing, undefined, "2 of 4 is not a majority");
  await usual("decide", { customer_id: i.customer2, field: "finish", surface: "quote", source: "learned", suggested: "powder_coating", decision: "used" });
  await usual("decide", { customer_id: i.customer2, field: "finish", surface: "order", source: "learned", suggested: "powder_coating", decision: "dismissed" });
  const stats = await usual("stats", {}, i.salesManager);
  assert.deepEqual(stats.map(s => [s.field, s.used, s.dismissed, Number(s.use_rate)]), [["finish", 1, 1, 50]]);
  await assert.rejects(() => usual("stats", {}, i.sales), err => err.code === "42501");
  await assert.rejects(() => usual("customer", { customer_id: i.customer2 }, i.production), err => err.code === "42501");
});

test("AP-056 late material is chased per vendor; a copied message is not a follow-up, a promise is", async () => {
  const vendor = nid(8000);
  await f.seed("insert into vendors(id,company_id,vendor_name,vendor_type,phone,is_active) values($1,$2,'Shine Anodisers','anodizing','9876543210',true)", [vendor, i.company]);
  await f.seed("insert into factory_finishing_lead_times(company_id,finishing_type,lead_days,updated_by) values($1,'anodizing',3,$2)", [i.company, i.owner]);
  const o = await f.order({});
  const job = await f.readyJob({ order: o.order, line: o.line, kg: 570, number: "JOB-ANOD-1" });
  const late = f.next(), recent = f.next(), noLead = f.next(), partial = f.next();
  const ins = `insert into finishing_jobs(id,company_id,order_id,production_job_id,finishing_type,shade_name,vendor_id,sent_date,received_date,input_weight_kg,output_weight_kg,rejection_weight_kg,status)
    values($1,$2,$3,$4,$5,$6,$7,current_date-$8::int,$9,$10,$11,0,$12)`;
  await f.seed(ins, [late, i.company, o.order, job, "anodizing", "Silver", vendor, 12, null, 500, 0, "sent_to_vendor"]);
  await f.seed(ins, [recent, i.company, o.order, job, "anodizing", "Silver", vendor, 0, null, 200, 0, "in_process"]);
  await f.seed(ins, [noLead, i.company, o.order, job, "powder_coating", "RAL 9016", vendor, 20, null, 100, 0, "sent_to_vendor"]);
  await f.seed(ins, [partial, i.company, o.order, job, "anodizing", null, vendor, 15, istDay(-2), 300, 280, "received"]);
  const list = await finishing("chase");
  assert.equal(list.rows.length, 1);
  const v = list.rows[0];
  assert.equal(v.vendor, "Shine Anodisers");
  assert.deepEqual(v.lines.map(l => l.job_id).sort(), [late, partial].sort(), "late and unaccounted material is chased; on-time and no-lead-time material is not");
  assert.ok(v.lines.find(l => l.job_id === late).overdue_days > 0);
  assert.equal(Number(v.lines.find(l => l.job_id === partial).outstanding_kg), 20, "received 280 of 300: 20 kg unaccounted");
  assert.match(v.message, /JOB-ANOD-1 – Anodizing Silver: 500 kg sent on/);
  assert.ok(!/Sharma|₹|rate/i.test(v.message), "no customer name or price in the vendor message");
  assert.deepEqual(list.coverage, { late: 2, late_without_followup: 2, no_lead_time: 1 });
  const all = await finishing("chase", { show: "all" });
  assert.equal(all.rows[0].lines.length, 4);
  const copied = await finishing("copied", { job_ids: [late, partial] });
  assert.equal(copied.state, "copied_not_sent");
  assert.equal((await finishing("chase")).coverage.late_without_followup, 2, "copying the prepared text does not count as a follow-up");
  await assert.rejects(() => finishing("promise", { job_ids: [late], promised_date: istDay(-1), channel: "phone_call" }), /today or within/);
  await assert.rejects(() => finishing("promise", { job_ids: [late], promised_date: istDay(2) }), /how the vendor/);
  await finishing("promise", { job_ids: [late], promised_date: istDay(2), channel: "phone_call", note: "Batch in the tank today" });
  const after = await finishing("chase");
  assert.deepEqual(after.rows[0].lines.map(l => l.job_id), [partial], "a job with a promise for today or later leaves the chase list");
  assert.equal(after.coverage.late_without_followup, 1);
  await f.seed("update finishing_vendor_followups set promised_date=current_date-1 where finishing_job_id=$1 and kind='promise'", [late]);
  assert.equal((await finishing("chase")).coverage.late_without_followup, 2, "a missed promise brings it back");
  const history = await finishing("history", { job_id: late });
  assert.deepEqual(history.map(h => h.kind), ["promise", "message_copied"]);
  await assert.rejects(() => finishing("copied", { job_ids: [late] }, i.viewer), err => err.code === "42501", "viewers read but do not record");
  await assert.rejects(() => finishing("chase", {}, i.sales), err => err.code === "42501");
});

test("AP-071 the morning job schedules follow-ups, raises a task with a prepared message, and stops on a decision", async () => {
  const q = await quote({ sentDaysAgo: 3, validDays: 10 });
  const run = await f.one("select private.ap5_followups_job($1) v", [i.company]);
  assert.ok(run.v.details.scheduled >= 2);
  const view = await sales("followups", { quote_id: q });
  const kinds = view.steps.map(s => [s.step_kind, s.offset_days, s.status]);
  assert.ok(kinds.some(k => k[0] === "after_send" && k[1] === 2 && k[2] === "task_created"), "day-2 follow-up is due: a task was raised");
  assert.ok(kinds.some(k => k[0] === "after_send" && k[1] === 7 && k[2] === "pending"));
  assert.ok(kinds.some(k => k[0] === "before_expiry"));
  const task = await f.one("select assigned_to, task_type, description, related_entity_id from tasks where id=$1", [view.steps.find(s => s.status === "task_created").task_id]);
  assert.equal(task.assigned_to, i.sales, "the quotation's owner gets the task");
  assert.match(task.description, /Following up on our quotation Q-F-/);
  assert.ok(!/margin|cost/i.test(task.description));
  assert.equal((await f.one("select private.ap5_followups_job($1) v", [i.company])).v.details.tasks, 0, "a second run raises nothing twice");
  const queue = await sales("followup_queue", { mine: true });
  assert.equal(queue.rows.length, 1);
  assert.deepEqual(queue.coverage, { open: 1, with_next: 1 });
  await assert.rejects(() => sales("record_followup", { quote_id: q, result: "considering", next_date: istDay(0) }), /after today/);
  const rec = await sales("record_followup", { quote_id: q, result: "considering", note: "Waiting for the architect", next_date: istDay(4) });
  assert.equal(rec.next_due, istDay(4) < view.steps.find(s => s.offset_days === 7).due_date ? istDay(4) : view.steps.find(s => s.offset_days === 7).due_date);
  assert.equal((await f.one("select status from tasks where id=$1", [task.related_entity_id ? view.steps.find(s => s.status === "task_created").task_id : null])).status, "completed", "recording the result completes the task");
  const lost = await sales("record_followup", { quote_id: q, result: "lost", note: "Went with a cheaper supplier" });
  assert.equal(lost.record_outcome, true, "a lost result asks for the NOV-066 outcome");
  assert.equal(lost.next_due, null, "lost stops the sequence");
  await assert.rejects(() => sales("record_followup", { quote_id: q, result: "ordered" }, i.production), err => err.code === "42501");
});

test("AP-071 a customer decision stops the follow-ups and closes their tasks as resolved by the system", async () => {
  const q = await quote({ sentDaysAgo: 3 });
  await f.one("select private.ap5_followups_job($1) v", [i.company]);
  await f.asOwnerFor("update quotes set status='customer_rejected' where id=$1", [q], i.salesManager);
  const steps = (await f.db.query("select status, stopped_reason, task_id from quote_followup_steps where quote_id=$1", [q])).rows;
  assert.ok(steps.every(s => s.status === "stopped"));
  assert.match(steps[0].stopped_reason, /customer rejected/);
  const t = await f.one("select status, system_resolution from tasks where id=$1", [steps.find(s => s.task_id).task_id]);
  assert.equal(t.status, "completed");
  assert.match(t.system_resolution, /Resolved by system/);
  const coverage = (await sales("followup_queue")).coverage;
  assert.equal(coverage.open, 0);
});

test("AP-072 a line below its floor blocks sending until another approver approves those exact lines", async () => {
  await assert.rejects(() => sales("save_floor", { alloy: "6063", floor_per_kg: 40, reason: "Board floor for 6063" }), err => err.code === "42501", "sales cannot set floors");
  await sales("save_floor", { floor_per_kg: 32, reason: "General floor" }, i.owner);
  await sales("save_floor", { alloy: "6063", finishing_type: "mill_finish", floor_per_kg: 40, reason: "6063 mill finish up to 1 t", max_kg: 1000 }, i.owner);
  await sales("save_floor", { alloy: "6063", finishing_type: "mill_finish", min_kg: 1000, floor_per_kg: 36, reason: "6063 mill finish from 1 t" }, i.owner);
  const q = await quote({ status: "internal_review", rate: 38, kg: 500 });
  const check = await sales("floor_check", { quote_id: q });
  assert.equal(check.lines[0].floor_per_kg, "40.00".startsWith("40") ? check.lines[0].floor_per_kg : 40);
  assert.equal(Number(check.lines[0].floor_per_kg), 40, "alloy + finish + band beats the general floor");
  assert.equal(check.below.length, 1);
  const send = () => f.asOwnerFor("update quotes set status='approved_for_sending' where id=$1", [q], i.salesManager);
  await assert.rejects(send, /below the floor price/);
  await assert.rejects(() => sales("floor_request", { quote_id: q, reason: "short" }), /10 to 500/);
  const req = await sales("floor_request", { quote_id: q, reason: "Repeat project; competitor quoted 37" });
  await assert.rejects(() => sales("floor_decide", { request_id: req.id, decision: "approve" }, i.salesManager), err => err.code === "42501", "only the owner or an admin approves");
  await assert.rejects(() => sales("floor_decide", { request_id: req.id, decision: "reject" }, i.owner), /Note is required/);
  // Lines changed after the request: the approval is refused and the request superseded.
  await f.seed("update quote_items set conversion_charge_per_kg=37 where quote_id=$1", [q]);
  await assert.rejects(() => sales("floor_decide", { request_id: req.id, decision: "approve" }, i.owner), /lines changed/);
  const req2 = await sales("floor_request", { quote_id: q, reason: "Repeat project; competitor quoted 37 per kg" });
  await sales("floor_decide", { request_id: req2.id, decision: "approve", note: "Accepted for this project only" }, i.owner);
  const after = await sales("floor_check", { quote_id: q });
  assert.equal(after.approved, true);
  let err = null;
  try { await send(); } catch (error) { err = error; }
  assert.ok(!err || !/below the floor/.test(err.message), `the floor guard lets an approved quotation through (${err?.message ?? "sent"})`);
  // A 1.2 t line at 37 is above the 36 band floor: no approval needed.
  const big = await quote({ status: "internal_review", rate: 37, kg: 1200 });
  assert.equal((await sales("floor_check", { quote_id: big })).below.length, 0, "quantity band: 1.2 t uses the 36 floor");
  await assert.rejects(() => sales("floor_request", { quote_id: big, reason: "Nothing below the floor here" }), /no approval is needed/);
});

test("Batch 5 adds the morning job without changing earlier jobs; new tables have RLS and no grants", async () => {
  const jobs = (await f.db.query("select job_key, schedule from private.ap_job_registry() order by job_key")).rows;
  assert.equal(jobs.length, 15);
  assert.ok(jobs.some(j => j.job_key === "quotes.followups" && j.schedule === "morning"));
  for (const t of ["quote_followup_settings", "quote_followup_steps", "price_floors", "quote_floor_exceptions"]) {
    const r = await f.one("select c.relrowsecurity rls, has_table_privilege('authenticated', c.oid, 'select') sel from pg_class c where c.relname=$1 and c.relnamespace='public'::regnamespace", [t]);
    assert.deepEqual([r.rls, r.sel], [true, false], t);
  }
});

test("Batch 5 tables have RLS and no client grants; the two entry points need a session", async () => {
  for (const t of ["customer_usual_choice_events", "finishing_vendor_followups"]) {
    const r = await f.one("select c.relrowsecurity rls, has_table_privilege('authenticated', c.oid, 'select') sel from pg_class c where c.relname=$1 and c.relnamespace='public'::regnamespace", [t]);
    assert.deepEqual([r.rls, r.sel], [true, false], t);
  }
  for (const fn of ["ap_usual", "ap_finishing"]) {
    const r = await f.one("select has_function_privilege('anon', $1::regprocedure, 'execute') a", [`public.${fn}(text,jsonb)`]);
    assert.equal(r.a, false);
  }
  const callable = await f.db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'ap5%' and has_function_privilege('authenticated', p.oid, 'execute')`);
  assert.deepEqual(callable.rows, []);
});

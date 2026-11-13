import test from "node:test";
import assert from "node:assert/strict";
import { createOperationsFixture, ids as i, istDay } from "../scripts/lib/autopilot-batch5-operations-fixture.mjs";

let f;
test.before(async () => { f = await createOperationsFixture(); });
test.after(async () => { await f?.close(); });
test.beforeEach(async () => { await f.start(); });
test.afterEach(async () => { await f.rollback(); });
const stock = (command, payload = {}, actor = i.inventory) => f.call("ap_stock", command, payload, actor);
const plan = (command, payload = {}, actor = i.productionManager) => f.call("ap_planning", command, payload, actor);
const accounts = (command, payload = {}, actor = i.accounts) => f.call("ap_accounts", command, payload, actor);
const digest = (command, payload = {}, actor = i.owner) => f.call("ap_digest", command, payload, actor);

async function countAction(mutation, actor) {
  const request_id = f.next();
  const preview = await f.call("assurance_command", "preview", { request_id, mutation }, actor);
  const outcome = await f.call("assurance_command", "commit", { request_id, fingerprint: preview.fingerprint }, actor);
  assert.equal(outcome.state, "confirmed", JSON.stringify(outcome));
}

test("AP-047 direct quantity edits fail; opening and authorized movement deltas rebuild the balance", async () => {
  const id = await f.item();
  await assert.rejects(() => f.asUser("update inventory_items set current_stock=200 where id=$1", [id], i.owner), e => e.code === "42501");
  await f.call("ap_stock", "save_stock_policy", { threshold: 5, reason: "Small physical count corrections" }, i.owner);
  const p = { request_id: f.next(), item_id: id, direction: "out", quantity: 3, expected_stock: 100, reason: "Physical count confirmed a shortage" };
  assert.equal((await stock("request_adjustment", p)).status, "posted");
  assert.equal((await stock("request_adjustment", p)).repeated, true);
  await assert.rejects(() => stock("request_adjustment", { ...p, quantity: 4 }), /different details/);
  const moves = await stock("movements", { item_id: id });
  assert.equal(Number(moves.item.stock), 97);
  assert.equal(Number(moves.ledger_stock), 97);
  assert.equal(moves.rows.length, 2);
  const trace = await stock("trace", { table: "inventory_items", id });
  assert.equal(Number(trace.rebuilt.current_stock), 97);
  assert.deepEqual(trace.rows.map(x => x.kind), ["adjustment_out", "receipt"]);
  await assert.rejects(() => f.raw("update stock_quantity_events set delta=999 where source_id=$1", [id]), /append-only/);
});
test("AP-047 large corrections need another reviewer and stale balances cannot be approved", async () => {
  const id = await f.item(); const payload = { request_id: f.next(), item_id: id, direction: "out", quantity: 10, expected_stock: 100, reason: "Count differs after the shift close" };
  const r = await stock("request_adjustment", payload);
  assert.equal(r.status, "requested");
  assert.equal(Number((await stock("movements", { item_id: id })).item.stock), 100);
  await assert.rejects(() => stock("decide_adjustment", { id: r.id, decision: "approve", reason: "Independently counted this item" }), /Another person/);
  await assert.rejects(() => f.asUser("select public.post_inventory_adjustment($1,'out',10,'Trying the legacy entry point')", [id], i.owner), /another person/);
  await f.asOwnerFor("update inventory_items set current_stock=99 where id=$1", [id], i.owner);
  assert.equal((await stock("decide_adjustment", { id: r.id, decision: "approve", reason: "Independently counted this item" }, i.owner)).status, "stale");
  assert.equal(Number((await stock("movements", { item_id: id })).item.stock), 99);
  await assert.rejects(() => stock("request_adjustment", { ...payload, request_id: f.next() }), /balance changed/);
});
test("AP-047 approved corrections post once, cannot overdraw, and unrelated roles cannot request", async () => {
  const id = await f.item(10); const payload = { request_id: f.next(), item_id: id, direction: "out", quantity: 4, expected_stock: 10, reason: "Physical count checked with supervisor" };
  const r = await stock("request_adjustment", payload);
  const decision = { id: r.id, decision: "approve", reason: "Independent physical count agrees" };
  assert.equal((await stock("decide_adjustment", decision, i.owner)).status, "posted");
  assert.equal((await stock("decide_adjustment", decision, i.owner)).repeated, true);
  const bad = await stock("request_adjustment", { ...payload, request_id: f.next(), quantity: 50, expected_stock: 6 });
  await assert.rejects(() => stock("decide_adjustment", { ...decision, id: bad.id }, i.owner), /less than/);
  await assert.rejects(() => stock("request_adjustment", { ...payload, request_id: f.next() }, i.sales), e => e.code === "42501");
  await assert.rejects(() => stock("movements", { item_id: id }, i.foreign), /not found/);
});
test("AP-062 firm demand uses canonical recovery, drafts stay uncertain and free stock is subtracted once", async () => {
  await f.plannedJob({ kg: 800, days: 3 }); await f.plannedJob({ kg: 800, days: 4 }); await f.plannedJob({ kg: 400, days: 3, firm: false });
  await f.seed("insert into billet_batches(company_id,batch_number,alloy,temper,diameter_mm,total_weight_kg,available_weight_kg,status,received_date) values($1,'FREE-1','6063','T5',177.8,500,500,'available',current_date)", [i.company]);
  const v = await plan("billet_forecast", { show: "all" });
  const group = v.rows.find(x => x.alloy === "6063");
  assert.equal(group.days.length, 7);
  assert.equal(Number(group.days[3].firm_kg), 1000);
  assert.equal(Number(group.days[3].draft_kg), 500);
  assert.equal(Number(group.days[3].firm_count), 10);
  assert.equal(Number(group.days[3].shortfall_kg), 500);
  assert.equal(Number(group.days[4].shortfall_kg), 1500, "500 free kg cannot cover each day twice");
  assert.equal(Number(group.days[4].with_drafts_shortfall_kg), 2000);
  assert.equal(group.need_by, istDay(3));
  assert.equal(Number(group.peak_shortfall_kg), 1500);
});
test("AP-062 missing geometry stays unknown; changed inputs stale a shared proposal", async () => {
  const j = await f.plannedJob({ kg: 800 });
  const prep = await plan("prepare_billet"); assert.equal(prep.created, 1);
  assert.equal((await plan("prepare_billet")).created, 0);
  const p = (await f.call("ap_proposals", "list", { type: "billet.shortage" }, i.productionManager)).rows[0];
  await f.seed("update production_jobs set planned_quantity_kg=900 where id=$1", [j.job]);
  const decision = await f.call("ap_proposals", "decide", { id: p.id, decision: "accept" }, i.productionManager);
  assert.equal(decision.state, "stale");
  await f.seed("update aluminium_profiles set billet_diameter_required_inch=null where id=$1", [i.profile2]);
  await f.seed("delete from order_billet_requirements where order_id=$1", [j.order]);
  const forecast = await plan("billet_forecast", { show: "all" });
  const row = forecast.rows.find(x => x.alloy === "6063");
  assert.equal(row.peak_shortfall_kg, null);
  assert.equal(row.days[3].firm_kg, null);
  await assert.rejects(() => plan("billet_forecast", {}, i.sales), e => e.code === "42501");
});
test("AP-062 late, undated and draft purchase supply does not cover an earlier shortage", async () => {
  await f.plannedJob({ kg: 800, days: 3 });
  const supply = await f.incomingPo({ kg: 1000, days: 4 });
  await f.incomingPo({ kg: 2000, days: 2, status: "draft" });
  await f.incomingPo({ kg: 2000, days: null });
  let group = (await plan("billet_forecast", { show: "all" })).rows[0];
  assert.equal(Number(group.days[3].shortfall_kg), 1000);
  assert.equal(Number(group.days[4].shortfall_kg), 0);
  assert.equal(Number(group.peak_shortfall_kg), 1000, "late supply must not hide the prior stockout");
  await f.seed("update supplier_commitments set current_date_promised=current_date+2 where purchase_order_id=$1", [supply.po]);
  group = (await plan("billet_forecast", { show: "all" })).rows[0];
  assert.equal(Number(group.days[3].shortfall_kg), 0);
});

test("AP-062 an incomplete draft cannot hide a known firm requirement or suppress its proposal", async () => {
  await f.plannedJob({ kg: 800, days: 3 });
  const draft = await f.plannedJob({ kg: 400, days: 3, firm: false });
  await f.seed("delete from order_billet_requirements where order_id=$1", [draft.order]);
  const group = (await plan("billet_forecast", { show: "all" })).rows[0];
  const day = group.days[3];
  assert.equal(Number(day.firm_kg), 1000);
  assert.equal(Number(day.firm_count), 10);
  assert.equal(Number(day.shortfall_kg), 1000);
  assert.equal(Number(group.peak_shortfall_kg), 1000);
  assert.equal(day.draft_kg, null);
  assert.equal(day.with_drafts_shortfall_kg, null);
  assert.equal(day.firm_unknown, 0);
  assert.equal(day.draft_unknown, 1);
  assert.equal((await plan("prepare_billet")).created, 1);
});

test("AP-062 missing firm input stays unknown without erasing known draft and later daily demand", async () => {
  const firm = await f.plannedJob({ kg: 800, days: 2 });
  await f.plannedJob({ kg: 400, days: 2, firm: false });
  await f.plannedJob({ kg: 800, days: 4 });
  await f.seed("update production_jobs set planned_quantity_kg=0 where id=$1", [firm.job]);
  const group = (await plan("billet_forecast", { show: "all" })).rows[0];
  assert.equal(group.days[2].firm_kg, null);
  assert.equal(Number(group.days[2].draft_kg), 500);
  assert.equal(group.days[2].firm_unknown, 1);
  assert.equal(group.days[2].draft_unknown, 0);
  assert.equal(Number(group.days[4].firm_kg), 1000, "a daily known quantity is still visible");
  assert.equal(group.days[4].shortfall_kg, null, "the cumulative firm shortage is still unknown");
  assert.equal(group.peak_shortfall_kg, null);
  assert.equal((await plan("prepare_billet")).created, 0);
});
test("AP-062 billets already linked to a job are not procured again", async () => {
  const j = await f.plannedJob({});
  await f.seed("insert into foundry_billets(id,company_id,foundry_batch_id,billet_code,billet_number,billet_diameter_inch,billet_diameter_mm,billet_length_mm,alloy,temper,weight_kg,production_job_id,order_id,status) values($1,$2,$3,'LINKED-F-1',1,7,177.8,5800,'6063','T5',400,$4,$5,'allocated')", [f.next(),i.company,f.next(),j.job,j.order]);
  const group = (await plan("billet_forecast", { show: "all" })).rows[0];
  assert.equal(Number(group.peak_shortfall_kg), 600);
  assert.equal(Number(group.days[3].demand[0].linked_input_already_covered_kg), 400);
});
test("AP-062 billet counts sum the per-job input basis when billet lengths differ", async () => {
  const first = await f.plannedJob({ kg: 800, days: 3 }); const second = await f.plannedJob({ kg: 800, days: 3 });
  await f.seed("update order_billet_requirements set billet_weight_kg=50 where order_id=$1", [second.order]);
  const group = (await plan("billet_forecast", { show: "all" })).rows[0];
  assert.ok(first.job); assert.equal(Number(group.days[3].firm_kg), 2000);
  assert.equal(Number(group.days[3].firm_count), 30, "10 full-weight billets plus 20 shorter billets, not 40 of the shortest size");
});
test("AP-062 a planned cast counts as dated supply even when its planned billet rows already exist", async () => {
  await f.plannedJob({ kg: 800, days: 3 });
  const batch = f.next();
  await f.seed("insert into foundry_batches(id,company_id,batch_number,furnace_name,furnace_number,batch_sequence,production_date,alloy,temper,billet_length_mm,billet_diameter_mm,billet_count,status) values($1,$2,'CAST-F-1','Furnace 1','F1',1,current_date+2,'6063','T5',5800,177.8,10,'planned')", [batch,i.company]);
  await f.seed("insert into foundry_billets(company_id,foundry_batch_id,billet_code,billet_number,billet_diameter_inch,billet_diameter_mm,billet_length_mm,alloy,temper,weight_kg,status) values($1,$2,'CAST-F-1-1',1,7,177.8,5800,'6063','T5',100,'planned')", [i.company,batch]);
  const group = (await plan("billet_forecast", { show: "all" })).rows[0];
  const expected = Number((await f.one("select coalesce(total_billet_weight_density_kg,total_billet_weight_kg) n from foundry_batches where id=$1", [batch])).n);
  assert.ok(expected > 1000);
  assert.equal(Number(group.days[2].incoming_kg), expected);
  assert.equal(Number(group.days[3].shortfall_kg), 0);
  assert.equal(Number(group.free_kg), 0, "a future cast is not today's free stock");
});
test("AP-062 confirming a shortage creates a single preparation task and no stock or purchase posting", async () => {
  await f.plannedJob({}); await plan("prepare_billet");
  const p = (await f.call("ap_proposals", "list", { type: "billet.shortage" }, i.productionManager)).rows[0];
  const d = await f.call("ap_proposals", "decide", { id: p.id, decision: "edit", payload: { route: "foundry" }, note: "Cast this at our own foundry" }, i.productionManager);
  assert.equal(d.state, "edited"); assert.ok(d.outcome.task_id);
  const task = await f.one("select description,assigned_to from tasks where id=$1", [d.outcome.task_id]);
  assert.match(task.description, /1000.*7.*No stock/);
  assert.ok(task.assigned_to);
  const again = await f.call("ap_proposals", "decide", { id: p.id, decision: "accept" }, i.productionManager);
  assert.equal(again.repeated, true);
  assert.equal((await f.one("select count(*)::int n from purchase_orders")).n, 0);
});
test("AP-063 line-level due dates override the order date, basis is visible and snapshots stay immutable per day", async () => {
  const j = await f.plannedJob({ days: 3 });
  await f.seed("insert into order_line_schedules(order_item_id,company_id,order_id,required_date,updated_by,updated_by_name) values($1,$2,$3,current_date+1,$4,'Fixture owner')", [j.line, i.company, j.order, i.owner]);
  const result = await plan("predict"); assert.equal(result.examined, 1);
  const rows = await plan("red_list");
  assert.equal(rows.rows.length, 1); assert.equal(rows.rows[0].due_date, istDay(1));
  assert.match(rows.rows[0].blocker, /production/); assert.ok(rows.rows[0].estimated_date > istDay(1));
  assert.match(rows.rows[0].basis.fallback, /fewer than three/);
  assert.equal(rows.rows[0].basis.progress.order_item_id, j.line);
  await plan("predict"); assert.equal((await f.one("select count(*)::int n from order_line_predictions")).n, 1);
  await assert.rejects(() => plan("predict", {}, i.sales), e => e.code === "42501");
  assert.equal((await plan("red_list", {}, i.foreign)).rows.length, 0);
});

for (const status of ["planned", "sent_to_vendor", "in_process"]) {
  test(`AP-063 missing finishing lead stays unknown for ${status} material`, async () => {
    const job = await f.plannedJob({ days: 2 });
    await f.seed("update order_items set finishing_type='anodizing' where id=$1", [job.line]);
    await f.seed("delete from factory_finishing_lead_times where company_id=$1", [i.company]);
    await f.seed("insert into finishing_jobs(id,company_id,order_id,production_job_id,finishing_type,sent_date,input_weight_kg,status) values($1,$2,$3,$4,'anodizing',case when $5='planned' then null else current_date-1 end,100,$5)", [f.next(), i.company, job.order, job.job, status]);
    await plan("predict");
    const prediction = (await plan("red_list", { show: "all" })).rows[0];
    assert.equal(prediction.estimated_date, null);
    assert.equal(prediction.blocker, "finishing lead time missing");
    assert.equal(prediction.basis.finishing_lead_days, null);
    assert.equal(prediction.is_red, true);
    assert.equal((await plan("red_list")).rows.length, 1);
  });
}

test("AP-063 recorded finishing lead still yields a dated vendor estimate", async () => {
  const job = await f.plannedJob({ days: 2 });
  await f.seed("update order_items set finishing_type='anodizing' where id=$1", [job.line]);
  await f.seed("insert into factory_finishing_lead_times(company_id,finishing_type,lead_days,updated_by) values($1,'anodizing',3,$2) on conflict(company_id,finishing_type) do update set lead_days=3", [i.company, i.owner]);
  await f.seed("insert into finishing_jobs(id,company_id,order_id,production_job_id,finishing_type,sent_date,input_weight_kg,status) values($1,$2,$3,$4,'anodizing',current_date-1,100,'sent_to_vendor')", [f.next(), i.company, job.order, job.job]);
  await plan("predict");
  const prediction = (await plan("red_list", { show: "all" })).rows[0];
  assert.ok(prediction.estimated_date);
  assert.equal(prediction.blocker, "finishing at vendor");
  assert.equal(prediction.basis.finishing_lead_days, 3);
});
test("AP-085 blockers prevent both direct and proposal month close; second-person exceptions bind exact items", async () => {
  const check = await accounts("close_checklist", { month: "2026-10" });
  assert.ok(check.blocking_count > 0);
  await assert.rejects(() => f.call("ap_period", "close_month", { month: "2026-10", reason: "Normal month-end close checks" }, i.owner), /blockers/);
  await assert.rejects(() => f.asUser("select public.set_books_locked_through('2026-10-31','Legacy control cannot bypass the checks')", [], i.owner), /blockers/);
  const ex = await accounts("request_close_exception", { month: "2026-10", fingerprint: check.fingerprint, reason: "Tally export approved for next working day" });
  await assert.rejects(() => accounts("decide_close_exception", { id: ex.id, decision: "approve", reason: "These items have been reviewed" }), e => e.code === "42501");
  await accounts("decide_close_exception", { id: ex.id, decision: "approve", reason: "These items have been reviewed" }, i.admin);
  const closed = await f.call("ap_period", "close_month", { month: "2026-10", reason: "Accounts head closes with reviewed exception" }, i.owner);
  assert.equal(closed.locked_through, "2026-10-31");
  assert.equal((await f.one("select status from month_close_exceptions where id=$1", [ex.id])).status, "used");
});
test("AP-085 stale exception requests fail and only the nominated head closes", async () => {
  const check = await accounts("close_checklist", { month: "2026-10" });
  const ex = await accounts("request_close_exception", { month: "2026-10", fingerprint: check.fingerprint, reason: "Tally export approved for next working day" });
  await f.seed("update invoices set grand_total=21000 where id=$1", [i.inv2]);
  await assert.rejects(() => accounts("decide_close_exception", { id: ex.id, decision: "approve", reason: "Independent review of open items" }, i.owner), /items changed/);
  await accounts("nominate_close_head", { actor_id: i.accounts }, i.owner);
  await assert.rejects(() => f.call("ap_period", "close_month", { month: "2026-10", reason: "Owner attempts the accounts head close" }, i.owner), e => e.code === "42501");
});

for (const approveBeforeRecount of [false, true]) {
test(`AP-085 an independent recount invalidates ${approveBeforeRecount ? "approved" : "pending"} close exceptions even when the line status returns to difference`, async () => {
  const batch = f.next(), count = f.next(), line = f.next();
  await f.seed("insert into profile_stock_batches(id,company_id,profile_id,finish,length_m,quantity_pieces,total_weight_kg,location,status,updated_at) values($1,$2,$3,'mill_finish',600,100,100,'Audit rack','available','2026-10-01')", [batch, i.company, i.profile2]);
  await f.seed("insert into cycle_counts(id,company_id,location,blind,cutoff_at,opened_by) values($1,$2,'Audit rack',false,'2026-10-20',$3)", [count, i.company, i.inventory]);
  await f.seed("insert into cycle_count_lines(id,company_id,count_id,profile_stock_batch_id,expected_pieces,expected_kg,batch_snapshot) values($1,$2,$3,$4,100,100,'{}')", [line, i.company, count, batch]);
  await countAction({ action: "count.record", count_id: count, line_id: line, counted_pieces: 90, counted_kg: 90, note: "First physical count found ninety pieces" }, i.inventory);
  const before = await accounts("close_checklist", { month: "2026-10" });
  const approved = await accounts("request_close_exception", { month: "2026-10", fingerprint: before.fingerprint, reason: "Stock variance at ninety kg reviewed" });
  if (approveBeforeRecount) await accounts("decide_close_exception", { id: approved.id, decision: "approve", reason: "Independent approval of current observations" }, i.admin);
  await countAction({ action: "count.review", line_id: line, decision: "recount", note: "Request another employee to recount" }, i.owner);
  await countAction({ action: "count.record", count_id: count, line_id: line, counted_pieces: 10, counted_kg: 10, note: "Independent recount found only ten pieces" }, i.dispatchManager);
  assert.equal((await f.one("select status from cycle_count_lines where id=$1", [line])).status, "difference");
  const after = await accounts("close_checklist", { month: "2026-10" });
  assert.notEqual(after.fingerprint, before.fingerprint);
  if (!approveBeforeRecount) await assert.rejects(() => accounts("decide_close_exception", { id: approved.id, decision: "approve", reason: "Attempt approval of superseded observations" }, i.admin), /items changed/);
  await assert.rejects(() => f.call("ap_period", "close_month", { month: "2026-10", reason: "Attempt to use approval from the first count" }, i.owner), /blockers/);
  await assert.rejects(() => f.asUser("select public.set_books_locked_through('2026-10-31','Attempt to reuse the first count approval')", [], i.owner), /blockers/);
  const fresh = await accounts("request_close_exception", { month: "2026-10", fingerprint: after.fingerprint, reason: "Review the new ten kg observation" });
  await accounts("decide_close_exception", { id: fresh.id, decision: "approve", reason: "Independent review of the new evidence" }, i.admin);
  const closed = await f.call("ap_period", "close_month", { month: "2026-10", reason: "Close using the new independently reviewed evidence" }, i.owner);
  assert.equal(closed.locked_through, "2026-10-31");
  assert.equal((await f.one("select status from month_close_exceptions where id=$1", [fresh.id])).status, "used");
});
}
test("AP-078 deadlines require acceptance evidence, cap written terms, keep notes separate, and clear when paid", async () => {
  const b = await f.supplierBill();
  await accounts("save_msme_vendor", { vendor_id: i.vendor, category: "micro", udyam: "UDYAM-DL-01-0000001", agreed_days: 90, reason: "Certificate and written agreement checked" });
  let q = await accounts("msme_queue", { show: "all" }); assert.equal(q.rows.length, 1);
  assert.equal(q.rows[0].deadline, null, "invoice date is not substituted for acceptance");
  await accounts("bill_acceptance", { bill_id: b.bill, accepted_on: istDay(-30), reason: "Signed goods acceptance record checked" });
  q = await accounts("msme_queue", { show: "all" }); assert.equal(q.rows[0].deadline, istDay(15));
  assert.equal(q.rows[0].applied_days, 45);
  await accounts("msme_note", { bill_id: b.bill, reason: "Payment arranged with accounts this Friday" });
  assert.equal((await accounts("msme_queue", { show: "all" })).rows[0].deadline, istDay(15));
  await accounts("save_msme_policy", { statutory_limit: 30, no_agreement_days: 15, reason: "Accounts uses a stricter internal cap" });
  assert.equal((await accounts("msme_queue")).rows[0].deadline, istDay(0));
  await accounts("save_msme_vendor", { vendor_id: i.vendor, category: "small", udyam: "UDYAM-DL-01-0000001", reason: "Certificate amended; no written period" });
  assert.equal((await accounts("msme_queue")).rows[0].deadline, istDay(-15));
  await f.seed("update expense_ledger set balance_amount=0,amount_paid=total_amount where id=$1", [b.expense]);
  assert.equal((await accounts("msme_queue")).rows.length, 0);
  await assert.rejects(() => accounts("msme_queue", {}, i.sales), e => e.code === "42501");
});
test("AP-080 daily digest is immutable, management-only, timestamped, and copied is never sent", async () => {
  const d = await digest("prepare_digest"); assert.match(d.message, /Figures as of .* IST/); assert.equal(d.metrics.recovery_percent, null);
  await f.seed("update invoices set grand_total=90000 where id=$1", [i.inv1]);
  assert.equal((await digest("prepare_digest")).message, d.message);
  await digest("digest_read", { id: d.id, kind: "copied" }); await digest("digest_read", { id: d.id, kind: "copied" });
  assert.equal((await f.one("select count(*)::int n from owner_digest_events")).n, 1);
  await assert.rejects(() => digest("digest", {}, i.accounts), e => e.code === "42501");
  await assert.rejects(() => digest("digest_read", { id: d.id, kind: "read" }, i.foreign), /not found/);
});
test("the three new jobs execute through the scheduler ledger and retries skip the same window", async () => {
  for (const job_key of ["billets.forecast", "orders.predict_late", "owner.digest"]) {
    const first = await f.call("ap_jobs", "run_now", { job_key }, i.owner);
    assert.equal(first.state, "succeeded", JSON.stringify(first));
    const again = await f.call("ap_jobs", "run_now", { job_key }, i.owner);
    assert.equal(again.state, "already_ran");
    const row = await f.one("select proposals_created,alerts_created,status from system_job_runs where id=$1", [first.run_id]);
    assert.equal(row.status, "succeeded"); assert.ok(Number.isInteger(row.proposals_created)); assert.ok(Number.isInteger(row.alerts_created));
  }
});
test("new tables have RLS, no direct client writes or reads, company-leading indexes, and private helpers are inaccessible", async () => {
  const tables = ["stock_adjustment_policies", "stock_adjustment_requests", "stock_quantity_events", "order_line_predictions", "vendor_msme_terms", "msme_payment_policies", "msme_bill_events", "month_close_exceptions", "month_close_heads", "owner_daily_digests", "owner_digest_events"];
  for (const table of tables) {
    const x = await f.one("select relrowsecurity rls,has_table_privilege('authenticated',$1,'SELECT,INSERT,UPDATE,DELETE') granted from pg_class where oid=$1::regclass", [table]);
    assert.equal(x.rls, true, table); assert.equal(x.granted, false, table);
    const indexes = (await f.db.query("select pg_get_indexdef(indexrelid) d from pg_index where indrelid=$1::regclass", [table])).rows;
    assert.ok(indexes.some(x => /\(company_id/.test(x.d)), table);
  }
  await assert.rejects(() => f.asUser("select private.ap5_digest($1)", [i.company], i.owner), e => e.code === "42501");
  for (const rpc of ["ap_digest", "ap_planning", "ap_accounts", "ap_stock"]) await assert.rejects(() => f.asAnon(`select public.${rpc}('digest','{}')`), e => e.code === "42501");
});

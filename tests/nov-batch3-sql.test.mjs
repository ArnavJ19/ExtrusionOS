import test from "node:test";
import assert from "node:assert/strict";
import { createNov3Fixture, nid, nids as i } from "../scripts/lib/nov-batch3-fixture.mjs";
import { migrationFiles } from "../scripts/lib/migration-chain-replay.mjs";
import { coordinationListSchema, coordinationOutcomeSchema, coordinationDetailSchema, canUseCoordinationAction } from "../lib/workflow/coordination.ts";

let f;
test.before(async () => { f = await createNov3Fixture(); });
test.after(async () => { await f?.close(); });
test.beforeEach(async () => { await f.start(); });
test.afterEach(async () => { await f.rollback(); });
const note = "Reviewed with the responsible department";
const today = offset => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + offset * 86400000));
const hours = offset => new Date(Date.now() + offset * 3600000).toISOString();
const confirmed = result => { coordinationOutcomeSchema.parse(result); assert.equal(result.state, "confirmed", JSON.stringify(result.result)); return result; };
const rejected = (result, message) => { assert.equal(result.state, "rejected", JSON.stringify(result.result)); if (message) assert.match(result.result.message, message); return result; };
const list = (view, actor = i.owner, patch = {}) => f.command("list", { view, state: "all", ...patch }, actor);
const detail = (view, id, actor = i.owner) => f.command("detail", { view, id }, actor);
const collection = (patch = {}) => ({ action: "collection.create", invoice_id: i.invoice, employee_id: i.accounts, amount: 500, disputed_amount: 0, due_date: today(1), note, ...patch });
const coverage = (patch = {}) => ({ action: "coverage.propose", primary_id: i.production, backup_id: i.backup, starts_at: hours(.01), ends_at: hours(24), responsibility: "Production team open work", note, ...patch });

test("migration replay and every new domain read match the production contracts", async () => {
  assert.equal(f.applied, migrationFiles().length + 2);
  for (const view of ["orders", "collections", "handoffs", "coverage", "sessions", "decisions", "requests", "stewards", "corrections"]) coordinationListSchema.parse(await list(view));
  assert.equal((await list("orders")).rows.length, 2);
});

test("NOV-041: coordinator transfers keep the original owner until an eligible replacement accepts", async () => {
  confirmed(await f.apply({ action: "coordinator.propose", order_id: i.order, employee_id: i.sales, note }));
  let row = (await detail("orders", i.order)).row;
  assert.equal(row.owner, null); assert.equal(row.details.proposed_id, i.sales);
  rejected(await f.apply({ action: "coordinator.accept", order_id: i.order, note }), /proposed eligible/);
  confirmed(await f.apply({ action: "coordinator.accept", order_id: i.order, note }, i.sales));
  confirmed(await f.apply({ action: "coordinator.propose", order_id: i.order, employee_id: i.productionManager, note }));
  row = (await detail("orders", i.order)).row; assert.equal(row.owner, "Fixture sales");
  confirmed(await f.apply({ action: "coordinator.accept", order_id: i.order, note }, i.productionManager));
  const record = coordinationDetailSchema.parse(await detail("orders", i.order)); assert.equal(record.row.owner, "Fixture productionManager"); assert.equal(record.events.length, 4);
});

test("NOV-041: inactive, foreign and stale coordinator choices are rejected without a transfer", async () => {
  for (const employee_id of [i.inactive, i.foreign, i.accounts]) rejected(await f.apply({ action: "coordinator.propose", order_id: i.order, employee_id, note }));
  const first = await f.prepare({ action: "coordinator.propose", order_id: i.order, employee_id: i.sales, note });
  confirmed(await f.apply({ action: "coordinator.propose", order_id: i.order, employee_id: i.productionManager, note }));
  rejected(await f.commit(first), /changed/);
  await f.db.query("update app_users set is_active=false where id=$1", [i.productionManager]);
  assert.match((await detail("orders", i.order)).row.summary, /awaiting acceptance/);
});

test("NOV-043: priority policy has stable ties, retains reasons and never changes the order stage", async () => {
  const original = (await detail("orders", i.order2)).row.status;
  confirmed(await f.apply({ action: "priority.set", order_id: i.order2, priority: "urgent", note }));
  const rows = (await list("orders")).rows; assert.equal(rows[0].id, i.order2); assert.equal(rows[0].status, original);
  assert.equal(rows[0].details.policy, "existing-priority-due-v1");
  assert.equal((await detail("orders", i.order2)).events[0].note, note);
  confirmed(await f.apply({ action: "priority.set", order_id: i.order, priority: "urgent", note }));
  assert.deepEqual((await list("orders")).rows.map(row => row.id), [i.order, i.order2]);
  await assert.rejects(() => f.prepare({ action: "priority.set", order_id: i.order, priority: "urgent", note }, i.production), /Not permitted/);
});

test("NOV-040: promise progress follows real net settlements, partial receipts, reversal and credits", async () => {
  const result = confirmed(await f.apply(collection(), i.accounts)); const id = result.request_id;
  assert.equal((await list("collections", i.accounts)).rows[0].details.balance_due, 1000);
  const paymentDate = (await f.db.query("select current_date::text d")).rows[0].d;
  const receipt = async (amount, method = "cash") => (await f.asUser("select public.post_financial_receipt_atomic($1,$2,$3) data", [{ amount, payment_date: paymentDate, payment_method: method, reference_number: null, notes: "Reviewed November fixture receipt", source_type: "manual" }, [{ invoice_id: i.invoice, amount }], f.nextId()], i.accounts))[0].data;
  const first = await receipt(200);
  let row = (await detail("collections", id, i.accounts)).row; assert.equal(row.status, "partially_fulfilled"); assert.equal(row.details.remaining_promise, 300);
  const second = await receipt(300);assert.equal((await detail("collections", id, i.accounts)).row.status, "promise_met");
  for (const posted of [first, second]) await f.asUser("select public.reverse_payment_atomic($1,$2,$3)", [posted.allocations[0].payment_id, "Bank confirmed receipt reversal", f.nextId()], i.accounts);
  assert.equal((await detail("collections", id, i.accounts)).row.details.remaining_promise, 500);
  await receipt(200, "credit_note");
  row = (await detail("collections", id, i.accounts)).row;assert.equal(row.details.remaining_promise, 500);assert.equal(row.details.non_cash_adjustment_change, 200);
  await f.db.query("update invoices set credited_amount=1000 where id=$1", [i.invoice]); assert.equal((await detail("collections", id, i.accounts)).row.status, "settled");
  await f.db.query("update invoices set credited_amount=0 where id=$1", [i.invoice]); assert.equal((await detail("collections", id, i.accounts)).row.status, "promised");
  assert.equal((await f.db.query("select count(*) n from payments")).rows[0].n, 3);
});

test("NOV-040: duplicates, invalid values, settled races and reschedules preserve the original promise", async () => {
  const id = confirmed(await f.apply(collection(), i.accounts)).request_id;
  rejected(await f.apply(collection(), i.accounts), /already has an active/);
  confirmed(await f.apply({ action: "collection.update", id, employee_id: i.owner, due_date: today(3), disputed_amount: 100, note }, i.accounts));
  const row = (await detail("collections", id, i.accounts)).row; assert.equal(row.status, "disputed"); assert.equal(row.details.original_due_date, today(1)); assert.equal(row.due_date, today(3));
  const stale = await f.prepare({ action: "collection.update", id, employee_id: i.accounts, due_date: today(4), disputed_amount: 0, note }, i.accounts);
  await f.db.query("update invoices set amount_paid=1000,updated_at=now() where id=$1", [i.invoice]);
  rejected(await f.commit(stale, i.accounts), /changed/);
  for (const role of [i.sales, i.production, i.viewer]) await assert.rejects(() => list("collections", role));
  assert.equal((await list("collections", i.foreign)).total_count, 0);
  confirmed(await f.apply({ action: "collection.withdraw", id, note }, i.accounts));
  await f.db.query("update invoices set amount_paid=0 where id=$1", [i.invoice]);
  for (const patch of [{ amount: -1 }, { amount: 1001 }, { amount: 1.001 }, { disputed_amount: 1001 }, { employee_id: i.sales }]) rejected(await f.apply(collection(patch), i.accounts));
});

test("NOV-046: future handoffs bind the exact service revision and elapsed-hour target", async () => {
  const publish = (requirements) => ({ action: "contract.publish", team: "dispatch", response_hours: 6, requirements, evidence: "Released packing list and location identity", note });
  const first = confirmed(await f.apply(publish("Released quantity, correct order and identified load"))).request_id;
  const task1 = f.nextId();
  await f.db.query("insert into tasks(id,company_id,task_type,title,handoff_key,handoff_team,handoff_quantity_kg,handoff_source_type,handoff_source_id) values($1,$2,'department_handoff','Review fixture handoff','nov3:first','dispatch',100,'packaging_job',$3)", [task1, i.company, f.nextId()]);
  const second = confirmed(await f.apply(publish("Released quantity, correct order and verified transport documents"))).request_id;
  const task2 = f.nextId();
  await f.db.query("insert into tasks(id,company_id,task_type,title,handoff_key,handoff_team,handoff_quantity_kg,handoff_source_type,handoff_source_id) values($1,$2,'department_handoff','Review second fixture handoff','nov3:second','dispatch',80,'packaging_job',$3)", [task2, i.company, f.nextId()]);
  const bound = await f.db.query("select contract_id,extract(epoch from(response_due_at-t.created_at))/3600 hours from handoff_service_snapshots s join tasks t on t.id=s.task_id order by t.id");
  assert.deepEqual(bound.rows.map(row => row.contract_id), [first, second]); assert.equal(Number(bound.rows[0].hours), 6);
  const original = (await detail("handoffs", first)).row; assert.equal(original.status, "superseded"); assert.equal(original.details.handoffs[0].expected_kg, 100); assert.equal(original.details.handoffs[0].accepted_kg, null);
});

test("NOV-048: backup acknowledgement uses existing delegation and cancellation preserves task history", async () => {
  const id = confirmed(await f.apply(coverage())).request_id;
  assert.equal((await f.db.query("select assigned_to from tasks where id=$1", [i.task])).rows[0].assigned_to, i.production);
  rejected(await f.apply({ action: "coverage.acknowledge", id, note }), /selected backup/);
  confirmed(await f.apply({ action: "coverage.acknowledge", id, note }, i.backup));
  const row = (await detail("coverage", id)).row; assert.ok(row.details.delegation_id); assert.equal(row.status, "scheduled");
  await f.db.query("update task_delegations set starts_at=now()-interval '1 minute' where id=$1", [row.details.delegation_id]);
  confirmed(await f.apply({ action: "coverage.reconcile", note }));
  assert.equal((await f.db.query("select assigned_to from tasks where id=$1", [i.task])).rows[0].assigned_to, i.backup);
  const incoming = f.nextId(); await f.db.query("insert into tasks(id,company_id,title,assigned_to,status) values($1,$2,'New task during coverage',$3,'open')", [incoming, i.company, i.production]);
  assert.equal((await f.db.query("select assigned_to from tasks where id=$1", [incoming])).rows[0].assigned_to, i.backup);
  confirmed(await f.apply({ action: "coverage.cancel", id, note }));
  assert.equal((await f.db.query("select assigned_to from tasks where id=$1", [i.task])).rows[0].assigned_to, i.production);
  assert.equal((await f.db.query("select role from app_users where id=$1", [i.backup])).rows[0].role, "production");
});

test("NOV-048: overlaps, chains, changed employees and ineligible teams cannot obtain coverage", async () => {
  confirmed(await f.apply(coverage()));
  rejected(await f.apply(coverage()), /overlaps/);
  rejected(await f.apply(coverage({ primary_id: i.backup, backup_id: i.production })), /overlaps/);
  rejected(await f.apply(coverage({ backup_id: i.accounts })), /eligible team/);
  rejected(await f.apply(coverage({ backup_id: i.foreign })), /eligible employee/);
  rejected(await f.apply(coverage({ ends_at: hours(-1) })), /coverage window/);
});

test("NOV-049: a meeting retains source snapshots and one unresolved decision carries into the next", async () => {
  const session = confirmed(await f.apply({ action: "session.start", note })).request_id;
  const mutation = { action: "decision.create", session_id: session, order_id: i.order, employee_id: i.production, title: "Confirm revised packing instruction", due_date: today(1), note };
  const decision = confirmed(await f.apply(mutation)).request_id;
  const next = confirmed(await f.apply({ action: "session.start", note })).request_id;
  let snapshot = (await detail("sessions", next)).row.details.snapshot;
  assert.equal(snapshot.orders.state, "available"); assert.equal(snapshot.decisions.rows[0].id, decision);
  rejected(await f.apply({ ...mutation, session_id: next }), /already has a task/);
  await f.db.query("update tasks set status='completed',completed_at=now() where id=$1", [decision]);
  assert.equal((await f.command("list", { view: "decisions" })).total_count, 0);
  assert.equal((await detail("sessions", next)).row.details.snapshot.decisions.rows.length, 1, "retained snapshot is historical");
});

test("NOV-050: recipient acknowledgement, clarification, resolution and requester withdrawal remain distinct", async () => {
  const mutation = { action: "request.create", order_id: i.order, employee_id: i.sales, due_date: today(1), message: "Confirm site packing instructions", criteria: "Attach the approved packing instruction reference", note };
  const id = confirmed(await f.apply(mutation)).request_id;
  rejected(await f.apply({ action: "request.progress", id, stage: "acknowledged", note }), /Only the recipient/);
  confirmed(await f.apply({ action: "request.progress", id, stage: "acknowledged", note }, i.sales));
  confirmed(await f.apply({ action: "request.progress", id, stage: "clarification", note }, i.sales));
  assert.equal((await detail("requests", id, i.sales)).row.status, "clarification");
  confirmed(await f.apply({ action: "request.progress", id, stage: "resolved", note }, i.sales));
  assert.equal((await detail("requests", id, i.sales)).row.status, "done");
  const again = confirmed(await f.apply(mutation)).request_id;
  confirmed(await f.apply({ action: "request.progress", id: again, stage: "withdrawn", note }));
  assert.equal((await detail("requests", again)).row.status, "cancelled");
  assert.equal((await detail("requests", id)).events.length, 4);
  assert.equal((await list("requests", i.production)).total_count, 0);
});

test("NOV-050: duplicate requests, access loss and late resolution fail without unrelated notifications", async () => {
  const mutation = { action: "request.create", order_id: i.order, employee_id: i.sales, due_date: today(1), message: "Confirm the approved dispatch note", criteria: "Approved note with order identity", note };
  const id = confirmed(await f.apply(mutation)).request_id;
  rejected(await f.apply(mutation));
  const prepared = await f.prepare({ action: "request.progress", id, stage: "resolved", note }, i.sales);
  await f.db.query("update app_users set is_active=false where id=$1", [i.sales]);
  await assert.rejects(() => f.commit(prepared, i.sales));
  assert.equal((await detail("requests", id)).row.status, "recipient_unavailable");
  await assert.rejects(() => detail("requests", id, i.production));
});

test("NOV-056: independent stewards correct only the current master and retain reviewed evidence", async () => {
  confirmed(await f.apply({ action: "steward.assign", employee_id: i.owner, backup_id: i.productionManager, note }));
  const id = confirmed(await f.apply({ action: "correction.report", profile_id: i.profile, proposed_weight: .825, evidence: "Approved drawing revision B, measured section", note })).request_id;
  rejected(await f.apply({ action: "correction.review", id, decision: "approved", note }), /own correction/);
  confirmed(await f.apply({ action: "correction.review", id, decision: "approved", note }, i.productionManager));
  assert.equal(Number((await f.db.query("select section_weight_kg_per_m from aluminium_profiles where id=$1", [i.profile])).rows[0].section_weight_kg_per_m), .825);
  assert.equal((await detail("corrections", id)).row.status, "approved");
  rejected(await f.apply({ action: "correction.review", id, decision: "approved", note }, i.productionManager), /already reviewed/);
});

test("NOV-056: conflicting/stale corrections are superseded and cannot approve a changed profile", async () => {
  confirmed(await f.apply({ action: "steward.assign", employee_id: i.owner, backup_id: i.productionManager, note }));
  const mutation = { action: "correction.report", profile_id: i.profile, proposed_weight: .85, evidence: "Approved new technical drawing reference", note };
  const id = confirmed(await f.apply(mutation, i.sales)).request_id;
  rejected(await f.apply(mutation, i.sales), /already has an open/);
  await f.db.query("update aluminium_profiles set section_weight_kg_per_m=.81,updated_at=now() where id=$1", [i.profile]);
  assert.equal((await detail("corrections", id)).row.status, "stale_proposal");
  rejected(await f.apply({ action: "correction.review", id, decision: "approved", note }), /profile changed/);
  confirmed(await f.apply({ action: "correction.review", id, decision: "superseded", note }));
  assert.equal(Number((await f.db.query("select section_weight_kg_per_m from aluminium_profiles where id=$1", [i.profile])).rows[0].section_weight_kg_per_m), .81);
});

test("NOV-097/098: source changes reject the review; original-request replay returns exactly one outcome", async () => {
  const mutation = { action: "priority.set", order_id: i.order, priority: "high", note };
  const preview = await f.prepare(mutation); assert.equal(preview.state, "prepared");
  assert.equal((await detail("orders", i.order)).row.details.priority, "normal");
  const result = confirmed(await f.commit(preview));
  assert.deepEqual(await f.commit(preview), result); assert.deepEqual(await f.command("outcome", { request_id: preview.request_id }), result);
  assert.equal((await f.db.query("select count(*) n from coordination_events where entity_id=$1", [i.order])).rows[0].n, 1);
  await assert.rejects(() => f.prepare({ ...mutation, priority: "urgent" }, i.owner, preview.request_id), /different details/);
  const changed = await f.prepare({ ...mutation, priority: "urgent" });
  await f.db.query("update orders set expected_dispatch_date=expected_dispatch_date+1 where id=$1", [i.order]);
  rejected(await f.commit(changed), /changed/);
});

test("NOV-097/098: expiry, cancellation, unknown requests and authorization loss have truthful outcomes", async () => {
  const preview = await f.prepare({ action: "priority.set", order_id: i.order, priority: "high", note });
  await f.db.query("update coordination_requests set expires_at=now()-interval '1 minute' where request_id=$1", [preview.request_id]);
  rejected(await f.commit(preview), /expired/);
  const cancelled = await f.prepare({ action: "session.start", note });
  assert.equal((await f.command("abandon", { request_id: cancelled.request_id })).state, "abandoned");
  assert.equal((await f.commit(cancelled)).state, "abandoned");
  const absent = coordinationOutcomeSchema.parse(await f.command("outcome", { request_id: f.nextId() }));assert.equal(absent.state, "not_recorded");
  await assert.rejects(() => f.command("outcome", { request_id: preview.request_id }, i.admin));
  await assert.rejects(() => f.command("outcome", { request_id: preview.request_id }, i.foreign));
  await assert.rejects(() => f.command("outcome", { request_id: preview.request_id }, i.viewer));
});

test("security: all new tables deny direct writes and cross-company reads; RPC and TypeScript permissions agree", async () => {
  const tables = ["order_coordinators", "collection_promises", "handoff_service_contracts", "handoff_service_snapshots", "backup_coverages", "coordination_sessions", "coordination_decisions", "action_request_details", "master_stewardships", "profile_corrections", "coordination_requests", "coordination_events"];
  const acl = await f.db.query("select relname,relrowsecurity,has_table_privilege('authenticated',oid,'INSERT,UPDATE,DELETE') w from pg_class where relnamespace='public'::regnamespace and relname=any($1)", [tables]);
  assert.equal(acl.rows.length, tables.length); for (const row of acl.rows) { assert.equal(row.relrowsecurity, true, row.relname); assert.equal(row.w, false, row.relname); }
  for (const role of ["owner", "admin", "sales_manager", "sales", "production_manager", "production", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "accounts", "quality", "viewer", "dealer_admin", "dealer_staff"]) {
    for (const action of ["priority.set", "collection.create", "contract.publish", "coverage.propose", "session.start", "request.create", "steward.assign", "correction.review"]) {
      assert.equal((await f.db.query("select private.coordination_action_allowed($1,$2) allowed", [role, action])).rows[0].allowed, canUseCoordinationAction(role, action), `${role}:${action}`);
    }
  }
  confirmed(await f.apply({ action: "coordinator.propose", order_id: i.order, employee_id: i.sales, note }));
  assert.deepEqual(await f.asUser("select * from order_coordinators", [], i.foreign), []);
  await assert.rejects(() => f.asUser("update order_coordinators set proposed_id=$1", [i.owner]));
  await assert.rejects(() => f.command("list", { view: "orders", company_id: i.foreignCompany }));
  await assert.rejects(() => f.prepare({ action: "priority.set", order_id: i.order, priority: "high", note, company_id: i.foreignCompany }));
  for (const actor of [i.dealer, i.inactive]) await assert.rejects(() => list("orders", actor));
});

test("server pagination, literal search, state filters and stable sorting do not fetch the whole database", async () => {
  for (let n = 0; n < 15; n++) await f.db.query("insert into orders(id,company_id,order_number,customer_id,order_date,priority) values($1,$2,$3,$4,current_date,'low')", [nid(500+n), i.company, `Batch item ${n}`, i.customer]);
  const first = coordinationListSchema.parse(await list("orders", i.owner, { page: 1 }));const second = await list("orders", i.owner, { page: 2 });
  assert.equal(first.rows.length, 10); assert.equal(first.total_count, 17); assert.equal(second.rows.length, 7);
  assert.equal(new Set([...first.rows, ...second.rows].map(row => row.id)).size, 17);
  assert.equal((await list("orders", i.owner, { search: "%" })).rows.length, 0);
  const exactLabel = (await detail("orders", i.order)).row.label;
  assert.equal((await list("orders", i.owner, { search: exactLabel })).rows[0].id, i.order);
});

test("NOV-040: due, missed and disputed queues use India dates and finance-only projections", async () => {
  const id = confirmed(await f.apply(collection({ due_date: today(-1) }), i.accounts)).request_id;
  assert.equal((await list("collections", i.accounts, { bucket: "missed_promise" })).rows[0].id, id);
  assert.equal((await list("collections", i.accounts, { bucket: "disputed" })).rows.length, 0);
  confirmed(await f.apply({ action: "collection.update", id, employee_id: i.accounts, due_date: today(0), disputed_amount: 0, note }, i.accounts));
  assert.equal((await list("collections", i.accounts, { bucket: "follow_up_due" })).rows[0].id, id);
  confirmed(await f.apply({ action: "collection.update", id, employee_id: i.accounts, due_date: today(0), disputed_amount: 50, note }, i.accounts));
  assert.equal((await list("collections", i.accounts, { bucket: "disputed" })).rows[0].id, id);
  assert.deepEqual(await f.asUser("select * from collection_promises", [], i.sales), []);
  await assert.rejects(() => list("orders", i.owner, { bucket: "disputed" }));
});

test("NOV-048: expiry preserves completed/reassigned work and keeps unfinished work covered when the primary leaves", async () => {
  const coverageId = confirmed(await f.apply(coverage({ starts_at: hours(-.001) }))).request_id;
  confirmed(await f.apply({ action: "coverage.acknowledge", id: coverageId, note }, i.backup));
  const delegationId = (await detail("coverage", coverageId)).row.details.delegation_id;
  const done = f.nextId(), reassigned = f.nextId();
  for (const id of [done, reassigned]) await f.db.query("insert into tasks(id,company_id,title,assigned_to,status) values($1,$2,'Incoming covered task',$3,'open')", [id, i.company, i.production]);
  await f.db.query("update tasks set status='completed',completed_at=now() where id=$1", [done]);
  await f.db.query("update tasks set assigned_to=$2 where id=$1", [reassigned, i.productionManager]);
  await f.db.query("update app_users set is_active=false where id=$1", [i.production]);
  await f.db.query("update task_delegations set starts_at=now()-interval '2 days',ends_at=now()-interval '1 day' where id=$1", [delegationId]);
  confirmed(await f.apply({ action: "coverage.reconcile", note }));
  const outcomes = (await f.db.query("select task_id,outcome from task_delegation_items where delegation_id=$1 order by task_id", [delegationId])).rows;
  assert.equal(outcomes.find(row => row.task_id === done).outcome, "completed");
  assert.equal(outcomes.find(row => row.task_id === reassigned).outcome, "reassigned");
  assert.equal(outcomes.find(row => row.task_id === i.task).outcome, "kept_by_delegate");
  assert.equal((await f.db.query("select assigned_to from tasks where id=$1", [i.task])).rows[0].assigned_to, i.backup);
});

test("NOV-049: failed agenda sources are marked unavailable and never presented as an empty workload", async () => {
  await f.db.exec("alter table coordination_decisions rename to nov3_hidden_decisions");
  const id = confirmed(await f.apply({ action: "session.start", note })).request_id;
  const snapshot = (await detail("sessions", id)).row.details.snapshot;
  assert.equal(snapshot.orders.state, "available");assert.equal(snapshot.decisions.state, "unavailable");assert.deepEqual(snapshot.decisions.rows, []);
});

test("NOV-050: closed requests stop reminders and cannot race a second resolution", async () => {
  const id = confirmed(await f.apply({ action: "request.create", order_id: i.order, employee_id: i.sales, due_date: today(0), message: "Verify the released drawing reference", criteria: "Recorded revision and acceptance date", note })).request_id;
  const left = await f.prepare({ action: "request.progress", id, stage: "resolved", note }, i.sales);
  const right = await f.prepare({ action: "request.progress", id, stage: "withdrawn", note });
  confirmed(await f.commit(left, i.sales));rejected(await f.commit(right), /changed/);
  await f.db.query("update action_requests set created_at=now()-interval '2 days',last_reminded_at=now()-interval '1 day' where id=$1", [id]);
  const before = (await f.db.query("select count(*) n from notifications where notification_type='action_request_reminder'")).rows[0].n;
  await f.db.query("select private.process_action_requests($1)", [i.company]);
  assert.equal((await f.db.query("select count(*) n from notifications where notification_type='action_request_reminder'")).rows[0].n, before);
});

test("NOV-056: changing a drawing revision makes a proposal stale and cannot rewrite order-line snapshots", async () => {
  const lineId=f.nextId();
  await f.db.query("insert into order_items(id,company_id,order_id,profile_id,item_description,quantity_pieces,length_per_piece_m,section_weight_kg_per_m) values($1,$2,$3,$4,'Recorded technical section',10,6,.8)", [lineId,i.company,i.order,i.profile]);
  confirmed(await f.apply({ action: "steward.assign", employee_id: i.owner, backup_id: i.productionManager, note }));
  const id = confirmed(await f.apply({ action: "correction.report", profile_id: i.profile, proposed_weight: .83, evidence: "Released drawing revision C", note },i.sales)).request_id;
  await f.db.query("update aluminium_profiles set drawing_revision='D' where id=$1",[i.profile]);
  rejected(await f.apply({ action:"correction.review",id,decision:"approved",note }),/profile changed/);
  confirmed(await f.apply({ action:"correction.review",id,decision:"superseded",note }));
  const current=confirmed(await f.apply({ action:"correction.report",profile_id:i.profile,proposed_weight:.84,evidence:"Released drawing revision D",note },i.sales)).request_id;
  rejected(await f.apply({ action:"correction.review",id:current,decision:"approved",note },i.productionManager),/owner\/admin/);
  confirmed(await f.apply({ action:"correction.review",id:current,decision:"approved",note }));
  assert.equal(Number((await f.db.query("select section_weight_kg_per_m from order_items where id=$1",[lineId])).rows[0].section_weight_kg_per_m),.8);
  assert.equal(Number((await f.db.query("select section_weight_kg_per_m from aluminium_profiles where id=$1",[i.profile])).rows[0].section_weight_kg_per_m),.84);
  assert.equal((await f.db.query("select count(*) n from profile_spec_change_approvals where profile_id=$1",[i.profile])).rows[0].n,1);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createNov5Fixture, nids as i } from "../scripts/lib/nov-batch5-fixture.mjs";
import { migrationFiles } from "../scripts/lib/migration-chain-replay.mjs";
import { assuranceListSchema, assuranceDetailSchema, assuranceOutcomeSchema, assuranceMutationSchema, canReadAssurance, canUseAssuranceAction, ASSURANCE_ROLES, ASSURANCE_VIEWS } from "../lib/workflow/assurance.ts";

let f;
test.before(async () => { f = await createNov5Fixture(); });
test.after(async () => { await f?.close(); });
test.beforeEach(async () => { await f.start(); });
test.afterEach(async () => { await f.rollback(); });

const note = "Reviewed with the responsible department";
const sha = c => c.repeat(64);
const confirmed = result => { assuranceOutcomeSchema.parse(result); assert.equal(result.state, "confirmed", JSON.stringify(result.result)); return result; };
const rejected = (result, message) => { assert.equal(result.state, "rejected", JSON.stringify(result.result)); if (message) assert.match(result.result.message, message); return result; };
const list = (view, actor = i.owner, patch = {}) => f.command("list", { view, state: "all", ...patch }, actor);
const detail = (view, id, actor = i.owner) => f.command("detail", { view, id }, actor);
const row = async (view, id, actor = i.owner) => (await detail(view, id, actor)).row;
const one = async (sql, params = []) => (await f.db.query(sql, params)).rows[0];
const n = value => Number(value);
const tomorrow = (hour, minute = 0) => { const d = new Date(Date.now() + 86400000); const day = d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); return new Date(`${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+05:30`).toISOString(); };
const daysAgo = days => new Date(Date.now() - days * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
/** Isolates one guard on a table: other workflow triggers are disabled for this rolled-back scenario only. */
async function only(table, trigger) { await f.db.exec(`alter table public.${table} disable trigger user; alter table public.${table} enable trigger ${trigger}`); }

test("the TypeScript role mirrors match the database matrix for every role, view and action", async () => {
  const roles = [...ASSURANCE_ROLES, "dealer_admin", "dealer_staff"];
  const actions = assuranceMutationSchema._def.schema.options.map(option => option.shape.action.value);
  assert.equal(actions.length, 38);
  for (const role of roles) {
    for (const view of Object.keys(ASSURANCE_VIEWS)) assert.equal((await one("select private.assurance_read_allowed($1,$2) v", [role, view])).v, canReadAssurance(role, view), `${role} read ${view}`);
    for (const action of actions) assert.equal((await one("select private.assurance_action_allowed($1,$2) v", [role, action])).v, canUseAssuranceAction(role, action), `${role} ${action}`);
  }
});

test("migration replay and every read model match the production contracts", async () => {
  assert.equal(f.applied, migrationFiles().length + 2);
  for (const view of Object.keys(ASSURANCE_VIEWS)) assuranceListSchema.parse(await list(view));
  await assert.rejects(() => list("drawings", i.dealer), /Not permitted/);
  await assert.rejects(() => list("incoming", i.sales), /Not permitted/);
  await assert.rejects(() => list("capability", i.production), /Not permitted/);
  assuranceListSchema.parse(await list("revisions", i.production));
});

// NOV-062 ---------------------------------------------------------------------------------------
async function register(label, file, patch = {}) {
  return confirmed(await f.apply({ action: "drawing.register", drawing_id: i.drawing, revision_label: label, file_sha256: sha(file), customer_approval_required: true, profile_id: i.profile, note, ...patch }, i.quality));
}
const revisionId = async label => (await one("select id from drawing_revisions where revision_label=$1", [label])).id;
async function approveAndRelease(label) {
  const id = await revisionId(label);
  confirmed(await f.apply({ action: "drawing.customer", revision_id: id, event: "submitted", evidence: "Emailed to customer engineering", note }, i.sales));
  confirmed(await f.apply({ action: "drawing.customer", revision_id: id, event: "customer_approved", evidence: "Signed approval PDF received", customer_contact: "R. Mehta, buyer", note }, i.salesManager));
  confirmed(await f.apply({ action: "drawing.release", revision_id: id, note }, i.quality));
  return id;
}

test("NOV-062: revisions are immutable, customer events follow order and release needs customer approval", async () => {
  await register("R1", "a");
  await assert.rejects(() => f.prepare({ action: "drawing.register", drawing_id: i.drawing, revision_label: "R1", file_sha256: sha("b"), customer_approval_required: true, note }, i.quality), /already registered/);
  await assert.rejects(() => f.prepare({ action: "drawing.register", drawing_id: i.drawing, revision_label: "R9", file_sha256: sha("a"), customer_approval_required: true, note }, i.quality), /exact file is already registered as revision R1/);
  const id = await revisionId("R1");
  await assert.rejects(() => f.prepare({ action: "drawing.release", revision_id: id, note }, i.quality), /customer-approved/);
  await assert.rejects(() => f.prepare({ action: "drawing.customer", revision_id: id, event: "customer_approved", evidence: "Phone call", customer_contact: "Buyer", note }, i.sales), /Send it to the customer first/);
  confirmed(await f.apply({ action: "drawing.customer", revision_id: id, event: "submitted", evidence: "Emailed to customer engineering", note }, i.sales));
  await assert.rejects(() => f.prepare({ action: "drawing.customer", revision_id: id, event: "customer_approved", evidence: "Phone call", note }, i.sales), /who at the customer/);
  confirmed(await f.apply({ action: "drawing.customer", revision_id: id, event: "customer_query", evidence: "Customer asked about radius", note }, i.sales));
  assert.equal((await row("drawings", id)).status, "customer_query");
  confirmed(await f.apply({ action: "drawing.customer", revision_id: id, event: "customer_approved", evidence: "Signed approval PDF", customer_contact: "R. Mehta", note }, i.salesManager));
  await assert.rejects(() => f.prepare({ action: "drawing.release", revision_id: id, note }, i.sales), /Not permitted/);
  confirmed(await f.apply({ action: "drawing.release", revision_id: id, note }, i.quality));
  const record = await detail("drawings", id);
  assert.equal(record.row.status, "released"); assert.equal(record.row.details.released_revision, "R1");
  assert.equal(record.row.details.events.length, 4); assert.equal(record.events[0].action, "drawing.release");
  assert.equal((await one("select approval_status from technical_drawings where id=$1", [i.drawing])).approval_status, "customer_approved");
  await assert.rejects(() => f.prepare({ action: "drawing.register", drawing_id: i.foreignDrawing, revision_label: "R1", file_sha256: sha("c"), customer_approval_required: true, note }, i.quality), /unavailable/);
  await assert.rejects(() => detail("drawings", id, i.foreign), /unavailable/);
});

test("NOV-062: a later release supersedes the earlier one, blocks first start on the old revision and permits a recorded deviation", async () => {
  await register("R1", "a"); const r1 = await approveAndRelease("R1");
  await register("R2", "b", { technical_note: "Radius changed from 1.0 to 1.5 mm" });
  const r2 = await approveAndRelease("R2");
  assert.equal((await row("drawings", r1)).status, "superseded");
  const released = await row("drawings", r2);
  assert.equal(released.details.previous.revision_label, "R1");
  assert.deepEqual(released.details.affected_jobs.map(job => job.job_number).sort(), ["J-NOV5-1", "J-NOV5-2"], "running work stays visible for review");
  await only("production_jobs", "zzz_guard_released_drawing");
  await assert.rejects(() => f.asSystem("update production_jobs set status='in_progress' where id=$1", [i.job1]), /not the released revision R2/);
  await f.asSystem("update production_jobs set status='in_progress' where id=$1", [i.job3]);
  await assert.rejects(() => f.prepare({ action: "drawing.deviation", revision_id: r2, job_id: i.job1, valid_until: daysAgo(-5), evidence: "Customer agreed by email", note }, i.quality), /carries revision R1/);
  await assert.rejects(() => f.prepare({ action: "drawing.deviation", revision_id: r1, job_id: i.job1, valid_until: daysAgo(-120), evidence: "Customer agreed by email", note }, i.quality), /up to 90 days/);
  confirmed(await f.apply({ action: "drawing.deviation", revision_id: r1, job_id: i.job1, valid_until: daysAgo(-5), evidence: "Customer agreed to use R1 tooling for this lot", note }, i.quality));
  await f.asSystem("update production_jobs set status='in_progress' where id=$1", [i.job1]);
  assert.equal((await one("select drawing_revision from production_jobs where id=$1", [i.job1])).drawing_revision, "R1", "the job keeps the revision actually used");
  await assert.rejects(() => f.prepare({ action: "drawing.release", revision_id: r1, note }, i.quality), /customer-approved/);
});

// NOV-069 ---------------------------------------------------------------------------------------
const dispose = (patch, actor = i.quality) => f.apply({ action: "incoming.dispose", receipt_line_id: i.receiptLine, disposition: "accept", quantity: 100, evidence: "Visual and diameter checked", note, ...patch }, actor);
const balance = async () => (await row("incoming", i.receiptLine)).details;

test("NOV-069: quality decides every received portion; certificates, concessions and over-decisions are controlled", async () => {
  assert.equal(n((await balance()).pending_qc), 950, "gate-rejected material is not awaiting decision");
  await assert.rejects(() => f.prepare({ action: "incoming.dispose", receipt_line_id: i.receiptLine, disposition: "accept", quantity: 100, evidence: "Looks fine", note }, i.quality), /mill test certificate/);
  confirmed(await dispose({ quantity: 600, certificate_ref: "MTC-7781" }));
  await assert.rejects(() => dispose({ quantity: 400, certificate_ref: "MTC-7781" }), /Only 350 kg awaits/);
  await assert.rejects(() => f.prepare({ action: "incoming.dispose", receipt_line_id: i.receiptLine, disposition: "concession", quantity: 100, evidence: "Short certificate", note }, i.quality), /concession needs factory manager/);
  confirmed(await dispose({ disposition: "concession", quantity: 100 }, i.factory));
  confirmed(await dispose({ disposition: "reject", quantity: 250 }));
  const value = await balance();
  assert.deepEqual([value.pending_qc, value.accepted, value.concession, value.rejected, value.awaiting_return, value.releasable].map(n), [0, 600, 100, 250, 300, 700]);
  assert.equal((await row("incoming", i.receiptLine)).status, "awaiting_release");
  await assert.rejects(() => f.prepare({ action: "incoming.dispose", receipt_line_id: i.receiptLine, disposition: "reject", quantity: 1, evidence: "Extra", note }, i.accounts), /Not permitted/);
  // The vendor's 210/kg rate must not appear as a value or key. A plain substring check also matched random ids and
  // microsecond timestamps in the disposition history, so the value is matched as a whole JSON token.
  const projected = JSON.stringify(await row("incoming", i.receiptLine, i.accounts));
  assert.equal(/[:\[,]"?210(\.0+)?"?[,}\]]/.test(projected) || /unit_rate|supplier_rate/.test(projected), false, "vendor rates are not projected");
});

test("NOV-069: release creates billet stock once, never beyond accepted quantity, and reversals respect downstream use", async () => {
  confirmed(await dispose({ quantity: 700, certificate_ref: "MTC-7781" }));
  await assert.rejects(() => f.prepare({ action: "incoming.release", receipt_line_id: i.receiptLine, quantity_kg: 800, batch_number: "BB-1", alloy: "6063", temper: "F", note }, i.inventory), /Only 700 kg/);
  const preview = await f.prepare({ action: "incoming.release", receipt_line_id: i.receiptLine, quantity_kg: 500, batch_number: "bb-1", alloy: "6063", temper: "f", heat_number: "H-22", note }, i.inventory);
  confirmed(await f.commit(preview, i.inventory));
  assert.equal((await f.commit(preview, i.inventory)).state, "confirmed", "a retried commit returns the recorded outcome");
  const batches = (await f.db.query("select batch_number,status,total_weight_kg::float8 kg,available_weight_kg::float8 available,supplier_id from billet_batches where notes like 'Released from incoming%'")).rows;
  assert.deepEqual(batches, [{ batch_number: "BB-1", status: "available", kg: 500, available: 500, supplier_id: i.vendor }]);
  await assert.rejects(() => f.prepare({ action: "incoming.release", receipt_line_id: i.receiptLine, quantity_kg: 10, batch_number: "BB-1", alloy: "6063", temper: "F", note }, i.inventory), /already exists/);
  const accept = (await one("select id from incoming_dispositions where disposition='accept'")).id;
  await assert.rejects(() => f.prepare({ action: "incoming.reverse", id: accept, note }, i.quality), /Released billet stock depends/);
  await assert.rejects(() => f.prepare({ action: "incoming.return", receipt_line_id: i.receiptLine, quantity: 60, evidence: "Gate pass RG-4", note }, i.inventory), /Only 50 kg/);
  confirmed(await f.apply({ action: "incoming.return", receipt_line_id: i.receiptLine, quantity: 50, evidence: "Gate pass RG-4", note }, i.inventory));
  await assert.rejects(() => f.prepare({ action: "incoming.release", receipt_line_id: i.receiptLineMetres, quantity_kg: 1, batch_number: "BB-2", alloy: "6063", temper: "F", note }, i.inventory), /measured in kg/);
});

test("NOV-069: a stale review is rejected and a reversed decision returns quantity for retest", async () => {
  const stale = await f.prepare({ action: "incoming.dispose", receipt_line_id: i.receiptLine, disposition: "reject", quantity: 300, evidence: "Surface pitting", note }, i.quality);
  confirmed(await dispose({ quantity: 100, certificate_ref: "MTC-1" }));
  rejected(await f.commit(stale, i.quality), /source changed/);
  const reject = confirmed(await dispose({ disposition: "reject", quantity: 200 }));
  assert.ok(reject);
  const id = (await one("select id from incoming_dispositions where disposition='reject'")).id;
  confirmed(await f.apply({ action: "incoming.reverse", id, note: "Retest passed after cleaning" }, i.quality));
  await assert.rejects(() => f.prepare({ action: "incoming.reverse", id, note }, i.quality), /already reversed/);
  assert.equal(n((await balance()).pending_qc), 850);
});

// NOV-076 ---------------------------------------------------------------------------------------
const deliver = (patch, actor = i.dispatch) => f.apply({ action: "delivery.record", packing_item_id: i.bundle1, disposition: "accepted", quantity_kg: 300, receiver_name: "Site store keeper", evidence: "Signed POD 4471", note, ...patch }, actor);

test("NOV-076: every shipped kg gets one disposition; exceptions are owned and over-disposition is refused", async () => {
  confirmed(await deliver({}));
  confirmed(await deliver({ packing_item_id: i.bundle2, disposition: "refused", quantity_kg: 150 }));
  confirmed(await deliver({ packing_item_id: i.bundle2, disposition: "damaged", quantity_kg: 50, evidence: "Photos of dented bundle" }));
  await assert.rejects(() => deliver({ packing_item_id: i.bundle2, quantity_kg: 1 }), /Only 0 kg/);
  const value = (await row("deliveries", i.dispatch1)).details;
  assert.deepEqual([value.shipped_kg, value.accepted_kg, value.refused_kg, value.damaged_kg, value.undisposed_kg, value.open_exceptions].map(n), [500, 300, 150, 50, 0, 2]);
  assert.equal((await row("deliveries", i.dispatch1)).status, "open_exceptions");
  const pending = f.nextId();
  await f.seed("insert into dispatches(id,company_id,order_id,dispatch_number,dispatch_date,delivery_status,last_status_changed_at) values($1,$2,$3,'D-WAIT',current_date,'pending',now())", [pending, i.company, i.order]);
  const waiting = f.nextId();
  await f.seed("insert into packing_list_items(id,company_id,dispatch_id,profile_id,bundle_number,gross_weight_kg,tare_weight_kg) values($1,$2,$3,$4,'W1',102,2)", [waiting, i.company, pending, i.profile]);
  await assert.rejects(() => deliver({ packing_item_id: waiting, quantity_kg: 10 }), /after the load has departed/);
  await assert.rejects(() => deliver({ quantity_kg: 1 }, i.accounts), /Not permitted/);
  await assert.rejects(() => detail("deliveries", i.dispatch1, i.foreign), /unavailable/);
  await f.seed("update dispatches set dispatch_date=current_date-200 where id=$1", [i.dispatch2]);
  assert.equal((await f.command("list", { view: "deliveries", state: "active" })).rows.some(entry => entry.id === i.dispatch2), false, "old loads leave the attention scope");
  assert.equal((await list("deliveries")).rows.some(entry => entry.id === i.dispatch2), true, "history still includes them");
});

test("NOV-076: resolutions route returns, separate verified shortages from claims and keep history", async () => {
  confirmed(await deliver({ packing_item_id: i.bundle2, disposition: "refused", quantity_kg: 150 }));
  confirmed(await deliver({ packing_item_id: i.bundle3, disposition: "short_claimed", quantity_kg: 20, evidence: "Customer count sheet" }));
  const refused = (await one("select id from delivery_dispositions where disposition='refused'")).id;
  const short = (await one("select id from delivery_dispositions where disposition='short_claimed'")).id;
  await assert.rejects(() => f.prepare({ action: "delivery.resolve", id: refused, resolution: "return_expected", response: "credit", note }, i.dispatchManager), /sales management or quality/);
  await assert.rejects(() => f.prepare({ action: "delivery.resolve", id: refused, resolution: "verified_shortage", note }, i.inventory), /Only stores can verify/);
  await assert.rejects(() => f.prepare({ action: "delivery.resolve", id: short, resolution: "verified_shortage", note }, i.salesManager), /Only stores can verify/);
  const result = confirmed(await f.apply({ action: "delivery.resolve", id: refused, resolution: "return_expected", response: "credit", note: "Customer refused bent bundle" }, i.salesManager));
  assert.match(result.result.href, /\/tasks\/assurance\/returns\//);
  const authorization = await one("select expected_kg::float8 kg,response,status,source_disposition_id from return_authorizations");
  assert.deepEqual(authorization, { kg: 150, response: "credit", status: "authorized", source_disposition_id: refused });
  confirmed(await f.apply({ action: "delivery.resolve", id: short, resolution: "verified_shortage", note: "Stores recount confirms 20 kg short" }, i.inventory));
  await assert.rejects(() => f.prepare({ action: "delivery.reverse", id: refused, note }, i.dispatch), /already resolved/);
  confirmed(await deliver({ packing_item_id: i.bundle1, quantity_kg: 100 }));
  const accepted = (await one("select id from delivery_dispositions where packing_list_item_id=$1", [i.bundle1])).id;
  confirmed(await f.apply({ action: "delivery.reverse", id: accepted, note: "Entered against the wrong bundle" }, i.dispatch));
  assert.equal(n((await row("deliveries", i.dispatch1)).details.undisposed_kg), 350);
  assert.equal(n((await one("select count(*) c from delivery_dispositions where reversed_at is not null")).c), 1, "the reversed entry is kept");
});

// NOV-034 ---------------------------------------------------------------------------------------
test("NOV-034: an assessed change classifies every downstream record and posted work is never rewritten", async () => {
  await assert.rejects(() => f.prepare({ action: "change.propose", order_item_id: i.line1, changes: { cut_length: 6000 }, note }, i.sales), /already has this value/);
  const preview = await f.prepare({ action: "change.propose", order_item_id: i.line1, changes: { cut_length: 5800, drawing_revision: "R2" }, note }, i.sales);
  assert.equal(preview.review.facts["Already posted work"], 3);
  const proposal = confirmed(await f.commit(preview, i.sales)).request_id;
  const impacts = (await row("revisions", proposal)).details.impacts.map(entry => [entry.label, entry.classification]).sort();
  assert.deepEqual(impacts, [["Bundle B1 on D-NOV5-1", "posted_correction"], ["Bundle B2 on D-NOV5-1", "posted_correction"], ["Bundle B3 on D-NOV5-2", "posted_correction"],
    ["Customer commitment for SO-NOV5-01", "customer"], ["J-NOV5-1", "refresh"], ["J-NOV5-2", "re_review"]].sort());
  assert.deepEqual(await one("select cut_length::float8 cut,drawing_revision from order_items where id=$1", [i.line1]), { cut: 6000, drawing_revision: "R1" }, "assessment changes nothing");
  await assert.rejects(() => f.prepare({ action: "change.propose", order_item_id: i.line1, changes: { quantity_kg: 900 }, note }, i.sales), /already has an open change proposal/);
  await assert.rejects(() => f.prepare({ action: "change.decide", id: proposal, decision: "approved", note }, i.sales), /Not permitted/);
  const impact = (await one("select id from order_change_impacts where proposal_id=$1 and classification='refresh'", [proposal])).id;
  await assert.rejects(() => f.prepare({ action: "change.resolve", id: impact, outcome: "done", note }, i.productionManager), /after the proposal is approved/);
  confirmed(await f.apply({ action: "change.decide", id: proposal, decision: "approved", note }, i.factory));
  await assert.rejects(() => f.prepare({ action: "change.resolve", id: impact, outcome: "done", note }, i.accounts), /Not permitted/);
  await assert.rejects(() => f.prepare({ action: "change.resolve", id: impact, outcome: "done", note }, i.production), /Not permitted/);
  for (const { id, owner_role } of (await f.db.query("select id,owner_role from order_change_impacts where proposal_id=$1", [proposal])).rows) {
    const actor = { production_manager: i.productionManager, sales_manager: i.salesManager, dispatch_manager: i.dispatchManager }[owner_role] ?? i.factory;
    confirmed(await f.apply({ action: "change.resolve", id, outcome: "done", note }, actor));
  }
  assert.equal((await row("revisions", proposal)).status, "completed");
});

test("NOV-034: proposers cannot decide, stale assessments cannot be approved and abandonment closes impacts", async () => {
  const proposal = confirmed(await f.apply({ action: "change.propose", order_item_id: i.line1, changes: { quantity_kg: 100 }, note }, i.salesManager)).request_id;
  await assert.rejects(() => f.prepare({ action: "change.decide", id: proposal, decision: "approved", note }, i.salesManager), /Another authorized person/);
  await f.seed("update order_items set quantity_kg=950 where id=$1", [i.line1]);
  assert.equal((await row("revisions", proposal)).details.stale, true);
  await assert.rejects(() => f.prepare({ action: "change.decide", id: proposal, decision: "approved", note }, i.factory), /changed after this assessment/);
  confirmed(await f.apply({ action: "change.decide", id: proposal, decision: "abandoned", note }, i.factory));
  assert.equal(n((await one("select count(*) c from order_change_impacts where proposal_id=$1 and status='open'", [proposal])).c), 0);
  const warning = await f.prepare({ action: "change.propose", order_item_id: i.line1, changes: { quantity_kg: 100 }, note }, i.salesManager);
  assert.match(warning.review.warnings.join(" "), /below what has already departed/);
  await assert.rejects(() => f.prepare({ action: "change.propose", order_item_id: i.line1, changes: { internal_cost: 1 }, note }, i.salesManager), /cannot be changed/);
});

// NOV-055 ---------------------------------------------------------------------------------------
async function supervised(count) {
  await f.seed("insert into competency_requirements(company_id,action,competency_id,set_by) values($1,'production_start',$2,$3) on conflict do nothing", [i.company, i.competency, i.factory]);
  for (let k = 0; k < count; k++) await f.seed("insert into supervision_confirmations(company_id,action,record_id,performer_id,supervisor_id,supervisor_name,used_at) values($1,'production_start',$2,$3,$4,'Fixture factory',now())", [i.company, f.nextId(), i.production, i.factory]);
}
const assess = (outcome, actor = i.factory, employee = i.production) => f.apply({ action: "capability.assess", employee_id: employee, competency_id: i.competency, outcome, note }, actor);

test("NOV-055: independent qualification needs the agreed demonstrated evidence and an eligible assessor", async () => {
  await supervised(1);
  await assert.rejects(() => assess("independent"), /qualification evidence for this competency first/);
  await assert.rejects(() => f.prepare({ action: "capability.criteria", competency_id: i.competency, supervised_required: 2, observed_trial_required: true, note }, i.quality), /Link the competency to a procedure/);
  confirmed(await f.apply({ action: "capability.criteria", competency_id: i.competency, supervised_required: 2, observed_trial_required: false, note }, i.quality));
  await assert.rejects(() => assess("independent"), /1 of 2 supervised confirmations/);
  await supervised(1);
  await assert.rejects(() => assess("independent", i.productionManager), /independent holder of this competency or a factory manager/);
  await assert.rejects(() => assess("independent", i.factory, i.factory), /cannot assess yourself/);
  confirmed(await assess("independent"));
  const grant = await one("select level,granted_by,expires_at is not null expires from employee_competencies where employee_id=$1 and revoked_at is null", [i.production]);
  assert.deepEqual(grant, { level: "independent", granted_by: i.factory, expires: true });
  await assert.rejects(() => assess("independent"), /already independently qualified/);
  const capability = await row("capability", i.competency);
  assert.equal(capability.status, "single_cover"); assert.equal(capability.details.assessments[0].evidence.supervised_confirmations, 2);
  await assert.rejects(() => assess("more_practice", i.production, i.production2), /Not permitted/);
  confirmed(await assess("more_practice", i.factory, i.production2));
  assert.equal(n((await one("select count(*) c from employee_competencies where employee_id=$1", [i.production2])).c), 0, "more practice grants nothing");
  await assert.rejects(() => list("capability", i.sales), /Not permitted/);
});

// NOV-070 ---------------------------------------------------------------------------------------
async function instrument(code, patch = {}) {
  confirmed(await f.apply({ action: "instrument.register", code, name: `Micrometer ${code}`, unit: "mm", range_min: 0, range_max: 25, note, ...patch }, i.quality));
  return (await one("select id from measuring_instruments where code=$1", [code])).id;
}
const check = (id, patch = {}) => f.apply({ action: "instrument.check", instrument_id: id, checked_on: daysAgo(10), valid_until: daysAgo(-300), result: "pass", certificate_ref: "NABL-CAL-55", note, ...patch }, i.quality);
const bind = (result, id, actor = i.quality) => f.apply({ action: "instrument.bind", result_id: result, instrument_id: id, note }, actor);

test("NOV-070: results bind to the instrument and evidence in force; unit, range and duplicates are checked", async () => {
  const mic = await instrument("MIC-1");
  const preview = await f.prepare({ action: "instrument.bind", result_id: i.result1, instrument_id: mic, note }, i.quality);
  assert.match(preview.review.warnings.join(" "), /evidence is missing/);
  confirmed(await f.commit(preview, i.quality));
  await assert.rejects(() => bind(i.result1, mic), /already records its instrument/);
  confirmed(await check(mic));
  confirmed(await bind(i.result2, mic));
  assert.deepEqual((await f.db.query("select inspection_result_id id,evidence_state from instrument_result_bindings order by measured_at")).rows, [{ id: i.result1, evidence_state: "valid" }, { id: i.result2, evidence_state: "valid" }].map((entry, index) => index === 0 ? { ...entry, evidence_state: "missing" } : entry));
  const gauge = await instrument("WT-1", { unit: "kg/m", range_min: 0, range_max: 10 });
  const extra = f.nextId();
  await f.seed("insert into inspection_results(id,company_id,inspection_id,plan_id,item_id,observed,outcome,recorded_by,recorded_by_name) values($1,$2,$3,$4,$5,1.45,'pass',$6,'Fixture quality')", [extra, i.company, i.inspection, i.plan, i.planItem3, i.quality]);
  await assert.rejects(() => bind(extra, gauge), /measures kg\/m but the characteristic is in mm/);
  const narrow = await instrument("MIC-N", { range_min: 0, range_max: 1 });
  await assert.rejects(() => bind(extra, narrow), /outside the instrument range/);
  const expired = await instrument("MIC-X");
  confirmed(await check(expired, { checked_on: daysAgo(390), valid_until: daysAgo(30) }));
  confirmed(await f.apply({ action: "instrument.policy", mode: "block", note }, i.quality));
  await assert.rejects(() => bind(extra, expired), /evidence is expired/);
  await assert.rejects(() => f.prepare({ action: "instrument.policy", mode: "block", note }, i.quality), /already uses this mode/);
  await assert.rejects(() => f.prepare({ action: "instrument.policy", mode: "warn", note }, i.factory), /Not permitted/);
});

test("NOV-070: block policy stops approval without valid evidence, and a failed check or withdrawal opens an impact review", async () => {
  const mic = await instrument("MIC-2");
  confirmed(await check(mic, { checked_on: daysAgo(30) }));
  confirmed(await bind(i.result1, mic));
  confirmed(await f.apply({ action: "instrument.policy", mode: "block", note }, i.quality));
  await only("quality_inspections", "zzz_guard_instrument_evidence");
  await assert.rejects(() => f.asSystem("update quality_inspections set status='approved' where id=$1", [i.inspection]), /valid check evidence/);
  confirmed(await bind(i.result2, mic));
  await f.asSystem("update quality_inspections set status='approved' where id=$1", [i.inspection]);
  confirmed(await check(mic, { checked_on: daysAgo(0), valid_until: daysAgo(0), result: "fail", certificate_ref: "CAL-FAIL-1" }));
  const record = await row("instruments", mic);
  assert.equal(record.status, "impact_review");
  assert.deepEqual(record.details.reviews[0].affected.map(entry => entry.result_id).sort(), [i.result1, i.result2].sort());
  confirmed(await f.apply({ action: "instrument.review", id: record.details.reviews[0].id, note: "Wall thickness re-measured on retained samples" }, i.quality));
  confirmed(await f.apply({ action: "instrument.withdraw", instrument_id: mic, note: "Anvil damaged" }, i.quality));
  assert.equal((await row("instruments", mic)).details.reviews.filter(entry => entry.status === "open").length, 1);
  await assert.rejects(() => bind(i.result1, mic), /already records/);
  await assert.rejects(() => check(mic), /withdrawn/);
});

// NOV-026 ---------------------------------------------------------------------------------------
async function slot(id, job, machine, start, end) {
  await f.seed("insert into production_plan_slots(id,company_id,production_job_id,machine_id,planned_start_at,planned_end_at,shift,capacity_kg,status) values($1,$2,$3,$4,$5,$6,'Day',500,'scheduled')", [id, i.company, job, machine, start, end]);
}
const move = (patch, actor = i.productionManager) => f.apply({ action: "capacity.move", slot_id: i.slot1, unavailability_id: i.block, machine_id: i.press2, start_at: tomorrow(10), end_at: tomorrow(14), shift: "Day", note, ...patch }, actor);

test("NOV-026: maintenance added after planning shows affected slots, keeps running work in place and replans through existing guards", async () => {
  await slot(i.slot1, i.job1, i.press1, tomorrow(10), tomorrow(14)); await slot(i.slot2, i.job2, i.press1, tomorrow(15), tomorrow(18));
  await f.seed("insert into factory_maintenance_blocks(id,company_id,machine_id,starts_at,ends_at,reason,status,created_by) values($1,$2,$3,$4,$5,'Container liner change','planned',$6)", [i.block, i.company, i.press1, tomorrow(9), tomorrow(16), i.factory]);
  const record = await row("capacity", i.block);
  assert.equal(record.status, "replan_needed");
  assert.deepEqual(record.details.affected.map(entry => [entry.job_number, entry.running]), [["J-NOV5-1", false], ["J-NOV5-2", true]]);
  await assert.rejects(() => move({ slot_id: i.slot2 }), /already running/);
  await assert.rejects(() => move({ machine_id: i.press1 }), /overlap planned maintenance/);
  await assert.rejects(() => move({}, i.sales), /Not permitted/);
  confirmed(await move({}));
  assert.deepEqual(await one("select machine_id,status from production_plan_slots where id=$1", [i.slot1]), { machine_id: i.press2, status: "scheduled" });
  const after = await row("capacity", i.block);
  assert.equal(after.details.reschedules[0].previous.machine, i.press1);
  assert.equal(after.status, "running_affected");
  await assert.rejects(() => move({}), /not affected/);
});

test("NOV-026: an open breakdown has no assumed end, incompatible presses are refused and promises are reviewed once", async () => {
  await f.seed("insert into breakdown_logs(id,company_id,machine_id,machine_type,machine_ref_id,start_time,issue_description,status) values($1,$2,'Press B','extrusion_press',$3,now()-interval '1 hour','Hydraulic leak','open')", [i.breakdown, i.company, i.press2]);
  const later = f.nextId();
  await slot(later, i.job1, i.press2, new Date(Date.now() + 5 * 86400000).toISOString(), new Date(Date.now() + 5 * 86400000 + 4 * 3600000).toISOString());
  const record = await row("capacity", i.breakdown);
  assert.equal(record.details.end_known, false); assert.equal(record.details.affected.length, 1, "a slot five days later is still affected while the end is unknown");
  const job3Slot = f.nextId();
  await slot(job3Slot, i.job3, i.press2, tomorrow(10), tomorrow(12));
  await f.seed("update aluminium_profiles set compatible_presses='{PRESS-B}' where id=$1", [i.profile2]);
  await assert.rejects(() => f.prepare({ action: "capacity.move", slot_id: job3Slot, unavailability_id: i.breakdown, machine_id: i.press1, start_at: tomorrow(10), end_at: tomorrow(12), shift: "Day", note }, i.productionManager), /not listed as compatible with press Press A/);
  confirmed(await f.apply({ action: "capacity.unplan", slot_id: later, unavailability_id: i.breakdown, note }, i.productionManager));
  assert.equal((await one("select status from production_plan_slots where id=$1", [later])).status, "draft");
  const review = { action: "capacity.review", order_id: i.order, unavailability_id: i.breakdown, decision: "customer_informed", note };
  confirmed(await f.apply(review, i.sales));
  assert.equal((await one("select expected_dispatch_date=current_date+10 same from orders where id=$1", [i.order])).same, true, "no promise date changes");
  await assert.rejects(() => f.prepare(review, i.sales), /already reviewed/);
  await assert.rejects(() => f.prepare({ ...review, order_id: i.foreignOrder }, i.sales), /not affected/);
});

// NOV-030 ---------------------------------------------------------------------------------------
const lineFor = async bundle => (await one("select id from cycle_count_lines where batch_snapshot->>'bundle_number'=$1", [bundle])).id;
const count = (count_id, patch, actor = i.inventory) => f.apply({ action: "count.record", count_id, counted_pieces: 10, note, ...patch }, actor);

test("NOV-030: blind counts hide expected quantities, differences need an independent recount and approved adjustments are recorded", async () => {
  const id = confirmed(await f.apply({ action: "count.open", location: "rack 4", blind: true, note }, i.inventory)).request_id;
  await assert.rejects(() => f.prepare({ action: "count.open", location: "Rack 4", blind: false, note }, i.inventory), /already open/);
  assert.equal((await row("counts", id, i.inventory)).details.lines[0].expected_pieces, null, "counters do not see expected quantities");
  assert.notEqual((await row("counts", id, i.accounts)).details.lines[0].expected_pieces, null, "reviewers do");
  confirmed(await count(id, { line_id: await lineFor("S1"), counted_pieces: 10, counted_kg: 72.2 }));
  const s1 = await lineFor("S1");
  await assert.rejects(() => count(id, { line_id: s1 }), /already counted/);
  const s2 = await lineFor("S2");
  confirmed(await count(id, { line_id: s2, counted_pieces: 18 }));
  confirmed(await count(id, { unlisted_label: "X9 loose bundle", counted_pieces: 4 }));
  await assert.rejects(() => count(id, { unlisted_label: "x9 LOOSE bundle", counted_pieces: 4 }), /already recorded/);
  const statuses = Object.fromEntries((await row("counts", id)).details.lines.map(line => [line.label.split(" ·")[0], line.status]));
  assert.deepEqual([statuses.S1, statuses.S2, statuses["X9 loose bundle"], statuses.S3], ["matched", "difference", "unlisted", "pending"]);
  await assert.rejects(() => f.prepare({ action: "count.review", line_id: s2, decision: "adjust", note }, i.accounts), /independent recount/);
  await assert.rejects(() => f.prepare({ action: "count.review", line_id: s2, decision: "recount", note }, i.inventory), /Not permitted/);
  confirmed(await f.apply({ action: "count.review", line_id: s2, decision: "recount", note }, i.accounts));
  await assert.rejects(() => count(id, { line_id: s2, counted_pieces: 18 }), /different person/);
  confirmed(await count(id, { line_id: s2, counted_pieces: 18 }, i.dispatch));
  await assert.rejects(() => f.prepare({ action: "count.review", line_id: s2, decision: "adjust", note }, i.dispatch), /Not permitted/);
  confirmed(await f.apply({ action: "count.review", line_id: s2, decision: "adjust", note: "Two bundles of S2 were cut for rework" }, i.accounts));
  assert.deepEqual(await one("select quantity_pieces,total_weight_kg::float8 kg,length_m::float8 m from profile_stock_batches where id=$1", [i.stock2]), { quantity_pieces: 18, kg: 129.6, m: 108 });
  await assert.rejects(() => f.prepare({ action: "count.close", count_id: id, note }, i.inventory), /still need counting or review/);
});

test("NOV-030: movement after the cutoff is reconciled, not adjusted, and closure needs every line resolved", async () => {
  const id = confirmed(await f.apply({ action: "count.open", location: "Rack 4", blind: false, note }, i.inventory)).request_id;
  await f.seed("update profile_stock_batches set status='reserved',updated_at=clock_timestamp() where id=$1", [i.stock3]);
  const s3 = await lineFor("S3");
  confirmed(await count(id, { line_id: s3, counted_pieces: 3 }));
  assert.equal((await one("select status from cycle_count_lines where id=$1", [s3])).status, "moved");
  await assert.rejects(() => f.prepare({ action: "count.review", line_id: s3, decision: "adjust", note }, i.accounts), /cannot be reviewed as adjust/);
  confirmed(await f.apply({ action: "count.review", line_id: s3, decision: "accept_movement", note }, i.accounts));
  const s2 = await lineFor("S2");
  confirmed(await count(id, { line_id: s2, counted_pieces: 0 }));
  confirmed(await f.apply({ action: "count.review", line_id: s2, decision: "recount", note }, i.accounts));
  confirmed(await count(id, { line_id: s2, counted_pieces: 0 }, i.dispatch));
  await assert.rejects(() => f.prepare({ action: "count.review", line_id: s2, decision: "adjust", note }, i.accounts), /written off through the stock workflow/);
  confirmed(await f.apply({ action: "count.review", line_id: s2, decision: "no_change", note: "Raised a write-off in stock" }, i.accounts));
  confirmed(await f.apply({ action: "count.review", line_id: await lineFor("S1"), decision: "not_counted", note: "Rack blocked by crane" }, i.accounts));
  confirmed(await f.apply({ action: "count.close", count_id: id, note }, i.inventory));
  assert.equal((await row("counts", id)).status, "closed");
  await assert.rejects(() => count(id, { line_id: s2 }), /closed/);
  await assert.rejects(() => f.prepare({ action: "count.open", location: "Empty bay", blind: false, note }, i.inventory), /No stock bundles/);
});

// NOV-033 ---------------------------------------------------------------------------------------
const items = async (dispatch = i.dispatch1) => Object.fromEntries((await row("packs", dispatch)).details.items.map(item => [item.kind === "inspection" ? item.label : item.kind, item.state]));

test("NOV-033: readiness needs approved evidence per requirement and source batch; uploads alone do not satisfy", async () => {
  assert.deepEqual(await items(), { certificate: "missing", "Inspection for J-NOV5-1": "missing", "Inspection for J-NOV5-2": "pending" });
  await assert.rejects(() => f.prepare({ action: "pack.issue", dispatch_id: i.dispatch1, note }, i.quality), /3 mandatory requirement/);
  const pending = await f.prepare({ action: "pack.link", dispatch_id: i.dispatch1, requirement_id: i.requirement, document_id: i.documentPending, note }, i.quality);
  assert.match(pending.review.warnings.join(" "), /pending and will not satisfy/);
  confirmed(await f.commit(pending, i.quality));
  assert.equal((await items()).certificate, "pending");
  confirmed(await f.apply({ action: "pack.link", dispatch_id: i.dispatch1, requirement_id: i.requirement, document_id: i.document, note }, i.quality));
  assert.equal((await items()).certificate, "satisfied");
  await f.seed("update quality_inspections set status='approved' where id=$1", [i.inspection]);
  await f.seed("insert into quality_inspections(company_id,production_job_id,profile_id,batch_number,quantity_checked_kg,status) values($1,$2,$3,'QC-J1',200,'approved')", [i.company, i.job1, i.profile]);
  const issued = confirmed(await f.apply({ action: "pack.issue", dispatch_id: i.dispatch1, note }, i.dispatchManager));
  const pack = await row("packs", i.dispatch1);
  assert.equal(pack.status, "issued"); assert.equal(pack.details.issues[0].version, 1);
  const manifest = JSON.stringify(pack.details.issues[0].manifest);
  for (const secret of ["unit_rate", "internal_cost", "margin", "supplier_rate", "210"]) assert.equal(manifest.includes(secret), false, secret);
  assert.ok(issued);
  await assert.rejects(() => list("packs", i.production), /Not permitted/);
  const restricted = f.nextId();
  await f.seed("insert into technical_documents(id,company_id,document_type,linked_entity_type,linked_entity_id,file_name,file_url,approval_status) values($1,$2,'commercial_offer','dispatch',$3,'price-sheet.pdf','x','approved')", [restricted, i.company, i.dispatch1]);
  const lookup = await f.command("lookup", { kind: "documents", search: "", context_id: i.dispatch1 }, i.quality);
  assert.equal(lookup.some(entry => entry.value === restricted), false, "quality cannot discover commercial documents through the lookup");
  assert.equal((await f.command("lookup", { kind: "documents", search: "", context_id: i.dispatch1 }, i.owner)).some(entry => entry.value === restricted), true);
  await assert.rejects(() => f.prepare({ action: "pack.link", dispatch_id: i.dispatch1, requirement_id: i.requirement, document_id: restricted, note }, i.quality), /document is unavailable/);
});

test("NOV-033: a later drawing release makes an issued pack out of date until a deviation is authorized and a new version issued", async () => {
  confirmed(await f.apply({ action: "pack.link", dispatch_id: i.dispatch1, requirement_id: i.requirement, document_id: i.document, note }, i.quality));
  await f.seed("update quality_inspections set status='approved' where id=$1", [i.inspection]);
  await f.seed("insert into quality_inspections(company_id,production_job_id,profile_id,batch_number,quantity_checked_kg,status) values($1,$2,$3,'QC-J1',200,'approved')", [i.company, i.job1, i.profile]);
  confirmed(await f.apply({ action: "pack.issue", dispatch_id: i.dispatch1, note }, i.quality));
  await register("R2", "d"); await approveAndRelease("R2");
  const pack = await row("packs", i.dispatch1);
  assert.equal(pack.status, "issued_out_of_date"); assert.equal((await items()).drawing, "superseded");
  await assert.rejects(() => f.prepare({ action: "pack.waive", dispatch_id: i.dispatch1, requirement_key: `cert:${i.requirement}`, note }, i.quality), /needs no deviation/);
  confirmed(await f.apply({ action: "pack.waive", dispatch_id: i.dispatch1, requirement_key: `drawing:${i.profile}`, note: "Customer accepted R1 bundles already shipped" }, i.quality));
  assert.equal((await items()).drawing, "deviation_authorized");
  confirmed(await f.apply({ action: "pack.issue", dispatch_id: i.dispatch1, note }, i.quality));
  assert.deepEqual((await f.db.query("select version,status from quality_pack_issues order by version")).rows, [{ version: 1, status: "replaced" }, { version: 2, status: "issued" }]);
  const v2 = (await one("select id from quality_pack_issues where version=2")).id;
  confirmed(await f.apply({ action: "pack.withdraw", id: v2, note }, i.quality));
  await assert.rejects(() => f.prepare({ action: "pack.withdraw", id: v2, note }, i.quality), /Only the current issued pack/);
});

// NOV-038 ---------------------------------------------------------------------------------------
async function receive(bundle, kg, status = "received") {
  await f.seed(`insert into connected_return_receipts(id,company_id,packing_list_item_id,dispatch_id,order_id,order_item_id,received_kg,received_pieces,received_metres,received_by,reason,status,source_snapshot,request_payload)
    values($1,$2,$3,$4,$5,$6,$7,2,12,$8,'Customer return','` + status + `','{}','{}')`, [f.nextId(), i.company, bundle, bundle === i.bundle3 ? i.dispatch2 : i.dispatch1, i.order, i.line1, kg, i.inventory]);
}
const authorize = (patch, actor = i.salesManager) => f.apply({ action: "return.authorize", packing_item_id: i.bundle2, expected_kg: 120, response: "credit", note, ...patch }, actor);

test("NOV-038: a credited return closes only after receipt, disposition and a matching credit, without double counting", async () => {
  const id = confirmed(await authorize({})).request_id;
  await assert.rejects(() => authorize({ expected_kg: 10 }), /already authorized/);
  await assert.rejects(() => authorize({ packing_item_id: i.bundle1, expected_kg: 301 }), /Only 300 kg/);
  assert.equal((await row("returns", id)).status, "awaiting_receipt");
  await receive(i.bundle2, 120);
  assert.equal((await row("returns", id)).status, "awaiting_inspection");
  await assert.rejects(() => f.prepare({ action: "return.close", id, note }, i.salesManager), /Inspect and dispose/);
  await f.seed("update connected_return_receipts set status='disposed',disposition='scrap' where packing_list_item_id=$1", [i.bundle2]);
  assert.equal((await row("returns", id)).status, "awaiting_resolution");
  await assert.rejects(() => f.prepare({ action: "return.close", id, note }, i.salesManager), /120 kg is still owed/);
  const invoice = f.nextId(), credit = f.nextId(), invoiceItem = f.nextId();
  await f.seed("insert into invoices(id,company_id,customer_id,order_id,dispatch_id,invoice_number,status) values($1,$2,$3,$4,$5,'INV-NOV5','sent')", [invoice, i.company, i.customer, i.order, i.dispatch1]);
  await f.seed("insert into invoice_items(id,company_id,invoice_id,order_item_id,quantity,unit_rate,line_total) values($1,$2,$3,$4,500,300,150000)", [invoiceItem, i.company, invoice, i.line1]);
  await f.seed("insert into credit_notes(id,company_id,invoice_id,dispatch_id,credit_note_number,reason,subtotal,tax_total,grand_total,status,idempotency_key) values($1,$2,$3,$4,'CN-NOV5','Return',36000,6480,42480,'issued',$5)", [credit, i.company, invoice, i.dispatch1, f.nextId()]);
  await f.seed("insert into credit_note_packing_lines(company_id,credit_note_id,packing_list_item_id,invoice_item_id,quantity_kg,unit_rate,line_total,gst_percent,tax_amount) values($1,$2,$3,$4,120,300,36000,18,6480)", [i.company, credit, i.bundle2, invoiceItem]);
  await assert.rejects(() => f.prepare({ action: "return.link", id, link_type: "replacement_dispatch", target_id: i.dispatch2, quantity_kg: 120, note }, i.salesManager), /not replacement/);
  confirmed(await f.apply({ action: "return.link", id, link_type: "credit_note", target_id: credit, note }, i.accounts));
  confirmed(await f.apply({ action: "return.close", id, note }, i.salesManager));
  const closed = await row("returns", id);
  assert.equal(closed.status, "closed"); assert.equal(n(closed.details.received_kg), 120);
  const second = confirmed(await authorize({ packing_item_id: i.bundle1, expected_kg: 50 })).request_id;
  await assert.rejects(() => f.prepare({ action: "return.link", id: second, link_type: "credit_note", target_id: credit, note }, i.accounts), /already resolves a return/);
});

test("NOV-038: replacements resolve by dispatched quantity, production alone does not, and a rejected claim frees the balance", async () => {
  const id = confirmed(await authorize({ packing_item_id: i.bundle1, expected_kg: 100, response: "replacement" })).request_id;
  confirmed(await f.apply({ action: "return.link", id, link_type: "replacement_job", target_id: i.job1, quantity_kg: 100, note }, i.salesManager));
  assert.equal(n((await row("returns", id)).details.owed_kg), 100, "a job in production does not settle the obligation");
  await assert.rejects(() => f.prepare({ action: "return.link", id, link_type: "replacement_dispatch", target_id: i.dispatch1, quantity_kg: 100, note }, i.salesManager), /later departed dispatch/);
  await assert.rejects(() => f.prepare({ action: "return.link", id, link_type: "replacement_dispatch", target_id: i.dispatch2, quantity_kg: 260, note }, i.salesManager), /carries less/);
  confirmed(await f.apply({ action: "return.link", id, link_type: "replacement_dispatch", target_id: i.dispatch2, quantity_kg: 100, note }, i.dispatchManager));
  confirmed(await f.apply({ action: "return.close", id, note }, i.salesManager));
  const claim = confirmed(await authorize({ packing_item_id: i.bundle3, expected_kg: 250, response: "claim_review" })).request_id;
  await assert.rejects(() => f.prepare({ action: "return.close", id: claim, note }, i.salesManager), /Reject the claim/);
  confirmed(await f.apply({ action: "return.reject", id: claim, note: "Photos show site handling damage" }, i.salesManager));
  confirmed(await authorize({ packing_item_id: i.bundle3, expected_kg: 250, response: "credit" }));
  await assert.rejects(() => authorize({ packing_item_id: i.bundle3, expected_kg: 1 }, i.dispatch), /Not permitted/);
});

// Shared protocol --------------------------------------------------------------------------------
test("shared protocol: request identity, expiry, abandonment, tenant isolation and direct table access", async () => {
  const mutation = { action: "count.open", location: "Rack 4", blind: false, note };
  const preview = await f.prepare(mutation, i.inventory);
  assert.deepEqual(await f.command("preview", { request_id: preview.request_id, mutation }, i.inventory), preview, "replaying a preview returns the same review");
  await assert.rejects(() => f.command("preview", { request_id: preview.request_id, mutation: { ...mutation, blind: true } }, i.inventory), /different details/);
  await assert.rejects(() => f.command("outcome", { request_id: preview.request_id }, i.foreign), /Not permitted/);
  await assert.rejects(() => f.commit({ ...preview, fingerprint: "0".repeat(32) }, i.inventory), /does not match/);
  await f.db.query("update assurance_requests set expires_at=now()-interval '1 minute' where request_id=$1", [preview.request_id]);
  rejected(await f.commit(preview, i.inventory), /expired/);
  const second = await f.prepare(mutation, i.inventory);
  assert.equal((await f.command("abandon", { request_id: second.request_id }, i.inventory)).state, "abandoned");
  assert.equal((await f.command("outcome", { request_id: f.nextId() }, i.inventory)).state, "not_recorded");
  await assert.rejects(() => f.prepare(mutation, i.viewer), /Not permitted/);
  await assert.rejects(() => f.prepare({ ...mutation, company_id: i.foreignCompany }, i.inventory), /Review the required action details/);
  await assert.rejects(() => f.command("list", { view: "counts", company_id: i.foreignCompany }, i.inventory), /Invalid assurance request/);
  confirmed(await f.apply(mutation, i.inventory));
  assert.equal(n((await f.asUser("select count(*) c from cycle_counts", [], i.inventory))[0].c), 1);
  assert.equal(n((await f.asUser("select count(*) c from cycle_counts", [], i.foreign))[0].c), 0);
  assert.equal(n((await f.asUser("select count(*) c from cycle_counts", [], i.sales))[0].c), 0, "roles outside the view read nothing directly");
  await assert.rejects(() => f.asUser("select count(*) c from assurance_events", [], i.owner), /permission denied/, "history is only projected through the command");
  await assert.rejects(() => f.asUser("insert into cycle_counts(id,company_id,location,blind,opened_by) values($1,$2,'X',false,$3)", [f.nextId(), i.company, i.inventory], i.inventory), /permission denied/);
  assuranceDetailSchema.parse(await detail("counts", (await one("select id from cycle_counts")).id, i.inventory));
});

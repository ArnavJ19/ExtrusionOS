import test from "node:test";
import assert from "node:assert/strict";
import { createNov10Fixture, nids as i, day } from "../scripts/lib/nov-batch10-fixture.mjs";
import { specialistOutcomeSchema, specialistDetailSchema } from "../lib/workflow/specialist.ts";

let f;
test.before(async () => { f = await createNov10Fixture(); });
test.after(async () => { await f?.close(); });
test.beforeEach(async () => { await f.start(); });
test.afterEach(async () => { await f.rollback(); });

const note = "Reviewed with the responsible department";
const confirmed = result => { specialistOutcomeSchema.parse(result); assert.equal(result.state, "confirmed", JSON.stringify(result.result)); return result; };
const rejected = (result, message) => { specialistOutcomeSchema.parse(result); assert.equal(result.state, "rejected", JSON.stringify(result.result)); if (message) assert.match(result.result.message, message); return result; };
const row = async (view, id, actor = i.owner) => specialistDetailSchema.parse(await f.command("detail", { view, id }, actor)).row;
const list = (view, actor = i.owner, patch = {}) => f.command("list", { view, state: "all", ...patch }, actor);
const one = async (sql, params = []) => (await f.db.query(sql, params)).rows[0];
const n = value => Number(value);
const idOf = result => result.result.href.split("/").pop();

// NOV-073 ---------------------------------------------------------------------------------------
const shade = (patch = {}, actor = i.salesManager) => f.apply({ action: "shade.define", ref_code: "sil-7", shade_name: "Silver satin", finish_type: "anodized_silver", specification: "AA15 silver, satin etch, 15 micron minimum",
  sample_location: "QC cabinet B, slot 4", assessment_conditions: "D65 booth, 1 m, 45 degrees", customer_id: i.customer, project_ref: "Pune tower A", note, ...patch }, actor);
async function approvedShade(patch = {}) { const id = idOf(confirmed(await shade(patch))); confirmed(await f.apply({ action: "shade.approve", id, note }, i.quality)); return id; }

test("NOV-073: references are approved by a second person, bound to lines and batches are decided against them", async () => {
  const id = idOf(confirmed(await shade()));
  assert.equal((await row("shades", id)).details.ref_code, "SIL-7", "codes are stored upper case");
  await assert.rejects(() => f.prepare({ action: "shade.approve", id, note }, i.salesManager), /Not permitted/);
  await assert.rejects(() => f.prepare({ action: "shade.bind", order_item_id: i.line1, reference_id: id, note }, i.sales), /approved reference/);
  confirmed(await f.apply({ action: "shade.approve", id, note }, i.quality));
  const bind = await f.prepare({ action: "shade.bind", order_item_id: i.line1, reference_id: id, note }, i.sales);
  assert.equal(bind.review.facts.Specification, "AA15 silver, satin etch, 15 micron minimum");
  const binding = idOf(confirmed(await f.commit(bind, i.sales)));
  let line = await row("shades", binding);
  assert.equal(line.status, "awaiting_decision");
  // Decisions per returned batch: a match, then a second batch not reviewed together, then a rejection.
  await assert.rejects(() => f.prepare({ action: "shade.decide", id: binding, batch_label: "VB-1", decision: "match", assessed_under: "D65 booth, 1 m", note }, i.sales), /Not permitted/);
  confirmed(await f.apply({ action: "shade.decide", id: binding, batch_label: "VB-1", finishing_job_id: i.fin1, decision: "match", assessed_under: "D65 booth, 1 m", note }, i.quality));
  line = await row("shades", binding);
  assert.equal(line.status, "unreviewed_batches", "fin2 has no decision yet");
  confirmed(await f.apply({ action: "shade.decide", id: binding, batch_label: "VB-2", finishing_job_id: i.fin2, decision: "reject", assessed_under: "D65 booth, 1 m", note }, i.quality));
  assert.equal((await row("shades", binding)).status, "rejected_batch");
  const redo = await f.prepare({ action: "shade.decide", id: binding, batch_label: "vb-2", finishing_job_id: i.fin2, decision: "deviation_accepted", assessed_under: "D65 booth, 1 m", note }, i.quality);
  assert.match(redo.review.warnings.join(" "), /replaces the earlier decision/);
  confirmed(await f.commit(redo, i.quality));
  line = await row("shades", binding);
  assert.equal(line.status, "matched"); assert.equal(line.details.decisions.length, 3, "the earlier decision is kept");
  await assert.rejects(() => f.prepare({ action: "shade.decide", id: binding, batch_label: "VB-3", finishing_job_id: i.finJob, decision: "match", assessed_under: "D65 booth, 1 m", note }, i.quality), /finishing job of the same order/);
  // A new revision supersedes the approved one; the bound line keeps its approval but is flagged.
  const rev2Review = await f.prepare({ action: "shade.define", ref_code: "SIL-7", shade_name: "Silver satin", finish_type: "anodized_silver", specification: "AA15 silver, satin etch, 20 micron minimum",
    sample_location: "QC cabinet B, slot 5", assessment_conditions: "D65 booth, 1 m, 45 degrees", customer_id: i.customer, note }, i.salesManager);
  assert.match(rev2Review.review.warnings.join(" "), /Approving revision 2 supersedes the current revision/);
  const rev2Id = idOf(confirmed(await f.commit(rev2Review, i.salesManager)));
  confirmed(await f.apply({ action: "shade.approve", id: rev2Id, note }, i.quality));
  assert.equal((await row("shades", id)).status, "superseded");
  line = await row("shades", binding);
  assert.equal(line.status, "superseded_reference"); assert.match(line.details.flags.join(" "), /earlier approval stands/);
  assert.equal((await one("select count(*) c from shade_decisions where binding_id=$1", [binding])).c, 3);
});

test("NOV-073: other customers, wrong finish, mixed references, similar names and withdrawal", async () => {
  const id = await approvedShade();
  await assert.rejects(() => f.prepare({ action: "shade.bind", order_item_id: i.lineToll, reference_id: id, note }, i.sales), /belongs to another customer/);
  const other = await approvedShade({ ref_code: "pc-white", shade_name: "Silver Satin", finish_type: "powder_coating", customer_id: undefined, specification: "RAL 9016 matt, 60 micron" });
  await assert.rejects(() => f.prepare({ action: "shade.bind", order_item_id: i.line1, reference_id: other, note }, i.sales), /differs from the reference finish/);
  const generic = await approvedShade({ ref_code: "sil-8", shade_name: "Silver satin", customer_id: undefined, specification: "AA15 silver, satin etch, 12 micron" });
  confirmed(await f.apply({ action: "shade.bind", order_item_id: i.line1, reference_id: id, note }, i.sales));
  const mixed = await f.prepare({ action: "shade.bind", order_item_id: i.lineMix, reference_id: generic, note }, i.sales);
  assert.match(mixed.review.warnings.join(" "), /bound to SIL-7\. Mixed references/);
  assert.match(mixed.review.warnings.join(" "), /same shade name/);
  const mixedBinding = idOf(confirmed(await f.commit(mixed, i.sales)));
  assert.equal((await row("shades", mixedBinding)).status, "mixed_reference");
  await assert.rejects(() => f.prepare({ action: "shade.bind", order_item_id: i.lineMix, reference_id: generic, note }, i.sales), /already bound/);
  // Rebinding replaces the binding; withdrawing a reference flags the lines bound to it.
  const rebind = await f.prepare({ action: "shade.bind", order_item_id: i.lineMix, reference_id: id, note }, i.sales);
  assert.match(rebind.review.warnings.join(" "), /replaces the line's current binding/);
  const rebound = idOf(confirmed(await f.commit(rebind, i.sales)));
  assert.equal((await row("shades", mixedBinding)).details.binding_status, "replaced");
  const withdraw = await f.prepare({ action: "shade.withdraw", id, note }, i.quality);
  assert.match(withdraw.review.warnings.join(" "), /2 active order line\(s\) are flagged/);
  confirmed(await f.commit(withdraw, i.quality));
  assert.equal((await row("shades", rebound)).status, "withdrawn_reference");
  await assert.rejects(() => f.prepare({ action: "shade.decide", id: rebound, batch_label: "VB-9", decision: "match", assessed_under: "D65 booth, 1 m", note }, i.quality), /withdrawn/);
  await assert.rejects(() => f.prepare({ action: "shade.define", ref_code: "SIL-7", shade_name: "Silver satin", finish_type: "anodized_silver", specification: "x", sample_location: "QC", assessment_conditions: "D65 booth", note }, i.quality), /Specification must be/);
});

// NOV-037 ---------------------------------------------------------------------------------------
const agreement = (patch = {}, actor = i.salesManager) => f.apply({ action: "agreement.define", customer_id: i.customer, customer_ref: "BPO-2026-14", valid_from: day(-10), valid_to: day(60), overrun_percent: 5,
  lines: [{ profile_id: i.profile, finish: "anodizing", agreed_kg: 1000, rate_per_kg: 300 }, { profile_id: i.profile2, finish: "mill finish", agreed_kg: 500, rate_per_kg: 260 }], note, ...patch }, actor);
async function active() { const id = idOf(confirmed(await agreement())); confirmed(await f.apply({ action: "agreement.approve", id, note }, i.accounts)); const lines = (await row("agreements", id)).details.lines; return { id, line: lines[0].line_id, line2: lines[1].line_id }; }
const release = (line, quantity, patch = {}, actor = i.sales) => f.apply({ action: "release.create", line_id: line, quantity_kg: quantity, site: "Pune tower A site gate 2", requested_date: day(7), note, ...patch }, actor);
// A release result links to its agreement, where the releases are listed; the release itself is found by number.
const releaseId = async result => (await one("select id from blanket_releases where release_number=$1", [result.result.message.match(/REL-\d{4}-\d{4}/)[0]])).id;

test("NOV-037: releases reserve the agreement balance atomically, within the agreed overrun", async () => {
  const draft = idOf(confirmed(await agreement()));
  await assert.rejects(() => f.prepare({ action: "agreement.approve", id: draft, note }, i.salesManager), /cannot approve it/);
  const lines0 = (await row("agreements", draft)).details.lines;
  await assert.rejects(() => f.prepare({ action: "release.create", line_id: lines0[0].line_id, quantity_kg: 10, site: "Site", requested_date: day(7), note }, i.sales), /active agreement/);
  confirmed(await f.apply({ action: "agreement.approve", id: draft, note }, i.accounts));
  const line = lines0[0].line_id;
  confirmed(await release(line, 600));
  // Two call-offs reviewed against the same balance: the second is refused at confirmation.
  const exact = await f.prepare({ action: "release.create", line_id: line, quantity_kg: 400, site: "Site A gate", requested_date: day(8), note }, i.sales);
  assert.equal(exact.review.warnings.some(w => /overrun/.test(w)), false, "600 + 400 is exactly the agreed 1000 kg");
  const a = await f.prepare({ action: "release.create", line_id: line, quantity_kg: 450, site: "Site A gate", requested_date: day(8), note }, i.sales);
  const b = await f.prepare({ action: "release.create", line_id: line, quantity_kg: 450, site: "Site B gate", requested_date: day(9), note }, i.salesManager);
  assert.match(a.review.warnings.join(" "), /uses the agreed overrun allowance/, "600 + 450 goes past 1000 into the 5% allowance");
  confirmed(await f.commit(a, i.sales));
  rejected(await f.commit(b, i.salesManager), /Only 0 kg remain/);
  await assert.rejects(() => release(line, 0.001), /Only 0 kg remain/);
  const position = (await row("agreements", draft)).details.lines[0].position;
  assert.deepEqual([n(position.consumed_kg), n(position.available_kg), position.in_overrun], [1050, 0, true]);
  // Cancelling part of a release returns that quantity to the balance; the history is kept.
  const rel = (await row("agreements", draft)).details.releases.find(r => n(r.quantity_kg) === 600);
  confirmed(await f.apply({ action: "release.cancel", id: rel.id, quantity_kg: 100, note }, i.sales));
  const after = (await row("agreements", draft)).details;
  assert.equal(n(after.lines[0].position.available_kg), 100);
  assert.equal(n(after.releases.find(r => r.id === rel.id).quantity_kg), 500); assert.equal(after.releases.find(r => r.id === rel.id).history.length, 1);
  await assert.rejects(() => f.prepare({ action: "release.cancel", id: rel.id, quantity_kg: 501, note }, i.sales), /holds only 500 kg/);
  await assert.rejects(() => f.prepare({ action: "agreement.amend", line_id: line, agreed_kg: 800, note }, i.salesManager), /already released/);
});

test("NOV-037: dated rates, firm snapshots, fulfilment, returns, expiry and carry-forward", async () => {
  const { id, line } = await active();
  const relId = await releaseId(confirmed(await release(line, 300, { requested_date: day(20) })));
  // A rate revision effective before the delivery date applies when the release is firmed.
  confirmed(await f.apply({ action: "agreement.rate", line_id: line, rate_per_kg: 315, effective_from: day(15), note }, i.salesManager));
  await assert.rejects(() => f.prepare({ action: "agreement.rate", line_id: line, rate_per_kg: 320, effective_from: day(15), note }, i.salesManager), /already starts on that date/);
  await assert.rejects(() => f.prepare({ action: "agreement.rate", line_id: line, rate_per_kg: 320, effective_from: day(90), note }, i.salesManager), /within the agreement period/);
  const firm = await f.prepare({ action: "release.firm", id: relId, note }, i.sales);
  assert.equal(firm.review.facts["Rate applied"], "INR 315.00 per kg");
  confirmed(await f.commit(firm, i.sales));
  // A later revision never rewrites the firmed snapshot.
  const later = await f.prepare({ action: "agreement.rate", line_id: line, rate_per_kg: 330, effective_from: day(18), note }, i.salesManager);
  assert.match(later.review.warnings.join(" "), /1 release\(s\) already firmed keep the rate/);
  confirmed(await f.commit(later, i.salesManager));
  assert.equal(n((await one("select rate_per_kg from blanket_releases where id=$1", [relId])).rate_per_kg), 315);
  // Fulfilment needs an order of the same customer, used once.
  await assert.rejects(() => f.prepare({ action: "release.fulfil", id: relId, order_id: i.orderNoPhone, note }, i.sales), /agreement's customer/);
  const fulfil = await f.prepare({ action: "release.fulfil", id: relId, order_id: i.orderIntake, note }, i.sales);
  assert.match(fulfil.review.warnings.join(" "), /order requests 1000 kg; the release is 300 kg/);
  confirmed(await f.commit(fulfil, i.sales));
  const rel2 = await releaseId(confirmed(await release(line, 100)));
  confirmed(await f.apply({ action: "release.firm", id: rel2, note }, i.sales));
  await assert.rejects(() => f.prepare({ action: "release.fulfil", id: rel2, order_id: i.orderIntake, note }, i.sales), /already fulfils release/);
  // A return restores the balance; the fulfilled release keeps its record.
  confirmed(await f.apply({ action: "release.return", id: relId, quantity_kg: 40, note }, i.sales));
  await assert.rejects(() => f.prepare({ action: "release.return", id: relId, quantity_kg: 261, note }, i.sales), /At most 260 kg/);
  assert.equal(n((await row("agreements", id)).details.lines[0].position.consumed_kg), 360);
  // Closing is refused while a release is firm; carry-forward moves only what remains.
  await assert.rejects(() => f.prepare({ action: "agreement.close", id, carry_forward: false, note }, i.salesManager), /still scheduled or firm/);
  confirmed(await f.apply({ action: "release.cancel", id: rel2, quantity_kg: 100, note }, i.sales));
  await assert.rejects(() => f.prepare({ action: "agreement.close", id, carry_forward: true, note }, i.salesManager), /new end date/);
  const carry = confirmed(await f.apply({ action: "agreement.close", id, carry_forward: true, new_valid_to: day(120), note }, i.salesManager));
  const carried = await row("agreements", idOf(carry), i.salesManager);
  assert.equal(carried.status, "draft");
  assert.deepEqual(carried.details.lines.map(l => n(l.position.agreed_kg)), [740, 500]);
  assert.equal(n(carried.details.lines[0].rate), 330, "the latest agreed rate is carried");
  assert.equal((await row("agreements", id)).status, "closed");
  // Expiry: an active agreement past its end refuses new releases.
  const { id: id2, line: lineB } = await active();
  await f.db.query("update blanket_agreements set valid_from=current_date-60,valid_to=current_date-1 where id=$1", [id2]);
  assert.equal((await row("agreements", id2)).status, "expired");
  await assert.rejects(() => release(lineB, 10), /not in force today/);
});

// NOV-065 ---------------------------------------------------------------------------------------
const tooling = (patch = {}, actor = i.salesManager) => f.apply({ action: "tooling.define", die_id: i.dieC, customer_id: i.customer, owner_party: "customer", die_charge: 80000, customer_contribution: 50000,
  waiver_amount: 5000, recovery_basis: "per_kg", recovery_rate_per_kg: 10, recovery_cap: 8000, tax_reference: "Die charge billed with GST 18% per accounts note 14", terms: "Customer pays 50% of the die; the rest is recovered at INR 10/kg", note, ...patch }, actor);
async function activeTooling() { const id = idOf(confirmed(await tooling())); confirmed(await f.apply({ action: "tooling.approve", id, note }, i.accounts)); return id; }

test("NOV-065: the die position comes from linked finance records; recovery is measured and capped", async () => {
  const draft = await tooling();
  assert.match(draft.review.warnings.join(" "), /die master records the die as company owned/);
  assert.match(draft.review.warnings.join(" "), /never inferred from who paid/);
  const id = idOf(confirmed(draft));
  await assert.rejects(() => f.prepare({ action: "tooling.approve", id, note }, i.salesManager), /cannot approve it/);
  await assert.rejects(() => f.prepare({ action: "tooling.allocate", id, kind: "charge_invoice", invoice_id: i.invTool, amount: 1000, note }, i.accounts), /active agreement version/);
  const approve = await f.prepare({ action: "tooling.approve", id, note }, i.accounts);
  assert.match(approve.review.warnings.join(" "), /approve a waiver of INR 5,000.00/);
  confirmed(await f.commit(approve, i.accounts));
  // A payment is linked only after its invoice; amounts cannot exceed what the finance record holds.
  await assert.rejects(() => f.prepare({ action: "tooling.allocate", id, kind: "payment", payment_id: i.payTool, amount: 1000, note }, i.accounts), /invoice already linked/);
  await assert.rejects(() => f.prepare({ action: "tooling.allocate", id, kind: "charge_invoice", invoice_id: i.invTool, amount: 50000.01, note }, i.accounts), /Only INR 50,000.00 of this invoice/);
  await assert.rejects(() => f.prepare({ action: "tooling.allocate", id, kind: "charge_invoice", invoice_id: i.invOther, amount: 100, note }, i.accounts), /agreement's customer/);
  confirmed(await f.apply({ action: "tooling.allocate", id, kind: "charge_invoice", invoice_id: i.invTool, amount: 45000, note }, i.accounts));
  confirmed(await f.apply({ action: "tooling.allocate", id, kind: "payment", payment_id: i.payTool, amount: 20000, note }, i.accounts));
  await assert.rejects(() => f.prepare({ action: "tooling.allocate", id, kind: "payment", payment_id: i.payTool, amount: 1, note }, i.accounts), /Only INR 0.00 of this payment/);
  confirmed(await f.apply({ action: "tooling.allocate", id, kind: "credit_note", credit_note_id: i.cnTool, amount: 5000, note }, i.accounts));
  // Recovery: 500 kg of the die's profile on the dispatch × INR 10 = 5,000, within the 8,000 cap.
  await assert.rejects(() => f.prepare({ action: "tooling.allocate", id, kind: "recovery", invoice_id: i.invRec, amount: 5000, note }, i.accounts), /calculated from the dispatched kilograms/);
  await assert.rejects(() => f.prepare({ action: "tooling.allocate", id, kind: "recovery", invoice_id: i.invTool, note }, i.accounts), /has no dispatch/);
  const rec = await f.prepare({ action: "tooling.allocate", id, kind: "recovery", invoice_id: i.invRec, note }, i.accounts);
  assert.equal(rec.review.facts["Recovery counted"], "INR 5,000.00"); assert.equal(rec.review.facts["Dispatched of this profile"], "500 kg");
  confirmed(await f.commit(rec, i.accounts));
  await assert.rejects(() => f.prepare({ action: "tooling.allocate", id, kind: "recovery", invoice_id: i.invRec, note }, i.accounts), /already counted on this invoice/);
  let pos = (await row("tooling", id, i.accounts)).details.position;
  assert.deepEqual([n(pos.contribution_due), n(pos.charged), n(pos.credited), n(pos.received), n(pos.recovered), n(pos.outstanding), n(pos.cap_remaining)], [45000, 45000, 5000, 20000, 5000, 20000, 3000]);
  // A reversed payment and a cancelled invoice stop counting; the allocations stay on record.
  await f.db.query("update payments set reversed_at=now() where id=$1", [i.payTool]);
  pos = (await row("tooling", id, i.accounts)).details.position;
  assert.deepEqual([n(pos.received), n(pos.not_counted), n(pos.outstanding)], [0, 1, 40000]);
  const allocs = (await row("tooling", id, i.accounts)).details.allocations;
  const recovery = allocs.find(a => a.kind === "recovery");
  confirmed(await f.apply({ action: "tooling.reverse", id, allocation_id: recovery.id, note }, i.accounts));
  await assert.rejects(() => f.prepare({ action: "tooling.reverse", id, allocation_id: recovery.id, note }, i.accounts), /still counted/);
  assert.equal(n((await row("tooling", id, i.accounts)).details.position.recovered), 0);
  await assert.rejects(() => f.command("detail", { view: "tooling", id }, i.sales), /Not permitted/);
});

test("NOV-065: amendments, ownership transfer, disputes and the recovery cap", async () => {
  const id = await activeTooling();
  // The cap limits a recovery: lower the cap through an amendment, approved by a second person.
  const amend = await tooling({ recovery_cap: 3000, owner_party: "company" });
  assert.match(amend.review.warnings.join(" "), /This amends TA-.* v1/);
  assert.match(amend.review.warnings.join(" "), /Ownership changes from customer to company/);
  const v2 = idOf(confirmed(amend));
  await assert.rejects(() => tooling({ recovery_cap: 2000 }), /amendment of this agreement is already waiting/);
  confirmed(await f.apply({ action: "tooling.approve", id: v2, note }, i.accounts));
  assert.equal((await row("tooling", id, i.accounts)).status, "superseded");
  const rec = await f.prepare({ action: "tooling.allocate", id: v2, kind: "recovery", invoice_id: i.invRec, note }, i.accounts);
  assert.equal(rec.review.facts["Recovery counted"], "INR 3,000.00"); assert.match(rec.review.warnings.join(" "), /cap limits this recovery/);
  confirmed(await f.commit(rec, i.accounts));
  await f.seed("insert into invoices(id,company_id,customer_id,order_id,dispatch_id,invoice_number,invoice_date,subtotal,tax_total,grand_total,status) values(gen_random_uuid(),$1,$2,$3,$4,'INV-NOV10-REC2',current_date,1000,180,1180,'generated')",
    [i.company, i.customer, i.order, i.dispatch2]);
  const second = (await f.db.query("select id from invoices where invoice_number='INV-NOV10-REC2'")).rows[0];
  await assert.rejects(() => f.prepare({ action: "tooling.allocate", id: v2, kind: "recovery", invoice_id: second.id, note }, i.accounts), /cap is already reached/);
  // A die with an active agreement for one customer cannot be amended to another customer.
  await assert.rejects(() => tooling({ customer_id: i.customer2 }), /active agreement with another customer/);
  // Disputes are flagged and resolved explicitly.
  confirmed(await f.apply({ action: "tooling.dispute", id: v2, state: "open", note }, i.salesManager));
  assert.equal((await row("tooling", v2, i.accounts)).status, "disputed");
  await assert.rejects(() => f.prepare({ action: "tooling.dispute", id: v2, state: "open", note }, i.salesManager), /already open/);
  confirmed(await f.apply({ action: "tooling.dispute", id: v2, state: "resolved", note }, i.salesManager));
  assert.equal((await row("tooling", v2, i.accounts)).status, "active");
  // Invalid terms are refused.
  await assert.rejects(() => tooling({ die_id: i.dieBlocked, customer_contribution: 90000 }), /cannot exceed the die charge/);
  await assert.rejects(() => tooling({ die_id: i.dieBlocked, recovery_cap: 46000 }), /cap cannot exceed the contribution after the waiver/);
  await assert.rejects(() => tooling({ die_id: i.dieBlocked, recovery_basis: "none" }), /no recovery has neither/);
  assert.equal((await list("tooling", i.accounts, { state: "active" })).rows.some(r => r.id === v2), true);
});

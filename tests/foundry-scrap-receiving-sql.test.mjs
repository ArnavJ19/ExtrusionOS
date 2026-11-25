import test from "node:test";
import assert from "node:assert/strict";
import { createBatch4Fixture, ids as i } from "../scripts/lib/fs-batch4-fixture.mjs";

// Foundry scrap receiving (migration 20261119180000): scrap types, requests, the three-step receipt, exit attempts
// escalated to the factory manager, the accounts completion that posts the expense, and the rule that purchase money
// on metal sources is written only by owner, admin and accounts. Expected values are worked out by hand.
let f;
test.before(async () => { f = await createBatch4Fixture(); });
test.after(async () => { await f?.close(); });
test.beforeEach(async () => { await f.start(); });
test.afterEach(async () => { await f.rollback(); });

const denied = e => e.code === "42501";
const num = v => (v === null || v === undefined ? v : Number(v));
const one = async (sql, params = []) => (await f.db.query(sql, params)).rows[0];
const rx = (rpc, command, payload, actor) => f.call("ap_scrap_receipt", command, payload, actor);
const checks = { matches_type: true, dry: true, no_iron_steel: true, no_plastic_rubber_wood: true, no_sealed_containers: true, single_alloy: true, clean_surface: true };

/** An object stored in the documents bucket, as the browser upload leaves it. */
async function stored(folder, parent, name = "photo.jpg") {
  const path = `${i.company}/${folder}/${parent}/${f.next()}-${name}`;
  await f.db.query("insert into storage.objects(bucket_id,name) values('documents',$1)", [path]);
  return path;
}
async function photo(receipt, kind = "inspection_photo", actor = i.production) {
  const path = await stored("scrap-receipts", receipt);
  return rx(null, "add_file", { receipt_id: receipt, kind, storage_path: path, file_name: "photo.jpg", mime_type: "image/jpeg", size_bytes: 2048 }, actor);
}
async function typeId(code = "wire") {
  await rx(null, "types", {}, i.production);
  return (await one("select id from foundry_scrap_types where company_id=$1 and code=$2", [i.company, code])).id;
}
async function inspected({ actor = i.production, gross = 12500, tare = 2500, ok = true, extra = {} } = {}) {
  const start = await rx(null, "start", { present: true }, actor);
  await photo(start.id, "inspection_photo", actor);
  if (!ok) await photo(start.id, "rejection_photo", actor);
  const out = await rx(null, "inspect", { receipt_id: start.id, vehicle_number: "MH 12 AB 1234", weighbridge_reference: "WB-7781", gross_kg: gross, tare_kg: tare,
    quality_ok: ok, checklist: checks, ...extra }, actor);
  return { ...start, ...out };
}

test("scrap types: the seven defaults, a receiver adds one, only owner/admin/factory manager switch one off", async () => {
  const t = await rx(null, "types", {}, i.production);
  assert.deepEqual(t.types.map(x => x.code), ["wire", "extrusion", "local_extrusion_with_attachments", "local_extrusion_without_attachments",
    "local_sheet_with_attachments", "local_sheet_without_attachments", "imported"]);
  const added = await rx(null, "add_type", { name: "UBC cans (shredded)" }, i.production);
  assert.equal(added.code, "ubc_cans_shredded");
  const again = await rx(null, "add_type", { name: "ubc cans (shredded)" }, i.productionManager);
  assert.equal(again.id, added.id, "the same name is not added twice");
  await assert.rejects(() => rx(null, "set_type_active", { id: added.id, is_active: false }, i.production), denied);
  await rx(null, "set_type_active", { id: added.id, is_active: false }, i.factory);
  assert.equal((await rx(null, "types", {}, i.production)).types.some(x => x.id === added.id), false);
  await assert.rejects(() => rx(null, "add_type", { name: "Turnings" }, i.sales), denied);
  assert.equal((await rx(null, "types", {}, i.foreign)).types.length, 7, "the other company has its own list");
});

test("scrap request: type, alloy and kg; accounts and the factory manager are told; closing needs a reason", async () => {
  const wire = await typeId("wire");
  const req = await rx(null, "request", { scrap_type_id: wire, alloy: "6063", quantity_kg: 8000, purpose: "Furnace 2 charge for next week" }, i.production);
  assert.match(req.request_number, /SRQ/);
  const notes = (await f.db.query("select recipient_role, title, body from notifications where related_entity_id=$1 order by recipient_role", [req.id])).rows;
  assert.deepEqual(notes.map(n => n.recipient_role), ["accounts", "factory_manager"]);
  assert.match(notes[0].body, /8,000\.000 kg Wire scrap, alloy 6063/);
  await assert.rejects(() => rx(null, "request", { scrap_type_id: wire, alloy: "6063", quantity_kg: 0 }, i.production), /Quantity \(kg\) must be between/);
  await assert.rejects(() => rx(null, "request", { scrap_type_id: wire, alloy: "6063", quantity_kg: 10 }, i.accounts), denied);
  const list = await rx(null, "requests", {}, i.accounts);
  assert.equal(list.total, 1); assert.equal(num(list.rows[0].received_kg), 0);
  await assert.rejects(() => rx(null, "cancel_request", { id: req.id, reason: "short" }, i.production), /at least|10 to 300/);
  await assert.rejects(() => rx(null, "cancel_request", { id: req.id, reason: "Supplier cannot deliver this month" }, i.productionManager), /Only the person who requested/);
  await rx(null, "cancel_request", { id: req.id, reason: "Supplier cannot deliver this month" }, i.factory);
  assert.equal((await rx(null, "requests", { status: "cancelled" }, i.production)).total, 1);
});

test("step 1: someone receiving on the manager's behalf gives name, Indian mobile and reason; one receipt in progress per person", async () => {
  await assert.rejects(() => rx(null, "start", { present: false, proxy_name: "Ramesh Patil", proxy_phone: "12345", proxy_reason: "At the furnace during tapping" }, i.production), /10-digit Indian mobile/);
  await assert.rejects(() => rx(null, "start", { present: false, proxy_name: "Ramesh Patil", proxy_phone: "98220 12345" }, i.production), /Reason you are not at the site is required/);
  await assert.rejects(() => rx(null, "start", {}, i.production), /receiving site/);
  const s = await rx(null, "start", { present: false, proxy_name: "Ramesh Patil", proxy_phone: "098220-12345", proxy_reason: "At the furnace during tapping" }, i.production);
  const row = await one("select proxy_phone, status, receiver_present from foundry_scrap_receipts where id=$1", [s.id]);
  assert.deepEqual([row.proxy_phone, row.status, row.receiver_present], ["+919822012345", "inspection", false]);
  await assert.rejects(() => rx(null, "start", { present: true }, i.production), /still in progress/);
  assert.equal((await rx(null, "current", {}, i.production)).id, s.id);
  assert.equal((await rx(null, "current", {}, i.productionManager)).id, null);
});

test("step 2: photos are required, a failed visual check means 'not of quality', net = gross - tare from the weighbridge", async () => {
  const s = await rx(null, "start", { present: true }, i.production);
  const base = { receipt_id: s.id, vehicle_number: "MH12AB1234", weighbridge_reference: "WB-1", gross_kg: 3000, tare_kg: 1000, quality_ok: true, checklist: checks };
  await assert.rejects(() => rx(null, "inspect", base, i.production), /at least one photo/);
  await assert.rejects(() => photo(s.id, "inspection_photo", i.productionManager), /Only the person receiving/);
  await assert.rejects(() => rx(null, "add_file", { receipt_id: s.id, kind: "inspection_photo", storage_path: `${i.company}/scrap-receipts/${s.id}/${f.next()}-x.jpg`, file_name: "x.jpg", mime_type: "image/jpeg" }, i.production), /not found/);
  await photo(s.id);
  await assert.rejects(() => rx(null, "inspect", { ...base, checklist: { ...checks, dry: false } }, i.production), /visual check failed/);
  await assert.rejects(() => rx(null, "inspect", { ...base, checklist: { dry: true } }, i.production), /every visual check/);
  await assert.rejects(() => rx(null, "inspect", { ...base, gross_kg: 900 }, i.production), /Gross weight must be more/);
  await assert.rejects(() => rx(null, "inspect", { ...base, quality_ok: false, rejection_scope: "partial", rejected_kg: 500, issues: ["iron_steel"], rejection_reason: "Steel bolts in the bundles" }, i.production), /photo showing the quality problem/);
  const out = await rx(null, "inspect", base, i.production);
  assert.deepEqual([num(out.net_kg), num(out.accepted_kg), out.status], [2000, 2000, "details"]);
  const wire = await typeId();
  await assert.rejects(() => rx(null, "complete", { receipt_id: s.id, scrap_type_id: wire, alloy: "6063", readiness: "needs_processing" }, i.production), /processing the scrap needs/);
});

test("happy path: completed receipt makes a money-free lot, alerts accounts, fulfils the request; accounts add the bill and the expense posts", async () => {
  const wire = await typeId("wire");
  const req = await rx(null, "request", { scrap_type_id: wire, alloy: "6063", quantity_kg: 10000 }, i.production);
  const start = await rx(null, "start", { present: true, request_id: req.id }, i.production);
  await photo(start.id);
  await rx(null, "inspect", { receipt_id: start.id, vehicle_number: "MH12AB1234", weighbridge_reference: "WB-7781", gross_kg: 12500, tare_kg: 2500, quality_ok: true, checklist: checks }, i.production);
  const done = await rx(null, "complete", { receipt_id: start.id, scrap_type_id: wire, alloy: "6063", readiness: "ready_to_use" }, i.production);
  assert.equal(num(done.accepted_kg), 10000);
  const lot = await one("select scrap_source, weight_kg, available_weight_kg, rate, total_amount, vendor_id, status, scrap_quality, alloy, weighbridge_reference, expense_ledger_id from foundry_aluminium_scrap where id=$1", [done.accepted_scrap_id]);
  assert.deepEqual([lot.scrap_source, num(lot.weight_kg), num(lot.available_weight_kg), num(lot.rate), num(lot.total_amount), lot.vendor_id, lot.status, lot.scrap_quality, lot.alloy, lot.weighbridge_reference, lot.expense_ledger_id],
    ["incoming", 10000, 10000, 0, 0, null, "available", "clean", "6063", "WB-7781", null]);
  assert.equal((await one("select status from foundry_scrap_requests where id=$1", [req.id])).status, "fulfilled");
  const alert = await one("select recipient_role, title, action_link from notifications where condition_key=$1", [`fsr:receipt:${start.id}`]);
  assert.deepEqual([alert.recipient_role, alert.title, alert.action_link], ["accounts", "New scrap batch received: add the bill", `/foundry/scrap/receipts/${start.id}`]);

  // The floor never sees the money; accounts complete it.
  const floor = await rx(null, "get", { id: start.id }, i.production);
  assert.equal(floor.finance, null); assert.equal(floor.can_finance, false);
  const money = { receipt_id: start.id, vendor_id: i.vendor, invoice_number: "SV/2026/0419", invoice_date: "2026-11-18", rate_per_kg: 182.5, tax_amount: 328500, freight_amount: 4500, discount_amount: 2000 };
  await assert.rejects(() => rx(null, "finance_save", money, i.production), denied);
  await assert.rejects(() => rx(null, "finance_save", money, i.accounts), /Upload the bill first/);
  const billPath = await stored("scrap-receipt-bills", start.id, "bill.pdf");
  await assert.rejects(() => rx(null, "add_file", { receipt_id: start.id, kind: "bill", storage_path: billPath, file_name: "bill.pdf", mime_type: "application/pdf" }, i.production), /uploaded by accounts/);
  await rx(null, "add_file", { receipt_id: start.id, kind: "bill", storage_path: billPath, file_name: "bill.pdf", mime_type: "application/pdf" }, i.accounts);
  const saved = await rx(null, "finance_save", money, i.accounts);
  assert.equal(saved.finance_status, "completed");
  const posted = await one("select s.rate, s.base_amount, s.total_amount, s.vendor_id, e.total_amount expense_total, e.approval_status, e.invoice_number from foundry_aluminium_scrap s join expense_ledger e on e.id=s.expense_ledger_id where s.id=$1", [done.accepted_scrap_id]);
  // 10,000 kg x 182.50 = 18,25,000 + GST 3,28,500 + freight 4,500 - discount 2,000 = 21,56,000.
  assert.deepEqual([num(posted.rate), num(posted.base_amount), num(posted.expense_total), posted.vendor_id, posted.approval_status, posted.invoice_number],
    [182.5, 1825000, 2156000, i.vendor, "pending_approval", "SV/2026/0419"]);
  assert.ok((await one("select resolved_at from notifications where condition_key=$1", [`fsr:receipt:${start.id}`])).resolved_at, "the accounts alert is resolved");
  const view = await rx(null, "get", { id: start.id }, i.accounts);
  assert.equal(view.finance.vendor_id, i.vendor); assert.equal(num(view.finance.expense.total_amount), 2156000);
  assert.equal(view.files.some(x => x.kind === "bill"), true);
  assert.equal((await rx(null, "get", { id: start.id }, i.production)).files.some(x => x.kind === "bill"), false, "bills are not shown to the floor");
  assert.equal((await rx(null, "finance_queue", {}, i.accounts)).total, 0);
  await assert.rejects(() => rx(null, "get", { id: start.id }, i.foreign), /not found/);
});

test("partial rejection: accepted and rejected lots; all rejected leaves one rejected lot and nothing available", async () => {
  const ext = await typeId("local_extrusion_with_attachments");
  const part = await inspected({ ok: false, gross: 6000, tare: 1000, extra: { rejection_scope: "partial", rejected_kg: 750, issues: ["iron_steel", "plastic_rubber_wood"], rejection_reason: "Steel screws and EPDM gaskets in about 750 kg" } });
  assert.equal(num(part.accepted_kg), 4250);
  const done = await rx(null, "complete", { receipt_id: part.id, scrap_type_id: ext, alloy: "6063", readiness: "needs_processing", processing_steps: ["removing_attachments", "sorting"] }, i.production);
  const lots = (await f.db.query("select status, weight_kg, scrap_quality from foundry_aluminium_scrap where scrap_receipt_id=$1 order by weight_kg desc", [part.id])).rows;
  assert.deepEqual(lots.map(l => [l.status, num(l.weight_kg), l.scrap_quality]), [["available", 4250, "segregation_required"], ["rejected", 750, "rejected"]]);
  assert.ok(done.rejected_scrap_id);

  const all = await inspected({ actor: i.productionManager, ok: false, gross: 3000, tare: 1000, extra: { rejection_scope: "all", issues: ["mixed_alloy"], rejection_reason: "Mixed 7xxx alloy, not usable for 6063" } });
  assert.equal(num(all.accepted_kg), 0);
  await assert.rejects(() => rx(null, "complete", { receipt_id: all.id, scrap_type_id: ext, alloy: "6063", readiness: "ready_to_use", scrap_quality: "contaminated" }, i.productionManager), /needs processing before use/);
  const out = await rx(null, "complete", { receipt_id: all.id, scrap_type_id: ext, alloy: "6063", readiness: "needs_processing", processing_steps: ["sorting"] }, i.productionManager);
  assert.equal(out.accepted_scrap_id, null);
  assert.deepEqual((await f.db.query("select status, weight_kg from foundry_aluminium_scrap where scrap_receipt_id=$1", [all.id])).rows.map(l => [l.status, num(l.weight_kg)]), [["rejected", 2000]]);
});

test("exit after step 1: four refusals, the fifth needs a reason and alerts the factory manager, who alone lets the receiver leave", async () => {
  const s = await rx(null, "start", { present: true }, i.production);
  for (let n = 1; n <= 4; n += 1) {
    const out = await rx(null, "abort", { receipt_id: s.id }, i.production);
    assert.deepEqual([out.allowed, out.attempts, out.remaining], [false, n, 5 - n]);
  }
  const ask = await rx(null, "abort", { receipt_id: s.id }, i.production);
  assert.deepEqual([ask.needs_reason, ask.attempts], [true, 4], "the fifth attempt is counted once the reason is given");
  assert.equal((await one("select count(*)::int n from notifications where related_entity_id=$1 and recipient_role='factory_manager'", [s.id])).n, 0);
  const esc = await rx(null, "abort", { receipt_id: s.id, reason: "Called to the press for a die failure" }, i.production);
  assert.deepEqual([esc.escalated, esc.attempts], [true, 5]);
  const alert = await one("select severity, title, body from notifications where related_entity_id=$1 and recipient_role='factory_manager'", [s.id]);
  assert.equal(alert.severity, "critical"); assert.match(alert.body, /5 times\. Reason: Called to the press/);
  assert.equal((await rx(null, "abort", { receipt_id: s.id }, i.production)).pending, true);
  await assert.rejects(() => rx(null, "decide_exit", { receipt_id: s.id, decision: "approved", reason: "Die failure on press 2" }, i.owner), denied);
  await assert.rejects(() => rx(null, "decide_exit", { receipt_id: s.id, decision: "approved", reason: "ok" }, i.factory), /10 to 300/);
  // Refused: the receiver continues, and must escalate again to leave.
  await rx(null, "decide_exit", { receipt_id: s.id, decision: "declined", reason: "Finish the weighing first, the truck is waiting" }, i.factory);
  assert.equal((await rx(null, "abort", { receipt_id: s.id }, i.production)).needs_reason, true);
  await rx(null, "abort", { receipt_id: s.id, reason: "Die failure again, press 2 is stopped" }, i.production);
  const ok = await rx(null, "decide_exit", { receipt_id: s.id, decision: "approved", reason: "Press 2 breakdown needs the manager; Ramesh will receive" }, i.factory);
  assert.equal(ok.decision, "approved");
  const row = await one("select status, exit_request_reason, exit_decision_reason, abort_attempts from foundry_scrap_receipts where id=$1", [s.id]);
  assert.deepEqual([row.status, row.exit_request_reason, row.abort_attempts], ["exited", "Die failure again, press 2 is stopped", 6]);
  assert.match(row.exit_decision_reason, /Press 2 breakdown/);
  assert.equal((await one("select count(*)::int n from foundry_aluminium_scrap where scrap_receipt_id=$1", [s.id])).n, 0, "no scrap is recorded");
  assert.equal((await one("select count(*)::int n from notifications where recipient_user_id=$1 and related_entity_id=$2", [i.production, s.id])).n, 2);
  assert.ok((await rx(null, "start", { present: true }, i.production)).id, "the receiver can start a new receipt");
});

test("purchase money on metal sources is written by accounts only; floor-recorded external sources queue for accounts", async () => {
  const done = await inspected();
  const c = await rx(null, "complete", { receipt_id: done.id, scrap_type_id: await typeId(), alloy: "6063", readiness: "ready_to_use" }, i.production);
  await assert.rejects(() => f.asUser("update foundry_aluminium_scrap set rate=150 where id=$1", [c.accepted_scrap_id], i.productionManager), /changed by accounts/);
  await assert.rejects(() => f.asUser("update foundry_aluminium_scrap set vendor_id=$2 where id=$1", [c.accepted_scrap_id, i.vendor], i.productionManager), /changed by accounts/);
  await f.asUser("update foundry_aluminium_scrap set notes='Stacked in bay 3' where id=$1", [c.accepted_scrap_id], i.productionManager);

  const src = f.next();
  await assert.rejects(() => f.asUser(`insert into foundry_external_aluminium_sources(id,company_id,source_number,item_type,weight_kg,quantity,source_origin,rate,unit)
    values($1,$2,'EAS-T-1','aluminum_ingot',2000,80,'Hindalco Renukoot',230,'kg')`, [src, i.company], i.productionManager), /entered by accounts/);
  await f.asUser(`insert into foundry_external_aluminium_sources(id,company_id,source_number,item_type,weight_kg,quantity,source_origin,unit,alloy)
    values($1,$2,'EAS-T-1','aluminum_ingot',2000,80,'Hindalco Renukoot','kg','6063')`, [src, i.company], i.productionManager);
  assert.equal((await one("select finance_status from foundry_external_aluminium_sources where id=$1", [src])).finance_status, "pending");
  assert.match((await one("select body from notifications where condition_key=$1", [`fsr:source:${src}`])).body, /^EAS-[0-9-]+: 2,000\.000 kg aluminum ingot alloy 6063\./);
  const queue = await rx(null, "finance_queue", {}, i.accounts);
  assert.deepEqual(queue.rows.map(r => r.kind).sort(), ["external_source", "scrap_receipt"]);
  const money = { source_id: src, vendor_id: i.vendor, invoice_number: "HIL/88123", invoice_date: "2026-11-17", rate_per_kg: 240, tax_amount: 86400 };
  await assert.rejects(() => rx(null, "source_finance_save", money, i.accounts), /Upload the bill first/);
  const bill = await stored("scrap-receipt-bills", src, "bill.pdf");
  await rx(null, "add_file", { external_source_id: src, kind: "bill", storage_path: bill, file_name: "bill.pdf", mime_type: "application/pdf" }, i.accounts);
  await rx(null, "source_finance_save", money, i.accounts);
  const posted = await one("select s.finance_status, e.total_amount from foundry_external_aluminium_sources s join expense_ledger e on e.id=s.expense_ledger_id where s.id=$1", [src]);
  assert.deepEqual([posted.finance_status, num(posted.total_amount)], ["completed", 566400], "2,000 kg x 240 + GST 86,400");
  assert.equal((await rx(null, "finance_queue", {}, i.accounts)).total, 1);
});

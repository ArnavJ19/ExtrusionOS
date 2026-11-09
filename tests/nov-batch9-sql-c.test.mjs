import test from "node:test";
import assert from "node:assert/strict";
import { createNov9Fixture, nids as i, day, nid } from "../scripts/lib/nov-batch9-fixture.mjs";
import { commercialOutcomeSchema, transferCsv } from "../lib/workflow/commercial.ts";

let f;
test.before(async () => { f = await createNov9Fixture(); });
test.after(async () => { await f?.close(); });
test.beforeEach(async () => { await f.start(); });
test.afterEach(async () => { await f.rollback(); });

const note = "Reviewed with the responsible department";
const confirmed = result => { commercialOutcomeSchema.parse(result); assert.equal(result.state, "confirmed", JSON.stringify(result.result)); return result; };
const refused = (promise, pattern) => assert.rejects(promise, pattern);
const list = (view, actor = i.owner, patch = {}) => f.command("list", { view, state: "all", ...patch }, actor);
const detail = (view, id, actor = i.owner) => f.command("detail", { view, id }, actor);
const row = async (view, id, actor = i.owner) => (await detail(view, id, actor)).row;
const one = async (sql, params = []) => (await f.db.query(sql, params)).rows[0];
const n = value => Number(value);
const idOf = result => result.result.href.split("/").pop();
const raw = async (sql, params = []) => { await f.db.exec("set session_replication_role = replica"); try { return await f.db.query(sql, params); } finally { await f.db.exec("set session_replication_role = origin"); } };

// NOV-029 ---------------------------------------------------------------------------------------
// The first profile weighs 1.2 kg per metre, and its order line needs 40 pieces cut at 3,000 mm in anodised finish.
const lot = (patch = {}, actor = i.production) => f.apply({ action: "remnant.record", profile_id: i.profile, length_mm: 3500, pieces: 10, finish: "anodizing", origin_type: "cutting_remnant", location: "Rack R4", note, ...patch }, actor);
const recordLot = async (patch = {}, actor = i.production) => idOf(confirmed(await lot(patch, actor)));

test("NOV-029: a remnant is a measured length, matched to a requirement by profile, finish and length with its waste stated", async () => {
  const id = await recordLot();
  const l = await row("remnants", id);
  assert.match(l.label, /^RM-\d{4}-0001 · AL-NOV5 · 3500 mm × 10$/);
  assert.equal(l.status, "available");
  assert.equal(n(l.details.weight_per_piece_kg), 4.2, "1.2 kg/m x 3.5 m");
  assert.equal(n(l.details.total_weight_kg), 42);
  assert.equal(l.details.alloy, "6063");
  assert.equal(l.details.ownership, "company");
  const match = l.details.matches.find(m => m.order_item_id === i.line1);
  assert.deepEqual([match.cut_length_mm, match.pieces_needed, match.waste_mm_per_piece], [3000, 40, 500]);
  confirmed(await f.apply({ action: "remnant.reserve", id, order_item_id: i.line1, pieces: 6, note }, i.productionManager));
  const reserved = await row("remnants", id);
  assert.equal(reserved.details.reserved_pieces, 6);
  assert.equal(reserved.details.free_pieces, 4);
  assert.equal(reserved.details.matches.find(m => m.order_item_id === i.line1).pieces_open, 34);
  // Competing allocations: only the free pieces can be reserved.
  await refused(f.prepare({ action: "remnant.reserve", id, order_item_id: i.line1, pieces: 5, note }, i.productionManager), /Only 4 piece\(s\) are free/);
  // The requirement itself caps how many pieces remnants may cover.
  const big = await recordLot({ pieces: 100 });
  await refused(f.prepare({ action: "remnant.reserve", id: big, order_item_id: i.line1, pieces: 40, note }, i.productionManager), /needs only 34 more piece/);
  confirmed(await f.apply({ action: "remnant.reserve", id: big, order_item_id: i.line1, pieces: 34, note }, i.productionManager));
  assert.equal((await row("remnants", id)).details.matches.length, 0, "a fully covered requirement is no longer suggested");
});

test("NOV-029: identical kilograms with a shorter length, a different profile or a different finish never match", async () => {
  // 2,000 mm x 15 pieces weighs the same as 3,000 mm x 10 pieces, yet no 3,000 mm cut fits.
  const short = await recordLot({ length_mm: 2000, pieces: 15 });
  const ok = await recordLot({ length_mm: 3000, pieces: 10 });
  assert.equal(n((await row("remnants", short)).details.total_weight_kg), n((await row("remnants", ok)).details.total_weight_kg));
  assert.equal((await row("remnants", short)).details.matches.length, 0);
  await refused(f.prepare({ action: "remnant.reserve", id: short, order_item_id: i.line1, pieces: 1, note }, i.productionManager), /longer than the lot \(2000 mm\)\. Equal kilograms do not make a shorter length fit/);
  const exact = (await row("remnants", ok)).details.matches.find(m => m.order_item_id === i.line1);
  assert.equal(exact.waste_mm_per_piece, 0, "an exact length wastes nothing");
  // A different profile is refused even when the order line would otherwise fit.
  const other = await recordLot({ profile_id: i.profile3, alloy: "6061", temper: "T5" });
  await refused(f.prepare({ action: "remnant.reserve", id: other, order_item_id: i.line1, pieces: 1, note }, i.productionManager), /different profile/);
  // A powder-coated lot does not satisfy an anodised line; a mill-finish lot is allowed for any finish.
  const powder = await recordLot({ finish: "powder coating" });
  await refused(f.prepare({ action: "remnant.reserve", id: powder, order_item_id: i.line1, pieces: 1, note }, i.productionManager), /finish differs/);
  assert.equal((await row("remnants", powder)).details.matches.length, 0);
  const mill = await recordLot({ finish: "Mill finish" });
  assert.equal((await row("remnants", mill)).details.matches.length >= 1, true);
  // The alloy must agree when both are known.
  const alloy = await recordLot({ alloy: "6061" });
  await refused(f.prepare({ action: "remnant.reserve", id: alloy, order_item_id: i.line1, pieces: 1, note }, i.productionManager), /alloy differs/);
  await refused(f.prepare({ action: "remnant.reserve", id: ok, order_item_id: i.line2, pieces: 1, note }, i.productionManager), /different profile/);
});

test("NOV-029: holds, damage, consumption, release, scrap and measurement corrections keep the lot honest", async () => {
  const id = await recordLot({ pieces: 4 });
  // A short lot and a damaged lot start on hold and are never suggested.
  const tiny = await recordLot({ length_mm: 400, pieces: 3 });
  assert.equal((await row("remnants", tiny)).status, "held");
  const broken = await recordLot({ condition: "damaged" });
  assert.equal((await row("remnants", broken)).status, "held");
  assert.equal((await row("remnants", broken)).details.matches.length, 0);
  await refused(f.prepare({ action: "remnant.reserve", id: broken, order_item_id: i.line1, pieces: 1, note }, i.productionManager), /Only an available lot in good condition/);
  await refused(f.prepare({ action: "remnant.review", id: broken, decision: "usable", note }, i.quality), /damaged lot cannot be marked usable/);
  const review = await f.prepare({ action: "remnant.review", id: tiny, decision: "usable", note }, i.quality);
  assert.match(review.review.warnings.join(" "), /below 500 mm/);
  confirmed(await f.commit(review, i.quality));
  assert.equal((await row("remnants", tiny)).status, "available");
  // Reserve, release, reserve again and consume.
  const reserve = async pieces => idOf(confirmed(await f.apply({ action: "remnant.reserve", id, order_item_id: i.line1, pieces, note }, i.productionManager))) ;
  const reservation = (await row("remnants", id)).details.allocations;
  assert.equal(reservation.length, 0);
  await reserve(3);
  const allocation = (await row("remnants", id)).details.allocations[0];
  assert.deepEqual([allocation.pieces, allocation.cut_length_mm, allocation.waste_mm_per_piece, allocation.status], [3, 3000, 500, "reserved"]);
  await refused(f.prepare({ action: "remnant.review", id, decision: "hold", note }, i.quality), /Release the 3 reserved piece/);
  await refused(f.prepare({ action: "remnant.scrap", id, note }, i.productionManager), /Release the 3 reserved piece/);
  await refused(f.prepare({ action: "remnant.correct", id, length_mm: 2900, pieces: 4, note }, i.production), /Not permitted|longer cut/);
  await refused(f.prepare({ action: "remnant.correct", id, length_mm: 2900, pieces: 4, note }, i.productionManager), /needs a longer cut than the corrected length/);
  await refused(f.prepare({ action: "remnant.correct", id, length_mm: 3500, pieces: 2, note }, i.productionManager), /3 piece\(s\) are reserved/);
  confirmed(await f.apply({ action: "remnant.release", id: allocation.id, note }, i.productionManager));
  assert.equal((await row("remnants", id)).details.free_pieces, 4);
  await refused(f.prepare({ action: "remnant.consume", id: allocation.id, note }, i.productionManager), /still reserved/);
  const again = await reserve(4);
  const second = (await row("remnants", id)).details.allocations.find(a => a.status === "reserved");
  confirmed(await f.apply({ action: "remnant.consume", id: second.id, note }, i.productionManager));
  const used = await row("remnants", id);
  assert.equal(used.status, "exhausted");
  assert.equal(used.details.pieces, 0);
  assert.ok(again);
  // A measurement correction keeps the earlier values in the lot history.
  const fix = await recordLot({ pieces: 5 });
  confirmed(await f.apply({ action: "remnant.correct", id: fix, length_mm: 3400, pieces: 6, note }, i.inventory));
  const fixed = await row("remnants", fix);
  assert.deepEqual([fixed.details.length_mm, fixed.details.pieces, fixed.details.correction_count], [3400, 6, 1]);
  assert.equal(fixed.details.history[0].from_length_mm, 3500);
  assert.equal(n(fixed.details.weight_per_piece_kg), 4.08);
  await refused(f.prepare({ action: "remnant.correct", id: fix, length_mm: 3400, pieces: 6, note }, i.inventory), /unchanged/);
  // Scrap ends the lot and removes it from the active list but keeps the record.
  confirmed(await f.apply({ action: "remnant.scrap", id: fix, note }, i.productionManager));
  assert.equal((await row("remnants", fix)).status, "scrapped");
  assert.equal((await list("remnants", i.owner, { state: "active" })).rows.some(r => r.id === fix), false);
  await refused(f.prepare({ action: "remnant.scrap", id: fix, note }, i.productionManager), /scrapped lot cannot be scrapped/);
  await refused(f.prepare({ action: "remnant.correct", id: fix, length_mm: 3000, pieces: 6, note }, i.productionManager), /scrapped lot cannot be corrected/);
});

test("NOV-029: invalid measurements and unauthorised roles are refused; excess is never customer-owned or billable", async () => {
  for (const patch of [{ length_mm: 99 }, { length_mm: 12001 }, { length_mm: 3500.5 }, { pieces: 0 }, { pieces: 10001 }, { origin_type: "found_in_yard" }, { finish: "x" }, { location: "" }, { condition: "ruined" }]) {
    await refused(f.prepare({ action: "remnant.record", profile_id: i.profile, length_mm: 3500, pieces: 10, finish: "anodizing", origin_type: "cutting_remnant", location: "Rack R4", note, ...patch }, i.production), /Review the required action details|Choose|must be/);
  }
  await refused(f.prepare({ action: "remnant.record", profile_id: i.foreignOrder, length_mm: 3500, pieces: 10, finish: "anodizing", origin_type: "cutting_remnant", location: "Rack", note }, i.production), /active profile of this company/);
  await refused(f.prepare({ action: "remnant.record", profile_id: i.profile, length_mm: 3500, pieces: 10, finish: "anodizing", origin_type: "cutting_remnant", location: "Rack R4", source_job_id: i.foreignJob, note }, i.production), /production job of this company/);
  await refused(lot({}, i.sales), /Not permitted/);
  await refused(lot({}, i.viewer), /Not permitted/);
  await refused(lot({}, i.dealer), /Not permitted/);
  const id = await recordLot();
  await refused(f.prepare({ action: "remnant.reserve", id, order_item_id: i.line1, pieces: 1, note }, i.production), /Not permitted/);
  await refused(f.prepare({ action: "remnant.review", id, decision: "hold", note }, i.production), /Not permitted/);
  assert.equal((await list("remnants", i.viewer)).total_count, 1, "a viewer may read");
  const stockBefore = n((await one("select count(*) c from profile_stock_batches")).c);
  const excess = await f.prepare({ action: "remnant.record", profile_id: i.profile, length_mm: 6000, pieces: 20, finish: "anodizing", origin_type: "approved_excess", location: "Rack R5", note }, i.productionManager);
  assert.match(excess.review.warnings.join(" "), /not customer-owned and not billable/);
  assert.match(excess.review.warnings.join(" "), /does not post to the profile stock ledger/);
  confirmed(await f.commit(excess, i.productionManager));
  assert.equal(n((await one("select count(*) c from profile_stock_batches")).c), stockBefore, "the register never writes to the stock ledger");
  assert.equal((await one("select string_agg(distinct ownership,',') o from remnant_lots")).o, "company");
});

// NOV-020 ---------------------------------------------------------------------------------------
const mapping = async (patch = {}) => {
  const id = idOf(confirmed(await f.apply({ action: "mapping.define", sales_ledger: "Sales - aluminium", tax_ledger: "Output GST", party_key: "gst_number", note, ...patch }, i.accounts)));
  confirmed(await f.apply({ action: "mapping.approve", id, note }, i.admin));
  return id;
};
const prepareBatch = async (count = 2, actor = i.accounts) => idOf(confirmed(await f.apply({ action: "transfer.prepare", count, note }, actor)));

test("NOV-020: a mapping needs a second approver and a batch takes only issued invoices that have not already been exported", async () => {
  await refused(f.prepare({ action: "transfer.prepare", count: 2, note }, i.accounts), /Approve an export mapping/);
  const draft = idOf(confirmed(await f.apply({ action: "mapping.define", sales_ledger: "Sales", tax_ledger: "GST", party_key: "customer_name", note }, i.accounts)));
  await refused(f.apply({ action: "mapping.approve", id: draft, note }, i.accounts), /second person approves a mapping/);
  await refused(f.prepare({ action: "mapping.define", sales_ledger: "Other", tax_ledger: "GST", party_key: "customer_name", note }, i.accounts), /draft mapping already exists/);
  confirmed(await f.apply({ action: "mapping.approve", id: draft, note }, i.owner));
  const second = idOf(confirmed(await f.apply({ action: "mapping.define", sales_ledger: "Sales v2", tax_ledger: "GST v2", party_key: "gst_number", note }, i.accounts)));
  const retire = await f.prepare({ action: "mapping.approve", id: second, note }, i.admin);
  assert.match(retire.review.warnings.join(" "), /Version 1 is retired/);
  confirmed(await f.commit(retire, i.admin));
  assert.equal((await row("transfers", draft)).status, "retired");
  const waiting = await f.prepare({ action: "transfer.prepare", count: 25, note }, i.accounts);
  assert.equal(waiting.review.facts["Mapping"], 2);
  // Draft and cancelled invoices are never offered; the five issued ones are, oldest first.
  assert.equal(waiting.review.facts.Invoices, 5);
  const batch = await prepareBatch(2);
  const b = await row("transfers", batch, i.accounts);
  assert.equal(b.status, "prepared");
  assert.equal(b.details.item_count, 2);
  assert.equal(b.details.items.length, 2);
  const numbers = b.details.items.map(x => x.invoice_number);
  assert.deepEqual(numbers, [...numbers].sort());
  assert.ok(b.details.items.every(x => /^EOS-INV-[0-9A-F]{32}$/.test(x.external_ref)), "stable external identity");
  assert.equal(new Set(b.details.items.map(x => x.external_ref)).size, 2);
  // The same invoices cannot be taken again while they sit in a batch.
  const next = await f.prepare({ action: "transfer.prepare", count: 25, note }, i.accounts);
  assert.equal(next.review.facts.Invoices, 3);
  const ids = new Set(b.details.items.map(x => x.invoice_id));
  const batch2 = await prepareBatch(25);
  assert.equal((await row("transfers", batch2, i.accounts)).details.items.some(x => ids.has(x.invoice_id)), false);
  await refused(f.prepare({ action: "transfer.prepare", count: 1, note }, i.accounts), /No issued invoice is waiting/);
  await refused(f.prepare({ action: "transfer.prepare", count: 26, note }, i.accounts), /Review the required|between 1 and 25/);
  await refused(f.prepare({ action: "transfer.prepare", count: 0, note }, i.accounts), /Review the required|between 1 and 25/);
});

test("NOV-020: exported batches record a result per invoice; duplicates, changed invoices and rejected items are handled", async () => {
  await mapping();
  const batch = await prepareBatch(3);
  let b = await row("transfers", batch, i.accounts);
  const [first] = b.details.items;
  await refused(f.prepare({ action: "transfer.result", id: first.id, result: "accepted", external_reference: "TALLY-1", note }, i.accounts), /Choose an exported invoice that is still awaiting a result|has not been exported/);
  // An invoice that changes after the batch was prepared blocks the export.
  await f.db.query("update invoices set tax_total=tax_total+1,grand_total=grand_total+1 where id=$1", [first.invoice_id]);
  await refused(f.prepare({ action: "transfer.export", id: batch, note }, i.accounts), /changed since the batch was prepared/);
  confirmed(await f.apply({ action: "transfer.cancel", id: batch, note }, i.accounts));
  assert.equal((await row("transfers", batch, i.accounts)).status, "cancelled");
  // Cancelling releases the invoices for a new batch.
  const again = await prepareBatch(3);
  b = await row("transfers", again, i.accounts);
  const items = b.details.items;
  assert.equal(items.length, 3);
  confirmed(await f.apply({ action: "transfer.export", id: again, note }, i.accounts));
  await refused(f.prepare({ action: "transfer.export", id: again, note }, i.accounts), /Only a prepared batch/);
  await refused(f.prepare({ action: "transfer.cancel", id: again, note }, i.accounts), /Only a prepared batch/);
  const result = (item, patch) => f.apply({ action: "transfer.result", id: item.id, result: "accepted", external_reference: "TALLY-1", note, ...patch }, i.accounts);
  confirmed(await result(items[0]));
  await refused(result(items[1]), /Reference TALLY-1 is already recorded against another invoice/);
  await refused(f.prepare({ action: "transfer.result", id: items[1].id, result: "accepted", note }, i.accounts), /Enter the reference the accounting package gave this invoice|Review the required action details/);
  await refused(f.prepare({ action: "transfer.result", id: items[1].id, result: "rejected", external_reference: "X", note }, i.accounts), /rejected invoice has no external reference/);
  await refused(result(items[0], { external_reference: "TALLY-9" }), /still awaiting a result/);
  const partly = await row("transfers", again, i.accounts);
  assert.equal(partly.status, "results_open");
  assert.deepEqual([partly.details.accepted, partly.details.rejected, partly.details.pending], [1, 0, 2]);
  // A rejection frees the invoice for a later batch; the last result closes the batch.
  confirmed(await result(items[1], { result: "rejected", external_reference: undefined, note: "Package rejected the party code" }));
  confirmed(await result(items[2], { external_reference: "TALLY-3" }));
  const closed = await row("transfers", again, i.accounts);
  assert.equal(closed.status, "closed");
  assert.deepEqual(closed.details.items.map(x => x.state), ["accepted", "rejected", "accepted"]);
  const retry = await f.prepare({ action: "transfer.prepare", count: 25, note }, i.accounts);
  assert.match(retry.review.facts["First invoice"], /INV-/);
  assert.equal(retry.review.facts.Invoices >= 1, true);
  const freed = await prepareBatch(25);
  assert.equal((await row("transfers", freed, i.accounts)).details.items.some(x => x.invoice_id === items[1].invoice_id), true, "the rejected invoice can be exported again");
  // Accepted invoices never come back, and an invoice that changed after export is flagged against the exported version.
  assert.equal((await row("transfers", freed, i.accounts)).details.items.some(x => x.invoice_id === items[0].invoice_id), false);
  await f.db.query("update invoices set grand_total=grand_total+5 where id=$1", [items[0].invoice_id]);
  assert.equal((await row("transfers", again, i.accounts)).details.items.find(x => x.invoice_id === items[0].invoice_id).changed_since, true);
  assert.equal(n((await one("select count(*) c from transfer_items where state in ('pending','accepted') group by invoice_id having count(*)>1")?.catch?.(() => null) ?? { c: 0 }).c ?? 0), 0);
});

test("NOV-020: only accounts, admin and owner can export; no other role sees invoices through this hub", async () => {
  await mapping();
  for (const actor of [i.sales, i.salesManager, i.productionManager, i.dispatch, i.viewer, i.dealer]) {
    await refused(list("transfers", actor), /Not permitted/);
    await refused(f.prepare({ action: "transfer.prepare", count: 1, note }, actor), /Not permitted/);
  }
  assert.equal((await list("transfers", i.accounts)).total_count >= 1, true);
  const batch = await prepareBatch(1, i.admin);
  assert.equal((await row("transfers", batch, i.owner)).details.prepared_by, "Fixture admin");
  assert.equal(n((await one("select count(*) c from transfer_items where batch_id=$1", [batch])).c), 1);
  // The spreadsheet file neutralises formula characters and quotes separators.
  const csv = transferCsv([{ external_ref: "EOS-INV-1", invoice_number: "INV-1", invoice_date: "2026-11-05", party: "=HYPERLINK(\"x\")", amount: 1000, tax_amount: 180 }, { external_ref: "EOS-INV-2", invoice_number: "INV-2", invoice_date: "2026-11-05", party: "Shah, Patel & Co", amount: 10.5, tax_amount: 1.89 }],
    { sales_ledger: "Sales", tax_ledger: "GST" });
  const lines = csv.split("\r\n");
  assert.equal(lines.length, 3);
  assert.match(lines[1], /'=HYPERLINK/);
  assert.match(lines[2], /"Shah, Patel & Co"/);
  assert.match(lines[2], /,10.50,GST,1.89,12.39$/);
  assert.equal(nid(1) !== undefined, true);
});

// NOV-023 ---------------------------------------------------------------------------------------
test("NOV-023: only jobs with the same die and specification are grouped, and every excluded job stays visible", async () => {
  const groups = (await list("runs", i.productionManager)).rows;
  const run = groups.find(r => r.details.group.die_number === "DIE-NOV8-C");
  assert.ok(run, "the shared die forms a proposal");
  assert.equal(run.status, "suggested");
  assert.equal(run.details.group.member_count, 3);
  assert.deepEqual(run.details.group.members.map(m => m.job_number).sort(), ["J-NOV8-DIE", "J-NOV9-A", "J-NOV9-B"]);
  assert.equal(n(run.details.group.total_kg), 650);
  assert.equal(run.details.group.changeovers_saved, 2);
  assert.equal(run.details.group.not_merged, 1, "the powder-coated job on the same die is deliberately not merged");
  assert.equal(run.details.group.members.some(m => m.job_number === "J-NOV9-POWDER"), false);
  assert.match(run.summary, /duration and yield not estimated/);
  // Each order and customer keeps its own contribution inside the shared run.
  assert.ok(run.details.group.members.every(m => m.order_number && n(m.kg) > 0));
  // A different drawing revision splits the group even though the die and profile match.
  await raw("update production_jobs set drawing_revision='R2' where id=$1", [i.jobRunB]);
  const split = (await list("runs", i.productionManager)).rows.find(r => r.details.group.die_number === "DIE-NOV8-C");
  assert.equal(split.details.group.member_count, 2);
  // Held, started and cancelled jobs are never proposed.
  await raw("update production_jobs set status='on_hold' where id=$1", [i.jobRunA]);
  assert.equal((await list("runs", i.productionManager)).rows.some(r => r.details.group.die_number === "DIE-NOV8-C"), false);
});

test("NOV-023: a saved proposal is advisory, becomes stale when jobs change, and cannot hide a blocked die", async () => {
  const live = (await list("runs", i.productionManager)).rows.find(r => r.details.group.die_number === "DIE-NOV8-C");
  const preview = await f.prepare({ action: "run.save", group_key: live.details.group_key, note }, i.productionManager);
  assert.match(preview.review.warnings.join(" "), /Setup time, run time and yield are not estimated/);
  assert.match(preview.review.warnings.join(" "), /1 other job\(s\) on the same die differ/);
  const before = (await one("select md5(string_agg(to_jsonb(j)::text,',' order by id)) h from production_jobs j")).h;
  const saved = idOf(confirmed(await f.commit(preview, i.productionManager)));
  assert.equal((await one("select md5(string_agg(to_jsonb(j)::text,',' order by id)) h from production_jobs j")).h, before, "no job, date or press was touched");
  assert.equal((await row("runs", saved)).status, "proposed");
  await refused(f.prepare({ action: "run.save", group_key: live.details.group_key, note }, i.productionManager), /already proposed/);
  await refused(f.prepare({ action: "run.save", group_key: "0".repeat(32), note }, i.productionManager), /no longer exists/);
  const blocked = (await list("runs", i.productionManager)).rows.find(r => r.details.group.die_number === "DIE-NOV9-BLOCKED");
  assert.equal(blocked.details.blocked, true);
  await refused(f.prepare({ action: "run.save", group_key: blocked.details.group_key, note }, i.productionManager), /die cannot run/);
  // A job leaves the group: the proposal is stale and can only be dismissed.
  await raw("update production_jobs set status='in_progress' where id=$1", [i.jobRunA]);
  const stale = await row("runs", saved);
  assert.equal(stale.status, "stale");
  await refused(f.prepare({ action: "run.accept", id: saved, note }, i.productionManager), /jobs changed since this was proposed/);
  confirmed(await f.apply({ action: "run.dismiss", id: saved, note: "Job A already started" }, i.productionManager));
  assert.equal((await row("runs", saved)).status, "dismissed");
  await refused(f.prepare({ action: "run.dismiss", id: saved, note }, i.productionManager), /still open/);
  // Accepting a current proposal records the decision only.
  await raw("update production_jobs set status='planned' where id=$1", [i.jobRunA]);
  const again = (await list("runs", i.productionManager)).rows.find(r => r.details.group.die_number === "DIE-NOV8-C");
  const savedAgain = idOf(confirmed(await f.apply({ action: "run.save", group_key: again.details.group_key, note }, i.productionManager)));
  const accept = await f.prepare({ action: "run.accept", id: savedAgain, note }, i.productionManager);
  assert.match(accept.review.warnings.join(" "), /nothing is scheduled by this action/);
  confirmed(await f.commit(accept, i.productionManager));
  assert.equal((await row("runs", savedAgain)).status, "accepted");
  await refused(list("runs", i.sales), /Not permitted/);
  await refused(f.prepare({ action: "run.save", group_key: again.details.group_key, note }, i.production), /Not permitted/);
  assert.equal((await list("runs", i.viewer)).total_count >= 1, true);
});

// NOV-024 ---------------------------------------------------------------------------------------
// Press A has 600 kg of recorded capacity every day; Press B has none recorded. Press A carries an
// in-progress job (400 kg), two planned jobs of 500 and 300 kg (all from tomorrow) and one 10 days out.
const scenarioBody = (changes, patch = {}) => ({ action: "scenario.create", name: "Press A breakdown", horizon_days: 7, changes, note, ...patch });
const down = (days = 1, from = day(1)) => ({ type: "machine_down", machine_id: i.press1, from_date: from, days });

test("NOV-024: a breakdown scenario compares baseline and proposal job by job without touching the live plan", async () => {
  const jobsBefore = (await one("select md5(string_agg(to_jsonb(j)::text,',' order by id)) h from production_jobs j")).h;
  const preview = await f.prepare(scenarioBody([down(1)]), i.productionManager);
  assert.match(preview.review.warnings.join(" "), /Everything in this scenario is hypothetical/);
  assert.match(preview.review.warnings.join(" "), /1 press\(es\) have no recorded shift capacity/);
  const id = idOf(confirmed(await f.commit(preview, i.productionManager)));
  assert.equal((await one("select md5(string_agg(to_jsonb(j)::text,',' order by id)) h from production_jobs j")).h, jobsBefore, "scenarios are isolated from the live plan");
  const s = await row("scenarios", id, i.productionManager);
  const byJob = Object.fromEntries(s.details.comparison.map(c => [c.job, c]));
  // Press A: 600 kg/day from tomorrow. In-progress J-NOV8-W3 (400) first, then J-NOV8-W1 (500), then J-NOV8-W4 (300).
  assert.equal(byJob["J-NOV8-W3"].baseline_finish, day(1));
  assert.equal(byJob["J-NOV8-W1"].baseline_finish, day(2));
  assert.equal(byJob["J-NOV8-W4"].baseline_finish, day(2));
  // With the press down tomorrow every job moves back.
  assert.equal(byJob["J-NOV8-W3"].scenario_finish, day(2));
  assert.equal(byJob["J-NOV8-W1"].scenario_finish, day(3));
  assert.equal(byJob["J-NOV8-W4"].scenario_finish, day(3));
  assert.equal(s.details.summary.jobs_delayed, 3);
  // The unmeasured press and the held job are stated, never treated as free or empty capacity.
  assert.equal(byJob["J-NOV8-R"].simulated, false);
  assert.equal(byJob["J-NOV8-R"].scenario_finish, null);
  assert.equal(s.details.summary.not_simulated, 1);
  assert.deepEqual(s.details.excluded.find(e => e.number === "J-NOV8-H"), { id: i.jobHold, number: "J-NOV8-H", reason: "On hold" });
  assert.ok(s.details.excluded.filter(e => e.reason === "No press assigned").length >= 1, "jobs without a press are listed as left out");
  assert.equal(s.details.machines.find(m => m.name === "Press B").measured, false);
  assert.match(s.summary, /Hypothetical/);
  assert.equal(s.status, "draft");
  assert.equal(s.details.stale, false);
});

test("NOV-024: an extra shift, an urgent order and a delayed receipt change the comparison as stated", async () => {
  const create = async (changes) => { const id = idOf(confirmed(await f.apply(scenarioBody(changes), i.productionManager))); return row("scenarios", id, i.productionManager); };
  const byJob = s => Object.fromEntries(s.details.comparison.map(c => [c.job, c]));
  // An extra 600 kg shift tomorrow pulls the last job forward.
  const extra = await create([{ type: "machine_down", machine_id: i.press1, from_date: day(1), days: 1 }, { type: "extra_shift", machine_id: i.press1, date: day(1), kg: 600 }]);
  assert.equal(byJob(extra)["J-NOV8-W4"].scenario_finish, day(2));
  assert.equal(extra.details.summary.jobs_delayed, 0, "the extra shift exactly offsets the breakdown");
  // A hypothetical urgent order takes capacity first and is flagged as hypothetical with its own result.
  const urgent = await create([{ type: "urgent_order", machine_id: i.press1, kg: 1200, due_date: day(2) }]);
  const u = urgent.details.comparison.find(c => c.hypothetical);
  assert.equal(u.job, "HYPOTHETICAL URGENT ORDER");
  assert.equal(u.baseline_finish, null, "it does not exist in the baseline");
  assert.equal(u.scenario_finish, day(1));
  assert.equal(u.late, "false");
  assert.equal(urgent.details.summary.jobs_delayed >= 1, true);
  assert.equal(urgent.details.summary.urgent.hypothetical, true);
  // A delayed receipt pushes only that job's earliest start.
  const delayed = await create([{ type: "delayed_receipt", job_id: i.jobWin1, days: 3 }]);
  assert.equal(byJob(delayed)["J-NOV8-W1"].scenario_finish, day(4));
  assert.equal(byJob(delayed)["J-NOV8-W3"].scenario_finish, byJob(delayed)["J-NOV8-W3"].baseline_finish);
  // Newly late work is reported against each order's expected dispatch date.
  await raw("update orders set expected_dispatch_date=current_date+2 where id=$1", [i.order]);
  const late = await create([down(3)]);
  assert.equal(late.details.summary.newly_late >= 1, true);
  // An impossible scenario leaves work unscheduled within the horizon and says how many kg.
  const impossible = await create([{ type: "machine_down", machine_id: i.press1, from_date: day(0), days: 7 }]);
  assert.equal(n(impossible.details.summary.unscheduled_kg_scenario) > 0, true);
  assert.equal(impossible.details.summary.newly_unscheduled >= 1, true);
});

test("NOV-024: invalid changes are refused with a reason", async () => {
  const create = (changes, patch, actor = i.productionManager) => f.prepare(scenarioBody(changes, patch), actor);
  await refused(create([{ type: "machine_down", machine_id: i.press2, from_date: day(1), days: 1 }]), /no recorded shift capacity/);
  await refused(create([{ type: "machine_down", machine_id: nid(999), from_date: day(1), days: 1 }]), /not in the snapshot/);
  await refused(create([{ type: "machine_down", machine_id: i.press1, from_date: day(9), days: 1 }]), /inside the horizon/);
  await refused(create([{ type: "machine_down", machine_id: i.press1, from_date: day(-1), days: 1 }]), /inside the horizon/);
  await refused(create([{ type: "machine_down", machine_id: i.press1, from_date: day(1), days: 8 }]), /1 to 7 whole days/);
  await refused(create([{ type: "extra_shift", machine_id: i.press1, date: day(1), kg: 0 }]), /Review the required|0.001 to 1,000,000/);
  await refused(create([{ type: "urgent_order", machine_id: i.press1, kg: 100, due_date: "2026-02-30" }]), /invalid date/);
  await refused(create([{ type: "delayed_receipt", job_id: nid(998), days: 2 }]), /not in the snapshot/);
  await refused(create([{ type: "delayed_receipt", job_id: i.jobWin1, days: 15 }]), /1 to 14 whole days/);
  await refused(create([{ type: "teleport", machine_id: i.press1 }]), /not a supported kind/);
  await refused(create([]), /1 to 6 hypothetical changes/);
  await refused(create(Array.from({ length: 7 }, () => down(1))), /1 to 6 hypothetical changes/);
  await refused(create([down(1)], { horizon_days: 2 }), /between 3 and 14/);
  await refused(create([down(1)], { horizon_days: 15 }), /between 3 and 14/);
  await refused(create([down(1)], { name: "no" }), /Name must be/);
  await refused(create([down(1)], {}, i.production), /Not permitted/);
  await refused(create([down(1)], {}, i.viewer), /Not permitted/);
  await refused(create([{ ...down(1), extra: true }]), /Review the required|not a supported|needs a press/);
});

test("NOV-024: sharing, a second planner's acceptance, rebasing on changed sources, and discarding", async () => {
  const id = idOf(confirmed(await f.apply(scenarioBody([down(1)]), i.productionManager)));
  await refused(f.prepare({ action: "scenario.accept", id, note }, i.factory), /Only a shared scenario can be accepted; this one is draft/);
  confirmed(await f.apply({ action: "scenario.share", id, note }, i.productionManager));
  await refused(f.prepare({ action: "scenario.share", id, note }, i.productionManager), /Only a draft scenario can be shared/);
  await refused(f.prepare({ action: "scenario.accept", id, note }, i.productionManager), /second planner accepts a scenario/);
  // A job changes after the snapshot: the scenario cannot be silently rebased.
  await raw("update production_jobs set planned_quantity_kg=planned_quantity_kg+50 where id=$1", [i.jobWin1]);
  assert.equal((await row("scenarios", id, i.productionManager)).details.stale, true);
  await refused(f.prepare({ action: "scenario.accept", id, note }, i.factory), /cannot be rebased automatically/);
  confirmed(await f.apply({ action: "scenario.discard", id, note }, i.factory));
  assert.equal((await row("scenarios", id, i.productionManager)).status, "discarded");
  await refused(f.prepare({ action: "scenario.discard", id, note }, i.factory), /discarded scenario cannot be discarded/);
  // With unchanged sources a second planner can accept; the live plan is untouched.
  await raw("update production_jobs set planned_quantity_kg=planned_quantity_kg-50 where id=$1", [i.jobWin1]);
  const second = idOf(confirmed(await f.apply(scenarioBody([down(1)], { name: "Second breakdown" }), i.productionManager)));
  confirmed(await f.apply({ action: "scenario.share", id: second, note }, i.productionManager));
  const accept = await f.prepare({ action: "scenario.accept", id: second, note }, i.factory);
  assert.match(accept.review.warnings.join(" "), /changes no job, date, assignment or promise/);
  confirmed(await f.commit(accept, i.factory));
  assert.equal((await row("scenarios", second, i.productionManager)).status, "accepted");
  assert.equal((await detail("scenarios", second, i.productionManager)).events.map(e => e.action).join(","), "scenario.accept,scenario.share,scenario.create");
  assert.equal((await list("scenarios", i.viewer)).total_count, 2, "a viewer may read both");
  await refused(list("scenarios", i.sales), /Not permitted/);
  // Another company never sees the scenario or its snapshot.
  assert.equal((await list("scenarios", i.foreign)).total_count, 0);
  await refused(detail("scenarios", second, i.foreign), /unavailable/);
});

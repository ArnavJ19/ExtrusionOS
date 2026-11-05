import test from "node:test";
import assert from "node:assert/strict";
import { createNov8Fixture, nids as i } from "../scripts/lib/nov-batch8-fixture.mjs";
import { executionOutcomeSchema } from "../lib/workflow/execution.ts";

// Regression tests for the review findings on the NOV-036 vehicle load plan.
let f;
test.before(async () => { f = await createNov8Fixture(); });
test.after(async () => { await f?.close(); });
test.beforeEach(async () => { await f.start(); });
test.afterEach(async () => { await f.rollback(); });

const note = "Reviewed with the responsible department";
const confirmed = result => { executionOutcomeSchema.parse(result); assert.equal(result.state, "confirmed", JSON.stringify(result.result)); return result; };
const detail = (id, patch = {}) => f.command("detail", { view: "loads", id, ...patch }, i.owner);
const row = async id => (await detail(id)).row;
const stop = (load, order, seq) => f.apply({ action: "loadplan.stop", load_id: load, order_id: order, stop_seq: seq, note }, i.dispatchManager);
const loadItem = (item, status = "loaded") => f.apply({ action: "loadplan.confirm", item_id: item, status, method: "scan", note }, i.dispatch);
const review = load => f.apply({ action: "loadplan.review", load_id: load, note }, i.dispatchManager);
const raw = async sql => { await f.db.exec("set session_replication_role = replica"); try { await f.db.exec(sql); } finally { await f.db.exec("set session_replication_role = origin"); } };

test("bundle labels come from the prepared physical bundles and show on the load and in the confirmation review", async () => {
  const record = await row(i.load1);
  assert.deepEqual(record.details.items.map(item => item.bundle).sort(), ["LB-1", "LB-2", "LB-X1"]);
  const preview = await f.prepare({ action: "loadplan.confirm", item_id: i.item1, status: "loaded", method: "scan", note }, i.dispatch);
  assert.equal(preview.review.facts.Bundle, "LB-1");
});

test("a load with more than 25 bundles is paged and every bundle can be reached and confirmed", async () => {
  const load = "be500000-0000-4000-8000-0000000008a0";
  const statements = [`insert into factory_vehicle_loads(id,company_id,vehicle_id,load_date,status,capacity_kg,created_by) values('${load}','${i.company}','${i.vehicle1}',current_date+1,'reviewed',100000,'${i.owner}');`];
  const items = [];
  for (let n = 1; n <= 30; n++) {
    const tag = String(n).padStart(2, "0"); const bundle = `be500000-0000-4000-8000-0000000009${tag}`; const item = `be500000-0000-4000-8000-0000000007${tag}`; items.push(item);
    statements.push(`insert into prepared_physical_bundles(id,company_id,order_id,source_line_id,source_kind,profile_id,bundle_number,number_of_pieces,net_length_m,gross_weight_kg,tare_weight_kg,recorded_by,payload)
      values('${bundle}','${i.company}','${i.order}','${i.line1}','production','${i.profile}','PG-${tag}',10,60,3,2,'${i.owner}','{}');`,
    `insert into factory_vehicle_load_items(id,company_id,load_id,bundle_id,order_id,source_line_id,source_kind,profile_id,net_weight_kg,number_of_pieces,net_length_m,status,source_fingerprint,snapshot,created_by)
      values('${item}','${i.company}','${load}','${bundle}','${i.order}','${i.line1}','production','${i.profile}',1,10,60,'active',md5('${item}'),'{}','${i.owner}');`);
  }
  await raw(statements.join("\n"));
  const page = async items_page => (await detail(load, { items_page })).row.details;
  const first = await page(1), second = await page(2);
  assert.equal(first.items_total, 30);
  assert.equal(first.items.length, 25);
  assert.equal(second.items.length, 5);
  assert.equal(new Set([...first.items, ...second.items].map(item => item.item_id)).size, 30, "no bundle is hidden or repeated across pages");
  assert.deepEqual([first.items_page, first.items_page_size, second.items_page], [1, 25, 2]);
  assert.equal((await page(3)).items.length, 0);
  await assert.rejects(() => detail(load, { items_page: 0 }), /Invalid execution filters/);
  await assert.rejects(() => detail(load, { items_page: 1, extra: 1 }), /Invalid execution request/);
  // A bundle that is only on the second page can be confirmed, and the departure review counts the rest.
  const hidden = second.items[0];
  confirmed(await loadItem(hidden.item_id));
  assert.equal((await page(2)).items.find(item => item.item_id === hidden.item_id).confirmation, "loaded");
  confirmed(await review(load));
  assert.ok((await page(1)).review.findings.blockers.some(b => /29 bundle\(s\) are not yet confirmed/.test(b)));
});

test("a ready review stops being current when a hold, a cancellation or a change to the load happens afterwards", async () => {
  await raw(`update factory_vehicle_load_items set status='removed' where id='${i.item3}'`);
  confirmed(await stop(i.load1, i.order, 1));
  confirmed(await loadItem(i.item1)); confirmed(await loadItem(i.item2));
  confirmed(await review(i.load1));
  let record = await row(i.load1);
  assert.equal(record.status, "ready");
  assert.equal(record.details.review.current, true);
  // A production job for a loaded order line is put on hold: the earlier review no longer reads as ready.
  await raw(`update production_jobs set status='on_hold' where id='${i.jobWin1}'`);
  record = await row(i.load1);
  assert.equal(record.details.review.current, false);
  assert.notEqual(record.status, "ready");
  const listed = (await f.command("list", { view: "loads", state: "all" }, i.owner)).rows.find(r => r.id === i.load1);
  assert.equal(listed.status, record.status, "the overview agrees with the detail");
  // A fresh review reports the hold as a blocker and is current again.
  confirmed(await review(i.load1));
  record = await row(i.load1);
  assert.equal(record.status, "not_ready");
  assert.equal(record.details.review.current, true);
  assert.ok(record.details.review.findings.blockers.some(b => /on hold/.test(b)));
  await raw(`update production_jobs set status='planned' where id='${i.jobWin1}'`);
  confirmed(await review(i.load1));
  assert.equal((await row(i.load1)).status, "ready");
  // The order is cancelled afterwards.
  await raw(`update orders set current_stage='cancelled' where id='${i.order}'`);
  record = await row(i.load1);
  assert.equal(record.details.review.current, false);
  assert.notEqual(record.status, "ready");
  await raw(`update orders set current_stage='extrusion_planned' where id='${i.order}'`);
  assert.equal((await row(i.load1)).status, "ready", "restoring the source makes the same review current again");
  // The saved load itself changes: another bundle is added.
  await raw(`update factory_vehicle_load_items set status='active' where id='${i.item3}'`);
  record = await row(i.load1);
  assert.equal(record.details.review.current, false);
  assert.notEqual(record.status, "ready");
});

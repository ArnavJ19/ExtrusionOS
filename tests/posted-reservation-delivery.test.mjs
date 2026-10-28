import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createRetainedInvoiceFixture, invoiceFixtureIds as f } from "../scripts/lib/retained-invoice-fixture.mjs";
import { createHistoricalTables, sqlDefinition } from "../scripts/lib/historical-schema-fixture.mjs";
import { fixtureId as id } from "../scripts/lib/direct-order-fixture.mjs";

const candidateFile = "20261020142106_posted_reservation_delivery_lifecycle.sql";
const candidate = process.env.POSTED_RESERVATION_BASELINE !== "true";
let db, originalBody;
test.before(async () => {
  db = await createRetainedInvoiceFixture();
  await createHistoricalTables(db, ["feature_flags"], candidateFile);
  await db.exec(`insert into feature_flags(company_id,module_name,is_enabled) values('${f.company}','quality_compliance',true);
    update dispatches set delivery_status='in_transit',number_of_bundles=1,total_tare_weight_kg=0 where id='${f.dispatch}';`);
  for (const [file, names] of [
    ["20260812010000_dispatch_return_and_manifest_integrity.sql", ["private.is_valid_delivery_transition", "public.validate_dispatch_transition"]],
    ["20261019020000_finishing_accepted_dispositions.sql", ["private.assert_dispatch_ready"]],
    ["20261008020000_factory_workflow_integrity.sql", ["private.transition_dispatch_delivery_atomic"]],
    ["20260718021000_dispatch_readiness_and_delivery.sql", ["public.validate_dispatch_readiness", "public.transition_dispatch_delivery_atomic"]],
  ]) for (const name of names) await db.exec(sqlDefinition(file, name));
  originalBody = (await db.query("select prosrc from pg_proc where oid='private.assert_dispatch_ready(uuid)'::regprocedure")).rows[0].prosrc;
  if (candidate) await db.exec(readFileSync(new URL(`../supabase/migrations/${candidateFile}`, import.meta.url), "utf8"));
  await db.exec(`create trigger validate_dispatch_transition before update of delivery_status on dispatches
      for each row execute function public.validate_dispatch_transition();
    create constraint trigger validate_dispatch_readiness after update of delivery_status on dispatches
      deferrable initially deferred for each row execute function public.validate_dispatch_readiness();
    revoke all on function private.assert_dispatch_ready(uuid) from public,anon,authenticated;
    revoke all on function private.transition_dispatch_delivery_atomic(uuid,text,text,text) from public,anon,authenticated;
    grant execute on function public.transition_dispatch_delivery_atomic(uuid,text,text,text) to authenticated;`);
});
test.after(async () => { if (db) await db.close(); });
test.beforeEach(async () => { await db.exec(`begin; set test.actor='${f.actor}'; set role authenticated;`); });
test.afterEach(async () => { await db.exec("rollback; reset role;"); });
const cancel = () => db.query("update orders set current_stage='cancelled' where id=$1", [f.order]);
async function attempt(callback) {
  await db.exec("savepoint posted_delivery_attempt;");
  try { const result = await callback(); await db.exec("release savepoint posted_delivery_attempt;"); return result; }
  catch (error) { await db.exec("rollback to savepoint posted_delivery_attempt; release savepoint posted_delivery_attempt;"); throw error; }
}
async function inspect(callback) {
  await db.exec("reset role;");
  try { return await attempt(callback); } finally { await db.exec("set role authenticated;"); }
}
const snapshot = () => inspect(async () => ({
  stock: (await db.query("select * from profile_stock_batches order by id")).rows,
  consumption: (await db.query("select * from profile_stock_consumptions order by id")).rows,
  movements: (await db.query("select * from inventory_transactions order by id")).rows,
  fulfillment: (await db.query("select * from order_dealer_stock_fulfillments order by id")).rows,
}));
const transition = (status) => attempt(async () => {
  const result = await db.query("select public.transition_dispatch_delivery_atomic($1,$2,null,'Synthetic acceptance lifecycle') id", [f.dispatch, status]);
  await db.exec("set constraints all immediate; set constraints all deferred;");
  return result.rows[0].id;
});
const closedPostingMatches = () => inspect(async () => (await db.query(
  "select private.closed_reservation_has_exact_dispatch_posting($1,$2) ok", [f.dispatch, f.reservation])).rows[0].ok);

for (const status of ["returned", "damaged"]) {
  test(`${status} shipment after cancellation retains its posted consumption and physical stock`, async () => {
    const before = await snapshot();
    await cancel();
    assert.equal(await transition(status), f.order);
    assert.equal((await db.query("select delivery_status from dispatches where id=$1", [f.dispatch])).rows[0].delivery_status, status);
    assert.deepEqual(await snapshot(), before);
  });
}
test("ordinary active-reservation delivery transitions retain their existing behavior", async () => {
  const before = await snapshot();
  assert.equal(await transition("returned"), f.order);
  assert.deepEqual(await snapshot(), before);
});
test("released partial holds retain exact posted shipment evidence", async () => {
  await db.query("update profile_stock_reservations set status='released',released_at=now() where id=$1", [f.reservation]);
  assert.equal(await closedPostingMatches(), true);
  assert.equal(await transition("damaged"), f.order);
});
test("helper accepts only closed holds and never authorizes a new debit", async () => {
  assert.equal(await closedPostingMatches(), false);
  await cancel();
  assert.equal(await closedPostingMatches(), true);
  await inspect(() => db.query("delete from profile_stock_consumptions where dispatch_id=$1", [f.dispatch]));
  assert.equal(await closedPostingMatches(), false);
  await assert.rejects(transition("returned"), /eligible reservation/);
});
for (const [name, change] of [
  ["another company", `company_id='${f.sibling}'`],
  ["another order", `order_id='${f.otherOrder}'`],
  ["another profile", `profile_id='${id(21)}'`],
  ["another batch", `profile_stock_batch_id='${id(998)}'`],
  ["changed kg", "consumed_weight_kg=11"],
  ["changed metres", "consumed_length_m=6"],
  ["changed pieces", "consumed_pieces=2"],
  ["unknown kg", "consumed_weight_kg=null"],
  ["unknown metres", "consumed_length_m=null"],
  ["unknown pieces", "consumed_pieces=null"],
  ["nonfinite kg", "consumed_weight_kg='NaN'"],
  ["negative kg", "consumed_weight_kg=-10"],
]) {
  test(`closed shipment rejects legacy posting evidence with ${name}`, async () => {
    await cancel();
    await inspect(() => db.exec(`update profile_stock_consumptions set ${change} where dispatch_id='${f.dispatch}';`));
    assert.equal(await closedPostingMatches(), false);
    await assert.rejects(transition("returned"), /eligible reservation/);
  });
}
for (const [name, change] of [
  ["missing verification date", "operator_verified_at=null"],
  ["missing verification actor", "operator_verified_by=null"],
  ["unknown metres", "net_length_m=null"],
  ["unknown pieces", "number_of_pieces=null"],
]) {
  test(`closed posting predicate rejects retained manifest with ${name}`, async () => {
    await cancel();
    await inspect(() => db.exec(`update packing_list_items set ${change} where dispatch_id='${f.dispatch}';`));
    assert.equal(await closedPostingMatches(), false);
  });
}
test("retained packing source identity remains protected by the existing lineage guard", async () => {
  await cancel();
  await assert.rejects(inspect(() => db.query("update packing_list_items set source_record_id=null where dispatch_id=$1", [f.dispatch])), /source does not match/);
  assert.equal(await closedPostingMatches(), true);
});
test("one null legacy bundle cannot disappear inside bool_and or quantity sums", async () => {
  await cancel();
  await inspect(() => db.exec(`insert into packing_list_items(id,company_id,dispatch_id,source_kind,source_record_id,source_line_id,reservation_id,profile_stock_batch_id,
    profile_id,net_weight_kg,gross_weight_kg,tare_weight_kg,net_length_m,number_of_pieces,bundle_number,operator_verified_at,operator_verified_by)
    values('${id(997)}','${f.company}','${f.dispatch}','reservation','${f.order}','${f.reservation}','${f.reservation}','${f.batch}',
      '${f.profile}',10,10,0,null,1,'SYNTHETIC-UNKNOWN-LENGTH',now(),'${f.actor}');
    update profile_stock_consumptions set consumed_weight_kg=20,consumed_pieces=2 where dispatch_id='${f.dispatch}';`));
  assert.equal(await closedPostingMatches(), false);
});
test("a second consumption entry cannot make an ambiguous closed posting eligible", async () => {
  await cancel();
  await inspect(() => db.exec(`insert into profile_stock_consumptions(id,company_id,reservation_id,order_id,dispatch_id,profile_id,profile_stock_batch_id,consumed_weight_kg,consumed_length_m,consumed_pieces)
    values('${id(996)}','${f.sibling}','${f.reservation}','${f.order}','${f.dispatch}','${f.profile}','${f.batch}',10,5,1);`));
  assert.equal(await closedPostingMatches(), false);
});
test("unknown closed reservation/dispatch identities return false", async () => {
  await cancel();
  await inspect(async () => {
    assert.equal((await db.query("select private.closed_reservation_has_exact_dispatch_posting($1,$2) ok", [id(995), f.reservation])).rows[0].ok, false);
    assert.equal((await db.query("select private.closed_reservation_has_exact_dispatch_posting($1,$2) ok", [f.dispatch, id(994)])).rows[0].ok, false);
  });
});
test("private helper and readiness implementation retain client execute denial", async () => {
  const row = await inspect(async () => (await db.query(`select
    has_function_privilege('anon','private.closed_reservation_has_exact_dispatch_posting(uuid,uuid)','execute') anonymous,
    has_function_privilege('authenticated','private.closed_reservation_has_exact_dispatch_posting(uuid,uuid)','execute') client,
    has_function_privilege('authenticated','private.assert_dispatch_ready(uuid)','execute') readiness`)).rows[0]);
  assert.deepEqual(row, { anonymous: false, client: false, readiness: false });
  await assert.rejects(attempt(() => db.query("select private.closed_reservation_has_exact_dispatch_posting($1,$2)", [f.dispatch, f.reservation])), /permission denied/);
});
test("the remaining production, QC, finishing, packaging and capacity logic is unchanged", async () => {
  const body = await inspect(async () => (await db.query("select prosrc from pg_proc where oid='private.assert_dispatch_ready(uuid)'::regprocedure")).rows[0].prosrc);
  const updated = "or (v_reservation.status not in ('active','consumed')\n           and not private.closed_reservation_has_exact_dispatch_posting(p_dispatch_id, v_reservation.id)) then";
  const normalizedBody = body.replaceAll("\r\n", "\n");
  assert.ok(normalizedBody.includes(updated), "the expected reservation guard must be present");
  assert.equal(normalizedBody.replace(updated, "or v_reservation.status not in ('active','consumed') then").trim(), originalBody.replaceAll("\r\n", "\n").trim());
});
test("deployment preflight detects the new private helper and revised readiness body", async () => {
  const source = readFileSync(new URL("../sql/audit-deployment-preflight.sql", import.meta.url), "utf8");
  const start = source.indexOf("-- R04/R10/R11 acceptance follow-up");
  assert.ok(start >= 0);
  const rows = await inspect(async () => (await db.query(source.slice(start, source.indexOf(";", start) + 1))).rows);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.present && row.security_definer && !row.authenticated_execute && !row.anonymous_execute));
  assert.equal(rows.find((row) => row.signature === "private.assert_dispatch_ready(uuid)").closed_posting_guard, true);
});

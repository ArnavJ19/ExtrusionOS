import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createManualBilletAllocationFixture, manualBilletIds as f } from "../scripts/lib/manual-billet-allocation-fixture.mjs";
import { fixtureId as id } from "../scripts/lib/direct-order-fixture.mjs";
import { sqlDefinition } from "../scripts/lib/historical-schema-fixture.mjs";
import { createDieReadinessActionFixture, dieFixture as a } from "../scripts/lib/die-readiness-action-fixture.mjs";

const migration = "20261020162949_production_billet_material_normalization.sql";
const candidate = process.env.PRODUCTION_BILLET_BASELINE !== "true";
const action = createDieReadinessActionFixture();
let fixture, db, baselineBody;
test.before(async () => {
  fixture = await createManualBilletAllocationFixture();
  db = fixture.db;
  await db.exec(sqlDefinition("20260809000004_production_billet_release_and_compat.sql", "private.save_production_job_atomic"));
  baselineBody = (await db.query("select prosrc from pg_proc where oid='private.save_production_job_atomic(uuid,jsonb,uuid[])'::regprocedure")).rows[0].prosrc;
  await db.exec(sqlDefinition("20260715000000_atomic_business_workflows.sql", "public.save_production_job_atomic"));
  await db.exec(`revoke all on function private.save_production_job_atomic(uuid,jsonb,uuid[]) from public,anon,authenticated;
    revoke all on function public.save_production_job_atomic(uuid,jsonb,uuid[]) from public,anon;
    grant execute on function public.save_production_job_atomic(uuid,jsonb,uuid[]) to authenticated;`);
  if (candidate) await db.exec(readFileSync(new URL(`../supabase/migrations/${migration}`, import.meta.url), "utf8"));
});
test.after(async () => { await fixture?.close(); });
async function prepare({ alloy = "6063", temper = "T6", profileAlloy = "6063" } = {}) {
  await fixture.reset();
  await fixture.insertBillet({ temper });
  await db.query("update foundry_billets set alloy=$1 where id=$2", [alloy, f.freeBillet]);
  await fixture.allocate();
  await db.query("update aluminium_profiles set alloy=$1 where id=$2", [profileAlloy, f.t6Profile]);
}
async function saveJob({ billetIds = [f.freeBillet], editingId = null, orderId = fixture.orderId, quantity = 30 } = {}) {
  const line = (await db.query("select id from order_items where order_id=$1 and profile_id=$2", [orderId, f.t6Profile])).rows[0];
  return fixture.asAuthenticated(() => db.query("select public.save_production_job_atomic($1,$2,$3) id", [editingId,
    { order_id: orderId, profile_id: f.t6Profile, die_id: id(30), source_line_id: line?.id,
      planned_quantity_kg: quantity, status: "planned", planned_date: "2026-10-20" }, billetIds]));
}
const snapshot = async () => ({
  jobs: (await db.query("select * from production_jobs order by id")).rows,
  billets: (await db.query("select * from foundry_billets order by id")).rows,
});

for (const [label, values] of [
  ["canonical material", {}],
  ["padded billet alloy", { alloy: " 6063 " }],
  ["padded profile alloy", { profileAlloy: " 6063 " }],
  ["padded lower-case temper", { temper: " t6 " }],
  ["padded material on both sides", { alloy: " 6063 ", temper: " t6 ", profileAlloy: " 6063 " }],
]) {
  test(`SQL production issuance accepts ${label} after real allocation`, async () => {
    await prepare(values);
    const result = await saveJob();
    const job = result.rows[0].id;
    const billet = await fixture.billet();
    assert.equal(billet.production_job_id, job);
    assert.equal(billet.order_id, fixture.orderId);
    assert.equal(billet.status, "issued");
  });
}
for (const [label, change] of [
  ["different alloy", "alloy='6082'"],
  ["different diameter", "billet_diameter_required_inch=7"],
]) {
  test(`SQL production issuance still rejects ${label} without partial writes`, async () => {
    await prepare({ alloy: " 6063 " });
    await db.exec(`update aluminium_profiles set ${change} where id='${f.t6Profile}';`);
    const before = await snapshot();
    await assert.rejects(saveJob(), /do not match.*diameter or alloy/);
    assert.deepEqual(await snapshot(), before);
  });
}

test("allocated billet guards still reject missing alloy and incorrect temper", async () => {
  await prepare({ alloy: " 6063 " });
  const before = await snapshot();
  for (const change of ["alloy=null", "alloy=''", "temper='T5'"]) {
    await assert.rejects(fixture.attempt(() => db.exec(`update foundry_billets set ${change} where id='${f.freeBillet}'`)), /must match the order requirement/);
    assert.deepEqual(await snapshot(), before);
  }
});

test("SQL writer retains stale selection, duplicate identity and wrong-company rejection", async () => {
  await prepare({ alloy: " 6063 " });
  for (const billetIds of [[id(990)], [f.freeBillet, f.freeBillet]]) {
    const before = await snapshot();
    await assert.rejects(saveJob({ billetIds }), /stale, incompatible, or already issued/);
    assert.deepEqual(await snapshot(), before);
  }
  await db.query("set test.actor to '" + f.otherActor + "'");
  await db.query("update app_users set role='owner' where id=$1", [f.otherActor]);
  const before = await snapshot();
  await assert.rejects(saveJob(), /order is not available for this company/);
  assert.deepEqual(await snapshot(), before);
});

test("SQL edit releases only deselected issued billets and retains material checks", async () => {
  await prepare({ alloy: " 6063 " });
  const job = (await saveJob()).rows[0].id;
  await saveJob({ editingId: job, billetIds: [] });
  assert.equal((await fixture.billet()).status, "allocated");
  assert.equal((await fixture.billet()).production_job_id, null);
  await saveJob({ editingId: job });
  assert.equal((await fixture.billet()).production_job_id, job);
});

test("private production implementation remains client-inaccessible", async () => {
  const row = (await db.query(`select
    has_function_privilege('authenticated','private.save_production_job_atomic(uuid,jsonb,uuid[])','execute') client,
    has_function_privilege('anon','private.save_production_job_atomic(uuid,jsonb,uuid[])','execute') anonymous`)).rows[0];
  assert.deepEqual(row, { client: false, anonymous: false });
});

test("remaining production transaction body is unchanged", async () => {
  const body = (await db.query("select prosrc from pg_proc where oid='private.save_production_job_atomic(uuid,jsonb,uuid[])'::regprocedure")).rows[0].prosrc;
  assert.equal(body.replace("lower(btrim(coalesce(b.alloy, ''))) <> lower(btrim(v_req_alloy))", "lower(coalesce(b.alloy, '')) <> lower(v_req_alloy)"), baselineBody);
});

function actionSave() {
  return action.production.saveProductionJobAction({ order_id: a.order, profile_id: a.profile, die_id: a.die, machine_id: a.machine,
    planned_quantity_kg: 10, source_line_id: id(16), status: "planned", selected_billet_ids: [id(20)] });
}
function actionBillet(changes = {}, requirementChanges = {}) {
  return { id: id(20), company_id: a.company, order_id: a.order, status: "allocated", production_job_id: null,
    alloy: "6063", temper: "T6", billet_diameter_inch: 6,
    order_billet_requirements: { order_id: a.order, alloy: "6063", temper: "T6", billet_diameter_inch: 6, status: "partial", ...requirementChanges }, ...changes };
}
for (const [label, changes, requirementChanges] of [
  ["padded billet alloy", { alloy: " 6063 " }, {}],
  ["padded lower-case billet temper", { temper: " t6 " }, {}],
  ["padded requirement material", {}, { alloy: " 6063 ", temper: " t6 " }],
  ["padded material on both sides", { alloy: " 6063 ", temper: " t6 " }, { alloy: " 6063 ", temper: " T6 " }],
]) {
  test(`production action accepts ${label}`, async () => {
    action.reset();
    action.state.billetRows = [actionBillet(changes, requirementChanges)];
    const result = await actionSave();
    assert.equal(result.success, true, result.error);
    assert.equal(action.state.calls.length, 1);
    assert.deepEqual(action.state.calls[0].args.p_billet_ids, [id(20)]);
  });
}
for (const [label, changes, requirementChanges] of [
  ["different alloy", { alloy: "6082" }, {}],
  ["unknown alloy", { alloy: null }, {}],
  ["different temper", { temper: "T5" }, {}],
  ["unknown temper", { temper: null }, {}],
  ["different diameter", { billet_diameter_inch: 7 }, {}],
  ["another order", { order_id: id(99) }, {}],
  ["another job", { production_job_id: id(99) }, {}],
  ["cast status", { status: "cast" }, {}],
  ["cancelled requirement", {}, { status: "cancelled" }],
  ["another requirement order", {}, { order_id: id(99) }],
]) {
  test(`production action still rejects ${label} without calling the writer`, async () => {
    action.reset();
    action.state.billetRows = [actionBillet(changes, requirementChanges)];
    assert.equal((await actionSave()).success, false);
    assert.deepEqual(action.state.calls, []);
    assert.deepEqual(action.state.paths, []);
  });
}

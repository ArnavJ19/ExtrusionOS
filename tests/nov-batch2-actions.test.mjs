import test from "node:test";
import assert from "node:assert/strict";
import { createNov2ActionsFixture, nov2Id as id } from "../scripts/lib/nov-batch2-actions-fixture.mjs";

const f = createNov2ActionsFixture();
test.beforeEach(() => f.reset());
const planned = () => ({ order_id: id(10), source_line_id: id(11), profile_id: id(20), die_id: id(30), machine_id: null, pieces: 100, planned_quantity_kg: 480, length_per_piece_m: 6, required_billet_count: 0, status: "planned", quantity_basis: { pieces: 100, length: "6000", unit: "mm", sectionWeightKgPerM: .8 } });
const observations = () => ({ command: "results.record", inspection_id: id(70), plan_id: id(50), results: [{ item_id: id(51), observed: 1.6 }] });

test("NOV-012: real production action reconciles the reviewed plan with authoritative order dimensions", async () => {
  const result = await f.saveProductionJobAction({ ...planned(), company_id: id(999), created_by: id(999) });
  assert.equal(result.success, true);
  const write = f.state.calls.find(call => call.rpc === "save_production_job_atomic").payload.p_job;
  assert.equal(write.planned_quantity_kg, 480); assert.equal(write.length_per_piece_m, 6); assert.equal(write.pieces, 100); assert.equal(write.section_weight_kg_per_m, .8);
  assert.equal(write.company_id, id(1)); assert.equal(write.created_by, id(3)); assert.equal("quantity_basis" in write, false); assert.equal("actual_quantity_kg" in write, false);
  for (const call of f.state.calls.filter(call => call.table)) assert.ok(call.filters.some(([kind, key, value]) => kind === "eq" && key === "company_id" && value === id(1)));
});

test("NOV-012: changed, missing, forged and inconsistent quantities stop before any production commit", async () => {
  const cases = [
    () => { f.state.rows.order_items_authorized[0].section_weight_kg_per_m = .9; },
    () => { f.state.rows.order_items_authorized[0].section_weight_kg_per_m = null; },
    input => { input.planned_quantity_kg = 240; },
    input => { input.length_per_piece_m = 3; },
    input => { input.quantity_basis.length = "3000"; input.length_per_piece_m = 3; input.planned_quantity_kg = 240; },
    input => { input.quantity_basis.sectionWeightKgPerM = 1; },
    input => { input.quantity_basis.pieces = .5; },
    input => { input.quantity_basis.unit = "cm"; },
    () => { f.state.rows.aluminium_profiles[0].company_id = id(2); }
  ];
  for (const change of cases) {
    f.reset(); const input = planned(); change(input);
    assert.equal((await f.saveProductionJobAction(input)).success, false);
    assert.equal(f.state.calls.some(call => call.rpc === "save_production_job_atomic"), false);
  }
});

test("NOV-012: historical section weight survives a master change; direct orders use a rechecked current profile estimate", async () => {
  f.state.rows.aluminium_profiles[0].section_weight_kg_per_m = .95;
  assert.equal((await f.saveProductionJobAction(planned())).success, true);
  assert.equal(f.state.calls.find(call => call.rpc === 'save_production_job_atomic').payload.p_job.section_weight_kg_per_m, .8);
  f.reset(); f.state.rows.order_items_authorized = [];
  const direct = planned(); direct.source_line_id = null;
  assert.equal((await f.saveProductionJobAction(direct)).success, true);
  f.reset(); f.state.rows.order_items_authorized = []; f.state.rows.aluminium_profiles[0].section_weight_kg_per_m = .95;
  assert.equal((await f.saveProductionJobAction(direct)).success, false); assert.equal(f.state.calls.some(call => call.rpc === 'save_production_job_atomic'), false);
});

test("NOV-012: manual planning remains supported and unauthorized direct callers cannot read sources", async () => {
  const input = planned(); delete input.quantity_basis;
  assert.equal((await f.saveProductionJobAction(input)).success, true);
  for (const role of ["viewer", "accounts", "dealer_admin", "dealer_staff"]) {
    f.reset(); f.state.context.role = role;
    assert.equal((await f.saveProductionJobAction(planned())).success, false); assert.equal(f.state.calls.length, 0);
  }
  f.reset(); f.state.authenticated = false; assert.equal((await f.saveProductionJobAction(planned())).success, false); assert.equal(f.state.calls.length, 0);
});

test("NOV-018/096: observation action validates finite values, actor authority and strict tenant-independent input", async () => {
  for (const patch of [{ results: [{ item_id: id(51), observed: Infinity }] }, { company_id: id(2) }, { inspection_id: "bad" }, { results: [] }]) {
    f.reset(); assert.equal((await f.inspectionPlanAction({ ...observations(), ...patch })).success, false); assert.equal(f.state.calls.length, 0);
  }
  for (const role of ["viewer", "production", "accounts", "dealer_admin"]) {
    f.reset(); f.state.context.role = role; assert.equal((await f.inspectionPlanAction(observations())).success, false); assert.equal(f.state.calls.length, 0);
  }
  f.reset(); f.state.context.dealerId = id(4); assert.equal((await f.inspectionPlanAction(observations())).success, false);
});

test("NOV-018: lost response and malformed post-write response are uncertain, with no blind retry claim", async () => {
  f.state.rpcThrow = true;
  assert.equal((await f.inspectionPlanAction(observations())).uncertain, true);
  f.reset(); f.state.rpcError = { code: "", message: "fetch failed" };
  assert.equal((await f.inspectionPlanAction(observations())).uncertain, true);
  f.reset(); f.state.malformedResult = true;
  assert.equal((await f.inspectionPlanAction(observations())).uncertain, true);
});

test("NOV-018/095: plan changes and permission denial are definitive rejections, with sanitized errors", async () => {
  f.state.rpcError = { code: "P0001", message: "The applicable inspection plan changed. Reload it before recording results" };
  const stale = await f.inspectionPlanAction(observations()); assert.equal(stale.success, false); assert.equal(stale.uncertain, undefined); assert.match(stale.error, /plan changed/);
  f.reset(); f.state.rpcError = { code: "42501", message: "SQL SECRET role policy" };
  const denied = await f.inspectionPlanAction(observations()); assert.equal(denied.success, false); assert.doesNotMatch(denied.error, /SQL SECRET/);
  f.reset(); f.state.rpcError = { code: "PGRST202", message: "RPC absent" }; assert.equal((await f.inspectionPlanAction(observations())).unavailable, true);
});

test("NOV-001: real refresh action derives scope and applies bounded tenant/user reads", async () => {
  const result = await f.refreshMyWorkAction(); assert.equal(result.success, true); assert.equal(result.scope, `${id(1)}:${id(3)}:owner`);
  assert.equal(result.work.assigned.items.length, 1);
  for (const call of f.state.calls.filter(call => call.table)) {
    assert.ok(call.filters.some(([, key, value]) => key === "company_id" && value === id(1)));
    assert.ok(call.limit <= 11);
  }
  assert.ok(f.state.calls.filter(call => call.table === "tasks").some(call => call.filters.some(([, key, value]) => key === "assigned_to" && value === id(3))));
});

test("NOV-001: changed company/user removes former assignments; dealer/unauthenticated refresh fails closed", async () => {
  f.state.context.companyId = id(2); assert.equal((await f.refreshMyWorkAction()).work.assigned.items.length, 0);
  f.reset(); f.state.context.userId = id(4); assert.equal((await f.refreshMyWorkAction()).work.assigned.items.length, 0);
  for (const change of [() => { f.state.authenticated = false; }, () => { f.state.context.role = "dealer_admin"; }, () => { f.state.context.dealerId = id(4); }]) {
    f.reset(); change(); assert.equal((await f.refreshMyWorkAction()).success, false); assert.equal(f.state.calls.length, 0);
  }
});

test("NOV-018: real mobile task rejects invalid IDs, disallowed roles and dealer sessions before record reads", async () => {
  await assert.rejects(f.mobileInspectionPage({ params: Promise.resolve({ id: "../private" }) }), /Not found/);
  for (const role of ["accounts", "sales", "dealer_admin", "viewer"]) {
    f.reset(); f.state.context.role = role;
    await assert.rejects(f.mobileInspectionPage({ params: Promise.resolve({ id: id(70) }) }), error => error.href === "/dashboard?denied=1");
    assert.equal(f.state.calls.length, 0);
  }
  f.reset(); f.state.context.dealerId = id(4);
  await assert.rejects(f.mobileInspectionPage({ params: Promise.resolve({ id: id(70) }) }), error => error.href === "/dashboard?denied=1"); assert.equal(f.state.calls.length, 0);
});

test("NOV-018: real mobile task honors company feature access and refuses a foreign inspection", async () => {
  f.state.flags.quality_compliance = false;
  await assert.rejects(f.mobileInspectionPage({ params: Promise.resolve({ id: id(70) }) }), error => error.href === "/dashboard?denied=1"); assert.equal(f.state.calls.length, 0);
  f.reset(); f.state.flags.mobile_floor_app = false;
  await assert.rejects(f.mobileInspectionPage({ params: Promise.resolve({ id: id(70) }) }), error => error.href === `/quality/${id(70)}`); assert.equal(f.state.calls.length, 0);
  f.reset(); f.state.rows.quality_inspections[0].company_id = id(2);
  await assert.rejects(f.mobileInspectionPage({ params: Promise.resolve({ id: id(70) }) }), /Not found/); assert.equal(f.state.calls.some(call => call.rpc), false);
});

test("NOV-018/095: mobile task displays the authorized plan and distinguishes failed references from no plan", async () => {
  const flatten = element => element ? [element, ...([element.props?.children].flat(Infinity).flatMap(child => child && typeof child === "object" ? flatten(child) : []))] : [];
  const page = await f.mobileInspectionPage({ params: Promise.resolve({ id: id(70) }) });
  const panel = flatten(page).find(element => element.type?.name === "InspectionResultsPanel");
  assert.ok(panel); assert.equal(panel.props.canRecord, true); assert.equal(panel.props.contextScope, `${id(1)}:${id(3)}:owner`); assert.equal(panel.props.referenceHref, `/quality/plans/${id(50)}`);
  assert.ok(f.state.calls.find(call => call.table === "quality_inspections").filters.some(([, key, value]) => key === "company_id" && value === id(1)));
  f.reset(); f.state.rpcError = { code: "42501", message: "SQL SECRET" };
  const failed = flatten(await f.mobileInspectionPage({ params: Promise.resolve({ id: id(70) }) }));
  assert.equal(failed.some(element => element.type?.name === "InspectionResultsPanel"), false);
  assert.ok(failed.some(element => element.type?.name === "ErrorState")); assert.doesNotMatch(failed.filter(element => element.type?.name === "ErrorState").map(element => element.props.description).join(" "), /SQL SECRET/);
  f.reset(); f.state.evaluation = { state: "no_plan", plan_id: null };
  const absent = flatten(await f.mobileInspectionPage({ params: Promise.resolve({ id: id(70) }) })).find(element => element.type?.name === "InspectionResultsPanel");
  assert.equal(absent.props.initial.state, "no_plan");
});

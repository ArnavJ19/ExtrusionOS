import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { UNITS, canEditPlans, canReadPlans, evaluationSchema, itemProblem, judge, limitText, planCommandSchema, planDetailSchema, planListSchema } from "../lib/workflow/inspection-plans.ts";
import { createInspectionPlanFixture, iids } from "../scripts/lib/inspection-plan-fixture.mjs";

const id = "00000000-0000-4000-8000-000000000060";

test("pass/fail matches the database: inclusive limits, one-sided limits allowed", () => {
  assert.equal(judge(1.52, 1.52, 1.68), "pass");
  assert.equal(judge(1.68, 1.52, 1.68), "pass");
  assert.equal(judge(1.519, 1.52, 1.68), "fail");
  assert.equal(judge(13, 12, null), "pass");
  assert.equal(judge(11.9, 12, null), "fail");
  assert.equal(judge(25, null, 20), "fail");
});

test("characteristic rules mirror the database checks", () => {
  assert.equal(itemProblem({ unit: "visual", nominal: null, lower_limit: null, upper_limit: null }), null);
  assert.match(itemProblem({ unit: "visual", nominal: null, lower_limit: 1, upper_limit: null }), /no limits/);
  assert.match(itemProblem({ unit: "mm", nominal: null, lower_limit: null, upper_limit: null }), /at least one limit/);
  assert.match(itemProblem({ unit: "mm", nominal: null, lower_limit: 2, upper_limit: 1 }), /lower limit is above/);
  assert.match(itemProblem({ unit: "mm", nominal: 2, lower_limit: 1, upper_limit: 1.8 }), /nominal value is outside/);
  const sql = readFileSync("supabase/migrations/20261022320000_inspection_plans.sql", "utf8");
  for (const unit of Object.keys(UNITS)) assert.ok(sql.includes(`'${unit}'`), unit);
});

test("labels and role gates", () => {
  assert.equal(limitText({ unit: "mm", lower_limit: 1.52, upper_limit: 1.68 }), "1.52 – 1.68 mm");
  assert.equal(limitText({ unit: "HW", lower_limit: 12, upper_limit: null }), "≥ 12 HW");
  assert.equal(limitText({ unit: "micron", lower_limit: null, upper_limit: 80 }), "≤ 80 micron");
  assert.ok(canEditPlans("quality") && !canEditPlans("production_manager") && canReadPlans("production_manager") && !canReadPlans("sales"));
  assert.equal(planCommandSchema.safeParse({ command: "results.record", inspection_id: id, plan_id: id, results: [{ item_id: id, observed: "1.6" }] }).success, false);
  assert.equal(planCommandSchema.safeParse({ command: "plan.save_draft", plan_id: id, profile_id: null, sampling_instruction: "3 pcs", items: [{ characteristic: "Wall", unit: "mm" }] }).success, false);
});

let f;
test.before(async () => { f = await createInspectionPlanFixture(); await f.reset(); });
test.after(async () => { await f?.close(); });

test("database plan, list and evaluation responses parse with the app's schemas", async () => {
  assert.equal(evaluationSchema.parse(await f.command("inspection.plan", { inspection_id: iids.inspection })).state, "no_plan");
  await f.approvedPlan();
  planDetailSchema.parse(await f.command("plan.load", { plan_id: iids.plan }));
  assert.equal(planListSchema.parse(await f.command("plan.list", {})).total_count, 1);
  const ids = await f.itemIds();
  const evaluation = evaluationSchema.parse(await f.command("results.record", { inspection_id: iids.inspection, plan_id: iids.plan, results: [{ item_id: ids[0].id, observed: 1.6 }, { item_id: ids[3].id, visual_ok: true }] }, iids.inspector));
  assert.equal(evaluation.state, "incomplete");
});

test("pages gate on the plan roles; the inspection page shows the panel for internal users", () => {
  assert.match(readFileSync("app/(dashboard)/quality/plans/page.tsx", "utf8"), /context\.dealerId \|\| !canReadPlans\(context\.role\)/);
  assert.match(readFileSync("app/(dashboard)/quality/plans/new/page.tsx", "utf8"), /context\.dealerId \|\| !canEditPlans\(context\.role\)/);
  assert.match(readFileSync("app/(dashboard)/quality/plans/[id]/page.tsx", "utf8"), /plan\.created_by !== context\.userId/);
  assert.match(readFileSync("app/(dashboard)/quality/[id]/page.tsx", "utf8"), /inspection && !context\.dealerId \? await supabase\.rpc\("inspection_plan_command"/);
});

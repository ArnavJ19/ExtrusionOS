import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canManageCompetencies, catalogSchema, competencyCommandSchema, describeStanding, holdersSchema, myGrantsSchema, requirementsSchema, standingResultSchema } from "../lib/workflow/competencies.ts";
import { createCompetencyFixture, cids } from "../scripts/lib/competency-fixture.mjs";

const id = "00000000-0000-4000-8000-000000000060";

test("standings are explained in plain words", () => {
  assert.equal(describeStanding({ granted: null, effective: "none", reason: "not_granted" }), "Not qualified");
  assert.match(describeStanding({ granted: "independent", effective: "none", reason: "expired" }), /expired/);
  assert.match(describeStanding({ granted: "independent", effective: "supervised", reason: "procedure_revised", current_revision: 4 }), /revision 4: supervised until re-qualified/);
  assert.match(describeStanding({ granted: "trained", effective: "trained", reason: null }), /cannot perform/);
  assert.equal(describeStanding({ granted: "independent", effective: "independent", reason: null }), "May act independently");
});

test("command validation mirrors the database codes and levels", () => {
  assert.equal(competencyCommandSchema.safeParse({ command: "catalog.save", id, code: "qc-release", name: "QC release", procedure_id: null, validity_months: 12, is_active: true }).success, true, "codes are upper-cased");
  assert.equal(competencyCommandSchema.safeParse({ command: "catalog.save", id, code: "bad code", name: "QC release", procedure_id: null, validity_months: null, is_active: true }).success, false);
  assert.equal(competencyCommandSchema.safeParse({ command: "catalog.save", id, code: "QC1", name: "QC release", procedure_id: null, validity_months: 61, is_active: true }).success, false);
  assert.equal(competencyCommandSchema.safeParse({ command: "grant.set", employee_id: id, competency_id: id, level: "expert" }).success, false);
  assert.equal(competencyCommandSchema.safeParse({ command: "requirements.set", action: "dispatch", competency_id: null }).success, false);
  assert.ok(canManageCompetencies("factory_manager") && !canManageCompetencies("quality"));
});

let f;
test.before(async () => { f = await createCompetencyFixture(); await f.reset(); });
test.after(async () => { await f?.close(); });

test("database responses parse with the app's schemas", async () => {
  await f.grant(cids.seniorQc, "independent");
  await f.grant(cids.juniorQc, "trained");
  assert.equal(catalogSchema.parse(await f.command("catalog.list", {})).length, 2);
  assert.equal(holdersSchema.parse(await f.command("grants.list", { competency_id: cids.qcRelease })).total_count, 2);
  assert.equal(myGrantsSchema.parse(await f.command("grants.list", { employee_id: cids.juniorQc }, cids.juniorQc)).length, 1);
  assert.equal(standingResultSchema.parse(await f.command("standing", { action: "qc_release" }, cids.juniorQc)).effective, "not_required");
  await f.command("requirements.set", { action: "qc_release", competency_id: cids.qcRelease });
  assert.equal(requirementsSchema.parse(await f.command("requirements.list", {})).length, 2);
  assert.equal(standingResultSchema.parse(await f.command("standing", { action: "qc_release" }, cids.juniorQc)).effective, "trained");
});

test("refusals reach the employee as written, and managers alone administer", () => {
  const holds = readFileSync("lib/actions/production-holds.ts", "utf8");
  assert.match(holds, /message\.startsWith\("You are not authorised for "\) \|\| message\.includes\(" requires supervision for you"\)/);
  const errors = readFileSync("lib/utils/errors.ts", "utf8");
  assert.doesNotMatch("You are not authorised for QC release: your qualification has expired", /permission denied|row-level security/i, "the shared error helper passes these messages through");
  assert.match(errors, /permission denied/);
  assert.match(readFileSync("lib/actions/competencies.ts", "utf8"), /MANAGER_COMMANDS\.has\(command\) && !canManageCompetencies\(context\.role\)/);
});

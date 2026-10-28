import test from "node:test";
import assert from "node:assert/strict";
import { createCompetencyFixture, cids, cid } from "../scripts/lib/competency-fixture.mjs";

let f;
test.before(async () => { f = await createCompetencyFixture(); });
test.beforeEach(async () => { await f.reset(); });
test.after(async () => { await f?.close(); });

const status = async (id = cids.inspection) => (await f.db.query("select status from quality_inspections where id=$1", [id])).rows[0].status;
async function requireQc() {
  await f.grant(cids.seniorQc, "independent");
  await f.command("requirements.set", { action: "qc_release", competency_id: cids.qcRelease });
}

// ---------- Without a requirement nothing changes ----------

test("with no requirement configured, anyone permitted today can still release material", async () => {
  await f.release(cids.traineeQc);
  assert.equal(await status(), "approved");
});

// ---------- Levels ----------

test("an independent holder releases; a trained employee cannot, even though the SOP was read", async () => {
  await requireQc();
  await f.grant(cids.traineeQc, "trained");
  await assert.rejects(f.release(cids.traineeQc), /not authorised for QC release of extruded profiles: training is recorded, but competency has not been confirmed/);
  assert.equal(await status(), "pending");
  await f.release(cids.seniorQc);
  assert.equal(await status(), "approved");
});

test("a supervised employee needs a supervision confirmation from a different independent holder, used once", async () => {
  await requireQc();
  await f.grant(cids.juniorQc, "supervised");
  await assert.rejects(f.release(cids.juniorQc), /requires supervision for you\. An independent holder must confirm supervision first/);
  await assert.rejects(f.command("supervise.confirm", { action: "qc_release", record_id: cids.inspection, performer_id: cids.juniorQc }, cids.traineeQc), /Only an independent holder/);
  await assert.rejects(f.command("supervise.confirm", { action: "qc_release", record_id: cids.inspection, performer_id: cids.seniorQc }, cids.seniorQc), /cannot supervise yourself/);
  assert.deepEqual(await f.command("supervise.confirm", { action: "qc_release", record_id: cids.inspection, performer_id: cids.juniorQc }, cids.seniorQc), { confirmed: true, valid_hours: 8 });
  await f.release(cids.juniorQc);
  assert.equal(await status(), "approved");
  await assert.rejects(f.release(cids.juniorQc, cids.inspection2), /requires supervision/, "the confirmation covered only the first inspection");
  assert.ok((await f.db.query("select used_at from supervision_confirmations")).rows[0].used_at, "the confirmation is consumed");
});

test("a supervision confirmation older than 8 hours no longer counts", async () => {
  await requireQc();
  await f.grant(cids.juniorQc, "supervised");
  await f.command("supervise.confirm", { action: "qc_release", record_id: cids.inspection, performer_id: cids.juniorQc }, cids.seniorQc);
  await f.db.exec(`update supervision_confirmations set confirmed_at = now() - interval '9 hours'`);
  await assert.rejects(f.release(cids.juniorQc), /requires supervision/);
});

test("expiry removes authorisation; a procedure revision makes an independent holder supervised until re-qualified", async () => {
  await requireQc();
  await f.grant(cids.lapsedQc, "independent");
  await f.db.exec(`update employee_competencies set expires_at = now() - interval '1 day' where employee_id='${cids.lapsedQc}'`);
  await assert.rejects(f.release(cids.lapsedQc), /your qualification has expired/);
  await f.db.exec(`update operating_procedures set revision = 4 where id='${cids.sop}'`);
  const standing = await f.command("standing", { action: "qc_release", employee_id: cids.seniorQc });
  assert.deepEqual([standing.granted, standing.effective, standing.reason, standing.current_revision], ["independent", "supervised", "procedure_revised", 4]);
  await assert.rejects(f.release(cids.seniorQc), /the procedure was revised since you qualified/);
  await f.grant(cids.seniorQc, "independent");
  await f.release(cids.seniorQc);
  assert.equal(await status(), "approved");
});

test("grants carry the procedure validity period and keep history when replaced", async () => {
  const first = await f.grant(cids.juniorQc, "supervised");
  assert.equal(first.effective, "supervised");
  const expires = new Date(first.expires_at);
  const months = (expires.getUTCFullYear() - new Date().getUTCFullYear()) * 12 + expires.getUTCMonth() - new Date().getUTCMonth();
  assert.equal(months, 12);
  await f.grant(cids.juniorQc, "independent");
  const rows = (await f.db.query("select level, revoked_at is not null revoked, revoke_reason, procedure_revision from employee_competencies where employee_id=$1 order by granted_at", [cids.juniorQc])).rows;
  assert.deepEqual(rows, [{ level: "supervised", revoked: true, revoke_reason: "Replaced by a new grant", procedure_revision: 3 }, { level: "independent", revoked: false, revoke_reason: null, procedure_revision: 3 }]);
});

test("revoking a competency needs a reason and removes authorisation", async () => {
  await requireQc();
  await f.grant(cids.juniorQc, "independent");
  await assert.rejects(f.command("grant.revoke", { employee_id: cids.juniorQc, competency_id: cids.qcRelease, reason: "x" }), /3 to 300 characters/);
  await f.command("grant.revoke", { employee_id: cids.juniorQc, competency_id: cids.qcRelease, reason: "Failed audit of release records" });
  await assert.rejects(f.release(cids.juniorQc), /no qualification is recorded/);
  await assert.rejects(f.command("grant.revoke", { employee_id: cids.juniorQc, competency_id: cids.qcRelease, reason: "again please" }), /No current grant/);
});

// ---------- Production start and system processes ----------

test("production start can require press operation competency; system processes are not blocked", async () => {
  await f.grant(cids.operator, "independent", cids.pressOp);
  await f.command("requirements.set", { action: "production_start", competency_id: cids.pressOp });
  await assert.rejects(f.act(`update production_jobs set status='in_progress' where id='${cids.job}'`, cids.juniorQc), /not authorised for Extrusion press operation/);
  await f.act(`update production_jobs set status='in_progress' where id='${cids.job}'`, cids.operator);
  await f.act(`update production_jobs set status='ready' where id='${cids.job}'`, cids.operator);
  await f.act(`update production_jobs set status='in_progress' where id='${cids.job}'`, null);
});

// ---------- Administration rules ----------

test("nobody grants their own competency except the owner; only managers grant", async () => {
  await assert.rejects(f.grant(cids.factory, "independent", cids.qcRelease, cids.factory), /cannot grant a competency to yourself/);
  await f.grant(cids.owner, "independent", cids.qcRelease, cids.owner);
  await assert.rejects(f.grant(cids.juniorQc, "independent", cids.qcRelease, cids.seniorQc), /not permitted/);
  await assert.rejects(f.grant(cids.juniorQc, "expert"), /trained, supervised or independent/);
  await assert.rejects(f.grant(cids.foreign, "independent"), /active employee/);
});

test("a requirement needs at least one independent holder, and can be removed", async () => {
  await assert.rejects(f.command("requirements.set", { action: "qc_release", competency_id: cids.qcRelease }), /at least one employee before requiring it/);
  await requireQc();
  const list = await f.command("requirements.list", {}, cids.viewer);
  assert.deepEqual(list.map((r) => [r.action, r.competency_code]), [["production_start", null], ["qc_release", "QC-RELEASE"]]);
  assert.deepEqual(await f.command("requirements.set", { action: "qc_release", competency_id: null }), { action: "qc_release", required: false });
  await f.release(cids.traineeQc);
});

test("catalogue: codes are validated and unique; another company's records stay invisible", async () => {
  await assert.rejects(f.command("catalog.save", { id: cid(60), code: "bad code", name: "Anodizing line" }), /Enter a code/);
  await assert.rejects(f.command("catalog.save", { id: cid(61), code: "QC-RELEASE", name: "Duplicate" }), /already used/);
  await f.command("catalog.save", { id: cid(62), code: "ANOD-1", name: "Anodizing line operation", validity_months: 24 });
  assert.deepEqual((await f.command("catalog.list", {}, cids.viewer)).map((c) => c.code), ["ANOD-1", "PRESS-OP", "QC-RELEASE"]);
  assert.deepEqual(await f.command("catalog.list", {}, cids.foreign), []);
  await assert.rejects(f.command("catalog.save", { id: cids.qcRelease, code: "X1", name: "Hijack attempt" }, cids.foreign), /not permitted|unavailable/);
  await assert.rejects(f.command("supervise.confirm", { action: "qc_release", record_id: cids.foreignInspection, performer_id: cids.juniorQc }, cids.seniorQc), /record is unavailable|does not require/);
});

test("holders and an employee's own competencies are visible to the right people", async () => {
  await f.grant(cids.seniorQc, "independent");
  await f.grant(cids.juniorQc, "supervised");
  const holders = await f.command("grants.list", { competency_id: cids.qcRelease }, cids.viewer);
  assert.deepEqual(holders.rows.map((r) => [r.employee_name, r.level]), [["Junior QC Arjun", "supervised"], ["Senior QC Leela", "independent"]]);
  assert.equal((await f.command("grants.list", { employee_id: cids.juniorQc }, cids.juniorQc)).length, 1, "employees see their own");
  await assert.rejects(f.command("grants.list", { employee_id: cids.seniorQc }, cids.operator), /not permitted/);
  await assert.rejects(f.asUser(`insert into employee_competencies(company_id,employee_id,competency_id,level,granted_by,granted_by_name) values('${cids.company}','${cids.operator}','${cids.qcRelease}','independent','${cids.operator}','x')`, [], cids.operator), /permission denied/);
  await assert.rejects(f.asUser("select public.competency_command('catalog.list','{}'::jsonb)", [], ""), /Authentication required/);
});

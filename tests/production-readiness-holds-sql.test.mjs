import test from "node:test";
import assert from "node:assert/strict";
import { createProductionHoldFixture, hids, hid } from "../scripts/lib/production-hold-fixture.mjs";

let f;
test.before(async () => { f = await createProductionHoldFixture(); });
test.beforeEach(async () => { await f.reset(); });
test.after(async () => { await f?.close(); });

const codes = (issues) => issues.map((issue) => issue.code).sort();
const enforced = (issues) => issues.filter((issue) => issue.enforced).map((issue) => issue.code).sort();
const readiness = (actor) => f.command("holds.readiness", { job_id: hids.job }, actor);
const hold = (extra = {}) => ({ job_id: hids.job, reason: "material_shortage", note: "", material_condition: "1 billet at press, 1 in rack", resume_condition: "Billet batch FB-22 released", responsible_user_id: hids.operator, expected_status: "in_progress", request_id: hid(5000), ...extra });
const job = async () => (await f.db.query("select status, actual_quantity_kg from production_jobs where id=$1", [hids.job])).rows[0];

// ---------- Feature 63: readiness lists everything and agrees with the real guards ----------

test("a planned job lists every missing release prerequisite together", async () => {
  await f.db.query("update production_jobs set die_id=null, machine_id=null where id=$1", [hids.job]);
  const data = await readiness();
  assert.equal(data.job_status, "planned");
  assert.deepEqual(enforced(data.release_issues), ["die_missing", "machine_missing"]);
  assert.deepEqual(data.start_issues, []);
});

test("a ready job with every prerequisite met reports nothing enforced, and the real start succeeds", async () => {
  await f.makeReady();
  const data = await readiness();
  assert.deepEqual(enforced(data.start_issues), []);
  await f.transition("in_progress");
  assert.equal((await job()).status, "in_progress");
});

test("each unmet start prerequisite is reported, and the database rejects the start for the same reason", async () => {
  const scenarios = [
    ["billets_not_issued", async () => {}, /Issue at least one linked billet/],
    ["die_ineligible", async () => f.db.exec(`update dies set die_status='under_correction' where id='${hids.die}'`), /die is no longer eligible/i],
    ["machine_ineligible", async () => f.db.exec(`update machines set status='breakdown' where id='${hids.press}'`), /press is no longer eligible/i],
    ["order_ineligible", async () => f.db.exec(`update orders set current_stage='cancelled' where id='${hids.order}'`), /Order is no longer eligible/],
    ["slot_missing", async () => f.db.exec(`update production_plan_slots set status='planned'`), /released press slot/],
    ["die_busy", async () => f.db.exec(`alter table production_jobs disable trigger user;update production_jobs set status='in_progress' where id='${hids.otherJob}';alter table production_jobs enable trigger user`), /already running/]
  ];
  for (const [code, breakIt, rejection] of scenarios) {
    await f.reset();
    await f.makeReady({ issue: code !== "billets_not_issued" });
    await breakIt();
    const data = await readiness();
    assert.ok(enforced(data.start_issues).includes(code), `${code}: ${JSON.stringify(data.start_issues)}`);
    await assert.rejects(f.transition("in_progress"), rejection, code);
    assert.equal((await job()).status, "ready", code);
  }
});

test("an unapproved drawing is advisory only and never blocks a start", async () => {
  await f.makeReady();
  await f.db.exec(`update aluminium_profiles set drawing_approval_status='pending' where id='${hids.profile}'`);
  const data = await readiness();
  assert.deepEqual(codes(data.start_issues), ["drawing_not_approved"]);
  assert.equal(data.start_issues[0].enforced, false);
  await f.transition("in_progress");
});

test("a linked billet that became scrap or moved to another order now blocks the start", async () => {
  await f.makeReady();
  await f.db.exec(`update foundry_billets set status='scrap' where id='${hids.billet2}'`);
  assert.ok(enforced((await readiness()).start_issues).includes("billet_ineligible"));
  await assert.rejects(f.transition("in_progress"), /B-002 is scrap/);
  await f.db.exec(`update foundry_billets set status='issued', order_id='${hid(29)}' where id='${hids.billet2}'`);
  await assert.rejects(f.transition("in_progress"), /B-002 is now allocated to another order/);
});

// ---------- Feature 72: hold and resume ----------

async function running() {
  await f.makeReady();
  await f.transition("in_progress");
  await f.db.exec(`update production_jobs set actual_quantity_kg=312.5, actual_pieces=80 where id='${hids.job}'`);
}

test("placing a hold records reason, condition, responsibility and progress, and moves the job on hold once", async () => {
  await running();
  const first = await f.command("holds.place", hold(), hids.operator);
  const retry = await f.command("holds.place", hold(), hids.operator);
  assert.equal(first.id, retry.id);
  const row = (await f.db.query("select * from production_job_holds")).rows;
  assert.equal(row.length, 1);
  assert.equal(row[0].responsible_name, "Press Operator Vik");
  assert.equal(row[0].held_by_name, "Press Operator Vik");
  assert.equal(row[0].previous_status, "in_progress");
  assert.equal(Number(row[0].recorded_output_kg), 312.5);
  assert.equal(row[0].issued_billet_count, 1);
  assert.equal(Number(row[0].issued_billet_kg), 25);
  assert.equal((await job()).status, "on_hold");
  const history = (await f.db.query("select previous_status,new_status,reason from production_job_status_history where new_status='on_hold'")).rows;
  assert.equal(history.length, 1);
  assert.match(history[0].reason, /Hold: material shortage/);
  await assert.rejects(f.command("holds.place", hold({ note: "changed" }), hids.operator), /already used for different details/);
});

test("hold input is validated and stale or ineligible jobs cannot be held", async () => {
  await running();
  await assert.rejects(f.command("holds.place", hold({ material_condition: " " })), /Record the hold reason/);
  await assert.rejects(f.command("holds.place", hold({ reason: "other", note: "" })), /Record the hold reason/);
  await assert.rejects(f.command("holds.place", hold({ reason: "coffee_break" })), /Record the hold reason/);
  await assert.rejects(f.command("holds.place", hold({ responsible_user_id: hids.sales })), /active production employee/);
  await assert.rejects(f.command("holds.place", hold({ responsible_user_id: hids.inactive })), /active production employee/);
  await assert.rejects(f.command("holds.place", hold({ responsible_user_id: hids.foreign })), /active production employee/);
  await assert.rejects(f.command("holds.place", hold({ expected_status: "ready" })), /status changed/);
  await f.command("holds.place", hold());
  await assert.rejects(f.command("holds.place", hold({ expected_status: "on_hold", request_id: hid(5001) })), /Only planned, ready or running/);
});

test("a held job cannot be started through the ordinary transition; it must be resumed", async () => {
  await running();
  await f.command("holds.place", hold());
  await assert.rejects(f.transition("in_progress"), /Resume through the recorded hold/);
  const data = await readiness();
  assert.ok(enforced(data.start_issues).includes("active_hold"));
  assert.equal(data.hold.resume_condition, "Billet batch FB-22 released");
  assert.deepEqual(enforced(data.resume_issues), []);
});

test("resuming retains recorded progress, closes the hold once and returns to running", async () => {
  await running();
  const placed = await f.command("holds.place", hold());
  const resume = { job_id: hids.job, hold_id: placed.id, note: "FB-22 released by QC", request_id: hid(6000) };
  await f.command("holds.resume", resume, hids.operator);
  await f.command("holds.resume", resume, hids.operator);
  const current = await job();
  assert.equal(current.status, "in_progress");
  assert.equal(Number(current.actual_quantity_kg), 312.5);
  const rows = (await f.db.query("select status, closed_by_name, close_note from production_job_holds")).rows;
  assert.deepEqual(rows, [{ status: "resumed", closed_by_name: "Press Operator Vik", close_note: "FB-22 released by QC" }]);
  await assert.rejects(f.command("holds.resume", { ...resume, request_id: hid(6001) }), /already resolved/);
  await assert.rejects(f.command("holds.resume", { ...resume, note: "different" }, hids.operator), /already used for different details/);
});

test("resume re-evaluates material and resources that changed during the pause", async () => {
  await running();
  const placed = await f.command("holds.place", hold());
  await f.db.exec(`update foundry_billets set status='scrap' where id='${hids.billet2}'; update machines set status='maintenance' where id='${hids.press}'`);
  const data = await readiness();
  assert.deepEqual(enforced(data.resume_issues), ["billet_ineligible", "machine_ineligible"]);
  await assert.rejects(f.command("holds.resume", { job_id: hids.job, hold_id: placed.id, note: "Trying", request_id: hid(6002) }), /Cannot resume yet\. .*Press 1 is maintenance.*B-002 is scrap/);
  assert.equal((await job()).status, "on_hold");
  assert.equal((await f.db.query("select status from production_job_holds")).rows[0].status, "active");
});

test("a hold placed before release resumes to its earlier planned state, not straight into production", async () => {
  const placed = await f.command("holds.place", hold({ expected_status: "planned" }));
  assert.equal((await job()).status, "on_hold");
  await f.command("holds.resume", { job_id: hids.job, hold_id: placed.id, note: "Customer confirmed", request_id: hid(6003) });
  assert.equal((await job()).status, "planned");
  const last = (await f.db.query("select previous_status,new_status from production_job_status_history order by created_at desc limit 1")).rows[0];
  assert.deepEqual(last, { previous_status: "on_hold", new_status: "planned" });
});

test("cancelling a held job closes its hold with the cancellation reason", async () => {
  await running();
  await f.command("holds.place", hold());
  await f.transition("cancelled");
  const row = (await f.db.query("select status, close_note from production_job_holds")).rows[0];
  assert.deepEqual(row, { status: "cancelled", close_note: "test" });
});

test("hold history is paginated and roles, dealers and foreign companies fail closed", async () => {
  await running();
  await f.command("holds.place", hold());
  const list = await f.command("holds.list", { job_id: hids.job }, hids.viewer);
  assert.equal(list.total_count, 1);
  assert.equal(list.rows[0].reason, "material_shortage");
  await assert.rejects(f.command("holds.place", hold({ request_id: hid(5002) }), hids.viewer), /not permitted/);
  await assert.rejects(f.command("holds.readiness", { job_id: hids.job }, hids.sales), /not permitted/);
  await assert.rejects(f.command("holds.readiness", { job_id: hids.job }, hids.dealer), /not permitted/);
  await assert.rejects(f.command("holds.readiness", { job_id: hids.job }, hids.foreign), /unavailable/);
  await assert.rejects(f.command("holds.unknown", { job_id: hids.job }), /not permitted/);
  await assert.rejects(f.asUser("insert into production_job_holds(id) values(gen_random_uuid())"), /permission denied/);
  assert.deepEqual(await f.asUser("select id from production_job_holds", [], hids.sales), []);
  assert.deepEqual(await f.asUser("select id from production_job_holds", [], hids.foreign), []);
  const grants = (await f.db.query("select has_function_privilege('anon','public.production_hold_command(text,jsonb)','execute') anon")).rows[0];
  assert.equal(grants.anon, false);
});

test("only one active hold may exist per job even under a repeated place request", async () => {
  await running();
  await f.command("holds.place", hold());
  await assert.rejects(f.db.query(`insert into production_job_holds(id,company_id,production_job_id,reason,material_condition,resume_condition,responsible_user_id,responsible_name,previous_status,held_by,held_by_name) values($1,$2,$3,'other','x','y',$4,'n','ready',$4,'n')`,
    [hid(5003), hids.company, hids.job, hids.owner]), /production_job_hold_active_key|duplicate key|check constraint/);
});

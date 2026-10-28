import test from "node:test";
import assert from "node:assert/strict";
import { createProcedureVersionFixture, pids } from "../scripts/lib/procedure-version-fixture.mjs";

let f;
test.before(async () => { f = await createProcedureVersionFixture(); });
test.beforeEach(async () => { await f.reset(); });
test.after(async () => { await f?.close(); });

test("a missing backup cannot authorize an unrelated employee to write or release", async () => {
  await f.db.query('update operating_procedures set backup_id=null,backup_name=null where id=$1',[pids.sop]);
  const list=await f.command('versions.list',{procedure_id:pids.sop},pids.operator);
  assert.equal(list.can_author,false);assert.equal(list.can_review,false);
  await assert.rejects(f.command('draft.save',{procedure_id:pids.sop,version_id:f.nextId(),steps:[{text:'Unapproved replacement'}],change_summary:'Unauthorized change',expected_hash:null},pids.operator),/Only the procedure owner/);
});

const mapDieChange = (procedure = pids.sop) => f.command("kinds.set", { task_kind: "type:die_change", procedure_id: procedure }, pids.owner);

// ---------- Review and release ----------

test("the author cannot release their own version; a different owner, backup or admin can", async () => {
  const draft = await f.command("draft.save", { procedure_id: pids.sop, version_id: f.nextId(), steps: f.steps("Isolate the press"), change_summary: "First issue", expected_hash: null });
  assert.equal(draft.version_no, 1);
  assert.equal(draft.status, "draft");
  const submitted = await f.command("draft.submit", { version_id: draft.id, expected_hash: draft.content_hash });
  const today = await f.daysFromToday(0);
  const release = actor => f.command("review.release", { version_id: draft.id, expected_hash: submitted.content_hash, effective_from: today, in_flight_policy: "keep_current" }, actor);
  await assert.rejects(release(pids.sopOwner), /You wrote this version, so someone else must review it/);
  await assert.rejects(release(pids.operator), /Only the procedure owner, its backup or an owner\/admin can review/);
  const released = await release(pids.sopBackup);
  assert.equal(released.status, "released");
  assert.equal(released.reviewer_name, "Backup Leela");
  const notes = (await f.db.query("select recipient_user_id, title from notifications order by created_at")).rows;
  assert.ok(notes.some(n => n.recipient_user_id === pids.sopBackup && /Review procedure/.test(n.title)), "the reviewer was asked");
  assert.ok(notes.some(n => n.recipient_user_id === pids.sopOwner && /Released/.test(n.title)), "the author was told");
});

test("whoever last edits a draft becomes its author, so an editor cannot approve their own changes", async () => {
  const draft = await f.command("draft.save", { procedure_id: pids.sop, version_id: f.nextId(), steps: f.steps("Isolate the press"), change_summary: "First issue", expected_hash: null }, pids.sopOwner);
  const edited = await f.command("draft.save", { procedure_id: pids.sop, version_id: draft.id, steps: f.steps("Isolate the press", "Lock out"), change_summary: "First issue", expected_hash: draft.content_hash }, pids.sopBackup);
  assert.equal(edited.author_name, "Backup Leela");
  const submitted = await f.command("draft.submit", { version_id: draft.id, expected_hash: edited.content_hash }, pids.sopBackup);
  await assert.rejects(f.command("review.release", { version_id: draft.id, expected_hash: submitted.content_hash, effective_from: await f.daysFromToday(0), in_flight_policy: "keep_current" }, pids.sopBackup), /someone else must review/);
  assert.equal((await f.command("review.release", { version_id: draft.id, expected_hash: submitted.content_hash, effective_from: await f.daysFromToday(0), in_flight_policy: "keep_current" }, pids.sopOwner)).status, "released");
});

test("a reviewer returning a version sends it back to draft with the reason", async () => {
  const draft = await f.command("draft.save", { procedure_id: pids.sop, version_id: f.nextId(), steps: f.steps("Fit die"), change_summary: "First issue", expected_hash: null });
  const submitted = await f.command("draft.submit", { version_id: draft.id, expected_hash: draft.content_hash });
  await assert.rejects(f.command("review.return", { version_id: draft.id, expected_hash: submitted.content_hash, note: "no" }, pids.sopBackup), /Explain what must change/);
  const back = await f.command("review.return", { version_id: draft.id, expected_hash: submitted.content_hash, note: "Add the lock-out step" }, pids.sopBackup);
  assert.equal(back.status, "draft");
  assert.equal(back.review_note, "Add the lock-out step");
});

test("stale versions, duplicate drafts and retried saves are handled", async () => {
  const id = f.nextId();
  const payload = { procedure_id: pids.sop, version_id: id, steps: f.steps("Fit die"), change_summary: "First issue", expected_hash: null };
  const draft = await f.command("draft.save", payload);
  assert.equal((await f.command("draft.save", payload)).id, id, "a retried create returns the same draft");
  await assert.rejects(f.command("draft.save", { ...payload, version_id: f.nextId() }), /already has a draft or a version in review/);
  await assert.rejects(f.command("draft.save", { ...payload, steps: f.steps("Changed"), expected_hash: "stale" }), /changed by someone else/);
  await assert.rejects(f.command("draft.submit", { version_id: id, expected_hash: "stale" }), /changed by someone else/);
  const submitted = await f.command("draft.submit", { version_id: id, expected_hash: draft.content_hash });
  await assert.rejects(f.command("draft.save", { ...payload, steps: f.steps("Changed"), expected_hash: submitted.content_hash }), /Only a draft can be edited/);
});

test("steps and summaries are validated, and trimmed before hashing", async () => {
  const save = (steps, summary = "First issue") => f.command("draft.save", { procedure_id: pids.sop, version_id: f.nextId(), steps, change_summary: summary, expected_hash: null });
  await assert.rejects(save([]), /between 1 and 30 steps/);
  await assert.rejects(save([{ text: "ok" }]), /instruction of 3 to 300 characters/);
  await assert.rejects(save([{ text: "Fit the die", extra: 1 }]), /instruction of 3 to 300 characters/);
  await assert.rejects(save([{ text: "Fit the die", check: "x".repeat(201) }]), /under 200 characters/);
  await assert.rejects(save(Array.from({ length: 31 }, () => ({ text: "Fit the die" }))), /between 1 and 30 steps/);
  await assert.rejects(save(f.steps("Fit the die"), "  "), /Summarise what this version changes/);
  const ok = await save([{ text: "  Fit the die  ", check: "  " }]);
  assert.deepEqual((await f.command("version.load", { version_id: ok.id }, pids.viewer)).steps, [{ text: "Fit the die" }], "blank checks are dropped and text trimmed");
  assert.equal((await f.command("versions.list", { procedure_id: pids.sop })).open.id, ok.id);
  await assert.rejects(f.command("version.load", { version_id: ok.id }, pids.foreign), /Procedure version is unavailable/);
});

// ---------- Immutability and effective dates ----------

test("a released version cannot be edited or deleted, even directly in the database", async () => {
  const v = await f.release();
  await assert.rejects(f.db.query(`update procedure_versions set steps='[{"text":"Changed step"}]' where id=$1`, [v.id]), /cannot be edited/);
  await assert.rejects(f.db.query(`update procedure_versions set effective_from=effective_from-1 where id=$1`, [v.id]), /released procedure version cannot be changed/);
  await assert.rejects(f.db.query(`delete from procedure_versions where id=$1`, [v.id]), /cannot be deleted/);
});

test("effective dates: no back-dating; a scheduled release can be withdrawn only before it takes effect", async () => {
  await assert.rejects(f.release({ effective: await f.daysFromToday(-1) }), /from today up to a year ahead/);
  await f.reset();
  const v1 = await f.release();
  const v2 = await f.release({ summary: "Add trial check", effective: await f.daysFromToday(5) });
  const listed = await f.command("versions.list", { procedure_id: pids.sop });
  assert.equal(listed.current.version_no, 1, "a future release is not yet applicable");
  assert.deepEqual(listed.scheduled.map(s => s.version_no), [2]);
  await assert.rejects(f.release({ summary: "Earlier one", effective: await f.daysFromToday(2) }), /A later release is already scheduled/);
  await assert.rejects(f.command("release.withdraw", { version_id: v1.id, reason: "Mistake" }, pids.sopBackup), /already in effect/);
  const withdrawn = await f.command("release.withdraw", { version_id: v2.id, reason: "Trial postponed" }, pids.sopBackup);
  assert.equal(withdrawn.status, "withdrawn");
  await assert.rejects(f.db.query(`update procedure_versions set status='released' where id=$1`, [v2.id]), /withdrawn procedure version is final/);
});

test("the applicable version is the newest effective release, including two released on the same day", async () => {
  await f.release();
  await f.release({ summary: "Same-day correction" });
  assert.equal((await f.command("versions.list", { procedure_id: pids.sop })).current.version_no, 2);
});

// ---------- Tasks bound to versions ----------

test("a new task of a mapped kind is bound to the applicable version; unmapped and dealer tasks are not", async () => {
  await f.release();
  await mapDieChange();
  const task = await f.addTask();
  assert.equal((await f.binding(task)).version_no, 1);
  assert.equal(await f.binding(await f.addTask({ task_type: "general" })), undefined);
  assert.equal(await f.binding(await f.addTask({ dealership_id: pids.company })), undefined);
  const instructions = await f.command("task.instructions", { task_id: task }, pids.operator);
  assert.equal(instructions.bound, true);
  assert.deepEqual(instructions.version.steps.map(s => s.text), ["Isolate the press", "Fit the die", "Run a trial billet"]);
});

test("acceptance: releasing a revised SOP does not change the instructions recorded for a completed task", async () => {
  await f.release();
  await mapDieChange();
  const done = await f.addTask();
  await f.setStatus(done, "in_progress");
  await f.setStatus(done, "completed");
  await f.release({ summary: "Revised", stepsList: f.steps("New step one", "New step two"), policy: "move_unstarted" });
  const instructions = await f.command("task.instructions", { task_id: done }, pids.operator);
  assert.equal(instructions.version.version_no, 1);
  assert.equal(instructions.newer_version_no, 2);
  assert.ok(instructions.frozen_at);
  await assert.rejects(f.db.query(`update task_procedure_bindings set version_id=(select id from procedure_versions where version_no=2) where task_id=$1`, [done]), /completed task cannot change/);
});

test("in-flight policy: move_unstarted moves open tasks only; started work and keep_current releases keep their version", async () => {
  await f.release();
  await mapDieChange();
  const open = await f.addTask();
  const started = await f.addTask();
  await f.setStatus(started, "in_progress");
  await f.release({ summary: "Keep", policy: "keep_current" });
  assert.equal((await f.binding(open)).version_no, 1, "keep_current leaves open tasks alone");
  const v3 = await f.release({ summary: "Move", policy: "move_unstarted" });
  assert.equal(v3.tasks_changed, 1);
  assert.equal((await f.binding(open)).version_no, 3);
  assert.equal((await f.binding(open)).bound_reason, "release_moved_unstarted");
  assert.equal((await f.binding(started)).version_no, 1, "work underway keeps its version");
  const history = (await f.command("task.instructions", { task_id: open })).history;
  assert.deepEqual(history.map(h => [h.event, h.from_version_no, h.version_no]), [["bound", null, 1], ["moved", 1, 3]]);
});

test("a scheduled move_unstarted release applies when it becomes effective: at task start, or by the scheduler", async () => {
  await f.release();
  await mapDieChange();
  const a = await f.addTask();
  const b = await f.addTask();
  await f.release({ summary: "Scheduled", policy: "move_unstarted", effective: await f.daysFromToday(3) });
  assert.equal((await f.binding(a)).version_no, 1);
  await f.db.exec(`alter table procedure_versions disable trigger a_guard_procedure_version; update procedure_versions set effective_from = private.ist_today() where version_no = 2; alter table procedure_versions enable trigger a_guard_procedure_version`);
  await f.setStatus(a, "in_progress");
  assert.equal((await f.binding(a)).version_no, 2, "starting the task picks up the now-effective version");
  assert.equal((await f.db.query("select private.run_procedure_releases_for_all() n")).rows[0].n, 1);
  assert.equal((await f.binding(b)).version_no, 2);
});

test("mapping a kind binds open unbound tasks; tasks already underway are reported as started before the procedure", async () => {
  await f.release();
  const open = await f.addTask();
  const underway = await f.addTask();
  await f.setStatus(underway, "in_progress");
  assert.equal((await f.command("task.instructions", { task_id: open })).reason, "not_mapped");
  const mapped = await mapDieChange();
  assert.equal(mapped.tasks_bound, 1);
  assert.equal((await f.binding(open)).bound_reason, "kind_mapped");
  assert.equal((await f.command("task.instructions", { task_id: underway })).reason, "started_before_procedure");
});

test("a handoff mapping wins over the generic task type", async () => {
  await f.release();
  await f.release({ procedure: pids.otherSop, author: pids.admin, reviewer: pids.owner, stepsList: f.steps("Strap the bundle") });
  await mapDieChange();
  await f.command("kinds.set", { task_kind: "handoff:packaging", procedure_id: pids.otherSop }, pids.owner);
  const task = await f.addTask({ task_type: "die_change", handoff_team: "packaging" });
  assert.equal((await f.command("task.instructions", { task_id: task })).procedure_title, "Bundle strapping");
});

test("reopening a completed task unfreezes it but keeps its version", async () => {
  await f.release();
  await mapDieChange();
  const task = await f.addTask();
  await f.setStatus(task, "completed");
  await f.setStatus(task, "open");
  const b = await f.binding(task);
  assert.equal(b.frozen_at, null);
  assert.equal(b.started_at, null, "a task completed without being started has no recorded start");
  await f.release({ summary: "Move", policy: "move_unstarted" });
  assert.equal((await f.binding(task)).version_no, 1);
});

// ---------- Permissions and tenancy ----------

test("roles: viewers read only, operators cannot write versions, dealers and other companies see nothing", async () => {
  await f.release();
  const id = f.nextId();
  await assert.rejects(f.command("draft.save", { procedure_id: pids.sop, version_id: id, steps: f.steps("Fit die"), change_summary: "Second", expected_hash: null }, pids.viewer), /not permitted for your role/);
  await assert.rejects(f.command("draft.save", { procedure_id: pids.sop, version_id: id, steps: f.steps("Fit die"), change_summary: "Second", expected_hash: null }, pids.operator), /Only the procedure owner/);
  assert.equal((await f.command("versions.list", { procedure_id: pids.sop }, pids.viewer)).total_count, 1);
  await assert.rejects(f.command("versions.list", { procedure_id: pids.sop }, pids.dealer), /not permitted for your role/);
  await assert.rejects(f.command("versions.list", { procedure_id: pids.sop }, pids.foreign), /Procedure is unavailable/);
  await assert.rejects(f.command("kinds.set", { task_kind: "type:die_change", procedure_id: pids.foreignSop }, pids.owner), /Procedure is unavailable/);
  await assert.rejects(f.command("kinds.set", { task_kind: "type:die_change", procedure_id: pids.sop }, pids.operator), /not permitted for your role/);
  await assert.rejects(f.command("kinds.set", { task_kind: "bad kind", procedure_id: pids.sop }, pids.owner), /Choose the kind of task/);
  await assert.rejects(f.asUser("select * from procedure_versions", [], pids.sopOwner), /permission denied/);
});

test("versions are listed newest first, ten per page", async () => {
  for (let i = 0; i < 11; i++) await f.release({ summary: `Issue ${i + 1}` });
  const first = await f.command("versions.list", { procedure_id: pids.sop });
  assert.equal(first.total_count, 11);
  assert.equal(first.rows.length, 10);
  assert.equal(first.rows[0].version_no, 11);
  assert.equal((await f.command("versions.list", { procedure_id: pids.sop, page: 2 })).rows[0].version_no, 1);
  await assert.rejects(f.command("versions.list", { procedure_id: pids.sop, page: 0 }), /Invalid page/);
});

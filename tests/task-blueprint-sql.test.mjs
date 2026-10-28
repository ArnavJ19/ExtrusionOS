import test from "node:test";
import assert from "node:assert/strict";
import { createTaskBlueprintFixture, bids } from "../scripts/lib/task-blueprint-fixture.mjs";

let f;
test.before(async () => { f = await createTaskBlueprintFixture(); });
test.beforeEach(async () => { await f.reset(); });
test.after(async () => { await f?.close(); });
test('blueprint directory pages, filters and searches records on the server',async()=>{
 for(let n=0;n<12;n++)await f.command('blueprint.save',f.blueprint({task_kind:`type:sample_${n}`,title:`Sample ${String(n).padStart(2,'0')}`,is_active:n!==11}));
 const first=await f.command('blueprints.list',{sort:'title'});const second=await f.command('blueprints.list',{sort:'title',page:2});
 assert.equal(first.rows.length,10);assert.equal(second.rows.length,2);assert.equal(first.total_count,12);
 assert.equal((await f.command('blueprints.list',{status:'inactive',search:'Sample 11'})).rows[0].title,'Sample 11');
 assert.equal((await f.command('blueprints.list',{search:'%'})).total_count,0);
 await assert.rejects(f.command('blueprints.list',{page:0}),/Invalid page/);
});

test("unassigned work cannot authorize an unrelated employee to raise an exception", async () => {
  const b=f.blueprint();await f.command('blueprint.save',b);const task=await f.addTask({assigned_to:null});
  const view=await f.command('task.blueprint',{task_id:task},bids.operator);assert.equal(view.can_raise,false);
  await assert.rejects(f.command('exception.raise',{id:f.nextId(),task_id:task,reason:'Unassigned work issue'},bids.operator),/Only the assignee/);
});

const status = async task => (await f.db.query("select status from tasks where id=$1", [task])).rows[0].status;

// ---------- Without a blueprint nothing changes ----------

test("a task kind without a blueprint starts exactly as before", async () => {
  const task = await f.addTask({ assigned_to: null, related_entity_id: null });
  await f.start(task);
  assert.equal(await status(task), "in_progress");
  assert.deepEqual(await f.command("task.blueprint", { task_id: task }), { has_blueprint: false });
});

// ---------- Acceptance: same structure, own requirements ----------

test("acceptance: two task kinds expose the same eight-part structure while enforcing their own requirements", async () => {
  await f.command("blueprint.save", f.blueprint());
  await f.command("blueprint.save", f.blueprint({ task_kind: "type:packing_check", title: "Packing check", responsible_roles: ["quality"],
    prerequisites: [{ kind: "record_state", entity_type: "order", states: ["packing"] }], exception_role: "dispatch_manager" }));
  const dieTask = await f.addTask();
  const packTask = await f.addTask({ task_type: "packing_check", assigned_to: bids.quality, related_entity_type: "order", related_entity_id: bids.order });
  const a = await f.command("task.blueprint", { task_id: dieTask });
  const b = await f.command("task.blueprint", { task_id: packTask });
  const parts = ["title", "purpose", "trigger_text", "inputs", "responsible_roles", "prerequisites", "procedure", "criteria_templates", "exception_role", "exception_instruction"];
  for (const part of parts) assert.ok(part in a.blueprint && part in b.blueprint, part);
  assert.equal(a.blueprint.criteria_templates, 1);
  assert.deepEqual(a.evaluation.checks.map(c => c.kind), ["assignee_role", "record_state"]);
  assert.equal(b.evaluation.checks[1].label, "Linked order is packing");
  // Each kind enforces its own rules: a production operator may not run the packing check.
  await f.db.query("update tasks set assigned_to=$2 where id=$1", [packTask, bids.operator]);
  await assert.rejects(f.start(packTask), /cannot start yet: the assignee is production, not a responsible role/);
  await f.start(dieTask);
  assert.equal(await status(dieTask), "in_progress");
});

test("start is refused while prerequisites are unmet, by any path, with a short reason", async () => {
  await f.command("blueprint.save", f.blueprint());
  const unassigned = await f.addTask({ assigned_to: null });
  await assert.rejects(f.start(unassigned), /cannot start yet: nobody is assigned/);
  const held = await f.addTask({ related_entity_id: bids.heldJob });
  await assert.rejects(f.start(held), /the linked production job is on hold, not ready or planned/);
  const unlinked = await f.addTask({ assigned_to: bids.quality, related_entity_type: null, related_entity_id: null });
  const refusal = await f.start(unlinked).catch(error => error.message);
  assert.match(refusal, /the assignee is quality, not a responsible role; the linked production job state is not captured/);
  assert.ok(refusal.length <= 240);
  await assert.rejects(f.addTask({ status: "in_progress", assigned_to: null }), /cannot start yet/, "creating a task already in progress is checked too");
  await assert.rejects(f.addTask({ related_entity_id: bids.foreignJob }).then(f.start), /state is not captured/, "another company's record never satisfies a prerequisite");
});

test("a missing record or state is never treated as satisfied", async () => {
  await f.command("blueprint.save", f.blueprint({ prerequisites: [{ kind: "linked_record", entity_type: "production_job" }] }));
  const ghost = await f.addTask({ related_entity_id: bids.otherCompany });
  await assert.rejects(f.start(ghost), /the linked production job is unavailable/);
});

test("the blueprint revision checked at start is recorded; later edits do not rewrite it", async () => {
  const saved = await f.command("blueprint.save", f.blueprint());
  const task = await f.addTask();
  await f.start(task);
  await f.command("blueprint.save", { ...f.blueprint({ id: saved.id, responsible_roles: ["production_manager"], note: "Supervisors only" }), expected_revision: 1 });
  const view = await f.command("task.blueprint", { task_id: task });
  assert.equal(view.started_check.revision, 1);
  assert.equal(view.blueprint.revision, 2);
  assert.equal(view.evaluation.unmet, 1, "the current blueprint is evaluated live");
});

test("handoff blueprints win over task-type blueprints; inactive blueprints do not apply", async () => {
  await f.command("blueprint.save", f.blueprint());
  const handoff = await f.command("blueprint.save", f.blueprint({ task_kind: "handoff:packaging", title: "Packaging handoff", responsible_roles: ["dispatch"], prerequisites: [] }));
  const task = await f.addTask({ handoff_team: "packaging" });
  assert.equal((await f.command("task.blueprint", { task_id: task })).blueprint.title, "Packaging handoff");
  await f.command("blueprint.save", { ...f.blueprint({ id: handoff.id, task_kind: "handoff:packaging", title: "Packaging handoff", responsible_roles: ["dispatch"], prerequisites: [], is_active: false, note: "Paused" }), expected_revision: 1 });
  assert.equal((await f.command("task.blueprint", { task_id: task })).blueprint.title, "Die change");
});

// ---------- Saving ----------

test("blueprint content is validated and edits need the current revision", async () => {
  const save = overrides => f.command("blueprint.save", f.blueprint(overrides));
  await assert.rejects(save({ responsible_roles: [] }), /Choose at least one responsible employee role/);
  await assert.rejects(save({ responsible_roles: ["dealer_admin"] }), /Choose at least one responsible employee role/);
  await assert.rejects(save({ responsible_roles: ["viewer"] }), /Choose at least one responsible employee role/);
  await assert.rejects(save({ prerequisites: [{ kind: "record_state", entity_type: "production_job", states: ["flying"] }] }), /not valid for that record type/);
  await assert.rejects(save({ prerequisites: [{ kind: "record_state", entity_type: "production_job", states: [] }] }), /at least one state/);
  await assert.rejects(save({ prerequisites: [{ kind: "linked_record", entity_type: "production_job" }, { kind: "linked_record", entity_type: "order" }] }), /same linked record type/);
  await assert.rejects(save({ prerequisites: [{ kind: "sql", entity_type: "order" }] }), /needs a kind and a record type/);
  await assert.rejects(save({ inputs: ["x"] }), /2 to 120 characters/);
  await assert.rejects(save({ exception_role: "dealer_admin" }), /role that resolves exceptions/);
  await assert.rejects(save({ purpose: " " }), /Fill in the title, purpose/);
  await assert.rejects(save({ note: "" }), /Record why the blueprint is saved/);
  await assert.rejects(save({ task_kind: "type:Bad Kind" }), /Choose the kind of task/);
  const first = await save();
  await assert.rejects(save(), /already has a blueprint/);
  await assert.rejects(f.command("blueprint.save", { ...f.blueprint({ id: first.id }), expected_revision: 9 }), /changed by someone else/);
  const other = await save({ task_kind: "type:packing_check" });
  await assert.rejects(f.command("blueprint.save", { ...f.blueprint({ id: other.id }), expected_revision: 1 }), /already has a blueprint/, "moving a blueprint onto a taken kind is refused plainly");
  const loaded = await f.command("blueprint.load", { blueprint_id: first.id });
  assert.equal(loaded.revisions.length, 1);
  assert.equal(loaded.revisions[0].snapshot.title, "Die change");
});

test("only managers save blueprints; every internal employee reads them; dealers and other companies cannot", async () => {
  await assert.rejects(f.command("blueprint.save", f.blueprint(), bids.operator), /not permitted for your role/);
  const saved = await f.command("blueprint.save", f.blueprint());
  assert.equal((await f.command("blueprints.list", {}, bids.viewer)).total_count, 1);
  await assert.rejects(f.command("blueprints.list", {}, bids.dealer), /not permitted/);
  await assert.rejects(f.command("blueprint.load", { blueprint_id: saved.id }, bids.foreign), /Blueprint is unavailable/);
  await assert.rejects(f.asUser("select * from task_blueprints", [], bids.factory), /permission denied/);
});

// ---------- Exception route ----------

test("an exception is routed to the blueprint's role, once per task, and resolved by someone else in that role", async () => {
  await f.command("blueprint.save", f.blueprint());
  const task = await f.addTask();
  const id = f.nextId();
  await assert.rejects(f.command("exception.raise", { task_id: task, id, reason: "Die cracked" }, bids.operator2), /Only the assignee or a supervisor/);
  const raised = await f.command("exception.raise", { task_id: task, id, reason: "Die cracked on trial" }, bids.operator);
  assert.equal(raised.routed_role, "production_manager");
  assert.deepEqual(await f.command("exception.raise", { task_id: task, id, reason: "Die cracked on trial" }, bids.operator), raised, "a retry returns the same exception");
  await assert.rejects(f.command("exception.raise", { task_id: task, id: f.nextId(), reason: "Second problem" }, bids.operator), /already open for this task/);
  const note = (await f.db.query("select recipient_role, title from notifications where notification_type='task_exception'")).rows[0];
  assert.deepEqual(note, { recipient_role: "production_manager", title: "Task exception: Task" });
  const queue = await f.command("exceptions.list", {}, bids.sopOwner);
  assert.equal(queue.total_count, 1);
  assert.equal(queue.rows[0].can_resolve, true);
  assert.equal((await f.command("exceptions.list", {}, bids.quality)).total_count, 0, "other roles do not see it");
  await assert.rejects(f.command("exception.resolve", { exception_id: id, resolution: "Fine" }, bids.quality), /Only the role this exception is routed to/);
  await assert.rejects(f.command("exception.resolve", { exception_id: id, resolution: "x" }, bids.sopOwner), /Record the outcome/);
  assert.equal((await f.command("exception.resolve", { exception_id: id, resolution: "Spare die issued from rack B4" }, bids.sopOwner)).status, "resolved");
  await assert.rejects(f.command("exception.resolve", { exception_id: id, resolution: "Again" }, bids.sopOwner), /already resolved/);
  assert.equal((await f.db.query("select count(*)::int n from notifications where notification_type='task_exception' and recipient_user_id=$1", [bids.operator])).rows[0].n, 1);
});

test("a supervisor who raised an exception cannot resolve it themselves", async () => {
  await f.command("blueprint.save", f.blueprint());
  const task = await f.addTask();
  const id = f.nextId();
  await f.command("exception.raise", { task_id: task, id, reason: "Billets short" }, bids.sopOwner);
  await assert.rejects(f.command("exception.resolve", { exception_id: id, resolution: "Ordered more" }, bids.sopOwner), /Someone other than the employee who raised it/);
  assert.equal((await f.command("exceptions.list", {}, bids.sopOwner)).rows[0].can_resolve, false);
});

test("exceptions need a blueprint and an open task", async () => {
  const plain = await f.addTask({ task_type: "general" });
  await assert.rejects(f.command("exception.raise", { task_id: plain, id: f.nextId(), reason: "Stuck" }, bids.operator), /has no blueprint/);
  await f.command("blueprint.save", f.blueprint());
  const done = await f.addTask({ status: "completed" });
  await assert.rejects(f.command("exception.raise", { task_id: done, id: f.nextId(), reason: "Stuck" }, bids.operator), /only while the task is open/);
});

test("the procedure version from feature 77 appears as the blueprint's steps", async () => {
  await f.command("blueprint.save", f.blueprint());
  const draft = await f.asUser("select public.procedure_version_command('draft.save',$1) d", [{ procedure_id: bids.sop, version_id: f.nextId(), steps: [{ text: "Fit the die" }], change_summary: "First", expected_hash: null }], bids.sopOwner);
  const submitted = await f.asUser("select public.procedure_version_command('draft.submit',$1) d", [{ version_id: draft[0].d.id, expected_hash: draft[0].d.content_hash }], bids.sopOwner);
  const today = (await f.db.query("select private.ist_today()::text d")).rows[0].d;
  await f.asUser("select public.procedure_version_command('review.release',$1) d", [{ version_id: draft[0].d.id, expected_hash: submitted[0].d.content_hash, effective_from: today, in_flight_policy: "keep_current" }], bids.sopBackup);
  await f.asUser("select public.procedure_version_command('kinds.set',$1) d", [{ task_kind: "type:die_change", procedure_id: bids.sop }], bids.owner);
  const task = await f.addTask();
  assert.deepEqual((await f.command("task.blueprint", { task_id: task })).blueprint.procedure, { id: bids.sop, title: "Die change on press 2", version_no: 1 });
});

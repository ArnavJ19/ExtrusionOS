import test from "node:test";
import assert from "node:assert/strict";
import { createDelegationFixture, gids, gid } from "../scripts/lib/delegation-fixture.mjs";

let f;
test.before(async () => { f = await createDelegationFixture(); });
test.beforeEach(async () => { await f.reset(); });
test.after(async () => { await f?.close(); });

const items = async () => Object.fromEntries((await f.db.query("select task_id, how, outcome from task_delegation_items")).rows.map((r) => [r.task_id, r]));
const expire = (id = gid(5000)) => f.db.exec(`update task_delegations set starts_at = now() - interval '2 days', ends_at = now() - interval '1 minute' where id='${id}'`);

// ---------- Delegating ----------

test("all open tasks move to an eligible replacement; finished, foreign and other-team work stays", async () => {
  const result = await f.create();
  assert.deepEqual([result.moved, result.replayed], [4, false]);
  for (const task of [gids.t1, gids.t2, gids.t3, gids.tPackHandoff]) assert.equal(await f.assignee(task), gids.cover, task);
  assert.equal(await f.assignee(gids.tDone), gids.absent, "completed work is not moved");
  assert.equal(await f.assignee(gids.tForeign), gids.absent, "another company's task is never touched");
  assert.equal(await f.assignee(gids.tDispatchHandoff), gids.absent, "a production operator is not eligible for a dispatch handoff");
  const [note] = (await f.db.query("select recipient_user_id, title from notifications")).rows;
  assert.deepEqual([note.recipient_user_id, note.title], [gids.cover, "You are covering tasks temporarily"]);
});

test("a selection moves only the chosen tasks", async () => {
  const result = await f.create({ scope: "selected", task_ids: [gids.t1, gids.tDone, gids.tOther] });
  assert.equal(result.moved, 1, "completed and someone else's tasks are skipped");
  assert.equal(await f.assignee(gids.t1), gids.cover);
  assert.equal(await f.assignee(gids.t3), gids.absent);
});

test("retrying the same create is idempotent; reusing its identity for other people is refused", async () => {
  await f.create();
  const retry = await f.create();
  assert.deepEqual([retry.moved, retry.replayed], [4, true]);
  await assert.rejects(f.create({ delegate_id: gids.cover2 }), /already used for different details/);
});

// ---------- Redirects, expiry and cancellation ----------

test("work newly assigned to the absent employee goes to the delegate while the delegation is active", async () => {
  await f.create();
  await f.db.exec(`insert into tasks(id,company_id,title,assigned_to) values('${gid(300)}','${gids.company}','New urgent job','${gids.absent}');
    update tasks set assigned_to='${gids.absent}' where id='${gids.tOther}'`);
  assert.equal(await f.assignee(gid(300)), gids.cover);
  assert.equal(await f.assignee(gids.tOther), gids.cover);
  const it = await items();
  assert.equal(it[gid(300)].how, "redirected");
});

test("expiry returns unfinished work to its owner and records what happened to every task", async () => {
  await f.create();
  await f.db.exec(`update tasks set status='completed' where id='${gids.t2}'; update tasks set assigned_to='${gids.cover2}' where id='${gids.t3}'`);
  await expire();
  assert.deepEqual(await f.command("delegation.sync", {}, gids.viewer), { activated: 0, expired: 1 });
  assert.equal(await f.assignee(gids.t1), gids.absent, "returned");
  assert.equal(await f.assignee(gids.t3), gids.cover2, "a task reassigned meanwhile is left with its new owner");
  const it = await items();
  assert.deepEqual([it[gids.t1].outcome, it[gids.t2].outcome, it[gids.t3].outcome, it[gids.tPackHandoff].outcome], ["returned", "completed", "reassigned", "returned"]);
  assert.deepEqual(await f.command("delegation.sync", {}, gids.viewer), { activated: 0, expired: 0 }, "a second sync changes nothing");
  await f.db.exec(`update tasks set assigned_to='${gids.absent}' where id='${gids.tOther}'`);
  assert.equal(await f.assignee(gids.tOther), gids.absent, "no redirect after expiry");
});

test("if the owner has left by expiry, unfinished work stays with the delegate rather than becoming unowned", async () => {
  await f.create();
  await f.db.exec(`update app_users set is_active=false where id='${gids.absent}'`);
  await expire();
  await f.command("delegation.sync", {});
  assert.equal(await f.assignee(gids.t1), gids.cover);
  assert.equal((await items())[gids.t1].outcome, "kept_by_delegate");
});

test("cancelling early needs a reason and returns the work the same way", async () => {
  await f.create();
  await assert.rejects(f.command("delegation.cancel", { id: gid(5000), note: "x" }), /3 to 300 characters/);
  assert.deepEqual(await f.command("delegation.cancel", { id: gid(5000), note: "Back from leave early" }), { id: gid(5000), returned: 4 });
  await assert.rejects(f.command("delegation.cancel", { id: gid(5000), note: "again please" }), /already ended/);
  assert.equal(await f.assignee(gids.t1), gids.absent);
});

test("a scheduled delegation moves nothing until it starts, then activates once", async () => {
  const result = await f.create({ starts_at: f.hours(24), ends_at: f.hours(72) });
  assert.deepEqual([result.moved, result.scheduled], [0, true]);
  assert.equal(await f.assignee(gids.t1), gids.absent);
  await f.db.exec(`update task_delegations set starts_at = now() - interval '1 minute' where id='${gid(5000)}'`);
  assert.deepEqual(await f.command("delegation.sync", {}), { activated: 1, expired: 0 });
  assert.equal(await f.assignee(gids.t1), gids.cover);
  assert.deepEqual(await f.command("delegation.sync", {}), { activated: 0, expired: 0 });
});

// ---------- Rules ----------

test("periods, overlaps and chains are refused", async () => {
  await assert.rejects(f.create({ ends_at: f.hours(-1) }), /starts now or later/);
  await assert.rejects(f.create({ ends_at: f.hours(24 * 91) }), /at most 90 days/);
  await assert.rejects(f.create({ starts_at: f.hours(-1) }), /starts now or later/);
  await assert.rejects(f.create({ ends_at: "next week" }), /valid start and end/);
  await f.create();
  await assert.rejects(f.create({ request_id: gid(5001), delegate_id: gids.cover2 }), /already has a delegation in that period/);
  await assert.rejects(f.create({ request_id: gid(5002), delegator_id: gids.cover2, delegate_id: gids.absent }), /replacement is away/);
  await assert.rejects(f.create({ request_id: gid(5003), scope: "selected", task_ids: [gids.t1], delegator_id: gids.cover2, delegate_id: gids.cover, starts_at: f.hours(5), ends_at: f.hours(10) }), /delegated from now/);
});

test("replacement and reason checks", async () => {
  await assert.rejects(f.create({ delegate_id: gids.absent }), /different employee/);
  await assert.rejects(f.create({ delegate_id: gids.inactive }), /replacement must be active/);
  await assert.rejects(f.create({ delegate_id: gids.foreign }), /replacement must be active/);
  await assert.rejects(f.create({ reason: "x" }), /3 to 300 characters/);
  await assert.rejects(f.create({ scope: "selected", task_ids: [] }), /between 1 and 100 tasks/);
});

test("supervisors delegate only between employees in their teams; owners anywhere", async () => {
  await assert.rejects(f.create({ delegate_id: gids.driver }), /teams you supervise/);
  await assert.rejects(f.create({}, gids.dispatchManager), /teams you supervise/);
  await assert.rejects(f.create({}, gids.absent), /not permitted/);
  await assert.rejects(f.create({}, gids.viewer), /not permitted/);
  const ownerResult = await f.create({ delegate_id: gids.driver }, gids.owner);
  assert.equal(ownerResult.moved, 1, "a dispatch loader may hold only the dispatch handoff");
  assert.equal(await f.assignee(gids.tDispatchHandoff), gids.driver);
  assert.equal(await f.assignee(gids.t1), gids.absent, "general production work is not given to a dispatch loader");
});

// ---------- Visibility ----------

test("lists and details are limited to supervisors and the people involved; other companies see nothing", async () => {
  await f.create();
  assert.equal((await f.command("delegation.list", {}, gids.cover)).total_count, 1);
  assert.equal((await f.command("delegation.list", {}, gids.cover2)).total_count, 0);
  assert.equal((await f.command("delegation.list", {}, gids.foreign)).total_count, 0);
  const detail = await f.command("delegation.load", { id: gid(5000) }, gids.absent);
  assert.equal(detail.items.length, 4);
  assert.equal(detail.delegate_name, "Operator Ravi");
  await assert.rejects(f.command("delegation.load", { id: gid(5000) }, gids.cover2), /unavailable/);
  await assert.rejects(f.command("delegation.load", { id: gid(5000) }, gids.foreign), /unavailable/);
  assert.equal((await f.command("delegation.list", { status: "closed" })).total_count, 0);
  await assert.rejects(f.asUser("select public.task_delegation_command('delegation.list','{}'::jsonb)", [], ""), /Authentication required/);
  await assert.rejects(f.asUser(`insert into task_delegations(id,company_id,delegator_id,delegate_id,starts_at,ends_at,scope,reason,created_by,created_by_name) values('${gid(1)}','${gids.company}','${gids.absent}','${gids.cover}',now(),now()+interval '1 day','all_open','x x','${gids.owner}','x')`), /permission denied/);
});

test("candidates list the absent employee's open tasks and show which are already held", async () => {
  await f.create({ scope: "selected", task_ids: [gids.t1] });
  const rows = await f.command("delegation.candidates", { delegator_id: gids.absent });
  assert.deepEqual(rows.map((r) => [r.title, r.held]).sort(), [["Check puller", false], ["Dispatch 400 kg", false], ["Pack 100 kg", false], ["Re-stack bundles", false]]);
});

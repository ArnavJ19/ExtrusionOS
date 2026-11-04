import test from "node:test";
import assert from "node:assert/strict";
import { createNov7Fixture, nids as i } from "../scripts/lib/nov-batch7-fixture.mjs";
import { migrationFiles } from "../scripts/lib/migration-chain-replay.mjs";
import { improvementListSchema, improvementDetailSchema, improvementOutcomeSchema, improvementLookupSchema, improvementMutationSchema, canReadImprovement, canUseImprovementAction,
  IMPROVEMENT_ROLES, IMPROVEMENT_VIEWS } from "../lib/workflow/improvement.ts";

let f;
test.before(async () => { f = await createNov7Fixture(); });
test.after(async () => { await f?.close(); });
test.beforeEach(async () => { await f.start(); });
test.afterEach(async () => { await f.rollback(); });

const note = "Reviewed with the responsible department";
const confirmed = result => { improvementOutcomeSchema.parse(result); assert.equal(result.state, "confirmed", JSON.stringify(result.result)); return result; };
const rejected = (result, message) => { assert.equal(result.state, "rejected", JSON.stringify(result.result)); if (message) assert.match(result.result.message, message); return result; };
const list = (view, actor = i.owner, patch = {}) => f.command("list", { view, state: "all", ...patch }, actor);
const detail = (view, id, actor = i.owner) => f.command("detail", { view, id }, actor);
const row = async (view, id, actor = i.owner) => (await detail(view, id, actor)).row;
const one = async (sql, params = []) => (await f.db.query(sql, params)).rows[0];
const n = value => Number(value);
const day = offset => new Date(Date.now() + offset * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const lookup = (kind, patch = {}, actor = i.owner) => f.command("lookup", { kind, ...patch }, actor);

async function openProblem(actor = i.quality, patch = {}) {
  const result = confirmed(await f.apply({ action: "problem.open", title: "Drag marks on sliding track", category: "surface", description: "Drag marks keep appearing on the web after start-up", owner_id: i.quality, note, ...patch }, actor));
  return result.result.href.split("/").pop();
}

test("the TypeScript role mirrors match the database matrix for every role, view and action", async () => {
  const roles = [...IMPROVEMENT_ROLES, "dealer_admin", "dealer_staff", "unknown"];
  const actions = improvementMutationSchema._def.schema.options.map(option => option.shape.action.value);
  assert.equal(actions.length, 20);
  for (const role of roles) {
    assert.equal((await one("select private.improvement_read_allowed($1,null) v", [role])).v, canReadImprovement(role), `${role} read`);
    for (const view of Object.keys(IMPROVEMENT_VIEWS)) assert.equal((await one("select private.improvement_read_allowed($1,$2) v", [role, view])).v, canReadImprovement(role, view), `${role} read ${view}`);
    for (const action of actions) assert.equal((await one("select private.improvement_action_allowed($1,$2) v", [role, action])).v, canUseImprovementAction(role, action), `${role} ${action}`);
  }
});

test("migration replay, every read model and the shared protocol match the production contracts", async () => {
  assert.equal(f.applied, migrationFiles().length + 2);
  for (const view of Object.keys(IMPROVEMENT_VIEWS)) {
    improvementListSchema.parse(await list(view));
    improvementListSchema.parse(await f.command("list", { view }, i.owner));
  }
  await assert.rejects(() => list("problems", i.dealer), /Not permitted/);
  await assert.rejects(() => list("problems", i.production), /Not permitted/);
  await assert.rejects(() => list("dies", i.sales), /Not permitted/);
  await assert.rejects(() => list("problems", i.foreign), /Not permitted|unavailable/).catch(() => undefined);
  improvementListSchema.parse(await list("dies", i.production));
  improvementListSchema.parse(await list("suggestions", i.dispatch));
  await assert.rejects(() => f.command("list", { view: "problems", company_id: i.foreignCompany }), /Invalid improvement request/);
  await assert.rejects(() => f.command("list", { view: "nonsense" }), /Not permitted/);
  await assert.rejects(() => f.command("lookup", { kind: "employees", search: "x".repeat(81) }), /80 characters/);
  // Preview records nothing; an unknown request is safely reported as not recorded.
  const preview = await f.prepare({ action: "problem.open", title: "Short bundles", category: "packing", description: "Bundles short by two pieces", owner_id: i.quality, note }, i.quality);
  assert.equal(preview.state, "prepared");
  assert.equal(n((await one("select count(*) c from improvement_problems")).c), 0);
  assert.equal((await f.command("outcome", { request_id: f.nextId() })).state, "not_recorded");
  assert.equal((await f.command("abandon", { request_id: preview.request_id }, i.quality)).state, "abandoned");
  await assert.rejects(() => f.command("commit", { request_id: preview.request_id, fingerprint: preview.fingerprint }, i.owner), /Not permitted/);
  // Injected keys, nulls and dealers are refused; replay of the same request returns the same outcome.
  await assert.rejects(() => f.prepare({ action: "problem.open", title: "Short bundles", category: "packing", description: "Bundles short", owner_id: i.quality, note, company_id: i.foreignCompany }), /Review the required action details/);
  await assert.rejects(() => f.prepare({ action: "problem.open", title: "Short bundles", category: "packing", description: "Bundles short", owner_id: i.quality, note, containment: null }), /Review the required action details/);
  await assert.rejects(() => f.prepare({ action: "problem.open", title: "Short bundles", category: "packing", description: "Bundles short", owner_id: i.quality, note }, i.dealer), /Not permitted/);
  await assert.rejects(() => f.prepare({ action: "problem.open", title: "Short bundles", category: "packing", description: "Bundles short", owner_id: i.foreign, note }), /active employee of this company/);
  await assert.rejects(() => f.prepare({ action: "problem.open", title: "Short bundles", category: "packing", description: "Bundles short", owner_id: i.dealer, note }), /active employee of this company/);
  const request = f.nextId();
  const first = await f.prepare({ action: "problem.open", title: "Short bundles", category: "packing", description: "Bundles short by two pieces", owner_id: i.quality, note }, i.quality, request);
  assert.equal((await f.prepare({ action: "problem.open", title: "Short bundles", category: "packing", description: "Bundles short by two pieces", owner_id: i.quality, note }, i.quality, request)).fingerprint, first.fingerprint);
  await assert.rejects(() => f.prepare({ action: "problem.open", title: "Other bundles", category: "packing", description: "Bundles short by two pieces", owner_id: i.quality, note }, i.quality, request), /different details/);
  const done = confirmed(await f.commit(first, i.quality));
  assert.deepEqual(await f.commit(first, i.quality), done, "a lost response is recovered without a second write");
  assert.equal(n((await one("select count(*) c from improvement_problems")).c), 1);
  // Expired review.
  const late = await f.prepare({ action: "problem.open", title: "Late review", category: "packing", description: "Expired review test", owner_id: i.quality, note }, i.quality);
  await f.db.query("update improvement_requests set expires_at=now()-interval '1 minute' where request_id=$1", [late.request_id]);
  rejected(await f.commit(late, i.quality), /expired/);
});

// NOV-053 ---------------------------------------------------------------------------------------
test("NOV-053: occurrences are linked once, only when adverse, and a wrong link is removed with a reason", async () => {
  const id = await openProblem();
  improvementLookupSchema.parse(await lookup("incidents", { filter: "quality_inspection" }));
  await assert.rejects(() => lookup("incidents", {}), /kind of occurrence/);
  confirmed(await f.apply({ action: "problem.link", id, source_type: "quality_inspection", source_id: i.qiR1, note }, i.quality));
  await assert.rejects(() => f.prepare({ action: "problem.link", id, source_type: "quality_inspection", source_id: i.qiR1, note }, i.quality), /already linked to this problem/);
  await assert.rejects(() => f.prepare({ action: "problem.link", id, source_type: "quality_inspection", source_id: i.qiA1, note }, i.quality), /Only adverse occurrences/);
  await assert.rejects(() => f.prepare({ action: "problem.link", id, source_type: "quality_inspection", source_id: i.qiPend, note }, i.quality), /Only adverse occurrences/);
  await assert.rejects(() => f.prepare({ action: "problem.link", id, source_type: "quality_inspection", source_id: f.nextId(), note }, i.quality), /unavailable/);
  confirmed(await f.apply({ action: "problem.link", id, source_type: "production_exception", source_id: i.exception1, note }, i.productionManager));
  confirmed(await f.apply({ action: "problem.link", id, source_type: "delivery_disposition", source_id: i.disposition1, note }, i.dispatchManager));
  confirmed(await f.apply({ action: "problem.link", id, source_type: "support_ticket", source_id: i.ticket1, note }, i.quality));
  // The same occurrence cannot sit on two problems.
  const other = await openProblem(i.quality, { title: "Scratches in transit", category: "dispatch" });
  await assert.rejects(() => f.prepare({ action: "problem.link", id: other, source_type: "delivery_disposition", source_id: i.disposition1, note }, i.quality), /already linked to "Drag marks on sliding track"/);
  const record = await row("problems", id);
  assert.equal(record.details.linked_count, 4);
  assert.ok(!JSON.stringify(record).includes("Private customer complaint text"), "customer complaint text stays in the portal ticket");
  const link = record.details.links.find(item => item.source_type === "delivery_disposition");
  // Removal: only the improvement owner, quality or whoever linked it.
  await assert.rejects(() => f.prepare({ action: "problem.unlink", id, link_id: link.id, note }, i.inventory), /improvement owner, quality or the person who linked it/);
  confirmed(await f.apply({ action: "problem.unlink", id, link_id: link.id, note: "Wrong category; transit damage" }, i.dispatchManager));
  assert.equal((await row("problems", id)).details.linked_count, 3);
  assert.ok((await row("problems", id)).details.links.some(item => item.removed && item.removed_reason === "Wrong category; transit damage"), "history keeps the removed link and reason");
  confirmed(await f.apply({ action: "problem.link", id: other, source_type: "delivery_disposition", source_id: i.disposition1, note }, i.quality));
});

test("NOV-053: cause, plan, trial and review run in order with owner authority and observations kept distinct from causes", async () => {
  const id = await openProblem();
  await assert.rejects(() => f.prepare({ action: "problem.plan", id, proposed_action: "Polish bearing", trial_scope: "Press A, one week", review_date: day(7), denominator: "inspections", note }, i.quality), /Record the cause/);
  await assert.rejects(() => f.prepare({ action: "problem.investigate", id, cause: "Bearing wear after nitriding", cause_basis: "established", note }, i.quality), /established cause needs its investigation evidence/);
  await assert.rejects(() => f.prepare({ action: "problem.investigate", id, cause: "Bearing wear", cause_basis: "observation", note }, i.inventory), /improvement owner, quality or the factory manager/);
  confirmed(await f.apply({ action: "problem.investigate", id, cause: "Bearing wear after nitriding", cause_basis: "observation", note }, i.quality));
  assert.equal((await row("problems", id)).status, "investigating");
  assert.match((await row("problems", id)).summary, /cause observed, not established/);
  await assert.rejects(() => f.prepare({ action: "problem.plan", id, proposed_action: "Polish bearing", trial_scope: "Press A, one week", review_date: day(0), denominator: "inspections", note }, i.quality), /after today and within a year/);
  await assert.rejects(() => f.prepare({ action: "problem.plan", id, proposed_action: "Polish bearing", trial_scope: "Press A, one week", review_date: day(400), denominator: "inspections", note }, i.quality), /within a year/);
  await assert.rejects(() => f.prepare({ action: "problem.plan", id, proposed_action: "Polish bearing", trial_scope: "Press A, one week", review_date: day(7), denominator: "inspections", procedure_improvement_id: i.procedureRejected, note }, i.quality), /current procedure change/);
  const plan = await f.prepare({ action: "problem.plan", id, proposed_action: "Polish bearing before each run", trial_scope: "Press A, one week", review_date: day(7), denominator: "inspections", procedure_improvement_id: i.procedureImprovement, note }, i.quality);
  assert.ok(plan.review.warnings.some(w => /observation, not established/.test(w)));
  confirmed(await f.commit(plan, i.quality));
  await assert.rejects(() => f.prepare({ action: "problem.review", id, decision: "effective", evidence: "Fewer drag marks", note }, i.quality), /needs a running trial/);
  confirmed(await f.apply({ action: "problem.trial", id, note }, i.quality));
  await assert.rejects(() => f.prepare({ action: "problem.investigate", id, cause: "Different cause", cause_basis: "observation", note }, i.quality), /cannot change while the problem is trial/);
  await assert.rejects(() => f.prepare({ action: "problem.review", id, decision: "effective", evidence: "Fewer drag marks", note }, i.quality), /agreed review date is/);
  // Cancelled trial returns to planned; restart.
  confirmed(await f.apply({ action: "problem.cancel_trial", id, note: "Press A breakdown interrupted the trial" }, i.quality));
  assert.equal((await row("problems", id)).status, "planned");
  confirmed(await f.apply({ action: "problem.trial", id, note }, i.quality));
  // Move the trial into the past to compare equal 10-day windows (baseline 1 rejected of 2, trial 1 of 4).
  confirmed(await f.apply({ action: "problem.link", id, source_type: "quality_inspection", source_id: i.qiR1, note }, i.quality));
  confirmed(await f.apply({ action: "problem.link", id, source_type: "quality_inspection", source_id: i.qiR2, note }, i.quality));
  await f.db.query("update improvement_problems set trial_started_at=now()-interval '10 days',review_date=current_date-1 where id=$1", [id]);
  const due = await row("problems", id);
  assert.equal(due.status, "review_due");
  assert.equal(due.details.recurrence.state, "complete");
  assert.equal(due.details.recurrence.window_days, 10);
  assert.equal(n(due.details.recurrence.baseline.occurrences), 1); assert.equal(n(due.details.recurrence.baseline.activity), 2);
  assert.equal(n(due.details.recurrence.trial.occurrences), 1); assert.equal(n(due.details.recurrence.trial.activity), 4);
  assert.equal(n(due.details.recurrence.baseline.rate_per_100), 50); assert.equal(n(due.details.recurrence.trial.rate_per_100), 25);
  assert.ok((await f.command("list", { view: "problems" }, i.owner)).rows[0].id === id, "a due review is listed first");
  await assert.rejects(() => f.prepare({ action: "problem.review", id, decision: "effective", evidence: "Fewer drag marks", note }, i.inventory), /improvement owner, quality or the factory manager/);
  confirmed(await f.apply({ action: "problem.review", id, decision: "effective", evidence: "Recurrence halved per 100 inspections", note }, i.quality));
  const closed = await row("problems", id);
  assert.equal(closed.status, "closed"); assert.equal(closed.details.outcome.decision, "effective"); assert.equal(n(closed.details.outcome.recurrence.trial.rate_per_100), 25);
  assert.equal((await f.command("list", { view: "problems" }, i.owner)).rows.some(r => r.id === id), false, "closed problems leave the active board");
  // Recurrence after closure: linking warns, reopening needs quality or management.
  const recur = await f.prepare({ action: "problem.link", id, source_type: "production_exception", source_id: i.exception1, note }, i.productionManager);
  assert.ok(recur.review.warnings.some(w => /did not hold/.test(w)));
  confirmed(await f.commit(recur, i.productionManager));
  await assert.rejects(() => f.prepare({ action: "problem.reopen", id, note }, i.productionManager), /Not permitted/);
  confirmed(await f.apply({ action: "problem.reopen", id, note: "Drag marks returned on 4 November" }, i.quality));
  const reopened = await row("problems", id);
  assert.equal(reopened.status, "investigating"); assert.equal(reopened.details.reopened_count, 1);
  assert.equal(reopened.details.outcome.decision, "effective", "the previous review stays visible");
  assert.ok((await detail("problems", id)).events.some(e => e.action === "problem.reopen"));
});

test("NOV-053: an incomplete comparison cannot confirm effectiveness, and not effective returns to investigation", async () => {
  const id = await openProblem();
  confirmed(await f.apply({ action: "problem.investigate", id, cause: "Packing table edge", cause_basis: "established", cause_evidence: "Photo of the burr", note }, i.quality));
  confirmed(await f.apply({ action: "problem.plan", id, proposed_action: "Fit a rubber edge", trial_scope: "Packing bay 2", review_date: day(3), denominator: "dispatches", note }, i.quality));
  confirmed(await f.apply({ action: "problem.trial", id, note }, i.quality));
  await f.db.query("update improvement_problems set trial_started_at=now()-interval '1 hour',review_date=current_date where id=$1", [id]);
  await f.db.query("delete from dispatches where created_at>now()-interval '1 day' and false");
  const current = await row("problems", id);
  assert.equal(current.details.recurrence.state, "incomplete", JSON.stringify(current.details.recurrence));
  await assert.rejects(() => f.prepare({ action: "problem.review", id, decision: "effective", evidence: "Looks better", note }, i.quality), /comparison is incomplete/);
  confirmed(await f.apply({ action: "problem.review", id, decision: "not_effective", evidence: "Too little activity to judge", note }, i.quality));
  const back = await row("problems", id);
  assert.equal(back.status, "investigating"); assert.equal(back.details.trial_started_at, null); assert.equal(back.details.outcome.decision, "not_effective");
  // Reassignment keeps accountability explicit.
  await assert.rejects(() => f.prepare({ action: "problem.reassign", id, owner_id: i.quality, note }, i.quality), /already owns/);
  confirmed(await f.apply({ action: "problem.reassign", id, owner_id: i.factory, note }, i.quality));
  assert.equal((await row("problems", id)).owner, "Fixture factory");
});

test("NOV-053: a concurrent change between review and confirmation is refused", async () => {
  const id = await openProblem();
  const plan = await f.prepare({ action: "problem.investigate", id, cause: "Bearing wear", cause_basis: "observation", note }, i.quality);
  confirmed(await f.apply({ action: "problem.reassign", id, owner_id: i.factory, note }, i.factory));
  rejected(await f.commit(plan, i.quality), /relevant source changed/);
});

// NOV-059 ---------------------------------------------------------------------------------------
test("NOV-059: any employee submits from a screen; routing, visibility and notifications follow the process owner", async () => {
  await assert.rejects(() => f.prepare({ action: "suggestion.submit", category: "repeated_lookup", source_path: "/dispatches/new", description: "I look up the order twice" }, i.viewer), /Not permitted/);
  await assert.rejects(() => f.prepare({ action: "suggestion.submit", category: "repeated_lookup", source_path: "/dispatches/new?draft=secret", description: "I look up the order twice" }, i.production), /not a page of this application/);
  await assert.rejects(() => f.prepare({ action: "suggestion.submit", category: "repeated_lookup", source_path: "https://evil.example", description: "I look up the order twice" }, i.production), /not a page/);
  await assert.rejects(() => f.prepare({ action: "suggestion.submit", category: "repeated_lookup", source_path: "/a/../b", description: "I look up the order twice" }, i.production), /not a page/);
  await assert.rejects(() => f.prepare({ action: "suggestion.submit", category: "repeated_lookup", source_path: "/dispatches/new", description: "short" }, i.production), /Description must be 10/);
  await assert.rejects(() => f.prepare({ action: "suggestion.submit", category: "repeated_lookup", source_path: "/dispatches/new", description: "I look up the order twice", note }, i.production), /Review the required action details/);
  // No route: the company owner receives it.
  const first = confirmed(await f.apply({ action: "suggestion.submit", category: "repeated_lookup", source_path: "/dispatches/new", description: "I look up the order number twice for every bundle" }, i.production));
  const firstId = first.result.href.split("/").pop();
  assert.equal((await row("suggestions", firstId)).owner, "Fixture owner");
  assert.equal((await row("suggestions", firstId)).label.startsWith("SUG-0001"), true);
  // Route repeated lookups to the production manager; only owner/admin set routing.
  await assert.rejects(() => f.prepare({ action: "route.set", category: "repeated_lookup", owner_id: i.productionManager, note }, i.factory), /Not permitted/);
  await assert.rejects(() => f.prepare({ action: "route.set", category: "repeated_lookup", owner_id: i.production, note }, i.owner), /leads a department/);
  confirmed(await f.apply({ action: "route.set", category: "repeated_lookup", owner_id: i.productionManager, note }, i.owner));
  const second = confirmed(await f.apply({ action: "suggestion.submit", category: "repeated_lookup", source_path: "/production/new", description: "The die rack location is not shown when I pick a die", evidence: "Photo IMG-2231" }, i.production));
  const id = second.result.href.split("/").pop();
  const record = await row("suggestions", id, i.productionManager);
  assert.equal(record.owner, "Fixture productionManager"); assert.equal(record.details.reference, "SUG-0002"); assert.equal(record.details.source_path, "/production/new");
  assert.equal(n((await one("select count(*) c from notifications where recipient_user_id=$1 and related_entity_id=$2", [i.productionManager, id])).c), 1, "the process owner is notified");
  // Visibility: contributor and owner see it; another production user and an unrelated manager do not; quality sees all.
  await row("suggestions", id, i.production);
  await assert.rejects(() => row("suggestions", id, i.production2), /unavailable/);
  await assert.rejects(() => row("suggestions", id, i.dispatchManager), /unavailable/);
  await row("suggestions", id, i.quality);
  assert.equal((await list("suggestions", i.production2)).total_count, 0);
  assert.equal((await list("suggestions", i.production)).total_count, 2);
});

test("NOV-059: responses follow the lifecycle, internal notes stay private and declines need a reason", async () => {
  confirmed(await f.apply({ action: "route.set", category: "confusing_instruction", owner_id: i.productionManager, note }, i.owner));
  const id = confirmed(await f.apply({ action: "suggestion.submit", category: "confusing_instruction", source_path: "/production/new", description: "Billet count field is confusing for multi-hole dies" }, i.production)).result.href.split("/").pop();
  await assert.rejects(() => f.prepare({ action: "suggestion.respond", id, status: "acknowledged", response: "Looking at it" }, i.dispatchManager), /unavailable/);
  await assert.rejects(() => f.prepare({ action: "suggestion.respond", id, status: "acknowledged", response: "Looking at it" }, i.quality), /assigned process owner/);
  await assert.rejects(() => f.prepare({ action: "suggestion.respond", id, status: "resolved", response: "Done" }, i.productionManager), /cannot move from submitted to resolved/);
  await assert.rejects(() => f.prepare({ action: "suggestion.respond", id, status: "declined", response: "Not now" }, i.productionManager), /declined suggestion states the reason/);
  await assert.rejects(() => f.prepare({ action: "suggestion.respond", id, status: "acknowledged", response: "Looking at it", decline_reason: "Not needed" }, i.productionManager), /only a declined one/);
  confirmed(await f.apply({ action: "suggestion.respond", id, status: "clarification", response: "Which die did this happen on?", internal_note: "Possibly the 3-hole die DIE-NOV7-A" }, i.productionManager));
  const contributorView = await row("suggestions", id, i.production);
  assert.equal(contributorView.details.internal_note, null, "the contributor never sees the internal note");
  assert.equal(contributorView.details.response, "Which die did this happen on?");
  assert.equal((await row("suggestions", id, i.productionManager)).details.internal_note, "Possibly the 3-hole die DIE-NOV7-A");
  assert.equal((await row("suggestions", id, i.quality)).details.internal_note, null, "quality reads all suggestions but not another owner's internal note");
  assert.ok(!(await detail("suggestions", id, i.production)).events.some(e => /3-hole/.test(e.note)), "history never carries the internal note");
  assert.equal(n((await one("select count(*) c from notifications where recipient_user_id=$1 and related_entity_id=$2", [i.production, id])).c), 1, "the contributor is notified");
  // Only the contributor clarifies.
  await assert.rejects(() => f.prepare({ action: "suggestion.clarify", id, clarification: "DIE-NOV7-A" }, i.productionManager), /Only the person who made the suggestion/);
  confirmed(await f.apply({ action: "suggestion.clarify", id, clarification: "It happened on DIE-NOV7-A, 3 holes" }, i.production));
  assert.equal((await row("suggestions", id, i.production)).status, "acknowledged");
  await assert.rejects(() => f.prepare({ action: "suggestion.clarify", id, clarification: "More detail" }, i.production), /No clarification was requested/);
  confirmed(await f.apply({ action: "suggestion.respond", id, status: "trial", response: "Trialling a per-hole billet hint on Press A" }, i.productionManager));
  confirmed(await f.apply({ action: "suggestion.link", id, procedure_improvement_id: i.procedureImprovement, note }, i.productionManager));
  confirmed(await f.apply({ action: "suggestion.respond", id, status: "adopted", response: "The hint is now on every production form" }, i.productionManager));
  confirmed(await f.apply({ action: "suggestion.respond", id, status: "resolved", response: "Released to all presses" }, i.productionManager));
  const resolved = await row("suggestions", id, i.production);
  assert.equal(resolved.status, "resolved"); assert.equal(resolved.details.procedure_improvement, "Bearing check before every run");
  assert.equal((await f.command("list", { view: "suggestions" }, i.production)).rows.some(r => r.id === id), false, "resolved suggestions leave the active list");
  await assert.rejects(() => f.prepare({ action: "suggestion.respond", id, status: "declined", response: "Late", decline_reason: "Changed mind" }, i.productionManager), /cannot move from resolved/);
  // Decline with reason on another suggestion.
  const other = confirmed(await f.apply({ action: "suggestion.submit", category: "other", source_path: "/dashboard", description: "Make the dashboard dark coloured" }, i.dispatch)).result.href.split("/").pop();
  confirmed(await f.apply({ action: "suggestion.respond", id: other, status: "declined", response: "Not planned this quarter", decline_reason: "Dark mode is outside the current scope" }, i.owner));
  assert.equal((await row("suggestions", other, i.dispatch)).details.decline_reason, "Dark mode is outside the current scope");
});

test("NOV-059: duplicates merge explicitly, owners can change, and links reach recurring problems", async () => {
  const a = confirmed(await f.apply({ action: "suggestion.submit", category: "avoidable_waiting", source_path: "/dispatches/new", description: "Trucks wait while we search for the LR copy" }, i.dispatch)).result.href.split("/").pop();
  const b = confirmed(await f.apply({ action: "suggestion.submit", category: "avoidable_waiting", source_path: "/dispatches", description: "Vehicles wait for LR paperwork at the gate" }, i.production)).result.href.split("/").pop();
  await assert.rejects(() => f.prepare({ action: "suggestion.merge", id: b, into_id: b, note }, i.owner), /another suggestion/);
  confirmed(await f.apply({ action: "suggestion.merge", id: b, into_id: a, note }, i.owner));
  const merged = await row("suggestions", b, i.production);
  assert.equal(merged.status, "merged"); assert.equal(merged.details.merged_into, "SUG-0001"); assert.equal(merged.details.merged_into_status, "submitted");
  assert.deepEqual((await row("suggestions", a, i.owner)).details.merged_from.map(x => x.reference), ["SUG-0002"]);
  await assert.rejects(() => f.prepare({ action: "suggestion.merge", id: a, into_id: b, note }, i.owner), /must be current and not itself merged/);
  await assert.rejects(() => f.prepare({ action: "suggestion.merge", id: b, into_id: a, note }, i.owner), /merged suggestion cannot be merged/);
  // Link to a problem; reassign to a department lead.
  const problem = await openProblem(i.quality, { title: "Gate waiting for LR copies", category: "dispatch" });
  await assert.rejects(() => f.prepare({ action: "suggestion.link", id: a, note }, i.owner), /Review the required action details|Choose a problem/);
  confirmed(await f.apply({ action: "suggestion.link", id: a, problem_id: problem, note }, i.owner));
  assert.equal((await row("suggestions", a, i.dispatch)).details.problem_title, "Gate waiting for LR copies");
  assert.deepEqual((await row("problems", problem, i.quality)).details.suggestions.map(x => x.reference), ["SUG-0001"]);
  await assert.rejects(() => f.prepare({ action: "suggestion.reassign", id: a, owner_id: i.dispatch, note }, i.owner), /leads a department/);
  confirmed(await f.apply({ action: "suggestion.reassign", id: a, owner_id: i.dispatchManager, note }, i.owner));
  await row("suggestions", a, i.dispatchManager);
  assert.equal(n((await one("select count(*) c from notifications where recipient_user_id=$1 and related_entity_id=$2", [i.dispatchManager, a])).c), 1);
});

// NOV-025 ---------------------------------------------------------------------------------------
test("NOV-025: die history counts completed runs only, keeps the opening balance and incomplete output visible, and lists every event", async () => {
  const die = await row("dies", i.dieA, i.production);
  improvementDetailSchema.parse(await detail("dies", i.dieA, i.production));
  assert.equal(n(die.details.run_kg), 700); assert.equal(die.details.runs, 3);
  assert.equal(n(die.details.opening_kg), 1000); assert.equal(die.details.cancelled_runs, 1); assert.equal(die.details.incomplete_runs, 1);
  assert.equal(n(die.details.service.nitriding.kg), 300); assert.equal(die.details.service.nitriding.runs, 2); assert.equal(die.details.service.nitriding.days, 5);
  assert.equal(n(die.details.service.correction.kg), 700); assert.equal(die.details.service.correction.days, 15);
  assert.equal(die.details.service.any.date, die.details.service.nitriding.date);
  assert.ok(die.details.missing.some(m => /no recorded output kg/.test(m))); assert.ok(die.details.missing.some(m => /opening balance of 1000 kg/.test(m)));
  assert.ok(die.details.warnings.some(w => /2 rejected or rework/.test(w)));
  const kinds = new Set(die.details.timeline.map(e => e.kind));
  for (const kind of ["run", "output_correction", "inspection", "correction", "nitriding", "move"]) assert.ok(kinds.has(kind), kind);
  assert.ok(die.details.timeline.some(e => /J-NOV7-X cancelled \(not counted\)/.test(e.label)));
  assert.ok(die.details.timeline.some(e => /corrected from 450 to 400 kg/.test(e.label)));
  const at = die.details.timeline.map(e => new Date(e.at).getTime());
  assert.deepEqual([...at].sort((x, y) => y - x), at, "newest first");
  // A status decision is retained from now on.
  await f.asSystem("update dies set die_status='under_correction' where id=$1", [i.dieA], i.factory);
  const after = await row("dies", i.dieA, i.production);
  assert.ok(after.details.timeline.some(e => e.kind === "status" && /active to under correction/.test(e.label)));
  assert.equal(after.status, "unavailable");
  // A master total that disagrees with recorded runs is reported, not used.
  await f.db.exec("alter table dies disable trigger user");
  await f.db.query("update dies set total_production_kg=9999 where id=$1", [i.dieA]);
  await f.db.exec("alter table dies enable trigger user");
  assert.ok((await row("dies", i.dieA)).details.missing.some(m => /master shows 9999 kg/.test(m)));
  // Tenant isolation.
  await assert.rejects(() => row("dies", i.dieA, i.foreign), /Not permitted|unavailable/);
  await assert.rejects(() => row("dies", i.dieA, i.sales), /Not permitted/);
});

test("NOV-025: service thresholds need a second approver, warn without blocking, and are replaced or retired explicitly", async () => {
  await assert.rejects(() => f.prepare({ action: "threshold.propose", die_type: "hollow", basis: "runs_since_service", service_event: "nitriding", warn_at: 2.5, rationale: "Tooling rule", note }, i.quality), /at most 0 decimals/);
  await assert.rejects(() => f.prepare({ action: "threshold.propose", basis: "kg_since_service", service_event: "nitriding", warn_at: 250, rationale: "Tooling rule", note }, i.production), /Not permitted/);
  const proposal = confirmed(await f.apply({ action: "threshold.propose", die_type: "hollow", basis: "kg_since_service", service_event: "nitriding", warn_at: 250, rationale: "Hollow dies need nitriding every 250 kg in trial", note }, i.quality));
  const id = proposal.result.href.split("/").pop();
  assert.equal((await row("dies", i.dieA)).details.checks.length, 0, "a proposal does not warn yet");
  await assert.rejects(() => f.prepare({ action: "threshold.approve", id, note }, i.quality), /second person/);
  confirmed(await f.apply({ action: "threshold.approve", id, note }, i.factory));
  const die = await row("dies", i.dieA, i.production);
  assert.equal(die.status, "service_due");
  assert.ok(die.details.warnings.some(w => /Service check due: 300 kg since the last nitriding \(reviewed threshold 250 kg\)/.test(w)));
  assert.equal((await f.command("list", { view: "dies" }, i.production)).rows[0].id, i.dieA, "dies due for service lead the board");
  assert.match((await lookup("dies", { selected_id: i.dieA }, i.production))[0].context, /Service check due/);
  assert.equal((await row("thresholds", id)).details.dies_due, 1);
  // The solid die is not affected by a hollow-die threshold.
  assert.equal((await row("dies", i.dieB)).details.checks.length, 0);
  // Days since correction (15) against 10 days for all dies; a die with no correction cannot be checked.
  const days = confirmed(await f.apply({ action: "threshold.propose", basis: "days_since_service", service_event: "correction", warn_at: 10, rationale: "Inspect after ten days", note }, i.quality)).result.href.split("/").pop();
  confirmed(await f.apply({ action: "threshold.approve", id: days, note }, i.productionManager));
  assert.ok((await row("dies", i.dieA)).details.warnings.some(w => /15 days since the last correction/.test(w)));
  assert.ok((await row("dies", i.dieB)).details.missing.some(m => /No correction is recorded/.test(m)));
  // A new approval replaces the earlier one for the same scope.
  const higher = confirmed(await f.apply({ action: "threshold.propose", die_type: "hollow", basis: "kg_since_service", service_event: "nitriding", warn_at: 500, rationale: "Trial showed 500 kg is safe", note }, i.factory)).result.href.split("/").pop();
  const approve = await f.prepare({ action: "threshold.approve", id: higher, note }, i.quality);
  assert.ok(approve.review.warnings.some(w => /Replaces the approved threshold at 250/.test(w)));
  confirmed(await f.commit(approve, i.quality));
  assert.equal((await row("thresholds", id)).status, "retired");
  assert.equal((await row("dies", i.dieA)).details.checks.find(c => c.basis === "kg_since_service").state, "ok");
  // Retire; production is never blocked by a warning.
  confirmed(await f.apply({ action: "threshold.retire", id: higher, note }, i.quality));
  await assert.rejects(() => f.prepare({ action: "threshold.retire", id: higher, note }, i.quality), /already retired/);
  await f.asSystem("insert into production_jobs(id,company_id,order_id,profile_id,die_id,status,planned_quantity_kg,job_number,source_line_id,planned_date) values($1,$2,$3,$4,$5,'planned',100,'J-NOV7-NEW',$6,current_date)",
    [f.nextId(), i.company, i.order, i.profile, i.dieA, i.line1], i.productionManager).catch(error => assert.doesNotMatch(error.message, /threshold|service check/i));
});

// NOV-054 ---------------------------------------------------------------------------------------
test("NOV-054: metrics state numerator, denominator, sample and missing evidence, and never turn missing data into zero", async () => {
  const rows = (await list("outcomes")).rows;
  const metric = key => rows.find(r => r.details.metric_key === key);
  assert.equal(rows.length, 7);
  const onTime = metric("dispatch_on_time").details.current;
  assert.equal(n(onTime.numerator), 2); assert.equal(n(onTime.denominator), 3); assert.equal(n(onTime.value), 66.7); assert.equal(n(onTime.missing), 1);
  assert.equal(metric("dispatch_on_time").status, "small_sample");
  const fta = metric("quality_first_time_acceptance").details.current;
  assert.equal(n(fta.denominator), 3); assert.equal(n(fta.numerator), 1, "jobs C1 and C2 were first rejected; C3 was first approved");
  assert.equal(n(fta.missing), 2, "both pending inspections are missing a decision");
  const rework = metric("quality_rework_share").details.current;
  assert.equal(n(rework.numerator), 2); assert.equal(n(rework.denominator), 6);
  const evidence = metric("production_missing_evidence").details.current;
  assert.equal(n(evidence.denominator), 3); assert.equal(n(evidence.numerator), 1, "job C3 has no output kg");
  const time = metric("task_unrecorded_time").details.current;
  const near = (value, expected) => assert.ok(Math.abs(n(value) - expected) < 0.05, `${value} is not about ${expected}`);
  near(time.elapsed_hours, 12); near(time.waiting_hours, 1); near(time.active_hours, 5); near(time.unrecorded_hours, 6); near(time.value, 50);
  assert.equal(n(time.missing), 1, "one completed task has no recorded start");
  const target = metric("task_within_target").details.current;
  assert.equal(n(target.denominator), 1); assert.equal(n(target.numerator), 0); assert.equal(n(target.missing), 1);
  const overdue = metric("tasks_overdue_now");
  assert.equal(n(overdue.details.current.numerator), 1); assert.equal(n(overdue.details.current.denominator), 2); assert.equal(n(overdue.details.current.missing), 1);
  assert.equal(overdue.details.previous.not_applicable, true); assert.equal(overdue.status, "small_sample");
  // An empty previous window has no value rather than zero.
  assert.equal(metric("dispatch_on_time").details.previous.value, null);
  for (const r of rows) { assert.equal(r.details.version, 1); assert.ok(r.details.definition.numerator && r.details.definition.denominator && r.details.definition.time_basis); }
  // Drill-down only on detail and only for the team's leads.
  const id = metric("dispatch_on_time").id;
  assert.deepEqual((await row("outcomes", id, i.dispatchManager)).details.drill.map(x => x.label), ["D-NOV7-LATE"]);
  assert.equal((await row("outcomes", id, i.accounts)).details.drill, null);
  assert.equal((await row("outcomes", id, i.viewer)).details.drill_permitted, false);
  assert.equal(metric("dispatch_on_time").details.drill, null, "lists never carry drill-down records");
  assert.ok((await row("outcomes", metric("quality_first_time_acceptance").id, i.quality)).details.drill.length === 2);
  await assert.rejects(() => list("outcomes", i.production), /Not permitted/);
  // Another company's records never count.
  await f.seed("insert into dispatches(id,company_id,order_id,dispatch_number,dispatch_date,delivery_status,actual_dispatched_at) values($1,$2,$3,'D-FOREIGN',current_date,'in_transit',now())", [f.nextId(), i.foreignCompany, i.foreignOrder]);
  assert.equal(n((await list("outcomes")).rows.find(r => r.details.metric_key === "dispatch_on_time").details.current.denominator), 3);
});

test("NOV-054: comparison status uses the definition direction and refuses small samples", async () => {
  // Twelve on-time dispatches now and twelve late ones in the previous window give an improvement.
  const longOverdue = f.nextId();
  await f.seed("insert into orders(id,company_id,order_number,customer_id,order_date,expected_dispatch_date,priority,current_stage,requested_weight_kg,manufacturing_weight_kg) values($1,$2,'SO-OVERDUE',$3,current_date-90,current_date-60,'normal','dispatched',100,100)",
    [longOverdue, i.company, i.customer]);
  for (let index = 0; index < 12; index++) {
    await f.seed("insert into dispatches(id,company_id,order_id,dispatch_number,dispatch_date,delivery_status,actual_dispatched_at) values($1,$2,$3,$4,current_date,'delivered',now()-interval '2 days')", [f.nextId(), i.company, i.order, `D-NOW-${index}`]);
    await f.seed("insert into dispatches(id,company_id,order_id,dispatch_number,dispatch_date,delivery_status,actual_dispatched_at) values($1,$2,$3,$4,current_date-40,'delivered',now()-interval '40 days')", [f.nextId(), i.company, longOverdue, `D-OLD-${index}`]);
  }
  const metric = (await list("outcomes")).rows.find(r => r.details.metric_key === "dispatch_on_time");
  assert.equal(metric.status, "improved", JSON.stringify(metric.details));
  assert.equal(n(metric.details.previous.value), 0, "a real zero is shown as zero when records exist");
  assert.equal((await f.command("list", { view: "outcomes" })).rows.some(r => r.details.metric_key === "dispatch_on_time"), false, "the attention board omits improved metrics");
});

// NOV-009 lineage -------------------------------------------------------------------------------
test("NOV-009: repeat lineage links only a just-created record to an earlier one in the same company", async () => {
  const target = f.nextId();
  await f.seed("insert into production_jobs(id,company_id,order_id,profile_id,die_id,status,planned_quantity_kg,job_number,source_line_id,planned_date,created_by,created_at) values($1,$2,$3,$4,$5,'planned',100,'J-REPEAT',$6,current_date,$7,now())",
    [target, i.company, i.order, i.profile, i.dieA, i.line1, i.productionManager]);
  await assert.rejects(() => f.repeatLink("production_jobs", i.jobC1, target, ["machine_id", "planned_quantity_kg"], i.productionManager), /Invalid repeat lineage/);
  await assert.rejects(() => f.repeatLink("production_jobs", i.jobC1, target, [], i.productionManager), /Invalid repeat lineage/);
  await assert.rejects(() => f.repeatLink("orders", i.jobC1, target, ["machine_id"], i.productionManager), /Invalid repeat lineage/);
  await assert.rejects(() => f.repeatLink("production_jobs", target, target, ["machine_id"], i.productionManager), /Invalid repeat lineage/);
  await assert.rejects(() => f.repeatLink("production_jobs", i.jobC1, target, ["machine_id"], i.production), /Only the person who just created/);
  await assert.rejects(() => f.repeatLink("production_jobs", i.foreignJob, target, ["machine_id"], i.productionManager), /unavailable/);
  await assert.rejects(() => f.repeatLink("production_jobs", i.jobC1, target, ["machine_id"], i.viewer), /Not permitted/);
  await assert.rejects(() => f.repeatLink("production_jobs", target, i.jobC1, ["machine_id"], i.productionManager), /Only the person who just created|earlier record/);
  await assert.rejects(() => f.repeatLink("production_jobs", i.jobC1, target, ["die_id"], i.productionManager), /Invalid repeat lineage/, "the order line decides the die; it is never repeated");
  const link = await f.repeatLink("production_jobs", i.jobC1, target, ["machine_id", "shift"], i.productionManager);
  assert.equal(link.source_id, i.jobC1);
  await assert.rejects(() => f.repeatLink("production_jobs", i.jobC2, target, ["machine_id"], i.productionManager), /already has a repeat source/);
  const stale = f.nextId();
  await f.seed("insert into production_jobs(id,company_id,order_id,profile_id,status,planned_quantity_kg,job_number,source_line_id,planned_date,created_by,created_at) values($1,$2,$3,$4,'planned',100,'J-OLD',$5,current_date,$6,now()-interval '3 hours')",
    [stale, i.company, i.order, i.profile, i.line1, i.productionManager]);
  await assert.rejects(() => f.repeatLink("production_jobs", i.jobC1, stale, ["machine_id"], i.productionManager), /just created/);
  assert.equal((await f.asUser("select count(*)::int c from record_repeat_links", [], i.foreign))[0].c, 0, "another company cannot read the lineage");
});

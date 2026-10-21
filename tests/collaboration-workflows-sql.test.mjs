import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createCollaborationFixture, procedureInput, ids, id } from "../scripts/lib/collaboration-workflow-fixture.mjs";
const require = createRequire(import.meta.url); require("tsx/cjs");
const { canUseCollaboration, parseCollaborationData } = require("../lib/operations/collaboration-workflows.ts");
const { can, defaultRolePermissions } = require("../lib/auth/permissions.ts");
let f;
test.before(async () => { f = await createCollaborationFixture(); });
test.beforeEach(async () => { await f.reset(); });
test.after(async () => { await f?.close(); });
const post = extra => ({ entity_type: "order", entity_id: ids.order, body: "Check the drawing handover", reference: "Drawing revision B", mentions: [ids.colleague], reply_to: null, request_id: id(1100), ...extra });

test("the complete additive migration installs guarded RPC, RLS and denied direct access", async () => {
  const rows = (await f.db.query("select relname,relrowsecurity from pg_class where relname in ('record_discussions','operating_procedures','operating_procedure_events','daily_routine_runs','daily_routine_completions')")).rows;
  assert.equal(rows.length, 5); assert.ok(rows.every(row => row.relrowsecurity));
  const grants = (await f.db.query("select has_function_privilege('anon','public.collaboration_workflow_command(text,jsonb)','execute') anon,has_function_privilege('authenticated','public.collaboration_workflow_command(text,jsonb)','execute') auth")).rows[0];
  assert.deepEqual(grants, { anon: false, auth: true });
  for (const table of rows.map(row => row.relname)) await assert.rejects(f.asUser(`select * from public.${table}`), /permission denied/);
});

test("every new foreign key has a valid covering index without changing company list indexes", async () => {
  const uncovered = (await f.db.query("select c.conname from pg_constraint c join pg_class t on t.oid=c.conrelid where c.contype='f' and t.relname in ('record_discussions','operating_procedures','operating_procedure_events','daily_routine_runs','daily_routine_completions') and not exists(select 1 from pg_index i where i.indrelid=c.conrelid and i.indisvalid and i.indisready and i.indpred is null and (select array_agg(k::smallint order by ord) from unnest(i.indkey) with ordinality x(k,ord) where ord<=cardinality(c.conkey)) @> c.conkey)")).rows;
  assert.deepEqual(uncovered, []);
});

test("record mentions are company and role scoped and a retry cannot duplicate a thread or notification", async () => {
  await f.command("discussions.post", post()); await f.command("discussions.post", post());
  const data = await f.command("discussions.list", { entity_type: "order", entity_id: ids.order });
  assert.equal(data.total_count, 1); assert.equal(data.rows[0].author_name, "Mira Sales"); assert.equal(data.rows[0].mentions, "Colleague");
  const notifications = (await f.db.query("select company_id,recipient_user_id,entity_reference,action_link,body from notifications")).rows;
  assert.equal(notifications.length, 1); assert.equal(notifications[0].company_id, ids.company); assert.equal(notifications[0].recipient_user_id, ids.colleague);
  assert.match(notifications[0].action_link, new RegExp(`discussion=${id(1100)}#record-discussion$`)); assert.doesNotMatch(notifications[0].body, /drawing handover/);
  await assert.rejects(f.command("discussions.post", post({ body: "Changed request" })), /different details/);
});

test("foreign parents, forbidden mentions, dealership links and forged context fail closed", async () => {
  await assert.rejects(f.command("discussions.post", post({ entity_id: id(61) })), /unavailable/);
  await assert.rejects(f.command("discussions.post", post({ mentions: [ids.otherActor] })), /cannot access/);
  await assert.rejects(f.command("discussions.post", post({ mentions: [ids.colleague, ids.colleague] })), /once/);
  await assert.rejects(f.command("discussions.post", post({ company_id: ids.otherCompany })), /Invalid request/);
  await assert.rejects(f.command("discussions.post", post(), { role: "viewer" }), /Not permitted/);
  await f.db.query("update app_users set dealer_id=$1 where id=$2", [id(700), ids.actor]);
  await assert.rejects(f.command("procedures.list", {}), /Not permitted/);
});

test("discussion pagination and exact-message focus retain old records and reply boundaries", async () => {
  for (let n = 0; n < 23; n++) await f.command("discussions.post", post({ mentions: [], request_id: id(1200 + n), body: `Observation ${n}` }));
  const page = await f.command("discussions.list", { entity_type: "order", entity_id: ids.order, page: 3 }); assert.equal(page.total_count, 23); assert.equal(page.rows.length, 3);
  const focused = await f.command("discussions.list", { entity_type: "order", entity_id: ids.order, comment_id: id(1200) }); assert.equal(focused.rows[0].body, "Observation 0");
  await assert.rejects(f.command("discussions.post", post({ entity_type: "dispatch", entity_id: id(80), reply_to: id(1200) })), /different record/);
});

test("procedure ownership changes retain prior people and reject stale revisions", async () => {
  await f.command("procedures.create", procedureInput());
  const updated = { ...procedureInput({ owner_id: ids.colleague, backup_id: ids.actor }), procedure_id: id(1000), expected_revision: 1, is_active: true, reason: "New process owner", request_id: id(1001) };
  await f.command("procedures.update", updated); await f.command("procedures.update", updated);
  const data = await f.command("procedures.load", { procedure_id: id(1000) }); assert.equal(data.record.owner_id, ids.colleague); assert.equal(data.record.revision, 2); assert.equal(data.total_count, 2);
  assert.equal(data.rows[0].previous_owner, "Mira Sales");
  await assert.rejects(f.command("procedures.update", { ...updated, request_id: id(1002) }), /changed/);
  await f.db.query("update app_users set is_active=false where id=$1", [ids.colleague]);
  const unavailable = await f.command("procedures.load", { procedure_id: id(1000) }); assert.equal(unavailable.record.owner_available, false); assert.equal(unavailable.record.backup_available, true);
});

test("authorised process reviews retain history and ordinary employees cannot reassign ownership", async () => {
  await f.command("procedures.create", procedureInput());
  const review = { procedure_id: id(1000), expected_revision: 1, next_review_due: "2027-02-01", note: "Reviewed work instructions", request_id: id(1003) };
  await f.command("procedures.review", review, { actor: ids.colleague, role: "sales" });
  await f.command("procedures.review", review, { actor: ids.colleague, role: "sales" });
  const data = await f.command("procedures.load", { procedure_id: id(1000) }); assert.equal(data.record.review_due, "2027-02-01"); assert.equal(data.total_count, 2);
  await assert.rejects(f.command("procedures.create", procedureInput({ request_id: id(1004) }), { role: "sales" }), /Not permitted/);
});

test("daily routines are unique per procedure and business day and preserve the approved prompt snapshot", async () => {
  await f.command("procedures.create", procedureInput());
  const first = await f.command("routines.start", { procedure_id: id(1000), request_id: id(2000) });
  const second = await f.command("routines.start", { procedure_id: id(1000), request_id: id(2001) }, { actor: ids.colleague, role: "sales" }); assert.equal(first.id, second.id);
  const data = await f.command("routines.load", { run_id: first.id }); assert.equal(data.record.procedure_revision, 1); assert.equal(data.sources.tasks.count, 1); assert.equal(data.sources.jobs.count, 1); assert.equal(data.sources.tasks.rows[0].label, "Confirm rack handover");
  assert.doesNotMatch(JSON.stringify(data), /FOREIGN|Colleague task/);
  await f.db.query("update daily_routine_runs set business_date=business_date-1 where id=$1", [first.id]);
  assert.equal((await f.command("routines.start", { procedure_id: id(1000), request_id: id(2000) })).id, first.id);
});

test("routine completion records actual observations, guards changing context, and leaves business state untouched", async () => {
  await f.command("procedures.create", procedureInput()); await f.command("routines.start", { procedure_id: id(1000), request_id: id(2000) });
  const loaded = await f.command("routines.load", { run_id: id(2000) });
  const finish = { run_id: id(2000), source_fingerprint: loaded.source_fingerprint, answers: [{ index: 0, answer: "follow_up", note: "Rack handover needs a supervisor" }], note: "Carry the open work forward", reviewed: true, request_id: id(2002) };
  await assert.rejects(f.command("routines.finish", { ...finish, answers: [] }), /every observation/);
  await assert.rejects(f.command("routines.finish", { ...finish, answers: [{ index: 0, answer: "follow_up", note: "" }] }), /explain/);
  await f.db.exec("update tasks set status='in_progress',updated_at=now() where title='Confirm rack handover'");
  await assert.rejects(f.command("routines.finish", finish), /context changed/);
  finish.source_fingerprint = (await f.command("routines.load", { run_id: id(2000) })).source_fingerprint;
  await f.command("routines.finish", finish); await f.command("routines.finish", finish);
  const completed = await f.command("routines.load", { run_id: id(2000) }); assert.equal(completed.record.status, "completed"); assert.equal(completed.record.answers[0].answer, "follow_up");
  assert.equal((await f.db.query("select count(*)::int n from daily_routine_completions")).rows[0].n, 1);
  assert.equal((await f.db.query("select status from production_jobs where id=$1", [ids.job])).rows[0].status, "in_progress");
  assert.equal((await f.db.query("select status from tasks where id=$1", [id(90)])).rows[0].status, "in_progress");
});

test("routine source projections respect the current role and only the executor or admin can close a run", async () => {
  await f.command("procedures.create", procedureInput()); await f.command("routines.start", { procedure_id: id(1000), request_id: id(2000) });
  const data = await f.command("routines.load", { run_id: id(2000) }, { actor: ids.colleague, role: "sales" }); assert.equal(data.sources.jobs, null); assert.equal(data.sources.holds, null); assert.equal(data.sources.tasks.rows[0].label, "Colleague task");
  await assert.rejects(f.command("routines.finish", { run_id: id(2000), source_fingerprint: data.source_fingerprint, answers: [], note: "Other operator", reviewed: true, request_id: id(2002) }, { actor: ids.colleague, role: "sales" }), /Not permitted/);
});

test("database role eligibility agrees with application permissions for all record families", async () => {
  for (const role of Object.keys(defaultRolePermissions)) for (const [entity, resource] of Object.entries({ order: "orders", production_job: "production", dispatch: "dispatches", quality_inspection: "quality" })) {
    const sql = (await f.db.query("select private.collaboration_can_read($1,$2) allowed", [role, entity])).rows[0].allowed;
    assert.equal(sql, !["dealer_admin", "dealer_staff"].includes(role) && can(role, "read", resource), `${role}/${entity}`);
    assert.equal(canUseCollaboration(role, "discussions.list", entity), sql);
  }
});

test("response validation refuses hidden fields, missing counts and invalid page identities", () => {
  assert.throws(() => parseCollaborationData({ rows: [] }, "discussions.list"));
  assert.throws(() => parseCollaborationData({ rows: [], total_count: 0, company_id: ids.otherCompany }, "procedures.list"));
  assert.throws(() => parseCollaborationData({ success: true }, "procedures.create"));
});

test("SQL permits incomplete drafts and blocks their confirmation until costing is verified", async () => {
  await assert.rejects(f.db.query("insert into quotes(id,company_id,status) values($1,$2,'sent')", [id(3002), ids.company]), /Incomplete drafts/);
  await f.db.query("insert into quotes(id,company_id,status) values($1,$2,'draft')", [id(3000), ids.company]);
  await f.db.query("insert into quote_items values($1,$2,$3,false)", [id(3001), ids.company, id(3000)]);
  await assert.rejects(f.db.query("update quotes set status='approved_for_sending' where id=$1", [id(3000)]), /Incomplete drafts/);
  await f.db.query("update quote_items set costing_complete=true where quote_id=$1", [id(3000)]);
  await f.db.query("update quotes set status='approved_for_sending' where id=$1", [id(3000)]);
  assert.equal((await f.db.query("select status from quotes where id=$1", [id(3000)])).rows[0].status, "approved_for_sending");
});

test("customer lookup preserves internal/dealer boundaries while quote pricing remains unreadable", async () => {
  const internal = ["owner", "admin", "sales_manager", "sales", "accounts", "production_manager", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "quality", "viewer"];
  for (const role of Object.keys(defaultRolePermissions)) {
    const rows = await f.asUser("select id from public.customers order by id", [], { role });
    assert.deepEqual(rows.map(row => row.id), internal.includes(role) ? [ids.customer] : [], role);
  }
  await f.db.query("update app_users set dealer_id=$1 where id=$2", [id(700), ids.actor]);
  await f.db.query("update orders set customer_id=$1,dealer_id=$2 where id=$3", [ids.customer, id(700), ids.order]);
  assert.equal((await f.asUser("select id from customers", [], { role: "dealer_staff" })).length, 1);
  await f.db.query("update orders set dealer_id=$1 where id=$2", [id(701), ids.order]);
  assert.equal((await f.asUser("select id from customers", [], { role: "dealer_staff" })).length, 0);
  await f.db.query("insert into quotes(id,company_id,status,customer_id,dealer_id) values($1,$2,'draft',$3,$4)", [id(3100), ids.company, ids.customer, id(700)]);
  assert.equal((await f.asUser("select id from customers", [], { role: "dealer_staff" })).length, 1);
  assert.deepEqual((await f.asUser("select id,company_id,status from quotes"))[0], { id: id(3100), company_id: ids.company, status: "draft" });
  await assert.rejects(f.asUser("select * from quotes"), /permission denied/);
  await assert.rejects(f.asUser("select private.customer_has_current_dealer_record($1)", [ids.customer], { sqlRole: "anon" }), /permission denied/);
});

test("direct RPC rejects malformed nested observations, non-ISO dates and JSON scalar coercion", async () => {
  await assert.rejects(f.command("procedures.create", procedureInput({ title: 42 })), /Invalid request/);
  await assert.rejects(f.command("procedures.create", procedureInput({ review_due: "01/02/2027" })), /Invalid request/);
  await f.command("procedures.create", procedureInput()); await f.command("routines.start", { procedure_id: id(1000), request_id: id(2000) });
  const loaded = await f.command("routines.load", { run_id: id(2000) });
  const finish = { run_id: id(2000), source_fingerprint: loaded.source_fingerprint, answers: [], note: "Reviewed", reviewed: true, request_id: id(2002) };
  for (const answer of [null, { index: "0", answer: "confirmed", note: "" }, { index: 0, answer: "confirmed", note: {} }, { index: 0, answer: "confirmed", note: "", company_id: ids.otherCompany }, { index: 0, answer: "confirmed" }]) await assert.rejects(f.command("routines.finish", { ...finish, answers: [answer] }), /Answer each approved/);
  assert.equal((await f.db.query("select count(*)::int n from daily_routine_completions")).rows[0].n, 0);
});

test("directory pages, literal search, review history and archived routine snapshots remain bounded", async () => {
  for (let n = 0; n < 22; n++) await f.command("procedures.create", procedureInput({ title: `Method ${String(n).padStart(2, "0")}`, request_id: id(4000 + n) }));
  const page = await f.command("procedures.list", { status: "all", sort: "title", page: 3 }); assert.equal(page.total_count, 22); assert.equal(page.rows.length, 2); assert.equal(page.rows[0].title, "Method 20");
  assert.equal((await f.command("procedures.list", { search: "%", status: "all" })).total_count, 0);
  await f.command("routines.start", { procedure_id: id(4000), request_id: id(5000) });
  for (let n = 1; n < 12; n++) await f.command("procedures.review", { procedure_id: id(4000), expected_revision: n, next_review_due: "2027-02-01", note: `Review ${n}`, request_id: id(4100 + n) });
  const history = await f.command("procedures.load", { procedure_id: id(4000), page: 2 }); assert.equal(history.total_count, 12); assert.equal(history.rows.length, 2);
  await f.command("procedures.update", { ...procedureInput({ title: "Method 00", prompts: ["Changed prompt"], request_id: id(4200) }), procedure_id: id(4000), expected_revision: 12, is_active: false, reason: "Retain the retired method" });
  const run = await f.command("routines.load", { run_id: id(5000) }); assert.equal(run.record.procedure_revision, 1); assert.equal(run.record.prompts[0], "Confirm the physical handover");
  assert.equal((await f.command("procedures.list", { status: "archived" })).total_count, 1);
  await assert.rejects(f.command("routines.start", { procedure_id: id(4000), request_id: id(5001) }), /active opening/);
  assert.equal((await f.command("routines.start", { procedure_id: id(4000), request_id: id(5000) })).id, id(5000));
});

test("all list and load branches can run in a read-only transaction without source mutation locks", async () => {
  await f.command("procedures.create", procedureInput()); await f.command("routines.start", { procedure_id: id(1000), request_id: id(2000) });
  await f.db.exec("begin read only");
  try {
    await f.db.query("select set_config('test.actor',$1,true)", [ids.actor]); await f.db.exec("set local role authenticated");
    for (const [name, payload] of [["discussions.list", { entity_type: "order", entity_id: ids.order }], ["discussions.people", { entity_type: "order", entity_id: ids.order }], ["procedures.people", {}], ["procedures.list", {}], ["procedures.load", { procedure_id: id(1000) }], ["routines.list", {}], ["routines.load", { run_id: id(2000) }]]) await f.db.query("select public.collaboration_workflow_command($1,$2)", [name, payload]);
  } finally { await f.db.exec("rollback"); }
});

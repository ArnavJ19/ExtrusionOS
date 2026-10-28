import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasRouteAccess } from "../lib/auth/route-permissions.ts";
import {
  FOLLOW_TYPES, REQUEST_TYPES, canFollow, deliverySchema, digestListSchema, digestWhatsAppText, followListSchema, followStatusSchema, parseSubscriptionCommand, preferencesSchema,
  quietText, recipientsSchema, recordHref, requestListSchema, requestTypesFor
} from "../lib/workflow/subscriptions.ts";
import { createSubscriptionFixture, sids } from "../scripts/lib/subscription-fixture.mjs";

const id = "00000000-0000-4000-8000-000000000060";
const ROLES = ["owner", "admin", "sales_manager", "sales", "production_manager", "production", "dispatch_manager", "dispatch", "accounts", "quality", "viewer", "factory_manager", "inventory_manager"];

test("following a kind of record is allowed exactly where the role may open its pages", () => {
  for (const type of Object.keys(FOLLOW_TYPES)) {
    for (const role of ROLES) assert.equal(canFollow(role, type), hasRouteAccess(`${FOLLOW_TYPES[type].href}/${id}`, role), `${role} ${type}`);
  }
  assert.equal(canFollow("dealer_admin", "order"), false);
  assert.deepEqual(requestTypesFor("order"), ["confirm_dispatch", "general"]);
  assert.deepEqual(requestTypesFor("invoice"), ["record_payment", "general"]);
  assert.equal(recordHref("quality_inspection", id), `/quality/${id}`);
});

test("commands refuse bad input with a specific message", () => {
  assert.equal(parseSubscriptionCommand({ command: "follow.everything" }).error, "Invalid notification request");
  assert.match(parseSubscriptionCommand({ command: "follow.set", entity_type: "quote", entity_id: id, categories: ["payment"] }).error, /does not apply to this record/);
  assert.match(parseSubscriptionCommand({ command: "follow.set", entity_type: "order", entity_id: id, categories: [] }).error, /at least one kind of update/);
  assert.match(parseSubscriptionCommand({ command: "prefs.set", digest_mode: "immediate", quiet_start: 22, quiet_end: 22 }).error, /different start and end/);
  assert.match(parseSubscriptionCommand({ command: "prefs.set", digest_mode: "immediate", quiet_start: 22, quiet_end: null }).error, /different start and end/);
  assert.equal(parseSubscriptionCommand({ command: "prefs.set", digest_mode: "daily", daily_hour: 24 }).success, false);
  assert.match(parseSubscriptionCommand({ command: "request.create", id, recipient_id: id, request_type: "approve_quote", entity_type: "invoice", entity_id: id, message: "Please approve" }).error, /does not apply/);
  assert.match(parseSubscriptionCommand({ command: "request.create", id, recipient_id: id, request_type: "general", entity_type: "order", entity_id: id, message: "ok" }).error, /3 to 300/);
  assert.equal(parseSubscriptionCommand({ command: "follow.list", user_id: id }).success, false, "no client-chosen user");
});

test("WhatsApp summary and quiet-hour text", () => {
  const digest = { event_count: 4, record_count: 3, period_end: "2026-10-22T12:30:00Z", items: [
    { entity_type: "order", entity_id: id, label: "Order SO-0042", updates: 3, latest: "Stage cutting → aging", earlier: [], last_at: "x" },
    { entity_type: "quote", entity_id: id, label: "Quotation QT-0101", updates: 1, latest: "Status sent → customer approved", earlier: [], last_at: "x" }
  ] };
  assert.equal(digestWhatsAppText(digest, () => "22 Oct"), "*Updates till 22 Oct*\n• Order SO-0042: Stage cutting → aging (3 updates)\n• Quotation QT-0101: Status sent → customer approved\n…and 1 more record");
  assert.equal(quietText(22, 7), "22:00 – 07:00 IST");
  assert.equal(quietText(null, null), "Off");
});

test("the action shows exactly the database's business messages", () => {
  const sql = readFileSync("supabase/migrations/20261022370000_record_subscriptions.sql", "utf8");
  const action = readFileSync("lib/actions/subscriptions.ts", "utf8");
  const raised = [...sql.matchAll(/raise exception '([^']+)'/g)].map((m) => m[1])
    .filter((m) => !m.includes("%") && !["Authentication required", "This action is not permitted for your role", "Invalid notification request"].includes(m));
  assert.ok(raised.length >= 14);
  for (const message of raised) assert.ok(action.includes(`"${message}"`), message);
});

let f;
test.before(async () => { f = await createSubscriptionFixture(); });
test.beforeEach(async () => { await f.reset(); });
test.after(async () => { await f?.close(); });

test("role, category and request tables match the database functions", async () => {
  for (const [type, meta] of Object.entries(FOLLOW_TYPES)) {
    const row = (await f.db.query("select private.follow_roles($1) r, private.follow_categories($1) c", [type])).rows[0];
    assert.deepEqual([...meta.roles].sort(), [...row.r].sort(), `${type} roles`);
    assert.deepEqual([...meta.categories], row.c, `${type} categories`);
  }
  for (const [type, meta] of Object.entries(REQUEST_TYPES)) {
    const entities = (await f.db.query("select private.action_request_entities($1) e", [type])).rows[0].e;
    assert.deepEqual([...meta.entities], entities, type);
  }
});

test("database responses parse with the app's schemas", async () => {
  followStatusSchema.parse(await f.command("follow.status", { entity_type: "order", entity_id: sids.order }));
  await f.follow("order", sids.order, ["status"]);
  followListSchema.parse(await f.command("follow.list", {}));
  preferencesSchema.parse(await f.command("prefs.get", {}));
  preferencesSchema.parse(await f.command("prefs.set", { digest_mode: "daily", daily_hour: 9, quiet_start: 22, quiet_end: 7, muted_categories: ["payment"] }));
  await f.asActor(`update orders set current_stage='extruded' where id='${sids.order}'`, sids.production);
  await f.command("digest.now", {});
  assert.equal(digestListSchema.parse(await f.command("digest.list", {})).rows[0].items[0].updates, 1);
  recipientsSchema.parse(await f.command("request.recipients", { entity_type: "quote", entity_id: sids.quote, request_type: "approve_quote" }));
  await f.command("request.create", { id: crypto.randomUUID(), recipient_id: sids.salesMgr, request_type: "approve_quote", entity_type: "quote", entity_id: sids.quote, message: "Please approve today" });
  requestListSchema.parse(await f.command("request.list", { box: "sent", state: "open" }));
  deliverySchema.parse(await f.command("delivery.run", {}, sids.factory));
});

test("pages keep dealers out and show the follow control only where the role may open the record", () => {
  for (const page of ["following", "requests"]) assert.match(readFileSync(`app/(dashboard)/notifications/${page}/page.tsx`, "utf8"), /if \(context\.dealerId\) redirect\("\/notifications"\)/);
  const pages = { orders: "order", quotes: "quote", invoices: "invoice", dispatches: "dispatch", quality: "quality_inspection", production: "production_job" };
  for (const [dir, type] of Object.entries(pages)) {
    assert.match(readFileSync(`app/(dashboard)/${dir}/[id]/page.tsx`, "utf8"), new RegExp(`!context\\.dealerId && canFollow\\(context\\.role, "${type}"\\) \\? <RecordFollow entityType="${type}"`), dir);
  }
  assert.match(readFileSync("lib/actions/subscriptions.ts", "utf8"), /if \(context\.dealerId \|\|/);
});

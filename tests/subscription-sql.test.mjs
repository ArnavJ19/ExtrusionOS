import test from "node:test";
import assert from "node:assert/strict";
import { createSubscriptionFixture, sids, sid } from "../scripts/lib/subscription-fixture.mjs";

let f;
test.before(async () => { f = await createSubscriptionFixture(); });
test.beforeEach(async () => { await f.reset(); });
test.after(async () => { await f?.close(); });

const stage = (order, value, actor = sids.production) => f.asActor(`update orders set current_stage='${value}' where id='${order}'`, actor);
const istHour = async () => Number((await f.db.query("select extract(hour from now() at time zone 'Asia/Kolkata')::int h")).rows[0].h);
const ask = (fields = {}, actor = sids.sales) => f.command("request.create", { id: crypto.randomUUID(), recipient_id: sids.salesMgr, request_type: "approve_quote", entity_type: "quote", entity_id: sids.quote, message: "Customer is waiting for the revised price", ...fields }, actor);
const age = (hours) => f.db.exec(`update action_requests set created_at = created_at - interval '${hours} hours', last_reminded_at = last_reminded_at - interval '${hours} hours'`);

// ---------- Grouped digests ----------

test("repeated updates to one followed record arrive as one digest line with the latest change", async () => {
  await f.follow("order", sids.order, ["status", "dispatch"]);
  for (const next of ["extruded", "cutting", "aging"]) await stage(sids.order, next);
  assert.deepEqual(await f.deliver(), { digests: 1, resolved: 0, reminded: 0 });
  const [digest] = await f.notifications(sids.sales, "record_digest");
  assert.equal(digest.title, "3 updates on 1 followed record");
  assert.equal(digest.body, "Order SO-0042 · 3 updates · latest: Stage cutting → aging");
  const stored = (await f.command("digest.list", {})).rows[0];
  assert.deepEqual(stored.items[0].earlier, ["Stage extruded → cutting", "Stage extrusion planned → extruded"]);
  assert.equal((await f.deliver()).digests, 0, "nothing new: no second digest, events are delivered once");
  await f.asActor(`update dispatches set delivery_status='dispatched' where id='${sids.dispatch}'`, sids.dispatcher);
  await f.deliver();
  assert.equal((await f.notifications(sids.sales, "record_digest"))[1].body, "Order SO-0042 · 1 update · latest: Dispatch DSP-0003 dispatched", "a dispatch updates the order it belongs to");
});

test("digests group several records, most recent first, and follow only the chosen categories", async () => {
  await f.follow("order", sids.order, ["dispatch"]);
  await f.follow("order", sids.order2, ["status"]);
  await stage(sids.order, "extruded");
  await stage(sids.order2, "dispatched");
  await f.asActor(`update dispatches set delivery_status='in_transit' where id='${sids.dispatch}'`, sids.dispatcher);
  await f.deliver();
  const [digest] = await f.notifications(sids.sales, "record_digest");
  assert.equal(digest.title, "2 updates on 2 followed records", "SO-0042's stage change is not followed");
  assert.equal(digest.body, "Order SO-0042 · 1 update · latest: Dispatch DSP-0003 in transit\nOrder SO-0043 · 1 update · latest: Stage packing → dispatched");
  await f.command("prefs.set", { digest_mode: "immediate", muted_categories: ["dispatch"] });
  await f.asActor(`update dispatches set delivery_status='delivered' where id='${sids.dispatch}'`, sids.dispatcher);
  assert.equal((await f.deliver()).digests, 0, "a muted category is not sent");
});

test("an employee's own changes are not sent back to them; others following the record get them", async () => {
  await f.follow("quote", sids.quote, ["status"]);
  await f.follow("quote", sids.quote, ["status"], sids.salesMgr);
  await f.asActor(`update quotes set status='approved_for_sending' where id='${sids.quote}'`, sids.sales);
  await f.deliver();
  assert.equal((await f.notifications(sids.sales, "record_digest")).length, 0);
  assert.equal((await f.notifications(sids.salesMgr, "record_digest"))[0].body, "Quotation QT-0101 · 1 update · latest: Status internal review → approved for sending");
});

test("events are recorded only for followed records, and only from after the follow began", async () => {
  await stage(sids.order2, "dispatched");
  assert.equal((await f.db.query("select count(*)::int c from record_events")).rows[0].c, 0);
  await f.follow("order", sids.order, ["status"]);
  await f.db.exec(`update record_subscriptions set created_at = now() + interval '1 minute'`);
  await stage(sids.order, "extruded");
  assert.equal((await f.deliver()).digests, 0, "a change before the follow started is not delivered");
});

test("access is rechecked at delivery: a role that can no longer open invoices stops receiving them", async () => {
  await f.follow("invoice", sids.invoice, ["payment"], sids.accounts);
  await f.asActor(`update invoices set amount_paid=40000, status='partially_paid' where id='${sids.invoice}'`, sids.owner);
  await f.db.exec(`update app_users set role='sales' where id='${sids.accounts}'`);
  assert.equal((await f.deliver()).digests, 0);
  await f.db.exec(`update app_users set role='accounts' where id='${sids.accounts}'`);
  await f.deliver();
  assert.equal((await f.notifications(sids.accounts, "record_digest"))[0].body, "Invoice INV-0009 · 1 update · latest: Paid INR 40000.00, balance INR 60000.00");
});

// ---------- Delivery preferences ----------

test("hourly and daily digests wait for their time; quiet hours defer; digest now delivers on request", async () => {
  await f.follow("order", sids.order, ["status"]);
  await f.command("prefs.set", { digest_mode: "hourly" });
  await stage(sids.order, "extruded");
  assert.equal((await f.deliver()).digests, 1, "the first hourly digest goes out");
  await stage(sids.order, "cutting");
  assert.equal((await f.deliver()).digests, 0, "within the hour");
  await f.db.exec(`update notification_preferences set last_digest_at = now() - interval '61 minutes'`);
  assert.equal((await f.deliver()).digests, 1);

  const hour = await istHour();
  await f.command("prefs.set", { digest_mode: "daily", daily_hour: (hour + 1) % 24 });
  await f.db.exec(`update notification_preferences set last_digest_at = null`);
  await stage(sids.order, "aging");
  assert.equal((await f.deliver()).digests, hour === 23 ? 1 : 0, "before the daily hour");
  await f.command("prefs.set", { digest_mode: "daily", daily_hour: hour });
  await f.db.exec(`update notification_preferences set last_digest_at = null`);
  assert.equal((await f.deliver()).digests, 1);
  await stage(sids.order, "finishing");
  assert.equal((await f.deliver()).digests, 0, "one daily digest per day");

  await f.command("prefs.set", { digest_mode: "immediate", quiet_start: hour, quiet_end: (hour + 2) % 24 });
  assert.equal((await f.deliver()).digests, 0, "quiet hours defer delivery");
  assert.equal((await f.command("digest.now", {})).records, 1, "asking for updates now ignores quiet hours");
});

test("quiet hours wrap midnight; preferences are validated", async () => {
  const quiet = async (start, end, hourIst) => (await f.db.query(`select private.in_quiet_hours($1::smallint,$2::smallint,('2026-10-22 ' || lpad($3::text,2,'0') || ':30:00+05:30')::timestamptz) q`, [start, end, hourIst])).rows[0].q;
  assert.equal(await quiet(22, 7, 23), true);
  assert.equal(await quiet(22, 7, 3), true);
  assert.equal(await quiet(22, 7, 7), false, "the end hour is not quiet");
  assert.equal(await quiet(22, 7, 12), false);
  assert.equal(await quiet(13, 15, 14), true);
  assert.equal(await quiet(null, null, 14), false);
  for (const bad of [{ digest_mode: "weekly" }, { quiet_start: 9, quiet_end: 9 }, { quiet_start: 9 }, { daily_hour: 24 }, { muted_categories: ["gossip"] }]) {
    await assert.rejects(f.command("prefs.set", { digest_mode: "immediate", ...bad }), /Choose immediate, hourly or daily/, JSON.stringify(bad));
  }
  assert.equal((await f.command("prefs.get", {})).digest_mode, "immediate", "defaults without a saved row");
});

// ---------- Follow permissions ----------

test("employees follow only records they may open, in this company, with categories that apply", async () => {
  await assert.rejects(f.follow("invoice", sids.invoice, ["payment"], sids.production), /cannot open this kind of record/);
  await assert.rejects(f.follow("order", sids.foreignOrder, ["status"]), /Record is unavailable/);
  await assert.rejects(f.follow("order", sid(999), ["status"]), /Record is unavailable/);
  await assert.rejects(f.follow("quote", sids.quote, ["payment"]), /does not apply to this record/);
  await assert.rejects(f.follow("order", sids.order, []), /at least one kind of update/);
  await assert.rejects(f.follow("order", sids.order, ["status"], sids.dealer), /not permitted/);
  await assert.rejects(f.follow("customer", sids.order, ["status"]), /Invalid notification request/);
  const status = await f.command("follow.status", { entity_type: "order", entity_id: sids.order });
  assert.deepEqual([status.following, status.available], [false, ["status", "production", "quality", "dispatch", "payment"]]);
  await f.follow("order", sids.order, ["status", "status", "payment"]);
  assert.deepEqual((await f.command("follow.status", { entity_type: "order", entity_id: sids.order })).categories.sort(), ["payment", "status"]);
  const list = await f.command("follow.list", {});
  assert.deepEqual([list.total_count, list.rows[0].label, list.rows[0].state], [1, "Order SO-0042", "extrusion_planned"]);
  await f.command("follow.remove", { entity_type: "order", entity_id: sids.order });
  assert.equal((await f.command("follow.list", {})).total_count, 0);
});

// ---------- Action requests ----------

test("a request reminds on schedule and stops as soon as its condition is resolved", async () => {
  await ask();
  assert.equal((await f.notifications(sids.salesMgr, "action_request")).length, 1);
  assert.equal((await f.deliver()).reminded, 0, "not due yet");
  await age(5);
  assert.equal((await f.deliver()).reminded, 1);
  assert.equal((await f.deliver()).reminded, 0, "a retried run does not remind twice");
  await age(5);
  assert.equal((await f.deliver()).reminded, 1);
  assert.deepEqual((await f.notifications(sids.salesMgr, "action_request_reminder")).map((n) => n.title), ["Reminder 1: Quotation QT-0101", "Reminder 2: Quotation QT-0101"]);
  await f.asActor(`update quotes set status='approved_for_sending' where id='${sids.quote}'`, sids.salesMgr);
  const live = await f.command("request.list", { box: "sent", state: "resolved" });
  assert.deepEqual([live.total_count, live.rows[0].resolution, live.rows[0].can_close], [1, "condition_met", false], "shown as resolved before the next run");
  assert.equal((await f.command("request.list", { box: "inbox", state: "open" }, sids.salesMgr)).total_count, 0);
  assert.deepEqual(await f.deliver(), { digests: 0, resolved: 1, reminded: 0 });
  assert.equal((await f.notifications(sids.sales, "action_request_closed"))[0].title, "Done: Quotation QT-0101");
  await age(50);
  assert.equal((await f.deliver()).reminded, 0, "a resolved request generates no more reminders");
  assert.equal((await f.notifications(sids.salesMgr, "action_request_reminder")).length, 2);
});

test("requests go only to people who can act on that record, once, and not for work already done", async () => {
  await assert.rejects(ask({ recipient_id: sids.accounts }), /cannot act on this request/);
  await assert.rejects(ask({ recipient_id: sids.sales }), /cannot act on this request/, "not to yourself");
  await assert.rejects(ask({ request_type: "approve_quote", entity_type: "invoice", entity_id: sids.invoice }, sids.owner), /does not apply to this record/);
  await assert.rejects(ask({ message: "x" }), /3 to 300 characters/);
  await assert.rejects(ask({ reminder_hours: 0 }), /1 to 72 hours/);
  const id = crypto.randomUUID();
  await ask({ id });
  assert.equal((await ask({ id })).replayed, true, "a retried create is the same request");
  await assert.rejects(ask(), /already have an open request/);
  await assert.rejects(f.command("request.create", { id, recipient_id: sids.salesMgr, request_type: "approve_quote", entity_type: "quote", entity_id: sids.quote, message: "Hijack the id" }, sids.owner), /Invalid notification request/);
  await f.db.exec(`update quotes set status='sent' where id='${sids.quote}'`);
  await f.db.exec(`delete from action_requests`);
  await assert.rejects(ask(), /already done/);
  const recipients = await f.command("request.recipients", { entity_type: "invoice", entity_id: sids.invoice, request_type: "record_payment" }, sids.owner);
  assert.deepEqual(recipients.map((r) => r.role), ["accounts"], "only accounts (and owner/admin, excluding yourself) can record a payment");
});

test("quiet hours defer reminders; a recipient who leaves closes the request and tells the requester", async () => {
  await ask();
  await age(5);
  const hour = await istHour();
  await f.command("prefs.set", { digest_mode: "immediate", quiet_start: hour, quiet_end: (hour + 1) % 24 }, sids.salesMgr);
  assert.equal((await f.deliver()).reminded, 0);
  await f.db.exec(`update app_users set is_active=false where id='${sids.salesMgr}'`);
  assert.equal((await f.deliver()).resolved, 1);
  const [closed] = await f.notifications(sids.sales, "action_request_closed");
  assert.deepEqual([closed.title, closed.severity], ["Ask someone else: Quotation QT-0101", "warning"]);
});

test("payment, QC and dispatch requests resolve from their records; general requests only when closed; reminders stop at 10", async () => {
  await f.command("request.create", { id: sid(500), recipient_id: sids.accounts, request_type: "record_payment", entity_type: "invoice", entity_id: sids.invoice, message: "Customer paid by NEFT today" }, sids.owner);
  await f.command("request.create", { id: sid(501), recipient_id: sids.quality, request_type: "release_qc", entity_type: "quality_inspection", entity_id: sids.inspection, message: "Lot is needed for dispatch" }, sids.owner);
  await f.command("request.create", { id: sid(502), recipient_id: sids.dispatcher, request_type: "confirm_dispatch", entity_type: "order", entity_id: sids.order, message: "Truck at the gate" }, sids.owner);
  await f.command("request.create", { id: sid(503), recipient_id: sids.production, request_type: "general", entity_type: "order", entity_id: sids.order, message: "Share the die trial photos" }, sids.owner);
  await f.db.exec(`update invoices set amount_paid=100000 where id='${sids.invoice}'; update quality_inspections set status='rework' where id='${sids.inspection}'; update orders set current_stage='dispatched' where id='${sids.order}'`);
  assert.equal((await f.deliver()).resolved, 3);
  for (let i = 0; i < 12; i += 1) { await age(5); await f.deliver(); }
  const general = (await f.db.query(`select reminder_count, resolved_at from action_requests where id='${sid(503)}'`)).rows[0];
  assert.deepEqual([general.reminder_count, general.resolved_at], [10, null], "a general request is never resolved automatically, and reminders cap at 10");
  await assert.rejects(f.command("request.close", { id: sid(503) }, sids.sales), /Request is unavailable/);
  assert.equal((await f.command("request.close", { id: sid(503), note: "Sent on WhatsApp" }, sids.production)).resolution, "done");
  await assert.rejects(f.command("request.close", { id: sid(503) }, sids.owner), /already closed/);
  assert.equal((await f.notifications(sids.owner, "action_request_closed")).at(-1).body, "Press Lead: Sent on WhatsApp");
});

// ---------- Boundaries ----------

test("subscriptions, digests and requests stay private; the scheduler runs every company and is not callable by users", async () => {
  await f.follow("order", sids.order, ["status"]);
  await ask();
  assert.equal((await f.asUser("select id from record_subscriptions", [], sids.salesMgr)).length, 0);
  assert.equal((await f.asUser("select id from action_requests", [], sids.salesMgr)).length, 1, "the recipient sees the request");
  assert.equal((await f.asUser("select id from action_requests", [], sids.production)).length, 0);
  await assert.rejects(f.asUser(`insert into record_subscriptions(company_id,user_id,entity_type,entity_id,categories) values('${sids.company}','${sids.viewer}','order','${sids.order}','{status}')`), /permission denied/);
  await assert.rejects(f.asUser(`update action_requests set resolved_at=now(), resolution='done'`, [], sids.salesMgr), /permission denied/);
  await assert.rejects(f.command("delivery.run", {}, sids.sales), /not permitted/);
  assert.deepEqual(await f.command("delivery.run", {}, sids.factory), { digests: 0, resolved: 0, reminded: 0 });
  await stage(sids.order, "extruded");
  assert.equal((await f.db.query("select private.run_notification_delivery_for_all() n")).rows[0].n, 1);
  assert.equal((await f.notifications(sids.sales, "record_digest")).length, 1);
  await assert.rejects(f.asUser("select private.run_notification_delivery_for_all()"), /permission denied/);
  await assert.rejects(f.asUser("select public.subscription_command('follow.list','{}'::jsonb)", [], ""), /Authentication required/);
});

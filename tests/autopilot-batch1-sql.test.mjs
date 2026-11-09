import test from "node:test";
import assert from "node:assert/strict";
import { createAutopilotFixture, apIds as i, istDay } from "../scripts/lib/autopilot-batch1-fixture.mjs";

let f;
test.before(async () => { f = await createAutopilotFixture(); });
test.after(async () => { await f?.close(); });
test.beforeEach(async () => { await f.start(); });
test.afterEach(async () => { await f.rollback(); });

const n = value => Number(value);
async function asActor(sql, params, actor) {
  await f.db.exec("savepoint ap_actor");
  try {
    await f.db.query("select set_config('request.jwt.claim.sub',$1,true)", [actor]);
    const rows = (await f.db.query(sql, params)).rows;
    await f.db.query("select set_config('request.jwt.claim.sub','',true)");
    await f.db.exec("release savepoint ap_actor");
    return rows;
  } catch (error) {
    await f.db.exec("rollback to savepoint ap_actor; release savepoint ap_actor");
    throw error;
  }
}
/** The calendar month before the current IST month, as YYYY-MM. */
function previousMonth() {
  const [y, m] = istDay(0).split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
const count = async (sql, params = []) => n((await f.one(sql, params)).c);
const VALID_GSTIN = "27AAPFU0939F1ZV"; // check digit verified independently
const OTHER_VALID = "07ABCDE1234F1Z2";

test("AP-038 GSTIN check digit, state fill and the explicit unregistered choice are enforced in the database", async () => {
  await f.asUser("insert into customers(company_id,customer_name,customer_type,gst_number) values($1,'Valid party','dealer',$2)", [i.company, VALID_GSTIN.toLowerCase()]);
  const row = await f.one("select gst_number,gst_registration,state from customers where customer_name='Valid party'");
  assert.deepEqual(row, { gst_number: VALID_GSTIN, gst_registration: "registered", state: "Maharashtra" });
  await assert.rejects(() => f.asUser("insert into customers(company_id,customer_name,customer_type,gst_number) values($1,'Bad digit','dealer','27AAPFU0939F1ZW')", [i.company]), /check-digit/);
  await assert.rejects(() => f.asUser("insert into customers(company_id,customer_name,customer_type,gst_number) values($1,'Bad state','dealer','40AAPFU0939F1ZV')", [i.company]), /check-digit/);
  await assert.rejects(() => f.asUser("insert into customers(company_id,customer_name,customer_type,gst_registration) values($1,'No number','dealer','registered')", [i.company]), /mark the party unregistered/);
  await assert.rejects(() => f.asUser("insert into vendors(company_id,vendor_name,vendor_type,gst_number,gst_registration) values($1,'Both','other',$2,'unregistered')", [i.company, VALID_GSTIN]), /unregistered cannot carry/);
  await f.asUser("insert into vendors(company_id,vendor_name,vendor_type,gst_registration,state) values($1,'Small supplier','other','unregistered','Gujarat')", [i.company]);
  assert.equal((await f.one("select gst_registration from vendors where vendor_name='Small supplier'")).gst_registration, "unregistered");
  // A record saved before AP-038 with a wrong GSTIN can still be edited for other fields.
  await f.db.exec("set session_replication_role = replica");
  await f.db.query("update customers set gst_number='27ABCDE1234F1Z5' where id=$1", [i.customer]);
  await f.db.exec("set session_replication_role = origin");
  await f.asUser("update customers set phone='9876543210' where id=$1", [i.customer]);
  await assert.rejects(() => f.asUser("update customers set gst_number='27ABCDE1234F1Z6' where id=$1", [i.customer]), /check-digit/);
  assert.equal((await f.one("select private.ap_gstin_valid($1) v", [OTHER_VALID])).v, true);
});

test("AP-001 scheduled jobs run once per window, manual runs are labelled, and three failed windows raise one alert", async () => {
  const first = await f.cron("nightly");
  assert.equal(first.runs.length, 6, "three nightly jobs for each of the two companies");
  assert.ok(first.runs.every(run => run.state === "succeeded"), JSON.stringify(first.runs));
  const again = await f.cron("nightly");
  assert.ok(again.runs.every(run => run.state === "already_ran"), "a retried cron call in the same window does nothing");
  assert.equal(await count("select count(*) c from system_job_runs where trigger_source='cron'"), first.runs.length);
  await assert.rejects(() => f.call("ap_jobs", "overview", {}, i.sales), /Not permitted/);
  await assert.rejects(() => f.asUser("select public.ap_jobs_cron('{\"schedule\":\"nightly\"}')"), /permission denied/);
  await assert.rejects(() => f.cron("weekly"), /Unknown schedule/);
  const manual = await f.call("ap_jobs", "run_now", { job_key: "proposals.refresh" }, i.admin);
  assert.equal(manual.state, "succeeded");
  assert.equal((await f.call("ap_jobs", "run_now", { job_key: "proposals.refresh" }, i.owner)).state, "already_ran", "two taps in the same minute produce one run");
  assert.equal((await f.one("select trigger_source,requested_by from system_job_runs where id=$1", [manual.run_id])).requested_by, i.admin);
  await assert.rejects(() => f.call("ap_jobs", "run_now", { job_key: "nope.job" }), /Unknown job/);
  // A job whose source table is unavailable fails, is recorded, and after three windows alerts the owner once.
  await f.db.exec("alter table public.factory_calendar_exceptions rename to factory_calendar_exceptions_off");
  for (const window of ["day:20261101", "day:20261102", "day:20261103", "day:20261104"]) {
    const run = (await f.db.query("select private.ap_job_once($1,'calendar.check',$2,'cron',null) data", [i.company, window])).rows[0].data;
    assert.equal(run.state, "failed");
    assert.match(run.error, /factory_calendar_exceptions/);
  }
  await f.db.exec("alter table public.factory_calendar_exceptions_off rename to factory_calendar_exceptions");
  assert.equal(await count("select count(*) c from notifications where entity_reference='job-failing:calendar.check'"), 1);
  const overview = await f.call("ap_jobs", "overview", {});
  const calendar = overview.jobs.find(job => job.job_key === "calendar.check");
  assert.equal(calendar.last.status, "failed");
  assert.equal(n(calendar.failed_streak), 4);
  const runs = await f.call("ap_jobs", "runs", { status: "failed" });
  assert.equal(runs.total_count, 4);
  assert.equal(runs.rows.length, 4);
});

test("AP-002 and AP-005 a series proposal is accepted once, numbers by financial year, and stays gap-free", async () => {
  const run = await f.call("ap_jobs", "run_now", { job_key: "series.propose" });
  assert.equal(run.result.proposals, 5);
  assert.equal((await f.call("ap_jobs", "run_now", { job_key: "series.propose" })).state, "already_ran");
  const list = await f.call("ap_proposals", "list", { status: "open", type: "series.adopt" }, i.accounts);
  assert.equal(list.total_count, 5);
  await assert.rejects(() => f.call("ap_proposals", "list", { status: "weird" }), /Invalid filter/);
  assert.equal((await f.call("ap_proposals", "list", { status: "open" }, i.sales)).total_count, 0, "sales sees no accounts proposals");
  const invoiceProposal = list.rows.find(row => row.target_key === "invoices");
  assert.equal(invoiceProposal.can_decide, true);
  assert.equal(invoiceProposal.stale_now, false);
  await assert.rejects(() => f.call("ap_proposals", "decide", { id: invoiceProposal.id, decision: "accept" }, i.sales), /not available/);
  // Existing calendar-year numbering continues until the series is confirmed.
  await asActor("insert into invoices(company_id,customer_id,invoice_date,subtotal,tax_total,grand_total,status,place_of_supply_state_code) values($1,$2,'2026-11-05',100,18,118,'draft','07')", [i.company, i.customer], i.accounts);
  assert.match((await f.one("select invoice_number from invoices where invoice_date='2026-11-05'")).invoice_number, /^INV-2026-\d{4}$/);
  const accepted = await f.call("ap_proposals", "decide", { id: invoiceProposal.id, decision: "accept", note: "Matches the CA's format" }, i.accounts);
  assert.equal(accepted.state, "accepted");
  assert.equal((await f.call("ap_proposals", "decide", { id: invoiceProposal.id, decision: "accept" }, i.accounts)).repeated, true, "a double tap returns the first outcome");
  await assert.rejects(() => f.call("ap_proposals", "decide", { id: invoiceProposal.id, decision: "accept" }, i.owner), /already accepted/);
  const insert = date => asActor("insert into invoices(company_id,customer_id,invoice_date,subtotal,tax_total,grand_total,status,place_of_supply_state_code) values($1,$2,$3,100,18,118,'draft','07') returning invoice_number", [i.company, i.customer, date], i.accounts);
  assert.equal((await insert("2027-03-31"))[0].invoice_number, "OMX/26-27/0001");
  assert.equal((await insert("2027-03-31"))[0].invoice_number, "OMX/26-27/0002");
  assert.equal((await insert("2027-04-01"))[0].invoice_number, "OMX/27-28/0001", "1 April starts a new financial-year counter");
  // A rolled-back posting returns its number: the series stays gap-free.
  await f.db.exec("savepoint gap");
  await insert("2027-03-31");
  await f.db.exec("rollback to savepoint gap");
  assert.equal((await insert("2027-03-31"))[0].invoice_number, "OMX/26-27/0003");
  assert.match((await f.one("select invoice_number from invoices where invoice_date='2026-11-05'")).invoice_number, /^INV-2026-/, "existing numbers are unchanged");
  await assert.rejects(() => asActor("delete from invoices where invoice_number='OMX/26-27/0003'", [], i.owner), /cancel it instead/);
  // Editing the format is recorded field by field; GST's 16-character limit is enforced on tax documents.
  const credit = list.rows.find(row => row.target_key === "credit_notes");
  await assert.rejects(() => f.call("ap_proposals", "decide", { id: credit.id, decision: "edit", payload: { prefix_template: "OMALCO/CN/{FY4}/" } }, i.accounts), /at most 16/);
  await assert.rejects(() => f.call("ap_proposals", "decide", { id: credit.id, decision: "edit", payload: { gap_free: false } }, i.accounts), /Only prefix_template, pad_width/);
  const edited = await f.call("ap_proposals", "decide", { id: credit.id, decision: "edit", payload: { pad_width: 5 } }, i.accounts);
  assert.equal(edited.state, "edited");
  assert.deepEqual(edited.edited_fields, ["pad_width"]);
  const series = await f.call("ap_series", "list", {}, i.viewer);
  assert.equal(series.series.find(row => row.doc_key === "credit_notes").pad_width, 5);
  assert.equal(series.can_confirm, false);
  await assert.rejects(() => f.call("ap_series", "confirm", { doc_key: "quotes", prefix_template: "Q/{FY}/", pad_width: 4 }, i.sales), /Not permitted/);
  // Batch decisions report each row; one failure does not undo the others.
  const rest = (await f.call("ap_proposals", "list", { status: "open", type: "series.adopt" }, i.accounts)).rows.map(row => row.id);
  const batch = await f.call("ap_proposals", "decide_batch", { ids: rest, decision: "accept", note: "Formats confirmed" }, i.accounts);
  assert.deepEqual(batch.results.map(r => r.state), ["accepted", "accepted", "accepted"]);
  assert.equal(await count("select count(*) c from document_series where status='active' and company_id=$1", [i.company]), 5);
});

test("AP-002 stale and expired proposals cannot be accepted, and a rejected proposal is not repeated", async () => {
  for (let day = 1; day <= 15; day++) {
    for (const [route, visits] of [["/dashboard", 9], ["/quotes", 7], ["/customers", 5], ["/orders", 4], ["/crm", 2]]) {
      await f.db.query("insert into navigation_visit_counts(company_id,role,route,visit_date,visits) values($1,'sales',$2,$3,$4)", [i.company, route, istDay(-day), visits]);
    }
  }
  const run = await f.call("ap_jobs", "run_now", { job_key: "navigation.propose" });
  assert.equal(run.result.proposals, 1);
  const proposal = (await f.call("ap_proposals", "list", { type: "navigation.role_layout" })).rows[0];
  assert.deepEqual(proposal.payload.items, ["/dashboard", "/quotes", "/customers", "/orders", "/crm"]);
  assert.equal(proposal.evidence.days_observed, 15);
  assert.equal(n(proposal.confidence), 1);
  // Someone changes the sales navigation by hand: the proposal is now stale.
  await f.call("ap_navigation", "save", { role: "sales", items: ["/dashboard", "/quotes"] }, i.admin);
  assert.equal((await f.call("ap_proposals", "list", { type: "navigation.role_layout" })).rows[0].stale_now, true);
  const stale = await f.call("ap_proposals", "decide", { id: proposal.id, decision: "accept" }, i.owner);
  assert.equal(stale.state, "stale");
  assert.equal((await f.one("select status from proposals where id=$1", [proposal.id])).status, "stale");
  await assert.rejects(() => f.call("ap_proposals", "decide", { id: proposal.id, decision: "accept" }, i.owner), /already stale/);
  // The next run proposes against the new version; rejecting it stops the same advice coming back.
  await f.db.query("update system_job_runs set window_key='manual:20260101T0000'");
  await f.call("ap_jobs", "run_now", { job_key: "navigation.propose" });
  const fresh = (await f.call("ap_proposals", "list", { type: "navigation.role_layout", status: "open" })).rows[0];
  await assert.rejects(() => f.call("ap_proposals", "decide", { id: fresh.id, decision: "reject" }, i.owner), /Note is required/);
  assert.equal((await f.call("ap_proposals", "decide", { id: fresh.id, decision: "reject", note: "Sales also needs WhatsApp" }, i.owner)).state, "rejected");
  await f.db.query("update system_job_runs set window_key='manual:20260102T0000' where window_key like 'manual:2026%' and window_key<>'manual:20260101T0000'");
  assert.equal((await f.call("ap_jobs", "run_now", { job_key: "navigation.propose" })).result.proposals, 0);
  // Expiry.
  await f.db.query("update proposals set status='open',decided_by=null,decided_at=null,decision_note=null,expires_at=now()-interval '1 minute' where id=$1", [fresh.id]);
  assert.equal((await f.call("ap_proposals", "decide", { id: fresh.id, decision: "accept" }, i.owner)).state, "expired");
  await f.db.query("update proposals set status='open',expires_at=now()+interval '1 day' where id=$1", [fresh.id]);
  const refresh = await f.call("ap_jobs", "run_now", { job_key: "proposals.refresh" });
  assert.equal(refresh.state, "succeeded");
  assert.equal(refresh.result.details.stale, 0, "a current proposal is left open");
});

test("AP-042 visits are counted per role without identities, and role navigation is limited to nine approved items", async () => {
  assert.equal((await f.call("ap_navigation", "visit", { route: "/orders" }, i.sales)).counted, true);
  await f.call("ap_navigation", "visit", { route: "/orders" }, i.sales);
  assert.equal((await f.call("ap_navigation", "visit", { route: "/orders?id=secret" }, i.sales)).counted, false);
  assert.equal((await f.call("ap_navigation", "visit", { route: "/orders/../../etc" }, i.sales)).counted, false);
  const row = await f.one("select role,route,visits from navigation_visit_counts where company_id=$1", [i.company]);
  assert.deepEqual(row, { role: "sales", route: "/orders", visits: 2 });
  assert.deepEqual(Object.keys(await f.one("select * from navigation_visit_counts limit 1")).sort(), ["company_id", "role", "route", "visit_date", "visits"]);
  await assert.rejects(() => f.call("ap_navigation", "save", { role: "sales", items: ["/a", "/b", "/c", "/d", "/e", "/f", "/g", "/h", "/i", "/j"] }, i.admin), /one to nine/);
  await assert.rejects(() => f.call("ap_navigation", "save", { role: "sales", items: ["/orders", "/orders"] }, i.admin), /once/);
  await assert.rejects(() => f.call("ap_navigation", "save", { role: "sales", items: ["/orders"] }, i.salesManager), /Not permitted/);
  await assert.rejects(() => f.call("ap_navigation", "save", { role: "dealer_admin", items: ["/orders"] }, i.admin), /Unknown role/);
  await f.call("ap_navigation", "save", { role: "sales", items: ["/quotes", "/customers"] }, i.admin);
  assert.deepEqual((await f.call("ap_navigation", "layout", {}, i.sales)).items, ["/quotes", "/customers"]);
  assert.equal((await f.call("ap_navigation", "layout", {}, i.accounts)).items, null);
  const usage = await f.call("ap_navigation", "usage", {}, i.owner);
  assert.equal(usage.roles.find(r => r.role === "sales").top[0].visits, 2);
  await assert.rejects(() => f.call("ap_navigation", "usage", {}, i.sales), /Not permitted/);
  assert.equal(n((await f.asUser("select count(*) c from navigation_visit_counts", [], i.sales))[0].c), 0, "employees cannot read visit counts directly");
});

test("AP-004 the factory calendar moves promises across a shutdown and keeps calendar-day results unchanged by default", async () => {
  const sunday = "2026-11-08", diwaliFrom = "2026-11-10", diwaliTo = "2026-11-14";
  const read = await f.call("ap_calendar", "read", { from: "2026-11-01", to: "2026-11-30" }, i.sales);
  assert.deepEqual(read.settings.weekly_off, [0]);
  assert.equal(read.can_edit, false);
  const before = await f.call("ap_calendar", "add_working_days", { start: "2026-11-09", days: 5 }, i.sales);
  assert.equal(before.date, "2026-11-14", "Mon + 5 working days = Sat with only Sunday off");
  assert.equal(before.calendar_date, "2026-11-14");
  await assert.rejects(() => f.call("ap_calendar", "add_exception", { date_from: diwaliFrom, date_to: diwaliTo, kind: "shutdown", label: "Diwali shutdown" }, i.sales), /Not permitted/);
  await f.call("ap_calendar", "add_exception", { date_from: diwaliFrom, date_to: diwaliTo, kind: "shutdown", label: "Diwali shutdown" }, i.factory);
  await assert.rejects(() => f.call("ap_calendar", "add_exception", { date_from: diwaliFrom, date_to: diwaliTo, kind: "shutdown", label: "Diwali shutdown" }, i.factory), /already exists/);
  await assert.rejects(() => f.call("ap_calendar", "add_exception", { date_from: "2026-11-12", date_to: "2026-11-12", kind: "working_day", label: "Overtime" }, i.factory), /cannot overlap/);
  await assert.rejects(() => f.call("ap_calendar", "add_exception", { date_from: "2026-11-12", date_to: "2027-03-12", kind: "holiday", label: "Too long" }, i.factory), /63 days/);
  const after = await f.call("ap_calendar", "add_working_days", { start: "2026-11-09", days: 5 }, i.sales);
  assert.equal(after.date, "2026-11-20", "the promise moves by the five shutdown days (Tue-Sat) plus the Sunday");
  assert.equal(after.calendar_date, "2026-11-14", "the calendar-day answer is unchanged");
  await f.call("ap_calendar", "add_exception", { date_from: "2026-11-15", date_to: "2026-11-15", kind: "working_day", label: "Sunday catch-up" }, i.productionManager);
  assert.equal((await f.call("ap_calendar", "add_working_days", { start: "2026-11-09", days: 5 }, i.sales)).date, "2026-11-19");
  assert.equal((await f.one("select private.factory_working_days_between($1,$2,'2026-11-21') d", [i.company, sunday])).d, 8, "13 days minus the five shutdown days; the overridden Sunday counts");
  await assert.rejects(() => f.call("ap_calendar", "save_settings", { weekly_off: [7], shifts: [{ code: "A", start: "06:00", end: "14:00" }] }, i.factory), /0 \(Sunday\)/);
  await assert.rejects(() => f.call("ap_calendar", "save_settings", { weekly_off: [0], shifts: [{ code: "A", start: "06:00", end: "06:00" }] }, i.factory), /shifts/);
  await f.call("ap_calendar", "save_settings", { weekly_off: [0, 6], shifts: [{ code: "A", start: "08:00", end: "20:00" }, { code: "B", start: "20:00", end: "08:00" }], promise_basis: "working" }, i.factory);
  assert.equal((await f.call("ap_calendar", "read", {}, i.sales)).settings.promise_basis, "working");
  assert.equal((await f.call("ap_calendar", "read", { from: "2026-11-01", to: "2026-11-30" }, i.foreign)).exceptions.length, 0, "another company sees none of these entries");
  const id = (await f.call("ap_calendar", "read", { from: "2026-11-01", to: "2026-11-30" }, i.sales)).exceptions[0].id;
  await f.call("ap_calendar", "remove_exception", { id }, i.factory);
  await assert.rejects(() => f.call("ap_calendar", "remove_exception", { id }, i.factory), /no longer/);
  const job = await f.call("ap_jobs", "run_now", { job_key: "calendar.check" });
  assert.equal(job.result.alerts, 3, "owner, factory manager and production manager are told the calendar is empty");
});

test("AP-059 a month closes by proposal, a closed month needs an approved reopen, and back-dated entries are flagged", async () => {
  const lastMonth = previousMonth();
  await f.db.query("insert into period_policies(company_id,close_proposal_day,backdate_flag_days) values($1,1,3)", [i.company]);
  await asActor("insert into invoices(company_id,customer_id,invoice_date,subtotal,tax_total,grand_total,status,place_of_supply_state_code) values($1,$2,$3,1000,180,1180,'generated','07')", [i.company, i.customer, `${lastMonth}-15`], i.accounts);
  assert.equal(await count("select count(*) c from backdated_entry_flags where table_name='invoices'"), 1, "an invoice dated weeks ago is flagged");
  const run = await f.call("ap_jobs", "run_now", { job_key: "periods.propose_close" }, i.admin);
  assert.equal(run.result.proposals, 1);
  const proposal = (await f.call("ap_proposals", "list", { type: "period.close_month" }, i.accounts)).rows[0];
  assert.equal(proposal.payload.month, lastMonth);
  assert.equal(n(proposal.evidence.invoices), 1);
  await assert.rejects(() => f.call("ap_proposals", "decide", { id: proposal.id, decision: "edit", payload: { month: "2020-01" } }, i.accounts), /Only nothing/);
  assert.equal((await f.call("ap_proposals", "decide", { id: proposal.id, decision: "accept" }, i.accounts)).state, "accepted");
  const overview = await f.call("ap_period", "overview", {}, i.accounts);
  const lockMonthEnd = overview.locked_through;
  assert.equal(lockMonthEnd.slice(0, 7), lastMonth);
  const insertOld = () => asActor("insert into invoices(company_id,customer_id,invoice_date,subtotal,tax_total,grand_total,status,place_of_supply_state_code) values($1,$2,$3,10,1.8,11.8,'draft','07')", [i.company, i.customer, `${lastMonth}-20`], i.accounts);
  await assert.rejects(insertOld, /without an approved reopen/);
  await assert.rejects(() => f.call("ap_period", "close_month", { month: lastMonth, reason: "Closing again for the test" }, i.accounts), /already closed/);
  await assert.rejects(() => f.call("ap_period", "close_month", { month: istDay(0).slice(0, 7), reason: "Current month cannot close" }, i.accounts), /after it ends/);
  await assert.rejects(() => f.call("ap_period", "close_month", { month: lastMonth, reason: "short" }, i.sales), /Not permitted/);
  // Reopen: another person approves; postings during the window are recorded; re-closing stops them again.
  const request = await f.call("ap_period", "request_reopen", { month: lastMonth, reason: "Customer invoice missed in the month" }, i.accounts);
  await assert.rejects(() => f.call("ap_period", "request_reopen", { month: lastMonth, reason: "Second request for the same month" }, i.sales), /already requested/);
  await assert.rejects(() => f.call("ap_period", "approve_reopen", { id: request.id, note: "Approved" }, i.accounts), /Another person/);
  await assert.rejects(() => f.call("ap_period", "approve_reopen", { id: request.id, note: "Approved" }, i.sales), /Not permitted/);
  await assert.rejects(insertOld, /without an approved reopen/, "a request alone does not open the month");
  await f.call("ap_period", "approve_reopen", { id: request.id, note: "Approved for one invoice" }, i.owner);
  await insertOld();
  assert.equal(await count("select count(*) c from period_exception_postings where reopen_id=$1", [request.id]), 1);
  await f.call("ap_period", "reclose", { id: request.id }, i.accounts2);
  await assert.rejects(insertOld, /without an approved reopen/);
  // A window that has passed no longer allows postings.
  const second = await f.call("ap_period", "request_reopen", { month: lastMonth, reason: "Second correction for the month" }, i.sales);
  await f.call("ap_period", "approve_reopen", { id: second.id, note: "Approved again" }, i.accounts);
  await f.db.query("update period_reopen_requests set window_ends_at=now()-interval '1 minute' where id=$1", [second.id]);
  await assert.rejects(insertOld, /without an approved reopen/);
  // Flags are reviewed by someone other than the person who made the entry.
  const flags = await f.call("ap_period", "flags", {}, i.accounts2);
  assert.equal(flags.total_count, 2, "the original late invoice and the one posted in the reopen window");
  assert.ok(flags.rows.every(row => row.table_name === "invoices" && row.days_back > 3));
  await assert.rejects(() => f.call("ap_period", "review_flag", { id: flags.rows[0].id, note: "Checked" }, i.accounts), /your own entry/);
  for (const flag of flags.rows) await f.call("ap_period", "review_flag", { id: flag.id, note: "Checked with the bill" }, i.accounts2);
  await assert.rejects(() => f.call("ap_period", "review_flag", { id: flags.rows[0].id, note: "Checked twice" }, i.owner), /already reviewed/);
  assert.equal((await f.call("ap_period", "flags", {}, i.owner)).total_count, 0);
  assert.equal((await f.call("ap_period", "flags", { state: "all" }, i.owner)).total_count, 2);
  await assert.rejects(() => f.call("ap_period", "flags", {}, i.sales), /Not permitted/);
});

test("AP-006 masters import in one transaction with duplicates rejected, a remembered mapping and undo before use", async () => {
  const stage = (master, rows, rejected = [], actor = i.admin) => f.call("ap_import", "stage", { master, file_name: `${master}.xlsx`, file_sha256: "a".repeat(64),
    header_signature: "b".repeat(32), mapping: { "Customer Name": "customer_name" }, rows, rejected }, actor);
  await assert.rejects(() => stage("customers", [], [], i.accounts), /Not permitted/);
  const staged = await stage("customers", [
    { row: 2, values: { customer_name: "Patel Aluminium", city: "Surat", customer_type: "dealer", gst_number: VALID_GSTIN, gst_registration: "registered" }, source: {} },
    { row: 3, values: { customer_name: "Sharma Fabricators", city: "Pune", customer_type: "fabricator", gst_registration: "unregistered" }, source: { "Customer Name": "Sharma Fabricators" } },
    { row: 4, values: { customer_name: "patel aluminium", city: "surat", customer_type: "dealer", gst_registration: "unregistered" }, source: {} },
    { row: 5, values: { customer_name: "Mehta Windows", city: "Nashik", customer_type: "fabricator", gst_registration: "unregistered" }, source: {} }
  ], [{ row: 6, errors: ["GSTIN fails the check digit"], values: { "Customer Name": "Bad" } }]);
  assert.equal(staged.valid_rows, 2);
  assert.deepEqual(staged.rejected.map(r => [r.row, r.errors[0]]), [[3, "A customer with this name and city already exists"], [4, "Repeats an earlier row in this sheet"], [6, "GSTIN fails the check digit"]]);
  assert.deepEqual((await f.call("ap_import", "mapping", { master: "customers", header_signature: "b".repeat(32) })).mapping, { "Customer Name": "customer_name" });
  assert.equal(await count("select count(*) c from customers where customer_name in ('Patel Aluminium','Mehta Windows')"), 0, "a preview writes no masters");
  const done = await f.call("ap_import", "commit", { batch_id: staged.batch_id });
  assert.equal(done.imported_rows, 2);
  assert.equal((await f.call("ap_import", "commit", { batch_id: staged.batch_id })).repeated, true);
  assert.equal((await f.one("select state,gst_registration from customers where customer_name='Patel Aluminium'")).state, "Maharashtra");
  // Profiles then dies that point at them; machines keep the factory code in notes.
  const profiles = await stage("profiles", [{ row: 2, values: { profile_code: "om-4521", profile_name: "Casement frame", section_weight_kg_per_m: 1.12, application_category: "casement_window" } }]);
  await f.call("ap_import", "commit", { batch_id: profiles.batch_id });
  const dies = await stage("dies", [{ row: 2, values: { die_number: "D-4521-A", profile_code: "OM-4521", ownership_type: "company_owned" } },
    { row: 3, values: { die_number: "D-9999-A", profile_code: "OM-9999" } }]);
  assert.match(dies.rejected[0].errors[0], /not in the profile master/);
  await f.call("ap_import", "commit", { batch_id: dies.batch_id });
  assert.equal((await f.one("select p.profile_code from dies d join aluminium_profiles p on p.id=d.profile_id where d.die_number='D-4521-A'")).profile_code, "OM-4521");
  const machines = await stage("machines", [{ row: 2, values: { machine_name: "Press 1 (1460 T)", machine_type: "extrusion_press", press_capacity_ton: 1460, factory_code: "P1" } }]);
  await f.call("ap_import", "commit", { batch_id: machines.batch_id });
  const press = await f.one("select machine_code,notes from machines where machine_name='Press 1 (1460 T)'");
  assert.match(press.machine_code, /^MACH-/);
  assert.equal(press.notes, "Factory code P1");
  const transporters = await stage("transporters", [{ row: 2, values: { vendor_name: "Gati Ltd", gst_registration: "unregistered" } }, { row: 3, values: { vendor_name: "VRL Logistics" } }]);
  assert.equal(transporters.valid_rows, 1);
  await f.call("ap_import", "commit", { batch_id: transporters.batch_id });
  assert.equal((await f.one("select vendor_type from vendors where vendor_name='Gati Ltd'")).vendor_type, "transporter");
  // Undo: allowed while unused, refused once a transaction references a row.
  await assert.rejects(() => f.call("ap_import", "reverse", { batch_id: profiles.batch_id, reason: "Wrong sheet uploaded" }), /already used in dies/);
  const customer = (await f.one("select id from customers where customer_name='Mehta Windows'")).id;
  await f.db.query("insert into orders(company_id,order_number,customer_id,order_date,priority) values($1,'SO-AP-1',$2,current_date,'normal')", [i.company, customer]);
  await assert.rejects(() => f.call("ap_import", "reverse", { batch_id: staged.batch_id, reason: "Wrong sheet uploaded" }), /already used in orders/);
  assert.equal((await f.call("ap_import", "reverse", { batch_id: transporters.batch_id, reason: "Wrong transporter list" })).removed, 1);
  assert.equal(await count("select count(*) c from vendors where vendor_name='Gati Ltd'"), 0);
  await assert.rejects(() => f.call("ap_import", "reverse", { batch_id: transporters.batch_id, reason: "Wrong transporter list" }), /Only an imported batch/);
  // A preview whose source changed before commit imports nothing.
  const late = await stage("customers", [{ row: 2, values: { customer_name: "Late Party", city: "Rajkot", customer_type: "dealer", gst_registration: "unregistered" } }]);
  await f.db.query("insert into customers(company_id,customer_name,customer_type,city) values($1,'Late Party','dealer','Rajkot')", [i.company]);
  await assert.rejects(() => f.call("ap_import", "commit", { batch_id: late.batch_id }), /changed since the preview/);
  const list = await f.call("ap_import", "list", { page: 1 });
  assert.equal(list.total_count, 6);
  assert.equal(list.rows.length, 6);
  assert.equal((await f.call("ap_import", "list", {}, i.foreign)).total_count, 0);
});

test("AP-006 500 customers and 1,000 profiles import well inside two minutes", async () => {
  const started = Date.now();
  const customers = Array.from({ length: 500 }, (_, k) => ({ row: k + 2, values: { customer_name: `Bulk customer ${k}`, city: "Pune", customer_type: "fabricator", gst_registration: "unregistered" } }));
  const profiles = Array.from({ length: 1000 }, (_, k) => ({ row: k + 2, values: { profile_code: `BULK-${k}`, profile_name: `Bulk profile ${k}`, section_weight_kg_per_m: 0.5 + (k % 10) / 10 } }));
  for (const [master, rows] of [["customers", customers], ["profiles", profiles]]) {
    const staged = await f.call("ap_import", "stage", { master, file_name: `${master}.xlsx`, file_sha256: "c".repeat(64), header_signature: "d".repeat(32), mapping: {}, rows, rejected: [] });
    assert.equal(staged.valid_rows, rows.length);
    assert.equal((await f.call("ap_import", "commit", { batch_id: staged.batch_id })).imported_rows, rows.length);
  }
  const seconds = (Date.now() - started) / 1000;
  assert.ok(seconds < 120, `took ${seconds}s`);
  console.log(`AP-006 bulk import: ${seconds.toFixed(1)} s`);
});

test("AP-007 opening balances post only when they equal the signed sheet, then lock the earlier period", async () => {
  const cutover = istDay(0);
  await assert.rejects(() => f.call("ap_cutover", "start", { cutover_date: cutover }, i.sales), /Not permitted/);
  const plan = await f.call("ap_cutover", "start", { cutover_date: cutover }, i.accounts);
  assert.equal(plan.sections.length, 7);
  await assert.rejects(() => f.call("ap_cutover", "start", { cutover_date: cutover }, i.accounts), /already exists/);
  const stock = [{ row: 2, values: { profile_code: "OM-2045", finish: "mill_finish", piece_length_m: 6, pieces: 40, weight_kg: 228, location: "Rack 4", bundle_number: "OB-001" } },
    { row: 3, values: { profile_code: "om-2045", finish: "anodizing", piece_length_m: 5.8, pieces: 20, weight_kg: 110.2, location: "Rack 5" } }];
  await assert.rejects(() => f.call("ap_cutover", "load", { section: "profile_stock", file_name: "stock.xlsx", file_sha256: "e".repeat(64), rows: stock, control: { count: 2, quantity: 338.2 } }, i.accounts), /Not permitted/);
  const bad = await f.call("ap_cutover", "load", { section: "profile_stock", file_name: "stock.xlsx", file_sha256: "e".repeat(64), rows: [...stock, { row: 4, values: { profile_code: "NOPE", piece_length_m: 6, pieces: 1, weight_kg: 1 } }], control: { count: 3, quantity: 339.2 } }, i.inventory);
  assert.equal(bad.state, "rejected");
  assert.match(bad.errors[0].errors[0], /not in the profile master/);
  await f.call("ap_cutover", "load", { section: "profile_stock", file_name: "stock.xlsx", file_sha256: "e".repeat(64), rows: stock, control: { count: 2, quantity: 338.3 } }, i.inventory);
  await assert.rejects(() => f.call("ap_cutover", "sign_off_section", { section: "profile_stock" }, i.admin), /do not match the signed sheet/);
  await f.call("ap_cutover", "load", { section: "profile_stock", file_name: "stock.xlsx", file_sha256: "e".repeat(64), rows: stock, control: { count: 2, quantity: 338.2 } }, i.inventory);
  await assert.rejects(() => f.call("ap_cutover", "sign_off_section", { section: "profile_stock" }, i.inventory), /Another person/);
  const signed = await f.call("ap_cutover", "sign_off_section", { section: "profile_stock" }, i.admin);
  assert.deepEqual(signed.ledger_totals, { count: 2, quantity: 338.2, amount: 0 });
  assert.deepEqual((await f.one("select count(*)::int c,sum(total_weight_kg)::float kg from profile_stock_batches where origin_type='opening_balance' and company_id=$1", [i.company])), { c: 2, kg: 338.2 });
  // Receivables keep the original reference and never take a GST series number.
  await f.call("ap_series", "confirm", { doc_key: "invoices", prefix_template: "OMX/{FY}/", pad_width: 4 }, i.accounts);
  const receivables = [{ row: 2, values: { customer: "Sharma Fabricators", invoice_ref: "OM/25-26/1180", invoice_date: istDay(-70), due_date: istDay(-10), outstanding_amount: 118000 } },
    { row: 3, values: { customer: "Fixture customer", invoice_ref: "OM/26-27/0212", invoice_date: istDay(-20), outstanding_amount: 59000.5 } }];
  await f.call("ap_cutover", "load", { section: "receivables", file_name: "debtors.xlsx", file_sha256: "f".repeat(64), rows: receivables, control: { count: 2, amount: 177000.5 } }, i.accounts);
  await f.call("ap_cutover", "sign_off_section", { section: "receivables" }, i.accounts2);
  const opening = (await f.db.query("select invoice_number,opening_reference,grand_total from invoices where opening_cutover_id is not null order by opening_reference")).rows;
  assert.deepEqual(opening.map(r => r.opening_reference), ["OM/25-26/1180", "OM/26-27/0212"]);
  assert.ok(opening.every(r => /^OB-\d{4}-\d{4}$/.test(r.invoice_number)), JSON.stringify(opening));
  assert.equal(await count("select count(*) c from backdated_entry_flags where table_name='invoices'"), 0, "opening receivables are not back-dating exceptions");
  assert.equal((await asActor("insert into invoices(company_id,customer_id,invoice_date,subtotal,tax_total,grand_total,status,place_of_supply_state_code) values($1,$2,$3,1,0,1,'draft','07') returning invoice_number", [i.company, i.customer, cutover], i.accounts))[0].invoice_number.startsWith("OMX/"), true);
  // Billets, consumables, payables, open orders and die custody.
  await f.call("ap_cutover", "load", { section: "billet_stock", file_name: "billets.xlsx", file_sha256: "1".repeat(64), rows: [{ row: 2, values: { batch_number: "HB-7781", alloy: "6063", weight_kg: 5400.5 } }], control: { count: 1, quantity: 5400.5 } }, i.inventory);
  await f.call("ap_cutover", "sign_off_section", { section: "billet_stock" }, i.owner);
  await f.call("ap_cutover", "load", { section: "consumable_stock", file_name: "stores.xlsx", file_sha256: "2".repeat(64), rows: [{ row: 2, values: { item_code: "PK-STRETCH", item_name: "Stretch film", category: "packing_material", unit: "kg", quantity: 120, rate: 180 } }], control: { count: 1, quantity: 120, amount: 21600 } }, i.inventory);
  await f.call("ap_cutover", "sign_off_section", { section: "consumable_stock" }, i.admin);
  assert.equal(await count("select count(*) c from inventory_movements where reference_type='opening_stock'"), 1);
  await f.call("ap_cutover", "load", { section: "payables", file_name: "creditors.xlsx", file_sha256: "3".repeat(64), rows: [{ row: 2, values: { vendor: "Shree Nitriding Works", bill_ref: "SNW-889", bill_date: istDay(-15), outstanding_amount: 23600 } }], control: { count: 1, amount: 23600 } }, i.accounts);
  await f.call("ap_cutover", "sign_off_section", { section: "payables" }, i.owner);
  assert.equal((await f.one("select source_module,balance_amount::float b from expense_ledger where invoice_number='SNW-889'")).b, 23600);
  await f.call("ap_cutover", "load", { section: "open_orders", file_name: "orders.xlsx", file_sha256: "4".repeat(64), rows: [
    { row: 2, values: { customer: "Sharma Fabricators", order_ref: "PO-55", profile_code: "OM-2045", balance_kg: 750, balance_pieces: 130 } },
    { row: 3, values: { customer: "Sharma Fabricators", order_ref: "PO-55", profile_code: "AL-NOV3", balance_kg: 250 } }], control: { count: 2, quantity: 1000 } }, i.admin);
  await f.call("ap_cutover", "sign_off_section", { section: "open_orders" }, i.owner);
  const order = await f.one("select count(*)::int c, max(requested_weight_kg)::float kg from orders where opening_cutover_id is not null");
  assert.deepEqual(order, { c: 1, kg: 1000 });
  // An unused opening order can be reversed (its lines go with it) and loaded again.
  await f.call("ap_cutover", "reverse_section", { section: "open_orders", reason: "Balance sheet had the wrong PO" }, i.owner);
  assert.equal(await count("select count(*) c from orders where opening_cutover_id is not null"), 0);
  await f.call("ap_cutover", "load", { section: "open_orders", file_name: "orders.xlsx", file_sha256: "4".repeat(64), rows: [
    { row: 2, values: { customer: "Sharma Fabricators", order_ref: "PO-56", profile_code: "OM-2045", balance_kg: 1000 } }], control: { count: 1, quantity: 1000 } }, i.admin);
  await f.call("ap_cutover", "sign_off_section", { section: "open_orders" }, i.owner);
  await f.call("ap_cutover", "load", { section: "die_custody", file_name: "dies.xlsx", file_sha256: "5".repeat(64), rows: [{ row: 2, values: { die_number: "D-2045-A", custodian: "Shree Nitriding Works", custody_status: "nitriding", since_date: istDay(-3) } }], control: { count: 1 } }, i.factory);
  await f.call("ap_cutover", "sign_off_section", { section: "die_custody" }, i.productionManager);
  assert.deepEqual(await f.one("select die_status, rack_location like 'With Shree Nitriding Works%' w from dies where id=$1", [i.die]), { die_status: "nitriding", w: true });
  // A signed section can be reversed with a reason while nothing has used it.
  await f.call("ap_cutover", "reverse_section", { section: "billet_stock", reason: "Heat number column was wrong" }, i.inventory);
  assert.equal(await count("select count(*) c from billet_batches where batch_number='HB-7781'"), 0);
  await assert.rejects(() => f.call("ap_cutover", "sign_off_plan", {}, i.owner), /Confirm that they are empty/);
  const final = await f.call("ap_cutover", "sign_off_plan", { empty_sections_confirmed: true }, i.owner);
  assert.equal(final.status, "signed_off");
  assert.equal(final.locked_through, istDay(-1));
  await assert.rejects(() => asActor("insert into payments(company_id,invoice_id,payment_date,amount,payment_method,payment_status) values($1,$2,$3,10,'cash','CONFIRMED')", [i.company, i.invoice, istDay(-2)], i.accounts), /Books are closed/);
  await assert.rejects(() => f.call("ap_cutover", "reverse_section", { section: "receivables", reason: "Too late to change this" }, i.accounts), /signed off/);
  await assert.rejects(() => f.call("ap_cutover", "get", {}, i.sales), /Not permitted/);
  assert.equal((await f.call("ap_cutover", "get", {}, i.foreign)).plan, null);
});

test("AP-041 related work for a record reuses each hub's read model and respects hub permissions", async () => {
  const forOwner = await f.call("ap_home_work", "record", { kind: "order", id: i.order }, i.owner);
  const views = forOwner.items.map(item => `${item.hub}.${item.view}`).sort();
  assert.ok(views.includes("coordination.orders"), JSON.stringify(views));
  assert.ok(forOwner.items.every(item => item.href.startsWith("/tasks/") && item.label));
  const forSales = await f.call("ap_home_work", "record", { kind: "order", id: i.order }, i.sales);
  for (const item of forSales.items) assert.equal((await f.one("select private.ap_hub_read_allowed($1,'sales',$2) v", [item.hub, item.view])).v, true);
  await assert.rejects(() => f.call("ap_home_work", "record", { kind: "order", id: i.foreignOrder }, i.owner), /not available/);
  await assert.rejects(() => f.call("ap_home_work", "record", { kind: "planet", id: i.order }, i.owner), /Unknown record kind/);
  await assert.rejects(() => f.call("ap_home_work", "record", { kind: "order", id: i.order }, i.dealer), /Not permitted/);
  const attention = await f.call("ap_home_work", "attention", { limit: 5 }, i.owner);
  assert.ok(attention.items.length <= 6);
  assert.ok(n(attention.total_count) >= attention.items.length);
  // Every home source names a real table and column.
  const sources = (await f.db.query("select * from private.ap_home_sources()")).rows;
  for (const s of sources) assert.equal(n((await f.one("select count(*) c from information_schema.columns where table_schema='public' and table_name=$1 and column_name=$2", [s.table_name, s.link_column])).c), 1, `${s.table_name}.${s.link_column}`);
});

test("every new table has RLS and company scoping, and only the intended functions are callable by clients", async () => {
  const tables = ["system_job_runs", "proposals", "factory_calendar_settings", "factory_calendar_exceptions", "document_series", "document_series_counters", "period_policies",
    "period_reopen_requests", "period_exception_postings", "backdated_entry_flags", "navigation_visit_counts", "role_navigation", "master_import_mappings", "master_import_batches",
    "master_import_rows", "cutover_plans", "cutover_sections", "cutover_opening_lines"];
  for (const table of tables) {
    const row = await f.one("select c.relrowsecurity rls, exists(select 1 from information_schema.columns where table_schema='public' and table_name=$1 and column_name='company_id') scoped,"
      + " has_table_privilege('authenticated', 'public.'||$1, 'INSERT') ins, has_table_privilege('authenticated', 'public.'||$1, 'UPDATE') upd, has_table_privilege('anon', 'public.'||$1, 'SELECT') anon"
      + " from pg_class c where c.oid=('public.'||$1)::regclass", [table]);
    assert.deepEqual(row, { rls: true, scoped: true, ins: false, upd: false, anon: false }, table);
    assert.ok(n((await f.one("select count(*) c from pg_indexes where schemaname='public' and tablename=$1 and indexdef like '%company_id%'", [table])).c) >= 1, `${table} has a company index`);
  }
  const callable = (await f.db.query(`select p.proname from pg_proc p where p.pronamespace in ('public'::regnamespace,'private'::regnamespace) and (p.proname like 'ap\\_%' or p.proname in ('factory_is_working_day', 'factory_add_working_days', 'factory_working_days_between'))
    and has_function_privilege('authenticated', p.oid, 'EXECUTE') order by 1`)).rows.map(r => r.proname);
  assert.deepEqual(callable, ["ap_calendar", "ap_cutover", "ap_home_work", "ap_import", "ap_jobs", "ap_navigation", "ap_period", "ap_proposals", "ap_series"]);
  const definers = (await f.db.query(`select p.proname, p.proconfig from pg_proc p where p.pronamespace in ('public'::regnamespace,'private'::regnamespace) and p.proname like 'ap\\_%' and p.prosecdef`)).rows;
  for (const fn of definers) assert.ok(fn.proconfig?.some(c => c.startsWith("search_path=")), `${fn.proname} pins its search path`);
  // Rows of another company are invisible through direct reads.
  await f.call("ap_navigation", "save", { role: "sales", items: ["/orders"] }, i.admin);
  assert.equal(n((await f.asUser("select count(*) c from role_navigation", [], i.foreign))[0].c), 0);
});

test("the TypeScript mirrors match the database registries for jobs, home-record sources and navigation roles", async () => {
  const { JOBS } = await import("../lib/jobs/registry.ts");
  const { HOME_SOURCES, HOME_KIND_KEYS } = await import("../lib/navigation/home-work.ts");
  const { NAV_ROLES } = await import("../lib/navigation/role-navigation.ts");
  const jobs = (await f.db.query("select job_key, schedule, label from private.ap_job_registry() order by job_key")).rows;
  assert.deepEqual(jobs, [...JOBS].sort((a, b) => a.job_key.localeCompare(b.job_key)).map(({ job_key, schedule, label }) => ({ job_key, schedule, label })));
  const sources = (await f.db.query("select home_kind, hub, view_name, table_name, link_column from private.ap_home_sources()")).rows.map(row => Object.values(row));
  assert.deepEqual(sources, HOME_SOURCES.map(source => [...source]));
  for (const kind of HOME_KIND_KEYS) assert.ok((await f.one("select private.ap_home_table($1) t", [kind])).t, kind);
  assert.deepEqual((await f.one("select private.ap_nav_roles() r")).r, [...NAV_ROLES]);
});

test("the single-company guard still refuses a second company when it is active", async () => {
  await f.db.exec("alter table public.companies enable trigger trg_enforce_single_company");
  await assert.rejects(() => f.db.query("insert into companies(name) values('Third company')"), /dedicated to Omalco/);
});

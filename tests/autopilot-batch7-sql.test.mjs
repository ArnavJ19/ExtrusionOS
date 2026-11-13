import test from "node:test";
import assert from "node:assert/strict";
import { createBatch7Fixture, ids as i, istDay, lastMonthRange } from "../scripts/lib/autopilot-batch7-fixture.mjs";

let f;
test.before(async () => { f = await createBatch7Fixture(); });
test.after(async () => { await f?.close(); });
test.beforeEach(async () => { await f.start(); });
test.afterEach(async () => { await f.rollback(); });
const denied = e => e.code === "42501";

// ---------------------------------------------------------------- AP-003
test("AP-003 counts each outcome by type and role, types fields typed, and lists the most common correction", async () => {
  await f.proposal({ status: "accepted", minutes: 10 });
  await f.proposal({ status: "accepted", minutes: 30 });
  await f.proposal({ status: "edited", edited: ["rate_day"], payload: { rate_day: "2026-11-01" }, decision: { rate_day: "2026-11-02" }, decidedBy: i.salesManager, role: "sales_manager", minutes: 60 });
  await f.proposal({ status: "edited", edited: ["rate_day", "quotes"], payload: { rate_day: "2026-11-01" }, decision: { rate_day: "2026-11-02", quotes: 3 }, decidedBy: i.salesManager, role: "sales_manager" });
  await f.proposal({ status: "rejected", decidedBy: i.salesManager, role: "sales_manager" });
  await f.proposal({ status: "expired" });
  await f.proposal({ status: "open" });
  await f.proposal({ status: "accepted", daysAgo: 60 }); // outside a 4-week window
  const o = await f.ap("ap_quality", "overview", { weeks: 4 });
  const row = o.types.find(t => t.proposal_type === "quote.reprice");
  assert.deepEqual([row.stats.total, row.stats.accepted, row.stats.edited, row.stats.rejected, row.stats.ignored, row.stats.open, row.stats.decided], [7, 2, 2, 1, 1, 1, 5]);
  assert.equal(Number(row.stats.acceptance_rate), 40);
  assert.equal(Number(row.stats.fields_typed), 0.75, "(0 + 0 + 1 + 2) / 4 decisions that were accepted or edited");
  assert.equal(Number(row.stats.median_minutes), 30);
  assert.ok(row.flags.includes("review"), "edited + rejected (3) exceed accepted (2) with five decisions");
  assert.equal((await f.ap("ap_quality", "overview", { weeks: 12 })).types.find(t => t.proposal_type === "quote.reprice").stats.total, 8);
  const roles = await f.ap("ap_quality", "roles", { proposal_type: "quote.reprice", weeks: 4 }, i.factory);
  assert.deepEqual(roles.roles.map(r => [r.role, r.stats.decided]), [["owner", 2], ["sales_manager", 3]]);
  assert.ok(!JSON.stringify(roles).includes(i.salesManager), "the read model never names a person");
  const corrections = await f.ap("ap_quality", "corrections", { proposal_type: "quote.reprice", weeks: 4 });
  const field = corrections.fields.find(x => x.field === "rate_day");
  assert.deepEqual([field.edits, field.most_common_value, field.times, field.usually_proposed], [2, "2026-11-02", 2, "2026-11-01"]);
  assert.equal((await f.ap("ap_quality", "corrections", { proposal_type: "quote.reprice", weeks: 4 }, i.factory)).fields.length, 0, "values are shown only to roles that may decide the proposal");
  const weekly = await f.ap("ap_quality", "weekly", { proposal_type: "quote.reprice" });
  assert.equal(weekly.weeks.length, 12);
  assert.equal(weekly.weeks.reduce((n, w) => n + w.stats.total, 0), 8, "twelve weeks include the 60-day-old proposal");
});

test("AP-003 records the deciding role on a real decision; rule changes compare before and after; only owner/admin record; other companies see nothing", async () => {
  const id = await f.proposal({ status: "open" });
  await f.seed("update proposals set status='accepted', decided_by=$2, decided_at=now() where id=$1", [id, i.salesManager]);
  // The seed above suspends triggers; a production update runs the trigger.
  await f.raw("update proposals set decided_by=$2 where id=$1", [id, i.accounts]);
  assert.equal((await f.one("select decided_role from proposals where id=$1", [id])).decided_role, "accounts");
  for (let n = 0; n < 5; n++) await f.proposal({ status: "rejected", daysAgo: 6 + (n % 4), decidedBy: i.salesManager, role: "sales_manager" });
  for (let n = 0; n < 5; n++) await f.proposal({ status: "accepted", daysAgo: 1 + (n % 3) });
  await assert.rejects(() => f.ap("ap_quality", "record_change", { proposal_type: "quote.reprice", changed_on: istDay(-5), description: "Lowered the repricing threshold" }, i.factory), denied);
  await assert.rejects(() => f.ap("ap_quality", "record_change", { proposal_type: "die.service_due", changed_on: istDay(-5), description: "No such proposals exist yet" }), /nothing to compare/);
  await assert.rejects(() => f.ap("ap_quality", "record_change", { proposal_type: "quote.reprice", changed_on: istDay(2), description: "A change in the future" }), /not in the future/);
  const saved = await f.ap("ap_quality", "record_change", { proposal_type: "quote.reprice", changed_on: istDay(-5), description: "Repricing now proposes only above a 1% rate move" });
  const c = saved.comparison;
  assert.equal(c.window_days, 5);
  assert.equal(c.before.rejected, 5); assert.equal(Number(c.before.acceptance_rate), 0);
  assert.equal(c.after.accepted, 6, "five seeded plus the one decided above"); assert.equal(Number(c.after.acceptance_rate), 100);
  assert.equal(Number(c.acceptance_change), 100);
  assert.equal(c.state, "comparable");
  const list = await f.ap("ap_quality", "changes", {}, i.factory);
  assert.equal(list.rows[0].recorded_by_role, "owner");
  assert.ok(!("recorded_by" in list.rows[0]));
  await assert.rejects(() => f.ap("ap_quality", "overview", {}, i.sales), denied);
  assert.equal((await f.ap("ap_quality", "overview", {}, i.foreign)).types.length, 0);
  await assert.rejects(() => f.ap("ap_quality", "compare", { id: saved.id }, i.foreign), /not found/);
});

// ---------------------------------------------------------------- AP-039
test("AP-039 known state names are stored with their GST spelling; codes and unknown text stay as entered; vendor PIN format is checked", async () => {
  const id = f.next();
  await f.raw("insert into customers(id,company_id,customer_name,customer_type,state,gst_registration) values($1,$2,'PIN test','dealer','  maharashtra ','unregistered')", [id, i.company]);
  assert.equal((await f.one("select state from customers where id=$1", [id])).state, "Maharashtra");
  for (const [typed, stored] of [["Orissa", "Odisha"], ["NCT of Delhi", "Delhi"], ["27", "27"], ["Nowhere Pradesh", "Nowhere Pradesh"], ["tamil nadu", "Tamil Nadu"]]) {
    await f.raw("update customers set state=$2 where id=$1", [id, typed]);
    assert.equal((await f.one("select state from customers where id=$1", [id])).state, stored, typed);
  }
  await f.raw("update vendors set state='gujarat', pincode='380001' where id=$1", [i.vendor]);
  assert.deepEqual(await f.one("select state, pincode from vendors where id=$1", [i.vendor]), { state: "Gujarat", pincode: "380001" });
  await assert.rejects(() => f.raw("update vendors set pincode='012345' where id=$1", [i.vendor]), /vendors_pincode_format/);
});

// ---------------------------------------------------------------- AP-040
test("AP-040 the length as said is kept on the quotation line and shown in the authorised projection; control characters are refused", async () => {
  const { item, quote } = await f.draftQuote({ rate: 245 });
  await f.raw("update quote_items set length_input_text='21 ft' where id=$1", [item]);
  const seen = await f.asUser("select length_input_text, length_per_piece_m from quote_items_authorized where quote_id=$1", [quote], i.sales);
  assert.equal(seen[0].length_input_text, "21 ft");
  await assert.rejects(() => f.raw("update quote_items set length_input_text=$2 where id=$1", [item, "21\u0007ft"]), /length_input_text/);
  await assert.rejects(() => f.raw("update quote_items set length_input_text=$2 where id=$1", [item, "x".repeat(41)]), /length_input_text/);
});

// ---------------------------------------------------------------- AP-057
test("AP-057 every PO line gets a price check from issued POs only; a high price needs a reason before the PO is issued", async () => {
  await f.purchaseOrder({ vendor: i.transporter, lines: [{ description: "Stretch film 23 micron", unit: "kg", rate: 100 }], daysAgo: 20 });
  await f.purchaseOrder({ vendor: i.vendor, lines: [{ description: "Stretch  film 23-micron", unit: "kg", rate: 104 }], daysAgo: 10 });
  await f.purchaseOrder({ vendor: i.vendor, lines: [{ description: "Stretch film 23 micron", unit: "kg", rate: 50 }], issue: false }); // a draft is not price history
  await f.purchaseOrder({ vendor: i.vendor, lines: [{ description: "Stretch film 23 micron", unit: "box", rate: 900 }] }); // another unit is another item
  const h = await f.ap("ap_price", "history", { description: "stretch film 23 micron", unit: "kg", vendor_id: i.transporter, rate: 112 }, i.inventory);
  assert.deepEqual(h.last.map(x => Number(x.rate)), [104, 100], "newest first; the draft and the box line are left out");
  assert.equal(Number(h.same_supplier.rate), 100);
  assert.equal(Number(h.reference_rate), 104);
  assert.equal(Number(h.variance_percent), 7.69); assert.equal(h.flagged, true, "above the default 5%");
  const po = await f.purchaseOrder({ vendor: i.transporter, lines: [{ description: "Stretch film 23 micron", unit: "kg", rate: 112 }, { description: "Interleaving paper", unit: "kg", rate: 40 }], issue: false });
  const checks = await f.ap("ap_price", "order_checks", { purchase_order_id: po }, i.accounts);
  assert.deepEqual(checks.lines.map(l => [l.line_number, l.flagged, l.reference_rate === null ? null : Number(l.reference_rate)]), [[1, true, 104], [2, false, null]]);
  await assert.rejects(() => f.ap("purchase_lifecycle_command", "order.issue", { purchase_order_id: po }, i.accounts), /reason for the price on line 1/);
  await assert.rejects(() => f.ap("ap_price", "justify", { line_id: checks.lines[1].purchase_order_line_id, reason: "Not flagged so no reason needed" }, i.accounts), /needs no reason/);
  await assert.rejects(() => f.ap("ap_price", "justify", { line_id: checks.lines[0].purchase_order_line_id, reason: "Metal rate moved up" }, i.inventory), denied);
  await f.ap("ap_price", "justify", { line_id: checks.lines[0].purchase_order_line_id, reason: "LME rose 7% since the last order" }, i.accounts);
  assert.equal((await f.ap("purchase_lifecycle_command", "order.issue", { purchase_order_id: po }, i.accounts)).status, "open");
  await assert.rejects(() => f.ap("ap_price", "justify", { line_id: checks.lines[0].purchase_order_line_id, reason: "Changing the reason after issue" }, i.accounts), /already issued/);
  // A reason given at creation is recorded on the flagged line in the same call.
  const po2 = await f.purchaseOrder({ vendor: i.vendor, lines: [{ description: "Stretch film 23 micron", unit: "kg", rate: 130 }], reasons: [{ line_number: 1, reason: "Urgent half-load at a spot price" }], issue: true });
  const c2 = await f.ap("ap_price", "order_checks", { purchase_order_id: po2 }, i.factory);
  assert.equal(c2.lines[0].reason, "Urgent half-load at a spot price");
  const flagged = await f.ap("ap_price", "flagged", {}, i.accounts);
  assert.ok(flagged.rows.length >= 2 && flagged.rows.every(r => r.reason));
  assert.equal(flagged.issued_without_reason, 0);
});

test("AP-057 the threshold is owner/admin only and applies to new lines; price checks are hidden from sales and viewers; another company sees none", async () => {
  await f.purchaseOrder({ lines: [{ description: "Powder coating RAL 9016", unit: "kg", rate: 300 }], daysAgo: 5 });
  await assert.rejects(() => f.ap("ap_price", "save_settings", { variance_percent: 10 }, i.accounts), denied);
  await assert.rejects(() => f.ap("ap_price", "save_settings", { variance_percent: 0 }), /between 0.1% and 100%/);
  await f.ap("ap_price", "save_settings", { variance_percent: 10 });
  const po = await f.purchaseOrder({ lines: [{ description: "Powder coating RAL 9016", unit: "kg", rate: 327 }], issue: false });
  const [line] = (await f.ap("ap_price", "order_checks", { purchase_order_id: po })).lines;
  assert.equal(Number(line.variance_percent), 9); assert.equal(line.flagged, false); assert.equal(Number(line.threshold_percent), 10);
  for (const actor of [i.sales, i.viewer, i.production]) await assert.rejects(() => f.ap("ap_price", "history", { description: "Powder coating RAL 9016", unit: "kg" }, actor), denied);
  // Batch 7 tables are read only through the gateways (no direct table grant); row security is the second layer.
  for (const actor of [i.viewer, i.accounts]) await assert.rejects(() => f.asUser("select count(*)::int n from purchase_line_price_checks", [], actor), /permission denied/);
  assert.equal((await f.ap("ap_price", "order_checks", { purchase_order_id: po }, i.foreign)).lines.length, 0);
  await assert.rejects(() => f.asUser("insert into purchase_line_price_checks(company_id,purchase_order_id,purchase_order_line_id,line_number,item_key,unit_rate,history,threshold_percent,flagged) values($1,$2,$2,1,'x',1,'{}',5,false)", [i.company, po], i.accounts), /permission denied/);
});

// ---------------------------------------------------------------- AP-064
test("AP-064 a red line drafts one notice in customer wording; a new estimate supersedes it; sending needs a date and a channel", async () => {
  const o = await f.redLine({ estimate: 6, blocker: "finishing lead time missing" });
  const first = await f.ap("ap_delay", "prepare", {}, i.salesManager);
  assert.equal(first.prepared, 1);
  assert.equal((await f.ap("ap_delay", "prepare", {}, i.salesManager)).prepared, 0, "the same lines and dates are not drafted twice");
  const [n] = (await f.ap("ap_delay", "order", { order_id: o.order }, i.sales)).notices;
  assert.equal(n.status, "prepared");
  assert.match(n.message, /now expected/);
  assert.ok(!/lead time missing|finishing lead|blocker/i.test(n.message), "internal blockers never reach the customer");
  assert.match(n.message, /being scheduled/);
  assert.match(n.message, /(600 kg)/, "weights print without trailing zeros");
  assert.equal(n.new_date, istDay(6));
  await f.redLine({ order: o, estimate: 9, blocker: "planned production" });
  assert.equal((await f.ap("ap_delay", "prepare", {}, i.owner)).prepared, 1);
  const all = (await f.ap("ap_delay", "order", { order_id: o.order })).notices;
  assert.deepEqual(all.map(x => x.status), ["prepared", "superseded"]);
  const current = all[0];
  assert.equal(current.new_date, istDay(9));
  await assert.rejects(() => f.ap("ap_delay", "send", { id: current.id, via: "fax" }, i.sales), /Choose how/);
  await assert.rejects(() => f.ap("ap_delay", "send", { id: current.id, via: "whatsapp" }, i.factory), denied);
  const edited = await f.ap("ap_delay", "edit", { id: current.id, message: "Dear Mr Sharma,\nYour order is now expected on the date below.\nRegards" }, i.sales);
  assert.match(edited.message, /\n/);
  await assert.rejects(() => f.ap("ap_delay", "edit", { id: current.id, message: "Dear Sir \u0007 bad control text here" }, i.sales), /control characters/);
  assert.equal((await f.ap("ap_delay", "copy", { id: current.id }, i.sales)).status, "prepared", "copying is not sending");
  const sent = await f.ap("ap_delay", "send", { id: current.id, via: "whatsapp" }, i.sales);
  assert.equal(sent.status, "sent"); assert.equal(sent.sent_via, "whatsapp");
  assert.equal((await f.ap("ap_delay", "send", { id: current.id, via: "whatsapp" }, i.sales)).repeated, true);
  await assert.rejects(() => f.ap("ap_delay", "skip", { id: current.id, reason: "Told on the phone" }, i.sales), /Only a prepared notice/);
  const cov = await f.ap("ap_delay", "coverage", {}, i.dispatchManager);
  assert.ok(cov.red_lines >= 1 && cov.sent >= 1);
  assert.equal(cov.without_communication, cov.red_lines - cov.sent - cov.skipped, "a drafted but unsent notice is not a communication");
});

test("AP-064 an unknown estimate needs a date before sending; skipping needs a reason; recovered lines withdraw drafts; other companies see nothing", async () => {
  const o = await f.redLine({ estimate: null, blocker: "quantity missing" });
  await f.ap("ap_delay", "prepare", {}, i.owner);
  const [n] = (await f.ap("ap_delay", "order", { order_id: o.order })).notices;
  assert.equal(n.needs_date, true);
  assert.match(n.message, /a date we will confirm shortly/);
  await assert.rejects(() => f.ap("ap_delay", "send", { id: n.id, via: "email" }, i.sales), /new expected date/);
  await assert.rejects(() => f.ap("ap_delay", "edit", { id: n.id, message: n.message, new_date: istDay(-1) }, i.sales), /past/);
  await f.ap("ap_delay", "edit", { id: n.id, message: n.message.replace("a date we will confirm shortly", "the 28th"), new_date: istDay(5) }, i.sales);
  assert.equal((await f.ap("ap_delay", "send", { id: n.id, via: "email" }, i.sales)).status, "sent");
  const o2 = await f.redLine({ estimate: 4 });
  await f.ap("ap_delay", "prepare", {}, i.owner);
  const [m] = (await f.ap("ap_delay", "order", { order_id: o2.order })).notices;
  await assert.rejects(() => f.ap("ap_delay", "skip", { id: m.id, reason: "no" }, i.sales), /Reason/);
  assert.equal((await f.ap("ap_delay", "list", { status: "all" }, i.foreign)).total_count, 0);
  await assert.rejects(() => f.ap("ap_delay", "get", { id: m.id }, i.foreign), /not found/);
  await assert.rejects(() => f.ap("ap_delay", "list", {}, i.accounts), denied);
  await f.seed("update order_line_predictions set is_red=false where order_id=$1", [o2.order]);
  assert.equal((await f.ap("ap_delay", "prepare", {}, i.owner)).withdrawn, 1);
  assert.equal((await f.ap("ap_delay", "get", { id: m.id })).status, "superseded");
});

// ---------------------------------------------------------------- AP-079
test("AP-079 a statement shows only that customer's invoices, receipts and credit notes; the balance follows the invoice rule", async () => {
  const { start, end, period } = lastMonthRange();
  // A receipt dated inside last month against the oldest invoice, and today's receipt after the period.
  const r1 = await f.receipt(i.inv1, 4000);
  await f.seed("update payments set payment_date=$2 where id=(select id from payments where invoice_id=$1 order by created_at desc limit 1)", [i.inv1, end]);
  await f.receipt(i.inv2, 1000);
  assert.ok(r1);
  const prepared = await f.ap("ap_statement", "prepare", { period }, i.accounts);
  assert.ok(prepared.prepared >= 1);
  const queue = await f.ap("ap_statement", "queue", { period, status: "all" }, i.accounts);
  const row = queue.rows.find(x => x.customer_id === i.customer2);
  const s = await f.ap("ap_statement", "get", { id: row.id }, i.accounts);
  const invoices = (await f.db.query("select invoice_number, invoice_date::text d, grand_total::numeric g from invoices where customer_id=$1 and company_id=$2 and status not in ('draft','cancelled')", [i.customer2, i.company])).rows;
  const before = invoices.filter(x => x.d < start).reduce((n, x) => n + Number(x.g), 0);
  const during = invoices.filter(x => x.d >= start && x.d <= end).reduce((n, x) => n + Number(x.g), 0);
  assert.equal(Number(s.opening_balance), before, "no receipt is dated before the month");
  assert.equal(Number(s.invoiced), during);
  assert.equal(Number(s.received), 4000, "only the receipt dated in the month; today's is after the period");
  assert.equal(Number(s.closing_balance), Number(s.opening_balance) + during - 4000);
  const own = new Set(invoices.map(x => x.invoice_number));
  for (const line of s.lines) assert.ok([...own].some(n => line.reference.includes(n)), `line ${line.reference} belongs to this customer`);
  assert.ok(!JSON.stringify(s).includes("INV-NOV3-01"), "another customer's invoice never appears");
  assert.match(s.message, /Closing balance: Rs /);
  assert.ok(!/margin|cost|internal/i.test(s.message));
  // As at today, the statement closing equals the invoices' recorded balances.
  const today = await f.one("select (private.ap7_statement($1,$2,date_trunc('month',current_date)::date,(now() at time zone 'Asia/Kolkata')::date)->>'closing_balance')::numeric c", [i.company, i.customer2]);
  const balances = await f.one("select sum(balance_due)::numeric b from invoices where customer_id=$1 and company_id=$2 and status not in ('draft','cancelled')", [i.customer2, i.company]);
  assert.equal(Number(today.c), Number(balances.b));
  assert.equal((await f.ap("ap_statement", "prepare", { period }, i.accounts)).prepared, 0, "one statement per customer per month");
  await assert.rejects(() => f.ap("ap_statement", "prepare", { period: istDay(0).slice(0, 7) }, i.accounts), /month that has ended/);
});

test("AP-079 sending is recorded per channel; provider sends need a reference; rebuild replaces one unsent statement; roles and companies are enforced", async () => {
  const { period } = lastMonthRange();
  await f.ap("ap_statement", "prepare", { period }, i.accounts);
  const rows = (await f.ap("ap_statement", "queue", { period }, i.accounts)).rows;
  const s = rows.find(x => x.customer_id === i.customer2);
  await assert.rejects(() => f.ap("ap_statement", "send", { id: s.id, via: "email_provider" }, i.accounts), /Choose how/, "the generic send cannot claim a provider send");
  await assert.rejects(() => f.ap("ap_statement", "send_provider", { id: s.id, provider_ref: "" }, i.accounts), /Provider reference/);
  const copied = await f.ap("ap_statement", "copy", { id: s.id }, i.accounts);
  assert.equal(copied.status, "prepared");
  const rebuilt = await f.ap("ap_statement", "rebuild", { id: s.id }, i.accounts);
  assert.equal(rebuilt.prepared, 1, "only this customer is rebuilt");
  assert.notEqual(rebuilt.id, s.id);
  assert.equal((await f.ap("ap_statement", "get", { id: s.id })).status, "superseded");
  const sent = await f.ap("ap_statement", "send_provider", { id: rebuilt.id, provider_ref: "resend:abc123" }, i.accounts);
  assert.deepEqual([sent.status, sent.sent_via, sent.provider_ref], ["sent", "email_provider", "resend:abc123"]);
  await assert.rejects(() => f.ap("ap_statement", "skip", { id: rebuilt.id, reason: "Already sent anyway" }, i.accounts), /Only a prepared statement/);
  const cov = await f.ap("ap_statement", "coverage", { period }, i.accounts);
  assert.ok(cov.with_balance >= 1 && cov.sent >= 1);
  for (const actor of [i.sales, i.salesManager, i.viewer]) await assert.rejects(() => f.ap("ap_statement", "queue", {}, actor), denied);
  assert.equal((await f.ap("ap_statement", "queue", { status: "all" }, i.foreign)).total_count, 0);
  await assert.rejects(() => f.ap("ap_statement", "get", { id: rebuilt.id }, i.foreign), /not found/);
  await assert.rejects(() => f.asUser("select count(*)::int n from customer_statements", [], i.sales), /permission denied/);
});

test("AP-079 the morning job prepares last month's statements from the first working day, once", async () => {
  const run1 = await f.one("select private.ap7_statement_job($1, null) r", [i.company]);
  const first = await f.one("select private.ap7_first_working_day($1, (now() at time zone 'Asia/Kolkata')::date) d", [i.company]);
  if (istDay(0) >= first.d.toISOString().slice(0, 10)) {
    assert.ok(run1.r.proposals >= 1, JSON.stringify(run1.r));
    const run2 = await f.one("select private.ap7_statement_job($1, null) r", [i.company]);
    assert.equal(run2.r.proposals, 0);
  } else assert.ok(run1.r.details.waiting_for);
  const registry = (await f.db.query("select job_key, schedule from private.ap_job_registry() where job_key='receivables.statements'")).rows;
  assert.deepEqual(registry, [{ job_key: "receivables.statements", schedule: "morning" }]);
});

// ---------------------------------------------------------------- grants
test("batch 7 tables have row security and no client writes; gateways are callable only by signed-in users", async () => {
  const tables = ["automation_rule_changes", "purchase_price_settings", "purchase_line_price_checks", "order_delay_notices", "customer_statements"];
  const rls = (await f.db.query("select relname, relrowsecurity from pg_class where relname = any($1) and relnamespace='public'::regnamespace", [tables])).rows;
  assert.equal(rls.length, tables.length); assert.ok(rls.every(r => r.relrowsecurity));
  const grants = (await f.db.query("select table_name, privilege_type from information_schema.role_table_grants where table_name = any($1) and grantee in ('anon','authenticated') and privilege_type <> 'SELECT'", [tables])).rows;
  assert.deepEqual(grants, []);
  for (const fn of ["ap_quality", "ap_price", "ap_delay", "ap_statement", "purchase_lifecycle_command"]) {
    const g = await f.one("select has_function_privilege('anon', $1, 'execute') anon, has_function_privilege('authenticated', $1, 'execute') auth", [`public.${fn}(text,jsonb)`]);
    assert.deepEqual(g, { anon: false, auth: true }, fn);
  }
  const hidden = await f.one("select has_function_privilege('authenticated', 'private.ap7_purchase_lifecycle_v1(text,jsonb)', 'execute') a, has_function_privilege('authenticated', 'private.ap7_statement(uuid,uuid,date,date)', 'execute') b");
  assert.deepEqual(hidden, { a: false, b: false });
  await assert.rejects(() => f.asUser("select public.ap_statement('queue','{}'::jsonb)", [], i.dealer), denied);
});

test("AP-064 and AP-079 wiring: the nightly prediction drafts notices in the same run; a prepared statement prints as a PDF", async () => {
  const { buildStatementPdf } = await import("../lib/pdf/statement-pdf.ts");
  const out = await f.one("select private.ap5_predict_lines($1) r", [i.company]);
  assert.ok("delay_notices" in out.r.details, JSON.stringify(out.r));
  const { period } = lastMonthRange();
  await f.ap("ap_statement", "prepare", { period }, i.accounts);
  const row = (await f.ap("ap_statement", "queue", { period }, i.accounts)).rows.find(x => x.customer_id === i.customer2);
  const s = await f.ap("ap_statement", "get", { id: row.id }, i.accounts);
  const bytes = await buildStatementPdf({ company: { name: s.company.name, legal_name: s.company.legal_name, gst_number: s.company.gst_number, address: s.company.address },
    customer: s.customer_details, period_start: s.period_start, period_end: s.period_end, opening_balance: Number(s.opening_balance), invoiced: Number(s.invoiced),
    received: Number(s.received), credited: Number(s.credited), closing_balance: Number(s.closing_balance), on_account: Number(s.on_account),
    lines: s.lines.map(l => ({ ...l, debit: Number(l.debit), credit: Number(l.credit), balance: Number(l.balance) })),
    open_invoices: s.open_invoices.map(x => ({ ...x, total: Number(x.total), balance: Number(x.balance) })) });
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-");
  assert.ok(bytes.length > 1500);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createBatch6Fixture, ids as i, istDay } from "../scripts/lib/autopilot-batch6-fixture.mjs";
import { sectionWeightDrift } from "../lib/calculations/section-weight.ts";
import { suggestReorder } from "../lib/calculations/reorder-point.ts";

let f;
test.before(async () => { f = await createBatch6Fixture(); });
test.after(async () => { await f?.close(); });
test.beforeEach(async () => { await f.start(); });
test.afterEach(async () => { await f.rollback(); });
const proposals = async (type, actor = i.owner) => (await f.call("ap_proposals", "list", { type }, actor)).rows;
const decide = (id, decision, payload, actor = i.owner) => f.call("ap_proposals", "decide", { id, decision, ...(payload ? { payload } : {}) }, actor);

// ---------------------------------------------------------------- AP-027
test("AP-027 heavy bundles beyond the profile tolerance propose a decision once; the SQL drift matches the library", async () => {
  await f.seed("update aluminium_profiles set weight_tolerance_percent=2 where id=$1", [i.profile2]);
  await f.dieJob({ kgms: [1.0, 1.0, 1.01, 0.99] });
  const d = await f.ap("ap_weight", "die", { die_id: i.die }, i.productionManager);
  assert.equal(d.state, "heavy");
  assert.equal(Number(d.actual_kgm), 1);
  assert.equal(d.tolerance_source, "profile");
  const lib = sectionWeightDrift({ newestFirst: d.points.slice().reverse().map(p => ({ gross_weight_kg: Number(p.net_kg) + 6, tare_weight_kg: 6, net_length_m: Number(p.net_length_m) })), theoreticalKgPerM: 0.95, tolerancePercent: 2 });
  assert.equal(lib.state, "heavy"); assert.equal(lib.drift, Number(d.drift_percent));
  assert.equal((await f.ap("ap_weight", "prepare", {}, i.quality)).proposals, 1);
  assert.equal((await f.ap("ap_weight", "prepare", {}, i.quality)).proposals, 0, "an open proposal is not repeated");
  const [p] = await proposals("die.weight_drift", i.quality);
  assert.equal(p.payload.direction, "heavy");
  const r = await decide(p.id, "edit", { route: "update_master" }, i.quality);
  assert.equal(r.state, "edited");
  const task = await f.one("select assigned_to, related_entity_type from tasks where id=$1", [r.outcome.task_id]);
  assert.equal(task.assigned_to, i.quality); assert.equal(task.related_entity_type, "profile");
  assert.equal((await f.one("select section_weight_kg_per_m v from aluminium_profiles where id=$1", [i.profile2])).v, "0.950", "the master weight is never changed by the proposal");
  assert.equal((await f.ap("ap_weight", "prepare", {}, i.quality)).proposals, 0, "an accepted decision with an open task suppresses a new proposal");
});

test("AP-027 missing master weight, too few bundles and an unset tolerance never raise a proposal; a new bundle stales the proposal", async () => {
  const j = await f.dieJob({ kgms: [1.0, 1.0] });
  assert.equal((await f.ap("ap_weight", "die", { die_id: i.die })).state, "insufficient");
  await f.bundle({ order: j.order, job: j.job, kgm: 1.0 });
  assert.equal((await f.ap("ap_weight", "die", { die_id: i.die })).state, "no_tolerance");
  assert.equal((await f.ap("ap_weight", "prepare", {}, i.quality)).proposals, 0);
  await f.ap("ap_weight", "save_settings", { tolerance_percent: 3, window_bundles: 10, min_bundles: 3 }, i.quality);
  assert.equal((await f.ap("ap_weight", "die", { die_id: i.die })).tolerance_source, "factory");
  assert.equal((await f.ap("ap_weight", "prepare", {}, i.quality)).proposals, 1);
  const [p] = await proposals("die.weight_drift");
  await f.bundle({ order: j.order, job: j.job, kgm: 0.95 });
  assert.equal((await decide(p.id, "accept")).state, "stale");
  // The schema already requires a profile on every die and a positive master kg/m; the missing-master state is unit-tested.
  await assert.rejects(() => f.ap("ap_weight", "save_settings", { tolerance_percent: 3, window_bundles: 10, min_bundles: 3 }, i.sales), e => e.code === "42501");
  await assert.rejects(() => f.ap("ap_weight", "die", { die_id: i.die }, i.foreign), /not found/);
  const list = await f.ap("ap_weight", "list", { show: "all" }, i.salesManager);
  assert.ok(list.rows.some(r => r.die_id === i.die));
});

// ---------------------------------------------------------------- AP-030
test("AP-030 drafts reprice in one owner action from the canonical triggers; sent quotations are only listed", async () => {
  const d = await f.draftQuote({ rate: 230 });
  const before = await f.one("select grand_total from quotes where id=$1", [d.quote]);
  const sent = await f.sentQuote({ boundRate: 230 });
  const impact = await f.ap("ap_reprice", "impact", {}, i.sales);
  const row = impact.drafts.find(x => x.quote_id === d.quote);
  assert.equal(Number(row.lines[0].old_rate), 230); assert.equal(Number(row.lines[0].new_rate), 245);
  assert.ok(Number(row.new_grand_total) > Number(before.grand_total));
  assert.equal(Number(row.old_grand_total), Number(before.grand_total));
  assert.equal((await f.one("select billet_rate_per_kg r from quote_items where id=$1", [d.item])).r, "230.00", "reading the impact list changes nothing");
  const s = impact.sent.find(x => x.quote_id === sent);
  assert.equal(Number(s.sent_rate), 230); assert.equal(Number(s.today_rate), 245);
  await assert.rejects(() => f.ap("ap_reprice", "apply", { fingerprint: impact.fingerprint }, i.salesManager), e => e.code === "42501");
  const applied = await f.ap("ap_reprice", "apply", { fingerprint: impact.fingerprint, exclude_quote_ids: [sent] }, i.owner);
  assert.equal(applied.state, "applied");
  assert.ok(applied.quotes >= 1);
  const after = await f.one("select grand_total from quotes where id=$1", [d.quote]);
  assert.equal(Number(after.grand_total), Number(row.new_grand_total), "trial and applied totals agree");
  assert.equal((await f.one("select billet_rate_per_kg r from quote_items where quote_id=$1", [sent])).r, "230.00", "a sent quotation keeps its price");
  const run = await f.ap("ap_reprice", "run", { id: applied.run_id }, i.accounts);
  assert.ok(run.lines.some(l => l.quote_id === d.quote && Number(l.new_rate) === 245));
  assert.equal((await f.ap("ap_reprice", "apply", { fingerprint: impact.fingerprint }, i.owner)).state, "stale", "a second apply with the old list is refused");
});

test("AP-030 excluded drafts stay unchanged, drafts without an approved rate are reported, and the overnight proposal applies", async () => {
  const a = await f.draftQuote({ rate: 230 }); const b = await f.draftQuote({ rate: 231 });
  const impact = await f.ap("ap_reprice", "impact", {}, i.owner);
  const r = await f.ap("ap_reprice", "apply", { fingerprint: impact.fingerprint, exclude_quote_ids: [b.quote] }, i.owner);
  assert.equal(r.state, "applied");
  assert.equal((await f.one("select billet_rate_per_kg r from quote_items where id=$1", [a.item])).r, "245.00");
  assert.equal((await f.one("select billet_rate_per_kg r from quote_items where id=$1", [b.item])).r, "231.00");
  const job = [await f.one("select private.ap6_reprice_job($1,null) data", [i.company])];
  assert.equal(job[0].data.proposals, 1);
  const [p] = await proposals("quote.reprice");
  assert.equal((await decide(p.id, "accept", null, i.owner)).state, "accepted");
  assert.equal((await f.one("select billet_rate_per_kg r from quote_items where id=$1", [b.item])).r, "245.00");
  await f.seed("update costing_rates set status='withdrawn' where id=$1", [i.rateBillet]);
  const none = await f.draftQuote({ rate: 200 });
  const v = await f.ap("ap_reprice", "impact", {});
  assert.equal(v.drafts.find(x => x.quote_id === none.quote).lines_without_rate, 1);
  assert.equal(v.line_count, 0);
});

// ---------------------------------------------------------------- AP-100
test("AP-100 a failed job run shows on the health page at once; never-run jobs are listed; other roles are refused", async () => {
  await f.seed(`insert into system_job_runs(company_id,job_key,window_key,trigger_source,status,started_at,finished_at,examined,proposals_created,alerts_created,error_message)
    values($1,'quotes.expire','day:20261114','cron','failed',now(),now(),0,0,0,'synthetic failure')`, [i.company]);
  const h = await f.ap("ap_health", "overview", {}, i.owner);
  const job = h.jobs.find(j => j.job_key === "quotes.expire");
  assert.equal(job.state, "failed"); assert.equal(job.last_error, "synthetic failure");
  assert.ok(h.summary.failed_jobs >= 1);
  assert.ok(h.jobs.some(j => j.job_key === "press.plan_draft" && j.state === "never_run"));
  assert.equal(h.errors.failed_job_runs_today, 1);
  assert.equal(h.backups.available, false);
  assert.equal(h.scheduler, null, "the local replay has no pg_cron history");
  await assert.rejects(() => f.ap("ap_health", "overview", {}, i.accounts), e => e.code === "42501");
});

// ---------------------------------------------------------------- AP-033
test("AP-033 suggestions need a lead time, match the library, require a reason when changed and act only after approval", async () => {
  const item = await f.consumable({ stock: 100 });
  let row = (await f.ap("ap_reorder", "suggestions", { show: "all", search: "Traceable" }, i.inventory)).rows.find(r => r.id === item);
  assert.equal(row.state, "lead_time_missing"); assert.equal(row.suggested_min, null);
  row = (await f.ap("ap_reorder", "save_lead", { source: "inventory_items", id: item, lead_days: 10 }, i.inventory)).row;
  const lib = suggestReorder({ consumed: 90, windowDays: 90, leadDays: 10 });
  assert.equal(Number(row.suggested_min), lib.min); assert.equal(Number(row.suggested_qty), lib.qty);
  assert.equal(lib.min, 15);
  assert.equal((await f.ap("ap_reorder", "prepare", {}, i.inventory)).proposals, 0, "suggestions alone never raise a requisition");
  await assert.rejects(() => f.ap("ap_reorder", "approve", { source: "inventory_items", id: item, min_level: 20, reorder_qty: 30 }, i.inventory), /differ from the suggestion/);
  await assert.rejects(() => f.ap("ap_reorder", "approve", { source: "inventory_items", id: item, min_level: 15, reorder_qty: 30 }, i.production), e => e.code === "42501");
  await f.ap("ap_reorder", "approve", { source: "inventory_items", id: item, min_level: 15, reorder_qty: 30 }, i.inventory);
  assert.equal((await f.one("select reorder_level from inventory_items where id=$1", [item])).reorder_level, "15.000");
  await f.seed("update inventory_items set current_stock=12 where id=$1", [item]);
  assert.equal((await f.ap("ap_reorder", "prepare", {}, i.inventory)).proposals, 1);
  const [p] = await proposals("stock.reorder", i.inventory);
  const r = await decide(p.id, "edit", { quantity: 40 }, i.inventory);
  assert.equal(r.state, "edited");
  const req = await f.one("select quantity, status, task_id from purchase_requisitions where id=$1", [r.outcome.requisition_id]);
  assert.equal(req.quantity, "40.000"); assert.equal(req.status, "open"); assert.ok(req.task_id);
  assert.equal((await f.ap("ap_reorder", "prepare", {}, i.inventory)).proposals, 0, "an open requisition is not raised twice");
  await assert.rejects(() => f.ap("ap_reorder", "update_requisition", { id: r.outcome.requisition_id, status: "ordered" }, i.inventory), /reference is required/);
  assert.equal((await f.ap("ap_reorder", "update_requisition", { id: r.outcome.requisition_id, status: "ordered", reference: "PO-1001" }, i.inventory)).status, "ordered");
  assert.equal((await f.one("select status from tasks where id=$1", [req.task_id])).status, "completed");
});

test("AP-033 short history and no consumption stay blank; stock and the master quantity are untouched", async () => {
  const fresh = await f.consumable({ stock: 50, issues: [[2, 5]], ageDays: 5 });
  const idle = await f.consumable({ stock: 50, issues: [] });
  const rows = (await f.ap("ap_reorder", "suggestions", { show: "all", page: 1 }, i.inventory)).rows;
  assert.equal(rows.find(r => r.id === fresh).state, "insufficient_history");
  assert.equal(rows.find(r => r.id === idle).state, "not_consumed");
  await assert.rejects(() => f.ap("ap_reorder", "approve", { source: "inventory_items", id: idle, min_level: 5, reorder_qty: 10 }, i.inventory), /no calculated suggestion/);
  await f.ap("ap_reorder", "approve", { source: "inventory_items", id: idle, min_level: 5, reorder_qty: 10, reason: "Safety spare kept on the shelf" }, i.inventory);
  assert.equal((await f.one("select current_stock from inventory_items where id=$1", [idle])).current_stock, "50.000");
  const foreign = await f.ap("ap_reorder", "suggestions", { show: "all" }, i.foreign);
  assert.equal(foreign.rows.some(r => r.id === idle || r.id === fresh), false, "another company sees none of these items");
  await assert.rejects(() => f.ap("ap_reorder", "suggestions", {}, i.sales), e => e.code === "42501");
});

// ---------------------------------------------------------------- AP-053
test("AP-053 rejections above the QC threshold draft one NCR with evidence; dismissal needs a reason; closing needs cause and action", async () => {
  const j = await f.dieJob({ rejected: 20, actual: 180 });
  assert.equal((await f.ap("ap_ncr", "detect", {}, i.quality)).proposals, 0, "no thresholds, no drafts");
  await assert.rejects(() => f.ap("ap_ncr", "save_settings", { job_reject_percent: 5 }, i.productionManager), e => e.code === "42501");
  await f.ap("ap_ncr", "save_settings", { job_reject_percent: 5 }, i.quality);
  assert.equal((await f.ap("ap_ncr", "detect", {}, i.quality)).proposals, 1);
  assert.equal((await f.ap("ap_ncr", "detect", {}, i.quality)).proposals, 0);
  const n = (await f.ap("ap_ncr", "list", {}, i.quality)).rows.find(r => r.production_job_id === j.job);
  assert.equal(n.status, "draft"); assert.equal(Number(n.reject_percent), 10); assert.equal(n.die_number, "D-2045-A");
  assert.ok(Array.isArray(n.evidence.inspections));
  await assert.rejects(() => f.ap("ap_ncr", "dismiss", { id: n.id, reason: "short" }, i.quality), /Reason must be/);
  await f.ap("ap_ncr", "confirm", { id: n.id }, i.quality);
  await assert.rejects(() => f.ap("ap_ncr", "close", { id: n.id }, i.quality), /cause and the corrective action/);
  await f.ap("ap_ncr", "update", { id: n.id, cause: "Die bearing wear on port 2", action: "Die sent for correction; first-piece check" }, i.quality);
  assert.equal((await f.ap("ap_ncr", "close", { id: n.id }, i.quality)).status, "closed");
  await assert.rejects(() => f.ap("ap_ncr", "confirm", { id: n.id }, i.sales), e => e.code === "42501");
  const cov = await f.ap("ap_ncr", "coverage", {}, i.quality);
  assert.equal(cov.jobs_above, 1); assert.equal(cov.jobs_covered, 1);
});

test("AP-053 receipt rejections and customer complaints draft NCRs; complaint retries are idempotent and customers are checked", async () => {
  await f.ap("ap_ncr", "save_settings", { receipt_reject_percent: 10 }, i.quality);
  const line = await f.rejectedReceipt({ received: 100, rejected: 20 });
  await f.rejectedReceipt({ received: 100, rejected: 5 });
  assert.equal((await f.ap("ap_ncr", "detect", {}, i.quality)).proposals, 1);
  assert.ok((await f.one("select count(*)::int n from quality_ncrs where purchase_receipt_line_id=$1", [line])).n === 1);
  const o = await f.order({ kg: 300, pieces: 50 });
  const req = f.next();
  const payload = { request_id: req, customer_id: i.customer2, order_id: o.order, description: "Customer reports scratches on 20 pieces of OM-2045" };
  const c = await f.ap("ap_ncr", "log_complaint", payload, i.sales);
  assert.equal((await f.ap("ap_ncr", "log_complaint", payload, i.sales)).repeated, true);
  await assert.rejects(() => f.ap("ap_ncr", "log_complaint", { ...payload, description: "Different text for the same identity" }, i.sales), /different details/);
  await assert.rejects(() => f.ap("ap_ncr", "log_complaint", { ...payload, request_id: f.next(), customer_id: i.customer3 }, i.sales), /not this customer/);
  const n = await f.ap("ap_ncr", "get", { id: c.ncr_id }, i.quality);
  assert.equal(n.source_kind, "complaint"); assert.equal(n.status, "draft"); assert.equal(n.customer_id, i.customer2);
  await assert.rejects(() => f.ap("ap_ncr", "get", { id: c.ncr_id }, i.sales), e => e.code === "42501");
});

// ---------------------------------------------------------------- AP-077
test("AP-077 TDS settles a part-paid invoice through the receipt writer, retries once, and reconciles with the statement", async () => {
  await assert.rejects(() => f.ap("ap_tds", "record", { request_id: f.next(), customer_id: i.customer2, deducted_on: istDay(0), lines: [{ invoice_id: i.inv1, amount: 10 }] }, i.accounts), /sections first/);
  await f.ap("ap_tds", "save_settings", { sections: ["194Q"], default_section: "194Q", default_rate_percent: 0.1, basis: "taxable", tolerance_inr: 1 }, i.accounts);
  await f.receipt(i.inv1, 9990);
  const likely = await f.ap("ap_tds", "likely", {}, i.accounts);
  assert.ok(likely.rows.some(r => r.invoice_id === i.inv1 && Number(r.expected_tds) === 10));
  const req = { request_id: f.next(), customer_id: i.customer2, deducted_on: istDay(0), section: "194Q", lines: [{ invoice_id: i.inv1, amount: 10 }] };
  await assert.rejects(() => f.ap("ap_tds", "record", { ...req, deducted_on: istDay(2) }, i.accounts), /future/);
  await assert.rejects(() => f.ap("ap_tds", "record", { ...req, lines: [{ invoice_id: i.inv1, amount: 10 }], customer_id: i.customer3 }, i.accounts), /not this customer/);
  const r = await f.ap("ap_tds", "record", req, i.accounts);
  assert.equal((await f.one("select balance_due from invoices where id=$1", [i.inv1])).balance_due, "0.00");
  assert.equal((await f.ap("ap_tds", "record", req, i.accounts)).repeated, true);
  assert.equal((await f.one("select count(*)::int n from tds_deductions where invoice_id=$1", [i.inv1])).n, 1);
  assert.equal((await f.ap("ap_tds", "likely", {}, i.accounts)).rows.some(x => x.invoice_id === i.inv1), false);
  let reg = (await f.ap("ap_tds", "register", {}, i.accounts)).rows.find(x => x.customer_id === i.customer2);
  assert.equal(reg.state, "not_in_statement");
  await f.ap("ap_tds", "save_customer_tax", { customer_id: i.customer2, tan: "PNEA12345B" }, i.accounts);
  const imp = await f.ap("ap_tds", "import_statement", { file_name: "26as.csv", file_sha256: "b".repeat(64), source_text: "TAN,...",
    rows: [{ row_number: 2, tan: "PNEA12345B", deductor_name: "Sharma Fabricators", section: "194Q", transaction_date: istDay(0), amount_credited: 10000, tds_amount: 10 },
      { row_number: 3, tan: "MUMA99999Z", deductor_name: "Someone else", section: "194Q", transaction_date: istDay(0), amount_credited: 5000, tds_amount: 5 }] }, i.accounts);
  assert.equal(imp.matched, 1); assert.equal(imp.unknown_tan, 1);
  reg = (await f.ap("ap_tds", "register", {}, i.accounts)).rows.find(x => x.customer_id === i.customer2);
  assert.equal(reg.state, "matched"); assert.equal(Number(reg.difference), 0);
  await f.seed("update payments set reversed_at=now() where id=(select payment_id from tds_deductions where invoice_id=$1)", [i.inv1]);
  reg = (await f.ap("ap_tds", "register", {}, i.accounts)).rows.find(x => x.customer_id === i.customer2);
  assert.equal(Number(reg.recorded), 0, "a reversed TDS receipt no longer counts"); assert.equal(reg.state, "not_recorded");
  await assert.rejects(() => f.ap("ap_tds", "import_statement", { file_name: "again.csv", file_sha256: "b".repeat(64), source_text: "x", rows: [{ tan: "PNEA12345B", transaction_date: istDay(0), tds_amount: 10 }] }, i.accounts), /already imported/);
  await assert.rejects(() => f.ap("ap_tds", "register", {}, i.sales), e => e.code === "42501");
  assert.ok(r.receipt_id);
});

// ---------------------------------------------------------------- AP-082
test("AP-082 export needs confirmed applicability; IRNs are recorded once per invoice and never cross invoices", async () => {
  await f.seed("update invoices set issued_at=now(), supplier_snapshot='{}'::jsonb, customer_snapshot='{}'::jsonb where id = any($1)", [[i.inv1, i.inv2]]);
  await assert.rejects(() => f.ap("ap_einvoice", "queue", {}, i.accounts), /not confirmed/);
  await assert.rejects(() => f.ap("ap_einvoice", "save_settings", { applicable: true, reason: "Turnover crossed five crore" }, i.accounts), /date/);
  await f.ap("ap_einvoice", "save_settings", { applicable: true, applicable_from: istDay(-90), reason: "Aggregate turnover above the notified limit" }, i.accounts);
  const q = await f.ap("ap_einvoice", "queue", {}, i.accounts);
  assert.ok(q.rows.some(r => r.id === i.inv1));
  const src = await f.ap("ap_einvoice", "sources", { invoice_ids: [i.inv1] }, i.accounts);
  assert.equal(src.invoices[0].invoice_number, "OMX/26-27/0101");
  await f.ap("ap_einvoice", "record_export", { schema_version: "1.1", file_sha256: "c".repeat(64), invoices: [{ invoice_id: i.inv1, doc_no: "OMX/26-27/0101" }] }, i.accounts);
  await assert.rejects(() => f.ap("ap_einvoice", "record_export", { schema_version: "1.1", file_sha256: "c".repeat(64), invoices: [{ invoice_id: i.inv1, doc_no: "OMX/26-27/9999" }] }, i.accounts), /no longer matches/);
  const row = { doc_no: "OMX/26-27/0101", irn: "a".repeat(64), ack_no: "112010012345678", ack_date: "2026-11-14T10:30:00+05:30", signed_qr: "eyJhbGciOiJSUzI1NiJ9.e30.sig-sig-sig-sig" };
  const first = await f.ap("ap_einvoice", "import_irn", { file_sha256: "d".repeat(64), rows: [row, { ...row, doc_no: "OMX/26-27/0102" }, { ...row, doc_no: "NOPE-1", irn: "e".repeat(64) }] }, i.accounts);
  assert.deepEqual(first.results.map(r => r.state), ["recorded", "conflict", "not_found"]);
  assert.equal((await f.ap("ap_einvoice", "import_irn", { file_sha256: "d".repeat(64), rows: [row] }, i.accounts)).results[0].state, "already_recorded");
  assert.equal((await f.ap("ap_einvoice", "irn", { invoice_id: i.inv1 }, i.accounts)).ack_no, "112010012345678");
  assert.equal((await f.ap("ap_einvoice", "queue", { show: "pending" }, i.accounts)).rows.some(r => r.id === i.inv1), false);
  await assert.rejects(() => f.ap("ap_einvoice", "queue", {}, i.sales), e => e.code === "42501");
  const visible = await f.asUser("select count(*)::int n from invoice_irns", [], i.salesManager);
  assert.equal(visible[0].n, 1, "the IRN is readable where the invoice prints");
  assert.equal((await f.asUser("select count(*)::int n from invoice_irns", [], i.foreign))[0].n, 0);
});

// ---------------------------------------------------------------- Shared contract
test("batch 6 tables have row security, one read policy and no client writes; gateways deny anonymous use", async () => {
  const tables = ["section_weight_settings", "quote_reprice_runs", "quote_reprice_lines", "reorder_policies", "purchase_requisitions", "ncr_settings", "customer_complaints", "quality_ncrs",
    "tds_settings", "customer_tax_profiles", "tds_deductions", "tds_statement_imports", "tds_statement_lines", "einvoice_settings", "einvoice_exports", "einvoice_export_items", "invoice_irns",
    "press_billet_settings", "job_billet_length_choices", "offline_receipts", "press_plan_drafts", "press_plan_draft_lines", "press_plan_unscheduled"];
  const rls = await f.db.query("select relname, relrowsecurity from pg_class where relname = any($1) and relnamespace='public'::regnamespace", [tables]);
  assert.equal(rls.rows.length, tables.length);
  assert.ok(rls.rows.every(r => r.relrowsecurity));
  const writes = await f.db.query("select table_name, privilege_type from information_schema.role_table_grants where grantee in ('authenticated','anon') and table_name = any($1) and privilege_type <> 'SELECT'", [tables]);
  assert.deepEqual(writes.rows, []);
  for (const fn of ["ap_weight", "ap_reprice", "ap_health", "ap_reorder", "ap_ncr", "ap_tds", "ap_einvoice", "ap_billet_length", "ap_offline", "ap_press_plan"]) {
    const g = await f.one("select has_function_privilege('anon', $1, 'execute') anon, has_function_privilege('authenticated', $1, 'execute') auth", [`public.${fn}(text,jsonb)`]);
    assert.equal(g.anon, false, fn); assert.equal(g.auth, true, fn);
  }
  const priv = await f.one("select has_function_privilege('authenticated', 'private.ap6_reprice_apply(uuid,uuid,text,uuid[],text,uuid)', 'execute') x");
  assert.equal(priv.x, false);
  const { JOBS } = await import("../lib/jobs/registry.ts");
  const jobs = (await f.db.query("select job_key, schedule, label from private.ap_job_registry() order by job_key")).rows;
  assert.deepEqual(jobs, [...JOBS].sort((a, b) => a.job_key.localeCompare(b.job_key)).map(({ job_key, schedule, label }) => ({ job_key, schedule, label })));
  await assert.rejects(() => f.ap("ap_weight", "list", {}, i.dealer), e => e.code === "42501");
});

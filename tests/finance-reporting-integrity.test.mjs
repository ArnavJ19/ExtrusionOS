import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const company = "11111111-1111-4111-8111-111111111111";
const foreign = "22222222-2222-4222-8222-222222222222";
const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sales = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const viewer = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const customerA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const orderA = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const orderB = "ffffffff-ffff-4fff-8fff-ffffffffffff";
let db;

const migration = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
async function as(actor, text, params = []) {
  await db.exec(`set test.actor = '${actor}';`);
  try { return await db.query(text, params); } finally { await db.exec("reset test.actor;"); }
}
const snapshot = async (actor, asOf = "2026-10-20") => (await as(actor, "select public.get_advanced_analytics_snapshot($1, 6) as v", [asOf])).rows[0].v;
const profitability = async (actor, dimension = "customer") => (await as(actor, "select public.get_profitability_summary($1) as v", [dimension])).rows[0].v;

test.before(async () => {
  db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create schema auth; create schema private;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create table app_users(id uuid, company_id uuid, role text, is_active boolean);
    create function private.get_current_user_company_id() returns uuid language sql security definer as $$select company_id from public.app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_role() returns text language sql security definer as $$select role from public.app_users where id=auth.uid() and is_active$$;
    create function private.metric_quote_is_open(p_status text, p_valid_until date, p_as_of date) returns boolean language sql immutable as
      $$select p_status in ('approved_for_sending','sent','customer_approved') and (p_valid_until is null or p_valid_until >= p_as_of)$$;
    insert into app_users values ('${owner}','${company}','accounts',true), ('${sales}','${company}','sales_manager',true), ('${viewer}','${company}','viewer',true);
    create table orders(id uuid, company_id uuid, customer_id uuid, order_date date, order_value numeric, current_stage text, expected_dispatch_date date, deleted_at timestamptz);
    create table quotes(id uuid, company_id uuid, status text, valid_until date, grand_total numeric, quote_date date, created_at timestamptz, deleted_at timestamptz);
    create table production_jobs(company_id uuid, status text, planned_date date, completed_at timestamptz, planned_quantity_kg numeric, actual_quantity_kg numeric);
    create table dispatches(id uuid, company_id uuid, order_id uuid, delivery_status text, actual_dispatched_at timestamptz);
    create table packing_list_items(company_id uuid, dispatch_id uuid, net_weight_kg numeric);
    create table invoices(id uuid default gen_random_uuid(), company_id uuid, customer_id uuid, order_id uuid, invoice_number text, invoice_date date, due_date date,
      status text, grand_total numeric, balance_due numeric, customer_credit_due numeric default 0, paid_date date, deleted_at timestamptz);
    create table credit_notes(company_id uuid, credit_date date, grand_total numeric, status text);
    create table payments(id uuid default gen_random_uuid(), company_id uuid, payment_date date, amount numeric, payment_method text, payment_type text, payment_status text);
    create table expense_ledger(company_id uuid, invoice_date date, created_at timestamptz default now(), total_amount numeric, amount_paid numeric,
      refunded_amount numeric default 0, currency text default 'INR', approval_status text, deleted_at timestamptz);
    create table quality_inspections(company_id uuid, status text, inspection_date timestamptz, created_at timestamptz);
    create table inventory_items(id uuid, company_id uuid, item_code text, item_name text, unit text, current_stock numeric, reorder_level numeric, is_active boolean);
    create table tasks(company_id uuid, status text, priority text);
    create table customers(id uuid, company_id uuid, company_name text, customer_name text);
    create table saved_reports(id uuid default gen_random_uuid(), data_source text);
    create table order_cost_breakdown(company_id uuid, order_id uuid, customer_name text, profile_name text, die_code text, salesperson text,
      product_category text, finishing_type text, branch text, month_key text, revenue numeric, total_weight_kg numeric,
      material_cost numeric, conversion_cost numeric, finishing_cost numeric, packing_cost numeric, transport_cost numeric, scrap_cost numeric,
      energy_cost numeric, die_cost_allocated numeric, overhead_cost numeric, other_cost numeric, payment_days integer default 0);
    insert into customers values ('${customerA}','${company}','Shree Fabricators','A');
    -- RPT-02: gross invoicing with an issued and a reversed credit note.
    insert into invoices(company_id, customer_id, order_id, invoice_number, invoice_date, due_date, status, grand_total, balance_due, customer_credit_due, paid_date) values
      ('${company}','${customerA}','${orderA}','INV-1','2026-10-02','2026-10-05','overdue',1000,600,0,null),
      ('${company}','${customerA}','${orderA}','INV-2','2026-10-03','2026-10-30','credited',500,0,300,null),
      ('${company}','${customerA}','${orderB}','INV-3','2026-09-01','2026-09-11','paid',2000,0,0,'2026-09-21'),
      ('${foreign}','${customerA}','${orderA}','INV-F','2026-10-02','2026-10-05','overdue',99999,99999,99999,null);
    insert into credit_notes values ('${company}','2026-10-10',500,'issued'), ('${company}','2026-10-11',700,'reversed'), ('${foreign}','2026-10-10',9999,'issued');
    -- RPT-03 semantics in collections: cancelled receipts ignored, refunds negative, credit adjustments excluded.
    insert into payments(company_id, payment_date, amount, payment_method, payment_type, payment_status) values
      ('${company}','2026-10-04',400,'cash','PARTIAL_PAYMENT','PAID'),
      ('${company}','2026-10-06',250,'cash','PARTIAL_PAYMENT','CANCELLED'),
      ('${company}','2026-10-12',300,'bank_transfer','REFUND','PAID'),
      ('${company}','2026-10-13',50,'credit_note','ADJUSTMENT','PAID'),
      ('${foreign}','2026-10-04',99999,'cash','PARTIAL_PAYMENT','PAID');
    -- RPT-01 / EXP-23: only approved, undeleted INR spend is booked.
    insert into expense_ledger(company_id, invoice_date, total_amount, amount_paid, refunded_amount, currency, approval_status, deleted_at) values
      ('${company}','2026-10-02',1000,600,100,'INR','approved',null),
      ('${company}','2026-10-03',5000,0,0,'INR','paid',null),
      ('${company}','2026-10-03',800,0,0,'INR','pending_approval',null),
      ('${company}','2026-10-03',700,0,0,'INR','draft',null),
      ('${company}','2026-10-03',600,0,0,'INR','rejected',null),
      ('${company}','2026-10-03',900,0,0,'INR','cancelled',null),
      ('${company}','2026-10-03',400,0,0,'INR','approved','2026-10-04'),
      ('${company}','2026-10-03',300,0,0,'USD','approved',null);
    -- RPT-05 / RPT-08 / RPT-09 profitability rows.
    insert into order_cost_breakdown(company_id, order_id, customer_name, month_key, revenue, total_weight_kg, material_cost, conversion_cost, finishing_cost,
      packing_cost, transport_cost, scrap_cost, energy_cost, die_cost_allocated, overhead_cost, other_cost, payment_days) values
      ('${company}','${orderB}','Shree Fabricators','2026-09',200,10,100,20,0,0,0,5,0,0,0,0,0),
      ('${company}','${orderA}','Shree Fabricators','2026-10',200,10,100,null,0,0,0,0,0,0,0,0,0),
      ('${company}',null,'',null,50,1,10,0,0,0,0,0,0,0,0,0,0),
      ('${foreign}',null,'Foreign',null,99999,1,1,1,1,1,1,1,1,1,1,1,0);
  `);
  await db.exec(migration("20261020030000_finance_reporting_integrity.sql"));
});
test.after(async () => { await db?.close(); });

test("RPT-01 / EXP-23: booked spend excludes draft, pending, rejected, cancelled, deleted and non-INR expenses", async () => {
  const data = await snapshot(owner);
  assert.equal(data.dataQuality.version, "20261020");
  assert.equal(Number(data.kpis.expenseRunRateMtd), 6000, "approved (including legacy paid label) INR spend only");
  assert.equal(Number(data.kpis.expenseCommitments), 800, "pending approvals are commitments, not spend");
  assert.equal(Number(data.kpis.expensePaidRateMtd), 100 * 500 / 6000, "paid is net of supplier refunds");
  assert.equal(Number(data.kpis.expenseNonInrCountMtd), 1);
  assert.deepEqual(data.expenseByCurrency.map((row) => [row.currency, Number(row.bookedMtd)]), [["INR", 6000], ["USD", 300]]);
  assert.ok(data.risks.some((risk) => /foreign-currency/.test(risk)));
});

test("RPT-02: invoicing is gross and reconciled with issued credit notes to net billing", async () => {
  const data = await snapshot(owner);
  assert.equal(Number(data.kpis.invoicedValueMtd), 1500);
  assert.equal(Number(data.kpis.creditNotesMtd), 500, "reversed credit notes and other tenants are excluded");
  assert.equal(Number(data.kpis.netInvoicedMtd), 1000);
  const october = data.trends.find((point) => point.key === "2026-10");
  assert.equal(Number(october.creditNoteValue), 500);
});

test("SEC-03 / RPT-03 semantics: collections are signed, posted-only and exclude credit adjustments", async () => {
  const data = await snapshot(owner);
  assert.equal(Number(data.kpis.collectionsMtd), 100, "400 receipt - 300 refund; cancelled and credit adjustments excluded");
  await assert.rejects(as(sales, "select * from private.get_financial_collection_events(null)"), /Permission denied/);
  await assert.rejects(as(viewer, "select * from private.get_financial_collection_events(null)"), /Permission denied/);
  assert.ok((await as(owner, "select * from private.get_financial_collection_events(null)")).rows.length === 2);
});

test("AR-06 / SEC-01: customer credit due is tracked for finance and customer-level detail is hidden from sales managers", async () => {
  const finance = await snapshot(owner);
  assert.equal(Number(finance.kpis.customerCreditDue), 300);
  assert.equal(finance.customerCreditList[0].invoiceNumber, "INV-2");
  assert.equal(finance.overdueInvoiceList[0].invoiceNumber, "INV-1");
  assert.equal(finance.dataQuality.financeDetail, true);
  const salesView = await snapshot(sales);
  assert.equal(salesView.dataQuality.financeDetail, false);
  assert.deepEqual(salesView.overdueInvoiceList, []);
  assert.deepEqual(salesView.customerCreditList, []);
  assert.deepEqual(salesView.expenseByCurrency, []);
  assert.equal(Number(salesView.kpis.expenseRunRateMtd), 0);
  assert.equal(Number(salesView.kpis.customerCreditDue), 0);
  assert.equal(Number(salesView.kpis.receivableOutstanding), 600, "aggregate receivable remains available");
  assert.equal(Number(salesView.kpis.collectionsMtd), 100, "aggregate collections remain available without event access");
  await assert.rejects(snapshot(viewer), /Permission denied/);
});

test("RPT-05 / RPT-08 / RPT-09: profitability aggregates all rows, marks unknown costs and uses receipt-based pay days", async () => {
  const summary = await profitability(owner);
  assert.equal(Number(summary.totals.rows), 3, "every company row is aggregated, none from another tenant");
  assert.equal(Number(summary.totals.incompleteRows), 1);
  assert.equal(Number(summary.totals.revenue), 450);
  assert.equal(Number(summary.totals.completeRevenue), 250);
  assert.equal(Number(summary.totals.totalCost), 135, "the NULL-cost row is excluded, not costed at zero");
  assert.equal(Number(summary.totals.margin), 115);
  assert.equal(Number(summary.totals.avgPayDays), 20, "INV-3 settled 20 days after invoice; unpaid rows are not zero-day payers");
  assert.equal(Number(summary.totals.settledRows), 1);
  assert.equal(Number(summary.totals.openRows), 1);
  const shree = summary.groups.find((group) => group.key === "Shree Fabricators");
  assert.equal(Number(shree.incompleteRows), 1);
  assert.equal(Number(shree.marginPct), 37.5, "margin % uses only rows with complete cost");
  assert.ok(summary.groups.some((group) => group.key === "Unassigned"));
  const byMonth = await profitability(owner, "month");
  assert.ok(byMonth.groups.some((group) => group.key === "Unassigned"), "a missing month key is labelled, not dropped");
  await assert.rejects(profitability(sales), /Permission denied/);
  await assert.rejects(profitability(owner, "margin; drop table x"), /Unsupported profitability dimension/);
});

test("credit notes are an accepted saved-report source", async () => {
  await db.exec("insert into saved_reports(data_source) values ('credit_notes')");
  await assert.rejects(db.exec("insert into saved_reports(data_source) values ('salary_slips')"), /saved_reports_data_source_check/);
});

// Diagnostic fixtures: extracted production SQL and dashboard query orchestration.
// No hosted access; a reproduced defect is not a successful business outcome.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { PGlite } from '../node_modules/.cache/business-logic-sql/node_modules/@electric-sql/pglite/dist/index.js';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const id = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const db = new PGlite();
const fn = (path, name) => {
  const source = read(path);
  const start = source.indexOf(`create or replace function ${name}(`);
  assert.ok(start >= 0);
  const body = source.indexOf('$$', start);
  return source.slice(start, source.indexOf('$$;', body + 2) + 3);
};
try {
  await db.exec(`create schema auth;
    create function auth.uid() returns uuid language sql as $$select '${id}'::uuid$$;
    create function public.get_current_user_company_id() returns uuid language sql as $$select '${id}'::uuid$$;
    create function public.get_current_user_role() returns text language sql as $$select 'owner'::text$$;
    create function public.get_financial_collection_events(date) returns table(event_id uuid,payment_date date,amount numeric) language sql as $$select null::uuid,null::date,0::numeric where false$$;
    create table orders(id uuid,company_id uuid,customer_id uuid,order_date date,order_value numeric,current_stage text,expected_dispatch_date date,deleted_at timestamptz);
    create table quotes(id uuid,company_id uuid,status text,grand_total numeric,quote_date date,created_at timestamptz,deleted_at timestamptz);
    create table production_jobs(id uuid,company_id uuid,status text,planned_date date,completed_at timestamptz,planned_quantity_kg numeric,actual_quantity_kg numeric);
    create table dispatches(id uuid,company_id uuid,order_id uuid,dispatch_date date,total_weight_kg numeric,delivery_status text);
    create table invoices(id uuid,company_id uuid,customer_id uuid,invoice_number text,invoice_date date,due_date date,status text,grand_total numeric,balance_due numeric,deleted_at timestamptz);
    create table expense_ledger(id uuid,company_id uuid,invoice_date date,created_at timestamptz,total_amount numeric,amount_paid numeric,deleted_at timestamptz);
    create table quality_inspections(id uuid,company_id uuid,status text,inspection_date date,created_at timestamptz);
    create table inventory_items(company_id uuid,item_code text,item_name text,unit text,current_stock numeric,reorder_level numeric,is_active boolean);
    create table tasks(company_id uuid,status text,priority text);
    create table customers(id uuid,company_id uuid,company_name text,customer_name text);
    insert into orders values('${id}','${id}','${id}','2026-10-02',1000,'order_confirmed','2026-10-05',null);
    insert into dispatches values('${id}','${id}','${id}','2026-10-03',500,'pending');`);
  await db.exec(fn('supabase/migrations/20260723080000_production_completion_analytics.sql', 'public.get_advanced_analytics_snapshot'));
  const snapshot = async () => (await db.query("select public.get_advanced_analytics_snapshot('2026-10-04',6) as snapshot")).rows[0].snapshot;
  let metrics = await snapshot();
  assert.equal(metrics.kpis.dispatchWeightMtd, 500);
  assert.equal(metrics.kpis.dispatchOnTimeRate, 100);
  console.log('D01 REPRODUCED: only dispatch is pending, yet analytics reports 500 kg shipped and 100% on-time.');
  await db.exec(`insert into orders values('${second}','${id}','${second}','2026-10-20',9000,'order_confirmed','2026-10-25',null);`);
  metrics = await snapshot();
  assert.equal(metrics.kpis.bookedRevenueMtd, 10000);
  console.log('D02 REPRODUCED: as-of October 4 includes October 20 order; MTD intake 10000 instead of 1000.');
  await db.exec(`insert into customers values('${id}','${id}','Same Trading Name','Customer A'),('${second}','${id}','Same Trading Name','Customer B');`);
  metrics = await snapshot();
  assert.equal(metrics.topCustomers.length, 1);
  assert.equal(metrics.topCustomers[0].orderCount, 2);
  console.log('D03 REPRODUCED: two distinct customer IDs with the same display name become one top-customer entry.');
  await db.exec(`insert into orders values(gen_random_uuid(),'${second}',null,'2026-10-02',100000,'order_confirmed',null,null),
    (gen_random_uuid(),'${id}',null,'2026-10-02',100000,'cancelled',null,null),
    (gen_random_uuid(),'${id}',null,'2026-10-02',100000,'order_confirmed',null,now());`);
  assert.equal((await snapshot()).kpis.bookedRevenueMtd, 10000);
  console.log('CONTROL PASSED: analytics order intake excludes foreign-company, cancelled and soft-deleted orders. RLS itself is not tested.');
  await db.exec(`insert into invoices values('${id}','${id}','${id}','INV-OPEN','2026-10-02','2026-10-03','partially_paid',1000,400,null),
    ('${second}','${id}','${id}','INV-DRAFT','2026-10-02','2026-10-03','draft',5000,5000,null);`);
  metrics = await snapshot();
  assert.equal(metrics.kpis.receivableOutstanding,400);
  assert.equal(metrics.kpis.overdueInvoices,1);
  assert.equal(metrics.kpis.invoicedValueMtd,1000);
  console.log('CONTROL PASSED: receivables use the 400 outstanding balance, exclude draft invoice, and count one overdue invoice. Balance derivation itself is not tested.');
} finally { await db.close(); }

// Extract the current server page up to its JSX return to execute real query
// construction and arithmetic. The adapter models the selected query operators.
const page = read('app/(dashboard)/dashboard/page.tsx');
const start = page.indexOf('export default async function DashboardPage()');
const end = page.indexOf('\n  return (', start);
assert.ok(start >= 0 && end > start);
const body = page.slice(start, end).replace('export default ', '') + '\n return {monthlyQuoteValue,monthlyOrderValue,monthlyOrderCount:monthlyOrders.count,lowInventoryRows,productionCount,pendingDispatchCount,delayedOrders,activeCustomerCount};\n}';
const js = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const stages = page.match(/const activeProductionStages = (\[[^;]+\]);/)[1];
const run = async (tables, cap = Infinity) => {
  const adapter = { from(table) {
    let rows = [...(tables[table] ?? [])];
    let countRequested = false;
    let head = false;
    let limit = Infinity;
    const query = new Proxy({}, { get(_target, method) {
      if (method === 'then') return (resolve, reject) => Promise.resolve({ data: head ? null : rows.slice(0, Math.min(limit, cap)), count: countRequested ? rows.length : null, error: null }).then(resolve, reject);
      return (...args) => {
        const [key, value] = args;
        if (method === 'select') { countRequested = value?.count === 'exact'; head = value?.head ?? false; }
        else if (method === 'eq') rows = rows.filter(row => row[key] === value);
        else if (method === 'neq') rows = rows.filter(row => row[key] !== value);
        else if (method === 'gte') rows = rows.filter(row => row[key] >= value);
        else if (method === 'lt') rows = rows.filter(row => row[key] < value);
        else if (method === 'in') rows = rows.filter(row => value.includes(row[key]));
        else if (method === 'not') rows = rows.filter(row => !args[2].slice(1,-1).split(',').includes(row[key]));
        else if (method === 'limit') limit = key;
        else if (method === 'order') rows.sort((a,b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (value?.ascending === false ? -1 : 1));
        else throw new Error(`Unsupported fixture query: ${String(method)}`);
        return query;
      };
    }});
    return query;
  }};
  const action = new Function('getSessionContext','getDashboardExperience','createClient','getBusinessDateBoundaries','getErrorMessage','redirect',`const activeProductionStages=${stages}; ${js}; return DashboardPage;`)(
    async () => ({role:'owner',companyId:id}), () => ({canSeeCommercial:true,canSeeOperations:true,operationalResources:['production','dispatches','inventory','quality','dies']}), async () => adapter,
    () => ({monthStart:'2026-10-01',today:'2026-10-04'}), e => String(e), () => { throw new Error('Unexpected redirect'); }
  );
  return action();
};
const normalItems = Array.from({length:50},(_,i) => ({id:`normal-${i}`,company_id:id,is_active:true,current_stock:1,reorder_level:0}));
let result = await run({inventory_items:[...normalItems,{id:'shortage',company_id:id,is_active:true,current_stock:100,reorder_level:200}]});
assert.equal(result.lowInventoryRows.length,0);
console.log('D04 REPRODUCED: 50 low-balance but healthy items hide the 51st item below its reorder level; Low Stock card receives zero.');
result = await run({inventory_items:Array.from({length:20},(_,i) => ({id:i,company_id:id,is_active:true,current_stock:1,reorder_level:10}))});
assert.equal(result.lowInventoryRows.length,5);
console.log('D04 REPRODUCED: 20 low-stock items become a 5-row preview also used as the headline count.');
result = await run({quotes:[{company_id:id,quote_date:'2026-10-02',grand_total:200,status:'sent'},{company_id:id,quote_date:'2026-10-02',grand_total:800,status:'customer_rejected'}]});
assert.equal(result.monthlyQuoteValue,1000);
console.log('D05 REPRODUCED: owner Pipeline Value includes rejected quote; 1000 displayed versus 200 open sent value.');
const confirmedOrder = {company_id:id,order_date:'2026-10-02',current_stage:'order_confirmed',order_value:100,expected_dispatch_date:'2026-10-03'};
result = await run({orders:[confirmedOrder]});
assert.equal(result.productionCount,1);
assert.equal(result.pendingDispatchCount,1);
assert.equal(result.delayedOrders.length,1);
console.log('D06 REPRODUCED: one merely confirmed overdue order populates production, pending-dispatch and delayed segments; owner labels include Jobs in production and Dispatch Ready.');
result = await run({orders:Array.from({length:1001},(_,i) => ({...confirmedOrder,id:`order-${i}`,customer_id:`customer-${i}`}))},1000);
assert.equal(result.monthlyOrderCount,1001);
assert.equal(result.monthlyOrderValue,100000);
assert.equal(result.activeCustomerCount,1000);
console.log('D07 REPRODUCED under a simulated 1000-row API cap: exact count 1001, summed value only 100000 instead of 100100, distinct customers only 1000. Actual hosted cap was not read.');

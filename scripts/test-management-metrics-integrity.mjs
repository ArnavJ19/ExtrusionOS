import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const company = "11111111-1111-4111-8111-111111111111";
const foreign = "22222222-2222-4222-8222-222222222222";
const actor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const second = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const db = new PGlite();
try {
  await db.exec(`
    create role authenticated; create role anon; create schema auth; create schema private;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create table app_users(id uuid,company_id uuid,role text,is_active boolean);
    insert into app_users values('${actor}','${company}','owner',true);
    create table orders(id uuid,company_id uuid,customer_id uuid,order_number text,order_date date,order_value numeric,current_stage text,expected_dispatch_date date,priority text,deleted_at timestamptz);
    create table quotes(id uuid,company_id uuid,customer_id uuid,quote_number text,status text,grand_total numeric,quote_date date,valid_until date,created_at timestamptz,deleted_at timestamptz);
    create table production_jobs(id uuid,company_id uuid,status text,planned_date date,completed_at timestamptz,planned_quantity_kg numeric,actual_quantity_kg numeric);
    create table dispatches(id uuid,company_id uuid,order_id uuid,dispatch_date date,total_weight_kg numeric,delivery_status text,actual_dispatched_at timestamptz);
    create table packing_list_items(company_id uuid,dispatch_id uuid,net_weight_kg numeric);
    create table invoices(id uuid,company_id uuid,customer_id uuid,invoice_number text,invoice_date date,due_date date,status text,grand_total numeric,balance_due numeric,deleted_at timestamptz);
    create table expense_ledger(id uuid,company_id uuid,invoice_date date,created_at timestamptz,total_amount numeric,amount_paid numeric,deleted_at timestamptz);
    create table quality_inspections(id uuid,company_id uuid,status text,inspection_date timestamptz,created_at timestamptz);
    create table quality_rework_resolutions(company_id uuid,source_inspection_id uuid);
    create table inventory_items(id uuid,company_id uuid,item_code text,item_name text,unit text,current_stock numeric,reorder_level numeric,is_active boolean);
    create table tasks(company_id uuid,status text,priority text);
    create table dies(company_id uuid,die_status text);
    create table customers(id uuid,company_id uuid,company_name text,customer_name text);
    create function public.get_financial_collection_events(date) returns table(event_id uuid,payment_date date,amount numeric) language sql as $$select null::uuid,null::date,0::numeric where false$$;
    set test.actor='${actor}';
    insert into orders(id,company_id,customer_id,order_number,order_date,order_value,current_stage,expected_dispatch_date)
      values('${company}','${company}','${company}','ORD-1','2026-10-02',1000,'order_confirmed','2026-10-03'),
      ('${second}','${company}','${second}','ORD-2','2026-10-03',300,'order_confirmed','2026-10-05'),
      (gen_random_uuid(),'${company}','${second}','FUTURE','2026-10-20',9000,'order_confirmed',null),
      (gen_random_uuid(),'${foreign}','${foreign}','FOREIGN','2026-10-02',100000,'order_confirmed',null),
      (gen_random_uuid(),'${company}','${company}','CANCEL','2026-10-02',100000,'cancelled',null);
    insert into customers values('${company}','${company}','Same Trading Name','A'),('${second}','${company}','Same Trading Name','B');
    insert into quotes(id,company_id,status,grand_total,quote_date,valid_until) values
      (gen_random_uuid(),'${company}','sent',200,'2026-09-01','2026-10-10'),
      (gen_random_uuid(),'${company}','customer_rejected',800,'2026-10-02',null),
      (gen_random_uuid(),'${company}','sent',900,'2026-10-01','2026-10-02'),
      (gen_random_uuid(),'${company}','draft',700,'2026-10-02',null);
    insert into dispatches values('${company}','${company}','${company}','2026-10-03',500,'pending',null);
  `);
  const migration = readFileSync(new URL("../supabase/migrations/20261008040000_management_metrics_integrity.sql",import.meta.url),"utf8");
  await db.exec(migration);
  await db.exec(migration);
  const analytics = async (date="2026-10-04") => (await db.query("select public.get_advanced_analytics_snapshot($1,6) as value",[date])).rows[0].value;
  const dashboard = async () => (await db.query("select public.get_dashboard_snapshot('2026-10-04') as value")).rows[0].value;
  let data = await analytics();
  assert.equal(data.kpis.dispatchWeightMtd,0);
  assert.equal(data.kpis.dispatchOnTimeRate,0);
  assert.equal(data.kpis.bookedRevenueMtd,1300);
  assert.equal(data.kpis.quotePipelineValueMtd,200);
  assert.equal(data.topCustomers.length,2);
  assert.notEqual(data.topCustomers[0].customerId,data.topCustomers[1].customerId);
  console.log("PASS D01-D03,D05: pending excluded, cutoff applied, customer IDs distinct, older open pipeline retained.");

  await db.exec(`update dispatches set delivery_status='dispatched', actual_dispatched_at='2026-10-03T21:00:00Z',total_weight_kg=9999;
    insert into packing_list_items values('${company}','${company}',123),('${foreign}','${company}',9999);
    insert into dispatches values('${second}','${company}','${company}','2026-10-01',800,'returned',null);`);
  data = await analytics();
  assert.equal(data.kpis.dispatchWeightMtd,123,"physical packing ledger governs kg, not header or other-company rows");
  assert.equal(data.kpis.dispatchOnTimeRate,0,"India movement date is Oct4, after promise Oct3");
  assert.equal(data.dataQuality.unknownShipmentCount,1);
  assert.equal(data.trends.at(-1).dispatchWeight,123);
  assert.ok(data.risks.some((risk)=>risk.includes("lack verified movement")));
  assert.equal((await analytics("2026-10-03")).kpis.dispatchWeightMtd,0);
  await db.exec(`insert into dispatches values(gen_random_uuid(),'${company}','${company}','2026-10-02',800,'dispatched','2026-10-02T10:00:00Z');`);
  assert.equal((await analytics()).kpis.dispatchOnTimeRate,0,"missing packing evidence cannot improve the on-time denominator");
  assert.equal((await dashboard()).dispatchCount,1,"missing packing evidence cannot count as a shipment");
  assert.equal((await analytics()).dataQuality.unknownShipmentCount,2);
  await db.exec(`insert into quality_inspections values(gen_random_uuid(),'${company}','approved','2026-10-04T21:00:00Z',null);`);
  assert.equal((await analytics()).kpis.qualityPassRateMtd,0,"Oct5 India inspection excluded on Oct4");
  assert.equal((await analytics("2026-10-05")).kpis.qualityPassRateMtd,100);
  await db.exec(`insert into quality_inspections values('${company}','${company}','rework','2026-10-04',null);`);
  assert.equal((await dashboard()).qualityHoldCount,1);
  await db.exec(`insert into quality_rework_resolutions values('${foreign}','${company}');`);
  assert.equal((await dashboard()).qualityHoldCount,1,"a foreign resolution cannot release this company hold");
  await db.exec(`insert into quality_rework_resolutions values('${company}','${company}');`);
  assert.equal((await dashboard()).qualityHoldCount,0,"resolved source rework must leave the current hold queue");
  await db.exec(`insert into quality_inspections values(gen_random_uuid(),'${company}','rejected','2026-10-04',null);`);
  assert.equal((await dashboard()).qualityHoldCount,1,"the rejected child contributes one actual remaining hold");
  console.log("PASS D01,D02,D08: authoritative kg, India event boundaries, legacy unknown shipment evidence marked partial.");

  await db.exec(`insert into inventory_items select gen_random_uuid(),'${company}','HEALTHY-'||n,'Healthy','piece',1,0,true from generate_series(1,50) n;
    insert into inventory_items values(gen_random_uuid(),'${company}','HIDDEN','Hidden shortage','piece',100,200,true);
    insert into inventory_items select gen_random_uuid(),'${company}','LOW-'||n,'Low','piece',1,2,true from generate_series(1,19) n;
    insert into orders(id,company_id,customer_id,order_number,order_date,order_value,current_stage)
      select gen_random_uuid(),'${company}',gen_random_uuid(),'BULK-'||n,'2026-10-02',100,'order_confirmed' from generate_series(1,1001) n;`);
  let main = await dashboard();
  assert.equal(main.lowInventoryCount,20);
  assert.equal(main.lowInventoryRows.length,5);
  assert.equal(main.monthlyOrderValue,101400);
  assert.equal(main.activeCustomerCount,1003);
  assert.equal(main.monthlyOrderCount,1003);
  assert.equal(main.productionCount,0,"confirmed orders cannot become jobs");
  assert.equal(main.orderStageDistribution.reduce((sum,row)=>sum+row.count,0),1003);
  assert.equal(main.delayedOrderCount,1);
  assert.equal(main.monthlyQuoteValue,200);
  await db.exec(`insert into production_jobs values(gen_random_uuid(),'${company}','in_progress','2026-10-04',null,100,null);`);
  assert.equal((await dashboard()).productionCount,1);
  console.log("PASS D04,D06,D07: exact shortages before preview, exclusive order distribution, real jobs, uncapped money/distinct buyers.");

  await db.exec("set role authenticated;");
  assert.equal((await dashboard()).monthlyOrderValue,101400,"authorized definer aggregate works without base SELECT grants");
  await assert.rejects(db.query("select private.metric_quote_is_open('sent',null,'2026-10-04')"),/permission denied/);
  await db.exec("reset role; update app_users set role='production'; set role authenticated;");
  main=await dashboard();
  assert.equal(main.monthlyOrderValue,null);
  assert.deepEqual(main.orderRows,[]);
  assert.equal(main.productionCount,1);
  await assert.rejects(analytics(),/Permission denied/);
  await db.exec(`reset role; update app_users set role='owner',company_id='${foreign}'; set role authenticated;`);
  assert.equal((await dashboard()).monthlyOrderCount,1);
  await db.exec("reset role; update app_users set is_active=false; set role authenticated;");
  await assert.rejects(dashboard(),/Permission denied/);
  await assert.rejects(analytics(),/Authentication required/);
  await db.exec("reset role; set role anon;");
  await assert.rejects(dashboard(),/permission denied/);
  console.log("PASS authority: owner allowed, operational money withheld, other tenant scoped, suspended/anonymous denied.");
} finally { await db.close(); }

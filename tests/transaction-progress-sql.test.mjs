import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {PGlite} from '@electric-sql/pglite';
import {transactionProgressSchema} from '../lib/workflow/transaction-evidence.ts';
const id=n=>`cd000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db;
test.before(async()=>{
  db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema private;
    create function private.get_current_user_role() returns text language sql stable as $$ select current_setting('fixture.role') $$;
    create function private.commercial_actor(text[]) returns uuid language plpgsql stable as $$ begin if not private.get_current_user_role()=any($1) then raise exception 'Role refused';end if;return '${id(1)}'::uuid;end; $$;
    create table orders(id uuid primary key,company_id uuid,order_number text,current_stage text,deleted_at timestamptz);
    create table production_jobs(id uuid primary key,company_id uuid,order_id uuid,status text,actual_quantity_kg numeric);
    create table dispatches(id uuid primary key,company_id uuid,order_id uuid,total_weight_kg numeric,actual_dispatched_at timestamptz);
    create table packing_list_items(id uuid primary key,company_id uuid,dispatch_id uuid,net_weight_kg numeric,operator_verified_by uuid,operator_verified_at timestamptz);
    create table material_dispositions(id uuid primary key,company_id uuid,dispatch_id uuid,source_type text,disposition text,weight_kg numeric);
    create table quality_inspections(id uuid primary key,company_id uuid,production_job_id uuid,status text);
    create table invoices(id uuid primary key,company_id uuid,order_id uuid,status text,grand_total numeric,amount_paid numeric,credited_amount numeric,deleted_at timestamptz,
      balance_due numeric generated always as(greatest(grand_total-amount_paid-credited_amount,0)) stored,
      customer_credit_due numeric generated always as(greatest(amount_paid+credited_amount-grand_total,0)) stored);`);
  await db.exec(readFileSync('supabase/migrations/20261028140000_order_transaction_progress.sql','utf8'));
});
test.after(()=>db?.close());
test.beforeEach(async()=>{
  await db.exec(`truncate orders,production_jobs,dispatches,packing_list_items,material_dispositions,quality_inspections,invoices;set fixture.role='owner';
    insert into orders values('${id(2)}','${id(1)}','ORD-EVIDENCE','quality_check',null);
    insert into production_jobs values('${id(3)}','${id(1)}','${id(2)}','completed',600),('${id(4)}','${id(1)}','${id(2)}','running',null);
    insert into dispatches values('${id(5)}','${id(1)}','${id(2)}',100,now()-interval '1 day'),('${id(6)}','${id(1)}','${id(2)}',60,now()-interval '1 day'),('${id(7)}','${id(1)}','${id(2)}',200,null);
    insert into packing_list_items values('${id(8)}','${id(1)}','${id(5)}',100,'${id(10)}',now()-interval '2 days'),('${id(9)}','${id(1)}','${id(6)}',60,'${id(10)}',now()-interval '2 days');
    insert into quality_inspections values('${id(11)}','${id(1)}','${id(3)}','rejected');
    insert into invoices(id,company_id,order_id,status,grand_total,amount_paid,credited_amount) values('${id(12)}','${id(1)}','${id(2)}','generated',10000,3000,1000),('${id(13)}','${id(1)}','${id(2)}','cancelled',9999,0,0);`);
});
const progress=async()=>transactionProgressSchema.parse((await db.query('select order_transaction_progress($1) data',[id(2)])).rows[0].data);
test('34: planned work and pending packing do not count as completed production or confirmed dispatch',async()=>{
  const data=await progress();assert.equal(data.produced_kg,600);assert.equal(data.confirmed_outward_kg,160);assert.equal(data.quality_exceptions,1);assert.equal(data.current_stage,'quality_check');
});
test('34: physical return dispositions change net outward while quarantines remain independent',async()=>{
  await db.exec(`insert into material_dispositions values('${id(14)}','${id(1)}','${id(6)}','dispatch_return','quarantine',10);`);
  assert.equal((await progress()).net_outward_kg,160);
  await db.exec(`insert into material_dispositions values('${id(15)}','${id(1)}','${id(6)}','dispatch_return','return_to_stock',20);`);
  const data=await progress();assert.equal(data.net_outward_kg,140);assert.equal(data.confirmed_outward_kg,160);assert.equal(data.recorded_returns_kg,20);
});
test('34: unverified, inconsistent and missing shipment evidence is unavailable, including SQL NULL',async()=>{
  await db.query('update dispatches set total_weight_kg=null where id=$1',[id(5)]);
  let data=await progress();assert.equal(data.dispatch_evidence_complete,false);assert.equal(data.confirmed_outward_kg,null);
  await db.query('update dispatches set total_weight_kg=100 where id=$1',[id(5)]);await db.query('update packing_list_items set operator_verified_by=null where id=$1',[id(8)]);
  data=await progress();assert.equal(data.net_outward_kg,null);
});
test('34: a missing production observation differs from recorded zero and later correction is reflected',async()=>{
  await db.query('update production_jobs set actual_quantity_kg=null where id=$1',[id(3)]);assert.equal((await progress()).produced_kg,null);
  await db.query('update production_jobs set actual_quantity_kg=0 where id=$1',[id(3)]);assert.equal((await progress()).produced_kg,0);
  await db.query('update production_jobs set actual_quantity_kg=580 where id=$1',[id(3)]);assert.equal((await progress()).produced_kg,580);
});
test('34: receipts and credits reconcile without exposing finance to operational roles',async()=>{
  const initial=await progress();assert.deepEqual(initial.financials,{billed:10000,receipts_net:3000,credits:1000,receivable:6000,customer_credit_due:0,invoice_count:1});
  await db.query('update invoices set amount_paid=0 where id=$1',[id(12)]);assert.equal((await progress()).financials.receivable,9000);
  await db.exec("set fixture.role='production'");assert.equal('financials'in await progress(),false);
});
test('34: foreign order identity and future departure timestamps never certify progress',async()=>{
  await assert.rejects(db.query('select order_transaction_progress($1)',[id(999)]),/unavailable/);
  await db.query("update dispatches set actual_dispatched_at=now()+interval '1 day' where id=$1",[id(5)]);assert.equal((await progress()).confirmed_outward_kg,null);
});

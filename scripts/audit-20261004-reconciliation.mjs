// Isolated diagnostics of current behavior; not production migration replay.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '../node_modules/.cache/business-logic-sql/node_modules/@electric-sql/pglite/dist/index.js';
const id = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const fn = (file, name) => {
  const source = readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8');
  const start = source.indexOf(`create or replace function ${name}(`);
  assert.ok(start >= 0, name);
  const body = source.indexOf('$$', start);
  return source.slice(start, source.indexOf('$$;', body + 2) + 3);
};
const db = new PGlite();
try {
  await db.exec(`create schema private; create schema auth;
    create function auth.uid() returns uuid language sql as $$select '${id}'::uuid$$;
    create function private.get_current_user_company_id() returns uuid language sql as $$select '${id}'::uuid$$;
    create function private.get_current_user_role() returns text language sql as $$select 'owner'::text$$;
    create table orders(id uuid,company_id uuid);
    insert into orders values('${id}','${id}');
    create table production_jobs(id uuid primary key,company_id uuid,order_id uuid,status text,actual_quantity_kg numeric,pieces integer,actual_pieces integer,updated_at timestamptz);
    insert into production_jobs values('${id}','${id}','${id}','completed',100,10,10,null);`);
  const atomic = '20260715000000_atomic_business_workflows.sql';
  for (const name of ['private.keep_jsonb_keys', 'private.update_jsonb_row', 'private.save_production_job_atomic']) await db.exec(fn(atomic, name));
  await db.exec(fn('20260718021500_floor_output_and_finishing_workflows.sql', 'public.validate_production_completion'));
  await db.exec(fn('20260810010000_manufacturing_reference_and_material_guards.sql', 'public.guard_production_job_status'));
  await db.exec(fn('20260718020500_finishing_route_and_quality_yield.sql', 'public.link_billets_to_production_job'));
  await db.exec(`alter table production_jobs add column machine_id uuid;
    create table production_plan_slots(company_id uuid,production_job_id uuid,machine_id uuid,status text);
    create table packaging_jobs(production_job_id uuid,profile_weight_kg numeric);
    insert into packaging_jobs values('${id}',100);
    create trigger guard_production_job_status before update on production_jobs for each row execute function public.guard_production_job_status();
    create trigger production_handoff after update on production_jobs for each row execute function public.link_billets_to_production_job();
    create trigger validate_production_completion before insert or update of status,actual_quantity_kg on production_jobs for each row execute function public.validate_production_completion();
    select private.save_production_job_atomic('${id}','{"order_id":"${id}","status":"completed","actual_quantity_kg":200}'::jsonb,'{}'::uuid[]);`);
  assert.equal(Number((await db.query('select actual_quantity_kg from production_jobs')).rows[0].actual_quantity_kg), 200);
  assert.equal(Number((await db.query('select profile_weight_kg from packaging_jobs')).rows[0].profile_weight_kg), 100);
  console.log('C01 REPRODUCED: save RPC, completion/status guards and handoff trigger accept completed output 100 -> 200 kg; packaging stays 100 kg. Other production triggers are outside this fixture.');

  await db.exec(`create table system_configurations(id uuid,company_id uuid,order_id uuid);
    create table profile_stock_batches(id uuid primary key,company_id uuid,profile_id uuid,total_weight_kg numeric,quantity_pieces integer,length_m numeric,status text);
    create table profile_stock_reservations(id uuid primary key,company_id uuid,order_id uuid,configuration_id uuid,profile_stock_batch_id uuid,profile_id uuid,status text,reserved_weight_kg numeric,reserved_length_m numeric,released_at timestamptz);
    create table dispatches(id uuid primary key,company_id uuid,order_id uuid);
    create table packing_list_items(company_id uuid,dispatch_id uuid,reservation_id uuid,profile_stock_batch_id uuid,profile_id uuid,net_weight_kg numeric,source_kind text);
    create table profile_stock_consumptions(company_id uuid,reservation_id uuid,profile_stock_batch_id uuid,profile_id uuid,order_id uuid,dispatch_id uuid,consumed_weight_kg numeric,consumed_length_m numeric,notes text,created_by uuid,unique(company_id,dispatch_id,reservation_id));
    insert into profile_stock_batches values('${id}','${id}','${id}',400,40,200,'available');
    insert into dispatches values('${id}','${id}','${id}');`);
  const astra = '20260930000000_astra_audit_fixes.sql';
  for (const name of ['private.guard_profile_reservation_capacity', 'private.guard_reserved_stock_capacity']) await db.exec(fn(astra, name));
  await db.exec(`create trigger reservation_capacity before insert or update on profile_stock_reservations for each row execute function private.guard_profile_reservation_capacity();
    create trigger stock_capacity before update on profile_stock_batches for each row execute function private.guard_reserved_stock_capacity();
    insert into profile_stock_reservations values('${id}','${id}','${id}',null,'${id}','${id}','active',100,0,null);
    insert into packing_list_items values('${id}','${id}','${id}','${id}','${id}',100,'reservation');`);
  await db.exec(fn('20260721091307_physical_dispatch_stock_provenance.sql', 'private.consume_dispatch_reservations'));
  await db.exec(`select private.consume_dispatch_reservations('${id}');`);
  const batch = (await db.query('select * from profile_stock_batches')).rows[0];
  assert.equal(Number(batch.total_weight_kg), 300);
  assert.equal(Number(batch.quantity_pieces), 30);
  assert.equal(Number(batch.length_m), 200);
  assert.equal(Number((await db.query('select consumed_length_m from profile_stock_consumptions')).rows[0].consumed_length_m), 50);
  await db.exec(`insert into profile_stock_reservations values('${second}','${id}','${id}',null,'${id}','${id}','active',100,0,null);`);
  const length = Number((await db.query(`select reserved_length_m from profile_stock_reservations where id='${second}'`)).rows[0].reserved_length_m);
  assert.equal(length, 66.667);
  console.log('C02 REPRODUCED: dispatch consumes 100 kg/50 m; batch becomes 300 kg/30 pieces but stays 200 m; next 100 kg reservation incorrectly derives 66.667 m. Both current capacity guards installed.');

  await db.exec(`create table payments(id uuid,company_id uuid,payment_date date,amount numeric,payment_type text,payment_method text,payment_status text);
    insert into payments values('${id}','${id}',current_date,100,'ADJUSTMENT','credit_note','PAID'),
    ('${second}','${id}',current_date,200,'PARTIAL_PAYMENT','cash','PAID');`);
  await db.exec(fn('20260718010100_financial_collection_analytics.sql', 'private.get_financial_collection_events'));
  const events = (await db.query('select * from private.get_financial_collection_events(null)')).rows;
  assert.equal(events.length, 1);
  assert.equal(Number(events[0].amount), 200);
  console.log('CONTROL PASSED: cash-collection events exclude a 100 credit-note adjustment and include the 200 cash receipt.');
} finally {
  await db.close();
}

// Isolated allocation controls using current repository function bodies.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '../node_modules/.cache/business-logic-sql/node_modules/@electric-sql/pglite/dist/index.js';

const companyId = '11111111-1111-4111-8111-111111111111';
const oldMismatchOrder = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const targetOrder = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const oldCompatibleOrder = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const mismatchRequirement = 'aaaaaaaa-0000-4000-8000-000000000011';
const targetRequirement = 'bbbbbbbb-0000-4000-8000-000000000012';
const compatibleRequirement = 'cccccccc-0000-4000-8000-000000000013';
const mismatchBillet = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const compatibleBillet = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb';

function definition(file, name) {
  const source = readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8');
  const start = source.indexOf(`create or replace function ${name}(`);
  assert.ok(start >= 0, `Missing function ${name} in ${file}`);
  const body = source.indexOf('$$', start);
  return source.slice(start, source.indexOf('$$;', body + 2) + 3);
}

function triggerDefinition(file, name) {
  const source = readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8');
  const start = source.indexOf(`drop trigger if exists ${name} on public.foundry_billets;`);
  assert.ok(start >= 0, `Missing trigger ${name} in ${file}`);
  const create = source.indexOf(`create trigger ${name}`, start);
  assert.ok(create >= 0, `Missing trigger creation ${name} in ${file}`);
  const execute = source.indexOf('execute function ', create);
  assert.ok(execute >= 0, `Missing trigger function call for ${name} in ${file}`);
  const end = source.indexOf(';', execute) + 1;
  assert.ok(end > execute, `Unterminated trigger creation for ${name} in ${file}`);
  return source.slice(start, end);
}

const db = new PGlite();
try {
  await db.exec(`
    create schema auth;
    create schema private;
    create function auth.uid() returns uuid language sql as $$select '${companyId}'::uuid$$;
    create function public.get_current_user_company_id() returns uuid language sql as $$select '${companyId}'::uuid$$;
    create function public.get_current_user_role() returns text language sql as $$select 'production_manager'::text$$;
    create function public.rebuild_order_billet_requirements(p_order_id uuid) returns void language plpgsql as $$begin return; end$$;
    create function public.notify_billet_allocation(uuid, text, text, text, uuid) returns void language sql as $$select$$;

    create table public.orders (
      id uuid primary key, company_id uuid not null, order_number text, current_stage text,
      billets_required integer default 0, billets_allocated integer default 0,
      billets_short integer default 0, billet_allocation_status text default 'not_required'
    );
    create table public.order_billet_requirements (
      id uuid primary key, company_id uuid not null, order_id uuid not null, profile_id uuid,
      alloy text, temper text, billet_diameter_inch numeric, billets_required integer,
      billets_allocated integer default 0, billets_short integer default 0,
      status text, created_at timestamptz default now(), updated_at timestamptz default now()
    );
    create table public.production_jobs (
      id uuid primary key, company_id uuid not null, order_id uuid, profile_id uuid
    );
    create table public.foundry_billets (
      id uuid primary key, company_id uuid not null, status text not null, order_id uuid,
      allocation_requirement_id uuid, alloy text, temper text, billet_diameter_inch numeric,
      production_job_id uuid, allocated_at timestamptz, allocated_by uuid,
      billet_code text, created_at timestamptz default now(), updated_at timestamptz default now()
    );
  `);

  await db.exec(definition('20260530000002_foundry_billet_allocation_repairs.sql', 'public.repair_order_billet_requirement_links'));
  await db.exec(definition('20260530000002_foundry_billet_allocation_repairs.sql', 'public.refresh_order_billet_allocations'));
  const reallocateBody = definition('20260530000002_foundry_billet_allocation_repairs.sql', 'public.reallocate_billet_to_order')
    .replace('function public.reallocate_billet_to_order(', 'function private.reallocate_billet_to_order(');
  await db.exec(reallocateBody);
  await db.exec(definition('20260602000002_security_definer_access_hardening.sql', 'public.reallocate_billet_to_order'));
  await db.exec(definition('20260812000000_security_and_notification_integrity.sql', 'public.validate_foundry_billet_lineage'));
  await db.exec(triggerDefinition('20260810010000_manufacturing_reference_and_material_guards.sql', 'validate_foundry_billet_lineage'));

  await db.exec(`
    insert into public.orders(id,company_id,order_number,current_stage) values
      ('${oldMismatchOrder}','${companyId}','SRC-T6','order_confirmed'),
      ('${targetOrder}','${companyId}','TARGET-T5','order_confirmed'),
      ('${oldCompatibleOrder}','${companyId}','SRC-T5','cancelled');
    insert into public.order_billet_requirements(id,company_id,order_id,profile_id,alloy,temper,billet_diameter_inch,billets_required,billets_allocated,billets_short,status) values
      ('${mismatchRequirement}','${companyId}','${oldMismatchOrder}','aaaaaaaa-0000-4000-8000-000000000001','6063','T6',6,1,1,0,'complete'),
      ('${targetRequirement}','${companyId}','${targetOrder}','aaaaaaaa-0000-4000-8000-000000000001','6063','T5',6,1,0,1,'shortage'),
      ('${compatibleRequirement}','${companyId}','${oldCompatibleOrder}','bbbbbbbb-0000-4000-8000-000000000002','6063','T5',6,1,1,0,'complete');
    insert into public.foundry_billets(id,company_id,status,order_id,allocation_requirement_id,alloy,temper,billet_diameter_inch) values
      ('${mismatchBillet}','${companyId}','allocated','${oldMismatchOrder}','${mismatchRequirement}','6063','T6',6),
      ('${compatibleBillet}','${companyId}','allocated','${oldCompatibleOrder}','${compatibleRequirement}','6063','T5',6);
  `);

  await assert.rejects(
    db.query(`select public.reallocate_billet_to_order('${mismatchBillet}','${targetOrder}')`),
    /Billet alloy, temper, and diameter must match the order requirement/
  );
  const unchanged = (await db.query(`select order_id, allocation_requirement_id, status from public.foundry_billets where id='${mismatchBillet}'`)).rows[0];
  assert.equal(unchanged.order_id, oldMismatchOrder);
  assert.equal(unchanged.allocation_requirement_id, mismatchRequirement);
  console.log('PASS: incompatible 6063-T6 to 6063-T5 reallocation is rejected by the current lineage trigger; the original allocation remains intact.');

  await db.query(`select public.reallocate_billet_to_order('${compatibleBillet}','${targetOrder}')`);
  const target = (await db.query(`select r.billets_required,r.billets_allocated,r.billets_short,r.status,o.billet_allocation_status from public.order_billet_requirements r join public.orders o on o.id=r.order_id where r.id='${targetRequirement}'`)).rows[0];
  const old = (await db.query(`select billets_allocated,billets_short,status from public.order_billet_requirements where id='${compatibleRequirement}'`)).rows[0];
  assert.deepEqual(target, { billets_required: 1, billets_allocated: 1, billets_short: 0, status: 'complete', billet_allocation_status: 'complete' });
  assert.deepEqual(old, { billets_allocated: 0, billets_short: 1, status: 'shortage' });
  console.log('PASS: compatible reallocation refreshes both source and target requirement/order counters from linked billet rows.');
  console.log('LIMIT: current repair, refresh, reallocation, and latest lineage function/trigger definitions were loaded from migrations; requirement rebuild and allocation notifications were stubbed. This is an isolated PGlite control, not full migration replay, grant/RLS or authenticated UI proof, or independent-session concurrency evidence.');
} finally {
  await db.close();
}

// Focused foundry material integrity reproductions using current repository SQL.
// The fixture installs selected current function bodies; it is not a migration replay.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '../node_modules/.cache/business-logic-sql/node_modules/@electric-sql/pglite/dist/index.js';

const company = '11111111-1111-4111-8111-111111111111';
const scrap = '22222222-2222-4222-8222-222222222222';
const external = '33333333-3333-4333-8333-333333333333';
const validBatch = '44444444-4444-4444-8444-444444444444';
const unbackedBatch = '55555555-5555-4555-8555-555555555555';
const shrinkBatch = '66666666-6666-4666-8666-666666666666';
const densityBatch = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const order = '77777777-7777-4777-8777-777777777777';
const profile = '88888888-8888-4888-8888-888888888888';
const job = '99999999-9999-4999-8999-999999999999';
const requirement = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function definition(file, qualifiedName) {
  const source = readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  const start = source.toLowerCase().indexOf(`create or replace function ${qualifiedName.toLowerCase()}(`);
  assert.ok(start >= 0, `${qualifiedName} in ${file}`);
  const end = source.indexOf('\n$$;', start);
  assert.ok(end >= 0, `function terminator for ${qualifiedName}`);
  return source.slice(start, end + 4);
}

const db = new PGlite();
try {
  await db.exec(`
    create schema if not exists private;
    create table public.foundry_aluminium_scrap (
      id uuid primary key, company_id uuid not null, weight_kg numeric not null,
      available_weight_kg numeric not null, status text not null, updated_at timestamptz default now()
    );
    create table public.foundry_external_aluminium_sources (
      id uuid primary key, company_id uuid not null, weight_kg numeric not null,
      available_weight_kg numeric not null, status text not null, alloy text, updated_at timestamptz default now()
    );
    create table public.foundry_batches (
      id uuid primary key, company_id uuid not null, batch_number text,
      furnace_number text, furnace_name text, batch_sequence integer,
      production_date date not null, scrap_id uuid, external_source_id uuid,
      scrap_percentage numeric not null default 0, external_aluminium_percentage numeric not null default 100,
      furnace_efficiency_percent numeric not null default 80, required_furnace_charge_kg numeric not null default 0,
      scrap_aluminium_kg numeric not null default 0, external_aluminium_kg numeric not null default 0,
      ingot_kg numeric not null default 0, alloy text not null, temper text not null,
      alloy_density_kg_m3 numeric not null, billet_length_mm numeric not null,
      billet_diameter_inch numeric not null, billet_diameter_mm numeric not null,
      billet_count integer not null, billet_weight_density_kg numeric not null default 0,
      total_billet_weight_density_kg numeric not null default 0,
      alloy_composition_default jsonb not null default '{}'::jsonb,
      alloy_composition_actual jsonb not null default '{}'::jsonb,
      alloy_composition_altered boolean not null default false,
      status text not null default 'planned'
    );
    create table public.order_billet_requirements (
      id uuid primary key, company_id uuid not null, order_id uuid not null,
      profile_id uuid not null, alloy text not null, temper text not null, billet_diameter_inch numeric not null
    );
    create table public.production_jobs (
      id uuid primary key, company_id uuid not null, order_id uuid not null, profile_id uuid not null
    );
    create table public.foundry_billets (
      id uuid primary key default gen_random_uuid(), company_id uuid not null,
      source_type text not null, foundry_batch_id uuid not null references public.foundry_batches(id) on delete cascade,
      billet_code text not null, billet_number integer not null, billet_diameter_inch numeric not null,
      billet_diameter_mm numeric not null, billet_length_mm numeric not null, alloy text not null,
      temper text not null, weight_kg numeric not null, status text not null,
      order_id uuid, allocation_requirement_id uuid, allocated_at timestamptz,
      allocated_by uuid, production_job_id uuid, updated_at timestamptz default now()
    );
    create unique index foundry_billets_batch_number_in_house_unique
      on public.foundry_billets(foundry_batch_id, billet_number) where source_type = 'in_house';
    -- This helper is only needed by the unexercised batch-cancellation branch.
    create function public.refresh_order_billet_allocations(uuid) returns void
      language sql as $$ select $$;
  `);

  // Latest calculation body is from ASTRA migration; source debit bodies and
  // billet synchronization are the latest found in their migration history.
  for (const [file, name] of [
    ['20260930000000_astra_audit_fixes.sql', 'public.refresh_foundry_batch_calculations'],
    ['20260515005700_foundry_furnace_mix_and_chemistry.sql', 'public.sync_foundry_scrap_usage'],
    ['20260515005700_foundry_furnace_mix_and_chemistry.sql', 'public.sync_foundry_external_source_usage'],
    ['20260530000002_foundry_billet_allocation_repairs.sql', 'public.sync_foundry_billets'],
    ['20260812000000_security_and_notification_integrity.sql', 'public.validate_foundry_billet_lineage']
  ]) {
    await db.exec(definition(file, name));
  }

  await db.exec(`
    create trigger refresh_foundry_batch_calculations
      before insert or update on public.foundry_batches
      for each row execute function public.refresh_foundry_batch_calculations();
    create trigger sync_foundry_external_source_usage
      before insert or update on public.foundry_batches
      for each row execute function public.sync_foundry_external_source_usage();
    create trigger sync_foundry_scrap_usage
      before insert or update on public.foundry_batches
      for each row execute function public.sync_foundry_scrap_usage();
    create trigger validate_foundry_billet_lineage
      before insert or update of company_id, order_id, allocation_requirement_id, production_job_id,
        alloy, temper, billet_diameter_inch on public.foundry_billets
      for each row execute function public.validate_foundry_billet_lineage();
    create trigger sync_foundry_billets
      after insert or update on public.foundry_batches
      for each row execute function public.sync_foundry_billets();
    insert into public.foundry_aluminium_scrap(id,company_id,weight_kg,available_weight_kg,status)
      values ('${scrap}','${company}',200,200,'available');
    insert into public.foundry_external_aluminium_sources(id,company_id,weight_kg,available_weight_kg,status,alloy)
      values ('${external}','${company}',500,500,'available','6063');
  `);

  // Positive control: with compatible sources and a 50/50 mix, current SQL
  // reserves exactly the calculated charge split and creates one billet.
  await db.exec(`insert into public.foundry_batches(
    id,company_id,batch_number,furnace_number,batch_sequence,production_date,
    scrap_id,external_source_id,scrap_percentage,external_aluminium_percentage,
    furnace_efficiency_percent,alloy,temper,alloy_density_kg_m3,billet_length_mm,
    billet_diameter_inch,billet_diameter_mm,billet_count,status
  ) values ('${validBatch}','${company}','FB-CONTROL','F1',1,'2026-10-04',
    '${scrap}','${external}',50,50,100,'6063','T6',2700,1000,4,101.6,1,'cast');`);
  const control = (await db.query(`select b.required_furnace_charge_kg,b.scrap_aluminium_kg,b.external_aluminium_kg,
      s.available_weight_kg as scrap_available,e.available_weight_kg as external_available,
      (select count(*)::int from public.foundry_billets fb where fb.foundry_batch_id=b.id) as billet_count
    from public.foundry_batches b
    join public.foundry_aluminium_scrap s on s.id=b.scrap_id
    join public.foundry_external_aluminium_sources e on e.id=b.external_source_id
    where b.id='${validBatch}'`)).rows[0];
  assert.equal(Number(control.scrap_available), 200 - Number(control.scrap_aluminium_kg));
  assert.equal(Number(control.external_available), 500 - Number(control.external_aluminium_kg));
  assert.ok(Math.abs(Number(control.scrap_aluminium_kg) + Number(control.external_aluminium_kg) - Number(control.required_furnace_charge_kg)) <= 0.001);
  assert.equal(control.billet_count, 1);
  console.log(`CONTROL PASSED: one compatible source-backed insert debits the calculated charge split (${control.scrap_aluminium_kg} kg scrap + ${control.external_aluminium_kg} kg external).`);

  // Missing-source reproduction: the latest trigger computes charge/output,
  // but nullable source IDs skip both source debit guards.
  await db.exec(`insert into public.foundry_batches(
    id,company_id,batch_number,furnace_number,batch_sequence,production_date,
    scrap_percentage,external_aluminium_percentage,furnace_efficiency_percent,
    alloy,temper,alloy_density_kg_m3,billet_length_mm,billet_diameter_inch,
    billet_diameter_mm,billet_count,status
  ) values ('${unbackedBatch}','${company}','FB-UNBACKED','F1',2,'2026-10-04',
    0,100,80,'6063','T6',2700,1000,4,101.6,1,'cast');`);
  const unbacked = (await db.query(`select scrap_id,external_source_id,required_furnace_charge_kg,scrap_aluminium_kg,external_aluminium_kg,
      (select count(*)::int from public.foundry_billets fb where fb.foundry_batch_id=b.id) as billet_count
    from public.foundry_batches b where id='${unbackedBatch}'`)).rows[0];
  assert.equal(unbacked.scrap_id, null);
  assert.equal(unbacked.external_source_id, null);
  assert.ok(Number(unbacked.required_furnace_charge_kg) > 0);
  assert.ok(Math.abs(Number(unbacked.scrap_aluminium_kg) + Number(unbacked.external_aluminium_kg) - Number(unbacked.required_furnace_charge_kg)) <= 0.001);
  assert.equal(unbacked.billet_count, 1);
  const sourceBalancesAfterUnbacked = (await db.query(`select
    (select available_weight_kg from public.foundry_aluminium_scrap where id='${scrap}') as scrap_available,
    (select available_weight_kg from public.foundry_external_aluminium_sources where id='${external}') as external_available`)).rows[0];
  assert.equal(Number(sourceBalancesAfterUnbacked.scrap_available), Number(control.scrap_available));
  assert.equal(Number(sourceBalancesAfterUnbacked.external_available), Number(control.external_available));
  console.log(`P1 REPRODUCED: ${unbacked.required_furnace_charge_kg} kg external-aluminium charge and one cast billet are accepted with neither source ID; both source balances remain unchanged.`);

  // Count-shrink reproduction. Install the latest billet lineage trigger;
  // the issued billet keeps compatible alloy/temper/diameter/order/job data.
  await db.exec(`
    insert into public.order_billet_requirements values ('${requirement}','${company}','${order}','${profile}','6063','T6',4);
    insert into public.production_jobs values ('${job}','${company}','${order}','${profile}');
    insert into public.foundry_batches(
      id,company_id,batch_number,furnace_number,batch_sequence,production_date,
      scrap_percentage,external_aluminium_percentage,furnace_efficiency_percent,
      alloy,temper,alloy_density_kg_m3,billet_length_mm,billet_diameter_inch,
      billet_diameter_mm,billet_count,status
    ) values ('${shrinkBatch}','${company}','FB-SHRINK','F1',3,'2026-10-04',
      0,100,80,'6063','T6',2700,1000,4,101.6,3,'cast');
    update public.foundry_billets set status='issued',order_id='${order}',
      allocation_requirement_id='${requirement}',production_job_id='${job}'
      where foundry_batch_id='${shrinkBatch}' and billet_number=1;
  `);
  const issuedBefore = Number((await db.query(`select weight_kg from public.foundry_billets where foundry_batch_id='${shrinkBatch}' and billet_number=1`)).rows[0].weight_kg);
  await db.exec(`update public.foundry_batches set billet_count=2 where id='${shrinkBatch}';`);
  const afterShrink = (await db.query(`select b.billet_count as batch_billet_count,
      count(fb.id)::int as stock_rows,
      max(fb.weight_kg) filter (where fb.billet_number=1) as issued_weight,
      max(fb.status) filter (where fb.billet_number=1) as issued_status,
      max(fb.status) filter (where fb.billet_number=3) as surplus_status
    from public.foundry_batches b join public.foundry_billets fb on fb.foundry_batch_id=b.id
    where b.id='${shrinkBatch}' group by b.billet_count`)).rows[0];
  assert.equal(Number(afterShrink.batch_billet_count), 2);
  assert.equal(afterShrink.stock_rows, 3);
  assert.equal(afterShrink.issued_status, 'issued');
  assert.equal(Number(afterShrink.issued_weight), issuedBefore);
  assert.equal(afterShrink.surplus_status, 'cast');
  console.log(`P1 REPRODUCED: count-only batch edit changes 3 -> 2 but leaves 3 billet rows; in this fixture billet 3 remains cast outside the new count, and billet 1 remains issued at ${issuedBefore} kg.`);

  // Density-only reproduction uses separate issued and consumed rows. The
  // latest batch sync keeps each status while replacing its stored weight.
  await db.exec(`
    insert into public.foundry_batches(
      id,company_id,batch_number,furnace_number,batch_sequence,production_date,
      scrap_percentage,external_aluminium_percentage,furnace_efficiency_percent,
      alloy,temper,alloy_density_kg_m3,billet_length_mm,billet_diameter_inch,
      billet_diameter_mm,billet_count,status
    ) values ('${densityBatch}','${company}','FB-DENSITY','F1',4,'2026-10-04',
      0,100,80,'6063','T6',2700,1000,4,101.6,2,'cast');
    update public.foundry_billets set status='issued',order_id='${order}',
      allocation_requirement_id='${requirement}',production_job_id='${job}'
      where foundry_batch_id='${densityBatch}' and billet_number=1;
    update public.foundry_billets set status='consumed',order_id='${order}',
      allocation_requirement_id='${requirement}',production_job_id='${job}'
      where foundry_batch_id='${densityBatch}' and billet_number=2;
  `);
  const weightsBeforeDensityEdit = (await db.query(`select billet_number,weight_kg,status
    from public.foundry_billets where foundry_batch_id='${densityBatch}' order by billet_number`)).rows;
  await db.exec(`update public.foundry_batches set alloy_density_kg_m3=2800 where id='${densityBatch}';`);
  const weightsAfterDensityEdit = (await db.query(`select billet_number,weight_kg,status
    from public.foundry_billets where foundry_batch_id='${densityBatch}' order by billet_number`)).rows;
  assert.equal(weightsAfterDensityEdit.length, 2);
  for (const before of weightsBeforeDensityEdit) {
    const after = weightsAfterDensityEdit.find(row => row.billet_number === before.billet_number);
    assert.ok(after, `billet ${before.billet_number} remains present`);
    assert.equal(after.status, before.status);
    assert.notEqual(Number(after.weight_kg), Number(before.weight_kg));
  }
  assert.equal(weightsBeforeDensityEdit[0].status, 'issued');
  assert.equal(weightsBeforeDensityEdit[1].status, 'consumed');
  console.log(`P1 REPRODUCED: density-only batch edit (2700 -> 2800 kg/m3) changes stored weight on both an issued billet (${weightsBeforeDensityEdit[0].weight_kg} -> ${weightsAfterDensityEdit[0].weight_kg} kg) and a consumed billet (${weightsBeforeDensityEdit[1].weight_kg} -> ${weightsAfterDensityEdit[1].weight_kg} kg); both statuses remain unchanged.`);
  console.log('LIMIT: isolated PGlite fixture installs selected current trigger bodies and minimal tables; it omits the automatic billet-allocation trigger/helper, and refresh_order_billet_allocations is a no-op stub whose cancellation branch is not exercised. It does not replay the migration chain or prove authenticated/RLS reachability, concurrent behavior, browser UI, or production behavior.');
} finally {
  await db.close();
}

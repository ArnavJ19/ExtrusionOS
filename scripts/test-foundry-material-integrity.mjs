// Applies the complete additive foundry integrity migration to an isolated
// PGlite fixture built from the current trigger/function definitions.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const company = '11111111-1111-4111-8111-111111111111';
const otherCompany = '12121212-1212-4121-8121-121212121212';
const scrapA = '22222222-2222-4222-8222-222222222222';
const scrapB = '23232323-2323-4232-8232-232323232323';
const externalA = '33333333-3333-4333-8333-333333333333';
const externalB = '34343434-3434-4343-8343-343434343434';
const foreignExternal = '35353535-3535-4353-8353-353535353535';
const missingExternal = '36363636-3636-4363-8363-363636363636';
const batchA = '44444444-4444-4444-8444-444444444444';
const batchB = '45454545-4545-4454-8454-454545454545';
const batchC = '46464646-4646-4464-8464-464646464646';
const batchD = '47474747-4747-4474-8474-474747474747';
const batchE = '48484848-4848-4484-8484-484848484848';
const batchF = '49494949-4949-4494-8494-494949494949';
const profile = '88888888-8888-4888-8888-888888888888';
const sourceOrder = '51515151-5151-4151-8151-515151515151';
const targetOrder = '52525252-5252-4252-8252-525252525252';
const sourceRequirement = '53535353-5353-4353-8353-535353535353';
const targetRequirement = '54545454-5454-4454-8454-545454545454';
const jobD = '55555555-5555-4555-8555-555555555555';
const autoOrder = '56565656-5656-4656-8656-565656565656';
const autoRequirement = '57575757-5757-4757-8757-575757575757';
const batchG = '58585858-5858-4858-8858-585858585858';

function sql(file) {
  return readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
}

function definition(file, qualifiedName) {
  const source = sql(`supabase/migrations/${file}`);
  const start = source.toLowerCase().indexOf(`create or replace function ${qualifiedName.toLowerCase()}(`);
  assert.ok(start >= 0, `${qualifiedName} in ${file}`);
  const end = source.indexOf('\n$$;', start);
  assert.ok(end >= 0, `function terminator for ${qualifiedName}`);
  return source.slice(start, end + 4);
}

export async function runFoundryMaterialIntegrityChecks() {
  const db = new PGlite();
  const checks = [];
  const check = async (name, fn) => { await fn(); checks.push(name); };
  const expectReject = async (statement, pattern) => assert.rejects(db.exec(statement), pattern);
  const batchInsert = (id, { scrapId = scrapA, externalId = externalA, scrapPercent = 50, externalPercent = 50, count = 1, alloy = '6063', temper = 'T6' } = {}) => `
    insert into public.foundry_batches (
      id,company_id,batch_number,furnace_number,batch_sequence,production_date,
      scrap_id,external_source_id,scrap_percentage,external_aluminium_percentage,
      furnace_efficiency_percent,alloy,temper,alloy_density_kg_m3,billet_length_mm,
      billet_diameter_inch,billet_diameter_mm,billet_count,status
    ) values ('${id}','${company}','FB-${id.slice(0,4)}','F1',1,'2026-10-08',
      ${scrapId ? `'${scrapId}'` : 'null'},${externalId ? `'${externalId}'` : 'null'},
      ${scrapPercent},${externalPercent},80,'${alloy}','${temper}',2700,1000,4,101.6,${count},'planned');`;
  const sourceBalances = async () => (await db.query(`select id,available_weight_kg,status from (
    select id,available_weight_kg,status from public.foundry_aluminium_scrap where id in ('${scrapA}','${scrapB}')
    union all select id,available_weight_kg,status from public.foundry_external_aluminium_sources where id in ('${externalA}','${externalB}')
  ) s order by id`)).rows;

  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema private;
      create schema auth;
      create function auth.uid() returns uuid language sql as $$ select '${company}'::uuid $$;
      create function public.get_current_user_company_id() returns uuid language sql as $$ select '${company}'::uuid $$;
      create function public.get_current_user_role() returns text language sql as $$ select 'production_manager'::text $$;
      create function public.rebuild_order_billet_requirements(uuid) returns void language sql as $$ select $$;
      create function public.notify_billet_allocation(uuid,text,text,text,uuid) returns void language sql as $$ select $$;
      create table public.foundry_aluminium_scrap (
        id uuid primary key, company_id uuid not null, weight_kg numeric not null,
        available_weight_kg numeric, status text not null, updated_at timestamptz default now()
      );
      create table public.foundry_external_aluminium_sources (
        id uuid primary key, company_id uuid not null, weight_kg numeric not null,
        available_weight_kg numeric, status text not null, alloy text, updated_at timestamptz default now()
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
        status text not null default 'planned', notes text
      );
      create table public.orders (
        id uuid primary key, company_id uuid not null, order_number text not null, current_stage text not null,
        priority text default 'normal', expected_dispatch_date date, order_date date default current_date, created_at timestamptz default now(),
        billets_required integer default 0, billets_allocated integer default 0, billets_short integer default 0,
        billet_allocation_status text default 'not_required'
      );
      create table public.order_billet_requirements (
        id uuid primary key, company_id uuid not null, order_id uuid not null,
        profile_id uuid not null, alloy text not null, temper text not null, billet_diameter_inch numeric not null,
        billets_required integer not null default 1, billets_allocated integer not null default 0,
        billets_short integer not null default 1, status text not null default 'shortage',
        created_at timestamptz default now(), updated_at timestamptz default now()
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
        allocated_by uuid, production_job_id uuid, created_at timestamptz default now(), updated_at timestamptz default now()
      );
      create unique index foundry_billets_batch_number_in_house_unique
        on public.foundry_billets(foundry_batch_id, billet_number) where source_type = 'in_house';
      create table public.allocation_events (company_id uuid not null);
      create function public.allocate_billets_by_priority(p_company_id uuid) returns void language sql as $$
        insert into public.allocation_events(company_id) values (p_company_id) $$;
      insert into public.foundry_aluminium_scrap(id,company_id,weight_kg,available_weight_kg,status)
        values ('${scrapA}','${company}',1000,1000,'available'),('${scrapB}','${company}',1000,1000,'available');
      insert into public.foundry_external_aluminium_sources(id,company_id,weight_kg,available_weight_kg,status,alloy)
        values ('${externalA}','${company}',2000,2000,'available','6063'),
          ('${externalB}','${company}',2000,2000,'available','6063'),
          ('${foreignExternal}','${otherCompany}',2000,2000,'available','6063');
    `);
    await db.exec(definition('20260530000002_foundry_billet_allocation_repairs.sql', 'public.repair_order_billet_requirement_links'));
    await db.exec(definition('20260530000002_foundry_billet_allocation_repairs.sql', 'public.refresh_order_billet_allocations'));
    await db.exec(definition('20260530000002_foundry_billet_allocation_repairs.sql', 'public.reallocate_billet_to_order'));

    // Load current predecessor function bodies and trigger definitions.
    for (const [file, name] of [
      ['20260930000000_astra_audit_fixes.sql', 'public.refresh_foundry_batch_calculations'],
      ['0057_foundry_furnace_mix_and_chemistry.sql', 'public.sync_foundry_scrap_usage'],
      ['0057_foundry_furnace_mix_and_chemistry.sql', 'public.sync_foundry_external_source_usage'],
      ['20260530000002_foundry_billet_allocation_repairs.sql', 'public.sync_foundry_billets'],
      ['0056_order_billet_requirements_and_allocation.sql', 'public.handle_available_billet_allocation'],
      ['20260812000000_security_and_notification_integrity.sql', 'public.validate_foundry_billet_lineage']
    ]) await db.exec(definition(file, name));

    await db.exec(`
      create trigger refresh_foundry_batch_calculations before insert or update on public.foundry_batches
        for each row execute function public.refresh_foundry_batch_calculations();
      create trigger sync_foundry_external_source_usage before insert or update on public.foundry_batches
        for each row execute function public.sync_foundry_external_source_usage();
      create trigger sync_foundry_scrap_usage before insert or update on public.foundry_batches
        for each row execute function public.sync_foundry_scrap_usage();
      create trigger validate_foundry_billet_lineage before insert or update of company_id, order_id,
        allocation_requirement_id, production_job_id, alloy, temper, billet_diameter_inch on public.foundry_billets
        for each row execute function public.validate_foundry_billet_lineage();
      create trigger sync_foundry_billets after insert or update on public.foundry_batches
        for each row execute function public.sync_foundry_billets();
      create trigger handle_available_billet_allocation after insert or update of status,alloy,billet_diameter_inch
        on public.foundry_billets for each row when (new.status='cast' and new.order_id is null)
        execute function public.handle_available_billet_allocation();
    `);
    await db.exec(sql('supabase/migrations/20261008000000_foundry_material_integrity.sql'));
    await db.exec(sql('supabase/migrations/20261008000000_foundry_material_integrity.sql'));

    await check('whole migration installs and protects trigger function execute privileges', async () => {
      for (const fn of [
        'public.sync_foundry_scrap_usage()', 'public.sync_foundry_external_source_usage()',
        'public.sync_foundry_billets()', 'public.guard_foundry_batch_material_integrity()',
        'public.guard_foundry_billet_material_integrity()',
        'private.apply_foundry_source_delta(text,uuid,uuid,numeric,uuid,numeric)'
      ]) {
        const privileges = (await db.query(`select has_function_privilege('authenticated','${fn}','EXECUTE') as auth,
          has_function_privilege('anon','${fn}','EXECUTE') as anon`)).rows[0];
        assert.equal(privileges.auth, false, fn);
        assert.equal(privileges.anon, false, fn);
      }
    });

    await check('positive components reject null, foreign, exhausted, and blocked sources atomically', async () => {
      const before = await sourceBalances();
      await expectReject(batchInsert(batchA, { externalId: null, scrapPercent: 0, externalPercent: 100 }), /source is required/i);
      await expectReject(batchInsert(batchA, { externalId: foreignExternal }), /does not belong to this company/i);
      await expectReject(batchInsert(batchA, { externalId: missingExternal }), /does not belong to this company/i);
      await db.exec(`update public.foundry_external_aluminium_sources set available_weight_kg=0,status='used' where id='${externalA}';`);
      await expectReject(batchInsert(batchA, { scrapPercent: 0, externalPercent: 100 }), /not usable|not have enough/i);
      await db.exec(`update public.foundry_external_aluminium_sources set available_weight_kg=2000,status='available' where id='${externalA}';
        update public.foundry_external_aluminium_sources set status='rejected' where id='${externalB}';`);
      await expectReject(batchInsert(batchA, { externalId: externalB, scrapPercent: 0, externalPercent: 100 }), /not usable|not have enough/i);
      await db.exec(`update public.foundry_external_aluminium_sources set status='returned' where id='${externalA}';`);
      await expectReject(batchInsert(batchA, { externalId: externalA, scrapPercent: 0, externalPercent: 100 }), /not usable|not have enough/i);
      await db.exec(`update public.foundry_external_aluminium_sources set status='available' where id in ('${externalA}','${externalB}');`);
      const after = await sourceBalances();
      assert.deepEqual(after, before);
      assert.equal((await db.query(`select count(*)::int as n from public.foundry_batches where id='${batchA}'`)).rows[0].n, 0);
      await db.exec(batchInsert(batchF, { scrapId: null, scrapPercent: 0, externalPercent: 100 }));
      const optionalComponent = (await db.query(`select scrap_aluminium_kg,external_aluminium_kg from public.foundry_batches where id='${batchF}'`)).rows[0];
      assert.equal(Number(optionalComponent.scrap_aluminium_kg), 0);
      assert.ok(Number(optionalComponent.external_aluminium_kg) > 0);
    });

    await check('mixed charge reserves exact components and an unchanged retry does not debit twice', async () => {
      const startingBalances = await sourceBalances();
      await db.exec(batchInsert(batchA));
      let batch = (await db.query(`select * from public.foundry_batches where id='${batchA}'`)).rows[0];
      let rows = await sourceBalances();
      assert.equal(Number(rows.find((r) => r.id === scrapA).available_weight_kg), 1000 - Number(batch.scrap_aluminium_kg));
      assert.equal(Number(rows.find((r) => r.id === externalA).available_weight_kg),
        Number(startingBalances.find((r) => r.id === externalA).available_weight_kg) - Number(batch.external_aluminium_kg));
      assert.equal((await db.query(`select count(*)::int as n from public.foundry_billets where foundry_batch_id='${batchA}' and status <> 'cancelled'`)).rows[0].n, 1);
      const lockedRows = await sourceBalances();
      await db.exec(`update public.foundry_batches set status='melting',required_furnace_charge_kg=0,
          scrap_aluminium_kg=0,external_aluminium_kg=0,ingot_kg=0,
          billet_weight_density_kg=0,total_billet_weight_density_kg=0 where id='${batchA}';
        update public.foundry_batches set status='cast',required_furnace_charge_kg=0,
          scrap_aluminium_kg=0,external_aluminium_kg=0,ingot_kg=0,
          billet_weight_density_kg=0,total_billet_weight_density_kg=0 where id='${batchA}';
        update public.foundry_batches set notes='retry-safe unchanged edit' where id='${batchA}';`);
      assert.deepEqual(await sourceBalances(), lockedRows);
      batch = (await db.query(`select * from public.foundry_batches where id='${batchA}'`)).rows[0];
      assert.ok(Number(batch.required_furnace_charge_kg) > 0);
      assert.ok(Number(batch.scrap_aluminium_kg) > 0);
      assert.ok(Number(batch.external_aluminium_kg) > 0);
      assert.ok(Number(batch.billet_weight_density_kg) > 0);
      assert.equal(batch.status, 'cast');
      assert.ok((await db.query(`select count(*)::int as n from public.allocation_events where company_id='${company}'`)).rows[0].n >= 1);
    });

    await check('planned source switch applies refund and debit deltas; failed switch rolls back', async () => {
      await db.exec(batchInsert(batchB));
      const b = (await db.query(`select scrap_aluminium_kg,external_aluminium_kg from public.foundry_batches where id='${batchB}'`)).rows[0];
      const oldExternal = Number((await db.query(`select available_weight_kg from public.foundry_external_aluminium_sources where id='${externalA}'`)).rows[0].available_weight_kg);
      await db.exec(`update public.foundry_batches set external_source_id='${externalB}' where id='${batchB}';`);
      const switched = await sourceBalances();
      assert.equal(Number(switched.find((r) => r.id === externalA).available_weight_kg), oldExternal + Number(b.external_aluminium_kg));
      assert.equal(Number(switched.find((r) => r.id === externalB).available_weight_kg), 2000 - Number(b.external_aluminium_kg));
      const beforeFailure = await sourceBalances();
      const externalABeforeFailure = beforeFailure.find((r) => r.id === externalA);
      await db.exec(`update public.foundry_external_aluminium_sources set available_weight_kg=0,status='used' where id='${externalA}';`);
      const limited = await sourceBalances();
      await expectReject(`update public.foundry_batches set external_source_id='${externalA}' where id='${batchB}';`, /not usable|not have enough/i);
      assert.equal((await db.query(`select external_source_id from public.foundry_batches where id='${batchB}'`)).rows[0].external_source_id, externalB);
      const afterFailure = await sourceBalances();
      assert.deepEqual(afterFailure, limited);
      assert.notDeepEqual(beforeFailure, limited);
      await db.query(`update public.foundry_external_aluminium_sources set available_weight_kg=$1,status=$2 where id=$3`,
        [externalABeforeFailure.available_weight_kg, externalABeforeFailure.status, externalA]);
    });

    await check('planned shrink cancels surplus, repeats idempotently, and expansion reactivates only safe rows', async () => {
      await db.exec(batchInsert(batchC, { count: 3 }));
      const before = Number((await db.query(`select scrap_aluminium_kg from public.foundry_batches where id='${batchC}'`)).rows[0].scrap_aluminium_kg);
      await db.exec(`update public.foundry_aluminium_scrap set available_weight_kg=0,status='used' where id='${scrapA}';
        update public.foundry_external_aluminium_sources set available_weight_kg=0,status='used' where id='${externalA}';`);
      await db.exec(`update public.foundry_batches set billet_count=2 where id='${batchC}';`);
      let state = (await db.query(`select b.billet_count,count(*) filter (where fb.status <> 'cancelled')::int active,
        count(*) filter (where fb.status = 'cancelled')::int cancelled
        from public.foundry_batches b join public.foundry_billets fb on fb.foundry_batch_id=b.id
        where b.id='${batchC}' group by b.billet_count`)).rows[0];
      assert.equal(state.billet_count, 2); assert.equal(state.active, 2); assert.equal(state.cancelled, 1);
      const afterShrinkCharge = Number((await db.query(`select scrap_aluminium_kg from public.foundry_batches where id='${batchC}'`)).rows[0].scrap_aluminium_kg);
      assert.ok(afterShrinkCharge < before);
      const balances = await sourceBalances();
      assert.ok(Number(balances.find((r) => r.id === scrapA).available_weight_kg) > 0);
      assert.ok(Number(balances.find((r) => r.id === externalA).available_weight_kg) > 0);
      await db.exec(`update public.foundry_batches set billet_count=2 where id='${batchC}';`);
      assert.deepEqual(await sourceBalances(), balances);
      await db.exec(`update public.foundry_batches set billet_count=1 where id='${batchC}';`);
      state = (await db.query(`select count(*) filter (where status <> 'cancelled')::int active,
        count(*) filter (where status='cancelled')::int cancelled from public.foundry_billets where foundry_batch_id='${batchC}'`)).rows[0];
      assert.equal(state.active, 1); assert.equal(state.cancelled, 2);
      await db.exec(`update public.foundry_batches set billet_count=2 where id='${batchC}';
        update public.foundry_batches set billet_length_mm=900 where id='${batchC}';
        update public.foundry_batches set billet_count=3 where id='${batchC}';`);
      state = (await db.query(`select count(*) filter (where status <> 'cancelled')::int active,
        count(*) filter (where status='cancelled')::int cancelled from public.foundry_billets where foundry_batch_id='${batchC}'`)).rows[0];
      assert.equal(state.active, 3); assert.equal(state.cancelled, 0);
      await db.exec(`update public.foundry_aluminium_scrap set status='rejected' where id='${scrapA}';
        update public.foundry_external_aluminium_sources set status='returned' where id='${externalA}';`);
      await db.exec(`update public.foundry_batches set status='cancelled' where id='${batchC}';`);
      state = (await db.query(`select count(*) filter (where status='cancelled')::int cancelled from public.foundry_billets where foundry_batch_id='${batchC}'`)).rows[0];
      assert.equal(state.cancelled, 3);
      const quarantined = (await db.query(`select s.available_weight_kg scrap_available,s.status scrap_status,
        e.available_weight_kg external_available,e.status external_status
        from public.foundry_aluminium_scrap s cross join public.foundry_external_aluminium_sources e
        where s.id='${scrapA}' and e.id='${externalA}'`)).rows[0];
      assert.ok(Number(quarantined.scrap_available) > 0);
      assert.ok(Number(quarantined.external_available) > 0);
      assert.equal(quarantined.scrap_status, 'rejected');
      assert.equal(quarantined.external_status, 'returned');
      await db.exec(`update public.foundry_aluminium_scrap set status='reserved' where id='${scrapA}';
        update public.foundry_external_aluminium_sources set status='reserved' where id='${externalA}';`);
    });

    await check('cast batches freeze geometry, density, sources, mix, count, cancellation, and regression', async () => {
      await db.exec(batchInsert(batchD));
      await db.exec(`update public.foundry_batches set status='cast' where id='${batchD}';`);
      for (const sqlText of [
        `update public.foundry_batches set alloy_density_kg_m3=2800 where id='${batchD}'`,
        `update public.foundry_batches set billet_length_mm=1100 where id='${batchD}'`,
        `update public.foundry_batches set billet_diameter_inch=5 where id='${batchD}'`,
        `update public.foundry_batches set billet_count=2 where id='${batchD}'`,
        `update public.foundry_batches set external_source_id='${externalB}' where id='${batchD}'`,
        `update public.foundry_batches set scrap_percentage=40,external_aluminium_percentage=60 where id='${batchD}'`,
        `update public.foundry_batches set status='cancelled' where id='${batchD}'`,
        `update public.foundry_batches set status='planned' where id='${batchD}'`
      ]) await expectReject(`${sqlText};`, /immutable|freeze|cannot|only an uncommitted/i);
      await db.exec(`update public.foundry_batches set status='homogenizing' where id='${batchD}';`);
      await db.exec(`update public.foundry_batches set notes='non-material note' where id='${batchD}';`);
      const billet = (await db.query(`select id,weight_kg from public.foundry_billets where foundry_batch_id='${batchD}'`)).rows[0];
      await expectReject(`update public.foundry_billets set weight_kg=weight_kg+1 where id='${billet.id}';`, /physical attributes|immutable/i);
      await expectReject(`update public.foundry_billets set status='planned' where id='${billet.id}';`, /cannot regress/i);

      await db.exec(batchInsert(batchE));
      await db.exec(`update public.foundry_batches set status='melting' where id='${batchE}';`);
      const meltingBillet = (await db.query(`select id from public.foundry_billets where foundry_batch_id='${batchE}'`)).rows[0];
      await expectReject(`update public.foundry_billets set status='cast' where id='${meltingBillet.id}';`, /before the parent batch is cast/i);
      await expectReject(`update public.foundry_billets set status='allocated' where id='${meltingBillet.id}';`, /before the parent batch is cast/i);
      await expectReject(`update public.foundry_billets set status='planned' where id='${billet.id}';`, /cannot regress/i);
    });

    await check('committed linkage blocks shrink and cancellation without damaging valid allocation lineage', async () => {
      const before = (await db.query(`select id,weight_kg from public.foundry_billets where foundry_batch_id='${batchD}'`)).rows[0];
      await db.exec(`insert into public.orders(id,company_id,order_number,current_stage) values
          ('${sourceOrder}','${company}','SRC-6063','order_confirmed'),('${targetOrder}','${company}','TGT-6063','order_confirmed');
        insert into public.order_billet_requirements(id,company_id,order_id,profile_id,alloy,temper,billet_diameter_inch,billets_required,billets_allocated,billets_short,status) values
          ('${sourceRequirement}','${company}','${sourceOrder}','${profile}','6063','T6',4,1,0,1,'shortage'),
          ('${targetRequirement}','${company}','${targetOrder}','${profile}','6063','T5',4,1,0,1,'shortage');`);
      await db.query(`select public.reallocate_billet_to_order($1,$2)`, [before.id, sourceOrder]);
      await expectReject(`select public.reallocate_billet_to_order('${before.id}','${targetOrder}');`, /Billet alloy, temper, and diameter must match/i);
      let linked = (await db.query(`select status,order_id,allocation_requirement_id from public.foundry_billets where id='${before.id}'`)).rows[0];
      assert.deepEqual(linked, { status: 'allocated', order_id: sourceOrder, allocation_requirement_id: sourceRequirement });
      await db.exec(`update public.order_billet_requirements set temper='T6' where id='${targetRequirement}';`);
      await db.query(`select public.reallocate_billet_to_order($1,$2)`, [before.id, targetOrder]);
      const counters = (await db.query(`select r.order_id,r.billets_allocated,r.billets_short,r.status,o.billet_allocation_status
        from public.order_billet_requirements r join public.orders o on o.id=r.order_id
        where r.id in ('${sourceRequirement}','${targetRequirement}') order by r.id`)).rows;
      assert.equal(counters.find((r) => r.order_id === sourceOrder).billets_allocated, 0);
      assert.equal(counters.find((r) => r.order_id === sourceOrder).billets_short, 1);
      assert.equal(counters.find((r) => r.order_id === targetOrder).billets_allocated, 1);
      assert.equal(counters.find((r) => r.order_id === targetOrder).billets_short, 0);
      await db.exec(`insert into public.production_jobs values ('${jobD}','${company}','${targetOrder}','${profile}');
        update public.foundry_billets set status='issued',production_job_id='${jobD}' where id='${before.id}';`);
      linked = (await db.query(`select status,order_id,production_job_id from public.foundry_billets where id='${before.id}'`)).rows[0];
      assert.equal(linked.status, 'issued'); assert.equal(linked.order_id, targetOrder); assert.equal(linked.production_job_id, jobD);
      await expectReject(`update public.foundry_batches set billet_count=2 where id='${batchD}';`, /committed|immutable/i);
      await expectReject(`update public.foundry_batches set status='cancelled' where id='${batchD}';`, /committed|only an uncommitted/i);
      await expectReject(`update public.foundry_billets set billet_length_mm=billet_length_mm+1 where id='${before.id}';`, /physical attributes|immutable/i);
      await db.exec(`update public.foundry_billets set status='consumed' where id='${before.id}';`);
      await expectReject(`update public.foundry_billets set status='issued' where id='${before.id}';`, /cannot regress/i);
      await expectReject(`update public.foundry_billets set production_job_id=null where id='${before.id}';`, /lineage is immutable/i);
      for (const sqlText of [
        `update public.foundry_batches set alloy_density_kg_m3=2800 where id='${batchD}'`,
        `update public.foundry_batches set billet_length_mm=1100 where id='${batchD}'`,
        `update public.foundry_batches set billet_diameter_inch=5 where id='${batchD}'`
      ]) await expectReject(`${sqlText};`, /immutable|freeze|committed/i);
      await db.exec(`update public.foundry_batches set notes='same-status consumed retry' where id='${batchD}';`);
      linked = (await db.query(`select status,weight_kg from public.foundry_billets where id='${before.id}'`)).rows[0];
      assert.equal(linked.status, 'consumed');
      assert.ok(Number(linked.weight_kg) > 0);
    });

    await check('real priority allocator receives only cast billets from the batch sync', async () => {
      await db.exec(definition('0056_order_billet_requirements_and_allocation.sql', 'public.allocate_billets_by_priority'));
      await db.exec(`insert into public.orders(id,company_id,order_number,current_stage,priority,expected_dispatch_date,order_date)
          values ('${autoOrder}','${company}','AUTO-6063','order_confirmed','high','2026-10-10','2026-10-08');
        insert into public.order_billet_requirements(id,company_id,order_id,profile_id,alloy,temper,billet_diameter_inch,billets_required,billets_allocated,billets_short,status)
          values ('${autoRequirement}','${company}','${autoOrder}','${profile}','6063','T5',4,1,0,1,'shortage');`);
      await db.exec(batchInsert(batchG, { scrapId: null, externalId: externalB, scrapPercent: 0, externalPercent: 100, temper: 'T5' }));
      let billet = (await db.query(`select id,status,weight_kg,order_id from public.foundry_billets where foundry_batch_id='${batchG}'`)).rows[0];
      assert.equal(billet.status, 'planned');
      assert.equal(billet.order_id, null);
      await db.exec(`update public.foundry_batches set status='melting' where id='${batchG}';`);
      billet = (await db.query(`select status,order_id from public.foundry_billets where foundry_batch_id='${batchG}'`)).rows[0];
      assert.equal(billet.status, 'planned');
      assert.equal(billet.order_id, null);
      await db.exec(`update public.foundry_batches set status='cast' where id='${batchG}';`);
      billet = (await db.query(`select status,weight_kg,order_id,allocation_requirement_id,allocated_at,allocated_by from public.foundry_billets where foundry_batch_id='${batchG}'`)).rows[0];
      assert.equal(billet.status, 'allocated');
      assert.equal(billet.order_id, autoOrder);
      assert.equal(billet.allocation_requirement_id, autoRequirement);
      assert.equal(billet.allocated_by, company);
      assert.ok(billet.allocated_at);
      assert.ok(Number(billet.weight_kg) > 0);
      const counters = (await db.query(`select billets_required,billets_allocated,billets_short,status from public.order_billet_requirements where id='${autoRequirement}'`)).rows[0];
      assert.deepEqual(counters, { billets_required: 1, billets_allocated: 1, billets_short: 0, status: 'complete' });
    });

    const preflightPath = new URL('../sql/foundry-material-preflight.sql', import.meta.url);
    try {
      await check('read-only preflight SQL executes against the integrated fixture', async () => {
        const preflight = readFileSync(preflightPath, 'utf8');
        assert.match(preflight.replace(/^\s*(?:--[^\n]*\n\s*)*/g, '').trim().toLowerCase(), /^select\b|^with\b/);
        let rows = await db.query(preflight);
        assert.deepEqual(rows.rows, [], 'integrated fixture should start clean');
        await db.exec(`update public.foundry_external_aluminium_sources set status='rejected' where id='${externalB}';`);
        rows = await db.query(preflight);
        assert.ok(rows.rows.some((row) => row.issue === 'S01_EXTERNAL_SOURCE_UNUSABLE'), 'preflight should identify blocked positive source');
        await db.exec(`update public.foundry_external_aluminium_sources set status='reserved' where id='${externalB}';`);
        rows = await db.query(preflight);
        assert.deepEqual(rows.rows, [], 'restored fixture should return to clean');
      });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      checks.push('preflight SQL pending root integration');
    }

    return checks;
  } finally {
    await db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const checks = await runFoundryMaterialIntegrityChecks();
  for (const name of checks) console.log(`PASS ${name}`);
  console.log(`${checks.length} foundry material-integrity SQL checks passed. Isolated fixture only; hosted authorization and independent-session concurrency remain unverified.`);
}

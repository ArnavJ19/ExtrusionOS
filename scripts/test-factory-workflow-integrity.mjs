import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import {installOrderCancellationStockObjects} from "./lib/order-cancellation-stock-fixture.mjs";
import {installManualBilletAllocationObjects} from "./lib/manual-billet-allocation-fixture.mjs";

const company = "11111111-1111-4111-8111-111111111111";
const user = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const profile = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const job = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const billet = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const inspection = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const stock = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const reservation = "12121212-1212-4212-8212-121212121212";
const dispatch = "13131313-1313-4313-8313-131313131313";
const finishJob = "16161616-1616-4616-8616-161616161616";
const finishBillet = "17171717-1717-4717-8717-171717171717";
const partialStock = "18181818-1818-4818-8818-181818181818";
const partialReservation = "19191919-1919-4919-8919-191919191919";
const rollbackStockA = "21212121-2121-4121-8121-212121212121";
const rollbackStockB = "22222222-2222-4222-8222-222222222223";
const rollbackReservationA = "23232323-2323-4323-8323-232323232323";
const rollbackReservationB = "24242424-2424-4424-8424-242424242424";
const rollbackDispatch = "25252525-2525-4525-8525-252525252525";
const creditDispatch = "28282828-2828-4828-8828-282828282828";
const invoiceId = "29292929-2929-4929-8929-292929292929";
const creditKey = "30303030-3030-4030-8030-303030303030";
const orderBalance = "31313131-3131-4131-8131-313131313131";
const orderLine = "32323232-3232-4232-8232-323232323232";
const balanceJob = "33333333-3333-4333-8333-333333333333";
const balanceBillet = "34343434-3434-4434-8434-343434343434";
const dieId = "35353535-3535-4535-8535-353535353535";
const pressId = "36363636-3636-4636-8636-363636363636";
const allocationOrder = "39393939-3939-4939-8939-393939393939";
const previousOrder = "40404040-4040-4040-8040-404040404040";
const allocationRequirement = "41414141-4141-4141-8141-414141414141";
const incompatibleRequirement = "42424242-4242-4242-8242-424242424242";
const allocationBillet = "43434343-4343-4343-8343-434343434343";
const reallocationBillet = "44444444-4444-4444-8444-444444444444";
const repoSql = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
function functionDefinition(path, qualifiedName) {
  const source = repoSql(path);
  const start = source.toLowerCase().indexOf(`create or replace function ${qualifiedName.toLowerCase()}(`);
  assert.ok(start >= 0, `${qualifiedName} must exist in ${path}`);
  const end = source.indexOf("\n$$;", start);
  assert.ok(end >= 0, `function terminator for ${qualifiedName}`);
  return source.slice(start, end + 4);
}

export async function runFactoryWorkflowIntegrityChecks() {
  const db = new PGlite();
  const checks = [];
  const check = async (name, fn) => { await fn(); checks.push(name); };
  const reject = (sql, pattern) => assert.rejects(db.exec(sql), pattern);
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema private;
      grant usage on schema private to authenticated;
      create table auth.users(id uuid primary key);
      insert into auth.users values ('${user}');
      create function auth.uid() returns uuid language sql as $$ select '${user}'::uuid $$;
      create function private.get_current_user_company_id() returns uuid language sql as $$ select '${company}'::uuid $$;
      create function private.get_current_user_role() returns text language sql as $$ select coalesce(current_setting('test.role',true),'production_manager') $$;
      create function public.get_current_user_company_id() returns uuid language sql as $$ select '${company}'::uuid $$;
      create function public.get_current_user_role() returns text language sql as $$ select coalesce(current_setting('test.role',true),'production_manager') $$;
      create table public.companies(id uuid primary key);
      create table public.aluminium_profiles(id uuid primary key, company_id uuid, profile_code text, profile_name text, alloy text, temper text, billet_diameter_required_inch numeric);
      create table public.orders(id uuid primary key, company_id uuid, current_stage text, production_quantity_kg numeric, manufacturing_weight_kg numeric, production_profile_id uuid, production_die_id uuid, billet_diameter_required_inch numeric, quote_id uuid, order_number text, priority text, expected_dispatch_date date, order_date date, created_at timestamptz default now(), updated_at timestamptz default now(), billet_allocation_status text, billets_required integer default 0, billets_allocated integer default 0, billets_short integer default 0);
      create table public.order_items(id uuid primary key, company_id uuid, order_id uuid, quantity_kg numeric);
      create table public.order_billet_requirements(id uuid primary key default gen_random_uuid(), company_id uuid, order_id uuid, profile_id uuid, alloy text, temper text, billet_diameter_inch numeric, billet_length_mm numeric, required_weight_kg numeric, billet_weight_kg numeric, extrusion_efficiency_percent numeric, billets_required integer, billets_allocated integer default 0, billets_short integer default 0, status text default 'pending', created_at timestamptz default now(), updated_at timestamptz default now(), unique(company_id,order_id,profile_id,alloy,temper,billet_diameter_inch));
      create table public.order_dealer_stock_fulfillments(id uuid primary key, company_id uuid, order_id uuid, order_item_id uuid, fulfilled_weight_kg numeric, fulfilled_length_m numeric, fulfilled_pieces integer, credited_at timestamptz, profile_id uuid);
      create table public.production_jobs(id uuid primary key, company_id uuid, order_id uuid, profile_id uuid, die_id uuid, machine_id uuid, source_line_id uuid, status text, planned_quantity_kg numeric, actual_quantity_kg numeric, actual_pieces integer, actual_meters numeric, pieces integer, length_per_piece_m numeric, job_number text, required_billet_count integer, finishing_type text, remarks text, updated_at timestamptz default now(), planned_date date, shift text);
      create table public.foundry_aluminium_scrap(id uuid primary key, company_id uuid, weight_kg numeric, available_weight_kg numeric, status text, updated_at timestamptz default now());
      create table public.foundry_external_aluminium_sources(id uuid primary key, company_id uuid, weight_kg numeric, available_weight_kg numeric, status text, alloy text, updated_at timestamptz default now());
      create table public.foundry_batches(id uuid primary key, company_id uuid, batch_number text, furnace_number text, furnace_name text, batch_sequence integer, production_date date, scrap_id uuid, external_source_id uuid, scrap_percentage numeric, external_aluminium_percentage numeric, furnace_efficiency_percent numeric, required_furnace_charge_kg numeric, scrap_aluminium_kg numeric, external_aluminium_kg numeric, ingot_kg numeric, alloy text, temper text, alloy_density_kg_m3 numeric, billet_length_mm numeric, billet_diameter_inch numeric, billet_diameter_mm numeric, billet_count integer, billet_weight_density_kg numeric, total_billet_weight_density_kg numeric, alloy_composition_default jsonb, alloy_composition_actual jsonb, alloy_composition_altered boolean, status text, notes text, updated_at timestamptz default now());
      create table public.foundry_billets(id uuid primary key default gen_random_uuid(), company_id uuid, production_job_id uuid, order_id uuid, allocation_requirement_id uuid, foundry_batch_id uuid, source_type text, billet_code text, billet_number integer, status text, weight_kg numeric, updated_at timestamptz default now(), alloy text, temper text, billet_diameter_inch numeric, billet_diameter_mm numeric, billet_length_mm numeric, allocated_at timestamptz, allocated_by uuid, created_at timestamptz default now());
      create unique index foundry_billets_batch_number_in_house_unique on public.foundry_billets(foundry_batch_id,billet_number) where source_type='in_house';
      create table public.scrap_records(id uuid primary key default gen_random_uuid(), company_id uuid, order_id uuid, production_job_id uuid, profile_id uuid, die_id uuid, weight_kg numeric, scrap_type text, reason text, recorded_date date, recorded_by uuid, notes text);
      create table public.profile_stock_batches(id uuid primary key, company_id uuid, profile_id uuid, total_weight_kg numeric, length_m numeric, quantity_pieces integer, status text);
      create table public.profile_stock_reservations(id uuid primary key, company_id uuid, profile_stock_batch_id uuid, profile_id uuid, order_id uuid, configuration_id uuid, reserved_weight_kg numeric, reserved_length_m numeric, reserved_pieces integer, status text, released_at timestamptz);
      create table public.profile_stock_consumptions(id uuid primary key default gen_random_uuid(), company_id uuid, reservation_id uuid, profile_stock_batch_id uuid, profile_id uuid, order_id uuid, dispatch_id uuid, consumed_weight_kg numeric, consumed_length_m numeric, consumed_pieces integer, notes text, created_by uuid);
      create table public.packing_list_items(id uuid primary key default gen_random_uuid(), company_id uuid, dispatch_id uuid, source_kind text, source_record_id uuid, source_line_id uuid, reservation_id uuid, profile_stock_batch_id uuid, profile_id uuid, bundle_number text, net_weight_kg numeric, net_length_m numeric, number_of_pieces integer, gross_weight_kg numeric, tare_weight_kg numeric, operator_verified_at timestamptz, operator_verified_by uuid);
      create table public.dispatches(id uuid primary key default gen_random_uuid(), company_id uuid, order_id uuid, delivery_status text default 'pending', dispatch_number text, dispatch_date date, total_weight_kg numeric, total_tare_weight_kg numeric, updated_at timestamptz default now(), number_of_bundles integer, created_by uuid, remarks text, proof_of_delivery_url text);
      create table public.dispatch_status_history(id uuid primary key, company_id uuid, dispatch_id uuid, to_status text, changed_at timestamptz default now());
      create table public.order_stage_history(id uuid primary key default gen_random_uuid(), company_id uuid, order_id uuid, stage text, changed_by uuid, remarks text);
      create table public.feature_flags(company_id uuid, module_name text, is_enabled boolean);
      create table public.invoices(id uuid primary key, company_id uuid, dispatch_id uuid, subtotal numeric, tax_total numeric, grand_total numeric, status text, amount_paid numeric default 0, credited_amount numeric default 0, paid_date date, due_date date, updated_at timestamptz default now());
      create table public.invoice_items(id uuid primary key default gen_random_uuid(), company_id uuid, invoice_id uuid, description text, quantity numeric, unit_price numeric, total numeric);
      create table public.credit_notes(id uuid primary key default gen_random_uuid(), company_id uuid, invoice_id uuid, dispatch_id uuid, credit_note_number text, credit_date date, reason text, subtotal numeric, tax_total numeric, grand_total numeric, status text, item_snapshot jsonb, idempotency_key uuid, reversed_at timestamptz, reversed_by uuid, reversal_reason text, created_by uuid, created_at timestamptz default now(), updated_at timestamptz default now());
      create unique index credit_notes_company_dispatch_fixture_idx on public.credit_notes(company_id,dispatch_id) where status='issued';
      create unique index credit_notes_company_key_fixture_idx on public.credit_notes(company_id,idempotency_key);
      create table public.payments(id uuid primary key default gen_random_uuid(), company_id uuid, invoice_id uuid, payment_status text, payment_type text, amount numeric, payment_date date);
      create table public.audit_logs(id uuid primary key default gen_random_uuid(), company_id uuid, actor_id uuid, action text, entity_type text, entity_id uuid, metadata_json jsonb);
      create table public.production_plan_slots(id uuid primary key default gen_random_uuid(), company_id uuid, production_job_id uuid, machine_id uuid, status text, planned_start_at timestamptz, planned_end_at timestamptz, shift text, sequence_number integer, capacity_kg numeric, locked_by uuid, locked_at timestamptz, created_by uuid, updated_at timestamptz default now());
      create table public.dies(id uuid primary key, company_id uuid, profile_id uuid, billet_diameter_required_inch numeric, die_status text);
      create table public.machines(id uuid primary key, company_id uuid, machine_type text, is_active boolean, status text, machine_name text);
      create table public.production_job_status_history(id uuid primary key default gen_random_uuid(), company_id uuid, production_job_id uuid, previous_status text, new_status text, reason text, changed_by uuid, changed_by_role text);
      create table public.finishing_jobs(id uuid primary key default gen_random_uuid(), company_id uuid, order_id uuid, production_job_id uuid, input_weight_kg numeric, output_weight_kg numeric, rejection_weight_kg numeric, status text, finishing_type text, planned_date date, remarks text, updated_at timestamptz default now());
      create table public.packaging_jobs(id uuid primary key default gen_random_uuid(), company_id uuid, order_id uuid, production_job_id uuid, packaging_number text, material_id uuid, scheduled_date date, pieces integer, profile_weight_kg numeric, profile_length_m numeric, status text, notes text, created_by uuid, updated_at timestamptz default now());
      create unique index packaging_jobs_company_number_fixture_idx on public.packaging_jobs(company_id, packaging_number);
      create table public.packaging_material_movements(id uuid primary key default gen_random_uuid(), company_id uuid, packaging_job_id uuid);
      create table public.quality_inspections(id uuid primary key default gen_random_uuid(), company_id uuid, production_job_id uuid, finishing_job_id uuid, profile_id uuid, inspection_date timestamptz, batch_number text, quantity_checked_kg numeric, status text, inspector_name text, surface_finish_ok boolean, notes text, resolution_id uuid, updated_at timestamptz default now());
      create function public.rebuild_order_billet_requirements(uuid) returns void language sql as $$ select null::void $$;
      create function public.refresh_order_billet_allocations(uuid) returns void language sql as $$ select null::void $$;
      create function public.notify_billet_allocation(uuid,text,text,text,uuid) returns void language sql as $$ select null::void $$;
      create function private.advance_order_stage(uuid,uuid,text,text) returns void language sql as $$ select null::void $$;
      create function private.next_business_number_locked(regclass,text,uuid,text,date) returns text language sql as $$ select 'CN-TEST'::text $$;
    `);
    await db.exec(`insert into public.companies values ('${company}');
      insert into public.foundry_aluminium_scrap(id,company_id,weight_kg,available_weight_kg,status) values ('71717171-7171-4171-8171-717171717171','${company}',1000,1000,'available');
      insert into public.foundry_external_aluminium_sources(id,company_id,weight_kg,available_weight_kg,status,alloy) values ('72727272-7272-4272-8272-727272727272','${company}',1000,1000,'available','6063');
      insert into public.aluminium_profiles values ('${profile}','${company}','P-1','Profile One','6063','T6',5);
      insert into public.production_jobs(id,company_id,status,planned_quantity_kg,actual_quantity_kg,actual_pieces,actual_meters,job_number,finishing_type)
      values ('${job}','${company}','in_progress',100,0,0,0,'JOB-INITIAL','mill_finish'),
        ('${finishJob}','${company}','in_progress',100,0,0,0,'JOB-FINISH','powder_coating');`);
    const atomicWorkflowPath = "supabase/migrations/20260715000000_atomic_business_workflows.sql";
    await db.exec(functionDefinition(atomicWorkflowPath, "private.keep_jsonb_keys"));
    await db.exec(functionDefinition(atomicWorkflowPath, "private.insert_jsonb_row"));
    await db.exec(functionDefinition(atomicWorkflowPath, "private.update_jsonb_row"));
    await db.exec(functionDefinition("supabase/migrations/20260723060000_exact_dispatch_manifest_and_consolidation.sql", "private.save_dispatch_atomic"));
    await db.exec(functionDefinition("supabase/migrations/20260721091307_physical_dispatch_stock_provenance.sql", "private.assert_dispatch_ready"));
    await db.exec(functionDefinition("supabase/migrations/20260718021000_dispatch_readiness_and_delivery.sql", "private.sync_order_delivery_stage"));
    await db.exec(functionDefinition("supabase/migrations/20260723070000_dispatch_return_credit_notes.sql", "private.recalculate_invoice_collection_state"));
    await db.exec(functionDefinition("supabase/migrations/20260723070000_dispatch_return_credit_notes.sql", "private.issue_dispatch_return_credit_note_atomic"));
    await db.exec(functionDefinition("supabase/migrations/20260723070000_dispatch_return_credit_notes.sql", "private.reverse_credit_note_atomic"));
    await db.exec(`revoke all on function private.issue_dispatch_return_credit_note_atomic(uuid,text,uuid) from public,anon,authenticated;
      revoke all on function private.reverse_credit_note_atomic(uuid,text) from public,anon,authenticated;`);
    await db.exec(functionDefinition("supabase/migrations/20260718021500_floor_output_and_finishing_workflows.sql", "private.complete_production_job_atomic"));
    await db.exec(functionDefinition("supabase/migrations/20260718020500_finishing_route_and_quality_yield.sql", "public.link_billets_to_production_job"));
    const migration = readFileSync(new URL("../supabase/migrations/20261008020000_factory_workflow_integrity.sql", import.meta.url), "utf8");
    try { await db.exec(migration); }
    catch (error) {
      const position = Number(error.position ?? error.cause?.position ?? 0);
      throw new Error(`${error.message}; SQL context: ${migration.slice(Math.max(0, position - 100), position + 100)}`);
    }
    await db.exec(migration);
    // Inspect the prepared follow-up body without applying its migration script.
    await db.exec(functionDefinition("supabase/migrations/20261015000000_reservation_release_replay_integrity.sql", "private.consume_dispatch_reservations"));
    await installOrderCancellationStockObjects(db,{reservationGuardOnly:true});
    await installManualBilletAllocationObjects(db);
    await db.exec(`create trigger factory_fixture_link_billets_to_production_job after update of status on public.production_jobs
      for each row when (new.status='completed') execute function public.link_billets_to_production_job();`);

    await check("direct completed status spoof is rejected", async () => {
      await reject(`update public.production_jobs set status='completed',actual_quantity_kg=95 where id='${job}'`, /validated completion workflow/i);
    });
    await check("actual completion preserves issued billet consumption and balanced scrap atomically", async () => {
      await db.exec(`insert into public.foundry_billets(id,company_id,production_job_id,status,weight_kg) values ('${billet}','${company}','${job}','issued',100)`);
      await db.query(`select public.complete_production_job_atomic($1,95,10,50,5,'normal completion')`, [job]);
      const result = await db.query(`select j.status,j.actual_quantity_kg,b.status billet_status,(select sum(weight_kg) from public.scrap_records where production_job_id=j.id) scrap from public.production_jobs j join public.foundry_billets b on b.production_job_id=j.id where j.id=$1`, [job]);
      assert.deepEqual({ ...result.rows[0], actual_quantity_kg: Number(result.rows[0].actual_quantity_kg), scrap: Number(result.rows[0].scrap) },
        { status: "completed", actual_quantity_kg: 95, billet_status: "consumed", scrap: 5 });
    });
    await check("completed output correction is audited and keeps mass balance", async () => {
      await db.query(`select public.correct_completed_production_output_atomic($1,94,10,50,'scale correction')`, [job]);
      const result = await db.query(`select actual_quantity_kg from public.production_jobs where id=$1`, [job]);
      assert.equal(Number(result.rows[0].actual_quantity_kg), 94);
      const count = await db.query(`select count(*)::int n from public.production_output_corrections where production_job_id=$1`, [job]);
      assert.equal(count.rows[0].n, 1);
      const packageRow = await db.query(`select profile_weight_kg,pieces,profile_length_m from public.packaging_jobs where production_job_id=$1`, [job]);
      assert.deepEqual({ weight: Number(packageRow.rows[0].profile_weight_kg), pieces: packageRow.rows[0].pieces, metres: Number(packageRow.rows[0].profile_length_m) },
        { weight: 94, pieces: 10, metres: 50 });
    });
    await check("completed correction reconciles the actual planned finishing handoff", async () => {
      await db.exec(`update public.production_jobs set pieces=4 where id='${finishJob}';
        insert into public.foundry_billets(id,company_id,production_job_id,status,weight_kg) values ('${finishBillet}','${company}','${finishJob}','issued',100);`);
      await db.query(`select public.complete_production_job_atomic($1,95,4,20,5,'finishing completion')`, [finishJob]);
      await db.query(`select public.correct_completed_production_output_atomic($1,94,4,19,'verified scale correction')`, [finishJob]);
      const result = await db.query(`select input_weight_kg,status from public.finishing_jobs where production_job_id=$1`, [finishJob]);
      assert.equal(Number(result.rows[0].input_weight_kg), 94);
      assert.equal(result.rows[0].status, "planned");
    });
    await check("dispatch actual activation cannot be caller forged", async () => {
      await db.exec(`insert into public.dispatches(id,company_id,order_id,delivery_status) values ('${dispatch}','${company}','${job}','pending')`);
      await reject(`update public.dispatches set delivery_status='dispatched' where id='${dispatch}'`, /verified stock posting workflow/i);
      await reject(`update public.dispatches set actual_dispatched_at=now() where id='${dispatch}'`, /immutable/i);
    });
    await check("reservation snapshots are exact and consumed reservations cannot reactivate", async () => {
      const order = "14141414-1414-4414-8414-141414141414";
      await db.exec(`insert into public.orders(id,company_id,current_stage) values ('${order}','${company}','in_production');
        insert into public.profile_stock_batches(id,company_id,profile_id,total_weight_kg,length_m,quantity_pieces,status) values ('${stock}','${company}','${profile}',50,25,5,'available');
        insert into public.profile_stock_reservations(id,company_id,profile_stock_batch_id,profile_id,order_id,reserved_weight_kg,reserved_length_m,reserved_pieces,status) values ('${reservation}','${company}','${stock}','${profile}','${order}',50,25,5,'active');
        insert into public.profile_stock_consumptions(company_id,reservation_id,profile_stock_batch_id,profile_id,order_id,consumed_weight_kg,consumed_length_m,consumed_pieces) values ('${company}','${reservation}','${stock}','${profile}','${order}',50,25,5);
        update public.profile_stock_reservations set status='consumed' where id='${reservation}';`);
      await reject(`update public.profile_stock_reservations set status='active' where id='${reservation}'`, /terminal|consumed/i);
      const mismatchBatch = "50505050-5050-4050-8050-505050505050";
      const mismatchReservation = "49494949-4949-4949-8949-494949494949";
      await db.exec(`insert into public.profile_stock_batches(id,company_id,profile_id,total_weight_kg,length_m,quantity_pieces,status) values ('${mismatchBatch}','${company}','${profile}',50,25,5,'available');`);
      await reject(`insert into public.profile_stock_reservations(id,company_id,profile_stock_batch_id,profile_id,order_id,reserved_weight_kg,reserved_length_m,reserved_pieces,status) values ('${mismatchReservation}','${company}','${mismatchBatch}','${profile}','${order}',1,1,5,'active')`, /whole-piece source ratio/i);
    });
    await check("partial dispatch reservation consumption is exact and idempotent", async () => {
      const order = "26262626-2626-4626-8626-262626262626";
      await db.query(`select set_config('test.role','dispatch_manager',false)`);
      await db.exec(`insert into public.orders(id,company_id,current_stage,production_quantity_kg) values ('${order}','${company}','in_production',50);
        insert into public.profile_stock_batches(id,company_id,profile_id,total_weight_kg,length_m,quantity_pieces,status) values ('${partialStock}','${company}','${profile}',50,25,5,'available');
        insert into public.profile_stock_reservations(id,company_id,profile_stock_batch_id,profile_id,order_id,reserved_weight_kg,reserved_length_m,reserved_pieces,status) values ('${partialReservation}','${company}','${partialStock}','${profile}','${order}',50,25,5,'active');`);
      const dispatchAcl = await db.query(`select has_function_privilege('authenticated','public.save_ready_dispatch_atomic(uuid,jsonb,jsonb)','EXECUTE') public_save,
        has_function_privilege('authenticated','private.save_ready_dispatch_atomic(uuid,jsonb,jsonb)','EXECUTE') private_save,
        has_function_privilege('authenticated','public.transition_dispatch_delivery_atomic(uuid,text,text,text)','EXECUTE') public_transition`);
      assert.deepEqual(dispatchAcl.rows[0], { public_save: true, private_save: false, public_transition: true });
      await db.exec(`set role authenticated`);
      const dispatched = await db.query(`select public.save_ready_dispatch_atomic(null,$1::jsonb,$2::jsonb) id`, [
        JSON.stringify({ order_id: order, dispatch_date: "2026-10-09", total_weight_kg: 10, total_tare_weight_kg: 1 }),
        JSON.stringify([{ source_kind: "reservation", source_record_id: order, source_line_id: partialReservation, reservation_id: partialReservation,
          profile_stock_batch_id: partialStock, profile_id: profile, bundle_number: "SCAN-1", net_weight_kg: 10, net_length_m: 5,
          number_of_pieces: 1, gross_weight_kg: 11, tare_weight_kg: 1 }])
      ]);
      await db.query(`select set_config('test.role','production_manager',false)`);
      await reject(`select public.save_ready_dispatch_atomic(null,'{}'::jsonb,'[]'::jsonb)`, /permission denied for dispatches/i);
      await db.query(`select set_config('test.role','dispatch_manager',false)`);
      await db.exec(`reset role`);
      const postedDispatch = dispatched.rows[0].id;
      await db.query(`select private.consume_dispatch_reservations($1)`, [postedDispatch]);
      await db.query(`select private.consume_dispatch_reservations($1)`, [postedDispatch]);
      const state = await db.query(`select b.total_weight_kg,b.length_m,b.quantity_pieces,
        (select count(*)::int from public.profile_stock_consumptions where dispatch_id=$1) entries,
        (select actual_dispatched_at is not null from public.dispatches where id=$1) activated
        from public.profile_stock_batches b where b.id=$2`, [postedDispatch, partialStock]);
      assert.deepEqual({ ...state.rows[0], total_weight_kg: Number(state.rows[0].total_weight_kg), length_m: Number(state.rows[0].length_m) },
        { total_weight_kg: 40, length_m: 20, quantity_pieces: 4, entries: 1, activated: true });
      await db.exec(`set role authenticated`);
      const consumptionTotals = await db.query(`select * from public.get_profile_stock_consumption_totals(array[$1::uuid])`, [partialReservation]);
      assert.deepEqual({
        reservation_id: consumptionTotals.rows[0].reservation_id,
        consumed_weight_kg: Number(consumptionTotals.rows[0].consumed_weight_kg),
        consumed_length_m: Number(consumptionTotals.rows[0].consumed_length_m),
        consumed_pieces: consumptionTotals.rows[0].consumed_pieces
      }, { reservation_id: partialReservation, consumed_weight_kg: 10, consumed_length_m: 5, consumed_pieces: 1 });
      await db.exec(`reset role`);
      await db.exec(`insert into public.dispatches(id,company_id,order_id,delivery_status)
        select gen_random_uuid(),'${company}','${order}','pending' from generate_series(1,1001);
        insert into public.profile_stock_consumptions(company_id,reservation_id,profile_stock_batch_id,profile_id,order_id,dispatch_id,consumed_weight_kg,consumed_length_m,consumed_pieces)
        select '${company}','${partialReservation}','${partialStock}','${profile}','${order}',d.id,0.001,0.001,0
        from public.dispatches d where d.company_id='${company}' and d.order_id='${order}' and d.id not in
          (select dispatch_id from public.profile_stock_consumptions where reservation_id='${partialReservation}');`);
      await db.exec(`set role authenticated`);
      const beyondApiPage = await db.query(`select consumed_weight_kg,consumed_length_m,consumed_pieces
        from public.get_profile_stock_consumption_totals(array[$1::uuid])`, [partialReservation]);
      assert.deepEqual({
        consumed_weight_kg: Number(beyondApiPage.rows[0].consumed_weight_kg),
        consumed_length_m: Number(beyondApiPage.rows[0].consumed_length_m),
        consumed_pieces: beyondApiPage.rows[0].consumed_pieces
      }, { consumed_weight_kg: 11.001, consumed_length_m: 6.001, consumed_pieces: 1 });
      await reject(`select * from public.get_profile_stock_consumption_totals(array['57575757-5757-4757-8757-575757575757'::uuid])`, /reservation not found for current company/i);
      await db.exec(`reset role`);
      const remainderStock = "53535353-5353-4353-8353-535353535353";
      const remainderReservation = "54545454-5454-4454-8454-545454545454";
      await db.exec(`insert into public.profile_stock_batches(id,company_id,profile_id,total_weight_kg,length_m,quantity_pieces,status) values ('${remainderStock}','${company}','${profile}',50,25,5,'available');
        insert into public.profile_stock_reservations(id,company_id,profile_stock_batch_id,profile_id,order_id,reserved_weight_kg,reserved_length_m,reserved_pieces,status) values ('${remainderReservation}','${company}','${remainderStock}','${profile}','${order}',30,15,3,'active');`);
      await db.exec(`set role authenticated`);
      const partial = await db.query(`select public.save_ready_dispatch_atomic(null,$1::jsonb,$2::jsonb) id`, [
        JSON.stringify({ order_id: order, dispatch_date: "2026-10-09", total_weight_kg: 10, total_tare_weight_kg: 1 }),
        JSON.stringify([{ source_kind: "reservation", source_record_id: order, source_line_id: remainderReservation, reservation_id: remainderReservation,
          profile_stock_batch_id: remainderStock, profile_id: profile, bundle_number: "SCAN-REMAINDER", net_weight_kg: 10, net_length_m: 5,
          number_of_pieces: 1, gross_weight_kg: 11, tare_weight_kg: 1 }])
      ]);
      await db.exec(`reset role`);
      const remainder = await db.query(`select total_weight_kg,length_m,quantity_pieces from public.profile_stock_batches where id=$1`, [remainderStock]);
      assert.deepEqual({ ...remainder.rows[0], total_weight_kg: Number(remainder.rows[0].total_weight_kg), length_m: Number(remainder.rows[0].length_m) },
        { total_weight_kg: 40, length_m: 20, quantity_pieces: 4 });
      await db.exec(`insert into public.profile_stock_reservations(id,company_id,profile_stock_batch_id,profile_id,order_id,reserved_weight_kg,reserved_length_m,reserved_pieces,status)
        values ('55555555-5555-4555-8555-555555555555','${company}','${remainderStock}','${profile}','${order}',20,10,2,'active');`);
      assert.ok(partial.rows[0].id);
      const badBundleDispatch = "56565656-5656-4656-8656-565656565656";
      await db.exec(`insert into public.dispatches(id,company_id,order_id,delivery_status) values ('${badBundleDispatch}','${company}','${order}','pending');`);
      await reject(`insert into public.packing_list_items(company_id,dispatch_id,source_kind,source_record_id,source_line_id,reservation_id,profile_stock_batch_id,profile_id,bundle_number,net_length_m,number_of_pieces,gross_weight_kg,tare_weight_kg,operator_verified_at,operator_verified_by)
        values ('${company}','${badBundleDispatch}','reservation','${order}','${partialReservation}','${partialReservation}','${partialStock}','${profile}','BAD-RATIO',5,1,12,1,now(),'${user}')`, /whole-piece source ratio/i);
      const foreignCompany = "57575757-5757-4757-8757-575757575757";
      const foreignOrder = "58585858-5858-4858-8858-585858585858";
      await db.exec(`insert into public.companies values ('${foreignCompany}');
        insert into public.orders(id,company_id,current_stage) values ('${foreignOrder}','${foreignCompany}','in_production');
        set role authenticated;`);
      await db.query(`select set_config('test.role','dispatch_manager',false)`);
      await reject(`select public.save_ready_dispatch_atomic(null,'${JSON.stringify({order_id:foreignOrder,total_weight_kg:1,total_tare_weight_kg:0})}'::jsonb,'[{}]'::jsonb)`, /selected order is not available for this company/i);
      await db.exec(`reset role`);
    });
    await check("released partial reservation preserves exact posted replay and public delivery updates", async () => {
      const remainderStock = "53535353-5353-4353-8353-535353535353";
      const remainderReservation = "54545454-5454-4454-8454-545454545454";
      await db.exec(`reset role;`);
      await db.query(`select set_config('test.role','inventory_manager',false)`);
      const posted = (await db.query(`select dispatch_id from public.profile_stock_consumptions where reservation_id=$1`, [remainderReservation])).rows[0].dispatch_id;
      await db.query(`update public.profile_stock_reservations set status='released',released_at=now() where id=$1`, [remainderReservation]);
      const snapshot = async () => ({
        stock: (await db.query(`select total_weight_kg,length_m,quantity_pieces from public.profile_stock_batches where id=$1`, [remainderStock])).rows,
        ledger: (await db.query(`select * from public.profile_stock_consumptions where reservation_id=$1 order by id`, [remainderReservation])).rows
      });
      const before = await snapshot();
      await db.query(`select private.consume_dispatch_reservations($1)`, [posted]);
      await db.query(`select private.consume_dispatch_reservations($1)`, [posted]);
      assert.deepEqual(await snapshot(), before);
      await db.query(`select set_config('test.role','dispatch_manager',false)`);
      await db.exec(`set role authenticated;`);
      await db.query(`select public.transition_dispatch_delivery_atomic($1,'in_transit',null,'Transport progressed after releasing the remaining hold')`, [posted]);
      await db.exec(`reset role;`);
      assert.deepEqual(await snapshot(), before);
      assert.equal((await db.query(`select delivery_status from public.dispatches where id=$1`, [posted])).rows[0].delivery_status, "in_transit");
    });
    await check("mixed reservation dispatch rollback restores earlier source debits", async () => {
      const order = "27272727-2727-4727-8727-272727272727";
      await db.exec(`insert into public.orders(id,company_id,current_stage) values ('${order}','${company}','in_production');
        insert into public.profile_stock_batches(id,company_id,profile_id,total_weight_kg,length_m,quantity_pieces,status) values
          ('${rollbackStockA}','${company}','${profile}',10,5,1,'available'),('${rollbackStockB}','${company}','${profile}',10,5,1,'available');
        insert into public.profile_stock_reservations(id,company_id,profile_stock_batch_id,profile_id,order_id,reserved_weight_kg,reserved_length_m,reserved_pieces,status) values
          ('${rollbackReservationA}','${company}','${rollbackStockA}','${profile}','${order}',10,5,1,'active'),
          ('${rollbackReservationB}','${company}','${rollbackStockB}','${profile}','${order}',10,5,1,'active');
        insert into public.dispatches(id,company_id,order_id,delivery_status) values ('${rollbackDispatch}','${company}','${order}','pending');
        insert into public.packing_list_items(company_id,dispatch_id,source_kind,source_record_id,source_line_id,reservation_id,profile_stock_batch_id,profile_id,bundle_number,net_weight_kg,net_length_m,number_of_pieces,gross_weight_kg,tare_weight_kg,operator_verified_at,operator_verified_by)
        values ('${company}','${rollbackDispatch}','reservation','${order}','${rollbackReservationA}','${rollbackReservationA}','${rollbackStockA}','${profile}','1',10,5,1,11,1,now(),'${user}'),
          ('${company}','${rollbackDispatch}','reservation','${order}','${rollbackReservationB}','${rollbackReservationB}','${rollbackStockB}','${profile}','2',10,5,1,11,1,now(),'${user}');
        update public.profile_stock_reservations set status='cancelled' where id='${rollbackReservationB}';`);
      await reject(`select private.consume_dispatch_reservations('${rollbackDispatch}')`, /stale or no longer available/i);
      const rollback = await db.query(`select (select count(*)::int from public.profile_stock_consumptions where dispatch_id=$1) entries,
        (select total_weight_kg from public.profile_stock_batches where id=$2) first_balance`, [rollbackDispatch, rollbackStockA]);
      assert.deepEqual({ entries: rollback.rows[0].entries, balance: Number(rollback.rows[0].first_balance) }, { entries: 0, balance: 10 });
    });
    await check("authenticated credit-note wrappers issue idempotently and reverse the actual ledger", async () => {
      await db.query(`select set_config('test.role','accounts',false)`);
      await db.exec(`insert into public.dispatches(id,company_id,order_id,delivery_status) values ('${creditDispatch}','${company}','${job}','pending');
        update public.dispatches set delivery_status='returned' where id='${creditDispatch}';
        insert into public.invoices(id,company_id,dispatch_id,subtotal,tax_total,grand_total,status) values ('${invoiceId}','${company}','${creditDispatch}',100,18,118,'sent');`);
      await db.exec(`set role authenticated`);
      const issued = await db.query(`select public.issue_dispatch_return_credit_note_atomic($1,'returned damaged bundles','${creditKey}') id`, [creditDispatch]);
      const retried = await db.query(`select public.issue_dispatch_return_credit_note_atomic($1,'returned damaged bundles','${creditKey}') id`, [creditDispatch]);
      assert.equal(issued.rows[0].id, retried.rows[0].id);
      await db.query(`select public.reverse_credit_note_atomic($1,'original return was entered in error')`, [issued.rows[0].id]);
      const acl = await db.query(`select has_function_privilege('authenticated','public.issue_dispatch_return_credit_note_atomic(uuid,text,uuid)','EXECUTE') wrapper,
        has_function_privilege('authenticated','private.issue_dispatch_return_credit_note_atomic(uuid,text,uuid)','EXECUTE') helper`);
      assert.deepEqual(acl.rows[0], { wrapper: true, helper: false });
      await reject(`select private.issue_dispatch_return_credit_note_atomic('${creditDispatch}','not allowed','${"52525252-5252-4252-8252-525252525252"}')`, /permission denied/i);
      await db.exec(`reset role`);
      const invoice = await db.query(`select credited_amount,status from public.invoices where id=$1`, [invoiceId]);
      const note = await db.query(`select status from public.credit_notes where id=$1`, [issued.rows[0].id]);
      assert.deepEqual({ credited: Number(invoice.rows[0].credited_amount), invoiceStatus: invoice.rows[0].status, noteStatus: note.rows[0].status },
        { credited: 0, invoiceStatus: "sent", noteStatus: "reversed" });
    });
    await check("partial-dispatched order permits its exact 800 kg remainder and current resource-safe release", async () => {
      await db.exec(functionDefinition("supabase/migrations/20260810010000_manufacturing_reference_and_material_guards.sql", "public.guard_production_job_status"));
      await db.exec(functionDefinition("supabase/migrations/20260718021500_floor_output_and_finishing_workflows.sql", "public.validate_production_completion"));
      await db.exec(functionDefinition("supabase/migrations/20260723010000_production_schedule_integrity.sql", "private.enforce_production_schedule_integrity"));
      await db.exec(functionDefinition("supabase/migrations/20260723010000_production_schedule_integrity.sql", "private.release_production_schedule_slot_atomic"));
      await db.exec(`create trigger guard_production_job_status before insert or update of status,machine_id,company_id on public.production_jobs
        for each row execute function public.guard_production_job_status();
        create trigger validate_production_completion before insert or update on public.production_jobs for each row execute function public.validate_production_completion();
        create trigger enforce_production_schedule_integrity before insert or update on public.production_plan_slots
        for each row execute function private.enforce_production_schedule_integrity();`);
      const followupMigration = repoSql("supabase/migrations/20261013000000_audit_workflow_followup.sql");
      await db.exec(`create function private.get_current_user_dealer_id() returns uuid language sql as $$select null::uuid$$;
        create table public.quotes(id uuid primary key,company_id uuid,dealer_id uuid,status text,deleted_at timestamptz);
        create table public.quote_items(id uuid primary key,company_id uuid,quote_id uuid,profile_id uuid,finishing_type text,billing_weight_kg numeric,total_weight_kg numeric);
        alter table public.profile_stock_batches add column dealer_id uuid,add column finish text;`);
      await db.exec(followupMigration);
      await db.query(`select set_config('test.role','production_manager',false)`);
      await reject(`insert into public.production_jobs(id,company_id,status,planned_quantity_kg) values ('51515151-5151-4151-8151-515151515151','${company}','in_progress',1)`, /created as planned|must start in planned/i);
      await reject(`insert into public.production_plan_slots(company_id,production_job_id,machine_id,status,planned_start_at,planned_end_at) values ('${company}','51515151-5151-4151-8151-515151515151','${pressId}','released',now(),now()+interval '1 hour')`, /no longer eligible for press release/i);
      await db.exec(`insert into public.orders(id,company_id,current_stage,production_quantity_kg,order_number,priority,order_date)
        values ('${orderBalance}','${company}','in_production',1000,'ORD-PARTIAL','normal',current_date);
        insert into public.order_items(id,company_id,order_id,quantity_kg) values ('${orderLine}','${company}','${orderBalance}',1000);
        insert into public.dies(id,company_id,profile_id,die_status) values ('${dieId}','${company}','${profile}','active');
        insert into public.machines(id,company_id,machine_type,is_active,status,machine_name) values ('${pressId}','${company}','extrusion_press',true,'active','Press 1');
        insert into public.production_jobs(id,company_id,order_id,profile_id,die_id,machine_id,status,planned_quantity_kg,source_line_id,job_number,required_billet_count)
          values ('${balanceJob}','${company}','${orderBalance}','${profile}','${dieId}','${pressId}','planned',200,'${orderLine}','JOB-COMPLETE',1);
        insert into public.production_plan_slots(company_id,production_job_id,machine_id,status,planned_start_at,planned_end_at)
          values ('${company}','${balanceJob}','${pressId}','scheduled',now()+interval '1 hour',now()+interval '9 hours');
        update public.production_plan_slots set status='released' where production_job_id='${balanceJob}';
        update public.production_jobs set status='ready' where id='${balanceJob}';
        update public.production_jobs set status='in_progress' where id='${balanceJob}';
        insert into public.foundry_billets(id,company_id,production_job_id,status,weight_kg) values ('${balanceBillet}','${company}','${balanceJob}','issued',205);`);
      await db.query(`select public.complete_production_job_atomic($1,200,20,100,5,'partial shipment basis')`, [balanceJob]);
      await db.exec(`update public.orders set current_stage='dispatched' where id='${orderBalance}';
        insert into public.production_jobs(id,company_id,order_id,profile_id,die_id,machine_id,status,planned_quantity_kg,source_line_id,job_number,required_billet_count)
          values ('${balanceJob.replaceAll('33333333','37373737')}','${company}','${orderBalance}','${profile}','${dieId}','${pressId}','planned',800,'${orderLine}','JOB-REMAINDER',1);`);
      const remainderJob = balanceJob.replaceAll("33333333", "37373737");
      await reject(`insert into public.production_jobs(id,company_id,order_id,profile_id,status,planned_quantity_kg,source_line_id) values ('${"38383838-3838-4838-8838-383838383838"}','${company}','${orderBalance}','${profile}','planned',1,'${orderLine}')`, /exceeds the order line remaining/i);
      const slot = await db.query(`select private.save_production_schedule_slot_atomic(null,jsonb_build_object(
        'production_job_id','${remainderJob}'::uuid,'machine_id','${pressId}'::uuid,'planned_start_at',now()+interval '1 day',
        'planned_end_at',now()+interval '1 day 8 hours','sequence_number',1,'capacity_kg',800,'status','scheduled')) id`);
      const slotId = slot.rows[0].id;
      await db.exec(`update public.production_jobs set status='on_hold' where id='${remainderJob}';`);
      await db.query(`select private.save_production_schedule_slot_atomic($1,jsonb_build_object(
        'production_job_id','${remainderJob}'::uuid,'machine_id','${pressId}'::uuid,'planned_start_at',now()+interval '2 days',
        'planned_end_at',now()+interval '2 days 8 hours','sequence_number',2,'capacity_kg',800,'status','scheduled'))`, [slotId]);
      const held = await db.query(`select status from public.production_jobs where id=$1`, [remainderJob]);
      assert.equal(held.rows[0].status, "on_hold");
      await db.exec(`update public.dies set die_status='dead' where id='${dieId}';`);
      await reject(`update public.production_plan_slots set status='released' where id='${slotId}'`, /die is no longer eligible/i);
      await db.exec(`update public.dies set die_status='active' where id='${dieId}';`);
      await db.query(`select private.release_production_schedule_slot_atomic($1)`,[slotId]);
      await db.exec(`update public.production_jobs set status='in_progress' where id='${remainderJob}';`);
      const progress = await db.query(`select status from public.production_jobs where id=$1`, [remainderJob]);
      assert.equal(progress.rows[0].status, "in_progress");
    });
    await check("held recovery preserves floor evidence and rejects conflicting replacement schedules", async () => {
      const remainderJob = balanceJob.replaceAll("33333333", "37373737");
      await db.exec(`update public.production_jobs set actual_quantity_kg=50,actual_pieces=5,actual_meters=25 where id='${remainderJob}';
        insert into public.scrap_records(company_id,production_job_id,weight_kg) values('${company}','${remainderJob}',2);`);
      await db.query(`select private.transition_production_job_atomic($1,'on_hold','press stopped for inspection')`,[remainderJob]);
      await db.query(`update public.production_plan_slots set status='cancelled' where production_job_id=$1 and status='released'`,[remainderJob]);
      await reject(`update public.production_jobs set status='ready' where id='${remainderJob}'`,/transition workflow/i);
      await reject(`select private.save_production_schedule_slot_atomic(null,jsonb_build_object(
        'production_job_id','${remainderJob}','machine_id','${pressId}','planned_start_at',now()+interval '1 hour',
        'planned_end_at',now()+interval '2 hours','status','scheduled'))`,/overlapping active slot/i);
      const slot = await db.query(`select private.save_production_schedule_slot_atomic(null,jsonb_build_object(
        'production_job_id','${remainderJob}','machine_id','${pressId}','planned_start_at',now()+interval '3 days',
        'planned_end_at',now()+interval '3 days 8 hours','status','scheduled')) id`);
      const held = await db.query(`select status,actual_quantity_kg,actual_pieces,actual_meters,
        (select sum(weight_kg) from public.scrap_records where production_job_id=j.id) scrap,
        (select count(*)::int from public.production_job_status_history where production_job_id=j.id and new_status='on_hold') holds
        from public.production_jobs j where id=$1`,[remainderJob]);
      assert.deepEqual({...held.rows[0],actual_quantity_kg:Number(held.rows[0].actual_quantity_kg),actual_meters:Number(held.rows[0].actual_meters),scrap:Number(held.rows[0].scrap)},
        {status:"on_hold",actual_quantity_kg:50,actual_pieces:5,actual_meters:25,scrap:2,holds:1});
      await db.query(`select private.release_production_schedule_slot_atomic($1)`,[slot.rows[0].id]);
      await db.query(`select private.transition_production_job_atomic($1,'in_progress','resume inspected press')`,[remainderJob]);
      const resumed = await db.query(`select status,actual_quantity_kg from public.production_jobs where id=$1`,[remainderJob]);
      assert.equal(resumed.rows[0].status,"in_progress");assert.equal(Number(resumed.rows[0].actual_quantity_kg),50);
    });
    await check("release and start separately reject stale order, die and press eligibility",async()=>{
      const remainderJob = balanceJob.replaceAll("33333333", "37373737");
      await db.query(`select private.transition_production_job_atomic($1,'on_hold','resource recheck')`,[remainderJob]);
      await db.query(`update public.production_plan_slots set status='cancelled' where production_job_id=$1 and status='released'`,[remainderJob]);
      const slot = await db.query(`select private.save_production_schedule_slot_atomic(null,jsonb_build_object(
        'production_job_id','${remainderJob}','machine_id','${pressId}','planned_start_at',now()+interval '4 days',
        'planned_end_at',now()+interval '4 days 8 hours','status','scheduled')) id`);
      for (const [block,restore,pattern] of [
        [`update orders set current_stage='cancelled' where id='${orderBalance}'`,`update orders set current_stage='dispatched' where id='${orderBalance}'`,/Order is no longer eligible/i],
        [`update dies set die_status='dead' where id='${dieId}'`,`update dies set die_status='active' where id='${dieId}'`,/die is no longer eligible/i],
        [`update machines set is_active=false,status='maintenance' where id='${pressId}'`,`update machines set is_active=true,status='active' where id='${pressId}'`,/press is no longer eligible/i]
      ]) {
        await db.exec(block);await assert.rejects(db.query(`select private.release_production_schedule_slot_atomic($1)`,[slot.rows[0].id]),pattern);
        await db.exec(restore);
      }
      await db.query(`select private.release_production_schedule_slot_atomic($1)`,[slot.rows[0].id]);
      for (const [block,restore,pattern] of [
        [`update orders set current_stage='cancelled' where id='${orderBalance}'`,`update orders set current_stage='dispatched' where id='${orderBalance}'`,/Order.*(eligible|available)/i],
        [`update dies set die_status='dead' where id='${dieId}'`,`update dies set die_status='active' where id='${dieId}'`,/die is no longer eligible/i],
        [`update machines set is_active=false,status='maintenance' where id='${pressId}'`,`update machines set is_active=true,status='active' where id='${pressId}'`,/press is no longer eligible/i]
      ]) {
        await db.exec(block);await assert.rejects(db.query(`select private.transition_production_job_atomic($1,'in_progress','start after release')`,[remainderJob]),pattern);
        await db.exec(restore);
      }
      const state = await db.query(`select status from production_jobs where id=$1`,[remainderJob]);assert.equal(state.rows[0].status,"ready");
      await db.query(`select private.transition_production_job_atomic($1,'in_progress','resources restored')`,[remainderJob]);
    });
    await check("factory managers can manually allocate and reallocate temper-compatible billets", async () => {
      await db.query(`select set_config('test.role','factory_manager',false)`);
      await db.exec(`insert into public.orders(id,company_id,current_stage,order_number) values
        ('${allocationOrder}','${company}','in_production','ORD-ALLOCATE'),('${previousOrder}','${company}','in_production','ORD-PREVIOUS');
        insert into public.order_billet_requirements(id,company_id,order_id,profile_id,alloy,temper,billet_diameter_inch,billets_required,billets_allocated,status,created_at) values
        ('${incompatibleRequirement}','${company}','${allocationOrder}','${profile}','6063','T5',5,2,0,'partial',now()-interval '2 days'),
        ('${allocationRequirement}','${company}','${allocationOrder}','${profile}','6063','T6',5,2,0,'partial',now()),
        ('41414141-4141-4141-8141-414141414142','${company}','${previousOrder}','${profile}','6063','T6',5,2,1,'partial',now());
        insert into public.foundry_billets(id,company_id,status,weight_kg,alloy,temper,billet_diameter_inch,billet_code,source_type) values
        ('${allocationBillet}','${company}','cast',180,'6063','T6',5,'B-ALLOCATE','in_house');
        insert into public.foundry_billets(id,company_id,order_id,allocation_requirement_id,status,weight_kg,alloy,temper,billet_diameter_inch,billet_code,source_type) values
        ('${reallocationBillet}','${company}','${previousOrder}','41414141-4141-4141-8141-414141414142','allocated',180,'6063','T6',5,'B-REALLOCATE','in_house');`);
      const allocatedRequirement = await db.query(`select private.allocate_billet_to_order($1,$2) id`, [allocationBillet, allocationOrder]);
      assert.equal(allocatedRequirement.rows[0].id, allocationRequirement);
      const reallocatedRequirement = await db.query(`select private.reallocate_billet_to_order($1,$2) id`, [reallocationBillet, allocationOrder]);
      assert.equal(reallocatedRequirement.rows[0].id, allocationRequirement);
      const allocated = await db.query(`select order_id,allocation_requirement_id,status from public.foundry_billets where id = any($1::uuid[])`, [[allocationBillet,reallocationBillet]]);
      assert.equal(allocated.rows.length, 2);
      assert.ok(allocated.rows.every((row) => row.order_id === allocationOrder && row.allocation_requirement_id === allocationRequirement && row.status === "allocated"));
      const access = await db.query(`select has_function_privilege('authenticated','private.allocate_billet_to_order(uuid,uuid)','EXECUTE') allowed`);
      assert.equal(access.rows[0].allowed, true);
    });
    await check("priority allocator selects matching alloy, temper, and diameter", async () => {
      await db.query(`select set_config('test.role','factory_manager',false)`);
      const autoOrder = "45454545-4545-4545-8545-454545454545";
      const autoWrong = "46464646-4646-4646-8646-464646464646";
      const autoBillet = "48484848-4848-4848-8848-484848484848";
      await db.exec(functionDefinition("supabase/migrations/20260515005600_order_billet_requirements_and_allocation.sql", "public.refresh_order_billet_allocations"));
      await db.exec(functionDefinition("supabase/migrations/20260515005600_order_billet_requirements_and_allocation.sql", "public.rebuild_order_billet_requirements"));
      await db.exec(`insert into public.orders(id,company_id,current_stage,production_quantity_kg,production_profile_id,billet_diameter_required_inch,order_number,priority,order_date) values ('${autoOrder}','${company}','in_production',1000,'${profile}',5,'ORD-AUTO','high',current_date);
        select public.rebuild_order_billet_requirements('${autoOrder}');
        insert into public.order_billet_requirements(id,company_id,order_id,profile_id,alloy,temper,billet_diameter_inch,billets_required,billets_allocated,status) values
        ('${autoWrong}','${company}','${autoOrder}','${profile}','6063','T5',5,1,0,'partial');
        insert into public.foundry_billets(id,company_id,status,weight_kg,alloy,temper,billet_diameter_inch,billet_code,source_type) values
        ('${autoBillet}','${company}','cast',180,'6063','T6',5,'B-AUTO','in_house');`);
      await db.query(`select public.allocate_billets_by_priority($1)`, [company]);
      const result = await db.query(`select order_id,allocation_requirement_id,status from public.foundry_billets where id=$1`, [autoBillet]);
      const rightRequirement = await db.query(`select id from public.order_billet_requirements where order_id=$1 and temper='T6' and status <> 'cancelled'`, [autoOrder]);
      assert.equal(result.rows[0].order_id, autoOrder);
      assert.equal(result.rows[0].allocation_requirement_id, rightRequirement.rows[0].id);
      assert.equal(result.rows[0].status, "allocated");
    });
    await check("quality rework resolution creates once-only approved/rejected children", async () => {
      await db.query(`select set_config('test.role','quality',false)`);
      await db.exec(`insert into public.quality_inspections(id,company_id,production_job_id,profile_id,inspection_date,batch_number,quantity_checked_kg,status) values ('${inspection}','${company}','${job}','${profile}',now(),'B1',10,'rework');`);
      await db.query(`select public.resolve_quality_rework_atomic($1,6,4,'QC inspector','surface rework closed')`, [inspection]);
      const rows = await db.query(`select status,quantity_checked_kg from public.quality_inspections where company_id=$1 and production_job_id=$2 order by status`, [company,job]);
      assert.deepEqual(rows.rows.map((row) => ({ ...row, quantity_checked_kg: Number(row.quantity_checked_kg) })),
        [{ status: "approved", quantity_checked_kg: 6 }, { status: "rejected", quantity_checked_kg: 4 }, { status: "rework", quantity_checked_kg: 10 }]);
      await reject(`update public.quality_inspections set quantity_checked_kg=9 where id='${inspection}'`, /immutable/i);
      await reject(`select public.resolve_quality_rework_atomic('${inspection}',6,4,'QC inspector','duplicate resolution')`, /not found|already resolved/i);
      const open = await db.query(`select count(*)::int n from public.quality_inspections source
        where source.company_id=$1 and source.status='rework'
          and not exists(select 1 from public.quality_rework_resolutions resolution
            where resolution.company_id=source.company_id and resolution.source_inspection_id=source.id)`, [company]);
      assert.equal(open.rows[0].n, 0, "resolved source inspections must not remain in the open work queue");
    });
    await check("open rework SQL feed excludes resolved rows before ten-row pagination", async () => {
      await db.exec(`insert into public.quality_inspections(company_id,production_job_id,profile_id,inspection_date,batch_number,quantity_checked_kg,status)
        select '${company}','${job}','${profile}',now() + (item.seq * interval '1 second'),'VOL-' || item.seq::text,0.001,'rework'
        from generate_series(1,1001) as item(seq);
        set role authenticated;`);
      const page = await db.query(`select * from public.list_open_quality_rework_inspections(0,10)`);
      await db.exec(`reset role`);
      assert.equal(page.rows.length, 10);
      assert.equal(Number(page.rows[0].total_count), 1001);
      assert.ok(page.rows.every((row) => row.profile_id === profile));
      const next = await db.query(`select * from public.list_open_quality_rework_inspections(10,10)`);
      assert.equal(next.rows.length, 10);
      assert.notEqual(next.rows[0].id, page.rows[0].id);
      await db.query(`select set_config('test.role','sales',false)`);
      await db.exec(`set role authenticated`);
      await reject(`select * from public.list_open_quality_rework_inspections(0,10)`, /not authorized to read quality inspections/i);
      await db.exec(`reset role`);
    });
    const acl = await db.query(`select has_function_privilege('authenticated','private.guard_quality_resolution_immutability()','EXECUTE') as allowed`);
    assert.equal(acl.rows[0].allowed, false, "private trigger helper must not be executable by authenticated callers");
    checks.push("private trigger helper execute is revoked");
    await check("foundry and factory migrations protect one source-backed billet through completion", async () => {
      await db.query(`select set_config('test.role','production_manager',false)`);
      await db.exec(functionDefinition("supabase/migrations/20260930000000_astra_audit_fixes.sql", "public.refresh_foundry_batch_calculations"));
      const foundryMigration = readFileSync(new URL("../supabase/migrations/20261008000000_foundry_material_integrity.sql", import.meta.url), "utf8");
      await db.exec(foundryMigration);
      await db.exec(foundryMigration);
      const batch = "73737373-7373-4373-8373-737373737373";
      const order = "74747474-7474-4474-8474-747474747474";
      const requirement = "75757575-7575-4575-8575-757575757575";
      const die = "76767676-7676-4676-8676-767676767676";
      const press = "77777777-7777-4777-8777-777777777777";
      const jobId = "78787878-7878-4878-8878-787878787878";
      await db.exec(`insert into public.orders(id,company_id,current_stage,production_quantity_kg,order_number) values ('${order}','${company}','in_production',100,'ORD-INTEGRATED');
        insert into public.dies(id,company_id,profile_id,billet_diameter_required_inch,die_status) values ('${die}','${company}','${profile}',4,'active');
        insert into public.machines(id,company_id,machine_type,is_active,status,machine_name) values ('${press}','${company}','extrusion_press',true,'operational','Integration press');
        insert into public.order_billet_requirements(id,company_id,order_id,profile_id,alloy,temper,billet_diameter_inch,billets_required,billets_allocated,billets_short,status)
          values ('${requirement}','${company}','${order}','${profile}','6063','T6',4,1,0,1,'shortage');
        insert into public.production_jobs(id,company_id,order_id,profile_id,die_id,machine_id,status,planned_quantity_kg,pieces,length_per_piece_m,job_number,required_billet_count,finishing_type)
          values ('${jobId}','${company}','${order}','${profile}','${die}','${press}','planned',20,1,1,'JOB-INTEGRATED',1,'mill_finish');
        insert into public.production_plan_slots(company_id,production_job_id,machine_id,status,planned_start_at,planned_end_at,shift,created_by)
          values ('${company}','${jobId}','${press}','released',now(),now()+interval '1 hour','day','${user}');
        insert into public.foundry_batches(id,company_id,batch_number,furnace_number,batch_sequence,production_date,external_source_id,scrap_percentage,external_aluminium_percentage,
          furnace_efficiency_percent,alloy,temper,alloy_density_kg_m3,billet_length_mm,billet_diameter_inch,billet_diameter_mm,billet_count,status)
          values ('${batch}','${company}','FB-INTEGRATED','F1',1,'2026-10-09','72727272-7272-4272-8272-727272727272',0,100,80,'6063','T6',2700,1000,4,101.6,1,'planned');
        update public.foundry_batches set status='cast' where id='${batch}';`);
      const charged = await db.query(`select available_weight_kg from public.foundry_external_aluminium_sources where id='72727272-7272-4272-8272-727272727272'`);
      const sourceAfterCharge = Number(charged.rows[0].available_weight_kg);
      const billet = await db.query(`select id,weight_kg,status from public.foundry_billets where foundry_batch_id=$1 and source_type='in_house'`, [batch]);
      assert.equal(billet.rows.length, 1);
      assert.equal(billet.rows[0].status, "cast");
      await reject(`update public.foundry_billets set weight_kg=weight_kg+1 where id='${billet.rows[0].id}'`, /maintained only by the batch calculation|match the calculated parent/i);
      await db.exec(`update public.foundry_billets set status='allocated',order_id='${order}',allocation_requirement_id='${requirement}',allocated_at=now(),allocated_by='${user}' where id='${billet.rows[0].id}';
        update public.production_jobs set status='ready' where id='${jobId}';
        update public.production_jobs set status='in_progress' where id='${jobId}';
        update public.foundry_billets set status='issued',production_job_id='${jobId}' where id='${billet.rows[0].id}';`);
      const inputKg = Number(billet.rows[0].weight_kg);
      await db.query(`select public.complete_production_job_atomic($1,$2,1,1,1,'integrated foundry completion')`, [jobId, Number((inputKg - 1).toFixed(3))]);
      const completedBillet = await db.query(`select status,order_id,production_job_id from public.foundry_billets where id=$1`, [billet.rows[0].id]);
      assert.deepEqual(completedBillet.rows[0], { status: "consumed", order_id: order, production_job_id: jobId });
      await db.exec(`update public.foundry_batches set notes='routine metadata update' where id='${batch}';`);
      const afterResync = await db.query(`select status,order_id,production_job_id from public.foundry_billets where id=$1`, [billet.rows[0].id]);
      assert.deepEqual(afterResync.rows[0], { status: "consumed", order_id: order, production_job_id: jobId });
      await reject(`update public.foundry_batches set billet_count=2 where id='${batch}'`, /physical, source, mix, and count fields are immutable|freeze after planning/i);
      await reject(`update public.foundry_batches set status='planned' where id='${batch}'`, /cannot regress/i);
      await reject(`update public.foundry_batches set status='cancelled' where id='${batch}'`, /only an uncommitted planned/i);
      await reject(`update public.foundry_billets set weight_kg=weight_kg+1 where id='${billet.rows[0].id}'`, /Billet inputs linked to completed production are immutable/i);
      await reject(`update public.foundry_billets set order_id=null,production_job_id=null where id='${billet.rows[0].id}'`, /Billet inputs linked to completed production are immutable|lineage is immutable|identity and batch lineage/i);
      await reject(`update public.foundry_billets set status='issued' where id='${billet.rows[0].id}'`, /Billet inputs linked to completed production are immutable|terminal|cannot regress/i);
      await reject(`delete from public.foundry_billets where id='${billet.rows[0].id}'`, /Billet inputs linked to completed production are immutable|cannot be deleted/i);
      const final = await db.query(`select (select available_weight_kg from public.foundry_external_aluminium_sources where id='72727272-7272-4272-8272-727272727272') source_balance,
        (select status from public.foundry_billets where id=$1) billet_status`, [billet.rows[0].id]);
      assert.equal(Number(final.rows[0].source_balance), sourceAfterCharge, "failed edits must not refund the committed foundry source");
      assert.equal(final.rows[0].billet_status, "consumed");
    });
    await check("read-only factory preflight detects incomplete legacy unit provenance", async () => {
      const preflight = readFileSync(new URL('../sql/factory-workflow-preflight.sql', import.meta.url), 'utf8');
      assert.match(preflight.replace(/^\s*(?:--[^\n]*\n\s*)*/g, '').trim().toLowerCase(), /^with\b/);
      await db.exec(`insert into public.dispatches(id,company_id,order_id,delivery_status)
        select '69696969-6969-4969-8969-696969696969', '${company}', id, 'pending'
        from public.orders where company_id='${company}' limit 1;
        alter table public.packing_list_items disable trigger validate_operator_dispatch_bundle;
        insert into public.packing_list_items(company_id,dispatch_id,source_kind,source_record_id,source_line_id,reservation_id,profile_stock_batch_id,profile_id,bundle_number,net_length_m,number_of_pieces,gross_weight_kg,tare_weight_kg,operator_verified_at,operator_verified_by)
        select r.company_id,'69696969-6969-4969-8969-696969696969','reservation',r.order_id,r.id,r.id,r.profile_stock_batch_id,r.profile_id,'LEGACY-MISSING-METRES',null,1,2,0,now(),'${user}'
        from public.profile_stock_reservations r where r.company_id='${company}' limit 1;
        alter table public.packing_list_items enable trigger validate_operator_dispatch_bundle;`);
      const findings = await db.query(preflight);
      assert.ok(findings.rows.some((row) => row.issue === 'F_WORKFLOW_CONSUMPTION_UNITS'), 'preflight should identify consumption rows that lack matching packing provenance');
      assert.ok(findings.rows.some((row) => row.issue === 'F_WORKFLOW_PACKING_LENGTH'), 'preflight should identify reserved-stock packing rows with invalid metre provenance');
    });
    return checks;
  } finally {
    await db.close();
  }
}

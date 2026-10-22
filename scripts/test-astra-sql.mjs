// Run through: node --experimental-strip-types scripts/test-business-logic-sql.mjs --astra
// Reuses the original migration fixture, then installs all audit changes together.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
export async function runAstraChecks(db) {
  const company = "22222222-2222-4222-8222-222222222222";
  const other = "77777777-7777-4777-8777-777777777777";
  const profile = "11111111-1111-4111-8111-111111111111";
  const customer = "44444444-4444-4444-8444-444444444444";
  const order = "88888888-8888-4888-8888-888888888888";
  const cfg = "99999999-9999-4999-8999-999999999999";
  const batch = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const common = "id uuid primary key default gen_random_uuid(), company_id uuid, created_at timestamptz default now(), updated_at timestamptz default now()";
  let checks = 0;
  async function check(name, fn) { await fn(); checks++; console.log(`PASS ASTRA ${name}`); }
  function definition(file, name) {
    const source = readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
    const start = source.indexOf(`create or replace function ${name}(`);
    assert.ok(start >= 0, name);
    return source.slice(start, source.indexOf("\n$$;", start) + 4);
  }
  await db.exec(`
    create or replace function private.get_current_user_role() returns text language sql as $$select coalesce(nullif(current_setting('test.app_role',true),''),'owner')$$;
    create function public.get_current_user_role() returns text language sql as $$select private.get_current_user_role()$$;
    create function public.get_current_user_company_id() returns uuid language sql as $$select private.get_current_user_company_id()$$;
    alter table companies add column name text, add column legal_name text, add column billing_address text;
    update companies set name='Original Supplier', legal_name='Original Supplier Ltd', billing_address='Original supplier address';
    create table customers (${common}, customer_name text, company_name text, gst_number text, billing_address text, shipping_address text);
    insert into customers(id,company_id,customer_name,gst_number,billing_address) values ('${customer}','${company}','Original Customer','08CUSTOMER','Original billing address');
    alter table orders add column notes text;
    insert into orders(id,company_id,customer_id,order_date) values ('${order}','${company}','${customer}','2026-09-30');
    alter table aluminium_profiles add column is_active boolean default true;
    create table dies (${common}, profile_id uuid, die_status text);
    insert into dies(id,company_id,profile_id,die_status) values ('${profile}','${company}','${profile}','active');
    create table system_configurations (${common}, configuration_number text, project_name text, customer_id uuid, quote_id uuid, order_id uuid, status text default 'draft',
      width_mm numeric, height_mm numeric, quantity integer, notes text, design_reference text,
      subtotal numeric default 0, gst_amount numeric default 0, grand_total numeric default 0, internal_cost numeric default 0, selling_price numeric default 0, margin_percent numeric, gst_percent numeric);
    create unique index config_number_unique on system_configurations(company_id,configuration_number);
    create table system_profile_cuts (${common}, configuration_id uuid references system_configurations(id), profile_id uuid, profile_code text, profile_name text,
      cut_length_mm numeric check(cut_length_mm > 0), quantity integer check(quantity > 0), total_weight_kg numeric, total_length_m numeric);
    create table profile_stock_batches (${common}, profile_id uuid, total_weight_kg numeric, length_m numeric, status text);
    create table profile_stock_reservations (${common}, profile_stock_batch_id uuid, profile_id uuid, order_id uuid, configuration_id uuid,
      reserved_weight_kg numeric check(reserved_weight_kg > 0), reserved_length_m numeric, status text default 'active');
    alter table production_jobs add column order_id uuid, add column profile_id uuid, add column die_id uuid, add column source_line_id uuid,
      add column source_record_id uuid, add column status text, add column remarks text, add column planned_quantity_kg numeric, add column planned_meters numeric, add column created_by uuid;
    create table order_stage_history (${common}, order_id uuid, stage text, changed_by uuid, remarks text);
    create table order_billet_requirements (${common}, order_id uuid, profile_id uuid, status text, billets_required integer);
    create table foundry_billets (${common}, order_id uuid, production_job_id uuid, status text);
    alter table foundry_batches add column furnace_number text, add column furnace_name text, add column batch_sequence integer,
      add column furnace_efficiency_percent numeric, add column scrap_percentage numeric, add column external_aluminium_percentage numeric,
      add column billet_diameter_inch numeric, add column billet_diameter_mm numeric, add column billet_length_mm numeric,
      add column alloy_density_kg_m3 numeric, add column billet_weight_density_kg numeric, add column total_billet_weight_density_kg numeric,
      add column billet_count integer, add column required_furnace_charge_kg numeric, add column scrap_aluminium_kg numeric,
      add column external_aluminium_kg numeric, add column ingot_kg numeric, add column alloy_composition_default jsonb,
      add column alloy_composition_actual jsonb, add column alloy_composition_altered boolean, add column production_date date;
    create table finishing_jobs (${common}, order_id uuid, production_job_id uuid, finishing_type text, status text,
      retry_of_finishing_job_id uuid, input_weight_kg numeric, output_weight_kg numeric, rejection_weight_kg numeric,
      remarks text, vendor_id uuid, sent_date date, received_date date);
  `);
  for (const table of ["system_panels","system_glass_cuts","system_beading_cuts","system_hardware_bom","system_material_summary","profile_optimization_runs","system_reports","system_series","system_profiles","system_templates","hardware_items","glass_items","finish_options"]) {
    await db.exec(`create table ${table} (${common}, configuration_id uuid, amount numeric)`);
  }
  await db.exec(definition("20260715000000_atomic_business_workflows.sql", "private.update_jsonb_row"));
  await db.exec(definition("20260918000000_production_source_line_integrity.sql", "private.validate_production_job_source_line"));
  await db.exec(`create trigger production_job_source_line_guard before insert or update on production_jobs for each row execute function private.validate_production_job_source_line();`);
  // Real older definitions/triggers are present before installing the follow-up.
  await db.exec(definition("20260515005700_foundry_furnace_mix_and_chemistry.sql", "public.refresh_foundry_batch_calculations"));
  await db.exec(definition("20260718021500_floor_output_and_finishing_workflows.sql", "public.validate_finishing_transition"));
  await db.exec(`create trigger refresh_foundry_batch_calculations before insert or update on foundry_batches for each row execute function public.refresh_foundry_batch_calculations();
    create trigger validate_finishing_transition before insert or update on finishing_jobs for each row execute function public.validate_finishing_transition();
    create policy system_configurations_tenant_isolation on system_configurations for all using (company_id=public.get_current_user_company_id()) with check (company_id=public.get_current_user_company_id());`);
  await db.exec(readFileSync(new URL("../supabase/migrations/20260930000000_astra_audit_fixes.sql", import.meta.url), "utf8"));
  await db.exec(`insert into system_configurations(id,company_id,customer_id,status) values ('${cfg}','${company}','${customer}','draft');
    insert into profile_stock_batches(id,company_id,profile_id,total_weight_kg,length_m,status) values ('${batch}','${company}','${profile}',100,50,'available');`);
  await check("literal special-character prefixes and five-digit rollover", async () => {
    for (const prefix of ["Q+","A.B","X[1]","A\\B","(Q)","Q$"]) {
      await db.query("insert into company_settings(company_id,invoice_prefix) values ($1,$2)",[other,prefix]);
      const allocate = async () => (await db.query("select private.next_business_number_locked('system_configurations','configuration_number',$1,$2,'2026-09-30') as n",[other,prefix])).rows[0].n;
      const first = await allocate();
      // Seed a legacy number without invoking the new insert allocator.
      await db.exec("alter table system_configurations disable trigger aa_assign_business_number");
      await db.query("insert into system_configurations(company_id,configuration_number) values ($1,$2)",[other,first]);
      await db.exec("alter table system_configurations enable trigger aa_assign_business_number");
      assert.equal(await allocate(), `${prefix}-2026-0002`);
    }
    await db.exec("alter table system_configurations disable trigger aa_assign_business_number");
    await db.query("insert into system_configurations(company_id,configuration_number) values ($1,'SC-2026-9999')",[other]);
    await db.exec("alter table system_configurations enable trigger aa_assign_business_number");
    const row = (await db.query("insert into system_configurations(company_id) values ($1) returning configuration_number",[other])).rows[0];
    assert.equal(row.configuration_number,'SC-2026-10000');
  });
  await check("configuration numbers ignore supplied values and roll back with failed transactions", async () => {
    const rows = (await db.query(`insert into system_configurations(company_id,configuration_number) values ('${company}','forged'),('${company}','forged') returning configuration_number`)).rows;
    assert.equal(new Set(rows.map(r=>r.configuration_number)).size,2);
    await assert.rejects(db.exec(`update system_configurations set configuration_number='forged' where id='${cfg}'`),/immutable/);
    await db.exec(`begin; insert into system_configurations(company_id) values ('${company}'); rollback;`);
    assert.equal((await db.query(`insert into system_configurations(company_id) values ('${company}') returning configuration_number`)).rows[0].configuration_number,'SC-2026-0004');
  });
  const rows = { system_profile_cuts: [{ profile_id:profile, profile_code:'A', profile_name:'A', cut_length_mm:1000, quantity:2,total_weight_kg:10,total_length_m:2 }], system_glass_cuts:[],system_beading_cuts:[],system_hardware_bom:[],system_material_summary:[] };
  async function save(payload=rows, timestamp) {
    const current = (await db.query("select updated_at::text as stamp from system_configurations where id=$1",[cfg])).rows[0].stamp;
    return db.query("select public.save_system_configuration_atomic($1,'calculation',$2,$3,$4)",[cfg,timestamp ?? current,{status:'calculated',subtotal:100,grand_total:118},payload]);
  }
  await check("calculation replacement is atomic, rejects stale writes and cross-company references", async () => {
    await save();
    const before = (await db.query(`select id from system_profile_cuts where configuration_id='${cfg}'`)).rows[0].id;
    const oldTime = (await db.query(`select updated_at::text as stamp from system_configurations where id='${cfg}'`)).rows[0].stamp;
    await assert.rejects(save({...rows,system_profile_cuts:[{...rows.system_profile_cuts[0],cut_length_mm:-1}]}),/check constraint/);
    await assert.rejects(save({...rows,system_hardware_bom:[{amount:'invalid numeric'}]}),/invalid input syntax/);
    assert.equal((await db.query(`select id from system_profile_cuts where configuration_id='${cfg}'`)).rows[0].id,before);
    await assert.rejects(save({...rows,system_profile_cuts:[{...rows.system_profile_cuts[0],profile_id:other}]}),/another company/);
    await save();
    await assert.rejects(save(rows,oldTime),/changed/);
    assert.equal((await db.query(`select grand_total from system_configurations where id='${cfg}'`)).rows[0].grand_total,'118');
  });
  await check("draft reset clears outputs atomically and rejects cross-company headers", async () => {
    await assert.rejects(db.query("select public.save_system_configuration_atomic($1,'draft',null,$2,'{}')",[cfg,{customer_id:other}]),/another company/);
    assert.equal((await db.query(`select count(*)::int as n from system_profile_cuts where configuration_id='${cfg}'`)).rows[0].n,1);
    await db.query("select public.save_system_configuration_atomic($1,'draft',null,$2,'{}')",[cfg,{project_name:'Revised'}]);
    assert.equal((await db.query(`select count(*)::int as n from system_profile_cuts where configuration_id='${cfg}'`)).rows[0].n,0);
    const header = (await db.query(`select status,grand_total from system_configurations where id='${cfg}'`)).rows[0];
    assert.equal(header.status,'draft'); assert.equal(Number(header.grand_total),0);
    await save();
  });
  await check("160kg cannot reserve a 100kg batch, including updates and capacity reductions", async () => {
    await db.exec(`update system_configurations set order_id='${order}' where id='${cfg}'`);
    const first = (await db.query(`insert into profile_stock_reservations(company_id,profile_stock_batch_id,profile_id,order_id,configuration_id,reserved_weight_kg,status) values ('${company}','${batch}','${profile}','${order}','${cfg}',80,'active') returning id,reserved_length_m`)).rows[0];
    assert.equal(Number(first.reserved_length_m),40);
    await assert.rejects(db.exec(`insert into profile_stock_reservations(company_id,profile_stock_batch_id,profile_id,order_id,reserved_weight_kg,status) values ('${company}','${batch}','${profile}','${order}',80,'active')`),/Insufficient stock/);
    await assert.rejects(db.exec(`update profile_stock_reservations set reserved_weight_kg=101 where id='${first.id}'`),/Insufficient stock/);
    await assert.rejects(db.exec(`update profile_stock_batches set total_weight_kg=79 where id='${batch}'`),/active reservations/);
    await assert.rejects(db.exec(`insert into profile_stock_reservations(company_id,profile_stock_batch_id,profile_id,order_id,reserved_weight_kg,status) values ('${other}','${batch}','${profile}','${order}',1,'active')`),/company/);
  });
  await check("viewer and sales cannot bypass configuration or reservation roles", async () => {
    for (const table of ['system_configurations','system_profile_cuts','profile_stock_reservations']) await db.exec(`alter table ${table} enable row level security; grant select,insert,update,delete on ${table} to authenticated;`);
    await db.exec("grant usage on schema public,private,auth to authenticated; grant execute on function private.get_current_user_role(),private.get_current_user_company_id() to authenticated;");
    for (const role of ['viewer','sales']) {
      await db.exec(`set test.app_role='${role}'; set role authenticated;`);
      assert.equal((await db.query(`update system_configurations set status='in_production' where id='${cfg}' returning id`)).rows.length,0);
      assert.equal((await db.query("update profile_stock_reservations set status='released' returning id")).rows.length,0);
      await assert.rejects(save(),/Permission denied/);
      await db.exec("reset role; reset test.app_role;");
    }
    assert.equal((await db.query("select count(*)::int as n from pg_policies where tablename='system_configurations' and policyname='system_configurations_tenant_isolation'")).rows[0].n,0);
  });
  await check("linked configurations cannot reset, delete outputs, or unlink their order", async () => {
    await assert.rejects(db.exec(`update system_configurations set status='draft',order_id=null,quote_id=null where id='${cfg}'`),/immutable/);
    await assert.rejects(save(),/immutable/);
    await assert.rejects(db.exec(`delete from system_profile_cuts where configuration_id='${cfg}'`),/immutable/);
    await assert.rejects(db.exec(`delete from system_configurations where id='${cfg}'`),/cannot be deleted/);
  });
  await check("handoff selects unique source lines, rejects ambiguity, accepts exact duplicate-profile selection", async () => {
    const line = (await db.query(`insert into order_items(company_id,order_id,profile_id,gst_percent,hsn_code) values ('${company}','${order}','${profile}',18,'7604') returning id`)).rows[0].id;
    const job = {profile_id:profile,die_id:profile,planned_quantity_kg:10,planned_meters:2,remarks:'System configuration test'};
    const second = (await db.query(`insert into order_items(company_id,order_id,profile_id,gst_percent,hsn_code) values ('${company}','${order}','${profile}',18,'7604') returning id`)).rows[0].id;
    await assert.rejects(db.query("select private.handoff_system_configuration_to_production_atomic($1,$2,'test')",[cfg,[job]]),/exact order line/);
    assert.equal((await db.query(`select count(*)::int as n from production_jobs where order_id='${order}'`)).rows[0].n,0);
    await assert.rejects(db.query("select private.handoff_system_configuration_to_production_atomic($1,$2,'test')",[cfg,[{...job,source_line_id:other}]]),/must belong/);
    await db.query("select private.handoff_system_configuration_to_production_atomic($1,$2,'test')",[cfg,[{...job,source_line_id:second}]]);
    assert.equal((await db.query(`select source_line_id from production_jobs where order_id='${order}'`)).rows[0].source_line_id,second);
    const next = (await db.query(`insert into system_configurations(company_id,customer_id,status,order_id) values ('${company}','${customer}','calculated','${order}') returning id`)).rows[0].id;
    await db.exec(`delete from order_items where id='${line}'`);
    await db.query("select private.handoff_system_configuration_to_production_atomic($1,$2,'test')",[next,[job]]);
    assert.equal((await db.query(`select count(*)::int as n from production_jobs where order_id='${order}' and source_line_id='${second}'`)).rows[0].n,2);
  });
  await check("packing GST cannot override commercial GST including legitimate zero rates", async () => {
    const line = (await db.query(`select id from order_items where order_id='${order}' limit 1`)).rows[0].id;
    const packing = (await db.query(`insert into packing_list_items(company_id,profile_id,order_item_id,gst_percent) values ('${company}','${profile}','${line}',0) returning id`)).rows[0].id;
    assert.equal(Number((await db.query('select gst_percent from packing_list_items where id=$1',[packing])).rows[0].gst_percent),18);
    const item = (await db.query(`insert into invoice_items(company_id,source_line_id,gst_percent) values ('${company}','${packing}',0) returning gst_percent`)).rows[0];
    assert.equal(Number(item.gst_percent),18);
    await db.exec(`update order_items set gst_percent=0 where id='${line}'; update packing_list_items set gst_percent=18 where id='${packing}'`);
    assert.equal(Number((await db.query(`insert into invoice_items(company_id,source_line_id) values ('${company}','${packing}') returning gst_percent`)).rows[0].gst_percent),0);
  });
  await check("invoice parties survive master edits and cannot be overwritten", async () => {
    const invoice = (await db.query(`insert into invoices(company_id,customer_id,invoice_date,status,place_of_supply_state_code) values ('${company}','${customer}','2026-09-30','generated','08') returning *`)).rows[0];
    await db.exec(`update companies set legal_name='Changed Supplier',gst_number='08CHANGED',billing_address='New supplier'; update customers set customer_name='Changed Customer',gst_number='08CHANGED',billing_address='New address';`);
    const after = (await db.query('select * from invoices where id=$1',[invoice.id])).rows[0];
    assert.deepEqual(after.supplier_snapshot,invoice.supplier_snapshot);
    assert.deepEqual(after.customer_snapshot,invoice.customer_snapshot);
    assert.equal(after.customer_snapshot.customer_name,'Original Customer');
    await assert.rejects(db.query("update invoices set supplier_snapshot='{}' where id=$1",[invoice.id]),/immutable/);
    assert.equal((await db.query("select supplier_snapshot from invoices where id='55555555-5555-4555-8555-555555555555'")).rows[0].supplier_snapshot,null);
  });
  await check("foundry trigger preserves allocated identity through furnace edits", async () => {
    const row = (await db.query(`insert into foundry_batches(company_id,batch_number,furnace_number,production_date,billet_diameter_mm,billet_length_mm,alloy_density_kg_m3,billet_count) values ('${company}','forged','F1','2026-09-30',150,600,2700,10) returning id,batch_number`)).rows[0];
    assert.match(row.batch_number,/^FB-2026-\d{4}$/);
    assert.equal((await db.query("update foundry_batches set furnace_number='F2',production_date='2026-10-01' where id=$1 returning batch_number",[row.id])).rows[0].batch_number,row.batch_number);
  });
  await check("completed finishing weights remain frozen for packaging and QC", async () => {
    const row = (await db.query(`insert into finishing_jobs(company_id,order_id,status,finishing_type,input_weight_kg,output_weight_kg,rejection_weight_kg) values ('${company}','${order}','planned','powder_coating',100,90,10) returning id`)).rows[0];
    await db.query("update finishing_jobs set status='in_process' where id=$1",[row.id]);
    await db.query("update finishing_jobs set status='completed',received_date='2026-09-30' where id=$1",[row.id]);
    for (const column of ['input_weight_kg','output_weight_kg','rejection_weight_kg']) await assert.rejects(db.query(`update finishing_jobs set ${column}=1 where id=$1`,[row.id]),/immutable/);
    await assert.rejects(db.query("update finishing_jobs set status='planned' where id=$1",[row.id]),/cannot be reopened/);
  });
  await check("audit RPC rejects anonymous callers and trigger helpers remain private", async () => {
    assert.equal((await db.query("select has_function_privilege('anon','public.save_system_configuration_atomic(uuid,text,timestamptz,jsonb,jsonb)','execute') as allowed")).rows[0].allowed,false);
    for (const name of ['guard_configuration_lifecycle','guard_configuration_child','guard_profile_reservation_capacity','guard_reserved_stock_capacity','snapshot_invoice_parties','canonicalize_packing_tax']) {
      assert.equal((await db.query("select has_function_privilege('authenticated',$1,'execute') as allowed",[`private.${name}()`])).rows[0].allowed,false,name);
    }
  });
  console.log(`${checks} ASTRA SQL checks passed. Isolated fixture, not live RLS or independent-session concurrency.`);
}

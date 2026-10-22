import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { createHistoricalTables, sqlDefinition } from "./historical-schema-fixture.mjs";

export const directOrderCandidate = "20261015040000_direct_priced_orders.sql";
const source = readFileSync(new URL(`../../supabase/migrations/${directOrderCandidate}`,import.meta.url),"utf8");
export const fixtureId = n => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;

export async function installDirectOrderCandidateObjects(db) {
  // Extract object definitions only. Never execute the prepared migration wrapper.
  const table = source.match(/create table if not exists private\.direct_order_requests[\s\S]*?\n\);/);
  assert.ok(table);
  await db.exec(table[0]);
  const rls=source.match(/alter table private\.direct_order_requests enable row level security;/);
  assert.ok(rls);await db.exec(rls[0]);
  const functions = [...source.matchAll(/create or replace function ([\w.]+)\(/g)].map(match=>match[1]);
  for (const name of functions) {
    try { await db.exec(sqlDefinition(directOrderCandidate,name)); }
    catch(error) { throw new Error(`${name}: ${error.message}${error.where ? ` (${error.where})` : ""}`); }
  }
  for (const statement of source.match(/(?:create trigger|revoke|grant)[^;]+;/gi) ?? []) await db.exec(statement);
  return { functions: functions.length, triggers: (source.match(/create trigger/g) ?? []).length };
}

export async function createDirectOrderFixture({ candidate = true } = {}) {
  const db = new PGlite();
  try {
    await db.exec(`create schema auth;create schema private;create role authenticated;create role anon;
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;`);
    await createHistoricalTables(db,["companies","app_users","customers","aluminium_profiles","dies","orders","order_items","quotes","quote_items",
      "order_stage_history","audit_logs","order_billet_requirements","foundry_billets","factory_load_consolidations","production_jobs",
      "order_dealer_stock_fulfillments","profile_stock_reservations","dispatches","packing_list_items","invoices","invoice_items"],directOrderCandidate);
    await db.exec(`create function private.get_current_user_company_id() returns uuid language sql security definer as
        $$select company_id from app_users where id=auth.uid() and is_active$$;
      create function private.get_current_user_role() returns text language sql security definer as
        $$select role::text from app_users where id=auth.uid() and is_active$$;
      create function private.get_current_user_dealer_id() returns uuid language sql security definer as
        $$select dealer_id from app_users where id=auth.uid() and is_active$$;
      create function public.get_current_user_company_id() returns uuid language sql security definer as $$select private.get_current_user_company_id()$$;
      create unique index fixture_order_number on orders(company_id,order_number);
      create unique index fixture_material_group on order_billet_requirements(company_id,order_id,profile_id,alloy,temper,billet_diameter_inch);
      alter table order_billet_requirements alter column billets_allocated set default 0,alter column billets_short set default 0,alter column status set default 'pending';
      create table private.quote_fulfillment_authorizations(transaction_id bigint,company_id uuid,quote_id uuid,actor_id uuid);
      revoke all on private.quote_fulfillment_authorizations from public,anon,authenticated;
      insert into companies(id) values('${fixtureId(1)}'),('${fixtureId(2)}');
      insert into app_users(id,company_id,role,is_active) values('${fixtureId(3)}','${fixtureId(1)}','sales',true),('${fixtureId(4)}','${fixtureId(2)}','sales',true);
      insert into customers(id,company_id,customer_name) values('${fixtureId(10)}','${fixtureId(1)}','Synthetic Customer'),('${fixtureId(11)}','${fixtureId(2)}','Other Customer');
      insert into aluminium_profiles(id,company_id,profile_code,profile_name,is_active,section_weight_kg_per_m,alloy,temper,billet_diameter_required_inch,hsn_code,drawing_approval_status)
        values('${fixtureId(20)}','${fixtureId(1)}','P-001','First section',true,0.500,'6063','T6',6,'760421','Approved'),
          ('${fixtureId(21)}','${fixtureId(1)}','P-002','Second section',true,1.125,'6061','T6',8,'760429','Pending'),
          ('${fixtureId(22)}','${fixtureId(2)}','OTHER','Other section',true,0.500,'6063','T6',6,'760421','Approved');
      insert into dies(id,company_id,profile_id,die_status,billet_diameter_required_inch)
        values('${fixtureId(30)}','${fixtureId(1)}','${fixtureId(20)}','active',6),
          ('${fixtureId(31)}','${fixtureId(2)}','${fixtureId(22)}','active',6);`);
    for (const [file,names] of [
      ["20260715000000_atomic_business_workflows.sql",["private.keep_jsonb_keys","private.insert_jsonb_row","private.update_jsonb_row"]],
      ["20260930000000_astra_audit_fixes.sql",["private.next_business_number_locked"]],
      ["20260810030000_quote_and_order_financial_integrity.sql",["private.save_order_atomic"]],
      ["20260929000000_business_logic_fixes.sql",["public.derive_order_value_from_quote","private.refresh_direct_order_value","private.canonicalize_invoice_tax_line"]],
      ["20260530000002_foundry_billet_allocation_repairs.sql",["public.repair_order_billet_requirement_links","public.refresh_order_billet_allocations"]],
      ["20260515005600_order_billet_requirements_and_allocation.sql",["public.rebuild_order_billet_requirements","public.handle_order_billet_requirements"]],
      ["20261008020000_factory_workflow_integrity.sql",["private.order_has_remaining_production","public.allocate_billets_by_priority","private.guard_production_order_balance"]],
      ["20261013010000_dealer_fulfillment_integrity.sql",["private.guard_order_workflow_writes","private.guard_order_item_workflow_writes"]],
      ["20260721091620_quote_atomic_dealer_lineage.sql",["private.canonicalize_packing_commercial_lineage","private.canonicalize_invoice_commercial_lineage"]]
    ]) for (const name of names) await db.exec(sqlDefinition(file,name));
    await db.exec(`create trigger derive_order_value_from_quote before insert or update of company_id,quote_id,customer_id,order_value on orders for each row execute function public.derive_order_value_from_quote();
      create trigger refresh_direct_order_value after insert or update or delete on order_items for each row execute function private.refresh_direct_order_value();
      create trigger z_guard_order_workflow_writes before insert or update or delete on orders for each row execute function private.guard_order_workflow_writes();
      create trigger z_guard_order_item_workflow_writes before insert or update or delete on order_items for each row execute function private.guard_order_item_workflow_writes();
      create trigger handle_order_billet_requirements after insert or update of quote_id,production_profile_id,production_die_id,manufacturing_weight_kg,production_quantity_kg,billet_diameter_required_inch,priority,current_stage on orders
        for each row execute function public.handle_order_billet_requirements();
      create trigger guard_production_order_balance before insert or update of company_id,order_id,source_line_id,planned_quantity_kg,actual_quantity_kg,status on production_jobs for each row execute function private.guard_production_order_balance();
      create trigger canonicalize_packing_commercial_lineage before insert or update on packing_list_items for each row execute function private.canonicalize_packing_commercial_lineage();
      create trigger zz_canonicalize_invoice_commercial_lineage before insert or update on invoice_items for each row execute function private.canonicalize_invoice_commercial_lineage();
      create trigger zzz_canonicalize_invoice_tax_line before insert or update on invoice_items for each row execute function private.canonicalize_invoice_tax_line();
      grant usage on schema public,auth,private to authenticated,anon;
      grant all on all tables in schema public to authenticated;
      revoke all on function private.insert_jsonb_row(regclass,jsonb),private.update_jsonb_row(regclass,uuid,uuid,jsonb),
        private.save_order_atomic(uuid,jsonb),public.rebuild_order_billet_requirements(uuid) from public,anon,authenticated;`);
    if (candidate) await installDirectOrderCandidateObjects(db);
    return db;
  } catch (error) { await db.close(); throw error; }
}

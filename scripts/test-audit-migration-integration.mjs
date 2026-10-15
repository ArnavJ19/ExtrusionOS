import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { createHistoricalTables, historicalColumns, sqlDefinition } from "./lib/historical-schema-fixture.mjs";
import { installDirectOrderCandidateObjects } from "./lib/direct-order-fixture.mjs";
import { installDispatchReservationLedgerObjects } from "./lib/dispatch-reservation-ledger-fixture.mjs";
import { installOrderCancellationStockObjects } from "./lib/order-cancellation-stock-fixture.mjs";

const first = "20261008000000_foundry_material_integrity.sql";
const names = [first,"20261008010000_access_projection_integrity.sql","20261008020000_factory_workflow_integrity.sql",
  "20261008030000_configuration_quote_integrity.sql","20261008040000_management_metrics_integrity.sql",
  "20261008050000_operation_search_integrity.sql","20261013000000_audit_workflow_followup.sql",
  "20261013010000_dealer_fulfillment_integrity.sql"];
const read = name => readFileSync(new URL(`../supabase/migrations/${name}`,import.meta.url),"utf8");
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;

// Whole audit migrations share historical column types here. This fixture does
// not replace replay of the full Supabase chain, JWTs or independent sessions.
export async function runAuditMigrationIntegrationChecks() {
  const db = new PGlite();
  try {
    await db.exec(`create schema auth;create schema private;create role authenticated;create role anon;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
      grant usage on schema auth,public to authenticated;`);
    const tables = [...historicalColumns(first).keys()];
    await createHistoricalTables(db,tables,first);
    await db.exec(`create function private.get_current_user_company_id() returns uuid language sql security definer as $$select company_id from app_users where id=auth.uid() and is_active$$;
      create function private.get_current_user_role() returns text language sql security definer as $$select role::text from app_users where id=auth.uid() and is_active$$;
      create function private.get_current_user_dealer_id() returns uuid language sql security definer as $$select nullif(current_setting('test.dealer',true),'')::uuid$$;
      create function public.get_current_user_company_id() returns uuid language sql security definer as $$select private.get_current_user_company_id()$$;
      create function public.get_current_user_role() returns text language sql security definer as $$select private.get_current_user_role()$$;
      insert into auth.users values('${id(2)}');
      insert into companies(id) values('${id(1)}');
      insert into app_users(id,company_id,role,is_active) values('${id(2)}','${id(1)}','owner',true);
      set test.actor='${id(2)}';
      grant all on all tables in schema public to authenticated;`);
    for (const [file, functions] of [
      ["20260930000000_astra_audit_fixes.sql",["public.refresh_foundry_batch_calculations"]],
      ["20260718021500_floor_output_and_finishing_workflows.sql",["private.complete_production_job_atomic"]],
      ["20260723070000_dispatch_return_credit_notes.sql",["private.issue_dispatch_return_credit_note_atomic","private.reverse_credit_note_atomic"]],
      ["20260929000000_business_logic_fixes.sql",["private.convert_quote_to_order_atomic"]],
      ["20260718010100_financial_collection_analytics.sql",["private.get_financial_collection_events"]]
    ]) for (const name of functions) await db.exec(sqlDefinition(file,name));
    for (const name of names) {
      try {await db.exec(read(name));}
      catch(error){throw new Error(`${name}: ${error.message}${error.where ? ` (${error.where})` : ""}`);}
    }
    // Prepared follow-ups use extracted function/trigger objects; their migration scripts are not applied.
    await db.exec(sqlDefinition("20261015000000_reservation_release_replay_integrity.sql","private.consume_dispatch_reservations"));
    await db.exec(sqlDefinition("20261015010000_reservation_ledger_projection.sql","public.get_profile_stock_reservation_ledger_page"));
    for (const statement of read("20261015010000_reservation_ledger_projection.sql").match(/(?:revoke|grant)[^;]+;/g) ?? []) await db.exec(statement);
    await db.exec(sqlDefinition("20261015020000_credit_settlement_exclusivity.sql","private.enforce_invoice_credit_settlement_exclusivity"));
    for (const statement of read("20261015020000_credit_settlement_exclusivity.sql").match(/(?:create trigger|revoke)[^;]+;/gi) ?? []) await db.exec(statement);
    await db.exec(sqlDefinition("20261015030000_credit_note_retry_binding.sql","private.issue_dispatch_return_credit_note_atomic"));
    for (const statement of read("20261015030000_credit_note_retry_binding.sql").match(/revoke[^;]+;/gi) ?? []) await db.exec(statement);
    const directObjects = await installDirectOrderCandidateObjects(db);
    const dispatchReservationObjects = await installDispatchReservationLedgerObjects(db);
    const cancellationObjects = await installOrderCancellationStockObjects(db);
    const views = await db.query(`select table_name from information_schema.views where table_schema='public' and table_name like '%_authorized' order by table_name`);
    assert.ok(views.rows.length >= 10);
    await db.exec("set role authenticated;");
    for (const {table_name} of views.rows) await db.query(`select * from public."${table_name}" limit 0`);
    const ledger = (await db.query("select public.get_profile_stock_reservation_ledger_page() data")).rows[0].data;
    assert.equal(ledger.total_count,0);
    assert.deepEqual(ledger.rows,[]);
    await db.exec("reset role;");
    const masks = await db.query(`select has_column_privilege('authenticated','public.orders','order_value','SELECT') as order_value,
      has_column_privilege('authenticated','public.system_configurations','internal_cost','SELECT') as internal_cost,
      has_function_privilege('anon','public.get_dealer_quote_stock_availability(uuid)','EXECUTE') as anonymous_availability,
      has_function_privilege('anon','public.get_profile_stock_reservation_ledger_page(integer,text,text,text,text)','EXECUTE') as anonymous_ledger,
      has_function_privilege('authenticated','private.consume_dispatch_reservations(uuid)','EXECUTE') as direct_consume,
      has_function_privilege('authenticated','private.enforce_invoice_credit_settlement_exclusivity()','EXECUTE') as direct_credit_guard,
      has_function_privilege('authenticated','private.issue_dispatch_return_credit_note_atomic(uuid,text,uuid)','EXECUTE') as direct_credit_issue,
      has_function_privilege('anon','public.create_direct_order_atomic(jsonb,jsonb,uuid)','EXECUTE') as anonymous_direct_order,
      has_function_privilege('authenticated','private.create_direct_order_atomic(jsonb,jsonb,uuid)','EXECUTE') as direct_order_implementation,
      has_table_privilege('authenticated','private.direct_order_requests','SELECT') as direct_request_read,
      has_function_privilege('anon','public.get_dispatch_reservation_ledger_page(uuid,integer)','EXECUTE') as anonymous_dispatch_ledger,
      has_function_privilege('authenticated','private.profile_stock_reservation_ledger_page(integer,text,text,text,text,uuid)','EXECUTE') as private_ledger_calculation,
      has_function_privilege('authenticated','public.credit_dealer_stock_on_order_cancel()','EXECUTE') as direct_cancellation_trigger,
      has_function_privilege('authenticated','private.guard_cancelled_order_reservations()','EXECUTE') as direct_cancellation_guard`);
    assert.deepEqual(masks.rows[0],{order_value:false,internal_cost:false,anonymous_availability:false,anonymous_ledger:false,direct_consume:false,direct_credit_guard:false,direct_credit_issue:false,
      anonymous_direct_order:false,direct_order_implementation:false,direct_request_read:false,anonymous_dispatch_ledger:false,private_ledger_calculation:false,
      direct_cancellation_trigger:false,direct_cancellation_guard:false});
    const guards = await db.query(`select tgname from pg_trigger where not tgisinternal and tgenabled='O'
      and tgfoid='private.enforce_invoice_credit_settlement_exclusivity()'::regprocedure order by tgname`);
    assert.deepEqual(guards.rows.map(row=>row.tgname),["credit_notes_settlement_exclusivity","payments_credit_settlement_exclusivity"]);
    return {migrations:names.length,preparedFunctions:4+directObjects.functions+dispatchReservationObjects.functions+cancellationObjects.functions,
      preparedTriggers:guards.rows.length+directObjects.triggers+cancellationObjects.triggers,views:views.rows.length,tables:tables.length};
  } finally {await db.close();}
}

if (process.argv[1] && new URL(import.meta.url).pathname.endsWith(process.argv[1].replaceAll("\\","/"))) {
  try {console.log("PASS integrated audit migrations",await runAuditMigrationIntegrationChecks());}
  catch(error){console.error(error.message);process.exitCode=1;}
}

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { createHistoricalTables, historicalColumns, sqlDefinition } from "./lib/historical-schema-fixture.mjs";
import { installDirectOrderCandidateObjects } from "./lib/direct-order-fixture.mjs";
import { installDispatchReservationLedgerObjects } from "./lib/dispatch-reservation-ledger-fixture.mjs";
import { installOrderCancellationStockObjects } from "./lib/order-cancellation-stock-fixture.mjs";
import { installRetainedInvoiceObjects } from "./lib/retained-invoice-fixture.mjs";
import { installTerminalFinishingCandidateObjects } from "./lib/finishing-evidence-fixture.mjs";
import { installPartialFinishingCandidateObjects,historicalDefinition } from "./lib/finishing-partial-retry-fixture.mjs";
import { installPackagingEvidenceCandidateObjects } from "./lib/packaging-evidence-fixture.mjs";
import { installFinishingWorkloadObjects } from "./lib/finishing-workload-fixture.mjs";
import { installBilletLinkRepairObjects } from "./lib/billet-link-repair-fixture.mjs";

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
    const retainedInvoiceObjects = await installRetainedInvoiceObjects(db);
    const finishingObjects = await installTerminalFinishingCandidateObjects(db);
    const partialFinishingObjects = await installPartialFinishingCandidateObjects(db);
    for(const name of ['public.apply_packaging_material_stock_from_materials','public.handle_packaging_job_status_change'])await db.exec(historicalDefinition('20260530000000_packaging_multiple_materials.sql',name));
    const packagingEvidenceObjects = await installPackagingEvidenceCandidateObjects(db);
    const finishingWorkloadObjects = await installFinishingWorkloadObjects(db);
    const billetLinkRepairObjects = await installBilletLinkRepairObjects(db);
    const views = await db.query(`select table_name from information_schema.views where table_schema='public' and table_name like '%_authorized' order by table_name`);
    assert.ok(views.rows.length >= 10);
    await db.exec("set role authenticated;");
    for (const {table_name} of views.rows) await db.query(`select * from public."${table_name}" limit 0`);
    await db.query("select * from public.finishing_accepted_outputs limit 0");
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
      has_function_privilege('authenticated','private.guard_cancelled_order_reservations()','EXECUTE') as direct_cancellation_guard,
      has_function_privilege('authenticated','public.repair_order_billet_requirement_links(uuid)','EXECUTE') as direct_billet_link_repair`);
    assert.deepEqual(masks.rows[0],{order_value:false,internal_cost:false,anonymous_availability:false,anonymous_ledger:false,direct_consume:false,direct_credit_guard:false,direct_credit_issue:false,
      anonymous_direct_order:false,direct_order_implementation:false,direct_request_read:false,anonymous_dispatch_ledger:false,private_ledger_calculation:false,
      direct_cancellation_trigger:false,direct_cancellation_guard:false,direct_billet_link_repair:false});
    const guards = await db.query(`select tgname from pg_trigger where not tgisinternal and tgenabled='O'
      and tgfoid='private.enforce_invoice_credit_settlement_exclusivity()'::regprocedure order by tgname`);
    assert.deepEqual(guards.rows.map(row=>row.tgname),["credit_notes_settlement_exclusivity","payments_credit_settlement_exclusivity"]);
    const invoiceMasks=(await db.query(`select has_function_privilege('anon','public.get_invoice_source_options(text,text,uuid,uuid,uuid)','EXECUTE') anonymous_sources,
      has_function_privilege('authenticated','public.get_invoice_source_options(text,text,uuid,uuid,uuid)','EXECUTE') sources,
      has_function_privilege('authenticated','private.invoice_dispatch_is_billable(uuid,uuid,uuid)','EXECUTE') private_eligibility,
      has_function_privilege('authenticated','public.validate_invoice_dispatch_billable()','EXECUTE') direct_header_guard`)).rows[0];
    assert.deepEqual(invoiceMasks,{anonymous_sources:false,sources:true,private_eligibility:false,direct_header_guard:false});
    const finishingGuard=(await db.query(`select trigger.tgtype::int mask,trigger.tgenabled,
      has_function_privilege('authenticated',procedure.oid,'execute') direct_guard,
      has_function_privilege('anon',procedure.oid,'execute') anonymous_guard,
      has_function_privilege('authenticated','private.transition_finishing_job_atomic(uuid,text,uuid,date,date,numeric,numeric,text)','execute') direct_update
      from pg_trigger trigger join pg_proc procedure on procedure.oid=trigger.tgfoid
      where trigger.tgrelid='public.finishing_jobs'::regclass and trigger.tgname='guard_terminal_finishing_evidence'`)).rows[0];
    assert.equal(finishingGuard.mask&24,24);assert.equal(finishingGuard.tgenabled,"O");
    assert.equal(finishingGuard.direct_guard,false);assert.equal(finishingGuard.anonymous_guard,false);assert.equal(finishingGuard.direct_update,false);
    const partialAcl=(await db.query(`select has_function_privilege('anon','public.get_finished_production_readiness(uuid)','execute') anonymous,
      has_function_privilege('authenticated','public.get_finished_production_readiness(uuid)','execute') reader,
      has_function_privilege('authenticated','private.finishing_dispatch_ready_kg(uuid,uuid,uuid,boolean)','execute') private_calculation,
      has_function_privilege('authenticated','private.guard_packaging_finishing_source()','execute') private_guard`)).rows[0];
    assert.deepEqual(partialAcl,{anonymous:false,reader:true,private_calculation:false,private_guard:false});
    const packagingAcl=(await db.query(`select has_table_privilege('authenticated','public.packaging_material_movements','insert') client_insert,
      has_any_column_privilege('authenticated','public.packaging_material_movements','insert') column_insert,
      has_function_privilege('authenticated','private.guard_packaging_evidence_delete()','execute') direct_guard,
      has_function_privilege('authenticated','public.apply_packaging_material_stock_from_materials()','execute') direct_stock_trigger`)).rows[0];
    assert.deepEqual(packagingAcl,{client_insert:false,column_insert:false,direct_guard:false,direct_stock_trigger:false});
    return {migrations:names.length,preparedFunctions:4+directObjects.functions+dispatchReservationObjects.functions+cancellationObjects.functions+retainedInvoiceObjects.functions+finishingObjects.functions+partialFinishingObjects.functions+packagingEvidenceObjects.functions+finishingWorkloadObjects.functions+billetLinkRepairObjects.functions,
      preparedTriggers:guards.rows.length+directObjects.triggers+cancellationObjects.triggers+retainedInvoiceObjects.triggers+finishingObjects.triggers+partialFinishingObjects.triggers+packagingEvidenceObjects.triggers,views:views.rows.length,tables:tables.length};
  } finally {await db.close();}
}

if (process.argv[1] && new URL(import.meta.url).pathname.endsWith(process.argv[1].replaceAll("\\","/"))) {
  try {console.log("PASS integrated audit migrations",await runAuditMigrationIntegrationChecks());}
  catch(error){console.error(error.message);process.exitCode=1;}
}

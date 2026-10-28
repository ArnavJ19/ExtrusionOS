-- Read-only catalog checks. Run on disposable staging before any paired release.
-- REST exposure is not proof of the migration ledger or authenticated privileges.
with required(name) as (
  values ('save_system_configuration_atomic'), ('submit_dealer_receipt_atomic'),
         ('save_order_atomic'), ('create_direct_order_atomic'), ('save_ready_dispatch_atomic'),
         ('generate_system_quote_atomic'), ('handoff_system_configuration_to_production_atomic'),
         ('complete_production_job_atomic'), ('correct_completed_production_output_atomic'),
         ('resolve_quality_rework_atomic'), ('list_open_quality_rework_inspections'),
         ('get_profile_stock_consumption_totals'), ('get_profile_stock_reservation_ledger_page'), ('get_dispatch_reservation_ledger_page'), ('get_dealer_quote_stock_availability'), ('issue_dispatch_return_credit_note_atomic'),
         ('get_finished_production_readiness'),
         ('get_finishing_workload'),
         ('get_manual_billet_allocation_options'),
         ('reverse_credit_note_atomic'), ('get_invoice_source_options'), ('get_dashboard_snapshot'),
         ('get_advanced_analytics_snapshot'), ('get_operation_database_page')
)
select required.name, procedure.oid::regprocedure as signature,
       procedure.prosecdef as security_definer,
       has_function_privilege('authenticated', procedure.oid, 'execute') as authenticated_execute,
       has_function_privilege('anon', procedure.oid, 'execute') as anonymous_execute
from required
left join pg_namespace namespace on namespace.nspname = 'public'
left join pg_proc procedure on procedure.pronamespace = namespace.oid
  and procedure.proname = required.name
order by required.name;

with required(relation,name) as (
  values ('invoices','supplier_snapshot'), ('invoices','customer_snapshot'),
    ('quotes','system_configuration_id'), ('quote_items','configuration_cut_snapshot'),
    ('order_items','configuration_cut_snapshot'), ('dispatches','actual_dispatched_at'),
    ('packing_list_items','net_length_m'), ('profile_stock_reservations','reserved_pieces'),
    ('packaging_jobs','finishing_job_id'),
    ('finishing_accepted_outputs','receipt_kind'),
    ('profile_stock_reservations','initial_reserved_weight_kg'),
    ('profile_stock_reservations','initial_reserved_length_m'),
    ('profile_stock_reservations','initial_reserved_pieces'), ('profile_stock_consumptions','consumed_pieces')
)
select required.relation, required.name, attribute.attname is not null as present
from required
left join pg_attribute attribute on attribute.attrelid = to_regclass('public.' || required.relation)
  and attribute.attname = required.name and attribute.attnum > 0 and not attribute.attisdropped;

select tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('customers','quotes','quote_items','orders','order_items',
    'system_configurations','system_material_summary','profile_stock_reservations')
order by tablename, policyname;

select to_regclass('supabase_migrations.schema_migrations') is not null as migration_ledger_present;
-- If the preceding result is true, inspect version/name from
-- supabase_migrations.schema_migrations and compare all checkout prerequisites.
-- Do not clear historical findings by deleting records or fabricating lineage.

-- The automatic allocator is internal and uses R22's per-profile eligibility.
select procedure.oid is not null present,procedure.prosecdef security_definer,
  procedure.proconfig,md5(procedure.prosrc) definition_md5,
  has_function_privilege('authenticated',procedure.oid,'execute') authenticated_execute,
  has_function_privilege('anon',procedure.oid,'execute') anonymous_execute,
  to_regprocedure('private.order_profile_needs_billet_allocation(uuid,uuid,uuid)') is not null profile_helper_present
from (select to_regprocedure('public.allocate_billets_by_priority(uuid)') oid) required
left join pg_proc procedure on procedure.oid=required.oid;

-- Retained-shipment invoicing requires revised bodies and its attached header guard.
with required(signature) as (
  values ('private.invoice_dispatch_is_billable(uuid,uuid,uuid)'),
    ('private.save_invoice_atomic(uuid,jsonb,jsonb,boolean)'),('private.replace_invoice_items_atomic(uuid,jsonb)'),
    ('public.validate_invoice_dispatch_billable()')
)
select required.signature,procedure.oid is not null present,procedure.prosecdef security_definer,
  has_function_privilege('authenticated',procedure.oid,'execute') authenticated_execute,
  has_function_privilege('anon',procedure.oid,'execute') anonymous_execute,
  case when required.signature='public.validate_invoice_dispatch_billable()' then exists(
    select 1 from pg_trigger where tgrelid='public.invoices'::regclass and tgname='validate_invoice_dispatch_billable'
      and tgfoid=procedure.oid and tgenabled in ('O','A') and not tgisinternal) end attached
from required left join pg_proc procedure on procedure.oid=to_regprocedure(required.signature);

-- Order cancellation guards require catalog/body review, not REST RPC discovery.
with required(relation,name,signature) as (
  values ('orders','credit_dealer_stock_on_order_cancel_trigger','public.credit_dealer_stock_on_order_cancel()'),
    ('profile_stock_reservations','aa_guard_cancelled_order_reservations','private.guard_cancelled_order_reservations()')
)
select required.relation,required.name,trigger.oid is not null attached,
  coalesce(trigger.tgenabled in ('O','A'),false) enabled,procedure.prosecdef security_definer,
  has_function_privilege('authenticated',to_regprocedure(required.signature),'execute') authenticated_execute,
  has_function_privilege('anon',to_regprocedure(required.signature),'execute') anonymous_execute
from required left join pg_trigger trigger on trigger.tgrelid=to_regclass('public.'||required.relation)
  and trigger.tgname=required.name and trigger.tgfoid=to_regprocedure(required.signature) and not trigger.tgisinternal
left join pg_proc procedure on procedure.oid=to_regprocedure(required.signature)
order by required.relation;

-- Direct order request contents are private; verify their ACL and snapshot guards.
with guard as (select to_regprocedure('private.guard_direct_order_snapshots()') oid),
required(relation,name) as (values ('orders','zy_guard_direct_order_snapshots'),('order_items','zy_guard_direct_order_line_snapshots'))
select required.relation,required.name,trigger.oid is not null attached,coalesce(trigger.tgenabled in ('O','A'),false) enabled,
  has_function_privilege('authenticated',guard.oid,'execute') authenticated_execute,
  has_function_privilege('anon',guard.oid,'execute') anonymous_execute,
  coalesce((select relrowsecurity from pg_class where oid=to_regclass('private.direct_order_requests')),false) request_rls,
  has_table_privilege('authenticated',to_regclass('private.direct_order_requests'),'SELECT') request_read,
  has_table_privilege('authenticated',to_regclass('private.direct_order_requests'),'INSERT') request_write
from required cross join guard left join pg_trigger trigger on trigger.tgrelid=to_regclass('public.'||required.relation)
  and trigger.tgname=required.name and trigger.tgfoid=guard.oid and not trigger.tgisinternal order by required.relation;

-- Credit settlement guards are private triggers and cannot be verified through REST RPC discovery.
with required(relation,name) as (
  values ('payments','payments_credit_settlement_exclusivity'),
    ('credit_notes','credit_notes_settlement_exclusivity')
), guard as (
  select to_regprocedure('private.enforce_invoice_credit_settlement_exclusivity()') oid
)
select required.relation, required.name, trigger.oid is not null as attached,
  coalesce(trigger.tgenabled in ('O','A'),false) as enabled,
  procedure.prosecdef as security_definer,
  has_function_privilege('authenticated',guard.oid,'execute') as authenticated_execute,
  has_function_privilege('anon',guard.oid,'execute') as anonymous_execute
from required cross join guard
left join pg_trigger trigger on trigger.tgrelid=to_regclass('public.'||required.relation)
  and trigger.tgname=required.name and trigger.tgfoid=guard.oid and not trigger.tgisinternal
left join pg_proc procedure on procedure.oid=guard.oid
order by required.relation;

-- R17 also requires the terminal-finishing guard and revised private transition body.
with required(signature) as (
  values ('private.guard_terminal_finishing_evidence()'),
    ('private.transition_finishing_job_atomic(uuid,text,uuid,date,date,numeric,numeric,text)')
)
select required.signature, procedure.oid is not null present,
  has_function_privilege('authenticated',procedure.oid,'execute') authenticated_execute,
  has_function_privilege('anon',procedure.oid,'execute') anonymous_execute,
  case when procedure.oid is not null then md5(pg_get_functiondef(procedure.oid)) end definition_md5,
  case when required.signature='private.guard_terminal_finishing_evidence()' then exists(
    select 1 from pg_trigger trigger where trigger.tgrelid=to_regclass('public.finishing_jobs')
      and trigger.tgname='guard_terminal_finishing_evidence' and trigger.tgfoid=procedure.oid
      and trigger.tgenabled in ('O','A') and (trigger.tgtype::integer & 24)=24 and not trigger.tgisinternal
  ) end update_delete_guard_attached
from required left join pg_proc procedure on procedure.oid=to_regprocedure(required.signature);

-- R18 accepted portions require receipt-linked packaging and the revised QC/readiness bodies.
with required(relation,name,signature) as (
  values ('finishing_jobs','aa_guard_finishing_material_lineage','private.guard_finishing_material_lineage()'),
    ('finishing_jobs','route_completed_finishing_to_packaging','public.route_completed_finishing_to_packaging()'),
    ('packaging_jobs','zz_guard_packaging_finishing_source','private.guard_packaging_finishing_source()')
)
select required.relation,required.name,trigger.oid is not null attached,trigger.tgenabled,
  trigger.tgtype::integer event_mask,procedure.prosecdef security_definer,
  has_function_privilege('authenticated',procedure.oid,'execute') authenticated_execute,
  has_function_privilege('anon',procedure.oid,'execute') anonymous_execute,
  case when procedure.oid is not null then md5(pg_get_functiondef(procedure.oid)) end definition_md5
from required left join pg_proc procedure on procedure.oid=to_regprocedure(required.signature)
left join pg_trigger trigger on trigger.tgrelid=to_regclass('public.'||required.relation) and trigger.tgname=required.name
  and trigger.tgfoid=procedure.oid and not trigger.tgisinternal;

-- R18 authoritative bodies must match the reviewed candidate, including deferred checks.
with required(signature) as (
  values ('private.assert_finishing_material_lineage(uuid,uuid)'),
    ('private.finishing_accepted_output_kg(uuid,uuid,uuid)'),
    ('private.finishing_dispatch_ready_kg(uuid,uuid,uuid,boolean)'),
    ('public.get_finished_production_readiness(uuid)'),
    ('public.validate_quality_production_link()'),
    ('private.save_packaging_job_atomic(uuid,jsonb,jsonb)'),
    ('private.assert_dispatch_ready(uuid)'),
    ('public.refresh_packaging_job_material()'),
    ('public.validate_completed_packaging_materials()')
)
select required.signature,procedure.oid is not null present,procedure.prosecdef security_definer,
  has_function_privilege('authenticated',procedure.oid,'execute') authenticated_execute,
  has_function_privilege('anon',procedure.oid,'execute') anonymous_execute,
  case when procedure.oid is not null then md5(pg_get_functiondef(procedure.oid)) end definition_md5
from required left join pg_proc procedure on procedure.oid=to_regprocedure(required.signature);

-- R19 packaging evidence guards must retain deletion and append-only protection.
with required(relation,name,signature) as (
  values ('packaging_jobs','guard_packaging_evidence_delete','private.guard_packaging_evidence_delete()'),
    ('packaging_material_movements','guard_packaging_material_movement_evidence','private.guard_packaging_material_movement_evidence()')
)
select required.relation,required.name,trigger.oid is not null attached,trigger.tgenabled,
  trigger.tgtype::integer event_mask,procedure.prosecdef security_definer,
  has_function_privilege('authenticated',procedure.oid,'execute') authenticated_execute,
  has_function_privilege('anon',procedure.oid,'execute') anonymous_execute,
  case when procedure.oid is not null then md5(pg_get_functiondef(procedure.oid)) end definition_md5
from required left join pg_proc procedure on procedure.oid=to_regprocedure(required.signature)
left join pg_trigger trigger on trigger.tgrelid=to_regclass('public.'||required.relation) and trigger.tgname=required.name
  and trigger.tgfoid=procedure.oid and not trigger.tgisinternal;

-- R19 ledger privileges must deny both table and column mutation grants.
select (select relrowsecurity from pg_class where oid=to_regclass('public.packaging_material_movements')) ledger_rls,
  has_table_privilege('authenticated','public.packaging_material_movements','select') authenticated_read,
  has_table_privilege('authenticated','public.packaging_material_movements','insert') authenticated_insert,
  has_any_column_privilege('authenticated','public.packaging_material_movements','insert') authenticated_column_insert,
  has_table_privilege('authenticated','public.packaging_material_movements','update') authenticated_update,
  has_any_column_privilege('authenticated','public.packaging_material_movements','update') authenticated_column_update,
  has_table_privilege('authenticated','public.packaging_material_movements','delete') authenticated_delete,
  has_table_privilege('anon','public.packaging_material_movements','insert') anonymous_insert;

-- R20 finishing workload uses a stable scoped projection, bounded pages and complete retry accounting.
select procedure.oid is not null present,procedure.prosecdef security_definer,procedure.provolatile volatility,
  has_function_privilege('authenticated',procedure.oid,'execute') authenticated_execute,
  has_function_privilege('anon',procedure.oid,'execute') anonymous_execute,
  case when procedure.oid is not null then md5(pg_get_functiondef(procedure.oid)) end definition_md5
from (select to_regprocedure('public.get_finishing_workload(uuid,uuid,uuid,text,text,text,text,integer)') oid) required
left join pg_proc procedure on procedure.oid=required.oid;

-- R21 link repair must retain internal-only execution and the reviewed body.
select procedure.oid is not null present,procedure.prosecdef security_definer,
  has_function_privilege('authenticated',procedure.oid,'execute') authenticated_execute,
  has_function_privilege('anon',procedure.oid,'execute') anonymous_execute,
  case when procedure.oid is not null then md5(pg_get_functiondef(procedure.oid)) end definition_md5
from (select to_regprocedure('public.repair_order_billet_requirement_links(uuid)') oid) required
left join pg_proc procedure on procedure.oid=required.oid;

-- R04/R10/R11 acceptance follow-up retains posted shipments after hold release.
with required(signature) as (
  values ('private.closed_reservation_has_exact_dispatch_posting(uuid,uuid)'),
    ('private.assert_dispatch_ready(uuid)')
)
select required.signature,procedure.oid is not null present,procedure.prosecdef security_definer,
  has_function_privilege('authenticated',procedure.oid,'execute') authenticated_execute,
  has_function_privilege('anon',procedure.oid,'execute') anonymous_execute,
  case when procedure.oid is not null then md5(pg_get_functiondef(procedure.oid)) end definition_md5,
  case when required.signature='private.assert_dispatch_ready(uuid)'
    then strpos(procedure.prosrc,'private.closed_reservation_has_exact_dispatch_posting')>0 end closed_posting_guard
from required left join pg_proc procedure on procedure.oid=to_regprocedure(required.signature);

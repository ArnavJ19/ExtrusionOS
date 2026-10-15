-- Read-only catalog checks. Run on disposable staging before any paired release.
-- REST exposure is not proof of the migration ledger or authenticated privileges.
with required(name) as (
  values ('save_system_configuration_atomic'), ('submit_dealer_receipt_atomic'),
         ('save_order_atomic'), ('create_direct_order_atomic'), ('save_ready_dispatch_atomic'),
         ('generate_system_quote_atomic'), ('handoff_system_configuration_to_production_atomic'),
         ('complete_production_job_atomic'), ('correct_completed_production_output_atomic'),
         ('resolve_quality_rework_atomic'), ('list_open_quality_rework_inspections'),
         ('get_profile_stock_consumption_totals'), ('get_profile_stock_reservation_ledger_page'), ('get_dispatch_reservation_ledger_page'), ('get_dealer_quote_stock_availability'), ('issue_dispatch_return_credit_note_atomic'),
         ('reverse_credit_note_atomic'), ('get_dashboard_snapshot'),
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

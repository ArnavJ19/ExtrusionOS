-- Read-only catalog checks. Run on disposable staging before any paired release.
-- REST exposure is not proof of the migration ledger or authenticated privileges.
with required(name) as (
  values ('save_system_configuration_atomic'), ('submit_dealer_receipt_atomic'),
         ('save_order_atomic'), ('save_ready_dispatch_atomic'),
         ('generate_system_quote_atomic'), ('handoff_system_configuration_to_production_atomic'),
         ('complete_production_job_atomic'), ('correct_completed_production_output_atomic'),
         ('resolve_quality_rework_atomic'), ('list_open_quality_rework_inspections'),
         ('get_profile_stock_consumption_totals'), ('issue_dispatch_return_credit_note_atomic'),
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

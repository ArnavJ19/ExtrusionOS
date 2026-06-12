-- Supabase Security Advisor hardening for internal functions.
-- Keep RLS helper functions executable by authenticated users because policies call them.
-- Revoke anonymous/public RPC access broadly, and revoke signed-in direct execution for trigger-only functions.

create or replace function public.prevent_audit_log_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Audit logs are append-only';
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  fn record;
begin
  for fn in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'assign_current_dealer_to_quote',
        'assign_dealer_to_order',
        'audit_existing_business_change',
        'create_order_from_quote_with_dealer_stock',
        'credit_dealer_stock_on_order_cancel',
        'current_user_has_permission',
        'get_current_user_company_id',
        'get_current_user_dealer_id',
        'get_current_user_role',
        'is_owner_or_admin',
        'record_enterprise_audit',
        'seed_default_roles_for_company',
        'prevent_audit_log_mutation',
        'set_updated_at'
      )
  loop
    execute format('revoke all on function %I.%I(%s) from public', fn.nspname, fn.proname, fn.args);
    execute format('revoke all on function %I.%I(%s) from anon', fn.nspname, fn.proname, fn.args);
  end loop;
end $$;

do $$
declare
  fn record;
begin
  for fn in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'assign_current_dealer_to_quote',
        'assign_dealer_to_order',
        'audit_existing_business_change',
        'credit_dealer_stock_on_order_cancel',
        'record_enterprise_audit',
        'seed_default_roles_for_company',
        'prevent_audit_log_mutation',
        'set_updated_at'
      )
  loop
    execute format('revoke all on function %I.%I(%s) from authenticated', fn.nspname, fn.proname, fn.args);
  end loop;
end $$;

-- Explicitly keep only app-required RPC/helper access for signed-in users.
grant execute on function public.create_order_from_quote_with_dealer_stock(uuid, text, date, date, text, numeric, text) to authenticated;
grant execute on function public.current_user_has_permission(text) to authenticated;
grant execute on function public.get_current_user_company_id() to authenticated;
grant execute on function public.get_current_user_dealer_id() to authenticated;
grant execute on function public.get_current_user_role() to authenticated;
grant execute on function public.is_owner_or_admin() to authenticated;

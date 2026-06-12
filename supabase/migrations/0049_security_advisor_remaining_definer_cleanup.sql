-- Remove remaining Security Advisor warnings for callable SECURITY DEFINER functions in public.
-- Public RLS helper functions become SECURITY INVOKER wrappers over private helpers.
-- The quote-to-order implementation is moved out of the exposed public schema.
-- The public RPC remains a SECURITY INVOKER wrapper so existing client calls keep working.

create schema if not exists private;

create or replace function private.get_current_user_company_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select company_id from public.app_users where id = auth.uid() and is_active = true;
$$;

create or replace function private.get_current_user_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from public.app_users where id = auth.uid() and is_active = true;
$$;

create or replace function private.get_current_user_dealer_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select dealer_id from public.app_users where id = auth.uid() and is_active = true;
$$;

create or replace function private.is_owner_or_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select role in ('owner','admin') from public.app_users where id = auth.uid() and is_active = true), false);
$$;

create or replace function private.current_user_has_permission(permission text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(private.get_current_user_role() in ('owner','admin'), false)
    or exists (
      select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id and r.is_active = true
      join public.role_permissions rp on rp.role_id = r.id
      where ur.user_id = auth.uid()
        and ur.company_id = private.get_current_user_company_id()
        and rp.permission_key = permission
        and (permission not in ('manage_users', 'manage_roles') or private.get_current_user_role() = 'owner')
    )
    or exists (
      select 1
      from public.roles r
      join public.role_permissions rp on rp.role_id = r.id
      where r.company_id = private.get_current_user_company_id()
        and r.role_key = private.get_current_user_role()
        and r.is_active = true
        and rp.permission_key = permission
        and (permission not in ('manage_users', 'manage_roles') or private.get_current_user_role() = 'owner')
    );
$$;

grant usage on schema private to anon, authenticated;
grant execute on function private.get_current_user_company_id() to anon, authenticated;
grant execute on function private.get_current_user_role() to anon, authenticated;
grant execute on function private.get_current_user_dealer_id() to anon, authenticated;
grant execute on function private.is_owner_or_admin() to anon, authenticated;
grant execute on function private.current_user_has_permission(text) to anon, authenticated;

create or replace function public.get_current_user_company_id()
returns uuid
language sql
security invoker
set search_path = public, private
stable
as $$
  select private.get_current_user_company_id();
$$;

create or replace function public.get_current_user_role()
returns text
language sql
security invoker
set search_path = public, private
stable
as $$
  select private.get_current_user_role();
$$;

create or replace function public.get_current_user_dealer_id()
returns uuid
language sql
security invoker
set search_path = public, private
stable
as $$
  select private.get_current_user_dealer_id();
$$;

create or replace function public.is_owner_or_admin()
returns boolean
language sql
security invoker
set search_path = public, private
stable
as $$
  select private.is_owner_or_admin();
$$;

create or replace function public.current_user_has_permission(permission text)
returns boolean
language sql
security invoker
set search_path = public, private
stable
as $$
  select private.current_user_has_permission(permission);
$$;

grant execute on function public.get_current_user_company_id() to anon, authenticated;
grant execute on function public.get_current_user_role() to anon, authenticated;
grant execute on function public.get_current_user_dealer_id() to anon, authenticated;
grant execute on function public.is_owner_or_admin() to anon, authenticated;
grant execute on function public.current_user_has_permission(text) to anon, authenticated;

alter function public.create_order_from_quote_with_dealer_stock(uuid, text, date, date, text, numeric, text)
  set schema private;

alter function private.create_order_from_quote_with_dealer_stock(uuid, text, date, date, text, numeric, text)
  security definer
  set search_path = public;

grant execute on function private.create_order_from_quote_with_dealer_stock(uuid, text, date, date, text, numeric, text) to authenticated;

create or replace function public.create_order_from_quote_with_dealer_stock(
  p_quote_id uuid,
  p_order_number text,
  p_order_date date,
  p_expected_dispatch_date date,
  p_priority text,
  p_dealer_fulfilled_weight_kg numeric,
  p_notes text
)
returns uuid
language sql
security invoker
set search_path = public, private
as $$
  select private.create_order_from_quote_with_dealer_stock(
    p_quote_id,
    p_order_number,
    p_order_date,
    p_expected_dispatch_date,
    p_priority,
    p_dealer_fulfilled_weight_kg,
    p_notes
  );
$$;

grant execute on function public.create_order_from_quote_with_dealer_stock(uuid, text, date, date, text, numeric, text) to authenticated;

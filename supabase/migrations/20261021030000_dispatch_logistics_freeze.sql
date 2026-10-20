-- EXOS-AUD-011: any company user could rewrite a shipped dispatch's e-way bill,
-- LR, vehicle and transporter, and mark it returned or damaged.
--
-- 1. The tenant-only "dispatches tenant insert/update" policies are removed; the
--    remaining direct-write policies are limited to the roles that the dispatch
--    RPCs already authorize.
-- 2. After activation, transport documents are set-once: an empty field may be
--    filled (an LR number that arrives later), but a recorded value cannot be
--    changed or cleared, and the dispatch date is frozen.
-- 3. Delivery status changes from PostgREST clients must use the audited
--    delivery workflow (transition_dispatch_delivery_atomic / dispatch save RPCs).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop policy if exists "dispatches tenant insert" on public.dispatches;
drop policy if exists "dispatches tenant update" on public.dispatches;
drop policy if exists "dispatch tenant insert" on public.dispatches;
drop policy if exists "dispatch tenant update" on public.dispatches;

create policy "dispatch tenant insert" on public.dispatches
  for insert with check (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner','admin','factory_manager','inventory_manager','dispatch_manager','dispatch')
  );
create policy "dispatch tenant update" on public.dispatches
  for update using (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner','admin','factory_manager','inventory_manager','dispatch_manager','dispatch')
  ) with check (company_id = public.get_current_user_company_id());

-- Invoker on purpose: current_user is 'authenticated' only for direct PostgREST writes,
-- and the function owner inside the SECURITY DEFINER dispatch workflows.
create or replace function private.guard_dispatch_post_activation()
returns trigger
language plpgsql
set search_path = public, private
as $$
begin
  if new.delivery_status is distinct from old.delivery_status and current_user = 'authenticated' then
    raise exception 'Use the delivery workflow to change dispatch status' using errcode = '42501';
  end if;
  if old.delivery_status = 'pending' then return new; end if;

  if new.dispatch_date is distinct from old.dispatch_date then
    raise exception 'Dispatch date is frozen after activation' using errcode = '23514';
  end if;
  if (nullif(btrim(coalesce(old.transporter_name, '')), '') is not null and new.transporter_name is distinct from old.transporter_name)
    or (nullif(btrim(coalesce(old.vehicle_number, '')), '') is not null and new.vehicle_number is distinct from old.vehicle_number)
    or (nullif(btrim(coalesce(old.driver_name, '')), '') is not null and new.driver_name is distinct from old.driver_name)
    or (nullif(btrim(coalesce(old.driver_phone, '')), '') is not null and new.driver_phone is distinct from old.driver_phone)
    or (nullif(btrim(coalesce(old.eway_bill_number, '')), '') is not null and new.eway_bill_number is distinct from old.eway_bill_number)
    or (nullif(btrim(coalesce(old.lr_number, '')), '') is not null and new.lr_number is distinct from old.lr_number) then
    raise exception 'Recorded transport documents are frozen after activation; record an amendment instead'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Trigger functions need no client EXECUTE grant (see 20260809000006).
revoke all on function private.guard_dispatch_post_activation() from public, anon, authenticated;

drop trigger if exists a_guard_dispatch_post_activation on public.dispatches;
create trigger a_guard_dispatch_post_activation
  before update on public.dispatches
  for each row execute function private.guard_dispatch_post_activation();

commit;

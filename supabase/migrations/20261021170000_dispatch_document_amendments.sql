-- EXOS-AUD-011 follow-up: after activation, recorded transport documents
-- (transporter, vehicle, driver, e-way bill, LR) are frozen. A genuine
-- correction now goes through an audited amendment:
--   public.amend_dispatch_transport_documents(p_dispatch_id, p_changes, p_reason)
-- Roles: owner, admin, factory_manager, dispatch_manager, dispatch.
-- Every changed field is written to public.dispatch_document_amendments
-- (old value, new value, reason, user, role, time). The table is read-only for
-- clients. The dispatch date stays frozen.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.dispatch_document_amendments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  dispatch_id uuid not null references public.dispatches(id) on delete cascade,
  field_name text not null check (field_name in ('transporter_name','vehicle_number','driver_name','driver_phone','eway_bill_number','lr_number')),
  old_value text,
  new_value text,
  reason text not null check (length(btrim(reason)) >= 10),
  amended_by uuid not null references auth.users(id),
  amended_by_role text not null,
  amended_at timestamptz not null default now()
);
create index if not exists dispatch_document_amendments_company_dispatch_idx on public.dispatch_document_amendments(company_id, dispatch_id, amended_at desc);
alter table public.dispatch_document_amendments enable row level security;
drop policy if exists "dispatch document amendments tenant read" on public.dispatch_document_amendments;
create policy "dispatch document amendments tenant read" on public.dispatch_document_amendments
  for select using (company_id = public.get_current_user_company_id());
revoke all on public.dispatch_document_amendments from public, anon, authenticated;
grant select on public.dispatch_document_amendments to authenticated;

create table if not exists private.dispatch_amendment_authorizations (
  transaction_id bigint not null,
  dispatch_id uuid not null references public.dispatches(id) on delete cascade,
  actor_id uuid not null,
  primary key (transaction_id, dispatch_id)
);
revoke all on private.dispatch_amendment_authorizations from public, anon, authenticated;

-- Same rules as Wave 1, plus the amendment authorization. Invoker on purpose:
-- current_user is 'authenticated' only for direct PostgREST writes.
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
  -- Nested on purpose: a client role must never reference the private table (the
  -- permission check would fail even when the condition is false).
  if current_user <> 'authenticated' then
    if exists (select 1 from private.dispatch_amendment_authorizations amendment
      where amendment.transaction_id = txid_current() and amendment.dispatch_id = old.id and amendment.actor_id = auth.uid()) then
      return new;
    end if;
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
revoke all on function private.guard_dispatch_post_activation() from public, anon, authenticated;

create or replace function private.amend_dispatch_transport_documents(p_dispatch_id uuid, p_changes jsonb, p_reason text)
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_dispatch public.dispatches%rowtype;
  v_field text;
  v_old text;
  v_new text;
  v_count integer := 0;
  v_fields text[] := array['transporter_name','vehicle_number','driver_name','driver_phone','eway_bill_number','lr_number'];
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if v_role not in ('owner','admin','factory_manager','dispatch_manager','dispatch') then
    raise exception 'Permission denied to amend dispatch transport documents' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Give an amendment reason of at least 10 characters' using errcode = '23514';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'Amendment changes must be an object of field values' using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_object_keys(p_changes) k where k <> all(v_fields)) then
    raise exception 'Only transporter, vehicle, driver, e-way bill and LR fields can be amended' using errcode = '23514';
  end if;
  select * into v_dispatch from public.dispatches where id = p_dispatch_id and company_id = v_company_id for update;
  if not found then raise exception 'Dispatch not found for this company' using errcode = '23514'; end if;
  if v_dispatch.delivery_status = 'pending' then
    raise exception 'A pending dispatch can be edited directly; amendments are for activated dispatches' using errcode = '23514';
  end if;

  foreach v_field in array v_fields loop
    if p_changes ? v_field then
      v_old := to_jsonb(v_dispatch) ->> v_field;
      v_new := nullif(btrim(p_changes ->> v_field), '');
      if v_new is distinct from nullif(btrim(coalesce(v_old, '')), '') then
        if v_field = 'eway_bill_number' and v_new is null then
          raise exception 'An e-way bill number cannot be cleared by amendment' using errcode = '23514';
        end if;
        insert into public.dispatch_document_amendments(company_id, dispatch_id, field_name, old_value, new_value, reason, amended_by, amended_by_role)
        values (v_company_id, p_dispatch_id, v_field, v_old, v_new, btrim(p_reason), auth.uid(), v_role);
        v_count := v_count + 1;
      end if;
    end if;
  end loop;
  if v_count = 0 then raise exception 'No transport document value changed' using errcode = '23514'; end if;

  insert into private.dispatch_amendment_authorizations(transaction_id, dispatch_id, actor_id)
  values (txid_current(), p_dispatch_id, auth.uid()) on conflict do nothing;
  update public.dispatches set
    transporter_name = case when p_changes ? 'transporter_name' then nullif(btrim(p_changes ->> 'transporter_name'), '') else transporter_name end,
    vehicle_number = case when p_changes ? 'vehicle_number' then nullif(btrim(p_changes ->> 'vehicle_number'), '') else vehicle_number end,
    driver_name = case when p_changes ? 'driver_name' then nullif(btrim(p_changes ->> 'driver_name'), '') else driver_name end,
    driver_phone = case when p_changes ? 'driver_phone' then nullif(btrim(p_changes ->> 'driver_phone'), '') else driver_phone end,
    eway_bill_number = case when p_changes ? 'eway_bill_number' then nullif(btrim(p_changes ->> 'eway_bill_number'), '') else eway_bill_number end,
    lr_number = case when p_changes ? 'lr_number' then nullif(btrim(p_changes ->> 'lr_number'), '') else lr_number end,
    updated_at = now()
  where id = p_dispatch_id and company_id = v_company_id;
  delete from private.dispatch_amendment_authorizations where transaction_id = txid_current() and dispatch_id = p_dispatch_id;
  return v_count;
end;
$$;
revoke all on function private.amend_dispatch_transport_documents(uuid, jsonb, text) from public, anon, authenticated;

create or replace function public.amend_dispatch_transport_documents(p_dispatch_id uuid, p_changes jsonb, p_reason text)
returns integer
language sql
security definer
set search_path = public, private
as $$ select private.amend_dispatch_transport_documents(p_dispatch_id, p_changes, p_reason) $$;
revoke all on function public.amend_dispatch_transport_documents(uuid, jsonb, text) from public, anon;
grant execute on function public.amend_dispatch_transport_documents(uuid, jsonb, text) to authenticated;

commit;

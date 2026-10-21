-- EXOS-AUD-021: profile master changes applied instantly to open orders, jobs and
-- billet allocations (section weight, alloy, temper, billet size) with no warning.
--
-- Business default chosen (re-approval of open work, the conservative option of
-- the two in the audit; it needs no versioned references):
--   * While the profile has open work (unfinished production jobs, open billet
--     requirements, active stock reservations or lines on open orders), its
--     production-critical specification (section_weight_kg_per_m, alloy, temper,
--     billet_diameter_required_inch, weight_tolerance_percent,
--     hardness_requirement) cannot be changed by an ordinary edit.
--   * An owner or admin applies such a change with
--     public.approve_profile_spec_change(profile, changes, reason). The change,
--     the before/after values and the open work it affects are recorded in
--     public.profile_spec_change_approvals.
--   * A profile with no open work is edited as before (the change applies to new
--     documents only, because there are none in flight).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.profile_spec_change_approvals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.aluminium_profiles(id) on delete cascade,
  previous_values jsonb not null,
  new_values jsonb not null,
  open_work jsonb not null,
  reason text not null check (length(btrim(reason)) >= 10),
  approved_by uuid not null references auth.users(id),
  approved_by_role text not null,
  approved_at timestamptz not null default now()
);
create index if not exists profile_spec_change_approvals_company_profile_idx on public.profile_spec_change_approvals(company_id, profile_id, approved_at desc);
alter table public.profile_spec_change_approvals enable row level security;
drop policy if exists "profile spec change approvals tenant read" on public.profile_spec_change_approvals;
create policy "profile spec change approvals tenant read" on public.profile_spec_change_approvals
  for select using (company_id = public.get_current_user_company_id());
revoke all on public.profile_spec_change_approvals from public, anon, authenticated;
grant select on public.profile_spec_change_approvals to authenticated;

create table if not exists private.profile_spec_change_authorizations (
  transaction_id bigint not null,
  profile_id uuid not null references public.aluminium_profiles(id) on delete cascade,
  actor_id uuid not null,
  primary key (transaction_id, profile_id)
);
revoke all on private.profile_spec_change_authorizations from public, anon, authenticated;

create or replace function private.profile_open_work(p_company_id uuid, p_profile_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, private
as $$
  select jsonb_build_object(
    'production_jobs', (select count(*) from public.production_jobs j where j.company_id = p_company_id and j.profile_id = p_profile_id
      and j.status not in ('completed','cancelled')),
    'billet_requirements', (select count(*) from public.order_billet_requirements r join public.orders o on o.id = r.order_id
      where r.company_id = p_company_id and r.profile_id = p_profile_id and r.status not in ('cancelled','not_required')
        and o.current_stage not in ('delivered','closed','cancelled','payment_pending')),
    'stock_reservations', (select count(*) from public.profile_stock_reservations s where s.company_id = p_company_id and s.profile_id = p_profile_id and s.status = 'active'),
    'open_order_lines', (select count(*) from public.order_items i join public.orders o on o.id = i.order_id
      where i.company_id = p_company_id and i.profile_id = p_profile_id and o.current_stage not in ('delivered','closed','cancelled','payment_pending'))
  )
$$;
revoke all on function private.profile_open_work(uuid, uuid) from public, anon, authenticated;

create or replace function private.guard_profile_spec_change()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_open jsonb;
begin
  if row(new.section_weight_kg_per_m, new.alloy, new.temper, new.billet_diameter_required_inch, new.weight_tolerance_percent, new.hardness_requirement)
     is not distinct from row(old.section_weight_kg_per_m, old.alloy, old.temper, old.billet_diameter_required_inch, old.weight_tolerance_percent, old.hardness_requirement) then
    return new;
  end if;
  if exists (select 1 from private.profile_spec_change_authorizations a
      where a.transaction_id = txid_current() and a.profile_id = old.id and a.actor_id = auth.uid()) then
    return new;
  end if;
  v_open := private.profile_open_work(old.company_id, old.id);
  if (v_open ->> 'production_jobs')::int + (v_open ->> 'billet_requirements')::int + (v_open ->> 'stock_reservations')::int + (v_open ->> 'open_order_lines')::int > 0 then
    raise exception 'Profile % has open work (% jobs, % billet requirements, % reservations, % open order lines); an owner or admin must approve a specification change',
      old.profile_code, v_open ->> 'production_jobs', v_open ->> 'billet_requirements', v_open ->> 'stock_reservations', v_open ->> 'open_order_lines'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_profile_spec_change() from public, anon, authenticated;
drop trigger if exists a_guard_profile_spec_change on public.aluminium_profiles;
create trigger a_guard_profile_spec_change before update on public.aluminium_profiles
  for each row execute function private.guard_profile_spec_change();

create or replace function private.approve_profile_spec_change(p_profile_id uuid, p_changes jsonb, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_profile public.aluminium_profiles%rowtype;
  v_prev jsonb;
  v_fields text[] := array['section_weight_kg_per_m','alloy','temper','billet_diameter_required_inch','weight_tolerance_percent','hardness_requirement'];
  v_id uuid;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if v_role not in ('owner','admin') then raise exception 'Only an owner or admin can approve a specification change on a profile with open work' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'Give the reason for the specification change (at least 10 characters)' using errcode = '23514'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then raise exception 'Give the specification fields to change' using errcode = '23514'; end if;
  if exists (select 1 from jsonb_object_keys(p_changes) k where k <> all(v_fields)) then
    raise exception 'Only section weight, alloy, temper, billet diameter, weight tolerance and hardness are approved here' using errcode = '23514';
  end if;
  select * into v_profile from public.aluminium_profiles where id = p_profile_id and company_id = v_company_id for update;
  if not found then raise exception 'Profile not found for this company' using errcode = '23514'; end if;
  select jsonb_object_agg(k, to_jsonb(v_profile) -> k) into v_prev from jsonb_object_keys(p_changes) k;

  insert into private.profile_spec_change_authorizations(transaction_id, profile_id, actor_id) values (txid_current(), p_profile_id, auth.uid()) on conflict do nothing;
  update public.aluminium_profiles set
    section_weight_kg_per_m = case when p_changes ? 'section_weight_kg_per_m' then nullif(p_changes ->> 'section_weight_kg_per_m', '')::numeric else section_weight_kg_per_m end,
    alloy = case when p_changes ? 'alloy' then nullif(btrim(p_changes ->> 'alloy'), '') else alloy end,
    temper = case when p_changes ? 'temper' then nullif(btrim(p_changes ->> 'temper'), '') else temper end,
    billet_diameter_required_inch = case when p_changes ? 'billet_diameter_required_inch' then nullif(p_changes ->> 'billet_diameter_required_inch', '')::numeric else billet_diameter_required_inch end,
    weight_tolerance_percent = case when p_changes ? 'weight_tolerance_percent' then nullif(p_changes ->> 'weight_tolerance_percent', '')::numeric else weight_tolerance_percent end,
    hardness_requirement = case when p_changes ? 'hardness_requirement' then nullif(btrim(p_changes ->> 'hardness_requirement'), '') else hardness_requirement end,
    updated_at = now()
  where id = p_profile_id;
  delete from private.profile_spec_change_authorizations where transaction_id = txid_current() and profile_id = p_profile_id;
  insert into public.profile_spec_change_approvals(company_id, profile_id, previous_values, new_values, open_work, reason, approved_by, approved_by_role)
  values (v_company_id, p_profile_id, v_prev, p_changes, private.profile_open_work(v_company_id, p_profile_id), btrim(p_reason), auth.uid(), v_role)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function private.approve_profile_spec_change(uuid, jsonb, text) from public, anon, authenticated;
create or replace function public.approve_profile_spec_change(p_profile_id uuid, p_changes jsonb, p_reason text)
returns uuid language sql security definer set search_path = public, private
as $$ select private.approve_profile_spec_change(p_profile_id, p_changes, p_reason) $$;
revoke all on function public.approve_profile_spec_change(uuid, jsonb, text) from public, anon;
grant execute on function public.approve_profile_spec_change(uuid, jsonb, text) to authenticated;

commit;

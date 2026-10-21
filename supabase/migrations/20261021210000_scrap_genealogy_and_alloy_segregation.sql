-- EXOS-AUD-006, EXOS-AUD-005 and the EXOS-AUD-002 follow-up.
--
-- 006: the whole declared production loss was booked 1:1 as clean, available,
--      alloy-less recoverable scrap. Completion loss is now categorised:
--        public.complete_production_job_with_scrap_atomic(job, kg, pieces, metres,
--          scrap_lines jsonb [{category, weight_kg}], remarks)
--      categories: butt_end, front_back_end, saw_cut, rejects (weighed,
--      recoverable -> one foundry scrap lot per line, carrying the job alloy) and
--      unrecoverable_loss (dross / oxidation / measurement loss -> no lot).
--      The original complete_production_job_atomic still works, but its single
--      scrap figure is recorded as 'unclassified' and is NOT turned into furnace
--      metal until someone weighs and categorises it.
--      Lines are stored in public.production_scrap_lines (read-only for clients).
-- 005: scrap lots now carry an alloy (inherited from the job's consumed billets,
--      else the profile alloy). A furnace charge must be alloy-compatible with
--      the batch: same alloy, or primary/pure aluminium (1xxx, P1020, 99.x, EC, or
--      a primary ingot form with no alloy recorded). Anything else, including a
--      scrap lot of unknown alloy, needs an approved deviation
--      (public.approve_foundry_alloy_deviation, owner/admin/factory_manager/quality),
--      recorded in public.foundry_alloy_deviations. A scrap lot's alloy can be set
--      once if it was blank.
-- 002: public.reverse_process_scrap_posting(scrap_record_id, reason) retires the
--      foundry lots derived from an erroneous posting if none of their metal has
--      been charged, and records the reversal in public.scrap_record_reversals.
--      The scrap row itself stays (completed-production evidence is immutable);
--      reports exclude reversed postings.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ---------------------------------------------------------------- schema
alter table public.scrap_records add column if not exists scrap_category text not null default 'unclassified';
alter table public.scrap_records add column if not exists recoverable boolean not null default false;
alter table public.scrap_records add column if not exists alloy text;
alter table public.scrap_records drop constraint if exists scrap_records_scrap_category_check;
alter table public.scrap_records add constraint scrap_records_scrap_category_check
  check (scrap_category in ('unclassified','categorised','butt_end','front_back_end','saw_cut','rejects','unrecoverable_loss','qc_reject','finishing_reject','returned_goods','other'));

alter table public.foundry_aluminium_scrap add column if not exists alloy text;
alter table public.foundry_aluminium_scrap add column if not exists scrap_category text;
alter table public.foundry_aluminium_scrap add column if not exists source_scrap_record_id uuid references public.scrap_records(id) on delete restrict;
create index if not exists foundry_aluminium_scrap_source_record_idx on public.foundry_aluminium_scrap(company_id, source_scrap_record_id);

create table if not exists public.production_scrap_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  scrap_record_id uuid not null references public.scrap_records(id) on delete cascade,
  production_job_id uuid not null references public.production_jobs(id) on delete cascade,
  category text not null check (category in ('unclassified','butt_end','front_back_end','saw_cut','rejects','unrecoverable_loss')),
  weight_kg numeric(14,3) not null check (weight_kg > 0),
  recoverable boolean not null,
  alloy text,
  foundry_scrap_id uuid references public.foundry_aluminium_scrap(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists production_scrap_lines_company_job_idx on public.production_scrap_lines(company_id, production_job_id);
alter table public.production_scrap_lines enable row level security;
drop policy if exists "production scrap lines tenant read" on public.production_scrap_lines;
create policy "production scrap lines tenant read" on public.production_scrap_lines
  for select using (company_id = public.get_current_user_company_id());
revoke all on public.production_scrap_lines from public, anon, authenticated;
grant select on public.production_scrap_lines to authenticated;

create table if not exists public.scrap_record_reversals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  scrap_record_id uuid not null unique references public.scrap_records(id) on delete cascade,
  reversed_weight_kg numeric(14,3) not null,
  retired_lot_count integer not null,
  reason text not null check (length(btrim(reason)) >= 10),
  reversed_by uuid not null references auth.users(id),
  reversed_by_role text not null,
  reversed_at timestamptz not null default now()
);
alter table public.scrap_record_reversals enable row level security;
drop policy if exists "scrap record reversals tenant read" on public.scrap_record_reversals;
create policy "scrap record reversals tenant read" on public.scrap_record_reversals
  for select using (company_id = public.get_current_user_company_id());
revoke all on public.scrap_record_reversals from public, anon, authenticated;
grant select on public.scrap_record_reversals to authenticated;

create table if not exists public.foundry_alloy_deviations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_table text not null check (source_table in ('foundry_aluminium_scrap','foundry_external_aluminium_sources')),
  source_id uuid not null,
  source_alloy text,
  batch_alloy text not null,
  reason text not null check (length(btrim(reason)) >= 10),
  approved_by uuid not null references auth.users(id),
  approved_by_role text not null,
  approved_at timestamptz not null default now(),
  unique (company_id, source_table, source_id, batch_alloy)
);
alter table public.foundry_alloy_deviations enable row level security;
drop policy if exists "foundry alloy deviations tenant read" on public.foundry_alloy_deviations;
create policy "foundry alloy deviations tenant read" on public.foundry_alloy_deviations
  for select using (company_id = public.get_current_user_company_id());
revoke all on public.foundry_alloy_deviations from public, anon, authenticated;
grant select on public.foundry_alloy_deviations to authenticated;

create table if not exists private.production_scrap_line_requests (
  transaction_id bigint not null,
  job_id uuid not null references public.production_jobs(id) on delete cascade,
  actor_id uuid not null,
  lines jsonb not null,
  primary key (transaction_id, job_id)
);
revoke all on private.production_scrap_line_requests from public, anon, authenticated;

-- Backfill: link legacy in-house lots to their scrap posting when the match is unique.
update public.foundry_aluminium_scrap lot
set source_scrap_record_id = match.scrap_id, scrap_category = 'unclassified'
from (
  select lot2.id lot_id, min(s.id::text)::uuid scrap_id
  from public.foundry_aluminium_scrap lot2
  join public.scrap_records s on s.company_id = lot2.company_id and s.scrap_type = 'process_scrap'
    and lot2.origin_reference = concat('Process scrap from production job ', s.production_job_id::text)
    and s.weight_kg = lot2.weight_kg
  where lot2.scrap_source = 'in_house' and lot2.source_scrap_record_id is null
  group by lot2.id having count(*) = 1
) match
where lot.id = match.lot_id;
update public.scrap_records s set recoverable = true
where exists (select 1 from public.foundry_aluminium_scrap lot where lot.source_scrap_record_id = s.id);

-- ---------------------------------------------------------------- alloy helpers
create or replace function private.normalize_alloy(p_alloy text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select nullif(regexp_replace(upper(regexp_replace(coalesce(p_alloy, ''), '[^0-9A-Za-z.]', '', 'g')), '^AA', ''), '')
$$;
revoke all on function private.normalize_alloy(text) from public, anon, authenticated;
-- Pure text normaliser; the invoker scrap-lot guard calls it as the client role.
grant execute on function private.normalize_alloy(text) to authenticated;

create or replace function private.is_primary_aluminium(p_alloy text)
returns boolean
language sql
immutable
set search_path = pg_catalog, private
as $$
  select coalesce(private.normalize_alloy(p_alloy) ~ '^(1[0-9]{3}[A-Z]?|P1[0-9]{3}[A-Z]?|99(\.[0-9]+)?|EC|PRIMARY|PURE)$', false)
$$;
revoke all on function private.is_primary_aluminium(text) from public, anon, authenticated;

create or replace function private.production_job_alloy(p_company_id uuid, p_job_id uuid)
returns text
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce(
    (select min(b.alloy) from public.foundry_billets b
      where b.company_id = p_company_id and b.production_job_id = p_job_id and b.status in ('issued','consumed')
      having count(distinct private.normalize_alloy(b.alloy)) = 1),
    (select p.alloy from public.production_jobs j join public.aluminium_profiles p on p.id = j.profile_id
      where j.id = p_job_id and j.company_id = p_company_id))
$$;
revoke all on function private.production_job_alloy(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- 006: categorised completion
create or replace function public.sync_process_scrap_to_foundry()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
declare
  v_lines jsonb;
  v_line jsonb;
  v_alloy text;
  v_lot uuid;
  v_category text;
  v_kg numeric;
  v_recoverable boolean;
  v_any_recoverable boolean := false;
  v_count integer := 0;
begin
  if coalesce(new.scrap_type, '') <> 'process_scrap' or coalesce(new.weight_kg, 0) <= 0 then
    return new;
  end if;
  if new.production_job_id is null or not exists (
    select 1 from public.production_jobs job
    where job.id = new.production_job_id and job.company_id = new.company_id
  ) then
    raise exception 'Recoverable process scrap must come from a production job of this company'
      using errcode = '23514';
  end if;

  v_alloy := private.production_job_alloy(new.company_id, new.production_job_id);
  select request.lines into v_lines from private.production_scrap_line_requests request
  where request.transaction_id = txid_current() and request.job_id = new.production_job_id;
  if v_lines is null then
    v_lines := jsonb_build_array(jsonb_build_object('category', 'unclassified', 'weight_kg', new.weight_kg));
  end if;

  for v_line in select value from jsonb_array_elements(v_lines) loop
    v_category := v_line ->> 'category';
    v_kg := round((v_line ->> 'weight_kg')::numeric, 3);
    v_recoverable := v_category in ('butt_end','front_back_end','saw_cut','rejects');
    v_lot := null;
    if v_recoverable then
      insert into public.foundry_aluminium_scrap (
        company_id, scrap_number, scrap_source, weight_kg, available_weight_kg,
        scrap_quality, status, received_date, origin_reference, created_by,
        alloy, scrap_category, source_scrap_record_id
      ) values (
        new.company_id,
        private.next_business_number_locked('public.foundry_aluminium_scrap'::regclass, 'scrap_number', new.company_id, 'SCR', current_date),
        'in_house', v_kg, v_kg, 'clean', 'available',
        coalesce(new.recorded_date, current_date),
        concat('Process scrap (', replace(v_category, '_', ' '), ') from production job ', new.production_job_id::text),
        new.recorded_by, v_alloy, v_category, new.id
      ) returning id into v_lot;
      v_any_recoverable := true;
    end if;
    insert into public.production_scrap_lines(company_id, scrap_record_id, production_job_id, category, weight_kg, recoverable, alloy, foundry_scrap_id)
    values (new.company_id, new.id, new.production_job_id, v_category, v_kg, v_recoverable, v_alloy, v_lot);
    v_count := v_count + 1;
  end loop;

  -- Classification columns only (the guarded evidence columns are untouched).
  update public.scrap_records set
    alloy = v_alloy,
    recoverable = v_any_recoverable,
    scrap_category = case when v_count = 1 then (v_lines -> 0 ->> 'category') else 'categorised' end
  where id = new.id;
  return new;
end;
$function$;

-- The completion scrap guard treats scrap linked to completed production as
-- immutable; allow only the classification columns set above, inside the
-- trigger that created the row.
create or replace function private.guard_completed_production_scrap()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
declare
  v_job_id uuid;
  v_job public.production_jobs%rowtype;
  v_auth private.production_completion_authorizations%rowtype;
  v_job_found boolean := false;
begin
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1
    and (to_jsonb(new) - array['alloy','recoverable','scrap_category']) is not distinct from (to_jsonb(old) - array['alloy','recoverable','scrap_category']) then
    return new;
  end if;
  if tg_op = 'UPDATE' or tg_op = 'DELETE' then
    v_job_id := old.production_job_id;
    if v_job_id is not null then
      select * into v_job from public.production_jobs where id = v_job_id and company_id = old.company_id for update nowait;
      v_job_found := found;
    end if;
    if v_job_found and v_job.status = 'completed' then
      raise exception 'Scrap linked to completed production is immutable';
    end if;
    if tg_op = 'DELETE' then return old; end if;
  end if;
  if tg_op = 'INSERT' or tg_op = 'UPDATE' then
    if new.production_job_id is not null then
      select * into v_job from public.production_jobs where id = new.production_job_id and company_id = new.company_id for update nowait;
      v_job_found := found;
    else
      v_job_found := false;
    end if;
    if v_job_found and v_job.status = 'completed' then
      select * into v_auth from private.production_completion_authorizations
      where transaction_id = txid_current() and job_id = new.production_job_id and company_id = new.company_id
        and actor_id = auth.uid() and expected_scrap_kg = new.weight_kg and scrap_inserted = false
      for update;
      if not found then raise exception 'Scrap linked to completed production requires the audited completion workflow'; end if;
      update private.production_completion_authorizations set scrap_inserted = true
      where transaction_id = v_auth.transaction_id and job_id = v_auth.job_id;
    end if;
  end if;
  return new;
exception when lock_not_available then
  raise exception 'Production output is being finalized or corrected; retry the scrap change' using errcode = '55P03';
end;
$function$;

create or replace function public.complete_production_job_with_scrap_atomic(
  p_job_id uuid, p_actual_weight_kg numeric, p_actual_pieces integer, p_actual_meters numeric,
  p_scrap_lines jsonb, p_remarks text default null)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_line jsonb;
  v_total numeric := 0;
  v_clean jsonb := '[]'::jsonb;
  v_category text;
  v_kg numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_scrap_lines is null or jsonb_typeof(p_scrap_lines) <> 'array' then
    raise exception 'Scrap lines must be a list of {category, weight_kg}' using errcode = '23514';
  end if;
  for v_line in select value from jsonb_array_elements(p_scrap_lines) loop
    v_category := v_line ->> 'category';
    v_kg := round(coalesce(nullif(v_line ->> 'weight_kg', '')::numeric, 0), 3);
    if v_category not in ('butt_end','front_back_end','saw_cut','rejects','unrecoverable_loss') then
      raise exception 'Unknown scrap category %', coalesce(v_category, '(blank)') using errcode = '23514';
    end if;
    if v_kg < 0 then raise exception 'Scrap weight cannot be negative' using errcode = '23514'; end if;
    if v_kg > 0 then
      v_clean := v_clean || jsonb_build_array(jsonb_build_object('category', v_category, 'weight_kg', v_kg));
      v_total := v_total + v_kg;
    end if;
  end loop;
  if v_total > 0 then
    insert into private.production_scrap_line_requests(transaction_id, job_id, actor_id, lines)
    values (txid_current(), p_job_id, auth.uid(), v_clean)
    on conflict (transaction_id, job_id) do update set lines = excluded.lines, actor_id = excluded.actor_id;
  end if;
  perform public.complete_production_job_atomic(p_job_id, p_actual_weight_kg, p_actual_pieces, p_actual_meters, v_total, p_remarks);
  delete from private.production_scrap_line_requests where transaction_id = txid_current() and job_id = p_job_id;
  return p_job_id;
end;
$$;
revoke all on function public.complete_production_job_with_scrap_atomic(uuid, numeric, integer, numeric, jsonb, text) from public, anon;
grant execute on function public.complete_production_job_with_scrap_atomic(uuid, numeric, integer, numeric, jsonb, text) to authenticated;

-- ---------------------------------------------------------------- 002: reversal
create or replace function private.reverse_process_scrap_posting(p_scrap_record_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_scrap public.scrap_records%rowtype;
  v_lot record;
  v_count integer := 0;
  v_id uuid;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if v_role not in ('owner','admin','factory_manager','production_manager') then
    raise exception 'Only an owner, admin, factory manager or production manager can reverse a scrap posting' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'Give a reversal reason of at least 10 characters' using errcode = '23514'; end if;
  select * into v_scrap from public.scrap_records where id = p_scrap_record_id and company_id = v_company_id for update;
  if not found then raise exception 'Scrap posting not found for this company' using errcode = '23514'; end if;
  if exists (select 1 from public.scrap_record_reversals r where r.scrap_record_id = p_scrap_record_id) then
    raise exception 'This scrap posting is already reversed' using errcode = '23514';
  end if;
  for v_lot in select * from public.foundry_aluminium_scrap lot
    where lot.company_id = v_company_id and lot.source_scrap_record_id = p_scrap_record_id for update loop
    if v_lot.status <> 'available' or coalesce(v_lot.available_weight_kg, v_lot.weight_kg) < v_lot.weight_kg
      or exists (select 1 from public.foundry_batches b where b.company_id = v_company_id and b.scrap_id = v_lot.id and b.status <> 'cancelled') then
      raise exception 'Scrap lot % has already been charged to a furnace; it cannot be reversed', v_lot.scrap_number using errcode = '23514';
    end if;
    update public.foundry_aluminium_scrap set status = 'rejected',
      notes = concat_ws(E'\n', nullif(notes, ''), concat('Reversed: ', btrim(p_reason))), updated_at = now()
    where id = v_lot.id;
    v_count := v_count + 1;
  end loop;
  insert into public.scrap_record_reversals(company_id, scrap_record_id, reversed_weight_kg, retired_lot_count, reason, reversed_by, reversed_by_role)
  values (v_company_id, p_scrap_record_id, v_scrap.weight_kg, v_count, btrim(p_reason), auth.uid(), v_role)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function private.reverse_process_scrap_posting(uuid, text) from public, anon, authenticated;
create or replace function public.reverse_process_scrap_posting(p_scrap_record_id uuid, p_reason text)
returns uuid language sql security definer set search_path = public, private
as $$ select private.reverse_process_scrap_posting(p_scrap_record_id, p_reason) $$;
revoke all on function public.reverse_process_scrap_posting(uuid, text) from public, anon;
grant execute on function public.reverse_process_scrap_posting(uuid, text) to authenticated;

-- Die usage excludes reversed scrap postings.
create or replace function private.die_usage_from_production(p_company_id uuid, p_die_id uuid)
returns table (good_kg numeric, runs integer, last_used date, input_kg numeric, billets integer, scrap_kg numeric)
language sql
stable
security definer
set search_path = public, private
as $$
  with jobs as (
    select j.id, j.actual_quantity_kg, j.completed_at, j.updated_at
    from public.production_jobs j
    where j.company_id = p_company_id and j.die_id = p_die_id and j.status = 'completed'
  )
  select
    coalesce((select sum(coalesce(actual_quantity_kg, 0)) from jobs), 0)::numeric,
    (select count(*) from jobs)::integer,
    (select max(coalesce(completed_at, updated_at))::date from jobs),
    coalesce((select sum(b.weight_kg) from public.foundry_billets b join jobs on jobs.id = b.production_job_id
      where b.company_id = p_company_id and b.status = 'consumed'), 0)::numeric,
    (select count(*) from public.foundry_billets b join jobs on jobs.id = b.production_job_id
      where b.company_id = p_company_id and b.status = 'consumed')::integer,
    coalesce((select sum(s.weight_kg) from public.scrap_records s join jobs on jobs.id = s.production_job_id
      where s.company_id = p_company_id
        and not exists (select 1 from public.scrap_record_reversals r where r.scrap_record_id = s.id)), 0)::numeric
$$;
revoke all on function private.die_usage_from_production(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- 005: charge alloy gate
create or replace function private.foundry_source_alloy_compatible(
  p_company_id uuid, p_source_table text, p_source_id uuid, p_batch_alloy text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  v_alloy text;
  v_form text;
begin
  if p_source_table = 'foundry_aluminium_scrap' then
    select alloy into v_alloy from public.foundry_aluminium_scrap where id = p_source_id and company_id = p_company_id;
    v_form := 'scrap';
  else
    select alloy, item_type into v_alloy, v_form from public.foundry_external_aluminium_sources where id = p_source_id and company_id = p_company_id;
  end if;
  if private.normalize_alloy(v_alloy) is not null and private.normalize_alloy(v_alloy) = private.normalize_alloy(p_batch_alloy) then
    return true;
  end if;
  if private.is_primary_aluminium(v_alloy) then return true; end if;
  if private.normalize_alloy(v_alloy) is null and v_form in ('aluminum_ingot','aluminum_sows','aluminum_t_ingots','aluminum_wire_rods') then
    return true;  -- primary metal form with no alloy recorded
  end if;
  return exists (select 1 from public.foundry_alloy_deviations d
    where d.company_id = p_company_id and d.source_table = p_source_table and d.source_id = p_source_id
      and private.normalize_alloy(d.batch_alloy) = private.normalize_alloy(p_batch_alloy));
end;
$$;
revoke all on function private.foundry_source_alloy_compatible(uuid, text, uuid, text) from public, anon, authenticated;

create or replace function private.guard_foundry_charge_alloy()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.status = 'cancelled' then return new; end if;
  if tg_op = 'UPDATE' and new.scrap_id is not distinct from old.scrap_id and new.external_source_id is not distinct from old.external_source_id
    and new.alloy is not distinct from old.alloy and coalesce(new.scrap_aluminium_kg, 0) <= coalesce(old.scrap_aluminium_kg, 0)
    and coalesce(new.external_aluminium_kg, 0) <= coalesce(old.external_aluminium_kg, 0) then
    return new;
  end if;
  if (new.scrap_id is not null and coalesce(new.scrap_aluminium_kg, 0) > 0)
    or (new.external_source_id is not null and coalesce(new.external_aluminium_kg, 0) > 0) then
    if private.normalize_alloy(new.alloy) is null then
      raise exception 'Set the batch alloy before charging metal into it' using errcode = '23514';
    end if;
  end if;
  if new.scrap_id is not null and coalesce(new.scrap_aluminium_kg, 0) > 0
    and not private.foundry_source_alloy_compatible(new.company_id, 'foundry_aluminium_scrap', new.scrap_id, new.alloy) then
    raise exception 'Scrap lot alloy is not compatible with batch alloy %; segregate it or record an approved alloy deviation', new.alloy
      using errcode = '23514';
  end if;
  if new.external_source_id is not null and coalesce(new.external_aluminium_kg, 0) > 0
    and not private.foundry_source_alloy_compatible(new.company_id, 'foundry_external_aluminium_sources', new.external_source_id, new.alloy) then
    raise exception 'External metal alloy is not compatible with batch alloy %; record an approved alloy deviation first', new.alloy
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_foundry_charge_alloy() from public, anon, authenticated;
drop trigger if exists rz_guard_foundry_charge_alloy on public.foundry_batches;
create trigger rz_guard_foundry_charge_alloy
before insert or update on public.foundry_batches
for each row execute function private.guard_foundry_charge_alloy();

create or replace function private.approve_foundry_alloy_deviation(p_source_table text, p_source_id uuid, p_batch_alloy text, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_alloy text;
  v_id uuid;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if v_role not in ('owner','admin','factory_manager','quality') then
    raise exception 'Only an owner, admin, factory manager or quality user can approve an alloy deviation' using errcode = '42501';
  end if;
  if p_source_table not in ('foundry_aluminium_scrap','foundry_external_aluminium_sources') then raise exception 'Unknown metal source' using errcode = '23514'; end if;
  if private.normalize_alloy(p_batch_alloy) is null then raise exception 'Batch alloy is required' using errcode = '23514'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'Give a deviation reason of at least 10 characters' using errcode = '23514'; end if;
  if p_source_table = 'foundry_aluminium_scrap' then
    select alloy into v_alloy from public.foundry_aluminium_scrap where id = p_source_id and company_id = v_company_id;
  else
    select alloy into v_alloy from public.foundry_external_aluminium_sources where id = p_source_id and company_id = v_company_id;
  end if;
  if not found then raise exception 'Metal source not found for this company' using errcode = '23514'; end if;
  insert into public.foundry_alloy_deviations(company_id, source_table, source_id, source_alloy, batch_alloy, reason, approved_by, approved_by_role)
  values (v_company_id, p_source_table, p_source_id, v_alloy, btrim(p_batch_alloy), btrim(p_reason), auth.uid(), v_role)
  on conflict (company_id, source_table, source_id, batch_alloy) do update
    set reason = excluded.reason, approved_by = excluded.approved_by, approved_by_role = excluded.approved_by_role, approved_at = now()
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function private.approve_foundry_alloy_deviation(text, uuid, text, text) from public, anon, authenticated;
create or replace function public.approve_foundry_alloy_deviation(p_source_table text, p_source_id uuid, p_batch_alloy text, p_reason text)
returns uuid language sql security definer set search_path = public, private
as $$ select private.approve_foundry_alloy_deviation(p_source_table, p_source_id, p_batch_alloy, p_reason) $$;
revoke all on function public.approve_foundry_alloy_deviation(text, uuid, text, text) from public, anon;
grant execute on function public.approve_foundry_alloy_deviation(text, uuid, text, text) to authenticated;

-- A scrap lot's alloy is set once (blank -> value); in-house lots keep the job alloy.
-- Invoker on purpose: current_user is 'authenticated' only for direct client writes;
-- the definer workflows (completion, cast result, billet reject) set origin fields.
create or replace function private.guard_scrap_lot_alloy()
returns trigger
language plpgsql
set search_path = public, private
as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  if tg_op = 'UPDATE' and private.normalize_alloy(old.alloy) is not null
    and private.normalize_alloy(new.alloy) is distinct from private.normalize_alloy(old.alloy) then
    raise exception 'A scrap lot''s alloy cannot be changed once recorded' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and (new.source_scrap_record_id is distinct from old.source_scrap_record_id
    or new.scrap_category is distinct from old.scrap_category) then
    raise exception 'Scrap lot origin is maintained by the production workflow' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and (new.source_scrap_record_id is not null or new.scrap_category is not null) then
    raise exception 'Scrap lot origin is maintained by the production workflow' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_scrap_lot_alloy() from public, anon, authenticated;
drop trigger if exists a_guard_scrap_lot_alloy on public.foundry_aluminium_scrap;
create trigger a_guard_scrap_lot_alloy
before insert or update on public.foundry_aluminium_scrap
for each row execute function private.guard_scrap_lot_alloy();

commit;

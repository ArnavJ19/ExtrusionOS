-- EXOS-AUD-027 and the EXOS-AUD-008 follow-up: maintenance was not connected to
-- the machines it maintains, and a press locked out by a breakdown could be put
-- back into the schedule by a plain status edit.
--
--   * breakdown_logs / maintenance_schedules get machine_ref_id (FK to machines).
--     The legacy free-text machine_id is kept for display; new rows must resolve
--     to a same-company machine (by id, code or name).
--   * Breakdown lifecycle: open -> in_progress -> resolved. Opening a breakdown
--     puts the machine in 'breakdown'. Resolving stamps end_time / downtime.
--     Downtime intervals of one machine may not overlap.
--   * Return to service: a machine in 'breakdown' or 'maintenance' becomes usable
--     again only through public.return_machine_to_service_atomic (owner, admin,
--     factory_manager, production_manager), which requires every breakdown of the
--     machine to be resolved and records a sign-off in public.machine_service_signoffs.
--   * Maintenance schedules: next_due_date is derived from last_done_date and the
--     frequency, a past-due schedule saves as 'overdue', and
--     public.complete_maintenance_schedule_atomic rolls the schedule forward and
--     logs the completion.
--   * Spare-part usage: deleting a usage row restores the stock; quantities cannot
--     be edited in place.
-- No breakdown or schedule rows existed on hosted when this was written.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.breakdown_logs add column if not exists machine_ref_id uuid references public.machines(id) on delete restrict;
alter table public.breakdown_logs add column if not exists resolved_at timestamptz;
alter table public.breakdown_logs add column if not exists resolved_by_user_id uuid references auth.users(id);
alter table public.maintenance_schedules add column if not exists machine_ref_id uuid references public.machines(id) on delete restrict;
create index if not exists breakdown_logs_company_machine_idx on public.breakdown_logs(company_id, machine_ref_id, start_time);
create index if not exists maintenance_schedules_company_machine_idx on public.maintenance_schedules(company_id, machine_ref_id, next_due_date);

create table if not exists public.machine_service_signoffs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  machine_id uuid not null references public.machines(id) on delete cascade,
  from_status text not null,
  to_status text not null,
  last_breakdown_id uuid references public.breakdown_logs(id) on delete set null,
  note text not null check (length(btrim(note)) >= 10),
  signed_by uuid not null references auth.users(id),
  signed_by_role text not null,
  signed_at timestamptz not null default now()
);
create index if not exists machine_service_signoffs_company_machine_idx on public.machine_service_signoffs(company_id, machine_id, signed_at desc);
alter table public.machine_service_signoffs enable row level security;
drop policy if exists "machine service signoffs tenant read" on public.machine_service_signoffs;
create policy "machine service signoffs tenant read" on public.machine_service_signoffs
  for select using (company_id = public.get_current_user_company_id());
revoke all on public.machine_service_signoffs from public, anon, authenticated;
grant select on public.machine_service_signoffs to authenticated;

create table if not exists public.maintenance_completions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  schedule_id uuid not null references public.maintenance_schedules(id) on delete cascade,
  machine_ref_id uuid references public.machines(id) on delete set null,
  done_date date not null,
  next_due_date date,
  note text,
  completed_by uuid not null references auth.users(id),
  completed_at timestamptz not null default now()
);
create index if not exists maintenance_completions_company_schedule_idx on public.maintenance_completions(company_id, schedule_id, done_date desc);
alter table public.maintenance_completions enable row level security;
drop policy if exists "maintenance completions tenant read" on public.maintenance_completions;
create policy "maintenance completions tenant read" on public.maintenance_completions
  for select using (company_id = public.get_current_user_company_id());
revoke all on public.maintenance_completions from public, anon, authenticated;
grant select on public.maintenance_completions to authenticated;

create table if not exists private.machine_service_authorizations (
  transaction_id bigint not null,
  machine_id uuid not null references public.machines(id) on delete cascade,
  actor_id uuid not null,
  primary key (transaction_id, machine_id)
);
revoke all on private.machine_service_authorizations from public, anon, authenticated;

create or replace function private.resolve_company_machine(p_company_id uuid, p_ref uuid, p_text text)
returns uuid
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce(
    (select m.id from public.machines m where m.company_id = p_company_id and m.id = p_ref),
    (select m.id from public.machines m where m.company_id = p_company_id
       and (m.id::text = btrim(coalesce(p_text, '')) or lower(m.machine_code) = lower(btrim(coalesce(p_text, '')))
         or lower(m.machine_name) = lower(btrim(coalesce(p_text, ''))))
     order by (m.id::text = btrim(coalesce(p_text, ''))) desc, (lower(m.machine_code) = lower(btrim(coalesce(p_text, '')))) desc
     limit 1)
  )
$$;
revoke all on function private.resolve_company_machine(uuid, uuid, text) from public, anon, authenticated;

create or replace function private.maintenance_machine_type(p_machine_id uuid, p_fallback text)
returns text
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce((select case m.machine_type when 'packing_station' then 'packing_equipment'
      when 'extrusion_press' then 'extrusion_press' when 'aging_oven' then 'aging_oven'
      when 'powder_coating_line' then 'powder_coating_line' when 'anodizing_line' then 'anodizing_line'
      when 'cutting_machine' then 'cutting_machine' else null end
    from public.machines m where m.id = p_machine_id), p_fallback, 'other')
$$;
revoke all on function private.maintenance_machine_type(uuid, text) from public, anon, authenticated;

-- Machines: leaving breakdown/maintenance for a usable status needs the sign-off RPC.
create or replace function private.guard_machine_return_to_service()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if old.status in ('breakdown','maintenance') and new.status in ('active','operational','idle')
    and not exists (select 1 from private.machine_service_authorizations a
      where a.transaction_id = txid_current() and a.machine_id = old.id and a.actor_id = auth.uid()) then
    raise exception 'Return the machine to service through the maintenance sign-off (all breakdowns resolved)'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_machine_return_to_service() from public, anon, authenticated;
drop trigger if exists b_guard_machine_return_to_service on public.machines;
create trigger b_guard_machine_return_to_service
before update of status on public.machines
for each row execute function private.guard_machine_return_to_service();

-- Breakdowns: machine link, lifecycle, downtime and overlap.
create or replace function private.guard_breakdown_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  new.machine_ref_id := private.resolve_company_machine(new.company_id, new.machine_ref_id, new.machine_id);
  if new.machine_ref_id is null and (tg_op = 'INSERT' or old.machine_ref_id is not null) then
    raise exception 'Select a machine of this company for the breakdown' using errcode = '23514';
  end if;
  if new.machine_ref_id is not null then
    new.machine_type := private.maintenance_machine_type(new.machine_ref_id, new.machine_type);
  end if;
  if new.machine_ref_id is not null and nullif(btrim(coalesce(new.machine_id, '')), '') is null then
    select coalesce(m.machine_code, m.machine_name) into new.machine_id from public.machines m where m.id = new.machine_ref_id;
  end if;
  new.status := coalesce(new.status, 'open');
  new.start_time := coalesce(new.start_time, new.breakdown_date::timestamptz, now());
  if tg_op = 'UPDATE' then
    if old.status = 'resolved' and new.status <> 'resolved' then
      raise exception 'A resolved breakdown cannot be reopened; log a new breakdown' using errcode = '23514';
    end if;
    if old.status = 'resolved' and (new.machine_ref_id is distinct from old.machine_ref_id or new.start_time is distinct from old.start_time
      or new.end_time is distinct from old.end_time) then
      raise exception 'A resolved breakdown''s machine and downtime are frozen' using errcode = '23514';
    end if;
  end if;
  if new.status = 'resolved' and (tg_op = 'INSERT' or old.status <> 'resolved') then
    new.end_time := coalesce(new.end_time, now());
    new.resolved_at := now();
    new.resolved_by_user_id := auth.uid();
  end if;
  if new.end_time is not null and new.end_time < new.start_time then
    raise exception 'Breakdown end time is before its start time' using errcode = '23514';
  end if;
  if new.end_time is not null then
    new.downtime_minutes := greatest(0, round(extract(epoch from (new.end_time - new.start_time)) / 60)::integer);
  end if;
  if new.machine_ref_id is not null then
    perform 1 from public.machines where id = new.machine_ref_id for update;
    if exists (select 1 from public.breakdown_logs other
      where other.company_id = new.company_id and other.machine_ref_id = new.machine_ref_id and other.id <> new.id
        and tstzrange(other.start_time, coalesce(other.end_time, 'infinity'::timestamptz), '[)')
          && tstzrange(new.start_time, coalesce(new.end_time, 'infinity'::timestamptz), '[)')) then
      raise exception 'This breakdown overlaps another downtime record of the same machine' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_breakdown_lifecycle() from public, anon, authenticated;
drop trigger if exists a_guard_breakdown_lifecycle on public.breakdown_logs;
create trigger a_guard_breakdown_lifecycle
before insert or update on public.breakdown_logs
for each row execute function private.guard_breakdown_lifecycle();

create or replace function private.lock_machine_on_breakdown()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.machine_ref_id is not null and new.status in ('open','in_progress','recurring') then
    update public.machines set status = 'breakdown', updated_at = now()
    where id = new.machine_ref_id and company_id = new.company_id and status not in ('breakdown','inactive');
  end if;
  return null;
end;
$$;
revoke all on function private.lock_machine_on_breakdown() from public, anon, authenticated;
drop trigger if exists lock_machine_on_breakdown on public.breakdown_logs;
create trigger lock_machine_on_breakdown
after insert or update of status, machine_ref_id on public.breakdown_logs
for each row execute function private.lock_machine_on_breakdown();

create or replace function private.return_machine_to_service_atomic(p_machine_id uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_machine public.machines%rowtype;
  v_open integer;
  v_last uuid;
  v_id uuid;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if v_role not in ('owner','admin','factory_manager','production_manager') then
    raise exception 'Only an owner, admin, factory manager or production manager can return a machine to service' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_note, ''))) < 10 then
    raise exception 'Give a return-to-service note of at least 10 characters' using errcode = '23514';
  end if;
  select * into v_machine from public.machines where id = p_machine_id and company_id = v_company_id for update;
  if not found then raise exception 'Machine not found for this company' using errcode = '23514'; end if;
  if v_machine.status not in ('breakdown','maintenance') then
    raise exception 'Machine is % and is not locked out', v_machine.status using errcode = '23514';
  end if;
  select count(*) into v_open from public.breakdown_logs
  where company_id = v_company_id and machine_ref_id = p_machine_id and status <> 'resolved';
  if v_open > 0 then
    raise exception 'Resolve the % open breakdown(s) of this machine before returning it to service', v_open using errcode = '23514';
  end if;
  select id into v_last from public.breakdown_logs where company_id = v_company_id and machine_ref_id = p_machine_id
  order by coalesce(end_time, start_time) desc nulls last limit 1;

  insert into private.machine_service_authorizations(transaction_id, machine_id, actor_id)
  values (txid_current(), p_machine_id, auth.uid()) on conflict do nothing;
  update public.machines set status = 'active', updated_at = now() where id = p_machine_id and company_id = v_company_id;
  delete from private.machine_service_authorizations where transaction_id = txid_current() and machine_id = p_machine_id;
  insert into public.machine_service_signoffs(company_id, machine_id, from_status, to_status, last_breakdown_id, note, signed_by, signed_by_role)
  values (v_company_id, p_machine_id, v_machine.status, 'active', v_last, btrim(p_note), auth.uid(), v_role)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function private.return_machine_to_service_atomic(uuid, text) from public, anon, authenticated;
create or replace function public.return_machine_to_service_atomic(p_machine_id uuid, p_note text)
returns uuid language sql security definer set search_path = public, private
as $$ select private.return_machine_to_service_atomic(p_machine_id, p_note) $$;
revoke all on function public.return_machine_to_service_atomic(uuid, text) from public, anon;
grant execute on function public.return_machine_to_service_atomic(uuid, text) to authenticated;

-- Maintenance schedules.
create or replace function private.maintenance_next_due(p_last date, p_frequency text, p_value integer)
returns date
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when p_last is null then null
    when p_frequency = 'daily' then p_last + greatest(coalesce(p_value, 1), 1)
    when p_frequency = 'weekly' then p_last + 7 * greatest(coalesce(p_value, 1), 1)
    when p_frequency = 'monthly' then (p_last + make_interval(months => greatest(coalesce(p_value, 1), 1)))::date
    when p_frequency = 'quarterly' then (p_last + make_interval(months => 3 * greatest(coalesce(p_value, 1), 1)))::date
    when p_frequency = 'half_yearly' then (p_last + make_interval(months => 6 * greatest(coalesce(p_value, 1), 1)))::date
    when p_frequency = 'yearly' then (p_last + make_interval(years => greatest(coalesce(p_value, 1), 1)))::date
    else null end
$$;
revoke all on function private.maintenance_next_due(date, text, integer) from public, anon, authenticated;

create or replace function private.guard_maintenance_schedule()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  new.machine_ref_id := private.resolve_company_machine(new.company_id, new.machine_ref_id, new.machine_id);
  if new.machine_ref_id is null and (tg_op = 'INSERT' or old.machine_ref_id is not null) then
    raise exception 'Select a machine of this company for the maintenance schedule' using errcode = '23514';
  end if;
  if new.machine_ref_id is not null then
    new.machine_type := private.maintenance_machine_type(new.machine_ref_id, new.machine_type);
  end if;
  if new.machine_ref_id is not null and nullif(btrim(coalesce(new.machine_id, '')), '') is null then
    select coalesce(m.machine_code, m.machine_name) into new.machine_id from public.machines m where m.id = new.machine_ref_id;
  end if;
  if new.last_done_date is not null and (tg_op = 'INSERT' or new.last_done_date is distinct from old.last_done_date
    or new.frequency_type is distinct from old.frequency_type or new.frequency_value is distinct from old.frequency_value) then
    new.next_due_date := coalesce(private.maintenance_next_due(new.last_done_date, new.frequency_type, new.frequency_value), new.next_due_date);
  end if;
  if new.status in ('scheduled','overdue') then
    new.status := case when new.next_due_date is not null and new.next_due_date < current_date then 'overdue' else 'scheduled' end;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_maintenance_schedule() from public, anon, authenticated;
drop trigger if exists a_guard_maintenance_schedule on public.maintenance_schedules;
create trigger a_guard_maintenance_schedule
before insert or update on public.maintenance_schedules
for each row execute function private.guard_maintenance_schedule();

create or replace function private.complete_maintenance_schedule_atomic(p_schedule_id uuid, p_done_date date, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_schedule public.maintenance_schedules%rowtype;
  v_next date;
  v_id uuid;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if v_role not in ('owner','admin','factory_manager','production_manager') then
    raise exception 'Permission denied to complete maintenance' using errcode = '42501';
  end if;
  if p_done_date is null or p_done_date > current_date then
    raise exception 'Maintenance done date is required and cannot be in the future' using errcode = '23514';
  end if;
  select * into v_schedule from public.maintenance_schedules where id = p_schedule_id and company_id = v_company_id for update;
  if not found then raise exception 'Maintenance schedule not found for this company' using errcode = '23514'; end if;
  if v_schedule.status = 'cancelled' then raise exception 'A cancelled schedule cannot be completed' using errcode = '23514'; end if;
  v_next := private.maintenance_next_due(p_done_date, v_schedule.frequency_type, v_schedule.frequency_value);
  update public.maintenance_schedules set last_done_date = p_done_date, next_due_date = v_next,
    status = case when v_next is null then 'completed' else 'scheduled' end, updated_at = now()
  where id = p_schedule_id and company_id = v_company_id;
  insert into public.maintenance_completions(company_id, schedule_id, machine_ref_id, done_date, next_due_date, note, completed_by)
  values (v_company_id, p_schedule_id, v_schedule.machine_ref_id, p_done_date, v_next, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function private.complete_maintenance_schedule_atomic(uuid, date, text) from public, anon, authenticated;
create or replace function public.complete_maintenance_schedule_atomic(p_schedule_id uuid, p_done_date date, p_note text)
returns uuid language sql security definer set search_path = public, private
as $$ select private.complete_maintenance_schedule_atomic(p_schedule_id, p_done_date, p_note) $$;
revoke all on function public.complete_maintenance_schedule_atomic(uuid, date, text) from public, anon;
grant execute on function public.complete_maintenance_schedule_atomic(uuid, date, text) to authenticated;

-- Spare-part usage: reversible, not editable in place.
create or replace function private.reverse_breakdown_spare_part_usage()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if tg_op = 'UPDATE' then
    if new.quantity_used is distinct from old.quantity_used or new.spare_part_id is distinct from old.spare_part_id
      or new.company_id is distinct from old.company_id then
      raise exception 'Spare-part usage cannot be edited; delete it (stock is restored) and record the correct usage' using errcode = '23514';
    end if;
    return new;
  end if;
  update public.maintenance_spare_parts set current_stock = current_stock + old.quantity_used, updated_at = now()
  where id = old.spare_part_id and company_id = old.company_id;
  return old;
end;
$$;
revoke all on function private.reverse_breakdown_spare_part_usage() from public, anon, authenticated;
drop trigger if exists reverse_breakdown_spare_part_usage on public.breakdown_spare_part_usage;
create trigger reverse_breakdown_spare_part_usage
before update or delete on public.breakdown_spare_part_usage
for each row execute function private.reverse_breakdown_spare_part_usage();

commit;

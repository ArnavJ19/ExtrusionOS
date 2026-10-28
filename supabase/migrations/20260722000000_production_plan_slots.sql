-- Add press-level production planning slots without changing existing production job statuses.

create table if not exists public.production_plan_slots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  production_job_id uuid not null references public.production_jobs(id) on delete cascade,
  machine_id uuid not null references public.machines(id) on delete restrict,
  planned_start_at timestamptz not null,
  planned_end_at timestamptz,
  shift text,
  sequence_number integer not null default 0 check (sequence_number >= 0),
  capacity_kg numeric(14,3) check (capacity_kg is null or capacity_kg >= 0),
  locked_by uuid references auth.users(id) on delete set null,
  locked_at timestamptz,
  status text not null default 'scheduled' check (status in ('draft', 'scheduled', 'released', 'cancelled')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_plan_slots_time_check check (planned_end_at is null or planned_end_at > planned_start_at)
);

alter table public.production_plan_slots enable row level security;

drop policy if exists "production plan slots tenant read" on public.production_plan_slots;
create policy "production plan slots tenant read"
on public.production_plan_slots
for select
using (company_id = public.get_current_user_company_id());

drop policy if exists "production plan slots tenant insert" on public.production_plan_slots;
create policy "production plan slots tenant insert"
on public.production_plan_slots
for insert
with check (
  company_id = public.get_current_user_company_id()
  and public.get_current_user_role() in ('owner','admin','production_manager','production')
);

drop policy if exists "production plan slots tenant update" on public.production_plan_slots;
create policy "production plan slots tenant update"
on public.production_plan_slots
for update
using (
  company_id = public.get_current_user_company_id()
  and public.get_current_user_role() in ('owner','admin','production_manager','production')
)
with check (
  company_id = public.get_current_user_company_id()
  and public.get_current_user_role() in ('owner','admin','production_manager','production')
);

drop policy if exists "production plan slots tenant delete" on public.production_plan_slots;
create policy "production plan slots tenant delete"
on public.production_plan_slots
for delete
using (
  company_id = public.get_current_user_company_id()
  and public.get_current_user_role() in ('owner','admin')
);

create index if not exists production_plan_slots_company_machine_start_idx
  on public.production_plan_slots(company_id, machine_id, planned_start_at);

create index if not exists production_plan_slots_company_time_idx
  on public.production_plan_slots(company_id, planned_start_at, planned_end_at);

create index if not exists production_plan_slots_company_status_start_idx
  on public.production_plan_slots(company_id, status, planned_start_at);

create index if not exists production_plan_slots_company_job_idx
  on public.production_plan_slots(company_id, production_job_id);

create or replace function public.validate_production_plan_slot_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.production_jobs pj
    where pj.id = new.production_job_id
      and pj.company_id = new.company_id
  ) then
    raise exception 'Production plan slot job must belong to the same company' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.machines m
    where m.id = new.machine_id
      and m.company_id = new.company_id
  ) then
    raise exception 'Production plan slot machine must belong to the same company' using errcode = '23514';
  end if;

  if new.locked_by is not null and not exists (
    select 1
    from public.app_users au
    where au.id = new.locked_by
      and au.company_id = new.company_id
      and au.is_active = true
  ) then
    raise exception 'Production plan slot lock owner must belong to the same company' using errcode = '23514';
  end if;

  if new.created_by is not null and not exists (
    select 1
    from public.app_users au
    where au.id = new.created_by
      and au.company_id = new.company_id
      and au.is_active = true
  ) then
    raise exception 'Production plan slot creator must belong to the same company' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_production_plan_slot_tenant on public.production_plan_slots;
create trigger validate_production_plan_slot_tenant
before insert or update of company_id, production_job_id, machine_id, locked_by, created_by
on public.production_plan_slots
for each row execute function public.validate_production_plan_slot_tenant();

drop trigger if exists set_production_plan_slots_updated_at on public.production_plan_slots;
create trigger set_production_plan_slots_updated_at
before update on public.production_plan_slots
for each row execute function public.set_updated_at();

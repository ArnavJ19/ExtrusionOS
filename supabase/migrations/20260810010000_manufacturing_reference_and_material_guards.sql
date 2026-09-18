begin;

-- Keep production jobs inside one tenant and prevent jobs from pointing at a
-- die, profile, order, or machine owned by another company.
create or replace function public.validate_production_job_references()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_company_id uuid;
  v_profile_company_id uuid;
  v_die_company_id uuid;
  v_die_profile_id uuid;
  v_machine_company_id uuid;
  v_machine_type text;
begin
  select company_id into v_order_company_id from public.orders where id = new.order_id;
  if v_order_company_id is null or v_order_company_id <> new.company_id then
    raise exception 'Production job order does not belong to the selected company' using errcode = '23514';
  end if;

  select company_id into v_profile_company_id from public.aluminium_profiles where id = new.profile_id;
  if v_profile_company_id is null or v_profile_company_id <> new.company_id then
    raise exception 'Production job profile does not belong to the selected company' using errcode = '23514';
  end if;

  if new.die_id is not null then
    select company_id, profile_id into v_die_company_id, v_die_profile_id
    from public.dies where id = new.die_id;
    if v_die_company_id is null or v_die_company_id <> new.company_id then
      raise exception 'Production job die does not belong to the selected company' using errcode = '23514';
    end if;
    if v_die_profile_id <> new.profile_id then
      raise exception 'Production job die is not registered for the selected profile' using errcode = '23514';
    end if;
  end if;

  if new.machine_id is not null then
    select company_id, machine_type into v_machine_company_id, v_machine_type
    from public.machines where id = new.machine_id;
    if v_machine_company_id is null or v_machine_company_id <> new.company_id then
      raise exception 'Production job machine does not belong to the selected company' using errcode = '23514';
    end if;
    if v_machine_type <> 'extrusion_press' then
      raise exception 'Production jobs require an extrusion press machine' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_production_job_references on public.production_jobs;
create trigger validate_production_job_references
before insert or update of company_id, order_id, profile_id, die_id, machine_id
on public.production_jobs
for each row execute function public.validate_production_job_references();

revoke all on function public.validate_production_job_references() from public, anon, authenticated;

create or replace function public.guard_production_job_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.status <> 'planned' then
    raise exception 'New production jobs must start in planned status' using errcode = '23514';
  end if;
  if new.status = 'in_progress' and not exists (
    select 1 from public.production_plan_slots slot
    where slot.company_id = new.company_id
      and slot.production_job_id = new.id
      and slot.machine_id = new.machine_id
      and slot.status = 'released'
  ) then
    raise exception 'Production job requires a released press slot before it can start' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status and not (
    (old.status = 'planned' and new.status in ('ready','on_hold','cancelled'))
    or (old.status = 'ready' and new.status in ('in_progress','on_hold','cancelled'))
    or (old.status = 'in_progress' and new.status in ('completed','on_hold'))
    or (old.status = 'on_hold' and new.status in ('in_progress','cancelled'))
  ) then
    raise exception 'Use the production transition workflow for status changes' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_production_job_status on public.production_jobs;
create trigger guard_production_job_status
before insert or update of status, machine_id, company_id
on public.production_jobs
for each row execute function public.guard_production_job_status();

revoke all on function public.guard_production_job_status() from public, anon, authenticated;

-- Enforce the material and order lineage that allocation functions must use.
create or replace function public.validate_foundry_billet_lineage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requirement record;
  v_job record;
begin
  if new.allocation_requirement_id is not null then
    select id, company_id, order_id, profile_id, alloy, temper, billet_diameter_inch
    into v_requirement
    from public.order_billet_requirements
    where id = new.allocation_requirement_id
    for share;

    if v_requirement.id is null or v_requirement.company_id <> new.company_id then
      raise exception 'Billet allocation requirement does not belong to the selected company' using errcode = '23514';
    end if;
    if new.order_id is distinct from v_requirement.order_id then
      raise exception 'Billet allocation order does not match its requirement' using errcode = '23514';
    end if;
    if lower(btrim(coalesce(new.alloy, ''))) <> lower(btrim(coalesce(v_requirement.alloy, '')))
      or lower(btrim(coalesce(new.temper, ''))) <> lower(btrim(coalesce(v_requirement.temper, '')))
      or new.billet_diameter_inch <> v_requirement.billet_diameter_inch then
      raise exception 'Billet alloy, temper, and diameter must match the order requirement' using errcode = '23514';
    end if;
  end if;

  if new.production_job_id is not null then
    select company_id, order_id, profile_id into v_job
    from public.production_jobs
    where id = new.production_job_id
    for share;
    if v_job.company_id is null or v_job.company_id <> new.company_id then
      raise exception 'Billet production job does not belong to the selected company' using errcode = '23514';
    end if;
    if new.order_id is distinct from v_job.order_id then
      raise exception 'Billet order does not match its production job' using errcode = '23514';
    end if;
    if v_requirement.id is not null and v_requirement.profile_id <> v_job.profile_id then
      raise exception 'Billet requirement does not match the production job profile' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_foundry_billet_lineage on public.foundry_billets;
create trigger validate_foundry_billet_lineage
before insert or update of company_id, order_id, allocation_requirement_id, production_job_id,
  alloy, temper, billet_diameter_inch
on public.foundry_billets
for each row execute function public.validate_foundry_billet_lineage();

revoke all on function public.validate_foundry_billet_lineage() from public, anon, authenticated;

-- Requirements must come from explicit profile/order master data. This makes
-- missing alloy, temper, or diameter a visible planning error rather than a
-- silent 6063/T6/6-inch fallback.
create or replace function public.validate_order_billet_requirement_material()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile record;
  v_order record;
  v_die_diameter numeric;
  v_expected_alloy text;
  v_expected_temper text;
  v_expected_diameter numeric;
begin
  select company_id, alloy, temper, billet_alloy, temper_requirement, billet_diameter_required_inch
  into v_profile
  from public.aluminium_profiles
  where id = new.profile_id;
  if v_profile.company_id is null or v_profile.company_id <> new.company_id then
    raise exception 'Billet requirement profile does not belong to the selected company' using errcode = '23514';
  end if;

  select company_id, billet_diameter_required_inch, production_die_id
  into v_order
  from public.orders
  where id = new.order_id;
  if v_order.company_id is null or v_order.company_id <> new.company_id then
    raise exception 'Billet requirement order does not belong to the selected company' using errcode = '23514';
  end if;

  if v_order.production_die_id is not null then
    select billet_diameter_required_inch into v_die_diameter
    from public.dies
    where id = v_order.production_die_id and company_id = new.company_id;
  end if;

  v_expected_alloy := coalesce(nullif(btrim(v_profile.billet_alloy), ''), nullif(btrim(v_profile.alloy), ''));
  v_expected_temper := coalesce(nullif(btrim(v_profile.temper), ''), nullif(btrim(v_profile.temper_requirement), ''));
  v_expected_diameter := coalesce(v_order.billet_diameter_required_inch, v_die_diameter, v_profile.billet_diameter_required_inch);

  if nullif(btrim(new.alloy), '') is null or v_expected_alloy is null then
    raise exception 'Explicit billet alloy is required on the profile before production planning' using errcode = '23514';
  end if;
  if lower(btrim(new.alloy)) <> lower(v_expected_alloy) then
    raise exception 'Billet requirement alloy does not match the profile master data' using errcode = '23514';
  end if;
  if nullif(btrim(new.temper), '') is null or v_expected_temper is null then
    raise exception 'Explicit billet temper is required on the profile before production planning' using errcode = '23514';
  end if;
  if lower(btrim(new.temper)) <> lower(v_expected_temper) then
    raise exception 'Billet requirement temper does not match the profile master data' using errcode = '23514';
  end if;
  if v_expected_diameter is null or new.billet_diameter_inch <> v_expected_diameter then
    raise exception 'Explicit billet diameter is required and must match the order, die, or profile master data' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_order_billet_requirement_material on public.order_billet_requirements;
create trigger validate_order_billet_requirement_material
before insert or update of company_id, order_id, profile_id, alloy, temper, billet_diameter_inch
on public.order_billet_requirements
for each row execute function public.validate_order_billet_requirement_material();

revoke all on function public.validate_order_billet_requirement_material() from public, anon, authenticated;

commit;

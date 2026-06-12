alter table public.orders add column if not exists billets_required integer not null default 0;
alter table public.orders add column if not exists billets_allocated integer not null default 0;
alter table public.orders add column if not exists billets_short integer not null default 0;
alter table public.orders add column if not exists billet_allocation_status text not null default 'not_required';
alter table public.production_jobs alter column extrusion_efficiency_percent set default 75;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_billet_counts_valid') then
    alter table public.orders add constraint orders_billet_counts_valid check (billets_required >= 0 and billets_allocated >= 0 and billets_short >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_billet_allocation_status_check') then
    alter table public.orders add constraint orders_billet_allocation_status_check check (billet_allocation_status in ('not_required','pending','partial','complete','shortage'));
  end if;
end $$;

create table if not exists public.order_billet_requirements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  profile_id uuid not null references public.aluminium_profiles(id) on delete restrict,
  alloy text not null,
  temper text,
  billet_diameter_inch numeric(8,2) not null check (billet_diameter_inch > 0),
  billet_length_mm numeric(12,2) not null default 5800 check (billet_length_mm > 0),
  required_weight_kg numeric(14,3) not null default 0 check (required_weight_kg >= 0),
  billet_weight_kg numeric(14,3) not null default 0 check (billet_weight_kg >= 0),
  extrusion_efficiency_percent numeric(7,2) not null default 75 check (extrusion_efficiency_percent > 0 and extrusion_efficiency_percent <= 100),
  billets_required integer not null default 0 check (billets_required >= 0),
  billets_allocated integer not null default 0 check (billets_allocated >= 0),
  billets_short integer not null default 0 check (billets_short >= 0),
  status text not null default 'pending' check (status in ('not_required','pending','partial','complete','shortage','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_billet_requirements_unique unique (company_id, order_id, profile_id, alloy, temper, billet_diameter_inch)
);

alter table public.order_billet_requirements enable row level security;

drop policy if exists "order billet requirements tenant read" on public.order_billet_requirements;
create policy "order billet requirements tenant read" on public.order_billet_requirements for select using (company_id = public.get_current_user_company_id());
drop policy if exists "order billet requirements tenant insert" on public.order_billet_requirements;
create policy "order billet requirements tenant insert" on public.order_billet_requirements for insert with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','production_manager','production'));
drop policy if exists "order billet requirements tenant update" on public.order_billet_requirements;
create policy "order billet requirements tenant update" on public.order_billet_requirements for update using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','production_manager','production')) with check (company_id = public.get_current_user_company_id());

create index if not exists order_billet_requirements_company_order_idx on public.order_billet_requirements(company_id, order_id);
create index if not exists order_billet_requirements_company_status_idx on public.order_billet_requirements(company_id, status, billet_diameter_inch, alloy);

alter table public.foundry_billets add column if not exists allocation_requirement_id uuid references public.order_billet_requirements(id) on delete set null;
alter table public.foundry_billets add column if not exists allocated_at timestamptz;
alter table public.foundry_billets add column if not exists allocated_by uuid references auth.users(id);

alter table public.foundry_billets drop constraint if exists foundry_billets_status_check;
alter table public.foundry_billets add constraint foundry_billets_status_check check (status in ('planned','cast','allocated','issued','consumed','scrap','cancelled'));

create index if not exists foundry_billets_company_requirement_idx on public.foundry_billets(company_id, allocation_requirement_id, status);
create index if not exists foundry_billets_company_available_match_idx on public.foundry_billets(company_id, status, alloy, billet_diameter_inch, created_at);

drop trigger if exists set_order_billet_requirements_updated_at on public.order_billet_requirements;
create trigger set_order_billet_requirements_updated_at before update on public.order_billet_requirements for each row execute function public.set_updated_at();

create or replace function public.notify_billet_allocation(
  p_company_id uuid,
  p_title text,
  p_body text,
  p_severity text,
  p_order_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user record;
begin
  for v_user in
    select id from public.app_users
    where company_id = p_company_id
      and is_active = true
      and role in ('owner','admin','production_manager','production')
  loop
    insert into public.notifications(company_id, recipient_user_id, notification_type, severity, title, body, related_entity_type, related_entity_id, created_by)
    values (p_company_id, v_user.id, 'billet_allocation', p_severity, p_title, p_body, 'order', p_order_id, auth.uid());
  end loop;
end;
$$;

create or replace function public.refresh_order_billet_allocations(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_req record;
  v_total_required integer := 0;
  v_total_allocated integer := 0;
  v_total_short integer := 0;
  v_status text := 'not_required';
begin
  select id, company_id into v_order from public.orders where id = p_order_id;
  if v_order.id is null then return; end if;

  for v_req in
    select r.id, r.billets_required, r.status as old_status,
      count(b.id)::integer as allocated_count
    from public.order_billet_requirements r
    left join public.foundry_billets b on b.company_id = r.company_id and b.allocation_requirement_id = r.id and b.order_id = r.order_id and b.status in ('allocated','issued','consumed')
    where r.company_id = v_order.company_id and r.order_id = p_order_id
    group by r.id, r.billets_required, r.status
  loop
    update public.order_billet_requirements
    set billets_allocated = least(v_req.allocated_count, v_req.billets_required),
        billets_short = greatest(v_req.billets_required - v_req.allocated_count, 0),
        status = case
          when v_req.billets_required <= 0 then 'not_required'
          when v_req.allocated_count <= 0 then 'shortage'
          when v_req.allocated_count < v_req.billets_required then 'partial'
          else 'complete'
        end
    where id = v_req.id;
  end loop;

  select coalesce(sum(billets_required), 0)::integer,
         coalesce(sum(billets_allocated), 0)::integer,
         coalesce(sum(billets_short), 0)::integer
  into v_total_required, v_total_allocated, v_total_short
  from public.order_billet_requirements
  where company_id = v_order.company_id and order_id = p_order_id and status <> 'cancelled';

  v_status := case
    when v_total_required <= 0 then 'not_required'
    when v_total_allocated <= 0 then 'shortage'
    when v_total_allocated < v_total_required then 'partial'
    when v_total_short > 0 then 'partial'
    else 'complete'
  end;

  update public.orders
  set billets_required = v_total_required,
      billets_allocated = v_total_allocated,
      billets_short = v_total_short,
      billet_allocation_status = v_status
  where id = p_order_id and company_id = v_order.company_id;

  update public.orders
  set current_stage = 'billet_ready'
  where id = p_order_id
    and company_id = v_order.company_id
    and v_status = 'complete'
    and current_stage in ('order_confirmed','die_ready');
end;
$$;

create or replace function public.rebuild_order_billet_requirements(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_quote_total numeric;
  v_target_weight numeric;
  v_group record;
  v_required_weight numeric;
  v_billet_weight numeric;
  v_required_count integer;
begin
  select * into v_order from public.orders where id = p_order_id;
  if v_order.id is null then return; end if;

  delete from public.order_billet_requirements r
  where r.company_id = v_order.company_id
    and r.order_id = v_order.id
    and not exists (
      select 1 from public.foundry_billets b
      where b.company_id = r.company_id and b.allocation_requirement_id = r.id and b.status in ('allocated','issued','consumed')
    );

  if v_order.current_stage in ('closed','cancelled') then
    update public.order_billet_requirements set status = 'cancelled' where company_id = v_order.company_id and order_id = v_order.id;
    perform public.refresh_order_billet_allocations(v_order.id);
    return;
  end if;

  if v_order.quote_id is not null then
    select round(coalesce(sum(coalesce(qi.billing_weight_kg, qi.total_weight_kg, 0)), 0)::numeric, 3)
    into v_quote_total
    from public.quote_items qi
    where qi.company_id = v_order.company_id and qi.quote_id = v_order.quote_id and qi.profile_id is not null;

    v_target_weight := coalesce(nullif(v_order.manufacturing_weight_kg, 0), nullif(v_order.production_quantity_kg, 0), v_quote_total, 0);

    for v_group in
      select qi.profile_id,
             coalesce(nullif(p.alloy, ''), '6063') as alloy,
             coalesce(nullif(p.temper, ''), 'T6') as temper,
             coalesce(v_order.billet_diameter_required_inch, d.billet_diameter_required_inch, p.billet_diameter_required_inch, 6) as billet_diameter_inch,
             round(sum(coalesce(qi.billing_weight_kg, qi.total_weight_kg, 0))::numeric, 3) as group_weight
      from public.quote_items qi
      join public.aluminium_profiles p on p.id = qi.profile_id and p.company_id = qi.company_id
      left join public.dies d on d.id = coalesce(qi.die_id, v_order.production_die_id) and d.company_id = qi.company_id
      where qi.company_id = v_order.company_id and qi.quote_id = v_order.quote_id and qi.profile_id is not null
      group by qi.profile_id, coalesce(nullif(p.alloy, ''), '6063'), coalesce(nullif(p.temper, ''), 'T6'), coalesce(v_order.billet_diameter_required_inch, d.billet_diameter_required_inch, p.billet_diameter_required_inch, 6)
    loop
      v_required_weight := case when coalesce(v_quote_total, 0) > 0 then round((v_group.group_weight * v_target_weight / v_quote_total)::numeric, 3) else 0 end;
      v_billet_weight := round((pi() * power(((v_group.billet_diameter_inch * 25.4) / 2000), 2) * (5800 / 1000.0) * 2700)::numeric, 3);
      v_required_count := case when v_required_weight > 0 and v_billet_weight > 0 then greatest(1, ceil((v_required_weight / 0.75) / v_billet_weight)::integer) else 0 end;

      insert into public.order_billet_requirements(company_id, order_id, profile_id, alloy, temper, billet_diameter_inch, billet_length_mm, required_weight_kg, billet_weight_kg, billets_required, extrusion_efficiency_percent)
      values (v_order.company_id, v_order.id, v_group.profile_id, v_group.alloy, v_group.temper, v_group.billet_diameter_inch, 5800, v_required_weight, v_billet_weight, v_required_count, 75)
      on conflict (company_id, order_id, profile_id, alloy, temper, billet_diameter_inch) do update set
        required_weight_kg = excluded.required_weight_kg,
        billet_weight_kg = excluded.billet_weight_kg,
        billets_required = excluded.billets_required,
        extrusion_efficiency_percent = 75,
        status = case when public.order_billet_requirements.status = 'cancelled' then 'pending' else public.order_billet_requirements.status end,
        updated_at = now();
    end loop;
  elsif v_order.production_profile_id is not null and coalesce(v_order.production_quantity_kg, v_order.manufacturing_weight_kg, 0) > 0 then
    select coalesce(v_order.production_quantity_kg, v_order.manufacturing_weight_kg, 0) into v_required_weight;
    for v_group in
      select p.id as profile_id,
             coalesce(nullif(p.alloy, ''), '6063') as alloy,
             coalesce(nullif(p.temper, ''), 'T6') as temper,
             coalesce(v_order.billet_diameter_required_inch, d.billet_diameter_required_inch, p.billet_diameter_required_inch, 6) as billet_diameter_inch
      from public.aluminium_profiles p
      left join public.dies d on d.id = v_order.production_die_id and d.company_id = p.company_id
      where p.id = v_order.production_profile_id and p.company_id = v_order.company_id
    loop
      v_billet_weight := round((pi() * power(((v_group.billet_diameter_inch * 25.4) / 2000), 2) * (5800 / 1000.0) * 2700)::numeric, 3);
      v_required_count := case when v_required_weight > 0 and v_billet_weight > 0 then greatest(1, ceil((v_required_weight / 0.75) / v_billet_weight)::integer) else 0 end;
      insert into public.order_billet_requirements(company_id, order_id, profile_id, alloy, temper, billet_diameter_inch, billet_length_mm, required_weight_kg, billet_weight_kg, billets_required, extrusion_efficiency_percent)
      values (v_order.company_id, v_order.id, v_group.profile_id, v_group.alloy, v_group.temper, v_group.billet_diameter_inch, 5800, v_required_weight, v_billet_weight, v_required_count, 75)
      on conflict (company_id, order_id, profile_id, alloy, temper, billet_diameter_inch) do update set
        required_weight_kg = excluded.required_weight_kg,
        billet_weight_kg = excluded.billet_weight_kg,
        billets_required = excluded.billets_required,
        extrusion_efficiency_percent = 75,
        updated_at = now();
    end loop;
  end if;

  with surplus as (
    select b.id,
           row_number() over (partition by b.allocation_requirement_id order by b.allocated_at desc nulls last, b.created_at desc) as allocation_rank,
           r.billets_required
    from public.foundry_billets b
    join public.order_billet_requirements r on r.id = b.allocation_requirement_id and r.company_id = b.company_id
    where r.company_id = v_order.company_id
      and r.order_id = v_order.id
      and b.status = 'allocated'
  )
  update public.foundry_billets b
  set order_id = null,
      allocation_requirement_id = null,
      status = 'cast',
      allocated_at = null,
      allocated_by = null,
      updated_at = now()
  from surplus s
  where b.id = s.id and s.allocation_rank > s.billets_required;

  perform public.refresh_order_billet_allocations(v_order.id);
end;
$$;

create or replace function public.allocate_billets_by_priority(p_company_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_req record;
  v_billet record;
  v_needed integer;
  v_previous_status text;
  v_order_status text;
begin
  v_company_id := coalesce(p_company_id, public.get_current_user_company_id());
  if v_company_id is null then return; end if;

  for v_req in
    select r.*, o.order_number, o.priority, o.expected_dispatch_date, o.order_date, o.current_stage
    from public.order_billet_requirements r
    join public.orders o on o.id = r.order_id and o.company_id = r.company_id
    where r.company_id = v_company_id
      and r.status in ('pending','partial','shortage')
      and o.current_stage not in ('closed','cancelled','dispatched','delivered')
    order by case o.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 when 'low' then 3 else 4 end,
             o.expected_dispatch_date nulls last,
             o.order_date,
             o.created_at
  loop
    v_previous_status := v_req.status;
    perform public.refresh_order_billet_allocations(v_req.order_id);
    select greatest(billets_required - billets_allocated, 0) into v_needed from public.order_billet_requirements where id = v_req.id;

    for v_billet in
      select id
      from public.foundry_billets
      where company_id = v_company_id
        and status = 'cast'
        and order_id is null
        and allocation_requirement_id is null
        and lower(coalesce(alloy, '')) = lower(v_req.alloy)
        and billet_diameter_inch = v_req.billet_diameter_inch
      order by case source_type when 'in_house' then 0 else 1 end, created_at, billet_code
      for update skip locked
    loop
      exit when v_needed <= 0;
      update public.foundry_billets
      set order_id = v_req.order_id,
          allocation_requirement_id = v_req.id,
          status = 'allocated',
          allocated_at = now(),
          allocated_by = auth.uid()
      where id = v_billet.id and company_id = v_company_id and status = 'cast';
      v_needed := v_needed - 1;
    end loop;

    perform public.refresh_order_billet_allocations(v_req.order_id);
    select billet_allocation_status into v_order_status from public.orders where id = v_req.order_id and company_id = v_company_id;

    if v_order_status = 'complete' and v_previous_status <> 'complete' then
      perform public.notify_billet_allocation(v_company_id, 'Billet requirement complete', concat('Order ', v_req.order_number, ' has all required billets allocated and is ready for production.'), 'success', v_req.order_id);
    elsif v_needed > 0 and v_previous_status <> 'shortage' then
      perform public.notify_billet_allocation(v_company_id, 'Billet shortage', concat('Order ', v_req.order_number, ' still needs ', v_needed::text, ' more billet', case when v_needed = 1 then '' else 's' end, '. Schedule a foundry job or outsource compatible billets.'), 'warning', v_req.order_id);
    end if;
  end loop;
end;
$$;

create or replace function public.allocate_billet_to_order(p_billet_id uuid, p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_billet record;
  v_req record;
  v_order record;
begin
  v_company_id := public.get_current_user_company_id();
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if public.get_current_user_role() not in ('owner','admin','production_manager','production') then
    raise exception 'You do not have permission to allocate billets' using errcode = '42501';
  end if;

  select * into v_billet from public.foundry_billets where id = p_billet_id and company_id = v_company_id for update;
  if v_billet.id is null then raise exception 'Billet not found' using errcode = '23514'; end if;
  if v_billet.status <> 'cast' or v_billet.order_id is not null then raise exception 'Only unallocated cast billets can be allocated manually' using errcode = '23514'; end if;

  select id, order_number, current_stage into v_order from public.orders where id = p_order_id and company_id = v_company_id;
  if v_order.id is null then raise exception 'Order not found' using errcode = '23514'; end if;
  if v_order.current_stage in ('closed','cancelled','dispatched','delivered') then raise exception 'This order is not open for billet allocation' using errcode = '23514'; end if;

  perform public.rebuild_order_billet_requirements(p_order_id);

  select r.* into v_req
  from public.order_billet_requirements r
  where r.company_id = v_company_id
    and r.order_id = p_order_id
    and lower(r.alloy) = lower(coalesce(v_billet.alloy, ''))
    and r.billet_diameter_inch = v_billet.billet_diameter_inch
    and r.billets_allocated < r.billets_required
    and r.status <> 'cancelled'
  order by r.created_at
  limit 1
  for update;

  if v_req.id is null then
    if not exists (select 1 from public.order_billet_requirements r where r.company_id = v_company_id and r.order_id = p_order_id and lower(r.alloy) = lower(coalesce(v_billet.alloy, ''))) then
      raise exception 'Billet alloy % does not match the alloy required for this order', v_billet.alloy using errcode = '23514';
    end if;
    if not exists (select 1 from public.order_billet_requirements r where r.company_id = v_company_id and r.order_id = p_order_id and r.billet_diameter_inch = v_billet.billet_diameter_inch) then
      raise exception 'Billet diameter % inch does not match the diameter required for this order', v_billet.billet_diameter_inch using errcode = '23514';
    end if;
    raise exception 'This order already has enough compatible billets allocated' using errcode = '23514';
  end if;

  update public.foundry_billets
  set order_id = p_order_id,
      allocation_requirement_id = v_req.id,
      status = 'allocated',
      allocated_at = now(),
      allocated_by = auth.uid()
  where id = p_billet_id and company_id = v_company_id;

  perform public.refresh_order_billet_allocations(p_order_id);
  if exists (select 1 from public.orders where id = p_order_id and company_id = v_company_id and billet_allocation_status = 'complete') then
    perform public.notify_billet_allocation(v_company_id, 'Billet requirement complete', concat('Order ', v_order.order_number, ' has all required billets allocated and is ready for production.'), 'success', p_order_id);
  end if;
  return v_req.id;
end;
$$;

grant execute on function public.allocate_billets_by_priority(uuid) to authenticated;
grant execute on function public.allocate_billet_to_order(uuid, uuid) to authenticated;

create or replace function public.handle_order_billet_requirements()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.rebuild_order_billet_requirements(new.id);
  perform public.allocate_billets_by_priority(new.company_id);
  return new;
end;
$$;

drop trigger if exists handle_order_billet_requirements on public.orders;
create trigger handle_order_billet_requirements
after insert or update of quote_id, production_profile_id, production_die_id, manufacturing_weight_kg, production_quantity_kg, billet_diameter_required_inch, priority, current_stage
on public.orders
for each row execute function public.handle_order_billet_requirements();

create or replace function public.handle_available_billet_allocation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'cast' and new.order_id is null then
    perform public.allocate_billets_by_priority(new.company_id);
  end if;
  return new;
end;
$$;

drop trigger if exists handle_available_billet_allocation on public.foundry_billets;
create trigger handle_available_billet_allocation
after insert or update of status, alloy, billet_diameter_inch
on public.foundry_billets
for each row
when (new.status = 'cast' and new.order_id is null)
execute function public.handle_available_billet_allocation();

create or replace function public.sync_foundry_billets()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  i integer;
  v_code text;
  v_status text;
begin
  v_status := case when new.status in ('cast','homogenizing','ready','issued') then 'cast' else 'planned' end;
  for i in 1..new.billet_count loop
    v_code := concat(new.furnace_number, '-', to_char(new.production_date, 'YYYYMMDD'), '-', new.batch_sequence::text, '-', i::text);
    insert into public.foundry_billets (company_id, source_type, foundry_batch_id, billet_code, billet_number, billet_diameter_inch, billet_diameter_mm, billet_length_mm, alloy, temper, weight_kg, status)
    values (new.company_id, 'in_house', new.id, v_code, i, new.billet_diameter_inch, new.billet_diameter_mm, new.billet_length_mm, new.alloy, new.temper, new.billet_weight_density_kg, v_status)
    on conflict (foundry_batch_id, billet_number) where source_type = 'in_house' do update set
      billet_code = excluded.billet_code,
      billet_diameter_inch = excluded.billet_diameter_inch,
      billet_diameter_mm = excluded.billet_diameter_mm,
      billet_length_mm = excluded.billet_length_mm,
      alloy = excluded.alloy,
      temper = excluded.temper,
      weight_kg = excluded.weight_kg,
      status = case when public.foundry_billets.status in ('allocated','issued','consumed','scrap') then public.foundry_billets.status else excluded.status end,
      updated_at = now();
  end loop;
  return new;
end;
$$;

drop trigger if exists sync_foundry_billets on public.foundry_batches;
create trigger sync_foundry_billets after insert or update of furnace_number, production_date, batch_sequence, billet_diameter_inch, billet_diameter_mm, billet_length_mm, alloy, temper, billet_weight_density_kg, billet_count, status on public.foundry_batches for each row execute function public.sync_foundry_billets();

create or replace function public.link_billets_to_production_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'completed' then
    update public.foundry_billets
    set status = 'consumed',
        updated_at = now()
    where company_id = new.company_id
      and production_job_id = new.id
      and status in ('allocated','issued');

    insert into public.packaging_jobs(company_id, packaging_number, order_id, production_job_id, material_id, scheduled_date, pieces, profile_weight_kg, profile_length_m, status, notes, created_by)
    values (
      new.company_id,
      concat('PKG-', to_char(now(), 'YYYY'), '-', substring(new.id::text, 1, 8)),
      new.order_id,
      new.id,
      null,
      current_date,
      coalesce(new.pieces, 0),
      coalesce(new.actual_quantity_kg, new.planned_quantity_kg, 0),
      coalesce(new.length_per_piece_m, 0) * coalesce(new.pieces, 0),
      'scheduled',
      'Auto-created after production completion. Select packaging material to issue stock.',
      auth.uid()
    )
    on conflict (company_id, packaging_number) do nothing;
  end if;
  return new;
end;
$$;

do $$
declare
  v_order record;
begin
  for v_order in select id, company_id from public.orders loop
    perform public.rebuild_order_billet_requirements(v_order.id);
  end loop;
  for v_order in select distinct company_id from public.orders loop
    perform public.allocate_billets_by_priority(v_order.company_id);
  end loop;
end $$;

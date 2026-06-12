create or replace function public.repair_order_billet_requirement_links(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_req record;
  v_billet record;
  v_needed integer;
begin
  select id, company_id into v_order from public.orders where id = p_order_id;
  if v_order.id is null then return; end if;

  for v_req in
    select r.id, r.alloy, r.billet_diameter_inch, r.billets_required, r.billets_allocated
    from public.order_billet_requirements r
    where r.company_id = v_order.company_id
      and r.order_id = v_order.id
      and r.status <> 'cancelled'
    order by r.created_at
  loop
    v_needed := greatest(v_req.billets_required - v_req.billets_allocated, 0);
    if v_needed <= 0 then
      continue;
    end if;

    for v_billet in
      select id
      from public.foundry_billets
      where company_id = v_order.company_id
        and order_id = v_order.id
        and allocation_requirement_id is null
        and status in ('allocated','issued','consumed')
        and lower(coalesce(alloy, '')) = lower(coalesce(v_req.alloy, ''))
        and billet_diameter_inch = v_req.billet_diameter_inch
      order by allocated_at nulls last, created_at, billet_code
      for update skip locked
    loop
      exit when v_needed <= 0;
      update public.foundry_billets
      set allocation_requirement_id = v_req.id,
          updated_at = now()
      where id = v_billet.id
        and company_id = v_order.company_id
        and allocation_requirement_id is null;
      v_needed := v_needed - 1;
    end loop;
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

  perform public.repair_order_billet_requirement_links(p_order_id);

  update public.foundry_billets
  set order_id = null,
      allocation_requirement_id = null,
      allocated_at = null,
      allocated_by = null,
      updated_at = now()
  where company_id = v_order.company_id
    and order_id = p_order_id
    and status = 'cancelled';

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
  v_order_ids uuid[];
  v_order_id uuid;
begin
  if new.status = 'cancelled' then
    select array_agg(distinct order_id)
    into v_order_ids
    from public.foundry_billets
    where company_id = new.company_id
      and foundry_batch_id = new.id
      and source_type = 'in_house'
      and order_id is not null;

    update public.foundry_billets
    set status = 'cancelled',
        order_id = null,
        allocation_requirement_id = null,
        allocated_at = null,
        allocated_by = null,
        updated_at = now()
    where company_id = new.company_id
      and foundry_batch_id = new.id
      and source_type = 'in_house'
      and status not in ('consumed','scrap');

    if v_order_ids is not null then
      foreach v_order_id in array v_order_ids loop
        perform public.refresh_order_billet_allocations(v_order_id);
      end loop;
    end if;
    return new;
  end if;

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
      status = case when public.foundry_billets.status in ('allocated','issued','consumed','scrap','cancelled') then public.foundry_billets.status else excluded.status end,
      updated_at = now();
  end loop;
  return new;
end;
$$;

create or replace function public.reallocate_billet_to_order(p_billet_id uuid, p_order_id uuid)
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
  v_old_order_id uuid;
begin
  v_company_id := public.get_current_user_company_id();
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if public.get_current_user_role() not in ('owner','admin','production_manager','production') then
    raise exception 'You do not have permission to allocate billets' using errcode = '42501';
  end if;

  select * into v_billet
  from public.foundry_billets
  where id = p_billet_id and company_id = v_company_id
  for update;
  if v_billet.id is null then raise exception 'Billet not found' using errcode = '23514'; end if;
  if v_billet.status not in ('cast','allocated') then raise exception 'Only cast or allocated billets can be reallocated' using errcode = '23514'; end if;
  if v_billet.production_job_id is not null then raise exception 'This billet is already issued to a production job' using errcode = '23514'; end if;

  v_old_order_id := v_billet.order_id;

  select id, order_number, current_stage into v_order
  from public.orders
  where id = p_order_id and company_id = v_company_id;
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

  if v_old_order_id is not null and v_old_order_id <> p_order_id then
    perform public.refresh_order_billet_allocations(v_old_order_id);
  end if;
  perform public.refresh_order_billet_allocations(p_order_id);

  if exists (select 1 from public.orders where id = p_order_id and company_id = v_company_id and billet_allocation_status = 'complete') then
    perform public.notify_billet_allocation(v_company_id, 'Billet requirement complete', concat('Order ', v_order.order_number, ' has all required billets allocated and is ready for production.'), 'success', p_order_id);
  end if;
  return v_req.id;
end;
$$;

grant execute on function public.reallocate_billet_to_order(uuid, uuid) to authenticated;

do $$
declare
  v_order record;
begin
  for v_order in select id from public.orders loop
    perform public.refresh_order_billet_allocations(v_order.id);
  end loop;
end $$;

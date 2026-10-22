-- R25: use the same material and dispatched-profile rules as manual allocation.
-- Requires the reconciled R21/R22 chain; existing allocations are not rewritten.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create or replace function public.allocate_billets_by_priority(p_company_id uuid default null)
returns void
language plpgsql
security definer
set search_path=public,private
as $$
declare
  v_company_id uuid:=coalesce(p_company_id,private.get_current_user_company_id());
  v_req record;
  v_current public.order_billet_requirements%rowtype;
  v_billet record;
  v_needed integer;
  v_stage text;
  v_previous_status text;
  v_order_status text;
begin
  if v_company_id is null then return;end if;
  if auth.uid() is not null and v_company_id is distinct from private.get_current_user_company_id() then
    raise exception 'Cannot allocate billets outside the active company' using errcode='42501';
  end if;
  if auth.uid() is not null and coalesce(private.get_current_user_role(),'') not in ('owner','admin','factory_manager','production_manager','production') then
    raise exception 'Permission denied to allocate billets' using errcode='42501';
  end if;

  for v_req in
    select r.*,o.order_number
    from public.order_billet_requirements r
    join public.orders o on o.id=r.order_id and o.company_id=r.company_id
    where r.company_id=v_company_id and r.status in ('pending','partial','shortage')
      and o.current_stage not in ('closed','cancelled','delivered','payment_pending')
      and (o.current_stage<>'dispatched' or private.order_profile_needs_billet_allocation(v_company_id,o.id,r.profile_id))
    order by case o.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 when 'low' then 3 else 4 end,
      o.expected_dispatch_date nulls last,o.order_date,o.created_at,o.id,r.created_at,r.id
  loop
    -- A queued requirement can change while another transaction owns its order.
    select current_stage into v_stage from public.orders
      where id=v_req.order_id and company_id=v_company_id for update;
    if not found or v_stage is null or v_stage in ('closed','cancelled','delivered','payment_pending') then continue;end if;
    v_previous_status:=v_req.status;
    perform public.refresh_order_billet_allocations(v_req.order_id);
    select * into v_current from public.order_billet_requirements
      where id=v_req.id and company_id=v_company_id and order_id=v_req.order_id for update;
    if not found or v_current.status='cancelled' then continue;end if;
    v_needed:=greatest(v_current.billets_required-v_current.billets_allocated,0);
    if v_needed<=0 or (v_stage='dispatched' and not private.order_profile_needs_billet_allocation(v_company_id,v_req.order_id,v_current.profile_id)) then continue;end if;

    for v_billet in
      select id from public.foundry_billets
      where company_id=v_company_id and status='cast' and order_id is null and allocation_requirement_id is null
        and production_job_id is null
        and lower(btrim(coalesce(alloy,'')))=lower(btrim(coalesce(v_current.alloy,'')))
        and lower(btrim(coalesce(temper,'')))=lower(btrim(coalesce(v_current.temper,'')))
        and billet_diameter_inch=v_current.billet_diameter_inch
      order by case source_type when 'in_house' then 0 else 1 end,created_at,billet_code,id
      for update skip locked
    loop
      exit when v_needed<=0;
      update public.foundry_billets set order_id=v_req.order_id,allocation_requirement_id=v_current.id,
        status='allocated',allocated_at=now(),allocated_by=auth.uid()
      where id=v_billet.id and company_id=v_company_id and status='cast'
        and order_id is null and allocation_requirement_id is null and production_job_id is null;
      if found then v_needed:=v_needed-1;end if;
    end loop;
    perform public.refresh_order_billet_allocations(v_req.order_id);
    select billet_allocation_status into v_order_status from public.orders where id=v_req.order_id and company_id=v_company_id;
    if v_order_status='complete' and v_previous_status<>'complete' then
      perform public.notify_billet_allocation(v_company_id,'Billet requirement complete',concat('Order ',v_req.order_number,' has all required billets allocated and is ready for production.'),'success',v_req.order_id);
    elsif v_needed>0 and v_previous_status<>'shortage' then
      perform public.notify_billet_allocation(v_company_id,'Billet shortage',concat('Order ',v_req.order_number,' still needs ',v_needed::text,' more billet',case when v_needed=1 then '' else 's' end,'. Schedule a foundry job or outsource compatible billets.'),'warning',v_req.order_id);
    end if;
  end loop;
end;
$$;

-- Allocation remains an internal writer reached through existing authorized flows.
revoke all on function public.allocate_billets_by_priority(uuid) from public,anon,authenticated;
commit;

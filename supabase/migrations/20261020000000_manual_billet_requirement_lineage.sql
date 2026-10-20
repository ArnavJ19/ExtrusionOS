-- R22 local candidate only; not applied. Requires the reconciled prerequisite chain.
begin;

create or replace function private.order_profile_needs_billet_allocation(p_company_id uuid,p_order_id uuid,p_profile_id uuid)
returns boolean language plpgsql stable security definer set search_path=public,private as $$
declare
  v_order public.orders%rowtype;
  v_lines integer;
  v_committed numeric;
  v_stock numeric;
begin
  select * into v_order from public.orders where id=p_order_id and company_id=p_company_id;
  if not found or p_profile_id is null or v_order.current_stage in ('closed','cancelled','delivered','payment_pending') then return false;end if;
  if exists(select 1 from public.production_jobs j where j.company_id=p_company_id and j.order_id=p_order_id
    and j.profile_id=p_profile_id and j.status in ('planned','ready','in_progress','on_hold')) then return true;end if;
  select count(*) into v_lines from public.order_items where company_id=p_company_id and order_id=p_order_id;
  if v_lines>0 then
    return exists(select 1 from public.order_items line where line.company_id=p_company_id and line.order_id=p_order_id
      and line.profile_id=p_profile_id and line.quantity_kg>0
      and line.quantity_kg>coalesce((select sum(case when j.status='completed' and coalesce(j.actual_quantity_kg,0)>0
          then j.actual_quantity_kg else j.planned_quantity_kg end)
        from public.production_jobs j where j.company_id=p_company_id and j.order_id=p_order_id
          and j.source_line_id=line.id and j.status<>'cancelled'),0)
        +coalesce((select sum(f.fulfilled_weight_kg) from public.order_dealer_stock_fulfillments f
          where f.company_id=p_company_id and f.order_id=p_order_id and f.order_item_id=line.id and f.credited_at is null),0)+0.001);
  end if;
  if v_order.production_profile_id is distinct from p_profile_id then return false;end if;
  select coalesce(sum(case when j.status='completed' and coalesce(j.actual_quantity_kg,0)>0
    then j.actual_quantity_kg else j.planned_quantity_kg end),0) into v_committed
    from public.production_jobs j where j.company_id=p_company_id and j.order_id=p_order_id and j.status<>'cancelled';
  select coalesce(sum(fulfilled_weight_kg),0) into v_stock from public.order_dealer_stock_fulfillments
    where company_id=p_company_id and order_id=p_order_id and credited_at is null;
  return coalesce(v_order.production_quantity_kg,v_order.manufacturing_weight_kg,0)>v_committed+v_stock+0.001;
end;
$$;
revoke all on function private.order_profile_needs_billet_allocation(uuid,uuid,uuid) from public,anon,authenticated;

create or replace function private.assign_billet_to_order(p_billet_id uuid,p_order_id uuid,p_reallocate boolean)
returns uuid language plpgsql security definer set search_path=public,private as $$
declare
  v_company uuid:=private.get_current_user_company_id();
  v_billet public.foundry_billets%rowtype;
  v_order public.orders%rowtype;
  v_req public.order_billet_requirements%rowtype;
  v_old_order uuid;
  v_updated integer;
begin
  if v_company is null or auth.uid() is null then raise exception 'Authentication required' using errcode='28000';end if;
  if coalesce(private.get_current_user_role(),'') not in ('owner','admin','factory_manager','production_manager','production') then
    raise exception 'You do not have permission to allocate billets' using errcode='42501';end if;
  select * into v_billet from public.foundry_billets where id=p_billet_id and company_id=v_company;
  if not found then raise exception 'Billet not found' using errcode='23514';end if;
  if not p_reallocate and (v_billet.status is distinct from 'cast' or v_billet.order_id is not null
    or v_billet.allocation_requirement_id is not null or v_billet.production_job_id is not null) then
    raise exception 'Only unallocated cast billets without production linkage can be allocated manually' using errcode='23514';end if;
  if p_reallocate and (coalesce(v_billet.status,'') not in ('cast','allocated') or v_billet.production_job_id is not null) then
    raise exception 'Only cast or allocated billets not issued to production are available for reallocation' using errcode='23514';end if;
  v_old_order:=v_billet.order_id;
  -- Both entry points keep parent locks ordered before locking the billet row.
  perform 1 from public.orders where company_id=v_company and id in (p_order_id,v_old_order) order by id for update nowait;
  select * into v_billet from public.foundry_billets where id=p_billet_id and company_id=v_company for update nowait;
  if not found or v_billet.order_id is distinct from v_old_order or coalesce(v_billet.status,'') not in ('cast','allocated')
    or v_billet.production_job_id is not null then raise exception 'Billet allocation changed while this request was waiting' using errcode='23514';end if;
  if not p_reallocate and (v_billet.status<>'cast' or v_billet.order_id is not null or v_billet.allocation_requirement_id is not null) then
    raise exception 'Billet was allocated while this request was waiting' using errcode='23514';end if;
  if v_old_order is not null and not exists(select 1 from public.orders where id=v_old_order and company_id=v_company) then
    raise exception 'Existing billet allocation has inconsistent company/order evidence; review it before reallocation' using errcode='23514';end if;
  if v_billet.status='allocated' and v_old_order is null then
    raise exception 'Existing billet allocation is missing its source order; review it before reallocation' using errcode='23514';end if;
  if v_billet.allocation_requirement_id is not null and not exists(select 1 from public.order_billet_requirements r
    where r.id=v_billet.allocation_requirement_id and r.company_id=v_company and r.order_id=v_old_order
      and lower(btrim(coalesce(r.alloy,'')))=lower(btrim(coalesce(v_billet.alloy,'')))
      and lower(btrim(coalesce(r.temper,'')))=lower(btrim(coalesce(v_billet.temper,'')))
      and r.billet_diameter_inch=v_billet.billet_diameter_inch) then
    raise exception 'Existing billet allocation has inconsistent requirement evidence; review it before reallocation' using errcode='23514';end if;
  select * into v_order from public.orders where id=p_order_id and company_id=v_company;
  if not found then raise exception 'Order not found' using errcode='23514';end if;
  if v_order.current_stage in ('closed','cancelled','delivered','payment_pending') then
    raise exception 'This order is not open for billet allocation' using errcode='23514';end if;
  perform public.rebuild_order_billet_requirements(p_order_id);
  select r.* into v_req from public.order_billet_requirements r where r.company_id=v_company and r.order_id=p_order_id
    and lower(btrim(coalesce(r.alloy,'')))=lower(btrim(coalesce(v_billet.alloy,'')))
    and lower(btrim(coalesce(r.temper,'')))=lower(btrim(coalesce(v_billet.temper,'')))
    and r.billet_diameter_inch=v_billet.billet_diameter_inch and r.billets_allocated<r.billets_required and r.status<>'cancelled'
    and (v_order.current_stage<>'dispatched' or private.order_profile_needs_billet_allocation(v_company,p_order_id,r.profile_id))
    order by r.created_at,r.id limit 1 for update;
  if not found then
    if v_order.current_stage='dispatched' then
      raise exception 'This order has no remaining production eligible for a compatible billet requirement' using errcode='23514';end if;
    raise exception 'No open compatible requirement needs this billet; refresh the order allocation' using errcode='23514';
  end if;
  update public.foundry_billets set order_id=p_order_id,allocation_requirement_id=v_req.id,status='allocated',allocated_at=now(),allocated_by=auth.uid()
    where id=p_billet_id and company_id=v_company;
  get diagnostics v_updated=row_count;
  if v_updated<>1 then raise exception 'Billet allocation was not written; refresh and retry' using errcode='23514';end if;
  if v_old_order is not null and v_old_order<>p_order_id then perform public.refresh_order_billet_allocations(v_old_order);end if;
  perform public.refresh_order_billet_allocations(p_order_id);
  if exists(select 1 from public.orders where id=p_order_id and company_id=v_company and billet_allocation_status='complete') then
    perform public.notify_billet_allocation(v_company,'Billet requirement complete',concat('Order ',v_order.order_number,' has all required billets allocated and is ready for production.'),'success',p_order_id);
  end if;
  return v_req.id;
end;
$$;
revoke all on function private.assign_billet_to_order(uuid,uuid,boolean) from public,anon,authenticated;

create or replace function private.allocate_billet_to_order(p_billet_id uuid,p_order_id uuid)
returns uuid language sql security definer set search_path=public,private as $$
  select private.assign_billet_to_order(p_billet_id,p_order_id,false);
$$;
revoke all on function private.allocate_billet_to_order(uuid,uuid) from public,anon;
grant execute on function private.allocate_billet_to_order(uuid,uuid) to authenticated;

create or replace function private.reallocate_billet_to_order(p_billet_id uuid,p_order_id uuid)
returns uuid language sql security definer set search_path=public,private as $$
  select private.assign_billet_to_order(p_billet_id,p_order_id,true);
$$;
revoke all on function private.reallocate_billet_to_order(uuid,uuid) from public,anon;
grant execute on function private.reallocate_billet_to_order(uuid,uuid) to authenticated;

commit;

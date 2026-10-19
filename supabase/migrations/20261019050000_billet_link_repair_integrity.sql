-- R21 local candidate only; not applied. Requires the reconciled prerequisite chain.
begin;

create or replace function public.repair_order_billet_requirement_links(p_order_id uuid)
returns void language plpgsql security definer set search_path=public,private as $$
declare
  v_order record;
  v_req record;
  v_billet record;
  v_needed integer;
  v_updated integer;
begin
  select id,company_id into v_order from public.orders where id=p_order_id;
  if v_order.id is null then return;end if;
  if exists(select 1 from public.foundry_billets b join public.order_billet_requirements r on r.id=b.allocation_requirement_id
    where r.company_id=v_order.company_id and r.order_id=v_order.id and r.status<>'cancelled'
      and b.status in ('allocated','issued','consumed')
      and (b.company_id is distinct from r.company_id or b.order_id is distinct from r.order_id
        or lower(btrim(coalesce(b.alloy,'')))<>lower(btrim(coalesce(r.alloy,'')))
        or lower(btrim(coalesce(b.temper,'')))<>lower(btrim(coalesce(r.temper,'')))
        or b.billet_diameter_inch is distinct from r.billet_diameter_inch
        or (b.production_job_id is not null and not exists(select 1 from public.production_jobs j
          where j.id=b.production_job_id and j.company_id=r.company_id and j.order_id=r.order_id and j.profile_id=r.profile_id)))) then
    raise exception 'Existing billet links are inconsistent; review historical allocation evidence before repair' using errcode='23514';
  end if;
  for v_req in
    select r.id,r.profile_id,r.alloy,r.temper,r.billet_diameter_inch,r.billets_required
    from public.order_billet_requirements r
    where r.company_id=v_order.company_id and r.order_id=v_order.id and r.status<>'cancelled'
    order by r.created_at,r.id
  loop
    -- The stored counter may be stale before refresh; retained links are the evidence.
    select greatest(v_req.billets_required-count(*)::integer,0) into v_needed
    from public.foundry_billets
    where company_id=v_order.company_id and order_id=v_order.id and allocation_requirement_id=v_req.id
      and status in ('allocated','issued','consumed');
    if v_needed<=0 then continue;end if;
    for v_billet in
      select b.id from public.foundry_billets b
      where b.company_id=v_order.company_id and b.order_id=v_order.id and b.allocation_requirement_id is null
        and b.status in ('allocated','issued','consumed')
        and lower(btrim(coalesce(b.alloy,'')))=lower(btrim(coalesce(v_req.alloy,'')))
        and lower(btrim(coalesce(b.temper,'')))=lower(btrim(coalesce(v_req.temper,'')))
        and b.billet_diameter_inch=v_req.billet_diameter_inch
        and (b.production_job_id is null or exists(select 1 from public.production_jobs j where j.id=b.production_job_id
          and j.company_id=v_order.company_id and j.order_id=v_order.id and j.profile_id=v_req.profile_id))
      order by b.allocated_at nulls last,b.created_at,b.billet_code,b.id
      for update skip locked
    loop
      exit when v_needed<=0;
      update public.foundry_billets set allocation_requirement_id=v_req.id,updated_at=now()
      where id=v_billet.id and company_id=v_order.company_id and order_id=v_order.id
        and allocation_requirement_id is null and status in ('allocated','issued','consumed');
      get diagnostics v_updated=row_count;
      v_needed:=v_needed-v_updated;
    end loop;
  end loop;
end;
$$;
revoke all on function public.repair_order_billet_requirement_links(uuid) from public,anon,authenticated;

commit;

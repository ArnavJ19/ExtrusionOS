-- R24 prepared read-only candidate. Requires R21/R22 and the reconciled chain.
begin;

create or replace function public.get_manual_billet_allocation_options(p_billet_id uuid,p_search text default '',p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare
  v_company uuid:=private.get_current_user_company_id();
  v_billet public.foundry_billets%rowtype;
  v_header jsonb;
  v_result jsonb;
  v_search text:=btrim(coalesce(p_search,''));
begin
  if v_company is null or auth.uid() is null then raise exception 'Authentication required' using errcode='28000';end if;
  if coalesce(private.get_current_user_role(),'') not in ('owner','admin','factory_manager','production_manager','production') then
    raise exception 'You do not have permission to allocate billets' using errcode='42501';end if;
  if p_page is null or p_page<1 or char_length(v_search)>100 then raise exception 'Invalid allocation search or page' using errcode='22023';end if;
  select * into v_billet from public.foundry_billets where id=p_billet_id and company_id=v_company;
  if not found then raise exception 'Billet not found' using errcode='23514';end if;
  v_header:=jsonb_build_object('id',v_billet.id,'company_id',v_company,'billet_code',v_billet.billet_code,
    'alloy',v_billet.alloy,'temper',v_billet.temper,'billet_diameter_inch',v_billet.billet_diameter_inch,
    'status',v_billet.status,'order_id',v_billet.order_id,'production_job_id',v_billet.production_job_id);
  if coalesce(v_billet.status,'') not in ('cast','allocated') or v_billet.production_job_id is not null then
    return jsonb_build_object('company_id',v_company,'billet',v_header,'search',v_search,'page',1,'page_size',10,'total_count',0,'items','[]'::jsonb);
  end if;
  if (v_billet.status='allocated' and v_billet.order_id is null)
    or (v_billet.order_id is not null and not exists(select 1 from public.orders where id=v_billet.order_id and company_id=v_company))
    or (v_billet.allocation_requirement_id is not null and not exists(select 1 from public.order_billet_requirements r
      where r.id=v_billet.allocation_requirement_id and r.company_id=v_company and r.order_id=v_billet.order_id
        and lower(btrim(coalesce(r.alloy,'')))=lower(btrim(coalesce(v_billet.alloy,'')))
        and lower(btrim(coalesce(r.temper,'')))=lower(btrim(coalesce(v_billet.temper,'')))
        and r.billet_diameter_inch=v_billet.billet_diameter_inch)) then
    raise exception 'Existing billet allocation needs historical review before reallocation' using errcode='23514';
  end if;
  -- A read must not repair legacy links or advertise capacity from stale counters.
  if exists(
    select 1 from public.order_billet_requirements r
    left join public.orders o on o.id=r.order_id and o.company_id=r.company_id
    left join lateral (select count(*)::integer allocated from public.foundry_billets b
      where b.company_id=r.company_id and b.order_id=r.order_id and b.allocation_requirement_id=r.id and b.status in ('allocated','issued','consumed')) actual on true
    where r.company_id=v_company and r.status is distinct from 'cancelled'
      and lower(btrim(coalesce(r.alloy,'')))=lower(btrim(coalesce(v_billet.alloy,'')))
      and lower(btrim(coalesce(r.temper,'')))=lower(btrim(coalesce(v_billet.temper,'')))
      and r.billet_diameter_inch=v_billet.billet_diameter_inch
      and (o.id is null or o.current_stage is null or (o.current_stage not in ('closed','cancelled','delivered','payment_pending') and (
        r.billets_required is null or r.billets_required<0 or r.billets_allocated is null or r.billets_short is null
        or actual.allocated>r.billets_required or r.billets_allocated<>actual.allocated
        or r.billets_short<>greatest(r.billets_required-actual.allocated,0)
        or exists(select 1 from public.foundry_billets b where b.allocation_requirement_id=r.id and b.status in ('allocated','issued','consumed')
          and (b.company_id is distinct from r.company_id or b.order_id is distinct from r.order_id
            or lower(btrim(coalesce(b.alloy,'')))<>lower(btrim(coalesce(r.alloy,'')))
            or lower(btrim(coalesce(b.temper,'')))<>lower(btrim(coalesce(r.temper,'')))
            or b.billet_diameter_inch is distinct from r.billet_diameter_inch
            or (b.production_job_id is not null and not exists(select 1 from public.production_jobs j
              where j.id=b.production_job_id and j.company_id=r.company_id and j.order_id=r.order_id and j.profile_id=r.profile_id))))
        or exists(select 1 from public.foundry_billets b where b.company_id=r.company_id and b.order_id=r.order_id
          and b.allocation_requirement_id is null and b.status in ('allocated','issued','consumed')
          and lower(btrim(coalesce(b.alloy,'')))=lower(btrim(coalesce(r.alloy,'')))
          and lower(btrim(coalesce(b.temper,'')))=lower(btrim(coalesce(r.temper,''))) and b.billet_diameter_inch=r.billet_diameter_inch)
      )))
  ) then raise exception 'Order allocation evidence needs refresh or historical review before choosing an order' using errcode='23514';end if;

  with matching as materialized (
    select r.*,o.order_number,o.priority,o.current_stage
    from public.order_billet_requirements r join public.orders o on o.id=r.order_id and o.company_id=r.company_id
    where r.company_id=v_company and o.current_stage not in ('closed','cancelled','delivered','payment_pending')
      and r.status<>'cancelled' and r.billets_allocated<r.billets_required
      and lower(btrim(coalesce(r.alloy,'')))=lower(btrim(coalesce(v_billet.alloy,'')))
      and lower(btrim(coalesce(r.temper,'')))=lower(btrim(coalesce(v_billet.temper,'')))
      and r.billet_diameter_inch=v_billet.billet_diameter_inch
      and (o.current_stage<>'dispatched' or private.order_profile_needs_billet_allocation(v_company,o.id,r.profile_id))
      and (v_search='' or strpos(lower(o.order_number),lower(v_search))>0)
  ), grouped as materialized (
    select v_company company_id,order_id,order_number,priority,current_stage,count(*)::integer requirement_count,
      sum(billets_required) billets_required,sum(billets_allocated) billets_allocated,sum(billets_required-billets_allocated) billets_short
    from matching group by order_id,order_number,priority,current_stage
  ), metadata as (
    select count(*)::integer total_count,least(p_page,greatest(1,ceil(count(*)/10.0)::integer)) page from grouped
  ), items as (
    select * from grouped order by order_number,order_id limit 10 offset (select (page-1)*10 from metadata)
  ) select jsonb_build_object('company_id',v_company,'billet',v_header,'search',v_search,
    'page',metadata.page,'page_size',10,'total_count',metadata.total_count,
    'items',coalesce((select jsonb_agg(to_jsonb(items) order by order_number,order_id) from items),'[]'::jsonb))
    into v_result from metadata;
  return v_result;
end;
$$;
revoke all on function public.get_manual_billet_allocation_options(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.get_manual_billet_allocation_options(uuid,text,integer) to authenticated;

commit;

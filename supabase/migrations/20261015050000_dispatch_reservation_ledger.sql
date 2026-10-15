-- Prepared only. One shared calculation serves inventory and dispatch views.
begin;

create or replace function private.profile_stock_reservation_ledger_page(
  p_page integer, p_search text, p_status text, p_sort text, p_direction text, p_order_id uuid
)
returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare
  v_company uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_search text := lower(btrim(coalesce(p_search,'')));
begin
  if auth.uid() is null or v_company is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if v_role is null or v_role not in ('owner','admin','production_manager','production','factory_manager','inventory_manager','dispatch_manager','dispatch') then
    raise exception 'Permission denied to inspect stock reservations' using errcode='42501';
  end if;
  if p_page is null or p_page<1 or p_page>100000 or length(v_search)>100
    or p_status is null or p_status not in ('','active','released','consumed','cancelled')
    or p_sort is null or p_sort not in ('created_at','reserved_weight_kg','status','released_at')
    or p_direction is null or p_direction not in ('asc','desc') then
    raise exception 'Invalid reservation ledger filters' using errcode='22023';
  end if;

  return (
    with consumption as (
      select c.reservation_id,sum(c.consumed_weight_kg) weight_kg,
        case when bool_or(c.consumed_length_m is null) then null else sum(c.consumed_length_m) end length_m,
        case when bool_or(c.consumed_pieces is null) then null else sum(c.consumed_pieces) end pieces,
        bool_and(c.consumed_weight_kg is not null and c.consumed_weight_kg>=0
          and c.consumed_weight_kg::text not in ('NaN','Infinity','-Infinity')
          and (c.consumed_length_m is null or (c.consumed_length_m>=0 and c.consumed_length_m::text not in ('NaN','Infinity','-Infinity')))
          and (c.consumed_pieces is null or c.consumed_pieces>=0)
          and held.id is not null
          and c.order_id is not distinct from held.order_id
          and c.profile_id is not distinct from held.profile_id
          and c.profile_stock_batch_id is not distinct from held.profile_stock_batch_id) valid_source
      from public.profile_stock_consumptions c
      left join public.profile_stock_reservations held on held.id=c.reservation_id and held.company_id=v_company
      where c.company_id=v_company and (p_order_id is null or held.order_id=p_order_id)
      group by c.reservation_id
    ), source as (
      select r.id,r.order_id,r.status,r.created_at,r.released_at,r.notes,
        profile.profile_code,profile.profile_name,order_record.order_number,
        coalesce(nullif(customer.company_name,''),customer.customer_name) customer_name,
        batch.bundle_number,batch.location,
        coalesce(r.initial_reserved_weight_kg,r.reserved_weight_kg) reserved_weight_kg,
        coalesce(r.initial_reserved_length_m,r.reserved_length_m) reserved_length_m,
        coalesce(r.initial_reserved_pieces,r.reserved_pieces) reserved_pieces,
        coalesce(c.weight_kg,0) consumed_weight_kg,
        case when c.reservation_id is null then 0 else c.length_m end consumed_length_m,
        case when c.reservation_id is null then 0 else c.pieces end consumed_pieces,
        coalesce(c.valid_source,true) and profile.id is not null and order_record.id is not null and batch.id is not null valid_source
      from public.profile_stock_reservations r
      left join consumption c on c.reservation_id=r.id
      left join public.aluminium_profiles profile on profile.id=r.profile_id and profile.company_id=v_company
      left join public.orders order_record on order_record.id=r.order_id and order_record.company_id=v_company
      left join public.customers customer on customer.id=order_record.customer_id and customer.company_id=v_company
      left join public.profile_stock_batches batch on batch.id=r.profile_stock_batch_id and batch.company_id=v_company and batch.profile_id=r.profile_id
      where r.company_id=v_company and (p_order_id is null or r.order_id=p_order_id)
    ), quantities as (
      select s.*,greatest(s.reserved_weight_kg-s.consumed_weight_kg,0) remaining_weight_kg,
        case when s.reserved_length_m is null or s.consumed_length_m is null then null else greatest(s.reserved_length_m-s.consumed_length_m,0) end remaining_length_m,
        case when s.reserved_pieces is null or s.consumed_pieces is null then null else greatest(s.reserved_pieces-s.consumed_pieces,0) end remaining_pieces
      from source s
    ), filtered as materialized (
      select q.id,q.order_id,q.profile_code,q.profile_name,q.order_number,q.customer_name,q.bundle_number,q.location,
        q.status,q.created_at,q.released_at,q.notes,q.reserved_weight_kg,q.reserved_length_m,q.reserved_pieces,
        q.consumed_weight_kg,q.consumed_length_m,q.consumed_pieces,
        case when q.status='active' then q.remaining_weight_kg else 0 end open_weight_kg,
        case when q.status='active' then q.remaining_length_m else 0 end open_length_m,
        case when q.status='active' then q.remaining_pieces else 0 end open_pieces,
        case when q.status in ('released','cancelled') then q.remaining_weight_kg else 0 end released_weight_kg,
        case when q.status in ('released','cancelled') then q.remaining_length_m else 0 end released_length_m,
        case when q.status in ('released','cancelled') then q.remaining_pieces else 0 end released_pieces,
        q.valid_source and q.status is not null and q.status in ('active','released','consumed','cancelled')
          and q.reserved_weight_kg is not null and q.reserved_weight_kg>=0 and q.reserved_weight_kg::text not in ('NaN','Infinity','-Infinity')
          and q.consumed_weight_kg<=q.reserved_weight_kg+0.001
          and (q.reserved_length_m is null or (q.reserved_length_m>=0 and q.reserved_length_m::text not in ('NaN','Infinity','-Infinity')))
          and (q.reserved_pieces is null or q.reserved_pieces>=0)
          and (q.reserved_length_m is null or q.consumed_length_m is null or q.consumed_length_m<=q.reserved_length_m+0.001)
          and (q.reserved_pieces is null or q.consumed_pieces is null or q.consumed_pieces<=q.reserved_pieces)
          and (q.status<>'consumed' or (q.remaining_weight_kg<=0.001
            and (q.remaining_length_m is null or q.remaining_length_m<=0.001)
            and (q.remaining_pieces is null or q.remaining_pieces=0))) valid_source
      from quantities q
      where (p_status='' or q.status=p_status)
        and (v_search='' or strpos(lower(concat_ws(' ',q.profile_code,q.profile_name,q.order_number,q.customer_name,q.bundle_number,q.location,q.notes)),v_search)>0)
    ), totals as (
      select count(*) total_count,count(*) filter(where status='active' and open_weight_kg>0) active_count,
        coalesce(sum(open_weight_kg),0) open_weight_kg,coalesce(sum(consumed_weight_kg),0) consumed_weight_kg,
        coalesce(sum(released_weight_kg),0) released_weight_kg,coalesce(bool_and(valid_source),true) integrity_ok
      from filtered
    ), bounds as (
      select least(p_page,greatest(1,ceil(total_count::numeric/10)::integer)) page from totals
    ), page_rows as (
      select f.* from filtered f order by
        case when p_sort='created_at' and p_direction='asc' then f.created_at end asc nulls last,
        case when p_sort='created_at' and p_direction='desc' then f.created_at end desc nulls last,
        case when p_sort='released_at' and p_direction='asc' then f.released_at end asc nulls last,
        case when p_sort='released_at' and p_direction='desc' then f.released_at end desc nulls last,
        case when p_sort='reserved_weight_kg' and p_direction='asc' then f.reserved_weight_kg end asc nulls last,
        case when p_sort='reserved_weight_kg' and p_direction='desc' then f.reserved_weight_kg end desc nulls last,
        case when p_sort='status' and p_direction='asc' then f.status end asc nulls last,
        case when p_sort='status' and p_direction='desc' then f.status end desc nulls last,f.id asc
      limit 10 offset ((select page from bounds)-1)*10
    )
    select jsonb_build_object('page',bounds.page,'page_size',10,'total_count',totals.total_count,'integrity_ok',totals.integrity_ok,
      'summary',jsonb_build_object('active_count',totals.active_count,'open_weight_kg',totals.open_weight_kg,
        'consumed_weight_kg',totals.consumed_weight_kg,'released_weight_kg',totals.released_weight_kg),
      'rows',coalesce((select jsonb_agg(to_jsonb(p)-'valid_source') from page_rows p),'[]'::jsonb))
    from totals cross join bounds
  );
end;
$$;
revoke all on function private.profile_stock_reservation_ledger_page(integer,text,text,text,text,uuid) from public,anon,authenticated;

create or replace function public.get_profile_stock_reservation_ledger_page(
  p_page integer default 1,p_search text default '',p_status text default '',p_sort text default 'created_at',p_direction text default 'desc'
)
returns jsonb language sql stable security definer set search_path=public,private as $$
  select private.profile_stock_reservation_ledger_page(p_page,p_search,p_status,p_sort,p_direction,null);
$$;
revoke all on function public.get_profile_stock_reservation_ledger_page(integer,text,text,text,text) from public,anon;
grant execute on function public.get_profile_stock_reservation_ledger_page(integer,text,text,text,text) to authenticated;

create or replace function public.get_dispatch_reservation_ledger_page(p_dispatch_id uuid,p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare
  v_company uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_order_id uuid;
  v_order_number text;
begin
  if auth.uid() is null or v_company is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if v_role is null or v_role not in ('owner','admin','factory_manager','inventory_manager','dispatch_manager','dispatch') then
    raise exception 'Permission denied to inspect dispatch reservations' using errcode='42501';
  end if;
  if p_dispatch_id is null or p_page is null or p_page<1 or p_page>100000 then raise exception 'Invalid dispatch reservation request' using errcode='22023'; end if;
  select order_id into v_order_id from public.dispatches where id=p_dispatch_id and company_id=v_company;
  if not found then raise exception 'Dispatch reservations are unavailable for this account' using errcode='42501'; end if;
  -- An unlinked dispatch must never turn into an unfiltered company ledger.
  if v_order_id is null then
    return jsonb_build_object('dispatch_id',p_dispatch_id,'order_id',null,'order_number',null,'ledger',null);
  end if;
  select order_number into v_order_number from public.orders where id=v_order_id and company_id=v_company;
  if not found then raise exception 'The dispatch source order is unavailable' using errcode='23514'; end if;
  return jsonb_build_object('dispatch_id',p_dispatch_id,'order_id',v_order_id,'order_number',v_order_number,
    'ledger',private.profile_stock_reservation_ledger_page(p_page,'','','created_at','desc',v_order_id));
end;
$$;
revoke all on function public.get_dispatch_reservation_ledger_page(uuid,integer) from public,anon;
grant execute on function public.get_dispatch_reservation_ledger_page(uuid,integer) to authenticated;

commit;

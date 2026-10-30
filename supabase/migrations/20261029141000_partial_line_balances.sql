begin;
create index if not exists packing_company_order_line on public.packing_list_items(company_id,order_item_id);
create function private.guard_partial_order_line_packing() returns trigger
language plpgsql security definer set search_path=public,private as $$
declare l public.order_items;v_order uuid;v_pieces numeric;v_metres numeric;v_cap_m numeric;
begin
  if new.order_item_id is null then return new; end if;
  select order_id into v_order from public.dispatches where id=new.dispatch_id and company_id=new.company_id;
  select * into l from public.order_items where id=new.order_item_id and company_id=new.company_id and order_id=v_order for update;
  if not found or l.profile_id is distinct from new.profile_id then raise exception 'Packing must retain the exact order line'; end if;
  select coalesce(sum(number_of_pieces),0),coalesce(sum(net_length_m),0) into v_pieces,v_metres from public.packing_list_items where company_id=new.company_id and order_item_id=l.id and id<>new.id;
  if l.quantity_pieces is not null and l.quantity_pieces::text not in ('NaN','Infinity','-Infinity') and v_pieces+new.number_of_pieces>l.quantity_pieces then raise exception 'Cumulative packed pieces exceed the original order line'; end if;
  v_cap_m:=case when l.quantity_pieces is not null and l.length_per_piece_m is not null then l.quantity_pieces*l.length_per_piece_m
    when coalesce(l.manufacturing_weight_kg,l.quantity_kg)>0 and l.section_weight_kg_per_m>0 then coalesce(l.manufacturing_weight_kg,l.quantity_kg)/l.section_weight_kg_per_m end;
  if v_cap_m is not null and v_cap_m::text not in ('NaN','Infinity','-Infinity') and v_metres+new.net_length_m>v_cap_m+0.001 then raise exception 'Cumulative packed metres exceed the original order line'; end if;
  return new;
end $$;
revoke all on function private.guard_partial_order_line_packing() from public,anon,authenticated;
create trigger zz_partial_order_line_packing before insert or update of order_item_id,dispatch_id,company_id,profile_id,number_of_pieces,net_length_m on public.packing_list_items for each row execute function private.guard_partial_order_line_packing();

-- Correct the existing queues without changing their stock-coverage or due-date policy.
create or replace function private.order_line_requirements(p_company uuid,p_order uuid)
returns table(order_item_id uuid,order_id uuid,order_number text,customer_name text,order_stage text,line_label text,profile_code text,
  ordered_kg numeric,from_stock_kg numeric,produced_kg numeric,planned_open_kg numeric,packed_kg numeric,dispatched_kg numeric,
  line_required_date date,line_priority text,effective_date date,effective_priority text,date_source text,priority_source text,
  version integer,updated_by_name text,updated_at timestamptz,order_closed boolean)
language sql stable security definer set search_path=public,private as $$
  select q.order_item_id,q.order_id,q.order_number,q.customer_name,q.order_stage,q.line_label,q.profile_code,
    q.ordered_kg,q.from_stock_kg+coalesce(s.covered_kg,0),q.produced_kg,q.planned_open_kg,coalesce(p.packed_kg,0),coalesce(p.dispatched_kg,0),
    q.line_required_date,q.line_priority,q.effective_date,q.effective_priority,q.date_source,q.priority_source,q.version,q.updated_by_name,q.updated_at,q.order_closed
  from private.order_line_requirements_before_factory_stock(p_company,p_order) q
  left join lateral(select sum(a.covered_weight_kg) covered_kg from public.order_stock_allocations a join public.profile_stock_reservations r on r.id=a.reservation_id and r.company_id=a.company_id where a.company_id=p_company and a.order_item_id=q.order_item_id and r.status in ('active','consumed'))s on true
  left join lateral(select sum(pl.net_weight_kg) packed_kg,sum(pl.net_weight_kg) filter(where d.actual_dispatched_at is not null) dispatched_kg
    from public.packing_list_items pl join public.dispatches d on d.id=pl.dispatch_id and d.company_id=pl.company_id where pl.company_id=p_company and pl.order_item_id=q.order_item_id)p on true;
$$;
revoke all on function private.order_line_requirements(uuid,uuid) from public,anon,authenticated;

create function public.order_partial_progress(p_order_id uuid,p_page int default 1) returns jsonb
language plpgsql stable security definer set search_path=public,private as $$
declare c uuid;rows jsonb;finance boolean;v_missing int;v_total int;
begin
  c:=private.commercial_actor(array['owner','admin','sales','sales_manager','production_manager','production','factory_manager','inventory_manager','dispatch_manager','dispatch','quality','accounts','viewer']);
  finance:=private.get_current_user_role() in ('owner','admin','accounts');
  if p_page is null or p_page not between 1 and 10000 then raise exception 'Invalid progress page'; end if;
  perform 1 from public.orders where id=p_order_id and company_id=c and deleted_at is null;if not found then raise exception 'Order is unavailable'; end if;
  select count(*) into v_missing from public.packing_list_items p join public.dispatches d on d.id=p.dispatch_id and d.company_id=p.company_id where d.order_id=p_order_id and p.company_id=c and p.order_item_id is null;
  select count(*) into v_total from public.order_items where company_id=c and order_id=p_order_id;
  select coalesce(jsonb_agg(to_jsonb(r)-'billed_kg'||case when finance then jsonb_build_object('billed_kg',r.billed_kg) else '{}'::jsonb end),'[]') into rows from(
    select i.id,i.profile_id,coalesce(nullif(i.item_description,''),p.profile_code,'Order line') label,
      coalesce(i.manufacturing_weight_kg,i.quantity_kg) ordered_kg,i.quantity_pieces ordered_pieces,i.quantity_pieces*i.length_per_piece_m ordered_metres,
      q.produced_kg,q.planned_open_kg,coalesce(x.pieces,0) packed_pieces,coalesce(x.metres,0) packed_metres,coalesce(x.kg,0) packed_actual_kg,coalesce(x.departed,0) dispatched_actual_kg,
      case when i.quantity_pieces>0 and coalesce(i.manufacturing_weight_kg,i.quantity_kg)>0 then greatest(coalesce(i.manufacturing_weight_kg,i.quantity_kg)-coalesce(i.manufacturing_weight_kg,i.quantity_kg)*coalesce(x.pieces,0)/i.quantity_pieces,0) end remaining_to_pack_order_kg,
      coalesce(b.kg,0) billed_kg,case when finance then greatest(coalesce(x.kg,0)-coalesce(b.kg,0),0) end unbilled_packed_kg
    from public.order_items i left join public.aluminium_profiles p on p.id=i.profile_id and p.company_id=c
    left join private.order_line_requirements(c,p_order_id) q on q.order_item_id=i.id
    left join lateral(select sum(pl.number_of_pieces) pieces,sum(pl.net_length_m) metres,sum(pl.net_weight_kg) kg,sum(pl.net_weight_kg) filter(where d.actual_dispatched_at is not null) departed from public.packing_list_items pl join public.dispatches d on d.id=pl.dispatch_id and d.company_id=c where pl.company_id=c and pl.order_item_id=i.id)x on true
    left join lateral(select sum(ii.quantity) kg from public.invoice_items ii join public.invoices inv on inv.id=ii.invoice_id and inv.company_id=c join public.packing_list_items pl on pl.id=ii.source_line_id and pl.company_id=c where ii.company_id=c and pl.order_item_id=i.id and inv.status not in ('draft','cancelled') and inv.deleted_at is null)b on true
    where i.company_id=c and i.order_id=p_order_id order by i.id limit 10 offset (p_page-1)*10
  )r;
  return jsonb_build_object('order_id',p_order_id,'page',p_page,'total',v_total,'unlinked_packing_rows',v_missing,'items',rows,'basis','Production actual kg, packed measured kg and departed measured kg are separate. Remaining order kg uses whole pieces on the accepted order basis. Returns and credit do not silently replenish order entitlement. Unlinked legacy packing requires reconciliation.');
end $$;
revoke all on function public.order_partial_progress(uuid,int) from public,anon;
grant execute on function public.order_partial_progress(uuid,int) to authenticated;
commit;

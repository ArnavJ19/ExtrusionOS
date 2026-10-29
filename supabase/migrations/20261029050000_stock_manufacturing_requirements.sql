begin;
create table public.order_stock_allocations (
  id uuid primary key,company_id uuid not null references public.companies(id),order_item_id uuid not null references public.order_items(id),
  reservation_id uuid not null unique references public.profile_stock_reservations(id),pieces integer not null check(pieces>0),
  covered_weight_kg numeric(14,3) not null check(covered_weight_kg>0),physical_weight_kg numeric(14,3) not null check(physical_weight_kg>0),
  recorded_by uuid not null references public.app_users(id),recorded_at timestamptz not null default now(),payload jsonb not null
);
create index order_stock_allocation_company_line_idx on public.order_stock_allocations(company_id,order_item_id);
create index order_stock_allocation_actor_idx on public.order_stock_allocations(recorded_by);
alter table public.order_stock_allocations enable row level security;
revoke all on public.order_stock_allocations from public,anon,authenticated;
create trigger keep_order_stock_allocations before update or delete on public.order_stock_allocations for each row execute function private.keep_commercial_history();
create function private.stock_line_quantities(p_company uuid,p_line uuid) returns jsonb
language sql stable security definer set search_path=public,private as $$
  select jsonb_build_object('demand_kg',coalesce(i.manufacturing_weight_kg,i.quantity_kg),
    'stock_covered_kg',coalesce((select sum(a.covered_weight_kg) from public.order_stock_allocations a join public.profile_stock_reservations r on r.id=a.reservation_id and r.company_id=a.company_id where a.company_id=p_company and a.order_item_id=i.id and r.status in ('active','consumed')),0),
    'stock_physical_kg',coalesce((select sum(a.physical_weight_kg) from public.order_stock_allocations a join public.profile_stock_reservations r on r.id=a.reservation_id and r.company_id=a.company_id where a.company_id=p_company and a.order_item_id=i.id and r.status in ('active','consumed')),0),
    'stock_pieces',coalesce((select sum(a.pieces) from public.order_stock_allocations a join public.profile_stock_reservations r on r.id=a.reservation_id and r.company_id=a.company_id where a.company_id=p_company and a.order_item_id=i.id and r.status in ('active','consumed')),0),
    'production_committed_kg',coalesce((select sum(case when j.status='completed' and j.actual_quantity_kg>0 then j.actual_quantity_kg else j.planned_quantity_kg end) from public.production_jobs j where j.company_id=p_company and j.order_id=i.order_id and j.status<>'cancelled' and (j.source_line_id=i.id or (j.source_line_id is null and j.profile_id=i.profile_id))),0))
  from public.order_items i where i.company_id=p_company and i.id=p_line;
$$;
revoke all on function private.stock_line_quantities(uuid,uuid) from public,anon,authenticated;

create function private.guard_stock_production_capacity() returns trigger
language plpgsql security definer set search_path=public,private as $$
declare v_line public.order_items%rowtype;v_covered numeric;v_jobs numeric;v_demand numeric;
begin
  if new.order_id is null or new.status='cancelled' then return new; end if;
  perform 1 from public.orders where id=new.order_id and company_id=new.company_id for update;
  if new.source_line_id is null then
    if exists(select 1 from public.order_stock_allocations a join public.order_items i on i.id=a.order_item_id where a.company_id=new.company_id and i.order_id=new.order_id and i.profile_id=new.profile_id) then raise exception 'Select the exact order line after stock allocation'; end if;
    return new;
  end if;
  select * into v_line from public.order_items where company_id=new.company_id and id=new.source_line_id and order_id=new.order_id for update;
  if not found then return new; end if;
  select coalesce(sum(a.covered_weight_kg),0) into v_covered from public.order_stock_allocations a join public.profile_stock_reservations r on r.id=a.reservation_id and r.company_id=a.company_id
    where a.company_id=new.company_id and a.order_item_id=v_line.id and r.status in ('active','consumed');
  if v_covered=0 then return new; end if;
  select coalesce(sum(case when status='completed' and actual_quantity_kg>0 then actual_quantity_kg else planned_quantity_kg end),0) into v_jobs from public.production_jobs
    where company_id=new.company_id and order_id=new.order_id and id<>new.id and status<>'cancelled' and (source_line_id=v_line.id or (source_line_id is null and profile_id=v_line.profile_id));
  v_demand:=coalesce(v_line.manufacturing_weight_kg,v_line.quantity_kg);
  if v_demand is null or v_covered+v_jobs+coalesce(case when new.status='completed' and new.actual_quantity_kg>0 then new.actual_quantity_kg else new.planned_quantity_kg end,0)>v_demand+0.001 then raise exception 'Stock allocation and production exceed the remaining order-line requirement'; end if;
  return new;
end;
$$;
revoke all on function private.guard_stock_production_capacity() from public,anon,authenticated;
create trigger aa_guard_stock_production_capacity before insert or update on public.production_jobs for each row execute function private.guard_stock_production_capacity();

create function public.stock_production_command(p_command text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,private as $$
declare v_company uuid;v_order public.orders%rowtype;v_line public.order_items%rowtype;v_batch public.profile_stock_batches%rowtype;v_profile public.aluminium_profiles%rowtype;
  v_rows jsonb;v_balance jsonb;v_quantities jsonb;v_source jsonb;v_fingerprint text;v_page integer:=coalesce((p_payload->>'page')::integer,1);
  v_id uuid;v_existing public.order_stock_allocations%rowtype;v_pieces integer;v_physical numeric;v_covered numeric;v_length numeric;v_remaining numeric;v_reservation uuid;v_alloy text;v_temper text;
begin
  v_company:=private.commercial_actor(array['owner','admin','production_manager','factory_manager','inventory_manager']);
  if p_command is null or p_payload is null or jsonb_typeof(p_payload)<>'object' or v_page<1 or v_page>10000 then raise exception 'Invalid stock planning request'; end if;
  if p_command='lines.list' then
    if p_payload-array['order_id','page']<>'{}' then raise exception 'Invalid line request'; end if;
    perform 1 from public.orders where company_id=v_company and id=(p_payload->>'order_id')::uuid and deleted_at is null;
    if not found then raise exception 'Order is unavailable'; end if;
    select coalesce(jsonb_agg(to_jsonb(r)),'[]') into v_rows from(select id,coalesce(item_description,section_code,'Order line') label from public.order_items where company_id=v_company and order_id=(p_payload->>'order_id')::uuid order by id limit 10 offset (v_page-1)*10)r;
    return jsonb_build_object('kind','lines','page',v_page,'items',v_rows);
  end if;
  if p_command not in ('line.plan','stock.allocate') then raise exception 'Invalid planning command'; end if;
  if p_command='stock.allocate' then
    v_id:=(p_payload->>'id')::uuid;perform pg_advisory_xact_lock(hashtextextended(v_company::text||v_id::text,0));
    select * into v_existing from public.order_stock_allocations where id=v_id;
    if found then
      if v_existing.company_id<>v_company or v_existing.payload<>p_payload then raise exception 'Allocation identity was used for different details'; end if;
      return jsonb_build_object('kind','allocated','id',v_id,'replayed',true);
    end if;
  end if;
  select * into v_line from public.order_items where id=(p_payload->>'order_item_id')::uuid and company_id=v_company;
  if not found then raise exception 'Order line is unavailable'; end if;
  select * into v_order from public.orders where id=v_line.order_id and company_id=v_company and deleted_at is null for update;
  if not found or v_order.current_stage in ('cancelled','dispatched','delivered') then raise exception 'Order is unavailable for allocation'; end if;
  select * into v_line from public.order_items where id=v_line.id and company_id=v_company for update;
  select * into v_profile from public.aluminium_profiles where company_id=v_company and id=v_line.profile_id for share;
  v_alloy:=coalesce(nullif(v_line.technical_spec_snapshot->>'alloy',''),v_profile.alloy);v_temper:=coalesce(nullif(v_line.technical_spec_snapshot->>'temper',''),v_profile.temper);
  if v_line.quantity_pieces is null or v_line.quantity_pieces<=0 or v_line.quantity_kg is null or v_line.quantity_kg<=0 or v_line.length_per_piece_m is null
    or v_line.quantity_kg::text in ('NaN','Infinity','-Infinity') or v_line.length_per_piece_m::text in ('NaN','Infinity','-Infinity')
    or coalesce(v_line.manufacturing_weight_kg,v_line.quantity_kg)::text in ('NaN','Infinity','-Infinity') then raise exception 'Line requires recorded pieces, length and weight'; end if;
  if (select count(*) from public.order_items where company_id=v_company and order_id=v_order.id and profile_id=v_line.profile_id and coalesce(finishing_type,'mill_finish')=coalesce(v_line.finishing_type,'mill_finish'))<>1 then raise exception 'Repeated profile and finish lines require a resolved dispatch-line mapping before stock allocation'; end if;
  if exists(select 1 from public.profile_stock_reservations r where r.company_id=v_company and r.order_id=v_order.id and r.profile_id=v_line.profile_id and r.status in ('active','consumed') and not exists(select 1 from public.order_stock_allocations a where a.reservation_id=r.id)) then raise exception 'Reconcile existing unassigned reservations before planning this line'; end if;
  if exists(select 1 from public.production_jobs j where j.company_id=v_company and j.order_id=v_order.id and j.profile_id=v_line.profile_id and j.status<>'cancelled'
    and (case when j.status='completed' then j.actual_quantity_kg else j.planned_quantity_kg end is null
      or (case when j.status='completed' then j.actual_quantity_kg else j.planned_quantity_kg end)::text in ('NaN','Infinity','-Infinity'))) then raise exception 'Reconcile missing production quantities before planning stock'; end if;
  v_quantities:=private.stock_line_quantities(v_company,v_line.id);
  v_remaining:=(v_quantities->>'demand_kg')::numeric-(v_quantities->>'stock_covered_kg')::numeric-(v_quantities->>'production_committed_kg')::numeric;
  if p_command='line.plan' then
    if p_payload-array['order_item_id','page']<>'{}' then raise exception 'Invalid plan request'; end if;
    with candidates as(
      select b.*,private.profile_stock_balance(v_company,b.id) balance,
        case when b.dealer_id is not null then 'Dealer stock requires its dealer workflow'
          when b.status is null or b.status not in ('available','reserved') or b.qc_status is null or b.qc_status not in ('released','not_required') then 'Quality or stock status excludes this batch'
          when abs(coalesce(b.piece_length_m,0)-v_line.length_per_piece_m)>0.001 then 'Stock requires cutting or its individual length is missing'
          when regexp_replace(lower(coalesce(b.alloy,'')),'[^a-z0-9]','','g')='' or regexp_replace(lower(coalesce(b.temper,'')),'[^a-z0-9]','','g')='' or nullif(v_alloy,'') is null or nullif(v_temper,'') is null then 'Alloy or temper provenance is missing'
          when regexp_replace(lower(b.alloy),'[^a-z0-9]','','g')<>regexp_replace(lower(v_alloy),'[^a-z0-9]','','g') or regexp_replace(lower(b.temper),'[^a-z0-9]','','g')<>regexp_replace(lower(v_temper),'[^a-z0-9]','','g') then 'Alloy or temper differs from the order'
          when coalesce(b.finish,'mill_finish')<>coalesce(v_line.finishing_type,'mill_finish') then 'Finish differs from the order' else null end reason
      from public.profile_stock_batches b where b.company_id=v_company and b.profile_id=v_line.profile_id
    )select coalesce(jsonb_agg(to_jsonb(r)),'[]') into v_rows from(
      select id,bundle_number,location,balance->'available' available,coalesce(reason,case when (balance#>>'{available,pieces}')::numeric<=0 or (balance#>>'{available,weight_kg}')::numeric<=0 or (balance#>>'{available,length_m}')::numeric<=0 then 'No unreserved whole-piece balance remains' end) reason,
        md5(to_jsonb(candidates)::text||to_jsonb(v_line)::text||v_quantities::text) fingerprint
      from candidates order by (reason is null) desc,id limit 10 offset (v_page-1)*10
    )r;
    return jsonb_build_object('kind','plan','order_item_id',v_line.id,'page',v_page,'quantities',v_quantities,'remaining_to_plan_kg',greatest(v_remaining,0),
      'manufacture_kg',greatest((v_quantities->>'demand_kg')::numeric-(v_quantities->>'stock_covered_kg')::numeric,0),'demand_kg_per_piece',v_line.quantity_kg/v_line.quantity_pieces,'stock',v_rows);
  end if;
  if p_payload-array['id','order_item_id','batch_id','pieces','fingerprint','page']<>'{}' then raise exception 'Invalid allocation request'; end if;
  v_id:=(p_payload->>'id')::uuid;perform pg_advisory_xact_lock(hashtextextended(v_company::text||v_id::text,0));
  select * into v_existing from public.order_stock_allocations where id=v_id;
  if found then
    if v_existing.company_id<>v_company or v_existing.payload<>p_payload then raise exception 'Allocation identity was used for different details'; end if;
    return jsonb_build_object('kind','allocated','id',v_id,'replayed',true);
  end if;
  -- Rebuild the exact reviewed page before locking the selected batch; its balance is rechecked after the lock below.
  select * into v_batch from public.profile_stock_batches where id=(p_payload->>'batch_id')::uuid and company_id=v_company and profile_id=v_line.profile_id for update;
  if not found then raise exception 'Stock batch is unavailable'; end if;
  v_source:=public.stock_production_command('line.plan',jsonb_build_object('order_item_id',v_line.id,'page',v_page));
  select value into v_balance from jsonb_array_elements(v_source->'stock') where value->>'id'=v_batch.id::text;
  if v_balance is null or v_balance->>'reason' is not null or v_balance->>'fingerprint' is distinct from p_payload->>'fingerprint' then raise exception 'Stock or demand changed. Review the allocation again'; end if;
  v_pieces:=(p_payload->>'pieces')::integer;
  if v_pieces is null or v_pieces<=0 or v_pieces>(v_balance#>>'{available,pieces}')::numeric then raise exception 'Allocation exceeds available whole pieces'; end if;
  v_physical:=round(v_batch.total_weight_kg/v_batch.quantity_pieces*v_pieces,3);v_length:=round(v_batch.length_m/v_batch.quantity_pieces*v_pieces,3);
  v_covered:=round(v_line.quantity_kg/v_line.quantity_pieces*v_pieces,3);
  if v_covered>v_remaining+0.001 or v_physical<=0 or v_length<=0 or v_physical>(v_balance#>>'{available,weight_kg}')::numeric or v_length>(v_balance#>>'{available,length_m}')::numeric then raise exception 'Stock and production would exceed the line requirement or source balance'; end if;
  insert into public.profile_stock_reservations(company_id,profile_stock_batch_id,profile_id,order_id,reserved_weight_kg,reserved_length_m,reserved_pieces,status,created_by)
    values(v_company,v_batch.id,v_line.profile_id,v_order.id,v_physical,v_length,v_pieces,'active',auth.uid()) returning id into v_reservation;
  insert into public.order_stock_allocations(id,company_id,order_item_id,reservation_id,pieces,covered_weight_kg,physical_weight_kg,recorded_by,payload)
    values(v_id,v_company,v_line.id,v_reservation,v_pieces,v_covered,v_physical,auth.uid(),p_payload);
  return jsonb_build_object('kind','allocated','id',v_id,'replayed',false);
end;
$$;
revoke all on function public.stock_production_command(text,jsonb) from public,anon;
grant execute on function public.stock_production_command(text,jsonb) to authenticated;
create function private.keep_consumed_stock_allocation() returns trigger
language plpgsql security definer set search_path=public,private as $$
begin
  if new.status in ('released','cancelled') and exists(select 1 from public.order_stock_allocations where reservation_id=old.id)
    and exists(select 1 from public.packing_list_items where company_id=old.company_id and reservation_id=old.id) then
    raise exception 'Dispatched allocation requires the controlled return or correction workflow';
  end if;
  return new;
end;
$$;
revoke all on function private.keep_consumed_stock_allocation() from public,anon,authenticated;
create trigger keep_consumed_stock_allocation before update on public.profile_stock_reservations for each row execute function private.keep_consumed_stock_allocation();
create function public.order_stock_coverage(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,private as $$
declare v_company uuid;v_items jsonb;v_count integer;
begin
  v_company:=private.commercial_actor(array['owner','admin','sales','sales_manager','production_manager','production','factory_manager','inventory_manager','dispatch_manager','dispatch','accounts','quality','viewer']);
  perform 1 from public.orders where id=p_order_id and company_id=v_company and deleted_at is null;
  if not found then raise exception 'Order is unavailable'; end if;
  select count(distinct a.order_item_id)::integer into v_count from public.order_stock_allocations a join public.order_items i on i.id=a.order_item_id and i.company_id=a.company_id
    join public.profile_stock_reservations r on r.id=a.reservation_id and r.company_id=a.company_id
    where a.company_id=v_company and i.order_id=p_order_id and r.status in ('active','consumed');
  select coalesce(jsonb_agg(to_jsonb(s)),'[]') into v_items from(
    select a.order_item_id,sum(a.covered_weight_kg) covered_weight_kg from public.order_stock_allocations a join public.order_items i on i.id=a.order_item_id and i.company_id=a.company_id
      join public.profile_stock_reservations r on r.id=a.reservation_id and r.company_id=a.company_id
      where a.company_id=v_company and i.order_id=p_order_id and r.status in ('active','consumed') group by a.order_item_id order by a.order_item_id limit 500
  )s;
  return jsonb_build_object('order_id',p_order_id,'complete',v_count<=500,'items',v_items);
end;
$$;
revoke all on function public.order_stock_coverage(uuid) from public,anon;
grant execute on function public.order_stock_coverage(uuid) to authenticated;
alter function private.order_line_requirements(uuid,uuid) rename to order_line_requirements_before_factory_stock;
create function private.order_line_requirements(p_company uuid,p_order uuid)
returns table(
  order_item_id uuid,order_id uuid,order_number text,customer_name text,order_stage text,line_label text,profile_code text,
  ordered_kg numeric,from_stock_kg numeric,produced_kg numeric,planned_open_kg numeric,packed_kg numeric,dispatched_kg numeric,
  line_required_date date,line_priority text,effective_date date,effective_priority text,date_source text,priority_source text,
  version integer,updated_by_name text,updated_at timestamptz,order_closed boolean
) language sql stable security definer set search_path=public,private as $$
  select q.order_item_id,q.order_id,q.order_number,q.customer_name,q.order_stage,q.line_label,q.profile_code,
    q.ordered_kg,q.from_stock_kg+coalesce(s.covered_kg,0),q.produced_kg,q.planned_open_kg,q.packed_kg,q.dispatched_kg,
    q.line_required_date,q.line_priority,q.effective_date,q.effective_priority,q.date_source,q.priority_source,
    q.version,q.updated_by_name,q.updated_at,q.order_closed
  from private.order_line_requirements_before_factory_stock(p_company,p_order) q
  left join lateral(select sum(a.covered_weight_kg) covered_kg from public.order_stock_allocations a
    join public.profile_stock_reservations r on r.id=a.reservation_id and r.company_id=a.company_id
    where a.company_id=p_company and a.order_item_id=q.order_item_id and r.status in ('active','consumed'))s on true;
$$;
revoke all on function private.order_line_requirements(uuid,uuid) from public,anon,authenticated;
commit;

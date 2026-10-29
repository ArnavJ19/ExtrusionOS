-- EOS 94: observations are reusable; only the existing dispatch writer consumes stock.
begin;
create table public.prepared_physical_bundles (
  id uuid primary key,company_id uuid not null references public.companies(id),order_id uuid not null references public.orders(id),
  source_line_id uuid not null,source_kind text not null check(source_kind in ('production','reservation','dealer_stock')),
  profile_id uuid not null references public.aluminium_profiles(id),bundle_number text not null,
  number_of_pieces integer not null check(number_of_pieces>0),net_length_m numeric(15,3) not null check(net_length_m>0),
  gross_weight_kg numeric(15,3) not null,tare_weight_kg numeric(15,3) not null,
  dispatch_id uuid references public.dispatches(id),recorded_by uuid not null references public.app_users(id),
  recorded_at timestamptz not null default now(),payload jsonb not null,
  check(gross_weight_kg>tare_weight_kg and tare_weight_kg>=0)
);
create unique index prepared_bundle_tag_idx on public.prepared_physical_bundles(company_id,upper(bundle_number));
create index prepared_bundle_order_idx on public.prepared_physical_bundles(company_id,order_id,recorded_at,id);
create index prepared_bundle_source_idx on public.prepared_physical_bundles(company_id,source_line_id);
create index prepared_bundle_profile_idx on public.prepared_physical_bundles(profile_id);
create index prepared_bundle_actor_idx on public.prepared_physical_bundles(recorded_by);
create index prepared_bundle_dispatch_idx on public.prepared_physical_bundles(dispatch_id);
alter table public.prepared_physical_bundles enable row level security;
revoke all on public.prepared_physical_bundles from public,anon,authenticated;

create function public.physical_bundle_command(p_command text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,private as $$
declare v_company uuid;v_order uuid:=(p_payload->>'order_id')::uuid;v_id uuid;v_existing public.prepared_physical_bundles%rowtype;
  v_source jsonb;v_rows jsonb;v_page integer:=coalesce((p_payload->>'page')::integer,1);v_gross numeric;v_tare numeric;v_length numeric;v_pieces numeric;
begin
  v_company:=private.commercial_actor(array['owner','admin','factory_manager','dispatch_manager','dispatch','inventory_manager']);
  if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Invalid bundle request'; end if;
  perform 1 from public.orders where id=v_order and company_id=v_company and deleted_at is null and current_stage<>'cancelled' for share;
  if not found then raise exception 'Order is unavailable'; end if;
  if p_command='bundles.list' then
    if p_payload-array['order_id','page','search']<>'{}' or v_page<1 or v_page>10000 or length(coalesce(p_payload->>'search',''))>80 then raise exception 'Invalid bundle search'; end if;
    select coalesce(jsonb_agg(to_jsonb(r)),'[]') into v_rows from (
      select id,bundle_number,source_line_id,number_of_pieces,net_length_m,gross_weight_kg,tare_weight_kg,
        gross_weight_kg-tare_weight_kg as net_weight_kg from public.prepared_physical_bundles
      where company_id=v_company and order_id=v_order and dispatch_id is null
        and position(lower(coalesce(p_payload->>'search','')) in lower(bundle_number))>0
      order by recorded_at,id limit 10 offset (v_page-1)*10
    )r;
    return jsonb_build_object('page',v_page,'items',v_rows);
  end if;
  if p_command<>'bundle.record' or p_payload-array['id','order_id','source_line_id','source_kind','bundle_number','number_of_pieces','net_length_m','gross_weight_kg','tare_weight_kg']<>'{}' then raise exception 'Invalid bundle request'; end if;
  v_id:=(p_payload->>'id')::uuid;
  perform pg_advisory_xact_lock(hashtextextended(v_company::text||v_id::text,0));
  select * into v_existing from public.prepared_physical_bundles where id=v_id;
  if found then
    if v_existing.company_id<>v_company or v_existing.payload<>p_payload then raise exception 'Bundle identity was used for different observations'; end if;
    return jsonb_build_object('id',v_id,'replayed',true);
  end if;
  v_gross:=(p_payload->>'gross_weight_kg')::numeric;v_tare:=(p_payload->>'tare_weight_kg')::numeric;
  v_length:=(p_payload->>'net_length_m')::numeric;v_pieces:=(p_payload->>'number_of_pieces')::numeric;
  if v_gross is null or v_tare is null or v_length is null or v_pieces is null
    or v_gross::text in ('NaN','Infinity','-Infinity') or v_tare::text in ('NaN','Infinity','-Infinity')
    or v_length::text in ('NaN','Infinity','-Infinity') or v_pieces::text in ('NaN','Infinity','-Infinity')
    or v_gross<=v_tare or v_tare<0 or v_gross>1000000 or v_length<=0 or v_length>1000000
    or v_pieces<=0 or v_pieces>1000000 or v_pieces<>trunc(v_pieces)
    or length(trim(coalesce(p_payload->>'bundle_number','')))=0 or length(p_payload->>'bundle_number')>80
    or v_gross<>round(v_gross,3) or v_tare<>round(v_tare,3) or v_length<>round(v_length,3) then raise exception 'Enter valid physical bundle observations'; end if;
  if p_payload->>'source_kind'='production' then
    select to_jsonb(j) into v_source from public.production_jobs j where id=(p_payload->>'source_line_id')::uuid and company_id=v_company and order_id=v_order and status='completed' for share;
  elsif p_payload->>'source_kind'='reservation' then
    select to_jsonb(r) into v_source from public.profile_stock_reservations r where id=(p_payload->>'source_line_id')::uuid and company_id=v_company and order_id=v_order and status='active' for share;
  elsif p_payload->>'source_kind'='dealer_stock' then
    select to_jsonb(f) into v_source from public.order_dealer_stock_fulfillments f where id=(p_payload->>'source_line_id')::uuid and company_id=v_company and order_id=v_order and credited_at is null for share;
  end if;
  if v_source is null or nullif(v_source->>'profile_id','') is null then raise exception 'Bundle source is unavailable'; end if;
  if exists(select 1 from public.packing_list_items where company_id=v_company and upper(bundle_number)=upper(trim(p_payload->>'bundle_number'))) then raise exception 'Bundle tag already appears in dispatch history'; end if;
  insert into public.prepared_physical_bundles(id,company_id,order_id,source_line_id,source_kind,profile_id,bundle_number,number_of_pieces,net_length_m,gross_weight_kg,tare_weight_kg,recorded_by,payload)
    values(v_id,v_company,v_order,(p_payload->>'source_line_id')::uuid,p_payload->>'source_kind',(v_source->>'profile_id')::uuid,trim(p_payload->>'bundle_number'),v_pieces::integer,v_length,v_gross,v_tare,auth.uid(),p_payload);
  return jsonb_build_object('id',v_id,'replayed',false);
end;
$$;
revoke all on function public.physical_bundle_command(text,jsonb) from public,anon;
grant execute on function public.physical_bundle_command(text,jsonb) to authenticated;

create function private.consume_prepared_physical_bundle() returns trigger
language plpgsql security definer set search_path=public,private as $$
declare v_bundle public.prepared_physical_bundles%rowtype;v_order uuid;
begin
  select * into v_bundle from public.prepared_physical_bundles where company_id=new.company_id and upper(bundle_number)=upper(new.bundle_number) for update;
  if not found then return new; end if;
  select order_id into v_order from public.dispatches where id=new.dispatch_id and company_id=new.company_id;
  if v_bundle.dispatch_id is not null or v_order is distinct from v_bundle.order_id
    or new.source_line_id is distinct from v_bundle.source_line_id or new.profile_id is distinct from v_bundle.profile_id
    or new.source_kind is distinct from v_bundle.source_kind or new.number_of_pieces is distinct from v_bundle.number_of_pieces
    or new.net_length_m is distinct from v_bundle.net_length_m or new.gross_weight_kg is distinct from v_bundle.gross_weight_kg
    or new.tare_weight_kg is distinct from v_bundle.tare_weight_kg then raise exception 'Prepared bundle was already dispatched or its observations changed'; end if;
  update public.prepared_physical_bundles set dispatch_id=new.dispatch_id where id=v_bundle.id;
  return new;
end;
$$;
revoke all on function private.consume_prepared_physical_bundle() from public,anon,authenticated;
create trigger consume_prepared_physical_bundle after insert on public.packing_list_items for each row execute function private.consume_prepared_physical_bundle();
commit;

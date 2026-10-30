-- EOS 30 / 37: reviewed vehicle loads reference measured bundles without consuming inventory.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.factory_vehicles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  registration_number text not null check (length(btrim(registration_number)) between 1 and 30),
  vehicle_label text not null check (length(btrim(vehicle_label)) between 1 and 80),
  capacity_kg numeric(14,3) not null check (capacity_kg > 0 and capacity_kg <= 1000000),
  is_active boolean not null default true,
  version integer not null default 1 check (version > 0),
  created_by uuid not null references public.app_users(id),
  updated_at timestamptz not null default now()
);
create unique index factory_vehicles_company_registration_idx on public.factory_vehicles(company_id,lower(registration_number));
create index factory_vehicles_company_active_idx on public.factory_vehicles(company_id,is_active,registration_number);
alter table public.factory_vehicles enable row level security;
revoke all on public.factory_vehicles from public,anon,authenticated;

create table public.factory_vehicle_loads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  vehicle_id uuid not null references public.factory_vehicles(id) on delete restrict,
  load_date date not null,
  status text not null default 'reviewed' check (status in ('reviewed','closed','cancelled')),
  capacity_kg numeric(14,3) not null check (capacity_kg > 0),
  version integer not null default 1 check (version > 0),
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index factory_vehicle_loads_company_status_date_idx on public.factory_vehicle_loads(company_id,status,load_date desc,id);
create index factory_vehicle_loads_company_vehicle_idx on public.factory_vehicle_loads(company_id,vehicle_id,load_date);
alter table public.factory_vehicle_loads enable row level security;
revoke all on public.factory_vehicle_loads from public,anon,authenticated;

create table public.factory_vehicle_load_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  load_id uuid not null references public.factory_vehicle_loads(id) on delete restrict,
  bundle_id uuid not null references public.prepared_physical_bundles(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  source_line_id uuid not null,
  source_kind text not null check (source_kind in ('production','reservation','dealer_stock')),
  profile_id uuid not null references public.aluminium_profiles(id) on delete restrict,
  net_weight_kg numeric(14,3) not null check (net_weight_kg > 0),
  number_of_pieces integer not null check (number_of_pieces > 0),
  net_length_m numeric(14,3) not null check (net_length_m > 0),
  status text not null default 'active' check (status in ('active','removed')),
  source_fingerprint text not null check (source_fingerprint ~ '^[a-f0-9]{32}$'),
  snapshot jsonb not null,
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id,load_id,bundle_id)
);
create unique index factory_vehicle_load_active_bundle_idx on public.factory_vehicle_load_items(company_id,bundle_id) where status='active';
create index factory_vehicle_load_items_company_load_idx on public.factory_vehicle_load_items(company_id,load_id,status,bundle_id);
create index factory_vehicle_load_items_company_order_idx on public.factory_vehicle_load_items(company_id,order_id,load_id) where status='active';
alter table public.factory_vehicle_load_items enable row level security;
revoke all on public.factory_vehicle_load_items from public,anon,authenticated;

create table public.factory_vehicle_load_requests (
  company_id uuid not null references public.companies(id) on delete cascade,
  request_id uuid not null,
  payload_hash text not null,
  load_id uuid not null references public.factory_vehicle_loads(id) on delete restrict,
  version integer not null,
  recorded_at timestamptz not null default now(),
  primary key(company_id,request_id)
);
alter table public.factory_vehicle_load_requests enable row level security;
revoke all on public.factory_vehicle_load_requests from public,anon,authenticated;

create or replace function private.factory_vehicle_actor(p_roles text[])
returns uuid language plpgsql stable security definer set search_path=public,private as $$
declare v_company uuid:=private.get_current_user_company_id();v_role text:=private.get_current_user_role();
begin
  if auth.uid() is null or v_company is null or private.get_current_user_dealer_id() is not null
    or not exists(select 1 from public.app_users u where u.id=auth.uid() and u.company_id=v_company and u.role::text=v_role and u.is_active and u.dealer_id is null)
    or not (v_role=any(p_roles)) then raise exception 'This action is not permitted for your role' using errcode='42501'; end if;
  return v_company;
end;
$$;
revoke all on function private.factory_vehicle_actor(text[]) from public,anon,authenticated;

create or replace function private.factory_vehicle_fingerprint(p_vehicle public.factory_vehicles)
returns text language sql immutable set search_path=pg_catalog as $$
  select md5(jsonb_build_array((p_vehicle).id,(p_vehicle).registration_number,(p_vehicle).vehicle_label,(p_vehicle).capacity_kg,(p_vehicle).is_active,(p_vehicle).version)::text)
$$;
revoke all on function private.factory_vehicle_fingerprint(public.factory_vehicles) from public,anon,authenticated;

create or replace function private.factory_bundle_source_lock(p_company uuid,p_source_kind text,p_source_line uuid)
returns void language sql volatile security definer set search_path=public,private as $$
  select pg_advisory_xact_lock(hashtextextended('factory-bundle-source:'||p_company::text||':'||p_source_kind||':'||p_source_line::text,0))
$$;
revoke all on function private.factory_bundle_source_lock(uuid,text,uuid) from public,anon,authenticated;

create or replace function private.factory_bundle_load_candidate(p_company uuid,p_bundle_id uuid,p_current_load uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare
  v_bundle public.prepared_physical_bundles%rowtype;v_order public.orders%rowtype;v_customer public.customers%rowtype;v_party jsonb;v_party_context jsonb;
  v_source_capacity numeric;v_packed numeric;v_prepared numeric;v_quote_id uuid;v_quote_revision integer;v_payload jsonb;v_assigned uuid;
begin
  select * into v_bundle from public.prepared_physical_bundles b where b.id=p_bundle_id and b.company_id=p_company;
  if not found or v_bundle.dispatch_id is not null then return null; end if;
  select * into v_order from public.orders o where o.id=v_bundle.order_id and o.company_id=p_company and o.deleted_at is null
    and o.current_stage not in ('cancelled','closed','delivered','dispatched');
  if not found then return null; end if;
  select load_id into v_assigned from public.factory_vehicle_load_items i where i.company_id=p_company and i.bundle_id=v_bundle.id and i.status='active';
  if v_assigned is not null and v_assigned is distinct from p_current_load then return null; end if;
  if v_bundle.source_kind='production' then
    select j.actual_quantity_kg into v_source_capacity from public.production_jobs j
      where j.id=v_bundle.source_line_id and j.company_id=p_company and j.order_id=v_bundle.order_id and j.profile_id=v_bundle.profile_id and j.status='completed';
  elsif v_bundle.source_kind='reservation' then
    select r.reserved_weight_kg into v_source_capacity from public.profile_stock_reservations r
      where r.id=v_bundle.source_line_id and r.company_id=p_company and r.order_id=v_bundle.order_id and r.profile_id=v_bundle.profile_id and r.status='active';
  elsif v_bundle.source_kind='dealer_stock' then
    select f.fulfilled_weight_kg into v_source_capacity from public.order_dealer_stock_fulfillments f
      where f.id=v_bundle.source_line_id and f.company_id=p_company and f.order_id=v_bundle.order_id and f.profile_id=v_bundle.profile_id and f.credited_at is null;
  end if;
  if v_source_capacity is null or v_source_capacity<=0 then return null; end if;
  select coalesce(sum(p.net_weight_kg),0) into v_packed from public.packing_list_items p
    join public.dispatches d on d.id=p.dispatch_id and d.company_id=p_company and d.order_id=v_bundle.order_id
    where p.company_id=p_company and p.source_line_id=v_bundle.source_line_id and p.source_kind=v_bundle.source_kind and d.delivery_status<>'returned';
  select coalesce(sum(b.gross_weight_kg-b.tare_weight_kg),0) into v_prepared from public.prepared_physical_bundles b
    where b.company_id=p_company and b.order_id=v_bundle.order_id and b.source_line_id=v_bundle.source_line_id and b.source_kind=v_bundle.source_kind and b.dispatch_id is null;
  if v_packed+v_prepared>v_source_capacity+0.01 then return null; end if;
  begin
    v_party_context:=private.downstream_order_party(p_company,v_order.id);
    v_party:=v_party_context->'party';
  exception when others then return null;
  end;
  if v_party is null then
    select * into v_customer from public.customers c where c.id=v_order.customer_id and c.company_id=p_company;
    if not found then return null; end if;
    v_party:=jsonb_build_object('customer_name',coalesce(nullif(v_customer.company_name,''),v_customer.customer_name),
      'delivery_address',coalesce(nullif(v_customer.shipping_address,''),v_customer.billing_address));
  end if;
  select s.quote_id,s.revision_number into v_quote_id,v_quote_revision from public.order_quote_snapshots s where s.company_id=p_company and s.order_id=v_order.id;
  v_payload:=jsonb_build_object('id',v_bundle.id,'bundle_number',v_bundle.bundle_number,'order_id',v_order.id,'order_number',v_order.order_number,
    'customer_id',v_order.customer_id,'customer_name',v_party->>'customer_name','destination',v_party->>'delivery_address','party_basis',coalesce(v_party_context->>'basis','Current customer master'),
    'source_line_id',v_bundle.source_line_id,'source_kind',v_bundle.source_kind,'profile_id',v_bundle.profile_id,
    'net_weight_kg',v_bundle.gross_weight_kg-v_bundle.tare_weight_kg,'number_of_pieces',v_bundle.number_of_pieces,'net_length_m',v_bundle.net_length_m,
    'source_document_quote_id',v_quote_id,'source_document_revision',v_quote_revision);
  return v_payload||jsonb_build_object('fingerprint',md5((v_payload||jsonb_build_object('recorded_payload',v_bundle.payload,'party_basis',coalesce(v_party_context->>'basis','Current customer master')))::text));
end;
$$;
revoke all on function private.factory_bundle_load_candidate(uuid,uuid,uuid) from public,anon,authenticated;

create or replace function private.factory_vehicle_load_result(p_company uuid,p_load uuid)
returns jsonb language sql stable security definer set search_path=public,private as $$
  select jsonb_build_object('id',l.id,'vehicle_id',l.vehicle_id,'registration_number',v.registration_number,'vehicle_label',v.vehicle_label,
    'load_date',l.load_date,'status',l.status,'capacity_kg',l.capacity_kg,'total_weight_kg',coalesce(items.total_weight_kg,0),
    'item_count',coalesce(items.item_count,0),'version',l.version,'items',coalesce(items.rows,'[]'::jsonb))
  from public.factory_vehicle_loads l join public.factory_vehicles v on v.id=l.vehicle_id and v.company_id=l.company_id
  left join lateral (
    select sum(i.net_weight_kg) total_weight_kg,count(*) item_count,
      jsonb_agg(i.snapshot||jsonb_build_object('status',i.status,'updated_fingerprint',private.factory_bundle_load_candidate(p_company,i.bundle_id,p_load)->>'fingerprint') order by i.created_at,i.id)
        filter(where i.status in ('active','removed')) rows
    from public.factory_vehicle_load_items i where i.company_id=p_company and i.load_id=p_load
      and i.status='active'
  ) items on true
  where l.company_id=p_company and l.id=p_load
$$;
revoke all on function private.factory_vehicle_load_result(uuid,uuid) from public,anon,authenticated;

create or replace function public.save_factory_vehicle(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_company uuid;v_reg text;v_label text;v_capacity numeric;v_row public.factory_vehicles%rowtype;
begin
  v_company:=private.factory_vehicle_actor(array['owner','admin','factory_manager','dispatch_manager']);
  if jsonb_typeof(p_payload) is distinct from 'object' or p_payload-array['registration_number','vehicle_label','capacity_kg']<>'{}' then raise exception 'Invalid vehicle configuration'; end if;
  v_reg:=upper(btrim(coalesce(p_payload->>'registration_number','')));v_label:=btrim(coalesce(p_payload->>'vehicle_label',''));
  if v_reg !~ '^[A-Z0-9 -]{1,30}$' or length(v_label) not between 1 and 80 or v_label~'[[:cntrl:]]'
    or p_payload->>'capacity_kg' !~ '^([0-9]{1,7})(\.[0-9]{1,3})?$' then raise exception 'Enter a vehicle registration, label and positive kg capacity'; end if;
  v_capacity:=(p_payload->>'capacity_kg')::numeric;
  if v_capacity<=0 or v_capacity>1000000 then raise exception 'Vehicle capacity must be between 0 and 1,000,000 kg'; end if;
  insert into public.factory_vehicles(company_id,registration_number,vehicle_label,capacity_kg,created_by)
    values(v_company,v_reg,v_label,v_capacity,auth.uid())
    on conflict(company_id,lower(registration_number)) do update set vehicle_label=excluded.vehicle_label,capacity_kg=excluded.capacity_kg,version=factory_vehicles.version+1,updated_at=now()
    returning * into v_row;
  if exists(
    select 1 from public.factory_vehicle_loads l
    left join lateral (select coalesce(sum(i.net_weight_kg),0) weight_kg from public.factory_vehicle_load_items i
      where i.company_id=l.company_id and i.load_id=l.id and i.status='active') items on true
    where l.company_id=v_company and l.vehicle_id=v_row.id and l.status='reviewed' and items.weight_kg>v_capacity+0.001
  ) then raise exception 'Vehicle capacity cannot be lowered below an active reviewed load weight' using errcode='23514'; end if;
  return jsonb_build_object('id',v_row.id,'registration_number',v_row.registration_number,'vehicle_label',v_row.vehicle_label,'capacity_kg',v_row.capacity_kg,
    'version',v_row.version,'fingerprint',private.factory_vehicle_fingerprint(v_row));
end;
$$;
revoke all on function public.save_factory_vehicle(jsonb) from public,anon;
grant execute on function public.save_factory_vehicle(jsonb) to authenticated;

create or replace function public.factory_vehicle_load_snapshot(p_load_id uuid,p_page integer default 1,p_search text default '')
returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare v_company uuid;v_load public.factory_vehicle_loads%rowtype;v_vehicles jsonb;v_bundles jsonb;v_loads jsonb;v_current jsonb;v_total bigint;v_load_total bigint;v_query text:=lower(btrim(coalesce(p_search,'')));
begin
  v_company:=private.factory_vehicle_actor(array['owner','admin','factory_manager','dispatch_manager','dispatch']);
  if p_page is null or p_page<1 or p_page>10000 or length(v_query)>80 then raise exception 'Invalid vehicle-load page or search'; end if;
  if p_load_id is not null then
    select * into v_load from public.factory_vehicle_loads l where l.id=p_load_id and l.company_id=v_company;
    if not found then raise exception 'Vehicle load is unavailable'; end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'registration_number',v.registration_number,'vehicle_label',v.vehicle_label,'capacity_kg',v.capacity_kg,
    'version',v.version,'fingerprint',private.factory_vehicle_fingerprint(v)) order by v.registration_number,v.id),'[]') into v_vehicles
    from public.factory_vehicles v where v.company_id=v_company and v.is_active;
  with candidates as (
    select private.factory_bundle_load_candidate(v_company,b.id,p_load_id) candidate_json
    from public.prepared_physical_bundles b
    where b.company_id=v_company and b.dispatch_id is null
  ), available as (
    select candidate_json from candidates where candidate_json is not null and (v_query='' or position(v_query in lower(coalesce(candidate_json->>'bundle_number','')||' '||coalesce(candidate_json->>'order_number','')||' '||coalesce(candidate_json->>'customer_name','')||' '||coalesce(candidate_json->>'destination','')))>0)
  ) select count(*),coalesce((select jsonb_agg(r.candidate_json order by r.candidate_json->>'order_number',r.candidate_json->>'bundle_number') from (select candidate_json from available order by candidate_json->>'order_number',candidate_json->>'bundle_number' limit 10 offset (p_page-1)*10) r),'[]') into v_total,v_bundles from available;
  select count(*) into v_load_total from public.factory_vehicle_loads l where l.company_id=v_company and l.status<>'cancelled';
  select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'vehicle_id',q.vehicle_id,'registration_number',q.registration_number,'vehicle_label',q.vehicle_label,
    'load_date',q.load_date,'status',q.status,'capacity_kg',q.capacity_kg,'total_weight_kg',q.total_weight_kg,'item_count',q.item_count,'version',q.version)
    order by q.load_date desc,q.id desc),'[]') into v_loads
  from (select l.id,l.vehicle_id,v.registration_number,v.vehicle_label,l.load_date,l.status,l.capacity_kg,l.version,
      coalesce(sum(i.net_weight_kg) filter(where i.status='active'),0) total_weight_kg,count(i.id) filter(where i.status='active') item_count
    from public.factory_vehicle_loads l join public.factory_vehicles v on v.id=l.vehicle_id and v.company_id=l.company_id
      left join public.factory_vehicle_load_items i on i.company_id=l.company_id and i.load_id=l.id
    where l.company_id=v_company and l.status<>'cancelled'
    group by l.id,v.id order by l.load_date desc,l.id desc limit 10 offset (p_page-1)*10) q;
  if p_load_id is not null then v_current:=private.factory_vehicle_load_result(v_company,p_load_id); end if;
  return jsonb_build_object('company_id',v_company,'page',p_page,'page_size',10,'total_bundle_count',v_total,'search',v_query,'vehicles',v_vehicles,'bundles',v_bundles,
    'loads',v_loads,'load_total_count',v_load_total,'current_load',v_current);
end;
$$;
revoke all on function public.factory_vehicle_load_snapshot(uuid,integer,text) from public,anon;
grant execute on function public.factory_vehicle_load_snapshot(uuid,integer,text) to authenticated;

create or replace function public.save_factory_vehicle_load(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare
  v_company uuid;v_request uuid;v_load uuid;v_vehicle uuid;v_date date;v_expected integer;v_fingerprint text;v_hash text;v_vehicle_row public.factory_vehicles%rowtype;
  v_load_row public.factory_vehicle_loads%rowtype;v_bundles jsonb;v_ids uuid[];v_row record;v_data jsonb;v_total numeric:=0;v_count integer:=0;v_result jsonb;
begin
  v_company:=private.factory_vehicle_actor(array['owner','admin','factory_manager','dispatch_manager','dispatch']);
  if jsonb_typeof(p_payload) is distinct from 'object'
    or p_payload-array['request_id','load_id','expected_version','vehicle_id','vehicle_fingerprint','load_date','bundles']<>'{}'
    or jsonb_typeof(p_payload->'bundles') is distinct from 'array' then raise exception 'Invalid vehicle-load review request'; end if;
  v_request:=(p_payload->>'request_id')::uuid;v_load:=nullif(p_payload->>'load_id','')::uuid;v_expected:=(p_payload->>'expected_version')::integer;
  v_vehicle:=(p_payload->>'vehicle_id')::uuid;v_date:=(p_payload->>'load_date')::date;v_fingerprint:=p_payload->>'vehicle_fingerprint';v_bundles:=p_payload->'bundles';v_hash:=md5(p_payload::text);
  if v_request is null or v_expected is null or v_expected<0 or (v_load is null and v_expected<>0) or v_vehicle is null or v_date is null
    or v_date<(now() at time zone 'Asia/Kolkata')::date or v_date>(now() at time zone 'Asia/Kolkata')::date+365 or length(coalesce(v_fingerprint,''))<>32
    or jsonb_array_length(v_bundles)>500 or (v_load is null and jsonb_array_length(v_bundles)=0) then raise exception 'Enter a valid vehicle-load review'; end if;
  if exists(select 1 from jsonb_array_elements(v_bundles) x where jsonb_typeof(x) is distinct from 'object' or x-array['id','fingerprint']<>'{}'
      or coalesce(x->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(x->>'fingerprint','') !~ '^[a-f0-9]{32}$') then raise exception 'Invalid measured bundle review data'; end if;
  select array_agg((x->>'id')::uuid order by (x->>'id')::uuid) into v_ids from jsonb_array_elements(v_bundles) x;
  if cardinality(v_ids)<>coalesce((select count(distinct id) from unnest(v_ids) id),0) then raise exception 'A measured bundle cannot appear more than once in this vehicle load'; end if;
  perform pg_advisory_xact_lock(hashtextextended('factory-load-request:'||v_company::text||':'||v_request::text,0));
  select * into v_row from public.factory_vehicle_load_requests r where r.company_id=v_company and r.request_id=v_request;
  if found then
    if v_row.payload_hash<>v_hash then raise exception 'Request identity was already used for different vehicle-load details'; end if;
    return jsonb_build_object('load',private.factory_vehicle_load_result(v_company,v_row.load_id),'replayed',true);
  end if;
  if v_load is not null then
    select * into v_load_row from public.factory_vehicle_loads l where l.id=v_load and l.company_id=v_company for update;
    if not found or v_load_row.status<>'reviewed' then raise exception 'Only a reviewed vehicle load can be edited'; end if;
    if v_expected<>v_load_row.version then raise exception 'This vehicle load changed while you reviewed it. Refresh and try again' using errcode='40001'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('factory-vehicle:'||v_company::text||':'||v_vehicle::text,0));
  select * into v_vehicle_row from public.factory_vehicles v where v.id=v_vehicle and v.company_id=v_company and v.is_active for update;
  if not found then raise exception 'Select an active vehicle from this company'; end if;
  if private.factory_vehicle_fingerprint(v_vehicle_row)<>v_fingerprint then raise exception 'Vehicle capacity changed while you reviewed the load. Refresh and try again' using errcode='40001'; end if;
  -- Take source locks first, matching the dispatch writer's lock order, then lock the measured bundle rows.
  for v_row in select distinct b.source_kind,b.source_line_id from public.prepared_physical_bundles b
    where b.company_id=v_company and b.id=any(coalesce(v_ids,'{}'::uuid[])) order by b.source_kind,b.source_line_id loop
    perform private.factory_bundle_source_lock(v_company,v_row.source_kind,v_row.source_line_id);
  end loop;
  perform 1 from public.prepared_physical_bundles b where b.company_id=v_company and b.id=any(coalesce(v_ids,'{}'::uuid[])) order by b.id for update;
  for v_row in select x->>'id' id,x->>'fingerprint' fingerprint from jsonb_array_elements(v_bundles) x loop
    v_data:=private.factory_bundle_load_candidate(v_company,v_row.id::uuid,v_load);
    if v_data is null or v_data->>'fingerprint'<>v_row.fingerprint then raise exception 'Bundle eligibility or order destination changed while you reviewed the load. Refresh and review it again' using errcode='40001'; end if;
    v_total:=v_total+(v_data->>'net_weight_kg')::numeric;v_count:=v_count+1;
  end loop;
  if v_load is null then
    insert into public.factory_vehicle_loads(company_id,vehicle_id,load_date,status,capacity_kg,created_by)
      values(v_company,v_vehicle,v_date,'reviewed',v_vehicle_row.capacity_kg,auth.uid()) returning * into v_load_row;
  else
    update public.factory_vehicle_loads set vehicle_id=v_vehicle,load_date=v_date,capacity_kg=v_vehicle_row.capacity_kg,version=version+1,updated_at=now()
      where id=v_load and company_id=v_company returning * into v_load_row;
  end if;
  if v_total>v_vehicle_row.capacity_kg+0.001 then raise exception 'Selected bundles total % kg, above this vehicle capacity of % kg',round(v_total,3),v_vehicle_row.capacity_kg using errcode='23514'; end if;
  update public.factory_vehicle_load_items set status='removed',updated_at=now()
    where company_id=v_company and load_id=v_load_row.id and status='active' and not (bundle_id=any(coalesce(v_ids,'{}'::uuid[])));
  for v_row in select x->>'id' id,x->>'fingerprint' fingerprint from jsonb_array_elements(v_bundles) x loop
    v_data:=private.factory_bundle_load_candidate(v_company,v_row.id::uuid,v_load_row.id);
    insert into public.factory_vehicle_load_items(company_id,load_id,bundle_id,order_id,source_line_id,source_kind,profile_id,net_weight_kg,number_of_pieces,net_length_m,
      status,source_fingerprint,snapshot,created_by)
    values(v_company,v_load_row.id,(v_data->>'id')::uuid,(v_data->>'order_id')::uuid,(v_data->>'source_line_id')::uuid,v_data->>'source_kind',(v_data->>'profile_id')::uuid,
      (v_data->>'net_weight_kg')::numeric,(v_data->>'number_of_pieces')::integer,(v_data->>'net_length_m')::numeric,'active',v_data->>'fingerprint',v_data,auth.uid())
    on conflict(company_id,load_id,bundle_id) do update set order_id=excluded.order_id,source_line_id=excluded.source_line_id,source_kind=excluded.source_kind,
      profile_id=excluded.profile_id,net_weight_kg=excluded.net_weight_kg,number_of_pieces=excluded.number_of_pieces,net_length_m=excluded.net_length_m,
      status='active',source_fingerprint=excluded.source_fingerprint,snapshot=excluded.snapshot,updated_at=now();
  end loop;
  insert into public.factory_vehicle_load_requests(company_id,request_id,payload_hash,load_id,version) values(v_company,v_request,v_hash,v_load_row.id,v_load_row.version);
  v_result:=private.factory_vehicle_load_result(v_company,v_load_row.id);
  return jsonb_build_object('load',v_result,'replayed',false);
end;
$$;
revoke all on function public.save_factory_vehicle_load(jsonb) from public,anon;
grant execute on function public.save_factory_vehicle_load(jsonb) to authenticated;

create or replace function private.guard_factory_vehicle_dispatch_source()
returns trigger language plpgsql security definer set search_path=public,private as $$
declare v_bundle public.prepared_physical_bundles%rowtype;
begin
  select * into v_bundle from public.prepared_physical_bundles b where b.company_id=new.company_id and upper(b.bundle_number)=upper(new.bundle_number);
  if not found then return new; end if;
  perform private.factory_bundle_source_lock(v_bundle.company_id,v_bundle.source_kind,v_bundle.source_line_id);
  select * into v_bundle from public.prepared_physical_bundles b where b.id=v_bundle.id and b.company_id=new.company_id for update;
  if exists(select 1 from public.factory_vehicle_load_items i where i.company_id=new.company_id and i.bundle_id=v_bundle.id and i.status='active') then
    raise exception 'Remove this measured bundle from its reviewed vehicle load before dispatch' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_factory_vehicle_dispatch_source() from public,anon,authenticated;
drop trigger if exists guard_factory_vehicle_dispatch_source on public.packing_list_items;
create trigger guard_factory_vehicle_dispatch_source before insert on public.packing_list_items for each row execute function private.guard_factory_vehicle_dispatch_source();

create or replace function public.factory_delivery_proposal_data(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare v_company uuid;v_order public.orders%rowtype;v_lines jsonb;v_jobs jsonb;v_slots jsonb;v_shifts jsonb;v_blocks jsonb;v_leads jsonb;v_stock numeric;v_count integer;v_load_dates jsonb;v_unlinked_kg numeric;
begin
  v_company:=private.factory_vehicle_actor(array['owner','admin','sales_manager','sales','production_manager','production','factory_manager','dispatch_manager','dispatch']);
  select * into v_order from public.orders o where o.id=p_order_id and o.company_id=v_company and o.deleted_at is null
    and o.current_stage not in ('cancelled','closed','delivered','dispatched');
  if not found then raise exception 'Order is unavailable for a delivery proposal'; end if;
  with line_rows as (
    select q.*,private.stock_line_quantities(v_company,q.order_item_id) quantities
    from private.order_line_requirements(v_company,p_order_id) q
  ) select coalesce(jsonb_agg(jsonb_build_object('order_item_id',q.order_item_id,'order_id',q.order_id,'order_number',q.order_number,'customer_name',q.customer_name,
      'order_stage',q.order_stage,'line_label',q.line_label,'profile_code',q.profile_code,
      'ordered_kg',coalesce((q.quantities->>'demand_kg')::numeric,q.ordered_kg),'from_stock_kg',q.from_stock_kg,
      'produced_kg',q.produced_kg,'planned_open_kg',q.planned_open_kg,'packed_kg',q.packed_kg,'dispatched_kg',q.dispatched_kg,
      'line_required_date',q.line_required_date,'effective_date',q.effective_date,'effective_priority',q.effective_priority,'order_closed',q.order_closed)
      order by q.order_item_id),'[]') into v_lines from line_rows q;
  select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'job_number',j.job_number,'source_line_id',j.source_line_id,'status',j.status,
      'planned_quantity_kg',j.planned_quantity_kg,'actual_quantity_kg',j.actual_quantity_kg,'machine_id',j.machine_id,'finishing_type',coalesce(j.finishing_type,'mill_finish'))
      order by j.id),'[]') into v_jobs from public.production_jobs j where j.company_id=v_company and j.order_id=p_order_id and j.status in ('planned','ready','in_progress','on_hold');
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'production_job_id',s.production_job_id,'machine_id',s.machine_id,'planned_start_at',s.planned_start_at,
      'planned_end_at',s.planned_end_at,'shift',s.shift,'sequence_number',s.sequence_number,'capacity_kg',s.capacity_kg,'status',s.status)
      order by s.planned_start_at,s.machine_id,s.id),'[]') into v_slots from public.production_plan_slots s
    where s.company_id=v_company and s.status<>'cancelled' and s.planned_start_at<((now() at time zone 'Asia/Kolkata')::date+91)::timestamp at time zone 'Asia/Kolkata'
      and coalesce(s.planned_end_at,s.planned_start_at)>(now() at time zone 'Asia/Kolkata')::date::timestamp at time zone 'Asia/Kolkata';
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'machine_id',c.machine_id,'weekday',c.weekday,'shift_name',c.shift_name,'starts_local',c.starts_local,'ends_local',c.ends_local,'capacity_kg',c.capacity_kg) order by c.machine_id,c.weekday,c.starts_local),'[]') into v_shifts
    from public.factory_shift_capacities c join public.machines m on m.id=c.machine_id and m.company_id=c.company_id
    where c.company_id=v_company and m.is_active and m.machine_type='extrusion_press' and m.status in ('active','operational','idle');
  select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'machine_id',b.machine_id,'starts_at',b.starts_at,'ends_at',b.ends_at,'reason',b.reason,'status',b.status) order by b.starts_at),'[]') into v_blocks
    from public.factory_maintenance_blocks b where b.company_id=v_company and b.status='planned'
      and b.starts_at<((now() at time zone 'Asia/Kolkata')::date+91)::timestamp at time zone 'Asia/Kolkata'
      and b.ends_at>(now() at time zone 'Asia/Kolkata')::date::timestamp at time zone 'Asia/Kolkata';
  select coalesce(jsonb_agg(jsonb_build_object('finishing_type',l.finishing_type,'lead_days',l.lead_days) order by l.finishing_type),'[]') into v_leads
    from public.factory_finishing_lead_times l where l.company_id=v_company;
  with candidate as (
    select b.id,private.factory_bundle_load_candidate(v_company,b.id,i.load_id) candidate_json,l.load_date
    from public.prepared_physical_bundles b left join public.factory_vehicle_load_items i on i.company_id=b.company_id and i.bundle_id=b.id and i.status='active'
      left join public.factory_vehicle_loads l on l.id=i.load_id and l.company_id=i.company_id and l.status='reviewed'
    where b.company_id=v_company and b.order_id=p_order_id and b.dispatch_id is null
  ) select coalesce(sum((candidate_json->>'net_weight_kg')::numeric),0),count(*),coalesce(jsonb_agg(distinct load_date) filter(where load_date is not null),'[]')
    into v_stock,v_count,v_load_dates from candidate where candidate_json is not null;
  select coalesce(sum(p.net_weight_kg),0) into v_unlinked_kg from public.packing_list_items p
    join public.dispatches d on d.id=p.dispatch_id and d.company_id=p.company_id
    where p.company_id=v_company and d.order_id=p_order_id and p.order_item_id is null and d.delivery_status<>'returned';
  return jsonb_build_object('company_id',v_company,'today',(now() at time zone 'Asia/Kolkata')::date,
    'order',jsonb_build_object('id',v_order.id,'order_number',v_order.order_number,'current_stage',v_order.current_stage,'expected_dispatch_date',v_order.expected_dispatch_date,
      'billets_short',v_order.billets_short,'billet_allocation_status',v_order.billet_allocation_status),
    'lines',v_lines,'jobs',v_jobs,'slots',v_slots,'shift_capacities',v_shifts,'maintenance_blocks',v_blocks,'finishing_lead_times',v_leads,
    'eligible_stock_kg',coalesce(v_stock,0),'eligible_bundle_count',coalesce(v_count,0),'unlinked_packed_kg',coalesce(v_unlinked_kg,0),'active_load_dates',coalesce(v_load_dates,'[]'));
end;
$$;
revoke all on function public.factory_delivery_proposal_data(uuid) from public,anon;
grant execute on function public.factory_delivery_proposal_data(uuid) to authenticated;

commit;

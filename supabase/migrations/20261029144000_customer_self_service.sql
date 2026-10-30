begin;
create table public.portal_order_responses(id uuid primary key,company_id uuid not null references public.companies(id),customer_id uuid not null references public.customers(id),portal_user_id uuid not null references public.portal_users(id),order_id uuid not null references public.orders(id),
  response_type text not null check(response_type in ('delivery_details','service_request')),source_version text not null,source_snapshot jsonb not null,response_text text not null check(length(btrim(response_text)) between 8 and 2000),
  submitted_at timestamptz not null default clock_timestamp(),status text not null default 'submitted' check(status in ('submitted','reviewed')),reviewed_by uuid references public.app_users(id),review_note text,reviewed_at timestamptz,request_payload jsonb not null);
create index portal_responses_company_queue on public.portal_order_responses(company_id,status,submitted_at,id);
create index portal_responses_customer_order on public.portal_order_responses(company_id,customer_id,order_id);
alter table public.portal_order_responses enable row level security;
revoke all on public.portal_order_responses from public,anon,authenticated;

create function private.portal_order_projection(c uuid,customer uuid,order_uuid uuid) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare o jsonb;lines jsonb;shipments jsonb;n int;
begin
  select jsonb_build_object('id',id,'order_number',order_number,'order_date',order_date,'stage',current_stage,'expected_dispatch_date',expected_dispatch_date,
    'delivery_address',coalesce((select nullif(party_snapshot->>'delivery_address','') from public.order_quote_snapshots where company_id=c and order_id=order_uuid),(select nullif(shipping_address,'') from public.customers where company_id=c and id=customer)),
    'delivery_basis',case when exists(select 1 from public.order_quote_snapshots where company_id=c and order_id=order_uuid and nullif(party_snapshot->>'delivery_address','') is not null) then 'accepted_order' else 'current_customer_master' end) into o from public.orders where id=order_uuid and company_id=c and customer_id=customer and deleted_at is null;
  if o is null then raise exception 'Order is unavailable'; end if;
  select count(*) into n from public.order_items where company_id=c and order_id=order_uuid;
  if n>100 then raise exception 'This order needs a staff-prepared document because its line list exceeds the portal limit'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'profile_code',p.profile_code,'description',i.item_description,'quantity_kg',i.quantity_kg,'pieces',i.quantity_pieces,'length_per_piece_m',i.length_per_piece_m) order by i.id),'[]') into lines from public.order_items i left join public.aluminium_profiles p on p.id=i.profile_id and p.company_id=c where i.company_id=c and i.order_id=order_uuid;
  select count(*) into n from public.dispatches where company_id=c and order_id=order_uuid;
  if n>100 then raise exception 'This order needs a staff-prepared shipment summary'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'dispatch_number',dispatch_number,'dispatch_date',dispatch_date,'delivery_status',delivery_status,'weight_kg',total_weight_kg,'departed_at',actual_dispatched_at) order by dispatch_date,id),'[]') into shipments from public.dispatches where company_id=c and order_id=order_uuid;
  return o||jsonb_build_object('lines',lines,'shipments',shipments);
end $$;
revoke all on function private.portal_order_projection(uuid,uuid,uuid) from public,anon,authenticated;

create function public.portal_self_service_command(p_command text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare u public.portal_users;v_order uuid;v_rows jsonb;v_projection jsonb;v_version text;v_page int:=coalesce((p_payload->>'page')::int,1);v_search text:=coalesce(p_payload->>'search','');v_id uuid;r public.portal_order_responses;
begin
  select * into u from public.portal_users where id=auth.uid() and is_active;
  if auth.uid() is null or not found then raise exception 'An active customer portal identity is required' using errcode='42501'; end if;
  if p_command is null or jsonb_typeof(p_payload) is distinct from 'object' or v_page not between 1 and 10000 or length(v_search)>80 then raise exception 'Invalid self-service request'; end if;
  if p_command='identity.load' then
    if p_payload<>'{}' then raise exception 'Invalid identity request'; end if;
    return jsonb_build_object('kind','identity','name',u.full_name,'customer_id',u.customer_id);
  elsif p_command='orders.list' then
    if p_payload-array['page','search']<>'{}' then raise exception 'Invalid order search'; end if;
    select coalesce(jsonb_agg(to_jsonb(x)),'[]') into v_rows from(select id,order_number,order_date,current_stage stage,expected_dispatch_date from public.orders where company_id=u.company_id and customer_id=u.customer_id and deleted_at is null and position(lower(v_search) in lower(coalesce(order_number,'')))>0 order by order_date desc,id limit 10 offset (v_page-1)*10)x;
    return jsonb_build_object('kind','orders','items',v_rows,'page',v_page);
  end if;
  v_order:=(p_payload->>'order_id')::uuid;
  perform 1 from public.orders where id=v_order and company_id=u.company_id and customer_id=u.customer_id and deleted_at is null for share;
  if not found then raise exception 'Order is unavailable'; end if;
  if p_command='responses.list' then
    if p_payload-array['order_id','page']<>'{}' then raise exception 'Invalid response list'; end if;
    select coalesce(jsonb_agg(to_jsonb(x)),'[]') into v_rows from(select id,response_type,source_version,response_text,submitted_at,status from public.portal_order_responses where company_id=u.company_id and customer_id=u.customer_id and order_id=v_order order by submitted_at desc,id limit 10 offset (v_page-1)*10)x;
    return jsonb_build_object('kind','responses','items',v_rows,'page',v_page);
  end if;
  v_projection:=private.portal_order_projection(u.company_id,u.customer_id,v_order);v_version:=md5(v_projection::text);
  if p_command='order.load' then
    if p_payload-array['order_id']<>'{}' then raise exception 'Invalid order query'; end if;
    return jsonb_build_object('kind','order','order',v_projection,'version',v_version);
  elsif p_command='response.submit' then
    if p_payload-array['id','order_id','response_type','version','text']<>'{}' or p_payload->>'response_type' is null or p_payload->>'response_type' not in ('delivery_details','service_request') or length(btrim(coalesce(p_payload->>'text',''))) not between 8 and 2000 then raise exception 'Choose a defined request and record its details'; end if;
    v_id:=(p_payload->>'id')::uuid;perform pg_advisory_xact_lock(hashtextextended(u.company_id::text||':portal-response:'||v_id::text,0));
    select * into r from public.portal_order_responses where id=v_id;
    if found then if r.company_id<>u.company_id or r.customer_id<>u.customer_id or r.portal_user_id<>u.id or r.request_payload<>p_payload then raise exception 'This response identity has different details'; end if;return jsonb_build_object('kind','saved','id',r.id,'status',r.status);end if;
    if v_version is distinct from p_payload->>'version' then raise exception 'The order summary changed. Review its current version before responding'; end if;
    insert into public.portal_order_responses(id,company_id,customer_id,portal_user_id,order_id,response_type,source_version,source_snapshot,response_text,request_payload) values(v_id,u.company_id,u.customer_id,u.id,v_order,p_payload->>'response_type',v_version,v_projection,btrim(p_payload->>'text'),p_payload);
    return jsonb_build_object('kind','saved','id',v_id,'status','submitted');
  else raise exception 'Invalid self-service action'; end if;
end $$;
revoke all on function public.portal_self_service_command(text,jsonb) from public,anon;
grant execute on function public.portal_self_service_command(text,jsonb) to authenticated;

create function public.portal_response_review_command(p_command text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare c uuid;v_page int:=coalesce((p_payload->>'page')::int,1);rows jsonb;r public.portal_order_responses;
begin
  c:=private.commercial_actor(array['owner','admin','sales_manager','sales']);
  if p_command is null or jsonb_typeof(p_payload) is distinct from 'object' or v_page not between 1 and 10000 then raise exception 'Invalid portal review';end if;
  if p_command='responses.list' then
    if p_payload-array['page']<>'{}' then raise exception 'Invalid review page';end if;
    select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from(select pr.id,pr.order_id,o.order_number,pr.response_type,pr.source_version,pr.response_text,pr.submitted_at,pr.status,pr.review_note from public.portal_order_responses pr join public.orders o on o.id=pr.order_id and o.company_id=c where pr.company_id=c order by (pr.status='submitted') desc,pr.submitted_at desc,pr.id limit 10 offset (v_page-1)*10)x;
    return jsonb_build_object('kind','responses','items',rows,'page',v_page);
  elsif p_command='response.review' then
    if p_payload-array['id','note']<>'{}' or length(btrim(coalesce(p_payload->>'note',''))) not between 8 and 1000 then raise exception 'Record how this customer response was reviewed';end if;
    select * into r from public.portal_order_responses where id=(p_payload->>'id')::uuid and company_id=c for update;if not found or r.status<>'submitted' then raise exception 'This submitted response is unavailable';end if;
    update public.portal_order_responses set status='reviewed',reviewed_by=auth.uid(),review_note=btrim(p_payload->>'note'),reviewed_at=clock_timestamp() where id=r.id;
    return jsonb_build_object('kind','saved','id',r.id,'status','reviewed');
  else raise exception 'Invalid review action';end if;
end $$;
revoke all on function public.portal_response_review_command(text,jsonb) from public,anon;
grant execute on function public.portal_response_review_command(text,jsonb) to authenticated;
commit;

-- EOS 55: consistent quantity/unit/landed-price comparisons with visible unmatched conditions.
begin;
create table public.supplier_comparison_requests (
  id uuid primary key,company_id uuid not null references public.companies(id),title text not null check(length(btrim(title)) between 3 and 160),
  specification text not null check(length(btrim(specification)) between 5 and 2000),unit text not null check(unit in ('kg','m','piece')),
  quantity numeric(14,3) not null check(quantity>0 and quantity::text not in ('NaN','Infinity','-Infinity')),
  required_by date,created_by uuid not null references public.app_users(id),created_at timestamptz not null default now(),request_payload jsonb not null
);
create index supplier_comparison_requests_company_idx on public.supplier_comparison_requests(company_id,created_at desc,id);
create index supplier_comparison_requests_actor_idx on public.supplier_comparison_requests(created_by);
create table public.supplier_comparison_offers (
  id uuid primary key,company_id uuid not null references public.companies(id),request_id uuid not null references public.supplier_comparison_requests(id),
  vendor_id uuid not null references public.vendors(id),vendor_name_snapshot text not null,source_reference text not null,
  document_id uuid references public.technical_documents(id),payload jsonb not null,created_by uuid not null references public.app_users(id),created_at timestamptz not null default now()
);
create index supplier_comparison_offers_company_idx on public.supplier_comparison_offers(company_id,request_id,created_at,id);
create index supplier_comparison_offers_request_idx on public.supplier_comparison_offers(request_id);
create index supplier_comparison_offers_vendor_idx on public.supplier_comparison_offers(vendor_id);
create index supplier_comparison_offers_document_idx on public.supplier_comparison_offers(document_id);
create index supplier_comparison_offers_actor_idx on public.supplier_comparison_offers(created_by);
create table public.supplier_comparison_recommendations (
  id uuid primary key,company_id uuid not null references public.companies(id),request_id uuid not null references public.supplier_comparison_requests(id),
  offer_id uuid not null references public.supplier_comparison_offers(id),reason text not null check(length(btrim(reason)) between 5 and 1000),
  comparison_snapshot jsonb not null,created_by uuid not null references public.app_users(id),created_at timestamptz not null default now()
);
create index supplier_comparison_recommendations_company_idx on public.supplier_comparison_recommendations(company_id,request_id,created_at desc);
create index supplier_comparison_recommendations_request_idx on public.supplier_comparison_recommendations(request_id);
create index supplier_comparison_recommendations_offer_idx on public.supplier_comparison_recommendations(offer_id);
create index supplier_comparison_recommendations_actor_idx on public.supplier_comparison_recommendations(created_by);
alter table public.supplier_comparison_requests enable row level security;
alter table public.supplier_comparison_offers enable row level security;
alter table public.supplier_comparison_recommendations enable row level security;
revoke all on public.supplier_comparison_requests,public.supplier_comparison_offers,public.supplier_comparison_recommendations from public,anon,authenticated;
create trigger keep_supplier_comparison_requests before update or delete on public.supplier_comparison_requests for each row execute function private.keep_commercial_history();
create trigger keep_supplier_comparison_offers before update or delete on public.supplier_comparison_offers for each row execute function private.keep_commercial_history();
create trigger keep_supplier_comparison_recommendations before update or delete on public.supplier_comparison_recommendations for each row execute function private.keep_commercial_history();

create function private.supplier_offer_basis(p_request public.supplier_comparison_requests,p_offer public.supplier_comparison_offers) returns jsonb
language plpgsql stable security definer set search_path=public,private as $$
declare p jsonb:=p_offer.payload;v_factor numeric;v_family text;v_qty numeric;v_rate numeric;v_freight numeric;v_net numeric;v_tax numeric;v_reasons text[]:='{}';
begin
  v_family:=case p->>'unit' when 'kg' then 'kg' when 'tonne' then 'kg' when 'g' then 'kg' when 'm' then 'm' when 'mm' then 'm' when 'piece' then 'piece' when 'dozen' then 'piece' end;
  v_factor:=case p->>'unit' when 'kg' then 1 when 'tonne' then 1000 when 'g' then 0.001 when 'm' then 1 when 'mm' then 0.001 when 'piece' then 1 when 'dozen' then 12 end;
  v_qty:=(p->>'offered_quantity')::numeric*v_factor;v_rate:=round((p->>'unit_rate')::numeric/v_factor,6);
  if not exists(select 1 from public.vendors where company_id=p_offer.company_id and id=p_offer.vendor_id and is_active) then v_reasons:=array_append(v_reasons,'Supplier is no longer active'); end if;
  if p_offer.document_id is not null and not exists(select 1 from public.technical_documents where company_id=p_offer.company_id and id=p_offer.document_id and approval_status='approved'
    and linked_entity_type='vendor' and linked_entity_id=p_offer.vendor_id and (expiry_date is null or expiry_date>=private.ist_today())) then v_reasons:=array_append(v_reasons,'Supplier source document approval requires review'); end if;
  if v_family is distinct from p_request.unit then v_reasons:=array_append(v_reasons,'Unit dimension differs from the requirement'); end if;
  if abs(v_qty-p_request.quantity)>0.000001 then v_reasons:=array_append(v_reasons,'Offered quantity differs from the required quantity'); end if;
  if (p->>'specification_matches')::boolean is distinct from true then v_reasons:=array_append(v_reasons,'Specification has not been confirmed'); end if;
  if length(btrim(coalesce(p->>'exclusions','')))>0 then v_reasons:=array_append(v_reasons,'Supplier exclusions require review'); end if;
  if p->>'valid_until' is null then v_reasons:=array_append(v_reasons,'Offer validity is not captured');
  elsif (p->>'valid_until')::date<private.ist_today() then v_reasons:=array_append(v_reasons,'Offer has expired'); end if;
  if p->>'delivery_date' is null then v_reasons:=array_append(v_reasons,'Delivery date is not captured');
  elsif p_request.required_by is not null and (p->>'delivery_date')::date>p_request.required_by then v_reasons:=array_append(v_reasons,'Delivery is later than required'); end if;
  if p->>'freight_mode'='included' then v_freight:=0;
  elsif p->>'freight_mode'='excluded' and p->>'freight_amount' is not null then v_freight:=(p->>'freight_amount')::numeric;
  else v_reasons:=array_append(v_reasons,'Freight cost is unknown or excluded without a cost'); end if;
  if v_family=p_request.unit and abs(v_qty-p_request.quantity)<=0.000001 and v_freight is not null then
    v_net:=round((p->>'unit_rate')::numeric*(p->>'offered_quantity')::numeric+v_freight,2);
    v_tax:=round((p->>'unit_rate')::numeric*(p->>'offered_quantity')::numeric*(p->>'gst_percent')::numeric/100,2)
      +round(v_freight*(p->>'freight_gst_percent')::numeric/100,2);
  end if;
  return jsonb_build_object('id',p_offer.id,'vendor_name',p_offer.vendor_name_snapshot,'vendor_id',p_offer.vendor_id,
    'source_reference',p_offer.source_reference,'offered_quantity',(p->>'offered_quantity')::numeric,'offered_unit',p->>'unit',
    'normalized_quantity',v_qty,'normalized_unit',v_family,'normalized_rate',v_rate,'freight_mode',p->>'freight_mode','freight_amount',v_freight,
    'landed_before_tax',v_net,'tax',v_tax,'cash_total',v_net+v_tax,'price_basis_matches',cardinality(v_reasons)=0,'reasons',to_jsonb(v_reasons),
    'delivery_date',p->>'delivery_date','valid_until',p->>'valid_until','payment_terms',p->>'payment_terms','exclusions',p->>'exclusions','created_at',p_offer.created_at);
end;
$$;
revoke all on function private.supplier_offer_basis(public.supplier_comparison_requests,public.supplier_comparison_offers) from public,anon,authenticated;

create function public.supplier_comparison_command(p_command text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,private as $$
declare v_company uuid;v_request public.supplier_comparison_requests%rowtype;v_offer public.supplier_comparison_offers%rowtype;
  v_vendor public.vendors%rowtype;v_recommendation public.supplier_comparison_recommendations%rowtype;v_rows jsonb;
  v_page integer:=coalesce((p_payload->>'page')::integer,1);v_search text:=coalesce(p_payload->>'search','');v_number text;v_basis jsonb;
begin
  v_company:=private.commercial_actor(array['owner','admin','accounts']);
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or p_payload ? 'company_id' or v_page<1 or v_page>10000 or length(v_search)>80 then raise exception 'Invalid supplier comparison request'; end if;
  if p_command='request.create' then
    if p_payload-array['id','title','specification','unit','quantity','required_by']<>'{}' then raise exception 'Invalid supplier comparison request'; end if;
    select * into v_request from public.supplier_comparison_requests where id=(p_payload->>'id')::uuid and company_id=v_company;
    if found then if v_request.request_payload<>p_payload then raise exception 'That request identity was used for different details'; end if;return jsonb_build_object('id',v_request.id);end if;
    if jsonb_typeof(p_payload->'quantity') is distinct from 'number' or length(btrim(coalesce(p_payload->>'title','')))<3 or length(p_payload->>'title')>160
      or length(btrim(coalesce(p_payload->>'specification','')))<5 or length(p_payload->>'specification')>2000
      or (p_payload->>'unit') is null or (p_payload->>'unit') not in ('kg','m','piece') then raise exception 'Enter a specification, positive quantity and base unit'; end if;
    if (p_payload->>'quantity')::numeric<=0 or (p_payload->>'quantity')::numeric>100000000 then raise exception 'Enter a specification, positive quantity and base unit'; end if;
    if p_payload->>'unit'='piece' and (p_payload->>'quantity')::numeric<>trunc((p_payload->>'quantity')::numeric) then raise exception 'Piece requirements must be whole numbers'; end if;
    insert into public.supplier_comparison_requests(id,company_id,title,specification,unit,quantity,required_by,created_by,request_payload)
      values((p_payload->>'id')::uuid,v_company,btrim(p_payload->>'title'),btrim(p_payload->>'specification'),p_payload->>'unit',(p_payload->>'quantity')::numeric,nullif(p_payload->>'required_by','')::date,auth.uid(),p_payload);
    return jsonb_build_object('id',(p_payload->>'id')::uuid);
  elsif p_command='requests.list' then
    if p_payload-array['page','search','sort']<>'{}' or coalesce(p_payload->>'sort','newest') not in ('newest','title') then raise exception 'Invalid supplier comparison request'; end if;
    select coalesce(jsonb_agg(to_jsonb(r)),'[]') into v_rows from(
      select id,title,specification,unit,quantity,required_by,created_at from public.supplier_comparison_requests where company_id=v_company
      and (v_search='' or strpos(lower(title||' '||specification),lower(v_search))>0)
      order by case when p_payload->>'sort'='title' then title end,created_at desc,id offset((v_page-1)*10) limit 10)r;
    return jsonb_build_object('items',v_rows,'page',v_page);
  elsif p_command='vendors.list' then
    if p_payload-array['page','search']<>'{}' then raise exception 'Invalid supplier comparison request'; end if;
    select coalesce(jsonb_agg(to_jsonb(v)),'[]') into v_rows from(select id,vendor_name from public.vendors where company_id=v_company and is_active
      and strpos(lower(vendor_name),lower(v_search))>0 order by vendor_name,id offset((v_page-1)*10) limit 10)v;
    return jsonb_build_object('items',v_rows,'page',v_page);
  end if;
  select * into v_request from public.supplier_comparison_requests where company_id=v_company and id=(p_payload->>'request_id')::uuid for update;
  if not found then raise exception 'Purchase comparison is unavailable'; end if;
  if p_command='offer.create' then
    if p_payload-array['id','request_id','vendor_id','source_reference','document_id','offered_quantity','unit','unit_rate','freight_mode','freight_amount','gst_percent','freight_gst_percent','delivery_date','valid_until','payment_terms','specification_matches','exclusions']<>'{}' then raise exception 'Invalid supplier comparison request'; end if;
    select * into v_offer from public.supplier_comparison_offers where company_id=v_company and id=(p_payload->>'id')::uuid;
    if found then if v_offer.payload<>p_payload then raise exception 'That request identity was used for different details'; end if;return jsonb_build_object('id',v_offer.id);end if;
    foreach v_number in array array['offered_quantity','unit_rate','gst_percent','freight_gst_percent'] loop
      if jsonb_typeof(p_payload->v_number) is distinct from 'number' or (p_payload->>v_number)::numeric<0 or (p_payload->>v_number)::numeric>100000000 then raise exception 'Offer quantities, rates and tax must be valid numbers'; end if;
    end loop;
    if (p_payload->>'offered_quantity')::numeric<=0 or (p_payload->>'gst_percent')::numeric>100 or (p_payload->>'freight_gst_percent')::numeric>100
      or p_payload->>'unit' is null or p_payload->>'unit' not in ('kg','tonne','g','m','mm','piece','dozen')
      or p_payload->>'freight_mode' is null or p_payload->>'freight_mode' not in ('included','excluded','unknown')
      or jsonb_typeof(p_payload->'specification_matches') is distinct from 'boolean' then raise exception 'Offer quantities, rates and tax must be valid numbers'; end if;
    if p_payload->>'freight_amount' is not null and (jsonb_typeof(p_payload->'freight_amount')<>'number' or (p_payload->>'freight_amount')::numeric<0 or (p_payload->>'freight_amount')::numeric>100000000) then raise exception 'Freight must be a non-negative amount or unknown'; end if;
    if length(btrim(coalesce(p_payload->>'source_reference','')))<2 or length(p_payload->>'source_reference')>200 or length(btrim(coalesce(p_payload->>'payment_terms','')))<2
      or length(p_payload->>'payment_terms')>500 or length(coalesce(p_payload->>'exclusions',''))>1000 then raise exception 'Capture supplier reference, payment terms and exclusions'; end if;
    foreach v_number in array array['delivery_date','valid_until'] loop
      if p_payload->>v_number is not null and (jsonb_typeof(p_payload->v_number)<>'string' or to_char((p_payload->>v_number)::date,'YYYY-MM-DD')<>p_payload->>v_number) then raise exception 'Enter valid supplier dates'; end if;
    end loop;
    select * into v_vendor from public.vendors where company_id=v_company and id=(p_payload->>'vendor_id')::uuid and is_active for share;
    if not found then raise exception 'Choose an active company vendor'; end if;
    if nullif(p_payload->>'document_id','') is not null and not exists(select 1 from public.technical_documents where id=(p_payload->>'document_id')::uuid and company_id=v_company and approval_status='approved'
      and linked_entity_type='vendor' and linked_entity_id=v_vendor.id and (expiry_date is null or expiry_date>=private.ist_today())) then raise exception 'Supplier source document is unavailable'; end if;
    insert into public.supplier_comparison_offers(id,company_id,request_id,vendor_id,vendor_name_snapshot,source_reference,document_id,payload,created_by)
      values((p_payload->>'id')::uuid,v_company,v_request.id,v_vendor.id,v_vendor.vendor_name,btrim(p_payload->>'source_reference'),nullif(p_payload->>'document_id','')::uuid,p_payload,auth.uid());
    return jsonb_build_object('id',(p_payload->>'id')::uuid);
  elsif p_command='request.load' then
    if p_payload-array['request_id','page']<>'{}' then raise exception 'Invalid supplier comparison request'; end if;
    select coalesce(jsonb_agg(private.supplier_offer_basis(v_request,o) order by o.created_at desc,o.id),'[]') into v_rows
      from(select * from public.supplier_comparison_offers where company_id=v_company and request_id=v_request.id order by created_at desc,id offset((v_page-1)*10) limit 10)o;
    return jsonb_build_object('request',to_jsonb(v_request)-'request_payload','offers',v_rows,'page',v_page,
      'recommendations',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from(select id,offer_id,reason,created_at from public.supplier_comparison_recommendations where company_id=v_company and request_id=v_request.id order by created_at desc,id limit 10)r),
      'basis','INR; matching quantity and unit dimension; goods and known freight before tax; separately rounded goods and freight GST. Payment and delivery terms remain separate. No automatic supplier ranking or purchase posting.');
  elsif p_command='recommendation.record' then
    if p_payload-array['id','request_id','offer_id','reason']<>'{}' then raise exception 'Invalid supplier comparison request'; end if;
    select * into v_recommendation from public.supplier_comparison_recommendations where company_id=v_company and id=(p_payload->>'id')::uuid;
    if found then if v_recommendation.request_id<>v_request.id or v_recommendation.offer_id::text is distinct from p_payload->>'offer_id' or v_recommendation.reason is distinct from btrim(p_payload->>'reason') then raise exception 'That request identity was used for different details'; end if;return jsonb_build_object('id',v_recommendation.id);end if;
    select * into v_offer from public.supplier_comparison_offers where company_id=v_company and request_id=v_request.id and id=(p_payload->>'offer_id')::uuid;
    if not found then raise exception 'Supplier offer is unavailable'; end if;
    v_basis:=private.supplier_offer_basis(v_request,v_offer);
    if (v_basis->>'price_basis_matches')::boolean is distinct from true then raise exception 'Resolve unmatched offer conditions before recommending a supplier'; end if;
    if length(btrim(coalesce(p_payload->>'reason','')))<5 or length(p_payload->>'reason')>1000 then raise exception 'Explain the recommendation in 5 to 1000 characters'; end if;
    insert into public.supplier_comparison_recommendations(id,company_id,request_id,offer_id,reason,comparison_snapshot,created_by)
      values((p_payload->>'id')::uuid,v_company,v_request.id,v_offer.id,btrim(p_payload->>'reason'),v_basis,auth.uid());
    return jsonb_build_object('id',(p_payload->>'id')::uuid);
  end if;
  raise exception 'Invalid supplier comparison request';
end;
$$;
revoke all on function public.supplier_comparison_command(text,jsonb) from public,anon;
grant execute on function public.supplier_comparison_command(text,jsonb) to authenticated;
commit;

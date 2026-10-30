begin;
create table public.master_consolidation_reviews (
  id uuid primary key, company_id uuid not null references public.companies(id),
  entity_type text not null check(entity_type in ('customers','vendors','aluminium_profiles')),
  source_id uuid not null, target_id uuid not null, source_snapshot jsonb not null, target_snapshot jsonb not null,
  reason text not null check(length(btrim(reason)) between 8 and 1000),
  status text not null default 'proposed' check(status in ('proposed','consolidated')),
  proposed_by uuid not null references public.app_users(id), reviewed_by uuid references public.app_users(id),
  proposed_at timestamptz not null default clock_timestamp(), reviewed_at timestamptz,
  check(source_id<>target_id), check(reviewed_by is null or reviewed_by<>proposed_by)
);
create unique index master_consolidated_source on public.master_consolidation_reviews(company_id,entity_type,source_id) where status='consolidated';
create index master_consolidation_queue on public.master_consolidation_reviews(company_id,status,proposed_at,id);
create index cleanup_customer_name on public.customers(company_id,lower(regexp_replace(customer_name,'[^a-zA-Z0-9]','','g')));
create index cleanup_vendor_name on public.vendors(company_id,lower(regexp_replace(vendor_name,'[^a-zA-Z0-9]','','g')));
create index cleanup_profile_name on public.aluminium_profiles(company_id,lower(regexp_replace(profile_name,'[^a-zA-Z0-9]','','g')));
alter table public.master_consolidation_reviews enable row level security;
revoke all on public.master_consolidation_reviews from public,anon,authenticated;

create function private.cleanup_master(p_company uuid,p_entity text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,private as $$
declare r jsonb;
begin
  if p_entity not in ('customers','vendors','aluminium_profiles') then raise exception 'Unsupported master'; end if;
  execute format('select to_jsonb(m) from public.%I m where company_id=$1 and id=$2',p_entity) into r using p_company,p_id;
  return r;
end $$;
create function private.cleanup_compatible(a jsonb,b jsonb,p_entity text) returns boolean
language plpgsql immutable set search_path=public,private as $$
declare k text; an text;bn text;
begin
  if a is null or b is null or coalesce((a->>'is_active')::boolean,false) is not true or coalesce((b->>'is_active')::boolean,false) is not true then return false; end if;
  if p_entity='aluminium_profiles' then
    return (a-array['id','profile_code','profile_name','created_at','updated_at','created_by','notes']) =
           (b-array['id','profile_code','profile_name','created_at','updated_at','created_by','notes']);
  end if;
  an:=upper(regexp_replace(coalesce(a->>'gst_number',''),'\s','','g'));bn:=upper(regexp_replace(coalesce(b->>'gst_number',''),'\s','','g'));
  if an<>'' or bn<>'' then return an=bn and an<>''; end if;
  k:=case when p_entity='customers' then 'customer_name' else 'vendor_name' end;
  if lower(regexp_replace(a->>k,'[^a-zA-Z0-9]','','g')) is distinct from lower(regexp_replace(b->>k,'[^a-zA-Z0-9]','','g')) then return false; end if;
  return (nullif(lower(btrim(a->>'email')),'') is not null and lower(btrim(a->>'email'))=lower(btrim(b->>'email')))
    or (nullif(regexp_replace(a->>'phone','\D','','g'),'') is not null and regexp_replace(a->>'phone','\D','','g')=regexp_replace(b->>'phone','\D','','g'));
end $$;
revoke all on function private.cleanup_master(uuid,text,uuid),private.cleanup_compatible(jsonb,jsonb,text) from public,anon,authenticated;

create function private.cleanup_profile_dependencies(c uuid,p_id uuid) returns jsonb
language sql stable security definer set search_path=public,private as $$
  select jsonb_build_object(
    'unfinished_orders',(select count(distinct o.id) from public.orders o join public.order_items i on i.order_id=o.id and i.company_id=o.company_id
      where o.company_id=c and i.profile_id=p_id and o.deleted_at is null and o.current_stage not in ('closed','cancelled')),
    'unfinished_jobs',(select count(*) from public.production_jobs where company_id=c and profile_id=p_id and status not in ('completed','cancelled')),
    'unfinished_quotes',(select count(distinct q.id) from public.quotes q join public.quote_items i on i.quote_id=q.id and i.company_id=q.company_id
      where q.company_id=c and i.profile_id=p_id and q.deleted_at is null and q.status not in ('converted_to_order','rejected','expired','cancelled')),
    'unfinished_configurations',(select count(distinct x.id) from public.system_configurations x join public.system_profiles sp on sp.company_id=x.company_id and sp.series_id=x.series_id
      where x.company_id=c and sp.profile_id=p_id and x.status::text not in ('completed','cancelled','archived')));
$$;
revoke all on function private.cleanup_profile_dependencies(uuid,uuid) from public,anon,authenticated;

create function public.master_cleanup_command(p_command text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,private as $$
declare c uuid; e text:=p_payload->>'entity_type'; a jsonb;b jsonb;rows jsonb;v public.master_consolidation_reviews;v_page int:=coalesce((p_payload->>'page')::int,1);v_name text;v_search text:=coalesce(p_payload->>'search','');v_id uuid;v_dependencies jsonb:='{}'::jsonb;
begin
  c:=private.commercial_actor(array['owner','admin']);
  if p_command is null or jsonb_typeof(p_payload) is distinct from 'object' or v_page not between 1 and 10000 or length(v_search)>80 then raise exception 'Invalid cleanup request'; end if;
  if p_command='reviews.list' then
    if p_payload-array['page']<>'{}' then raise exception 'Invalid review list'; end if;
    select coalesce(jsonb_agg(to_jsonb(r)),'[]') into rows from(select id,entity_type,source_id,target_id,reason,status,proposed_by,reviewed_by,source_snapshot->>case when entity_type='customers' then 'customer_name' when entity_type='vendors' then 'vendor_name' else 'profile_name' end source_name,target_snapshot->>case when entity_type='customers' then 'customer_name' when entity_type='vendors' then 'vendor_name' else 'profile_name' end target_name from public.master_consolidation_reviews where company_id=c order by proposed_at desc,id limit 10 offset (v_page-1)*10)r;
    return jsonb_build_object('kind','reviews','items',rows,'page',v_page);
  end if;
  if e is null or e not in ('customers','vendors','aluminium_profiles') then raise exception 'Choose the master type'; end if;
  if p_command='duplicates.list' then
    if p_payload-array['entity_type','page','search']<>'{}' then raise exception 'Invalid duplicate search';end if;
    v_name:=case e when 'customers' then 'customer_name' when 'vendors' then 'vendor_name' else 'profile_name' end;
    execute format('select coalesce(jsonb_agg(to_jsonb(x)),''[]'') from(select m1.id source_id,m2.id target_id,m1.%1$I source_name,m2.%1$I target_name from public.%2$I m1 join public.%2$I m2 on m2.company_id=m1.company_id and m1.id<m2.id and m2.is_active where m1.company_id=$1 and m1.is_active and (lower(regexp_replace(m1.%1$I,''[^a-zA-Z0-9]'','''',''g''))=lower(regexp_replace(m2.%1$I,''[^a-zA-Z0-9]'','''',''g'')) %3$s) and position(lower($2) in lower(m1.%1$I||'' ''||m2.%1$I))>0 order by m1.%1$I,m1.id,m2.id limit 10 offset $3)x',v_name,e,case when e='aluminium_profiles' then 'or lower(m1.profile_code)=lower(m2.profile_code)' else 'or (nullif(upper(regexp_replace(m1.gst_number,''\s'','''',''g'')),'''') is not null and upper(regexp_replace(m1.gst_number,''\s'','''',''g''))=upper(regexp_replace(m2.gst_number,''\s'','''',''g'')))' end) into rows using c,v_search,(v_page-1)*10;
    return jsonb_build_object('kind','duplicates','items',rows,'page',v_page);
  end if;
  if p_command='masters.list' then
    if p_payload-array['entity_type','page','search']<>'{}' then raise exception 'Invalid master search'; end if;
    v_name:=case e when 'customers' then 'customer_name' when 'vendors' then 'vendor_name' else 'profile_name' end;
    execute format('select coalesce(jsonb_agg(to_jsonb(r)),''[]'') from(select id,%I name from public.%I where company_id=$1 and is_active and position(lower($2) in lower(%I))>0 order by %I,id limit 10 offset $3)r',v_name,e,v_name,v_name) into rows using c,v_search,(v_page-1)*10;
    return jsonb_build_object('kind','masters','items',rows,'page',v_page);
  end if;
  if p_command='review.approve' then
    if p_payload-array['id','entity_type']<>'{}' then raise exception 'Invalid review decision'; end if;
    select * into v from public.master_consolidation_reviews where company_id=c and id=(p_payload->>'id')::uuid and entity_type=e for update;
    if not found or v.proposed_by=auth.uid() then raise exception 'Another administrator must review the consolidation'; end if;
    if v.status='consolidated' then return jsonb_build_object('kind','saved','id',v.id); end if;
  elsif p_command in ('review.preview','review.propose') then
    if p_payload-array['entity_type','source_id','target_id','reason','id','fingerprint']<>'{}' then raise exception 'Invalid consolidation proposal'; end if;
    v.source_id:=(p_payload->>'source_id')::uuid;v.target_id:=(p_payload->>'target_id')::uuid;
    if v.source_id=v.target_id then raise exception 'Choose two different masters'; end if;
  else raise exception 'Invalid cleanup command'; end if;
  -- A consistent master lock order also prevents concurrent chains and cycles.
  perform pg_advisory_xact_lock(hashtextextended(c::text||':master-cleanup',0));
  execute format('select 1 from public.%I where company_id=$1 and id=any($2) order by id for update',e) using c,array[v.source_id,v.target_id];
  a:=private.cleanup_master(c,e,v.source_id);b:=private.cleanup_master(c,e,v.target_id);
  if not private.cleanup_compatible(a,b,e) then raise exception 'These records have incompatible identity or specifications; correct the master data before consolidation'; end if;
  if exists(select 1 from public.master_consolidation_reviews where company_id=c and entity_type=e and status='consolidated' and (source_id=any(array[v.source_id,v.target_id]) or target_id=v.source_id)) then raise exception 'A canonical identity cannot be consolidated into another record'; end if;
  if e='aluminium_profiles' then v_dependencies:=private.cleanup_profile_dependencies(c,v.source_id);end if;
  if p_command='review.preview' then return jsonb_build_object('kind','preview','source',a,'target',b,'fingerprint',md5(a::text||b::text),'dependencies',v_dependencies,'history_policy','Historical references and issued snapshots stay attached to their original identities; new entry uses the active canonical master. Resolve unfinished profile work before retiring its source.'); end if;
  if p_command='review.propose' then
    if md5(a::text||b::text) is distinct from p_payload->>'fingerprint' or length(btrim(coalesce(p_payload->>'reason',''))) not between 8 and 1000 then raise exception 'Review the current comparison and give a reason'; end if;
    v_id:=(p_payload->>'id')::uuid;
    insert into public.master_consolidation_reviews(id,company_id,entity_type,source_id,target_id,source_snapshot,target_snapshot,reason,proposed_by) values(v_id,c,e,v.source_id,v.target_id,a,b,btrim(p_payload->>'reason'),auth.uid());
    return jsonb_build_object('kind','saved','id',v_id);
  end if;
  if a is distinct from v.source_snapshot or b is distinct from v.target_snapshot then raise exception 'A master changed after proposal; create a fresh reviewed proposal'; end if;
  if e='aluminium_profiles' and exists(select 1 from jsonb_each_text(v_dependencies) where value::bigint>0) then
    raise exception 'Finish or resolve the source profile''s unfinished orders, production, quotations and configurations before consolidation; its existing work must retain an active profile';end if;
  execute format('update public.%I set is_active=false,updated_at=clock_timestamp() where company_id=$1 and id=$2',e) using c,v.source_id;
  update public.master_consolidation_reviews set status='consolidated',reviewed_by=auth.uid(),reviewed_at=clock_timestamp() where id=v.id;
  insert into public.audit_logs(company_id,actor_id,action,entity_type,entity_id,metadata_json) values(c,auth.uid(),'master_identity_consolidated',e,v.source_id,jsonb_build_object('canonical_id',v.target_id,'review_id',v.id,'reason',v.reason));
  return jsonb_build_object('kind','saved','id',v.id);
end $$;
revoke all on function public.master_cleanup_command(text,jsonb) from public,anon;
grant execute on function public.master_cleanup_command(text,jsonb) to authenticated;

create function private.guard_canonical_master() returns trigger language plpgsql security definer set search_path=public,private as $$
begin
  if tg_op='DELETE' then
    if exists(select 1 from public.master_consolidation_reviews where company_id=old.company_id and entity_type=tg_table_name and (source_id=old.id or target_id=old.id)) then raise exception 'Reviewed master identities are retained with their consolidation history';end if;
    return old;
  end if;
  if new.is_active and exists(select 1 from public.master_consolidation_reviews where company_id=new.company_id and entity_type=tg_table_name and source_id=new.id and status='consolidated') then raise exception 'Use the reviewed canonical master; consolidated aliases cannot be reactivated'; end if;
  return new;
end $$;
revoke all on function private.guard_canonical_master() from public,anon,authenticated;
create trigger guard_customer_canonical before update or delete on public.customers for each row execute function private.guard_canonical_master();
create trigger guard_vendor_canonical before update or delete on public.vendors for each row execute function private.guard_canonical_master();
create trigger guard_profile_canonical before update or delete on public.aluminium_profiles for each row execute function private.guard_canonical_master();
commit;

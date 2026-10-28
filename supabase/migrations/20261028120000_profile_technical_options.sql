-- EOS 82: independently approved technical choices, selected and frozen on quotation lines.
begin;
create table public.profile_technical_options (
  id uuid primary key, company_id uuid not null references public.companies(id), profile_id uuid not null references public.aluminium_profiles(id),
  revision_number integer not null, alloy_id uuid not null references public.pcda_master_alloys(id), temper_id uuid not null references public.pcda_master_tempers(id),
  snapshot jsonb not null, source_fingerprint text not null, status text not null default 'draft' check(status in ('draft','approved','withdrawn')),
  author_id uuid not null references public.app_users(id), approved_by uuid references public.app_users(id), created_at timestamptz not null default now(),
  approved_at timestamptz, unique(company_id,profile_id,revision_number)
);
create index profile_technical_options_company_idx on public.profile_technical_options(company_id,profile_id,status);
create index profile_technical_options_profile_idx on public.profile_technical_options(profile_id);
create index profile_technical_options_alloy_idx on public.profile_technical_options(alloy_id);
create index profile_technical_options_temper_idx on public.profile_technical_options(temper_id);
create index profile_technical_options_author_idx on public.profile_technical_options(author_id);
create index profile_technical_options_approver_idx on public.profile_technical_options(approved_by);
alter table public.profile_technical_options enable row level security;
revoke all on public.profile_technical_options from public,anon,authenticated;
alter table public.quote_items add column technical_option_id uuid references public.profile_technical_options(id);
alter table public.quote_items add column technical_spec_snapshot jsonb;
alter table public.order_items add column technical_option_id uuid references public.profile_technical_options(id);
alter table public.order_items add column technical_spec_snapshot jsonb;
create index quote_items_technical_option_idx on public.quote_items(technical_option_id);
create index order_items_technical_option_idx on public.order_items(technical_option_id);

create function private.technical_profile_snapshot(p_profile public.aluminium_profiles) returns jsonb
language sql immutable set search_path=public,private as $$
  select jsonb_build_object('profile_id',p_profile.id,'profile_code',p_profile.profile_code,'section_weight_kg_per_m',p_profile.section_weight_kg_per_m,
    'perimeter_mm',p_profile.section_perimeter_mm,'drawing_revision',p_profile.drawing_revision,'drawing_approval_status',p_profile.drawing_approval_status,
    'ccd_mm',p_profile.circumscribing_circle_diameter_mm,'wall_thickness_mm',p_profile.nominal_wall_thickness_mm,'standard_length_m',p_profile.standard_length_m);
$$;
revoke all on function private.technical_profile_snapshot(public.aluminium_profiles) from public,anon,authenticated;

create function private.technical_option_fingerprint(p_profile public.aluminium_profiles,p_alloy uuid,p_temper uuid) returns text
language sql stable security definer set search_path=public,private as $$
  select md5((private.technical_profile_snapshot(p_profile)||jsonb_build_object('alloy',a.value,'temper',t.value))::text)
  from public.pcda_master_alloys a cross join public.pcda_master_tempers t
  where a.id=p_alloy and t.id=p_temper and a.company_id=p_profile.company_id and t.company_id=p_profile.company_id and a.is_active and t.is_active;
$$;
revoke all on function private.technical_option_fingerprint(public.aluminium_profiles,uuid,uuid) from public,anon,authenticated;

create function private.lock_technical_option_masters(p_company uuid,p_alloy uuid,p_temper uuid) returns void
language plpgsql security definer set search_path=public,private as $$
begin
  perform 1 from public.pcda_master_alloys where company_id=p_company and id=p_alloy and is_active for share;
  if not found then raise exception 'Choose active company alloy and temper masters'; end if;
  perform 1 from public.pcda_master_tempers where company_id=p_company and id=p_temper and is_active for share;
  if not found then raise exception 'Choose active company alloy and temper masters'; end if;
end;
$$;
revoke all on function private.lock_technical_option_masters(uuid,uuid,uuid) from public,anon,authenticated;

create function private.guard_technical_option_history() returns trigger language plpgsql set search_path=public,private as $$
begin
  if tg_op='DELETE' or (to_jsonb(new)-array['status','approved_by','approved_at']) is distinct from (to_jsonb(old)-array['status','approved_by','approved_at'])
    or old.status='withdrawn' or (old.status='approved' and new.status<>'withdrawn')
    or (old.status='draft' and new.status not in ('approved','withdrawn')) then raise exception 'Technical option history cannot be rewritten'; end if;
  return new;
end;
$$;
revoke all on function private.guard_technical_option_history() from public,anon,authenticated;
create trigger guard_technical_option_history before update or delete on public.profile_technical_options for each row execute function private.guard_technical_option_history();

create function public.profile_technical_command(p_command text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,private as $$
declare v_company uuid; v_profile public.aluminium_profiles%rowtype; v_option public.profile_technical_options%rowtype;
  v_snapshot jsonb; v_rows jsonb; v_page integer:=coalesce((p_payload->>'page')::integer,1); v_search text:=coalesce(p_payload->>'search','');v_count integer;
begin
  v_company:=private.commercial_actor(array['owner','admin','sales','sales_manager','production_manager','production','factory_manager','quality','inventory_manager','accounts','viewer']);
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or p_payload-array['profile_id','id','alloy_id','temper_id','page','search']<>'{}'
    or v_page<1 or v_page>10000 or length(v_search)>80 then raise exception 'Invalid technical option request'; end if;
  if p_command not in ('options.list','catalog.list','option.create','option.approve','option.withdraw') then raise exception 'Invalid technical option request'; end if;
  select * into v_profile from public.aluminium_profiles where id=(p_payload->>'profile_id')::uuid and company_id=v_company and is_active for update;
  if not found then raise exception 'Active profile is unavailable'; end if;
  v_snapshot:=private.technical_profile_snapshot(v_profile);
  if p_command='catalog.list' then
    perform private.commercial_actor(array['owner','admin','production_manager','quality']);
    return jsonb_build_object('alloys',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from (select id,value from public.pcda_master_alloys where company_id=v_company and is_active and strpos(lower(value),lower(v_search))>0 order by value,id offset((v_page-1)*10) limit 10)a),
      'tempers',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from (select id,value from public.pcda_master_tempers where company_id=v_company and is_active and strpos(lower(value),lower(v_search))>0 order by value,id offset((v_page-1)*10) limit 10)a),'page',v_page);
  end if;
  if p_command='option.create' then
    perform private.commercial_actor(array['owner','admin','production_manager','quality']);
    if nullif(p_payload->>'id','') is null then raise exception 'A technical option identity is required'; end if;
    select * into v_option from public.profile_technical_options where id=(p_payload->>'id')::uuid and company_id=v_company;
    if found then
      if v_option.profile_id<>v_profile.id or v_option.alloy_id::text is distinct from p_payload->>'alloy_id' or v_option.temper_id::text is distinct from p_payload->>'temper_id' then raise exception 'That request identity was used for different details'; end if;
      return jsonb_build_object('id',v_option.id);
    end if;
    if lower(coalesce(v_profile.drawing_approval_status,''))<>'approved' or nullif(btrim(v_profile.drawing_revision),'') is null then raise exception 'An approved drawing revision is required'; end if;
    if not exists(select 1 from public.pcda_master_alloys where company_id=v_company and id=(p_payload->>'alloy_id')::uuid and is_active)
      or not exists(select 1 from public.pcda_master_tempers where company_id=v_company and id=(p_payload->>'temper_id')::uuid and is_active) then raise exception 'Choose active company alloy and temper masters'; end if;
    perform private.lock_technical_option_masters(v_company,(p_payload->>'alloy_id')::uuid,(p_payload->>'temper_id')::uuid);
    insert into public.profile_technical_options(id,company_id,profile_id,revision_number,alloy_id,temper_id,snapshot,source_fingerprint,author_id)
      values((p_payload->>'id')::uuid,v_company,v_profile.id,(select coalesce(max(revision_number),0)+1 from public.profile_technical_options where company_id=v_company and profile_id=v_profile.id),
      (p_payload->>'alloy_id')::uuid,(p_payload->>'temper_id')::uuid,v_snapshot||jsonb_build_object('alloy',(select value from public.pcda_master_alloys where id=(p_payload->>'alloy_id')::uuid),
      'temper',(select value from public.pcda_master_tempers where id=(p_payload->>'temper_id')::uuid)),private.technical_option_fingerprint(v_profile,(p_payload->>'alloy_id')::uuid,(p_payload->>'temper_id')::uuid),auth.uid());
    return jsonb_build_object('id',(p_payload->>'id')::uuid);
  end if;
  if p_command in ('option.approve','option.withdraw') then
    perform private.commercial_actor(array['owner','admin','quality']);
    select * into v_option from public.profile_technical_options where company_id=v_company and profile_id=v_profile.id and id=(p_payload->>'id')::uuid for update;
    if not found then raise exception 'Technical option is unavailable'; end if;
    if p_command='option.approve' then
      if v_option.author_id=auth.uid() then raise exception 'Another qualified reviewer must approve this technical option'; end if;
      if v_option.status<>'draft' then raise exception 'Only draft technical options can be approved'; end if;
      perform private.lock_technical_option_masters(v_company,v_option.alloy_id,v_option.temper_id);
      if v_option.source_fingerprint is distinct from private.technical_option_fingerprint(v_profile,v_option.alloy_id,v_option.temper_id) then raise exception 'Profile specifications changed. Create a new technical option'; end if;
      update public.profile_technical_options set status='approved',approved_by=auth.uid(),approved_at=now() where id=v_option.id;
    else
      update public.profile_technical_options set status='withdrawn' where id=v_option.id;
    end if;
    return jsonb_build_object('id',v_option.id);
  end if;
  select count(*) into v_count from public.profile_technical_options where company_id=v_company and profile_id=v_profile.id and status='approved' and source_fingerprint=private.technical_option_fingerprint(v_profile,alloy_id,temper_id);
  select coalesce(jsonb_agg(to_jsonb(o) order by o.revision_number desc),'[]') into v_rows from (
    select id,revision_number,status,snapshot,author_id,approved_by,coalesce(source_fingerprint=private.technical_option_fingerprint(v_profile,alloy_id,temper_id),false) as current_source
    from public.profile_technical_options where company_id=v_company and profile_id=v_profile.id
      and (private.get_current_user_role() in ('owner','admin','production_manager','quality') or status='approved')
      order by coalesce(status='approved' and source_fingerprint=private.technical_option_fingerprint(v_profile,alloy_id,temper_id),false) desc,revision_number desc,id offset((v_page-1)*10) limit 10)o;
  return jsonb_build_object('items',v_rows,'page',v_page,'eligible_count',v_count,'profile',v_snapshot);
end;
$$;
revoke all on function public.profile_technical_command(text,jsonb) from public,anon;
grant execute on function public.profile_technical_command(text,jsonb) to authenticated;

create function private.bind_quote_technical_option() returns trigger
language plpgsql security definer set search_path=public,private as $$
declare v_profile public.aluminium_profiles%rowtype; v_option public.profile_technical_options%rowtype; v_count integer; v_quote public.quotes%rowtype;
begin
  select * into v_quote from public.quotes where id=new.quote_id and company_id=new.company_id for update;
  if not found then raise exception 'Quotation is unavailable'; end if;
  if tg_op='UPDATE' and v_quote.status not in ('draft','internal_review') then
    if new.technical_option_id is distinct from old.technical_option_id or new.technical_spec_snapshot is distinct from old.technical_spec_snapshot
      or new.alloy_id is distinct from old.alloy_id or new.temper_id is distinct from old.temper_id
      or new.section_weight_kg_per_m is distinct from old.section_weight_kg_per_m or new.drawing_revision is distinct from old.drawing_revision
      or new.profile_id is distinct from old.profile_id or new.drawing_approval_status is distinct from old.drawing_approval_status
      then raise exception 'Issued technical instructions cannot change'; end if;
    return new;
  end if;
  select * into v_profile from public.aluminium_profiles where id=new.profile_id and company_id=new.company_id and is_active for share;
  if not found then raise exception 'Active profile is unavailable'; end if;
  if new.technical_option_id is null then
    select count(*) into v_count from public.profile_technical_options where company_id=new.company_id and profile_id=new.profile_id and status='approved'
      and source_fingerprint=private.technical_option_fingerprint(v_profile,alloy_id,temper_id);
    if v_count>1 then raise exception 'Choose an approved alloy and temper option for this profile'; end if;
    if v_count=1 then select id into new.technical_option_id from public.profile_technical_options where company_id=new.company_id and profile_id=new.profile_id and status='approved'
      and source_fingerprint=private.technical_option_fingerprint(v_profile,alloy_id,temper_id); end if;
  end if;
  if new.technical_option_id is not null then
    select * into v_option from public.profile_technical_options where id=new.technical_option_id and company_id=new.company_id and profile_id=new.profile_id and status='approved' for share;
    if not found or v_option.source_fingerprint is distinct from private.technical_option_fingerprint(v_profile,v_option.alloy_id,v_option.temper_id) then raise exception 'Selected technical option is stale or unavailable'; end if;
    perform private.lock_technical_option_masters(new.company_id,v_option.alloy_id,v_option.temper_id);
    if v_option.source_fingerprint is distinct from private.technical_option_fingerprint(v_profile,v_option.alloy_id,v_option.temper_id) then raise exception 'Selected technical option is stale or unavailable'; end if;
    new.technical_spec_snapshot:=v_option.snapshot;new.alloy_id:=v_option.alloy_id;new.temper_id:=v_option.temper_id;
    new.section_weight_kg_per_m:=(v_option.snapshot->>'section_weight_kg_per_m')::numeric;
    new.drawing_revision:=v_option.snapshot->>'drawing_revision';new.drawing_approval_status:='Approved';
  else
    if exists(select 1 from public.profile_technical_options where company_id=new.company_id and profile_id=new.profile_id) then raise exception 'This profile needs a current approved technical option'; end if;
    new.technical_spec_snapshot:=null;
  end if;
  return new;
end;
$$;
revoke all on function private.bind_quote_technical_option() from public,anon,authenticated;
create trigger a_bind_quote_technical_option before insert or update on public.quote_items for each row execute function private.bind_quote_technical_option();
commit;

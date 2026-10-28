-- EOS 36: link one approved document without broadening its original audience.
begin;
create table public.record_document_links (
  id uuid primary key,company_id uuid not null references public.companies(id),entity_type text not null check(entity_type in ('quote','order')),
  entity_id uuid not null,document_id uuid not null references public.technical_documents(id),document_version integer not null,
  purpose text not null check(length(btrim(purpose)) between 3 and 300),linked_by uuid not null references public.app_users(id),
  created_at timestamptz not null default now(),unique(company_id,entity_type,entity_id,document_id,document_version)
);
create index record_document_links_company_entity_idx on public.record_document_links(company_id,entity_type,entity_id,created_at);
create index record_document_links_document_idx on public.record_document_links(document_id);
create index record_document_links_actor_idx on public.record_document_links(linked_by);
alter table public.record_document_links enable row level security;
revoke all on public.record_document_links from public,anon,authenticated;
create trigger keep_record_document_links before update or delete on public.record_document_links for each row execute function private.keep_commercial_history();

create function private.linked_document_target(p_company uuid,p_kind text,p_id uuid) returns void
language plpgsql stable security definer set search_path=public,private as $$
begin
  if p_kind='quote' then
    perform private.commercial_actor(array['owner','admin','sales','sales_manager','accounts','viewer']);
    if not exists(select 1 from public.quotes where company_id=p_company and id=p_id) then raise exception 'Document target is unavailable'; end if;
  elsif p_kind='order' then
    perform private.commercial_actor(array['owner','admin','sales','sales_manager','accounts','viewer','production_manager','production','factory_manager','quality','inventory_manager','dispatch_manager','dispatch']);
    if not exists(select 1 from public.orders where company_id=p_company and id=p_id and deleted_at is null) then raise exception 'Document target is unavailable'; end if;
  else raise exception 'Document target is unavailable'; end if;
end;
$$;
revoke all on function private.linked_document_target(uuid,text,uuid) from public,anon,authenticated;

create function private.linkable_document(p_doc public.technical_documents,p_kind text,p_id uuid) returns boolean
language plpgsql stable security definer set search_path=public,private as $$
declare v_role text:=private.get_current_user_role();v_quote_id uuid;
begin
  if p_doc.company_id is distinct from private.get_current_user_company_id() or p_doc.approval_status is distinct from 'approved'
    or (p_doc.expiry_date is not null and p_doc.expiry_date<private.ist_today()) then return false; end if;
  if v_role not in ('owner','admin') and p_doc.document_type not in ('die_drawing','profile_drawing','material_test_certificate','quality_inspection_report','customer_approval_document','technical_data_sheet','compliance_certificate') then return false; end if;
  if p_doc.linked_entity_type='quote' and v_role not in ('owner','admin','sales','sales_manager','accounts','viewer') then return false; end if;
  if p_kind='quote' then v_quote_id:=p_id;
  else select quote_id into v_quote_id from public.orders where id=p_id and company_id=p_doc.company_id; end if;
  if p_doc.linked_entity_type='quote' and p_doc.linked_entity_id=v_quote_id then return true; end if;
  if p_doc.linked_entity_type='order' and p_kind='order' and p_doc.linked_entity_id=p_id then return true; end if;
  if p_doc.linked_entity_type not in ('profile','die') then return false; end if;
  if p_kind='quote' then return exists(select 1 from public.quote_items where company_id=p_doc.company_id and quote_id=p_id
    and ((p_doc.linked_entity_type='profile' and profile_id=p_doc.linked_entity_id) or (p_doc.linked_entity_type='die' and die_id=p_doc.linked_entity_id)));
  else return exists(select 1 from public.order_items where company_id=p_doc.company_id and order_id=p_id
    and ((p_doc.linked_entity_type='profile' and profile_id=p_doc.linked_entity_id) or (p_doc.linked_entity_type='die' and die_id=p_doc.linked_entity_id))); end if;
end;
$$;
revoke all on function private.linkable_document(public.technical_documents,text,uuid) from public,anon,authenticated;

create function public.linked_document_command(p_command text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,private as $$
declare v_company uuid;v_kind text:=p_payload->>'entity_type';v_id uuid:=(p_payload->>'entity_id')::uuid;v_doc public.technical_documents%rowtype;
  v_link public.record_document_links%rowtype;v_page integer:=coalesce((p_payload->>'page')::integer,1);v_search text:=coalesce(p_payload->>'search','');v_rows jsonb;v_path text;
begin
  v_company:=private.commercial_actor(array['owner','admin','sales','sales_manager','accounts','viewer','production_manager','production','factory_manager','quality','inventory_manager','dispatch_manager','dispatch']);
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or p_payload-array['entity_type','entity_id','document_id','id','purpose','page','search']<>'{}'
    or v_page<1 or v_page>10000 or length(v_search)>80 then raise exception 'Invalid document link request'; end if;
  perform private.linked_document_target(v_company,v_kind,v_id);
  if p_command='document.candidates' then
    perform private.commercial_actor(array['owner','admin']);
    select coalesce(jsonb_agg(to_jsonb(d)),'[]') into v_rows from (
      select id,file_name,document_type,version_number from public.technical_documents doc where company_id=v_company
      and strpos(lower(file_name),lower(v_search))>0 and private.linkable_document(doc,v_kind,v_id)
      order by file_name,id offset((v_page-1)*10) limit 10)d;
    return jsonb_build_object('items',v_rows,'page',v_page);
  elsif p_command='document.list' then
    select coalesce(jsonb_agg(to_jsonb(d)),'[]') into v_rows from (
      select l.id,l.document_id,l.purpose,l.document_version,doc.file_name,doc.document_type,
        private.linkable_document(doc,v_kind,v_id) and coalesce(doc.version_number,1)=l.document_version as accessible
      from public.record_document_links l join public.technical_documents doc on doc.id=l.document_id and doc.company_id=l.company_id
      where l.company_id=v_company and l.entity_type=v_kind and l.entity_id=v_id
        and (doc.linked_entity_type<>'quote' or private.get_current_user_role() in ('owner','admin','sales','sales_manager','accounts','viewer'))
        and (private.get_current_user_role() in ('owner','admin') or doc.document_type in ('die_drawing','profile_drawing','material_test_certificate','quality_inspection_report','customer_approval_document','technical_data_sheet','compliance_certificate'))
      order by l.created_at desc,l.id offset((v_page-1)*10) limit 10)d;
    return jsonb_build_object('items',v_rows,'page',v_page);
  elsif p_command not in ('document.link','document.open') then raise exception 'Invalid document link request'; end if;
  if p_command='document.link' then
    perform private.commercial_actor(array['owner','admin']);
    select * into v_link from public.record_document_links where id=(p_payload->>'id')::uuid and company_id=v_company;
    if found then
      if v_link.entity_type<>v_kind or v_link.entity_id<>v_id or v_link.document_id::text is distinct from p_payload->>'document_id' or v_link.purpose is distinct from btrim(p_payload->>'purpose') then raise exception 'That request identity was used for different details'; end if;
      return jsonb_build_object('id',v_link.id);
    end if;
  end if;
  select * into v_doc from public.technical_documents where company_id=v_company and id=(p_payload->>'document_id')::uuid for share;
  if not found or not private.linkable_document(v_doc,v_kind,v_id) then raise exception 'The approved source document is unavailable for this record and role'; end if;
  if p_command='document.link' then
    perform private.commercial_actor(array['owner','admin']);
    if length(btrim(coalesce(p_payload->>'purpose','')))<3 or length(p_payload->>'purpose')>300 or nullif(p_payload->>'id','') is null then raise exception 'Record a document purpose of 3 to 300 characters'; end if;
    insert into public.record_document_links(id,company_id,entity_type,entity_id,document_id,document_version,purpose,linked_by)
      values((p_payload->>'id')::uuid,v_company,v_kind,v_id,v_doc.id,coalesce(v_doc.version_number,1),btrim(p_payload->>'purpose'),auth.uid()) on conflict(company_id,entity_type,entity_id,document_id,document_version) do nothing;
    select id into v_link.id from public.record_document_links where company_id=v_company and entity_type=v_kind and entity_id=v_id and document_id=v_doc.id and document_version=coalesce(v_doc.version_number,1);
    return jsonb_build_object('id',v_link.id);
  end if;
  if not exists(select 1 from public.record_document_links where company_id=v_company and entity_type=v_kind and entity_id=v_id and document_id=v_doc.id and document_version=coalesce(v_doc.version_number,1)) then raise exception 'This document revision is not linked to the record'; end if;
  v_path:=coalesce(nullif(v_doc.storage_path,''),v_doc.file_url);
  if coalesce(v_doc.storage_bucket,'documents')<>'documents' or split_part(v_path,'/',1)<>v_company::text or v_path~'(^|/)\.\.(/|$)|://' then raise exception 'The document storage reference is unavailable'; end if;
  return jsonb_build_object('bucket','documents','path',v_path,'file_name',v_doc.file_name);
end;
$$;
revoke all on function public.linked_document_command(text,jsonb) from public,anon;
grant execute on function public.linked_document_command(text,jsonb) to authenticated;
commit;

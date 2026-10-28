-- EOS 81: reviewed draft party details and immutable issued-version snapshots.
begin;
create table public.quote_party_drafts (
  quote_id uuid primary key references public.quotes(id), company_id uuid not null references public.companies(id),
  project_id uuid references public.customer_projects(id), overrides jsonb not null, source_fingerprint text not null,
  snapshot jsonb not null, updated_by uuid not null references public.app_users(id), updated_at timestamptz not null default now()
);
create index quote_party_drafts_company_idx on public.quote_party_drafts(company_id,quote_id);
create index quote_party_drafts_project_idx on public.quote_party_drafts(project_id);
create index quote_party_drafts_actor_idx on public.quote_party_drafts(updated_by);
create table public.quote_party_snapshots (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  quote_id uuid not null references public.quotes(id), revision_number integer not null, snapshot jsonb not null,
  recorded_by uuid references public.app_users(id), recorded_at timestamptz not null default now(),
  unique(company_id,quote_id,revision_number)
);
create index quote_party_snapshots_quote_idx on public.quote_party_snapshots(quote_id);
create index quote_party_snapshots_actor_idx on public.quote_party_snapshots(recorded_by);
alter table public.quote_party_drafts enable row level security;
alter table public.quote_party_snapshots enable row level security;
revoke all on public.quote_party_drafts,public.quote_party_snapshots from public,anon,authenticated;
create trigger keep_quote_party_snapshots before update or delete on public.quote_party_snapshots
for each row execute function private.keep_commercial_history();

create function private.quote_party_population(p_quote public.quotes,p_project uuid,p_overrides jsonb) returns jsonb
language plpgsql security definer set search_path=public,private as $$
declare v_customer public.customers%rowtype; v_project public.customer_projects%rowtype; v_party jsonb; v_source text;
begin
  select * into v_customer from public.customers where id=p_quote.customer_id and company_id=p_quote.company_id for share;
  if not found or not v_customer.is_active then raise exception 'Choose an active customer'; end if;
  if p_project is not null then
    select * into v_project from public.customer_projects where id=p_project and company_id=p_quote.company_id and customer_id=p_quote.customer_id for share;
    if not found or v_project.status<>'active' then raise exception 'Choose an active site for this customer'; end if;
  end if;
  if jsonb_typeof(p_overrides)<>'object' or p_overrides - array['delivery_address','payment_terms','contact_name','contact_phone','instructions'] <> '{}'::jsonb
    or exists(select 1 from jsonb_each(p_overrides) where jsonb_typeof(value)<>'string' or length(value#>>'{}')>1000) then
    raise exception 'Invalid party overrides';
  end if;
  v_party := jsonb_build_object('customer_id',v_customer.id,'customer_name',coalesce(nullif(v_customer.company_name,''),v_customer.customer_name),
    'gst_number',v_customer.gst_number,'billing_address',v_customer.billing_address,
    'delivery_address',coalesce(nullif(v_project.site_address,''),v_customer.shipping_address,v_customer.billing_address),
    'payment_terms',coalesce(nullif(p_quote.payment_terms,''),v_customer.payment_terms),
    'contact_name',coalesce(nullif(v_project.contact_name,''),v_customer.contact_person),
    'contact_phone',coalesce(nullif(v_project.contact_phone,''),v_customer.phone),
    'site_name',v_project.site_name,'project_id',p_project,'instructions',null,
    'precedence','Transaction override, selected site, customer master; quote payment terms precede customer terms') || p_overrides;
  v_source := md5(jsonb_build_object('customer',to_jsonb(v_customer),'project',to_jsonb(v_project),'quote_payment_terms',p_quote.payment_terms)::text);
  return jsonb_build_object('party',v_party,'source_fingerprint',v_source);
end;
$$;
revoke all on function private.quote_party_population(public.quotes,uuid,jsonb) from public,anon,authenticated;

create function private.capture_quote_party_issue() returns trigger
language plpgsql security definer set search_path=public,private as $$
declare v_draft public.quote_party_drafts%rowtype; v_preview jsonb;
begin
  if new.status='approved_for_sending' and old.status in ('draft','internal_review') then
    if exists(select 1 from public.quote_party_snapshots where company_id=new.company_id and quote_id=new.id and revision_number=new.revision_number) then return new; end if;
    select * into v_draft from public.quote_party_drafts where quote_id=new.id and company_id=new.company_id;
    v_preview := private.quote_party_population(new,v_draft.project_id,coalesce(v_draft.overrides,'{}'));
    if v_draft.quote_id is not null and v_draft.source_fingerprint is distinct from v_preview->>'source_fingerprint' then
      raise exception 'Party or site details changed. Review before issue';
    end if;
    insert into public.quote_party_snapshots(company_id,quote_id,revision_number,snapshot,recorded_by)
      values(new.company_id,new.id,new.revision_number,v_preview->'party',auth.uid()) on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.capture_quote_party_issue() from public,anon,authenticated;
create trigger z_capture_quote_party_issue before update of status on public.quotes
for each row execute function private.capture_quote_party_issue();

create function public.quote_party_command(p_command text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,private as $$
declare v_company uuid; v_quote public.quotes%rowtype; v_draft public.quote_party_drafts%rowtype;
  v_preview jsonb; v_snapshot jsonb; v_project uuid; v_overrides jsonb; v_rows jsonb; v_page integer; v_search text;
begin
  v_company:=private.commercial_actor(array['owner','admin','sales','sales_manager','accounts']);
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or p_payload - array['quote_id','project_id','overrides','source_fingerprint','quote_fingerprint','page','search']<>'{}' then raise exception 'Invalid party request'; end if;
  if p_command not in ('party.load','party.preview','party.save','sites.list') then raise exception 'Invalid party request'; end if;
  if p_command='party.save' then perform private.commercial_actor(array['owner','admin']); end if;
  select * into v_quote from public.quotes where id=(p_payload->>'quote_id')::uuid and company_id=v_company for update;
  if not found then raise exception 'Quotation is unavailable'; end if;
  if p_command='sites.list' then
    v_page:=coalesce((p_payload->>'page')::integer,1);v_search:=coalesce(p_payload->>'search','');
    if v_page<1 or v_page>10000 or length(v_search)>80 then raise exception 'Invalid site search'; end if;
    select coalesce(jsonb_agg(to_jsonb(s)),'[]') into v_rows from (
      select id,name,site_name,site_address from public.customer_projects where company_id=v_company and customer_id=v_quote.customer_id and status='active'
      and (v_search='' or strpos(lower(name||' '||coalesce(site_name,'')),lower(v_search))>0)
      order by name,id offset ((v_page-1)*10) limit 10) s;
    return jsonb_build_object('items',v_rows,'page',v_page);
  end if;
  select snapshot into v_snapshot from public.quote_party_snapshots where company_id=v_company and quote_id=v_quote.id and revision_number=v_quote.revision_number;
  if v_snapshot is not null or v_quote.status not in ('draft','internal_review') then
    if p_command='party.save' then raise exception 'Issued party details are immutable. Create a quotation revision'; end if;
    return jsonb_build_object('party',v_snapshot,'immutable',true,'captured',v_snapshot is not null,'quote_fingerprint',private.commercial_quote_fingerprint(v_quote));
  end if;
  select * into v_draft from public.quote_party_drafts where quote_id=v_quote.id and company_id=v_company;
  v_project:=case when p_payload ? 'project_id' then nullif(p_payload->>'project_id','')::uuid else v_draft.project_id end;
  v_overrides:=coalesce(p_payload->'overrides',v_draft.overrides,'{}');
  v_preview:=private.quote_party_population(v_quote,v_project,v_overrides);
  if p_command='party.save' then
    if p_payload->>'quote_fingerprint' is distinct from private.commercial_quote_fingerprint(v_quote)
      or p_payload->>'source_fingerprint' is distinct from v_preview->>'source_fingerprint' then raise exception 'Party or quotation sources changed. Refresh the preview'; end if;
    insert into public.quote_party_drafts(quote_id,company_id,project_id,overrides,source_fingerprint,snapshot,updated_by)
      values(v_quote.id,v_company,v_project,v_overrides,v_preview->>'source_fingerprint',v_preview->'party',auth.uid())
      on conflict(quote_id) do update set project_id=excluded.project_id,overrides=excluded.overrides,source_fingerprint=excluded.source_fingerprint,
        snapshot=excluded.snapshot,updated_by=excluded.updated_by,updated_at=clock_timestamp();
    update public.quotes set updated_at=clock_timestamp() where id=v_quote.id returning * into v_quote;
  end if;
  return v_preview||jsonb_build_object('immutable',false,'captured',true,'project_id',v_project,'overrides',v_overrides,'quote_fingerprint',private.commercial_quote_fingerprint(v_quote));
end;
$$;
revoke all on function public.quote_party_command(text,jsonb) from public,anon;
grant execute on function public.quote_party_command(text,jsonb) to authenticated;
commit;

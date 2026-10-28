-- EOS 81/87: capture every quote-backed conversion, including existing dealer/factory paths.
begin;
create table public.order_quote_snapshots (
  order_id uuid primary key references public.orders(id),company_id uuid not null references public.companies(id),
  quote_id uuid not null references public.quotes(id),revision_number integer not null,quote_snapshot jsonb not null,
  line_snapshots jsonb not null,party_snapshot jsonb,recorded_by uuid references public.app_users(id),recorded_at timestamptz not null default now()
);
create index order_quote_snapshots_company_idx on public.order_quote_snapshots(company_id,quote_id);
create index order_quote_snapshots_quote_idx on public.order_quote_snapshots(quote_id);
create index order_quote_snapshots_actor_idx on public.order_quote_snapshots(recorded_by);
alter table public.order_quote_snapshots enable row level security;
revoke all on public.order_quote_snapshots from public,anon,authenticated;
create trigger keep_order_quote_snapshots before update or delete on public.order_quote_snapshots for each row execute function private.keep_commercial_history();
create function private.capture_accepted_order_source() returns trigger
language plpgsql security definer set search_path=public,private as $$
declare v_quote public.quotes%rowtype;
begin
  if new.quote_id is null then return new; end if;
  select * into v_quote from public.quotes where company_id=new.company_id and id=new.quote_id for update;
  if not found or v_quote.customer_id is distinct from new.customer_id or v_quote.status<>'customer_approved' then raise exception 'An accepted quotation for this customer is required'; end if;
  insert into public.order_quote_snapshots(order_id,company_id,quote_id,revision_number,quote_snapshot,line_snapshots,party_snapshot,recorded_by)
    values(new.id,new.company_id,v_quote.id,v_quote.revision_number,to_jsonb(v_quote),
      coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from public.quote_items i where i.company_id=new.company_id and i.quote_id=v_quote.id),'[]'),
      (select snapshot from public.quote_party_snapshots where company_id=new.company_id and quote_id=v_quote.id and revision_number=v_quote.revision_number),auth.uid());
  return new;
end;
$$;
revoke all on function private.capture_accepted_order_source() from public,anon,authenticated;
create trigger capture_accepted_order_source after insert on public.orders for each row execute function private.capture_accepted_order_source();

create function private.apply_accepted_invoice_party() returns trigger
language plpgsql security definer set search_path=public,private as $$
declare v_source public.order_quote_snapshots%rowtype;
begin
  select * into v_source from public.order_quote_snapshots where company_id=new.company_id and order_id=new.order_id;
  if found and v_source.party_snapshot is not null then
    if (v_source.quote_snapshot->>'customer_id')::uuid is distinct from new.customer_id then raise exception 'Invoice customer differs from its accepted order source'; end if;
    new.customer_snapshot:=new.customer_snapshot||jsonb_build_object(
      'customer_name',v_source.party_snapshot->'customer_name','company_name',v_source.party_snapshot->'customer_name',
      'gst_number',v_source.party_snapshot->'gst_number','billing_address',v_source.party_snapshot->'billing_address',
      'shipping_address',v_source.party_snapshot->'delivery_address','contact_name',v_source.party_snapshot->'contact_name',
      'contact_phone',v_source.party_snapshot->'contact_phone','source_quote_id',v_source.quote_id,'source_quote_revision',v_source.revision_number,
      'site_name',v_source.party_snapshot->'site_name','payment_terms',v_source.party_snapshot->'payment_terms','instructions',v_source.party_snapshot->'instructions');
  end if;
  return new;
end;
$$;
revoke all on function private.apply_accepted_invoice_party() from public,anon,authenticated;
create trigger zzzzz_apply_accepted_invoice_party before insert on public.invoices for each row execute function private.apply_accepted_invoice_party();

create function public.create_order_from_quote_with_dealer_workflow_atomic(
  p_quote_id uuid,p_order_number text,p_order_date date,p_expected_dispatch_date date,p_priority text,
  p_dealer_fulfilled_weight_kg numeric,p_notes text,p_minimum_handling text,p_override_reason text,
  p_expected_revision integer,p_expected_updated_at timestamptz
) returns uuid language plpgsql security definer set search_path=public,private as $$
declare v_company uuid:=private.get_current_user_company_id();v_quote public.quotes%rowtype;v_existing public.order_quote_snapshots%rowtype;
begin
  if not exists(select 1 from public.app_users where id=auth.uid() and company_id=v_company and is_active
    and role::text in ('owner','admin','sales','sales_manager','dealer_admin','dealer_staff')) then raise exception 'Quotation conversion is not permitted' using errcode='42501'; end if;
  select * into v_quote from public.quotes where company_id=v_company and id=p_quote_id for update;
  if not found then raise exception 'Quotation is unavailable'; end if;
  if private.get_current_user_role() in ('dealer_admin','dealer_staff') and (private.get_current_user_dealer_id() is null or v_quote.dealer_id is distinct from private.get_current_user_dealer_id()) then
    raise exception 'Quotation conversion is not permitted' using errcode='42501'; end if;
  select * into v_existing from public.order_quote_snapshots where company_id=v_company and quote_id=p_quote_id order by recorded_at,order_id limit 1;
  if found and v_existing.revision_number=p_expected_revision and (v_existing.quote_snapshot->>'updated_at')::timestamptz=p_expected_updated_at then return v_existing.order_id; end if;
  if p_expected_revision is null or p_expected_updated_at is null or p_expected_revision<>v_quote.revision_number or p_expected_updated_at is distinct from v_quote.updated_at then
    raise exception 'The quotation changed. Reload and review its current revision before creating an order' using errcode='40001';
  end if;
  return private.create_order_from_quote_with_dealer_workflow_atomic(p_quote_id,p_order_number,p_order_date,p_expected_dispatch_date,p_priority,p_dealer_fulfilled_weight_kg,p_notes,p_minimum_handling,p_override_reason);
end;
$$;
revoke all on function public.create_order_from_quote_with_dealer_workflow_atomic(uuid,text,date,date,text,numeric,text,text,text,integer,timestamptz) from public,anon;
grant execute on function public.create_order_from_quote_with_dealer_workflow_atomic(uuid,text,date,date,text,numeric,text,text,text,integer,timestamptz) to authenticated;
commit;

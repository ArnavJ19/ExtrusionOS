-- EOS 7: reuse accepted order details; freeze dispatch party history at issue.
begin;
create table public.dispatch_party_snapshots (
  dispatch_id uuid primary key references public.dispatches(id), company_id uuid not null references public.companies(id),
  order_id uuid not null references public.orders(id), party jsonb not null, basis text not null,
  recorded_by uuid references public.app_users(id), recorded_at timestamptz not null default now()
);
create index dispatch_party_company_order_idx on public.dispatch_party_snapshots(company_id,order_id);
create index dispatch_party_actor_idx on public.dispatch_party_snapshots(recorded_by);
alter table public.dispatch_party_snapshots enable row level security;
revoke all on public.dispatch_party_snapshots from public,anon,authenticated;
create trigger keep_dispatch_party_snapshots before update or delete on public.dispatch_party_snapshots
for each row execute function private.keep_commercial_history();

create function private.downstream_order_party(p_company uuid,p_order uuid) returns jsonb
language plpgsql stable security definer set search_path=public,private as $$
declare v_order public.orders%rowtype;v_party jsonb;v_customer public.customers%rowtype;v_basis text;
begin
  select * into v_order from public.orders where company_id=p_company and id=p_order and deleted_at is null;
  if not found then raise exception 'Order is unavailable'; end if;
  select party_snapshot into v_party from public.order_quote_snapshots where company_id=p_company and order_id=p_order;
  if v_party is not null then v_basis:='Accepted order party snapshot';
  else
    select * into v_customer from public.customers where company_id=p_company and id=v_order.customer_id;
    if not found then raise exception 'Order customer is unavailable'; end if;
    v_basis:='Current customer master; no accepted party snapshot was recorded';
    v_party:=jsonb_build_object('customer_name',coalesce(nullif(v_customer.company_name,''),v_customer.customer_name),
      'delivery_address',coalesce(nullif(v_customer.shipping_address,''),v_customer.billing_address),
      'contact_name',v_customer.contact_person,'contact_phone',v_customer.phone,'site_name',null,'instructions',null);
  end if;
  return jsonb_build_object('order_id',p_order,'order_number',v_order.order_number,'basis',v_basis,'party',
    jsonb_build_object('customer_name',v_party->'customer_name','delivery_address',v_party->'delivery_address',
      'contact_name',v_party->'contact_name','contact_phone',v_party->'contact_phone','site_name',v_party->'site_name','instructions',v_party->'instructions'));
end;
$$;
revoke all on function private.downstream_order_party(uuid,uuid) from public,anon,authenticated;
create function private.capture_dispatch_party() returns trigger
language plpgsql security definer set search_path=public,private as $$
declare v_context jsonb;
begin
  v_context:=private.downstream_order_party(new.company_id,new.order_id);
  insert into public.dispatch_party_snapshots(dispatch_id,company_id,order_id,party,basis,recorded_by)
    values(new.id,new.company_id,new.order_id,v_context->'party',v_context->>'basis',auth.uid());
  return new;
end;
$$;
revoke all on function private.capture_dispatch_party() from public,anon,authenticated;
create trigger capture_dispatch_party after insert on public.dispatches for each row execute function private.capture_dispatch_party();

create function public.downstream_dispatch_context(p_order_id uuid,p_dispatch_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public,private as $$
declare v_company uuid;v_snapshot public.dispatch_party_snapshots%rowtype;v_context jsonb;
begin
  v_company:=private.commercial_actor(array['owner','admin','sales','sales_manager','factory_manager','dispatch_manager','dispatch','inventory_manager','accounts','viewer']);
  if p_dispatch_id is not null then
    select * into v_snapshot from public.dispatch_party_snapshots where company_id=v_company and dispatch_id=p_dispatch_id and order_id=p_order_id;
    if not found then raise exception 'Recorded dispatch party is unavailable'; end if;
    select jsonb_build_object('order_id',o.id,'order_number',o.order_number,'basis',v_snapshot.basis,'party',v_snapshot.party,'immutable',true)
      into v_context from public.orders o where o.id=p_order_id and o.company_id=v_company;
    return v_context;
  end if;
  return private.downstream_order_party(v_company,p_order_id)||jsonb_build_object('immutable',false);
end;
$$;
revoke all on function public.downstream_dispatch_context(uuid,uuid) from public,anon;
grant execute on function public.downstream_dispatch_context(uuid,uuid) to authenticated;
commit;

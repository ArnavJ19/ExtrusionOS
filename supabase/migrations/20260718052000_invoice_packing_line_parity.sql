-- Invoice amounts must be a faithful projection of immutable packing rows.
-- Canonicalize financial fields in the database and lock their dispatch source.
create schema if not exists private;

create or replace function private.canonicalize_invoice_packing_line()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid;
  v_dispatch_id uuid;
  v_packing public.packing_list_items%rowtype;
  v_expected_quantity numeric(14,3);
  v_expected_rate numeric(14,2);
  v_expected_total numeric(14,2);
begin
  if tg_op = 'UPDATE' and new.invoice_id is distinct from old.invoice_id then
    raise exception 'Invoice lines cannot be moved between invoices';
  end if;

  select company_id, dispatch_id
  into v_company_id, v_dispatch_id
  from public.invoices
  where id = new.invoice_id;

  if not found or v_dispatch_id is null then
    raise exception 'Invoice lines require a dispatch-backed invoice';
  end if;
  if new.source_line_id is null then
    raise exception 'Invoice line must identify its packing row';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'invoice-packing:' || new.invoice_id::text || ':' || new.source_line_id::text,
    0
  ));

  select *
  into v_packing
  from public.packing_list_items
  where id = new.source_line_id
    and company_id = v_company_id
    and dispatch_id = v_dispatch_id;

  if not found then
    raise exception 'Invoice line does not belong to the selected dispatch packing list';
  end if;

  v_expected_quantity := round(coalesce(
    nullif(v_packing.net_weight_kg, 0),
    nullif(v_packing.gross_weight_kg, 0),
    0
  ), 3);
  v_expected_rate := round(coalesce(nullif(v_packing.net_rate, 0), 0), 2);
  v_expected_total := round(v_expected_quantity * v_expected_rate, 2);

  if v_expected_quantity <= 0 or v_expected_rate <= 0 or v_expected_total <= 0 then
    raise exception 'Every packed line needs a positive shipped weight and commercial rate before invoicing';
  end if;
  if new.quantity is null or abs(new.quantity - v_expected_quantity) > 0.001
    or new.unit_rate is null or abs(new.unit_rate - v_expected_rate) > 0.01
    or new.line_total is null or abs(new.line_total - v_expected_total) > 0.01
  then
    raise exception 'Invoice quantity, rate, and total must match the immutable packing row';
  end if;
  if exists (
    select 1
    from public.invoice_items existing
    where existing.invoice_id = new.invoice_id
      and existing.source_line_id = v_packing.id
      and existing.id is distinct from new.id
  ) then
    raise exception 'A packing row can appear only once on an invoice';
  end if;

  new.company_id := v_company_id;
  new.source_record_id := v_dispatch_id;
  new.source_line_id := v_packing.id;
  new.profile_id := v_packing.profile_id;
  new.quantity := v_expected_quantity;
  new.unit_rate := v_expected_rate;
  new.line_total := v_expected_total;
  return new;
end;
$$;

revoke all on function private.canonicalize_invoice_packing_line() from public;

drop trigger if exists canonicalize_invoice_packing_line on public.invoice_items;
create trigger canonicalize_invoice_packing_line
before insert or update on public.invoice_items
for each row execute function private.canonicalize_invoice_packing_line();

create or replace function private.assert_invoice_packing_coverage()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_invoice_id uuid;
  v_company_id uuid;
  v_dispatch_id uuid;
  v_packing_count integer;
  v_invoice_count integer;
  v_distinct_source_count integer;
begin
  if tg_op = 'DELETE' then
    v_invoice_id := old.invoice_id;
  else
    v_invoice_id := new.invoice_id;
  end if;

  select company_id, dispatch_id
  into v_company_id, v_dispatch_id
  from public.invoices
  where id = v_invoice_id;

  if not found then
    return null;
  end if;
  if v_dispatch_id is null then
    raise exception 'Invoice must remain linked to a dispatch';
  end if;

  select count(*)
  into v_packing_count
  from public.packing_list_items
  where company_id = v_company_id
    and dispatch_id = v_dispatch_id;

  select count(*), count(distinct source_line_id)
  into v_invoice_count, v_distinct_source_count
  from public.invoice_items
  where company_id = v_company_id
    and invoice_id = v_invoice_id;

  if v_packing_count = 0
    or v_invoice_count <> v_packing_count
    or v_distinct_source_count <> v_packing_count
  then
    raise exception 'Invoice must include every packing row from its dispatch exactly once';
  end if;

  return null;
end;
$$;

revoke all on function private.assert_invoice_packing_coverage() from public;

drop trigger if exists assert_invoice_packing_coverage on public.invoice_items;
create constraint trigger assert_invoice_packing_coverage
after insert or update or delete on public.invoice_items
deferrable initially deferred
for each row execute function private.assert_invoice_packing_coverage();

create or replace function private.lock_invoiced_packing_list()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid;
  v_dispatch_id uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_company_id := old.company_id;
    v_dispatch_id := old.dispatch_id;
    perform pg_advisory_xact_lock(hashtextextended(
      'dispatch-invoice:' || v_company_id::text || ':' || v_dispatch_id::text,
      0
    ));
    if exists (
      select 1
      from public.invoices i
      where i.company_id = v_company_id
        and i.dispatch_id = v_dispatch_id
        and i.status <> 'cancelled'
    ) then
      raise exception 'Packing rows are locked after an active invoice is created for the dispatch';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    v_company_id := new.company_id;
    v_dispatch_id := new.dispatch_id;
    perform pg_advisory_xact_lock(hashtextextended(
      'dispatch-invoice:' || v_company_id::text || ':' || v_dispatch_id::text,
      0
    ));
    if exists (
      select 1
      from public.invoices i
      where i.company_id = v_company_id
        and i.dispatch_id = v_dispatch_id
        and i.status <> 'cancelled'
    ) then
      raise exception 'Packing rows are locked after an active invoice is created for the dispatch';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.lock_invoiced_packing_list() from public;

drop trigger if exists lock_invoiced_packing_list on public.packing_list_items;
create trigger lock_invoiced_packing_list
before insert or update or delete on public.packing_list_items
for each row execute function private.lock_invoiced_packing_list();

create or replace function private.enforce_one_active_dispatch_invoice()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_order_id uuid;
  v_customer_id uuid;
begin
  if tg_op = 'UPDATE' and new.company_id is distinct from old.company_id then
    raise exception 'Invoice company cannot be changed after creation';
  end if;
  if tg_op = 'UPDATE'
     and (
       new.dispatch_id is distinct from old.dispatch_id
       or new.order_id is distinct from old.order_id
       or new.customer_id is distinct from old.customer_id
     )
     and exists (
       select 1 from public.invoice_items item where item.invoice_id = old.id
     ) then
    raise exception 'Invoice source cannot be changed after packing lines are created';
  end if;

  if new.dispatch_id is not null then
    select dispatch.order_id, source_order.customer_id
    into v_order_id, v_customer_id
    from public.dispatches dispatch
    join public.orders source_order
      on source_order.id = dispatch.order_id
     and source_order.company_id = dispatch.company_id
    where dispatch.id = new.dispatch_id
      and dispatch.company_id = new.company_id;
    if not found then
      raise exception 'Invoice dispatch is unavailable for this company';
    end if;
    if new.order_id is distinct from v_order_id
       or new.customer_id is distinct from v_customer_id then
      raise exception 'Invoice order and customer must match the selected dispatch';
    end if;
  end if;

  if new.dispatch_id is not null and new.status <> 'cancelled' then
    perform pg_advisory_xact_lock(hashtextextended(
      'dispatch-invoice:' || new.company_id::text || ':' || new.dispatch_id::text,
      0
    ));
  end if;

  if new.dispatch_id is not null and new.status <> 'cancelled' and exists (
    select 1
    from public.invoices existing
    where existing.company_id = new.company_id
      and existing.dispatch_id = new.dispatch_id
      and existing.status <> 'cancelled'
      and existing.id is distinct from new.id
  ) then
    raise exception 'This dispatch already has an active invoice';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_one_active_dispatch_invoice() from public;

drop trigger if exists enforce_one_active_dispatch_invoice on public.invoices;
create trigger enforce_one_active_dispatch_invoice
before insert or update on public.invoices
for each row execute function private.enforce_one_active_dispatch_invoice();

do $$
declare
  v_policy record;
begin
  for v_policy in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'packing_list_items'
  loop
    execute format('drop policy if exists %I on public.packing_list_items', v_policy.policyname);
  end loop;
end;
$$;

create policy packing_list_items_tenant_read on public.packing_list_items
for select using (company_id = public.get_current_user_company_id());

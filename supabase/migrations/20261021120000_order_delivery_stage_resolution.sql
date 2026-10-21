-- EXOS-AUD-018: an order's delivery stage got stuck at 'dispatched'.
--   * 'returned' and 'damaged' shipments counted as open forever, so an order
--     never reached 'delivered' even after a replacement shipment was delivered.
--     They are now treated as closed exceptions: not open, and not delivered.
--   * Delivery needed delivered kg >= the planned maximum with no tolerance, so a
--     normal production shortfall (980 kg against a 1,000 kg plan) never closed.
--     A company tolerance (company_settings.delivery_completion_tolerance_percent,
--     default 0 = previous behaviour, max 10) and an audited short-close action
--     (public.short_close_order_delivery_atomic) are added.
-- A short-close is recorded in public.order_delivery_short_closures, which has no
-- client write grants; only the SECURITY DEFINER RPC writes it.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.company_settings
  add column if not exists delivery_completion_tolerance_percent numeric(5,2) not null default 0;
alter table public.company_settings drop constraint if exists company_settings_delivery_tolerance_range;
alter table public.company_settings add constraint company_settings_delivery_tolerance_range
  check (delivery_completion_tolerance_percent >= 0 and delivery_completion_tolerance_percent <= 10);

create table if not exists public.order_delivery_short_closures (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  delivered_weight_kg numeric(14,3) not null,
  required_weight_kg numeric(14,3) not null,
  reason text not null check (length(btrim(reason)) >= 10),
  closed_by uuid not null references auth.users(id),
  closed_by_role text not null,
  closed_at timestamptz not null default now(),
  unique (company_id, order_id)
);
create index if not exists order_delivery_short_closures_company_order_idx on public.order_delivery_short_closures(company_id, order_id);
alter table public.order_delivery_short_closures enable row level security;
drop policy if exists "order delivery short closures tenant read" on public.order_delivery_short_closures;
create policy "order delivery short closures tenant read" on public.order_delivery_short_closures
  for select using (company_id = public.get_current_user_company_id());
revoke all on public.order_delivery_short_closures from public, anon, authenticated;
grant select on public.order_delivery_short_closures to authenticated;

CREATE OR REPLACE FUNCTION private.sync_order_delivery_stage(p_company_id uuid, p_order_id uuid, p_remarks text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_current_stage text;
  v_required_kg numeric := 0;
  v_order_kg numeric := 0;
  v_line_kg numeric := 0;
  v_factory_kg numeric := 0;
  v_stock_kg numeric := 0;
  v_delivered_kg numeric := 0;
  v_dispatch_count integer := 0;
  v_open_count integer := 0;
  v_next_stage text;
  v_tolerance_percent numeric := 0;
  v_short_closed boolean := false;
begin
  select current_stage, coalesce(production_quantity_kg, 0)
  into v_current_stage, v_order_kg
  from public.orders
  where id = p_order_id and company_id = p_company_id
  for update;
  if not found or v_current_stage in ('cancelled','closed','payment_pending') then
    return;
  end if;

  select coalesce(sum(coalesce(quantity_kg, 0)), 0)
  into v_line_kg
  from public.order_items
  where company_id = p_company_id and order_id = p_order_id;

  select coalesce(sum(coalesce(planned_quantity_kg, 0)), 0)
  into v_factory_kg
  from public.production_jobs
  where company_id = p_company_id
    and order_id = p_order_id
    and status <> 'cancelled';

  select coalesce(sum(fulfilled_weight_kg), 0)
  into v_stock_kg
  from public.order_dealer_stock_fulfillments
  where company_id = p_company_id
    and order_id = p_order_id
    and credited_at is null;

  v_required_kg := greatest(v_order_kg, v_line_kg, v_factory_kg + v_stock_kg);

  select coalesce(settings.delivery_completion_tolerance_percent, 0) into v_tolerance_percent
  from public.company_settings settings where settings.company_id = p_company_id;
  v_tolerance_percent := coalesce(v_tolerance_percent, 0);
  select exists (select 1 from public.order_delivery_short_closures closure
    where closure.company_id = p_company_id and closure.order_id = p_order_id) into v_short_closed;

  select
    count(*) filter (where delivery_status <> 'pending'),
    count(*) filter (where delivery_status in ('dispatched', 'in_transit', 'delayed')),
    coalesce(sum(total_weight_kg) filter (where delivery_status = 'delivered'), 0)
  into v_dispatch_count, v_open_count, v_delivered_kg
  from public.dispatches
  where company_id = p_company_id and order_id = p_order_id;

  if v_dispatch_count = 0 then return; end if;
  if v_open_count = 0 and v_delivered_kg > 0 and (v_short_closed
     or (v_required_kg > 0 and v_delivered_kg + 0.01 >= v_required_kg * (1 - v_tolerance_percent / 100.0))) then
    v_next_stage := 'delivered';
  else
    v_next_stage := 'dispatched';
  end if;
  if v_current_stage = v_next_stage then return; end if;

  update public.orders
  set current_stage = v_next_stage, updated_at = now()
  where id = p_order_id and company_id = p_company_id;
  insert into public.order_stage_history(company_id, order_id, stage, changed_by, remarks)
  values (p_company_id, p_order_id, v_next_stage, auth.uid(), p_remarks);
end;
$function$;

create or replace function private.short_close_order_delivery_atomic(p_order_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_stage text;
  v_open integer;
  v_delivered_kg numeric;
  v_required_kg numeric;
  v_id uuid;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if v_role not in ('owner','admin','sales_manager','factory_manager','dispatch_manager') then
    raise exception 'Permission denied to short-close order delivery' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Give a short-close reason of at least 10 characters' using errcode = '23514';
  end if;
  select o.current_stage, greatest(coalesce(o.production_quantity_kg, 0),
      (select coalesce(sum(coalesce(i.quantity_kg, 0)), 0) from public.order_items i where i.company_id = v_company_id and i.order_id = p_order_id))
    into v_stage, v_required_kg
  from public.orders o where o.id = p_order_id and o.company_id = v_company_id for update of o;
  if not found then raise exception 'Order not found for this company' using errcode = '23514'; end if;
  if v_stage <> 'dispatched' then
    raise exception 'Only a dispatched order can be short-closed (current stage: %)', v_stage using errcode = '23514';
  end if;
  select count(*) filter (where delivery_status in ('dispatched','in_transit','delayed')),
         coalesce(sum(total_weight_kg) filter (where delivery_status = 'delivered'), 0)
    into v_open, v_delivered_kg
  from public.dispatches where company_id = v_company_id and order_id = p_order_id;
  if v_open > 0 then raise exception 'Close or deliver the % shipment(s) still in transit before short-closing', v_open using errcode = '23514'; end if;
  if v_delivered_kg <= 0 then raise exception 'An order with no delivered shipment cannot be short-closed' using errcode = '23514'; end if;

  insert into public.order_delivery_short_closures(company_id, order_id, delivered_weight_kg, required_weight_kg, reason, closed_by, closed_by_role)
  values (v_company_id, p_order_id, v_delivered_kg, v_required_kg, btrim(p_reason), auth.uid(), v_role)
  returning id into v_id;
  perform private.sync_order_delivery_stage(v_company_id, p_order_id,
    concat('Delivery short-closed at ', v_delivered_kg, ' kg: ', btrim(p_reason)));
  return v_id;
end;
$$;
revoke all on function private.short_close_order_delivery_atomic(uuid, text) from public, anon, authenticated;

create or replace function public.short_close_order_delivery_atomic(p_order_id uuid, p_reason text)
returns uuid
language sql
security definer
set search_path = public, private
as $$ select private.short_close_order_delivery_atomic(p_order_id, p_reason) $$;
revoke all on function public.short_close_order_delivery_atomic(uuid, text) from public, anon;
grant execute on function public.short_close_order_delivery_atomic(uuid, text) to authenticated;

commit;

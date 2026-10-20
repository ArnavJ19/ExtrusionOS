-- EXOS-AUD-010: reserved-stock packing rows took order_item_id, quote_item_id and
-- net_rate from the client. The app's builder sent nulls, so the GST
-- canonicalizer rejected every reserved-stock shipment, while a direct RPC call
-- could price a reservation from another order's line at any rate (and that
-- rate flows unchanged onto the tax invoice).
--
-- Reservation rows now derive their commercial lineage server-side, exactly like
-- production and dealer-stock rows: the reservation's own order line for the
-- reserved profile (disambiguated by the stock batch finish), or the order's
-- quote line when a legacy order has no lines. Client-supplied lineage and rate
-- are overwritten; an ambiguous or missing source is rejected.
-- The production and dealer-stock branches are unchanged.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function private.canonicalize_packing_commercial_lineage()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid;
  v_order_id uuid;
  v_order_item_id uuid;
  v_quote_item_id uuid;
  v_profile_id uuid;
  v_finish text;
  v_rate numeric(14,2);
  v_is_dealer_source boolean := false;
  v_batch_finish text;
  v_quote_id uuid;
  v_matches integer;
  v_finish_matches integer;
begin
  select company_id, order_id into v_company_id, v_order_id
  from public.dispatches where id = new.dispatch_id;
  if not found then raise exception 'Packing dispatch is unavailable'; end if;

  if new.source_kind = 'reservation' then
    select reservation.profile_id,
      regexp_replace(lower(btrim(coalesce(batch.finish, 'mill_finish'))), '[^a-z0-9]+', '_', 'g')
    into v_profile_id, v_batch_finish
    from public.profile_stock_reservations reservation
    join public.profile_stock_batches batch
      on batch.id = reservation.profile_stock_batch_id and batch.company_id = reservation.company_id
    where reservation.id = new.reservation_id
      and reservation.company_id = v_company_id
      and reservation.order_id = v_order_id
      and reservation.profile_stock_batch_id = new.profile_stock_batch_id;
    if not found
       or new.source_line_id is distinct from new.reservation_id
       or new.source_record_id is distinct from v_order_id
       or new.profile_id is distinct from v_profile_id then
      raise exception 'Reserved-stock packing source does not match its order, profile, reservation, and stock batch';
    end if;

    -- The reservation's own order line for this profile; the batch finish breaks ties.
    select count(*),
      count(*) filter (where regexp_replace(lower(btrim(coalesce(item.finishing_type, 'mill_finish'))), '[^a-z0-9]+', '_', 'g') = v_batch_finish)
    into v_matches, v_finish_matches
    from public.order_items item
    where item.company_id = v_company_id and item.order_id = v_order_id and item.profile_id = v_profile_id;

    if v_matches > 1 and v_finish_matches <> 1 then
      raise exception 'Reserved stock matches more than one order line for this profile and finish; record the reservation against one line'
        using errcode = '23514';
    end if;

    if v_matches >= 1 then
      select item.id, coalesce(item.quote_item_id, quote_item.id), coalesce(item.finishing_type, quote_item.finishing_type),
        coalesce(item.net_rate, quote_item.net_rate, quote_item.price_per_kg)
      into v_order_item_id, v_quote_item_id, v_finish, v_rate
      from public.order_items item
      left join public.quote_items quote_item
        on quote_item.id = item.quote_item_id and quote_item.company_id = item.company_id
      where item.company_id = v_company_id and item.order_id = v_order_id and item.profile_id = v_profile_id
        and (v_matches = 1
          or regexp_replace(lower(btrim(coalesce(item.finishing_type, 'mill_finish'))), '[^a-z0-9]+', '_', 'g') = v_batch_finish);
    else
      -- Legacy quote-backed orders without order lines.
      select quote_id into v_quote_id from public.orders where id = v_order_id and company_id = v_company_id;
      select count(*) into v_matches
      from public.quote_items quote_item
      where quote_item.company_id = v_company_id and quote_item.quote_id = v_quote_id and quote_item.profile_id = v_profile_id;
      if v_matches = 1 then
        select quote_item.id, quote_item.finishing_type, coalesce(quote_item.net_rate, quote_item.price_per_kg)
        into v_quote_item_id, v_finish, v_rate
        from public.quote_items quote_item
        where quote_item.company_id = v_company_id and quote_item.quote_id = v_quote_id and quote_item.profile_id = v_profile_id;
      else
        raise exception 'Reserved stock needs exactly one order or quote line for its profile before it can be packed'
          using errcode = '23514';
      end if;
    end if;

    if coalesce(v_rate, 0) <= 0 then
      raise exception 'The reserved stock order line has no commercial rate' using errcode = '23514';
    end if;

    new.company_id := v_company_id;
    new.order_item_id := v_order_item_id;
    new.quote_item_id := v_quote_item_id;
    new.finishing_type := coalesce(nullif(btrim(v_finish), ''), new.finishing_type);
    new.net_rate := v_rate;
    return new;
  end if;

  select
    fulfillment.order_item_id,
    fulfillment.quote_item_id,
    fulfillment.profile_id,
    fulfillment.finishing_type,
    fulfillment.unit_rate
  into v_order_item_id, v_quote_item_id, v_profile_id, v_finish, v_rate
  from public.order_dealer_stock_fulfillments fulfillment
  where fulfillment.id = new.source_line_id
    and fulfillment.company_id = v_company_id
    and fulfillment.order_id = v_order_id;
  v_is_dealer_source := found;

  if not v_is_dealer_source then
    select
      order_item.id,
      coalesce(order_item.quote_item_id, quote_item.id),
      production.profile_id,
      coalesce(order_item.finishing_type, quote_item.finishing_type, production.finishing_type),
      coalesce(order_item.net_rate, quote_item.net_rate, quote_item.price_per_kg)
    into v_order_item_id, v_quote_item_id, v_profile_id, v_finish, v_rate
    from public.production_jobs production
    left join public.order_items order_item
      on order_item.id = production.source_line_id
     and order_item.company_id = production.company_id
     and order_item.order_id = production.order_id
    left join public.quote_items quote_item
      on quote_item.company_id = production.company_id
     and quote_item.id = coalesce(order_item.quote_item_id, production.source_line_id)
    where production.id = new.source_line_id
      and production.company_id = v_company_id
      and production.order_id = v_order_id;
    if not found then raise exception 'Packing source is unavailable for this order'; end if;
  end if;

  if new.source_record_id is distinct from v_order_id
     or new.profile_id is distinct from v_profile_id then
    raise exception 'Packing source does not match its order and profile';
  end if;
  if v_is_dealer_source and (
    v_order_item_id is null or v_quote_item_id is null
    or coalesce(nullif(btrim(v_finish), ''), '') = ''
    or coalesce(v_rate, 0) <= 0
  ) then
    raise exception 'Dealer-stock packing requires exact quote, order, finish, and rate lineage';
  end if;

  new.company_id := v_company_id;
  new.order_item_id := v_order_item_id;
  new.quote_item_id := v_quote_item_id;
  new.finishing_type := v_finish;
  new.net_rate := v_rate;
  return new;
end;
$$;

revoke all on function private.canonicalize_packing_commercial_lineage() from public, anon, authenticated;
commit;

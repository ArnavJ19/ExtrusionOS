-- Preserve exact posted consumption retries after a remaining reservation hold is released.
begin;

create or replace function private.consume_dispatch_reservations(p_dispatch_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_dispatch record;
  v_group record;
  v_reservation record;
  v_batch record;
  v_used record;
  v_existing public.profile_stock_consumptions%rowtype;
  v_remaining_weight numeric;
  v_remaining_length numeric;
  v_remaining_pieces integer;
begin
  select id, company_id, order_id into v_dispatch
  from public.dispatches where id = p_dispatch_id for update;
  if not found then raise exception 'Dispatch not found'; end if;

  for v_group in
    select reservation_id, profile_stock_batch_id, profile_id,
      round(sum(net_weight_kg), 3) consumed_weight_kg,
      round(sum(net_length_m), 3) consumed_length_m,
      sum(number_of_pieces)::integer consumed_pieces
    from public.packing_list_items
    where dispatch_id = p_dispatch_id and company_id = v_dispatch.company_id and source_kind = 'reservation'
    group by reservation_id, profile_stock_batch_id, profile_id
    order by reservation_id
  loop
    select * into v_reservation
    from public.profile_stock_reservations
    where id = v_group.reservation_id and company_id = v_dispatch.company_id and order_id = v_dispatch.order_id
    for update;
    if not found or v_reservation.profile_stock_batch_id is distinct from v_group.profile_stock_batch_id
      or v_reservation.profile_id is distinct from v_group.profile_id then
      raise exception 'Reservation is stale or no longer available for dispatch';
    end if;
    if v_reservation.reserved_pieces is null or v_reservation.initial_reserved_weight_kg is null
      or v_reservation.initial_reserved_length_m is null or v_reservation.initial_reserved_pieces is null then
      raise exception 'Legacy reservation lacks exact metre or piece provenance and cannot be consumed';
    end if;

    select * into v_existing from public.profile_stock_consumptions
    where company_id = v_dispatch.company_id and dispatch_id = p_dispatch_id and reservation_id = v_reservation.id
    for update;
    if found then
      if v_existing.order_id is distinct from v_dispatch.order_id
        or v_existing.profile_stock_batch_id is distinct from v_group.profile_stock_batch_id
        or v_existing.profile_id is distinct from v_group.profile_id
        or v_existing.consumed_weight_kg is distinct from v_group.consumed_weight_kg
        or v_existing.consumed_length_m is distinct from v_group.consumed_length_m
        or v_existing.consumed_pieces is distinct from v_group.consumed_pieces then
        raise exception 'Posted dispatch consumption is immutable';
      end if;
      -- Releasing the unconsumed remainder cannot invalidate an exact posted replay.
      continue;
    end if;

    if v_reservation.status is distinct from 'active' then
      raise exception 'Reservation is stale or no longer available for dispatch';
    end if;

    select coalesce(sum(consumed_weight_kg), 0) weight_kg,
      coalesce(sum(consumed_length_m), 0) length_m, coalesce(sum(consumed_pieces), 0) pieces
    into v_used
    from public.profile_stock_consumptions
    where reservation_id = v_reservation.id and company_id = v_dispatch.company_id and dispatch_id <> p_dispatch_id;
    if v_used.weight_kg + v_group.consumed_weight_kg > v_reservation.initial_reserved_weight_kg + 0.001
      or v_used.length_m + v_group.consumed_length_m > v_reservation.initial_reserved_length_m + 0.001
      or v_used.pieces + v_group.consumed_pieces > v_reservation.initial_reserved_pieces then
      raise exception 'Dispatch exceeds the reservation remaining weight, metre, or piece balance';
    end if;

    insert into public.profile_stock_consumptions (
      company_id, reservation_id, profile_stock_batch_id, profile_id, order_id, dispatch_id,
      consumed_weight_kg, consumed_length_m, consumed_pieces, notes, created_by
    ) values (
      v_dispatch.company_id, v_reservation.id, v_reservation.profile_stock_batch_id, v_reservation.profile_id,
      v_reservation.order_id, p_dispatch_id, v_group.consumed_weight_kg, v_group.consumed_length_m,
      v_group.consumed_pieces, 'Consumed from operator-verified packing ledger', auth.uid()
    );

    select * into v_batch from public.profile_stock_batches
    where id = v_reservation.profile_stock_batch_id and company_id = v_dispatch.company_id for update;
    if not found or v_batch.total_weight_kg + 0.001 < v_group.consumed_weight_kg
      or v_batch.length_m + 0.001 < v_group.consumed_length_m
      or v_batch.quantity_pieces < v_group.consumed_pieces then
      raise exception 'Reserved stock batch no longer contains the exact dispatched quantity';
    end if;

    v_remaining_weight := round(v_reservation.initial_reserved_weight_kg - v_used.weight_kg - v_group.consumed_weight_kg, 3);
    v_remaining_length := round(v_reservation.initial_reserved_length_m - v_used.length_m - v_group.consumed_length_m, 3);
    v_remaining_pieces := v_reservation.initial_reserved_pieces - v_used.pieces - v_group.consumed_pieces;

    update public.profile_stock_batches set
      total_weight_kg = round(greatest(total_weight_kg - v_group.consumed_weight_kg, 0), 3),
      length_m = round(greatest(length_m - v_group.consumed_length_m, 0), 3),
      quantity_pieces = greatest(quantity_pieces - v_group.consumed_pieces, 0),
      status = case when total_weight_kg - v_group.consumed_weight_kg <= 0.001 then 'dispatched' else 'reserved' end
    where id = v_batch.id and company_id = v_dispatch.company_id;

    if v_remaining_weight <= 0.001 and v_remaining_length <= 0.001 and v_remaining_pieces = 0 then
      update public.profile_stock_reservations set status = 'consumed', released_at = now()
      where id = v_reservation.id and company_id = v_dispatch.company_id;
    end if;
  end loop;
end;
$$;

revoke all on function private.consume_dispatch_reservations(uuid) from public, anon, authenticated;

commit;

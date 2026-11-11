-- PR #7 review fix: the dashboard "Reserved for orders" figure counted the whole weight of batches in status "reserved"
-- (and nothing for partly reserved "available" batches). It now sums open reservation quantities.
-- Same function as 20261109010000_stock_snapshot.sql otherwise: SECURITY INVOKER so existing RLS scopes every row;
-- no money values are exposed.

create or replace function public.get_stock_snapshot()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'billetKg', coalesce((select sum(available_weight_kg) from billet_batches where status = 'available' and available_weight_kg > 0), 0),
    'billetBatchCount', (select count(*) from billet_batches where status = 'available' and available_weight_kg > 0),
    'billetByAlloy', coalesce((
      select jsonb_agg(jsonb_build_object('alloy', alloy, 'kg', kg) order by kg desc)
      from (
        select coalesce(nullif(upper(btrim(alloy)), ''), 'UNSPECIFIED') as alloy, sum(available_weight_kg) as kg
        from billet_batches where status = 'available' and available_weight_kg > 0 group by 1
      ) b
    ), '[]'::jsonb),
    'finishedKg', coalesce((select sum(total_weight_kg) from profile_stock_batches where status = 'available' and qc_status in ('released', 'not_required')), 0),
    'finishedPieces', coalesce((select sum(quantity_pieces) from profile_stock_batches where status = 'available' and qc_status in ('released', 'not_required')), 0),
    -- Open reservation quantity (initial reserved minus consumed, never negative), the basis of private.profile_stock_balance:
    -- a 100 kg batch with 20 kg held against an order counts 20 kg here, and a dispatched part no longer counts.
    'reservedKg', coalesce((
      select sum(greatest(coalesce(r.initial_reserved_weight_kg, r.reserved_weight_kg)
        - coalesce((select sum(x.consumed_weight_kg) from profile_stock_consumptions x where x.company_id = r.company_id and x.reservation_id = r.id), 0), 0))
      from profile_stock_reservations r
      join profile_stock_batches b on b.id = r.profile_stock_batch_id and b.company_id = r.company_id
      where r.status = 'active' and b.status in ('available', 'reserved')
    ), 0),
    'holdKg', coalesce((select sum(total_weight_kg) from profile_stock_batches where qc_status = 'on_hold' and status in ('available', 'reserved')), 0),
    'finishedByFinish', coalesce((
      select jsonb_agg(jsonb_build_object('finish', finish, 'kg', kg) order by kg desc)
      from (
        select coalesce(nullif(btrim(finish), ''), 'Mill finish') as finish, sum(total_weight_kg) as kg
        from profile_stock_batches where status in ('available', 'reserved') group by 1
      ) f
    ), '[]'::jsonb),
    'consumableItemCount', (select count(*) from inventory_items where is_active),
    'lowItemCount', (select count(*) from inventory_items where is_active and current_stock <= reorder_level),
    'outOfStockCount', (select count(*) from inventory_items where is_active and current_stock <= 0)
  )
$$;

revoke all on function public.get_stock_snapshot() from public, anon;
grant execute on function public.get_stock_snapshot() to authenticated;

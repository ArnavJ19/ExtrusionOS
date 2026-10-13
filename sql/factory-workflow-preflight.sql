with reservation_consumption as (
  select consumption.company_id, consumption.reservation_id,
    sum(consumption.consumed_weight_kg) as consumed_weight_kg,
    sum(consumption.consumed_length_m) as consumed_length_m,
    sum(consumption.consumed_pieces) as consumed_pieces
  from public.profile_stock_consumptions consumption
  group by consumption.company_id, consumption.reservation_id
), reservation_issues as (
  select 'F_WORKFLOW_RESERVATION_UNITS'::text as issue, reservation.company_id,
    null::uuid as batch_id, reservation.id as record_id,
    concat_ws('; ',
      case when reservation.reserved_pieces is null or reservation.reserved_pieces <= 0 then 'reserved_pieces is null or nonpositive' end,
      case when reservation.initial_reserved_weight_kg is null or reservation.initial_reserved_length_m is null
        or reservation.initial_reserved_pieces is null then 'immutable initial reservation units are incomplete' end,
      case when reservation.initial_reserved_weight_kg is not null and reservation.reserved_weight_kg > reservation.initial_reserved_weight_kg + 0.001
        then 'current reserved kg exceeds immutable initial kg' end,
      case when reservation.initial_reserved_length_m is not null and reservation.reserved_length_m > reservation.initial_reserved_length_m + 0.001
        then 'current reserved metres exceed immutable initial metres' end,
      case when reservation.initial_reserved_pieces is not null and reservation.reserved_pieces > reservation.initial_reserved_pieces
        then 'current reserved pieces exceed immutable initial pieces' end,
      case when batch.quantity_pieces is null or batch.quantity_pieces <= 0 then 'source batch piece basis is unavailable' end,
      case when batch.quantity_pieces > 0 and reservation.initial_reserved_pieces > 0
        and abs(reservation.initial_reserved_weight_kg / reservation.initial_reserved_pieces - batch.total_weight_kg / batch.quantity_pieces) > 0.01
        then 'initial kg per piece differs from source batch' end,
      case when batch.quantity_pieces > 0 and reservation.initial_reserved_pieces > 0
        and abs(reservation.initial_reserved_length_m / reservation.initial_reserved_pieces - batch.length_m / batch.quantity_pieces) > 0.001
        then 'initial metres per piece differs from source batch' end,
      case when reservation.status = 'active' and reservation.initial_reserved_weight_kg is not null
        and abs(reservation.initial_reserved_weight_kg - reservation.reserved_weight_kg - coalesce(consumed.consumed_weight_kg,0)) > 0.01
        then 'active kg does not reconcile to initial minus consumed' end,
      case when reservation.status = 'active' and reservation.initial_reserved_length_m is not null
        and abs(reservation.initial_reserved_length_m - reservation.reserved_length_m - coalesce(consumed.consumed_length_m,0)) > 0.001
        then 'active metres do not reconcile to initial minus consumed' end,
      case when reservation.status = 'active' and reservation.initial_reserved_pieces is not null
        and reservation.initial_reserved_pieces - reservation.reserved_pieces - coalesce(consumed.consumed_pieces,0) <> 0
        then 'active pieces do not reconcile to initial minus consumed' end
    ) as details
  from public.profile_stock_reservations reservation
  left join public.profile_stock_batches batch on batch.id = reservation.profile_stock_batch_id
    and batch.company_id = reservation.company_id
  left join reservation_consumption consumed on consumed.company_id = reservation.company_id
    and consumed.reservation_id = reservation.id
  where reservation.reserved_pieces is null or reservation.reserved_pieces <= 0
    or reservation.initial_reserved_weight_kg is null or reservation.initial_reserved_length_m is null
    or reservation.initial_reserved_pieces is null or batch.quantity_pieces is null or batch.quantity_pieces <= 0
    or (batch.quantity_pieces > 0 and reservation.initial_reserved_pieces > 0 and (
      abs(reservation.initial_reserved_weight_kg / reservation.initial_reserved_pieces - batch.total_weight_kg / batch.quantity_pieces) > 0.01
      or abs(reservation.initial_reserved_length_m / reservation.initial_reserved_pieces - batch.length_m / batch.quantity_pieces) > 0.001))
    or (reservation.status = 'active' and (
      reservation.initial_reserved_weight_kg is null or reservation.initial_reserved_length_m is null or reservation.initial_reserved_pieces is null
      or abs(reservation.initial_reserved_weight_kg - reservation.reserved_weight_kg - coalesce(consumed.consumed_weight_kg,0)) > 0.01
      or abs(reservation.initial_reserved_length_m - reservation.reserved_length_m - coalesce(consumed.consumed_length_m,0)) > 0.001
      or reservation.initial_reserved_pieces - reservation.reserved_pieces - coalesce(consumed.consumed_pieces,0) <> 0))
), consumption_issues as (
  select 'F_WORKFLOW_CONSUMPTION_UNITS'::text as issue, consumption.company_id,
    consumption.profile_stock_batch_id as batch_id, consumption.id as record_id,
    concat_ws('; ',
      case when consumption.consumed_weight_kg is null or consumption.consumed_weight_kg <= 0 then 'consumed kg is null or nonpositive' end,
      case when consumption.consumed_length_m is null or consumption.consumed_length_m <= 0 then 'consumed metres are null or nonpositive' end,
      case when consumption.consumed_pieces is null or consumption.consumed_pieces <= 0 then 'consumed pieces are null or nonpositive' end,
      case when packing.pieces is null then 'no linked packing rows provide unit provenance' end,
      case when packing.pieces is not null and (abs(consumption.consumed_weight_kg - packing.weight_kg) > 0.01
        or abs(consumption.consumed_length_m - packing.length_m) > 0.001
        or consumption.consumed_pieces <> packing.pieces) then 'consumption does not match linked packing rows' end
    ) as details
  from public.profile_stock_consumptions consumption
  left join lateral (
    select sum(item.net_weight_kg) as weight_kg, sum(item.net_length_m) as length_m,
      sum(item.number_of_pieces)::integer as pieces
    from public.packing_list_items item
    where item.company_id = consumption.company_id and item.dispatch_id = consumption.dispatch_id
      and item.reservation_id = consumption.reservation_id
  ) packing on true
  where consumption.consumed_weight_kg is null or consumption.consumed_weight_kg <= 0
    or consumption.consumed_length_m is null or consumption.consumed_length_m <= 0
    or consumption.consumed_pieces is null or consumption.consumed_pieces <= 0
    or packing.pieces is null
    or abs(consumption.consumed_weight_kg - packing.weight_kg) > 0.01
    or abs(consumption.consumed_length_m - packing.length_m) > 0.001
    or consumption.consumed_pieces <> packing.pieces
), packing_issues as (
  select 'F_WORKFLOW_PACKING_LENGTH'::text as issue, item.company_id,
    item.profile_stock_batch_id as batch_id, item.id as record_id,
    concat_ws('; ',
      case when item.net_length_m is null or item.net_length_m <= 0 then 'reserved-stock packing metres are missing or nonpositive' end,
      case when reservation.id is null then 'reservation identity is missing or outside company' end,
      case when reservation.initial_reserved_pieces > 0 and item.net_length_m is not null
        and abs(item.net_length_m - reservation.initial_reserved_length_m * item.number_of_pieces / reservation.initial_reserved_pieces) > 0.001
        then 'packing metres do not match reserved whole-piece source ratio' end
    ) as details
  from public.packing_list_items item
  left join public.profile_stock_reservations reservation on reservation.id = item.reservation_id
    and reservation.company_id = item.company_id
  where item.source_kind = 'reservation' and (
    item.net_length_m is null or item.net_length_m <= 0 or reservation.id is null
    or (reservation.initial_reserved_pieces > 0 and item.net_length_m is not null
      and abs(item.net_length_m - reservation.initial_reserved_length_m * item.number_of_pieces / reservation.initial_reserved_pieces) > 0.001)
  )
)
select issue, company_id, batch_id, record_id, details
from (
  select * from reservation_issues
  union all select * from consumption_issues
  union all select * from packing_issues
) findings
order by issue, company_id, batch_id nulls first, record_id;

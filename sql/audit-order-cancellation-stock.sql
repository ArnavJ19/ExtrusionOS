-- Read-only review. Recorded credits do not establish a physical return receipt.
-- Review source documents before any correction; never rerun legacy automatic credits.
select 'cancelled_order_active_hold'::text finding,reservation.company_id,reservation.order_id,
  reservation.id source_id,reservation.reserved_weight_kg recorded_weight_kg,
  reservation.reserved_length_m recorded_length_m,reservation.reserved_pieces recorded_pieces,
  reservation.created_at recorded_at,
  'Active commitment remains on a cancelled order. Reconcile consumption and release history before correction.'::text review
from public.profile_stock_reservations reservation
join public.orders order_record on order_record.id=reservation.order_id and order_record.company_id=reservation.company_id
where order_record.current_stage='cancelled' and reservation.status='active'
union all
select 'credited_dealer_fulfillment_receipt_review',fulfillment.company_id,fulfillment.order_id,
  fulfillment.id,fulfillment.fulfilled_weight_kg,fulfillment.fulfilled_length_m,fulfillment.fulfilled_pieces,
  fulfillment.credited_at,
  'Credited fulfillment requires physical receipt and batch/movement review. This query cannot establish that goods returned.'
from public.order_dealer_stock_fulfillments fulfillment
join public.orders order_record on order_record.id=fulfillment.order_id and order_record.company_id=fulfillment.company_id
where order_record.current_stage='cancelled' and fulfillment.credited_at is not null
order by company_id,order_id,finding,source_id;

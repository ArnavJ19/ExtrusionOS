begin;

-- A dealer quote conversion is one business event. Creating the core order and
-- its dealer workflow record in separate requests can strand a converted quote
-- with no dealer record, so compose the existing guarded functions in one DB
-- transaction and return only after both sides exist.
create or replace function private.create_order_from_quote_with_dealer_workflow_atomic(
  p_quote_id uuid,
  p_order_number text,
  p_order_date date,
  p_expected_dispatch_date date,
  p_priority text,
  p_dealer_fulfilled_weight_kg numeric,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_order_id uuid;
begin
  v_order_id := private.create_order_from_quote_with_dealer_stock(
    p_quote_id,
    p_order_number,
    p_order_date,
    p_expected_dispatch_date,
    p_priority,
    p_dealer_fulfilled_weight_kg,
    p_notes
  );

  if private.get_current_user_dealer_id() is not null then
    perform private.create_dealer_order_from_order_atomic(v_order_id);
  end if;

  return v_order_id;
end;
$$;

create or replace function public.create_order_from_quote_with_dealer_workflow_atomic(
  p_quote_id uuid,
  p_order_number text,
  p_order_date date,
  p_expected_dispatch_date date,
  p_priority text,
  p_dealer_fulfilled_weight_kg numeric,
  p_notes text
)
returns uuid
language sql
security invoker
set search_path = public, private
as $$
  select private.create_order_from_quote_with_dealer_workflow_atomic(
    p_quote_id,
    p_order_number,
    p_order_date,
    p_expected_dispatch_date,
    p_priority,
    p_dealer_fulfilled_weight_kg,
    p_notes
  )
$$;

revoke all on function private.create_order_from_quote_with_dealer_workflow_atomic(
  uuid, text, date, date, text, numeric, text
) from public, anon;
revoke all on function public.create_order_from_quote_with_dealer_workflow_atomic(
  uuid, text, date, date, text, numeric, text
) from public, anon;
grant execute on function private.create_order_from_quote_with_dealer_workflow_atomic(
  uuid, text, date, date, text, numeric, text
) to authenticated;
grant execute on function public.create_order_from_quote_with_dealer_workflow_atomic(
  uuid, text, date, date, text, numeric, text
) to authenticated;

commit;

begin;

create or replace function private.is_valid_delivery_transition(
  p_from text,
  p_to text
)
returns boolean
language sql
immutable
as $$
  select p_from = p_to
    or (p_from = 'pending' and p_to = 'dispatched')
    or (p_from = 'dispatched' and p_to in ('in_transit','delivered','delayed','damaged','returned'))
    or (p_from = 'in_transit' and p_to in ('delivered','delayed','damaged','returned'))
    or (p_from = 'delayed' and p_to in ('dispatched','in_transit','delivered','damaged','returned'))
    or (p_from = 'damaged' and p_to = 'returned')
    or (p_from = 'delivered' and p_to = 'returned')
$$;

create or replace function public.validate_dispatch_transition()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if tg_op = 'INSERT' then
    if new.delivery_status not in ('pending','dispatched') then
      raise exception 'New dispatches must start as pending or dispatched'
        using errcode = '23514';
    end if;
    new.last_status_changed_at := now();
  else
    if new.company_id <> old.company_id or new.order_id <> old.order_id then
      raise exception 'Dispatch company and order cannot be changed after creation'
        using errcode = '23514';
    end if;
    if old.delivery_status <> 'pending'
       and (
         new.total_weight_kg is distinct from old.total_weight_kg
         or new.number_of_bundles is distinct from old.number_of_bundles
       ) then
      raise exception 'Activated dispatch weight and packing totals are immutable'
        using errcode = '23514';
    end if;
    if not private.is_valid_delivery_transition(old.delivery_status, new.delivery_status) then
      raise exception 'Invalid delivery transition from % to %', old.delivery_status, new.delivery_status
        using errcode = '23514';
    end if;
    if new.delivery_status is distinct from old.delivery_status then
      new.last_status_changed_at := now();
    end if;
  end if;

  if new.delivery_status = 'delivered' then
    if coalesce(btrim(new.proof_of_delivery_url), '') = '' then
      raise exception 'Proof of delivery is required before marking a shipment delivered'
        using errcode = '23514';
    end if;
    if btrim(new.proof_of_delivery_url) not like
       new.company_id::text || '/dispatches/' || new.id::text || '/proof-of-delivery/%'
       or not exists (
         select 1
         from public.technical_documents document
         where document.company_id = new.company_id
           and document.linked_entity_type = 'dispatch'
           and document.linked_entity_id = new.id
           and document.document_type = 'proof_of_delivery'
           and document.storage_bucket = 'documents'
           and document.storage_path = btrim(new.proof_of_delivery_url)
       ) then
      raise exception 'Proof of delivery must be a durable file stored for this company and dispatch'
        using errcode = '23514';
    end if;
    new.delivered_at := coalesce(new.delivered_at, now());
  elsif tg_op = 'UPDATE' and new.delivery_status is distinct from old.delivery_status then
    new.delivered_at := null;
  end if;
  return new;
end;
$$;

alter table public.dealer_receipts
  add column if not exists request_payload jsonb;

do $$
begin
  if to_regprocedure('public.submit_dealer_receipt_atomic_legacy(uuid,uuid,uuid,text,jsonb,text,text,text)') is null then
    alter function public.submit_dealer_receipt_atomic(uuid, uuid, uuid, text, jsonb, text, text, text)
      rename to submit_dealer_receipt_atomic_legacy;
  end if;
end $$;

create or replace function public.submit_dealer_receipt_atomic(
  p_shipment_id uuid,
  p_dealer_id uuid,
  p_dealer_order_id uuid,
  p_notes text,
  p_lines jsonb,
  p_ip_address text,
  p_user_agent text,
  p_device_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.get_current_user_company_id();
  v_user_id uuid := auth.uid();
  v_user_dealer_id uuid := public.get_current_user_dealer_id();
  v_shipment public.shipments%rowtype;
  v_existing public.dealer_receipts%rowtype;
  v_normalized_lines jsonb;
  v_request_payload jsonb;
  v_result jsonb;
begin
  if v_user_id is null or v_company_id is null then
    raise exception 'Authentication context is required';
  end if;
  if v_user_dealer_id is null or v_user_dealer_id <> p_dealer_id then
    raise exception 'Dealer ownership does not match the authenticated user';
  end if;
  if not public.current_user_has_permission('receive_dealer_inventory') then
    raise exception 'Permission denied for dealer receipt';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Receipt lines are required';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'shipment_item_id', coalesce(line->>'shipment_item_id', line->>'shipmentItemId')::uuid,
      'expected_quantity', coalesce(line->>'expected_quantity', line->>'expectedQuantity')::numeric,
      'reported_received_quantity', coalesce(line->>'reported_received_quantity', line->>'reportedReceivedQuantity')::numeric,
      'inventory_item_id', coalesce(line->>'inventory_item_id', line->>'inventoryItemId')::uuid,
      'unit', line->>'unit',
      'notes', nullif(btrim(coalesce(line->>'notes', '')), '')
    ) order by coalesce(line->>'shipment_item_id', line->>'shipmentItemId')
  ), '[]'::jsonb)
  into v_normalized_lines
  from jsonb_array_elements(p_lines) line;

  v_request_payload := jsonb_build_object(
    'dealer_order_id', p_dealer_order_id,
    'notes', nullif(btrim(coalesce(p_notes, '')), ''),
    'lines', v_normalized_lines
  );

  select * into v_shipment
  from public.shipments
  where id = p_shipment_id
    and company_id = v_company_id
    and dealer_id = p_dealer_id
  for update;
  if not found then raise exception 'Shipment not found'; end if;

  if v_shipment.status in ('received_confirmed', 'discrepancy_reported', 'closed') then
    select * into v_existing
    from public.dealer_receipts
    where company_id = v_company_id and shipment_id = p_shipment_id
    order by created_at desc
    limit 1;
    if not found then raise exception 'Shipment receipt is already closed'; end if;
    if v_existing.request_payload is null then
      raise exception 'This historical receipt cannot be retried safely; reload the recorded receipt';
    end if;
    if v_existing.request_payload <> v_request_payload then
      raise exception 'Receipt retry payload differs from the recorded receipt';
    end if;
    return jsonb_build_object('receiptId', v_existing.id, 'status', v_existing.status, 'idempotent', true);
  end if;

  v_result := public.submit_dealer_receipt_atomic_legacy(
    p_shipment_id,
    p_dealer_id,
    p_dealer_order_id,
    p_notes,
    v_normalized_lines,
    p_ip_address,
    p_user_agent,
    p_device_session_id
  );

  update public.dealer_receipts
  set request_payload = v_request_payload
  where id = (v_result->>'receiptId')::uuid
    and company_id = v_company_id;

  return v_result;
end;
$$;

revoke all on function private.is_valid_delivery_transition(text, text) from public, anon, authenticated;
revoke all on function public.submit_dealer_receipt_atomic_legacy(uuid, uuid, uuid, text, jsonb, text, text, text) from public, anon, authenticated;
revoke all on function public.submit_dealer_receipt_atomic(uuid, uuid, uuid, text, jsonb, text, text, text) from public, anon;
grant execute on function public.submit_dealer_receipt_atomic(uuid, uuid, uuid, text, jsonb, text, text, text) to authenticated;

commit;

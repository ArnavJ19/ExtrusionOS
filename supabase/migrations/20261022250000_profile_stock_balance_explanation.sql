-- UPGRADE_EOS feature 51 (stock half): explainable profile stock balances.
--
-- A finished-stock batch's "available to reserve" figure is expanded into signed components
-- that sum exactly to it, in kilograms, pieces and metres:
--   available = on hand − open reservations − excluded + shortfall
-- * on hand: the batch's current quantity (already reduced by dispatch consumptions and dealer
--   debits, and increased again by cancellation credits).
-- * open reservations: per active reservation, initial reserved quantity minus what dispatch has
--   consumed from it (the reservation ledger's basis). Consumed quantities have already left
--   "on hand", so only the open part is subtracted: nothing is counted twice.
-- * excluded: stock that cannot be reserved because of its QC status or batch status (the rule
--   enforced by private.guard_stock_batch_qc_release), stated with its reason.
-- * shortfall: when open reservations exceed on hand (an integrity problem), the deficit is shown
--   instead of a negative availability.
-- The recorded withdrawals behind "on hand" (dispatch consumptions, dealer debits and their
-- cancellation credits) are listed with signed quantities. Read only; no table changes.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function private.profile_stock_balance(p_company uuid, p_batch uuid)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare
  v_batch record;
  v_open_n bigint; v_open_w numeric; v_open_p integer; v_open_l numeric;
  v_res jsonb;
  v_mov_n bigint; v_mov_w numeric; v_mov_p integer; v_mov_l numeric; v_mov jsonb;
  v_reason text;
  v_on_w numeric; v_on_p integer; v_on_l numeric;
  v_ex_w numeric := 0; v_ex_p integer := 0; v_ex_l numeric := 0;
  v_sf_w numeric; v_sf_p integer; v_sf_l numeric;
begin
  select b.id, b.bundle_number, b.finish, b.location, b.status, b.qc_status, b.origin_type, b.origin_reference, b.created_at, b.dealer_id,
         b.total_weight_kg, b.quantity_pieces, b.length_m, p.profile_code, p.profile_name
    into v_batch
  from public.profile_stock_batches b
  left join public.aluminium_profiles p on p.id = b.profile_id and p.company_id = p_company
  where b.id = p_batch and b.company_id = p_company;
  if not found then return null; end if;
  v_on_w := coalesce(v_batch.total_weight_kg, 0);
  v_on_p := coalesce(v_batch.quantity_pieces, 0);
  v_on_l := coalesce(v_batch.length_m, 0);

  -- Active reservations with their open quantity (initial reserved − consumed, never negative).
  with r as (
    select res.id, res.order_id, res.created_at,
           coalesce(res.initial_reserved_weight_kg, res.reserved_weight_kg) as reserved_w,
           coalesce(res.initial_reserved_pieces, res.reserved_pieces, 0) as reserved_p,
           coalesce(res.initial_reserved_length_m, res.reserved_length_m, 0) as reserved_l,
           coalesce(c.w, 0) as consumed_w, coalesce(c.p, 0) as consumed_p, coalesce(c.l, 0) as consumed_l
    from public.profile_stock_reservations res
    left join lateral (
      select sum(x.consumed_weight_kg) w, sum(coalesce(x.consumed_pieces, 0)) p, sum(coalesce(x.consumed_length_m, 0)) l
      from public.profile_stock_consumptions x where x.company_id = p_company and x.reservation_id = res.id
    ) c on true
    where res.company_id = p_company and res.profile_stock_batch_id = p_batch and res.status = 'active'
  )
  select count(*), coalesce(sum(greatest(reserved_w - consumed_w, 0)), 0), coalesce(sum(greatest(reserved_p - consumed_p, 0)), 0)::integer,
         coalesce(sum(greatest(reserved_l - consumed_l, 0)), 0),
         coalesce((select jsonb_agg(jsonb_build_object(
             'id', q.id, 'order_id', q.order_id, 'order_number', o.order_number, 'customer_name', coalesce(nullif(cu.company_name, ''), cu.customer_name),
             'created_at', q.created_at, 'reserved_weight_kg', q.reserved_w, 'consumed_weight_kg', q.consumed_w,
             'open_weight_kg', greatest(q.reserved_w - q.consumed_w, 0), 'open_pieces', greatest(q.reserved_p - q.consumed_p, 0),
             'open_length_m', greatest(q.reserved_l - q.consumed_l, 0)) order by q.created_at, q.id)
           from (select * from r order by created_at, id limit 100) q
           left join public.orders o on o.id = q.order_id and o.company_id = p_company
           left join public.customers cu on cu.id = o.customer_id and cu.company_id = p_company), '[]'::jsonb)
    into v_open_n, v_open_w, v_open_p, v_open_l, v_res
  from r;

  -- Recorded withdrawals behind the on-hand figure: out is negative, credits are positive.
  with movements as (
    select 'dispatch'::text as kind, x.id, x.created_at as at, d.dispatch_number as reference, x.dispatch_id as reference_id, o.order_number,
           -x.consumed_weight_kg as w, -coalesce(x.consumed_pieces, 0) as p, -coalesce(x.consumed_length_m, 0) as l
    from public.profile_stock_consumptions x
    left join public.dispatches d on d.id = x.dispatch_id and d.company_id = p_company
    left join public.orders o on o.id = x.order_id and o.company_id = p_company
    where x.company_id = p_company and x.profile_stock_batch_id = p_batch
    union all
    select 'dealer_debit', f.id, f.created_at, null, f.order_id, o.order_number, -f.fulfilled_weight_kg, -f.fulfilled_pieces, -f.fulfilled_length_m
    from public.order_dealer_stock_fulfillments f left join public.orders o on o.id = f.order_id and o.company_id = p_company
    where f.company_id = p_company and f.profile_stock_batch_id = p_batch
    union all
    select 'dealer_credit', f.id, f.credited_at, null, f.order_id, o.order_number, f.fulfilled_weight_kg, f.fulfilled_pieces, f.fulfilled_length_m
    from public.order_dealer_stock_fulfillments f left join public.orders o on o.id = f.order_id and o.company_id = p_company
    where f.company_id = p_company and f.profile_stock_batch_id = p_batch and f.credited_at is not null
  )
  select count(*), coalesce(sum(w), 0), coalesce(sum(p), 0)::integer, coalesce(sum(l), 0),
         coalesce((select jsonb_agg(jsonb_build_object('kind', m.kind, 'id', m.id, 'at', m.at, 'reference', m.reference, 'reference_id', m.reference_id,
             'order_number', m.order_number, 'weight_kg', m.w, 'pieces', m.p, 'length_m', m.l) order by m.at desc, m.kind, m.id)
           from (select * from movements order by at desc, kind, id limit 100) m), '[]'::jsonb)
    into v_mov_n, v_mov_w, v_mov_p, v_mov_l, v_mov
  from movements;

  v_reason := case
    when v_batch.qc_status = 'on_hold' then 'qc_on_hold'
    when v_batch.qc_status = 'rejected' then 'qc_rejected'
    when v_batch.qc_status not in ('released','not_required') then 'qc_not_released'
    when v_batch.status not in ('available','reserved') then 'batch_' || v_batch.status
  end;
  if v_reason is not null then
    v_ex_w := greatest(v_on_w - v_open_w, 0);
    v_ex_p := greatest(v_on_p - v_open_p, 0);
    v_ex_l := greatest(v_on_l - v_open_l, 0);
  end if;
  v_sf_w := greatest(v_open_w - v_on_w, 0);
  v_sf_p := greatest(v_open_p - v_on_p, 0);
  v_sf_l := greatest(v_open_l - v_on_l, 0);

  return jsonb_build_object(
    'batch', jsonb_build_object('id', v_batch.id, 'bundle_number', v_batch.bundle_number, 'profile_code', v_batch.profile_code, 'profile_name', v_batch.profile_name,
      'finish', v_batch.finish, 'location', v_batch.location, 'status', v_batch.status, 'qc_status', v_batch.qc_status, 'origin_type', v_batch.origin_type,
      'origin_reference', v_batch.origin_reference, 'created_at', v_batch.created_at, 'dealer_owned', v_batch.dealer_id is not null),
    'on_hand', jsonb_build_object('weight_kg', v_on_w, 'pieces', v_on_p, 'length_m', v_on_l),
    'open_reserved', jsonb_build_object('weight_kg', v_open_w, 'pieces', v_open_p, 'length_m', v_open_l, 'count', v_open_n),
    'excluded', jsonb_build_object('weight_kg', v_ex_w, 'pieces', v_ex_p, 'length_m', v_ex_l, 'reason', v_reason),
    'shortfall', jsonb_build_object('weight_kg', v_sf_w, 'pieces', v_sf_p, 'length_m', v_sf_l),
    'available', jsonb_build_object('weight_kg', v_on_w - v_open_w - v_ex_w + v_sf_w, 'pieces', v_on_p - v_open_p - v_ex_p + v_sf_p, 'length_m', v_on_l - v_open_l - v_ex_l + v_sf_l),
    'reservations', v_res, 'reservations_total', v_open_n,
    'withdrawals', v_mov, 'withdrawals_total', v_mov_n,
    'net_withdrawn', jsonb_build_object('weight_kg', v_mov_w, 'pieces', v_mov_p, 'length_m', v_mov_l),
    'before_recorded_withdrawals', jsonb_build_object('weight_kg', v_on_w - v_mov_w, 'pieces', v_on_p - v_mov_p, 'length_m', v_on_l - v_mov_l));
end;
$$;
revoke all on function private.profile_stock_balance(uuid, uuid) from public, anon, authenticated;

create or replace function public.profile_stock_balance_command(p_command text, p_payload jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare
  v_actor uuid := auth.uid();
  v_company uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_dealer uuid := private.get_current_user_dealer_id();
  v_result jsonb; v_batch uuid; v_page integer; v_search text; v_filter text; v_total bigint; v_rows jsonb;
begin
  if v_actor is null or v_company is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid stock balance request'; end if;
  -- Same readers as the reservation ledger; dealer users may explain only their own dealership's batches.
  if p_command not in ('balance.explain','balance.list')
     or not (v_role in ('owner','admin','production_manager','production','factory_manager','inventory_manager','dispatch_manager','dispatch')
             or (v_role in ('dealer_admin','dealer_staff') and v_dealer is not null)) then
    raise exception 'This action is not permitted for your role' using errcode = '42501';
  end if;
  if v_dealer is not null and v_role not in ('dealer_admin','dealer_staff') then raise exception 'This action is not permitted for your role' using errcode = '42501'; end if;

  if p_command = 'balance.explain' then
    v_batch := (p_payload ->> 'batch_id')::uuid;
    if v_dealer is not null and not exists (select 1 from public.profile_stock_batches where id = v_batch and company_id = v_company and dealer_id = v_dealer) then
      raise exception 'Stock batch is unavailable';
    end if;
    v_result := private.profile_stock_balance(v_company, v_batch);
    if v_result is null then raise exception 'Stock batch is unavailable'; end if;
    if v_dealer is not null then
      -- Dealers see quantities only; other parties' order references are removed.
      v_result := v_result || jsonb_build_object(
        'reservations', (select coalesce(jsonb_agg(r - 'customer_name' - 'order_id'), '[]'::jsonb) from jsonb_array_elements(v_result -> 'reservations') r),
        'withdrawals', (select coalesce(jsonb_agg(w - 'reference_id'), '[]'::jsonb) from jsonb_array_elements(v_result -> 'withdrawals') w));
    end if;
    return v_result;
  end if;

  -- balance.list: batches with their available quantity, 10 per page.
  v_page := coalesce((p_payload ->> 'page')::integer, 1);
  v_search := lower(btrim(coalesce(p_payload ->> 'search', '')));
  v_filter := coalesce(p_payload ->> 'filter', 'in_stock');
  if v_page < 1 or v_page > 100000 or length(v_search) > 80 or v_filter not in ('in_stock','reservable','held','over_reserved') then raise exception 'Invalid stock balance search'; end if;
  with batches as (
    select b.id, b.created_at, private.profile_stock_balance(v_company, b.id) as e
    from public.profile_stock_batches b
    left join public.aluminium_profiles p on p.id = b.profile_id and p.company_id = v_company
    where b.company_id = v_company and (v_dealer is null or b.dealer_id = v_dealer)
      and b.status in ('available','reserved')
      and (v_search = '' or position(v_search in lower(coalesce(b.bundle_number, '') || ' ' || coalesce(p.profile_code, '') || ' ' || coalesce(p.profile_name, '') || ' ' || coalesce(b.location, ''))) > 0)
  ), filtered as (
    select * from batches
    where case v_filter
      when 'reservable' then (e -> 'available' ->> 'weight_kg')::numeric > 0
      when 'held' then e -> 'excluded' ->> 'reason' is not null
      when 'over_reserved' then (e -> 'shortfall' ->> 'weight_kg')::numeric > 0
      else (e -> 'on_hand' ->> 'weight_kg')::numeric > 0 end
  )
  select (select count(*) from filtered),
    coalesce((select jsonb_agg(jsonb_build_object('batch', f.e -> 'batch', 'on_hand', f.e -> 'on_hand', 'open_reserved', f.e -> 'open_reserved',
        'excluded', f.e -> 'excluded', 'shortfall', f.e -> 'shortfall', 'available', f.e -> 'available') order by f.created_at desc, f.id)
      from (select * from filtered order by created_at desc, id limit 10 offset (v_page - 1) * 10) f), '[]'::jsonb)
  into v_total, v_rows;
  return jsonb_build_object('rows', v_rows, 'total_count', v_total);
end;
$$;
revoke all on function public.profile_stock_balance_command(text, jsonb) from public, anon;
grant execute on function public.profile_stock_balance_command(text, jsonb) to authenticated;

commit;

begin;

-- Remove the legacy hard error inside the transaction. The canonical
-- workflow in the next migration records a queue hold or an authorized
-- manager override before the order can reach production.
create or replace function private.create_order_from_quote_with_dealer_stock(
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
  v_company_id uuid := private.get_current_user_company_id();
  v_user_id uuid := auth.uid();
  v_user_role text := private.get_current_user_role();
  v_user_dealer_id uuid := private.get_current_user_dealer_id();
  v_user_org_type text;
  v_quote public.quotes%rowtype;
  v_dealer_id uuid;
  v_order_id uuid;
  v_order_item_id uuid;
  v_requested_weight numeric(14,3);
  v_available_dealer_weight numeric(14,3) := 0;
  v_dealer_weight numeric(14,3);
  v_manufacturing_weight numeric(14,3);
  v_stage text;
  v_fulfillment_notes text;
  v_remaining_dealer_weight numeric(14,3);
  v_line record;
  v_line_remaining numeric(14,3);
  v_batch record;
  v_reserved_weight numeric(14,3);
  v_available_weight numeric(14,3);
  v_consume_weight numeric(14,3);
  v_new_batch_weight numeric(14,3);
  v_new_piece_count integer;
  v_order_origin text;
begin
  if v_company_id is null or v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if v_user_role not in ('owner','admin','sales','sales_manager','dealer_admin','dealer_staff') then
    raise exception 'Permission denied for quote conversion' using errcode = '42501';
  end if;

  select organization_type into v_user_org_type
  from public.app_users where id = v_user_id;

  select * into v_quote
  from public.quotes
  where id = p_quote_id and company_id = v_company_id
  for update;
  if not found then raise exception 'Quote not found' using errcode = '23514'; end if;
  if v_quote.status <> 'customer_approved' then
    raise exception 'Only a customer-approved quote can become an order' using errcode = '23514';
  end if;
  if v_user_dealer_id is not null
     and v_quote.dealer_id is distinct from v_user_dealer_id
     and v_quote.created_by is distinct from v_user_id then
    raise exception 'Dealer users can only convert their own quotations' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.orders
    where company_id = v_company_id and quote_id = p_quote_id
  ) then
    raise exception 'This quote is already linked to an order' using errcode = '23505';
  end if;
  if exists (
    select 1 from public.orders
    where company_id = v_company_id and order_number = p_order_number
  ) then
    raise exception 'Order number already exists' using errcode = '23505';
  end if;

  select round(coalesce(sum(coalesce(billing_weight_kg, total_weight_kg, 0)), 0), 3)
  into v_requested_weight
  from public.quote_items
  where quote_id = p_quote_id and company_id = v_company_id;
  if v_requested_weight <= 0 then
    raise exception 'Quote has no billable profile weight' using errcode = '23514';
  end if;

  v_dealer_id := coalesce(v_user_dealer_id, v_quote.dealer_id);
  if v_dealer_id is not null then
    with quote_groups as (
      select
        item.profile_id,
        lower(regexp_replace(coalesce(item.finishing_type, 'mill_finish'), '[^a-z0-9]+', '_', 'g')) as finish_key,
        sum(coalesce(item.billing_weight_kg, item.total_weight_kg, 0)) as required_weight_kg
      from public.quote_items item
      where item.company_id = v_company_id
        and item.quote_id = p_quote_id
        and item.profile_id is not null
      group by item.profile_id,
        lower(regexp_replace(coalesce(item.finishing_type, 'mill_finish'), '[^a-z0-9]+', '_', 'g'))
    ),
    reserved as (
      select reservation.profile_stock_batch_id, sum(reservation.reserved_weight_kg) as reserved_weight_kg
      from public.profile_stock_reservations reservation
      where reservation.company_id = v_company_id and reservation.status = 'active'
      group by reservation.profile_stock_batch_id
    ),
    stock_groups as (
      select
        batch.profile_id,
        lower(regexp_replace(batch.finish, '[^a-z0-9]+', '_', 'g')) as finish_key,
        sum(greatest(batch.total_weight_kg - coalesce(reserved.reserved_weight_kg, 0), 0)) as available_weight_kg
      from public.profile_stock_batches batch
      left join reserved on reserved.profile_stock_batch_id = batch.id
      where batch.company_id = v_company_id
        and batch.dealer_id = v_dealer_id
        and batch.status = 'available'
        and batch.total_weight_kg > 0
      group by batch.profile_id,
        lower(regexp_replace(batch.finish, '[^a-z0-9]+', '_', 'g'))
    )
    select round(coalesce(sum(least(
      quote_group.required_weight_kg,
      coalesce(stock_group.available_weight_kg, 0)
    )), 0), 3)
    into v_available_dealer_weight
    from quote_groups quote_group
    left join stock_groups stock_group
      on stock_group.profile_id = quote_group.profile_id
     and stock_group.finish_key = quote_group.finish_key;
  end if;

  v_dealer_weight := round(greatest(coalesce(p_dealer_fulfilled_weight_kg, 0), 0), 3);
  if v_dealer_weight > 0 and v_dealer_id is null then
    raise exception 'Dealer assignment is required before consuming dealer stock' using errcode = '23514';
  end if;
  if v_dealer_weight > v_requested_weight then
    raise exception 'Dealer fulfilled weight cannot exceed quote weight' using errcode = '23514';
  end if;
  if v_dealer_weight > v_available_dealer_weight + 0.001 then
    raise exception 'Only % kg of finish-compatible, unreserved dealer stock is available',
      v_available_dealer_weight using errcode = '23514';
  end if;

  v_manufacturing_weight := round(v_requested_weight - v_dealer_weight, 3);

  v_stage := case when v_manufacturing_weight >= 700 then 'extrusion_planned' else 'order_confirmed' end;
  v_fulfillment_notes := case
    when v_dealer_weight > 0 then format(
      'Dealer stock fulfilled %s kg from exact quote lines and finish-compatible unreserved batches. Factory balance %s kg.',
      v_dealer_weight,
      v_manufacturing_weight
    )
    else format('Factory manufacturing weight %s kg.', v_manufacturing_weight)
  end;
  v_order_origin := case
    when v_user_dealer_id is not null and v_user_role = 'dealer_admin' then 'DEALER_ADMIN_CREATED'
    when v_user_dealer_id is not null then 'DEALER_EMPLOYEE_CREATED'
    else 'FACTORY_DIRECT'
  end;

  insert into public.orders (
    company_id, dealer_id, order_number, quote_id, customer_id, order_date,
    expected_dispatch_date, priority, current_stage, order_value,
    requested_weight_kg, dealer_fulfilled_weight_kg, manufacturing_weight_kg,
    fulfillment_notes, notes, created_by, created_by_user_id, created_by_role,
    created_by_organization_type, created_by_dealership_id, order_origin
  ) values (
    v_company_id, v_dealer_id, p_order_number, p_quote_id, v_quote.customer_id, p_order_date,
    p_expected_dispatch_date, p_priority, v_stage, coalesce(v_quote.grand_total, 0),
    v_requested_weight, 0, v_requested_weight,
    v_fulfillment_notes,
    nullif(concat_ws(E'\n', nullif(p_notes, ''), v_fulfillment_notes), ''),
    v_user_id, v_user_id, v_user_role, v_user_org_type, v_dealer_id, v_order_origin
  ) returning id into v_order_id;

  for v_line in
    select item.*, round(coalesce(item.billing_weight_kg, item.total_weight_kg, 0), 3) as required_weight_kg
    from public.quote_items item
    where item.company_id = v_company_id and item.quote_id = p_quote_id
    order by item.created_at, item.id
  loop
    v_order_item_id := private.insert_jsonb_row(
      'public.order_items'::regclass,
      (to_jsonb(v_line) - array['id','company_id','quote_id','created_at','updated_at','required_weight_kg'])
        || jsonb_build_object(
          'company_id', v_company_id,
          'order_id', v_order_id,
          'source_record_id', p_quote_id,
          'source_line_id', v_line.id,
          'quote_item_id', v_line.id,
          'finishing_type', coalesce(v_line.finishing_type, 'mill_finish'),
          'dealer_fulfilled_weight_kg', 0,
          'manufacturing_weight_kg', v_line.required_weight_kg,
          'created_at', now(),
          'updated_at', now()
        )
    );
  end loop;

  v_remaining_dealer_weight := v_dealer_weight;
  if v_remaining_dealer_weight > 0 then
    for v_line in
      select
        item.id,
        item.profile_id,
        coalesce(item.finishing_type, 'mill_finish') as finishing_type,
        round(coalesce(item.billing_weight_kg, item.total_weight_kg, 0), 3) as required_weight_kg,
        coalesce(item.net_rate, item.price_per_kg) as unit_rate,
        item.line_total_before_gst
      from public.quote_items item
      where item.company_id = v_company_id
        and item.quote_id = p_quote_id
        and item.profile_id is not null
      order by item.created_at, item.id
    loop
      exit when v_remaining_dealer_weight <= 0.001;
      if coalesce(v_line.unit_rate, 0) <= 0 then
        raise exception 'Every dealer-stock quote line needs a positive commercial rate before fulfillment';
      end if;
      select id into v_order_item_id
      from public.order_items
      where company_id = v_company_id
        and order_id = v_order_id
        and quote_item_id = v_line.id;
      if v_order_item_id is null then
        raise exception 'Order line could not be linked to its quote line';
      end if;

      v_line_remaining := least(v_line.required_weight_kg, v_remaining_dealer_weight);
      for v_batch in
        select batch.id, batch.total_weight_kg, batch.length_m, batch.quantity_pieces
        from public.profile_stock_batches batch
        where batch.company_id = v_company_id
          and batch.dealer_id = v_dealer_id
          and batch.profile_id = v_line.profile_id
          and batch.status = 'available'
          and batch.total_weight_kg > 0
          and lower(regexp_replace(batch.finish, '[^a-z0-9]+', '_', 'g')) =
              lower(regexp_replace(v_line.finishing_type, '[^a-z0-9]+', '_', 'g'))
        order by batch.created_at, batch.id
        for update
      loop
        exit when v_line_remaining <= 0.001 or v_remaining_dealer_weight <= 0.001;
        select coalesce(sum(reservation.reserved_weight_kg), 0)
        into v_reserved_weight
        from public.profile_stock_reservations reservation
        where reservation.company_id = v_company_id
          and reservation.profile_stock_batch_id = v_batch.id
          and reservation.status = 'active';
        v_available_weight := round(greatest(v_batch.total_weight_kg - v_reserved_weight, 0), 3);
        if v_available_weight <= 0 then continue; end if;

        v_consume_weight := least(v_line_remaining, v_remaining_dealer_weight, v_available_weight);
        v_new_batch_weight := round(v_batch.total_weight_kg - v_consume_weight, 3);
        v_new_piece_count := case
          when v_batch.total_weight_kg > 0 then greatest(
            0,
            round(v_batch.quantity_pieces * (v_new_batch_weight / v_batch.total_weight_kg))::integer
          )
          else 0
        end;

        insert into public.order_dealer_stock_fulfillments (
          company_id, order_id, quote_id, quote_item_id, order_item_id,
          profile_id, profile_stock_batch_id, finishing_type, unit_rate,
          quoted_line_value, fulfilled_weight_kg, fulfilled_length_m,
          fulfilled_pieces, notes, created_by
        ) values (
          v_company_id, v_order_id, p_quote_id, v_line.id, v_order_item_id,
          v_line.profile_id, v_batch.id, v_line.finishing_type, v_line.unit_rate,
          v_line.line_total_before_gst, v_consume_weight,
          case when v_batch.total_weight_kg > 0
            then round(coalesce(v_batch.length_m, 0) * v_consume_weight / v_batch.total_weight_kg, 3)
            else 0 end,
          greatest(0, v_batch.quantity_pieces - v_new_piece_count),
          'Dealer stock debit with exact quote/order/finish/rate lineage',
          v_user_id
        );

        update public.profile_stock_batches
        set total_weight_kg = v_new_batch_weight,
            quantity_pieces = v_new_piece_count,
            status = case when v_new_batch_weight <= 0 then 'dispatched' else status end,
            updated_at = now()
        where id = v_batch.id and company_id = v_company_id;

        update public.order_items
        set dealer_fulfilled_weight_kg = dealer_fulfilled_weight_kg + v_consume_weight,
            updated_at = now()
        where id = v_order_item_id and company_id = v_company_id;

        insert into public.inventory_transactions (
          company_id, inventory_item_id, item_type, quantity, unit, inventory_state,
          from_owner_type, from_owner_id, to_owner_type, to_owner_id, order_id,
          created_by_user_id, created_by_role, reason, status
        )
        select
          v_company_id, inventory.id, 'profile', -v_consume_weight, 'kg',
          'dealer_inventory_on_hand', 'dealer', v_dealer_id, 'customer', null,
          v_order_id, v_user_id, v_user_role,
          'Dealer stock debit for quote line ' || v_line.id::text, 'posted'
        from public.inventory_items inventory
        join public.aluminium_profiles profile
          on profile.id = v_line.profile_id and profile.company_id = v_company_id
        where inventory.company_id = v_company_id
          and inventory.item_code = profile.profile_code
        limit 1;

        v_line_remaining := round(v_line_remaining - v_consume_weight, 3);
        v_remaining_dealer_weight := round(v_remaining_dealer_weight - v_consume_weight, 3);
      end loop;
    end loop;
  end if;

  if v_remaining_dealer_weight > 0.001 then
    raise exception 'Could not allocate % kg of dealer stock to exact quote lines and finishes',
      v_remaining_dealer_weight using errcode = '23514';
  end if;

  update public.order_items order_item
  set manufacturing_weight_kg = greatest(
        coalesce(quote_item.billing_weight_kg, quote_item.total_weight_kg, order_item.quantity_kg, 0)
          - order_item.dealer_fulfilled_weight_kg,
        0
      ),
      updated_at = now()
  from public.quote_items quote_item
  where order_item.company_id = v_company_id
    and order_item.order_id = v_order_id
    and quote_item.id = order_item.quote_item_id;

  update public.orders
  set dealer_fulfilled_weight_kg = v_dealer_weight,
      manufacturing_weight_kg = v_manufacturing_weight,
      fulfillment_notes = v_fulfillment_notes
  where id = v_order_id and company_id = v_company_id;

  insert into public.order_stage_history (company_id, order_id, stage, changed_by, remarks)
  values (v_company_id, v_order_id, v_stage, v_user_id, v_fulfillment_notes);

  update public.quotes
  set status = 'converted_to_order', updated_at = now()
  where id = p_quote_id and company_id = v_company_id;
  return v_order_id;
end;
$$;

-- The legacy direct RPC would bypass queue creation once the hard error is
-- removed, so only the canonical workflow may invoke the base transaction.
revoke all on function public.create_order_from_quote_with_dealer_stock(uuid,text,date,date,text,numeric,text) from public, anon, authenticated;
revoke all on function private.create_order_from_quote_with_dealer_stock(uuid,text,date,date,text,numeric,text) from public, anon, authenticated;

commit;


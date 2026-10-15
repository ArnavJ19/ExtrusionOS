begin;

create table if not exists private.quote_fulfillment_authorizations(
  transaction_id bigint not null,
  company_id uuid not null,
  quote_id uuid not null,
  actor_id uuid not null,
  primary key(transaction_id,company_id,quote_id,actor_id)
);
revoke all on private.quote_fulfillment_authorizations from public,anon,authenticated;

-- Preserve the original conversion contract, with remaining-hold accounting,
-- exact physical debits and narrowly authorized updates of fulfillment balances.
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
  v_consumed_pieces integer;
  v_consumed_length numeric(14,3);
  v_order_origin text;
begin
  if v_company_id is null or v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if v_user_role is null or v_user_role not in ('owner','admin','sales','sales_manager','dealer_admin','dealer_staff') then
    raise exception 'Permission denied for quote conversion' using errcode = '42501';
  end if;

  p_order_number := private.next_business_number_locked('public.orders'::regclass, 'order_number', v_company_id, 'O', coalesce(p_order_date, (now() at time zone 'Asia/Kolkata')::date));
  select organization_type into v_user_org_type
  from public.app_users where id = v_user_id;

  select * into v_quote
  from public.quotes
  where id = p_quote_id and company_id = v_company_id and deleted_at is null
  for update;
  if not found then raise exception 'Quote not found' using errcode = '23514'; end if;
  if v_quote.status is distinct from 'customer_approved' then
    raise exception 'Only a customer-approved quote can become an order' using errcode = '23514';
  end if;
  if v_user_role in ('dealer_admin','dealer_staff')
     and (v_user_dealer_id is null or v_quote.dealer_id is distinct from v_user_dealer_id) then
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
    v_available_dealer_weight := public.get_dealer_quote_stock_availability(p_quote_id);
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

  insert into private.quote_fulfillment_authorizations(transaction_id,company_id,quote_id,actor_id)
  values(txid_current(),v_company_id,p_quote_id,v_user_id);

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
          'quantity_kg', v_line.required_weight_kg,
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
          and batch.status in ('available','reserved')
          and batch.total_weight_kg > 0
          and regexp_replace(lower(btrim(coalesce(batch.finish,'mill_finish'))),'[^a-z0-9]+','_','g') =
              regexp_replace(lower(btrim(coalesce(v_line.finishing_type,'mill_finish'))),'[^a-z0-9]+','_','g')
        order by batch.created_at, batch.id
        for update
      loop
        exit when v_line_remaining <= 0.001 or v_remaining_dealer_weight <= 0.001;
        select coalesce(sum(greatest(reservation.reserved_weight_kg - coalesce((
          select sum(consumption.consumed_weight_kg)
          from public.profile_stock_consumptions consumption
          where consumption.company_id = v_company_id and consumption.reservation_id = reservation.id
        ),0),0)),0)
        into v_reserved_weight
        from public.profile_stock_reservations reservation
        where reservation.company_id = v_company_id
          and reservation.profile_stock_batch_id = v_batch.id
          and reservation.status = 'active';
        v_available_weight := round(greatest(v_batch.total_weight_kg - v_reserved_weight, 0), 3);
        if v_available_weight <= 0 then continue; end if;

        v_consume_weight := least(v_line_remaining, v_remaining_dealer_weight, v_available_weight);
        v_new_batch_weight := round(v_batch.total_weight_kg - v_consume_weight, 3);
        if coalesce(v_batch.quantity_pieces,0) <= 0 or coalesce(v_batch.length_m,0) <= 0 then
          raise exception 'Dealer stock requires exact piece and metre provenance before fulfillment' using errcode='23514';
        end if;
        v_consumed_pieces := round(v_consume_weight * v_batch.quantity_pieces / v_batch.total_weight_kg)::integer;
        if v_consumed_pieces <= 0 or abs(v_consume_weight - round(
          v_batch.total_weight_kg * v_consumed_pieces / v_batch.quantity_pieces,3)) > 0.001 then
          raise exception 'Dealer stock fulfillment must consume exact whole pieces; record a cutting adjustment first' using errcode='23514';
        end if;
        v_new_piece_count := v_batch.quantity_pieces - v_consumed_pieces;
        v_consumed_length := round(v_batch.length_m * v_consumed_pieces / v_batch.quantity_pieces,3);

        insert into public.order_dealer_stock_fulfillments (
          company_id, order_id, quote_id, quote_item_id, order_item_id,
          profile_id, profile_stock_batch_id, finishing_type, unit_rate,
          quoted_line_value, fulfilled_weight_kg, fulfilled_length_m,
          fulfilled_pieces, notes, created_by
        ) values (
          v_company_id, v_order_id, p_quote_id, v_line.id, v_order_item_id,
          v_line.profile_id, v_batch.id, v_line.finishing_type, v_line.unit_rate,
          v_line.line_total_before_gst, v_consume_weight,
          v_consumed_length,
          v_consumed_pieces,
          'Dealer stock debit with exact quote/order/finish/rate lineage',
          v_user_id
        );

        update public.profile_stock_batches
        set total_weight_kg = v_new_batch_weight,
            quantity_pieces = v_new_piece_count,
            length_m = round(v_batch.length_m - v_consumed_length,3),
            status = case when v_new_batch_weight <= 0 then 'dispatched' else status end,
            updated_at = now()
        where id = v_batch.id and company_id = v_company_id;

        update public.order_items
        set dealer_fulfilled_weight_kg = dealer_fulfilled_weight_kg + v_consume_weight,
            manufacturing_weight_kg = greatest(manufacturing_weight_kg - v_consume_weight,0),
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
  delete from private.quote_fulfillment_authorizations
    where transaction_id=txid_current() and company_id=v_company_id and quote_id=p_quote_id and actor_id=v_user_id;
  return v_order_id;
end;
$$;

create or replace function private.guard_order_workflow_writes()
returns trigger language plpgsql set search_path = public, private as $$
declare
  v_role text := private.get_current_user_role();
begin
  if auth.uid() is null or v_role in ('owner','admin') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if current_user = 'authenticated' then
    raise exception 'Orders must be created or changed through an authorized order workflow' using errcode='42501';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Only owners and admins may delete orders' using errcode='42501';
  end if;
  if tg_op='UPDATE' and exists(
    select 1 from private.quote_fulfillment_authorizations auth_record
    where auth_record.transaction_id=txid_current() and auth_record.company_id=new.company_id
      and auth_record.quote_id=new.quote_id and auth_record.actor_id=auth.uid()
  ) then
    if (to_jsonb(new)-array['dealer_fulfilled_weight_kg','manufacturing_weight_kg','fulfillment_notes','updated_at'])
      is distinct from (to_jsonb(old)-array['dealer_fulfilled_weight_kg','manufacturing_weight_kg','fulfillment_notes','updated_at'])
      or new.dealer_fulfilled_weight_kg < 0
      or new.manufacturing_weight_kg < 0
      or abs(new.requested_weight_kg-new.dealer_fulfilled_weight_kg-new.manufacturing_weight_kg)>0.001 then
      raise exception 'Quote fulfillment may only reconcile its authorized physical balances' using errcode='42501';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and (
    new.company_id is distinct from old.company_id
    or new.order_number is distinct from old.order_number
    or new.quote_id is distinct from old.quote_id
    or new.customer_id is distinct from old.customer_id
    or new.dealer_id is distinct from old.dealer_id
    or new.order_date is distinct from old.order_date
    or new.order_value is distinct from old.order_value
    or new.requested_weight_kg is distinct from old.requested_weight_kg
    or new.manufacturing_weight_kg is distinct from old.manufacturing_weight_kg
    or new.production_profile_id is distinct from old.production_profile_id
    or new.production_die_id is distinct from old.production_die_id
    or new.production_quantity_kg is distinct from old.production_quantity_kg
    or new.production_pieces is distinct from old.production_pieces
    or new.billet_diameter_required_inch is distinct from old.billet_diameter_required_inch
  ) then
    raise exception 'Order value, source, identity, and production requirements cannot be changed through the operational order workflow' using errcode='42501';
  end if;
  if tg_op = 'INSERT' and v_role in ('production','production_manager','factory_manager','dispatch_manager','dispatch','inventory_manager')
    and new.quote_id is null and coalesce(new.order_value, 0) <> 0 then
    raise exception 'Operational order creation cannot set a manual commercial value; use an approved quote' using errcode='42501';
  end if;
  return new;
end;
$$;

create or replace function private.guard_order_item_workflow_writes()
returns trigger language plpgsql set search_path = public, private as $$
declare
  v_role text := private.get_current_user_role();
begin
  if auth.uid() is null or v_role in ('owner','admin') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op='UPDATE' and current_user<>'authenticated' then
  if exists(
    select 1 from private.quote_fulfillment_authorizations auth_record
    join public.orders order_record on order_record.quote_id=auth_record.quote_id
      and order_record.company_id=auth_record.company_id
    where auth_record.transaction_id=txid_current() and auth_record.company_id=new.company_id
      and order_record.id=new.order_id and auth_record.actor_id=auth.uid()
  ) then
    if (to_jsonb(new)-array['dealer_fulfilled_weight_kg','manufacturing_weight_kg','updated_at'])
      is distinct from (to_jsonb(old)-array['dealer_fulfilled_weight_kg','manufacturing_weight_kg','updated_at'])
      or new.dealer_fulfilled_weight_kg < 0 or new.manufacturing_weight_kg < 0
      or not exists(
        select 1 from public.quote_items source
        where source.id=new.quote_item_id and source.company_id=new.company_id
          and abs(coalesce(source.billing_weight_kg,source.total_weight_kg,0)
            -new.dealer_fulfilled_weight_kg-new.manufacturing_weight_kg)<=0.001
      ) then
      raise exception 'Quote fulfillment may only reconcile its exact source-line balances' using errcode='42501';
    end if;
    return new;
  end if;
  end if;
  if tg_op <> 'INSERT' or current_user = 'authenticated' then
    raise exception 'Order lines must be created or changed through an authorized order workflow' using errcode='42501';
  end if;
  if new.quote_item_id is null or new.source_line_id is distinct from new.quote_item_id or not exists (
    select 1 from public.quote_items qi
    join public.orders o on o.id=new.order_id and o.company_id=new.company_id
    where qi.id=new.quote_item_id and qi.company_id=new.company_id
      and qi.quote_id=o.quote_id
  ) then
    raise exception 'Operational order lines must preserve the approved quote line source' using errcode='42501';
  end if;
  return new;
end;
$$;
create or replace function private.enforce_dealer_fulfillment_lineage()
returns trigger language plpgsql security definer set search_path=public,private as $$
declare
  v_order public.orders%rowtype;
  v_quote_item public.quote_items%rowtype;
  v_order_item public.order_items%rowtype;
  v_batch public.profile_stock_batches%rowtype;
begin
  select * into v_order from public.orders where id=new.order_id and company_id=new.company_id;
  if not found then raise exception 'Dealer fulfillment order is unavailable'; end if;
  if new.quote_item_id is null or new.order_item_id is null then
    raise exception 'Dealer fulfillment requires exact quote and order line identity';
  end if;
  select * into v_quote_item from public.quote_items where id=new.quote_item_id
    and company_id=new.company_id and quote_id=v_order.quote_id;
  if not found then raise exception 'Dealer fulfillment quote line does not belong to the order'; end if;
  select * into v_order_item from public.order_items where id=new.order_item_id
    and company_id=new.company_id and order_id=new.order_id and quote_item_id=new.quote_item_id;
  if not found then raise exception 'Dealer fulfillment order line does not match its quote line'; end if;
  select * into v_batch from public.profile_stock_batches where id=new.profile_stock_batch_id
    and company_id=new.company_id and profile_id=v_quote_item.profile_id;
  if not found or v_order.dealer_id is null or v_batch.dealer_id is distinct from v_order.dealer_id then
    raise exception 'Dealer fulfillment stock batch does not match its quote profile and dealership';
  end if;
  if regexp_replace(lower(btrim(coalesce(v_batch.finish,'mill_finish'))),'[^a-z0-9]+','_','g') <>
    regexp_replace(lower(btrim(coalesce(v_quote_item.finishing_type,'mill_finish'))),'[^a-z0-9]+','_','g') then
    raise exception 'Dealer stock finish does not match the quoted finish';
  end if;
  if coalesce(v_quote_item.net_rate,v_quote_item.price_per_kg,0)<=0 then
    raise exception 'Dealer fulfillment quote line requires a positive commercial rate';
  end if;
  new.quote_id:=v_order.quote_id;
  new.profile_id:=v_quote_item.profile_id;
  new.finishing_type:=coalesce(v_quote_item.finishing_type,'mill_finish');
  new.unit_rate:=coalesce(v_quote_item.net_rate,v_quote_item.price_per_kg);
  new.quoted_line_value:=v_quote_item.line_total_before_gst;
  return new;
end;
$$;
revoke all on function private.enforce_dealer_fulfillment_lineage() from public,anon,authenticated;

revoke all on function private.create_order_from_quote_with_dealer_stock(uuid,text,date,date,text,numeric,text) from public,anon;
revoke all on function private.guard_order_workflow_writes() from public,anon,authenticated;
revoke all on function private.guard_order_item_workflow_writes() from public,anon,authenticated;

commit;


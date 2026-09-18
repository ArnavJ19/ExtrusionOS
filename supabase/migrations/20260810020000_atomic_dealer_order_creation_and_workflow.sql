begin;

create or replace function private.create_dealer_order_atomic(
  p_dealer_id uuid,
  p_priority text,
  p_delivery_address text,
  p_expected_delivery_date date,
  p_notes text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_user_id uuid := auth.uid();
  v_role text := private.get_current_user_role();
  v_context_dealer_id uuid := private.get_current_user_dealer_id();
  v_order_id uuid;
  v_order_number text;
  v_item jsonb;
begin
  if v_company_id is null or v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if v_role not in ('owner','admin','sales_manager','sales','factory_manager','dealer_admin','dealer_staff') then
    raise exception 'Permission denied to create dealer orders' using errcode = '42501';
  end if;
  if p_dealer_id is null or not exists (
    select 1 from public.dealers
    where id = p_dealer_id and company_id = v_company_id and is_active = true
  ) then
    raise exception 'Dealer assignment is not available for this company' using errcode = '23514';
  end if;
  if v_context_dealer_id is not null and v_context_dealer_id <> p_dealer_id then
    raise exception 'Dealer users can only create orders for their own dealership' using errcode = '42501';
  end if;
  if coalesce(p_priority, 'normal') not in ('low','normal','high','urgent') then
    raise exception 'Invalid dealer order priority' using errcode = '23514';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'A dealer order requires at least one line item' using errcode = '23514';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if nullif(btrim(v_item ->> 'item_description'), '') is null
       or coalesce((v_item ->> 'quantity')::numeric, 0) <= 0
       or (v_item ->> 'item_type') not in ('profile','hardware','accessory','glass','gasket','fastener','other')
       or (v_item ->> 'unit') not in ('pieces','meters','kg','set','box') then
      raise exception 'Dealer order contains an invalid line item' using errcode = '23514';
    end if;
    if nullif(v_item ->> 'inventory_item_id', '') is not null and not exists (
      select 1 from public.inventory_items
      where id = (v_item ->> 'inventory_item_id')::uuid and company_id = v_company_id
    ) then
      raise exception 'Dealer order line inventory item is not available for this company' using errcode = '23514';
    end if;
  end loop;

  v_order_number := private.next_business_number_locked(
    'public.dealer_orders'::regclass, 'order_number', v_company_id, 'DO', current_date
  );

  insert into public.dealer_orders (
    company_id, dealer_id, order_number, created_by_dealer_user_id,
    priority, delivery_address, expected_delivery_date, notes, status
  ) values (
    v_company_id, p_dealer_id, v_order_number, v_user_id,
    coalesce(p_priority, 'normal'), p_delivery_address, p_expected_delivery_date,
    p_notes, 'dealer_order_submitted'
  ) returning id into v_order_id;

  insert into public.dealer_order_items (
    company_id, dealer_order_id, inventory_item_id, item_type, item_description,
    quantity, unit, finish, size_description, system_type
  )
  select v_company_id, v_order_id,
    nullif(line ->> 'inventory_item_id', '')::uuid,
    line ->> 'item_type', line ->> 'item_description',
    (line ->> 'quantity')::numeric, line ->> 'unit',
    nullif(line ->> 'finish', ''), nullif(line ->> 'size_description', ''),
    nullif(line ->> 'system_type', '')
  from jsonb_array_elements(p_items) as line;

  insert into public.dealer_order_status_history (
    company_id, dealer_order_id, new_status, changed_by, notes
  ) values (v_company_id, v_order_id, 'dealer_order_submitted', v_user_id, p_notes);

  insert into public.notifications (
    company_id, dealer_id, recipient_role, notification_type, severity, title,
    body, related_entity_type, related_entity_id, entity_reference, action_link, created_by
  ) values (
    v_company_id, p_dealer_id, 'factory_manager', 'dealer_order_submitted', 'info',
    'New dealer order submitted', v_order_number || ' is waiting for factory review.',
    'dealer_order', v_order_id, v_order_number, '/dealer-orders/' || v_order_id::text, v_user_id
  );

  insert into public.audit_logs_enterprise (
    company_id, actor_user_id, actor_role, actor_company_id, actor_dealer_id,
    action_type, module_name, entity_type, entity_id, new_value, change_summary
  ) values (
    v_company_id, v_user_id, v_role, v_company_id, v_context_dealer_id,
    'dealer_order_submitted', 'dealer_orders', 'dealer_order', v_order_id,
    jsonb_build_object('orderNumber', v_order_number, 'items', p_items),
    v_order_number || ' submitted as a dealer order'
  );

  return jsonb_build_object('id', v_order_id, 'order_number', v_order_number, 'status', 'dealer_order_submitted');
end;
$$;

create or replace function public.create_dealer_order_atomic(
  p_dealer_id uuid,
  p_priority text,
  p_delivery_address text,
  p_expected_delivery_date date,
  p_notes text,
  p_items jsonb
)
returns jsonb
language sql
security definer
set search_path = public, private
as $$ select private.create_dealer_order_atomic($1, $2, $3, $4, $5, $6) $$;

revoke all on function private.create_dealer_order_atomic(uuid, text, text, date, text, jsonb) from public, anon, authenticated;
revoke all on function public.create_dealer_order_atomic(uuid, text, text, date, text, jsonb) from public, anon;
grant execute on function public.create_dealer_order_atomic(uuid, text, text, date, text, jsonb) to authenticated;

create or replace function private.transition_dealer_order_atomic(
  p_dealer_order_id uuid,
  p_status text,
  p_factory_committed_date date,
  p_clarification_required boolean,
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_user_id uuid := auth.uid();
  v_role text := private.get_current_user_role();
  v_current public.dealer_orders%rowtype;
  v_next_status text := p_status;
  v_dealer_admin_id uuid;
begin
  if v_company_id is null or v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if private.get_current_user_dealer_id() is not null
     or v_role not in ('owner','admin','factory_manager','production_manager','sales_manager','sales') then
    raise exception 'Only authorized factory users can update dealer order workflow' using errcode = '42501';
  end if;

  select * into v_current
  from public.dealer_orders
  where id = p_dealer_order_id and company_id = v_company_id
  for update;
  if not found then raise exception 'Dealer order not found for this company' using errcode = '23514'; end if;

  if p_clarification_required then
    v_next_status := 'rejected_by_factory';
  end if;
  if v_next_status is null then v_next_status := v_current.status; end if;
  if v_next_status not in ('dealer_order_submitted','accepted_by_factory','rejected_by_factory','material_reserved','production_scheduled','in_production','production_completed','quality_check_pending','quality_check_passed','packed','dispatched','in_transit','delivered_to_dealer','pending_dealer_count','received_confirmed','discrepancy_reported','recount_requested','discrepancy_resolved','closed','cancelled') then
    raise exception 'Invalid dealer order workflow status' using errcode = '23514';
  end if;

  if v_next_status <> v_current.status and not (
    (v_current.status = 'dealer_order_submitted' and v_next_status in ('accepted_by_factory','rejected_by_factory','cancelled'))
    or (v_current.status = 'rejected_by_factory' and v_next_status in ('dealer_order_submitted','cancelled'))
    or (v_current.status = 'accepted_by_factory' and v_next_status in ('material_reserved','rejected_by_factory','cancelled'))
    or (v_current.status = 'material_reserved' and v_next_status in ('production_scheduled','cancelled'))
    or (v_current.status = 'production_scheduled' and v_next_status in ('in_production','cancelled'))
    or (v_current.status = 'in_production' and v_next_status in ('production_completed','cancelled'))
    or (v_current.status = 'production_completed' and v_next_status = 'quality_check_pending')
    or (v_current.status = 'quality_check_pending' and v_next_status = 'quality_check_passed')
    or (v_current.status = 'quality_check_passed' and v_next_status = 'packed')
    or (v_current.status = 'packed' and v_next_status = 'dispatched')
    or (v_current.status = 'dispatched' and v_next_status = 'in_transit')
    or (v_current.status = 'in_transit' and v_next_status = 'delivered_to_dealer')
    or (v_current.status = 'delivered_to_dealer' and v_next_status = 'pending_dealer_count')
    or (v_current.status = 'pending_dealer_count' and v_next_status in ('received_confirmed','discrepancy_reported'))
    or (v_current.status = 'discrepancy_reported' and v_next_status = 'recount_requested')
    or (v_current.status = 'recount_requested' and v_next_status = 'discrepancy_resolved')
    or (v_current.status = 'discrepancy_resolved' and v_next_status = 'closed')
    or (v_current.status = 'received_confirmed' and v_next_status = 'closed')
  ) then
    raise exception 'Illegal dealer order transition from % to %', v_current.status, v_next_status using errcode = '23514';
  end if;

  update public.dealer_orders
  set status = v_next_status,
      last_factory_update_at = now(),
      factory_committed_date = case when p_factory_committed_date is null then factory_committed_date else p_factory_committed_date end,
      accepted_by = case when v_next_status = 'accepted_by_factory' then v_user_id else accepted_by end,
      accepted_at = case when v_next_status = 'accepted_by_factory' then now() else accepted_at end,
      rejection_reason = case when p_clarification_required then nullif(btrim(p_notes), '') else rejection_reason end,
      clarification_required_at = case when p_clarification_required then now() else clarification_required_at end,
      clarification_resolved_at = case when p_clarification_required = false and v_current.status = 'rejected_by_factory' then now() else clarification_resolved_at end,
      updated_at = now()
  where id = v_current.id and company_id = v_company_id;

  insert into public.dealer_order_status_history (
    company_id, dealer_order_id, previous_status, new_status, changed_by, notes
  ) values (v_company_id, v_current.id, v_current.status, v_next_status, v_user_id, p_notes);

  if p_clarification_required then
    select id into v_dealer_admin_id from public.app_users
    where company_id = v_company_id and dealer_id = v_current.dealer_id
      and role = 'dealer_admin' and is_active = true limit 1;
    insert into public.tasks (
      company_id, dealership_id, task_type, title, description, priority, status,
      assigned_to, related_entity_type, related_entity_id, created_by, assigned_by_user_id, due_date
    ) values (
      v_company_id, v_current.dealer_id, 'dealer_order_clarification',
      'Clarify ' || v_current.order_number,
      coalesce(nullif(btrim(p_notes), ''), 'Factory needs clarification before proceeding.'),
      'urgent', 'open', v_dealer_admin_id, 'dealer_order', v_current.id,
      v_user_id, v_user_id, current_date
    );
  end if;

  insert into public.notifications (
    company_id, dealer_id, recipient_role, notification_type, severity, title,
    body, related_entity_type, related_entity_id, entity_reference, action_link, created_by
  ) values (
    v_company_id, v_current.dealer_id, 'dealer_admin',
    case when p_clarification_required then 'dealer_order_clarification_required' else 'dealer_order_status_changed' end,
    case when p_clarification_required then 'warning' else 'info' end,
    case when p_clarification_required then 'Factory needs clarification' else 'Dealer order status updated' end,
    case when p_clarification_required then v_current.order_number || ': ' || coalesce(nullif(btrim(p_notes), ''), 'Please clarify order details.')
         else v_current.order_number || ' is now ' || replace(v_next_status, '_', ' ') end,
    'dealer_order', v_current.id, v_current.order_number, '/dealer-orders/' || v_current.id::text, v_user_id
  );

  insert into public.audit_logs_enterprise (
    company_id, actor_user_id, actor_role, actor_company_id,
    action_type, module_name, entity_type, entity_id, previous_value, new_value, change_summary
  ) values (
    v_company_id, v_user_id, v_role, v_company_id, 'dealer_order_status_updated',
    'dealer_orders', 'dealer_order', v_current.id,
    jsonb_build_object('status', v_current.status),
    jsonb_build_object('status', v_next_status, 'factoryCommittedDate', p_factory_committed_date, 'clarificationRequired', p_clarification_required),
    v_current.order_number || ' moved to ' || replace(v_next_status, '_', ' ')
  );

  return jsonb_build_object('id', v_current.id, 'order_number', v_current.order_number, 'status', v_next_status);
end;
$$;

create or replace function public.transition_dealer_order_atomic(
  p_dealer_order_id uuid,
  p_status text,
  p_factory_committed_date date,
  p_clarification_required boolean,
  p_notes text
)
returns jsonb
language sql
security definer
set search_path = public, private
as $$ select private.transition_dealer_order_atomic($1, $2, $3, $4, $5) $$;

revoke all on function private.transition_dealer_order_atomic(uuid, text, date, boolean, text) from public, anon, authenticated;
revoke all on function public.transition_dealer_order_atomic(uuid, text, date, boolean, text) from public, anon;
grant execute on function public.transition_dealer_order_atomic(uuid, text, date, boolean, text) to authenticated;

commit;

begin;

-- Direct onboarding inserts must identify the authenticated creator. The
-- atomic onboarding RPC remains the authoritative multi-table workflow.
drop policy if exists "companies insert authenticated" on public.companies;
create policy "companies insert authenticated" on public.companies
  for insert
  with check (auth.uid() is not null and created_by = auth.uid());

-- Comments are a business mutation. Dealers retain their own dealer-scoped
-- path; internal users need the create-orders capability rather than read-only
-- order visibility.
drop policy if exists "dealer order comments tenant insert" on public.dealer_order_comments;
create policy "dealer order comments tenant insert" on public.dealer_order_comments
  for insert
  with check (
    company_id = public.get_current_user_company_id()
    and exists (
      select 1
      from public.dealer_orders o
      where o.id = dealer_order_comments.dealer_order_id
        and o.company_id = dealer_order_comments.company_id
        and (
          (public.get_current_user_dealer_id() is not null
            and o.dealer_id = public.get_current_user_dealer_id()
            and visibility = 'dealer_factory')
          or (public.get_current_user_dealer_id() is null
            and public.current_user_has_permission('create_orders'))
        )
    )
  );

-- Prevent duplicate receipt headers under concurrent retries. The application
-- still needs an atomic receipt RPC before this workflow is release-grade.
do $$
begin
  if exists (
    select 1
    from public.dealer_receipts
    group by company_id, shipment_id
    having count(*) > 1
  ) then
    raise exception 'Cannot create dealer receipt uniqueness: duplicate shipment receipts exist';
  end if;
end;
$$;

create unique index if not exists dealer_receipts_company_shipment_unique
  on public.dealer_receipts(company_id, shipment_id);

-- Enforce profile master-data lineage at the database boundary as well as in
-- the API route. Existing cross-tenant rows are not modified by this change.
create or replace function public.validate_profile_stock_batch_profile_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.aluminium_profiles p
    where p.id = new.profile_id
      and p.company_id = new.company_id
  ) then
    raise exception 'Profile does not belong to the stock batch company';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_profile_stock_batch_profile_company on public.profile_stock_batches;
create trigger validate_profile_stock_batch_profile_company
  before insert or update of company_id, profile_id on public.profile_stock_batches
  for each row execute function public.validate_profile_stock_batch_profile_company();

revoke all on function public.validate_profile_stock_batch_profile_company() from public;

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
  v_company_id uuid;
  v_user_id uuid := auth.uid();
  v_role text;
  v_user_dealer_id uuid;
  v_shipment public.shipments%rowtype;
  v_existing public.dealer_receipts%rowtype;
  v_receipt_id uuid;
  v_audit_id uuid;
  v_has_mismatch boolean;
  v_line_count integer;
  v_matched_line_count integer;
  v_shipment_line_count integer;
begin
  v_company_id := public.get_current_user_company_id();
  v_role := public.get_current_user_role();
  v_user_dealer_id := public.get_current_user_dealer_id();

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

  select * into v_shipment
  from public.shipments
  where id = p_shipment_id
    and company_id = v_company_id
    and dealer_id = p_dealer_id
  for update;
  if not found then
    raise exception 'Shipment not found';
  end if;

  if v_shipment.status in ('received_confirmed', 'discrepancy_reported', 'closed') then
    select * into v_existing
    from public.dealer_receipts
    where company_id = v_company_id and shipment_id = p_shipment_id
    order by created_at desc
    limit 1;
    if found then
      return jsonb_build_object('receiptId', v_existing.id, 'status', v_existing.status, 'idempotent', true);
    end if;
    raise exception 'Shipment receipt is already closed';
  end if;

  select count(*) into v_line_count
  from jsonb_to_recordset(p_lines) as line(
    shipment_item_id uuid,
    expected_quantity numeric,
    reported_received_quantity numeric,
    inventory_item_id uuid,
    unit text,
    notes text
  );
  select count(*) into v_shipment_line_count
  from public.shipment_items
  where company_id = v_company_id and shipment_id = p_shipment_id;
  if v_line_count <> v_shipment_line_count then
    raise exception 'Receipt must include every shipment line';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_lines) as line(
      shipment_item_id uuid,
      expected_quantity numeric,
      reported_received_quantity numeric,
      inventory_item_id uuid,
      unit text,
      notes text
    )
    group by line.shipment_item_id
    having count(*) > 1
  ) then
    raise exception 'Receipt contains duplicate shipment lines';
  end if;

  select count(*) into v_matched_line_count
  from jsonb_to_recordset(p_lines) as line(
    shipment_item_id uuid,
    expected_quantity numeric,
    reported_received_quantity numeric,
    inventory_item_id uuid,
    unit text,
    notes text
  )
  join public.shipment_items item
    on item.id = line.shipment_item_id
   and item.company_id = v_company_id
   and item.shipment_id = p_shipment_id
   and item.inventory_item_id = line.inventory_item_id
   and item.unit = line.unit
   and item.expected_quantity = line.expected_quantity
  where line.reported_received_quantity >= 0;
  if v_matched_line_count <> v_line_count then
    raise exception 'Receipt line does not match shipment source data';
  end if;

  if p_dealer_order_id is not null and not exists (
    select 1 from public.dealer_orders
    where id = p_dealer_order_id and company_id = v_company_id and dealer_id = p_dealer_id
  ) then
    raise exception 'Dealer order does not match shipment ownership';
  end if;

  select exists (
    select 1
    from jsonb_to_recordset(p_lines) as line(
      shipment_item_id uuid,
      expected_quantity numeric,
      reported_received_quantity numeric,
      inventory_item_id uuid,
      unit text,
      notes text
    )
    where line.reported_received_quantity <> line.expected_quantity
  ) into v_has_mismatch;

  insert into public.audit_logs_enterprise (
    company_id, actor_user_id, actor_role, actor_company_id, actor_dealer_id,
    action_type, module_name, entity_type, entity_id, new_value,
    change_summary, ip_address, user_agent, device_session_id, related_shipment_id
  ) values (
    v_company_id, v_user_id, v_role, v_company_id, p_dealer_id,
    case when v_has_mismatch then 'dealer_reported_quantity_mismatch' else 'dealer_confirmed_receipt' end,
    'dealer_inventory', 'shipment', p_shipment_id, p_lines,
    case when v_has_mismatch then 'Dealer receipt submitted with quantity mismatch' else 'Dealer receipt confirmed' end,
    p_ip_address, p_user_agent, p_device_session_id, p_shipment_id
  ) returning id into v_audit_id;

  insert into public.dealer_receipts (
    company_id, dealer_id, shipment_id, received_by_user_id,
    received_by_role, status, notes, ip_address, user_agent, device_session_id
  ) values (
    v_company_id, p_dealer_id, p_shipment_id, v_user_id,
    v_role, case when v_has_mismatch then 'discrepancy_reported' else 'confirmed' end,
    p_notes, p_ip_address, p_user_agent, p_device_session_id
  ) returning id into v_receipt_id;

  insert into public.dealer_receipt_items (
    company_id, dealer_receipt_id, shipment_item_id,
    expected_quantity, reported_received_quantity, status, notes
  )
  select v_company_id, v_receipt_id, line.shipment_item_id,
    line.expected_quantity, line.reported_received_quantity,
    case when line.reported_received_quantity = line.expected_quantity
      then 'received_confirmed' else 'discrepancy_reported' end,
    line.notes
  from jsonb_to_recordset(p_lines) as line(
    shipment_item_id uuid,
    expected_quantity numeric,
    reported_received_quantity numeric,
    inventory_item_id uuid,
    unit text,
    notes text
  );

  update public.shipment_items item
  set status = case when line.reported_received_quantity = line.expected_quantity
    then 'received_confirmed' else 'discrepancy_reported' end
  from jsonb_to_recordset(p_lines) as line(
    shipment_item_id uuid,
    expected_quantity numeric,
    reported_received_quantity numeric,
    inventory_item_id uuid,
    unit text,
    notes text
  )
  where item.id = line.shipment_item_id and item.company_id = v_company_id;

  insert into public.inventory_transactions (
    company_id, inventory_item_id, item_type, quantity, unit, inventory_state,
    from_owner_type, from_owner_id, to_owner_type, to_owner_id,
    dealer_order_id, shipment_id, created_by_user_id, created_by_role,
    reason, status, audit_log_id
  )
  select v_company_id, line.inventory_item_id, 'other', line.reported_received_quantity,
    line.unit, 'dealer_inventory_on_hand', 'dealer', p_dealer_id, 'dealer', p_dealer_id,
    p_dealer_order_id, p_shipment_id, v_user_id, v_role,
    'Dealer confirmed receipt', 'posted', v_audit_id
  from jsonb_to_recordset(p_lines) as line(
    shipment_item_id uuid,
    expected_quantity numeric,
    reported_received_quantity numeric,
    inventory_item_id uuid,
    unit text,
    notes text
  )
  where line.reported_received_quantity = line.expected_quantity
    and line.reported_received_quantity > 0;

  insert into public.inventory_discrepancies (
    company_id, dealer_id, dealer_order_id, shipment_id, shipment_item_id,
    expected_quantity, reported_quantity, difference_quantity, status,
    reported_by_user_id, reported_by_role
  )
  select v_company_id, p_dealer_id, p_dealer_order_id, p_shipment_id,
    line.shipment_item_id, line.expected_quantity, line.reported_received_quantity,
    line.reported_received_quantity - line.expected_quantity, 'open', v_user_id, v_role
  from jsonb_to_recordset(p_lines) as line(
    shipment_item_id uuid,
    expected_quantity numeric,
    reported_received_quantity numeric,
    inventory_item_id uuid,
    unit text,
    notes text
  )
  where line.reported_received_quantity <> line.expected_quantity;

  update public.shipments
  set status = case when v_has_mismatch then 'discrepancy_reported' else 'received_confirmed' end,
      updated_at = now()
  where id = p_shipment_id and company_id = v_company_id;

  return jsonb_build_object(
    'receiptId', v_receipt_id,
    'status', case when v_has_mismatch then 'discrepancy_reported' else 'confirmed' end,
    'idempotent', false
  );
end;
$$;

revoke all on function public.submit_dealer_receipt_atomic(uuid, uuid, uuid, text, jsonb, text, text, text) from public, anon;
grant execute on function public.submit_dealer_receipt_atomic(uuid, uuid, uuid, text, jsonb, text, text, text) to authenticated;

create table if not exists public.production_job_status_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  production_job_id uuid not null references public.production_jobs(id) on delete cascade,
  previous_status text not null,
  new_status text not null,
  reason text,
  changed_by uuid not null references auth.users(id),
  changed_by_role text not null,
  created_at timestamptz not null default now()
);

create index if not exists production_job_status_history_job_idx
  on public.production_job_status_history(company_id, production_job_id, created_at desc);

alter table public.production_job_status_history enable row level security;
drop policy if exists "production job status history tenant read" on public.production_job_status_history;
create policy "production job status history tenant read"
  on public.production_job_status_history for select
  using (company_id = public.get_current_user_company_id());

revoke all on public.production_job_status_history from anon, authenticated;

create or replace function private.transition_production_job_atomic(
  p_job_id uuid,
  p_status text,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_job public.production_jobs%rowtype;
  v_has_released_slot boolean;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if v_role not in ('owner', 'admin', 'factory_manager', 'production_manager', 'production') then
    raise exception 'Permission denied to transition production jobs' using errcode = '42501';
  end if;
  if p_status not in ('planned', 'ready', 'in_progress', 'on_hold', 'cancelled') then
    raise exception 'Use the completion workflow for completed production jobs' using errcode = '23514';
  end if;

  select * into v_job
  from public.production_jobs
  where id = p_job_id and company_id = v_company_id
  for update;
  if not found then
    raise exception 'Production job not found for this company' using errcode = '23514';
  end if;

  if p_status = v_job.status then
    return v_job.id;
  end if;

  if not (
    (v_job.status = 'planned' and p_status in ('on_hold', 'cancelled'))
    or (v_job.status = 'ready' and p_status in ('in_progress', 'on_hold', 'cancelled'))
    or (v_job.status = 'in_progress' and p_status = 'on_hold')
    or (v_job.status = 'on_hold' and p_status in ('in_progress', 'cancelled'))
  ) then
    raise exception 'Illegal production status transition from % to %', v_job.status, p_status using errcode = '23514';
  end if;

  if p_status in ('in_progress', 'on_hold') and v_job.machine_id is null then
    raise exception 'Assign an extrusion press before starting or holding production' using errcode = '23514';
  end if;

  if p_status = 'in_progress' then
    select exists (
      select 1 from public.production_plan_slots slot
      where slot.company_id = v_company_id
        and slot.production_job_id = v_job.id
        and slot.machine_id = v_job.machine_id
        and slot.status = 'released'
    ) into v_has_released_slot;
    if not v_has_released_slot then
      raise exception 'Production job requires a released press slot before it can start' using errcode = '23514';
    end if;
  end if;

  update public.production_jobs
  set status = p_status,
      remarks = case
        when nullif(btrim(p_reason), '') is null then remarks
        when nullif(btrim(remarks), '') is null then btrim(p_reason)
        else remarks || E'\n' || btrim(p_reason)
      end,
      updated_at = now()
  where id = v_job.id and company_id = v_company_id;

  insert into public.production_job_status_history (
    company_id, production_job_id, previous_status, new_status,
    reason, changed_by, changed_by_role
  ) values (
    v_company_id, v_job.id, v_job.status, p_status,
    nullif(btrim(p_reason), ''), auth.uid(), v_role
  );

  return v_job.id;
end;
$$;

create or replace function public.transition_production_job_atomic(
  p_job_id uuid,
  p_status text,
  p_reason text default null
)
returns uuid
language sql
security definer
set search_path = public, private
as $$ select private.transition_production_job_atomic(p_job_id, p_status, p_reason) $$;

revoke all on function private.transition_production_job_atomic(uuid, text, text) from public, anon, authenticated;
revoke all on function public.transition_production_job_atomic(uuid, text, text) from public, anon;
grant execute on function public.transition_production_job_atomic(uuid, text, text) to authenticated;

revoke update on public.production_jobs from anon, authenticated;

commit;

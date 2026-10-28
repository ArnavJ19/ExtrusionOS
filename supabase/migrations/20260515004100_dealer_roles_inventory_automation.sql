-- Dealer role access and automatic dealer stock debit/credit on quote-order workflows.

alter table if exists public.profile_stock_batches add column if not exists dealer_id uuid references public.dealers(id) on delete set null;
alter table if exists public.order_dealer_stock_fulfillments add column if not exists fulfilled_pieces integer not null default 0;
alter table if exists public.order_dealer_stock_fulfillments add column if not exists credited_at timestamptz;
create index if not exists profile_stock_batches_company_dealer_idx on public.profile_stock_batches(company_id, dealer_id, status, profile_id);

delete from public.role_permissions
where permission_key in ('manage_users', 'manage_roles')
  and role_id in (select id from public.roles where role_key <> 'owner');

insert into public.role_permissions(role_id, permission_key)
select r.id, p.permission_key
from public.roles r
cross join (values
  ('view_quotes'), ('create_quotes'), ('edit_quotes'),
  ('view_orders'), ('create_orders'), ('edit_orders'),
  ('view_inventory'), ('edit_inventory'), ('adjust_inventory'),
  ('view_dealer_inventory'), ('edit_dealer_inventory'), ('receive_dealer_inventory')
) as p(permission_key)
where r.role_key in ('dealer_admin', 'dealer_staff')
on conflict do nothing;

create or replace function public.current_user_has_permission(permission text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(public.get_current_user_role() = 'owner', false)
    or exists (
      select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id and r.is_active = true
      join public.role_permissions rp on rp.role_id = r.id
      where ur.user_id = auth.uid()
        and ur.company_id = public.get_current_user_company_id()
        and rp.permission_key = permission
        and (permission not in ('manage_users', 'manage_roles') or public.get_current_user_role() = 'owner')
    )
    or exists (
      select 1
      from public.roles r
      join public.role_permissions rp on rp.role_id = r.id
      where r.company_id = public.get_current_user_company_id()
        and r.role_key = public.get_current_user_role()
        and r.is_active = true
        and rp.permission_key = permission
        and (permission not in ('manage_users', 'manage_roles') or public.get_current_user_role() = 'owner')
    );
$$;

drop policy if exists "roles tenant manage" on public.roles;
create policy "roles tenant manage" on public.roles for all using (company_id = public.get_current_user_company_id() and public.get_current_user_role() = 'owner') with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() = 'owner');

drop policy if exists "role permissions tenant manage" on public.role_permissions;
create policy "role permissions tenant manage" on public.role_permissions for all using (exists (select 1 from public.roles r where r.id = role_permissions.role_id and r.company_id = public.get_current_user_company_id() and public.get_current_user_role() = 'owner')) with check (exists (select 1 from public.roles r where r.id = role_permissions.role_id and r.company_id = public.get_current_user_company_id() and public.get_current_user_role() = 'owner'));

drop policy if exists "user roles tenant manage" on public.user_roles;
create policy "user roles tenant manage" on public.user_roles for all using (company_id = public.get_current_user_company_id() and public.get_current_user_role() = 'owner') with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() = 'owner');

drop policy if exists "app users update admin non self" on public.app_users;
drop policy if exists "app users update owner non self" on public.app_users;
create policy "app users update owner non self" on public.app_users
  for update
  using (company_id = public.get_current_user_company_id() and public.get_current_user_role() = 'owner' and id <> auth.uid())
  with check (company_id = public.get_current_user_company_id() and id <> auth.uid());

drop policy if exists "quotes tenant insert" on public.quotes;
create policy "quotes tenant insert" on public.quotes for insert with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','sales_manager','sales','dealer_admin','dealer_staff'));
drop policy if exists "quotes tenant update" on public.quotes;
create policy "quotes tenant update" on public.quotes for update using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','sales_manager','sales','dealer_admin','dealer_staff')) with check (company_id = public.get_current_user_company_id());

drop policy if exists "quote items tenant insert" on public.quote_items;
create policy "quote items tenant insert" on public.quote_items for insert with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','sales_manager','sales','dealer_admin','dealer_staff'));
drop policy if exists "quote items tenant update" on public.quote_items;
create policy "quote items tenant update" on public.quote_items for update using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','sales_manager','sales','dealer_admin','dealer_staff')) with check (company_id = public.get_current_user_company_id());

drop policy if exists "orders tenant insert" on public.orders;
create policy "orders tenant insert" on public.orders for insert with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','sales_manager','sales','dealer_admin','dealer_staff'));
drop policy if exists "orders tenant update" on public.orders;
create policy "orders tenant update" on public.orders for update using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','sales_manager','sales','dealer_admin','dealer_staff','production_manager','production','dispatch_manager','dispatch')) with check (company_id = public.get_current_user_company_id());

drop policy if exists "inventory_items tenant insert" on public.inventory_items;
create policy "inventory_items tenant insert" on public.inventory_items for insert with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','inventory_manager','dealer_admin','dealer_staff','production_manager'));
drop policy if exists "inventory_items tenant update" on public.inventory_items;
create policy "inventory_items tenant update" on public.inventory_items for update using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','inventory_manager','dealer_admin','dealer_staff','production_manager')) with check (company_id = public.get_current_user_company_id());

drop policy if exists "profile_stock_batches tenant insert" on public.profile_stock_batches;
create policy "profile_stock_batches tenant insert" on public.profile_stock_batches for insert with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','inventory_manager','dealer_admin','dealer_staff','production_manager'));
drop policy if exists "profile_stock_batches tenant update" on public.profile_stock_batches;
create policy "profile_stock_batches tenant update" on public.profile_stock_batches for update using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','inventory_manager','dealer_admin','dealer_staff','production_manager')) with check (company_id = public.get_current_user_company_id());

create or replace function public.create_order_from_quote_with_dealer_stock(
  p_quote_id UUID,
  p_order_number TEXT,
  p_order_date DATE,
  p_expected_dispatch_date DATE,
  p_priority TEXT,
  p_dealer_fulfilled_weight_kg NUMERIC,
  p_notes TEXT
)
returns UUID
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_user_id uuid;
  v_user_dealer_id uuid;
  v_quote record;
  v_order_id uuid;
  v_requested_weight numeric(14,3);
  v_profile_requested_weight numeric(14,3);
  v_available_dealer_weight numeric(14,3);
  v_dealer_weight numeric(14,3);
  v_manufacturing_weight numeric(14,3);
  v_stage text;
  v_fulfillment_notes text;
  v_remaining_dealer_weight numeric(14,3);
  v_profile record;
  v_profile_target numeric(14,3);
  v_profile_remaining numeric(14,3);
  v_allocated_profiles integer := 0;
  v_profile_count integer;
  v_batch record;
  v_reserved_weight numeric(14,3);
  v_available_weight numeric(14,3);
  v_consume_weight numeric(14,3);
  v_new_batch_weight numeric(14,3);
  v_new_piece_count integer;
begin
  v_company_id := public.get_current_user_company_id();
  v_user_id := auth.uid();
  v_user_dealer_id := public.get_current_user_dealer_id();

  if v_company_id is null or v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select id, customer_id, grand_total, status into v_quote
  from public.quotes
  where id = p_quote_id and company_id = v_company_id
  for update;

  if v_quote.id is null then raise exception 'Quote not found' using errcode = '23514'; end if;
  if exists (select 1 from public.orders where company_id = v_company_id and quote_id = p_quote_id) then raise exception 'This quote is already linked to an order' using errcode = '23505'; end if;
  if exists (select 1 from public.orders where company_id = v_company_id and order_number = p_order_number) then raise exception 'Order number already exists' using errcode = '23505'; end if;

  select round(coalesce(sum(coalesce(billing_weight_kg, total_weight_kg, 0)), 0)::numeric, 3) into v_requested_weight from public.quote_items where quote_id = p_quote_id and company_id = v_company_id;
  select round(coalesce(sum(coalesce(billing_weight_kg, total_weight_kg, 0)), 0)::numeric, 3) into v_profile_requested_weight from public.quote_items where quote_id = p_quote_id and company_id = v_company_id and profile_id is not null;

  if v_requested_weight <= 0 then raise exception 'Quote has no billable profile weight' using errcode = '23514'; end if;

  select round(coalesce(sum(greatest(b.total_weight_kg - coalesce(r.reserved_weight_kg, 0), 0)), 0)::numeric, 3)
  into v_available_dealer_weight
  from public.profile_stock_batches b
  join (select distinct profile_id from public.quote_items where quote_id = p_quote_id and company_id = v_company_id and profile_id is not null) qi on qi.profile_id = b.profile_id
  left join (
    select profile_stock_batch_id, sum(reserved_weight_kg) reserved_weight_kg
    from public.profile_stock_reservations
    where company_id = v_company_id and status = 'active'
    group by profile_stock_batch_id
  ) r on r.profile_stock_batch_id = b.id
  where b.company_id = v_company_id
    and b.status = 'available'
    and b.total_weight_kg > 0
    and (v_user_dealer_id is null or b.dealer_id = v_user_dealer_id);

  v_dealer_weight := round(greatest(coalesce(p_dealer_fulfilled_weight_kg, 0), 0)::numeric, 3);
  if v_user_dealer_id is not null then
    v_dealer_weight := least(v_requested_weight, v_profile_requested_weight, coalesce(v_available_dealer_weight, 0));
  end if;

  if v_dealer_weight > v_requested_weight then raise exception 'Dealer fulfilled weight cannot exceed quote weight' using errcode = '23514'; end if;
  if v_dealer_weight > 0 and v_profile_requested_weight <= 0 then raise exception 'Dealer fulfilled weight requires profile-backed quote items' using errcode = '23514'; end if;
  if v_dealer_weight > v_profile_requested_weight then raise exception 'Dealer fulfilled weight cannot exceed profile-backed quote weight' using errcode = '23514'; end if;

  v_manufacturing_weight := round((v_requested_weight - v_dealer_weight)::numeric, 3);
  if v_manufacturing_weight > 0 and v_manufacturing_weight < 700 then
    raise exception 'Urgent: factory balance % kg is below the 700 kg manufacturing minimum. Fulfill locally or arrange profile from another dealer/manufacturer.', v_manufacturing_weight using errcode = '23514';
  end if;

  v_stage := case when v_manufacturing_weight >= 700 then 'extrusion_planned' else 'order_confirmed' end;
  v_fulfillment_notes := case when v_dealer_weight > 0 then format('Dealer stock automatically fulfilled %s kg from unreserved profile stock batches. Factory balance %s kg.', v_dealer_weight, v_manufacturing_weight) else format('Factory manufacturing weight %s kg.', v_manufacturing_weight) end;

  insert into public.orders (company_id, dealer_id, order_number, quote_id, customer_id, order_date, expected_dispatch_date, priority, current_stage, order_value, requested_weight_kg, dealer_fulfilled_weight_kg, manufacturing_weight_kg, fulfillment_notes, notes, created_by)
  values (v_company_id, v_user_dealer_id, p_order_number, p_quote_id, v_quote.customer_id, p_order_date, p_expected_dispatch_date, p_priority, v_stage, coalesce(v_quote.grand_total, 0), v_requested_weight, 0, v_requested_weight, v_fulfillment_notes, nullif(concat_ws(E'\n', nullif(p_notes, ''), v_fulfillment_notes), ''), v_user_id)
  returning id into v_order_id;

  if v_dealer_weight > 0 then
    select count(*) into v_profile_count from (select profile_id from public.quote_items where quote_id = p_quote_id and company_id = v_company_id and profile_id is not null group by profile_id) profile_groups;
    v_remaining_dealer_weight := v_dealer_weight;

    for v_profile in select profile_id, round(sum(coalesce(billing_weight_kg, total_weight_kg, 0))::numeric, 3) required_weight_kg from public.quote_items where quote_id = p_quote_id and company_id = v_company_id and profile_id is not null group by profile_id order by profile_id loop
      v_allocated_profiles := v_allocated_profiles + 1;
      if v_allocated_profiles = v_profile_count then v_profile_target := v_remaining_dealer_weight; else v_profile_target := round((v_dealer_weight * v_profile.required_weight_kg / v_profile_requested_weight)::numeric, 3); end if;
      v_profile_target := least(v_profile_target, v_profile.required_weight_kg);
      v_profile_remaining := v_profile_target;

      for v_batch in select id, profile_id, total_weight_kg, length_m, quantity_pieces, created_at from public.profile_stock_batches where company_id = v_company_id and profile_id = v_profile.profile_id and status = 'available' and total_weight_kg > 0 and (v_user_dealer_id is null or dealer_id = v_user_dealer_id) order by created_at asc, id asc for update loop
        exit when v_profile_remaining <= 0;
        select coalesce(sum(reserved_weight_kg), 0) into v_reserved_weight from public.profile_stock_reservations where company_id = v_company_id and profile_stock_batch_id = v_batch.id and status = 'active';
        v_available_weight := round(greatest(v_batch.total_weight_kg - v_reserved_weight, 0)::numeric, 3);
        if v_available_weight <= 0 then continue; end if;
        v_consume_weight := least(v_profile_remaining, v_available_weight);
        v_new_batch_weight := round((v_batch.total_weight_kg - v_consume_weight)::numeric, 3);
        v_new_piece_count := case when v_batch.total_weight_kg > 0 then greatest(0, round(v_batch.quantity_pieces * (v_new_batch_weight / v_batch.total_weight_kg))::integer) else 0 end;

        insert into public.order_dealer_stock_fulfillments (company_id, order_id, quote_id, profile_id, profile_stock_batch_id, fulfilled_weight_kg, fulfilled_length_m, fulfilled_pieces, notes, created_by)
        values (v_company_id, v_order_id, p_quote_id, v_profile.profile_id, v_batch.id, v_consume_weight, case when v_batch.total_weight_kg > 0 then round((coalesce(v_batch.length_m, 0) * v_consume_weight / v_batch.total_weight_kg)::numeric, 3) else 0 end, greatest(0, v_batch.quantity_pieces - v_new_piece_count), 'Automatic dealer stock debit on order confirmation', v_user_id);

        update public.profile_stock_batches set total_weight_kg = v_new_batch_weight, quantity_pieces = v_new_piece_count, status = case when v_new_batch_weight <= 0 then 'dispatched' else status end, updated_at = now() where id = v_batch.id and company_id = v_company_id;

        insert into public.inventory_transactions (company_id, inventory_item_id, item_type, quantity, unit, inventory_state, from_owner_type, from_owner_id, to_owner_type, to_owner_id, order_id, created_by_user_id, created_by_role, reason, status)
        select v_company_id, ii.id, 'profile', -v_consume_weight, 'kg', 'dealer_inventory_on_hand', 'dealer', v_user_dealer_id, 'customer', null, v_order_id, v_user_id, public.get_current_user_role(), 'Automatic dealer stock debit on order confirmation', 'posted'
        from public.inventory_items ii
        where ii.company_id = v_company_id and ii.item_code = (select profile_code from public.aluminium_profiles where id = v_profile.profile_id)
        limit 1;

        v_profile_remaining := round((v_profile_remaining - v_consume_weight)::numeric, 3);
        v_remaining_dealer_weight := round((v_remaining_dealer_weight - v_consume_weight)::numeric, 3);
      end loop;

      if v_profile_remaining > 0.001 then raise exception 'Insufficient unreserved stock for one or more quoted profiles. Remaining profile shortfall: % kg', v_profile_remaining using errcode = '23514'; end if;
    end loop;

    if v_remaining_dealer_weight > 0.001 then raise exception 'Could not allocate the full dealer fulfilled weight to quoted profile stock. Remaining dealer weight: % kg', v_remaining_dealer_weight using errcode = '23514'; end if;
  end if;

  update public.orders set dealer_fulfilled_weight_kg = v_dealer_weight, manufacturing_weight_kg = v_manufacturing_weight, fulfillment_notes = v_fulfillment_notes where id = v_order_id and company_id = v_company_id;
  insert into public.order_stage_history (company_id, order_id, stage, changed_by, remarks) values (v_company_id, v_order_id, v_stage, v_user_id, v_fulfillment_notes);
  update public.quotes set status = 'converted_to_order' where id = p_quote_id and company_id = v_company_id;
  return v_order_id;
end;
$$;

create or replace function public.credit_dealer_stock_on_order_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  f record;
  v_user_dealer_id uuid;
begin
  if tg_op <> 'UPDATE' or new.current_stage <> 'cancelled' or old.current_stage = 'cancelled' then
    return new;
  end if;

  v_user_dealer_id := public.get_current_user_dealer_id();

  for f in select * from public.order_dealer_stock_fulfillments where company_id = new.company_id and order_id = new.id and credited_at is null loop
    update public.profile_stock_batches
    set total_weight_kg = total_weight_kg + f.fulfilled_weight_kg,
        quantity_pieces = quantity_pieces + coalesce(f.fulfilled_pieces, 0),
        status = 'available',
        updated_at = now()
    where id = f.profile_stock_batch_id and company_id = new.company_id;

    insert into public.inventory_transactions (company_id, inventory_item_id, item_type, quantity, unit, inventory_state, from_owner_type, from_owner_id, to_owner_type, to_owner_id, order_id, created_by_user_id, created_by_role, reason, status)
    select new.company_id, ii.id, 'profile', f.fulfilled_weight_kg, 'kg', 'dealer_inventory_on_hand', 'customer', null, 'dealer', v_user_dealer_id, new.id, auth.uid(), public.get_current_user_role(), 'Automatic dealer stock credit on order cancellation', 'posted'
    from public.inventory_items ii
    where ii.company_id = new.company_id and ii.item_code = (select profile_code from public.aluminium_profiles where id = f.profile_id)
    limit 1;

    update public.order_dealer_stock_fulfillments
    set credited_at = now()
    where id = f.id;
  end loop;

  insert into public.order_stage_history(company_id, order_id, stage, changed_by, remarks)
  values (new.company_id, new.id, 'cancelled', auth.uid(), 'Dealer stock credited back automatically after order cancellation.');

  return new;
end;
$$;

drop trigger if exists credit_dealer_stock_on_order_cancel_trigger on public.orders;
create trigger credit_dealer_stock_on_order_cancel_trigger after update of current_stage on public.orders for each row execute function public.credit_dealer_stock_on_order_cancel();

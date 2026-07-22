-- Keep quote commercial revisions atomic and preserve line identity through
-- dealer stock, packing, and invoicing. This migration is additive for legacy
-- rows; exact lineage is mandatory for every new dealer-stock fulfillment.

begin;

alter table public.app_users
  add column if not exists organization_type text default 'factory';

alter table public.orders
  add column if not exists created_by_user_id uuid references auth.users(id),
  add column if not exists created_by_role text,
  add column if not exists created_by_organization_type text,
  add column if not exists created_by_dealership_id uuid references public.dealers(id),
  add column if not exists order_origin text;

alter table public.order_items
  add column if not exists quote_item_id uuid references public.quote_items(id) on delete restrict,
  add column if not exists finishing_type text,
  add column if not exists dealer_fulfilled_weight_kg numeric(14,3) not null default 0,
  add column if not exists manufacturing_weight_kg numeric(14,3) not null default 0;

alter table public.order_dealer_stock_fulfillments
  add column if not exists quote_item_id uuid references public.quote_items(id) on delete restrict,
  add column if not exists order_item_id uuid references public.order_items(id) on delete restrict,
  add column if not exists finishing_type text,
  add column if not exists unit_rate numeric(14,2),
  add column if not exists quoted_line_value numeric(14,2);

alter table public.packing_list_items
  add column if not exists order_item_id uuid references public.order_items(id) on delete restrict,
  add column if not exists quote_item_id uuid references public.quote_items(id) on delete restrict,
  add column if not exists finishing_type text,
  add column if not exists net_rate numeric(14,2);

alter table public.invoice_items
  add column if not exists quote_item_id uuid references public.quote_items(id) on delete restrict,
  add column if not exists finishing_type text;

create index if not exists order_items_quote_lineage_idx
  on public.order_items(company_id, order_id, quote_item_id);
create index if not exists dealer_fulfillment_quote_lineage_idx
  on public.order_dealer_stock_fulfillments(company_id, order_id, quote_item_id, order_item_id);
create index if not exists packing_items_commercial_lineage_idx
  on public.packing_list_items(company_id, dispatch_id, order_item_id, quote_item_id);
create index if not exists invoice_items_commercial_lineage_idx
  on public.invoice_items(company_id, invoice_id, order_item_id, quote_item_id);

update public.order_items oi
set quote_item_id = qi.id,
    finishing_type = coalesce(oi.finishing_type, qi.finishing_type),
    net_rate = coalesce(oi.net_rate, qi.net_rate, qi.price_per_kg),
    dealer_fulfilled_weight_kg = coalesce(oi.dealer_fulfilled_weight_kg, 0),
    manufacturing_weight_kg = greatest(
      coalesce(oi.quantity_kg, qi.billing_weight_kg, qi.total_weight_kg, 0)
        - coalesce(oi.dealer_fulfilled_weight_kg, 0),
      0
    )
from public.orders o
join public.quote_items qi
  on qi.quote_id = o.quote_id
where oi.order_id = o.id
  and oi.company_id = o.company_id
  and qi.company_id = oi.company_id
  and qi.id = oi.source_line_id
  and oi.quote_item_id is null;

with exact_fulfillment_line as (
  select
    fulfillment.id,
    (array_agg(quote_item.id order by quote_item.id))[1] as quote_item_id
  from public.order_dealer_stock_fulfillments fulfillment
  join public.quote_items quote_item
    on quote_item.company_id = fulfillment.company_id
   and quote_item.quote_id = fulfillment.quote_id
   and quote_item.profile_id = fulfillment.profile_id
  where fulfillment.quote_item_id is null
  group by fulfillment.id
  having count(*) = 1
)
update public.order_dealer_stock_fulfillments fulfillment
set quote_item_id = exact_line.quote_item_id,
    finishing_type = quote_item.finishing_type,
    unit_rate = coalesce(quote_item.net_rate, quote_item.price_per_kg),
    quoted_line_value = quote_item.line_total_before_gst
from exact_fulfillment_line exact_line
join public.quote_items quote_item on quote_item.id = exact_line.quote_item_id
where fulfillment.id = exact_line.id;

update public.order_dealer_stock_fulfillments fulfillment
set order_item_id = order_item.id
from public.order_items order_item
where order_item.company_id = fulfillment.company_id
  and order_item.order_id = fulfillment.order_id
  and order_item.quote_item_id = fulfillment.quote_item_id
  and fulfillment.order_item_id is null;

update public.packing_list_items packing
set order_item_id = fulfillment.order_item_id,
    quote_item_id = fulfillment.quote_item_id,
    finishing_type = fulfillment.finishing_type,
    net_rate = fulfillment.unit_rate
from public.order_dealer_stock_fulfillments fulfillment
where packing.company_id = fulfillment.company_id
  and packing.source_line_id = fulfillment.id
  and packing.order_item_id is null;

update public.packing_list_items packing
set order_item_id = order_item.id,
    quote_item_id = order_item.quote_item_id,
    finishing_type = coalesce(order_item.finishing_type, production.finishing_type),
    net_rate = order_item.net_rate
from public.production_jobs production
join public.order_items order_item
  on order_item.company_id = production.company_id
 and order_item.id = production.source_line_id
where packing.company_id = production.company_id
  and packing.source_line_id = production.id
  and packing.order_item_id is null;

update public.invoice_items invoice_item
set order_item_id = coalesce(invoice_item.order_item_id, packing.order_item_id),
    quote_item_id = packing.quote_item_id,
    finishing_type = packing.finishing_type,
    net_rate = coalesce(invoice_item.net_rate, packing.net_rate)
from public.packing_list_items packing
where invoice_item.company_id = packing.company_id
  and invoice_item.source_line_id = packing.id;

create or replace function private.save_quote_atomic(
  p_quote_id uuid,
  p_quote jsonb,
  p_items jsonb,
  p_expected_revision integer,
  p_expected_updated_at timestamptz,
  p_revision_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_dealer_id uuid := private.get_current_user_dealer_id();
  v_customer_id uuid := nullif(p_quote ->> 'customer_id', '')::uuid;
  v_current public.quotes%rowtype;
  v_quote_id uuid;
  v_quote_number text;
  v_revision integer := 1;
  v_needs_revision boolean := false;
  v_payload jsonb;
  v_item jsonb;
  v_profile_id uuid;
  v_die_id uuid;
  v_subtotal numeric(14,2);
  v_profit numeric(14,2);
  v_gst_percent numeric(7,2);
  v_gst_amount numeric(14,2);
  v_low_margin boolean;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if v_role not in ('owner','admin','sales','sales_manager','dealer_admin','dealer_staff') then
    raise exception 'Permission denied for quotations' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'A quotation requires at least one line item' using errcode = '23514';
  end if;

  perform 1 from public.customers
  where id = v_customer_id and company_id = v_company_id;
  if not found then raise exception 'Customer not found for this company'; end if;

  if p_quote_id is not null then
    select * into v_current
    from public.quotes
    where id = p_quote_id and company_id = v_company_id
    for update;
    if not found then raise exception 'Quote not found for this company'; end if;
    if v_current.status = 'converted_to_order' then
      raise exception 'Converted quotes cannot be revised';
    end if;
    if p_expected_revision is null or p_expected_revision <> v_current.revision_number then
      raise exception 'The quote changed while you were editing it. Refresh and try again.'
        using errcode = '40001';
    end if;
    if p_expected_updated_at is null or p_expected_updated_at is distinct from v_current.updated_at then
      raise exception 'The quote changed while you were editing it. Refresh and try again.'
        using errcode = '40001';
    end if;
    if v_dealer_id is not null
       and v_current.dealer_id is distinct from v_dealer_id
       and v_current.created_by is distinct from auth.uid() then
      raise exception 'Dealer users can only revise their own quotations' using errcode = '42501';
    end if;
    v_needs_revision := v_current.status in (
      'approved_for_sending','sent','customer_approved','customer_rejected','expired'
    );
    v_revision := v_current.revision_number + case when v_needs_revision then 1 else 0 end;
    v_quote_number := v_current.quote_number;
    v_quote_id := v_current.id;
  else
    v_quote_number := private.next_business_number_locked(
      'public.quotes'::regclass,
      'quote_number',
      v_company_id,
      'Q',
      coalesce(nullif(p_quote ->> 'quote_date', '')::date, current_date)
    );
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_profile_id := nullif(v_item ->> 'profile_id', '')::uuid;
    v_die_id := nullif(v_item ->> 'die_id', '')::uuid;
    perform 1 from public.aluminium_profiles
    where id = v_profile_id and company_id = v_company_id;
    if not found then raise exception 'A quote profile is stale or belongs to another company'; end if;
    if v_die_id is not null and not exists (
      select 1 from public.dies
      where id = v_die_id and company_id = v_company_id and profile_id = v_profile_id
    ) then
      raise exception 'A quote die is stale or does not match its profile';
    end if;
  end loop;

  if p_quote_id is not null and v_needs_revision then
    insert into public.quote_revisions (
      company_id, quote_id, revision_number, snapshot_json, revised_by, reason
    ) values (
      v_company_id,
      v_quote_id,
      v_current.revision_number,
      jsonb_build_object(
        'quote', to_jsonb(v_current),
        'items', coalesce((
          select jsonb_agg(to_jsonb(item) order by item.created_at, item.id)
          from public.quote_items item
          where item.company_id = v_company_id and item.quote_id = v_quote_id
        ), '[]'::jsonb)
      ),
      auth.uid(),
      coalesce(nullif(btrim(p_revision_reason), ''), 'Commercial revision')
    );
  end if;

  v_gst_percent := greatest(least(coalesce((p_quote ->> 'gst_percent')::numeric, 0), 100), 0);
  v_payload := private.keep_jsonb_keys(p_quote, array[
      'customer_id','quote_date','valid_until','terms_and_conditions','delivery_timeline',
      'payment_terms','approval_notes','notes'
    ])
    || jsonb_build_object(
      'company_id', v_company_id,
      'customer_id', v_customer_id,
      'dealer_id', coalesce(v_dealer_id, v_current.dealer_id),
      'quote_number', v_quote_number,
      'status', case when v_needs_revision then 'draft' else coalesce(v_current.status, 'draft') end,
      'revision_number', v_revision,
      'gst_percent', v_gst_percent,
      'subtotal', 0,
      'total_margin_amount', 0,
      'total_before_gst', 0,
      'gst_amount', 0,
      'grand_total', 0,
      'low_margin_approval_required', false,
      'estimated_profit_amount', 0,
      'estimated_profit_percent', 0,
      'approved_by', case when v_needs_revision then null else v_current.approved_by end,
      'approved_at', case when v_needs_revision then null else v_current.approved_at end,
      'sent_at', case when v_needs_revision then null else v_current.sent_at end,
      'customer_decision_at', case when v_needs_revision then null else v_current.customer_decision_at end
    );

  if p_quote_id is null then
    v_quote_id := private.insert_jsonb_row(
      'public.quotes'::regclass,
      v_payload || jsonb_build_object('created_by', auth.uid())
    );
  else
    perform private.update_jsonb_row(
      'public.quotes'::regclass,
      v_quote_id,
      v_company_id,
      v_payload || jsonb_build_object('updated_at', now())
    );
    delete from public.quote_items
    where company_id = v_company_id and quote_id = v_quote_id;
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    perform private.insert_jsonb_row(
      'public.quote_items'::regclass,
      (v_item - array['id','company_id','quote_id','created_at','updated_at','source_record_id','source_line_id'])
        || jsonb_build_object(
          'company_id', v_company_id,
          'quote_id', v_quote_id,
          'revision_number', v_revision,
          'created_at', now(),
          'updated_at', now()
        )
    );
  end loop;

  select
    round(coalesce(sum(item.line_total_before_gst), 0), 2),
    round(coalesce(sum(item.estimated_profit_amount), 0), 2),
    coalesce(bool_or(item.approval_required), false)
  into v_subtotal, v_profit, v_low_margin
  from public.quote_items item
  where item.company_id = v_company_id and item.quote_id = v_quote_id;
  v_gst_amount := round(v_subtotal * v_gst_percent / 100, 2);

  update public.quotes
  set subtotal = v_subtotal,
      total_margin_amount = v_profit,
      total_before_gst = v_subtotal,
      gst_amount = v_gst_amount,
      grand_total = v_subtotal + v_gst_amount,
      low_margin_approval_required = v_low_margin,
      estimated_profit_amount = v_profit,
      estimated_profit_percent = case when v_subtotal > 0 then round(v_profit / v_subtotal * 100, 2) else 0 end,
      updated_at = now()
  where id = v_quote_id and company_id = v_company_id;

  return v_quote_id;
end;
$$;

revoke all on function private.save_quote_atomic(uuid, jsonb, jsonb, integer, timestamptz, text)
  from public, anon;
grant execute on function private.save_quote_atomic(uuid, jsonb, jsonb, integer, timestamptz, text)
  to authenticated;

create or replace function public.save_quote_atomic(
  p_quote_id uuid,
  p_quote jsonb,
  p_items jsonb,
  p_expected_revision integer,
  p_expected_updated_at timestamptz,
  p_revision_reason text
)
returns uuid
language sql
security invoker
set search_path = public, private
as $$
  select private.save_quote_atomic(
    p_quote_id, p_quote, p_items, p_expected_revision, p_expected_updated_at, p_revision_reason
  )
$$;

revoke all on function public.save_quote_atomic(uuid, jsonb, jsonb, integer, timestamptz, text)
  from public, anon;
grant execute on function public.save_quote_atomic(uuid, jsonb, jsonb, integer, timestamptz, text)
  to authenticated;

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
  if v_manufacturing_weight > 0 and v_manufacturing_weight < 700 then
    raise exception 'Urgent: factory balance % kg is below the 700 kg manufacturing minimum. Fulfill locally or arrange profile from another dealer/manufacturer.',
      v_manufacturing_weight using errcode = '23514';
  end if;

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

revoke all on function private.create_order_from_quote_with_dealer_stock(
  uuid, text, date, date, text, numeric, text
) from public, anon;
grant execute on function private.create_order_from_quote_with_dealer_stock(
  uuid, text, date, date, text, numeric, text
) to authenticated;

create or replace function private.enforce_dealer_fulfillment_lineage()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_order public.orders%rowtype;
  v_quote_item public.quote_items%rowtype;
  v_order_item public.order_items%rowtype;
  v_batch public.profile_stock_batches%rowtype;
begin
  select * into v_order from public.orders
  where id = new.order_id and company_id = new.company_id;
  if not found then raise exception 'Dealer fulfillment order is unavailable'; end if;
  if new.quote_item_id is null or new.order_item_id is null then
    raise exception 'Dealer fulfillment requires exact quote and order line identity';
  end if;

  select * into v_quote_item from public.quote_items
  where id = new.quote_item_id
    and company_id = new.company_id
    and quote_id = v_order.quote_id;
  if not found then raise exception 'Dealer fulfillment quote line does not belong to the order'; end if;

  select * into v_order_item from public.order_items
  where id = new.order_item_id
    and company_id = new.company_id
    and order_id = new.order_id
    and quote_item_id = new.quote_item_id;
  if not found then raise exception 'Dealer fulfillment order line does not match its quote line'; end if;

  select * into v_batch from public.profile_stock_batches
  where id = new.profile_stock_batch_id
    and company_id = new.company_id
    and profile_id = v_quote_item.profile_id;
  if not found then raise exception 'Dealer fulfillment stock batch does not match its quote profile'; end if;
  if lower(regexp_replace(v_batch.finish, '[^a-z0-9]+', '_', 'g')) <>
     lower(regexp_replace(coalesce(v_quote_item.finishing_type, 'mill_finish'), '[^a-z0-9]+', '_', 'g')) then
    raise exception 'Dealer stock finish does not match the quoted finish';
  end if;
  if coalesce(v_quote_item.net_rate, v_quote_item.price_per_kg, 0) <= 0 then
    raise exception 'Dealer fulfillment quote line requires a positive commercial rate';
  end if;

  new.quote_id := v_order.quote_id;
  new.profile_id := v_quote_item.profile_id;
  new.finishing_type := coalesce(v_quote_item.finishing_type, 'mill_finish');
  new.unit_rate := coalesce(v_quote_item.net_rate, v_quote_item.price_per_kg);
  new.quoted_line_value := v_quote_item.line_total_before_gst;
  return new;
end;
$$;

revoke all on function private.enforce_dealer_fulfillment_lineage() from public;
drop trigger if exists enforce_dealer_fulfillment_lineage on public.order_dealer_stock_fulfillments;
create trigger enforce_dealer_fulfillment_lineage
before insert or update of company_id, order_id, quote_id, quote_item_id, order_item_id,
  profile_id, profile_stock_batch_id, finishing_type, unit_rate, quoted_line_value
on public.order_dealer_stock_fulfillments
for each row execute function private.enforce_dealer_fulfillment_lineage();

create or replace function private.canonicalize_packing_commercial_lineage()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid;
  v_order_id uuid;
  v_order_item_id uuid;
  v_quote_item_id uuid;
  v_profile_id uuid;
  v_finish text;
  v_rate numeric(14,2);
  v_is_dealer_source boolean := false;
begin
  select company_id, order_id into v_company_id, v_order_id
  from public.dispatches where id = new.dispatch_id;
  if not found then raise exception 'Packing dispatch is unavailable'; end if;

  if new.source_kind = 'reservation' then
    select reservation.profile_id
    into v_profile_id
    from public.profile_stock_reservations reservation
    where reservation.id = new.reservation_id
      and reservation.company_id = v_company_id
      and reservation.order_id = v_order_id
      and reservation.profile_stock_batch_id = new.profile_stock_batch_id;
    if not found
       or new.source_line_id is distinct from new.reservation_id
       or new.source_record_id is distinct from v_order_id
       or new.profile_id is distinct from v_profile_id then
      raise exception 'Reserved-stock packing source does not match its order, profile, reservation, and stock batch';
    end if;
    new.company_id := v_company_id;
    return new;
  end if;

  select
    fulfillment.order_item_id,
    fulfillment.quote_item_id,
    fulfillment.profile_id,
    fulfillment.finishing_type,
    fulfillment.unit_rate
  into v_order_item_id, v_quote_item_id, v_profile_id, v_finish, v_rate
  from public.order_dealer_stock_fulfillments fulfillment
  where fulfillment.id = new.source_line_id
    and fulfillment.company_id = v_company_id
    and fulfillment.order_id = v_order_id;
  v_is_dealer_source := found;

  if not v_is_dealer_source then
    select
      order_item.id,
      coalesce(order_item.quote_item_id, quote_item.id),
      production.profile_id,
      coalesce(order_item.finishing_type, quote_item.finishing_type, production.finishing_type),
      coalesce(order_item.net_rate, quote_item.net_rate, quote_item.price_per_kg)
    into v_order_item_id, v_quote_item_id, v_profile_id, v_finish, v_rate
    from public.production_jobs production
    left join public.order_items order_item
      on order_item.id = production.source_line_id
     and order_item.company_id = production.company_id
     and order_item.order_id = production.order_id
    left join public.quote_items quote_item
      on quote_item.company_id = production.company_id
     and quote_item.id = coalesce(order_item.quote_item_id, production.source_line_id)
    where production.id = new.source_line_id
      and production.company_id = v_company_id
      and production.order_id = v_order_id;
    if not found then raise exception 'Packing source is unavailable for this order'; end if;
  end if;

  if new.source_record_id is distinct from v_order_id
     or new.profile_id is distinct from v_profile_id then
    raise exception 'Packing source does not match its order and profile';
  end if;
  if v_is_dealer_source and (
    v_order_item_id is null or v_quote_item_id is null
    or coalesce(nullif(btrim(v_finish), ''), '') = ''
    or coalesce(v_rate, 0) <= 0
  ) then
    raise exception 'Dealer-stock packing requires exact quote, order, finish, and rate lineage';
  end if;

  new.company_id := v_company_id;
  new.order_item_id := v_order_item_id;
  new.quote_item_id := v_quote_item_id;
  new.finishing_type := v_finish;
  new.net_rate := v_rate;
  return new;
end;
$$;

revoke all on function private.canonicalize_packing_commercial_lineage() from public;
drop trigger if exists canonicalize_packing_commercial_lineage on public.packing_list_items;
create trigger canonicalize_packing_commercial_lineage
before insert or update on public.packing_list_items
for each row execute function private.canonicalize_packing_commercial_lineage();

create or replace function private.canonicalize_invoice_commercial_lineage()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_order_item_id uuid;
  v_quote_item_id uuid;
  v_finish text;
  v_rate numeric(14,2);
begin
  select packing.order_item_id, packing.quote_item_id, packing.finishing_type, packing.net_rate
  into v_order_item_id, v_quote_item_id, v_finish, v_rate
  from public.packing_list_items packing
  join public.invoices invoice
    on invoice.company_id = packing.company_id
   and invoice.dispatch_id = packing.dispatch_id
  where packing.id = new.source_line_id
    and invoice.id = new.invoice_id;
  if not found then raise exception 'Invoice packing lineage is unavailable'; end if;

  new.order_item_id := v_order_item_id;
  new.quote_item_id := v_quote_item_id;
  new.finishing_type := v_finish;
  new.net_rate := v_rate;
  return new;
end;
$$;

revoke all on function private.canonicalize_invoice_commercial_lineage() from public;
drop trigger if exists zz_canonicalize_invoice_commercial_lineage on public.invoice_items;
create trigger zz_canonicalize_invoice_commercial_lineage
before insert or update on public.invoice_items
for each row execute function private.canonicalize_invoice_commercial_lineage();

commit;

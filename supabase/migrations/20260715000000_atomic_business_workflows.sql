-- Make multi-table business saves atomic and retry-safe.
-- Public functions remain SECURITY INVOKER wrappers; privileged implementations
-- live in the private schema and re-check the authenticated user's permissions.

create schema if not exists private;

create or replace function private.keep_jsonb_keys(p_payload jsonb, p_allowed text[])
returns jsonb
language sql
immutable
set search_path = public, private
as $$
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
  from jsonb_each(coalesce(p_payload, '{}'::jsonb)) e
  where e.key = any(p_allowed);
$$;

create or replace function private.insert_jsonb_row(p_table regclass, p_payload jsonb)
returns uuid
language plpgsql
set search_path = public, private
as $$
declare
  v_columns text;
  v_values text;
  v_id uuid;
begin
  select
    string_agg(format('%I', a.attname), ', ' order by a.attnum),
    string_agg(format('r.%I', a.attname), ', ' order by a.attnum)
  into v_columns, v_values
  from pg_attribute a
  where a.attrelid = p_table
    and a.attnum > 0
    and not a.attisdropped
    and a.attgenerated = ''
    and a.attidentity = ''
    and p_payload ? a.attname;

  if v_columns is null then
    raise exception 'No writable fields were supplied';
  end if;

  execute format(
    'insert into %s (%s) select %s from jsonb_populate_record(null::%s, $1) r returning id',
    p_table, v_columns, v_values, p_table
  ) using p_payload into v_id;
  return v_id;
end;
$$;

create or replace function private.update_jsonb_row(
  p_table regclass,
  p_id uuid,
  p_company_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
set search_path = public, private
as $$
declare
  v_assignments text;
  v_id uuid;
begin
  select string_agg(format('%1$I = r.%1$I', a.attname), ', ' order by a.attnum)
  into v_assignments
  from pg_attribute a
  where a.attrelid = p_table
    and a.attnum > 0
    and not a.attisdropped
    and a.attgenerated = ''
    and a.attidentity = ''
    and a.attname not in ('id', 'company_id', 'created_at', 'created_by')
    and p_payload ? a.attname;

  if v_assignments is null then
    raise exception 'No writable fields were supplied';
  end if;

  execute format(
    'update %s t set %s from jsonb_populate_record(null::%s, $1) r where t.id = $2 and t.company_id = $3 returning t.id',
    p_table, v_assignments, p_table
  ) using p_payload, p_id, p_company_id into v_id;

  if v_id is null then
    raise exception 'Record not found for this company';
  end if;
  return v_id;
end;
$$;

create or replace function private.next_business_number_locked(
  p_table regclass,
  p_number_column text,
  p_company_id uuid,
  p_prefix text,
  p_business_date date
)
returns text
language plpgsql
set search_path = public, private
as $$
declare
  v_year integer := extract(year from coalesce(p_business_date, current_date))::integer;
  v_pattern text;
  v_sequence integer;
begin
  if not exists (
    select 1 from pg_attribute
    where attrelid = p_table and attname = p_number_column and attnum > 0 and not attisdropped
  ) then
    raise exception 'Invalid business number column';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_company_id::text || ':' || p_table::text || ':' || p_prefix || ':' || v_year::text,
    0
  ));
  v_pattern := '^' || p_prefix || '-' || v_year::text || '-[0-9]+$';
  execute format(
    'select coalesce(max(substring(%1$I from ''([0-9]+)$'')::integer), 0) + 1 from %2$s where company_id = $1 and %1$I ~ $2',
    p_number_column,
    p_table
  ) using p_company_id, v_pattern into v_sequence;
  return p_prefix || '-' || v_year::text || '-' || lpad(v_sequence::text, 4, '0');
end;
$$;

create or replace function private.convert_quote_to_order_atomic(
  p_quote_id uuid,
  p_order jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_quote public.quotes%rowtype;
  v_existing_id uuid;
  v_order_id uuid;
  v_item jsonb;
  v_order jsonb;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if private.get_current_user_role() not in ('owner','admin','sales','sales_manager') then
    raise exception 'Permission denied for quote conversion' using errcode = '42501';
  end if;

  select * into v_quote
  from public.quotes
  where id = p_quote_id and company_id = v_company_id
  for update;
  if not found then raise exception 'Quote not found for this company'; end if;

  select id into v_existing_id
  from public.orders
  where company_id = v_company_id and quote_id = p_quote_id
  order by created_at
  limit 1;
  if v_existing_id is not null then return v_existing_id; end if;

  if v_quote.status not in ('customer_approved', 'approved_for_sending') then
    raise exception 'Only approved/customer-approved quotes can be converted to orders';
  end if;
  if not exists (
    select 1 from public.quote_items where company_id = v_company_id and quote_id = p_quote_id
  ) then
    raise exception 'Quote has no line items to convert';
  end if;
  if exists (
    select 1 from public.quote_items
    where company_id = v_company_id and quote_id = p_quote_id
      and coalesce(drawing_approval_status, 'Pending') <> 'Approved'
  ) then
    raise exception 'Every quote line requires an approved drawing before conversion';
  end if;

  v_order := private.keep_jsonb_keys(p_order, array['order_date','priority','order_value'])
    || jsonb_build_object(
      'company_id', v_company_id,
      'quote_id', p_quote_id,
      'customer_id', v_quote.customer_id,
      'dealer_id', coalesce(private.get_current_user_dealer_id(), v_quote.dealer_id),
      'current_stage', 'order_confirmed',
      'created_by', auth.uid()
    );
  v_order := v_order || jsonb_build_object(
    'order_number', private.next_business_number_locked(
      'public.orders'::regclass,
      'order_number',
      v_company_id,
      'O',
      coalesce(nullif(v_order ->> 'order_date', '')::date, current_date)
    )
  );
  v_order_id := private.insert_jsonb_row('public.orders'::regclass, v_order);

  for v_item in
    select to_jsonb(qi) from public.quote_items qi
    where qi.company_id = v_company_id and qi.quote_id = p_quote_id
    order by qi.created_at
  loop
    perform private.insert_jsonb_row(
      'public.order_items'::regclass,
      (v_item - array['id','company_id','order_id','created_at','updated_at'])
        || jsonb_build_object(
          'company_id', v_company_id,
          'order_id', v_order_id,
          'source_record_id', p_quote_id,
          'created_at', now(),
          'updated_at', now()
        )
    );
  end loop;

  update public.quotes
  set status = 'converted_to_order', updated_at = now()
  where id = p_quote_id and company_id = v_company_id;
  return v_order_id;
end;
$$;

create or replace function private.save_order_atomic(p_order_id uuid, p_order jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_customer_id uuid := nullif(p_order ->> 'customer_id', '')::uuid;
  v_quote_id uuid := nullif(p_order ->> 'quote_id', '')::uuid;
  v_payload jsonb;
  v_order_id uuid;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_order_id is null and private.get_current_user_role() not in ('owner','admin','sales','sales_manager','factory_manager','production_manager') then
    raise exception 'Permission denied for orders' using errcode = '42501';
  end if;
  if p_order_id is not null and private.get_current_user_role() not in ('owner','admin','sales_manager','factory_manager','production_manager','production','dispatch_manager') then
    raise exception 'Permission denied for orders' using errcode = '42501';
  end if;
  perform 1 from public.customers where id = v_customer_id and company_id = v_company_id;
  if not found then raise exception 'Customer not found for this company'; end if;
  if v_quote_id is not null and not exists (
    select 1 from public.quotes where id = v_quote_id and company_id = v_company_id and customer_id = v_customer_id
  ) then
    raise exception 'Quote not found for this customer and company';
  end if;

  v_payload := private.keep_jsonb_keys(p_order, array[
      'quote_id','customer_id','production_profile_id','production_die_id','production_quantity_kg',
      'production_pieces','billet_diameter_required_inch','production_notes','order_date',
      'expected_dispatch_date','priority','current_stage','order_value','notes','dealer_id'
    ])
    || jsonb_build_object('company_id', v_company_id, 'customer_id', v_customer_id);
  if p_order_id is null then
    v_payload := v_payload || jsonb_build_object(
      'order_number', private.next_business_number_locked(
        'public.orders'::regclass,
        'order_number',
        v_company_id,
        'O',
        coalesce(nullif(v_payload ->> 'order_date', '')::date, current_date)
      ),
      'created_by', auth.uid()
    );
    v_order_id := private.insert_jsonb_row('public.orders'::regclass, v_payload);
  else
    perform 1 from public.orders where id = p_order_id and company_id = v_company_id for update;
    if not found then raise exception 'Order not found for this company'; end if;
    v_order_id := private.update_jsonb_row(
      'public.orders'::regclass,
      p_order_id,
      v_company_id,
      v_payload || jsonb_build_object('updated_at', now())
    );
  end if;
  return v_order_id;
end;
$$;

create or replace function private.save_dispatch_atomic(
  p_dispatch_id uuid,
  p_dispatch jsonb,
  p_items jsonb,
  p_order_stage text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_order_id uuid := nullif(p_dispatch ->> 'order_id', '')::uuid;
  v_dispatch_id uuid;
  v_dispatch_number text;
  v_payload jsonb;
  v_item jsonb;
  v_item_index integer := 0;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if private.get_current_user_role() not in ('owner','admin','factory_manager','inventory_manager','dispatch_manager','dispatch') then
    raise exception 'Permission denied for dispatches' using errcode = '42501';
  end if;
  perform 1 from public.orders where id = v_order_id and company_id = v_company_id for update;
  if not found then raise exception 'Selected order is not available for this company'; end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then raise exception 'Packing items must be an array'; end if;

  v_payload := private.keep_jsonb_keys(p_dispatch, array[
      'order_id','dispatch_date','number_of_bundles','total_weight_kg',
      'transporter_name','vehicle_number','driver_name','driver_phone','eway_bill_number',
      'lr_number','delivery_status','proof_of_delivery_url','packing_list_url','remarks'
    ])
    || jsonb_build_object('company_id', v_company_id, 'order_id', v_order_id);
  if p_dispatch_id is null then
    v_payload := v_payload || jsonb_build_object(
      'dispatch_number', private.next_business_number_locked(
        'public.dispatches'::regclass,
        'dispatch_number',
        v_company_id,
        'D',
        coalesce(nullif(v_payload ->> 'dispatch_date', '')::date, current_date)
      )
    );
    v_dispatch_id := private.insert_jsonb_row(
      'public.dispatches'::regclass,
      v_payload || jsonb_build_object('created_by', auth.uid())
    );
  else
    perform 1 from public.dispatches where id = p_dispatch_id and company_id = v_company_id for update;
    if not found then raise exception 'Dispatch not found for this company'; end if;
    v_dispatch_id := private.update_jsonb_row(
      'public.dispatches'::regclass,
      p_dispatch_id,
      v_company_id,
      v_payload || jsonb_build_object('updated_at', now())
    );
  end if;

  select dispatch_number into v_dispatch_number
  from public.dispatches
  where id = v_dispatch_id and company_id = v_company_id;

  delete from public.packing_list_items where dispatch_id = v_dispatch_id and company_id = v_company_id;
  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_item_index := v_item_index + 1;
    perform private.insert_jsonb_row(
      'public.packing_list_items'::regclass,
      (v_item - array['id','company_id','dispatch_id','bundle_number','created_at','updated_at','net_weight_kg'])
        || jsonb_build_object(
          'company_id', v_company_id,
          'dispatch_id', v_dispatch_id,
          'bundle_number', v_dispatch_number || '-' || lpad(v_item_index::text, 2, '0'),
          'created_at', now()
        )
    );
  end loop;

  if p_order_stage in ('dispatched', 'delivered') then
    update public.orders set current_stage = p_order_stage, updated_at = now()
    where id = v_order_id and company_id = v_company_id;
  end if;
  return v_dispatch_id;
end;
$$;

create or replace function private.save_invoice_atomic(
  p_invoice_id uuid,
  p_invoice jsonb,
  p_items jsonb,
  p_replace_items boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_customer_id uuid := nullif(p_invoice ->> 'customer_id', '')::uuid;
  v_order_id uuid := nullif(p_invoice ->> 'order_id', '')::uuid;
  v_dispatch_id uuid := nullif(p_invoice ->> 'dispatch_id', '')::uuid;
  v_invoice_id uuid;
  v_payload jsonb;
  v_item jsonb;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if private.get_current_user_role() not in ('owner','admin','accounts') then
    raise exception 'Permission denied for invoices' using errcode = '42501';
  end if;
  perform 1 from public.customers where id = v_customer_id and company_id = v_company_id;
  if not found then raise exception 'Customer not found for this company'; end if;
  if v_order_id is not null and not exists(select 1 from public.orders where id = v_order_id and company_id = v_company_id) then
    raise exception 'Order not found for this company';
  end if;
  if v_dispatch_id is not null and not exists(select 1 from public.dispatches where id = v_dispatch_id and company_id = v_company_id) then
    raise exception 'Dispatch not found for this company';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then raise exception 'Invoice items must be an array'; end if;

  v_payload := private.keep_jsonb_keys(p_invoice, array[
      'customer_id','order_id','dispatch_id','invoice_number','invoice_date','due_date',
      'subtotal','tax_total','grand_total','amount_paid','status','notes'
    ])
    || jsonb_build_object('company_id', v_company_id, 'customer_id', v_customer_id);
  if p_invoice_id is not null then v_payload := v_payload - 'invoice_number'; end if;
  if p_invoice_id is null then
    if nullif(v_payload ->> 'invoice_number', '') is null then
      v_payload := v_payload || jsonb_build_object(
        'invoice_number', private.next_business_number_locked(
          'public.invoices'::regclass,
          'invoice_number',
          v_company_id,
          'INV',
          coalesce(nullif(v_payload ->> 'invoice_date', '')::date, current_date)
        )
      );
    end if;
    v_invoice_id := private.insert_jsonb_row(
      'public.invoices'::regclass,
      v_payload || jsonb_build_object('created_by', auth.uid())
    );
  else
    perform 1 from public.invoices where id = p_invoice_id and company_id = v_company_id for update;
    if not found then raise exception 'Invoice not found for this company'; end if;
    v_invoice_id := private.update_jsonb_row(
      'public.invoices'::regclass,
      p_invoice_id,
      v_company_id,
      v_payload || jsonb_build_object('updated_at', now())
    );
  end if;

  if p_replace_items then
    delete from public.invoice_items where invoice_id = v_invoice_id and company_id = v_company_id;
    for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
    loop
      perform private.insert_jsonb_row(
        'public.invoice_items'::regclass,
        (v_item - array['id','company_id','invoice_id','created_at','updated_at'])
          || jsonb_build_object('company_id', v_company_id, 'invoice_id', v_invoice_id, 'created_at', now(), 'updated_at', now())
      );
    end loop;
  end if;
  return v_invoice_id;
end;
$$;

create or replace function private.replace_invoice_items_atomic(p_invoice_id uuid, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_item jsonb;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if private.get_current_user_role() not in ('owner','admin','accounts') then raise exception 'Permission denied for invoices' using errcode = '42501'; end if;
  perform 1 from public.invoices where id = p_invoice_id and company_id = v_company_id for update;
  if not found then raise exception 'Invoice not found for this company'; end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then raise exception 'Invoice items must be an array'; end if;
  delete from public.invoice_items where invoice_id = p_invoice_id and company_id = v_company_id;
  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    perform private.insert_jsonb_row(
      'public.invoice_items'::regclass,
      (v_item - array['id','company_id','invoice_id','created_at','updated_at'])
        || jsonb_build_object('company_id', v_company_id, 'invoice_id', p_invoice_id, 'created_at', now(), 'updated_at', now())
    );
  end loop;
  return p_invoice_id;
end;
$$;

create or replace function private.save_production_job_atomic(
  p_job_id uuid,
  p_job jsonb,
  p_billet_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_order_id uuid := nullif(p_job ->> 'order_id', '')::uuid;
  v_job_id uuid;
  v_payload jsonb;
  v_expected integer;
  v_actual integer;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_job_id is null and private.get_current_user_role() not in ('owner','admin','production_manager','factory_manager') then
    raise exception 'Permission denied to create production jobs' using errcode = '42501';
  end if;
  if p_job_id is not null and private.get_current_user_role() not in ('owner','admin','production_manager','factory_manager','production') then
    raise exception 'Permission denied to update production jobs' using errcode = '42501';
  end if;
  perform 1 from public.orders where id = v_order_id and company_id = v_company_id for update;
  if not found then raise exception 'Selected order is not available for this company'; end if;

  v_expected := coalesce(cardinality(p_billet_ids), 0);
  if v_expected > 0 then
    perform 1
    from public.foundry_billets b
    where b.company_id = v_company_id and b.id = any(p_billet_ids)
    for update;
    select count(*) into v_actual
    from public.foundry_billets b
    where b.company_id = v_company_id
      and b.id = any(p_billet_ids)
      and b.order_id = v_order_id
      and b.status in ('allocated', 'issued')
      and (b.production_job_id is null or b.production_job_id = p_job_id);
    if v_actual <> v_expected then
      raise exception 'Selected billets are stale, incompatible, or already issued to another production job';
    end if;
  end if;

  v_payload := private.keep_jsonb_keys(p_job, array[
      'job_number','order_id','profile_id','die_id','machine_id','planned_quantity_kg','actual_quantity_kg',
      'planned_meters','actual_meters','pieces','required_billet_count','extrusion_efficiency_percent',
      'length_per_piece_m','planned_date','shift','operator_name','status','remarks','is_active',
      'source_record_id','source_line_id','section_number','section_code','section_name','customer_component_code',
      'component_description','drawing_document_id','drawing_revision','drawing_approval_status','alloy_standard_id',
      'alloy_id','temper_id','cl_uom','cl_per_uom','cl_meter','order_uom','order_quantity','quantity_kg',
      'section_weight_kg_per_m','min_weight','max_weight','weight_tolerance','quantity_calculation_method',
      'packing_mode_id','invoice_calc_uom','standard_length','cut_length','bundle_quantity',
      'pieces_per_m_per_kg_per_bundle','packing_instruction','customer_packing_requirement','material_price',
      'value_added_service_price','other_charges','basic_price','packing_charge','freight_charge',
      'alloy_surcharge_per_kg','re_cutting_charge_per_kg','testing_service_charge_per_kg','die_cost',
      'die_service_charge','packing_in_conversion','include_packing_in_basic','gst_percent','discount','margin',
      'net_rate','final_line_value','input_billet_weight','output_good_weight','rejected_weight','rework_weight',
      'packing_weight','freight_weight','theoretical_weight','actual_weight','internal_cost','supplier_rate',
      'internal_note','revision_number'
    ])
    || jsonb_build_object('company_id', v_company_id, 'order_id', v_order_id);
  if p_job_id is not null then v_payload := v_payload - 'job_number'; end if;
  if p_job_id is null then
    if nullif(v_payload ->> 'job_number', '') is null then
      v_payload := v_payload || jsonb_build_object(
        'job_number', private.next_business_number_locked(
          'public.production_jobs'::regclass,
          'job_number',
          v_company_id,
          'J',
          coalesce(nullif(v_payload ->> 'planned_date', '')::date, current_date)
        )
      );
    end if;
    v_job_id := private.insert_jsonb_row(
      'public.production_jobs'::regclass,
      v_payload || jsonb_build_object('created_by', auth.uid())
    );
  else
    perform 1 from public.production_jobs where id = p_job_id and company_id = v_company_id for update;
    if not found then raise exception 'Production job not found for this company'; end if;
    v_job_id := private.update_jsonb_row(
      'public.production_jobs'::regclass,
      p_job_id,
      v_company_id,
      v_payload || jsonb_build_object('updated_at', now())
    );
  end if;

  if v_expected > 0 then
    update public.foundry_billets
    set production_job_id = v_job_id,
        status = case when p_job ->> 'status' = 'completed' then 'consumed' else 'issued' end,
        order_id = v_order_id,
        updated_at = now()
    where company_id = v_company_id and id = any(p_billet_ids);
  end if;
  return v_job_id;
end;
$$;

create or replace function private.create_dealer_order_from_order_atomic(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_user_dealer_id uuid := private.get_current_user_dealer_id();
  v_order public.orders%rowtype;
  v_quote public.quotes%rowtype;
  v_dealer_id uuid;
  v_dealer_order public.dealer_orders%rowtype;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if private.get_current_user_role() not in ('owner','admin','sales','sales_manager','factory_manager','dealer_admin','dealer_staff') then
    raise exception 'Permission denied for dealer orders' using errcode = '42501';
  end if;
  select * into v_order from public.orders where id = p_order_id and company_id = v_company_id for update;
  if not found then raise exception 'Order not found for this company'; end if;
  if v_order.quote_id is not null then
    select * into v_quote from public.quotes where id = v_order.quote_id and company_id = v_company_id;
  end if;
  if v_user_dealer_id is not null
     and not (v_order.dealer_id = v_user_dealer_id
       or v_quote.dealer_id = v_user_dealer_id
       or v_order.created_by = auth.uid()
       or v_quote.created_by = auth.uid()) then
    raise exception 'Dealer users can only link their own orders' using errcode = '42501';
  end if;
  v_dealer_id := coalesce(v_order.dealer_id, v_quote.dealer_id, v_user_dealer_id);
  if v_dealer_id is null then raise exception 'Dealer assignment is required'; end if;
  if v_user_dealer_id is not null and v_dealer_id <> v_user_dealer_id then
    raise exception 'Dealer users can only link their own orders' using errcode = '42501';
  end if;

  select * into v_dealer_order
  from public.dealer_orders
  where company_id = v_company_id and linked_order_id = p_order_id
  order by created_at
  limit 1;
  if found then
    return jsonb_build_object('id', v_dealer_order.id, 'order_number', v_dealer_order.order_number, 'status', v_dealer_order.status);
  end if;

  update public.orders set dealer_id = v_dealer_id, updated_at = now()
  where id = p_order_id and company_id = v_company_id;
  if v_order.quote_id is not null then
    update public.quotes set dealer_id = v_dealer_id, updated_at = now()
    where id = v_order.quote_id and company_id = v_company_id and dealer_id is null;
  end if;

  insert into public.dealer_orders (
    company_id, dealer_id, linked_order_id, quote_id, order_number,
    created_by_dealer_user_id, priority, expected_delivery_date, notes, status
  ) values (
    v_company_id, v_dealer_id, p_order_id, v_order.quote_id, v_order.order_number,
    auth.uid(), coalesce(v_order.priority, 'normal'), v_order.expected_dispatch_date,
    v_order.notes, 'dealer_order_submitted'
  ) returning * into v_dealer_order;

  if v_order.quote_id is not null then
    insert into public.dealer_order_items (
      company_id, dealer_order_id, item_type, item_description, quantity, unit, finish
    )
    select
      v_company_id,
      v_dealer_order.id,
      'profile',
      coalesce(nullif(qi.item_description, ''), nullif(concat_ws(' - ', p.profile_code, p.profile_name), ''), 'Profile item'),
      coalesce(nullif(coalesce(qi.billing_weight_kg, qi.total_weight_kg), 0), nullif(qi.total_meters, 0), nullif(qi.quantity_pieces, 0), 1),
      case when coalesce(qi.billing_weight_kg, qi.total_weight_kg, 0) > 0 then 'kg'
           when coalesce(qi.total_meters, 0) > 0 then 'meters' else 'pieces' end,
      qi.finishing_type
    from public.quote_items qi
    left join public.aluminium_profiles p on p.id = qi.profile_id and p.company_id = v_company_id
    where qi.company_id = v_company_id and qi.quote_id = v_order.quote_id;
  end if;

  insert into public.dealer_order_status_history (
    company_id, dealer_order_id, new_status, changed_by, notes
  ) values (
    v_company_id, v_dealer_order.id, 'dealer_order_submitted', auth.uid(), 'Created from dealer quote order'
  );
  return jsonb_build_object('id', v_dealer_order.id, 'order_number', v_dealer_order.order_number, 'status', v_dealer_order.status);
end;
$$;

create or replace function private.update_versioned_entity_atomic(
  p_entity_type text,
  p_entity_id uuid,
  p_payload jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_table regclass;
  v_prior_state jsonb;
  v_revision integer;
  v_allowed_fields text[];
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_entity_type = 'die' then
    if v_role not in ('owner','admin','sales_manager','production_manager') then raise exception 'Permission denied for dies' using errcode = '42501'; end if;
    v_table := 'public.dies'::regclass;
    v_allowed_fields := array[
      'die_number','die_code','internal_die_reference','customer_die_reference','profile_id','customer_id',
      'ownership_type','die_status','die_type','number_of_cavities','number_of_holes','die_class',
      'application_category','end_use_industry','press_compatibility','priority_level','die_diameter_mm',
      'die_thickness_mm','die_stack_height_mm','backer_diameter_mm','bolster_diameter_mm','bearing_length_mm',
      'entry_angle_degrees','relief_angle_degrees','tongue_ratio','extrusion_ratio','ccd_mm','output_per_stroke_kg',
      'feeder_plate_details','mandrel_details','bridge_details','porthole_details','welding_chamber_details',
      'bearing_corrections','pocketing_details','choke_details','drawing_revision','drawing_approval_status',
      'die_steel_grade','die_vendor_id','purchase_order_reference','manufacturing_date','receipt_date',
      'heat_treatment_status','hardness_before_nitriding','hardness_after_nitriding','hrc_value','hv_value',
      'dimensional_inspection_status','performance_grade','die_blocked_reason','die_retirement_reason',
      'storage_bin','billet_diameter_required_inch','rack_location','total_production_kg','total_runs',
      'last_used_date','die_manufacturer','die_cost','purchase_date','correction_history','drawing_url','notes'
    ];
  elsif p_entity_type = 'profile' then
    if v_role not in ('owner','admin') then raise exception 'Permission denied for profiles' using errcode = '42501'; end if;
    v_table := 'public.aluminium_profiles'::regclass;
    v_allowed_fields := array[
      'profile_code','profile_name','section_number','internal_profile_reference','customer_profile_reference',
      'application_category','product_family','system_type','end_use_industry','section_weight_kg_per_m',
      'actual_weight_kg_per_m','weight_tolerance_percent','alloy','temper','recommended_alloy',
      'temper_requirement','tensile_strength_mpa','yield_strength_mpa','elongation_percent','finish_options',
      'standard_length_m','min_cutting_length_m','max_cutting_length_m','billet_diameter_required_inch',
      'section_perimeter_mm','circumscribing_circle_diameter_mm','nominal_wall_thickness_mm',
      'min_wall_thickness_mm','max_wall_thickness_mm','critical_wall_thickness_mm','profile_classification',
      'number_of_voids','complexity_rating','tolerance_class','bundle_quantity','pieces_per_bundle',
      'meter_per_bundle','kg_per_bundle','surface_area_per_meter_sqm','powder_coating_area_sqm',
      'anodizing_area_sqm','scrap_factor_percent','recovery_target_percent','min_acceptable_recovery_percent',
      'recommended_press','billet_alloy','billet_temperature_range','container_temperature_range',
      'die_temperature_range','ram_speed_range','exit_temperature_range','puller_speed_range','quench_method',
      'stretching_requirement','aging_requirement','cutting_instructions','handling_instructions',
      'special_production_notes','mill_finish_allowed','powder_coating_allowed','anodizing_allowed',
      'wood_finish_allowed','pvdf_allowed','special_finish_allowed','coating_thickness_microns',
      'anodizing_micron_requirement','pre_treatment_requirement','base_rate_per_kg','minimum_order_quantity_kg',
      'packing_cost_per_kg','production_cost_per_kg','energy_cost_per_kg','primary_die_id','backup_die_id',
      'drawing_revision','drawing_approval_status','approval_status','drawing_url','cross_section_image_url',
      'image_url','notes','is_active'
    ];
  else
    raise exception 'Unsupported versioned entity type';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':' || p_entity_type || ':' || p_entity_id::text, 0));
  execute format('select to_jsonb(t) from %s t where t.id = $1 and t.company_id = $2 for update', v_table)
    using p_entity_id, v_company_id into v_prior_state;
  if v_prior_state is null then raise exception 'Record not found or access denied'; end if;

  select coalesce(max(revision_number), 0) + 1 into v_revision
  from public.entity_revisions
  where company_id = v_company_id and entity_type = p_entity_type and entity_id = p_entity_id;
  insert into public.entity_revisions (
    company_id, entity_type, entity_id, revision_number, prior_state, actor_id
  ) values (
    v_company_id, p_entity_type, p_entity_id, v_revision, v_prior_state, auth.uid()
  );
  perform private.update_jsonb_row(
    v_table,
    p_entity_id,
    v_company_id,
    private.keep_jsonb_keys(p_payload, v_allowed_fields)
      || jsonb_build_object('updated_at', now())
  );
  return v_revision;
end;
$$;

-- Add race protection where existing data permits it. Row locks in the RPCs
-- still provide retry safety when a legacy tenant already contains duplicates.
do $$
begin
  if not exists (
    select 1 from public.orders where quote_id is not null
    group by company_id, quote_id having count(*) > 1
  ) then
    create unique index if not exists orders_company_quote_unique
      on public.orders(company_id, quote_id) where quote_id is not null;
  else
    raise warning 'Skipped orders_company_quote_unique because legacy duplicate quote links exist';
  end if;
  if not exists (
    select 1 from public.dealer_orders where linked_order_id is not null
    group by company_id, linked_order_id having count(*) > 1
  ) then
    create unique index if not exists dealer_orders_company_linked_order_unique
      on public.dealer_orders(company_id, linked_order_id) where linked_order_id is not null;
  else
    raise warning 'Skipped dealer_orders_company_linked_order_unique because legacy duplicate links exist';
  end if;
end $$;

create or replace function public.convert_quote_to_order_atomic(p_quote_id uuid, p_order jsonb)
returns uuid language sql security definer set search_path = public, private
as $$ select private.convert_quote_to_order_atomic(p_quote_id, p_order) $$;
create or replace function public.save_order_atomic(p_order_id uuid, p_order jsonb)
returns uuid language sql security definer set search_path = public, private
as $$ select private.save_order_atomic(p_order_id, p_order) $$;
create or replace function public.save_dispatch_atomic(p_dispatch_id uuid, p_dispatch jsonb, p_items jsonb, p_order_stage text)
returns uuid language sql security definer set search_path = public, private
as $$ select private.save_dispatch_atomic(p_dispatch_id, p_dispatch, p_items, p_order_stage) $$;
create or replace function public.save_invoice_atomic(p_invoice_id uuid, p_invoice jsonb, p_items jsonb, p_replace_items boolean)
returns uuid language sql security definer set search_path = public, private
as $$ select private.save_invoice_atomic(p_invoice_id, p_invoice, p_items, p_replace_items) $$;
create or replace function public.replace_invoice_items_atomic(p_invoice_id uuid, p_items jsonb)
returns uuid language sql security definer set search_path = public, private
as $$ select private.replace_invoice_items_atomic(p_invoice_id, p_items) $$;
create or replace function public.save_production_job_atomic(p_job_id uuid, p_job jsonb, p_billet_ids uuid[])
returns uuid language sql security definer set search_path = public, private
as $$ select private.save_production_job_atomic(p_job_id, p_job, p_billet_ids) $$;
create or replace function public.create_dealer_order_from_order_atomic(p_order_id uuid)
returns jsonb language sql security definer set search_path = public, private
as $$ select private.create_dealer_order_from_order_atomic(p_order_id) $$;
create or replace function public.update_versioned_entity_atomic(p_entity_type text, p_entity_id uuid, p_payload jsonb)
returns integer language sql security definer set search_path = public, private
as $$ select private.update_versioned_entity_atomic(p_entity_type, p_entity_id, p_payload) $$;

revoke all on function public.convert_quote_to_order_atomic(uuid, jsonb) from public, anon;
revoke all on function public.save_order_atomic(uuid, jsonb) from public, anon;
revoke all on function public.save_dispatch_atomic(uuid, jsonb, jsonb, text) from public, anon;
revoke all on function public.save_invoice_atomic(uuid, jsonb, jsonb, boolean) from public, anon;
revoke all on function public.replace_invoice_items_atomic(uuid, jsonb) from public, anon;
revoke all on function public.save_production_job_atomic(uuid, jsonb, uuid[]) from public, anon;
revoke all on function public.create_dealer_order_from_order_atomic(uuid) from public, anon;
revoke all on function public.update_versioned_entity_atomic(text, uuid, jsonb) from public, anon;
revoke all on function private.keep_jsonb_keys(jsonb, text[]) from public, anon, authenticated;
revoke all on function private.insert_jsonb_row(regclass, jsonb) from public, anon, authenticated;
revoke all on function private.update_jsonb_row(regclass, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function private.next_business_number_locked(regclass, text, uuid, text, date) from public, anon, authenticated;
revoke all on function private.convert_quote_to_order_atomic(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.save_order_atomic(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.save_dispatch_atomic(uuid, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function private.save_invoice_atomic(uuid, jsonb, jsonb, boolean) from public, anon, authenticated;
revoke all on function private.replace_invoice_items_atomic(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.save_production_job_atomic(uuid, jsonb, uuid[]) from public, anon, authenticated;
revoke all on function private.create_dealer_order_from_order_atomic(uuid) from public, anon, authenticated;
revoke all on function private.update_versioned_entity_atomic(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.convert_quote_to_order_atomic(uuid, jsonb) to authenticated;
grant execute on function public.save_order_atomic(uuid, jsonb) to authenticated;
grant execute on function public.save_dispatch_atomic(uuid, jsonb, jsonb, text) to authenticated;
grant execute on function public.save_invoice_atomic(uuid, jsonb, jsonb, boolean) to authenticated;
grant execute on function public.replace_invoice_items_atomic(uuid, jsonb) to authenticated;
grant execute on function public.save_production_job_atomic(uuid, jsonb, uuid[]) to authenticated;
grant execute on function public.create_dealer_order_from_order_atomic(uuid) to authenticated;
grant execute on function public.update_versioned_entity_atomic(text, uuid, jsonb) to authenticated;

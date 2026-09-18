begin;

create or replace function public.recalculate_quote_item_financials()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total_meters numeric := round(greatest(coalesce(new.quantity_pieces, 0), 0) * greatest(coalesce(new.length_per_piece_m, 0), 0), 3);
  v_total_weight numeric;
  v_effective_weight numeric;
  v_billing_weight numeric;
  v_raw_material numeric;
  v_conversion numeric;
  v_finishing numeric;
  v_die_amortization numeric;
  v_line_subtotal numeric;
  v_margin numeric;
  v_calculated_total numeric;
  v_line_total numeric;
begin
  v_total_weight := round(v_total_meters * greatest(coalesce(new.section_weight_kg_per_m, 0), 0), 3);
  v_effective_weight := round(v_total_weight * (1 + greatest(coalesce(new.scrap_allowance_percent, 0), 0) / 100), 3);
  v_billing_weight := round(greatest(v_effective_weight, greatest(coalesce(new.minimum_billing_weight_kg, 0), 0)), 3);
  v_raw_material := round(v_billing_weight * greatest(coalesce(new.billet_rate_per_kg, 0), 0), 2);
  v_conversion := round(v_billing_weight * greatest(coalesce(new.conversion_charge_per_kg, 0), 0), 2);

  v_finishing := case new.finishing_charge_type
    when 'per_kg' then round(v_billing_weight * greatest(coalesce(new.finishing_charge, 0), 0), 2)
    when 'per_meter' then round(v_total_meters * greatest(coalesce(new.finishing_charge, 0), 0), 2)
    when 'fixed' then round(greatest(coalesce(new.finishing_charge, 0), 0), 2)
    when 'per_sqft' then round(v_total_meters * 0.3 * 10.764 * greatest(coalesce(new.finishing_charge, 0), 0), 2)
    else 0
  end;

  v_die_amortization := case new.die_amortization_type
    when 'waived' then 0
    when 'customer_paid' then 0
    when 'per_kg' then case when greatest(coalesce(new.die_amortization_quantity_kg, 0), 0) > 0
      then round(greatest(coalesce(new.die_charge, 0), 0) / new.die_amortization_quantity_kg * v_billing_weight, 2)
      else 0 end
    else round(greatest(coalesce(new.die_charge, 0), 0), 2)
  end;

  v_line_subtotal := round(
    v_raw_material + v_conversion + v_finishing + v_die_amortization
      + greatest(coalesce(new.packing_charge, 0), 0)
      + greatest(coalesce(new.transport_charge, 0), 0)
      + greatest(coalesce(new.other_charges, 0), 0), 2
  );
  v_margin := round(v_line_subtotal * greatest(coalesce(new.margin_percent, 0), 0) / 100, 2);
  v_calculated_total := round(v_line_subtotal + v_margin, 2);
  new.sales_price_override := case
    when coalesce(new.sales_price_override, 0) > 0 then round(new.sales_price_override, 2)
    else null
  end;
  v_line_total := coalesce(new.sales_price_override, v_calculated_total);

  new.total_meters := v_total_meters;
  new.total_weight_kg := v_total_weight;
  new.effective_weight_kg := v_effective_weight;
  new.billing_weight_kg := v_billing_weight;
  new.raw_material_cost := v_raw_material;
  new.conversion_cost := v_conversion;
  new.finishing_cost := v_finishing;
  new.die_amortization_amount := v_die_amortization;
  new.line_subtotal := v_line_subtotal;
  new.margin_amount := v_margin;
  new.line_total_before_gst := v_line_total;
  new.estimated_profit_amount := round(v_line_total - v_line_subtotal, 2);
  new.estimated_profit_percent := case when v_line_total > 0
    then round((new.estimated_profit_amount / v_line_total) * 100, 2) else 0 end;
  new.approval_required := new.estimated_profit_percent < greatest(coalesce(new.minimum_margin_percent, 0), 0)
    or new.estimated_profit_amount < 0;
  new.price_per_kg := case when v_billing_weight > 0 then round(v_line_total / v_billing_weight, 2) else 0 end;
  new.price_per_meter := case when v_total_meters > 0 then round(v_line_total / v_total_meters, 2) else 0 end;
  return new;
end;
$$;

drop trigger if exists recalculate_quote_item_financials on public.quote_items;
create trigger recalculate_quote_item_financials
before insert or update on public.quote_items
for each row execute function public.recalculate_quote_item_financials();

revoke all on function public.recalculate_quote_item_financials() from public, anon, authenticated;

create or replace function public.derive_order_value_from_quote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote record;
begin
  if new.quote_id is null then return new; end if;
  select company_id, customer_id, grand_total into v_quote
  from public.quotes where id = new.quote_id;
  if v_quote.company_id is null or v_quote.company_id <> new.company_id then
    raise exception 'Order quote does not belong to the selected company' using errcode = '23514';
  end if;
  if v_quote.customer_id <> new.customer_id then
    raise exception 'Order customer does not match the selected quote' using errcode = '23514';
  end if;
  new.order_value := coalesce(v_quote.grand_total, 0);
  return new;
end;
$$;

drop trigger if exists derive_order_value_from_quote on public.orders;
create trigger derive_order_value_from_quote
before insert or update of company_id, quote_id, customer_id, order_value
on public.orders
for each row execute function public.derive_order_value_from_quote();

revoke all on function public.derive_order_value_from_quote() from public, anon, authenticated;

-- Keep the generic order save RPC atomic while ensuring a quoted order has a
-- durable snapshot of the source lines for production and dispatch handoffs.
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
  v_item jsonb;
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
        'public.orders'::regclass, 'order_number', v_company_id, 'O',
        coalesce(nullif(v_payload ->> 'order_date', '')::date, current_date)
      ), 'created_by', auth.uid()
    );
    v_order_id := private.insert_jsonb_row('public.orders'::regclass, v_payload);
  else
    perform 1 from public.orders where id = p_order_id and company_id = v_company_id for update;
    if not found then raise exception 'Order not found for this company'; end if;
    v_order_id := private.update_jsonb_row('public.orders'::regclass, p_order_id, v_company_id, v_payload || jsonb_build_object('updated_at', now()));
  end if;

  if p_order_id is null and v_quote_id is not null then
    for v_item in select to_jsonb(qi) from public.quote_items qi
      where qi.company_id = v_company_id and qi.quote_id = v_quote_id
      order by qi.created_at, qi.id
    loop
      perform private.insert_jsonb_row(
        'public.order_items'::regclass,
        (v_item - array['id','company_id','quote_id','created_at','updated_at'])
          || jsonb_build_object(
            'company_id', v_company_id, 'order_id', v_order_id,
            'source_record_id', v_quote_id,
            'source_line_id', nullif(v_item ->> 'id', '')::uuid,
            'quote_item_id', nullif(v_item ->> 'id', '')::uuid,
            'created_at', now(), 'updated_at', now()
          )
      );
    end loop;
  end if;
  return v_order_id;
end;
$$;

revoke all on function private.save_order_atomic(uuid, jsonb) from public, anon, authenticated;

commit;

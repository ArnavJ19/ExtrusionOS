-- EXOS-AUD-026: the quote's per-kg rate did not reproduce the quoted value on the
-- invoice. quote_items.net_rate (copied to the order line, then to every packing row
-- and invoice line) was line amount / billing weight, where billing weight includes
-- the scrap allowance and the minimum billing weight. Invoices bill the actual net kg
-- shipped, so a 1,000 kg line quoted with a 5% allowance invoiced 4.8% less than
-- quoted, and a minimum billing weight was never billed.
--
-- Billing basis (fixed by GST and by the quote itself, not a new commercial policy):
--   * Invoice quantity stays the actual net kg shipped: a tax invoice must state the
--     quantity actually supplied, so it cannot bill allowance kg that were not shipped.
--   * The invoice rate per kg is the quoted line amount / the physical kg of the quoted
--     quantity (pieces x length x section kg/m). Shipping the quoted quantity therefore
--     invoices exactly the quoted amount, including the scrap allowance, the minimum
--     billing weight and the die, packing, freight and other charges priced into it
--     (bundled charges are part of the transaction value of the goods for GST). A short
--     or partial shipment bills pro rata; public.get_order_billing_reconciliation shows
--     quoted vs invoiced value per order line so the remainder is visible.
--   * invoice_calc_uom: invoicing is per kg only. Per-metre and per-piece values were
--     stored but silently ignored; they are now rejected (CHECK) instead.
-- Quote lines saved before this migration keep their stored rate until recalculated
-- (on hosted every line has billing weight = physical weight, so the rates are equal).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.recalculate_quote_item_financials()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if coalesce(new.expected_recovery_percent, 100) <= 0 or coalesce(new.expected_recovery_percent, 100) > 100 then
    raise exception 'Recovery must be above zero and at most 100 percent';
  end if;
  if coalesce(new.margin_percent, 0) < 0 or coalesce(new.margin_percent, 0) >= 100 then
    raise exception 'Margin on selling price must be below 100 percent';
  end if;
  select section_perimeter_mm, nullif(hsn_code, '') into new.perimeter_mm, new.hsn_code
  from public.aluminium_profiles where id = new.profile_id and company_id = new.company_id;
  new.surface_area_sqft := v_total_meters * greatest(coalesce(new.perimeter_mm, 0), 0) / 1000 * 10.76391041671;
  new.costing_complete := new.finishing_charge_type <> 'per_sqft' or new.surface_area_sqft > 0;
  if new.gst_percent is null then
    select gst_percent into new.gst_percent from public.quotes where id = new.quote_id and company_id = new.company_id;
  end if;
  if new.gst_percent is null or new.gst_percent < 0 or new.gst_percent > 100 then raise exception 'Invalid line GST rate'; end if;
  v_total_weight := round(v_total_meters * greatest(coalesce(new.section_weight_kg_per_m, 0), 0), 3);
  v_effective_weight := round(v_total_weight * (1 + greatest(coalesce(new.scrap_allowance_percent, 0), 0) / 100), 3);
  v_billing_weight := round(greatest(v_effective_weight, greatest(coalesce(new.minimum_billing_weight_kg, 0), 0)), 3);
  new.billet_input_kg := round(v_billing_weight / (coalesce(new.expected_recovery_percent, 100) / 100), 3);
  v_raw_material := round(v_billing_weight / (coalesce(new.expected_recovery_percent, 100) / 100) * greatest(coalesce(new.billet_rate_per_kg, 0), 0), 2);
  v_conversion := round(v_billing_weight * greatest(coalesce(new.conversion_charge_per_kg, 0), 0), 2);

  v_finishing := case new.finishing_charge_type
    when 'per_kg' then round(v_billing_weight * greatest(coalesce(new.finishing_charge, 0), 0), 2)
    when 'per_meter' then round(v_total_meters * greatest(coalesce(new.finishing_charge, 0), 0), 2)
    when 'fixed' then round(greatest(coalesce(new.finishing_charge, 0), 0), 2)
    when 'per_sqft' then round(new.surface_area_sqft * greatest(coalesce(new.finishing_charge, 0), 0), 2)
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
  v_calculated_total := round(v_line_subtotal / (1 - coalesce(new.margin_percent, 0) / 100), 2);
  v_margin := v_calculated_total - v_line_subtotal;
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
  -- PCDA money fields are line totals except net_rate. net_rate is the invoice rate per actual
  -- (physical) kg: line amount / physical kg, so shipping the quoted quantity invoices the quoted
  -- amount (scrap allowance, minimum billing weight and one-off charges included). EXOS-AUD-026.
  new.quantity_kg := v_billing_weight;
  new.material_price := v_raw_material;
  new.value_added_service_price := v_conversion + v_finishing;
  new.basic_price := v_raw_material + v_conversion + v_finishing + greatest(coalesce(new.other_charges, 0), 0);
  new.freight_charge := greatest(coalesce(new.transport_charge, 0), 0);
  new.die_service_charge := v_die_amortization;
  new.packing_in_conversion := true;
  new.include_packing_in_basic := false;
  new.margin := new.estimated_profit_amount;
  new.theoretical_weight := v_total_weight;
  new.net_rate := case when v_total_weight > 0 then round(v_line_total / v_total_weight, 2) else new.price_per_kg end;
  new.final_line_value := v_line_total;
  new.internal_cost := v_line_subtotal;
  return new;
end;
$function$;


-- Invoicing is per actual kg; other units were stored but never applied.
do $$
declare v_table text;
begin
  foreach v_table in array array['quote_items','order_items','packing_list_items','invoice_items','production_jobs'] loop
    if not exists (select 1 from pg_constraint where conname = v_table || '_invoice_calc_uom_kg') then
      execute format('alter table public.%I add constraint %I check (invoice_calc_uom is null or invoice_calc_uom = %L) not valid',
        v_table, v_table || '_invoice_calc_uom_kg', 'kg');
      execute format('alter table public.%I validate constraint %I', v_table, v_table || '_invoice_calc_uom_kg');
    end if;
  end loop;
end;
$$;

-- Quoted vs invoiced value per order line (finance roles, same as invoices_authorized).
create or replace function private.get_order_billing_reconciliation(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private
as $fn$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
begin
  if auth.uid() is null or v_company_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if v_role not in ('owner','admin','accounts') then raise exception 'Only owner, admin or accounts can see billing reconciliation' using errcode = '42501'; end if;
  if not exists (select 1 from public.orders o where o.id = p_order_id and o.company_id = v_company_id) then
    raise exception 'Order not found for this company' using errcode = '23514';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'orderItemId', r.id, 'profileId', r.profile_id,
      'quotedKg', r.quoted_kg, 'quotedValue', r.quoted_value, 'invoiceRatePerKg', r.net_rate,
      'invoicedKg', r.invoiced_kg, 'invoicedValue', r.invoiced_value,
      'uninvoicedValue', round(r.quoted_value - r.invoiced_value, 2)
    ) order by r.created_at, r.id)
    from (
      select oi.id, oi.profile_id, oi.created_at, oi.net_rate,
        coalesce(qi.total_weight_kg, oi.theoretical_weight, 0)::numeric(14,3) quoted_kg,
        coalesce(oi.final_line_value, qi.line_total_before_gst, 0)::numeric(14,2) quoted_value,
        coalesce(inv.kg, 0)::numeric(14,3) invoiced_kg,
        coalesce(inv.value, 0)::numeric(14,2) invoiced_value
      from public.order_items oi
      left join public.quote_items qi on qi.id = oi.quote_item_id and qi.company_id = oi.company_id
      left join lateral (
        select sum(ii.quantity) kg, sum(ii.line_total) value
        from public.invoice_items ii
        join public.invoices i on i.id = ii.invoice_id and i.company_id = ii.company_id
        where ii.order_item_id = oi.id and ii.company_id = oi.company_id
          and i.deleted_at is null and i.status not in ('draft','cancelled')
      ) inv on true
      where oi.order_id = p_order_id and oi.company_id = v_company_id
    ) r), '[]'::jsonb);
end;
$fn$;
revoke all on function private.get_order_billing_reconciliation(uuid) from public, anon, authenticated;
create or replace function public.get_order_billing_reconciliation(p_order_id uuid)
returns jsonb language sql stable security definer set search_path = public, private
as $fn$ select private.get_order_billing_reconciliation(p_order_id) $fn$;
revoke all on function public.get_order_billing_reconciliation(uuid) from public, anon;
grant execute on function public.get_order_billing_reconciliation(uuid) to authenticated;

commit;

// Reproduce the additive migration from the latest authoritative definitions.
// Exact replacements deliberately fail if the source migrations drift.
import { readFileSync, writeFileSync } from "node:fs";
const root = new URL("../supabase/migrations/", import.meta.url);
function definition(file, name) {
  const source = readFileSync(new URL(file, root), "utf8").replaceAll("\r\n", "\n");
  const start = source.indexOf(`create or replace function ${name}(`);
  const end = source.indexOf("\n$$;", start);
  if (start < 0 || end < 0) throw new Error(`Missing ${name}`);
  return source.slice(start, end + 4);
}
function replace(source, from, to) {
  if (!source.includes(from)) throw new Error(`Missing replacement: ${from}`);
  return source.replace(from, to);
}
const atomic = "20260715000000_atomic_business_workflows.sql";
const financial = "20260810030000_quote_and_order_financial_integrity.sql";
let numbering = definition(atomic, "private.next_business_number_locked");
numbering = replace(numbering, "coalesce(p_business_date, current_date)", "coalesce(p_business_date, (now() at time zone 'Asia/Kolkata')::date)");
numbering = replace(numbering, "lpad(v_sequence::text, 4, '0')", "lpad(v_sequence::text, greatest(4, length(v_sequence::text)), '0')");
let quote = definition(financial, "public.recalculate_quote_item_financials");
quote = replace(quote, "begin\n  v_total_weight", `begin
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
  v_total_weight`);
quote = replace(quote, "v_raw_material := round(v_billing_weight * greatest(coalesce(new.billet_rate_per_kg, 0), 0), 2);", `new.billet_input_kg := round(v_billing_weight / (coalesce(new.expected_recovery_percent, 100) / 100), 3);
  v_raw_material := round(v_billing_weight / (coalesce(new.expected_recovery_percent, 100) / 100) * greatest(coalesce(new.billet_rate_per_kg, 0), 0), 2);`);
quote = replace(quote, "v_total_meters * 0.3 * 10.764", "new.surface_area_sqft");
quote = replace(quote, "v_margin := round(v_line_subtotal * greatest(coalesce(new.margin_percent, 0), 0) / 100, 2);\n  v_calculated_total := round(v_line_subtotal + v_margin, 2);", "v_calculated_total := round(v_line_subtotal / (1 - coalesce(new.margin_percent, 0) / 100), 2);\n  v_margin := v_calculated_total - v_line_subtotal;");
quote = replace(quote, "  return new;", `  -- PCDA money fields are line totals except net_rate (per billed kg).
  new.quantity_kg := v_billing_weight;
  new.material_price := v_raw_material;
  new.value_added_service_price := v_conversion + v_finishing;
  new.basic_price := v_raw_material + v_conversion + v_finishing + greatest(coalesce(new.other_charges, 0), 0);
  new.freight_charge := greatest(coalesce(new.transport_charge, 0), 0);
  new.die_service_charge := v_die_amortization;
  new.packing_in_conversion := true;
  new.include_packing_in_basic := false;
  new.margin := new.estimated_profit_amount;
  new.net_rate := new.price_per_kg;
  new.final_line_value := v_line_total;
  new.internal_cost := v_line_subtotal;
  return new;`);
let header = definition("20260812000000_security_and_notification_integrity.sql", "private.derive_quote_header_financials");
header = replace(header, "v_gst_amount := round(v_subtotal * v_gst_percent / 100, 2);", `select coalesce(sum(round(item.line_total_before_gst * coalesce(item.gst_percent, v_gst_percent) / 100, 2)), 0)
  into v_gst_amount from public.quote_items item where item.company_id = new.company_id and item.quote_id = new.id;`);
let conversion = definition(atomic, "private.convert_quote_to_order_atomic");
conversion = replace(conversion, "'source_record_id', p_quote_id,", "'source_record_id', p_quote_id,\n          'source_line_id', (v_item ->> 'id')::uuid,\n          'quote_item_id', (v_item ->> 'id')::uuid,");
let collection = definition("20260723070000_dispatch_return_credit_notes.sql", "private.recalculate_invoice_collection_state");
collection = replace(collection, "v_effective_paid = v_invoice.grand_total", "v_effective_paid + v_invoice.credited_amount >= v_invoice.grand_total");
let order = definition(financial, "public.derive_order_value_from_quote");
order = replace(order, "if new.quote_id is null then return new; end if;", `if new.quote_id is null then
    select coalesce(sum(coalesce(final_line_value, 0) + round(coalesce(final_line_value, 0) * coalesce(gst_percent, 0) / 100, 2)), 0)
    into new.order_value from public.order_items where order_id = new.id and company_id = new.company_id;
    return new;
  end if;`);
let dealer = definition("20260723055000_canonical_factory_minimum_queue.sql", "private.create_order_from_quote_with_dealer_stock");
dealer = replace(dealer, "  select organization_type", `  p_order_number := private.next_business_number_locked('public.orders'::regclass, 'order_number', v_company_id, 'O', coalesce(p_order_date, (now() at time zone 'Asia/Kolkata')::date));
  select organization_type`);
let invoice = definition("20260718010000_financial_closure.sql", "private.save_invoice_atomic");
invoice = replace(invoice, "'invoice_number', 'invoice_date', 'due_date', 'status', 'notes'", "'invoice_number', 'invoice_date', 'due_date', 'status', 'notes', 'place_of_supply_state_code'");
let versioned = definition(atomic, "private.update_versioned_entity_atomic");
versioned = replace(versioned, "'section_perimeter_mm'", "'hsn_code','section_perimeter_mm'");
const prelude = readFileSync(new URL("../sql/business-logic-prelude.sql", import.meta.url), "utf8");
const postlude = readFileSync(new URL("../sql/business-logic-postlude.sql", import.meta.url), "utf8");
writeFileSync(new URL("20260929000000_business_logic_fixes.sql", root), ["-- Generated by scripts/build-business-logic-migration.mjs. Historical records are not repriced.", "begin;", numbering, prelude, quote, header, conversion, collection, order, dealer, invoice, versioned, postlude, "commit;", ""].join("\n\n"));

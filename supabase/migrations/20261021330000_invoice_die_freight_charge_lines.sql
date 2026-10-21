-- EXOS-AUD-026 follow-up: die and freight charges as separate invoice lines.
-- 20261021310000 made the per-kg invoice rate reproduce the quoted amount by carrying the die,
-- packing, freight and other charges inside the rate, so die and freight were spread over every
-- invoice by kg shipped. Now:
--   * A quote line with a die charge (die_amortization_amount) or freight (transport_charge)
--     sets charges_billed_separately and its invoice rate per actual kg excludes them:
--     net_rate = (line amount - die - freight) / physical kg. Order lines copy both.
--   * When an invoice is saved, private.add_invoice_charge_lines adds one 'die_charge' and one
--     'freight_charge' line per order line, at the quoted amounts, on the first active
--     (not cancelled, not deleted) invoice that bills that order line. A per-order-line advisory
--     lock stops two invoices taking the same charge. If that invoice is cancelled, the next
--     invoice saved for the line takes the charge. Shipping the quoted quantity therefore still
--     invoices the quoted amount (goods at the rate plus the two charges).
--   * Charge lines carry the order line's HSN code and GST rate (ancillary charges of the goods
--     supply), no quantity and no per-kg rate, and are validated against the order line.
--   * Lines saved before this migration (charges_billed_separately = false) keep billing the
--     charges inside the rate, so nothing is billed twice. Hosted had no invoices or order lines.
--   * Partial credit notes stay per packing row; a full return credit note copies every line
--     of the invoice, charge lines included.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.quote_items add column if not exists charges_billed_separately boolean not null default false;
alter table public.order_items add column if not exists charges_billed_separately boolean not null default false;
alter table public.invoice_items add column if not exists line_kind text not null default 'goods';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'invoice_items_line_kind_check') then
    alter table public.invoice_items add constraint invoice_items_line_kind_check check (line_kind in ('goods','die_charge','freight_charge'));
  end if;
end $$;
create index if not exists invoice_items_charge_lookup_idx on public.invoice_items(company_id, order_item_id, line_kind) where line_kind <> 'goods';


-- Packing-line canonicalisation applies to goods lines only.
drop trigger if exists canonicalize_invoice_packing_line on public.invoice_items;
create trigger canonicalize_invoice_packing_line before insert or update on public.invoice_items
  for each row when (new.line_kind = 'goods') execute function private.canonicalize_invoice_packing_line();
drop trigger if exists zz_canonicalize_invoice_commercial_lineage on public.invoice_items;
create trigger zz_canonicalize_invoice_commercial_lineage before insert or update on public.invoice_items
  for each row when (new.line_kind = 'goods') execute function private.canonicalize_invoice_commercial_lineage();
drop trigger if exists zzz_canonicalize_invoice_tax_line on public.invoice_items;
create trigger zzz_canonicalize_invoice_tax_line before insert or update on public.invoice_items
  for each row when (new.line_kind = 'goods') execute function private.canonicalize_invoice_tax_line();

CREATE OR REPLACE FUNCTION private.assert_invoice_packing_coverage()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_invoice_id uuid;
  v_company_id uuid;
  v_dispatch_id uuid;
  v_packing_count integer;
  v_invoice_count integer;
  v_distinct_source_count integer;
begin
  if tg_op = 'DELETE' then
    v_invoice_id := old.invoice_id;
  else
    v_invoice_id := new.invoice_id;
  end if;

  select company_id, dispatch_id
  into v_company_id, v_dispatch_id
  from public.invoices
  where id = v_invoice_id;

  if not found then
    return null;
  end if;
  if v_dispatch_id is null then
    raise exception 'Invoice must remain linked to a dispatch';
  end if;

  select count(*)
  into v_packing_count
  from public.packing_list_items
  where company_id = v_company_id
    and dispatch_id = v_dispatch_id;

  select count(*), count(distinct source_line_id)
  into v_invoice_count, v_distinct_source_count
  from public.invoice_items
  where company_id = v_company_id
    and invoice_id = v_invoice_id
    and line_kind = 'goods';

  if v_packing_count = 0
    or v_invoice_count <> v_packing_count
    or v_distinct_source_count <> v_packing_count
  then
    raise exception 'Invoice must include every packing row from its dispatch exactly once';
  end if;

  return null;
end;
$function$;

-- Charge lines: the amount, HSN and GST come from the order line; nothing is taken from the client.
create or replace function private.canonicalize_invoice_charge_line()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $fn$
declare
  v_invoice public.invoices%rowtype;
  v_line public.order_items%rowtype;
  v_amount numeric(14,2);
begin
  if tg_op = 'UPDATE' and (old.line_kind is distinct from new.line_kind or old.invoice_id is distinct from new.invoice_id) then
    raise exception 'Invoice charge lines cannot change kind or invoice' using errcode = '23514';
  end if;
  select * into v_invoice from public.invoices where id = new.invoice_id;
  if not found or v_invoice.dispatch_id is null then raise exception 'Invoice charge lines require a dispatch-backed invoice' using errcode = '23514'; end if;
  select * into v_line from public.order_items where id = new.order_item_id and company_id = v_invoice.company_id and order_id = v_invoice.order_id;
  if not found then raise exception 'Invoice charge line must belong to an order line of the invoiced order' using errcode = '23514'; end if;
  if not v_line.charges_billed_separately then raise exception 'This order line bills its charges inside the per-kg rate' using errcode = '23514'; end if;
  v_amount := round(coalesce(case new.line_kind when 'die_charge' then v_line.die_service_charge else v_line.freight_charge end, 0), 2);
  if v_amount <= 0 then raise exception 'The order line has no % to bill', replace(new.line_kind, '_', ' ') using errcode = '23514'; end if;
  new.company_id := v_invoice.company_id;
  new.source_record_id := v_invoice.dispatch_id;
  new.source_line_id := null;
  new.quote_item_id := v_line.quote_item_id;
  new.profile_id := v_line.profile_id;
  new.quantity := null;
  new.unit_rate := null;
  new.net_rate := null;
  new.line_total := v_amount;
  new.final_line_value := v_amount;
  new.item_description := case new.line_kind when 'die_charge' then 'Die charge (one-time)' else 'Freight charge' end
    || coalesce(' - ' || nullif(coalesce(v_line.section_code, (select profile_code from public.aluminium_profiles p where p.id = v_line.profile_id)), ''), '');
  select coalesce(nullif(v_line.hsn_code, ''), nullif(qi.hsn_code, ''), nullif(p.hsn_code, '')), coalesce(v_line.gst_percent, qi.gst_percent)
  into new.hsn_code, new.gst_percent
  from (select 1) one
  left join public.quote_items qi on qi.id = v_line.quote_item_id and qi.company_id = v_line.company_id
  left join public.aluminium_profiles p on p.id = v_line.profile_id and p.company_id = v_line.company_id;
  if new.hsn_code is null or new.hsn_code !~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$' then raise exception 'Set a valid HSN code on every invoiced profile'; end if;
  if new.gst_percent is null or new.gst_percent < 0 or new.gst_percent > 100 then raise exception 'Every invoiced source line requires a valid GST rate'; end if;
  if exists (select 1 from public.invoice_items other join public.invoices i on i.id = other.invoice_id and i.company_id = other.company_id
      where other.company_id = new.company_id and other.order_item_id = new.order_item_id and other.line_kind = new.line_kind
        and other.id is distinct from new.id and i.status <> 'cancelled' and i.deleted_at is null) then
    raise exception 'This % is already billed on another invoice', replace(new.line_kind, '_', ' ') using errcode = '23514';
  end if;
  return new;
end;
$fn$;
revoke all on function private.canonicalize_invoice_charge_line() from public, anon, authenticated;
drop trigger if exists canonicalize_invoice_charge_line on public.invoice_items;
create trigger canonicalize_invoice_charge_line before insert or update on public.invoice_items
  for each row when (new.line_kind <> 'goods') execute function private.canonicalize_invoice_charge_line();

create or replace function private.add_invoice_charge_lines(p_invoice_id uuid, p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $fn$
declare
  v_line record;
  v_kind text;
  v_amount numeric;
begin
  for v_line in
    select oi.id, oi.die_service_charge, oi.freight_charge
    from public.order_items oi
    where oi.company_id = p_company_id and oi.charges_billed_separately
      and oi.id in (select ii.order_item_id from public.invoice_items ii
        where ii.invoice_id = p_invoice_id and ii.company_id = p_company_id and ii.line_kind = 'goods')
    order by oi.id
  loop
    perform pg_advisory_xact_lock(hashtextextended('order-line-charges:' || v_line.id::text, 0));
    foreach v_kind in array array['die_charge','freight_charge'] loop
      v_amount := case v_kind when 'die_charge' then v_line.die_service_charge else v_line.freight_charge end;
      if coalesce(v_amount, 0) > 0 and not exists (
        select 1 from public.invoice_items other join public.invoices i on i.id = other.invoice_id and i.company_id = other.company_id
        where other.company_id = p_company_id and other.order_item_id = v_line.id and other.line_kind = v_kind
          and i.status <> 'cancelled' and i.deleted_at is null) then
        insert into public.invoice_items (company_id, invoice_id, order_item_id, line_kind, line_total)
        values (p_company_id, p_invoice_id, v_line.id, v_kind, v_amount);
      end if;
    end loop;
  end loop;
end;
$fn$;
revoke all on function private.add_invoice_charge_lines(uuid, uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION private.save_invoice_atomic(p_invoice_id uuid, p_invoice jsonb, p_items jsonb, p_replace_items boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_requested_customer_id uuid := nullif(p_invoice->>'customer_id','')::uuid;
  v_order_id uuid := nullif(p_invoice->>'order_id','')::uuid;
  v_dispatch_id uuid := nullif(p_invoice->>'dispatch_id','')::uuid;
  v_order public.orders%rowtype;
  v_dispatch public.dispatches%rowtype;
  v_existing public.invoices%rowtype;
  v_invoice_id uuid;
  v_payload jsonb;
  v_item jsonb;
  v_requested_status text := coalesce(nullif(p_invoice->>'status',''),'draft');
  v_invoice_prefix text := 'INV';
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if v_role is null or v_role not in ('owner','admin','accounts') then raise exception 'Permission denied for invoices' using errcode='42501'; end if;
  if v_order_id is null then raise exception 'Select the source order for this invoice'; end if;
  if v_dispatch_id is null then raise exception 'Select a packed dispatch. Tax invoices cannot bill an order directly.'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' then raise exception 'Invoice items must be an array'; end if;

  select * into v_order from public.orders where id=v_order_id and company_id=v_company_id for share nowait;
  if not found then raise exception 'Order not found for this company'; end if;
  if v_requested_customer_id is not null and v_requested_customer_id<>v_order.customer_id then raise exception 'Invoice customer must match the source order customer'; end if;
  if not exists(select 1 from public.customers where id=v_order.customer_id and company_id=v_company_id) then raise exception 'Order customer not found for this company'; end if;

  -- Return/damage and cancellation cannot change while this save uses the manifest.
  -- Fail fast rather than waiting on a delivery writer that may need the order.
  if not pg_try_advisory_xact_lock(hashtextextended('dispatch-invoice:'||v_company_id::text||':'||v_dispatch_id::text,0)) then
    raise exception 'Invoice manifest is being changed. Refresh and retry' using errcode='55P03';
  end if;
  select * into v_dispatch from public.dispatches where id=v_dispatch_id and company_id=v_company_id and order_id=v_order_id for update nowait;
  if not found then raise exception 'Dispatch must belong to the selected order and company'; end if;
  if v_dispatch.delivery_status in ('returned','damaged') then raise exception 'Returned or damaged dispatches cannot be invoiced; resolve the return or create a replacement dispatch first' using errcode='23514'; end if;
  if not private.invoice_dispatch_is_billable(v_company_id,v_order_id,v_dispatch_id) then
    raise exception 'Only verified shipments recorded before cancellation can be invoiced for this order' using errcode='23514';
  end if;
  if exists(select 1 from public.invoices where company_id=v_company_id and dispatch_id=v_dispatch_id and status<>'cancelled'
    and (p_invoice_id is null or id<>p_invoice_id)) then raise exception 'This dispatch already has an active invoice'; end if;

  if p_invoice_id is null then
    if v_requested_status not in ('draft','generated') then raise exception 'New invoices can only start as draft or generated'; end if;
    if not p_replace_items or jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 then raise exception 'An invoice requires at least one source line'; end if;
  else
    select * into v_existing from public.invoices where id=p_invoice_id and company_id=v_company_id for update nowait;
    if not found then raise exception 'Invoice not found for this company'; end if;
    if v_existing.status is null or v_existing.status not in ('draft','generated') or coalesce(v_existing.amount_paid,0)<>0 then raise exception 'Only unpaid draft or generated invoices can be edited'; end if;
    if v_requested_status not in ('draft','generated','sent') then raise exception 'Use the receipt workflow to change a financial invoice status'; end if;
    if not p_replace_items or jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 then raise exception 'Editing an invoice requires its source lines to be regenerated'; end if;
  end if;

  select coalesce(nullif(invoice_prefix,''),'INV') into v_invoice_prefix from public.company_settings where company_id=v_company_id limit 1;
  v_invoice_prefix := coalesce(v_invoice_prefix,'INV');
  v_payload := private.keep_jsonb_keys(p_invoice,array['invoice_number','invoice_date','due_date','status','notes','place_of_supply_state_code'])
    ||jsonb_build_object('company_id',v_company_id,'customer_id',v_order.customer_id,'order_id',v_order_id,'dispatch_id',v_dispatch_id,
      'subtotal',0,'tax_total',0,'grand_total',0,'amount_paid',0,'paid_date',null,'status',v_requested_status);
  if p_invoice_id is null then
    if nullif(v_payload->>'invoice_number','') is null then
      v_payload := v_payload||jsonb_build_object('invoice_number',private.next_business_number_locked('public.invoices'::regclass,'invoice_number',v_company_id,
        v_invoice_prefix,coalesce(nullif(v_payload->>'invoice_date','')::date,current_date)));
    end if;
    v_invoice_id := private.insert_jsonb_row('public.invoices'::regclass,v_payload||jsonb_build_object('created_by',auth.uid()));
  else
    v_invoice_id := private.update_jsonb_row('public.invoices'::regclass,p_invoice_id,v_company_id,(v_payload-'invoice_number')||jsonb_build_object('updated_at',now()));
  end if;
  delete from public.invoice_items where invoice_id=v_invoice_id and company_id=v_company_id;
  for v_item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    perform private.insert_jsonb_row('public.invoice_items'::regclass,
      (v_item-array['id','company_id','invoice_id','created_at','updated_at'])||jsonb_build_object('company_id',v_company_id,'invoice_id',v_invoice_id,'created_at',now(),'updated_at',now()));
  end loop;
  -- EXOS-AUD-026: one-off die and freight charges are billed once per order line, on its first active invoice.
  perform private.add_invoice_charge_lines(v_invoice_id,v_company_id);
  perform private.recalculate_invoice_totals(v_invoice_id,v_company_id);
  insert into public.audit_logs(company_id,actor_id,action,entity_type,entity_id,metadata_json)
  values(v_company_id,auth.uid(),case when p_invoice_id is null then 'invoice_created' else 'invoice_updated' end,'invoice',v_invoice_id,
    jsonb_build_object('order_id',v_order_id,'dispatch_id',v_dispatch_id,'customer_id',v_order.customer_id,'status',v_requested_status,
      'retained_after_cancellation',v_order.current_stage='cancelled'));
  return v_invoice_id;
exception when lock_not_available then
  raise exception 'Invoice source is being changed. Refresh and retry' using errcode='55P03';
end;
$function$;

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
  v_one_off numeric;
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
  -- Die and freight are billed once as separate invoice lines (EXOS-AUD-026), so the goods rate
  -- excludes them; charges_billed_separately tells the invoice to add those lines.
  v_one_off := v_die_amortization + greatest(coalesce(new.transport_charge, 0), 0);
  new.charges_billed_separately := v_total_weight > 0 and v_one_off > 0 and v_line_total - v_one_off > 0;
  new.net_rate := case
    when new.charges_billed_separately then round((v_line_total - v_one_off) / v_total_weight, 2)
    when v_total_weight > 0 then round(v_line_total / v_total_weight, 2)
    else new.price_per_kg end;
  new.final_line_value := v_line_total;
  new.internal_cost := v_line_subtotal;
  return new;
end;
$function$;

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
        select sum(ii.quantity) filter (where ii.line_kind = 'goods') kg, sum(ii.line_total) value
        from public.invoice_items ii
        join public.invoices i on i.id = ii.invoice_id and i.company_id = ii.company_id
        where ii.order_item_id = oi.id and ii.company_id = oi.company_id
          and i.deleted_at is null and i.status not in ('draft','cancelled')
      ) inv on true
      where oi.order_id = p_order_id and oi.company_id = v_company_id
    ) r), '[]'::jsonb);
end;
$fn$;

commit;

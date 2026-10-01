create or replace function private.require_complete_quote_costing()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if new.status in ('approved_for_sending','sent','customer_approved','converted_to_order') and exists (
    select 1 from public.quote_items where company_id = new.company_id and quote_id = new.id
      and finishing_charge_type = 'per_sqft' and (not costing_complete or coalesce(surface_area_sqft, 0) <= 0)
  ) then
    raise exception 'Per sqft finishing requires a profile perimeter and a recalculated quote before approval or sending';
  end if;
  return new;
end;
$$;
revoke all on function private.require_complete_quote_costing() from public, anon, authenticated;
create trigger zz_require_complete_quote_costing before insert or update on public.quotes
for each row execute function private.require_complete_quote_costing();

create or replace function private.refresh_direct_order_value()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if tg_op in ('UPDATE','DELETE') then
    update public.orders set order_value = 0 where id = old.order_id and company_id = old.company_id and quote_id is null;
  end if;
  if tg_op in ('INSERT','UPDATE') then
    update public.orders set order_value = 0 where id = new.order_id and company_id = new.company_id and quote_id is null;
  end if;
  return null;
end;
$$;
revoke all on function private.refresh_direct_order_value() from public, anon, authenticated;
create trigger refresh_direct_order_value after insert or update or delete on public.order_items
for each row execute function private.refresh_direct_order_value();

-- Domestic GST only: supply state is explicitly captured, never inferred from
-- a customer's billing GSTIN (bill-to and ship-to can differ).
create or replace function private.canonicalize_invoice_supply()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if tg_op = 'INSERT' or (old.status in ('draft','generated') and old.amount_paid = 0
    and (new.place_of_supply_state_code is distinct from old.place_of_supply_state_code
      or new.supplier_state_code is distinct from old.supplier_state_code
      or (old.supplier_state_code is null and new.place_of_supply_state_code is not null))) then
    select coalesce(nullif(gst_state_code, ''), substring(gst_number from '^([0-9]{2})'))
    into new.supplier_state_code from public.companies where id = new.company_id;
    if new.supplier_state_code is null or new.supplier_state_code !~ '^(0[1-9]|[12][0-9]|3[0-8])$'
      or new.place_of_supply_state_code is null or new.place_of_supply_state_code !~ '^(0[1-9]|[12][0-9]|3[0-8])$'
      or new.supplier_state_code in ('25','28') or new.place_of_supply_state_code in ('25','28') then
      raise exception 'Set the company GST state code and enter the domestic place-of-supply state code';
    end if;
  elsif new.supplier_state_code is distinct from old.supplier_state_code or new.place_of_supply_state_code is distinct from old.place_of_supply_state_code then
    raise exception 'Issued invoice supply states are immutable';
  end if;
  new.cgst_amount := 0; new.sgst_amount := 0; new.utgst_amount := 0; new.igst_amount := 0;
  if new.supplier_state_code = new.place_of_supply_state_code then
    new.cgst_amount := round(new.tax_total / 2, 2);
    if new.supplier_state_code in ('04','26','31','35','38') then
      new.utgst_amount := new.tax_total - new.cgst_amount;
    else
      new.sgst_amount := new.tax_total - new.cgst_amount;
    end if;
  elsif new.supplier_state_code is not null and new.place_of_supply_state_code is not null then
    new.igst_amount := new.tax_total;
  end if;
  return new;
end;
$$;
revoke all on function private.canonicalize_invoice_supply() from public, anon, authenticated;
create trigger zzz_canonicalize_invoice_supply before insert or update on public.invoices
for each row execute function private.canonicalize_invoice_supply();

create or replace function private.canonicalize_invoice_tax_line()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  select coalesce(nullif(oi.hsn_code, ''), nullif(qi.hsn_code, ''), nullif(p.hsn_code, '')),
         coalesce(pl.gst_percent, oi.gst_percent, qi.gst_percent, q.gst_percent)
  into new.hsn_code, new.gst_percent
  from public.packing_list_items pl
  left join public.order_items oi on oi.id = pl.order_item_id and oi.company_id = pl.company_id
  left join public.quote_items qi on qi.id = pl.quote_item_id and qi.company_id = pl.company_id
  left join public.quotes q on q.id = qi.quote_id and q.company_id = qi.company_id
  left join public.aluminium_profiles p on p.id = pl.profile_id and p.company_id = pl.company_id
  where pl.id = new.source_line_id and pl.company_id = new.company_id;
  if new.hsn_code is null or new.hsn_code !~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$' then
    raise exception 'Set a valid HSN code on every invoiced profile';
  end if;
  if new.gst_percent is null or new.gst_percent < 0 or new.gst_percent > 100 then
    raise exception 'Every invoiced source line requires a valid GST rate';
  end if;
  return new;
end;
$$;
revoke all on function private.canonicalize_invoice_tax_line() from public, anon, authenticated;
create trigger zzz_canonicalize_invoice_tax_line before insert or update on public.invoice_items
for each row execute function private.canonicalize_invoice_tax_line();

create or replace function private.recalculate_invoice_totals(p_invoice_id uuid, p_company_id uuid)
returns void language plpgsql security definer set search_path = public, private as $$
declare v_subtotal numeric(14,2); v_tax_total numeric(14,2);
begin
  perform 1 from public.invoices where id = p_invoice_id and company_id = p_company_id for update;
  if not found then raise exception 'Invoice not found for this company'; end if;
  select round(coalesce(sum(line_total), 0), 2), coalesce(sum(round(line_total * gst_percent / 100, 2)), 0)
  into v_subtotal, v_tax_total from public.invoice_items where invoice_id = p_invoice_id and company_id = p_company_id;
  if v_subtotal <= 0 then raise exception 'The selected source has no billable quantity and rate'; end if;
  update public.invoices set subtotal = v_subtotal, tax_total = v_tax_total,
    grand_total = v_subtotal + v_tax_total, updated_at = now()
  where id = p_invoice_id and company_id = p_company_id;
end;
$$;
revoke all on function private.recalculate_invoice_totals(uuid, uuid) from public, anon, authenticated;

-- Repair the status defect only; do not reprice or rewrite historical invoices.
update public.invoices set status = 'paid'
where status not in ('cancelled','credited','paid') and grand_total > 0
  and amount_paid + credited_amount >= grand_total and credited_amount < grand_total;

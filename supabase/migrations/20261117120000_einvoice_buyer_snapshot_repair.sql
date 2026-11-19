-- Capture buyer locality for new invoices. Historical snapshots remain immutable;
-- accounts can separately confirm missing export fields from the original issued document.
begin;

create or replace function private.snapshot_invoice_parties()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if tg_op = 'INSERT' then
    select jsonb_build_object('name', name, 'legal_name', legal_name, 'gst_number', gst_number, 'billing_address', billing_address,
      'city', city, 'state', state, 'pincode', pincode, 'phone', phone, 'email', email)
      into new.supplier_snapshot from public.companies where id = new.company_id;
    select jsonb_build_object('customer_name', customer_name, 'company_name', company_name, 'gst_number', gst_number,
      'billing_address', billing_address, 'shipping_address', shipping_address, 'city', city, 'pincode', pincode)
      into new.customer_snapshot from public.customers where id = new.customer_id and company_id = new.company_id;
    if new.supplier_snapshot is null or new.customer_snapshot is null then raise exception 'Invoice parties must belong to the authenticated company'; end if;
  elsif old.supplier_snapshot is distinct from new.supplier_snapshot or old.customer_snapshot is distinct from new.customer_snapshot
      or old.company_id is distinct from new.company_id or old.customer_id is distinct from new.customer_id then
    raise exception 'Invoice party snapshots and identities are immutable';
  end if;
  return new;
end;
$$;
revoke all on function private.snapshot_invoice_parties() from public, anon, authenticated;
comment on function private.snapshot_invoice_parties() is
  'Freezes supplier contact details and buyer city/PIN on new invoices only. Existing snapshots are not backfilled; snapshots and party identities remain immutable.';

create table public.einvoice_buyer_address_confirmations (
  invoice_id uuid primary key references public.invoices(id),
  company_id uuid not null references public.companies(id),
  city text not null check (length(btrim(city)) between 3 and 100),
  pincode text not null check (pincode ~ '^[1-9][0-9]{5}$'),
  reason text not null check (length(btrim(reason)) between 10 and 500),
  confirmed_by uuid not null references public.app_users(id),
  confirmed_at timestamptz not null default clock_timestamp()
);
create index einvoice_buyer_address_company_idx on public.einvoice_buyer_address_confirmations(company_id, invoice_id);
create index einvoice_buyer_address_actor_idx on public.einvoice_buyer_address_confirmations(confirmed_by);
alter table public.einvoice_buyer_address_confirmations enable row level security;
revoke all on public.einvoice_buyer_address_confirmations from public, anon, authenticated;
grant select on public.einvoice_buyer_address_confirmations to authenticated;
create policy einvoice_buyer_address_read on public.einvoice_buyer_address_confirmations for select to authenticated
  using (company_id = (select public.get_current_user_company_id()) and (select public.get_current_user_role()) = any(array['owner', 'admin', 'accounts']));

-- Keep the original gateway private so all existing commands retain their checks.
alter function public.ap_einvoice(text, jsonb) rename to ap6_einvoice_without_buyer_address;
alter function public.ap6_einvoice_without_buyer_address(text, jsonb) set schema private;
revoke all on function private.ap6_einvoice_without_buyer_address(text, jsonb) from public, anon, authenticated;

create function public.ap_einvoice(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  c record; v_invoice public.invoices%rowtype; v_confirmation public.einvoice_buyer_address_confirmations%rowtype;
  v_city text; v_pin text; v_reason text; v_result jsonb; v_rows jsonb;
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'accounts']);
  if p_command = 'confirm_buyer_address' then
    perform private.ap_keys(p_payload, array['invoice_id', 'city', 'pincode', 'reason']);
    select * into v_invoice from public.invoices where id = private.ap_uuid(p_payload, 'invoice_id') and company_id = c.company_id
      and deleted_at is null and status not in ('draft', 'cancelled') and issued_at is not null for update;
    if v_invoice.id is null then raise exception 'AP: Choose an issued invoice from this company.'; end if;
    v_city := private.ap_text(p_payload ->> 'city', 'Buyer city', 3, 100);
    v_pin := btrim(coalesce(p_payload ->> 'pincode', ''));
    v_reason := private.ap_text(p_payload ->> 'reason', 'Issued invoice reference', 10, 500);
    if v_pin !~ '^[1-9][0-9]{5}$' then raise exception 'AP: Enter a six-digit buyer PIN.'; end if;
    if (nullif(btrim(v_invoice.customer_snapshot ->> 'city'), '') is not null and btrim(v_invoice.customer_snapshot ->> 'city') <> v_city)
        or (nullif(btrim(v_invoice.customer_snapshot ->> 'pincode'), '') is not null
          and regexp_replace(v_invoice.customer_snapshot ->> 'pincode', '[[:space:]]', '', 'g') <> v_pin) then
      raise exception 'AP: A confirmation cannot replace fields already frozen on the invoice.';
    end if;
    select * into v_confirmation from public.einvoice_buyer_address_confirmations where invoice_id = v_invoice.id and company_id = c.company_id;
    if v_confirmation.invoice_id is not null then
      if v_confirmation.city <> v_city or v_confirmation.pincode <> v_pin or v_confirmation.reason <> v_reason then raise exception 'AP: This invoice already has an immutable buyer address confirmation.'; end if;
      return jsonb_build_object('saved', true, 'repeated', true);
    end if;
    if nullif(btrim(v_invoice.customer_snapshot ->> 'city'), '') is not null and nullif(btrim(v_invoice.customer_snapshot ->> 'pincode'), '') is not null then
      raise exception 'AP: The invoice already captures buyer city and PIN.';
    end if;
    if exists (select 1 from public.einvoice_export_items where invoice_id = v_invoice.id and company_id = c.company_id)
        or exists (select 1 from public.invoice_irns where invoice_id = v_invoice.id and company_id = c.company_id) then
      raise exception 'AP: This invoice was already exported or has an IRN; review its original submission with accounts.';
    end if;
    insert into public.einvoice_buyer_address_confirmations(invoice_id, company_id, city, pincode, reason, confirmed_by)
      values (v_invoice.id, c.company_id, v_city, v_pin, v_reason, c.actor_id);
    return jsonb_build_object('saved', true, 'repeated', false);
  end if;

  v_result := private.ap6_einvoice_without_buyer_address(p_command, p_payload);
  if p_command = 'sources' then
    select coalesce(jsonb_agg(e.value || jsonb_build_object('customer', coalesce(nullif(e.value -> 'customer', 'null'::jsonb), '{}'::jsonb)
      || jsonb_strip_nulls(jsonb_build_object(
        'city', case when nullif(btrim(e.value #>> '{customer,city}'), '') is null then a.city end,
        'pincode', case when nullif(btrim(e.value #>> '{customer,pincode}'), '') is null then a.pincode end))) order by e.ord), '[]'::jsonb)
      into v_rows from jsonb_array_elements(v_result -> 'invoices') with ordinality e(value, ord)
      left join public.einvoice_buyer_address_confirmations a on a.invoice_id = (e.value ->> 'invoice_id')::uuid and a.company_id = c.company_id;
    return jsonb_set(v_result, '{invoices}', v_rows);
  elsif p_command = 'queue' then
    select coalesce(jsonb_agg(e.value || jsonb_build_object(
        'buyer_city', coalesce(nullif(btrim(i.customer_snapshot ->> 'city'), ''), a.city),
        'buyer_pincode', coalesce(nullif(regexp_replace(i.customer_snapshot ->> 'pincode', '[[:space:]]', '', 'g'), ''), a.pincode),
        'buyer_address_confirmed', a.invoice_id is not null) order by e.ord), '[]'::jsonb)
      into v_rows from jsonb_array_elements(v_result -> 'rows') with ordinality e(value, ord)
      join public.invoices i on i.id = (e.value ->> 'id')::uuid and i.company_id = c.company_id
      left join public.einvoice_buyer_address_confirmations a on a.invoice_id = i.id and a.company_id = c.company_id;
    return jsonb_set(v_result, '{rows}', v_rows);
  end if;
  return v_result;
end;
$$;
revoke all on function public.ap_einvoice(text, jsonb) from public, anon;
grant execute on function public.ap_einvoice(text, jsonb) to authenticated;

commit;

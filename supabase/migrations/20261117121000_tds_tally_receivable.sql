-- Classify both existing and future TDS receipts by their deduction register,
-- never by payment_method='other' or free-text references.
begin;

create index if not exists tds_deductions_receipt_idx on public.tds_deductions(company_id, receipt_event_id);
alter table public.tally_ledger_map drop constraint tally_ledger_map_kind_check;
alter table public.tally_ledger_map add constraint tally_ledger_map_kind_check check (kind in (
  'customer', 'vendor', 'sales', 'purchase', 'output_cgst', 'output_sgst', 'output_igst', 'input_cgst', 'input_sgst', 'input_igst',
  'round_off', 'bank', 'cash', 'tds_receivable', 'freight_inward', 'discount_received'));

alter function private.ap4_tally_vouchers(uuid, date, date) rename to ap6_tally_vouchers_without_tds;
create function private.ap4_tally_vouchers(p_company uuid, p_from date, p_to date)
returns table(kind text, id uuid, number text, voucher_date date, amount numeric, party_id uuid, party_name text, data jsonb)
language sql stable security definer set search_path = public, private as $$
  select v.kind, v.id, v.number, v.voucher_date, v.amount, v.party_id, v.party_name,
    v.data || case when v.kind = 'receipt' then jsonb_build_object('settlement_kind',
      case when exists (select 1 from public.tds_deductions d where d.company_id = p_company and d.receipt_event_id = v.id)
        then 'tds' else 'payment' end) else '{}'::jsonb end
  from private.ap6_tally_vouchers_without_tds(p_company, p_from, p_to) v
$$;
revoke all on function private.ap6_tally_vouchers_without_tds(uuid, date, date), private.ap4_tally_vouchers(uuid, date, date) from public, anon, authenticated;

alter function public.ap_tally(text, jsonb) rename to ap6_tally_without_tds_mapping;
alter function public.ap6_tally_without_tds_mapping(text, jsonb) set schema private;
revoke all on function private.ap6_tally_without_tds_mapping(text, jsonb) from public, anon, authenticated;
create function public.ap_tally(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_id uuid; v_name text;
begin
  if p_command = 'save_mapping' and p_payload ->> 'kind' = 'tds_receivable' then
    select * into c from private.ap_ctx(private.ap3_accounts_roles());
    perform private.ap_keys(p_payload, array['kind', 'ledger_name']);
    v_name := private.ap_text(p_payload ->> 'ledger_name', 'Ledger name', 1, 100);
    if v_name ~ '[[:cntrl:]<>&]' then raise exception 'AP: Ledger names cannot contain control characters, < > or &.'; end if;
    insert into public.tally_ledger_map(company_id, kind, ledger_name, updated_by)
      values (c.company_id, 'tds_receivable', v_name, c.actor_id)
      on conflict (company_id, kind, coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(gst_rate, -1), coalesce(supply, ''))
      do update set ledger_name = excluded.ledger_name, updated_by = excluded.updated_by, updated_at = clock_timestamp()
      returning id into v_id;
    return jsonb_build_object('id', v_id);
  end if;
  return private.ap6_tally_without_tds_mapping(p_command, p_payload);
end;
$$;
revoke all on function public.ap_tally(text, jsonb) from public, anon;
grant execute on function public.ap_tally(text, jsonb) to authenticated;

commit;

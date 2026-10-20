-- Bind an issued credit's retry key to its dispatch and normalized reason.
begin;

create or replace function private.issue_dispatch_return_credit_note_atomic(
  p_dispatch_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_dispatch public.dispatches%rowtype;
  v_invoice public.invoices%rowtype;
  v_credit_id uuid;
  v_existing public.credit_notes%rowtype;
  v_items jsonb;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if v_role is null or v_role not in ('owner','admin','accounts') then
    raise exception 'Permission denied for credit notes' using errcode = '42501';
  end if;
  if p_idempotency_key is null then raise exception 'Credit note idempotency key is required'; end if;
  if length(trim(coalesce(p_reason, ''))) < 8 then raise exception 'Enter a clear return or damage reason'; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_company_id::text || ':dispatch-credit-note:' || p_idempotency_key::text, 0
  ));
  select * into v_existing from public.credit_notes
  where company_id = v_company_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.dispatch_id is distinct from p_dispatch_id
      or trim(v_existing.reason) is distinct from trim(p_reason) then
      raise exception 'This retry key is already used for different credit note details. Refresh the dispatch and review its existing note before starting a correction.';
    end if;
    return v_existing.id;
  end if;

  select * into v_dispatch from public.dispatches
  where id = p_dispatch_id and company_id = v_company_id for update;
  if not found then raise exception 'Dispatch not found for this company'; end if;
  if v_dispatch.delivery_status not in ('returned','damaged') then
    raise exception 'A credit note can only be issued for a returned or damaged dispatch';
  end if;

  select * into v_invoice from public.invoices
  where company_id = v_company_id and dispatch_id = p_dispatch_id and status <> 'cancelled'
  for update;
  if not found then raise exception 'No issued invoice is linked to this dispatch'; end if;
  if v_invoice.status = 'draft' then raise exception 'Cancel the draft invoice instead of issuing a credit note'; end if;
  if exists (select 1 from public.credit_notes where company_id = v_company_id and dispatch_id = p_dispatch_id and status = 'issued') then
    raise exception 'An issued credit note already exists for this dispatch';
  end if;

  select coalesce(jsonb_agg(to_jsonb(item) - array['company_id','invoice_id']), '[]'::jsonb)
  into v_items
  from public.invoice_items item
  where item.company_id = v_company_id and item.invoice_id = v_invoice.id;

  insert into public.credit_notes(
    company_id, invoice_id, dispatch_id, credit_note_number, credit_date,
    reason, subtotal, tax_total, grand_total, item_snapshot,
    idempotency_key, created_by
  ) values (
    v_company_id, v_invoice.id, p_dispatch_id,
    private.next_business_number_locked(
      'public.credit_notes'::regclass, 'credit_note_number', v_company_id, 'CN',
      (now() at time zone 'Asia/Kolkata')::date
    ),
    (now() at time zone 'Asia/Kolkata')::date,
    trim(p_reason), v_invoice.subtotal, v_invoice.tax_total, v_invoice.grand_total,
    v_items, p_idempotency_key, auth.uid()
  ) returning id into v_credit_id;

  update public.invoices
  set credited_amount = (
        select coalesce(sum(note.grand_total), 0)
        from public.credit_notes note
        where note.company_id = v_company_id and note.invoice_id = v_invoice.id and note.status = 'issued'
      ),
      updated_at = now()
  where id = v_invoice.id and company_id = v_company_id;
  perform private.recalculate_invoice_collection_state(v_invoice.id, v_company_id);

  insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
  values (v_company_id, auth.uid(), 'dispatch_credit_note_issued', 'credit_note', v_credit_id,
    jsonb_build_object('invoice_id', v_invoice.id, 'dispatch_id', p_dispatch_id, 'amount', v_invoice.grand_total, 'reason', trim(p_reason)));
  return v_credit_id;
end;
$$;

revoke all on function private.issue_dispatch_return_credit_note_atomic(uuid,text,uuid) from public, anon, authenticated;

commit;

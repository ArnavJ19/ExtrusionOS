begin;
create function public.invoice_communication_preview(p_invoice_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,private as $$
declare v_company uuid;v_invoice public.invoices%rowtype;v_result jsonb;
begin
  v_company:=private.commercial_actor(array['owner','admin','accounts']);
  select * into v_invoice from public.invoices where company_id=v_company and id=p_invoice_id and deleted_at is null;
  if not found then raise exception 'Invoice is unavailable'; end if;
  if v_invoice.status in ('draft','cancelled') or v_invoice.customer_snapshot is null or v_invoice.supplier_snapshot is null then raise exception 'Use an issued invoice with recorded party snapshots'; end if;
  v_result:=jsonb_build_object('invoice_id',v_invoice.id,'invoice_number',v_invoice.invoice_number,'invoice_date',v_invoice.invoice_date,
    'customer_name',coalesce(nullif(v_invoice.customer_snapshot->>'company_name',''),v_invoice.customer_snapshot->>'customer_name'),
    'recipient_phone',coalesce(nullif(v_invoice.customer_snapshot->>'contact_phone',''),v_invoice.customer_snapshot->>'phone'),
    'supplier_name',coalesce(nullif(v_invoice.supplier_snapshot->>'name',''),v_invoice.supplier_snapshot->>'company_name'),
    'grand_total',v_invoice.grand_total,'document_path','/api/pdf/invoice/'||v_invoice.id::text,
    'status',v_invoice.status,'delivery_state','prepared_only');
  return v_result||jsonb_build_object('fingerprint',md5(v_result::text));
end;
$$;
revoke all on function public.invoice_communication_preview(uuid) from public,anon;
grant execute on function public.invoice_communication_preview(uuid) to authenticated;
commit;

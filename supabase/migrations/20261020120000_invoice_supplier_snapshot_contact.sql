-- Candidate migration: add the supplier's city, state, PIN, phone and e-mail to
-- the party snapshot frozen on each invoice, so issued tax invoices and credit
-- notes can print the full supplier address and contact line.
--
-- Supersedes private.snapshot_invoice_parties() from
-- 20260930000000_astra_audit_fixes.sql. Every existing key, the company-scoped
-- party lookups, the ownership check and the immutability rule are unchanged.
--
-- Applies to NEW invoices only. Existing invoice snapshots are not backfilled
-- or altered: issued snapshots stay immutable, and the trigger still rejects
-- any change to them.

create or replace function private.snapshot_invoice_parties()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if tg_op='INSERT' then
    select jsonb_build_object('name',name,'legal_name',legal_name,'gst_number',gst_number,'billing_address',billing_address,
      'city',city,'state',state,'pincode',pincode,'phone',phone,'email',email) into new.supplier_snapshot from public.companies where id=new.company_id;
    select jsonb_build_object('customer_name',customer_name,'company_name',company_name,'gst_number',gst_number,'billing_address',billing_address,'shipping_address',shipping_address) into new.customer_snapshot from public.customers where id=new.customer_id and company_id=new.company_id;
    if new.supplier_snapshot is null or new.customer_snapshot is null then raise exception 'Invoice parties must belong to the authenticated company'; end if;
  elsif old.supplier_snapshot is distinct from new.supplier_snapshot or old.customer_snapshot is distinct from new.customer_snapshot or old.company_id is distinct from new.company_id or old.customer_id is distinct from new.customer_id then
    raise exception 'Invoice party snapshots and identities are immutable';
  end if;
  return new;
end;
$$;
revoke all on function private.snapshot_invoice_parties() from public, anon, authenticated;

comment on function private.snapshot_invoice_parties() is
  'Freezes supplier (name, legal_name, gst_number, billing_address, city, state, pincode, phone, email) and customer party snapshots on invoice insert; snapshots and party identities are immutable afterwards. Supplier contact keys apply to invoices created after 20261020120000 only; earlier snapshots are not backfilled.';

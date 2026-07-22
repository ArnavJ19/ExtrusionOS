-- Quotations are a commercial workflow, not a freely editable status field.
-- Keep browser clients and older integrations on the same legal transition graph.
create schema if not exists private;

create or replace function private.enforce_quote_status_transition()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_allowed boolean := false;
  v_role text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('order-quote:' || new.id::text, 0));

  v_allowed := case old.status
    when 'draft' then new.status = 'internal_review'
    when 'internal_review' then new.status in ('draft', 'approved_for_sending')
    when 'approved_for_sending' then new.status in ('draft', 'sent')
    when 'sent' then new.status in ('draft', 'customer_approved', 'customer_rejected', 'expired')
    when 'customer_approved' then new.status in ('draft', 'converted_to_order')
    when 'customer_rejected' then new.status = 'draft'
    when 'expired' then new.status = 'draft'
    else false
  end;

  if not v_allowed then
    raise exception 'Quote cannot move from % to %', old.status, new.status;
  end if;

  if coalesce(new.low_margin_approval_required, false)
    and new.status in ('approved_for_sending', 'sent', 'customer_approved')
  then
    v_role := public.get_current_user_role();
    if coalesce(v_role, '') not in ('owner', 'admin', 'sales_manager') then
      raise exception 'This low-margin quote needs owner/admin approval';
    end if;
  end if;

  if old.status = 'customer_approved'
     and new.status = 'draft'
     and exists (
       select 1 from public.orders linked_order
       where linked_order.company_id = new.company_id
         and linked_order.quote_id = new.id
     ) then
    raise exception 'A quote linked to an order cannot return to draft';
  end if;

  if new.status = 'converted_to_order' and not exists (
    select 1
    from public.orders linked_order
    where linked_order.company_id = new.company_id
      and linked_order.quote_id = new.id
  ) then
    raise exception 'A customer-approved quote must be linked to an order before conversion';
  end if;

  if new.status = 'draft' then
    new.approved_by := null;
    new.approved_at := null;
    new.sent_at := null;
    new.customer_decision_at := null;
  elsif new.status = 'approved_for_sending' then
    new.approved_by := coalesce(new.approved_by, auth.uid());
    new.approved_at := coalesce(new.approved_at, now());
  elsif new.status = 'sent' then
    new.sent_at := coalesce(new.sent_at, now());
  elsif new.status in ('customer_approved', 'customer_rejected') then
    new.customer_decision_at := coalesce(new.customer_decision_at, now());
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_quote_status_transition() from public;

drop trigger if exists enforce_quote_status_transition on public.quotes;
create trigger enforce_quote_status_transition
before update of status on public.quotes
for each row execute function private.enforce_quote_status_transition();

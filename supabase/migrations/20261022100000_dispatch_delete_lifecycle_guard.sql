-- EXOS-AUD2-001: an owner/admin could hard-delete a delivered dispatch that was not
-- yet invoiced. The delete cascaded its packing rows and status history, the order
-- stayed "delivered", and the same packed output could be dispatched again.
--
-- A dispatch may be deleted only while it has never left the plant: status
-- 'pending', no actual dispatch time, and no invoice history (active or cancelled).
-- Everything else is corrected through returns, document amendments or cancellation.
-- Callers without a user session (service maintenance, tenant offboarding cascades)
-- are not restricted, matching the existing auth.uid() bypass in the order guards.
begin;
set local lock_timeout = '5s';

create or replace function private.guard_dispatch_delete()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if auth.uid() is null then
    return old;
  end if;
  if old.delivery_status is distinct from 'pending' or old.actual_dispatched_at is not null then
    raise exception 'Dispatch % has left the plant (status %) and cannot be deleted; record a return or a document amendment instead',
      coalesce(old.dispatch_number, old.id::text), coalesce(old.delivery_status, 'unknown')
      using errcode = '23514';
  end if;
  if exists (select 1 from public.invoices i where i.company_id = old.company_id and i.dispatch_id = old.id) then
    raise exception 'Dispatch % has invoice history and cannot be deleted', coalesce(old.dispatch_number, old.id::text)
      using errcode = '23514';
  end if;
  return old;
end;
$$;

revoke all on function private.guard_dispatch_delete() from public, anon, authenticated;

drop trigger if exists a_guard_dispatch_delete on public.dispatches;
create trigger a_guard_dispatch_delete
before delete on public.dispatches
for each row execute function private.guard_dispatch_delete();

commit;

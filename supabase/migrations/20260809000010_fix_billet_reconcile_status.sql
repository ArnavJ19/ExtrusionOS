-- Correction to 20260809000003 (found via UAT): auto-generated foundry billets are created
-- with status 'planned', which the reconcile delete's ('cast','cancelled','scrap') list did
-- not cover, so surplus billets were never removed when billet_count was reduced. Delete any
-- surplus billet that is NOT committed downstream instead (planned/cast/scrap/cancelled), and
-- keep blocking a reduction that would orphan an allocated/issued/consumed billet.

create or replace function public.reconcile_foundry_billet_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.foundry_billets
    where foundry_batch_id = new.id and company_id = new.company_id
      and billet_number > new.billet_count
      and status in ('allocated', 'issued', 'consumed')
  ) then
    raise exception 'Cannot reduce billet count: billets beyond the new count are already allocated, issued, or consumed';
  end if;
  delete from public.foundry_billets
  where foundry_batch_id = new.id and company_id = new.company_id
    and billet_number > new.billet_count
    and status not in ('allocated', 'issued', 'consumed');
  return new;
end;
$$;

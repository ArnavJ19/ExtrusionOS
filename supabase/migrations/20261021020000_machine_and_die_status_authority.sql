-- EXOS-AUD-008: press and die readiness is the only production lockout, but any
-- company user could write machines and sales roles could return a retired die
-- to service.
--
-- Machines: insert/update is limited to owner, admin, factory_manager and
-- production_manager; status is limited to the values the app and the
-- production start gate understand (CHECK added NOT VALID).
-- Dies: a status change needs production authority. Operators (production) may
-- take a die out of service; only owner, admin, factory_manager and
-- production_manager may make a die usable (active/approved). Sales roles keep
-- commercial die edits and may register dies in a non-usable status. The rule is
-- a trigger, so it covers both the table and update_versioned_entity_atomic.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop policy if exists "machines tenant insert" on public.machines;
drop policy if exists "machines tenant update" on public.machines;

create policy "machines authority insert" on public.machines
  for insert with check (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner','admin','factory_manager','production_manager')
  );
create policy "machines authority update" on public.machines
  for update using (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner','admin','factory_manager','production_manager')
  ) with check (company_id = public.get_current_user_company_id());

alter table public.machines
  add constraint machines_status_check
  check (status in ('active','operational','idle','maintenance','breakdown','inactive')) not valid;

create or replace function private.guard_die_status_authority()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_role text := private.get_current_user_role();
  v_managers text[] := array['owner','admin','factory_manager','production_manager'];
  v_becomes_usable boolean;
begin
  if auth.uid() is null then return new; end if;

  v_becomes_usable := new.die_status in ('active','approved')
    and (tg_op = 'INSERT' or old.die_status not in ('active','approved'));

  if v_becomes_usable and not (coalesce(v_role, '') = any(v_managers)) then
    raise exception 'Only owner, admin, factory or production managers may make a die usable for production'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.die_status is distinct from old.die_status
    and not (coalesce(v_role, '') = any(v_managers || array['production'])) then
    raise exception 'Die status changes require production authority' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_die_status_authority() from public, anon, authenticated;

drop trigger if exists a_guard_die_status_authority on public.dies;
create trigger a_guard_die_status_authority
  before insert or update of die_status on public.dies
  for each row execute function private.guard_die_status_authority();

commit;

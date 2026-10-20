-- EXOS-AUD-019: any company user could insert audit_logs / audit_logs_enterprise
-- rows naming another user (e.g. "payment_recorded" by the owner).
--
-- Direct PostgREST inserts (current_user = 'authenticated') now have their actor
-- identity taken from the session: audit_logs.actor_id, and on
-- audit_logs_enterprise the actor user, name, role, company and dealer. Server
-- writers running as the function owner or service role (record_enterprise_audit,
-- the *_atomic RPCs, admin routes) are unchanged. The existing app helper already
-- sends the session user, so its rows are unaffected.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Invoker on purpose: current_user identifies a direct client insert.
create or replace function private.stamp_audit_actor()
returns trigger
language plpgsql
set search_path = public, private
as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  if auth.uid() is null then
    raise exception 'Audit entries require an authenticated user' using errcode = '42501';
  end if;
  if tg_table_name = 'audit_logs' then
    new.actor_id := auth.uid();
  else
    new.actor_user_id := auth.uid();
    new.actor_role := private.get_current_user_role();
    new.actor_company_id := private.get_current_user_company_id();
    new.actor_dealer_id := private.get_current_user_dealer_id();
    -- Never keep a client-supplied name: it is the session user's own name or nothing.
    new.actor_name := (select coalesce(nullif(btrim(app_user.full_name), ''), app_user.email)
      from public.app_users app_user where app_user.id = auth.uid());
  end if;
  return new;
end;
$$;

revoke all on function private.stamp_audit_actor() from public, anon, authenticated;

drop trigger if exists a_stamp_audit_actor on public.audit_logs;
create trigger a_stamp_audit_actor
  before insert on public.audit_logs
  for each row execute function private.stamp_audit_actor();

drop trigger if exists a_stamp_audit_actor on public.audit_logs_enterprise;
create trigger a_stamp_audit_actor
  before insert on public.audit_logs_enterprise
  for each row execute function private.stamp_audit_actor();

commit;

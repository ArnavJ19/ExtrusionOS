-- Security audit fixes: restrict privileged user and security-log mutations.

begin;

drop policy if exists "app users update admin" on public.app_users;
create policy "app users update admin non self" on public.app_users
  for update
  using (
    company_id = public.get_current_user_company_id()
    and public.is_owner_or_admin()
    and id <> auth.uid()
  )
  with check (
    company_id = public.get_current_user_company_id()
    and id <> auth.uid()
  );

drop policy if exists "login_events_tenant_isolation" on public.login_events;
create policy "login_events_admin_read" on public.login_events
  for select
  using (company_id = public.get_current_user_company_id() and public.is_owner_or_admin());

create policy "login_events_admin_insert" on public.login_events
  for insert
  with check (company_id = public.get_current_user_company_id() and public.is_owner_or_admin());

drop policy if exists "sensitive_action_logs_tenant_isolation" on public.sensitive_action_logs;
create policy "sensitive_action_logs_admin_read" on public.sensitive_action_logs
  for select
  using (company_id = public.get_current_user_company_id() and public.is_owner_or_admin());

create policy "sensitive_action_logs_admin_insert" on public.sensitive_action_logs
  for insert
  with check (company_id = public.get_current_user_company_id() and public.is_owner_or_admin());

commit;

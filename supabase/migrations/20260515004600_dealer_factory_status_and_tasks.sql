-- Dealers can observe factory progress but cannot update manufacturing/order status.
-- Dealer tasks are scoped to the dealership and can be assigned to dealer employees.

delete from public.role_permissions
where permission_key in ('edit_orders', 'cancel_orders', 'approve_orders')
  and role_id in (select id from public.roles where role_key in ('dealer_admin', 'dealer_staff'));

insert into public.permissions (key, module_name, description) values
  ('manage_tasks', 'tasks', 'Manage tasks')
on conflict (key) do update set module_name = excluded.module_name, description = excluded.description;

insert into public.role_permissions(role_id, permission_key)
select r.id, 'manage_tasks'
from public.roles r
where r.role_key in ('dealer_admin', 'dealer_staff')
on conflict do nothing;

drop policy if exists "dealer orders tenant update" on public.dealer_orders;
create policy "dealer orders tenant update" on public.dealer_orders for update using (
  company_id = public.get_current_user_company_id()
  and public.get_current_user_dealer_id() is null
  and public.current_user_has_permission('edit_orders')
) with check (
  company_id = public.get_current_user_company_id()
  and public.get_current_user_dealer_id() is null
  and public.current_user_has_permission('edit_orders')
);

drop policy if exists "orders tenant update" on public.orders;
create policy "orders tenant update" on public.orders for update using (
  company_id = public.get_current_user_company_id()
  and public.get_current_user_dealer_id() is null
  and public.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager','production','dispatch_manager','dispatch','factory_manager')
) with check (
  company_id = public.get_current_user_company_id()
  and public.get_current_user_dealer_id() is null
);

drop policy if exists "history tenant insert" on public.order_stage_history;
create policy "history tenant insert" on public.order_stage_history for insert with check (
  company_id = public.get_current_user_company_id()
  and public.get_current_user_dealer_id() is null
  and public.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager','production','dispatch_manager','dispatch','factory_manager')
);

alter table public.tasks add column if not exists dealership_id uuid references public.dealers(id) on delete set null;
alter table public.tasks add column if not exists assigned_by_user_id uuid references auth.users(id);
create index if not exists tasks_company_dealership_status_idx on public.tasks(company_id, dealership_id, status, due_date);
create index if not exists tasks_company_assigned_to_idx on public.tasks(company_id, assigned_to, status, due_date);

drop policy if exists "Tasks viewable by authorized users" on public.tasks;
drop policy if exists "Tasks insertable by authorized users" on public.tasks;
drop policy if exists "Tasks updatable by authorized users" on public.tasks;
drop policy if exists "tasks tenant read" on public.tasks;
drop policy if exists "tasks tenant insert" on public.tasks;
drop policy if exists "tasks tenant update" on public.tasks;

create policy "tasks tenant read" on public.tasks for select using (
  company_id = public.get_current_user_company_id()
  and (
    public.get_current_user_role() in ('owner','admin')
    or (public.get_current_user_dealer_id() is null and dealership_id is null)
    or (public.get_current_user_dealer_id() is not null and dealership_id = public.get_current_user_dealer_id())
    or assigned_to = auth.uid()
    or created_by = auth.uid()
  )
);

create policy "tasks tenant insert" on public.tasks for insert with check (
  company_id = public.get_current_user_company_id()
  and (
    public.get_current_user_role() in ('owner','admin')
    or (public.get_current_user_dealer_id() is not null and dealership_id = public.get_current_user_dealer_id())
  )
);

create policy "tasks tenant update" on public.tasks for update using (
  company_id = public.get_current_user_company_id()
  and (
    public.get_current_user_role() in ('owner','admin')
    or (public.get_current_user_role() = 'dealer_admin' and dealership_id = public.get_current_user_dealer_id())
    or assigned_to = auth.uid()
  )
) with check (
  company_id = public.get_current_user_company_id()
  and (
    public.get_current_user_role() in ('owner','admin')
    or (public.get_current_user_role() = 'dealer_admin' and dealership_id = public.get_current_user_dealer_id())
    or assigned_to = auth.uid()
  )
);

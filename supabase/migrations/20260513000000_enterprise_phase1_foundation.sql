-- ExtrusionOS Enterprise Phase 1: Platform foundation
-- Safe additive migration: feature flags, subscriptions, branches, audit logs,
-- notifications, tasks/reminders, data exchange jobs, and optional branch links.

begin;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  branch_name text not null,
  branch_type text not null,
  address text,
  city text,
  state text,
  pincode text,
  phone text,
  manager_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint branches_type_check check (branch_type in ('head_office','factory','warehouse','sales_office','depot','dealer_location'))
);

create table if not exists public.feature_flags (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  module_name text not null,
  is_enabled boolean not null default false,
  config_json jsonb not null default '{}'::jsonb,
  enabled_by uuid references auth.users(id),
  enabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feature_flags_company_module_unique unique (company_id, module_name),
  constraint feature_flags_module_check check (module_name in (
    'ai_assistant','whatsapp_automation','dealer_portal','advanced_inventory',
    'production_planning','quality_compliance','export_docs','tender_management',
    'energy_monitoring','machine_maintenance','barcode_tracking','accounting_integrations',
    'mobile_floor_app','multi_plant','systems_configurator','document_intelligence',
    'die_intelligence','crm','report_builder','automation','command_center'
  ))
);

create table if not exists public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  plan_name text not null,
  plan_type text not null unique,
  monthly_price numeric(12,2) not null default 0,
  annual_price numeric(12,2) not null default 0,
  module_limits_json jsonb not null default '{}'::jsonb,
  feature_limits_json jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint subscription_plans_type_check check (plan_type in ('free_demo','starter','pro','enterprise'))
);

create table if not exists public.company_subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  plan_id uuid not null references public.subscription_plans(id) on delete restrict,
  status text not null default 'trialing',
  billing_cycle text not null default 'monthly',
  started_at timestamptz not null default now(),
  expires_at timestamptz,
  trial_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_subscriptions_status_check check (status in ('trialing','active','past_due','cancelled','expired')),
  constraint company_subscriptions_billing_cycle_check check (billing_cycle in ('monthly','annual','manual'))
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  actor_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata_json jsonb not null default '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  recipient_user_id uuid references auth.users(id),
  notification_type text not null default 'system',
  severity text not null default 'info',
  title text not null,
  body text,
  related_entity_type text,
  related_entity_id uuid,
  is_read boolean not null default false,
  read_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notifications_severity_check check (severity in ('info','success','warning','critical'))
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  task_type text not null default 'general',
  title text not null,
  description text,
  priority text not null default 'normal',
  status text not null default 'open',
  assigned_to uuid references auth.users(id),
  due_date date,
  related_entity_type text,
  related_entity_id uuid,
  created_by uuid references auth.users(id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_priority_check check (priority in ('low','normal','high','urgent')),
  constraint tasks_status_check check (status in ('open','in_progress','completed','cancelled'))
);

create table if not exists public.data_exchange_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_type text not null,
  module_name text not null,
  status text not null default 'queued',
  file_url text,
  result_json jsonb not null default '{}'::jsonb,
  error_message text,
  started_by uuid references auth.users(id),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint data_exchange_jobs_type_check check (job_type in ('import','export')),
  constraint data_exchange_jobs_status_check check (status in ('queued','running','completed','failed','cancelled'))
);

insert into public.subscription_plans (plan_name, plan_type, monthly_price, annual_price, module_limits_json, feature_limits_json, is_active)
values
  ('Free Demo', 'free_demo', 0, 0, '{"users":2,"branches":1,"quotes_per_month":25}'::jsonb, '{"ai_assistant":false,"dealer_portal":false}'::jsonb, true),
  ('Starter', 'starter', 4999, 49990, '{"users":8,"branches":1,"quotes_per_month":250}'::jsonb, '{"ai_assistant":false,"dealer_portal":false,"barcode_tracking":false}'::jsonb, true),
  ('Pro', 'pro', 14999, 149990, '{"users":25,"branches":3,"quotes_per_month":2000}'::jsonb, '{"ai_assistant":true,"dealer_portal":true,"barcode_tracking":true}'::jsonb, true),
  ('Enterprise', 'enterprise', 0, 0, '{"users":"unlimited","branches":"unlimited","quotes_per_month":"unlimited"}'::jsonb, '{"all_modules":true}'::jsonb, true)
on conflict (plan_type) do update set
  plan_name = excluded.plan_name,
  monthly_price = excluded.monthly_price,
  annual_price = excluded.annual_price,
  module_limits_json = excluded.module_limits_json,
  feature_limits_json = excluded.feature_limits_json,
  is_active = excluded.is_active;

alter table if exists public.company_settings add column if not exists default_branch_id uuid references public.branches(id) on delete set null;
alter table if exists public.app_users add column if not exists branch_id uuid references public.branches(id) on delete set null;
alter table if exists public.customers add column if not exists branch_id uuid references public.branches(id) on delete set null;
alter table if exists public.aluminium_profiles add column if not exists branch_id uuid references public.branches(id) on delete set null;
alter table if exists public.dies add column if not exists branch_id uuid references public.branches(id) on delete set null;
alter table if exists public.quotes add column if not exists branch_id uuid references public.branches(id) on delete set null;
alter table if exists public.orders add column if not exists branch_id uuid references public.branches(id) on delete set null;
alter table if exists public.orders add column if not exists plant_id uuid references public.branches(id) on delete set null;
alter table if exists public.dispatches add column if not exists branch_id uuid references public.branches(id) on delete set null;
alter table if exists public.dispatches add column if not exists warehouse_id uuid references public.branches(id) on delete set null;
alter table if exists public.documents add column if not exists branch_id uuid references public.branches(id) on delete set null;
alter table if exists public.vendors add column if not exists branch_id uuid references public.branches(id) on delete set null;
alter table if exists public.inventory_items add column if not exists branch_id uuid references public.branches(id) on delete set null;
alter table if exists public.inventory_items add column if not exists warehouse_id uuid references public.branches(id) on delete set null;
alter table if exists public.inventory_movements add column if not exists branch_id uuid references public.branches(id) on delete set null;
alter table if exists public.inventory_movements add column if not exists warehouse_id uuid references public.branches(id) on delete set null;
alter table if exists public.billet_batches add column if not exists branch_id uuid references public.branches(id) on delete set null;
alter table if exists public.billet_batches add column if not exists warehouse_id uuid references public.branches(id) on delete set null;
alter table if exists public.profile_stock_batches add column if not exists branch_id uuid references public.branches(id) on delete set null;
alter table if exists public.profile_stock_batches add column if not exists warehouse_id uuid references public.branches(id) on delete set null;
alter table if exists public.machines add column if not exists branch_id uuid references public.branches(id) on delete set null;
alter table if exists public.machines add column if not exists plant_id uuid references public.branches(id) on delete set null;
alter table if exists public.production_jobs add column if not exists branch_id uuid references public.branches(id) on delete set null;
alter table if exists public.production_jobs add column if not exists plant_id uuid references public.branches(id) on delete set null;
alter table if exists public.scrap_records add column if not exists branch_id uuid references public.branches(id) on delete set null;
alter table if exists public.scrap_records add column if not exists plant_id uuid references public.branches(id) on delete set null;
alter table if exists public.finishing_jobs add column if not exists branch_id uuid references public.branches(id) on delete set null;
alter table if exists public.finishing_jobs add column if not exists plant_id uuid references public.branches(id) on delete set null;
alter table if exists public.quality_inspections add column if not exists branch_id uuid references public.branches(id) on delete set null;
alter table if exists public.quality_inspections add column if not exists plant_id uuid references public.branches(id) on delete set null;
alter table if exists public.packing_list_items add column if not exists branch_id uuid references public.branches(id) on delete set null;
alter table if exists public.packing_list_items add column if not exists warehouse_id uuid references public.branches(id) on delete set null;
alter table if exists public.invoices add column if not exists branch_id uuid references public.branches(id) on delete set null;
alter table if exists public.payments add column if not exists branch_id uuid references public.branches(id) on delete set null;

create index if not exists branches_company_type_idx on public.branches(company_id, branch_type, is_active);
create index if not exists feature_flags_company_module_idx on public.feature_flags(company_id, module_name, is_enabled);
create index if not exists company_subscriptions_company_status_idx on public.company_subscriptions(company_id, status, created_at desc);
create index if not exists audit_logs_company_created_idx on public.audit_logs(company_id, created_at desc);
create index if not exists audit_logs_company_entity_idx on public.audit_logs(company_id, entity_type, entity_id);
create index if not exists notifications_company_recipient_idx on public.notifications(company_id, recipient_user_id, is_read, created_at desc);
create index if not exists notifications_company_related_idx on public.notifications(company_id, related_entity_type, related_entity_id);
create index if not exists tasks_company_assignee_status_idx on public.tasks(company_id, assigned_to, status, due_date);
create index if not exists tasks_company_related_idx on public.tasks(company_id, related_entity_type, related_entity_id);
create index if not exists data_exchange_jobs_company_module_idx on public.data_exchange_jobs(company_id, module_name, created_at desc);

create index if not exists app_users_company_branch_idx on public.app_users(company_id, branch_id);
create index if not exists customers_company_branch_idx on public.customers(company_id, branch_id);
create index if not exists profiles_company_branch_idx on public.aluminium_profiles(company_id, branch_id);
create index if not exists dies_company_branch_idx on public.dies(company_id, branch_id);
create index if not exists quotes_company_branch_idx on public.quotes(company_id, branch_id);
create index if not exists orders_company_branch_idx on public.orders(company_id, branch_id);
create index if not exists orders_company_plant_idx on public.orders(company_id, plant_id);
create index if not exists dispatches_company_branch_idx on public.dispatches(company_id, branch_id);
create index if not exists dispatches_company_warehouse_idx on public.dispatches(company_id, warehouse_id);

do $$
begin
  if to_regclass('public.inventory_items') is not null then
    create index if not exists inventory_items_company_branch_idx on public.inventory_items(company_id, branch_id);
    create index if not exists inventory_items_company_warehouse_idx on public.inventory_items(company_id, warehouse_id);
  end if;
  if to_regclass('public.production_jobs') is not null then
    create index if not exists production_jobs_company_branch_idx on public.production_jobs(company_id, branch_id);
    create index if not exists production_jobs_company_plant_idx on public.production_jobs(company_id, plant_id);
  end if;
  if to_regclass('public.quality_inspections') is not null then
    create index if not exists quality_inspections_company_branch_idx on public.quality_inspections(company_id, branch_id);
    create index if not exists quality_inspections_company_plant_idx on public.quality_inspections(company_id, plant_id);
  end if;
  if to_regclass('public.invoices') is not null then
    create index if not exists invoices_company_branch_idx on public.invoices(company_id, branch_id);
  end if;
end $$;

drop trigger if exists set_branches_updated_at on public.branches;
create trigger set_branches_updated_at before update on public.branches for each row execute function public.set_updated_at();
drop trigger if exists set_feature_flags_updated_at on public.feature_flags;
create trigger set_feature_flags_updated_at before update on public.feature_flags for each row execute function public.set_updated_at();
drop trigger if exists set_company_subscriptions_updated_at on public.company_subscriptions;
create trigger set_company_subscriptions_updated_at before update on public.company_subscriptions for each row execute function public.set_updated_at();
drop trigger if exists set_notifications_updated_at on public.notifications;
create trigger set_notifications_updated_at before update on public.notifications for each row execute function public.set_updated_at();
drop trigger if exists set_tasks_updated_at on public.tasks;
create trigger set_tasks_updated_at before update on public.tasks for each row execute function public.set_updated_at();
drop trigger if exists set_data_exchange_jobs_updated_at on public.data_exchange_jobs;
create trigger set_data_exchange_jobs_updated_at before update on public.data_exchange_jobs for each row execute function public.set_updated_at();

alter table public.branches enable row level security;
alter table public.feature_flags enable row level security;
alter table public.subscription_plans enable row level security;
alter table public.company_subscriptions enable row level security;
alter table public.audit_logs enable row level security;
alter table public.notifications enable row level security;
alter table public.tasks enable row level security;
alter table public.data_exchange_jobs enable row level security;

drop policy if exists "branches tenant read" on public.branches;
create policy "branches tenant read" on public.branches for select using (company_id = public.get_current_user_company_id());
drop policy if exists "branches tenant insert admin" on public.branches;
create policy "branches tenant insert admin" on public.branches for insert with check (company_id = public.get_current_user_company_id() and public.is_owner_or_admin());
drop policy if exists "branches tenant update admin" on public.branches;
create policy "branches tenant update admin" on public.branches for update using (company_id = public.get_current_user_company_id() and public.is_owner_or_admin()) with check (company_id = public.get_current_user_company_id());
drop policy if exists "branches tenant delete admin" on public.branches;
create policy "branches tenant delete admin" on public.branches for delete using (company_id = public.get_current_user_company_id() and public.is_owner_or_admin());

drop policy if exists "feature flags tenant read" on public.feature_flags;
create policy "feature flags tenant read" on public.feature_flags for select using (company_id = public.get_current_user_company_id());
drop policy if exists "feature flags tenant insert admin" on public.feature_flags;
create policy "feature flags tenant insert admin" on public.feature_flags for insert with check (company_id = public.get_current_user_company_id() and public.is_owner_or_admin());
drop policy if exists "feature flags tenant update admin" on public.feature_flags;
create policy "feature flags tenant update admin" on public.feature_flags for update using (company_id = public.get_current_user_company_id() and public.is_owner_or_admin()) with check (company_id = public.get_current_user_company_id());
drop policy if exists "feature flags tenant delete admin" on public.feature_flags;
create policy "feature flags tenant delete admin" on public.feature_flags for delete using (company_id = public.get_current_user_company_id() and public.is_owner_or_admin());

drop policy if exists "subscription plans read active" on public.subscription_plans;
create policy "subscription plans read active" on public.subscription_plans for select using (is_active = true);

drop policy if exists "company subscriptions tenant read admin" on public.company_subscriptions;
create policy "company subscriptions tenant read admin" on public.company_subscriptions for select using (company_id = public.get_current_user_company_id() and public.is_owner_or_admin());
drop policy if exists "company subscriptions tenant insert admin" on public.company_subscriptions;
create policy "company subscriptions tenant insert admin" on public.company_subscriptions for insert with check (company_id = public.get_current_user_company_id() and public.is_owner_or_admin());
drop policy if exists "company subscriptions tenant update admin" on public.company_subscriptions;
create policy "company subscriptions tenant update admin" on public.company_subscriptions for update using (company_id = public.get_current_user_company_id() and public.is_owner_or_admin()) with check (company_id = public.get_current_user_company_id());

drop policy if exists "audit logs tenant read admin" on public.audit_logs;
create policy "audit logs tenant read admin" on public.audit_logs for select using (company_id = public.get_current_user_company_id() and public.is_owner_or_admin());
drop policy if exists "audit logs tenant insert" on public.audit_logs;
create policy "audit logs tenant insert" on public.audit_logs for insert with check (company_id = public.get_current_user_company_id());

drop policy if exists "notifications tenant read" on public.notifications;
create policy "notifications tenant read" on public.notifications for select using (company_id = public.get_current_user_company_id());
drop policy if exists "notifications tenant insert" on public.notifications;
create policy "notifications tenant insert" on public.notifications for insert with check (company_id = public.get_current_user_company_id());
drop policy if exists "notifications tenant update" on public.notifications;
create policy "notifications tenant update" on public.notifications for update using (company_id = public.get_current_user_company_id() and (recipient_user_id is null or recipient_user_id = auth.uid() or public.is_owner_or_admin())) with check (company_id = public.get_current_user_company_id());
drop policy if exists "notifications tenant delete admin" on public.notifications;
create policy "notifications tenant delete admin" on public.notifications for delete using (company_id = public.get_current_user_company_id() and public.is_owner_or_admin());

drop policy if exists "tasks tenant read" on public.tasks;
create policy "tasks tenant read" on public.tasks for select using (company_id = public.get_current_user_company_id());
drop policy if exists "tasks tenant insert" on public.tasks;
create policy "tasks tenant insert" on public.tasks for insert with check (company_id = public.get_current_user_company_id());
drop policy if exists "tasks tenant update" on public.tasks;
create policy "tasks tenant update" on public.tasks for update using (company_id = public.get_current_user_company_id()) with check (company_id = public.get_current_user_company_id());
drop policy if exists "tasks tenant delete admin" on public.tasks;
create policy "tasks tenant delete admin" on public.tasks for delete using (company_id = public.get_current_user_company_id() and public.is_owner_or_admin());

drop policy if exists "data exchange tenant read admin" on public.data_exchange_jobs;
create policy "data exchange tenant read admin" on public.data_exchange_jobs for select using (company_id = public.get_current_user_company_id() and public.is_owner_or_admin());
drop policy if exists "data exchange tenant insert admin" on public.data_exchange_jobs;
create policy "data exchange tenant insert admin" on public.data_exchange_jobs for insert with check (company_id = public.get_current_user_company_id() and public.is_owner_or_admin());
drop policy if exists "data exchange tenant update admin" on public.data_exchange_jobs;
create policy "data exchange tenant update admin" on public.data_exchange_jobs for update using (company_id = public.get_current_user_company_id() and public.is_owner_or_admin()) with check (company_id = public.get_current_user_company_id());

commit;

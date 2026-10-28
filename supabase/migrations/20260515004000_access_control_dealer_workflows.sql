create extension if not exists "pgcrypto";

alter table public.app_users add column if not exists dealer_id uuid;
alter table public.app_users add column if not exists sales_region text;
alter table public.app_users add column if not exists department text;
alter table public.app_users add column if not exists status text not null default 'active' check (status in ('active','invited','deactivated'));
alter table public.app_users drop constraint if exists app_users_role_check;
alter table public.app_users add constraint app_users_role_check check (
  role in (
    'owner',
    'admin',
    'sales_manager',
    'sales',
    'production_manager',
    'production',
    'dispatch_manager',
    'dispatch',
    'accounts',
    'quality',
    'viewer',
    'factory_manager',
    'inventory_manager',
    'dealer_admin',
    'dealer_staff'
  )
);

create table if not exists public.permissions (
  key text primary key,
  module_name text not null,
  description text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  role_key text not null,
  name text not null,
  description text,
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roles_company_key_unique unique (company_id, role_key)
);

create table if not exists public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  granted_by uuid references auth.users(id),
  granted_at timestamptz not null default now(),
  primary key (role_id, permission_key)
);

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete restrict,
  dealer_id uuid,
  branch_id uuid references public.branches(id),
  sales_region text,
  department text,
  is_primary boolean not null default false,
  assigned_by uuid references auth.users(id),
  assigned_at timestamptz not null default now()
);

create table if not exists public.dealers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  dealer_code text not null,
  dealer_name text not null,
  contact_person text,
  phone text,
  email text,
  gst_number text,
  billing_address text,
  shipping_address text,
  city text,
  state text,
  pincode text,
  sales_region text,
  credit_limit numeric(14,2) not null default 0,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dealers_company_code_unique unique (company_id, dealer_code)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'app_users_dealer_fk'
      and conrelid = 'public.app_users'::regclass
  ) then
    alter table public.app_users
      add constraint app_users_dealer_fk foreign key (dealer_id) references public.dealers(id) on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_roles_dealer_fk'
      and conrelid = 'public.user_roles'::regclass
  ) then
    alter table public.user_roles
      add constraint user_roles_dealer_fk foreign key (dealer_id) references public.dealers(id) on delete cascade;
  end if;
end;
$$;

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  dealer_id uuid references public.dealers(id) on delete cascade,
  role_id uuid references public.roles(id) on delete restrict,
  full_name text not null,
  email text not null,
  phone text,
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  branch_id uuid references public.branches(id),
  sales_region text,
  department text,
  invited_by uuid references auth.users(id),
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz,
  revoked_by uuid references auth.users(id),
  revoked_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs_enterprise (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  timestamp timestamptz not null default now(),
  actor_user_id uuid references auth.users(id),
  actor_name text,
  actor_role text,
  actor_company_id uuid,
  actor_dealer_id uuid references public.dealers(id),
  action_type text not null,
  module_name text not null,
  entity_type text not null,
  entity_id uuid,
  entity_reference_number text,
  previous_value jsonb not null default '{}'::jsonb,
  new_value jsonb not null default '{}'::jsonb,
  change_summary text,
  ip_address text,
  user_agent text,
  device_session_id text,
  status text not null default 'success' check (status in ('success','failed')),
  reason text,
  related_order_id uuid,
  related_quote_id uuid,
  related_inventory_id uuid,
  related_shipment_id uuid,
  created_at timestamptz not null default now()
);

create or replace function public.prevent_audit_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Audit logs are append-only';
end;
$$;

drop trigger if exists audit_logs_enterprise_append_only_update on public.audit_logs_enterprise;
create trigger audit_logs_enterprise_append_only_update before update on public.audit_logs_enterprise for each row execute function public.prevent_audit_log_mutation();
drop trigger if exists audit_logs_enterprise_append_only_delete on public.audit_logs_enterprise;
create trigger audit_logs_enterprise_append_only_delete before delete on public.audit_logs_enterprise for each row execute function public.prevent_audit_log_mutation();

create table if not exists public.inventory_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  dealer_id uuid references public.dealers(id) on delete cascade,
  branch_id uuid references public.branches(id),
  location_code text not null,
  location_name text not null,
  location_type text not null check (location_type in ('factory','warehouse','branch','dealer','in_transit','customer')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_locations_company_code_unique unique (company_id, location_code)
);

create table if not exists public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id),
  item_type text not null check (item_type in ('profile','hardware','accessory','glass','gasket','fastener','other')),
  quantity numeric(14,3) not null check (quantity <> 0),
  unit text not null check (unit in ('pieces','meters','kg','set','box')),
  inventory_state text not null check (inventory_state in ('factory_available_stock','factory_reserved_stock','factory_allocated_to_order','packed_for_dispatch','dispatched_to_dealer','in_transit_to_dealer','dealer_pending_receipt','dealer_received_confirmed','dealer_inventory_on_hand','discrepancy_under_review','damaged_or_short_received','adjustment_approved')),
  from_location_id uuid references public.inventory_locations(id),
  to_location_id uuid references public.inventory_locations(id),
  from_owner_type text not null check (from_owner_type in ('factory','dealer','customer')),
  from_owner_id uuid,
  to_owner_type text not null check (to_owner_type in ('factory','dealer','customer')),
  to_owner_id uuid,
  order_id uuid,
  dealer_order_id uuid,
  shipment_id uuid,
  batch_id uuid,
  created_by_user_id uuid references auth.users(id),
  created_by_role text,
  reason text,
  status text not null default 'posted' check (status in ('draft','posted','pending_approval','approved','rejected','void')),
  audit_log_id uuid references public.audit_logs_enterprise(id),
  created_at timestamptz not null default now()
);

create table if not exists public.dealer_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  dealer_id uuid not null references public.dealers(id) on delete cascade,
  order_number text not null,
  created_by_dealer_user_id uuid references auth.users(id),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  delivery_address text,
  expected_delivery_date date,
  notes text,
  status text not null default 'dealer_order_submitted' check (status in ('dealer_order_submitted','accepted_by_factory','rejected_by_factory','material_reserved','production_scheduled','in_production','production_completed','quality_check_pending','quality_check_passed','packed','dispatched','in_transit','delivered_to_dealer','pending_dealer_count','received_confirmed','discrepancy_reported','recount_requested','discrepancy_resolved','closed','cancelled')),
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dealer_orders_company_number_unique unique (company_id, order_number)
);

create table if not exists public.dealer_order_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  dealer_order_id uuid not null references public.dealer_orders(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id),
  item_type text not null check (item_type in ('profile','hardware','accessory','glass','gasket','fastener','other')),
  item_description text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit text not null check (unit in ('pieces','meters','kg','set','box')),
  finish text,
  size_description text,
  system_type text,
  created_at timestamptz not null default now()
);

create table if not exists public.dealer_order_status_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  dealer_order_id uuid not null references public.dealer_orders(id) on delete cascade,
  previous_status text,
  new_status text not null,
  changed_by uuid references auth.users(id),
  notes text,
  attachments_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  dealer_id uuid not null references public.dealers(id) on delete cascade,
  dealer_order_id uuid references public.dealer_orders(id),
  shipment_number text not null,
  status text not null default 'packed' check (status in ('packed','dispatched','in_transit','delivered_to_dealer','pending_dealer_count','received_confirmed','discrepancy_reported','closed')),
  transporter_name text,
  vehicle_number text,
  lr_number text,
  eway_bill_number text,
  packing_list_url text,
  dispatched_by uuid references auth.users(id),
  dispatched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shipments_company_number_unique unique (company_id, shipment_number)
);

create table if not exists public.shipment_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  dealer_order_item_id uuid references public.dealer_order_items(id),
  inventory_item_id uuid not null references public.inventory_items(id),
  item_description text not null,
  expected_quantity numeric(14,3) not null check (expected_quantity > 0),
  unit text not null check (unit in ('pieces','meters','kg','set','box')),
  status text not null default 'dealer_pending_receipt' check (status in ('dealer_pending_receipt','received_confirmed','discrepancy_reported','recount_requested','discrepancy_resolved')),
  created_at timestamptz not null default now()
);

create table if not exists public.dealer_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  dealer_id uuid not null references public.dealers(id) on delete cascade,
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  received_by_user_id uuid not null references auth.users(id),
  received_by_name text,
  received_by_role text,
  status text not null default 'submitted' check (status in ('submitted','confirmed','discrepancy_reported','recount_requested','resolved')),
  notes text,
  ip_address text,
  user_agent text,
  device_session_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.dealer_receipt_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  dealer_receipt_id uuid not null references public.dealer_receipts(id) on delete cascade,
  shipment_item_id uuid not null references public.shipment_items(id) on delete cascade,
  expected_quantity numeric(14,3) not null,
  reported_received_quantity numeric(14,3) not null,
  difference_quantity numeric(14,3) generated always as (reported_received_quantity - expected_quantity) stored,
  status text not null check (status in ('received_confirmed','discrepancy_reported')),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_discrepancies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  dealer_id uuid not null references public.dealers(id) on delete cascade,
  dealer_order_id uuid references public.dealer_orders(id),
  shipment_id uuid not null references public.shipments(id),
  shipment_item_id uuid not null references public.shipment_items(id),
  expected_quantity numeric(14,3) not null,
  reported_quantity numeric(14,3) not null,
  recount_quantity numeric(14,3),
  difference_quantity numeric(14,3) not null,
  status text not null default 'open' check (status in ('open','recount_requested','recount_completed','resolved','rejected')),
  reported_by_user_id uuid references auth.users(id),
  reported_by_name text,
  reported_by_role text,
  resolution_reason text check (resolution_reason is null or resolution_reason in ('short_shipment','dealer_counting_error','transit_damage_loss','wrong_item_sent','extra_quantity_received','manual_correction')),
  resolution_notes text,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.discrepancy_recounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  discrepancy_id uuid not null references public.inventory_discrepancies(id) on delete cascade,
  recount_quantity numeric(14,3) not null,
  recounted_by_user_id uuid not null references auth.users(id),
  recounted_by_name text,
  recounted_by_role text,
  notes text,
  ip_address text,
  user_agent text,
  device_session_id text,
  created_at timestamptz not null default now()
);

alter table public.notifications add column if not exists dealer_id uuid references public.dealers(id) on delete cascade;
alter table public.notifications add column if not exists recipient_role text;
alter table public.notifications add column if not exists action_link text;
alter table public.notifications add column if not exists entity_reference text;

create table if not exists public.report_exports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  report_type text not null,
  filters_json jsonb not null default '{}'::jsonb,
  exported_by uuid references auth.users(id),
  status text not null default 'completed' check (status in ('queued','completed','failed')),
  file_url text,
  created_at timestamptz not null default now()
);

create index if not exists roles_company_active_idx on public.roles(company_id, is_active, role_key);
create index if not exists user_roles_company_user_idx on public.user_roles(company_id, user_id);
create unique index if not exists user_roles_unique_idx on public.user_roles(user_id, role_id, coalesce(dealer_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists dealers_company_active_idx on public.dealers(company_id, is_active, dealer_name);
create index if not exists invitations_company_status_idx on public.invitations(company_id, status, created_at desc);
create index if not exists audit_logs_enterprise_company_time_idx on public.audit_logs_enterprise(company_id, timestamp desc);
create index if not exists audit_logs_enterprise_filters_idx on public.audit_logs_enterprise(company_id, module_name, action_type, entity_type, status, timestamp desc);
create index if not exists inventory_transactions_company_item_idx on public.inventory_transactions(company_id, inventory_item_id, created_at desc);
create index if not exists dealer_orders_company_dealer_status_idx on public.dealer_orders(company_id, dealer_id, status, created_at desc);
create index if not exists shipments_company_dealer_status_idx on public.shipments(company_id, dealer_id, status, created_at desc);
create index if not exists discrepancies_company_status_idx on public.inventory_discrepancies(company_id, status, created_at desc);

drop trigger if exists set_roles_updated_at on public.roles;
create trigger set_roles_updated_at before update on public.roles for each row execute function public.set_updated_at();
drop trigger if exists set_dealers_updated_at on public.dealers;
create trigger set_dealers_updated_at before update on public.dealers for each row execute function public.set_updated_at();
drop trigger if exists set_invitations_updated_at on public.invitations;
create trigger set_invitations_updated_at before update on public.invitations for each row execute function public.set_updated_at();
drop trigger if exists set_dealer_orders_updated_at on public.dealer_orders;
create trigger set_dealer_orders_updated_at before update on public.dealer_orders for each row execute function public.set_updated_at();
drop trigger if exists set_shipments_updated_at on public.shipments;
create trigger set_shipments_updated_at before update on public.shipments for each row execute function public.set_updated_at();
drop trigger if exists set_inventory_discrepancies_updated_at on public.inventory_discrepancies;
create trigger set_inventory_discrepancies_updated_at before update on public.inventory_discrepancies for each row execute function public.set_updated_at();

insert into public.permissions (key, module_name, description) values
  ('view_quotes','quotes','View quotations'), ('create_quotes','quotes','Create quotations'), ('edit_quotes','quotes','Edit quotations'), ('delete_quotes','quotes','Delete quotations'), ('approve_quotes','quotes','Approve quotations'),
  ('view_orders','orders','View orders'), ('create_orders','orders','Create orders'), ('edit_orders','orders','Edit orders'), ('cancel_orders','orders','Cancel orders'), ('approve_orders','orders','Approve orders'),
  ('view_inventory','inventory','View inventory'), ('edit_inventory','inventory','Edit inventory'), ('adjust_inventory','inventory','Adjust inventory'), ('approve_inventory_adjustments','inventory','Approve inventory adjustments'),
  ('view_dealer_inventory','dealer_inventory','View dealer inventory'), ('edit_dealer_inventory','dealer_inventory','Edit dealer inventory'), ('receive_dealer_inventory','dealer_inventory','Receive dealer inventory'),
  ('view_factory_inventory','inventory','View factory inventory'), ('manage_shipments','shipments','Manage shipments'), ('manage_users','security','Manage users'), ('manage_roles','security','Manage roles'), ('view_audit_logs','security','View audit logs'), ('export_reports','reports','Export reports'), ('manage_company_settings','settings','Manage company settings')
on conflict (key) do update set module_name = excluded.module_name, description = excluded.description;

create or replace function public.seed_default_roles_for_company(target_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  role_record record;
begin
  for role_record in select * from (values
    ('owner','Super Admin / Owner','Full system access', array['view_quotes','create_quotes','edit_quotes','delete_quotes','approve_quotes','view_orders','create_orders','edit_orders','cancel_orders','approve_orders','view_inventory','edit_inventory','adjust_inventory','approve_inventory_adjustments','view_dealer_inventory','edit_dealer_inventory','receive_dealer_inventory','view_factory_inventory','manage_shipments','manage_users','manage_roles','view_audit_logs','export_reports','manage_company_settings']),
    ('admin','Admin','Full operational access except critical company settings', array['view_quotes','create_quotes','edit_quotes','delete_quotes','approve_quotes','view_orders','create_orders','edit_orders','cancel_orders','approve_orders','view_inventory','edit_inventory','adjust_inventory','view_dealer_inventory','edit_dealer_inventory','receive_dealer_inventory','view_factory_inventory','manage_shipments','manage_users','manage_roles','view_audit_logs','export_reports']),
    ('sales','Sales Team','Customer, quote, and order access', array['view_quotes','create_quotes','edit_quotes','view_orders','create_orders','view_inventory']),
    ('factory_manager','Factory Manager','Production and dispatch operations', array['view_orders','edit_orders','view_inventory','edit_inventory','view_factory_inventory','manage_shipments']),
    ('inventory_manager','Inventory Manager','Factory stock and approved adjustments', array['view_inventory','edit_inventory','adjust_inventory','view_factory_inventory','manage_shipments']),
    ('dealer_admin','Dealer Admin','Dealer quotes, orders, and dealer inventory control', array['view_quotes','create_quotes','edit_quotes','view_orders','create_orders','edit_orders','view_inventory','edit_inventory','adjust_inventory','view_dealer_inventory','edit_dealer_inventory','receive_dealer_inventory']),
    ('dealer_staff','Dealer Staff','Dealer quotes, orders, inventory updates, and receipt counting', array['view_quotes','create_quotes','view_orders','create_orders','view_inventory','edit_inventory','view_dealer_inventory','edit_dealer_inventory','receive_dealer_inventory']),
    ('accounts','Accountant / Finance','Invoices, payments, ledgers, and reports', array['view_orders','view_quotes','export_reports']),
    ('viewer','Read-Only / Auditor','Selected read-only access and audit logs', array['view_quotes','view_orders','view_inventory','view_dealer_inventory','view_audit_logs'])
  ) as t(role_key, name, description, permissions)
  loop
    insert into public.roles(company_id, role_key, name, description, is_system)
    values (target_company_id, role_record.role_key, role_record.name, role_record.description, true)
    on conflict (company_id, role_key) do update set name = excluded.name, description = excluded.description, is_system = true;

    insert into public.role_permissions(role_id, permission_key)
    select r.id, unnest(role_record.permissions::text[]) from public.roles r where r.company_id = target_company_id and r.role_key = role_record.role_key
    on conflict do nothing;
  end loop;
end;
$$;

create or replace function public.get_current_user_dealer_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select dealer_id from public.app_users where id = auth.uid() and is_active = true;
$$;

create or replace function public.current_user_has_permission(permission text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(public.get_current_user_role() in ('owner','admin'), false)
    or exists (
      select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id and r.is_active = true
      join public.role_permissions rp on rp.role_id = r.id
      where ur.user_id = auth.uid()
        and ur.company_id = public.get_current_user_company_id()
        and rp.permission_key = permission
    )
    or exists (
      select 1
      from public.roles r
      join public.role_permissions rp on rp.role_id = r.id
      where r.company_id = public.get_current_user_company_id()
        and r.role_key = public.get_current_user_role()
        and r.is_active = true
        and rp.permission_key = permission
    );
$$;

alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;
alter table public.dealers enable row level security;
alter table public.invitations enable row level security;
alter table public.audit_logs_enterprise enable row level security;
alter table public.inventory_locations enable row level security;
alter table public.inventory_transactions enable row level security;
alter table public.dealer_orders enable row level security;
alter table public.dealer_order_items enable row level security;
alter table public.dealer_order_status_history enable row level security;
alter table public.shipments enable row level security;
alter table public.shipment_items enable row level security;
alter table public.dealer_receipts enable row level security;
alter table public.dealer_receipt_items enable row level security;
alter table public.inventory_discrepancies enable row level security;
alter table public.discrepancy_recounts enable row level security;
alter table public.report_exports enable row level security;

drop policy if exists "permissions read authenticated" on public.permissions;
create policy "permissions read authenticated" on public.permissions for select using (auth.uid() is not null);

drop policy if exists "roles tenant read" on public.roles;
create policy "roles tenant read" on public.roles for select using (company_id = public.get_current_user_company_id());
drop policy if exists "roles tenant manage" on public.roles;
create policy "roles tenant manage" on public.roles for all using (company_id = public.get_current_user_company_id() and public.current_user_has_permission('manage_roles')) with check (company_id = public.get_current_user_company_id() and public.current_user_has_permission('manage_roles'));

drop policy if exists "role permissions tenant read" on public.role_permissions;
create policy "role permissions tenant read" on public.role_permissions for select using (exists (select 1 from public.roles r where r.id = role_permissions.role_id and r.company_id = public.get_current_user_company_id()));
drop policy if exists "role permissions tenant manage" on public.role_permissions;
create policy "role permissions tenant manage" on public.role_permissions for all using (exists (select 1 from public.roles r where r.id = role_permissions.role_id and r.company_id = public.get_current_user_company_id() and public.current_user_has_permission('manage_roles'))) with check (exists (select 1 from public.roles r where r.id = role_permissions.role_id and r.company_id = public.get_current_user_company_id() and public.current_user_has_permission('manage_roles')));

drop policy if exists "user roles tenant read" on public.user_roles;
create policy "user roles tenant read" on public.user_roles for select using (company_id = public.get_current_user_company_id() and (public.current_user_has_permission('manage_users') or user_id = auth.uid()));
drop policy if exists "user roles tenant manage" on public.user_roles;
create policy "user roles tenant manage" on public.user_roles for all using (company_id = public.get_current_user_company_id() and public.current_user_has_permission('manage_users')) with check (company_id = public.get_current_user_company_id() and public.current_user_has_permission('manage_users'));

drop policy if exists "dealers tenant read" on public.dealers;
create policy "dealers tenant read" on public.dealers for select using (company_id = public.get_current_user_company_id() and (public.current_user_has_permission('manage_users') or public.get_current_user_dealer_id() is null or id = public.get_current_user_dealer_id()));
drop policy if exists "dealers tenant manage" on public.dealers;
create policy "dealers tenant manage" on public.dealers for all using (company_id = public.get_current_user_company_id() and public.is_owner_or_admin()) with check (company_id = public.get_current_user_company_id() and public.is_owner_or_admin());

drop policy if exists "invitations tenant read" on public.invitations;
create policy "invitations tenant read" on public.invitations for select using (company_id = public.get_current_user_company_id() and public.current_user_has_permission('manage_users'));
drop policy if exists "invitations tenant manage" on public.invitations;
create policy "invitations tenant manage" on public.invitations for all using (company_id = public.get_current_user_company_id() and public.current_user_has_permission('manage_users')) with check (company_id = public.get_current_user_company_id() and public.current_user_has_permission('manage_users'));

drop policy if exists "audit enterprise read" on public.audit_logs_enterprise;
create policy "audit enterprise read" on public.audit_logs_enterprise for select using (company_id = public.get_current_user_company_id() and public.current_user_has_permission('view_audit_logs'));
drop policy if exists "audit enterprise insert" on public.audit_logs_enterprise;
create policy "audit enterprise insert" on public.audit_logs_enterprise for insert with check (company_id = public.get_current_user_company_id());

drop policy if exists "inventory locations tenant read" on public.inventory_locations;
create policy "inventory locations tenant read" on public.inventory_locations for select using (company_id = public.get_current_user_company_id() and (dealer_id is null or dealer_id = public.get_current_user_dealer_id() or public.current_user_has_permission('view_dealer_inventory')));
drop policy if exists "inventory locations tenant manage" on public.inventory_locations;
create policy "inventory locations tenant manage" on public.inventory_locations for all using (company_id = public.get_current_user_company_id() and public.current_user_has_permission('edit_inventory')) with check (company_id = public.get_current_user_company_id() and public.current_user_has_permission('edit_inventory'));

drop policy if exists "inventory transactions tenant read" on public.inventory_transactions;
create policy "inventory transactions tenant read" on public.inventory_transactions for select using (company_id = public.get_current_user_company_id() and (to_owner_id = public.get_current_user_dealer_id() or from_owner_id = public.get_current_user_dealer_id() or public.current_user_has_permission('view_inventory') or public.current_user_has_permission('view_dealer_inventory')));
drop policy if exists "inventory transactions tenant insert" on public.inventory_transactions;
create policy "inventory transactions tenant insert" on public.inventory_transactions for insert with check (company_id = public.get_current_user_company_id() and (public.current_user_has_permission('edit_inventory') or public.current_user_has_permission('receive_dealer_inventory')));

drop policy if exists "dealer orders tenant read" on public.dealer_orders;
create policy "dealer orders tenant read" on public.dealer_orders for select using (company_id = public.get_current_user_company_id() and (dealer_id = public.get_current_user_dealer_id() or public.current_user_has_permission('view_orders')));
drop policy if exists "dealer orders tenant insert" on public.dealer_orders;
create policy "dealer orders tenant insert" on public.dealer_orders for insert with check (company_id = public.get_current_user_company_id() and (dealer_id = public.get_current_user_dealer_id() or public.current_user_has_permission('create_orders')));
drop policy if exists "dealer orders tenant update" on public.dealer_orders;
create policy "dealer orders tenant update" on public.dealer_orders for update using (company_id = public.get_current_user_company_id() and (dealer_id = public.get_current_user_dealer_id() or public.current_user_has_permission('edit_orders'))) with check (company_id = public.get_current_user_company_id());

drop policy if exists "dealer order items tenant read" on public.dealer_order_items;
create policy "dealer order items tenant read" on public.dealer_order_items for select using (exists (select 1 from public.dealer_orders o where o.id = dealer_order_items.dealer_order_id and o.company_id = public.get_current_user_company_id() and (o.dealer_id = public.get_current_user_dealer_id() or public.current_user_has_permission('view_orders'))));
drop policy if exists "dealer order items tenant insert" on public.dealer_order_items;
create policy "dealer order items tenant insert" on public.dealer_order_items for insert with check (company_id = public.get_current_user_company_id() and exists (select 1 from public.dealer_orders o where o.id = dealer_order_items.dealer_order_id and (o.dealer_id = public.get_current_user_dealer_id() or public.current_user_has_permission('create_orders'))));

drop policy if exists "shipments tenant read" on public.shipments;
create policy "shipments tenant read" on public.shipments for select using (company_id = public.get_current_user_company_id() and (dealer_id = public.get_current_user_dealer_id() or public.current_user_has_permission('manage_shipments') or public.current_user_has_permission('view_dealer_inventory')));
drop policy if exists "shipments tenant manage" on public.shipments;
create policy "shipments tenant manage" on public.shipments for all using (company_id = public.get_current_user_company_id() and public.current_user_has_permission('manage_shipments')) with check (company_id = public.get_current_user_company_id() and public.current_user_has_permission('manage_shipments'));

drop policy if exists "shipment items tenant read" on public.shipment_items;
create policy "shipment items tenant read" on public.shipment_items for select using (exists (select 1 from public.shipments s where s.id = shipment_items.shipment_id and s.company_id = public.get_current_user_company_id() and (s.dealer_id = public.get_current_user_dealer_id() or public.current_user_has_permission('manage_shipments') or public.current_user_has_permission('view_dealer_inventory'))));
drop policy if exists "shipment items tenant manage" on public.shipment_items;
create policy "shipment items tenant manage" on public.shipment_items for all using (company_id = public.get_current_user_company_id() and public.current_user_has_permission('manage_shipments')) with check (company_id = public.get_current_user_company_id() and public.current_user_has_permission('manage_shipments'));

drop policy if exists "dealer receipts tenant read" on public.dealer_receipts;
create policy "dealer receipts tenant read" on public.dealer_receipts for select using (company_id = public.get_current_user_company_id() and (dealer_id = public.get_current_user_dealer_id() or public.current_user_has_permission('view_dealer_inventory')));
drop policy if exists "dealer receipts tenant insert" on public.dealer_receipts;
create policy "dealer receipts tenant insert" on public.dealer_receipts for insert with check (company_id = public.get_current_user_company_id() and dealer_id = public.get_current_user_dealer_id() and public.current_user_has_permission('receive_dealer_inventory'));

drop policy if exists "dealer receipt items tenant read" on public.dealer_receipt_items;
create policy "dealer receipt items tenant read" on public.dealer_receipt_items for select using (exists (select 1 from public.dealer_receipts r where r.id = dealer_receipt_items.dealer_receipt_id and r.company_id = public.get_current_user_company_id() and (r.dealer_id = public.get_current_user_dealer_id() or public.current_user_has_permission('view_dealer_inventory'))));
drop policy if exists "dealer receipt items tenant insert" on public.dealer_receipt_items;
create policy "dealer receipt items tenant insert" on public.dealer_receipt_items for insert with check (company_id = public.get_current_user_company_id() and exists (select 1 from public.dealer_receipts r where r.id = dealer_receipt_items.dealer_receipt_id and r.dealer_id = public.get_current_user_dealer_id()));

drop policy if exists "discrepancies tenant read" on public.inventory_discrepancies;
create policy "discrepancies tenant read" on public.inventory_discrepancies for select using (company_id = public.get_current_user_company_id() and (dealer_id = public.get_current_user_dealer_id() or public.current_user_has_permission('view_dealer_inventory')));
drop policy if exists "discrepancies tenant manage" on public.inventory_discrepancies;
create policy "discrepancies tenant manage" on public.inventory_discrepancies for all using (company_id = public.get_current_user_company_id() and (dealer_id = public.get_current_user_dealer_id() or public.current_user_has_permission('approve_inventory_adjustments'))) with check (company_id = public.get_current_user_company_id());

drop policy if exists "recounts tenant read" on public.discrepancy_recounts;
create policy "recounts tenant read" on public.discrepancy_recounts for select using (company_id = public.get_current_user_company_id() and exists (select 1 from public.inventory_discrepancies d where d.id = discrepancy_recounts.discrepancy_id and (d.dealer_id = public.get_current_user_dealer_id() or public.current_user_has_permission('view_dealer_inventory'))));
drop policy if exists "recounts tenant insert" on public.discrepancy_recounts;
create policy "recounts tenant insert" on public.discrepancy_recounts for insert with check (company_id = public.get_current_user_company_id() and exists (select 1 from public.inventory_discrepancies d where d.id = discrepancy_recounts.discrepancy_id and d.dealer_id = public.get_current_user_dealer_id()));

drop policy if exists "dealer status history read" on public.dealer_order_status_history;
create policy "dealer status history read" on public.dealer_order_status_history for select using (company_id = public.get_current_user_company_id());
drop policy if exists "dealer status history insert" on public.dealer_order_status_history;
create policy "dealer status history insert" on public.dealer_order_status_history for insert with check (company_id = public.get_current_user_company_id());

drop policy if exists "report exports tenant read" on public.report_exports;
create policy "report exports tenant read" on public.report_exports for select using (company_id = public.get_current_user_company_id() and public.current_user_has_permission('export_reports'));
drop policy if exists "report exports tenant insert" on public.report_exports;
create policy "report exports tenant insert" on public.report_exports for insert with check (company_id = public.get_current_user_company_id() and public.current_user_has_permission('export_reports'));

create or replace function public.audit_existing_business_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_company_id uuid;
  row_id uuid;
  row_ref text;
  actor record;
  action_suffix text;
begin
  row_company_id := coalesce((to_jsonb(new)->>'company_id')::uuid, (to_jsonb(old)->>'company_id')::uuid);
  row_id := coalesce((to_jsonb(new)->>'id')::uuid, (to_jsonb(old)->>'id')::uuid);
  row_ref := coalesce(
    to_jsonb(new)->>tg_argv[2],
    to_jsonb(old)->>tg_argv[2],
    row_id::text
  );

  select full_name, email, role, company_id, dealer_id
  into actor
  from public.app_users
  where id = auth.uid();

  action_suffix := case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'edited' when 'DELETE' then 'deleted' else lower(tg_op) end;

  insert into public.audit_logs_enterprise (
    company_id,
    actor_user_id,
    actor_name,
    actor_role,
    actor_company_id,
    actor_dealer_id,
    action_type,
    module_name,
    entity_type,
    entity_id,
    entity_reference_number,
    previous_value,
    new_value,
    change_summary,
    status,
    related_order_id,
    related_quote_id,
    related_inventory_id
  ) values (
    row_company_id,
    auth.uid(),
    coalesce(actor.full_name, actor.email, 'System'),
    actor.role,
    actor.company_id,
    actor.dealer_id,
    tg_argv[0] || '_' || action_suffix,
    tg_argv[1],
    tg_argv[0],
    row_id,
    row_ref,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else '{}'::jsonb end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else '{}'::jsonb end,
    initcap(replace(tg_argv[0], '_', ' ')) || ' ' || action_suffix,
    'success',
    case when tg_argv[0] = 'order' then row_id else null end,
    case when tg_argv[0] = 'quote' then row_id else null end,
    case when tg_argv[0] = 'inventory_item' then row_id else null end
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists audit_quotes_business_change on public.quotes;
create trigger audit_quotes_business_change after insert or update or delete on public.quotes for each row execute function public.audit_existing_business_change('quote', 'quotes', 'quote_number');

drop trigger if exists audit_orders_business_change on public.orders;
create trigger audit_orders_business_change after insert or update or delete on public.orders for each row execute function public.audit_existing_business_change('order', 'orders', 'order_number');

drop trigger if exists audit_dispatches_business_change on public.dispatches;
create trigger audit_dispatches_business_change after insert or update or delete on public.dispatches for each row execute function public.audit_existing_business_change('dispatch', 'dispatches', 'dispatch_number');

drop trigger if exists audit_inventory_items_business_change on public.inventory_items;
create trigger audit_inventory_items_business_change after insert or update or delete on public.inventory_items for each row execute function public.audit_existing_business_change('inventory_item', 'inventory', 'item_code');

drop trigger if exists audit_invoices_business_change on public.invoices;
create trigger audit_invoices_business_change after insert or update or delete on public.invoices for each row execute function public.audit_existing_business_change('invoice', 'financials', 'invoice_number');

drop trigger if exists audit_payments_business_change on public.payments;
create trigger audit_payments_business_change after insert or update or delete on public.payments for each row execute function public.audit_existing_business_change('payment', 'financials', 'reference_number');

drop trigger if exists audit_dealer_orders_business_change on public.dealer_orders;
create trigger audit_dealer_orders_business_change after insert or update or delete on public.dealer_orders for each row execute function public.audit_existing_business_change('dealer_order', 'dealer_orders', 'order_number');

drop trigger if exists audit_shipments_business_change on public.shipments;
create trigger audit_shipments_business_change after insert or update or delete on public.shipments for each row execute function public.audit_existing_business_change('shipment', 'shipments', 'shipment_number');

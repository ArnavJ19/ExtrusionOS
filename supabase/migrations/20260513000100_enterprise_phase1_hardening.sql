-- ExtrusionOS Enterprise Phase 1 hardening
-- Adds database-level audit coverage and better user-management foundations.

begin;

alter table public.app_users add column if not exists branch_id uuid references public.branches(id) on delete set null;
alter table public.app_users add column if not exists invited_by uuid references auth.users(id);
alter table public.app_users add column if not exists invited_at timestamptz;
alter table public.app_users add column if not exists role_changed_by uuid references auth.users(id);
alter table public.app_users add column if not exists role_changed_at timestamptz;
alter table public.app_users add column if not exists deactivated_by uuid references auth.users(id);
alter table public.app_users add column if not exists deactivated_at timestamptz;

create table if not exists public.user_invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'viewer',
  branch_id uuid references public.branches(id) on delete set null,
  status text not null default 'pending',
  invited_by uuid references auth.users(id),
  accepted_by uuid references auth.users(id),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_invitations_role_check check (role in ('owner','admin','sales_manager','sales','production_manager','production','dispatch_manager','dispatch','accounts','quality','viewer')),
  constraint user_invitations_status_check check (status in ('pending','accepted','cancelled','expired'))
);

drop trigger if exists set_user_invitations_updated_at on public.user_invitations;
create trigger set_user_invitations_updated_at before update on public.user_invitations for each row execute function public.set_updated_at();

create index if not exists app_users_company_branch_idx on public.app_users(company_id, branch_id);
create index if not exists user_invitations_company_status_idx on public.user_invitations(company_id, status, created_at desc);
create index if not exists user_invitations_company_email_idx on public.user_invitations(company_id, email);

alter table public.user_invitations enable row level security;

drop policy if exists "user invitations tenant read admin" on public.user_invitations;
create policy "user invitations tenant read admin" on public.user_invitations
  for select using (company_id = public.get_current_user_company_id() and public.is_owner_or_admin());

drop policy if exists "user invitations tenant insert admin" on public.user_invitations;
create policy "user invitations tenant insert admin" on public.user_invitations
  for insert with check (company_id = public.get_current_user_company_id() and public.is_owner_or_admin());

drop policy if exists "user invitations tenant update admin" on public.user_invitations;
create policy "user invitations tenant update admin" on public.user_invitations
  for update using (company_id = public.get_current_user_company_id() and public.is_owner_or_admin())
  with check (company_id = public.get_current_user_company_id());

drop policy if exists "user invitations tenant delete admin" on public.user_invitations;
create policy "user invitations tenant delete admin" on public.user_invitations
  for delete using (company_id = public.get_current_user_company_id() and public.is_owner_or_admin());

create or replace function public.record_enterprise_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_entity_id uuid;
  v_action text;
begin
  if TG_OP = 'DELETE' then
    v_company_id := old.company_id;
    v_entity_id := old.id;
  else
    v_company_id := new.company_id;
    v_entity_id := new.id;
  end if;

  if v_company_id is not null then
    v_action := lower(TG_OP) || '_' || TG_TABLE_NAME;
    insert into public.audit_logs (company_id, actor_id, action, entity_type, entity_id, metadata_json)
    values (
      v_company_id,
      auth.uid(),
      v_action,
      TG_TABLE_NAME,
      v_entity_id,
      jsonb_build_object('table', TG_TABLE_NAME, 'operation', TG_OP, 'schema', TG_TABLE_SCHEMA)
    );
  end if;

  if TG_OP = 'DELETE' then
    return old;
  end if;
  return new;
exception when others then
  if TG_OP = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $$
declare
  table_name text;
  audit_tables text[] := array[
    'app_users','customers','aluminium_profiles','dies','quotes','quote_items','quote_revisions',
    'orders','order_stage_history','dispatches','documents','company_settings','vendors',
    'inventory_items','inventory_movements','billet_batches','profile_stock_batches','machines',
    'production_jobs','scrap_records','finishing_jobs','quality_inspections','packing_list_items',
    'invoices','payments','branches','feature_flags','company_subscriptions','notifications',
    'tasks','data_exchange_jobs','user_invitations'
  ];
begin
  foreach table_name in array audit_tables loop
    if to_regclass('public.' || table_name) is not null then
      execute format('drop trigger if exists audit_%I on public.%I', table_name, table_name);
      execute format('create trigger audit_%I after insert or update or delete on public.%I for each row execute function public.record_enterprise_audit()', table_name, table_name);
    end if;
  end loop;
end $$;

commit;

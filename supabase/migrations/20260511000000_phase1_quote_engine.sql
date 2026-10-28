-- Phase 1: ExtrusionOS Pro quotation engine foundations.
-- Safe to run on an existing ExtrusionOS Lite database. This migration only adds
-- columns/tables/indexes and widens status/role checks; it does not drop data.

begin;

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
    'viewer'
  )
);

update public.quotes
set status = case
  when status = 'approved' then 'approved_for_sending'
  when status = 'rejected' then 'customer_rejected'
  else status
end
where status in ('approved', 'rejected');

alter table public.quotes drop constraint if exists quotes_status_check;
alter table public.quotes add constraint quotes_status_check check (
  status in (
    'draft',
    'internal_review',
    'approved_for_sending',
    'sent',
    'customer_approved',
    'customer_rejected',
    'expired',
    'converted_to_order'
  )
);

alter table public.quotes
  add column if not exists revision_number integer not null default 1,
  add column if not exists delivery_timeline text,
  add column if not exists payment_terms text,
  add column if not exists low_margin_approval_required boolean not null default false,
  add column if not exists estimated_profit_amount numeric(14,2) not null default 0,
  add column if not exists estimated_profit_percent numeric(7,2) not null default 0,
  add column if not exists approved_by uuid references auth.users(id),
  add column if not exists approved_at timestamptz,
  add column if not exists approval_notes text,
  add column if not exists sent_at timestamptz,
  add column if not exists customer_decision_at timestamptz;

alter table public.quote_items drop constraint if exists quote_items_finishing_charge_type_check;
alter table public.quote_items add constraint quote_items_finishing_charge_type_check check (finishing_charge_type in ('per_kg','per_meter','fixed','per_sqft'));

alter table public.quote_items
  add column if not exists scrap_allowance_percent numeric(7,2) not null default 0,
  add column if not exists expected_recovery_percent numeric(7,2) not null default 100,
  add column if not exists effective_weight_kg numeric(14,3) not null default 0,
  add column if not exists minimum_billing_weight_kg numeric(14,3) not null default 0,
  add column if not exists billing_weight_kg numeric(14,3) not null default 0,
  add column if not exists die_amortization_type text not null default 'full_die_charge',
  add column if not exists die_amortization_quantity_kg numeric(14,3) not null default 0,
  add column if not exists die_amortization_amount numeric(14,2) not null default 0,
  add column if not exists sales_price_override numeric(14,2),
  add column if not exists minimum_margin_percent numeric(7,2) not null default 0,
  add column if not exists approval_required boolean not null default false,
  add column if not exists estimated_profit_amount numeric(14,2) not null default 0,
  add column if not exists estimated_profit_percent numeric(7,2) not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'quote_items_die_amortization_type_check'
      and conrelid = 'public.quote_items'::regclass
  ) then
    alter table public.quote_items add constraint quote_items_die_amortization_type_check check (
      die_amortization_type in ('full_die_charge','per_kg','waived','customer_paid')
    );
  end if;
end $$;

update public.quote_items
set
  effective_weight_kg = case when effective_weight_kg = 0 then total_weight_kg else effective_weight_kg end,
  billing_weight_kg = case when billing_weight_kg = 0 then greatest(total_weight_kg, minimum_billing_weight_kg) else billing_weight_kg end,
  die_amortization_amount = case when die_amortization_amount = 0 then die_charge else die_amortization_amount end,
  estimated_profit_amount = case when estimated_profit_amount = 0 then margin_amount else estimated_profit_amount end,
  estimated_profit_percent = case when estimated_profit_percent = 0 and line_total_before_gst > 0 then round((margin_amount / line_total_before_gst) * 100, 2) else estimated_profit_percent end;

create table if not exists public.quote_revisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  revision_number integer not null,
  snapshot_json jsonb not null,
  revised_by uuid references auth.users(id),
  revised_at timestamptz not null default now(),
  reason text,
  pdf_url text,
  constraint quote_revisions_quote_revision_unique unique (quote_id, revision_number)
);

alter table public.company_settings
  add column if not exists quote_prefix text not null default 'Q',
  add column if not exists order_prefix text not null default 'O',
  add column if not exists dispatch_prefix text not null default 'D',
  add column if not exists invoice_prefix text not null default 'INV',
  add column if not exists minimum_margin_percent numeric(7,2) not null default 8,
  add column if not exists require_approval_below_margin boolean not null default true,
  add column if not exists default_payment_terms text,
  add column if not exists default_delivery_terms text,
  add column if not exists default_bank_details text,
  add column if not exists default_terms_and_conditions text,
  add column if not exists enable_customer_portal boolean not null default false,
  add column if not exists enable_inventory boolean not null default false,
  add column if not exists enable_quality boolean not null default false,
  add column if not exists enable_payments boolean not null default false;

update public.company_settings
set
  default_bank_details = coalesce(default_bank_details, bank_details),
  default_terms_and_conditions = coalesce(default_terms_and_conditions, default_quote_terms);

create index if not exists app_users_company_role_idx on public.app_users(company_id, role, is_active);
create index if not exists customers_company_created_idx on public.customers(company_id, created_at desc);
create index if not exists profiles_company_active_idx on public.aluminium_profiles(company_id, is_active, profile_code);
create index if not exists dies_company_profile_status_idx on public.dies(company_id, profile_id, die_status);
create index if not exists quotes_company_number_idx on public.quotes(company_id, quote_number);
create index if not exists quotes_company_status_created_idx on public.quotes(company_id, status, created_at desc);
create index if not exists quotes_company_customer_idx on public.quotes(company_id, customer_id, quote_date desc);
create index if not exists quote_items_company_quote_idx on public.quote_items(company_id, quote_id);
create index if not exists quote_items_company_profile_idx on public.quote_items(company_id, profile_id);
create index if not exists quote_items_company_die_idx on public.quote_items(company_id, die_id);
create index if not exists orders_company_number_idx on public.orders(company_id, order_number);
create index if not exists orders_company_customer_idx on public.orders(company_id, customer_id, order_date desc);
create index if not exists dispatches_company_number_idx on public.dispatches(company_id, dispatch_number);
create index if not exists dispatches_company_order_idx on public.dispatches(company_id, order_id);
create index if not exists documents_company_entity_idx on public.documents(company_id, related_entity_type, related_entity_id);
create index if not exists quote_revisions_company_quote_idx on public.quote_revisions(company_id, quote_id, revision_number desc);
create index if not exists quote_revisions_company_revised_idx on public.quote_revisions(company_id, revised_at desc);

drop trigger if exists set_quote_revisions_updated_at on public.quote_revisions;

alter table public.quote_revisions enable row level security;

drop policy if exists "quote revisions tenant read" on public.quote_revisions;
create policy "quote revisions tenant read" on public.quote_revisions
  for select using (company_id = public.get_current_user_company_id());

drop policy if exists "quote revisions tenant insert" on public.quote_revisions;
create policy "quote revisions tenant insert" on public.quote_revisions
  for insert with check (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner','admin','sales_manager','sales')
  );

drop policy if exists "quote revisions tenant update admin" on public.quote_revisions;
create policy "quote revisions tenant update admin" on public.quote_revisions
  for update using (company_id = public.get_current_user_company_id() and public.is_owner_or_admin())
  with check (company_id = public.get_current_user_company_id());

drop policy if exists "quote revisions tenant delete admin" on public.quote_revisions;
create policy "quote revisions tenant delete admin" on public.quote_revisions
  for delete using (company_id = public.get_current_user_company_id() and public.is_owner_or_admin());

commit;

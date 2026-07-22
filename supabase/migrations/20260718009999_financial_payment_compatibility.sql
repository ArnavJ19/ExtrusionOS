-- Compatibility columns required by the financial closure workflow.
-- The legacy live schema predates the dealer payment enrichment migration.
alter table public.payments
  add column if not exists order_id uuid references public.orders(id) on delete set null,
  add column if not exists dealership_id uuid references public.dealers(id) on delete set null,
  add column if not exists payment_type text,
  add column if not exists payment_status text not null default 'PENDING',
  add column if not exists recorded_by_user_id uuid references auth.users(id);

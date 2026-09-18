begin;

drop policy if exists "company subscriptions tenant insert admin" on public.company_subscriptions;
drop policy if exists "company subscriptions tenant update admin" on public.company_subscriptions;

revoke insert, update, delete on table public.company_subscriptions from anon, authenticated;
grant select on table public.company_subscriptions to authenticated;

comment on table public.company_subscriptions is
  'Billing-owned company entitlements. Tenant users may read their scoped subscription but cannot assign or mutate plans.';

commit;

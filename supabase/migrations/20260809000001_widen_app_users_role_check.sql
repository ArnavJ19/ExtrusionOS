-- Re-widen app_users.role CHECK to the full supported role set.
--
-- History: migration 0040_access_control_dealer_workflows.sql widened this constraint
-- to include factory_manager, inventory_manager, dealer_admin, dealer_staff. But
-- 20260511_phase1_quote_engine.sql sorts lexically AFTER 0040 and re-narrowed the
-- constraint to the 11 base roles, silently dropping those four. Meanwhile the app
-- (types/app.ts UserRole, lib/auth/permissions.ts, dealer RLS in 0041, and the
-- invite-accept route) still assign all fifteen roles. The net effect was that
-- inviting/creating a factory_manager, inventory_manager, dealer_admin, or
-- dealer_staff user failed the CHECK ("Could not create app user profile") and the
-- entire dealer-onboarding journey was blocked.
--
-- This migration restores the full set. It is additive/widening only (it never
-- rejects a value that was previously allowed) and does not touch any data.

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

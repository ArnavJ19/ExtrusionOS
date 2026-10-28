-- ============================================================
-- PHASE 23/24 HARDENING: SECURITY CENTER + COMMAND CENTER
-- ============================================================

-- Backfill login_events.company_id from app_users when possible.
UPDATE public.login_events AS le
SET company_id = au.company_id
FROM public.app_users AS au
WHERE le.user_id = au.id
  AND le.company_id IS NULL
  AND au.company_id IS NOT NULL;

-- Enforce company consistency for security logs.
CREATE OR REPLACE FUNCTION public.enforce_security_log_company_consistency()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  resolved_company_id UUID;
BEGIN
  SELECT company_id
    INTO resolved_company_id
  FROM public.app_users
  WHERE id = NEW.user_id
    AND is_active = true;

  IF resolved_company_id IS NULL THEN
    RAISE EXCEPTION 'Unable to resolve company for user_id %', NEW.user_id USING ERRCODE = '23514';
  END IF;

  IF NEW.company_id IS NULL THEN
    NEW.company_id := resolved_company_id;
  END IF;

  IF NEW.company_id IS DISTINCT FROM resolved_company_id THEN
    RAISE EXCEPTION 'company_id does not match user company' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_login_events_company_consistency ON public.login_events;
CREATE TRIGGER enforce_login_events_company_consistency
  BEFORE INSERT OR UPDATE ON public.login_events
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_security_log_company_consistency();

DROP TRIGGER IF EXISTS enforce_sensitive_action_logs_company_consistency ON public.sensitive_action_logs;
CREATE TRIGGER enforce_sensitive_action_logs_company_consistency
  BEFORE INSERT OR UPDATE ON public.sensitive_action_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_security_log_company_consistency();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.login_events WHERE company_id IS NULL) THEN
    ALTER TABLE public.login_events ALTER COLUMN company_id SET NOT NULL;
  END IF;
END $$;

-- Tighten RLS: logs are owner/admin-readable and insert-only by current actor.
DROP POLICY IF EXISTS "login_events_tenant_isolation" ON public.login_events;
DROP POLICY IF EXISTS "login_events_tenant_read_admin" ON public.login_events;
CREATE POLICY "login_events_tenant_read_admin"
  ON public.login_events
  FOR SELECT
  USING (
    company_id = public.get_current_user_company_id()
    AND public.is_owner_or_admin()
  );

DROP POLICY IF EXISTS "login_events_tenant_insert_self" ON public.login_events;
CREATE POLICY "login_events_tenant_insert_self"
  ON public.login_events
  FOR INSERT
  WITH CHECK (
    company_id = public.get_current_user_company_id()
    AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS "sensitive_action_logs_tenant_isolation" ON public.sensitive_action_logs;
DROP POLICY IF EXISTS "sensitive_action_logs_tenant_read_admin" ON public.sensitive_action_logs;
CREATE POLICY "sensitive_action_logs_tenant_read_admin"
  ON public.sensitive_action_logs
  FOR SELECT
  USING (
    company_id = public.get_current_user_company_id()
    AND public.is_owner_or_admin()
  );

DROP POLICY IF EXISTS "sensitive_action_logs_tenant_insert_self" ON public.sensitive_action_logs;
CREATE POLICY "sensitive_action_logs_tenant_insert_self"
  ON public.sensitive_action_logs
  FOR INSERT
  WITH CHECK (
    company_id = public.get_current_user_company_id()
    AND user_id = auth.uid()
    AND public.is_owner_or_admin()
  );

-- Improve command center query index support.
CREATE INDEX IF NOT EXISTS idx_notifications_company_unread_created
  ON public.notifications(company_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_items_company_active_stock
  ON public.inventory_items(company_id, is_active, current_stock);

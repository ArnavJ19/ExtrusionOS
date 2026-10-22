-- ============================================================
-- PHASE 23 LIMITATIONS FIX
-- 1) Resolve historical login event tenant mapping for inactive users
-- 2) Enforce non-null tenant identity in login_events
-- ============================================================

-- Backfill login_events.company_id from app_users without requiring is_active.
UPDATE public.login_events AS le
SET company_id = au.company_id
FROM public.app_users AS au
WHERE le.user_id = au.id
  AND le.company_id IS NULL
  AND au.company_id IS NOT NULL;

-- Replace consistency function to resolve company from app_users regardless of active state.
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
  WHERE id = NEW.user_id;

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

DO $$
DECLARE
  unresolved_count BIGINT;
BEGIN
  SELECT COUNT(*)
    INTO unresolved_count
  FROM public.login_events
  WHERE company_id IS NULL;

  IF unresolved_count > 0 THEN
    RAISE EXCEPTION
      'Cannot enforce login_events.company_id NOT NULL. % unresolved rows remain. Create matching app_users rows or correct user_id values first.',
      unresolved_count
      USING ERRCODE = '23514';
  END IF;

  ALTER TABLE public.login_events ALTER COLUMN company_id SET NOT NULL;
END $$;

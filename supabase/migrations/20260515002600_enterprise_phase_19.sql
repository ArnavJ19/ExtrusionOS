-- ============================================================
-- PHASE 19: WHITE-LABEL AND BRANDING
-- ============================================================
-- Adds brand/theme fields to company_settings.

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS brand_primary_color TEXT,
  ADD COLUMN IF NOT EXISTS brand_secondary_color TEXT,
  ADD COLUMN IF NOT EXISTS pdf_theme TEXT,
  ADD COLUMN IF NOT EXISTS portal_logo_url TEXT,
  ADD COLUMN IF NOT EXISTS portal_banner_url TEXT,
  ADD COLUMN IF NOT EXISTS custom_domain TEXT,
  ADD COLUMN IF NOT EXISTS default_email_signature TEXT,
  ADD COLUMN IF NOT EXISTS default_whatsapp_signature TEXT,
  ADD COLUMN IF NOT EXISTS footer_text TEXT;

ALTER TABLE public.company_settings DROP CONSTRAINT IF EXISTS company_settings_pdf_theme_check;
ALTER TABLE public.company_settings
  ADD CONSTRAINT company_settings_pdf_theme_check
  CHECK (pdf_theme IS NULL OR pdf_theme IN ('industrial_classic', 'aluminium_modern', 'minimal_mono', 'executive_blueprint'));

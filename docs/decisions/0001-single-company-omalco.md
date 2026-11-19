# 0001 — ExtrusionOS serves one company: Omalco Extrusion

**Status:** accepted (9 November 2026) · **Recorded:** 18 November 2026 (FS-107)

**Decision.** ExtrusionOS is Omalco Extrusion's own ERP, not a multi-company SaaS. Public sign-up is closed; staff join by invitation. A guard trigger (`20261109000000_single_tenant_omalco.sql`) allows one `companies` row.

**Kept anyway.** `company_id` columns and row-level security stay as the safety layer. The company is always taken from the signed-in user on the server, never from the browser.

**Consequences.** No company switching, onboarding for other businesses, or per-company billing. Service-role functions that need "the company" (for example `public.fs_monitoring_service`) may take the single company row.

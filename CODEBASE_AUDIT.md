# Full Codebase Audit — 2026-06-06

## Scope

Audited the ExtrusionOS repository from `C:\Users\arnav\OneDrive\Desktop\ExtrusionOS` across application code, API routes, shared libraries, tests, and Supabase migrations. This audit used static scans plus the full available validation suite.

## Audit Coverage

- Repository structure and dependency surface: 581 files outside `node_modules` and `.next`.
- Auth and server-route boundaries under `app/api`, `app/(dashboard)`, `app/(auth)`, `app/portal`, `lib/actions`, and `components`.
- Supabase service-role usage and environment variable exposure.
- Company tenancy patterns in client and server queries.
- Supabase migration RLS coverage for company-scoped tables.
- Storage bucket privacy and company-folder policies.
- Fake/dead feature markers: `href="#"`, `not implemented`, `Coming soon`, `mockData`, `dummyData`, `sampleData`, fake-record markers, `TODO`, and `FIXME`.
- Build, TypeScript, lint, and test health.

## Findings Fixed During Audit

| Area | Issue Found | Fix Applied |
|------|-------------|-------------|
| WhatsApp automation | Client queries relied on RLS but did not explicitly filter by resolved company | Added `.eq("company_id", scopedCompanyId)` to templates, campaigns, outbound messages, and customers in `app/(dashboard)/communications/whatsapp/page.tsx` |
| CRM | Client queries relied on RLS but did not explicitly filter by resolved company | Added `.eq("company_id", scopedCompanyId)` to leads, opportunities, activities, and targets in `app/(dashboard)/crm/page.tsx` |
| Energy | Client loads and rate updates relied on RLS/id-only updates | Added resolved company context to energy readings/sources loads and `.eq("company_id", companyId)` to updates in `app/(dashboard)/energy/page.tsx` |
| QR/barcode | QR list/detail/generation relied on RLS without explicit tenant filters | Added actor/company resolution, explicit QR/scan/entity `.eq("company_id", ...)`, and company-scoped entity validation in `app/(dashboard)/barcode/page.tsx` |
| Energy helper order | Lint caught a React immutability/closure issue after the first patch | Converted `getCompanyId` to a hoisted function declaration in `app/(dashboard)/energy/page.tsx` |

## Security Review Results

- Service role key usage is limited to server routes via `lib/supabase/admin.ts`.
- No service-role imports were found in client components.
- `SUPABASE_SERVICE_ROLE_KEY` is not imported into browser-executed code.
- API routes reviewed are session-gated with `getSessionContext()` except invite acceptance, which is intentionally public-token based.
- Invite acceptance uses service role, token hash lookup, expiration check, and audit logging.
- Data exchange import/export uses a fixed module/table allowlist and stamps `company_id` server-side.
- Customer-facing PCDA report sanitization had already been hardened in the prior recheck and remains covered by tests.

## Database and RLS Review Results

- Static migration parser detected 155 created tables.
- 149 tables were detected as company-scoped.
- 0 detected company-scoped tables were missing RLS enablement.
- Storage buckets found in migrations are private: `technical-drawings` and `maintenance-bills` use `public = false`.
- Storage object policies scope access by first folder segment matching `get_current_user_company_id()`.
- No broad `USING (true)` / `WITH CHECK (true)` storage or company-table policy was found in the focused scan.

## Fake Feature / Placeholder Review

- No production hits found for `href="#"`, explicit `not implemented`, `Coming soon`, `mockData`, `dummyData`, `sampleData`, fake-record markers, `TODO`, or `FIXME` in `app`, `components`, or `lib`.
- Existing disabled controls are tied to loading, validation, permission, or readiness states rather than fake flows.

## Validation Results

- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm test` — passed, 377 tests / 48 suites.
- `npm run build` — passed, 147 app pages generated.

## Known Limitations

- This is a static/local audit plus build/test validation; it does not execute live Supabase policies against a real database session matrix.
- The workspace path available here is not a Git repository, so `git status`, `git diff`, and commit-level audit metadata are unavailable.
- Some modules intentionally rely on Supabase RLS as the final enforcement layer; this audit tightened the clearest client-side query gaps but did not rewrite every module to a server-action-only pattern.

## Recommended Follow-Up

1. Add automated tests or scripts that assert every company-scoped Supabase query in client components includes explicit `company_id` where the company context is available.
2. Run live RLS tests in Supabase for owner/admin/dealer/portal roles across core tables.
3. Add a CI job for the migration parser used in this audit to prevent future company-scoped tables without RLS.
4. Consider migrating high-write client pages to server actions for stricter server-side authorization consistency.

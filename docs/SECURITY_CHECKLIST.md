# Security Checklist — ExtrusionOS

Use this checklist before merging or deploying any major change.

## 1. Authentication

- [ ] Protected routes require login.
- [ ] Unauthenticated users cannot access dashboard pages.
- [ ] Login works.
- [ ] Logout works.
- [ ] Signup/onboarding works where enabled.
- [ ] Users without company profile are redirected safely.
- [ ] Disabled users cannot perform actions.

## 2. Authorization

- [ ] Sensitive actions check user role server-side.
- [ ] UI hiding is not the only protection.
- [ ] Owner/admin-only pages are protected.
- [ ] Sales users cannot access restricted internal costs if configured.
- [ ] Production users cannot edit pricing.
- [ ] Dispatch users cannot edit quotes.
- [ ] Accounts users can only access payment-related areas as intended.
- [ ] Customer/portal users cannot access internal app data.

## 3. Tenant Isolation

- [ ] All company data includes `company_id`.
- [ ] Queries are scoped to authenticated user’s company.
- [ ] `company_id` is derived server-side.
- [ ] Users cannot access another company’s records by changing URL params.
- [ ] Users cannot insert records into another company.
- [ ] Users cannot update another company’s records.
- [ ] Users cannot delete another company’s records.
- [ ] Reports do not combine data across companies.
- [ ] Global search does not leak another company’s data.

## 4. RLS

- [ ] RLS is enabled on all company-specific tables.
- [ ] SELECT policies restrict by company.
- [ ] INSERT policies restrict by company.
- [ ] UPDATE policies restrict by company.
- [ ] DELETE policies restrict by company and role.
- [ ] No broad `auth.role() = 'authenticated'` policies.
- [ ] Helper functions are safe.
- [ ] SECURITY DEFINER functions have safe `search_path`.
- [ ] Users cannot update their own role.
- [ ] Users cannot update their own company_id.

## 5. API Routes and Server Actions

- [ ] Auth is checked.
- [ ] Role is checked.
- [ ] Inputs are validated with Zod.
- [ ] `company_id` is not trusted from request body.
- [ ] Sensitive fields are not returned.
- [ ] Errors do not expose stack traces.
- [ ] No public unauthenticated mutation endpoints.
- [ ] No IDOR vulnerabilities through URL params.
- [ ] Public routes expose only intended data.
- [ ] Webhooks verify signatures if present.

## 6. Secrets and Environment Variables

- [ ] Service role key is never used in client components.
- [ ] No secrets are hardcoded.
- [ ] `.env.example` contains no real secrets.
- [ ] Sensitive env vars are server-only.
- [ ] API keys are not logged.
- [ ] No credentials in committed files.
- [ ] No secrets exposed in client bundle.

## 7. Storage

- [ ] Storage paths include company_id.
- [ ] Users cannot upload into another company folder.
- [ ] Users cannot read another company files.
- [ ] Sensitive buckets are private.
- [ ] Signed URLs are used where appropriate.
- [ ] File size is validated.
- [ ] File type is validated.
- [ ] Dangerous file types are blocked where needed.
- [ ] Filename collisions are handled.
- [ ] Old files are cleaned up or intentionally retained.

## 8. Customer/Public Views

- [ ] Public share links use unguessable tokens.
- [ ] Share links support expiry.
- [ ] Share links support revocation.
- [ ] Customer views do not expose internal cost.
- [ ] Customer views do not expose margin.
- [ ] Customer views do not expose supplier data.
- [ ] Customer views do not expose internal notes.
- [ ] Customer views do not expose other customers’ data.
- [ ] Customer views do not expose other companies’ data.

## 9. Business Logic Security

- [ ] Sales users cannot approve restricted low-margin quotes.
- [ ] Converted quotes cannot be converted twice.
- [ ] Payment amounts cannot corrupt invoice balance.
- [ ] Inventory cannot go negative unless explicitly allowed.
- [ ] Critical warnings block quote/report generation where required.
- [ ] Internal costing is hidden from unauthorized users.
- [ ] Audit logs capture sensitive actions.

## 10. SQL and Database Safety

- [ ] No raw SQL injection risks.
- [ ] Dynamic SQL is avoided or safely parameterized.
- [ ] Migrations are non-destructive.
- [ ] New tables have RLS.
- [ ] New tables have indexes.
- [ ] New status values match frontend and Zod.
- [ ] Foreign keys are correct.
- [ ] Cascades are intentional.

## 11. Deployment Security

- [ ] `npm run lint` passes.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes.
- [ ] Tests pass.
- [ ] Migrations are applied safely.
- [ ] RLS policies are applied.
- [ ] Storage policies are applied.
- [ ] Environment variables are configured.

## 12. Final Security Decision

Choose one:

- [ ] Safe to demo
- [ ] Safe to deploy with caution
- [ ] Not safe to deploy until critical issues are fixed
- [ ] Not safe to demo until app-breaking issues are fixed

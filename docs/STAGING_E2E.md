# Staging Playwright Harness

This harness is opt-in and staging-only. It never reads `SUPABASE_SERVICE_ROLE_KEY` as its credential and refuses a staging URL or key that matches the app's currently configured project.

## Prerequisites

1. Deploy the current migrations and app commit to a separate staging Supabase project and staging web deployment.
2. Create two active owner/admin test users in the same staging company.
3. Copy `.env.staging-e2e.example` into your secret environment provider and fill every required `E2E_STAGING_*` value. Do not commit credentials.
4. Install Chromium once with `npx playwright install chromium`.
5. Optionally set `E2E_STAGING_CREDIT_DISPATCH_ID` to a returned/damaged dispatch that has a non-cancelled invoice.

Run `npm run test:e2e:staging`. With no explicit gate or incomplete values, it prints `SKIPPED` and exits without opening a browser or contacting Supabase.

The run reads the consolidation and dispatch pages without posting factory data. Global setup creates one uniquely named company broadcast notification, verifies both users belong to that company, and global teardown deletes the notification and its cascading read receipts. The credit-note test is read-only and skips when its optional dispatch fixture is absent.

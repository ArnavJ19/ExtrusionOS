# Business logic remediation verification

Date: 2026-09-29. Scope: BL-01 through BL-18 in FIXES-CLAUDE.md.

## Outcome and verification

Implemented the register's 18 findings in the local worktree. Preserved the
pre-existing production-lineage edits and migration. No production database was
modified and no application deployment, Git commit or PR was performed.

- `npm test`: 621 tests passed, zero failures, zero skips.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `git diff --check`: passed (Windows line-ending notices only).
- `node --no-warnings --experimental-strip-types scripts/test-business-logic-sql.mjs`:
  12 isolated PostgreSQL fixture checks passed, including 24 quote calculation
  variants compared with TypeScript. Tests cover uncosted-line blocking, invalid
  inputs, per-line GST rounding, atomic number rollback, immutable identifiers,
  conversion lineage, server-derived order values, supply-state splits,
  source-derived HSN/rates, cross-company source rejection, trigger function
  privileges, and payment-plus-credit settlement/refund reopening.
- PDF tests generate/load single-page and paginated invoices and reject missing
  supply states or HSN data. These are document-generation tests, not visual UAT.

The initial sandboxed test command failed with Node worker `spawn EPERM`;
the complete suite passed when rerun with process permission. Docker's daemon was
unavailable. SQL was therefore tested using temporary PGlite installed only under
ignored `node_modules/.cache/business-logic-sql`; no application dependency changed.

## Files and security

New application files: `lib/calculations/gst.ts`,
`lib/systems-configurator/glass-deductions.ts`, `lib/pdf/invoice-pdf.ts`,
`app/api/pdf/invoice/[id]/route.ts`.

New verification files: `tests/business-logic-regressions.test.mjs`,
`tests/invoice-pdf.test.mjs`, `scripts/test-business-logic-sql.mjs`.
Existing quote, numbering, PCDA mapping and cutting tests were updated to the
corrected business definitions.

New database migration: `supabase/migrations/20260929000000_business_logic_fixes.sql`.
Its reproducible sources are `sql/business-logic-prelude.sql`,
`sql/business-logic-postlude.sql`, and `scripts/build-business-logic-migration.mjs`.
The generator copies the latest existing function definitions with checked
replacements; historical migrations are unchanged.

Modified application areas: quote/foundry/rounding/alloy/plan-attainment calculations,
PCDA snapshots, configurator costing and cutting, number previews, quote and invoice
actions, validation schemas, quote/order/operation forms, profile HSN entry,
company GST-state settings, invoice details and quote PDF tax labelling/gating.

No RLS policy was relaxed. Existing RPC authorization and tenant-scoped operations
remain. New private trigger functions explicitly revoke anonymous/authenticated
execution. Invoice PDF authorization uses financial read permission and tenant
filters, with an explicit customer-safe field selection and private/no-store
response. Internal costing and freeform invoice notes are excluded from the PDF.

## Deployment and manual checks

Apply the additive migration before deploying the app, first on a representative
staging database. The fixture is not a replay of all historical migrations and does
not prove live RLS behavior or concurrent transactions in separate sessions.

1. Set a profile's finishing perimeter and HSN. Confirm a per-sqft quote matches
   its measured geometry; missing perimeter must block sending and PDF output.
2. Check recovery and additional handling/offcut allowances with the estimator.
   Margin now means profit divided by selling revenue; revising an old quote can
   change its price. Historical quotes are not automatically repriced.
3. Create records simultaneously from two authenticated sessions and confirm
   distinct numbers. New machine/material identifiers use the centralized yearly
   series; existing identifiers remain unchanged. Check any external label imports.
4. Confirm mixed/zero GST rates survive quote, order, packing and invoice handoff.
   Set company GST state (or GSTIN) and select the actual domestic place of supply.
   Verify same-state, interstate and applicable UT invoices with accounts.
5. Open invoice PDF on desktop and mobile; inspect pagination, tax labels and
   customer details. Test account roles and cross-company URLs in staging.
6. Settle an invoice partly by receipt and partly by credit note, then refund a
   receipt; verify balances and terminal/reopened status.
7. Confirm duplicate-profile quote lines retain distinct source IDs through
   conversion, and oversized cuts appear as unplaced with reusable offcuts separate.

Not verified: live migration application, full-schema staging replay, independent
session concurrency, authenticated browser/UAT, or production behavior. Export,
SEZ, reverse-charge, cess, e-invoicing and GSTR filing workflows are outside this
domestic tax-split implementation. Legacy invoices missing HSN/state data are not
silently certified by the new PDF route. Existing records are not bulk repriced.

GST particulars were checked against CBIC's invoice rules:
https://cbic-gst.gov.in/gst-invoice-rules.html . This implementation is not a claim
that every tax scenario or statutory issuance requirement has been certified.

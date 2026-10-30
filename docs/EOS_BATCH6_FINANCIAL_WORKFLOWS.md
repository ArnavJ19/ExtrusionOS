# EOS Batch 6: Financial Workflows

Local implementation record for catalogue features 19, 27, 96, and 97, 30 October 2026.

## Scope

- Feature 19 adds a bounded, mapped accounting receipt CSV import. It stores a source fingerprint and row-level posted or failed reconciliation, and replays an identical import without posting twice. It does not connect accounting providers or weighing hardware. Unverified device readings cannot be confirmed as actual weight.
- Feature 27 adds a state-based correction preview. Draft invoices route to editing; posted payments use the existing audited reversal; eligible open receivables can receive an explicitly separate credit adjustment. Corrections retain their original records, reason, identity, and linked adjustment. The credit adjustment changes the receivable ledger and is not a GST credit note document.
- Feature 96 adds /invoices/eligibility. Accounts can inspect each complete dispatch manifest, shipped quantity, rate, canonical source GST, line tax, total, and source fingerprint before preparing an invoice. Saving rechecks the source fingerprint while holding the dispatch invoice lock and delegates to the existing atomic invoice writer. Each partial order portion remains a separate dispatch invoice. Issued invoice lines and totals are snapshotted and made immutable.
- Feature 97 adds /payments/receipts. An actual receipt can be reviewed and allocated across open invoices in one transaction. The canonical payment rows remain the receivables ledger; a receipt event groups them for reconciliation. Sorted invoice locks, exact allocation totals, idempotency keys, company/method/date/reference locks, and a database payment-reference trigger prevent duplicate posting and over-allocation. Cash and credit adjustments stay separate.

## Changes

Migration: supabase/migrations/20261029130000_financial_workflow_review.sql.

Workflow logic and actions: lib/workflow/financial-workflow-review.ts, lib/actions/financial-workflow-review.ts, lib/financials/invoice-sources.ts, lib/actions/invoices.ts, and lib/pcda/invoice.ts.

Pages and mounted UI: app/(dashboard)/payments/receipts/page.tsx, app/(dashboard)/invoices/eligibility/page.tsx, app/(dashboard)/invoices/new/page.tsx, and components/modules/financials/financial-workflow-review.tsx / invoice-form-client.tsx.

The migration adds protected receipt import/event/allocation tables, a finance-scoped tax-basis view, an atomic reviewed-invoice wrapper, issued invoice snapshots, and payment-reference enforcement. Direct writes to receipt workflow tables and execution of internal helpers are revoked; authenticated actions use company and role checks, and database functions repeat those checks.

## Verification

- `tests/financial-workflow-review.test.mjs`: 11 cases cover retained-schema and full-chain fixtures, including stale invoice reviews, source GST/HSN, immutable issued snapshots, grouped multi-invoice receipts, retry identity, grouped and standalone reference collisions, over-allocation, separate credits, CSV reconciliation, role/tenant checks and protected writes. Final executed totals are in the batch evidence register.
- Audit repair: payment-reference grouping uses a private transaction-bound authorization for each exact invoice/amount/request. A forged transaction-local receipt GUC cannot extend an existing receipt. The regression checks receipt, payment and allocation totals remain equal.
- `tests/financial-correction-action.test.mjs`: 2/2 passed. An uncertain credit adjustment retries its original posting date and reason, while a changed reason, stale preview or denied role cannot post.
- Focused ESLint over the changed TypeScript/TSX files passed with no warnings.
- npm run typecheck: passed after the concurrent configuration-release diagnostics were resolved. No diagnostics were reported in the financial workflow files.
- `tests/financial-workflow-review-browser.test.mjs`: 3/3 mounted cases passed after authorized local loopback execution. Receipt retries, CSV failures, separate non-cash adjustments and fingerprinted dispatch invoice preparation are exercised. These are mocked-action component checks, not signed-in hosted acceptance.

## Acceptance Follow-Up

Final batch lint, typecheck, build and full regression results are recorded in
`../EOS_UPGRADE_BATCH_6.md`. Hosted migration application, JWT/RLS checks and
signed-in operator acceptance remain separate; this record does not establish
hosted rollout or deployment.

Manual review checklist:

1. Review a packed dispatch, confirm its HSN/GST and per-line tax against the order/quote, then save. Change a packed rate after review and confirm the save requires a fresh review.
2. Post one actual receipt over two invoices, replay the same retry key, then try the same bank reference on a different receipt and confirm only the first receipt remains posted.
3. Import a mapped CSV containing a duplicate reference and an unknown invoice; confirm valid rows post once and failures remain visible in reconciliation.
4. Preview a posted payment reversal and an open-invoice credit adjustment. Confirm a reason is required and the original payment or invoice remains visible.

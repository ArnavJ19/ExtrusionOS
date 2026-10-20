# Finance and Expenses Remediation — 20 October 2026

Remediation of every finding in `FINANCE_EXPENSES_DEEP_AUDIT_2026-10-15.md`.

## Verification boundary

- **No Supabase migration was applied and no hosted database was read or written.** The three new
  migrations are candidates. They were executed whole, or as extracted definitions, in disposable
  PGlite databases built from the historical migrations.
- Concurrency fixes (row locks, advisory locks) are verified by code review and single-session
  tests only; separate-session races were not reproduced.
- PDFs were generated and inspected structurally (embedded fonts, glyph coverage, conjunct shaping,
  pagination). No rasteriser was available, so the pages were **not visually inspected**.
- UI changes pass typecheck, lint and the Next.js build. They were not exercised in an authenticated
  browser session.

## Migrations (apply in order, after `20261015020000` and `20261015030000`)

| File | Scope |
|---|---|
| `20261020010000_expense_ledger_integrity.sql` | EXP-01..EXP-25, SEC-02 |
| `20261020020000_receivables_integrity.sql` | AR-01..AR-04, AR-09, AR-10, SEC-01 |
| `20261020030000_finance_reporting_integrity.sql` | RPT-01/02/05/08/09, EXP-23, AR-06, SEC-01 (RPC), SEC-03, PDF-04 source |

All are additive. Before applying in production, run the review views and resolve what they list:
`expense_ledger_reconciliation_issues` and `invoice_settlement_review` (finance roles only).

## Finding status

| ID | Status | Fix | Tests |
|---|---|---|---|
| AR-01 | Fixed (needs hosted replay) | Exclusivity candidate `20261015020000` retained and re-tested; `invoice_settlement_review` lists historical overlaps. | `receivables-integrity`, `credit-settlement-conflict` |
| AR-02 | Fixed | `record_customer_refund_atomic` posts a signed REFUND linked to the invoice/credit note, capped by customer credit due; receipt reversal is blocked while refunds would exceed receipts. Refund form on invoice and dispatch credit panels. | `receivables-integrity` AR-02 |
| AR-03 | Fixed | Receipt replay compares amount, date, method, reference and notes; the form issues a new key whenever the payload changes. | `receivables-integrity` AR-03, `credit-settlement-guidance` |
| AR-04 | Fixed | Overdue takes precedence over partial when a balance is past due; `invoices_authorized` computes overdue at read time for the database page. | `receivables-integrity` AR-04 |
| AR-05 | Policy confirmed | Return credit notes are whole-dispatch because returned/damaged are whole-dispatch delivery states (stock returns are whole-dispatch). Partial shortage/damage on a delivered dispatch is a standalone credit adjustment. Both screens now say so. | UI copy |
| AR-06 | Fixed | Analytics `customerCreditDue` KPI, risk line and follow-up list with a refund link. | `finance-reporting-integrity` AR-06 |
| AR-07 | Fixed (needs hosted replay) | Candidate `20261015030000` retained; retry key bound to dispatch and reason. | `credit-note-idempotency` |
| AR-08 | Fixed | Receipt form searches open invoices on the server (25 per page) and resolves a deep-linked invoice by ID. | `credit-settlement-guidance` |
| AR-09 | Fixed | `enforce_single_active_dispatch_invoice` trigger serialises on the writer's advisory key and rejects duplicates on create, dispatch change and reactivation; unique index created when no legacy duplicates exist, else listed for review. | `receivables-integrity` AR-09 |
| AR-10 | Fixed | Receipts and refunds use `private.business_today()` (Asia/Kolkata); the form defaults and caps with the same business date. | `receivables-integrity` AR-10 |
| AR-11 | Already fixed | Invoice sources are server-searched in batches of 25 (`get_invoice_source_options`, R11). | existing |
| EXP-01 | Fixed | Totals derived in the database from components; manual RPC rejects mismatched totals and base ≠ qty × rate. Source totals are rate-derived. | `expense-ledger-integrity` EXP-01, `expense-rules` |
| EXP-02 | Fixed | Insert re-evaluates every submitted state against the ₹25,000 threshold and role; status changes need the approval workflow. | EXP-02 |
| EXP-03 | Fixed | Supplier payments require an approved, active, undeleted parent. | EXP-03 |
| EXP-04 | Fixed | Parent row locked before the balance check; payment capped at the locked balance. | EXP-04 |
| EXP-05 | Fixed | Payments are immutable; the sync trigger recomputes both old and new parents in id order. | EXP-05 |
| EXP-06 | Fixed | Composite `(expense_ledger_id, company_id)` FK; RPC resolves the parent by company. | EXP-06 |
| EXP-07 | Fixed | Expense insert/update policies dropped; DML revoked from `authenticated`; writes only through definer RPCs and source triggers. | EXP-07 |
| EXP-08 | Fixed | Payment and manual-expense idempotency keys bound to a payload hash; duplicate references per expense rejected; duplicate vendor bill = same vendor + number + Indian FY + total. | EXP-08 |
| EXP-09 | Fixed | Posted payments/credits immutable except reversal; audit rows carry full before/after. Payment edit route redirects to reversal. | EXP-09 |
| EXP-10 | Fixed | Central ledger is authoritative; source payment status is a projection of it. Source forms show it read-only. | EXP-10 |
| EXP-11 | Fixed | A source with posted cash cannot be deleted or zeroed until payments are reversed or refunded. | EXP-10/11 test |
| EXP-12 | Fixed | `expense_supplier_credits` ledger for supplier credit notes and refunds with supplier-credit-due projection; UI on expense detail. | EXP-12 |
| EXP-13 | Fixed | `amount_paid`, refunds, credits and `paid_date` are always derived from the ledgers. | EXP-07/13 test |
| EXP-14 | Fixed | Approved expenses locked; reopen is owner/admin only, needs a reason, and is blocked while settlements exist. | EXP-14 |
| EXP-15 | Fixed | Zero-cost energy readings retire the payable; a later positive cost reactivates it for re-approval. | EXP-15/25 |
| EXP-16 | Fixed | `expense_ledger_authorized` computes overdue at read time; the database page uses it. | EXP-16/17 |
| EXP-17 | Fixed | Paid date is the latest posted payment date and clears when the balance reopens. | EXP-16/17 |
| EXP-18 | Fixed | `paid` removed as an approval choice and overview lane; legacy labels relabelled `approved` with audit rows. | EXP-14/18, historical repair |
| EXP-19 | Fixed | Foundry source triggers guarded against re-entry; the broken dispatcher triggers replaced. | EXP-19/20/24 |
| EXP-20 | Fixed | Cancelling an outsourced batch retires its payable (fees go to a separate manual expense). | EXP-19/20/24 |
| EXP-21 | Fixed | Maintenance free-text supplier and bill number/date mapped into the central expense. | EXP-15/25 |
| EXP-22 | Fixed | Rate changes revalue the on-hand units of the receipt with a zero-quantity adjustment movement. | EXP-10/11/22 |
| EXP-23 | Fixed | New expenses INR-only; analytics books INR only and reports other currencies separately; exports total per currency. | EXP-23, RPT-01, report-builder |
| EXP-24 | Fixed | SKU-defining edits move stock from the former item to the new one. | EXP-19/20/24 |
| EXP-25 | Fixed | Zero-cost breakdowns retire the payable. | EXP-15/25 |
| SEC-01 | Fixed | `invoices_finance_read` excludes `sales_manager`; analytics returns customer-level receivable detail to finance roles only. | `receivables-integrity` SEC-01, `finance-reporting-integrity` |
| SEC-02 | Fixed | Expense, payment and supplier-credit reads are finance-only. | EXP-07/13 test |
| SEC-03 | Fixed | Collection events are finance-only; other roles get aggregates inside the snapshot. | `finance-reporting-integrity` SEC-03 |
| RPT-01 | Fixed | Booked spend = approved, undeleted, INR; pending approvals reported as commitments. TS mirror aligned. | `finance-reporting-integrity`, `advanced-analytics` |
| RPT-02 | Fixed | Invoicing labelled gross with issued credit notes and net billing. | RPT-02 |
| RPT-03 | Fixed | Payment exports default to posted receipts, include status/type and signed/collection amounts. | `report-builder-finance` |
| RPT-04 | Fixed | Expense exports exclude deleted rows, include currency, total per currency. | `report-builder-finance` |
| RPT-05 | Fixed | `get_profitability_summary` aggregates every row on the server. | RPT-05 |
| RPT-06 | Fixed | Invoice detail shows receipts, adjustments, refunds and credit notes reconciling to the balance. | `report-builder-finance` |
| RPT-07 | Fixed | Currency cells show paise and the record's currency code. | typecheck |
| RPT-08 | Fixed | Rows with unknown cost components are counted as incomplete and excluded from cost/margin. | RPT-08 |
| RPT-09 | Fixed | Days to settle from paid invoices' settling receipts; open invoices reported as outstanding age. | RPT-09 |
| RPT-10 | Fixed | Profitability PCDA header approval is "Not applicable"; payment status stays in its field. | `pcda-reports` |
| PDF-01 | Fixed | Unicode text layer (Helvetica + Noto Sans subsets for 9 Indian scripts, ₹ and Latin Extended) via fontkit shaping. | `pdf-unicode-text` |
| PDF-02 | Fixed | Continuation pages repeat invoice identity; every page numbered. | `pdf-unicode-text` |
| PDF-03 | Fixed | Due date, received, credit notes and balance printed; long tokens hard-wrapped at grapheme boundaries. | `pdf-unicode-text` |
| PDF-04 | Fixed | Report PDFs print all columns in bands, wrap cells, show applied rules and per-group/grand totals; credit notes added as a source. | `report-builder-finance` |
| PDF-05 | Fixed | `/api/pdf/credit-note/[id]`, `/api/pdf/expense/[id]`, `/api/pdf/expense-payment/[id]`. | `pdf-unicode-text` |
| PDF-06 | Fixed | Quote PDF no longer strips non-Latin text. | `pdf-unicode-text` |
| PDF-07 | Fixed | PCDA PDFs wrap long values, repeat identity and number pages. | `pcda-reports` |
| UX-01 | Fixed | Invoice overview and database show "Create Invoice" to the dedicated form (`createHref`). | typecheck |

## Operational notes

- Characters outside the bundled scripts (e.g. emoji, CJK) render as `?` with a footnote; nothing is dropped silently.
- Fonts live in `public/fonts/pdf` (SIL OFL Noto Sans subsets, ~850 KB) and are traced into the PDF routes
  via `next.config.ts`. Refresh them with `node --experimental-strip-types scripts/sync-pdf-fonts.mjs`.
- Approved source-linked expenses lock their source cost: an owner/admin reopens the expense, then the source is edited.
- Historical rows whose stored total disagrees with their components are **not restated**; they are listed for review.

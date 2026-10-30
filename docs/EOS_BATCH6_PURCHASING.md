# EOS Batch 6 Purchasing: Features 58, 95, 98

Status: implementation and focused local checks pass. Final integrated gates are recorded in `../EOS_UPGRADE_BATCH_6.md`. This is not a hosted migration, deployment, or operator acceptance record.

## Delivered

- Purchase orders have supplier and line snapshots for material/service, specification, unit, ordered quantity, agreed rate, GST, and tolerance values. Only active suppliers can be selected for a new order. Issued orders retain their supplier name if the master is later deactivated.
- Stores can record partial receipts against an open PO. Each line splits received quantity into accepted, rejected, and held portions; the transaction locks the PO and its lines and rejects excess quantities. Receipt records do not create stock.
- The full PO view distinguishes remaining delivery from remaining acceptance and shows received/accepted base values at the agreed rate. Those values exclude GST, freight and discount. All physically received portions consume the strict ordered-quantity cap; rejected and held portions do not become accepted material.
- Supplier documents can be ingested from UTF-8 text or CSV. The source is hashed, supported fields are proposed, and uncertain fields are displayed for human review. A document with the same company-scoped hash reuses the original record.
- A reviewed bill is bound to its source hash and review revision. Matching compares PO quantities and rates against accepted receipts and billed amounts, then checks tax, freight, discount, total, unit, and normalized invoice identity against the stored tolerances. Mismatches remain visible as exceptions and cannot be posted.
- Posting repeats reconciliation while holding the relevant rows and creates the linked expense through the existing expense writer. The expense remains `pending_approval`; the purchase flow does not approve or pay it. Duplicate normalized supplier invoice number/date identities are rejected against both purchasing bills and active expense records.
- New protected tables have RLS enabled and no direct table grants to application roles. Mutations use the authenticated command RPC, which derives company and actor server-side and checks allowed roles. State changes are retained in the purchase lifecycle event history.
- Overview, new PO, receiving, full PO and supplier review are separate workspace views. The full database performs search, status filtering, sorting and ten-row pagination on the server. Opening a row retrieves its own company-scoped PO or bill, complete lines, recorded source version and current match.
- A lost mutation response retains the exact request in the mounted form, disables editing and offers an exact retry. Both thrown transport failures and uncertain action results use this path. A confirmed rejection permits correction. Editing a matched draft requires another source review before posting.

## Evidence

- Full local migration-chain replay applied 280 migrations with no failures.
- `tests/purchase-lifecycle.test.mjs`: four unit/edge cases cover extraction, conflicting CSV values, quantity/money precision, valid calendar dates, future actual receipt dates, source review contracts, and receipt balances.
- `tests/purchase-lifecycle-sql.test.mjs`: three tests execute the local migration fixture. Coverage includes partial/excess receipts, exact replay and changed retry, future dates, unmatched/matched posting, duplicate source/invoice/line identities, atomic draft reassignment, retired-supplier continuation, tenant/role boundaries and grants. Twelve POs and eleven bills prove the second server page and reopening its exact source.
- `tests/purchase-lifecycle-browser.test.mjs`: five offline mounted component tests pass. They cover receipt splits, mismatch/recheck/post, both lost-response forms, exact retry payload equality, disabled editing and preventing an edited draft from posting its old matched version. Next routing and server actions are fixture boundaries.
- The combined final focused run also includes the four practice-ledger tests: `docs/evidence/EOS_UPGRADE_BATCH_6/purchasing-final.txt` records 16 passed, zero failed.

## Limits and acceptance still needed

- PDF/image OCR is not configured. Upload currently accepts only UTF-8 `.txt` and `.csv`; it does not claim to extract scanned or arbitrary invoice PDFs.
- Receipt dispositions remain purchasing records only. No stock lot, inventory movement, supplier return, or payment is fabricated from a receipt or proposal.
- The expense entry awaits the existing finance approval flow. This work does not mark it approved or paid.
- Hosted migration-ledger reconciliation/application, authenticated hosted JWT/RLS checks, independent database-session contention, physical receipt trials, and operator UAT have not been established by these local checks.
- The Vendors overview and shared operational links expose purchasing; `/vendors/purchasing/database` exposes all records beyond the overview limits.
- Exact retry retention is local to the mounted form; closing the browser does not preserve its pending request. PDF/image OCR, supplier return stock movements and acceptance/rejection reversals are outside this delivery.

## Manual review checklist

- Create a PO for an active supplier, issue it, and verify the displayed supplier/line snapshots.
- Record a short delivery with accepted, rejected, and held portions; verify remaining ordered and accepted quantities.
- Upload a text or CSV invoice, correct uncertain vendor, PO, line, tax, freight, discount, and total fields, then review the exact source version.
- Verify an insufficient accepted receipt or rate/amount discrepancy stays unmatched and cannot post.
- Record enough accepted quantity and rematch; verify the bill can create only one pending-approval expense.
- Retry the same request and source upload; change payload under the same retry key; try a normalized duplicate invoice number/date; verify idempotent reuse or explicit rejection as applicable.
- Open page two of the database, reopen its selected PO and supplier source, then change a matched draft and verify posting requires a fresh review. Simulate a lost response and verify the saved request is retried without changed quantities or identity.

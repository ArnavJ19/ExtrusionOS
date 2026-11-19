# Autopilot invoice, TDS and offline queue corrections

Implemented in the root `feat/autopilot-batch-10` checkout with the user's explicit
checkout approval. Existing unrelated changes were preserved. This record covers
local implementation and verification, not a hosted database or frontend release.

## Behavior

- New invoices capture buyer city and PIN in `customer_snapshot` through the
  production `private.snapshot_invoice_parties()` trigger. Supplier contact keys,
  company-scoped lookups, insert-time capture and subsequent immutability remain.
- Existing snapshots are not updated or filled from current customer masters.
  Accounts can expand **Complete buyer city and PIN** in the e-invoice queue,
  verify the original issued tax invoice, and record its missing locality with
  an evidence reference. A separate immutable confirmation records the employee
  and timestamp. The export uses it only for missing fields. Captured values,
  invoice identity and the original snapshot remain unchanged. Repeated identical
  confirmations are idempotent; conflicting confirmations are rejected.
- An invoice already exported or assigned an IRN cannot receive a new address
  confirmation. Its existing submission requires accounts review. Nonempty
  invalid captured values and other missing party/line fields still fail normal
  validation and require the appropriate reviewed invoice correction.
- Tally sources identify TDS from the company-scoped `tds_deductions` receipt
  links, covering existing pending deductions as well as new records. A TDS
  deduction exports as a Journal: debit the mapped **TDS receivable** ledger and
  credit the customer against the original invoice references. Without the
  mapping, it remains pending with an actionable explanation. Ordinary bank and
  cash receipts retain their existing behavior.
- Previously exported TDS vouchers are not automatically reopened, reversed or
  changed in Tally. Accounts must reconcile any incorrect prior Bank posting
  before using the existing reviewed re-export route.
- Offline transports declare their supported entry kind. Flushing, pending counts
  and conflict resolution are scoped to that kind and company/user. Unsupported
  entries retain their original pending state, request ID, payload and attempts.
  They retry from their matching screen; this does not reopen older conflicts.

## Database and security

Apply these additive migrations in order with the frontend release:

1. `supabase/migrations/20261117120000_einvoice_buyer_snapshot_repair.sql`
2. `supabase/migrations/20261117121000_tds_tally_receivable.sql`

The confirmation table has company RLS, finance-only read access and no direct
client writes. Its gateway derives company/actor from the authenticated session,
locks the invoice, validates the issued state and forbids replacing frozen data.
The original gateway implementations are retained privately with all anonymous
and authenticated execution revoked. TDS mapping uses the existing accounts role
check, ledger validation and company-owned ledger map. No RLS is disabled and no
invoice, receipt, payment or export history is backfilled or deleted.

## Change inventory

Created the two migrations above, this report, and:

- `tests/autopilot-integrity.test.mjs`
- `tests/autopilot-invoice-tds-sql.test.mjs`
- `tests/offline-transport-browser.test.mjs`

Modified runtime files:

- `lib/offline/queue.ts`
- `components/modules/offline/offline-core.tsx`
- `components/modules/offline/offline-queue.tsx`
- `lib/integrations/tally-xml.ts`
- `lib/dispatch-autopilot/commands.ts`
- `components/modules/dispatch-autopilot/tally.tsx`
- `lib/autopilot-batch6/commands.ts`
- `lib/compliance/e-invoice.ts`
- `components/modules/autopilot-batch6/einvoice.tsx`

Updated `tests/autopilot-batch6.test.mjs`,
`tests/autopilot-batch6-browser.test.mjs` and
`tests/invoice-supplier-snapshot-contact.test.mjs` for the queue API, historical
confirmation flow and latest snapshot writer.

## Verification

| Check | Local result |
| --- | --- |
| Focused unit, SQL and browser regression run | 33 passed, 0 failed |
| `node scripts/replay-migration-chain.mjs` | 313/313 baseline and migration files applied, 0 failures |
| `npm run lint` | Passed on retry; the initial scan encountered a disappearing unrelated `.fs4-parse.tmp.mjs` file |
| ESLint on all changed source and test files | Passed on the final files |
| `npm run typecheck` | Passed on the final files |
| `npm run build` | Passed on the final files |
| `npm test` | Completed: 3,753 tests, 3,688 passed, 65 failed; 76 suites |

Logs are `.tmp-autopilot-integrity-final-focused.log`,
`.tmp-autopilot-integrity-lint-retry.log`,
`.tmp-autopilot-integrity-changed-lint.log`,
`.tmp-autopilot-integrity-typecheck-final.log`,
`.tmp-autopilot-integrity-build-final.log` and
`.tmp-autopilot-integrity-full-test.log` in the project root.

The full run is not green. All 65 failures are in other browser suites:

| Suite | Failed checks | Cause |
| --- | --- | --- |
| `autopilot-batch7-browser.test.mjs` | 1 | AP-079's unscoped status locator matched two "Recorded as sent." messages |
| `collaboration-workflows-browser.test.mjs` | 8 | Fixture build could not resolve `@opentelemetry/api` |
| `commercial-upgrade-browser.test.mjs` | 10 | Same fixture dependency |
| `entry-acceptance-integration.test.mjs` | 8 | Same fixture dependency |
| `in-task-customer-browser.test.mjs` | 9 | Same fixture dependency |
| `operator-workflows-browser.test.mjs` | 12 | Same fixture dependency |
| `quote-paste-browser.test.mjs` | 3 | Same fixture dependency |
| `upgrade-workflow-browser.test.mjs` | 14 | 13 dependency failures plus cleanup calling `.close()` on an uninitialized fixture |

An isolated rerun of both AP-079 statement browser cases passed. An isolated
collaboration browser case reproduced the unresolved dependency. See
`.tmp-autopilot-integrity-unrelated-rerun.log`. These paths and the dependency
configuration were not changed for the three requested fixes. None of the
invoice/TDS/offline regressions failed in the full run.

Regression coverage includes the real production invoice writer and issuance,
master-data drift, immutable original snapshots, partial locality confirmations,
formatted captured PINs, exported invoices, idempotency, finance authorization,
cross-company isolation and revoked private gateway access. A real TDS record is
tested through source classification, missing mapping, Journal XML and one-time
export recording. Browser tests exercise both real queue hooks with IndexedDB,
screen changes, full reloads, connection failure and reconnection. Finance screen
tests run at 375px and 1280px, including the expanded confirmation form.

## Hosted acceptance checklist

- Create and issue an invoice for a buyer with complete master data; verify its
  frozen city/PIN and the downloaded e-invoice JSON.
- Confirm locality on an older issued invoice from its original document. Verify
  the confirmation author/reference and the unchanged invoice snapshot.
- Record a TDS deduction, verify the missing-ledger explanation, map TDS
  receivable, and review a test import in the business's Tally company.
- Queue a measured bundle offline, visit loading/press/QC, and then return to
  bundle capture after reconnection. Repeat in the opposite direction and verify
  each physical observation is recorded once.

Hosted migrations, signed-in hosted browser acceptance, actual IRP submission,
Tally import acceptance and physical factory reconciliation were not performed.

# Astra audit remediation

Date: 2026-09-30.

Scope: the eight findings and five additional issues supplied in the attached
goal objective. `Audit_Astra_1.md` was not present in the checkout; the attached
objective supplied the complete finding list. Existing worktree edits were
preserved. No remote database, deployment, commit, or PR was changed.

## Requirement-by-requirement evidence

| Finding | Implemented change | Local verification |
| --- | --- | --- |
| 1. Stock over-reservation | Reservation trigger locks the stock batch, checks all active reservations, validates company/profile/order lineage, and derives reserved length. Stock changes cannot reduce capacity below active reservations. | SQL rejects 160 kg against 100 kg, rejects increasing one reservation beyond capacity, rejects lowering reserved stock, and rejects another company's batch. Independent-session contention is not tested. |
| 2. Role bypasses | Replaced permissive configurator, output/library, and reservation policies with explicit tenant-and-role policies. Viewer cannot mutate configurations or release stock. App sales write controls now match the existing intended manager restriction. | SQL runs updates as the non-owner `authenticated` role with viewer/sales application identities; both writes affect zero rows. Direct save RPC is denied. Tests verify anonymous RPC denial and private helper privileges. |
| 3. Production source lineage | Handoff resolves a source line only when exactly one matching order/profile line exists. Duplicate-profile lines require explicit selection in the handoff form. The RPC validates the selected line and persists `source_line_id`. | SQL installs the production lineage trigger, rejects ambiguous and foreign selections without leaving jobs behind, and succeeds with both explicit and unique source lines. |
| 4. Packing GST override | Packing GST is derived from the commercial order/quote line. Invoice GST no longer falls back to packing-entered GST. | SQL attempts to substitute 0% for an 18% order and confirms 18% in packing/invoice output. A legitimate 0% commercial rate remains 0%. |
| 5. Partial recalculation | Draft updates and calculation replacement use one authorized database RPC and transaction. It locks the configuration, verifies its version for recalculation, replaces all collections, invalidates optimization runs, and updates totals atomically. | SQL rejects an invalid cut and a later hardware insert, preserving earlier cuts and header values. It rejects stale saves and foreign references; valid draft reset clears outputs and totals together. |
| 6. Prefix metacharacters | Allocation compares a literal prefix/year stem; only the numeric suffix uses a regular expression. Existing transaction lock and tenant scoping remain. | SQL verifies sequential allocation for `Q+`, `A.B`, `X[1]`, a backslash prefix, `(Q)`, and `Q$`, plus rollover beyond 9999. |
| 7. Historical invoice identity | Supplier and customer identity/address/GST snapshots are captured on invoice creation, then immutable. PDF loading reads only snapshots. | SQL changes supplier/customer masters and confirms the invoice snapshots remain identical; snapshot overwrite fails. Existing invoice PDF-generation tests pass. |
| 8. Hardware versus custom glass | Default gasket and wool-pile quantities use generated glass cuts and their quantities. Explicit hardware formulas retain precedence. | Unit tests verify 4.2 m for the supplied geometry, 12.6 m for three units, and no invented perimeter after a glass formula error. |
| 9. Configuration numbering | Configuration inserts use the central locked allocator; client max-plus-one numbering was removed. Numbers are immutable. | SQL verifies unique generated numbers despite forged input, rollback behavior, and rejected renumbering. |
| 10. Production-linked draft reset | Database lifecycle and output guards prevent unlinking, draft reset, recalculation, output mutation, or deletion of linked configurations. Edit/calculation controls explain the lock. Quote-linked configurations are protected as well. | SQL rejects reset/unlink, recalculation, child deletion, and parent deletion. |
| 11. Mixed profile stock lengths | Each cut carries its stock length; allocation groups by profile and stock length. Aggregate waste uses actual stock lengths. UI/PDF show the applicable lengths. | Unit tests cover 3 m/6 m stock, rejected oversized cuts, weighted waste, and distinct lengths for the same profile. |
| 12. Foundry number overwrite | The old foundry calculation trigger retains its calculations but no longer writes the business identifier. | SQL runs the allocator and foundry trigger together and confirms furnace/date edits preserve the allocated number. |
| 13. Completed finishing edits | Terminal finishing weights and evidence are immutable, including completed jobs. | SQL performs the planned-to-in-process-to-completed sequence, then rejects changes to all three weight fields and reopening. |

## Files and migration

New files:

- `supabase/migrations/20260930000000_astra_audit_fixes.sql`
- `sql/astra-integrity.sql`
- `scripts/build-astra-migration.mjs`
- `scripts/test-astra-sql.mjs`
- `tests/astra-calculation-regressions.test.mjs`
- This report.

Modified for this audit:

- `lib/systems-configurator/actions.ts`
- `lib/systems-configurator/formula-engine.ts`
- `lib/systems-configurator/hardware-engine.ts`
- `lib/systems-configurator/profile-optimization.ts`
- `lib/auth/permissions.ts`
- `lib/pdf/systems-configurator-pdf.ts`
- `app/api/pdf/invoice/[id]/route.ts`
- `app/(dashboard)/systems-configurator/projects/[id]/page.tsx`
- `app/(dashboard)/systems-configurator/projects/[id]/edit/page.tsx`
- `app/(dashboard)/systems-configurator/projects/[id]/optimization/page.tsx`
- `scripts/test-business-logic-sql.mjs` (optional `--astra` follow-up).

The generated migration is reproducible with
`node scripts/build-astra-migration.mjs`. It depends on the existing production
lineage and 20260929 business-logic migrations. Historical migrations were not
edited. RLS remains enabled; no service-role browser access was added. The save
RPC derives identity/company on the server, checks manager roles, fixes its table
list, strips identity overrides, and validates referenced tenants.

## Checks

- `npm test`: 626 passed, zero failures/skips. Output: `.astra-tests.log`.
- `npm run lint`: passed, zero warnings/errors after repairs.
- `npm run typecheck`: passed.
- `npm run build`: passed on the final source, including TypeScript and all 153 static pages.
- `git diff --check`: passed; Windows line-ending notices only.
- `node --no-warnings --experimental-strip-types scripts/test-business-logic-sql.mjs --astra`:
  12 prior SQL checks plus 13 Astra checks passed in isolated PGlite PostgreSQL.
  This uses actual migration functions and triggers with a focused fixture schema;
  it is not a replay of the complete Supabase migration history.

Node test workers initially hit sandbox `spawn EPERM`; the full suite passed with
worker-process permission. Docker was unavailable. Automatic approval review
could not authorize engine startup because its usage limit was reached, and the
startup command was not executed. The user subsequently instructed "No Docker";
no further Docker startup or test was attempted.

## Release and manual checks

Apply the pending prerequisite migrations and this follow-up in staging before
deploying the application code. The local application now calls the new save RPC
and reads the new invoice snapshot columns.

1. Under viewer and sales roles, confirm unavailable write controls and rejected
   direct mutations. Under a sales manager, calculate and revise an unlinked draft.
2. Reserve the same batch concurrently from two sessions and confirm total active
   reservations cannot exceed capacity. Try reducing a reserved batch's weight.
3. Hand off an order with duplicate profile lines; select the exact line and
   inspect the resulting production job. Confirm linked configurations cannot reset.
4. Inspect a custom-glass BOM and mixed-stock optimization/PDF with an operator.
5. Generate an invoice, change party masters, and verify a re-download retains
   the original parties. Confirm legitimate zero GST and ordinary GST sources.
6. Edit a foundry furnace and confirm the batch number is stable. Attempt to edit
   completed finishing weights and confirm rejection without downstream changes.

Not verified: live/staging migration application, full-schema replay, real
Supabase role/JWT behavior, independent-session concurrency, authenticated browser
UAT, or deployment. These are release gates, not claims supported by local tests.

Legacy invoices lack trustworthy historical party snapshots. Their new PDF route
returns HTTP 409 and directs users to the original issued document; today's master
records are not backfilled as historical facts. Existing incorrect reservations,
numbers, tax records, and quantities are not silently rewritten. Any historical
data repair needs evidence and a separate reviewed correction.

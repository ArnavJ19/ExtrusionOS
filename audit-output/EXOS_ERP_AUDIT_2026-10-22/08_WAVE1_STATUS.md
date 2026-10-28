# Wave 1 status — EXOS-AUD2-001, 004, 005, 006, 007 (22 October 2026)

Branch `audit2/wave1` (worktree `.worktrees/audit2-wave1`). **The four migrations are applied to hosted (22 October 2026, ledger 133). The 004 app half is not deployed yet.**

## 007 — Hosted migrations now in git

Commit `1ff7586` on `codex/v1` (not pushed) adds the five migrations that hosted had applied but git did not have:

- `20261020090729_priority_billet_allocation_integrity`
- `20261020120000_invoice_supplier_snapshot_contact`
- `20261020142106_posted_reservation_delivery_lifecycle`
- `20261020162949_production_billet_material_normalization`
- `20261022010000_fk_covering_indexes_and_rls_initplan`

It also adds three of their test files, which pass on a clean checkout. The tests `posted-reservation-delivery` and `production-billet-normalization` were left uncommitted: 5 of their checks depend on uncommitted changes in `lib/actions/production.ts` and `sql/audit-deployment-preflight.sql`, which belong to other work in the `codex-v1` worktree.

**Still open for 007:**

- `20261022020000_ai_provider_and_report_source_checks` (hosted ledger `20261022014811`) exists only as an untracked file in the main checkout on `fix/migration-chain-replay`, owned by the migration-replay session. The harness keeps a copy as a fixture (`harness/hosted-fixtures/`).
- Add a CI check comparing the hosted ledger with `supabase/migrations`.

## Candidate migrations (not applied)

| Finding | File | Change |
| --- | --- | --- |
| 001 | `20261022100000_dispatch_delete_lifecycle_guard.sql` | `BEFORE DELETE` guard: a user session can delete a dispatch only while it is `pending`, has no `actual_dispatched_at` and has no invoice (active or cancelled) |
| 005 | `20261022110000_operational_history_retention.sql` | User sessions cannot delete breakdown, calibration, die trial, die correction, maintenance schedule or energy rows. Each refusal names the correction path. Adds `private.audit_row_change()` (old and new values, changed fields only, errors not swallowed) on those tables and on spare-part usage |
| 006 | `20261022120000_profile_master_delete_restrict.sql` | Profile FKs from stock batches, reservations, consumptions, QC, packing rows, spec approvals and material dispositions changed from CASCADE/SET NULL to NO ACTION. A delete guard names the dependency and says to deactivate instead |
| 004 | `20261022130000_metal_source_disposition.sql` | `public.set_metal_source_disposition(table, id, hold\|release\|return, reason)`; client status writes blocked; `metal_source_dispositions` log; returns post `purchase_return` and record the credit due; row audit on both source tables |

**App half of 004:**

- **Status field:** the record form's lot status is read-only ("changed through Lot disposition").
- **Lot disposition panel:** the scrap and external-source detail pages offer *Put lot on hold*, *Release lot* and *Return to vendor* through `runErpControlAction("metal_source_disposition")`.

Changed files: `lib/workflow/erp-control-roles.ts`, `lib/actions/erp-controls.ts`, `lib/workflow/erp-control-panels.ts`, `components/modules/operations/module-config.ts` and the two `app/(dashboard)/foundry/*/[id]/page.tsx` pages.

## Behaviour decisions taken (confirm or change)

- **Dispatch delete:** a dispatch with a *cancelled* invoice is also undeletable, so invoice history keeps its dispatch.
- **Lot release:** release needs quality, factory manager, admin or owner, and cannot be done by the person who placed the hold (owner excepted). This mirrors chemistry approval.
- **Release limit:** a lot above `metal_receipt_max_kg` cannot be released until its weight is corrected. This keeps hosted `EAS-2026-0003` (100,000 t) held.
- **Return to vendor:** a return covers the whole unused balance and is final. The payable is **not** changed automatically. The disposition records `credit_due_amount` (unused kg × rate, before tax and freight) against the bill, and accounts settle it through the existing supplier-credit workflow.
- **Pending dispatches:** a pending dispatch that never left the plant can still be deleted by owner/admin.

## Gate

`harness/gate-wave1.mjs` runs every scenario twice:

- **Baseline:** the hosted-identical replica. Its fingerprint matches hosted at ledger 129: fn 394 `3272fbb6…`, pol 603 `7f829dc7…`, trg 325 `3108a74b…`. The defect must reproduce.
- **Candidate:** baseline plus the four candidate migrations. The fix must hold and legitimate flows must still work.

**Result: GATE PASSED, 26/26** (`harness/results/gate-wave1.txt`). There are 8 baseline reproductions and 18 candidate checks.

| Finding | Baseline (hosted today) | Candidate |
| --- | --- | --- |
| 001 | A delivered dispatch was deleted with its packing row and history, and the same 10 kg shipped again. An in-transit dispatch was deleted. | Both deletes are rejected and the re-ship is still capped. A pending dispatch that never left the plant can still be deleted. A dispatch with cancelled-invoice history is kept. |
| 005 | An open breakdown was deleted and the press signed back into service. Calibration, die-correction and PM-schedule records were hard-deleted. | Deletes are rejected and sign-off stays blocked. Resolve-then-sign-off works and is audited (open→resolved, actor production_manager). Cancelling a schedule and correcting a die correction both work and are audited. A spare-part usage reversal still restores stock (7→10). |
| 006 | 696 kg of stock and a 348 kg reservation were erased. | Rejected with "deactivate it instead". Deactivation works. The FK also blocks a service-context delete. A profile with only configuration children is still deletable. |
| 004 | An operator released a rejected lot and charged it. The held 100,000 t lot was set available. A "returned" lot kept 1,000 kg and was flipped back. | The operator flip is rejected and the charge refused. An operator cannot place a hold, and the holder cannot release. A quality release followed by a charge works. The 100,000 t release is refused. A return posts `purchase_return` 1,000 kg, takes inventory to 0, records ₹2,00,000 credit due and is final. A partly charged lot returns only its unused 1,080.620 kg. Weight corrections still work and are audited. In-house scrap can be held but not returned. |

The gate caught two defects in the candidates before this pass:

- `audit_logs_enterprise.previous_value` is NOT NULL, so insert and delete audits failed.
- The return path did not post inventory. The RPC did not name `available_weight_kg` in its `UPDATE`, so the `AFTER UPDATE OF available_weight_kg` posting trigger never fired.

**Other checks (worktree `audit2-wave1`):**

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `eslint` on changed files | Pass |
| `npm test` | 1,968/1,969. The single failure was a 5 s `page.goto` timeout in `tests/entry-acceptance-integration.test.mjs` (quotation paste, unrelated) while another session's build loaded the machine; run alone, the file passes 6/6. |
| `npm run build` | Not run |


## Hosted dry run (22 October 2026, rolled back)

| Step | fn | pol | trg | Notes |
| --- | --- | --- | --- | --- |
| Hosted before | 394 `3272fbb6…` | 603 `7f829dc7…` | 325 `3108a74b…` | Ledger 129. Identical to the gate baseline. |
| Candidate replica (local) | 400 `79e71dbb…` | 604 `44294787…` | 344 `9db550cb…` | Baseline plus the four candidates. |
| Hosted, inside the dry-run transaction | 400 `79e71dbb…` | 604 `44294787…` | 344 `9db550cb…` | **Identical to the candidate replica.** All 7 re-created profile FKs validated against hosted data (NO ACTION). `metal_source_dispositions` = 0. |
| Hosted after | 394 `3272fbb6…` | 603 `7f829dc7…` | 325 `3108a74b…` | Ledger 129. `metal_source_dispositions` does not exist. The `profile_stock_batches` FK is still CASCADE. Nothing persisted. |

The dry run was the four files concatenated with their `begin;`/`commit;` lines removed. They ran inside an explicit `begin`, and a final `DO` block raised `DRYRUN OK …` to force the rollback. The script is `20261022100000…130000` exactly as committed in `f84ff70`.

## Applied to hosted (22 October 2026)

Pre-check: hosted was still fn 394 `3272fbb6…`, pol 603 `7f829dc7…`, trg 325 `3108a74b…` at ledger 129.

The files were applied in order with `apply_migration`, without `begin;`/`commit;`:

| Ledger version | Migration |
| --- | --- |
| `20261022023509` | `20261022100000_dispatch_delete_lifecycle_guard` |
| `20261022023534` | `20261022110000_operational_history_retention` |
| `20261022023553` | `20261022120000_profile_master_delete_restrict` |
| `20261022023639` | `20261022130000_metal_source_disposition` |

Post-check:

- **Fingerprint:** fn 400 `79e71dbb…`, pol 604 `44294787…`, trg 344 `9db550cb…`. This is **identical to the dry run and the gated candidate replica**. The ledger now has 133 rows.
- **Profile FKs:** all 7 are validated with NO ACTION.
- **Disposition RPC:** `set_metal_source_disposition` can be executed by `authenticated` and not by `anon`.
- **Security advisor:** the only new entry is `set_metal_source_disposition` in the existing "authenticated may execute a SECURITY DEFINER RPC with an internal role check" class (82 entries). There are no new RLS, view or anon findings.

**Open:**

- **App deploy:** deploy the 004 app half (this branch's app changes). Until then, the old record form still offers an editable lot status. The database refuses any status change there with "Lot status changes through the lot disposition…", and there is no UI to hold, release or return a lot.
- **Merge:** `audit2/wave1` is not merged into `codex/v1` or `main`, and nothing is pushed.

## Before applying to hosted (completed)

1. Re-fingerprint hosted. It must still equal fn 394 `3272fbb6…`, pol 603 `7f829dc7…` and trg 325 `3108a74b…`. If it doesn't, rerun the dry run.
2. Apply 100000 → 110000 → 120000 → 130000 without `begin;`/`commit;`. The dry run above has already been done.
3. Deploy the app half of 004 at the same time as `20261022130000`. Without it, the record form still shows an editable status, which the database now refuses.
4. After applying, fingerprint the objects again and rerun the gate in `GATE_POST_APPLY` style against a fresh dump.

# Report 6 — Remediation Roadmap (pass 2)

## Wave 1 — Immediate integrity and operational risks

| Finding | Change | Migration / reconciliation | Regression risk |
| --- | --- | --- | --- |
| 007 | Commit the 5 hosted-applied migrations; add a CI ledger-vs-repo check | None on hosted | None |
| 001 | `BEFORE DELETE` guard on `dispatches` (reject unless `pending` with no activation); `dispatch_status_history` FK → `RESTRICT` | Additive | Low. Pending-dispatch cleanup still works |
| 005 | Remove the DELETE policies on breakdown, calibration, die correction/trial, maintenance schedule and energy tables; add a void RPC; sign-off requires the latest breakdown to be resolved | Additive plus policy drops | Low. The UI has no delete buttons for these |
| 006 | Transactional FKs to `aluminium_profiles` and `customers` → `RESTRICT`; server-side reference check | FK swap, after checking for orphans | Low |
| 004 | Source disposition RPC (quality/factory manager/owner, reason, audit); `returned` posts an inventory issue and a supplier credit; block client `status` writes | Reconcile hosted `EAS-2026-0002` (returned, still available) | Medium. Changes the foundry source UI |

## Wave 2 — Manufacturing corrections

| Finding | Change | Notes |
| --- | --- | --- |
| 002 | Mass balance on `issued` billets; completion releases unissued allocated billets | Repair J-2026-0001 (issue or release its 15 billets) before go-live |
| 003 | Reconcile the cast result against the charge; `melt_loss ≥ 0`; dross required above a threshold | — |
| 009 | Alloy limit table; computed verdict; override needs quality role + reason | Seed 6063/6061/6082 from a recognised standard |
| 018 | Remnant billet model (child of the log, measured weight) | NBD: log vs pre-cut billet |
| 017 | Hold propagation on post-charge rejection | NBD |
| 016 | Hosted data reset or documented repair | NBD; precondition for go-live |

## Wave 3 — Financial, reporting and workflow reliability

| Finding | Change |
| --- | --- |
| 008 | Configurable dispatch weight tolerance; variance recorded and approved |
| 010 | Coating-gain allowance; separate gain and loss fields |
| 011 | Single packaging stock ledger; balance guard |
| 012, 013 | Factory-side discrepancy resolution RPC; receipts create dealer stock batches |
| 014 | Role-scoped storage policies; dealer prefix; versioned POD |
| 020 | Rate required for purchased metal |
| 019 | Replace `current_date` with `business_today()` |

## Wave 4 — Preventive controls

| Finding | Change |
| --- | --- |
| 015 | Generic old/new audit trigger on every business table; stop swallowing audit errors |
| 021 | Delete the dead `MasterDataManager` clients |
| 022 | Link the operator breakdown exception to maintenance |
| IMP-1 | Load-test reports at the 8 s statement timeout |
| — | CI replay of `main` migrations into an empty database, plus a fingerprint diff against hosted |

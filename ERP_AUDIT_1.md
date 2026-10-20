# ERP_AUDIT_1 — ExtrusionOS ERP Audit and Wave 1 Remediation Handover

Session dates: 20–21 October 2026. Branch: `codex/v1` (worktree `.worktrees/codex-v1`). Hosted database: Supabase `pkawmdxtmsdgigsehcmb` (AlExMS).

## 1. At a glance

| Item | Value |
| --- | --- |
| Findings recorded | **33** (EXOS-AUD-001 … 033): **13 P1**, **14 P2**, **6 P3**, plus 7 missing-functionality areas (not counted as bugs) |
| Additional defect found during remediation | Sales users could not convert quotes to orders. Same root cause as 009, fixed with it. |
| **Resolved and applied to hosted** | **9** (8 P1, 1 P2): 002, 003, 007, 008, 009, 010, 011, 012, 019 |
| **Pending** | **24** (5 P1, 13 P2, 6 P3) |
| Resolved findings with follow-up work | 3: 002 (reversal RPC), 008 (return-to-service sign-off), 011 (transport document amendment workflow) |
| Hosted migrations applied this session | **11**. The ledger went from 86 to **97** rows. |
| Commits on `codex/v1` (not pushed) | `5f5463f`, `7ca9bf3`, `57c313a`, `c99459d` |
| Verification | Regression gate: 64/64 locally, 64/64 in the rollout rehearsal, and **39/39 against the hosted catalog after applying**. `npm run lint`, `npm run typecheck`, `npm test` (**1,848/1,848**) and `npm run build` all pass. |

**Verdict at handover:** Wave 1 closed the worst direct-manipulation and blocking defects. ExtrusionOS is still **not fit to be the system of record for metal, billets and finished-goods genealogy** until the remaining P1 findings (001, 004, 005, 006, 013) are fixed.

## 2. What was done this session

1. **Independent business-logic audit.** Repository discovery covered docs, `BUGS-MEGA.md` (to avoid re-reporting R01–R25, the A/B/C/D/F/S series, BL, Astra and finance findings), app routes, server actions and the generic record form. The full live database catalog was read using read-only queries only.
2. **Executable evidence harness.** I built a PGlite replica of the hosted catalog: 3,147 columns, 294 functions, 281 triggers, 582 policies, grants, and 0 load failures. Reproductions ran as the PostgREST `authenticated` role under live RLS. Results: 31 confirmed reproductions, 3 negative controls held, and 1 hypothesis not reproduced.
3. **Audit package** written to `audit-output/EXOS_ERP_AUDIT_2026-10-20/`: executive summary, defect register, cross-module, traceability, coverage, roadmap, regression blueprint, architecture map and remediation status.
4. **Wave 1 remediation**, in four batches. Each batch has a baseline/candidate regression gate: the defect must reproduce on the unchanged snapshot and be fixed on the candidate.
   - Batch 1 (commit `5f5463f`): 009, 002, 003, plus a record-form fix.
   - Batch 2 (`5f5463f`): 008, 011.
   - Batch 3 (`7ca9bf3`): 010, 007.
   - Batch 4 (`57c313a`): 012, 019.
5. **Hosted application** at the user's instruction (21 October). Eleven migrations were applied in filename order: the parallel session's three candidates, then the eight Wave 1 migrations. Before applying, I rehearsed all 11 together on the replica. After applying, I took a fresh catalog capture and checked it. Hosted business data was confirmed unchanged: 10 orders, 48 billets, 13,711.728 kg, and identical foundry source balances.
6. **Evidence commit** `c99459d`: the post-apply hosted snapshot, the new gate options, and the results.

## 3. Resolved findings (applied to hosted)

| ID | Sev | Defect | Fix | Migration |
| --- | --- | --- | --- | --- |
| 009 | P1 | Dispatch, dispatch_manager and inventory_manager users could not record any delivery status; sales could not convert quotes. The billet-allocation role guard vetoed every order-stage change. | Requirements are still rebuilt for everyone. Auto-allocation runs only for system calls and factory roles; for anyone else it is deferred. | `20261021000000_order_stage_allocation_side_effect.sql` |
| 002 | P1 | Any user could insert process scrap and create clean, available furnace metal, and it could not be corrected. | Client inserts into `scrap_records` closed (policy dropped, grants revoked). The recovery trigger requires a same-company job. | `20261021010000_scrap_and_foundry_source_write_guards.sql` |
| 003 | P1 | Foundry source availability was hand-editable. Editing a used scrap lot restored its full weight. | Guard trigger: receipts start fully available; client availability is ignored on edit and moves only with a weight correction; weight below the charged quantity is rejected; status follows the balance. CHECK constraint `available ≤ weight` (NOT VALID). | same, plus `components/modules/operations/record-form-client.tsx` |
| 008 | P1 | Any user could change press status; sales could reactivate a retired die. | Machines are writable only by owner, admin, factory_manager and production_manager, with a status CHECK (NOT VALID). Die trigger: only managers can make a die usable; operators can take a die out of service only. | `20261021020000_machine_and_die_status_authority.sql` |
| 011 | P1 | Any user could rewrite a shipped dispatch's e-way bill, LR and vehicle, and mark it returned. | Tenant-only policies removed. Status changes go only through the workflow RPC. After activation, transport documents can be filled in once but not changed, and the dispatch date is frozen. | `20261021030000_dispatch_logistics_freeze.sql` |
| 010 | P1 | Reserved-stock dispatch failed in the app, while a direct RPC accepted any order line and price. | Reservation packing rows derive their order line, rate, finish and GST server-side. Client values are overwritten; ambiguous lines are rejected. | `20261021040000_reservation_packing_commercial_lineage.sql` |
| 007 | P1 | One die could run on two presses at the same time. | Slots that overlap on the same die are rejected (with a per-die lock), and a job cannot start while the same die is running. | `20261021050000_die_schedule_exclusivity.sql` |
| 012 | P1 | QC approval ignored results, allowed producer self-approval, and the gate could be switched off by an admin. | Disposition user and time recorded. Approvers limited to owner, admin, quality and factory_manager. Profile weight tolerance and numeric minimum hardness enforced where configured. Only the owner can disable `quality_compliance`. | `20261021060000_quality_release_rules.sql` |
| 019 | P2 | Audit rows could be forged under another user's name. | Direct client inserts into `audit_logs` and `audit_logs_enterprise` are stamped with the session identity. | `20261021070000_audit_log_actor_identity.sql` |

Also applied, from the parallel session (not audit findings):
- `20261020120000_invoice_supplier_snapshot_contact`
- `20261020142106_posted_reservation_delivery_lifecycle`
- `20261020162949_production_billet_material_normalization`

### Follow-ups left on resolved items

- **002:** Add an audited reversal RPC for an erroneous process-scrap posting (retire the derived foundry lot only if it is unconsumed).
- **008:** Add a return-to-service sign-off tied to a resolved breakdown. This needs 027 (FK from maintenance to `machines`).
- **011:** Add an audited amendment RPC to correct a recorded e-way bill or LR number.
- **Data:** Reconcile `SCR-2026-0001` (rejected, 1,000,000 kg, 900 available, 0 charged), `SCR-2026-0002` (`available` while partly charged) and `EAS-2026-0003` (100,000,000 kg). Then `VALIDATE` the three NOT VALID constraints: `foundry_scrap_available_within_weight`, `foundry_external_available_within_weight` and `machines_status_check`.

## 4. Pending findings (24) and how to resolve them

Severity order. All locations are verified in `audit-output/EXOS_ERP_AUDIT_2026-10-20/02_DEFECT_REGISTER.md`, which has full evidence, reproduction steps and line numbers.

### P1 (5 pending)

| ID | Defect | How to resolve | Key locations |
| --- | --- | --- | --- |
| 001 | Casting records *planned* billets (theoretical weight). There is no actual cast count, reject record or post-melt chemistry, and billets are auto-allocated at `cast`. | Add a cast-result step (good count, measured weights, rejects, dross) and a chemistry test entity. Gate `cast → ready` on approved chemistry, allocate only `ready` billets, and add a billet-reject RPC. | `sync_foundry_billets`, `guard_foundry_batch_material_integrity` (`supabase/migrations/20261008000000_foundry_material_integrity.sql`), `handle_available_billet_allocation` |
| 004 | Editing an outsourced billet receipt rewrites consumed billets' alloy and weight; reducing the count or cancelling leaves billets in stock. | Apply the in-house commitment guard to outsourced billets. Have the sync cancel surplus and cancelled-receipt billets, and block the change if any are committed. | `sync_outsourced_billets` (`0055_billet_inventory_and_outsourced_billets.sql:122`); early return in `guard_foundry_billet_material_integrity` (`20261008000000…:335`) |
| 005 | A furnace charge accepts a source of a different alloy; scrap has no alloy. | Add alloy to scrap lots (inherited from the job's billets). Enforce an alloy compatibility matrix in `apply_foundry_source_delta`, with an audited override. | `private.apply_foundry_source_delta` (`20261008000000…:5`) |
| 006 | Production loss is booked 1:1 as clean, available, alloy-less recoverable scrap. | Record completion scrap by category (butt, saw, rejects, unrecoverable). Create foundry lots only from weighed recoverable categories, carrying the alloy, and post an inventory movement. | `complete_production_job_atomic` (`20260718021500…:224`), `sync_process_scrap_to_foundry` |
| 013 | Finished-goods stock batches have no production, heat, alloy or QC origin. | Add origin, job, QC-status, alloy and temper columns. Create batches only from QC-released packaging or an approved opening-stock journal. | `profile_stock_batches` schema; `app/api/dealer-inventory/items/route.ts` |

### P2 (13 pending)

| ID | Defect | How to resolve |
| --- | --- | --- |
| 014 | A job can complete with no billet input; packaging is auto-created. | Require input evidence or an audited exception in `complete_production_job_atomic`. |
| 015 | Cancelling a job strands its issued billets; the job save ignores job status. | Release billets on cancel in `transition_production_job_atomic`; reject saves on terminal jobs. |
| 016 | QC and finishing rejects and returns never become scrap or quarantine; every return credit is 100% of the invoice. | Disposition workflow (quarantine → rework, scrap or sale) and partial credit notes by packing row. |
| 017 | Exposed `public.save_dispatch_atomic` can set an order to `delivered` with nothing shipped. | Revoke EXECUTE (the app uses `save_ready_dispatch_atomic`) or drop `p_order_stage`. **This is the next Wave 1 item.** |
| 018 | Order stage gets stuck after a return or a normal production shortfall. | `sync_order_delivery_stage`: exclude resolved exceptions; add a tolerance or a short-close action. |
| 020 | Die number, profile and production history are editable while the die is running; die KPIs are manual. | Freeze die identity once it has history; derive production kg, runs and last-used date from completed jobs. |
| 021 | Profile master changes apply immediately to open work. | Needs a business decision: versioned profile references, or re-approval of open work. |
| 022 | Inventory ledger and balances are decoupled; negative stock is clamped to 0; foundry charges never decrement inventory. | Make movements the source of truth, restrict inserts to definer RPCs, reject negatives, and post consumption movements. |
| 023 | No accounting period lock; invoices, payments and expenses can be backdated. | Period-close table enforced in all financial writers; payment date on or after the invoice date. |
| 024 | Dealer inventory API always fails (inserts a non-existent `notes` column); `length_m` units conflict. | Fix the column; capture length per piece and store total metres. |
| 025 | Mill-finish dispatch is not capped by packaged kg; returned shipments consume dispatch capacity forever. | Cap by packaged kg; release capacity for returned shipments once the goods are dispositioned. |
| 026 | The quote's per-kg rate doesn't reproduce the quoted value on the invoice (scrap allowance, minimum billing weight, fixed charges). | Needs a business decision on the billing basis; then separate HSN lines for die and freight charges. |
| 027 | Maintenance isn't linked to machines (text `machine_id`); no lifecycle; spare-part usage can't be reversed. | FK to `machines`, a breakdown lifecycle RPC, next-due recompute, downtime intervals and reversible spare-part postings. |

### P3 (6 pending)

| ID | Defect | How to resolve |
| --- | --- | --- |
| 028 | Inconsistent KPI definitions: recovery uses gross output, and dispatch kg includes returns. | One KPI dictionary and a single SQL source for every metric. |
| 029 | No plausibility limits on receipt quantities (a live receipt is 100,000 t). | Configurable maximum and warning band per receipt. |
| 030 | `anon`/`authenticated` hold TRUNCATE and broad DML grants. | `REVOKE TRUNCATE`; revoke `anon` DML on business tables. |
| 031 | Saving the production plan marks billets `issued`. | A separate physical issue step. |
| 032 | "Create Task" route redirects back without creating anything. | Implement it, or remove the button. |
| 033 | Some policies are tenant-only and masked only by grants. | Role-explicit policies and a policy linter in CI. |

### Missing functionality (not counted as bugs)

Purchase order / goods receipt / 3-way match; general ledger, COGS, WIP and inventory valuation; spectrometer chemistry lab records; NCRs and customer complaints; downtime and OEE; customer advances, debit notes and partial credit notes; e-way bill integration.

### Other observation (not fixed)

The machine form offers type `cnc`, but `machine_type_check` and `machineSchema` reject it.

## 5. Decisions needed from the business

1. **QC approvers.** Currently owner, admin, quality and factory_manager. Production managers still see the approve button in the app, but their approvals now fail.
2. **Profile specifications.** Set `weight_tolerance_percent` and a numeric `hardness_requirement` on the profiles that must be checked. Free-text requirements are not parsed.
3. **Reserved stock.** It ships only when the order has exactly one line for that profile, or exactly one line whose finish matches the batch. Review open reservations.
4. **Transport documents.** Shipped e-way bill and LR numbers are now frozen; an amendment workflow is needed.
5. **Allocation timing.** When a non-factory role changes an order's stage, billet allocation now waits for the next factory or foundry event.
6. **Recovery rules** per scrap category (006); **billing basis** (026); **master-data change policy** (021); **period close and backdating** (023).

## 6. How to reproduce and verify

Run from the `codex/v1` worktree root. The harness requires the installed `@electric-sql/pglite` dev dependency.

Original reproductions:

```bash
node audit-output/EXOS_ERP_AUDIT_2026-10-20/harness/repro-01-foundry-scrap.mjs
```

```bash
node audit-output/EXOS_ERP_AUDIT_2026-10-20/harness/repro-02-production-dispatch.mjs
```

Wave 1 regression gate (baseline 20 Oct snapshot against snapshot + migrations):

```bash
node audit-output/EXOS_ERP_AUDIT_2026-10-20/harness/gate-wave1.mjs
```

The same assertions against the hosted capture taken after application:

```bash
GATE_POST_APPLY_DIR=live-20261021 node audit-output/EXOS_ERP_AUDIT_2026-10-20/harness/gate-wave1.mjs
```

**Pattern for the next fix:**
1. Write the repro as a new gate scenario (baseline must show the defect).
2. Write an additive migration.
3. Add it to `WAVE1` in `gate-wave1.mjs`, plus legitimate-flow scenarios.
4. Run the gate, then lint, typecheck, `npm test` and build.
5. Before applying to hosted, rehearse with `GATE_PREFIX_MIGRATIONS` for any other unapplied files.
6. After applying, re-capture the catalog into a new `harness/live-YYYYMMDD/` folder and run with `GATE_POST_APPLY_DIR`.

## 7. Relevant files

| Purpose | Path |
| --- | --- |
| This handover | `ERP_AUDIT_1.md` |
| Audit index and method | `audit-output/EXOS_ERP_AUDIT_2026-10-20/00_README.md` |
| Executive summary and verdict | `audit-output/EXOS_ERP_AUDIT_2026-10-20/01_EXECUTIVE_SUMMARY.md` |
| **Full defect register (evidence, line numbers, fixes)** | `audit-output/EXOS_ERP_AUDIT_2026-10-20/02_DEFECT_REGISTER.md` |
| Cross-module flows A–H | `audit-output/EXOS_ERP_AUDIT_2026-10-20/03_CROSS_MODULE_INTEGRITY.md` |
| Traceability and data-model corrections | `audit-output/EXOS_ERP_AUDIT_2026-10-20/04_TRACEABILITY_REPORT.md` |
| Coverage by module | `audit-output/EXOS_ERP_AUDIT_2026-10-20/05_COVERAGE_MATRIX.md` |
| Remediation waves 1–4 | `audit-output/EXOS_ERP_AUDIT_2026-10-20/06_REMEDIATION_ROADMAP.md` |
| Regression test blueprint | `audit-output/EXOS_ERP_AUDIT_2026-10-20/07_REGRESSION_TEST_BLUEPRINT.md` |
| Architecture and sources of truth | `audit-output/EXOS_ERP_AUDIT_2026-10-20/08_ARCHITECTURE_MAP.md` |
| **Remediation and hosted status** | `audit-output/EXOS_ERP_AUDIT_2026-10-20/09_REMEDIATION_STATUS.md` |
| Harness loader and seed | `audit-output/EXOS_ERP_AUDIT_2026-10-20/harness/live-catalog-db.mjs`, `seed.mjs` |
| Reproductions | `audit-output/EXOS_ERP_AUDIT_2026-10-20/harness/repro-01…05` |
| Regression gate | `audit-output/EXOS_ERP_AUDIT_2026-10-20/harness/gate-wave1.mjs` |
| Saved run outputs | `audit-output/EXOS_ERP_AUDIT_2026-10-20/harness/results/` |
| Catalog snapshots | `harness/` (20 Oct, before remediation); `harness/live-20261021/` (after hosted application) |
| Wave 1 migrations | `supabase/migrations/20261021000000_…` through `20261021070000_…` |
| App change | `components/modules/operations/record-form-client.tsx` (foundry source availability) |
| Earlier finding history (other sessions) | `BUGS-MEGA.md`, `docs/BUGS_MEGA_*` |

## 8. Repository and hosted state at handover

- `codex/v1` holds four new commits from this session (`5f5463f`, `7ca9bf3`, `57c313a`, `c99459d`). They are **not pushed**, and `main` is **not fast-forwarded**. AGENTS.md workflow: verify on `codex/v1`, then fast-forward `main`.
- The parallel session's uncommitted PDF and acceptance work in the same worktree was left untouched and is not in these commits.
- Hosted ledger: **97 rows**; latest `20261021070000_audit_log_actor_identity`.
- **Coordination:**
  - `BUGS-MEGA.md` (owned by the parallel session) still lists `20261020120000`, `20261020142106` and `20261020162949` as unapplied. They are now **applied**; tell that session so it doesn't re-apply or re-plan them.
  - The parallel session's `scripts/run-local-reservation-invoice-acceptance.mjs` supplies `order_item_id` and `net_rate` itself. After 010, the database overwrites those values from the reservation's order line, so that check must expect the order-line rate.
- **Not verified this session:** real JWT and browser UI journeys, multi-session races (locks were reviewed only), PDFs, expenses (relied on the 20 Oct finance remediation), and historical or physical data accuracy (the hosted database holds test data only).

## 9. Recommended next steps

1. **017** — revoke the low-level dispatch RPC. This is the last small Wave 1 item.
2. **004** — guard outsourced billets (P1, small and contained).
3. Reconcile the three drifted foundry rows, then validate the NOT VALID constraints.
4. Close the follow-ups on 002, 008 and 011.
5. **Wave 2:** 001, 005, 006 and 013 (casting results, alloy segregation, scrap categories, finished-goods origin). These change the data model and need product sign-off first.
6. Push `codex/v1`, fast-forward `main`, and deploy the app, so the record-form fix and future UI changes match the hosted database.

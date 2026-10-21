# ERP_AUDIT_1 — ExtrusionOS ERP Audit and Remediation Handover (Waves 1 and 2)

Session dates: 20–21 October 2026. Branch: `codex/v1` (worktree `.worktrees/codex-v1`). Hosted database: Supabase `pkawmdxtmsdgigsehcmb` (AlExMS).

## 1. At a glance

| Item | Value |
| --- | --- |
| Findings recorded | **33** (EXOS-AUD-001 … 033): **13 P1**, **14 P2**, **6 P3**, plus 7 missing-functionality areas (not counted as bugs) |
| Additional defects found during remediation | (1) Sales users could not convert quotes to orders (same root cause as 009, fixed with it). (2) A furnace batch charged from only one source type failed with "record v_new is not assigned yet" (fixed in `20261021290000`). |
| **Resolved and applied to hosted** | **33 of 33.** Wave 1 (9): 002, 003, 007, 008, 009, 010, 011, 012, 019. Wave 2 (24): 001, 004, 005, 006, 013, 014, 015, 016, 017, 018, 020, 021, 022, 023, 024, 025, 026, 027, 028, 029, 030, 031, 032, 033 |
| **Pending** | **None.** Two related extras are listed as not done in §3 (separate die/freight invoice lines; quote PDF rate). |
| Follow-ups on Wave 1 items | All three closed: 002 reversal RPC, 008 return-to-service sign-off, 011 transport-document amendment |
| Live data reconciliation | Done: SCR-2026-0001/0002 and EAS-2026-0003 put on a 'rejected' hold with a note; the three NOT VALID constraints are now **validated** |
| Hosted migrations applied | Wave 1: 11 (ledger 86 → 97). Wave 2: **24** (ledger 97 → **121**). |
| Commits on `codex/v1` (not pushed) | Wave 1: `5f5463f`, `7ca9bf3`, `57c313a`, `c99459d`. Wave 2: `2a77d28` (migrations + harness), `853c4dc` (app entry points), `45964ae` (docs/evidence), plus the 026 commit |
| Verification | Wave 2 gate **78/78** (73 + 5 for 026) (baseline reproduces each defect; candidate fixes it and legitimate flows still work). Wave 1 gate re-run with Wave 2 layered on: 62/64; the 2 differences are intended behaviour changes (see §6). Reconciliation rehearsal passed. **Hosted fingerprint after apply is byte-identical** to the gated state (94 functions, 33 triggers, 27 policies, plus the 3 functions of 026). `npm run lint`, `npm run typecheck` and `npm run build` pass; `npm test` **1,991** tests, 1,990 pass in the full run and the one failure (a Playwright browser test with a 5 s timeout, run while two gates loaded the machine; file untouched) passes 6/6 when re-run alone. |

**Verdict:** all 33 findings are fixed and applied. The metal, billet and finished-goods genealogy defects that made ExtrusionOS unfit as the system of record (001, 004, 005, 006, 013) are fixed in the database and exposed in the app. What remains is the behaviour changes in §5 that users must be told about, deploying the app, and the checks in §8 that were not possible here (real browser journeys, concurrency).

## 2. What was done

1. **Independent business-logic audit** (20 Oct). Full read of docs, `BUGS-MEGA.md` (to avoid re-reporting), routes, actions and the live catalog (read-only).
2. **Executable evidence harness**: a PGlite replica of the hosted catalog running reproductions as the PostgREST `authenticated` role under live RLS.
3. **Audit package** in `audit-output/EXOS_ERP_AUDIT_2026-10-20/`.
4. **Wave 1** (9 findings), applied to hosted on 21 Oct. Details in `09_REMEDIATION_STATUS.md`.
5. **Wave 2** (24 findings including 026 + 3 follow-ups + 1 extra defect + data reconciliation), 21 Oct:
   - 24 additive migrations `20261021080000` … `20261021310000` (commits `2a77d28` and the 026 commit).
   - Regression gate `harness/gate-wave2.mjs`: 78 checks on the post-Wave-1 hosted snapshot `harness/live-20261021/`. `GATE_TRACE=1` prints every rejection so a permission error cannot pass as an expected refusal; all rejection messages were reviewed.
   - App entry points for every new workflow (commit `853c4dc`): a shared ERP control panel on production, order, dispatch, quality, finishing, foundry batch/billet/scrap/external source, machine, inventory, reservation and profile detail pages; categorised scrap on production completion; maintenance workspace with machine selection and breakdown resolution; books-lock and receipt-limit settings; a real Create Task page (032); dealer inventory route fix (024); KPI fixes in the command centre (028) with `docs/KPI_DICTIONARY.md`.
   - Applied to hosted one by one in filename order, each with its `begin;`/`commit;` lines removed (the tool supplies the transaction); bodies otherwise identical to the repo files.

## 3. Status of every finding

### Resolved and applied to hosted — Wave 1

| ID | Sev | Fix | Migration |
| --- | --- | --- | --- |
| 009 | P1 | Billet auto-allocation runs only for system calls and factory roles; others defer instead of failing. | `20261021000000_order_stage_allocation_side_effect` |
| 002 | P1 | Client inserts into `scrap_records` closed; recovery needs a same-company job. | `20261021010000_scrap_and_foundry_source_write_guards` |
| 003 | P1 | Foundry source availability is server-maintained; status follows the balance. | same |
| 008 | P1 | Machines writable only by managers (status CHECK); only managers make a die usable. | `20261021020000_machine_and_die_status_authority` |
| 011 | P1 | Dispatch status only via workflow RPC; transport documents set-once after activation. | `20261021030000_dispatch_logistics_freeze` |
| 010 | P1 | Reserved-stock packing rows derive order line, rate, finish and GST server-side. | `20261021040000_reservation_packing_commercial_lineage` |
| 007 | P1 | Same-die overlapping slots and concurrent starts rejected. | `20261021050000_die_schedule_exclusivity` |
| 012 | P1 | QC disposition stamped; approver roles; weight/hardness spec enforced; only owner disables the gate. | `20261021060000_quality_release_rules` |
| 019 | P2 | Direct audit-log inserts stamped with the session identity. | `20261021070000_audit_log_actor_identity` |

### Resolved and applied to hosted — Wave 2

| ID | Sev | Fix | Migration (`20261021…`) | App entry point |
| --- | --- | --- | --- | --- |
| 017 | P2 | `public.save_dispatch_atomic` no longer executable by clients; the app's `save_ready_dispatch_atomic` derives the order stage. | `080000_close_low_level_dispatch_rpc` | — |
| 004 | P1 | Outsourced receipts cannot rewrite committed billets; reduced count / cancel retires only uncommitted billets; cancel blocked while any is committed. | `090000_outsourced_billet_commitment_guard` | — |
| 015 | P2 | Cancelling a job releases its allocated/issued billets (back to the order or to stock); saves on completed/cancelled jobs rejected. | `100000_production_cancel_billet_release` | — |
| 030 | P3 | TRUNCATE revoked from anon/authenticated; anon DML revoked; default privileges tightened. | `110000_revoke_client_truncate_and_anon_writes` | — |
| 018 | P2 | Returned/damaged shipments are closed exceptions; company delivery tolerance (default 0); audited short-close RPC. | `120000_order_delivery_stage_resolution` | Order page panel; Settings |
| 020 | P2 | Die number/profile frozen once used; usage KPIs derived from completed jobs (opening balances kept). | `130000_die_identity_and_derived_usage` | Die form: totals owner/admin only |
| 025 | P2 | Mill-finish dispatch capped by packaged kg. | `140000_dispatch_packaged_weight_cap` | `lib/actions/dispatches.ts` |
| 014 | P2 | Completion needs billet input or a manager's audited "input not tracked" exception. | `150000_production_input_evidence` | Production page panel |
| 033 | P3 | Tenant-only write policies replaced by role-explicit policies matching `lib/auth/permissions.ts`. | `160000_role_explicit_write_policies` | — |
| 011 follow-up | — | Audited transport-document amendment RPC + history table. | `170000_dispatch_document_amendments` | Dispatch page panel |
| 027 + 008 follow-up | P2 | Maintenance linked to machines (FK); breakdown lifecycle; return-to-service sign-off; next-due recompute; reversible spare-part usage. | `180000_machine_maintenance_lifecycle` | Maintenance workspace; machine page panel |
| 023 | P2 | Books-closed-through lock on invoices, payments, credit notes and expenses; only the owner reopens; settlements not before invoice. | `190000_accounting_period_lock` | Settings |
| 029 | P3 | Per-receipt limit (default 60,000 kg) and weighbridge reference above 10,000 kg. | `200000_metal_receipt_plausibility` | Settings; receipt forms |
| 006, 005, 002 follow-up | P1, P1 | Categorised completion scrap (only weighed recoverable categories become alloy-tagged furnace lots); alloy-compatible furnace charges with audited deviation; process-scrap reversal RPC. | `210000_scrap_genealogy_and_alloy_segregation` | Production completion form; foundry panels |
| 022 | P2 | Movements are the source of truth (definer-only writes); no negative clamping; furnace charges post movements; reconciliation view. | `220000_inventory_ledger_integrity` | Inventory page panel |
| 013, 024 | P1, P2 | Stock batches carry origin, job, alloy, temper and QC status; created only from QC-released surplus, an opening-stock journal or a return disposition; QC hold blocks reservation; dealer route fixed (per-piece length, total metres, notes, 10% reconciliation). | `230000_finished_goods_origin_and_qc_hold` | Inventory/reservation panels; dealer inventory |
| 001 | P1 | Cast-result step (good count, measured weight, rejects to scrap, dross); chemistry test with independent approval; billets allocatable only when the batch is ready; billet-reject RPC. | `240000_casting_results_and_chemistry_release` | Foundry batch and billet panels |
| 016 | P2 | Disposition workflow for QC rejects, finishing rejects and returns; partial credit notes by packing row. | `250000_material_dispositions_and_partial_credit_notes` | Quality, finishing, dispatch panels |
| 031 | P3 | Planning only links billets; a separate physical issue RPC marks them issued. | `260000_physical_billet_issue_step` | Production page panel |
| 028 | P3 | Shipped kg excludes returned/damaged; attainment compares the same job set; recovery/scrap fixed in the app. | `270000_kpi_definitions` | Command centre; `docs/KPI_DICTIONARY.md` |
| 021 | P2 | Conservative default chosen: spec changes on a profile with open work need owner/admin approval, recorded with the open work affected. | `280000_profile_spec_change_control` | Profile page panel |
| 032 | P3 | Create Task page implemented. | — (app only) | `app/(dashboard)/tasks/new` |
| Extra | — | Single-source furnace charge failure ("record v_new is not assigned yet"). | `290000_foundry_single_source_charge_fix` | — |
| 003/008/029 data | — | Oversized receipts held; balances reconciled; three constraints validated. | `300000_reconcile_metal_sources_and_validate` | — |

The earlier observation that the machine form offered type `cnc` (rejected by the database) is fixed: the option was removed.

### Resolved after Wave 2 — 026

| ID | Sev | Fix | Migration (`20261021…`) | App entry point |
| --- | --- | --- | --- | --- |
| 026 | P2 | Invoices keep billing the **actual net kg shipped** (a GST invoice must state the quantity supplied). The invoice rate per kg (`quote_items.net_rate`, copied to the order line, packing row and invoice line) is now **quoted amount ÷ physical kg** instead of quoted amount ÷ billing kg, so shipping the quoted quantity invoices exactly the quoted amount — scrap allowance, minimum billing weight and the die, packing, freight and other charges priced into the line included. Per-metre / per-piece `invoice_calc_uom` values, which were stored but ignored, are rejected by CHECK constraints. `public.get_order_billing_reconciliation` (owner/admin/accounts) shows quoted vs invoiced value per order line, so a short or partial shipment's uninvoiced remainder is visible. | `310000_quote_invoice_rate_basis` | Order page "Quoted vs Invoiced" card; quote and order line tables show the invoice rate per actual kg; PCDA sheet label |

### Pending

None of the 33 findings. Two related items are **not** done and are listed so they are not mistaken for done:
- **Separate invoice lines for die and freight charges** with their own HSN/SAC. Today those charges stay inside the line amount (GST-correct: bundled charges are part of the goods' transaction value), so the invoice reproduces the quoted value without them. Separate lines would need non-packing invoice lines, which the invoice model does not have.
- **Quote PDF** still prints the per-billing-kg rate next to the billing weight (rate × weight = amount, so the PDF is internally consistent). The invoice rate per actual kg appears in the app only. `lib/pdf/quote-pdf.ts` has uncommitted work by another actor and was not touched.

Not touched (not mine): `20261021290100_operation_page_null_projection.sql`, committed by another actor in `f715b4d`. It is **not applied** to hosted.

### Missing functionality (not counted as bugs, unchanged)

Purchase order / goods receipt / 3-way match; general ledger, COGS, WIP and inventory valuation; NCRs and customer complaints; downtime-based OEE; customer advances and debit notes; e-way bill integration. (Chemistry records and partial credit notes now exist through 001 and 016.)

## 4. Live data

- **Reconciled by `20261021300000`:** SCR-2026-0001 (already rejected), SCR-2026-0002 (1,000,000 kg) and EAS-2026-0003 (100,000,000 kg) are on a 'rejected' hold with the note "Held 21-10-2026 (ERP audit reconciliation): received weight … exceeds the per-receipt limit; record the weighbridge weight before releasing." Nothing was deleted or re-weighed; the hold is reversible.
- **Found, not changed:** foundry batch **FB-2026-0001 is `cancelled` but 24 of its billets are still `allocated` to an order** (no job). This predates the audit. Releasing or cancelling those billets changes an order's material position, so it needs a decision from whoever owns that order.

## 5. Behaviour changes to communicate (and decisions taken by default)

1. **Casting (001):** billets are no longer allocatable at `cast`. Record the cast result and an approved chemistry test, then move the batch to `ready`. Billets cast before 21 Oct keep their status.
2. **Completion (006, 014):** use categorised scrap. The old single scrap figure is recorded as 'unclassified' and does not become furnace metal. A job with no billet input needs a manager's "input not tracked" exception first.
3. **Billet issue (031):** saving the production plan no longer issues billets; use the physical issue action before starting the job.
4. **Furnace charges (005):** a source of a different alloy, or scrap of unknown alloy, needs an approved deviation.
5. **Finished stock (013):** factory users cannot type in stock batches; use production surplus, the opening-stock journal (owner/admin) or a return disposition. Opening stock starts on QC hold.
6. **Profiles (021, default chosen):** spec changes under open work need owner/admin approval. Confirm this policy, or ask for versioned profile references instead.
7. **Books lock (023):** nothing changes until a company sets a lock date; only the owner can reopen.
8. **Receipt limits (029):** 60,000 kg per receipt and a weighbridge reference from 10,000 kg by default; change both in Settings.
9. **Delivery tolerance (018):** default 0% (previous behaviour); set in Settings, or use the short-close action.
11. **Invoice rate (026):** quote and order lines now show the invoice rate per actual kg. With a scrap allowance or a minimum billing weight it is higher than the old per-billing-kg rate, so shipping the quoted quantity invoices the quoted amount. The quote PDF still prints the per-billing-kg rate. If the business wants allowance or minimum charges billed differently (for example as a separate line), that is a change to this default.
12. Wave 1 decisions still open: QC approver roles, profile spec values, reserved-stock line matching, allocation timing (see `09_REMEDIATION_STATUS.md`).

## 6. How to reproduce and verify

Run from the `codex/v1` worktree root (needs the `@electric-sql/pglite` dev dependency).

Wave 2 gate (baseline = post-Wave-1 hosted snapshot; candidate = snapshot + Wave 2):

```bash
node audit-output/EXOS_ERP_AUDIT_2026-10-20/harness/gate-wave2.mjs
```

Wave 1 gate with Wave 2 layered on, in hosted order: set `GATE_PREFIX_MIGRATIONS` to the three `20261020…` parallel-session migrations (applied to hosted before Wave 1; `140000` depends on `20261020142106`) and `GATE_SUFFIX_MIGRATIONS` to the comma-separated Wave 2 file paths (`supabase/migrations/20261021080000_….sql,…`, without `290100`), then run `gate-wave1.mjs`. Expected 62/64: `G002-completion-still-books-scrap` (014 now needs billet input or an exception; 006 no longer books uncategorised loss as furnace metal) and `G008-production-manager-returns-press` (now needs the return-to-service sign-off) are intended changes, noted in `results/gate-wave1-with-wave2.txt`.

Hosted fingerprint check (prints SQL to run on hosted; `--local` prints the gated state):

```bash
node audit-output/EXOS_ERP_AUDIT_2026-10-20/harness/fingerprint-wave2.mjs --local
```

Saved outputs: `harness/results/gate-wave2.txt`, `gate-wave1-with-wave2.txt`, `wave2-hosted-fingerprint.txt`.

## 7. Repository and hosted state

- Hosted ledger: **121 rows**; latest `20261021310000_quote_invoice_rate_basis`.
- `codex/v1` commits are **not pushed**, and `main` is **not fast-forwarded** (AGENTS.md: verify on `codex/v1`, then fast-forward `main`). Until the app is deployed, the hosted database runs Wave 2 while production users still have the old app: workflows that now need a new step (cast result, chemistry approval, billet issue, categorised scrap, input exception, stock batch origin) have no button in the deployed app.
- Another actor commits unrelated work (PDF, quotation layout) in the same worktree; those files were not touched or staged.

## 8. Not verified

Real JWT browser journeys for the new panels (covered by unit tests, typecheck and build only); multi-session races (locks reviewed, not load-tested); PDFs; historical or physical data accuracy (hosted holds test data).

## 9. Recommended next steps

1. Decide what to do with **FB-2026-0001**'s 24 allocated billets.
2. Push `codex/v1`, fast-forward `main` and deploy, so the app matches the hosted database.
3. Walk the new workflows in a browser as each role (owner, factory manager, production, quality, dispatch, accounts).
4. Confirm the defaults in §5 with the business, including the 026 billing basis (§5 item 11).

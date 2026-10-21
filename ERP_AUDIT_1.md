# ERP_AUDIT_1 — ExtrusionOS ERP Audit and Remediation Handover (Waves 1 and 2)

Session dates: 20–21 October 2026. Branch: `codex/v1` (worktree `.worktrees/codex-v1`). Hosted database: Supabase `pkawmdxtmsdgigsehcmb` (AlExMS).

## 1. At a glance

| Item | Value |
| --- | --- |
| Findings recorded | **33** (EXOS-AUD-001 … 033): **13 P1**, **14 P2**, **6 P3**, plus 7 missing-functionality areas (not counted as bugs) |
| Additional defects found during remediation | (1) Sales users could not convert quotes to orders (same root cause as 009, fixed with it). (2) A furnace batch charged from only one source type failed with "record v_new is not assigned yet" (fixed in `20261021290000`). |
| **Resolved and applied to hosted** | **33 of 33.** Wave 1 (9): 002, 003, 007, 008, 009, 010, 011, 012, 019. Wave 2 (24): 001, 004, 005, 006, 013, 014, 015, 016, 017, 018, 020, 021, 022, 023, 024, 025, 026, 027, 028, 029, 030, 031, 032, 033 |
| **Pending** | **None.** Both 026 extras are built (§3): separate die/freight invoice lines (`20261021330000`, gated, **not yet applied to hosted**) and the invoice basis on the quote PDF. |
| Follow-ups on Wave 1 items | All three closed: 002 reversal RPC, 008 return-to-service sign-off, 011 transport-document amendment |
| Live data reconciliation | Done: SCR-2026-0001/0002 and EAS-2026-0003 put on a 'rejected' hold with a note; the three NOT VALID constraints are now **validated** |
| Hosted migrations applied | Wave 1: 11 (ledger 86 → 97). Wave 2: **24** (ledger 97 → 121). Data repair `20261021320000` (FB-2026-0001): ledger **122**. Not applied: `20261021330000`. |
| Commits on `codex/v1` | Wave 1: `5f5463f`, `7ca9bf3`, `57c313a`, `c99459d`. Wave 2: `2a77d28` (migrations + harness), `853c4dc` (app entry points), `45964ae` (docs/evidence), `29dbaa6` (026) — pushed, `main` fast-forwarded. After that, not pushed: `8c0c9b2` (FB-2026-0001 repair), `3aa216e` (die/freight lines), `1478b88` (quote PDF invoice basis), plus other actors' commits `35dbb70`, `20e632d`, `e99f4b6` |
| Verification | Wave 2 gate **80/80** (73 + 5 for 026 + 2 for the die/freight lines of `330000`; re-run 21 Oct late with `GATE_TRACE=1`) (baseline reproduces each defect; candidate fixes it and legitimate flows still work). Wave 1 gate alone **64/64**; with Wave 2 (incl. `330000`) layered on **64/64** after G002/G008 were updated to the Wave 2 steps (see §6). Reconciliation rehearsal passed. **Hosted fingerprint after apply is byte-identical** to the gated state (94 functions, 33 triggers, 27 policies, plus the 3 functions of 026). Re-run 21–22 Oct after `330000` and the quote PDF commit (working tree incl. other actors' uncommitted changes): `npm test` **2,037/2,037**; `npm run lint`, `npm run typecheck` and `npm run build` pass. The committed quote PDF change was also typechecked and tested on a clean checkout of its commit. |

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

| 026 follow-up | — | **Die and freight billed once as separate invoice lines.** A quote line with a die charge or freight sets `charges_billed_separately`; its invoice rate per actual kg excludes them. `save_invoice_atomic` adds one `die_charge` and one `freight_charge` line per order line on the first active invoice that bills it (advisory lock per order line; a cancelled invoice frees the charge for the next one). Charge lines carry the goods line's HSN and GST rate. Lines saved earlier keep the charges inside the rate, so nothing is billed twice. | `330000_invoice_die_freight_charge_lines` (commit `3aa216e`) — **gated, not yet applied to hosted** | Quote PDF prints the invoice basis (commit `1478b88`) |

### Pending

None of the 33 findings. Both related extras are now built:
- **Separate die/freight invoice lines:** migration `20261021330000` (above). Gated in PGlite on the live catalog; **not applied to hosted**. On 21 Oct the hosted bodies of the functions it replaces or re-triggers (`private.save_invoice_atomic`, `private.assert_invoice_packing_coverage`, `public.recalculate_quote_item_financials`, the three `private.canonicalize_invoice_*` functions) were compared with the gated pre-330000 state: identical body, owner, SECURITY DEFINER and `search_path` (hosted bodies differ only by `\r` line endings from CRLF files). Hosted-only `320000` is a data repair on `foundry_billets` and does not overlap.
- **Quote PDF:** below the line table it prints "Invoicing: actual net weight at <profile> <rate> /kg … Billed once on the first invoice: die … + freight …". Users who cannot see die/freight amounts (sales) get one combined figure. Only these hunks were committed (`1478b88`); the PDF overhaul's other uncommitted changes in `lib/pdf/quote-pdf.ts` and the quote PDF route were left in the working tree. A sample quotation was rendered both with the committed file alone and with the working tree and checked visually.

Not touched (not mine): `20261021290100_operation_page_null_projection.sql`, committed by another actor in `f715b4d`. It is **not applied** to hosted.

### Missing functionality (not counted as bugs, unchanged)

Purchase order / goods receipt / 3-way match; general ledger, COGS, WIP and inventory valuation; NCRs and customer complaints; downtime-based OEE; customer advances and debit notes; e-way bill integration. (Chemistry records and partial credit notes now exist through 001 and 016.)

## 4. Live data

- **Reconciled by `20261021300000`:** SCR-2026-0001 (already rejected), SCR-2026-0002 (1,000,000 kg) and EAS-2026-0003 (100,000,000 kg) are on a 'rejected' hold with the note "Held 21-10-2026 (ERP audit reconciliation): received weight … exceeds the per-receipt limit; record the weighbridge weight before releasing." Nothing was deleted or re-weighed; the hold is reversible.
- **Repaired by `20261021320000` (applied, ledger 122):** foundry batch FB-2026-0001 was `cancelled` in May but its 24 billets (6,856 kg from a 300 kg charge) stayed allocated to O-2026-0009. In-house billets of cancelled batches that are still cast or allocated and not on a job were cancelled, unlinked and audited, and the order's requirements recounted: O-2026-0009 now has 9 allocated, 188 short.

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
11. **Invoice rate (026):** quote and order lines now show the invoice rate per actual kg. With a scrap allowance or a minimum billing weight it is higher than the old per-billing-kg rate, so shipping the quoted quantity invoices the quoted amount. The quote PDF prints the per-billing-kg rate in the table and the invoice rate per actual kg below it, with die and freight (once `20261021330000` is applied) billed once as separate invoice lines. If the business wants allowance or minimum charges billed differently (for example as a separate line), that is a change to this default.
12. Wave 1 decisions still open: QC approver roles, profile spec values, reserved-stock line matching, allocation timing (see `09_REMEDIATION_STATUS.md`).

## 6. How to reproduce and verify

Run from the `codex/v1` worktree root (needs the `@electric-sql/pglite` dev dependency).

Wave 2 gate (baseline = post-Wave-1 hosted snapshot; candidate = snapshot + Wave 2):

```bash
node audit-output/EXOS_ERP_AUDIT_2026-10-20/harness/gate-wave2.mjs
```

Wave 1 gate with Wave 2 layered on, in hosted order: set `GATE_PREFIX_MIGRATIONS` to the three `20261020…` parallel-session migrations (applied to hosted before Wave 1; `140000` depends on `20261020142106`) and `GATE_SUFFIX_MIGRATIONS` to the comma-separated Wave 2 file paths (`supabase/migrations/20261021080000_….sql,…`, without `290100`), then run `gate-wave1.mjs`. Expected 64/64. `G002-completion-still-books-scrap` and `G008-production-manager-returns-press` detect Wave 2 and use its legitimate steps (manager input exception + categorised scrap, since 014/006; the return-to-service sign-off, since the 008 follow-up). Before that update they failed as intended behaviour changes (62/64).

Hosted fingerprint check (prints SQL to run on hosted; `--local` prints the gated state):

```bash
node audit-output/EXOS_ERP_AUDIT_2026-10-20/harness/fingerprint-wave2.mjs --local
```

Saved outputs: `harness/results/gate-wave2.txt`, `gate-wave1-with-wave2.txt`, `wave2-hosted-fingerprint.txt`.

## 7. Repository and hosted state

- Hosted ledger: **122 rows**; latest `20261021320000_cancelled_batch_phantom_billets`. `20261021330000_invoice_die_freight_charge_lines` is **not applied**.
- `codex/v1` and `main` were pushed at `29dbaa6`; later commits are local only (see §1). Until the app is deployed, the hosted database runs Wave 2 while production users still have the old app: workflows that now need a new step (cast result, chemistry approval, billet issue, categorised scrap, input exception, stock batch origin) have no button in the deployed app.
- Another actor commits unrelated work (PDF, quotation layout) in the same worktree; those files were not touched or staged.

## 8. Not verified

Real JWT browser journeys for the new panels (covered by unit tests, typecheck and build only); multi-session races (locks reviewed, not load-tested); PDFs; historical or physical data accuracy (hosted holds test data).

## 9. Recommended next steps

1. Apply `20261021330000` to hosted (hosted functions checked against the gated copy on 21 Oct), then re-run the fingerprint check.
2. Push `codex/v1`, fast-forward `main` and deploy, so the app matches the hosted database.
3. Walk the new workflows in a browser as each role (owner, factory manager, production, quality, dispatch, accounts).
4. Confirm the defaults in §5 with the business, including the 026 billing basis (§5 item 11).

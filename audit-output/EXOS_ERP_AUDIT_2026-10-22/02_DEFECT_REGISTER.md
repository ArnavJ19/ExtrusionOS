# Report 2 — Defect Register (EXOS-AUD2-001 … 022)

These IDs are new. They do not repeat EXOS-AUD-001…033 (20 Oct audit, all remediated and applied) or the BUGS-MEGA / finance registers. Where a finding touches an earlier fix, the earlier ID is named.

**Evidence base**

- **Live bodies.** `harness/current/*` is a dump of the PGlite replica of the hosted catalog at ledger 126. Its function, trigger and policy fingerprints match hosted exactly (386 functions, 598 policies, 324 triggers; see `00_README.md`). Line numbers below refer to these dumps, plus the repo migration that last defines each object.
- **Executed.** `harness/rNN-*.mjs` run as PostgREST role `authenticated` under live RLS and triggers. Saved outputs are in `harness/results/`.
- **Hosted.** Read-only `SELECT`s against `pkawmdxtmsdgigsehcmb`. Nothing on hosted was written.

Severity follows the directive (P0–P3, IMP). Confidence is Confirmed, Probable, or Needs Business Decision (NBD).

---

## P1 — High

### EXOS-AUD2-001 — An owner/admin can hard-delete a delivered, not-yet-invoiced dispatch, and the same output can then be shipped again

- **Severity / Confidence:** P1 / Confirmed (executed)
- **Modules:** Dispatch, Production, QC, Orders, Invoicing
- **Workflow:** Flow C: production → QC → packing → dispatch → invoice
- **Technical location:**
  - Policy `"dispatch tenant delete"` on `public.dispatches` lets owner/admin `DELETE` (`harness/current/policies.txt:406`).
  - There is no `BEFORE DELETE` guard on `dispatches`. `a_guard_dispatch_post_activation` and `validate_dispatch_transition` fire on INSERT/UPDATE only (`harness/current/triggers.sql`).
  - Foreign keys `packing_list_items.dispatch_id`, `dispatch_status_history.dispatch_id` and `dispatch_document_amendments.dispatch_id` are `ON DELETE CASCADE`; `invoices.dispatch_id` is `SET NULL` (`harness/current/constraints.txt`).
  - `public.guard_active_dispatch_packing()` (`functions.sql:13148`, from `20260718021000_dispatch_readiness_and_delivery.sql:135`) looks up the parent dispatch. During the cascade the parent row is already gone, so `if found and v_status <> 'pending'` is false and the packing delete passes.
- **Existing behavior:**
  - The owner deleted delivered dispatch D-1 (eway bill EWB-1, LR-1). Its packing row and status history were removed, and the order stayed `delivered` with no dispatch (`results/r01c.txt`).
  - Before the delete, a second dispatch of the same 10 kg was refused ("Dispatch packing exceeds QC-released and packaged output"). After the delete, the same 10 kg dispatched again (`results/r01d.txt`).
- **Expected behavior:** A dispatch that has been activated (dispatched, in transit, delivered, returned or damaged) can never be hard-deleted. Corrections go through the amendment, return or cancellation workflow, which keeps history.
- **Reproduction:** `ONLY=c` and `ONLY=d node harness/r01-owner-direct-writes.mjs`.
- **Controls that held:**
  - A dispatch with an active invoice cannot be deleted. The FK `SET NULL` on `invoices` trips "Invoice source cannot be changed after packing lines are created" (`results/r01b.txt` and the R01a log).
  - Dispatch managers have no delete policy.
- **Business impact:**
  - Goods that physically left the plant stop existing in the system, so no invoice can be raised for them (revenue leakage).
  - The same finished goods become dispatchable twice.
  - Statutory references (e-way bill, LR) vanish.
  - The order shows "delivered" with nothing behind it.
- **Cross-module:** Production output capacity, the order delivery stage, receivables and the dispatch KPIs all change silently. `audit_logs_enterprise` keeps one row.
- **Root cause:** The delete privilege was kept for owner/admin "data hygiene", but the activation lifecycle is enforced only on INSERT/UPDATE.
- **Recommended fix:**
  - Add a `BEFORE DELETE` trigger on `dispatches` that rejects any row whose `delivery_status <> 'pending'` or whose `actual_dispatched_at` is set. Alternatively, drop the delete policy and use a cancellation status.
  - Change the `dispatch_status_history` FK to `RESTRICT`.
- **Regression test:** R01c/R01d must reject the delete and the second dispatch. A pending dispatch with no packing rows should still be deletable, if the business wants that.
- **Related:** EXOS-AUD-011 and 025 (dispatch freeze and capacity) assumed the dispatch row always survives.

### EXOS-AUD2-002 — Completing a job consumes billets that were never issued to the press, and a truthful completion is rejected

- **Severity / Confidence:** P1 / Confirmed (executed)
- **Modules:** Production, Billet stock, Traceability, KPIs
- **Workflow:** Flow B: billet allocation → physical issue → extrusion → completion
- **Technical location:**
  - `public.enforce_production_completion_integrity()` (`functions.sql:11546`, from `20261021240000_casting_results_and_chemistry_release.sql:375`) computes input from billets whose `status in ('allocated','issued','consumed')`.
  - `public.link_billets_to_production_job()` (`functions.sql:13740`) sets `status='consumed'` for every billet linked to the job whose status is `allocated` or `issued`.
  - `private.issue_production_billets` (the EXOS-AUD-031 physical issue step) is never required.
- **Existing behavior:** A job had 3 linked billets (3 × 500 kg) and only billet 1 was issued (`results/r06.txt`).
  - The honest completion (420 kg good, 80 kg butt/saw, 500 kg in total) was rejected: "Billet mass balance failed: linked input 1500.000 kg…".
  - Completion succeeded only after booking 1,000 kg of `unrecoverable_loss`. All 3 billets became `consumed`, with 1 issue record.
- **Expected behavior:** Completion consumes only billets with issue evidence. Billets that are allocated but unissued return to the order allocation (or stay allocated). The mass balance uses issued input.
- **Business impact:**
  - Billets still in the rack disappear from stock.
  - Fictitious "loss" depresses recovery and inflates scrap KPIs.
  - The genealogy records heats that never reached the press. On hosted, J-2026-0001 is `in_progress` with 15 allocated and 0 issued billets, so completing it today would consume all 15 (`01_EXECUTIVE_SUMMARY.md`).
- **Root cause:** EXOS-AUD-031 added the issue step but left completion keyed on the older "linked" set.
- **Recommended fix:**
  - Base the mass balance on `issued` billets plus documented input exceptions.
  - At completion, release `allocated` billets back to the requirement (reuse the EXOS-AUD-015 release path) instead of consuming them.
  - Optionally block completion when allocated, unissued billets remain unless the manager confirms.
- **Regression test:** R06a must pass, R06b must fail, and billets 2 and 3 must end `allocated` with no job.
- **Related:** EXOS-AUD-014, 015 and 031; AUD2-018 (partial logs).

### EXOS-AUD2-003 — The cast result can record more billet metal than went into the furnace

- **Severity / Confidence:** P1 / Confirmed (executed)
- **Modules:** Foundry, Metal balance, Billet stock
- **Workflow:** Flow A: charge → melt → cast → cast result → release
- **Technical location:**
  - `private.record_foundry_cast_result` (`functions.sql:7064`; `20261021240000…sql:457`) validates the measured good weight only against `theoretical ± max(15%, 1 kg)`.
  - Neither the measured weight nor `measured + dross` is compared with `charged_kg`.
  - `melt_loss_kg` (line 483) is computed and allowed to go negative.
- **Existing behavior:** A batch charged with 65.670 kg recorded 74.864 kg of good billets plus 5 kg of dross. The stored `melt_loss_kg` is −9.194 and the batch released (`results/r05.txt`).
- **Expected behavior:** `good + rejected + dross + melt loss = charge` within a configured tolerance, with `melt loss ≥ 0`. Any overrun requires a re-weigh or an approved adjustment.
- **Business impact:** Billet stock and the per-billet `measured_weight_kg` are inflated by up to about 15% plus the dross. These figures feed the production mass balance, so phantom metal propagates downstream and recovery looks better than it is.
- **Root cause:** The plausibility check uses theoretical yield as the reference, not the metal actually charged.
- **Recommended fix:**
  - Reject when `measured_good_kg + dross_kg + rejected_theoretical_kg > charged_kg × (1 + tol)`.
  - Require `melt_loss_kg ≥ 0`.
  - Make dross mandatory when the charge exceeds the good weight by more than X%.
- **Regression test:** R05a must be rejected; a cast at 95% of charge must pass.
- **Related:** EXOS-AUD-001.

### EXOS-AUD2-004 — Any production user can release a quarantined metal lot, and a "returned" lot stays in stock and payables

- **Severity / Confidence:** P1 / Confirmed (executed)
- **Modules:** Foundry sources, Incoming QC, Inventory, Payables
- **Workflow:** Flow A: receipt → incoming inspection → charge
- **Technical location:**
  - `private.guard_foundry_source_balance()` (`functions.sql:4169`; `20261021010000_scrap_and_foundry_source_write_guards.sql:97`) keeps a client-supplied `status in ('rejected','returned')` and recomputes any other status from the balance. So `rejected → available` is a free client write.
  - `private.enforce_metal_receipt_plausibility` fires only on changes to `weight_kg` or `weighbridge_reference`.
  - The UPDATE policy lets the `production` role write to both source tables (`policies.txt:589`, `:619`).
  - Neither source table has an audit trigger.
  - `sync_external_source_inventory_and_expense` reacts to weight and rate, not status.
- **Existing behavior** (`results/r02.txt`):
  - **R02c:** The manager rejected a lot ("Spectro: Fe 0.6% out of spec") and a charge was correctly refused. An operator then set `status='available'` with no reason, charged 919.38 kg into a batch, and no audit row was written.
  - **R02a:** The hosted shape of EAS-2026-0003 (100,000 t, held by migration 300000) can be flipped back to `available` the same way.
  - **R02b:** Marking a 1,000 kg lot `returned` left inventory at 1,000 kg and the ₹2,00,000 payable unchanged. It can be flipped back to `available`.
- **Expected behavior:**
  - Releasing a quarantine needs a QC or manager role, a reason and an audit row (a disposition RPC).
  - A return to vendor posts an inventory issue and a debit note or payable reduction, and is terminal.
- **Business impact:**
  - Off-spec or implausible metal enters the furnace, which is a quality and traceability risk.
  - Returned goods stay valued and payable, so payables are overstated and the vendor may be paid for goods sent back.
- **Root cause:** Status is a free-text column inside a balance-guard trigger. There is no disposition workflow.
- **Recommended fix:**
  - Make `status` writable only through `set_metal_source_disposition(source, status, reason)`, restricted to quality, factory manager or owner, and audited.
  - Have `returned` post an inventory reversal and a supplier credit through `record_expense_supplier_credit_atomic`.
  - Add audit triggers to both source tables.
- **Regression test:** R02a and R02c must reject the operator flip; R02b must post an inventory issue and a supplier credit.
- **Related:** EXOS-AUD-003 and 029; AUD2-016 and 017.

### EXOS-AUD2-005 — Breakdown, calibration and die-correction history can be hard-deleted without trace, and deleting an open breakdown lifts the press lockout

- **Severity / Confidence:** P1 / Confirmed (executed)
- **Modules:** Maintenance, Machines, Quality (calibration), Dies
- **Workflow:** Flow F: breakdown → lockout → repair → sign-off
- **Technical location:**
  - Owner/admin DELETE policies exist on `breakdown_logs`, `calibration_records`, `die_corrections`, `die_trials`, `maintenance_schedules` and `energy_readings` (`policies.txt:100`, `121`, `336`, `366`, `745`, `481`).
  - None of these tables has an audit trigger, and none has a `BEFORE DELETE` guard.
  - `private.return_machine_to_service_atomic` checks only that no breakdown is open (`20261021180000_machine_maintenance_lifecycle.sql:258`).
- **Existing behavior** (`results/r03.txt`):
  - **R03a:** An open breakdown on Press B with a ₹25,000 bill locked the press, and sign-off was refused. The owner deleted the breakdown. The expense was cancelled, no audit row was written, sign-off then succeeded with no root cause or repair on record, and the press returned to `active`.
  - **R03b:** A resolved 480-minute breakdown was deleted with no trace.
  - **R03c:** An overdue spectrometer calibration and a failed die correction were deleted with no trace.
- **Expected behavior:** Maintenance and calibration evidence is append-only. Mistakes are voided with a reason, and open breakdowns close only through resolution.
- **Business impact:**
  - The lockout added for EXOS-AUD-027 can be bypassed.
  - Downtime and MTBF KPIs are understated.
  - Calibration (instrument-validity) evidence for quality audits can be erased.
  - Die maintenance history is lost.
- **Recommended fix:**
  - Remove the DELETE policies, or replace them with a `voided_at` / `void_reason` pattern through an RPC.
  - Add audit triggers that capture old values.
  - Make `return_machine_to_service_atomic` require the last resolved breakdown since the lock.
- **Regression test:** R03a–c deletes are rejected, and voiding leaves the row plus an audit entry.

### EXOS-AUD2-006 — Deleting a profile master erases its finished-goods stock and order reservations

- **Severity / Confidence:** P1 / Confirmed (executed)
- **Modules:** Master data, FG stock, Reservations, Orders
- **Technical location:**
  - Policy `"profiles tenant delete"` allows owner/admin to delete (`policies.txt:19`).
  - The FKs from `profile_stock_batches`, `profile_stock_reservations`, `profile_stock_consumptions`, `quality_inspections`, `packing_list_items` and `profile_spec_change_approvals` to `aluminium_profiles` are `ON DELETE CASCADE` (`constraints.txt`).
  - `record_enterprise_audit()` writes only `{table, operation}` with no old values, and swallows every error (`exception when others`).
  - The UI reference check exists only in `lib/master-data/service.ts:235-262`, client side.
- **Existing behavior:** Profile P-200 held 696 kg of QC-released opening stock, with 348 kg reserved for ORD-A. A direct `DELETE` by the owner succeeded, and both the batch and the reservation are gone (`results/r08.txt`).
- **Expected behavior:** A profile with any stock, reservation, QC, packing or order history cannot be deleted; it can only be deactivated.
- **Business impact:** Inventory and its valuation silently drop, the order loses its reserved stock, and the audit row cannot show what was deleted.
- **Recommended fix:**
  - Change the transactional FKs to `RESTRICT`.
  - Move the reference check into a `BEFORE DELETE` trigger.
  - Store old row values in the audit.
- **Regression test:** The R08 delete is rejected; deactivation is allowed.
- **Related:** AUD2-015; customers have the same CASCADE pattern into `portal_users`, `quote_requests` and `support_tickets`.

### EXOS-AUD2-007 — The hosted schema cannot be rebuilt from version control

- **Severity / Confidence:** P1 / Confirmed
- **Modules:** Deployment, disaster recovery, every schema-dependent module
- **Technical location:**
  - The hosted ledger (126 rows) includes `20261020090729_priority_billet_allocation_integrity`, `20261020120000_invoice_supplier_snapshot_contact`, `20261020142106_posted_reservation_delivery_lifecycle`, `20261020162949_production_billet_material_normalization` and `20261022010000_fk_covering_indexes_and_rls_initplan`.
  - Each exists only as an **untracked** file in `.worktrees/codex-v1/supabase/migrations/`, not in `main`, `codex/v1` or `origin`. Checked with `git ls-tree` and `git ls-files`.
  - Committed `20261021140000_dispatch_packaged_weight_cap.sql:100` calls `private.closed_reservation_has_exact_dispatch_posting`, which only the untracked `20261020142106` defines.
  - The historical replay (A00) is also open per BUGS-MEGA.
- **Impact:**
  - A rebuild from `main` (new environment, staging, or restore into a fresh project) applies cleanly, because plpgsql resolves calls at runtime, but then fails at dispatch readiness for reservation dispatches.
  - The functions `allocate_billets_by_priority`, `save_production_job_atomic` and `snapshot_invoice_parties` would also differ from production.
  - The untracked `20261021190916_collaboration_procedure_routines.sql` plus untracked app code (`lib/actions/collaboration-workflows.ts`, `app/api/collaboration-workflows/`) is a further unapplied, unversioned change.
- **Recommended fix:**
  - Commit the 5 applied migrations under their file names.
  - Add a CI check comparing the hosted ledger names with `supabase/migrations`.
  - Decide on a baseline squash so a fresh replay is possible.
- **Regression test:** CI job: an empty Postgres replays `main` migrations, and its catalog fingerprint equals hosted (`harness/current-db.mjs --fingerprint`).

---

## P2 — Medium

### EXOS-AUD2-008 — Dispatch weight cap allows 10 g against recorded output, so real weighings are refused

- **P2 / Confirmed (rule); NBD (tolerance value).**
- **Location:** `20261021140000_dispatch_packaged_weight_cap.sql:152`, `if v_source_used_kg > v_ready_kg + 0.01`.
- **Executed:** 600 kg of output (QC-approved and packaged) weighed at 600.4 kg on dispatch is rejected (`results/r04.txt`).
- **Impact:** Production, QC, packaging and dispatch weigh independently, and normal scale variance (±0.1–0.5%) blocks the dispatch. Operators will key in the system figure instead of the scale reading, so the packing list, invoice quantity (GST) and e-way bill weights stop matching the weighbridge.
- **Fix:** A percentage-plus-absolute tolerance in `company_settings` (e.g. 0.5% / 2 kg). Record the variance on the dispatch and require approval above the threshold.

### EXOS-AUD2-009 — Chemistry pass/fail is typed by the user; measured composition is never checked against the alloy spec

- **P2 / Confirmed (executed).**
- **Location:**
  - `private.record_foundry_chemistry_test` (`functions.sql:7142`; `20261021240000…sql:514`) accepts `p_result` as given.
  - `approve_foundry_chemistry_test` (`:315`) does not inspect the result or the composition.
  - Element limits exist only client-side in `lib/calculations/alloy-composition.ts:17-60` and are not used by `lib/actions/erp-controls.ts:118-132`.
- **Executed:** 6063 with Fe 0.60% (max 0.35) and Mg 0.30% (min 0.45) was recorded as `pass`, approved by a second person, and the batch released (`results/r05.txt`).
- **Impact:** Out-of-spec billets enter allocation, and the second-person approval is the only control.
- **Fix:**
  - Store alloy limits in the DB (per company, with an optional customer-specific tightening).
  - Compute pass/fail server-side, and require an override reason plus a quality role to release a computed fail.
  - Cite a standard (e.g. IS 733 / ASTM B221 / EN 573-3) rather than Wikipedia as the spec source.

### EXOS-AUD2-010 — Finishing output cannot exceed input, so powder-coating weight gain cannot be recorded

- **P2 / Confirmed (executed); NBD on the weight basis.**
- **Location:** `public.validate_finishing_completion()` (`functions.sql:16865`; `20260718020500_finishing_route_and_quality_yield.sql:199`).
- **Executed:** 1,000 kg of mill output weighed 1,020 kg after coating, and the 1,020 kg entry was rejected; 1,000 kg was accepted (`results/r04.txt`).
- **Impact:** Coated profiles (typically 1–3% heavier) cannot be recorded at their actual weight. Coupled with AUD2-008, a coated dispatch at actual weight is refused, and per-kg billing of coated goods is understated.
- **Fix:** Decide whether finishing is tracked at mill weight or coated weight. If coated, allow `output ≤ input × (1 + coating gain %)` and record the coating gain separately from loss.

### EXOS-AUD2-011 — Packaging-material purchases and consumption post to two different stock records; the master stock is hand-editable

- **P2 / Confirmed (executed).**
- **Location:**
  - `public.sync_packaging_purchase_inventory_and_expense` (`functions.sql:16366`) posts purchases to `inventory_items` (`PKG-…`).
  - `public.apply_packaging_material_stock` (`:10859`) and the `packaging_job_materials` triggers decrement `packaging_materials.current_stock`.
  - `packaging_materials` has no balance guard, and its UPDATE policy includes the `production` and `dispatch` roles (`policies.txt:931`).
- **Executed:** A purchase of 100 rolls left the packaging master at 0 and the inventory item at 100. A dispatch user then typed 5,000 into the master directly, with no movement (`results/r07.txt`).
- **Impact:** Packaging jobs fail for "Not enough packaging material stock" unless someone hand-edits the stock. Neither record reconciles to the purchases.
- **Fix:**
  - Make one stock record authoritative (post purchases to `packaging_materials` through movements).
  - Add a balance guard like `guard_inventory_item_balance`.
  - Add a reconciliation view.

### EXOS-AUD2-012 — A dealer-receipt discrepancy never posts stock, and dealers can edit or delete their own discrepancies

- **P2 / Confirmed (static).**
- **Location:**
  - `public.submit_dealer_receipt_atomic_legacy` (`functions.sql:15687`) posts `inventory_transactions` only for lines where `reported = expected`. Mismatched lines insert only an `inventory_discrepancies` row.
  - The recount (`lib/enterprise/dealer-workflows.ts:50-96`) is two separate non-atomic writes that set `status='resolved'` and post nothing.
  - No other function inserts `inventory_transactions` for discrepancies.
  - The `"discrepancies tenant manage"` policy is `FOR ALL` with `dealer_id = current dealer` (`policies.txt:661`). The table has no audit trigger.
- **Impact:**
  - A shipment line received as 99 of 100 adds nothing to dealer stock, before or after resolution.
  - The claimant dealer can rewrite `expected_quantity`, the status or the resolution, or delete the claim.
- **Fix:**
  - Post the received quantity for every line.
  - Let only the factory side resolve discrepancies, through an RPC that posts the agreed adjustment.
  - Restrict dealers to INSERT and a recount RPC, and add an audit trigger.

### EXOS-AUD2-013 — Dealer stock lives in two ledgers that never meet

- **P2 / Probable (static); NBD.**
- **Location:**
  - Factory → dealer shipments are received into `inventory_transactions` (`dealer_inventory_on_hand`) through `submit_dealer_receipt_atomic_legacy`.
  - Order fulfilment from dealer stock (`functions.sql:2380-2430`) consumes `profile_stock_batches.dealer_id`, created only by dealer manual entry (`app/api/dealer-inventory/items/route.ts`, ±10% of theoretical).
  - Fulfilment debits `inventory_transactions` only when an `inventory_items.item_code = profile_code` exists (`limit 1`).
  - `shipments` and `shipment_items` are `FOR ALL` writable by anyone with `manage_shipments` and are not tied to any factory dispatch or stock deduction.
- **Impact:** Received factory goods are not fulfillable stock; fulfillable stock is self-declared. Dealer-stock totals differ by screen, and a dealer can declare stock that reduces factory manufacturing quantity.
- **Fix:** One dealer-stock ledger, where a shipment receipt creates dealer `profile_stock_batches` with lineage to the factory dispatch. Manual dealer entry is limited to opening balances with approval.

### EXOS-AUD2-014 — Every company user can read, overwrite and delete quote PDFs, dispatch documents/POD, drawings and reports

- **P2 / Confirmed (hosted `pg_policies`).**
- **Location:** The `tenant storage read|insert|update|delete` policies on `storage.objects` for buckets `company-assets`, `profile-drawings`, `die-drawings`, `quote-pdfs`, `dispatch-documents` and `reports` check only `foldername[1] = company_id`, with no role.
- **Impact:**
  - Viewers and dealer users can download other customers' quotes and management reports.
  - Any user can overwrite or delete proof-of-delivery or packing-list files that `dispatches.proof_of_delivery_url` points to.
  - CLAUDE.md §10 says customer-facing users must not see other customers' data.
- **Fix:** Role-based policies per bucket (the pattern already used for `documents`, `technical-drawings` and `maintenance-bills`). Dealer users get only a dealer-scoped prefix. Delete is owner/admin only, with object versioning for POD.

### EXOS-AUD2-015 — Audit-trail coverage gaps and an audit trigger that keeps no values

- **P2 / Confirmed (static).**
- **Location:**
  - 116 of the 148 tables with client write policies have no audit trigger (the list is in `harness/no-audit-tables.txt`). They include `foundry_batches`, both metal-source tables, `outsourced_billet_batches`, `order_items`, `order_billet_requirements`, `packaging_jobs`, `packaging_materials`, `profile_stock_reservations`, `inventory_discrepancies`, `inventory_transactions`, `shipment_items`, `breakdown_logs`, `calibration_records`, `die_trials`, `die_corrections`, `roles`, `user_roles`, `role_permissions` and `companies`.
  - `public.record_enterprise_audit()` stores only the table and operation, and `exception when others` hides failures.
- **Impact:** You cannot answer who changed a metal receipt's status, a reservation, a permission set or a die-correction result, or what the value was before. Permission changes in `role_permissions` and `user_roles` are unaudited.
- **Fix:** One generic row-change audit trigger (old and new JSON, actor, role, txid) on every business table, with failures raised, not swallowed.

### EXOS-AUD2-016 — The hosted data baseline violates the current invariants

- **P2 / Confirmed (hosted read-only queries); NBD (reset or repair before go-live).** Hosted holds test data (1 company, 10 orders, 1 job).
- **Facts:**
  - Batch `F1-20260530-1` is `ready` with **no** `foundry_cast_results` row and no chemistry test. Its 24 billets (6,855.864 kg) are `allocated` to O-2026-0008 (15) and O-2026-0009 (9).
  - Both of that batch's sources, `SCR-2026-0002` and `EAS-2026-0003` (100,000 t), are `rejected`.
  - Job `J-2026-0001` is `in_progress` with 15 allocated billets and **0** issues.
  - `SCR-2026-0001` received 1,000,000 kg and has 900 kg available; only 100 kg of charge is traceable (in a cancelled batch).
  - Every metal source has `rate = 0` and no payable. The inventory items `RM-EXT-ALUMINUM-INGOT-6063` and `SCRAP-CLEAN` are 0 kg with 0 movements, while `EAS-2026-0001` shows 2,899.999 kg available and is not linked to an inventory item.
  - `order_billet_requirements` assumes 5,800 mm, 285.661 kg billets (see AUD2-018).
- **Impact:** If this database becomes the system of record, its opening metal balance, billet genealogy and raw-material valuation cannot be reconciled.
- **Fix:** A go-live data plan: either reset the transactional tables, or run a documented repair (cast result and chemistry for the legacy batch, or scrap its billets; a source disposition; opening balances by count with approval).

### EXOS-AUD2-017 — Rejecting a metal lot after it was charged does not hold the batches and billets made from it

- **P2 / Confirmed (static and hosted); NBD (recall policy).**
- **Location:** No trigger or RPC links source status to `foundry_batches` or `foundry_billets`. On hosted, the allocated billets of `F1-20260530-1` come from two `rejected` lots.
- **Fix:** A disposition RPC that, on a post-charge rejection, lists the dependent batches, billets, jobs and dispatches, and optionally puts the batch on QC hold.

### EXOS-AUD2-018 — No partial-log or remnant model, although hosted billets are 5.8 m logs

- **P2 / Probable; NBD.**
- **Facts:** Hosted billets and requirements are 6″ × 5,800 mm at 285.661 kg. A job needing 14.78 logs is allocated 15. There is no state for a partly used log or a remnant (`foundry_billets.status` has no remnant value, and there is no return-to-stock RPC for a completed job).
- **Impact:** Together with AUD2-002, every job either consumes whole logs, booking the unused remainder (about 63 kg here) as loss, or misstates output. Genealogy for remnant logs used in later jobs is lost.
- **Fix:** Model log → billet cutting, or a remnant billet with parent lineage and a measured weight, returned to stock at completion.

---

## P3 — Low

### EXOS-AUD2-019 — 30 DB functions use the UTC `current_date` instead of the IST `business_today()`

- **P3 / Confirmed (static; hosted `TimeZone = UTC`).**
- **Examples:**
  - `complete_maintenance_schedule_atomic` rejects `done_date > current_date`, so maintenance finished between 00:00 and 05:30 IST is refused as a "future" date.
  - `set_books_locked_through` uses `p_locked_through >= current_date`.
  - The completion, packaging and cast-scrap dates and the business-number years are UTC-based.
  - The full list was produced from `harness/current/functions.sql`.
- **Impact:** Night-shift records are dated to the previous day, and the FY or calendar-year number rollover is off by 5.5 hours.
- **Fix:** Replace `current_date` with `private.business_today()`.

### EXOS-AUD2-020 — Metal receipts are accepted at a zero rate

- **P3 / NBD.**
- **Detail:** No rate or invoice is required for `source_origin='purchased'`, and all hosted receipts are at ₹0 with no payable.
- **Impact:** Raw-material valuation and costing see zero cost.
- **Fix:** Require a rate (or an explicit "rate pending" flag that blocks the charge) for purchased metal.

### EXOS-AUD2-021 — Unrouted generic CRUD clients write invoices and QC directly

- **P3 / Confirmed (static).**
- **Detail:** `components/modules/invoices-client.tsx`, `quality-client.tsx`, `inventory-client.tsx`, `dies-client.tsx`, `customers-client.tsx` and `profiles-client.tsx` (`MasterDataManager`, `master-data-manager.tsx:86-100`) perform direct insert, update and delete. They are not imported anywhere today. DB guards currently block most of their writes, but re-routing one would bypass the RPC workflows.
- **Fix:** Delete them.

### EXOS-AUD2-022 — An operator's "machine_breakdown" production exception does not create a breakdown or lock the press

- **P3 / NBD.**
- **Location:** `public.operator_workflow_command` (`20261022000000_operator_workflow_helpers.sql`) inserts into `production_exceptions` only.
- **Fix:** Have it create a linked open `breakdown_logs` row, or prompt for one.

## IMP

- **IMP-1:** The `authenticated` role has an 8 s `statement_timeout` (hosted `pg_roles`). Dashboard, report and reconciliation RPCs were not load-tested at production volume.
- **IMP-2:** `inventory_items` opening stock can be created by a production manager with any quantity and no approval. It is journaled, but has no reason or approver.

## Negative controls (held)

| Hypothesis | Result |
| --- | --- |
| Owner deletes an invoiced dispatch | Rejected (`Invoice source cannot be changed…`) |
| Direct PATCH of `orders` (stage, value, quantity) by owner or sales manager | Rejected: there is no SELECT grant, so `UPDATE … WHERE` fails |
| Delete a foundry batch or an approved QC inspection | Rejected by guards |
| Charge a `rejected` or `returned` source | Rejected ("Selected foundry source is not usable") |
| Self-approve chemistry | Rejected (EXOS-AUD-001 gate) |
| Concurrent dispatch saves on one order | Serialized (`save_dispatch_atomic` locks the order row) |
| An invoice that omits a packing row | Rejected (`assert_invoice_packing_coverage`) |
| Second dispatch of output that is already packed | Rejected (EXOS-AUD-025 cap), unless the first dispatch is deleted (AUD2-001) |

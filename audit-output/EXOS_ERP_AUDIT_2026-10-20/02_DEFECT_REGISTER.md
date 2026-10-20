# Report 2 — Complete Defect Register

Audit date: 20 October 2026. Source state: `codex/v1` worktree (`61a1530` plus the uncommitted R25/PDF work) and the **live hosted catalog** of Supabase project `pkawmdxtmsdgigsehcmb` (86 ledger rows, 175 tables, 294 functions, 281 triggers, 582 public policies), read with catalog-only queries.

**Evidence labels**

- **Tested** — executed against the PGlite replica of the live catalog (`harness/`), running the exact live function, trigger, constraint and RLS bodies as the PostgREST `authenticated` role. Output is saved in `harness/results/`. These are synthetic, isolated runs; no hosted data was written.
- **Static** — conclusion from code and catalog reading only.
- Line numbers in `supabase/migrations/*` point at the latest file that defines the live body. The hosted ledger order differs from file order (see `BUGS-MEGA.md`), so the **live body** (`harness/live_functions.sql`) is the authority.

Findings already in `BUGS-MEGA.md` (R01–R25, A/B/C/D/F/S, BL, Astra, finance) are not repeated. Where a finding sits close to an earlier one, the relationship is stated.

---

## P1 — High

### EXOS-AUD-001 — Casting records the *planned* billets, not what was cast
- **Severity:** P1 · **Confidence:** Confirmed (Tested R5a–R5d)
- **Modules:** Foundry, billet inventory, allocation, production
- **Workflow:** Furnace charge → melt → chemistry → cast → billet stock
- **Technical location:** `public.sync_foundry_billets` (`20261008000000_foundry_material_integrity.sql:261`, status map at `:282`); `public.guard_foundry_batch_material_integrity` (`…:171`, freeze at `:230`); `public.refresh_foundry_batch_calculations` (`20260930000000_astra_audit_fixes.sql:237`); `public.handle_available_billet_allocation` (`0056_order_billet_requirements_and_allocation.sql:432`); `guard_foundry_billet_material_integrity` (`20261008000000…:314`).
- **What happens:** When the batch status becomes `cast`, one billet row is created for every *planned* `billet_count`. Each gets the theoretical weight π·r²·L·density (21.89 kg in the test). Once the batch leaves `planned`, `billet_count`, `alloy_composition_actual` and every other physical field are frozen. Nothing writes billet status `scrap`, and `foundry_billets` has no UPDATE policy. Each `cast` billet immediately fires `allocate_billets_by_priority`, before `homogenizing` or `ready` and with no chemistry approval.
- **Expected:** Cast count, rejected or cropped billets, measured weights and spectrometer results are recorded after the melt. Only accepted, homogenized and chemistry-approved billets become allocatable stock.
- **Reproduction:** `repro-01` R5. A planned batch of 10 billets moves to `melting`. Entering spectro results fails with *"freeze after planning"*, and so does reducing the count to 8. Moving to `cast` creates 10 `cast` billets of 21.89 kg. The owner's attempt to mark billet 1 as scrap updates 0 rows.
- **Business impact:** Billet stock is overstated by every casting reject. Billets that are out of chemistry or not yet homogenized are allocated to orders. The "actual chemistry" field can only hold a pre-melt guess. Melt loss (charge minus good billets) is never recorded.
- **Cross-module:** Allocation, production mass balance (input = theoretical weight), recovery KPIs, traceability (heat → billet).
- **Root cause:** The model treats the batch plan as the casting outcome. There is no post-cast record and no billet disposition writer.
- **Fix:** Add a cast-result step: actual good count, per-billet or bundle measured weight, rejects with reason, dross and skim kg, and a chemistry test linked to a lab result with pass/fail. Gate `cast → ready` on approved chemistry. Allocate only `ready` billets. Add an audited billet-reject RPC.
- **Regression test:** Planned 10 → cast 8 good + 2 rejected → only 8 allocatable. Failed chemistry → 0 allocatable. Measured weights flow into the job mass balance.
- **Related:** S02/S03 (earlier count and density edits) fixed edit drift but kept the plan-equals-outcome model.

### EXOS-AUD-002 — Any user can create recyclable "clean" metal from nothing, and cannot correct it
- **Severity:** P1 · **Confidence:** Confirmed (Tested R1, R1b, R1c)
- **Modules:** Scrap, foundry sources, foundry, inventory
- **Location:** policy `"scrap_records tenant insert"` (`20260512_phase3_operational_depth.sql:205`, company check only); `public.sync_process_scrap_to_foundry` (`20260809000007_process_scrap_recovery_loop.sql:8`); `scrap_records` has no UPDATE or DELETE policy.
- **What happens:** A `viewer` inserts `scrap_records(scrap_type='process_scrap', weight_kg=5000)` with no production job. The AFTER INSERT trigger creates `SCR-2026-0001`, `in_house`, `clean`, `available`, 5,000 kg, ready to charge into a furnace. Neither the viewer nor the owner can delete or correct the record; the delete silently affects 0 rows. Nothing checks that the scrap belongs to a job, that its weight is plausible, or that the user has a production role.
- **Expected:** Only completion or an authorized scrap workflow may post process scrap. The posting must be tied to a job and its mass balance, and a correction must be possible through a reversal.
- **Business impact:** Metal inventory can be fabricated, then laundered into billets and finished goods. An honest mistake becomes permanent.
- **Root cause:** A tenant-only insert policy on a table that drives a stock-creating trigger, with no reversal path.
- **Fix:** Revoke direct INSERT. Post scrap only through a SECURITY DEFINER RPC with a role check, a job link, and a cap from the job's open balance. Add a reversal RPC that retires the derived foundry lot only if it is unconsumed.
- **Regression test:** Viewer insert is rejected. Production insert without a job is rejected. Reversal of an unconsumed lot succeeds; reversal of a consumed lot is rejected.

### EXOS-AUD-003 — Foundry source balances are hand-editable; editing a used scrap lot restores its full weight
- **Severity:** P1 · **Confidence:** Confirmed (Tested R2, R3; live data)
- **Modules:** Foundry sources (scrap, external ingot), foundry, inventory, expenses
- **Location:** `components/modules/operations/record-form-client.tsx:846` (`if (moduleKey === "foundry_scrap" && !payload.available_weight_kg) payload.available_weight_kg = payload.weight_kg;`); `lib/validations/schemas.ts:534` (coerces `""` to `0`); `components/modules/operations/module-config.ts:579` (field read-only but posted), `:586` (editable status); policy `"foundry scrap tenant update"` (`0051_foundry_sources_scrap_billets_packaging.sql:456`). Only an expense-sync trigger runs on update; there is no CHECK that available ≤ weight.
- **What happens:**
  1. A lot that is fully charged (`available_weight_kg = 0`) is edited for any reason, for example a note. `0` is falsy, so the form posts `available_weight_kg = weight_kg` and the lot shows its full weight available again. In R3 a 1,000 kg used lot returned to 1,000 kg available.
  2. A `production` user can set any balance and status through REST: a 1,000 kg used lot was set to 25,000 kg `available` (R2).
- **Live evidence (read-only query, 20 Oct):** `SCR-2026-0001` weight 1,000,000 kg, available 900 kg, consumed 0 kg; 999,100 kg is unexplained. `SCR-2026-0002` is `available` while partly consumed, although the delta writer would have set `reserved`. `EAS-2026-0003` weight is 100,000,000 kg.
- **Expected:** Availability is derived from receipts minus charges (a ledger), or it is writable only by `apply_foundry_source_delta`. Corrections go through an audited adjustment.
- **Business impact:** Charged metal reappears, gets charged again, and billets are cast from metal that no longer exists. The source register and expense quantities diverge.
- **Fix:** Remove `available_weight_kg` and `status` from user updates (column privilege or trigger guard). Block `weight_kg` below the consumed quantity. Add `CHECK (available_weight_kg <= weight_kg)`. Fix the falsy-zero test (`== null`) and only default the value on create. Reconcile the existing rows.
- **Regression test:** Edit a used lot's notes → available stays 0. Direct REST update of available → rejected. Weight below consumed → rejected.

### EXOS-AUD-004 — Editing an outsourced billet receipt rewrites consumed billets and leaves surplus or cancelled billets in stock
- **Severity:** P1 · **Confidence:** Confirmed (Tested O1–O3)
- **Modules:** Outsourced billets, billet stock, production history, traceability
- **Location:** `public.sync_outsourced_billets` (`0055_billet_inventory_and_outsourced_billets.sql:122`); `guard_foundry_billet_material_integrity` returns early for non-in-house billets (`20261008000000_foundry_material_integrity.sql:335`, `if new.source_type <> 'in_house' then return new`); edit page `app/(dashboard)/foundry/outsourced-billets/[id]/edit` and the update policy (`0055…:28`).
- **What happens:** A receipt of 10 billets, 220 kg, alloy 6063/T6, where billets 1–2 are already consumed. A `production` user edits it to alloy 6061/T5, 440 kg, 4 billets. The consumed billets become 6061/T5 at 110 kg each, up from 22 kg. Billets 5–10 stay `cast` and allocatable. Setting the receipt to `cancelled` leaves 8 billets `cast`.
- **Expected:** Material identity and weight are frozen once billets are allocated, issued or consumed. Count reductions and cancellations retire unused billets, or are blocked.
- **Business impact:** Completed production's input mass and alloy are rewritten after the fact, which falsifies recovery and genealogy. Phantom billets stay in stock.
- **Fix:** Apply the in-house commitment rules to outsourced billets. Have the sync cancel billets above the count, cancel all unused billets when the receipt is cancelled, and block the change if any are committed.
- **Regression test:** O1–O3 inverted. Each must be rejected, or cancel exactly the uncommitted billets.
- **Related:** S03 fixed the same class of defect for in-house batches only.

### EXOS-AUD-005 — A furnace charge accepts metal of a different alloy; scrap carries no alloy at all
- **Severity:** P1 · **Confidence:** Confirmed (Tested R4)
- **Modules:** Foundry, scrap, chemistry, traceability
- **Location:** `private.apply_foundry_source_delta` (`20261008000000_foundry_material_integrity.sql:5`) checks company, status and available weight only. `foundry_aluminium_scrap` has no alloy column (live `information_schema`).
- **What happens:** A 6061 ingot lot was charged into a 6063 batch, and 273.625 kg was debited from it. Process scrap from every alloy lands in one alloy-less `clean` pool.
- **Expected:** The source alloy or series must be compatible with the batch alloy, or carry an approved deviation, and scrap must keep its alloy for segregation.
- **Business impact:** Chemistry drifts out of specification without any warning, and a customer complaint cannot be traced back to the alloy that caused it.
- **Fix:** Add alloy (and quality grade) to scrap lots and propagate it from the job's billets. Enforce a compatibility matrix at charge time, with an audited override.
- **Regression test:** A 6061 source into a 6063 batch is rejected without an override. Process scrap inherits the job alloy.

### EXOS-AUD-006 — Production loss is booked 1:1 as "clean", available, alloy-less recoverable scrap
- **Severity:** P1 · **Confidence:** Confirmed (Tested P3); the recovery factor itself is a business decision
- **Modules:** Production completion, scrap, foundry, metal balance
- **Location:** `private.complete_production_job_atomic` inserts `'process_scrap'` for the declared loss (`20260718021500_floor_output_and_finishing_workflows.sql:224`). `sync_process_scrap_to_foundry` then creates a `clean`/`available` lot of the same kg (`20260809000007…:8`).
- **What happens:** A job completed with 600 kg output and 400 kg declared loss creates a 400 kg `clean` `available` in-house lot with no alloy. Oxidation, dross and measurement loss are all treated as recoverable metal. Butt scrap and other `scrap_type` values are *not* synced, so recovery depends on the label. The lot is created at trigger depth 2, so `sync_scrap_inventory_and_expense` returns early and no inventory movement is posted.
- **Expected:** Split the loss into recoverable scrap by category and alloy, and unrecoverable loss. Have the scrap weighed before it becomes foundry input.
- **Business impact:** Recyclable metal is overstated, the foundry balance inflates, and the metal accounts never close.
- **Fix:** Require categorised scrap lines (butt, front/back end, saw, rejects, unrecoverable). Create foundry lots only from weighed recoverable categories, inheriting alloy. Post an inventory movement.
- **Regression test:** Completion with 400 kg loss, of which 300 is butt and 100 unrecoverable → 300 kg alloy-tagged lot; 100 kg in loss reporting.

### EXOS-AUD-007 — One physical die can run on two presses at the same time
- **Severity:** P1 · **Confidence:** Confirmed (Tested P1)
- **Modules:** Dies, production planning, scheduling
- **Location:** `private.enforce_production_schedule_integrity` (`20260723010000_production_schedule_integrity.sql:6`, checks press overlap and one active slot per job only); `private.validate_production_slot_release_resources` (`20261008020000_factory_workflow_integrity.sql:682`) and `private.validate_production_start_resources` (`…:635`, die status and profile only).
- **What happens:** Jobs J-A (press A) and J-B (press B) both use die D-100. Both are scheduled 10:00–14:00 on the same day, both released, and both are `in_progress` at once.
- **Expected:** A die (`dies.id` is one physical die) can hold at most one released or running slot in overlapping windows.
- **Business impact:** The schedule is physically impossible. Production records attribute output to a die that was on another press, and die history becomes unreliable.
- **Fix:** Add a die-overlap check under the same advisory lock pattern, keyed on `die_id`, at schedule, release and start.
- **Regression test:** P1 must fail at the second release.

### EXOS-AUD-008 — Unauthorized roles control press and die status, the only production lockout
- **Severity:** P1 · **Confidence:** Confirmed (Tested R6a, R6b)
- **Modules:** Machines, dies, maintenance, production
- **Location:** policies `"machines tenant update"` / `"machines tenant insert"` (`20260512_phase3_operational_depth.sql:152`, tenant check only); `"dies tenant update"` (`supabase/rls.sql:98`, includes `sales` and `sales_manager`); `machines.status` has no CHECK constraint.
- **What happens:** A `viewer` moved press B from `breakdown` to `idle`, which makes it eligible for release and start. A `sales` user moved a `retired` die back to `active` through the table. The die RPC `update_versioned_entity_atomic` *rejects* sales, so authorization differs by path.
- **Expected:** Only maintenance or production authority changes equipment and die readiness, with a reason and a return-to-service sign-off.
- **Business impact:** A press locked out after a breakdown can be put back into the schedule by anyone, which is a safety and quality risk. A retired die can be scheduled.
- **Fix:** Restrict UPDATE to the maintenance and production roles, add a status CHECK, and route status changes through an audited RPC that requires a resolved breakdown or maintenance record for return to service.
- **Regression test:** R6a and R6b must fail. A return to service without a closed breakdown must fail.

### EXOS-AUD-009 — Dispatch staff cannot record any delivery-status change
- **Severity:** P1 (operational blocker) · **Confidence:** Confirmed (Tested P4b)
- **Modules:** Dispatch, orders, billet allocation
- **Location:** `public.allocate_billets_by_priority` role guard (`20261020090729_priority_billet_allocation_integrity.sql:28`), reached through trigger `handle_order_billet_requirements` (AFTER UPDATE OF `current_stage` on `orders`, `20261015040000_direct_priced_orders.sql:539`), which is fired by `private.sync_order_delivery_stage` (`20260718021000_dispatch_readiness_and_delivery.sql:137`).
- **What happens:** A `dispatch` user moves a dispatched shipment to `in_transit`. The order-stage sync updates `orders.current_stage`, the billet trigger calls the allocator, and the allocator raises *"Permission denied to allocate billets"*, which rolls back the delivery update. The same happens to `dispatch_manager` and `inventory_manager`, and to activation in `save_ready_dispatch_atomic` whenever the stage changes. Owner, admin and factory_manager are not affected.
- **Expected:** Delivery updates by the dispatch roles succeed. An allocation side effect never vetoes an unrelated workflow.
- **Business impact:** The dispatch team cannot do its job, so shipments get recorded by managers or not at all.
- **Fix:** In `handle_order_billet_requirements`, skip the allocator when only `current_stage` changes, or run the allocator as a system context that does not check the caller's role. Add role-matrix tests for every order-stage writer.
- **Regression test:** P4b must pass for `dispatch`, `dispatch_manager` and `inventory_manager`.
- **Related:** The guard has existed since `20261008020000`, and R25 kept it.
- **Additional evidence (gate-wave1):** the same veto blocks **sales quote conversion**. `convert_quote_to_order_atomic` called by `sales` fails with *"Permission denied to allocate billets"* on the order insert.

### EXOS-AUD-010 — Stock-reservation dispatch: the app cannot ship it, and the RPC prices it from any order line
- **Severity:** P1 · **Confidence:** Confirmed (Tested P6a, P6b, repro-05)
- **Modules:** Finished-goods stock, dispatch, invoicing
- **Location:** reservation source select omits commercial lineage (`lib/actions/dispatches.ts:56`); the builder copies `order_item_id` and `net_rate` from the source line (`lib/pcda/dispatch.ts:249`, `:252`); `private.canonicalize_packing_commercial_lineage` returns early for `reservation` without deriving them (`20260721091620_quote_atomic_dealer_lineage.sql:781`); `private.canonicalize_packing_tax` requires an order or quote line (`20260930000000_astra_audit_fixes.sql:211`).
- **What happens:**
  1. The app's own builder, run in repro-05, produces reservation bundles with `order_item_id`, `quote_item_id` and `net_rate` all null. The live tax trigger rejects them with *"Packing requires an authoritative commercial source and GST rate"*. A reserved-stock shipment cannot be made from the UI.
  2. Called directly, `save_ready_dispatch_atomic` accepts any `order_item_id`, including a line of a different order with the same profile, and any `net_rate`. In P6b an order A reservation was packed at ₹1/kg against an order B line. That rate goes straight onto the invoice through `canonicalize_invoice_packing_line`.
- **Expected:** The packing line derives rate and GST from the reservation's own order line, as production and dealer sources already do.
- **Business impact:** Stock fulfilment is blocked. Where a workaround exists, invoice price and GST are controlled by the dispatcher.
- **Note:** The parallel acceptance run (`scripts/run-local-reservation-invoice-acceptance.mjs:65-68`) passes because it supplies `order_item_id` and `net_rate` itself. That is the client-trusted path.
- **Fix:** Link each reservation to an order line, either at reservation time or by deriving it from (order, profile, finish). Overwrite `order_item_id`, `quote_item_id` and `net_rate` in the trigger for reservation sources and reject mismatches.
- **Regression test:** UI builder path succeeds with the order-line rate. A forged foreign line or rate is rejected.

### EXOS-AUD-011 — Any company user can rewrite a shipped dispatch's legal documents and mark it returned
- **Severity:** P1 · **Confidence:** Confirmed (Tested C1)
- **Modules:** Dispatch, e-way bill and LR, credit notes, receivables
- **Location:** permissive policies `"dispatches tenant update"` and `"dispatches tenant insert"` (`20260512_phase1_rls_fixes.sql:123`, tenant check only), which overlap the role-restricted `"dispatch tenant update"`. `validate_dispatch_transition` (`20260812010000_dispatch_return_and_manifest_integrity.sql:20`) freezes only weight and bundle totals (`:43`).
- **What happens:** A `viewer` changed a dispatched shipment's e-way bill (EWB-111 → EWB-999), vehicle number and LR number, then set the status to `returned`. The history row is attributed to the viewer.
- **Expected:** Logistics documents are frozen after activation, with corrections through an audited amendment. Return or damage is recorded by dispatch or accounts with evidence.
- **Business impact:** Statutory transport documents can be falsified after goods leave. A false "returned" status lets accounts issue a 100% credit note (see EXOS-AUD-016), which wipes out a receivable.
- **Fix:** Drop the unrestricted policies. Freeze `eway_bill_number`, `lr_number`, `vehicle_number`, `transporter_name` and `dispatch_date` after activation. Route returns through a dedicated RPC with role checks and a reason or evidence.
- **Regression test:** C1 must fail for the viewer. Dispatch role amendments go through the RPC and are logged.

### EXOS-AUD-012 — QC release does not check results, allows self-approval, and can be switched off
- **Severity:** P1 · **Confidence:** Confirmed (Tested P5; flag path static)
- **Modules:** Quality, dispatch, production
- **Location:** `public.validate_quality_production_link` (`20261019020000_finishing_accepted_dispositions.sql:236`; approval requires only `inspector_name` and `surface_finish_ok`, at `:279`); policy `"quality inspections role insert"` (`20260718020000_production_quality_packaging_handoffs.sql:224`, includes `production_manager`); QC dispatch gate tied to `feature_flags.quality_compliance` (`20261019020000…:478`, and `lib/actions/dispatches.ts:61-66`).
- **What happens:** A `production_manager` approved 600 kg of their own job's output with hardness 2 HW (T6 nominally needs about 12+), 1.6 kg/m against a nominal 1.0 kg/m, and a free-text note saying the dimension failed. `inspector_name` is free text and not tied to a user. Setting `quality_compliance.is_enabled = false` (owner or admin) removes the QC requirement from the dispatch gate.
- **Expected:** Approval checks measured values against the profile specification or quality plan (`profile_quality_plans` exists but is not enforced). The approver is an authenticated quality user who is not the producer. The release gate is not a toggle, or the toggle needs dual approval and is logged.
- **Business impact:** Non-conforming, wrong-temper or overweight profiles can be released and shipped as approved.
- **Fix:** Record `approved_by = auth.uid()`. Exclude production roles from approval, or require a second approver. Validate against tolerance from `aluminium_profiles` and `profile_quality_plans`. Put the gate toggle under audited dual control.
- **Regression test:** P5 must fail. An approval with in-spec values by `quality` passes. A gate toggle writes an audit record.

### EXOS-AUD-013 — Finished-goods stock batches carry no production, heat, alloy or QC origin
- **Severity:** P1 (traceability) · **Confidence:** Confirmed (Static: live columns)
- **Modules:** Finished-goods stock, reservations, dispatch, dealer stock, traceability
- **Location:** `profile_stock_batches` columns (live): `profile_id, finish, length_m, quantity_pieces, total_weight_kg, bundle_number, location, status, dealer_id…`. There is no `production_job_id`, billet, heat, alloy, temper, QC or origin column. Insert policy allows owner, admin, inventory_manager and production roles, plus dealers for their own stock. Dealer manual entry is at `app/api/dealer-inventory/items/route.ts`.
- **What happens:** Stock-sourced and dealer-stock shipments can never be traced back to a job, billet or heat. Stock can be entered with any weight and pieces, with no reconciliation to section weight, and with no QC status.
- **Expected:** Every finished-goods batch has an origin (production receipt, return, or opening balance with approval) and a QC disposition. Pieces × length × kg/m must reconcile within tolerance.
- **Fix:** Add origin columns and FKs. Create batches only from QC-released packaging (surplus) or an approved opening-stock journal. Add a quality-hold status.
- **Regression test:** A batch without an origin is rejected. Dispatch from a held batch is rejected.

---

## P2 — Medium

### EXOS-AUD-014 — A job can be completed with no metal input, and finished goods are created from it
- **Severity:** P2 · **Confidence:** Confirmed (Tested P2, P2b)
- **Location:** `private.complete_production_job_atomic` skips the mass balance when there are no linked billets and no requirement (`20260718021500_floor_output_and_finishing_workflows.sql:159`); `link_billets_to_production_job` (`20260718020500_finishing_route_and_quality_yield.sql:90`).
- **What happens:** 900 kg output was recorded with 0 billets. A 900 kg mill-finish packaging job was created automatically.
- **Expected:** Every completion needs input evidence (billets, or approved externally supplied input) unless an authorized "input not tracked" exception is recorded.
- **Fix:** Require linked input for every extrusion completion, or an explicit audited exception. Report exception jobs separately in recovery.

### EXOS-AUD-015 — Cancelling a job strands its billets; the job save does not check job status
- **Severity:** P2 · **Confidence:** Confirmed (Tested P7)
- **Location:** `private.transition_production_job_atomic` (`20261008020000_factory_workflow_integrity.sql:940`), no billet release on `cancelled`; `private.save_production_job_atomic` (live body; last applied definition `20260809000004_production_billet_release_and_compat.sql:10`; the unapplied candidate `20261020162949…:7` keeps this behavior) never checks `status`.
- **What happens:** An on-hold job with 2 `issued` billets was cancelled, and the billets stay `issued` and linked to it. No allocation path can pick them up. The only way out is to edit the cancelled job, which the save function permits.
- **Fix:** On cancellation, return unconsumed billets to `allocated` (or `cast`) and record partial consumption or scrap for heated billets. Reject saves on completed or cancelled jobs.

### EXOS-AUD-016 — Rejected and returned material leaves the books; every return credit is 100%
- **Severity:** P2 · **Confidence:** Confirmed (Static)
- **Location:** The only `scrap_records` writer is `complete_production_job_atomic` (live catalog, one `insert into public.scrap_records`). `issue_dispatch_return_credit_note_atomic` copies the full invoice totals (`20261015030000_credit_note_retry_binding.sql:75`). No function moves returned goods into stock or quarantine.
- **What happens:** QC-rejected kg, finishing rejection kg and returned or damaged dispatches never become scrap, remelt input or held stock. A return of one bundle out of twenty still credits the whole invoice.
- **Fix:** Disposition workflows for rejects and returns: quarantine stock → rework, scrap (alloy-tagged) or scrap-sale. Partial credit notes by returned packing rows. Debit notes.

### EXOS-AUD-017 — The exposed low-level dispatch RPC can mark an order delivered with nothing shipped
- **Severity:** P2 · **Confidence:** Confirmed (Tested P4)
- **Location:** `public.save_dispatch_atomic` is granted to `authenticated` (live grants). `private.save_dispatch_atomic` sets `orders.current_stage` from `p_order_stage` (`20260723060000_exact_dispatch_manifest_and_consolidation.sql:141`).
- **What happens:** A `factory_manager` created a *pending* dispatch with `p_order_stage='delivered'`, and the order became `delivered`. No stock moved, there is no proof of delivery and no activation.
- **Fix:** Revoke EXECUTE on the low-level RPC (the app uses `save_ready_dispatch_atomic`), or remove `p_order_stage`. Stages should only be derived by `sync_order_delivery_stage`.

### EXOS-AUD-018 — Order delivery stage gets stuck after a return or a normal production shortfall
- **Severity:** P2 · **Confidence:** Confirmed (Static)
- **Location:** `private.sync_order_delivery_stage` (`20260718021000_dispatch_readiness_and_delivery.sql:137-205`).
- **What happens:** `returned` and `damaged` dispatches count as "open" forever, so the order never reaches `delivered`, even after a replacement is delivered. Required kg is the maximum of order, line, and planned jobs plus stock, with no tolerance. Delivering 980 kg against a 1,000 kg plan leaves the order `dispatched` indefinitely.
- **Fix:** Exclude closed exception dispatches once they are resolved. Compare against the contractual quantity with a configured tolerance, or a short-close action.

### EXOS-AUD-019 — Audit trail rows can be forged under another user's name
- **Severity:** P2 · **Confidence:** Confirmed (Tested C3)
- **Location:** policy `"audit logs tenant insert"` (`20260513_enterprise_phase1_foundation.sql:293`) and `"audit enterprise insert"` (`0040_access_control_dealer_workflows.sql:541`), both tenant-only. `actor_id` and `actor_user_id` are taken from the client.
- **What happens:** A `viewer` inserted `payment_recorded` (`audit_logs`) and `invoice_approved` (`audit_logs_enterprise`) rows attributed to the owner.
- **Fix:** Write audit rows only from SECURITY DEFINER code, or force `actor_id = auth.uid()` in a BEFORE trigger. Revoke client INSERT.

### EXOS-AUD-020 — Die identity, profile and production history are editable while the die is in use
- **Severity:** P2 · **Confidence:** Confirmed (Tested C4; KPI feed static)
- **Location:** `private.update_versioned_entity_atomic` die field list (`20260929000000_business_logic_fixes.sql:991`, `:1024`). No function updates `dies.total_production_kg`, `total_runs` or `last_used_date` (live catalog).
- **What happens:** A `production_manager` renumbered D-100 to "D-REUSED", moved it to another profile, and set 250,000 kg / 900 runs while job J-RUN was running on it. Die life, cost per kg and "Life Review" alerts (`lib/calculations/operations.ts`) use these manual numbers.
- **Fix:** Freeze `die_number` and `profile_id` once the die has history (use a new die record or an audited transfer). Derive production kg, runs and last-used date from completed jobs.

### EXOS-AUD-021 — Profile master changes apply instantly to open orders, jobs and allocations
- **Severity:** P2 · **Confidence:** Confirmed (Tested C5) / Needs Business Decision
- **Location:** `update_versioned_entity_atomic` profile branch (`20260929000000_business_logic_fixes.sql:991`).
- **What happens:** The owner changed P-100 from 1.000 to 1.35 kg/m, 6063 to 6061, and 4″ to 6″ billet while a job was open. Billet compatibility, readiness and weight calculations for open work switch to the new values with no warning. A revision is stored, but nothing checks the impact.
- **Decision needed:** Should master changes apply to new documents only (with versioned profile references), or need re-approval for open work?

### EXOS-AUD-022 — The inventory ledger and stock balances are decoupled
- **Severity:** P2 · **Confidence:** Confirmed (Tested R7; others static)
- **Location:** policy `"inventory_movements tenant insert"` (`20260512_phase3_operational_depth.sql:81`, any user); there is no trigger from `inventory_movements` to `current_stock`. `private.post_source_inventory_change` clamps stock at zero (`20261020010000_expense_ledger_integrity.sql:1352`). `apply_foundry_source_delta` never touches `inventory_items`.
- **What happens:** A viewer posted `adjustment_in` 9,999 kg and stock stayed at 100. Negative stock is silently corrected to 0 instead of being rejected. Scrap and ingot `inventory_items` rise on purchase but never fall when charged, so the inventory module overstates furnace stock. The live `inventory_items` table currently has 0 rows, so the balances cannot be reconciled on live data.
- **Fix:** Treat movements as the source of truth (balance is the sum of movements, or a trigger maintains it). Restrict inserts to definer RPCs. Reject negative balances. Post a foundry consumption movement.

### EXOS-AUD-023 — No accounting period lock; financial dates can be backdated freely
- **Severity:** P2 · **Confidence:** Confirmed (absence) / Needs Business Decision
- **Location:** No period, lock or close column or function exists in the live catalog. Invoice date is a client value (`private.save_invoice_atomic`, `20261019000000_retained_dispatch_invoices.sql:307`). Payment date only blocks future dates (`private.record_payment_atomic`), so it can predate the invoice.
- **What happens:** Invoices, receipts and expenses can be dated into closed months. Business numbers take the backdated financial year's sequence.
- **Fix:** A company period-close table, enforced in every financial writer. Payment date must be on or after the invoice date. Owner override with a reason.

### EXOS-AUD-024 — Dealer inventory entry always fails, and its length unit contradicts the database
- **Severity:** P2 · **Confidence:** Confirmed (Static vs live schema)
- **Location:** `app/api/dealer-inventory/items/route.ts:52` inserts `notes`, but `profile_stock_batches` has no `notes` column, so PostgREST rejects every request. `components/modules/dealer-inventory-entry-client.tsx:28,82` labels "Length m" with a default of 5.8 (per piece). The database treats `length_m` as the batch's *total* metres (`consume_dispatch_reservations`; `create_order_from_quote_with_dealer_stock`, `20261013010000_dealer_fulfillment_integrity.sql:14`).
- **Fix:** Add the column or drop the field. Capture per-piece length and store total metres = pieces × length. Reconcile against kg/m.

### EXOS-AUD-025 — Dispatch caps don't track packaging, and returned shipments consume capacity forever
- **Severity:** P2 · **Confidence:** Confirmed (Static)
- **Location:** `private.assert_dispatch_ready`, mill-finish branch: QC cap only, packaging checked for *existence*. Packed kg is summed over all dispatches regardless of status (`20261019020000_finishing_accepted_dispositions.sql`, around `:478`; same logic in `lib/actions/dispatches.ts:166-187`).
- **What happens:** A 50 kg completed packaging job unlocks dispatch of the whole QC-approved weight. A returned shipment's packing rows still count as shipped, so the same output can never be re-dispatched (no replacement path).
- **Fix:** Cap by completed packaging kg. Exclude, or explicitly reverse, packing rows of returned dispatches once the goods are dispositioned.

### EXOS-AUD-026 — The quote's per-kg rate does not reproduce the quoted value on the invoice
- **Severity:** P2 · **Confidence:** Confirmed (math) / Needs Business Decision
- **Location:** `public.recalculate_quote_item_financials` (`net_rate := price_per_kg = line_total / billing_weight`); `lib/calculations/quote.ts:124-140`. Invoice line = net kg × `net_rate` (`private.canonicalize_invoice_packing_line`).
- **What happens:** Billing weight includes `scrap_allowance_percent` and the minimum billing weight. Line total includes the full die charge, packing, transport and other charges. Example: theoretical 1,000 kg with 5% allowance → billing 1,050 kg, rate = total / 1,050. Shipping 1,000 kg invoices 4.8% less than quoted. The minimum billing weight is never billed, and die and freight charges are prorated by kg shipped. `invoice_calc_uom` (per metre or piece) is ignored.
- **Decision needed:** The intended billing basis (theoretical, actual, or minimum), and whether one-off charges are separate invoice lines with their own HSN and GST.

### EXOS-AUD-027 — Maintenance is not connected to the machines it maintains
- **Severity:** P2 · **Confidence:** Confirmed (Static)
- **Location:** `breakdown_logs.machine_id` and `maintenance_schedules.machine_id` are `text` with no FK (live columns). `app/(dashboard)/maintenance/page.tsx:151,207` only inserts. `apply_breakdown_spare_part_usage` (`0036_phase_5_to_10_operational_hardening.sql:177`) is BEFORE INSERT only.
- **What happens:** Breakdowns don't change machine status. Schedules never complete, roll forward or turn overdue. Downtime isn't reconciled with production slots. Deleting or editing a spare-part usage doesn't restore stock.
- **Fix:** FK to `machines`, a lifecycle RPC (open → in progress → resolved → return to service), next-due recompute, downtime intervals with an overlap check, and reversible spare-part postings.

---

## P3 — Low

### EXOS-AUD-028 — Management KPIs use inconsistent definitions
- **Confidence:** Confirmed (Static)
- **Locations and issues:**
  - Command center recovery uses gross extruded `actual_quantity_kg` (`app/(dashboard)/command-center/page.tsx:193-197`). The PCDA function calls this argument `outputGoodKg` (`lib/calculations/pcda/recovery.ts:28`), but QC rejects are never deducted.
  - `get_dashboard_snapshot` dispatch weight MTD includes `returned` and `damaged` (`20261008040000_management_metrics_integrity.sql:173`).
  - Production attainment divides kg completed this month by kg *planned* this month, which are different job sets.
  - "Scrap this month" sums every `scrap_type`, including any fabricated records (EXOS-AUD-002).
- **Fix:** Publish one KPI dictionary (good-output recovery, net shipped kg) and compute every KPI in one SQL source.

### EXOS-AUD-029 — No plausibility limits on receipt quantities
- **Confidence:** Confirmed (live data): `EAS-2026-0003` is 100,000,000 kg; `SCR-2026-0001`/`0002` are 1,000,000 kg each.
- **Fix:** Configurable per-receipt maximum and a warning band. A vendor weighbridge reference above a threshold.

### EXOS-AUD-030 — Client roles hold TRUNCATE and full DML grants on most tables
- **Confidence:** Confirmed (live `role_table_grants`): `anon` and `authenticated` have `TRUNCATE` on almost every public table, including `audit_logs_enterprise`, `sensitive_action_logs`, `invoices` and `foundry_billets`. Row-level append-only triggers do not fire on TRUNCATE, and RLS does not apply to it.
- **Risk:** Not reachable through PostgREST today. It is defense-in-depth only, but any future invoker SQL path would be catastrophic.
- **Fix:** `REVOKE TRUNCATE … FROM anon, authenticated`. Revoke `anon` DML on business tables.

### EXOS-AUD-031 — Saving the production plan marks billets "issued"
- **Confidence:** Confirmed (Static). `save_production_job_atomic` sets selected billets to `issued` on save, not at physical issue, so "issued" stock overstates material at the press. **Fix:** a separate issue scan or confirmation step.

### EXOS-AUD-032 — "Create Task" leads nowhere
- **Confidence:** Confirmed (Static). `app/(dashboard)/tasks/new/page.tsx` redirects to `/tasks`, a non-functional create route (CLAUDE.md §5.8).

### EXOS-AUD-033 — Policy hygiene: unrestricted policies are masked only by grants
- **Confidence:** Confirmed (Static, plus a Tested negative). `production_jobs` INSERT and UPDATE policies are tenant-only. A viewer insert (C2) failed only because of an incidental `order_items` grant error inside a trigger, not because of an authorization rule. `dispatches` has duplicate restricted and unrestricted policies (see EXOS-AUD-011). **Fix:** role-explicit policies, and a policy linter in CI.

---

## Missing functionality (not defects in implemented code)

| Area | Observation | Impact |
| --- | --- | --- |
| Procurement | No purchase order, goods receipt, or rejected-quantity / 3-way match. Receipts are created as foundry source or expense rows. | Supplier invoice matching and rate variance cannot be controlled. |
| General ledger / costing | No journals, COGS, WIP or inventory valuation. `expense_ledger` is a payables register. | Financial integrity relies on the external accounting system (Tally). Manufacturing cost is quote-side only. |
| Chemistry lab | No spectrometer test entity, retests or approvals. | Melt and billet chemistry cannot be proven. |
| NCR / complaints | Only `quality_rework_resolutions`. | Customer complaint traceability is missing. |
| Downtime / OEE | Only `breakdown_logs.downtime_minutes` (free text machine). | Machine utilization cannot be computed. |
| Customer advances / debit notes / partial credit notes | Payments require an invoice. Credit notes are 100% for returns only. | Common Indian MSME commercial cases are not representable. |
| E-way bill integration | Free-text field only. | Statutory compliance is manual. |

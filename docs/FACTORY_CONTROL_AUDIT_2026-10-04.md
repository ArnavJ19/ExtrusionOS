# Factory management, process control and production-logic audit

Date: 4 October 2026. Fifth audit pass. Focus: whether the factory can safely authorize work, allocate material, schedule/recover press work, record real output, and preserve quantity evidence through finishing, QC, packing and dispatch.

## Management assessment

The system has useful controls in individual workflows, but they are not consistently enforced at every entry point and handoff. A job's earlier readiness is treated as sufficient for later execution; alternate save paths can avoid completion checks; recovery from a hold conflicts with the scheduler; factory-manager permissions differ between application and database.

Factory process-control sign-off remains NO-GO. This is a software-control assessment, not certification of machinery safety or actual shop-floor practice. No numerical readiness percentage is assigned without agreed acceptance scenarios and live evidence.

## F01 - P1: Stale readiness permits release/start after resources become unavailable

Scheduling validates an open order, a usable die and an active available extrusion press. The later release function only checks the scheduled slot and linked job existence. The start transition checks that a matching released slot exists. The reference trigger checks company/identity/machine type, while the status trigger checks transitions and released-slot existence. Neither repeats the current order, press-availability or die-status eligibility checks at this execution boundary.

Executed sequence:

1. Schedule a planned job against an open order, active die and active extrusion press.
2. Deactivate the press and mark it under maintenance; block the die; cancel the order.
3. Release the existing schedule slot, then start the job as `factory_manager`.
4. Both calls succeed and the job becomes `in_progress`.

The fixture includes actual scheduling, release and start functions, scheduling conflict checks, production reference checks, status checks and completion checks. It does not replay every migration or prerequisite/lineage trigger. In particular this does not assert that all possible jobs can start without billet linkage; it isolates stale order/resource readiness using an already scheduled job.

Business impact: the software can authorize continued work for a cancelled customer commitment or on resources now marked unavailable. Resource status changes do not reliably withdraw prior scheduling permission.

Sources: `supabase/migrations/20260723010000_production_schedule_integrity.sql:68`, `:186`; `supabase/migrations/20260810000000_tenant_boundary_and_dealer_workflow_hardening.sql:350`; `supabase/migrations/20260810010000_manufacturing_reference_and_material_guards.sql:5`, `:63`.

Required control: revalidate and lock relevant resource/order eligibility at release and start. Define an explicit audited override if the business permits one. Test changes after scheduling, after release, and concurrent resource blocking. A browser-side check is insufficient.

## F02 - P1: Held production cannot be rescheduled through the supported save transaction

The scheduling RPC deliberately accepts jobs in `planned`, `ready`, or `on_hold`. After creating/updating the slot, it unconditionally changes the job to `planned`. The current production guards reject `on_hold -> planned` (and `ready -> planned`).

Executed sequence: put a running job on hold, cancel its old slot, restore resource availability, then create a new valid slot for the held job. Eligibility succeeds, but the job update fails on the status transition. The entire new slot transaction rolls back.

Business impact: a factory manager trying to recover held work after a breakdown or schedule change cannot complete the apparent supported rescheduling flow. Reusing old released slots does not constitute a sound replanning process.

Sources: `supabase/migrations/20260723010000_production_schedule_integrity.sql:111`, `:174`; `supabase/migrations/20260810010000_manufacturing_reference_and_material_guards.sql:83`; `supabase/migrations/20260718021500_floor_output_and_finishing_workflows.sql:54`.

Required control: agree a held-job recovery transition, with old-slot cancellation/replacement and job state updates in one transaction. Preserve completed work, input allocation and hold history. Reject overlapping replacements while allowing a valid new press/time.

## F03 - P1: General save bypasses the dedicated completion mass-balance gate

The dedicated completion RPC compares linked billet input with actual output plus scrap, allowing only the configured tolerance. The general save RPC independently permits status and actual-output fields and can make `in_progress -> completed`; current status/completion triggers check stage legality and positive output, not that the mass-balance transaction was used.

Executed comparison on a weight-planned job with 100 kg of linked issued billet:

- Dedicated completion with 500 kg output and zero scrap: rejected with `Billet mass balance failed`.
- General save with the same 500 kg actual output and completed status: succeeds.

This extends the earlier C01 completed-output-edit finding. It is the same broader ordinary-save authority gap, now demonstrated at initial completion; it should not be counted as an independent remediation of unrelated scope.

Business impact: an alternate database entry point can create production output exceeding input. Good validation on the visible completion form does not protect the underlying invariant. The fixture tests private business functions with a factory-manager business-role stub and current reference/status/completion triggers. It does not test public authenticated grants/RLS or install downstream ledger/handoff triggers. Those handoff triggers were inspected and run on completion but are not a replacement for billet mass-balance validation.

Sources: `supabase/migrations/20260718021500_floor_output_and_finishing_workflows.sql:76`; `supabase/migrations/20260715000000_atomic_business_workflows.sql:484`, `:530`; `supabase/migrations/20260718021500_floor_output_and_finishing_workflows.sql:33`.

Required control: ordinary saves cannot finalize production or rewrite completed evidence. Enforce completion invariants in an unavoidable database boundary; every permitted write path must obey it. Corrections must be explicit and reconcile billet, scrap, output, finishing, QC, packing and shipped dependencies.

## F04 - P2: Factory manager is allowed to initiate billet allocation but rejected by its RPC

Application `can('factory_manager', 'update', 'foundry')` returns true, and billet allocation actions use that gate. The actual allocation function's business-role allowlist includes owner/admin/production_manager/production but omits factory_manager. A later migration moves this body into `private` and wraps it; it does not repair the role list.

Executed test: assert the actual application permission helper allows the action, replay the allocation body and its public wrapper, and invoke with the factory-manager role. It rejects with `You do not have permission to allocate billets` before billet validation. This isolates business-role mismatch, not live JWT/SQL role privileges. The reallocation source has the same omission; reallocation was not separately executed.

Business impact: the manager responsible for the factory can reach the material-allocation workflow but cannot perform the task through that API. Management scope is inconsistent across layers.

Sources: `lib/auth/permissions.ts:93`; `lib/actions/production.ts:338`; `supabase/migrations/0056_order_billet_requirements_and_allocation.sql:341`; `supabase/migrations/20260602000002_security_definer_access_hardening.sql:5`; reallocation in `supabase/migrations/20260530000002_foundry_billet_allocation_repairs.sql:211`.

Required control: agree whether this role owns billet allocation, then make UI, server actions, RPCs and policies consistent. Do not silently widen permissions without preserving the intended separation of duties.

## Factory control map

The table separates fresh executed evidence from source inspection and previous-pass evidence. It is not a claim that every control was executed in this pass.

| Factory boundary | Control required | Evidence and unresolved condition |
| --- | --- | --- |
| Customer order -> factory release | Valid approved scope, exact profile/order line, active order | Source-line guards exist; prior B04 multi-profile commercial lineage failure remains open. F01 shows cancellation is not rechecked at release/start. |
| Billet allocation | Company/order/alloy/diameter match; no double issue; sufficient balance | Compatibility/locking checks found in allocation source. F04 manager-role mismatch reproduced. Prior partial-dispatch order lockout remains open. Full concurrent allocation not tested here. |
| Die and press readiness | Current usable resource, correct profile/press, controlled override | Initial schedule checks exist; F01 stale readiness reproduced. Frontend die-status and database exclusion rules also differ and need one agreed contract. |
| Press calendar | One active slot/job and no overlapping active press slots | Actual overlap guard rejected a conflicting slot in this pass. Independent-session races were not tested. |
| Hold and recovery | Reason/history retained; safe cancellation/replanning/resume | Transition history exists. F02 held-job rescheduling rollback reproduced. |
| Extrusion output | Input = good output + scrap/loss within explicit tolerance | Dedicated completion rejected bad mass balance; F03 alternate-save bypass reproduced. Prior C01 completed-output changes remain open. |
| Scrap and recovery | Once-only posting, immutable completed input/output, traceable corrections | Completion sums existing scrap and new scrap. Later scrap edits, repeated external postings and recovery/report reconciliation need additional dedicated tests. |
| Finishing | Route/source link, send/receive evidence, accepted/rejected quantities, controlled retry | Source inspection found vendor/date requirements, output-plus-rejection cap, rejected-source retry validation and terminal evidence guard. Physical process loss/gain and all retry scenarios are not certified. |
| Quality release | Approved quantity capped to source, auditable rework resolution | Source cap exists; prior B02 shows same-source rework approval dead end. Quantity-based release requires that fix. |
| Packing | Released material, material issue, immutable completion, exact source | Source inspection found completed packaging/material guards; dispatch checks packaging and material evidence. Full packaging reversal was not executed here. |
| Dispatch | Actual movement, exact source, QC release, no repeated consumption | Source checks exist; prior A03/C02 stock-consumption defects and D01 pending-as-shipped reporting remain open. |
| Factory manager view | Accurate remaining kg/jobs, exceptions and readiness | Prior D04/D06 alert/readiness failures remain open. Header stages and preview counts cannot establish actual factory readiness. |
| Access and audit | Consistent roles and tenant scope across every write/read path | F04 layer mismatch reproduced. Earlier access findings and hosted RLS verification remain open. |

## Verification

Fresh command: `node --no-warnings --experimental-strip-types scripts/audit-20261004-factory-controls.mjs`.

Result: exit 0; four diagnostic failures reproduced and two positive controls passed. A passing diagnostic means the undesired behavior was observed, not that the factory workflow passed. Tests use synthetic in-memory PGlite data and extracted repository functions. They are not a full migration replay or live application session. No independent-session concurrency, browser operator UAT, live machine/data integration or real factory transactions were tested.

Final-script ESLint passed with exit 0. Application build, typecheck and unit suites were not rerun for these audit-only additions.

Only this report and the diagnostic script were created. Application code, migrations and hosted data were not changed. Previous audit artifacts were preserved.

## Factory acceptance sequence

Before sign-off, execute one traceable order with two profiles and multiple production lots. Allocate compatible billets; reject an incompatible billet and duplicate allocation. Schedule competing jobs; simulate press failure and die block before release/start; hold and replan one job. Complete with verified input/output/scrap; reject all alternative invalid completion writes. Send required finishing, receive accepted/rejected material, resolve QC rework, pack, part-dispatch and finish the balance. Reconcile order-line kg, billet kg, good output, scrap, finishing output/loss, QC quantities, packed pieces/metres/kg, physical dispatch and remaining stock.

Run the same authority checks as owner, factory manager, production manager, operator, quality and inventory roles. Confirm that each manager screen, detail view and export agrees with these source transactions and that unavailable data cannot appear as healthy zero. This sequence requires fixes to the confirmed defects and authenticated staging/operator evidence; local fixture success alone cannot close it.

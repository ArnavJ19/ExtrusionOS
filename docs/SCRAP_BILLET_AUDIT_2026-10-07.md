# Scrap, billet making and allocation audit

Date: 7 October 2026. Audit only. This report supplements the earlier business-flow, reconciliation and factory-control audits. Application code, database migrations and hosted business data were not changed.

## Assessment and evidence boundary

Three distinct material-integrity failures were reproduced in selected current repository SQL: positive furnace charge without source records, surplus billet rows after a batch count reduction, and rewriting issued and consumed billet weights through a density change. These block sign-off on the audited material controls. They do not establish that every application user can perform these writes.

The evidence uses synthetic in-memory PGlite fixtures with minimal tables and extracted function bodies. Foundry mutations execute as the fixture database owner. Allocation uses stubbed identity/business-role helpers. Neither fixture proves hosted authenticated grants, RLS, actual UI reachability, a complete migration replay, or independent-session concurrency. Finding severity reflects potential material-accounting consequences if these writes are reachable in the deployed configuration.

## Material-flow boundaries

| Record or handoff | Meaning and evidence in this pass |
| --- | --- |
| Production `scrap_records` | Production scrap evidence. Do not equate this automatically with usable remelt stock. Transfer provenance to foundry stock remains unverified. |
| `foundry_aluminium_scrap` and external aluminium sources | Source stock whose available kg is debited by batch charge triggers. Selected source debit paths were executed. |
| `foundry_batches` | Mix, furnace efficiency, geometry, density and count calculate charge and cast output. Selected creation/edit cases were executed. |
| Individual `foundry_billets` | Per-billet identity, weight and lifecycle state generated from batches. Count/weight coherence was tested. |
| Order billet requirements | Per-requirement material compatibility and allocation counters. Requirements were pre-seeded; generation/rebuild was not validated. |
| Allocation and production issue | Compatible/incompatible reallocation controls were executed. Issued-job linkage was seeded for the weight test; the complete issuing workflow was not executed. |

This map separates stock records from their handoffs; it is not proof that production scrap automatically reaches remelt inventory or that every allocation mode works.

## S01 - P1: Positive furnace charge can have no stock source

The latest calculation trigger produces positive scrap and external-aluminium charge amounts, but both debit triggers enter their validation/debit branches only when the respective source ID is non-null. A batch with null `scrap_id` and `external_source_id`, a 25/75 mix and 80 percent efficiency was accepted at cast status: required charge was 27.363 kg and a billet was created while the source balances stayed unchanged.

The database therefore permits output without corresponding source-stock provenance in the tested path. The source debit functions check stock availability when a source is supplied; the gap is the absence of a mandatory link for a positive charge component.

The shared `foundryBatchSchema` also permits both source IDs to be empty; its final refinement checks only that the mix totals 100 percent (`lib/validations/schemas.ts:447`). This supports the validation-gap finding but does not independently prove end-to-end UI or server-action reachability.

Sources: `supabase/migrations/20260930000000_astra_audit_fixes.sql:237` (current calculation); `supabase/migrations/0057_foundry_furnace_mix_and_chemistry.sql:123` and `:167` (nullable source branches); `supabase/migrations/20260530000002_foundry_billet_allocation_repairs.sql:177` (billet creation).

Required outcome: require a same-company usable source for every positive charge component before material can become usable. Define whether planned batches may remain incomplete and enforce the chosen rule at the relevant state transition. Test null, missing, wrong-company and exhausted sources, rollback, and mixed-source charging.

## S02 - P1: Reducing batch count leaves surplus billet stock

The synchronization function upserts billet numbers from 1 through the new count but does not remove, cancel or reject rows above that count. Reducing a three-billet batch to two leaves three positive-weight billet records. The batch and physical-stock representations disagree.

The independent count-only scenario retained the original density and weights: count changed from three to two, three billet rows remained, surplus billet three remained cast, and issued billet one stayed at 21.890 kg. Existing allocated, issued or consumed billets require an explicit correction policy; silently deleting them would break traceability.

Source: `supabase/migrations/20260530000002_foundry_billet_allocation_repairs.sql:177`.

Required outcome: enforce equality between the batch's accepted count and its valid billet inventory. Reject a count reduction that conflicts with committed material, or use an audited adjustment transaction that reconciles source charge and uncommitted stock atomically. Test shrink, expansion, repeats and committed billets.

## S03 - P1: Density edits rewrite issued and consumed billet weights

The latest calculation body recomputes per-billet mass from density and dimensions. The billet synchronization upsert writes that mass to existing rows while preserving committed statuses. In a separate two-billet scenario, a density-only change from 2700 to 2800 kg/m3 changed both an issued billet and a consumed billet from 21.890 to 22.700 kg each, with alloy, temper, diameter and lifecycle statuses unchanged.

The current lineage guard protects material compatibility and job/order linkage, but does not freeze input mass. The synchronization explicitly preserves issued/consumed statuses while overwriting weight. The consequence is that committed material can have its recorded input weight revised by a parent-batch edit in the tested path. This reproduction does not establish that completed production aggregates changed or that an authenticated operator can invoke the edit; a full migration replay remains outstanding.

Sources: `supabase/migrations/20260930000000_astra_audit_fixes.sql:252`; `supabase/migrations/20260530000002_foundry_billet_allocation_repairs.sql:180`; `supabase/migrations/20260812000000_security_and_notification_integrity.sql:218`.

Required outcome: freeze physical input attributes at the agreed commitment boundary, or require an explicit correction workflow that checks every dependent allocation, issue and production record. Test density, length and diameter changes separately across planned, allocated, issued and consumed states.

## Controls and corrected candidate

The compatible-source insertion control verifies that the source debit matches the calculated charge for one insert. It is not proof of idempotency under retries or concurrent transactions.

The earlier candidate that reallocation accepts an incompatible temper is withdrawn. The latest `validate_foundry_billet_lineage` from `20260812000000_security_and_notification_integrity.sql:218` checks alloy, temper and diameter against the requirement. A T6 billet reallocated to a T5 requirement is rejected and retains its original allocation. Inspecting the older reallocation body alone would miss this later trigger protection.

Compatible reallocation also passed: the target requirement changed to one allocated billet and zero shortage, while the source requirement changed to zero allocated and one shortage. The actual repair and refresh helpers were loaded from `20260530000002_foundry_billet_allocation_repairs.sql:1` and `:54`; the actual lineage trigger DDL was loaded from `20260810010000_manufacturing_reference_and_material_guards.sql:153`. This validates these pre-seeded reallocation scenarios, not FIFO selection, manual allocation, requirement generation or the entire allocation lifecycle.

## Relationship to prior findings

The three foundry findings above are distinct from the prior findings listed below. The prior findings are not counted again in this pass:

| Prior finding | Relationship |
| --- | --- |
| Factory-control F03 and reconciliation C01 | General production save bypasses completion mass balance or rewrites completed output. This pass concerns input stock generation and issued billet attributes. |
| Factory-control F04 | Factory-manager UI/server permission and allocation RPC role allowlist disagree. This pass does not establish live role privileges. |
| Business-flow B01 | Partial dispatch closes the order header for further production/allocation. The earlier report source-verified the allocation exclusion. |

## Verification and remaining acceptance work

Diagnostics: `scripts/audit-20261004-foundry-scrap.mjs` and `scripts/audit-20261004-billet-allocation.mjs`. Their retained filenames identify the interrupted audit work; this report records the 7 October completion pass. A successful defect-reproduction assertion means the undesired behavior occurred, not that the business workflow passed.

The foundry fixture stubs `refresh_order_billet_allocations`; its cancellation branch is not exercised, and it makes no claim that real allocation aggregates were reconciled. The allocation fixture stubs requirement rebuilding and notifications, so its pre-seeded requirement scenarios do not validate requirement generation or notification delivery. Both diagnostic scripts exited 0 on independent root reruns. Foundry reproduced all three failures and passed the source-backed insertion control (10.945 kg scrap plus 10.945 kg external debit). Allocation passed both compatibility and counter-refresh controls. An initial missing-helper fixture failure was repaired by loading the actual `repair_order_billet_requirement_links` function and was not reported as a product defect.

Targeted ESLint checks on both diagnostic scripts exited 0. The requested Astra Low coordinator delegated to Luna Max audit agents. The final allocation agent completed; the final foundry agent and coordinator stopped on usage limits. The root completed the remaining source review and report integration under the skill's failure fallback. This report does not claim those interrupted reviews completed. Full application build and test suites were not repeated for these audit-only artifacts.

Before acceptance, replay the full schema in disposable staging and repeat source-to-batch-to-billet-to-order-to-production scenarios through authenticated roles and real server actions. Reconcile stock weights/counts, source debits, allocation totals, issued mass, output and scrap; test FIFO priority, rollback and independent competing allocation sessions. Verify source switching/deletion, cancellation, supplier billet entry, quality holds, production-scrap transfer into remelt stock, scrap returns/reuse and completed-production corrections separately. No claim of exhaustive coverage is made.

No application or migration fixes were made. Earlier audit artifacts and unrelated worktree changes were preserved.

# BUGS-MEGA

Consolidated ExtrusionOS audit findings, completed work and pending acceptance register. Updated on 20 October 2026 to include the work recorded across 17-20 October, alongside the complete earlier finding history. The 22 October hosted checkpoint below supersedes earlier ledger, supplier-contact and advisor statements.

## Scope and Current Status

This register consolidates audit and remediation Markdown from 20 September through 20 October 2026. It includes the six original October audits, the September business-logic register and verification, the Astra remediation report, continuation issues R01-R25, the 57 source findings in the finance/expenses audit, the PDF/report overhaul, hosted migration reconciliation, Git consolidation and the latest staging checkpoint. The June codebase audit, July workflow audit and May audit templates remain outside the original audit window.

There are 33 finding IDs across the six original October audit reports and 32 distinct root causes because C01 and F03 describe the same production-completion authority gap. The 14 October remediation report records local fixes and regression evidence for every code-remediation finding in that register. The September business-logic report records local fixes for BL-01 through BL-18; the Astra report records local fixes for findings 1 through 13. Those original reports establish local evidence. The later migration/body/grant evidence below establishes the recorded hosted activation; it does not substitute for real Supabase JWT/RLS/Storage behavior, independent-session concurrency, historical inventory accuracy, authenticated operator UAT or deployment.

**Verified hosted/R25 checkpoint, 20 October at 15:15:50 IST:** The user-authorized initial batch of 40 reviewed migrations is applied. R24 was subsequently found already applied and verified; R25 was applied and checked in that continuation. The matched Supabase project is `pkawmdxtmsdgigsehcmb`; its saved ledger has **86 records**, with **175 public business tables, all with RLS**, **23 views**, **294 public/private functions** and **600 policies**. The consolidated local inventory at that checkpoint was **182 SQL files / 170 distinct versions**, retaining seven historical version-collision groups. These figures supersede the earlier 84-entry / 293-function / 168-file checkpoint; the initial 40-application history is retained below and in `docs/MIGRATION_RECONCILIATION_2026-10-20.md`.

**Later working-tree/PDF follow-up, inspected around 19:00 IST on 20 October:** The updated `pdf fix.MD` section 8 reports fourteen additional document-quality repairs, complete fixture visual QA, passing lint/typecheck/build/full tests and verified server-action font traces. Those newer PDF changes, fonts, tests and dependencies are saved but uncommitted. A new supplier-contact invoice-snapshot migration has seven reported passing local tests and is explicitly **NOT APPLIED** in that handover. A fresh file-only count is **183 SQL files / 171 distinct versions**, with the same seven collision groups. The 86-entry hosted result and 1,725-test R25 result above retain their own earlier source/checkpoint boundary; this documentation update did not rerun the newer PDF suite or perform another hosted probe.

The continuation has confirmed twenty-five narrower defects. R01-R03, R12-R16 and R23 were locally fixed after separate reproduction, edge tests, full checks and source audit. R04-R11 and R17-R22 have applied database candidates with the recorded 20 October catalog/body/grant verification; their complete workflow acceptance remains OPEN. R24 is also applied: the later hosted ledger, exact source comparison, 48 authenticated SQL-role reader checks and negative-identity controls verify its activation. R25 repairs the automatic allocator's material normalization and dispatched-profile eligibility, with 44 new checks and an applied forward migration. The final local suite passes 1,725 tests. The user's current instruction authorizes the migration work. Broader investigations and A00 have not been marked complete. See `docs/BUGS_MEGA_R25_AUTO_ALLOCATION_2026-10-20.md` for the current continuation.

**Overall completion remains OPEN.** The recorded R25 checks passed; the later PDF author reports its local checks passed. The supplier-contact candidate still needs review/replay/application, and full historical migration replay, real-login JWT/RLS/Storage checks, independent-session races, physical/source-document reconciliation and complete operator acceptance remain pending. Both the R25 and later PDF source/evidence continuations are uncommitted on `codex/v1`; the retained Git branch tips remain at `61a1530`. Application deployment has not been verified or performed by this continuation. Documentation verification is distinct from application/runtime acceptance.

### Current Hosted Checkpoint, 22 October 2026

This section supersedes the 86-entry ledger, the "unapplied supplier-contact candidate" statements and the advisor counts recorded below; those remain as dated history.

- **Hosted ledger: 126 records** on `pkawmdxtmsdgigsehcmb`. Between the R25 checkpoint and 21 October the parallel sessions applied the supplier-contact snapshot (`20261020120000`, ledger `20261020201639`), the posted-reservation delivery repair found by acceptance (`20261020142106`), production billet normalization (`20261020162949`) and the ERP_AUDIT_1 Wave 1/Wave 2 migrations through `20261021320000` (ledger 122).
- **Supplier-contact candidate: CLOSED.** The hosted `private.snapshot_invoice_parties()` body hash equals the local migration (`369c66fd…`), and direct execute is held by the owner only. `sql/astra-integrity.sql` is frozen generator input for the historical `20260930000000` migration and must stay byte-identical; `scripts/build-astra-migration.mjs` now records that `20261020120000` supersedes its copy and is authoritative.
- **Applied on 22 October** after review, local tests, a full hosted dry run inside a forced-abort transaction, and post-apply body/ACL comparison:

| Ledger name | What it fixes | Evidence |
| --- | --- | --- |
| `20261021290100_operation_page_null_projection` | Database pages omit role-masked keys instead of returning them as null. | `tests/operation-page-projection.test.mjs`; hosted body patched, still SECURITY INVOKER. |
| `20261021330000_invoice_die_freight_charge_lines` | EXOS-AUD-026: die and freight billed once as separate invoice lines instead of being spread over every kg. | Wave 2 gate rerun: GATE PASSED, including G026 die/freight and reconciliation scenarios. Six function bodies hash-identical to the file. Hosted had 0 invoices / 0 order lines, so no issued document changes. |
| `20261022000000_operator_workflow_helpers` | Database half of the five operator upgrades already committed in `e99f4b6` (aliases, location history, production exceptions, customer commitments); the app called an RPC that did not exist on hosted. | `tests/operator-workflows-*.test.mjs`; RLS on all five tables, select-only grants, `operator_workflow_command` executable by authenticated only; body hash-identical. |
| `20261022010000_fk_covering_indexes_and_rls_initplan` | Advisor gate: 93 unindexed foreign keys indexed; 61 RLS policies changed from per-row `auth.uid()` to `(select auth.uid())` with every other predicate, role and command unchanged (asserted inside the migration). | New `tests/fk-covering-indexes-rls-initplan.test.mjs` (indexes, idempotence, identical visibility and rejected cross-company/forged inserts). Hosted: 0 bare `auth.uid()` policies, 0 uncovered FKs. |

- **Hosted runtime probes (rolled back):** as the real owner identity, reads return exactly the company totals (10 orders, 19 quotes, 15 quote lines, 1 customer, 3 users), the new operator RPC answers and the database page returns ten rows; an unknown identity sees zero rows in every probed table and the RPC rejects with "Authentication required".
- **Advisors after application:** `auth_rls_initplan` 61 → 0; `unindexed_foreign_keys` 89 → 2. The two remaining are column-order false positives: `(expense_ledger_id, company_id)` FKs already served by `(company_id, expense_ledger_id, …)` indexes, so no redundant index was added. Unchanged and intentionally not "fixed": 270 multiple-permissive-policy warnings (merging changes the access model), 741 unused-index notices (indexes are not removed), 22 security-definer masking views and 80 authenticated definer RPCs (documented architecture), the policy-less private request table, and leaked-password protection (a Supabase Auth dashboard setting the project owner must enable).
- **A00 historical replay:** the native replay stops at `0033_enterprise_phase_24_command_center.sql` because `public.tasks` is created by `20260513_enterprise_phase1_foundation.sql`, which sorts after `0033`. This is a historical ordering collision, not a hosted defect. Fixing it requires either rewriting applied historical files or squashing a baseline from the hosted schema; neither was done because both change applied history and need an explicit decision. A00 stays open for that decision and for real-login/operator acceptance.
- **Checks on the `codex/v1` working tree, 22 October:** full suite **2,040 / 2,040 passed** (zero failures, skips or cancellations; 2,038 before the new test file); `npm run lint` and `npm run typecheck` passed; the Wave 2 regression gate passed. `npm run build` compiled but then failed type checking in `lib/calculations/length-units.ts` (BigInt literals under the ES2017 target). That file and `components/modules/shared/length-unit-input.tsx` appeared, untracked, from a concurrent session during this work, together with a new unapplied migration `20261021190916_collaboration_procedure_routines.sql`; none of this checkpoint's changes are in the build graph, and that in-progress work was not modified. Nothing was committed or pushed, and no application deployment occurred.

Severity uses the source audit's rating where one was supplied. Importance explains the business effect. Complexity is a rough remediation estimate: Medium is focused; Large spans application/database paths; XL spans security, data integrity or multiple transactions. Where a source did not assign severity, this ledger says so instead of inventing one.

## Work Recorded For 17-20 October 2026

The requested four-day reporting window is 17-20 October inclusive, in Asia/Kolkata. The saved reports identify final checkpoints on 19 and 20 October; they do not reliably separate work performed on 17 October from work performed on 18 October. No unsupported per-day attribution is made. Earlier R01-R10 work from the report dated 15 October is retained as carried-forward context, and its later activation on 20 October is included. The original finding counts above are unchanged; overlapping continuation and finance IDs are not added together as independent root causes.

| Evidenced checkpoint | Work completed or preserved | Remaining boundary |
| --- | --- | --- |
| Earlier checkpoint, activated 20 October | R01-R03 dispatch/receipt/credit UI fixes; R04-R10 reservation replay/projections, settlement exclusivity, credit retry binding, direct priced orders, dispatch ledger and cancellation integrity. | See the individual records; authenticated and physical workflow acceptance remains open. |
| 19 October | R11 retained-shipment invoicing after cancellation; R12 source-selector reopening; R13 dispatch-source request ownership; R14 complete packing-history reads; R15 shared die readiness; R16 production reporting from recorded ledgers. Twelve scrap-posting/immutability/recovery controls also passed without establishing another defect. | R11 schema was applied on 20 October; real operator journeys and historical/physical acceptance remain pending. |
| 19 October, close-out finalized 20 October | R17 terminal finishing evidence; R18 original/retry accepted portions through QC/packaging/readiness; R19 append-only packaging material evidence; R20 complete finishing workload and retry accounting; R21 legacy billet-link repair. | All five database patches are applied; independent sessions and full signed-in/physical acceptance remain open. |
| 20 October | R22 manual allocation repaired against actual billet schema; R23 allocation-panel save/refresh lifecycle repaired; R24 compatible order lookup made bounded, searchable, complete and scope checked. | R22/R24 schema activation is verified; R23 is locally fixed. Real-token and complete allocation acceptance remain open. |
| 20 October | All 57 finance/expenses source findings reconciled: receivables/refunds, expense approval and settlement, supplier credits, finance access, reporting/exports, PDF support and invoice navigation. | Three finance migrations are applied. Single-session fixtures and structural PDF checks do not complete concurrent, signed-in or accounting acceptance. See the complete finance table below. |
| 20 October | Shared PDF writer/formatting preserved across quote, invoice, vouchers, all seven configurator document types, technical sheets, PCDA and Report Builder. Later section 8 of `pdf fix.MD` records fourteen further quality repairs, 28 main fixtures, about 170 boundary documents and server-action font tracing. | The newer author's local checks/visual sweep are reported complete. Hosted document acceptance and the unapplied supplier-contact snapshot candidate remain open. |
| 20 October | Forty reviewed migrations applied after catalog reconstruction/replay; optional dispatch RPC defaults retained; historical maintenance-column repair and trigger-only grant/search-path repair applied. | Metadata comparison proves current representation, not every old script's original execution or a complete Supabase baseline replay. |
| 20 October | Legacy branches/worktrees consolidated into existing `codex/v1` and `main`, preserving the newest PDF/report implementation, twelve older SQL files, current workflow guards and recovery snapshots. Both retained branch tips reached `61a1530`. | Later R25 and PDF source/evidence remains uncommitted and has not been promoted into the root application source. |
| 20 October, latest continuation | R24's existing application verified; R25 automatic-allocation defects reproduced, fixed, tested and applied. Catalog, preflight, negative-access and fully rolled-back runtime checks passed. | No full-system closure or physical material adequacy claim. |
| 20 October, staging attempt | Existing staging gates checked; a disposable local Supabase route selected after the user delegated the choice. Docker startup diagnosed and its first inaccessible runtime directory preserved recoverably. | A second inaccessible socket still blocks Docker; no local Supabase stack, Auth users or staging fixtures were created. |

### Current Status Of R01-R25

`Local fix` means the recorded reproduction, local regression checks and source audit passed. `Database applied` means the patch is activated with the recorded catalog/body/privilege checks; complete acceptance is still open. Neither label certifies a deployed application or a real signed-in end-to-end workflow.

| ID | Completed change | Current status |
| --- | --- | --- |
| R01 | Complete reservation-consumption totals in dispatch preparation. | Local fix; hosted/operator acceptance open. |
| R02 | Reachable exact receipt retry after the first request changes the balance. | Local fix; signed-in/concurrent acceptance open. |
| R03 | Corrected credit-note issuance after reversal. | Local fix; signed-in/concurrent acceptance open. |
| R04 | Exact posted-consumption replay after releasing the remainder. | Database applied; acceptance open. |
| R05 | Complete, bounded reservation ledger with explicit unavailable states. | Database applied; acceptance open. |
| R06 | Standalone adjustment / return-credit settlement exclusivity. | Database applied; historical/accounting acceptance open. |
| R07 | Credit-note retry identity bound to dispatch and reason. | Database applied; concurrent acceptance open. |
| R08 | Atomic priced direct-order lines alongside quotation-backed orders. | Database applied; complete commercial-lineage acceptance open. |
| R09 | Complete dispatch-detail reservation totals and bounded pages. | Database applied; acceptance open. |
| R10 | Cancel only unconsumed holds without inventing physical stock returns. | Database applied; historical/physical/operator acceptance open. |
| R11 | Invoice verified retained shipments after cancelling the unfulfilled remainder. | Database applied; full invoice/cancellation acceptance open. |
| R12 | Reopen the selected source control with mouse, touch or keyboard. | Local fix; signed-in operator acceptance open. |
| R13 | Reject obsolete dispatch-source responses and stale save state. | Local fix; persisted dispatch/concurrent acceptance open. |
| R14 | Read every packing-history page and reject incomplete evidence. | Local fix; persisted stock/hosted acceptance open. |
| R15 | Align die readiness/selection with current scheduling authority. | Local fix; full scheduling/operator acceptance open. |
| R16 | Reconcile production reports to input, output, scrap and recovery ledgers. | Local fix; Storage/physical/operator acceptance open. |
| R17 | Retain terminal finishing movement evidence and original dates. | Database applied; historical/operator acceptance open. |
| R18 | Release independently accepted original and corrective finishing portions. | Database applied; full QC/packing/dispatch acceptance open. |
| R19 | Retain package headers and append-only material movement evidence. | Database applied; physical reversal/return acceptance open. |
| R20 | Complete finishing workload, retry lineage and remaining rejection accounting. | Database applied; full operator/physical acceptance open. |
| R21 | Repair only eligible legacy billet links using actual retained links. | Database applied; historical/material acceptance open. |
| R22 | Derive manual allocation eligibility from real requirement/production lineage. | Database applied; signed-in/concurrent acceptance open. |
| R23 | Preserve allocation panel/readiness through save, refresh and late responses. | Local fix; signed-in allocation journey open. |
| R24 | Company-scoped compatible order options with literal search and stable ten-row pages. | Already applied; exact body/grants and 48/48 billet reads verified; acceptance open. |
| R25 | Normalize automatic material matching and recheck locked per-profile eligibility. | Applied at 14:55 IST; 44 new checks, exact body/ACL and runtime rollback verified; acceptance open. |

### Hosted Migration And Data Checkpoint

The initial application increased the ledger from 44 to 84 records. R24 adds the already-recorded `20261020085531` / `manual_billet_allocation_options`; R25 is `20261020092500` / `20261020090729_priority_billet_allocation_integrity`, applied at 09:25 UTC / 14:55 IST. R24 was verified rather than applied twice. R25's reviewed-source normalized body hash is `b67a901487c6ff8cc10db9d3c8511694`; direct execute remains revoked for PUBLIC, anonymous and authenticated clients, preserving internal authorized callers.

At the 15:15 checkpoint all 29 then-existing October migration files had their expected current objects and final function bodies represented in the fresh catalog comparison. The later supplier-contact snapshot candidate is outside that comparison and is not included among the applied files below. All 16 deployment-preflight groups passed their required-object, ACL and trigger-attachment checks, covering 24 public RPCs and 14 columns. Seven read-only exception reports returned zero rows: billet lineage, allocation counters, direct commercial lines, credit/adjustment overlap, cancelled-order holds/stock, finishing accepted receipts and packaging material evidence. This does not certify missing historical facts or physical inventory.

The initial expense/payment/retry/reversal probe and the later automatic allocator probe were explicitly rolled back. The later probe compared complete before/after row digests for billets, orders, requirements and notifications, with no difference. Recorded totals remain 10 orders, 48 billets, 13,711.728 kg and zero invoices/payments at the saved checkpoint. These runtime probes used transaction-local SQL-role claims, not a real browser login or newly issued JWT.

Security review remains open for 22 security-definer views, 57 authenticated security-definer entry points, the intentionally client-inaccessible private request table with RLS/no policies, and disabled leaked-password protection. The views are company/role-filtered masking projections; blindly switching them to invoker semantics is not an accepted repair. Performance advisories were also retained for review: the recorded initial snapshot lists 35 unindexed foreign keys, 61 auth-init-plan warnings, 744 unused-index notices and 530 multiple-permissive-policy warnings. These counts describe that snapshot, not a new advisor run during this documentation update. No RLS disabling, blanket grant, index removal or automatic policy rewrite was used to suppress findings.

### Verification Recorded Across The Window

| Checkpoint | Recorded verification | Interpretation |
| --- | --- | --- |
| 19 October continuation | Full suite grew through 919, 932, 964, 1,004, 1,059, 1,139, 1,182, 1,249, 1,288, 1,417 and 1,461 passing checks; the separate scrap controls brought the intermediate total to 1,072. | Per-issue historical checkpoints, not separate current test runs. |
| Initial 20 October migration/finance completion | 1,553 tests / 76 suites; 18 expense, seven receivables and five reporting focused checks; lint/typecheck and 154-page build passed. | Includes catalog replay and the documented rolled-back hosted finance probes. |
| R23 then R24 handoff | 1,595 then 1,673 tests / 76 suites; 16 styled responsive cases for each panel; lint/typecheck and 154-page build passed. | Synthetic browser/action/SQL evidence; later consolidated. |
| Git/PDF consolidation | 1,681 tests / 76 suites; 54 PDF/report/merge checks; 35 die/production checks; lint/typecheck/build passed. Seven synthetic reports rendered across 16 pages, with text-bound checks and representative visual inspection; all six PDF API route traces contained 22 font files. | Preserved the newer renderer and current production authority; did not establish deployed server-action fonts or authenticated acceptance. |
| Latest R25 continuation | **1,725 tests / 76 suites; zero failures, skips or cancellations.** Forty-four new SQL checks; 165 focused allocator/catalog checks; 30 panel checks; final lint/typecheck and 154-page build passed. Whole R24/R25 scripts replayed against an empty reconstruction of the fresh catalog. | Latest recorded application verification. It is not a full historical Supabase/Auth/Storage replay. |
| Later PDF follow-up, section 8 handover | Author reports lint/typecheck/build/full tests passed; 28 main documents and about 170 boundary documents rendered/checked; new quality regressions and seven supplier-snapshot checks; 23 fonts traced per listed server-action page. | Read from the newer handover and current diff. No exact full-suite total is supplied there; the earlier 1,725 total must not be reused as this follow-up's count. No rerun or hosted application is claimed by this document update. |
| Dedicated staging runner | `npm run test:e2e:staging` exits at `STAGING E2E GATE FAILED` because isolated staging configuration is absent. | Staging acceptance is blocked, not passed or skipped as unnecessary. |

Initial failures are retained in evidence: the sandbox browser cache/loopback restrictions; the existing unmount test resolving callbacks before React committed unmount; the font fetch blocked by the build sandbox; an earlier merge using a superseded production read; and earlier date-sensitive or browser-adapter assertions. The final fixes preserved production assertions and business rules. The unmount test now waits for confirmed unmount, and the final complete rerun passes. Current standard tests use the existing bounded concurrency of two and installed Chromium cache; build verification used synthetic public Supabase values. No fresh application tests are claimed for this documentation-only update.

#### Recorded Applied Migration Files

The first 40 entries are the initial reviewed batch in actual application order. Entries 41-42 record the later R24 and R25 ledger evidence. Ledger execution versions differ from source filename versions; no historical version was renamed to force a match.

| Order | Source migration filename | Hosted ledger version |
| --- | --- | --- |
| 1 | `20260810000000_tenant_boundary_and_dealer_workflow_hardening.sql` | `20261020060105` |
| 2 | `20260810010000_manufacturing_reference_and_material_guards.sql` | `20261020060108` |
| 3 | `20260810020000_atomic_dealer_order_creation_and_workflow.sql` | `20261020060110` |
| 4 | `20260810030000_quote_and_order_financial_integrity.sql` | `20261020060112` |
| 5 | `20260810040000_storage_and_catalog_policy_alignment.sql` | `20261020060114` |
| 6 | `20260810050000_factory_queue_weight_runtime_fix.sql` | `20261020060116` |
| 7 | `20260812000000_security_and_notification_integrity.sql` | `20261020060145` |
| 8 | `20260812010000_dispatch_return_and_manifest_integrity.sql` | `20261020060148` |
| 9 | `20260812020000_invite_acceptance_integrity.sql` | `20261020060150` |
| 10 | `20260812030000_profile_configuration_integrity.sql` | `20261020060152` |
| 11 | `20260918000000_production_source_line_integrity.sql` | `20261020060154` |
| 12 | `20260929000000_business_logic_fixes.sql` | `20261020060157` |
| 13 | `20260930000000_astra_audit_fixes.sql` | `20261020060200` |
| 14 | `20261008000000_foundry_material_integrity.sql` | `20261020060224` |
| 15 | `20261008010000_access_projection_integrity.sql` | `20261020060227` |
| 16 | `20261008020000_factory_workflow_integrity.sql` | `20261020060230` |
| 17 | `20261008030000_configuration_quote_integrity.sql` | `20261020060233` |
| 18 | `20261008040000_management_metrics_integrity.sql` | `20261020060236` |
| 19 | `20261008050000_operation_search_integrity.sql` | `20261020060238` |
| 20 | `20261013000000_audit_workflow_followup.sql` | `20261020060240` |
| 21 | `20261013010000_dealer_fulfillment_integrity.sql` | `20261020060243` |
| 22 | `20261015000000_reservation_release_replay_integrity.sql` | `20261020060333` |
| 23 | `20261015010000_reservation_ledger_projection.sql` | `20261020060335` |
| 24 | `20261015020000_credit_settlement_exclusivity.sql` | `20261020060338` |
| 25 | `20261015030000_credit_note_retry_binding.sql` | `20261020060340` |
| 26 | `20261015040000_direct_priced_orders.sql` | `20261020060342` |
| 27 | `20261015050000_dispatch_reservation_ledger.sql` | `20261020060345` |
| 28 | `20261015060000_order_cancellation_stock_integrity.sql` | `20261020060347` |
| 29 | `20261019000000_retained_dispatch_invoices.sql` | `20261020060425` |
| 30 | `20261019010000_terminal_finishing_evidence.sql` | `20261020060428` |
| 31 | `20261019020000_finishing_accepted_dispositions.sql` | `20261020060430` |
| 32 | `20261019030000_packaging_material_evidence.sql` | `20261020060433` |
| 33 | `20261019040000_finishing_workload_projection.sql` | `20261020060436` |
| 34 | `20261019050000_billet_link_repair_integrity.sql` | `20261020060438` |
| 35 | `20261020060043_reconcile_historical_audit_columns.sql` | `20261020060454` |
| 36 | `20261020000000_manual_billet_requirement_lineage.sql` | `20261020061032` |
| 37 | `20261020010000_expense_ledger_integrity.sql` | `20261020061529` |
| 38 | `20261020061323_close_post_reconciliation_function_grants.sql` | `20261020061532` |
| 39 | `20261020020000_receivables_integrity.sql` | `20261020062956` |
| 40 | `20261020030000_finance_reporting_integrity.sql` | `20261020063338` |
| 41 | `20261020070000_manual_billet_allocation_options.sql` | `20261020085531` (already present; verified) |
| 42 | `20261020090729_priority_billet_allocation_integrity.sql` | `20261020092500` (applied and verified) |

### Saved Staging Infrastructure State

The user delegated selection of a disposable staging target. No existing hosted development branch was available; no paid project/branch was created. Docker startup first failed on `C:/Users/arnav/AppData/Local/Docker/run/sailor-ingest.sock`. With the backend/service stopped, the runtime directory was preserved as `C:/Users/arnav/AppData/Local/Docker/run.pre-extrusionos-a00-20261020`, a fresh `Docker/run` directory was created and background startup was retried. Startup then failed on `C:/Users/arnav/AppData/Local/docker-secrets-engine/engine.sock`.

At the 15:15 IST checkpoint the engine pipe remained unavailable and no Docker Desktop/backend processes were observed. Both the original runtime backup and fresh runtime directory remain recorded; the secrets-engine path was not modified. No Docker volume reset, local Supabase stack, new Auth users or staging business fixtures were created. Repairing Docker or restoring the saved runtime state, then provisioning an isolated staging target, is pending infrastructure work. This document update does not assert a fresh machine-state check.

## Confirmed Unresolved Findings

The reproduction and pre-application verification paragraphs retain their original checkpoint evidence. The per-issue current-status entries and the dated summary above control today's activation status. Applied patches remain in this section while their complete workflow acceptance is open.

### A00 - Hosted migration lineage and complete workflow acceptance remain open

- **Severity:** P1 (High).
- **Importance:** Deployment blocker; invoice PDF, configurator and dealer-receipt workflows may fail against the hosted database.
- **Complexity:** Large.
- **Where:** Hosted invoice snapshot columns and the RPCs called by `app/api/pdf/invoice/[id]/route.ts`, `lib/systems-configurator/actions.ts` and `lib/enterprise/dealer-workflows.ts`.
- **Problem:** The 8 October read-only check could not select `invoices.supplier_snapshot` and did not observe `save_system_configuration_atomic` or `submit_dealer_receipt_atomic` through the REST schema. The hosted migration ledger was not verified. REST exposure alone does not prove an object is absent. The 14 October report says hosted reconciliation was deferred and establishes no current hosted-schema conclusion.
- **14 October recheck:** All 29 fresh hosted REST checks were unavailable; no current object-presence or migration-history conclusion is possible. The local inventory contains 149 SQL migration files and 137 distinct versions. Seven identifiers are shared by multiple files: `0032`, `0034`, `0036`, `0055`, `20260511`, `20260512`, `20260513`. A version-only ledger comparison cannot establish that every colliding script ran.
- **Local work completed:** Reproduced and repaired false-positive REST diagnostics for malformed successful responses and invalid RPC entries; reject invalid URL protocols, embedded credentials and empty API keys. Added a read-only metadata export and local ledger reconciler that flag collisions, wrong names, missing prerequisites and unknown/duplicate hosted entries. Regression, property, SQL and real local HTTP checks cover these diagnostics. Detailed evidence and continuation steps: `docs/A00_SCHEMA_RECONCILIATION_2026-10-14.md`.
- **Status:** OPEN FOR HISTORICAL LINEAGE AND COMPLETE WORKFLOW ACCEPTANCE. The initial 40 applications, later R24 activation verification and R25 application are complete. The latest 86-entry ledger/catalog checks cover 24 required public RPCs, 14 columns and all 16 deployment-preflight groups. Historical timestamps/names still differ from the checkout; full baseline replay/lineage, real JWT/RLS/Storage, independent-session concurrency and signed-in invoice/configurator/dealer acceptance remain pending. Catalog equality and SQL-role claims do not close these gates.
- **15 October constraint and recheck (historical):** The user explicitly instructed, "DON'T RUN ANY SUPABASE MIGRATIONS." No Supabase migration was applied at that checkpoint; all 29 read-only REST probes were unavailable and no hosted ledger was available. The later 20 October authorization superseded this constraint for the recorded migration work.
- **19 October inventory (historical):** After preparing R04-R11 and R17-R21, the file-only inventory reports 162 SQL files, 150 distinct versions and the same seven collision groups. No hosted ledger was supplied, so reconciliation remains unavailable. The required REST contract includes the proposed reservation-ledger, direct-order, invoice-source, finishing-readiness and finishing-workload RPCs plus receipt-linked packaging and the accepted-output view (37 checks: 23 functions and 14 columns); the earlier 29-probe result does not verify these additions. Cancellation, R17, R19 and R21 add no public callable RPC. Triggers, private guards, request-table and ledger RLS/ACLs, view scope and function-body revisions require catalog/body review, not REST RPC discovery.
- **20 October hosted reconciliation:** 168 local SQL files / 156 versions; 84 hosted ledger entries. Applied 40 missing changes; 32 older files have historical name matches and 96 have represented/superseded schema effects with unrecorded original execution. No recent table/column/function/body gaps remain in the final static comparison. The old foundry order column is deliberately absent under 0055. Current schemas, application outcomes and remaining advisor findings are in `docs/MIGRATION_RECONCILIATION_2026-10-20.md`.
- **Later 20 October continuation:** After source consolidation and R25, the inventory is 182 files / 170 versions and the hosted ledger has 86 entries. R24 was already recorded as `20261020085531`; R25 is recorded as `20261020092500`. All 29 October migration files have their expected current objects and final function bodies represented in the fresh catalog comparison. All 16 deployment-preflight groups pass their required-object/ACL/attachment checks, covering 24 public RPCs and 14 columns. Seven historical exception queries return zero rows. A rolled-back execution of the deployed allocator preserves exact before/after digests for billets, orders, requirements and notifications. These checks do not reconstruct missing historical execution records or replace real-login, independent-session and physical/operator acceptance.
- **Still later PDF follow-up:** The source inventory is now 183 files / 171 versions after the unapplied `20261020120000_invoice_supplier_snapshot_contact.sql` candidate arrived. Its seven local tests are reported passing; no application is recorded. The 86-row hosted checkpoint and 29-file final-body comparison above exclude this candidate. Review/replay/activation and the frozen-party/contact acceptance checks remain pending alongside A00's original gates.
- **How to resolve:** Compare the hosted migration ledger with this checkout; run read-only schema and historical-data preflights in disposable staging; rehearse the complete prerequisite migration chain; review and apply required migrations in order; deploy the compatible schema and application when authorized; verify columns, RPC grants and authenticated workflows. Do not apply only the newest migration or infer absence solely from REST schema visibility.
- **Close when:** Staging replay and preflights pass, intended roles can use the required columns/RPCs, and invoice, configurator and dealer-receipt flows pass as authenticated users. Record hosted deployment separately.
- **Sources:** `docs/AUDIT_2026-10-03.md` (A00); `docs/AUDIT_REMEDIATION_2026-10-08.md`; `docs/AUDIT_REMEDIATION_2026-10-14.md`.

### R04 - Exact posted consumption replay fails after releasing the remaining hold

- **Severity:** P2, assessed in this continuation. **Importance:** An internal replay of an already posted partial dispatch fails once its unconsumed hold is released or cancelled. **Complexity:** Medium.
- **Where / problem:** `private.consume_dispatch_reservations` checked reservation lifecycle eligibility before inspecting an existing consumption entry. After a valid partial shipment and remaining-hold release, an exact replay rejected as stale. Null manifest identity and mismatched posted-ledger provenance also lacked complete retry validation.
- **Prepared resolution:** `supabase/migrations/20261015000000_reservation_release_replay_integrity.sql` validates immutable source identity, checks an existing exact ledger entry before new-consumption eligibility, and requires an active reservation for every new debit. It preserves the private function, lock order and execute revocations. Historical migration files were retained.
- **Verification:** Four of seven checks failed against the previous latest function. Seven quantity/replay edge checks now pass with the prepared body. The broader factory fixture also verifies exact replay and authenticated delivery updates after partial release. Full suite: 739 passed, zero failures/skips/cancellations; lint, typecheck, build and whitespace checks passed. Only extracted candidate function definitions ran in isolated fixtures; the new migration script was not applied to a Supabase project.
- **Pre-application status (historical):** OPEN; LOCAL CANDIDATE VERIFIED, NOT APPLIED. This does not add public dispatch-creation idempotency, a release UI, or a physical return. Hosted activation and independent-session acceptance remain pending under the no-migrations instruction.
- **Current status, 20 October:** OPEN; DATABASE CANDIDATE APPLIED AND CATALOG/GRANTS VERIFIED. Complete authenticated workflow, independent-session, historical-data and physical/operator acceptance remain separate. See `docs/MIGRATION_RECONCILIATION_2026-10-20.md`.
- **Evidence:** `tests/reservation-release-replay.test.mjs`; `scripts/test-factory-workflow-integrity.mjs`; `docs/BUGS_MEGA_PROGRESS_2026-10-15.md`.

### R05 - Reservation ledger truncates records and quantities and hides read failures

- **Severity:** P2, assessed in this continuation. **Importance:** Inventory staff can miss older holds, overstate remaining stock, mistake a failed query for zero commitments, or lose the recorded release status. **Complexity:** Large.
- **Where / problem:** `/inventory/reservations` loaded at most 300 reservations with embedded consumption history, computed totals over that subset, and guessed `consumed` status from remaining weight. It had no server pagination/search/filter/sort. Broad inventory read access offered the page to roles outside the reservation RLS read cohort. The inventory overview also rendered a failed count as zero.
- **Prepared resolution:** `supabase/migrations/20261015010000_reservation_ledger_projection.sql` defines a read-only, authenticated, tenant-derived RPC returning one complete filtered summary, exact count and stable ten-row page. It preserves lifecycle status, separates reserved/consumed/open/released kg, metres and pieces, validates consumption lineage and quantities, and leaves missing legacy units unknown. The page validates the payload, shows an explicit unavailable state on failure, and adds bounded navigation and filters. Application navigation/read permission now matches the existing eight operational reservation-read roles.
- **Security:** The prepared security-definer function checks active identity and business role, explicitly scopes all source relations by company, exposes no commercial costs/values, revokes anonymous/public execute and grants only its own read endpoint to authenticated. Existing RLS policies, write grants and historical migrations are unchanged. No new index duplicates the existing company/reservation index.
- **Verification:** Six initial page checks failed before implementation. Nineteen new behavioral/SQL checks pass; with the existing audit-catalog integration, 20 focused checks pass. Fixtures cover 601 reservations over 61 pages, 1,501 consumption entries, literal search metacharacters, stable sorts, tenant/role/suspension rejection, invalid lineage, negative/overconsumed evidence, missing units, malformed responses and unavailable-versus-empty states. The final source audit added a failing altered-lineage regression before its repair. Full suite: 758 passed, zero failures/skips/cancellations; lint, typecheck, build (153 pages) and whitespace checks passed.
- **Browser evidence:** Isolated actual-page rendering with the built application CSS/font passed at 1440, 820, 390 and 320 pixels. Checks cover ten rows, next-page navigation, contained horizontal scrolling, large summary values and the unavailable state. Correcting the harness font exposed and led to fixing tablet summary overflow. Screenshots were inspected. This uses synthetic transport and is not an authenticated hosted journey.
- **Pre-application status (historical):** OPEN; LOCAL CANDIDATE VERIFIED, NOT APPLIED. The page requires the new read RPC; until compatible schema activation it deliberately reports unavailable rather than trusting truncated data. No Supabase migration or deployment was performed. Full-chain replay, real JWT/RLS checks, independent sessions, historical stock reconciliation and operator acceptance remain open.
- **Current status, 20 October:** OPEN; DATABASE CANDIDATE APPLIED AND CATALOG/GRANTS VERIFIED. Complete authenticated workflow, independent-session, historical-data and physical/operator acceptance remain separate. See `docs/MIGRATION_RECONCILIATION_2026-10-20.md`.
- **Evidence:** `tests/reservation-ledger.test.mjs`; `tests/reservation-ledger-page.test.mjs`; `scripts/test-audit-migration-integration.mjs`; `scripts/qa-reservation-ledger.mjs`; `docs/BUGS_MEGA_PROGRESS_2026-10-15.md`.

### R06 - A standalone credit adjustment and a return credit can settle the same invoice twice

- **Severity:** P1, assessed in this continuation. **Importance:** A customer refund balance can include a non-cash adjustment as though it were money received. **Complexity:** Large.
- **Where / problem:** `record_payment_atomic` stores the `credit_note` payment method as a posted adjustment, and collection-state calculation includes it in settlement. `issue_dispatch_return_credit_note_atomic` independently credits the full invoice value. On a synthetic 100-total invoice, a 100 non-cash adjustment plus a full return credit produced a 100 customer refund with zero cash received. With 20 cash plus a 30 adjustment, the displayed refund became 50 instead of 20. Cash-event analytics still excluded the `credit_note` method; the reproduced defect is duplicated settlement/refund entitlement.
- **Prepared resolution:** `supabase/migrations/20261015020000_credit_settlement_exclusivity.sql` adds one private trigger function and two posting guards. Both ledgers lock the same company-scoped invoice and reject a posted standalone adjustment alongside an issued return credit. Insert and activation/amount/identity updates are covered. Cancelled/pending adjustments, reversals, valid cash receipts/refunds and existing idempotent replays remain usable. An operator must explicitly reverse the standalone adjustment before replacing it with the full return document.
- **Historical review and UI:** `sql/audit-credit-settlement-conflicts.sql` is a read-only report of mixed settlement sources, recorded refund balance and the cash-supported balance. It does not rewrite history. Receipt entry now explicitly labels the non-cash adjustment's heading, amount, action and confirmation, and both posting screens explain the separate return-credit path. The return panel labels its mixed settlement figure as receipts/adjustments. Existing historical conflicts still require review and authorized correction; these labels do not certify historical refund balances.
- **Security:** No public RPC, new write grant, RLS change, dependency or duplicate index was added. Direct execute on the new private function is revoked from public, anonymous and authenticated roles. Existing company/role authorization and public RPC boundaries remain intact. The read-only deployment preflight checks the private guard's attachment, enabled state and function privileges.
- **Verification:** Seven of nine initial SQL checks failed before the guard. Eleven final SQL checks and four additional component checks pass; the 33-check focused regression also includes the existing payment, corrected-credit and audit-catalog tests. Actual public SQL wrappers were exercised under a synthetic authenticated SQL role. Tests verify the 20-cash/30-adjustment correction, zero-cash rejection, both ledger directions, pending/reactivation updates, tenant/role rejection, historical replay/reversal, metadata preservation, read-only review and private ACLs. Full suite: 773 passed, 76 suites, zero failures/skips/cancellations; lint, typecheck, build (153 pages), source audit and whitespace checks passed.
- **Browser evidence:** Twelve isolated rendered-component cases passed: cash receipt, non-cash adjustment and return credit at 1440, 820, 390 and 320 pixels. They use the current built CSS/font, synthetic state and loopback-only assets. Screenshots were inspected. Posting callbacks are tested separately; this is not a signed-in hosted browser journey.
- **Pre-application status (historical):** OPEN; LOCAL CANDIDATE VERIFIED, NOT APPLIED. The new function, trigger and ACL objects ran only in disposable PGlite fixtures; the new migration script was not applied. No Supabase migration, hosted historical-data query/write or deployment was performed. Activation, historical reconciliation, independent concurrent sessions, credit-note key binding across different dispatches and authenticated acceptance remain pending.
- **Current status, 20 October:** OPEN; DATABASE CANDIDATE APPLIED AND CATALOG/GRANTS VERIFIED. Complete authenticated workflow, independent-session, historical-data and physical/operator acceptance remain separate. See `docs/MIGRATION_RECONCILIATION_2026-10-20.md`.
- **Evidence:** `tests/credit-settlement-conflict.test.mjs`; `tests/credit-settlement-guidance.test.mjs`; `tests/credit-note-reissue.test.mjs`; `scripts/test-audit-migration-integration.mjs`; `scripts/qa-credit-settlement.mjs`; `docs/BUGS_MEGA_PROGRESS_2026-10-15.md`.

### R07 - Credit-note retry keys acknowledge a different dispatch or reason

- **Severity:** P2, assessed in this continuation. **Importance:** An accounts user can receive success for a document that does not match the requested dispatch or return reason. **Complexity:** Medium.
- **Where / problem:** `private.issue_dispatch_return_credit_note_atomic` looked up a company/key pair and immediately returned its credit-note ID, without comparing dispatch or reason. The same key could acknowledge another dispatch, a changed reason or an attempted correction of a reversed note. Its lookup also lacked a per-key transaction lock.
- **Prepared resolution:** `supabase/migrations/20261015030000_credit_note_retry_binding.sql` locks the company/key before lookup, compares the dispatch and trimmed reason, and returns the original note only for an exact retry. Conflicts reject with an instruction to refresh and review the original document. A fresh key remains necessary for corrected issuance after reversal. Authentication remains before lookup, and an absent role now explicitly rejects. Source comparison confirms the remaining dispatch/invoice checks, note snapshot, balance and audit tail are unchanged.
- **Verification:** Five of seven initial SQL checks failed; diagnostics captured another dispatch being acknowledged and an old reason surviving a changed-reason request. Nine final SQL checks pass, including normalized repeats, foreign/unknown/null targets, reversal/new-key correction, failure/retry through R06, company/role gates and lifecycle/input rejection. The existing actual-component/SQL correction test now checks stale-screen reason conflict without refreshing or rewriting the note, then a valid corrected issue. Thirty focused checks pass. Full suite: 782 passed, 76 suites, zero failures/skips/cancellations; lint, typecheck, build (153 pages), source audit and whitespace checks passed.
- **Pre-application security/status (historical):** OPEN; LOCAL CANDIDATE VERIFIED, NOT APPLIED. No new RPC, grant, RLS policy, column, dependency, historical rewrite or application UI change was added. Direct private execution remains revoked. Only the candidate function definition/ACL ran in isolated fixtures. The key lock's source/execution is verified locally; independent-session race behavior, real JWT/RLS, private-body activation and hosted acceptance remain open. No Supabase migration or deployment was performed.
- **Current status, 20 October:** OPEN; DATABASE CANDIDATE APPLIED AND CATALOG/GRANTS VERIFIED. Complete authenticated workflow, independent-session, historical-data and physical/operator acceptance remain separate. See `docs/MIGRATION_RECONCILIATION_2026-10-20.md`.
- **Evidence:** `tests/credit-note-idempotency.test.mjs`; `tests/credit-note-reissue.test.mjs`; `tests/credit-settlement-conflict.test.mjs`; `scripts/test-audit-migration-integration.mjs`; `docs/BUGS_MEGA_PROGRESS_2026-10-15.md`.

### R08 - Order entry cannot capture complete priced direct-order lines

- **Severity:** P2, assessed in this continuation. **Importance:** An order without a quotation can lack the priced line identities needed for production, dispatch and invoicing. **Complexity:** Large.
- **Requirement / reproduced gap:** The user confirmed that order creation must offer both an approved quotation and direct priced-line entry. `/orders/new` offered only quotation selection. The older `save_order_atomic` accepted an attempted direct-order payload but saved zero commercial lines and a server-derived zero value; extra line input was ignored. Existing line guards required quotation provenance, and billet rebuilding did not handle a multi-profile direct snapshot. This is not evidence about the contents of hosted historical orders.
- **Prepared resolution:** The factory new-order route now offers both methods and preserves quotation deep links. A direct form captures customer, profile, whole pieces, cut length, finish, agreed INR/kg rate, HSN and line GST. Authorised internal owner/admin/sales-manager/sales roles can create through `create_direct_order_atomic`; operational and dealer roles retain their existing commercial boundaries. `supabase/migrations/20261015040000_direct_priced_orders.sql` prepares that atomic endpoint, immutable commercial/material snapshots, complete multi-profile billet requirements, the existing below-700-kg consolidation rule, and exact retry-key binding. New header-only direct creation through the older save endpoint rejects; existing operational edits and quotation paths remain. The new-order action invalidates the actual `/production/consolidation` route.
- **Integrity / security:** Company, actor, business number, weight and totals are server-derived. Master-data locks and an expected section-weight comparison reject stale previews. Soft-deleted customers, profiles and optional dies cannot enter a new direct order. A private company/key ledger has RLS enabled, no client policies or table privileges, and a transaction-limited initial-save authorisation. Its accepted material snapshot survives later master edits. Browser roles cannot execute private implementations; the new public endpoint grants authenticated execution and checks the active internal commercial role itself. Existing public-table RLS, cost masks and write grants are unchanged. Direct-order GST is recovered from its immutable line even if a packing payload contains another rate; unmanaged historical tax precedence is retained. No cost estimate, historical price, stock receipt or quotation is invented.
- **Verification:** 34 new SQL/action/page checks pass, including 100-line decimal parity, duplicate profiles with distinct prices/finishes, complete grouped material requirements, stale/forged weights, whole-unit and money bounds, tenant/role/suspension rejection, rollback after a late audit failure, exact retries across committed sequential transactions, immutable snapshots, partial-shipment pricing, read-only historical review and ACL/catalog checks. Existing dealer and sales quotation conversion tests also run with the prepared R08 objects installed. Full suite: 816 passed, 76 suites, zero failures/skips/cancellations; lint, typecheck, build (153 pages), source review and whitespace checks passed.
- **Browser evidence:** The actual route links, interactive React direct form, server actions and public SQL wrapper were exercised against a disposable PGlite fixture at 1440, 820, 390 and 320 pixels. Two lines saved 165 kg / INR 51,375 with one audit and a pending consolidation. Checks cover cleared selections/GST, an incomplete added line, removal, unavailable catalog/workflow, and recovery of one committed order after a lost confirmation. Eleven screenshots and results were saved; representative desktop, tablet and mobile screenshots were inspected. Identity/transport are synthetic; the quotation child is a fixture boundary, not a complete signed-in quotation UI journey.
- **Pre-application status (historical):** OPEN; LOCAL CANDIDATE VERIFIED, NOT APPLIED. No Supabase migration, hosted historical query/write or deployment was performed. Full prerequisite replay, hosted identities/RLS, independent-session races, historical reconciliation and operator acceptance remain pending. This is create-only commercial capture; price/quantity corrections require review and a corrected order rather than rewriting committed snapshots. Dealer direct pricing, historical line backfill and automatic physical returns are not added.
- **Current status, 20 October:** OPEN; DATABASE CANDIDATE APPLIED AND CATALOG/GRANTS VERIFIED. Complete authenticated workflow, independent-session, historical-data and physical/operator acceptance remain separate. See `docs/MIGRATION_RECONCILIATION_2026-10-20.md`.
- **Evidence:** `tests/direct-order.test.mjs`; `tests/direct-order-actions.test.mjs`; `tests/direct-order-entry-page.test.mjs`; `scripts/lib/direct-order-fixture.mjs`; `scripts/qa-direct-orders.mjs`; `sql/audit-direct-order-lines.sql`; `docs/BUGS_MEGA_PROGRESS_2026-10-15.md`.

### R09 - Dispatch detail misstates reservation remainders and hides incomplete reads

- **Severity:** P2, assessed in this continuation. **Importance:** Dispatch staff can count released/cancelled holds as active, overstate available quantities after partial shipments, or mistake a failed read for no commitments. **Complexity:** Medium.
- **Where / problem:** The reservation panel in `app/(dashboard)/dispatches/[id]/page.tsx` summed embedded consumption histories, ignored reservation-read errors and classified every positive remainder as active regardless of lifecycle. Its unbounded header request and embedded history were subject to API caps. It lacked reservation-specific permission checks, server pagination, and consumed/released kg, metres and pieces.
- **Prepared resolution:** `20261015050000_dispatch_reservation_ledger.sql` introduces a company-, active-identity- and role-checked dispatch RPC. It resolves the source order on the server and uses the same private calculation as the existing inventory-ledger RPC. One snapshot returns complete source-order totals and stable ten-row pages. An unlinked dispatch returns an explicit unlinked result, never the whole company ledger. Malformed, missing, stale-page or conflicting evidence produces an unavailable panel. Lifecycle status stays recorded and unknown legacy units stay unknown. The display states that order totals span dispatches and that physical returns require a recorded receipt.
- **Security / integrity:** The dispatch endpoint requires the six roles that can read both dispatches and reservations; the global inventory endpoint retains its original eight-role boundary. Company/order/profile/batch labels are joined within the derived company, commercial fields are omitted, anonymous execution is revoked, and authenticated callers cannot execute the private calculation directly. Invalid or non-finite source quantities and contradictory consumed lifecycle evidence invalidate the entire matching snapshot even outside the displayed page. No table, stock, policy or history is changed by the reader.
- **Verification:** Seven of eight initial page checks failed against the old panel, including a 1,501-entry consumption history truncated to 1,000 entries and 12 kg of released/cancelled remainders labelled active. All 24 new SQL/page/loader checks pass; existing inventory-page and SQL regressions run with the shared calculation, and the integration fixture preserves existing masks and private/anonymous denial. Full suite: 840 passed, 76 suites, zero failures/skips/cancellations. Lint, typecheck, build (153 pages), source audit and whitespace checks passed. Review restored automatic-consumption guidance and distinguished fully consumed close dates from hold release dates.
- **Browser evidence:** The actual route/panel with synthetic identity/RPC transport and built CSS/fonts passed at 1440, 820, 390 and 320 pixels, including real next/previous link navigation, the last page, released/unknown/empty/unlinked/unavailable states and large quantities. Eleven screenshots and results were saved; desktop, tablet, compact-mobile, large-number and unavailable views were inspected. No page errors or document overflow were recorded. This is isolated panel evidence, not a signed-in full dispatch journey or physical-return test.
- **Pre-application status (historical):** OPEN; LOCAL CANDIDATE VERIFIED, NOT APPLIED. No Supabase migration was run. Hosted activation, authenticated operator acceptance, independent sessions, release UI, physical-return receipts and historical reconciliation remain open.
- **Current status, 20 October:** OPEN; DATABASE CANDIDATE APPLIED AND CATALOG/GRANTS VERIFIED. Complete authenticated workflow, independent-session, historical-data and physical/operator acceptance remain separate. See `docs/MIGRATION_RECONCILIATION_2026-10-20.md`.
- **Evidence:** `tests/dispatch-reservation-ledger.test.mjs`; `tests/dispatch-reservation-ledger-page.test.mjs`; `scripts/lib/dispatch-reservation-ledger-fixture.mjs`; `scripts/lib/dispatch-reservation-render-fixture.mjs`; `scripts/qa-dispatch-reservation-ledger.mjs`; `docs/BUGS_MEGA_PROGRESS_2026-10-15.md`.

### R10 - Order cancellation invents a dealer stock return and retains active holds

- **Severity:** P1, assessed in this continuation. **Importance:** Cancelling an unfulfilled remainder can create stock that has not returned, break kg/metre/piece consistency and leave the order's unconsumed holds blocking available stock. **Complexity:** Large.
- **Where / problem:** `public.credit_dealer_stock_on_order_cancel`, attached to order-stage updates, unconditionally credited every uncredited dealer fulfillment back into its batch, set it available and posted a positive inventory movement. It restored kg/pieces without metres, marked fulfillment credited and claimed an automatic return in history. It did not release profile-stock reservations, and the reservation capacity guard did not reject a cancelled parent order.
- **Reproduction:** With 40 kg / 20 m / 4 pieces physically remaining after existing shipments, cancellation produced 60 kg / 20 m / 6 pieces and an automatic credit without return evidence. The target order's 20 kg / 10 m / 2-piece remainder remained active. Seven of eight initial SQL checks failed; the sibling-company isolation control passed.
- **Prepared resolution:** `20261015060000_order_cancellation_stock_integrity.sql` replaces the existing trigger body with an active-company owner/admin check, complete source integrity validation through R09's shared calculation, cancellation of the target order's active holds, and one accurate stage/audit entry. Posted dealer fulfillment, inventory movements, physical batches, consumed quantities and other orders' holds are preserved. Repeated cancellation performs no second release or audit. A new private eligibility guard prevents new/reassigned/reactivated active holds against cancelled orders and retains the existing capacity and terminal-state checks. Order/reservation lock conflicts return a retry without a partial cancellation.
- **Security / historical review:** No public business RPC, new table, write grant, RLS policy, index, dependency or historical rewrite is added. Direct execution of both trigger implementations is revoked from public, anonymous and authenticated roles. The deployment preflight checks their attachments/enabled state and ACLs. `sql/audit-order-cancellation-stock.sql` is a read-only review of cancelled orders retaining active holds and credited fulfillments needing physical-receipt review; a recorded credit does not establish that goods returned.
- **Verification:** All 17 new SQL edge checks pass. The 33-check focused run includes the existing dispatch panel, integrated catalog/masks, factory workflows with the eligibility guard, and actual quote conversion followed by cancellation. Coverage includes 602 holds, 1,501 consumption entries, exact posted retry, role/company/suspension gates, read-only review, private ACLs, repeat cancellation and rollback after integrity/audit/lock failures. Full suite: 857 passed, 76 suites, zero failures/skips/cancellations. Lint, typecheck, build (153 pages), source audit and whitespace checks passed. Source audit separately reproduced the unresolved invoice-stage blocker R11; green stock tests do not close it.
- **Browser evidence:** The actual SQL-backed dispatch panel passed before/after cancellation at 1440, 820, 390 and 320 pixels. It showed zero open / 10 kg consumed / 20 kg released, including 10 m / 2 released pieces, while stock stayed 40 kg / 20 m / 4 pieces. Eight screenshots/results were saved and representative desktop/compact-mobile views inspected. No document overflow or page errors occurred. The cancellation is a local SQL control with synthetic identity, not an operator UI or hosted session.
- **Pre-application status (historical):** OPEN; LOCAL CANDIDATE VERIFIED, NOT APPLIED. Only extracted candidate objects ran in disposable PGlite. No Supabase migration was run. This repairs cancellation-trigger stock behavior; R11's candidate still requires activation/acceptance. An operator cancellation/release UI, physical-return receipt workflow, historical corrections, hosted JWT/RLS and independent-session acceptance remain open.
- **Current status, 20 October:** OPEN; DATABASE CANDIDATE APPLIED AND CATALOG/GRANTS VERIFIED. Complete authenticated workflow, independent-session, historical-data and physical/operator acceptance remain separate. See `docs/MIGRATION_RECONCILIATION_2026-10-20.md`.
- **Evidence:** `tests/order-cancellation-stock.test.mjs`; `scripts/lib/order-cancellation-stock-fixture.mjs`; `scripts/qa-order-cancellation-stock.mjs`; `sql/audit-order-cancellation-stock.sql`; `docs/BUGS_MEGA_PROGRESS_2026-10-15.md`.

### R11 - Cancelled order stage blocks invoicing an existing delivered dispatch

- **Severity:** P1, assessed in this continuation. **Importance:** Shipped stock can remain unbillable after cancellation of the remaining order, despite its fulfillment and physical debit being retained. **Complexity:** Large.
- **Where / problem:** The invoice form excluded all cancelled orders and loaded only 500 sources. `saveInvoiceAction` rejected the parent stage before selecting the supplied dispatch, and the latest SQL writer also rejected cancelled orders. These gates did not distinguish retained posted shipments from the unfulfilled remainder.
- **Reproduction:** After the real local R10 cancellation trigger, a same-company active owner submitted a valid invoice request for the order's existing delivered dispatch. The actual action returned `A cancelled order cannot be invoiced.` after querying only `orders`; it never inspected the dispatch or reached the invoice writer. Physical stock stayed 40 kg / 20 m / 4 pieces and the shipment remained recorded. This diagnostic establishes the early action blocker, not acceptance of all downstream invoice conditions.
- **Prepared resolution:** `supabase/migrations/20261019000000_retained_dispatch_invoices.sql` shares retained-shipment eligibility between bounded source discovery and locked save/regeneration. A cancelled order requires a verified dispatched, in-transit or delivered shipment posted before its same-company cancellation history. Every manifest group and posted reservation entry must agree, and dealer/production shipments must fit posted source quantities in kg/metres/pieces. Missing/foreign/nonfinite/contradictory history is unavailable. Normal open-order eligibility, exact packing/commercial/GST/snapshot guards, issued locks and receipt/credit/refund settlement are retained. No physical stock or fulfillment is changed. Source search is capped at 25 with exact selected-ID lookup; the action reads the complete manifest in stable 200-row counted pages.
- **Security:** The new read RPC derives company from the active database identity and permits only owner/admin/accounts. Anonymous/private/trigger execute stays revoked; the public save/replace contracts and existing financial read-only RLS stay intact. No new table, index, RLS policy or general write grant is added.
- **Verification:** 43 SQL and 19 actual-action regressions cover all three source families/statuses, timing/provenance/unit failures, orphan posting, role/company/suspension/ACL boundaries, forged prices, duplicate invoices/sources, deferred full coverage, rollback, edits/regeneration, issued locks, 601 newer orders, literal search and a 1,201-row manifest. A retained shipment produces INR 1,000 subtotal + INR 180 GST = INR 1,180 while physical stock remains 40 kg / 20 m / 4 pieces. Actual financial functions also pass cash receipt, return credit, refund and reversal checks. Full suite: 919 passed, 76 suites, zero failures/skips/cancellations; lint, typecheck, build (153 pages), source audit and whitespace checks passed.
- **Browser evidence:** Actual form/actions/public SQL with synthetic session/transport and disposable PGlite passed create/edit/sent-lock, source errors, stale responses, same-order reselection and bounded layout at 1440, 820, 390 and 320 pixels. Nine R11 screenshots and a separate R12 diagnostic are saved. No page errors. Built CSS/fonts and representative images were inspected; this is not hosted authenticated UAT.
- **Pre-application status (historical):** OPEN; LOCAL CANDIDATE VERIFIED, NOT APPLIED. The candidate migration wrapper was not run and no Supabase migration was applied. Compatible schema activation, real JWT/RLS, independent-session races, historical source review and operator cancellation/invoice/return acceptance remain open.
- **Current status, 20 October:** OPEN; DATABASE CANDIDATE APPLIED AND CATALOG/GRANTS VERIFIED. Complete authenticated workflow, independent-session, historical-data and physical/operator acceptance remain separate. See `docs/MIGRATION_RECONCILIATION_2026-10-20.md`.
- **Evidence:** `tests/retained-dispatch-invoice.test.mjs`; `tests/invoice-source-actions.test.mjs`; `scripts/qa-retained-dispatch-invoices.mjs`; `scripts/audit-cancelled-order-invoice.mjs`; `docs/BUGS_MEGA_PROGRESS_2026-10-19.md`. The original failing diagnostic and 15 October baseline remain preserved.

### R17 - Terminal finishing movement evidence can be rewritten or deleted

- **Severity:** P2, assessed in this continuation. **Importance:** A completed or rejected finishing record can lose vendor/date/route evidence while dependent history and packaging still describe the original movement. **Complexity:** Large.
- **Where / problem:** `public.validate_finishing_transition` in the Astra remediation locks terminal weights/remarks and source identity, but does not lock all movement fields or deletion. `private.transition_finishing_job_atomic` also defaults receipt/sent dates to today before considering saved dates. Exact retries or completion after an earlier receipt can rewrite dates when optional values are omitted.
- **Reproduction:** Actual local production and finishing RPCs create a 95-kg input / 90-kg accepted / 5-kg rejected completed job and one 90-kg packaging handoff. A same-status public finishing call replaces the vendor and both movement dates without adding a status-history event. Original before/after JSON is preserved. The initial edge-test baseline fails 27 of 33 scenarios; terminal deletion and additional evidence-field edits also reproduce, while existing weight edits reject.
- **Resolution, applied 20 October:** `20261019010000_terminal_finishing_evidence.sql` adds an unavoidable update/delete guard for completed, rejected and `not_required` rows, comparing all business fields while allowing timestamp-only maintenance. It preserves recorded dates before using new-transition defaults, so exact retries retain original evidence. Active movements and the existing bounded corrective-retry workflow remain available. No historical record is repaired or deleted.
- **Verification:** Forty-two candidate scenarios plus their enclosing test pass; the six-file focused integration/preflight group passes 136 tests. These cover direct/public-RPC edits, history-preserving deletion rejection, normal movements, exact and later-transaction retries, missing legacy dates, corrective completion, rollback, later-added fields, role/company checks, private ACLs and the attached update/delete trigger. Integration installs 28 prepared function definitions and eight trigger attachments alongside the eight historical audit scripts. Final `npm test -- --test-concurrency=2`: 1,182 passed / 76 suites, zero failures/skips/cancellations. Lint, typecheck, build (153 pages), source comparison and whitespace checks pass. Two earlier full runs exposed preflight-test statement parsing regressions; those failures are preserved, the affected consumers are repaired and the complete final rerun passes.
- **Pre-application status (historical):** OPEN; LOCAL CANDIDATE VERIFIED, NOT APPLIED. Synthetic SQL identity and historical table fixtures do not prove hosted JWT/RLS, independent-session behavior, a complete operator journey, physical loss/gain reconciliation or historical correctness. No Supabase migration has run, and no application/UI or production data changed for this candidate.
- **Current status, 20 October:** OPEN; DATABASE CANDIDATE APPLIED AND CATALOG/GRANTS VERIFIED. Complete authenticated workflow, independent-session, historical-data and physical/operator acceptance remain separate. See `docs/MIGRATION_RECONCILIATION_2026-10-20.md`.
- **Evidence:** `tests/finishing-evidence.test.mjs`; `scripts/audit-finishing-evidence.mjs`; `scripts/lib/finishing-evidence-fixture.mjs`; `sql/audit-deployment-preflight.sql`; `docs/BUGS_MEGA_PROGRESS_2026-10-19.md`; original `finishing-evidence-diagnostic.json` and candidate `finishing-evidence-regression.json` in the session evidence directory.

### R18 - Partial finishing rejection strands the accepted portion after a retry

- **Severity:** P2, assessed in this continuation. **Importance:** Accepted material can remain unavailable for QC, packaging and dispatch despite a reconciled finishing/retry chain. **Complexity:** Large.
- **Where / problem:** Finishing transitions allow positive accepted output on a rejected job and subtract it when calculating recoverable retry input. The finishing-to-packaging trigger runs only for completed jobs and queues at most one package per production job. Post-finishing QC requires a completed finishing job; dispatch preparation chooses one completed run and SQL readiness takes its maximum output rather than reconciling all accepted dispositions.
- **Reproduction:** Actual public production/finishing/retry SQL records 95 kg production output, 40 kg accepted and 55 kg rejected on the original finishing run, then 50 kg accepted and 5 kg rejected on the corrective retry. The original remains immutable and the chain reconciles to 90 kg accepted plus 5 kg rejected. Only a 50-kg retry package is queued; QC approval of the original 40 kg rejects with `QC finishing job must be completed and match this production job`. The retry's 50 kg approves normally. Original diagnostic JSON is preserved.
- **Resolution, applied 20 October:** `20261019020000_finishing_accepted_dispositions.sql` preserves final, received accepted portions on completed or rejected finishing rows. It bounds original input, retry ancestry and total accepted output; queues receipt-linked packages; validates QC and package capacity for each portion; and shares the released-weight calculation between the authenticated read RPC and SQL dispatch authority. The application validates a complete company/order/job-scoped result and subtracts complete prior packing history. QC and packaging forms expose distinct original/retry receipts, preserve assigned source identity, clear stale selections and handle unavailable lookups explicitly. Blank optional QC measurements remain unknown. Deferred packaging checks now resolve the correct row type at commit, and receipt-aware defaults preserve entered partial-package weight on the later multi-material schema.
- **Legacy handling:** No historical link, date, quantity or stock was backfilled. A single unambiguous legacy completed package retains compatible readiness without a recorded link being invented. Ambiguous legacy packaging blocks release for review. `sql/audit-finishing-accepted-dispositions.sql` reports inconsistent source/quantity evidence and unlinked packages without modifying records. New receipt and package writes remain bounded by production and per-receipt capacity.
- **Verification:** The original four behavioral scenarios failed before implementation. There are 67 new passing checks: 35 SQL/action scenarios plus their enclosing test, 19 reader/validation checks and 12 actual-form/browser-to-SQL checks. They cover independent and multi-generation releases, three-decimal weights, already-packed quantities, role/company/anonymous denial, source changes, replay, missing evidence, legacy ambiguity, mill finish, later schema columns, rollback and explicit commit. The browser-entered original 40-kg QC/package payload passes the actual validation/SQL functions and commits with 40 kg ready; the complete candidate audit releases 90 kg with two material movements and 5 kg still rejected. Responsive QA inspected nine screenshots at 1440, 820, 390 and 320 pixels. Final full suite: **1,249 passed / 76 suites**, zero failures/skips/cancellations; lint, typecheck, build (153 pages), source comparison and whitespace checks pass. Integration installs 40 prepared function definitions and 11 trigger attachments alongside the eight historical audit scripts. An earlier full run caught a premature browser-label assertion; the revised test verifies the actual cleared payload and rendered state, and the complete rerun passes.
- **Pre-application status (historical):** OPEN; LOCAL CANDIDATE VERIFIED, NOT APPLIED. Application and prepared schema must activate together only after separately authorized reconciliation and acceptance. Synthetic identities/transports and historical table fixtures do not prove hosted JWT/RLS/Storage, independent-session behavior, actual physical dispatch posting, a complete signed-in operator journey, physical finishing loss/gain or historical correctness. No Supabase migration, hosted write or deployment occurred.
- **Current status, 20 October:** OPEN; DATABASE CANDIDATE APPLIED AND CATALOG/GRANTS VERIFIED. Complete authenticated workflow, independent-session, historical-data and physical/operator acceptance remain separate. See `docs/MIGRATION_RECONCILIATION_2026-10-20.md`.
- **Evidence:** `tests/finishing-partial-retry.test.mjs`; `tests/finishing-readiness.test.mjs`; `tests/finishing-receipts-browser.test.mjs`; `scripts/audit-finishing-partial-retry.mjs`; `scripts/qa-finishing-receipts.mjs`; `sql/audit-finishing-accepted-dispositions.sql`; `docs/BUGS_MEGA_PROGRESS_2026-10-19.md`; original `finishing-partial-retry-diagnostic.json`, candidate `finishing-partial-retry-regression.json`, final gate logs and `responsive/results.json` in the session's `finishing-partial-retry` evidence directory.

### R19 - Packaging material movement evidence can be forged or erased independently of stock

- **Severity:** P2, assessed in this continuation. **Importance:** Packaging material audit history and release evidence can disagree with the retained stock debit or packing manifest. **Complexity:** Large.
- **Where / problem:** The historical `packaging movements tenant insert` policy checks company only, and direct mutation privileges allow an authenticated viewer to insert a fabricated material restore without running the stock workflow. `guard_terminal_packaging_job` protects updates only. Privileged header deletion cascades through material rows and movement history; the child stock trigger reads an already removed parent and restores nothing. Direct privileged movement update/delete is also unguarded.
- **Reproduction:** The local actual-SQL diagnostic records a completed package, one material issue, stock 99 from 100 and a retained 40-kg production packing manifest. Privileged header deletion commits with no package/material/movement rows while stock remains 99 and the manifest remains. A separate same-company viewer inserts a fabricated restore of 10: movement count rises from one to two, stock remains 99. Ordinary authenticated header deletion is already denied by the installed historical RLS policies, and direct terminal material deletion already rejects. The privileged deletion is not presented as an authenticated header-delete exploit.
- **Resolution, applied 20 October:** `20261019030000_packaging_material_evidence.sql` closes client table and column mutation grants on the movement ledger, removes its permissive insert policy, and preserves tenant-scoped reads and security-definer stock writers. New private guards retain terminal/material/packing-linked package headers and make recorded movements append-only. Empty active headers with no material or manifest evidence remain removable by privileged maintenance. `sql/audit-packaging-material-evidence.sql` reviews retained movement/material discrepancies without assigning authorship, inferring an opening balance or changing stock/history.
- **Verification:** Original baseline: 21 of 29 scenarios fail, plus their enclosing test; eight existing lifecycle/rollback/commit controls pass. The final candidate passes **39 tests**, comprising 38 scenarios and their enclosing test. These cover all 12 tested client roles, table/column grants, preserved tenant reads, privileged deletion/cascades and ledger mutation, decimal issue/replacement/removal, repeated cancellation, pending manifests, rollback, explicit commit, historical review and effective catalog/body/ACL checks. A combined R18/R19 runtime test commits independently approved/packaged original and corrective portions totaling 90 kg, with two retained material movements and stock 98 from 100. The four-file integration group earlier passed 118 checks. Final full suite: **1,288 passed / 76 suites**, zero failures/skips/cancellations; lint, typecheck, build (153 pages), source and whitespace audits pass. The original stock/cancellation writer bodies are unchanged, no application code writes the ledger directly, and both old trigger functions remain security-definer with direct client execution closed. Integration now installs 42 prepared function definitions and 13 trigger attachments alongside the eight historical audit scripts.
- **Pre-application status (historical):** OPEN; LOCAL CANDIDATE VERIFIED, NOT APPLIED. Synthetic local roles, historical policies and extracted prior candidates do not prove hosted privileges, real JWTs, independent sessions, physical material return, complete authenticated operator acceptance or historical correctness. Legacy rows have not been attested or corrected. No Supabase migration, hosted write or deployment occurred.
- **Current status, 20 October:** OPEN; DATABASE CANDIDATE APPLIED AND CATALOG/GRANTS VERIFIED. Complete authenticated workflow, independent-session, historical-data and physical/operator acceptance remain separate. See `docs/MIGRATION_RECONCILIATION_2026-10-20.md`.
- **Evidence:** `scripts/audit-packaging-evidence.mjs`; `scripts/lib/packaging-evidence-fixture.mjs`; `tests/packaging-evidence.test.mjs`; `sql/audit-packaging-material-evidence.sql`; original `packaging-evidence-diagnostic.json`, candidate `packaging-evidence-regression.json`, baseline and final gate logs in the session's `packaging-evidence` directory; `docs/BUGS_MEGA_PROGRESS_2026-10-19.md`.

### R20 - Finishing board reports transferred rejection as outstanding work and truncates its totals

- **Severity:** P2, assessed in this continuation. **Importance:** Operators can see the wrong rejected material and workload, mistake an unavailable read for no work, or be offered a duplicate corrective retry after its lookup failed. **Complexity:** Large.
- **Where / problem:** `/production/finishing` summed rejection over a 200-row attention preview, excluded completed retry rows from that metric, counted terminal rejected source receipts as open work, and converted failed reads to empty arrays. Its separate retry lookup could fail while the board still offered `Plan One Retry`.
- **Reproduction:** Actual persisted production/finishing/retry rows reconcile 95 kg original input to 40 kg original accepted plus 50 kg retry accepted and 5 kg remaining rejected. The actual original server page renders 55 kg rejected. A failed queue read renders zero open jobs/rejected kg; a failed retry read retains a retry offer. A separate 401-row synthetic queue renders a count of 200. Original JSON/HTML evidence is retained.
- **Resolution, applied 20 October:** `20261019040000_finishing_workload_projection.sql` returns complete material/status totals, exact corrective links, bounded ten-row attention previews and ten-row database pages from a stable, authenticated company-scoped read statement. It excludes transferred retry input from remaining rejection and reports unaccounted recorded weight separately from physical process loss/gain. Invalid source, receipt or retry evidence fails verification. The application validates the entire response and suppresses metrics/controls when unavailable. The overview, searchable/sortable paginated database and receipt detail pages preserve historical quantities and original/retry links. Movement actions revalidate all three surfaces.
- **Verification:** All 129 new SQL/reader/page/browser checks pass; with catalog integration the focused group passes 130 checks. Cases cover multi-generation and provisional receipts, decimal/signed differences, 401 actual production completions, bounded stable pages, literal search, roles/tenants, malformed/unavailable responses and injected legacy evidence. The final source audit reproduced and repaired three filtered-lineage gaps: a historical retry outside the selected production/order/company cannot make its source appear verified and retryable, and its out-of-scope identity is not returned. The actual browser-to-action-to-SQL journey plans 55 kg and completes 50 accepted / 5 rejected, then verifies committed 90 accepted / 5 remaining / zero active totals and exact receipt links. Responsive QA passes at 1440, 820, 390 and 320 pixels, with 16 screenshots, zero page errors and no document overflow; representative images were inspected. The final full suite passes 1,417 tests / 76 suites, zero failures/skips/cancellations. Lint, typecheck, build (154 generated pages), source audit and tracked/new-file whitespace checks pass.
- **Pre-application status (historical):** OPEN; LOCAL CANDIDATE VERIFIED, NOT APPLIED. No Supabase migration, hosted write or deployment occurred. The new read RPC grants authenticated execution only and enforces company/role scope; existing writer bodies, RLS policies and stock rules remain intact. Hosted JWT/RLS, independent sessions, physical loss/gain/stock and full signed-in operator acceptance remain separate. The application requires the compatible read RPC and must not be activated as a partial, unreconciled schema update.
- **Current status, 20 October:** OPEN; DATABASE CANDIDATE APPLIED AND CATALOG/GRANTS VERIFIED. Complete authenticated workflow, independent-session, historical-data and physical/operator acceptance remain separate. See `docs/MIGRATION_RECONCILIATION_2026-10-20.md`.
- **Evidence:** `scripts/audit-finishing-board.mjs`; `scripts/lib/finishing-workload-fixture.mjs`; `tests/finishing-workload.test.mjs`; `tests/finishing-workload-reader.test.mjs`; `tests/finishing-workload-page.test.mjs`; `tests/finishing-workload-browser.test.mjs`; original and candidate artifacts under the session's `finishing-board` evidence directory; `docs/BUGS_MEGA_PROGRESS_2026-10-19.md`.

### R21 - Legacy billet-link repair mismatches temper or production profile and trusts stale counters

- **Severity:** P2, assessed in this continuation. **Importance:** Valid mixed-temper orders can fail refresh/priority allocation, and stale counters can cause extra links or hide missing material links. **Complexity:** Medium.
- **Where / problem:** `public.repair_order_billet_requirement_links` selected unlinked allocated/issued/consumed billets by alloy and diameter while the lineage guard also requires temper and any retained production job's profile. It calculated remaining links from the stored `billets_allocated` counter before refresh recomputed that counter.
- **Reproduction:** An older 6063/T5 requirement and a valid unlinked 6063/T6 billet on the same order make actual repair, requirement refresh and priority allocation throw the lineage guard's material-mismatch error. Failed transactions preserve stock. Thirteen of sixteen initial scenarios fail before the candidate; additional cases prove stale low/high counters and repeated repair can miscount retained links.
- **Resolution, applied 20 October:** `20261019050000_billet_link_repair_integrity.sql` normalizes alloy/temper like the lineage guard, matches diameter and retained production-job profile, computes remaining slots from actual company/order-scoped allocated/issued/consumed links, retains deterministic allocation-date ordering and existing row locking, and rejects inconsistent retained scope/material/production evidence for historical review. It changes only the missing allocation requirement link and update timestamp. Physical quantities, source, status, allocated dates and production-job identity remain retained. The internal helper remains closed to authenticated/anonymous/PUBLIC execution. No new public RPC, table, column, index, trigger or RLS policy is added.
- **Verification:** Forty-four new checks pass, including quotation-backed and direct material generation, five internal operator roles through the actual order refresh trigger, stale counters, inactive statuses, cross-company/order isolation, normalized material and retained production identity, rollback, committed retry, catalog privileges and read-only historical review under SELECT-only permissions. The final audits reproduced and repaired a missing-order blind spot in the review report and the retained-production profile mismatch. The focused candidate/catalog group passes 45 checks. Final full suite: 1,461 tests / 76 suites, zero failures/skips/cancellations. Lint, typecheck, build (154 generated pages), source/security audit and tracked/new-file whitespace review pass.
- **Historical review:** `sql/audit-billet-allocation-links.sql` identifies unlinked, missing/inconsistent/incompatible and overfilled/counter-drift evidence without changing it. It does not attest material mass adequacy, physical stock or old links.
- **Pre-application status (historical):** OPEN; LOCAL CANDIDATE VERIFIED, NOT APPLIED. R22 separately blocks manual RPC compatibility and is not fixed by this candidate. Hosted activation, real JWT/RLS, independent sessions, historical reconciliation and operator acceptance remain open. No Supabase migration, hosted write or deployment occurred.
- **Current status, 20 October:** OPEN; DATABASE CANDIDATE APPLIED AND CATALOG/GRANTS VERIFIED. Complete authenticated workflow, independent-session, historical-data and physical/operator acceptance remain separate. See `docs/MIGRATION_RECONCILIATION_2026-10-20.md`.
- **Evidence:** `scripts/audit-billet-link-repair.mjs`; `scripts/lib/billet-link-repair-fixture.mjs`; `tests/billet-link-repair.test.mjs`; original/candidate JSON under the session's `billet-link-repair` evidence directory; `docs/BUGS_MEGA_PROGRESS_2026-10-19.md`.

### R22 - Manual billet allocation references a profile column absent from the checkout schema

- **Severity:** P2, assessed in this continuation. **Importance:** An otherwise eligible manual allocation fails before allocating a cast billet. **Complexity:** Large.
- **Where / problem:** The current `private.allocate_billet_to_order` and `private.reallocate_billet_to_order` definitions in `20261008020000_factory_workflow_integrity.sql` read `v_billet.profile_id` in their production-eligibility expressions. The billet DDL and subsequent column additions in this checkout provide no such column. Billet profile eligibility must come from actual order/material/production lineage.
- **Reproduction (historical):** The actual public manual-allocation wrapper against historical-column tables, a newly created priced order and a fresh compatible cast billet throws `record "v_billet" has no field "profile_id"`. The diagnostic asserts that the fixture's billet table has zero `profile_id` columns. The older broad factory fixture added that field by hand, so its earlier passing allocation check does not establish compatibility with the checkout schema. This established the local source/fixture mismatch; hosted schema state was unknown then and was subsequently inspected on 20 October.
- **Resolution and proof, 20 October:** `20261020000000_manual_billet_requirement_lineage.sql` derives profile eligibility from the selected requirement and exact order/production lineage, sharing one locked allocation/reallocation writer. It retains active-user/role/company/material checks, both order counters and physical billet fields. The broad fixture no longer invents a billet profile column. Two new files provide 52 SQL/action checks, including deterministic per-profile eligibility, forbidden roles/foreign scope, lost responses and late projection rollback. The final 1,531-test suite, lint, typecheck and build pass.
- **Current status:** OPEN; DATABASE PATCH APPLIED, LOCAL BEHAVIOR VERIFIED AND HOSTED BODY/ACL CHECKED. Shared private helpers remain closed; authenticated public wrappers remain available. Complete signed-in allocation-panel/operator acceptance, real-token checks, historical reconciliation and independent sessions remain pending. No issue is marked fully fixed from migration activation alone. Evidence: `scripts/audit-manual-billet-allocation.mjs`, both manual-billet-allocation test files and `docs/MIGRATION_RECONCILIATION_2026-10-20.md`.
- **Evidence:** `scripts/audit-billet-link-repair.mjs`; `scripts/lib/billet-link-repair-fixture.mjs`; `supabase/migrations/0051_foundry_sources_scrap_billets_packaging.sql`; `supabase/migrations/20261008020000_factory_workflow_integrity.sql`; original/candidate diagnostic JSON's separate manual-allocation failure.

### R24 - Manual allocation lookup offers ineligible orders and hides compatible choices

- **Severity:** P2, assessed in this continuation. **Importance:** Operators can be offered orders rejected by the actual allocator, fail to find compatible normalized material or later records, and see repeated choices with misleading per-order quantities. **Complexity:** Large.
- **Where / problem:** The allocation panel queried requirement rows by alloy `ILIKE`, diameter and positive stored shortage only. It omitted temper, terminal order stages and dispatched-profile production eligibility, did not page the query, and used repeated order IDs as select keys.
- **Reproduction:** Six actual-browser/captured-query/SQL cases fail against the R23 lookup. They reproduce a T4 billet offered T5/T6 requirements rejected by the real writer, whitespace-normalized material accepted by the writer but hidden by the lookup, delivered/payment-pending or fully covered dispatched orders offered as open, duplicate matching-profile choices, and a later compatible order hidden by a simulated REST row cap.
- **Prepared resolution:** `20261020070000_manual_billet_allocation_options.sql` adds one stable read-only, company-derived, five-role-gated RPC. It normalizes alloy and temper like R22, uses exact diameter, excludes the writer's terminal stages, and shares R22's existing dispatched-profile eligibility helper. Distinct orders aggregate only their matching eligible requirements. Literal search, exact counts, stable ten-row pages and last-page clamping run inside the database; stale counters or legacy allocation links require review without read-time repairs. The UI validates header/option identity, quantities and complete page metadata, keeps search/page responses current, and explains unavailable schema rather than falling back to capped reads. Existing R23 retry/save controls remain.
- **Verification:** The focused group passes 105 checks before the final three malformed-header cases were added. The expanded set adds 78 checks: 38 SQL (including the enclosing case), 24 parser and 16 browser cases. It includes 1,003 genuinely created direct orders over 101 stable pages, an actual read-only transaction, all five allowed roles, denied roles, missing/inactive/foreign identities, literal search and no-write snapshots. Integrated catalog checks preserve existing masks and private helper denial. Styled R24 and R23 QA each pass 16 cases at 1440/820/390/320 pixels, with no page errors or document overflow and representative screenshots inspected.
- **Historical handoff status:** OPEN; LOCAL CANDIDATE VERIFIED, NOT APPLIED. The original handoff's plain `npm test` passed **1,673 tests / 76 suites**, with the 154-page build and responsive checks. That earlier source-only handoff is preserved in the evidence below.
- **Current status, later 20 October:** OPEN FOR COMPLETE WORKFLOW ACCEPTANCE; DATABASE READER APPLIED AND VERIFIED. Hosted ledger `20261020085531` / `manual_billet_allocation_options` was already present when this continuation began. Its exact body matches the source and its authenticated-only grant is correct. All 48 existing company billets return valid ten-row-bounded, company-scoped pages under an authenticated SQL role; anonymous and missing-identity calls reject. The consolidated final suite passes **1,725 tests / 76 suites**, with no failures/skips/cancellations. No repeated application of R24 was necessary. Real sign-in, independent sessions, physical material and complete operator acceptance remain open.
- **Acceptance boundary:** This pairs an application change with a new read RPC. Reconcile/rehearse its prerequisites and activate compatible schema and application together when authorized. A missing endpoint deliberately shows unavailable. Real JWT/RLS, independent sessions, historical/physical inventory and measured billet-mass adequacy are not certified by these lookup checks. A00 and R22 remain open.
- **Evidence:** `docs/BUGS_MEGA_R24_ALLOCATION_OPTIONS_2026-10-20.md`; the three new `billet-allocation-options*.test.mjs` files; `scripts/lib/billet-allocation-options-fixture.mjs`; `scripts/qa-billet-allocation-options.mjs`; portable logs/screenshots under `docs/evidence/BUGS_MEGA_2026-10-20/`. Source consolidation is complete; `docs/BUGS_MEGA_HANDOFF_2026-10-20.md` preserves the earlier handoff, and the later R25/checkpoint reports establish the current hosted verification.

### R25 - Automatic billet allocation disagrees with normalized material and per-profile eligibility

- **Severity:** P2, assessed in this continuation. **Importance:** Compatible billets can remain unavailable automatically, while a dispatched order can receive material for a completed profile because another profile still needs production. **Complexity:** Medium.
- **Where / problem:** The deployed `public.allocate_billets_by_priority` body in `20261008020000_factory_workflow_integrity.sql` compared alloy/temper without trimming. Its dispatched-order filter used order-wide remaining work instead of R22's exact per-profile eligibility. The queue also lacked a fresh stage/requirement eligibility check after obtaining its order lock.
- **Reproduction:** The retained baseline fails four of five scenarios, plus its enclosing test: three whitespace/case material cases leave compatible stock unallocated, and remaining T6 production causes a T5 billet to be allocated to a completed T5 profile. The fully covered-order control passes. The hosted pre-change body matches that baseline implementation.
- **Resolution:** CLI-created `20261020090729_priority_billet_allocation_integrity.sql` shares R22's per-profile helper, normalizes material like the manual writer and lineage guard, rechecks the locked order and current requirement, excludes production-linked free-stock anomalies, and retains the existing priority/date and in-house-source preference with stable tie ordering. Missing business roles explicitly reject. Existing allocations and physical billet fields are not rewritten by the migration.
- **Security:** No table, index, new public endpoint, RLS policy or general write grant is introduced. The existing function remains security-definer with a fixed search path and direct execute revoked from PUBLIC, anonymous and authenticated roles. Its existing authorized trigger/workflow callers remain the entry points.
- **Verification:** **44 new SQL checks** pass, including material mismatch, exact profile/active-job eligibility, terminal stages, priority/source/FIFO ordering, repeated and committed retries, role/company/inactive gates, private ACLs and late-write rollback. The five-file focused group passes 165 checks. The final full suite passes **1,725 tests / 76 suites**, with zero failures/skips/cancellations; lint, typecheck and the 154-page production build pass. An existing unmount test now waits for confirmed React unmount before resolving late callbacks; its assertions and timeout remain intact. R24 and R25 both replay against an empty reconstruction of the fresh hosted catalog.
- **Hosted result:** APPLIED as ledger `20261020092500` / `20261020090729_priority_billet_allocation_integrity`. Exact body comparison and narrow ACL checks pass. Actual deployed execution succeeds in a fully rolled-back probe; complete row digests for billets, orders, requirements and notifications are unchanged afterward. The recorded totals remain 10 orders, 48 billets and 13,711.728 kg. All 175 public business tables retain RLS.
- **Status:** CODE FIXED AND MIGRATION APPLIED; full real-login/concurrent-session, historical/physical and operator acceptance remain OPEN under A00. This is an allocation rule repair, not a measured-mass adequacy or physical-inventory attestation.
- **Evidence:** `tests/priority-billet-allocation.test.mjs`; the forward migration; `scripts/test-audit-migration-integration.mjs`; `sql/audit-deployment-preflight.sql`; `docs/BUGS_MEGA_R25_AUTO_ALLOCATION_2026-10-20.md` and its portable verification evidence.

## 15 October Local Investigation Fixes

### R01 - Dispatch preparation truncates reservation consumption history

- **Severity:** P2, assessed in this continuation. **Importance:** Dispatch-ready kg, metres and pieces can be overstated after partial shipments. **Complexity:** Medium.
- **Where / problem:** `lib/actions/dispatches.ts` summed embedded `profile_stock_consumptions` rows. API row caps can truncate that history. A reservation of 2,000 kg / 1,000 m / 2,000 pieces with 1,501 consumed units appeared to have 1,000 kg available instead of 499 kg. A fully consumed hold could reappear as available.
- **Resolution:** Reuse the existing company- and role-checked aggregate reader in both source display and dispatch submission. Require complete validated totals, preserve exact reservation/batch provenance, and stop before a write when the aggregate is unavailable or invalid. No new migration, grant or RLS change was added.
- **Verification:** Six new behavioral checks failed before the fix. Ten action-level tests now pass, including valid/oversize dispatch submission, failed later requests, released/consumed holds, retries, tenant/permission scoping and 100 deterministic property cases. Full suite: 715 passed, zero failures/skips/cancellations; lint, typecheck, build and diff whitespace checks passed.
- **Status:** LOCALLY FIXED after recheck and audit. The existing aggregate RPC must be available in the target schema; if it is absent, availability remains unavailable. The broader cancellation/release, returned-stock, concurrency and hosted acceptance questions remain open.
- **Evidence:** `tests/dispatch-reservation-availability.test.mjs`; `docs/BUGS_MEGA_PROGRESS_2026-10-15.md`.

### R02 - Receipt retries fail after the first request changes the invoice balance

- **Severity:** P2, assessed in this continuation. **Importance:** Accounts can receive a failure after a receipt was already recorded, encouraging a second submission with a new key. **Complexity:** Medium.
- **Where / problem:** `recordPaymentAction` in `lib/actions/payments.ts` rejected a paid invoice or an amount above the current balance before calling the idempotent database function. A successful full or partial receipt could therefore make its own retry fail, including `POST /api/payments` with the original header key. The amount schema also accepted non-finite values.
- **Resolution:** Retain authentication, financial permission, schema validation and a company-scoped invoice lookup. Let the existing locked transaction resolve the idempotency key before enforcing current status/balance for a new receipt. Reject non-finite amounts before database access. No SQL function, migration, grant or RLS policy was changed.
- **Verification:** Paid/partial/API retry and non-finite input edge cases failed before the fix. Nine new tests pass. An isolated test of the actual existing SQL functions verified one receipt and one audit event after a full-payment replay, a partial-payment replay, and rejection of new overpayments, draft-invoice payments, missing references, future dates, key reuse on another invoice and denied business roles. Full suite: 724 passed, zero failures/skips/cancellations; lint, typecheck, build and diff whitespace checks passed.
- **Status:** LOCALLY FIXED after recheck and audit. This fixes retry reachability; it does not close the broader duplicate-adjustment/credit reconciliation or hosted/concurrent-session acceptance questions.
- **Evidence:** `tests/payment-retry.test.mjs`; `docs/BUGS_MEGA_PROGRESS_2026-10-15.md`.

### R03 - A reversed credit note blocks issuing its corrected replacement

- **Severity:** P2, assessed in this continuation. **Importance:** Accounts cannot complete correction of an erroneous return credit through the offered workflow. **Complexity:** Medium.
- **Where / problem:** `components/modules/dispatch-credit-note-client.tsx` offered issuance only when no credit-note record existed, hiding it after reversal. Its single mounted idempotency key would also replay the previous reversed note if reissuance were enabled without changing key scope.
- **Resolution:** Offer corrected issuance after reversal for an eligible returned/damaged dispatch and issued invoice. Keep historical note/reversal evidence. Reuse the key for retries of one attempt, but allocate a fresh key for a different dispatch or reversed predecessor. Handle thrown transport errors without losing the retry key. Draft/cancelled invoices and active/unknown credit statuses cannot offer issuance. Eligibility/key handling lives in `lib/workflow/credit-notes.ts`.
- **Verification:** Six initial component tests failed before the fix. Eight new checks now pass, including component render/event tests and an isolated actual SQL-function issue/reverse/reissue sequence. Retries left two historical notes, one active note, three audit events and the original one cash receipt; paid cash and refund due remained 20 in the synthetic 100-total invoice. Duplicate active issue and denied-role calls were rejected. Full suite: 732 passed, zero failures/skips/cancellations; lint, typecheck, build and whitespace checks passed.
- **Status:** LOCALLY FIXED after recheck and audit. No migration, SQL function, grant or RLS policy changed. Authenticated browser use, independent sessions and physical-return/standalone-adjustment reconciliation remain open.
- **Evidence:** `tests/credit-note-reissue.test.mjs`; `docs/BUGS_MEGA_PROGRESS_2026-10-15.md`.

## 19 October Local Investigation Fixes

### R12 - A selected source control does not reopen when its input is still focused

- **Severity:** P3, assessed in this continuation. **Importance:** Reopening a source list required typing or an extra blur/refocus step after a selection. **Complexity:** Medium.
- **Where / problem:** `components/ui/searchable-select.tsx` opened only on focus and text changes. Choosing an option closed the list while the input retained focus, so a subsequent click did not reopen it.
- **Reproduction:** The original actual-invoice-form diagnostic confirmed that a click on the still-focused selected source input left its options closed. The focused actual-component suite then failed eight of twelve pre-fix cases.
- **Resolution:** A click or ArrowDown can reopen the list without firing search/change callbacks or replacing the current filter. Internal focus movement no longer triggers delayed closure; outside blur, refocus cancellation and timer cleanup are preserved. Pending options cannot be chosen, Enter in an open empty/pending list cannot submit the parent form, and composition Enter does not choose an option. Component props and styles stay unchanged.
- **Verification:** Thirteen new actual-DOM Chromium checks pass for mouse, touch, keyboard, clear, pending/empty results, composition, disabled controls and timer/focus behavior. Consumer source audit covers eleven import sites. Actual direct-priced-order and retained-invoice form/action/SQL fixtures pass at 1440, 820, 390 and 320 pixels, including focused reopening, duplicate/lost-response protection and unavailable reads. Representative screenshots were inspected; page-error lists are empty. Full suite: 932 passed, 76 suites, zero failures/skips/cancellations. Lint, typecheck, build (153 pages) and whitespace checks pass.
- **Status:** LOCALLY FIXED after recheck and audit. No database migration, RLS/grant, business writer, stock update, dependency or hosted write was added. The already-present Playwright package's Chromium runtime is required for the new browser regressions and is documented in `README.md`. Hosted operator acceptance/deployment remain separate. The separately reproduced R13 parent-form race is addressed below.
- **Evidence:** `tests/searchable-select.test.mjs`; `scripts/lib/searchable-select-browser-fixture.mjs`; `scripts/qa-retained-dispatch-invoices.mjs`; `scripts/qa-direct-orders.mjs`; `docs/BUGS_MEGA_PROGRESS_2026-10-19.md`.

### R13 - An older dispatch-source response overwrites the newly selected order's sources

- **Severity:** P2, assessed in this continuation. **Importance:** Dispatch staff can lose the current bundle selection and see material belonging to an earlier order. **Complexity:** Medium.
- **Where / problem:** `components/modules/dispatch-form-client.tsx` committed obsolete source responses, reset current bundles and cleared loading without request ownership. Order search and rejected transport had similar stale-state/error gaps.
- **Reproduction:** Select A then B in the actual form, resolve B and choose its source, then resolve the older A request. The order remained B while A's options replaced B's material and cleared its selection. The original no-save diagnostic and screenshot are preserved. The focused baseline failed 21 of 22 checks before repair.
- **Resolution:** Bind order/source results, loading, errors and submission to the current request/order/company. Clear obsolete material when search or selection changes, preserve measurements on same-order reselection, offer explicit retry/refresh, validate complete source payloads and measured manifests, and ignore unmounted completions. Suppress duplicate submission; require exact success confirmation and lock uncertain outcomes behind existing-record review. Reuse the existing packing validator; the server still reloads authoritative sources before assembling the atomic RPC.
- **Verification:** Thirty-one actual-DOM browser cases and one new actual-action cross-order guard pass; the combined focused suite has 42 passing tests. Full suite: 964 passed, 76 suites, zero failures/skips/cancellations. Lint, typecheck, build (153 pages) and whitespace checks pass. Six browser screenshots at 1440, 820, 390 and 320 pixels cover the race, retry and uncertain confirmation; representative images were inspected and page-error lists are empty. Actual UI payloads passed through the actual save action assemble the exact B manifest (5 kg / 2.5 m / 1 piece); cross-order, reduced-availability and denied-role cases stop before the captured writer.
- **Status:** LOCALLY FIXED after recheck and audit. No SQL, RPC contract, RLS/grant, migration or dependency change was required. The browser/action adapter captures the stock-writing RPC without executing it: it proves neither a persisted dispatch nor a physical-stock outcome. No durable dispatch-creation idempotency or hosted acceptance is claimed. The separately reproduced R14 is addressed below.
- **Evidence:** `tests/dispatch-form-consistency.test.mjs`; `tests/dispatch-reservation-availability.test.mjs`; `lib/dispatches/preparation.ts`; `scripts/audit-dispatch-source-switch.mjs`; `docs/BUGS_MEGA_PROGRESS_2026-10-19.md`.

### R14 - Capped packing history overstates dealer-stock and production availability

- **Severity:** P2, assessed in this continuation. **Importance:** Dispatch staff can see more remaining material than complete packing history supports. **Complexity:** Large.
- **Where / problem:** `loadDispatchSourceLines` in `lib/actions/dispatches.ts` summed unpaginated packing history and a capped dispatch-ID list for dealer-stock and production availability. R01's reservation-consumption aggregate did not cover these two source families.
- **Reproduction:** For both families, 1,501 packing rows with a 1,000-row API cap made 2,000 kg / 1,000 m / 2,000 pieces appear to have 1,000 kg / 500 m / 1,000 pieces remaining instead of 499 kg / 249.5 m / 499 pieces. Twenty-six of 31 initial action checks failed before repair; the failing diagnostic JSON is preserved.
- **Resolution:** Read the complete packing history through the existing inner dispatch relationship with company/order filters, exact counts and stable ID-sorted pages; advance by actual row counts for smaller API caps. Reject incomplete/changing counts, invalid quantities/identity and failed pages. Sum exact-source kg, metres and whole pieces using integer thousandths and reuse the result for display and fresh save validation. Preserve edit exclusion, reservation aggregates and existing production/QC/finishing/packaging eligibility.
- **Verification:** Forty new actual-action/transport tests pass, including 40 deterministic generated decimal/page cases; the focused packing/reservation suite has 51 passing tests. The full bounded-concurrency suite passes 1,004 tests / 76 suites with zero failures/skips/cancellations. The initial unbounded run had a native test-process exit; that file's 21 cases pass alone and in the complete rerun. Lint, final typecheck, build (153 pages) and whitespace checks pass. Both source families pass actual-form/read/save browser checks at 1440, 820, 390 and 320 pixels, including later-page error/retry, a fresh 498-kg rejection of a stale 499-kg manifest and refresh; eleven screenshots, zero page errors, representative images inspected.
- **Status:** LOCALLY FIXED after recheck and audit. No SQL, migration, new RPC, RLS/grant or dependency change. Atomic save calls are assembled/captured without executing a database stock writer; persisted dispatch/stock outcomes, hosted relationship/RLS acceptance and independent-session concurrency remain separate. Unknown legacy history and orders above 100,000 packing rows fail closed instead of silently truncating.
- **Evidence:** `lib/dispatches/packing-history.ts`; `tests/dispatch-packing-availability.test.mjs`; `scripts/audit-dispatch-packing-cap.mjs`; `scripts/qa-dispatch-packing-history.mjs`; `docs/BUGS_MEGA_PROGRESS_2026-10-19.md`.

### R15 - Die readiness and selection disagree with the scheduling contract

- **Severity:** P2, assessed in this continuation. **Importance:** Operators could see an unusable die as ready or have an automatic handoff select a die that scheduling rejects. **Complexity:** Large.
- **Where / problem:** Queue, generic production lookup/autofill, configurator handoff and a dormant PCDA gate used looser exclusions than the active/approved scheduling contract. The older production form omitted approved dies. The dormant gate also promised unsupported warning/owner-override behavior; graph/source review found no product callers of that helper.
- **Reproduction:** The actual queue and actual scheduling/configurator actions disagreed in 11 of 19 status cases. The pre-fix action/rendering suite failed 22 of 28 checks. Browser cases separately exposed unusable assignments, loose/capped choices and missing approved options; another failing regression established the exact-profile preview cap. Original diagnostic/baseline evidence is preserved.
- **Resolution:** Share the existing active/approved rule and exact-profile predicate in `lib/workflow/production-dies.ts`. Align queue, production creation/scheduling, both forms, generic searches, configurator handoff and the compatibility gate. Filter eligibility before the lookup limit and refresh choices for the autofilled profile. An unusable explicit assignment requires review rather than silent replacement. Read-only order fields retain historical die identity with an unavailable-for-production label. Keep current role/company/press/source/billet checks and SQL revalidation.
- **Verification:** Fifty-five new tests pass: 28 actual-action/rendering cases, ten Chromium/DOM cases and 17 existing SQL release/start guard cases in disposable PGlite. The focused group has 95 passing checks. After the final history-display audit, the complete bounded-concurrency suite passes 1,059 tests / 76 suites, zero failures/skips/cancellations; the prior literal `npm test` run passed 1,058 before that last regression. Final lint, typecheck, build (153 pages), source audit and whitespace checks pass. Browser QA covers queue and both forms at 1440, 820, 390 and 320 pixels, stale-status rejection, crowded-profile choices and historical display; sixteen screenshots, zero page errors, representative images inspected.
- **Status:** LOCALLY FIXED after recheck and audit. No SQL, migration, RPC contract, RLS/grant or dependency change. Actual UI payloads reach the actual production-save action with fresh synthetic reads; captured atomic arguments preserve exact identities, while a die changed to maintenance rejects before any RPC. No database production writer, persisted job/schedule, full operator journey, hosted JWT/RLS or independent-session outcome is claimed.
- **Evidence:** `tests/die-readiness-contract.test.mjs`; `tests/die-readiness-browser.test.mjs`; `tests/die-readiness-sql.test.mjs`; `scripts/audit-die-readiness-contract.mjs`; `scripts/qa-die-readiness-contract.mjs`; `docs/BUGS_MEGA_PROGRESS_2026-10-19.md`.

### R16 - Production report uses stale snapshots instead of recorded input, output and scrap

- **Severity:** P2, assessed in this continuation. **Importance:** A production report can contradict the completed run and omit available recovery evidence. **Complexity:** Large.
- **Where / problem:** `buildProductionBatchReportModel` in `lib/reports/pcda/builder.ts` used earlier PCDA input/output snapshots and absent scrap/percentage fields without reading recorded billet/scrap evidence. The readiness gate accepted that job.
- **Reproduction:** The actual public completion transaction records 100 kg input, 95 kg good output and 5 kg scrap. With earlier PCDA values of 80/70 kg, the actual authorized projection/readiness gate/report builder produced a ready report showing 80 kg input and 70 kg output, while scrap/recovery/scrap percentage said `Not Captured`. The original diagnostic is preserved.
- **Resolution:** Read actual output and the complete company/job-scoped billet and scrap ledgers using exact counts and stable pages; validate identities, quantities and precision; reject failed/incomplete/changing reads; and recheck the job after assembly. Preserve unknown input/output rather than estimating it from source snapshots. Calculate final recovery only for completed, captured jobs; distinguish zero recorded scrap from unknown legacy evidence; expose recorded balance differences/tolerance and retain planning reports. Label the existing rejected-weight field as a source snapshot without claiming new QC reconciliation.
- **Verification:** Sixty-seven new tests pass: 59 model/reader/action tests and eight actual-SQL report tests, including enclosing cases. They cover 1,201 rows per ledger, smaller API caps, later-page failures, malformed/foreign/duplicate evidence, revision changes, zero/legacy/in-progress data, denied roles, exact decimal arithmetic and 32 generated histories. Five actual-action PDFs were generated from persisted fixtures, rendered and inspected; 35 extracted fields match their models and every text character is within page bounds. Final `npm test -- --test-concurrency=2`: 1,139 passed / 76 suites, zero failures/skips/cancellations. Lint, build (153 pages), final standalone typecheck, source audit and whitespace checks pass. Early typecheck attempts hit malformed generated development route types; normal build generation and the final standard check pass without a configuration edit or dev-server restart.
- **Status:** LOCALLY FIXED after recheck and audit. No production writer, SQL/migration, RLS/grant, dependency, hosted data or deployment changed. Session/REST/Storage transport is synthetic and uploads/history are captured. Real JWT/RLS/Storage, independent-session snapshots, physical inventory and the broader QC/report/operator investigation remain separate. Histories above 100,000 rows per ledger fail explicitly instead of truncating.
- **Evidence:** `lib/reports/pcda/production-evidence.ts`; `tests/production-report-reconciliation.test.mjs`; `tests/production-report-sql.test.mjs`; `scripts/audit-production-report-reconciliation.mjs`; original `production-report-diagnostic.json` and current `production-report-regression.json` in the evidence directory; `docs/BUGS_MEGA_PROGRESS_2026-10-19.md`.

## 20 October Local Investigation Follow-Up

### R23 - Manual billet allocation disappears after saving and retains obsolete readiness

- **Severity:** P2, assessed in this continuation. **Importance:** An operator loses the allocation panel after a successful save, cannot recover unavailable options, or can submit a new billet using an old billet's selected order. **Complexity:** Medium.
- **Where / problem:** `components/modules/foundry/billet-allocation-client.tsx`. `load()` set loading true, but only the initial effect cleared it; a successful save's refresh left the panel permanently hidden. Load failures were toast-only or appeared empty, requests had no record/company ownership, selection survived prop changes, rejected actions left saving stuck, and same-event duplicate clicks sent two requests.
- **Reproduction:** The initial actual-Chromium baseline failed 20 of 21 checks. It reproduces the hidden post-save panel, duplicate requests, stale billet/requirement responses, lost confirmations and unavailable-versus-empty errors. The retained non-allocatable-status control passes.
- **Resolution:** A billet/company/user/role-scoped panel owns each read and save. Explicit loading/unavailable states provide retry; obsolete and unmounted completions are ignored; refresh and scope changes discard the selected order; synchronous save ownership suppresses duplicate calls and disables pending controls. Unconfirmed or failed writes require a fresh billet read before another attempt. Only a valid requirement identity confirms success, which remains visible if the subsequent read fails. The refreshed billet retains its identity and links to its recorded order even with no remaining options. Read responses are checked for billet/company identity and valid requirement/order identities.
- **Verification:** Thirty new browser/action/SQL checks cover lifecycle, errors, selection and scope races, duplicate clicks, invalid payloads, current-order links, actual allocation/reallocation and a committed allocation with a lost confirmation. Actual action/public SQL fixture checks preserve the billet's recorded physical fields, update both orders' requirement counters and perform no extra allocation on refresh. Responsive QA passes 16 cases at 1440, 820, 390 and 320 pixels with built CSS/fonts, inspected representative screenshots, zero page errors and no document overflow. Final full suite: **1,595 passed / 76 suites**, zero failures/skips/cancellations, including the final invalid-identity case and tightened physical-field assertions. Final lint, standalone typecheck, standard build (154 pages), source audit and tracked/new-file whitespace checks pass.
- **Status:** LOCALLY FIXED after recheck, edge testing and audit. A00 and R22's real JWT, independent-session, historical-data and complete signed-in operator acceptance remain open. No SQL writer, migration, RLS/grant, dependency declaration, hosted data or deployment changes are included.
- **Evidence:** `tests/billet-allocation-panel.test.mjs`; `scripts/lib/billet-allocation-browser-fixture.mjs`; `scripts/qa-billet-allocation-panel.mjs`; `docs/BUGS_MEGA_PROGRESS_2026-10-20.md`; logs and screenshots under `test-results/billet-allocation-panel/` in the separate worktree.

## Finance And Expenses Findings Reconciled On 20 October

This section brings all **57 source finding IDs** from `docs/FINANCE_EXPENSES_DEEP_AUDIT_2026-10-15.md` and `docs/FINANCE_EXPENSES_REMEDIATION_2026-10-20.md` into the central register. Their original severity, conditional evidence and source references remain in the audit. These are source IDs, not 57 additional independent root causes: AR-01 overlaps R06, AR-07 overlaps R07, and AR-11 overlaps R11. AR-05 is a documented business-rule resolution and AR-11 was already implemented.

The original finance report's no-hosted-write/unapplied wording describes its earlier checkpoint. All three finance migrations were subsequently reviewed, rehearsed and applied on 20 October: `20261020010000_expense_ledger_integrity.sql`, `20261020020000_receivables_integrity.sql` and `20261020030000_finance_reporting_integrity.sql`. Their catalog/body/grant and rolled-back finance runtime checks are recorded above. `DB applied` below means the corresponding database behavior is activated; it does not close independent-session, real-login, historical accounting or operator acceptance. `Local fix` means application/report changes passed the recorded local checks and still require the applicable signed-in/deployed acceptance.

| Source ID | Completed behavior | Current status / remaining boundary |
| --- | --- | --- |
| AR-01 | Prevent a standalone adjustment and return credit settling the same invoice; expose historical overlaps in `invoice_settlement_review`. | DB applied through R06; historical/accounting acceptance open. |
| AR-02 | Post an auditable signed customer refund linked to invoice/credit note; cap it at credit due and block receipt reversals that would leave excess refunds. Invoice and return-credit panels expose the action. | DB applied and local UI implemented; real refund/operator acceptance open. |
| AR-03 | Compare receipt retry amount/date/method/reference/notes; issue a new UI key after payload edits. | DB applied and local UI fixed; independent-session acceptance open. |
| AR-04 | Keep an overdue open balance overdue after a partial receipt; compute current overdue state in `invoices_authorized`. | DB applied; real-date/filter acceptance open. |
| AR-05 | Document whole-dispatch returned/damaged credit notes; partial shortage/damage on a delivered dispatch uses a standalone adjustment. | Policy documented in both screens; operator acceptance open. |
| AR-06 | Show portfolio customer-credit-due KPI, risk/follow-up details and refund navigation. | DB applied and local analytics fixed; signed-in acceptance open. |
| AR-07 | Bind return-credit retries to dispatch/reason and retain corrected-issuance behavior. | DB applied through R07; concurrent acceptance open. |
| AR-08 | Search open invoices on the server in batches of 25 and resolve a deep-linked invoice by identity. | Local fix; signed-in receipt selection acceptance open. |
| AR-09 | Serialize duplicate active-dispatch-invoice checks on the writer's advisory key; guard create, reassignment and reactivation. Build the unique index only when legacy rows permit it. | DB applied; concurrent and legacy-duplicate acceptance open. |
| AR-10 | Derive receipt/refund business date in Asia/Kolkata, with the same default/cap in the form. | DB applied and local form fixed; timezone/operator acceptance open. |
| AR-11 | Use the existing bounded invoice-source search instead of a truncated order list. | Already implemented by R11; DB applied; operator acceptance open. |
| EXP-01 | Derive totals from components and source rates; reject inconsistent manual totals or base versus quantity/rate. | DB applied; historical mismatches remain review items. |
| EXP-02 | Re-evaluate submitted approval state against the INR 25,000 threshold and role; require the approval workflow for state changes. | DB applied; role/operator acceptance open. |
| EXP-03 | Require an approved, active, undeleted expense before supplier payment. | DB applied; operator acceptance open. |
| EXP-04 | Lock the expense before checking and capping supplier payment at its outstanding balance. | DB applied; separate-session overpayment race remains untested. |
| EXP-05 | Keep posted payments immutable; recompute old/new parent projections in stable identity order. | DB applied; signed-in reversal/accounting acceptance open. |
| EXP-06 | Enforce company-composite expense/payment parent references and company-derived RPC resolution. | DB applied; real-token cross-company acceptance open. |
| EXP-07 | Remove direct authenticated expense DML and broad insert/update policies; use authorized definer RPCs and source triggers. | DB applied and ACL checked; complete role matrix open. |
| EXP-08 | Bind expense/payment retry keys to payload hashes; reject repeated references and duplicate vendor bills by vendor/number/Indian FY/total. | DB applied; concurrent and legitimate legacy-bill acceptance open. |
| EXP-09 | Preserve posted payment/credit evidence; use reversals and full before/after audit data; redirect payment editing to reversal. | DB applied and local UI fixed; audit/operator acceptance open. |
| EXP-10 | Make the central settlement ledger authoritative and show source payment state as its read-only projection. | DB applied and local forms fixed; source/accounting reconciliation open. |
| EXP-11 | Reject source deletion/zeroing while posted cash remains unreversed or unrefunded. | DB applied; historical/accounting acceptance open. |
| EXP-12 | Add linked supplier credit notes/refunds and supplier-credit-due projection with expense-detail UI. | DB applied and local UI implemented; real settlement acceptance open. |
| EXP-13 | Derive paid amount, refunds, credits and paid date from their immutable ledgers. | DB applied; historical ledger reconciliation open. |
| EXP-14 | Lock approved expenses; owner/admin reopening requires a reason and no retained settlements. | DB applied and local approval flow fixed; operator acceptance open. |
| EXP-15 | Retire a zero-cost energy payable; reactivate a later positive amount for renewed approval. | DB applied; source-lifecycle acceptance open. |
| EXP-16 | Compute overdue state at read time in `expense_ledger_authorized`. | DB applied; date/filter acceptance open. |
| EXP-17 | Use the latest posted payment date and clear it when the balance reopens. | DB applied; settlement acceptance open. |
| EXP-18 | Remove `paid` as an approval option/lane; relabel legacy approval values with audit rows. | DB applied and local UI fixed; historical approval review open. |
| EXP-19 | Prevent foundry source-sync re-entry and replace broken dispatcher triggers. | DB applied; full foundry/source/operator acceptance open. |
| EXP-20 | Retire cancelled outsourced-batch payables; record any cancellation fee separately. | DB applied; accounting/operator acceptance open. |
| EXP-21 | Retain maintenance free-text supplier and bill number/date in the central expense. | DB applied; source-document reconciliation open. |
| EXP-22 | Revalue on-hand receipt units after a rate edit through a zero-quantity adjustment movement. | DB applied; physical/valuation reconciliation open. |
| EXP-23 | Require INR for new expenses; book INR analytics separately and retain per-currency export totals. | DB applied and local reporting fixed; historical-currency acceptance open. |
| EXP-24 | Move stock from the former SKU to the new one when SKU-defining source fields change. | DB applied; physical/source/operator acceptance open. |
| EXP-25 | Retire zero-cost breakdown payables. | DB applied; source-lifecycle acceptance open. |
| SEC-01 | Remove sales-manager invoice-header access and limit customer-level receivable analytics to finance roles. | DB applied; full real-token direct-query acceptance open. |
| SEC-02 | Limit expense, payment and supplier-credit reads to finance roles. | DB applied; full real-token role acceptance open. |
| SEC-03 | Limit collection-event detail to finance roles while retaining permitted aggregate analytics. | DB applied; full real-token role acceptance open. |
| RPT-01 | Book approved, undeleted INR spend; report pending approvals separately as commitments and align the TypeScript mirror. | DB applied and local analytics fixed; accounting acceptance open. |
| RPT-02 | Distinguish gross invoicing, issued credit notes and net billing. | DB applied and local reporting fixed; accounting acceptance open. |
| RPT-03 | Default payment exports to posted receipts, with status/type and signed/collection amounts. | Local fix; real export/accounting acceptance open. |
| RPT-04 | Exclude deleted expenses from exports and retain currency with separate totals. | Local fix; real export/accounting acceptance open. |
| RPT-05 | Aggregate profitability over the complete server-side population. | DB applied; real-data/accounting acceptance open. |
| RPT-06 | Show receipts, adjustments, refunds and credit notes reconciling to the invoice balance. | Local fix; complete signed-in settlement journey open. |
| RPT-07 | Format currency cells with paise and the record's currency code. | Local fix; operator/export acceptance open. |
| RPT-08 | Count incomplete cost records and exclude them from calculated cost/margin. | DB applied; historical cost reconciliation open. |
| RPT-09 | Compute days-to-settle from paid invoices' settling receipts; label open-invoice outstanding age separately. | DB applied; real-data/accounting acceptance open. |
| RPT-10 | Label PCDA profitability approval as not applicable and retain payment status in its own field. | Local fix; report/operator acceptance open. |
| PDF-01 | Add shaped Unicode text, Indian-script subsets, rupee and Latin-extended support; later PDF follow-up adds the correct Latin/Latin-Ext and symbols faces. | Local fix; later handover reports mixed-script/symbol visual QA passed; deployed-font acceptance open. |
| PDF-02 | Repeat invoice identity on continuation pages and number every page. | Local fix; final layout/operator acceptance open. |
| PDF-03 | Print invoice due date, receipts, credits and balance; wrap long tokens at grapheme boundaries. | Local fix; later handover reports final invoice/mixed-script QA passed. Full supplier-contact snapshots remain an unapplied follow-up. |
| PDF-04 | Export all report columns in bands, readable wrapped cells, rules and per-group/grand currency totals; include credit notes as a source. | DB source applied and local PDF fixed; real-data/operator acceptance open. |
| PDF-05 | Provide credit-note, expense and supplier-payment PDF API routes. | Local fix; authenticated route/deployed-font acceptance open. |
| PDF-06 | Preserve non-Latin quotation text. | Local fix; later handover reports Unicode-heavy fixture QA passed; deployed document acceptance open. |
| PDF-07 | Wrap PCDA values, repeat identity and number pages. | Local fix; representative consolidation and later short/long PCDA fixtures pass as recorded. Later handover verifies server-action font traces; deployed acceptance open. |
| UX-01 | Expose Create Invoice from overview and database to the dedicated form. | Local fix; authenticated navigation acceptance open. |

Finance verification included 18 expense, seven receivables and five reporting checks in the initial 1,553-test full checkpoint, plus existing credit/idempotency/export/PDF regressions. The complete 1,725-test R25 checkpoint covers its consolidated source before the newest PDF follow-up; the newer handover reports its checks separately. The first finance report only established PDF structure; the later PDF handover and consolidation add the specific visual evidence below. Concurrency locks have not been proved with separate sessions. `expense_ledger_reconciliation_issues` and `invoice_settlement_review` remain required historical review surfaces; mismatched historic totals are not silently restated and legacy invoice snapshots are not invented.

## PDF And Report Overhaul Preserved On 20 October

The original `pdf fix.MD` handover records twelve source observations and a shared-engine rewrite authored in commit `d52155b`. Consolidation preserved that implementation. Its stopped/unverified status is historical: later full tests, lint, typecheck, build and the explicitly listed consolidation visual smoke checks passed. A still later, uncommitted follow-up is now recorded in section 8 of that handover and reconciled below; the original pending list is not its current status.

| Source observation | Completed change / preserved behavior |
| --- | --- |
| 1. Independent inconsistent renderers | Added `lib/pdf/document-kit.ts` and shared formatting in `lib/pdf/format.ts`; adopted the writer across existing PDFs. |
| 2. Non-Latin text stripped | Preserved shaped Unicode and embedded font subsets in configurator, die and profile sheets as well as financial documents. |
| 3. Table/value overflow | Added wrapped cells, continuation handling, repeated headers, suitable field grids and complete column bands. |
| 4. Missing continuation footer/page numbers | Added document identity and Page x of y footers on every page. |
| 5. Production lists truncated | Print complete cutting, glass and hardware lists with production output checks, replacing the earlier top-12/top-8 cutoffs. |
| 6. Die history fetched but omitted | Print trials, corrections and nitriding history tables, retaining unknown values as not captured. |
| 7. Quotation terms truncated / placeholder bank text | Print all terms, customer-safe commercial sections and configured bank details; omit the configuration placeholder. |
| 8. Invoice plain text / weak tax layout | Add party/meta panels, item table, totals, amount in words and a conditional HSN tax summary only when it reconciles exactly to stored tax. |
| 9. Voucher dates/status labels unreadable | Apply consistent document formatting, record currency and reversal/void notices to credit, expense and supplier-payment vouchers. |
| 10. PCDA unstructured label/value output | Use report metadata, references, section grids, long-value handling and signatures; preserve existing CSV/Excel behavior. |
| 11. Report Builder embedded layout / missing subtotals / UUID clutter | Move PDF generation to `lib/reports/report-builder-pdf.ts`; add group subtotals, grand/statement totals by currency, readable criteria and cleaned labels. |
| 12. Base-font punctuation measurement/copy defects | Embed the Noto Sans base font and retain the font catalog/loader; the documented fallback does not establish deployed font availability. |

The preserved renderer covers quotation, tax invoice, credit note, expense voucher, supplier-payment voucher, all seven configurator report types, die/profile technical sheets, PCDA PDF templates and Report Builder. Customer-safe documents retain their cost/margin restrictions; internal costing keeps its role gate and confidentiality treatment. Unsupported script/glyph cases outside the bundled coverage remain explicit fallbacks; arbitrary emoji/CJK support is not claimed.

The original author recorded visual checks for invoice, quote, the three voucher families, and configurator customer quote/production/optimization/internal-costing output. Consolidation additionally generated seven synthetic reports over 16 pages: die with/without history, profile, short/long PCDA, grouped multi-band/multi-currency Report Builder and empty Report Builder. Every page passed text-bound checks and representative pages were inspected. Focused PDF/report/merge tests passed 54 checks; all six PDF API build traces included 22 font files. At that consolidation checkpoint all 17 preserved product/handover/font files matched their original Git blobs; the Report Builder source assertion was separately corrected for existing UUID-cleaning behavior. The later follow-up intentionally changes several of those files and font assets.

### Later PDF Follow-Up: Fourteen Quality Repairs

Source: updated `pdf fix.MD` sections 8.1-8.5, inspected alongside the current working diff around 19:00 IST. The author reports 28 realistic fixture documents rendered and inspected page by page, plus about 170 row-count/boundary documents checked for margin overflow, overlapping text, footers, stranded headings and signature-only pages. Coverage includes final invoice variants and mixed scripts, quote/vouchers, all seven configurator documents, technical sheets, PCDA and Report Builder. Invoice/quote/credit/voucher arithmetic was also reconciled in that report. These are attributed fixture/visual results, not a new run by this register update or authenticated UAT.

| Follow-up source item | Local change recorded in the newer handover |
| --- | --- |
| 1. Missing engineering/Latin symbols | Use plain Noto Sans Latin and Latin-Ext plus Noto Sans Math symbols; add `@fontsource/noto-sans` / `@fontsource/noto-sans-math`, update the font catalog/sync script and replace unused subsets. |
| 2. Ambiguous paise/zero-rupee wording | Make `numberToWordsINR` explicitly separate rupees and paise, including zero rupees. |
| 3. Missing linked-group subtotals / raw UUID totals | Compute Report Builder PDF totals from enriched `displayRows`, matching displayed group identities. |
| 4. Incorrect mixed-currency row counts | Add `countByCurrency` and print the relevant currency's count for subtotal, grand-total and statement rows. |
| 5. Truncated footer timestamp | Wrap the footer note onto a second line while retaining the timestamp. |
| 6. Mid-word headers and split dates | Shrink table text before hard breaks, prevent date-column wrapping and rebalance technical/configurator columns. |
| 7. Incorrect acronym/title casing | Preserve NEFT/RTGS/IFSC/DGU and lower-case joining words appropriately in `pdfLabel`. |
| 8. Raw enums and locale-dependent report dates | Format enum-like fields as labels, use deterministic `pdfDate` and shorten the vendor display label. |
| 9. Inconsistent PCDA generated time | Use the same `metadata.generatedAt` in IST for header/footer; omit not-captured references/revision from the header. |
| 10. Incomplete expense/payment supplier address | Select city/state/PIN in voucher routes, deduplicate address components and render absent values consistently. |
| 11. Stranded signatures / headings | Add closing-section space reservation, deferred headings and last-row keep-with-next behavior; fit the configurator elevation within the available closing space. The earlier signature-only fixture issue is locally addressed. |
| 12. Missing server-action font bundles | Add explicit tracing for `/dies/[id]`, `/profiles/[id]`, `/orders/[id]` and `/quotes/[id]`. The handover reports 23 fonts in each relevant page trace, replacing the earlier local tracing gap. |
| 13. Weak PCDA Excel text preservation | Add section/title/header/width formatting, retain long identifiers as text and use Yes/No in Excel and CSV. This optional improvement was subsequently implemented. |
| 14. Duplicate quotation attention line | Omit the attention line when contact and company/name would repeat. |

The newer handover reports passing lint, typecheck, build and full tests, with new `tests/pdf-document-quality.test.mjs` coverage and updated business-logic/Report Builder assertions. Its exact full-suite count is not recorded in that handover. The empty unreferenced `lib/pdf/quote-pdf-new.ts` was deleted by the follow-up and is no longer a pending cleanup item. The register update preserves these concurrent edits rather than rewriting or reverting them.

### Unapplied Invoice Supplier-Contact Snapshot Candidate

`supabase/migrations/20261020120000_invoice_supplier_snapshot_contact.sql` adds city, state, PIN, phone and email to the supplier snapshot for **new invoices only**. It preserves company-scoped customer lookup, party/snapshot immutability and the private trigger-only execute revocations. Existing issued snapshots are not backfilled or changed. `tests/invoice-supplier-snapshot-contact.test.mjs` has seven reported passing PGlite checks. The candidate changes the private trigger function, not a public RPC or table definition.

**Current status, 22 October: APPLIED AND VERIFIED** (ledger `20261020201639`; hosted body hash equals the file; owner-only execute). The generator note in `scripts/build-astra-migration.mjs` records that this migration supersedes the frozen `sql/astra-integrity.sql` copy. Historical status at the PDF handover: **LOCAL CANDIDATE; NOT APPLIED**, as explicitly recorded in the later PDF handover. It is outside the 42 applied/verified ledger entries listed above and outside the earlier 29-file final-body comparison. Review/replay, hosted activation/body/ACL verification and a new-invoice/credit-note acceptance journey remain pending. `sql/astra-integrity.sql` still contains the older reference function copy and needs reconciliation or explicit documentation of which source is authoritative. The current file-only inventory is 183 SQL files / 171 versions; the last verified hosted ledger remains the saved 86-entry result until another hosted check is recorded.

Remaining PDF acceptance is authenticated/deployed document delivery, customer-safe data boundaries, actual invoice/source-document accuracy and production packaging. The latest handover reports the previously pending cutting/glass/hardware, final invoice/mixed-script, stranded-signature and local server-action-font checks completed. Report Builder CSV intentionally retains UUID suffixes. Additional receipt/challan/purchase-order/NCR PDF types remain outside the implemented scope.

## Git Consolidation And Saved Continuation

On 20 October all useful histories were consolidated into the existing `codex/v1` development checkout and `main` root checkout. The preserved histories include the latest PDF commit `d52155b`, local main/codebase-index work, existing remote main history, twelve older SQL migrations, route/build compatibility work and the saved billet-allocation continuation. Seven original branch tips were verified ancestors; both retained tips reached `61a1530`. No additional working branch/worktree is required.

Reconciliation retained the current atomic invitation, quote approval, order identity, finishing geometry, recovery/margin, PCDA line-total and production source-line safeguards. Older payment-role experiments and an obsolete reservation action did not replace current authorization/atomic dispatch behavior. Stock-readiness/PDF expectations were aligned with current intended behavior, the current production authority was retained after a merged test failure, and zero numeric quotation charges remain compatible with the existing NOT NULL requirements. Final consolidation gates passed 1,681 tests plus lint/typecheck/154-page build; the later R25 checkpoint supersedes that test total.

Recoverable Git bundles, patches, copied working files and SHA-256 manifests were preserved in the dated consolidation backup described in `docs/GIT_CONSOLIDATION_2026-10-20.md`. The root's original generated changes were preserved in the named stash `consolidation-2026-10-20-original-local-generated-files`; refreshed codebase-index/type files remain local as recorded. Environment files were kept outside Git. No database migration was part of branch consolidation itself, and any external hook's deployment outcome was not certified.

The later R25 continuation remains saved and uncommitted in `.worktrees/codex-v1`: new migration `20261020090729_priority_billet_allocation_integrity.sql` and `tests/priority-billet-allocation.test.mjs`; updated catalog integration, preflight and panel-unmount tests; updated register/reconciliation/R24 notes; new R25 report, checkpoint and portable `docs/evidence/BUGS_MEGA_2026-10-20/R25/` logs/metadata. The still later PDF continuation adds renderer/report/export/route changes, replacement Latin/symbol fonts and dependencies, server-action tracing, the quality/supplier-snapshot tests, the unapplied supplier-contact migration and the section-8 PDF handover. Those concurrent source edits were preserved; their reported completion is recorded in the PDF section above.

Generated `tsconfig.tsbuildinfo` changes and untracked `debug.log` remain preserved. The root has its generated codebase-index/type changes. This central-register update is synchronized to the requested root file; the later R25 and PDF application source/evidence has not yet been committed, pushed or fast-forwarded into root `main`. Finishing the diff/evidence review and promoting verified source through the existing two branches remains pending. The earlier statement that all preserved PDF blobs matched describes consolidation, not the newer modified working copy.

## October Findings With Local Fixes Recorded

The findings in this section were reproduced or source-confirmed in their original audits. The 14 October register records local remediation and per-finding regression evidence. They are therefore **locally addressed**, while hosted/security/concurrency/operator acceptance remains outstanding where applicable.

### A findings

Source: `docs/AUDIT_2026-10-03.md`; status detail: `docs/AUDIT_REMEDIATION_2026-10-14.md`.

#### A01 - Dealer reads can cross dealer ownership within one company

- **Severity:** P1. **Importance:** High; exposes another dealer's customers, quotes, quote lines and orders. **Complexity:** XL.
- **Where / problem:** Effective RLS policies on `customers`, `quotes`, `quote_items`, `orders` and `order_items`; later company-only permissive policies OR with narrower dealer-ownership policies.
- **How to resolve:** Replace the complete effective policy set with explicit internal-role and dealer-ownership rules; derive dealer customer access through owned relationships. Test direct authenticated reads as sibling dealers and across companies, including safe field projections.
- **Status:** Locally fixed and regression-tested; hosted authenticated RLS acceptance remains open.

#### A02 - Read-only and operational roles retain core-table write access

- **Severity:** P1. **Importance:** High; unauthorized edits/deletes can corrupt customer, quote, order and line data. **Complexity:** XL.
- **Where / problem:** Effective insert/update/delete policies for the same core tables, including company-only policies and order-line `FOR ALL` access. The policy layer allowed viewer updates and order-line deletion in the isolated reproduction.
- **How to resolve:** Restrict each write policy by active account, role, tenant and ownership; route sensitive transitions through narrowly authorized transactions. Test negative and permitted writes against the final policy catalog.
- **Status:** Locally fixed and regression-tested; full hosted role/JWT/RLS matrix remains open.

#### A03 - Reservation-capacity guard can block valid dispatch consumption

- **Severity:** P1. **Importance:** High; valid shipments can fail and stock/reservation ledgers can diverge. **Complexity:** XL.
- **Where / problem:** `private.consume_dispatch_reservations` and stock-capacity guards. The reproduced order reduces a batch before marking its reservation consumed, so the trigger still counts the reservation as active and rolls back dispatch.
- **How to resolve:** Consume reservation units and decrement source stock in one locked transaction with consistent lock order; calculate capacity from remaining active reservations. Cover full/partial dispatch, multiple holds, retries, rollback and concurrent sessions.
- **Status:** Locally fixed and regression-tested; independent-session contention remains unverified.

#### A04 - Order database payload exposes commercial values to operational roles

- **Severity:** P1. **Importance:** High; internal order value is confidential commercial data. **Complexity:** Large.
- **Where / problem:** Order columns and payload projection in `components/modules/operations/module-config.ts` and `module-database-client.tsx`; production users could receive `order_value` although the detail page hides it.
- **How to resolve:** Enforce one role-aware projection before serialization across lists, details, APIs, exports and PDFs; use authorized database views/column access where direct table reads are possible.
- **Status:** Locally fixed and regression-tested; hosted direct-query and authenticated UI acceptance remains open.

#### A05 - Configurator reads expose internal costing data

- **Severity:** P1. **Importance:** High; reveals costs, margins, rates and material amounts to roles not authorized to see them. **Complexity:** Large.
- **Where / problem:** Configurator quote page, `system_material_summary`, `system_configurations` policies and costing output. UI-only gating did not protect cost-bearing database rows or material amounts.
- **How to resolve:** Separate operational quantities from cost-bearing fields at database/API boundaries; return approved projections only; apply the same authorization to pages, reports, PDFs, exports and server actions.
- **Status:** Locally fixed and regression-tested; hosted role and customer/dealer exposure checks remain open.

#### A06 - Configuration-to-quote conversion can leave partial or duplicate quotes

- **Severity:** P2. **Importance:** Medium-high; failed or repeated conversion can leave orphaned or duplicate customer quotes. **Complexity:** Large.
- **Where / problem:** `generateSystemQuote` in `lib/systems-configurator/actions.ts` wrote the quote header, lines and configuration link separately without locking the configuration.
- **How to resolve:** Use one authorized idempotent database transaction to lock the configuration, create all lines, allocate the number and set the link. Inject failures at every step and test concurrent retries.
- **Status:** Locally fixed and regression-tested.

#### A07 - Costing profit percentage ignores discounts

- **Severity:** P2. **Importance:** Medium; displayed profit can remain positive when discounting produces a loss. **Complexity:** Medium.
- **Where / problem:** `lib/systems-configurator/costing-engine.ts` calculated profit percentage from margin before discount while selling subtotal deducted the discount.
- **How to resolve:** Calculate realized profit after discounts and name whether the percentage is markup on cost or margin on sales; test break-even, discounts and losses.
- **Status:** Locally fixed and regression-tested.

#### A08 - Accounts costing access differs across route, action and database rules

- **Severity:** P2. **Importance:** Medium; accounts users cannot use an explicitly offered costing/report capability. **Complexity:** Medium.
- **Where / problem:** `lib/auth/permissions.ts`, route permissions, configurator access and PDF handler allowed different accounts capabilities; database read policy also omitted accounts.
- **How to resolve:** Decide the intended accounts read scope, then align route, action, report and database authorization without granting draft-write authority.
- **Status:** Locally fixed and regression-tested.

#### A09 - Stock-reservation capability differs between UI, server action and RLS

- **Severity:** P2. **Importance:** Medium; intended production/inventory roles can see a reserve action that the server or database rejects. **Complexity:** Large.
- **Where / problem:** Configurator BOM reservation button, `reserveSystemBomProfileStock`, and reservation/configurator policies used incompatible role capabilities.
- **How to resolve:** Define a dedicated reservation capability and apply it consistently to the button, server action, RPC and RLS; keep broad configurator editing separate.
- **Status:** Locally fixed and regression-tested.

#### A10 - Customer GST search breaks pagination and relation search truncates matches

- **Severity:** P2. **Importance:** Medium; users can miss customer/profile/order records and receive duplicated or oversized pages. **Complexity:** Large.
- **Where / problem:** `components/modules/operations/module-database-client.tsx` fetched GST matches separately without one shared count/range, while related-entity IDs were capped before searching.
- **How to resolve:** Put all search predicates in one server-side query/RPC with stable sort, exact count and pagination. Test more than one page of GST-only matches and more than 50 related entities.
- **Status:** Locally fixed and regression-tested.

#### A11 - Saved-project list hides older records and query errors

- **Severity:** P2. **Importance:** Medium; users can mistake a failed query for an empty project database and cannot reach records beyond the first 100. **Complexity:** Medium.
- **Where / problem:** `app/(dashboard)/systems-configurator/projects/page.tsx` ignored query errors, applied a 100-row limit and had no search or next page.
- **How to resolve:** Add ten-row server pagination, search/filter/sort, and an explicit unavailable/error state. Verify the 101st record and a failed query.
- **Status:** Locally fixed and regression-tested.

### B findings

Source: `docs/BUSINESS_FLOW_AUDIT_2026-10-04.md`; status detail: `docs/AUDIT_REMEDIATION_2026-10-14.md`.

#### B01 - Partial shipment blocks planning the remaining order quantity

- **Severity:** P1. **Importance:** High; after a partial delivery, the factory can be blocked from producing the undelivered balance. **Complexity:** Large.
- **Where / problem:** `private.sync_order_delivery_stage`, order-stage eligibility and billet-allocation exclusions treated any dispatch as completion.
- **How to resolve:** Track shipment progress separately from remaining fulfillment eligibility; allow authorized production/allocation of the balance without permitting overproduction. Test order 1,000 kg, deliver 200 kg, produce/ship the remaining 800 kg.
- **Status:** Locally fixed and regression-tested.

#### B02 - Reworked material cannot be resolved against its original inspection

- **Severity:** P1. **Importance:** High; corrected material remains blocked or operators may create false production records to bypass the dead end. **Complexity:** Large.
- **Where / problem:** Finishing quality disposition validation and terminal-inspection guard counted original rework plus its new approval against the same source quantity.
- **How to resolve:** Preserve the original inspection and resolve it through a linked atomic transaction that moves quantity from unresolved rework to approved/rejected. Prevent repeated/concurrent release of the same quantity.
- **Status:** Locally fixed and regression-tested.

#### B03 - Authenticated callers cannot execute return credit-note issue/reversal

- **Severity:** P1. **Importance:** High; authorized accounts/owners cannot complete return settlement or reverse an erroneous credit. **Complexity:** Medium.
- **Where / problem:** Public `SECURITY INVOKER` wrappers called private functions whose execute privileges were revoked from authenticated callers.
- **How to resolve:** Use the established secure RPC pattern with company and business-role checks; test allowed/denied roles, other companies and idempotent repeat issue/reversal.
- **Status:** Locally fixed and regression-tested; real authenticated role acceptance remains open.

#### B04 - Multi-profile system quote loses production-line lineage

- **Severity:** P1. **Importance:** High; quoted assemblies can fail factory handoff and misstate per-profile quantities. **Complexity:** Large.
- **Where / problem:** `generateSystemQuote` combined multiple profile cuts into one quote line assigned to the first profile; later conversion could not reconstruct omitted profile lines.
- **How to resolve:** Preserve the assembly commercial total while storing exact profile/order-line lineage, including repeated profiles and explicit allocation of shared costs. Verify conversion, partial fulfillment and invoice total.
- **Status:** Locally fixed and regression-tested. The separate direct-order commercial-line investigation below remains open.

### C findings

Source: `docs/RECONCILIATION_AUDIT_2026-10-04.md`; status detail: `docs/AUDIT_REMEDIATION_2026-10-14.md`.

#### C01 / F03 - Production completion mass balance can be bypassed and completed output can drift

- **Severity:** P1. **Importance:** High; production output, billet input, scrap and downstream packaging/QC can disagree. **Complexity:** XL.
- **Where / problem:** Generic production save/completion paths in `20260715000000_atomic_business_workflows.sql`, `20260718021500_floor_output_and_finishing_workflows.sql` and later guards. C01 changed completed output without updating packaging; F03 completed 500 kg from 100 kg billet through the general save path.
- **How to resolve:** Make completion possible only through a database-enforced mass-balance transaction; freeze completed evidence on ordinary saves. Corrections must be audited and atomically reconcile scrap, finishing, QC, packing and dispatch, and reject changes that invalidate shipped/approved stock.
- **Status:** Locally fixed and regression-tested as one root cause; authenticated grants and full downstream/operator acceptance remain open.

#### C02 - Dispatch leaves batch metres stale

- **Severity:** P1. **Importance:** High; remaining length and future reservations can be overstated. **Complexity:** Large.
- **Where / problem:** Dispatch stock-consumption function reduced kg and pieces but left `profile_stock_batches.length_m` unchanged; later reservations derived length from the stale ratio.
- **How to resolve:** Update kg, pieces and metres atomically from exact stock provenance. Use ratios only where piece geometry is uniform; reconcile historical batches and test mixed lengths, returns, partial/full dispatch and retries.
- **Status:** Locally fixed and regression-tested.

### D findings

Source: `docs/DATA_TRUST_AUDIT_2026-10-04.md`; status detail: `docs/AUDIT_REMEDIATION_2026-10-14.md`.

#### D01 - Pending dispatches count as shipped and on time

- **Severity:** P1. **Importance:** High; shipment and delivery metrics can report movement that has not happened. **Complexity:** Medium.
- **Where / problem:** Analytics dispatch aggregation used header weight/date without filtering delivery status or an actual movement event.
- **How to resolve:** Use authoritative shipment status and actual event time; distinguish prepared, shipped, delivered and returned quantities and reconcile against the stock-consumption ledger.
- **Status:** Locally fixed and regression-tested.

#### D02 - Month-to-date metrics include events after the as-of date

- **Severity:** P2. **Importance:** Medium; historical and current MTD reports overstate activity. **Complexity:** Medium.
- **Where / problem:** Analytics month aggregation used the next-month boundary rather than the requested as-of cutoff; dashboard queries also lacked an upper bound.
- **How to resolve:** Separate full-month plan from current MTD and historical as-of metrics; use explicit India business-date boundaries. Historical balances require ledger reconstruction.
- **Status:** Locally fixed and regression-tested.

#### D03 - Customers with matching display names are merged

- **Severity:** P2. **Importance:** Medium; customer concentration and account reporting can identify the wrong account. **Complexity:** Medium.
- **Where / problem:** `top_customer_json` grouped by display name instead of stable customer ID.
- **How to resolve:** Group by customer ID, then show a disambiguating customer code/location when names match.
- **Status:** Locally fixed and regression-tested.

#### D04 - Low-stock card can say healthy while shortages exist

- **Severity:** P1. **Importance:** High; purchasing can miss shortages and the dashboard can undercount them. **Complexity:** Medium.
- **Where / problem:** Dashboard selected the first 50 by absolute stock, checked reorder levels afterwards and used a five-row preview length as the headline count.
- **How to resolve:** Compute the full shortage population and count before limiting a separately ranked detail preview.
- **Status:** Locally fixed and regression-tested.

#### D05 - Pipeline value includes lost and non-open quotes

- **Severity:** P2. **Importance:** Medium; sales opportunity totals are overstated and disagree across dashboards. **Complexity:** Medium.
- **Where / problem:** Owner dashboard summed every quote created in the month without an open-status filter; Advanced Analytics used a different population.
- **How to resolve:** Define one documented open-pipeline status/date/value rule and reuse it across screens; separate quote activity from open pipeline.
- **Status:** Locally fixed and regression-tested.

#### D06 - Dashboard readiness counts combine overlapping populations

- **Severity:** P2. **Importance:** Medium; management may interpret orders as actual jobs or dispatch-ready material. **Complexity:** Large.
- **Where / problem:** Confirmed/payment-pending orders fed production counts; broad order states fed dispatch-ready counts; delayed previews overlapped both in a status donut.
- **How to resolve:** Use actual active jobs for production, physical/QC/packing prerequisites for dispatch readiness, mutually exclusive categories for distributions, and uncapped counts.
- **Status:** Locally fixed and regression-tested.

#### D07 - API row caps can truncate monetary totals

- **Severity:** P2 (conditional). **Importance:** Medium; totals and unique-customer counts become understated above the effective API cap. **Complexity:** Medium.
- **Where / problem:** Dashboard summed/uniqued fetched rows in JavaScript without paging to completion; exact count metadata did not expand the returned row set.
- **How to resolve:** Calculate sums and distinct counts with database aggregates using the same business filters; keep previews separate from totals.
- **Status:** Locally fixed and regression-tested.

#### D08 - Analytics failure can appear as zero risk and healthy

- **Severity:** P2 (source-verified). **Importance:** Medium-high; unavailable data can be mistaken for verified zero or no risk. **Complexity:** Medium.
- **Where / problem:** Analytics failure/invalid snapshots fell back to empty metrics and a green no-risk panel while showing only a partial-data warning.
- **How to resolve:** Distinguish unavailable, partial, stale and verified-empty states; suppress health conclusions when source data failed.
- **Status:** Locally fixed and regression-tested.

### F findings

Source: `docs/FACTORY_CONTROL_AUDIT_2026-10-04.md`; status detail: `docs/AUDIT_REMEDIATION_2026-10-14.md`.

#### F01 - Release/start can use stale order, die or press readiness

- **Severity:** P1. **Importance:** High; work can be authorized for a cancelled order or unavailable machine/die. **Complexity:** Large.
- **Where / problem:** Scheduling checked eligibility, but release/start rechecked slot/job linkage without revalidating order, press and die status.
- **How to resolve:** Lock and recheck all relevant eligibility at both release and start; define any override as role-limited and audited. Test changes after schedule/release and concurrent resource blocking.
- **Status:** Locally fixed and regression-tested.

#### F02 - Held jobs cannot be safely rescheduled through the supported transaction

- **Severity:** P1. **Importance:** High; factory recovery after breakdown or schedule change is blocked. **Complexity:** Large.
- **Where / problem:** Schedule save accepted `on_hold` but attempted a transition to `planned` that status guards rejected, rolling back the replacement slot.
- **How to resolve:** Add an explicit atomic replan/resume transition that preserves hold history and completed floor evidence, checks resource overlap, and replaces the old slot safely.
- **Status:** Locally fixed and regression-tested.

#### F04 - Factory-manager allocation permission differs across app and RPC

- **Severity:** P2. **Importance:** Medium; the intended factory operator cannot allocate/reallocate billets through the API. **Complexity:** Medium.
- **Where / problem:** Application permission helper allowed factory managers, but allocation/reallocation RPC business-role allowlists omitted them.
- **How to resolve:** Confirm separation-of-duties policy and align UI, server action, wrapper, private function and RLS; retain company/material compatibility and counter checks.
- **Status:** Locally fixed and regression-tested; real authenticated permissions remain unverified.

### S findings

Source: `docs/SCRAP_BILLET_AUDIT_2026-10-07.md`; status detail: `docs/AUDIT_REMEDIATION_2026-10-14.md`.

#### S01 - Positive foundry charge can be accepted without source stock

- **Severity:** P1. **Importance:** High; creates billet output without debiting the source material represented by the furnace charge. **Complexity:** Large.
- **Where / problem:** Foundry calculation/debit triggers and `foundryBatchSchema` allowed positive scrap/external charge components with null source IDs.
- **How to resolve:** Require same-company usable source stock for every positive charge component before material becomes usable; define incomplete planned-batch behavior and test rollback/mixed-source cases.
- **Status:** Locally fixed and regression-tested.

#### S02 - Reducing foundry batch count leaves surplus billet stock

- **Severity:** P1. **Importance:** High; batch count and physical billet inventory diverge. **Complexity:** Large.
- **Where / problem:** Billet synchronization upserted rows through the new count but did not remove, cancel or reject rows above it.
- **How to resolve:** Enforce equality between accepted count and valid billets; reject reductions conflicting with committed stock or require an audited atomic correction. Test shrink/expand/retry/committed cases.
- **Status:** Locally fixed and regression-tested.

#### S03 - Density edits rewrite issued or consumed billet weights

- **Severity:** P1. **Importance:** High; committed physical input mass and production lineage can be rewritten. **Complexity:** XL.
- **Where / problem:** Foundry recalculation updated per-billet mass while preserving issued/consumed lifecycle status.
- **How to resolve:** Freeze physical input attributes at the commitment boundary or require an audited correction that checks every allocation, issue and production dependency.
- **Status:** Locally fixed and regression-tested.

## September Business-Logic Findings (BL-01 to BL-18)

Source: `FIXES-CLAUDE.md`; local implementation and verification: `BUSINESS_LOGIC_VERIFICATION.md`. The source assigned the P0-P3 severities below. Its 29 September report records local implementations and 621 passing tests; the 14 October report records a later 683-test full-suite pass. These findings are preserved as audit history, not current confirmed local defects.

### BL-01 - Per-square-foot finishing cost uses guessed geometry

- **Severity:** P0. **Importance:** Critical; can materially misprice powder coating/anodizing while warning that cost is zero. **Complexity:** Large.
- **Where / problem:** `lib/calculations/quote.ts`; the only caller omitted surface area, so the calculation used a fixed 0.3 m perimeter guess for every profile.
- **How to resolve:** Use measured/profile-master perimeter to calculate area; if unavailable, show truthful not-costed status and block sending or require an explicit override.
- **Status:** Locally fixed; quote regression evidence recorded.

### BL-02 - Expected recovery percentage was collected but not used in material costing

- **Severity:** P0. **Importance:** Critical; raw-material cost was systematically understated when recovery was below 100%. **Complexity:** Large.
- **Where / problem:** `lib/calculations/quote.ts`, quote form and validation schema; recovery was stored and returned but not used in the cost formula.
- **How to resolve:** Gross up billet input by expected recovery, or remove the no-op field; keep handling/offcut allowance distinct to avoid double-counting.
- **Status:** Locally fixed; TypeScript and SQL calculation regressions recorded.

### BL-03 - Business numbers were allocated client-side with a race

- **Severity:** P0. **Importance:** Critical; concurrent creates could fail or generate duplicate traceability numbers, with year-boundary errors from local time. **Complexity:** XL.
- **Where / problem:** `lib/utils/numbering.ts`, record-form client and quote/order form; clients read existing numbers then computed max plus one.
- **How to resolve:** Allocate persisted numbers through the company-scoped, locked database allocator in the same insert transaction; browser numbers may be preview-only.
- **Status:** Locally fixed; atomic numbering SQL checks recorded.

### BL-04 - Markup input and margin approval used different bases

- **Severity:** P1. **Importance:** High; correctly priced quotes could trigger false low-margin approval and erode trust in the approval gate. **Complexity:** Medium.
- **Where / problem:** `lib/calculations/quote.ts`; input markup on cost was compared with a minimum margin on sales revenue.
- **How to resolve:** Use one documented base for input, displayed percentage and approval threshold; test exact threshold arithmetic.
- **Status:** Locally fixed; margin/markup definitions made explicit.

### BL-05 - GST lacked intra-state/inter-state tax split

- **Severity:** P1. **Importance:** High; tax documents lacked CGST/SGST/UTGST versus IGST treatment and correct place-of-supply handling. **Complexity:** Large.
- **Where / problem:** Quote/invoice tax calculation, company GST state and customer place-of-supply data.
- **How to resolve:** Derive HSN/rate and place of supply; split domestic same-state and interstate tax consistently through quote, packing and invoice.
- **Status:** Locally fixed for the reported domestic GST scope. Export, SEZ, reverse charge, cess, e-invoicing and filing workflows remain outside that implementation.

### BL-06 - Furnace scrap and external-metal percentages could exceed total charge

- **Severity:** P1. **Importance:** High; charge and source-stock consumption could be overstated. **Complexity:** Medium.
- **Where / problem:** `lib/calculations/foundry.ts`; scrap and external percentages were independent rather than complementary.
- **How to resolve:** Derive one component as the complement or reject percentages that do not total 100%.
- **Status:** Locally fixed; mix validation and charge regressions recorded.

### BL-07 - Glass wastage appeared twice in the cost breakdown

- **Severity:** P2. **Importance:** Medium; component totals could disagree with internal cost and mislead users. **Complexity:** Medium.
- **Where / problem:** `lib/systems-configurator/costing-engine.ts`; glass wastage was in both glass cost and total wastage.
- **How to resolve:** Put each material's wastage in exactly one breakdown bucket and assert component totals reconcile.
- **Status:** Locally fixed and regression-tested.

### BL-08 - Payment plus credit could leave a fully settled invoice marked partially paid

- **Severity:** P2. **Importance:** Medium; settlement dashboards and outstanding balances could display the wrong state. **Complexity:** Medium.
- **Where / problem:** Invoice status ladder in `20260723070000_dispatch_return_credit_notes.sql`; it compared payment and credit separately although balance due used both.
- **How to resolve:** Add a settled branch based on payment plus credit before the partial-payment branch; preserve refund/reopen rules.
- **Status:** Locally fixed; payment-plus-credit and refund regression evidence recorded.

### BL-09 - Quote-to-order conversion duplicated logic and dropped quote-line lineage

- **Severity:** P2. **Importance:** Medium; SQL and TypeScript paths could drift and weaken quote-to-order traceability. **Complexity:** Large.
- **Where / problem:** `20260715000000_atomic_business_workflows.sql` and `lib/pcda/quote-order.ts`; live SQL copied lines without the original quote-line ID.
- **How to resolve:** Keep one authoritative conversion path and persist each quote item as the corresponding order line's source line.
- **Status:** Locally fixed; quote/line identity is stamped by the SQL conversion path. Related multi-profile lineage is separately tracked as B04.

### BL-10 - PCDA snapshot mixed units and omitted cost components

- **Severity:** P2. **Importance:** Medium-high; internal cost could be understated and downstream recomputation could use per-kg rates as line totals. **Complexity:** Large.
- **Where / problem:** `lib/pcda/quote-order.ts`; snapshot fields mixed rate/total semantics and omitted packing, transport and other charges from internal cost.
- **How to resolve:** Store rates and totals in fields with consistent semantics and make snapshot internal cost reconcile to full quote line cost.
- **Status:** Locally fixed; snapshot/calculation regressions recorded.

### BL-11 - Quote flat GST and invoice per-line GST could produce different totals

- **Severity:** P2. **Importance:** Medium; customer quote and invoice totals could diverge for mixed tax rates. **Complexity:** Medium.
- **Where / problem:** `lib/calculations/quote.ts` versus invoice recalculation in `20260718010000_financial_closure.sql`.
- **How to resolve:** Apply the same per-line tax rule to quote and invoice, or enforce one company-wide rate end to end.
- **Status:** Locally fixed; per-line tax and rounding regressions recorded.

### BL-12 - Signed half-up rounding was asymmetric for negative values

- **Severity:** P3. **Importance:** Low; negative variance/margin values could round inconsistently. **Complexity:** Low.
- **Where / problem:** `lib/calculations/pcda/rounding.ts` used `Math.round` for signed outputs.
- **How to resolve:** Round the magnitude and reapply sign if half-away-from-zero is intended, or document the chosen asymmetry.
- **Status:** Locally fixed and regression-tested.

### BL-13 - Indian amount-to-words conversion failed at 100 crore and above

- **Severity:** P3. **Importance:** Low-medium; large invoices could contain malformed amount-in-words text. **Complexity:** Medium.
- **Where / problem:** `lib/utils/number-to-words.ts` passed crore values above 99 to a two-digit converter.
- **How to resolve:** Convert the crore group recursively with a full number-to-words routine.
- **Status:** Locally fixed and regression-tested.

### BL-14 - Plan attainment and material recovery shared ambiguous yield naming

- **Severity:** P3. **Importance:** Low; users/developers could confuse actual-versus-planned output with output-versus-input material recovery. **Complexity:** Low.
- **Where / problem:** `lib/calculations/operations.ts` and `lib/calculations/pcda/recovery.ts`.
- **How to resolve:** Name plan attainment and material recovery distinctly and use each term consistently.
- **Status:** Locally fixed; plan-attainment helper renamed.

### BL-15 - Configurator engines read different glass-deduction option keys

- **Severity:** P3. **Importance:** Low-medium; glass dimensions and gasket/wool-pile perimeter could disagree for templates using `_mm` keys. **Complexity:** Medium.
- **Where / problem:** `hardware-engine.ts` and `glass-engine.ts` used different option-key lookup rules.
- **How to resolve:** Centralize deduction-option lookup and share it across all configurator engines.
- **Status:** Locally fixed; common lookup and regressions recorded.

### BL-16 - Cutting optimizer accepted impossible cuts and counted reusable offcuts as waste

- **Severity:** P3. **Importance:** Medium; cutting and scrap/yield reports could mislead production planning. **Complexity:** Medium.
- **Where / problem:** `lib/systems-configurator/profile-optimization.ts` placed cuts longer than stock and counted reusable leftovers in waste.
- **How to resolve:** Reject/segregate oversized cuts; report reusable offcuts separately from true waste.
- **Status:** Locally fixed; oversized-cut, stock-length and waste regressions recorded.

### BL-17 - Direct-order value trusted a client-supplied total

- **Severity:** P3. **Importance:** Medium; order totals and owner reporting could drift from line values. **Complexity:** Medium.
- **Where / problem:** `save_order_atomic` in `20260715000000_atomic_business_workflows.sql` accepted `order_value` from the order payload.
- **How to resolve:** Derive authoritative order value from validated line items, or label an estimate separately from billed value.
- **Status:** Locally fixed; server-derived direct-order totals were covered in the business-logic regression set. A broader direct-order commercial-line investigation remains separate.

### BL-18 - Alloy composition comparison depended on JSON key order

- **Severity:** P3. **Importance:** Low; equivalent compositions could be falsely flagged as custom. **Complexity:** Low.
- **Where / problem:** `lib/calculations/alloy-composition.ts` compared serialized objects directly.
- **How to resolve:** Normalize/sort element keys or compare element values independently.
- **Status:** Locally fixed and regression-tested.

## Astra Findings (1 to 13)

Source: `AUDIT_ASTRA_1_REMEDIATION.md`. The supplied source did not assign severity levels, so severity is marked **not rated in source**. Importance and complexity below are consolidated estimates. The report records local SQL/unit checks; full migration replay, hosted JWT/RLS, independent-session concurrency, authenticated browser UAT and deployment remain unverified.

### Astra 1 - Stock over-reservation

- **Severity:** Not rated in source. **Importance:** High; reserved demand could exceed physical stock. **Complexity:** Large.
- **Where / problem:** Stock reservation trigger and batch capacity in configurator inventory.
- **How to resolve:** Lock the batch, validate active reservations, company/profile/order lineage and remaining capacity in the transaction.
- **Status:** Locally fixed; SQL capacity/tenant rejection tests passed. Separate-session contention remains open.

### Astra 2 - Role bypasses in configurator and stock workflows

- **Severity:** Not rated in source. **Importance:** High; viewers or unauthorized roles could mutate or release stock. **Complexity:** XL.
- **Where / problem:** Configurator, output/library and reservation RLS policies and save RPC authorization.
- **How to resolve:** Replace permissive policies with explicit tenant/role rules and keep application, RPC and RLS permissions aligned.
- **Status:** Locally fixed; negative SQL authorization checks passed. Hosted role/JWT acceptance remains open.

### Astra 3 - Ambiguous production source-line selection

- **Severity:** Not rated in source. **Importance:** High; production jobs could lose or misstate order-line lineage. **Complexity:** Large.
- **Where / problem:** Production handoff when an order has duplicate lines for the same profile.
- **How to resolve:** Require exactly one matching line or an explicit selection, validate it in the RPC and persist `source_line_id`.
- **Status:** Locally fixed; ambiguous/foreign selection rejection and explicit selection tests passed.

### Astra 4 - Packing flow could override commercial GST

- **Severity:** Not rated in source. **Importance:** High; packing/invoice tax could differ from the approved order. **Complexity:** Medium.
- **Where / problem:** GST fields passed from packing into invoice generation.
- **How to resolve:** Derive GST from the authorized commercial order/quote line and ignore packing-entered overrides; preserve legitimate zero-rate cases.
- **Status:** Locally fixed; SQL GST-source checks passed.

### Astra 5 - Configuration recalculation could leave partially replaced data

- **Severity:** Not rated in source. **Importance:** High; failed recalculation could mix old and new BOM/cut totals. **Complexity:** Large.
- **Where / problem:** Draft configuration save and replacement of calculation collections.
- **How to resolve:** Use one authorized version-checked transaction to replace all child collections, invalidate optimization runs and update totals atomically.
- **Status:** Locally fixed; injected failures and stale/foreign saves were rejected without partial replacement.

### Astra 6 - Prefix metacharacters broke business-number allocation

- **Severity:** Not rated in source. **Importance:** Medium; valid prefixes could produce failed or incorrect numbering. **Complexity:** Medium.
- **Where / problem:** Number allocator used a regular expression against literal prefix/year strings.
- **How to resolve:** Compare the literal prefix/year stem and use a regex only for the numeric suffix.
- **Status:** Locally fixed; punctuation, backslash, rollover and sequential-allocation tests passed.

### Astra 7 - Invoice party identity could drift from historical records

- **Severity:** Not rated in source. **Importance:** High; re-downloaded invoices could show current master data instead of the issued parties. **Complexity:** Large.
- **Where / problem:** Invoice creation and PDF loading for supplier/customer identity and address fields.
- **How to resolve:** Capture party/address/GST snapshots at issuance, make snapshots immutable and render PDFs from snapshots only.
- **Status:** Locally fixed for new snapshots; legacy invoices without reliable snapshots return a conflict and require original issued documents. No fabricated historical backfill.

### Astra 8 - Hardware quantities could diverge from custom-glass cuts

- **Severity:** Not rated in source. **Importance:** Medium; gasket/wool-pile BOM could disagree with generated glass geometry. **Complexity:** Medium.
- **Where / problem:** Hardware-engine fallback calculations when custom glass formulas fail or provide generated cuts.
- **How to resolve:** Base default gasket/wool-pile quantities on generated glass cuts; retain explicit hardware formulas as override.
- **Status:** Locally fixed; unit geometry and formula-error tests passed.

### Astra 9 - Configuration numbers used client max-plus-one

- **Severity:** Not rated in source. **Importance:** High; concurrent project creation could duplicate or overwrite identifiers. **Complexity:** Medium.
- **Where / problem:** Configurator insert numbering.
- **How to resolve:** Use the central locked allocator server-side and make assigned numbers immutable.
- **Status:** Locally fixed; uniqueness, forged-input and rollback SQL tests passed.

### Astra 10 - Production-linked configurations could be reset or deleted

- **Severity:** Not rated in source. **Importance:** High; recalculation/reset could sever production evidence. **Complexity:** Large.
- **Where / problem:** Configuration lifecycle, output guards and edit/calculation actions after production linkage.
- **How to resolve:** Prevent unlink, draft reset, recalculation, child deletion and parent deletion once linked; explain the lock in the UI.
- **Status:** Locally fixed; SQL lifecycle rejection tests passed.

### Astra 11 - Mixed profile stock lengths were not retained in optimization

- **Severity:** Not rated in source. **Importance:** Medium; cut plans and waste totals could be wrong for the same profile stocked in different lengths. **Complexity:** Medium.
- **Where / problem:** Profile optimization, cut records, UI and PDF.
- **How to resolve:** Keep stock length on each cut, allocate by profile and stock length, and compute waste from actual lengths.
- **Status:** Locally fixed; 3 m/6 m, oversized-cut and weighted-waste tests passed.

### Astra 12 - Foundry calculation trigger could overwrite allocated numbers

- **Severity:** Not rated in source. **Importance:** Medium; editing furnace/date fields could alter a traceability identifier. **Complexity:** Medium.
- **Where / problem:** Interaction between foundry calculation trigger and central business-number allocator.
- **How to resolve:** Keep calculation triggers from writing the allocated business identifier; preserve numbering in its dedicated allocator.
- **Status:** Locally fixed; allocator/trigger interaction test passed.

### Astra 13 - Completed finishing evidence remained editable

- **Severity:** Not rated in source. **Importance:** High; terminal process weights and evidence could be rewritten after completion. **Complexity:** Medium.
- **Where / problem:** Finishing-job terminal status and weight/evidence fields.
- **How to resolve:** Reject changes to completed finishing weights/evidence and reject reopening through ordinary saves.
- **Status:** Original weight/remarks/reopening controls were locally fixed and SQL-tested. R17 subsequently reproduced the remaining movement-field/deletion gaps and supplied the separate guard/date-preservation patch, applied on 20 October. Complete historical/operator terminal-evidence acceptance remains open under R17.

## Unconfirmed Investigations

The October audits originally listed these as follow-up questions rather than reproduced findings. Confirmed continuation defects are linked below; the remaining business, historical and hosted acceptance questions are not marked complete.

The status below incorporates the 20 October activation and R25 continuation. Earlier pre-application checkpoints remain in the historical per-issue evidence; they do not describe unapplied work today. Reproduced defects R01-R25 have the current states recorded above, while the following broader questions remain open.

- **Direct-order commercial lineage:** R08 implements both quotation-backed and direct priced-line orders; its database patch is applied. Local production/packing/invoice checks preserve quantities, rates, HSN/GST and exact identities across repeated profiles and partial shipments. The latest read-only direct-line exception query returns zero rows, without inventing historical prices. Historical source-document reconciliation, complete signed-in quotation/direct journeys, independent-session retries and broader reporting acceptance remain open. **Sources:** `docs/RECONCILIATION_AUDIT_2026-10-04.md`; `docs/FACTORY_CONTROL_AUDIT_2026-10-04.md`.
- **Partial reservation release:** R01 locally fixes truncated availability; the R04/R05/R09 replay/projection patches, R10 cancellation guard and R11 retained-shipment invoice patch are applied. The fixtures preserve posted fulfillment and release only unconsumed holds, with reconciled kg/metres/pieces; the latest cancellation/stock exception query returns zero rows. Complete cancellation/invoicing, operator release controls, real-token authorization and independent-session acceptance remain open. **Sources:** `docs/RECONCILIATION_AUDIT_2026-10-04.md`; `docs/BUSINESS_FLOW_AUDIT_2026-10-04.md`.
- **Returned-stock reconciliation:** R10's applied guard prevents cancellation from inventing a dealer stock return. Its read-only review does not certify or correct past receipts. Trace actual physical returns through movements/batches and return-credit processing, with exact source, quantity and quality/receipt evidence, before closing the broader investigation. **Source:** `docs/RECONCILIATION_AUDIT_2026-10-04.md`.
- **Duplicate adjustment/credit and cash-versus-adjustment reporting:** The original cash-event control excluded the `credit_note` method, so cash inflation was not confirmed on that path. R02/R03 locally fix receipt retry and corrected-credit workflow defects. R06/R07 settlement exclusivity and retry binding are applied; finance remediation also implements refund ledgers, signed collection reporting and historical review. The latest credit-overlap exception query returns zero rows. Historical accounting corrections, independent concurrent repeats and complete signed-in settlement/reporting acceptance remain open. **Sources:** `docs/RECONCILIATION_AUDIT_2026-10-04.md`; `docs/BUSINESS_FLOW_AUDIT_2026-10-04.md`; `docs/FINANCE_EXPENSES_REMEDIATION_2026-10-20.md`.

R15 locally aligns die readiness/selection with scheduling; R16 locally reconciles production reporting, with twelve additional passing scrap-posting controls and 67 report checks. R17-R21 database patches are applied, with their original 43/67/39/129/44-check evidence retained. R18 supports separate original/retry accepted portions; R19 preserves material evidence; R20 accounts for complete workload and retry transfers. These do not attest physical gain/loss, a physical packaging return or completed-package reversal. R22 repairs the manual writer, R23 repairs panel lifecycle, R24 supplies the applied complete compatibility lookup, and R25 aligns/rechecks automatic allocation. Their narrower defects are no longer listed as unimplemented work. Remaining coverage includes complete billet requirement generation and source switching across actual journeys, measured billet-mass adequacy, scrap-to-remelt provenance, broader QC/report/operator acceptance, physical finishing/packaging reconciliation and independent press-slot/allocation races.

## Outstanding Acceptance Gates

These gates remain even where local regression evidence exists. They are not extra confirmed bugs:

- **Staging infrastructure:** Repair Docker or restore its preserved runtime state, then establish a disposable compatible staging target. The existing runner correctly rejects absent dedicated configuration. No staging stack or users exist from this attempt.
- **Full migration lineage/replay:** Reconcile the current 183 files / 171 versions and seven collision groups against historical evidence; replay the complete prerequisite chain in isolation. The earlier catalog comparison, recent-script replay and 86-row hosted ledger cannot prove the original execution of every older file. The new supplier-contact candidate is outside those completed comparisons and remains unapplied.
- **Supplier-contact candidate (closed 22 October; applied and body-verified, see the current checkpoint):** Review/replay and apply `20261020120000_invoice_supplier_snapshot_contact.sql`, verify the actual body/private ACLs and newly created invoice/credit-note output, and reconcile the older reference copy in `sql/astra-integrity.sql`. Keep existing issued snapshots immutable; do not manufacture missing historical address/contact data.
- **Real-token authorization and Storage:** Verify owner, admin, sales, production, factory, inventory, dispatch, quality, accounts, viewer, suspended, sibling-dealer and second-company boundaries using actual sign-in/JWTs, direct API requests, uploads/downloads and safe PDF/report projections. SQL-role claims are supporting evidence only.
- **Independent concurrent sessions:** Test allocation/reallocation, reservation/cancellation/dispatch, direct-order and quote conversion retries, numbering, production/press scheduling, duplicate invoices, supplier overpayment and settlement exclusivity with separate sessions. Single-session locks/replays do not prove race behavior.
- **Historical and physical reconciliation:** Compare foundry sources/billets, commercial lines, reservations, finishing receipts, material movements, stock kg/metres/pieces and financial ledgers to source documents and physical/cash records. Review expense reconciliation and invoice settlement views. Seven empty exception reports do not establish unrecorded history or physical adequacy.
- **Complete signed-in journeys:** Exercise quotation and direct order through production, QC/rework, per-receipt packing, partial/final dispatch, retained-shipment invoicing, receipt, credit/refund/return and expense approval/payment/reversal. Include configurator/dealer receipt and both manual/automatic billet allocation.
- **PDF acceptance:** The later handover reports all listed local visual cases, page-break sweeps and server-action font traces completed. Verify deployed font packaging, customer-safe fields, actual source-document content and authenticated delivery. Record any further run with its actual source state and total; do not attach the earlier 1,725 count to newer PDF code.
- **Security/advisor review (performance part addressed 22 October: FK indexes and RLS init-plan applied; remaining items listed in the current checkpoint):** Resolve or explicitly accept the documented definer-view/RPC architecture and password-protection findings, and assess performance advisories with the intended access model. Do not blanket-convert views, remove indexes or relax RLS to clear counts.
- **Source/evidence promotion:** Review the saved R25 and newer PDF diffs/tests/fonts/dependencies and their evidence, handle generated files without losing local changes, commit verified work on `codex/v1`, and fast-forward `main` under the existing two-checkout workflow. The central document is synchronized; later application source is still pending promotion.
- **Deployment and final closure:** Record an explicitly authorized compatible application deployment and its checks separately. No application deployment is certified by this register. Keep A00, the broader investigations and relevant acceptance states open until their stated evidence exists.

The 14 October report records 683 passing tests, zero lint errors/warnings, successful typecheck/build and local integrated/dealer SQL fixtures. These remain historical evidence for that source state; later checkpoints below supersede the test totals and earlier unavailable hosted probes. They do not establish production readiness.

**Historical 19 October checkpoint (superseded by the 20 October application report):** The latest 19 October checkpoint records 1,461 passing tests, 76 suites, zero failures/skips/cancellations, clean final lint/typecheck and a successful build with 154 generated pages. R11 added 62 edge tests beyond the 857-test checkpoint; R12 added 13 beyond 919; R13 added 32 beyond 932; R14 added 40 beyond 964; R15 added 55 beyond 1,004. The scrap-posting investigation adds 13 tests (12 scenarios and their enclosing case) beyond 1,059; R16 adds 67 report tests beyond 1,072 and is locally fixed. R17 adds 43 terminal-finishing tests beyond 1,139; R18 adds 67 accepted-portion checks beyond 1,182; R19 adds 39 material-evidence checks beyond 1,249; R20 adds 129 workload/read/action/browser checks beyond 1,288; R21 adds 44 billet-link repair checks beyond 1,417. These five remain unapplied candidates. Historical progress remains in `docs/BUGS_MEGA_PROGRESS_2026-10-15.md`; current verification and boundaries are recorded in `docs/BUGS_MEGA_PROGRESS_2026-10-19.md`. R01-R03 and R12-R16 are locally fixed; R04-R11 and R17-R21 remain verified, unapplied candidates. R22 remains reproduced and unfixed. No Supabase migrations were applied. The broader investigations and outstanding gates above remain open.

**Historical initial application checkpoint, 20 October:** `npm test` passes 1,553 tests / 76 suites with zero failures/skips/cancellations; final lint/typecheck and the 154-page build pass. R22 has 52 SQL/action checks; the completed finance files have 18 expense, seven receivables and five reporting checks. Browser adapters were updated for the newly imported expense action, with the affected 31 browser/credit tests passing. All 40 reviewed migrations are applied and recorded. Hosted read probes, expense posting/retry/reversal in a fully rolled-back transaction, missing-identity view checks, post-rollback counts and final schema/body/grant checks pass. The application was not deployed. A00 and complete real-JWT/Storage/concurrency/operator acceptance remain OPEN; remaining advisor flags are documented in `docs/MIGRATION_RECONCILIATION_2026-10-20.md`.

**Historical isolated-worktree verification, 20 October:** R23 was locally fixed on the then-existing `codex/bugs-mega-allocation-panel`, based on `12874da`; that work was later consolidated into `codex/v1` and `main`, and the extra worktree retired. The full suite passed **1,595 tests / 76 suites**, zero failures/skips/cancellations; lint/typecheck and standard build (154 pages) passed. Thirty new panel/browser/action/SQL checks and 16 styled responsive cases verified the lifecycle repair. The staging runner was safety-gated because dedicated configuration was absent and Docker was unavailable. No hosted write, migration application or deployment occurred in that checkpoint. See `docs/BUGS_MEGA_PROGRESS_2026-10-20.md` for its evidence and limits.

**Historical R24 handoff checkpoint, 20 October:** Plain `npm test` passed **1,673 tests / 76 suites**, zero failures/skips/cancellations; lint/typecheck, standard 154-page build and 16 responsive cases each for R24/R23 passed. R24 was then a verified unapplied candidate, included in the 38-check REST contract (24 RPCs and 14 columns). Its source/evidence was subsequently consolidated and its later hosted application verified; the handoff's unapplied/awaiting-consolidation state is superseded.

**Consolidation checkpoint, 20 October:** Both retained branches reached `61a1530`, with the latest PDF/report implementation and saved allocation work preserved. Full suite: **1,681 passed / 76 suites**; lint/typecheck/154-page build, 54 focused PDF/report/merge checks, 35 die/production checks and the stated 16-page PDF smoke checks passed. See `docs/GIT_CONSOLIDATION_2026-10-20.md` for preservation/recovery evidence and the original pending boundaries.

**Latest recorded application verification, 20 October at 15:15 IST:** Full suite **1,725 passed / 76 suites**, zero failures/skips/cancellations; final lint/typecheck and 154-page production build passed. R24's exact body/ACL, 48/48 company-scoped billet reads and negative identity checks passed. R25's 44 new checks, 165 focused checks, whole-script catalog replay, hosted ledger/body/ACL, 16 preflight groups and fully rolled-back runtime/digest checks passed. Current ledger: **86 records**. R25 application source/evidence remains uncommitted; real-login/Storage/concurrent/physical/operator acceptance remains open and staging remains blocked. `docs/BUGS_MEGA_R25_AUTO_ALLOCATION_2026-10-20.md`, `docs/BUGS_MEGA_CHECKPOINT_2026-10-20.md` and `docs/evidence/BUGS_MEGA_2026-10-20/R25/verification.json` contain the detailed record. This register refresh is documentation-only and does not imply a fresh full test run.

**Later PDF working-tree checkpoint, inspected around 19:00 IST:** `pdf fix.MD` section 8 reports lint/typecheck/build/full tests passed, 28 principal fixture documents plus about 170 boundary documents checked, fourteen quality repairs and server-action traces containing 23 font files. It also reports seven passing supplier-contact snapshot tests and explicitly records that migration as unapplied. The current file-only SQL count is 183 / 171 versions. Those results are attributed to that follow-up handover; its exact full-suite count is not supplied there and was not reconstructed from the older R25 log. No new application check or hosted probe was run for this documentation refresh.

## Source Audit Files Reviewed

- `FIXES-CLAUDE.md` (20 September audit; status updated 29 September)
- `BUSINESS_LOGIC_VERIFICATION.md` (29 September)
- `AUDIT_ASTRA_1_REMEDIATION.md` (30 September)
- `docs/AUDIT_2026-10-03.md`
- `docs/BUSINESS_FLOW_AUDIT_2026-10-04.md`
- `docs/RECONCILIATION_AUDIT_2026-10-04.md`
- `docs/FACTORY_CONTROL_AUDIT_2026-10-04.md`
- `docs/DATA_TRUST_AUDIT_2026-10-04.md`
- `docs/SCRAP_BILLET_AUDIT_2026-10-07.md`
- `docs/AUDIT_REMEDIATION_2026-10-08.md` (historical continuation checklist)
- `docs/AUDIT_REMEDIATION_2026-10-14.md` (original per-finding local status and verification record)
- `docs/BUGS_MEGA_PROGRESS_2026-10-15.md` (carried-forward R01-R10 history and R11 reproduction)
- `docs/BUGS_MEGA_PROGRESS_2026-10-19.md` (R11-R21 continuation and original R22 reproduction)
- `docs/FINANCE_EXPENSES_DEEP_AUDIT_2026-10-15.md` (57 finance/expenses source finding IDs, including later addenda)
- `docs/FINANCE_EXPENSES_REMEDIATION_2026-10-20.md` (finance implementation and original verification boundary; later activation recorded in reconciliation)
- `docs/MIGRATION_RECONCILIATION_2026-10-20.md` (40 initial applications, forward repairs and later R24/R25 evidence)
- `docs/BUGS_MEGA_PROGRESS_2026-10-20.md` (R23 checkpoint)
- `docs/BUGS_MEGA_R24_ALLOCATION_OPTIONS_2026-10-20.md` (R24 reader/UI and later hosted verification)
- `docs/BUGS_MEGA_HANDOFF_2026-10-20.md` (historical saved-work/consolidation handoff)
- `pdf fix.MD` (original rewrite plus the newer section-8 quality fixes, visual/trace/test results and unapplied supplier-contact candidate)
- `docs/GIT_CONSOLIDATION_2026-10-20.md` (preservation, recovery, two-checkout state and post-merge/PDF verification)
- `docs/BUGS_MEGA_R25_AUTO_ALLOCATION_2026-10-20.md` (latest automatic-allocation fix/application and verification)
- `docs/BUGS_MEGA_CHECKPOINT_2026-10-20.md` (15:15 IST checkpoint, staging attempt, machine/Git state and remaining work)
- `docs/evidence/BUGS_MEGA_2026-10-20/R25/verification.json` (portable machine-readable latest verification)
- `supabase/migrations/20261020120000_invoice_supplier_snapshot_contact.sql` (new unapplied private snapshot trigger candidate)
- `tests/invoice-supplier-snapshot-contact.test.mjs` and `tests/pdf-document-quality.test.mjs` (newer PDF/supplier follow-up source and reported local coverage)

The uncommitted R25 report/checkpoint/evidence, updated section-8 PDF handover and newer supplier/PDF source/tests currently live in the existing `.worktrees/codex-v1` development checkout while source promotion is pending. The complete latest result and pending work are recorded in this central file so the root copy remains readable independently. Earlier schema/pending-migration snapshots retain their own checkpoint dates: 86 ledger entries / 182 source files describe the verified R25 hosted checkpoint; 183 source files / 171 versions describe the newer local inventory with its unapplied candidate.

The June codebase audit, July workflow audit, May audit checklist/templates and 8 August duplicate worktree copies remain outside the original audit date window. Their useful source history preserved during Git consolidation is recorded separately; it has not been invented as new work on 17 or 18 October.


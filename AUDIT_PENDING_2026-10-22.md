# Pending Audit Findings - 2026-10-22

This register contains all 43 items from the historical-audit reconciliation completed on 2026-10-22. Repeated reports of the same issue are consolidated. Findings already fixed by later evidence are excluded. The original audit IDs are retained where available.

Status distinguishes a confirmed defect from a probable issue, a business decision, a missing capability, and an acceptance gap. Local tests, hosted catalog checks, signed-in behavior, concurrency, deployment and physical reconciliation are separate proof layers. A missing acceptance result is not itself proof of a current code defect.

This document is maintained in the workspace root. Implementation for the selected repair is performed in the existing .worktrees/codex-v1 checkout, following the repository's development instructions. Existing unrelated changes are preserved.

Progress: AP-016 / EXOS-AUD2-021 is fixed and verified in the development working copy. All 43 entries are retained; the other 42 remain at their recorded statuses. Release promotion and deployment of this repair have not been performed.

## Pending Register

### AP-001 - Production completion counts billets that were never issued

- Original finding: EXOS-AUD2-002. Priority: P1. Status: Confirmed, unresolved.
- Issue: Completion includes allocated billets alongside issued and consumed billets. For three 500 kg billets with only one issued, an honest 500 kg completion fails while a fictitious 1,000 kg loss can make the transaction pass and consume the whole allocation.
- Impact: False consumption, yield and scrap figures; allocated stock may disappear without physical issue.
- Required resolution: Base completion on the actual issued material and reconcile each billet's lifecycle. Verify honest partial issue and reject artificial loss.
- Evidence: 2026-10-22 defect register and the hosted completion-function inspection from the historical reconciliation.

### AP-002 - Cast output can exceed charged metal

- Original finding: EXOS-AUD2-003. Priority: P1. Status: Confirmed, unresolved.
- Issue: Cast validation compares output with theoretical billet weight using a 15 percent allowance instead of enforcing charge conservation. A 65.670 kg charge accepted 74.864 kg good output plus 5 kg dross, producing negative 9.194 kg melt loss.
- Impact: Material is created on paper and recovery/cost figures become unreliable.
- Required resolution: Enforce a coherent charged-input, good-output, dross and loss balance with an approved measurement tolerance.
- Evidence: 2026-10-22 defect register and hosted cast-function inspection.

### AP-003 - Storage access is scoped by company but lacks business-role and customer ownership checks

- Original finding: EXOS-AUD2-014. Priority: P2. Status: Confirmed, unresolved.
- Issue: Policies for six business-file buckets allow company-wide read, write and delete without the necessary role or dealer/customer ownership checks.
- Impact: A company-scoped user may access another customer's quote or proof of delivery, or modify files outside their workflow authority.
- Required resolution: Apply bucket-specific role and record ownership checks, with signed-in JWT and Storage verification.
- Evidence: 2026-10-22 defect register and live Storage-policy inspection.

### AP-004 - Chemistry pass is accepted without validating alloy limits

- Original finding: EXOS-AUD2-009. Priority: P2. Status: Confirmed, unresolved.
- Issue: A manually supplied pass is not independently compared with the alloy specification. The audit accepted 6063 with Fe 0.60 and Mg 0.30 through release.
- Impact: Out-of-spec metal can receive an approved quality disposition.
- Required resolution: Validate measured chemistry against the applicable alloy limits on the server, including explicit override authority and evidence.
- Evidence: 2026-10-22 defect register and chemistry/release reproduction.

### AP-005 - Packaging purchases and consumption use different stock records

- Original finding: EXOS-AUD2-011. Priority: P2. Status: Confirmed, unresolved.
- Issue: Purchasing increases inventory_items, while packaging consumption uses packaging_materials.current_stock. A purchase of 100 can leave one balance at 100 and the other at zero; the packaging master is also manually editable.
- Impact: Packaging availability and consumption cannot be reconciled reliably.
- Required resolution: Establish one authoritative movement ledger and a verified mapping between purchasing and packaging consumption.
- Evidence: 2026-10-22 defect register and packaging reproduction.

### AP-006 - Dealer receipt discrepancies can strand stock and allow claims to be rewritten

- Original finding: EXOS-AUD2-012. Priority: P2. Status: Confirmed, unresolved.
- Issue: Receiving 99 of 100 creates a discrepancy without posting usable stock, and resolving it does not post the missing movement. Dealer permissions also permit changes or deletion of expected quantity and resolution fields.
- Impact: Real receipts can remain absent from stock and the original discrepancy evidence can be altered.
- Required resolution: Post accepted receipt quantities through an audited workflow and protect expected quantities, resolution authority and history.
- Evidence: 2026-10-22 defect register and receipt/discrepancy reproduction.

### AP-007 - Dealer stock has competing sources of truth

- Original finding: EXOS-AUD2-013. Priority: P2. Status: Probable; business decision required.
- Issue: Dealer receipts post inventory_transactions, while fulfillment uses manually entered profile_stock_batches.
- Impact: A receipt balance and a fulfillable balance can disagree.
- Required resolution: Decide ownership and opening-stock policy, then make receipt and fulfillment share an authoritative ledger with traceable transfers.
- Evidence: 2026-10-22 defect register and dealer stock-flow analysis.

### AP-008 - Audit history remains incomplete and some logging failures are swallowed

- Original finding: EXOS-AUD2-015. Priority: P2. Status: Partially fixed; remaining coverage unresolved.
- Issue: Selected maintenance and metal actions now have audit coverage, but the general enterprise audit helper records metadata without old/new values and swallows logging failures. Role and permission changes lack sufficient coverage.
- Impact: Sensitive changes may lack reconstructable history or fail to record without notifying the caller.
- Required resolution: Define critical-event coverage, record appropriate before/after evidence and make critical audit failure observable.
- Evidence: 2026-10-22 defect register, later remediation and hosted audit-helper inspection.

### AP-009 - Historical metal records have not been physically reconciled

- Original finding: EXOS-AUD2-016. Priority: P2. Status: Unresolved data reconciliation.
- Issue: The legacy F1-20260530-1 batch is ready with no cast result and no chemistry test. The audits also identify allocations from rejected lots and unreconciled metal balances.
- Impact: New database guards cannot establish the integrity of pre-existing stock and production history.
- Required resolution: Reconcile source documents, physical stock and lineage; use approved, history-preserving corrections.
- Evidence: 2026-10-22 defect register and read-only hosted records checked during reconciliation.

### AP-010 - Rejecting a charged source does not hold its downstream material

- Original finding: EXOS-AUD2-017. Priority: P2. Status: Confirmed control gap; recall policy required.
- Issue: Rejecting a source lot after charge does not propagate a hold to dependent cast batches, billets, production jobs or dispatches.
- Impact: Suspect material can remain available downstream.
- Required resolution: Define recall/containment rules and propagate a traceable hold or explicit review requirement.
- Evidence: 2026-10-22 defect register and source-disposition function inspection.

### AP-011 - Partial billet logs and remnants lack measured lineage

- Original finding: EXOS-AUD2-018. Priority: P2. Status: Probable; business decision required.
- Issue: There is no complete partial-log/remnant model with parent lineage and measured return. A calculation of 14.78 logs rounds to 15 while the remaining material is not represented separately.
- Impact: Count, weight and returned remnant balances can diverge.
- Required resolution: Agree the physical cutting/return model and represent usable remnants with measured quantity and source lineage.
- Evidence: 2026-10-22 defect register and billet model analysis.

### AP-012 - Dispatch weighing tolerance is too rigid

- Original finding: EXOS-AUD2-008. Priority: P2. Status: Unresolved rule; tolerance policy required.
- Issue: Dispatch accepts only a 0.01 kg difference. A 600 kg packed shipment weighed at 600.4 kg is refused.
- Impact: Ordinary weighing variance can block dispatch or encourage inaccurate entry.
- Required resolution: Define suitable absolute/percentage tolerances and an auditable approval route for larger differences.
- Evidence: 2026-10-22 defect register and dispatch reproduction.

### AP-013 - Finishing validation rejects legitimate coating weight gain

- Original finding: EXOS-AUD2-010. Priority: P2. Status: Unresolved rule; weight-basis decision required.
- Issue: Output cannot exceed input, so 1,000 kg of mill-finish material becoming 1,020 kg after coating is rejected.
- Impact: Legitimate finishing output cannot be posted honestly.
- Required resolution: Define mill-weight versus finished-weight accounting and approved coating-gain limits while preserving metal reconciliation.
- Evidence: 2026-10-22 defect register and finishing reproduction.

### AP-014 - Business dates and numbering still use UTC in multiple database functions

- Original finding: EXOS-AUD2-019. Priority: P3. Status: Confirmed, unresolved.
- Issue: About 30 functions use current_date rather than private.business_today(), including completion, packaging, cast-scrap and business-number year handling.
- Impact: Early-morning India records may use the previous date or wrong year boundary.
- Required resolution: Use the agreed business-date helper and verify midnight and financial/calendar-year boundaries.
- Evidence: 2026-10-22 defect register and captured function inventory.

### AP-015 - Purchased metal can be accepted at zero cost without a pending-rate control

- Original finding: EXOS-AUD2-020. Priority: P3. Status: Business decision and valuation control unresolved.
- Issue: Purchased source receipts do not require a rate/invoice or an explicit pending-rate state; audited receipts were at zero with no payable.
- Impact: Raw-material valuation and manufacturing cost may be understated.
- Required resolution: Agree provisional-rate handling and prevent unreviewed zero-cost receipts from silently becoming final costing inputs.
- Evidence: 2026-10-22 defect register and purchase-source analysis.

### AP-016 - Dormant generic CRUD clients can reintroduce direct business-table writes

- Original finding: EXOS-AUD2-021. Priority: P3. Status: Fixed and verified locally in .worktrees/codex-v1; release promotion/deployment pending.
- Issue found: Unrouted invoice, quality, inventory, die, customer and profile clients used MasterDataManager for direct insert, update and delete. The audit found no current imports, but reconnecting one could bypass the intended application RPC workflows; database guards already blocked many writes.
- Impact: A future route change could revive obsolete mutation paths and inconsistent workflow behavior.
- Resolution completed: Verified references and deleted all six unused clients together with their shared manager, which had no other consumers. No active application route was changed.
- Evidence: 2026-10-22 defect register, EXOS-AUD2-021. This is a latent source risk, not a demonstrated exploit through a currently routed page.
- Repair details: See the remediation log below.

### AP-017 - An operator machine-breakdown exception does not create a breakdown or lock the press

- Original finding: EXOS-AUD2-022. Priority: P3. Status: Business decision and workflow integration unresolved.
- Issue: operator_workflow_command inserts a production_exceptions row for machine_breakdown without creating a linked open breakdown_logs row or locking the machine.
- Impact: Production may continue to treat a reported broken press as available.
- Required resolution: Agree whether the exception creates a breakdown automatically or prompts an authorized user to do so.
- Evidence: 2026-10-22 defect register and operator-workflow function analysis.

### AP-018 - Opening inventory has no independent approval or required reason

- Original finding: IMP-2. Status: Unresolved approval/control gap.
- Issue: A production manager can create arbitrary opening quantities in inventory_items. The movement is journaled but lacks a required reason and independent approver.
- Impact: Opening balances can change materially without accountable approval.
- Required resolution: Introduce an appropriate reason, evidence and approval policy for opening balances.
- Evidence: 2026-10-22 audit improvement register.

### AP-019 - Deleting a customer can cascade through operational and portal history

- Related finding: EXOS-AUD2-006; customer retention remains separate from the profile repair. Status: Local migration implemented; verification and hosted application pending.
- Issue: Customer foreign keys cascade to portal_users, quote_requests, support_tickets and customer_compliance_requirements. The profile-delete restriction does not cover this customer path.
- Impact: Customer deletion can remove linked history instead of retaining or archiving it.
- Resolution in progress: Replace the four customer-history cascades with validated NO ACTION foreign keys. Referenced customers are deactivated rather than deleted; unreferenced customer deletion and the affected company-level cascades remain supported.
- Evidence: Read-only hosted foreign-key and delete-permission inspection during the historical reconciliation.

### AP-020 - Leaked-password protection is disabled

- Status: Unresolved security configuration.
- Issue: Supabase's live security advisor reports disabled leaked-password protection.
- Impact: Password selection lacks this additional compromised-password check.
- Required resolution: Enable the supported protection with scoped configuration authority and verify the resulting authentication behavior.
- Evidence: Live security-advisor result from the historical reconciliation. Other intentional definer-view/RPC advisor messages are not automatically classified as defects.

### AP-021 - Company GST identity and state information disagree

- Status: Unresolved business-data confirmation.
- Issue: The company GSTIN begins with state code 24 while the recorded state is Rajasthan and gst_state_code is blank.
- Impact: Tax/document identity and place-of-supply handling may use inconsistent company data.
- Required resolution: Confirm the actual registered GST identity and state, then correct records with approved business evidence.
- Evidence: Read-only hosted company data and the latest PDF handover. No tax-policy conclusion is inferred solely from this mismatch.

### AP-022 - Historical quote headers exist without quote lines

- Status: Unresolved commercial-data reconciliation.
- Issue: Quotes Q20260013 through Q20260016 have header totals but no lines; Q20260015 is marked converted_to_order.
- Impact: Itemized commercial evidence is missing even though totals or downstream state exist.
- Required resolution: Recover and reconcile the original quote/order evidence through a controlled correction.
- Evidence: Hosted records and latest PDF handover. The PDF route's missing-line 409 handling is already fixed; the underlying missing data is not.

### AP-023 - Legacy module switches do not consistently control the application

- Status: Unresolved control gap from the July workflow audit.
- Issue: company_settings enable_customer_portal, enable_inventory, enable_quality and enable_payments coexist with a separate feature_flags mechanism. The older settings are not consistently consumed by navigation, routes and APIs.
- Impact: An administrator can see a module switch whose operational effect is incomplete or inconsistent.
- Required resolution: Establish one authoritative module-control mechanism and enforce its intended visibility/access semantics.
- Evidence: PRACTICAL_WORKFLOW_AUDIT_2026-07-22 and subsequent settings/consumer reconciliation.

### AP-024 - Custom roles can be configured but are not usable throughout user access flows

- Status: Incomplete capability; canonical role enforcement remains in place.
- Issue: Role/permission APIs can save custom configuration, while invite/accept and access decisions still use fixed role sets.
- Impact: A saved custom role can appear ready but cannot be assigned or honored consistently.
- Required resolution: Either complete custom-role assignment and enforcement or clearly constrain configuration to supported behavior.
- Evidence: Historical role audit and current consumer/invitation reconciliation.

### AP-025 - Some task and dealer summaries are capped at 250 records

- Status: Unresolved completeness gap.
- Issue: TasksPage and dealer-overview queries use 250-row caps for datasets that influence totals, production/receipt information and delay/clarification summaries.
- Impact: Larger datasets can produce incomplete headline information.
- Required resolution: Use complete server-side aggregates or pagination suited to each display.
- Evidence: Historical workflow audit and source reconciliation. A dealer View Database path exists; the older claim that the database is unreachable is superseded.

### AP-026 - A heat cannot fully represent multiple source lots of the same type

- Status: Missing traceability capability.
- Issue: A heat has one scrap and one external-source link rather than a complete charge-line model for several lots of either type.
- Impact: Mixed-lot charge genealogy and allocation are incomplete.
- Required resolution: Add measured charge lines with source lineage and conservation checks if required by actual foundry practice.
- Evidence: ERP_AUDIT_1 and later foundry/data-model reconciliation.

### AP-027 - Procurement lacks a complete purchase-order, goods-receipt and three-way-match workflow

- Status: Missing capability.
- Issue: The full PO-to-receipt-to-supplier-invoice matching chain is not implemented.
- Impact: Purchasing, receipt acceptance and invoice approval cannot be reconciled through one complete control flow.
- Required resolution: Define and implement the approved procurement workflow with partial receipts, discrepancies and invoice matching.
- Evidence: ERP_AUDIT_1 capability assessment and later finance/procurement reconciliation.

### AP-028 - Manufacturing valuation is not a complete general-ledger and actual-costing system

- Status: Missing capability.
- Issue: General-ledger journals, WIP/finished-goods valuation and COGS reconciled to actual manufacturing cost remain incomplete.
- Impact: Expense payables and quote estimates do not establish full manufacturing profitability or inventory valuation.
- Required resolution: Agree accounting scope and implement traceable valuation/posting and reconciliation.
- Evidence: ERP_AUDIT_1 and finance deep-audit/remediation reconciliation.

### AP-029 - NCR and customer-complaint closure lacks a complete corrective-action process

- Status: Missing capability.
- Issue: Root cause, accountable owner, corrective/preventive actions, evidence and verified closure are not fully connected.
- Impact: A complaint or quality failure may be recorded without a complete accountable resolution.
- Required resolution: Complete the agreed NCR/complaint lifecycle. Existing rework and disposition controls should be retained.
- Evidence: ERP_AUDIT_1 and later quality/rework reconciliation.

### AP-030 - True downtime-based OEE is absent

- Status: Missing capability.
- Issue: Maintenance improvements do not provide a complete availability, performance and quality calculation from actual machine time and downtime.
- Impact: Displayed production or maintenance measures cannot be treated as verified OEE.
- Required resolution: Define the time/event inputs and calculation policy before publishing OEE.
- Evidence: ERP_AUDIT_1 capability assessment and later maintenance reconciliation.

### AP-031 - Customer advances and debit notes remain incomplete

- Status: Missing finance capability.
- Issue: Customer advances and debit-note workflows are absent or incomplete.
- Impact: These adjustments cannot be managed through a complete native finance lifecycle.
- Required resolution: Define posting, allocation, approval and reversal behavior. Existing payments, refunds and partial credit notes are not classified as absent.
- Evidence: ERP_AUDIT_1 and finance audit/remediation reconciliation.

### AP-032 - E-way bill handling is limited to manual references

- Status: Missing integration/capability.
- Issue: The system does not complete native e-way bill generation, validation and status integration.
- Impact: Users must rely on external generation and manual reference maintenance.
- Required resolution: Confirm integration scope and add the necessary generation, amendment, cancellation and status evidence.
- Evidence: ERP_AUDIT_1 and later dispatch/reference reconciliation.

### AP-033 - Tax coverage is incomplete beyond the supported domestic split

- Status: Missing capability and verification gap.
- Issue: Exports, SEZ, reverse charge, cess, e-invoice and GSTR workflows remain outside the proven implementation. Destination/place-of-supply cross-checks also need acceptance evidence.
- Impact: The existing domestic GST split must not be treated as acceptance of every tax scenario.
- Required resolution: Confirm supported transaction types and validate their business rules and outputs with authoritative business requirements.
- Evidence: ERP_AUDIT_1 and finance/PDF acceptance reconciliation.

### AP-034 - Several dedicated operational documents are missing or only partially covered by reports

- Status: Optional document capability pending scope confirmation.
- Issue: Dedicated customer payment receipts, delivery challans, packing/dispatch notes and NCR/quality certificates are incomplete or absent.
- Impact: Users may need external documents where a specific native transaction document is expected.
- Required resolution: Confirm which documents are required and connect each to authoritative transaction data. Existing PCDA dispatch and quality reports provide partial coverage.
- Evidence: ERP_AUDIT_1 and latest document/report reconciliation. This is not a claim that all such information is unavailable.

### AP-035 - The metal-disposition database repair is ahead of its application deployment

- Original finding: EXOS-AUD2-004. Status: Database fixed; application integration/deployment pending.
- Issue: The database guard is live in the 133-entry migration ledger, but the hold/release/return application workflow remains on audit2/wave1.
- Impact: Older status-edit UI can submit operations now rejected by database guards.
- Required resolution: Integrate and deploy the compatible application workflow, then perform signed-in operator acceptance.
- Evidence: 2026-10-22 wave-one status, branch comparison and hosted migration verification.

### AP-036 - Migration replay and audit repairs are split across release branches

- Related findings: A00 and EXOS-AUD2-007. Status: Partial integration and deployment reproducibility gap.
- Issue: The five previously untracked applied migrations are now committed, but the successful 219-check replay repair remains on fix/migration-chain-replay. Four audit-two migrations/application repairs are on a separate branch; two hosted-only trigger/index objects still lack full source reconciliation, and no hosted-ledger CI gate is established.
- Impact: A clean checkout and the intended release branch do not yet provide one fully reconciled reproduction of hosted state.
- Required resolution: Review and integrate the existing repairs, reconcile the remaining objects and enforce an appropriate ledger/replay gate.
- Evidence: MIGRATION_CHAIN_REPLAY_2026-10-22, wave-one status, branch history and hosted ledger. Earlier claims that those five migrations are still uncommitted are superseded.

### AP-037 - Latest PDF/report work still needs release and authenticated acceptance

- Status: Local checks passed; release/acceptance pending.
- Issue: Latest PDF, font, logo and report work includes uncommitted development changes. Local render, Unicode, pagination, arithmetic and font checks do not establish deployed authenticated/customer-safe document acceptance.
- Impact: The tested local implementation is not yet a fully accepted release using every actual source document.
- Required resolution: Preserve and review the latest changes, integrate them and verify representative deployed authenticated outputs.
- Evidence: Latest pdf fix.MD handover and development worktree state. Earlier BigInt/build failures were superseded by later successful checks.

### AP-038 - Complete signed-in operator and hosted workflow acceptance remains open

- Status: Acceptance gap.
- Issue: Production, finishing, QC, packaging, dispatch, configurator/dealer and the latest panels lack complete hosted/operator acceptance across roles and exceptions.
- Impact: Passing local checks cannot certify every deployed workflow.
- Required resolution: Run the remaining realistic signed-in workflows with the correct roles and preserve evidence.
- Evidence: Latest BUGS_MEGA acceptance records and audit-two boundaries. The later 84 local Auth/REST/Storage checks passed; the earlier blanket Docker/testing blockage is superseded.

### AP-039 - Independent-session concurrency coverage remains incomplete

- Status: Acceptance gap.
- Issue: Later acceptance includes 25 checks and six distinct backend races, but not every critical allocation/reallocation/issue/completion, press/die, finishing retry, reservation/cancellation/dispatch and new-guard interaction.
- Impact: Remaining races could violate stock or workflow invariants despite sequential correctness.
- Required resolution: Exercise the missing interactions with independent sessions against the intended release and database.
- Evidence: Local concurrency acceptance and audit-two verification boundaries.

### AP-040 - Physical stock, source documents and financial history are not fully reconciled

- Status: Physical/historical acceptance gap.
- Issue: Source-document quantities, kg/m/pieces, finishing/packaging/returns/vendor stock and financial/cash balances still require a complete real-world reconciliation.
- Impact: A clean technical reconciliation report cannot certify all historical business data.
- Required resolution: Reconcile the agreed physical and documentary baseline and approve traceable corrections.
- Evidence: BUGS-MEGA acceptance history, finance remediation and foundry-data reconciliation.

### AP-041 - Five entry-assistance features still await interactive visual acceptance

- Feature IDs: 23 paste, 41 quantity, 50 preview, 83 freshness and 90 foundry calculator. Status: Automated checks passed; visual acceptance intentionally pending.
- Issue: Browser/operator validation of these five features remains open in the latest entry-acceptance handover.
- Impact: Automation does not prove the final interactive behavior and usability.
- Required resolution: Complete the retained visual checks on the final implementation.
- Evidence: UPGRADE_EOS_ENTRY_ACCEPTANCE_RECHECK_2026-10-21.

### AP-042 - Production-volume performance is not proven within the database timeout

- Original finding: IMP-1. Status: Performance acceptance gap.
- Issue: The authenticated role has an 8-second statement timeout, while dashboard, reporting and reconciliation RPCs lack representative volume/concurrency evidence.
- Impact: Heavy real-world workloads may time out despite passing small-data correctness tests.
- Required resolution: Measure representative workloads and optimize confirmed bottlenecks before making performance claims.
- Evidence: 2026-10-22 audit improvement register and hosted role settings inspected during reconciliation.

### AP-043 - QC enforcement depends on complete numeric specifications and approved policy

- Status: Business configuration and acceptance gap.
- Issue: Profile weight/hardness enforcement needs required numeric specifications; free-text hardness is not parsed and unspecified profiles receive limited enforcement.
- Impact: A quality workflow can exist without sufficient data to enforce all expected limits.
- Required resolution: Confirm approver policy, populate approved specifications and verify both specified and unspecified profile behavior.
- Evidence: ERP and quality-remediation acceptance reconciliation.

## Source Locations

- The authoritative October 22 register is audit-output/EXOS_ERP_AUDIT_2026-10-22/02_DEFECT_REGISTER.md in .worktrees/audit2-wave1.
- Later closure and deployment evidence is in the same audit package's wave-one status and the migration ledger checked during the historical reconciliation.
- Earlier sources include CODEBASE_AUDIT.md, docs/PRACTICAL_WORKFLOW_AUDIT_2026-07-22.md, FIXES-CLAUDE.md, AUDIT_ASTRA_1_REMEDIATION.md, the October audit/remediation reports, ERP_AUDIT_1.md, finance deep-audit/remediation records, BUGS-MEGA.md, current acceptance/handover records, the migration replay record and pdf fix.MD.
- Evidence above records the completed reconciliation checkpoint. A later source edit, migration or deployment needs its own verification before status changes.

## Remediation Log

### Selected Repair - AP-016 / EXOS-AUD2-021

- Selection reason: A small, source-only deletion explicitly recommended by the audit, subject to checking references. It needs no hosted migration or business-data correction.
- Exact issue: Six obsolete module clients exposed generic direct table mutations through MasterDataManager. They were unrouted, so retaining them created a future reintroduction risk rather than a confirmed active route exploit.
- Reference verification: The code graph and a direct search of the development application, components, libraries, tests, scripts and types found no consumers of the six legacy clients. MasterDataManager had exactly those six consumers. Historical audit documents and source manifests are retained as evidence of earlier checkpoints.
- Fix implemented: Deleted components/modules/customers-client.tsx, dies-client.tsx, invoices-client.tsx, inventory-client.tsx, profiles-client.tsx and quality-client.tsx, plus the now-unused components/modules/master-data-manager.tsx. This removes its generic insert/update/delete implementation rather than leaving a reusable obsolete mutation path behind.
- Existing test updated: tests/admin-command-center-practicality.test.mjs now checks the active financials/payment-form-client.tsx in its business-calendar consumer list instead of trying to read the deleted invoice client. The routed invoice form remains components/modules/financials/invoice-form-client.tsx; no active route was changed.
- Implementation status: Completed in the .worktrees/codex-v1 working copy based on HEAD a19b2b0, with the pre-existing dirty work preserved. The full 43-item list was created before implementation. The seven deleted files and updated test had no pre-existing modifications.
- Reference and diff checks: No remaining legacy-client/manager references in executable source or tests. The task-owned code diff contains seven deleted files and one test-path replacement; git diff --check passed. The build-generated next-env.d.ts path change was restored to its original value.
- Focused tests: node --no-warnings --test --experimental-strip-types tests/admin-command-center-practicality.test.mjs passed 8/8.
- Lint: npm run lint passed.
- Typecheck: npm run typecheck passed.
- Production build: NEXT_DIST_DIR=.next-build npm run build passed, including all 160 static pages and compilation of the existing module routes.
- Full regression suite: npm test passed 2,077 tests across 76 suites, with 0 failures, 0 cancelled and 0 skipped. The complete passing run took 625,877.5701 ms. These totals describe this development working copy, including its pre-existing changes; they are not a clean-release or hosted-acceptance claim.
- Verification environment: The first build attempt could not download the existing Google font under restricted network access; the unchanged build passed with network access. The first full-suite attempt was interrupted after sandbox-specific missing Chromium and localhost-access failures. The complete passing retry used the installed host Chromium and isolated local test fixtures. No application-font or browser-test configuration was changed.
- Manual review: Checked incoming references and the generic manager's direct mutations before deletion. No new browser UAT was needed for an unrouted source removal; the existing browser regressions ran in the full suite.
- Database/RLS/configuration changes: None.
- Release status: Locally fixed and verified. The source edits are uncommitted in codex/v1 and have not been promoted to main or deployed. The root checkout's existing fix/migration-chain-replay branch and unrelated dirty work were retained. No database, hosted configuration or business data was changed.

### Second Repair - AP-019 / Customer History Retention

- Selection reason: Four foreign-key deletion actions can be corrected without changing customer data, roles or RLS policies. The existing profile-retention repair establishes the same NO ACTION approach for preserving history while allowing statement-wide company cascades.
- Exact issue: Deleting a customer could automatically erase portal_users, quote_requests, support_tickets and customer_compliance_requirements. A read-only hosted catalog check on 2026-10-22 reconfirmed that all four customer foreign keys still use ON DELETE CASCADE, while their company foreign keys also cascade.
- Fix implemented: Added supabase/migrations/20261022140000_customer_history_retention.sql in .worktrees/codex-v1. It replaces those four customer foreign keys with validated, non-deferrable ON DELETE NO ACTION constraints inside one transaction with a five-second lock timeout. It changes no rows and retains existing company-level foreign keys.
- Expected behavior: A referenced customer delete fails atomically with SQLSTATE 23503, leaving the customer and all linked history intact. The existing is_active deactivation path remains available. Unreferenced customers can still be deleted; the affected company cascade paths can still remove their customer and children in one statement.
- Tests added: tests/customer-history-retention.test.mjs reads the four original table definitions, reproduces the original cascading data loss, and checks each repaired relationship, full-history and bulk-delete rollback, deactivation, unreferenced deletion, missing-customer inserts/updates, affected company cascades, preservation of existing rows and migration replay.
- Verification completed so far: All 14 focused PGlite tests passed, including reproduction of the original data loss, each individual foreign key, atomic bulk-delete rollback, preservation of existing rows and safe replay. npm run lint and npm run typecheck passed. NEXT_DIST_DIR=.next-build npm run build passed, including all 160 static pages. The full npm test regression suite is running with access to installed host Chromium and isolated local fixtures.
- Security/data boundary: No grants, RLS policies, authentication settings or hosted data have been changed. Tests use isolated local PGlite databases; their results will not be presented as hosted JWT/RLS or deployment acceptance.
- Release status: Local implementation only. The migration has not been applied to the hosted database, and source edits remain in the existing codex/v1 working copy. Other audit findings and pre-existing work are preserved.


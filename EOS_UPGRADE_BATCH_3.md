# EOS upgrade batch 3

Date: 28 October 2026. Continuation of the interrupted ten-feature goal in this chat.
Catalogue: `UPGRADE_EOS.md` (the original request called it EOSUPGRADE.md).
Implementation checkout: `.worktrees/codex-v1`, branch `codex/v1`.

## Delivered scope

| Feature | Result and entry point | Meaningful verification |
| --- | --- | --- |
| 57 Customer requirements | Existing compliance master extended with stages/revisions; customer maintenance pages, order review and inline production/quality/packing/dispatch panels; real workflow guards | Changed requirements invalidate prior acknowledgements; cross-company/role refusals; direct inserts already dispatched; immutable snapshots |
| 61 Task blueprints | `/tasks/blueprints`; eight-part task format; start prerequisites; routed exceptions | Start through ordinary task writes; missing/changed source; handoff precedence; optimistic revisions; unassigned-task permission regression |
| 65 Guided execution | `/tasks/[id]/execute`; reviewed execution rules for each published version; ordered steps and retained attempts | Step order; stale browser; durable resume; direct task-completion and dealership-scope bypass; reopened and reassigned attempts; mounted phone completion |
| 66 Approved branches | Measurement ranges in execution rules; inclusive accepted range; outside range routes independent review and rework | Boundary values; NaN/missing values; no replacement before rework; independent reviewer; retained original measurement |
| 68 Transaction evidence | Related-record choices with accepted states; tenant, role and lineage checks; source locks and final revalidation | Unrelated/foreign source; reversal before completion; real schema and existing task triggers; mounted record selection |
| 70 Risk verification | Normal/elevated role matrix in reviewed execution rules; `/tasks/verification`; verified/returned findings retained as events | Self-verification refusal; late risk and queue-routing changes; sticky measured exception; evidence invalidation; chosen-step correction and fresh downstream evidence |
| 77 SOP versions | `/tasks/procedures/[id]/versions`; historical version detail; independent release, effective dates, in-flight policy, historical bindings and qualification-version capture | Self-review; nullable backup; stale edits; same-day/future releases; matching rules for a release effective at task start; completed/reopened tasks; new instructions reduce older qualification to supervised |
| 78 Recovery | `/tasks/[id]/assurance`; printable continuity instructions, numbered paper observations, independent reconciliation | Exact retry; ambiguous duplicate; unique paper reference and unique matched transaction; real observation time; no stock or financial posting |
| 79 Observed work | Supervisor observes another employee's active execution and submits every step plus employee feedback | Exact instruction version; incomplete/duplicate observations; independent owner review; immutable findings; revise decision creates a traced controlled improvement |
| 80 Effectiveness | `/tasks/procedures/[id]/effectiveness`; step flags, controlled trials, reviewed releases and frozen before/after outcomes | Missing durations; explicit denominators; small samples; nullable backup; trial/release/measurement lifecycle; mounted flags and outcome screens |

Execution and verification deliberately cover internal SOP tasks. Measurement decisions support continue versus independent review/rework. Recovery records observations and reconciles existing confirmed transactions; it is not a disconnected inventory or finance posting engine.

## Recovery and source preservation

The pending source was in `.worktrees/eos-calc` at `0228e59`, including the two earlier uncommitted feature batches and the incomplete third batch. Current project instructions identify `codex/v1` as the development checkout. `scripts/recover-upgrade-work.mjs` performed a dry-run three-way recovery against `8b4a63d`, normalized line endings for comparison, and recovered 331 files with no merge conflicts. It also reconciled 70 historical migration paths using the root checkout's later migration-chain fixes. The old checkout remains intact.

Previous destination files and a manifest are retained under:
`C:/Users/arnav/.codex/visualizations/2026/10/22/01a16507-8c06-76f0-bd13-0c1d613c46a6/upgrade-recovery/`.

Existing PDF/report changes, customer-history-retention work and deleted unused legacy components in the development checkout were preserved. The customer-history test's old migration filename was updated to the reconciled name. The existing allocation browser fixture now gives navigation a separate 15-second budget, retaining the tests' shorter interaction assertions. Root layout uses the already-installed Jakarta font files so production builds do not depend on a Google Fonts request; its family and weights are retained.

The root checkout currently uses `fix/migration-chain-replay`, not `main`, and contains unrelated local edits. This batch has not switched that checkout, committed unrelated work, pushed, or changed the hosted database.

## Database and security

New batch migrations, after the previous feature batches:

- `20261022390000_procedure_versions.sql`
- `20261022400000_task_blueprints.sql`
- `20261022410000_procedure_effectiveness.sql`
- `20261028010000_guided_sop_execution.sql`
- `20261028020000_sop_recovery_and_observation.sql`
- `20261028030000_customer_step_requirements.sql`
- `20261028040000_sop_qualification_versions.sql`

All new business tables carry company identity, company indexes and RLS. Direct authenticated/anonymous table access is revoked; projection/mutation RPCs derive identity, company and active role from the authenticated session. Security-definer functions pin the search path; private helpers are not executable by clients. Dealers cannot use the internal workflows. Financial transaction evidence also checks business role. No service credential is used by browser code.

Customer requirements reuse the existing compliance master, its existing role policies and history-retention rules. Requirement acknowledgement does not claim a measurement passed: existing inspection, production and dispatch rules remain authoritative. Mandatory requirements can block a company's next transition after rollout until current revisions have been reviewed.

## Audit and fixes

- Fixed nullable-backup permission predicates in SOP writing/review and effectiveness review. SQL NULL can no longer authorize an unrelated employee or break a boolean response contract.
- Fixed the equivalent unassigned-task exception permission and added explicit negative tests.
- Rejected dealer roles even when their dealership assignment is absent, in both the server actions and all six new workflow RPCs.
- Closed the task-created-already-completed route around guided execution. Ordinary task edits also enforce the procedure.
- Prevented company/dealership changes to a task with recorded instructions, so a scope edit cannot escape its guards.
- Reordered procedure/version locking to read fresh state after waiting. Execution starts apply any scheduled instruction release before selecting that version's reviewed rules.
- Made evidence retries exact by request identity and payload; source company, relationship and state are rechecked, with deterministic source locks at submit/verify/complete.
- Filtered eligible transaction evidence before applying the ten-option limit, so older pending inspections cannot hide an approved inspection later in the source set.
- Retained every out-of-range reading. Independent rework is a new event, not an edit of the old measurement. A new observation invalidates earlier verification.
- Rechecked risk before completion and retained elevated risk after an exception. A performer cannot verify their own work.
- Recomputed the effective review role in the queue and operator view after a risk change. Return decisions retain their finding and identify the first step to redo; that step and downstream steps require new evidence. Verification decisions remain in an immutable event history.
- Kept a prior employee's attempt and evidence intact when an assignment changes; the new assignee starts a separate attempt. Reopening/resuming rechecks start prerequisites.
- Kept recovery notes immutable and prevented two paper references from reconciling the same authoritative transaction.
- Locked the authoritative source before rechecking its confirmed state during recovery reconciliation. A reversal that wins before that lock now leaves the recovery note pending.
- Guarded customer-requirement upserts with the originally loaded record, company, customer and expected revision. A competing insert cannot inherit an earlier ownership check or overwrite the winning record. Three deterministic insert-interleaving regressions failed before this guard and pass with it.
- Required observations for every instruction, another employee as subject, and independent process-owner review. Revision recommendations enter the controlled improvement workflow.
- Connected independent qualification to released instruction identity as well as procedure metadata revision. A scheduled version is assessed by its actual effective date.
- Counted missing/invalid durations as unavailable evidence; insufficient duration samples cannot be labelled comparable. Before/after differences do not establish causation.
- Added server-side search, filters, sorting and ten-row pagination to the blueprint directory, verification queue and customer/order requirement lists. Filtered requirement edits load the exact record instead of assuming its page position is unchanged.
- Rejected null transaction states, string-valued measurement limits and unrecognized step keys at the database boundary. A cache-refresh failure no longer changes a confirmed mutation into a reported failure.

## Files and tests

New UI routes: task execution, assurance and verification; SOP versions, execution-rule configuration and effectiveness; customer requirements and order-stage requirement review. New reusable components live in `components/modules/tasks/` and `components/modules/orders/`; command schemas and shared rules are in `lib/workflow/`, with authenticated server actions in `lib/actions/`.

Existing task, procedure, customer, order, production, quality, packaging and dispatch pages were linked to these workflows. The old feature handovers remain the inventory for the recovered batches 1 and 2.

Focused coverage is in `procedure-version*`, `task-blueprint*`, `procedure-effectiveness*`, `guided-sop*`, `sop-assurance-sql`, `customer-step-requirements-sql`, `sop-server-actions`, and `sop-upgrade-browser` tests. `migration-chain-replay.test.mjs` additionally exercises real-schema execution and qualification invalidation under the full trigger chain. Browser screenshots are in `docs/evidence/EOS_UPGRADE_BATCH_3/`.

Batch 3 files added, grouped by purpose (the recovered earlier batches retain their own handover inventories):

- Domain modules: `lib/workflow/procedure-versions.ts`, `task-blueprints.ts`, `procedure-effectiveness.ts`, `guided-sop.ts`, `customer-step-requirements.ts`.
- Server actions: the same five domains under `lib/actions/`, with assurance sharing `guided-sop.ts`.
- Task components: `components/modules/tasks/procedure-versions.tsx`, `task-blueprints.tsx`, `procedure-effectiveness.tsx`, `guided-sop.tsx`, `sop-assurance.tsx`, `work-list-controls.tsx`.
- Order components: `components/modules/orders/customer-requirements.tsx`, `work-requirements-panel.tsx`.
- Routes: `tasks/blueprints` (directory, detail, new/edit), `tasks/[id]/execute`, `tasks/[id]/assurance`, `tasks/verification`, `tasks/procedures/[id]/versions`, `tasks/procedures/[id]/versions/[versionId]`, `tasks/procedures/[id]/versions/[versionId]/execution`, `tasks/procedures/[id]/effectiveness`, `customers/[id]/requirements`, `customers/[id]/requirements/new`, `orders/[id]/requirements`, all under `app/(dashboard)/`.
- Fixtures: `scripts/lib/procedure-version-fixture.mjs`, `task-blueprint-fixture.mjs`, `procedure-effectiveness-fixture.mjs`, `guided-sop-fixture.mjs`, `sop-upgrade-browser-fixture.mjs`.
- Tests: `tests/procedure-version-sql.test.mjs`, `procedure-version.test.mjs`, `task-blueprint-sql.test.mjs`, `task-blueprint.test.mjs`, `procedure-effectiveness-sql.test.mjs`, `procedure-effectiveness.test.mjs`, `guided-sop-sql.test.mjs`, `guided-sop.test.mjs`, `sop-assurance-sql.test.mjs`, `customer-step-requirements-sql.test.mjs`, `sop-server-actions.test.mjs`, `sop-upgrade-browser.test.mjs`.
- Recovery/evidence helpers: `scripts/recover-upgrade-work.mjs`, `scripts/verify-upgrade-source.mjs`; seven migrations listed above; this handover and browser evidence.

Existing files modified for integration: task overview/detail; customer/order detail; production/quality/packaging/dispatch detail; `components/modules/operations/collaboration-tools.tsx`; `lib/actions/department-handoffs.ts` and `production-holds.ts` for guard messages; `app/layout.tsx` for local font loading; the catalogue; migration replay and customer-history tests; the allocation browser fixture's navigation timeout. Build-generated type paths were updated by Next. The recovery manifest records the broader prior-batch reconciliation separately.

## Verification evidence

Final source checkpoint results, including the last audit fixes:

- Feature-specific coverage comprises **105 cases**, including eight browser flows at 375 px and 1280 px. All are included in the final full-suite run below. The earlier 101-case focused baseline remains in `test-upgrade-batch3.log`; four additional audit regressions cover competing requirement inserts and recovery source locking.
- Fresh schema: **251/251 files** (two baseline files plus 249 migrations). The real-schema test completes a task through the existing trigger chain, checks qualification invalidation on a new release, validates RLS/no direct client access for 18 new tables, and checks anonymous/authenticated RPC and private-helper privileges. The post-audit focused replay and affected SQL suites passed **16/16 cases**, and the final full suite also includes these checks.
- `npm run lint`: exit 0, no warnings. `lint-upgrade-final-audit.log`.
- `npm run typecheck`: exit 0. `typecheck-upgrade-final-audit.log`.
- `NEXT_DIST_DIR=.next-upgrade-verify npm run build -- --webpack`: exit 0; **186/186 pages** generated successfully, including the new workflow routes in the completed build. `build-upgrade-final-audit.log`. The separate generated output directory avoids contention with the existing local build. Next's generated type includes use that directory.
- `PLAYWRIGHT_BROWSERS_PATH=C:/Users/arnav/AppData/Local/ms-playwright npm test`: exit 0; **2,604 tests passed across 76 suites**, zero failed/skipped/cancelled/todo; 589.3 seconds. `test-upgrade-final-audit.log`.

Sandboxed browser checks could not reach localhost; all eight passed after allowing the local fixture runtime. A sandboxed build stopped with Windows EPERM while creating generated output; the same build passed with the required filesystem access. The final browser runs point `PLAYWRIGHT_BROWSERS_PATH` to the installed browser cache. The history-retention fixture was updated after the historical migration filenames were reconciled. No business assertions were removed to obtain passing results. The new race regressions model deterministic statement interleavings in single-session PGlite; they do not establish independent-session contention behavior. Scoped diff/whitespace checks pass; unrelated pre-existing PDF handover whitespace was left intact.

Screenshots `guided-phone.png`, `customer-requirement-phone.png` and `execution-rules-desktop.png` were rendered and inspected. They use the actual shared UI styles and installed Jakarta font, with no phone-width overflow in the tested flows.

The final source checkpoint contains 1,333 source/configuration files. `node scripts/verify-upgrade-source.mjs` reports SHA-256 `e0d4f0edf802d196e08e254be958edfa2102f7b5597c6b291fcdea1a7f0cd644`. It was checked again after the full suite completed and remained identical. The checkpoint excludes generated build outputs, credentials and evidence files. Verification logs and this handover are evidence artifacts, not part of the product-source digest.

## Rollout acceptance

Local SQL/PGlite, mounted browser and build evidence do not certify hosted deployment. No hosted migration or production transaction was performed. The historical filename reconciliation proves fresh-schema reproducibility; do not replay renamed historical files blindly against a live migration ledger. Before production acceptance, reconcile the hosted ledger, apply only its reviewed missing dependency chain, and test with real employee/dealer JWTs; verify RLS and storage independently; rehearse two independent database sessions for contention; confirm the company's measurement limits, verification roles and permitted outage work with process owners.

Manual acceptance sequence: publish instructions using two people; release execution rules using two people; start an assigned task; observe an out-of-range measurement and independent rework; select a related confirmed transaction; submit to the designated verifier and complete; reopen and confirm a new attempt; revise a customer requirement and check acknowledgement invalidation; reconcile a numbered outage note; review an observed trial and trace its improvement through the next release and measured outcome.

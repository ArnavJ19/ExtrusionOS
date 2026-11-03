# November Upgrade Batch 4

Date: 3 November 2026 (Asia/Kolkata)
Catalogue: [NOV_UPGRADES.md](NOV_UPGRADES.md)
Base commit: 7e8e889 (branch fix/nov-verification)
Working branch: feat/nov-batch-4 (uncommitted at the time of writing)
Delivery state: ten bounded U1/N1 slices implemented and locally verified against the full
replayed migration chain. Hosted migration, deployment and employee acceptance remain separate gates.

## Selection and gap audit

These are the next ten first-priority (U1), essential (N1) entries after batches 1 to 3, in
catalogue delivery-rank order 31 to 40. All are rated C4, so each is a deliberately bounded
pilot slice on top of an existing foundation, not the full catalogue target.

| ID and idea | Foundation found | Gap closed in this slice | Edge evidence |
| --- | --- | --- | --- |
| NOV-005 connected order workspace | Per-line production, packed and departed kg (`order_partial_progress`) | One ledger per order line adding production holds, QC-held stock, delivered and returned kg, remaining to depart, per-source availability and an as-of time. Shown on the order page and in controls. | Multi-line order, two dispatches, legacy packing without a line, a return, an active hold, QC hold stock, over-departure, an unreadable source (reported unavailable, not zero), foreign tenant, dealer |
| NOV-007 carry known information | Jobs copy order-line facts at creation | Compares 12 technical/packing facts on each live job with its current order line. Unstarted jobs can be refreshed by review; started jobs keep the facts they were made with; deliberate differences are recorded and resurface if the line changes again. | Unstarted vs started vs unlinked jobs, numeric scale equality, stale review after a second line change, recorded override then new change, role denial, foreign job |
| NOV-013 dependable drafts | Dispatch-only device draft | Generic draft lifecycle (`lib/forms/form-draft.ts`, `useFormDraft`) applied to new quality, packaging and machine records in the shared operational form. Scoped to company and employee, versioned, 3-day expiry, cross-tab revision guard, explicit discard reasons, never stores rate/amount/tax fields, cleared only after a confirmed save. | Reload restore, rate excluded and tampered rate not restored, uncertain save keeps the draft, second tab conflict, other employee, expired, future-dated, older format, unreadable, oversized text |
| NOV-015 handoffs as part of completion | Event-derived handoffs with acceptance and returns | Source corrections and withdrawals after a handoff was raised: unaccepted work follows corrected quantities or is cancelled with the reason kept; accepted work keeps its owner and gets one open source review that blocks completion until the receiving team resolves it; work cancelled by reconciliation reopens if its source stands again. | Quantity correction before and after acceptance, finishing rejection, order cancellation and reopening, replay without duplicate reviews, wrong team, manual cancellation preserved |
| NOV-022 shortage to purchasing plan | Billet shortage per order, purchase lines and receipts | Billet purchasing plan by alloy and diameter: shortage demand netted once against free available batches and confirmed open purchase supply; lead time, minimum order, pack size and safety stock applied separately; plan lines explain affected orders; regenerating marks old proposals obsolete; inventory reviews each proposal. No purchase order is created. | Partial receipts, draft PO as tentative only, non-kg line refused, duplicate link, batches without diameter warned, undated orders warned, stale plan rejected, cancelled orders excluded, accepted lines kept |
| NOV-028 WIP by location and age | Job, hold, finishing, inspection, packaging events | Derived WIP stage per started job (at press, on hold, awaiting finishing, at vendor, awaiting QC, QC released awaiting packing) with stage entry time, age and quantity basis, plus recorded physical location observations that never change processing status. | Planned and foreign jobs excluded, QC approval and packing move the stage, vendor issue, hold without recorded output (quantity unknown), invalid and foreign locations, oldest-first sort |
| NOV-031 finishing vendor material account | Finishing issue, receipt and rejection weights | Per-issue vendor custody: issued, accepted back, rejected back, explained differences (returned unprocessed, agreed process loss, lost with claim) and unaccounted balance, with ageing against configured lead times. Explanations are reversible but never edited. | Over-explanation refused, loss before receipt refused, over-receipt flagged, reversal and double reversal, duplicate commit, role and read restrictions |
| NOV-042 role decision authority | Exception policies, approvers, self-approval block | Versioned approval ceilings by role with effective time, enforced by a trigger on every write path, binding each approval to the revision, role, exposure and ceiling. Owners are never limited. A readable authority view shows what each role can request and approve. | Above/below limit, owner approval, missing exposure, future revision not yet in force, backdating, owner limit, wrong role for decision, non-admin publisher, inactive policy warning |
| NOV-051 definition of done | Completion criteria templates, evaluation and checks | Numbered completion contracts published from active criteria; new tasks are bound to the revision in force; an exclusive contract stops one source record completing two tasks of the same kind (update and insert paths, serialized with an advisory lock); unpublished template changes are visible. | No criteria, before/after publication, exclusive vs non-exclusive, insert-as-completed, revision 2 with open work on revision 1, invalid task kind, role |
| NOV-057 process changes reach people | Versioned procedures, release, in-flight policy, task bindings | Each release records a rollout; a manager can require acknowledgement; assigned employees must acknowledge before starting or completing bound work; coverage shows affected tasks, employees and acknowledgements and work still on earlier versions. | Non-latest classification refused, older-version work unaffected, unassigned task started by another employee, duplicate and viewer acknowledgement, withdrawn version, release through the existing procedure command |

## Per-feature recheck, verification, edge tests and audit

Each feature was checked on its own against its catalogue section. The edge-test count is the
feature's tests run on their own (`--test-name-pattern=NOV-0xx` over the SQL and domain suites);
all passed.

| ID | Recheck against the catalogue | Verified by | Edge tests | Audit finding and fix |
| --- | --- | --- | --- | --- |
| NOV-005 | Steps 1, 2, 4 and 5 for line-attributed sources; step 3 (new line identity) already existed on packing rows | Ledger read and order-page panel; browser ledger screen | 5 | No code defect found; a test wrongly expected the other company's owner to see no orders and was corrected |
| NOV-007 | Steps 2 to 4 for production jobs; issued-document snapshots untouched | Refresh and keep actions; stale-review rejection | 3 | No code defect found; refusals for started jobs confirmed to happen before any request is recorded |
| NOV-013 | Steps 1 to 5 for three forms; production excluded with the reason stated | Real hook in the browser: reload, two tabs, other employee | 2 + 2 browser | Production planning removed from the pilot after reviewing its order-line autofill; oversized text is kept on the page only (test corrected) |
| NOV-015 | Steps 1 to 5 for the reachable source changes | Triggers on finishing, jobs and orders; completion guard | 5 | Tied timestamps made "latest review" ambiguous; now uses clock time |
| NOV-022 | Steps 1, 2, 3 and 5 for billets; step 4 is reviewable plan lines, not purchase orders | Plan generation, review, regeneration | 3 | Plan results linked to a page that does not exist; links now open the plan database |
| NOV-028 | Steps 2, 4 and 5; step 1 (location hierarchy) uses existing locations; step 3 by observations | Stage read model; observation action in the browser | 2 + 3 browser | No code defect found |
| NOV-031 | Steps 1, 2, 3 and 5; step 4 kept out of scope (material only) | Custody read model; explain/reverse actions in the browser | 2 + 1 browser | Expected return showed the sent date without a lead time; now unknown |
| NOV-042 | Steps 1 to 5 for the two existing exception decisions | Trigger on every approval write; publishing in the browser | 3 + 1 browser | Approvers saw a generic error when blocked, and the authority link pointed to a missing page; both fixed |
| NOV-051 | Steps 1, 2, 4 and 5; step 3 reuses the existing evidence evaluation | Binding on insert; exclusivity on update and insert | 3 | Insert-as-completed bypassed exclusivity, and the result link pointed to a missing page; both fixed |
| NOV-057 | Steps 1 to 5; notification is the in-app rollout view, not a message | Release trigger through the existing procedure command; start/complete guard | 3 | A table alias collided with a variable on classification; renamed |

Lint, typecheck, the full suite and the production build were run once, at the end, because the
project instructions (CLAUDE.md section 12) require them before reporting completion. They were not
run during feature work.

## Scope and operating boundaries

- Entry point: /tasks/control, linked from Tasks. Overview, ten-row server-paginated databases,
  create pages and detail/history pages are separate. The order page shows the NOV-005 ledger.
- Every action uses the same reviewed protocol as batch 3: a persisted request identity, a
  server-generated review bound to a source fingerprint, 15-minute expiry, and only a confirmed
  database outcome counts. A refused preview records nothing and releases the request reference.
- NOV-005 aggregates each source separately. Departure uses the existing actual-dispatch time; a
  legacy dispatch marked delivered without that time counts as delivered but not departed. Returns
  never reduce departed kg or create new entitlement. Rows without a line stay unlinked.
- NOV-007 compares technical and packing facts only. Quantities, prices and status are never
  copied. Existing production guards still run on every refresh.
- NOV-013 production planning is excluded: its order-line autofill and billet selection must be
  derived again from live sources. Billet and packaging-material selections are not in drafts.
  Edit forms keep no draft.
- NOV-015 follows the existing eligibility rules: finishing in received/completed, approved
  inspections, completed packaging and live orders. Approved inspections and completed packaging
  are immutable, so the reachable reconciliation paths are finishing corrections or rejection,
  production job cancellation and order cancellation, closure or reopening.
- NOV-022 pilots billets only. Free stock means available billet batches with a recorded diameter
  within 1 mm of the requirement. Purchase supply counts only lines explicitly linked to a billet
  group and measured in kg. It creates no purchase order and no stock.
- NOV-028 ends WIP when QC-released kg is packed; finished packed stock and dispatch are shown by
  the order ledger. Location observations are evidence, not a movement ledger.
- NOV-031 is material only; vendor rates, charges and claims stay in their workflows. Rejected kg
  is treated as received back from the vendor, as the finishing receipt records it.
- NOV-042 pilots the two existing exception decisions. The existing policy still decides who may
  approve at all.
- NOV-051 binds new tasks to the revision; tasks keep their copied criteria as before.
- NOV-057 acknowledgement records that a change was read. It does not certify competence and does
  not grant qualifications. No external notification is sent.

## Data and security audit

Migration: supabase/migrations/20261103200000_november_operations_control.sql. It is additive and
has not been applied to a hosted database.

New tables: inherited_fact_overrides, handoff_source_reconciliations, procurement_policies,
procurement_supply_links, procurement_plan_runs, procurement_plan_lines, wip_location_observations,
finishing_custody_adjustments, decision_authority_revisions, decision_authority_bindings,
completion_contracts, task_contract_bindings, procedure_rollouts, procedure_acknowledgements,
control_requests and control_events. Composite tenant foreign keys validate linked records.

Every new table enables RLS, revokes direct writes and grants tenant- and role-scoped reads; dealer
sessions are denied. History is projected only through the authorized detail command. Company and
actor come from the authenticated session. All functions pin search_path; private helpers are not
executable by anon or authenticated users.

New triggers on existing tables: finishing_jobs, production_jobs and orders (handoff source
reconciliation), exception_requests (approval ceilings), tasks (contract binding on insert;
completion and acknowledgement guard on update) and procedure_versions (rollout on release). They
act only on the specific transitions described above.

## Verification

| Check | Result |
| --- | --- |
| Migration chain replay (PGlite) | Applies cleanly after all existing migrations |
| tests/nov-batch4-sql.test.mjs | 22 scenarios passed: all read models, every action, RLS and the shared protocol |
| tests/nov-batch4.test.mjs | 7 passed: input contracts, role mirrors, draft lifecycle, real server action boundaries (150 generated remaining-quantity cases) |
| tests/nov-batch4-browser.test.mjs | 8 passed at 375 px: real components, real action and replayed SQL; phone screenshots in docs/evidence/NOV_UPGRADES_BATCH_4 |
| npm run typecheck | Passed |
| npm run lint | Passed with no warnings or errors |
| npm test | Passed: 3,000 tests, 76 suites, 0 failures or skips; tests.txt |
| npm run build -- --webpack | Passed in .next-upgrade-verify, including the four /tasks/control routes; build.txt |

Local PGlite runs one connection, so competing-session races are argued from row locks, the tenant
advisory lock and the done-rule advisory lock, not proven against independent sessions.

## Remaining acceptance

Apply the migration to staging after reconciling the hosted ledger. Pilot with real users: an order
with partial dispatch and a return; a drawing revision changed after planning; an interrupted
inspection entry; a finishing receipt corrected after QC accepted it; one billet group with a real
supplier lead time; a shift walk recording WIP locations; one vendor's month-end material
statement; one approval limit; one task kind's definition of done; and one packing instruction
change requiring acknowledgement.

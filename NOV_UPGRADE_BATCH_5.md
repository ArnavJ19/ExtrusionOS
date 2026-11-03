# November Upgrade Batch 5

Date: 3 November 2026 (Asia/Kolkata)
Catalogue: [NOV_UPGRADES.md](NOV_UPGRADES.md)
Base: feat/nov-batch-4 working tree (batch 4 uncommitted at the time of writing)
Delivery state: ten bounded slices implemented and locally verified against the full replayed migration
chain. Employee acceptance remains a separate gate. Hosted migration state is recorded below.

## Selection

The last four first-priority entries (NOV-062, 069, 076, 034: delivery rank 41 to 44) and the first six
planned-next essential entries (NOV-055, 070, 026, 030, 033, 038: rank 45 to 50). All are C4 or C5, so
each is a bounded pilot on an existing foundation, not the full catalogue target. The migration does not
depend on earlier November batches.

| ID and idea | Foundation found | Gap closed in this slice | Edge evidence |
| --- | --- | --- | --- |
| NOV-062 drawing approval | `technical_drawings`, drawing review rows; status buttons on Documents changed only screen state | Immutable revisions with file SHA-256 (computed on the device), customer submission, query, approval (named person and evidence) and rejection as separate events, release for manufacture with one released revision per profile, supersession, permitted per-job deviations, and a guard so a job first starts only on the released revision. The Documents page now links to this workflow instead of the local-only buttons. | Same label, same file, approve before submit, approval without contact, release before approval, wrong role, later release supersedes, old-revision start blocked, deviation date limit, job keeps its revision, foreign tenant |
| NOV-069 incoming acceptance | Purchase receipt lines with received, accepted, rejected and held quantities; no link to stock | Quality decisions on every portion not refused at the gate (accept needs a mill certificate; concession only for factory manager, admin or owner; reject), physical return to supplier, reversal for retest, and release of accepted kg into a new available billet batch linked to the receipt line. | Missing certificate, over-decision, concession by quality, over-release, retried commit, duplicate batch, reversal after release, over-return, metre line, stale review, vendor rate not projected |
| NOV-076 delivery exceptions | Dispatch status, proof of delivery URL, connected returns | Per-bundle accepted, refused, damaged and reported-short quantities that can never exceed the shipped kg, owned exceptions, resolutions (redelivery, accounts claim, expected return that creates a return authorization, stores-verified shortage, rejected claim) and reversal of unresolved entries. | Over-disposition, load not departed, return by an unauthorized role, shortage verified by non-stores, reversal after resolution, history kept, old loads leave the attention scope |
| NOV-034 order revision impact | Order line technical facts, jobs, packing, invoices | Advisory change proposals for six line facts, an impact list per downstream record (refresh, re-review, posted correction, customer), approval by someone other than the proposer, rejection of stale assessments, impact owners by role, completion when all are resolved. Nothing is rewritten. | Unchanged value, duplicate open proposal, self-approval, stale line, resolve before approval, wrong team, shipped quantity above revised quantity, untracked field |
| NOV-055 demonstrated capability | Competencies, grants, supervision confirmations, observed trials | Qualification evidence per competency (supervised confirmations, optional observed trial), assessments by an independent holder or factory manager that grant independent level only when evidence is met, and a cover matrix (no cover, single cover, requalification due). | No criteria, insufficient evidence, ineligible assessor, self-assessment, already independent, trial without procedure, more practice grants nothing, sales cannot read |
| NOV-070 measuring instruments | `calibration_records` (unlinked to results) | Instrument register with unit and range, versioned check evidence, binding each measured result to the instrument and the evidence valid on the measurement date, warn or block policy (block stops inspection approval), and impact reviews after a failed check or withdrawal. | Missing, expired and failed evidence, unit mismatch, out of range, duplicate binding, block policy at approval, failed check lists results since the last pass, withdrawal |
| NOV-026 maintenance and capacity | Slot guards refuse new slots that overlap maintenance; existing slots were not reviewed when maintenance was added later | Unavailability read model for planned maintenance and breakdowns (an open breakdown has no assumed end), affected slots split into movable and running, replanning through every existing slot guard with the original plan kept, return to planning, profile press compatibility, and one commercial promise review per order with no date change. | Running job, same press in the window, wrong role, open-ended breakdown five days ahead, incompatible press, duplicate review, unaffected order |
| NOV-030 cycle counting | Profile stock batches with location, pieces and kg | Counts by location with a movement cutoff and optional blind mode, observations, unlisted bundles, independent recount and review, adjustments only after an agreeing recount on an unmoved bundle, and closure only when every line is resolved. | Duplicate open count, duplicate scan, recount by the same person, reviewer who counted, movement after cutoff, missing bundle, partial completion |
| NOV-033 quality document pack | Customer compliance requirements (acknowledgement only), documents, inspections | Per-dispatch readiness from customer requirements, inspections of the source jobs, unresolved bundles and released drawing revisions; evidence counts only while the linked document is approved; authorized deviations are shown as deviations; versioned customer-safe manifests with replacement and withdrawal. | Missing and pending evidence, restricted document types, later drawing release, deviation, version replacement, withdrawal, no prices in the manifest |
| NOV-038 return resolution | Connected return receipt, inspection, disposition and proportional credit | Return authorizations per shipped bundle (one open at a time, never above the shipped kg), links to credit notes or replacement dispatches that settle what is owed (production alone does not), and closure only after inspection and full resolution; rejected claims free the balance. | Duplicate and oversized authorizations, uninspected receipt, unpaid balance, wrong resolution type, credit note reused, replacement larger than dispatched |

## Per-feature recheck, verification, edge tests and audit

| ID | Recheck against the catalogue | Edge tests | Audit finding and fix |
| --- | --- | --- | --- |
| NOV-062 | Steps 1, 2 and 5; step 3 for production start; step 4 lists affected work for review | 2 SQL + 1 browser | The existing Documents status buttons implied approval without recording it; replaced with a link |
| NOV-069 | Steps 1 to 4; step 5 for receipt and acceptance balances (supplier bill matching unchanged) | 3 SQL + 1 browser | A stale-review test hit the quantity rule first; test corrected, behaviour confirmed |
| NOV-076 | Steps 1, 2, 4 and 5; step 3 routes returns, claims and verified shortages | 2 SQL + 1 browser | The active list computed balances for every historical load; bounded to 120 days, history unchanged |
| NOV-034 | Steps 1 to 3, 5 and 6 as an advisory report; step 4 (applying the line change) stays in the order workflow | 2 SQL | No code defect found |
| NOV-055 | Steps 1 to 3; step 4 reuses existing supervised start and release guards | 1 SQL | No code defect found |
| NOV-070 | Steps 1 to 4 | 2 SQL | No code defect found |
| NOV-026 | Steps 1 to 4; step 5 records the commercial review without changing dates | 2 SQL | No code defect found |
| NOV-030 | Steps 1 to 5 for profile stock bundles | 2 SQL + 1 browser | Blind mode hides expected quantities on count screens only (see boundaries) |
| NOV-033 | Steps 1 to 5; the pack is a manifest of approved evidence, not a generated PDF | 2 SQL | The document lookup bypassed the existing technical-document visibility rule; now enforced in lookup and linking |
| NOV-038 | Steps 1 to 5 using the existing receipt, inspection and credit workflows | 2 SQL | No code defect found |

Shared: role mirror test compares all 15 roles x 10 views and 38 actions with the database; protocol test
covers request identity, expiry, abandonment, tenant isolation and direct table access; a browser test
covers a lost commit response.

## Scope and operating boundaries

- Entry point: /tasks/assurance, linked from Tasks. Overview, ten-row server-paginated databases, create
  pages and detail/history pages are separate. Same reviewed protocol as batches 3 and 4 (persisted request
  identity, server review bound to a source fingerprint, 15-minute expiry, only a confirmed outcome counts).
- NOV-062: the checksum identifies the file the technician holds; upload still uses Documents. Profiles
  with no released revision are not controlled. Jobs already started are never blocked.
- NOV-069: material accepted at the gate before this batch is treated as awaiting a quality decision.
  Release creates billet batches only; the inventory item ledger and supplier bill matching are unchanged.
- NOV-076 and NOV-038: no stock, credit or redelivery is posted here. Receipts can still be recorded
  through connected returns without an authorization.
- NOV-034 is advisory: it never edits the order line, jobs, bundles or invoices.
- NOV-055: managers can still grant directly through Competencies; assessments are the evidenced path.
- NOV-070: the default policy is warn. Block applies only to approvals after it is set.
- NOV-030: blind mode is a screen convenience, not a security boundary, because stock balances remain
  readable in Inventory. Missing bundles are written off through the stock workflow.
- NOV-033: packs are advisory to dispatch; the existing requirement acknowledgement guard is unchanged.

## Data and security audit

Migration: supabase/migrations/20261103300000_november_assurance.sql (additive). New tables:
drawing_revisions, drawing_revision_events, incoming_dispositions, incoming_stock_releases,
delivery_dispositions, return_authorizations, return_resolution_links, order_change_proposals,
order_change_impacts, qualification_criteria, qualification_assessments, measuring_instruments,
instrument_checks, instrument_result_bindings, instrument_policies, instrument_impact_reviews,
capacity_reschedules, capacity_commitment_reviews, cycle_counts, cycle_count_lines,
cycle_count_observations, cycle_count_adjustments, pack_evidence_links, pack_waivers,
quality_pack_issues, assurance_requests, assurance_events. Composite tenant foreign keys throughout.

Every new table enables RLS, revokes direct writes and grants tenant- and role-scoped reads; dealers are
denied; history is readable only through the detail command. Company and actor come from the session.
All functions pin search_path; private helpers are not executable by clients. New triggers:
production_jobs (released drawing at first start) and quality_inspections (instrument evidence under
block policy). Existing writes made by actions: technical_drawings status, billet_batches insert,
production_plan_slots move/draft, profile_stock_batches count adjustment, employee_competencies grant.

## Verification

| Check | Result |
| --- | --- |
| Migration chain replay (PGlite) | Applies cleanly after all existing migrations |
| tests/nov-batch5-sql.test.mjs | 23 passed |
| tests/nov-batch5.test.mjs | 5 passed (input contracts, role mirrors, form building with 150 generated quantities, real server action boundaries) |
| tests/nov-batch5-browser.test.mjs | 6 passed at 375 px; screenshots in docs/evidence/NOV_UPGRADES_BATCH_5 |
| npm run typecheck / npm run lint | Passed, no errors or warnings |
| npm test | Passed: 3,034 tests, 76 suites, 0 failures or skips |
| npm run build -- --webpack | Passed, including the four /tasks/assurance routes |

## Hosted migration state

Applied to AlExMS (pkawmdxtmsdgigsehcmb) on 3 November 2026 as five ledger entries
(november_assurance_part1_tables to part5_command; ledger 188 to 193). The file was split only at
top-level statements because two functions exceed a single-call size alone; a PGlite comparison
confirmed the parts produce identical functions, policies, triggers and grants to the original file.
Hosted check: 27 tables with RLS, 27 policies, 32 functions, 2 triggers; anon cannot execute the
command and authenticated has no direct writes. The security advisor's only new entry is
assurance_command as an authenticated security-definer RPC, the intended pattern for every *_command.
Batches 3 (20261103100000) and 4 (20261103200000) are still not applied to hosted; batch 5 does not
depend on them and their shared index names use `if not exists`.

## Remaining acceptance

Pilot with real users: one custom profile drawing through customer approval and release; one billet
receipt through quality and release; one partly refused delivery; one line change after production
started; one press start-up qualification; one micrometer with a real certificate; one planned
maintenance after planning; one rack count; one customer's certificate requirements; one credited return.

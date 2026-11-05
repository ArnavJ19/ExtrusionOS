# November Upgrade Batch 8

Date: 5 November 2026 (Asia/Kolkata)
Catalogue: [NOV_UPGRADES.md](NOV_UPGRADES.md)
Base: feat/nov-batch-4 (batches 4 to 7 committed at caa0573)
Delivery state: ten bounded slices implemented and verified locally against the full replayed migration
chain. Employee acceptance and the hosted migration remain separate gates (see the end of this record).

## Selection

The next ten entries by delivery rank (71 to 80), all C3/C4 and U2/N2. Eight are SQL-backed workflows under
`/tasks/execution`; two change shared screens (the order page and the die selection in production forms).

| Rank | ID and idea | Foundation found | Gap closed in this slice | Edge evidence |
| --- | --- | --- | --- | --- |
| 71 | NOV-075 delivery appointments and site readiness | Customer address, dispatches, order stages | Requested slot, site confirmation and actual arrival as separate facts; every reviewed revision retained; site address revision with the customer default shown beside it; receiving contact (mobile masked outside dispatch and sales), access restrictions and preparation; reschedule returns the appointment to "changed, needs reconfirmation"; unconfirmed appointments surface in load review; a confirmation never releases a dispatch | Overnight slot, 48 h limit, past slot, wrong or other-company order and dispatch, duplicate open appointment, changed site, missed slot, outcome without arrival |
| 72 | NOV-077 returnable gate passes and custody | Dies, vendors, assets | Approved pass, departure, acknowledgement, partial returns with condition, loss, authorised extension (three at most, 90 days), closure when the balance is zero; a die or serial asset has exactly one open pass; planners see a die as out on a pass; jobs that need the die before its return are flagged | Duplicate die and serial pass, partial returns, damage, overdue, fourth extension, cancel after departure, roles |
| 73 | NOV-087 workflow progress | Order stage history, jobs, dispatches, inspections | `public.order_progress`: sixteen stages with complete, current, blocked, skipped-by-policy, unavailable and upcoming states derived from stage evidence and the bound route; reopened work; partial production and dispatch in kilograms (never a percentage); blockers (billets, held jobs, unusable die, unapproved rejected inspection, damaged dispatch); each source read isolated so a failed read shows "unavailable"; links only into modules the role may open | Passed stage without evidence, reopened order, cancelled order, held job, billets short, failed production read, other company, dealer |
| 74 | NOV-014 small updates from work queues | Task databases, bulk queue tool | Assignee, priority or planned date on up to 10 page-selected or 50 filter-selected tasks; the exact version seen is sent; each task is judged again at confirmation; every selected identity is reported; assignee changes use the same eligibility as assignment | Task changed after review, duplicate, oversize, finished or unavailable task, running task, ineligible or unavailable assignee, revoked access, repeated request |
| 75 | NOV-019 documents and communication beside the transaction | Customers, orders, dispatches, appointments | Prepared order confirmation, dispatch notice (part dispatch says so) and appointment notice built only from authoritative facts; recipient from the customer or an entered, normalised number; document link; copy, download and print are client outcomes; "how it was used" is recorded through the reviewed action; a changed record or recipient makes the preparation stale; nothing is claimed as sent or delivered | No recipient, invalid entered number, part dispatch, pending dispatch, closed appointment, changed order, superseded preparation, roles |
| 76 | NOV-036 multi-order vehicle load | Reviewed vehicle loads with a unique active bundle | Unloading stop per order, loading order (last stop first), bundle-by-bundle confirmation (scan or by hand), removal and unloading exceptions, a departure review with blockers and warnings (capacity, held jobs, cancelled orders, missing stops, unconfirmed bundles, unconfirmed appointments, several sites) | Over-capacity, held line, stale review, removed bundles, closed load, other company, roles |
| 77 | NOV-044 protected execution window | Planned dates, job status | Window policy (hours, press scope, advisory or enforced); a change inside it needs a reason, the customer effect and a second approver; approval applies only if the job is unchanged since the request and records before and after; owners of the job and order are told once; the server trigger refuses direct date or shift changes inside an enforced window and only there | Outside window, running job, same person approving, stale job, withdrawn request, enforcement boundaries, press-specific window, retirement |
| 78 | NOV-045 stage WIP limits | `control_wip_stage` | Six stages with queued, active and held work in one stated unit (kg or jobs), advisory limits, "near / over / unmeasured" states, upstream consequence, and a recorded reason when a release would pass a limit | Held job with no quantity (never zero), unit mix, decimals, no limit, within-limit release refused, roles |
| 79 | NOV-047 assignment using capacity and eligibility | Tasks, competencies | Rules (roles, current competency, typical minutes) as hard eligibility; unavailability as a soft signal; open tasks, estimated minutes with unestimated work stated, overdue; override reason retained; assigned work is re-evaluated and flagged, never moved | Missing or expired competency, away, running task, ineligible assignee after a rule change, stale eligibility at confirmation, viewers, dealers and other companies never candidates |
| 80 | NOV-052 workflow paths | Order stages | Route families (required and optional stages), second-person approval, versions, binding to an order with the effect on recorded history shown, deviations for a stage ahead of the order (core stages never), second-person decision, progress shows policy skips and their reason | Missing core stage, overlap, unknown stage, duplicate draft, self approval, rebinding, reopened rejection, bound order after retirement |

## Per-feature recheck, verification, edge tests and audit

| ID | Recheck against the catalogue | Edge tests | Audit finding and fix |
| --- | --- | --- | --- |
| NOV-075 | Steps 1 to 4 | 2 SQL + 1 browser | None beyond planned changes |
| NOV-077 | Steps 1 to 4 | 2 SQL + 1 browser | The die lookup now shows custody so a pass is visible beside die selection |
| NOV-087 | Steps 1 to 4 | 2 SQL + 1 unit + 1 browser | Order cancellation claimed no current stage; verified |
| NOV-014 | Steps 1 to 5 | 2 SQL + 1 unit + 2 browser | A page-selection limit and a version per task were added; filter selection is read page by page, never inferred |
| NOV-019 | Steps 1 to 3 and 5; provider steps are out of scope | 2 SQL + 1 browser | An invalid entered number was reported as "no recipient"; it now names the number problem |
| NOV-036 | Steps 1 to 3 and 5; finalisation stays in the existing dispatch release | 2 SQL + 1 browser | Removed bundles were still counted as blockers; they are now excluded |
| NOV-044 | Steps 1 to 5 | 3 SQL | The enforcement trigger is off unless a window is set to enforce |
| NOV-045 | Steps 1 to 3 and 5; enforcement is not implemented, as the catalogue advises | 2 SQL | A retired limit left the stage row id unreachable; the stage row now falls back to a stable identity |
| NOV-047 | Steps 1 to 5 | 2 SQL | The competency error was lost to array coercion in PostgreSQL; fixed |
| NOV-052 | Steps 1 to 5; no visual workflow engine | 2 SQL | Delivered or payment-pending orders can no longer be bound |

## Scope and operating boundaries

- Hub: `/tasks/execution` (overview, ten-row server-paginated databases, create pages, detail with retained
  history, queue panel), linked from Tasks. Same reviewed request protocol as batches 3 to 7.
- NOV-075: no external calendar or message delivery; the appointment notice is prepared text.
- NOV-077: custody warns planners; it does not block a production job that names the die.
- NOV-087: progress is read-only. Stage links navigate; they never transition an order.
- NOV-014: only assignee, priority and planned date. Stock, money and status changes stay elsewhere.
- NOV-019: preparation only. Sending, delivery and reading are not tracked and never displayed.
- NOV-036: confirmation and review layer over reviewed loads. Capacity is the figure recorded on the vehicle;
  no statutory limit is encoded. Consumption and dispatch documents stay in the existing release.
- NOV-044: window counts calendar days of the planned date in IST. Reservations, crew and vendor work are
  not modelled and the screen says so.
- NOV-045: advisory limits only; hard enforcement needs concurrency-safe accounting and an approved policy.
- NOV-047: recommendations only; availability is entered by supervisors; counts are not a performance measure.
- NOV-052: bounded route families bound by a person; automatic route selection and dynamic task creation are
  not built.

## Data and security audit

Migration `supabase/migrations/20261103600000_november_execution.sql` (additive, 1,735 lines; depends on the
batch 5 helpers and the batch 4 WIP stage function, both on hosted). 20 new company tables, every one with
`company_id`, RLS enabled and all client grants revoked; the only direct read is a person's own request. All reads
and writes go through `public.execution_command` and `public.order_progress` (security definer, search_path
pinned, role matrix mirrored in TypeScript and verified for every role, view and action). Private helpers are
not executable by clients. Company and actor always come from the session. Dealers are refused. The receiving
contact's mobile is masked outside dispatch and sales. New server actions: `executionAction`,
`orderProgressAction`. One new trigger, `zz_enforce_execution_window`, acts only for an active enforcing window.

## Verification

| Check | Result |
| --- | --- |
| Migration chain replay (PGlite) | all files, 0 failures |
| tests/nov-batch8-sql.test.mjs | 23 passed |
| tests/nov-batch8.test.mjs | 12 passed |
| tests/nov-batch8-browser.test.mjs | 8 passed at 375 px; screenshots in docs/evidence/NOV_UPGRADES_BATCH_8 |
| npm run typecheck | Passed |
| npm test | see the delivery note at the end of this record |

## Hosted migration state

Not applied. This migration needs only batches 4 and 5, so it can be applied independently.

## Remaining acceptance

Pilot with real users: three delivery appointments from request to outcome; one die and one pallet set out on
gate passes and returned; one multi-order load planned and confirmed; one protected-window change approved by
a second person; one stage limit watched for a week; ten assignments with competency rules for one task type;
one route family used for stock sales; five customer messages prepared; one queue update of ten tasks.

## Review follow-up (NOV-036)

Three review findings on the vehicle load plan were fixed in `20261103600000_november_execution.sql` (not yet applied to hosted):

- Load detail no longer truncates at 60 bundles. Bundles are ordered, then paged 25 at a time (`items_page`), with previous/next links on the load record.
- Bundle labels are read from `prepared_physical_bundles`, the table the load items reference, in both the loading list and the confirmation review. The fixture now seeds real prepared bundles, which is what exposed the wrong lookup.
- A departure review reads as current only when the freshly computed findings (blockers, warnings, planned and loaded kg) still match the stored review, in addition to the existing confirmation and stop timestamps. A later production hold, order cancellation or change to the saved load now moves the load out of "ready".

Regression tests: `tests/nov-batch8-load-review-fixes.test.mjs` (3).

# November Upgrade Batch 7

Date: 5 November 2026 (Asia/Kolkata)
Catalogue: [NOV_UPGRADES.md](NOV_UPGRADES.md)
Base: feat/nov-batch-4 working tree (batch 6 still uncommitted underneath)
Delivery state: ten bounded slices implemented and locally verified against the full replayed migration
chain. Employee acceptance and hosted migration remain separate gates (see the end of this record).

## Selection

The next ten entries by delivery rank (61 to 70), all U2/N2. Four are SQL-backed workflows under
`/tasks/improvement`; six change shared screens and forms.

| Rank | ID and idea | Foundation found | Gap closed in this slice | Edge evidence |
| --- | --- | --- | --- | --- |
| 61 | NOV-089 quick record previews | `RecordPreview` beside every operations database | Phone bottom sheet with Back closing the preview, a fresh exact-id read (current, changed since the list loaded, or removed/no longer permitted, with stale reads discarded on row switches), blockers that a preview must not hide (billets short, job on hold, damaged delivery, rejected inspection, reorder level, overdue invoice) and permitted next steps | Changed record, removed record hides all details and links, rapid switching, Back, focus return, company switch while open |
| 62 | NOV-003 search from every screen | Instant Find on `/search` only | Shell find dialog on every screen and phone (`/`, Ctrl/Cmd+K, not while typing), Up/Down/Enter, stale answers discarded, customer phone and contact, die code and customer die reference, separator-insensitive codes, exact matches first, die history quick action | Injection characters stripped, phone formats, similar codes ranked, partial outage reported, other company excluded, typing in a field |
| 63 | NOV-009 repeat previous | Repeat quotation only | "Start from a previous ..." for production jobs (press, shift, efficiency), dispatch transport (order, transporter, vehicle, driver) and packaging purchases (material, vendor, unit, rate, method): dates refreshed, quantities, weights, documents, approvals and payments never copied, inactive press/material/vendor or closed order dropped with a warning, rate shown as dated, lineage `record_repeat_links` recorded only for kept values | Inactive press, delivered order, unavailable order, inactive vendor, stale rate, edited copy not recorded, lineage by another user, old target, later source, duplicate, other company |
| 64 | NOV-010 create missing masters in the task | In-quotation customer dialog | The same reviewed pattern for vendors (`inTaskVendorAction`: advisory duplicate checks by name, phone and GST; idempotent create keyed by request id; selecting an existing match) and both dialogs on every operational form field that looks up customers or vendors; the new record is added to the field's choices and selected without leaving the form | Duplicate needs acknowledgement, retry returns the same vendor, changed retry refused, other company's vendor, injected tenant key, role without vendor creation, dealer, rejected insert |
| 65 | NOV-011 spreadsheet line entry | Quotation paste helpers | Reviewable Excel paste for the dispatch bundle manifest (Bundle, Source, Pieces, Metres, Gross kg, Tare kg; 60 rows), each row valid, ambiguous (explicit source choice) or invalid with its reason; rejected rows stay in the box; Enter moves down a column and adds a bundle; duplicate a bundle with tag and gross cleared | Quotes, formulas, extra cells, wrong units, unknown column, repeated header, decimals, tare ≥ gross, duplicate tags in paste and on the load, unknown and ambiguous source |
| 66 | NOV-017 QR scan into the task | Scanner logging views and three generic events | Version 2 labels (no company identity on the label), server-side company-scoped resolution, warnings for held, reserved, consumed or inactive records, links into the permitted task screens, and bounded scan sessions (stock check, die check, dispatch loading) with duplicate feedback, review before recording, and a recheck at recording; dispatch loading refuses held or consumed bundles | Links and scripts, unknown version, damaged label, withdrawn and expired labels, other company (v1 payload and table), duplicate scan, wrong record type for the task, roles without scanner |
| 67 | NOV-025 die operating history | Dies, jobs, corrections, trials, nitriding, location history | Timeline of runs, output corrections, inspections, corrections, trials, nitriding, moves and status decisions (status changes recorded from now); exposure from completed runs only with the opening balance and incomplete output shown separately; reviewed service thresholds (second approver, replace/retire) that warn on the die board, the dies lookup and beside die selection in the production form, never blocking | Cancelled and running jobs not counted, corrected output, missing output, master total mismatch, die type scoping, no service recorded, replacement, retirement, tenant and role isolation |
| 68 | NOV-053 recurring problems | NCR-like records spread over inspections, exceptions, dispositions, returns, tickets, step flags | Problems with an improvement owner, linked adverse occurrences (one problem per occurrence; removal with reason), containment, cause as observation or established with evidence, planned change, trial scope, review date and denominator, optional procedure change, recurrence per 100 over equal windows, close only after the effectiveness review, reopen | Ineligible and duplicate links, cross-problem link, cause before plan, review before date, incomplete comparison cannot confirm, not effective returns to investigation, cancelled trial, recurrence after closure, concurrent change |
| 69 | NOV-054 team outcomes | Turnaround targets, task waits, inspections, dispatches | Seven versioned metric definitions (numerator, denominator, time basis, exclusions, owner, source), last 30 days against the previous 30 in IST, sample size and missing evidence, small-sample and no-data states, elapsed/active/waiting/unrecorded task time, drill-down for the team's leads only, team level only | Pending inspections as missing, orders without expected date, tasks without target or start, empty window has no value, real zero shown, other company excluded, improved/worsened by direction |
| 70 | NOV-059 improvement channel | Procedure step flags and improvements | A lightbulb on every screen that sends a suggestion with the page path only; routing per kind to a process owner; acknowledge, clarify, trial, adopt, decline with reason, resolve; contributor clarification; merge duplicates; link to a problem or procedure change; owner reassignment; notifications both ways; contributors see their own, owners their assigned, managers all; internal notes private | Query strings, links and `..` refused, viewer and dealer refused, invalid transitions, decline reason, internal note hidden from contributor, quality and history, merge loops |

## Per-feature recheck, verification, edge tests and audit

| ID | Recheck against the catalogue | Edge tests | Audit finding and fix |
| --- | --- | --- | --- |
| NOV-089 | Steps 1 to 4 | 2 unit + 1 browser (+ existing preview suites) | Closing a preview by unmount called `history.back()`, which could land after a newly opened preview and close it; the entry is now neutralised in place. The read model's owner/date line does not apply to previews |
| NOV-003 | Steps 1 to 4 | 4 unit + 1 browser | None beyond the planned changes; existing instant-find suites still pass |
| NOV-009 | Steps 1 to 4 for three families | 2 unit + 1 SQL | Lineage fields are now identical in TypeScript and SQL (test enforces it); the die is never repeated because the order line decides it |
| NOV-010 | Steps 1 to 4 for customers and vendors | 1 unit | Existing browser fixtures needed stubs for the new actions |
| NOV-011 | Steps 1 to 4 for the dispatch manifest | 2 unit + 1 browser | A formula containing quotes was reported as a quoting error; it now names the formula |
| NOV-017 | Steps 1 to 4 | 3 unit + 1 browser | New labels are version 2; version 1 labels still scan. Full-suite run showed the session wording was weaker than the existing "scan event, not a state transition" rule; reworded |
| NOV-025 | Steps 1 to 4 | 2 SQL + 1 browser | Die rows showed "Not assigned" and a service date in the owner/date line; removed |
| NOV-053 | Steps 1 to 4 | 4 SQL + 1 browser | A missing lookup filter was NULL and `NULL not in (...)` never raised; fixed |
| NOV-054 | Steps 1 to 4 | 2 SQL | None in SQL; the employee lookup offered dealer-role users when their dealer id was blank, fixed for all batch 7 user choices |
| NOV-059 | Steps 1 to 4 | 3 SQL + 1 browser | None beyond the lookup fix above |

## Scope and operating boundaries

- Hub: `/tasks/improvement` (overview, ten-row server-paginated databases, create pages, detail with
  retained history), linked from Tasks. Same reviewed request protocol as batches 3 to 6.
- NOV-009: repeats copy from a previous record, not from an approved template library.
- NOV-010: customers and vendors only; dispatch transporter remains free text.
- NOV-011: the dispatch bundle manifest only; quotation paste is unchanged.
- NOV-017: label reprint and damaged-label procedures are not defined here; manual entry is always offered.
- NOV-025: status history starts on 5 November 2026; thresholds warn and never block.
- NOV-053: recurrence counts occurrences linked to the problem; other changes in the same period can
  affect it and the screen says so.
- NOV-054: team level only, not split by task kind; individual performance needs an approved policy.
- NOV-059: one routing owner per suggestion kind; managers see all suggestions, internal notes stay with
  the assigned owner, owners and admins.

## Data and security audit

Migration `supabase/migrations/20261103500000_november_improvement.sql` (additive, depends only on the
batch 5 helpers already on hosted). New tables: die_status_events, die_service_thresholds,
improvement_problems, improvement_problem_links, improvement_suggestion_routes, improvement_suggestions,
outcome_metric_versions (shared reference), record_repeat_links, improvement_requests, improvement_events.
New trigger `zz_record_die_status_event` on dies. Every company table enables RLS with direct writes
revoked; reads are tenant- and role-scoped; suggestions and history are readable only through the command;
company and actor always come from the session; dealers are refused; all functions pin search_path and
private helpers are not executable by clients. New server actions check the role again on the server:
`improvementAction`, `inTaskVendorAction`, `resolveScanAction`, `recordScanSessionAction`.

## Verification

| Check | Result |
| --- | --- |
| Migration chain replay (PGlite) | 288 files, 0 failures |
| tests/nov-batch7-sql.test.mjs | 14 passed |
| tests/nov-batch7.test.mjs | 16 passed |
| tests/nov-batch7-browser.test.mjs | 7 passed at 375 px; screenshots in docs/evidence/NOV_UPGRADES_BATCH_7 |
| npm run typecheck / npm run lint | Passed, no errors or warnings |
| npm run build | Passed, including the /tasks/improvement routes |
| npm test | 3,113 tests in 76 suites: 3,112 passed, 1 failed. The failure was an older guard that pins the scanner's "log only" wording; the session button now reads "Log these scans" and states that logging changes no stock, die or dispatch status, and the guard was updated to the new screen. Re-run of that suite and the batch 7 browser suite: 21 passed. Final full re-run after the fix: 3,113 tests in 76 suites, all passed, none skipped. Regenerated older evidence images and build artefacts were restored |

## Hosted migration state

Not applied. Hosted AlExMS still has only batch 3 part 1 of the November coordination chain beyond batch 5
(ledger 194). This migration needs only batch 5, so it can be applied independently.

## Remaining acceptance

Pilot with real users: one week of shell search on the phone; three repeated dispatches; one vendor added
from a purchase; one pasted load from the weighbridge sheet; a scanned stock check of one rack; one die
history reviewed with tooling and one threshold approved; one recurring problem taken to its review; the
outcome figures explained by each team lead; one department's suggestions answered for two weeks.

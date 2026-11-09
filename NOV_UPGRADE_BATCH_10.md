# November Upgrade Batch 10

Date: 6 November 2026 (Asia/Kolkata)
Catalogue: [NOV_UPGRADES.md](NOV_UPGRADES.md)
Base: feat/nov-batch-4 (batches 4 to 8 committed at a5eeeae; batch 9 uncommitted in the same working tree)
Delivery state: ten bounded slices implemented and verified locally against the full replayed migration chain.
Employee acceptance and the hosted migration remain separate gates (see the end of this record).

## Selection

The last ten entries by delivery rank (91 to 100): NOV-061, 080, 071, 073, 037, 065, 067, 072, 032, 074. With this
batch all 100 catalogue entries have a delivered slice. All ten are SQL-backed workflows under `/tasks/specialist`.
Most are U4 "conditional" features; each slice is bounded so it is useful before the operating scenario is confirmed.

| Rank | ID and idea | Foundation found | Gap closed in this slice | Edge evidence |
| --- | --- | --- | --- | --- |
| 91 | NOV-061 PO intake | Customers, customer profile aliases, quotations, orders | Pasted PO kept with SHA-256 checksum; deterministic line extraction (code or customer alias, quantity and unit, length, finish, date, rate) with the source line kept; ambiguous values stay unresolved; comparison with the accepted quotation; person resolves; ready; link the order actually entered with differences recorded | Duplicate document, unclear comma decimal, two codes on a line, two quantities, unknown section, embedded instructions, amended PO, other customer's quotation, control characters |
| 92 | NOV-080 automation workbench | `automation_rules`/`automation_runs` (simulated runs shown as completed) | Typed versioned rules (3 triggers, one action: internal task) with second-person approval, pause/resume/retire; simulation and execution recorded separately with per-record outcomes; one effect per event key across runs and versions; inactive assignee skipped; existing builder relabelled so a simulation is never shown as executed | Draft run refused, self-approval, duplicate run, revised version, pause, changed source between review and commit, inactive assignee |
| 93 | NOV-071 laboratory testing | Vendors, production jobs, billet batches | Sample identity, tests with method revisions, promised and revised dates, chain of custody with identity check, immutable result revisions, quality decision separate from the lab statement, retest with the same sample, overdue and waiting-order surfacing | Mislabelled sample, partial report, amended certificate (before and after review), failed result, lost shipment, overdue, unauthorised review |
| 94 | NOV-073 shade references | Finishing jobs, order lines | Versioned references with physical sample location and assessment conditions, second-person approval, binding to order lines (customer and finish checked), per-batch match decisions, flags for mixed references, superseded or withdrawn references and unreviewed batches | Similar shade names, other customer, wrong finish, rebind, superseding revision, withdrawal, rejected then authorised deviation |
| 95 | NOV-037 blanket agreements | Customers, profiles, orders | Agreement lines with agreed kg, agreed overrun, dated rates; releases reserve balance under the company lock; firm with the rate in force on the delivery date (snapshot kept); partial cancel; fulfil with an order; returns; expiry; close with carry-forward | Concurrent releases, exact ceiling vs overrun, partial cancellation, changed rate, expired agreement, same order twice, return |
| 96 | NOV-065 tooling accounts | Dies, invoices, payments, credit notes, packing lists | Agreed owner recorded separately from payment; contribution, waiver (approved by a second person), per-kg recovery with cap measured from dispatched bundles of the die's profile; position derived only from linked finance records that still count; amendments, disputes, reversals | Partial payment, waiver, credit, cap, changed agreement, ownership change, another customer, reversed payment, dispute |
| 97 | NOV-067 warehouse transfers | Profile stock batches, inventory locations | Whole-bundle transfers: request, issue into an explicit `in_transit` stock status, receive by bundle number at the destination, dispositions (damaged, returned to source, lost) by someone other than the issuer, close with reconciliation | Reserved bundle, competing transfer, bundle not on the transfer, repeated receipt, cancel before/after issue, QC hold kept |
| 98 | NOV-072 heat treatment | Machines (`aging_oven`), production jobs, profiles | Recipe revisions with second-person approval; batches with exact inputs (alloy compatibility, untreated quantity); actual readings with instrument; out-of-range, missing readings, interruption and cycle length assessed; quality review per input with explicit deviation acceptance; automatic retreatment batch | Mixed alloys, interrupted cycle, out-of-range reading, missing readings, recipe revision, partial reject, retreatment, oven withdrawn |
| 99 | NOV-032 customer metal | Customers, orders, production jobs | Job-work agreement revisions; receipts in a separate account (never billet stock) with inspection; issue only to that customer's jobs, mixing only if authorised; output, scrap, loss within the agreed allowance; returns; reversals; statements with conversion-charge draft and settlement | Other customer's job, unauthorised mixing, uninspected or rejected receipt, allowance exceeded, no allowance agreed, reversal dependencies, dispute, second statement charge basis |
| 100 | NOV-074 weighbridge | Dispatches, purchase receipts, packing lists, factory vehicles | Sessions per movement with instrument, calibration and tolerance; immutable readings (kg or t, time, source, packet reference, stability, vehicle on slip); explicit pairing with 24-hour tare window and order check; reconciliation with bundles or kilogram receipt lines; finalisation never rewrites weights; supersession | Wrong vehicle, repeated packet, future or stale readings, invalid unit, unstable reading, reversed order, negative net, tolerance exceeded, bundles changed after pairing, expired calibration, interrupted session |

## Per-feature recheck, verification, edge tests and audit

| ID | Recheck against the catalogue | Tests | Audit finding and fix |
| --- | --- | --- | --- |
| NOV-061 | Steps 1 to 6 for pasted text; file upload and OCR are not built | 2 SQL + unit + 2 browser | None beyond planned; embedded instructions verified inert |
| NOV-080 | Steps 1 to 3, 5 and 6; step 4 (background outbox runner with leases and retries) is not built: a person starts each reviewed run | 2 SQL + unit + browser | The legacy builder labelled simulations "completed"; it now says "Simulated · nothing executed" |
| NOV-071 | Steps 1 to 4; no nonconformance report is created (the decision says so) | 2 SQL + browser | None beyond planned |
| NOV-073 | Steps 1 to 4 within the hub; packing and load screens do not yet show the flags | 2 SQL + browser | None beyond planned |
| NOV-037 | Steps 1 to 5 | 2 SQL + browser | Cancelling a firm release violated the rate-snapshot constraint; the constraint now allows a cancelled release to keep its snapshot. Carry-forward linked to the closed agreement; it now opens the new draft |
| NOV-065 | Steps 1 to 4; step 5 shown in the die lookup only, not yet in quotation or gate-pass screens | 2 SQL + browser | None beyond planned |
| NOV-067 | Steps 1 to 5 for whole bundles; splitting a bundle is not built | 2 SQL + 1 browser | A reserved bundle was reported as "available and cannot be transferred"; it now says it is reserved for an order |
| NOV-072 | Steps 1 to 5; no equipment integration | 2 SQL + 1 browser | Operator precedence (`a||b->'k'`) silently erased the review warnings; parenthesised and searched for the same pattern |
| NOV-032 | Steps 1 to 6 within a separate account; production consumption records are not posted | 2 SQL + browser | None beyond planned |
| NOV-074 | Steps 2 to 6 with manual or packet entry; step 1 (device protocol discovery) is a site task | 2 SQL + 1 browser | None beyond planned |

## Scope and operating boundaries

- Hub: `/tasks/specialist` (overview, ten-row server-paginated databases, create pages, detail with retained history),
  linked from Tasks. Same reviewed request protocol as batches 3 to 9, separate request and event tables.
- Nothing in this batch creates an order, invoice, credit, payment, stock receipt or nonconformance report. Each slice
  links to records the existing workflows created, or records its own register.
- NOV-067 is the only slice that changes existing rows: issuing a transfer sets `profile_stock_batches.status` to
  `in_transit` and the location to the transfer; receipt and dispositions set it back. QC status is never touched.
- NOV-080 only ever creates internal tasks. Tasks never trigger rules, so a run cannot repeat itself.

## Data and security audit

Migration `supabase/migrations/20261103800000_november_specialist.sql` (additive, about 2,800 lines; depends only on
batch 5 helpers and `private.ist_today`; independent of batches 8 and 9). 28 new company tables plus request and event
tables, each with `company_id`, RLS enabled and all client grants revoked; the only direct read is a person's own
prepared request. The one change to an existing object widens `profile_stock_status_check` with `in_transit`.
All reads and writes go through `public.specialist_command` (security definer, pinned search path, role matrix mirrored
in TypeScript and verified for every role, view and action; shape spec verified key by key). A test asserts that only
the command and the three role helpers are executable by clients and that all 47 functions pin their search path.
Company and actor always come from the session; dealers are refused; second-person approval is enforced for rules,
references, agreements, tooling agreements, recipes and job-work agreements; the issuer of a transfer cannot approve
its loss. Tooling and customer-metal figures are limited to sales manager, accounts, owner and admin (and stores roles
for metal); purchase-order text is limited to sales roles.

## Verification

| Check | Result |
| --- | --- |
| Migration chain replay (PGlite) | 291 files, 0 failures |
| tests/nov-batch10-sql*.test.mjs | 25 passed (including a privilege audit of all 47 new functions) |
| tests/nov-batch10.test.mjs | 4 passed |
| tests/nov-batch10-browser.test.mjs | 6 passed at 375 px and 1280 px; screenshots in docs/evidence/NOV_UPGRADES_BATCH_10 |
| npm run lint | 0 errors (3 earlier warnings in batch 8 tests) |
| npm run typecheck | Passed |
| npm run build | Passed; four `/tasks/specialist` routes built |
| npm test | 3,245 passed, 0 failed (after updating a batch 9 audit that asserted its migration was the newest, and making a batch 9 density check wait for its mount effect) |

## Hosted migration state

Not applied. It can be applied independently of batches 8 and 9.

## Remaining acceptance

Pilot with real users: ten purchase orders from one customer format compared field by field with what sales entered;
one task-creation rule run for two weeks; one laboratory test family; one shade-sensitive project; one blanket
contract reconciled to the customer's records; one die agreement reconciled to invoices and receipts; one inter-site
movement reconciled at both ends; one oven's batches for a week; one customer's metal account reconciled physically;
one weighbridge's slips for a week. Most of these features are conditional (U4): confirm the operating scenario first.

# November Upgrade Batch 9

Date: 5 November 2026 (Asia/Kolkata)
Catalogue: [NOV_UPGRADES.md](NOV_UPGRADES.md)
Base: feat/nov-batch-4 (batches 4 to 8 committed at a5eeeae)
Delivery state: ten bounded slices implemented and verified locally against the full replayed migration
chain. Employee acceptance and the hosted migration remain separate gates (see the end of this record).

## Selection

The next ten entries by delivery rank (81 to 90): NOV-064, 078, 035, 082, 039, 066, 029, 020, 023, 024.
Eight are SQL-backed workflows under `/tasks/commercial`; NOV-082 is a device preference in the app shell;
NOV-035/039/066 are read models with a small number of reviewed actions.

| Rank | ID and idea | Foundation found | Gap closed in this slice | Edge evidence |
| --- | --- | --- | --- | --- |
| 81 | NOV-064 quantity pricing | `costing_rates`, quotations, decision-authority revisions | Versioned rules (volume brackets, minimum charge, processing charge) with scope, dates, precedence and second-person approval; a recorded price keeps the rule versions, supersedes a revised draft, goes stale if a rule changes before confirmation; overrides only for sales managers and owners, capped by the existing `low_margin_quote` authority limits | Bracket boundaries, partial quantities, rounding, minimum, processing, expired/future/overlapping rules, issued quotation, override limit |
| 82 | NOV-078 supplier claims | Purchase lines, receipts, supplier credits | Claim against one purchase line with an exclusive quantity pool (shortage separate from rejected/held), response history, agreed figures, linking of real receipts and posted credits, reversal, close with the unresolved difference kept | Double claim, shortage vs rejected pool, receipt before the claim, wrong supplier credit, credit used twice, partial then full recovery, reversal reopen |
| 83 | NOV-035 job profitability | Accepted quotation snapshots, invoices, credit notes, expense ledger | Estimate beside invoiced revenue and expenses linked to the order, jobs, finishing jobs or dispatches; missing sources are stated, never zero; provisional and final snapshots, later adjustments kept as new evidence | Draft invoice excluded, credit note, no estimate, stale confirmation, double finalise |
| 84 | NOV-082 display density | Page header density, `.form-input`, `.industrial-table` | Comfortable and compact tokens, device and user scoped, reset, never compact on touch screens, safe when storage is blocked | Fine vs coarse pointer, reload, second user, blocked storage |
| 85 | NOV-039 supplier reliability | Receipts, finishing jobs | New original/revised promise record; on-time, late and past-date counts against the original promise; units never mixed; small sample stated instead of ranked | Revised promise, receipts before/after promise, no promise, mixed units |
| 86 | NOV-066 quotation outcomes | Quotations, linked orders | Wins derived from linked orders (kg share), loss/withdrawn/no decision with reason and evidence type, reopen with history, monthly cohorts with denominators | Partial win, cancelled order, repeat revisions, draft, reopen |
| 87 | NOV-029 remnants | Profiles, order lines | Measured lots with discrete length, matching on profile, alloy, temper, finish and cut length with waste, reserve/consume/release/scrap/correct | Equal kg, shorter length, wrong profile or finish, competing reservation, damaged, short lot, correction |
| 88 | NOV-020 accounting export | Invoices | One transaction family: versioned mapping (second approver), batches of up to 25 invoices with stable external identity, no double export, CSV with formula neutralisation, per-invoice package result | Duplicate reference, changed invoice, rejected then re-exported, cancel, roles |
| 89 | NOV-023 compatible runs | Jobs, dies, gate passes | Deterministic grouping by profile, die, alloy, temper, finish, drawing revision (and customer for customer-owned dies); excluded jobs counted; advisory proposals that go stale when jobs change | Mismatched finish/revision, held job, blocked die, stale accept |
| 90 | NOV-024 what-if scenarios | Shift capacity, maintenance blocks, jobs | Isolated snapshot, hypothetical breakdown/extra shift/urgent order/delayed receipt, baseline vs scenario per job, unmeasured presses stated, second-planner acceptance with rebase check | Impossible scenario, unmeasured press, changed source, invalid changes, live plan untouched |

## Per-feature recheck, verification, edge tests and audit

| ID | Recheck against the catalogue | Tests | Audit finding and fix |
| --- | --- | --- | --- |
| NOV-064 | Steps 1 to 5; tax is not computed, the screen says so | 6 SQL + unit + 2 browser | An override is limited by the existing authority matrix; a minimum charge still binds an override |
| NOV-078 | Steps 1 to 5; no credit is created by a claim | 3 SQL + unit + 1 browser | A fully recovered claim closes itself and reopens if a link is reversed; the open pool in the detail now includes the claim itself |
| NOV-035 | Steps 1, 4, 5; material and conversion cost are not derived (no source) | 3 SQL + 1 browser | A provisional adjustment after a final snapshot no longer un-finalises the order |
| NOV-082 | Steps 1 to 4 | 1 unit + 1 browser | None beyond planned changes |
| NOV-039 | Steps 1 to 4; attribution of internal delay is not built | 2 SQL + 1 browser | Promised-date history is retained inside the commitment |
| NOV-066 | Steps 1 to 4 | 2 SQL + 1 browser | A cancelled order no longer proves a win |
| NOV-029 | Steps 1 to 5 within a register; no stock-ledger posting | 4 SQL + 1 browser | Alias collision in the consume/release context found and fixed |
| NOV-020 | Steps 1 to 5 for one family; no connector; steps 6 deferred | 3 SQL + unit + 1 browser | The external identity was truncated and could collide; it now uses the full invoice identity |
| NOV-023 | Steps 1 to 4 and 6 partly; preview of the schedule and apply are not built | 2 SQL + 1 browser | Status words that meant different things per view now have view-specific labels |
| NOV-024 | Steps 1 to 4 and 6; applying changes through domain actions is not built | 4 SQL + 1 browser | Unmeasured presses are refused as change targets |

## Scope and operating boundaries

- Hub: `/tasks/commercial` (overview, ten-row server-paginated databases, create pages, detail with retained
  history), linked from Tasks. Same reviewed request protocol as batches 3 to 8, separate request and event tables.
- NOV-064: selling-price breakdown only; cost, margin and GST definitions stay with existing workflows.
- NOV-078: claims link existing receipts and posted credits; nothing is posted to stores or finance.
- NOV-035: recorded cost covers only expenses linked to the order, jobs, finishing jobs or dispatches.
- NOV-029: register only; consumption does not post to the profile stock ledger.
- NOV-020: no connector; a person imports the file and records the package result. Bidirectional sync is not built.
- NOV-023/024: advisory. Nothing schedules, reserves or promises. Duration and yield are not estimated.
- NOV-082: stored in the browser per company, user and device; touch screens always keep comfortable controls.

## Data and security audit

Migration `supabase/migrations/20261103700000_november_commercial.sql` (additive, about 1,820 lines; depends only on
batch 5 helpers and `private.ist_today`). 17 new company tables, each with `company_id`, RLS enabled and all client
grants revoked; the only direct read is a person's own prepared request. All reads and writes go through
`public.commercial_command` (security definer, pinned search path, role matrix mirrored in TypeScript and verified for
every role, view and action). Private helpers are not executable by clients. Company and actor always come from the
session. Dealers are refused. Cost-bearing views (profitability) are limited to owner, admin, accounts and factory
manager; invoices appear only in the accounting export view for accounts, admin and owner. No trigger is added.

## Verification

| Check | Result |
| --- | --- |
| Migration chain replay (PGlite) | all files, 0 failures |
| tests/nov-batch9-sql*.test.mjs | 32 passed |
| tests/nov-batch9.test.mjs | 13 passed |
| tests/nov-batch9-browser.test.mjs | 7 passed at 375 px and 1280 px; screenshots in docs/evidence/NOV_UPGRADES_BATCH_9 |
| npm run lint | 0 errors |
| npm run typecheck | Passed |
| npm run build | Passed; four `/tasks/commercial` routes built |
| npm test | 3,208 passed, 0 failed |

## Hosted migration state

Not applied. It can be applied independently of batch 8.

## Remaining acceptance

Pilot with real users: three bracket rules approved and ten prices recorded; two supplier claims through to a linked
credit; one order family compared with its estimate; promised dates recorded on ten purchase orders; outcomes for a
month of quotations; one rack of remnants reconciled; one batch of invoices imported into the accounting package;
a week of run proposals compared with what planning did; one breakdown scenario reviewed by a second planner.

# BUGS-MEGA continuation - 19 October 2026

> Historical checkpoint. On 20 October the user authorized migration application. R04-R11 and R17-R22 are now applied with current catalog/body/grant verification; completed expense/receivables/reporting work and two forward repairs are also applied. The [20 October application report](MIGRATION_RECONCILIATION_2026-10-20.md) supersedes the unapplied/reproduced statuses below and records 1,553 passing tests, current hosted evidence and remaining workflow acceptance boundaries.

This continues the 15 October report and preserves its historical reproductions.
The user's instruction, "DON'T RUN ANY SUPABASE MIGRATIONS," remains in force.
No Supabase migration runner, hosted write, deployment, commit or PR was used.
Candidate SQL was tested by extracting object definitions into disposable PGlite;
the prepared migration wrapper was not executed. Existing regression fixtures
also exercise historical SQL locally. Neither proves a hosted migration replay.

## R11 - Retained dispatch invoices after order cancellation

**Status: OPEN; LOCAL CANDIDATE VERIFIED, NOT APPLIED.**

The previous diagnostic reproduced an early action rejection before dispatch
lookup. Inspection also found the form excluding every cancelled order and the
latest SQL writer rejecting the parent stage. Removing only the action check
would leave the workflow blocked and would not establish which stock was shipped.

The prepared candidate lets owner, admin and accounts users invoice an existing
verified dispatched, in-transit or delivered shipment while the unfulfilled
remainder stays cancelled. Open-order packed invoices retain their existing
eligibility. A cancelled order's pending, returned, damaged or unknown-status
dispatch is ineligible. Creation, regeneration and source discovery share the
same private eligibility calculation.

Retained shipments require a same-company cancellation history timestamp, finite
dispatch creation/activation times in the correct order, activation no later than
cancellation, exact manifest/header weight, and a positive verified manifest in
kg, metres and whole pieces. Verification must precede activation and identify a
same-company user. Each source group must match its posted provenance:

- Reservations match the same order, profile, batch, dispatch and exact recorded
  consumption in all three units. Released/cancelled holds retain their posted
  consumption; no new stock debit occurs. Every posted reservation entry for
  the dispatch must also have a matching manifest group; unexplained extra
  consumption is contradictory evidence and prevents invoicing.
- Dealer stock matches an uncredited fulfillment recorded before activation.
  All activated dispatches using that fulfillment must fit its kg/metres/pieces.
- Production packing identifies the job in `source_line_id` and the parent order
  in `source_record_id`, matching the existing commercial-lineage trigger. The
  job must have completed before activation, and its total posted dispatch units
  must fit actual completed output.

Missing, nonfinite, foreign or contradictory historical evidence fails closed.
No packing verification, stock receipt, source identity or quantity is fabricated
to make a legacy record eligible. Such records require historical review.

The writer retains the existing packing canonicalization, deferred complete
manifest coverage, duplicate-invoice exclusion, commercial/GST derivation,
party snapshots, unpaid-edit gate and issued financial locks. It takes a
nonblocking manifest advisory lock and NOWAIT parent/dispatch/invoice row locks
before writing, to avoid waiting through an inverted delivery/packing lock path.
Real independent-session races remain a separate acceptance gate.

Existing receivables retain the same source while receipts and return credits
change their collection state. New invoices, reactivation and source changes
still revalidate the shipment. This preserves legitimate cash, credit-note,
refund and credit-reversal behavior after a shipment is returned.

The invoice form now searches authorized sources on the server in batches of 25,
with exact selected-ID lookup for an existing draft. It removes the 500-record
preloads and the unbounded list of already-used dispatches. Draft source controls
stay fixed; financially locked records render their lock before source lookup.
Search text clears the prior selection, stale responses cannot replace newer
results, and unavailable reads have an explicit error and disable submission.
The preview explains the retained shipment on a cancelled order.

The action reads the complete manifest in stable 200-row pages with an exact
count. Missing/changing counts, truncated pages, duplicate or malformed IDs and
excessive counts stop before the writer. The database still checks every packing
row at transaction completion, so a changed manifest cannot silently truncate
the invoice.

## Changes and verification

Created for R11:

- `lib/financials/invoice-sources.ts`: request/result validation and bounded RPC
  loader.
- `supabase/migrations/20261019000000_retained_dispatch_invoices.sql`: prepared,
  unapplied seven-function candidate and replacement header-trigger attachment.
- `scripts/lib/retained-invoice-fixture.mjs` and
  `scripts/lib/retained-invoice-actions-fixture.mjs`: historical typed tables,
  actual invoice/packing/financial objects, synthetic session and SQL transport.
- `tests/retained-dispatch-invoice.test.mjs` and
  `tests/invoice-source-actions.test.mjs`: SQL and actual-action edge regressions.
- `scripts/qa-retained-dispatch-invoices.mjs`: interactive actual invoice form
  with real actions/public SQL, local transport and built application CSS/fonts.
- This dated report.

Modified for R11: the invoice form and actions; deployment REST contract and
read-only catalog preflight; audit integration fixture/test; the existing
financial-closure assertion to follow server source search; and
`scripts/audit-cancelled-order-invoice.mjs`, which now verifies the current local
candidate. The original failing diagnostic JSON and the 15 October baseline are
preserved. The consolidated `BUGS-MEGA.md` records the final candidate status and R12.

Security/database scope: one authenticated read RPC is added. Its company comes
from the active database identity, and only owner/admin/accounts may call it.
Anonymous execute and direct execution of private implementations/trigger bodies
are revoked. The save/replace public signatures stay unchanged. No new table,
index, RLS policy, physical-stock write or general financial-write grant is added.
The existing financial SELECT policies continue to prohibit direct table writes.

The baseline SQL fixture initially failed both retained-shipment positive checks;
normal open-order and returned/damaged checks passed. The final focused tests
exercise real public writers, the actual server action and deferred coverage.
They cover all three retained statuses and source families; cancellation timing;
missing/foreign/late/nonfinite evidence; exact quantities and provenance;
duplicate invoices/packing rows; forged pricing; rollback after a late line
failure; role/tenant/inactive/anonymous/private-ACL boundaries; unpaid edits,
regeneration and issued locks; literal search and an order behind 601 newer
records; and a 1,201-row manifest across seven complete pages.

The financial integration records a real local invoice of INR 1,180, a cash
receipt of INR 1,180, a return credit of INR 1,180, a cash refund of INR 180 and
credit reversal. Resulting receivable/credit balances are checked at each step.
Physical stock, posted consumption, dealer fulfillment and movements stay
unchanged throughout invoice/settlement work.

Source audit refinements caught and corrected the production source identity,
foreign verification identity, nonfinite/future timing, invalid units across
other posted dispatches, orphan posted consumption, and the manifest advisory-lock order. Browser audit
also added a regression for reselecting the same order without leaving the
dispatch search busy. Initial full regression caught a catalog-query placement
incompatibility with an earlier preflight fixture; the new query now precedes
the older marker-delimited sections and the affected 29-test group passes.

Final results:

- `npm test`: **919 passed / 76 suites**, zero failures, skips or cancellations.
  R11 adds **43 SQL + 19 actual-action tests**, 62 above the preceding 857-test
  checkpoint. After the last fixture-seed cleanup, all seven affected alternative
  source/orphan regressions were rerun and passed.
- `npm run lint`: passed. The final changed fixture is also checked separately.
- `npm run typecheck`: passed.
- `npm run build`: passed, 153 pages generated.
- The affected existing direct-order, audit-integration and financial-closure
  group: 29 passed after the preflight placement repair.
- The current action smoke: passed, INR 1,180 invoice and unchanged physical
  stock. The final SQL-backed browser run: passed at all four widths with zero
  page errors, nine R11 screenshots and one separate R12 diagnostic.
- `git diff --check`: passed. File-only ledger reconciliation exits nonzero
  as expected because no hosted ledger export was supplied; it writes no data.

The local R11 candidate is verified. The issue remains OPEN because the schema
candidate is unapplied and hosted acceptance is pending. At this checkpoint R12
was the next reproduced issue; its continuation is recorded below. No claim of
a completed overall audit or deployed fix is made.

## R12 - Focused source selector cannot reopen on click

**LOCALLY FIXED after recheck and audit.** This was a separate pre-existing behavior in
`components/ui/searchable-select.tsx`. Before the repair, choosing an option
closed the list while the input kept focus. A subsequent click did not run
`onFocus`, so the list stayed closed. Typing or blurring/refocusing opened it. A normal
operator can reasonably expect the click to reopen the options.

The original actual-component browser diagnostic checked that the source input
retained focus, clicked it again and observed zero matching option buttons;
blurring/refocusing made the same option available. The R11 journey used the normal
blur/refocus path to reselect the same order, independently proving that R11 does
not strand dispatch search in a busy state. No shared selector code was changed
for R11. `results.json` separates this reproduced finding from R11 acceptance,
and `desktop-focused-select-diagnostic.png` records the closed state.

The focused reproduction suite, `tests/searchable-select.test.mjs`, initially
failed eight of twelve cases against the original component. Thirteen cases
now pass after a shared-control repair, including an additional composition-key
guard. Tests bundle the actual React component, run it in Chromium and observe
real DOM focus, mouse/touch/keyboard events, parent change/search callbacks and
enclosing form submissions. No simplified implementation is substituted.

The component now reopens from a click while still focused and from ArrowDown
when closed. Reopening does not fire a search or change the selected value.
Clicking an open control preserves the filter. Escape retains its previous
selection-restoration behavior. Focus can move between the input and option
buttons without the delayed close removing the keyboard target; outside blur
still closes, refocus cancels the timer, and unmount cleans it up. Enter on an
open empty/pending list cannot submit the enclosing form, pending results are
hidden until fresh options arrive, and composition Enter does not choose a row.
Disabled controls and clear-selection behavior are covered as well.

The source audit found eleven consumer files: dealer inventory entry, dies,
dispatch entry, invoice entry, payment entry, billet allocation, quote-backed
order entry, direct priced order entry, generic operations forms, quotations and
profile forms. Their component prop contracts remain unchanged. Static and
remote-search consumers compile through the required gates. Actual direct-order
and retained-invoice journeys are rerun separately with the built CSS/fonts and
their disposable SQL/action fixtures; this does not imply authenticated UAT of
all eleven modules.

Created: `scripts/lib/searchable-select-browser-fixture.mjs` and
`tests/searchable-select.test.mjs`. Modified: the shared selector,
`scripts/qa-retained-dispatch-invoices.mjs` (its old expected-failure diagnostic
becomes a positive reopening regression), `README.md` (browser runtime and local
check instructions), and this report/register. The original
R11/R12 diagnostic JSON and screenshot in the earlier evidence directory are
preserved. R12 results are written to the new `searchable-select-reopen`
directory; the earlier R11 evidence is not overwritten.

The new browser tests use the already-present Playwright package and require its
Chromium binary to be installed. No npm dependency, database migration, RLS/grant
change, business action, stock mutation or hosted write is added by R12.
Final R12 gates all pass:

- `npm test`: **932 passed / 76 suites**, zero failures/skips/cancellations.
- Focused actual-component browser suite: **13 passed**. The original twelve
  checks had eight failures before the component change; the composition guard
  was added during the keyboard audit.
- `npm run lint`, `npm run typecheck`, `npm run build`: passed; build generated
  153 pages. Typecheck and build were run sequentially.
- `scripts/qa-retained-dispatch-invoices.mjs`: passed at four widths, zero page
  errors, ten screenshots including the positive focused-reopen regression;
  actual local invoice totals/locks and unchanged physical stock still match.
- `scripts/qa-direct-orders.mjs`: passed at four widths, zero page errors,
  including actual direct order save, duplicate-submit suppression, lost-response
  retry and quotation/direct route choice. The quotation child remains a fixture
  boundary, not a full quotation UI journey.
- Source audit and `git diff --check`: passed. Desktop reopening, compact invoice
  and mobile direct-order screenshots were visually inspected.

Evidence root:
`C:/Users/arnav/.codex/visualizations/2026/10/15/01a13e40-ffdd-7a00-86c5-fe3b2d0a5d19/searchable-select-reopen/`.
It contains baseline/focused/full-test/lint/typecheck/build logs, retained-invoice
and direct-order browser results/images, and the separate R13 diagnostic below.

Manual follow-up checklist: click/tap a selected source without leaving its
input; reopen with ArrowDown and select with Enter; Tab to an option and then
outside; clear and reopen; test an empty/pending remote search without submitting;
and confirm each operator's actual form and permissions in a separately
authorized deployed environment. Local tests cover these control interactions;
they do not establish hosted UAT for every consumer.

## R13 - Dispatch source request race reproduced during consumer audit

**Historical reproduction; subsequently locally fixed below.** `DispatchFormClient` lacked request ownership in
the source-loading effect. The new standalone diagnostic
`scripts/audit-dispatch-source-switch.mjs` bundles the actual component with a
synthetic catalogue and manually ordered source responses. It selects A, then
B, resolves B and selects B's source, then resolves the older A request. The
selected order still says `ORDER-B - Synthetic buyer`; B's bundle selection is
cleared, and the options now offer `A profile | reservation A source | 10.000 kg`.

The diagnostic returns `findingConfirmed: true`, saves
`dispatch-source-diagnostic/results.json` and its screenshot, and verifies zero
save calls and page errors. It demonstrates a UI race, not server acceptance of
cross-order sources or any physical stock misallocation. No dispatch form/action
or database guard was changed for this finding.

The next work at that checkpoint was to establish failing actual-component tests for overlapped source
and order searches, selection invalidation, rejected transport, loading/error
ownership and attempts to submit stale data, then repair the parent form and
verify its server/source boundary before marking fixed. That remediation is now
recorded below; the original diagnostic remains preserved. The overall goal remains open.

## R13 - Request-owned dispatch preparation verified locally

**LOCALLY FIXED after recheck and audit.** The actual-component baseline failed
21 of 22 checks before the dispatch form changed. The final suite has 31 real
Chromium/DOM cases plus one new actual-action cross-order rejection case. The
combined focused run, including the ten existing reservation-action checks,
passes all 42 cases.

Order searches and source reads now own their results, pending state and errors.
An older response cannot replace the current order's material or measurements,
clear another request's loading state, or update a remounted company/unmounted
form. Search and changed selection immediately invalidate material; reselection
of the same confirmed order preserves measurements. Empty results are separate
from failed reads, with explicit retry and source refresh controls. The audit
also removed initial bundle autofocus because clearing a manifest during order
typing otherwise stole focus before the remote catalogue returned.

The new `lib/dispatches/preparation.ts` validates catalogue/source identity and
quantities and reuses `buildVerifiedPackingListItems` for measured manifests.
Client validation covers source membership, kg/metres/pieces, cumulative usage,
duplicate tags and non-finite/malformed evidence. It does not replace the
server's fresh company-scoped source read and packing validation. Submission is
locked while pending and after verified success. A thrown or malformed positive
confirmation locks the form and links to `/dispatches/database` for record
review; a handled rejection preserves the measurements. No durable public
dispatch-creation idempotency was added.

Tests cover A-to-B and A-to-B-to-A overlap, old success/failure/finalizers,
changed/cleared searches, catalogue failure/retry, source failure/retry, verified
empty data, company remount/unmount, stale save completion, duplicate submit,
malformed confirmation, disabled/locked controls, malformed/duplicate source
IDs, invalid quantities/provenance, per-bundle and combined quantity limits,
and valid reservation, dealer-stock and production source payloads.

Created: `lib/dispatches/preparation.ts`,
`tests/dispatch-form-consistency.test.mjs`,
`scripts/lib/dispatch-form-browser-fixture.mjs` and
`scripts/lib/dispatch-action-boundary-fixture.mjs`. Modified:
`components/modules/dispatch-form-client.tsx`,
`tests/dispatch-reservation-availability.test.mjs` and
`scripts/audit-dispatch-source-switch.mjs`, plus the register/progress records.
The original failing diagnostic under R12's evidence directory is retained.
No SQL, migration, RPC signature, RLS/grant, dependency or hosted write changed.

Final R13 verification:

- `npm test`: **964 passed / 76 suites**, zero failures/skips/cancellations.
- Focused dispatch component/action suite: **42 passed**; 32 new tests beyond
  the 932-test R12 checkpoint.
- `npm run lint`, `npm run typecheck`, `npm run build`: passed; 153 pages
  generated. Typecheck and build ran sequentially.
- Browser QA: passed at 1440, 820, 390 and 320 pixels, six screenshots and zero
  page errors. Desktop/compact-mobile manifests and the mobile uncertain-save
  state were visually inspected with the built CSS/fonts.
- Each UI manifest passes through the actual `saveDispatchAction` with a fresh
  company-scoped synthetic read adapter. It assembles the exact B-source atomic
  RPC for 5 kg / 2.5 m / 1 piece. Cross-order material, current availability
  reduced to 2 kg, and a viewer role all reject before that writer.
- Final source audit, scoped diagnostic lint and `git diff --check`: passed.

Evidence root:
`C:/Users/arnav/.codex/visualizations/2026/10/15/01a13e40-ffdd-7a00-86c5-fe3b2d0a5d19/dispatch-preparation-consistency/`.
It contains `baseline.log`, `focused-final.log`, `full-test.log`, lint/typecheck/
build logs, browser results/screenshots and the separate R14 diagnostic.

The browser/action fixture captures the assembled atomic RPC; it never invokes
a database writer. This establishes neither a persisted dispatch, physical-stock
outcome, hosted JWT/RLS behavior nor independent-session concurrency. Manual
acceptance still needs overlapping order changes on the deployed form, deliberate
failed reads/retry, manifest/source checks and record review after lost save
confirmation under an authorized operator session. No Supabase migrations ran.

## R14 - Packing-history API cap reproduced

**Historical reproduction; subsequently locally fixed below.** The next source audit found a separate unbounded
packing-history read in `loadDispatchSourceLines`. Dealer-stock and production
availability subtract packing rows fetched through a dispatch-ID list. Neither
enumeration guarantees a complete result under API row caps. R01 covers
reservation consumption through its existing aggregate, not these two families.

`scripts/audit-dispatch-packing-cap.mjs` exercises the actual read action with
company-scoped synthetic data and a 1,000-row cap. It separately checks valid
dealer-stock fulfillment and completed production with approved QC, completed
packaging and issued packaging material. In both cases, 1,501 packing rows of
1 kg / 0.5 m / 1 piece should leave 499 kg / 249.5 m / 499 pieces from the
original 2,000 kg / 1,000 m / 2,000 pieces. The action reads only 1,000 rows and
reports 1,000 kg / 500 m / 1,000 pieces. The JSON records both reads and totals.

Created: the diagnostic script; extended the synthetic action adapter with
optional read caps/observations. `packing-cap-diagnostic.json` lives in the R13
evidence root. It records zero stock-writing calls. Successful reproduction
does not prove database acceptance of overshipment and is not an acceptance
test for dispatch posting. No hosted query, database writer or migration ran.

The next work at that checkpoint was to add failing action tests for complete dispatch/packing enumeration,
later-page failures, all quantity units, exact lineage, tenant scoping and fresh
save validation; implement the smallest correct read repair; then rerun focused,
full, static/build and browser/action checks before changing this status.

## R14 - Complete packing-history read repair

**LOCALLY FIXED after final regression, recheck and audit.** The read repair and
focused/browser/static/full checks below are complete. The original failing diagnostic JSON remains in R13's evidence
directory, and `dispatch-packing-history/baseline.log` records 26 failures out of
31 checks before the product change (five existing valid behaviors passed).

`lib/dispatches/packing-history.ts` reads packing history directly through the
existing packing-to-dispatch foreign key. The inner relationship scopes both
packing and dispatch records by company and the dispatch by the selected order;
it avoids a capped dispatch-ID enumeration and a large URL list. Stable ID-sorted
ranges request at most 200 rows and exact counts. Offsets advance by actual rows
returned, so a smaller API cap also works. Missing/changing counts, unexpected
empty pages, repeated/out-of-order IDs, invalid identities/quantities and read
errors reject the complete operation instead of exposing partial totals.

The helper sums each exact physical source separately in kg, metres and whole
pieces. Integer thousandths avoid decimal drift across pages. The action uses
the same helper for source display and its fresh save-time validation. Editing
excludes exactly its own packing rows; prior returned/damaged packing remains
accounted for as before, without inferring a physical return or available stock
credit. Reservation consumption still uses its existing aggregate; production,
finishing, QC, packaging-material and credited-stock eligibility are preserved.

Created: `lib/dispatches/packing-history.ts`,
`tests/dispatch-packing-availability.test.mjs` and
`scripts/qa-dispatch-packing-history.mjs`. Modified:
`lib/actions/dispatches.ts`,
`scripts/lib/dispatch-action-boundary-fixture.mjs`,
`scripts/audit-dispatch-packing-cap.mjs` and the progress/register records. The
standalone read diagnostic becomes a positive regression and writes a different
JSON filename, preserving its failing predecessor. No migration, schema object,
RPC signature, RLS/grant, dependency, stock writer or hosted write was added.
Source review confirmed that the relationship and selected base columns already
exist in the local historical schema/grant definitions; hosted availability is
not established by that review.

Forty new tests cover both source families with 1,501 packing rows and 1,501
dispatches, API caps below page size, exact remaining/cumulative quantities,
fully shipped sources, repeated profiles with different source IDs, same-order
editing, foreign companies/orders, denied roles and fresh save rejection after
another shipment. Failure cases include returned/thrown later-page errors,
empty pages, changed/missing/oversize counts, duplicate/unsorted IDs, missing or
forged relationships, invalid identity, null/negative/non-finite quantities,
fractional pieces and unsafe sums. Forty deterministic generated decimal/page
cases also pass. A test of the installed Supabase client checks the actual GET
URL, inner relationship, both company filters, order filter, edit exclusion,
stable range/order and `Prefer: count=exact`, using synthetic intercepted
responses without a network request.

Final R14 verification:

- Focused packing/reservation actual-action suite: **51 passed** (40 new and
  11 existing), zero failures/skips/cancellations.
- Whole-repository `npm run lint`: passed; the final helper annotation also
  passed a scoped lint check.
- `npm run typecheck`: passed after adding an explicit `number` annotation for
  the loop count, fixing TypeScript's circular-inference diagnostic. The original
  failure and final passing log are retained.
- `npm run build`: passed, 153 pages generated; typecheck and build ran
  sequentially. No product runtime logic changed after the focused verification.
- `scripts/audit-dispatch-packing-cap.mjs`: both families now read all 1,501
  rows and return 499 kg / 249.5 m / 499 pieces, with zero stock-writing calls.
- Browser QA: both families pass at 1440, 820, 390 and 320 pixels, plus failed
  later-page retry and fresh-save rejection/refresh. Eleven screenshots, zero
  page errors and contained document width. Desktop dealer stock, compact-mobile
  production, unavailable-history and stale-manifest screenshots were inspected.
- Actual UI payloads pass through the actual save action with a fresh synthetic
  read adapter. Exact 499 kg / 249.5 m / 499-piece manifests assemble the correct
  atomic RPC; adding another packing row makes 498 kg available and rejects the
  stale 499-kg submission before that writer. Refresh shows 498 kg.
- The initial `npm test` run had 983 passing tests and one test-process failure:
  `tests/direct-order.test.mjs` exited with Windows code 3221226505 before its
  21 cases ran. All 21 pass in an isolated recheck and the complete rerun. The
  failed run is retained and is not counted as acceptance.
- Full-suite rerun with `node --no-warnings --test --test-concurrency=4
  --experimental-strip-types tests/*.test.mjs`: **1,004 passed / 76 suites**,
  zero failures/skips/cancellations, exit 0. This is the complete `npm test`
  command with bounded concurrency; no test is excluded. Final source review and
  `git diff --check` also passed.

Evidence root:
`C:/Users/arnav/.codex/visualizations/2026/10/15/01a13e40-ffdd-7a00-86c5-fe3b2d0a5d19/dispatch-packing-history/`.
It contains baseline/focused/read-regression/browser logs and JSON, screenshots,
the original full-test process failure, isolated recheck, bounded full run,
lint/typecheck/build logs and the final annotation check.

The read deliberately rejects more than 100,000 packing rows for one order and
invalid/unknown legacy identities or quantity evidence. It does not fabricate
missing units, truncate a large order silently, or repair historical records.
Exact counts detect observed changes between pages, but multiple REST reads do
not create a database snapshot or eliminate independent-session races. The
existing locked SQL writer remains the final posting authority. A missing or
unavailable relationship fails closed; real hosted schema/grants/RLS still need
separate acceptance.

Manual acceptance still needs a deployed operator's large-order history,
source identity/remaining quantities, exact and oversize manifests, a later-page
read failure/retry, editing and an intervening shipment before save. The local
browser/action fixture captures atomic RPCs without executing a database stock
writer: no persisted dispatch, physical-stock outcome, real JWT/RLS, hosted
query, migration or independent-session result is claimed. R14 is locally fixed;
R04-R11 remain verified, unapplied candidates, A00 and the broader investigations
remain open, and the overall goal stays active.

## R15 - Die-readiness contract mismatch reproduced

**Historical reproduction; subsequently locally fixed below.** After completing R14, the next investigation
compared the actual production queue, scheduling action and configurator handoff.
The scheduling action and current local SQL release/start/handoff definitions
use an active/approved allowlist. The readiness queue and configurator selection
use a shorter blocked-status list, so they accept intermediate and missing
statuses that scheduling rejects.

`scripts/audit-die-readiness-contract.mjs` renders the actual React queue and
calls the actual `saveProductionScheduleSlotAction` and
`handoffSystemConfigurationToProduction` with controlled company-scoped reads.
It checks all 16 statuses in the actual die master schema, plus empty, null and
unknown values. Eleven of those 19 cases disagree: design, ordered, received,
under-trial/trial, under-correction/correction, nitriding and empty/null/unknown
status appear ready and reach the captured handoff RPC while scheduling rejects
them. Active and approved are positive controls. The diagnostic records these
results rather than treating a captured call as database acceptance.

Source inspection also found generic production lookup/autofill excluding only
inactive/dead dies, and the older production client loading only active dies,
omitting approved. The dormant PCDA die gate permits additional warning statuses
and owner overrides. Graph/source review found only test callers for that gate;
its returned decision is not evidence of a reachable production bypass. A shared
contract must preserve actual server/SQL authority and exact profile identity.

Created: the diagnostic script; no R15 product file or database writer changed.
The first harness run incorrectly treated the refined die schema as a plain
object; unwrapping its existing refinement corrected that diagnostic setup, then
the complete 19-case run passed and recorded `findingConfirmed: true`. Its output
is `die-readiness-contract/die-readiness-diagnostic.json` under the same session
evidence root. Diagnostic ESLint is checked separately. The product's latest
full regression remains the 1,004-test R14 checkpoint; it does not fix R15.

No Supabase request/migration, SQL writer, actual production job, hosted JWT/RLS,
release/start or independent-session result is proved. The next work at that checkpoint was to establish
failing consumer tests, share the active/approved readiness/selection contract,
test missing/unknown status and valid approved dies, preserve current tenant and
profile checks and fresh execution validation, then rerun focused, full,
lint/typecheck/build and browser/action verification before marking R15 fixed.
The overall goal stays active, with no migrations authorized.

## R15 - Shared production-die contract remediation

**LOCALLY FIXED after final regression, recheck and audit.** The repair aligns the
existing active/approved scheduling rule across the readiness queue, new/older
production forms, generic die lookup/autofill, configurator handoff and dormant
PCDA gate. `lib/workflow/production-dies.ts` owns the two usable statuses and the
exact-profile predicate. No SQL, migration, public RPC, RLS/grant or dependency
change is needed; current database revalidation remains the posting authority.

The queue now requires a named die with usable status matching the order's
production profile. Its existing company-scoped page query includes the two
profile IDs needed for that check. The older production form includes approved
dies. Generic production/order lookup filters usable status before its 40-row
limit; visible choices require an exact known profile. Autofill uses fresh
linked-die profile/status evidence and does not silently replace an unusable
explicit assignment. It provides review guidance and allows an operator to
choose an eligible replacement. After profile autofill, a request-owned lookup
refreshes that profile's choices, including when the original company preview
contains 45 other-profile dies.

The final history-display audit preserves an unavailable assigned die in the
read-only order field with an explicit unavailable-for-production label. That
display does not offer it as a new production choice. A dedicated actual-browser
regression and mobile screenshot cover the distinction. The local base schema
also declares `dies.die_status` NOT NULL; the extracted SQL status-matrix fixture
retains that constraint, while application reads reject unknown/missing status.

Configurator handoff filters eligible statuses before reading candidates,
selects a matching die in stable ID order and fails when none is usable. Server
production creation/scheduling reuse the shared status rule and retain existing
company, profile, order, press, source-line and billet checks. The dormant gate
keeps its optional owner parameter for compatibility but cannot promise a die
override that current scheduling/release/start does not support. Other PCDA gates
and their independent override rules are unchanged. Die master lifecycle values
and historical records remain intact.

Created: `lib/workflow/production-dies.ts`,
`scripts/lib/die-readiness-action-fixture.mjs`,
`scripts/lib/die-readiness-browser-fixture.mjs`,
`tests/die-readiness-contract.test.mjs`,
`tests/die-readiness-browser.test.mjs`,
`tests/die-readiness-sql.test.mjs` and
`scripts/qa-die-readiness-contract.mjs`. Modified:
`app/(dashboard)/production/page.tsx`,
`components/modules/production-planning/production-readiness-queue.tsx`,
`components/modules/production-client.tsx`,
`components/modules/operations/record-form-client.tsx`,
`lib/actions/production.ts`, `lib/systems-configurator/actions.ts`,
`lib/workflow/pcda/gates.ts`, `scripts/audit-die-readiness-contract.mjs`,
the three existing gate/security tests and this register/report. The standalone
diagnostic writes a new positive-regression filename; its original failing JSON
and baseline logs remain preserved.

Final R15 verification:

- The action/rendering baseline failed 22 of 28 cases before the product change.
  It covers all 16 master statuses plus empty/null/unknown/case/whitespace values,
  exact-profile/missing die evidence, current status changes, valid alternatives,
  failed reads, denied roles and closed-order scheduling. The final matrix calls
  actual production creation, scheduling and configurator actions.
- The initial six-case browser run had five failures; one was an overly specific
  harness expectation of approved rather than the valid sorted active choice.
  That expectation was corrected. Four cases exposed product defects: unusable
  explicit assignment, loose choices, the capped lookup and the missing approved
  option in the older form. The initial harness also needed the real Save button
  label. A separate crowded-other-profile regression failed before the final
  profile-refresh repair. These intermediate logs are retained.
- **55 new tests pass:** 28 actual-action/rendering cases, ten Chromium/DOM
  cases and 17 cases using the existing SQL release/start trigger definitions in
  disposable PGlite. The focused group including existing gate/security/handoff
  tests passes **95 checks**, zero failures/skips/cancellations.
- Whole-repository lint and final typecheck pass. Typecheck initially exposed the
  generic lookup type's undeclared die metadata; those fields are now typed
  explicitly. The compatibility gate's relative import uses the repository's
  supported `.ts` extension so direct Node TypeScript tests also resolve it.
- The standalone 19-status action/rendering regression now has zero mismatches.
  No captured handoff is treated as database acceptance.
- Browser QA passes the queue and both forms at 1440, 820, 390 and 320 pixels,
  plus unavailable assigned-die review, manual replacement, stale-status save
  rejection, crowded-profile lookup and read-only history display. Sixteen screenshots, zero page errors
  and contained document width. Desktop queue and mobile review/approved-form
  images were inspected. The first QA assertions were corrected for CSS uppercase
  labels, and the valid submission journey now chooses its press explicitly.
- Actual UI payloads pass through the actual production-save action with a fresh
  synthetic read adapter and preserve exact company/profile/order-line/die IDs.
  Changing that die to maintenance after selection rejects before any write RPC
  and leaves success navigation empty. The adapter captures the atomic write;
  no database production writer executes.
- The complete `npm test` run passed **1,058 tests / 76 suites** before the last
  history-display refinement. After that refinement, the complete rerun with
  `node --no-warnings --test --test-concurrency=4 --experimental-strip-types
  tests/*.test.mjs` passes **1,059 tests / 76 suites**, zero failures/skips/
  cancellations, exit 0. No test is excluded. Final lint, typecheck, the 95-check
  focused group and build (153 pages) pass. Final source review and
  `git diff --check` pass. R15 is locally fixed.

Evidence root:
`C:/Users/arnav/.codex/visualizations/2026/10/15/01a13e40-ffdd-7a00-86c5-fe3b2d0a5d19/die-readiness-contract/`.
It contains the original diagnostic, pre-fix action/browser and profile-preview
baselines, final focused/static logs, positive contract JSON, browser JSON/images
and the complete full-suite/build logs.

This local proof does not establish an actual persisted job/schedule, material
issue, full operator release/start journey, production stock result, hosted
JWT/RLS or independent-session race. SQL tests install only existing extracted
trigger definitions in a disposable synthetic fixture; no Supabase migration
wrapper runs. Manual acceptance still needs the deployed queue and both form
entry points, approved/active and unusable/unknown/mismatched dies, stale status
before save/release/start, explicit replacement, company/role denial and the
complete authorized order-to-press workflow. The overall goal stays active.

## Scrap posting and recovery - Initial source investigation

The next source pass covers the remaining factory-control question from the
4 October report. The current completion transaction adds existing recorded
scrap to the new completion quantity, and the completed-scrap trigger guards
insert/update/delete against finalized jobs. The public wrapper authorizes one
completion scrap insert in its transaction. A later exact completion retry
reaches a private function that requires an in-progress job. These are source
findings, not dedicated repeated-post acceptance evidence.

Next work is to exercise exact/changed completion retries, external duplicate
scrap inserts after completion, edited/deleted/reparented scrap, rollback after
failed completion, and reconciliation of actual billet input, good output,
scrap and recovery/report totals. Preserve legitimate separate pre-completion
scrap entries rather than inferring duplication only from equal quantities.
Production scrap must not be treated as automatically available foundry/remelt
stock without its transfer evidence. No new scrap defect is marked confirmed
from this source pass, and the broader investigation remains open. The executed
continuation is recorded below.

## Scrap posting - Twelve executed controls pass

No posting defect was confirmed in these completed-job scenarios. Created
`scripts/lib/production-scrap-fixture.mjs`,
`scripts/audit-production-scrap-repeat.mjs` and
`tests/production-scrap-repeat.test.mjs`. The fixture extracts existing completion,
authorization/immutability, billet-consumption, handoff and order-stage function
definitions into disposable PGlite, retaining historical table columns and
numeric precision. No Supabase migration wrapper runs. The initial fixture
needed the actual order-stage helper; that setup was corrected before results
were recorded, rather than classified as a product defect.

Twelve scenarios pass as 13 Node tests including the enclosing case:

- The actual public completion wrapper under a synthetic authenticated SQL role
  records 100 kg input, 95 kg good output and one 5 kg scrap row; consumes one
  billet; creates one packaging handoff and one stage event; and removes its
  transaction authorization. Existing remelt stock remains 20 kg.
- Exact and changed completion retries, including a retry in a later committed
  transaction, reject without adding scrap, handoffs or stage history. Rejection
  is the current behavior; successful retry acknowledgment is not claimed.
- Three repeated external inserts on the completed job reject. Editing,
  deleting, unlinking, reparenting and changing company identity on its scrap
  reject. Moving another job's scrap onto the completed job also rejects.
- Early mass-balance failure and a forced late scrap-insert failure both roll
  back output, billet consumption, packaging, order stage/history and private
  authorization. Removing the synthetic failure allows one normal completion.
- Separate legitimate pre-completion entries of 2 kg and 1 kg plus a new 2 kg
  completion entry reconcile to 5 kg scrap. Equal quantities alone are not
  classified as duplicate business events.
- Consumed billet weight cannot be rewritten. The actual recovery helper reads
  100 kg recorded input and 95 kg output as 95 percent recovery; absent input
  returns unknown rather than an output-plus-scrap proxy. Denied completion
  roles and foreign job IDs reject without changing the target evidence.

Evidence root:
`C:/Users/arnav/.codex/visualizations/2026/10/15/01a13e40-ffdd-7a00-86c5-fe3b2d0a5d19/production-scrap-reconciliation/`.
`scrap-repeat-controls.json` records names, observed ledger totals and the actual
recovery-helper result. Focused tests pass; final suite/static/build verification
is recorded at the completed checkpoint below. SQL identity/transport are
synthetic. This is not real JWT/RLS, concurrent-session, full browser/operator,
physical remelt transfer or complete reporting acceptance.

## Initial R16 reproduction checkpoint

**Historical status: OPEN; REPRODUCED, NOT FIXED.** This preserves the pre-fix
checkpoint; the verified R16 remediation follows below. Checking the report path after those
controls found a separate defect in `buildProductionBatchReportModel`.
`scripts/audit-production-report-reconciliation.mjs` uses the actual completion
and handoff functions, installs the actual authorized production projection and
calls the actual report-readiness gate and builder over the persisted fixture.
Only company/user display metadata and SQL session identity are synthetic.

The fixture stores earlier PCDA input/output values before final completion.
Completion correctly captures its actual output and ledger, but the ready report
prefers those old snapshot fields and never reads billet or scrap evidence:

| Field | Recorded evidence | Ready report model |
| --- | --- | --- |
| Billet input kg | 100 | 80 |
| Good output kg | 95 | 70 |
| Scrap kg | 5 | Not Captured |
| Recovery percent | 95 | Not Captured |
| Scrap percent | 5 | Not Captured |

The diagnostic asserts the mismatch and preserves its complete model and scoped
read inventory in `production-report-reconciliation/production-report-diagnostic.json`
under this session's evidence directory. It exits 0 only because the undesired
behavior was reproduced; this is not a passing report acceptance test. The
database's 100/95/5 kg reconciliation and the earlier posting controls remain
intact. No report builder or production writer changed for this reproduction.

Next work is to add failing report/model tests for actual versus source-snapshot
values, complete company/job-scoped input/scrap reads, large histories and failed
later pages, explicit unknown/zero semantics, status/legacy records and
role/tenant boundaries; repair the authoritative read/calculation path; and
verify exports/rendered output plus full gates before marking fixed. No hosted
request, Supabase migration, PDF visual acceptance or independent-session result
is proved. The broader investigation and overall goal stay active.

## Scrap investigation verification checkpoint

- Focused `tests/production-scrap-repeat.test.mjs`: **13 passed**, comprising
  twelve SQL/recovery scenarios and their enclosing case.
- `npm test`: **1,072 passed / 76 suites**, zero failures/skips/cancellations,
  exit 0. No product source changed during this investigation; the 13 tests
  extend the prior 1,059-test R15 checkpoint.
- `npm run lint`, `npm run typecheck`, `npm run build`: passed; build generated
  153 pages. Typecheck completed before build started. `git diff --check` passed.
- Standalone scrap-control audit: passed all twelve scenarios and saved observed
  ledger/recovery totals. The report diagnostic independently reproduces R16;
  successful reproduction does not establish correct reporting.
- No production writer, report builder, migration, RLS/grant, dependency, hosted
  data or deployment changed. The new fixture and diagnostics use only local
  disposable data and extracted existing SQL objects.

The main test/static/build logs are in the `production-scrap-reconciliation`
evidence directory; the report model diagnostic has its separate evidence
directory. R16 is OPEN; REPRODUCED, NOT FIXED, and is the next remediation task.
R04-R11 remain verified, unapplied candidates. A00, hosted/concurrent/operator
acceptance, physical remelt provenance and the broader investigation stay open.

## R16 - Production report reconciliation locally fixed

**LOCALLY FIXED after recheck, edge tests, full regression and report audit.**
The initial reproduction and scrap-only checkpoint above remain historical.

`buildProductionBatchReportModel` now uses `actual_quantity_kg` and the complete
company/job-scoped billet and scrap ledgers. New
`lib/reports/pcda/production-evidence.ts` validates exact counts, stable ID-sorted
pages, eligible billet statuses, identities, nonnegative recorded weights,
three-decimal precision and integer-safe totals. It advances by returned row
counts for smaller API caps, rejects failed/incomplete/changing evidence and
rechecks authorized job identity, revision time, status and output after reading.
Histories above 100,000 rows per ledger fail explicitly.

The report now shows 100 kg input, 95 kg good output, 5 kg recorded scrap,
95 percent recovery and 5 percent scrap for the original completed fixture,
despite its old 80/70 kg source snapshots. Missing billet input remains unknown;
output-plus-scrap and planned/source quantities never supply a denominator or
final output. Zero/default completed output is not treated as captured because
the existing completion contract requires positive output. Empty scrap history
means zero *recorded* scrap only with completed, captured input/output; missing
legacy evidence stays unknown. Final recovery is unavailable before completion.
Recorded balance difference and the existing completion tolerance (the greater
of 0.5 kg or one percent of input, rounded to 0.001 kg) are visible, so missing
scrap is not silently treated as accounted loss. The existing rejected quantity
is explicitly labeled as a source snapshot. QC-result reconciliation was not
implemented or claimed.

Verification:

- `tests/production-report-reconciliation.test.mjs`: **59 passed**, including
  its enclosing case. Actual builder, readiness, customer wrapper, report action
  and serializers run over a synthetic REST/session/Storage adapter. The initial
  53 scenario baseline had 49 failures, including two native-Node dynamic-import
  harness failures; those two were resolved by transpiling the actual wrapper
  to CommonJS. Product evidence also includes the preserved original SQL/model
  diagnostic. No report business function is replaced with a mock.
- `tests/production-report-sql.test.mjs`: **eight passed**, comprising seven
  scenarios and their enclosing case. Actual existing completion/handoff SQL and
  the actual authorized production view run over disposable persisted data,
  including lossless completion, absent legacy input, in-progress output,
  all four permitted report roles and 1,201 billet plus 1,201 scrap rows.
- Edge cases cover smaller API caps, later-page errors, missing/changing/oversized
  counts, premature empty/overfull pages, malformed/foreign/duplicate/unordered
  evidence, unsupported weights, zero scrap versus missing input/output,
  unexpected statuses, job changes, commercial-field omission, denied roles,
  exact large/ordinary decimals, overflow and 32 deterministic generated histories.
  Four extra balance-threshold controls pass at and 0.001 kg beyond both the
  0.5-kg minimum and one-percent tolerance. The PDF-only template contract stays
  unchanged; direct CSV/Excel serializer checks do not claim those UI exports.
- Standalone `scripts/audit-production-report-reconciliation.mjs` passes all
  seven persisted scenarios and saves `production-report-regression.json` plus
  five actual-action PDFs. The original `production-report-diagnostic.json`
  remains untouched. Report generation leaves the observed production, billet,
  scrap, packaging, stage/history, authorization and remelt totals unchanged.
- All five PDFs (completed, lossless, missing-input, large-history, in-progress)
  render as one page and were visually inspected. PDF text extraction matches
  all **35** checked model fields; every text character is within page bounds.
  Poppler emitted a non-fatal Symbol fallback-font notice; the inspected report
  text uses Helvetica and is readable. The bundled extraction runtime lacked
  PyMuPDF; available pdfplumber completed the independent text/bounds check.
- Final `npm test -- --test-concurrency=2`: **1,139 passed / 76 suites**, zero
  failures/skips/cancellations, exit 0. The earlier 1,138-test pass preceded the
  last precision regression and is preserved separately. Focused final group:
  **67 passed**. `npm run lint`, `npm run build` (153 pages), the final standard
  `npm run typecheck`, source audit and `git diff --check` pass.
- Early standard typecheck attempts failed in generated `.next-dev` route types
  containing stale appended text. The normal production build regenerated its
  production types/reference, and the final standard check passed. No manual
  generated-file repair, TypeScript/Next configuration edit, suppression or
  dev-server restart was used. A representative failure log is preserved.

Files created: `lib/reports/pcda/production-evidence.ts`,
`scripts/lib/production-report-action-fixture.mjs`,
`tests/production-report-reconciliation.test.mjs` and
`tests/production-report-sql.test.mjs`. Modified: the report builder, the existing
report diagnostic (now a regression audit) and the three issue/progress ledgers.
No production writer, SQL/migration, grant/RLS, dependency, hosted data or
deployment changed.

Evidence root:
`C:/Users/arnav/.codex/visualizations/2026/10/15/01a13e40-ffdd-7a00-86c5-fe3b2d0a5d19/production-report-reconciliation/`.
It contains original/baseline evidence, current models and scoped reads,
focused/full/static/build logs, threshold controls, five PDFs/renders and
`pdf-extraction.log`. Metadata/session identity, REST and Storage transport are
synthetic; uploads and report history are captured, without a hosted write.
Real JWT/RLS/Storage, independent-session atomic snapshots, deployed schema,
physical inventory and broader QC/report/operator acceptance stay open.
R04-R11 remain verified, unapplied candidates; A00 and the overall goal remain
open/active. The no-Supabase-migrations instruction remains in force.

## R17 - Terminal finishing movement evidence candidate

**OPEN; LOCAL CANDIDATE VERIFIED, NOT APPLIED.**

The finishing investigation exposed a narrower gap in Astra 13's terminal
controls. Actual current finishing guards reject changed weights and remarks,
but a same-status public RPC can change a completed job's vendor and sent/receipt
dates without a new history event. Deletion and changes to other terminal
evidence fields also remain possible. The private RPC defaults omitted dates
to today before considering recorded dates, so even an unchanged retry or
completion of an earlier receipt can silently replace movement evidence.

The disposable fixture runs actual production completion/handoff, finishing
completion/transition/retry functions, the current Astra guard and actual
history/packaging triggers. It retains historical column names/types, the
status-history cascade FK, retry-source restrictive FK and one-retry unique
index. Only session identity and generic historical table setup are synthetic;
it is not a full schema replay. Original evidence has 95 kg finishing input,
90 kg accepted, 5 kg rejected, four history events and one 90-kg packaging
handoff. Vendor/dates change after completion while history and handoff do not.

Prepared `supabase/migrations/20261019010000_terminal_finishing_evidence.sql`
adds a private trigger guarding every update/delete on completed, rejected or
`not_required` rows. A whole-row comparison excludes only `updated_at`, retaining
all current and future business fields without a partial column list. It blocks
terminal deletion and preserves its cascading status history. The revised
private transition function preserves recorded sent/receipt dates before using
today for a new movement. Authentication, role/company/vendor scope, row lock,
quantities, remarks and return value match the original implementation; an
independent source comparison verifies only the date-expression change plus
formatting. Public RPC signatures, grants and RLS remain unchanged. Direct
execution of the guard and private writer remains revoked. The candidate
migration wrapper was not executed by this task.

Forty-two scenarios and their enclosing Node test pass, adding 43 tests beyond
the 1,139-test R16 checkpoint. Coverage includes:

- Completed/rejected vendor, planned/sent/received date, shade/color, branch,
  plant and creation-time mutation; direct and public-RPC paths; terminal
  deletion, source/route/quantity/status/remarks locks and later-added evidence.
- Active movement edits; preserved earlier receipt on completion; exact optional
  and explicit retries, repeated retries and a retry after a committed
  transaction; unchanged packaging/status history; legacy `not_required` and
  missing-receipt data. Legacy rows are seeded only with test fixture trigger
  changes; product enforcement is not disabled by the candidate.
- One corrective retry with immutable rejected source, duplicate-creation
  rejection, successful retry handoff, late packaging failure rollback and
  rollback when corrective-history insertion fails. No concurrent-session
  guarantee is inferred from these sequential tests.
- Compound active/terminal updates roll back atomically. Timestamp-only
  maintenance remains allowed. All five intended SQL roles retain access;
  denied roles, missing identity, foreign company and private-function calls
  reject. Actual local trigger event mask, enabled status and ACLs are checked.
- The read-only R17 preflight checks private bodies/hashes and the attached
  update/delete guard. The final six-file focused group passes **136 tests**,
  including every other preflight consumer and candidate coexistence with
  authorized views/masks. Integration now installs 28 prepared function
  definitions and eight trigger attachments alongside eight historical audit
  scripts. Extracted R17 objects are used, never its migration wrapper.

The first baseline had 27 failing scenarios out of 33; six control scenarios
passed. The baseline log includes its failed enclosing case (34 total tests,
six pass / 28 fail). Expanded final coverage is separate. Two subsequent full
runs exposed section-parser assumptions in older preflight tests. The R17 query
was placed after existing sections, and the credit-settlement consumer now
bounds its query to its intended statement instead of consuming the rest of the
file. Their original behavior/assertions remain tested; both failing full logs
are preserved. The six-file final rerun passes.

Final verification:

- `tests/finishing-evidence.test.mjs`: **43 passed**, comprising 42 scenarios and
  their enclosing test. The six-file finishing/integration/direct-order/credit/
  cancellation/retained-invoice group passes **136 tests**.
- `npm test -- --test-concurrency=2`: **1,182 passed / 76 suites**, zero failures,
  skipped or cancelled tests; exit 0. This is the complete final rerun after
  both older preflight consumers and the last legacy-receipt test were checked.
- `npm run lint`: passed without warnings. `npm run typecheck`: passed. Build
  started after the full suite and standalone typecheck completed;
  `npm run build` passed with 153 generated pages. `git diff --check` passed.
- Standalone candidate audit passes, with unchanged observed terminal business
  evidence, history, handoff and production totals. The source compatibility
  check confirms only recorded-date preservation/formatting changed in the
  replacement private writer. Current file inventory preserves all seven
  migration-version collision groups; no hosted state is inferred.

Files created: the unapplied candidate, `scripts/lib/finishing-evidence-fixture.mjs`,
`scripts/audit-finishing-evidence.mjs` and `tests/finishing-evidence.test.mjs`.
Modified: integrated audit fixture/test, read-only deployment preflight,
credit-settlement preflight test and issue/progress ledgers. No UI, application
action, public RPC, new dependency, historical data or deployment changed.
Standalone candidate audit passes and preserves original/current JSON separately.
The file-only inventory is 158 SQL files / 146 versions with the same seven
collision groups. REST checks remain 33; a private body/trigger cannot be
established through REST discovery.

Evidence root:
`C:/Users/arnav/.codex/visualizations/2026/10/15/01a13e40-ffdd-7a00-86c5-fe3b2d0a5d19/finishing-evidence/`.
It includes the diagnostic and regression JSON, baseline and focused logs,
source compatibility check, file-only inventory and full/static verification
logs. R17 stays OPEN and unapplied. Historical movement accuracy, hosted schema,
real JWT/RLS, independent sessions, complete browser/operator acceptance and
physical finishing loss/gain remain unproved. The broader finishing/retry and
packaging investigation continues after this candidate; A00 and R04-R11 remain
open. No Supabase migrations have run and the overall goal remains active.

Before any future separately authorized activation, review the effective
finishing trigger/body/ACL catalog and the complete prerequisite ledger. Verify
real authenticated roles and a second company; explicit/omitted-date retries;
terminal direct writes/deletes; successful and failed corrective handoffs;
legacy missing evidence; independent-session contention; and the operator flow.
Historical movement errors cannot be reconstructed from status-only history;
review original challans/receipts before any separately authorized correction.
This acceptance checklist does not authorize a migration or data repair.

## R18 - Accepted finishing portions candidate verified

**OPEN; LOCAL CANDIDATE VERIFIED, NOT APPLIED.** R17's evidence guard alone does
not repair this separate material-disposition path. The finishing RPC allows an accepted
portion alongside rejection, and the retry function subtracts that accepted
portion from recoverable input. Downstream paths assume completed finishing:
the handoff queues only one package per production job; QC excludes the rejected
original; the application chooses one completed run and SQL dispatch readiness
uses maximum completed output.

`scripts/audit-finishing-partial-retry.mjs` preserves the original diagnostic:
actual production completion, finishing transitions/retry, the pre-R18 QC source
guard and packaging handoff with extracted R17 objects in disposable PGlite. Observed
recorded evidence is:

| Quantity | kg |
| --- | --- |
| Production output supplied to finishing | 95 |
| Original finishing accepted portion | 40 |
| Rejected material allocated to corrective retry | 55 |
| Corrective retry accepted output | 50 |
| Retry's remaining rejected quantity | 5 |
| Recorded total accepted output | 90 |
| Queued packaging / attainable QC-approved output | 50 |

The chain reconciles to 90 kg accepted plus 5 kg rejected from 95 kg original
input. The 55 kg retry input is reprocessed material, not a second production
input or additional scrap. The original 40 kg remains recorded and immutable,
but its QC approval rejects with `QC finishing job must be completed and match
this production job`; the retry's 50 kg approves. No physical remelt stock or
production output changes are inferred or fabricated. The diagnostic's success
exit means reproduction, not passing acceptance.

The required repair must cover final accepted receipt eligibility, original and
retry lineage, per-portion QC, independently identified packaging handoffs,
material completion and aggregate dispatch availability in both the application
and SQL authority. It must also bound root input and retry quantity so additional
finishing rows cannot manufacture extra eligible output; preserve R17's terminal
guard and once-only retry creation; handle already-packed/shipped and ambiguous
legacy rows explicitly; and retain failed-read, rollback, role/company and
concurrent-session boundaries. Rejecting every partial disposition, dropping the
original accepted quantity or simply summing all rejected weights is not an
acceptable resolution.

The prepared, unapplied candidate is
`supabase/migrations/20261019020000_finishing_accepted_dispositions.sql`.
It requires the reconciled prerequisite chain including R17. It adds a restricted
accepted-output view and a packaging receipt reference. Final received accepted
output on either a completed or rejected row can enter QC and packaging. Root
input stays within captured production; corrective input must match a rejected
parent's recoverable remainder; ancestors must lead to an original source; and
total accepted output stays within production. A retry never adds new production
input or remelt stock. Original terminal rows retain their evidence.

Each final accepted portion queues a separate identified package using the
existing locked number allocator. Scheduled and completed packages together must
fit that receipt's accepted kilograms, with source identity fixed after
assignment. Split packaging remains possible inside that capacity. Materials
still pass the original atomic issuance and stock checks. The accepted-output
view checks active identity, role, company, completed production, receipt dates,
route and recorded quantities. Its authenticated read grant and the new
authenticated readiness RPC expose operational fields only; direct execution of
private calculations and trigger functions remains closed. No existing RLS policy
was weakened or disabled.

For each receipt, released weight is the least of accepted output, approved QC
when required, and completed packaged weight with positive issued material.
The same private calculation feeds both SQL dispatch authority and
`get_finished_production_readiness`. Application preview/save validates the entire
RPC result's company, order, job identities, count and finite quantities, then
subtracts the complete previous packing history. It does not infer readiness from
one completed finishing row or fall back when the new reader is unavailable.
Mill-finish QC/packaging/dispatch behavior remains covered separately.

The actual QC and packaging forms show original and corrective receipts
independently with date and accepted kilograms. They scope choices to the selected
production source, preserve a queued package's assigned identity, clear
quantities on source changes, discard late order autofill responses, and display
lookup failures. Locked receipt details remain readable on compact mobile.
Blank optional hardness and actual kg/m values now stay null rather than being
coerced to invalid zero readings. The packaging action preserves the receipt
reference through schema validation into the actual atomic writer.

Explicit commit testing exposed a pre-existing deferred check that referenced
`NEW.job_id` while handling a package-header row. The prepared replacement
resolves keys in separate row-type branches; both header and material events now
validate at commit. Receipt-aware quantity defaults preserve an entered partial
weight and derive missing length from that weight, including on the later schema
where the legacy single-material columns were removed.

No historical data is backfilled. One unambiguous legacy completed package can
retain compatible readiness without a new recorded receipt link. Multiple
accepted receipts or mixed ambiguous legacy packaging require source review.
`sql/audit-finishing-accepted-dispositions.sql` is a read-only review for invalid
source/quantity evidence and unlinked packaging, and works before the packaging
receipt column exists. It neither assigns links nor certifies physical inventory.

New R18 files comprise the candidate SQL, historical review SQL, readiness and
receipt helpers, the persisted diagnostic/regression script, SQL and browser
fixtures, three regression files and responsive QA script. Application changes
are confined to dispatch readiness, the packaging action/schema, shared QC and
packaging form/configuration, deployment preflight and their existing fixtures.
The eight-script audit integration now includes the new extracted candidate
objects. No dependencies were added.

### R18 verification

- The original four behavioral scenarios plus their enclosing test failed before
  implementation. Original diagnostic and failed intermediate logs are retained.
- `tests/finishing-partial-retry.test.mjs`: **36 passed**, comprising 35 scenarios
  and their enclosing test. It verifies original-only and combined release,
  per-receipt QC/package caps, three-generation retry material, three-decimal
  weights, previous packing, forged identity, date/evidence failures, anonymous
  and role/company denial, replay, stock/late-handoff rollback, legacy compatible
  and ambiguous packages, read-only review/preflight, actual mill-finish SQL,
  later multi-material schema and explicit transaction commit.
- `tests/finishing-readiness.test.mjs`: **19 passed**. It uses a real Supabase
  client with intercepted loopback transport to check the exact RPC request and
  rejects missing/duplicate/foreign identities, incomplete counts, malformed,
  unsafe, negative, excessive or over-precision quantities. It also verifies
  unavailable versus verified zero, accepted receipt eligibility and optional
  QC measurement validation.
- `tests/finishing-receipts-browser.test.mjs`: **12 passed**. Actual React forms
  exercise receipt choices, source changes, late responses, unavailable data,
  immutable identity and actual cleared submitted values. A browser-entered
  40-kg original QC payload passes the actual SQL guard; the browser's assigned
  package payload passes the actual packaging server action into the actual
  public atomic SQL writer. It issues one material movement, reports 40 kg ready
  independently of the retry, and commits successfully. Identity and reads use
  controlled fixtures, not hosted login or RLS.
- These are **67 new passing checks** beyond the 1,182-test checkpoint. The final
  `npm test -- --test-concurrency=2` rerun passes **1,249 tests / 76 suites**, with
  zero failures, skipped or cancelled tests; exit 0. An earlier full run caught
  a browser assertion reading the previous display label before React refreshed
  it. The revised test verifies cleared receipt/kg/metres/pieces in the actual
  submission as well as waiting for rendered values; the complete rerun passes.
- Final `npm run lint` and `npm run typecheck`: exit 0, no lint warnings/errors.
  `npm run build`: exit 0, **153 generated pages**. Typecheck preceded build.
  Whitespace and source comparisons pass: QC keeps its existing locking/rework/
  inspector controls, the packaging writer changes only its allowed receipt
  key, reservation and dealer-stock dispatch branches remain identical, and the
  legacy material calculation/stock-validation body is retained.
- `scripts/audit-finishing-partial-retry.mjs <evidence-directory>
  --verify-candidate` records **40 kg independently ready**, then **90 kg ready**
  after the retry's separate QC/package completion, two material movements and
  stock 98 from 100. The original row is unchanged, 90.02 kg dispatch readiness
  rejects, and the disposable transaction commits. Five kilograms remain
  rejected; no physical dispatch posting or inventory adjustment is claimed.
- `scripts/qa-finishing-receipts.mjs <evidence-directory>/responsive` passes at
  **1440, 820, 390 and 320 pixels**, with **nine screenshots**, actual built CSS/
  Plus Jakarta Sans, no document overflow and no browser page errors. Desktop QC,
  mobile QC, compact package and unavailable-state images were inspected. The
  compact package displays its full assigned receipt in readable text.
- Integration passes with **40 prepared function definitions and 11 trigger
  attachments** alongside eight historical audit scripts. The schema contract
  has **36 checks: 22 functions and 14 columns**, including the accepted-output
  view. Trigger attachment/body/ACL checks remain separate from REST exposure.

Original evidence is preserved at:
`C:/Users/arnav/.codex/visualizations/2026/10/15/01a13e40-ffdd-7a00-86c5-fe3b2d0a5d19/finishing-partial-retry/finishing-partial-retry-diagnostic.json`.
The same directory contains `finishing-partial-retry-regression.json`,
`full-test-final.log`, `lint-final.log`, `typecheck.log`, `build.log`, original
failed-run logs and `responsive/results.json` with the inspected screenshots.

R18 remains open because its database candidate is unapplied. No Supabase
migration, hosted write or deployment occurred. Before any future authorized
paired activation, reconcile the complete ledger/prerequisites and effective
catalog, review legacy provenance, and verify actual JWT/role/company boundaries,
independent sessions and the full finishing/QC/packaging/physical-dispatch
operator journey. Process loss/gain, historical correctness and physical stock
remain separate acceptance questions. The broader goal remains active.

## R19 - Packaging material evidence candidate verified

**OPEN; LOCAL CANDIDATE VERIFIED, NOT APPLIED.**

The next packaging reversal investigation confirms two evidence paths. Existing
package edits and direct deletion of terminal material rows reject correctly.
Ordinary authenticated header deletion deletes no row under the installed
historical policies; that path is not claimed as an authenticated exploit.
Privileged SQL header deletion nevertheless cascades through its actual material
and movement foreign keys, erases the completed package and its audit rows, and
leaves stock 99 after a prior one-unit issue. A retained 40-kg production packing
manifest remains. The child stock trigger cannot recover a parent that has
already disappeared. The deletion commits in the disposable database.

A separate actual-role test changes the local identity to a same-company viewer.
The legacy movement insert policy permits a fabricated restore of 10 material units with no
stock restoration. Movement rows become two while stock remains 99. These are
synthetic identities and historical-policy fixtures, not real hosted JWT proof.
Original evidence is preserved in the session's `packaging-evidence` directory.

Prepared `20261019030000_packaging_material_evidence.sql` removes direct client
ledger mutation rights, including column grants and the permissive insert policy.
The existing security-definer stock and cancellation triggers remain responsible
for valid movements. Private guards retain terminal or material/packing-linked
headers and prevent updating/deleting posted movements. Two supporting indexes
cover material and movement parent lookups. No public RPC, application flow,
dependency, historical row or physical stock value changes in this candidate.
The read-only `sql/audit-packaging-material-evidence.sql` compares retained net
issue with current material disposition. Agreement cannot establish historical
authorship, an opening balance or a physical inventory reconciliation.

The original 29 scenarios have 21 expected-behavior failures and eight passing
existing lifecycle/rollback/commit controls; their enclosing test also fails.
The initial candidate run passes 30 tests. Final
`tests/packaging-evidence.test.mjs` passes **39 tests**, comprising 38 scenarios
and their enclosing test. This adds 39 checks beyond the 1,249-test checkpoint.

- All 12 tested business roles, including viewer/dealer/operational/admin roles,
  reject fabricated direct client movement writes under the authenticated SQL
  role. Effective table and column mutation grants are closed, tenant-scoped
  reads remain available, and a repeated object installation also closes an
  explicitly introduced column-only insert/update grant.
- Existing public packaging save and direct authorized material-row operations
  still issue, replace and restore material through the actual stock trigger.
  A 1.125-to-2.375-unit replacement gives stock 97.625 and net issue 2.375 from
  stock 100; removal restores 100 and retains four issue/restore movements.
  Cancellation with a retained material list or an empty replacement list
  restores unused material once and preserves the correct net movement. Repeated
  terminal edits/cancellation reject without another stock or history change.
- Completed, cancelled, issued-active and fully restored active headers retain
  their evidence against privileged deletion. Empty active headers without any
  material/history/manifest evidence remain removable by privileged maintenance.
  A pending production manifest also protects an otherwise empty active header.
  Cancellation after that allocation rejects and rolls back the attempted stock
  restoration. Ordinary authenticated header deletion remains denied by the
  pre-existing historical policies.
- Posted movement quantity, type and recorded date cannot be rewritten, and
  direct privileged movement deletion rejects. Existing terminal child-material
  protections remain. A late completion failure rolls back inserted material
  and ledger rows normally; append-only guards do not interfere with transaction
  rollback. Legitimate issue/cancellation transactions commit successfully.
- The read-only historical review accepts legitimate issue/replacement/
  cancellation balances and flags an unbacked restore as net issue -9 against
  expected 1, without changing evidence or stock. Balanced history cannot prove
  authorship, and missing deleted history cannot be reconstructed from this
  query. Legacy reconciliation still requires trusted source records.
- Catalog preflights identify the enabled before-delete header guard and
  before-update/delete movement guard, their body hashes, security-definer
  context and closed direct execution. They verify RLS, retained reads and both
  table/column write revocations separately from REST exposure. Index discovery
  found no existing equivalent parent lookup indexes in the migration sources.
- Final source inspection confirms both actual stock/cancellation writer bodies
  are identical to their historical definitions. They remain security-definer,
  with direct trigger-function execution closed. Application-source discovery
  finds no direct movement-ledger writes outside the SQL stock workflow.
- The combined R18/R19 runtime fixture approves and packages original 40-kg and
  corrective 50-kg receipts independently with the new ledger controls installed.
  Authenticated readiness reports 90 kg, the SQL dispatch authority accepts the
  complete 90-kg manifest, protected deletion rejects, and the transaction
  commits. Stock remains 98 from 100 with two material movements. No physical
  shipment posting or physical material-return conclusion is inferred.

The earlier four-file packaging/audit-integration/finishing/retained-invoice group
passes **118 tests**. After the added combined runtime case, the complete final
`npm test -- --test-concurrency=2` rerun passes **1,288 tests / 76 suites**, with
zero failures/skips/cancellations; exit 0. Final lint and typecheck pass with no
lint warnings/errors, and build passes with **153 generated pages**. Typecheck
preceded build. The final extra runtime fixture changes no compiled application
source; its final full-suite and lint reruns pass. Tracked whitespace and all
five new R19 files pass whitespace review. Integration installs **42 prepared
function definitions and 13 trigger attachments** alongside eight historical
audit scripts; R19 adds no public RPC or REST column requirement.

`scripts/audit-packaging-evidence.mjs <evidence-directory> --verify-candidate`
records denied viewer forgery and privileged deletion, a committed completed
package with stock 99 / one material row / one movement and retained manifest,
and committed cancellation with stock 100 / four retained movements / net issue
zero. Original and candidate JSON, initial failed baseline, focused/final test
logs and all gate logs are retained under:
`C:/Users/arnav/.codex/visualizations/2026/10/15/01a13e40-ffdd-7a00-86c5-fe3b2d0a5d19/packaging-evidence/`.

The five new R19 files are the candidate SQL, read-only review SQL, persisted
diagnostic/regression script, packaging evidence fixture and regression test.
Existing changes for integration/exported fixture access, deployment preflight
and these status documents are limited to supporting verification. No application
UI, business-writer body, dependency or historical row was changed for R19.

R19 remains open because its candidate is unapplied. No Supabase migration,
hosted write, deployment, commit or PR occurred. Hosted effective privileges,
real JWT boundaries, independent-session behavior, physical return/reversal,
legacy authorship/correction and complete authenticated operator acceptance
remain open. The broader goal remains active.

## R20 - Finishing workload accounting candidate verified

**OPEN; LOCAL CANDIDATE VERIFIED, NOT APPLIED.**

The finishing process/retry/reporting investigation confirms a separate read-path
defect. Actual persisted original/retry rows reconcile 95 kg input to 90 kg final
accepted output and 5 kg remaining rejection, while the original actual finishing
page renders 55 kg rejected. The original rejected source stays in the attention
queue after its completed retry is omitted from the metric. The page also counts
only 200 of a separate 401-row synthetic queue, shows zero metrics on a failed
read, and offers another retry when its separate corrective-link lookup fails.
Original JSON and HTML are retained in the session's `finishing-board` directory.
The diagnostic can load the original page from inspected local commit `96fcfe9`;
this is a source reproduction, not a checkout change or hosted evidence.

Prepared `20261019040000_finishing_workload_projection.sql` uses one stable,
security-definer, company/role-scoped read projection for complete counts and
material totals, per-status previews of at most ten rows, exact retry metadata,
ten-row database pages and safe vendor names. Source/receipt/quantity and complete
retry ancestry checks flag unverified history. The projected fields exclude
commercial cost, margin, supplier rates and unrelated customer/company data.
Retry input is transferred material, provisional receipts stay pending, remaining
rejection excludes transferred input, and recorded weight difference is displayed
without inferring physical process loss/gain or remelt stock.

Application changes replace the 200-row board totals with a validated scalar RPC,
add `/production/finishing/database` and `/production/finishing/[id]`, retain
original/retry and historical/remaining rejection distinctions, bound overview
previews, and hide unverified quantities and controls. New database GET filters
use literal search, status, allowed sorts and exact source scopes. The actual
movement actions invalidate all three surfaces. The existing retry/completion
writers, source guards and stock functions remain unchanged.

The final source audit added three failing historical-data regressions: a retry
outside the selected production, order or company scope could disappear from the
scoped child set and leave its source apparently retryable. The projection now
checks linked children beyond that selected scope for consistent company, order,
production and finishing route. It marks inconsistent evidence unverified
without returning the out-of-scope receipt's identity. Both tenant scoping and
complete retry verification are preserved. The repeated per-row retry lookups
were also replaced by one grouped lookup.

There are **129 new checks**, including their enclosing cases, across the four
R20 test files: 61 SQL, 46 reader/transport, 17 actual server-page and five actual
browser/action checks. With audit-catalog integration the final focused group
passes **130 checks**. Coverage includes multi-generation retries, provisional
receipts, three-decimal quantities, positive/negative unreconciled differences,
401 actual production-completion records, last-page clamping, literal search,
seven allowed/eight denied roles, anonymous/tenant rejection, invalid legacy
sources/dates/weights/ancestry, response corruption and unavailable versus
verified-empty states. Complete rejected evidence remains recorded as 55 kg on
the original receipt while its remaining rejected quantity becomes zero after
transfer to the corrective retry.

The actual browser plans a 55-kg retry and completes it with 50 accepted / 5
rejected through the actual server actions and extracted SQL writers. Totals
refresh to 90 accepted / 5 remaining rejected / zero active movements. The test
checks committed persistence, unchanged original accepted evidence, two linked
packaging receipts, exact source/retry navigation and page invalidation. It does
not establish physical stock or independent-session concurrency.

Responsive QA passes at 1440, 820, 390 and 320 pixels, with **16 screenshots**,
zero page errors and no document overflow. Built application CSS/fonts are used.
Database columns scroll inside their container; full row clicks open the exact
receipt. Native GET pagination/search reaches page two and the last seeded
production reference. Representative compact board/database/detail and crowded
desktop screenshots were inspected. Earlier fixture failures and their logs are
retained: static markup was replaced by hydratable markup, readiness now waits
for React's effect before filling inputs, and row-click QA uses a real pointer
target inside the full-row link overlay. The corrected browser group passes in
parallel with the page checks. The earlier full run passed 1,414 tests before the
last three filtered-lineage regressions; the final complete rerun passes 1,417.

The thirteen new R20 files are:

- `supabase/migrations/20261019040000_finishing_workload_projection.sql`.
- `lib/workflow/finishing-workload.ts`.
- `app/(dashboard)/production/finishing/database/page.tsx`.
- `app/(dashboard)/production/finishing/[id]/page.tsx`.
- `scripts/lib/finishing-workload-fixture.mjs`.
- `scripts/lib/finishing-board-page-fixture.mjs`.
- `scripts/lib/finishing-workload-browser-fixture.mjs`.
- `scripts/audit-finishing-board.mjs`.
- `scripts/qa-finishing-workload.mjs`.
- `tests/finishing-workload.test.mjs`.
- `tests/finishing-workload-reader.test.mjs`.
- `tests/finishing-workload-page.test.mjs`.
- `tests/finishing-workload-browser.test.mjs`.

R20 also modifies the existing overview page, workflow board, finishing actions,
deployment schema contract, deployment SQL preflight, integration installer,
integration expectation and existing retry-usability expectation, plus this
report and `BUGS-MEGA.md`. Existing user changes and earlier goal changes are
preserved. No dependency, existing RLS policy, stock writer or historical
production row is modified by the read projection. The candidate grants its new
public read RPC to `authenticated`, closes anonymous/PUBLIC execution and
enforces active identity, company and the existing production-read role cohort.
The final focused integration retains 43 prepared function definitions, 13
trigger attachments and the eight historical audit scripts. All thirteen new
files pass trailing-whitespace review. The file-only inventory is 161 SQL files,
149 versions and the existing seven collision groups; the expected REST contract
is 37 checks, comprising 23 functions and 14 columns. No hosted ledger was
provided, so the local ledger command exits 1 with status `unavailable`, as
expected. It runs no migration and makes no network connection.

Final gates after the filtered-lineage repair all pass:

- `npm test -- --test-concurrency=2`: **1,417 tests / 76 suites**, zero failures,
  skips, cancellations or todos; exit 0.
- `npm run lint`: exit 0, no warnings or errors.
- `npm run typecheck`: exit 0; completed before the final build.
- `npm run build`: exit 0, **154 generated pages**, including the finishing
  overview, database and dynamic receipt routes.
- `git diff --check` and the thirteen new-file trailing-whitespace checks pass;
  final source/security review is complete.

The earlier 1,288-test R19 checkpoint remains historical. Local evidence is retained under
`C:/Users/arnav/.codex/visualizations/2026/10/15/01a13e40-ffdd-7a00-86c5-fe3b2d0a5d19/finishing-board/`,
including original reproduction JSON/HTML, the failing filtered-lineage
baseline, corrected focused/full logs, candidate regression JSON/HTML and final
responsive screenshots/results.

The manual operator acceptance sequence remains pending against an authorized
hosted target: inspect original accepted/rejected evidence; plan its single
corrective retry; process and complete measured output/rejection; verify all
three surfaces and source/retry links; exercise database search/sort/pagination;
verify unavailable and inconsistent-data behavior; and repeat under allowed,
denied and second-company identities. No Supabase migration, hosted write,
deployment, physical reconciliation or complete signed-in operator journey
occurred. R20 remains open and unapplied; the goal remains active.

## R21 - Legacy billet-link repair candidate verified

**OPEN; LOCAL CANDIDATE VERIFIED, NOT APPLIED.**

The billet requirement/FIFO/manual-allocation investigation confirms a narrower
link-repair defect. The legacy repair function checks alloy and diameter but
omits temper, while the attached lineage guard requires all three. With an
older T5 requirement and a valid unlinked T6 billet on the same mixed-temper
order, the original actual repair, refresh and priority allocator all throw the
guard's material-mismatch error. Failed attempts leave all source snapshots
unchanged. Thirteen of sixteen initial scenarios fail before the repair.

The same function trusts the stored allocated counter before refresh recomputes
it. Tests demonstrate both extra links from a stale low counter and missed
compatible links from a stale high one. Repeated calls can attach another
billet to an already filled requirement unless actual retained links are used.

The prepared `20261019050000_billet_link_repair_integrity.sql` replaces only
`public.repair_order_billet_requirement_links(uuid)` and repeats its existing
internal-only execute revocation. It checks existing active links once per order
for consistent company/order/material/production identity, then matches unlinked historical
billets using the lineage guard's case/whitespace normalization and exact
diameter. If a billet retains a production-job reference, that job's company,
order and profile must match the requirement; no billet profile column is
invented. Remaining slots come from actual company/order-scoped
allocated/issued/consumed rows, with inactive statuses excluded. Existing
allocation-date ordering and `FOR UPDATE SKIP LOCKED` are retained, with stable
tie breakers. A late failure rolls back earlier links. No new physical material,
quantity, status, source or production-job reference is written.

The helper does not rewrite already inconsistent or overfilled historical
evidence. Inconsistent retained links require review, and
`sql/audit-billet-allocation-links.sql` identifies missing/unlinked/incompatible
scope/material links and overfilled or drifting counters. The two review queries
run under a SELECT-only fixture role and preserve before/after snapshots. They
do not attest actual stock, measured input adequacy or historical correctness.

There are **44 new checks**: 43 scenarios and their enclosing case. The final
focused candidate/catalog group passes **45 checks**. Coverage includes actual
priced direct-order material snapshots and the actual quoted requirement branch,
with the customer-approved/drawing guard attached; mixed T5/T6 requirements;
five allowed roles through actual order refresh triggers; normalized identity;
company/order isolation; allocated/issued/consumed and inactive statuses; stale
low/high counters; deterministic retained-allocation ordering; unchanged physical
fields; late rollback; committed repeat; invalid retained evidence; read-only
review; object reinstall and internal-only catalog privileges. The final source
review added a failing regression for a retained link whose order is null: the
repair already rejected it, but the historical report excluded it. The corrected
report now includes that inconsistent scope and still runs with SELECT-only
permissions. Its failing baseline is retained. A further lineage audit reproduced
issued/consumed billets failing when two profiles share alloy/temper/diameter:
the retained production job must select the matching profile requirement. The
candidate and historical report now check that production identity too. Three
new profile scenarios failed against the earlier candidate before correction;
the retained-job reference and job rows remain unchanged. The existing
direct/factory/catalog regression group separately passed 62 checks before the
last quoted-path scenario was added. No full quote-entry/approval or signed-in
operator journey is claimed.

Five files are created for R21: the candidate SQL, read-only review SQL,
`scripts/lib/billet-link-repair-fixture.mjs`,
`scripts/audit-billet-link-repair.mjs` and
`tests/billet-link-repair.test.mjs`. Modified files are the integration installer
and expectation, deployment catalog preflight, `BUGS-MEGA.md` and this report.
No application UI, dependency, new RPC, table, column, index, trigger or RLS
policy was added. Existing allocator bodies remain unchanged. The integrated
fixture now checks 44 prepared function definitions, 13 trigger attachments and
the eight historical audit scripts. Required REST probes stay at 37: 23
functions and 14 columns. The file-only inventory is 162 SQL files / 150
versions with the existing seven collision groups. A00 remains open.

Final gates after the production-profile correction all pass:

- `npm test -- --test-concurrency=2`: **1,461 tests / 76 suites**, zero failures,
  skips, cancellations or todos; exit 0.
- `npm run lint`: exit 0, no warnings/errors.
- `npm run typecheck`: exit 0; completed before the final build.
- `npm run build`: exit 0, **154 generated pages**.
- `git diff --check` and all five new-file trailing-whitespace checks pass.
- Original/candidate diagnostics, 45 focused checks, SELECT-only historical
  review, and final source/security audit pass. Earlier complete runs passed
  1,457 and 1,458 tests before the last lineage cases; those are historical.

No candidate migration wrapper or Supabase migration command ran; extracted objects were installed only
in disposable PGlite. Evidence is under
`C:/Users/arnav/.codex/visualizations/2026/10/15/01a13e40-ffdd-7a00-86c5-fe3b2d0a5d19/billet-link-repair/`
and adjacent `billet-link-*.log` files. Original and candidate JSON include both
the link-repair outcome and the separate manual RPC failure below. An initial
quoted-path fixture used an unsupported acceptance-field name; it was corrected
to the existing `customer_approved` status and actual customer/drawing guard.
That was a fixture correction, not a product-schema change.

Final source checkpoint is `d3ef74f` (`Improve inventory and operations
workflows`). The final source inspection shows only `BUGS-MEGA.md` and this
report remaining modified. Full tests and build completed on 19 October IST;
these close-out records were finalized after the date rolled to 20 October.

R21 remains open and unapplied until separately authorized activation and hosted
JWT/RLS/catalog, independent-session, historical and operator acceptance. The
broader allocation adequacy, source provenance and physical inventory questions
remain open. In particular, this candidate does not certify that a nominal
standard-length/count requirement is covered by nonstandard measured billets.
The allocation panel's load/error/refresh behavior also needs its own focused
verification. No hosted write, deployment or operator acceptance occurred.

Future operator acceptance requires an authorized, reconciled activation:
review the historical report; inspect mixed-temper and shared-material profiles;
refresh their requirements through the real workflow; verify exact retained
links/counters and unchanged stock fields; repeat without extra links; and
exercise allowed/denied and second-company identities. Full manual allocation
and reallocation acceptance remains blocked by the independent R22 issue.

## R22 - Manual billet allocation schema mismatch reproduced

**OPEN; REPRODUCED, NOT FIXED.**

The actual manual public wrapper/private allocator fails on a newly created
priced order and a fresh cast billet with `record "v_billet" has no field
"profile_id"`. The current factory integrity implementation reads that member
from `foundry_billets`, but the billet DDL and column additions in this checkout
do not define it. The diagnostic asserts that the historical-column fixture has
zero such columns. The older broad factory fixture included an invented
`profile_id` field; its successful manual-allocation checks therefore do not
prove this schema contract. Current source also references the unsupported field
in the reallocation implementation. Hosted schema state remains unverified.

Keep this separate from R21. R21's candidate does not change the manual
allocator, and a green full suite will not close this directly reproduced
failure. The next issue must derive profile eligibility from real order,
requirement and production lineage, preserve locking/tenant/role and material
rules, and verify actual allocate/reallocate paths against historical column
definitions without inventing a billet field. No fix or migration is claimed
for R22 in this checkpoint.

## Evidence and acceptance boundary

Local evidence directory:
`C:/Users/arnav/.codex/visualizations/2026/10/15/01a13e40-ffdd-7a00-86c5-fe3b2d0a5d19/retained-dispatch-invoices/`.
The path belongs to this goal's original session; this report is dated 19 October.

The browser fixture exercises create, edit and sent-lock states at 1440, 820,
390 and 320 pixels; actual source search, save and SQL totals; unchanged physical
stock (40 kg / 20 m / 4 pieces); unavailable reads; and stale-search protection.
Screenshots use the built application CSS and Plus Jakarta Sans and are checked
for document overflow. Images are reviewed locally. It uses a synthetic session
and transport, so it does not establish a hosted authenticated journey.

The latest file-only inventory after preparing R21 reports 162 SQL files,
150 versions and the same seven
collision groups: `0032`, `0034`, `0036`, `0055`, `20260511`, `20260512`,
`20260513`. The earlier reconciler's nonzero exit established that hosted
comparison was unavailable without a metadata export; the current file inventory
adds no hosted evidence. The required REST contract now has 37 checks (23
functions plus 14 columns); no fresh hosted object-presence conclusion is made.
Integration installs 44 prepared function definitions and 13 trigger
attachments alongside the eight historical audit scripts and authorized views.

Before any future, separately authorized activation, reconcile the complete
ledger/prerequisite chain and catalog/body revisions; review real legacy retained
shipments and their source evidence; and test real JWTs, tenant/role denial,
complete packing lists, both quoted and direct-order commercial snapshots,
receipts/credits/refunds, independent-session races and operator journeys.
Activation, hosted reconciliation, physical-return receipts, historical stock
corrections, operator cancellation/release UAT and deployment remain open. This
checklist does not authorize a migration.

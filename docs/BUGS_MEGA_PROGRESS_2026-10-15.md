# BUGS-MEGA continuation evidence

Date: 15 October 2026, Asia/Kolkata.

## Scope and constraints

Read every finding and investigation in `BUGS-MEGA.md`, the latest A00 report,
and the relevant reconciliation/factory source audits. Preserved pre-existing
uncommitted remediation. The user explicitly instructed:

> DON'T RUN ANY SUPABASE MIGRATIONS.

No Supabase project migration, hosted data write or deployment was performed.
The existing automated suite uses disposable in-memory PostgreSQL fixtures;
it does not connect to or migrate a Supabase project.

A00 remains OPEN. At the R01-R03 checkpoint a fresh GET-only REST check returned
unavailable for all 29 probes. No hosted ledger is present locally. That local
inventory contained 149 SQL files, 137 versions and seven collision groups.
Later sections record the additional prepared R04/R05 files. Docker's Linux
database engine is unavailable. This establishes no hosted schema presence/absence,
grant, migration-history, JWT/RLS, Storage, staging replay or deployment result.

## R01: dispatch reservation availability

The source loader embedded consumption rows and summed the returned subset.
The existing aggregate reader was already used by configurator reservation
flows but had not been adopted by dispatch source loading. API truncation
therefore made the same reservation appear to have different remaining stock.

Reproduction uses the actual exported dispatch actions with mocked database
transport, synthetic ledger rows and the actual shared aggregate reader and
packing builder. With 2,000 kg / 1,000 m / 2,000 pieces reserved and 1,501
consumed units, the old code showed 1,000 kg / 500 m / 1,000 pieces available.
Correct availability is 499 kg / 249.5 m / 499 pieces. A fully consumed hold
also reappeared as available. Six of the first eight checks failed before
the repair, including the property counterexample of 1,001 fully consumed units.

The fix loads complete totals through the existing bounded aggregate RPC,
uses them in both source selection and save, and refuses incomplete or invalid
results. It retains authentication, business-role permission checks, company
filters, exact reservation/batch identity and the atomic dispatch write boundary.
Malformed aggregate rows now receive an explicit validation error.

Ten behavioral tests cover large histories, exhausted and released holds,
501 active reservations in 500/1 requests, a failed second request, malformed
and foreign responses, unauthorized/foreign scopes, source query errors,
repeated reads, a valid final dispatch, refusal of an oversized dispatch before
the write RPC, and 100 deterministic randomized conservation cases.

Created `tests/dispatch-reservation-availability.test.mjs`.
Modified `lib/actions/dispatches.ts`, `lib/inventory/reservation-consumption.ts`,
`tests/reservation-consumption-totals.test.mjs`,
`tests/reservation-consumption-safety.test.mjs`, and `BUGS-MEGA.md`.
This report is also new. No database migration, grant or RLS policy was added.
Generated knowledge-graph artifacts were restored to their original tracked
state after refreshing the in-memory index. Build/typecheck update generated
TypeScript build metadata.

| Verification | Result |
| --- | --- |
| Baseline full suite | 705 passed |
| Pre-fix reproduction | Six of eight new checks failed |
| Focused initial regression | 20 passed |
| Final action-level edge tests | Ten passed, including 100 property cases |
| First full recheck | 714 passed, one old assertion required the replaced embedded query |
| Full suite after assertion update | 715 passed, 76 suites, zero failed/skipped/cancelled |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed, no warnings/errors |
| `npm run build` | Passed |
| `git diff --check` | Passed; Git reports line-ending conversion notices only |

R01 is LOCALLY FIXED after these checks and a source audit of permissions,
query failure handling, complete aggregate validation and write ordering.
An unavailable target RPC causes a visible failure; it does not trigger a
fallback to incomplete consumption rows. Availability is still a snapshot;
the existing atomic database transaction remains responsible for concurrent
capacity enforcement.

This evidence does not close reservation cancellation/release, physical return
reconciliation, independent sessions or authenticated hosted acceptance.

## R02: payment retry reachability

The payment action rejected status/balance snapshots before the existing atomic
RPC could look up a receipt's idempotency key. After a full receipt the invoice
is paid; after a partial receipt its remaining balance can be smaller than the
original payment. Both legitimate retries failed locally before reaching the
database. The API route had the same behavior with a header idempotency key.
The added invalid-input checks also reproduced acceptance of `Infinity` by
the previous positive-number schema.

The action now retains authentication, financial permission, validated input
and a company-scoped invoice lookup, while delegating mutable status/balance
decisions to the existing locked transaction. Non-finite amounts reject before
database access. No SQL function, migration, grant or RLS policy changed.

Created `tests/payment-retry.test.mjs`; modified `lib/actions/payments.ts` and
updated this report and the register. Nine new tests exercise the actual action
and API with injected transport, and the actual current private/public payment
functions plus collection-state function in a disposable PGlite database. Only
extracted function bodies are installed for that fixture; no migration script
is replayed and no Supabase project is contacted.

The database fixture verifies that a full-payment retry returns the original
payment with one receipt and one audit event. It also verifies partial-payment
replay and unchanged rejection of a new payment after settlement, overpayment,
draft invoice, missing bank reference, future date, another invoice using the
same key, and a denied business role. The fixture does not install the full
schema/RLS catalog or establish independent-session contention.

| Verification | Result |
| --- | --- |
| Pre-fix action/API checks | Paid, partial and header-key retries failed; non-finite validation failed |
| Initial payment/financial regression | 15 passed |
| Final new payment checks | Nine passed, including actual SQL-function integration |
| Full suite | 724 passed, 76 suites, zero failed/skipped/cancelled |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed, no warnings/errors |
| `npm run build` | Passed |
| `git diff --check` | Passed |

R02 is LOCALLY FIXED following recheck and audit. The duplicate adjustment
versus issued-credit question remains separate and open. No cash-inflation,
hosted-JWT or concurrent-payment conclusion is inferred from these tests.

## R03: corrected credit note after reversal

The credit-note component offered issue only when no note record existed. A
reversed note therefore hid the issue workflow even though the database permits
another note after reversal. Merely revealing the button would still be wrong:
the mounted component retained the original idempotency key, which would return
the old reversed note instead of creating its corrected replacement.

The component now offers corrected issuance for an eligible returned/damaged
dispatch, an issued invoice and a reversed predecessor. It preserves the old
record and reversal reason. A shared workflow helper scopes each attempt to
the dispatch and reversed predecessor, retains the key for retries, and creates
a fresh key for a distinct correction. Draft/cancelled invoices, active/unknown
credit statuses and unauthorized users cannot offer issuance. Thrown transport
errors now leave issue/reversal retryable and preserve the issue attempt key.

Created `lib/workflow/credit-notes.ts` and `tests/credit-note-reissue.test.mjs`;
modified `components/modules/dispatch-credit-note-client.tsx`, this report and
the register. No SQL function, migration, grant, policy or dependency changed.

Six component tests failed before the fix. Eight final tests cover rendered
reversal evidence, corrected issuance, initial/corrected retries, key changes
across repeated corrections and dispatch changes, pending/reason/role/status
gates, action failures and thrown transport errors. Component event tests use
controlled hook/router/transport adapters; rendered HTML uses React's server
renderer. These are component tests, not an authenticated browser journey.

The integrated fixture calls the actual existing private/public issue/reverse
functions and current collection-state function, without applying migration
scripts. Business numbering is a fixture sequence and is outside this test's
claim. On a 100-total invoice with a 20 cash receipt, issue/retry, reverse/retry
and corrected issue/retry end with two historical notes, one active note,
three audit events and the one original payment. Credited amount is 100,
amount paid is 20, balance due is zero and refund due is 20. Reversal restored
balance due to 80 and refund due to zero. Duplicate active issuance and a
viewer call were rejected. The fixture has no full RLS/JWT catalog or
independent sessions.

| Verification | Result |
| --- | --- |
| Pre-fix reproduction | Six component checks failed |
| Focused regression | Eight passed, including actual SQL-function integration |
| Full suite | 732 passed, 76 suites, zero failed/skipped/cancelled |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed, no warnings/errors |
| `npm run build` | Passed, 153 pages generated |
| Tracked diff and new-file whitespace | Passed |

R03 is LOCALLY FIXED after these checks and source review of eligibility,
attempt lifetime, stale-prop retries, failure handling and the existing
database active-note/idempotency enforcement.

## Remaining investigation boundaries

The current `/orders/new` page uses the quote-backed order form. The legacy
`saveOrderAction` / `save_order_atomic` path can save header-only direct orders;
it does not create commercial line prices. Database packing and invoice guards
require appropriate commercial provenance. Direct-order commercial lifecycle
acceptance is therefore still open. No guessed prices, retrospective quote
links or historical record changes were introduced.

Returned-stock source movements, duplicate adjustment versus credit handling,
and all remaining register acceptance gates remain open unless a later section
records their own completed reproduction, repair and verification.

Manual acceptance still required: signed-in dispatch preparation with a large
real consumption history; a final valid shipment and a rejected oversized
shipment; target-RPC unavailability; partial cancellation/release; returns and
credit reconciliation; two independent contending dispatch sessions. None is
represented as a completed hosted/operator test here.

Financial manual acceptance also remains: retry a posted full and partial
receipt after a lost response; reverse and issue a corrected return credit;
repeat each action after a lost response and confirm invoice, note history,
cash and refund balances in signed-in desktop/mobile screens. Verify the
standalone-adjustment plus separately issued-credit combination independently.

## R01-R03 verified checkpoint

All three reproduced local defects were handled one at a time and marked
locally fixed only after their own edge tests, full suite, lint, typecheck,
build and audit. Final suite: 732 tests, 76 suites, zero failed/skipped/cancelled,
27 additional tests over the 705-test baseline, including 100 deterministic
property cases within the reservation test. No Supabase migrations were run,
no SQL source was modified, no new RLS/grant was added, and nothing was deployed.

A00 remains OPEN under the user's no-migrations instruction. Direct-order
commercial lines, cancellation/release, physical returned-stock reconciliation,
standalone adjustments versus separate credit notes, hosted roles/Storage,
independent sessions, historical stock reconciliation and operator UAT remain
open. This continuation does not complete the overall goal or certify release.

## R04: posted consumption replay after partial release

The next continuation reproduced a database helper defect in the unresolved
partial-release investigation. The current helper rejected released/cancelled
reservation status before inspecting the existing posted consumption entry.
Four of seven new checks failed against that definition. The same investigation
also exposed null identity and incomplete posted-ledger provenance checks.

Prepared, but did not apply,
`supabase/migrations/20261015000000_reservation_release_replay_integrity.sql`.
It retains the function's private namespace, security-definer/search-path
contract, lock order and execute revocations. It validates exact identity and
posted quantities before returning a replay, and permits a new debit only
while the reservation is active. No historical migration was edited and no
new public RPC, role grant or RLS policy was introduced.

Created `tests/reservation-release-replay.test.mjs`. Updated the existing
factory integration fixture and its expected check list to load only the
candidate function body after its existing fixture setup. The new migration
script was not applied to Supabase or replayed as a migration by these new
checks. Existing full-suite tests retain their disposable PGlite setup.

Seven dedicated checks cover released/cancelled replays; release of only the
unconsumed kg, metres and pieces; no increase in physical stock; repeated
release; a valid new hold for the freed remainder; refusal to reactivate
terminal reservations; rejection of new dispatches after release; rollback
of an earlier debit when a later source fails; immutable retry quantities;
null/changed provenance; and exhausted reservation replay. The broader
factory fixture verifies an authenticated public delivery update after the
remaining hold was released. It does not claim that activated packing can
be edited or that public dispatch creation has an idempotency key.

| Verification | Result |
| --- | --- |
| Before fix | Four failed, three passed |
| Focused checks plus factory integration | Eight passed |
| Full suite | 739 passed, 76 suites, zero failed/skipped/cancelled |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed |
| `npm run build` | Passed, 153 pages generated |
| `git diff --check` | Passed |
| Local ledger inventory | Expected unavailable status without a hosted ledger; 150 files, 138 versions, seven existing collision groups |

R04 remains OPEN with a LOCAL CANDIDATE VERIFIED, NOT APPLIED status. The
user's instruction not to run Supabase migrations remains binding. Staging,
hosted activation, independent sessions, actual release permissions and
operator acceptance are not established by these fixtures.

## R05: complete reservation ledger projection

The reservation ledger embedded consumption history and loaded at most 300
reservations, then reported totals over that subset. It also inferred a
consumed status instead of retaining recorded lifecycle evidence. Query
failures could appear as zero totals/empty results, and its broad inventory
read gate differed from the final reservation read-policy cohort. Six initial
actual-page tests failed against that implementation.

Prepared, but did not apply,
`supabase/migrations/20261015010000_reservation_ledger_projection.sql`. The
candidate returns one PostgreSQL snapshot containing the exact filtered count,
all matching summary quantities and ten stable, sorted rows. Search treats
metacharacters literally. The server clamps an out-of-range page to the last
matching page. It retains reserved/consumed/open/released kg, metres and pieces
and the recorded status. Unknown legacy units remain null. It rejects invalid
aggregate evidence rather than replacing it with plausible zero balances.

The final audit added a failing test for a consumption entry whose order,
profile or batch differed from its reservation. The prepared function now
validates that provenance, including null identity, before reporting verified
totals. A negative-quantity test was also made deterministic by selecting the
actor company's row rather than the deliberately injected foreign-company row.

The new endpoint derives company and role from active identity, allows exactly
the eight roles already authorized to read reservations, and explicitly scopes
the reservation, consumption and related-entity joins. Its fixed projection
omits order values, supplier rates, costs and margins. Anonymous/public execute
is revoked; authenticated execute is granted only for this new read function.
Existing RLS and write grants are unchanged. The existing consumption index
already supports company/reservation lookup; no redundant index was added.

The page and inventory overview now use the dedicated reservation-read
capability. Roles outside that cohort see no reservation card and trigger no
reservation query. Failed or missing count metadata renders unavailable rather
than zero. The ledger uses a validated payload, explicit loading/empty/error
states, search/status/sort controls, filter-preserving pagination and order
links. It never exposes raw database errors or renders trusted totals after a
failed/partial result. The schema contract and read-only preflight now include
the required new RPC so missing activation is diagnosable.

Created:

- `lib/inventory/reservation-ledger.ts`.
- `app/(dashboard)/inventory/reservations/loading.tsx`.
- `supabase/migrations/20261015010000_reservation_ledger_projection.sql`.
- `tests/reservation-ledger.test.mjs` and `tests/reservation-ledger-page.test.mjs`.
- `scripts/qa-reservation-ledger.mjs`.

Modified the reservation page, inventory overview, permission helper, schema
contract/preflight and the existing audit integration script/expected assertion,
plus this report and `BUGS-MEGA.md`. Existing uncommitted work was preserved.

Nineteen new behavioral checks cover actual rendered server-page behavior and
the prepared SQL-function definition. The database fixture contains 601 tenant
reservations and a 1,501-entry consumption history, plus foreign/corrupt records.
All 61 pages contain every matching reservation once; the summary remains
constant across pages. The large hold has 499 kg / 249.5 m / 499 pieces open,
with 1,501 kg / 750.5 m / 1,501 pieces posted. The complete fixture summary is
1,999 kg open, 3,001 kg consumed and 3,000 kg released. Additional checks cover
literal `%_` search, filters/counts/sorts, role/suspension/tenant restrictions,
ACLs, read-only execution, invalid provenance/quantities, unknown units and
malformed/truncated/duplicate responses. Extra fields are stripped before use.

The existing whole-audit catalog fixture now also installs the two extracted
R04/R05 function definitions and their relevant candidate ACL statements. It
checks that they coexist with the historical audit views, cost masking and
public/private execute boundaries. The two new migration scripts themselves
were not replayed or applied. No Supabase project was contacted by these checks.
The full suite retains its existing disposable PGlite setup for older scripts.

An isolated Playwright/Chromium check renders the actual server page with
synthetic transport and serves only local built CSS/font assets. All requests
outside its loopback origin are aborted. Initially its missing root font class
made screenshot typography inaccurate. Correcting that harness exposed large
summary overflow at tablet width; the page now uses two columns there and four
on wide screens. The final checks pass at 1440x1000, 820x1180, 390x844 and
320x720. Each viewport verifies ten rows, next-page navigation, no viewport or
quantity overflow, contained table scrolling and an unavailable state without
false zero totals. Eight screenshots and `results.json` are saved in:

`C:/Users/arnav/.codex/visualizations/2026/10/15/01a13e40-ffdd-7a00-86c5-fe3b2d0a5d19/reservation-ledger`.

Screenshots were visually inspected, including the corrected tablet summary
and compact-mobile verified/unavailable states. This is isolated rendered-page
evidence, not a signed-in Next.js/Supabase journey or deployed-browser proof.

| Verification | Result |
| --- | --- |
| Pre-fix page reproduction | Six checks failed |
| Final-audit altered-lineage reproduction | Failed before its guard, passed after |
| Focused new checks plus catalog integration | 20 passed |
| Full suite after final source changes | 758 passed, 76 suites, zero failed/skipped/cancelled |
| `npm run lint` | Passed, no warnings/errors |
| `npm run typecheck` | Passed |
| `npm run build` | Passed, 153 pages generated |
| Isolated browser QA | All four viewports passed; no page errors |
| Tracked diff and new-file whitespace | Passed |
| Local ledger inventory | 151 files, 139 versions, same seven collisions; unavailable without hosted ledger |

R05 remains OPEN with a LOCAL CANDIDATE VERIFIED, NOT APPLIED status. Until
the compatible read RPC is activated, the page deliberately shows unavailable.
The current required REST contract contains 30 probes; the earlier 29-probe
snapshot does not verify this proposed endpoint. No new hosted schema check,
Supabase migration, hosted data write or deployment was performed.

Manual acceptance remains pending after separately authorized schema activation:
open the ledger as an allowed operational user and verify more than 300 real
reservations, a large consumption history, literal search, status/sort filters,
last-page navigation and kg/metre/piece reconciliation. Check denied roles and
another company's identity through real JWTs. Verify empty, unavailable and
loading states on signed-in desktop/mobile screens. Repeat an already posted
partial dispatch after releasing only its remaining hold and verify unchanged
physical stock and consumption history. Test independent contending sessions.
No item in this checklist is represented as completed hosted/operator evidence.

## R01-R05 verified checkpoint

R01-R03 are locally fixed. R04-R05 are verified local candidates requiring
database activation and remain open. The final suite has 758 passing tests,
53 more than the original 705-test baseline. The no-Supabase-migrations
instruction remains in force. No new dependency, RLS policy or historical
data backfill was introduced.

A00, complete migration-chain replay, real JWT/RLS/Storage acceptance,
independent-session contention, direct-order commercial lineage, physical
returns, standalone adjustments combined with separately issued credits,
historical stock reconciliation, operator UAT and deployment remain open.
This checkpoint does not complete the overall goal or certify release.

## R06: standalone adjustment plus full return credit

The unresolved financial reconciliation question is now a confirmed defect.
The current payment transaction records the `credit_note` method as a posted
`ADJUSTMENT`. Collection-state calculation includes that amount in settlement.
The separate return-credit workflow also credits the full invoice value.
Neither posting path checks the other ledger's non-cash source.

Executing the actual current public/private functions reproduced these results:

| Synthetic 100-total invoice | Cash actually received | Recorded settlement before return | Refund after a full return credit |
| --- | --- | --- | --- |
| 100 standalone adjustment | 0 | 100 | 100, incorrect |
| 20 cash plus 30 standalone adjustment | 20 | 50 | 50, incorrect |

Seven of the initial nine behavioral SQL checks failed against that source.
The cash-only and authorization controls passed. The existing cash-event
function still excludes the `credit_note` method; duplicated settlement and
refund entitlement is the reproduced defect, not inflation on that cash query.

Prepared, but did not apply,
`supabase/migrations/20261015020000_credit_settlement_exclusivity.sql`. Its
private trigger function and two posting guards enforce one non-cash credit
path per company-scoped invoice. Both obtain the same invoice row lock before
checking the opposite ledger. Inserts and relevant activation/amount/identity
updates reject a posted standalone adjustment alongside an issued return note.
The error names the necessary correction: reverse the standalone adjustment
before replacing it with the full return credit document.

Existing successful retries remain at the original RPC idempotency boundary.
Payment cancellation and credit-note reversal stay reachable. Pending/cancelled
adjustments do not block credit issuance, and reversed notes do not block a
later standalone adjustment. Cash receipts and legitimate cash refunds retain
their accounting behavior. The guard recognizes both the non-cash payment
method and adjustment type, so changing only one discriminator cannot bypass
it. Unchanged metadata on historical records remains editable by the fixture's
privileged reviewer; changing conflicting settlement amounts is rejected.
This does not add application permission to edit posted records.

The historical record set is preserved. The new read-only
`sql/audit-credit-settlement-conflicts.sql` reports mixed source counts/amounts,
the recorded refund and the cash-supported refund without joining individual
payment and note rows in a way that multiplies amounts. A synthetic conflict
seeded before guard installation remains at its recorded 50 refund until an
explicit payment reversal. The report identifies its cash-supported refund as
20. The normal reversal then restores the refund to 20 with audit evidence.
No hosted historical data was queried, inferred to exist or changed.

The posting UI now calls the standalone method a non-cash credit adjustment.
Its heading, details, amount, action and success confirmation match that choice;
cash keeps its existing receipt behavior. Both posting screens explain the
separate full-return document and adjustment-reversal step. The return panel's
mixed figure is labelled receipts/adjustments. These labels are not a historical
balance reconciliation and do not make a legacy conflict's cached refund safe.

Created:

- `supabase/migrations/20261015020000_credit_settlement_exclusivity.sql`.
- `sql/audit-credit-settlement-conflicts.sql`.
- `tests/credit-settlement-conflict.test.mjs` and `tests/credit-settlement-guidance.test.mjs`.
- `scripts/qa-credit-settlement.mjs`.

Modified the payment form, return-credit component, its existing reissue tests,
audit integration fixture/expected assertion, deployment preflight, register
and this report. Existing unrelated uncommitted work was preserved.

The new private function adds no direct execution permission. Its public,
anonymous and authenticated execute privileges are revoked. There is no new
public RPC, RLS policy, write grant, dependency or index. Existing company and
business-role checks remain at the original RPC boundary. Source review found
no competing payment/credit-note before-trigger that changes posting status;
the historical payment audit trigger runs after the write. Full chain/catalog
replay and actual target trigger/function definitions remain separate gates.
The deployment preflight now checks the private guard's attachment, enabled
state, security-definer flag and privileges; REST RPC discovery cannot check it.

Eleven final SQL checks install the extracted candidate function/trigger/ACL
objects in a disposable PGlite fixture, not its migration wrapper. They call
the actual public receipt, reversal, credit and cash-event functions under a
synthetic authenticated SQL role. Owner/admin/accounts posting succeeds;
unapproved roles, suspended identities and forged company/invoice lineage
reject. Fixture inspection uses a privileged observer and does not stand in
for real JWT/RLS testing. The broader existing audit fixture also installs the
extracted guard objects alongside its historical audit scripts, authorized
views and cost masks. The new migration script is not replayed by these checks.

Four additional component checks cover the non-cash/cash labels, request method,
visible correction guidance, rejection handling, same-key retry and navigation
only after success. Controlled hook/router/transport adapters drive callbacks;
React's server renderer checks actual component output. They do not prove a
signed-in browser request or arbitrary thrown-transport recovery.

The isolated Chromium script checks cash receipt, standalone adjustment and
return-credit rendering at 1440x1000, 820x1180, 390x844 and 320x720. It uses
the final built CSS/font and synthetic component state, aborts requests outside
its loopback origin, and never invokes a posting callback. All twelve cases
have visible guidance/controls, no viewport overflow and no page errors.
Final screenshots were inspected, including desktop/compact-mobile adjustment
entry and tablet return-credit layout. Twelve screenshots plus `results.json`
are saved under:

`C:/Users/arnav/.codex/visualizations/2026/10/15/01a13e40-ffdd-7a00-86c5-fe3b2d0a5d19/credit-settlement`.

| Verification | Result |
| --- | --- |
| Pre-fix reproduction | Seven failed, two controls passed; actual false refunds captured |
| New SQL/component coverage | 15 passed |
| Focused financial/catalog regression | 33 passed |
| Full suite after final source changes | 773 passed, 76 suites, zero failed/skipped/cancelled |
| `npm run lint` | Passed, no warnings/errors |
| `npm run typecheck` | Passed |
| `npm run build` | Passed, 153 pages generated |
| Final isolated browser QA | All twelve cases passed |
| Source audit and whitespace | Passed |
| File-only ledger inventory | 152 files, 140 versions, same seven collisions; hosted ledger unavailable |

R06 remains OPEN with a LOCAL CANDIDATE VERIFIED, NOT APPLIED status. No
Supabase migration, hosted data write, historical correction or deployment was
performed. Existing mixed records still need review and an authorized explicit
correction. No full-chain replay, real JWT/RLS or independent-session race is
established by this fixture. Credit-note key binding across distinct dispatches
and concurrent repeat calls remain separate checks.

Manual acceptance after separately authorized activation remains pending:
verify zero-cash/full-adjustment rejection without a new note or audit event;
reverse the standalone adjustment and issue/retry one full return credit;
confirm the refund equals actual net cash, including the 20/30 case; verify
receipt/note reversal histories; run the historical review under the intended
finance identity; reject other companies and unauthorized roles; and race
adjustment versus credit issuance in independent sessions. Complete signed-in
desktop/mobile acceptance for both screens. None is reported complete here.

## R01-R06 verified checkpoint

R01-R03 are locally fixed. R04-R06 are verified local candidates requiring
database activation and remain open. The final suite has 773 passing tests,
68 more than the original 705-test baseline. The no-Supabase-migrations
instruction remains in force. No dependency, RLS policy or historical data
backfill was introduced by this continuation.

A00, complete migration-chain replay, actual JWT/RLS/Storage acceptance,
independent-session contention, direct-order commercial lineage, physical
returns, historical financial/stock reconciliation, operator UAT and deployment
remain open. This checkpoint does not complete the goal or certify release.

## R07: credit-note retry identity

The next financial check confirmed that an existing credit-note key was not
bound to its request details. Reusing the key with another dispatch returned
the first note's ID. Reusing it with a different return reason also succeeded
while the original reason stayed unchanged. This could acknowledge a different
document from the requested one, including a reversed note instead of a new
correction. Five of seven initial SQL checks failed; diagnostics captured both
the wrong dispatch acknowledgment and the retained old reason.

Prepared, but did not apply,
`supabase/migrations/20261015030000_credit_note_retry_binding.sql`. The private
issuer obtains a transaction-scoped advisory lock derived from the active
company and request key before lookup. It compares the stored dispatch and
trimmed reason, returns the original note for an exact retry, and rejects a
conflicting request with a clear review/correction message. Authorization stays
before lookup and an absent role explicitly rejects. Historical note rows are
not rewritten; corrected issuance after reversal uses a fresh key as in R03.

A direct source comparison passed: the function suffix from dispatch locking
through invoice/status validation, item snapshot, numbering call, note insert,
balance update and audit event is unchanged from the prior definition. No
public wrapper, signature, grant, RLS policy, dependency or column changed.
The candidate retains private execution revocations. Actual business-number
allocation is a sequence stub in these fixtures and is outside their claim.

Created `tests/credit-note-idempotency.test.mjs`. Nine checks cover exact
space-trimmed repeats; other/foreign/unknown/null targets; changed reasons;
reversed-note replay; fresh-key correction; a failed R06-conflicting attempt
followed by correction and retry; company-local key namespaces; owner/admin/
accounts and denied/absent/suspended roles; private/anonymous execute denial;
and existing key/reason/lifecycle rejection. Snapshot comparisons prove failed
conflicts do not change note history, invoice balances or audits.

Updated the existing R03 and R06 SQL fixtures and whole-audit catalog fixture
to install the extracted current issuer body. R06's intentionally conflicted
historical fixture now has explicit matching dispatch/reason provenance so its
retry check represents a valid original document rather than missing identity.
The actual-component SQL sequence edits the reason while still holding stale
screen props: the binding conflict surfaces, no refresh occurs and the original
note's reason remains intact. After reversal, a fresh key and corrected reason
still issue exactly once. The catalog fixture verifies all four prepared
function bodies, both credit-settlement triggers and existing cost masks/ACLs.
No new migration script was applied by these tests; definitions/ACL statements
were installed only in disposable PGlite fixtures. No Supabase was contacted.

No application UI source changed in R07. The R06 rendered-browser artifacts
therefore remain evidence for that unchanged UI source, not a new authenticated
R07 browser journey. Component callback/SQL integration exercised the current
candidate. Independent sessions and real JWT/RLS remain separate acceptance.

| Verification | Result |
| --- | --- |
| Before fix | Five failed, two controls passed |
| Final dedicated edge checks | Nine passed |
| Combined credit/correction/settlement/catalog regression | 30 passed |
| Function-tail source comparison | Passed; non-retry issuance logic unchanged |
| Full suite | 782 passed, 76 suites, zero failed/skipped/cancelled |
| `npm run lint` | Passed, no warnings/errors |
| `npm run typecheck` | Passed |
| `npm run build` | Passed, 153 pages generated |
| Source audit and whitespace | Passed |
| Local ledger inventory | 153 files, 141 versions, same seven collisions; hosted ledger unavailable |

R07 remains OPEN with a LOCAL CANDIDATE VERIFIED, NOT APPLIED status. The
lock is present and executes locally, but this is not independent-session race
proof. Private function-body activation cannot be established by public RPC
presence. Full chain/catalog review, real identities, concurrent same-key
replays/conflicting targets, rollback and authenticated operator acceptance
remain required. No Supabase migration, historical rewrite or deployment ran.

## R01-R07 verified checkpoint

R01-R03 are locally fixed. R04-R07 are verified local candidates requiring
database activation and remain open. The current suite has 782 passing tests,
77 above the 705-test baseline. The no-Supabase-migrations instruction remains
in force. Full hosted, historical, concurrency and operator gates remain open.

The user confirmed that order creation must offer both quotation-backed and
direct priced-line orders. The direct-order investigation now proceeds with
that requirement; it is not resolved by forcing all orders through quotations
or inventing historical line prices. The overall goal remains active.

## R08: both quotation and direct priced-line order entry

The user chose both options when asked whether orders must require a quotation
or also allow priced direct lines. The factory `/orders/new` route now offers
"From approved quotation" and "Direct priced order". Quotation selection and
existing quote-ID deep links remain. Direct entry is available to internal
owner, admin, sales-manager and sales roles. Existing operational/dealer
commercial boundaries remain; this continuation does not add dealer direct
pricing.

The baseline diagnostic called the actual previous `private.save_order_atomic`
with an intended INR 8,850 order and a priced line inside its JSON payload. It
stored zero lines and an order value of zero. This demonstrates the old header
endpoint's incomplete direct-entry contract. It does not establish that every
historical or hosted direct order is broken. Existing line guards also rejected
non-quotation line creation, and billet rebuilding considered quotations or a
single production header rather than complete direct profile lines.

Prepared, but did not apply,
`supabase/migrations/20261015040000_direct_priced_orders.sql`. It defines the
new `public.create_direct_order_atomic(jsonb,jsonb,uuid)` wrapper and private
implementation. The transaction validates 1-100 priced profile lines, whole
piece counts, three-decimal lengths/section weights, two-decimal agreed rates
and GST, valid HSN syntax, customer/profile/die company ownership, active
profiles and compatible optional dies. It reads/locks master records, rejects
an outdated section-weight preview and calculates kilograms, line values,
line GST and order value in PostgreSQL. No caller-supplied total, company ID,
order number, costing, supplier rate or artificial quotation is accepted.
New saves and option searches exclude soft-deleted customers/profiles; an
optional die must also be undeleted. Original completed-request recovery stays
before later master-availability checks.

The request ledger stores the normalized input and accepted material snapshot.
It has company/key and order uniqueness, a deferred order FK, RLS enabled with
no browser policies, and all client table privileges revoked. A company/key
transaction lock precedes lookup. Exact repeats return the original order,
including after later master changes or cancellation; conflicting details
reject. Failed attempts roll back their key, header, lines, requirement/queue
records, history, numbering and audit event. The accepted alloy/temper/diameter
and weight snapshot drives future direct-order billet rebuilding, so later
master edits cannot silently change an existing material requirement.

Initial line creation and total refresh are authorized only for that private
transaction while its request remains incomplete. Commercial identities,
prices, quantities and source snapshots are immutable afterward, including
for business owners through application access. Operational priority, delivery
notes and existing order edits remain. The old header-save RPC now rejects new
direct orders and points to complete priced-line entry. Its quotation/edit
tail is retained. Existing quotation/dealer fulfillment authorization remains.
The quoted/header-only legacy billet-rebuild tail was compared directly with
its source and is unchanged after the new direct-order branch.
Final source comparisons also passed for the retained generic save tail and
both existing order/order-line guard tails after their new direct-order branch.

Each line retains its exact ID through production, packing and invoice reuse.
Repeated profiles with different finishes or rates remain separate commercial
lines. Production's existing kilogram-balance guard rejects ambiguous or
overcommitted lines. Partial shipments bill their actual shipped kilograms at
the saved rate. A forged packing GST cannot override a managed direct order's
agreed line GST. The prior packing-first precedence remains for unmanaged
historical sources. No existing historical record is repriced or backfilled.

Direct orders below 700 kg enter the existing pending load-consolidation queue.
Commercial sales entry records billet requirements without acquiring factory
allocation permissions. Factory roles retain allocation/release controls. A
cancelled direct order's requirements become cancelled without recording a
physical return. This change does not automatically restock, receive, debit
dealer inventory or settle any invoice. Existing allocated physical material
still needs the appropriate operational review.

The form uses bounded, tenant-scoped customer/profile searches, up to 25 results
with deterministic sorting and literal wildcard escaping. It shows load errors
and disables incomplete entry. Editing a search clears the previous identity;
clearing GST cannot silently become a zero-tax rate. Accepted prices are
deliberate user input; GST/HSN must be checked for the order. Preview calculations
live in `lib/orders/direct-order.ts` and use integer thousandths/paise to match
PostgreSQL rounding. The actual action validates strict inputs and revalidates
`/production/consolidation` as well as order pages after success. A missing
database workflow produces a clear unavailable error without a success or
navigation. One mounted attempt retains its retry key after rejection or lost
transport, and a synchronous pending guard blocks duplicate concurrent clicks.

### R08 files

Created:

- `lib/orders/direct-order.ts`
- `lib/actions/direct-orders.ts`
- `components/modules/orders/direct-order-form-client.tsx`
- `supabase/migrations/20261015040000_direct_priced_orders.sql`
- `sql/audit-direct-order-lines.sql`
- `scripts/lib/direct-order-fixture.mjs`
- `scripts/qa-direct-orders.mjs`
- `tests/direct-order.test.mjs`
- `tests/direct-order-actions.test.mjs`
- `tests/direct-order-entry-page.test.mjs`

Modified for this issue:

- `app/(dashboard)/orders/new/page.tsx`
- `components/ui/searchable-select.tsx` (optional accessible input label)
- `lib/deployment/schema-contract.ts`
- `sql/audit-deployment-preflight.sql`
- `scripts/test-audit-migration-integration.mjs`
- `tests/audit-migration-integration.test.mjs`
- `scripts/test-dealer-fulfillment-integrity.mjs`
- `BUGS-MEGA.md`
- This progress report

The existing quotation form's worktree edits were preserved. No dependency was
installed. Existing public-table RLS, cost masks and mutation grants were not
expanded. The new public RPC grants authenticated execute only and explicitly
checks active identity/company/internal commercial role. Private functions and
request rows remain inaccessible to client roles. The new private request table
has default-deny RLS as additional protection. Catalog checks cover both enabled
snapshot triggers, private ACLs and that RLS flag.

`sql/audit-direct-order-lines.sql` is read-only. It reports missing commercial
lines, invalid quantities/rates/HSN/GST and recorded total discrepancies. A
fixture identity granted only SELECT executes it successfully; comparisons
prove that it leaves records and prices unchanged. Actual hosted historical
data was not queried.

### R08 verification

There are 34 new automated checks: 21 SQL/domain/pipeline checks, eight actual
server-action checks and five actual new-order page checks. They cover distinct
prices/finishes on the same profile; multiple alloys/diameters; rebuild after
master changes; stale/forged section weight; exact 699.999/700 kg queue boundary;
whole quantities, finite numbers and decimal precision; HSN/date/array/value
bounds; role/company/suspension rejection; private ACLs and default-deny RLS;
commercial immutability; production balance; partial-shipment commercial/tax
lineage; legacy tax precedence; late-audit rollback; old header-path rejection;
valid operational edits; and historical read-only review. One test compares 100
priced line calculations with actual PostgreSQL values, including half-paise
rounding.

An actual server-action/public-wrapper integration commits an order and recovers
it in a second sequential transaction with one line, one completed request and
one audit. The existing dealer/sales quotation conversion fixture now installs
the extracted R08 objects and still proves exact stock, kg/piece/metre lineage,
role denial, remaining manufacturing balance and rollback. The whole-audit
catalog fixture now verifies 14 prepared function definitions and four prepared
triggers across R04-R08, alongside existing safe views and commercial masks.
These fixtures have historical column precision and selected real guards, not
the complete production constraint/trigger/catalog environment.

The browser harness bundles the actual React form with real hooks and uses the
actual page's method links. Its loopback adapter calls the actual server actions
and public SQL wrapper against a disposable PGlite fixture. It does not load a
Supabase client or credentials. The quotation child is an explicit fixture
boundary, so this is not a complete quotation UI acceptance journey.

At 1440, 820, 390 and 320 pixels, it checks empty and filled layout, accessible
controls, bounded document/control widths, search-selection invalidation,
cleared GST, adding/removing an incomplete third line, per-line HSN and review
totals. Two profile lines save 165 kg, INR 48,000 before GST, INR 3,375 tax and
INR 51,375 total, with one audit and pending consolidation. Separate cases cover
catalogue failure and missing workflow without a write/navigation. A real
browser request deliberately loses its confirmation after the local commit;
retrying the unchanged details uses the same key and recovers one order, one
request and one audit. Route links switch back to the quotation boundary and
then to direct entry. No page errors were recorded.
Two immediate native form-submit events produce just one action request and
one saved order at every tested viewport.

The browser pass caught an unclear finish selector accessible name; explicit
labels were added. Source review also corrected the consolidation revalidation
route, added section-weight freshness, sealed the material snapshot, preserved
managed direct GST, enabled private-ledger RLS and closed the older unpriced
header RPC path. Each change was rechecked before the final gates.
The last data audit added soft-delete rejection and positive numeric/aggregate
ceiling edge cases before the final suite rerun.

Eleven screenshots and `results.json` are saved under:

`C:/Users/arnav/.codex/visualizations/2026/10/15/01a13e40-ffdd-7a00-86c5-fe3b2d0a5d19/direct-orders`.

Desktop empty, tablet priced and compact-mobile priced screenshots were
inspected. Final desktop priced and mobile lost-confirmation states were also
inspected. The final browser run uses the final application's built CSS/font.

| Verification | Result |
| --- | --- |
| Baseline actual-SQL diagnostic | Intended priced line ignored; zero saved lines/value |
| New SQL/action/page edge checks | 34 passed |
| Existing dealer and sales conversion with R08 definitions | Passed |
| Full suite after final source changes | 816 passed, 76 suites, zero failed/skipped/cancelled |
| `npm run lint` | Passed, no warnings/errors |
| `npm run typecheck` | Passed |
| `npm run build` | Passed, 153 pages generated |
| Interactive local browser QA | Four viewports plus failure/retry/navigation cases passed |
| Source review and whitespace | Passed |
| File-only migration inventory | 154 files, 142 versions, same seven collisions; hosted ledger unavailable |

Only extracted candidate table/RLS/function/trigger/ACL objects ran in disposable
fixtures. The new migration script was not applied to Supabase. R08 remains
OPEN with a LOCAL CANDIDATE VERIFIED, NOT APPLIED status. Until compatible schema
activation, direct entry reports unavailable; it cannot be reported as deployed
or hosted-ready. The required REST contract now contains 31 checks; no fresh
hosted presence or private-body activation conclusion is claimed.

The direct commercial flow is create-only. An erroneous committed price or
quantity needs review of existing commitments and a corrected order; there is
no new commercial line-revision UI or automatic historical backfill. Direct
dealer pricing, exact physical returns and all original hosted/history/reporting
investigations remain separate. This fixture does not prove actual Supabase
JWTs/RLS/Storage or independent-session concurrency.

Manual acceptance after separately authorised schema activation remains pending:
reconcile the complete ledger/prerequisites and replay in disposable staging;
exercise both quotation and direct entry as signed-in intended roles; verify two
companies and denied/suspended/dealer identities; repeat profile lines with
different finishes, rates and GST through planning, packing and partial invoices;
verify below-minimum release controls and commercial field masks; race same-key
retries/conflicts in independent sessions; review historical missing/invalid
commercial lines without inventing prices; and complete desktop/mobile operator
UAT. No authority to run migrations is inferred from this checklist.

## R08 checkpoint (superseded below)

R01-R03 are locally fixed. R04-R08 are verified local candidates requiring
database activation and remain open. The current suite has 816 passing tests,
111 above the 705-test baseline. The no-Supabase-migrations instruction remains
in force. The user requirement for both factory order-entry options is captured
in R08's local implementation and evidence; no historical prices were invented.

A00, full hosted/schema/security acceptance, independent sessions, historical
reconciliation, remaining cancellation/release and physical-return questions,
operator UAT and deployment remain open. The overall goal remains active.

## R09 - Dispatch detail reservation ledger

Status: OPEN; LOCAL CANDIDATE VERIFIED, NOT APPLIED.

Continuing the partial-release investigation after R08 reproduced a separate
display defect in the actual dispatch detail reservation panel. It summed
embedded consumption histories, counted any positive remainder as active
regardless of released/cancelled lifecycle, and ignored reservation-read errors.
It also loaded headers without server pagination or a reservation read gate.

Before product edits, seven of eight real-panel checks failed. A 2,000 kg /
1,000 m / 2,000-piece reservation with 1,501 consumption entries was represented
by the embedded 1,000-entry subset. Two released/cancelled 10 kg holds with 4 kg
consumed each were incorrectly included as 12 kg active. Only the empty-ledger
control passed. Failures also covered missing/error reads and unauthorized roles.

The prepared follow-up reuses one private SQL calculation for global inventory
and dispatch detail. The existing inventory public RPC retains its signature,
filters, stable ten-row pages and eight operational roles. The new dispatch RPC
requires both dispatch and reservation read permissions (owner, admin, factory
manager, inventory manager, dispatch manager or dispatch). It resolves dispatch
and source order within the company derived from the active identity. Its one
read-only snapshot includes complete source-order totals plus ten rows; an
unlinked dispatch never falls through to an unfiltered global ledger. No
commercial values, other-company labels or private implementation execute
privilege are exposed.

The shared calculation keeps original reservation units where recorded, sums
all consumption entries, and separates open active remainders from released or
cancelled commitments. It additionally rejects non-finite source amounts,
missing/unknown lifecycle and consumed records with known unconsumed balances.
Invalid matching source evidence outside the visible page invalidates the
snapshot. Unrecorded legacy metres/pieces remain null. This read projection does
not post physical stock movements or change any reservation lifecycle.

The page removes embedded consumption reads, requires both read permissions,
shows order-wide open/consumed/released kg and record count, and displays kg,
metres and pieces for each reserved/consumed/open/released row. It preserves
recorded lifecycle and release dates. Server links reach older pages. Error,
verified-empty, unlinked-source and unknown-unit states are distinct; raw errors
are not shown and failed reads cannot claim zero commitments. Shared response
validation rejects conflicting quantities, small-ledger summary totals, wrong
order/dispatch identities, truncated/duplicate rows and an incorrect requested
page (while allowing the last-page clamp).

Created in this continuation:

- `supabase/migrations/20261015050000_dispatch_reservation_ledger.sql`
- `scripts/lib/dispatch-reservation-ledger-fixture.mjs`
- `scripts/lib/dispatch-reservation-render-fixture.mjs`
- `scripts/qa-dispatch-reservation-ledger.mjs`
- `tests/dispatch-reservation-ledger.test.mjs`
- `tests/dispatch-reservation-ledger-page.test.mjs`

Modified in this continuation:

- `app/(dashboard)/dispatches/[id]/page.tsx`
- `lib/inventory/reservation-ledger.ts`
- `lib/deployment/schema-contract.ts`
- `sql/audit-deployment-preflight.sql`
- `tests/reservation-ledger.test.mjs`
- `scripts/test-audit-migration-integration.mjs`
- `tests/audit-migration-integration.test.mjs`
- `BUGS-MEGA.md`
- `docs/BUGS_MEGA_PROGRESS_2026-10-15.md`

The dedicated SQL fixture loads historical column types, then only the three
extracted candidate function definitions and their ACL statements. Authenticated
fixture roles have no direct private-schema or business-table grants. The data
has 601 matching reservations, a 1,501-entry consumption history, another order
and a sibling company. The complete target-order summary is 1,399 kg open,
4,801 kg consumed, 1,800 kg released and 151 active records. Every one of the
61 stable pages is checked without gaps/duplicates; two dispatches of the same
order have the same ledger. An unrelated bad order cannot poison this order,
while invalid hidden rows and mismatched consumption provenance fail closed.

The fixture also checks unlinked/broken/foreign/missing dispatches, all six
allowed roles and denied production/commercial/portal roles, suspended/absent
identity, original global coverage and roles, null legacy units, immutable
physical stock/history under the reader, invalid bounds, actual read-only
execution, anonymous denial and direct-private denial. Released/cancelled source
states are installed by the observer for projection tests; this is not proof of
a public cancellation/release transaction or a physical return.

The thirteen page/loader checks render the actual route/panel with synthetic
identity/transport. They exercise complete summaries, page 61, unavailable and
empty responses, all role gates, null legacy units, unlinked source, URL bounds,
invalid request rejection before RPC, mismatched identities and contradictory
quantities/status/summary/page evidence. No reservation table reads are allowed.
The eight existing inventory-page tests remain green. The eleven older inventory
SQL tests now install the latest shared calculation, retaining their 601-order,
61-page, literal search, filter, stable-sort, role, provenance and invalid-data
regressions. The historical integration fixture now installs 17 extracted
prepared function definitions and four triggers after its eight historical
audit scripts, while preserving table/column masks and private/anonymous denial.

Only extracted R09 function/ACL objects were executed in disposable PGlite.
No new migration script was applied to Supabase. The file-only reconciler
reports 155 files, 143 versions and the same seven collision groups; without a
hosted ledger its result remains unavailable. The required REST contract has
32 checks (20 RPCs and 12 columns). No hosted presence/body/ACL conclusion is
inferred from this file-only inventory.

The final source review checked identity derivation, exact company/order and
relationship scoping, original-role parity, public/private execute boundaries,
complete aggregation before pagination, source integrity beyond the visible
page, conservation in kg/metres/pieces, legacy nulls, lifecycle/date labels,
read-only execution and sanitized error/empty states. Existing reservation read
cohorts and commercial masks remain intact. No table/RLS/index/stock/history
change is introduced by R09; the prepared candidate contains only three
function definitions and execute ACLs.

The first full run had 839 passes and one failure: a pre-existing safety check
caught the removal of the operator explanation that consumption posts
automatically with dispatch. That explanation was restored, with a real-panel
assertion in addition to the older source check. Review also labels consumed
closure dates as Closed rather than Released. The first lint run caught one
unescaped apostrophe in the new unavailable message; the copy was corrected.
An initial browser assertion expected title case although the shared badge CSS
renders uppercase; the assertion now checks the visible label without assuming
case. Product behavior and all final checks were reverified after corrections.

`scripts/qa-dispatch-reservation-ledger.mjs` serves the actual route/panel over
loopback using synthetic identity/RPC transport and the application's built
CSS/fonts. It exercises real next/previous links at 1440, 820, 390 and 320 pixels,
ten-row pages, complete totals, page 61, and mobile released, unknown-unit,
verified-empty, unlinked-source, unavailable and large-quantity states. Table
scroll stays contained and document/navigation widths remain bounded. No page
errors were recorded. Other dispatch children are fixture boundaries, so this
does not establish a full authenticated dispatch journey.

Eleven screenshots, `results.json`, the initial full-test log and
`full-test-final.log` are saved under:

`C:/Users/arnav/.codex/visualizations/2026/10/15/01a13e40-ffdd-7a00-86c5-fe3b2d0a5d19/dispatch-reservation-ledger`.

Desktop, tablet, compact-mobile, large-number and unavailable screenshots were
inspected. The final browser run uses the final application's built CSS/font.

| Verification | Result |
| --- | --- |
| Baseline actual dispatch-panel tests | Seven failed; verified-empty control passed |
| New SQL/page/loader edge checks | 24 passed |
| Existing inventory regressions on latest shared calculation | Passed |
| Integrated historical fixture and prepared definitions | Passed; masks/private ACLs retained |
| Final `npm test` | 840 passed, 76 suites, zero failed/skipped/cancelled |
| Final `npm run lint` | Passed, zero errors/warnings |
| Final `npm run typecheck` | Passed |
| Final `npm run build` | Passed, 153 pages generated |
| Responsive local browser QA | Four viewports plus state/navigation cases passed |
| Source audit / new-file whitespace / tracked diff check | Passed |
| File-only migration inventory | 155 files, 143 versions, same seven collisions; hosted ledger unavailable |

Manual acceptance after separately authorised schema activation remains pending:
reconcile the complete ledger and prerequisites; review effective function
bodies/ACLs; use signed-in intended and denied/suspended/second-company roles;
trace real partial shipments and release/cancellation through both ledgers in
kg/metres/pieces; verify older pages and unavailable recovery; race independent
sessions while shipments/releases change; reconcile source documents and physical
returns; and complete desktop/mobile operator UAT. This checklist grants no
authority to run migrations. R09 adds neither a release UI nor a physical-return
receipt, historical repair or deployment.

## R09 checkpoint (superseded below)

R01-R03 are locally fixed. R04-R09 remain verified, unapplied local database
candidates. The final suite has 840 passing tests, 135 above the 705-test
baseline. The user's no-Supabase-migrations instruction remains in force.
A00, historical reconciliation, hosted
JWT/RLS/Storage, independent-session races, physical returns, release UI,
authenticated operator journeys and deployment remain open. The overall goal
remains active.

## R10 - Order cancellation and physical stock integrity

Status: OPEN; LOCAL CANDIDATE VERIFIED, NOT APPLIED.

The next partial-release investigation traced the actual cancellation trigger,
rather than installing a released status directly as earlier projection/replay
fixtures did. The latest `public.credit_dealer_stock_on_order_cancel` body was
still in `0041_dealer_roles_inventory_automation.sql`. Cancellation automatically
added all uncredited dealer fulfillment kg and pieces back to a batch, marked it
available, posted a positive movement and stamped fulfillment credited. It did
not restore metres or require a physical receipt, and it left active profile
holds attached to the cancelled order. The capacity guard also permitted a new
active reservation when its parent order existed but was cancelled.

The initial real-trigger fixture, with current R08 guards and actual reservation
policies, failed seven of eight acceptance checks. The sibling-company control
passed. A batch physically holding 40 kg / 20 m / 4 pieces became 60 kg / 20 m /
6 pieces without any receipt. A target hold with 30 kg / 15 m / 3 pieces reserved
and 10 kg / 5 m / 1 piece consumed stayed active, blocking its 20 kg / 10 m /
2-piece remainder. An unrelated order also held 20 kg / 10 m / 2 pieces. Checking
kg availability alone could conceal part of the error; all physical units and
posted movement/fulfillment evidence are therefore compared.

The prepared candidate retains the existing trigger function/attachment name
for compatibility. A real transition to cancelled requires an active same-company
owner/admin and unchanged order identity/company. The parent update holds the
order lock; target active reservations are locked with NOWAIT in stable order.
The complete R09 private projection validates all matching histories before any
hold is changed. Only those active holds become cancelled with a close timestamp.
Initial/current reserved units, posted consumption, existing terminal holds,
physical stock batches, dealer fulfillment and inventory movements are retained.
One stage entry explains that physical returns require a receipt, and one audit
records actor, released record count, complete open kg and unchanged physical
stock. A repeated cancelled-stage update creates no duplicate release or audit.

A private before-write guard locks the same-company parent order with NOWAIT and
rejects new active holds on a cancelled order, including an identity/status update
that would attach one. Its trigger sorts before the existing batch-capacity guard.
Inactive transitions do not take an unnecessary parent lock. Existing terminal
and quantity/capacity checks remain. The cancellation lock and error path avoid
waiting on a dispatch that already holds a reservation and may later need the
order; the whole operation rolls back with a retry on a reported lock conflict.
Independent-backend race behavior still requires separate acceptance.

No public business RPC, table, index, RLS policy or new write privilege is added.
Both trigger implementations revoke direct public/anonymous/authenticated execute.
No historical data is rewritten. The new read-only review lists cancelled orders
retaining active holds and credited fulfillments requiring receipt/source review;
it explicitly does not establish that a recorded credit represented returned
goods. Historical stock, receipts, credits and commercial reconciliation remain
open.

Created during this investigation:

- `supabase/migrations/20261015060000_order_cancellation_stock_integrity.sql`
- `sql/audit-order-cancellation-stock.sql`
- `scripts/lib/order-cancellation-stock-fixture.mjs`
- `scripts/qa-order-cancellation-stock.mjs`
- `tests/order-cancellation-stock.test.mjs`

Modified during this investigation:

- `scripts/lib/dispatch-reservation-render-fixture.mjs`
- `scripts/test-audit-migration-integration.mjs`
- `tests/audit-migration-integration.test.mjs`
- `scripts/test-dealer-fulfillment-integrity.mjs`
- `tests/dealer-fulfillment-integrity.test.mjs`
- `scripts/test-factory-workflow-integrity.mjs`
- `sql/audit-deployment-preflight.sql`
- `BUGS-MEGA.md`
- `docs/BUGS_MEGA_PROGRESS_2026-10-15.md`

Seventeen new SQL checks and the 33-check focused set pass. They exercise real
trigger execution through an authenticated SQL role with synthetic identity and
typed historical tables. The fixture includes current R08 order/snapshot guards,
R09 reader bodies, reservation and batch-capacity guards, exact packing lineage,
the actual reservation policies and a synthetic company-scoped order policy.
This does not reproduce the full hosted JWT/RLS catalog or baseline migration
chain.

Coverage includes unchanged stock/fulfillment/movements/history under cancellation,
exact 20 kg / 10 m / 2-piece release, other-order preservation, repeat timestamps
and one audit, bad source evidence, late audit rollback, terminal/non-reactivation
rules, ample-stock rejection of a new hold on a cancelled parent, 602 target holds,
and 1,501 separately linked consumption entries leaving an exact 499 kg remainder.
The large-history batch stays 1,499 kg / 749.5 m / 1,499 pieces; the audit records
519 kg including the original target hold's 20 kg. No API row cap participates in
the transaction's quantities.

Role tests use a fixture-only privileged writer to prove the cancellation trigger
still rejects other-company, suspended, absent and unauthorized role identities,
even when the parent writer bypasses ordinary row visibility. Active owner/admin
cases succeed. Reinstalling extracted objects changes no business data; catalog
preflight verifies both enabled attachments, security-definer mode and revoked
direct execute. The historical review executes in an actual read-only transaction,
finds the legacy reproduction and leaves the new cancellation clear. A reported
55P03 conflict is fault-injected to verify error/rollback behavior; this is not
independent-session lock testing.

An exact actual dispatch-consumption replay after the real order-cancellation
trigger succeeds twice without a second debit. The existing dealer fixture now
converts a quote with the actual current private function, then cancels as its
active owner and proves exact stock, fulfillment, movement and commercial lineage
preservation. The existing factory fixture installs the new reservation eligibility
guard while retaining its other source-specific boundaries. The historical catalog
fixture installs 19 extracted prepared function definitions and six triggers after
eight historical audit scripts, preserving masks and private/anonymous denial.

Verification caught an initial audit-column mistake (`user_id`/`metadata` instead
of the existing `actor_id`/`metadata_json`) and corrected it. A replay fixture
initially supplied an order-line identity where reservation packing requires the
reservation ID and source order; the existing lineage guard rejected it and the
fixture was corrected. Review added fail-fast reservation locking and its rollback
case before final gates. None of these failures was treated as a pass.

The SQL-backed browser fixture serves the actual dispatch reservation panel with
the actual read RPC and extracted candidate objects in disposable PGlite. It uses
synthetic identity, current built CSS/fonts and loopback-only assets. At 1440, 820,
390 and 320 pixels it checks the panel before and after cancellation: 20 kg open /
10 kg consumed / zero released becomes zero open / 10 kg consumed / 20 kg released,
with 2 pieces and 10 m released. Physical stock remains 40 kg / 20 m / 4 pieces, one
audit is recorded and the unrelated hold stays active. Cancellation itself is an
authenticated local SQL control; no browser cancellation button, hosted login,
physical receipt or complete operator journey is substituted.

Eight screenshots and `results.json` are saved under:

`C:/Users/arnav/.codex/visualizations/2026/10/15/01a13e40-ffdd-7a00-86c5-fe3b2d0a5d19/order-cancellation-stock`.

Desktop and compact-mobile after-cancellation screenshots were inspected. Browser
checks report no page errors or document overflow. The final run uses the final
application build's CSS/fonts. The file-only ledger reports 156 files, 144 version identifiers and
the same seven collision groups; without hosted metadata its status remains
unavailable. The REST contract remains 32 checks; trigger activation and body/ACL
review require the catalog and are not inferred from REST discovery.

| Verification | Result |
| --- | --- |
| Initial real cancellation-trigger checks | Seven failed; sibling-company control passed |
| New cancellation SQL edge checks | 17 passed |
| Focused cancellation/reader/factory/dealer/catalog regression | 33 passed |
| Final `npm test` | 857 passed, 76 suites, zero failed/skipped/cancelled |
| `npm run lint` | Passed, zero errors/warnings |
| `npm run typecheck` | Passed |
| `npm run build` | Passed, 153 pages generated |
| Actual SQL-backed reservation panel before/after cancellation | Four viewports, eight screenshots, zero page errors/overflow |
| Source audit, tracked diff and new-file whitespace | Passed for R10; separate R11 blocker recorded below |
| File-only ledger | 156 files / 144 versions / same seven collisions; hosted metadata unavailable |

R10 therefore remains OPEN with a LOCAL CANDIDATE VERIFIED, NOT APPLIED status.
Only extracted function/trigger/ACL objects ran in disposable PGlite. No Supabase
migration, hosted business-data query/write or deployment was performed. The
function depends on R09's shared private reader and the full earlier prerequisites;
do not apply only this newest file.

Manual acceptance after separately authorized schema activation remains pending:
review the complete migration ledger and effective guards/ACLs; use real active,
denied, suspended and second-company identities; trace posted partial shipments,
dealer fulfillment, both reservation readers and cancellation in all units;
repeat exact requests and race reservation/dispatch/cancellation in independent
sessions; reconcile historical automatic credits against physical receipt/source
evidence; and complete operator cancellation/release/return journeys. Invoicing
retained shipments must also be resolved and accepted through R11. This checklist
does not authorize a migration or certify a production cancellation workflow.

## R11 baseline - Invoicing retained shipments after cancellation

The final cross-workflow source audit found `saveInvoiceAction` rejecting the
cancelled parent stage before checking the supplied dispatch. A new diagnostic,
`scripts/audit-cancelled-order-invoice.mjs`, calls the actual action after the real
local R10 trigger has cancelled the remaining order. Its synthetic active owner
selects an existing same-company delivered dispatch. The action returns exactly
`A cancelled order cannot be invoiced.` after querying only `orders`, with no
dispatch lookup or invoice write. The physical batch remains 40 kg / 20 m /
4 pieces and the delivered shipment remains recorded.

The diagnostic completed with `findingConfirmed: true`; that means the blocker
was reproduced, not that invoice acceptance passed. Its result is saved as
`cancelled-invoice-diagnostic.json` in the R10 evidence directory. It does not
establish whether every remaining SQL/packing/commercial condition would accept
the invoice if this early gate changed. No invoice action or database writer has
been edited for R11, and no invoice was created. The 857-test suite does not close
this newly reproduced gap.

R11 is OPEN; REPRODUCED, NOT FIXED. Next work is to inspect the current application
and SQL invoice writers, establish failing action/SQL tests for retained posted
shipments after cancellation, and preserve company/role, exact fulfillment,
packing/commercial, damage/return, duplication and issued-snapshot controls while
repairing the eligible path. Full cancellation acceptance remains open.

## Current continuation checkpoint

R01-R03 are locally fixed. R04-R10 remain verified, unapplied candidates. R11 is
reproduced and unfixed. The suite has 857 passing tests, 152 above the 705-test
baseline; the separate R11 diagnostic records a blocker rather than acceptance.
The no-Supabase-migrations instruction
remains in force. A00, historical reconciliation, hosted security, independent
sessions, operator cancellation/release controls, physical-return receipts,
authenticated operator journeys and deployment remain open. The goal remains
active.

## 19 October continuation pointer

The checkpoint and R11 baseline above are historical. The subsequent R11 local
candidate, 919-test verification, browser evidence and current acceptance
boundaries are recorded in `docs/BUGS_MEGA_PROGRESS_2026-10-19.md` and the updated
`BUGS-MEGA.md`. R11 remains OPEN as a verified, unapplied candidate. R12-R15 are
subsequently locally fixed after full regression/audit checks. The no-Supabase-migrations instruction and
the active goal remain in force.

The later scrap-posting investigation adds twelve passing local scenarios
(13 tests including the enclosing case), taking the full suite to 1,072. It
separately reproduces R16 in production report reconciliation; that report defect
remains open and is not covered by the passing posting controls.

That R16 reproduction is now historical. The subsequent application-reader fix
is locally verified with 67 new report tests, 1,139 total passing tests, final
lint/typecheck/build and five inspected actual-action PDFs. R16 is locally fixed;
the current evidence and remaining boundaries are in the 19 October report.
R04-R11 remain unapplied and no Supabase migrations have run.

The subsequent R17 finishing-evidence investigation prepares a verified,
unapplied database candidate and adds 43 tests, taking the final full suite to
1,182 passing tests / 76 suites. Final lint, typecheck and build (153 pages) pass.
R17 remains OPEN under the same no-migrations instruction. The 19 October report
retains its reproduction, earlier failing test runs, final checks and boundaries.

# Find, repeat, guidance, dispatch review, and stage timing

Date: 21 October 2026

## Delivery and scope

This delivery implements catalogue features 3, 9, 20, 26, and 49 in the existing
search, quotation, dispatch, and order database workflows. Interactive desktop
and phone inspection and final independent main-checkout verification have
passed. The five catalogue entries are marked complete for the local scopes
below. Authenticated hosted acceptance and deployment remain separate steps.

Final application and test checkpoint: `2bee265872b6b05bc3e65c3bff55bd3c09469dfa`.
The initial feature implementation is `c4494827ad200ffea03d99cd636c77f056c99ddf`;
the final checkpoint includes the subsequent quotation phone-layout correction.
Development took place in the existing `codex/v1` checkout, followed by a
fast-forward of `main`. The first feature commit preserved the pre-existing
staged maintenance-page rename byte for byte. Concurrent ERP work then committed
that rename and other existing work in `2a77d28` and `853c4dc`; these commits were
retained in the final shared history. Their migrations and ERP changes are not
attributed to this feature batch. Other pending edits remain preserved. No new
branch or worktree was created.

| Feature | Resulting behaviour | Scope boundary |
| --- | --- | --- |
| 3: Instant Find and Act | Search updates after a short typing pause. Each permitted record has identifying details, a canonical Open link, and an authorized contextual action where available. An order action opens dispatch preparation with that exact order selected. | At most six matches per record type; submitted full search remains available. The action checks readiness and does not promise that stock is available. |
| 9: Repeat Previous | An owner/admin can start a new unsaved quotation from prior lines, quantities, finishes, terms, and price inputs. Dates and current master section weights refresh; die assignments, die charges, approvals, and transaction identities clear. Expiry is flagged and saving requires commercial review, invalidated by further edits. | Quotation acceptance example only. Transport arrangements and approved production templates remain future extensions. Copied prices are unverified suggestions, not newly approved effective rates; feature 85's rate-version infrastructure is separate. |
| 20: Contextual guidance | Accessible disclosures in quotation and dispatch entry explain button effects, physical units, theoretical weight, recovery assumptions, selling margin, stock consumption, and uncertain confirmation. | English guidance for these two forms. Wider terminology coverage, selected translations, and employee training trials remain separate work. |
| 26: Consequential-action preview | Review dispatch rechecks sources, then shows the customer/order, exact bundles, measured totals, remaining order pieces/metres, remaining selected-source quantities, and stock-posting consequences. Back/Escape preserves inputs. Confirmation rechecks order quantities and requires review again if they changed; the existing authoritative dispatch action rechecks physical source availability. | Physical dispatch workflow. Order balance is the aggregate across order lines, not proof that each profile/finish is fulfilled. The preview is not a reservation or an atomic snapshot across its reads. Other consequential actions remain future extensions. |
| 49: Time in current stage | An on-demand panel on the order database shows the current stage's recorded entry, calendar elapsed time, and the dispatch due date separately. A reopen uses the latest current-stage interval without modifying earlier history. | Up to ten current-page orders and fifty events per order. Includes holds/non-working time; no active/waiting split or working-hours SLA is inferred from absent metadata. Missing, conflicting, or truncated entry evidence remains unavailable. |

## Audit and security review

All four new server actions use the authenticated session and ordinary Supabase
client. Company identity is derived on the server, not accepted from the browser.
Queries use explicit projections and company filters. Existing RLS and authorized
views remain in force. The repeat action checks owner/admin and quotation read/
create permission before reading priced lines. The dispatch quantity action
requires dispatch-create permission and rejects dealer contexts; stage timing
also rejects dealer contexts. No new public/customer endpoint was introduced.

Instant results omit financial amounts, costs, margins, unrestricted row objects,
and internal notes. Deleted customer rows are excluded. Search input has a bounded
length and removes filter-control characters while retaining slash/hyphen record
identifiers. Returned identities are validated. Resource outages are disclosed
separately from verified empty matches, and stale responses cannot replace a
newer query or unlock its pending state.

Repeat loads a complete bounded set of source lines, the active nondeleted
customer, and active current profiles. Invalid or oversized sources fail before
an editable partial copy appears. A new identity is assigned only by the existing
save action when the new draft is saved; opening Repeat performs no write. The
source quotation and issued documents are not modified. Review state is tied to
the draft inputs and selected master specifications. The workspace remounts on
company/user/role/mode/source changes to isolate delayed responses.

Dispatch preview reuses `readDispatchManifest` and the same
`buildVerifiedPackingListItems` quantity/source validation used by the posting
action. The new order quantity reader uses paginated exact-count order lines and
the existing complete packing-history loader. Missing or invalid evidence blocks
the preview; a negative projected balance is shown as excess, not clamped to zero.
Pieces/metres remain physical quantities and are not inferred from billing kg.
Source quantities and order quantities are shown separately. Confirmation retains
the existing ambiguous-result lock and exact-record navigation behaviour.

Review found and corrected the missing order-level balance, ambiguous timestamp
ties at a stage boundary, elapsed-time rounding based on an old component clock,
and slash-containing business identifiers. The quotation paste fixture was also
updated to mock its new Next link boundary. Final layout review added wrapping
quotation detail actions and `min-w-0` on the items grid column, keeping its wide
table within local horizontal scrolling. The actual asynchronous detail page is
rendered in the browser fixture, and its repeat link is checked for owner versus
sales access. The follow-up review found no additional material issue within
the delivered scope.

No migration, SQL policy, Storage rule, dependency, service-role browser import,
hosted data mutation, credential change, push, or deployment is part of this batch.

## Verification

Initial development verification passed **1,980 tests across 76 suites**, with no failures,
skips, cancellations, or TODOs, in 348.2 seconds. Development lint, typecheck, and
production build passed. That checkout contains unrelated pending work, so its
larger total is supplementary. The first independent main run at `c449482`
passed 1,821 tests; the final run below includes the phone-layout correction,
additional launch regression, and the concurrently committed ERP work.

The independent main-checkout run uses the application/test checkpoint above.
Application and regression sources remained frozen during the final checks.
The final run passed **1,822 tests across 76 suites**, with zero failures, skips,
cancellations, or TODOs, in 342.4 seconds. The focused run passed **77/77** in
34.2 seconds: 18 new action/model cases, 13 mounted workflow/detail-page cases,
and 46 existing quotation/customer/dispatch/database cases.

| Check | Final independent result and evidence |
| --- | --- |
| `npm test` | Passed, 1,822 tests / 76 suites. [Full output](evidence/UPGRADE_EOS_2026-10-21/workflow-upgrades/main-test.log). |
| `npm run lint` | Passed. [Output](evidence/UPGRADE_EOS_2026-10-21/workflow-upgrades/main-lint.log). |
| `npm run typecheck` | Passed. [Output](evidence/UPGRADE_EOS_2026-10-21/workflow-upgrades/main-typecheck.log). |
| `npm run build` | Passed. Uses synthetic public Supabase settings and an empty service-role key. [Output](evidence/UPGRADE_EOS_2026-10-21/workflow-upgrades/main-build.log). |
| Focused workflow and existing form regressions | Passed, 77 tests. [Output](evidence/UPGRADE_EOS_2026-10-21/workflow-upgrades/focused.log). |

The new action/model tests cover role denial before sensitive reads, company
scoping, safe projections, bounded search, unavailable resources, invalid source
lines, refreshed identities/dates/specifications, reopened/duplicate/ambiguous
stage events, missing/future dates, complete paginated order quantities, packing
history failures, grouped material use, and negative remaining demand.

Mounted browser tests exercise actual application components with synthetic
transport boundaries: stale queries, linked-order preselection, repeat-copy
acknowledgment and invalidation, failure without a partial draft, keyboard help,
on-demand timing, exact dispatch review, cancellation, changed shipped balances,
unavailable order quantities, and final server rejection preserving measurements.
Existing quotation/customer/database and dispatch consistency cases also run.

The new server-action fixture is an in-memory query adapter. It proves the
actions' validation, permission decisions, query scope, and response projection;
it does not execute PostgreSQL policies or hosted JWT authentication. Browser
fixtures do not write real records. Existing database and transaction regressions
in the full suite are separate evidence from these new adapter tests. Hosted RLS,
authenticated operator acceptance, deployment, and physical factory trials remain
separate checks.

## Interactive visual inspection

Inspection used the in-app browser, real components, built application CSS/fonts,
and synthetic data on loopback only, at **1280 x 900** and **375 x 812**. The final
screenshots were captured from the main checkout's final built checkpoint above.
No hosted
login or real transaction was used. The browser console had no errors. Phone
checks found no horizontal overflow; the dispatch dialog uses an internal
vertical scroll and keeps its confirmation reachable. At 375 px its border-box
width was 343.33 px, and its client/scroll widths were both 327 px.

Manual acceptance completed:

- Typed an order number without submitting; inspected result identifiers and
  followed Check dispatch readiness to the exact preselected order.
- Inspected the repeated quotation's source/expiry warning, fresh dates, current
  section weight, cleared die charge, and mandatory rate-review acknowledgment.
- Followed Repeat quotation from the actual quotation detail page. Its actions
  wrap on a phone, and the wide items table scrolls inside its card. The 375 px
  viewport had matching document/client width of 360 px after its scrollbar;
  the table scroller had client width 335 px and content width 547 px.
- Opened quotation and dispatch help and inspected the unit/action explanations
  in their desktop columns and stacked phone presentation.
- Entered a 10-piece, 60-metre bundle with 110 kg gross and 10 kg tare. Reviewed
  100 kg measured net, 90 pieces/540 m remaining on the order, and 900 kg left
  from the selected source. Escape left gross 110 and the bundle inputs intact.
- Inspected a 2 d 1 h current-stage interval beside its due date and a separate
  missing-history record; missing timing was not displayed as zero.

| Screen | Desktop proof | Phone proof |
| --- | --- | --- |
| Instant search | [Desktop](evidence/UPGRADE_EOS_2026-10-21/workflow-upgrades/workflow-search-desktop.jpg) | [Phone](evidence/UPGRADE_EOS_2026-10-21/workflow-upgrades/workflow-search-phone.jpg) |
| Repeat quotation | [Desktop](evidence/UPGRADE_EOS_2026-10-21/workflow-upgrades/workflow-repeat-desktop.jpg) | [Phone](evidence/UPGRADE_EOS_2026-10-21/workflow-upgrades/workflow-repeat-phone.jpg) |
| Quotation detail launch | [Desktop](evidence/UPGRADE_EOS_2026-10-21/workflow-upgrades/workflow-quote-detail-desktop.jpg) | [Phone](evidence/UPGRADE_EOS_2026-10-21/workflow-upgrades/workflow-quote-detail-phone.jpg) |
| Quotation guidance | [Desktop](evidence/UPGRADE_EOS_2026-10-21/workflow-upgrades/workflow-quote-help-desktop.jpg) | [Phone](evidence/UPGRADE_EOS_2026-10-21/workflow-upgrades/workflow-quote-help-phone.jpg) |
| Dispatch guidance | [Desktop](evidence/UPGRADE_EOS_2026-10-21/workflow-upgrades/workflow-help-desktop.jpg) | [Phone](evidence/UPGRADE_EOS_2026-10-21/workflow-upgrades/workflow-help-phone.jpg) |
| Dispatch review | [Desktop](evidence/UPGRADE_EOS_2026-10-21/workflow-upgrades/workflow-dispatch-desktop.jpg) | [Phone](evidence/UPGRADE_EOS_2026-10-21/workflow-upgrades/workflow-dispatch-phone.jpg), [confirmation reached](evidence/UPGRADE_EOS_2026-10-21/workflow-upgrades/workflow-dispatch-phone-confirm.jpg) |
| Stage timing | [Desktop](evidence/UPGRADE_EOS_2026-10-21/workflow-upgrades/workflow-stage-desktop.jpg) | [Phone](evidence/UPGRADE_EOS_2026-10-21/workflow-upgrades/workflow-stage-phone.jpg) |

## Files delivered

Created application files: `components/forms/task-guidance.tsx`,
`components/modules/orders/stage-waiting.tsx`, `components/search/instant-find.tsx`,
`components/ui/review-dialog.tsx`, `lib/actions/instant-search.ts`,
`lib/actions/repeat-quote.ts`, `lib/actions/order-stage-age.ts`,
`lib/actions/dispatch-order-balance.ts`, `lib/dispatches/review.ts`,
`lib/forms/repeat-quote.ts`, `lib/workflow/instant-search.ts`, and
`lib/workflow/stage-age.ts`.

Modified application files: the search page, new quotation page, quotation detail
page, new dispatch page, `components/modules/quotes-client.tsx`,
`components/modules/dispatch-form-client.tsx`, and
`components/modules/operations/module-database-client.tsx`.

Created verification files: `tests/upgrade-workflow-actions.test.mjs`,
`tests/upgrade-workflow-browser.test.mjs`,
`scripts/lib/upgrade-workflow-actions-fixture.mjs`,
`scripts/lib/workflow-browser-bundle.mjs`, and
`scripts/visual-workflow-upgrades.mjs`.

Updated verification files: `scripts/lib/dispatch-form-browser-fixture.mjs`,
`scripts/visual-in-task-customer.mjs`, `tests/dispatch-form-consistency.test.mjs`,
`tests/in-task-customer-browser.test.mjs`,
`tests/module-database-state-browser.test.mjs`, and
`tests/quote-paste-browser.test.mjs`. This report, its evidence folder, and the
five completion entries in `UPGRADE_EOS.md` record the delivery.

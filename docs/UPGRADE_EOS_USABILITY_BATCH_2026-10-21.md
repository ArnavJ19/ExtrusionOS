# Upgrade catalogue usability batch, 21 October 2026

## Scope and acceptance state

This batch implements five additional catalogue features: 2, 4, 21, 24, and 42.
Feature 1 was delivered separately and is not counted toward this five-feature batch.
Three user-requested Luna agents implemented navigation, quotation entry, and
workspace/table preferences. The parent reviewed their diffs, required repairs,
ran integrated checks, and performed the available interactive visual inspection.

| Feature | Delivered behavior | Local acceptance |
| --- | --- | --- |
| 2. Task-based navigation | Four role-prioritized destinations, grouped More menu on desktop and phone, feature/route/role filtering, alias active state, keyboard focus and Escape | Complete for local verification; automated, audit, and interactive visual checks passed |
| 4. Pinned shortcuts and working context | Company/user-scoped pins, recent records, named views, list search/filter/page/sort URLs, return scroll, current-access validation | Implemented and automated regressions passed; final interactive order-return and scope-switch checks deferred by the user |
| 21. Visual profile selection | Approved authenticated cross-section preview with dimensions, weight and revision; enlargement; explicit unavailable states | Complete for local verification; two similar sections and unavailable artwork cases visually inspected |
| 24. Efficient keyboard entry | Visible Ctrl+Alt+A/D/S commands for add/duplicate/save draft, focused new lines, IME/repeat handling, one in-flight save, existing server revision guards | Complete for local verification; three-line keyboard flow saved one synthetic draft through the real application server action |
| 42. Role-specific table columns | Allowed role defaults, persistent show/hide/reorder/width controls, sticky identifiers, response null-mask omission migration | Implemented and automated regressions passed; final interactive persistence/role-layout checks deferred by the user |

Interactive browser control became disabled in Work settings during the final
checks. After an enable attempt still returned the disabled-setting error, the
user selected **Leave visual checks pending**. Features 4 and 42 must remain
unchecked in the catalogue until those final interactive checks are completed.
No hosted database migration, deployment, employee trial, or production-data
change is certified by this document.

## Implementation and security audit

The shell retains the existing destination catalogue and applies the established
role, route, and company-feature predicates before building both navigation and
shortcut allowlists. The More panel is portaled so sidebar overflow cannot clip
it. It closes after navigation, supports Escape/focus return, and keeps focus
stable while its contents scroll.

Preferences contain bounded link metadata, view controls, and column layouts.
Storage keys include both authenticated company ID and user ID. Reads validate
the stored shape, bounds, internal URL, and allowed column identity. Blocked or
corrupt Storage falls back safely. The shell rechecks current role/feature access
and record existence before displaying links; scope changes suppress an earlier
scope's loaded preferences. Preference mutations merge with the latest stored
state so removing a sidebar shortcut cannot be undone by stale list state.
These preferences do not grant access to records or change server projections.

Database pages keep ten-row server pagination through the existing
`get_operation_database_page` RPC. UI state serializes into the URL; browser
history restores it without treating notifications from the page's own URL
updates as new user navigation. Relation filters are preserved and Clear removes
them. Record opening captures a bounded recent-record identity and return scroll.
Desktop rows and phone cards support Enter/Space without swallowing nested
controls' keyboard events.

The quotation editor uses existing profile masters and calculation/save actions.
Artwork must have approved drawing status and a relative `documents` object path
starting with the authenticated company ID. External URLs, traversal, encoded
path delimiters, query/fragment suffixes, and control characters are rejected.
Only JPEG, PNG, and WebP blobs are rendered. A profile/revision/artwork identity
change remounts the preview, preventing new metadata from displaying an older
section image. Cancelled downloads do not create or leak stale blob URLs.
Missing, unapproved, failed, non-image, and image-render failures display an
explicit unavailable message instead of a substitute drawing. Existing master
fields containing arbitrary HTTP image URLs intentionally require an approved
company-owned Storage object before this preview can display them.

Keyboard commands are attached only to the active quotation editor. Duplication
clears row/company/quote identities while preserving entered draft values. New
lines receive focus. Save uses the existing server action and atomic revision
guards, with a synchronous shared in-flight guard against duplicate shortcut or
button calls. Routine selector Enter does not invoke a transaction confirmation.

The additive candidate migration
`20261021290100_operation_page_null_projection.sql` changes only the RPC's final
JSON aggregation to omit null-valued keys recursively. Existing authorized views
remain responsible for masking restricted values. The fixed manifest, derived
tenant, invoker security, grants, sort/filter checks, and pagination remain intact.
The migration fails closed if its prerequisite is missing, becomes a definer
function, or its aggregation changes unexpectedly. It is repeatable and contains
no business-table writes. It has **not been applied to hosted Supabase**.

## Verification and evidence

The focused final run passed 42 tests with no failures, skips, cancellations, or
TODOs, including the related six-test module-navigation suite. It includes actual
mounted component browser regressions for rapid list
changes and hide/show, More focus/scroll/Escape/navigation, PostgreSQL projection
execution, shortcut concurrency/retry, path/type approval rules, preference
isolation, persistent component company/user switching, named-view replacement,
and row keyboard behavior. The module-navigation regression now checks the shared
permission boundary instead of its obsolete inline-filter source assumption.

The complete development rerun passed 1,897 tests across 76 suites with zero
failures, skips, cancellations, or TODOs. The earlier run's sole failure was the
obsolete module-navigation source assertion, repaired before that rerun. The
final scope-change safeguard, named-view replacement, and unique migration
version were then checked by focused tests. The final isolated source checkpoint
is `f715b4d` (implementation `8fe442d` plus the migration-version correction).
The isolated main-checkout full suite passed **1,739 tests across 76 suites** with
zero failures, skips, cancellations, or TODOs. The different total reflects the
unrelated ongoing audit/PDF work present only in the development checkout.

| Command | Isolated main result |
| --- | --- |
| `npm run lint` | Passed, no warnings or errors |
| `npm run typecheck` | Passed |
| `npm run build` | Passed with synthetic public configuration and an empty service-role key |
| `npm test` | 1,739 passed; 76 suites; 0 failed/skipped/cancelled/TODO; 359.4 seconds |

Lint, typecheck, and build checked the application tree from `8fe442d`; those
application files are byte-identical at `f715b4d`, whose only changes are the SQL
filename and its test reference. The final full suite ran at `f715b4d`.
Both existing local branches were fast-forwarded to that implementation; no push
or deployment was performed. Later catalogue/evidence commits change documentation
only. Unrelated staged maintenance changes and other user-owned modifications
remain in the development checkout.

Interactive inspection used the real Next.js routes with the explicit synthetic
HTTP fixture in `scripts/serve-my-work-fixture.mjs`. Synthetic sessions, master
data, artwork, and an in-memory draft simulator were used; no hosted credentials
or business data were needed. The browser request evidence showed zero writes
after selector Enter navigation, then one `save_quote_atomic` request containing
three lines of five pieces each, recorded as a draft. This proves UI/server-action
wiring against the simulator, not hosted Auth, PostgreSQL RLS, Storage policy, or
atomic-save behavior on a live project.
The interactive run used the development checkout's existing loopback CSP
support. That concurrent configuration change is not included in this batch;
the production CSP is unchanged. Running this cross-origin HTTP fixture from a
checkout without that development support requires an appropriate local test
configuration before browser client requests can reach the fixture origin.

Saved screenshots under `docs/evidence/UPGRADE_EOS_2026-10-21/usability/` cover the
375px grouped More panel, production/dispatch/accounts phone navigation, both
similar enlarged sections, unapproved artwork, the saved synthetic draft, and
the accounts column panel before the final hide/show repair. Phone navigation
fit the measured viewport: document width 360px at a 375px browser width, with
four role-specific primary links and an accessible More control.

### Remaining manual acceptance

- Feature 4: set order search, stage, priority, date range, sort, page 2, and scroll; open a permitted order and return; verify every control, the same rows, and scroll are restored.
- Feature 4: pin and name the working view, open recent/saved links, remove a shortcut while the list is open, then change columns and confirm the removed shortcut stays removed.
- Feature 4: switch user and company, revoke a role/feature, and remove a source record; verify other scopes' or inaccessible records never appear in the workspace.
- Feature 42: inspect accounts and dispatch defaults on desktop/tablet/phone, hide then show a column, reorder and resize it, reload, and verify persistence and the sticky identifier while horizontally scrolling.
- Feature 42: after separately authorized deployment, verify RPC payload omission with real authenticated roles and current hosted view masks, then complete operator acceptance.
- Feature 21: complete an operator trial with real approved company Storage artwork and verify current Storage policies; local synthetic previews do not certify asset availability in the hosted company.

### Files and commands

Modified application files: the shared DataTable, app shell/NavLink, generic
database/detail clients, and quotation editor. Added application files: task
navigation and workspace-shortcut components; profile selector/preview and column
controls; shared navigation, preferences, profile-path, and keyboard-entry helpers.
The existing synthetic fixture server was expanded. Nine focused test files were
added and the existing module-navigation regression was updated. The single
candidate migration is listed above. No RLS policy was disabled or broadened and
no new package dependency was added for this batch.

Required commands: `npm run lint`, `npm run typecheck`, `npm run build`, and
`npm test`. Browser regressions run with the installed host browser runtime.
Production builds use synthetic public Supabase configuration and an empty
service-role key. Raw logs remain outside Git in this chat's visualization folder;
portable final logs and screenshots are retained alongside this report.

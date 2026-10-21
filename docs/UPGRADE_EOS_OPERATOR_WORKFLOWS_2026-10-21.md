# Smaller operator workflow upgrades

Date: 21 October 2026

## Delivery status

This batch implements catalogue features **15, 22, 32, 33 and 47** in the
existing notification, quotation, customer, inventory, die, production and task
workflows. This selection reuses existing master records and authorization.

The user explicitly directed that visual checks remain pending. These five new
catalogue entries remain **unchecked**. Automated mounted-browser tests and phone
width measurements are not interactive visual inspection. No new visual sign-off
or screenshot evidence is claimed by this batch.

Features 22, 32, 33 and 47 also require the new database migration before use in
a connected environment. It has been replayed in disposable local PGlite, not
applied to a hosted database. The interface explains when the database tools are
unavailable and disables its write forms. Feature 15 uses existing authorized
sources and does not depend on the new tables.

## Resulting workflows

| Feature | Implemented behavior | Scope |
| --- | --- | --- |
| 15: Actionable alerts | Notifications link to an exact UUID-backed record only after the source is readable in the current role and company. Recognized conditions are rechecked against current invoice balances/dates, stock, task status, order stage or quote status. Resolved styling, unverified sources, unavailable records and restricted access are distinct. | Ten messages per server page. Broadcast/personal read receipts are preserved independently; historical alert text is retained. This does not infer arbitrary alert rules from free-text titles. |
| 22: Customer profile codes | Customer pages maintain exact aliases for canonical active profiles. Quotation entry resolves only the selected customer's aliases, displays ambiguous choices and reloads the selected active company profile before updating the line. | Customer-specific aliases, not a general synonym engine. Canonical identity, current weight/specification and approved-artwork behavior remain authoritative. Deactivation retains mapping history. |
| 32: Physical location guidance | Inventory and die details expose current recorded location and a permitted move with a required reason. Existing die location is also retrieved during production entry. The move checks the expected prior location. | Existing inventory items and dies; text shed/rack/level guidance. No warehouse map, physical verification or stock movement is inferred. Future ordinary master-location edits are also captured; clearing a location remains an explicit unknown. |
| 33: Structured exceptions | Production-job exceptions use controlled reasons, optional notes and a required explanation for other exceptions. Job, order, machine, recorded job operator, reporter and recorded time are captured from the authenticated source context. | Observations against production jobs, with no mandatory invented measurement, automatic job hold, stock write, photo upload or approval claim. |
| 47: Customer promises | Customer records capture a promised action and date, with the current employee accountable. The personal queue supports company scope, search, status, sort and ten-row pagination. Exact-promise links retain identity even beyond the first customer page. Rescheduling and closure retain reasons/outcomes. | In-app follow-up. No external reminder delivery is claimed. Initial responsibility remains with the employee recording the promise; revision history identifies the actual later actor. |

## Database and security audit

The additive migration is
[`20261022000000_operator_workflow_helpers.sql`](../supabase/migrations/20261022000000_operator_workflow_helpers.sql).
It adds five company-scoped tables: `customer_profile_aliases`,
`operator_location_history`, `production_exceptions`, `customer_commitments`,
and `customer_commitment_events`. Company-led indexes cover their parent,
assignee and history queries. No existing business rows are backfilled or
rewritten by installing this migration.

All five tables enable RLS. Authenticated users receive permitted SELECT only;
ordinary INSERT/UPDATE/DELETE are revoked. History and observations are changed
only through the pinned, authenticated RPC, with no anonymous execution grant.
Read policies and RPC authorization exclude dealer identities, including an
incorrectly dealer-linked internal role. The TypeScript and SQL role rules are
tested for agreement across all existing role names and both location families.

The server validates strict command-specific input before making a query. Company,
actor, role and source context are derived from authentication/database records;
client-supplied company, reporter, timestamp and source-context injections are
rejected. The HTTP route requires JSON and rejects foreign Origin headers.
Unexpected trigger errors are sanitized rather than exposed as database details.
Read and confirmation responses have command-specific shapes, bounded rows,
unique identities, required counts and an explicit field allowlist.

Request identities serialize duplicate mutation requests inside a database
transaction and bind replays to the original actor, record and input. An ambiguous
confirmation preserves the request and locks the form until a same-request retry
can confirm its result. Successful creation retries clear the entry fields. Stale
location and date preconditions require refresh instead of overwriting a newer
decision. Confirmed writes remain confirmed if cache invalidation fails.

Location triggers capture subsequent changes made through either the new move
flow or ordinary record editing. The previous location is retained and unknown
new locations remain null rather than invented. Location changes cannot transfer
a record between companies. The RPC changes only the master location, with no
inventory quantity or financial posting. Read commands work inside a read-only
transaction and do not acquire source-row locks.

Commitments retain an immutable original due date, initial employee identity and
append-only change events. Rescheduling checks the expected current due date;
completion/cancellation requires an outcome. Existing promises remain visible and
can be closed after a customer becomes inactive or is soft-deleted; creation
requires an active, nondeleted customer. Alias searches also require active
customer/profile sources. Exception records keep the operator already recorded
on the job distinct from the authenticated reporter.

Notification destinations come from a fixed type/resource/path map. Invalid IDs,
unknown entities, object-prototype keys and arbitrary URLs receive no destination.
Source queries are company-scoped, bounded and minimally projected, with resource
authorization checked before a query. Financial records use the authorized invoice
view. A failed source check removes an earlier resolved claim on refresh, while
personal read state and recorded message text remain separate.

No service-role key enters the browser. No dependency, storage policy, hosted
write, deployment, external message or new branch/worktree is part of this batch.

## Verification

Source checkpoint: `e99f4b6737e3f6b24626e61a8f442fe839669084` on `codex/v1`,
fast-forwarded to `main` before independent verification. Both checkouts retain
unrelated pre-existing changes; the independent checks use the committed source
in `main`. The delivery-document commit does not change this source checkpoint.

Development preflight passed **43 new tests**, plus **37 existing** quotation,
foundry, preview, freshness and database-state regressions. New tests cover actual
mounted components, the actual HTTP/server-action path, full migration replay,
authenticated SQL roles/RLS, permissions, request recovery, pagination and
read-only execution. Lint, typecheck and the production build passed in
development. Independent final verification in `main` also passed all checks
below. Source, tests, migration, configuration and dependencies were unchanged
from the recorded checkpoint throughout this final run.

The browser fixture uses actual application components, global/Tailwind styles,
server actions, the HTTP route and the new SQL in a disposable PGlite database.
Authentication is a synthetic adapter; quotation lookup data and existing
notification source reads are synthetic boundaries. It does not prove hosted
JWT/RLS behavior, a factory observation, a deployed migration or visual acceptance.

| Check | Final independent result |
| --- | --- |
| `npm test` | **1,878 passed**, 76 suites; zero failed, skipped, cancelled or todo. 498.28 seconds. [Log](evidence/UPGRADE_EOS_2026-10-21/operator-workflows/main-test.log). |
| `npm run lint` | **Passed**, exit 0. [Log](evidence/UPGRADE_EOS_2026-10-21/operator-workflows/main-lint.log). |
| `npm run typecheck` | **Passed**, exit 0. [Log](evidence/UPGRADE_EOS_2026-10-21/operator-workflows/main-typecheck.log). |
| `npm run build` | **Passed**, exit 0; optimized Next.js build, type checking, route generation. [Log](evidence/UPGRADE_EOS_2026-10-21/operator-workflows/main-build.log). |
| Focused new and affected regressions | **80 passed**: 43 new and 37 existing affected tests; zero failed, skipped, cancelled or todo. 105.99 seconds. [Log](evidence/UPGRADE_EOS_2026-10-21/operator-workflows/focused.log). |

The independent build uses a synthetic Supabase URL and public key so build-time
configuration does not authenticate to a business database. Test fixtures bind
only to loopback and use disposable database state. Required checks are evidence
for this source checkpoint, not deployment or live business-data acceptance.

The 43 new cases comprise 18 migration/SQL/RLS tests, 12 mounted-browser
interactions, six real server-action/HTTP tests and seven alert tests. The
37 existing regressions cover quotation entry/paste, entry source selection,
billet estimates, action previews, source freshness and saved database state.
The codebase-memory skill guided discovery of existing route and authorization
patterns; the new tools extend those workflows instead of adding a separate
backend. A final catalogue audit preserved all 100 headings and all 10 existing
completion marks; these five new entries remain unchecked.

## Remaining acceptance

- Apply only this reviewed migration to the intended environment after scoped
  authorization, then verify its grants, policies, objects and linked workflows.
- Inspect all five flows interactively at desktop and phone widths before marking
  their catalogue boxes complete. The automated width check found and corrected
  intrinsic card/fieldset overflow, but it is not a visual approval.
- Use actual company profile codes, customer data, rack locations and operator
  roles for signed-in acceptance. Validate physical locations with the factory.
- Verify independent-session concurrent requests against the deployed PostgreSQL
  instance. Local request-replay and stale-update tests do not substitute for that
  proof layer.

For later visual acceptance, run
`node --experimental-strip-types scripts/visual-operator-workflows.mjs` from the
chosen checkout. The helper prints loopback links for the actual screens, creates
only disposable local records and exits on stdin input. It uses synthetic auth;
it never authenticates to a hosted business database.

## File inventory

Created application files:

- `app/(dashboard)/tasks/commitments/page.tsx`
- `app/api/operator-workflows/route.ts`
- `components/modules/operations/operator-tools.tsx`
- `lib/actions/operator-workflows.ts`
- `lib/operations/operator-workflows.ts`
- `lib/operations/operator-workflow-client.ts`
- `lib/operations/notification-actions.ts`
- `supabase/migrations/20261022000000_operator_workflow_helpers.sql`

Created verification files:

- `scripts/lib/operator-action-fixture.mjs`
- `scripts/lib/operator-browser-fixture.mjs`
- `scripts/lib/operator-workflow-fixture.mjs`
- `scripts/visual-operator-workflows.mjs`
- `tests/operator-workflows-action.test.mjs`
- `tests/operator-workflows-browser.test.mjs`
- `tests/operator-workflows-sql.test.mjs`
- `tests/notification-actions.test.mjs`

Modified application files:

- `app/(dashboard)/customers/[id]/page.tsx`
- `app/(dashboard)/dies/[id]/page.tsx`
- `app/(dashboard)/production/[id]/page.tsx`
- `app/(dashboard)/notifications/page.tsx`
- `app/(dashboard)/tasks/page.tsx`
- `components/modules/quotes-client.tsx`
- `components/modules/notifications-client.tsx`
- `components/modules/operations/record-detail-client.tsx`
- `components/modules/operations/record-form-client.tsx`

The modified catalogue, this new delivery report and the five captured logs above
retain the exact verification evidence and open acceptance gates. Unrelated
pre-existing PDF, report, audit and migration changes remain outside these commits.

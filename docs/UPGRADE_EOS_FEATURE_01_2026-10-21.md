# Upgrade feature 1: My Work Today

Date: 21 October 2026
Status: Complete for local implementation and verification
Implementation checkpoint: `7ea391c`

## Delivered behavior

The internal `/dashboard` homepage starts with My Work Today. It shows up to ten
open personal assignments, followed by a separate expandable section for eligible
unassigned factory tasks. Department queues show production jobs, pending or
delayed dispatches, issued unpaid invoices, sales follow-ups, quality exceptions,
or stock at zero or below, according to the employee's role and enabled modules.
The previous role-specific dashboard remains under Business snapshot.

Personal ownership comes from `tasks.assigned_to`. Production's free-text
`operator_name` is not used as a user identity. Shared jobs and collection work
remain clearly labeled as team work. Internal employees retain their own assigned
dealership tasks; unassigned dealership tasks are excluded from the factory queue.
Automatic task creation and department handoffs remain feature 14's separate scope.

Dates use the existing India business-day helper. Missing or invalid dates remain
Date not captured. Due dates and planned/inspection/dispatch dates have distinct
labels. A sentinel eleventh row detects additional work without presenting a
sample as a total. Query failures show Unavailable rather than an empty workload.

An assigned task can open its permitted linked source directly. The source is
rechecked in the current company; missing or unreadable sources return the user
to the task for review. Recorded holds and exceptions are shown without claiming
that the homepage establishes full production or dispatch readiness. Actual
transitions continue through the existing protected workflows.

## Files and security audit

Created:

- `lib/dashboard/my-work.ts`: shared server read model, source permissions, dates,
  bounded queries, blockers, and safe link fallback.
- `components/modules/my-work-today.tsx`: responsive work queues and accessible
  native disclosures with existing application typography and visual styling.
- `tests/my-work-today.test.mjs`: fourteen behavior and query-boundary tests.
- `scripts/serve-my-work-fixture.mjs`: isolated synthetic HTTP fixture on
  `127.0.0.1:3581`, with the real Next.js app on `127.0.0.1:3580`.

Modified: `app/(dashboard)/dashboard/page.tsx`. Catalogue completion is recorded
in `UPGRADE_EOS.md` after final checks. This report and its linked evidence are
also new files.

No database migration, RLS policy, storage rule, business transaction, dependency,
or service-role integration was added. Session context supplies company and user
identity. Every new business query includes the authenticated company. Personal
queries filter the exact assignee. Unassigned queries require no assignee, no
dealership, and an eligible source type. Read permission, route access, and module
flags control source queries and links. Dealer identities cannot use this internal
read model; the existing dealer dashboard redirect is preserved.

Source lookups project only identifiers and status. Department queries do not
fetch commercial amounts, costs, margins, or internal notes. New code uses the
normal authenticated Supabase client and introduces no mutation endpoint or
alternate workflow confirmation path. Each request builds its own read model;
there is no cross-user application cache.

## Verification

Final main-checkout results at `7ea391c`:

| Command | Result |
| --- | --- |
| `npm test` | 1,703 passed across 76 suites; zero failures, skips, cancellations or TODOs. |
| `npm run lint` | Passed. |
| `npm run typecheck` | Passed. |
| `npm run build` | Passed with synthetic public Supabase settings. |
| `git diff --check` for the five implementation files | Passed. |

The implementation files remained unchanged throughout the final main checks.
The full test and production-build commands ran outside the filesystem/network
sandbox to use the installed Playwright browser and fetch the existing Google
font. The earlier sandbox attempts failed at those environment boundaries.
No dependency was installed. These checks do not establish hosted database acceptance.

Evidence: [full test log](evidence/UPGRADE_EOS_2026-10-21/feature-01/my-work-final-main-tests.log),
[lint log](evidence/UPGRADE_EOS_2026-10-21/feature-01/my-work-final-main-lint.log),
[typecheck log](evidence/UPGRADE_EOS_2026-10-21/feature-01/my-work-final-main-typecheck.log),
[production build log](evidence/UPGRADE_EOS_2026-10-21/feature-01/my-work-final-main-build.log),
and [implementation blob identities](evidence/UPGRADE_EOS_2026-10-21/feature-01/implementation-checkpoint.txt).
Published logs have trailing whitespace trimmed; the original command captures
remain in this task's local verification folder.

The final focused run passed all 21 tests: fourteen new feature tests and seven
existing role/access usability tests. The new tests cover all fifteen roles,
company filters, assignee separation, permitted dealership assignments, disabled
modules, safe source identifiers, deleted/invisible sources, query failures,
bounded reads, closed/inactive records, invoice eligibility, India midnight,
impossible dates, and per-request user isolation.

The final development checkout passed lint, typecheck, and production build for
this implementation. Its broader suite also encountered four failures in
`dispatch-packing-availability.test.mjs` while concurrent, unrelated edits added
a packaging-weight cap to `lib/actions/dispatches.ts`. Those source edits were
preserved and were not included in the homepage commit. The unchanged dispatch
test file passed all 40 checks in the main checkout before the feature promotion.
Main is verified separately below so these evidence layers are not conflated.

## Visual and browser acceptance

The real Next.js routes were inspected using synthetic company data and synthetic
sessions against a local HTTP fixture. This is application/browser evidence,
not a live Supabase authentication, SQL/RLS, factory, or deployment test. The
fixture does not emulate PostgreSQL RLS and refuses business mutations.

Completed manual checks:

- Desktop 1280 x 900, tablet 768 x 1024, and phone 375 x 812 were visually
  inspected. Final document widths were 1265, 753, and 360 CSS pixels respectively,
  including the browser's vertical-scrollbar allowance. No horizontal page overflow.
- Personal assignments and shared production work remain distinct. Due/overdue
  labels, recorded holds, and First 10 labeling are visible.
- Opening the first assigned production job reaches its exact `/production/[id]`
  workflow with an enabled Start Run control. No production transaction was posted.
- The unassigned section opens by click and closes by keyboard Enter.
- Accounts, dispatch, sales, quality, inventory, and viewer sessions receive their
  expected queues. Other-user, other-company, and completed fixture tasks are absent.
- Empty queues show an explicit empty state. Failed production reads remain
  unavailable, while assigned tasks still load and unsafe source links fall back.
- Disabled production planning suppresses its department queue and job links.
- A failed business snapshot leaves My Work Today usable and shows its separate
  error notice when expanded.
- An anonymous fixture session is denied the internal homepage through the
  existing account-unavailable path. Dealer staff are redirected to `/portal/dashboard`.

Screenshots: [desktop](evidence/UPGRADE_EOS_2026-10-21/feature-01/my-work-final-1280.jpg),
[tablet](evidence/UPGRADE_EOS_2026-10-21/feature-01/my-work-final-768.jpg),
[phone](evidence/UPGRADE_EOS_2026-10-21/feature-01/my-work-final-375.jpg),
[expanded unassigned work on phone](evidence/UPGRADE_EOS_2026-10-21/feature-01/my-work-mobile-team.jpg),
and [linked production workflow](evidence/UPGRADE_EOS_2026-10-21/feature-01/my-work-job-workflow.jpg).
The [browser check record](evidence/UPGRADE_EOS_2026-10-21/feature-01/my-work-browser-checks.json)
contains the role, failure-state, redirect and final viewport observations.

## Remaining boundaries

Hosted schema/RLS checks, real employee acceptance, factory measurements, and
deployment were not performed. No existing operational or financial transaction
guard was replaced. Opening a shared item does not assign or complete it.
Existing task workflows remain responsible for assignment and task completion.
No productivity saving is claimed without an observed employee trial.

Concurrent PDF, audit, SQL and other business changes in the development checkout
remain user-owned and outside this feature's local commit.

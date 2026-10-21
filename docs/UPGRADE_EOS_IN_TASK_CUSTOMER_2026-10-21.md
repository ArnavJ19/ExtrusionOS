# In-task customer creation for quotation drafts

Date: 21 October 2026

## Delivery status

Catalogue feature 10's customer/quotation acceptance example is implemented and
has passed interactive visual inspection at desktop, tablet, and phone widths.
Transporter and other master selectors remain future extensions. This is local
implementation acceptance; authenticated hosted acceptance and deployment are
separate steps.

Browser access became available during verification. Inspection used the real
quotation editor and customer dialog with the built application styles and
synthetic customer responses, served only on loopback. It did not create real
customer records or require a hosted account.

Initial source: `c32ce618a653ff39e888fb24e8ce6d546f490bba`. Final application and
visual-fixture checkpoint: `cfec93df984560c8f93ae8373e6087a8d177981c`, committed
in `codex/v1` and fast-forwarded into the existing `main` checkout. Unrelated
development edits, including the staged maintenance-page rename, are preserved.

## Resulting behaviour

The customer selector in quotation entry now has an Add new customer action.
The dialog asks for a name and customer type, with optional company, phone, GST,
email, and expandable address/location fields. It reuses the existing customer
validation rules and imposes bounded field lengths.

Creating a customer selects the returned record in the existing draft. Selecting
an existing active match does the same. Neither operation saves the quotation,
reloads its form, or changes its lines, quantities, cut lengths, price overrides,
terms, or notes. Cancelling leaves the quotation unchanged.

Duplicate review checks GST, customer name, company name, and normalized Indian
phone digits, including legacy formatted phone values. Each query is scoped to
the authenticated company, excludes deleted rows, and reads at most 11 records.
The dialog shows at most 10 combined suggestions and discloses additional
matches. Suggestions include only identity fields and matching reasons, without
email, addresses, company IDs, author IDs, or unrestricted database rows.
Inactive suggestions cannot be selected. A separate customer can be created
after explicitly acknowledging the possible matches. Creation repeats the
checks on the server even when the operator skips the optional preview.

A pending action is guarded against repeated clicks, and quotation keyboard
shortcuts cannot propagate from the dialog. Escape/Close restore trigger focus;
body scrolling is restored when the dialog closes or unmounts. Changing the
company, user, role, editor mode, or edited quotation remounts the quotation
workspace so a delayed customer response cannot populate a different task.

## Authorization and failure handling

- The server action derives company and author from the authenticated session,
  checks both customer-create and customer-read permission, and validates a
  strict request schema. Client-supplied company/author fields are rejected.
- The standard user-session Supabase client performs all reads and inserts.
  Existing customer RLS remains enabled and unchanged. Existing quotation
  editing restrictions remain in place; this delivery grants no new role access.
- Selecting a suggestion rechecks the current company, deletion state, and
  active flag. A failed duplicate query prevents creation; it is never treated
  as an empty customer list. Database details are not returned in errors.
- One generated UUID identifies a creation attempt. Retrying requires the same
  author and normalized customer details. The database primary key prevents a
  second insertion with that identity. A committed customer can be recovered
  after its confirmation is lost without creating another record.
- An uncertain result holds details unchanged and offers Check saved result.
  Closing and reopening retains the attempt while this quotation page remains
  mounted. A definite policy/validation rejection leaves fields editable.
- There is no new migration, policy, dependency, service-role browser import,
  credential change, hosted write, push, or deployment in this delivery.

Duplicate suggestions are advisory. Separate request IDs can create similar
records concurrently; this feature does not introduce a unique GST/phone rule,
merge existing masters, or implement catalogue feature 59. Retry state is held
in memory and does not survive a page reload or navigation away. After losing
that state, review Customers before attempting another creation.

Read-only source review identified excessive fields in duplicate suggestions
and quotation state surviving authentication/task scope changes. The delivery
narrows the match projection and keys the complete quotation workspace by its
company, user, role, mode, and edited record. The focused tests cover both fixes;
the follow-up review found no further material source findings in this scope.

## Verification

All required checks passed against the final source checkpoint above in the
independent `main` checkout. The application and regression files were unchanged
throughout that final run. Full regression: **1,789 tests across 76 suites**,
zero failures, skips, cancellations, or TODOs, in 261.9 seconds. The focused
suite passed **23/23** in 9.5 seconds against the same application source.

| Check | Result and evidence |
| --- | --- |
| `npm test` | Passed, 1,789 tests and 76 suites. [Full output](evidence/UPGRADE_EOS_2026-10-21/in-task-customer/main-final-test.log). |
| `npm run lint` | Passed. [Output](evidence/UPGRADE_EOS_2026-10-21/in-task-customer/main-final-lint.log). |
| `npm run typecheck` | Passed. [Output](evidence/UPGRADE_EOS_2026-10-21/in-task-customer/main-final-typecheck.log). |
| `npm run build` | Passed with synthetic public Supabase settings and no service-role key. [Output](evidence/UPGRADE_EOS_2026-10-21/in-task-customer/main-final-build.log). |
| Focused customer/quotation regression | Passed, 23 tests. [Output](evidence/UPGRADE_EOS_2026-10-21/in-task-customer/focused-final.log). |

The initial development run passed 1,947 tests, and the first independent `main`
run passed 1,788. The final independent run above includes the additional
name-only label regression found during visual inspection. Development totals
include unrelated pending work and are not used to claim isolated acceptance.

The focused regressions cover 11 server/database cases, 9 mounted dialog/editor
cases, and the 3 existing quotation paste cases. They exercise validation,
role denial, company isolation, minimal projections, bounded duplicate review,
inactive/deleted matches, same-ID concurrent calls, ambiguous commits, matching
author/payload on retry, form preservation, focus, Escape, keyboard isolation,
selection, repeated clicks, reopening a retry, scope changes, and unmount.

Visual inspection caught the existing customer label repeating the name when
no company name was supplied. The final checkpoint removes that repetition and
adds a mounted regression. The initial visual fixture also lacked the client's
fluent `ilike` search method; its adapter was corrected, the helper restarted,
and the affected interactions repeated with a clean browser console. Neither
correction changed customer permissions or database policies.

The server fixture uses a disposable PGlite database and the actual customer
policy definitions from
`supabase/migrations/20261008010000_access_projection_integrity.sql`. Authentication
identity helpers and the Supabase transport are fixture adapters. Statements
execute under an authenticated database role with RLS enabled; fixture SQL is
serialized while concurrent action calls interleave. This proves local action
and policy behaviour under those supplied identities, not hosted JWT plumbing,
the entire migration chain, or independent multi-connection production races.

Mounted browser tests use the real quotation editor, customer dialog, shared
validation, and selection components, with synthetic server responses. They do
not insert real customer records or prove an authenticated hosted workflow.

## Visual inspection

The source checkpoint above was inspected interactively through the in-app
browser at 1280 x 900, 768 x 1024, and 375 x 812. Desktop shows the compact
two-column dialog; phone fields stack, duplicate cards wrap, and expanded
addresses scroll within the dialog. At 375 px, the document width remained
375 px, the dialog was approximately 343 px wide, and its scroll content was
327 px wide, with no horizontal document overflow.

The inspection selected an active existing customer, created a name-only
customer, and recovered a second customer's lost confirmation. The draft still
contained 17 pieces, 4.25 m cut length, an INR 8,123 price override, its entered
commercial terms, and its notes. The fixture showed two customer creations and
zero quotation saves before and after retry, and closing/cancelling restored
the Add new customer trigger and body scrolling. The final corrected fixture
reported no browser errors.

Evidence:

- [Desktop dialog](evidence/UPGRADE_EOS_2026-10-21/in-task-customer/desktop.jpg).
- [Desktop duplicate review](evidence/UPGRADE_EOS_2026-10-21/in-task-customer/duplicates-desktop.jpg).
- [Phone duplicate review](evidence/UPGRADE_EOS_2026-10-21/in-task-customer/duplicate-review-phone.jpg).
- [Phone customer selection](evidence/UPGRADE_EOS_2026-10-21/in-task-customer/selected-phone.jpg).
- [Phone expanded address fields](evidence/UPGRADE_EOS_2026-10-21/in-task-customer/address-phone.jpg).
- [Tablet retry state](evidence/UPGRADE_EOS_2026-10-21/in-task-customer/retry-tablet.jpg).
- [DOM observations and final draft values](evidence/UPGRADE_EOS_2026-10-21/in-task-customer/visual-proof.json).

Reproduce the visual fixture after building the intended checkout with
`node scripts/visual-in-task-customer.mjs`. Open its printed loopback URL. The
fixture uses synthetic customers named Mira to demonstrate duplicates and a
customer name containing Retry to demonstrate ambiguous confirmation. All
master and quotation writes in this fixture remain in browser memory. Stop the
helper after use; it is not an application route or production server.

## Files

New application files:

- `components/modules/customers/in-task-customer.tsx`.
- `lib/actions/in-task-customers.ts`.
- `lib/forms/in-task-customer.ts`.

Modified application file: `components/modules/quotes-client.tsx`.

New regression files: `scripts/lib/in-task-customer-action-fixture.mjs`,
`tests/in-task-customer-action.test.mjs`, and
`tests/in-task-customer-browser.test.mjs`. The existing
`tests/quote-paste-browser.test.mjs` mocks the added server-action boundary.
`scripts/visual-in-task-customer.mjs` provides the isolated visual fixture.

Documentation: this delivery record, feature 10's status in `UPGRADE_EOS.md`, and
verification logs under
`docs/evidence/UPGRADE_EOS_2026-10-21/in-task-customer/`.

## Remaining acceptance

1. Exercise authenticated allowed/denied roles and cross-company attempts in a
   dedicated acceptance environment. Confirm the deployed schema/policies,
   subsequent quotation save, and customer database refresh together.
2. Repeat duplicate review and retry recovery against that environment's real
   transport, current migration chain, and independent concurrent connections.
   Confirm a recovered customer appears once in the real database.
3. Review the short customer fields with employees and extend the pattern to
   transporter or other master selectors when their workflows are selected.

The catalogue retains all 100 feature headings in their original order. Local
visual acceptance is recorded above. Hosted and deployment acceptance are not
claimed by these checks.

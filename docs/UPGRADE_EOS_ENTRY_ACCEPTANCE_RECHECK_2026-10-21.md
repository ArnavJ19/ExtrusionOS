# Entry and preview acceptance recheck

Date: 21 October 2026

## Status and scope

Catalogue features 23, 41, 50, 83, and 90 were already implemented but awaiting
interactive visual acceptance. This follow-up adds real-form/table integration
coverage, fixes long preview identifiers and source-reference wrapping, and
rechecks the implementations against the current source.

The in-app browser returned `Local browser use is disabled in Work settings`
when the new fixture was opened. The user explicitly chose **Keep visual checks
pending**. None of these five completion boxes is checked by this follow-up.
Automated browser execution is recorded separately and is not visual inspection.
The preceding completed batch (3, 9, 20, 26, 49) retains its existing evidence.

The original implementation and historical checks are recorded in
[the entry and preview delivery record](UPGRADE_EOS_ENTRY_AND_PREVIEWS_2026-10-21.md).

## Changes and audit

Record previews now wrap the complete identifier and subtitle instead of
truncating them, so long business references can be read. Freshness disclosures
also wrap long source strings. The allowlisted values, authorization and scope
checks, unchanged queue URL, focus restoration, and modal lifecycle remain in
place. Neither presentation change adds a query or transaction.

The new shared fixture renders the actual quotation editor, actual paginated
inventory database with its real table and preview, and actual foundry entry
form. It mocks the Supabase and server-action transport boundaries with synthetic
responses. Its visual helper can serve the same components with built styles on
loopback when browser access is available. Its failure toggle affects only those
synthetic page responses and is not a product control.

The source audit rechecked the existing rules: profile lookups remain exact,
active, bounded and company-scoped; paste import does not save a quotation or
copy prior die charges and price overrides; preview fields remain allowlisted;
freshness separates a successful fetch from source observations; theoretical
quantities and density assumptions do not become measured transactions.

Application/fixture checkpoint: `4c402b1c39e08d174ad1c8d718cd8455f4d5749c`, developed
in the existing `codex/v1` checkout and fast-forwarded to `main`. Pending PDF,
report, migration, and other development edits were preserved outside the commit.
No branch or worktree was created. Earlier required checks passed in development;
its full test run passed 1,991 tests across 76 suites. The development tree has
unrelated pending work, so the independent main run below is the final evidence
for this follow-up.

A concurrent billing change was fast-forwarded to `main` while the initial
independent checks were finishing. That first run passed 1,828 tests, but its
results are not presented as proof of the combined checkpoint. The required
checks and focused regressions were repeated at combined checkpoint
`29dbaa68b297c7e1dea4ee1b12bfe5d12716da03`. The billing implementation and its
migration belong to the concurrent audit task, not this follow-up.

The development branch subsequently received SQL/harness-only work in
`8c0c9b297f5e42404c41eac7606d5ffc6e0d9b83`. It changes no application or test
source for these features. It is preserved in the shared history, and is neither
applied nor accepted as database remediation by this follow-up.

The independent run at `29dbaa6` passed 1,833 tests. After that run, concurrent
billing follow-up `3aa216eb462f79aa458dfecf51ea55e45a347718` changed the shared
quotation calculation again. All required checks were repeated against that
combined checkpoint, which is the final application/test source for the table
below. Its focused run passed 44 tests: the same 37 entry/preview cases plus
seven quotation billing-basis cases. The concurrent billing implementation and
its migrations are not attributed to this upgrade batch.

There is no new migration, RLS/Storage policy, dependency, role permission,
service-role browser import, hosted write, deployment, or push in this follow-up.
The fixture is an integration adapter, not proof of hosted JWT or RLS execution.

## Automated acceptance

Six new mounted integration cases cover:

- A mixed-validity spreadsheet paste leaves the existing line untouched, blocks
  import until the unknown profile is corrected, converts 6000 mm to 6 m, and
  appends both lines with cleared inherited overrides and zero writes.
- Selecting the actual profile shows 100 x 6 m x 0.8 kg/m as 480 kg theoretical;
  changing length to 3 m shows 240 kg; manual and missing weights are explicit.
- Opening the actual page-two inventory preview preserves the queue query,
  performs no new page query, omits private fixture fields, retains return
  parameters, and restores trigger focus after Escape.
- Refreshing the actual database leaves the January 2024 physical observation
  and import source unchanged. Failed refresh does not advance the last
  successful-fetch timestamp, and restoring responses allows recovery.
- The actual foundry form displays the same estimate after switching dimension
  display to inches, keeps its millimetre configuration unchanged, and removes
  weight results when density is blank. No weighing or batch save occurs.
- At a 375 px viewport, the phone card's expanded source evidence stays within
  the document width and the full preview heading fits without clipping. This
  automated check compiles the actual global/Tailwind styles from source and
  includes a long unbroken source reference. It is not human visual acceptance.

The focused run passed **44/44** tests: the six new integration cases, 31 existing
parser, calculation, preview, freshness, and mounted-state cases, and seven
shared quotation billing-basis cases.
The final independent main run passed **1,835 tests across 76 suites**, with
zero failures, skips, cancellations, or TODOs, in 457.7 seconds. The application
and test sources remained unchanged at the combined checkpoint during these
checks. An interrupted earlier attempt is not counted as a passing run.

| Check | Final independent result |
| --- | --- |
| `npm test` | Passed, 1,835 tests / 76 suites in 457.7 seconds. [Output](evidence/UPGRADE_EOS_2026-10-21/entry-recheck/main-test.log). |
| `npm run lint` | Passed. [Output](evidence/UPGRADE_EOS_2026-10-21/entry-recheck/main-lint.log). |
| `npm run typecheck` | Passed. [Output](evidence/UPGRADE_EOS_2026-10-21/entry-recheck/main-typecheck.log). |
| `npm run build` | Passed, using synthetic public Supabase settings and an empty service-role key. [Output](evidence/UPGRADE_EOS_2026-10-21/entry-recheck/main-build.log). |
| Focused regression | Passed, 44 tests in 41.6 seconds. [Output](evidence/UPGRADE_EOS_2026-10-21/entry-recheck/focused.log). |

## Remaining visual acceptance

The five original gates remain open: mixed-validity paste and local preview
scrolling; profile-master/manual/missing quantity states; preview readability,
focus and queue position; old/missing observation metadata and failed refresh;
foundry formula, units and invalid inputs. Each relevant screen still needs
interactive desktop and phone inspection before completion can be marked.

The helper is `node scripts/visual-entry-acceptance.mjs`, run from the intended
built checkout. It starts a random loopback port and prints its address; any
stdin input closes it. A local build must exist first. The synthetic fixture
does not replace authenticated operator acceptance or validate company master
data, alloy density suitability, actual stock, or physical factory operation.

Created files: `scripts/lib/entry-acceptance-browser-fixture.mjs`,
`scripts/visual-entry-acceptance.mjs`, and
`tests/entry-acceptance-integration.test.mjs`. Modified application files:
`components/modules/operations/record-preview.tsx` and
`components/ui/data-freshness.tsx`. This report, its evidence folder, and the
five catalogue follow-up notes document the status without marking completion.

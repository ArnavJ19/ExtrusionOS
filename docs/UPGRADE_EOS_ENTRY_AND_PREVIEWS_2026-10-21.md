# Quotation entry, record previews, and calculation transparency

Date: 21 October 2026

## Delivery status

This batch implements catalogue features **23, 41, 50, 83, and 90** in the
existing quotation, operations database, and foundry forms. These are five new
features beyond the preceding usability batch. Their catalogue completion boxes
remain open until the required interactive visual inspection is possible.

Local browser inventory continues to return `Local browser use is disabled in
Work settings`, including after the user's Enable browser access reply. That
reply authorises use but has not made the application setting available to the
browser tool. Automated browser regressions below are separate from a visual
inspection; they do not close that gate.

## Resulting behaviour

| Feature | Implemented behaviour | Remaining acceptance |
| --- | --- | --- |
| 23 | Paste up to 100 spreadsheet rows with explicit length units, editable previews, exact active company profile lookup, and row errors. Import appends every accepted row together to the draft. | Inspect mixed-validity paste, corrections, unit labels, and narrow-screen preview scrolling in the real editor. |
| 41 | Open a read-only side panel from a database row while retaining the queue URL, filters, page, and sort. Escape and close return focus to the trigger; the full-record link retains return context. | Inspect the actual panel, desktop/mobile layout, long identifiers, and queue position after closing. |
| 50 | Show the current view's successful fetch time separately from underlying row dates and available observation/source metadata. Refresh repeats the existing bounded query. | Inspect the source disclosure in real database tables, including old/missing records and failed refresh. |
| 83 | Show total metres and theoretical kg with profile-master/manual source labels and explicit invalid/missing-input states. Reuse the existing quotation calculation. | Inspect changes to length and kg/m, including manual overrides and missing specifications. |
| 90 | Explain foundry billet geometry, current configured density, units, per-billet and planned batch mass, and rounding. Unit display changes preserve the estimate; invalid inputs have no fabricated zero. | Inspect the foundry form's unit selector, formula disclosure, invalid inputs, and distinction from measured material. |

The quotation editor continues to use the existing server action to save a
draft. Paste, quantity explanations, source disclosures, previews, and billet
unit display perform no stock, workflow, financial, or document writes.

## Audit and security

- Spreadsheet profile queries include authenticated company context, active
  status, exact profile codes, and a 100-row limit. Existing RLS remains the
  authority. Request versions invalidate older results after paste/code/session
  changes or unmount. Lookup failures leave import disabled.
- Imported lines start with clean line defaults and company settings. They do
  not inherit a previous line's identity, die charge, minimum billing weight,
  or selling-price override. Pasted text is rendered as text, not HTML.
- Malformed/unterminated CSV quoting, embedded multiline cells, duplicate,
  unknown, or blank headers, unspecified length units, extra cells, unknown/ambiguous
  profiles, non-whole pieces, invalid lengths, and unsupported finishes require
  correction. Extra cells can only be discarded by an explicit row action.
- The preview performs zero additional queries. It uses a per-module scalar
  allowlist over a row already returned by the authorised database-page RPC.
  Raw records, free-text notes, costs, margins, and financial totals are not
  printed. The component checks module read permission and company/user/role
  row scope. This is an additional UI boundary; response security still belongs
  to the existing RPC and RLS.
- List data, previews, and freshness are bound to the current query and auth
  scope. A different module/filter/page cannot display a previous query's row
  as its own. Closing or changing context clears the preview. Focus, inert
  background state, and body scroll locking are restored on close/unmount.
- Fetch success does not imply physical verification. Missing source and
  observation metadata remain explicitly unavailable. The displayed 30-day
  threshold is a record-age aid, not a company-approved stock validity policy.
- Piece and billet estimates remain separate from actual measurements. A
  manually overridden section weight is identified as manual. Density comes
  from the current batch configuration and is labelled an assumption requiring
  suitability review, never an invented approved material certificate.
- No database migration, RLS policy change, credential change, service-role
  browser import, dependency addition, hosted write, deployment, or push is part
  of this batch.

## Verification

The focused suite contains **31 passing tests** after the first independent
audit fixes. It covers parser errors, unit conversion, line defaults, source
labels, current-query freshness, missing/future/invalid timestamps, modal focus,
private-field omission, and mounted quotation/list interactions. Subsequent
integration hardening is included in the final required-check runs recorded
below before delivery.

Source implementation: `2ef8c5d6b541e50b6e605b40febdce69019275c0`.
Final parser edge-case hardening: `59eeed9f2f8d1f2ed2319792ba2377b91d410508`.
The latter changes only the blank-header rejection and missing-finish option,
with assertions added to the existing parser tests.

Fixture synchronization: `7bb5942f1aa988a2faaae14e4610ccd4255b53ce`. A later full
run at `59eeed9` passed 1,768/1,769 tests: the pre-existing allocation test
resolved a save before React committed its requested unmount, permitting a
success notice while the component was still mounted. The controlled fixture
now commits its unmount with React's `flushSync` before resolving an obsolete
request. The production allocation component is unchanged. All **30 allocation
panel tests** passed after this correction, using the original `main` test file.
The separate pending development test edit was preserved outside this batch.

At the implementation checkpoint, `codex/v1` passed **1,928 tests across 76
suites**, lint, typecheck, and production build. Independent `main` verification
passed **1,769 tests across 76 suites** and the same three required checks.
The different counts reflect unrelated pending development work in `codex/v1`.
The final application checkpoint's focused suite passed **31/31**, including the
new edge cases. Lint, typecheck, and production build passed at `59eeed9`.
Application files are byte-identical at `7bb5942`; only the test fixture changed,
and its targeted ESLint check passed. The final complete test run at that
fixture-corrected checkpoint passed **1,769/1,769 tests across 76 suites**, with
zero failures, skips, cancellations, or TODOs (234.7 seconds).

| Required check | Verified result |
| --- | --- |
| `npm test` | Passed at `7bb5942`: 1,769 tests, 76 suites. [Final output](evidence/UPGRADE_EOS_2026-10-21/entry-previews/main-final-test.log). |
| `npm run lint` | Passed at `59eeed9`; fixture-only follow-up also passed targeted ESLint. [Output](evidence/UPGRADE_EOS_2026-10-21/entry-previews/main-final-lint.log). |
| `npm run typecheck` | Passed at `59eeed9`; no TypeScript/application changes afterward. [Output](evidence/UPGRADE_EOS_2026-10-21/entry-previews/main-final-typecheck.log). |
| `npm run build` | Passed at `59eeed9`; application tree is identical at `7bb5942`. Synthetic public Supabase configuration, no service key. [Output](evidence/UPGRADE_EOS_2026-10-21/entry-previews/main-final-build.log). |
| Focused acceptance | Passed 31/31 at the final application checkpoint. [Output](evidence/UPGRADE_EOS_2026-10-21/entry-previews/focused-final.log). |
| Existing allocation regression | Passed 30/30 after fixture synchronization. [Output](evidence/UPGRADE_EOS_2026-10-21/entry-previews/allocation-fixture-test.log). |

The failed run remains available as
[main-before-fixture-test.log](evidence/UPGRADE_EOS_2026-10-21/entry-previews/main-before-fixture-test.log).
The catalogue retains all 100 headings in their original order. None of these
five features is marked complete while visual acceptance is open.

Tests use synthetic in-memory rows, isolated browser components, temporary
local fixtures, and synthetic public Supabase configuration for compilation.
These checks do not prove hosted RLS, real-company artwork/master quality,
physical factory operation, or deployment acceptance.

## Changed source

Existing application files changed: `components/modules/quotes-client.tsx`,
`components/modules/operations/module-database-client.tsx`, and
`components/modules/operations/record-form-client.tsx`. The mounted database
regression is extended to cover the new preview and refresh interactions.
`scripts/lib/billet-allocation-browser-fixture.mjs` synchronizes controlled
unmounts as described above.

New implementation files:

- `components/modules/foundry/billet-weight-estimate.tsx` and
  `lib/calculations/billet-estimate.ts`.
- `components/modules/operations/record-preview.tsx` and
  `lib/workflow/record-preview.ts`.
- `components/ui/data-freshness.tsx` and `lib/workflow/data-freshness.ts`.
- `lib/forms/quote-paste.ts`.

New tests: `billet-estimate.test.mjs`, `billet-estimate-browser.test.mjs`,
`record-preview.test.mjs`, `record-preview-browser.test.mjs`,
`data-freshness.test.mjs`, `data-freshness-browser.test.mjs`,
`quote-paste-quantity.test.mjs`, and `quote-paste-browser.test.mjs`, all in
`tests/`. Updated `tests/module-database-state-browser.test.mjs` exercises the
actual preview and refresh integration with a synthetic RPC.

Documentation: this delivery record and per-feature status in `UPGRADE_EOS.md`.
Portable verification logs are stored in
`docs/evidence/UPGRADE_EOS_2026-10-21/entry-previews/` after verification.

## Manual acceptance still open

1. In the real quotation editor, paste one valid and one unmatched profile row,
   check codes, correct and recheck the bad row, and import. Confirm existing
   lines remain intact and no transaction is saved until explicit Save.
2. Change 100 pieces x 6 m x 0.8 kg/m from 6 m to 3 m. Confirm 600 m / 480 kg
   becomes 300 m / 240 kg theoretical, with measured observations unaffected.
3. Open a preview from page 2 of a filtered queue, inspect its readable fields,
   Tab/Escape/close, then confirm the same row retains focus and URL context.
4. Refresh an old or imported stock row. Confirm only Page fetched changes;
   underlying source/observation dates remain old or unavailable. Test an error
   and confirm the successful-fetch timestamp is not advanced.
5. In foundry entry, switch mm/cm/m/in display, expand the formula, and remove
   density. Confirm equivalent units preserve mass, invalid configuration shows
   an unavailable estimate, and no weighing is recorded.
6. Repeat the relevant screens at 375 px and desktop widths, including long
   profile identifiers and local scrolling inside the spreadsheet preview.

Real master approval and current density suitability remain company-owned data
requirements. The software displays the source it actually has and does not
certify a master value merely because it is populated.

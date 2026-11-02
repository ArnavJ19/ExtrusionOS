# November Upgrade Batch 1

Date: 2 November 2026 (Asia/Kolkata)
Catalogue: [NOV_UPGRADES.md](NOV_UPGRADES.md)
Base commit: `6f575f2287692a29978504783258f65dd7564751`
Development checkout: `.worktrees/codex-v1`
Delivery state: implementation, edge checks and local integration audit complete. Hosted and employee acceptance remain rollout gates.

## Selection and scope

These ten features are all U1 (first priority) and N1 (essential). They address daily readability, task context, recoverable reads, and employee interactions using existing data and guarded actions. The workspace feature NOV-002 was left outside this batch because the checkout already contained unrelated navigation/KPI work. NOV-006 needs department-specific decisions about draft and final requirements; this batch preserves existing lifecycle validation.

All ten had partial foundations. Shared badges lacked a complete semantic map; numeric cells converted missing values to zero; phone cards repeated a column and rendered every field; filters lacked removable chips and strict URL normalization; forms lacked persistent record context and shared action placement; selectors did not support navigating among results with arrow keys; readiness issues lacked an explicit source/team contract.

| NOV ID | Implemented behavior | Recheck and edge verification |
| --- | --- | --- |
| NOV-086 | Shared status families, text, border/background tokens and icons across Badge/StatusBadge consumers, including boards, tables, previews and phone cards. Unknown codes remain neutral and readable. | Production, dispatch, quality and accounts codes retain their original identity. Waiting, active, blocked and completed codes are distinct; unknown/blank codes are tested. Colors never authorize an action. |
| NOV-093 | Shared numeric formatting preserves zero, missing and invalid values; Indian number grouping, currency, kg, kg/m, metres, pieces, percentages and rates have explicit formats. Generic record fields use their named piece/length/percentage dimensions. Generic numeric columns align right and use tabular numerals; details expose the unrounded source value. | Null/blank/invalid values, negative corrections, large amounts, fractional piece rejection, non-INR currency and kg/m are tested. Calculation inputs, persistence and PDF calculation rules are unchanged. |
| NOV-099 | Database views distinguish initial loading, refresh, true emptiness, no filter matches, denied access and read failure. Failed refreshes retain a marked successful result; denied reads remove it. Related-count failures retain the main record and show Unavailable instead of zero. Generic form retries use the same error/loading cleanup as initial loading. | Failed/denied reads, empty filters, retained filters, stale requests and repeated form recovery are exercised in actual mounted components. Database read errors are presented as recovery guidance. |
| NOV-016 | Production readiness issues now explain the current reason, evidence/source and responsible team, with role-permitted resolution links. Enforced blockers precede advisories. Refresh removes resolved conditions; failed refresh never continues to display a ready claim. | Unknown codes, advisory ordering, denied edit/issue links, dealer/viewer roles and authoritative refresh are tested. Team labels explicitly do not assign a named person. Existing server/database start, release and resume checks remain authoritative. |
| NOV-083 | Overview headers, database layouts and generic record detail/form pages share PageHeader, contextual back navigation, wrapping action placement and a consistent heading/description pattern. | Mounted sales, stores, production and accounts databases are checked at phone and enlarged desktop sizes. One page heading, usable controls and absence of horizontal page overflow are verified. |
| NOV-084 | Generic record forms and details show a persistent business identity/context strip derived from the current authorized read; new entries are explicitly unsaved. User/company/role/module/record changes remount scoped workspaces. | Record/company switching clears prior identity and unsaved input. The current record remains visible below the shell header while editing. No new identity query or UUID fallback is introduced. |
| NOV-085 | Generic forms use a shared action bar positioned above measured navigation/safe areas. It falls back to normal flow in short viewports. One synchronous in-flight guard covers repeated taps; thrown save outcomes retain entries and disable a blind retry. | Repeated same-event saves produce one fixture write. Focused fields remain uncovered, pending controls disable, and a lost response exposes a database-check link while preventing another save. Existing save handlers and domain request identities are retained. |
| NOV-088 | Shared tables render selective phone cards with explicit identity/primary/secondary metadata and a More details disclosure. Secondary data is not repeated; nested controls do not navigate. Critical workflow columns remain visible on phones even when desktop preferences hide them. | Ten-row pagination, disclosure, nested buttons, native mobile identity activation, desktop keyboard activation, zero/missing values, warning visibility and narrow layouts are tested. Existing authorized projections remain the security boundary. |
| NOV-091 | Typed URL/saved-view parsing allowlists status, secondary, sort and relation filters, validates dates/IDs, and bounds page/search input. Active chips remove individual filters; Clear all and Reset to saved view have distinct behavior. | Combined filters, malformed values, reversed dates, round trips, ascending sort, page reset, browser Back, saved-view reset and stale responses are tested. Filtering/counting stay in the existing authenticated server RPC. |
| NOV-092 | SearchableSelect now exposes combobox/listbox semantics, arrow-key navigation, visible active choices, inactive explanations and selected context. Authorized generic lookups include customer city/contact, profile kg/m/alloy/temper and die status/rack metadata. Failed lookups retain selection and offer retry. | Similar names, inactive choices, keyboard/touch selection, composition, focus, missing selected records, failed/pending search and delayed results are covered. Existing bounded company-scoped search, exact selected-ID reads and request-version protection are retained. |

## Security and data audit

- No migration, RLS policy, Storage rule, service-role usage, or public/customer projection was added or changed.
- Database list queries still use the existing authenticated `get_operation_database_page` RPC, with ten rows per page and server-derived tenancy. New parsing does not accept `company_id` as a filter.
- Rich lookup metadata is selected from existing company-scoped requests. No internal cost, margin, supplier rate or notes are added to option context.
- The identity strip reuses the page's current record. It does not issue a competing lookup or display a previous record when the scope changes.
- Read retry and final save remain separate. A thrown save result is uncertain and cannot be blindly resubmitted through the new action bar.
- Production blocker guidance is a presentation of existing readiness responses. Database eligibility checks, locks, quantities and transition rules are unchanged.

## Files and evidence

New production files:

- `components/data/active-filters.tsx`
- `components/forms/form-action-bar.tsx`
- `components/forms/record-identity-strip.tsx`
- `lib/hooks/use-work-area-offsets.ts`
- `lib/ui/database-view.ts`
- `lib/ui/lookup-option.ts`
- `lib/ui/read-state.ts`
- `lib/ui/readiness-blockers.ts`
- `lib/ui/status-presentation.ts`
- `lib/utils/numeric-display.ts`

Modified production files:

- `app/globals.css`; `app/(dashboard)/production/[id]/page.tsx`
- `components/data/data-page-layout.tsx`; `components/data/data-table.tsx`; `components/data/data-table-toolbar.tsx`
- `components/layout/page-header.tsx`
- `components/modules/operations/module-config.ts`; `module-database-client.tsx`; `record-detail-client.tsx`; `record-form-client.tsx`; `value.tsx`
- `components/modules/production/production-readiness-panel.tsx`
- `components/modules/dies/dies-database-client.tsx` (explicit phone-card fields)
- `components/ui/badge.tsx`; `components/ui/error-state.tsx`; `components/ui/searchable-select.tsx`
- `lib/utils/format.ts`

New tests and fixture: `tests/nov-upgrades.test.mjs`, `tests/nov-upgrades-browser.test.mjs`, and `scripts/lib/nov-upgrades-browser-fixture.mjs`. Existing browser tests/fixtures for selectors, table keyboard access, allocation, dispatch, die readiness, finishing receipts, entry acceptance and database state are adapted to the real option roles, scoped remounting and new form labels. Their business assertions remain intact.

Documentation: this file and the delivery-record link in `NOV_UPGRADES.md`.

Local evidence: [docs/evidence/NOV_UPGRADES_BATCH_1](docs/evidence/NOV_UPGRADES_BATCH_1/). Screenshots mount production components with synthetic data and mocked network/session boundaries. They are not screenshots of a hosted signed-in deployment. Existing unrelated analytics/navigation, migration, audit and evidence changes are excluded from this delivery.

## Verification record

Tests were deferred until the initial implementation was ready. The first focused run found and corrected an ascending-sort URL restoration defect. The browser cache and loopback sandbox restrictions were then resolved using the already installed Chromium and local fixture access. A subsequent 25-check focused run passed. A broader run exposed older locators that expected selector options to be buttons; these fixtures were updated without weakening the quantity, permission or transaction assertions.

| Command/check | Result | Evidence |
| --- | --- | --- |
| `npm run lint` | Passed, no errors or warnings | `lint.txt` |
| `npm run typecheck` | Passed | `typecheck.txt` |
| `npm run build -- --webpack` | Passed with the existing Next.js webpack builder, 206 generated pages in the development checkout | `build.txt` |
| `npm test` | Passed: 2,872 tests, 76 suites, zero failures/skips | `tests.txt` |
| Affected-consumer integration pass | Passed: 185 tests | `focused-regression.txt` |
| Final feature/selector/lookup/finishing edge pass | Passed: 60 tests, including the final repeated-form-retry regression | `final-edge.txt` |
| `git diff --check` | Passed | Final local diff inspection |
| Phone/enlarged desktop inspection | Passed for mounted representative components; captures retained | Four PNG files in the evidence folder |

The full suite completed while the final audit was in progress. The final targeted pass separately covers the form-retry repair and the new edge checks added after their files had already run in that suite. The final build and static checks verify the integrated source. Browser tests use `PLAYWRIGHT_BROWSERS_PATH=C:/Users/arnav/AppData/Local/ms-playwright` in this environment. The build reports an existing stale Browserslist data warning; no dependency update was introduced.

Review corrections included sort-direction restoration, clearing a dependent selector label immediately when its source changes, preventing mouse hover from overriding keyboard navigation, retaining critical phone warnings despite desktop column preferences, and making a failed form reload retryable. No unresolved finding remains in the implemented local scope. The shared-component interactions use actual production components with boundary fixtures, not duplicate implementations of their rendering logic.

Existing regression tests regenerate older batch screenshots and the TypeScript cache. A temporary sandbox backup was unavailable at cleanup; those generated artifacts remain outside this batch's commit. Unrelated analytics/navigation, migration and audit source changes are retained in the development checkout and excluded from the batch.

## Acceptance boundary

This delivery implements a bounded shared-component rollout, not every bespoke screen in the 100-item catalogue. Dedicated quote/invoice/dispatch workflows retain their existing form lifecycles and benefit from the shared badge, formatting, header or selector improvements where they already consume them. New identity/action-bar placement applies to generic record forms/details. Readiness instructions are piloted in production. Selector image previews remain with existing approved profile/drawing views rather than introducing a new image permission path.

No hosted migration, push or deployment is part of this batch. A real signed-in role/company smoke test and a representative employee trial remain separate rollout evidence. Physical phone keyboards, hardware, all browser/assistive-technology combinations, factory reconciliation and quantified productivity benefits are not established by the local fixture.

Before hosted release, the pilot checklist is: inspect a real sales/stores/production/accounts task; verify the current company and record identity; combine and clear filters then return using Back; open a compact card and its secondary details; use a keyboard to distinguish similar lookups; resolve and refresh a readiness issue; save once through a slow response; verify denied/failed sources remain distinct from an empty result; and check a physical phone keyboard and enlarged text with the actual navigation.

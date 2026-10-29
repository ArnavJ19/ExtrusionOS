# EOS upgrade batch 5

Date: 29 October 2026. Catalogue: `UPGRADE_EOS.md` (called EOSUPGRADE.md in the request).
Development checkout: `.worktrees/codex-v1`, branch `codex/v1`. One local commit per feature; no push or hosted migration.

Selected features: 7, 16, 17, 18, 40, 53, 88, 93, 94, 99. Each checkpoint below records implemented scope, tests, audit and remaining proof layers.

## Feature 16: recoverable dispatch drafts

Implemented company/user-scoped local draft identity, visible saving state, seven-day expiry, strict versioned envelopes, explicit restoration, browser-lock-protected revision comparison, and removal after confirmed dispatch. Recovery preserves unfinished observations and re-fetches current material sources. Draft persistence never posts stock or changes workflow state.

Created `lib/forms/dispatch-draft.ts`, `components/forms/dispatch-draft-recovery.tsx`, `tests/dispatch-draft.test.mjs`, `tests/dispatch-draft-browser.test.mjs`. Modified the dispatch form and its browser fixture to isolate saved drafts between independent regression cases. No migration or RLS changes.

Verification: five unit/edge cases passed; three recovery browser cases passed; all 33 existing dispatch-form browser regressions passed. Focused ESLint passed before the final cross-tab audit patch; full-source checks follow the completed batch. Browser tests ran against the actual component on a local synthetic transport, with localhost access. These are not authenticated hosted evidence.

Audit: a read/compare/write in localStorage alone could race between tabs; writes and deletion now use the browser Web Locks API. A browser without that API reports that saving failed and retains entries. A stale draft never restores cached availability. Another account/company cannot discover the draft through the application. Drafts remain device-local and are not cross-device backup. Physical operator acceptance remains pending.

Manual acceptance: enter an order and bundle observations, reload, restore, change authoritative availability, verify review is refused, then confirm a valid dispatch and verify its saved draft disappears. Repeat with two tabs and an account/company switch.

## Feature 40: faster dispatch readiness

Replaced repeated inspection, packaging and issued-material scans per production job with shared indexed aggregation. Source fetching, complete paginated packing history, final balance rechecks and the atomic stock writer remain authoritative. Created `lib/dispatches/readiness-index.ts`, `tests/dispatch-readiness-index.test.mjs`, `scripts/benchmark-dispatch-readiness.mjs`; modified `lib/actions/dispatches.ts`. No database or RLS changes.

Verification: three new parity/edge tests plus 40 existing action-boundary/packing-history tests passed (43 total). A five-run synthetic benchmark with 1,000 jobs, 10,000 inspections, 5,000 packaging rows and 10,000 material rows produced identical output: baseline 176.871-253.253 ms; indexed 1.535-2.469 ms. This measures local computation, not hosted query latency or employee task duration. Rerun with `node --experimental-strip-types scripts/benchmark-dispatch-readiness.mjs`.

Audit: only approved mill-finish inspections count; packaging still requires a positive issued-material record and completed status; duplicate material records do not double count packaging. Invalid recorded observations stop readiness. Missing records remain zero as before. Existing tests cover stale availability, API caps, foreign rows, multiple source identities and refused writes. Manual acceptance: measure a representative company's dispatch preparation before/after deployment and reconcile the unchanged source quantities.

## Feature 7: downstream party details

Dispatch entry reuses the accepted order party, including delivery site, contact and instructions. Orders without an accepted snapshot explicitly use the current customer master. Dispatch confirmation freezes a new immutable party history; detail pages use that history and never reconstruct an older dispatch from today's master.

Created migration `20261029010000_downstream_party_context.sql`, workflow schema/action, delivery-context component and two test files. Modified dispatch entry/detail and its mocked browser boundary. Company-scoped RLS table has no direct client grants; server and database role checks agree; the projection contains no cost, margin or payment terms. Private functions are not client-executable. Existing quote/order/invoice snapshots remain intact.

Verification: six unit/SQL cases passed, including real accepted quote conversion, master changes, immutable dispatch history, missing historical data, role refusal and ACL checks. Fresh migration replay passed. Typecheck passed at the initial integration checkpoint. Audit: retain accepted party precedence, expose fallback provenance, fail unavailable for historical records without captured history, and whitelist downstream fields. Manual acceptance: change a customer, compare new unsnapshotted drafts with accepted orders, and confirm issued invoice/dispatch party history remains unchanged. Hosted migration/JWT acceptance pending.

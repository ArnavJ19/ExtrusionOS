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

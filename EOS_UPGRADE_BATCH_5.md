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

## Feature 94: measured bundles reused for dispatch

`/dispatches/bundles/new?order_id=...` records actual pieces/metres/gross/tare from an eligible source, calculates net weight, and generates a full-UUID bundle tag when needed. Dispatch entry selects these measured bundles from a searchable ten-row server page, retaining measurements/source identity and deriving its existing reviewed totals. Preparation is advisory; it does not reserve or consume additional stock. Dispatch uses the existing atomic stock writer.

Created migration `20261029020000_prepared_physical_bundles.sql`, physical-bundle schema/actions/component/route, shared real-schema fixture and three test files. Modified dispatch entry and its browser fixture. The company-scoped RLS registry has no direct client grants. Exact request retries replay; a database trigger locks and consumes each recorded tag once and refuses changed observations. Existing dispatch readiness, source ratios, QC and stock ledger guards remain in force.

Verification: two unit/edge cases, four real-schema SQL cases and two mounted browser cases passed. SQL uses real direct-order creation, reservation and atomic dispatch; changed measurements roll back, valid posting consumes exactly 9.6 kg, and another dispatch cannot consume the same tag. Lists remain bounded at ten rows. Typecheck passed at integration. Audit additionally rejected tags already present in historical dispatches and retained full UUID entropy. No independent-session contention or physical weighing trial is claimed. Manual acceptance: measure two tagged bundles, select both, reconcile totals, remove one, recheck quantities, post once and try the consumed tag from a second session.

## Feature 17: focused mobile bundle recording

`/mobile/dispatch/bundles` provides a ten-row, searchable server order queue and a focused capture task using the same bundle action as desktop. Large controls, numeric/decimal keyboards, a scan/wedge-compatible tag field, generated identity, live net-weight feedback and one recording action support short packing tasks. The shared source and measurement guards remain authoritative. A refused or uncertain result preserves measurements and the same request identity.

Created the mobile route, queue/entry rules and two test files; modified mobile dispatch navigation, the shared capture component/action and browser fixture. No additional migration or RLS change. Three unit/edge and three mounted browser tests passed, including 375/1280 px completion, zero versus blank tare, bounded search, role/dealership refusal and retry identity. Styled overflow and visual inspection are part of final batch checks; physical-device/operator acceptance remains pending. Audit fixed decimal parsing to accept three-place observations without floating-point integer artifacts. Manual acceptance: open the task from a phone, search its order, scan/type a tag, enter observed values, survive an interrupted save, then verify the recorded tag on dispatch preparation.

## Feature 18: transaction-linked documents and communication

Invoice detail prepares an issued, snapshot-backed customer message with recipient and complete outgoing content visible before copying. The existing authorized invoice PDF opens for print/download. Copying rechecks the current fingerprint; changed data requires another review. Preparation/copying never claims sending or delivery, and transport/clipboard failures remain explicit.

Created migration `20261029030000_invoice_communication_preview.sql`, schema/action/component, generic mounted-browser fixture and three test files. Modified invoice detail. No new table; the read-only RPC derives company/active finance role and projects issued-party/customer-safe fields only. The document path is bound to the exact invoice; external document URL injection is rejected.

Verification: two unit, two SQL and two browser cases passed. Coverage includes draft/role/anonymous refusal, snapshot retention after master edits, safe output keys, recipient formatting, PDF binding, late source changes and failure without delivered claims. Typecheck passed. Audit: use recorded party fields, exclude internal commercial fields and instructions, restrict the workflow to finance roles, and recheck before clipboard access. No provider integration or automatic sending is claimed. Manual acceptance: inspect issued recipient/text/PDF, change source status, retry a stale preview, and simulate a clipboard failure.

## Feature 53: press workstation

`/production/workstation`, linked from production overview, retains a company press preference and identifies the current signed-in operator. Ten-row press lookup opens a server-recorded ten-minute lease; its queue returns up to ten current jobs for that press. Queue reads recheck actor, company, active press, lease ownership/expiry and end state. Production links retain the existing guarded job workflow and competency checks.

Created migration `20261029040000_workstation_sessions.sql`, workstation schema/actions/component/route and three test files; modified production navigation and the mounted fixture. The RLS session table has no direct client grants. Stored browser preference contains only the press ID, without an operator or lease. Lock/switch clears visible work and this operator's dispatch draft, ends the lease, signs out the current authentication session and opens login. Failure leaves the station locked.

Verification: two unit, two SQL and two browser cases passed. Tests cover forged identity, foreign/ended/expired leases, a second operator, inactive role paths, ACLs, queue removal, sign-out navigation and retained station-only context. Audit added ready/held jobs to the bounded queue and prevented any queue failure from retaining prior visible work. Manual acceptance: use a real shared terminal with two operators, observe attribution and privileges, wait for expiry, and confirm the prior operator's draft cannot be recovered by the next operator. Hosted sessions/device acceptance pending.

## Feature 88: confirmed stock versus manufacturing

Order detail links `/orders/[id]/stock-plan`. Ten-row line and stock pages explain eligible/excluded stock, confirmed stock coverage, separate physical stock weight, production commitments, total manufacturing requirement and what remains to plan. Whole-piece proposals become reservations only after a reviewed source fingerprint is rechecked under order/line/batch locks. Exact request replay creates one allocation. A production-job trigger enforces the reduced requirement through ordinary writes as well.

Created migration `20261029050000_stock_manufacturing_requirements.sql`, schema/action/component/route and three test files; modified order navigation. Allocation history is immutable, company scoped, RLS enabled and inaccessible directly to clients. Known dealer stock, QC holds, incompatible lengths/specifications, ambiguous repeated profile/finish lines and unassigned legacy reservations remain excluded with reasons. This pilot allocates finished lengths directly; material needing cutting uses the cutting workflow.

Verification: two unit, four SQL and one browser cases passed. Actual reservations reduce a 960 kg manufacturing requirement by 240 kg to 720 kg; stale/failed/oversized allocation leaves it unchanged. Direct production of 721 kg is refused. Audit separates order-basis coverage from measured stock weight, binds exact retries, checks nullable QC status, rejects missing production quantities, retains dispatched coverage and freezes the request after an uncertain confirmation. Database locking is implemented; independent-session contention and historical reservation reconciliation remain hosted acceptance gates. Manual acceptance: have two employees review the same stock, commit one, retry the stale second proposal, reconcile source units and attempt excessive production.

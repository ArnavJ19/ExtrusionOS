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

## Feature 93: cutting requirements and recorded actuals

Order detail opens `/orders/[id]/cutting`; `/production/cutting/rules` authors versioned kerf, end-trim, cut allowance and minimum reusable-remnant rules for independent approval. The workspace fetches the line's recorded cut length/count and compatible released stock, proposes a bounded sequence using available bars, and shows unplaced pieces and estimated offcuts explicitly. This pilot cuts one order length per source bar; the existing multi-length configurator optimizer remains available.

Actual recording reconciles one physical bar's lengths and measured output/remnant/scrap weights, rechecks a source fingerprint under locks, consumes the source once and creates identifiable output/remnant batches on QC hold. Planning creates no stock. Child records and immutable run snapshots retain lineage. Cutting withdrawals are included in the stock-balance explanation and reconciliation. Created migration `20261029060000_cutting_requirements_and_actuals.sql`, schema/action/component, two routes and three test files; modified order navigation, route permission, stock-balance labels and the browser fixture.

Verification: four unit/property/edge tests (200 generated dimensional scenarios), three real-schema SQL tests and one browser workflow passed. Fresh replay passes. Cases cover independent review, impossible cuts, insufficient bars, stale source, bad weight/length reconciliation, exact retry, source consumption, held child batches and signed stock explanation. Audit bounds expansion, includes the first saw cut and both end trims, retains approved rule snapshots, caps stock history at 100 displayed entries with complete totals and refuses fractional remnants finer than the stock unit. An unrelated stock-planner JSX escaping error found by full lint was corrected. Manual acceptance: approve actual saw settings, compare the proposed sequence with a trial bar, record measured output/scrap/remnant, independently release eligible child stock and reconcile its signed source movement. Hosted/physical cutting acceptance pending.

## Feature 99: machine time, meter observations and tariff cost

`/production/usage`, linked from production, records operator-attributed start/pause/resume/stop events against a configured machine meter. Dated tariff drafts need another authorized reviewer; the applicable approved rate is frozen at start. Server event intervals produce runtime and downtime only after an actual stop. Closing minus opening produces consumption; a decreased reading leaves consumption/cost unavailable and requires independent correction or a verified single rollover with a configured modulus. Original readings and resolution events remain in history. Costs are machine totals and are never allocated to jobs without a separate approved method.

Created migration `20261029070000_machine_usage_events.sql`, schema/action/component/route and three feature test files, plus the batch-wide database security test and rendered-evidence script. Modified production navigation and route permissions. Four new tables carry company identity, RLS and company indexes; all client table grants are revoked. Database roles separate observation, configuration, tariff review and independent resolution. Factory operators receive no tariff rates or costs. The meter and tariff setup supports manual verified observations; no equipment integration or expense posting is claimed.

Verification: two unit/edge, five real-schema SQL and one browser cases passed. Coverage includes missing stop, approved effective tariff, self-review refusal, one active run per meter, exact event replay, changed retry refusal, runtime/downtime reconciliation, decreased readings, independent rollover, immutable events and cost-field restrictions. Audit replaced transaction-start timestamps with clock timestamps captured after acquiring the run lock and added monotonic event sequencing; an earlier waiting transaction cannot backdate an event or reorder equal timestamps. Missing/negative clock evidence cannot become fabricated runtime. Manual acceptance: verify meter assignment/modulus and tariff with the factory, run across a shift boundary with a pause, confirm readings and compare elapsed times; rehearse a reset/rollover with another reviewer. Hosted multi-session and physical-meter acceptance pending.

## Final cross-feature audit

The database security suite verifies all ten new tables: RLS enabled, non-null company identity, company indexes and no direct authenticated/anonymous grants. All eight public RPCs are security-definer functions with pinned search paths; anonymous execution and client execution of private helpers are refused. Actual `authenticated` SQL-role calls exercise the intended RPC boundary. An active owner from another company cannot resolve scoped records through any new RPC.

The final integration audit also connected committed factory-stock coverage to the original order-progress panel. Its total combines dealer and factory allocations once, on the order weight basis; missing/truncated coverage leaves progress unavailable. Two added unit regressions, the real allocation SQL assertion and the existing eight progress/finishing unit cases pass. The change prevents conflicting remaining requirements on the planner and order detail.

Audit fixes also reject SQL NULL commands before mutation branches, require finite recorded line demand, exclude exhausted unit balances, prune expired drafts under browser locks, cancel queued autosaves after unmount and prevent a late linked-order lookup from replacing a restored draft. The focused security and stock suites pass after these changes. Source and final broad-check evidence are recorded below when the last run completes.

Seven migrations are local repository changes only. They have not been applied to hosted Supabase. No push or deployment was performed. The finished-goods origin check is expanded to retain measured cutting outputs/remnants; existing origin values remain valid. Historical records are preserved. Fresh local schema replay and ACL behavior do not certify hosted JWT/RLS/Storage or independent-session contention.

## Final verification and delivery

The final frozen source passed every required repository gate:

- `npm run lint`: exit 0, no warnings. `docs/evidence/EOS_UPGRADE_BATCH_5/lint.txt`.
- `npm run typecheck`: exit 0. `docs/evidence/EOS_UPGRADE_BATCH_5/typecheck.txt`.
- `NEXT_DIST_DIR=.next-eos-batch5 npm run build -- --webpack`: exit 0; 194/194 pages generated. `docs/evidence/EOS_UPGRADE_BATCH_5/build-final.txt`.
- `PLAYWRIGHT_BROWSERS_PATH=C:/Users/arnav/AppData/Local/ms-playwright npm test`: exit 0; **2,742 tests passed across 76 suites**, zero failed/skipped/cancelled/todo; 464.858 seconds. `docs/evidence/EOS_UPGRADE_BATCH_5/tests-final.txt`.
- This batch adds **74 tests**: 29 unit/edge/property tests, 29 SQL/security tests and 16 mounted browser cases. The property test exercises 200 generated dimensional scenarios. Existing regression assertions remain intact.
- Fresh-schema fixtures replay **268 migrations plus two baseline files (270 files)** with no failures, then exercise real orders, reservations, dispatch, cutting, party snapshots and machine events. The security fixture also uses the actual local `authenticated` SQL role.
- Seven rendered captures at 375/1280 px use real components, built CSS and loaded app fonts; all passed overflow checks and were visually inspected. Transport/data are synthetic. `visual-checks.json` records dimensions and scope.
- The dispatch readiness benchmark was repeated with identical results: baseline 198.094-439.332 ms, indexed 1.426-2.008 ms in the final sample. The earlier sample is recorded in feature 40 above. These are local computation measurements, not hosted task latency.
- Source digest before and after the final suite is identical: **1,456 files**, SHA-256 `4c0f0707b7bed1826d1ab16feeede9c78a78d195df9a6ebfd892b68dda9eaa56`. The staged Git source/configuration checkpoint is **1,444 files**, SHA-256 `fd036dd78d944b3f8f8dc671792a0dd01af3c0c085a257002012bb030443990f`. The workspace digest includes pre-existing local helper scripts; the Git checkpoint identifies the exact promoted source blobs.

The first full run exposed three stale browser-fixture boundaries for the new dispatch panels. Those fixture transports were supplied, retaining the original assertions; all 13 affected cases then passed. The integration audit subsequently added factory-stock coverage to both the original order-progress view and the line-delivery queues, with explicit regressions. The final 2,742-case run above is the completion evidence.

See [the exact added/modified file manifest](docs/evidence/EOS_UPGRADE_BATCH_5/files.txt) and [machine-readable verification](docs/evidence/EOS_UPGRADE_BATCH_5/verification.json). Seven migrations, ten new protected tables and eight public RPCs are included. Development is delivered as ten local feature commits, followed by a fast-forward of `main`; no remote push is part of this batch. Unrelated pre-existing audit files and generated earlier-batch screenshots are excluded from these commits.

Remaining rollout acceptance: reconcile the hosted migration ledger and prerequisites before applying only the reviewed chain; test real employee/dealer JWTs and Storage separately; rehearse independent database sessions for conflicting allocations/dispatches; validate approved saw rules, physical weighing, meter assignments/tariffs and workstation switching with operators. Cutting is an order-line pilot with QC-held measured child stock; equipment import, provider delivery and shared energy-to-job allocation are outside this delivered workflow.

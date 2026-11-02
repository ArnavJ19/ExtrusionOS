# November Upgrade Batch 2

Date: 2 November 2026 (Asia/Kolkata)
Final verification: 3 November 2026 (Asia/Kolkata)
Catalogue: [NOV_UPGRADES.md](NOV_UPGRADES.md)
Base commit: `78f45232f94c65a6f5f89a801f1c5bbb2ac09d74`
Development checkout: `.worktrees/codex-v1`
Delivery state: ten bounded feature slices implemented; local domain, browser, integration and source checks passed. Hosted and employee acceptance remain rollout gates.

## Selected scope

All ten entries are U1 (first priority), N1 (essential). They extend existing authorized workflows and share form and action contracts. This is the second November batch; the ten entries in batch 1 are not counted again.

| ID | Delivery slice | Required edge evidence |
| --- | --- | --- |
| NOV-001 | Refreshable My Work Today, explicit personal/team ownership, domain next actions, retained marked results on individual read failures | Source loss, access loss, role/company changes, ten-row bounds, stale sources and business dates |
| NOV-002 | Four permitted role destinations inside the existing workspace, explicit pin/unpin, accessible pin ordering, recovery to My Work Today | Two users/companies, revoked route/record access, broken storage, long names, phone and Back restoration |
| NOV-004 | Typed next-action descriptors carrying source identity/status/version where available; quality and packaging coverage; same resolver in work queues | State/role matrix, invalid IDs, dealer isolation, read-only users, existing guards and exact source links |
| NOV-006 | Essential, pending-observation and optional sections for production, quality and packaging; selected final statuses reveal observation fields; full existing Zod validation remains authoritative | Collapse retains values, final status changes, hidden invalid fields expand, no relaxed finalization |
| NOV-012 | Explicit pieces/cut-length theoretical production plan, existing m/mm/ft/in conversion, separate actual/billing values, server recheck of the calculation, order-line cut length and applicable section-weight snapshot | Missing/zero weight, counts, conversion/rounding, extremes, source changes, preserved historical weight and direct server bypass |
| NOV-018 | Focused mobile inspection task using existing observation action, one check at a time, review, scoped device draft recovery and interrupted-save resolution | Offline, interruption, repeated taps, lost response, changed plan, narrow/enlarged layouts |
| NOV-094 | Production order-line provenance, refreshed revision, manual override, source restore, safe source switching and late-response protection | Same-source refresh retains overrides; new source replaces incompatible facts; old reads cannot overwrite a new selection |
| NOV-095 | Approved inspection-plan version, sampling, method, limits and nominal beside the actual observation input; full permitted plan in a separate tab | Old/new plan versions, missing/denied reference, no theoretical observations, retained input |
| NOV-096 | Linked error summary, stable unique field IDs, inline associations, focus/section expansion and retained values after failure | Nested errors, repeated forms, collapsed sections, server rejection, stale-source and uncertain outcomes |
| NOV-100 | Native submit semantics, labelled fields, accessible validation/review, large observation/workspace controls, keyboard focus, responsive task composition | Keyboard-only, enlarged text, focus visibility, no horizontal page overflow, sticky controls |

## Data and security boundary

No migration, RLS policy, Storage path, public/customer projection, or external integration is added. All existing guarded transactions remain authoritative. New queue refreshes derive actor/company identity from the server session. New mobile reads use that identity and check role, feature access and company filters. Quantity-basis metadata is validated on the server and is not persisted as trusted evidence. A plan is an estimate, not measured output or contractual billing.

For an order line, the quantity helper uses its technical section-weight snapshot and refuses a different specified cut length. A current profile-master change does not replace that historical reference. A direct order without an order-line snapshot uses a clearly labelled current-profile planning estimate, rechecked on the server. A missing order-line section weight disables dependent calculation instead of falling back to an unrelated master revision. The existing manual-kg planning path is preserved; this helper does not change billing, actual-output capture, issued PDF calculations or the order revision lifecycle.

Inspection device drafts contain only entered observation values and scope/plan identity, are confined to sessionStorage, expire after eight hours, and are filtered to the current plan's characteristics on recovery. Restoring a draft does not restore permission or eligibility. An uncertain save disables a second save until an authorized read resolves the current observations.

The interrupted-save marker is written before submitting and recovered after reload. Observation reconciliation reads the existing guarded inspection command; it is not a new generic payment/stock retry protocol. Failed or changed plan reads retain entries and require review. Plans and observations retain their existing database authorization and approval rules.

Unrelated pre-existing KPI, navigation, audit, migration and generated evidence changes in the development checkout are preserved and excluded from this batch.

## Files and audit corrections

New production files:

- `app/(dashboard)/mobile/quality/[id]/page.tsx`
- `components/forms/form-issue-summary.tsx`; `components/forms/planning-quantity-entry.tsx`
- `components/modules/live-my-work.tsx`; `components/modules/quality/inspection-results.tsx`
- `lib/actions/my-work.ts`; `lib/calculations/planning-quantity.ts`; `lib/dashboard/work-refresh.ts`
- `lib/preferences/role-workspace.ts`; `lib/ui/form-workflow.ts`; `lib/ui/inspection-entry.ts`

Modified production files:

- `app/(dashboard)/dashboard/page.tsx`; `app/(dashboard)/mobile/quality/page.tsx`; `app/(dashboard)/quality/[id]/page.tsx`
- `components/layout/workspace-shortcuts.tsx`; `components/modules/my-work-today.tsx`
- `components/modules/operations/record-form-client.tsx`; `components/modules/operations/record-detail-client.tsx`
- `components/modules/quality/inspection-plans.tsx`; `components/modules/shared/record-next-action.tsx`; `components/ui/searchable-select.tsx`
- `lib/actions/production.ts`; `lib/actions/inspection-plans.ts`; `lib/dashboard/my-work.ts`; `lib/workflow/record-next-action.ts`

New tests and fixtures: `tests/nov-batch2.test.mjs`, `tests/nov-batch2-actions.test.mjs`, `tests/nov-batch2-browser.test.mjs`, `scripts/lib/nov-batch2-actions-fixture.mjs`, and `scripts/lib/nov-batch2-browser-fixture.mjs`. Documentation: this delivery record and the batch link in `NOV_UPGRADES.md`.

The recheck kept existing order technical snapshots authoritative rather than allowing a calculator to overwrite customer dimensions. Other audit corrections cover empty optional planning inputs, preserving manual notes and real zero billet requirements during source refresh, rejecting late source/billet reads, retaining uncertainty across reload, disabling stale queue actions after transport failure, moving visible pins past hidden/revoked links, and clearing corrected validation messages. Saved inspection attribution remains visible. No unrelated PDF/report implementation was replaced.

Screenshots mount production components with synthetic session/network boundaries and the installed application font. They verify local interaction and layout, not a hosted signed-in application. Phone, enlarged desktop and keyboard-focus inspection includes a focused next-check control staying outside the sticky action bar. No full accessibility-conformance or real-device claim is made.

## Verification and rollout

Tests and lint were deferred until implementation and meaningful edge fixtures were ready, as requested. Evidence is in [docs/evidence/NOV_UPGRADES_BATCH_2](docs/evidence/NOV_UPGRADES_BATCH_2/).

| Check | Result | Evidence |
| --- | --- | --- |
| New domain, real action and real mobile-route checks | Passed: 27 checks, including 200 varied quantity plans inside the property check | `focused-domain.txt` |
| New production-component browser checks | Passed: 20 checks | `browser.txt` |
| Existing task/workspace/inspection SQL/action regressions | Passed: 60 checks | `domain-regression.txt` |
| Full `npm test` | Passed: 2,915 tests, 76 suites, zero failures/skips | `tests.txt` |
| `npm run lint` | Passed; final source check recorded after audit | `lint.txt` |
| `npm run typecheck -- --incremental false` | Passed; final source check recorded after build | `typecheck.txt` |
| `npm run build -- --webpack` | Production build verified in the configured local verification output directory | `build.txt` |
| Final existing production/PDF/shared-form consumers | Passed: 142 checks | `final-consumer-regression.txt` |
| `git diff --check` | Passed | Final source inspection |

The full suite ran during the final audit. The separate final focused and consumer passes cover the last quantity-reference and validation corrections and additional edge cases after their files had run in that suite. Counts are check-run totals, not a sum of unique tests. Local browser tests need access to their loopback fixture server and the already installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=C:/Users/arnav/AppData/Local/ms-playwright`). A sandbox loopback denial and a build-output permission failure were environmental failures; retrying the local checks used the existing verification build directory. An existing stale Browserslist-data warning does not alter the application result; dependencies were not updated.

Tracked evidence and generated declarations/caches were copied before broad checks, including the pre-existing modified files. Regenerated artifacts outside this batch are restored from that verified copy before handoff. No existing working source is reset or discarded.

Hosted deployment, real signed-in role/company checks, physical-device and employee acceptance are separate evidence. No remote mutation or deployment is included in this local implementation task. The representative pilot is production planning plus approved-plan quality observations; other custom form families and full accessibility conformance remain outside this slice.

The rollout pilot checklist is: use two actual company/user sessions; verify role destinations and revoked pins; return to filtered work using Back; refresh personal and shared queues without claiming tasks; plan an exact order line in mm/m/ft/in; check its historical weight and cut length; refresh without replacing manual notes; resolve a hidden field error; record inspection observations on a physical phone; interrupt and reload a save then check current results; and verify the independent guarded approval and stock/dispatch prerequisites. Record employee findings and device behavior before extending to other tasks. No productivity saving is claimed without that observation.

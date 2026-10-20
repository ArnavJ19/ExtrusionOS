# BUGS-MEGA continuation: manual billet allocation panel

Date: 20 October 2026 (Asia/Kolkata).

This report records the completed R23 checkpoint. The later R24 read/UI candidate and current consolidation boundary are recorded separately in `BUGS_MEGA_R24_ALLOCATION_OPTIONS_2026-10-20.md`; its new migration remains unapplied.

Portable R23 baseline/full-check evidence and current responsive regressions are preserved under `docs/evidence/BUGS_MEGA_2026-10-20/R23/`. See `BUGS_MEGA_HANDOFF_2026-10-20.md` for the complete saved-work inventory and idle consolidation boundary. The historical uncommitted status below describes the R23 checkpoint; the final R23/R24 source is committed for consolidation.

## Scope and status

The complete unresolved register was reviewed against commit `12874da`, including the 20 October migration-application report. A00 and R04-R11/R17-R22 retain their recorded open acceptance gates; they are not unfixed database candidates awaiting automatic reapplication. The historical register and all original findings remain intact.

The shared checkout switched from `codex/v1` to `main` during intake. The user explicitly chose to continue from `codex/v1` in a separate worktree. This continuation uses `C:\Users\arnav\.codex\worktrees\bugs-mega-next-issue\ExtrusionOS`, branch `codex/bugs-mega-allocation-panel`, based on `12874da`. No change was made to the shared checkout's source or branch.

A00 cannot be closed from this local environment. The existing staging runner exits 1 with `STAGING E2E GATE FAILED` because the dedicated staging opt-in and configuration are absent. `docker info` also fails because the local Docker engine is unavailable. Existing hosted credentials were not copied or reused as staging credentials. The 20 October hosted application evidence is retained as a prior recorded result; no new hosted schema conclusion is made here.

The next actionable gap in the register's billet investigation is the manual allocation panel's load/refresh behavior. Its reproduced defect is recorded as R23. **R23 is LOCALLY FIXED after the final full tests, lint, typecheck, build, responsive QA and source audit pass.** The overall goal remains open for the separately recorded acceptance gates and investigations.

## R23 reproduction and repair

The original component set loading at the beginning of every read, but only cleared it in the initial effect. After a successful allocation the subsequent read left the entire component hidden. Its other related lifecycle defects were stale responses and selections after a billet change, no retryable unavailable state, stuck saving after a rejected promise, and duplicate submissions before React committed the disabled state.

The initial actual-DOM Chromium suite fails 20 of 21 cases on the original component. The original non-allocatable-status control passes. Evidence: `test-results/billet-allocation-panel/baseline.log`.

The repair keeps the existing browser reads, server actions and SQL authority. A keyed inner panel discards readiness when billet, company, user or role changes. Reads commit only while their effect owns the current panel. Loading, unavailable and ready states are distinct. A manual refresh clears the selected order and prevents writes while loading. Missing or foreign billet/requirement identities produce unavailable state.

A synchronous save lock prevents same-event duplicate calls. Pending controls are disabled. Every uncertain/failed response requires a fresh read before another attempt; thrown transports are caught, saving is cleared, and a malformed success cannot produce a confirmation. A successful write keeps its confirmation through a failed subsequent read. Current billet identity and an internal link to its allocated order remain visible even when no open requirements remain.

The existing database allocation/reallocation functions still authorize company/role, select the exact requirement and enforce material/production eligibility. The panel does not add a write RPC or replace those checks.

## Tests and audit

Thirty new cases exercise the actual React panel in Chromium with controlled reads and action transport. Cases include initial and post-save loading, requirement/billet failures and retries, reversed response order, company/user/role changes, stale selections, unmounted completions, duplicate clicks, malformed identities/acknowledgments and disabled pending controls.

Three browser-generated requests are passed through the actual server actions and actual public SQL wrappers in disposable PGlite fixtures. They establish successful allocation with a stable refreshed state, reallocation with source/target requirement-counter changes and retained physical billet fields, and a committed allocation whose lost response cannot silently submit a second write. The read/identity/transport boundary remains synthetic; these are not hosted authentication, full PostgREST/RLS or independent-session tests.

The source audit tightened a reallocation assertion that originally referred to absent `length_mm`. It now checks the actual `billet_length_mm` column and requires every compared physical field to exist. Weight, length, diameters, alloy, temper, source, foundry batch and production-job identity are compared directly. Final broad verification includes the corrected assertions and the final invalid allocated-order case.

Styled QA uses the successful build's actual CSS/fonts and blocks non-loopback requests. Four states (ready, recorded, unavailable and unconfirmed) pass at 1440, 820, 390 and 320 pixels. All 16 cases have zero page errors and no horizontal document overflow, including long billet codes. Representative mobile-ready, tablet-unconfirmed and desktop-recorded screenshots were inspected.

| Check | Current evidence |
| --- | --- |
| Original panel baseline | 1 passed, 20 failed; retained in `baseline.log` |
| Initial focused verification | 21 passed; subsequently expanded to 30 cases |
| First full suite | 1,594 passed / 76 suites; zero failures/skips/cancellations |
| Final full suite | **1,595 passed / 76 suites; zero failures/skips/cancellations**, `full-tests-final.log` |
| Final lint and standalone typecheck | Both passed with no reported diagnostics; `lint-final.log` and `typecheck-final.log` |
| Standard production build | Passed; 154 generated pages, `build-final.log` |
| Styled responsive QA | 16 passed; `responsive/results.json` and 16 screenshots |
| Tracked/new-file whitespace | `git diff --check` and all six changed/new source/report files pass |

An initial standard build failed because Turbopack rejects a node_modules junction outside its configured root. Only this worktree's verified dependency junction was removed, and `npm ci --offline --ignore-scripts --no-audit --no-fund` installed the existing lockfile locally. The subsequent unmodified `npm run build` passes. The lockfile and dependency declarations are unchanged. The build uses synthetic public Supabase values; no hosted credential was copied into the worktree.

Commands: `npm test -- --test-concurrency=2`, `npm run lint`, `npm run typecheck`, `npm run build`, `node scripts/qa-billet-allocation-panel.mjs`, and `git diff --check`. Detailed outputs remain under `test-results/billet-allocation-panel/`.

## Files and security boundary

- Modified: `components/modules/foundry/billet-allocation-client.tsx` and `BUGS-MEGA.md`.
- Created: `tests/billet-allocation-panel.test.mjs`, `scripts/lib/billet-allocation-browser-fixture.mjs`, `scripts/qa-billet-allocation-panel.mjs` and this report.
- No database migration, SQL writer, RLS policy, grant, public RPC contract or dependency declaration changed. Browser reads retain explicit company filters and validate returned identities. Server-derived authorization remains in the existing actions and SQL.
- No hosted writes, business-data correction, deployment, commit, merge or PR update occurred. The temporary database contains synthetic data only. Build/test caches and evidence are local artifacts.
- The codebase-memory skill was used to index the isolated worktree and trace the panel and its server actions before editing.

## Operator checklist and remaining work

- Verified locally: initial read; recoverable read error; successful allocation and refreshed panel; current-order link; reallocation; lost confirmation; duplicate click; stale billet/company/user/role responses; unavailable versus empty options; 320/390/820/1440-pixel layouts.
- Pending: complete signed-in allocation-panel journey against the compatible staging schema, real-token role/RLS acceptance, independent-session contention and historical/physical material reconciliation. R23's isolated tests do not close R22's broader acceptance requirements.
- The existing lookup population still requires its separate compatibility/completeness investigation: temper and order/profile-production eligibility, repeated requirement/order options and API row caps are not certified by this lifecycle fix. No new incompatibility defect is declared without reproduction.
- A00 requires a dedicated staging application/project and staging-only user identities for its remaining replay/JWT/Storage/workflow checks. Do not reuse the configured business project or interpret the local safety-gate failure as a schema defect.
- Continue one issue at a time from `BUGS-MEGA.md`; keep local code closure distinct from hosted/operator acceptance. Do not reapply the already recorded 40 migration changes to address an acceptance-only status.

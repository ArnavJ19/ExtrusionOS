# R24: manual billet allocation options

Date: 20 October 2026 (Asia/Kolkata). Base: `12874da`; work branch: `codex/bugs-mega-allocation-panel`.

## Outcome and activation status

**OPEN: the local read/UI candidate is verified and has not been applied to Supabase.** R23's lifecycle fix remains covered; A00/R22 and the broader authenticated, concurrency, historical and physical-inventory gates remain open.

The R23 lookup could offer orders that the actual allocation writer rejected, omit valid normalized material, repeat an order for each matching profile and lose later records at the REST row cap. Six actual-panel/SQL reproductions fail against that source. The candidate keeps the existing allocation/reallocation writers and adds one read-only endpoint with paired UI support.

Migration: `supabase/migrations/20261020070000_manual_billet_allocation_options.sql`. It requires the reconciled chain including R21/R22. It is a prepared candidate, not a deployment/application record. Do not apply it as part of Git consolidation, or deploy this UI separately from its compatible reader.

## Behavior and security

The RPC derives company from the active database identity and requires owner, admin, factory manager, production manager or production. PUBLIC/anonymous execution is revoked; authenticated execution enters the same explicit role gate. The existing private production-eligibility helper remains unavailable to clients. No table, index, trigger, RLS policy, business writer or general table grant is changed.

Alloy/temper normalization and diameter equality match R22. Terminal stages are excluded. Dispatched requirements share R22's actual per-profile production-eligibility helper. Each order appears once, with counts from its matching eligible requirements. Database-side literal order-number search and stable ten-row pages include exact total count and clamped last-page metadata.

Stale counters, unlinked committed stock or inconsistent retained scope/material/production evidence produce an unavailable result requiring refresh or historical review. The reader does not repair links, refresh counters, allocate material or rewrite history. All returned labels and identifiers are company scoped; costs and commercial totals are omitted.

The shared TypeScript parser verifies billet/company identity, scalar header fields, unique order identities, eligibility status, nonnegative whole counts, count arithmetic and complete page metadata. The UI clears selection on search/page/scope change, ignores obsolete responses and retains R23's synchronous save lock and uncertain-result review. The RPC's fresh billet snapshot replaces a header that changed while loading. Missing schema displays an explicit database-update message; there is no capped-query fallback.

## Reproduction, tests and audit

- Initial baseline: six failures from six browser/SQL cases, including real writer rejection of the incompatible-temper request with unchanged stock. See `baseline.log`.
- New coverage: 78 checks, comprising 38 SQL (37 scenarios plus their enclosing case), 24 parser and 16 browser cases. The 30 R23 controls are retained. The earlier 105-check focused group predates the last three malformed-header cases; the final broad run includes all 108 related checks.
- SQL coverage: exact material normalization, distinct per-order quantities, five allowed roles and denied/missing/inactive/foreign identities, terminal and dispatched profile eligibility, literal metacharacters, malformed requests, stale counters, legacy links, unchanged snapshots, narrow catalog/ACLs and actual read-only execution.
- Volume coverage: 1,003 valid direct orders, 101 stable pages, exact counts, no duplicate/missing order IDs, a clamped oversized page and a repeated first page. Orders are created through the actual supported sales capture function, then read as owner. No trigger or guard is disabled. Sales capture avoids repeatedly invoking the owner path's company-wide priority allocator during setup; that unrelated path's scale/performance is not certified here.
- Browser coverage: all six original mismatches, next/previous pages, global search beyond page one, literal percent, stale successful/rejected searches, missing-RPC behavior, an intervening billet status change, role change and malformed initial headers. Captured reads use actual SQL JSON serialization; identities and transport remain synthetic.
- Source audit: company predicates cover every relation, the private helper remains closed, JSON output is an explicit operational projection, and no stock/financial writer body changes. Existing integrated masks/grants coexist with the reader. Schema contract and read-only deployment preflight now require this additional RPC.
- Styled QA: 16 R24 cases and 16 R23 regression cases pass at 1440, 820, 390 and 320 pixels with actual built CSS/fonts, zero page errors and no document overflow. Representative mobile last-page, tablet global-search and desktop unavailable images were inspected.

| Gate | Current result |
| --- | --- |
| Plain `npm test` on final source | **1,673 passed / 76 suites; zero failures/skips/cancellations**, `full-tests-verified.log` |
| Prior broad run | 1,672 passed / 1 failed, no skips/cancellations; `full-tests-final.log` |
| Final lint | Passed; `lint-final.log` |
| Final standalone typecheck | Passed; `typecheck-final.log` |
| Standard `npm run build` | Passed; 154 generated pages, `build-final.log` |
| R24 styled QA | 16 passed; `responsive/results.json` |
| R23 styled regression | 16 passed; `../billet-allocation-panel/responsive/results.json` |
| Final source/whitespace audit | Passed; tracked and newly created source/report files reviewed |

The prior broad failure was a two-second Playwright click timeout after the refresh button had already been found visible, enabled and stable. Build and many test files were running together. The appended concurrency argument was after the file pattern and did not bound the observed child processes. `package.json` now places `--test-concurrency=2` before the pattern, so normal `npm test` has the intended limit. No assertion or timeout was loosened, and no test was removed. The failure log remains retained.

The verification jobs survived an intentional interruption. Their live process trees were checked and the same jobs were observed to completion; they were not restarted merely because tool output was interrupted. Earlier redundant diagnostics were stopped only after their phase logs identified the same obsolete volume setup. Those partial runs are not counted as passes.

## Changed files

- Application: `components/modules/foundry/billet-allocation-client.tsx`; new `lib/workflow/billet-allocation-options.ts`.
- Candidate and deployment checks: new `supabase/migrations/20261020070000_manual_billet_allocation_options.sql`; `lib/deployment/schema-contract.ts`; `sql/audit-deployment-preflight.sql`.
- Integration and test runner: `scripts/test-audit-migration-integration.mjs`; `tests/audit-migration-integration.test.mjs`; `package.json`. The package lock and dependency declarations are unchanged.
- New tests and fixture: `tests/billet-allocation-options.test.mjs`, `tests/billet-allocation-options-reader.test.mjs`, `tests/billet-allocation-options-browser.test.mjs`, `scripts/lib/billet-allocation-options-fixture.mjs`.
- Existing R23 verification adapters: `scripts/lib/billet-allocation-browser-fixture.mjs` and `tests/billet-allocation-panel.test.mjs`; new `scripts/qa-billet-allocation-options.mjs` complements the existing R23 QA script.
- Register/report: `BUGS-MEGA.md` and this document. The earlier R23 report remains a historical checkpoint.

## Remaining boundary and consolidation handoff

No Supabase migration was applied and no hosted data, deployment, PR or shared `main` source was changed in this continuation. The current source is saved in a normal local commit for the authorized consolidation. Application use requires this candidate's compatible read endpoint; existing grants, policy and migration-history acceptance still require target-specific review and rehearsal. Fixture claims are synthetic; these checks do not establish real-token JWT/RLS, full PostgREST behavior, independent sessions, historical corrections, physical stock or measured billet adequacy.

The user authorized the consolidation chat to request completion of current checks, saving this work and stopping edits/processes in this worktree. The authorization was verified in chat `01a15848-d6f5-74f0-bae0-401bcc15e385`, titled `Consolidate trees into main`. That chat subsequently requested a normal commit after account access was restored. Do not start another issue or worktree before that consolidation handoff. Readiness and the exact inventory are recorded in `BUGS_MEGA_HANDOFF_2026-10-20.md`. No push, branch merge, deployment or migration application is performed here.

Portable copies of the baseline, focused and broad verification logs and all 32 current responsive screenshots are retained under [the evidence folder](evidence/BUGS_MEGA_2026-10-20/). The [passing complete-suite log](evidence/BUGS_MEGA_2026-10-20/R24/full-tests-verified.log), failed earlier broad log and corresponding build/lint/typecheck outputs are preserved separately. Original `test-results/` paths describe where commands ran; the portable copies survive checkout retirement. The earlier attempt to finalize this report stopped because automatic approval review could not complete after an account usage limit; no partial approval-bypassing write is counted as saved.

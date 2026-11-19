# Test and Performance Report

## Executed Checks

Commands ran in disposable Windows copies with Node 22.20.0 and npm 11.10.0. The primary copy includes the working source captured over `a82f10f`. The later focused copy includes working source over `5e2a0f6`. Live environment files were excluded. When necessary, local Chromium and Next workers were rerun with local process and loopback access. Typecheck preceded the production build.

| Check | Exit and result | Evidence |
|---|---|---|
| `npm run typecheck`, primary retry | 0, 165.49 s | [Typecheck](evidence/typecheck-retry.log) |
| `npm run lint`, primary retry | 0, zero errors and four unused-variable warnings in two test files | [Lint](evidence/lint-retry.log) |
| `npm run build`, primary retry | 0, 261.52 s, 245/245 static-generation steps. Next.js warned about old Browserslist data | [Build](evidence/build-retry.log) |
| `npm test`, primary isolated Chromium run | 1, 3,347 tests across 76 suites, 3,340 passed, seven failed, zero cancelled/skipped/todo, 1,558.57 s | [Full TAP output](evidence/test-isolated.log) |
| `node scripts/replay-migration-chain.mjs` | 0, 296/296 files and zero failures, 65.21 s | [Fresh replay](evidence/migration-replay.log) |
| Native PostgreSQL replay and concurrent counter | 0, 296/296 files, existing synthetic company retained. Replay 69.22 s. Distinct backend PIDs and correct numbering/rollback | [Native replay](evidence/postgres-native-final.log) |
| `node --test --experimental-strip-types --test-concurrency=1 tests/autopilot-batch3-sql.test.mjs tests/nov-upgrades.test.mjs` | 0, 36/36, 38.41 s | [Focused test output](evidence/focused-autopilot-november.log) |
| Independent factory, bank and stock fixtures | Confirmed negative cast residual, impossible chemistry, partial-issue refusal, dashboard reservation mismatch and bad payload zeros, and two bank import failures. Independent quote calculation matched | [Business checks](evidence/business-invariants-verified.log) · [Partial issue](evidence/partial-issue.log) |
| Independent packaging and quote-approval follow-up | 0, reproduced 100 m in inventory versus 0 m in packaging. Valid quote with a costed line approved, while the header-only fixture was correctly refused | [Reconciliation follow-up](evidence/reconciliation-followup-verified.log) |
| Chromium policy and built local app | Configured camera policy denied a granted synthetic camera. Built app signup redirected to login and missing-session scanner redirected to Account Unavailable. Login layout had no overflow at 375, 768 or 1280 px | [Browser policy](evidence/camera-policy.log) · [Built app](evidence/application-smoke-verified.log) |
| Later focused Batch 3 SQL/unit/browser and email tests | 1, 48/50, no skips. Both expired-quote browser checks failed to observe approval at 375 and 1280 px. Email template regression passed with the checked-in placeholder template | [Later focused results](evidence/later-candidate-focused.log) |
| `npm run typecheck`, later copy | 0, 129.46 s | [Later typecheck](evidence/later-typecheck.log) |
| `npm audit --json --registry https://registry.npmjs.org --fetch-retries=0 --fetch-timeout=15000` | 1 with advisories, 16 affected package entries including one critical, six high and nine moderate. Advisory applicability is assessed separately | [Registry output](evidence/npm-audit-retry.log) |

The first package copy was still settling when initial lint/typecheck/build checks began. Their dependency and worker-process failures were resolved by the isolated retries. The initial browser run found no Chromium in its default lookup path, and an explicit-path attempt could not access a localhost fixture. The initial full TAP run had 3,014 passes and 304 failures under those setup conditions. It is retained as a failed environment run and excluded from the primary pass/fail claim.

## Seven Failures in the Primary Isolated Run

| Failure | Disposition |
|---|---|
| Autopilot Batch 1 scheduled registry count | Stale whole-release expectation. The fixture observed ten nightly jobs rather than eight after the new registry entry. |
| Autopilot Batch 1 callable RPC list | Earlier exact allowlist omits intended Batch 3 commands. The observed mismatch merits updating the full-release expectation, with authorization checks retained. |
| Email webhook test | First capture excluded `.env.example`. The affected test passed with the placeholder template in the later capture. |
| Two NOV-002 pin tests | Timed out waiting for `Pin Orders`. The current controls are inside a collapsed `Pinned and recent work` disclosure. Existing tests attempt to click without opening it. This is stale fixture behavior by source inspection. |
| NOV-033 quality pack | Failed a broad serialized string check for `210`. The focused unchanged rerun passed. The string test is brittle because the JSON also contains dates and identifiers. These runs do not establish commercial data leakage. [Focused rerun](evidence/nov033-focused.log) |
| NOV Batch 9 migration inventory | `tests/nov-batch9.test.mjs:255` fails the assertion about the list of later migrations after the Autopilot additions. Native effective catalog replay passed. |

The later order-to-cash checks include actual React components backed by an isolated database fixture. A differential run used the same approval command and actor for an expired header-only quote and one with a valid costed line. The header-only case stayed expired with “Complete quotation item costing before confirmation.” The valid case returned approved and moved to sent. This explains the two failures as an invalid positive-path fixture. The report retains the original red browser result. [Differential result](evidence/reconciliation-followup-verified.log)

## Test Quality and Coverage

- Treat source-string assertions, filenames, mounted fixture interactions, ordinary PostgreSQL transactions and signed-in app runs as distinct evidence. The two Autopilot inventory assertions and the migration-ordering assertion show how whole-file expectations can go stale when modules are added.
- The isolated full run emitted ID-labelled outcomes for all 100 November features, with 351 feature-to-case associations after expanding shorthand IDs. A case can cover more than one ID. At least three labelled cases were available for 65 features. A labelled case count does not establish three distinct material edge cases or end-to-end execution for every feature. [Feature evidence](09_NOVEMBER_FEATURE_VERIFICATION.md)
- No complete signed-in role/Storage matrix, staging setup, mounted actual press/workstation process, historical financial reconciliation or statutorily approved output check was executed. The repository's `test:e2e:staging` command requires a separately approved bound staging environment and data.

## Performance and Concurrency

The dispatch readiness benchmark used 1,000 jobs, 10,000 inspections, 5,000 packaging rows and 10,000 materials. Over five local runs its baseline median was 264.241 ms. The indexed implementation median was 1.460 ms with equivalent results. This is in-process computation only. It excludes PostgreSQL, Supabase API, network, locks and cache behavior. [Benchmark](evidence/dispatch-readiness-benchmark.log)

Native two-session verification covered financial-year numbering and rollback. Dispatch and reservation races, press completion and issue, credit/settlement, and hosted query-plan or statement-timeout acceptance remain open. Browser timings under multiple concurrent test/build processes are unsuitable as plant performance figures.

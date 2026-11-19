# Test and Performance Report

## Baseline at `a0ef08d`

Run on the working copy with Node 22.20.0, 17:53 to 18:14 IST. Typecheck ran before build.

| Command | Exit | Result | Log |
|---|---|---|---|
| `npm run lint` | **1** | 1 error, 4 warnings. The error is in an earlier audit's script under `audit-output/`, not in the application (PA2-021). Application code: 0 errors, 4 unused-variable warnings in `tests/nov-batch8-sql.test.mjs` | [lint.log](evidence/lint.log) |
| `npm run typecheck` | 0 | Clean, 8 s | [typecheck.log](evidence/typecheck.log) |
| `npm test` | **1** | 3,374 tests: 3,372 pass, 2 fail, 0 skipped, 14 min | [test.log](evidence/test.log) |
| `npm run build` | 0 | Built, 2 min 38 s. The build rewrote `tsconfig.json` and `next-env.d.ts`; both were reverted | [build.log](evidence/build.log) |
| `npm audit` | 1 | 16 packages: 1 critical, 6 high, 9 moderate (PA2-006) | [npm-audit.json](evidence/npm-audit.json) |

The two failures are tests 1288 and 1289, both NOV-002 workspace pins (PA2-015). The earlier audit had seven failures at an older commit; five are gone.

The audit scripts added in this pass lint clean.

## Test quality

Each of the 352 test files was classified by what its assertions actually check ([test-quality.json](evidence/test-quality.json), [generator](evidence/test-quality.mjs)):

| Kind | Files | What a pass means |
|---|---|---|
| SQL behaviour through the replayed migration chain | 148 | The database logic does what the test says, as a low-privilege role, on PGlite |
| Unit behaviour | 130 | A function returns the expected value |
| Mounted-browser fixture | 36 | A real component, driven in Chromium, against a fixture database |
| Source-text only | 34 | A string exists in a file. **Proves nothing about behaviour** |
| Mostly source-text | 4 | Largely the same |

The 34 text-only files include several named for security or integrity behaviour (PA2-024): `access-invites-security`, `role-aware-sensitive-rls`, `dealer-boundary-hardening`, `onboarding-atomicity`, `invite-acceptance-integrity`, `server-owned-writes-regression`, `reservation-consumption-safety`, `financial-closure`. The behaviours they name were partly covered by this audit's own probes (sign-up, role escalation, dealer reads, direct writes); invitation reuse and expiry were not.

Other gaps:

- 14 configurator engine tests are outside the test glob and never run in CI (PA2-023). They pass when run by hand.
- No test drives a real Supabase Auth session or the real Storage API.
- No suite test uses two database connections; every concurrency claim in the suite is single-session. This audit added two-session tests for receipts and reversals only.
- The suite passed (apart from two pin tests) while six P1 defects existed, including cast mass, chemistry and partial-issue completion in modules that have their own test files.

## Independent tests added in this pass

| Script | Cases | Outcome |
|---|---|---|
| [security-probes.mjs](evidence/security-probes.mjs) | 85 role, RLS and catalog checks | PA2-001, 009, 016, 025; the rest held |
| [storage-probes.mjs](evidence/storage-probes.mjs) | 5 roles × read, delete, upload, rename | PA2-005 |
| [rpc-sweep.mjs](evidence/rpc-sweep.mjs) | 176 functions × 3 callers | No data returned to a stranger or suspended user |
| [finance-probes.mjs](evidence/finance-probes.mjs) | 31 receipt and reversal checks, two sessions | Held; PA2-020 minor |
| [quote-differential.mjs](evidence/quote-differential.mjs) | 600 random lines plus 9 boundaries | PA2-010, 017, 018; arithmetic otherwise agrees |
| [delete-probes.mjs](evidence/delete-probes.mjs) | 9 parents × owner and admin | PA2-022; the rest refused |
| Reruns of the earlier audit's three scripts | 9 reproductions | 5 still reproduce, 3 fixed, 1 control passes |

All of these are candidates to be turned into regression tests once the defects are fixed.

## Property and invariant testing

The 600-case quote differential is the only randomised test in this pass (fixed seed, reproducible). No `fast-check` properties were added for stock non-negativity, state-machine transitions or genealogy.

## Performance

**Not tested in this pass.** No synthetic volume was loaded, no query plan was read, and no timing was taken. The earlier audit's single in-process benchmark of dispatch readiness is the only figure on record and says nothing about the database. Source observations that bear on scale: 22 pages fetch 250 to 2,000 rows in one query, and two overview pages count from capped lists (MFA-012).

## Concurrency

Verified with two real sessions: racing receipts, racing identical receipts, racing reversals. Everything else — billet allocation, job completion, dispatch, reservation release, November command preview and commit, the credit gate — is unverified under concurrency.

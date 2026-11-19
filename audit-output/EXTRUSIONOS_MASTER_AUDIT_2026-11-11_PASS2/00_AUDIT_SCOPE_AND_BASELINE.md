# Audit Scope and Baseline (Pass 2)

**11 November 2026, Asia/Kolkata.** Second, independent pass over the same repository as the earlier same-day audit in `audit-output/EXTRUSIONOS_MASTER_AUDIT_2026-11-11/`. That directory is left untouched. This pass reran its reproductions at the newer commit and added adversarial probes it did not run.

The audit changed nothing in the application, the hosted database, Auth, Storage or deployment. Its only writes are this directory and disposable local databases.

## What was audited

| Item | Value |
|---|---|
| Working copy | `feat/autopilot-batch-3` at `a0ef08dd014b96325f6ba723ab9569e1207499c1` |
| Uncommitted source changes | None. Only `tsconfig.tsbuildinfo` (generated), evidence screenshots under `docs/evidence/`, and audit output differ from the commit |
| Other worktrees (not audited) | `codex/v1` at `3bd03b4`, `audit2/wave1` at `d530913`, `feat/upgrade-eos-calc-batch` at `0228e59`, one Claude worktree at `7de3985` |
| Brief's GitHub baseline | `main` at `0a5cc3d`; the working copy is newer and was treated as the authority |
| Hosted database | Supabase project AlExMS, PostgreSQL 17.6, read-only catalog queries and the security advisor |
| Tools | Node 22.20.0, npm 11.10.0, Next.js 16.2.11, native PostgreSQL 18 (disposable cluster on loopback), PGlite via the project's test helpers |

Inventory at this commit: 339 page files across 46 dashboard route families plus Auth and portal, 32 API routes, 296 migrations plus `schema.sql` and `rls.sql` (298 files replayed), 352 test files.

## How it was done

1. **Baseline.** Lint, typecheck, full test suite and production build, in that order ([10](10_TEST_AND_PERFORMANCE_REPORT.md)).
2. **Native replay.** All 298 SQL files replayed into PostgreSQL 18 with stand-ins for Supabase's `auth` and `storage` schemas. Each experiment ran in a clone of that template and was dropped afterwards.
3. **Low-privilege probes.** Every probe ran as the `authenticated` database role with a synthetic user's identity, never as a superuser: owner, admin, sales, accounts, production, quality, viewer, dealer admin, a suspended user, a user of a second company, and a signed-in account with no staff row.
4. **Two-session tests.** Racing receipts and reversals used two independent database connections.
5. **Hosted comparison.** Function bodies, policies, grants, the migration ledger, cron and storage configuration were read from hosted and compared with the replay.
6. **Rerun of the earlier audit's reproductions** at this commit.

## Limits that apply to every statement in this audit

- **No signed-in use of the real application.** Hosted has one real user and I am not permitted to enter credentials. No route was exercised through a real Supabase Auth session, and no file passed through the real Storage API. UI findings are from source, from the suite's mounted-browser fixtures, and from the earlier audit's built-app smoke checks.
- **Storage policies were tested against a stand-in schema.** The policy text is the same as hosted, but Supabase's own Storage service was not in the loop.
- **Synthetic data only.** No stock count, bank statement, weigh sheet or book of account was reconciled. Nothing here estimates a real loss.
- **PostgreSQL 18 locally, 17.6 hosted.** No behaviour difference was observed, but the versions are not identical.
- **Not every one of the 100 November features was individually attacked.** See [09](09_NOVEMBER_FEATURE_VERIFICATION.md) for what rests on the existing suite.
- **Engineering values were not derived.** Configurator deductions, alloy limits and QC tolerances need Omalco's approved specifications.
- **This report set was completed in a follow-up session.** The evidence was gathered between 17:53 and 18:18 IST; the first session ended before the reports were written. The follow-up re-read every log, spot-checked the cited source lines at the same commit, refreshed the hosted observations at 22:58 IST ([hosted-refresh.json](evidence/hosted-refresh.json)) and closed the function-parity question ([function-parity-closure.log](evidence/function-parity-closure.log)). The native PostgreSQL cluster was no longer running, so no probe was re-executed in the follow-up.

## Report index

| Report | Contents |
|---|---|
| [01](01_EXECUTIVE_SUMMARY.md) | Management answers and the ten highest risks |
| [02](02_COMPLETE_DEFECT_REGISTER.md) | Every finding with evidence, consequence and fix |
| [03](03_MODULE_COVERAGE_MATRIX.md) | One row per module: what was independently run |
| [04](04_CROSS_MODULE_INTEGRITY.md) | Workflows, lineage links and delete behaviour |
| [05](05_MATERIAL_AND_FINANCIAL_RECONCILIATION.md) | Metal, stock, packaging, dispatch and money |
| [06](06_SECURITY_AUDIT.md) | Sign-up, roles, RLS, storage, APIs, dependencies |
| [07](07_DATABASE_AND_MIGRATION_AUDIT.md) | Replay, catalog, hosted comparison |
| [08](08_UI_UX_AND_OPERATOR_AUDIT.md) | What could and could not be established about the interface |
| [09](09_NOVEMBER_FEATURE_VERIFICATION.md) | NOV-001 to NOV-100 evidence index |
| [10](10_TEST_AND_PERFORMANCE_REPORT.md) | Commands, results, test quality |
| [11](11_HISTORICAL_FINDINGS_REVALIDATION.md) | AP-001 to AP-043 current status |
| [12](12_REMEDIATION_ROADMAP.md) | Ordered fixes |
| [13](13_RELEASE_READINESS_DECISION.md) | Verdict and what would change it |

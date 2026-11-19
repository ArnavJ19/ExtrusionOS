# Audit Scope and Baseline

**11 November 2026, Asia/Kolkata.** Read-only forensic audit of the local ExtrusionOS source and approved hosted metadata. Reports and disposable test environments were the audit writes. The application source, business data, hosted policies, migrations, credentials and deployment settings were left intact by the audit.

## Source Checkpoints

| Checkpoint | Identity | Use |
|---|---|---|
| Primary captured working source | `feat/autopilot-batch-3` at `a82f10fe01e9cefcaceaa2f4e7a13084044c02f4`, including working edits | Main inventory, build, native/embedded database checks, full suite and independent reproductions. The capture recorded 100 modified paths and 11 untracked paths after excluding this audit directory. |
| Later captured working source | `5e2a0f6aded4e5f449e351a228c5fbdd54c15543` plus its captured working changes | Separate delta check and focused order-to-cash acceptance. Seven added page files take the route-file count to 371. Eight selected issue anchors, including both bank and cast SQL/logic, the stock snapshot and runtime lockfile, matched by SHA-256. |
| Local `main` at discovery | `caa0573cfcf214214ee4cd8278fd76e9a3de029c` | Comparison point |
| Local `codex/v1` at discovery | `7de3985b59a70ef9f4324ea42d972bfc1eade96a` | Comparison point |
| Brief's GitHub baseline and latest production deployment record | `0a5cc3d62d8fd679dc3a3fdce06d9bbc158db627` | Release metadata and source comparison |

Git reported five worktrees at discovery, including the root, `codex-v1`, `audit2-wave1`, `eos-calc` and a Claude worktree. The recorded source baseline lists each path and commit. A concurrent commit advanced the root during the audit and incorporated some in-progress evidence under this dated directory. Its remote-tracking reference was observed. The audit did not stage, commit or push it. The two captures preserve the test boundaries while work continues in the source checkout. After the later capture, working edits touched additional order-to-cash UI, quote-extension error handling and older/newer Autopilot test expectations. Those edits are outside the executed results. [Baseline and status](evidence/baseline.json) · [Later capture](evidence/later-checkpoint.json) · [Source changes since capture](evidence/source-drift.json)

## Inventory and Tools

The primary capture inventoried 69 route families and 364 route files: 321 internal/home, 32 API, six Auth and five portal. It found 294 active migrations and 100 stable November IDs. Its 1,872 counted source/config/test files have 235,445 lines. The count excludes dependencies, generated output, historical evidence, archives and local credential/config files. The first count also classified `types/database.ts` separately with generated material. The later inventory counts that maintained type contract as source.

Node.js 22.20.0, npm 11.10.0, Next.js 16.2.11, PGlite 0.5.8, native PostgreSQL 18.3 and linked hosted PostgreSQL 17.6 were identified. The repository's CLI marker reads Supabase v2.121.0. A runnable Supabase CLI was unavailable on the shell path. The audit used database replay stand-ins, an isolated native PostgreSQL cluster, local Chromium fixtures and authenticated provider metadata queries. It excluded live credential files from test copies and used a placeholder endpoint for build/route smoke checks. The copied `.env.example` for the later focused tests contains an example sender and empty credential fields.

Evidence levels are inventory, source trace, embedded SQL, native SQL, mounted browser fixture, built local app, provider metadata, authenticated staging, and physical or financial sign-off. The last two remain open. The graph and lexical inventory are navigation aids. They do not prove that every dynamic dispatch or policy was read, and all routes and 100 feature IDs were not individually exercised in a genuine Auth-backed environment. See [test and performance boundaries](10_TEST_AND_PERFORMANCE_REPORT.md).

## Report Index

| Report | Contents |
|---|---|
| [01 Executive Summary](01_EXECUTIVE_SUMMARY.md) | Operational assessment and ten highest-risk observations |
| [02 Defect Register](02_COMPLETE_DEFECT_REGISTER.md) | Reproductions, source evidence, severity, fixes and regression proposals |
| [03 Module Coverage](03_MODULE_COVERAGE_MATRIX.md) | One row per route family plus machine-readable modules and dependencies |
| [04 Cross-Module Integrity](04_CROSS_MODULE_INTEGRITY.md) | Transaction boundaries and bidirectional lineage |
| [05 Material and Financial Reconciliation](05_MATERIAL_AND_FINANCIAL_RECONCILIATION.md) | Stock, foundry, dispatch, receipt and costing control bases |
| [06 Security](06_SECURITY_AUDIT.md) | Auth, RLS, Storage, APIs, dependency and hosted configuration evidence |
| [07 Database and Migrations](07_DATABASE_AND_MIGRATION_AUDIT.md) | Native/embedded replay, type boundaries and hosted ledger comparison |
| [08 UI and Operators](08_UI_UX_AND_OPERATOR_AUDIT.md) | Route inventory, executed evidence and device/role acceptance gaps |
| [09 November Features](09_NOVEMBER_FEATURE_VERIFICATION.md) | NOV-001 through NOV-100, per-ID source and execution evidence |
| [10 Test and Performance](10_TEST_AND_PERFORMANCE_REPORT.md) | Commands, counts, failures, benchmark and concurrency scope |
| [11 Historical Findings](11_HISTORICAL_FINDINGS_REVALIDATION.md) | October AP-001 through AP-043 |
| [12 Remediation](12_REMEDIATION_ROADMAP.md) | Sequencing, dependencies and regression targets |
| [13 Release Decision](13_RELEASE_READINESS_DECISION.md) | No-go criteria and evidence required to change the decision |

Machine evidence includes [source inventory](evidence/source-inventory.json), [routes](evidence/routes.json), [modules](evidence/module-inventory.json), [dependency index](evidence/dependency-index.json), [SQL declarations](evidence/sql-object-index.json), [November details](evidence/november-coverage.json) and [hosted release metadata](evidence/hosted-release-metadata.json).

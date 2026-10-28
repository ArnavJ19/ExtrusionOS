# ExtrusionOS ERP Audit — Pass 2 (22 October 2026)

An independent, adversarial business-logic audit of the system as deployed after the 20 October audit (EXOS-AUD-001…033) was fully remediated.

**Nothing was modified:** no application source, migration, configuration or hosted record. Hosted access was read-only `SELECT`s against `pkawmdxtmsdgigsehcmb` (ledger 126).

## Package

| File | Contents |
| --- | --- |
| `01_EXECUTIVE_SUMMARY.md` | Verdict, top risks, blockers, business decisions, verified vs uncertain |
| `02_DEFECT_REGISTER.md` | EXOS-AUD2-001…022 plus IMP items and the negative controls |
| `03_CROSS_MODULE_INTEGRITY.md` | Flows A–H re-assessed after remediation |
| `04_TRACEABILITY_REPORT.md` | Genealogy status and the new breaks |
| `05_COVERAGE_MATRIX.md` | Module coverage for this pass |
| `06_REMEDIATION_ROADMAP.md` | Waves 1–4 |
| `07_REGRESSION_TEST_BLUEPRINT.md` | Before/after gates per finding |
| `harness/` | Current-state replica, scenarios, catalog dumps, results |
| Architecture map | Unchanged from `../EXOS_ERP_AUDIT_2026-10-20/08_ARCHITECTURE_MAP.md`. Changes since: the casting-result and chemistry tables, `production_billet_issues`, `material_dispositions`, `accounting_period_locks`, the operator workflow tables (`20261022000000`), and the duplicate stock records listed in report 3 |

## Method

1. **Rebuild the hosted state.** The replica is the 21 Oct post-Wave-1 snapshot (`../EXOS_ERP_AUDIT_2026-10-20/harness/live-20261021`) plus every migration hosted applied afterwards, in ledger order (`harness/current-db.mjs`).
   - **Fingerprint check:** md5 over the bodies of 386 functions, 598 policies and 324 triggers. The replica and hosted are **identical**:

     | Kind | Count | Hash |
     | --- | --- | --- |
     | fn | 386 | `ec0062908919b5cd9a135563683d5a33` |
     | pol | 598 | `27a7b0b670c5d82d23173f4c9b671d70` |
     | trg | 324 | `6a7128ad9f0d22eba6aafa36ec7d2c45` |

2. **Dump the live catalog** to `harness/current/` (functions, triggers, policies, constraints, grants, columns) for static review.
3. **Inventory every client-writable table**: the write policies, delete paths, audit triggers and cascades.
4. **Execute scenarios** as PostgREST `authenticated` users under live RLS and triggers (`harness/r01…r08`).
5. **Query hosted (read-only)**: data state, storage policies, time zone, role settings, and the migration ledger compared against git.

## Re-running

From the `codex/v1` worktree root (needs the `@electric-sql/pglite` dev dependency):

```bash
node audit-output/EXOS_ERP_AUDIT_2026-10-22/harness/current-db.mjs --fingerprint
```

```bash
STMT_TIMEOUT=90s ONLY=cd node audit-output/EXOS_ERP_AUDIT_2026-10-22/harness/r01-owner-direct-writes.mjs
```

Each `rNN-*.mjs` prints labelled lines. The saved outputs are in `harness/results/`.

**The first run builds `harness/cache/current-seeded.tar.gz`** (about 4–8 minutes). Later runs load it in seconds. Delete the cache after applying new migrations.

## Limits

- PGlite emulates `auth.uid()`. There is no PostgREST, Storage engine or concurrent sessions.
- Hosted contains test data only (1 company, 10 orders, 1 job), so physical accuracy cannot be reconciled against a real plant.

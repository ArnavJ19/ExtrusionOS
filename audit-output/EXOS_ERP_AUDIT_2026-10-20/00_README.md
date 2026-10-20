# ExtrusionOS ERP Audit — 20 October 2026

An independent, adversarial business-logic audit. **No application source, migration, configuration or hosted record was modified.** Only read-only catalog and aggregate queries were run against the hosted Supabase project `pkawmdxtmsdgigsehcmb`.

## Package

| File | Contents |
| --- | --- |
| `01_EXECUTIVE_SUMMARY.md` | Verdict, top risks, go-live blockers, business decisions, unverified areas |
| `02_DEFECT_REGISTER.md` | 33 findings (EXOS-AUD-001…033) with evidence, plus a missing-functionality table |
| `03_CROSS_MODULE_INTEGRITY.md` | Flows A–H, synchronization points, upstream-edit hazards |
| `04_TRACEABILITY_REPORT.md` | Genealogy link table, forward/backward tests, data-model corrections |
| `05_COVERAGE_MATRIX.md` | Per-module coverage, tests, gaps |
| `06_REMEDIATION_ROADMAP.md` | Waves 1–4 |
| `07_REGRESSION_TEST_BLUEPRINT.md` | Before/after scenarios per finding |
| `08_ARCHITECTURE_MAP.md` | Deliverable A: module inventory, sources of truth, dependency map |
| `09_REMEDIATION_STATUS.md` | Wave 1 candidates (009, 002, 003, 008, 011, 010, 007), gate results, pre-application steps |
| `harness/` | Reproducible PGlite replica of the live catalog, reproduction scripts and `gate-wave1.mjs` |

## Method

1. Repository discovery: docs, `BUGS-MEGA.md` (to avoid duplicating the R/A–F/S/BL/Astra/finance findings), app routes, server actions, the generic record form.
2. Live catalog capture: function definitions, triggers, constraints, RLS policies, grants (`harness/catalog.json`, `security.json`, `live_functions.sql`, `live_constraints.txt`).
3. Static review of the live bodies for every stock, production, quality, dispatch and finance writer.
4. Execution: the catalog rebuilt in PGlite (0 statement failures), synthetic tenant seeded, scenarios run as `authenticated` under live RLS.

## Re-running the evidence

From the `codex/v1` worktree root (needs the installed `@electric-sql/pglite` dev dependency):

```bash
node audit-output/EXOS_ERP_AUDIT_2026-10-20/harness/repro-01-foundry-scrap.mjs
```

```bash
node audit-output/EXOS_ERP_AUDIT_2026-10-20/harness/repro-02-production-dispatch.mjs
```

```bash
node audit-output/EXOS_ERP_AUDIT_2026-10-20/harness/repro-03-controls.mjs
```

```bash
node audit-output/EXOS_ERP_AUDIT_2026-10-20/harness/repro-04-outsourced-billets.mjs
```

```bash
node --no-warnings --experimental-strip-types audit-output/EXOS_ERP_AUDIT_2026-10-20/harness/repro-05-app-reservation-packing.mts
```

Saved outputs: `harness/results/*.txt`.

## Limits of the harness

- PGlite runs the live bodies, constraints, RLS and grants, but not Supabase Auth, PostgREST or Storage. `auth.uid()` comes from a session setting.
- Seeds use `session_replication_role = replica` to create the starting state. Each scenario then runs with every trigger live.
- The catalog snapshot is from 20 October 2026 (86 ledger rows). The three unapplied worktree candidates (`20261020120000`, `20261020142106`, `20261020162949`) are **not** included. None of them changes the reproduced behavior.

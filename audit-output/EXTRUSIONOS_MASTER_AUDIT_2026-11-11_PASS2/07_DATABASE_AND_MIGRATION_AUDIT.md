# Database and Migration Audit

**Verdict.** The migration chain replays cleanly, and the hosted database runs the same function code as the repository. Two things are out of step: hosted carries one protective change the repository lacks (PA2-009), and the hosted ledger cannot be matched to repository files by name or version.

## Replay

| Check | Result |
|---|---|
| Fresh native PostgreSQL 18 replay | 298 of 298 files, no errors, 13 s |
| Fresh PGlite replay (inside the suite) | Passed as part of `npm test` |
| Upgrade from an older schema with existing data | **Not run in this pass.** The earlier audit ran one pre-November upgrade with a synthetic company and it passed |
| Replay against a copy of real hosted data | Not run; not permitted |

A clean replay proves ordering and syntax. It does not prove that a new constraint would accept historical production rows.

## Catalog (native replay)

516 public tables, all with RLS; 806 policies; 856 definer functions, all with a pinned `search_path`; 115 tables locked to end users entirely. Detail in [06](06_SECURITY_AUDIT.md).

## Hosted versus repository

| Item | Result | Evidence |
|---|---|---|
| Function inventory | 1,097 on hosted, 1,097 on the replay; none missing either way | [hosted-vs-local-functions.json](evidence/hosted-vs-local-functions.json) |
| Function bodies | **Identical code for all 1,097.** 63 differ only in comments or line endings; the last three were confirmed by hashing with comments and whitespace removed | [function-parity-closure.log](evidence/function-parity-closure.log) |
| Autopilot batch 3 and `ap_cash` | Present on hosted. The earlier audit's "absent" observation is superseded | [hosted-refresh.json](evidence/hosted-refresh.json) |
| Scheduled jobs | 3 `pg_cron` jobs active; 5 runs so far, all succeeded, last at 17:05 UTC | same |
| Single-company trigger | Enabled on hosted; no ledger entry carries the repository file's name | same |
| Onboarding grant | Revoked on hosted by `20261111064948 audit_revoke_self_service_onboarding`; **no such file in the repository** | PA2-009 |
| Migration ledger | 269 rows on hosted against 296 repository files. Hosted versions are apply-time timestamps and many repository files were applied in parts, so no row matches a file by version | same |
| Policies, grants, triggers, constraints, indexes | **Not diffed.** Only functions were compared exhaustively. The `app_users` and storage policies were compared by name and match | — |
| Storage bucket settings | No size or type limits (PA2-019) | same |

Because function bodies match, results of the SQL-level probes in this audit carry over to hosted logic. Policy-level results carry over only for the policies checked by name.

## Deletes and foreign keys

Many lineage parents have `ON DELETE CASCADE` children on hosted: an invoice takes its items and payments; an order takes its lines, jobs and stage history; a foundry batch takes its billets, cast results and chemistry tests; a quote takes its items and revisions ([hosted-refresh.json](evidence/hosted-refresh.json)). What stops this in practice is a separate layer of triggers and missing delete policies, tested here as owner and admin:

| Parent | Delete attempt | Protected by |
|---|---|---|
| Invoice | 0 rows | No delete policy |
| Production job | 0 rows | No delete policy |
| Dispatch (dispatched) | Refused | Trigger, clear message |
| Foundry batch | Refused | Trigger, clear message |
| Profile with jobs | Refused | Trigger, clear message |
| Customer with quotes | Refused | Foreign key |
| Order | Refused, but with `permission denied for schema auth` | Probably a trigger that reads `auth` and trips on the stand-in schema. Refusal on hosted is **unverified** |
| Sent quote | **Deleted** | Nothing (PA2-022) |
| Die with no history | Deleted | Acceptable for an unused die; a die with production history was not tested |

The protection is real but indirect. A future migration that adds a delete policy to `invoices` or `production_jobs` would silently enable cascading loss of payments or billet issues. Changing those cascades to `RESTRICT` would make the protection structural.

## Types

`types/database.ts` is a hand-maintained subset. Typecheck passing therefore says nothing about whether the app's queries match the schema. Not re-examined in this pass.

## Release gates

1. Put the hosted-only revoke into the repository.
2. Record, for each release, the commit, the Vercel deployment and the hosted ledger position together. Today that mapping exists only in memory and notes.
3. Diff policies and grants hosted versus replay, the way functions were diffed here.
4. Rehearse the chain against a copy of real data before the first migration that adds a constraint to a populated table.

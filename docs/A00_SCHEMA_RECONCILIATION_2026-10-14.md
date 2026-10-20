# A00 schema reconciliation: local fixes and open acceptance

Date: 14 October 2026, Asia/Kolkata.

## Outcome and scope

Read the complete `BUGS-MEGA.md`. A00 is its only confirmed unresolved finding;
the four investigations are explicitly unconfirmed and the acceptance gates are
separate from confirmed bugs. Worked on A00 first and preserved existing local
remediation, historical migrations and the local-development/deployment boundary.

**A00 remains OPEN.** This continuation fixes local diagnostic defects and provides
an executable read-only migration-ledger comparison. It does not establish hosted
schema state, complete migration replay, real JWT/RLS/Storage behavior, independent
session concurrency, historical stock accuracy, authenticated UAT or deployment.

## Reproduction, fixes and audit

Before the diagnostic patch, new edge tests reproduced three failing groups:

1. A successful HTTP response containing an object, null or unexpected rows was
   marked as a verified column query without examining its JSON body.
2. The loopback exception admitted non-HTTP protocols, and URL-embedded credentials
   and empty API keys were not rejected before requests.
3. A successful response whose JSON parsing failed could still verify column access.

The checker now requires an empty JSON array for every zero-row column probe.
Malformed RPC path entries remain unavailable. HTTPS is required except for HTTP
on the three explicit loopback hosts. URL credentials and blank API keys reject
before any network request. Transport, parse and authorization failures retain
unavailable status and do not print returned details or credentials. RPC advertising
still verifies exposure only; it does not prove object absence, grants or execution.

The new ledger reconciler compares version/name metadata from a read-only SQL export
against every SQL migration file in this checkout. It preserves digit strings and
leading zeros, supports nameless legacy ledger rows, and flags local version
collisions, duplicate/foreign hosted versions, wrong names, pending migrations and
gaps before later applied versions. An unprovided or absent ledger remains unavailable
and does not invent a list of unapplied migrations. A metadata match explicitly leaves
baseline schema/RLS, migration contents, replay, grants and workflows unverified.

The SQL export uses `BEGIN TRANSACTION READ ONLY` and `ROLLBACK`. It returns only
versions/names, including a legacy table with no name column. A missing ledger fails;
it is not interpreted as empty history. The local CLI does not load credentials,
connect to a database, execute migration SQL or write files.

## Migration inventory and current blockers

The inventory has 149 SQL files and 137 distinct migration versions. These seven
versions collide:

| Version | Files sharing the version |
| --- | --- |
| `0032` | enterprise phase 23 security; profile stock consumptions |
| `0034` | enterprise phases 23/24 hardening; security audit fixes |
| `0036` | production job numbering; phases 5 to 10 operational hardening |
| `0055` | billet inventory/outsourced billets; machines/foundry enhancements |
| `20260511` | quote engine; terminology/stages |
| `20260512` | audit; RLS; operational depth; quality/dispatch; financials/analytics |
| `20260513` | enterprise foundation; hardening; quotation assistant; AI provider |

The CLI prints the exact filenames. A single hosted version row cannot prove that
all scripts sharing that identifier ran. Do not rename historical migrations, repair
the hosted ledger, or apply the newest follow-up in isolation before comparing the
actual history and reviewing the prerequisite chain.

The fresh hosted REST probe returned unavailable for all 29 checks (17 RPCs and
12 columns). No current presence/absence conclusion is established. Docker's database
engine is unavailable, no dedicated staging configuration is present, and the
Supabase plugin is available but not installed/connected. No hosted schema/data write,
production migration or deployment occurred.

## Files and verification

Created:

- `lib/deployment/migration-ledger.ts`
- `scripts/check-migration-ledger.mjs`
- `sql/export-migration-ledger.sql`
- `tests/migration-ledger.test.mjs`
- This report.

Modified:

- `lib/deployment/schema-contract.ts` (retained its existing dealer-stock RPC check)
- `tests/deployment-schema-contract.test.mjs`
- `BUGS-MEGA.md`

No database migration, RLS policy, grant, business workflow or UI change was added.
Existing user-owned changes were retained. TypeScript updates its generated build info.

| Check | Result |
| --- | --- |
| Baseline `npm test` | 683 passed, no failures |
| New diagnostic reproduction | Three failing edge-test groups before the repair |
| Focused REST diagnostics | 11 passed, including actual CLI requests against local HTTP servers |
| Ledger/SQL checks | 14 passed; includes 150 deterministic property cases and outer-transaction protection |
| Invoice PDF regression | Three passed; tenant/permission, unavailable-query and historical-snapshot checks retained |
| Final `npm test` | 705 passed, 76 suites, zero failures/skips/cancellations; 22 additional tests over baseline |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed with no warnings/errors on the final implementation and tests |
| `npm run build` | Passed; 153 static pages generated |
| `git diff --check` | Passed; new/untracked files also checked for trailing whitespace |
| Local ledger CLI | Expected exit 1: unavailable hosted ledger, with seven collision groups reported |
| Hosted read-only REST probe | Expected exit 1: all 29 checks unavailable; no current schema conclusion |

HTTP integration runs the actual existing hosted CLI with synthetic keys against
an ephemeral loopback server. It verifies GET-only requests, `limit=0`, no RPC calls,
explicit `--hosted` opt-in, correct key headers, refusal to follow redirects and
suppression of remote response details. It does not exercise real Supabase.

SQL integration runs the actual export in isolated PGlite PostgreSQL instances.
It tests padded versions, named/nameless ledgers, absent catalog failure, metadata
redaction and an injected accidental INSERT rejected by the read-only transaction
with the ledger unchanged, both standalone and inside an existing outer transaction.
The initial outer-transaction test setup was corrected to commit fixture tables before
opening the transaction; the corrected test and final full suite passed. These checks
do not constitute the full Supabase migration replay.

## Continuation and acceptance

1. Obtain catalog access to the intended hosted database and a separate disposable
   staging project. Run `sql/export-migration-ledger.sql` with a catalog-capable role;
   retain only its metadata JSON result. Do not share API keys/passwords in reports.
2. Run the local comparator with that JSON export:

   ```powershell
   node --no-warnings --experimental-strip-types scripts/check-migration-ledger.mjs --ledger path-to-export.json
   ```

3. Review every collision, unexpected hosted version, name mismatch and missing
   prerequisite against actual source history. Verify the initial `supabase/schema.sql`
   and `supabase/rls.sql` baseline separately; these are outside the versioned ledger.
   Establish the complete application order before making a migration plan.
4. Rehearse the reviewed prerequisite chain on disposable Supabase staging. Run
   `sql/audit-deployment-preflight.sql`, `sql/foundry-material-preflight.sql` and
   `sql/factory-workflow-preflight.sql`. Inspect actual effective policies, grants,
   function signatures/bodies and historical-data conflicts.
5. Verify authenticated invoice download with issued party snapshots, atomic
   configurator save/quote handoff, and dealer receipt submission. Include intended
   roles, denied roles, suspended users, sibling dealers and another company. Verify
   rollback/idempotency and separate-session races at their transaction boundaries.
6. Mark A00 fixed only after the register's staging, catalog/grant and authenticated
   workflow criteria pass. Record any later deployment as separate evidence.

To inspect the current inventory without any database access:

```powershell
node --no-warnings --experimental-strip-types scripts/check-migration-ledger.mjs
```

Its nonzero exit without a ledger is deliberate. No database history has been inferred
from the local inventory or REST visibility, and no historical migration was renamed.

# Audit remediation: 8 October 2026

## All-findings continuation

The user extended the scope to every remaining finding in this report. All five
outstanding audits were reread in full. GPT-6 Luna implementation lanes and the
GPT-6.1 Sol primary reviewer/orchestrator continue this work. There are 30
remaining audit IDs, representing 29 root causes because C01 and F03 overlap.

Checked tasks below mean the stated work is complete with recorded evidence.
They do not imply hosted deployment, authenticated UAT, historical inventory
reconciliation or independent-session contention have been completed.

- [x] Read all six original audit reports and the remediation report.
- [x] Complete and locally verify S01-S03 foundry material-integrity fixes.
- [x] A00 local: add a read-only REST/schema contract checker and catalog preflight; return HTTP 503 for invoice query/schema failures instead of a false 404; six focused tests pass.
- [ ] A00 hosted: reconcile migration ledger, deploy prerequisites plus reviewed fixes, and verify RPC/column exposure and signed-in permissions.
- [ ] A01: enforce sibling-dealer ownership at the complete effective core RLS boundary.
- [ ] A02: enforce role-safe writes and deny suspended/read-only accounts.
- [ ] A03: consume reservations and stock in one coherent locked transaction.
- [ ] A04: protect order commercial fields through authorized projections.
- [ ] A05: protect configurator costs/rates/amounts at the database and UI boundary.
- [ ] A06: generate configuration quotes atomically and idempotently.
- [x] A07 local: calculate realized profit after discounts, with explicit cost-markup and sales-margin denominators; focused tests and independent Sol review pass.
- [ ] A08: align narrowly scoped accounts costing/read access.
- [ ] A09: align reservation UI, action and database capability.
- [x] A10 local: one counted, sorted, ten-row server search covers GST and more than 50 related records; restricted-grant and real packaging job_id regressions pass. Independent Sol review also applied the access and search migrations together under authenticated roles.
- [x] A11 local: ten-row server pagination, exact count, search/status/system filters, stable sorting, loading and explicit unavailable/retry state; the 101st record and rendered failure tests pass; independent Sol review passed. Hosted view relationships remain an integration acceptance gate.
- [ ] B01: permit only remaining fulfillment after a partial shipment.
- [ ] B02: resolve rework once, preserving inspection history and released quantity.
- [ ] B03: authorize credit issue/reversal through secure public wrappers.
- [ ] B04: preserve every profile's fulfillment lineage and assembly commercial totals.
- [ ] C01/F03: enforce completion mass balance and freeze completed evidence on every write path.
- [ ] C02: reconcile remaining stock kg/pieces/metres with exact provenance.
- [x] D01 local: use actual shipment timestamps and physical packing kg; exclude pending and missing-evidence records from totals and on-time denominators.
- [x] D02 local: use Asia/Kolkata as-of cutoffs, including trends and QC timestamps; label plans-through-date and current-state balances explicitly.
- [x] D03 local: group customers by UUID and display an account identifier for matching names.
- [x] D04 local: exact shortage count precedes separately ranked five-row previews; hidden-51st and twenty-shortage cases pass.
- [x] D05 local: shared open-pipeline status/validity definition includes earlier still-open quotes and excludes drafts/lost/expired/converted quotes.
- [x] D06 local: count actual active jobs; label undelivered orders as backlog; chart one exclusive order-stage population; exact risk counts are separate.
- [x] D07 local: aggregate money and distinct buyers in PostgreSQL; 1,001-row regression passes beyond a simulated API cap.
- [x] D08 local: reject unavailable/stale snapshots, retain withheld values, flag incomplete shipment history, and suppress unsupported healthy conclusions.
- [ ] F01: lock and recheck current order/die/press eligibility at release/start.
- [ ] F02: replan held/ready work atomically while preserving physical evidence/history.
- [ ] F04: align factory-manager allocation and reallocation permission.
- [ ] Run integrated regression, lint, typecheck, build and independent Sol review after all fixes.
- [ ] Hosted acceptance: full migration rehearsal, real JWT/RLS/Storage matrix, historical-data reconciliation, independent sessions and operator/browser UAT.

Fresh A00 read-only check on 8 October still reports both invoice snapshot
columns missing and the configurator-save/dealer-receipt RPCs unadvertised. The
order-save and ready-dispatch RPCs are advertised. No business rows were read and
no hosted writes were made. The management connector remains UNAUTHORIZED and
requires reauthentication; REST exposure alone cannot establish its catalog or
migration ledger. A00 hosted closure remains pending.

Reporting implementation: `20261008040000_management_metrics_integrity.sql`,
dashboard/analytics pages, role-aware dashboard rendering and shared analytics
parsers/calculation helper. Functional acceptance applies the whole new migration
twice, tests exact metric populations and cutoffs, and executes allowed/denied
calls with real PostgreSQL roles plus synthetic business identities. It does not
replay every prerequisite or validate real Supabase JWTs. The financial collection
helper is deliberately stubbed in this fixture; the existing financial SQL control
is required separately. Independent Sol review passed the current reporting and
profit scope; integrated final gates remain pending as neighboring work continues.

## Initial foundry pass

The following sections retain the evidence from the completed first pass. The
continuation checklist and final verification record supersede its limited scope.

## Scope and decision

Read all six latest audit reports before choosing remediation scope. GPT-6.1 Sol
performed priority selection, implementation coordination and independent review;
two GPT-6 Luna agents implemented the SQL and application changes. The root
integrates the result and independently reruns verification.

Selected `SCRAP_BILLET_AUDIT_2026-10-07.md`: all three findings are P1 material
integrity failures at the same foundry boundary. They can create usable metal
without source debit or change the physical history of allocated/issued billets.
The selection preserves the user's request to finish the findings of one critical
audit first. It does not close the other audit reports.

| Audit read | Reported findings | Status in this remediation |
| --- | --- | --- |
| `AUDIT_2026-10-03.md` | Six P1, six P2 | Open; includes hosted schema mismatch and access failures |
| `BUSINESS_FLOW_AUDIT_2026-10-04.md` | Four P1 | Open |
| `RECONCILIATION_AUDIT_2026-10-04.md` | Two P1 | Open; C01 overlaps factory-control F03 |
| `DATA_TRUST_AUDIT_2026-10-04.md` | Two P1, six P2 | Open; D07 is conditional on the effective API row cap |
| `FACTORY_CONTROL_AUDIT_2026-10-04.md` | Three P1, one P2 | Open |
| `SCRAP_BILLET_AUDIT_2026-10-07.md` | Three P1 | S01-S03 implemented and locally verified; hosted acceptance pending |

Overall release/business sign-off remains **NO-GO**. The remaining access,
dispatch, production completion, workflow, reporting and hosted schema findings
are not addressed by a foundry migration.

## Finding outcomes

| Finding | Required behavior and implementation | Verification status |
| --- | --- | --- |
| S01: positive charge without source stock | Require a same-company usable source for each positive component; keep debit-on-plan semantics; apply source deltas atomically, including switching and cancellation of uncommitted plans | SQL acceptance and runtime schema/action checks pass |
| S02: surplus billets after count reduction | Permit count changes only while planned and uncommitted; cancel surplus planned rows while retaining history; restore numbers through planned expansion; reject changes after processing starts | Shrink, repeat, expansion and rollback checks pass |
| S03: issued/consumed mass rewritten | Freeze batch physical, source, mix and count inputs after planning; protect direct billet physical edits, identity, deletion, status regression and issued/consumed lineage | Parent/direct edits rejected; real allocation/reallocation controls pass |

Material inputs are editable during planning. Once a batch progresses beyond
planned, ordinary saves cannot change sources, mix, efficiency, alloy/temper,
density, billet dimensions, count or physical identity. Processing status can
advance; it cannot regress. Post-processing correction requires a separate
audited reconciliation workflow, which this patch does not invent.

Planned batches reserve source stock immediately, as before. A fully reserved
source may have `used` status; maintaining or reducing its own existing hold
must work without a second debit. Rejected/returned sources cannot justify a
new usable batch. Cancelling an uncommitted planned batch releases its hold;
casting cannot be undone into available raw source stock by an ordinary save.

## Files and security

New implementation artifacts:

- `supabase/migrations/20261008000000_foundry_material_integrity.sql`: additive follow-up enforcement using triggers and atomic source deltas.
- `lib/actions/foundry.ts`: authenticated, role-checked foundry save with the shared schema, server-derived company and database error propagation.
- `scripts/test-foundry-material-integrity.mjs`: local SQL acceptance using the entire new migration and selected existing functions/triggers.
- `tests/foundry-material-integrity.test.mjs`: SQL acceptance entry point for the normal test suite.
- `tests/foundry-source-validation.test.mjs`: source validation and server-action regression tests.
- `sql/foundry-material-preflight.sql`: read-only historical-data diagnostics.
- This remediation report.

Modified application files: `lib/validations/schemas.ts` and the foundry portions
of `components/modules/operations/record-form-client.tsx`. `package.json` and
`package-lock.json` pin the verified PGlite 0.5.8 runtime as a development-only
dependency so SQL regression does not depend on a local cache. Historical
migrations, original audit reports and original defect-reproduction scripts are
preserved.

No RLS policy is disabled or broadened. Trigger helpers have restricted execute
privileges and explicit search paths. Source lookups and changes are company
scoped; the server derives company identity from the authenticated session. No
service-role client or credentials are added to the browser. These source checks
do not establish hosted RLS or JWT behavior.

## Verification record

Baseline before the patch:

- `npm test`: 626 passed, zero failures, zero skips.
- `node --no-warnings --experimental-strip-types scripts/audit-20261004-foundry-scrap.mjs`: reproduced S01, S02 and S03; source-backed insert control passed.
- `node --no-warnings --experimental-strip-types scripts/audit-20261004-billet-allocation.mjs`: incompatible reallocation rejected; compatible reallocation refreshed both requirement/order counters.
- `npm run test:e2e:staging`: failed before browser/network work because staging E2E is disabled and isolated-fixture opt-in is absent.

Final independent root verification:

| Command/check | Result | Evidence boundary |
| --- | --- | --- |
| `npm test` | 641 passed; 69 suites; zero failed/skipped | Includes runtime schema/action tests and the SQL acceptance wrapper |
| `node --no-warnings --experimental-strip-types scripts/test-foundry-material-integrity.mjs` | Nine SQL acceptance groups passed | Entire new migration applied twice in a synthetic in-memory database |
| `npm run lint` | Passed | Whole-project ESLint |
| `npm run typecheck` | Passed | TypeScript compilation |
| `npm run build` | Passed; 153 static pages generated | Local production build |
| `node --no-warnings --experimental-strip-types scripts/test-business-logic-sql.mjs --astra` | 12 prior plus 13 Astra checks passed | Existing isolated SQL regression; not full schema replay |
| `npm install --ignore-scripts --no-audit --no-fund` | Passed | Pinned standard test runtime installed; lock diff limited to that dependency |
| `npm ci --dry-run --ignore-scripts --no-audit --no-fund` | Passed | Manifest/lock consistency; a full clean install was not performed |
| `git diff --check` | Passed | Tracked changes have no whitespace errors |
| `npm run test:e2e:staging` | Failed environment gate | Staging is disabled; no authenticated browser or live mutation ran |
| Final GPT-6.1 Sol review | Passed: local S01-S03 remediation; no actionable blockers found | Independent source, migration, test, evidence and artifact review |

The saved SQL checks cover missing/foreign/exhausted/unusable sources, both charge
components and pure mixes, delta accounting, source-switch failure rollback,
retries, rejection/return status preservation on refunds, planned shrink/expansion,
physical and identity edits, committed lineage, and helper execute restrictions.
They preserve canonical derived charge/mass values when callers supply forged totals.

Sol additionally ran independent in-memory probes without workspace edits:
deletion/cascade denial, parent/billet primary-key and source/batch identity spoofing,
consumed-to-cast downgrade with cleared links, direct planned-billet cancellation,
blocked-source progression, exact-exhaustion held-source progression without a
second debit, planned canonical code changes, and direct surplus-billet insertion.
All probes passed. Those supplemental probes are reviewer evidence rather than
additional saved acceptance groups; the normal SQL wrapper still contains nine groups.

The fixture loads actual selected calculation, lineage, availability-hook,
allocation repair, counter refresh, reallocation and priority-allocation functions.
Real allocation happens only after a batch becomes cast. Requirement generation
and notification delivery remain stubbed; this does not certify every FIFO or
allocation scenario. The preflight is executed against clean, deliberately
inconsistent and restored fixtures. Authenticated action tests use a mocked
Supabase boundary; fixture SQL authorization helpers use synthetic identity.

Original diagnostic scripts deliberately load older function bodies and assert
defective behavior; their exit 0 is not a post-fix acceptance result. No original
defect script was changed to make it report a pass.

## Historical data and deployment

Run `sql/foundry-material-preflight.sql` against disposable staging before release.
It reports missing/foreign sources, unusable source status, count disagreement,
billet/batch physical disagreement, committed children of cancelled batches and
source balances below zero or above their recorded receipt weight. It writes nothing.

An empty preflight result does not reconstruct historical source debits or restore
mass already rewritten in both parent and child records. Investigate against
physical inventory, source documents, allocations and production evidence. Do
not fabricate a source link or delete surplus committed material to clear a check.

Rehearse the full prerequisite migration chain plus the new migration in staging.
The selected local fixture does not prove a complete Supabase schema replay.
The earlier A00 hosted schema mismatch must be checked independently; applying
this migration alone cannot bring an older hosted schema into contract.

No hosted migration, business-data change, deployment, commit or PR is performed
in this remediation. Hosted authenticated grants/RLS, separate-session contention
and operator browser UAT remain unverified.

## Manual acceptance still required

1. Sign in as an allowed foundry role. Create a source-backed 25/75 planned batch; reconcile exact kg debits, billet count and per-billet mass. Reject missing, foreign-company, exhausted and rejected/returned sources through UI and direct API.
2. Shrink and expand an uncommitted planned batch; retained cancelled rows must not count as usable stock. Repeat saves and source switches; each balance change must occur once. Reject the second component and confirm the whole mixed-charge operation rolls back.
3. Progress through melting/casting. Reject source, mix, density, length, diameter and count edits; reject cancellation/regression after processing. Allocate, issue and consume billets; reject direct physical edits, deletion and stripping issued/consumed linkage while allowing compatible reallocation.
4. Run competing source reservations and allocation/batch edits in independent sessions. Verify failed contenders leave balances, identities and allocations unchanged, then retry safely.
5. Reconcile the controlled journey to production input/output/scrap and finishing/QC/packing/dispatch. The neighboring F03/C01, B01 and dispatch defects remain open and can still block that broader journey.

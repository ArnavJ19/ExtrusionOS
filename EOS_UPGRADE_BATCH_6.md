# EOS upgrade batch 6

Started: 29 October 2026. Final integration: 30 October 2026.
Status: all eighteen requested features are implemented and audited locally;
final checks passed on 30 October 2026. Hosted rollout is a separate step.

Catalogue: `UPGRADE_EOS.md`. Requested features: 19, 27, 29, 30, 31, 37,
52, 56, 58, 59, 60, 73, 75, 95, 96, 97, 98 and 100.

Development uses the existing `codex/v1` checkout. The starting commit is
`09b337b453c2ff3ff044c2d401b3569564c70b51`. Existing audit reports, logs,
helper scripts and earlier screenshots are unrelated and must be preserved.

## Delivery and verification register

Each entry records implemented behaviour, security boundaries, unit and
edge tests, SQL/browser evidence, audit fixes and remaining acceptance limits.
An entry is checked only after its relevant checks pass. Final lint,
typecheck, build and complete tests are additional batch gates.

| Feature | Implemented scope | Unit, edge and audit evidence |
| --- | --- | --- |
| 19 | Mapped accounting receipt CSV import with row failures and duplicate replay | Financial workflow SQL/unit/browser; no equipment/provider connection is claimed |
| 27 | Draft guidance, posted receipt reversal and separate receivable adjustment | Financial correction action tests, canonical ledger SQL and mounted UI |
| 29 | Separate partial production, packing, departure, billing and remaining units | Partial quantity trigger unit, core full-chain SQL, mounted order balances |
| 30 | Reviewed multi-order measured vehicle loads and selective release | Factory unit/SQL/browser, stale source/inactive vehicle/past date regression |
| 31 | Accessible machine/shift scheduling with maintenance and capacity guards | Factory unit/SQL/browser, overlap, overnight shift, stale confirmation |
| 37 | Capacity-informed delivery proposals with missing inputs and assumptions | Factory unit/SQL/browser, unavailable press capacity exclusion |
| 52 | Own-customer progress, safe document and version-bound responses | Safe projection units, authenticated SQL-role tests, phone/desktop component |
| 56 | Actual partial receipt, independent inspection, disposition, rework task and credit | Return units/full-chain SQL/browser, legacy stock/full-credit bypass attempts |
| 58 | PO, accepted receipt and supplier invoice matching with posting holds | Purchasing unit/SQL/browser; exact recovery, edited-match guard and page-two source reopening |
| 59 | Two-person canonical master review preserving source history | Master unit/SQL/browser; incompatible/foreign/stale review and live-profile hold |
| 60 | Isolated guided tasks and reviewed in-memory sample transaction ledger | Practice units and mounted form/replay/reset/network-isolation cases |
| 73 | Independent review after profile, quality, payment or evidence changes | Core SQL and schema units; completion retained, latest review supersedes old |
| 75 | Source-derived selected dispatch/invoice boundaries with completion holds | Core SQL and units; stale/newer hold, completed insert and reparent attempts |
| 95 | PO-derived partial receipts with actual accepted/rejected/held portions | Purchasing full-chain SQL and receiving form; future/precision guards |
| 96 | Eligible dispatch invoices with reviewed tax basis and immutable issue snapshots | Financial SQL, real action/SQL fixture with 1,201 lines and mounted eligibility |
| 97 | Grouped actual receipts, exact allocations and separate cash/credit totals | Financial SQL/browser; grouped and standalone duplicate-reference regressions |
| 98 | Reviewable UTF-8 supplier text/CSV proposals, exact source version and duplicate check | Purchasing parser/unit/SQL/browser; arbitrary PDF/image OCR is not configured |
| 100 | Version-bound reconciled configurator output and independent fabrication release | Real engine units, full-chain SQL, mounted approval retries and technical PDF labels |

## Delivery records

- [Operational controls](docs/EOS_BATCH6_OPERATIONAL_CONTROLS.md): 29, 52, 56, 59, 60, 73 and 75.
- [Factory planning](docs/EOS_BATCH6_FACTORY_PLANNING.md): 30, 31 and 37.
- [Financial workflows](docs/EOS_BATCH6_FINANCIAL_WORKFLOWS.md): 19, 27, 96 and 97.
- [Purchasing](docs/EOS_BATCH6_PURCHASING.md): 58, 95 and 98.
- [Configurator release](docs/EOS_BATCH6_CONFIGURATOR.md): 100.

## Audit repairs

The implementation was divided into workstreams with the `astra-orchestrator`
skill. The first configurator and review runs hit a usage limit; the root completed
that implementation and integrated the findings. A fresh read-only review then
checked the stable boundaries. It was a source review, not hosted acceptance.

| Finding | Result and regression |
| --- | --- |
| Forged receipt GUC could extend an existing grouped receipt | Replaced with private exact transaction/invoice/amount/request authorization; receipt, ledger and allocation totals checked |
| NULL event identity skipped duplicate standalone bank references | Standalone reference guard corrected; distinct-key duplicate refused and exact replay retained |
| Partial connected return could interleave with legacy disposition/full credit | Private authorizations and source caps cover both old and new writers; stock and proportional credit tests pass |
| Source review could be skipped through completed inserts or task reparenting | Completion/lineage trigger covers both paths and preserves prior completion evidence |
| Stale assigned bundle could disappear from editable candidates | Independent selective release retains other order assignments and performs no stock movement |
| Disabled press shifts inflated a delivery forecast | Capacity feed excludes inactive/unavailable presses |
| Case-varied UUIDs duplicated a supplier bill line | UUID comparison and unique line identity enforced |
| Draft correction changed a PO after child insertion | Parent/child replacement order corrected inside one transaction |
| Consolidated supplier blocked an existing open PO | Recorded PO supplier snapshot remains usable for existing receipt/bill work |
| Credit retry used the invoice date instead of its posting date | Replay uses the recorded payment date and exact reason |
| Tax projection could truncate a large invoice manifest | Tax basis fetched in complete bounded batches; actual 1,201-line action/SQL regression |
| Global catalogue counter invalidated unrelated quoted configurator work | Relevant rule fingerprint determines semantic validity; global counter remains a read-race detector |
| Live profile retirement stranded unfinished production | Approval remains proposed while source operational dependencies are unfinished; source stays active |
| Initial practice flow lacked transaction depth | Added reviewed quotation/GST, observed inspection splits, capped partial dispatch and a reset-bound sample ledger |
| Purchasing mutation failures could lose the retry request or leave the form busy | Exact command/upload retained with completion continuation; editing freezes for uncertain outcomes; thrown/result failures exercised offline |
| Purchasing overview hid records beyond its bounded list | Added server search, filters, sorting, ten-row database pagination and exact PO/bill source loading; second-page SQL regression |
| Editing a matched supplier draft still exposed posting for the saved version | Changed inputs require source review and hide rematch/post until the new draft is saved |
| PO receiving omitted explicit shortage and value distinctions | Full PO shows remaining physical delivery/acceptance and agreed-rate base values, without creating stock |
| Vehicle table minimum width expanded the page at phone width | Grid tracks/items and controls now shrink and wrap; styled regression proves contained horizontal scrolling at 375 px |

## Final verification

All required checks passed after the final mobile layout repair, 30 October 2026.
The `*-verified-final.txt` logs are the final command evidence.

| Check | Final result | Evidence file |
| --- | --- | --- |
| `npm run lint` | Exit 0, no errors or warnings | `lint-verified-final.txt` |
| `npm run typecheck` | Exit 0 after restoring build-generated metadata | `typecheck-verified-final.txt` |
| Production Webpack build | Passed TypeScript and generated 205 pages | `build-verified-final.txt` |
| Complete `npm test` | 2,842 passed / 76 suites; zero failed, cancelled or skipped | `tests-verified-final.txt` |
| Complete local schema replay | 282/282 files: two baseline files and 280 migrations; zero failures | `migration-replay-final.txt` |
| Styled desktop/phone captures | 24 captures: twelve views at 1280 and 375 px; no body overflow, runtime errors or outside requests | `visual-verified-final.txt`, `visual-checks.json` |

The feature-focused SQL/unit run passes 64/64. The purchasing/practice run passes
16/16, including five offline mounted purchasing tests. These runs overlap with
each other and the complete suite; their counts must not be added as distinct tests.
The final full suite includes the unit, edge, real SQL and mounted browser cases.

The visual run covers practice, configuration release, the customer portal, partial
order balances, source reconciliation, factory capacity, vehicle loads, purchase
entry, purchase receiving, supplier bill review, connected returns and invoice
eligibility. It additionally verifies that the phone bundle table scrolls horizontally
inside its card and remains within the viewport. Captures use real components,
production CSS and mocked actions; they are separate from signed-in operator UAT.

### Earlier checkpoints and audit corrections

The first broad run found five invoice test/fixture failures. The authorized tax
view and real writer fixtures were corrected without removing manifest-completeness
checks; the combined audit regression passed 48/48 and the final full suite is green.

Default-sandbox verification then hit filesystem `EPERM` and denied loopback access.
Its full run recorded 2,642 passes and 200 failures, including 194 explicit network
denials, two local CLI fixture-probe failures, two cascading finishing timeouts and
two parent-test failures. The local probe diagnostic recorded zero requests reaching
its fixture. Automatic approval review initially failed because its usage limit was
reached; a later scoped request was authorized and resolved those verification gates.

The first authorized full suite passed 2,842/2,842, but fresh styled captures exposed
a phone-width vehicle grid overflow. Grid items now shrink within their track,
pagination wraps, and the table retains usable inner scrolling. The expanded visual
run and a second complete 2,842/2,842 regression run passed after that repair.
Earlier logs remain intermediate evidence and do not override the final results.

## Files, migrations and security

The generated `docs/evidence/EOS_UPGRADE_BATCH_6/source-manifest.json` records the
exact source files and normalized-content digest. `commit-paths.txt` is the explicit
batch file manifest; unrelated pre-existing audit reports, logs, helper scripts,
old screenshots and build information are excluded.

The explicit batch contains 154 created files and 25 modified files, including
delivery records/evidence, twenty new test files and three updated test files.
It pins 118 source/dependency files with normalized-content SHA-256 digest
`713c2efd742c187139d0e054dde17f22d1f1ec3be2c63bde8c2ff5d9e3337378`.
Existing invoice/PDF, module entry, authentication and configurator paths are
extended incrementally. The manifest provides the complete created/modified path
inventory; pre-existing unrelated dirty files are outside it.

Eleven additive migrations are authored, from
`20261029110000_purchase_receipt_matching.sql` through
`20261029150000_configuration_output_release.sql`, including the separate
`20261029120002_vehicle_load_release.sql`. None is hosted-applied by this task.
Company-specific workflow tables enable RLS and revoke direct client mutations;
authenticated command functions derive company and role internally. Private
authorization tables and trigger helpers have no client grants. Portal documents
use explicit safe projections; issued invoices and reviewed output histories are
retained. The in-memory practice desk imports no business writer or external sender.

## Acceptance boundaries

All eleven authored migrations are additive forward migrations. Local replay, SQL role
tests, unit tests and browser fixtures are separate evidence layers. Hosted
migration ledger reconciliation, real JWT/Storage checks, independent database
sessions, physical equipment/stock trials and operator UAT remain separate
unless explicitly exercised and recorded here. No remote push, migration
application, provider transmission or deployment is implied by this batch.

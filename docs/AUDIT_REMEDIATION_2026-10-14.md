# Local audit remediation and verification

Date: 14 October 2026, Asia/Kolkata. Work started on 13 October.

## Scope and outcome

Reconciled all six October audit reports, the 8 October remediation tracker,
the earlier business-logic/ASTRA evidence, and the consolidated `BUGS-MEGA.md`.
The six October reports contain 33 finding IDs and 32 distinct root causes:
C01 and F03 describe the same production-completion authority gap.

The existing local audit implementations were retained and verified together.
This continuation repaired additional gaps in dealer fulfillment, reservation
availability, stock-unit accounting, and held-job release. All code-remediation
entries below have local regression evidence. A00's hosted schema reconciliation
is deferred: the user explicitly confirmed local development and instructed
that nothing be deployed. No hosted schema/data writes or deployment occurred.

Local verification does not certify hosted migration state, real Supabase JWTs,
Storage policies, independent-session contention, historical physical inventory,
or authenticated operator/browser UAT. Original audit reproducers remain unchanged;
they load older definitions and a successful reproduction is not a fixed-workflow pass.

## Finding register

| ID | Local outcome | Regression evidence |
| --- | --- | --- |
| A00 | Invoice query/schema failures return unavailable rather than false missing-record errors; schema/preflight diagnostics exist. Hosted reconciliation deferred. | `deployment-schema-contract`, `invoice-pdf-availability` |
| A01 | Effective core policies and projections preserve dealer and company ownership. Dealer availability/conversion also reject sibling dealers, including creator-based bypass attempts. | `access-projection-integrity`, `dealer-stock-availability`, `dealer-fulfillment-integrity` |
| A02 | Active-role write restrictions and protected workflow boundaries reject blind edits and suspended users. | `access-projection-integrity`, `dealer-fulfillment-integrity` |
| A03 | Dispatch consumption and remaining reservations reconcile atomically; available dealer stock subtracts remaining holds. | `factory-workflow-integrity`, `inventory-reservation-availability`, `dealer-fulfillment-integrity` |
| A04 | Operational order projections withhold commercial fields; legitimate fulfillment updates have narrow transaction authorization. | `access-projection-integrity`, `dealer-fulfillment-integrity` |
| A05 | Configurator cost/rate/margin fields are restricted in database projections and UI. | `access-projection-integrity`, configuration/PDF regression suites |
| A06 | Configuration quote generation is atomic and repeatable, with rollback on failed line creation. | `configuration-quote-integrity` |
| A07 | Realized profit includes discount and uses explicit markup/margin denominators. | `systems-costing-profit` |
| A08 | Accounts costing/read scope aligns with routes and projections without draft-write authority. | `access-projection-integrity`, `role-aware-access-usability` |
| A09 | Reservation capability aligns across UI/action/RLS; consumption totals are complete in bounded requests. | `access-projection-integrity`, `reservation-consumption-totals` |
| A10 | One counted, sorted, paginated search includes GST and uncapped related matches. | `operation-search-integrity` |
| A11 | Saved projects use ten-row server pagination with filters and explicit unavailable states. | `system-project-list` |
| B01 | Exact remaining order-line quantities permit further production after partial fulfillment. Dealer fulfillment preserves the full line target before deducting stock fulfillment. | `factory-workflow-integrity`, `production-order-eligibility`, `dealer-fulfillment-integrity` |
| B02 | Rework resolves once into approved/rejected children while retaining the original inspection. | `factory-workflow-integrity` |
| B03 | Authorized public credit-note wrappers issue/reverse the real selected ledger transaction. | `factory-workflow-integrity`, `financial-closure`, prior SQL controls |
| B04 | Multi-profile/repeated-profile assemblies retain cut snapshots, source lines, and commercial totals. | `configuration-quote-integrity` |
| C01/F03 | Generic writes cannot finalize production or change completed evidence. Authorized corrections preserve mass balance and reject downstream conflicts. | `factory-workflow-integrity` |
| C02 | Dispatch and dealer fulfillment decrement kg, pieces and metres coherently; unusable stock and insufficient metres cannot establish BOM readiness. | `factory-workflow-integrity`, `inventory-reservation-availability`, `dealer-fulfillment-integrity` |
| D01 | Shipment totals use actual movement timestamps and physical packing weight. | `management-metrics-integrity` |
| D02 | As-of cutoffs use India business time and exclude later events. | `management-metrics-integrity`, `advanced-analytics` |
| D03 | Customer aggregation uses account identity rather than display name. | `management-metrics-integrity`, `advanced-analytics` |
| D04 | Shortage totals precede limited previews, including hidden later records. | `management-metrics-integrity` |
| D05 | Open pipeline uses the defined valid/open quote population. | `management-metrics-integrity` |
| D06 | Actual jobs, order backlog and exclusive stage populations have distinct definitions. | `management-metrics-integrity` |
| D07 | Monetary/distinct-customer totals are database aggregates beyond API row caps. | `management-metrics-integrity` |
| D08 | Unavailable/stale sources do not produce unsupported healthy conclusions; stock consumption reads reject incomplete results. | `management-metrics-integrity`, `reservation-consumption-totals` |
| F01 | Release and start independently recheck current order, die and press eligibility. | Expanded `factory-workflow-integrity` with historical scheduling/status guards |
| F02 | Held replanning preserves status and floor evidence; controlled release permits ready only with a released slot. | Expanded `factory-workflow-integrity` with hold/resume and overlapping-slot cases |
| F04 | Factory-manager allocation/reallocation matches application authority and material compatibility. | `factory-workflow-integrity`, prior allocation controls |
| S01 | Positive foundry charge requires usable, company-scoped source stock. | `foundry-material-integrity`, `foundry-source-validation` |
| S02 | Batch count changes preserve valid billet inventory and reject committed changes. | `foundry-material-integrity` |
| S03 | Committed/issued/consumed physical input attributes cannot be rewritten through parent edits. | `foundry-material-integrity`, combined factory/foundry checks |

## Additional fixes in this continuation

1. Dealer stock availability now comes from one authorized scalar RPC. It includes
   usable free stock in reserved batches, subtracts only unconsumed holds, normalizes
   finish consistently, caps each profile/finish to demand, and excludes other dealers
   and companies. Reservation records and costs are not exposed to quote users.
2. The quote form disables submission while availability is loading, failed, or
   belongs to a different selected quote. It allows a verified below-minimum order
   to enter the existing consolidation queue. Earlier pending requests cannot overwrite
   the latest selection's result.
3. Reservation consumption reads use at most 500 IDs per request and retain all
   1,001 results in the regression. Missing/duplicate/foreign/malformed results fail
   closed. The totals RPC now enforces the same inventory-read role scope as its ledger.
4. BOM readiness requires usable kilograms and metres. Failed inventory queries
   surface an error instead of being interpreted as an empty stock list.
5. Historical production status and scheduling guards are installed in the factory
   fixture. Replanning retains actual output, pieces, metres, scrap and hold history.
   Release permits the held-to-ready transition only with the matching released slot.
6. Dealer/sales conversion performs exact whole-piece debits of weight and length,
   preserves full order-line quantity and exact quote lineage, and atomically updates
   fulfillment/manufacturing balances. Private transaction authorization permits only
   these physical balance fields; direct commercial/line edits remain protected.
   Rejected allocation rolls back order headers, lines, stock and authorization rows.

## Files and migrations

Created implementation files:

- `lib/orders/quote-fulfillment.ts`
- `lib/inventory/reservation-consumption.ts`
- `supabase/migrations/20261013000000_audit_workflow_followup.sql`
- `supabase/migrations/20261013010000_dealer_fulfillment_integrity.sql`

Created verification files:

- `scripts/test-audit-migration-integration.mjs`
- `scripts/test-dealer-fulfillment-integrity.mjs`
- `tests/audit-migration-integration.test.mjs`
- `tests/dealer-fulfillment-integrity.test.mjs`
- `tests/dealer-stock-availability.test.mjs`
- `tests/quote-fulfillment.test.mjs`
- `tests/reservation-consumption-totals.test.mjs`
- This report.

Modified the quote-to-order form, configurator BOM/quote pages and reservation action,
shared reservation readiness helper, deployment schema/preflight contracts, factory
SQL harness, and related regression entry points. The older remediation tracker and
consolidated ledger link to this verification record. `tsconfig.tsbuildinfo` is generated
by TypeScript. Earlier audit changes and the independently created ledger were retained.

Both new migrations are additive follow-ups. No existing table/column or historical
business record is dropped. RLS remains enabled. Restricted base-column privileges and
cost masks survive the integrated migration sequence. Private authorization state has
no anonymous/authenticated table access. Trigger helpers have restricted execute grants;
new read RPCs validate active company/role/dealer identity and have fixed search paths.

## Verification results

| Check | Result |
| --- | --- |
| Baseline `npm test` | 665 passed, one failed out of 666; stale nested-query assertion identified |
| Final `npm test` | 683 passed, zero failed/skipped/cancelled; 76 suites |
| `npm run lint` | Passed with zero warnings/errors |
| `npm run typecheck` | Passed |
| `npm run build` | Passed on the final source state; 153 static pages generated |
| `git diff --check` | Passed; no whitespace errors |
| Prior business/ASTRA SQL control command | 12 general plus 13 ASTRA checks passed |
| Integrated audit migration fixture | Eight full audit migrations coexist on historical table shapes; 17 authorized views and protected grants verified |
| Dealer conversion fixture | Actual converter/lineage/capacity/write guards run under authenticated SQL role via a fixture definer wrapper; allowed sales/dealer and negative probes pass |
| Hosted read-only contract probe | Unavailable; no current hosted schema conclusion established and no rows/writes performed |
| Staging E2E | Disabled environment gate; no authenticated browser or remote mutation ran |

The integrated fixture is not a complete replay of every prior migration: it creates
172 historical table shapes and loads selected real prerequisite functions. Individual
SQL suites exercise actual business functions and full follow-up migrations with
synthetic identities. Dealer-conversion acceptance uses a clearly named fixture wrapper;
it does not claim the complete dealer portal/browser wrapper flow was executed.

## Manual acceptance and remaining boundaries

For the next development acceptance session, verify these operator journeys:

1. Two sibling dealers and a second company cannot read/convert one another's records;
   operational users cannot retrieve commercial/cost columns and suspended users cannot write.
2. A source-backed foundry batch produces the expected billet count and mass; committed
   edits fail. Complete production with balanced input/output/scrap and verify downstream evidence.
3. Hold a partly worked job, cancel its slot, replan, release and resume. Block order,
   die and press separately before release/start; reject overlaps while preserving history.
4. Reserve stock, partially dispatch, check remaining kg/pieces/metres, then fulfill a
   dealer quote from free stock. Rejected requests must leave every ledger unchanged.
5. Generate/convert a repeated-profile assembly, resolve rework once, pack and partially/
   finally dispatch, invoice, receive payment, and issue/reverse a return credit.
6. Confirm all list/search/metric/error states through a signed-in local app at desktop
   and mobile widths, with more records than the API cap and injected unavailable sources.

Uniform batch-piece geometry is required for the dealer conversion's ratio-derived
metres. Fractional-piece requests are rejected; mixed cut lengths require explicit
physical stock/cutting provenance before acceptance. Historical batch reconciliation,
full prerequisite replay, real JWT/RLS/Storage checks, separate-session concurrency and
operator UAT remain distinct acceptance work. Deployment is deferred by user instruction.

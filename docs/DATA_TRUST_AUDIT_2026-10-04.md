# Deep audit: business meaning and displayed-data accuracy

Date: 4 October 2026. Fourth audit pass, focused on management reporting and whether labels, totals and alerts mean what an owner would reasonably understand them to mean.

## Assessment

The application has useful business controls, but the inspected dashboards are not yet dependable as the sole basis for production, shipment, purchasing or cash decisions. Correct formatting and passing unit tests do not establish that a metric represents the correct business event, population, date range or physical quantity.

This pass confirms seven metric defects/conditional failure scenarios and one additional source-verified failure-state presentation issue. Two positive controls also passed. These supplement the workflow and stock-reconciliation failures in the earlier reports. No fixes or hosted changes were made.

An overall percentage of business correctness would be misleading: there is no reconciled production-data sample, agreed denominator of business scenarios, or complete live role/UAT evidence. The evidence supports an explicit no-go for business sign-off, not an invented accuracy score.

## Findings

### D01 - P1: Pending dispatches count as shipped and on time

The analytics SQL does not select or filter `delivery_status` in `dispatch_rows`. It sums the dispatch header's weight and compares its entered dispatch date with the promised date, even when the record is still pending. The page labels the result `kg shipped MTD` and `Dispatch Performance`.

Executed scenario: one pending dispatch of 500 kg, dated October 3 against an October 5 promise. October 4 analytics returns **500 kg shipped and 100% on-time**, with no executed shipment in the fixture.

Business impact: management can believe goods have left the factory and delivery performance is healthy when the dispatch is only prepared. Counting pending manifests also inflates the trend.

Sources: `supabase/migrations/20260723080000_production_completion_analytics.sql:117`, `:206`; `app/(dashboard)/analytics/page.tsx:92`.

Required behavior: use an authoritative shipment event/status and actual event timestamp; distinguish prepared, shipped, delivered and returned quantities. An entered planning date is not proof of movement. Reconcile shipment totals with the stock-consumption/dispatch ledger, not only the dispatch header.

### D02 - P2: Month-to-date includes dates after the requested as-of date

The analytics RPC accepts `p_as_of`, but monthly aggregates use the first day of the following month as their upper bound. Thus the date acts as a month selector, not a true as-of cutoff. The main dashboard is less bounded: its monthly queries only specify the month's lower bound.

Executed SQL scenario: October 4 snapshot, a 1,000 order dated October 2, and a 9,000 order dated October 20. `bookedRevenueMtd` becomes **10,000 rather than 1,000**. Current order-save code accepts an order date without an observed future-date prohibition. Even if future dates were prohibited in one UI, historical as-of calls would still include later records in that month.

Business impact: MTD intake and comparisons can include business which had not occurred by the observation date. Full-month plans are legitimate, but must not be presented as the same time population as actual-to-date.

Sources: `supabase/migrations/20260723080000_production_completion_analytics.sql:82`, `:175`; `app/(dashboard)/dashboard/page.tsx:32`.

Required behavior: separate full-month plan, current MTD actual and historical as-of metrics. Apply explicit inclusive business-date or exclusive next-day boundaries consistently. Historical balances additionally require historical ledger reconstruction; date filtering alone does not reconstruct past receivables.

### D03 - P2: Separate customers merge when display names match

`top_customer_json` groups by the customer display-name expression rather than customer ID. Distinct customer records can share a trading name; no customer-name uniqueness constraint was found in the migration search.

Executed scenario: two customer UUIDs with the same company display name and separate orders become **one customer entry with two orders and their combined value**.

Business impact: concentration, account ownership and customer ranking can misidentify who bought the goods. This is a presentation aggregation defect, not evidence that invoice ownership changed.

Source: `supabase/migrations/20260723080000_production_completion_analytics.sql:352`.

Required behavior: group by stable customer ID, then attach a display label with a customer code/location when names collide.

### D04 - P1: Low-stock card can say Healthy while a shortage exists

The dashboard orders active items by absolute stock, takes 50, and only then checks each item's reorder level. It reduces the result again to five preview rows. The client uses the preview's length as the Low Stock headline and displays `Healthy` when it is zero.

Two executed page-orchestration scenarios:

- Fifty healthy items each have stock 1/reorder 0. A 51st item has stock 100/reorder 200. The shortage is never considered and the card receives **zero**.
- Twenty items are below reorder. The preview contains five, so the headline reports **five instead of twenty**.

Business impact: purchasing can miss a genuine shortage; urgency and attention totals are understated. Absolute stock balances across different items/units are not a valid shortage ranking.

Sources: `app/(dashboard)/dashboard/page.tsx:42`, `:56`; `components/modules/dashboard-client.tsx:39`, `:78`.

Required behavior: calculate the shortage population and exact count before pagination. Return a separately limited detail list ranked by shortage severity or coverage. Counts must never be inferred from preview length.

### D05 - P2: Pipeline Value includes lost and otherwise non-open quotes

The owner dashboard sums every quote created since month start with no status filter. Its card is labelled `Pipeline Value`. Advanced Analytics applies an open-status filter, so the two screens do not share the same business definition.

Executed scenario: one sent quote worth 200 and one `customer_rejected` quote worth 800. The owner dashboard supplies **1,000 as Pipeline Value instead of 200 open value**. Converted, expired and draft quotes also have no exclusion in that query.

Business impact: sales opportunity value can be overstated and appear to disagree between screens without an explanation.

Sources: `app/(dashboard)/dashboard/page.tsx:35`, `:49`; `components/modules/dashboard-client.tsx:84`; analytics open-status definition in `supabase/migrations/20260723080000_production_completion_analytics.sql:191`.

Required behavior: distinguish quotation activity value from open pipeline. Reuse one documented status/date/value definition across screens. Decide explicitly whether open pipeline includes prior-month quotes still awaiting a decision.

### D06 - P2: Readiness and status breakdown combine different, overlapping populations

`activeProductionStages` includes newly confirmed orders and payment-pending orders. `pendingDispatchCount` includes virtually every order not dispatched/delivered/closed/cancelled. The owner client describes these as `Jobs in production` and `Dispatch Ready`. The status donut adds those counts to monthly dispatch-record count and a delayed-order preview capped at five.

Executed scenario: one overdue, merely confirmed order with no production job or packing evidence contributes **one production count, one pending-dispatch count and one delayed count**. In the donut it contributes three observations. The dashboard is counting orders in the first two categories, not actual production jobs or ready dispatches.

Business impact: management cannot interpret the chart as a distribution of orders or use the readiness label to decide which truck can load. Monthly shipment records and current order backlog also have different time populations and units.

Sources: `app/(dashboard)/dashboard/page.tsx:11`, `:38-41`; `components/modules/dashboard-client.tsx:40`, `:85-86`, `:113`.

Required behavior: calculate readiness from production/QC/packing/stock prerequisites; use actual active jobs for a job metric. A distribution needs mutually exclusive categories over the same entity and period. Overlapping risk flags should be presented separately, with uncapped counts.

### D07 - P2, conditional: API row limits can truncate monetary totals while exact counts remain correct

Dashboard monthly orders/quotes and active customers are fetched as rows, summed or deduplicated in JavaScript, and are not paged to completion. Requesting `count: exact` does not guarantee the returned row array includes every matching row.

Executed adapter scenario with an explicitly simulated 1,000-row API cap: 1,001 orders worth 100 each. The query reports exact count **1,001**, while the page sums **100,000 instead of 100,100** and counts only 1,000 distinct buyers.

The hosted row cap was not inspected in this pass. The 1,000 threshold is a fixture setting, not a claim about the live project. The defect occurs whenever matching rows exceed the effective cap. No pagination/aggregate query exists in this code path to prevent it.

Source: `app/(dashboard)/dashboard/page.tsx:33-37`, `:49-55`.

Required behavior: calculate sums and distinct counts in a database aggregate with the same business filters. The limited preview and the total must come from separate, deliberate contracts.

### D08 - P2, source-verified: Analytics failure still renders zero metrics and a green no-risk message

If the analytics RPC fails or returns an invalid snapshot, the page uses an empty computed snapshot. It does show a partial-data warning, which is good, but also renders numeric zeros and a green `No critical risk signals from current data` panel from the empty risk array.

Business impact: the same screen communicates data failure and healthy absence of risk. Zero receivables or no critical risks cannot be concluded from unavailable data. This was source-traced; no browser error injection was performed in this pass.

Source: `app/(dashboard)/analytics/page.tsx:34-51`, `:65`, `:170-183`.

Required behavior: distinguish unavailable, partial, stale and verified-empty states. Suppress health conclusions and show unavailable metrics when their source failed. Preserve the warning instead of silently fabricating healthy values.

## Positive controls and business soundness

Executed against the current analytics SQL in the same isolated database:

- Order intake excludes foreign-company orders, cancelled orders and soft-deleted orders. This validates explicit query filters, not live RLS.
- A partially paid invoice with face value 1,000 and balance 400 contributes 400 to outstanding and one overdue invoice when due yesterday. A 5,000 draft invoice contributes neither issued invoice value nor receivables. This validates aggregation of supplied balances, not how balances were posted.

The previous pass also proved that the cash-collection event query excludes credit-note adjustments. That was not rerun here and is not proof of every cashflow report.

| Business dimension | Current evidence-based judgment |
| --- | --- |
| Commercial lineage and workflow | Structurally present; previous multi-profile handoff and partial-dispatch failures block full reliability. |
| Physical quantity integrity | Not dependable end to end; completed output and batch metre reconciliation failed in the previous pass. |
| Displayed shipment and readiness figures | Incorrect for realistic pending/pre-production states in this pass. |
| Procurement alerts | Can hide shortages and undercount them in this pass. |
| Receivable aggregation | Narrow positive control passed; credit issue/reversal and live reconciliation remain open. |
| KPI identity and time consistency | Customer grouping, as-of boundaries, pipeline definition and mixed-status populations need correction. |
| Data completeness and failure handling | Conditional row-cap truncation and unavailable-as-zero presentation undermine confidence. |
| Role/tenant access and deployment | Prior audit issues remain; this pass does not establish hosted migration/RLS correctness. |

## Verification

Command: `node scripts/audit-20261004-displayed-metrics.mjs`.

Result: exit 0. Seven numbered defect scenarios (including both D04 variants) and two positive controls passed their diagnostic assertions. D01-D03 and the controls execute the extracted, current analytics RPC in PGlite. D04-D07 execute the current dashboard's pre-render query construction and arithmetic through a synthetic adapter. D08 is source-only.

Final-script lint: `node node_modules/eslint/bin/eslint.js scripts/audit-20261004-displayed-metrics.mjs` passed, exit 0. Full application build/typecheck/unit suites were not repeated for these audit-only additions.

The SQL fixture uses synthetic tables and a deliberately empty collection-event function; payment analytics are outside that fixture's scope. It does not replay every migration, validate every row constraint, run authenticated RLS, or establish independent-session concurrency. The dashboard adapter models the query operations used by the page and, for D07 only, an explicit API cap. It is not a Supabase server or rendered browser test. A fixture initially used numeric customer ID zero, which was filtered as falsy; it was corrected to nonempty synthetic string IDs before the final passing run. Quote rejection uses the actual `customer_rejected` status.

No new hosted business-data sample was read. Consequently this report proves reproducible code paths to inaccurate figures, not the percentage of the user's current production records affected. Application unit/build results from earlier turns are not new verification for this pass.

## Sign-off requirements

For each owner-facing metric, agree and record: business event, source ledger/table, entity identifier, included/excluded statuses, business timezone and cutoff, unit, denominator, soft-delete/return/credit treatment, precision, and unavailable-data behavior. Each card, list, export and PDF should reconcile to that definition.

Then verify a controlled full journey: approved multi-profile quote -> exact order lines -> billet consumption and output/scrap -> rework resolution -> partial shipment -> final shipment -> invoice -> partial receipt -> return/credit/refund. Reconcile kg, pieces, metres and INR at every step, with actual role sessions. Test more rows than the API cap and unavailable-source cases.

Created only this report and the diagnostic script. No application/migration changes or deployment occurred. Until the confirmed issues are fixed and these reconciliations pass, use source transactions and independently reconciled ledgers rather than trusting the inspected headline cards alone.

# KPI Dictionary

One definition per management metric (EXOS-AUD-028, AP-044). The code copy is the metric registry in `lib/insights/metrics.ts` (`METRICS`); this file is its readable copy and `tests/autopilot-batch8.test.mjs` keeps the two equal. Every screen that shows one of these numbers uses this definition: Insights (`/insights`) lists them, and the command centre, analytics, profitability, production performance and the press floor read the registry (recovery % is computed only by `recoveryPercentOf`). Server-side numbers come from the SQL source named in the registry (`public.get_advanced_analytics_snapshot`, `public.get_financial_collection_events`), which follows the same rules.

| KPI | Definition | Excludes | Visible to |
| --- | --- | --- | --- |
| Shipped kg (MTD, monthly trend) | Net aluminium kg on the packing rows of activated shipments dispatched in the period | Pending, returned and damaged shipments | All Insights roles |
| On-time dispatch rate | Activated shipments dispatched on or before the order's expected dispatch date ÷ activated shipments with an expected date | Shipments without an expected date | All Insights roles |
| Production planned kg (MTD) | Planned kg of jobs whose planned date is in the month | Cancelled jobs | All Insights roles |
| Production completed kg (MTD) | Actual kg of jobs completed in the month (throughput) | — | All Insights roles |
| Production attainment % | Actual kg of the jobs planned this month that are completed ÷ planned kg of the same jobs | Jobs planned in other months | All Insights roles |
| Recovery % | (Actual output − QC-rejected kg) ÷ billet input kg, over completed jobs. Billet input uses the measured billet weight when recorded, else the theoretical weight | Shown as "not captured" if any job in scope has no linked billet input (input-exception jobs, EXOS-AUD-014) | All Insights roles |
| Scrap kg (month) | Weight of scrap postings in the month | Reversed postings (`scrap_record_reversals`) | All Insights roles |
| Recoverable scrap kg | Weight of `production_scrap_lines` with `recoverable = true` (butt end, front/back end, saw cut, rejects) | Unrecoverable loss and unclassified scrap | All Insights roles |
| Die usage | `dies.total_production_kg` = opening (pre-system) kg + completed actual kg of the die's jobs; runs and last-used date likewise | Manual edits (only owner/admin can change the opening balance) | All Insights roles |
| Melt loss kg | Furnace charge kg − measured good billet kg − rejected billet kg, per cast result | Batches without a cast result | All Insights roles |
| Order intake (MTD) | Value of orders dated in the month | Cancelled orders | Finance roles only |
| Collections (MTD) | Customer receipts in the month, from the canonical collection events | Reversed receipts | Finance roles only |
| Overdue receivables | Balance due on issued invoices past their due date | Cancelled and draft invoices | Finance roles only |
| Order margin % | Gross margin of records whose cost components are all known ÷ revenue of the same records | Records with an unknown cost component (their revenue is shown separately) | Finance roles only |

When a definition changes, update the registry, this file and the SQL source in the same change.

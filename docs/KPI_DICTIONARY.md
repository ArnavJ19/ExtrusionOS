# KPI Dictionary

One definition per management metric (EXOS-AUD-028, AP-044). The code copy is the metric registry in `lib/insights/metrics.ts` (`METRICS`); this file is its readable copy and `tests/autopilot-batch8.test.mjs` keeps the two equal. Every screen that shows one of these numbers uses this definition: Insights (`/insights`) lists them, and the command centre, analytics, profitability, production performance and the press floor read the registry (recovery % is computed only by `recoveryPercentOf`). Server-side numbers come from the SQL source named in the registry (`public.get_advanced_analytics_snapshot`, `public.get_financial_collection_events`), which follows the same rules.

**One computation (FS-77, FS-132).** Period KPIs are computed in one SQL function, `private.kpi_values`, read through `public.fs_kpi` (Command Center, `/insights/kpis`). The analytics and dashboard snapshots compute the overlapping figures by the same rules, and `tests/fs-batch4-sql.test.mjs` requires the three paths to agree on a fixture. Each value carries a status: **measured**; **not captured** (the period lacks the input, for example a completed job without billet input) or **not measurable** (the input does not exist in the system yet — OEE availability and performance, conversion cost). Neither of the last two is ever shown as zero, and no target is stored with a KPI. Recovery and yield are one measure in ExtrusionOS: press recovery. All periods are India business dates (`private.business_today()`, FS-82).

| KPI | Definition | Excludes | Visible to |
| --- | --- | --- | --- |
| Shipped kg (MTD, monthly trend) | Net aluminium kg on the packing rows of activated shipments dispatched in the period | Pending, returned and damaged shipments | All Insights roles |
| On-time dispatch rate | Activated shipments dispatched on or before the order's expected dispatch date ÷ activated shipments with an expected date | Shipments without an expected date | All Insights roles |
| Production planned kg (MTD) | Planned kg of jobs whose planned date is in the month | Cancelled jobs | All Insights roles |
| Production completed kg (MTD) | Actual kg of jobs completed in the month (throughput) | — | All Insights roles |
| Production attainment % | Month to date: actual kg of jobs completed in the month ÷ planned kg of jobs planned in the month. On a job page: that job's actual ÷ planned kg | Cancelled jobs | All Insights roles |
| Recovery % | (Actual output − QC-rejected kg) ÷ billet input kg, over completed jobs. Billet input uses the measured billet weight when recorded, else the theoretical weight | Shown as "not captured" if any job in scope has no linked billet input (input-exception jobs, EXOS-AUD-014) | All Insights roles |
| Scrap kg (month) | Weight of scrap postings in the month | Reversed postings (`scrap_record_reversals`) | All Insights roles |
| Recoverable scrap kg | Weight of `production_scrap_lines` with `recoverable = true` (butt end, front/back end, saw cut, rejects) | Unrecoverable loss and unclassified scrap | All Insights roles |
| Die usage | `dies.total_production_kg` = opening (pre-system) kg + completed actual kg of the die's jobs; runs and last-used date likewise | Manual edits (only owner/admin can change the opening balance) | All Insights roles |
| Melt loss kg | Furnace charge kg − measured good billet kg − rejected billet kg, per cast result | Batches without a cast result | All Insights roles |
| Order intake (MTD) | Value of orders dated in the month | Cancelled orders | Finance roles only |
| Collections (MTD) | Customer receipts in the month, from the canonical collection events | Reversed receipts | Finance roles only |
| Overdue receivables | Balance due on issued invoices past their due date | Cancelled and draft invoices | Finance roles only |
| Order margin % | Gross margin of records whose cost components are all known ÷ revenue of the same records | Records with an unknown cost component (their revenue is shown separately) | Finance roles only |
| Process scrap % | Process scrap kg recorded on completed jobs (`production_scrap_lines`) ÷ billet input kg of the same jobs | Jobs without billet input | All Insights roles |
| QC-rejected kg | Kg on rejected quality inspections of jobs completed in the period | Rework that was accepted | All Insights roles |
| OEE quality % | Good kg (output − QC-rejected kg) ÷ output kg of jobs completed in the period | — | All Insights roles |
| OEE availability % | Run time ÷ planned production time per press. Not measurable until press run and stop time is captured (FS-15) | — | All Insights roles |
| OEE performance % | Actual output rate ÷ approved ideal rate per press and profile. Not measurable until ideal rates are approved | — | All Insights roles |
| OEE % | Availability × performance × quality. Not measurable while availability and performance are not | — | All Insights roles |
| kWh per tonne | Electricity consumption readings dated in the period ÷ tonnes completed in the period | Non-electric energy (gas, diesel) | All Insights roles |
| Conversion cost per tonne | Actual conversion cost ÷ tonnes produced. Not measurable until actual job costing exists (FS-12) | — | All Insights roles |
| Die life kg | Median kg produced by the dies retired (status dead), with the number of dies stated | Dies without recorded production | All Insights roles |
| OTIF % | Order lines dispatched in full (less the owner's in-full tolerance) on or before their first promised date ÷ lines whose first promise fell due in the period | Lines with no quantity; cancelled orders | All Insights roles |
| Quote win rate % | Quotations converted to an order ÷ quotations past internal review, dated in the period | Drafts and quotations in internal review | All Insights roles |
| Receivables outstanding | Balance due on generated, sent, partly paid and overdue invoices | Draft, paid and cancelled invoices | Finance roles only |
| DSO (days) | Receivables outstanding ÷ average daily net invoicing (invoices less credit notes) over the 90 days to the period end | Cancelled invoices | Finance roles only |

When a definition changes, update the registry, this file and the SQL source in the same change.

# KPI Dictionary

One definition per management metric (EXOS-AUD-028). Every screen that shows one of these numbers must use this definition. The SQL source is `public.get_advanced_analytics_snapshot`; the TypeScript fallback in `lib/analytics/advanced-dashboard.ts` and the command centre (`app/(dashboard)/command-center/page.tsx`, `lib/command-center/metrics.ts`) follow the same rules.

| KPI | Definition | Excludes |
| --- | --- | --- |
| Shipped kg (MTD, monthly trend) | Net aluminium kg on the packing rows of activated shipments dispatched in the period | Pending, returned and damaged shipments |
| On-time dispatch rate | Activated shipments dispatched on or before the order's expected dispatch date ÷ activated shipments with an expected date | Shipments without an expected date |
| Production planned kg (MTD) | Planned kg of jobs whose planned date is in the month | Cancelled jobs |
| Production completed kg (MTD) | Actual kg of jobs completed in the month (throughput) | — |
| Production attainment % | Actual kg of the jobs planned this month that are completed ÷ planned kg of the same jobs | Jobs planned in other months |
| Recovery % | (Actual output − QC-rejected kg) ÷ billet input kg, over completed jobs. Billet input uses the measured billet weight when recorded, else the theoretical weight | Shown as "not captured" if any job in scope has no linked billet input (input-exception jobs, EXOS-AUD-014) |
| Scrap kg (month) | Weight of scrap postings in the month | Reversed postings (`scrap_record_reversals`) |
| Recoverable scrap kg | Weight of `production_scrap_lines` with `recoverable = true` (butt end, front/back end, saw cut, rejects) | Unrecoverable loss and unclassified scrap |
| Die usage | `dies.total_production_kg` = opening (pre-system) kg + completed actual kg of the die's jobs; runs and last-used date likewise | Manual edits (only owner/admin can change the opening balance) |
| Melt loss kg | Furnace charge kg − measured good billet kg − rejected billet kg, per cast result | Batches without a cast result |

When a definition changes, update this file, the SQL function and the TypeScript fallback in the same change.

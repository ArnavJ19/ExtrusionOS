# Report 7 — Regression Test Blueprint

Every scenario can run on `harness/live-catalog-db.mjs` (PGlite replica of the live catalog), seeded with `harness/seed.mjs`, and should run against the repo's native local Supabase acceptance stack too. Each existing reproduction script is the "before" case. After a fix, its assertion flips to *rejected* (or the corrected value), and the script then serves as the regression test.

| ID | Initial state | Action (role) | Expected after fix | DB assertions | Downstream assertions | Negative / concurrent |
| --- | --- | --- | --- | --- | --- | --- |
| 001 | Planned batch, 10 billets, 6063 | melting → record spectro → cast with 8 good / 2 rejected | 8 allocatable, 2 `scrap`, chemistry stored | Billet count by status; measured weights | Allocation picks only `ready` | Failed chemistry → 0 allocatable; cast without results rejected |
| 002 | No job | `scrap_records` insert (viewer, production) | Rejected | No new foundry lot | — | Reversal of an unconsumed lot ok; consumed lot rejected |
| 003 | Used lot 1,000 kg / 0 available | Edit notes in the form; REST set available 25,000 | Available stays 0; REST rejected | `available ≤ weight`; Σ charges = weight − available | Foundry charge of that lot rejected | Two concurrent charges on one lot (row lock) |
| 004 | Receipt 10 billets, 2 consumed | Edit alloy, weight, count; cancel | Rejected (or only the 8 unused cancelled) | Consumed billet weight and alloy unchanged | Job mass balance unchanged | Edit before any use still allowed |
| 005 | 6061 ingot, 6063 batch | Create batch | Rejected without override | Source available unchanged | — | Override logged with reason |
| 006 | Job, input 1,000 kg | Complete 600 + 300 butt + 100 unrecoverable | 300 kg lot tagged 6063 | Loss line 100 kg | Recovery report shows 60% | No lot for unrecoverable |
| 007 | Die D in two jobs | Release press A, then press B, overlapping | Second release rejected | One released slot per die per window | — | Parallel release from two sessions |
| 008 | Press in `breakdown` | Viewer and sales update status | Rejected | — | Release rejected | Return to service without a closed breakdown rejected |
| 009 | Dispatched shipment | `dispatch` role → in_transit, delivered | Succeeds | Status history row | Order stage synced | `dispatch_manager`, `inventory_manager` also succeed |
| 010 | Reservation on order A | App builder → `save_ready_dispatch_atomic`; forged line B, ₹1 | App path ok with A's rate; forged rejected | `packing.order_item_id` = A's line | Invoice rate = order rate | — |
| 011 | Dispatched shipment | Viewer edits e-way bill, LR; marks returned | Rejected | Logistics fields unchanged | No credit note eligibility | Dispatch-role amendment through RPC logged |
| 012 | Completed job | PM approves; quality approves out of spec; flag off | All rejected | `approved_by` = quality user | Dispatch blocked without QC | In-spec approval by quality passes |
| 013 | — | Insert stock batch without origin | Rejected | — | — | Opening stock with approval allowed |
| 014 | Job without requirement | Complete with 0 billets | Rejected | — | No packaging created | Audited exception path |
| 015 | On-hold job with issued billets | Cancel | Billets released | Billets unlinked | Allocatable again | Partially heated billets → scrap entry |
| 016 | Dispatched + invoiced, 1 of 20 bundles returned | Return 1 bundle | Quarantine 1 bundle; credit 1/20 | Disposition rows | Receivable reduced proportionally | Full return → full credit |
| 017 | Pending dispatch | Low-level RPC with 'delivered' | Rejected / not executable | Order stage unchanged | — | — |
| 018 | Order 1,000 kg, delivered 980 | Deliver | Stage `delivered` within tolerance | Stage history | — | Returned then replaced → delivered |
| 019 | — | Viewer inserts audit row as owner | Rejected, or actor forced to the viewer | — | — | — |
| 020 | Die with history | Renumber or change profile | Rejected | — | Die kg = Σ completed jobs | — |
| 021 | Open job on profile | Change kg/m or alloy | Blocked, or a new profile version | Job keeps its version | — | — |
| 022 | Item with stock 100 | Viewer movement; negative post; foundry charge | Rejected; rejected; movement posted | Balance = Σ movements | Dashboard low stock correct | — |
| 023 | Closed September | Invoice dated 15 Sept | Rejected without override | — | — | Payment before invoice date rejected |
| 024 | Dealer user | POST dealer item | Succeeds; total metres = pieces × length | — | — | — |
| 025 | QC 1,000 kg, packaged 50 kg | Dispatch 1,000 kg | Capped at 50 kg | — | — | Returned shipment releases capacity after disposition |
| 026 | Quote 1,000 kg + 5% allowance | Invoice 1,000 kg | Matches the agreed billing basis | — | — | Minimum billing weight honoured |

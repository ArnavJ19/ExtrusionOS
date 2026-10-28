# Report 7 — Regression Test Blueprint (pass 2)

Each scenario exists as an executable script in `harness/`. After a fix, the same script becomes the gate: the "today" outcome must flip.

| Finding | Script | Initial state | Action | Today | Expected after fix | DB assertions |
| --- | --- | --- | --- | --- | --- | --- |
| 001 | `r01` `ONLY=c,d` | Delivered dispatch D-1; QC'd and packaged 10 kg job | Owner `DELETE` D-1, then re-ship 10 kg | Delete OK; re-ship OK | Delete rejected; re-ship rejected | D-1, its packing row and its history row still exist |
| 001 (control) | `r01` `ONLY=a` | Invoiced dispatch | Owner `DELETE` | Rejected | Rejected | — |
| 002 | `r06` | 3 linked billets, 1 issued | Complete with 500 kg accounted | Rejected; completing with 1,000 kg of "loss" accepted | Accepted | Billets 2–3 `allocated`, no job; scrap 80 kg |
| 003 | `r05` | 65.67 kg charged | Cast result 74.864 kg good + 5 kg dross | Accepted (melt loss −9.194) | Rejected | No cast-result row |
| 004 | `r02` | Lot rejected by manager | Operator sets `available` and charges | Accepted, no audit | Rejected; disposition RPC with reason works for quality | Audit row with old and new status |
| 004 (return) | `r02` (R02b) | 1,000 kg lot @ ₹200 | Mark `returned` | Inventory 1,000; payable ₹2,00,000 | Inventory 0; supplier credit ₹2,00,000 | Movement plus credit rows |
| 005 | `r03` | Open breakdown locks Press B | Owner deletes it, then signs off | Both accepted | Delete rejected; sign-off rejected | Breakdown row persists |
| 006 | `r08` | Profile with 696 kg stock and a reservation | Owner deletes profile | Accepted; stock erased | Rejected (FK restrict) | Batch and reservation persist |
| 007 | CI | Empty Postgres | Replay `main` migrations | Not runnable | Fingerprint equals hosted | — |
| 008 | `r04` (R04b) | 600 kg packed | Dispatch at 600.4 kg | Rejected | Accepted within tolerance; variance recorded | — |
| 009 | `r05` (R05b) | Batch cast | Record Fe 0.60 as `pass`, approve, release | All accepted | Verdict computed as `fail`; release blocked without override | — |
| 010 | `r04` (R04a) | 1,000 kg to coating | Complete at 1,020 kg | Rejected | Accepted within the coating allowance | gain = 20 kg |
| 011 | `r07` | Material at 0 | Purchase 100 rolls; dispatch types 5,000 | Master 0 / item 100; edit OK | Master 100; edit rejected | Movement row for the purchase |
| 012 | new | Shipment line of 100 | Dealer reports 99; recount resolves | No stock posted | 99 posted; resolution through a factory RPC | Dealer cannot update or delete the discrepancy |
| 014 | storage test | Dealer user session | Read `quote-pdfs/<company>/…` of another customer | Allowed | Denied | — |

## Concurrency cases (to run against a real Postgres with two sessions)

- Two operators issue the same allocated billet at the same time. Expect one success.
- Two sessions complete the same job at the same time. Expect one completion and a single consumption.
- Dispatch delete (if retained for pending dispatches) racing with activation.

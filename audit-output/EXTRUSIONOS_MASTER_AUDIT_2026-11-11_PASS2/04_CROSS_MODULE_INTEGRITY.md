# Cross-Module Integrity

**What this pass adds.** Independent two-session tests of the receipt path, delete attempts on every lineage parent, the hosted foreign-key delete rules, and reruns of the earlier audit's cross-module reproductions. The other workflows below were **not** independently executed in this pass; their rows say so.

## Workflows

| # | Workflow | This pass | Result |
|---|---|---|---|
| 1 | Quote approval → order | Not run | Suite only. One differential from the earlier audit, rerun here: a header-only expired quote is correctly refused extension; a costed one is approved |
| 2 | Order → production planning | Not run | Suite only |
| 3 | Planning → billet allocation | Not run | Suite only. Competing orders in two sessions untested |
| 4 | Billet issue → consumption | **Reproduced defect** | Completion balances against issued plus allocated billets (PA2-004) |
| 5 | Completion → scrap and stock | Partly | Blocked by PA2-004 for partial issues. Concurrent completion untested |
| 6 | Quality hold → release | **Reproduced defect upstream** | Impossible chemistry approved (PA2-003). Finished-goods hold not attacked |
| 7 | Finished goods → packaging | **Reproduced defect** | Packaging purchase and consumption use different balances (PA2-007) |
| 8 | Packaging → dispatch | Not run | Suite only |
| 9 | Dispatch → stock reduction | Not run | A dispatched record cannot be deleted (verified). Failed or repeated gate-out untested |
| 10 | Dispatch → invoice | Not run | Suite only. PA2-010 notes that rate × kg does not reproduce the quoted amount |
| 11 | Invoice → payment and credit | **Independently verified** | See below |
| 12 | Purchase → receipt and valuation | Not run | Suite only |
| 13 | Foundry rejection → downstream hold | Source only | No downstream hold exists (PA2-011) |
| 14 | Return → stock and finance | Not run | Suite only |
| 15 | Warehouse issue → transit → receipt | Not run | Suite only |
| 16 | Configurator → BOM → production | Not run | Suite, plus 14 unlisted engine tests pass |

### Workflow 11 in detail (two real database sessions)

| Case | Result |
|---|---|
| Two receipts of ₹700 racing on a ₹1,000 invoice | First accepted, second refused; paid amount ₹700 |
| Same receipt submitted twice with the same idempotency key, racing | One payment; the second call returns the first result |
| Idempotency key reused on a different invoice | Refused |
| ₹1,500 on a ₹1,000 invoice | Refused |
| Zero, negative, future-dated, pre-invoice-dated, unknown method | All refused |
| Receipt on a cancelled invoice | Refused |
| Two reversals of the same receipt, racing | One succeeds; balance returns to ₹1,000 once |
| Paid amount versus sum of live payments, all eight invoices | Equal on every invoice |

Not covered: advances and on-account money, credit notes, refunds, and the bank-import-to-receipt path under concurrency.

## Lineage links

"Verified" below means only what the column says. No real shipment was traced back to its heat.

| Link | Key | Delete behaviour (owner, tested) | Known break |
|---|---|---|---|
| Source lot → heat | Batch columns for one scrap and one external source | Not tested | A heat fed from several lots cannot record them all (AP-026) |
| Heat → cast result → billets | `foundry_batch_id`, cascade | Batch delete refused by trigger | Mass can be wrong (PA2-002) |
| Heat → chemistry → release | `foundry_batch_id`, cascade | Same | Invalid chemistry can pass (PA2-003) |
| Billet → job | `production_billet_issues`, cascade from job | Job delete: 0 rows | Allocation counted as input (PA2-004) |
| Order line → job | `order_id`, cascade from order | Order delete refused, reason unverified on hosted | — |
| Job → stock batch → reservation | cascade from batch | Not tested | — |
| Stock → packing → dispatch | `packing_list_items`, cascade from dispatch | Dispatched record refused by trigger | — |
| Dispatch → invoice | `invoices.dispatch_id`, set null | Invoice delete: 0 rows | — |
| Invoice → payments | cascade from invoice | Invoice delete: 0 rows | — |
| Quote → revisions → order | cascade from quote | **Sent quote deleted** | PA2-022 |

The pattern: the foreign keys would cascade, and separate triggers or missing delete policies stop the delete. See [07](07_DATABASE_AND_MIGRATION_AUDIT.md) for why that is fragile.

## Two sources of truth found

| Quantity | Source A | Source B | Status |
|---|---|---|---|
| Packaging material on hand | `inventory_items` (credited by purchase) | `packaging_materials.current_stock` (debited by packing) | Disagree (PA2-007) |
| Job input weight | Issued billets | Issued plus allocated billets | Completion uses the wrong one (PA2-004) |
| Quote line arithmetic | TypeScript engine (screen) | SQL trigger (saved) | Agree except paise on 3 of 600 lines (PA2-018) |
| Reserved finished stock | Dashboard snapshot | Reservation ledger | Now agree (was MFA-005) |
| Dealer stock | Receipts | Fulfilment projection | Not tested (AP-007) |

## Not established

Stale-preview and second-person rules for the November commands under two real sessions; crash between steps of a multi-step dispatch; retry after a lost network response; lineage after bundle split and merge, rework, outsourced finishing, returns and customer-owned metal.

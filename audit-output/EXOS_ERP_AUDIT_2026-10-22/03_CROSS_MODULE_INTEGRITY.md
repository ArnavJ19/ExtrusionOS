# Report 3 — Cross-Module Integrity (after the 20 Oct remediation)

| Flow | Owner of the transition | Atomic / idempotent | New breaks (this pass) | State |
| --- | --- | --- | --- | --- |
| A. Raw material → billet | `foundry_*_sources` balance trigger; `record_foundry_cast_result`; `guard_foundry_batch_release` | Yes (row locks on the source) | 003 cast over-yield; 004 quarantine and return status; 009 chemistry verdict; 017 no recall; 020 zero-rate receipts | **Broken at physical reality** |
| B. Billet → extrusion | `issue_production_billets`; `complete_production_job_with_scrap_atomic` | Yes | 002 unissued billets consumed; 018 no remnant logs | **Broken at the issue/consume boundary** |
| C. Profile → customer | `save_ready_dispatch_atomic`; `assert_dispatch_ready`; `save_invoice_atomic` | Yes (order row lock; advisory lock on the invoice) | 001 hard delete of a delivered dispatch; 008 10 g tolerance; 010 coated weight; 014 POD files deletable | Sound except the delete path |
| D. Scrap recycling | `sync_process_scrap_to_foundry`; categorised scrap lines (EXOS-AUD-006) | Yes | 002 pushes fictitious "loss" into scrap and recovery | Polluted by 002 |
| E. Die readiness | Die status authority (EXOS-AUD-008/020) | Yes | 005 die corrections and trials deletable without trace | History erasable |
| F. Machine readiness | Breakdown lock and sign-off (EXOS-AUD-027) | Yes | 005 deleting an open breakdown releases the lock; 022 operator exception not linked | **Lockout bypassable** |
| G. Order fulfilment | Order workflow guard; delivery stage resolution | Yes | 001 order stays "delivered" after its dispatch is deleted; 006 reservations erased by a profile delete; 013 dealer stock fulfilment from self-declared stock | Partially broken |
| H. Financial reconciliation | Expense ledger RPCs; invoice coverage; period lock | Yes | 004 returned metal stays payable; 011 packaging purchases are not the consumed stock; 020 ₹0 metal valuation | Valuation incomplete |

## Synchronization problems

- **Packaging material.** Purchases post to `inventory_items` (PKG-…); consumption posts to `packaging_materials.current_stock`. Neither reconciles (011).
- **Dealer stock.** Receipts post to `inventory_transactions`; fulfilment draws on `profile_stock_batches` (013).
- **Raw metal.** On hosted, the inventory items show 0 kg while the source register shows 2,899.999 kg available (016).

## Upstream edits that silently invalidate downstream work

- A source status change after charging leaves the batch and billets untouched (017).
- A profile delete cascades into stock, reservations, QC and packing (006).
- A dispatch delete re-opens packed capacity for a second shipment (001).

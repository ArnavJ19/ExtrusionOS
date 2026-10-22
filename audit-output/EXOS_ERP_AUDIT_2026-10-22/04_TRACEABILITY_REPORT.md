# Report 4 — Manufacturing Traceability (pass 2)

## Link status

| Link | Persisted relationship | Status | Breaks |
| --- | --- | --- | --- |
| Metal lot → batch | `foundry_batches.scrap_id` / `external_source_id` (single source per type) | Enforced | 017: no hold when the lot is rejected later; one source per type per batch |
| Batch → cast result → billet | `foundry_cast_results`; `foundry_billets.foundry_batch_id`, `measured_weight_kg` | Enforced for new batches | 003: measured weight can exceed the charge; 016: a hosted legacy batch has no cast result |
| Billet → job | `foundry_billets.production_job_id` + `production_billet_issues` | Enforced, but consumption ignores issue evidence | 002: unissued billets are recorded as consumed; 018: no remnant identity |
| Job → QC → packaging → dispatch | `quality_inspections.production_job_id`; `packaging_jobs.production_job_id`; `packing_list_items.source_line_id` | Enforced | 001: the dispatch and its packing rows can be deleted |
| Dispatch → invoice | `invoices.dispatch_id`; `invoice_items.source_line_id` = packing row | Enforced (must cover every row) | — |
| Profile master → stock | `profile_stock_batches.profile_id` with `ON DELETE CASCADE` | **Erasable** | 006 |
| Dealer shipment → dealer stock | `shipment_items` → `inventory_transactions` only | **Not linked** to the factory dispatch or to fulfilment stock | 012, 013 |

## Forward test (source lot → customer)

- **Reconstructable** for new transactions: lot → batch → billets → issue → job → packing rows → dispatch → invoice.
- **Fails in three cases:**
  - Billets that were consumed without being issued (002).
  - A deleted dispatch (001).
  - Remnant log pieces reused in a later job (018).

## Backward test (invoice → lot)

- **Reconstructable** while no privileged delete has happened.
- **Hosted counter-example:** the billets of `F1-20260530-1` lead back to `EAS-2026-0003`, a 100,000 t receipt held as `rejected`, and to `SCR-2026-0002`, also `rejected` (016/017).

## Data-model corrections

1. Change the transactional FKs to master data and to dispatches from `CASCADE` to `RESTRICT`, and add `BEFORE DELETE` lifecycle guards.
2. Consume only billets that have issue evidence, and model remnants as child billets.
3. Reconcile the cast result against the charge.
4. Add a source disposition table that propagates holds.
5. Create dealer stock batches from receipts, with `source_dispatch` lineage.

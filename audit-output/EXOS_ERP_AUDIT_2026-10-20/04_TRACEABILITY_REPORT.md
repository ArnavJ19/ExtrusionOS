# Report 4 — Manufacturing Traceability Report

## Persisted genealogy links (live schema)

| Link | Column / FK | Enforcement | Status |
| --- | --- | --- | --- |
| Raw lot → heat | `foundry_batches.scrap_id`, `external_source_id` (one each) | Same-company source required for positive charge | **Partial:** at most one scrap and one external lot per heat; no alloy check (AUD-005) |
| Heat → billet | `foundry_billets.foundry_batch_id`, `billet_code` = furnace-date-seq-n | Trigger-enforced identity | **Structural but fictional:** billets equal the plan (AUD-001) |
| Outsourced receipt → billet | `foundry_billets.outsourced_batch_id` | No commitment guard | **Rewritable** (AUD-004) |
| Billet → order / requirement | `order_id`, `allocation_requirement_id` | Allocation RPCs and lineage guard | Enforced |
| Billet → production job | `foundry_billets.production_job_id` | Lineage immutable after issue | Enforced, except stranding on cancel (AUD-015) |
| Job → order line | `production_jobs.source_line_id` | `validate_production_job_source_line` | Enforced |
| Job → QC | `quality_inspections.production_job_id` (+ `finishing_job_id`) | QC must link a completed job and profile | Enforced |
| Job → packaging | `packaging_jobs.production_job_id` (+ finishing receipt) | Guards in place | Enforced |
| Packing row → source | `packing_list_items.source_kind` + `source_line_id` / `reservation_id` / `profile_stock_batch_id` | Trigger-enforced | Enforced for production; **reservation lacks commercial lineage** (AUD-010) |
| Stock batch → origin | — | — | **Structurally impossible** (AUD-013) |
| Dispatch → invoice → payment | FKs plus canonicalization | Enforced | ✅ |
| Scrap → origin heat or alloy | `origin_reference` text only | — | **Informational only** (AUD-005, AUD-006) |
| Reject or return → disposition | — | — | **Missing** (AUD-016) |

## Forward trace test (lot → customer)

Can be answered only for one path: a single external lot or scrap lot → batch → billets → job → packing row → dispatch → invoice.

It breaks when:
- a heat uses more than one source of the same kind (not representable);
- billets are outsourced and the receipt was edited (004);
- any part shipped from stock or dealer stock (013);
- remelted scrap is involved (the alloy and origin chain ends at text).

## Backward trace test (invoice → raw material)

Invoice → dispatch → packing rows → production job → billets → heat → (scrap lot | external lot) works for production-sourced goods. The answer is wrong whenever the billet count or weight differs from reality (001) or the outsourced receipt was edited (004). It ends at "unknown" for stock and dealer-stock rows (013).

## Transformations not traceable

Mixing (several lots per heat), batch splitting or merging, partial billet consumption (whole billets only), bundle splitting at dispatch beyond the packing row, rework (QC rework resolution exists but without material movement), customer returns, and remelt of rejects.

## Data-model corrections

1. `foundry_charge_lines (batch_id, source_table, source_id, kg, alloy)` replacing the single `scrap_id` and `external_source_id`.
2. `foundry_cast_results` and per-billet measured weight and disposition. Chemistry tests are linked to the batch.
3. `scrap_lots.alloy`, plus `origin_job_id` and `origin_heat_ids` (FKs instead of text).
4. `profile_stock_batches.origin_type`, `origin_id`, `production_job_id`, `qc_status`, `alloy`, `temper`.
5. `material_dispositions` for rejects and returns (quarantine → rework, scrap or sale) with movement rows.
6. Make genealogy rows append-only. Corrections become new rows, never in-place edits (fixes 003 and 004 by construction).

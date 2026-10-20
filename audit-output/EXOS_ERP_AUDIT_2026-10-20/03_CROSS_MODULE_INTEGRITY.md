# Report 3 — Cross-Module Integrity Report

Notation: **source → destination** (writer). ✅ held under test or review · ⚠ defect (see the register ID) · ◻ not verified.

## Flow A — Raw material to billet

```
Vendor ─► foundry_external_aluminium_sources / foundry_aluminium_scrap   (browser insert via RecordFormClient; AUD-003)
            │ sync_*_inventory_and_expense ─► inventory_items(+)  expense_ledger
            ▼
foundry_batches (planned) ── apply_foundry_source_delta ─► source.available_weight_kg(−)   [no alloy check: AUD-005]
            │                                              inventory_items NOT decremented  [AUD-022]
            ▼ status: melting ─► cast   (physical fields frozen at 'melting': AUD-001)
foundry_billets × billet_count (theoretical weight, status 'cast') ─► allocate_billets_by_priority  [before homogenize/ready]
```

| Check | Result |
| --- | --- |
| Positive charge requires a same-company source | ✅ (S01 fix held in review) |
| Source debit is atomic and locked | ✅ `apply_foundry_source_delta` row locks |
| Source balance is authoritative | ⚠ 003, freely writable; live rows drift |
| Alloy compatibility | ⚠ 005 |
| Cast outcome (count, rejects, chemistry) | ⚠ 001 |
| Inventory module reflects the charge | ⚠ 022 |
| Melt loss and dross accounted | ⚠ 001: required charge = billets ÷ efficiency, and the difference is never recorded |

## Flow B — Billet to extrusion

```
order_billet_requirements ◄─ rebuild_order_billet_requirements (orders AIU)
foundry_billets(cast) ─ allocate_billets_by_priority ─► allocated(order, requirement)
production_jobs ─ save_production_job_atomic ─► billets 'issued' (at plan save: AUD-031)
production_plan_slots ─ release ─► job ready ─ transition ─► in_progress   [die overlap unchecked: AUD-007; machine status writable: AUD-008]
complete_production_job_atomic ─► actual kg; mass balance vs linked billets (±1%, min 0.5 kg) ✅
                               ─► scrap_records(process_scrap) ─► foundry_aluminium_scrap(clean, available)  [AUD-006]
                               ─► billets consumed; packaging or finishing auto-created
```

| Check | Result |
| --- | --- |
| Mass balance when billets are linked | ✅ enforced in both the RPC and the trigger |
| Completion without input | ⚠ 014 |
| Cancellation releases billets | ⚠ 015 |
| Completed output immutable except audited correction | ✅ `enforce_production_completion_integrity` |
| Outsourced billet input immutable after use | ⚠ 004 |
| Scrap recorded outside completion | ⚠ 002 |

## Flow C — Finished profile to customer

```
completed job ─► QC (quality_inspections approved kg)  [no spec check, self-approval: AUD-012]
           ─► packaging_jobs completed + materials
           ─► dispatch (packing_list_items) ─ assert_dispatch_ready ─ activation auth ─► consume reservations
           ─► invoice (invoice_items = packing rows, rate from order line) ─► payments ─► collection state
```

| Check | Result |
| --- | --- |
| Dispatch exactly once; activation authorization | ✅ |
| Packing ≤ QC-released (finishing route) | ✅ |
| Packing ≤ packaged (mill finish) | ⚠ 025 |
| Reservation lines get commercial lineage | ⚠ 010 |
| Dispatch roles can update delivery | ⚠ 009 |
| Post-shipment logistics immutable | ⚠ 011 |
| Invoice = packing rows exactly once | ✅ `assert_invoice_packing_coverage` |
| One active invoice per dispatch | ✅ (two overlapping triggers enforce it; redundant) |
| Payment idempotency, overpayment block | ✅ |
| Order reaches delivered | ⚠ 017 (forced) / 018 (stuck) |

## Flow D — Scrap recycling

```
completion loss ─► scrap_records(process_scrap) ─► foundry scrap lot (clean, no alloy)  ─► next furnace charge
QC reject / finishing reject / customer return ─► (nothing)                              [AUD-016]
manual scrap_records (any user) ─► foundry scrap lot                                     [AUD-002]
```

There is no weighing step and no alloy tag. Only `process_scrap` loops back; `butt_scrap` and the other types do not. The loop is one-way and cannot be corrected.

## Flow E — Die readiness

```
dies (status free across sales/production roles: AUD-008) ─► schedule / release / start (status ∈ active, approved) ✅
die history: total_production_kg/runs manual (AUD-020); nitriding/corrections do not change status; no die exclusivity (AUD-007)
```

## Flow F — Machine readiness

```
maintenance_schedules / breakdown_logs (machine_id TEXT, no FK) ─╳─ machines.status (any user writes)  [AUD-008, AUD-027]
machines.status ∈ active, operational, idle ─► release/start allowed
```

The status that production depends on has no connection to maintenance records.

## Flow G — Customer order fulfilment

The quote → order → production → dispatch → invoice → payment path is consistent for production-sourced, mill-finish and finished goods (✅ BL, Astra, R-series fixes reviewed). The breaks are the reservation and stock source (010), returns (016, 018), and the quote-to-invoice pricing model (026).

## Flow H — Financial reconciliation

There is no general ledger, WIP, COGS or inventory valuation. `expense_ledger` is a payables register and `inventory_items.average_rate` is maintained only for purchased sources. Raw material valuation → consumption → FG → COGS **cannot be reconstructed** inside the system (missing functionality). Period control is absent (023).

## Upstream edits that silently invalidate downstream work

| Upstream edit | Downstream impact | ID |
| --- | --- | --- |
| Outsourced receipt alloy, weight or count | Consumed billet alloy and weight rewritten; completed job mass balance changes | 004 |
| Scrap lot edit | Charged metal becomes available again | 003 |
| Profile kg/m, alloy, billet diameter | Open job compatibility and planned weights change | 021 |
| Die number or profile | Running job and history re-attributed | 020 |
| Feature flag `quality_compliance` | All future dispatches skip QC | 012 |
| Dispatch logistics fields | Invoice and e-way bill no longer match the transport record | 011 |

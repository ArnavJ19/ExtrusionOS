# Deliverable A — ERP Architecture Map

## Stack (from evidence)

- **Frontend:** Next.js 16 App Router (`app/`: 196 pages, 24 API routes), React 19, Tailwind.
- **Server code:** server actions in `lib/actions/*`, plus the generic client-side `RecordFormClient` (`components/modules/operations/record-form-client.tsx`) driven by `module-config.ts`.
- **Database:** Supabase Postgres, where most business logic lives (294 functions, 281 triggers). The app calls `*_atomic` SECURITY DEFINER RPCs (92 functions executable by `authenticated`) or writes tables directly under RLS. 175 public tables, all with RLS; 23 masking views (`*_authorized`).
- **Tests:** Node test runner plus PGlite fixtures (`tests/`, `scripts/`), and a staging and local acceptance runner.

## Two write architectures — the main structural risk

1. **RPC path (hardened):** orders, quotes, production jobs, schedule, dispatch, invoices, payments, credit notes, expenses, allocation.
2. **Direct-table path (browser → PostgREST under RLS):** customers, vendors, profiles, dies, machines, maintenance, inventory items and movements, quality inspections, foundry batches, scrap and external sources, outsourced billets, packaging materials and purchases, audit logs, feature flags, settings.

Most P1 findings come from tables in path 2 whose rows drive stock- or status-bearing triggers.

## Module inventory

| Module | Purpose | Code | Tables | Creates | Consumes | Affects | Key rules | Write path | Reports |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Quotes | Costed price offer | `lib/calculations/quote.ts`, `lib/actions/quotes-orders.ts` | quotes, quote_items, quote_revisions | Price, margin, net_rate | Profiles, dies, settings | Orders | DB recalculation trigger; low-margin approval | RPC | Quote PDF, pipeline KPI |
| Orders | Commercial commitment | `lib/actions/quotes-orders.ts`, `direct-orders.ts` | orders, order_items, order_stage_history, order_billet_requirements | Requirements | Quotes | Production, billets, dispatch, invoice | Workflow write guard; billet requirement rebuild | RPC | Stage backlog |
| Foundry | Melt and cast | record form (foundry) | foundry_batches, foundry_billets | Billets | Scrap and external sources | Allocation | Charge mix = 100%; physical freeze after planning | Direct + triggers | Billet stock |
| Foundry sources | Metal inputs | record form | foundry_aluminium_scrap, foundry_external_aluminium_sources | Available kg | Vendor bills | Foundry, expenses, inventory | Source delta locking | **Direct** | Source register |
| Outsourced billets | Purchased billets | record form | outsourced_billet_batches → foundry_billets | Billets | Vendor | Allocation, expenses | — | **Direct** | — |
| Billet allocation | Billet → order | `components/modules/foundry/billet-allocation-client.tsx` | foundry_billets, order_billet_requirements | Allocation | Cast billets | Production | Priority, alloy, temper, diameter | RPC | Allocation panel |
| Production | Extrusion jobs | `lib/actions/production.ts`, press schedule grid | production_jobs, production_plan_slots, production_job_status_history, scrap_records | Output, scrap | Billets, die, press | QC, finishing, packaging, scrap, order stage | Mass balance ±1%; slot release; status machine | RPC | Production report, recovery |
| Dies | Tooling asset | `components/modules/dies/*` | dies, die_trials, die_corrections, die_nitriding_history, entity_revisions | Readiness | — | Scheduling | Versioned update RPC | Direct + RPC | Die intelligence |
| Machines and maintenance | Equipment | `app/(dashboard)/maintenance`, record form | machines, maintenance_schedules, breakdown_logs, maintenance_spare_parts, breakdown_spare_part_usage | Status, downtime | Spare parts | Scheduling, expenses | Spare-part stock check (insert only) | **Direct** | Maintenance board |
| Quality | Release | record form (quality) | quality_inspections, quality_rework_resolutions | Approved kg | Completed jobs, finishing receipts | Dispatch readiness | Disposition ≤ source; terminal immutability | Direct + triggers | Pass rate |
| Finishing | Coat or anodize | `lib/actions/finishing.ts` | finishing_jobs, finishing_status_history | Accepted kg | Completed jobs | QC, packaging | Terminal evidence | RPC | Finishing board |
| Packaging | Pack and materials | `lib/actions/packaging.ts` | packaging_jobs, packaging_job_materials, packaging_material_movements, packaging_materials, packaging_material_purchases | Packed jobs | Materials | Dispatch readiness | Material evidence append-only | RPC + direct (materials) | — |
| FG stock and reservations | Stock fulfilment | `lib/inventory/*` | profile_stock_batches, profile_stock_reservations, profile_stock_consumptions | Holds and consumption | Stock batches | Dispatch | Capacity guards | RPC + direct | Reservation ledger |
| Dispatch | Shipment | `lib/actions/dispatches.ts`, `lib/pcda/dispatch.ts` | dispatches, packing_list_items, dispatch_status_history | Shipped kg | Production, reservations, dealer fulfilments | Invoice, order stage | Activation authorization; readiness; POD | RPC (+ direct updates allowed) | Dispatch KPIs |
| Invoices and receivables | Billing | `lib/actions/invoices.ts`, `payments.ts`, `credit-notes.ts` | invoices, invoice_items, payments, credit_notes | Receivables | Packing rows | Dashboard | Packing coverage; idempotency; settlement exclusivity | RPC | AR, collections |
| Expenses | Payables | `lib/actions/expenses.ts`, `lib/financials/*` | expense_ledger, expense_payments, expense_supplier_credits | Payables | Source receipts | Dashboard | Approval policy; duplicate bill | RPC + triggers | Expense KPIs |
| Inventory | Generic stock | record form (inventory) | inventory_items, inventory_movements, inventory_transactions | Balances | Source triggers | Dashboard | Clamp at 0 | **Direct** | Low stock |
| Dealer | Dealer orders and stock | `lib/enterprise/dealer-workflows.ts`, `app/api/dealer-*` | dealers, dealer_orders, dealer_receipts, shipments, order_dealer_stock_fulfillments | Dealer stock | Orders | Dispatch | Dealer isolation | API + RPC | Dealer inventory |
| Configurator | Window/door BOM | `lib/systems-configurator/*` | system_* | Quotes | Profiles, hardware, glass | Quotes, orders | Lifecycle guards | RPC | Configurator PDFs |
| Reports and analytics | MIS | `lib/reports/*`, `lib/analytics/*` | views and RPCs | — | All | — | Single-source SQL snapshot | RPC | Dashboard, command center, report builder |
| Auth and access | Tenancy, RBAC | `lib/auth/*`, `proxy.ts` | app_users, roles, invitations, permissions | — | — | All | `get_current_user_company_id`; role functions | RPC | Audit logs |

## Sources of truth and duplicates

| Quantity | Authoritative | Duplicate / competing | Risk |
| --- | --- | --- | --- |
| Foundry source metal | `foundry_*_sources.available_weight_kg` (mutable) | `inventory_items` scrap and ingot `current_stock` | Diverge on charge (022); editable (003) |
| Billets | `foundry_billets` | `billet_batches` (legacy, still on scan and QR pages) | Two billet registers |
| FG stock | `profile_stock_batches` | `inventory_items` (finished_goods category), `inventory_transactions` (dealer) | Three stock models, none linked |
| Order delivered state | `orders.current_stage` | Derived from dispatches by `sync_order_delivery_stage` | Can be forced (017) or stuck (018) |
| Die production history | `dies.total_production_kg` (manual) | Σ completed `production_jobs` | Never reconciled (020) |
| Machine availability | `machines.status` (free text) | `breakdown_logs` / `maintenance_schedules` (text machine_id) | Unlinked (027) |

## Dependency map (simplified)

```
Vendors ─► Foundry sources ─► Foundry batches ─► Billets ─► Allocation ─► Production ─► QC ─► Packaging ─► Dispatch ─► Invoice ─► Payment
                 ▲                                    ▲            │  ▲            │
                 └──────────── process scrap ◄────────┼────────────┘  │            └─► Finishing ─► QC
Outsourced receipts ──────────────────────────────────┘     Dies/Presses/Maintenance┘
Profiles/Customers/Quotes ─► Orders ─► (requirements, production, dispatch, invoice)
FG stock / Dealer stock ─► Reservations / Fulfilments ─► Dispatch
```

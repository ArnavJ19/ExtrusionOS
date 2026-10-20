# Report 6 — Remediation Roadmap

Every change below should be an additive migration (CLAUDE.md §5.3), released in the same PGlite-first, then hosted-apply pattern the project already uses.

## Wave 1 — Immediate integrity and operational risks (go-live blockers)

| # | Fix | Findings | Migration / data work | Regression risk |
| --- | --- | --- | --- | --- |
| 1 | Revoke client INSERT on `scrap_records`; add `post_production_scrap_atomic` (role, job, balance) and a reversal RPC | 002 | Review existing manual scrap rows and their foundry lots | Completion RPC must keep inserting through the definer path |
| 2 | Freeze `available_weight_kg` and `status` on foundry sources (trigger guard or column privilege); add `CHECK available ≤ weight`; block weight below consumed; fix `record-form-client.tsx:846` | 003 | **Reconcile live `SCR-2026-0001/0002` and `EAS-2026-0003`**; recompute available = weight − Σ non-cancelled charges | Source edit UI for vendor or invoice fields |
| 3 | Extend the billet commitment guard to outsourced billets; sync cancels surplus and cancelled-receipt billets | 004 | Audit outsourced receipts edited after consumption (compare `updated_at` with billet `consumed`) | Outsourced receipt edits before use |
| 4 | Remove the tenant-only `dispatches` policies; freeze logistics fields after activation; add a returns RPC | 011, 033 | None | Dispatch delivery UI uses the RPC already |
| 5 | Restrict `machines` and `dies` updates to authorized roles; status CHECK; return-to-service RPC | 008 | Normalize `machines.status` values | Machine form |
| 6 | Order-stage sync must not trip the allocator role guard | 009 | None | Allocation still runs for factory roles |
| 7 | Derive reservation packing `order_item_id`, rate and GST server-side; reject client values | 010 | Link existing reservations to order lines | Dealer-stock and production paths unchanged |
| 8 | Die overlap check at schedule, release and start | 007 | Review currently released slots for conflicts | Press schedule grid |
| 9 | QC approval: `approved_by`, role segregation, spec tolerance check; audited dual control on the gate flag | 012 | Backfill `approved_by` as unknown for history | Rework resolution path |
| 10 | Force `actor_id = auth.uid()` on audit tables; revoke client inserts | 019 | None | Client-side audit writes in `data-center-client.tsx` |
| 11 | Revoke EXECUTE on `public.save_dispatch_atomic`, or drop `p_order_stage` | 017 | None | None (app uses `save_ready_dispatch_atomic`) |

## Wave 2 — Manufacturing and cross-module corrections

| # | Fix | Findings |
| --- | --- | --- |
| 12 | Cast-result step: actual count, measured weights, rejects, dross; chemistry test entity; `ready` gate for allocation | 001 |
| 13 | Charge lines with alloy; scrap lots with alloy and origin FKs; compatibility matrix | 005, 006 |
| 14 | Categorised completion scrap (recoverable or unrecoverable) feeding foundry lots | 006 |
| 15 | Require input evidence for completion (or an audited exception) | 014 |
| 16 | Release billets on job cancel; block saves on terminal jobs; separate physical issue step | 015, 031 |
| 17 | Disposition workflow for rejects and returns; quarantine stock; partial credit notes | 016, 025 |
| 18 | Finished-goods stock origin and QC status columns; production-surplus receipt path | 013, 024 |
| 19 | Maintenance lifecycle tied to `machines` (FK), downtime intervals, reversible spare-part usage | 027 |

## Wave 3 — Financial, reporting and workflow reliability

| # | Fix | Findings |
| --- | --- | --- |
| 20 | Period close and backdating control; payment date ≥ invoice date | 023 |
| 21 | Decide the billing basis; separate HSN lines for die and freight charges; honour `invoice_calc_uom` | 026 |
| 22 | Delivery-stage tolerance or short-close; exclude resolved exceptions | 018 |
| 23 | Inventory: movement-sourced balances, reject negatives, foundry consumption movements | 022 |
| 24 | KPI dictionary and single-source SQL metrics (good-output recovery, net shipped) | 028 |
| 25 | Die history derived from production; freeze die identity | 020 |
| 26 | Master-data versioning or impact checks for profile changes | 021 |

## Wave 4 — Architecture and preventive controls

- **Principle:** no browser-side writes to stock, metal, quality, logistics or audit tables. `RecordFormClient`'s generic `insert/update` path (`record-form-client.tsx:852-853`) should be limited to pure master data (customers, vendors), and everything else moved to definer RPCs.
- Revoke TRUNCATE and `anon` DML grants (030). Add a policy linter: no tenant-only write policy on any table listed in a stock or financial registry.
- Plausibility limits on receipts (029). Fix the dead "Create Task" route (032).
- Purchase order / goods receipt, general ledger integration (Tally export), NCR and customer complaints, chemistry lab, OEE (missing functionality).
- Make the PGlite live-catalog harness (`harness/`) part of CI so every migration runs the reproductions as regression gates.

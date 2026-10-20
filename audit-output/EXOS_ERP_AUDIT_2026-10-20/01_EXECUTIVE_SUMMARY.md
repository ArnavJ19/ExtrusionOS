# Report 1 — Executive Audit Summary

**Question:** If ExtrusionOS were deployed tomorrow as the system of record for an operating aluminium extrusion plant, what could cause it to fail, and what evidence supports that?

## Verdict

**Not fit to be the system of record for metal, billets, quality release or dispatch.** It is suitable for a supervised pilot of the commercial layer: quotes, orders, invoices and receipts.

The commercial and finance core has been hardened through many earlier audit rounds and holds up well:
- tenant isolation;
- payment idempotency;
- invoice-line canonicalization against packing rows;
- quote calculation parity between TypeScript and SQL;
- foundry source row locking;
- completion mass balance when billets are linked;
- dispatch activation authorization.

The physical layer does not yet represent physical reality:
- **Metal can be created from nothing.** Any user can post process scrap, and it becomes clean, available furnace metal (001, 002).
- **Metal can be reused.** Consumed scrap lots return to full availability on a routine edit (003).
- **Metal can be relabelled after the fact.** Consumed outsourced billets get a new alloy and weight when the receipt is edited (004).
- **Billet stock equals the plan, not the cast.** Rejects cannot be recorded, chemistry cannot be entered after the melt, and billets are allocated before homogenization (001).
- **Alloy segregation is not enforced.** The charge accepts other alloys, and scrap has no alloy (005, 006).
- **Physical impossibilities are accepted.** One die can run on two presses at once (007). Any user can return a broken-down press to service (008).
- **Quality release is advisory.** Out-of-spec results can be approved, the producer can approve their own output, and the gate is a feature toggle (012).
- **Dispatch staff cannot record delivery updates** because a billet-allocation role check vetoes them (009). Stock-reservation shipments cannot be made from the app, and the RPC accepts a client-chosen price (010).
- **Shipped transport documents can be rewritten by any user**, who can also mark the shipment returned, which enables a 100% credit note (011, 016).
- **Finished-goods stock has no genealogy** to a job, heat or QC result (013).

## How this was verified

- Built an isolated **PGlite replica of the live hosted catalog**: 3,147 columns, 294 functions, 281 triggers, 582 policies, grants, and 0 load failures. Reproductions ran as the PostgREST `authenticated` role under live RLS.
- **31 reproductions confirmed** (30 SQL scenarios plus the app packing-builder run), 3 negative controls held (tenant isolation, viewer invoice and payment blocks), 1 hypothesis was not reproduced (viewer production-job insert), all saved in `harness/results/`.
- Only read-only catalog and aggregate queries were run against the hosted database. No application source, migration, configuration or hosted record was changed.
- Live data already shows the defects. `SCR-2026-0001` has 999,100 kg of unexplained availability, and `EAS-2026-0003` is a 100,000-tonne receipt.

## Most consequential findings

| ID | Finding | Sev | Evidence |
| --- | --- | --- | --- |
| 001 | Casting records planned billets, not cast reality; no rejects or post-melt chemistry; allocated before ready | P1 | Tested |
| 002 | Any user creates recyclable foundry metal from nothing; uncorrectable | P1 | Tested |
| 003 | Foundry source balances hand-editable; edit resurrects used lots; live drift | P1 | Tested + live |
| 004 | Outsourced receipt edit rewrites consumed billets; surplus or cancelled billets stay in stock | P1 | Tested |
| 007 | One die on two presses simultaneously | P1 | Tested |
| 009 | Dispatch roles cannot record delivery status | P1 | Tested |
| 010 | Reserved-stock dispatch impossible in the app; RPC prices from any line | P1 | Tested |
| 011 | Any user rewrites e-way bill, LR and vehicle after shipment, and marks it returned | P1 | Tested |
| 012 | QC approval ignores measured results; self-approval; gate toggle | P1 | Tested |
| 013 | Finished-goods stock without production, heat or QC origin | P1 | Static |

The full register (33 findings: 13 P1, 14 P2, 6 P3, plus a missing-functionality table) is in `02_DEFECT_REGISTER.md`.

## Modules with the highest exposure

1. **Foundry and metal sources:** 001–006, 029.
2. **Dispatch and logistics:** 009, 010, 011, 017, 018, 025.
3. **Quality release:** 012, 016.
4. **Machines, dies and maintenance:** 007, 008, 020, 027.
5. **Inventory ledger:** 013, 022.

## Main traceability weaknesses

- Heat to billet is a 1:1 plan, with no record of what was cast (001).
- Scrap and remelt lose alloy and origin (005, 006).
- Outsourced billet lineage can be rewritten (004).
- Stock and dealer finished goods have no origin (013).
- Rejects and returns leave the material graph (016).

See `04_TRACEABILITY_REPORT.md`.

## Go-live blockers (Wave 1)

1. Close the direct-write paths to stock-bearing tables: scrap records, foundry sources, outsourced receipts, machines, dies, dispatches, audit logs (002, 003, 004, 008, 011, 019).
2. Fix the dispatch-role veto (009) and the reservation dispatch lineage (010).
3. Add the die-overlap check (007) and the QC release rules (012).
4. Reconcile the live foundry source rows (003, 029) before any data is migrated in.

## Questions only the business can answer

- What is the recovery and recoverability rule for each scrap category, and is any loss treated as unrecoverable (006)?
- Billing basis: theoretical, actual or minimum weight? Are die and freight charges separate invoice lines (026)?
- Should master-data changes (profile kg/m, alloy, billet size) apply to open work (021)?
- Does a period-close and backdating policy exist (023)?
- May production managers approve QC, and who may disable the QC gate (012)?
- Is pre-shipment invoicing against a *pending* dispatch allowed? It currently is for non-cancelled orders (`invoice_dispatch_is_billable`).

## Not verified (blocked or out of scope)

- Real JWT sign-in, Storage and browser UI journeys. A parallel session is running native local Supabase acceptance; this audit did not drive the UI.
- Multi-session concurrency was analyzed statically (locks reviewed), not raced.
- Expense, finance and PDF modules were spot-checked only and rely on the 20 October finance remediation (57 findings).
- The systems configurator and dealer workflows were not re-audited beyond the dealer stock entry (024).
- Historical physical and stock accuracy cannot be checked: the live database holds only test data (10 orders, 48 billets, 0 invoices, 0 inventory items).

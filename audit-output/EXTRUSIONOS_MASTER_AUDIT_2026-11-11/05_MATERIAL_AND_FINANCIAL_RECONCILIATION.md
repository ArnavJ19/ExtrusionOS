# Material and Financial Reconciliation

The audit reproduced inconsistencies that prevent reliance on the current candidate as the sole factory record. Fixture values below are synthetic. They establish behavior and do not estimate historical loss, tax liability, or the size of any real stock correction.

| Ledger | Authoritative basis and reconciliation | Evidence and limit |
|---|---|---|
| Foundry mass | Measured charge by source and heat = good cast kg + recoverable reject kg + dross kg + measured or authorized residual loss | MFA-002 accepted impossible output and omitted dross from the residual. Estimated billet mass is a plausibility control. Approved instrument tolerance and actual weigh sheets are still needed. |
| Billet stock | Opening measured kg + cast/outsourced receipts + actual returns − physical issues − approved write-offs | Individual status and source IDs exist. MFA-004 blocks an honest 60 kg issue completion because the other 180 kg is allocated. Remnant genealogy and actual press compatibility require approved site inputs. |
| Finished stock | Physical on hand, open reservations, QC disposition, in-transit and ownership in separate columns | Canonical fixture gives 100 kg on hand, 20 reserved and 80 available. The dashboard labels 100 kg reserved. One partial reservation or snapshot status cannot stand in for open-reservation quantities. |
| Scrap | Job scrap by category → scrap lot → reuse charge or sale, with net scale weight and source lineage | Engineering estimates and physical scrap ledger need a bridge. The casting reject path uses theoretical weight and the dross residual is wrong. Reconcile measured dross, recoverable scrap and historical losses separately. |
| Packaging materials | Opening + approved receipt/return − packaging issue ± recorded corrections per item and unit | Movement evidence is protected on selected paths. Packaging master quantities and inventory purchase-ledger quantities require an explicit item mapping and buy-use-reverse proof. AP-005 remains open. |
| Dealer stock | Accepted receipts + documented dealer openings − dealer fulfilment ± returns, by bundle/length/owner | Receipt and fulfillable physical stock have distinct projections. Shortage resolution and a 99-of-100 accepted receipt need a bridge through stock and order fulfilment. |
| Dispatch | Packed verified net weight and pieces → measured departure → delivered/short/returned disposition | Source provenance, packing holds and return records exist. Verify tare, tolerance, scale calibration, partial reversals and stock/order balances under a failed or repeated gate-out. |
| Receivables | Posted invoice − valid receipts − valid credits + reversals = open balance; unapplied money remains a separately identified liability/credit | Focused allocation and on-account fixtures passed. The bank import can omit an incoming deposit or suppress an ambiguous second receipt. Operational aging should be reconciled to statement, posted allocations and external books. |
| Supplier payables and costs | Approved accepted receipt, supplier invoice, debits/credits and disbursements on a common valuation basis | Purchase/receipt and expense flows cover parts of the chain. A complete actual-cost, WIP, COGS and general-ledger close was outside verified coverage. |

## Independent Calculation Control

A quote with 10 pieces at 2 m and 1.5 kg/m produced 20 m and 30 kg. At 75% recovery the billet input was 40 kg. At INR 200/kg it cost INR 8,000. A 10% selling margin gives INR 8,888.89 before tax, and the configured 18% test rate gives INR 10,488.89. The TypeScript calculation matched the independent oracle. This is one synthetic combination. The audit did not establish parity for every mix of split GST, historical snapshots, approved overrides, minimum billing weights or separate die/freight charges. [Calculation output](evidence/business-invariants-verified.log)

## Engineering and Operational Sign-Off

The configurator has distinct formula inputs, saved BOM, cutting/glass outputs and an approved production release snapshot. Existing regression cases cover stale inputs, rule/output changes and missing release data. The factory still needs approved section drawings and system dimensions, hardware applicability, glass clearances, cut/waste tolerances, revision agreement and actual material reservations for representative sliding, casement, fixed and door projects.

The operating reconciliation must name the approved source document, owner, location, material or balance unit, period and exception approver for every discrepancy. Legacy balances, approved recipes, alloy limits, customer ownership and statutory invoicing remain external acceptance inputs. Domestic GST calculations alone do not establish statutory compliance.

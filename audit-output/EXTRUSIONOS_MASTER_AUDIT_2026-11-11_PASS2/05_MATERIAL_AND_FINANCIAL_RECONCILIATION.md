# Material and Financial Reconciliation

**Verdict.** Money recording is dependable at the point of receipt. Metal accounting is not: the foundry can create metal on paper, and production cannot close a partially issued job honestly. All figures below are synthetic test values, not Omalco's stock or books. No physical count or bank statement was reconciled.

## Metal mass balance — fails

Required: charged kg = good cast + recoverable rejects + dross + documented loss.

| Heat | Charged | Good | Dross | Stored melt loss | True residual |
|---|---|---|---|---|---|
| A | 65.670 | 74.864 | 5.000 | −9.194 | −14.194 |
| B | 65.670 | 62.000 | 4.000 | +3.670 | −0.330 |

Both were accepted (PA2-002). Heat A creates 14 kg of metal. Dross is recorded but left out of the loss figure. Reject scrap is valued at theoretical billet weight rather than a weighed figure, and is dated with the database server's date rather than the India business date (AP-014).

Chemistry is not a control either: a 120 % composition passed and was approved (PA2-003).

## Billet stock — unreliable around partial issues

A job with 60 kg issued and 180 kg allocated cannot be completed with 60 kg of output and scrap (PA2-004). Until that is fixed, billet balances after partial issues depend on operators working around the refusal. Remnants, returns and press-diameter compatibility were not tested.

## Finished stock — reservation basis now correct

A 100 kg batch with a 20 kg reservation reports 20 kg reserved, 80 kg available, on both the dashboard and the ledger (earlier defect MFA-005 no longer reproduces). Hold, in-transit and customer-owned quantities were not tested. A malformed response still displays as zero stock rather than "unavailable" (PA2-012).

## Scrap — not independently reconciled

No scrap ledger test was run in this pass beyond the casting case above. Scrap from production cannot be recorded honestly for a partially issued job (PA2-004).

## Packaging materials — fails

| Event | `inventory_items` | `packaging_materials.current_stock` |
|---|---|---|
| Purchase 100 m | 100 m | 0 m |

Packing consumes from the second balance, which the purchase never credits (PA2-007).

## Dealer inventory — not tested

Dealer isolation at the row level held (a dealer sees no internal invoices, rates or customers). Receipt, shortage and fulfilment balances were not exercised (AP-006, AP-007 stay open).

## Dispatch — not independently reconciled

A dispatched record cannot be deleted. Weighbridge, partial delivery, failed gate-out and the stock effect of a repeated dispatch were not run in this pass.

## Receivables and settlement — holds at the receipt

Invoice total − live receipts = balance held on all eight test invoices, including after racing receipts and racing reversals ([04](04_CROSS_MODULE_INTEGRITY.md)). Direct edits to invoices and payments by the accounts role were refused. The bank import now keeps a deposit as a credit and keeps both of two identical receipts (earlier MFA-006 and MFA-007 no longer reproduce).

Open: the credit gate treats an unpriced dispatch as ₹0 exposure (MFA-013, source only); advances, credit notes and refunds were not tested; a receipt of ₹100.005 is accepted as ₹100.01 by direct call (PA2-020).

## Quote costing — arithmetic verified, one basis question

| Check | Result |
|---|---|
| Hand-worked control (10 pcs × 2 m × 1.5 kg/m, 75 % recovery, ₹200/kg, 10 % margin, 18 % GST) | ₹10,488.89, matches |
| 600 random lines, TypeScript versus SQL | 597 identical; 3 differ by at most ₹0.60 (PA2-018) |
| Header totals over those 600 lines | Identical to the paisa |
| Recovery 0 % or 101 %, margin 100 % or negative, negative pieces, GST 150 %, zero section weight, overflow | All refused |
| Negative billet rate by direct insert | Stored (PA2-017; the form refuses it) |
| Quoted kg × stored rate per kg = quoted amount | **No**: 464 of 600 lines differ by more than ₹1, worst ₹395 on ₹8.59 lakh (PA2-010) |

The last row matters if invoices are raised at rate × dispatched kg: a fully shipped order would then invoice slightly more or less than the accepted quotation. Which basis the invoice writer uses was not traced. Minimum billing weight, split GST and revision snapshots were not independently tested.

## What management should take from this

| Question | Answer |
|---|---|
| Can receipt and balance figures be trusted? | Yes at the receipt, on the evidence here. Not yet against a real bank statement |
| Can foundry yield and billet stock be trusted? | No |
| Can packaging stock be trusted? | No |
| Can finished-goods reservation figures be trusted? | The one tested case is now right |
| Is GST output statutorily correct? | Not assessed; needs an accountant |

Before go-live, a signed opening count by location and lot, and one month's parallel run against the existing registers, are still required whatever the software fixes.

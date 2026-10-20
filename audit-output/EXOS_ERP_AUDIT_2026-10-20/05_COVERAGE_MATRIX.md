# Report 5 — Module Coverage Matrix

Status: **Tested** (harness execution) · **Inspected** (static, live bodies read) · **Partial** (spot checks only) · **Relied** (relied on the prior register, not re-audited) · **Not audited**.

| Module | Workflows identified | Inspected | Executed tests | Findings (P1/P2/P3) | Status | Gaps / next steps |
| --- | --- | --- | --- | --- | --- | --- |
| Foundry batches and casting | 5 (plan, charge, melt, cast, ready) | 5 | 4 (R4, R5a–d) | 2/0/0 (001, 005) | Tested | Concurrency of two batches on one source (locks reviewed, not raced) |
| Foundry sources (scrap, external) | 4 (receive, edit, charge, return) | 4 | 3 (R2, R3, live query) | 1/0/1 (003, 029) | Tested | External-source return/`returned` status path |
| Process scrap loop | 3 | 3 | 3 (R1, R1b, R1c, P3) | 2/0/0 (002, 006) | Tested | — |
| Outsourced billets | 3 (receive, edit, cancel) | 3 | 3 (O1–O3) | 1/0/0 (004) | Tested | Expense side covered by EXP-20 (prior) |
| Billet allocation (auto/manual) | 4 | 3 | via P4b | 0/0/1 (031) + 009 effect | Partial | R22–R25 relied on |
| Production planning and schedule | 4 | 4 | 1 (P1) | 1/0/0 (007) | Tested | Rescheduling of held jobs (F02 relied) |
| Production execution and completion | 5 | 5 | 3 (P2, P3, P7) | 0/2/1 (014, 015, 031) | Tested | Output correction path reviewed only |
| Dies | 5 (register, status, revision, nitriding, history) | 4 | 2 (R6b, C4) | 0/1/0 (020) + 008 | Tested | Die trials and corrections tables not audited |
| Machines and maintenance | 5 | 4 | 1 (R6a) | 1/1/0 (008, 027) | Tested | Energy readings and expense sync not audited |
| Quality | 4 (inspect, approve, reject, rework) | 3 | 1 (P5) | 1/0/0 (012) | Tested | Rework resolution RPC relied (B02) |
| Finishing | 5 | 2 | 0 | via 016 | Partial / Relied | R17–R20 relied on |
| Packaging and materials | 4 | 2 | 0 | via 025 | Partial | R19 relied on; material stock reversal not audited |
| Finished-goods stock and reservations | 4 | 3 | 2 (P6a, P6b) | 2/0/0 (010, 013) | Tested | R04/R05/R10 relied on |
| Dealer stock and dealer workflows | 6 | 2 | 0 | 0/1/0 (024) | Partial | Dealer order workflow, receipts, isolation (A01 relied) |
| Dispatch and logistics | 6 | 6 | 4 (P4, P4b, C1, P6) | 2/3/0 (009, 011, 017, 018, 025) | Tested | — |
| Quotes and costing | 3 | 3 | 0 | 0/1/0 (026) | Inspected | Low-margin approval relied (BL-04) |
| Orders and direct orders | 4 | 3 | via seeds | via 017, 018 | Partial | R08/R10/R11 relied |
| Invoices | 4 | 4 | N2 (control) | 0/1/0 (023) | Inspected | Supplier-snapshot candidate unapplied (prior) |
| Payments, credit notes, refunds | 5 | 3 | N3 (control) | via 016, 023 | Inspected / Relied | R02/R03/R06/R07 and the finance 57 relied on |
| Expenses and vendor payables | 6 | 1 | 0 | — | Relied | Finance remediation 20 Oct relied on |
| Inventory items and movements | 3 | 3 | 1 (R7) | 0/1/0 (022) | Tested | No live rows to reconcile |
| Reports, dashboards, analytics | 4 | 3 | 0 | 0/0/1 (028) | Inspected | Report builder exports not audited |
| PDFs | 7 | 0 | 0 | — | Relied | `pdf fix.MD` handover relied on |
| Auth, tenancy, roles, invites | 5 | 3 | 3 (N1–N3) | 0/1/2 (019, 030, 033) | Partial | Real JWT and Storage being tested by a parallel session |
| Audit logs | 2 | 2 | 1 (C3) | 0/1/0 (019) | Tested | — |
| Master data: profiles and customers | 3 | 2 | 1 (C5) | 0/1/0 (021) | Tested | Customer master not audited |
| Systems configurator | 6 | 0 | 0 | — | Relied | Astra findings relied on |
| CRM, tenders, AI, communications, portal | 6 | 0 | 0 | — | Not audited | Low operational exposure |
| Tasks and notifications | 2 | 1 | 0 | 0/0/1 (032) | Partial | — |

**Totals:** 33 findings (13 P1, 14 P2, 6 P3). 31 confirmed reproductions, 3 negative controls held, 1 hypothesis not reproduced (C2).

## Static validations performed (not executed)

- Review of the live function bodies behind every trigger listed in `harness/catalog.json`, for the stock, production, dispatch, invoice and payment tables.
- RLS policy review for all write-capable policies on 30 business tables.
- Grant review (`role_table_grants`, function EXECUTE grants).
- KPI formula review: `get_dashboard_snapshot`, the command center, PCDA recovery.

## Explicitly not verified

UI and browser journeys, real JWT and Storage, independent-session races, historical and physical data accuracy (the live database holds test data only), PDF content, and email and WhatsApp side effects.

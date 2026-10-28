# Report 5 — Module Coverage (pass 2)

Status labels:

- **Tested:** executed in the replica.
- **Inspected:** live bodies and policies read.
- **Hosted:** read-only data query.
- **Relied:** on the 20 Oct audit or the finance and BUGS-MEGA registers.
- **Not audited.**

| Module | Workflows (identified / inspected) | Executed scenarios | Findings | Status | Gaps |
| --- | --- | --- | --- | --- | --- |
| Foundry batches, cast result, chemistry | 6 / 6 | R05 | 003, 009, 016 | Tested + Hosted | Multi-source charge per type |
| Metal sources (scrap, external) | 5 / 5 | R02a–c | 004, 017, 020 | Tested + Hosted | — |
| Billet issue and production completion | 5 / 5 | R06 | 002, 018 | Tested | Output correction after issue |
| Dispatch | 6 / 6 | R01a–d, R04b | 001, 008 | Tested | Reservation-sourced dispatch delete (cascade to consumptions) not executed |
| Finishing | 5 / 4 | R04a | 010 | Tested | Retry path relied on |
| Packaging and materials | 5 / 4 | R07 | 011 | Tested | — |
| Maintenance, machines, calibration | 6 / 6 | R03 | 005, 022 | Tested | Energy readings relied on |
| Dies (corrections, trials) | 4 / 3 | R03c | 005 | Tested | Die health metrics not audited |
| Master data: profiles, customers | 4 / 3 | R08 | 006 | Tested | Customer CASCADE paths inspected only |
| FG stock and reservations | 4 / 2 | R08 | 006 | Partial | Direct reservation writes relied on (Astra/R05) |
| Dealer receipts, discrepancies, dealer stock | 6 / 5 | — | 012, 013 | Inspected | Not executed |
| Storage | 9 buckets / 9 | — | 014 | Hosted | Signed-URL lifetime not checked |
| Audit logging | 2 / 2 | R03, R08 | 015 | Tested | — |
| Invoices, payments, credit notes | 6 / 3 | negative control R01a | — | Inspected / Relied | Finance pass of 20 Oct relied on |
| Orders | 4 / 2 | R01b (negative) | — | Inspected | — |
| Operator workflows (`20261022000000`) | 7 commands / 7 | — | 022 | Inspected | — |
| Access: invites, roles | 3 / 3 | — | via 015 | Inspected | Real JWT not tested |
| Deployment and migrations | 2 / 2 | fingerprint | 007 | Tested + Hosted | Fresh replay not run (A00 open) |
| Time and dates | 1 / 1 | — | 019 | Inspected + Hosted | — |
| Quotes and costing | — | — | — | Relied | |
| Configurator, CRM, tenders, portal, AI, PDFs, report builder | — | — | — | Not audited | Low operational exposure |

**Totals:** 22 findings (7 P1, 11 P2, 4 P3) and 2 IMP. 10 executed scenario groups. 8 negative controls held.

## Tables with client write policies and no audit trigger (116 of 148)

The full list is in `harness/no-audit-tables.txt`. Business-critical members:

`foundry_batches`, `foundry_aluminium_scrap`, `foundry_external_aluminium_sources`, `outsourced_billet_batches`, `order_items`, `order_billet_requirements`, `packaging_jobs`, `packaging_materials`, `packaging_job_materials`, `profile_stock_reservations`, `inventory_discrepancies`, `inventory_transactions`, `shipment_items`, `breakdown_logs`, `breakdown_spare_part_usage`, `calibration_records`, `maintenance_schedules`, `die_corrections`, `die_trials`, `production_plan_slots`, `roles`, `user_roles`, `role_permissions`, `companies`, `dealers`.

# Historical Findings Revalidation (AP-001 to AP-043)

Source register: `AUDIT_PENDING_2026-10-22.md`. Status is at HEAD `a0ef08d`.

**Basis column.** *Rerun* = reproduced or disproved by a script in this pass. *Checked* = source lines or hosted catalog re-read in this pass. *Carried* = status taken from the earlier same-day audit and not re-examined; treat as that audit's claim, not mine.

| ID | Topic | Status now | Basis | Note |
|---|---|---|---|---|
| AP-001 | Allocation versus issue | **Still reproduced** | Rerun | PA2-004 |
| AP-002 | Foundry mass conservation | **Still reproduced** | Rerun | PA2-002 |
| AP-003 | Storage role and ownership | **Still reproduced** for six buckets; fixed for `documents`, `technical-drawings`, `maintenance-bills` by policy presence | Rerun (policy level) | PA2-005. Customer-level ownership untested |
| AP-004 | Chemistry specification | **Still reproduced** | Rerun | PA2-003 |
| AP-005 | Packaging stock | **Still reproduced** | Rerun | PA2-007 |
| AP-006 | Dealer receipt discrepancies | Partially remediated | Carried | End-to-end shortage case not run |
| AP-007 | Dealer stock sources of truth | Requires operational verification | Carried | |
| AP-008 | Audit-history completeness | Partially remediated | Rerun (part) | Owner cannot edit or delete four audit tables (verified). Coverage of role changes is moot until role changes exist (PA2-001) |
| AP-009 | Historical metal reconciliation | Requires physical verification | Carried | |
| AP-010 | Downstream hold after rejection | Still open in source | Checked | PA2-011 |
| AP-011 | Partial billets and remnants | Partially remediated | Carried | |
| AP-012 | Dispatch weighing tolerance | Partially remediated | Carried | |
| AP-013 | Finishing weight basis | Requires operational verification | Carried | |
| AP-014 | India business dates and numbering | Partially remediated | Checked | Casting reject scrap still uses `current_date` at `20261021240000:473-475` |
| AP-015 | Purchased-metal valuation | Requires policy and verification | Carried | |
| AP-016 | Dormant generic master forms | Fixed in source | Carried | |
| AP-017 | Machine breakdown integration | Partially remediated | Carried | |
| AP-018 | Opening inventory approvals | Partially remediated | Carried | |
| AP-019 | Customer-history deletion | **Fixed and regression-verified** | Rerun | Customer with quotes cannot be deleted (foreign key). A sent quote itself can be (PA2-022) |
| AP-020 | Leaked-password protection | **Still observed on hosted** | Checked | PA2-014 |
| AP-021 | Company GST identity | Requires operational verification | Carried | |
| AP-022 | Quote headers without lines | Requires data reconciliation | Rerun (part) | A header-only quote is now refused validity extension |
| AP-023 | Legacy module switches | Partially remediated | Carried | |
| AP-024 | Custom roles | Still open | Carried | Not tested; fixed role list still governs |
| AP-025 | Capped overview queries | Still in source | Checked | MFA-012 |
| AP-026 | Multi-lot heat charge | Missing capability | Carried | |
| AP-027 | Procurement coverage | Partially remediated | Carried | |
| AP-028 | Manufacturing valuation | Partially remediated | Carried | |
| AP-029 | NCR corrective actions | Partially remediated | Carried | |
| AP-030 | Downtime and OEE | Partially remediated | Carried | |
| AP-031 | Customer advances and credits | Partially remediated; **now deployed** | Checked | `ap_cash` is present on hosted (the earlier audit found it absent). Advance and credit lifecycle untested |
| AP-032 | E-way bill integration | Missing integration | Carried | |
| AP-033 | Tax coverage | Domestic scope only | Carried | |
| AP-034 | Dedicated documents | Partially remediated | Carried | |
| AP-035 | Disposition deployment gap | Remediated; operator check open | Carried | |
| AP-036 | Migration and hosted parity | **Largely closed for code** | Rerun | All 1,097 function bodies identical. Ledger still unmappable by name; one hosted-only change (PA2-009); policies and grants not diffed |
| AP-037 | PDF acceptance | Requires signed-in acceptance | Carried | |
| AP-038 | Signed-in role acceptance | **Still open** | — | No audit has yet used the app signed in |
| AP-039 | Concurrency evidence | Partially remediated | Rerun | Receipts and reversals now verified with two sessions. Allocation, completion, dispatch untested |
| AP-040 | Physical and book reconciliation | Requires operational reconciliation | — | Not possible from the repository |
| AP-041 | Entry-assistance journeys | Partially remediated | Carried | |
| AP-042 | Production-volume performance | Not established | — | No load test in this pass |
| AP-043 | Numeric QC specifications | Requires approved specifications | Carried | |

## Summary

| Status | Count | IDs |
|---|---|---|
| Still reproduced or still observed | 6 | 001, 002, 003, 004, 005, 020 |
| Fixed and verified in this pass | 1 | 019 |
| Materially advanced in this pass | 3 | 031, 036, 039 |
| Still open in source, checked | 3 | 010, 014, 025 |
| Partly rerun in this pass | 2 | 008, 022 |
| Carried from the earlier audit, not re-examined | 24 | the rest marked Carried |
| Cannot be closed from the repository | 4 | 038, 040, 042, 043 |

The five items the brief gave top priority (AP-001 to AP-005) all still reproduce.

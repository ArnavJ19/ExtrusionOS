# Executive Summary

**NOT SAFE TO DEPLOY** the captured candidate as the system of record for Omalco. The audit reproduced false material balances, a blocked honest production completion, approval of impossible chemistry, and receipt-import behavior that can omit incoming money. Both local database replays passed. That proves the migrations can run in the tested environments while the workflow defects remain.

The register contains 13 confirmed findings: zero P0, six P1, four P2, three P3 and zero P4. Eleven were reproduced in application, fixture or test-suite execution. The other two are an affected dependency version match and a hosted Auth configuration observation. Strongly supported risks and the invitation-only release discrepancy are listed separately.

| Area | Management assessment |
|---|---|
| Physical inventory | A foundry heat accepted more good billet mass than was charged. Dross was excluded from stored melt loss. A 20 kg reservation showed as 100 kg, and a 100 m packaging purchase left packaging stock at zero. |
| Manufacturing | Ordinary completion compared a valid 60 kg issued job with 240 kg of issued-plus-allocated input. A separate quality fixture approved a 120% combined composition. |
| Traceability | There are durable links across much of the chain. Correct identity does not repair incorrect quantity or QC disposition. Mixed lots, rejected-source containment, vendor work and real backward trace from a customer dispatch remain open. |
| Financial records | The independent quote example and selected receipt allocation controls passed. The candidate bank import misclassified a deposit and discarded a second ambiguous receipt. Real statement, allocation, book and tax acceptance is pending. |
| Security | RLS presence and search-path pinning checked in the replay. Omalco invitation policy is not established across the deployed app, Auth and bootstrap. The lockfile matches critical Next.js advisories. |
| Release | The latest production deployment record references the older `0a5cc3d` revision. The linked database has selected newer objects, but no Batch 3 cash RPC. Current local and hosted artifacts cannot be treated as one release. |

## Highest-Risk Evidence

| Finding | Priority and evidence |
|---|---|
| MFA-001 Affected runtime dependencies | P1, confirmed versions. Next.js 16.2.11 appears in critical vendor ranges. |
| MFA-002 Impossible casting mass | P1, reproduced. 65.670 kg charged accepted 74.864 kg good and 5 kg dross. |
| MFA-004 Allocations counted as physical input | P1, reproduced. Honest completion was refused on the wrong mass basis. |
| MFA-003 Physically impossible chemistry approved | P1, reproduced. 60% plus 60% persisted as an approved pass. |
| MFA-006 Deposit classified as debit | P1, reproduced through parser and persisted import. |
| MFA-007 Ambiguous receipt discarded | P1, reproduced. Two INR 2,500 statement lines yielded one stored INR 2,500 line. |
| MFA-008 Invitation policy drift | P1, deployed-source and catalog discrepancy. Actual unauthorized app entry remains unverified. |
| MFA-005 Reserved stock overstatement | P2, reproduced against the canonical stock calculation. |
| MFA-017 Packaging stock disagreement | P2, reproduced. A 100 m purchase credited central inventory while the packaging balance stayed at zero. |
| MFA-009 Camera blocked | P2, reproduced with Chromium and the configured header. |

Begin with runtime dependency and access controls, then correct casting, chemistry, issue/completion and receipt handling. In parallel, bind the release to one reviewed app and database version. Factory use requires signed physical and financial reconciliation and operator acceptance. [Defect register](02_COMPLETE_DEFECT_REGISTER.md) · [Release gates](13_RELEASE_READINESS_DECISION.md)

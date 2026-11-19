# Executive Summary

**Verdict: NOT SAFE TO DEPLOY as Omalco's system of record**, at commit `a0ef08d`. The money side held up under attack. The metal side and user access did not.

21 confirmed findings: **0 P0, 6 P1, 5 P2, 7 P3, 3 P4**. Six more are strongly supported but not executed. Three defects from the earlier same-day audit are now fixed.

One caveat governs everything: **no one has yet used the application signed in**, in this or any earlier audit. Every result is from the database, the source, or test fixtures.

## Management questions

| Question | Answer |
|---|---|
| Is the ERP operationally trustworthy? | Not yet. Core foundry and production records can be wrong or cannot be completed |
| Is physical inventory reliable? | No for billets, foundry output and packaging. The one finished-stock reservation case tested is now correct |
| Can traceability be trusted? | The links exist and most parents cannot be deleted. The quantities and QC results carried along those links can be false, and a rejected source lot does not hold what was made from it |
| Are financial reports dependable? | Receipts, balances and reversals: yes, under racing sessions. Quote arithmetic: yes. Anything built on foundry yield or packaging stock: no. Statutory GST: not assessed |
| Is the access model secure? | Company isolation is solid. But a user cannot be suspended, and dealers can read and delete internal documents |
| Is the current release deployable? | The database code on hosted already equals the repository. It should not carry real operations until the six P1 items are fixed |
| What needs verification before factory use? | Signed-in walk-through per role on a staging project; real Storage; a physical opening count; one month's parallel run |

## Ten highest risks

| # | Finding | Priority | Evidence |
|---|---|---|---|
| 1 | No one can suspend a user or change a role; every staff-row update fails | P1 | Reproduced; same on hosted (PA2-001) |
| 2 | A cast can record more good metal than was charged; dross is left out of loss | P1 | Reproduced (PA2-002) |
| 3 | A 120 % chemistry result was passed and approved | P1 | Reproduced (PA2-003) |
| 4 | A job with a partial billet issue cannot be completed | P1 | Reproduced (PA2-004) |
| 5 | Any company login, including a dealer, can read, replace and delete quote PDFs and reports | P1 | Reproduced at policy level (PA2-005) |
| 6 | Next.js version has critical advisories | P1 | Version match (PA2-006) |
| 7 | A fresh environment built from the repository lets the first stranger become owner | P2 | Reproduced; hosted is protected by a change missing from the repository (PA2-009) |
| 8 | Packaging purchases do not reach the balance packing uses | P2 | Reproduced (PA2-007) |
| 9 | Scanner camera is blocked site-wide | P2 | Configuration confirmed (PA2-008) |
| 10 | Rejecting a metal lot does not hold its downstream heats, billets or stock | P1 if confirmed | Source only (PA2-011) |

## What held

- No cross-company read or write succeeded across 13 tables.
- Two receipts racing on one invoice: one accepted. Same receipt twice: one payment. Two reversals racing: one reversal.
- Staff roles could not edit invoices, payments or audit logs directly.
- 176 privileged database functions returned nothing to a stranger or a suspended user.
- 600 random quote lines: screen and database agree to within 60 paise.
- All 298 migration files replay; all 1,097 hosted functions match the repository.

## Changed since the earlier audit today

Fixed: bank deposit misread as a debit; second identical bank receipt dropped; dashboard reserving a whole batch. Suite failures down from seven to two. Autopilot batch 3 is now applied to hosted and its scheduled jobs have run five times successfully.

New in this pass: user offboarding (PA2-001), storage roles demonstrated (PA2-005), the repository-versus-hosted onboarding gap (PA2-009), dealer staff directory (PA2-016), bucket limits (PA2-019), sent-quote deletion (PA2-022), and the test-quality classification.

## Not covered

Signed-in use; real Storage; performance under volume; concurrency outside receipts; individual attack of each of the 100 November features; configurator engineering values; custom roles; invitations; advances and credit notes; real stock and books.

## Where to start

Upgrade Next.js, add the onboarding revoke to the repository, then fix user lifecycle and storage policies. That removes three P1 items with no workflow redesign and no input needed from the factory. The foundry and production fixes need three decisions from Omalco: weighing tolerance, alloy limits and recall policy. [Roadmap](12_REMEDIATION_ROADMAP.md) · [Release decision](13_RELEASE_READINESS_DECISION.md)

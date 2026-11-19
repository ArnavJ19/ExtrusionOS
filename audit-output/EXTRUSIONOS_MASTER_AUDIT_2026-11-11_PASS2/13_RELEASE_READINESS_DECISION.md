# Release Readiness Decision

## NOT SAFE TO DEPLOY

as Omalco's system of record for the factory, at commit `a0ef08d`.

This is about relying on it for real metal, stock and staff access. The hosted project already runs this database code with a single owner account and no stored files; that state is not itself dangerous. The decision is about what happens when staff, dealers and real transactions are added.

## Why

| Blocker | Finding | Evidence |
|---|---|---|
| A departed employee cannot be locked out from the app | PA2-001 | Reproduced; same policies on hosted |
| The foundry can record more metal than was melted | PA2-002 | Reproduced |
| Invalid chemistry can be approved for release | PA2-003 | Reproduced |
| A partially issued job cannot be closed honestly | PA2-004 | Reproduced |
| Any company login, including a dealer, can read and delete quote PDFs and reports | PA2-005 | Reproduced at policy level |
| Next.js version carries critical advisories | PA2-006 | Version match |
| No one has used the application signed in, in any role, in any audit | [08](08_UI_UX_AND_OPERATOR_AUDIT.md) | — |

## What is sound, within what was tested

- Company isolation: no cross-company read or write succeeded.
- Receipts, idempotency and reversals under two racing sessions.
- Direct tampering with invoices, payments and audit logs by staff roles.
- 176 privileged functions against a stranger and a suspended user.
- Quote arithmetic, 600 lines, screen versus database, to within paise.
- The migration chain replays cleanly; hosted function code equals the repository's.
- Three defects from the earlier audit are fixed (bank import ×2, reserved stock).

## What would change the decision

**To SAFE FOR CONTROLLED INTERNAL PILOT ONLY** (owner plus a few named office staff, no dealers, foundry and production figures kept in parallel on the existing registers):

1. Next.js upgraded and the audit clean of critical entries.
2. PA2-001 fixed and demonstrated: a test user is deactivated and loses access.
3. PA2-005 and PA2-019 fixed and demonstrated through the real Storage API as a dealer and a viewer.
4. The onboarding revoke in the repository; Auth sign-up confirmed disabled.
5. A staging project with one account per role, and the eight operator journeys walked through once.

**To CONDITIONALLY READY FOR PRODUCTION**, additionally:

6. PA2-002, 003, 004 and 007 fixed, with this audit's reproductions passing as regression tests.
7. Omalco's weighing tolerance, alloy limits and recall policy supplied and loaded.
8. Camera scanning working on the shop-floor phone.
9. A signed opening stock count and one month's parallel run that reconciles.
10. Two-session tests for allocation, completion and dispatch.

## Local versus hosted: what is and is not known

| Known | Not known |
|---|---|
| Hosted function code is identical to the repository (1,097 of 1,097) | Whether hosted policies, grants, triggers and constraints all match (only `app_users` and storage were checked by name) |
| Hosted has 1 company, 1 owner, 1 Auth user, 0 stored files | Whether Auth public sign-up is disabled |
| Onboarding grant is revoked on hosted | Which commit the live Vercel deployment is built from (the earlier audit saw `0a5cc3d`; not rechecked) |
| Three scheduled jobs run and succeed | Whether their output is correct |
| Batch 3 migrations are applied | Whether the deployed app's screens match them |

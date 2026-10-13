# Business-flow audit: 4 October 2026

## Decision

Not ready for business sign-off. Four additional high-priority failures were found in the handoffs between modules. They supplement, and do not replace, `AUDIT_2026-10-03.md`. No application code, migration, or hosted business data was changed by this audit.

The business question was whether a customer commitment can remain traceable and actionable from quotation through production, quality, delivery, and settlement. Passing individual module tests does not establish this.

## Findings

### B01 - P1: A part shipment prevents planning the remaining order

Scenario: a customer orders 1,000 kg, and 200 kg is delivered while the rest still needs production planning. `private.sync_order_delivery_stage` changes the entire order to `dispatched` whenever there is any non-pending dispatch and delivery is incomplete. `isOpenOrderStage` rejects that stage for production planning and press scheduling. Billet allocation has the same exclusion.

Business consequence: the factory can ship the first lot successfully and then be unable to plan or allocate input for the balance against the same order. A single header stage is being used for both shipment progress and permission to continue fulfillment.

Evidence: extracted SQL was executed against a synthetic 1,000 kg order with a 200 kg delivered dispatch. Result: `dispatched`. The actual extracted TypeScript stage predicate returned false. The billet-allocation exclusion was source-verified, not executed.

Source: `supabase/migrations/20260718021000_dispatch_readiness_and_delivery.sql:137`; `lib/actions/production.ts:86`, `:155`, `:287`; `supabase/migrations/20260530000002_foundry_billet_allocation_repairs.sql:231`.

Required outcome: track remaining fulfillment independently of the header shipment label. Accept new authorized production and billet allocation for the balance, while preventing overproduction/overallocation. Acceptance: order 1,000, deliver 200, plan and produce the remaining 800, then close only after the complete delivery and financial requirements are met.

### B02 - P1: Reworked material cannot be approved against its original source

Scenario: a completed mill-finish production lot of 100 kg is inspected as `rework`. After correction, the inspector enters a new approved inspection for the same 100 kg. The disposition validator sums approved, rejected, and rework quantities together, so the old rework plus new approval exceeds the 100 kg source. Editing the original disposition is also forbidden by the terminal-inspection guard.

Business consequence: physically corrected material remains blocked in the quality record. Creating an unrelated production job to bypass this would corrupt traceability and production quantities.

Evidence: the actual current validation and immutability functions were installed as triggers in isolated PostgreSQL. Both the new approval and an update to the original rework record were rejected with the expected errors. This proves the same-source mill-finish case; it does not prove every possible finishing route has the same outcome. No explicit superseding quality disposition mechanism was found in the inspected migrations/actions.

Source: `supabase/migrations/20260718020500_finishing_route_and_quality_yield.sql:329`, `:347`, `:374`.

Required outcome: preserve the original inspection and support a linked rework-resolution transaction which moves quantity from the unresolved disposition to the resolved disposition. Acceptance: rework 100 -> resolve approved 80/rejected 20; total physical quantity remains 100 and only 80 becomes eligible for dispatch. Repeated or concurrent resolution must not release the same quantity twice.

### B03 - P1: Return credit-note issue and reversal cannot execute for authenticated callers

The public issue and reversal RPC wrappers use `SECURITY INVOKER`, but execution rights on their private target functions are explicitly revoked from `authenticated` and `public`. Granting execute on the public wrapper does not grant execute on the private target.

Business consequence: an authorized accounts/owner user can reach the return-credit workflow but receives a database permission error. Return settlement and correction of a wrongly issued credit cannot complete through these RPCs.

Evidence: the actual wrappers and their grant/revoke statements were replayed with `SET ROLE authenticated`. Both calls failed with `permission denied for function`. Private function bodies were deliberately stubbed to isolate privilege behavior; return amounts, invoice eligibility, and role rules inside those bodies were not tested by this reproduction. No later function replacement/grant was found in the migration search.

Source: `supabase/migrations/20260723070000_dispatch_return_credit_notes.sql:244-259`.

Required outcome: use the established secure RPC execution pattern with company and business-role checks retained. Acceptance must call the RPC as a real signed-in allowed user, reject unauthorized roles and other companies, and prove repeat calls cannot issue duplicate credits. Do not resolve this by broadly granting private business functions to every user.

### B04 - P1: Multi-profile system quotes lose the lineage required by production

Scenario: a system configuration needs frame profile A (40 kg) and sash profile B (60 kg). `generateSystemQuote` inserts one quote item assigned to the first profile, with the combined 100 kg and aggregate length/cost. Quote-to-order conversion copies quote lines; it does not recover the omitted profile split. Production groups cuts by profile, and the current handoff function requires a matching order line for each profile whenever the order has commercial lines. Profile B has none.

Business consequence: the customer can receive a quotation for the assembly, but the factory cannot hand off all its profiles against the resulting order. The first profile's line also incorrectly carries the whole assembly's weight.

Evidence: the real TypeScript quote-generation function was transpiled and run against a synthetic database adapter with two profile cuts. It inserted exactly one 100 kg line for profile A and no line for B. Readiness/context helpers were stubbed; database triggers and quote conversion were not executed in that test. The conversion copy and production rejection were verified in current source. This is a reproduced data-loss boundary plus a source-traced downstream failure, not a browser end-to-end result.

Source: `lib/systems-configurator/actions.ts:526`, `:588`; `lib/systems-configurator/production-handoff.ts:27`; `supabase/migrations/20260810030000_quote_and_order_financial_integrity.sql:172`; `supabase/migrations/20260930000000_astra_audit_fixes.sql:543-554`.

Required outcome: retain the customer-facing assembly price and preserve per-profile fulfillment lineage, with explicit allocation rules where costs are shared. Acceptance: two or more profiles, repeated profiles, approved quote conversion, correct per-profile jobs, partial fulfillment, and invoice totals that still reconcile to the approved commercial amount.

## Verification and scope

Fresh command: `node scripts/audit-20261004-business-flow.mjs`.

Result: four diagnostic scenarios reproduced, exit 0. A successful diagnostic means the defect was observed; it does not mean the workflow passed. The first three use extracted SQL in PGlite, with the limitations stated above. The fourth uses the actual orchestration function with a mocked database boundary. All data is synthetic and in memory.

Fresh lint check: `npx eslint scripts/audit-20261004-business-flow.mjs` passed, exit 0. A direct invocation of the installed ESLint binary also passed. Both returned without diagnostics after slow startup.

The preceding audit in this conversation reported 626 unit tests and 25 isolated SQL checks passing, plus lint/typecheck/build. Those are prior-pass results, not newly rerun release evidence. Application source has not changed in this audit. Hosted authenticated RLS, current migration deployment, real concurrency, and operator browser UAT remain unverified; earlier staging/authentication limitations still apply. This report makes no production-readiness claim.

## Business acceptance still required

| Business boundary | Required evidence before sign-off |
| --- | --- |
| Customer commitment | Approved quote quantities, prices, tax and per-profile order lineage reconcile, including revisions and assemblies. |
| Production and input | Partial deliveries do not block remaining work; completed output cannot drift from billet consumption, scrap and downstream stock. |
| Quality and rework | Rework resolution preserves history and moves quantity once; failed material cannot be dispatched. |
| Inventory and dispatch | Reserved, shipped, free, returned and quarantined quantities reconcile in kg, pieces and meters, including partial consumption/release. |
| Accounts and returns | Invoice, collection, credit, refund and outstanding balance reconcile; adjustments do not inflate cash receipts. |
| Visibility and access | Owner/accounts/production/dealer users see the correct fields and records through UI, direct RPC, exports and storage. The first audit's access findings remain open. |

This pass deeply validated the four failures above. Completed-output editing, partial reservation release, direct-order commercial lines, and cash-versus-adjustment reporting remain additional investigation targets rather than newly confirmed findings. The table is a sign-off requirement, not a claim that every scenario was executed.

## Changes made

Created only this report and `scripts/audit-20261004-business-flow.mjs`. No fixes, migrations, permission changes, deployment, or live writes were performed. Fix the four findings and the first audit's high-priority issues before asking operators to sign off the complete workflow.

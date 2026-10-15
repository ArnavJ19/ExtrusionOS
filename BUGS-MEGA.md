# BUGS-MEGA

Consolidated ExtrusionOS audit findings and issue register. The original findings are reconciled through 14 October 2026, with local investigation follow-up recorded on 15 October below.

## Scope and Current Status

This register consolidates audit and remediation Markdown created or updated from 20 September through 14 October 2026. It includes the six October audit reports, the September business-logic register and verification, the Astra remediation report, and both October status reports. The June codebase audit, July workflow audit and May audit templates are outside the two-month window.

There are 33 finding IDs across the six October audit reports and 32 distinct root causes because C01 and F03 describe the same production-completion authority gap. The 14 October remediation report records local fixes and regression evidence for every code-remediation finding in that register. The September business-logic report records local fixes for BL-01 through BL-18; the Astra report records local fixes for findings 1 through 13. These are local candidate results, not proof of hosted migration state, real Supabase JWT/RLS/Storage behavior, independent-session concurrency, historical inventory accuracy, authenticated operator UAT or deployment.

**Known status:** A00 remains open after a further local diagnostic repair and migration-ledger audit on 14 October. Hosted reconciliation and staging acceptance remain pending. The 15 October investigation also confirmed R04-R09; their local candidates are verified but have not been applied. All other findings below are included so the original issue, impact, location and resolution are preserved with their current local status. The broader audit questions and their confirmed follow-ups remain under **Unconfirmed investigations**. Acceptance gates are also separate from bugs.

The 15 October continuation reproduced nine narrower defects while investigating those questions. R01-R03 below are locally fixed after separate reproduction, edge tests, full checks and source audit. R04-R09 require prepared database changes and remain OPEN under the user's no-migrations instruction. The broader investigations and A00 have not been marked complete.

Severity uses the source audit's rating where one was supplied. Importance explains the business effect. Complexity is a rough remediation estimate: Medium is focused; Large spans application/database paths; XL spans security, data integrity or multiple transactions. Where a source did not assign severity, this ledger says so instead of inventing one.

## Confirmed Unresolved Findings

### A00 - Hosted schema contract has not been reconciled

- **Severity:** P1 (High).
- **Importance:** Deployment blocker; invoice PDF, configurator and dealer-receipt workflows may fail against the hosted database.
- **Complexity:** Large.
- **Where:** Hosted invoice snapshot columns and the RPCs called by `app/api/pdf/invoice/[id]/route.ts`, `lib/systems-configurator/actions.ts` and `lib/enterprise/dealer-workflows.ts`.
- **Problem:** The 8 October read-only check could not select `invoices.supplier_snapshot` and did not observe `save_system_configuration_atomic` or `submit_dealer_receipt_atomic` through the REST schema. The hosted migration ledger was not verified. REST exposure alone does not prove an object is absent. The 14 October report says hosted reconciliation was deferred and establishes no current hosted-schema conclusion.
- **14 October recheck:** All 29 fresh hosted REST checks were unavailable; no current object-presence or migration-history conclusion is possible. The local inventory contains 149 SQL migration files and 137 distinct versions. Seven identifiers are shared by multiple files: `0032`, `0034`, `0036`, `0055`, `20260511`, `20260512`, `20260513`. A version-only ledger comparison cannot establish that every colliding script ran.
- **Local work completed:** Reproduced and repaired false-positive REST diagnostics for malformed successful responses and invalid RPC entries; reject invalid URL protocols, embedded credentials and empty API keys. Added a read-only metadata export and local ledger reconciler that flag collisions, wrong names, missing prerequisites and unknown/duplicate hosted entries. Regression, property, SQL and real local HTTP checks cover these diagnostics. Detailed evidence and continuation steps: `docs/A00_SCHEMA_RECONCILIATION_2026-10-14.md`.
- **Status:** OPEN. Diagnostic repairs are verified locally. Hosted ledger comparison, collision/history reconciliation, full disposable-staging replay and authenticated invoice/configurator/dealer-receipt acceptance have not completed. Existing migration filenames and production data were preserved.
- **15 October constraint and recheck:** The user explicitly instructed, "DON'T RUN ANY SUPABASE MIGRATIONS." No Supabase migration was applied. All 29 fresh read-only REST probes remain unavailable; no hosted ledger was available. Keep A00 open and continue local work without applying migrations.
- **Latest local inventory:** After preparing R04-R09, the file-only reconciler reports 155 SQL files, 143 distinct versions and the same seven collision groups. No hosted ledger was supplied, so reconciliation remains unavailable. The required REST contract now includes the proposed inventory/dispatch reservation-ledger and direct-order RPCs (32 probes); the earlier 29-probe result does not verify those additional functions. Private triggers, request-table RLS/ACLs and function-body revisions require catalog/body review, not REST RPC discovery.
- **How to resolve:** Compare the hosted migration ledger with this checkout; run read-only schema and historical-data preflights in disposable staging; rehearse the complete prerequisite migration chain; review and apply required migrations in order; deploy the compatible schema and application when authorized; verify columns, RPC grants and authenticated workflows. Do not apply only the newest migration or infer absence solely from REST schema visibility.
- **Close when:** Staging replay and preflights pass, intended roles can use the required columns/RPCs, and invoice, configurator and dealer-receipt flows pass as authenticated users. Record hosted deployment separately.
- **Sources:** `docs/AUDIT_2026-10-03.md` (A00); `docs/AUDIT_REMEDIATION_2026-10-08.md`; `docs/AUDIT_REMEDIATION_2026-10-14.md`.

### R04 - Exact posted consumption replay fails after releasing the remaining hold

- **Severity:** P2, assessed in this continuation. **Importance:** An internal replay of an already posted partial dispatch fails once its unconsumed hold is released or cancelled. **Complexity:** Medium.
- **Where / problem:** `private.consume_dispatch_reservations` checked reservation lifecycle eligibility before inspecting an existing consumption entry. After a valid partial shipment and remaining-hold release, an exact replay rejected as stale. Null manifest identity and mismatched posted-ledger provenance also lacked complete retry validation.
- **Prepared resolution:** `supabase/migrations/20261015000000_reservation_release_replay_integrity.sql` validates immutable source identity, checks an existing exact ledger entry before new-consumption eligibility, and requires an active reservation for every new debit. It preserves the private function, lock order and execute revocations. Historical migration files were retained.
- **Verification:** Four of seven checks failed against the previous latest function. Seven quantity/replay edge checks now pass with the prepared body. The broader factory fixture also verifies exact replay and authenticated delivery updates after partial release. Full suite: 739 passed, zero failures/skips/cancellations; lint, typecheck, build and whitespace checks passed. Only extracted candidate function definitions ran in isolated fixtures; the new migration script was not applied to a Supabase project.
- **Status:** OPEN; LOCAL CANDIDATE VERIFIED, NOT APPLIED. This does not add public dispatch-creation idempotency, a release UI, or a physical return. Hosted activation and independent-session acceptance remain pending under the no-migrations instruction.
- **Evidence:** `tests/reservation-release-replay.test.mjs`; `scripts/test-factory-workflow-integrity.mjs`; `docs/BUGS_MEGA_PROGRESS_2026-10-15.md`.

### R05 - Reservation ledger truncates records and quantities and hides read failures

- **Severity:** P2, assessed in this continuation. **Importance:** Inventory staff can miss older holds, overstate remaining stock, mistake a failed query for zero commitments, or lose the recorded release status. **Complexity:** Large.
- **Where / problem:** `/inventory/reservations` loaded at most 300 reservations with embedded consumption history, computed totals over that subset, and guessed `consumed` status from remaining weight. It had no server pagination/search/filter/sort. Broad inventory read access offered the page to roles outside the reservation RLS read cohort. The inventory overview also rendered a failed count as zero.
- **Prepared resolution:** `supabase/migrations/20261015010000_reservation_ledger_projection.sql` defines a read-only, authenticated, tenant-derived RPC returning one complete filtered summary, exact count and stable ten-row page. It preserves lifecycle status, separates reserved/consumed/open/released kg, metres and pieces, validates consumption lineage and quantities, and leaves missing legacy units unknown. The page validates the payload, shows an explicit unavailable state on failure, and adds bounded navigation and filters. Application navigation/read permission now matches the existing eight operational reservation-read roles.
- **Security:** The prepared security-definer function checks active identity and business role, explicitly scopes all source relations by company, exposes no commercial costs/values, revokes anonymous/public execute and grants only its own read endpoint to authenticated. Existing RLS policies, write grants and historical migrations are unchanged. No new index duplicates the existing company/reservation index.
- **Verification:** Six initial page checks failed before implementation. Nineteen new behavioral/SQL checks pass; with the existing audit-catalog integration, 20 focused checks pass. Fixtures cover 601 reservations over 61 pages, 1,501 consumption entries, literal search metacharacters, stable sorts, tenant/role/suspension rejection, invalid lineage, negative/overconsumed evidence, missing units, malformed responses and unavailable-versus-empty states. The final source audit added a failing altered-lineage regression before its repair. Full suite: 758 passed, zero failures/skips/cancellations; lint, typecheck, build (153 pages) and whitespace checks passed.
- **Browser evidence:** Isolated actual-page rendering with the built application CSS/font passed at 1440, 820, 390 and 320 pixels. Checks cover ten rows, next-page navigation, contained horizontal scrolling, large summary values and the unavailable state. Correcting the harness font exposed and led to fixing tablet summary overflow. Screenshots were inspected. This uses synthetic transport and is not an authenticated hosted journey.
- **Status:** OPEN; LOCAL CANDIDATE VERIFIED, NOT APPLIED. The page requires the new read RPC; until compatible schema activation it deliberately reports unavailable rather than trusting truncated data. No Supabase migration or deployment was performed. Full-chain replay, real JWT/RLS checks, independent sessions, historical stock reconciliation and operator acceptance remain open.
- **Evidence:** `tests/reservation-ledger.test.mjs`; `tests/reservation-ledger-page.test.mjs`; `scripts/test-audit-migration-integration.mjs`; `scripts/qa-reservation-ledger.mjs`; `docs/BUGS_MEGA_PROGRESS_2026-10-15.md`.

### R06 - A standalone credit adjustment and a return credit can settle the same invoice twice

- **Severity:** P1, assessed in this continuation. **Importance:** A customer refund balance can include a non-cash adjustment as though it were money received. **Complexity:** Large.
- **Where / problem:** `record_payment_atomic` stores the `credit_note` payment method as a posted adjustment, and collection-state calculation includes it in settlement. `issue_dispatch_return_credit_note_atomic` independently credits the full invoice value. On a synthetic 100-total invoice, a 100 non-cash adjustment plus a full return credit produced a 100 customer refund with zero cash received. With 20 cash plus a 30 adjustment, the displayed refund became 50 instead of 20. Cash-event analytics still excluded the `credit_note` method; the reproduced defect is duplicated settlement/refund entitlement.
- **Prepared resolution:** `supabase/migrations/20261015020000_credit_settlement_exclusivity.sql` adds one private trigger function and two posting guards. Both ledgers lock the same company-scoped invoice and reject a posted standalone adjustment alongside an issued return credit. Insert and activation/amount/identity updates are covered. Cancelled/pending adjustments, reversals, valid cash receipts/refunds and existing idempotent replays remain usable. An operator must explicitly reverse the standalone adjustment before replacing it with the full return document.
- **Historical review and UI:** `sql/audit-credit-settlement-conflicts.sql` is a read-only report of mixed settlement sources, recorded refund balance and the cash-supported balance. It does not rewrite history. Receipt entry now explicitly labels the non-cash adjustment's heading, amount, action and confirmation, and both posting screens explain the separate return-credit path. The return panel labels its mixed settlement figure as receipts/adjustments. Existing historical conflicts still require review and authorized correction; these labels do not certify historical refund balances.
- **Security:** No public RPC, new write grant, RLS change, dependency or duplicate index was added. Direct execute on the new private function is revoked from public, anonymous and authenticated roles. Existing company/role authorization and public RPC boundaries remain intact. The read-only deployment preflight checks the private guard's attachment, enabled state and function privileges.
- **Verification:** Seven of nine initial SQL checks failed before the guard. Eleven final SQL checks and four additional component checks pass; the 33-check focused regression also includes the existing payment, corrected-credit and audit-catalog tests. Actual public SQL wrappers were exercised under a synthetic authenticated SQL role. Tests verify the 20-cash/30-adjustment correction, zero-cash rejection, both ledger directions, pending/reactivation updates, tenant/role rejection, historical replay/reversal, metadata preservation, read-only review and private ACLs. Full suite: 773 passed, 76 suites, zero failures/skips/cancellations; lint, typecheck, build (153 pages), source audit and whitespace checks passed.
- **Browser evidence:** Twelve isolated rendered-component cases passed: cash receipt, non-cash adjustment and return credit at 1440, 820, 390 and 320 pixels. They use the current built CSS/font, synthetic state and loopback-only assets. Screenshots were inspected. Posting callbacks are tested separately; this is not a signed-in hosted browser journey.
- **Status:** OPEN; LOCAL CANDIDATE VERIFIED, NOT APPLIED. The new function, trigger and ACL objects ran only in disposable PGlite fixtures; the new migration script was not applied. No Supabase migration, hosted historical-data query/write or deployment was performed. Activation, historical reconciliation, independent concurrent sessions, credit-note key binding across different dispatches and authenticated acceptance remain pending.
- **Evidence:** `tests/credit-settlement-conflict.test.mjs`; `tests/credit-settlement-guidance.test.mjs`; `tests/credit-note-reissue.test.mjs`; `scripts/test-audit-migration-integration.mjs`; `scripts/qa-credit-settlement.mjs`; `docs/BUGS_MEGA_PROGRESS_2026-10-15.md`.

### R07 - Credit-note retry keys acknowledge a different dispatch or reason

- **Severity:** P2, assessed in this continuation. **Importance:** An accounts user can receive success for a document that does not match the requested dispatch or return reason. **Complexity:** Medium.
- **Where / problem:** `private.issue_dispatch_return_credit_note_atomic` looked up a company/key pair and immediately returned its credit-note ID, without comparing dispatch or reason. The same key could acknowledge another dispatch, a changed reason or an attempted correction of a reversed note. Its lookup also lacked a per-key transaction lock.
- **Prepared resolution:** `supabase/migrations/20261015030000_credit_note_retry_binding.sql` locks the company/key before lookup, compares the dispatch and trimmed reason, and returns the original note only for an exact retry. Conflicts reject with an instruction to refresh and review the original document. A fresh key remains necessary for corrected issuance after reversal. Authentication remains before lookup, and an absent role now explicitly rejects. Source comparison confirms the remaining dispatch/invoice checks, note snapshot, balance and audit tail are unchanged.
- **Verification:** Five of seven initial SQL checks failed; diagnostics captured another dispatch being acknowledged and an old reason surviving a changed-reason request. Nine final SQL checks pass, including normalized repeats, foreign/unknown/null targets, reversal/new-key correction, failure/retry through R06, company/role gates and lifecycle/input rejection. The existing actual-component/SQL correction test now checks stale-screen reason conflict without refreshing or rewriting the note, then a valid corrected issue. Thirty focused checks pass. Full suite: 782 passed, 76 suites, zero failures/skips/cancellations; lint, typecheck, build (153 pages), source audit and whitespace checks passed.
- **Security / status:** OPEN; LOCAL CANDIDATE VERIFIED, NOT APPLIED. No new RPC, grant, RLS policy, column, dependency, historical rewrite or application UI change was added. Direct private execution remains revoked. Only the candidate function definition/ACL ran in isolated fixtures. The key lock's source/execution is verified locally; independent-session race behavior, real JWT/RLS, private-body activation and hosted acceptance remain open. No Supabase migration or deployment was performed.
- **Evidence:** `tests/credit-note-idempotency.test.mjs`; `tests/credit-note-reissue.test.mjs`; `tests/credit-settlement-conflict.test.mjs`; `scripts/test-audit-migration-integration.mjs`; `docs/BUGS_MEGA_PROGRESS_2026-10-15.md`.

### R08 - Order entry cannot capture complete priced direct-order lines

- **Severity:** P2, assessed in this continuation. **Importance:** An order without a quotation can lack the priced line identities needed for production, dispatch and invoicing. **Complexity:** Large.
- **Requirement / reproduced gap:** The user confirmed that order creation must offer both an approved quotation and direct priced-line entry. `/orders/new` offered only quotation selection. The older `save_order_atomic` accepted an attempted direct-order payload but saved zero commercial lines and a server-derived zero value; extra line input was ignored. Existing line guards required quotation provenance, and billet rebuilding did not handle a multi-profile direct snapshot. This is not evidence about the contents of hosted historical orders.
- **Prepared resolution:** The factory new-order route now offers both methods and preserves quotation deep links. A direct form captures customer, profile, whole pieces, cut length, finish, agreed INR/kg rate, HSN and line GST. Authorised internal owner/admin/sales-manager/sales roles can create through `create_direct_order_atomic`; operational and dealer roles retain their existing commercial boundaries. `supabase/migrations/20261015040000_direct_priced_orders.sql` prepares that atomic endpoint, immutable commercial/material snapshots, complete multi-profile billet requirements, the existing below-700-kg consolidation rule, and exact retry-key binding. New header-only direct creation through the older save endpoint rejects; existing operational edits and quotation paths remain. The new-order action invalidates the actual `/production/consolidation` route.
- **Integrity / security:** Company, actor, business number, weight and totals are server-derived. Master-data locks and an expected section-weight comparison reject stale previews. Soft-deleted customers, profiles and optional dies cannot enter a new direct order. A private company/key ledger has RLS enabled, no client policies or table privileges, and a transaction-limited initial-save authorisation. Its accepted material snapshot survives later master edits. Browser roles cannot execute private implementations; the new public endpoint grants authenticated execution and checks the active internal commercial role itself. Existing public-table RLS, cost masks and write grants are unchanged. Direct-order GST is recovered from its immutable line even if a packing payload contains another rate; unmanaged historical tax precedence is retained. No cost estimate, historical price, stock receipt or quotation is invented.
- **Verification:** 34 new SQL/action/page checks pass, including 100-line decimal parity, duplicate profiles with distinct prices/finishes, complete grouped material requirements, stale/forged weights, whole-unit and money bounds, tenant/role/suspension rejection, rollback after a late audit failure, exact retries across committed sequential transactions, immutable snapshots, partial-shipment pricing, read-only historical review and ACL/catalog checks. Existing dealer and sales quotation conversion tests also run with the prepared R08 objects installed. Full suite: 816 passed, 76 suites, zero failures/skips/cancellations; lint, typecheck, build (153 pages), source review and whitespace checks passed.
- **Browser evidence:** The actual route links, interactive React direct form, server actions and public SQL wrapper were exercised against a disposable PGlite fixture at 1440, 820, 390 and 320 pixels. Two lines saved 165 kg / INR 51,375 with one audit and a pending consolidation. Checks cover cleared selections/GST, an incomplete added line, removal, unavailable catalog/workflow, and recovery of one committed order after a lost confirmation. Eleven screenshots and results were saved; representative desktop, tablet and mobile screenshots were inspected. Identity/transport are synthetic; the quotation child is a fixture boundary, not a complete signed-in quotation UI journey.
- **Status:** OPEN; LOCAL CANDIDATE VERIFIED, NOT APPLIED. No Supabase migration, hosted historical query/write or deployment was performed. Full prerequisite replay, hosted identities/RLS, independent-session races, historical reconciliation and operator acceptance remain pending. This is create-only commercial capture; price/quantity corrections require review and a corrected order rather than rewriting committed snapshots. Dealer direct pricing, historical line backfill and automatic physical returns are not added.
- **Evidence:** `tests/direct-order.test.mjs`; `tests/direct-order-actions.test.mjs`; `tests/direct-order-entry-page.test.mjs`; `scripts/lib/direct-order-fixture.mjs`; `scripts/qa-direct-orders.mjs`; `sql/audit-direct-order-lines.sql`; `docs/BUGS_MEGA_PROGRESS_2026-10-15.md`.

### R09 - Dispatch detail misstates reservation remainders and hides incomplete reads

- **Severity:** P2, assessed in this continuation. **Importance:** Dispatch staff can count released/cancelled holds as active, overstate available quantities after partial shipments, or mistake a failed read for no commitments. **Complexity:** Medium.
- **Where / problem:** The reservation panel in `app/(dashboard)/dispatches/[id]/page.tsx` summed embedded consumption histories, ignored reservation-read errors and classified every positive remainder as active regardless of lifecycle. Its unbounded header request and embedded history were subject to API caps. It lacked reservation-specific permission checks, server pagination, and consumed/released kg, metres and pieces.
- **Prepared resolution:** `20261015050000_dispatch_reservation_ledger.sql` introduces a company-, active-identity- and role-checked dispatch RPC. It resolves the source order on the server and uses the same private calculation as the existing inventory-ledger RPC. One snapshot returns complete source-order totals and stable ten-row pages. An unlinked dispatch returns an explicit unlinked result, never the whole company ledger. Malformed, missing, stale-page or conflicting evidence produces an unavailable panel. Lifecycle status stays recorded and unknown legacy units stay unknown. The display states that order totals span dispatches and that physical returns require a recorded receipt.
- **Security / integrity:** The dispatch endpoint requires the six roles that can read both dispatches and reservations; the global inventory endpoint retains its original eight-role boundary. Company/order/profile/batch labels are joined within the derived company, commercial fields are omitted, anonymous execution is revoked, and authenticated callers cannot execute the private calculation directly. Invalid or non-finite source quantities and contradictory consumed lifecycle evidence invalidate the entire matching snapshot even outside the displayed page. No table, stock, policy or history is changed by the reader.
- **Verification:** Seven of eight initial page checks failed against the old panel, including a 1,501-entry consumption history truncated to 1,000 entries and 12 kg of released/cancelled remainders labelled active. All 24 new SQL/page/loader checks pass; existing inventory-page and SQL regressions run with the shared calculation, and the integration fixture preserves existing masks and private/anonymous denial. Full suite: 840 passed, 76 suites, zero failures/skips/cancellations. Lint, typecheck, build (153 pages), source audit and whitespace checks passed. Review restored automatic-consumption guidance and distinguished fully consumed close dates from hold release dates.
- **Browser evidence:** The actual route/panel with synthetic identity/RPC transport and built CSS/fonts passed at 1440, 820, 390 and 320 pixels, including real next/previous link navigation, the last page, released/unknown/empty/unlinked/unavailable states and large quantities. Eleven screenshots and results were saved; desktop, tablet, compact-mobile, large-number and unavailable views were inspected. No page errors or document overflow were recorded. This is isolated panel evidence, not a signed-in full dispatch journey or physical-return test.
- **Status:** OPEN; LOCAL CANDIDATE VERIFIED, NOT APPLIED. No Supabase migration was run. Hosted activation, authenticated operator acceptance, independent sessions, release UI, physical-return receipts and historical reconciliation remain open.
- **Evidence:** `tests/dispatch-reservation-ledger.test.mjs`; `tests/dispatch-reservation-ledger-page.test.mjs`; `scripts/lib/dispatch-reservation-ledger-fixture.mjs`; `scripts/lib/dispatch-reservation-render-fixture.mjs`; `scripts/qa-dispatch-reservation-ledger.mjs`; `docs/BUGS_MEGA_PROGRESS_2026-10-15.md`.

## 15 October Local Investigation Fixes

### R01 - Dispatch preparation truncates reservation consumption history

- **Severity:** P2, assessed in this continuation. **Importance:** Dispatch-ready kg, metres and pieces can be overstated after partial shipments. **Complexity:** Medium.
- **Where / problem:** `lib/actions/dispatches.ts` summed embedded `profile_stock_consumptions` rows. API row caps can truncate that history. A reservation of 2,000 kg / 1,000 m / 2,000 pieces with 1,501 consumed units appeared to have 1,000 kg available instead of 499 kg. A fully consumed hold could reappear as available.
- **Resolution:** Reuse the existing company- and role-checked aggregate reader in both source display and dispatch submission. Require complete validated totals, preserve exact reservation/batch provenance, and stop before a write when the aggregate is unavailable or invalid. No new migration, grant or RLS change was added.
- **Verification:** Six new behavioral checks failed before the fix. Ten action-level tests now pass, including valid/oversize dispatch submission, failed later requests, released/consumed holds, retries, tenant/permission scoping and 100 deterministic property cases. Full suite: 715 passed, zero failures/skips/cancellations; lint, typecheck, build and diff whitespace checks passed.
- **Status:** LOCALLY FIXED after recheck and audit. The existing aggregate RPC must be available in the target schema; if it is absent, availability remains unavailable. The broader cancellation/release, returned-stock, concurrency and hosted acceptance questions remain open.
- **Evidence:** `tests/dispatch-reservation-availability.test.mjs`; `docs/BUGS_MEGA_PROGRESS_2026-10-15.md`.

### R02 - Receipt retries fail after the first request changes the invoice balance

- **Severity:** P2, assessed in this continuation. **Importance:** Accounts can receive a failure after a receipt was already recorded, encouraging a second submission with a new key. **Complexity:** Medium.
- **Where / problem:** `recordPaymentAction` in `lib/actions/payments.ts` rejected a paid invoice or an amount above the current balance before calling the idempotent database function. A successful full or partial receipt could therefore make its own retry fail, including `POST /api/payments` with the original header key. The amount schema also accepted non-finite values.
- **Resolution:** Retain authentication, financial permission, schema validation and a company-scoped invoice lookup. Let the existing locked transaction resolve the idempotency key before enforcing current status/balance for a new receipt. Reject non-finite amounts before database access. No SQL function, migration, grant or RLS policy was changed.
- **Verification:** Paid/partial/API retry and non-finite input edge cases failed before the fix. Nine new tests pass. An isolated test of the actual existing SQL functions verified one receipt and one audit event after a full-payment replay, a partial-payment replay, and rejection of new overpayments, draft-invoice payments, missing references, future dates, key reuse on another invoice and denied business roles. Full suite: 724 passed, zero failures/skips/cancellations; lint, typecheck, build and diff whitespace checks passed.
- **Status:** LOCALLY FIXED after recheck and audit. This fixes retry reachability; it does not close the broader duplicate-adjustment/credit reconciliation or hosted/concurrent-session acceptance questions.
- **Evidence:** `tests/payment-retry.test.mjs`; `docs/BUGS_MEGA_PROGRESS_2026-10-15.md`.

### R03 - A reversed credit note blocks issuing its corrected replacement

- **Severity:** P2, assessed in this continuation. **Importance:** Accounts cannot complete correction of an erroneous return credit through the offered workflow. **Complexity:** Medium.
- **Where / problem:** `components/modules/dispatch-credit-note-client.tsx` offered issuance only when no credit-note record existed, hiding it after reversal. Its single mounted idempotency key would also replay the previous reversed note if reissuance were enabled without changing key scope.
- **Resolution:** Offer corrected issuance after reversal for an eligible returned/damaged dispatch and issued invoice. Keep historical note/reversal evidence. Reuse the key for retries of one attempt, but allocate a fresh key for a different dispatch or reversed predecessor. Handle thrown transport errors without losing the retry key. Draft/cancelled invoices and active/unknown credit statuses cannot offer issuance. Eligibility/key handling lives in `lib/workflow/credit-notes.ts`.
- **Verification:** Six initial component tests failed before the fix. Eight new checks now pass, including component render/event tests and an isolated actual SQL-function issue/reverse/reissue sequence. Retries left two historical notes, one active note, three audit events and the original one cash receipt; paid cash and refund due remained 20 in the synthetic 100-total invoice. Duplicate active issue and denied-role calls were rejected. Full suite: 732 passed, zero failures/skips/cancellations; lint, typecheck, build and whitespace checks passed.
- **Status:** LOCALLY FIXED after recheck and audit. No migration, SQL function, grant or RLS policy changed. Authenticated browser use, independent sessions and physical-return/standalone-adjustment reconciliation remain open.
- **Evidence:** `tests/credit-note-reissue.test.mjs`; `docs/BUGS_MEGA_PROGRESS_2026-10-15.md`.

## October Findings With Local Fixes Recorded

The findings in this section were reproduced or source-confirmed in their original audits. The 14 October register records local remediation and per-finding regression evidence. They are therefore **locally addressed**, while hosted/security/concurrency/operator acceptance remains outstanding where applicable.

### A findings

Source: `docs/AUDIT_2026-10-03.md`; status detail: `docs/AUDIT_REMEDIATION_2026-10-14.md`.

#### A01 - Dealer reads can cross dealer ownership within one company

- **Severity:** P1. **Importance:** High; exposes another dealer's customers, quotes, quote lines and orders. **Complexity:** XL.
- **Where / problem:** Effective RLS policies on `customers`, `quotes`, `quote_items`, `orders` and `order_items`; later company-only permissive policies OR with narrower dealer-ownership policies.
- **How to resolve:** Replace the complete effective policy set with explicit internal-role and dealer-ownership rules; derive dealer customer access through owned relationships. Test direct authenticated reads as sibling dealers and across companies, including safe field projections.
- **Status:** Locally fixed and regression-tested; hosted authenticated RLS acceptance remains open.

#### A02 - Read-only and operational roles retain core-table write access

- **Severity:** P1. **Importance:** High; unauthorized edits/deletes can corrupt customer, quote, order and line data. **Complexity:** XL.
- **Where / problem:** Effective insert/update/delete policies for the same core tables, including company-only policies and order-line `FOR ALL` access. The policy layer allowed viewer updates and order-line deletion in the isolated reproduction.
- **How to resolve:** Restrict each write policy by active account, role, tenant and ownership; route sensitive transitions through narrowly authorized transactions. Test negative and permitted writes against the final policy catalog.
- **Status:** Locally fixed and regression-tested; full hosted role/JWT/RLS matrix remains open.

#### A03 - Reservation-capacity guard can block valid dispatch consumption

- **Severity:** P1. **Importance:** High; valid shipments can fail and stock/reservation ledgers can diverge. **Complexity:** XL.
- **Where / problem:** `private.consume_dispatch_reservations` and stock-capacity guards. The reproduced order reduces a batch before marking its reservation consumed, so the trigger still counts the reservation as active and rolls back dispatch.
- **How to resolve:** Consume reservation units and decrement source stock in one locked transaction with consistent lock order; calculate capacity from remaining active reservations. Cover full/partial dispatch, multiple holds, retries, rollback and concurrent sessions.
- **Status:** Locally fixed and regression-tested; independent-session contention remains unverified.

#### A04 - Order database payload exposes commercial values to operational roles

- **Severity:** P1. **Importance:** High; internal order value is confidential commercial data. **Complexity:** Large.
- **Where / problem:** Order columns and payload projection in `components/modules/operations/module-config.ts` and `module-database-client.tsx`; production users could receive `order_value` although the detail page hides it.
- **How to resolve:** Enforce one role-aware projection before serialization across lists, details, APIs, exports and PDFs; use authorized database views/column access where direct table reads are possible.
- **Status:** Locally fixed and regression-tested; hosted direct-query and authenticated UI acceptance remains open.

#### A05 - Configurator reads expose internal costing data

- **Severity:** P1. **Importance:** High; reveals costs, margins, rates and material amounts to roles not authorized to see them. **Complexity:** Large.
- **Where / problem:** Configurator quote page, `system_material_summary`, `system_configurations` policies and costing output. UI-only gating did not protect cost-bearing database rows or material amounts.
- **How to resolve:** Separate operational quantities from cost-bearing fields at database/API boundaries; return approved projections only; apply the same authorization to pages, reports, PDFs, exports and server actions.
- **Status:** Locally fixed and regression-tested; hosted role and customer/dealer exposure checks remain open.

#### A06 - Configuration-to-quote conversion can leave partial or duplicate quotes

- **Severity:** P2. **Importance:** Medium-high; failed or repeated conversion can leave orphaned or duplicate customer quotes. **Complexity:** Large.
- **Where / problem:** `generateSystemQuote` in `lib/systems-configurator/actions.ts` wrote the quote header, lines and configuration link separately without locking the configuration.
- **How to resolve:** Use one authorized idempotent database transaction to lock the configuration, create all lines, allocate the number and set the link. Inject failures at every step and test concurrent retries.
- **Status:** Locally fixed and regression-tested.

#### A07 - Costing profit percentage ignores discounts

- **Severity:** P2. **Importance:** Medium; displayed profit can remain positive when discounting produces a loss. **Complexity:** Medium.
- **Where / problem:** `lib/systems-configurator/costing-engine.ts` calculated profit percentage from margin before discount while selling subtotal deducted the discount.
- **How to resolve:** Calculate realized profit after discounts and name whether the percentage is markup on cost or margin on sales; test break-even, discounts and losses.
- **Status:** Locally fixed and regression-tested.

#### A08 - Accounts costing access differs across route, action and database rules

- **Severity:** P2. **Importance:** Medium; accounts users cannot use an explicitly offered costing/report capability. **Complexity:** Medium.
- **Where / problem:** `lib/auth/permissions.ts`, route permissions, configurator access and PDF handler allowed different accounts capabilities; database read policy also omitted accounts.
- **How to resolve:** Decide the intended accounts read scope, then align route, action, report and database authorization without granting draft-write authority.
- **Status:** Locally fixed and regression-tested.

#### A09 - Stock-reservation capability differs between UI, server action and RLS

- **Severity:** P2. **Importance:** Medium; intended production/inventory roles can see a reserve action that the server or database rejects. **Complexity:** Large.
- **Where / problem:** Configurator BOM reservation button, `reserveSystemBomProfileStock`, and reservation/configurator policies used incompatible role capabilities.
- **How to resolve:** Define a dedicated reservation capability and apply it consistently to the button, server action, RPC and RLS; keep broad configurator editing separate.
- **Status:** Locally fixed and regression-tested.

#### A10 - Customer GST search breaks pagination and relation search truncates matches

- **Severity:** P2. **Importance:** Medium; users can miss customer/profile/order records and receive duplicated or oversized pages. **Complexity:** Large.
- **Where / problem:** `components/modules/operations/module-database-client.tsx` fetched GST matches separately without one shared count/range, while related-entity IDs were capped before searching.
- **How to resolve:** Put all search predicates in one server-side query/RPC with stable sort, exact count and pagination. Test more than one page of GST-only matches and more than 50 related entities.
- **Status:** Locally fixed and regression-tested.

#### A11 - Saved-project list hides older records and query errors

- **Severity:** P2. **Importance:** Medium; users can mistake a failed query for an empty project database and cannot reach records beyond the first 100. **Complexity:** Medium.
- **Where / problem:** `app/(dashboard)/systems-configurator/projects/page.tsx` ignored query errors, applied a 100-row limit and had no search or next page.
- **How to resolve:** Add ten-row server pagination, search/filter/sort, and an explicit unavailable/error state. Verify the 101st record and a failed query.
- **Status:** Locally fixed and regression-tested.

### B findings

Source: `docs/BUSINESS_FLOW_AUDIT_2026-10-04.md`; status detail: `docs/AUDIT_REMEDIATION_2026-10-14.md`.

#### B01 - Partial shipment blocks planning the remaining order quantity

- **Severity:** P1. **Importance:** High; after a partial delivery, the factory can be blocked from producing the undelivered balance. **Complexity:** Large.
- **Where / problem:** `private.sync_order_delivery_stage`, order-stage eligibility and billet-allocation exclusions treated any dispatch as completion.
- **How to resolve:** Track shipment progress separately from remaining fulfillment eligibility; allow authorized production/allocation of the balance without permitting overproduction. Test order 1,000 kg, deliver 200 kg, produce/ship the remaining 800 kg.
- **Status:** Locally fixed and regression-tested.

#### B02 - Reworked material cannot be resolved against its original inspection

- **Severity:** P1. **Importance:** High; corrected material remains blocked or operators may create false production records to bypass the dead end. **Complexity:** Large.
- **Where / problem:** Finishing quality disposition validation and terminal-inspection guard counted original rework plus its new approval against the same source quantity.
- **How to resolve:** Preserve the original inspection and resolve it through a linked atomic transaction that moves quantity from unresolved rework to approved/rejected. Prevent repeated/concurrent release of the same quantity.
- **Status:** Locally fixed and regression-tested.

#### B03 - Authenticated callers cannot execute return credit-note issue/reversal

- **Severity:** P1. **Importance:** High; authorized accounts/owners cannot complete return settlement or reverse an erroneous credit. **Complexity:** Medium.
- **Where / problem:** Public `SECURITY INVOKER` wrappers called private functions whose execute privileges were revoked from authenticated callers.
- **How to resolve:** Use the established secure RPC pattern with company and business-role checks; test allowed/denied roles, other companies and idempotent repeat issue/reversal.
- **Status:** Locally fixed and regression-tested; real authenticated role acceptance remains open.

#### B04 - Multi-profile system quote loses production-line lineage

- **Severity:** P1. **Importance:** High; quoted assemblies can fail factory handoff and misstate per-profile quantities. **Complexity:** Large.
- **Where / problem:** `generateSystemQuote` combined multiple profile cuts into one quote line assigned to the first profile; later conversion could not reconstruct omitted profile lines.
- **How to resolve:** Preserve the assembly commercial total while storing exact profile/order-line lineage, including repeated profiles and explicit allocation of shared costs. Verify conversion, partial fulfillment and invoice total.
- **Status:** Locally fixed and regression-tested. The separate direct-order commercial-line investigation below remains open.

### C findings

Source: `docs/RECONCILIATION_AUDIT_2026-10-04.md`; status detail: `docs/AUDIT_REMEDIATION_2026-10-14.md`.

#### C01 / F03 - Production completion mass balance can be bypassed and completed output can drift

- **Severity:** P1. **Importance:** High; production output, billet input, scrap and downstream packaging/QC can disagree. **Complexity:** XL.
- **Where / problem:** Generic production save/completion paths in `20260715000000_atomic_business_workflows.sql`, `20260718021500_floor_output_and_finishing_workflows.sql` and later guards. C01 changed completed output without updating packaging; F03 completed 500 kg from 100 kg billet through the general save path.
- **How to resolve:** Make completion possible only through a database-enforced mass-balance transaction; freeze completed evidence on ordinary saves. Corrections must be audited and atomically reconcile scrap, finishing, QC, packing and dispatch, and reject changes that invalidate shipped/approved stock.
- **Status:** Locally fixed and regression-tested as one root cause; authenticated grants and full downstream/operator acceptance remain open.

#### C02 - Dispatch leaves batch metres stale

- **Severity:** P1. **Importance:** High; remaining length and future reservations can be overstated. **Complexity:** Large.
- **Where / problem:** Dispatch stock-consumption function reduced kg and pieces but left `profile_stock_batches.length_m` unchanged; later reservations derived length from the stale ratio.
- **How to resolve:** Update kg, pieces and metres atomically from exact stock provenance. Use ratios only where piece geometry is uniform; reconcile historical batches and test mixed lengths, returns, partial/full dispatch and retries.
- **Status:** Locally fixed and regression-tested.

### D findings

Source: `docs/DATA_TRUST_AUDIT_2026-10-04.md`; status detail: `docs/AUDIT_REMEDIATION_2026-10-14.md`.

#### D01 - Pending dispatches count as shipped and on time

- **Severity:** P1. **Importance:** High; shipment and delivery metrics can report movement that has not happened. **Complexity:** Medium.
- **Where / problem:** Analytics dispatch aggregation used header weight/date without filtering delivery status or an actual movement event.
- **How to resolve:** Use authoritative shipment status and actual event time; distinguish prepared, shipped, delivered and returned quantities and reconcile against the stock-consumption ledger.
- **Status:** Locally fixed and regression-tested.

#### D02 - Month-to-date metrics include events after the as-of date

- **Severity:** P2. **Importance:** Medium; historical and current MTD reports overstate activity. **Complexity:** Medium.
- **Where / problem:** Analytics month aggregation used the next-month boundary rather than the requested as-of cutoff; dashboard queries also lacked an upper bound.
- **How to resolve:** Separate full-month plan from current MTD and historical as-of metrics; use explicit India business-date boundaries. Historical balances require ledger reconstruction.
- **Status:** Locally fixed and regression-tested.

#### D03 - Customers with matching display names are merged

- **Severity:** P2. **Importance:** Medium; customer concentration and account reporting can identify the wrong account. **Complexity:** Medium.
- **Where / problem:** `top_customer_json` grouped by display name instead of stable customer ID.
- **How to resolve:** Group by customer ID, then show a disambiguating customer code/location when names match.
- **Status:** Locally fixed and regression-tested.

#### D04 - Low-stock card can say healthy while shortages exist

- **Severity:** P1. **Importance:** High; purchasing can miss shortages and the dashboard can undercount them. **Complexity:** Medium.
- **Where / problem:** Dashboard selected the first 50 by absolute stock, checked reorder levels afterwards and used a five-row preview length as the headline count.
- **How to resolve:** Compute the full shortage population and count before limiting a separately ranked detail preview.
- **Status:** Locally fixed and regression-tested.

#### D05 - Pipeline value includes lost and non-open quotes

- **Severity:** P2. **Importance:** Medium; sales opportunity totals are overstated and disagree across dashboards. **Complexity:** Medium.
- **Where / problem:** Owner dashboard summed every quote created in the month without an open-status filter; Advanced Analytics used a different population.
- **How to resolve:** Define one documented open-pipeline status/date/value rule and reuse it across screens; separate quote activity from open pipeline.
- **Status:** Locally fixed and regression-tested.

#### D06 - Dashboard readiness counts combine overlapping populations

- **Severity:** P2. **Importance:** Medium; management may interpret orders as actual jobs or dispatch-ready material. **Complexity:** Large.
- **Where / problem:** Confirmed/payment-pending orders fed production counts; broad order states fed dispatch-ready counts; delayed previews overlapped both in a status donut.
- **How to resolve:** Use actual active jobs for production, physical/QC/packing prerequisites for dispatch readiness, mutually exclusive categories for distributions, and uncapped counts.
- **Status:** Locally fixed and regression-tested.

#### D07 - API row caps can truncate monetary totals

- **Severity:** P2 (conditional). **Importance:** Medium; totals and unique-customer counts become understated above the effective API cap. **Complexity:** Medium.
- **Where / problem:** Dashboard summed/uniqued fetched rows in JavaScript without paging to completion; exact count metadata did not expand the returned row set.
- **How to resolve:** Calculate sums and distinct counts with database aggregates using the same business filters; keep previews separate from totals.
- **Status:** Locally fixed and regression-tested.

#### D08 - Analytics failure can appear as zero risk and healthy

- **Severity:** P2 (source-verified). **Importance:** Medium-high; unavailable data can be mistaken for verified zero or no risk. **Complexity:** Medium.
- **Where / problem:** Analytics failure/invalid snapshots fell back to empty metrics and a green no-risk panel while showing only a partial-data warning.
- **How to resolve:** Distinguish unavailable, partial, stale and verified-empty states; suppress health conclusions when source data failed.
- **Status:** Locally fixed and regression-tested.

### F findings

Source: `docs/FACTORY_CONTROL_AUDIT_2026-10-04.md`; status detail: `docs/AUDIT_REMEDIATION_2026-10-14.md`.

#### F01 - Release/start can use stale order, die or press readiness

- **Severity:** P1. **Importance:** High; work can be authorized for a cancelled order or unavailable machine/die. **Complexity:** Large.
- **Where / problem:** Scheduling checked eligibility, but release/start rechecked slot/job linkage without revalidating order, press and die status.
- **How to resolve:** Lock and recheck all relevant eligibility at both release and start; define any override as role-limited and audited. Test changes after schedule/release and concurrent resource blocking.
- **Status:** Locally fixed and regression-tested.

#### F02 - Held jobs cannot be safely rescheduled through the supported transaction

- **Severity:** P1. **Importance:** High; factory recovery after breakdown or schedule change is blocked. **Complexity:** Large.
- **Where / problem:** Schedule save accepted `on_hold` but attempted a transition to `planned` that status guards rejected, rolling back the replacement slot.
- **How to resolve:** Add an explicit atomic replan/resume transition that preserves hold history and completed floor evidence, checks resource overlap, and replaces the old slot safely.
- **Status:** Locally fixed and regression-tested.

#### F04 - Factory-manager allocation permission differs across app and RPC

- **Severity:** P2. **Importance:** Medium; the intended factory operator cannot allocate/reallocate billets through the API. **Complexity:** Medium.
- **Where / problem:** Application permission helper allowed factory managers, but allocation/reallocation RPC business-role allowlists omitted them.
- **How to resolve:** Confirm separation-of-duties policy and align UI, server action, wrapper, private function and RLS; retain company/material compatibility and counter checks.
- **Status:** Locally fixed and regression-tested; real authenticated permissions remain unverified.

### S findings

Source: `docs/SCRAP_BILLET_AUDIT_2026-10-07.md`; status detail: `docs/AUDIT_REMEDIATION_2026-10-14.md`.

#### S01 - Positive foundry charge can be accepted without source stock

- **Severity:** P1. **Importance:** High; creates billet output without debiting the source material represented by the furnace charge. **Complexity:** Large.
- **Where / problem:** Foundry calculation/debit triggers and `foundryBatchSchema` allowed positive scrap/external charge components with null source IDs.
- **How to resolve:** Require same-company usable source stock for every positive charge component before material becomes usable; define incomplete planned-batch behavior and test rollback/mixed-source cases.
- **Status:** Locally fixed and regression-tested.

#### S02 - Reducing foundry batch count leaves surplus billet stock

- **Severity:** P1. **Importance:** High; batch count and physical billet inventory diverge. **Complexity:** Large.
- **Where / problem:** Billet synchronization upserted rows through the new count but did not remove, cancel or reject rows above it.
- **How to resolve:** Enforce equality between accepted count and valid billets; reject reductions conflicting with committed stock or require an audited atomic correction. Test shrink/expand/retry/committed cases.
- **Status:** Locally fixed and regression-tested.

#### S03 - Density edits rewrite issued or consumed billet weights

- **Severity:** P1. **Importance:** High; committed physical input mass and production lineage can be rewritten. **Complexity:** XL.
- **Where / problem:** Foundry recalculation updated per-billet mass while preserving issued/consumed lifecycle status.
- **How to resolve:** Freeze physical input attributes at the commitment boundary or require an audited correction that checks every allocation, issue and production dependency.
- **Status:** Locally fixed and regression-tested.

## September Business-Logic Findings (BL-01 to BL-18)

Source: `FIXES-CLAUDE.md`; local implementation and verification: `BUSINESS_LOGIC_VERIFICATION.md`. The source assigned the P0-P3 severities below. Its 29 September report records local implementations and 621 passing tests; the 14 October report records a later 683-test full-suite pass. These findings are preserved as audit history, not current confirmed local defects.

### BL-01 - Per-square-foot finishing cost uses guessed geometry

- **Severity:** P0. **Importance:** Critical; can materially misprice powder coating/anodizing while warning that cost is zero. **Complexity:** Large.
- **Where / problem:** `lib/calculations/quote.ts`; the only caller omitted surface area, so the calculation used a fixed 0.3 m perimeter guess for every profile.
- **How to resolve:** Use measured/profile-master perimeter to calculate area; if unavailable, show truthful not-costed status and block sending or require an explicit override.
- **Status:** Locally fixed; quote regression evidence recorded.

### BL-02 - Expected recovery percentage was collected but not used in material costing

- **Severity:** P0. **Importance:** Critical; raw-material cost was systematically understated when recovery was below 100%. **Complexity:** Large.
- **Where / problem:** `lib/calculations/quote.ts`, quote form and validation schema; recovery was stored and returned but not used in the cost formula.
- **How to resolve:** Gross up billet input by expected recovery, or remove the no-op field; keep handling/offcut allowance distinct to avoid double-counting.
- **Status:** Locally fixed; TypeScript and SQL calculation regressions recorded.

### BL-03 - Business numbers were allocated client-side with a race

- **Severity:** P0. **Importance:** Critical; concurrent creates could fail or generate duplicate traceability numbers, with year-boundary errors from local time. **Complexity:** XL.
- **Where / problem:** `lib/utils/numbering.ts`, record-form client and quote/order form; clients read existing numbers then computed max plus one.
- **How to resolve:** Allocate persisted numbers through the company-scoped, locked database allocator in the same insert transaction; browser numbers may be preview-only.
- **Status:** Locally fixed; atomic numbering SQL checks recorded.

### BL-04 - Markup input and margin approval used different bases

- **Severity:** P1. **Importance:** High; correctly priced quotes could trigger false low-margin approval and erode trust in the approval gate. **Complexity:** Medium.
- **Where / problem:** `lib/calculations/quote.ts`; input markup on cost was compared with a minimum margin on sales revenue.
- **How to resolve:** Use one documented base for input, displayed percentage and approval threshold; test exact threshold arithmetic.
- **Status:** Locally fixed; margin/markup definitions made explicit.

### BL-05 - GST lacked intra-state/inter-state tax split

- **Severity:** P1. **Importance:** High; tax documents lacked CGST/SGST/UTGST versus IGST treatment and correct place-of-supply handling. **Complexity:** Large.
- **Where / problem:** Quote/invoice tax calculation, company GST state and customer place-of-supply data.
- **How to resolve:** Derive HSN/rate and place of supply; split domestic same-state and interstate tax consistently through quote, packing and invoice.
- **Status:** Locally fixed for the reported domestic GST scope. Export, SEZ, reverse charge, cess, e-invoicing and filing workflows remain outside that implementation.

### BL-06 - Furnace scrap and external-metal percentages could exceed total charge

- **Severity:** P1. **Importance:** High; charge and source-stock consumption could be overstated. **Complexity:** Medium.
- **Where / problem:** `lib/calculations/foundry.ts`; scrap and external percentages were independent rather than complementary.
- **How to resolve:** Derive one component as the complement or reject percentages that do not total 100%.
- **Status:** Locally fixed; mix validation and charge regressions recorded.

### BL-07 - Glass wastage appeared twice in the cost breakdown

- **Severity:** P2. **Importance:** Medium; component totals could disagree with internal cost and mislead users. **Complexity:** Medium.
- **Where / problem:** `lib/systems-configurator/costing-engine.ts`; glass wastage was in both glass cost and total wastage.
- **How to resolve:** Put each material's wastage in exactly one breakdown bucket and assert component totals reconcile.
- **Status:** Locally fixed and regression-tested.

### BL-08 - Payment plus credit could leave a fully settled invoice marked partially paid

- **Severity:** P2. **Importance:** Medium; settlement dashboards and outstanding balances could display the wrong state. **Complexity:** Medium.
- **Where / problem:** Invoice status ladder in `20260723070000_dispatch_return_credit_notes.sql`; it compared payment and credit separately although balance due used both.
- **How to resolve:** Add a settled branch based on payment plus credit before the partial-payment branch; preserve refund/reopen rules.
- **Status:** Locally fixed; payment-plus-credit and refund regression evidence recorded.

### BL-09 - Quote-to-order conversion duplicated logic and dropped quote-line lineage

- **Severity:** P2. **Importance:** Medium; SQL and TypeScript paths could drift and weaken quote-to-order traceability. **Complexity:** Large.
- **Where / problem:** `20260715000000_atomic_business_workflows.sql` and `lib/pcda/quote-order.ts`; live SQL copied lines without the original quote-line ID.
- **How to resolve:** Keep one authoritative conversion path and persist each quote item as the corresponding order line's source line.
- **Status:** Locally fixed; quote/line identity is stamped by the SQL conversion path. Related multi-profile lineage is separately tracked as B04.

### BL-10 - PCDA snapshot mixed units and omitted cost components

- **Severity:** P2. **Importance:** Medium-high; internal cost could be understated and downstream recomputation could use per-kg rates as line totals. **Complexity:** Large.
- **Where / problem:** `lib/pcda/quote-order.ts`; snapshot fields mixed rate/total semantics and omitted packing, transport and other charges from internal cost.
- **How to resolve:** Store rates and totals in fields with consistent semantics and make snapshot internal cost reconcile to full quote line cost.
- **Status:** Locally fixed; snapshot/calculation regressions recorded.

### BL-11 - Quote flat GST and invoice per-line GST could produce different totals

- **Severity:** P2. **Importance:** Medium; customer quote and invoice totals could diverge for mixed tax rates. **Complexity:** Medium.
- **Where / problem:** `lib/calculations/quote.ts` versus invoice recalculation in `20260718010000_financial_closure.sql`.
- **How to resolve:** Apply the same per-line tax rule to quote and invoice, or enforce one company-wide rate end to end.
- **Status:** Locally fixed; per-line tax and rounding regressions recorded.

### BL-12 - Signed half-up rounding was asymmetric for negative values

- **Severity:** P3. **Importance:** Low; negative variance/margin values could round inconsistently. **Complexity:** Low.
- **Where / problem:** `lib/calculations/pcda/rounding.ts` used `Math.round` for signed outputs.
- **How to resolve:** Round the magnitude and reapply sign if half-away-from-zero is intended, or document the chosen asymmetry.
- **Status:** Locally fixed and regression-tested.

### BL-13 - Indian amount-to-words conversion failed at 100 crore and above

- **Severity:** P3. **Importance:** Low-medium; large invoices could contain malformed amount-in-words text. **Complexity:** Medium.
- **Where / problem:** `lib/utils/number-to-words.ts` passed crore values above 99 to a two-digit converter.
- **How to resolve:** Convert the crore group recursively with a full number-to-words routine.
- **Status:** Locally fixed and regression-tested.

### BL-14 - Plan attainment and material recovery shared ambiguous yield naming

- **Severity:** P3. **Importance:** Low; users/developers could confuse actual-versus-planned output with output-versus-input material recovery. **Complexity:** Low.
- **Where / problem:** `lib/calculations/operations.ts` and `lib/calculations/pcda/recovery.ts`.
- **How to resolve:** Name plan attainment and material recovery distinctly and use each term consistently.
- **Status:** Locally fixed; plan-attainment helper renamed.

### BL-15 - Configurator engines read different glass-deduction option keys

- **Severity:** P3. **Importance:** Low-medium; glass dimensions and gasket/wool-pile perimeter could disagree for templates using `_mm` keys. **Complexity:** Medium.
- **Where / problem:** `hardware-engine.ts` and `glass-engine.ts` used different option-key lookup rules.
- **How to resolve:** Centralize deduction-option lookup and share it across all configurator engines.
- **Status:** Locally fixed; common lookup and regressions recorded.

### BL-16 - Cutting optimizer accepted impossible cuts and counted reusable offcuts as waste

- **Severity:** P3. **Importance:** Medium; cutting and scrap/yield reports could mislead production planning. **Complexity:** Medium.
- **Where / problem:** `lib/systems-configurator/profile-optimization.ts` placed cuts longer than stock and counted reusable leftovers in waste.
- **How to resolve:** Reject/segregate oversized cuts; report reusable offcuts separately from true waste.
- **Status:** Locally fixed; oversized-cut, stock-length and waste regressions recorded.

### BL-17 - Direct-order value trusted a client-supplied total

- **Severity:** P3. **Importance:** Medium; order totals and owner reporting could drift from line values. **Complexity:** Medium.
- **Where / problem:** `save_order_atomic` in `20260715000000_atomic_business_workflows.sql` accepted `order_value` from the order payload.
- **How to resolve:** Derive authoritative order value from validated line items, or label an estimate separately from billed value.
- **Status:** Locally fixed; server-derived direct-order totals were covered in the business-logic regression set. A broader direct-order commercial-line investigation remains separate.

### BL-18 - Alloy composition comparison depended on JSON key order

- **Severity:** P3. **Importance:** Low; equivalent compositions could be falsely flagged as custom. **Complexity:** Low.
- **Where / problem:** `lib/calculations/alloy-composition.ts` compared serialized objects directly.
- **How to resolve:** Normalize/sort element keys or compare element values independently.
- **Status:** Locally fixed and regression-tested.

## Astra Findings (1 to 13)

Source: `AUDIT_ASTRA_1_REMEDIATION.md`. The supplied source did not assign severity levels, so severity is marked **not rated in source**. Importance and complexity below are consolidated estimates. The report records local SQL/unit checks; full migration replay, hosted JWT/RLS, independent-session concurrency, authenticated browser UAT and deployment remain unverified.

### Astra 1 - Stock over-reservation

- **Severity:** Not rated in source. **Importance:** High; reserved demand could exceed physical stock. **Complexity:** Large.
- **Where / problem:** Stock reservation trigger and batch capacity in configurator inventory.
- **How to resolve:** Lock the batch, validate active reservations, company/profile/order lineage and remaining capacity in the transaction.
- **Status:** Locally fixed; SQL capacity/tenant rejection tests passed. Separate-session contention remains open.

### Astra 2 - Role bypasses in configurator and stock workflows

- **Severity:** Not rated in source. **Importance:** High; viewers or unauthorized roles could mutate or release stock. **Complexity:** XL.
- **Where / problem:** Configurator, output/library and reservation RLS policies and save RPC authorization.
- **How to resolve:** Replace permissive policies with explicit tenant/role rules and keep application, RPC and RLS permissions aligned.
- **Status:** Locally fixed; negative SQL authorization checks passed. Hosted role/JWT acceptance remains open.

### Astra 3 - Ambiguous production source-line selection

- **Severity:** Not rated in source. **Importance:** High; production jobs could lose or misstate order-line lineage. **Complexity:** Large.
- **Where / problem:** Production handoff when an order has duplicate lines for the same profile.
- **How to resolve:** Require exactly one matching line or an explicit selection, validate it in the RPC and persist `source_line_id`.
- **Status:** Locally fixed; ambiguous/foreign selection rejection and explicit selection tests passed.

### Astra 4 - Packing flow could override commercial GST

- **Severity:** Not rated in source. **Importance:** High; packing/invoice tax could differ from the approved order. **Complexity:** Medium.
- **Where / problem:** GST fields passed from packing into invoice generation.
- **How to resolve:** Derive GST from the authorized commercial order/quote line and ignore packing-entered overrides; preserve legitimate zero-rate cases.
- **Status:** Locally fixed; SQL GST-source checks passed.

### Astra 5 - Configuration recalculation could leave partially replaced data

- **Severity:** Not rated in source. **Importance:** High; failed recalculation could mix old and new BOM/cut totals. **Complexity:** Large.
- **Where / problem:** Draft configuration save and replacement of calculation collections.
- **How to resolve:** Use one authorized version-checked transaction to replace all child collections, invalidate optimization runs and update totals atomically.
- **Status:** Locally fixed; injected failures and stale/foreign saves were rejected without partial replacement.

### Astra 6 - Prefix metacharacters broke business-number allocation

- **Severity:** Not rated in source. **Importance:** Medium; valid prefixes could produce failed or incorrect numbering. **Complexity:** Medium.
- **Where / problem:** Number allocator used a regular expression against literal prefix/year strings.
- **How to resolve:** Compare the literal prefix/year stem and use a regex only for the numeric suffix.
- **Status:** Locally fixed; punctuation, backslash, rollover and sequential-allocation tests passed.

### Astra 7 - Invoice party identity could drift from historical records

- **Severity:** Not rated in source. **Importance:** High; re-downloaded invoices could show current master data instead of the issued parties. **Complexity:** Large.
- **Where / problem:** Invoice creation and PDF loading for supplier/customer identity and address fields.
- **How to resolve:** Capture party/address/GST snapshots at issuance, make snapshots immutable and render PDFs from snapshots only.
- **Status:** Locally fixed for new snapshots; legacy invoices without reliable snapshots return a conflict and require original issued documents. No fabricated historical backfill.

### Astra 8 - Hardware quantities could diverge from custom-glass cuts

- **Severity:** Not rated in source. **Importance:** Medium; gasket/wool-pile BOM could disagree with generated glass geometry. **Complexity:** Medium.
- **Where / problem:** Hardware-engine fallback calculations when custom glass formulas fail or provide generated cuts.
- **How to resolve:** Base default gasket/wool-pile quantities on generated glass cuts; retain explicit hardware formulas as override.
- **Status:** Locally fixed; unit geometry and formula-error tests passed.

### Astra 9 - Configuration numbers used client max-plus-one

- **Severity:** Not rated in source. **Importance:** High; concurrent project creation could duplicate or overwrite identifiers. **Complexity:** Medium.
- **Where / problem:** Configurator insert numbering.
- **How to resolve:** Use the central locked allocator server-side and make assigned numbers immutable.
- **Status:** Locally fixed; uniqueness, forged-input and rollback SQL tests passed.

### Astra 10 - Production-linked configurations could be reset or deleted

- **Severity:** Not rated in source. **Importance:** High; recalculation/reset could sever production evidence. **Complexity:** Large.
- **Where / problem:** Configuration lifecycle, output guards and edit/calculation actions after production linkage.
- **How to resolve:** Prevent unlink, draft reset, recalculation, child deletion and parent deletion once linked; explain the lock in the UI.
- **Status:** Locally fixed; SQL lifecycle rejection tests passed.

### Astra 11 - Mixed profile stock lengths were not retained in optimization

- **Severity:** Not rated in source. **Importance:** Medium; cut plans and waste totals could be wrong for the same profile stocked in different lengths. **Complexity:** Medium.
- **Where / problem:** Profile optimization, cut records, UI and PDF.
- **How to resolve:** Keep stock length on each cut, allocate by profile and stock length, and compute waste from actual lengths.
- **Status:** Locally fixed; 3 m/6 m, oversized-cut and weighted-waste tests passed.

### Astra 12 - Foundry calculation trigger could overwrite allocated numbers

- **Severity:** Not rated in source. **Importance:** Medium; editing furnace/date fields could alter a traceability identifier. **Complexity:** Medium.
- **Where / problem:** Interaction between foundry calculation trigger and central business-number allocator.
- **How to resolve:** Keep calculation triggers from writing the allocated business identifier; preserve numbering in its dedicated allocator.
- **Status:** Locally fixed; allocator/trigger interaction test passed.

### Astra 13 - Completed finishing evidence remained editable

- **Severity:** Not rated in source. **Importance:** High; terminal process weights and evidence could be rewritten after completion. **Complexity:** Medium.
- **Where / problem:** Finishing-job terminal status and weight/evidence fields.
- **How to resolve:** Reject changes to completed finishing weights/evidence and reject reopening through ordinary saves.
- **Status:** Locally fixed; SQL terminal-field mutation tests passed.

## Unconfirmed Investigations

The October audits originally listed these as follow-up questions rather than reproduced findings. Confirmed continuation defects are linked below; the remaining business, historical and hosted acceptance questions are not marked complete.

- **Direct-order commercial lineage:** The user's requirement for both quotation-backed and direct priced-line orders is implemented and verified locally in R08, with its database candidate still unapplied. Local production/packing/invoice checks preserve intended quantities, commercial rates, HSN/GST and exact identities across repeated profiles and partial shipments. `sql/audit-direct-order-lines.sql` identifies missing/invalid historical commercial lines without inventing prices. Hosted activation, historical reconciliation, complete signed-in quotation/direct journeys, independent-session retries and broader reporting acceptance remain open. **Sources:** `docs/RECONCILIATION_AUDIT_2026-10-04.md`; `docs/FACTORY_CONTROL_AUDIT_2026-10-04.md`.
- **Partial reservation release:** Exercise partial dispatch, cancellation and retries; prove only unconsumed holds are released once and remaining kg/pieces/metres reconcile. The 15 October investigation reproduced and locally fixed the separate truncated-history availability defect R01, then reproduced R04/R05 and verified their unapplied candidates. R09's verified, unapplied candidate extends the complete projection to dispatch detail and corrects released/cancelled balances being labelled active. Local quantities after release reconcile in those fixtures. Hosted cancellation/release, release UI and independent-session acceptance remain open. **Sources:** `docs/RECONCILIATION_AUDIT_2026-10-04.md`; `docs/BUSINESS_FLOW_AUDIT_2026-10-04.md`.
- **Returned-stock reconciliation:** Trace physical returns through stock movements/batches and return-credit processing; reconcile returned quantity to source evidence. **Source:** `docs/RECONCILIATION_AUDIT_2026-10-04.md`.
- **Duplicate adjustment/credit and cash-versus-adjustment reporting:** The original cash-event control excluded the `credit_note` method, so cash inflation was not confirmed on that path. R02/R03 locally fix receipt retry and corrected-credit workflow defects. R06 confirms duplicate invoice settlement/refund entitlement and verifies an unapplied guard, historical review query and UI guidance. R07 verifies an unapplied credit-key binding fix across dispatches/reasons. Hosted activation, historical corrections, independent concurrent repeats and broader reporting acceptance remain open. **Sources:** `docs/RECONCILIATION_AUDIT_2026-10-04.md`; `docs/BUSINESS_FLOW_AUDIT_2026-10-04.md`.

Other audit coverage gaps requiring acceptance, but not yet established as bugs: agree die-status frontend/database rules; test repeated external scrap posting and recovery/report reconciliation; validate finishing process loss/retry and packaging reversal; validate billet requirement generation, FIFO/manual allocation, scrap-to-remelt provenance and source switching; and test press-slot races in independent sessions.

## Outstanding Acceptance Gates

These gates remain even where local regression evidence exists. They are not extra confirmed bugs:

- Replay the full prerequisite migration chain in disposable staging; run schema and historical-data preflights; review effective policies, grants and function bodies.
- Verify authenticated JWT/RLS and Storage boundaries for owner, admin, sales, production, factory, inventory, dispatch, quality, accounts, viewer, suspended, sibling-dealer and second-company identities.
- Test reservation, dispatch, quote conversion, numbering, production scheduling and resource conflicts with independent concurrent sessions.
- Reconcile foundry sources/billets, reservations and stock kg/pieces/metres against source documents and physical inventory.
- Complete authenticated browser/operator journeys from quote through production, QC/rework, packing, partial/final dispatch, invoice, receipt, return and credit.
- Confirm the hosted migration ledger, required columns/RPC grants and deployed application version. Deployment remains deferred under the user's local-development instruction.

The 14 October report records 683 passing tests, zero lint errors/warnings, successful typecheck and build, and local integrated/dealer SQL fixtures. These results apply to the report's recorded source state. Rerun checks after later source changes. No current hosted schema conclusion or production-readiness claim is made here.

The latest 15 October checkpoint records 840 passing tests, 76 suites, zero failures/skips/cancellations, clean lint/typecheck and a successful build with 153 generated pages. Its 135 additional tests over the 705-test baseline and bounded local acceptance claims are recorded in `docs/BUGS_MEGA_PROGRESS_2026-10-15.md`. R01-R03 are locally fixed; R04-R09 remain verified, unapplied candidates. No Supabase migrations were applied. The outstanding gates above remain open.

## Source Audit Files Reviewed

- `FIXES-CLAUDE.md` (20 September audit; status updated 29 September)
- `BUSINESS_LOGIC_VERIFICATION.md` (29 September)
- `AUDIT_ASTRA_1_REMEDIATION.md` (30 September)
- `docs/AUDIT_2026-10-03.md`
- `docs/BUSINESS_FLOW_AUDIT_2026-10-04.md`
- `docs/RECONCILIATION_AUDIT_2026-10-04.md`
- `docs/FACTORY_CONTROL_AUDIT_2026-10-04.md`
- `docs/DATA_TRUST_AUDIT_2026-10-04.md`
- `docs/SCRAP_BILLET_AUDIT_2026-10-07.md`
- `docs/AUDIT_REMEDIATION_2026-10-08.md` (historical continuation checklist)
- `docs/AUDIT_REMEDIATION_2026-10-14.md` (latest per-finding local status and verification record)

The June codebase audit, July workflow audit, May audit checklist/templates and 8 August duplicate worktree copies are outside the 20 September to 14 October date range.


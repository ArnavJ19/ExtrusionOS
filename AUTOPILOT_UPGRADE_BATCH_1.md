# Autopilot Upgrade Batch 1

Date: 9–10 November 2026 (Asia/Kolkata)
Catalogue: [AUTOPILOT_UPGRADES.md](AUTOPILOT_UPGRADES.md)
Prompt: [AUTOPILOT_BUILD_PROMPT.md](AUTOPILOT_BUILD_PROMPT.md) (batch 1, features NEXT)
Base: `chore/refresh-evidence-screenshots` at 2b314d7 with the user's uncommitted single-tenant changes left in place; branch `feat/autopilot-batch-1`
Delivery state: ten slices implemented and verified locally against the full replayed migration chain.
Employee acceptance and the hosted migration remain separate gates (see the end of this record). Detailed working notes: [AUTOPILOT_BATCH_1_HANDOVER.md](AUTOPILOT_BATCH_1_HANDOVER.md).

## Selection

Batch 1 of the catalogue's Delivery plan ("Go-live and foundations"): AP-001, 002, 004, 005, 006, 007, 038, 059, 041, 042. No earlier
Autopilot batch existed, so no entry was replaced. Work lives inside its module (Automation, Invoices, Production, Settings → Data, record
detail pages, My Work); no new `/tasks/*` hub was created.

| ID | Feature | Foundation found | Gap closed in this slice | Edge evidence |
| --- | --- | --- | --- | --- |
| AP-001 | Scheduled jobs with a ledger | Automation builder (simulated runs only), no cron | `system_job_runs`, five registered jobs, idempotent per window, advisory lock, Vercel Cron route with constant-time secret, service-role-only RPC, three-failure owner alert, real "Run now" and paginated ledger | Retried cron window, two taps in a minute, unknown job/schedule, client calling cron RPC, four failing windows (one alert) |
| AP-002 | Proposals as accept/edit cards | Silent prefill in places | `proposals` with inputs, versions, rule, reason, confidence; accept/edit/reject; batch with per-row exclusion; stale and expired detection; 30-day memory of rejections; shared card component; My Work queue | Stale after manual change, expired, wrong role, double tap, editing a non-editable field, batch with a failing row |
| AP-004 | Factory calendar | Shift windows in factory planning, calendar-day maths elsewhere | Settings + exceptions tables, SQL and TS working-day functions, delivery proposals skip non-working days and count lead in the chosen basis, calendar page, "no holidays entered" alert | Shutdown, working-day override on Sunday, overlapping entries, >63 days, read-only role, other company |
| AP-005 | Numbering by financial year | Calendar-year allocator `next_business_number_locked` | Series and per-FY counters inside the posting transaction, legacy fallback, delete guard, GST 16-character check, proposals and confirm page | 31 March / 1 April, rolled-back posting (no gap), existing numbers unchanged, 18-character format refused |
| AP-006 | Import masters from Excel | Paste lines, master cleanup | .xlsx/.csv reader without a dependency, six masters, remembered column mapping, row-level errors kept blank-not-zero, duplicates against DB and within the sheet, one-transaction import, rejected-row CSV, undo before use | Duplicate name+city and GSTIN, repeated row, missing profile for a die, changed since preview, reversal after use refused, 500 + 1,000 rows |
| AP-007 | Opening balances and cut-over lock | Opening-balance stock origin, books lock | Plan with seven sections, signed control totals, second-person sign-off, posting into stock, billet, stores, receivable, payable, order and die ledgers, ledger totals re-verified, reversal before plan sign-off, plan sign-off locks earlier dates | Totals mismatch, loader signing own section, wrong role, unknown profile, receivables kept out of the GST series, reversal and reload, posting before cut-over refused after sign-off |
| AP-038 | GSTIN validation | Format-only regex | Check digit and state code in SQL and TS, state filled from GSTIN, explicit registered/unregistered choice in forms, quick-add dialogs and imports | Wrong check digit, unknown state, registered without GSTIN, unregistered with GSTIN, legacy record edit |
| AP-041 | Fold /tasks hubs into home records | Eight NOV hubs with their own read models | Registry of 49 hub views to home records, related-work panel on 10 record pages, record and module work routes using each hub's own form and permissions, hub "new" pages redirect, report notice, My Work queue | Role without hub read access, other company's order, unknown kind, dealer |
| AP-042 | Role navigation from usage | Role priority list and More menu | Counts-only visit beacon, approved role navigation (≤ 9), 14-of-28-day proposal, admin editor | Ids and query strings dropped, >9 items, duplicates, unknown role, non-admin |
| AP-059 | Month close and back-dating | `accounting_period_locks` (owner moves the date back) | Sequential month close, reopen request approved by a second person for a time-boxed window with every posting logged, back-dating flags reviewed by another person, close proposals | Request alone does not open, own approval refused, expired window, re-close, own-entry review refused |

## Per-feature recheck, verification, edge tests and audit

| ID | Recheck against the catalogue | Tests | Audit finding and fix |
| --- | --- | --- | --- |
| AP-001 | System does / Build / Guardrails met; "Run now" replaced only for registered jobs (builder rules are not jobs and stay labelled simulated) | 1 SQL + unit + 2 browser | Failure alert deduped by `now()` (transaction time); switched to `clock_timestamp()` and "since last success" |
| AP-002 | All three proposal types in this batch use the component; stale cannot be accepted | 2 SQL + unit + 2 browser | None beyond planned |
| AP-004 | Integrated into delivery proposals; receivable ageing kept in calendar days as the guardrail requires | 1 SQL + unit + 2 browser | None beyond planned |
| AP-005 | Concurrency relies on a row lock on the counter (not parallel-testable in PGlite) | 1 SQL + unit + 2 browser | Catalogue's example format exceeds CGST Rule 46; refused and documented |
| AP-006 | Exact rejected-row report; ~4.5 s for 500 customers + 1,000 profiles locally | 2 SQL + 2 unit + 2 browser | In-sheet repeats missed when one row had a GSTIN and the other did not; now checks both keys |
| AP-007 | Totals must equal the signed sheet at sign-off and again from the ledgers | 1 SQL + 2 browser | Opening-order reversal could hide other references behind `order_items`; reference check now takes an ignore list |
| AP-038 | Invalid GSTIN cannot be saved; empty needs explicit "unregistered" | 1 SQL + unit | Trigger ran as invoker and could not call the private validator; made definer |
| AP-041 | Entry points moved; hub detail pages still host follow-up actions on existing hub records (reached from the record) | 2 SQL + unit | Dealer roles with no dealer id passed the shared context check; now excluded |
| AP-042 | Main navigation ≤ 9 for every role | 1 SQL + unit + 2 browser | None beyond planned |
| AP-059 | No posting in a closed month without an approved, open window | 1 SQL + 2 browser | Reason validated before the role check (wrong message to unauthorised roles); reordered |

## Scope and operating boundaries

- Jobs only create proposals and notifications. Proposals change data only when a person accepts, and the domain action re-runs its checks.
- Opening entries post only at a second person's sign-off and only when totals match. After plan sign-off they are corrected with normal documents.
- Opening receivables are numbered `OB-YYYY-NNNN`, carry the original invoice number and are excluded from back-dating flags; future GST, e-invoice and Tally exports must exclude `opening_cutover_id` rows.
- The existing owner-only "move the books lock back" control is unchanged.
- No hub table or permission changed for AP-041; only presentation and entry points moved.

## Data and security audit

Migration `supabase/migrations/20261109100000_autopilot_batch_1.sql` (additive, ~2,150 lines). 18 new tables, each with `company_id`,
RLS, a company-scoped read policy and no client insert/update/delete grant; new columns on customers, vendors, invoices and orders.
Replaced function bodies (same signatures and grants): `private.next_business_number_locked` (now security definer),
`private.assign_business_number`, `private.enforce_accounting_period_lock`. Lock trigger added to supplier bills and purchase receipts.
Clients can execute only `public.ap_calendar, ap_cutover, ap_home_work, ap_import, ap_jobs, ap_navigation, ap_period, ap_proposals,
ap_series`; `public.ap_jobs_cron` only by `service_role`. Company and actor always come from `auth.uid()`; dealer roles are refused.
All security-definer functions pin `search_path`. Messages are shown to people only when prefixed `AP: `. The service-role key is used
only in the server cron route. Customer-facing views are untouched.

Test harness: the user's uncommitted `20261109000000_single_tenant_omalco.sql` blocks the second synthetic company every SQL fixture
creates. `scripts/lib/migration-chain-replay.mjs` now disables that one trigger in the replayed copy (opt out with
`{ syntheticCompanies: false }`); a batch test proves the guard still refuses a second company.

## Verification

| Check | Result |
| --- | --- |
| Migration chain replay (PGlite) | Full chain plus this migration, 0 failures |
| tests/autopilot-batch1-sql.test.mjs | 14 passed |
| tests/autopilot-batch1.test.mjs | 8 passed |
| tests/autopilot-batch1-browser.test.mjs | 16 passed at 375 px and 1280 px; screenshots in docs/evidence/AUTOPILOT_BATCH_1 |
| npm run lint | 0 errors (3 earlier warnings in batch 8 tests) |
| npm run typecheck | Passed |
| npm run build | Passed; all new pages and API routes built |
| npm test | First full run: 3,268 tests, 3,233 passed, 35 failed. 33 were caused by this batch (test data with invalid GSTINs or no registration choice, My Work request assertions, a moved navigation list, a batch 9 "newest migration" audit, a browser bundle that now meets the server-side related-work panel) and were fixed and re-run file by file (all passing). 2 remain in tests/nov-batch2-browser.test.mjs (workspace pins): caused by the uncommitted change to components/layout/workspace-shortcuts.tsx that is not part of this batch (pins moved into a collapsed panel) |
| Remaining 2 failures | Proven unrelated: on a clean checkout of the batch commit (without the uncommitted `workspace-shortcuts.tsx` change) `tests/nov-batch2-browser.test.mjs` passes 20 of 20 |
| In-app browser (screens) | Fixture server with the real screens and server action on the replayed local database: proposals accepted at desktop width; calendar, cut-over, jobs, periods, import, numbering and navigation at 375 px with no errors and no sideways scroll |
| In-app browser (real app) | `next dev` started on port 3000: `/login` 200; `/api/cron/nightly` 401 without or with a wrong secret; template download redirects unsigned requests to login. Signed-in pages redirect to "Account details are temporarily unavailable" because the hosted database has no company or user rows since the 9 November wipe, so the feature screens cannot be shown on the real app until a company and an employee exist and the migration is applied |
| Incident during verification | Removing a temporary worktree followed a folder link into the real `node_modules` and deleted some packages (your running dev server then failed on fonts and stopped). Restored with `npm install` from the unchanged lockfile; `npm ls` shows nothing missing; typecheck and batch tests re-run and pass |

## Hosted migration state

Not applied. Apply after the user's `20261109000000_single_tenant_omalco.sql` (it does not depend on it, or on `20261109010000`).
Set `CRON_SECRET` (≥ 16 characters) in Vercel; hourly crons need a Vercel Pro plan.

## Remaining acceptance

Import one real Omalco customer, vendor and profile sheet and compare counts; dry-run the cut-over against the signed Excel totals;
accounts confirms the invoice and credit-note formats with the CA; the plant head enters this year's holidays and the Diwali shutdown;
close October through the proposal; watch one week of role navigation proposals; measure fields typed and proposal acceptance before and
after on a small pilot group, as the catalogue's batch rules require.

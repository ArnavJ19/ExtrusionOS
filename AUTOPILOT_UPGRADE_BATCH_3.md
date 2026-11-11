# Autopilot Upgrade Batch 3

Date: 11 November 2026 (Asia/Kolkata)
Catalogue: [AUTOPILOT_UPGRADES.md](AUTOPILOT_UPGRADES.md)
Prompt: [AUTOPILOT_BUILD_PROMPT.md](AUTOPILOT_BUILD_PROMPT.md) (batch 3, features NEXT; `[N]`/`[NEXT]` left unfilled, so batch 3 and the Delivery plan's next row were taken)
Base: `feat/autopilot-batch-2` at a82f10f with the user's uncommitted single-tenant, dashboard and shell changes left in place; branch `feat/autopilot-batch-3`
Delivery state: ten slices implemented and verified locally against the full replayed migration chain.
Before starting, the batch 2 migration was finished on the hosted database (see "Hosted migration state").
Employee acceptance and the batch 3 hosted migration remain separate gates (see the end of this record).

## Selection

Batch 3 of the catalogue's Delivery plan ("Order-to-cash autopilot"): AP-045, 046, 032, 058, 024, 084, 031, 037, 097, 098.
Batches 1 and 2 delivered none of them, so no entry was replaced. Work lives in its module: the order record (credit check
and production drafts), `/orders/credit`, `/production/drafts`, `/invoices/drafts` and `/invoices/tax-rules`, the invoice form,
`/payments/bank`, `/payments/reminders`, the receipts page, the customer and quotation records, the quotations overview,
`/settings/data/duplicates`, the Automation page and My Work. No `/tasks/*` hub was created.

| ID | Feature | Foundation found | Gap closed in this slice | Edge evidence |
| --- | --- | --- | --- | --- |
| AP-045 | Draft jobs on confirmation | Stock-vs-production line quantities (EOS-88), the atomic job save with its lineage and capacity guards | At commit of the transaction that confirms an order, each line's remaining need (demand − allocated stock − existing jobs) becomes a draft line grouped by die (line die, else the profile's only active die), alloy and temper, merging into the open draft of the same group; header-only production orders too. Drafts reserve nothing. The planner releases a group (press and date optional): one planned job per order line through `save_production_job_atomic`, with `source_line_id`; released/total jobs shown for 30 days | Two orders merge, a different temper splits, nothing reserved before release, sales cannot release, a line on credit hold is skipped with the reason, a covered line closes as covered, released lines are not released twice |
| AP-046 | Invoice drafts at gate-out | Reviewed invoice save with a source fingerprint (EOS-96); invoice numbers are allocated on insert | Drafts live in `invoice_drafts`, so a draft never carries a number. Prepared at commit of the gate-out transaction (and hourly for any dispatch missed): goods, GST and separately billed charges from the packing list at order rates, place of supply (AP-037), invoice date (gate-out, or today if that month is closed), due date from the customer's credit days. Blocked drafts state why. Batch post re-checks the fingerprint (a changed packing list refreshes the draft instead) and runs the existing reviewed invoice save with status `generated`. Any invoice for the dispatch closes the draft; cancelling it reopens it. Unbilled-dispatch report in factory working days with explanations | No number for a draft, unpriced packing list blocked with reason, totals 30,000 + 5,400, invoice closes and cancellation reopens the draft, packing change → "changed" then refreshed, explanation needs a reason, accounts-only |
| AP-032 | Credit holds | `customer_overdue_amount`, the overdue-dispatch exception (kept unchanged) | Versioned `customer_credit_limits` (accounts/owner/admin, with reason, credit days, grace). Exposure = open invoice balances + dispatched-unbilled goods + this order (or dispatch) − on-account money. Checked at confirmation (hold + alert to approver roles, never refusing the order), on request, and at each dispatch (a BEFORE trigger refuses an over-limit dispatch without an unexpired approval covering the exposure). Holds are decided by an approver other than the order's creator; an approval that no longer covers is closed (decision kept) and a new hold opens. Customers without a limit are not checked | Sales cannot set limits; limits superseded not overwritten; exposure arithmetic including on-account; within/over/no-limit; creator cannot approve; reject needs a note; dispatch refused, then allowed after approval, refused again after expiry; a payment clears the hold with a note |
| AP-058 | Oldest-first allocation | Canonical `post_financial_receipt_atomic` (allocations must equal the amount) | `ap3_allocate`: invoices named in the narration first, then oldest by due date. A reviewed receipt posts the allocated part through the canonical transaction and the rest as a `customer_on_account_credits` balance; idempotent by key with a request fingerprint; proposed vs final allocation kept in `receipt_allocation_audits`. On-account money is applied later oldest first as a receipt dated today with the original reference + `/OA<n>`. "Receive money" panel on the receipts page (manual review flow unchanged) | Named invoice first, excess on account, totals must add up, other customer's invoice refused, retry replays, changed retry refused, apply leaves 2,000 of 5,000 |
| AP-024 | Bank statements | Receipt CSV import (already-mapped receipts only) | Statement upload (.xlsx/.csv with the AP-006 reader): heading row found below account details, columns mapped by words and remembered per bank layout, dates in five formats and Excel serials, Indian amounts, single-amount Dr/Cr files. Lines deduped on date/direction/amount/reference (a re-imported file or an overlapping period imports nothing twice); debits stored as ignored. Matching: confirmed remitter, named invoice, a person's assignment → exact (when it fits the open invoices); customer name or a unique matching balance → likely; else unknown. Each match is an AP-002 `bank.receipt_match` proposal (batch-acceptable); accepting posts via AP-058 and learns the remitter. Assigning an unknown remitter learns it for the next statement. Reversal with a reason reverses the payments and unused on-account money and frees the line. Monthly "receipted without manual search" rate against the 80 % target | Duplicate line, same file twice, overlapping file, unreadable row reported, debit ignored, sales refused, exact accept posts once, stale after the open balances change, learned remitter → exact next time, reversal needs 10+ characters and restores the balance |
| AP-084 | Reminder queue | Collection promises (NOV-040) | Morning job prepares one reminder per customer per day: invoices exactly at a step (default −3, 0, 7, 15, 30 days from due) or overdue without a sent reminder in the repeat window; invoices with an active promise skipped. The message lists invoice numbers, dates and balances only. A person copies it or opens WhatsApp (wa.me, Indian mobiles only), then marks it sent with the channel, or skips with a reason. Prepared, copied, sent, skipped and superseded are separate states; a prepared reminder whose invoices are paid is superseded. Coverage report: overdue invoices without a recent reminder or promise | Promise skips the invoice, one per customer per day, no internal words, copying is not sending, channel required, sent cannot be skipped, coverage counts, paid reminder withdrawn |
| AP-031 | Quotation expiry and requote | Quote status transitions (`sent` → `expired` allowed, `expired` → `draft` only), quote revisions via `save_quote_atomic` | Nightly job marks sent quotations past validity expired with a history row and tells the creator. An order cannot be inserted for a quotation past its validity (BEFORE trigger, cut-over orders excepted). Extension with a reason: requested and approved by another person when configured (default on), applied directly by an approver; approval returns an expired quotation to `sent` (the status trigger was replaced with the same body plus that one transition, allowed only inside the extension). Requote (owner/admin, who alone may write priced lines) copies the lines into a new revision through `save_quote_atomic` with today's approved billet and conversion rates | Job expires and notifies, lapsed customer-approved quote cannot become an order, short reason refused, requester cannot approve, reject needs a note, approval → `sent`, requote → revision 2 at 245/38 with the old revision kept, sales cannot requote |
| AP-037 | Place of supply from GSTIN | `canonicalize_invoice_supply` (tax split from supplier vs place-of-supply state); a state picked by hand | State from the billing GSTIN (valid check digit), else the customer's recorded state name, else blank. A BEFORE trigger fills a blank place of supply; once accounts confirms the rule, a different state needs an override recorded for that dispatch with a 10+ character reason (used once). Every invoice keeps a derivation snapshot (derived, chosen, basis, GSTIN, rule version, override). HSN defaults (profile, scrap) in the confirmed rule fill new profiles and, on request, blank ones. Audit sample of derived vs chosen with the tax type charged. The invoice form shows the derived state with "use it" and the override field | GSTIN 27 → IGST from Delhi; unregistered Delhi → CGST+SGST; no state → blank; advisory before confirmation; refused after; override consumed by its invoice; HSN default on insert and fill |
| AP-097 | Duplicate warnings | Create actions for quotations, orders, receipts, dispatches | `ap3_duplicates` per kind within the configurable window (default 3 days): same customer and profiles (quote); same customer and value ±0.5 %, same quote, or same profile and quantity (order); same reference at any date, or same amount and customer within the window (receipt, including on-account); same order and weight (dispatch). The four create actions stop the save and return the matches; the forms show a warning with "Save anyway" (logged) and "Open existing". Only roles that create a kind see its matches. Audit page with answered warnings and a 90-day scan for order and receipt pairs | Order within 0.2 % found, 10 % not; reference matched case-insensitively; dispatch weight; quote profile; production role sees nothing; acknowledgement logged; scan finds the pair; the gate never blocks when the check cannot run |
| AP-098 | Alerts close themselves | Task trigger rules with `task_trigger_source_open`, system notifications with entity references | Re-evaluation on the business event (invoice status/balance, order stage, quote status/validity) and hourly: trigger tasks whose source no longer holds are completed with "Resolved by system: condition cleared" (tasks whose completion checklist refuses are flagged instead); condition notifications (credit hold, quote expired/extension, calendar check, unexplained idle, failing job, unassigned trigger task, pending exception request) are resolved and marked read; undecided credit holds are rechecked; settled reminders withdrawn. Every closure is logged and listed on the Automation page | Paid invoice completes its overdue task on the payment event; failing-job alert resolves after a later success; credit-hold alerts close with the hold |

## Per-feature recheck, verification, edge tests and audit

| ID | Recheck against the catalogue | Tests | Audit finding and fix |
| --- | --- | --- | --- |
| AP-045 | System does / Build / Guardrails met | 2 SQL + 2 browser | Commit-time trigger fired before the order lines existed once constraints were made immediate in a test; the fixture now restores deferred mode (production commits are unaffected) |
| AP-046 | Met; posting is the existing reviewed invoice save | 2 SQL + 2 browser | The unbilled report used `f` as a table alias where `f` is a PL/pgSQL variable; renamed (same pitfall as batch 2) |
| AP-032 | Met for customers with a limit | 4 SQL + 2 browser | Hold constraints made an expired approval impossible to close with its decision kept; constraints relaxed to keep history. Credit-hold alerts did not close when a payment cleared the hold; clearing now resolves them in the same transaction |
| AP-058 | Met | 2 SQL + 2 browser | The retry fingerprint ignored notes, so a changed retry replayed silently; notes added |
| AP-024 | Met; matching rule mirrored in TS (`remitterFromNarration`) with a parity test | 3 SQL + 3 unit + 2 browser | None beyond planned |
| AP-084 | Met; nothing is sent automatically | 1 SQL + unit + 2 browser | A prepared reminder stayed "to send" after payment; now superseded on the payment event. The "marked sent" confirmation disappeared with its card; moved to the queue |
| AP-031 | Met | 3 SQL + 2 browser | A refused return to `sent` (incomplete costing) surfaced as a generic error; now named |
| AP-037 | Met for the billing GSTIN basis | 3 SQL + 2 browser | The invoice-form helper first pulled server actions into a bundle other fixtures load; it now uses the browser client |
| AP-097 | Met on the four create flows | 1 SQL + unit + 2 browser | Any employee could see matching record labels; the check now returns matches only to roles that create that kind |
| AP-098 | Met for the listed condition types | 2 SQL + 2 browser | None beyond planned |

## "Done when" re-check (each entry re-read in full on 11 November)

| ID | Done when | Met? | What is missing, exactly |
| --- | --- | --- | --- |
| AP-045 | No production job is typed from scratch for a normal order | Yes in the workflow | The manual "new job" form still exists for exceptions; the draft page shows jobs from drafts vs all jobs (30 days) so the habit can be measured |
| AP-046 | Unbilled dispatches older than one working day are zero or explained | Report and explanations built | An operating result. The batch post was verified through its parts (fingerprint parity is covered by the existing reviewed-invoice test; the browser fixture stubs the post) |
| AP-032 | No dispatch leaves for an over-limit customer without a recorded approval | Yes, for customers with a credit limit | Customers without a limit are not checked (the existing overdue-dispatch exception still applies). Unpriced dispatches count as zero in exposure and are reported as unpriced |
| AP-058 | Most receipts allocated with one confirmation | Yes | On-account balances show on the customer and receipts page; the existing receivables reports do not subtract them yet |
| AP-024 | ≥ 80 % of a month's credits match without manual search | Measured (rate on the bank page) | Needs a month of Omalco's statements. Upload/preview runs through the server action; its browser path is stubbed in the fixture and covered by unit tests of the parser |
| AP-084 | Overdue invoices always have a recent reminder or commitment | Coverage report built | An operating result; sending is a person's step |
| AP-031 | No order is created from an expired quote without explicit approval | Yes | — |
| AP-037 | Wrong tax-type invoices in a sample are zero | Sample built | Ship-to GSTIN is not recorded anywhere in the data model, so only the billing-GSTIN basis is offered |
| AP-097 | Duplicate receipts and orders in an audit sample fall to zero | Warnings + scan built | Bulk imports and the quote-to-order conversion are not gated (conversion is already one order per quote) |
| AP-098 | Open alert counts reflect real open problems | Yes for the condition types listed above | Other notification types are one-off messages and are unchanged; the notifications page shows a system-resolved alert as read (the resolution is listed on the Automation page) |

## Scope and operating boundaries

- Nothing posts money, stock or a customer message by itself. Invoices post only from accounts' batch post through the reviewed save; receipts post only when a person accepts a bank match or records a receipt; reminders are sent by a person.
- Draft jobs reserve no billet or capacity; release uses the normal job save and its guards.
- Credit holds never refuse an order's confirmation. They stop draft-job release and dispatch until an approver other than the order's creator approves.
- Customer-facing text (reminder messages) contains invoice numbers, dates and balances only.

## Data and security audit

Migration `supabase/migrations/20261111100000_autopilot_batch_3.sql` (additive, ~3,100 lines; applied to hosted 11 November). 22 new tables, each with
`company_id`, RLS, a role-scoped company read policy, a company-leading index and **no client grants**. Changes to existing
objects: superset check list on `proposals.proposal_type`; nullable columns `notifications.condition_key/resolved_at/resolution`
and `tasks.resolved_by_system_at/system_resolution`; triggers on `orders` (deferred confirmation hook, expired-quote guard,
condition re-evaluation), `dispatches` (credit guard, deferred billing hook), `invoices` (place-of-supply fill/override and
snapshot, draft closure, condition re-evaluation), `quotes` (condition re-evaluation), `proposals` (bank-line release) and
`aluminium_profiles` (HSN default); `private.enforce_quote_status_transition` replaced with the same body plus the
extension transition. Batch 2's `ap_proposal_apply` body is kept verbatim as `private.ap2_proposal_apply`; the public names
dispatch batch 3 first. Clients can execute only `public.ap_credit, ap_jobdrafts, ap_billing, ap_cash, ap_quotes, ap_dupes`
in addition to batches 1 and 2. Company and actor come from `auth.uid()`; dealers are refused; every security-definer
function pins `search_path`; commit-time hooks catch their own failures and alert the owner instead of undoing the order or
dispatch. No customer-facing view changed.

## Verification

| Check | Result |
| --- | --- |
| Migration chain replay (PGlite) | Full chain (296 files including this migration), 0 failures |
| tests/autopilot-batch3-sql.test.mjs | 28 passed (including the SQL/TS remitter parity, the RLS/grant audit and the three review-fix scenarios) |
| tests/autopilot-batch3.test.mjs | 10 passed |
| npm test after the review fixes (11 November) | 3,374 tests: 3,357 passed, 17 failed. 2 are the NOV-002 workspace pins (`tests/nov-batch2-browser.test.mjs`, the earlier `workspace-shortcuts.tsx` change). 15 were caused by batch 3 and are fixed and re-run: the batch 9 migration-order pin did not allow `20261111*` files (1), and the commercial workflow browser bundle (`scripts/lib/workflow-browser-bundle.mjs`) did not stub the Autopilot action now used by the quotation detail page's validity panel (14; now 13/13 passing). The batch 3 browser suite passes 12/12 alone; one 1280 px credit-hold check saw two status messages once when run alongside other suites |
| tests/autopilot-batch3-browser.test.mjs | 12 passed at 375 px and 1280 px; screenshots in docs/evidence/AUTOPILOT_BATCH_3 |
| tests/autopilot-batch1-sql.test.mjs | Callable-function list updated for the six new entry points |
| npm run lint | 0 errors from this batch. 1 error remains in `audit-output/EXTRUSIONOS_MASTER_AUDIT_2026-11-11/evidence/capture-inventory.mjs` (a folder being written outside this batch) plus 4 earlier warnings in batch 8 tests |
| npm run typecheck | Passed |
| npm run build | Passed; the seven new routes built |
| npm test | Full run in progress at commit time (about 1,500 of ~3,400 tests done). Failures so far: 6 caused by this batch and fixed, then their files re-run (all passing): batch 1's nightly job count (now five jobs) and its callable-function list, four dispatch-action tests that pin the exact RPC call list (the duplicate check now runs only after the load is valid, just before the write), and a source-pattern test on the quote save call. 2 remain in NOV-002 workspace pins (`tests/nov-batch2-browser.test.mjs`), caused by the earlier `workspace-shortcuts.tsx` change, as in batches 1 and 2. The final totals are reported on the pull request |
| In-app browser (screens) | Fixture server with the real screens and the real gateway action on the replayed local database: every screen above at 375 px and 1280 px, no console errors and no sideways scroll |
| In-app browser (real app) | `next dev`: `/login` 200; all seven new routes compile and send an unsigned request to the sign-in check (307). The signed-in pane reaches "Account details are temporarily unavailable" because the hosted database has no company profile for that login since the 9 November wipe, so the screens cannot be shown on the real app yet |

## Pull request review fixes (Codex review of 3bd03b4 on PR #7)

| Finding | Fix | Test |
| --- | --- | --- |
| P1: two equal lines without a bank reference (two ₹2,500 cash deposits with the same narration) got one dedupe key, so the second was dropped | Lines without a reference count occurrences of the same content within the file; the n-th occurrence gets its own key. Re-imported and overlapping files still repeat the same occurrences and import nothing twice. A repeated bank reference (UTR, cheque number) stays one transaction. The import result reports `repeated_in_file` | SQL: two deposits kept, a repeated cheque reference deduped, an overlapping file adds only the third deposit |
| P1: a single-amount file with a `Type` of "Deposit" was read as a debit (`/^d/`) and ignored | `markerSide()` reads explicit words only (Cr/Credit/Deposit/Receipt vs Dr/D/Debit/Withdrawal/Payment); any other word is reported on the row instead of guessed; a blank type falls back to the amount's sign or Dr suffix | Unit: marker words, Deposit → credit, unknown type reported |
| P2: rows were cut to the first row's width before the bank's heading row was found, so a one-cell "HDFC BANK LTD" line reduced the headings to `Date` | `parseSpreadsheetGrid()` returns the untruncated grid; the statement reader finds the heading row on it. The master-data import reader is unchanged | Unit: CSV with a bank-name line keeps all seven heading columns |
| P2: after reversing a wrongly matched bank line, the corrected match could not post because the canonical receipt writer refused the reference of a fully reversed receipt | `private.post_financial_receipt_atomic` and the payment reference trigger ignore receipt events whose status is `reversed` (same bodies otherwise); live and partly reversed receipts still block the reference. The on-account-only check does the same | SQL: reverse, reassign, accept again → receipted with the original UTR; a live receipt with that UTR is still refused |
| P2: the dashboard "Reserved for orders" figure summed whole batches in status `reserved` | New migration `20261111110000_stock_snapshot_open_reservations.sql` (the original snapshot is already applied to hosted): open reservation quantity = initial reserved − consumed, never negative, the basis of `private.profile_stock_balance` | SQL: 20 kg held on a 100 kg batch plus 35 kg open of a 50 kg reservation → 55 kg |

## Hosted migration state

Batch 2: `20261110100000_autopilot_batch_2.sql` is now fully applied to the hosted project. An earlier session had applied
parts 01, 02 and 04–07 (part 03's objects exist without a ledger row); on 11 November the final section was applied as
`autopilot_batch_2_part08` (completion samples, QC release guard, reject guard, proposal list filters). All 55 function
bodies were compared with the file and match; the security advisor shows no new finding.

Batch 3: applied to the hosted project on 11 November 2026 (17:00–17:40 IST), in order:
`20261111100000_autopilot_batch_3.sql` as `autopilot_batch_3_part01`–`part07` (split at top-level statement boundaries,
the joined parts identical to the file), then `stock_snapshot_open_reservations`, then `autopilot_pg_cron`. Before part 07
redefined `private.post_financial_receipt_atomic` and `private.enforce_financial_payment_reference`, their hosted bodies
were compared with the `20261029130000` versions: identical apart from whitespace and one comment line. After the apply,
all 80 function bodies created by the three files were compared with the files (ignoring whitespace and comment lines):
80 match. 22 new tables with RLS; the six client entry points are executable by `authenticated` only; `private.ap_jobs_run`
by neither clients nor the service role. Security advisor: no new finding beyond the six intended client entry points
(same category as batches 1 and 2). pg_cron 1.6.4 is installed; `autopilot-hourly`, `autopilot-nightly` and
`autopilot-morning` are active, owned by `postgres`. No job had run on hosted before this (the Vercel crons never deployed);
the first scheduled run is 13:05 UTC (18:35 IST) on 11 November. Batch 3's five jobs run with the other Autopilot jobs.

Scheduling: the Vercel project is on the Hobby plan, which accepts only daily crons and refused `5 * * * *`, so every
deployment failed. `20261111120000_autopilot_pg_cron.sql` enables Supabase pg_cron and schedules `autopilot-hourly`
(`5 * * * *`), `autopilot-nightly` (`0 19 * * *`, 00:30 IST) and `autopilot-morning` (`30 2 * * *`, 08:00 IST), each
calling `private.ap_jobs_run(schedule)`. That private runner has the body of `public.ap_jobs_cron` without the
service-role check, and no client or the service role can execute it. `vercel.json` now has no crons. `/api/cron/<schedule>`
stays as a manual trigger with `CRON_SECRET`; a second trigger in the same window records nothing new. On the PGlite
replay, pg_cron is not available, so the migration creates the functions and skips scheduling.

## Remaining acceptance

Accounts sets credit limits and credit days for the main customers and confirms the place-of-supply rule with the CA;
the owner chooses credit and extension approvers; one week of gate-outs posted from drafts with unbilled dispatches
explained daily; one month of the bank statement imported to measure the 80 % match rate; the reminder queue sent each
morning for two weeks with coverage checked; planners release a week of orders from drafts and compare jobs typed by hand;
measure fields typed per order-to-cash transaction and proposal acceptance before and after, as the catalogue's batch rules require.

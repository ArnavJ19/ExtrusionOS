# Autopilot Upgrade Batch 5 (in progress: 4 of 10)

Date: 12 November 2026 (Asia/Kolkata)
Catalogue: [AUTOPILOT_UPGRADES.md](AUTOPILOT_UPGRADES.md)
Prompt: [AUTOPILOT_BUILD_PROMPT.md](AUTOPILOT_BUILD_PROMPT.md). The Delivery plan's row "5 onward" takes the remaining entries by delivery rank; the owner asked for these in pairs while batch 4's checks ran
Base: `feat/autopilot-batch-4` at d064229; branch `feat/autopilot-batch-5`
Delivery state: four slices implemented and verified locally against the full replayed migration chain. Six more entries complete the batch.

## Selection

Next undelivered entries by delivery rank after batches 1–4: AP-026 (rank 6), AP-056 (10), AP-071 (13), AP-072 (14).
None was delivered by an earlier batch. Work lives in its module: the quotation form and record, the direct order form, the
loading screen (batch 4), the quotations overview (`/quotes/followups`, `/quotes/floors`), and production finishing
(`/production/finishing/chase`). No `/tasks/*` hub was created. The remaining six entries in rank order are AP-080, AP-047,
AP-062, AP-085, AP-063 and AP-078.

| ID | Feature | Foundation found | Gap closed in this slice | Edge evidence |
| --- | --- | --- | --- | --- |
| AP-026 | Learn each customer's usual choices | NOV-008 visible defaults; EOS-9 repeat previous; customer master fields | `private.ap5_usual`: from the customer's last five orders (main finish, packing requirement, priority), quotations (payment terms, delivery timeline) and dispatches (transporter), the most common value is proposed when used at least twice and in more than half of the records ("used in 3 of the last 5 orders"); spellings compared without case or spaces, newest shown. Agreed values on the customer record (payment or credit terms, packing requirement, shipping address) are shown instead and marked as agreed. Offered on the quotation form (payment terms, delivery, finish for lines still at mill finish), the direct order form (finish, priority) and the loading screen (transporter when blank). Nothing fills in until "Use"; every Use / Not now is logged with a use rate per field | 3 of 5 proposed, 2 of 5 and four-way splits empty, normal priority not proposed, master payment terms beat learned, no history → nothing, only the last five orders count, decision log and rate, production refused |
| AP-056 | Chase list for finishing vendors | NOV-031 finishing custody (`control_custody`), factory finishing lead times, AP-004 working days | Material still at a vendor past sent date + the finish's lead time (working days), or received with weight unaccounted, grouped per vendor with outstanding kg, order due date and a prepared message (our job references, finish, shade, kg, sent date; no customer names or prices). Copying records "copied", never "sent". A promised date (today to 120 days, with how it was given) takes the job off the list until it passes. Coverage: late jobs, late without a current promise, jobs whose finish has no lead time | On-time and no-lead-time jobs not chased, 20 kg unaccounted after receipt chased, copy is not a follow-up, past promise date refused, missed promise returns it, viewer reads but cannot record, sales refused |
| AP-071 | Follow up quotations on a schedule | NOV-066 quotation outcomes; tasks; AP-001 jobs | Sending a quotation schedules follow-ups (default day 2 and day 7 after sending, and 2 days before validity ends; moved to the next factory working day; settings for sales managers). A new morning job (`quotes.followups`) schedules any sent quotation without them, stops closed ones, and turns due steps into tasks for the quotation's owner with a prepared customer message. Recording the result (spoke, no answer, considering, asked for revision, ordered, lost) closes the step and its task; a next date adds an agreed step; ordered or lost stop the sequence; a customer decision, order, expiry or recorded loss stops it and closes the tasks as resolved by the system. Coverage: open quotations with a next follow-up date | Task raised once, assigned to the owner, message without cost; next date must be after today; lost asks for the NOV-066 outcome; customer rejection stops and closes tasks; production refused |
| AP-072 | Guard floor prices by alloy and finish | Quotation lines (conversion charge per kg), low-margin approval | Floor conversion charges per alloy, finish and quantity band (owner or admin; a new floor replaces the active one with the same alloy, finish and band start; retire keeps history). The most specific floor whose band contains the line's kg applies. A BEFORE trigger refuses moving a quotation to approved-for-sending or sent while a line is below its floor, unless an approval exists for that revision and exactly those lines (fingerprint of line, rate, floor, kg). Sales request with a 10+ character reason; the owner or an admin other than the requester approves or refuses (refusal needs a note); changed lines invalidate the request. Owners and admins are notified. Internal only | Sales cannot set floors; alloy+finish+band beats the general floor; send refused below floor; short reason refused; sales manager cannot approve; refusal needs a note; changed lines refused and superseded; approved quotation passes the guard; 1.2 t uses the lower band; no request when nothing is below |

## Per-feature recheck, verification, edge tests and audit

| ID | Recheck against the catalogue | Tests | Audit finding and fix |
| --- | --- | --- | --- |
| AP-026 | System does / Build / Guardrails met | 2 SQL + 2 browser | The loading screen needed the session's customer: `private.ap4_session_row` is redefined in this migration with `customer_id` added (otherwise unchanged) |
| AP-056 | Met | 1 SQL + 2 browser | None beyond planned |
| AP-071 | Met | 2 SQL + 2 browser | The morning job first looped with a generic record and could not pass it as a quotation row; fixed with a typed row |
| AP-072 | Met | 1 SQL + 2 browser | Error messages marked "AP: " now lose the prefix in `getErrorMessage`, so the floor refusal reads cleanly on the quotation status buttons. The phone layout of the request box wrapped badly; fixed |

## "Done when" re-check

| ID | Done when | Met? | What is missing, exactly |
| --- | --- | --- | --- |
| AP-026 | Fields typed per new order for repeat customers drops measurably | Hints and use rates built | An operating measurement. Freight terms have no field in the data model and are not learned; delivery address uses the customer master only |
| AP-056 | No vendor-held material is overdue without a recorded follow-up | Coverage built | Needs lead times for every finish in factory planning; jobs whose finish has none are counted separately and never judged late |
| AP-071 | Every open quote has a next follow-up date | Coverage built ("x of y open quotations have a next follow-up date") | An operating result; the morning job schedules quotations sent before this change |
| AP-072 | No quote below floor is sent without approval | Yes (database trigger on the status change) | Only quotations with at least one matching floor are checked; until the owner sets floors nothing is blocked. A validity extension of an already-sent quotation is not re-checked |

## Data and security audit

Migration `supabase/migrations/20261112200000_autopilot_batch_5.sql` (additive). 6 new tables, each with `company_id`, RLS,
a role-scoped company read policy, a company-leading index and no client grants. Changes to existing objects: an AFTER trigger
on `quotes` (follow-up schedule and stop) and a BEFORE trigger on `quotes` (floor guard); `private.ap_job_registry` and
`private.ap_job_execute` replaced with the same signatures plus the morning job; `private.ap4_session_row` replaced with one
extra field. Clients can execute only `public.ap_usual, ap_finishing, ap_quote_sales` in addition to batches 1–4. Company and
actor come from `auth.uid()`; dealers are refused; definer functions pin `search_path`. Vendor and customer messages contain
no cost, margin or supplier rate; floors are shown only on internal quotation screens.

## Verification

| Check | Result |
| --- | --- |
| Migration chain replay (PGlite) | Full chain, 300 files, 0 failures |
| tests/autopilot-batch5-sql.test.mjs | 8 passed |
| tests/autopilot-batch5-browser.test.mjs | 8 passed at 375 px and 1280 px; screenshots in docs/evidence/AUTOPILOT_BATCH_5 |
| tests/autopilot-batch4-sql.test.mjs | 16 passed with this migration applied |
| Earlier suites touched | FOCUSED_RESULT |
| npm run typecheck / lint | Passed / 0 errors in the changed files |
| In-app browser | Preview `autopilot-batch4-screens` (demo data now includes a late anodizing job, a sent quotation with a due follow-up and a below-floor line): vendor chase and the quotation floor and follow-up panels at 375 px, no console errors |
| npm run build, full npm test | Not run for this partial batch; run when the batch is complete |

## Hosted migration state

The migration as it stands (AP-026, 056, 071, 072) was applied to the hosted project on 13 November 2026 as
`autopilot_batch_5_part01`–`part03`, right after batch 4. All 6 tables exist with RLS, one company read policy and no
client grants; `ap_usual`, `ap_finishing` and `ap_quote_sales` run for `authenticated` only; triggers
`zz_ap5_quote_followups` and `b_ap5_guard_price_floor` are enabled; the job registry lists 15 jobs including
`quotes.followups`, which pg_cron's morning run picks up; every hosted function body matches the file when whitespace and
comment lines are ignored. Rolled-back smoke calls: the follow-up job, floor and follow-up-settings saves all returned.

Review fixes (PR #8): `20261113100000_autopilot_batch_5_review_fixes.sql` schedules follow-ups per sending
(`quote_followup_steps.cycle_sent_at`, unique per sending), so a revised quotation sent again gets a fresh sequence and a
validity extension restarts its stopped steps that are still ahead; approving a floor request whose lines changed now
returns a `superseded` result so the supersession is kept and sales can request again. The label station no longer
treats a closed print dialog as a printed label: the operator confirms each label unless the station is marked as
printing silently. Not yet applied to hosted.

Because the file is now applied, the remaining six features of the batch (AP-080, 047, 062, 085, 063, 078) go in a new
migration file instead of extending `20261112200000_autopilot_batch_5.sql`.

## Remaining acceptance

Sales manager sets the follow-up schedule; the owner sets floor conversion charges by alloy and finish; production sets a lead
time for every finish in factory planning; sales uses the usual-choice hints for two weeks and the use rate is reviewed;
measure fields typed per repeat order and follow-up coverage before and after.

# Autopilot Upgrade Batch 5

Date: 12-13 November 2026 (Asia/Kolkata)
Catalogue: [AUTOPILOT_UPGRADES.md](AUTOPILOT_UPGRADES.md)
Prompt: [AUTOPILOT_BUILD_PROMPT.md](AUTOPILOT_BUILD_PROMPT.md). The Delivery plan's row "5 onward" takes the remaining entries by delivery rank; the owner asked for these in pairs while batch 4's checks ran
Base: `feat/autopilot-batch-4` at d064229; branch `feat/autopilot-batch-5`
Delivery state: ten local slices. The initial four were applied to hosted Supabase separately; the six-feature completion is local only. Employee acceptance remains separate from implementation and local verification.
Continuation memory: [Completion handover](docs/memory/AUTOPILOT_BATCH_5_COMPLETION.md).

## Selection

Next undelivered entries by delivery rank after batches 1–4: AP-026 (rank 6), AP-056 (10), AP-071 (13), AP-072 (14).
None was delivered by an earlier batch. Work lives in its module: the quotation form and record, the direct order form, the
loading screen (batch 4), the quotations overview (`/quotes/followups`, `/quotes/floors`), and production finishing
(`/production/finishing/chase`). No `/tasks/*` hub was created. The remaining six entries in rank order are AP-080, AP-047,
AP-062, AP-085, AP-063 and AP-078. These were completed on 13 November in the existing batch branch. No delivered entry
was selected again and no new branch or worktree was needed. Their selection, implementation and acceptance record is
in the completion sections below.

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
| Earlier suites touched | See the final completion verification below for the full-suite failures and affected-suite reruns |
| npm run typecheck / lint | Passed / 0 errors in the changed files |
| In-app browser | Preview `autopilot-batch4-screens` (demo data now includes a late anodizing job, a sent quotation with a due follow-up and a below-floor line): vendor chase and the quotation floor and follow-up panels at 375 px, no console errors |
| npm run build, full npm test | This table records the initial four-feature checkpoint; completion results follow below |

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
printing silently. Applied to the hosted project on 13 November 2026 as `autopilot_batch_5_review_fixes` (ledger 283):
the new column, check and `quote_followup_steps_once_per_send` index replace `quote_followup_steps_once`; the three
redefined function bodies match the file; rolled-back owner calls (morning job, follow-up queue, floor requests) returned.

Because the file is now applied, the remaining six features of the batch (AP-080, 047, 062, 085, 063, 078) go in a new
migration file instead of extending `20261112200000_autopilot_batch_5.sql`.

## Remaining acceptance

Sales manager sets the follow-up schedule; the owner sets floor conversion charges by alloy and finish; production sets a lead
time for every finish in factory planning; sales uses the usual-choice hints for two weeks and the use rate is reviewed;
measure fields typed per repeat order and follow-up coverage before and after.

## Completion selection (13 November 2026)

The current prompt was read first, followed by the catalogue, CLAUDE.md, all five prior batch records and the project
memory. The existing partial batch was resumed. No new hub was created: work is on the dashboard/My Work, order
red list, production billet forecast, stock item/ledger, vendor record, Payments and Month close.

| ID | Foundation reused | System prepares and person confirms | Guardrails and tests |
| --- | --- | --- | --- |
| AP-080 | Command-center sources, canonical payments, AP-001 and AP-014 | Immutable factory-day digest at 08:00 IST: yesterday's production/recovery, dispatch kg, invoicing, collections, overdue, credit holds, current open red lines, idle presses and floor/close/stock approval queues. In-app read and copy events retain generation time | Management roles only; missing input keeps recovery unknown; copied is not sent; daily retry retains original snapshot; idle detection uses AP-014 valid pushes and configured thresholds |
| AP-047 | Canonical inventory ledger/adjustment writer, stock explanations, NOV-030 | Read-only balances, ten-row movements and reconciliation. Explicit correction with reason, expected balance and idempotency key. Default threshold zero requires another person; small corrections may post on explicit confirmation after owner/admin configure a threshold. Approval calls the original atomic writer once. Baseline/delta journal covers inventory items, profile stock, billet batches, packing materials and foundry sources | Direct quantity update/delete refused; idempotent retries, changed retry, self-approval, stale balance, overdraw, wrong role/company, and exact signed rebuild tested. Packing stock input made read-only |
| AP-062 | EOS-89 input/recovery calculation, AP-045 drafts, foundry and procurement links, NOV-039 supplier promises | Seven days by alloy/diameter: firm input less billets already linked to the job, uncertain draft demand, free stock used once, open PO supply on its promise and planned/melting casts on their production date. Shared AP-002 shortage proposals assign purchase/foundry preparation work; person uses the normal PO/cast workflow | Missing inputs stay unknown. Late/undated/draft supply cannot cover an earlier shortage. Planned billet rows do not erase their parent cast. Counts sum each job's billet weight basis. Changed source stales proposals; acceptance/retry creates one task |
| AP-085 | AP-059, billing/on-account/bank workflows, purchase lifecycle, cycle counts and Tally | Computed checklist links unbilled dispatches, invoice drafts, unallocated receipts, GRNs without fully posted bills, unreconciled bank credits, stock corrections/variances, ledger differences and unexported vouchers to fixes. Nominated active accounts head closes; owner/admin act until nominated. Another owner/admin can approve an exact-source exception | Direct close, proposal close and legacy books-lock entry enforce blockers. Requester cannot self-approve; changed values invalidate approval; closure rechecks and consumes the exception. Finance review/reopen access is preserved separately |
| AP-063 | Existing line requirement/progress read model and line promises, press slots, finishing lead times, AP-004 | Daily first prediction per open line, due/estimated date, blocking stage and visible basis. Uses planned completion and historical stage medians in factory working days (minimum three samples); otherwise labelled production/packing allowances. Red list and My Work/dashboard section; two-day warning coverage on late dispatched lines | Line promise overrides order promise; partial plan does not imply full remaining coverage; missing quantity/finishing lead stays unknown; role/company isolation; repeat job preserves daily evidence; shipped/closed lines leave the live queue |
| AP-078 | Vendors, posted supplier bills and payable balances | Append-only classification/Udyam/terms revisions; accounts-configured periods capped at 45 days for written terms and 15 without a period. Separately confirmed acceptance date with evidence. Due/upcoming/overdue/missing-date queue, reason notes and normal payables link | Neither invoice date nor receipt date is assumed to be acceptance. Missing dates remain unknown. Period caps, no agreement, leap/month boundaries, changed policy, note without deferral, paid-bill removal and unauthorized role tested |

## Completion recheck, tests and audit

| Feature | Recheck | Audit finding and fix |
| --- | --- | --- |
| AP-080 | Generator, snapshot, job and management UI built; SQL and desktop/phone checks | Job counters initially used names the scheduler did not consume. Fixed and tested through the real run ledger. Recovery remains unknown if input evidence is missing |
| AP-047 | Movement-only corrections for the listed families; SQL/RLS and desktop/phone checks | Request and decision lock order serialized; changed balance refuses approval; retry identity retained. Historical balances are labelled migration baselines, not invented original receipts |
| AP-062 | Read model and AP-002 proposals; canonical calculation units, SQL and desktop/phone checks | Fixed re-procurement of linked billets, counting all demand using the shortest billet, and planned casts hidden by their generated planned-billet rows; regression tests added |
| AP-085 | Checklist, head nomination and source-bound exceptions; SQL plus AP-059 and browser regressions | Older books-lock control was a bypass; it now checks the same blockers. Legacy UI distinguishes close authority from finance review permissions. Nomination confirmation now survives the checklist refresh |
| AP-063 | Daily prediction, basis, red list and coverage; SQL and browser checks | Partial slot coverage adds remaining production allowance. Stage medians now use factory working days |
| AP-078 | Classification, confirmed acceptance, configurable periods and accounts queue; SQL/date units/browser checks | Reasons do not defer the deadline or post money. Actual acceptance is explicit; missing evidence stays unknown |

## Completion scope and Done when recheck

| ID | Catalogue acceptance target | Current evidence and remaining gate |
| --- | --- | --- |
| AP-080 | Owner uses digest instead of morning calls | Snapshot/read/copy measurement built; requires a management pilot. Approval count covers the named floor, close and stock queues |
| AP-047 | Any balance rebuilt exactly from movements | Canonical inventory rebuild and supplementary baseline/delta reconstruction built for the listed stock families. Historical supplementary quantities begin at the migration boundary; maintenance spare-part and specialist ledgers retain their existing workflows |
| AP-062 | Shortages visible at least three days ahead | Seven-day view and nightly proposals built. Requires timely jobs and reliable supply dates. Acceptance assigns preparation; it does not create a PO/cast. Grouping is by alloy/diameter; temper/length purchasing choices stay in the normal workflow |
| AP-085 | Months close without blocking items | Enforced unless a second-person exact-source exception records the unresolved items. Needs head nomination and a real close trial |
| AP-063 | At least 80% of late lines warned two days before due | Coverage calculation built; target is not claimed achieved. Needs operating history, calibrated allowances and line-linked dispatch evidence |
| AP-078 | No MSME bill passes unnoticed | Queue covers posted linked supplier bills for recorded micro/small terms. Accounts must verify supplier status and acceptance. Missing dates are surfaced; this is a tracking aid, not legal advice |

No system job posts stock, money, quality approval or a customer message. Shortage acceptance creates assigned
preparation work. Stock posts only on a person's permitted confirmation/approval through the canonical writer.
Customer-facing views are unchanged. No new infrastructure or dependency was added.

## Completion data and security audit

`supabase/migrations/20261113110000_autopilot_batch_5_completion.sql` adds 11 company tables with RLS, company-leading
indexes and no direct client grants. Four gateway functions (`ap_stock`, `ap_planning`, `ap_accounts`, `ap_digest`)
derive company/actor from the session; Zod validates the server-action boundary and SQL rechecks roles, keys, quantities
and source state. Private helpers are not client-executable; definer functions pin search paths. The original stock
writer and period logic remain behind guarded private wrappers. AP-002 versions/decisions extend to `billet.shortage`.
The registry adds `billets.forecast`/`orders.predict_late` nightly and `owner.digest` morning, using existing pg_cron.

Applied history is preserved: the initial `20261112200000` file is unchanged in Git. The completion's separate file is
an intentional exception to the original one-file plan because the initial file was applied while work continued.
The concurrently authored review-fix migration, label/quotation UI changes, audit reports, existing screenshot edits
and added quotation review tests remain separate work. They are not absorbed into the completion commit.

## Completion checkpoint verification (474e3ce)

These are the original completion checkpoint results. The correctness follow-up below supersedes its known
defects and outstanding check failures.

| Check | Observed result |
| --- | --- |
| Full migration replay | 302/302 files, 0 failures, including the concurrent review-fix file in this shared checkout |
| Affected final regression | 86/86 checks passed across scheduler/period, batch 5 SQL, completion calculation/SQL/browser, commercial browser and task-blueprint suites |
| Quotation fixture regression | 28/28 passed; AP-026's server-action boundary is explicitly stubbed outside its own real gateway fixture |
| Completion SQL | 17 passed, including RLS/grants, duplicates/retries, approval, stale sources, supply timing, cast/weight/count edge cases and all three jobs through the scheduler ledger |
| Completion calculation/command units | 3 passed: canonical input parity, acceptance-date calendar boundaries and strict command validation |
| Completion browser | 14/14 passed at 375 px and 1280 px, including owner stock-threshold configuration and named accounts-head nomination; 16 screenshots in `docs/evidence/AUTOPILOT_BATCH_5_COMPLETION`. The initial four-feature browser suite also passed 8/8 after the concurrent review fixes |
| Typecheck / final production build | Both passed; production build rerun after the final nomination-confirmation fix |
| Broad lint | One pre-existing error at `audit-output/EXTRUSIONOS_MASTER_AUDIT_2026-11-11/evidence/capture-inventory.mjs:85` (`no-assign-module-variable`) and four earlier warnings. Unrelated audit code was preserved |
| Changed-file lint | Passed with zero errors/warnings; the final nomination UI and browser test were checked again after the confirmation fix |
| Full npm test | 3,459 tests: 3,414 passed, 45 failed. The 43 relevant failures were corrected and their affected suites rerun successfully; two pre-existing workspace-pin failures remain. Explicit recheck of `nov-batch2-browser`: 18/20 passed with the same two failures |
| In-app browser | Six real feature screens/gateway on replayed local SQL with synthetic records, at 1280 px and 375 px: no console errors/warnings or horizontal page overflow; wide table scroll stays in its card |
| Actual Next.js runtime | `/login` 200; new protected routes 307 to `/account-unavailable`. Signed-in hosted acceptance is not claimed; no hosted business rows written |
| Own review | `git diff --check` clean; preserved the applied migration. Independent-session PostgreSQL concurrency remains a staging/hosted check because PGlite serializes sessions |

## Completion file inventory

| Area | Created | Modified |
| --- | --- | --- |
| Product | Four module routes: `production/billet-forecast`, `orders/at-risk`, `payments/msme`, `inventory/movements`; `components/modules/autopilot-operations/operations.tsx`; `lib/autopilot-batch5/operations.ts` | Six existing record/dashboard pages; module navigation, proposal editor, month-close permissions and read-only packing stock field; Autopilot actions, job registry, period and proposal schemas |
| Database | `supabase/migrations/20261113110000_autopilot_batch_5_completion.sql` | None; applied batch history is unchanged |
| Verification | Operations SQL, unit and browser suites; operations fixture and preview script; 16 completion screenshots | Shared browser fixture; AP-059/scheduler assertions; four quotation-fixture action boundaries; task-error boundary behavior assertion |
| Records | `docs/memory/AUTOPILOT_BATCH_5_COMPLETION.md` | This batch report and the catalogue batch links |

## Completion hosted migration state and acceptance

The completion migration is **not applied**. A read-only hosted ledger check on 13 November confirmed batch 4 parts
01-07 and the initial batch 5 parts 01-03. This continuation did not apply migrations, push, merge or deploy. The new
file depends on the initial batch 5 migration and is independent of the separately authored quotation review fix.
The existing scheduler discovers its three jobs after a separately authorized apply.

After review/authorization, apply `20261113110000_autopilot_batch_5_completion.sql`. Nominate the accounts head; confirm
the stock threshold (zero by default), supplier classification/written terms and acceptance dates; enter reliable job,
supplier and cast dates. Trial a correction with two independent employees, reconcile stock baselines physically,
review a three-day-ahead shortage and the resulting PO/cast, and close a real month. Calibrate prediction defaults with
the plant head and compare with dispatches; use the digest for two weeks and measure calls, reads and fields typed.

MSME configuration reference checked on 13 November: [DC-MSME delayed-payment FAQ](https://dcmsme.gov.in/old/faq/FAQs%20-%20Delayed%20Payments%20-%2027.12.2012.pdf).
Accounts confirms actual applicability, classification and acceptance/dispute evidence.

## Correctness follow-up (13 November 2026)

A subsequent review reproduced three gaps in the original passing tests. They are fixed by
`supabase/migrations/20261113120000_autopilot_batch_5_correctness.sql`; the earlier migration files are unchanged.

| Finding | Implemented correction | Regression evidence |
| --- | --- | --- |
| AP-085 close approval survived a changed count | The close fingerprint includes the full ordered observation history, measured pieces/kg, observer, time, notes, count-line snapshot and review evidence. A status returning to `difference` cannot restore the old fingerprint | Real count preview/commit: 90 kg first count, independent recount at 10 kg; pending approval is refused, approved exception cannot close through either AP-059 or the legacy lock RPC; a fresh independent approval can close and is consumed |
| AP-062 incomplete drafts hid firm shortages | Separate firm/draft missing-input counters and cumulative completeness. Known daily quantities remain visible; only the affected cumulative calculation stays unknown. The UI labels missing draft input in its own column | 1,000 kg firm requirement plus an incomplete draft still produces the 1,000 kg shortage proposal. Missing firm input remains unknown while known drafts and later daily demand remain visible |
| AP-063 vendor jobs received an unjustified date | Missing finishing lead is checked before any vendor-date calculation. No zero-day fallback is used | Planned, sent-to-vendor and in-process cases retain a null estimate and appear on the red list; configured lead still yields a dated estimate |
| Two NOV-002 browser failures | Tests expand the existing workspace disclosure before operating its controls | Blocked storage still reports failure; keyboard reorder and company/navigation isolation pass |
| Broad lint error and four warnings | Rename the audit script's local `module` variable without changing its output key; remove unused bindings/import/helper | `npm run lint` passes with zero errors and zero warnings. Other uncommitted audit-script changes are preserved and excluded from this fix commit |

| Follow-up check | Result |
| --- | --- |
| Full local migration replay | 303/303 applied, zero failures |
| Completion SQL and command/calculation units | 25 SQL/RLS checks and 3 command/calculation checks passed, including all new edge cases |
| Completion browser | 20 passing checks, including six phone/desktop reproductions; six new screenshots in `docs/evidence/AUTOPILOT_BATCH_5_COMPLETION` |
| Workspace browser | 20/20 passed, including both formerly failing scenarios |
| Typecheck / production build / lint | All passed; lint has zero errors and zero warnings |
| Full repository `npm test` | 3,481/3,481 passed across 76 suites; zero failures, zero skipped, zero cancelled. Completed in 16 minutes 51 seconds |
| Visual check | Six phone/desktop regression screenshots inspected. In-app browser was unavailable; native Computer Use stopped because it could not establish the current browser URL. No manual signed-in browser acceptance is claimed |

Created: one additive correctness migration. Modified: operations UI, SQL/browser regression suites, operations fixture
and preview, the two older browser interactions, unused NOV batch 8 test bindings and the audit script's three lint-only
edits, this report and project continuation notes. No new dependency, table, grant or RLS-policy change; the three
replaced private functions keep pinned search paths and revoked client execution. No job gains stock, payment or
message-posting authority.

The completion and correctness migrations remain local. A read-only hosted ledger check found no completion
migration. Apply `20261113110000_autopilot_batch_5_completion.sql` followed by
`20261113120000_autopilot_batch_5_correctness.sql` only after separate rollout authorization. This follow-up did not
push, merge, deploy or apply hosted migrations. Real signed-in role acceptance, independent-session PostgreSQL
concurrency, physical stock reconciliation and operating targets remain the employee/staging gates listed above;
Docker's local PostgreSQL engine was not running, so serialized PGlite checks do not substitute for that concurrency trial.

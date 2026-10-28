# EOS Upgrade — Claude Handover 2

Date: 22 October 2026
Sessions: "EOSUPGRADE features development and audit" (Claude Code, Opus 5.5)
Where all work is: worktree `C:\Users\arnav\OneDrive\Desktop\ExtrusionOS\.worktrees\eos-calc`, branch `feat/upgrade-eos-calc-batch` (HEAD `0228e59`).
**Nothing is committed, pushed, or applied to the hosted Supabase project (`pkawmdxtmsdgigsehcmb`).** Only read-only queries were run against it.

This document continues `EOS_UPGRADE_CLAUDE.md`, which has the full detail of batch 1. **Batch 2 is now complete (10 features).**

---

## 1. What I was tasked to do

The `/goal` was set three times:

1. "Build 10 features which are mentioned in the EOSUPGRADE.md. Whenever you build each feature, recheck the work you have done, reverify it, create edge and unit test cases and test it and also audit it. Features should be medium to difficult complexity. Also read EOS_UPGRADE_CLAUDE.md to see where to pick up the work from and check your memory." This is **batch 1, complete**.
2. The same goal again: read as **ten more** features to the same standard (batch 2). Stopped at the user's request after 5 features and the database half of a sixth.
3. The same goal a third time, pointing at this handover: **finish batch 2**. Batch 2 is now **complete**: 69, 71, 35, 54, 76 (earlier) plus 85 (finished), 64, 67, 48 and 45 (this session).

Interpretation notes:
- `EOSUPGRADE.md` / `EOS_UPGRADE.md` do not exist; the catalogue is **`UPGRADE_EOS.md`** (100 features).
- I chose untouched High/Medium entries that have real foundations in the schema or in work already built.

## 2. Status update at a glance

| Item | State |
| --- | --- |
| Batch 1 (10 features: 25, 63, 72, 39, 38, 43, 51, 14, 13, 44) | **Built, tested, audited** |
| Batch 2 (10 features: 69, 71, 35, 54, 76, 85, 64, 67, 48, 45) | **Built, tested, audited**: database, server action, pages, SQL tests and unit/contract tests for every feature |
| Tests added | Batch 1: 195. Batch 2: 99 earlier + 1 regression (feature 44); this session 101 (85: 22, 64: 21, 67: 20, 48: 20, 45: 18) |
| Full `npm test` | **2,324 pass, 0 fail** (76 suites; second run, after the bundle-mock fix in §6 finding 28) |
| `npm run typecheck` (`tsc --noEmit`) | exit 0 |
| `npm run lint` (`eslint .`, whole repository) | exit 0, no warnings |
| Production build | `npx next build --webpack`: **passed** (exit 0) |
| Migration chain replay (`scripts/replay-migration-chain.mjs --continue`) | **240/240 files applied, 0 failures**, including every new migration |
| Real-schema smoke test (replayed schema, scratchpad script) | 24 of 28 checks pass; the 4 that do not are seeding limits of existing workflows (completion, quote costing, stock-posted dispatch), see §6 |
| `UPGRADE_EOS.md` | 30 entries now `[x]`, including all 20 features of both batches (their text says database rollout and visual acceptance are pending) |
| Hosted database | Unchanged |

## 3. Migrations (apply in this order, after the live `20261022000000_operator_workflow_helpers.sql`)

The first session's files were renumbered from `20261022100000/110000/120000` because those versions are already used on hosted by the audit2 Wave 1 migrations.

| File | Feature | Depends on |
| --- | --- | --- |
| `20261022200000_quote_revision_comparison.sql` | 25 | — |
| `20261022210000_production_readiness_and_holds.sql` | 63, 72 | re-creates `private.transition_production_job_atomic` |
| `20261022220000_shift_handover_summaries.sql` | 39 | 210000 (`production_job_holds`), `production_exceptions` |
| `20261022230000_order_line_delivery_schedule.sql` | 38 | — |
| `20261022240000_customer_projects.sql` | 43 | — |
| `20261022250000_profile_stock_balance_explanation.sql` | 51 | read only |
| `20261022260000_department_handoffs.sql` | 14 | — |
| `20261022270000_bulk_queue_actions.sql` | 13 | 260000 |
| `20261022280000_approval_inbox.sql` | 44 | — (patched in batch 2) |
| `20261022290000_handoff_acceptance.sql` | 69 | 260000 |
| `20261022300000_turnaround_targets.sql` | 71 | 260000 |
| `20261022310000_task_delegation.sql` | 35 | 270000, 290000 |
| `20261022320000_inspection_plans.sql` | 54 | — |
| `20261022330000_competencies.sql` | 76 | `operating_procedures` (live) |
| `20261022340000_costing_rates.sql` | 85 | — (patched this session: four-eyes fix) |
| `20261022350000_task_trigger_rules.sql` | 64 | 270000 (`private.bulk_supervised_roles`) |
| `20261022360000_task_completion_criteria.sql` | 67 | 260000 (`tasks.handoff_*`), 290000 (`handoff_acceptances`), 320000 (`private.inspection_plan_evaluation`) |
| `20261022370000_record_subscriptions.sql` | 48 | 360000 (`private.task_source_state`) |
| `20261022380000_exception_requests.sql` | 45 | replaces `private.guard_low_margin_quote_approval` (20261008010000) with the same rule plus the exception check |

All of them are additive (new tables, nullable columns, functions and triggers, RLS on every new table). None drops data.

## 4. Batch 2: what was built

Every feature uses the batch-1 pattern:
- **Database:** one additive migration with RLS, and a single `*_command(text, jsonb)` SECURITY DEFINER RPC. The RPC takes company and actor from the session, checks roles, makes writes idempotent by request id, checks for stale state and pages lists at 10 rows.
- **App:** a zod module in `lib/workflow`, a server action in `lib/actions` (business messages passed through by a whitelist that a test checks against the migration), a client component and pages.
- **Tests:** a PGlite fixture in `scripts/lib`, SQL tests, and unit/contract tests that parse real database output with the app's schemas and compare the app's role and validation tables with the database functions.

Features 69, 71, 35, 54 and 76 are unchanged from the previous handover (see the `UPGRADE_EOS.md` entries and their files). This session:

### Feature 85 — Approved dated costing rates — DONE (22 tests)
- **App side built:**
  - `/quotes/rates` lists current, draft and past rates (10 per page, filtered by type), with a "Needs review" box.
  - `/quotes/rates/new` creates or edits a draft (`?edit=<id>`).
  - Approve is hidden from a draft's author unless they are the owner; withdrawing needs a reason.
  - The quote page has a **Rate Check** card: each line's billet, conversion and finishing rate against the bound or applicable approved rate. It is shown only to commercial roles, never to dealers.
  - The quote form has an explicit, overridable **Apply approved rates** button.
- **Shared margin rule:** `sellingPriceFromMargin` and `marginToMarkup` now live in `lib/calculations/quote.ts`, and the quote engine uses them (identical arithmetic): 250 at 20% gives 312.50.
- **Audit fix:** editing someone else's draft kept the original author, so a sales manager could rewrite an accounts draft and approve it himself. Whoever last edits a draft now becomes its author.
- **Files:**
  - Database: `supabase/migrations/20261022340000_costing_rates.sql`
  - App: `lib/workflow/costing-rates.ts`, `lib/actions/costing-rates.ts`, `components/modules/quotes/costing-rates.tsx` and `quote-rate-check.tsx`, `app/(dashboard)/quotes/rates/{page,new/page}.tsx`, `app/(dashboard)/quotes/[id]/page.tsx`, `app/(dashboard)/quotes/page.tsx` (link), `components/modules/quotes-client.tsx`, `lib/calculations/quote.ts`
  - Tests: `tests/costing-rate.test.mjs`, `tests/costing-rate-sql.test.mjs` (+1). `tests/quote-paste-browser.test.mjs` and `tests/in-task-customer-browser.test.mjs` now mock the new action.

### Feature 64 — Tasks created from defined triggers — DONE (21 tests)
- **Rules** (`/tasks/triggers`, managers): five events.
  - Order more than N days past its expected dispatch date.
  - Rejected inspection (raised in the same transaction by a trigger).
  - Breakdown open more than N hours.
  - Sent quotation within N days of expiry.
  - Invoice balance N days past due.
- **Each rule sets:**
  - the assignee: a role (the least-loaded employee) or a named employee with an optional fallback role, limited to the roles that can do that kind of work;
  - a due policy in calendar or working days (Monday to Saturday);
  - a priority.
- **No duplicates:** a unique key per (rule, source, occurrence) means retried, replayed, concurrent and scheduled runs never create duplicates. A rescheduled order that slips again is a new occurrence.
- **Safe retries:** a run is recorded by its request id, so retrying a request whose response was lost returns the original result. The page retries automatically with the same id.
- **Event reference:** a task's source reference is immutable (trigger).
- **Unassigned work** is still created, flagged with the reason, notified to the responsible manager role, and listed for recovery: assign within your team, or retry the rule.
- **Scheduler entry point:** `private.run_task_triggers_for_all()`.
- **Files:**
  - Database: `supabase/migrations/20261022350000_task_trigger_rules.sql`
  - App: `lib/workflow/task-triggers.ts`, `lib/actions/task-triggers.ts`, `components/modules/tasks/task-triggers.tsx`, `app/(dashboard)/tasks/triggers/{page,new/page,[id]/page}.tsx`, `app/(dashboard)/tasks/page.tsx` (link)
  - Tests: `scripts/lib/task-trigger-fixture.mjs`, `tests/task-trigger-sql.test.mjs`, `tests/task-trigger.test.mjs`

### Feature 67 — Objective completion criteria — DONE (20 tests)
- **Criterion kinds:**
  - the linked record (order, inspection, production job, dispatch, quotation, invoice or breakdown) is in a required state;
  - the linked inspection passes its approved plan (feature 54);
  - the receiving team accepted the handoff (feature 69);
  - an observation is within limits;
  - a named role other than the assignee has signed off (later results invalidate the sign-off).
- **Wrong source:** a criterion binds the record linked at attach time, so a re-linked task fails, even in the same update as completion.
- **Completion guard:** a trigger refuses completion by every path while a criterion is unmet. The message names the first two reasons and stays within the 240 characters the tasks API shows.
- **Templates** per task kind (`/tasks/criteria`, managers) attach to new **internal** tasks only. Dealers cannot see criteria, so attaching them to dealer tasks would lock dealers out.
- **On a task** (task page): supervisors add or remove criteria with a reason, and assignees record observations.
- **Reversed outcomes:** completed tasks whose outcome is later reversed are listed for review and can be reopened with a reason.
- **Files:**
  - Database: `supabase/migrations/20261022360000_task_completion_criteria.sql`
  - App: `lib/workflow/completion-criteria.ts`, `lib/actions/completion-criteria.ts`, `components/modules/tasks/completion-criteria.tsx`, `app/(dashboard)/tasks/criteria/{page,new/page,[id]/page}.tsx`, `app/(dashboard)/tasks/[id]/page.tsx`, `app/(dashboard)/tasks/page.tsx` (link)
  - Tests: `scripts/lib/completion-criteria-fixture.mjs` (loads the real feature 54 migration), `tests/completion-criteria-sql.test.mjs`, `tests/completion-criteria.test.mjs`

### Feature 48 — Controlled subscriptions and grouped notifications — DONE (20 tests)
- **Following:** a **Follow updates** control on the order, quotation, invoice, dispatch, inspection and production job pages. It appears only where the role may open that page (a test checks this against `hasRouteAccess` for every role), with categories to choose.
- **Events:** triggers on the source tables record changes to followed records only. Dispatches and invoices also update their order; inspections update their job and order.
- **Delivery:** one digest per person and window, one line per record ("Order SO-0042 · 3 updates · latest: …").
  - Each change is delivered once.
  - Your own changes are never sent back to you.
  - Access is rechecked at delivery.
- **Preferences** (`/notifications/following`): immediate, hourly or daily digests, IST quiet hours (which may wrap midnight) and muted categories. The page also shows recent summaries, each with **Copy for WhatsApp**.
- **Action requests** (`/notifications/requests`) are kept separate from information:
  - You ask a colleague who can act from the record page.
  - A request is resolved against current records, or marked done or withdrawn.
  - Reminders respect quiet hours, are sent once per number and stop at 10, and stop when the request is resolved.
  - If the recipient leaves, the request closes and the requester is told.
- **Scheduler entry point:** `private.run_notification_delivery_for_all()`.
- **Not included:** external email or WhatsApp sending (no provider).
- **Files:**
  - Database: `supabase/migrations/20261022370000_record_subscriptions.sql`
  - App: `lib/workflow/subscriptions.ts`, `lib/actions/subscriptions.ts`, `components/modules/notifications/record-follow.tsx`, `app/(dashboard)/notifications/{following,requests}/page.tsx`, `app/(dashboard)/notifications/page.tsx` (links), and the six detail pages
  - Tests: `scripts/lib/subscription-fixture.mjs`, `tests/subscription-sql.test.mjs`, `tests/subscription.test.mjs`

### Feature 45 — Approval requests at the point of restriction — DONE (18 tests)
- **Policies** (`/tasks/approvals/exceptions`, owner/admin) choose which restrictions may be lifted, by whom and for how long:
  - **Low-margin quotation release** (the existing guard). A price below cost, or a shortfall beyond the policy, is never released this way.
  - **A new, opt-in dispatch hold** for customers whose overdue balance reaches a set amount. Above a hard limit, only collecting payment lifts it.
- **Requests** are made beside the restriction (quotation page; order page) and bound to a content fingerprint. They appear in the approval inbox (`/tasks/approvals#exceptions`). Another person decides against the version they saw. A request whose record moved on, or whose overdue amount grew, is closed as superseded.
- **Guards** accept an approval only for that exact record and content. A dispatch exception covers one dispatch on that order up to the approved weight and is then used up. This covers dispatches created already dispatched by `save_ready_dispatch_atomic`.
- **Without a policy**, behaviour is exactly as before (tested).
- **App fix:** `updateQuoteStatusAction` refused non-approvers before the database ever saw the request. It now defers to the database guard when an approved exception covers the current version, and the quote page explains a changed-version refusal.
- **Files:**
  - Database: `supabase/migrations/20261022380000_exception_requests.sql`
  - App: `lib/workflow/exception-requests.ts`, `lib/actions/exception-requests.ts`, `components/modules/approvals/exception-requests.tsx`, `app/(dashboard)/tasks/approvals/{page,exceptions/page}.tsx`, `app/(dashboard)/quotes/[id]/page.tsx`, `app/(dashboard)/orders/[id]/page.tsx`, `lib/actions/quotes-orders.ts`
  - Tests: `scripts/lib/exception-fixture.mjs` (installs the real original low-margin guard first), `tests/exception-sql.test.mjs`, `tests/exception.test.mjs`

## 5. Batch 1 (summary; details in `EOS_UPGRADE_CLAUDE.md`)

| # | Feature | Where |
| --- | --- | --- |
| 25 | Revision comparison | quote page |
| 63 / 72 | Ready-to-start conditions; recorded hold and resume | production job page |
| 39 | Shift-handover summaries | `/production/handover` |
| 38 | Delivery date and priority per order line | order page; production and dispatch overviews |
| 43 | Project and site grouping | `/customers/projects` |
| 51 | Explainable stock balance | `/inventory/stock-balances` |
| 14 | Automatic department handoffs | `/tasks/handoffs` |
| 13 | Safe bulk queue updates | `/tasks/bulk`, `/production/bulk` |
| 44 | Approval inbox | `/tasks/approvals` |

## 6. Findings (audit results)

Batch 1 and earlier batch 2 (unchanged; all fixed unless stated):
1. **Live security leak:** `quote_revisions.snapshot_json` was readable by every company user. Fixed in 200000; not yet applied to hosted.
2. The quote's "Approved By" was hard-coded as "Admin User", and revision authors always showed "System".
3. The production "Mark Ready" button could never succeed.
4. The systems configurator counted QC-held stock as available.
5. A breakdown marked resolved with no end time counted as downtime forever (handover).
6. Overlapping shift-handover windows were accepted.
7. Migration version collision with audit2 Wave 1 (renumbered).
8. **Not changed:** `enforce_quote_status_transition` allows `sales_manager` to approve low-margin quotes, but `a_guard_low_margin_quote_approval` allows only owner/admin. Feature 45 now gives companies an explicit, audited way to delegate this.
9. Dead code: `components/modules/production-client.tsx` is unused. Not changed.
10. NULL-comparison permission bug in turnaround waits. Fixed.
11. Same bug class in feature 44's `can_decide`. Fixed.
12. The `quality_manager` role does not exist in the app's `UserRole`.
13. `42501` errors were hidden behind a generic "not permitted". Competency refusals are now passed through.
14. Quote lines saved in one statement share `created_at`.
15. Handoff tasks are visible on `/tasks` to roles outside the team (existing behaviour).

New this session:
16. **Four-eyes bypass in 85:** a second user could edit another's draft rate and then approve it. Fixed: the last editor becomes the author (regression test).
17. **Scheduled runs:** `pg_cron` jobs have no `auth.uid()`, so the user-facing RPCs refuse them. Features 64 and 48 add private all-company entry points. Features 71 and 35 still need a scheduled caller (§7).
18. **Refusal messages:** the tasks API shows database messages only up to 240 characters. Feature 67 refusals are capped at two reasons plus a count.
19. **Dealer lock-out avoided:** criteria templates would have attached to dealer tasks that dealers cannot see. They attach to internal tasks only (regression test).
20. **No temp tables in SECURITY DEFINER:** feature 48's digest first used a temporary table. Since `pg_temp` is searched first for unqualified names, it now uses an id array.
21. **App pre-check blocked feature 45:** `updateQuoteStatusAction` refused non-approvers before the database guard ran. It now defers when an approved exception covers the version.
22. **Design change in 45:** new dispatches are inserted already dispatched, so a held dispatch never exists to request an exception for. The exception is bound to the order and a stated weight, and is used up by one dispatch.
23. **Rolled-back supersede (45):** "superseded" was set and then an exception was raised, which rolled the status back. The command now returns a result, so the state persists and the requester is notified.
24. **Hidden exposure increase (45):** approving silently raised the approved overdue exposure to the current amount. It now supersedes the request if exposure grew since it was raised.
25. **Checked, no leak:** role-targeted notifications (`recipient_role`, used by 64, 71 and 45) are restricted by `private.notification_visible_to_current_user`, so they reach only that role, never dealers.
26. **Real-schema smoke (replayed chain):**
    - Feature 45's hold (`b_guard_overdue_dispatch`) fires before the existing "verified stock posting" dispatch guard.
    - Feature 48 grouped three changes (stage, job, invoice payment) into one line.
    - The 4 unexercised checks need existing workflows (validated production completion, quote item costing, stock-posted dispatch activation) that the script cannot seed directly. Fixtures cover those paths.
27. **Cosmetic:** a low-margin quotation with no lines shows "required 0%" in the restriction text.
28. **Test bundles:** the first full run had 40 failures in four browser suites (`collaboration-workflows-browser`, `entry-acceptance-integration`, `operator-workflows-browser`, `upgrade-workflow-browser`). Their esbuild bundles now reached the new server actions (`costing-rates`, `subscriptions`, `exception-requests`), which import `next/cache`. The shared bundle helpers (`scripts/lib/entry-acceptance-browser-fixture.mjs`, `scripts/lib/workflow-browser-bundle.mjs`) now mock those actions. The server Supabase mock answers `rpc` as "function not deployed", which also exercises the quote page's degrade path. All 39 tests in those suites pass.

## 7. What is pending, and how to do it

### 7.1 Before anything goes live
1. Review and commit. Suggested: one commit per feature, plus one for the inherited features 6 and 84. Branch `feat/upgrade-eos-calc-batch`; don't push without approval.
2. For each migration, in the §3 order, do a forced-rollback dry run on hosted:
   ```sql
   begin; <migration body without begin/commit>; do $$ begin raise exception 'DRYRUN'; end $$;
   ```
   Then apply it with `apply_migration`, with the user's explicit approval.
3. Behaviour that changes on live data once applied:
   - **200000:** revision snapshots are no longer directly readable.
   - **210000:** starts are blocked by an active hold or an ineligible billet.
   - **260000:** every QC approval creates a packaging task.
   - **290000:** new handoffs need acceptance before work starts.
   - **320000 and 330000:** restrict approvals only once a company creates plans or requirements.
   - **340000:** binds rates on quote approval.
   - **350000:** a rejected inspection raises tasks only once a rule exists.
   - **360000:** refuses completion only for tasks that carry criteria.
   - **370000:** records events only for followed records.
   - **380000:** changes nothing until a policy is enabled.
4. Check that the main checkout's replay harness (branch `fix/migration-chain-replay`) also replays the new files after merging. It already passes here (240/240).

### 7.2 Operational follow-ups
- **Schedule** every 15 minutes, for example through Supabase cron:
  - `select private.run_task_triggers_for_all()` (64);
  - `select private.run_notification_delivery_for_all()` (48);
  - an all-company equivalent of `turnaround_command('escalations.run')` (71) and `task_delegation_command('delegation.sync')` (35). These two still need one written, as in 64 and 48.
- **Visual acceptance** (desktop 1280 px, phone 375 px) for every new page: `/quotes/rates`, `/tasks/triggers`, `/tasks/criteria`, `/notifications/following`, `/notifications/requests`, `/tasks/approvals/exceptions`, plus the new panels on the quote, order, task and record pages.
- **External delivery (48):** sending summaries by email or WhatsApp needs a provider; today only in-app summaries and a Copy for WhatsApp button exist.

## 8. Environment notes
- Turbopack build error: `Symlink [project]/node_modules is invalid, it points out of the filesystem root`. The worktree's `node_modules` points to the main checkout. Use `npx next build --webpack`.
- Multi-line shell heredocs that contain apostrophes fail in this Bash tool. Write edit scripts to the scratchpad and run them with Python.
- The real-schema smoke script is in the session scratchpad (`smoke/smoke.mjs`). It uses `scripts/lib/migration-chain-replay.mjs` and never connects to Supabase.

## 9. Commands and results (this session)
| Command | Result |
| --- | --- |
| `node --test tests/costing-rate*.test.mjs` | 22 pass |
| `node --test tests/task-trigger*.test.mjs` | 21 pass |
| `node --test tests/completion-criteria*.test.mjs` | 20 pass |
| `node --test tests/subscription*.test.mjs` | 20 pass |
| `node --test tests/exception*.test.mjs` | 18 pass |
| Tests reading changed pages (quote, order, task, notification, record pages) | 56 + 26 pass |
| `npx tsc --noEmit` | exit 0 |
| `npx eslint .` | exit 0 |
| `node scripts/replay-migration-chain.mjs --continue` | 240/240 applied, 0 failures |
| Real-schema smoke (scratchpad) | 24/28 (see §6, finding 26) |
| `npm test` | **2,324 pass, 0 fail** (76 suites; second run, after the bundle-mock fix in §6 finding 28) |
| `npx next build --webpack` | `npx next build --webpack`: **passed** (exit 0) |

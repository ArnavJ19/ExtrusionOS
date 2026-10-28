# EOS Upgrade — Claude Handover

Date: 22 October 2026
Sessions: "EOSUPGRADE features development and audit" (Claude Code, Opus 5.5), two consecutive sessions.
Location of all work: worktree `C:\Users\arnav\OneDrive\Desktop\ExtrusionOS\.worktrees\eos-calc`, branch `feat/upgrade-eos-calc-batch` (HEAD `0228e59`).
**Nothing is committed, pushed, or applied to the hosted Supabase project.** Only read-only queries were run against `pkawmdxtmsdgigsehcmb`.

---

## 1. What was asked

> Build 10 features mentioned in EOSUPGRADE.md. For each feature: recheck, reverify, create edge and unit test cases, test it, and audit it. Features should be medium-to-difficult.

- `EOSUPGRADE.md` does not exist; the catalogue is **`UPGRADE_EOS.md`** (100 features).
- The features were chosen from untouched Medium/High entries that have real foundations in the schema.

## 2. Status at a glance

| Item | State |
| --- | --- |
| Features built and tested | **10 of 10**: 25, 63, 72, 39, 38, 43, 51, 14, 13, 44 |
| New tests | 195 (SQL tests on PGlite with hosted-shaped tables and real guard functions, plus unit/contract tests) |
| `npm run lint` | pass |
| `npm run typecheck` | pass |
| Build | pass with `next build --webpack` (all 13 new routes compiled); Turbopack build blocked by the worktree node_modules symlink, see §7 |
| `npm test` (full suite) | **2,135 pass, 0 fail** (1,940 baseline + 195 new) |
| Hosted DB | unchanged |

Catalogue entries stay `[ ]` "implemented and automatically tested locally" (project convention) until database rollout and visual acceptance.

## 3. Migration numbering (important)

The first session's migrations were `20261022100000/110000/120000`. Those versions **collide** with the audit2 Wave 1 migrations already applied to hosted (`20261022100000_dispatch_delete_lifecycle_guard`, and others). They were renamed:

| File | Feature |
| --- | --- |
| `20261022200000_quote_revision_comparison.sql` | 25 |
| `20261022210000_production_readiness_and_holds.sql` | 63, 72 |
| `20261022220000_shift_handover_summaries.sql` | 39 |
| `20261022230000_order_line_delivery_schedule.sql` | 38 |
| `20261022240000_customer_projects.sql` | 43 |
| `20261022250000_profile_stock_balance_explanation.sql` | 51 (read only) |
| `20261022260000_department_handoffs.sql` | 14 |
| `20261022270000_bulk_queue_actions.sql` | 13 (needs 260000) |
| `20261022280000_approval_inbox.sql` | 44 |

All of them are additive. They depend on `20261022000000_operator_workflow_helpers.sql` (`production_exceptions`), which is already live.

## 4. Features

Every feature follows the same pattern: one additive migration with RLS; a single `*_command(text, jsonb)` SECURITY DEFINER RPC that takes company and actor from the session, checks roles, uses request-id idempotency and stale-state checks, and pages lists at 10 rows; a zod schema module in `lib/workflow` (or `lib/inventory`); a server action; pages; a PGlite fixture in `scripts/lib`; SQL tests and unit/contract tests (the contract tests parse real database output with the app's schemas).

### Feature 25 — Revision comparison (quotations) — BUILT, TESTED

What it does:
- Quote detail page has a "Compare versions" form (From / To: any recorded revision or the current version). Result card shows commercial-term changes, per-line Added / Removed / Changed / Unchanged, each change with units and signed delta, who superseded each version, when and why, the status at that version (issued versions flagged as superseded instructions), approver name, and the linked order's accepted basis.
- `quote_items` are deleted and reinserted on every save (new ids), so lines are paired structurally: same profile → same cut length + finish first → then entry order. A profile swap shows as removed + added, never as an edit.
- Role projection matches `quotes_authorized` / `quote_items_authorized`: owner/admin/accounts see costs and margins; sales see prices only; viewers see quantities only; dealers see only their own quotations, no internal notes. Internal notes and supplier rates are never returned.

**Security finding fixed (live leak):** the hosted policy `quote revisions tenant read` is `company_id = get_current_user_company_id()`. Any company user — viewer, production, dispatch, and dealer users (including other dealers' quotes) — can read `quote_revisions.snapshot_json`, which contains billet rates, conversion charges, margins and internal notes. The migration revokes direct column access to `snapshot_json`, restricts revision metadata to users who can see the parent quotation, and serves comparisons via a role-projected SECURITY DEFINER RPC.

Other defects fixed on the quote page:
- "Approved By" was hard-coded to `"Admin User"`; now shows the real approver name or "Name not recorded".
- Revision authors always showed `"System"` (`rev.users` was never loaded); now shows the real name.

Files:
- `supabase/migrations/20261022200000_quote_revision_comparison.sql` (new)
- `lib/workflow/quote-revision-compare.ts` (new — pure diff/pairing/parsing)
- `lib/workflow/quote-revision-loader.ts` (new — RPC + name lookup)
- `components/modules/quotes/quote-revision-comparison.tsx` (new)
- `app/(dashboard)/quotes/[id]/page.tsx` (modified)
- `scripts/lib/quote-revision-compare-fixture.mjs`, `tests/quote-revision-compare.test.mjs` (new, 15 tests)

Tests cover: quantity/finish change with units and delta; rewritten line ids; profile swap; entry-order pairing; precision noise; missing ≠ zero; projected-away fields never reported; param parsing; snapshot not directly readable by any role; dealer/production/foreign visibility; cost/price/basic/dealer projections; invalid version pairs; malformed/oversized snapshots; linked order; anon cannot execute.

Limitation: draft edits between recorded revisions are not versioned (existing save behaviour — only issued quotes create snapshots).

### Feature 63 — Ready-to-start conditions (production jobs) — BUILT, TESTED

What it does:
- Production job detail shows a "Readiness and holds" panel listing **all** unmet prerequisites at once for the next action (release / start / resume), each with a link to where it is resolved (edit job, die, press, press schedule, issue billets, order, profile).
- Readiness is computed **in the database** (`private.production_readiness_issues`) with the same rules the existing guards enforce: legal status, order stage, die assigned + eligible + not running elsewhere, extrusion press eligible, released slot, issued billet when a billet requirement exists. Advisory (non-blocking): profile drawing not approved.
- Newly enforced at start: a linked billet that became scrap/cancelled or moved to another order.
- Parity tests install the **real** guard functions extracted from their latest migrations (`scripts/lib/sql-function-extract.mjs`) and prove that every blocker readiness reports is rejected by the real trigger for the same reason, and that "ready" really starts.

Defect fixed: the floor workflow's **"Mark Ready"** button always failed — `planned → ready` is illegal in `transition_production_job_atomic`; only releasing a press slot makes a job ready. Replaced by a "Release to a press" link to `/production/schedule`.

Dead code noted (not changed): `components/modules/production-client.tsx` is imported nowhere; it also has "Mark Ready" and a "Complete" button the server rejects. Only `tests/order-to-press-security.test.mjs` reads it statically.

### Feature 72 — Hold and resume procedure — BUILT, TESTED

What it does:
- "Place this job on hold" form: reason (material shortage, die problem, machine breakdown, quality hold, customer instruction, planning change, other — other needs a note), material/work condition, responsible production employee, what permits resumption. Records progress at hold (output kg/pieces, issued billet count/kg). Uses the authoritative transition, so status history and the press rule still apply.
- Resume: requires a note; rechecks prerequisites for the **earlier state** (running → full start checks; ready → die/press/slot/billets; planned → die/billets/order); restores that state; never rewrites recorded progress; idempotent by request id; stale hold/state rejected.
- A held job cannot be started through the ordinary transition ("Resume through the recorded hold…"). Cancelling a held job closes the hold with the reason.
- The floor workflow's "Put On Hold" now goes to the recorded hold form. Legacy holds without a record still start via normal checks.
- Hold history (paginated 10) on demand.

Files (63 + 72):
- `supabase/migrations/20261022210000_production_readiness_and_holds.sql` (new — table `production_job_holds`, readiness function, re-created `private.transition_production_job_atomic` with two extra checks + hold closure, RPC `production_hold_command`)
- `lib/workflow/production-readiness.ts`, `lib/actions/production-holds.ts` (new)
- `components/modules/production/production-readiness-panel.tsx` (new)
- `app/(dashboard)/production/[id]/page.tsx`, `components/modules/production-output-workflow.tsx` (modified)
- `scripts/lib/production-hold-fixture.mjs`, `scripts/lib/sql-function-extract.mjs` (new)
- `tests/production-readiness-holds-sql.test.mjs` (14 tests), `tests/production-readiness.test.mjs` (6 tests)

### Feature 39 — Shift-handover summaries — BUILT, TESTED (31 tests)

- `/production/handover` (list, status filter, 10/page), `/production/handover/new` (latest Day 08:00–20:00 / Night 20:00–08:00 IST presets or any window up to 24 h; preview; note; submit), `/production/handover/[id]` (stored snapshot, acknowledge, WhatsApp text copy).
- Each job appears once: completed in the window, otherwise its current held/running/ready state, with outstanding kg (unknown, never zero, when there is no plan) and the recorded hold reason. Breakdowns are clipped to the window. **Fix:** a resolved breakdown without an end time counted as running forever; it now adds no time. Exceptions, open inspections, current stock QC holds, and pending/overdue loads are included.
- The snapshot is stored unchanged. A different supervisor acknowledges once. **Overlapping windows are refused** (previously only identical windows were). Retries are idempotent.
- Quality and dispatch managers can read (new `/production/handover` route rule). Sales and dealers cannot.

### Feature 38 — Delivery dates and priorities by order line — BUILT, TESTED (25 tests)

- `order_line_schedules` sits beside `order_items`, whose rows are guarded by workflow triggers, plus an audited `order_line_schedule_events`. A line inherits the order's date and priority unless it has its own.
- Changes need a reason. They are rejected for stale versions, past dates, dates outside order date + 2 years, closed/cancelled/delivered orders, and fully supplied lines. The order's own stage, date and priority never change.
- The order page shows line progress using the order workspace's bases (feature 6). Production and dispatch overviews show a line queue (overdue, then priority, then date; filters; 10/page).
- Adds index `packing_list_items(company_id, source_line_id)`.

### Feature 43 — Project and site grouping — BUILT, TESTED (25 tests)

- `/customers/projects` (literal search, status filter, 10/page), new, detail, edit. Each project has a delivery site, an Indian mobile number, a 6-digit PIN and a status.
- Explicit links only, same company **and** same customer, and at most one project per record. Linking an order can include its quotation and dispatches, with a per-record outcome (skipped, never moved). Unlinking needs a reason and is recorded.
- Totals have stated definitions. Values are shown only to owner, admin, sales roles and accounts.

### Feature 51 — Explainable balances (stock half) — BUILT, TESTED (17 tests)

- `/inventory/stock-balances` and `/inventory/stock-balances/[id]`: available = on hand − open reservations − excluded (QC/status) + shortfall, in kg, pieces and metres, using the reservation ledger's basis (no double counting). The page lists the signed withdrawals behind on hand. The app refuses to display an explanation that does not reconcile.
- Dealers see only their own batches, without other parties' customer names. Commercial rates are never returned.
- **Audit fix:** the systems configurator counted QC-held stock as available and then failed at reservation. It now uses `isReservableBatch`.

### Feature 14 — Automatic department handoffs — BUILT, TESTED (20 tests)

- Tasks get nullable `handoff_*` columns and a unique `(company_id, handoff_key)`. Triggers run in the source transaction: QC release goes to packaging (approved kg, including rework-approved children), finishing receipt goes to quality, completed packaging goes to dispatch. One task per event, whatever is retried or replayed.
- `/tasks/handoffs`: per-team queue, take once. Supervisors can safely recheck one source record.

### Feature 13 — Quick queue updates and safe bulk actions — BUILT, TESTED (20 tests)

- `/tasks/bulk` (assign, due date, priority) and `/production/bulk` (planned date, shift; planned jobs not on the press schedule). Up to 50 records; preview, then apply.
- Every record gets an explicit outcome. Records are locked and fingerprint-checked on apply. Supervisors assign only within the teams they supervise. Applies are idempotent and logged in `bulk_queue_operations`.

### Feature 44 — Dedicated approval inbox — BUILT, TESTED (22 tests)

- `/tasks/approvals`: quotations in internal review and expenses pending approval, limited to what the employee may decide. Approve, Reject and Request Clarification (which notifies the requester) go through each record's own guards and workflow (`enforce_quote_status_transition`, costing guards, `transition_expense_approval`).
- Version fingerprints refuse superseded requests. A decided version can't be decided again. Self-decision is blocked except for the owner.

## 5. Audit of previously built features

| Feature | What I checked | Result |
| --- | --- | --- |
| 6 Connected order workspace (uncommitted, prior session) | Code review of `lib/orders/order-progress.ts`, panel, order page; job limit + unavailability handling; dealer exclusion; packing totals call | OK. Uses the same kg basis as the DB guard; unavailable never shown as zero. Note: "Dispatched" is from packing history (packed bundles), per order, not per line. |
| 84 Finishing area (uncommitted, prior session) | Note uses same perimeter precedence as costed line (`quotes-client.tsx:186`); shared `SQFT_PER_M2`; tests | OK. |
| 89 / 91 / 92 (committed `0228e59`) | Included in baseline run | Baseline green. |
| 1, 2, 3, 9, 10, 20, 21, 24, 26, 49 (marked complete) | Covered by the baseline suite only | Baseline green; no per-feature re-audit done yet. |
| 4, 15, 22, 23, 32, 33, 41, 42, 47, 50, 83, 90 (implemented, visual pending) | Covered by baseline suite only | Visual acceptance still open, as documented in the catalogue. |

Findings from the audit so far:
1. **Security (live):** `quote_revisions.snapshot_json` readable by every company user incl. other dealers — fixed in migration `20261022200000` (not yet applied to hosted).
2. **Fake data:** quote "Approved By" hard-coded `Admin User` — fixed.
3. **Broken display:** revision author always `System` — fixed.
4. **Broken button:** production "Mark Ready" can never succeed — fixed (link to press schedule).
5. **Dead code:** `components/modules/production-client.tsx` unused, with buttons the server rejects — not changed; recommend deleting after confirming, and updating `tests/order-to-press-security.test.mjs`.
6. Feature 14 (department handoffs) is partly present already: completing a mill-finish job auto-creates one packaging job (deduplicated) in `link_billets_to_production_job`.
7. Feature 51 (explainable balances) already exists for invoices (`lib/financials/receivables.ts`); only the stock-balance half is missing.

Audit still to do: a per-feature re-read of 1–3, 9, 10, 20, 21, 24, 26, 49 and the visual-pending set against their acceptance examples.

Additional findings from the second session:
8. **Migration version collision** with audit2 Wave 1 (fixed by renaming, see §3).
9. `enforce_quote_status_transition` lets `sales_manager` approve low-margin quotes, but `a_guard_low_margin_quote_approval` (which runs first) allows only owner/admin. The effective rule is owner/admin, and the inbox follows it. Not changed; recommend aligning the older function.
10. Configurator QC-held stock (fixed, feature 51).
11. A breakdown "resolved without an end time" inflated downtime (fixed, feature 39).
12. Handoff tasks are unassigned, so the existing `/tasks` dashboard shows them to roles outside the team (existing behaviour for unassigned tasks). `/tasks/handoffs` is team-scoped.

## 6. Checklist against UPGRADE_EOS.md

- [x] 25 Revision comparison
- [x] 63 Ready-to-start conditions
- [x] 72 Hold and resume procedure
- [x] 39 Shift-handover summaries
- [x] 38 Delivery dates and priorities by order line
- [x] 43 Project and site grouping
- [x] 51 Explainable balances (stock half; the invoice half already existed)
- [x] 14 Automatic department handoffs
- [x] 13 Quick queue updates and safe bulk actions
- [x] 44 Dedicated approval inbox

(Built and automatically tested; visual acceptance and hosted rollout are still pending.)

## 7. Commands and results

| Command | Result |
| --- | --- |
| `npm run lint` | pass (2 purity errors in new pages were fixed by using `getBusinessDateBoundaries`) |
| `npm run typecheck` | pass |
| `npm run build` (Turbopack) | fails before compiling: `Symlink [project]/node_modules is invalid, it points out of the filesystem root`. The worktree's `node_modules` is a symlink to the main checkout; this is environmental and unrelated to the code. |
| `npx next build --webpack` | pass (exit 0); all new routes listed |
| `npm test` | 2,135 pass, 0 fail, 76 suites (about 9.6 min) |

## 8. Before anything goes live

1. Review and commit. Suggested commits: inherited 6/84; 25; 63+72; then one per feature 39, 38, 43, 51, 14, 13, 44.
2. Dry-run each migration on hosted with a forced rollback, then apply in the §3 order.
3. `20261022200000` changes live access to `quote_revisions`. After applying, check that the quote page revision list loads for sales and viewers.
4. `20261022210000` re-creates `private.transition_production_job_atomic`. Starts are now also blocked by an active recorded hold or an ineligible linked billet.
5. `20261022260000` adds triggers on `quality_inspections`, `finishing_jobs` and `packaging_jobs`. From then on, every QC approval creates a packaging task.
6. Manual checks at 1280 px and 375 px: each new page above, as owner, a supervisor, a floor role, viewer and dealer.

## 9. Other context

- The worktree also holds uncommitted work from the earlier "FEATURES BUILD" session (features 6 and 84, Playwright evidence), audited in §5.
- The main checkout is on `fix/migration-chain-replay` with its own uncommitted files and was not touched. Its migration replay harness (`scripts/replay-migration-chain.mjs`) is not on this branch. Run it after merging, so the new files replay in order.

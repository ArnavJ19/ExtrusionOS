# FABLE_SUGGESTIONS Phase 4, batch 1: "make it intelligent"

17 November 2026, root checkout `feat/autopilot-batch-10`. The starting HEAD was `71a17b1`, with uncommitted Autopilot batch 10 work that has been kept as it was. Nothing was committed, pushed, applied to the hosted database or deployed.

## 1. Batch summary

| | |
|---|---|
| Selected | 10 (FS-68, 73, 72, 71, 27, 16, 38, 36, 54, 26) |
| Implemented | 5: FS-68, FS-73, FS-72, FS-71, FS-27 |
| Partial | 5: FS-16, FS-38, FS-36, FS-54, FS-26 |
| Blocked / verified existing | 0 / 0 |
| Final git state | Uncommitted changes in the root checkout, mixed with the uncommitted batch 10 work |

**Scope rule.** The user asked for Phase 4 even though Phase 0–1 work is still open. The roadmap's rule against starting a later phase early is set aside by that request.

**Parallel work.** Codex is working in `.worktrees/codex-v1` on FS-06, 08, 43, 89, 109, 113, 115, 116, 117 and 133. None of those IDs were touched here, and for them the Codex tracker is the authoritative one.

**Deferred.** FS-10, 11 and 12 depend on the FS-08/109 billet and stock work that Codex is changing now, so they were not started.

## 2. Implementation table

| ID | What was missing | What was built | Status |
|---|---|---|---|
| FS-68 OTIF | No immutable first promise. No OTIF figure. | `order_line_first_promises` records each line's first promised date once and cannot be changed. Every later move of the order date or the line date is added to `order_promise_changes`, with the reason and who changed it. A missing cause can be filled in once, with the cause and who agreed. Delay causes are stored per line. The owner sets an in-full tolerance, which starts at 0% and is audited. OTIF is reported by customer, salesperson, profile and cause. Screen: `/insights/otif`. | IMPLEMENTED |
| FS-73 13-week cash | AP-076 covered only 4 weeks, ignored customer payment promises and had no minimum balance. | Now covers 13 weeks. An open collection promise sets the date of the promised part of an invoice, and payments made since the promise reduce it. Weeks below a minimum balance are flagged, along with the first such week. Salaries, power, loan instalments and tax dates are entered as fixed expenses or one-offs. | IMPLEMENTED |
| FS-72 Metal exposure | Nothing tracked it. | Shows fixed-price metal still to be produced, minus back-to-back bookings, against billet stock, cast billets, the scrap pool and open billet purchase orders. Shows the net long or short position and what a price step would cost. Bookings are capped at the metal each order still needs. Orders can be marked price-linked. The owner sets a limit, and a morning check raises or clears the alert. It shows the position only; it does not trade or give hedging advice. | IMPLEMENTED |
| FS-71 Order book and forecast | Not available. | Weighted pipeline: open quotes × win rate, measured from at least 10 decided quotes or set by a named person with a reason. Order book in tonnes by alloy and finish, and weeks of load per press. Top-five customer share. Customers ordering less than before. Seasonal projection. The method is printed beside each number. | IMPLEMENTED |
| FS-27 MRP | AP-062 covered billet for 7 days only. | Billet needed by alloy, diameter and week over 8 weeks. Firm demand comes from live jobs; uncertain demand comes from order lines not yet on a job. A cast-or-buy suggestion lists the jobs and orders behind it. Lines that cannot be calculated are listed instead of guessed. Consumables at or below their reorder point and dies due for replacement are included. The owner approves the week's plan (an outdated plan is refused). Purchase or foundry then records the PO or cast number against each line, once. | IMPLEMENTED |
| FS-16 Die life | AP-028 had only service counters. | Rated life comes from the die's own record, or the median of at least 3 retired dies of the same type. Shows the 8-week usage rate, open order demand and the maker's lead time. Warns when a replacement is needed, with one morning warning per die that clears itself. Die makers ranked by kg per ₹1,000 of die cost. Amortisation recovered through invoices. Open corrections and how long they have been open. | PARTIAL |
| FS-38 Owner cockpit | AP-080 digest text only. | Mobile cockpit: yesterday's figures come from the stored digest, plus a live view (order book, billet days, OTIF, metal position, cash low point), the exceptions, weekly and monthly trends, and a WhatsApp-ready brief to copy or open. | PARTIAL |
| FS-36 Live screens | No Realtime anywhere. | Realtime is switched on for the 9 tables behind these screens. A live badge appears on the press floor, order board, dispatch queue, approval inbox and notifications. A `/production/wall` TV board shows kg per hour against the shift target, the next die and any stoppage in red. A presence note shows who else has a development record open. | PARTIAL |
| FS-54 Development pipeline | Pieces existed (die trials, samples) but nothing joined them. | Stage board, a 10-per-page database view and a detail page. The server enforces each stage gate: a feasible verdict, die cost and who pays, the customer's approval of the die cost, a linked die, at least one trial, a sample reference, and the approval plus a profile before release. Stage history is append-only and the next owner is notified. | PARTIAL |
| FS-26 Scheduler | Draft plan, capacity view and die windows already existed. | Promise-date calculator: earliest dispatch from free press capacity, die return dates, finishing lead time and packing, with any blocking constraint named. Breakdown re-flow: orders put at risk when a press breaks down. | PARTIAL |

## 3. Detailed changes

**Migrations**
- `20261118100000_fs_phase4_promises_otif.sql` (FS-68)
- `20261118110000_fs_phase4_finance_outlook.sql` (FS-73, FS-72, FS-71)
- `20261118120000_fs_phase4_planning_cockpit.sql` (FS-16, 27, 26, 54, 38, 36, the `fs_wall` board and the `intelligence.morning` job)

All three only add things.

**Where the logic lives.** All arithmetic is done in security-definer gateways in the database. Each gateway takes the company, user and role from the session (`private.ap_ctx`). New tables have row-level security turned on and no direct grants, so they can only be reached through the gateways.

**First promises and cut-over.** The first-promise tables use soft keys to the order and line, and a line's promise records are removed when the line itself is deleted. Without this, a captured promise would block the cut-over reversal of opening orders.

**Application side**
- `lib/intelligence/commands.ts`: the schemas and role lists.
- `lib/actions/intelligence.ts`: the allow-listed server action.
- `components/modules/intelligence/*`: the screens.
- `lib/realtime/live.ts`: the Realtime hook. A change only triggers a re-read through the normal server path.
- `lib/intelligence/options.ts`: choice lists, read with row-level security.
- `lib/auth/route-permissions.ts`: role rules for the new routes.
- `lib/jobs/registry.ts`: registers the `intelligence.morning` job.

**Pages:** `/insights/{otif,order-book,metal-exposure,cockpit}`, `/production/{material-plan,promise,wall}`, `/dies/life` and `/profiles/development{,/[id],/database}`. Links were added to the Insights page ("Plan and predict"), the press floor and the dies overview.

## 4. Quality report

| Check | Result |
|---|---|
| `npm run lint` | Passed, 0 errors |
| `npm run typecheck` | Passed |
| `npm run build` | Passed; all 11 new routes compiled |
| `tests/fs-phase4-sql.test.mjs` (PGlite, full migration replay) | 11/11. Expected values are worked out by hand; also checks refusals by role and by other company, append-only history, outdated plans and one-alert-per-condition |
| `tests/fs-phase4.test.mjs` | 5/5: formatting, schemas, routes, job registry, gateway and RLS checks |
| `tests/fs-phase4-browser.test.mjs` (Chromium, 375 and 1280 px, real actions against SQL) | 12/12. Screenshots in `docs/evidence/FS_PHASE_4/` |
| Full `npm test` | 3,729/3,731. The 2 failures were count checks pinned by earlier batches (job count, allowed migration dates). They were updated the same way earlier batches did, and both files now pass 22/22. The whole suite was not run again after that. |
| Native PostgreSQL replay, hosted JWT/Realtime, staging end-to-end | Not available. Staging is not set up and nothing was applied to hosted. |

The full test run regenerated evidence screenshots for earlier batches under `docs/evidence/`. Many of those files were already modified before this run, so they were left as they are.

## 5. Remaining risks and decisions

- **FS-27 recovery figure.** `production_jobs.extrusion_efficiency_percent` is a NOT NULL column with a default that already existed. A job that never had a real recovery recorded uses that default in the billet calculation. Before relying on MRP figures, check that jobs carry their measured recovery.
- **Omalco decisions still needed:**
  - Dispatch weighing tolerance (#1) for "in full".
  - The metal price reference (#5).
  - WhatsApp provider and budget (#10, FS-48) for sending the morning brief automatically.
- **FS-36.** Realtime delivery against hosted Supabase has not been checked. Presence on order and dispatch detail pages was postponed because those files contain the uncommitted batch 10 work.
- **Before release.** The batch 10 migration and these three migrations need to be applied in timestamp order. The root and Codex trackers and branches need reconciling before any merge, because Codex's FS migrations (`20261117090000`–`113000`) are not in the root checkout.

## 6. Next Phase 4 batch (recommended)

1. **FS-12 costing spine.** Builds on NOV-035 job profit snapshots. Start once FS-08's stock authority from Codex lands.
2. **FS-10 genealogy and FS-11 recall.** Depend on FS-08/109; FS-11 also needs the recall policy decision (#3).
3. **Finish the partials:**
   - FS-16: correction-loop screen and die-rack QR labels.
   - FS-54: carry die cost and amortisation into quoting and invoicing.
   - FS-26: drag-and-drop finite board.
   - FS-36: presence on order and dispatch pages once batch 10 is committed.
   - FS-38: scheduled delivery once FS-48 is approved.
4. **FS-123** (energy into job costing) and **FS-124** (breakdowns into downtime). Both feed FS-12.

## 7. Progress summary (all 139 IDs, root tracker)

IMPLEMENTED 13 · VERIFIED_EXISTING 0 · PARTIAL 17 · BLOCKED 3 · SUPERSEDED 1 · NOT_STARTED 105.

This tracker was copied from Codex's batch 2 close-out. Codex's batch 3 results for its 10 IDs will change these counts when the two trackers are reconciled.

## Completion pass (17 November 2026)

The five partials were taken further. Four are now IMPLEMENTED (locally verified; staging/hosted acceptance pending as for every item). FS-38 remains PARTIAL only for WhatsApp.

All changes are in one additive migration, `20261118130000_fs_phase4_completion.sql`.

| ID | Added | Status |
|---|---|---|
| FS-16 | A correction loop with server-enforced order: a defect report with a photo, then the corrector's action and cost, then a linked trial result from the die's trial register, then approve or send back. A failed trial cannot be approved, the steps are append-only, and the defect alert closes on approval. A per-die history shows recovery and kg/h per run, corrections, nitriding and trials. Printable die-rack QR labels (`/dies/life/labels`) use the existing scanner's die code. | IMPLEMENTED |
| FS-54 | Structured die charging terms, required before release when the customer pays. On release, the linked die record receives the agreed cost, ownership and customer. Choosing that die on a quotation fills an empty die charge and amortisation. From there the existing invoice die-charge line bills it once. | IMPLEMENTED |
| FS-26 | The AP-061 auto-arrange now leaves out broken-down presses and holds jobs whose die is away. Breakdown re-flow takes a preview, then a fingerprinted apply: the stopped press's unreleased slots go back to planning and new drafts are prepared for the planner to publish. Dies out of service or away with scheduled work are listed with each order's promise and an at-risk flag. The existing EOS drag-and-drop timeline remains the board. | IMPLEMENTED |
| FS-36 | Presence and live refresh on order and dispatch detail pages. | IMPLEMENTED |
| FS-38 | The morning brief is posted in-app to owners once, and queued and emailed per owner through the configured provider by the morning cron route, with 3 attempts and an outcome shown on the cockpit. `vercel.json` gains a daily 02:40 UTC call to `/api/cron/morning`, after the 02:30 pg_cron run. Mondays and the 1st add weekly and monthly totals. | PARTIAL: WhatsApp needs FS-48 and budget decision #10 |

**Kept as is:**
- Dragging a job onto an away die by hand still warns, as AP-065 intends, rather than blocking.
- Ageing ovens and finishing are deferred by the roadmap itself.

**Fixed during verification:** the quotation form first imported the Phase 4 server action. That broke the bundles of eight other browser-test harnesses, which don't stub that module. The die-terms lookup now uses the form's existing browser Supabase client; the gateway still takes company and role from the session. All 73 tests in those eight files pass.

**Checks:**

| Check | Result |
|---|---|
| Lint | Pass |
| Typecheck | Pass |
| Build | Pass (`/dies/life/labels` compiled) |
| Phase 4 SQL tests | 16/16 |
| Phase 4 unit tests | 6/6 |
| Phase 4 browser tests | 16/16 |
| Full suite | 3,751/3,753. The 2 failures were 5-second UI timeouts in `autopilot-batch7-browser` (AP-086 shared inputs; AP-064 delay notice) under full-suite load. That file passes 10/10 on its own. |

**Progress across all 139 IDs:** IMPLEMENTED 17 · VERIFIED_EXISTING 0 · PARTIAL 13 · BLOCKED 3 · SUPERSEDED 1 · NOT_STARTED 105.

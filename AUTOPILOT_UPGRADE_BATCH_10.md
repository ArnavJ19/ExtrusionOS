# Autopilot Upgrade Batch 10

Date: 17 November 2026 (Asia/Kolkata)
Catalogue: [AUTOPILOT_UPGRADES.md](AUTOPILOT_UPGRADES.md)
Prompt: [AUTOPILOT_BUILD_PROMPT.md](AUTOPILOT_BUILD_PROMPT.md), Features = NEXT (the Delivery plan's "5 onward" row: remaining entries by delivery rank)
Base: `feat/autopilot-batch-9` at 71a17b1; branch `feat/autopilot-batch-10`
Delivery state: the last ten catalogue entries (ranks 91–100) implemented and verified locally against the full replayed migration chain. With this batch all 100 AP entries have a delivered slice. The migration is **not** applied to the hosted database. Employee acceptance is a separate gate.

## Selection

The ten undelivered entries after batches 1–9 (ranks 91–100). Checked against every `AUTOPILOT_UPGRADE_BATCH_*.md`: none had been delivered, so no entry was replaced. These are the only ten left.

| Rank | ID | Feature | Foundation found | Gap closed in this slice | Where the work happens |
| --- | --- | --- | --- | --- | --- |
| 91 | AP-055 | Batch powder coating by shade | Finishing jobs and their recorded shade, the order's promised date, finishing capacity | Waiting powder-coating material is grouped by shade and powder brand (brand set per finishing job); groups run in order of their earliest promise. The plan shows colour changes against plain due-date order and every promise the batching would miss **before** confirming; confirming with a late job needs a reason. The supervisor may reorder runs; the confirmed order is kept per day (one confirmed run order per day) | `/production/finishing/coating-runs`, link from finishing |
| 92 | AP-067 | Combine cut lengths across orders of one profile | Cutting workspace, AP-029 press settings (billet, butt, crops, run-out table), approved scrap standard | One-dimensional optimiser (`lib/calculations/cut-combination.ts`): usable length per push from billet metal, crops and the run-out table, one saw kerf per cut; separate plans vs one combined pattern where a push carries cuts of several jobs. Each job gets **exactly** its pieces (rechecked in the database); every cut names its job. Saving needs fewer pushes than planning separately; accepting rechecks a fingerprint of the jobs and press settings and refuses a stale pattern. Jobs already pressing cannot be combined | `/production/cutting/combine`, job record ("Combined cut pattern") |
| 93 | AP-088 | Arithmetic inside numeric fields | Shared numeric input (`components/ui/numeric-field.tsx`) | Recursive-descent parser (`lib/forms/arithmetic.ts`) for numbers, `+ - * /` and brackets. `=12*6.4` or `250+180` becomes the result on blur; the expression stays as a hint under the field only; a broken expression or division by zero is reported and the value is not changed. No `eval`, no `Function` | Every screen using the shared numeric field (order entry, production, operator tools, configurator…) |
| 94 | AP-022 | Derive crew from workstation sign-ins | Press workstation, competencies | Station sign-in and sign-out per press from the workstation; a supervisor can add crew; one open sign-in per person; a forgotten sign-in counts for at most 14 hours. Crew per shift and per job (from push events in the sign-in window) and output per crew are read models. A person without the competency the plant requires to start production is flagged, not blocked. Labelled "press assignment — not attendance or payroll" | Press workstation ("Crew on this press"), `/production/crew`, job record |
| 95 | AP-023 | Dictate exception reasons on the phone | Structured exception capture, NCR/complaint form, operator tools | Shared `DictationTextarea` (`components/ui/voice-input.tsx`): microphone shown only when the browser has speech recognition; Hindi or English (remembered on the device); text is appended and capped at the field's length; the reason code stays required. The app never records or uploads audio; the field says "Your browser's speech service may process the audio. Only the text is saved here." | Complaint/NCR description, operator exception reasons |
| 96 | AP-093 | Undo reversible actions for a few seconds | NOV-098 action results, task board, saved views (AP-091), notifications | Registry (`lib/undo/registry.ts`) of four low-risk kinds: task status move, saved-view delete, saved-view default, notification read. A ten-second Undo toast runs the inverse through that action's own path; use is recorded (`/api/undo` → `ap_undo`). The one missing inverse (mark my own notification unread, within two minutes) is added. Kinds containing stock, invoice, payment, credit, dispatch, quality, release, numbering and similar words are refused by the registry and the database | Task board, saved views, notifications |
| 97 | AP-021 | Allocate energy from shift meter readings | Energy page (EOS-99), AP-011 push events, shift pattern | Opening and closing kWh per press per shift (the next shift is offered the previous closing reading; a closing below opening is refused). A shift's kWh is shared among the jobs that pressed in it by runtime (push-to-next-push, capped at 20 minutes so a stoppage is not charged; the last push gets the shift's mean gap). kWh/kg per job, per die and per press per month from actual readings only. A missing closing reading, or no pushes, leaves energy blank, never zero | `/energy/press-meters`, link from Energy, job record |
| 98 | AP-049 | Suggest equivalent profiles available in stock | Profile master, reservation ledger (free released stock) | Equivalence pairs (same section/different code, or customer-approved alternative for one customer only). Proposed by sales, approved by technical roles — not by the proposer (owner excepted). Order lines still short after reserved stock and committed production show approved equivalents with free stock. Consent (who, how, when) must be recorded on the line before substitution; it can be withdrawn. Nothing reserves or swaps automatically | Order record ("Equivalent profiles"), `/orders/equivalents` (pairs and shortages), profile record |
| 99 | AP-068 | Suggest make-to-stock runs for idle capacity | Capacity read model, order history, billet stock | Stock targets per profile/finish/length with a holding limit. Free capacity this week and next (kg and hours). Fast movers by 90-day ordered kg below target are suggested fastest first, within free capacity, the billets in stock of the profile's alloy (at the recovery target, else 80%) and the holding limit; each suggestion shows its basis. Approval creates a planning task for the planner (no job is created automatically); nightly job `stock.make_to_stock` refreshes suggestions | `/production/capacity/stock-runs`, link from capacity |
| 100 | AP-070 | Convert configurator projects to orders with a stock check | Systems configurator cutting list, hardware BOM, direct order entry | **Off by default** — the catalogue says to confirm Omalco sells systems before building, so the owner/admin turns it on with a note. Cuts per profile are packed into whole stock lengths (`lib/systems-configurator/order-lines.ts`, first-fit longest first, one kerf per cut); each profile × stock length is one order line with free stock shown. The normal order form opens prefilled (rates entered by sales, HSN/GST checked); on save the order is linked once to the project. Hardware and materials go to the order note; unlinked or oversize cuts are listed, not ordered | Configurator project ("Open as order"), `/orders/new?configuration=`, settings on the configurator page |

## Per-feature recheck, tests and audit

| ID | Recheck against System does / Build / Guardrails | Tests | Audit finding and fix |
| --- | --- | --- | --- |
| AP-055 | Met. Breaches shown before confirmation | 1 SQL + 3 unit + 2 browser | Checked: missing capacity, weight or shade stays blank (a job without a shade gets a run of its own), never zero |
| AP-067 | Met. Quantities and lengths never changed; allocation traceable per cut | 2 SQL + 3 unit + 2 browser | Checked: accepting rechecks a fingerprint of the jobs and press settings, so a stale pattern is refused; the database recounts each job's pieces |
| AP-088 | Met. Parser accepts only numbers, operators and brackets | 3 unit + 2 browser | Checked: no `eval` or `Function` anywhere in the path |
| AP-022 | Met. Labelled press assignment | 2 SQL + 2 browser | Checked: one open sign-in per person (unique index); a forgotten sign-in counts for at most 14 hours |
| AP-023 | Met. Mic hidden when unsupported; privacy notice shown | 1 unit + 2 browser | **Fixed:** the component wrote a ref during render (lint `react-hooks/refs`); the latest text is now kept in an effect |
| AP-093 | Met. No posting action is registered (test-enforced word list) | 1 SQL + 1 unit + 2 browser | Checked: the database accepts only the four kinds; notification unread is limited to the reader and two minutes |
| AP-021 | Met. Blank, not zero, when a reading is missing | 2 SQL + 2 browser | Checked: push gaps are capped at 20 minutes so a stoppage is not charged; a closing below opening is refused |
| AP-049 | Met. Approval by another person; consent before substitution | 2 SQL + 2 browser | Checked: a customer-specific alternative is offered only to that customer; one recorded consent per order line |
| AP-068 | Met. Billets and holding limit respected | 2 SQL + 2 browser | Checked: one live suggestion per target and week (unique index); none without demand or capacity |
| AP-070 | Met behind the owner's switch | 1 SQL + 1 unit + 2 browser | **Fixed:** one order could be linked to two projects by two people at once (the project side was unique, the order side was not); `system_order_links.order_id` is now unique. Also fixed an unescaped apostrophe (lint) |

## "Done when" recheck

| ID | Done when | Met? | Exactly what is missing |
| --- | --- | --- | --- |
| AP-055 | Shade changes per shift fall without late orders | Colour changes against due-date order are counted on each plan; late jobs are shown and need a reason | An operating result: compare colour changes per shift before and after on the coating line |
| AP-067 | Combined jobs show higher planned recovery than separate ones | Yes: separate and combined pushes and recovery are shown side by side; a pattern that saves no push is refused | Planned recovery only; actual recovery comes from AP-011 pushes after the run |
| AP-088 | No eval of arbitrary code; expression kept as a hint only | Yes (unit-tested against code, letters and division by zero) | — |
| AP-022 | Output per crew per shift is available without a separate register | Yes, from sign-ins and pushes | Requires operators to sign in at the station; a badge-scan sign-in is not built (no badge format is defined at Omalco) |
| AP-023 | Average description length on mobile exceptions increases without longer completion time | Dictation built on the complaint and exception-reason fields | An operating result; speech recognition depends on the phone's browser (Chrome on Android supports it; some browsers do not, and the field is then a normal textarea) |
| AP-093 | No posting action offers undo; those use corrections | Yes (registry and database refuse posting kinds) | — |
| AP-021 | Monthly kWh/kg per press is reported from actual readings | Yes (`monthly` view) | Readings are typed; meter device input is a later step (the entry mentions AP-010-style input) |
| AP-049 | Shortages show available approved equivalents | Yes on the order record and the shortages list | Technical must approve the first pairs |
| AP-068 | Idle hours are reported with suggestions | Yes | Planning must set stock targets and holding limits; with no targets nothing is suggested (by design) |
| AP-070 | A configured project becomes an order without retyping | Yes once turned on: lines, quantities and customer are filled; sales enters rates | **Business decision open:** whether Omalco sells window and door systems. Until the owner turns it on, the button says why it is off |

## Scope boundaries

- Nothing automatic posts stock, money or quality approval, or sends a customer message. Meter readings and sign-ins are records; energy allocation and crew output are read models; equivalents, make-to-stock runs, coating runs and combined cut patterns are proposals a person confirms; a configurator project becomes an order only through the normal order entry.
- AP-055 confirms the run order; it does not move finishing job statuses. Powder brand is recorded per finishing job in `finishing_job_powder` (the finishing table has no brand column).
- AP-067 does not change production jobs; the accepted pattern is shown on each job for the cutting team. Splitting output back to orders follows the pattern's per-cut job tags.
- AP-068 approval creates a planning task, not a production job.
- AP-070 order lines carry profiles only; hardware and accessories are listed in the order note because the order line table is profile-based. The project is marked `converted_to_order` where its own lifecycle rules allow; the link is kept either way and says so.
- AP-093 covers four kinds. Anything else (stock, money, quality, numbering, customer messages) uses its correction workflow.
- AP-023 depends on the browser's speech recognition; the app does not upload audio.
- Assumptions: shift window = the press's configured shift hours, else the whole IST day; fallback recovery 80% where a profile has no target; the next shift is offered the previous closing reading.

## Data and security audit

Migration `supabase/migrations/20261117100000_autopilot_batch_10.sql` (additive, one file). New tables (13): `press_meter_readings`, `press_crew_sessions`, `profile_equivalents`, `profile_substitution_consents`, `stock_targets`, `stock_run_suggestions`, `coating_line_settings`, `finishing_job_powder`, `coating_runs`, `cut_combinations`, `systems_order_settings`, `system_order_links`, `undo_events`. Each has `company_id`, RLS, a role-scoped read policy (undo events: the person's own rows) and a company-leading index; no client grants (gateway-only). Eight gateways (`ap_energy`, `ap_crew`, `ap_equivalents`, `ap_stock_runs`, `ap_coating`, `ap_cut_combine`, `ap_systems_order`, `ap_undo`) are `security definer` with a pinned `search_path`, take company and actor from the session (`private.ap_ctx`), refuse dealers, anonymous and inactive users, and check roles per command. Private helpers have all execute revoked. The AP-001 job registry and executor are wrapped (rename and wrap, as earlier batches did) to add `stock.make_to_stock` (nightly). No existing table or column is altered or dropped. The only write to an existing table is `system_configurations.order_id`/`status` when a project is linked, and `notifications.is_read` for the person's own notification within two minutes.

Small fixes to earlier screens were in the batch working tree and are committed with it: the press plan shows the billet state and draft status as words; the job card PDF reads the billet length choice and draft-line due date through their gateways (`ap_billet_length`, `ap_jobdrafts`) instead of direct table reads the role could not see; the numbering proposal links to `/invoices/numbering`.

Customer-facing output: none added. Equivalence and consent records are internal; the AP-070 prefill shows stock, not cost or margin.

Server-side validation: Zod schemas in `lib/autopilot-batch10/commands.ts`, `lib/actions/autopilot-batch10.ts` and `app/api/undo/route.ts`; the database re-checks every command. Shared screens that offer Undo or dictation import no server module (unit-tested). No new dependency.

## Verification

| Check | Result |
| --- | --- |
| Migration chain replay (PGlite) | All files, 0 failures (the batch fixtures replay the chain) |
| tests/autopilot-batch10-sql.test.mjs | 15/15 (AP-021 ×2, 022 ×2, 049 ×2, 068 ×2, 055, 067 ×2, 070, 093, RLS/grants/refusals) |
| tests/autopilot-batch10.test.mjs | 13/13 units (arithmetic ×3, cut combination ×3, coating batches ×3, configurator lines, undo registry, dictation, schemas, wiring) |
| tests/autopilot-batch10-browser.test.mjs | 20/20 at 375 and 1280 px; screenshots in `docs/evidence/AUTOPILOT_BATCH_10` |
| npm run typecheck | Passed |
| npm run lint | Passed, 0 errors, 0 warnings (after fixing 2 errors and 1 warning found in this pass) |
| npm run build | Passed; new routes compiled (`/energy/press-meters`, `/production/crew`, `/production/finishing/coating-runs`, `/production/cutting/combine`, `/production/capacity/stock-runs`, `/orders/equivalents`, `/api/undo`) |
| Full npm test | See "Full suite" |
| In-app browser | Preview `autopilot-batch10-screens` (real screens and gateways on replayed local SQL, synthetic records): coating runs at desktop (runs grouped by shade, colour changes 2 against 4 in promised-date order, 0 late); meter readings, configurator order form, combined cuts, undo and order equivalents at 375 px with no horizontal scroll and no console errors |

### Full suite

| Run | Result |
| --- | --- |
| Full run (25 min) | 3,703 tests across 76 suites: 3,694 passed, **9 failed** |
| Cause | `autopilot-batch1-sql` ×3: the nightly job count (26 → 28) and the client-callable gateway list (eight new gateways) are invariants each batch updates. `operator-workflows-browser` ×1: its `sonner` stub had only `toast.error`; the notification screen now offers Undo through `toast.success`, so the stub gains `success`. Five browser tests (`autopilot-batch2/4/7-browser`, `nov-batch9-browser`, `nov-upgrades-browser`): four could not write a screenshot (OneDrive file lock, as in earlier batches) and one timed out under full-suite load |
| Re-run of every affected file | `autopilot-batch1-sql`, `autopilot-batch5-sql`, `nov-batch9` (37/37); `operator-workflows-browser`, `autopilot-batch2-browser`, `autopilot-batch4-browser`, `nov-upgrades-browser` (70/71, the 71st being `nov-batch9-browser`'s screenshot lock), then `nov-batch9-browser` alone (7/7); `autopilot-batch7-browser` with `operator-workflows-browser` before the stub fix (21/22, the shared-inputs test passing; the one failure was the stub) |
| After the fixes | `npm run lint` 0 problems, `npm run typecheck` passed; all three batch 10 files re-run after the last migration change: 48/48 |

### Changes to earlier tests

Registry and grant invariants were updated for batch 10, as earlier batches did: `autopilot-batch1-sql` (client-callable gateway list gains the eight gateways; nightly runs per company 13 → 14), `autopilot-batch5-sql` (30 registered jobs), `nov-batch9` (the migration-order allow-list gains the batch 10 date), `scripts/lib/operator-browser-fixture.mjs` (`sonner` stub gains `toast.success`).

## File inventory

| Area | Created | Modified |
| --- | --- | --- |
| Database | `supabase/migrations/20261117100000_autopilot_batch_10.sql` | None |
| Library | `lib/autopilot-batch10/commands.ts`, `lib/actions/autopilot-batch10.ts`, `lib/forms/{arithmetic,voice-input}.ts`, `lib/calculations/cut-combination.ts`, `lib/workflow/coating-batches.ts`, `lib/systems-configurator/order-lines.ts`, `lib/undo/registry.ts` | `lib/actions/autopilot.ts`, `lib/auth/route-permissions.ts`, `lib/jobs/registry.ts`, `lib/pdf/loaders.ts`, `lib/proposals/proposals.ts` |
| Screens | `components/modules/autopilot-batch10/{energy,crew,equivalents,stock-runs,coating,cut-combine,systems-order}.tsx`, `components/ui/{voice-input.tsx,undo-toast.ts}`; pages `energy/press-meters`, `production/crew`, `production/finishing/coating-runs`, `production/cutting/combine`, `production/capacity/stock-runs`, `orders/equivalents`; route `api/undo` | Shared numeric field, workstation, operator tools, NCR form, press plan, batch 6 shared, saved views, notifications, task board, module workflow links, direct order form; pages: energy, order record, new order, job record, profile record, configurator and project |
| Verification | `tests/autopilot-batch10{,-sql,-browser}.test.mjs`, `scripts/lib/autopilot-batch10{,-browser}-fixture.mjs`, `scripts/autopilot-batch10-preview.mjs`, screenshots `docs/evidence/AUTOPILOT_BATCH_10` | `tests/{autopilot-batch1-sql,autopilot-batch5-sql,nov-batch9}.test.mjs`, `scripts/lib/operator-browser-fixture.mjs`; `.claude/launch.json` (preview entry, untracked folder) |

## Hosted migration state

Not applied. Apply `supabase/migrations/20261117100000_autopilot_batch_10.sql` to `AlExMS` only when authorised; batches 6, 7, 8 and 9 are also still unapplied and must go first, in order. After applying, pg_cron's existing nightly window picks up `stock.make_to_stock`.

## Remaining acceptance

Production records opening and closing meter readings on every press for a month and accounts reviews kWh/kg per press. Operators sign in at the press station for two weeks; supervisors check crew output. Quality/production approve the first equivalent-profile pairs; sales records a substitution consent once. Planning sets stock targets and holding limits for the fast movers. The coating supervisor confirms run orders for two weeks and compares colour changes per shift. The cutting team tries a combined pattern on one die with two orders. Operators try dictation on their phones in Hindi. Staff try Undo on the task board and saved views. **Decide whether Omalco sells window and door systems** (AP-070 stays off until the owner turns it on).

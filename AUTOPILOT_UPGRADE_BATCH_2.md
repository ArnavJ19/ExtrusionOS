# Autopilot Upgrade Batch 2

Date: 10 November 2026 (Asia/Kolkata)
Catalogue: [AUTOPILOT_UPGRADES.md](AUTOPILOT_UPGRADES.md)
Prompt: [AUTOPILOT_BUILD_PROMPT.md](AUTOPILOT_BUILD_PROMPT.md) (batch 2, features NEXT; the prompt's `[N]`/`[NEXT]` were left unfilled, so batch 2 and the Delivery plan's next row were taken)
Base: `feat/autopilot-batch-1` at c96639f with the user's uncommitted single-tenant and dashboard changes left in place; branch `feat/autopilot-batch-2`
Delivery state: ten slices implemented and verified locally against the full replayed migration chain.
Employee acceptance and the hosted migration remain separate gates (see the end of this record).

## Selection

Batch 2 of the catalogue's Delivery plan ("Press floor capture"): AP-011, 012, 013, 014, 015, 016, 066, 087, 028, 054.
Batch 1 delivered none of them, so no entry was replaced. Everything starts from one tap per billet at the press
workstation. Work lives in its module: the workstation and job record (production), a supervisor screen at
`/production/floor`, scrap standards at `/production/scrap-standards`, the die record and dies overview, the
maintenance module, and `/quality/samples`. No `/tasks/*` hub was created.

| ID | Feature | Foundation found | Gap closed in this slice | Edge evidence |
| --- | --- | --- | --- | --- |
| AP-011 | One tap per billet | Workstation sessions (10-minute lease, queue only), linked foundry billets, completion mass balance | Append-only `production_push_events` (void events, never updates); billet taken from the job's linked lot in billet order with its measured weight, else an estimate from the standard billet length labelled "estimated", else blank; 30-second undo by the same operator; supervisor void and backfill with reason; station lease renewed by taps (max 12 h); offline tap queue on the station replayed by id; median cycle time and runtime on the job; cycle-time chart on the die | Double tap within 5 s ignored, replayed id, other operator's session, wrong press, planned job, foreign job, expired session, undo after 30 s, update/delete refused, voided push frees its billet, offline tap sent once |
| AP-012 | Expected output from pushes and the cut plan | Completion transaction with scrap lines and billet mass balance; job cut length, kg/m, pieces per bundle | `ap2_job_expected` (SQL, mirrored in `lib/calculations/press-output.ts` with a parity test): expected good pieces, kg, metres, bundle split and recovery from every push; `production.expected_output` proposal on the AP-002 card; operator enters only reject pieces (keypad) and a reason chip, then confirms; acceptance calls the existing completion RPC | Missing kg/m, cut length, diameter or standard stays blank; unpushed linked billets and pushes without billets block; stale after any push, billet or scrap change; rejects without reason; rejects above expected; wrong role; repeated accept |
| AP-013 | Engineering scrap | Scrap categories (butt, front/back, saw, rejects) entered by hand | Owner-approved, versioned `scrap_standards` (die beats press beats company); butt from billet cross-section × butt length × density, crops and kerf from kg/m, cut-off as the exact remainder; lines typed `engineering`/`process` and `derived`/`entered`; `production_scrap_derivations` per job; monthly reconciliation against `scrap_yard_weighings` | Non-owner approval refused, both scopes refused, new approval retires the old version, die-specific standard wins |
| AP-014 | Idle press asks why | Production exceptions (typed by hand) | Workstation shows a reason picker once the gap since the last push exceeds the press threshold; interval starts at the last push and ends at the next; nightly `press.idle_reconcile` records unanswered gaps as unexplained (a coinciding die change only *suggests* a reason); daily downtime report with explained % and supervisor answering | "Other" without note, not idle yet, reconciliation never sets a reason, operator cannot answer old gaps, supervisor can |
| AP-015 | Die changes from the job sequence | Die history (NOV-025) | `press_die_changes` derived on the first push of a job whose die differs from the press's previous push (last push of old die → first push of new); append-only notes and supervisor duration corrections; weekly count and average per press | Same die → no event, production can note but not correct, corrected duration used in the average |
| AP-016 | Sampling from output | Approved inspection plans and items; QC release on `quality_inspections` | `inspection_sampling_triggers` (first after die change, every N pushes, every N bundles from expected pieces, last piece) with characteristic subset and "blocks release"; samples created on pushes and at completion, with a quality notification and My Work queue; windows by pushes or time; `quality.sample_windows` job marks missed; readings evaluated against plan limits; failed sample alerts production; QC release refused while a blocking sample is open or missed; waive with reason; compliance per job | Missing N, unauthorised trigger edit, missing characteristic, measured value required where limits exist, production cannot record, late recording flagged, release refused then allowed |
| AP-028 | Die nitriding/correction due | NOV-025 die service thresholds (kg, runs, days since service) | New basis `pushes_since_service`; counters from push events (plus legacy completed runs); "due in ~N pushes" on the die record, the dies overview flag list and under the die selector on the job form; hourly `dies.predict_service` proposal; accepting books `die_service_bookings`; closing a booking as done writes the nitriding/correction history and resets the counters | Booked dies not re-proposed, production cannot book, counters reset after service |
| AP-054 | PM from running hours | Calendar-based maintenance schedules, capacity blocks (NOV-026) | `pm_plans` per press asset (press, puller, saw, container, heater, stretcher) on running hours (push gaps within the idle threshold) or pushes; hourly `maintenance.propose_pm` at 90 % proposes the next planned window or the next working day's first shift; accepting creates the capacity block and a work order; completion restarts the counter; compliance per asset | 75 % not proposed, safety-critical reject refused for non-supervisors, block created on accept, compliance 100 % after on-time completion |
| AP-066 | Shift targets | Published plan slots, maintenance blocks, factory calendar shifts | Target kg and pushes per press per shift from scheduled/released slots prorated to the shift, net of planned maintenance and a die-change allowance between differently-died slots (measured average after three changes, else the press setting); live pushes, billet kg and estimated output; shown on the workstation and per press on `/production/floor` | Exact proration with maintenance and allowance, unknown billet weight leaves the push target blank |
| AP-087 | Large numeric keypad | Generic forms already set `inputmode` on number fields | Shared `NumericField`: `inputmode` decimal/numeric everywhere; in workstation mode `inputmode="none"` plus an on-screen keypad with 64 px keys, delete, clear and done; used for rejects, standards, PM and sample readings | Keys ≥ 60 px measured, decimal disabled for whole numbers, one decimal point, blank stays blank |

## Per-feature recheck, verification, edge tests and audit

| ID | Recheck against the catalogue | Tests | Audit finding and fix |
| --- | --- | --- | --- |
| AP-011 | System does / Build / Guardrails met. The tap queue is station-local (AP-094 offline queue for all phone entries is a later entry) | 2 SQL + unit + 2 browser | Station view read an unassigned record when the press was not idle (crashed the station); fixed and covered by the shift test. Undo countdown could show 31 s from clock skew; clamped |
| AP-012 | Met; proposal labelled "expected"; only the completion RPC posts stock | 2 SQL + parity + unit + 4 browser | Proposal cards inside a record did not refresh the record after a decision; added `onDecided` |
| AP-013 | Met; reconciliation compares against a monthly weighing entered by the scrap yard (no weighbridge feed) | 1 SQL + parity + 2 browser | Retiring a proposed standard violated a check; constraints split |
| AP-014 | Met | 1 SQL + 2 browser | A table alias shadowed a PL/pgSQL record in the sample-window job (job failed); renamed and audited every batch function for the same pattern |
| AP-015 | Met | 1 SQL + 2 browser | None beyond planned |
| AP-016 | Met; "every N bundles" counts bundles from expected pieces because press bundles are only recorded at packing | 2 SQL + 2 browser | None beyond planned |
| AP-028 | Met | 1 SQL + 2 browser | Die hint on the job form pulled a server action into client bundles used by other screens; it now reads `ap_dies` through the form's browser client |
| AP-054 | Met | 1 SQL + 2 browser | None beyond planned |
| AP-066 | Met | 1 SQL + 2 browser | None beyond planned |
| AP-087 | Met in code; the gloved floor test is an employee check | unit + 1 browser | None beyond planned |

## "Done when" re-check (each entry re-read in full on 10 November)

| ID | Done when | Met? | What is missing, exactly |
| --- | --- | --- | --- |
| AP-011 | Shift billet totals need no manual entry; cycle-time chart per die | Yes | Taps queued offline older than 15 minutes are recorded at arrival time (cycle times stay honest). The lease now slides with taps; a station idle for 10 minutes still needs the operator to sign in again |
| AP-012 | A normal job closes with two entries or fewer (rejects, confirm) | Yes | Rejects are one number plus one reason chip, then Confirm. Jobs without linked billets also need the existing manager input exception, as before |
| AP-013 | Recovery % for every closed job without manual scrap entry | Yes for jobs closed from expected output | Jobs closed with the old manual form keep typed scrap (`scrap_basis = entered`). Recovery needs an approved standard; until the owner approves one, expected output stays blank |
| AP-014 | Daily downtime report covers ≥ 90 % of idle time with a reason | Report built (coverage shown against 90 %) | Coverage is an operating result to measure on the floor. Idle before the first push of a shift and on presses with no running job is not detected |
| AP-015 | Die change count and average per press per week without entry | Yes | A die change is only detected when both jobs have pushes |
| AP-016 | Sampling compliance per job reported automatically | Yes | Plan versions: triggers belong to a plan version and must be re-added when quality supersedes the plan |
| AP-028 | No die exceeds its interval without a visible flag | Yes, for dies whose family has an approved interval | Dies without an approved interval show "No approved service interval" rather than a flag |
| AP-054 | PM compliance reported per asset | Yes | Pullers and saws are counted from their press's pushes (they are not separate machines in the master) |
| AP-066 | Supervisors see plan vs actual per press during the shift | Yes | Output during the shift is estimated from pushes until the job is confirmed |
| AP-087 | Gloved operators enter numbers without mis-taps in a floor test | Not yet | Needs the floor test with gloves on the workstation hardware |

## Scope and operating boundaries

- Taps and jobs only record and propose. Stock posts only when a person accepts the expected output and the existing
  completion transaction (with its billet mass balance) succeeds. No quality approval, customer message or money posting.
- Push events are append-only (update/delete refused by trigger); corrections are void events, supervisor backfill is
  marked and excluded from cycle times. Die-change corrections and notes are appended.
- Idle reasons come only from a person. The reconciliation job records unexplained gaps and may suggest "die change".
- Safety-critical PM proposals can only be dismissed by owner, admin, factory manager or production manager.
- The workstation lease now extends on each tap (10 minutes, at most 12 hours from opening). This changes the old
  fixed 10-minute session; switching operator still signs out.

## Data and security audit

Migration `supabase/migrations/20261110100000_autopilot_batch_2.sql` (additive, ~2,150 lines). 14 new tables, each with
`company_id`, RLS, a company-scoped read policy, a company-leading index and **no client grants** (all reads and writes
through functions). Changes to existing objects: superset check lists on `proposals.proposal_type` and
`die_service_thresholds.basis`; two nullable columns on `production_scrap_lines` with a typing trigger; an AFTER trigger
on `production_jobs` (last-piece samples, stale proposals) and a BEFORE trigger on `quality_inspections` (sampling
release guard). Batch 1 functions `ap_job_registry`, `ap_job_execute`, `ap_proposal_versions`, `ap_proposal_editable`,
`ap_proposal_apply`, `ap_proposal_decide` and `ap_proposals` were replaced with the same signatures: the batch 1
bodies are kept verbatim as `private.ap1_*` and the public names dispatch batch 2 types first; `ap_proposal_decide`
gains only the safety-critical reject check and `ap_proposals.list` only `target`/`target_prefix` filters.
Clients can execute only `public.ap_press, ap_scrap, ap_dies, ap_pm, ap_sampling` (plus batch 1's nine). Company and
actor come from `auth.uid()`; dealers are refused; every security-definer function pins `search_path`. Station pushes
require the caller's own unexpired workstation session on the job's press. Messages shown to people start with `AP: `.
No customer-facing view changed; no cost, margin or supplier rate is shown.

## Verification

| Check | Result |
| --- | --- |
| Migration chain replay (PGlite) | Full chain plus this migration, 0 failures |
| tests/autopilot-batch2-sql.test.mjs | 14 passed (including the TS/SQL yield parity check and the RLS/grant audit) |
| tests/autopilot-batch2.test.mjs | 9 passed |
| tests/autopilot-batch2-browser.test.mjs | 17 passed at 375 px and 1280 px; screenshots in docs/evidence/AUTOPILOT_BATCH_2 |
| tests/autopilot-batch1-sql.test.mjs, autopilot-batch1-browser | 14 and 16 passed after updating two batch 1 assertions that pinned the job count and the callable-function list, and the order-dependent card test |
| npm run lint | 0 errors (3 earlier warnings in batch 8 tests) |
| npm run typecheck | Passed |
| npm run build | Passed; `/production/floor`, `/production/scrap-standards`, `/quality/samples`, `/quality/samples/[id]`, `/quality/samples/triggers` built |
| npm test | Full run: 3,323 tests, 3,293 passed, 30 failed. 28 were caused or exposed by this batch and fixed, then their files re-run (all passing): the die hint on the job form crashed screens whose test Supabase mock has no `rpc` and pulled a server action into client bundles (die readiness, collaboration, NOV-012 planning; now guarded and on the browser client); the workstation fixture had no stub for the new autopilot import; a batch 9 audit pinned which migrations may follow it; batch 1's proposal-card test opened whichever card sorted first, and cards from one run share a timestamp (now opens the invoice card). 2 remain in tests/nov-batch2-browser.test.mjs (NOV-002 workspace pins), caused by the uncommitted `components/layout/workspace-shortcuts.tsx` change that is not part of this batch (same as batch 1) |
| In-app browser (screens) | Fixture server with the real screens and server action on the replayed local database: press floor at desktop width and die service at 375 px, no console errors and no sideways scroll |
| In-app browser (real app) | `next dev`: `/login` 200; all five new routes redirect unsigned requests (307). Signed-in pages cannot be shown because the hosted database has no company or employee since the 9 November wipe |

## Hosted migration state

Not applied. Apply after `20261109000000_single_tenant_omalco.sql` and `20261109100000_autopilot_batch_1.sql`
(it depends on batch 1). The four new jobs run from the existing cron route (two hourly, one nightly).

## Remaining acceptance

Owner approves the first scrap standard per press from a measured trial; quality adds triggers to the approved
inspection plans; the die shop approves push-based nitriding intervals per die family; maintenance enters PM plans for
each press; one press runs a full week on taps with supervisors answering idle gaps (target ≥ 90 % explained); the
scrap yard records the month's weighing and compares it with derived scrap; gloved floor test of the keypad; measure
fields typed per closed job and expected-output acceptance before and after, as the catalogue's batch rules require.

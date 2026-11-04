# November Upgrade Batch 6

Date: 4 November 2026 (Asia/Kolkata)
Catalogue: [NOV_UPGRADES.md](NOV_UPGRADES.md)
Base: feat/nov-batch-4 (batches 4 and 5 committed as e7b3187 and 493af4b)
Delivery state: ten bounded slices implemented and locally verified against the full replayed migration
chain. Employee acceptance remains a separate gate. Hosted migration state is recorded below.

## Selection

The next ten entries by delivery rank (51 to 60). The seven C4/C5 entries are bounded pilots on existing
foundations under `/tasks/lifecycle`; the three C1/C2 entries change shared form and layout components.

| ID and idea | Foundation found | Gap closed in this slice | Edge evidence |
| --- | --- | --- | --- |
| NOV-058 order closure | Order stage history, short-closures, invoices, batch 5 exceptions/returns/changes | A readiness review per order (unrecorded kg, undispatched remainder, open jobs, vendor finishing, reservations, packed bundles, undelivered or unbilled dispatches, draft invoices, receivables, uninspected returns, batch 5 exceptions) with owner and source link per item; carrying of returns, exceptions and changes with a reason; operational closure (receivables stay in accounts) and final closure (zero balance); retained snapshot; a guard refusing new jobs, dispatches, reservations, finishing and packed bundles; reasoned reopening by owner/admin to the previous stage. | Each blocker type, short-closed remainder, final close with balance, wrong roles, carry of a non-carriable item, duplicate carry, new work after close, reopen restores stage and withdraws carries, stale source, quantity difference warning |
| NOV-063 samples and first piece | Production jobs, dies, batch 5 drawing revisions | Sample requirements bound to order line, profile, die and drawing revision; produced, measured, sent, lost and decision events with iterations; customer decisions name the customer person, internal decisions need quality or the factory manager; a guard so a gated line first starts only after approval, only on the sampled die, within any conditional kg; renewal when the drawing is superseded or after invalidation; overdue responses. | Gate before approval, sample job may run, wrong die, sent before measured, decision without contact, internal decision by sales, duplicate decision, conditional limit, lost then iteration 2, overdue, superseded drawing, withdrawal |
| NOV-079 packing templates and labels | Prepared physical bundles, customer projects | Versioned templates by company, customer, project or order (precedence order > project > customer > company), second-person approval, packing limits (pieces, kg, spacers, wrapping) with a dispatch-manager deviation, labels built only from an allow-list of business facts, print history, reprint keeping the payload, relabel on a newer template, and a working browser print of the bound label. | No template, self-approval, precedence at each tier, missing fact, value over 40 characters, over-limit packing, deviation by dispatch staff, reprint, relabel, no price/cost keys |
| NOV-021 delivery feasibility | Shift capacities, plan slots, batch 5 capacity windows, finishing lead times, billet allocation | Explainable proposals of up to four delivery parts checked against free capacity on compatible presses (after slots, maintenance and breakdowns, and claims of other accepted promises), finishing lead time and material status; 72-hour expiry; acceptance by sales manager after a fresh check moves the order expected dispatch date; accepted promises flagged at risk when capacity is lost. | Feasible, consumed by another order's slot, maintenance day removed, incompatible press, missing lead time, lead time too long, billet shortage, increasing dates, over remaining kg, past and >120 days, claims of another promise, expiry, supersession, withdrawal, nothing reserved |
| NOV-027 traceability | Billets, billet issues, jobs, stock, finishing, inspections, packed bundles, packing lists, dispatches, returns | Bounded two-way traversal (depth 8, 200 records) over recorded identities only, unlinked-source markers, evidenced manual links (billet to job, job to stock), investigation snapshots and QC holds on available released stock found by the investigation. | Backward and forward chains, similar stock not matched, unknown source, evidenced link traversed, profile mismatch, duplicate link, foreign tenant, 200-record cap, hold outside snapshot, closed investigation, wrong role |
| NOV-068 bundle split and combine | Profile stock batches | Whole-bundle split into 2 to 6 tagged bundles and combination of 2 to 6 identical bundles; pieces conserved, no weight gain, a stated reason for any loss; new tags must be unused; inputs become `transformed`; lineage links; reversal while outputs are unused. Production stock-in reconciliation ignores repacked outputs. | Pieces lost, weight gained, unexplained loss, reason without loss, held, reserved and packed inputs, tags in stock/dispatch/own tag, different identity, different jobs, duplicate scan, replayed confirmation, reversal after reservation, split-reverse loop, repacked stock not counted twice |
| NOV-081 compact headers | `PageHeader` used on 156 pages | `density="compact"` (no product eyebrow, smaller heading, tighter spacing, one `h1`, back link and wrapping actions kept) used on the database, create and detail routes of /tasks/control, /tasks/assurance and /tasks/lifecycle. Default unchanged elsewhere. | One heading, eyebrow removed only when compact, back link kept |
| NOV-090 visible table headings | `DataTable` with an existing `sticky` column flag | Desktop tables scroll inside a bounded area with headings that stay visible, and the identifier column stays fixed while scrolling sideways (dies and every operations database). | Every heading sticky, identifier heading above both axes, opaque identifier cells, `scope="col"` kept |
| NOV-008 visible defaults | Field provenance labels for copied and calculated values; dates silently set to today | Pre-filled dates are labelled "Suggested: today's business date (IST)", a changed value shows the suggestion and "Return to suggestion"; personal defaults for press, shift and transporter ("Your usual press", "Remember as my default", "Forget my default"); precedence helper source > customer > company > personal > system; measurements, prices and approvals never defaulted. | Precedence, override kept, typed value kept, higher tier replaces lower, incompatible value dropped, inactive press not suggested, other user isolation, unknown key, injected company |
| NOV-060 journey reviews | Quote, order stage, job status, dispatch, invoice and payment records | Reviews over the recorded journey of one order with missing milestones listed, private or shared observations with minutes, owned improvement actions (open, trial, done, dropped), baseline and trial measures with sample size and limitations, closure only with evidence. | Future baseline, private observation visibility by role and author, history does not leak private text, trial without baseline, unit mismatch, overwrite, progress by non-owner, invalid transitions, close with open actions or without trial |

## Per-feature recheck, verification, edge tests and audit

| ID | Recheck against the catalogue | Edge tests | Audit finding and fix |
| --- | --- | --- | --- |
| NOV-058 | Steps 1 to 5; finance evidence never changed | 5 SQL + 1 browser | The closed-order guard read `new.status` on tables without that column, so every dispatch and packed bundle insert failed; fixed with a table check before the field read |
| NOV-063 | Steps 1 to 5; approval proves the sample, not the batch | 3 SQL | Sample state skipped `measured` events, so a measured sample could never be sent; fixed. The form schema allowed stray recipient or job fields on other events; tightened to match the server |
| NOV-079 | Steps 1 to 5 for prepared bundles | 3 SQL + 1 browser | The labels view evaluated the label payload with no applicable template and failed for every company without one; the function is now null-safe. Instructions were shown twice on the label record; duplicate removed. Confirmation text "Print print 1" reworded |
| NOV-021 | Steps 1 to 4; a proposal reserves nothing | 4 SQL + 1 browser | A PL/pgSQL variable shadowed a CTE alias and appending text literals to `text[]` was parsed as array literals; both made every check fail; fixed |
| NOV-027 | Steps 1 to 4; holds through QC status only | 3 SQL | No code defect found |
| NOV-068 | Steps 1 to 5 for whole stock bundles | 4 SQL + 1 browser | Reversal failed because a PL/pgSQL variable shadowed a table alias; fixed. Production stock-in counted repacked outputs on top of their consumed inputs; `create_stock_from_production_surplus` now counts original stock-in only |
| NOV-081 | Steps 1 to 3 on the selected routes | 1 unit | Kept opt-in to avoid changing 156 existing headers |
| NOV-090 | Steps 1 to 3 | 1 unit | Separated table borders would remove row dividers; kept collapsed borders with an inset heading line |
| NOV-008 | Steps 1 to 4 for dates and three personal fields | 1 SQL + 1 unit | Dealer roles could call the defaults command; now internal roles only. The form builder could overwrite a fixed value with a blank field; fixed |
| NOV-060 | Steps 1 to 5 | 2 SQL | No code defect found |

## Scope and operating boundaries

- Entry point: /tasks/lifecycle, linked from Tasks. Overview, ten-row server-paginated databases, create
  pages and detail/history pages are separate. Same reviewed protocol as batches 3 to 5.
- NOV-058: operational closure keeps receivables in accounts; final closure needs a zero balance; the
  new-work guard applies only to orders closed through this review (legacy closed orders are unchanged).
- NOV-063: approval proves the sample, not the batch; jobs already started are not stopped.
- NOV-079: labels for packed (prepared) bundles; printing is browser print of the business-safe payload;
  repacking of stock bundles uses NOV-068.
- NOV-021: a proposal reserves nothing and creates no slots; acceptance changes only the order expected
  dispatch date; capacity is configured shift kg, not optimisation.
- NOV-027: only recorded identities are traversed; similar dates or codes are never matched; holds go
  through QC status and release through the existing stock workflow.
- NOV-068: whole input bundles only; outputs inherit profile, finish, alloy, temper, owner, origin and QC.
- NOV-060: a review record over existing events; it does not certify process improvement.
- NOV-008: personal defaults for three fields; customer and company tiers are supported by the
  precedence helper but have no editing screen yet.
- NOV-081 / NOV-090: shared component changes; no data change.

## Data and security audit

Migration: supabase/migrations/20261103400000_november_lifecycle.sql (additive). New tables:
order_closures, order_closure_carries, sample_requirements, sample_events, packing_label_templates,
packing_label_prints, delivery_promises, material_lineage_links, trace_investigations, trace_holds,
bundle_transformations, bundle_transformation_lines, journey_reviews, journey_annotations,
journey_actions, journey_measures, user_form_defaults, lifecycle_requests, lifecycle_events.
Composite tenant foreign keys throughout. Widening only: `profile_stock_batches.status` also allows
`transformed` (TypeScript `ProfileStockStatus` updated). Replaced function:
`private.create_stock_from_production_surplus` (same definition apart from the stocked-weight query).

Every new table enables RLS and revokes direct writes; reads are tenant- and role-scoped; dealers are
denied; journey annotations and history are readable only through the detail command (private
observations only to the author, review owner, factory manager, admin and owner); user form defaults are
readable only by their owner. Company and actor come from the session. All functions pin search_path;
private helpers are not executable by clients. New triggers: `zzz_guard_closed_order` (production_jobs,
dispatches, finishing_jobs, prepared_physical_bundles, profile_stock_reservations) and
`zzz_guard_sample_approval` (production_jobs). Labels never read price or cost columns. Existing writes
made by actions: orders current stage and expected dispatch date, order_stage_history,
profile_stock_batches QC hold and transformations.

## Verification

| Check | Result |
| --- | --- |
| Migration chain replay (PGlite) | Applies cleanly after all existing migrations |
| Hosted-order simulation (PGlite) | Batch 5 first, then batches 3, 4 and 6 as the 12 MCP parts: all apply; catalog identical to the local replay (16,365 functions, columns, constraints, indexes, policies and triggers; 0 differences) |
| tests/nov-batch6-sql.test.mjs | 28 passed |
| tests/nov-batch6.test.mjs | 8 passed (input contracts, role mirrors, form building with 150 generated quantities, visible defaults, compact header, sticky table, real server action boundaries) |
| tests/nov-batch6-browser.test.mjs | 6 passed at 375 px; screenshots in docs/evidence/NOV_UPGRADES_BATCH_6 |
| npm run typecheck / npm run lint | Passed, no errors or warnings |
| npm run build | Passed, including the four /tasks/lifecycle routes |
| npm test | First run: 12 failures in older production-form browser suites, because those fixtures' mocked Supabase client has no `rpc` and the new defaults read blocked the form. Fixed by making the defaults read non-fatal (a convenience never blocks a form). Re-run: 3,076 tests, 76 suites, 0 failures or skips |

## Hosted migration state

Hosted AlExMS (pkawmdxtmsdgigsehcmb) on 4 November 2026 had batch 5 only (ledger 193); batches 3, 4 and 6
were absent. Batch 4 reads batch 3's `order_coordinators`, so the required order is 3 → 4 → 6. The three
files were split at top-level statements into 12 parts (3 + 3 + 6) and verified in PGlite in exactly the
hosted order (batch 5 first): all parts apply and the catalog is identical to the local replay.

Applied: `november_coordination_part1` only (ledger 194): the 12 batch 3 tables with RLS, their policies,
role helpers and the handoff contract trigger (a no-op until a contract is published). The batch 3
command is not yet present, so the coordination screens still report the database upgrade as unavailable.
Further `apply_migration` calls were refused by the session's permission classifier, so
`november_coordination_part2`–`part3`, `november_operations_control_part1`–`part3` and
`november_lifecycle_part1`–`part6` remain to be applied, in that order. After applying: compare hosted
function definitions with the local replay, run the security and performance advisors, and smoke-call
`lifecycle_command('list', …)` for each view.

## Remaining acceptance

Pilot with real users: close one delivered and invoiced order; one customer sample through approval and
first production start; one customer-specific label printed on the factory printer; one delivery promise
accepted against real shift capacity; one traceability investigation from a customer complaint; one
bundle split at the rack; one order journey walked through with the people involved; press and shift
defaults used for a week by one supervisor.

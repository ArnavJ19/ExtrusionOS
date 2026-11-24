# Order Lifecycle Orchestration — batch 1

Directive: *Master Implementation Directive — Complete Order-to-Delivery Orchestration System* (pasted 2026-11-20).
Migration: `supabase/migrations/20261120100000_order_lifecycle_orchestration.sql` (not yet applied to hosted).

This batch builds the orchestration spine the directive asks for in sections 8–10, 12, 14, 31–35 and 40, on top of the
modules ExtrusionOS already has. It does not replace any existing workflow.

---

## A. Current-state assessment (Phase 0)

What the repository already had when this batch started, and what this batch changed. "Existing" means the tables and
functions were found and reused; it does not mean each was re-audited against every clause of the directive.

| Directive stage | Existing implementation found | This batch |
|---|---|---|
| 5 Quotation follow-up | `quote_followup_settings`, `quote_followup_steps` (configurable cadence, tasks), `quote_validity_*`, `quote_outcomes` | Counted on the command centre |
| 6–7 Acceptance, PO, payment | `po_intakes` (review/link), `order_credit_checks`, `order_credit_holds` (hold blocks draft release and dispatch), `financial_receipt_events`, `customer_credit_limits` | Commercial gate reads credit holds; finance amounts hidden from non-finance roles |
| 8 Order book / priority | `production_plan_slots` (per press, sequence), `orders.priority`, `capacity_reschedules`, `press_reflows`, planning cockpit | **New**: queue rank per press derived from slots, `production_queue_positions`, append-only `production_queue_rank_events`, `/production/order-book` |
| 9 Billet allocation at rank 5 | `order_billet_requirements`, `allocate_billets_by_priority` (in-house first, `skip locked`), `foundry_billets` lineage guards | **New**: rank ≤ 5 billet allocation task, verified complete from the requirement records |
| 10 Early shortage forecast | `procurement_plan_*`, `mrp_weekly_plans`, `/production/billet-forecast` | **New**: per-requirement forecast after higher-priority demand; one shortage task per cycle |
| 11 Procurement / casting | `purchase_requisitions`, `purchase_orders`, `supplier_commitments`, `foundry_batches`, foundry scrap receiving | Shortage task points to the material plan; procurement workflow itself unchanged |
| 12 Die at rank 3, preheat | `dies` status authority, `die_service_*`, `die_health_metrics` | **New**: `die_preparations` (check → prepare → preheat scheduled → preheating → ready → issued → returned), `die_preheat_standards`, `/dies/preparation` |
| 13 Custom die / trials | `die_trials`, `die_corrections`, `development_projects`, `sample_requirements` + `guard_sample_approval` | Custom-die-trial and sample gates shown in readiness |
| 14 Readiness gate | `production_readiness_issues`, `transition_production_job_atomic`, `production_job_holds`, `validate_production_start_resources` | **New**: `olo_job_gates` (all gates with owning department, planning vs start), ready announcement once per transition, optional die/preheat start guard |
| 15 Production runs | `production_jobs`, `production_billet_issues`, `press_crew_sessions`, push events | Run started/interrupted/completed events on the order timeline |
| 16–19 QC, ageing, partial acceptance | `quality_inspections`, `inspection_plans`, `qc_sample_*`, `treatment_batches`/`treatment_inputs` (accepted/rejected/retreat split), `quality_ncrs`, `material_dispositions`, `trace_holds` | Quantity ledger keeps accepted / pending / rejected separate; QC next action |
| 20 Remelt | `material_dispositions` (`scrap`), foundry scrap receipts | Not changed (see G) |
| 21 Value addition | `finishing_jobs`, `coating_runs`, `profile_routing_steps` | Not changed |
| 22–23 Packaging, handover | `packaging_jobs`, `prepared_physical_bundles`, `department_handoffs`, `handoff_acceptances` | Packed quantity in the ledger |
| 24–25 Dispatch, transport | `dispatches`, `loading_sessions`/`loading_scans`, `dispatch_gate_exits`, `eway_*`, `einvoice_*` | Dispatch next action and domain status |
| 26–28 Delivery, acceptance | `dispatch_status_history`, POD upload, `delivery_dispositions`, `return_authorizations`, `customer_complaints` | Delivery domain, POD-missing and dispute next actions |
| 29–30 Financial and final closure | `invoices`, `payments`, `payment_reminders`, `order_closures` (operational / final) | Overall status separates operationally closed, financially open and fully closed |
| 31–34 Notification / task engine | `tasks` (trigger keys, handoffs, delegation), `notifications` (role recipients, condition keys, system resolution), `task_trigger_rules`, `task_escalations`, `/notifications`, `/tasks` | **New**: workflow tasks with verification-only completion, acknowledgement, escalation stages, configurable department routing, `/tasks/orchestration` |
| 35 Timeline | `order_stage_history`, `record_events`, `lifecycle_events`, `audit_logs` | **New**: one order timeline merged from the authoritative records |
| 40 Command centre | `/command-center` (owner/admin) | **New**: `/orders/lifecycle` metrics and board for every internal role |

## B. Architecture

```
business change (slot, job status, billet, requirement)
  └─ statement trigger zzz_olo_* ──► olo_sync_queue / olo_verify_tasks / olo_refresh_readiness / olo_evaluate_material_risk
                                     (in the same transaction; failures logged to olo_engine_errors, never block the change)
hourly pg_cron (existing autopilot-hourly) ──► job 'orchestration.hourly' ──► olo_run_all (sync, risk, verify, escalate)
olo_command / die_preparation_command (security definer RPCs) ◄── server actions ◄── pages
```

* **Queue rank** is never stored as a typed field: `olo_queue_ranks` orders each press's scheduled and released slots
  (first slot per job). Changing the schedule changes the rank; every change is appended to `production_queue_rank_events`.
* **Idempotency**: each workflow task has `workflow_key = kind:job-or-requirement:cycle`, unique per company. Re-running
  any evaluation inserts nothing new. A new cycle starts only when the previous task was completed but its condition is
  no longer true (billets released) or it was withdrawn (job left the queue or was cancelled).
* **Verification-only completion**: a `tasks` trigger refuses completing or cancelling a workflow task outside the engine.
  Acknowledging and starting are recorded in `olo_task_events` and never close the task.
* **Transactions**: task creation, notifications and verification run inside the business transaction, so a slot move
  and the work it causes commit together. There is no external delivery in this batch, so no outbox is needed yet; email/
  WhatsApp delivery remains with the existing `outbound_messages` infrastructure.
* **Concurrency**: queue recomputation takes a per-company advisory transaction lock; verification and escalation use
  `for update skip locked`; billet reservation stays with the existing allocator (`skip locked`, lineage guards).

## C. Database changes (migration 20261120100000)

New tables: `olo_settings`, `olo_department_roles`, `olo_events` (append-only, dedupe key), `olo_engine_errors`,
`production_queue_positions`, `production_queue_rank_events` (append-only), `olo_task_events` (append-only),
`die_preheat_standards`, `die_preparations`, `die_preparation_events` (append-only).
New `tasks` columns: `workflow_key/kind/department/order_id/job_id/source_id/cycle/due_at/escalation_level/escalated_at`,
`acknowledged_at/by`, `completion_evidence`, with a shape check and a unique `(company_id, workflow_key)` index.
New RPCs: `public.olo_command`, `public.die_preparation_command` (authenticated; every role rechecked inside).
New triggers: statement triggers on `production_plan_slots`, `production_jobs` (status/die/machine/profile),
`foundry_billets`, `order_billet_requirements`; row triggers `zzz_guard_olo_die_readiness` (start guard) and
`zzz_olo_job_status_events` on `production_jobs`; `b_guard_olo_workflow_task` on `tasks`.
Job registry: `orchestration.hourly` added by wrapping `ap_job_registry` / `ap_job_execute` (existing pattern).
RLS: read policies for internal staff only (dealers excluded, company-scoped); engine errors readable by managers; no
direct write grants. The migration ends with a first evaluation of the current queue (errors logged, not fatal).

## D. Gate matrix (production readiness)

| Gate | Owner | Phase | Required | Refused by the database at start |
|---|---|---|---|---|
| Commercial clearance (order open, no credit hold) | Finance | planning | yes | order state: yes (existing); credit hold: no (hold blocks draft release and dispatch) |
| Specification (drawing approved, alloy and temper defined) | Sales | planning | yes | no (advisory in the existing guard) |
| Billet allocation | Billet inventory | planning | yes | linked billet ineligible: yes; issue at start: yes (existing) |
| Die available and approved for the profile | Tool room | planning | yes | yes (existing) |
| Custom die trial approved | Tool room | planning | yes when the die is in design/trial/correction | yes (die status) |
| Customer sample approval | QA/QC | planning | yes when the line is sample-gated | yes (existing) |
| Press and released slot | Production planning | planning | yes | yes (existing) |
| Production hold | Production | planning | yes when a hold is active | yes (existing) |
| Die prepared | Tool room | planning | when `enforce_die_preparation` | yes when enforced (new) |
| Die preheated within hold time | Tool room | start | when `enforce_preheat` | yes when enforced (new) |
| Start checks (job ready, die free, billets issued) | Production | start | yes | yes (existing) |

`planning_ready` = all required planning gates pass; `start_ready` adds the start gates. No override path is added:
failed gates are resolved by the owning department's records.

## E. Notification and task routing (this batch)

| Trigger | Work / alert | Primary recipients (default roles) | Closes when |
|---|---|---|---|
| Job enters rank ≤ 5 on its press | Task: billet allocation | Billet inventory (inventory manager, production manager); alert also to foundry and production planning | Requirement shows billets allocated; withdrawn if job cancelled or started |
| Job enters rank ≤ 3 | Task: die preparation + die preparation record | Tool room (production manager, production); alert also to production planning | Preparation recorded as prepared (or later) on the job's die |
| Open requirement short after higher-priority demand, within horizon or queued | Task: billet procurement / casting | Procurement (inventory manager, production manager); alert also to foundry and planning | Allocated, or compatible stock now covers it |
| All required planning gates pass | Alert: order ready for production | Production, production planning | Withdrawn when a gate fails or the job starts |
| Task not acknowledged within SLA | Escalation level 1 | Department supervisor | — |
| Task past due | Escalation level 2, priority urgent | Factory manager | — |
| Task past due + action SLA | Escalation level 3 | Owner | — |

Recipients are roles resolved per company in `/settings/orchestration`; the task goes to the least-loaded active employee
of the first stage. Alerts for the other directive rows (quotation, PO mismatch, QC, dispatch, delivery, payment) come
from the existing modules listed in section A and were not rebuilt.

## F. Pages

* `/orders/lifecycle` — live metrics and the order board (next action, owner, blocker, days in stage, risk), 10 per page.
* `/orders/[id]/lifecycle` — domain statuses, quantity ledger, next action, blocker, per-job gates, open tasks, timeline.
* `/production/order-book` — press queues in rank order with gates and blockers; unscheduled jobs listed separately.
* `/dies/preparation`, `/dies/preparation/[id]` — die preparation queue and step forms with evidence.
* `/tasks/orchestration` — My tasks, Department, Overdue, Escalated, Completed history.
* `/settings/orchestration` — thresholds, SLAs, start controls, preheat standards, department routing, engine errors.

## G. Remaining work after batch 1

Batch 2 (section I) closed items 1, 2, 3, 5 (delivery overdue and acceptance follow-up), 6 and 7. Phase 3 (section J)
closed dispatch finance clearance, customer dispatch communication, the review of approvals made before a containment,
real-time refresh and Hindi labels for the tool-room and task screens. Phase 4 (section K) closed the QC ledger
reversal, Hindi on the clearance, containment and order lifecycle screens, the release validity setting and the two
cosmetic Phase 3 items. Phase 5 (section N) connected production runs, first-stage QC, ageing and final QC. Phase 6
(section P) connected packaging release, bundle traceability, finished-goods transfer and the invoice of a dispatch. Still open:

* **Automatic message transport**: WhatsApp Business / SMS gateways are not wired (`lib/communications/providers.ts`);
  staff send from their own app and record the message. Needs an owner decision on the provider and its account.
* Concurrency was reasoned and lock-based, but PGlite runs one session, so concurrent tests were not executed.
* The customer-update screens (`/dispatches/communications`) are still English-only (the message itself has Hindi).

## I. Batch 2 — nonconforming material, remelt, reproduction, delivery, change and priority control

Migration: `supabase/migrations/20261120200000_order_lifecycle_orchestration_batch2.sql` (not yet applied to hosted).

| Area | What now happens | Who |
|---|---|---|
| QC containment (§16, §19) | A failed sample holds the affected, not-yet-dispositioned output of a job. An NCR opens (or the job's NCR is linked) and QA gets an urgent task; final-stage failures also notify the factory manager and owner. While held, packaging jobs, packing-list rows, prepared bundles, ageing loads and new QC approvals for that job are refused. | Open: QA, production manager, factory manager, owner, admin |
| 100% inspection | Non-destructive defects: every piece or sublot gets a recorded result (immutable). Releasing creates accepted and rejected child lots linked to the parent production lot, writes the matching QC inspections (pending when an inspection plan applies, so plan results are still required), and leaves unrecorded quantity held. | QA, owner |
| Expanded sampling | Destructive tests: the opener records the approved sampling plan and its sample count. Acceptance needs that many passing samples and no failure; one replacement sample never releases a lot. A failed lot is rejected or moved to 100% inspection. | QA, owner |
| Earlier approvals | Approvals recorded before a containment are suspended: the job's material stays blocked until the whole lot is resolved, and resolving needs an explicit confirmation that the earlier material was re-checked. | QA |
| Remelt (§20) | `scrap` dispositions are refused unless approved by the factory manager or owner, never the proposer (owner excepted). Approval records the disposition; the scrap lot is reserved until the foundry weighs it in; a non-zero difference must be explained and alerts the factory manager. A factory manager or owner recording scrap directly is captured as their approval. Reconciliation: rejected → approved → dispositioned → received → consumed into melt. | Propose: QA, production/inventory/dispatch managers. Decide: factory manager, owner. Receive: foundry, stores |
| Reproduction (§19) | When accepted + awaiting disposition + held + uninspected + still-to-produce material is below the order target after rejections, production planning gets one task. Held material counts as possible supply; if it is later rejected a new cycle opens for that balance only. Closes when planning, held material or an approved short closure covers it. | Production planning |
| Delivery (§27–28) | A dispatch not confirmed by its expected delivery (appointment end, else dispatch + configurable days, default 3) gets a confirmation task for dispatch, alerting sales. A delivered dispatch gets an acceptance follow-up for sales that closes when every bundle has a recorded customer disposition. | Dispatch, sales |
| Change control (§38) | An approved order change withdraws the order's open billet, die, shortage and reproduction tasks and re-evaluates them as new cycles, notifying planning, tool room and billet inventory. | Engine |
| Priority (§8) | A request with reason and the queue snapshot; decided by production manager, factory manager or owner, never the requester (owner excepted). Approval updates the order priority with an audit row and notifies the requester. The run order still follows the press schedule. | Request: sales, accounts, managers. Decide: planning authority |

New tables: `quality_containments`, `containment_results` (immutable), `material_lots` (parent/child), `remelt_approvals`,
`priority_change_requests`. New RPCs: `quality_containment_command`, `remelt_command`, `priority_request_command`.
New task kinds: reproduction, delivery_confirmation, delivery_followup, containment, remelt_approval, remelt_receipt,
priority_approval. New settings: `delivery_confirmation_days`, `reproduction_tolerance_kg`.
Pages: `/quality/containment`, `/quality/containment/[id]`, `/foundry/remelt`, `/orders/priority-requests`, and a priority
request form on `/orders/[id]/lifecycle`.

**Deployment notes for batch 2**: apply after 20261120100000. The remelt guard changes current behaviour: QA and
production, inventory and dispatch managers can no longer record a `scrap` disposition directly; they propose it on
`/foundry/remelt`. Delivery tasks are created only for dispatches from the last 60 days (follow-ups: 30 days), so
older history does not raise a burst of tasks.

## J. Phase 3 — dispatch finance clearance, customer dispatch updates, earlier-approval review, live screens, Hindi

Migration: `supabase/migrations/20261122100000_order_lifecycle_orchestration_batch3.sql` (not yet applied to hosted).

| Area | What now happens | Who |
|---|---|---|
| Payment terms (§24) | Terms per order, else per customer, else company default, else credit terms. `credit` keeps only the existing credit-limit and overdue checks. `advance_part` needs X% of the order value received; `payment_before_dispatch` needs everything dispatched on the order so far plus this dispatch covered. Received = payments on the order's invoices + the customer's unapplied advances left after their other open invoices and dispatched-but-unbilled goods (one advance never clears two orders). | Set: accounts, admin, owner |
| Gate refusal | `b_olo_guard_dispatch_finance` refuses pending → dispatched while blocked. The message names the terms, never amounts. Unpriced bundles under payment-before-dispatch need a release. Gate-outs of one customer take a per-customer advisory lock and the check re-reads after it (the clearance function is volatile), so two concurrent dispatches cannot share one advance. | Database |
| Finance release | Accounts release one dispatch on a payment reference (UTR / cheque / receipt), or the owner records an exception. A release covers the dispatch value at that time, lasts 48 h, is used once at the gate, can be withdrawn before use; a new release supersedes the old. | Accounts, admin, owner (exception: owner only) |
| Clearance task | Packed pending dispatch that is blocked → one `dispatch_clearance` task for finance (dispatch and sales supervisors alerted). Task text carries no amounts (tasks are readable by all staff). Closes when covered, released, or the order moves to credit terms. | Finance |
| Customer dispatch update (§26) | A dispatch that left in the last 7 days without a recorded message → one `dispatch_intimation` task for dispatch (sales alerted). `/dispatches/communications/[id]` composes the message (English or Hindi) from logistics facts only — vehicle, driver, transporter, LR, e-way bill, invoice numbers, bundles, pieces, net kg, expected delivery; never rates, values or internal notes — and opens it in WhatsApp / SMS / email / phone. Recording it stores channel, recipient and exact text (immutable) plus an `outbound_messages` log row; it is then marked delivered, read or failed. A failed message re-opens the task as a new cycle. A phone call is recorded as delivered. | Dispatch, sales, managers |
| Earlier QC approvals (§19) | The batch 2 blanket "re-checked" confirmation is replaced. Each approval recorded before the containment is reviewed: **reconfirmed** (method + finding) lifts its suspension; **revoked** keeps it suspended, so the job's material stays blocked and the lot cannot resolve. QA cannot change the QC record (immutable). The factory manager or owner — not the person who revoked, unless owner — closes the revocation with re-verification evidence. Revoking alerts factory management, QA and planning; if job material already moved to ageing, packaging or dispatch, the alert is critical, names the kg and also reaches dispatch for recall. | Review: QA, owner. Close: factory manager, owner |
| Live screens | `olo_events`, `olo_task_events`, `quality_containments`, `die_preparation_events`, `dispatch_communications` published to Realtime. Workflow tasks, command centre, order lifecycle, die preparation, containment, clearance and customer-update pages refresh on change (debounced; manual refresh when paused). Finance releases are not published. | — |
| Hindi | Workflow task inbox, die preparation list and detail, and the die-step forms use the floor language catalogue (166 new keys, parity-tested) with the existing English / हिंदी toggle. Task titles and descriptions stay as recorded. | — |
| Lifecycle | Finance-clearance domain shows the terms and `dispatch_blocked`; next action moves to finance for a blocked dispatch, or to dispatch "send the dispatch update" for an uninformed one. | — |

New tables: `dispatch_finance_terms`, `dispatch_finance_releases` (finance-only read), `dispatch_communications`,
`containment_prior_reviews`. New RPCs: `dispatch_finance_command`, `dispatch_comm_command`; `quality_containment_command`
is now a wrapper (new commands `prior_review`, `prior_close`) around the batch 2 command, moved to
`private.olo_containment_command_b2`. Wrapped: `olo_verify_tasks` (b2), `olo_run_all` (b2), `olo_order_core` (b2).
Pages: `/dispatches/clearance`, `/dispatches/clearance/[id]`, `/dispatches/communications`, `/dispatches/communications/[id]`.

**Code review of Phase 3 (2026-11-22)** — every section of the migration, plus the app layer:
1. *Fixed:* two gate-outs of the same customer at the same moment could both count one advance. The guard now takes a
   per-customer advisory lock and the clearance check is volatile, so it re-reads after the wait.
2. *Fixed:* a customer advance was counted in full for every order; it is now netted against the customer's other open
   invoices and dispatched-unbilled goods (regression test: "one customer advance never clears two orders").
3. *Fixed in design:* revoking an earlier QC approval first tried to flip the QC record to rework; QC dispositions are
   immutable, so revocation is a hold with second-person closure instead.
4. *Accepted:* non-finance staff can see a release's payment reference and note (never amounts).
5. *Cosmetic, open:* the "customer not yet informed" queue lists opening-balance orders, which never get a task.
6. *Pre-existing, not Phase 3:* `outbound_messages` keeps its older company-wide read policy.
7. *Trivial, left:* `v_approved` in the `prior_review` revoke branch is computed but unused; changing it would make the
   local file differ from the checksum-verified hosted copy, so it waits for the next migration.

**Deployment notes for Phase 3**: applied to hosted 2026-11-22 with batches 1 and 2, in 20 statement-safe parts
(`order_lifecycle_orchestration_p01`…`_batch3_p05`); all 85 orchestration function bodies checksum-match the local
replay. Apply order was after 20261120200000. With no terms recorded every order stays on credit
terms, so nothing changes at the gate until accounts set terms. The first run opens customer-update tasks only for
dispatches from the last 7 days. Operator gates: decide company / customer payment terms; confirm the 48 h release
validity; review that a customer's unapplied advance is netted against their other open obligations.

## K. Phase 4 — QC reversal, release validity, remaining Hindi screens

Migration: `supabase/migrations/20261123100000_order_lifecycle_orchestration_phase4.sql` — applied to hosted 2026-11-23 as one migration (`order_lifecycle_orchestration_phase4`).

| Area | What now happens | Who |
|---|---|---|
| QC reversal (§19) | An approval that turned out wrong is **reversed**, never edited: the record keeps every value and only its status moves to `reversed`; a child record carries the reversed kilograms as `rejected` (or `rework`) and, for a partial reversal, a second child keeps the rest `approved`. Every reader of approved kg already counts `status = 'approved'` only, so dispatch readiness, packaging and stock caps, handoffs, supply to the order and the lifecycle ledger honour the reversal without being rewritten. The open packing handoff of the original is withdrawn; the kept part gets its own unless the original was already handed over. Rejected kg then follows the batch 2 remelt approval; rework kg follows the existing rework resolution. Production planning gets a reproduction task if the order is now short. | Reverse: QA, owner. Told: factory management, production planning, QA |
| Moved-on material | Refused for material already committed past QC — the largest of packaging jobs, packed + prepared bundles + stock moved from the job, or ageing loads. The person is told how much has moved on and the most that can be reversed now; the rest must be recalled first. | Database |
| Under containment | Only an approval QA has **revoked** there (open revocation) can be reversed. Reversing all of it closes the revocation with the reversal as evidence and lifts its suspension; a partial reversal leaves the revocation for the factory manager or owner to close for the part kept. Packaging stays refused while the lot is held. | QA; close: factory manager, owner |
| Evidence | `quality_reversals` rows are immutable; reversed QC records and reversal children cannot be edited or deleted; only the reversal command (transaction-scoped authorisation, as for rework resolutions) may mark an approval reversed or write a child. | Database |
| Release validity | `dispatch_release_hours` (4–168, default 48) on `/settings/orchestration`; a new release lasts that long. The batch 2 settings `delivery_confirmation_days` and `reproduction_tolerance_kg`, which had no save path, are saved there too. | Owner, admin, factory manager |
| Hindi | QC containment list/detail and forms, finance clearance list/detail and forms, order lifecycle board and detail (incl. the priority request form) and the new QC reversal screens use the floor catalogue (`lib/i18n/floor-orchestration.ts`, 410 keys per language, parity-tested) with the English / हिंदी toggle. Server messages, record values and recorded defaults stay as recorded. | — |
| Phase 3 leftovers | The customer-update queue no longer lists dispatches of opening-balance orders. (Item 7, the unused `v_approved`, is left: it would rewrite the checksum-verified containment command for no behaviour change.) | — |

New table: `quality_reversals`; new column `quality_inspections.reversal_id`; new status `reversed`; private
`quality_reversal_authorizations`. New RPC: `quality_reversal_command` (`list`, `get`, `preview`, `reverse`).
Wrapped (renamed to `private.*_b1/_b3`): `olo_command` (settings save), `dispatch_finance_command` (release validity),
`dispatch_comm_command` (queue), `quality_containment_command` (`get` lists reversals). Redefined with one added
condition each (marked `Phase 4:` in the file): `guard_terminal_quality_inspection`, `guard_quality_resolution_immutability`,
`guard_inspection_plan_approval`, `ap2_guard_sampling_release` (admit the authorised reversal and its kept part),
`validate_quality_production_link` (the rework-resolution match ignores a reversed child), and
`capture_important_source_change` (engine-verified workflow tasks are no longer held for source review — they close only
when the engine re-verifies current records, and holding them stopped the engine from closing them; every other task
related to a changed QC record, payment or profile is still held for independent review).
Pages: `/quality/reversals`, `/quality/reversals/new?inspection_id=`, `/quality/reversals/[id]`; a reversal panel on
`/quality/[id]`; reversal links on revoked approvals in `/quality/containment/[id]`; a card on `/quality`.
Realtime: `quality_reversals` published. Tests: `tests/order-lifecycle-orchestration-phase4-sql.test.mjs` (7) and
`tests/order-lifecycle-orchestration-phase4.test.mjs` (9).

**Code review of Phase 4 (2026-11-23)**:
1. *Fixed:* reversing the approved child of a rework resolution was refused by the resolution-match check; the check now
   applies to approved and rejected children only.
2. *Fixed:* a reversal held every open workflow task of the job for source review, which then refused the engine's own
   closure (a containment could no longer resolve). Workflow tasks are excluded from source review (see above). This
   also removes the same latent block after an ordinary pending → approved QC update or a payment change.
3. *Fixed:* under a containment the revocation state was read before the containment row was locked; the containment
   and job rows are now locked first and the review is re-checked after the lock.
4. *Fixed:* saving only the new settings ran the batch 1 save as well (an empty audit row and a queue resync).
5. *Accepted:* packaging-job and bundle writers do not take the QC disposition lock, so a packaging job created in the
   same instant as a reversal is not serialised against it; the reversal locks the job row, and the quantity check is
   also a table constraint on the reversal record.
6. *Accepted:* a containment-release lot whose approval is reversed later keeps its `released` lot status; the reversal
   record is the correction.

**Deployment notes for Phase 4**: applied to hosted 2026-11-23 in one transaction (ledger name `order_lifecycle_orchestration_phase4`). Before applying, the hosted bodies of the six redefined functions and four wrapped commands were checked against the files (identical logic; hosted stores four of them with indentation stripped). After applying, all 19 Phase 4 function bodies match the file byte for byte (md5 of `prosrc`), the wrapped commands kept their earlier bodies, RLS / grants / triggers / Realtime are in place and no engine errors were logged. A screen fixture for the forms is `scripts/olo-phase4-preview.mjs` (launch config `olo-phase4-screens`). Apply order was after 20261122100000. No new environment variables. Nothing changes until QA
reverses an approval: existing approvals, guards and screens behave as before (the Hindi toggle defaults to English).
Operator gates: confirm the release validity (48 h default); confirm that QA alone (with the owner) may reverse an
approval while the factory manager and planning are notified.

## L. Review fixes for batches 2 and 3 (migration 20261123200000)

Migration: `supabase/migrations/20261123200000_order_lifecycle_orchestration_review_fixes.sql` — applied to hosted 2026-11-23 (`order_lifecycle_orchestration_review_fixes`; all four function bodies md5-verified against the file).
Three P1 findings from the code review of the earlier batches:

| Finding | Fix | Where |
|---|---|---|
| Material packed onto a pending dispatch before QA opened a containment could still leave: the batch 2 guards only run when bundles are packed. | A dispatch cannot move out of `pending` while any of its bundles comes from a job under open containment — straight from production, or through a stock batch made from that job. The message names the job, the containment and the bundle count. A refused gate-out does not use a finance release. | Guard `b_olo_guard_dispatch_containment` on `dispatches` |
| On advance / payment-before-dispatch terms, the dispatch writer inserted and activated the dispatch in one transaction, so the finance guard rolled the whole dispatch back and accounts never saw it to release. | The writer (`private.save_ready_dispatch_atomic`, redefined with one added check) keeps a finance-blocked dispatch **pending**: bundles, weights and logistics are recorded, stock is not consumed, and finance gets the clearance task. It leaves through the normal pending → dispatched step, where the finance guard checks it again. The app says so instead of "dispatch recorded": the dispatch form and record form open the clearance page, the dispatches list warns, and a loading session stays open until the dispatch leaves. On the clearance page, dispatch staff get **Dispatch has left** once the terms are met or released. | Writer, `saveDispatchAction`, `completeLoadingAction`, `/dispatches/clearance/[id]` |
| A containment with an open revocation could be cancelled, which dropped the hold on the job without the factory manager's or owner's re-verification and left the revocation impossible to close. | `cancel` is refused while any revocation is open (under the containment row lock), and the detail view hides the cancel action (`can_cancel`, `open_revocations`). Once the revocation is closed or the approval reversed, cancelling works as before. | `quality_containment_command` wrapper |

Tests: `tests/order-lifecycle-orchestration-review-fixes-sql.test.mjs` (5), through the real dispatch writer and loading
session. Regression: the 19 dispatch, containment and orchestration suites (234 tests) pass.
**Deployment notes**: apply after 20261123100000. Before applying, the hosted body of `private.save_ready_dispatch_atomic`
was checked to match the file it redefines. Behaviour changes only for orders on advance or payment-before-dispatch terms
(dispatches wait as pending instead of failing) and for jobs under containment.

## M. Quantities after a reversal, and the hold-a-lot list (migration 20261123300000)

Migration: `supabase/migrations/20261123300000_order_lifecycle_orchestration_reversal_counts.sql` (not yet applied to hosted).
Found while checking the Phase 4 screens in a browser (`scripts/olo-phase4-preview.mjs`; screenshots in `docs/evidence/OLO_PHASE4/`):

| Problem | Fix |
|---|---|
| "Produced but not yet inspected" summed every QC record of a job, so a reversed approval and its child records (and a resolved rework record and its children) were counted twice. Supply to the order and the containment "not yet dispositioned" checks were understated. | `private.olo_qc_dispositioned_kg` counts each kilogram once (leaves out reversed records and resolved rework sources); used by `olo_order_supply` and the containment `open` / `candidates` checks. |
| The reversal command marked the approval reversed before writing its children; the engine evaluated in between and raised the reproduction task and alert with "accepted 0 kg, shortfall 1,000 kg". | The engine waits until the reversal is complete and evaluates once with the final quantities. |
| Batch 2 bug: the containment `candidates` command failed on every call (its query used the alias `c`, also a variable of the function), so the "Hold a lot" form never offered a job — on hosted as well. | The alias is renamed. |

The two earlier commands are patched in place by the migration: each replaced fragment must occur exactly once or the
migration stops. Tests: a counts scenario added to `tests/order-lifecycle-orchestration-phase4-sql.test.mjs` (now 8).

## N. Phase 5 — manufacturing and quality connected (migration 20261124100000)

Migration: `supabase/migrations/20261124100000_order_lifecycle_orchestration_phase5.sql` (not yet applied to hosted).
Directive sections 15–20 and implementation phase 5 (production runs, first-stage QC, ageing, final QC, partial lot
acceptance, holds, rework, rejection, scrap and remelt). Holds, partial acceptance, remelt and reversal were already
built (sections I, K); this phase connects them through ageing to a final QC.

| Area | What now happens | Who |
|---|---|---|
| Ageing route (§17) | Each job's route is read from the profile: its active routing (an ageing / heat-treatment step, whole words only, so "Packaging" is not ageing), else its recorded ageing or heat-treatment requirement, else its temper (T5–T9 aged; F, O, H, T1–T4 not). When all are silent the route is **not documented**: nothing is assumed, no ageing work is raised, and the lifecycle says so. | Engine |
| Production runs (§15) | A start (or resume) notifies production planning and the production supervisor; the alert clears when the run stops. A hold of a running job notifies the production manager with the hold reason, note, material condition, resume condition and output so far; it clears when the hold ends. | Engine → planning, production manager |
| Initial QC (§15–16) | A completed run gives QA one **initial QC** task. It closes only when every produced kilogram has a QC decision (approved or rejected); kilograms awaiting plan results or rework keep it open, and kilograms held in a containment are covered by the containment task. A later increase in output opens a new cycle. | QA |
| Release for ageing (§16–17) | QC-approved output of an ageing route gives the ageing team a **material released for ageing** task (planning alerted). It closes when that much is loaded into treatment batches. If the material is packed without an ageing cycle and final QC, the task is withdrawn and QA and factory management get a critical alert. | Ageing (production) |
| Ageing cycle (§17) | Loading, start, end, interruption and review of each treatment batch are on the order timeline. A running cycle past its recipe's maximum soak plus a grace (setting, default 60 min) gives the ageing team an urgent **ageing cycle overdue** task. A reading outside the recipe range alerts QA, the production supervisor and factory management once per batch. An ended or interrupted cycle gives QA a **treatment review** task. | Ageing; QA |
| Final QC (§18) | Material that came out of a reviewed batch gives QA a **final QC** task. On `/quality/final-qc/[job]` QA records the results (hardness, tensile, yield, elongation, conductivity, dimensional and surface checks, samples tested), the method, the sampling plan, an optional certificate and verified temper, and the kilograms accepted and/or rejected. Kilograms not recorded stay awaiting final QC (held for investigation). Acceptance is refused when a measured value is below a minimum recorded on the profile, a check failed, or the verified temper differs from the profile temper; nothing is assumed where the profile is silent. Every kilogram recorded must carry a first-stage approval not yet used by an earlier final QC. Records are immutable. | QA, owner |
| Rejection and remelt (§18–20) | Rejected kilograms (including those the treatment review rejected) reverse the first-stage approval through the Phase 4 reversal action, oldest approval first, so dispatch readiness, packaging caps, supply to the order, the reproduction task and the remelt approval all follow without being rewritten. During that reversal the job's ageing loads do not count as material that has moved on (nor, after section O, does any packaging job that is only queued). Rejection is refused while the job has an open containment. Factory management, QA's supervisor and planning get a critical alert; packaging and planning are told what was released. | QA → factory manager / owner for remelt |
| QC route control (§16, §22) | Company setting, **default off**. When on: material is loaded for ageing only up to its first-stage QC approval (shown on the heat-treatment screen), and a job whose route needs ageing is packed only up to what final QC released (a packaging job is checked when packing starts, so the queue entry created by a completed run is not refused). | Owner, admin, factory manager |
| Lifecycle | New ageing domain (not required / not documented / awaiting ageing / in ageing / awaiting final QC / released), per-job quality flow on the order lifecycle, and the ledger lines awaiting ageing, in ageing, awaiting final QC and released by final QC. The next action moves from "pack" to loading the ageing batch or recording the final QC while that work is open. | — |

New table: `final_qc_records` (append-only; RLS read for internal staff; Realtime). New settings: `enforce_qc_route`,
`ageing_overdue_grace_minutes`. New task kinds: `initial_qc`, `ageing_release`, `ageing_cycle`, `ageing_review`, `final_qc`.
New RPC: `final_qc_command` (`queue`, `get`, `record_get`, `record`). Wrapped (renamed): `olo_command` (→ `private.olo_command_p4`),
`olo_verify_tasks` (→ `_b3`), `olo_run_all` (→ `_b3`), `olo_order_core` (→ `_b3`). Redefined with one added condition:
`olo_job_consumed_kg` (marked `Phase 5:`). New triggers on production jobs, QC inspections, treatment batches / inputs /
observations, production holds, containments and packaging jobs (statement-level evaluation, failures logged to
`olo_engine_errors`); two guards (ageing load, packing of unaged material) that act only when the control is on.
Pages: `/quality/final-qc` (waiting / recorded), `/quality/final-qc/[jobId]`; a link on `/quality`; the QC route control
and overdue grace on `/settings/orchestration`. Hindi: `lib/i18n/floor-quality-flow.ts` (parity-tested).
Tests: `tests/order-lifecycle-orchestration-phase5-sql.test.mjs` (11) and `tests/order-lifecycle-orchestration-phase5.test.mjs` (8).
Screen fixture: `scripts/olo-phase5-preview.mjs` (launch config `olo-phase5-screens`).

**Code review of Phase 5 (2026-11-24)**:
1. *Fixed:* the routing match read "Packaging" as an ageing step ("aging" inside the word); it matches whole words now.
2. *Fixed:* a completed mill-finish run creates a `scheduled` packaging job for its full output. It was counted as packed
   material, which hid the ageing task, raised a false "packed without ageing" alert and — with the control on — would
   have refused the run's completion. Only started packing counts now; the control checks packaging jobs when packing
   starts; a final-QC rejection is not blocked by the queued job (section O).
3. *Fixed:* the final-QC queue filtered on the job's summary stage, so a job with part still awaiting its first QC was
   not listed for the part waiting for final QC; it filters on the quantities now.
4. *Fixed:* a rejection under an open containment failed deep in the reversal with a confusing message; it is refused
   up front. Acceptance with a verified temper that differs from the profile temper is refused. Phase 5 tasks of a closed
   or cancelled order are withdrawn. The ageing-load refusal is shown as written on the heat-treatment screen.
5. *Fixed in section O (migration 20261124200000):* the Phase 4 QC reversal also counted the scheduled packaging job a
   completed mill-finish run creates, so it was refused until that queue entry was cancelled.
6. *Accepted:* evaluation is statement-level and re-reads every job with output in the last 60 days and every batch of
   the last 30 days; fine for one factory, to revisit if volumes grow. Mechanical rework after final QC is not modelled
   (retreatment is, through the treatment review): rejected material follows the existing disposition and remelt flow.
   Acceptance needs only the results the sampling plan calls for; a profile minimum with no recorded result is not
   enforced.

**Deployment notes for Phase 5**: apply after 20261123300000. No new environment variables. With the control off nothing
is refused that was allowed before; new tasks and alerts start at once. On apply, the first evaluation opens initial QC
tasks for runs completed in the last 60 days that still have kilograms without a QC decision, ageing tasks for approved
material of ageing routes, and review / overdue tasks for batches of the last 30 days — expect a one-time burst.
Operator gates: confirm the ageing requirement or temper on every profile (undocumented routes raise no ageing work);
decide when to switch on the QC route control; confirm the 60-minute overdue grace.

## O. QC reversal and the queued packaging job (migration 20261124200000)

Migration: `supabase/migrations/20261124200000_order_lifecycle_reversal_queued_packaging.sql` (not yet applied to hosted).

Completing a mill-finish run creates a `scheduled` packaging job for the run's full output ("queued after extrusion").
Phases 3–4 counted every packaging job that was not cancelled as material that had moved on past QC, so:

* QA could not reverse any approval of a completed run until someone cancelled that queue entry;
* revoking an earlier approval under a containment raised a recall alert ("already moved to … packaging") for material
  that had never been packed.

A scheduled packaging job has packed nothing: packaging jobs carry no QC cap, while bundles, packing lists and
dispatches are capped by approved kilograms.

| Change | Effect |
|---|---|
| `olo_job_consumed_kg` counts packaging jobs only once packing has started (`in_progress` or `completed`), for every caller | The reversal limit, the revocation recall alert and the final QC after ageing all ignore the queue entry. Packed and prepared bundles, started packaging and (outside a final QC) ageing loads still count. |
| `quality_reversal_command` is wrapped (Phase 4 command moved to `private.olo_quality_reversal_command_p4`) | After a reversal, a still-queued packaging job of the run that is larger than what stays approved (less packaging already started) is flagged: packaging and production planning are told to pack only QC-approved material and to correct or cancel the queue entry, and the order timeline records it. The reversal result lists it as `queued_packaging_over`. The packaging job itself is never changed. |
| Reversal history list (`/quality/reversals`) | Server-side search (reversal, approval batch, job, order, reason, reference), an outcome filter (rejected / rework) and sorting by date, kilograms or number, 10 per page; the column headings sort. The default list sends none of these options, so it still reads from a database without this migration. |

Tests: `tests/order-lifecycle-orchestration-queued-packaging-sql.test.mjs` (5).

**PR review fixes (PR #15, 2026-11-24)**, folded into the unapplied Phase 5 migration:
1. With the QC route control on, packing lines and prepared bundles of an ageing job were capped separately, so 500 kg
   dispatched directly plus 500 kg prepared could exceed a 500 kg final-QC release. One total now counts packing lines,
   prepared bundles not yet on a dispatch (a prepared bundle is marked dispatched before its packing line is written, so
   nothing counts twice) and stock made from the job (`private.olo_job_released_material_kg`).
2. Output moved into stock (`production_surplus`) escaped the cap and could then be reserved and dispatched; stock made
   from an ageing job now counts against its final-QC release, checked when the stock batch is written.
3. The reversal history and the final-QC lists lacked search, filters and sorting (`AGENTS.md` list-page rules); both now
   have them server-side (final QC: job / order / profile / record / method search, "only records with rejections",
   sort by date, job, kilograms awaiting ageing or final QC, accepted or rejected). The Phase 4 and batch 3 tests that
modelled "moved-on" material with a scheduled packaging job now use a started one; the Phase 5 migration no longer needs
its own exception for the queue entry.
**Deployment notes**: apply after 20261124100000. Behaviour changes only for runs whose packaging is still queued:
reversals that were refused become possible, and revocations no longer ask to recall unpacked material.

## P. Phase 6 — packaging and shipment (migration 20261125100000)

Migration: `supabase/migrations/20261125100000_order_lifecycle_orchestration_phase6.sql` (not yet applied to hosted).
Directive sections 22–25 and implementation phase 6 (packaging release, bundle QR traceability, finished-goods transfer,
invoicing). Dispatch release and logistics were built in Phase 3 (section J) and AP batch 4; this phase connects packing
to them and to the invoice.

| Area | What now happens | Who |
|---|---|---|
| Packaging release (§22) | What a job releases to packaging follows its route (Phase 5): the final QC after ageing for a route that needs ageing, the first-stage QC approval otherwise; a route that is not documented releases on the QC approval and says so. First-stage QC of an ageing route no longer raises the "Pack N kg released by QC" handoff — the material goes to the ageing team. A final QC that accepts kilograms raises the packaging handoff instead (key `final_qc_release:<record>`, sourced from the approval that still stands at commit, so the existing acceptance checks apply), with the customer's packing specification (else the company default): wrapping, max kg and pieces per bundle, interleaving paper, battens, notes. `/packaging/release` lists per job released, packed (bundles, packing lines, stock) and still to pack; held jobs separately. | QA releases; packaging packs |
| Bundle register and trace (§22–23) | Every prepared bundle has one physical state: packed, on a transfer, in finished goods, loaded (open loading session), dispatched, delivered — plus its issued invoice. Scanning a bundle label on `/scan` (the label carries the tag; an `EO2:bundle:` or `EO2:dispatch_package:` label works too) resolves it through the company-scoped command, warns when it already left or is held, and opens the trace. `/packaging/bundles` searches tags, orders, jobs, dispatches and invoices. `/packaging/bundles/[id]` shows order and customer, profile, production job (press, die), billets issued with their cast or supplier batch and heat, first-stage QC, ageing batches, final QC, any QC hold, packaging jobs, label prints, finished-goods custody, loading, dispatch (vehicle, LR, e-way bill, left, delivered) and invoices. A missing step is listed under "Missing records" (no billet issue, no QC approval, ageing route without final QC, route not documented, no invoice yet), never filled in. | QA, packaging, dispatch, stores, accounts, management |
| Finished-goods transfer (§23) | Packaging sends packed bundles (1–60) to an active factory or warehouse location; refused when a bundle is dispatched, loaded, already sent or in finished goods, from dealer stock, of a closed order, or held in QC containment (each named). Dispatch or stores scan each tag in — never the sender (owner excepted). A tag not on the transfer is refused and the screen names the transfer it is on. A transfer closed short records the rest as missing (reason required) and alerts factory management and the packaging and dispatch supervisors; a missing bundle can be found and sent again. The sender or a manager cancels a transfer before any receipt. Transfers are numbered `FGT-YYMM-####`; a replayed send returns the same transfer. Rows change only through the command. | Send: production, packaging, dispatch, managers. Receive: dispatch, stores, managers |
| Loading guard | A bundle on an open transfer is never loaded or put on a dispatch line. **Receipt control** (setting, default off): when on, only bundles received in finished goods load (loading scan and dispatch packing line both checked; the dispatch line locks the bundle first so a transfer sent at the same moment is serialised). | Database |
| Tasks | `fg_receipt` for dispatch when a transfer is sent (closes when received, closed short or cancelled). `fg_transfer` for packaging when packed bundles of an order stay outside finished goods longer than the reminder (default 8 h) — only once the factory has a holding location and has used transfers in the last 90 days (or turned the control on). `dispatch_invoice` for finance when a dispatch left the gate (last 60 days, not returned or damaged) without an issued tax invoice after the reminder (default 4 h; 0 = at once); the task names the invoice-draft state and blocker, never amounts, and closes when an invoice for that dispatch is issued; a later cancelled invoice opens a new cycle. | Engine |
| Order lifecycle | Ledger lines released for packing, still to pack, on transfer, in finished goods and invoiced; a domain "Packing release, finished goods and invoicing" (to pack / on transfer / in finished goods / awaiting invoice / invoiced). The next action moves to "Pack X of job J released by …" (packaging) and, when nothing else is pending, "Issue the tax invoice for dispatch D" (finance). | — |

New tables: `fg_transfers`, `fg_transfer_bundles` (RLS read for internal staff; no write grants; guard trigger; Realtime).
New view: `private.olo_bundle_register` (private). New settings: `fg_transfer_hours`, `invoice_due_hours`, `enforce_fg_receipt`.
New task kinds: `fg_transfer`, `fg_receipt`, `dispatch_invoice`. New RPC: `packaging_flow_command` (`release.queue`, `release.get`,
`bundles.list`, `bundle.trace`, `bundle.resolve`, `fg.locations`, `fg.candidates`, `fg.list`, `fg.get`, `fg.send`, `fg.receive`,
`fg.close`, `fg.cancel`). Wrapped (renamed): `olo_command` (→ `private.olo_command_p5`), `olo_verify_tasks` (→ `_p5`),
`olo_run_all` (→ `_p5`), `olo_order_core` (→ `_p5`), `handoff_for_inspection` (→ `_p5`). Redefined with the Phase 6 additions
marked: `olo_settings_for`, `olo_guard_workflow_task`. New triggers: guards on `loading_scans` and `packing_list_items`;
statement-level evaluation on prepared bundles, dispatches and invoices; a commit-time trigger on `final_qc_records`.
Pages: `/packaging/release`, `/packaging/release/[jobId]`, `/packaging/bundles`, `/packaging/bundles/[id]`,
`/packaging/fg-transfers`, `/packaging/fg-transfers/new`, `/packaging/fg-transfers/[id]`; cards on `/packaging`; the three
settings on `/settings/orchestration`; the new `bundle` scan type (`lib/qr`, `lib/actions/scan.ts`). Hindi:
`lib/i18n/floor-packaging-flow.ts` (parity-tested). Tests: `tests/order-lifecycle-orchestration-phase6-sql.test.mjs` (10) and
`tests/order-lifecycle-orchestration-phase6.test.mjs` (9). Screen fixture: `scripts/olo-phase6-preview.mjs` (launch config
`olo-phase6-screens`): send, scan-in with a wrong-transfer tag, close short and the trace were exercised in the browser,
English and Hindi, at 375 px.

**Code review of Phase 6 (2026-11-25)**:
1. *Fixed:* a fourth handoff source type (`final_qc_record`) failed the existing `tasks_handoff_shape_check`, and the
   acceptance and reconciliation functions treat unknown types as packaging jobs. The final-QC handoff is sourced from
   the approval it releases (type `quality_inspection`), under its own key.
2. *Fixed:* the final-QC handoff chose its source when the record was inserted, before the same command reversed
   approvals for the rejected part; it now runs at commit and names an approval that still stands (regression test).
3. *Fixed:* the dispatch-line guard read custody without locking the bundle, so a transfer sent at the same instant could
   slip past it; it locks the bundle first (the loading scan already did).
4. *Fixed:* the loading-scan statement trigger re-ran the whole engine on every scan for no task change; removed (the
   dispatch consumes the bundle and that update re-evaluates).
5. *Accepted:* the receipt task is assigned to the least-loaded dispatch person, which can be the sender when the sender
   is dispatch staff; the command still refuses their receipt and the department sees the task.
6. *Test updated:* the Phase 4 full-reversal scenario (a T5 job) asserted that the reversal withdraws the first-stage packing
   handoff; for a T5 job there is no such handoff any more, so it now asserts that no open packing handoff remains.
7. *Accepted:* the release queue derives each job's quality flow (jobs with output in the last 120 days); fine for one
   factory, to revisit with volume. Invoices linked to an order but not to a dispatch do not close a `dispatch_invoice`
   task — invoices are raised per dispatch in ExtrusionOS (one active invoice per dispatch).

**Deployment notes for Phase 6**: apply after 20261124200000 (Phase 5 and its follow-up must be applied first: this
migration wraps the Phase 5 functions). No new environment variables. Behaviour changes on apply: first-stage QC of a
profile whose route needs ageing stops raising the packaging handoff (open ones already raised stay); a bundle that is on
a transfer cannot be loaded; finance gets invoice tasks for dispatches of the last 60 days that left without an issued
invoice more than 4 h ago — expect a one-time burst. Transfer reminders start only once transfers are used.
Operator gates: create the holding location(s) under inventory locations; record customer (or company default) packing
specifications; confirm the 8 h transfer and 4 h invoice reminders; decide when to switch on the receipt control.

## H. Deployment

1. Apply after `20261119180000_foundry_scrap_receiving.sql` (already on hosted). No new environment variables.
2. The hourly job is picked up by the existing `autopilot-hourly` pg_cron schedule.
3. On apply, the first evaluation opens billet and die tasks for jobs already in the top of each press queue and sends
   their alerts. Expect a one-time burst on deploy.
4. Operator gates (management decisions): approve die preheat standards from the plant SOP; review department routing;
   decide when to switch on die preparation and preheat start control; confirm the 5/3 thresholds and SLAs.

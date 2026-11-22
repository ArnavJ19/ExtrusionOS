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
real-time refresh and Hindi labels for the tool-room and task screens. Still open:

* **QC ledger reversal**: QC dispositions are immutable (`guard_terminal_quality_inspection`), so a revoked earlier approval
  is held, not un-counted. Scrapping material already counted as approved needs a QC reversal record honoured by every
  approved-kg consumer (dispatch readiness, packaging caps, supply). Not built.
* **Automatic message transport**: WhatsApp Business / SMS gateways are not wired (`lib/communications/providers.ts`);
  staff send from their own app and record the message.
* Hindi on the remaining orchestration pages (clearance, containment, order lifecycle); the release validity (48 h) is
  fixed, not a setting.
* Concurrency was reasoned and lock-based, but PGlite runs one session, so concurrent tests were not executed.

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

## H. Deployment

1. Apply after `20261119180000_foundry_scrap_receiving.sql` (already on hosted). No new environment variables.
2. The hourly job is picked up by the existing `autopilot-hourly` pg_cron schedule.
3. On apply, the first evaluation opens billet and die tasks for jobs already in the top of each press queue and sends
   their alerts. Expect a one-time burst on deploy.
4. Operator gates (management decisions): approve die preheat standards from the plant SOP; review department routing;
   decide when to switch on die preparation and preheat start control; confirm the 5/3 thresholds and SLAs.

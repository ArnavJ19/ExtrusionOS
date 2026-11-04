# November Upgrade Batch 6 — Agent Handover

Date: 3 November 2026 (Asia/Kolkata)
Branch: `feat/nov-batch-4` (working tree; nothing from batches 4, 5 or 6 is committed)
Catalogue: [NOV_UPGRADES.md](NOV_UPGRADES.md) · Previous records: [Batch 4](NOV_UPGRADE_BATCH_4.md), [Batch 5](NOV_UPGRADE_BATCH_5.md)
Project rules: [CLAUDE.md](CLAUDE.md) (read it first; multi-tenant, RLS, no fake features, 10-row server pagination, additive migrations)

---

## 1. The task as given by the user

> Read NOV_UPGRADES.md and build 10 high-priority features. After each feature: (1) recheck it matches what
> was supposed to be built, (2) verify it, (3) create edge-case tests and test it before being confident,
> (4) audit everything. Don't run lint or other checks until absolutely necessary. When done, apply the
> migrations for all of them where needed.

"Apply migrations" means applying to the hosted Supabase project (see section 9). Batches 4 and 5 migrations
are also not yet applied to hosted, so they must go first.

---

## 2. Feature selection (done)

Batches 1–5 delivered delivery ranks 1–50. Batch 6 takes the next ten by delivery rank (51–60):

| Rank | ID | Feature | Complexity | Hub view key |
| --- | --- | --- | --- | --- |
| 51 | NOV-058 | Close orders through a coordinated final review | C4 | `closure` |
| 52 | NOV-063 | Track samples and first-piece approvals | C4 | `samples` |
| 53 | NOV-079 | Customer-specific packing instructions and labels | C4 | `templates` + `labels` |
| 54 | NOV-021 | Check delivery feasibility before promising a date | C5 | `promises` |
| 55 | NOV-027 | Trace material from source to customer | C5 | `trace` |
| 56 | NOV-068 | Split and combine physical bundles with traceability | C5 | `bundles` |
| 57 | NOV-081 | Make page headers more compact | C1 | UI only (no SQL) |
| 58 | NOV-090 | Keep table headings and identifiers visible | C1 | UI only (no SQL) |
| 59 | NOV-008 | Use sensible visible defaults | C2 | `user_form_defaults` + form UI |
| 60 | NOV-060 | Review the whole journey with the people involved | C2 | `journeys` |

Full catalogue text for each: `NOV_UPGRADES.md` sections `### NOV-0xx`.

---

## 3. Architecture (copy of the batch 5 pattern — follow it exactly)

Batch 5 is the template. Study these before continuing:

| Batch 5 file | Batch 6 equivalent | State |
| --- | --- | --- |
| `supabase/migrations/20261103300000_november_assurance.sql` | `supabase/migrations/20261103400000_november_lifecycle.sql` | **Written, replays cleanly, runtime-untested** |
| `lib/workflow/assurance.ts` | `lib/workflow/lifecycle.ts` | **Written, not typechecked** |
| `lib/workflow/assurance-form.ts` | `lib/workflow/lifecycle-form.ts` | Pending |
| `lib/actions/assurance.ts` | `lib/actions/lifecycle.ts` | Pending |
| `components/modules/assurance/action-center.tsx` | `components/modules/lifecycle/action-center.tsx` | Pending |
| `components/modules/assurance/mutation-form.tsx` | `components/modules/lifecycle/mutation-form.tsx` | Pending |
| `components/modules/assurance/record.tsx` | `components/modules/lifecycle/record.tsx` | Pending |
| `app/(dashboard)/tasks/assurance/{page,layout,loading,error}.tsx`, `database/`, `new/`, `[view]/[id]/` | `app/(dashboard)/tasks/lifecycle/...` (same structure) | Pending |
| `scripts/lib/nov-batch5-fixture.mjs` | `scripts/lib/nov-batch6-fixture.mjs` | Pending (design in section 7) |
| `scripts/lib/nov-batch5-actions-fixture.mjs` | `scripts/lib/nov-batch6-actions-fixture.mjs` | Pending |
| `scripts/lib/nov-batch5-browser-fixture.mjs` | `scripts/lib/nov-batch6-browser-fixture.mjs` | Pending |
| `tests/nov-batch5-sql.test.mjs`, `nov-batch5.test.mjs`, `nov-batch5-browser.test.mjs` | `tests/nov-batch6-*.test.mjs` | Pending |
| `NOV_UPGRADE_BATCH_5.md` | `NOV_UPGRADE_BATCH_6.md` + link line in `NOV_UPGRADES.md` | Pending |

Protocol (identical to batches 3–5): one RPC `public.lifecycle_command(p_command, p_payload)` with commands
`list | detail | lookup | preview | commit | outcome | abandon`. Preview stores a request (`lifecycle_requests`)
with a server-generated review and an md5 fingerprint of `context.source || mutation`; commit re-runs
`private.lifecycle_context(..., p_lock => true)`, compares the fingerprint, then runs `private.lifecycle_apply`.
15-minute expiry. Only messages prefixed `NOV: ` are shown to users. Company and actor always come from the
session (`auth.uid()`, `private.get_current_user_company_id()`), never from the payload. Dealers are refused.

Hub route: `/tasks/lifecycle` (link it from `app/(dashboard)/tasks/layout.tsx` like `/tasks/assurance`).
Record hrefs returned by SQL already use `/tasks/lifecycle/<view>/<id>`.

---

## 4. What exists now (files touched in batch 6)

### 4.1 `supabase/migrations/20261103400000_november_lifecycle.sql` (1,831 lines)

Status: **replays cleanly on the full local chain (287 files applied, 0 failures)** using PGlite.
PL/pgSQL bodies are only checked at run time, so every function still needs exercising by tests.
The migration is assembled from five scratch parts (`m1.sql`–`m5.sql` in the session scratchpad); **edit the
migration file in the repo directly from now on** — the scratch parts are disposable.

Contents in order:

1. **Tenant keys / indexes** (`create unique index if not exists ... (company_id,id)` on referenced tables, plus
   lookup indexes).
2. **Stock status widening (NOV-068):** a DO block drops whatever check constraint on
   `profile_stock_batches` contains `(status = ANY` (locally named `profile_stock_status_check`; hosted name may
   differ) and re-adds `profile_stock_status_check` allowing `'transformed'` in addition to
   `available,reserved,dispatched,rejected,scrap`. **Follow-up required:** add `"transformed"` to
   `ProfileStockStatus` / `profileStockStatuses` in `types/app.ts:58` and `:72`, and grep inventory UI/reports for
   status handling and stock totals that sum without a status filter.
3. **Tables** (all with `company_id`, composite tenant FKs `(company_id,id)`, RLS enabled, direct writes revoked,
   tenant+role read policy `lifecycle_tenant_read`):
   - NOV-058: `order_closures` (one active per order via partial unique index; snapshot `readiness`, `carried`,
     `previous_stage`, reopen fields), `order_closure_carries` (item_key `^(return|exception|change):<uuid>$`).
   - NOV-063: `sample_requirements` (order, customer, profile, optional die and `drawing_revisions` row, reason,
     pieces, authority `customer|internal`, `gates_production`, `response_days`), `sample_events`
     (`produced|measured|sent|lost|approved|conditional|rejected|clarification|invalidated|withdrawn`, iteration,
     job, tag, location, recipient, expected_response, customer_contact, limit_kg, evidence).
   - NOV-079: `packing_label_templates` (scope `company|customer|project|order`, revision, `draft|approved|superseded`,
     instructions, `max_bundle_kg`, `max_pieces`, `spacer_required`, `wrapping`, `label_fields` from a fixed
     business-safe allow-list, approver ≠ creator, one approved per scope target), `packing_label_prints`
     (per prepared bundle, print_number, reason `initial|reprint|damaged|relabel`, one active, payload snapshot,
     observations, deviation).
   - NOV-021: `delivery_promises` (tranches 1–4 `{date,kg}`, verdict `feasible|at_risk|infeasible|incomplete`,
     evaluation snapshot, status `proposed|accepted|withdrawn|superseded`, `expires_at` (72 h),
     `previous_expected_date`; one accepted per order).
   - NOV-027/068: `material_lineage_links` (explicit edges; `basis` `transformation|evidenced_mapping`),
     `trace_investigations` (snapshot graph), `trace_holds`, `bundle_transformations` (`split|merge`, input/output
     kg, variance ≤ 0 with reason, reversible), `bundle_transformation_lines`.
   - NOV-060: `journey_reviews`, `journey_annotations` (private flag; **no direct read grant**, projected only via
     detail), `journey_actions`, `journey_measures` (unique per phase+metric; never overwritten).
   - NOV-008: `user_form_defaults` (company+user scoped; keys `production.machine_id`, `production.shift`,
     `dispatches.transporter_name`; own-row read policy).
   - Shared: `lifecycle_requests`, `lifecycle_events` (no direct read).
4. **Role matrix:** `private.lifecycle_view(action)`, `private.lifecycle_read_allowed(role, view)` (view `null` =
   any internal role), `private.lifecycle_action_allowed(role, action)`. Mirrored in `lib/workflow/lifecycle.ts`.
5. **Domain functions:**
   - `private.closure_readiness(company, order, kind)` → items `{key, domain, label, owner, href, detail, blocking,
     carriable, carried}`: unrecorded kg, undispatched remainder (resolved by existing
     `order_delivery_short_closures`), open jobs, finishing at vendor/planned, active reservations, undispatched
     prepared bundles, undeparted/undelivered dispatches, departed-but-uninvoiced dispatches, draft invoices,
     receivables (blocking only for `final`), batch 5 delivery exceptions / return authorizations / change
     proposals (carriable), uninspected connected return receipts.
   - `private.guard_closed_order_activity()` trigger `zzz_guard_closed_order` on INSERT into `production_jobs`,
     `dispatches`, `finishing_jobs`, `prepared_physical_bundles`, and INSERT/UPDATE OF status on
     `profile_stock_reservations` (active): refused only while an `order_closures` row with `status='closed'` exists
     (legacy closed orders are unaffected).
   - `private.sample_state(company, requirement)` (latest non-`measured` event; `renewal_needed` when invalidated or
     bound drawing revision is superseded/withdrawn) and trigger `zzz_guard_sample_approval` on `production_jobs`
     (first start planned/ready → in_progress): gated lines need approval; sample jobs may run; die must match;
     conditional approval caps started planned kg.
   - `private.label_template_for(company, order)` (order > project > customer > company) and
     `private.label_payload(company, bundle, template)` → `{fields, missing, overflow(>40 chars), net_kg, pieces}`.
     Never reads prices/cost columns.
   - `private.promise_order_need(company, order)` and `private.promise_evaluate(company, order, tranches, exclude)`:
     daily free capacity for 121 days on compatible active presses (shift capacity − slots − batch 5
     `private.capacity_windows` unavailability), minus unscheduled need of other accepted promises (claims, no
     double counting), finishing lead days from `factory_finishing_lead_times` (missing → `incomplete`), billet
     shortage → `at_risk`, past/too-short → `infeasible`; returns checks per tranche, assumptions,
     `earliest_full_date`. Uses arrays (no temp tables) so it can stay `stable`.
   - `private.trace_label`, `private.trace_step(company, type, id, forward)` (edges only from real keys: billet
     batches/billets/issues → jobs → stock, finishing, inspections, prepared bundles → packing items → dispatch →
     customer, returns, receipt releases, plus `material_lineage_links`), `private.trace_graph` (BFS both directions,
     depth 8, 200-node cap, visited set, "unlinked historical source" markers).
   - `private.journey_timeline(company, order)` (quote, order, stage history, job status history, dispatch,
     invoice, payment; gaps listed as missing; ≤ 60 events).
6. **Read model** `private.lifecycle_rows(company, actor, role, view, state, id)` for all 8 views (row shape
   identical to batch 5: `id,label,status,owner,due_date,summary,source_href,details`).
7. **Actions** (29) — `private.lifecycle_assert_shape`, `private.lifecycle_context`, `private.lifecycle_apply`:
   `closure.carry|close|reopen`, `sample.require|record|decide|invalidate|withdraw`, `template.create|approve`,
   `label.pack|reprint`, `promise.propose|accept|withdraw`, `trace.open|link|hold|close`,
   `bundle.split|merge|reverse`, `journey.open|annotate|action|progress|measure|close`.
   Notable server-only rules: final closure only owner/admin/accounts, operational only
   owner/admin/sales_manager/factory_manager; internal sample decisions only quality/factory_manager/owner/admin;
   customer decisions need `customer_contact`; packing deviation only owner/admin/dispatch_manager; promise accept
   updates `orders.expected_dispatch_date` to the last tranche and stores the previous date; journey action
   progress by action owner, review owner or owner/admin/factory_manager.
8. `private.lifecycle_lookup` (kinds: `orders` (filter = view), `profiles`, `dies`, `drawing_revisions`, `jobs`,
   `customers`, `projects`, `stock`, `trace_nodes` (filter = node type), `employees`).
9. `public.lifecycle_command` (granted to `authenticated`) and `public.form_defaults_command(load|set|clear)`
   (NOV-008; not the reviewed protocol because preferences are routine and reversible; validates the remembered
   press is an active extrusion press of the company).

### 4.2 `lib/workflow/lifecycle.ts` (written, not yet typechecked)

Views, descriptions, role mirrors (`canReadLifecycle`, `canUseLifecycleAction`), Zod `lifecycleMutationSchema`
(29 actions, strict, superRefine for conditional fields), `lifecycleCommandSchema`, row/list/detail/lookup/outcome
schemas, `parseLifecycleData`, status labels, `PROMISE_VERDICTS`, `LABEL_FIELDS`, `lifecycleRecoveryKey`.
**Must** match the SQL role matrix exactly — the role-mirror test (section 7) enforces it.

### 4.3 Nothing else changed for batch 6.

Pre-existing uncommitted changes from batches 4 and 5 are in the tree (see `git status`); do not revert them.

---

## 5. Bugs already found and fixed while writing the migration

- `select x day` is a syntax error (DAY is not a bare column label) → renamed to `on_day`.
- Temp tables inside a `stable` function are not allowed → replaced with arrays + `unnest`.
- The stock status constraint is named `profile_stock_status_check` locally (not `profile_stock_batches_status_check`) → drop by definition pattern.
- Labels view lateral alias ambiguity (`pay`) → single lateral `pl`.
- Promise status check would block withdrawing an accepted promise → `check(status<>'accepted' or accepted_at is not null)`.

### Known items to re-examine during testing (not yet verified)

1. `orders` update triggers when the definer updates `current_stage` (closure/reopen) and
   `expected_dispatch_date` (promise accept): `z_guard_order_workflow_writes`, `zy_guard_direct_order_snapshots`,
   `derive_order_value_from_quote`, `handle_order_billet_requirements` (rebuilds billet requirements on closed).
   If a guard refuses, the commit becomes `rejected` with a generic message — check and adapt.
2. `astra_reserved_stock` (`private.guard_reserved_stock_capacity`) on stock UPDATE to `'transformed'` and
   `a_guard_profile_stock_batch_origin` 10 % weight reconciliation on split/merge output INSERTs.
3. `closure.close` / `closure.carry` messages: `'NOV: This order is already % .'` has a stray space — fix.
4. Merge tag-uniqueness query in `lifecycle_context` contains a harmless `and not (s.id=any(v_ids) and false)`;
   `journey.progress` contains `(ja.status='open' and false)` — simplify.
5. `sample.record` uses `coalesce(btrim(p_mutation->>'evidence'),n)`; evidence is required by shape so fine.
6. `lifecycle_rows` for `promises` re-evaluates accepted promises per row (bounded but check timing).
7. `trace_step` for `dispatch` backward returns up to 100 packing items; graph cap 200 — confirm truncation flag.
8. Closure readiness treats any departed dispatch without a non-draft, non-cancelled invoice as unbilled; confirm
   with how invoices link (`invoices.dispatch_id`).

---

## 6. Pending work, in order

1. **Fixture** `scripts/lib/nov-batch6-fixture.mjs` (design below) and **SQL tests** `tests/nov-batch6-sql.test.mjs`
   — run per feature, fix the migration until green. Command:
   `node --no-warnings --test --experimental-strip-types tests/nov-batch6-sql.test.mjs`
2. `lib/actions/lifecycle.ts` (copy `lib/actions/assurance.ts`; RPC `lifecycle_command`; unavailable message
   "requires the November batch 6 database upgrade"; revalidate `/tasks/lifecycle`, `/tasks`, `/orders`,
   `/production`, `/dispatches`, `/inventory`, `/quality`).
3. `lib/workflow/lifecycle-form.ts` (copy assurance-form; field types needed: text, note, number, boolean, date,
   lookup, plus array editors for `tranches`, `outputs`, `stock_batch_ids`, `label_fields`).
4. UI `components/modules/lifecycle/*` + routes `app/(dashboard)/tasks/lifecycle/*` (overview with status groups,
   10-row database, `new`, `[view]/[id]` detail with action disclosures and history). Detail extras:
   closure item list with owner + source links and carry buttons; sample event history; label preview with a
   working **Print label** (`window.print()` on a print-styled label block — must be real, not fake);
   promise tranche checks table, assumptions and reasons; trace graph as backward/forward lists with unknown
   markers and hold buttons per stock node; bundle lines with current status; journey timeline, annotations,
   actions, baseline-vs-trial comparison. Add the hub link in `app/(dashboard)/tasks/layout.tsx`.
5. **NOV-008 UI:** in `components/modules/operations/record-form-client.tsx` (`initialFormValues` at ~line 94
   silently sets date fields to business today): show origin labels ("Suggested: today's business date (IST)",
   "Your usual press"), mark deliberate overrides, add "Return to suggestion", load personal defaults via
   `form_defaults_command('load')` for `production.machine_id`, `production.shift`,
   `dispatches.transporter_name`, and a "Remember as my default" control calling `set`/`clear`.
   Put the pure precedence logic in `lib/forms/visible-defaults.ts` (source > customer/site > company > personal >
   system date; keep overrides unless incompatible; never default physical measurements, prices or approvals) and
   unit-test it. Use `getBusinessDateBoundaries()` from `lib/utils/business-date`.
6. **NOV-081:** add `density?: "default" | "compact"` to `components/layout/page-header.tsx` (compact: no
   "ExtrusionOS Pro" eyebrow, `text-2xl` title, `mb-4`, keep single `h1`, back link and wrapping actions). Use
   compact on database/new/detail routes of `/tasks/control`, `/tasks/assurance`, `/tasks/lifecycle`; audit before
   changing the default (156 PageHeader usages).
7. **NOV-090:** `components/data/data-table.tsx` desktop table: sticky `thead` (`sticky top-0 z-30 bg-white`,
   bordered shadow) inside a bounded-height scroll container (`max-h-[70vh] overflow-auto`) so it does not compete
   with the app header; sticky identifier column with opaque background, right border, and higher z-index on the
   header cell (`z-40`) where both apply; keep `scope="col"` and sort buttons; set `sticky: true` on the identifier
   column in `components/modules/operations/module-database-client.tsx` and
   `components/modules/dies/dies-database-client.tsx`. Pagination/sorting unchanged.
8. `types/app.ts`: add `"transformed"` stock status (see 4.1 item 2).
9. Unit/contract tests `tests/nov-batch6.test.mjs` and browser tests `tests/nov-batch6-browser.test.mjs`
   (375 px, no overflow, evidence PNGs in `docs/evidence/NOV_UPGRADES_BATCH_6/`).
10. Only then run, once: `npm run typecheck`, `npm run lint`, `npm run build`, `npm test`. Note from memory:
    running `npm test` regenerates older batches' evidence PNGs and `tsconfig.tsbuildinfo` — restore them with
    `git checkout -- docs/evidence/NOV_UPGRADES_BATCH_* tsconfig.tsbuildinfo` (excluding the new batch 6 folder).
11. Write `NOV_UPGRADE_BATCH_6.md` (same format as batch 5: selection table, per-feature recheck/edge/audit
    table, boundaries, data and security audit, verification table, remaining acceptance) and add a batch 6 line
    under the batch 5 line at the top of `NOV_UPGRADES.md`.
12. Apply migrations to hosted (section 9).

---

## 7. Test design

### 7.1 Fixture (`scripts/lib/nov-batch6-fixture.mjs`)

Build on batch 5: `const f = await createNov5Fixture()` (it replays the whole chain, which now includes the batch 6
migration, and seeds company, 16 role users, customer, profiles `AL-NOV5` (1.2 kg/m) and `AL-NOV5B` (compatible
press `PRESS-A`), orders `SO-NOV5-01` (line1 1000 kg, jobs job1 planned / job2 in_progress) and `SO-NOV5-02`
(line2 600 kg, job3 planned), dispatches D-NOV5-1 (bundles B1 300 kg, B2 200 kg) and D-NOV5-2 (B3 250 kg) departed
yesterday, presses PRESS-A/PRESS-B with 100,000 kg/day shifts 00:00–23:59 all weekdays, stock S1/S2/S3 available
at "Rack 4" (6 m pieces, 10/20/5 pcs, 72/144/36 kg), drawing DWG-NOV5-1, etc.). Reuse its `asUser`, `seed`,
`nextId`, `start/rollback` and add:

```js
const command = async (name, payload, actor = ids.owner) => (await f.asUser("select public.lifecycle_command($1,$2) data", [name, payload], actor))[0].data;
// prepare / commit / apply exactly as in nov-batch5-fixture.mjs
```

Seed extra rows with `set session_replication_role = replica` (IDs from `nid(300)` upward):
- Closure order `SO-NOV6-C` stage `delivered`, one line 500 kg, completed job, departed+delivered dispatch with a
  500 kg packing item, an issued invoice (`status 'sent'`, `grand_total`, `amount_paid 0`, `balance_due`,
  `credited_amount 0`, `dispatch_id`, `order_id`, `customer_id`).
- Promise order `SO-NOV6-P` stage `extrusion_planned`, 2000 kg line (`finishing_type 'mill_finish'`), planned job.
- Two dies for profile AL-NOV5B (sample die vs changed die); a `customer_projects` row + `customer_project_links`
  (`entity_type 'order'`) for template precedence.
- Prepared bundle(s) for SO-NOV5-01 from job2 (`source_kind 'production'`, `source_line_id = job id`, `payload '{}'`).
- Foundry billets for traceability: `source_type 'outsourced'` needs an `outsourced_billet_batches` row (or
  `'in_house'` with a `foundry_batches` row); set `production_job_id = job2`. Stock bundle with
  `origin_type 'production_surplus'`, `production_job_id = job2`.
Required NOT-NULL columns were queried and are listed in this session's log; re-query with
`information_schema.columns where is_nullable='NO' and column_default is null` if an insert fails.

### 7.2 SQL tests (`tests/nov-batch6-sql.test.mjs`) — minimum edge cases per feature

- **Shared:** role mirror for 13 roles + `dealer_admin`, `dealer_staff` × 8 views × 29 actions vs SQL; every view
  parses with `lifecycleListSchema`; dealer and foreign-company actors refused; injected `company_id`/unknown keys
  refused; preview records nothing; changed source between preview and commit → rejected; expired review; replay
  of same request_id returns same outcome; `outcome`/`abandon` for unknown request → `not_recorded`.
- **NOV-058:** blocked by open job / reservation / vendor finishing / undelivered dispatch / unbilled dispatch /
  draft invoice / prepared bundle / uninspected return; short-closed remainder counts as resolved; operational close
  with outstanding receivable succeeds and warns; final close refused while balance due and refused for
  sales_manager; carry only carriable items; after close new production job / dispatch / reservation INSERT fails
  with the closure message; reopen by owner restores previous stage and withdraws carries; quantity difference
  stays visible; concurrent dispatch (lock) scenario.
- **NOV-063:** gated job cannot start before approval; sample job may start; measured required before sent; customer
  approval without contact refused; internal decision by sales refused; duplicate decision refused; conditional
  limit enforced on second job; changed die refused; lost sample → produce again (iteration 2); drawing revision
  superseded → `renewal_needed`; overdue response status; withdraw removes gate.
- **NOV-079:** no template → refused; creator cannot approve own template; precedence order > project > customer >
  company; template requiring `customer_profile_ref` not recorded → `fields_missing` refused; value > 40 chars →
  overflow; packing over max pieces/kg or missing spacers refused without deviation; deviation by dispatch staff
  refused, by dispatch_manager accepted; reprint keeps payload and increments print number; newer approved template
  → `relabel_needed`, reprint becomes `relabel`; label payload contains no price/cost keys.
- **NOV-021:** feasible with ample capacity; infeasible when capacity consumed by existing slots; maintenance block
  removes a day; incompatible press excluded; missing finishing lead time → incomplete; billet shortage → at_risk;
  split tranches must increase and not exceed remaining; another accepted promise claims capacity; expired proposal
  cannot be accepted; accept updates `expected_dispatch_date` and supersedes earlier accepted promise; proposal
  reserves nothing (no reservation/slot rows created).
- **NOV-027:** backward from stock reaches job and billets; forward from billet reaches dispatch and customer; job
  with no billet issue shows an unknown marker; evidenced link added then traversed; mapping job→stock with a
  different profile refused; cycle safety (split then reverse creates a loop of links — traversal terminates);
  200-node cap; hold only stock in the snapshot and only available+released; foreign tenant node unavailable.
- **NOV-068:** split conserves pieces; output kg > input refused; deficit without reason refused, with reason
  recorded as variance; held / reserved / packed input refused; duplicate tag (existing stock, dispatch history, or
  input's own tag) refused; merge of different profile/finish/location/owner refused; merge of production stock
  from different jobs refused; old bundle becomes `transformed`; lineage links created; reverse restores inputs
  only if outputs unused; reverse after output reserved refused; lost response replay does not double-split.
- **NOV-060:** baseline cannot end in future; private annotation hidden from another reader but visible to owner
  and admin; trial measure needs same-metric same-unit baseline; measures not overwritten; action progress by
  non-owner refused; close refused with open actions or done actions without trial vs baseline; timeline lists
  missing milestones.
- **NOV-008:** `form_defaults_command` set/load/clear; inactive or foreign press refused; another user does not
  see the default; unknown form key refused.

---

## 8. Verification state

| Check | Result |
| --- | --- |
| Migration chain replay (PGlite, scratch script) | **Pass** — 287 files, 0 failures |
| Batch 6 SQL runtime tests | Not written |
| TypeScript / lint / build / full `npm test` | Not run (user asked to defer) |
| Hosted migrations | Not applied (batches 4, 5, 6 all pending) |

Quick replay script (put in your scratchpad, not the repo):

```js
import { replayMigrationChain } from "file:///C:/Users/arnav/OneDrive/Desktop/ExtrusionOS/scripts/lib/migration-chain-replay.mjs";
const r = await replayMigrationChain(); console.log(r.applied, r.failures); await r.db.close();
```
(On Windows, ESM imports of absolute paths need the `file:///` prefix.)

---

## 9. Applying migrations to hosted (final step)

Hosted project: **AlExMS, ref `pkawmdxtmsdgigsehcmb`** (auto-pauses; restore it first if paused). Use the Supabase
MCP tools (`list_migrations`, `apply_migration`, `execute_sql`, `get_advisors`).

1. `list_migrations` and reconcile with local `supabase/migrations/` (memory says hosted had all EOS migrations as
   of 2026-11-02; batch 3 `20261103100000_november_coordination.sql` status must be checked too).
2. Apply in order, each only after its local tests are green:
   `20261103200000_november_operations_control.sql` (batch 4) →
   `20261103300000_november_assurance.sql` (batch 5) →
   `20261103400000_november_lifecycle.sql` (batch 6; depends on batch 5 tables `drawing_revisions`,
   `delivery_dispositions`, `return_authorizations`, `order_change_proposals`, `incoming_stock_releases` and
   functions `private.drawing_state`, `private.capacity_windows`, `private.assurance_text/number/date`).
3. Before batch 6 on hosted, confirm the stock status constraint definition with
   `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid='public.profile_stock_batches'::regclass and contype='c'`.
4. After applying: run `get_advisors` (security + performance), smoke-call `lifecycle_command('list', ...)` for
   each view as an internal user, and record results in `NOV_UPGRADE_BATCH_6.md` and the memory file.
5. Applying to hosted is outward-facing and hard to reverse — the user already asked for it, but confirm the
   hosted ledger state with them if anything is unexpected.

---

## 10. Scope boundaries to state in the batch record

- NOV-058: operational closure keeps receivables in accounts; final closure needs zero balance; the guard applies
  only to orders closed through this review.
- NOV-063: approval proves the sample, not the batch; jobs already started are not stopped.
- NOV-079: labels for packed (prepared) bundles; printing is browser print of a business-safe payload; repacking of
  stock bundles uses NOV-068.
- NOV-021: a proposal reserves nothing and creates no slots; acceptance changes only the order expected dispatch
  date; capacity is configured shift kg, not optimisation.
- NOV-027: only recorded identities are traversed; similar dates/codes are never matched; holds go through QC
  status, release through the existing stock workflow.
- NOV-068: whole input bundles only (no partial split leaving a remainder on the same tag); outputs inherit
  profile, finish, alloy, temper, owner, origin and QC state.
- NOV-060: a review record over existing events; it does not certify process improvement.
- NOV-008: personal defaults for three fields; company and customer tiers are supported by the precedence helper
  but have no editing UI yet.
- NOV-081 / NOV-090: shared component changes; no data change.

---

## 11. Memory to update after finishing

Add/refresh `C:\Users\arnav\.claude\projects\C--Users-arnav-OneDrive-Desktop-ExtrusionOS\memory\` with a
`extrusionos-nov-batch6-status.md` entry (IDs, migration name, applied state, test counts) and a line in
`MEMORY.md`; update the batch 4 memory if hosted application of 20261103200000 happens.

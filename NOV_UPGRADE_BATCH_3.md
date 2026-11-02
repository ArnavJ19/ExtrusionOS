# November Upgrade Batch 3

Date: 3 November 2026 (Asia/Kolkata)
Catalogue: [NOV_UPGRADES.md](NOV_UPGRADES.md)
Base commit: 9573426cac124d96acce7d55c6ab9e7e7fd6a360
Scope commit: c9c9317 (published before application implementation)
Implementation commit: 512682abb02583a9a3c2a68d1f051b706283783b
Integrated baseline: 29b30ae preserves main security fix 1b8daec without changing its source.
Development checkout: .worktrees/codex-v1
Pull request: [PR #4](https://github.com/ArnavJ19/ExtrusionOS/pull/4)
Delivery state: ten bounded U1/N1 feature slices implemented and locally verified. Development domain, browser, security, regression, lint, type and production-build checks passed. Main working-checkout build and focused checks also passed. Hosted rollout and employee acceptance remain separate gates.

## Selection and gap audit

These are the ten remaining C3, U1 (first priority), N1 (essential) entries after
November batches 1 and 2, following catalogue delivery ranks 18-25 and 28-29.
All had partial foundations. The implementation extends existing invoice/receipt,
task/handoff, delegation, request and specification-change boundaries.

| ID and original idea | Implemented employee flow | Recheck and edge evidence |
| --- | --- | --- |
| NOV-040: accounts collection workflow | Finance-only invoice-linked promises, owner, original/current dates, contact/reschedule history, disputes, due/missed/partial queues and current invoice balance. Actual cash-receipt progress is separate from adjustments and credits. | Actual grouped receipt posting/reversal, partial fulfillment, non-cash adjustment, settlement/reopening, duplicates, changing balances/owners, India dates and finance/tenant isolation. |
| NOV-041: accountable order coordinator | One accepted coordinator per order; reasoned proposal and employee acceptance. The existing coordinator remains responsible until replacement acceptance. Order details display responsibility and transfer state. | Unassigned/imported orders remain explicit; wrong/inactive/foreign employee, stale proposals, role restrictions and retained transfer history. |
| NOV-043: shared priority policy | One versioned ordering in the coordination/order agenda: existing urgent/high/normal/low priority, dispatch due date, stable ID. Reasoned overrides retain history; same-machine/date competing orders are counted without moving schedules. | Stable ties, due dates, unchanged stage/readiness, denied overrides and changed-source review. Existing priority meaning is preserved. |
| NOV-046: department service expectations | Published receiving-contract revisions define prerequisites, evidence and an explicit elapsed-hour target. Future handoffs retain their revision beside existing acceptance/return controls. | Two revisions retain different bindings; expected versus accepted kg remain distinct; no invented contract for historical handoffs; existing guarded acceptance/return regressions apply. |
| NOV-048: backup owners | A supervised window requires backup acknowledgement before creating an existing all-open delegation. Current/incoming eligible tasks use that delegation; synchronization/cancellation retain task outcomes. | Wrong party, overlap/chain, foreign/inactive employee, wrong team, scheduled activation, incoming tasks, expiry, completed/reassigned work and inactive-primary fallback. Permissions/competency controls are unchanged. |
| NOV-049: daily coordination | Bounded live order/decision agenda with as-of snapshot, source availability and live links. Decisions create assigned, dated tasks; unresolved tasks carry forward with original identities. | Repeated meetings, duplicate unresolved decisions, source failure, completion, stale retained snapshots, owners and tenant isolation. |
| NOV-050: trackable team requests | Existing order requests gain needed-by date, criteria, acknowledgement, clarification and retained responses. Recipient resolution and requester withdrawal remain separate; existing reminders/preferences apply. | Duplicates, wrong party, unavailable recipient, changed source, resolution/withdrawal race, stopped reminders and private party access. |
| NOV-056: master-data stewardship | Primary/backup stewardship for profile section weight, evidence-backed proposals and independent review. Existing owner/admin specification approval remains mandatory for open-work profiles. | Duplicate/stale proposals, drawing revision changes, reporter self-approval, edit authority, affected-work review, existing approval audit and preserved order-line snapshots. |
| NOV-097: review final consequences | Server-generated consequences bind a source fingerprint to the same rules used at commitment. Changed sources/employees and expiry reject the review. Preview creates no operational transaction. | Source changes, expired reviews, duplicate confirmation, actor/request/payload identity, authorization loss and rejected writes. |
| NOV-098: retained action results | User/company-scoped original request marker, persistent confirmed/rejected result, authorized outcome reads, reload recovery and safe cancellation. Outcome reads serialize with commitment. | Response loss after actual commit, interrupted preview, repeated taps, reload, scope switch, malformed response, cache failure and authoritative not-recorded result. |

## Scope and operating boundaries

- Entry point: /tasks/coordination, linked from Tasks. Overview, ten-row
  server-paginated databases, create pages and detail/history pages are separate.
- Collections are a finance-restricted companion to invoices, rather than fields
  on sales-visible general commitments. Promises never post money or impose
  dispatch holds. Net cash change is not allocation of a named receipt to a
  promise. Current grouped receipt posting already requires exact, complete
  allocation; this batch does not add an unallocated-cash ledger. The existing
  receipt review workflow remains linked from collections.
- Priority policy labels the shared coordination/agenda scope. Specialized queues
  retain their operating purpose. This is not an optimizer, frozen-window control
  or customer-value scoring rule.
- Service-contract descriptions guide employees. Existing database prerequisites,
  acceptance, returns and current quantity tolerances remain authoritative. The
  response clock uses elapsed hours including nights/holidays, without implicit
  business-hour calendars or retrospective contract backfill.
- Backup scope is the existing eligible all-open task queue and new assignments
  during the window. It does not transfer coordinator ownership, stewardship,
  financial authority or qualifications. Future activation needs existing
  delegation synchronization or the explicit reconciliation action. No hosted
  scheduler is installed.
- Meetings retain at most ten priority orders and ten unresolved decisions, with
  finance data excluded. They do not claim coverage of every shortage, quality
  hold or capacity-planning source.
- Requests pilot existing general order requests. The existing one-open-request
  rule per requester/recipient/source remains intact. Formal approvals and
  department handoffs retain separate guarded lifecycles.
- Stewardship pilots profile section weight only. Open-work changes route through
  approve_profile_spec_change; existing source-change review handles affected task
  evidence. Issued documents/order-line snapshots are preserved. Review unfinished
  drafts before using corrected master data.
- Review/recovery covers the supported coordination actions in this batch. It
  does not replace unrelated stock/payment/device/provider request protocols.
  Request markers retain identity only in session storage; outcomes remain in the
  database. Unsubmitted form values are not persisted across reload. Storage
  failure disables new consequential submissions explicitly.

## Data and security audit

Migration: supabase/migrations/20261103100000_november_coordination.sql.
It is additive. This task has not applied it to a hosted database; reconcile the live ledger separately.

New tables: order_coordinators, collection_promises, handoff_service_contracts,
handoff_service_snapshots, backup_coverages, coordination_sessions,
coordination_decisions, action_request_details, master_stewardships,
profile_corrections, coordination_requests and coordination_events.
Composite tenant foreign keys validate linked employees, orders, invoices,
profiles, tasks, requests, sessions, contracts and delegations. Relevant tenant
and queue indexes are included.

Every new table enables RLS and denies direct authenticated writes. Finance,
request-party, coverage-party and actor-owned outcome reads are restricted.
History is projected after the detail RPC verifies domain/party access. Anonymous
RPC execution and direct private implementation helpers are denied. Company and
actor identity come from the authenticated database session. The RPC rechecks
active/internal account, role and record access.

One retained request binds actor, tenant, exact mutation, source fingerprint and
expiry. A tenant advisory lock serializes this protocol; commitment locks existing
authoritative source rows and relevant employees. Rejected domain work rolls back
before its retained rejection is recorded. Only a confirmed database outcome
produces success. Cache failure does not change that outcome; outcome checks wait
on the same protocol lock.

No Storage rule, service-role use, public/customer/dealer projection, external
message integration or deployment configuration is added. Existing database
delegation/request/specification-approval functions remain the authority. No
operator action was executed against production during this implementation.

## Files and verification

New application sources:

- lib/workflow/coordination.ts; lib/actions/coordination.ts.
- components/modules/coordination/action-center.tsx; mutation-form.tsx;
  record.tsx; order-responsibility.tsx.
- app/(dashboard)/tasks/coordination/layout.tsx, page.tsx, loading.tsx, error.tsx;
  database/page.tsx; new/page.tsx; [view]/[id]/page.tsx.
- The additive migration named above.

Modified application sources: app/(dashboard)/tasks/layout.tsx,
app/(dashboard)/tasks/handoffs/page.tsx, app/(dashboard)/orders/[id]/page.tsx and
components/modules/tasks/department-handoffs.tsx. Documentation: this record and
its link in NOV_UPGRADES.md.

New tests: tests/nov-batch3.test.mjs, nov-batch3-sql.test.mjs and
nov-batch3-browser.test.mjs. Fixtures: scripts/lib/nov-batch3-fixture.mjs,
nov-batch3-actions-fixture.mjs and nov-batch3-browser-fixture.mjs. Browser checks
mount production components, the real server action and the replayed local SQL;
authentication, network, router and cache boundaries are synthetic.

| Verification | Result |
| --- | --- |
| Migration replay | Passed the full development chain in the final SQL fixture, including the separately integrated search-path fix and pre-existing unrelated KPI migration |
| Focused domain, real action and SQL/RLS scenarios | Passed 30 checks, including 150 varied priority-ordering cases |
| Browser interaction | Passed nine scenarios, including the final storage-failure case, inside the full suite |
| npm run typecheck -- --incremental false | Passed after the production build; typecheck.txt |
| npm run lint | Passed with no warnings/errors; lint.txt |
| npm run build -- --webpack | Passed in .next-upgrade-verify; 209 generated pages including the unrelated KPI route; build.txt |
| npm test | Passed: 2,959 tests, 76 suites, zero failures/skips; tests.txt |
| Focused final domain/action/SQL run | Passed 30 checks after integrating the separate main security fix; focused-domain.txt |
| Main working-checkout production build | Passed, 208 generated pages without the development-only KPI route; main-build.txt |
| Main focused domain/action/SQL checks | Passed all 30 checks, including the full main migration chain without the unrelated KPI migration; main-domain.txt |
| git diff --check | Passed on the scoped implementation commit |

Evidence: [docs/evidence/NOV_UPGRADES_BATCH_3](docs/evidence/NOV_UPGRADES_BATCH_3/).
Phone/enlarged-desktop captures are synthetic interaction evidence, not a hosted
signed-in deployment. Existing generated evidence/configuration/cache files were
copied before broad checks. Unrelated KPI/navigation, migration, acceptance,
audit and report work is excluded from the feature commit.

Broader checks were deferred until feature-specific checks passed. Chromium's
sandbox loopback denial and the sandbox's generated-build-directory EPERM were
environmental restrictions; the final local runs used loopback/filesystem access
and passed. The build retains the existing stale Browserslist-data warning; no
dependency update was introduced. Eleven regenerated development-checkout files
were restored from their verified pre-check copies, including pre-existing dirty
evidence. The independent main security migration was merged normally, preserving
its original commit and subsequent migration order.

The existing main checkout was fast-forwarded to the feature implementation and
merged security baseline, then built separately using synthetic public Supabase
values. Its 30 focused checks also passed. While this verification ran, separate
uncommitted form/mobile/shared-component fixes appeared in main. They do not touch
this batch's implementation files and are preserved/excluded from its commit.
Consequently main-build.txt describes that current working checkout, not a claim
that every concurrent working change is included in this source publication.
The main build's generated next-env declaration is restored to the captured
pre-build value when it still points to this verification output. Other concurrent
main source, evidence, configuration and cache changes are preserved.

Audit fixes include finance-only promises, cash versus non-cash progress,
unavailable recipients, profile-edit/specification approval authority,
drawing/source conflicts, stale reviews, refresh after recovery, empty action
disclosures and request persistence before submission. Original ideas/ratings
remain intact in the catalogue.

## Remaining acceptance

No hosted migration/deployment, real JWT/Storage exercise or employee pilot is
established by local checks. Independent competing PostgreSQL sessions remain a
rollout gate: PGlite executes local transaction/race scenarios on one connection.
The local Docker daemon was unavailable, so no independent contention claim is
made.

Before rollout, reconcile the hosted ledger and apply prerequisites in order;
review migration/application release separately. Pilot with actual accounts,
sales and operations users in two companies. Verify partial/reversed payments,
coordinator acceptance/departure, priority conflicts, actual handoff contracts,
coverage/expiry, repeat meetings, request clarification/closure and an open-work
profile correction preserving snapshots. Interrupt/reload a confirmation on a
physical phone and verify one authoritative outcome. Record policy-owner approval,
employee findings and deployment revision before extending the pilot or claiming
catalogue-wide completion.

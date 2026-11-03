# November Upgrades: Detailed Product and Organization Catalogue

Created: 2 November 2026 (Asia/Kolkata)
Document type: Internal planning reference and implementation specification
Audience: Business owner, department heads, product designer, developers, QA, and rollout leads
Scope: Exactly the 100 numbered suggestions made in this chat, retained as five batches of 20
Status: Proposed targets and extension plans; this document does not implement or deploy them

Implementation records: [November batch 1](NOV_UPGRADE_BATCH_1.md) covers the first ten selected U1/N1 interface and workflow improvements (NOV-016, 083, 084, 085, 086, 088, 091, 092, 093, and 099). That record separates implemented scope, local verification, and outstanding hosted/employee acceptance. The original 100 targets and their ratings below remain the planning reference.

[November batch 2](NOV_UPGRADE_BATCH_2.md) covers ten further U1/N1 delivery slices: NOV-001, 002, 004, 006, 012, 018, 094, 095, 096, and 100. Its delivery record tracks implementation, edge verification and the remaining rollout acceptance separately.

[November batch 3](NOV_UPGRADE_BATCH_3.md) covers the next ten U1/N1 coordination and responsibility slices: NOV-040, 041, 043, 046, 048, 049, 050, 056, 097, and 098. Its record distinguishes the implemented pilot, local verification, additive migration, and outstanding hosted/operator acceptance.

[November batch 4](NOV_UPGRADE_BATCH_4.md) covers the next ten U1/N1 cross-module slices: NOV-005, 007, 013, 015, 022, 028, 031, 042, 051, and 057. Each is a bounded pilot of a C4 target; its record lists what each slice covers, its boundaries and the remaining hosted/employee acceptance.


## Purpose and boundaries

Employees should be able to identify their next useful task, find the right source record, enter new facts once, understand a decision, and pass complete work to the next team. Management should be able to see commitments, blockers, material movement, ownership, and outcomes without assembling a parallel spreadsheet.

This catalogue turns the 100 suggestions into reviewable delivery scopes. It explains desired behavior, employee journeys, implementation steps, data and permission boundaries, technical complexity, business urgency, acceptance scenarios, dependencies, and an initial pilot for each idea. Examples are illustrative; prices, tolerances, timings, approval limits, and factory process settings require the relevant business owner's approved rules.

The IDs in this file are independent of [UPGRADE_EOS.md](UPGRADE_EOS.md). NOV-021 means the twenty-first suggestion in this chat; it is not feature 21 of the older catalogue. Several November targets extend older work. Preserve all 100 entries for traceability, but combine shared engineering into coordinated work packages. Do not estimate or build them as 100 unrelated systems.

These are not 100 confirmed defects. A feature can have a useful foundation and still need broader coverage, employee acceptance, or deployment. Terms such as "complete" inside a target or acceptance criterion describe intended behavior, not a delivery claim. No urgency label in this document establishes a confirmed production incident.

## How to read and maintain this file

- Use the complexity register to find bounded changes that can be delivered first.
- Use the urgency reading order to find high-need work, including difficult foundations that should begin early.
- Follow dependencies before enabling an enforcing control; implement a read-only or advisory slice when its inputs are incomplete.
- Use each stable NOV ID in implementation tickets, evidence, decisions, and later delivery records.
- Review proposed ownership with the relevant department head before implementation. Role titles below are recommended owners, not assigned individuals.
- Update the scope, evidence date, acceptance results, and delivery state after a change. Keep source inspection, local checks, signed-in staging, hosted migration state, deployment, physical reconciliation, and employee acceptance separately recorded.
- Reassess urgency after observing actual work. Frequent blocking, lost work, incorrect quantities, or changed customer requirements can move a scoped issue ahead of its parent feature's rating.
- Maintain this file with each approved delivery slice. Keep the original suggestion and stable ID even if its implementation is combined with another entry.

Navigation: [Ratings](#ratings-and-sorting) | [Source foundations](#current-source-foundations) | [Shared engineering](#shared-implementation-contract) | [Complexity register](#complexity-sorted-register) | [Urgency index](#urgency-first-reading-order) | [Original mapping](#original-conversation-mapping) | [C1](#c1-small-presentation-changes) | [C2](#c2-shared-interaction-improvements) | [C3](#c3-module-workflows-and-read-models) | [C4](#c4-cross-module-controls-and-transactions) | [C5](#c5-advanced-lifecycles-planning-and-integrations) | [Delivery and verification](#delivery-plan-and-verification) | [Sources](#external-design-and-engineering-references).

## Ratings and sorting

### Code complexity

The rating measures implementation difficulty, including validation, data changes, authorization, failure handling, meaningful tests, and migration compatibility. It is not a line-of-code count or an algorithmic Big-O claim. The rating applies to the full described incremental target using the current foundations. A pilot is deliberately smaller.

| Rating | Meaning | Typical technical boundary |
| --- | --- | --- |
| C1 - Low | Focused display refinement using already available authoritative data | Shared typography, formatting, presentation mappings, or small layout behavior; normally no schema change |
| C2 - Low to medium | Reusable interaction or page-composition change | Several consumers, responsive behavior, state preservation, and accessibility; occasionally a small preference or ownership field |
| C3 - Medium | Bounded module workflow or substantial read model | New domain states or metadata, server actions, indexed queries, evidence, or several coordinated forms |
| C4 - High | Cross-module operational control or transactional lifecycle | Source lineage, new guarded transitions, reservations, partial completion, concurrent writes, historical snapshots, or several schema changes |
| C5 - Very high | Advanced planning, integration, or broad material/financial lifecycle | Optimization, provider or hardware contracts, transformation lineage, dependency propagation, or several interacting ledgers |

C1 changes often fit a small patch. C4/C5 targets usually require multiple independently reviewable slices. Reliable effort estimates require a schema review, data sampling, an agreed business policy, and dependency/provider discovery. No calendar promise or additive estimate for all 100 features is established here.

Organizational effort is separate from code complexity. For example, a daily meeting agenda may be C3 to implement but needs sustained ownership; a compact header is C1 and has little policy work. Each entry identifies the additional operating decision or pilot.

### Urgency and need

| Urgency | Meaning | Recommended treatment |
| --- | --- | --- |
| U1 - First priority | Broad daily friction, ownership gaps, lost-work prevention, consequential data clarity, or core operational control | Audit the current scope first; close observed gaps in the next agreed delivery slices |
| U2 - Planned next | Material productivity or reliability improvement with useful existing workarounds | Schedule after its foundations and first-priority blocking issues |
| U3 - Later optimization | Valuable scale, automation, analysis, or convenience improvement | Begin after source data and core transaction behavior are dependable |
| U4 - Conditional | Specialized capability whose need depends on the actual operating model | Validate applicability before investing; promote if that process is frequent or consequential |

| Need | Meaning | Evidence to obtain |
| --- | --- | --- |
| N1 - Essential | Supports correct daily execution, reliable ownership, quantities, customer commitments, or accessibility | Observe representative work and verify the actual gap and its consequence |
| N2 - High value | Reduces repeated effort or improves management decisions | Measure frequency, time, errors, and current workaround cost |
| N3 - Context dependent | Important where a particular contract, equipment, site, or production process exists | Confirm operating volume, policy owner, provider/device access, and exception cases |

There are 44 U1, 39 U2, 9 U3, and 8 U4 entries under this initial assessment. These are prioritization recommendations, not findings that all 44 U1 targets are absent.

**Detailed-section sort:** complexity ascending, then urgency ascending, then need ascending, then stable ID ascending.

**Delivery-rank sort:** urgency ascending, then need ascending, then complexity ascending, then stable ID ascending. The resulting rank is a triage order, not a dependency-blind execution schedule. A prerequisite or a confirmed incident overrides simple numeric rank.

## Current source foundations

Initial inspection date: 2 November 2026. Main was at feac50ef7f0e037e0e86f3b878187b6de3141397; codex/v1 was at 41216c4be9c4bb44ea48c437e5126047498afe18 and contained unrelated working changes. Reconfirm refs before implementing. This document changes neither application behavior nor those pre-existing edits.

The current [older catalogue](UPGRADE_EOS.md) records 95 checked local delivery entries and five outstanding operator gates. That is a dated documentary statement about its own scope. It is not a verification count for these November suggestions and does not establish hosted rollout.

The following are inspected or discovered reuse locations. A file's existence is a starting point, not proof that every behavior proposed below is present. "Proposed" data structures in the feature sections are design candidates; reconcile them with the actual schema before creating anything.

| Source key | Existing owner or route | Reuse implication |
| --- | --- | --- |
| SRC-UI | [Page header](components/layout/page-header.tsx), [shared table](components/data/data-table.tsx), [searchable selector](components/ui/searchable-select.tsx), [status badges](components/status-board/status-badge.tsx) | Shared presentation already exists; improve consumers together |
| SRC-NAV | [Application shell](components/layout/app-shell.tsx), [navigation model](lib/navigation/task-navigation.ts), [workspace shortcuts](components/layout/workspace-shortcuts.tsx) | Role-aware destinations, pins, recent records, and views should be extended |
| SRC-WORK | [My Work Today](components/modules/my-work-today.tsx), [work loader](lib/dashboard/my-work.ts) | Personal and department queues already exist |
| SRC-SEARCH | [Instant Find](components/search/instant-find.tsx), [search route](app/%28dashboard%29/search/page.tsx) | Extend current authorized search and contextual actions |
| SRC-FORM | [Operational forms](components/modules/operations/record-form-client.tsx), [quotation entry](components/modules/quotes-client.tsx) | Existing lookup, autofill, keyboard, and paste patterns should remain authoritative |
| SRC-ORDER | [Order progress](lib/orders/order-progress.ts), [order-line schedule](components/modules/orders/order-line-schedule.tsx), [next action](components/modules/shared/record-next-action.tsx) | Progress and contextual actions have foundations; packing is still order-level in the inspected progress contract |
| SRC-DRAFT | [Dispatch draft recovery](components/forms/dispatch-draft-recovery.tsx), [record preview](components/modules/operations/record-preview.tsx) | Reuse scoped draft/recovery and preview interactions |
| SRC-PLAN | [Factory planning rules](lib/workflow/factory-planning.ts), [press grid](components/modules/production-planning/press-schedule-grid.tsx), [capacity page](app/%28dashboard%29/production/capacity/page.tsx) | Shift capacity, overlaps, maintenance blocks, and planning snapshots already have code |
| SRC-HANDOFF | [Department handoffs](components/modules/tasks/department-handoffs.tsx), [handoff acceptance](lib/actions/department-handoffs.ts) | Extend event-derived work and accepted responsibility |
| SRC-GOV | [Exception policies](components/modules/approvals/exception-requests.tsx), [delegation](components/modules/tasks/task-delegation.tsx), [competencies](components/modules/tasks/competencies.tsx) | Keep existing authority, temporary assignment, and qualification controls |
| SRC-SOP | [Procedure versions](components/modules/tasks/procedure-versions.tsx), [assurance](components/modules/tasks/sop-assurance.tsx), [effectiveness](lib/actions/procedure-effectiveness.ts) | Versioned instructions and observed outcomes already have foundations |
| SRC-FINISH | [Finishing workflow](components/modules/finishing-workflow-board.tsx), [finishing receipts](app/%28dashboard%29/production/finishing/%5Bid%5D/page.tsx) | Reconcile vendor custody against actual finishing issue and receipt events |
| SRC-PURCHASE | [Purchase lifecycle](components/modules/vendors/purchase-lifecycle.tsx), [supplier comparisons](components/modules/vendors/supplier-comparisons.tsx) | Extend purchase receipt and offer flows instead of duplicating them |
| SRC-FINANCE | [Financial review](components/modules/financials/financial-workflow-review.tsx), [invoice entry](components/modules/financials/invoice-form-client.tsx), [payment entry](components/modules/financials/payment-form-client.tsx) | Preserve billing eligibility, actual receipts, and historical financial snapshots |
| SRC-RETURN | [Connected returns](components/modules/dispatches/connected-returns.tsx) | Returns have an existing lifecycle to extend |
| SRC-AUTO | [Automation builder](components/modules/automation-client.tsx), [first automation guide](app/%28dashboard%29/automation/first-automation/page.tsx) | Inspected Run now records a simulated result; do not represent this as executed external work |

The inspected factory planning checker already validates shift windows, maintenance overlap, press overlap, duplicate scheduling, and configured kg capacity. NOV-021/024/026 therefore target broader coordination and planning behavior.

The inspected automation builder records a simulated run under a completed status with a simulated marker in result data. NOV-080 must distinguish simulation from execution clearly before a real runner is introduced. This observation is local source evidence, not a claim about current hosted behavior.

## Shared implementation contract

### Architecture, data, and authorization

1. Keep the existing Next.js App Router, TypeScript, Tailwind, Zod, Supabase Auth/PostgreSQL/Storage, and PDF stack. Extend shared components and domain libraries before introducing abstractions. No extra backend is implied.
2. Derive company identity and actor identity from the authenticated server session. Check action-level authority again on the server and preserve RLS, including linked reads, exports, previews, background execution, and Storage. Supabase describes RLS as a database authorization mechanism; this application's tenant and role policy must remain explicit. [Supabase RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security).
3. Use additive, tenant-scoped schema changes with relevant indexes, same-company foreign-key checks, lifecycle constraints, and audit history. Reconcile hosted migration history before changing or applying migrations; local replay alone is not hosted evidence.
4. Give new finalizing actions an idempotency/request identity. Recheck source versions, quantities, reservations, qualifications, and authority at commitment. Use database transactions and appropriate locks or uniqueness constraints where competing writers can violate an invariant.
5. Treat UI readiness and preview as advisory until the guarded server transaction succeeds. A timeout can leave the outcome uncertain; resolve it using the original request identity before offering a new commit.
6. Preserve issued document, approval, costing, technical, and policy snapshots. Use approved correction/reversal processes for posted records; do not rewrite history through a generic edit form.
7. Keep theoretical, measured, contractual billing, accepted, rejected, reserved, and remaining quantities distinct. Preserve units and rounding rules centrally. Null, unreadable, or unavailable inputs must not become convenient zero values.
8. Model quantities and values from source events or ledgers wherever possible. Do not maintain another independent editable total that can drift. Proposed tables and events below require mapping to existing owners before design approval.
9. Keep list pages at ten server-paginated rows by default, with bounded search, deterministic sorting, and explicit loading, empty, and error states. Summary pages may use bounded status groups and links to full databases.
10. Customer/dealer screens and documents must project only permitted fields. Internal cost, supplier rates, margin, profit, internal discussion, and other customers' information must remain restricted.

### UX and operational adoption

1. Preserve the existing visual language. Build a compact, consistent industrial interface with clear text and units; keep large creation/editing forms separate from databases.
2. Make known facts reusable, calculated values explainable, defaults visible, and overrides deliberate. Manual entry remains available where equipment, scanning, or extraction is unavailable.
3. Make consequential actions reviewable; keep routine reversible interactions proportionate. Auto-saving a draft must never silently issue stock, approve quality, send a message, or post money.
4. Verify keyboard access, focus visibility, readable contrast, text enlargement, touch targets, and responsive reflow against the relevant [WCAG 2.2 understanding guidance](https://www.w3.org/WAI/WCAG22/Understanding/). This file does not certify accessibility compliance.
5. Choose a business owner and a small representative employee pilot. Capture baseline task completion time, fields typed, corrections, interruptions, first-time acceptance, and unresolved exceptions; state sample size and working context.
6. Agree ownership, escalation, training, and exception rules before enforcing a new process. A faster screen cannot resolve an undefined responsibility policy.
7. Keep notifications bounded and resolution-aware. Prepared text, copied text, provider acceptance, and confirmed delivery are different outcomes.
8. Use real work observations to remove unnecessary steps. Trial changes, inspect outcomes, and retain the useful revision. [ASQ's PDCA guidance](https://asq.org/quality-resources/pdca-cycle) supports that improvement approach.

## Complexity-sorted register

There are 5 C1, 14 C2, 35 C3, 34 C4, and 12 C5 entries. Complexity rank follows the detailed-section order. Delivery rank provides a separate urgency/need-first view.

| Complexity rank | Stable ID | Feature | Complexity | Urgency | Need | Delivery rank |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | [NOV-086](#nov-086) | Give status colours one consistent meaning | C1 | U1 | N1 | 1 |
| 2 | [NOV-093](#nov-093) | Make quantities and amounts easier to compare | C1 | U1 | N1 | 2 |
| 3 | [NOV-099](#nov-099) | Give empty and unavailable screens useful explanations | C1 | U1 | N1 | 3 |
| 4 | [NOV-081](#nov-081) | Make page headers more compact | C1 | U2 | N2 | 57 |
| 5 | [NOV-090](#nov-090) | Keep table headings and identifiers visible | C1 | U2 | N2 | 58 |
| 6 | [NOV-002](#nov-002) | Give each employee a small relevant workspace | C2 | U1 | N1 | 4 |
| 7 | [NOV-006](#nov-006) | Show only fields needed at the current stage | C2 | U1 | N1 | 5 |
| 8 | [NOV-016](#nov-016) | Turn blockers into actionable instructions | C2 | U1 | N1 | 6 |
| 9 | [NOV-083](#nov-083) | Use the same page structure across modules | C2 | U1 | N1 | 7 |
| 10 | [NOV-084](#nov-084) | Keep the current record identity visible | C2 | U1 | N1 | 8 |
| 11 | [NOV-085](#nov-085) | Keep important form actions within reach | C2 | U1 | N1 | 9 |
| 12 | [NOV-088](#nov-088) | Make phone cards shorter and more selective | C2 | U1 | N1 | 10 |
| 13 | [NOV-091](#nov-091) | Make active filters obvious | C2 | U1 | N1 | 11 |
| 14 | [NOV-092](#nov-092) | Make selection menus easier to distinguish | C2 | U1 | N1 | 12 |
| 15 | [NOV-095](#nov-095) | Place reference information beside task inputs | C2 | U1 | N1 | 13 |
| 16 | [NOV-008](#nov-008) | Use sensible visible defaults | C2 | U2 | N2 | 59 |
| 17 | [NOV-060](#nov-060) | Review the whole journey with the people involved | C2 | U2 | N2 | 60 |
| 18 | [NOV-089](#nov-089) | Standardise quick record previews | C2 | U2 | N2 | 61 |
| 19 | [NOV-082](#nov-082) | Offer comfortable and compact display options | C2 | U3 | N2 | 84 |
| 20 | [NOV-001](#nov-001) | Make My Work Today the main working screen | C3 | U1 | N1 | 14 |
| 21 | [NOV-004](#nov-004) | Put one clear next action on each record | C3 | U1 | N1 | 15 |
| 22 | [NOV-012](#nov-012) | Ask employees for the quantity they actually know | C3 | U1 | N1 | 16 |
| 23 | [NOV-018](#nov-018) | Expand focused phone workflows for factory work | C3 | U1 | N1 | 17 |
| 24 | [NOV-040](#nov-040) | Give accounts a collection workflow with payment commitments | C3 | U1 | N1 | 18 |
| 25 | [NOV-041](#nov-041) | Give every order one accountable coordinator | C3 | U1 | N1 | 19 |
| 26 | [NOV-043](#nov-043) | Create one shared priority policy | C3 | U1 | N1 | 20 |
| 27 | [NOV-046](#nov-046) | Agree service expectations between departments | C3 | U1 | N1 | 21 |
| 28 | [NOV-048](#nov-048) | Identify backup owners before somebody is absent | C3 | U1 | N1 | 22 |
| 29 | [NOV-049](#nov-049) | Run daily coordination from live records | C3 | U1 | N1 | 23 |
| 30 | [NOV-050](#nov-050) | Make requests between teams trackable | C3 | U1 | N1 | 24 |
| 31 | [NOV-056](#nov-056) | Assign ownership of important master data | C3 | U1 | N1 | 25 |
| 32 | [NOV-094](#nov-094) | Explain where each field value came from | C3 | U1 | N1 | 26 |
| 33 | [NOV-096](#nov-096) | Make validation specific and easy to resolve | C3 | U1 | N1 | 27 |
| 34 | [NOV-097](#nov-097) | Show the consequence of a final action clearly | C3 | U1 | N1 | 28 |
| 35 | [NOV-098](#nov-098) | Keep meaningful action results visible | C3 | U1 | N1 | 29 |
| 36 | [NOV-100](#nov-100) | Make accessibility practical for everyday factory use | C3 | U1 | N1 | 30 |
| 37 | [NOV-055](#nov-055) | Connect training to demonstrated work | C3 | U2 | N1 | 45 |
| 38 | [NOV-070](#nov-070) | Link inspection results to measuring equipment | C3 | U2 | N1 | 46 |
| 39 | [NOV-003](#nov-003) | Make search usable directly from every screen | C3 | U2 | N2 | 62 |
| 40 | [NOV-009](#nov-009) | Extend Repeat Previous beyond quotations | C3 | U2 | N2 | 63 |
| 41 | [NOV-010](#nov-010) | Create missing master records without leaving the task | C3 | U2 | N2 | 64 |
| 42 | [NOV-011](#nov-011) | Make repeated line entry work like a spreadsheet | C3 | U2 | N2 | 65 |
| 43 | [NOV-017](#nov-017) | Make QR scanning lead directly into the relevant task | C3 | U2 | N2 | 66 |
| 44 | [NOV-025](#nov-025) | Give every die a useful operating history | C3 | U2 | N2 | 67 |
| 45 | [NOV-053](#nov-053) | Give recurring problems a permanent improvement owner | C3 | U2 | N2 | 68 |
| 46 | [NOV-054](#nov-054) | Measure team outcomes with useful context | C3 | U2 | N2 | 69 |
| 47 | [NOV-059](#nov-059) | Give employees a practical improvement channel | C3 | U2 | N2 | 70 |
| 48 | [NOV-075](#nov-075) | Manage delivery appointments and site readiness | C3 | U2 | N2 | 71 |
| 49 | [NOV-077](#nov-077) | Track returnable gate passes and custody | C3 | U2 | N2 | 72 |
| 50 | [NOV-087](#nov-087) | Show workflow progress visually | C3 | U2 | N2 | 73 |
| 51 | [NOV-039](#nov-039) | Measure supplier and finishing-vendor reliability | C3 | U3 | N2 | 85 |
| 52 | [NOV-066](#nov-066) | Understand why quotations are won or lost | C3 | U3 | N2 | 86 |
| 53 | [NOV-071](#nov-071) | Track external laboratory testing | C3 | U4 | N3 | 93 |
| 54 | [NOV-073](#nov-073) | Control finish and shade references across repeat orders | C3 | U4 | N3 | 94 |
| 55 | [NOV-005](#nov-005) | Finish the connected order workspace | C4 | U1 | N1 | 31 |
| 56 | [NOV-007](#nov-007) | Carry known information through the entire process | C4 | U1 | N1 | 32 |
| 57 | [NOV-013](#nov-013) | Extend dependable drafts to every lengthy form | C4 | U1 | N1 | 33 |
| 58 | [NOV-015](#nov-015) | Make department handoffs part of completing work | C4 | U1 | N1 | 34 |
| 59 | [NOV-022](#nov-022) | Turn material shortages into a purchasing plan | C4 | U1 | N1 | 35 |
| 60 | [NOV-028](#nov-028) | Track work in progress by physical location and age | C4 | U1 | N1 | 36 |
| 61 | [NOV-031](#nov-031) | Maintain a material account for each finishing vendor | C4 | U1 | N1 | 37 |
| 62 | [NOV-042](#nov-042) | Define what each role can decide independently | C4 | U1 | N1 | 38 |
| 63 | [NOV-051](#nov-051) | Agree what done means for every important step | C4 | U1 | N1 | 39 |
| 64 | [NOV-057](#nov-057) | Make process changes reach the people doing work | C4 | U1 | N1 | 40 |
| 65 | [NOV-062](#nov-062) | Manage drawing approval as a complete workflow | C4 | U1 | N1 | 41 |
| 66 | [NOV-069](#nov-069) | Give incoming material an acceptance workflow | C4 | U1 | N1 | 42 |
| 67 | [NOV-076](#nov-076) | Record partial acceptance and delivery exceptions | C4 | U1 | N1 | 43 |
| 68 | [NOV-026](#nov-026) | Connect maintenance directly to production capacity | C4 | U2 | N1 | 47 |
| 69 | [NOV-030](#nov-030) | Introduce a cycle-counting workflow | C4 | U2 | N1 | 48 |
| 70 | [NOV-033](#nov-033) | Generate a complete quality document pack | C4 | U2 | N1 | 49 |
| 71 | [NOV-038](#nov-038) | Manage a return through final resolution | C4 | U2 | N1 | 50 |
| 72 | [NOV-058](#nov-058) | Close orders through a coordinated final review | C4 | U2 | N1 | 51 |
| 73 | [NOV-063](#nov-063) | Track samples and first-piece approvals | C4 | U2 | N1 | 52 |
| 74 | [NOV-079](#nov-079) | Generate customer-specific packing instructions and labels | C4 | U2 | N1 | 53 |
| 75 | [NOV-014](#nov-014) | Allow small updates directly from work queues | C4 | U2 | N2 | 74 |
| 76 | [NOV-019](#nov-019) | Keep documents and communication beside the transaction | C4 | U2 | N2 | 75 |
| 77 | [NOV-036](#nov-036) | Plan a vehicle load across multiple orders | C4 | U2 | N2 | 76 |
| 78 | [NOV-044](#nov-044) | Protect an agreed execution window | C4 | U2 | N2 | 77 |
| 79 | [NOV-045](#nov-045) | Control how much work enters each stage | C4 | U2 | N2 | 78 |
| 80 | [NOV-047](#nov-047) | Assign work using capacity and eligibility together | C4 | U2 | N2 | 79 |
| 81 | [NOV-052](#nov-052) | Use approved workflow paths for different order types | C4 | U2 | N2 | 80 |
| 82 | [NOV-064](#nov-064) | Apply quantity-based pricing and minimum charges | C4 | U2 | N2 | 81 |
| 83 | [NOV-078](#nov-078) | Manage supplier claims through to recovery | C4 | U2 | N2 | 82 |
| 84 | [NOV-029](#nov-029) | Manage reusable remnants and excess production | C4 | U3 | N2 | 87 |
| 85 | [NOV-037](#nov-037) | Support blanket orders with scheduled releases | C4 | U4 | N3 | 95 |
| 86 | [NOV-065](#nov-065) | Maintain a die and tooling commercial account | C4 | U4 | N3 | 96 |
| 87 | [NOV-067](#nov-067) | Handle stock transfers between warehouses properly | C4 | U4 | N3 | 97 |
| 88 | [NOV-072](#nov-072) | Manage ageing or heat-treatment batches | C4 | U4 | N3 | 98 |
| 89 | [NOV-034](#nov-034) | Show consequences of an order revision | C5 | U1 | N1 | 44 |
| 90 | [NOV-021](#nov-021) | Check delivery feasibility before promising a date | C5 | U2 | N1 | 54 |
| 91 | [NOV-027](#nov-027) | Trace material from source to customer | C5 | U2 | N1 | 55 |
| 92 | [NOV-068](#nov-068) | Split and combine physical bundles with traceability | C5 | U2 | N1 | 56 |
| 93 | [NOV-035](#nov-035) | Compare estimated and actual job profitability | C5 | U2 | N2 | 83 |
| 94 | [NOV-020](#nov-020) | Remove double entry between operations accounts and equipment | C5 | U3 | N2 | 88 |
| 95 | [NOV-023](#nov-023) | Suggest compatible production runs and their sequence | C5 | U3 | N2 | 89 |
| 96 | [NOV-024](#nov-024) | Add a what happens if planning tool | C5 | U3 | N2 | 90 |
| 97 | [NOV-061](#nov-061) | Turn customer purchase orders into reviewable drafts | C5 | U3 | N2 | 91 |
| 98 | [NOV-080](#nov-080) | Provide a controlled automation workbench | C5 | U3 | N2 | 92 |
| 99 | [NOV-032](#nov-032) | Support customer-owned metal and job-work settlement | C5 | U4 | N3 | 99 |
| 100 | [NOV-074](#nov-074) | Add a complete weighbridge transaction workflow | C5 | U4 | N3 | 100 |

## Urgency-first reading order

Each list is ordered by need, then complexity, then stable ID within the urgency class. Dependencies still govern implementation. U4 should move earlier when its operating scenario is confirmed; do not interpret "conditional" as unimportant in an applicable factory.

### U1 delivery reading order

[NOV-086](#nov-086), [NOV-093](#nov-093), [NOV-099](#nov-099), [NOV-002](#nov-002), [NOV-006](#nov-006), [NOV-016](#nov-016), [NOV-083](#nov-083), [NOV-084](#nov-084), [NOV-085](#nov-085), [NOV-088](#nov-088), [NOV-091](#nov-091), [NOV-092](#nov-092), [NOV-095](#nov-095), [NOV-001](#nov-001), [NOV-004](#nov-004), [NOV-012](#nov-012), [NOV-018](#nov-018), [NOV-040](#nov-040), [NOV-041](#nov-041), [NOV-043](#nov-043), [NOV-046](#nov-046), [NOV-048](#nov-048), [NOV-049](#nov-049), [NOV-050](#nov-050), [NOV-056](#nov-056), [NOV-094](#nov-094), [NOV-096](#nov-096), [NOV-097](#nov-097), [NOV-098](#nov-098), [NOV-100](#nov-100), [NOV-005](#nov-005), [NOV-007](#nov-007), [NOV-013](#nov-013), [NOV-015](#nov-015), [NOV-022](#nov-022), [NOV-028](#nov-028), [NOV-031](#nov-031), [NOV-042](#nov-042), [NOV-051](#nov-051), [NOV-057](#nov-057), [NOV-062](#nov-062), [NOV-069](#nov-069), [NOV-076](#nov-076), [NOV-034](#nov-034).

### U2 delivery reading order

[NOV-055](#nov-055), [NOV-070](#nov-070), [NOV-026](#nov-026), [NOV-030](#nov-030), [NOV-033](#nov-033), [NOV-038](#nov-038), [NOV-058](#nov-058), [NOV-063](#nov-063), [NOV-079](#nov-079), [NOV-021](#nov-021), [NOV-027](#nov-027), [NOV-068](#nov-068), [NOV-081](#nov-081), [NOV-090](#nov-090), [NOV-008](#nov-008), [NOV-060](#nov-060), [NOV-089](#nov-089), [NOV-003](#nov-003), [NOV-009](#nov-009), [NOV-010](#nov-010), [NOV-011](#nov-011), [NOV-017](#nov-017), [NOV-025](#nov-025), [NOV-053](#nov-053), [NOV-054](#nov-054), [NOV-059](#nov-059), [NOV-075](#nov-075), [NOV-077](#nov-077), [NOV-087](#nov-087), [NOV-014](#nov-014), [NOV-019](#nov-019), [NOV-036](#nov-036), [NOV-044](#nov-044), [NOV-045](#nov-045), [NOV-047](#nov-047), [NOV-052](#nov-052), [NOV-064](#nov-064), [NOV-078](#nov-078), [NOV-035](#nov-035).

### U3 delivery reading order

[NOV-082](#nov-082), [NOV-039](#nov-039), [NOV-066](#nov-066), [NOV-029](#nov-029), [NOV-020](#nov-020), [NOV-023](#nov-023), [NOV-024](#nov-024), [NOV-061](#nov-061), [NOV-080](#nov-080).

### U4 delivery reading order

[NOV-071](#nov-071), [NOV-073](#nov-073), [NOV-037](#nov-037), [NOV-065](#nov-065), [NOV-067](#nov-067), [NOV-072](#nov-072), [NOV-032](#nov-032), [NOV-074](#nov-074).

## Original conversation mapping

The five batches are: B1: Employee efficiency and daily navigation; B2: Business functionality and factory planning; B3: Organization, ownership, and coordination; B4: Detailed commercial and physical transactions; B5: UX, UI, and accessible interaction. This map retains the original 1-20 position within each batch and allows all suggestions to be reconciled after sorting.

| Original batch and item | Stable ID | Preserved suggestion |
| --- | --- | --- |
| B1.01 | [NOV-001](#nov-001) | Make My Work Today the main working screen |
| B1.02 | [NOV-002](#nov-002) | Give each employee a small relevant workspace |
| B1.03 | [NOV-003](#nov-003) | Make search usable directly from every screen |
| B1.04 | [NOV-004](#nov-004) | Put one clear next action on each record |
| B1.05 | [NOV-005](#nov-005) | Finish the connected order workspace |
| B1.06 | [NOV-006](#nov-006) | Show only fields needed at the current stage |
| B1.07 | [NOV-007](#nov-007) | Carry known information through the entire process |
| B1.08 | [NOV-008](#nov-008) | Use sensible visible defaults |
| B1.09 | [NOV-009](#nov-009) | Extend Repeat Previous beyond quotations |
| B1.10 | [NOV-010](#nov-010) | Create missing master records without leaving the task |
| B1.11 | [NOV-011](#nov-011) | Make repeated line entry work like a spreadsheet |
| B1.12 | [NOV-012](#nov-012) | Ask employees for the quantity they actually know |
| B1.13 | [NOV-013](#nov-013) | Extend dependable drafts to every lengthy form |
| B1.14 | [NOV-014](#nov-014) | Allow small updates directly from work queues |
| B1.15 | [NOV-015](#nov-015) | Make department handoffs part of completing work |
| B1.16 | [NOV-016](#nov-016) | Turn blockers into actionable instructions |
| B1.17 | [NOV-017](#nov-017) | Make QR scanning lead directly into the relevant task |
| B1.18 | [NOV-018](#nov-018) | Expand focused phone workflows for factory work |
| B1.19 | [NOV-019](#nov-019) | Keep documents and communication beside the transaction |
| B1.20 | [NOV-020](#nov-020) | Remove double entry between operations accounts and equipment |
| B2.01 | [NOV-021](#nov-021) | Check delivery feasibility before promising a date |
| B2.02 | [NOV-022](#nov-022) | Turn material shortages into a purchasing plan |
| B2.03 | [NOV-023](#nov-023) | Suggest compatible production runs and their sequence |
| B2.04 | [NOV-024](#nov-024) | Add a what happens if planning tool |
| B2.05 | [NOV-025](#nov-025) | Give every die a useful operating history |
| B2.06 | [NOV-026](#nov-026) | Connect maintenance directly to production capacity |
| B2.07 | [NOV-027](#nov-027) | Trace material from source to customer |
| B2.08 | [NOV-028](#nov-028) | Track work in progress by physical location and age |
| B2.09 | [NOV-029](#nov-029) | Manage reusable remnants and excess production |
| B2.10 | [NOV-030](#nov-030) | Introduce a cycle-counting workflow |
| B2.11 | [NOV-031](#nov-031) | Maintain a material account for each finishing vendor |
| B2.12 | [NOV-032](#nov-032) | Support customer-owned metal and job-work settlement |
| B2.13 | [NOV-033](#nov-033) | Generate a complete quality document pack |
| B2.14 | [NOV-034](#nov-034) | Show consequences of an order revision |
| B2.15 | [NOV-035](#nov-035) | Compare estimated and actual job profitability |
| B2.16 | [NOV-036](#nov-036) | Plan a vehicle load across multiple orders |
| B2.17 | [NOV-037](#nov-037) | Support blanket orders with scheduled releases |
| B2.18 | [NOV-038](#nov-038) | Manage a return through final resolution |
| B2.19 | [NOV-039](#nov-039) | Measure supplier and finishing-vendor reliability |
| B2.20 | [NOV-040](#nov-040) | Give accounts a collection workflow with payment commitments |
| B3.01 | [NOV-041](#nov-041) | Give every order one accountable coordinator |
| B3.02 | [NOV-042](#nov-042) | Define what each role can decide independently |
| B3.03 | [NOV-043](#nov-043) | Create one shared priority policy |
| B3.04 | [NOV-044](#nov-044) | Protect an agreed execution window |
| B3.05 | [NOV-045](#nov-045) | Control how much work enters each stage |
| B3.06 | [NOV-046](#nov-046) | Agree service expectations between departments |
| B3.07 | [NOV-047](#nov-047) | Assign work using capacity and eligibility together |
| B3.08 | [NOV-048](#nov-048) | Identify backup owners before somebody is absent |
| B3.09 | [NOV-049](#nov-049) | Run daily coordination from live records |
| B3.10 | [NOV-050](#nov-050) | Make requests between teams trackable |
| B3.11 | [NOV-051](#nov-051) | Agree what done means for every important step |
| B3.12 | [NOV-052](#nov-052) | Use approved workflow paths for different order types |
| B3.13 | [NOV-053](#nov-053) | Give recurring problems a permanent improvement owner |
| B3.14 | [NOV-054](#nov-054) | Measure team outcomes with useful context |
| B3.15 | [NOV-055](#nov-055) | Connect training to demonstrated work |
| B3.16 | [NOV-056](#nov-056) | Assign ownership of important master data |
| B3.17 | [NOV-057](#nov-057) | Make process changes reach the people doing work |
| B3.18 | [NOV-058](#nov-058) | Close orders through a coordinated final review |
| B3.19 | [NOV-059](#nov-059) | Give employees a practical improvement channel |
| B3.20 | [NOV-060](#nov-060) | Review the whole journey with the people involved |
| B4.01 | [NOV-061](#nov-061) | Turn customer purchase orders into reviewable drafts |
| B4.02 | [NOV-062](#nov-062) | Manage drawing approval as a complete workflow |
| B4.03 | [NOV-063](#nov-063) | Track samples and first-piece approvals |
| B4.04 | [NOV-064](#nov-064) | Apply quantity-based pricing and minimum charges |
| B4.05 | [NOV-065](#nov-065) | Maintain a die and tooling commercial account |
| B4.06 | [NOV-066](#nov-066) | Understand why quotations are won or lost |
| B4.07 | [NOV-067](#nov-067) | Handle stock transfers between warehouses properly |
| B4.08 | [NOV-068](#nov-068) | Split and combine physical bundles with traceability |
| B4.09 | [NOV-069](#nov-069) | Give incoming material an acceptance workflow |
| B4.10 | [NOV-070](#nov-070) | Link inspection results to measuring equipment |
| B4.11 | [NOV-071](#nov-071) | Track external laboratory testing |
| B4.12 | [NOV-072](#nov-072) | Manage ageing or heat-treatment batches |
| B4.13 | [NOV-073](#nov-073) | Control finish and shade references across repeat orders |
| B4.14 | [NOV-074](#nov-074) | Add a complete weighbridge transaction workflow |
| B4.15 | [NOV-075](#nov-075) | Manage delivery appointments and site readiness |
| B4.16 | [NOV-076](#nov-076) | Record partial acceptance and delivery exceptions |
| B4.17 | [NOV-077](#nov-077) | Track returnable gate passes and custody |
| B4.18 | [NOV-078](#nov-078) | Manage supplier claims through to recovery |
| B4.19 | [NOV-079](#nov-079) | Generate customer-specific packing instructions and labels |
| B4.20 | [NOV-080](#nov-080) | Provide a controlled automation workbench |
| B5.01 | [NOV-081](#nov-081) | Make page headers more compact |
| B5.02 | [NOV-082](#nov-082) | Offer comfortable and compact display options |
| B5.03 | [NOV-083](#nov-083) | Use the same page structure across modules |
| B5.04 | [NOV-084](#nov-084) | Keep the current record identity visible |
| B5.05 | [NOV-085](#nov-085) | Keep important form actions within reach |
| B5.06 | [NOV-086](#nov-086) | Give status colours one consistent meaning |
| B5.07 | [NOV-087](#nov-087) | Show workflow progress visually |
| B5.08 | [NOV-088](#nov-088) | Make phone cards shorter and more selective |
| B5.09 | [NOV-089](#nov-089) | Standardise quick record previews |
| B5.10 | [NOV-090](#nov-090) | Keep table headings and identifiers visible |
| B5.11 | [NOV-091](#nov-091) | Make active filters obvious |
| B5.12 | [NOV-092](#nov-092) | Make selection menus easier to distinguish |
| B5.13 | [NOV-093](#nov-093) | Make quantities and amounts easier to compare |
| B5.14 | [NOV-094](#nov-094) | Explain where each field value came from |
| B5.15 | [NOV-095](#nov-095) | Place reference information beside task inputs |
| B5.16 | [NOV-096](#nov-096) | Make validation specific and easy to resolve |
| B5.17 | [NOV-097](#nov-097) | Show the consequence of a final action clearly |
| B5.18 | [NOV-098](#nov-098) | Keep meaningful action results visible |
| B5.19 | [NOV-099](#nov-099) | Give empty and unavailable screens useful explanations |
| B5.20 | [NOV-100](#nov-100) | Make accessibility practical for everyday factory use |


## C1: Small presentation changes

These five entries refine existing rendering and layout. Preserve underlying business states and calculation rules.

<a id="nov-086"></a>

### NOV-086 - Give status colours one consistent meaning

**Assessment:** C1 | U1 | N1. **Original:** Batch 5, item 6.

**Purpose and employee flow.** An employee should recognize waiting work, active work, a blocker, and a finished transaction consistently across boards, tables, previews, and phone cards. A red badge should carry an explicit label such as "Quality hold", with the same meaning in each place.

**Scope and starting point.** Refine SRC-UI status badges and the display maps used by module configurations. Preserve domain-specific statuses: a paid invoice and an approved inspection can share a visual family without becoming the same business state.

**Implementation.**
1. Inventory current status codes and group their presentation into neutral, active, waiting, blocked, and completed families.
2. Add shared tokens for text, border, background, icon, and readable label; retain the original code for domain logic.
3. Apply the map to boards, database rows, previews, and mobile consumers, with an explicit neutral treatment for an unknown status.

**Data and controls.** No status migration is needed for a presentation-only change. Do not infer permission or transition eligibility from colour. Keep explanatory text available without hover.

**Complexity, dependencies, and owner.** C1 because the authoritative states already exist and the change is primarily a shared rendering map. Coordinate with NOV-083/100. Product design owns the vocabulary with department review.

**Acceptance and measurement.** Compare the same status across at least four modules; verify unknown codes remain visible, colour-independent recognition, keyboard focus, and contrast. Pilot with production and accounts employees and record identification errors rather than claiming a fixed speed improvement.

<a id="nov-093"></a>

### NOV-093 - Make quantities and amounts easier to compare

**Assessment:** C1 | U1 | N1. **Original:** Batch 5, item 13.

**Purpose and employee flow.** Employees comparing quantities or amounts should immediately understand the unit, numerical scale, and commercial basis. An order's theoretical 500 kg, a measured 492 kg, and a billed 492 kg must remain visibly distinct.

**Scope and starting point.** Standardize presentation through SRC-UI and current shared calculation/formatting utilities. Keep the existing INR and Indian business-date conventions. This entry changes display; NOV-012 owns quantity derivation.

**Implementation.**
1. Define formatting per data type: whole pieces, approved precision for metres/kg, currency, percentages, and rate-per-unit.
2. Right-align comparable numbers, use tabular numerals where the font supports them, and place units in persistent headings or field suffixes.
3. Show missing values as "Not captured" or "Unavailable"; offer sufficient precision in details when a compact list rounds a display.
4. Label a total's scope, such as "This page" or "All filtered records", and calculate any full-result total on the server.

**Data and controls.** Do not round values again on save or export merely because the display uses fewer digits. Preserve zero as a valid distinct value. Restricted money columns remain permission-projected.

**Complexity, dependencies, and owner.** C1 for formatting reuse; changing calculation policies belongs to a separately reviewed scope. Coordinate with NOV-012/035/094. Accounts and production approve their units.

**Acceptance and measurement.** Exercise zero, null, negative corrections, large values, mixed units, long headings, phone widths, and PDF parity. Ask employees to compare representative rows and record interpretation mistakes.

<a id="nov-099"></a>

### NOV-099 - Give empty and unavailable screens useful explanations

**Assessment:** C1 | U1 | N1. **Original:** Batch 5, item 19.

**Purpose and employee flow.** An empty screen should explain whether there is no work, a restrictive filter, an access limitation, or a failed source. A storekeeper must not interpret an unsuccessful stock lookup as a genuine zero-stock position.

**Scope and starting point.** Refine the existing table and empty/error state components in SRC-UI. This builds on their current separation of loading, error, and empty results and improves wording and recovery across consumers.

**Implementation.**
1. Define explicit states for initial loading, refreshing, no records, no filter matches, unauthorized access, partial source failure, and failed loading.
2. Supply contextual actions: clear filters, retry a read, open the relevant queue, or create a permitted first record.
3. Keep successful source sections visible when another section fails and mark their freshness separately.
4. Preserve entered filters and draft information during recovery; do not expose raw database errors as employee guidance.

**Data and controls.** Distinguish absent records from denied visibility without disclosing another tenant's existence. Retrying a read is different from retrying an uncertain transaction; use NOV-098 for the latter.

**Complexity, dependencies, and owner.** C1 when reusing the existing state contract and changing presentation; a missing query error contract may need a bounded follow-up. Coordinate with NOV-091/098. Product and each module owner approve recovery text.

**Acceptance and measurement.** Simulate a real empty result, unmatched filter, permission denial, slow read, and partial outage. Verify the next action works and that no failure becomes a zero quantity. Measure unsuccessful retries and employee requests for explanation.

<a id="nov-081"></a>

### NOV-081 - Make page headers more compact

**Assessment:** C1 | U2 | N2. **Original:** Batch 5, item 1.

**Purpose and employee flow.** Show useful work immediately on common laptops and phones. A quotations user should reach their queue or first meaningful input without scrolling past repeated product branding and an oversized heading.

**Scope and starting point.** SRC-UI PageHeader currently renders branding, a large title, a description, and an action area. SRC-NAV adds application-level context. Reduce duplicate visual information while preserving an obvious page title and company identity.

**Implementation.**
1. Create a compact header variant using the existing fonts, spacing tokens, and visual language.
2. Keep one semantic page heading, a short optional description, and a predictable primary-action position.
3. Wrap or stack actions on narrow screens without truncating their accessible names.
4. Audit overview, database, new, detail, and edit layouts before changing the shared default.

**Data and controls.** No new data or migration is required. Do not remove record identity, important warnings, or instructions merely to achieve a shorter page. Preserve a consistent location for the active company.

**Complexity, dependencies, and owner.** C1 because it is a small shared composition change. Coordinate with NOV-083/084/085 to avoid multiple competing headers. Product design owns the variant.

**Acceptance and measurement.** Inspect representative modules at phone, tablet, and laptop widths, enlarged text, long customer names, and multiple permitted actions. Compare initial useful content and scrolling needed to reach work, and confirm heading semantics and focus remain intact.

<a id="nov-090"></a>

### NOV-090 - Keep table headings and identifiers visible

**Assessment:** C1 | U2 | N2. **Original:** Batch 5, item 10.

**Purpose and employee flow.** A supervisor comparing several columns should retain the record identifier and the meaning of each column while scrolling. For example, the order number should remain visible when inspecting dispatch dates and remaining quantities.

**Scope and starting point.** SRC-UI DataTable already supports a sticky-column option. Audit and complete the header behavior and module-specific use of that option instead of introducing another table implementation.

**Implementation.**
1. Define which identifier column may remain fixed in each database view.
2. Give sticky headers and identifiers opaque backgrounds, suitable stacking order, and clear boundaries.
3. Calculate sticky offsets against the application header and any toolbar; avoid competing scroll containers.
4. Preserve semantic table headings and sort indicators, including at browser zoom.

**Data and controls.** No schema change. Sticky behavior must not alter server pagination, sorting scope, or row navigation. Keep labels and action controls reachable when only part of a row is visible.

**Complexity, dependencies, and owner.** C1 for shared CSS/composition with existing data. Coordinate with NOV-082/088/100; mobile cards remain the default small-screen view where comparison does not require a table. Frontend ownership sits with the shared table maintainer.

**Acceptance and measurement.** Test horizontal and vertical scrolling together, long identifiers, pinned columns, empty/loading states, and keyboard focus near sticky edges. Check that employees can identify a row and column without repeatedly scrolling back; do not equate stickiness alone with accessibility compliance.



## C2: Shared interaction improvements

These fourteen entries extend reusable interfaces and operating views using existing domain rules.

<a id="nov-002"></a>

### NOV-002 - Give each employee a small relevant workspace

**Assessment:** C2 | U1 | N1. **Original:** Batch 1, item 2.

**Purpose and employee flow.** A production operator, dispatch employee, and accounts user should each see a short set of useful destinations. A stable workspace reduces repeated menu scanning and avoids showing tools irrelevant to the person's permitted responsibilities.

**Scope and starting point.** Extend SRC-NAV role-prioritized navigation and scoped pins, recents, and saved views. Existing role and company-feature checks remain authoritative; this is not a new permissions system.

**Implementation.**
1. Observe frequent destinations for each role and agree a small initial navigation set with department leads.
2. Support explicit personal pinning and named views such as "My press jobs", with predictable ordering.
3. Restore query, filters, pagination, and relevant scroll position after opening and returning from a record.
4. Provide a clear More group and an accessible route back to the default workspace.

**Data and controls.** Scope preferences by company and user. Recheck current record access before displaying recent links; remove unavailable references safely after role or company changes. Store no sensitive financial payload inside a shortcut.

**Complexity, dependencies, and owner.** C2 because the navigation/preference foundation exists and the incremental work is consistent coverage. Depends on agreed role journeys and NOV-083/091. Product and department leads own the defaults.

**Acceptance and measurement.** Verify two users, two companies, revoked access, broken storage, long labels, phone navigation, and Back restoration. Measure destination-finding time and repeated view setup. Pilot one role before broad changes so familiar navigation remains predictable.

<a id="nov-006"></a>

### NOV-006 - Show only fields needed at the current stage

**Assessment:** C2 | U1 | N1. **Original:** Batch 1, item 6.

**Purpose and employee flow.** A form should ask for the information needed at its current stage. Sales can prepare a legitimate incomplete draft, while final confirmation still requires all approved commercial and technical facts.

**Scope and starting point.** Extend existing quotation progressive sections in SRC-FORM to selected production, purchasing, inspection, and dispatch forms. Do not hide a requirement that employees must satisfy before the current action.

**Implementation.**
1. Classify fields into current essentials, conditional sections, optional details, and later-stage information.
2. Define stage-specific Zod validation and keep final transaction requirements aligned with server/database guards.
3. Preserve entered values when sections collapse; clear incompatible dependent values only under explicit rules.
4. Expand and focus a section containing a validation issue, with a short summary of remaining requirements.

**Data and controls.** Use existing nullable draft fields where appropriate. Add schema changes only after checking current lifecycle constraints. Hidden inputs are still untrusted, and role-hidden commercial fields must be excluded from responses as well as rendering.

**Complexity, dependencies, and owner.** C2 for adapting established form sections and validation profiles; inventing a new lifecycle would increase scope. Coordinate with NOV-007/013/096. Each department approves what can remain incomplete.

**Acceptance and measurement.** Save and reopen partial drafts, switch conditional options, collapse filled sections, and attempt final confirmation with missing essentials. Verify authorized values remain intact and the server rejects incomplete finalization. Measure visible fields and corrections during representative employee tasks.

<a id="nov-016"></a>

### NOV-016 - Turn blockers into actionable instructions

**Assessment:** C2 | U1 | N1. **Original:** Batch 1, item 16.

**Purpose and employee flow.** A blocked task should tell the employee what is missing, which team can resolve it, and where to act. "Waiting for approved die" is more useful than a generic blocked badge.

**Scope and starting point.** Reuse existing readiness issues, next-action components, alerts, and source links in SRC-ORDER/SRC-PLAN. This target standardizes the employee explanation of already known blockers.

**Implementation.**
1. Define a blocker display contract containing code, current reason, source reference, responsible role, and permitted resolution link.
2. Map domain readiness responses into that contract without duplicating eligibility logic in components.
3. Display blocking issues before advisories and distinguish missing evidence from a genuine shortage.
4. Refresh after resolution and retain useful history without leaving a resolved issue in the active queue.

**Data and controls.** The responsible role is not proof of a named assignee. Show unresolved ownership honestly. A link must respect route and record permissions; do not reveal inaccessible supplier, finance, or quality details.

**Complexity, dependencies, and owner.** C2 where authoritative issue data exists. Creating missing readiness rules belongs to NOV-051 or its domain feature. Coordinate with NOV-004/015/050/099. Department leads own resolution routes.

**Acceptance and measurement.** Exercise multiple blockers, changed source state, failed reads, unauthorized resolutions, and a resolved condition. Verify the final server action rechecks eligibility. Measure time from noticing a blocker to identifying the correct next person or action.

<a id="nov-083"></a>

### NOV-083 - Use the same page structure across modules

**Assessment:** C2 | U1 | N1. **Original:** Batch 5, item 3.

**Purpose and employee flow.** Employees should recognize where to search, filter, create, review, and save regardless of module. Familiar structure lets a user transfer knowledge from Customers to Orders or Production without relearning every page.

**Scope and starting point.** Consolidate existing SRC-UI and SRC-NAV patterns. Preserve the repository's separate overview, database, new, detail, and edit page purposes.

**Implementation.**
1. Document a small set of page compositions and shared action placements using existing components.
2. Standardize list toolbars, contextual navigation, section headings, primary/secondary actions, and error placement.
3. Migrate representative modules incrementally, preserving task-specific information rather than forcing identical screens.
4. Maintain a lightweight usage checklist so later features do not reintroduce divergent controls.

**Data and controls.** Presentation consistency does not make all users eligible for the same actions. Continue passing explicit permissions and source states into shared components. Avoid fetching extra data merely to fill a standard panel.

**Complexity, dependencies, and owner.** C2 because it coordinates shared composition across consumers. Coordinate with NOV-081/085/086/096. Product design owns conventions; module maintainers own adoption.

**Acceptance and measurement.** Compare the same operation across at least sales, stores, production, and accounts. Check narrow widths, keyboard order, long labels, loading, and role-specific action sets. Ask employees to find common controls in an unfamiliar module and record confusion before and after the pilot.

<a id="nov-084"></a>

### NOV-084 - Keep the current record identity visible

**Assessment:** C2 | U1 | N1. **Original:** Batch 5, item 4.

**Purpose and employee flow.** Employees editing a long record should always know its identity and customer context. A compact persistent strip helps prevent applying an action while mentally referring to another order or job.

**Scope and starting point.** Extend current page and record headers in SRC-UI/SRC-ORDER. The strip complements the compact page header and does not replace the full record summary.

**Implementation.**
1. Define the minimum identity per record type: business number, customer or profile, state, and relevant quantity.
2. Reuse the page's authorized read instead of issuing a competing lookup for the strip.
3. Keep the strip visible only where it adds context, and calculate offsets with application navigation and action bars.
4. Update it on confirmed record refresh and clearly distinguish an unsaved draft from a saved transaction.

**Data and controls.** Avoid internal UUIDs as primary employee identifiers. Do not expose financial values or customer details beyond the viewer's projection. An unavailable identity must not fall back to a previously viewed record.

**Complexity, dependencies, and owner.** C2 due to responsive composition and shared navigation/focus behavior. Coordinate with NOV-081/085/098/100. Frontend and module owners agree the identifying fields.

**Acceptance and measurement.** Test switching records, browser Back, long names, multiple tabs, draft creation, text enlargement, and phone keyboards. Ensure sticky content does not obscure focused inputs. Observe whether employees can state the active record without returning to the top.


<a id="nov-085"></a>

### NOV-085 - Keep important form actions within reach

**Assessment:** C2 | U1 | N1. **Original:** Batch 5, item 5.

**Purpose and employee flow.** Employees should be able to save, review, or complete a task without repeatedly scrolling to find its controls. A dispatch employee entering the final bundle should have the relevant next action within reach.

**Scope and starting point.** Create a shared action-bar composition around existing guarded form actions. Reuse current draft and pending-state behavior rather than introducing another submit mechanism.

**Implementation.**
1. Separate draft saving, review, and final confirmation with explicit labels and consistent ordering.
2. Use a sticky action area only when forms are long; make a short form's normal action area equally predictable.
3. Account for mobile keyboards, safe areas, bottom navigation, sticky identity, and browser zoom.
4. Bind controls to the same form/action identity, disable duplicate submission while pending, and retain a visible explanation for unavailable actions.

**Data and controls.** Saving a draft must not post stock or money. Pending and uncertain outcomes need distinct text. A fixed action bar must not cover validation messages or the focused field.

**Complexity, dependencies, and owner.** C2 for shared placement and interaction coordination. Coordinate with NOV-013/084/096/097/098/100. Product owns behavior; domain action owners retain transaction enforcement.

**Acceptance and measurement.** Test pointer, keyboard-only entry, phone keyboard opening, long labels, invalid forms, slow submission, and repeated taps. Verify one final request identity reaches the server. Measure scrolling to submit and accidental repeated attempts.

<a id="nov-088"></a>

### NOV-088 - Make phone cards shorter and more selective

**Assessment:** C2 | U1 | N1. **Original:** Batch 5, item 8.

**Purpose and employee flow.** A phone queue should let employees scan several jobs or loads quickly. The first view of a card should contain only its identity, main context, status, due information, and useful action.

**Scope and starting point.** SRC-UI DataTable already renders phone cards, but the inspected renderer includes all columns and repeats one column near the card heading. Add explicit mobile presentation metadata instead of deriving importance from column position.

**Implementation.**
1. Define primary identity, supporting context, status, key quantities, and secondary fields for each module.
2. Render a short consistent card with an accessible More details disclosure.
3. Preserve appropriate row navigation while making nested buttons independent and avoiding accidental activation.
4. Keep ten server-paginated records by default and maintain list context after opening a record.

**Data and controls.** Use existing authorized row projections. Hidden secondary fields are a presentation choice, not a security boundary. If a warning affects whether work can proceed, keep it visible in the compact card.

**Complexity, dependencies, and owner.** C2 because the adaptive renderer exists; the main work is explicit module metadata and interaction checks. Coordinate with NOV-018/083/089. Product and departmental users choose the minimum facts.

**Acceptance and measurement.** Test long identifiers, zero/large quantities, missing values, expanded cards, keyboard navigation, and 320/375 px widths. Observe how many records employees inspect before opening the right one and whether a critical warning is overlooked.

<a id="nov-091"></a>

### NOV-091 - Make active filters obvious

**Assessment:** C2 | U1 | N1. **Original:** Batch 5, item 11.

**Purpose and employee flow.** Employees should immediately know why a database view contains particular records. A label such as "Due today" or "Status: ready" should remain visible while they work.

**Scope and starting point.** Standardize filter presentation around existing server-paginated databases, URL state, and saved views. Preserve filtering semantics rather than adding a second client-only filter layer.

**Implementation.**
1. Define a typed parse/serialize contract for supported filters and sorting.
2. Show active filters as removable chips, the current query, and a clearly scoped count.
3. Provide Clear all and Reset to saved view as separate actions where needed.
4. Reset page position when the query changes, preserve it on normal Back navigation, and avoid stale responses replacing a newer query.

**Data and controls.** Only allow supported fields and operators. Apply filters and sorting on the server with company scope and role-safe columns. Do not show a global record count that includes inaccessible rows.

**Complexity, dependencies, and owner.** C2 for shared controls and existing query state. Coordinate with NOV-002/014/099. Database component ownership should centralize parsing and labels.

**Acceptance and measurement.** Verify combined filters, empty matches, removal of one chip, malformed URL values, shared URLs, saved views, and later pages. Measure records mistakenly thought missing and repeated filter setup. A failed filter request must retain prior context and display a failure state.

<a id="nov-092"></a>

### NOV-092 - Make selection menus easier to distinguish

**Assessment:** C2 | U1 | N1. **Original:** Batch 5, item 12.

**Purpose and employee flow.** Similar customer names, profile codes, and die numbers should be distinguishable before selection. The employee should see relevant context at the moment of choosing.

**Scope and starting point.** Extend SRC-UI SearchableSelect and SRC-FORM lookup adapters. Use module-approved identification fields instead of displaying every available attribute.

**Implementation.**
1. Provide customer options with business name and location/contact context, profile options with approved image and kg/m where available, and die options with status and location.
2. Keep the selected item's identifying context visible after the menu closes.
3. Debounce bounded server search, discard stale results, and support keyboard selection with visible focus.
4. Clearly distinguish no matches, failed lookup, inactive items, and unavailable images; retain permitted manual search alternatives.

**Data and controls.** Fetch only authorized metadata. A known selected record may require an exact-ID read outside the current search page. Compatibility warnings must come from domain rules and be rechecked at commitment.

**Complexity, dependencies, and owner.** C2 for richer rendering of established lookups; new compatibility allocation logic is separate. Coordinate with NOV-007/010/017/100. Master-data and department owners approve identifiers.

**Acceptance and measurement.** Test duplicate-looking names, customer aliases, inactive options, missing drawings, slow results, and keyboard-only use. Verify selections cannot cross companies and edited sources do not retain an invalid linked choice. Measure selection corrections and time spent reopening options.

<a id="nov-095"></a>

### NOV-095 - Place reference information beside task inputs

**Assessment:** C2 | U1 | N1. **Original:** Batch 5, item 15.

**Purpose and employee flow.** Show instructions where employees can use them. During inspection, the approved tolerance belongs beside the measurement input; during packing, the customer requirement belongs beside the packing decision.

**Scope and starting point.** Reuse existing approved customer requirements, technical references, and SOP snapshots. This entry improves placement and presentation; NOV-057/062/079 govern their release and applicability.

**Implementation.**
1. Define a field or section reference slot containing source title, revision, applicable requirement, and a link to permitted full evidence.
2. Present narrow reference content beside inputs on desktop and in a clear collapsible section on phones.
3. Keep mandatory warnings visible and show when reference data could not be loaded.
4. Support enlargement of approved drawings without discarding entered measurements or trapping keyboard focus.

**Data and controls.** Display the version bound to the work, not simply the latest master file. Do not cache one customer's reference under another record. Reference availability cannot substitute for recorded acknowledgement when the process requires it.

**Complexity, dependencies, and owner.** C2 if the applicable reference is already available. Coordinate with NOV-006/062/094/100. Quality and the process owner select essential content.

**Acceptance and measurement.** Verify obsolete/new revisions, missing references, permission denial, mobile disclosures, and preservation of form inputs after viewing a drawing. Measure external document lookups and requests to supervisors for task instructions.


<a id="nov-008"></a>

### NOV-008 - Use sensible visible defaults

**Assessment:** C2 | U2 | N2. **Original:** Batch 1, item 8.

**Purpose and employee flow.** Frequent entry should start with reasonable visible suggestions: today's business date, the employee's usual warehouse, or a commonly used packing location. Employees should review meaningful defaults and change them easily.

**Scope and starting point.** Extend existing form initializers and company/user preferences in SRC-FORM/SRC-NAV. Do not copy a previous transaction's price, actual measurement, or customer commitment indiscriminately.

**Implementation.**
1. Agree precedence for explicit source values, approved customer/site settings, company defaults, and personal preferences.
2. Label the origin of a suggested value and distinguish an untouched suggestion from a deliberate override.
3. Recompute only dependent suggestions after source changes, preserving an intentional employee override unless incompatible.
4. Provide a return-to-approved-default action and a visible warning for stale rates or missing configuration.

**Data and controls.** Store preferences with tenant/user scope and validate that selected machines or locations remain permitted and active. A default cannot satisfy a required physical observation, approval, or measurement. Use the Indian business calendar consistently.

**Complexity, dependencies, and owner.** C2 for bounded precedence rules and UI metadata. Coordinate with NOV-007/012/094. Department leads approve permissible defaults.

**Acceptance and measurement.** Test first use, changed company, another user, inactive location, midnight boundary, source refresh, and overridden values. Measure fields typed and corrected defaults. Pilot fields with clear business meaning before introducing broader personalization.

<a id="nov-060"></a>

### NOV-060 - Review the whole journey with the people involved

**Assessment:** C2 | U2 | N2. **Original:** Batch 3, item 20.

**Purpose and employee flow.** Periodically review how a real order moves from enquiry to payment, including informal calls, paper notes, and repeated searches. Use the findings to remove unnecessary steps and prioritize specific improvements.

**Scope and starting point.** Extend existing SOP observations, transaction timing, and outcome evidence rather than creating a separate reporting system. This is primarily an organizational practice supported by a bounded review record.

**Implementation.**
1. Select a representative product/order family and record the review scope, participants, and baseline period.
2. Build a journey view from recorded events; let reviewers annotate missing observations without inventing timestamps.
3. Distinguish active work, waiting, rework, approval, and information-search time.
4. Assign improvement actions, trial a revised method, and compare outcomes using the same definitions and a stated sample.

**Data and controls.** A proposed journey_review record can link permitted source records, observations, and actions. Keep personal assessments private to appropriate roles; aggregate process findings for broader use. Use [NIST value stream mapping guidance](https://www.nist.gov/mep/value-stream-mapping) as a method reference.

**Complexity, dependencies, and owner.** C2 for a small review workspace using existing evidence. NOV-053/054/059 supply improvement tracking and metrics. Operations owns the review with employee participation.

**Acceptance and measurement.** Reconstruct one real journey, explicitly mark missing events, trace actions to review findings, and repeat after a pilot. Success is an observed reduction in agreed waste or defects, with limitations recorded, rather than a polished diagram alone.

<a id="nov-089"></a>

### NOV-089 - Standardise quick record previews

**Assessment:** C2 | U2 | N2. **Original:** Batch 5, item 9.

**Purpose and employee flow.** An employee checking a few facts should retain their place in the queue. A preview beside the list can answer "Is this the right order?" without repeated full-page navigation.

**Scope and starting point.** SRC-DRAFT includes RecordPreview. Extend its consistent module coverage, safe projections, and responsive behavior; preserve dedicated pages for complex editing and full workflows.

**Implementation.**
1. Define bounded preview fields and permitted contextual links for each record type.
2. Use a side panel on wide screens and an appropriate narrow-screen sheet or page with a clear return.
3. Keep selected row, filters, pagination, and scroll context stable while the preview opens.
4. Handle source changes, cancellation of stale reads, loading, access loss, and the route to full details.

**Data and controls.** Preview queries must use authorized views and exact company-scoped identity. Do not load internal costing into a generic customer-facing preview. Opening a preview is a read and must not claim, assign, or change a task.

**Complexity, dependencies, and owner.** C2 because the preview pattern exists. Coordinate with NOV-002/084/088/100. Shared UI owns the container; module owners define fields.

**Acceptance and measurement.** Test rapid switching between rows, missing/deleted sources, permission changes, keyboard focus return, Escape, and phone Back behavior. Measure full-detail openings needed to resolve a simple lookup and verify the preview does not hide a material blocker.

<a id="nov-082"></a>

### NOV-082 - Offer comfortable and compact display options

**Assessment:** C2 | U3 | N2. **Original:** Batch 5, item 2.

**Purpose and employee flow.** Offer a deliberate choice between generous spacing and a denser workspace. Touch users can retain comfortable controls while experienced desktop employees see more useful rows without changing the underlying workflow.

**Scope and starting point.** Extend shared spacing and typography tokens around SRC-UI. Density is a user preference, not permission or a different business mode.

**Implementation.**
1. Define a small density token set for row padding, section spacing, control height, and secondary text.
2. Apply it consistently to compatible tables and forms; preserve a comfortable minimum on touch-heavy layouts.
3. Store the chosen setting under company/user or clearly defined device scope, with a discoverable reset.
4. Keep readable text, visible focus, and sufficiently separated controls in both modes.

**Data and controls.** No operational schema is needed; reuse a preference owner. Avoid compacting warnings, validation messages, or final-confirmation summaries until they become unreadable. Do not change row counts or preload all records as a density shortcut.

**Complexity, dependencies, and owner.** C2 for tokenization and consumer verification. Coordinate with NOV-083/088/090/100. Product design owns the two supported variants.

**Acceptance and measurement.** Test small laptops, phones, enlarged text, long names, nested controls, and keyboard interaction in both modes. Let employees compare readability and scanning effort. Keep this U3 because clear workflow, correct data, and reliable controls should be addressed before optional density tuning.



## C3: Module workflows and read models

These thirty-five entries require domain-aware reads, substantial interaction state, or bounded new workflow metadata.

<a id="nov-001"></a>

### NOV-001 - Make My Work Today the main working screen

**Assessment:** C3 | U1 | N1. **Original:** Batch 1, item 1.

**Purpose and employee flow.** Make the first working screen answer what the employee should do now, what is due, and what is blocked. A production employee opens an eligible job; accounts opens a collection commitment; dispatch opens a load needing preparation.

**Scope and starting point.** SRC-WORK already supplies assigned, unassigned, and department queues. Improve actionability and coverage instead of replacing it with another dashboard of summary numbers.

**Implementation.**
1. Agree role-specific queue eligibility, urgency ordering, due-date semantics, and the distinction between personal and team work.
2. Build bounded server reads or an authorized read model containing source identity, current state, owner, due information, and relevant action.
3. Reuse NOV-004 next-action and NOV-016 blocker contracts; keep each queue limited with a full-database link.
4. Refresh after confirmed work and expose read failures without clearing an otherwise useful queue.

**Data and controls.** Derive assignments from tasks and authoritative transaction state. Opening team work must not silently claim it. If claiming is offered, use an atomic eligibility-checked action. Exclude dealer/private work that the current user cannot access.

**Complexity, dependencies, and owner.** C3 because meaningful queues require several sources, permissions, state interpretation, and stable ordering. Depends on reliable task ownership and NOV-043/050. Operations and product own the queue definitions.

**Acceptance and measurement.** Test individual assignments, unassigned work, role changes, stale sources, due/undated items, cancelled tasks, and company separation. Pilot one production and one accounts role. Measure login-to-first-useful-action time and tasks overlooked in the prior process.

<a id="nov-004"></a>

### NOV-004 - Put one clear next action on each record

**Assessment:** C3 | U1 | N1. **Original:** Batch 1, item 4.

**Purpose and employee flow.** Each record should indicate the most useful permitted next step. An accepted quotation can lead to its order, while a dispatch awaiting packing explains that prerequisite rather than offering an action that will predictably fail.

**Scope and starting point.** SRC-ORDER already includes RecordNextAction and guarded domain transitions. Extend coverage and consistency across supported record types.

**Implementation.**
1. Define a typed action descriptor with label, source identity/version, destination or command, readiness, and a human-readable restriction.
2. Derive descriptors from shared domain eligibility rules, not a second frontend status map.
3. Carry the exact source into the destination form and reload authoritative options there.
4. After finalization, replace the action with its result and next useful link; handle already-completed work gracefully.

**Data and controls.** A visible button grants no authority. The committing action must recheck role, company, source revision, quantities, and duplicate state. Omit restricted explanations rather than leaking hidden financial or quality data.

**Complexity, dependencies, and owner.** C3 for a common action contract over several bounded existing workflows. Broader dependency invalidation belongs to NOV-034/057. Coordinate with NOV-016/097/098. Domain owners approve the action matrix.

**Acceptance and measurement.** Cover each supported state and role, stale tabs, concurrent completion, invalid deep links, and missing source reads. Confirm the employee reaches the correct preselected task and an ineligible server request fails safely. Measure module switching and wrong-action attempts.

<a id="nov-012"></a>

### NOV-012 - Ask employees for the quantity they actually know

**Assessment:** C3 | U1 | N1. **Original:** Batch 1, item 12.

**Purpose and employee flow.** Employees should enter the quantity they actually know and see derived quantities with a clear basis. For example, 100 pieces at 6 m and 0.8 kg/m yields 600 m and 480 theoretical kg; an actual scale reading remains a separate observation.

**Scope and starting point.** Extend current quotation, production, foundry, and dispatch calculation libraries. Preserve existing unit conversion and billing rules.

**Implementation.**
1. Define each workflow's input basis, permitted units, precision, and source of section weight.
2. Centralize conversions and derivations in shared libraries, then reuse them in previews, saves, and PDFs.
3. Label theoretical, measured, and contractual billing quantities and show which fields recalculate after a changed input.
4. Where alternatives conflict, require an explicit basis or reconciliation instead of silently overwriting an actual measurement.

**Data and controls.** Preserve original input unit and canonical value where required. Use approved technical revision/weight snapshots for historical transactions. Missing section weight blocks a dependent calculation; zero must not stand in for unavailable data.

**Complexity, dependencies, and owner.** C3 because multiple entry forms and document paths must agree. Coordinate with NOV-007/035/074/093/094. Technical, production, and accounts owners approve their quantity semantics.

**Acceptance and measurement.** Test mm/m/ft/in conversions, unit switching, rounding boundaries, zero/null, large counts, changed profile weight, and PDF reconciliation. Verify final server calculations match the reviewed basis. Measure calculator use, repeated quantity entry, and quantity corrections.

<a id="nov-018"></a>

### NOV-018 - Expand focused phone workflows for factory work

**Assessment:** C3 | U1 | N1. **Original:** Batch 1, item 18.

**Purpose and employee flow.** Let employees record short physical tasks near the machine, inspection point, packing area, or loading bay. A worker selects the job, records new observations, reviews, and confirms without navigating a desktop-sized form.

**Scope and starting point.** Extend existing mobile routes and bundle capture. Keep desktop and phone paths on the same authoritative actions, validations, and transaction identities.

**Implementation.**
1. Select high-frequency tasks through observation and define their minimum required inputs and reference context.
2. Present one focused task screen with large controls, appropriate numeric keyboards, optional photo/scan input, and a clear review action.
3. Retain entries through interruption and retry, using NOV-013 draft behavior where appropriate.
4. Return to the relevant queue or next permitted task after confirmed completion, preserving the last-used context where safe.

**Data and controls.** Device permissions and scanning are optional accelerators. Explicitly show offline, read failure, saving, and uncertain confirmation; never claim offline posting where no safe sync protocol exists. Record physical observations separately from planned values.

**Complexity, dependencies, and owner.** C3 for each bounded task family using existing domain actions; broad offline execution would increase complexity. Coordinate with NOV-017/085/088/100. The relevant supervisor owns a real-device pilot.

**Acceptance and measurement.** Test interruptions, camera denial, slow networks, repeated taps, narrow widths, large text, and concurrent source changes. Observe representative employees on actual devices and measure completion, errors, and help requests before expanding coverage.

<a id="nov-040"></a>

### NOV-040 - Give accounts a collection workflow with payment commitments

**Assessment:** C3 | U1 | N1. **Original:** Batch 2, item 20.

**Purpose and employee flow.** Accounts should see the next collection action, responsible employee, customer promise, and unresolved dispute beside the true invoice balance. A promised payment is a follow-up commitment until a receipt is recorded.

**Scope and starting point.** Extend SRC-FINANCE and existing customer commitments/tasks. Keep balances derived from posted invoices, receipts, credits, and reversals.

**Implementation.**
1. Link collection commitments to customers and relevant invoices, with promised date/amount, contact outcome, owner, and reasoned reschedule history.
2. Provide queues for due follow-ups, missed promises, disputed amounts, and unallocated receipts.
3. Reconcile commitment progress against actual allocations and keep partial fulfillment explicit.
4. Group reminders and resolve them when settlement or an approved dispute action changes the need.

**Data and controls.** Proposed collection metadata should reference existing commitments where possible. Restrict balances, notes, and contact details by finance authority. Rescheduling must retain the original promise. Do not automatically impose dispatch holds unless an approved credit policy permits it.

**Complexity, dependencies, and owner.** C3 for bounded commitment states and finance read models. Coordinate with NOV-019/042/050/078. Accounts owns definitions and follow-up responsibility.

**Acceptance and measurement.** Test partial receipts, reversed payments, credit notes, duplicate promises, disputed invoices, changed owners, and late requests after settlement. Measure overdue actions without owners, promise adherence, and time spent assembling collection lists; keep missing evidence visible.


<a id="nov-041"></a>

### NOV-041 - Give every order one accountable coordinator

**Assessment:** C3 | U1 | N1. **Original:** Batch 3, item 1.

**Purpose and employee flow.** Every live order should have one accountable coordinator who follows its entire journey. The coordinator maintains visibility across teams while each department still owns its execution and decisions.

**Scope and starting point.** Extend SRC-ORDER and task ownership. Distinguish order coordinator, current department owner, individual task assignee, and customer contact; these are different responsibilities.

**Implementation.**
1. Agree which role may coordinate an order and who may assign or replace the coordinator.
2. Reuse an existing ownership field if suitable; otherwise add a company-validated order responsibility relation with effective dates and history.
3. Show the coordinator beside commitments, blockers, and unanswered requests, with a work queue of orders needing coordination.
4. Require a reason and acknowledged transfer for reassignment or employee departure, with an eligible fallback.

**Data and controls.** Ownership must not grant new financial or technical permissions. Restrict assignment to active same-company employees and preserve historical attribution. A missing coordinator should remain visible, not default silently to the person last opening the page.

**Complexity, dependencies, and owner.** C3 because it introduces responsibility lifecycle and connected views. Coordinate with NOV-048/050/058. Operations owns the responsibility policy.

**Acceptance and measurement.** Test new orders, imported orders without owners, reassignment, deactivated employees, concurrent changes, and restricted users. Pilot one order family and verify every open issue has a resolvable owner. Measure unowned commitments and coordination effort rather than using task count as a staff ranking.

<a id="nov-043"></a>

### NOV-043 - Create one shared priority policy

**Assessment:** C3 | U1 | N1. **Original:** Batch 3, item 3.

**Purpose and employee flow.** Sales, planning, quality, and dispatch should understand the same agreed priority. A promoted urgent order should show why it moved and which other commitments now need review.

**Scope and starting point.** Extend existing task/order priority and order-line dates. Keep due date, commercial importance, readiness, and an approved expedite decision separate.

**Implementation.**
1. Agree a transparent ranking policy with explicit tie-breakers and review rights.
2. Centralize the ranking calculation or read ordering so role-specific queues do not invent contradictory priorities.
3. Record each manual expedite with reason, actor, effective time, and affected work.
4. Provide conflict visibility when several orders require the same constrained resource.

**Data and controls.** Store policy revision and decision history if priorities are computed from changing rules. Do not expose protected customer value to unauthorized roles; present a permitted operational rank instead. Readiness must remain visible even when an order has high priority.

**Complexity, dependencies, and owner.** C3 for policy metadata, shared ordering, and audited overrides. Rescheduling and frozen-window enforcement belong to NOV-044. Operations and sales jointly own the policy, with a named final decision role.

**Acceptance and measurement.** Test equal due dates, partial orders, overdue work, manual urgency, failed readiness, and changed policy versions. Verify the same order is ranked consistently wherever the same policy applies. Measure priority reversals, interruptions, and late commitments attributable to conflicting instructions.

<a id="nov-046"></a>

### NOV-046 - Agree service expectations between departments

**Assessment:** C3 | U1 | N1. **Original:** Batch 3, item 6.

**Purpose and employee flow.** Each receiving department should know what it can expect and what it must receive before accepting responsibility. Packing might require released material, quantity, order identity, packing instructions, and a defined location.

**Scope and starting point.** Extend SRC-HANDOFF acceptance, SOP completion, and turnaround targets. Agree service expectations before adding extra confirmations.

**Implementation.**
1. Define a handover contract per boundary containing prerequisites, units, evidence, responsible roles, response expectations, and permitted rejection reasons.
2. Version the contract and bind it to the handoff created by a source event.
3. Auto-accept straightforward work only where the approved policy permits; otherwise provide explicit acceptance and a concise return-for-clarification path.
4. Show response targets and unresolved returns in both source and receiving queues.

**Data and controls.** Reuse existing handoff and turnaround models. Proposed contract metadata should not create duplicate task totals. Record actual accepted quantities separately from expected quantities and retain return history. Business-hour calendars and wait reasons must be explicit.

**Complexity, dependencies, and owner.** C3 for extending existing cross-team contracts and views; event transaction changes remain under NOV-015. Coordinate with NOV-050/051/057. Sending and receiving department heads jointly approve the contract.

**Acceptance and measurement.** Test complete, incomplete, partially accepted, stale, and returned handovers. Verify responsibility stays assigned during clarification and reminders stop after resolution. Measure first-time acceptance and time waiting for missing information.

<a id="nov-048"></a>

### NOV-048 - Identify backup owners before somebody is absent

**Assessment:** C3 | U1 | N1. **Original:** Batch 3, item 8.

**Purpose and employee flow.** Important work should have an eligible backup before the primary employee is away. A leave handover should show open tasks and commitments, the replacement, duration, and any work that cannot be delegated.

**Scope and starting point.** Extend SRC-GOV temporary delegation and competency foundations. This is coverage of operational responsibilities, not shared accounts or automatic privilege escalation.

**Implementation.**
1. Define backup coverage by responsibility/team and confirm the replacement's current authority and competency.
2. Preview affected open work and incoming assignments during the coverage window.
3. Reuse an acknowledged, time-bounded delegation with reasoned exclusions and ownership history.
4. On expiry or early return, reconcile unfinished assignments without taking back completed or independently reassigned work.

**Data and controls.** Validate active same-company employees, team supervision, overlapping coverage, chains, and employee departure. A task requiring a qualification remains restricted even when its assignment transfers. Do not duplicate leave management if a trusted source already supplies absence.

**Complexity, dependencies, and owner.** C3 because existing delegation reduces implementation effort but responsibility coverage extends beyond a single task. Coordinate with NOV-041/047/055. Department heads own coverage.

**Acceptance and measurement.** Test absent backups, expired qualifications, overlapping windows, new tasks during leave, early cancellation, and replacement departure. Measure unowned or delayed work during absence and the amount of emergency coordination required.

<a id="nov-049"></a>

### NOV-049 - Run daily coordination from live records

**Assessment:** C3 | U1 | N1. **Original:** Batch 3, item 9.

**Purpose and employee flow.** A short daily coordination meeting should begin with live commitments and end with assigned decisions. Teams should not prepare separate slides merely to restate data already in ExtrusionOS.

**Scope and starting point.** Reuse SRC-WORK, stage timing, shift handovers, commitments, and planning snapshots. Support the meeting without turning attendance into a new operational burden.

**Implementation.**
1. Define a bounded agenda: today's due work, changed commitments, shortages, quality holds, capacity conflicts, and overdue decisions.
2. Capture an agenda snapshot with an as-of time and live source links; mark sources that failed to load.
3. Record each decision as an owner, due date, source, and agreed action linked to existing tasks or requests.
4. Carry unresolved decisions into the next agenda and show evidence of resolution.

**Data and controls.** A proposed coordination_session can retain the reviewed snapshot and decision links. Role-specific meetings must not expose restricted finance data. Avoid creating a fresh duplicate task each day for the same unresolved issue.

**Complexity, dependencies, and owner.** C3 for a multi-source read model and decision lifecycle. Coordinate with NOV-043/050/054. Operations owns meeting discipline and its small pilot.

**Acceptance and measurement.** Test stale snapshots, repeated sessions, missing sources, already resolved actions, changed owners, and company isolation. Measure meeting preparation time, decisions without owners, and repeated unresolved agenda items. Keep aggregate metrics distinct from a verified root cause.


<a id="nov-050"></a>

### NOV-050 - Make requests between teams trackable

**Assessment:** C3 | U1 | N1. **Original:** Batch 3, item 10.

**Purpose and employee flow.** An employee should be able to ask another team for a specific input, attach it to the affected order or job, and see when it is resolved. "Confirm packing instructions for SO-42 by tomorrow" becomes an actionable request with clear context.

**Scope and starting point.** Extend existing record discussions and notification requests described in the older catalogue. Keep discussion, formal approval, and operational handoff as distinct actions.

**Implementation.**
1. Define request kinds, permitted recipients, needed-by dates, source links, and completion criteria.
2. Provide request, acknowledge, clarify, resolve, and withdraw states with retained history.
3. Resolve automatically only where authoritative source state proves the requested work happened.
4. Group reminders, respect notification preferences, and return the requester to the relevant record after resolution.

**Data and controls.** Reuse task/request ownership and access checks. Request recipients must be eligible to see and act on the source. Record replies without treating a casual message as formal approval. Prevent repeated requests for the same unresolved purpose where appropriate.

**Complexity, dependencies, and owner.** C3 for bounded request states and notification/source coordination. Coordinate with NOV-015/041/046/098. Process owners define meaningful closure.

**Acceptance and measurement.** Test recipient access loss, employee departure, duplicate clicks, clarification, source completion, cancellation, and a reminder racing with resolution. Measure unanswered requests and time spent chasing outside the system.

<a id="nov-056"></a>

### NOV-056 - Assign ownership of important master data

**Assessment:** C3 | U1 | N1. **Original:** Batch 3, item 16.

**Purpose and employee flow.** Every important master-data field should have a responsible team and a correction route. Employees encountering a wrong profile weight or outdated customer instruction should know how to report it and which work is affected.

**Scope and starting point.** Extend current master-data management, controlled cleanup, customer requirements, technical snapshots, and discussion/task foundations.

**Implementation.**
1. Assign stewardship by master type and sensitive field group, including backup responsibility.
2. Provide a correction request with source evidence, proposed change, impact preview, and required review.
3. Version approved technical/commercial changes and identify unfinished drafts that need refresh.
4. Track unresolved reports and retain reasons for accepted, rejected, or superseded corrections.

**Data and controls.** Prefer a shared stewardship/change-request relation over owner fields scattered across every table. Validate actor authority and same-company sources. Merging duplicates needs a separate reviewed reference-migration plan; a stewardship request must not rewrite issued documents.

**Complexity, dependencies, and owner.** C3 for controlled metadata and correction lifecycle using existing masters. Full downstream invalidation belongs to NOV-034/057. Coordinate with NOV-007/062/094. Operations assigns steward roles; technical and accounts teams own their domains.

**Acceptance and measurement.** Test conflicting corrections, stale proposals, inactive owners, master revision changes, and issued-document preservation. Measure repeat errors, time to correct, and incomplete technical records. Pilot one frequently corrected master type before broad rollout.

<a id="nov-094"></a>

### NOV-094 - Explain where each field value came from

**Assessment:** C3 | U1 | N1. **Original:** Batch 5, item 14.

**Purpose and employee flow.** Employees should understand whether a field was copied from an order, suggested by a customer setting, calculated, or entered manually. When an upstream value changes, they should see what needs review.

**Scope and starting point.** Extend SRC-FORM autofill summaries and shared field rendering. This entry displays provenance; NOV-007 owns the underlying carry-over contract.

**Implementation.**
1. Define field provenance metadata: source type/identity/revision, input basis, last refresh, and explicit override state.
2. Attach provenance when applying defaults, selecting source records, or calculating dependent quantities.
3. Highlight changed suggestions without overwriting deliberate compatible overrides.
4. Provide a clear refresh or restore-from-source action and explain when a historical snapshot is intentionally retained.

**Data and controls.** Keep display-only draft provenance in form state unless audit or issued-document requirements justify persisted metadata. Recompute or verify authoritative provenance on save; never trust a browser label as evidence. Restrict source details to the viewer's permissions.

**Complexity, dependencies, and owner.** C3 because dependencies and overwrite behavior must agree across forms. Coordinate with NOV-008/012/062/096. Product defines the labels; domain owners define refresh rules.

**Acceptance and measurement.** Test source changes, manual overrides, repeated refresh, missing source, changed approved revision, form recovery, and forbidden fields. Verify theoretical values never appear as physical observations. Measure employees' ability to explain a displayed value and corrections caused by unnoticed autofill.

<a id="nov-096"></a>

### NOV-096 - Make validation specific and easy to resolve

**Assessment:** C3 | U1 | N1. **Original:** Batch 5, item 16.

**Purpose and employee flow.** An employee should be able to correct a form error without losing work or interpreting technical messages. A long form should provide a short linked issue summary and bring the relevant field into view.

**Scope and starting point.** Extend current Zod validation, form components, and domain action results. Preserve server/database enforcement even when browser validation is improved.

**Implementation.**
1. Standardize field identifiers and map validation issues into stable field paths and human-readable messages.
2. Validate at appropriate moments without interrupting every keystroke; retain values and revalidate corrected errors.
3. Expand hidden sections, focus the first relevant input, and associate its message programmatically.
4. Separate field problems, stale source conflicts, unavailable reads, and uncertain transaction outcomes.

**Data and controls.** Sanitize technical details and avoid exposing internal schema or restricted data. Business constraints such as insufficient eligible stock need an accurate source-based explanation, not a fabricated numeric-field error. Preserve allowed input after a failed request.

**Complexity, dependencies, and owner.** C3 because multiple form/action contracts must align. Coordinate with NOV-006/013/085/098/100. Shared form maintainers own the adapter; domain owners own messages and rules.

**Acceptance and measurement.** Exercise nested line errors, collapsed sections, duplicate identifiers, stale records, database rejection, phone keyboards, and screen-reader announcements. Confirm the same invalid final transaction is rejected through direct server entry. Measure correction cycles, abandoned forms, and repeated submissions.

<a id="nov-097"></a>

### NOV-097 - Show the consequence of a final action clearly

**Assessment:** C3 | U1 | N1. **Original:** Batch 5, item 17.

**Purpose and employee flow.** Before an employee commits stock, money, quality release, or another consequential change, show the exact effect in understandable terms. A dispatch review identifies the source material, quantities, destination, and stock consumption.

**Scope and starting point.** Extend existing review patterns and domain guards. This is a reusable review experience over bounded supported actions, not permission to introduce arbitrary direct mutations.

**Implementation.**
1. Define a domain preview containing source versions, proposed effects, warnings, and units.
2. Present a concise comparison of current and resulting state, preserving source links for inspection.
3. Bind confirmation to the reviewed request identity/fingerprint and reject material source changes.
4. Display the authoritative result or a specific conflict/uncertain state and retain the employee's inputs where safe.

**Data and controls.** Generate consequences on the server using the same business rules as finalization. Preview must not reserve or consume stock unless the domain explicitly models an expiring reservation. Recheck authorization at commit.

**Complexity, dependencies, and owner.** C3 for consistent review over existing transaction actions; adding new stock/finance lifecycles is C4/C5 domain work. Coordinate with NOV-004/051/098. Each process owner approves the review content.

**Acceptance and measurement.** Test changed quantity, source reversal, concurrent reservations, duplicate confirmation, expired preview, and timeout. Verify no success is displayed before authoritative confirmation. Measure incorrect confirmations and corrections needed immediately afterward.


<a id="nov-098"></a>

### NOV-098 - Keep meaningful action results visible

**Assessment:** C3 | U1 | N1. **Original:** Batch 5, item 18.

**Purpose and employee flow.** Employees should know whether work is saving, confirmed, failed, or still uncertain. A brief disappearing notification is insufficient evidence for a stock movement or payment.

**Scope and starting point.** Extend existing pending states, idempotent actions, and record histories. Preserve a visible result beside the transaction, including its business reference and useful next links.

**Implementation.**
1. Standardize action-result states while retaining domain-specific outcome details.
2. Store or recover a request identity for finalizing operations and query its authoritative outcome after interruption.
3. On success, display the confirmed record and effect; on failure, show what can be corrected; on uncertainty, offer a check-status action.
4. Use brief notifications for supplementary feedback and retained results for consequential operations.

**Data and controls.** Outcome lookup must be authorized to the same company/source and avoid leaking another employee's private work. A new retry identity must not create a second transaction while the earlier one may have succeeded. Do not label prepared/copied communication as delivered.

**Complexity, dependencies, and owner.** C3 because frontend state must reconcile with server request/outcome persistence. Coordinate with NOV-013/019/074/080/097. Domain action owners define definitive confirmation.

**Acceptance and measurement.** Simulate response loss after commit, actual rejection before commit, repeated taps, stale result reads, browser reload, and provider delay. Verify one transaction exists and the screen eventually reflects its true result. Measure duplicate attempts and uncertainty-related support requests.

<a id="nov-100"></a>

### NOV-100 - Make accessibility practical for everyday factory use

**Assessment:** C3 | U1 | N1. **Original:** Batch 5, item 20.

**Purpose and employee flow.** Employees should be able to use ExtrusionOS with enlarged text, keyboard navigation, different visual abilities, and the touch conditions of factory work. Accessibility must cover the complete task, including errors and confirmation.

**Scope and starting point.** Improve shared components first, then test their real module compositions. Existing mobile layouts and keyboard behaviors are useful foundations, not evidence of complete accessibility.

**Implementation.**
1. Review semantics, labels, headings, focus order, visible focus, colour-independent status, text contrast, and zoom/reflow.
2. Provide sufficiently large separated touch controls, non-hover help, usable dialogs/menus, and alternatives to scanning, dragging, or gesture-only actions.
3. Make validation, loading, saved results, and uncertain states understandable to assistive technologies.
4. Preserve reduced-motion preferences and verify sticky headers/action bars do not obscure focused controls.

**Data and controls.** Accessibility preferences must not change business permissions or validation. Protect sensitive live announcements and maintain ordinary session/tenant scope. Use the relevant [WCAG 2.2 guidance](https://www.w3.org/WAI/WCAG22/Understanding/) for criteria; a single automated scan cannot certify conformance.

**Complexity, dependencies, and owner.** C3 for systematic shared-component remediation and representative journey testing. Coordinate with NOV-083/085/088/092/096. Product/engineering own implementation with employee participation.

**Acceptance and measurement.** Combine automated checks with keyboard-only, text enlargement, screen-reader, touch, and real-device tasks. Include lookup selection, interrupted saving, review, and return navigation. Record specific barriers and task outcomes; prioritize barriers that prevent work ahead of cosmetic refinements.

<a id="nov-055"></a>

### NOV-055 - Connect training to demonstrated work

**Assessment:** C3 | U2 | N1. **Original:** Batch 3, item 15.

**Purpose and employee flow.** Training should lead from understanding a procedure through supervised practice to demonstrated independent capability. Supervisors should know which employees can perform a task and where backup coverage is weak.

**Scope and starting point.** Extend SRC-GOV competencies and SRC-SOP observed work. Keep acknowledgement of reading separate from proven competence.

**Implementation.**
1. Define qualification criteria, required evidence, permitted assessors, validity, and the effect of a changed SOP.
2. Link practice and supervised work to the applicable released procedure and recorded observations.
3. Present a team capability matrix showing eligible coverage and requalification needs without exposing unnecessary personal detail.
4. Use existing authorization guards for restricted start/release actions and provide a clear supervised route where policy allows.

**Data and controls.** Preserve grant, withdrawal, assessor, revision, and expiry history. Employees must not self-grant independent authority except where an explicit existing owner policy permits it. Changing assignment does not create competence.

**Complexity, dependencies, and owner.** C3 because competency foundations exist, but assessment evidence and coverage views require coordination. Depends on NOV-048/051/057 and approved training content. Department heads and quality own criteria.

**Acceptance and measurement.** Test expired grants, procedure revision, absent assessors, withdrawn qualification during a task, supervised confirmation, and cross-company access. Pilot one critical task with real employee observations. Measure first-time acceptance, supervision needed, and coverage; avoid uncontextualized employee rankings.

<a id="nov-070"></a>

### NOV-070 - Link inspection results to measuring equipment

**Assessment:** C3 | U2 | N1. **Original:** Batch 4, item 10.

**Purpose and employee flow.** Quality should know which instrument produced a measurement and what evidence supported its suitability at that time. If a gauge later fails a check, the system should help locate potentially affected inspections.

**Scope and starting point.** Extend existing inspection plans, quality results, documents, and equipment identity where available. Do not confuse instrument ownership or a sticker date with complete measurement traceability.

**Implementation.**
1. Maintain instrument identity, type/range, status, location, calibration/check evidence, and approved use restrictions.
2. Bind each relevant inspection result to the instrument and its applicable evidence revision.
3. Warn or block use under a quality-approved policy when evidence is missing, expired, or unsuitable.
4. Provide an impact query for a withdrawn instrument over a defined measurement period, routed for quality review.

**Data and controls.** Proposed instrument/evidence relations must be company-scoped and versioned. Preserve original measurement and evidence; record corrections through review. Calibration intervals and acceptable uncertainty require technical approval. [NIST guidance](https://www.nist.gov/calibrations/traceability) explains the documented reference chain and uncertainty involved.

**Complexity, dependencies, and owner.** C3 for bounded master/evidence/result links. Coordinate with NOV-033/051/071/100. Quality owns suitability rules.

**Acceptance and measurement.** Test expired and replaced evidence, instrument withdrawal, readings outside range, missing instrument, unauthorized edits, and historical inspection retrieval. Measure untraceable results and time to identify affected material; validate the process with the actual instruments in use.

<a id="nov-003"></a>

### NOV-003 - Make search usable directly from every screen

**Assessment:** C3 | U2 | N2. **Original:** Batch 1, item 3.

**Purpose and employee flow.** Employees should find a permitted record and act on it from any working screen. Search should support the identifiers they know, including customer name, phone, profile code, die number, order number, and vehicle number.

**Scope and starting point.** Reuse SRC-SEARCH Instant Find, existing server search, and contextual links. Bring the interaction into the application shell and phone experience consistently.

**Implementation.**
1. Define role-approved searchable resource adapters with safe result fields and bounded indexed queries.
2. Offer immediate suggestions, clear resource labels, and enough context to distinguish similar results.
3. Add discoverable keyboard entry and a phone-accessible trigger, while preserving a normal search page.
4. Carry source identity into permitted actions and discard stale responses when the query changes.

**Data and controls.** Scope every resource read by company and permissions. Do not include hidden costing or customer data in search snippets. Recheck action eligibility after opening the result. Consider business-code normalization without making unrelated records indistinguishable.

**Complexity, dependencies, and owner.** C3 for multi-resource search quality, authorization, and shell interaction. Coordinate with NOV-004/092/100. Product and domain owners define supported identifiers.

**Acceptance and measurement.** Test partial source outages, special-character codes, similar customers, revoked access, rapid typing, empty matches, and narrow screens. Verify a stale result cannot execute an ineligible action. Measure time to the correct record and subsequent module navigation.


<a id="nov-009"></a>

### NOV-009 - Extend Repeat Previous beyond quotations

**Assessment:** C3 | U2 | N2. **Original:** Batch 1, item 9.

**Purpose and employee flow.** Repeat business should begin from a suitable prior record or approved setup. The employee reviews copied information, updates what changed, and creates a fresh transaction with its own identity.

**Scope and starting point.** Extend existing repeat-quotation behavior to carefully selected production, purchasing, or transport use cases. An approved template is distinct from copying an arbitrary completed record.

**Implementation.**
1. Define copy rules per field: retain specification, refresh dated terms, clear transaction identity/approval, and require new physical observations.
2. Present copied values and stale-source warnings in an unsaved draft.
3. Revalidate master activity, compatibility, availability, current rates, dates, and source authority.
4. Save the new record through its existing action and retain a lineage link to the template/source.

**Data and controls.** Never copy posted stock movements, payments, dispatch consumption, signatures, or final approvals. Version approved templates and restrict their creation/release. The source record remains unchanged and access must be checked at repeat time.

**Complexity, dependencies, and owner.** C3 for each bounded template family using existing save paths. Coordinate with NOV-007/008/013/094. Process owners approve which fields are reusable.

**Acceptance and measurement.** Test inactive masters, expired rates, multiple revisions, unavailable die, missing source permission, incomplete draft, and interrupted save. Confirm the new transaction has fresh identity and review requirements. Measure entry time and copied-value corrections rather than assuming all repeated data is still valid.

<a id="nov-010"></a>

### NOV-010 - Create missing master records without leaving the task

**Assessment:** C3 | U2 | N2. **Original:** Batch 1, item 10.

**Purpose and employee flow.** Employees should be able to add a missing permitted customer, transporter, or vendor without abandoning their current task. After creation, the new record should be selected and the unfinished transaction preserved.

**Scope and starting point.** Extend the existing in-quotation customer creation pattern in SRC-FORM to approved additional master types.

**Implementation.**
1. Define a minimal creation form per master with only required fields and a route to later completion.
2. Search likely duplicates and let the employee select an existing active match.
3. Submit through an authorized server action, then resolve/select the exact newly created identity.
4. Preserve all parent form lines, quantities, notes, and commercial details through create, cancel, failure, and retry.

**Data and controls.** Derive tenant identity on the server. Enforce real uniqueness constraints where appropriate and treat fuzzy duplicate suggestions as advisory. Do not grant master-create rights merely because the employee can create an operational transaction.

**Complexity, dependencies, and owner.** C3 because different masters have different validation and stewardship needs. Coordinate with NOV-013/056/092/096. Each master-data owner approves its short form.

**Acceptance and measurement.** Test duplicate-looking names, simultaneous creation, permission denial, validation failure, parent draft recovery, and new records outside the current lookup result page. Verify no parent values disappear and selecting a duplicate does not create another master. Measure abandoned tasks and temporary/free-text substitutes.

<a id="nov-011"></a>

### NOV-011 - Make repeated line entry work like a spreadsheet

**Assessment:** C3 | U2 | N2. **Original:** Batch 1, item 11.

**Purpose and employee flow.** Repeated line entry should support keyboard flow, duplication, and reviewable paste from Excel. Employees can enter familiar rows quickly while retaining precise validation for each line.

**Scope and starting point.** Reuse existing quotation paste and keyboard helpers in SRC-FORM. Extend them to additional eligible line editors instead of embedding an unrestricted spreadsheet engine.

**Implementation.**
1. Define accepted columns, units, paste formats, row limits, and lookup matching rules.
2. Parse pasted content into a review grid showing valid, ambiguous, and invalid rows.
3. Support predictable Tab/Enter navigation and duplicate-line actions that clear transaction-specific identities.
4. Submit validated domain lines through existing save actions; retain unsaved rows after errors.

**Data and controls.** Reject unknown or privileged fields. Neutralize formula injection in exported CSV/spreadsheet content and never execute pasted formulas. Ambiguous customer/profile codes require explicit resolution. Recalculate totals from trusted line data.

**Complexity, dependencies, and owner.** C3 because parsing, focus, source matching, and domain validation interact. Coordinate with NOV-009/012/013/092/096. Sales or purchasing owns each import template.

**Acceptance and measurement.** Test tabs/newlines/quotes, mixed units, duplicate rows, invalid decimals, large but bounded input, hidden columns, and stale lookup matches. Verify each rejected row has an explanation and no partial save is silently implied. Measure line-entry time, mouse dependence, and correction frequency.

<a id="nov-017"></a>

### NOV-017 - Make QR scanning lead directly into the relevant task

**Assessment:** C3 | U2 | N2. **Original:** Batch 1, item 17.

**Purpose and employee flow.** A scan should identify the billet, bundle, die, or job and open its relevant permitted task. It should shorten lookup, while leaving a normal search/manual route available.

**Scope and starting point.** Extend existing QR scanner and mobile entry routes using current source identities and domain actions.

**Implementation.**
1. Define versioned payloads with entity type and stable internal reference; keep sensitive business data out of the code.
2. Resolve the scanned identity through an authenticated company-scoped lookup.
3. Show identifying context and permitted next actions, with explicit warnings for held, inactive, or already consumed material.
4. Support continuous scanning for a bounded task, with duplicate-scan feedback and review before commitment.

**Data and controls.** Treat every scanned payload as untrusted, reject arbitrary URLs/commands, and recheck source status at finalization. A copied label is not proof of physical custody. Define authorized label reprint and damaged-code fallback procedures.

**Complexity, dependencies, and owner.** C3 using existing scan components; secure physical-label lifecycle and high-volume loading need coordinated domain work. Coordinate with NOV-018/068/074/079/100. Stores/production/dispatch own pilots.

**Acceptance and measurement.** Test another company's code, invalid versions, camera denial, repeated scans, poor lighting, unreadable labels, held stock, and concurrent reservation. Trial on actual tags and devices. Measure identification errors and time per item, including failed scans.

<a id="nov-025"></a>

### NOV-025 - Give every die a useful operating history

**Assessment:** C3 | U2 | N2. **Original:** Batch 2, item 5.

**Purpose and employee flow.** Planners should see a die's operating history, condition, location, and relevant performance before assigning it. Maintenance and quality should be able to connect recurring problems to particular runs and corrections.

**Scope and starting point.** Extend existing dies, production jobs, maintenance, quality, and report foundations. Do not replace actual run evidence with manually maintained lifetime totals.

**Implementation.**
1. Build a timeline of confirmed runs, output, corrections, inspections, moves, maintenance, and status decisions.
2. Define how quantities contribute to operating exposure and how reversals/corrections affect totals.
3. Add reviewed inspection or maintenance thresholds per die family where justified.
4. Show applicable warnings in selection and scheduling, while retaining the authoritative compatibility guard.

**Data and controls.** Missing historical usage must remain identified as incomplete. A correction does not reset lifetime usage unless an approved engineering policy explicitly defines a separate metric. Financial tooling ownership belongs to NOV-065.

**Complexity, dependencies, and owner.** C3 for lineage-aware aggregation and maintenance evidence. Coordinate with NOV-026/027/056. Tooling/production owns technical thresholds and data cleanup.

**Acceptance and measurement.** Test cancelled runs, corrected output, missing history, alternate dies, maintenance withdrawal, and tenant restrictions. Compare computed totals with a sample of source records. Measure unavailable-die surprises and time spent finding history; validate any service threshold with the technical team.


<a id="nov-053"></a>

### NOV-053 - Give recurring problems a permanent improvement owner

**Assessment:** C3 | U2 | N2. **Original:** Batch 3, item 13.

**Purpose and employee flow.** Repeated issues should lead to a lasting corrective improvement, not merely repeated task closure. Several packing errors may share one underlying instruction problem that needs an accountable owner and a trialled fix.

**Scope and starting point.** Extend existing NCR/complaint, exception, and procedure-effectiveness workflows. Keep immediate containment, cause investigation, and verified improvement as separate outcomes.

**Implementation.**
1. Group related incidents using reviewed categories and source links, retaining individual occurrences.
2. Assign an improvement owner, investigation evidence, proposed action, trial scope, and review date.
3. Link approved process or training changes to the improvement and compare recurrence using defined denominators.
4. Close only after the agreed effectiveness review, with reopening when evidence warrants it.

**Data and controls.** Reuse existing improvement records where possible; add structured incident links rather than duplicating complaints. Distinguish employee observations from established causes. Restrict sensitive personnel and customer evidence.

**Complexity, dependencies, and owner.** C3 for an evidence-based lifecycle and outcome reads. Coordinate with NOV-054/057/059/060. Quality or the process owner leads the review.

**Acceptance and measurement.** Test duplicate incident linking, wrong category correction, cancelled trials, missing outcome data, and recurrence after closure. Follow a small [plan-do-check-act trial](https://asq.org/quality-resources/pdca-cycle). Measure repeated defects and unresolved corrective actions while documenting sample size and other changes that could affect results.

<a id="nov-054"></a>

### NOV-054 - Measure team outcomes with useful context

**Assessment:** C3 | U2 | N2. **Original:** Batch 3, item 14.

**Purpose and employee flow.** Managers and teams should see operational outcomes with context: workload, due dates, first-time acceptance, rework, waiting, and missing evidence. The view should support choosing improvements rather than encouraging superficial task closure.

**Scope and starting point.** Reuse analytics, report, SOP-effectiveness, and transaction timing foundations. The development checkout contains separate KPI work; reconcile it before implementation and preserve its owner changes.

**Implementation.**
1. Define each metric's numerator, denominator, time basis, exclusions, owner, and source.
2. Build role-safe server aggregates with drill-down to permitted records and a visible as-of time.
3. Separate elapsed time, active time, recorded waiting, and unrecorded duration.
4. Compare like-for-like task families and periods; mark small samples or incomplete sources explicitly.

**Data and controls.** Avoid averaging incompatible units or presenting missing events as zero. Access to individual performance details needs an approved organizational policy and suitable scope. Retain metric-definition versions for historical interpretation.

**Complexity, dependencies, and owner.** C3 for trustworthy read models and definitions. Coordinate with NOV-028/049/053/060. Operations and department heads approve metrics before engineering charts.

**Acceptance and measurement.** Reconcile a sample against source records, exercise changed statuses/reversals, timezone boundaries, partial outages, and permission filters. A dashboard is accepted when staff can explain its figures and use them to identify a specific issue; visual polish alone is insufficient.

<a id="nov-059"></a>

### NOV-059 - Give employees a practical improvement channel

**Assessment:** C3 | U2 | N2. **Original:** Batch 3, item 19.

**Purpose and employee flow.** Employees should be able to report unnecessary entry, confusing instructions, repeated lookups, or avoidable waiting from the screen where it happens. They should see what became of their suggestion.

**Scope and starting point.** Extend existing step feedback, observations, discussions, and controlled improvements. Keep this lightweight and distinct from customer complaints or emergency operational blockers.

**Implementation.**
1. Offer a concise suggestion form with category, source screen/task, description, and optional supporting evidence.
2. Route it to the relevant process owner with acknowledge, clarify, trial, adopt, decline-with-reason, and resolved states.
3. Link trials and releases to the originating suggestion; merge duplicate suggestions through explicit relationships.
4. Notify the contributor of meaningful changes and provide a simple view of their submissions.

**Data and controls.** Do not collect sensitive draft payloads automatically. Limit attached screenshots or records to permitted company scope and avoid exposing confidential comments. Define respectful access and retention rules with management.

**Complexity, dependencies, and owner.** C3 for routing and a retained improvement lifecycle, reduced by existing SOP feedback. Coordinate with NOV-053/057/060. Each process owner is responsible for response and review.

**Acceptance and measurement.** Test inaccessible source links, duplicate ideas, confidential evidence, owner changes, declined suggestions, and a completed trial. Measure time to response, recurring friction addressed, and outcomes of adopted ideas. Pilot one department and verify contributors receive useful feedback.

<a id="nov-075"></a>

### NOV-075 - Manage delivery appointments and site readiness

**Assessment:** C3 | U2 | N2. **Original:** Batch 4, item 15.

**Purpose and employee flow.** Dispatch should know that the site can receive the load, at the agreed time, with the right contact, access, documents, and unloading arrangement.

**Scope and starting point.** Extend order/site information, customer commitments, and dispatch preparation. A requested slot, customer-confirmed appointment, and actual arrival are different facts.

**Implementation.**
1. Capture appointment request/confirmation, timezone, address/site revision, receiving contact, access restrictions, and required preparations.
2. Reuse approved customer/site defaults but highlight dispatch-specific differences.
3. Surface unconfirmed or changed arrangements in load review and assign follow-up.
4. Record reschedule, cancellation, arrival, and relevant outcomes without rewriting earlier commitments.

**Data and controls.** Proposed delivery_appointment metadata should reference the existing order/dispatch/site. Restrict personal contact data. A site confirmation must not bypass stock, quality, credit, or vehicle checks. External calendar/message delivery needs separately verified integration.

**Complexity, dependencies, and owner.** C3 for a bounded appointment lifecycle and dispatch integration. Coordinate with NOV-036/050/076/079. Dispatch and sales agree who secures confirmation.

**Acceptance and measurement.** Test changed site address, overnight slot, multiple deliveries, missed appointment, phone access, and unavailable recipient information. Verify the reviewed appointment revision is retained with the shipment. Measure failed unloading attempts and waiting attributable to missing site preparation.

<a id="nov-077"></a>

### NOV-077 - Track returnable gate passes and custody

**Assessment:** C3 | U2 | N2. **Original:** Batch 4, item 17.

**Purpose and employee flow.** Track dies, gauges, racks, or pallets that leave temporarily and should return. Staff should see who holds the item, why it left, expected return, partial returns, and condition.

**Scope and starting point.** Extend existing asset/die identity, maintenance, documents, and vendor/customer records. Distinguish returnable custody from a sale or permanent stock transfer.

**Implementation.**
1. Create an approved gate pass with item identity, quantities, custodian, purpose, due date, and issue evidence.
2. Record actual departure, receipt acknowledgement where appropriate, and return inspections.
3. Support partial return, authorized extension, damage, loss, and final closure with history.
4. Link an unavailable die or gauge to planning/inspection context so custody is operationally visible.

**Data and controls.** Proposed custody events must prevent issuing the same serialized asset twice. Quantity-based returnables require a balance; serialized tooling needs exact identity. Gate-pass printing must follow permissions and retain document revisions.

**Complexity, dependencies, and owner.** C3 for bounded asset custody and balance checks. Coordinate with NOV-025/026/070/078. Stores or tooling owns custody; the requesting department owns return follow-up.

**Acceptance and measurement.** Test duplicate issue, partial returns, expired extension, damaged item, changed custodian, missing acknowledgement, and concurrent actions. Reconcile a physical sample with outstanding passes. Measure overdue assets and time spent locating equipment.


<a id="nov-087"></a>

### NOV-087 - Show workflow progress visually

**Assessment:** C3 | U2 | N2. **Original:** Batch 5, item 7.

**Purpose and employee flow.** A compact progress strip should show recorded completion, current work, future steps, and blockers. Employees can understand where an order stands and open the evidence behind a stage.

**Scope and starting point.** Reuse order stage history, transaction-derived progress, and approved workflow paths. A simple status label alone may not establish that every prerequisite stage is complete.

**Implementation.**
1. Define a visual stage contract with applicable, complete, current, blocked, skipped-by-policy, and unavailable states.
2. Derive completion from source evidence and use the workflow version applicable to the order.
3. Support partial progress and parallel activities without forcing them into a misleading single line.
4. Provide permitted stage links and concise blocker explanations, with a compact phone layout.

**Data and controls.** Do not calculate a percentage by counting labels when quantities or parallel work matter. Distinguish planned from actual dates, and leave missing evidence explicit. Stage navigation must not perform a transition by itself.

**Complexity, dependencies, and owner.** C3 because trustworthy progress needs domain interpretation and several read sources. Coordinate with NOV-005/015/028/051/052. Product and process owners approve stage meaning.

**Acceptance and measurement.** Test partial dispatch, reopened work, skipped stages, simultaneous finishing/production, returned inspections, and failed source reads. Verify each completed visual stage has explainable evidence. Ask employees to identify current status and next dependency from representative orders.

<a id="nov-039"></a>

### NOV-039 - Measure supplier and finishing-vendor reliability

**Assessment:** C3 | U3 | N2. **Original:** Batch 2, item 19.

**Purpose and employee flow.** Purchasing and production should compare supplier or finisher performance using recorded delivery and acceptance outcomes, alongside the current offer.

**Scope and starting point.** Extend SRC-PURCHASE comparisons, receipts, and SRC-FINISH outcomes. Keep performance evidence separate from a discretionary supplier approval decision.

**Implementation.**
1. Define on-time receipt, quantity fulfillment, first-time acceptance, discrepancy, and turnaround metrics with agreed date baselines.
2. Preserve original and revised supplier commitments so rescheduling does not erase lateness.
3. Aggregate comparable material/service categories with sample counts, periods, and missing-data indicators.
4. Link figures to permitted source transactions and show relevant history during selection or comparison.

**Data and controls.** Restrict supplier rates and commercial claims. Separate delays attributable to internal late instructions from supplier performance when evidence supports attribution. A low sample must not imply a reliable rank.

**Complexity, dependencies, and owner.** C3 for reconciliation-aware analytics over existing events. Coordinate with NOV-031/054/069/078. Purchasing and quality agree definitions.

**Acceptance and measurement.** Test partial receipts, rejected material, revised dates, cancelled POs, disputed shortages, and incomplete history. Recalculate a sample manually from sources. Measure whether the view improves supplier follow-up and comparison; avoid presenting correlation as proof of cause.

<a id="nov-066"></a>

### NOV-066 - Understand why quotations are won or lost

**Assessment:** C3 | U3 | N2. **Original:** Batch 4, item 6.

**Purpose and employee flow.** Understand why enquiries become orders or are lost so the company can improve prices, lead times, availability, and follow-up. Sales should record an outcome with minimal extra effort.

**Scope and starting point.** Extend quotations, customer commitments, revisions, and order conversion. Preserve transaction-derived wins and distinguish confirmed loss from no response.

**Implementation.**
1. Define a short outcome taxonomy with optional customer evidence and product-family context.
2. Derive converted quantities/value from linked orders, supporting partial wins across quote lines.
3. Let sales record lost/withdrawn/no-decision outcomes and subsequent reopening with history.
4. Present cohort-based results with explicit denominator, period, and permitted commercial detail.

**Data and controls.** Record original decision/quote revision and avoid counting every revision as another sales opportunity. Reasons supplied by sales may be observations rather than customer-confirmed causes. Restrict margin and internal competitor notes.

**Complexity, dependencies, and owner.** C3 for outcome semantics, lineage, and analysis. Coordinate with NOV-009/040/054/064. Sales management owns definitions and data quality.

**Acceptance and measurement.** Test partial conversion, repeated revisions, expired quotes, reopened opportunities, missing reasons, and cancelled orders. Reconcile conversion counts against unique opportunities. Measure completeness and usefulness of reasons, then review recurring issues with purchasing/production instead of relying on raw win-rate rankings.

<a id="nov-071"></a>

### NOV-071 - Track external laboratory testing

**Assessment:** C3 | U4 | N3. **Original:** Batch 4, item 11.

**Purpose and employee flow.** Where external testing is used, track a request from sampling through laboratory receipt, results, review, and the decisions waiting for it.

**Scope and starting point.** Extend quality inspections, samples, documents, supplier/service records, and customer requirements. This feature is conditional on a recurring laboratory-testing process.

**Implementation.**
1. Identify the material/sample, required tests/method revision, lab, promised date, and estimated charge.
2. Record dispatch, chain-of-custody acknowledgements, partial results, revised dates, and report receipt.
3. Bind reviewed reports/results to the sample and applicable batch; route release or nonconformance decisions through quality.
4. Surface overdue results and affected orders without automatically accepting an uploaded report.

**Data and controls.** Proposed laboratory_request/result references need tenant scope and immutable report revisions. Separate lab statements from internal approval. Retesting must preserve earlier evidence and sample identity; provider portals are optional later integrations.

**Complexity, dependencies, and owner.** C3 for a bounded request/evidence lifecycle. Coordinate with NOV-033/063/070/077. Quality owns test applicability and report review.

**Acceptance and measurement.** Test mislabeled sample, partial report, amended certificate, failed result, lost shipment, overdue response, and unauthorized access. Pilot one actual lab/test family. Measure outstanding tests, report-to-decision time, and cases where missing results delay a committed order.

<a id="nov-073"></a>

### NOV-073 - Control finish and shade references across repeat orders

**Assessment:** C3 | U4 | N3. **Original:** Batch 4, item 13.

**Purpose and employee flow.** Repeated orders for the same project should use the applicable approved finish and shade reference. Staff should be warned before mixing batches that require a reviewed match.

**Scope and starting point.** Extend profile/finish masters, customer/project requirements, sample approvals, finishing jobs, and inspections.

**Implementation.**
1. Maintain reference identity, revision, finish specification, customer/project applicability, and approval evidence.
2. Bind the relevant reference to order lines and the vendor finishing instruction.
3. Record returned-batch inspection and an approved match/acceptance decision under the agreed process.
4. Flag mixed references, superseded samples, and unreviewed combinations in packing/load preparation.

**Data and controls.** Photographs can support identification but must not be treated as a calibrated colour measurement. Preserve physical sample location and agreed assessment conditions where required. A later reference change must not rewrite earlier approvals.

**Complexity, dependencies, and owner.** C3 for bounded reference, applicability, and inspection links; automated colour measurement would be additional specialist work. Coordinate with NOV-031/062/063/079. Quality and sales approve requirements with the finishing vendor.

**Acceptance and measurement.** Test repeat projects, similar shade names, obsolete samples, split vendor batches, missing approval, and an authorized deviation. Trial with a real project that has shade-sensitive requirements. Measure finish-related rework and time spent locating the correct reference.



## C4: Cross-module controls and transactions

These thirty-four entries cross operational boundaries. Deliver small vertical slices with explicit transactional and reconciliation evidence.

<a id="nov-005"></a>

### NOV-005 - Finish the connected order workspace

**Assessment:** C4 | U1 | N1. **Original:** Batch 1, item 5.

**Purpose and employee flow.** The order detail should be the dependable place to answer what was ordered, what is available, what has been produced, what is held, what has shipped, and what remains. Staff can follow evidence into the responsible workflow without reconstructing the order manually.

**Scope and starting point.** Extend SRC-ORDER progress, source-linked jobs, stock coverage, packing, dispatch, invoicing, and payment reads. The inspected progress contract supports per-line production but packing/dispatch remains order-level; do not invent line attribution.

**Implementation.**
1. Define quantity meaning and lineage for each stage, keeping open plans separate from accepted physical output.
2. Build bounded authorized read models with an as-of time and source-level failures.
3. Add line identity to future packing/dispatch source records through an additive migration and explicit capture/backfill policy.
4. Present stage/line balances, unlinked historical work, blockers, documents, and permitted next actions.
5. Reconcile corrections, cancelled jobs, returned stock, credits, and split fulfillments against their authoritative sources.

**Data and controls.** Avoid joins that multiply quantities across several one-to-many relationships. Aggregate each source independently. Preserve unknown historical line links instead of proportionally assigning them. Expose commercial/finance sections only to eligible roles.

**Complexity, dependencies, and owner.** C4 due to cross-module lineage and quantity reconciliation. Coordinate with NOV-007/027/028/034/058/068/076/087. Operations owns definitions with stores, production, quality, dispatch, and accounts.

**Acceptance and measurement.** Use multi-line orders, stock-plus-production coverage, partial packing/dispatch, reversals, returns, and unavailable sources. Reconcile against source ledgers and test independent competing sessions where commitments change. Pilot an actual order family and measure time to answer a customer progress question accurately.

<a id="nov-007"></a>

### NOV-007 - Carry known information through the entire process

**Assessment:** C4 | U1 | N1. **Original:** Batch 1, item 7.

**Purpose and employee flow.** Known customer, site, technical, and commercial facts should follow their source through quotation, order, job, packing, dispatch, and billing. Employees review inherited information and enter only new facts or deliberate changes.

**Scope and starting point.** Extend existing SRC-FORM autofill, customer/site snapshots, accepted-order versions, and technical profiles. Preserve the distinction between a live master suggestion and an issued historical snapshot.

**Implementation.**
1. Specify source precedence for customer, project/site, order, line, approved revision, and permitted override.
2. Define typed source-to-draft mapping functions in shared domain libraries and use them in server actions and form initialization.
3. Track relevant source version/fingerprint and display provenance through NOV-094.
4. Refresh changed draft suggestions deliberately and invalidate incompatible dependencies.
5. Snapshot required facts at confirmation/issue and reuse those snapshots in downstream documents.

**Data and controls.** Reconcile existing snapshot columns before adding relations. Same-company checks and role-safe projections apply to every source. Updating a customer master must not rewrite an issued invoice. Source fetching failure must not silently substitute empty addresses or zero rates.

**Complexity, dependencies, and owner.** C4 because precedence, history, security, and several domain boundaries must agree. Coordinate with NOV-008/012/034/056/062/094. Sales, technical, and accounts jointly approve field ownership.

**Acceptance and measurement.** Test site overrides, changed master details, old issued documents, inactive profiles, repeated revisions, stale browser tabs, and role-hidden fields. Compare saved transactions and PDFs to their reviewed source versions. Measure repeated fields typed and inconsistent shared facts in real workflows.

<a id="nov-013"></a>

### NOV-013 - Extend dependable drafts to every lengthy form

**Assessment:** C4 | U1 | N1. **Original:** Batch 1, item 13.

**Purpose and employee flow.** Employees should be able to resume interrupted lengthy entry with confidence. Draft recovery should preserve work while making clear that stock, approvals, and payments have not yet been committed.

**Scope and starting point.** SRC-DRAFT already provides scoped dispatch recovery. Extend a common draft lifecycle to selected long forms rather than treating browser state as an authoritative transaction.

**Implementation.**
1. Define draft identity, schema version, company/user scope, expiry, sensitivity, and retention per workflow.
2. Save changes with visible saving/saved/failed states and debounce without losing the last edit.
3. Protect cross-tab revisions and offer a deliberate conflict choice; do not silently overwrite newer work.
4. Restore inputs, then reload source permissions, stock availability, rates, instructions, and qualifications.
5. Delete or close the draft after confirmed finalization, while retaining request identity for uncertain results.

**Data and controls.** Choose local or server-backed persistence according to sensitivity and cross-device need. Guard server drafts with RLS and safe storage; local storage is not a secure place for unrestricted financial payloads. Handle unavailable storage and logout/company change.

**Complexity, dependencies, and owner.** C4 because recovery, conflicts, migrations, permissions, and final transaction state interact. Coordinate with NOV-006/007/094/098. Product/domain owners define draft expiry and recoverability.

**Acceptance and measurement.** Test reload, navigation, connection loss, storage denial/quota, expired drafts, role/company changes, schema upgrades, two-tab edits, and lost confirmation response. Verify recovery never duplicates a posted transaction. Measure lost work, successful resumption, and completion after interruption.

<a id="nov-015"></a>

### NOV-015 - Make department handoffs part of completing work

**Assessment:** C4 | U1 | N1. **Original:** Batch 1, item 15.

**Purpose and employee flow.** Confirmed eligible work should create the next team's actionable handoff automatically. Quality release feeds packing; completed packing feeds dispatch, with source, quantity, deadline, and responsible team already attached.

**Scope and starting point.** Extend SRC-HANDOFF existing event-derived tasks and acceptance rules. Inspect each current trigger/transaction before adding another event source.

**Implementation.**
1. Define authoritative source events and eligible quantities for each handoff boundary.
2. Create handoff identity and event deduplication within the source transaction where possible.
3. Route to an eligible team and apply the relevant acceptance contract from NOV-046.
4. Support claim, accept, clarification return, partial completion, cancellation, and source correction without losing responsibility.
5. Resolve reminders and reconcile downstream work when source evidence is withdrawn.

**Data and controls.** Prevent one event from generating multiple tasks on replay. Recheck source status and quantity at acceptance and final completion. Use team eligibility, company scope, and task-level authority; a notification alone does not constitute acceptance.

**Complexity, dependencies, and owner.** C4 due to event consistency, retries, accepted responsibility, partial quantities, and reversal propagation. Coordinate with NOV-028/046/050/051/057. Sending and receiving process owners approve boundaries.

**Acceptance and measurement.** Exercise replay, simultaneous claim, partial release, accepted rework output, source cancellation, inactive assignee, returned clarification, and concurrent completion. Verify exactly one eligible handoff and explainable outstanding quantities. Measure verbal chasing, unaccepted work, and delays between confirmed source work and receiving-team action.

<a id="nov-022"></a>

### NOV-022 - Turn material shortages into a purchasing plan

**Assessment:** C4 | U1 | N1. **Original:** Batch 2, item 2.

**Purpose and employee flow.** Purchasing should receive a reviewable plan of material needed, required dates, existing coverage, and affected orders. A shortage view should explain why a proposed purchase is needed.

**Scope and starting point.** Extend current inventory, order demand, reservations, production planning, and SRC-PURCHASE receipts/POs. Begin with one clearly defined material family.

**Implementation.**
1. Define demand from confirmed order/production requirements with revision and need-by date.
2. Net usable free stock, valid reservations, and expected confirmed supply without counting the same stock twice.
3. Apply approved lead times, minimum order quantities, pack sizes, and safety-stock policies separately from hard demand.
4. Produce purchase-request drafts with source-line explanations and supplier options for review.
5. Refresh proposals after demand/supply changes and mark obsolete proposals explicitly.

**Data and controls.** Forecast or tentative receipts must be distinguishable from confirmed supply. Enforce compatibility, quality holds, ownership, warehouse, and unit constraints. Proposed procurement_plan_line references should link demand and supply instead of maintaining another stock ledger.

**Complexity, dependencies, and owner.** C4 because reliable netting spans several lifecycles and dates. Coordinate with NOV-012/021/030/039/069. Stores and purchasing own planning policies; production owns demand timing.

**Acceptance and measurement.** Test partial receipts, cancelled POs, held stock, changed orders, shared demand, reservation races, different units, and late supply. Reconcile a sample plan to source ledgers. Measure emergency purchasing, shortages discovered late, and duplicate procurement proposals.


<a id="nov-028"></a>

### NOV-028 - Track work in progress by physical location and age

**Assessment:** C4 | U1 | N1. **Original:** Batch 2, item 8.

**Purpose and employee flow.** Show the current physical stage/location and age of unfinished material: press, ageing, QC, vendor, packing, or dispatch. Staff should be able to locate an order's material and identify where it is waiting.

**Scope and starting point.** Extend production, stock-location, finishing, handoff, and stage-history events. Keep physical custody, processing state, and task ownership distinct.

**Implementation.**
1. Agree location hierarchy, movement events, units, and the point at which custody changes.
2. Derive current WIP from confirmed issue/receipt/output/transfer events rather than a separate editable total.
3. Support partial lots at different locations and record actual movement when it cannot be inferred reliably.
4. Show stage entry, elapsed age, recorded holds, last observed movement, and missing evidence.
5. Reconcile transformations, vendor receipts, returns, and corrections before showing remaining balances.

**Data and controls.** Proposed WIP read models must preserve source identity and dimensional units. Do not equate administrative status change with a physical movement. Unknown historical locations should remain explicit, with a controlled reconciliation process.

**Complexity, dependencies, and owner.** C4 due to partial quantities, movement lineage, physical reconciliation, and cross-module reads. Coordinate with NOV-005/015/027/031/045/067/068. Stores and operations jointly own location/custody rules.

**Acceptance and measurement.** Test split lots, unrecorded moves, vendor-held material, reopened jobs, quarantine, returns, and source failures. Compare the view to a physical walk-through and reconcile a sample at shift change. Measure location-search time and aged WIP with no assigned resolution.

<a id="nov-031"></a>

### NOV-031 - Maintain a material account for each finishing vendor

**Assessment:** C4 | U1 | N1. **Original:** Batch 2, item 11.

**Purpose and employee flow.** Production and accounts should know what material remains with each finishing vendor, what was accepted back, what was rejected or lost, and which orders depend on it.

**Scope and starting point.** Extend SRC-FINISH issue, receipt, accepted-output, retry, and cost information. Keep vendor custody balances connected to the same physical events used downstream.

**Implementation.**
1. Define vendor issue lines with source batch/order identity, finish specification, quantities, and agreed basis.
2. Record partial receipts with accepted, rejected, returned-for-rework, and explained loss categories.
3. Calculate outstanding vendor custody per issue line and reconcile each closing event.
4. Separate material reconciliation from service-charge review and supplier claim resolution.
5. Expose ageing, expected return, missing documents, and affected customer commitments.

**Data and controls.** Preserve gross/net and measured/theoretical distinctions. An accepted receipt must not create stock twice or exceed valid issued material under approved rules. Rework must retain original source identity and not inflate receipts. Commercial rates remain restricted.

**Complexity, dependencies, and owner.** C4 because vendor custody, quality, stock creation, charges, and partial returns interact. Coordinate with NOV-027/033/039/073/078/079. Production, stores, quality, and accounts agree reconciliation ownership.

**Acceptance and measurement.** Test several partial receipts, mixed accepted/rejected output, over-receipt, retry/rework, duplicate confirmation, claimed loss, and vendor charge disputes. Reconcile balances to actual vendor statements and physical receipts. Measure unaccounted material, overdue custody, and time to answer vendor-balance queries.

<a id="nov-042"></a>

### NOV-042 - Define what each role can decide independently

**Assessment:** C4 | U1 | N1. **Original:** Batch 3, item 2.

**Purpose and employee flow.** Employees should know which decisions they can make independently, which require review, and who decides an exception. This reduces routine escalation while keeping consequential authority explicit.

**Scope and starting point.** Extend SRC-GOV existing action permissions, exception policies, approval inbox, and separation-of-duty checks. Do not add a parallel client-side approval model.

**Implementation.**
1. List decision types and approved limits by role, context, amount/quantity, and risk.
2. Version policies with effective dates, eligibility, expiry, and non-overridable constraints.
3. Show applicable authority and an allowed request route beside the restricted action.
4. Bind approval to the reviewed record revision and scope; consume one-use exceptions atomically where required.
5. Retain decision, clarification, delegation, rejection, and supersession history.

**Data and controls.** Authority derives from authenticated context and policy, never a submitted role/company. Recheck at action time and through every write path. Prevent self-approval where policy requires another person and prohibit delegation from granting unrelated privileges.

**Complexity, dependencies, and owner.** C4 due to policy precedence, concurrency, scope binding, and several domain actions. Coordinate with NOV-004/043/048/051/057. The business owner approves authority; department heads own operating guidance.

**Acceptance and measurement.** Test threshold boundaries, changed amounts, expired approvals, direct API attempts, role withdrawal, double use, and concurrent decisions. Pilot one decision family. Measure avoidable escalations and decisions outside policy, without expanding exceptions to bypass stock/finance integrity.

<a id="nov-051"></a>

### NOV-051 - Agree what done means for every important step

**Assessment:** C4 | U1 | N1. **Original:** Batch 3, item 11.

**Purpose and employee flow.** Employees should know what evidence makes a step complete before beginning it. Completion should be tied to accepted work, not an unsupported checkbox.

**Scope and starting point.** Extend SRC-SOP objective criteria, transaction evidence, execution, and verification. Map each criterion to the actual domain source where one exists.

**Implementation.**
1. Define a versioned completion contract: required events, quantities, observations, documents, and independent review where applicable.
2. Bind each task to the approved contract and relevant source identities.
3. Read existing evidence automatically and request only missing human observations.
4. Verify current source state at completion, then retain the evidence/reviewer snapshot.
5. Route changed or reversed evidence through NOV-034/057 without silently rewriting previous completion.

**Data and controls.** Keep recorded observation, source transaction, performer, and verifier distinct. Do not accept an arbitrary record ID as evidence without same-company/type/status/quantity checks. Prevent unrelated or duplicate evidence from satisfying multiple exclusive obligations.

**Complexity, dependencies, and owner.** C4 because source freshness, proof semantics, and final transaction controls span modules. Coordinate with NOV-015/046/055/062/069. Each process owner approves what done means.

**Acceptance and measurement.** Test missing evidence, partial quantities, stale approval, unrelated source, reversed receipt, concurrent completion, self-verification, and policy revision. Observe employees completing real tasks and measure first-time acceptance, returned work, and superficial closures later reopened.

<a id="nov-057"></a>

### NOV-057 - Make process changes reach the people doing work

**Assessment:** C4 | U1 | N1. **Original:** Batch 3, item 17.

**Purpose and employee flow.** Approved process changes should reach the employees and unfinished work they affect. A revised packing instruction should identify the relevant orders, required review, and point of applicability.

**Scope and starting point.** Extend SRC-SOP released procedure versions, customer requirements, qualifications, and existing change/reopen foundations.

**Implementation.**
1. Release a versioned change with effective date, affected task families, owner, reviewer, and in-flight treatment.
2. Determine affected active work from explicit source/version relationships.
3. Notify eligible employees with a concise difference summary and appropriate acknowledgement or requalification requirement.
4. Require re-review where policy calls for it and preserve the earlier evidence.
5. Show rollout coverage, unresolved acknowledgements, and approved deviations without treating delivery of a notification as understanding.

**Data and controls.** Keep immutable released instructions and applicable historical bindings. A critical technical change may require a controlled hold; a cosmetic wording change should not automatically stop all work. Server transitions must enforce the selected policy consistently.

**Complexity, dependencies, and owner.** C4 due to applicability, in-flight behavior, qualifications, and source invalidation. Coordinate with NOV-034/051/055/062/079. Process owners approve change classification and rollout.

**Acceptance and measurement.** Test future-effective revisions, reopened work, changed employee qualification, deactivated recipients, partially completed tasks, and held material. Pilot one change with real staff and verify they use the correct instructions. Measure work performed under superseded requirements and unresolved rollout gaps.


<a id="nov-062"></a>

### NOV-062 - Manage drawing approval as a complete workflow

**Assessment:** C4 | U1 | N1. **Original:** Batch 4, item 2.

**Purpose and employee flow.** Technical and production staff should know exactly which drawing revision the customer approved and which revision was released for manufacture. A drawing upload alone must not imply approval.

**Scope and starting point.** Extend existing profile drawing metadata, approval checks, Storage documents, accepted-order snapshots, and customer requirements.

**Implementation.**
1. Define immutable drawing revisions with file identity/checksum, technical metadata, author, and supersession links.
2. Record customer submission, technical query, approval/rejection, permitted deviation, and manufacture release as separate events.
3. Bind order lines, samples, production jobs, inspections, and labels to the applicable released revision.
4. On change, identify affected unfinished work and route approved holds/reviews through NOV-034/057.
5. Provide an employee-readable comparison and a current approved-document view without losing older evidence.

**Data and controls.** Protect files with company-scoped Storage access and authorized links. Record who supplied approval and supporting evidence; internal approval is not automatically customer approval. Historical jobs keep the revision actually used. Never replace a drawing object in place under the same immutable revision.

**Complexity, dependencies, and owner.** C4 because document lifecycle, external evidence, technical applicability, and downstream work interact. Coordinate with NOV-027/056/063/079. Technical owns release; sales owns customer communication.

**Acceptance and measurement.** Test two similar drawings, obsolete approval, changed file content, missing customer evidence, alternate revision requests, and old job retrieval. Verify production cannot rely on a superseded revision contrary to approved policy. Pilot one custom profile and measure revision-related clarification and rework.

<a id="nov-069"></a>

### NOV-069 - Give incoming material an acceptance workflow

**Assessment:** C4 | U1 | N1. **Original:** Batch 4, item 9.

**Purpose and employee flow.** Stores should know what arrived and quality should decide which portions are accepted, quarantined, rejected, or awaiting evidence. Received material becomes usable only through the approved acceptance path.

**Scope and starting point.** Extend SRC-PURCHASE receipt matching and existing stock/QC hold controls. Keep physical receipt, supplier billing, and quality acceptance distinct.

**Implementation.**
1. Capture exact PO line, supplier batch, quantities/units, location, documents, and receipt evidence.
2. Derive the applicable inspection/acceptance plan and create required work once.
3. Support partial acceptance, rejection, concessions where authorized, retest, and return to supplier.
4. Release only eligible quantities into usable inventory and feed shortages or claims to responsible teams.
5. Reconcile receipt, accepted/rejected balances, invoice matching, and later corrections.

**Data and controls.** Prevent duplicate receipt and repeated stock release with request identity and atomic source checks. Preserve traceability across accepted/rejected splits. An invoice or uploaded certificate does not prove physical acceptance. Restrict vendor rates to appropriate roles.

**Complexity, dependencies, and owner.** C4 because purchasing, quality, stock availability, partial quantities, and financial matching interact. Coordinate with NOV-022/027/030/070/078. Stores and quality own the boundary; purchasing owns supplier follow-up.

**Acceptance and measurement.** Test over-receipt, short receipt, mixed units, partial rejection, missing certificate, source cancellation, repeated release, and simultaneous allocation. Reconcile with actual incoming material and supplier documents. Measure material used before acceptance and time from receipt to a valid disposition.

<a id="nov-076"></a>

### NOV-076 - Record partial acceptance and delivery exceptions

**Assessment:** C4 | U1 | N1. **Original:** Batch 4, item 16.

**Purpose and employee flow.** Dispatch and sales should know exactly what the customer accepted, refused, found short, or reported damaged. A partially delivered load must retain an explainable outstanding commitment and material position.

**Scope and starting point.** Extend dispatch delivery history, proof of delivery, connected returns, and order/invoice balances. Delivery acceptance is separate from physical dispatch and financial settlement.

**Implementation.**
1. Record disposition by shipment line/bundle with quantity basis, customer evidence, receiver, time, and reason.
2. Model accepted, pending, refused, damaged, and claimed-short quantities with a reconciliation against the shipped source.
3. Route physical returns through quarantine/receipt; route redelivery, claims, and credits through their domain actions.
4. Track who owns each unresolved exception and the customer commitment.
5. Preserve original dispatch, subsequent dispositions, corrections, and final resolution.

**Data and controls.** Avoid decrementing stock twice for a redelivery or crediting material before a physical return is confirmed. Distinguish customer-reported shortage from a verified inventory discrepancy. Recheck balances under concurrent updates.

**Complexity, dependencies, and owner.** C4 because quantity dispositions affect order fulfillment, returns, claims, and billing. Coordinate with NOV-005/038/058/075. Dispatch, sales, stores, and accounts agree responsibility.

**Acceptance and measurement.** Test one accepted and one refused bundle, partial damage, disputed shortage, return received later, redelivery, credit, and repeated evidence upload. Verify every shipped quantity has an explainable disposition. Measure unresolved delivery exceptions and time to customer resolution.

<a id="nov-026"></a>

### NOV-026 - Connect maintenance directly to production capacity

**Assessment:** C4 | U2 | N1. **Original:** Batch 2, item 6.

**Purpose and employee flow.** Planned maintenance and breakdowns should have visible scheduling consequences. Planners and sales should understand which capacity is unavailable and which commitments need attention.

**Scope and starting point.** SRC-PLAN already checks maintenance overlap and configured shift capacity. Extend coordination with maintenance lifecycle, affected jobs, alternative slots, and commitment review.

**Implementation.**
1. Map approved maintenance and actual downtime to resource unavailability with correct start/end and uncertainty.
2. Identify impacted scheduled/released work and distinguish already-running jobs.
3. Suggest valid alternatives using current compatibility, shift, material, and capacity rules.
4. Review and apply approved schedule changes atomically, retaining the original plan and reasons.
5. Notify relevant coordinators and update delivery feasibility assumptions without silently promising a new date.

**Data and controls.** A maintenance completion does not prove equipment availability until the approved release is recorded. Unknown downtime duration is not zero. Respect frozen windows, operator eligibility, and concurrent schedule edits.

**Complexity, dependencies, and owner.** C4 because multiple resource and commitment lifecycles must agree. Coordinate with NOV-021/024/025/044/047. Maintenance owns availability evidence; planning owns rescheduling.

**Acceptance and measurement.** Test overlapping maintenance, late extension, early completion, open-ended breakdown, shift boundary, alternate press incompatibility, and concurrent slot changes. Verify no invalid release is possible through another path. Measure rescheduling effort and late surprises caused by maintenance information reaching planning too slowly.

<a id="nov-030"></a>

### NOV-030 - Introduce a cycle-counting workflow

**Assessment:** C4 | U2 | N1. **Original:** Batch 2, item 10.

**Purpose and employee flow.** Stores can count manageable groups of material regularly and resolve differences close to their source. The system should distinguish a genuine discrepancy from legitimate movements that happened during counting.

**Scope and starting point.** Extend stock ledger, locations, physical reconciliation, and approved stock adjustment controls. Count observations do not directly overwrite balances.

**Implementation.**
1. Select count scope by location, material class, risk, and last verified count.
2. Capture a ledger snapshot or defined movement cutoff, optionally hide expected quantities for an independent count, and record actual observations.
3. Reconcile intervening movements and require recount or review for unexplained differences.
4. Post only approved adjustments through the existing stock movement boundary with reason and evidence.
5. Retain the count, reviewer, source cutoff, adjustment links, and closure outcome.

**Data and controls.** Support bundles, partial quantities, quality holds, vendor/customer ownership, and multiple units. Prevent duplicate adjustment on retry. Define whether the counted location is temporarily frozen or movements are reconciled; do not assume a factory-wide freeze.

**Complexity, dependencies, and owner.** C4 due to temporal reconciliation, physical observations, and stock corrections. Coordinate with NOV-027/028/067/068. Stores owns execution; an authorized independent reviewer approves adjustments.

**Acceptance and measurement.** Test movement during count, duplicate scans, unlisted stock, damaged labels, recount disagreement, partial location completion, and concurrent adjustment. Reconcile a real pilot area. Measure unexplained variance and time from finding a discrepancy to approved resolution.


<a id="nov-033"></a>

### NOV-033 - Generate a complete quality document pack

**Assessment:** C4 | U2 | N1. **Original:** Batch 2, item 13.

**Purpose and employee flow.** Quality and dispatch should assemble the exact evidence required for a shipment without searching several folders. The pack should identify missing requirements before dispatch review.

**Scope and starting point.** Extend existing PDFs, documents, inspection plans/results, customer requirements, and technical snapshots. Preserve the established PDF/report implementation.

**Implementation.**
1. Determine required documents and inspections from customer/project/order and applicable specification revisions.
2. Resolve the exact source batches and accepted quantities covered by the dispatch.
3. Build a readiness checklist with missing, rejected, superseded, and authorized-deviation states.
4. Generate a versioned document pack from approved evidence, with a manifest linking each source revision.
5. Retain issue, recipient preparation, replacement, and withdrawal history where required.

**Data and controls.** An uploaded file does not automatically satisfy a technical requirement. Customer projections must exclude internal cost, margin, supplier rates, and internal discussions. Use authorized Storage access and preserve the issued manifest even if source masters later change.

**Complexity, dependencies, and owner.** C4 because applicability, material lineage, document permissions, and issued snapshots cross modules. Coordinate with NOV-019/027/062/069/070/071. Quality owns evidence; dispatch owns delivery preparation.

**Acceptance and measurement.** Test split batches, partial shipments, amended certificates, missing results, wrong drawing revision, restricted attachments, and regenerated packs. Inspect PDFs and verify their source manifest and customer-safe fields. Pilot one actual customer requirement set and measure document preparation time and missing-evidence delays.

<a id="nov-038"></a>

### NOV-038 - Manage a return through final resolution

**Assessment:** C4 | U2 | N1. **Original:** Batch 2, item 18.

**Purpose and employee flow.** A return should remain connected from customer complaint through receipt, quarantine, inspection, rework/replacement/credit, and closure. Staff should see what the company still owes the customer and where returned material is.

**Scope and starting point.** Extend SRC-RETURN existing lifecycle and domain financial/stock corrections. Retain the original dispatch and invoice attribution.

**Implementation.**
1. Create a return authorization linked to shipped lines, reason, expected quantities, and approved response.
2. Record actual receipt and quarantine separately from the customer's reported quantity.
3. Inspect and allocate each received portion to rework, reuse, scrap, supplier recovery, or another approved disposition.
4. Link replacement production/dispatch and credits to the original obligation, with partial resolution.
5. Close only after quantities, customer commitments, and financial treatment are reconciled.

**Data and controls.** Do not make returned material immediately available before QC release. Prevent cumulative returns above valid shipped balances and duplicate credits or replacements. Preserve source costs and document snapshots using approved correction paths.

**Complexity, dependencies, and owner.** C4 due to intertwined stock, quality, customer fulfillment, and finance states. Coordinate with NOV-027/035/058/076/078. Sales coordinates customer resolution; stores, quality, and accounts own their transactions.

**Acceptance and measurement.** Test return before credit, credit before replacement, partial physical receipt, rejected claim, repeated authorization, rework failure, and concurrent balance use. Reconcile a full example end to end. Measure open return age, unaccounted returned material, and time to an evidenced customer outcome.

<a id="nov-058"></a>

### NOV-058 - Close orders through a coordinated final review

**Assessment:** C4 | U2 | N1. **Original:** Batch 3, item 18.

**Purpose and employee flow.** Closing an order should mean the company has reviewed remaining material, fulfillment, customer commitments, returns, and the chosen financial obligations. Teams should share one explanation of what remains open.

**Scope and starting point.** Extend SRC-ORDER progress, SRC-FINANCE reconciliation, returns, and coordinator responsibilities. Define operational completion separately from final commercial/financial closure.

**Implementation.**
1. Agree closure checks for quantities, open jobs, vendor custody, reservations, delivery exceptions, documents, billing, and applicable commitments.
2. Build a readiness review with each unresolved item, owner, and source link.
3. Resolve by completing work, approved cancellation/write-off, release of unused reservations, or a documented allowed carry-forward.
4. Commit closure against current versions and prevent new conflicting operations without an authorized reopen path.
5. Retain the reviewed closure snapshot and reasoned reopening history.

**Data and controls.** Do not require every invoice to be paid before operational completion unless company policy requires it. Never hide quantity differences by forcing a balance to zero. An order closure must not delete outstanding finance evidence.

**Complexity, dependencies, and owner.** C4 because close/reopen behavior affects many modules and competing actions. Coordinate with NOV-005/034/038/041/051/076. Operations, sales, and accounts agree policy.

**Acceptance and measurement.** Test residual stock, unbilled dispatch, partial cancellation, return after closure, outstanding payment, open vendor material, and concurrent dispatch. Verify forbidden actions fail server-side. Measure closed orders later found incomplete and time to resolve the closure checklist.

<a id="nov-063"></a>

### NOV-063 - Track samples and first-piece approvals

**Assessment:** C4 | U2 | N1. **Original:** Batch 4, item 3.

**Purpose and employee flow.** Sample and first-piece approval should be traceable to the exact specification, die, source run, recipient, and decision. Planners should know which work is waiting on that approval.

**Scope and starting point.** Extend drawing approvals, customer commitments, production runs, inspection evidence, and document links. A sample sent is different from a sample accepted.

**Implementation.**
1. Create a sample requirement with reason, quantity, specification revision, relevant order/customer, and approval authority.
2. Record sample production, measurements, physical identity/location, dispatch, recipient, and expected response.
3. Capture approve, reject, clarify, or conditional acceptance with evidence and the scope it covers.
4. Gate applicable production/release steps through the approved policy, including partial or limited releases.
5. Require renewed review when material changes invalidate the approval.

**Data and controls.** Preserve sample and decision history, supporting files, and exact source versions. An internal first-piece approval cannot substitute for customer approval unless the agreed contract permits it. Approval does not create stock or prove the rest of a production batch conforms.

**Complexity, dependencies, and owner.** C4 due to external decisions, technical revision binding, and downstream release controls. Coordinate with NOV-051/057/062/073. Technical/quality owns acceptance and sales owns customer follow-up.

**Acceptance and measurement.** Test rejected first piece, revised drawing, limited approval, changed die, lost sample, overdue response, and duplicate decision. Pilot one new-die order and measure approval waiting, repeated sampling, and work started on an invalid approval.

<a id="nov-079"></a>

### NOV-079 - Generate customer-specific packing instructions and labels

**Assessment:** C4 | U2 | N1. **Original:** Batch 4, item 19.

**Purpose and employee flow.** Packing employees should receive the correct instructions and generate labels from known order/material facts. Customer bundle limits, spacers, wrapping, marks, and required label fields should be visible at the packing step.

**Scope and starting point.** Extend customer requirements, packing records, bundle identity, Storage, and PDFs. Reuse approved technical/order snapshots.

**Implementation.**
1. Maintain approved versioned packing and label templates with customer/project/order precedence.
2. Resolve the applicable template and populate trusted fields such as profile, finish, length, batch, quantity, and destination.
3. Record physical packing observations and any required reviewed deviation.
4. Bind the completed packing record and printed labels to the template revision.
5. Control reprints, superseded labels, damaged-tag replacement, and later repacking.

**Data and controls.** Labels must use business-safe fields and preserve source lineage. A reprint should not create new stock identity by accident. Prevent a different customer's template or internal costing from appearing in a customer label.

**Complexity, dependencies, and owner.** C4 because requirement precedence, physical packaging, print evidence, and transformations interact. Coordinate with NOV-017/027/057/068/073. Quality and dispatch approve templates with sales.

**Acceptance and measurement.** Test missing template fields, customer override, split bundle, reprint, changed revision, label overflow, scanning, and actual printer output. Trial with real labels and packed material. Measure repacking, misidentification, and instruction lookups rather than relying only on browser screenshots.


<a id="nov-014"></a>

### NOV-014 - Allow small updates directly from work queues

**Assessment:** C4 | U2 | N2. **Original:** Batch 1, item 14.

**Purpose and employee flow.** Supervisors should update suitable small fields without repeatedly opening full edit pages. Assignment, priority, and planned date can be changed from a queue when enough context is visible.

**Scope and starting point.** Extend existing task/production bulk tools and paginated databases. Keep stock posting, financial entries, and complex status changes in their dedicated reviewed flows.

**Implementation.**
1. Define an allowlist of inline/bulk-editable fields and eligible source states.
2. Preview selected records and proposed effects, explicitly distinguishing page selection from all-filtered selection.
3. Recheck each record's version and permission at apply time, returning a per-record result.
4. Preserve request identity, changed/no-change/rejected outcomes, and an audit record.
5. Support safe cancellation of selection and refresh changed rows without losing the working filter.

**Data and controls.** Bound batch sizes and use deterministic server selection. Do not silently overwrite concurrent edits or imply atomic success when records are processed independently. A partial outcome must list every selected identity.

**Complexity, dependencies, and owner.** C4 because multi-record updates, preview freshness, authority, and retries can affect many employees. Coordinate with NOV-043/047/091/096/098. Supervisors approve eligible everyday updates.

**Acceptance and measurement.** Test records changed after preview, mixed eligible/ineligible states, duplicate selection, revoked access, network interruption, and late pages. Verify exact outcomes and repeated-request safety. Measure record-opening effort and accidental changes; keep a dedicated detail path when extra context is necessary.

<a id="nov-019"></a>

### NOV-019 - Keep documents and communication beside the transaction

**Assessment:** C4 | U2 | N2. **Original:** Batch 1, item 19.

**Purpose and employee flow.** Employees should prepare the correct document and customer message from the transaction they are handling. The recipient, outgoing content, document version, and actual delivery state should be clear.

**Scope and starting point.** Extend existing PDF/report generation and invoice communication preparation to other supported documents. Preserve the latest PDF implementation and customer-safe projections.

**Implementation.**
1. Define transaction-specific templates using authoritative snapshot-backed facts and permitted recipient sources.
2. Preview recipients, message text, attachments, and document version before the authorized send/preparation action.
3. Support print/download/copy as explicit outcomes independent of provider sending.
4. If a provider is later connected, add request deduplication, provider response identifiers, delivery callbacks, and failed/retry states.
5. Retain an audit trail linked to the exact issued document and source revision.

**Data and controls.** Keep secrets server-side, verify attachment access, and exclude internal costs/discussion. Copied/prepared, provider accepted, delivered, and read are distinct claims. Recheck recipient/source versions after a stale preview.

**Complexity, dependencies, and owner.** C4 for permissions, document versions, provider boundaries, and retry semantics. External provider setup may require C5 discovery under NOV-020. Coordinate with NOV-033/040/079/098. Sales/accounts own templates.

**Acceptance and measurement.** Test changed recipient, old document, partial dispatch, provider failure, duplicate request, unauthorized attachment, and long/local-language PDF content. Inspect actual outputs and verify no false delivery claim. Measure document assembly and customer-information corrections.

<a id="nov-036"></a>

### NOV-036 - Plan a vehicle load across multiple orders

**Assessment:** C4 | U2 | N2. **Original:** Batch 2, item 16.

**Purpose and employee flow.** Dispatch should plan one vehicle load from eligible material across several orders, with clear destinations, quantities, constraints, and unloading sequence.

**Scope and starting point.** Extend vehicle loading, order readiness, packing/bundle identities, and dispatch actions. Preserve independent customer/order traceability inside a shared load.

**Implementation.**
1. Define a load draft containing vehicle, route/destinations, eligible source bundles/quantities, and required delivery arrangements.
2. Check weight, dimensions, material compatibility, destination sequence, customer packing rules, and approved vehicle limits.
3. Present a picking/loading list and capture actual loaded identities with scan or manual confirmation.
4. Atomically finalize consumption and dispatch documents against current reservations/readiness.
5. Handle removed material, partial loads, unloaded exceptions, and post-dispatch corrections through explicit events.

**Data and controls.** Do not count a bundle twice across draft loads or consume it before the final approved transaction. Vehicle capacity figures must be maintained and reviewed; this document specifies no legal loading limit. Mixed customer documents require safe field separation.

**Complexity, dependencies, and owner.** C4 because packing, reservations, multiple orders, physical observation, and dispatch commitment interact. Coordinate with NOV-017/068/074/075/076/079. Dispatch owns the pilot with stores.

**Acceptance and measurement.** Test two loads competing for a bundle, held material, over-capacity proposal, different sites, partial unloading, stale plan, and confirmation timeout. Reconcile the actual vehicle against issued documents. Measure picking mistakes, load preparation time, and last-minute readiness failures.

<a id="nov-044"></a>

### NOV-044 - Protect an agreed execution window

**Assessment:** C4 | U2 | N2. **Original:** Batch 3, item 4.

**Purpose and employee flow.** Operators should have a dependable near-term execution plan. Urgent changes remain possible through a process that makes displaced work and customer consequences explicit.

**Scope and starting point.** Extend SRC-PLAN schedule snapshots and current conflict checks. A frozen window is an approved planning policy, not a universal ban on necessary changes.

**Implementation.**
1. Configure the execution window by resource/team, calendar, eligible states, and decision authority.
2. Mark scheduled work inside that window and show permissible changes with their required reason/review.
3. Preview affected slots, material reservations, crew, vendor work, and customer commitments.
4. Apply approved changes against the current schedule version, retaining before/after snapshots.
5. Notify impacted owners once and preserve the original committed plan for analysis.

**Data and controls.** Never reschedule running work through a generic drag action. Maintenance, safety, and verified quality holds must remain correctly represented; the approved policy determines their operational response. Enforce the window through server actions, not just disabled UI.

**Complexity, dependencies, and owner.** C4 because changing one slot can affect multiple commitments and concurrent planners. Coordinate with NOV-021/024/026/043/047. Planning and operations own the policy.

**Acceptance and measurement.** Test boundary times, overnight shifts, emergency change, revoked approval, maintenance conflict, and two planners editing simultaneously. Verify untouched work stays stable and impacted owners see the approved revision. Measure schedule churn, displaced commitments, and repeated operator interruptions.

<a id="nov-045"></a>

### NOV-045 - Control how much work enters each stage

**Assessment:** C4 | U2 | N2. **Original:** Batch 3, item 5.

**Purpose and employee flow.** Release work into a stage at a rate the receiving stage can handle. A growing QC or packing queue should trigger an informed decision before more material accumulates.

**Scope and starting point.** Extend WIP visibility, readiness, scheduling, and department handoffs. First use advisory limits while validating the physical process.

**Implementation.**
1. Define stage scope, capacity basis, units, buffer policy, and applicable product families.
2. Calculate queued, active, held, and accepted material from authoritative events.
3. Show limit breaches and upstream release consequences, with a permitted override route where policy allows.
4. If enforcement is approved, check and reserve stage capacity within the release transaction.
5. Review starvation, batching needs, urgent commitments, and override outcomes during the pilot.

**Data and controls.** A count of tasks is not equivalent to kg, processing time, or physical space. Do not mix these units or treat unknown locations as spare capacity. Hard enforcement requires concurrency-safe accounting and a defined release/reversal lifecycle.

**Complexity, dependencies, and owner.** C4 due to partial quantities, shared capacity, source events, and competing releases. Coordinate with NOV-015/021/028/043/046. Operations and the bottleneck department agree policy.

**Acceptance and measurement.** Test two simultaneous releases, hold/resume, partial completion, cancelled work, product-specific limits, and stale queues. Physically verify a pilot stage. Measure throughput, queue age, and rework alongside WIP; a lower visible queue alone is not success.


<a id="nov-047"></a>

### NOV-047 - Assign work using capacity and eligibility together

**Assessment:** C4 | U2 | N2. **Original:** Batch 3, item 7.

**Purpose and employee flow.** Supervisors should assign work with an understanding of who is eligible, available, and already committed. A recommended employee should come with an explainable reason and visible competing workload.

**Scope and starting point.** Extend tasks, teams, competency, delegation, and approved shift/availability data. Start with recommendations rather than automatic reassignment.

**Implementation.**
1. Define hard eligibility rules separately from preferred skills, usual responsibility, availability, and workload.
2. Calculate workload using appropriate task-family estimates and distinguish missing duration from zero.
3. Present suitable assignees with evidence, conflicts, and current committed work.
4. Apply assignment with current permission/eligibility checks and retain the supervisor's override reason.
5. Re-evaluate future work after approved absence, qualification expiry, or changed priority without silently moving running tasks.

**Data and controls.** Keep individual availability and competency data restricted to appropriate supervisory roles. Delegation does not grant authority. A workload estimate is not a valid basis for staff ranking without context and an approved policy.

**Complexity, dependencies, and owner.** C4 because several lifecycle states and concurrent assignments interact. Coordinate with NOV-043/044/048/054/055. Department heads own the assignment policy.

**Acceptance and measurement.** Test qualified-but-away, available-but-unqualified, expired grants, temporary delegation, urgent workload, concurrent assignment, and stale availability. Pilot one team and compare accepted assignments, reassignment, and waiting. Verify a direct action cannot assign forbidden work even when the recommendation was previously valid.

<a id="nov-052"></a>

### NOV-052 - Use approved workflow paths for different order types

**Assessment:** C4 | U2 | N2. **Original:** Batch 3, item 12.

**Purpose and employee flow.** Different order types should follow the steps they actually require. A stock sale, custom extrusion, new-die order, and returned-material rework should each have a clear approved path.

**Scope and starting point.** Extend existing versioned SOPs, approved branches, readiness, and source-linked tasks. Avoid creating an unrestricted visual workflow engine before bounded routes are reliable.

**Implementation.**
1. Define approved route families with explicit selection rules, required stages, optional branches, and completion contracts.
2. Bind each order/work package to a route revision derived from known characteristics.
3. Create only eligible next work from authoritative events; show parallel steps and dependencies.
4. Allow permitted deviations with a reason and approval, preserving the original route.
5. Define how route changes affect unfinished, completed, and already posted work.

**Data and controls.** Proposed route definitions should reuse procedure/version owners where suitable. An omitted stage must have a policy reason; it is not the same as completed. Never allow a configurable route to bypass core stock, quality, finance, or tenant controls.

**Complexity, dependencies, and owner.** C4 because route applicability, dynamic tasks, versioning, and source events span modules. Coordinate with NOV-015/034/051/057/063. Operations owns route families with departmental review.

**Acceptance and measurement.** Test each route family, changed specifications, partial stock fulfillment, rework loops, cancelled orders, duplicate triggers, and unavailable prerequisites. Pilot one family and measure unnecessary steps, wrong routing, and first-time acceptance.

<a id="nov-064"></a>

### NOV-064 - Apply quantity-based pricing and minimum charges

**Assessment:** C4 | U2 | N2. **Original:** Batch 4, item 4.

**Purpose and employee flow.** Sales should obtain an explainable proposed price using approved quantity brackets, minimum charges, special processing charges, and customer agreements.

**Scope and starting point.** Extend approved dated rates, quotation calculations, commercial review, and order snapshots. Keep the existing costing and margin definitions authoritative.

**Implementation.**
1. Define charge rules with scope, effective dates, unit basis, threshold boundaries, precedence, and approval.
2. Calculate a line/document price breakdown from the relevant rule versions, distinguishing cost from selling price.
3. Show applied brackets, minimum-charge effects, exceptions, and the impact of quantity changes.
4. Recheck at review/confirmation and preserve the applied rule snapshot with the issued quotation/order.
5. Route allowed overrides through the existing authority matrix with a retained reason.

**Data and controls.** Reconcile current rate tables before adding pricing_rule candidates. Do not stack conflicting charges or substitute markup for margin. Tax treatment must follow the existing approved configuration and qualified business review; this catalogue supplies no new tax rule.

**Complexity, dependencies, and owner.** C4 because rule precedence, rounding, versioning, approvals, and downstream documents must agree. Coordinate with NOV-009/012/035/042/065. Sales/accounts approve policy.

**Acceptance and measurement.** Test bracket edges, partial quantities, minimum charges, per-kg/per-metre bases, expired agreements, overrides, revised drafts, and PDF parity. Verify repeated calculation and saved totals reconcile. Measure pricing corrections and time spent seeking routine rate guidance.

<a id="nov-078"></a>

### NOV-078 - Manage supplier claims through to recovery

**Assessment:** C4 | U2 | N2. **Original:** Batch 4, item 18.

**Purpose and employee flow.** A supplier shortage, rejected receipt, wrong specification, or damage issue should remain open until the agreed replacement, credit, or other recovery is actually recorded.

**Scope and starting point.** Extend purchasing/receipt discrepancies, quality evidence, supplier credits, and finishing vendor reconciliation. A supplier promise or accepted claim is not the same as recovery.

**Implementation.**
1. Create a claim tied to exact source lines, evidence, quantities/amounts, reason, owner, and requested remedy.
2. Track submitted, disputed, agreed, partially recovered, rejected, and closed outcomes with response history.
3. Link replacement receipts, approved credits, refunds, or adjustments through their existing domain actions.
4. Reconcile cumulative recovery against the agreed claim and preserve unresolved differences.
5. Surface overdue actions and relevant supplier performance evidence.

**Data and controls.** Prevent duplicate claims/recovery against the same exclusive quantity. Do not create a financial credit merely because a claim is agreed. Separate supplier-reported figures from verified material and ledger events; restrict sensitive commercial correspondence.

**Complexity, dependencies, and owner.** C4 because purchasing, quality, custody, and accounts outcomes interact. Coordinate with NOV-031/039/069/076. Purchasing coordinates; stores/quality/accounts own evidence and posting.

**Acceptance and measurement.** Test partial settlement, replacement plus credit, rejected dispute, changed supplier response, returned material, reversed credit, and competing recovery entry. Reconcile the claim to actual receipts/finance records. Measure unresolved claim age and agreed recoveries not yet realized.

<a id="nov-029"></a>

### NOV-029 - Manage reusable remnants and excess production

**Assessment:** C4 | U3 | N2. **Original:** Batch 2, item 9.

**Purpose and employee flow.** Useful leftover lengths and approved excess production should be visible as reusable material. Planning can suggest a suitable existing remnant before requesting fresh production.

**Scope and starting point.** Extend profile stock, cut-length requirements, quality status, reservations, and bundle identity. Remnants remain physical stock with traceable specifications, not a free-text note.

**Implementation.**
1. Define eligibility for reusable material by profile/revision, alloy, temper, finish, length, condition, and ownership.
2. Record remnant creation through a measured/observed cutting or excess-output event with source identity.
3. Search compatible requirements and propose a cut/allocation with expected waste.
4. Reserve, consume, split, or scrap through guarded stock actions, retaining the original batch.
5. Track age, location, usability review, and eventual disposition.

**Data and controls.** Preserve discrete length distribution; a total kg balance alone cannot prove a required length is available. Do not automatically make excess output customer-owned or commercially billable. Historical unidentified material needs controlled reconciliation.

**Complexity, dependencies, and owner.** C4 because length-based inventory, cutting, reservations, transformations, and actual observations interact. Coordinate with NOV-012/022/027/030/068. Stores and planning own acceptance rules.

**Acceptance and measurement.** Test identical kg with different lengths, held remnants, competing allocations, measurement correction, mixed finish, and scrap reversal. Reconcile a physical pilot rack with the ledger. Measure reused material, search effort, and unusable stock incorrectly suggested as available.


<a id="nov-037"></a>

### NOV-037 - Support blanket orders with scheduled releases

**Assessment:** C4 | U4 | N3. **Original:** Batch 2, item 17.

**Purpose and employee flow.** Where customers buy through an overall agreement and later call-offs, employees should track the agreement balance, individual releases, delivery commitments, and applicable commercial terms together.

**Scope and starting point.** Extend quotations/orders, line schedules, approved rate/specification snapshots, and fulfillment balances. Validate that blanket agreements are a real recurring business need.

**Implementation.**
1. Model agreement lines, allowed quantity/value, effective period, specification, price basis, and release authority.
2. Create call-offs with their own identity, site, dates, and quantities linked to agreement lines.
3. Reserve agreement balance atomically and distinguish scheduled, firm, cancelled, fulfilled, and outstanding releases.
4. Apply the contractually appropriate rate revision and preserve each released order's snapshot.
5. Handle amendments, expiry, returns, cancellations, and agreed carry-forward without erasing earlier releases.

**Data and controls.** Agreement balance and physical stock are different ledgers. Prevent concurrent call-offs exceeding the valid agreement while respecting approved overrun rules if any. Do not assume unused agreement quantity is automatically inventory demand.

**Complexity, dependencies, and owner.** C4 because parent/child commitments, dated pricing, partial fulfillment, and concurrency must agree. Coordinate with NOV-021/034/058/064. Sales/accounts own agreement interpretation.

**Acceptance and measurement.** Test simultaneous releases, partial cancellation, expired agreement, changed rate, revised quantity, different delivery sites, return, and final settlement. Pilot one actual contract and reconcile its balance to customer records. Measure repeated agreement lookup and release errors before expanding.

<a id="nov-065"></a>

### NOV-065 - Maintain a die and tooling commercial account

**Assessment:** C4 | U4 | N3. **Original:** Batch 4, item 5.

**Purpose and employee flow.** Sales and accounts should see the commercial position of a die: who owns it, who paid, what was waived, and whether an agreed contribution is recovered through future orders.

**Scope and starting point.** Extend die identity, customer agreements, quotations, invoices, receipts, and approved adjustments. Keep the operating history in NOV-025 separate from commercial ownership.

**Implementation.**
1. Record the tooling agreement, legal/business owner, charges, customer contribution, tax/accounting treatment reference, and approved waiver terms.
2. Link issued charge documents, payments, credits, and allocations to the agreement.
3. If recovery through later orders is agreed, define the basis, cap, applicable orders, and retained calculation.
4. Reconcile outstanding contribution and agreement fulfillment, with reviewed corrections.
5. Surface relevant commitments during quotations and die transfer/custody.

**Data and controls.** Use existing finance postings rather than a separate editable paid balance. Ownership must not be inferred solely from who paid an invoice. Agreement interpretation and accounting/tax decisions require authorized business review.

**Complexity, dependencies, and owner.** C4 due to contracts, financial allocation, historical snapshots, and later-order recovery. Coordinate with NOV-025/042/064/077. Sales/accounts own applicability; tooling maintains identity.

**Acceptance and measurement.** Test partial payment, waiver, credit, recovery cap, changed agreement, cancelled order, ownership transfer, and dispute. Reconcile one real agreement to issued documents and receipts. This remains conditional until tooling charging arrangements and their volume are confirmed.

<a id="nov-067"></a>

### NOV-067 - Handle stock transfers between warehouses properly

**Assessment:** C4 | U4 | N3. **Original:** Batch 4, item 7.

**Purpose and employee flow.** A warehouse transfer should track material from request through issue, in-transit custody, receipt, discrepancy resolution, and closure. Destination stock must reflect actual receipt, not merely an outgoing request.

**Scope and starting point.** Extend locations, stock movement, bundle identity, reservations, and receipt controls. Validate multi-location operations before adding a dedicated lifecycle.

**Implementation.**
1. Create transfer lines with exact source stock, quantities, units, destination, owner, and planned movement.
2. Reserve eligible material and record issue atomically into an explicit in-transit position.
3. Capture partial destination receipts and quality/condition observations.
4. Resolve short, damaged, refused, returned, or lost material through approved dispositions.
5. Close with reconciled issued/received/outstanding quantities and retained gate/transport evidence.

**Data and controls.** Prevent duplicate issue/receipt, negative source stock, invalid locations, and cross-company references. Keep custody separate from ownership; transfer receipt must not silently clear a QC hold. In-transit material cannot appear as free stock in both warehouses.

**Complexity, dependencies, and owner.** C4 because stock conservation, partial movements, concurrency, and physical reconciliation are essential. Coordinate with NOV-027/028/030/068/077. Stores owns source/destination responsibility.

**Acceptance and measurement.** Test competing reservations, partial receipts, wrong bundle, destination rejection, transfer cancellation before/after issue, repeated confirmation, and a lost response. Physically reconcile a pilot movement at both ends. Measure unexplained in-transit balances and duplicate entry.

<a id="nov-072"></a>

### NOV-072 - Manage ageing or heat-treatment batches

**Assessment:** C4 | U4 | N3. **Original:** Batch 4, item 12.

**Purpose and employee flow.** Where ageing or heat treatment is part of production, record which material underwent which approved process and which evidence supports release.

**Scope and starting point.** Extend production batches, machines, specifications, quality plans, documents, and qualification controls. Process recipes and acceptance limits must come from qualified technical owners.

**Implementation.**
1. Define approved recipe revisions, compatible material/specifications, equipment capability, and required observations.
2. Create a treatment batch with exact input identities, quantities, loading arrangement, and operator authority.
3. Record actual start/end, observations, deviations, unloading, and relevant equipment/instrument evidence.
4. Route batch review, test results, partial acceptance, retreatment, and release through guarded quality actions.
5. Link output to each input lot and carry the applicable treatment evidence downstream.

**Data and controls.** Planned recipe values must not become actual readings automatically. Preserve historical recipes and actual observations. A completed timer is not proof of conformance; technical review determines acceptance. Direct machine control is outside this scope.

**Complexity, dependencies, and owner.** C4 for batch genealogy, equipment capability, actual process evidence, and quality release. Coordinate with NOV-025/027/051/055/070. Production/quality owns the process.

**Acceptance and measurement.** Test mixed incompatible inputs, interrupted cycle, out-of-range observation, missing reading, recipe revision, partial reject, retreatment, and equipment withdrawal. Validate on real process records and physical batches. Adopt only if this operation is present and technical ownership is established.



## C5: Advanced lifecycles, planning, and integrations

These twelve entries require discovery and staged implementation. A reliable advisory slice often precedes enforcement, automation, or external writes.

<a id="nov-034"></a>

### NOV-034 - Show consequences of an order revision

**Assessment:** C5 | U1 | N1. **Original:** Batch 2, item 14.

**Purpose and employee flow.** When an approved order changes, employees should see what must be reconsidered: stock reservations, production, drawings, finishing, packing, dispatch, billing, and customer commitments. The original confirmed state remains understandable.

**Scope and starting point.** Extend quote/order revisions, source fingerprints, SOP invalidation, and existing correction/reversal paths. Full impact propagation is broader than a comparison of two order forms.

**Implementation.**
1. Define material change types and domain-specific dependency relationships with exact source/line/revision identities.
2. Generate an impact proposal separating unaffected work, refreshable drafts, required re-review, operational holds, and posted transactions requiring correction.
3. Show affected quantities, already irreversible work, customer consequences, owners, and required approvals.
4. Apply the approved revision using an order/version boundary and transaction-safe domain actions; use retained pending resolution steps where a single database transaction cannot cover the process.
5. Require acknowledgement/review of changed evidence and refresh downstream readiness.
6. Preserve the original revision, impact decision, action outcomes, deviations, and unresolved obligations.

**Data and controls.** A proposed change_set/impact_action model should reference existing domain records rather than copy their state. Do not directly rewrite issued invoices, consumed stock, completed inspections, or dispatched loads. Changed input must not invalidate unrelated work. Prevent cycles and duplicate effects when the same source is revisited.

**Complexity, dependencies, and owner.** C5 because dependency analysis, several transaction lifecycles, partial completion, and historical evidence interact. Coordinate with NOV-005/007/027/051/057/058/062. Operations leads with technical, stores, quality, dispatch, and accounts.

**Acceptance and measurement.** Test changes before production, after partial production, after packing, and after invoicing; include simultaneous edits, reversal of required evidence, abandoned impact proposals, and retries. Verify affected work is routed correctly while historical documents remain immutable. Begin with one change type and an advisory impact report; measure downstream corrections missed and unresolved change actions. This difficult U1 target warrants early discovery rather than waiting for every easier refinement.

<a id="nov-021"></a>

### NOV-021 - Check delivery feasibility before promising a date

**Assessment:** C5 | U2 | N1. **Original:** Batch 2, item 1.

**Purpose and employee flow.** Sales should propose a delivery date based on identifiable available stock, material, resource capacity, downstream processing, and existing commitments. Employees should be able to explain what makes a date feasible and what remains uncertain.

**Scope and starting point.** Extend SRC-PLAN shift capacities, maintenance blocks, slots, readiness, and delivery proposal foundations. The inspected schedule checker already rejects several capacity conflicts; the November target coordinates the full route.

**Implementation.**
1. Define a route with required operations, compatible resources, setup/run assumptions, calendars, buffers, finishing lead time, and quantity basis.
2. Distinguish confirmed available stock/supply from tentative receipts and forecast capacity.
3. Calculate an explainable earliest feasible proposal using deterministic forward scheduling for a bounded route before considering advanced optimization.
4. Support split delivery where policy permits, with separate quantities/dates and a visible remaining obligation.
5. Retain the proposal's source snapshot, assumptions, expiry, and confidence limitations.
6. Recheck capacity/material at authorized commitment and record whether a temporary reservation or firm plan was created.

**Data and controls.** A proposal must not silently reserve material or become a customer promise. Account for press, die, shared downstream resources, quality holds, maintenance, and working calendars without double-counting capacity. Unknown lead time should produce an incomplete proposal. This design follows the capacity/material coordination described in [operations scheduling documentation](https://learn.microsoft.com/en-us/dynamics365/supply-chain/production-control/operations-scheduling).

**Complexity, dependencies, and owner.** C5 due to several constraint types and uncertain future inputs. Coordinate with NOV-022/024/026/043/044/045/047. Planning owns feasibility; sales owns accepted customer commitments.

**Acceptance and measurement.** Test material arriving after a free slot, incompatible press/die, overnight calendars, vendor delays, split orders, stale proposals, and competing commitments. Reconcile a planning pilot against actual execution. Measure date changes and late promises while recording assumption quality; do not present a calculated date as a guaranteed outcome.

<a id="nov-027"></a>

### NOV-027 - Trace material from source to customer

**Assessment:** C5 | U2 | N1. **Original:** Batch 2, item 7.

**Purpose and employee flow.** Staff should trace an affected lot backward to its material/process evidence and forward to stock, bundles, dispatches, customers, and returns. This supports focused investigation of a quality or material issue.

**Scope and starting point.** Extend existing source IDs across billets, jobs, stock batches, finishing, inspections, packing, dispatch, and returns. Identify missing links before claiming end-to-end traceability.

**Implementation.**
1. Inventory current lineage and define stable identities for material lots, transformations, quantities/units, ownership, and technical revisions.
2. Record explicit input-to-output relationships for production, split/merge, finishing, packing, transfer, rework, and return events.
3. Enforce same-company references, lifecycle validity, and conservation/reconciliation rules at each transformation.
4. Build bounded backward/forward traversal with visited-node protection, pagination, and evidence links.
5. Support an impact review/quarantine proposal using the discovered sources, with authorized human disposition.
6. Reconcile legacy links through evidenced mapping; preserve "unlinked historical source" when certainty is unavailable.

**Data and controls.** Proposed transformation/lineage relations must complement existing ledgers, not replace transaction ownership. Never infer a lot relationship merely from similar dates, profile codes, or quantities. A traversal must remain permission-safe and avoid exposing another customer's restricted commercial information.

**Complexity, dependencies, and owner.** C5 because many-to-many material transformations, historic incompleteness, reversals, and different quantity bases interact. Coordinate with NOV-005/028/031/038/062/067/068/069/072/079. Quality and stores own traceability definitions.

**Acceptance and measurement.** Test multiple inputs/outputs, split finishing receipts, returned material, reversed events, missing links, cycles, large graphs, and tenant boundaries. Run a physical sample investigation from billet to customer and back, with explicit unknowns. Measure coverage, traversal time, and completeness of affected-material identification; passing a synthetic graph test alone does not prove physical traceability.

<a id="nov-068"></a>

### NOV-068 - Split and combine physical bundles with traceability

**Assessment:** C5 | U2 | N1. **Original:** Batch 4, item 8.

**Purpose and employee flow.** When staff split a bundle or combine compatible material, the resulting tags and balances should reflect the physical operation and preserve every relevant source relationship.

**Scope and starting point.** Extend stock/bundle capture, reservations, labels, packing, and traceability. This is a physical transformation lifecycle, not renaming a stock row.

**Implementation.**
1. Define which operations are permitted for available, reserved, held, customer-owned, packed, or dispatched material.
2. Capture input identities and observed quantities, review compatibility, and propose output bundle identities with lengths/pieces/net kg.
3. Finalize input consumption and output creation atomically under locks, with idempotent request identity.
4. Preserve each output's composition by source and carry applicable specification, ownership, and restrictive quality state.
5. Generate new labels and make old label resolution show transformation history instead of another free-stock position.
6. Handle recording mistakes through controlled inverse/correction events, considering downstream consumption.

**Data and controls.** Reconcile pieces, lengths, and measured weight according to approved precision and explicit variance handling. Packaging tare is not metal. Prevent duplicate active identity, negative availability, reservation theft, incompatible mixing, or creation of extra material. Do not impose arbitrary weight tolerances; quality/stock owners must approve them. [GS1 traceability guidance](https://www.gs1.org/docs/traceability/Global_Traceability_Standard.pdf) treats splitting/grouping/repacking as relationships requiring traceable events.

**Complexity, dependencies, and owner.** C5 because source composition, physical observations, reservations, labels, corrections, and concurrent writers all interact. Coordinate with NOV-017/027/029/030/036/079. Stores/packing owns the physical pilot.

**Acceptance and measurement.** Test split, many-to-one merge, split-then-merge, held input, reserved input, duplicate scan, concurrent selection, lost response, and downstream-used correction. Reconcile actual tagged material before enabling broad use. Measure unidentified repacked material and balance discrepancies, keeping evidence of conservation at every step.


<a id="nov-035"></a>

### NOV-035 - Compare estimated and actual job profitability

**Assessment:** C5 | U2 | N2. **Original:** Batch 2, item 15.

**Purpose and employee flow.** Owners and eligible accounts/production staff should compare the approved quotation assumptions with recorded job outcomes. The view should explain material, conversion, finishing, freight, and rework differences instead of displaying an unexplained profit figure.

**Scope and starting point.** Extend quote costing snapshots, actual material consumption, production observations, finishing charges, expenses, invoices, returns, and approved cost allocations.

**Implementation.**
1. Agree the management-costing boundary, allocation methods, quantity basis, revision rules, and distinction between provisional and finalized values.
2. Link actual cost sources to order lines/jobs without counting reserved material as consumed or supplier invoices twice.
3. Attribute scrap recovery, returns, shared runs, rejected output, transport, and rework using explicit approved rules.
4. Present estimated versus recorded cost with source drill-down and unallocated/missing amounts.
5. Produce as-of snapshots and controlled refresh/finalization, retaining later adjustments as new evidence.

**Data and controls.** Use the existing financial/stock ledgers and a reconciled allocation layer; do not invent a second accounting ledger. Proposed cost_allocation records need exclusivity/cap checks and source versioning. Restrict internal cost, margin, and profit from unauthorized staff/customer documents. Revenue and tax semantics follow approved finance configuration.

**Complexity, dependencies, and owner.** C5 because cross-module cost attribution, partial fulfillment, timing, reversals, and uncertainty can materially change results. Coordinate with NOV-012/027/031/038/054/058/064. Accounts approves definitions; operations validates physical sources.

**Acceptance and measurement.** Test shared production runs, partial invoices, late vendor bills, returned material, scrap credits, rework, cancelled costs, and missing machine observations. Reconcile sample totals to source transactions and display provisional status honestly. Begin with one order family and a transparent variance report before automated management decisions. Measure coverage and explanation quality as well as variance.

<a id="nov-020"></a>

### NOV-020 - Remove double entry between operations accounts and equipment

**Assessment:** C5 | U3 | N2. **Original:** Batch 1, item 20.

**Purpose and employee flow.** Remove selected duplicate entry between ExtrusionOS, accounting software, spreadsheets, and equipment. Employees should see exactly which transaction transferred, whether it failed, and how to reconcile it.

**Scope and starting point.** Extend existing authorized exports/import boundaries and domain actions. Discover the actual accounting system, provider access, hardware protocol, and operating volume before choosing a connector.

**Implementation.**
1. Select one direction and transaction family, such as export of issued invoices, and define the system of record for every mapped field.
2. Version mappings for identity, parties, dates, units, tax configuration, accounts, corrections, and rounding.
3. Implement a reviewable import/export or server-side adapter with stable external identities and duplicate detection.
4. Use an outbox/job lifecycle, bounded retries, request deduplication, and clear unresolved/error queues.
5. Reconcile accepted external records against authoritative local transactions, including reversals and amendments.
6. Expand only after a representative pilot; bidirectional sync requires conflict ownership and a separate reviewed scope.

**Data and controls.** Keep credentials server-side with least required privilege. Do not trust incoming company identity or a device's number without provenance and validation. Provider acknowledgement is not proof of a correct external posting. Include retention and employee access for transferred data.

**Complexity, dependencies, and owner.** C5 because external APIs/device protocols, contract changes, reconciliation, and failures lie outside a single local transaction. Coordinate with NOV-019/061/074/080/098. Accounts or the equipment-owning department sponsors each connector.

**Acceptance and measurement.** Test repeated imports, partial rejection, changed mappings, external downtime, duplicate supplier references, stale credentials, corrections, and reconciliation mismatch. Validate on the actual external system with approved test records before live writes. Measure duplicate entry and unresolved transfers; do not promise compatibility before provider/hardware discovery.

<a id="nov-023"></a>

### NOV-023 - Suggest compatible production runs and their sequence

**Assessment:** C5 | U3 | N2. **Original:** Batch 2, item 3.

**Purpose and employee flow.** Planning should receive explainable suggestions for compatible grouped runs and their sequence. A useful proposal balances setup effort, resource readiness, delivery priority, and downstream constraints.

**Scope and starting point.** Extend current schedule/compatibility rules, approved specifications, die history, and order-line requirements. Keep each customer's quantity and source obligation traceable inside a shared run.

**Implementation.**
1. Define hard compatibility rules for profile/die, alloy, temper, finish, customer ownership, quality, equipment, and approved process.
2. Gather bounded eligible demand and current resource/material readiness.
3. Start with deterministic grouping and a reviewed heuristic sequence; state the objective, such as fewer changeovers subject to due-date constraints.
4. Explain every inclusion/exclusion, expected setup/run duration, affected orders, and quantity allocation.
5. Preview the resulting schedule and reservations, then apply through existing guarded actions.
6. Compare proposed versus actual outcomes and refine approved assumptions.

**Data and controls.** A shared run must retain per-order/line contribution and output allocation. Never merge incompatible customer requirements merely because profile codes match. Predicted yield or duration remains an estimate and cannot replace actual observations.

**Complexity, dependencies, and owner.** C5 because grouping, sequencing, allocations, competing constraints, and incomplete operating data interact. Coordinate with NOV-021/024/025/027/043/044/045. Planning and technical owners approve compatibility and objectives.

**Acceptance and measurement.** Test urgent late additions, compatible dies on different presses, inadequate billets, downstream bottlenecks, partial runs, mixed technical revisions, and concurrent plan changes. Pilot a small planning horizon and compare changeovers, on-time work, waste, and explanation quality. Avoid an opaque optimizer until input quality and simple heuristics have been validated.

<a id="nov-024"></a>

### NOV-024 - Add a what happens if planning tool

**Assessment:** C5 | U3 | N2. **Original:** Batch 2, item 4.

**Purpose and employee flow.** Supervisors should preview the consequences of a breakdown, urgent order, extra shift, or delayed receipt before changing the working plan. A scenario should show affected jobs, dates, resources, and assumptions.

**Scope and starting point.** Extend SRC-PLAN snapshots and conflict inspection. Keep scenarios isolated from live stock, assignments, customer promises, and published schedules.

**Implementation.**
1. Capture an authorized versioned planning snapshot with a defined horizon and source completeness.
2. Apply bounded hypothetical changes to a scenario overlay, reusing domain compatibility/calendar/capacity rules.
3. Compare baseline and proposal using quantities, commitment dates, overtime assumptions, conflicts, and unresolved requirements.
4. Let planners revise, share with eligible reviewers, or discard a scenario.
5. At apply, rebase against current sources, reject conflicts, and convert only approved changes through guarded domain actions.
6. Retain the accepted scenario and actual change outcomes for later review.

**Data and controls.** Hypothetical receipts/capacity must be clearly labelled and cannot satisfy actual readiness. Never send automatic customer commitments from a simulation. Recheck authority and source versions because the live plan can change during review.

**Complexity, dependencies, and owner.** C5 due to shared planning logic, scenario persistence, comparison, stale-state rebasing, and coordinated application. Coordinate with NOV-021/023/026/034/043/044/047. Planning owns the process.

**Acceptance and measurement.** Test a breakdown over multiple shifts, source changes after snapshot, delayed supply, impossible scenario, missing baseline data, two reviewers, and partial apply failure. Pilot advisory comparisons first. Measure time to identify a viable response and downstream commitments overlooked; label estimates and data limitations prominently.


<a id="nov-061"></a>

### NOV-061 - Turn customer purchase orders into reviewable drafts

**Assessment:** C5 | U3 | N2. **Original:** Batch 4, item 1.

**Purpose and employee flow.** Sales can upload a customer PO or paste an enquiry and receive a reviewable draft of proposed order lines. The software should identify likely profile matches, quantities, lengths, finish, dates, and missing information while leaving confirmation to an authorized employee.

**Scope and starting point.** Extend existing document extraction/import foundations, customer aliases, quotation/order entry, and approved technical/commercial mapping. Customer PO extraction is a different target from supplier-invoice recognition.

**Implementation.**
1. Retain the original document with tenant-scoped access, file validation, source checksum, and duplicate-submission detection.
2. Extract candidate values into a structured schema with page/region evidence and explicit uncertainty.
3. Match customer profile codes/aliases and units to permitted masters; present ambiguous or unmatched items for resolution.
4. Compare the PO against the accepted quote/agreement, showing price, specification, date, and quantity differences.
5. Build an unsaved draft through existing form contracts, preserving the source/evidence link.
6. Require human review and normal server validation before any confirmed order or customer commitment.

**Data and controls.** Treat document text as untrusted data, including embedded instructions; extraction must not execute commands or alter permissions. Keep provider credentials server-side and obtain an approved data-processing arrangement if external extraction is used. Unknown fields stay unresolved rather than guessed.

**Complexity, dependencies, and owner.** C5 due to OCR/document variability, matching, external provider considerations, commercial differences, and review quality. Coordinate with NOV-007/010/011/062/064/094. Sales owns templates and acceptance.

**Acceptance and measurement.** Use scanned/rotated/multi-page POs, mixed units, duplicate codes, unclear decimals, amended POs, conflicting quotes, and malicious document text. Compare extraction field-by-field to a representative reviewed sample, including correction effort. Start with one common customer format and never equate successful extraction with an accepted order.

<a id="nov-080"></a>

### NOV-080 - Provide a controlled automation workbench

**Assessment:** C5 | U3 | N2. **Original:** Batch 4, item 20.

**Purpose and employee flow.** Managers should configure approved trigger-condition-action rules using business language, preview their effects, test safely, and understand actual execution results.

**Scope and starting point.** SRC-AUTO already stores rules and logs simulated runs. The inspected Run now path writes a simulated result under a completed status. First make that distinction explicit; a real reliable runner is a separate staged extension.

**Implementation.**
1. Replace unrestricted employee-facing configuration with typed allowlisted triggers, fields, operators, and action forms.
2. Version rule definitions, policy authority, scope, effective dates, and release approval.
3. Provide validation and dry-run preview against bounded permitted records, labelled as simulation.
4. Implement a server-controlled event/outbox runner with stable event/rule/action keys, leases, bounded retries, and loop prevention.
5. Execute only approved domain actions, with authority checked at execution and per-action outcomes.
6. Show queued, executing, succeeded, failed, skipped, uncertain, and simulated results distinctly; support pause and reviewed recovery.

**Data and controls.** Do not execute arbitrary JSON as code or let rules bypass RLS, finance/stock guards, recipient review, or separation of duties. Resolve service credentials through least-privileged server boundaries. External notifications need verified providers and delivery semantics.

**Complexity, dependencies, and owner.** C5 because event guarantees, delayed authority, recursion, retries, effects, and external states interact. Coordinate with NOV-015/019/020/042/050/098. Operations approves rule families; engineering owns execution integrity.

**Acceptance and measurement.** Test duplicate events, runner restart, expired actor authority, rule revision during execution, action timeout after commit, poison event, recursion, pause, and provider outage. Pilot one internal task-creation rule. Treat clear simulation labelling as an early bounded honesty improvement, even though the full workbench remains U3. Measure manual chasing replaced and unresolved/duplicate effects.

<a id="nov-032"></a>

### NOV-032 - Support customer-owned metal and job-work settlement

**Assessment:** C5 | U4 | N3. **Original:** Batch 2, item 12.

**Purpose and employee flow.** If customers supply their own metal, the company needs a traceable account of what was received, consumed, produced, returned, scrapped, lost under agreed rules, and charged for conversion.

**Scope and starting point.** Extend inventory ownership, production consumption/output, quality, scrap, returns, contracts, and invoicing. Confirm actual customer-metal/job-work arrangements before implementation.

**Implementation.**
1. Record the agreement's ownership, material/specification basis, permitted mixing, agreed loss/scrap treatment, billing basis, and review authority.
2. Receive and identify customer-owned material separately from company-owned stock, including quality status and custody.
3. Preserve ownership and source allocation through partial production, shared resources, finishing, repacking, and returns.
4. Reconcile opening plus receipts to usable balance, issued material, output, scrap, explained loss, and returns using approved quantity definitions.
5. Generate a reviewable material statement and conversion-charge draft, retaining the applied agreement revision.
6. Resolve disputed differences and corrections through authorized events before settlement.

**Data and controls.** Custody and legal/commercial ownership are separate. Never use one customer's material for another's job merely because alloy matches. Company stock balances must not include customer-owned free availability. Agreement interpretation, tax, and accounting treatment require qualified business review.

**Complexity, dependencies, and owner.** C5 because ownership segregation, transformation genealogy, shared runs, contracts, and financial settlement interact. Coordinate with NOV-012/027/031/035/038/068. Stores/production/accounts own a joint pilot.

**Acceptance and measurement.** Test mixed ownership proposals, partial consumption, customer-authorized mixing, rejected material, scrap return, rework, conversion billing, and disputed loss. Physically reconcile one customer account and its source records. This U4 becomes high need when the operating model is confirmed; do not infer agreed loss percentages from industry assumptions.

<a id="nov-074"></a>

### NOV-074 - Add a complete weighbridge transaction workflow

**Assessment:** C5 | U4 | N3. **Original:** Batch 4, item 14.

**Purpose and employee flow.** Pair the correct gross and tare readings for a vehicle/load, derive net weight, and reconcile it with selected material or incoming goods. Staff should retain the original reading evidence and understand every adjustment.

**Scope and starting point.** Extend measured bundle/dispatch weights, incoming receipts, vehicle/loading identity, instrument evidence, and optional equipment integration. Begin with a reviewed manual-reading workflow if device access is unavailable.

**Implementation.**
1. Discover the actual weighbridge protocol, identifiers, precision, calibration evidence, operator process, and failure behavior.
2. Create a weighing session tied to the vehicle, movement/load, source instrument, and request identity.
3. Capture immutable readings with units, timestamp, raw/provider reference, and operator confirmation where required.
4. Pair compatible gross/tare observations, calculate net under approved rules, and flag impossible or unexplained differences.
5. Reconcile metal, packaging, vehicle/custody context, and selected bundle/receipt quantities.
6. Finalize through the existing stock/dispatch/receipt boundary and retain reviewed correction/supersession history.

**Data and controls.** A device packet is not automatically a trusted transaction. Handle repeated, stale, unstable, wrong-vehicle, disconnected, and out-of-order readings. Define tare reuse and observation windows explicitly; reject negative net values and unexplained pairing. Never overwrite recorded measured weight with theoretical weight to force agreement.

**Complexity, dependencies, and owner.** C5 because hardware, physical identity, calibration, transaction finality, and reconciliation interact. Coordinate with NOV-012/020/036/069/070/098. Dispatch/stores and the equipment owner approve the pilot.

**Acceptance and measurement.** Test actual device/manual fallback, two vehicles, repeated packets, reversed reading order, interrupted sessions, invalid units, unstable readings, expired evidence, and lost response after commit. Reconcile physical loads and printed slips. Promote this conditional feature when the factory's equipment/process is confirmed; a mocked adapter alone is not equipment acceptance.



## Delivery plan and verification

### Begin with a gap audit, not a rebuild

Before estimating any NOV entry, open its current owning source, related older-catalogue delivery record, relevant schema, and employee journey. Record one of: already satisfies target, partially satisfies target, new capability, applicability unconfirmed, or current behavior unverified. Record code evidence separately from deployed and operator evidence. This classification determines the remaining work.

The documentary count in UPGRADE_EOS.md does not establish that these November targets are complete. Conversely, an entry in this file does not establish that its foundations are missing. Avoid replacing a functioning workflow merely because its earlier feature number differs.

The development checkout has unrelated KPI/navigation/acceptance work. Reconcile that work with its owner before overlapping implementation. Documentation can describe reuse and open questions without absorbing those source edits.

### Recommended delivery sequence

| Stage | Work package | Representative NOV entries | Exit condition |
| --- | --- | --- | --- |
| 0 | Confirm the actual gaps and operating definitions | All selected entries; especially 005, 012, 021, 027, 034, 054, 080 | Source ownership, pilot users, data availability, policy questions, and evidence boundary recorded |
| 1 | Make daily screens readable and recoverable | 083, 084, 085, 086, 088, 091, 092, 093, 095, 096, 098, 099, 100 | Representative tasks work at desktop/phone widths with clear identity, validation, and truthful outcomes |
| 2 | Establish ownership and a useful daily queue | 001, 002, 004, 016, 040, 041, 043, 046, 048, 049, 050, 056 | Employees can identify their work and unresolved requests; no task ownership is inferred from a notification |
| 3 | Make known data reusable and preserve unfinished work | 006, 007, 008, 009, 010, 011, 012, 013, 094, 097 | Reviewed source carry-over, draft recovery, quantity basis, and final transaction behavior reconcile |
| 4 | Connect controlled execution and physical evidence | 005, 015, 022, 028, 031, 042, 051, 057, 062, 069, 076 | End-to-end pilot reconciles actual work, accepted quantities, responsibility, and historical evidence |
| 5 | Expand adjacent daily workflows | 014, 017, 018, 019, 025, 030, 033, 036, 038, 055, 058, 063, 070, 075, 077, 078, 079 | Pilot teams complete bounded processes with their real documents/material and approved exception routes |
| 6 | Improve coordinated planning and analysis | 021, 023, 024, 026, 035, 039, 044, 045, 047, 052, 053, 054, 059, 060, 064, 066, 087 | Assumptions, source completeness, effect on commitments, and observed outcomes are explainable |
| 7 | Complete broad lineage and change propagation | 027, 029, 034, 068 | Transformation, version, reversal, and competing-session invariants hold and physical reconciliation passes |
| 8 | Add verified integrations and controlled automation | 020, 061, 080; 074 where applicable | Real provider/device tests, retries, execution-state truth, and reconciliation are demonstrated |
| 9 | Deliver specialized operating models where confirmed | 032, 037, 065, 067, 071, 072, 073, 074 | Actual contract/site/process applicability, technical owner, and physical acceptance are established |

These stages are overlapping work packages, not a strict waterfall or a second feature count. Start discovery for difficult U1 work such as NOV-034 in stage 0 while bounded improvements proceed. NOV-027/068 provide foundations for other stages and may need an earlier thin slice. NOV-080's simulation labelling can be corrected as a small early subtask without pretending its full runner is ready. Specialized processes should move earlier when their real business need is confirmed.

### Shared implementation packages and dependency seams

| Package | Shared engineering to build once | Consumers |
| --- | --- | --- |
| Interface composition | Page layouts, headers, identity strip, action placement, density, status, empty/error, accessible dialogs | 002, 006, 016, 018, 081-086, 088-093, 095-100 |
| Authorized action descriptor | Source identity/version, permitted next step, readiness issues, review and result contracts | 001, 003, 004, 014-019, 042, 051, 097, 098 |
| Source-to-draft contract | Field precedence, provenance, explicit override, calculation basis, draft recovery | 006-013, 061, 064, 094, 096 |
| Versioned evidence | Applicable drawing/specification/SOP/customer requirement, qualification, review, issued snapshot | 007, 033, 034, 051, 055, 057, 062, 063, 069-073, 079 |
| Responsibility and coordination | Coordinator, task assignee, request, accepted handoff, authority, backup, priority | 001, 015, 040-050, 056, 058 |
| Quantity and transformation lineage | Typed units, source balances, partial disposition, split/merge, custody, correction | 005, 012, 027-032, 036-038, 058, 067-069, 072, 074, 076 |
| Planning snapshots | Calendars, compatibility, readiness, capacity, versioned proposals, scenario comparison | 021-026, 043-047 |
| Reliable async/external effects | Request identity, outbox, execution leases, retries, provider acknowledgement, reconciliation | 019, 020, 061, 074, 080, 098 |
| Process learning | Observations, denominators, improvement trials, feedback, effectiveness review | 039, 053-055, 059, 060, 066 |

A dependency may mean shared design rather than "finish every other feature first". Choose the smallest complete path for a representative task, then extend its coverage.

### Proposed contract patterns

These are implementation design requirements, not declarations that new tables or APIs already exist.

| Contract | Required information | Invariant |
| --- | --- | --- |
| Readiness | Domain action, source identity/version, enforced blockers, advisories, source freshness | Only the authoritative final action can commit; a green UI is not authority |
| Draft | Tenant/user scope, draft ID, schema revision, source references, inputs, saved revision, expiry | Restoring entries does not restore stale eligibility or duplicate a final transaction |
| Preview/confirm | Request ID, reviewed source fingerprint, proposed effect, warnings, authorization scope | A changed relevant source requires re-review or an explicit domain conflict |
| Final result | Request ID, definitive/uncertain status, outcome identity, effect summary, retry guidance | No success claim before a known authoritative outcome |
| Handoff | Source event, team, quantity/unit, acceptance contract, owner, due basis, retained outcomes | Replaying an event creates one valid obligation; responsibility is not lost during clarification |
| Material event | Inputs/outputs, quantity dimensions, ownership, quality, physical observation, correction link | No duplicate active quantity or incompatible transformation; differences require explanation |
| Versioned requirement | Released revision, applicability, effective date, reviewer, in-flight treatment | Completed work retains the version and evidence that actually governed it |
| External transfer | Local/external identity, mapping version, request/result, provider evidence, reconciliation | Retry does not create a second exclusive transfer or confuse acceptance with delivery |

For async outcomes, the normal sequence is prepare -> review -> submit -> confirmed or rejected. A transport interruption may instead lead to uncertain -> query original request -> confirmed or rejected. A new submission is appropriate only after the earlier outcome is resolved or the domain proves retry with the same identity is safe.

### Database and migration plan for a selected feature

1. Inspect the current schema, migration chain, constraints, functions, authorized views, and hosted ledger where relevant.
2. Map proposed fields/entities to existing ownership. Identify obsolete duplicate proposals before writing migrations.
3. Define invariants and a compatibility strategy for existing records, clients, and partially completed work.
4. Add nullable/compatible structures, tenant indexes, policy checks, and constrained state transitions.
5. Backfill only when source evidence supports the mapping; retain unknown historical attribution explicitly.
6. Replay the relevant migration chain locally and verify realistic fixtures and guarded writes.
7. Test independent authenticated sessions for competing writes and role/company isolation.
8. Prepare hosted migration and application rollout as separate reviewed operations with monitoring and recovery steps.
9. Validate the actual hosted schema/application and operator flow before updating delivery status.

Recovery means disabling a feature, reverting compatible application exposure, or applying a corrective additive migration as appropriate. It does not mean deleting operational history or reversing stock/finance events without their approved domain procedure.

### Verification matrix

| Layer | Appropriate evidence | What it does not prove |
| --- | --- | --- |
| Unit/domain | Parsing, units, rounding, precedence, state transitions, compatibility, date boundaries, duplicate identity logic | Hosted policies, network behavior, physical observation |
| Component/browser fixture | Keyboard/focus, validation, responsive layout, retained draft input, loading/error states | Signed-in RLS or actual provider/device operation |
| Local database replay | Migration order, constraints, functions, guarded transitions, realistic SQL fixture reconciliation | Hosted ledger parity or independent authenticated contention |
| Independent-session database | Competing allocation, receipt, approval, schedule, split/merge, retry after commit | Physical identity or operator understanding |
| Signed-in role/company | Permitted reads/writes, denied paths, authorized views, Storage, exports, portal-safe fields | Whether factory quantities match the digital records |
| Provider/device | Real mapping/protocol, duplicate/retry, uncertain outcomes, acknowledgement, actual reconciliation | Every future provider change or factory scenario |
| Physical/employee acceptance | Actual devices, tags, material, documents, task observation, reconciliation, relevant exceptions | Permanent correctness after later process/schema changes |
| Hosted/deployed verification | Applied migration state, application revision, configuration, signed-in smoke and monitored errors | Acceptance of unrelated catalogue items |

For application code changes, run the repository's available npm run lint, npm run typecheck, npm run build, and npm test commands after focused relevant checks. Use meaningful domain and integration tests for consequential logic. For a reversible presentation change, inspect the actual interaction instead of adding brittle tests that merely repeat CSS classes.

This catalogue itself is documentation-only. Its verification consists of exact feature coverage, required-section completeness, sort/rating consistency, links/anchors, Markdown structure, and file integrity. It does not record a new application test run or migration acceptance.

### Minimum employee pilot checklist

- Confirm the pilot's exact task, role, device, site/shift, and data scope.
- Observe the current method, including calls, spreadsheets, paper, interruptions, and unofficial workarounds.
- Agree field meanings, ownership, what done means, permitted exceptions, and source of truth.
- Trial the new method on representative cases, including at least the relevant partial/failure/retry path.
- Verify physical records and quantities where the feature changes stock, material, quality, or dispatch.
- Record completion time, fields typed, corrections, first-time acceptance, unresolved exceptions, and help needed.
- Retain sample size, date, data quality, and other process changes; do not claim causation or a fixed percentage saving without adequate evidence.
- Resolve blocking findings, update instructions/competency as required, and approve a bounded rollout.
- Confirm the hosted/application configuration separately and monitor meaningful failures after release.

### Definition of done for a delivery record

A selected feature slice is done only when its approved scope is implemented, relevant tests/checks pass, security and failure paths are verified, documents/calculations reconcile, operator findings are resolved, and the required deployment/physical acceptance evidence exists. If some evidence remains open, record exactly which layer is complete and which remains pending.

A future delivery record should contain: NOV ID; preserved original idea; chosen scope and exclusions; source commit; created/modified files; migration and hosted status; RLS/Storage changes; policy owner; tests and commands with results; manual/physical trial evidence; assumptions; known limitations; and the next specific acceptance gate. This is a record format, not an authorization to implement or deploy all 100 entries.

## External design and engineering references

The feature proposals and priorities are recommendations for ExtrusionOS. The following primary references support particular design principles; they do not establish company certifications, current feature completion, contractual requirements, legal limits, or guaranteed outcomes.

| Reference | Use in this catalogue |
| --- | --- |
| [W3C: Understanding WCAG 2.2](https://www.w3.org/WAI/WCAG22/Understanding/) | Keyboard access, focus, contrast, labels, text enlargement, reflow, and accessible interaction |
| [Supabase: Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) | Database policy boundary for tenant- and role-safe operations |
| [ASQ: Plan-do-check-act cycle](https://asq.org/quality-resources/pdca-cycle) | Small improvement trials, outcome review, and controlled adoption |
| [NIST: Value stream mapping](https://www.nist.gov/mep/value-stream-mapping) | Observing the full work and information journey, including waiting and rework |
| [NIST: Policy on metrological traceability](https://www.nist.gov/calibrations/traceability) | Documented measurement/calibration relationships and uncertainty |
| [GS1: Global Traceability Standard](https://www.gs1.org/docs/traceability/Global_Traceability_Standard.pdf) | Explicit traceable transformations, grouping, splitting, and repacking relationships |
| [Microsoft: Operations scheduling](https://learn.microsoft.com/en-us/dynamics365/supply-chain/production-control/operations-scheduling) | Coordination of resource capacity, materials, calendars, and production sequence |

## Catalogue integrity record

- Original scope: five chat batches of twenty suggestions each.
- Stable IDs: NOV-001 through NOV-100, each with one detailed specification.
- Detailed sort: C1 to C5; U1 to U4, then N1 to N3, then ID within a complexity tier.
- Register totals: C1 5; C2 14; C3 35; C4 34; C5 12.
- Urgency totals: U1 44; U2 39; U3 9; U4 8.
- Coverage: original mapping, complexity register, urgency index, and detailed sections retain all 100 identities.
- Scope of this creation: a planning document only; no application feature, migration, production data change, external message, or deployment is performed by writing it.

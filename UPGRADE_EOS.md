# ExtrusionOS Upgrade Catalogue

Created: 21 October 2026
Status: Implementation started; completion is tracked per feature with verification evidence
Audience: Business owner, department supervisors, product planners, and developers
Scope: All 100 features discussed, preserved in their original order

Employees should enter new facts once, follow an agreed operating method, and see the next useful action beside their work. ExtrusionOS should retrieve known information, calculate derived values, and verify important business conditions.

This document explains the target behaviour, expected impact, implementation complexity, dependencies, and acceptance example for every feature. It is a planning reference, not a claim that 100 features are missing or delivered. Existing capabilities must be inspected and reused before building extensions. Impact descriptions are expected benefits; measure them with employees rather than treating them as proven savings.

## How to use this catalogue

- [Features 1-20: Navigation and daily work](#features-1-20-navigation-and-daily-work)
- [Features 21-40: Entry speed and factory coordination](#features-21-40-entry-speed-and-factory-coordination)
- [Features 41-60: Approvals and operational collaboration](#features-41-60-approvals-and-operational-collaboration)
- [Features 61-80: SOPs and dependable task execution](#features-61-80-sops-and-dependable-task-execution)
- [Features 81-100: Automatic data population and calculations](#features-81-100-automatic-data-population-and-calculations)

Standard Operating Procedure (SOP) means the approved method for performing a recurring task. Bill of Materials (BOM) means the required materials and components. Row Level Security (RLS) means database rules restricting which company and user can access records. INR amounts and production quantities in examples are illustrative.

## Complexity scale

| Rating | Meaning for a complete implementation |
| --- | --- |
| Low | A focused presentation or interaction change using reliable existing data and permissions; still requires relevant verification. |
| Medium | Several screens or queries, reusable validation, or a bounded schema extension; requires workflow and role checks. |
| High | Multiple modules, new business rules, transactional writes, concurrency, or significant schema/data work. |
| Very High | Broad workflow infrastructure, complex optimisation, financial or inventory lifecycle changes, or external equipment/provider dependencies. |

Ratings are initial engineering assessments using the existing Next.js, TypeScript, Tailwind, and Supabase stack. They include appropriate tests, security, failure handling, and documentation. They are not delivery dates. Existing foundations can reduce incremental effort; unclear business rules, poor master data, provider access, and hardware can increase it. Overlapping features share implementation work, so their complexity must not be added as 100 independent builds.

The Dependencies field identifies prerequisites and related features requiring coordinated design. Some references are mutual because features share a component; they do not define a strict one-feature-at-a-time build order.

## Shared implementation rules

- Derive company identity from the authenticated session. Enforce permissions on the server, in database policies, in files, and in exports.
- Keep core calculations and business rules in shared library/database boundaries. A browser preview and a saved transaction must use the same approved rule version.
- Preserve source references across quote, order, job, stock, dispatch, invoice, and payment. Recheck quantities and permissions when committing a transaction.
- Distinguish recorded facts, calculated values, suggested defaults, and observations. Never convert an estimate into an actual weight, payment, inspection result, or completion event.
- Recalculate drafts when their inputs change. Preserve issued document snapshots and the approved versions used by completed work.
- Represent missing information as Not captured or Requires review. A missing measurement, rate, or failed query must not silently become zero.
- Make scanning an optional accelerator where practical. Preserve search and manual selection; add compulsory checks only where an approved process requires them.
- Keep overview boards, paginated database lists, dedicated creation/editing screens, and detail pages aligned with the existing project conventions. Database lists default to ten server-paginated rows.
- Treat all schema, provider, and equipment changes described below as future implementation scope. Writing this catalogue does not apply migrations, change production records, or deploy software.

## Existing source foundations

The development checkout already contains navigation, search, mobile entry points, linked forms, and calculation helpers. Their presence establishes a reuse opportunity, not complete acceptance of the target features.

| Area | Existing source reference |
| --- | --- |
| Application navigation | [Application shell](components/layout/app-shell.tsx) |
| Global record search | [Search page](app/%28dashboard%29/search/page.tsx) |
| Factory mobile entry | [Mobile page](app/%28dashboard%29/mobile/page.tsx) |
| Quote-to-order form | [Order form](components/modules/orders/quote-order-form-client.tsx) |
| Dispatch preparation | [Dispatch form](components/modules/dispatch-form-client.tsx) |
| Quotation calculations | [Quote calculations](lib/calculations/quote.ts) |
| Billet calculations | [Foundry calculations](lib/calculations/foundry.ts) |
| Recovery calculations | [Recovery calculations](lib/calculations/pcda/recovery.ts) |
| Configurator glass calculations | [Glass engine](lib/systems-configurator/glass-engine.ts) |

## Features 1-20: Navigation and daily work

### 1. Role-specific My Work Today homepage

- [x] **Complete for local implementation and verification, 21 October 2026.** Built at `/dashboard`, audited, tested, and visually inspected at desktop, tablet, and phone widths. [Delivery record and acceptance evidence](docs/UPGRADE_EOS_FEATURE_01_2026-10-21.md).
- **Verification:** 1,703 tests passed across 76 suites on the isolated implementation checkpoint; lint, typecheck, and production build passed. Hosted RLS checks, real employee trials, and deployment remain separate acceptance steps. Personal ownership uses explicit task assignment; operational records without user assignment remain labelled team work. Feature 14's automatic handoff creation remains planned.
- **What it does:** Give each employee a homepage containing their assigned work, deadlines, blockers, and direct actions. Production sees assigned jobs, dispatch sees loads to prepare, and accounts sees collection work. Provide a separate, clearly labelled view for eligible unassigned team work.
- **Impact:** Reduces the effort of deciding where to begin and makes ownership and urgent work visible.
- **Complexity:** Medium - requires reliable role-specific queries, assignment rules, useful ordering, and links into existing workflows.
- **Dependencies:** Current dashboard, tasks, role permissions, and feature 14 for generated handoffs.
- **Acceptance:** A production user sees permitted jobs and can begin one without navigating through unrelated modules.

### 2. Task-based navigation

- [x] **Complete for local implementation and verification, 21 October 2026.** Added four role-prioritized destinations and grouped More navigation on desktop and phone, preserving role/route/company-feature permissions and aliases. Keyboard focus, scrolling, Escape, and route closure are tested. Visually inspected the desktop menu and 375px production, dispatch, and accounts menus. Final isolated verification: 1,739 tests across 76 suites, plus passing lint, typecheck, and production build. [Delivery audit and evidence](docs/UPGRADE_EOS_USABILITY_BATCH_2026-10-21.md).

- **What it does:** Order navigation around frequent employee tasks and clear groups such as Sales, Factory, Stock, and Accounts. Keep the most-used destinations visible and place occasional tools under More. Continue applying role and company feature permissions.
- **Impact:** Makes the software easier to learn and reduces menu scanning during routine work.
- **Complexity:** Low - mainly navigation configuration and responsive presentation, provided the route-permission boundary is already reliable.
- **Dependencies:** Application shell, existing routes, and role access rules.
- **Acceptance:** Each role can reach its common workflows from a short menu on desktop and mobile.

### 3. Instant Find and Act search

- [x] **Complete for local implementation and verification, 21 October 2026.** Immediate permission-aware results provide safe record identifiers and authorized contextual links. Searching an order opens dispatch preparation with that exact order selected; source readiness is checked in the form. Bounded queries, tenant scope, partial outages, slash-containing identifiers, and stale responses are tested. Visually inspected at desktop and phone widths. [Audit, screenshots, and final verification](docs/UPGRADE_EOS_WORKFLOW_UPGRADES_2026-10-21.md).

- **What it does:** Extend global search with immediate results for customers, profiles, dies, orders, dispatches, and other permitted records. Offer context-specific actions such as Open Order or Prepare Dispatch. Display enough identifying information to distinguish similarly named results.
- **Impact:** Removes the need to remember which module contains a record before acting on it.
- **Complexity:** High - broad search needs efficient indexed queries, safe result projections, action authorisation, and responsive cancellation of stale requests.
- **Dependencies:** Existing search, server permissions, searchable business identifiers, and feature 5.
- **Acceptance:** Searching an order number returns the correct permitted record and opens a preselected valid action.

### 4. Pinned shortcuts and preserved working context

- [ ] **Implemented; final interactive visual acceptance pending, 21 October 2026.** Added company/user-scoped pins, recent records, named views, URL-based list state, return scroll, safe Storage fallbacks, and permission-aware shortcuts. Automated mounted tests cover rapid filters, Back restoration, hide/show, and company/user changes. The user explicitly deferred the final order-return and scope-switch visual checks after browser control became unavailable. [Audit and remaining acceptance](docs/UPGRADE_EOS_USABILITY_BATCH_2026-10-21.md).

- **What it does:** Save personal shortcuts, recent records, and named filtered views. Preserve search text, filters, pagination, and scroll position when employees open a record and return. Scope preferences and recents to the current company and user.
- **Impact:** Eliminates repeated setup of the same working view throughout the day.
- **Complexity:** Medium - needs reusable view-state handling, preference storage, and sensible behaviour when records or permissions change.
- **Dependencies:** List pages, navigation history, and user preferences.
- **Acceptance:** Returning from an order detail restores the same filtered page without revealing another user's recent records.

### 5. Next valid action on every record

- [x] **Implemented and audited locally, 28 October 2026; hosted rollout pending.** Contextual actions on quote, order, production, dispatch and invoice details retain source identity, explain prerequisites and use existing guarded transitions. [Batch 4 scope, tests and audit](EOS_UPGRADE_BATCH_4.md).

- **What it does:** Show the appropriate next action beside the current record, such as creating an order from an accepted quote. Carry the source identity into the next form. Explain missing prerequisites and show only transitions the user is permitted to perform.
- **Impact:** Helps employees finish a process without memorising the sequence of modules.
- **Complexity:** High - action availability must match server-side workflow rules, including stale state, duplicate requests, and concurrent changes.
- **Dependencies:** Existing transaction actions, state-transition rules, and features 15 and 65.
- **Acceptance:** The action opens the correct source record and rejects an ineligible transition even if the browser state is outdated.

### 6. Connected order workspace

- [ ] **Implemented, automatically tested and checked in isolated Playwright at 1280 and 375 px, 22 October 2026; signed-in trial pending.** Order detail shows per-line ordered, dealer-stock, open-plan, produced and still-to-plan kg on the same basis as the database production guard, with links to each production job. Whole-order dispatched pieces/metres/net kg come from verified packing history, with remaining pieces and metres. Unlinked jobs are listed separately, over-commitment is flagged, and unverifiable jobs or packing are shown as unavailable rather than zero. Dealer sessions do not see it. Linked quotation, inspections, finishing, invoices and payments already have their own sections; per-line dispatch is not possible because packing records are not tied to order lines. [Delivery audit and evidence](docs/UPGRADE_EOS_PRODUCTION_PERFORMANCE_2026-10-22.md).

- **What it does:** Bring the linked quotation, jobs, material allocation, inspections, finishing, bundles, dispatches, invoices, and payments into the order detail page. Show ordered, produced, dispatched, and remaining quantities with their units and relevant source links.
- **Impact:** Gives staff a practical place to answer customer questions and investigate delays.
- **Complexity:** High - needs trustworthy lineage, consistent quantity definitions, efficient aggregation, and field-level protection of financial information.
- **Dependencies:** Cross-module source references, authorised views, and features 29, 34, and 51.
- **Acceptance:** An authorised employee can trace a partially dispatched order through its source jobs and documents with reconciled quantities.

### 7. Enter shared information once

- [x] **Implemented and audited locally, 29 October 2026; hosted rollout pending.** Dispatch entry reuses accepted order party/site details, explicitly labels current-master fallback and freezes immutable dispatch party history. Existing issued invoice history is preserved. [Batch 5 scope and tests](EOS_UPGRADE_BATCH_5.md).

- **What it does:** Populate downstream forms from selected customer, site, order, and specification records. Reuse approved details while allowing authorised transaction-specific changes. Freeze the necessary party and commercial snapshots when documents are issued.
- **Impact:** Reduces repeated typing and conflicting versions of the same business information.
- **Complexity:** High - requires clear field ownership, snapshot rules, source precedence, and correct handling of changed master records.
- **Dependencies:** Master data, linked forms, and features 81, 82, and 87.
- **Acceptance:** Changing a customer master affects a new draft as intended while an issued historical invoice retains its original party details.

### 8. Stage-specific essential fields

- [x] **Complete for the quotation workflow and local verification, 22 October 2026.** Essential preparation fields stay visible; costing/recovery, delivery/payment and terms expand on demand and preserve entered values. Incomplete costing drafts save, while shared server validation and a database trigger reject incomplete confirmation with specific guidance. Audited, tested and visually inspected on desktop and phone. Final development verification passed 2,077 tests across 76 suites, lint, typecheck and production build. [Delivery scope, migration verification and visual evidence](docs/UPGRADE_EOS_COLLABORATION_BATCH_2026-10-22.md).

- **What it does:** Show the information required for the current task stage, with occasional details available on demand. Allow legitimate incomplete drafts, then enforce the full requirements at confirmation. Hidden fields must retain or clear values according to explicit rules.
- **Impact:** Makes forms less overwhelming and avoids collecting transport or production details before they are known.
- **Complexity:** Medium - requires stage-aware validation shared between the interface and server.
- **Dependencies:** Form schemas, transaction states, and features 16 and 63.
- **Acceptance:** A preparation draft can save incomplete details, but confirmation fails with specific guidance when required information is missing.

### 9. Repeat Previous and approved templates

- [x] **Complete for the quotation acceptance example and local verification, 21 October 2026.** An authorized owner/admin can repeat prior quotation lines into a new unsaved draft, with fresh dates/current profile weights, cleared identities/approvals/die assignments, expiry warnings, and mandatory commercial review renewed after edits. The original quotation is untouched. The detail-page launch and repeat form were visually inspected on desktop and phone, and the detail page now contains table overflow locally. Transport arrangements, production templates, and approved effective-rate versioning remain future extensions. [Audit and evidence](docs/UPGRADE_EOS_WORKFLOW_UPGRADES_2026-10-21.md).

- **What it does:** Start a draft from an earlier quotation, transport arrangement, or approved production setup. Identify copied fields, clear transaction-specific identifiers, and refresh values whose validity has expired. Require review of changed prices, dates, specifications, and availability.
- **Impact:** Makes repeat business faster while keeping employees aware of differences from the earlier transaction.
- **Complexity:** Medium - copying is straightforward; deciding which fields may be retained and which need fresh validation is the main work.
- **Dependencies:** Existing records, template permissions, effective rates, and feature 25.
- **Acceptance:** Repeating a quotation retains appropriate lines while generating a new identity and flagging expired rates.

### 10. Create missing master records inside a task

- [x] **Complete for customer/quotation implementation and local verification, 21 October 2026.** A permitted Add new customer dialog checks likely duplicates, supports selecting an active match, and returns a newly created customer to the unsaved quotation without resetting its lines, commercial terms, prices, or notes. Audited and visually inspected at 1280 px, 768 px, and 375 px. Final independent verification passed 1,789 tests across 76 suites, lint, typecheck, and production build; 23 focused regressions cover authorization, tenant isolation, duplicate review, draft preservation, and retry recovery. [Delivery record, screenshots, and verification evidence](docs/UPGRADE_EOS_IN_TASK_CUSTOMER_2026-10-21.md).
- **Scope:** This delivery implements the customer/quotation acceptance example below. Transporter and other master selectors remain future extensions. Duplicate suggestions are advisory; separate simultaneous requests do not establish a global uniqueness guarantee. Visual inspection used real application components and styles with synthetic data. Authenticated hosted acceptance and deployment remain separate steps.

- **What it does:** Offer a permitted Add New action beside customer, transporter, or other master selectors. Open a short creation dialog, check likely duplicates, and return with the new record selected. Preserve every existing draft value.
- **Impact:** Prevents employees from abandoning work or entering temporary names that later fragment master data.
- **Complexity:** Medium - requires reusable dialogs, duplicate checks, permissions, and reliable form-state preservation.
- **Dependencies:** Master creation actions and feature 59.
- **Acceptance:** Creating a customer during quotation entry preserves the item lines and immediately selects the new authorised customer.

### 11. Automatic quantity and unit calculations

- [x] **Complete for quotation quantities and local verification, 22 October 2026.** Cut lengths accept m, mm, ft and in, preserve canonical metres when display units change, and derive labelled theoretical metres/weight using the shared calculations. The actual save action, SQL row and visually inspected PDF reconcile 20 ft to 6.096 m, 609.6 total metres and 487.68 kg for 100 pieces at 0.8 kg/m. Measured output remains separately recorded. Desktop/phone inspection and the final 2,077-test suite, lint, typecheck and production build passed. [Audit and export evidence](docs/UPGRADE_EOS_COLLABORATION_BATCH_2026-10-22.md).

- **What it does:** Calculate derived length, theoretical weight, quantities, balances, and compatible unit conversions from trusted inputs. Label the input basis and distinguish estimates from measured quantities. Recalculate dependent fields when source inputs change.
- **Impact:** Removes calculator work and reduces inconsistent quantities across forms and reports.
- **Complexity:** Medium - shared calculation functions need consistent precision, unit handling, missing-value behaviour, and server validation.
- **Dependencies:** Profile specifications and features 83, 89, 90, and 94.
- **Acceptance:** The same inputs produce the same results in the form, saved transaction, and exported document.

### 12. Suitable stock and die suggestions

- [x] **Implemented and audited locally, 28 October 2026; hosted rollout pending.** Quotation lines show current stock/reservations, locations, eligible dies and exclusion reasons. Existing commitment guards recheck changed availability. [Batch 4 scope, tests and audit](EOS_UPGRADE_BATCH_4.md).

- **What it does:** Present compatible dies and eligible stock after a profile and specification are selected. Show location, available quantity, reservation status, and exclusion reasons. Offer a traceable allocation suggestion and recheck availability at commitment.
- **Impact:** Speeds selection and reduces unsuitable allocations or repeated calls to inventory staff.
- **Complexity:** High - compatibility, quality holds, concurrent reservations, and source lineage must agree with authoritative allocation rules.
- **Dependencies:** Inventory ledger, die compatibility, and features 88 and 89.
- **Acceptance:** An incompatible or newly reserved batch cannot be committed even if it appeared eligible when the screen loaded.

### 13. Quick queue updates and safe bulk actions

- [x] **Implemented and automatically tested locally; database rollout and visual acceptance pending, 22 October 2026.** `/tasks/bulk` (assign, due date, priority) and `/production/bulk` (planned date, shift for planned jobs) let supervisors select up to 50 records (10/25/50 per server-side page), preview the outcome of every one, then apply. Each selected record gets an explicit outcome: changed, no change needed, not changed with the reason (closed task, dealer task, outside the teams you supervise, handoff of another team, job already on the press schedule or released/running), not available, or selected twice. Apply locks and rechecks each record against the preview's fingerprint, so anything changed in between is reported instead of overwritten; a request id makes retries return the recorded result; every apply is logged. Supervisors assign only within the teams they supervise. 20 tests. [Handover](EOS_UPGRADE_CLAUDE.md).

- **What it does:** Allow suitable updates such as assignment or planned-date changes directly from a work queue. Provide bulk selection, affected-record previews, and per-record outcomes. Retain dedicated detail flows for actions needing more context.
- **Impact:** Reduces repeated record opening when supervisors manage several similar tasks.
- **Complexity:** High - bulk operations need explicit permissions, current-state checks, bounded requests, and clear partial-failure handling.
- **Dependencies:** Server actions, paginated queues, and feature 26.
- **Acceptance:** A bulk assignment changes only eligible records and explains every rejection without silently dropping selected work.

### 14. Automatic department handoffs

- [x] **Implemented and automatically tested locally; database rollout and visual acceptance pending, 22 October 2026.** Confirmed events now create the next team's task inside the same transaction: QC release (an approved inspection, including the approved child of a rework resolution, with only the approved kilograms) hands packing to the packaging team; a finishing receipt with accepted output hands inspection to quality; completed packaging hands the packed kilograms to dispatch. Each handoff carries its source record, quantity, the order's priority and a deadline that is never in the past, and a unique key per event means retries, replays and repeated status changes create one task (finishing received then completed still makes one). `/tasks/handoffs` shows each team its queue (managers and viewers see all), team members take a handoff once, and supervisors can recheck one source record safely. 20 tests. [Handover](EOS_UPGRADE_CLAUDE.md).

- **What it does:** Create the next team's work when a confirmed event makes it eligible. Attach the source record, quantity, deadline, and responsible role. Make retries safe so one event cannot create multiple copies of the same handoff.
- **Impact:** Reduces verbal chasing and makes the next department's responsibility visible.
- **Complexity:** High - requires reliable event-to-task creation, deduplication, and transaction boundaries across operational stages.
- **Dependencies:** Workflow events, tasks, assignments, and features 64 and 69.
- **Acceptance:** Reprocessing one inspection-release event creates one packaging handoff with the correct source quantity.

### 15. Actionable alerts and blocker resolution

- [ ] **Implemented and automatically tested locally; visual acceptance deferred, 21 October 2026.** Notifications now open an exact permitted source record, identify the reviewing team, and recheck recognized invoice, stock, task, order and quotation conditions. Resolved conditions are separate from personal read receipts; failed or restricted source reads never become resolved or empty-success claims. The inbox uses ten-row server pagination. Interactive inspection remains pending at the user's direction. [Audit, verification and remaining gates](docs/UPGRADE_EOS_OPERATOR_WORKFLOWS_2026-10-21.md).

- **What it does:** Link each alert to the exact record or correctly filtered queue. Explain the blocker, affected work, responsible person, and available resolution. Remove or resolve the alert when its underlying condition is no longer true.
- **Impact:** Turns attention signals into useful actions and reduces investigation time.
- **Complexity:** Medium - alert conditions and destinations must remain consistent with business state and permissions.
- **Dependencies:** Notifications, queue filters, record links, and feature 45.
- **Acceptance:** An overdue-invoice alert opens the relevant invoice or overdue list and clears appropriately after settlement.

### 16. Automatic drafts and dependable recovery

- [x] **Implemented and audited locally, 29 October 2026; signed-in operator acceptance pending.** Dispatch drafts retain scoped identities and unfinished entries, expire after seven days, use cross-tab revision protection and reload authoritative sources on recovery. [Batch 5 evidence](EOS_UPGRADE_BATCH_5.md).

- **What it does:** Save unfinished entries with a visible saving state and a resumable draft identity. Recover after navigation, reload, or connection loss. Keep draft persistence separate from confirming stock, financial, or workflow transactions.
- **Impact:** Protects lengthy work from accidental loss and allows employees to resume interruptions confidently.
- **Complexity:** High - requires company-scoped storage, conflict handling, field-version migrations, and safe expiry of sensitive local data.
- **Dependencies:** Form state, feature 28, and a defined draft lifecycle.
- **Acceptance:** A recovered dispatch draft preserves its entries but revalidates source availability before confirmation.

### 17. Complete short mobile factory tasks

- [x] **Implemented and locally verified for physical bundle recording, 29 October 2026; physical-device trial pending.** A phone order queue opens the same guarded capture action as desktop, with large controls, numeric keyboards, tag entry and retained retry identity. [Batch 5 tests and acceptance](EOS_UPGRADE_BATCH_5.md).

- **What it does:** Extend mobile shortcuts into focused task screens with large controls, appropriate keyboards, relevant photos, and one clear primary action. Offer optional scanning alongside search. Retain the same server-side rules as desktop workflows.
- **Impact:** Makes recording real work practical near machines, packing areas, and loading points.
- **Complexity:** High - production-quality mobile flows need responsive design, device behaviour, connection handling, and physical-workflow trials.
- **Dependencies:** Existing mobile pages and features 8, 16, and 94.
- **Acceptance:** Operators can complete the selected task on a narrow phone without horizontal form overflow or a weakened validation path.

### 18. Transaction-linked documents and communication

- [x] **Implemented and audited locally for issued invoices, 29 October 2026; hosted acceptance pending.** Finance users review snapshot-backed recipients/text and the authorized PDF; copying rechecks the invoice version and always retains explicit prepared-only delivery status. [Batch 5 evidence and provider boundary](EOS_UPGRADE_BATCH_5.md).

- **What it does:** Preview, print, download, or prepare an approved message from the current transaction. Use its authoritative data and document version. Show recipients and outgoing content before sending, and record the result where a real provider integration exists.
- **Impact:** Reduces document assembly and keeps customer communication traceable to the right transaction.
- **Complexity:** High - document permissions, customer-safe fields, provider delivery results, and duplicate-send protection need careful integration.
- **Dependencies:** Existing PDFs, templates, authorised data projections, and communication providers.
- **Acceptance:** A customer-facing document excludes internal cost and a failed message is never presented as delivered.

### 19. Connections to accounting systems and equipment

- **What it does:** Replace selected repeated entry into accounting software, spreadsheets, or weighing equipment with validated import/export or a verified connection. Map fields and units, detect duplicates, and expose failed transfers and reconciliation results.
- **Impact:** Reduces double entry and disagreement between operational and accounting records.
- **Complexity:** Very High - effort depends on provider access, hardware protocols, mapping, retries, reconciliation, and ongoing external compatibility.
- **Dependencies:** Approved integration scope, credential storage, and features 58, 94, and 99.
- **Acceptance:** Reimporting the same source transaction does not duplicate it, and a failed device reading cannot become a confirmed weight.

### 20. Clear action labels and contextual guidance

- [x] **Complete for quotation/dispatch entry and local verification, 21 October 2026.** Keyboard-accessible guidance explains units, theoretical versus measured weight, recovery assumptions, selling margin, draft saving, stock posting, and uncertain confirmation. Dispatch now uses Review dispatch and Confirm dispatch and consume stock labels. Desktop columns and stacked phone guidance were visually inspected. Wider module coverage, selected translations, and employee training trials remain separate work. [Audit and evidence](docs/UPGRADE_EOS_WORKFLOW_UPGRADES_2026-10-21.md).

- **What it does:** Use explicit labels such as Record Payment or Prepare Dispatch, visible field units, and short explanations beside unfamiliar terms. Provide targeted first-use guidance and appropriate local-language help where employees need it.
- **Impact:** Reduces ambiguity, training effort, and mistakes caused by unclear controls.
- **Complexity:** Medium - complete coverage requires a terminology review, accessible interactions, translations where selected, and consistency across modules.
- **Dependencies:** Existing components, company terminology, and employee feedback.
- **Acceptance:** Employees can identify the effect of common buttons and the units of numeric inputs without asking a supervisor.

## Features 21-40: Entry speed and factory coordination

### 21. Visual profile selection

- [x] **Complete for local implementation and verification, 21 October 2026.** The quotation editor shows approved cross-section artwork beside section dimensions, weight, and revision, with an accessible enlarged view. Visually distinguished two similar synthetic approved sections in the real editor and inspected explicit unavailable states for unapproved, missing, failed, and non-image artwork. Company-owned authenticated Storage paths, MIME checks, cancellation cleanup, and preview identity resets are audited and tested. Final isolated verification: 1,739 tests across 76 suites; lint, typecheck, and production build passed. Real-company artwork availability and hosted Storage policies remain separate checks. [Delivery audit and evidence](docs/UPGRADE_EOS_USABILITY_BATCH_2026-10-21.md).

- **What it does:** Show the approved profile cross-section beside its code, dimensions, section weight, and drawing revision. Let employees enlarge the image while selecting a section. Clearly distinguish visually similar profiles and show when an approved image is unavailable.
- **Impact:** Helps staff recognise sections and reduces selection errors caused by remembering codes alone.
- **Complexity:** Medium - requires reliable image assets, storage access, usable selectors, and accurate links between drawings and profile revisions.
- **Dependencies:** Profile masters, approved drawing assets, and feature 82.
- **Acceptance:** Two similar profiles remain distinguishable by image and dimensions, and missing artwork never displays a misleading substitute.

### 22. Customer codes and shop-floor aliases

- [ ] **Implemented and automatically tested locally; database rollout and visual acceptance pending, 21 October 2026.** A customer record maintains customer-specific profile aliases with retained deactivation history. Quotation entry resolves exact aliases within the selected customer, requires an explicit canonical choice, and reloads the active company profile before applying its current specification. Tests cover ambiguity, inactive/foreign sources and stale responses. [Audit and remaining gates](docs/UPGRADE_EOS_OPERATOR_WORKFLOWS_2026-10-21.md).

- **What it does:** Map customer item codes, previous profile numbers, and familiar local names to the correct master profile. Scope aliases appropriately to a company or customer, show the canonical identity, and request clarification when an alias is ambiguous.
- **Impact:** Reduces time spent translating customer descriptions or consulting separate mapping sheets.
- **Complexity:** Medium - needs alias data, uniqueness rules, contextual search, and controlled maintenance.
- **Dependencies:** Profile/customer masters, search, and feature 59.
- **Acceptance:** A customer-specific code finds the intended profile without changing how the same text resolves for another customer.

### 23. Paste multiple lines from Excel

- **Follow-up, 21 October 2026:** Actual-editor integration now verifies mixed-profile correction, millimetre conversion, atomic append, preserved existing charges, clean imported defaults, and zero saves. The user chose to keep interactive visual checks pending. [Current recheck and open gates](docs/UPGRADE_EOS_ENTRY_ACCEPTANCE_RECHECK_2026-10-21.md).

- [ ] **Implemented and audited locally; interactive visual acceptance pending, 21 October 2026.** The quotation editor accepts up to 100 spreadsheet rows, requires declared length units, resolves exact active company profiles, and shows editable errors before importing all accepted lines into the draft. Tests cover stale lookups, malformed quoting, blank/unknown headers, ambiguous profiles, and inherited charges. Final independent verification: 1,769 tests across 76 suites; lint, typecheck, and build passed. Browser access still reports disabled, so this feature is not marked complete. [Delivery audit and remaining checks](docs/UPGRADE_EOS_ENTRY_AND_PREVIEWS_2026-10-21.md).

- **What it does:** Accept tabular clipboard input for fields such as profile code, length, quantity, and finish. Preview parsed rows, units, unmatched references, and validation errors. Let employees correct cells before explicitly importing the valid result into a draft.
- **Impact:** Speeds preparation of large quotations and orders while replacing uncontrolled copy-and-paste.
- **Complexity:** High - parsing varied spreadsheet formats, resolving references, validating totals, and preventing unintended partial writes require careful design.
- **Dependencies:** Shared line schemas, aliases, and features 11 and 82.
- **Acceptance:** A mixed-validity paste shows row-specific errors and cannot silently import wrong units or unmatched profiles.

### 24. Efficient keyboard entry

- [x] **Complete for local implementation and verification, 21 October 2026.** Added visible Ctrl+Alt+A/D/S commands for adding lines, duplicating the current draft line, and guarded draft saving. New lines receive focus; duplicates clear database identity; IME/repeated events and duplicate in-flight saves are handled. The real quotation UI was inspected while three lines were entered by keyboard and saved once through the existing server action to the synthetic local draft simulator. Selector Enter caused zero writes before explicit save. Final isolated verification: 1,739 tests across 76 suites; lint, typecheck, and production build passed. [Delivery audit and evidence](docs/UPGRADE_EOS_USABILITY_BATCH_2026-10-21.md).

- **What it does:** Provide predictable Tab order, keyboard-operable selectors, and visible shortcuts for adding lines, duplicating draft rows, and saving drafts. Scope shortcuts to the active task and avoid accidental final submission from routine navigation.
- **Impact:** Reduces mouse switching for employees entering many similar lines.
- **Complexity:** Low - interaction work is bounded, but focus, accessibility, and shortcut collisions need verification.
- **Dependencies:** Existing form controls and agreed shortcut conventions.
- **Acceptance:** An employee can enter several quotation lines by keyboard without triggering a transaction confirmation unexpectedly.

### 25. Revision comparison

- [x] **Implemented and automatically tested locally; database rollout and visual acceptance pending, 22 October 2026.** The quotation page compares any two recorded versions (revision snapshots or the current version) with units, signed deltas, added/removed/changed lines, who superseded each version and why, approval and issued status, and the linked order's accepted basis. Lines are paired by profile, cut length and finish because items are rewritten on save. Migration `20261022200000_quote_revision_comparison.sql` also closes a live leak: every company user, including other dealers, could read `quote_revisions.snapshot_json` (billet rates, margins, internal notes); direct reads are now metadata-only and comparisons use a role-projected RPC. Also fixed: hard-coded "Admin User" approver and "System" revision authors. 15 tests. [Handover](EOS_UPGRADE_CLAUDE.md).

- **What it does:** Compare two recorded versions of a quotation, specification, or schedule. Highlight changed values with units, the person and time, and affected approvals. Preserve the accepted version used by downstream work and make superseded instructions identifiable.
- **Impact:** Helps reviewers concentrate on changes and prevents production from following obsolete instructions.
- **Complexity:** High - complete comparison requires versioned snapshots, structured line identity, and rules for downstream effects.
- **Dependencies:** Revision history, feature 73, and immutable issued records.
- **Acceptance:** A quantity or finish change is visible, and an earlier issued document remains reproducible from its original version.

### 26. Preview consequential actions

- [x] **Complete for physical dispatch and local verification, 21 October 2026.** Review shows the customer/order, exact bundles, measured totals, remaining order pieces/metres, and selected-source balances before stock posting. Sources are refreshed for review and rechecked by the authoritative confirmation action; changed order/shipped quantities require another review. Cancelling preserves inputs. Desktop/phone inspection and stale-material/changed-balance/rejected-confirmation regressions passed. The preview is not a reservation; aggregate order balance does not prove each profile/finish is fulfilled. Other consequential actions remain future extensions. [Audit and evidence](docs/UPGRADE_EOS_WORKFLOW_UPGRADES_2026-10-21.md).

- **What it does:** Before important confirmation, display the affected customer, records, quantities, resulting balances, and irreversible consequences. Link directly to editable draft inputs. Recalculate and revalidate on confirmation when underlying state has changed.
- **Impact:** Gives employees a concise final opportunity to catch costly mistakes.
- **Complexity:** Medium - the preview must share business logic with the authoritative write and handle stale availability.
- **Dependencies:** Transaction actions, features 5 and 51, and current-state checks.
- **Acceptance:** A dispatch preview identifies its bundles and remaining order quantity, then rejects newly unavailable material at confirmation.

### 27. Controlled correction workflow

- **What it does:** Explain the permitted correction route for each record state. Allow ordinary draft edits; use authorised reversals, amendments, or adjustments for posted stock and financial transactions. Preserve original entries, reasons, links, and any necessary reapproval.
- **Impact:** Helps employees recover from mistakes without deleting history or asking developers to patch records.
- **Complexity:** Very High - linked financial and stock reversals require transactional integrity, dependency checks, auditability, and concurrent-write protection.
- **Dependencies:** Posted-record lifecycle rules, approval policy, and feature 73.
- **Acceptance:** A permitted correction restores consistent balances while retaining the original transaction and every linked adjustment.

### 28. Protection against conflicting edits

- [x] **Implemented and audited locally, 28 October 2026; hosted rollout pending.** Quotation saves enforce the originally opened revision and timestamp, preserve unsaved entries on conflict and require explicit reconciliation. [Batch 4 scope, tests and audit](EOS_UPGRADE_BATCH_4.md).

- **What it does:** Detect edits made after a user opened a record and show a useful comparison before saving. Preserve their unfinished entries while they reload or reconcile differences. Optional editing presence should support this protection without becoming its sole enforcement.
- **Impact:** Prevents silent overwrites and reduces repeated work between employees sharing records.
- **Complexity:** High - requires server-enforced version checks, line-level conflict policy, recovery UI, and concurrency tests.
- **Dependencies:** Versioned records, feature 16, and atomic business writes.
- **Acceptance:** Two employees editing the same version cannot silently replace one another's saved changes.

### 29. Partial completion and remaining quantities

- **What it does:** Process an eligible portion of an order while preserving the outstanding balance against its original lines. Track production, packaging, dispatch, and billing separately. Show explicit units and prevent cumulative quantities from exceeding their valid source.
- **Impact:** Matches everyday factory reality and avoids duplicate orders created to represent partial work.
- **Complexity:** Very High - cumulative quantities span multiple modules, corrections, reservations, and concurrent transactions.
- **Dependencies:** Source-line lineage, allocation/dispatch rules, and features 34, 94, and 96.
- **Acceptance:** Processing 600 kg of an eligible 1,000 kg line leaves 400 kg pending, with no duplicated consumption or invoice quantity.

### 30. Vehicle-based dispatch loading

- **What it does:** Collect eligible bundles into a vehicle load while retaining each order, customer, destination, and document relationship. Show total load weight and configured capacity information. Explain incompatibilities and support a reviewed loading plan.
- **Impact:** Gives dispatch staff one operational view for preparing a vehicle carrying several orders.
- **Complexity:** Very High - multi-order loads require compatible customer/document rules, independent source accounting, and reliable partial loading and unloading.
- **Dependencies:** Bundle lineage, transport master data, and features 29 and 94.
- **Acceptance:** Removing one order's bundle from a load updates totals and that order's availability without disturbing another order.

### 31. Visual machine and shift scheduling

- **What it does:** Display jobs against machine and shift capacity, maintenance blocks, and material readiness. Support proposed moves through drag-and-drop and ordinary accessible controls. Identify conflicts and confirm the resulting schedule before committing changes.
- **Impact:** Helps supervisors allocate work and understand the operational effect of moving a job.
- **Complexity:** Very High - needs scheduling rules, capacity assumptions, calendars, conflict detection, and separation of forecasts from committed stock actions.
- **Dependencies:** Machines, jobs, shift calendars, and features 37 and 99.
- **Acceptance:** Moving a job identifies an overlapping maintenance block and cannot create an unexplained conflicting confirmed schedule.

### 32. Physical stock and die location guidance

- [ ] **Implemented and automatically tested locally; database rollout and visual acceptance pending, 21 October 2026.** Inventory and die records show their recorded location and a permitted, reasoned location-move flow. A stale source location blocks the move, stock quantities are unchanged, and history retains the previous location, including ordinary master edits and unknown locations. Production entry retrieves current die location guidance. Physical factory reconciliation remains separate. [Audit and remaining gates](docs/UPGRADE_EOS_OPERATOR_WORKFLOWS_2026-10-21.md).

- **What it does:** Store consistent physical locations such as Shed B / Rack 04 / Level 2 and show them during picking or die retrieval. Provide a simple location layout where useful and group collection instructions by location. Update references when material moves.
- **Impact:** Reduces searching and unnecessary trips around the factory.
- **Complexity:** Medium - location masters, movement discipline, and accurate links are more important than elaborate mapping.
- **Dependencies:** Location records, stock/die masters, and authorised movement actions.
- **Acceptance:** A completed location transfer changes subsequent picking guidance while historical movements retain their original locations.

### 33. Structured exception capture

- [ ] **Implemented and automatically tested locally; database rollout and visual acceptance pending, 21 October 2026.** Production jobs offer controlled shortage, die-damage, surface-defect, breakdown and other reasons, with an optional note and a required explanation for other exceptions. Company, job, machine, recorded operator, authenticated reporter and timestamp are derived from current records. Reporting requires no invented quantity and does not change stock or job state. Photo evidence and automated hold routing are outside this delivery. [Audit and remaining gates](docs/UPGRADE_EOS_OPERATOR_WORKFLOWS_2026-10-21.md).

- **What it does:** Offer standard reasons for events such as die damage, material shortage, surface defects, or breakdown. Attach current job, machine, operator, and event time automatically. Allow an explanatory note and photo where needed.
- **Impact:** Makes incident recording faster and produces information that supervisors can compare and act on.
- **Complexity:** Medium - needs controlled reason lists, contextual capture, storage permissions, and reliable event linkage.
- **Dependencies:** Job context, approved reasons, and features 46 and 72.
- **Acceptance:** An operator records a shortage with the correct job context without retyping identifiers or being forced to invent a measurement.

### 34. Progress derived from confirmed transactions

- [x] **Implemented and audited locally, 28 October 2026; hosted rollout pending.** Order evidence derives production, verified departures, physical returns and role-permitted financial balances; missing evidence remains unavailable and quality holds remain independent. [Batch 4 scope, tests and audit](EOS_UPGRADE_BATCH_4.md).

- **What it does:** Derive quantities and relevant progress indicators from authoritative production, dispatch, payment, and correction events. Keep independent quality holds and required approvals intact. Show unavailable or inconsistent source evidence explicitly.
- **Impact:** Removes repeated bookkeeping and reduces disagreement between operational screens.
- **Complexity:** High - aggregation, transaction boundaries, source eligibility, and reversal behaviour must be consistent across modules.
- **Dependencies:** Reliable event/ledger data, source references, and features 29 and 75.
- **Acceptance:** A confirmed dispatch and its authorised reversal update all affected progress totals consistently.

### 35. Temporary task delegation

- [x] **Implemented and automatically tested locally; database rollout and visual acceptance pending, 22 October 2026.** `/tasks/delegations` lets a supervisor cover an absent employee's work for up to 90 days: all open tasks (and anything assigned to them during the period), or tasks chosen from a list. Only assignment moves; roles and permissions never change. A replacement must be eligible for each task (handoffs only to their team; ordinary work within the same team family), and supervisors may delegate only between employees in teams they supervise. Overlapping delegations and chains (a replacement who is away) are refused. When the period ends or is ended early with a reason, unfinished work returns to its owner; if the owner has left it stays with the replacement, so nothing becomes unowned. Tasks completed or reassigned meanwhile are recorded and left alone. Both employees are notified, every task's path is recorded, and activation and expiry run through an idempotent sync. 18 tests. [Handover](EOS_UPGRADE_CLAUDE.md).

- **What it does:** Let an authorised supervisor transfer selected pending tasks to another eligible employee for a defined period. Record the delegator, recipient, scope, and duration. Preserve history and ensure temporary assignment does not grant unrelated privileges.
- **Impact:** Keeps work moving during leave and shift changes without shared accounts.
- **Complexity:** High - delegation must interact correctly with task ownership, permissions, expiry, reassignment, and notifications.
- **Dependencies:** Tasks, role eligibility, and features 48 and 76.
- **Acceptance:** Delegated work reaches an eligible replacement, and expiry does not leave an unfinished task without a responsible owner.

### 36. Upload once and link attachments

- [x] **Implemented and audited locally, 28 October 2026; hosted rollout pending.** Quotes and orders reuse approved file revisions with purpose, source lineage and a fresh permission/version check before signing each open. [Batch 4 scope, tests and audit](EOS_UPGRADE_BATCH_4.md).

- **What it does:** Store one approved file and link it to relevant quotations, orders, jobs, inspections, or complaints. Show its revision and purpose. Evaluate permission for every access path; linking a file must not broaden its permitted audience.
- **Impact:** Reduces duplicate uploads and confusion about which drawing or evidence file is current.
- **Complexity:** High - storage policies, shared references, revisions, archival, and customer-safe access must agree.
- **Dependencies:** Company-scoped storage and document/version metadata.
- **Acceptance:** One drawing can support several authorised records while a user denied its contents cannot access it through another link.

### 37. Capacity-informed delivery proposals

- **What it does:** Suggest a delivery or dispatch date using eligible stock, existing commitments, production capacity, and configured finishing lead times. Display assumptions and missing inputs. Keep a proposed date distinct from an approved customer commitment.
- **Impact:** Gives sales a reasoned starting point for delivery discussions and reduces repeated checks with the factory.
- **Complexity:** Very High - depends on trustworthy capacity, calendars, sequencing, material readiness, and lead-time models.
- **Dependencies:** Features 31, 38, and 88, plus current operational data.
- **Acceptance:** A proposal explains the capacity constraint behind its date and flags missing readiness data rather than claiming certainty.

### 38. Delivery dates and priorities by order line

- [x] **Implemented and automatically tested locally; database rollout and visual acceptance pending, 22 October 2026.** The order page lists each line's effective required date and priority (its own, or the order's when unset), its produced, open-planned, packed and from-stock kilograms, and a due state. Authorised commercial and planning roles change a line with a recorded reason; every change keeps the previous and new value, is idempotent by request, rejects stale versions, past dates, dates outside the order window, closed/cancelled orders and fully supplied lines, and never changes the order's own stage, date or priority. Production and dispatch overviews show open lines still to produce or pack, overdue first, then priority and date (10 per page, filters). Schedules sit beside the guarded order lines rather than rewriting them. 25 tests. [Handover](EOS_UPGRADE_CLAUDE.md).

- **What it does:** Record separate delivery requirements for individual order lines or agreed line schedules. Carry these requirements into production and dispatch queues while preserving the parent order and customer commitment history.
- **Impact:** Supports urgent subsets of a larger order without creating artificial duplicate orders.
- **Complexity:** High - line schedules affect planning, partial fulfilment, revised commitments, and status aggregation.
- **Dependencies:** Source-line identity and features 29, 31, and 47.
- **Acceptance:** One urgent line can be planned and dispatched independently while later lines retain their original pending requirements.

### 39. Generated shift-handover summaries

- [x] **Implemented and automatically tested locally; database rollout and visual acceptance pending, 22 October 2026.** `/production/handover` lists handovers (10 per page, status filter); `/production/handover/new` offers the latest Day (08:00–20:00) and Night (20:00–08:00) IST shifts or any window up to 24 hours, previews the server-built summary (each job once: completed in the window, else its current held/running/ready state with outstanding kg and recorded hold reason; breakdowns clipped to the window, a resolved breakdown without an end adds no time; exceptions; open inspections; current stock QC holds; pending and overdue loads), then stores it unchanged with the supervisor's note. A different supervisor acknowledges once; overlapping windows are refused; retries are idempotent; a WhatsApp text copy is provided. Quality and dispatch managers can read handovers; sales and dealers cannot. 31 tests. [Handover](EOS_UPGRADE_CLAUDE.md).

- **What it does:** Assemble completed jobs, running work, downtime, shortages, quality holds, and pending loads from recorded activity. Let the outgoing supervisor review and add missing context. Present unresolved work clearly to the incoming shift.
- **Impact:** Reduces manual report preparation and helps the next shift begin with the right context.
- **Complexity:** High - accurate time boundaries, incomplete events, ownership transfer, and acknowledgement need explicit rules.
- **Dependencies:** Operational events, features 33 and 34, and shift calendars.
- **Acceptance:** A job crossing shifts appears once with its current state, outstanding quantities, and unresolved exceptions.

### 40. Fast everyday screens

- [x] **Implemented and audited for dispatch readiness locally, 29 October 2026; hosted task timing pending.** Indexed QC/packaging/material aggregation preserves source quantities and final confirmation checks. Five repeated synthetic computation measurements and large-data parity tests passed. [Batch 5 measurements and limits](EOS_UPGRADE_BATCH_5.md).

- **What it does:** Measure and improve frequently used pages, selectors, and confirmation paths. Fetch only needed data, keep list operations server-paginated, defer heavy reports, and show useful progress feedback. Preserve accurate confirmation semantics while improving responsiveness.
- **Impact:** Reduces repeated waiting across the employee's working day.
- **Complexity:** High - meaningful improvements require profiling real bottlenecks, query/index work, and regression checks across data sizes and devices.
- **Dependencies:** Baseline timings, query visibility, existing list conventions, and representative datasets.
- **Acceptance:** Repeated measurements show improvement in selected employee tasks without stale balances or success messages before confirmation.

## Features 41-60: Approvals and operational collaboration

### 41. Quick record previews beside lists

- **Follow-up, 21 October 2026:** Long preview identifiers/subtitles now wrap in full. Actual database integration verifies page-two filters, unchanged URL, no additional page query, safe displayed fields, return context, and trigger focus after Escape. Interactive visual inspection remains pending at the user's request. [Current recheck](docs/UPGRADE_EOS_ENTRY_ACCEPTANCE_RECHECK_2026-10-21.md).

- [ ] **Implemented and audited locally; interactive visual acceptance pending, 21 October 2026.** Added read-only previews from operations database rows, with curated fields, no additional query, scope guards, focus restoration, Escape, scroll locking, and a full-record link preserving list context. Mounted tests verify focus, private-field omission, unchanged URL, and current query/session behaviour. Final independent verification: 1,769 tests across 76 suites; lint, typecheck, and build passed. Desktop/mobile visual inspection remains open because browser access reports disabled. [Delivery audit and remaining checks](docs/UPGRADE_EOS_ENTRY_AND_PREVIEWS_2026-10-21.md).

- **What it does:** Open a compact, read-focused side panel from a queue with identifying details, quantities, contact information, and pending work. Keep the queue and current filters visible. Provide a direct route to the full detail screen when the task needs more context.
- **Impact:** Makes small lookups faster and preserves the employee's place in a list.
- **Complexity:** Medium - needs a reusable accessible panel, bounded queries, focus restoration, and role-safe field selection.
- **Dependencies:** Existing detail queries and features 4 and 6.
- **Acceptance:** Closing a preview returns focus to the same row and leaves filters and pagination unchanged.

### 42. Role-specific table columns

- [ ] **Implemented; final interactive visual acceptance pending, 21 October 2026.** Added role-permitted defaults, persistent show/hide/reorder/resize controls, and sticky identifiers. Automated tests cover hiding then showing a column, preference scope, and restricted field omission through the candidate RPC projection migration. Final visual persistence, role-layout, and horizontal-scroll checks were deferred by the user. Migration `20261021290100_operation_page_null_projection.sql` is tested locally and remains unapplied to hosted Supabase. [Audit and remaining acceptance](docs/UPGRADE_EOS_USABILITY_BATCH_2026-10-21.md).

- **What it does:** Supply useful column defaults for dispatch, accounts, production, and other roles. Let employees show, hide, reorder, or resize permitted columns and preserve those preferences. Keep identifiers visible during horizontal scrolling.
- **Impact:** Reduces visual clutter while retaining the information each department needs.
- **Complexity:** Medium - requires shared table preferences, responsive behaviour, and protection against exposing unauthorised financial columns.
- **Dependencies:** Paginated table components, user preferences, and role-safe server projections.
- **Acceptance:** Accounts and dispatch receive different useful layouts, and a hidden restricted field is absent from unauthorised responses.

### 43. Project and site grouping

- [x] **Implemented and automatically tested locally; database rollout and visual acceptance pending, 22 October 2026.** `/customers/projects` lists customer projects with a literal search over code, name, site, city and customer (10 per page, status filter); a project records its delivery site, contact (Indian mobile, 6-digit PIN) and status. Quotations, orders and dispatches are grouped only by explicit links that the database accepts when the record is in the same company and belongs to the same customer; each record belongs to at most one project, and linking an order can also link its source quotation and dispatches with a per-record outcome (skipped, never moved, when another project or customer owns it). Project totals have stated definitions (non-cancelled orders; dispatches that left and were not returned), values are shown only to commercial roles, unlinks need a reason and are recorded. 25 tests. [Handover](EOS_UPGRADE_CLAUDE.md).

- **What it does:** Group related quotations, orders, deliveries, and instructions under a customer project or delivery site. Keep individual transaction identities and show project-level progress with clear quantity/value definitions. Prevent grouping from mixing unrelated customers or companies.
- **Impact:** Helps staff answer project-level questions without assembling several order numbers manually.
- **Complexity:** High - may require project/site relationships, scoped selectors, aggregation, and decisions about historical record association.
- **Dependencies:** Customer/site masters, source references, and features 6 and 38.
- **Acceptance:** Searching a project shows its linked permitted transactions and excludes unrelated work with a similar site name.

### 44. Dedicated approval inbox

- [x] **Implemented and automatically tested locally; database rollout and visual acceptance pending, 22 October 2026.** `/tasks/approvals` lists, oldest first, the requests the employee may decide: quotations in internal review (low-margin ones only for owners and admins, matching the existing quote guard; others also for sales managers) and expenses pending approval (accounts up to the existing Rs 25,000 limit, owners and admins above it), with customer or vendor, amount, estimated profit, requester and any earlier questions. Approve, Reject (reason required) and Request Clarification (keeps the request pending, records the question and notifies the requester) are applied through each record's own workflow and database guards (quote status transitions and costing completeness; `transition_expense_approval`). Each decision names the version it covers: an edited request is refused as superseded, a decided version can never be approved or rejected again, retries are idempotent, and people cannot decide their own requests unless they are the owner. Decision history is paged. 22 tests. [Handover](EOS_UPGRADE_CLAUDE.md).

- **What it does:** Collect permitted approval requests in one queue with the requested decision, business context, requester, and relevant evidence. Support Approve, Reject, and Request Clarification, while showing which records or versions the decision covers.
- **Impact:** Reduces approval chasing and makes supervisors' pending decisions easier to manage.
- **Complexity:** High - requires a shared request model, approval eligibility, stale-request detection, and audited server-side decisions.
- **Dependencies:** Approval policy, features 25, 45, and 70.
- **Acceptance:** A supervisor can decide an eligible request once; a superseded or already-decided request cannot be approved again.

### 45. Approval requests at the point of restriction

- [x] **Implemented and automatically tested locally; database rollout and visual acceptance pending, 22 October 2026.** Owners and admins choose, at `/tasks/approvals/exceptions`, which restrictions may be lifted by exception, who approves them and for how long. (1) Releasing a low-margin quotation, which today only owners and admins may do: with the policy on, sales and sales managers see the restriction explained on the quotation and can request an exception. A quotation priced below cost, or short of its required margin by more than the policy allows, is never released this way. (2) A new, opt-in dispatch hold for customers whose overdue balance reaches the set amount. The order page explains the hold, and dispatch staff request an exception for a stated weight; above the policy's hard limit only collecting payment lifts it. Each request is bound to a fingerprint of the record's content (quotation lines and totals; order and customer, plus the weight) and appears in the approval inbox to the policy's approvers. Another person decides against the version they saw; a request whose record moved on, or whose overdue amount grew, is closed as superseded and the requester is asked to request again. The requester is notified with a link back to the paused work. The guards accept an approved, unexpired exception only for that exact record and content. A dispatch exception covers one dispatch on that order up to the approved weight and is used up by it. Changed quantities, other records, more overdue exposure, an expired approval, a disabled policy and non-overridable limits are all refused, through every path including dispatches created already dispatched. Without a policy, behaviour is exactly as before. 18 tests. [Handover](EOS_UPGRADE_CLAUDE_2.md).

- **What it does:** Beside an explainable restriction, allow an eligible employee to request the specific exception permitted by company policy. Attach the source and reason, route it to the appropriate approver, and preserve a route back to the paused work.
- **Impact:** Replaces informal permission chasing with a visible, contextual request.
- **Complexity:** High - approvals need limited scope, expiry/version binding, and enforcement that cannot be bypassed by another browser path.
- **Dependencies:** Feature 44, defined exception policy, and authoritative transaction guards.
- **Acceptance:** Approval for one allowed exception does not authorise unrelated records, changed quantities, or non-overridable integrity violations.

### 46. Internal discussions attached to records

- [x] **Complete for orders, production jobs, dispatches and quality inspections, 22 October 2026.** Retained messages, replies, supporting references and up to three eligible colleague mentions open the exact internal thread. Record/company/role checks, immutable corrections through replies and exact-request retry protection are enforced on the server. Existing document workflows handle files. Desktop/phone discussion and mention flows were visually inspected; internal discussion is absent from the inspected customer quotation PDF. Both batch migrations are applied and verified hosted. Final verification: 2,077 tests, lint, typecheck and production build passed. [Delivery and security evidence](docs/UPGRADE_EOS_COLLABORATION_BATCH_2026-10-22.md).

- **What it does:** Keep short internal threads, permitted mentions, supporting references, and decisions beside the order, job, dispatch, or complaint they concern. Distinguish discussion from formal approval and retain appropriate edit/history rules.
- **Impact:** Reduces lost context in separate chats and makes previous decisions easier to find.
- **Complexity:** Medium - needs comment storage, access checks, mention eligibility, notification links, and attachment handling.
- **Dependencies:** Record permissions, features 36 and 48.
- **Acceptance:** A mentioned authorised colleague opens the relevant thread while internal comments remain absent from customer-facing documents.

### 47. Customer commitment tracking

- [ ] **Implemented and automatically tested locally; database rollout and visual acceptance pending, 21 October 2026.** Employees record their own customer promises, find them in a paginated personal/company follow-up queue, and open the exact promise from later queue pages. Rescheduling preserves the original date and records a reason; closure requires an outcome and retains history. Stale changes and ambiguous retries are guarded. Existing promises survive customer inactivation; new promises require an active customer. [Audit and remaining gates](docs/UPGRADE_EOS_OPERATOR_WORKFLOWS_2026-10-21.md).

- **What it does:** Record a promised action, responsible employee, date, and relevant customer or transaction. Surface commitments such as sending a sample or revised quote until completed or explicitly rescheduled. Preserve outcome and revised-date history.
- **Impact:** Reduces missed follow-ups that are otherwise kept in personal notes.
- **Complexity:** Medium - extends task/CRM data with commitment semantics, reminders, and clear closure outcomes.
- **Dependencies:** Customers, tasks, calendars, and feature 48.
- **Acceptance:** A rescheduled customer promise retains its original deadline and reason while presenting the current agreed action.

### 48. Controlled subscriptions and grouped notifications

- [x] **Implemented and automatically tested locally; database rollout and visual acceptance pending, 22 October 2026.** Employees can follow an order, production job, dispatch, inspection, quotation or invoice from its page, but only where their role may open that page, and only in their own company. They choose categories: status, production, quality, dispatch, payment. Triggers on the source tables record changes to followed records only: a dispatch or invoice also updates its order, and an inspection updates its job and order. Delivery groups each person's pending changes into one summary with one line per record ("Order SO-0042 · 3 updates · latest: Stage cutting → aging"). Each change is delivered to a person at most once, their own changes are never sent back to them, and access is rechecked at delivery. `/notifications/following` sets immediate (grouped), hourly or daily summaries, quiet hours in IST (which may wrap midnight) and muted categories. It lists followed records and recent summaries, each with a Copy for WhatsApp button. Requests for action are kept separate (`/notifications/requests`). An employee asks a colleague who can act (for example a sales manager to approve a quotation, or accounts to record a payment) from the record page. The request is resolved against current records (quotation left review, invoice has no balance, inspection no longer pending, material dispatched), or marked done or withdrawn. Reminders respect the recipient's quiet hours, are sent once per number, stop at 10, and stop as soon as the request is resolved. A recipient who leaves closes the request and tells the requester. `private.run_notification_delivery_for_all()` is the scheduler entry point. External email or WhatsApp delivery is not included (no provider). 20 tests. [Handover](EOS_UPGRADE_CLAUDE_2.md).

- **What it does:** Let employees follow permitted records, choose useful notification categories, and receive grouped summaries for routine changes. Separate requests for action from information. Respect selected channels and quiet periods, with deduplication and resolution-aware reminders.
- **Impact:** Helps employees notice relevant work while reducing repeated interruptions.
- **Complexity:** High - reliable batching, delivery preferences, provider results, retries, and event deduplication require shared infrastructure.
- **Dependencies:** Notification events, tasks, provider access where applicable, and feature 15.
- **Acceptance:** Repeated updates to one record form an appropriate summary, and a resolved request stops generating pending-action reminders.

### 49. Time waiting in each stage

- [x] **Complete for order current-stage timing and local verification, 21 October 2026.** The order database can show recorded stage entry, elapsed calendar time, and the dispatch due date separately. Reopening uses the latest interval while preserving history; duplicate events do not restart it, and ambiguous/missing/truncated history remains unavailable. On-demand bounded reads, role/tenant scope, timing edge cases, and desktop/phone presentation are verified. Active/waiting/held splits and working-hours calendars require additional recorded metadata. Final independent verification for this five-feature batch: 1,822 tests across 76 suites, 77 focused regressions, lint, typecheck, and production build passed. [Audit, screenshots, and boundaries](docs/UPGRADE_EOS_WORKFLOW_UPGRADES_2026-10-21.md).

- **What it does:** Calculate stage-entry times and show how long work has waited, alongside its business due date. Separate active, waiting, and held periods where recorded. Define how reopening and missing historical timestamps affect the display.
- **Impact:** Helps supervisors distinguish new work from persistent bottlenecks.
- **Complexity:** Medium - trustworthy stage history and consistent business-time rules are essential.
- **Dependencies:** Stage-change events, feature 71, and business calendars where targets use working time.
- **Acceptance:** A reopened task starts the correct current-stage interval without erasing its earlier waiting history.

### 50. Data freshness and source visibility

- **Follow-up, 21 October 2026:** Long source references now wrap. Actual database integration verifies that refresh preserves old physical observations and source dates, failed refresh does not advance the successful-fetch timestamp, and recovery works. Interactive visual inspection remains pending at the user's request. [Current recheck](docs/UPGRADE_EOS_ENTRY_ACCEPTANCE_RECHECK_2026-10-21.md).

- [ ] **Implemented and audited locally; interactive visual acceptance pending, 21 October 2026.** Database pages distinguish successful page-fetch time from source row dates and available observation/verification metadata. Refresh repeats the paginated RPC and cannot make an old physical observation appear newly verified; missing metadata remains unavailable. Tests cover failed refreshes, invalid/future dates, stale evidence, and query/session scope. Final independent verification: 1,769 tests across 76 suites; lint, typecheck, and build passed. Visual acceptance remains open while browser access reports disabled. [Delivery audit and remaining checks](docs/UPGRADE_EOS_ENTRY_AND_PREVIEWS_2026-10-21.md).

- **What it does:** Show when important operational information was recorded, refreshed, or verified and identify its source. Distinguish a recent screen refresh from a recent physical observation. Flag stale or unavailable imports and calculations.
- **Impact:** Helps employees judge whether a figure is suitable for a new promise or decision.
- **Complexity:** Medium - sources need meaningful timestamps, provenance, and honest stale-data handling.
- **Dependencies:** Source metadata, integration status, and feature 51.
- **Acceptance:** Refreshing an old imported stock figure does not falsely label the underlying observation as newly verified.

### 51. Explainable balances

- [x] **Stock half implemented and automatically tested locally; database rollout and visual acceptance pending, 22 October 2026.** (The invoice half already exists in `lib/financials/receivables.ts`.) `/inventory/stock-balances` lists finished-stock batches with on hand, open reserved and available (filters: in stock, reservable, held, over-reserved; literal search; 10 per page). A batch page expands availability as on hand − open reservations − excluded + shortfall in kg, pieces and metres, using the reservation ledger's basis (initial reserved minus dispatched, so dispatched stock is never counted twice), the QC rule the database enforces, and a shortfall line instead of negative stock; it lists every open reservation and the signed withdrawals behind on hand (dispatches, dealer debits, cancellation credits), and the app refuses to show an explanation that does not reconcile. Dealers see only their own batches without other parties' customer names; commercial rates are never returned. Audit fix: the systems configurator counted QC-held stock as available and then failed at reservation; it now applies the same QC rule. 17 tests. [Handover](EOS_UPGRADE_CLAUDE.md).

- **What it does:** Expand an invoice or stock balance into the source transactions, allocations, adjustments, reservations, and relevant exclusions behind it. Use the same calculation as the displayed total and preserve clear units and signed movements.
- **Impact:** Lets employees investigate differences without asking another department to reconstruct the calculation.
- **Complexity:** High - complete explanations depend on reconciled ledgers, reversals, access-safe financial details, and consistent definitions.
- **Dependencies:** Authoritative ledger data and features 34, 75, and 97.
- **Acceptance:** The explanation reconciles exactly to the displayed balance and includes linked adjustments without double counting.

### 52. Customer and dealer self-service

- **What it does:** Where enabled, let authorised external users view safe progress, download permitted documents, confirm delivery details, and submit defined requests. Route submitted responses into internal review where required and identify the exact version accepted.
- **Impact:** Reduces routine status enquiries and repeated staff entry of customer responses.
- **Complexity:** Very High - external identity, record-level isolation, safe projections, storage access, and response authenticity need end-to-end verification.
- **Dependencies:** Existing portal boundaries, feature 18, and approved external actions.
- **Acceptance:** An external user cannot obtain another customer's record or internal costs through pages, APIs, files, or guessed identifiers.

### 53. Fixed workstation mode

- [x] **Implemented and audited locally for press workstations, 29 October 2026; shared-device acceptance pending.** Company press context survives operator switching; server leases bind ten-minute queues to the active operator and expire safely. Lock/switch clears work/drafts and signs out. [Batch 5 scope and tests](EOS_UPGRADE_BATCH_5.md).

- **What it does:** Provide a focused screen for a selected press, packing point, or other workstation. Retain station context while securely identifying the current operator. Show relevant queued work and support account switching and appropriate session expiry.
- **Impact:** Reduces repeated location/machine selection on shared factory terminals.
- **Complexity:** High - shared-device identity, session handling, station permissions, and physical usability need deliberate design.
- **Dependencies:** Machines/locations, authentication, features 17 and 76.
- **Acceptance:** Switching operators changes permitted actions and attribution without exposing the previous user's drafts or privileges.

### 54. Approved inspection plans in quality entry

- [x] **Implemented and automatically tested locally; database rollout and visual acceptance pending, 22 October 2026.** `/quality/plans` holds versioned inspection plans per profile (or a company default): characteristics with unit (mm, kg/m, Webster hardness, coating micron, percent, visual), method, nominal and limits, plus the sampling instruction. A draft is approved by a different quality employee (or an owner/admin), which supersedes the previous version; approved versions are immutable. The inspection page loads the applicable plan (the profile's own, else the default). The inspector records each observation explicitly: nothing is pre-filled and unrecorded items stay "missing". The database judges each result against inclusive limits and refuses to approve an inspection (through any path, including a direct insert) while a result is missing or out of limits; failing material must be put to rework or rejected. Results recorded under a superseded version do not count. Inspections without an applicable plan, and the approved children of a rework resolution, are unaffected. Audit adjustment: plan approval was opened to `quality` users with a four-eyes rule, because `quality_manager` is not an app role. 19 tests. [Handover](EOS_UPGRADE_CLAUDE.md).

- **What it does:** Load the applicable approved tests, measurement units, acceptance limits, and sampling instructions from the selected job/specification. Capture actual observations and highlight deviations. Retain missing results explicitly and require the appropriate disposition decision.
- **Impact:** Reduces repeated specification lookup and makes quality records more consistent.
- **Complexity:** High - requires versioned inspection plans, applicability rules, result validation, and controlled release/hold behaviour.
- **Dependencies:** Specification versions, quality permissions, and features 67, 68, and 77.
- **Acceptance:** An incomplete or failing inspection cannot become approved merely because default values were populated.

### 55. Comparable supplier offers

- [x] **Implemented and audited locally, 28 October 2026; hosted rollout pending.** Supplier comparison pages retain requirements/offers, normalize compatible units, expose freight and unmatched conditions, and record a reasoned recommendation with source references. [Batch 4 scope, tests and audit](EOS_UPGRADE_BATCH_4.md).

- **What it does:** Compare offers for the same purchase using a consistent basis for specification, units, quantity, rate, freight, delivery, and payment terms. Keep exclusions and unmatched conditions visible instead of implying that dissimilar offers are equivalent.
- **Impact:** Reduces spreadsheet rebuilding and helps purchasing staff explain a supplier choice.
- **Complexity:** High - normalising price bases and commercial conditions needs explicit rules and source-document linkage.
- **Dependencies:** Vendors, purchase requirements, currencies/units, and feature 98 where extraction is used.
- **Acceptance:** An offer excluding freight is visibly different from an inclusive offer until a valid comparison basis is supplied.

### 56. Connected returns and rework

- **What it does:** Start a return or complaint from its original order line, dispatch, and affected material. Track actual return receipt, inspection, authorised disposition, rework/replacement, and any separate financial adjustment. Preserve the complete source trail.
- **Impact:** Reduces repeated history collection and gives teams a common view of exception resolution.
- **Complexity:** Very High - reverse stock movements, partial quantities, rework lineage, financial adjustments, and double-credit prevention cross several modules.
- **Dependencies:** Features 27 and 29, complaints/NCR records, and stock/finance rules.
- **Acceptance:** A partial return cannot restore more stock or issue more credit than the authorised eligible source permits.

### 57. Customer requirements at the relevant work step

- [x] **Implemented and verified locally, 28 October 2026.** Existing customer compliance requirements now carry work stages and revisions. Relevant order, production, quality, packing and dispatch pages show them. Stage-authorized employees acknowledge the exact revision for an order; mandatory requirements gate real source transitions, including a dispatch inserted already dispatched. Changes invalidate prior acknowledgements without rewriting their snapshots. [Batch 3 delivery and verification](EOS_UPGRADE_BATCH_3.md). Hosted rollout and signed-in acceptance remain separate.

- **What it does:** Present approved customer requirements when the employee can act on them: packing rules during packaging, label rules during printing, and certificate requirements during dispatch preparation. Record their applicable version and any authorised deviation.
- **Impact:** Reduces reliance on memory, notebooks, and last-minute customer-specific rework.
- **Complexity:** High - requirement precedence across customer, project, order, and line needs clear rules and version control.
- **Dependencies:** Customer/site requirements, features 36, 43, and 77.
- **Acceptance:** An order-specific packing instruction takes the approved precedence and remains visible at packaging and final review.

### 58. Purchase order, receipt, and invoice matching

- **What it does:** Bring ordered, physically received, accepted, and billed quantities/values into one comparison. Highlight rate, quantity, freight, tax, and reference differences according to approved tolerance rules. Route unresolved exceptions to the responsible role.
- **Impact:** Reduces manual document comparison and helps prevent paying for unexplained discrepancies.
- **Complexity:** Very High - partial receipts, returns, multiple invoices, tolerances, units, and posting controls require a coherent purchasing lifecycle.
- **Dependencies:** Features 95 and 98, purchase line identity, and finance authorisation.
- **Acceptance:** Several partial receipts and invoices reconcile without treating a short receipt or duplicate supplier invoice as fully matched.

### 59. Controlled master-data cleanup

- **What it does:** Identify likely duplicate customers, vendors, profiles, aliases, or inconsistent units and present a review queue. Let an authorised person compare records and establish the correct canonical identity. Preserve historical snapshots and references through audited consolidation.
- **Impact:** Improves selector reliability and reduces fragmented customer, stock, and supplier histories.
- **Complexity:** Very High - merging live references safely requires dependency analysis, ambiguity handling, transactions, and reversible recovery planning.
- **Dependencies:** Master-data ownership, referential integrity, and feature 22.
- **Acceptance:** A reviewed consolidation retains issued-document identities and cannot merge records across companies or incompatible specifications.

### 60. Safe employee practice environment

- **What it does:** Provide clearly labelled sample transactions for learning quotations, inspections, dispatch preparation, and other selected tasks. Keep practice stock, finance, files, identities, and outgoing communications isolated from real operations.
- **Impact:** Lets employees gain confidence through hands-on work without affecting business records.
- **Complexity:** Very High - credible isolation requires separate data and credentials, seeded scenarios, safe resets, and disabled or isolated external side effects.
- **Dependencies:** Representative fixtures, environment boundaries, and feature 76.
- **Acceptance:** Completing or resetting a practice task cannot alter live stock, send a real customer message, or change a real invoice.

## Features 61-80: SOPs and dependable task execution

### 61. Standard blueprint for every task

- [x] **Implemented and verified locally, 28 October 2026.** Task kinds share the purpose, trigger, inputs, responsibility, prerequisites, versioned instructions, completion evidence and exception structure. Start prerequisites are enforced by task triggers; revisions and routed exceptions retain history. [Batch 3 delivery and verification](EOS_UPGRADE_BATCH_3.md).

- **What it does:** Define a reusable task format covering purpose, trigger, inputs, responsible role, prerequisites, steps, completion evidence, and exception route. Apply it to approved operational task types while keeping instructions linked to the actual business records and actions.
- **Impact:** Gives employees one consistent way to understand and complete different kinds of work.
- **Complexity:** High - a useful blueprint needs a structured schema, applicability rules, permissions, and integration with existing tasks rather than isolated documents.
- **Dependencies:** Existing task model, process definitions, and features 63, 65, and 67.
- **Acceptance:** Two different task types expose the same understandable structure while enforcing their own approved business requirements.

### 62. Accountable SOP process owners

- [x] **Complete for procedure ownership and local verification, 22 October 2026.** Added a ten-row procedure directory, owner/backup availability, clarification responsibility, review dates, reasoned reassignment with revision checks, and retained ownership/review history. Procedure responsibility stays separate from task assignment. Creation, ownership changes and prior-owner history were visually inspected on desktop and phone. Hosted schema/RLS/permissions are verified; final 2,077-test suite, lint, typecheck and production build passed. Full SOP publication governance remains feature 77. [Delivery audit and screenshots](docs/UPGRADE_EOS_COLLABORATION_BATCH_2026-10-22.md).

- **What it does:** Assign an owner and appropriate backup to each procedure. Record who resolves unclear cases, approves revisions, and reviews effectiveness. Distinguish ownership of the operating method from assignment of a particular employee's task.
- **Impact:** Makes responsibility for maintaining the working system clear and reduces unresolved procedural questions.
- **Complexity:** Medium - requires ownership metadata, review workflows, reassignment, and visibility when an owner becomes unavailable.
- **Dependencies:** User/role records, features 35 and 77, and agreed governance.
- **Acceptance:** Employees can identify the current authorised process owner even after a personnel change, with prior ownership retained.

### 63. Ready-to-start conditions

- [x] **Implemented and automatically tested locally; database rollout and visual acceptance pending, 22 October 2026.** Production job detail lists every unmet release/start/resume prerequisite together with a link to its resolution, computed by the database with the same rules its start guards enforce (order stage, die eligibility and exclusivity, press eligibility, released slot, issued billets). Parity tests run the real guard functions extracted from their latest migrations. Newly enforced at start: an ineligible linked billet. Also fixed: the floor "Mark Ready" button always failed (planned to ready is not a legal transition); it now links to the press schedule. [Handover](EOS_UPGRADE_CLAUDE.md).

- **What it does:** Evaluate whether a task has its approved specification, eligible resources, source records, and other required inputs before releasing it. Present all missing prerequisites together and link to their resolution. Recheck critical conditions when work is committed.
- **Impact:** Reduces time lost starting tasks that cannot be completed correctly.
- **Complexity:** High - readiness depends on changing cross-module facts and must agree with authoritative business guards.
- **Dependencies:** Task blueprints, allocation/quality status, and features 12 and 15.
- **Acceptance:** A production task with missing required input remains explainably blocked, and stale readiness cannot bypass a later hold.

### 64. Tasks created and assigned from defined triggers

- [x] **Implemented and automatically tested locally; database rollout and visual acceptance pending, 22 October 2026.** `/tasks/triggers` lets owners, admins and factory managers define rules for five confirmed events. An order more than N days past its expected dispatch date, a breakdown open more than N hours, a sent quotation within N days of expiry, and an invoice balance N days past due are picked up by a run. A rejected quality inspection raises its work in the same transaction. Each rule names the receiver: a role (the least-loaded active employee of that role) or a named employee with an optional fallback role, limited to the roles that can do that kind of work. It also sets a due policy in calendar or working days (Monday to Saturday) and a priority. Every task carries a unique key per rule, source record and occurrence (a rescheduled order that slips again is a new occurrence). Retried, replayed, concurrent and scheduled runs therefore create at most one task. A run is recorded by its request id, so retrying a request whose response was lost returns the original result without evaluating again. The page retries automatically with the same id. A task's source reference and event time cannot be changed. Work that cannot be assigned is still created, flagged with the reason, notified to the responsible manager role, and listed under Unassigned work, where a supervisor assigns it within their team or retries the rule. Raised work shows whether its source condition still holds. Supervisors see and run only their own events. `private.run_task_triggers_for_all()` is the scheduler entry point. 21 tests. [Handover](EOS_UPGRADE_CLAUDE_2.md).

- **What it does:** Specify the confirmed event or schedule that creates each recurring task, its source reference, default assignee rule, and due-date policy. Ensure replayed events produce one intended task and recover visibly from failed assignment.
- **Impact:** Removes manual task creation and makes routine follow-on work less dependent on memory.
- **Complexity:** High - event delivery, transaction boundaries, deduplication, retries, and unassigned-work recovery need shared controls.
- **Dependencies:** Features 14 and 61, task assignments, and business calendars.
- **Acceptance:** Retrying an event after a connection failure does not create duplicate assigned work or lose the original event reference.

### 65. Guided SOP execution

- [x] **Implemented and verified locally, 28 October 2026.** A second person releases the execution rules for a published instruction version. Employees follow ordered steps with durable observations; source task completion is guarded even outside the guided screen. Reopening creates a new attempt and retains the completed attempt. [Batch 3 delivery and verification](EOS_UPGRADE_BATCH_3.md).

- **What it does:** Present the applicable procedure as a task runner with short instructions, relevant data, and real action controls. Enforce dependent steps, permit independent work in parallel, and expose progress, pending evidence, and blocked steps without creating duplicate transaction forms.
- **Impact:** Helps employees execute an agreed process without memorising it or referring to a separate manual.
- **Complexity:** Very High - execution state, branching, parallelism, retries, revisions, and authoritative actions form a broad workflow capability.
- **Dependencies:** Features 5, 61, 66, 67, and 77.
- **Acceptance:** Reloading a partially completed task resumes the correct state and cannot repeat an already-posted business transaction.

### 66. Approved decision branches

- [x] **Implemented and verified locally, 28 October 2026.** Reviewed measurement limits define continue versus review/rework branches. Out-of-range readings remain recorded and cannot be replaced by an in-range value until an independent authorized reviewer routes rework. All measurements and decisions are retained. Scope is measured range decisions in guided SOPs. [Batch 3 delivery and verification](EOS_UPGRADE_BATCH_3.md).

- **What it does:** Define validated rules for permitted paths such as inspection pass, inspection hold, or missing-information return. Version the rules and show why a branch applies. Keep decisions that need human judgement explicitly assigned to an authorised person.
- **Impact:** Reduces repeated interpretation of routine cases while preserving appropriate review.
- **Complexity:** High - rules need safe structured evaluation, precedence, validation, explanations, and change control.
- **Dependencies:** Task blueprints, trusted source data, and features 70 and 77.
- **Acceptance:** The same approved inputs follow the same branch, and an absent measurement cannot be interpreted as a passing result.

### 67. Objective completion criteria

- [x] **Implemented and automatically tested locally; database rollout and visual acceptance pending, 22 October 2026.** A task can carry completion criteria that define its business outcome, evaluated on the server from current records. Five kinds are supported: the linked order, inspection, production job, dispatch, quotation, invoice or breakdown is in a required state (an invoice with no balance counts as paid); the linked inspection is not rejected and every result of its approved plan (feature 54) is recorded and within limits; the receiving team accepted the handoff (feature 69); a recorded observation is within limits; or a named role other than the assignee has signed off, which any later result invalidates. A criterion binds the record the task linked to when it was attached, so a task re-linked to another record, even in the same update as completion, fails as linked to the wrong source. A trigger refuses completion through every path (task list, task page, API) while a criterion is unmet, and names the first reasons. Completion stores the evaluation. Managers keep standard criteria per kind of task (`type:<task type>` or `handoff:<team>`) at `/tasks/criteria`; these attach to new internal tasks, never to dealer tasks. Supervisors add or remove (with a reason) criteria on one open task from the task page, where the assignee records observations. Completed tasks whose outcome is later reversed (for example a dispatch sent back) are listed for review and can be reopened with a reason, notifying the assignee. Completing a checklist is therefore separate from completing the work. 20 tests. [Handover](EOS_UPGRADE_CLAUDE_2.md).

- **What it does:** Define the required business outcome for each task, including source transaction state, observations, disposition, and sign-off where applicable. Evaluate that outcome on the server. Distinguish completing a checklist item from completing the underlying business work.
- **Impact:** Makes Done meaningful and reduces prematurely closed tasks that still need another employee's attention.
- **Complexity:** High - each task type needs explicit criteria, evidence sources, failure reasons, and rules for later invalidation.
- **Dependencies:** Features 34, 54, 68, and 73.
- **Acceptance:** A task cannot close when its required result is missing, reversed, rejected, or linked to the wrong source.

### 68. Existing transactions as completion evidence

- [x] **Implemented and verified locally, 28 October 2026.** Execution rules choose accepted transaction states; employees select related records. Company, lineage, role and current state are checked; completion locks and rechecks source evidence, so a reversal prevents completion. Supports linked orders, jobs, inspections, dispatches, quotations, invoices and breakdowns within each role's access. [Batch 3 delivery and verification](EOS_UPGRADE_BATCH_3.md).

- **What it does:** Link the actual inspection, stock movement, posted receipt, document, or authorised acknowledgement that proves a task step. Reuse existing evidence automatically and request only missing observations. Track the version and validity of each referenced item.
- **Impact:** Reduces repeated entry and makes later review possible without assembling evidence manually.
- **Complexity:** High - evidence links must be durable, access-safe, source-specific, and responsive to reversals or superseding revisions.
- **Dependencies:** Features 36, 67, and 77, plus transaction lineage.
- **Acceptance:** Existing valid evidence satisfies the right step, while reversing that evidence invokes the defined affected-task review.

### 69. Accepted department handovers

- [x] **Implemented and automatically tested locally; database rollout and visual acceptance pending, 22 October 2026.** Every new handoff (feature 14) has an acceptance state. The receiving team's prerequisites are evaluated from current records: packaging needs the QC release to still stand, a live job and order, and an open packaging job; quality needs the finishing receipt to still have accepted output; dispatch needs the packaging to still be complete and the order live. A team can be set to auto-accept when nothing is missing; otherwise a member accepts explicitly, confirming the received kilograms within the team tolerance (default 0.5%). A handoff cannot be started or completed through any path before it is accepted. Returning a handoff records the missing prerequisite and creates exactly one return task for the source team, assigned to the person whose action raised the handoff if they are still eligible. Completing that task puts the handoff back for acceptance. Handoffs created before this change keep working. 17 tests. [Handover](EOS_UPGRADE_CLAUDE.md).

- **What it does:** Define the information and condition the next department requires before accepting responsibility. Automatically accept straightforward handovers when approved criteria are satisfied; provide contextual return-for-clarification reasons for exceptions and explicit acceptance where the process requires it.
- **Impact:** Reduces incomplete handoffs and uncertainty over who should resolve missing information.
- **Complexity:** High - responsibility transitions, quantities, readiness changes, returns, and duplicate acceptance need a coherent lifecycle.
- **Dependencies:** Features 14, 63, 67, and 72.
- **Acceptance:** Returning a packaging handoff identifies the missing prerequisite and leaves one accountable owner for its resolution.

### 70. Risk-based verification and approval matrix

- [x] **Implemented and verified locally, 28 October 2026.** Reviewed execution rules specify normal and elevated verification roles. High/urgent task priority and observed out-of-range results require elevated review. Performers cannot verify their own work; changed risk and source evidence are rechecked before completion. A ten-row oldest-first verification queue contains only work the viewer may verify. Scope is internal guided SOP tasks. [Batch 3 delivery and verification](EOS_UPGRADE_BATCH_3.md).

- **What it does:** Define which actions permit self-checking, require supervision, or need an independent reviewer. Apply approved thresholds, roles, and separation-of-duty rules on the server. Make the required review clear before employees reach the decision point.
- **Impact:** Concentrates review on consequential work while avoiding unnecessary approvals for routine tasks.
- **Complexity:** High - policy applicability, delegation, exception scope, auditing, and permission enforcement must be consistent across modules.
- **Dependencies:** Features 44, 45, 62, and 76.
- **Acceptance:** A restricted action cannot gain approval through an ineligible reviewer or a different API path.

### 71. Turnaround targets and escalation rules

- [x] **Implemented and automatically tested locally; database rollout and visual acceptance pending, 22 October 2026.** `/tasks/turnaround` lets owners, admins and factory managers agree, per kind of work (handoffs by team, returned handoffs, or a task type), a start target, a completion target, the working time they run on (round the clock, or Mon–Sat 08:00–20:00 IST, Sundays excluded) and the escalation role. The task page shows total elapsed time, working time, recorded waiting and active time. The assignee or a supervisor records waiting with a reason; waiting pauses the target clock only, and total elapsed time is never reduced. The first start is remembered even if work is reopened. An escalation check raises each breached level once (not started in time; not completed in time), notifies the escalation role, and resolves escalations when work starts, finishes, comes back within target after a recorded wait, or loses its target. The handoff queue shows a status chip per row. Audit fix: the waiting-time permission check let any user act on an unassigned task (a NULL comparison); the same class of bug made the approval inbox's "can decide" flag unknown for requests with no recorded requester. Both are fixed and regression-tested. 18 tests. [Handover](EOS_UPGRADE_CLAUDE.md).

- **What it does:** Give task types agreed response and completion targets, responsible escalation roles, and calendar rules. Track active work, recorded waiting reasons, and total elapsed time separately. Resolve or update escalations when the underlying work changes.
- **Impact:** Makes delayed work actionable and identifies whether a bottleneck is internal or waiting on an external input.
- **Complexity:** High - calendars, pause semantics, reassignment, event timing, and notification deduplication require explicit policy.
- **Dependencies:** Features 48, 49, and 64, plus agreed working-time definitions.
- **Acceptance:** Placing work on an authorised hold changes the appropriate target calculation without erasing total elapsed time.

### 72. Hold and resume procedure

- [x] **Implemented and automatically tested locally; database rollout and visual acceptance pending, 22 October 2026.** A recorded hold captures reason, note, material/work condition, responsible employee, resume condition and progress at hold (output, issued billets) and moves the job on hold through the authoritative transition. Resume rechecks material and resources that may have changed, restores the earlier state (planned/ready/running), preserves progress, and is idempotent; a held job cannot be started through the ordinary transition; cancellation closes the hold. 20 tests across SQL and unit suites. [Handover](EOS_UPGRADE_CLAUDE.md).

- **What it does:** Record why work stopped, its current material/task condition, the responsible person, and what permits resumption. Preserve completed actions and affected quantities. Re-evaluate prerequisites that could change before resuming through the permitted action.
- **Impact:** Prevents paused work from becoming lost work and gives the next employee a clear restart condition.
- **Complexity:** High - holds interact with reservations, quality, task state, scheduling, and partially completed transactions.
- **Dependencies:** Features 33, 63, 69, and source-state guards.
- **Acceptance:** Resuming a held job retains its recorded progress and cannot use material that became ineligible during the pause.

### 73. Reopening work after important changes

- **What it does:** Identify downstream tasks affected by changes to approved inputs or reversal of required evidence. Reopen or route those tasks for review according to policy. Preserve previous completion and approval history, with separate correction processes for posted transactions.
- **Impact:** Prevents previously completed checks from being incorrectly relied on after their basis changes.
- **Complexity:** Very High - dependency analysis, controlled invalidation, partial completion, and posted financial/stock effects need careful boundaries.
- **Dependencies:** Features 25, 27, 67, 68, and 77.
- **Acceptance:** A changed approved specification flags affected work without silently rewriting completed records or issued invoices.

### 74. Standard opening and closing routines

- [x] **Complete for on-demand Indian-business-day routines, 22 October 2026.** An active procedure generates one run per business date, retaining its station/scope, revision and observation prompts; repeat requests open the existing run. Current permitted work/holds/recorded exceptions populate automatically, while required observations, stale-context checks and a retained handover outcome govern completion. Production summaries are explicitly company-wide rather than station-filtered; shift scheduling remains a future extension. Desktop context and phone observation/completion flows were visually inspected. Both migrations are applied and verified hosted; final 2,077-test suite, lint, typecheck and production build passed. [Scope, audit and acceptance evidence](docs/UPGRADE_EOS_COLLABORATION_BATCH_2026-10-22.md).

- **What it does:** Generate concise start/end routines for a shift, station, or business day. Populate assigned work, active holds, unfinished transactions, and known discrepancies automatically. Request human confirmation only for observations the approved routine genuinely requires.
- **Impact:** Creates a repeatable start and finish to daily work with fewer omissions and less report preparation.
- **Complexity:** Medium - depends on clear routine scope, calendar boundaries, reusable task templates, and duplicate-run prevention.
- **Dependencies:** Features 39, 61, 64, and 75.
- **Acceptance:** A shift routine appears once for the intended station and highlights unresolved work carried over from the previous period.

### 75. Reconciliation at process boundaries

- **What it does:** Define quantity or value checks before closing selected jobs, loads, purchasing stages, or financial tasks. Show expected, recorded, and unexplained amounts together. Route discrepancies through an approved resolution or hold, preserving source evidence.
- **Impact:** Detects inconsistencies close to the work that created them and reduces later investigation.
- **Complexity:** Very High - meaningful reconciliations require consistent boundaries, units, corrections, source completeness, and transactional enforcement.
- **Dependencies:** Features 29, 34, 51, 58, and 92.
- **Acceptance:** A process with an unexplained difference cannot be silently marked reconciled by entering a convenient balancing value.

### 76. Competency-linked task authorisation

- [x] **Implemented and automatically tested locally; database rollout and visual acceptance pending, 22 October 2026.** `/tasks/competencies` keeps a competency catalogue, optionally linked to an operating procedure (SOP) and a validity period. Employees hold one of three levels: trained (the procedure was read), supervised, or independent. Training acknowledgement is therefore separate from confirmed competency. Grants keep their history; nobody grants their own except the owner. A grant lapses on expiry or withdrawal, and a revision of the linked procedure makes an independent holder supervised until re-qualified. A company can require a competency for QC release (an inspection becoming approved) and for starting a production job. The database then refuses the step unless the employee is independent, or supervised with a confirmation (valid 8 hours, used once) from a different independent holder. A trained-only employee cannot confirm the step just because the SOP was read. A requirement needs at least one independent holder, and nothing changes for companies that set none. Refusals explain what is missing, including through the production hold/resume action. 16 tests. [Handover](EOS_UPGRADE_CLAUDE.md).

- **What it does:** Record which procedures an employee is trained and authorised to perform independently and which require supervision. Keep training acknowledgement separate from demonstrated competency. Define how qualification expiry or procedure revision changes task eligibility.
- **Impact:** Supports structured employee development and clearer supervision of unfamiliar work.
- **Complexity:** High - qualification records, authorisation rules, version applicability, and fair reassignment need consistent administration.
- **Dependencies:** Features 60, 62, 70, and 77.
- **Acceptance:** An employee requiring supervision cannot independently confirm a restricted task merely by acknowledging that the SOP was read.

### 77. Controlled SOP versions and effective dates

- [x] **Implemented and verified locally, 28 October 2026.** Numbered immutable releases, independent reviewers, effective dates, scheduled withdrawal and explicit in-flight policies bind each task to its instructions. Completed and reopened work retain historical instructions. Qualifications now bind to the applicable released instruction version as well as the ownership metadata revision. [Batch 3 delivery and verification](EOS_UPGRADE_BATCH_3.md).

- **What it does:** Give each procedure an identifier, approved revision, effective date, reviewer, and change history. Bind task execution to the applicable version and define how a new release affects work already underway. Retain earlier versions for historical interpretation.
- **Impact:** Keeps employees on the correct instructions and makes completed work understandable later.
- **Complexity:** High - release workflow, immutable versions, in-flight migration rules, and applicability across task types require shared design.
- **Dependencies:** Features 25, 62, 65, and 73.
- **Acceptance:** Releasing a revised SOP does not silently change the recorded instructions used by an already-completed task.

### 78. Outage and recovery procedure

- [x] **Implemented and verified locally, 28 October 2026.** Versioned continuity rules define permitted work, prohibited work and reconciliation responsibility. Printable instructions support numbered paper observations; recovered notes retain actual time and a policy snapshot. An independent designated reconciler links confirmed related transactions or rejects with a reason. Unique temporary references and unique transaction reconciliation prevent duplication; notes do not post stock or financial transactions. [Batch 3 delivery and verification](EOS_UPGRADE_BATCH_3.md).

- **What it does:** Define which work may continue when the application or connection is unavailable, how observations receive temporary references, and who reconciles them afterward. Prevent ambiguous retries or temporary notes from becoming duplicate authoritative transactions.
- **Impact:** Gives employees a dependable continuity method and makes post-outage reconciliation manageable.
- **Complexity:** High - safe continuity needs identity, numbering, reconciliation, capacity checks, and clear limits on disconnected actions.
- **Dependencies:** Features 16, 27, 64, and approved operational continuity rules.
- **Acceptance:** Entering a numbered temporary receipt after recovery cannot duplicate an already-confirmed receipt with the same source reference.

### 79. Validate SOPs through observed employee work

- [x] **Implemented and verified locally, 28 October 2026.** Supervisors observe another employee's active guided execution, retain its exact SOP version, record every step and employee feedback, and submit for independent process-owner review. A revise decision opens a traced controlled improvement; observations and decisions cannot be rewritten. [Batch 3 delivery and verification](EOS_UPGRADE_BATCH_3.md).

- **What it does:** Observe employees completing the real task, including interruptions, information searches, and informal workarounds. Trial the proposed method with the relevant roles and record confusing or unnecessary steps. Approve the procedure after the trial findings are resolved.
- **Impact:** Helps procedures reflect actual work and reduces instructions that look correct but fail on the factory floor.
- **Complexity:** Medium - the main effort is process observation, representative scenarios, employee availability, and turning findings into verified changes.
- **Dependencies:** Process owners, features 60 and 61, and a defined pilot scope.
- **Acceptance:** A representative employee can complete the pilot task with the documented method and identified support requirements.

### 80. Review SOP effectiveness using outcomes

- [x] **Implemented and verified locally, 28 October 2026.** Per-version outcomes retain denominators and distinguish missing duration evidence from zero. Employees flag steps; process owners trace recurring problems through a controlled trial, reviewed release and frozen before/after outcomes. Small samples are marked insufficient; observed differences do not imply causation. [Batch 3 delivery and verification](EOS_UPGRADE_BATCH_3.md).

- **What it does:** Track first-time acceptance, rework, returned handovers, recurring exceptions, and task duration with their data-quality limits. Let employees flag unclear steps from the task itself. Use reviewed findings to trial and release approved procedural improvements.
- **Impact:** Creates a practical improvement cycle based on work quality and employee experience.
- **Complexity:** High - meaningful metrics need consistent events, comparable baselines, appropriate access, and controlled linkage to SOP revisions.
- **Dependencies:** Features 49, 62, 69, 77, and 79.
- **Acceptance:** A proposed improvement can be traced from a recurring problem through a trial to a reviewed SOP revision and measured outcome.

## Features 81-100: Automatic data population and calculations

For these features, every field must have a clear source. Maintain approved defaults in master records once, and keep actual transaction observations separate.

| Field class | Example | Required behaviour |
| --- | --- | --- |
| Existing record | Customer address or profile specification | Populate from the selected authorised record and its applicable version. |
| Calculated | Theoretical weight or outstanding balance | Derive from trusted inputs, with units, precision, and an explainable formula. |
| Suggested | Proposed allocation or completion date | Show the basis and require the appropriate review before commitment. |
| Observed | Actual weight or inspection reading | Capture once from the employee or a verified device; never invent a result. |
| System recorded | Creator, record number, confirmation time | Capture from the authenticated transaction event, not arbitrary browser input. |

### 81. Customer details from selected records

- [x] **Implemented and audited locally, 28 October 2026; hosted rollout pending.** Customer/site precedence and reviewed transaction overrides feed immutable issued quote, accepted-order and new-invoice party snapshots. [Batch 4 scope, tests and audit](EOS_UPGRADE_BATCH_4.md).

- **What it does:** The employee selects a customer and delivery site. Populate saved party details, GST information, contacts, approved payment terms, and applicable instructions. Allow authorised transaction-specific changes with clear precedence, then preserve the required issued-document snapshots.
- **Impact:** Removes repeated customer entry and reduces inconsistent addresses or terms between sales, dispatch, and accounts.
- **Complexity:** High - master/site precedence, contact permissions, draft refresh, and immutable historical snapshots must be coordinated.
- **Dependencies:** Customer/site master quality and features 7, 43, and 87.
- **Acceptance:** Selecting a site fills its delivery details, while updating the customer master never rewrites an issued invoice's historical party data.

### 82. Technical specifications from selected profiles

- [x] **Implemented and audited locally, 28 October 2026; hosted rollout pending.** Independently approved profile alloy/temper choices, current drawing/weight/dimensions, missing-data warnings and immutable technical snapshots support sole-option selection and explicit alternatives. [Batch 4 scope, tests and audit](EOS_UPGRADE_BATCH_4.md).

- **What it does:** Selecting a profile supplies its approved section weight, drawing revision, dimensions, coating perimeter, compatible dies, and permitted alloy/temper options. Auto-select a sole approved option and require a choice where alternatives exist. Flag missing specification data.
- **Impact:** Reduces technical lookup and inconsistent specifications repeated across forms.
- **Complexity:** High - versioned technical masters, compatibility rules, variant selection, and downstream snapshots need careful modelling.
- **Dependencies:** Features 12, 21, 22, 25, and controlled profile/die data.
- **Acceptance:** A profile with several permitted tempers requests an explicit valid choice and cannot silently default to an incompatible specification.

### 83. Length and theoretical weight from pieces

- **Follow-up, 21 October 2026:** Actual profile selection and numeric entry now have integration coverage for master-based weight, changed cut length, manual override, missing weight, and zero transaction writes. Interactive visual inspection remains pending at the user's request. [Current recheck](docs/UPGRADE_EOS_ENTRY_ACCEPTANCE_RECHECK_2026-10-21.md).

- [ ] **Implemented and audited locally; interactive visual acceptance pending, 21 October 2026.** Quotation lines show total metres and theoretical kg using the shared quote calculation, identify profile-master versus manual kg/m, and flag missing or invalid inputs. Mounted tests verify 100 x 6 m x 0.8 kg/m = 480 kg, length changes, manual overrides, and zero writes during calculation. Master values are not labelled approved merely because populated. Final independent verification: 1,769 tests across 76 suites; lint, typecheck, and build passed. Visual and real-master suitability checks remain open. [Delivery audit and remaining checks](docs/UPGRADE_EOS_ENTRY_AND_PREVIEWS_2026-10-21.md).

- **What it does:** For piece-based work, capture piece count and cut length, then fetch approved section weight. Calculate total metres = pieces x length in metres, and theoretical kg = total metres x kg/m. For 100 pieces x 6 m x 0.8 kg/m, show 600 m and 480 kg theoretical weight.
- **Impact:** Removes repeated arithmetic and keeps quantity representations consistent.
- **Complexity:** Medium - formula integration is bounded, but unit conversion, rounding, zero/missing inputs, and measured-weight separation need verification.
- **Dependencies:** Feature 82 and shared quantity calculations.
- **Acceptance:** Changing length updates dependent draft values consistently without modifying a separately recorded measured weight.

### 84. Finishing area and finishing charges

- [ ] **Implemented, automatically tested and checked in isolated Playwright at 1280 and 375 px, 22 October 2026; signed-in trial pending.** Per-sq-ft finishing lines explain area m2 = total metres x coating perimeter / 1,000, the sq ft conversion and rate x area, reusing the quote calculation so the explanation equals the costed charge. A missing perimeter shows an incomplete-cost alert rather than a zero charge (the existing send-blocking warning still applies). Minimum-charge rules are not implemented because no approved minimum-charge data exists. [Delivery audit and evidence](docs/UPGRADE_EOS_PRODUCTION_PERFORMANCE_2026-10-22.md).

- **What it does:** Fetch the approved coating perimeter and selected finish's charging basis. Calculate area m2 = total length m x coating perimeter mm / 1,000, then convert to square feet if required. Apply the approved rate, minimum-charge rules, and applicable surface assumptions.
- **Impact:** Eliminates manual area calculation and makes finishing quotations easier to explain.
- **Complexity:** High - surface applicability, rate bases, approved overrides, precision, and minimum-charge policies must remain consistent.
- **Dependencies:** Features 82, 83, and 85, plus approved finishing specifications.
- **Acceptance:** A missing required coating perimeter produces an incomplete-cost warning instead of a false zero finishing charge.

### 85. Approved dated costing rates

- [x] **Implemented and automatically tested locally; database rollout and visual acceptance pending, 22 October 2026.** `/quotes/rates` keeps approved, dated billet (optionally per alloy), conversion and finishing (per kg, sq ft or metre) rates, each general or for one customer's agreement. A customer agreement takes precedence over the general rate, and an alloy-specific billet rate over the all-alloy rate. A draft is approved by another person (owner, admin or sales manager); whoever last edits a draft becomes its author, so editing cannot bypass the four-eyes rule. Approving a newer rate ends its predecessor the day before. Rates that have ended, or end within 14 days, with no successor appear under "Needs review". When a quotation is approved for sending, the rates applicable on its quote date are bound to that revision and never change. The quote page's Rate Check compares each line's billet, conversion and finishing rate with the bound or applicable approved rate. Withdrawing a rate bound to an issued quotation is refused. Rates are hidden from production, viewers and dealers. The quote form's "Apply approved rates" fills lines on request and stays overridable. Price from margin is cost ÷ (1 − margin), so 250 at 20% gives 312.50 (a 25% markup), shared with the quote engine. 22 tests. [Handover](EOS_UPGRADE_CLAUDE_2.md).

- **What it does:** Select the applicable approved material, conversion, finishing, packing, and customer-agreement rates using an explicit precedence and effective date. Calculate proposed selling prices by the agreed method. For an illustrative INR 250 cost and 20% selling margin, price = 250 / (1 - 0.20) = INR 312.50.
- **Impact:** Reduces repeated rate entry and confusion between markup and margin.
- **Complexity:** High - rate versioning, applicability, approvals, currency/unit bases, and expiry handling are business-critical.
- **Dependencies:** Rate masters, features 7 and 70, and shared costing functions.
- **Acceptance:** An expired rate requires review, and an accepted quotation retains the rate version originally agreed.

### 86. Calculated commercial totals

- [x] **Implemented and audited locally, 28 October 2026; hosted rollout pending.** Saved line amounts and per-line rounded GST reconcile in commercial review, with theoretical/billing quantities distinguished and cost/margin projected by role. [Batch 4 scope, tests and audit](EOS_UPGRADE_BATCH_4.md).

- **What it does:** Derive line amounts, authorised discounts, charges, applicable taxes, rounding, and grand total from the approved transaction rules. Keep theoretical, measured, and contractual billing quantities separately labelled. Apply the same rules in draft previews, posting, and PDFs.
- **Impact:** Reduces manual totals and prevents disagreement between screens and issued documents.
- **Complexity:** High - commercial basis, line tax treatment, precision, approved exceptions, and snapshot rules require integrated validation.
- **Dependencies:** Features 83-85, approved tax configuration, and current quotation/invoice calculations.
- **Acceptance:** A multi-line transaction reconciles to its issued totals, with no client-submitted total overriding the authoritative calculation.

### 87. Orders from accepted quotation versions

- [x] **Implemented and audited locally, 28 October 2026; hosted rollout pending.** Exact-version conversion and immutable accepted-source snapshots preserve lines, parties, specifications and terms, with retry protection and the existing factory/dealer allocation path. [Batch 4 scope, tests and audit](EOS_UPGRADE_BATCH_4.md).

- **What it does:** Carry the accepted quote's customer/site, source lines, quantities, specifications, finishes, agreed prices, and terms into the order. Request only order-specific information such as customer PO and confirmed delivery requirements. Bind the order to the exact accepted revision.
- **Impact:** Removes re-entry and reduces disagreement between the customer agreement and factory instructions.
- **Complexity:** High - conversion needs exact lineage, controlled changes, duplicate protection, and transactional validation.
- **Dependencies:** Features 5, 25, 29, and 81-86.
- **Acceptance:** A retried conversion cannot duplicate the order, and a later quotation revision does not silently change an already-created order.

### 88. Stock-versus-production requirements

- [x] **Implemented and audited locally for whole-piece finished stock, 29 October 2026; hosted contention acceptance pending.** Confirmed reservations reduce order-basis manufacturing demand, retain physical weight separately and guard ordinary production writes. Stale or failed allocation leaves demand unchanged; unresolved legacy/ambiguous mappings are excluded. [Batch 5 evidence](EOS_UPGRADE_BATCH_5.md).

- **What it does:** Match demand to eligible stock by approved specification, location, reservation, and quality rules. Propose an allocation and calculate the remaining manufacturing requirement. A hypothetical 1,000 kg demand with 250 kg eligible for confirmed allocation leaves 750 kg to manufacture on the same quantity basis.
- **Impact:** Reduces manual checks and helps avoid producing material already available.
- **Complexity:** Very High - eligibility, prioritisation, cumulative demand, concurrent allocation, and reversals must agree with the inventory authority.
- **Dependencies:** Features 12, 29, 34, and source-line stock records.
- **Acceptance:** Two employees cannot both commit the same available quantity, and a failed allocation does not reduce the manufacturing requirement.

### 89. Planned billet input and billet count

- [ ] **Implemented and automatically tested locally; isolated Playwright visual check passed at 1280 and 375 px; signed-in operator trial pending, 22 October 2026.** Production entry explains planned input kg = planned good output / expected recovery and the rounded-up billet count when compatible billets share one weight, plus whether selected billets cover the plan. A floating-point rounding defect that planned 41 instead of 40 billets (700 kg, 70%, 25 kg) is fixed in the shared count. The quotation-to-order billet preview still uses billing weight and fixed 75%/5.8 m assumptions pending a business decision. [Delivery audit and evidence](docs/UPGRADE_EOS_PRODUCTION_PERFORMANCE_2026-10-22.md).

- **What it does:** Fetch planned good output, approved expected recovery, and the selected billet specification. Calculate planned input kg = good output kg / recovery fraction, then round billet count upward. At 900 kg output, 75% recovery, and 30 kg per billet, the plan requires 1,200 kg input and 40 billets.
- **Impact:** Removes manual planning arithmetic and makes recovery assumptions visible.
- **Complexity:** High - production-versus-billing basis, recovery validation, usable billet assumptions, and allocation integration need explicit rules.
- **Dependencies:** Features 88 and 90, plus approved recovery assumptions.
- **Acceptance:** Recovery is applied once to the intended manufacturing output; minimum commercial billing weight cannot silently increase physical manufacturing demand.

### 90. Theoretical billet weight from geometry

- **Follow-up, 21 October 2026:** Integration now exercises the estimate inside the actual foundry form, proving display-unit changes preserve the millimetre configuration and blank density removes the estimate without saving a weighing or batch. Interactive visual inspection remains pending at the user's request. [Current recheck](docs/UPGRADE_EOS_ENTRY_ACCEPTANCE_RECHECK_2026-10-21.md).

- [ ] **Implemented and audited locally; interactive visual acceptance pending, 21 October 2026.** Foundry entry explains the current batch's diameter, length, alloy/density assumption, geometry formula, per-billet estimate, batch estimate, and existing rounding basis. Equivalent mm/cm/m/in displays preserve mass; invalid/missing configuration shows an unavailable estimate. Measured and issued material facts are not altered by this presentation. Final independent verification: 1,769 tests across 76 suites; lint, typecheck, and build passed. Visual inspection and company approval of applicable density assumptions remain open. [Delivery audit and remaining checks](docs/UPGRADE_EOS_ENTRY_AND_PREVIEWS_2026-10-21.md).

- **What it does:** Fetch billet diameter, standard length, alloy, and approved density assumption from the selected specification. Convert dimensions to metres and calculate theoretical kg = pi x (diameter / 2)^2 x length x density. Multiply by count for a planned batch and retain actual measured mass separately.
- **Impact:** Reduces repeated weight lookup and supports explainable material planning.
- **Complexity:** Medium - geometry is simple, but dimensional units, density versions, precision, and separation from committed physical observations need controls.
- **Dependencies:** Billet specifications, shared foundry calculations, and feature 89.
- **Acceptance:** Equivalent dimensions entered in supported units produce the same estimate, and a master-density change does not rewrite issued actual material facts.

### 91. Production performance from actual transactions

- [ ] **Implemented and automatically tested locally; isolated Playwright visual check passed at 1280 and 375 px; signed-in operator trial pending, 22 October 2026.** Production job detail shows recovery, scrap and plan attainment from linked billet input (the completion transaction's statuses and measured-else-nominal basis), recorded good output and non-reversed scrap postings. Missing input or unreadable scrap shows Not captured; a recorded zero output stays 0%. Output per operating hour is not shown because jobs do not record operating time. [Delivery audit and evidence](docs/UPGRADE_EOS_PRODUCTION_PERFORMANCE_2026-10-22.md).

- **What it does:** Use recorded material issues and good output to calculate recovery, plan attainment, output per operating hour, and related metrics where inputs exist. Recovery percent = good output kg / issued input kg x 100; 800 kg good output from 1,000 kg input gives 80%.
- **Impact:** Removes manual performance summaries and gives supervisors a traceable view of production results.
- **Complexity:** High - source completeness, time boundaries, reversals, work in progress, and shared-job allocation affect meaningful results.
- **Dependencies:** Features 34, 75, 92, and 99.
- **Acceptance:** Missing issued input produces Not captured, while a valid zero good-output observation remains a real recorded result.

### 92. Material discrepancy calculation

- [ ] **Implemented and automatically tested locally; isolated Playwright visual check passed at 1280 and 375 px; signed-in operator trial pending, 22 October 2026.** Completed jobs show input - (good output + measured scrap) with the signed difference, kept visible even inside the completion tolerance; completion entry previews the same balance including earlier scrap postings. Nothing is booked as scrap. Work in progress, returns and other classified movements are supported by the calculation but have no job-level source records yet. [Delivery audit and evidence](docs/UPGRADE_EOS_PRODUCTION_PERFORMANCE_2026-10-22.md).

- **What it does:** Reconcile a defined process boundary using actual input, good output, measured scrap, returns, work in progress, and other classified movements. For 1,000 kg input, 780 kg good output, 180 kg measured scrap, and 30 kg work in progress, flag 10 kg unaccounted.
- **Impact:** Exposes unexplained differences without hiding them in an invented scrap figure.
- **Complexity:** Very High - mass balance depends on consistent boundaries, non-overlapping classifications, measured evidence, returns, and correction handling.
- **Dependencies:** Features 29, 34, 75, and recorded material movements.
- **Acceptance:** An unexplained difference remains visible until classified through the authorised process; the system never automatically records it as measured scrap.

### 93. Generated cutting requirements

- **What it does:** Fetch required cut lengths/counts, eligible stock lengths, approved saw kerf, and cutting allowances. Propose a cutting sequence, required stock count, expected offcuts, and estimated waste. Capture actual usage and retain eligible reusable remnants as identifiable stock.
- **Impact:** Reduces manual cut planning and makes potential waste visible before material is used.
- **Complexity:** Very High - optimisation, dimensional feasibility, stock compatibility, rounding, remnant identity, and actual-result reconciliation need substantial validation.
- **Dependencies:** Features 29, 82, 83, and reliable stock-length records.
- **Acceptance:** A proposed sequence fits each available stock length including allowances and never represents estimated offcuts as confirmed returned stock.

### 94. Bundle and dispatch totals from selected material

- [x] **Implemented and audited locally, 29 October 2026; hosted and physical acceptance pending.** Record measured source-linked bundles once, generate tags, select them for dispatch and derive reviewed totals. Atomic posting locks each prepared tag and rejects duplicate consumption or changed observations. [Batch 5 evidence](EOS_UPGRADE_BATCH_5.md).

- **What it does:** Selecting eligible source material supplies profile, finish, lineage, and quantity limits. Capture actual pieces and weight observations once, calculate net weight = gross weight - tare, and generate bundle identities. Selecting bundles builds dispatch counts, weights, and order balances automatically.
- **Impact:** Removes repeated bundle transcription and calculator work during loading.
- **Complexity:** Very High - packaging, physical weights, source consumption, concurrent selection, partial loads, and reversals cross stock and dispatch boundaries.
- **Dependencies:** Features 29, 30, 88, and verified device connections where used.
- **Acceptance:** Negative net weights and duplicate bundle consumption are rejected, and totals reconcile to the material actually confirmed for dispatch.

### 95. Purchase receipts from purchase orders

- **What it does:** Selecting a PO supplies vendor, material, specification, units, agreed rates, and expected quantities. Stores records actual receipt and the observed accepted, rejected, or held portions. Calculate remaining PO quantities, shortages, and receipt values using an explicit acceptance policy.
- **Impact:** Speeds receiving and reduces differences between purchasing expectations and stores records.
- **Complexity:** High - partial receipts, over-receipt policy, unit conversion, disposition, and supplier returns require transactional consistency.
- **Dependencies:** Purchase line identity, stock receipt rules, and feature 58.
- **Acceptance:** A short or partly rejected receipt updates the correct outstanding quantities without falsely creating fully accepted stock.

### 96. Invoices from eligible dispatches

- **What it does:** Fetch customer, dispatch references, eligible unbilled quantities, contractual billing basis, agreed rates, and applicable tax configuration. Calculate a reviewable invoice draft and preserve required snapshots on issue. Use recorded actual weight when the contract requires measured-weight billing.
- **Impact:** Reduces invoice preparation and accidental mismatch with delivered material.
- **Complexity:** Very High - duplicate billing prevention, partial dispatches, commercial snapshots, tax rules, and concurrent issuance need strong transaction controls.
- **Dependencies:** Features 29, 81, 85, 86, 87, and 94.
- **Acceptance:** Concurrent invoice attempts cannot bill the same eligible dispatch quantity twice, and issued documents remain reproducible.

### 97. Receivables from recorded receipts

- **What it does:** Capture or import the actual received amount, payment date, method, and reference. Suggest invoice allocations for authorised review, then calculate outstanding balances, agreed-term due dates, overdue days, and settlement status after posting. Show cash and credit adjustments separately.
- **Impact:** Removes manual balance tracking and supports accurate customer collection discussions.
- **Complexity:** Very High - allocations, reversals, credits, duplicate references, concurrent receipts, and invoice locking require financial integrity controls.
- **Dependencies:** Features 27, 51, 70, and 96.
- **Acceptance:** A credit adjustment can reduce a balance without being misrepresented as cash collected, and concurrent receipts cannot over-allocate an invoice.

### 98. Reviewable supplier-document extraction

- **What it does:** Where extraction is implemented, read an uploaded invoice or receipt into proposed vendor, document number/date, line amounts, taxes, and totals. Match known references, flag uncertain fields and likely duplicates, and require review before confirmed financial posting.
- **Impact:** Reduces transcription while focusing employee attention on uncertain or mismatched data.
- **Complexity:** Very High - optical character recognition or document extraction needs provider evaluation, privacy controls, varied-format handling, confidence review, and reconciliation.
- **Dependencies:** Features 36, 55, 58, and approved document-processing scope.
- **Acceptance:** A misread amount remains a reviewable suggestion, and uploading the same invoice again cannot silently create a second posted expense.

### 99. Machine time, energy, and related cost

- **What it does:** Capture actual start/stop events and meter observations, or import verified device readings. Calculate duration, recorded downtime, energy used = closing reading - opening reading, and cost using the applicable tariff. Allocate shared usage to jobs only through an approved method.
- **Impact:** Reduces manual runtime summaries and makes selected operating costs traceable to recorded usage.
- **Complexity:** Very High - shift boundaries, meter resets, shared loads, device failures, time corrections, and cost allocation need explicit models.
- **Dependencies:** Features 19, 31, 33, and approved tariffs/meter assignments.
- **Acceptance:** A meter rollover or missing stop event is flagged for resolution instead of producing a negative consumption or fabricated operating duration.

### 100. Configurator outputs from project inputs

- **What it does:** Capture approved system choice, opening dimensions, quantity, layout, glass, finish, and hardware options. Apply versioned system rules to generate profile cuts, glass sizes, hardware BOM, material quantities, estimated waste, and costing. Show explanations and unresolved requirements where a required rule is missing.
- **Impact:** Reduces repeated technical calculations and keeps cutting, glass, hardware, and quotation outputs aligned.
- **Complexity:** Very High - validated formulas, dimensional constraints, compatibility, optimisation, source lineage, and document consistency span the complete configurator.
- **Dependencies:** Existing configurator engines and features 77, 82-86, and 93.
- **Acceptance:** One approved input set produces reconciled outputs, and missing or invalid rules prevent affected outputs from being presented as fabrication-ready.

## Shared delivery sequence

These are suggested dependency groups, not additional features or committed release dates. Reuse shared components and authoritative business rules across the numbered entries.

| Delivery focus | Representative features | Reason to establish it |
| --- | --- | --- |
| Reliable master data and field ownership | 7, 22, 59, 81, 82, 85 | Automatic entry depends on approved, identifiable source values. |
| Shared calculations and quantity definitions | 11, 51, 75, 83-86, 89-92 | Forms, saved transactions, and reports must agree on units, formulas, and missing data. |
| Daily usability improvements | 1-4, 8, 20, 21, 24, 40-42 | Employees gain practical navigation and entry improvements while deeper work is prepared. |
| Transaction and source integrity | 5, 6, 12-19, 25-30, 34, 56, 58, 87, 88, 94-97 | Automation must preserve authoritative quantities, history, and permitted transitions. |
| SOP execution and accountability | 44, 45, 61-80 | Build on reliable actions and evidence instead of creating a separate competing task system. |
| External and advanced capabilities | 19, 31, 37, 52, 60, 93, 98-100 | Hardware, providers, isolation, forecasts, and optimisation need bounded pilots and dedicated verification. |

## Verification and impact measurement

Before implementing a selected feature, inspect its current routes, actions, schema, policies, and tests. Confirm which target behaviour already exists and define the incremental scope. Review dependencies and the acceptance example with the department that will use it.

For implemented software, run the relevant focused checks and the project's lint, typecheck, build, and test commands. Add meaningful negative, permission, stale-state, duplicate-request, and concurrency cases where the feature changes business transactions. Verify applicable browser behaviour at desktop and narrow mobile widths. Hosted database acceptance, signed-in operator trials, physical reconciliation, and deployment are separate evidence layers.

Measure a representative task before and after the change using task completion time, fields typed, repeated information, correction/rework frequency, first-time acceptance, and unresolved exceptions. Record sample size and role/context. No fixed percentage saving or production-readiness claim is established by this catalogue.

## Reference guidance

These references informed the general design principles. The feature definitions, impact expectations, and complexity ratings are project-specific planning judgements.

- [W3C: Understanding redundant entry](https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html) supports reusing information within an activity.
- [GOV.UK: Structuring forms](https://www.gov.uk/service-manual/design/form-structure) explains identifying why each requested field is needed.
- [Nielsen Norman Group: UI accelerators](https://www.nngroup.com/articles/ui-accelerators/) discusses shortcuts for frequent users.
- [GOV.UK: Check answers](https://design-system.service.gov.uk/patterns/check-answers/) describes review before consequential submission.
- [EPA: Guidance for preparing SOPs](https://www.epa.gov/sites/default/files/2015-06/documents/g6-final.pdf) covers procedure structure, responsibilities, checklists, and document control.
- [HSE: Operating procedures](https://www.hse.gov.uk/comah/sragtech/techmeasoperatio.htm) discusses task analysis and keeping procedures aligned with actual work.

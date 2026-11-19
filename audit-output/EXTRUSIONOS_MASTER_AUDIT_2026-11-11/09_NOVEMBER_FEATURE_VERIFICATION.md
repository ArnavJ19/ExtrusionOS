# November Feature Verification

Each stable ID has a record keyed to the original specification, delivery note, current source and actual test output where the test title identifies the feature. Delivery-note text is historical scope evidence. An executed case name supplies runtime evidence for that case. It does not establish all advertised steps, permissions, three distinct edge cases, signed-in roles, hosted rollback or plant acceptance. Test aliases and group anchors are listed separately from direct implementation mentions.

[Per-feature evidence and case names](evidence/november-coverage.json) · [Captured test output](evidence/test-isolated.log)

| ID | Specification | Batch and current anchor | Identified executed cases | Scope and acceptance |
|---|---|---|---|---|
| NOV-001 | Make My Work Today the main working screen (`NOV_UPGRADES.md:816`) | 2 · Work Today and record entry · `lib/workflow/record-next-action.ts` | 7 passed, 0 failed | Acceptance open |
| NOV-002 | Give each employee a small relevant workspace (`NOV_UPGRADES.md:500`) | 1 · Shared controls · `lib/ui/status-presentation.ts` | 2 passed, 2 failed | Acceptance open |
| NOV-003 | Make search usable directly from every screen (`NOV_UPGRADES.md:1237`) | 7 · Improvement · `components/search/global-find.tsx:19` | 5 passed, 0 failed | Acceptance open |
| NOV-004 | Put one clear next action on each record (`NOV_UPGRADES.md:838`) | 2 · Work Today and record entry · `lib/workflow/record-next-action.ts` | 2 passed, 0 failed | Acceptance open |
| NOV-005 | Finish the connected order workspace (`NOV_UPGRADES.md:1598`) | 4 · Operations control · `components/modules/control/fulfilment-lines.tsx:5` | 6 passed, 0 failed | Acceptance open |
| NOV-006 | Show only fields needed at the current stage (`NOV_UPGRADES.md:522`) | 1 · Shared controls · `lib/ui/status-presentation.ts` | 5 passed, 0 failed | Acceptance open |
| NOV-007 | Carry known information through the entire process (`NOV_UPGRADES.md:1621`) | 4 · Operations control · `lib/workflow/operations-control.ts:1` | 2 passed, 0 failed | Acceptance open |
| NOV-008 | Use sensible visible defaults (`NOV_UPGRADES.md:722`) | 6 · Lifecycle · `components/modules/operations/record-form-client.tsx:153` | 2 passed, 0 failed | Acceptance open |
| NOV-009 | Extend Repeat Previous beyond quotations (`NOV_UPGRADES.md:1260`) | 7 · Improvement · `components/forms/repeat-previous-picker.tsx:19` | 3 passed, 0 failed | Acceptance open |
| NOV-010 | Create missing master records without leaving the task (`NOV_UPGRADES.md:1282`) | 7 · Improvement · `components/modules/operations/record-form-client.tsx:211` | 1 passed, 0 failed | Acceptance open |
| NOV-011 | Make repeated line entry work like a spreadsheet (`NOV_UPGRADES.md:1304`) | 7 · Improvement · `components/modules/dispatch-form-client.tsx:216` | 3 passed, 0 failed | Acceptance open |
| NOV-012 | Ask employees for the quantity they actually know (`NOV_UPGRADES.md:860`) | 2 · Work Today and record entry · `lib/workflow/record-next-action.ts` | 12 passed, 0 failed | Acceptance open |
| NOV-013 | Extend dependable drafts to every lengthy form (`NOV_UPGRADES.md:1644`) | 4 · Operations control · `components/forms/form-draft-recovery.tsx:8` | 3 passed, 0 failed | Acceptance open |
| NOV-014 | Allow small updates directly from work queues (`NOV_UPGRADES.md:2062`) | 8 · Execution · `components/modules/execution/queue-panel.tsx:17` | 4 passed, 0 failed | Acceptance open |
| NOV-015 | Make department handoffs part of completing work (`NOV_UPGRADES.md:1667`) | 4 · Operations control · `lib/workflow/operations-control.ts:1` | 4 passed, 0 failed | Acceptance open |
| NOV-016 | Turn blockers into actionable instructions (`NOV_UPGRADES.md:544`) | 1 · Shared controls · `lib/ui/status-presentation.ts` | 3 passed, 0 failed | Acceptance open |
| NOV-017 | Make QR scanning lead directly into the relevant task (`NOV_UPGRADES.md:1326`) | 7 · Improvement · `app/(dashboard)/scan/page.tsx:17` | 4 passed, 0 failed | Acceptance open |
| NOV-018 | Expand focused phone workflows for factory work (`NOV_UPGRADES.md:882`) | 2 · Work Today and record entry · `lib/workflow/record-next-action.ts` | 15 passed, 0 failed | Acceptance open |
| NOV-019 | Keep documents and communication beside the transaction (`NOV_UPGRADES.md:2085`) | 8 · Execution · `components/modules/execution/message-tools.tsx:8` | 3 passed, 0 failed | Acceptance open |
| NOV-020 | Remove double entry between operations accounts and equipment (`NOV_UPGRADES.md:2512`) | 9 · Commercial · `lib/workflow/commercial.ts:1` | 4 passed, 0 failed | Steps 1 to 5 for one family; no connector; steps 6 deferred |
| NOV-021 | Check delivery feasibility before promising a date (`NOV_UPGRADES.md:2416`) | 6 · Lifecycle · `lib/workflow/lifecycle.ts:1` | 5 passed, 0 failed | Acceptance open |
| NOV-022 | Turn material shortages into a purchasing plan (`NOV_UPGRADES.md:1690`) | 4 · Operations control · `lib/workflow/operations-control.ts:1` | 2 passed, 0 failed | Acceptance open |
| NOV-023 | Suggest compatible production runs and their sequence (`NOV_UPGRADES.md:2536`) | 9 · Commercial · `lib/workflow/commercial.ts:1` | 2 passed, 0 failed | Steps 1 to 4 and 6 partly; preview of the schedule and apply are not built |
| NOV-024 | Add a what happens if planning tool (`NOV_UPGRADES.md:2560`) | 9 · Commercial · `components/modules/commercial/mutation-form.tsx:113` | 5 passed, 0 failed | Steps 1 to 4 and 6; applying changes through domain actions is not built |
| NOV-025 | Give every die a useful operating history (`NOV_UPGRADES.md:1348`) | 7 · Improvement · `components/modules/improvement/die-service-note.tsx:9` | 2 passed, 0 failed | Acceptance open |
| NOV-026 | Connect maintenance directly to production capacity (`NOV_UPGRADES.md:1899`) | 5 · Assurance · `lib/workflow/assurance.ts:1` | 2 passed, 0 failed | Steps 1 to 4; step 5 records the commercial review without changing dates |
| NOV-027 | Trace material from source to customer (`NOV_UPGRADES.md:2440`) | 6 · Lifecycle · `lib/workflow/lifecycle.ts:1` | 3 passed, 0 failed | Steps 1 to 4; holds through QC status only |
| NOV-028 | Track work in progress by physical location and age (`NOV_UPGRADES.md:1714`) | 4 · Operations control · `lib/workflow/operations-control.ts:1` | 3 passed, 0 failed | Acceptance open |
| NOV-029 | Manage reusable remnants and excess production (`NOV_UPGRADES.md:2270`) | 9 · Commercial · `lib/workflow/commercial.ts:1` | 5 passed, 0 failed | Acceptance open |
| NOV-030 | Introduce a cycle-counting workflow (`NOV_UPGRADES.md:1922`) | 5 · Assurance · `lib/workflow/assurance.ts:1` | 3 passed, 0 failed | Acceptance open |
| NOV-031 | Maintain a material account for each finishing vendor (`NOV_UPGRADES.md:1737`) | 4 · Operations control · `lib/workflow/operations-control.ts:1` | 2 passed, 0 failed | Steps 1, 2, 3 and 5; step 4 kept out of scope (material only) |
| NOV-032 | Support customer-owned metal and job-work settlement (`NOV_UPGRADES.md:2633`) | 10 · Specialist · `lib/workflow/specialist.ts:1` | 2 passed, 0 failed | Acceptance open |
| NOV-033 | Generate a complete quality document pack (`NOV_UPGRADES.md:1946`) | 5 · Assurance · `lib/workflow/assurance.ts:1` | 1 passed, 1 failed | Acceptance open |
| NOV-034 | Show consequences of an order revision (`NOV_UPGRADES.md:2392`) | 5 · Assurance · `lib/workflow/assurance.ts:1` | 2 passed, 0 failed | Acceptance open |
| NOV-035 | Compare estimated and actual job profitability (`NOV_UPGRADES.md:2489`) | 9 · Commercial · `lib/workflow/commercial.ts:1` | 3 passed, 0 failed | Acceptance open |
| NOV-036 | Plan a vehicle load across multiple orders (`NOV_UPGRADES.md:2108`) | 8 · Execution · `lib/workflow/execution.ts:1` | 3 passed, 0 failed | Acceptance open |
| NOV-037 | Support blanket orders with scheduled releases (`NOV_UPGRADES.md:2294`) | 10 · Specialist · `lib/workflow/specialist.ts:1` | 2 passed, 0 failed | Acceptance open |
| NOV-038 | Manage a return through final resolution (`NOV_UPGRADES.md:1969`) | 5 · Assurance · `lib/workflow/assurance.ts:1` | 2 passed, 0 failed | Acceptance open |
| NOV-039 | Measure supplier and finishing-vendor reliability (`NOV_UPGRADES.md:1504`) | 9 · Commercial · `lib/workflow/commercial.ts:1` | 2 passed, 0 failed | Steps 1 to 4; attribution of internal delay is not built |
| NOV-040 | Give accounts a collection workflow with payment commitments (`NOV_UPGRADES.md:904`) | 3 · Coordination · `lib/actions/coordination.ts` | 4 passed, 0 failed | Acceptance open |
| NOV-041 | Give every order one accountable coordinator (`NOV_UPGRADES.md:927`) | 3 · Coordination · `lib/actions/coordination.ts` | 3 passed, 0 failed | Acceptance open |
| NOV-042 | Define what each role can decide independently (`NOV_UPGRADES.md:1760`) | 4 · Operations control · `lib/workflow/exception-requests.ts:113` | 3 passed, 0 failed | Acceptance open |
| NOV-043 | Create one shared priority policy (`NOV_UPGRADES.md:949`) | 3 · Coordination · `lib/actions/coordination.ts` | 3 passed, 0 failed | Acceptance open |
| NOV-044 | Protect an agreed execution window (`NOV_UPGRADES.md:2131`) | 8 · Execution · `lib/workflow/execution.ts:1` | 3 passed, 0 failed | Acceptance open |
| NOV-045 | Control how much work enters each stage (`NOV_UPGRADES.md:2154`) | 8 · Execution · `lib/workflow/execution.ts:1` | 2 passed, 0 failed | Acceptance open |
| NOV-046 | Agree service expectations between departments (`NOV_UPGRADES.md:971`) | 3 · Coordination · `lib/actions/coordination.ts` | 2 passed, 0 failed | Acceptance open |
| NOV-047 | Assign work using capacity and eligibility together (`NOV_UPGRADES.md:2178`) | 8 · Execution · `lib/workflow/execution.ts:1` | 2 passed, 0 failed | Acceptance open |
| NOV-048 | Identify backup owners before somebody is absent (`NOV_UPGRADES.md:993`) | 3 · Coordination · `lib/actions/coordination.ts` | 4 passed, 0 failed | Acceptance open |
| NOV-049 | Run daily coordination from live records (`NOV_UPGRADES.md:1015`) | 3 · Coordination · `lib/actions/coordination.ts` | 3 passed, 0 failed | Acceptance open |
| NOV-050 | Make requests between teams trackable (`NOV_UPGRADES.md:1038`) | 3 · Coordination · `lib/actions/coordination.ts` | 4 passed, 0 failed | Acceptance open |
| NOV-051 | Agree what done means for every important step (`NOV_UPGRADES.md:1783`) | 4 · Operations control · `lib/workflow/operations-control.ts:1` | 2 passed, 0 failed | Acceptance open |
| NOV-052 | Use approved workflow paths for different order types (`NOV_UPGRADES.md:2201`) | 8 · Execution · `lib/workflow/execution.ts:1` | 2 passed, 0 failed | Acceptance open |
| NOV-053 | Give recurring problems a permanent improvement owner (`NOV_UPGRADES.md:1371`) | 7 · Improvement · `lib/workflow/improvement.ts:1` | 5 passed, 0 failed | Acceptance open |
| NOV-054 | Measure team outcomes with useful context (`NOV_UPGRADES.md:1393`) | 7 · Improvement · `lib/workflow/improvement.ts:1` | 2 passed, 0 failed | Acceptance open |
| NOV-055 | Connect training to demonstrated work (`NOV_UPGRADES.md:1193`) | 5 · Assurance · `lib/workflow/assurance.ts:1` | 1 passed, 0 failed | Acceptance open |
| NOV-056 | Assign ownership of important master data (`NOV_UPGRADES.md:1060`) | 3 · Coordination · `lib/actions/coordination.ts` | 4 passed, 0 failed | Acceptance open |
| NOV-057 | Make process changes reach the people doing work (`NOV_UPGRADES.md:1806`) | 4 · Operations control · `lib/workflow/operations-control.ts:1` | 2 passed, 0 failed | Acceptance open |
| NOV-058 | Close orders through a coordinated final review (`NOV_UPGRADES.md:1992`) | 6 · Lifecycle · `lib/workflow/lifecycle.ts:1` | 6 passed, 0 failed | Acceptance open |
| NOV-059 | Give employees a practical improvement channel (`NOV_UPGRADES.md:1415`) | 7 · Improvement · `app/(dashboard)/tasks/improvement/new/page.tsx:17` | 4 passed, 0 failed | Acceptance open |
| NOV-060 | Review the whole journey with the people involved (`NOV_UPGRADES.md:744`) | 6 · Lifecycle · `lib/workflow/lifecycle.ts:1` | 2 passed, 0 failed | Acceptance open |
| NOV-061 | Turn customer purchase orders into reviewable drafts (`NOV_UPGRADES.md:2585`) | 10 · Specialist · `lib/workflow/specialist.ts:1` | 3 passed, 0 failed | Steps 1 to 6 for pasted text; file upload and OCR are not built |
| NOV-062 | Manage drawing approval as a complete workflow (`NOV_UPGRADES.md:1830`) | 5 · Assurance · `app/(dashboard)/documents/intelligence/page.tsx:337` | 3 passed, 0 failed | Acceptance open |
| NOV-063 | Track samples and first-piece approvals (`NOV_UPGRADES.md:2015`) | 6 · Lifecycle · `lib/workflow/lifecycle.ts:1` | 3 passed, 0 failed | Acceptance open |
| NOV-064 | Apply quantity-based pricing and minimum charges (`NOV_UPGRADES.md:2224`) | 9 · Commercial · `lib/workflow/commercial.ts:1` | 7 passed, 0 failed | Acceptance open |
| NOV-065 | Maintain a die and tooling commercial account (`NOV_UPGRADES.md:2317`) | 10 · Specialist · `lib/workflow/specialist.ts:1` | 2 passed, 0 failed | Steps 1 to 4; step 5 shown in the die lookup only, not yet in quotation or gate-pass screens |
| NOV-066 | Understand why quotations are won or lost (`NOV_UPGRADES.md:1526`) | 9 · Commercial · `lib/workflow/commercial.ts:1` | 2 passed, 0 failed | Acceptance open |
| NOV-067 | Handle stock transfers between warehouses properly (`NOV_UPGRADES.md:2340`) | 10 · Specialist · `lib/workflow/specialist.ts:1` | 3 passed, 0 failed | Steps 1 to 5 for whole bundles; splitting a bundle is not built |
| NOV-068 | Split and combine physical bundles with traceability (`NOV_UPGRADES.md:2464`) | 6 · Lifecycle · `lib/workflow/lifecycle.ts:1` | 5 passed, 0 failed | Acceptance open |
| NOV-069 | Give incoming material an acceptance workflow (`NOV_UPGRADES.md:1853`) | 5 · Assurance · `lib/workflow/assurance.ts:1` | 4 passed, 0 failed | Acceptance open |
| NOV-070 | Link inspection results to measuring equipment (`NOV_UPGRADES.md:1215`) | 5 · Assurance · `lib/workflow/assurance.ts:1` | 2 passed, 0 failed | Acceptance open |
| NOV-071 | Track external laboratory testing (`NOV_UPGRADES.md:1548`) | 10 · Specialist · `lib/workflow/specialist.ts:1` | 2 passed, 0 failed | Acceptance open |
| NOV-072 | Manage ageing or heat-treatment batches (`NOV_UPGRADES.md:2363`) | 10 · Specialist · `lib/workflow/specialist.ts:1` | 3 passed, 0 failed | Acceptance open |
| NOV-073 | Control finish and shade references across repeat orders (`NOV_UPGRADES.md:1570`) | 10 · Specialist · `lib/workflow/specialist.ts:1` | 2 passed, 0 failed | Steps 1 to 4 within the hub; packing and load screens do not yet show the flags |
| NOV-074 | Add a complete weighbridge transaction workflow (`NOV_UPGRADES.md:2657`) | 10 · Specialist · `lib/workflow/specialist.ts:1` | 3 passed, 0 failed | Acceptance open |
| NOV-075 | Manage delivery appointments and site readiness (`NOV_UPGRADES.md:1437`) | 8 · Execution · `lib/workflow/execution.ts:1` | 3 passed, 0 failed | Acceptance open |
| NOV-076 | Record partial acceptance and delivery exceptions (`NOV_UPGRADES.md:1876`) | 5 · Assurance · `lib/workflow/assurance.ts:1` | 3 passed, 0 failed | Acceptance open |
| NOV-077 | Track returnable gate passes and custody (`NOV_UPGRADES.md:1459`) | 8 · Execution · `components/modules/execution/die-custody-note.tsx:9` | 3 passed, 0 failed | Acceptance open |
| NOV-078 | Manage supplier claims through to recovery (`NOV_UPGRADES.md:2247`) | 9 · Commercial · `lib/workflow/commercial.ts:1` | 4 passed, 0 failed | Acceptance open |
| NOV-079 | Generate customer-specific packing instructions and labels (`NOV_UPGRADES.md:2038`) | 6 · Lifecycle · `lib/workflow/lifecycle.ts:1` | 4 passed, 0 failed | Acceptance open |
| NOV-080 | Provide a controlled automation workbench (`NOV_UPGRADES.md:2609`) | 10 · Specialist · `lib/workflow/specialist.ts:1` | 2 passed, 0 failed | Steps 1 to 3, 5 and 6; step 4 (background outbox runner with leases and retries) is not built: a person starts each reviewed run |
| NOV-081 | Make page headers more compact (`NOV_UPGRADES.md:450`) | 6 · Lifecycle · `components/layout/page-header.tsx:5` | 1 passed, 0 failed | Acceptance open |
| NOV-082 | Offer comfortable and compact display options (`NOV_UPGRADES.md:788`) | 9 · Commercial · `app/globals.css:12` | 2 passed, 0 failed | Acceptance open |
| NOV-083 | Use the same page structure across modules (`NOV_UPGRADES.md:566`) | 1 · Shared controls · `lib/ui/status-presentation.ts` | 2 passed, 0 failed | Acceptance open |
| NOV-084 | Keep the current record identity visible (`NOV_UPGRADES.md:588`) | 1 · Shared controls · `lib/ui/status-presentation.ts` | 4 passed, 0 failed | Acceptance open |
| NOV-085 | Keep important form actions within reach (`NOV_UPGRADES.md:611`) | 1 · Shared controls · `lib/ui/status-presentation.ts` | 2 passed, 0 failed | Acceptance open |
| NOV-086 | Give status colours one consistent meaning (`NOV_UPGRADES.md:385`) | 1 · Shared controls · `lib/ui/status-presentation.ts` | 3 passed, 0 failed | Acceptance open |
| NOV-087 | Show workflow progress visually (`NOV_UPGRADES.md:1482`) | 8 · Execution · `components/modules/execution/progress-strip.tsx:19` | 4 passed, 0 failed | Acceptance open |
| NOV-088 | Make phone cards shorter and more selective (`NOV_UPGRADES.md:633`) | 1 · Shared controls · `lib/ui/status-presentation.ts` | 4 passed, 0 failed | Acceptance open |
| NOV-089 | Standardise quick record previews (`NOV_UPGRADES.md:766`) | 7 · Improvement · `components/modules/operations/module-database-client.tsx:30` | 3 passed, 0 failed | Acceptance open |
| NOV-090 | Keep table headings and identifiers visible (`NOV_UPGRADES.md:472`) | 6 · Lifecycle · `components/data/data-table.tsx:118` | 1 passed, 0 failed | Acceptance open |
| NOV-091 | Make active filters obvious (`NOV_UPGRADES.md:655`) | 1 · Shared controls · `lib/ui/status-presentation.ts` | 6 passed, 0 failed | Acceptance open |
| NOV-092 | Make selection menus easier to distinguish (`NOV_UPGRADES.md:677`) | 1 · Shared controls · `lib/ui/status-presentation.ts` | 3 passed, 0 failed | Acceptance open |
| NOV-093 | Make quantities and amounts easier to compare (`NOV_UPGRADES.md:406`) | 1 · Shared controls · `lib/ui/status-presentation.ts` | 5 passed, 0 failed | Acceptance open |
| NOV-094 | Explain where each field value came from (`NOV_UPGRADES.md:1082`) | 2 · Work Today and record entry · `lib/workflow/record-next-action.ts` | 3 passed, 0 failed | Acceptance open |
| NOV-095 | Place reference information beside task inputs (`NOV_UPGRADES.md:699`) | 2 · Work Today and record entry · `app/(dashboard)/packaging/[id]/edit/page.tsx:12` | 5 passed, 0 failed | Acceptance open |
| NOV-096 | Make validation specific and easy to resolve (`NOV_UPGRADES.md:1104`) | 2 · Work Today and record entry · `lib/workflow/record-next-action.ts` | 5 passed, 0 failed | Acceptance open |
| NOV-097 | Show the consequence of a final action clearly (`NOV_UPGRADES.md:1126`) | 3 · Coordination · `components/modules/assurance/action-center.tsx:12` | 5 passed, 0 failed | Acceptance open |
| NOV-098 | Keep meaningful action results visible (`NOV_UPGRADES.md:1149`) | 3 · Coordination · `components/modules/assurance/action-center.tsx:12` | 11 passed, 0 failed | Acceptance open |
| NOV-099 | Give empty and unavailable screens useful explanations (`NOV_UPGRADES.md:428`) | 1 · Shared controls · `lib/ui/status-presentation.ts` | 6 passed, 0 failed | Acceptance open |
| NOV-100 | Make accessibility practical for everyday factory use (`NOV_UPGRADES.md:1171`) | 2 · Work Today and record entry · `lib/workflow/record-next-action.ts` | 5 passed, 1 failed | Acceptance open |

### Cross-cutting results

- NOV-017 connects scans to tasks in the workflow. MFA-009 separately reproduces camera capture denial at the global browser policy.
- The preview/commit groups use server actions and versioned command payloads. Fingerprint, independent reviewer, stale input and replay checks vary by command. See the JSON for actual case names and the cross-module report for missing multi-session cases.
- Separate-account and advisory scope matters. NOV-032 avoids posting customer-owned metal into ordinary billet stock, and production consumption posting remains deferred in that delivered slice. NOV-024 planning scenarios remain advisory. NOV-080 supports reviewed/manual internal execution within its scope and defers a background lease/retry runner.
- PO parsing (NOV-061) covers pasted text. File ingestion and OCR remain beyond the documented slice. NOV-067 covers whole-bundle transfers, distinct from the split/merge workflow in NOV-068. External weighing hardware and approved calibration are separate acceptance evidence.
- Hosted migrations are grouped and split under server-generated IDs. The [ledger comparison](07_DATABASE_AND_MIGRATION_AUDIT.md) gives group presence. No feature receives hosted acceptance from a matching name.

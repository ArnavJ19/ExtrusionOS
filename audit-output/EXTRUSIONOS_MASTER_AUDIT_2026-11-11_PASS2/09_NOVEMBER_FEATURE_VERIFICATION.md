# November Feature Verification (NOV-001 to NOV-100)

HEAD `a0ef08d`. This is an evidence index per catalogue ID, generated from the full-suite log of this pass ([test.log](evidence/test.log)) and the source tree ([generator](evidence/nov-coverage.mjs), [data](evidence/nov-coverage.json)).

**What it establishes.** Every ID has at least one passing test that names it. 84 IDs have a test file that drives the real SQL through the replayed migration chain as a low-privilege role, and 57 have a mounted-browser fixture. Two IDs (NOV-002, NOV-100) have failing tests (PA2-015).

**What it does not establish.** No November feature was used by a signed-in person against real Auth, Storage or plant data in this pass. I did not individually re-derive three edge cases per feature; where the status says "suite", the claim rests on the existing tests, whose quality is assessed in [10](10_TEST_AND_PERFORMANCE_REPORT.md). The hosted database carries the same function bodies as the repo (see [07](07_DATABASE_AND_MIGRATION_AUDIT.md)), so SQL-level results carry over to hosted; UI results do not.

Evidence levels: **S** SQL behaviour test through the migration chain · **B** mounted browser fixture · **U** unit or logic test · **T** source-text assertion only.

| ID | Catalogue title | Named tests pass / fail | Evidence | Status |
|---|---|---|---|---|
| NOV-001 | Make My Work Today the main working screen | 7 / 0 | S B U | Suite-verified at SQL level; operator acceptance open |
| NOV-002 | Give each employee a small relevant workspace | 2 / 2 | B U | Failing test (PA2-015) |
| NOV-003 | Make search usable directly from every screen | 5 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-004 | Put one clear next action on each record | 2 / 0 | S U | Suite-verified at SQL level; operator acceptance open |
| NOV-005 | Finish the connected order workspace | 6 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-006 | Show only fields needed at the current stage | 5 / 0 | S B U | Suite-verified at SQL level; operator acceptance open |
| NOV-007 | Carry known information through the entire process | 2 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-008 | Use sensible visible defaults | 2 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-009 | Extend Repeat Previous beyond quotations | 3 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-010 | Create missing master records without leaving the task | 1 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-011 | Make repeated line entry work like a spreadsheet | 3 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-012 | Ask employees for the quantity they actually know | 12 / 0 | S B U | Suite-verified at SQL level; operator acceptance open |
| NOV-013 | Extend dependable drafts to every lengthy form | 3 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-014 | Allow small updates directly from work queues | 4 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-015 | Make department handoffs part of completing work | 4 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-016 | Turn blockers into actionable instructions | 3 / 0 | B U | Suite-verified at UI or unit level only; SQL and operator acceptance open |
| NOV-017 | Make QR scanning lead directly into the relevant task | 4 / 0 | S B T | Suite-verified at SQL level; operator acceptance open |
| NOV-018 | Expand focused phone workflows for factory work | 15 / 0 | S B U | Suite-verified at SQL level; operator acceptance open |
| NOV-019 | Keep documents and communication beside the transaction | 3 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-020 | Remove double entry between operations accounts and equipment | 4 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-021 | Check delivery feasibility before promising a date | 5 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-022 | Turn material shortages into a purchasing plan | 2 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-023 | Suggest compatible production runs and their sequence | 2 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-024 | Add a what happens if planning tool | 5 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-025 | Give every die a useful operating history | 2 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-026 | Connect maintenance directly to production capacity | 2 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-027 | Trace material from source to customer | 3 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-028 | Track work in progress by physical location and age | 3 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-029 | Manage reusable remnants and excess production | 5 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-030 | Introduce a cycle-counting workflow | 3 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-031 | Maintain a material account for each finishing vendor | 2 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-032 | Support customer-owned metal and job-work settlement | 2 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-033 | Generate a complete quality document pack | 2 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-034 | Show consequences of an order revision | 2 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-035 | Compare estimated and actual job profitability | 3 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-036 | Plan a vehicle load across multiple orders | 3 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-037 | Support blanket orders with scheduled releases | 2 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-038 | Manage a return through final resolution | 2 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-039 | Measure supplier and finishing-vendor reliability | 2 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-040 | Give accounts a collection workflow with payment commitments | 4 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-041 | Give every order one accountable coordinator | 3 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-042 | Define what each role can decide independently | 3 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-043 | Create one shared priority policy | 3 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-044 | Protect an agreed execution window | 3 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-045 | Control how much work enters each stage | 2 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-046 | Agree service expectations between departments | 2 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-047 | Assign work using capacity and eligibility together | 2 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-048 | Identify backup owners before somebody is absent | 4 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-049 | Run daily coordination from live records | 2 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-050 | Make requests between teams trackable | 3 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-051 | Agree what done means for every important step | 2 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-052 | Use approved workflow paths for different order types | 2 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-053 | Give recurring problems a permanent improvement owner | 5 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-054 | Measure team outcomes with useful context | 2 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-055 | Connect training to demonstrated work | 1 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-056 | Assign ownership of important master data | 3 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-057 | Make process changes reach the people doing work | 2 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-058 | Close orders through a coordinated final review | 6 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-059 | Give employees a practical improvement channel | 4 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-060 | Review the whole journey with the people involved | 2 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-061 | Turn customer purchase orders into reviewable drafts | 3 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-062 | Manage drawing approval as a complete workflow | 3 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-063 | Track samples and first-piece approvals | 3 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-064 | Apply quantity-based pricing and minimum charges | 7 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-065 | Maintain a die and tooling commercial account | 2 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-066 | Understand why quotations are won or lost | 2 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-067 | Handle stock transfers between warehouses properly | 3 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-068 | Split and combine physical bundles with traceability | 5 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-069 | Give incoming material an acceptance workflow | 4 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-070 | Link inspection results to measuring equipment | 2 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-071 | Track external laboratory testing | 2 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-072 | Manage ageing or heat-treatment batches | 3 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-073 | Control finish and shade references across repeat orders | 2 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-074 | Add a complete weighbridge transaction workflow | 3 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-075 | Manage delivery appointments and site readiness | 3 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-076 | Record partial acceptance and delivery exceptions | 3 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-077 | Track returnable gate passes and custody | 3 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-078 | Manage supplier claims through to recovery | 4 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-079 | Generate customer-specific packing instructions and labels | 4 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-080 | Provide a controlled automation workbench | 2 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-081 | Make page headers more compact | 1 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-082 | Offer comfortable and compact display options | 2 / 0 | B U | Suite-verified at UI or unit level only; SQL and operator acceptance open |
| NOV-083 | Use the same page structure across modules | 2 / 0 | B | Suite-verified at UI or unit level only; SQL and operator acceptance open |
| NOV-084 | Keep the current record identity visible | 4 / 0 | B | Suite-verified at UI or unit level only; SQL and operator acceptance open |
| NOV-085 | Keep important form actions within reach | 1 / 0 | B | Suite-verified at UI or unit level only; SQL and operator acceptance open |
| NOV-086 | Give status colours one consistent meaning | 3 / 0 | B U | Suite-verified at UI or unit level only; SQL and operator acceptance open |
| NOV-087 | Show workflow progress visually | 4 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-088 | Make phone cards shorter and more selective | 4 / 0 | B | Suite-verified at UI or unit level only; SQL and operator acceptance open |
| NOV-089 | Standardise quick record previews | 3 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-090 | Keep table headings and identifiers visible | 1 / 0 | S | Suite-verified at SQL level; operator acceptance open |
| NOV-091 | Make active filters obvious | 6 / 0 | B U | Suite-verified at UI or unit level only; SQL and operator acceptance open |
| NOV-092 | Make selection menus easier to distinguish | 3 / 0 | B U | Suite-verified at UI or unit level only; SQL and operator acceptance open |
| NOV-093 | Make quantities and amounts easier to compare | 4 / 0 | U | Suite-verified at UI or unit level only; SQL and operator acceptance open |
| NOV-094 | Explain where each field value came from | 3 / 0 | B U | Suite-verified at UI or unit level only; SQL and operator acceptance open |
| NOV-095 | Place reference information beside task inputs | 5 / 0 | B | Suite-verified at UI or unit level only; SQL and operator acceptance open |
| NOV-096 | Make validation specific and easy to resolve | 5 / 0 | U | Suite-verified at UI or unit level only; SQL and operator acceptance open |
| NOV-097 | Show the consequence of a final action clearly | 5 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-098 | Keep meaningful action results visible | 11 / 0 | S B | Suite-verified at SQL level; operator acceptance open |
| NOV-099 | Give empty and unavailable screens useful explanations | 6 / 0 | B U | Suite-verified at UI or unit level only; SQL and operator acceptance open |
| NOV-100 | Make accessibility practical for everyday factory use | 4 / 1 | B | Failing test (PA2-015) |

## Command protocol (preview, review, commit)

The November command RPCs were swept as a signed-in account with no staff row, a suspended user and a viewer. 168 of 176 privileged functions refuse the first two with a permission error before doing anything; the other 8 fail on argument validation or return an empty value ([rpc-sweep.log](evidence/rpc-sweep.log)). Stale-fingerprint, expiry and second-person rules are covered by the SQL tests marked S above. I did not add independent two-session tests for them, so concurrent preview and commit by two people remains suite-level evidence.

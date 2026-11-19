# Module Coverage Matrix

The rows are grouped by Next.js route family. The machine inventory records each route, static imports, components, service libraries, literal database references, migration origins and test-file candidates. Imports are followed up to three steps. A reference is a navigation aid and may be indirect. Dynamic RPC names, global layouts, and SQL objects created or replaced through dynamic statements require independent source or catalog review.

[Machine-readable modules](evidence/module-inventory.json) · [Routes](evidence/routes.json) · [Dependency graph](evidence/dependency-index.json) · [Migration object index](evidence/sql-object-index.json)

| Module | Routes | DB references | Candidate test files | Audit status |
|---|---:|---:|---:|---|
| `ai` | 1 | 1 | 9 | Inventoried. Independent functional, permission and operator acceptance open. |
| `analytics` | 1 | 2 | 2 | Inventoried. Independent functional, permission and operator acceptance open. |
| `api/access` | 3 | 10 | 4 | Invitation and role request surfaces inventoried. Selected grant and policy tests reviewed. |
| `api/ai` | 1 | 8 | 9 | Inventoried. Independent functional, permission and operator acceptance open. |
| `api/collaboration-workflows` | 1 | 2 | 3 | Inventoried. Independent functional, permission and operator acceptance open. |
| `api/crm` | 1 | 2 | 0 | Inventoried. Independent functional, permission and operator acceptance open. |
| `api/cron` | 1 | 1 | 0 | Cron registry and secret-presence contract reviewed. Hosted cron delivery and alerts open. |
| `api/cutover` | 1 | 3 | 0 | Inventoried. Independent functional, permission and operator acceptance open. |
| `api/dealer-inventory` | 1 | 5 | 0 | Inventoried. Independent functional, permission and operator acceptance open. |
| `api/dealer-orders` | 4 | 9 | 0 | Inventoried. Independent functional, permission and operator acceptance open. |
| `api/discrepancies` | 1 | 6 | 0 | Inventoried. Independent functional, permission and operator acceptance open. |
| `api/email` | 1 | 1 | 1 | Inventoried. Independent functional, permission and operator acceptance open. |
| `api/enterprise` | 1 | 2 | 1 | Inventoried. Independent functional, permission and operator acceptance open. |
| `api/master-import` | 3 | 3 | 0 | Inventoried. Independent functional, permission and operator acceptance open. |
| `api/operator-workflows` | 1 | 2 | 3 | Inventoried. Independent functional, permission and operator acceptance open. |
| `api/payments` | 1 | 6 | 1 | Inventoried. Independent functional, permission and operator acceptance open. |
| `api/pdf` | 6 | 23 | 4 | Commercial lineage and document fixtures reviewed. Signed-in artifact and storage acceptance open. |
| `api/portal` | 1 | 1 | 0 | Inventoried. Independent functional, permission and operator acceptance open. |
| `api/qr-codes` | 1 | 2 | 0 | Inventoried. Independent functional, permission and operator acceptance open. |
| `api/reports` | 1 | 4 | 5 | Inventoried. Independent functional, permission and operator acceptance open. |
| `api/shipments` | 1 | 8 | 0 | Inventoried. Independent functional, permission and operator acceptance open. |
| `api/tasks` | 1 | 4 | 8 | Inventoried. Independent functional, permission and operator acceptance open. |
| `audit-logs` | 1 | 2 | 0 | Inventoried. Independent functional, permission and operator acceptance open. |
| `auth` | 6 | 3 | 0 | Signup, session context, suspension and onboarding source reviewed. Hosted guard and grant observed. Auth-provider policy open. |
| `automation` | 2 | 4 | 0 | Scheduled jobs and controlled automation scopes distinguished. Registry regression and hosted execution acceptance open. |
| `barcode` | 1 | 3 | 0 | Inventoried. Independent functional, permission and operator acceptance open. |
| `command-center` | 1 | 15 | 1 | Inventoried. Independent functional, permission and operator acceptance open. |
| `communications` | 1 | 5 | 2 | Inventoried. Independent functional, permission and operator acceptance open. |
| `compliance` | 1 | 4 | 1 | Inventoried. Independent functional, permission and operator acceptance open. |
| `crm` | 1 | 5 | 0 | Inventoried. Independent functional, permission and operator acceptance open. |
| `customers` | 13 | 69 | 7 | Inventoried. Independent functional, permission and operator acceptance open. |
| `dashboard` | 1 | 8 | 0 | Snapshot read and display traced. Reservation and malformed-payload issues reproduced. |
| `dealer-inventory` | 1 | 4 | 0 | Receipt and fulfillable stock sources traced. A signed dealer balance bridge is open. |
| `dealer-orders` | 5 | 16 | 0 | Dealer route/projection and overview cap reviewed. Fulfillment accounting acceptance open. |
| `die-intelligence` | 1 | 6 | 0 | Inventoried. Independent functional, permission and operator acceptance open. |
| `dies` | 6 | 38 | 3 | Inventoried. Independent functional, permission and operator acceptance open. |
| `discrepancies` | 1 | 2 | 0 | Inventoried. Independent functional, permission and operator acceptance open. |
| `dispatches` | 10 | 76 | 0 | Readiness, reservation consumption and billing handoffs traced. Dedicated rollback and concurrency acceptance open. |
| `documents` | 2 | 3 | 2 | Inventoried. Independent functional, permission and operator acceptance open. |
| `energy` | 1 | 3 | 0 | Inventoried. Independent functional, permission and operator acceptance open. |
| `expenses` | 11 | 61 | 2 | Approval and payment fixtures reviewed. Supplier/GL reconciliation open. |
| `exports` | 1 | 2 | 1 | Inventoried. Independent functional, permission and operator acceptance open. |
| `foundry` | 23 | 71 | 4 | Charge, cast, chemistry and billet issue traced. Cast and chemistry defects reproduced. |
| `home` | 1 | 0 | 0 | Inventoried. Independent functional, permission and operator acceptance open. |
| `inventory` | 9 | 78 | 1 | Stock balance and reservation projection compared. Physical and historical reconciliation open. |
| `invoices` | 10 | 32 | 6 | Source fingerprint, approval and retained dispatch invoice boundary traced. External accounting sign-off open. |
| `machines` | 6 | 74 | 3 | Inventoried. Independent functional, permission and operator acceptance open. |
| `maintenance` | 1 | 20 | 0 | Inventoried. Independent functional, permission and operator acceptance open. |
| `mobile` | 8 | 22 | 3 | Scan entry traced and selected workstation browser interactions executed. Full mobile route acceptance open. |
| `notifications` | 3 | 4 | 3 | Inventoried. Independent functional, permission and operator acceptance open. |
| `orders` | 9 | 101 | 11 | Quote conversion, demand, material and shipment handoffs traced. Full lifecycle acceptance open. |
| `packaging` | 15 | 59 | 1 | Packaging evidence and dispatch joins traced. Separate material purchase/usage reconciliation open. |
| `payments` | 6 | 17 | 1 | Receipt matching and import tested. Two candidate bank-import defects reproduced. |
| `portal` | 5 | 7 | 0 | Projection and route boundaries reviewed. Signed-in customer/record ownership and Storage acceptance open. |
| `production` | 23 | 102 | 17 | Ordinary completion and press-floor fixture exercised. Partial-issue defect reproduced. |
| `profiles` | 7 | 59 | 4 | Inventoried. Independent functional, permission and operator acceptance open. |
| `profitability` | 1 | 2 | 0 | Inventoried. Independent functional, permission and operator acceptance open. |
| `quality` | 12 | 77 | 1 | Specification and release gates reviewed. Approved master data and plant acceptance open. |
| `quotes` | 9 | 54 | 19 | Quote formula control case and approval test evidence. Issued-document scenarios remain a release gate. |
| `report-builder` | 1 | 4 | 2 | Inventoried. Independent functional, permission and operator acceptance open. |
| `reports` | 1 | 0 | 5 | Inventoried. Independent functional, permission and operator acceptance open. |
| `scan` | 1 | 3 | 0 | Chromium denied camera under the configured policy. Manual scan and role acceptance open. |
| `search` | 1 | 8 | 4 | Inventoried. Independent functional, permission and operator acceptance open. |
| `settings` | 11 | 45 | 0 | Feature flags, access and bootstrap configuration sampled. Per-control policy acceptance open. |
| `shipments` | 1 | 3 | 0 | Receipt and shortage integration traced. Full accepted-stock and claim closure acceptance open. |
| `systems-configurator` | 16 | 34 | 1 | Versioned rules, BOM and release snapshot tested at fixture level. Approved system dimensions and production handoff acceptance open. |
| `tasks` | 68 | 31 | 8 | November command hubs and test coverage inventoried. Overview cap and retained workflows require separate checks. |
| `tenders` | 1 | 3 | 0 | Inventoried. Independent functional, permission and operator acceptance open. |
| `vendors` | 14 | 67 | 0 | Procurement and vendor custody model reviewed. Full physical and payables acceptance open. |

Route-specific entry and API verbs appear in the [operator route index](08_UI_UX_AND_OPERATOR_AUDIT.md). Across the matrix, deployment mapping applies to the release as a whole. It does not certify any module on that release.

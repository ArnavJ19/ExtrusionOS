# Module Coverage Matrix

HEAD `a0ef08d`. One row per dashboard route family, plus API, Auth and portal. The test-file column counts test files whose name mentions the family (a heuristic, so shared suites such as the November batches are undercounted). "This pass" states what this audit independently executed; "Suite + static only" means the module rests on the existing suite and source reading. Signed-in browser use against a real Auth backend was not possible for any module (see [08](08_UI_UX_AND_OPERATOR_AUDIT.md)).

| Module | Pages | Test files (SQL / browser / text-only) | This pass | Evidence or finding | Hosted and operator verification |
|---|---|---|---|---|---|
| ai | 1 | 9 (5 / 0 / 0) | Suite + static only |  | Not verified |
| analytics | 1 | 2 (0 / 0 / 1) | Suite + static only |  | Not verified |
| audit-logs | 1 | 0 (0 / 0 / 0) | Suite + static only |  | Not verified |
| automation | 2 | 0 (0 / 0 / 0) | Suite + static only |  | Not verified |
| barcode | 1 | 0 (0 / 0 / 0) | Suite + static only |  | Not verified |
| command-center | 1 | 1 (0 / 0 / 0) | Suite + static only |  | Not verified |
| communications | 1 | 3 (2 / 0 / 0) | Suite + static only |  | Not verified |
| compliance | 1 | 1 (0 / 0 / 0) | Suite + static only |  | Not verified |
| crm | 1 | 0 (0 / 0 / 0) | Suite + static only |  | Not verified |
| customers | 13 | 7 (5 / 1 / 1) | RLS and delete probes | Cross-company, viewer delete, FK restrict verified | Not verified |
| dashboard | 1 | 0 (0 / 0 / 0) | Fix verified + defect | Reserved-kg fix verified (MFA-005); PA2-012 malformed payload | Not verified |
| dealer-inventory | 1 | 0 (0 / 0 / 0) | RLS probes only | Dealer isolation probes; PA2-016 staff directory visible | Not verified |
| dealer-orders | 5 | 0 (0 / 0 / 0) | Strongly supported | MFA-012 capped overview; dealer RLS probes | Not verified |
| die-intelligence | 1 | 0 (0 / 0 / 0) | Suite + static only |  | Not verified |
| dies | 6 | 3 (3 / 0 / 0) | Suite + static only |  | Not verified |
| discrepancies | 1 | 0 (0 / 0 / 0) | Suite + static only |  | Not verified |
| dispatches | 10 | 0 (0 / 0 / 0) | Delete guard verified | Dispatched record delete refused; stock races not independently run | Not verified |
| documents | 2 | 2 (0 / 0 / 0) | Reproduced defect (policy level) | PA2-005 storage role gap | Not verified |
| energy | 1 | 0 (0 / 0 / 0) | Suite + static only |  | Not verified |
| expenses | 11 | 2 (1 / 0 / 0) | Suite + static only |  | Not verified |
| exports | 1 | 1 (0 / 0 / 1) | Suite + static only |  | Not verified |
| foundry | 23 | 4 (0 / 0 / 1) | Reproduced defects | PA2-002 cast mass, PA2-003 chemistry | Not verified |
| inventory | 9 | 1 (0 / 0 / 0) | Fix verified | Stock snapshot reserved basis; packaging split PA2-007 | Not verified |
| invoices | 12 | 8 (3 / 0 / 1) | Independently verified (receipt side) | Direct-write and delete refusal; GST and statutory acceptance open | Not verified |
| machines | 6 | 3 (2 / 0 / 0) | Suite + static only |  | Not verified |
| maintenance | 1 | 0 (0 / 0 / 0) | Suite + static only |  | Not verified |
| mobile | 8 | 3 (1 / 0 / 1) | Defect (config) | PA2-008 camera blocked on mobile scan | Not verified |
| notifications | 3 | 3 (0 / 0 / 2) | Suite + static only |  | Not verified |
| orders | 10 | 14 (5 / 1 / 3) | Strongly supported | MFA-013 credit gate; cross-company RLS probes | Not verified |
| packaging | 15 | 1 (1 / 0 / 0) | Reproduced defect | PA2-007 packaging purchase vs consumption balance | Not verified |
| payments | 8 | 1 (1 / 0 / 0) | Independently verified | Receipt writer: two-session races, idempotency, reversal, roles (finance-probes.log) | Not verified |
| production | 24 | 17 (5 / 1 / 2) | Reproduced defect | PA2-004 partial-issue completion | Not verified |
| profiles | 7 | 4 (0 / 0 / 1) | Suite + static only |  | Not verified |
| profitability | 1 | 0 (0 / 0 / 0) | Suite + static only |  | Not verified |
| quality | 12 | 1 (0 / 0 / 0) | Suite + static only |  | Not verified |
| quotes | 9 | 19 (2 / 2 / 3) | Independently verified + defects | 600-case TS/SQL differential; PA2-010, PA2-017, PA2-018, PA2-022 | Not verified |
| report-builder | 1 | 2 (0 / 0 / 1) | Suite + static only |  | Not verified |
| reports | 1 | 6 (2 / 0 / 1) | Reproduced defect (policy level) | PA2-005 reports bucket open to any company user | Not verified |
| scan | 1 | 0 (0 / 0 / 0) | Defect (config) | PA2-008 camera blocked by Permissions-Policy | Not verified |
| search | 1 | 4 (1 / 0 / 1) | Suite + static only |  | Not verified |
| settings | 12 | 0 (0 / 0 / 0) | Reproduced defect | PA2-001 (no suspend/role change; app_users UPDATE recursion); RLS probes | Not verified |
| shipments | 1 | 0 (0 / 0 / 0) | Suite + static only |  | Not verified |
| systems-configurator | 16 | 1 (1 / 0 / 0) | Suite + unlisted tests | 14 unlisted tests pass (PA2-023); engineering values not independently derived | Not verified |
| tasks | 68 | 9 (5 / 2 / 0) | Strongly supported + failing tests | MFA-012 capped overview; PA2-015 NOV-002 pin tests fail | Not verified |
| tenders | 1 | 0 (0 / 0 / 0) | Suite + static only |  | Not verified |
| vendors | 14 | 0 (0 / 0 / 0) | Suite + static only |  | Not verified |
| api (route handlers) | 32 routes | n/a | Static review of every route | Each route authenticates through a session helper or server action, except invite acceptance (token) and cron (bearer secret). PA2-026 | Not verified |
| auth (login, invite, onboarding) | 6 | n/a | Reproduced + hosted metadata | PA2-009 onboarding drift; PA2-013 signed-out deep link; invite acceptance read | Provider sign-up setting not readable |
| portal | 5 | n/a | RPC sweep only | portal_self_service_command refuses non-portal identities | Not verified |

Totals: 339 page files, 32 API routes, 352 test files. Database objects are covered in [07](07_DATABASE_AND_MIGRATION_AUDIT.md).

# Hosted migration reconciliation and application

Completed catalog: 2026-10-20 06:36:50 UTC (20 October 2026, Asia/Kolkata).

Project: `pkawmdxtmsdgigsehcmb` (`https://pkawmdxtmsdgigsehcmb.supabase.co`), matching the local application environment.

## Outcome

**40 migrations were successfully applied and recorded.** The run applied the 35 missing recent files from 10 August through R22, the completed expense/receivables/reporting migrations that arrived during finance work, and two forward repairs discovered during reconciliation. The user explicitly confirmed the expense work was ready; each finance file was reviewed, rehearsed and tested before application. Older scripts already represented or superseded by the current schema were not blindly replayed.

The user's 20 October instruction to inspect and apply missing migrations superseded the earlier no-migrations instruction for this request. The selected app connector required reauthentication, so the existing project-scoped Supabase MCP connection was used after confirming the same project URL. No application deployment, commit, branch merge, database reset, ledger repair or deletion of business records was performed.

| Catalog / invariant | Before | Final |
| --- | ---: | ---: |
| Public business tables | 171 | 175 |
| Public views | 1 | 23 |
| Public/private functions | 172 | 293 |
| Public/private/storage policies | 551 | 600 |
| Migration ledger rows | 44 | 84 |
| Public business tables without RLS | 0 | 0 |
| Orders | 10 | 10 |
| Billets | 48 | 48 |
| Recorded billet weight kg | 13,711.728 | 13,711.728 |
| Expense / payment / supplier-credit rows | 0 / 0 / not yet present | 0 / 0 / 0 |

The order/billet counts and recorded billet-weight sum were checked before and after. This is not an attestation of physical stock or a claim that every business field was compared. The timestamp repair initializes five maintenance columns; it does not reconstruct historical edit dates.

## History and application decisions

The previous latest recorded migration version was `20260810120125`. The final recorded version is `20261020063338`, for `20261020030000_finance_reporting_integrity`, applied at `2026-10-20 06:33:38 UTC` (`2026-10-20 12:03:38 IST`). Ledger version/name metadata is a history record, not a universal object-creation timestamp.

PostgreSQL's catalog has no general table/policy creation timestamp. Commit timestamp tracking is off, no custom DDL audit table was found, and the retained 24-hour PostgreSQL logs had no matching CREATE TABLE/POLICY/TRIGGER event. A reliable last-object creation timestamp was therefore unavailable. File dates were not used as proof of application.

Current local inventory: **168 SQL files / 156 distinct version identifiers**. The seven collision groups (`0032`, `0034`, `0036`, `0055`, `20260511`, `20260512`, `20260513`) remain historical facts. No historical version was renamed or marked applied without executing it.

- 40 local files were applied in this run and have matching final ledger names.
- 32 local files already had matching hosted names under different execution timestamps.
- 96 older local files still have no corresponding history name. Their expected structural effects are represented or superseded in the inspected schema; their original execution cannot be reconstructed from metadata alone.
- 12 older hosted entries have no matching local filename. Their retained fixes were considered during comparison.
- `foundry_batches.order_id` is deliberately absent: migration 0055 removed it. Reintroducing the column from 0051 would regress the later design.
- The retained hosted `private.save_production_job_atomic` body differs from the old July file and contains subsequent hosted compatibility work. The old function was preserved rather than overwritten merely to make a text comparison pass.
- The old `20260512_audit_fixes.sql` was only partially represented. Its five absent timestamp columns and four maintenance triggers were applied through an additive forward migration, preserving newer financial policies.

## Applied files

Listed in actual application order. All returned success and were found in the final hosted ledger. Each script used a 5-second lock timeout and a 60-second statement timeout within its transaction.

| # | Local migration file | Hosted version | Applied UTC |
| ---: | --- | --- | --- |
| 1 | `20260810000000_tenant_boundary_and_dealer_workflow_hardening.sql` | `20261020060105` | 2026-10-20 06:01:05 UTC |
| 2 | `20260810010000_manufacturing_reference_and_material_guards.sql` | `20261020060108` | 2026-10-20 06:01:07 UTC |
| 3 | `20260810020000_atomic_dealer_order_creation_and_workflow.sql` | `20261020060110` | 2026-10-20 06:01:09 UTC |
| 4 | `20260810030000_quote_and_order_financial_integrity.sql` | `20261020060112` | 2026-10-20 06:01:12 UTC |
| 5 | `20260810040000_storage_and_catalog_policy_alignment.sql` | `20261020060114` | 2026-10-20 06:01:14 UTC |
| 6 | `20260810050000_factory_queue_weight_runtime_fix.sql` | `20261020060116` | 2026-10-20 06:01:16 UTC |
| 7 | `20260812000000_security_and_notification_integrity.sql` | `20261020060145` | 2026-10-20 06:01:45 UTC |
| 8 | `20260812010000_dispatch_return_and_manifest_integrity.sql` | `20261020060148` | 2026-10-20 06:01:47 UTC |
| 9 | `20260812020000_invite_acceptance_integrity.sql` | `20261020060150` | 2026-10-20 06:01:49 UTC |
| 10 | `20260812030000_profile_configuration_integrity.sql` | `20261020060152` | 2026-10-20 06:01:52 UTC |
| 11 | `20260918000000_production_source_line_integrity.sql` | `20261020060154` | 2026-10-20 06:01:54 UTC |
| 12 | `20260929000000_business_logic_fixes.sql` | `20261020060157` | 2026-10-20 06:01:57 UTC |
| 13 | `20260930000000_astra_audit_fixes.sql` | `20261020060200` | 2026-10-20 06:01:59 UTC |
| 14 | `20261008000000_foundry_material_integrity.sql` | `20261020060224` | 2026-10-20 06:02:24 UTC |
| 15 | `20261008010000_access_projection_integrity.sql` | `20261020060227` | 2026-10-20 06:02:27 UTC |
| 16 | `20261008020000_factory_workflow_integrity.sql` | `20261020060230` | 2026-10-20 06:02:29 UTC |
| 17 | `20261008030000_configuration_quote_integrity.sql` | `20261020060233` | 2026-10-20 06:02:33 UTC |
| 18 | `20261008040000_management_metrics_integrity.sql` | `20261020060236` | 2026-10-20 06:02:35 UTC |
| 19 | `20261008050000_operation_search_integrity.sql` | `20261020060238` | 2026-10-20 06:02:38 UTC |
| 20 | `20261013000000_audit_workflow_followup.sql` | `20261020060240` | 2026-10-20 06:02:41 UTC |
| 21 | `20261013010000_dealer_fulfillment_integrity.sql` | `20261020060243` | 2026-10-20 06:02:43 UTC |
| 22 | `20261015000000_reservation_release_replay_integrity.sql` | `20261020060333` | 2026-10-20 06:03:33 UTC |
| 23 | `20261015010000_reservation_ledger_projection.sql` | `20261020060335` | 2026-10-20 06:03:35 UTC |
| 24 | `20261015020000_credit_settlement_exclusivity.sql` | `20261020060338` | 2026-10-20 06:03:37 UTC |
| 25 | `20261015030000_credit_note_retry_binding.sql` | `20261020060340` | 2026-10-20 06:03:39 UTC |
| 26 | `20261015040000_direct_priced_orders.sql` | `20261020060342` | 2026-10-20 06:03:42 UTC |
| 27 | `20261015050000_dispatch_reservation_ledger.sql` | `20261020060345` | 2026-10-20 06:03:44 UTC |
| 28 | `20261015060000_order_cancellation_stock_integrity.sql` | `20261020060347` | 2026-10-20 06:03:47 UTC |
| 29 | `20261019000000_retained_dispatch_invoices.sql` | `20261020060425` | 2026-10-20 06:04:25 UTC |
| 30 | `20261019010000_terminal_finishing_evidence.sql` | `20261020060428` | 2026-10-20 06:04:27 UTC |
| 31 | `20261019020000_finishing_accepted_dispositions.sql` | `20261020060430` | 2026-10-20 06:04:30 UTC |
| 32 | `20261019030000_packaging_material_evidence.sql` | `20261020060433` | 2026-10-20 06:04:33 UTC |
| 33 | `20261019040000_finishing_workload_projection.sql` | `20261020060436` | 2026-10-20 06:04:36 UTC |
| 34 | `20261019050000_billet_link_repair_integrity.sql` | `20261020060438` | 2026-10-20 06:04:38 UTC |
| 35 | `20261020060043_reconcile_historical_audit_columns.sql` | `20261020060454` | 2026-10-20 06:04:53 UTC |
| 36 | `20261020000000_manual_billet_requirement_lineage.sql` | `20261020061032` | 2026-10-20 06:10:32 UTC |
| 37 | `20261020010000_expense_ledger_integrity.sql` | `20261020061529` | 2026-10-20 06:15:29 UTC |
| 38 | `20261020061323_close_post_reconciliation_function_grants.sql` | `20261020061532` | 2026-10-20 06:15:32 UTC |
| 39 | `20261020020000_receivables_integrity.sql` | `20261020062956` | 2026-10-20 06:29:56 UTC |
| 40 | `20261020030000_finance_reporting_integrity.sql` | `20261020063338` | 2026-10-20 06:33:38 UTC |

## Repairs and security review

The local catalog replay caught an actual compatibility failure before hosted application: the October factory replacement removed defaults introduced by its August predecessor on `public.transition_dispatch_delivery_atomic`. Its declaration now retains the two optional defaults; its body and signature types are unchanged. The full chain then passed.

Post-apply advisors exposed explicit anonymous grants that survived older `REVOKE FROM PUBLIC` statements. A forward migration revokes PUBLIC/anon/authenticated execution on the two affected trigger-only functions and pins the pure transition helper's search path to `pg_catalog`. Final advisors no longer report anonymous SECURITY DEFINER execution or mutable function search paths.

All 175 public business tables have RLS. The 23 required public RPCs exist, permit authenticated execution and reject anonymous execution. The 14 required columns are present. The 15 deployment-preflight groups confirm the private guards, attached triggers, direct-order request isolation, material ledger restrictions and revised function bodies. R22's shared writer/profile helpers remain closed; its authenticated public delegates remain callable. Expense table mutation is denied to authenticated clients, while its authorized posting RPC is available.

**Remaining advisor findings are recorded, not silently cleared:**

- 22 security-definer views are flagged by Supabase. These are the application's explicit company/role-filtered, security-barrier projections used to mask protected base columns. Their authenticated-only grants and explicit company predicates were inspected, and all 22 return zero rows for a missing SQL session identity. A blanket switch to invoker views would require a separate access-model review because base-column grants are deliberately restricted. See the [Supabase view advisory](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view). This run does not certify the architecture free of all view-related risks.
- 56 authenticated SECURITY DEFINER entry points remain listed for review; authenticated availability is intentional for protected RPCs and does not itself establish correct business authorization for every future input.
- `private.direct_order_requests` has RLS and no policies by design, with client reads/writes revoked.
- Leaked-password protection remains disabled in the Auth configuration, as it was before this run. See [Supabase password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- Performance advisories remain; the migration task did not remove unused indexes or automatically rewrite all historical policies.

## Verification

| Check | Result |
| --- | --- |
| Reconstruction of the before-change catalog in disposable local PostgreSQL | Restored tables, columns, enums, constraints, indexes, functions, policies and non-storage triggers; no hosted business/auth rows copied |
| Ordered replay of the 35 recent files | Passed after retaining dispatch RPC defaults |
| Timestamp repair replay, including a repeated application | Passed |
| Expense + final grant repair replay against the updated catalog | Passed |
| Receivables + reporting replay against the updated catalog | Passed |
| Full `npm test` | **1,553 passed / 76 suites; zero failures, skips or cancellations** |
| Focused finishing and manual allocation/action checks | 95 passed |
| Focused expense SQL/role/tenant/idempotency tests | 18 passed |
| Focused receivables tests | 7 passed |
| Focused finance reporting tests | 5 passed |
| Rechecked affected die / finishing browser / return-credit tests | 31 passed |
| `npm run lint` | Passed on the final code/scripts |
| `npm run typecheck` | Passed |
| `npm run build` | Passed; 154 generated pages |
| Hosted authenticated SQL-role reads | Dashboard, analytics, finishing, reservation ledger and order database RPCs returned objects with server-derived company scope |
| Hosted anonymous direct-order call | Denied |
| Hosted expense workflow, fully rolled back | Created expense, posted payment, replayed exact payment identity and reversed payment successfully |
| Post-rollback financial counts | Zero expense, payment and supplier-credit rows persisted |
| Hosted view checks with missing identity | All 22 protected views returned zero rows |
| Final file/body comparison | No missing recent tables/columns/functions or differing final recent function bodies; only the deliberately removed old foundry column remains a structural difference |
| Final ledger / file inventory | 168 files partitioned exactly once into 40 new applications, 32 historical name matches and 96 represented/superseded unrecorded scripts |

The first two broad test runs had two failing subcases plus their enclosing case because a finishing test tried to replace a generated planned date with the same hard-coded 20 October date. The assertion now changes the stored date by one day; the protection code was unchanged. Focused and final full runs pass.

R22 has 52 SQL/action checks across its two new test files, including both quoted/direct allocation, role/company scope, retained billet identity, deterministic per-profile eligibility, failed late projection rollback, transport rejection and lost-response behavior. The older broad factory fixture no longer invents a `foundry_billets.profile_id` column. Its complete browser/operator journey remains separate. A later broad run exposed outdated browser mock exports and an old caption assertion after concurrent finance UI edits; those adapters were updated without changing product behavior. The affected 31 tests and the final 1,553-test suite pass.

Local empty-catalog replay does not reproduce hosted extensions, real JWT issuance, Storage internals, historical business rows or independent concurrent sessions. Hosted SQL-role probes use an existing owner identity in transaction-local claims; they are not signed-in browser UAT or real-token authentication proof. No complete quotation/direct-order/dispatch/operator journey, physical stock attestation, restore drill, independent-session race test or application deployment is claimed. A00 and workflow acceptance remain OPEN.

## Evidence

- [Current schema overview](CURRENT_DATABASE_SCHEMA_2026-10-20.md).
- [Full completed schema catalog](evidence/schema-completed_2026-10-20.json), [before catalog](evidence/schema-before_2026-10-20.json), and [supporting type/grant metadata](evidence/schema-extras-before_2026-10-20.json). These are metadata snapshots, not a recovery backup.
- [Completed 84-row hosted migration ledger](evidence/migration-ledger-completed_2026-10-20.json).
- [Complete 168-file inventory](evidence/migration-inventory-completed_2026-10-20.csv).
- [Final static definition comparison](evidence/migration-definition-comparison-completed_2026-10-20.json) and [hosted deployment preflight](evidence/hosted-preflight_2026-10-20.json).
- [Workflow/integrity verification](evidence/migration-verification-completed_2026-10-20.json), [view identity checks](evidence/authorized-view-identity-completed_2026-10-20.json), and [final security advisor output](evidence/security-completed_2026-10-20.json).
- Ten `docs/evidence/migration-apply-batchNN_2026-10-20.json` files retain actual per-call outcomes and timestamps.
- Full test output: `test-results/migration-reverified-full.log`. The focused fixtures and audit scripts remain executable for follow-up checks.

## Files changed for this request

Added two small forward migrations, the read-only catalog export, comparison/replay scripts, the R22 action/edge test file, and the inventory/application/schema reports with evidence. Retained the separately authored expense migration/application files; they were reviewed and applied after readiness confirmation. Modified the unapplied factory RPC declaration before application and fixed the date-sensitive test. After the concurrent finance UI added an expense action import, two browser adapters were updated to keep unrelated writes blocked, and a credit-note label assertion now checks the new net-receipt caption. The earlier R22 fixture/candidate work remains in the checkout. Existing unrelated work was preserved; nothing was committed or deployed.

# Migration chain replay — 22 October 2026

A fresh database can now be built from `supabase/schema.sql`, `supabase/rls.sql` and every file in `supabase/migrations/` in plain file-name order: **219/219 files apply** with zero failures (2 baseline files + 217 migrations, after the follow-up below).

```bash
node scripts/replay-migration-chain.mjs
```

`tests/migration-chain-replay.test.mjs` runs the same rebuild in the standard test suite and checks that every migration version is a unique 14-digit number.

## Why the rebuild used to fail

Version prefixes were mixed (`0006`–`0059`, `20260511`–`20260514`, then 14-digit timestamps). In file order, the `00xx` block ran before the `202605xx` files whose tables it depends on (`invoices`, `vendors`, `production_jobs`, `machines`, `tasks` …), so 108 of 220 files failed. Seven versions were also shared by two files each.

## What changed

1. **Renamed 70 pre-June files** to unique 14-digit versions in dependency order. The hosted ledger never recorded these files under their original versions (only `0012`, `0036_phase_5…` and `0059` appear, under different version numbers), so the rename does not affect hosted migration history.
   - `202605xx` files keep their dates; `audit_fixes` moves after `phase3_operational_depth`, which creates `machines`.
   - `00xx` files become `20260515<old number><00|01>`, so files that shared a number stay in their previous order.
   - `20260514_core_dealer_improvements` moves after the `00xx` block (it needs `dealers`).
   - `0058_production_plan_slots` moves to `20260722000000`. Git shows it was added on 22 July, and the live database's foreign-key index names show `production_plan_slots` was created after `20260721091224_performance_fk_indexes`.
2. **Five fixes inside historical files.** Each one makes the file runnable on a fresh database. None of them changes any live object.
   - `20260516000000_core_dealer_improvements`: `$function` → `$function$` (invalid dollar quoting).
   - `20260515000600_enterprise_phase_1`: seed `plan_type` values lowercased to satisfy `subscription_plans_type_check`. `ON CONFLICT DO NOTHING` then keeps the `20260513` rows, matching the live database.
   - `20260515003401_security_audit_fixes`: `drop policy if exists` before re-creating `"app users update admin non self"` (already created by `rls.sql`).
   - `20260530000000_packaging_multiple_materials`: also drops the `refresh_packaging_job_material` trigger, which depends on the `material_id` column being dropped. The live database has no such trigger.
   - Removed UTF-8 byte-order marks from `20260718020000` and `20260718021500`.
3. Updated 22 file-name references in scripts, tests and one report error message.

## Comparison with the live database (AlExMS, read-only)

Both sides were fingerprinted with the same catalog queries: tables, columns, constraints, indexes, function bodies/settings, execute grants, triggers, policies, views, enums, table grants and storage buckets.

- **Exact match:** tables (231), table grants, views (24), enums (14), storage buckets (9).
- **Live but not in `main`:** five applied migrations exist only as uncommitted files in the `codex-v1` worktree: `20261020090729`, `20261020120000`, `20261020142106`, `20261020162949`, `20261022010000`. Adding them to the rebuild makes functions (386) and function execute grants match exactly. `20261021190916_collaboration_procedure_routines` is in the worktree but not applied.
- **Files that never fully ran on the live database:**
  - `20260516000000_core_dealer_improvements` was unrunnable as written. None of its objects exist live: `orders.order_source_label`, `orders_order_origin_check`, `payments` type/status checks, the `idx_tasks_*` / `idx_orders_*` / `idx_payments_*` indexes and the `tasks` policies.
  - `20260515000600_enterprise_phase_1` fails at its seed insert on the live schema. Only `idx_feature_flags_company` exists live; its policies and other indexes do not.
  - `20260515000700_enterprise_phase_2`: none of its indexes exist live.
  - These three files have since moved to `supabase/migrations_archive/` (see follow-up).
- **Live database behind the files (fixed in follow-up):**
  - `company_settings_ai_provider_check` lacked `'nvidia'`. `20260513000300_enterprise_phase2_nvidia_ai_provider` was never applied.
  - `saved_reports_data_source_check` lacked `'credit_notes'`. The ledger statement recorded for `20261020030000_finance_reporting_integrity` contains no `saved_reports` change, so that part was added to the file after it was applied.
- **Live database ahead of the files (open):**
  - Trigger `set_quote_revisions_updated_at` on `quote_revisions` exists live, but files only ever drop it. `20260512000400_audit_fixes` assumes it exists.
  - Index `idx_feature_flags_company` exists live; it came from the archived `enterprise_phase_1`.
- Known tool difference: the in-memory engine is Postgres 18 (live is 17.6), so NOT NULL constraints were excluded from the constraint comparison.

## Follow-up (same day)

- Moved `20260515000600_enterprise_phase_1`, `20260515000700_enterprise_phase_2` and `20260516000000_core_dealer_improvements` to `supabase/migrations_archive/`, with the evidence in its `README.md`. The rebuild still applies every file.
- Added `20261022020000_ai_provider_and_report_source_checks`. The application already offers NVIDIA as an AI provider (`lib/validations/schemas.ts`) and credit notes as a report source (`lib/reports/report-builder.ts`), but the live database rejected both. Dry-run on the live database: the existing rows (1 settings row, 2 saved reports) pass the new checks. Applied live as ledger version `20261022014811` (ledger now 129 rows). Both live constraint definitions are now byte-identical to the rebuild.
- Fresh comparison after the two collaboration migrations reached the live database (ledger 128): the rebuild plus the five live `codex-v1` worktree files differs from live in only 4 places. Two are the checks above, now fixed. The other two are the live-only trigger and index listed above.

## Old → new file names

| Old | New |
|---|---|
| `20260511_phase1_quote_engine.sql` | `20260511000000_phase1_quote_engine.sql` |
| `20260511_phase2_terminology_and_stages.sql` | `20260511000100_phase2_terminology_and_stages.sql` |
| `20260512_phase1_rls_fixes.sql` | `20260512000000_phase1_rls_fixes.sql` |
| `20260512_phase3_operational_depth.sql` | `20260512000100_phase3_operational_depth.sql` |
| `20260512_phase4_quality_dispatch.sql` | `20260512000200_phase4_quality_dispatch.sql` |
| `20260512_phase5_financials_analytics.sql` | `20260512000300_phase5_financials_analytics.sql` |
| `20260512_audit_fixes.sql` | `20260512000400_audit_fixes.sql` |
| `20260513_enterprise_phase1_foundation.sql` | `20260513000000_enterprise_phase1_foundation.sql` |
| `20260513_enterprise_phase1_hardening.sql` | `20260513000100_enterprise_phase1_hardening.sql` |
| `20260513_enterprise_phase2_ai_quotation_assistant.sql` | `20260513000200_enterprise_phase2_ai_quotation_assistant.sql` |
| `20260513_enterprise_phase2_nvidia_ai_provider.sql` | `20260513000300_enterprise_phase2_nvidia_ai_provider.sql` |
| `20260514_core_dealer_improvements.sql` | `20260516000000_core_dealer_improvements.sql` |
| `0006_enterprise_phase_1.sql` | `20260515000600_enterprise_phase_1.sql` |
| `0007_enterprise_phase_2.sql` | `20260515000700_enterprise_phase_2.sql` |
| `0008_enterprise_phase_3.sql` | `20260515000800_enterprise_phase_3.sql` |
| `0009_enterprise_phase_4.sql` | `20260515000900_enterprise_phase_4.sql` |
| `0010_enterprise_phase_5.sql` | `20260515001000_enterprise_phase_5.sql` |
| `0011_enterprise_phase_6.sql` | `20260515001100_enterprise_phase_6.sql` |
| `0012_enterprise_phase5_qr_update.sql` | `20260515001200_enterprise_phase5_qr_update.sql` |
| `0013_enterprise_phase_7.sql` | `20260515001300_enterprise_phase_7.sql` |
| `0014_phase6_schema_upgrade.sql` | `20260515001400_phase6_schema_upgrade.sql` |
| `0015_enterprise_phase_8.sql` | `20260515001500_enterprise_phase_8.sql` |
| `0016_enterprise_phase_9.sql` | `20260515001600_enterprise_phase_9.sql` |
| `0017_enterprise_phase_10.sql` | `20260515001700_enterprise_phase_10.sql` |
| `0018_enterprise_phase_11.sql` | `20260515001800_enterprise_phase_11.sql` |
| `0019_enterprise_phase_12.sql` | `20260515001900_enterprise_phase_12.sql` |
| `0020_enterprise_phase_13.sql` | `20260515002000_enterprise_phase_13.sql` |
| `0021_enterprise_phase_14.sql` | `20260515002100_enterprise_phase_14.sql` |
| `0022_enterprise_phase_15.sql` | `20260515002200_enterprise_phase_15.sql` |
| `0023_enterprise_phase_16.sql` | `20260515002300_enterprise_phase_16.sql` |
| `0024_enterprise_phase_17.sql` | `20260515002400_enterprise_phase_17.sql` |
| `0025_enterprise_phase_18.sql` | `20260515002500_enterprise_phase_18.sql` |
| `0026_enterprise_phase_19.sql` | `20260515002600_enterprise_phase_19.sql` |
| `0027_enterprise_phase_20.sql` | `20260515002700_enterprise_phase_20.sql` |
| `0028_enterprise_phase_21.sql` | `20260515002800_enterprise_phase_21.sql` |
| `0029_enterprise_phase_22.sql` | `20260515002900_enterprise_phase_22.sql` |
| `0030_systems_configurator_phase_1.sql` | `20260515003000_systems_configurator_phase_1.sql` |
| `0031_profile_stock_reservations.sql` | `20260515003100_profile_stock_reservations.sql` |
| `0032_enterprise_phase_23_security.sql` | `20260515003200_enterprise_phase_23_security.sql` |
| `0032_profile_stock_consumptions.sql` | `20260515003201_profile_stock_consumptions.sql` |
| `0033_enterprise_phase_24_command_center.sql` | `20260515003300_enterprise_phase_24_command_center.sql` |
| `0034_enterprise_phase_23_24_hardening.sql` | `20260515003400_enterprise_phase_23_24_hardening.sql` |
| `0034_security_audit_fixes.sql` | `20260515003401_security_audit_fixes.sql` |
| `0035_phase_23_security_limitations_fix.sql` | `20260515003500_phase_23_security_limitations_fix.sql` |
| `0036_fix_production_jobs_job_number.sql` | `20260515003600_fix_production_jobs_job_number.sql` |
| `0036_phase_5_to_10_operational_hardening.sql` | `20260515003601_phase_5_to_10_operational_hardening.sql` |
| `0037_quote_order_fulfillment_controls.sql` | `20260515003700_quote_order_fulfillment_controls.sql` |
| `0038_order_dealer_stock_fulfillment.sql` | `20260515003800_order_dealer_stock_fulfillment.sql` |
| `0039_fix_system_configurations_status.sql` | `20260515003900_fix_system_configurations_status.sql` |
| `0040_access_control_dealer_workflows.sql` | `20260515004000_access_control_dealer_workflows.sql` |
| `0041_dealer_roles_inventory_automation.sql` | `20260515004100_dealer_roles_inventory_automation.sql` |
| `0042_dealer_quote_order_isolation.sql` | `20260515004200_dealer_quote_order_isolation.sql` |
| `0043_dealer_order_workflow_hardening.sql` | `20260515004300_dealer_order_workflow_hardening.sql` |
| `0044_order_production_requirements.sql` | `20260515004400_order_production_requirements.sql` |
| `0045_dealer_isolation_and_inventory_entry.sql` | `20260515004500_dealer_isolation_and_inventory_entry.sql` |
| `0046_dealer_factory_status_and_tasks.sql` | `20260515004600_dealer_factory_status_and_tasks.sql` |
| `0047_dealer_factory_collaboration.sql` | `20260515004700_dealer_factory_collaboration.sql` |
| `0048_security_advisor_function_hardening.sql` | `20260515004800_security_advisor_function_hardening.sql` |
| `0049_security_advisor_remaining_definer_cleanup.sql` | `20260515004900_security_advisor_remaining_definer_cleanup.sql` |
| `0050_production_pieces_and_foundry.sql` | `20260515005000_production_pieces_and_foundry.sql` |
| `0051_foundry_sources_scrap_billets_packaging.sql` | `20260515005100_foundry_sources_scrap_billets_packaging.sql` |
| `0052_packaging_queue_and_calculation_hardening.sql` | `20260515005200_packaging_queue_and_calculation_hardening.sql` |
| `0053_vendors_created_by.sql` | `20260515005300_vendors_created_by.sql` |
| `0054_billet_diameter_vendor_source_scrap_workflow.sql` | `20260515005400_billet_diameter_vendor_source_scrap_workflow.sql` |
| `0055_billet_inventory_and_outsourced_billets.sql` | `20260515005500_billet_inventory_and_outsourced_billets.sql` |
| `0055_machines_and_foundry_enhancements.sql` | `20260515005501_machines_and_foundry_enhancements.sql` |
| `0056_order_billet_requirements_and_allocation.sql` | `20260515005600_order_billet_requirements_and_allocation.sql` |
| `0057_foundry_furnace_mix_and_chemistry.sql` | `20260515005700_foundry_furnace_mix_and_chemistry.sql` |
| `0058_production_plan_slots.sql` | `20260722000000_production_plan_slots.sql` |
| `0059_reports_storage_bucket.sql` | `20260515005900_reports_storage_bucket.sql` |


# Pending migration inventory

> Historical snapshot before application. The user's later instruction authorized applying missing migrations. The [completed application report](MIGRATION_RECONCILIATION_2026-10-20.md) and [complete 168-file inventory](evidence/migration-inventory-completed_2026-10-20.csv) supersede the pending statuses below: 40 migrations, including the completed expense/receivables/reporting work and two forward repairs, were subsequently applied and verified.

Checked: 2026-10-20 05:45:51 UTC (20 October 2026, Asia/Kolkata).

Project: `pkawmdxtmsdgigsehcmb` (`https://pkawmdxtmsdgigsehcmb.supabase.co`). The connected project's URL matches `NEXT_PUBLIC_SUPABASE_URL` in the local environment configuration.

**No Supabase migration, hosted write, ledger repair or deployment was performed.** This is an inventory and metadata comparison. Filenames below are relative to `supabase/migrations/`.

## Result

| Category | Files / rows | Meaning |
| --- | ---: | --- |
| Local SQL migration files | 163 | Entire current checkout, including the R22 draft. |
| Distinct local versions | 151 | Seven version identifiers are shared by multiple files. |
| Hosted migration ledger rows | 44 | Read successfully; a separate read-only count also returned 44. |
| Local files with a matching hosted migration name | 32 | Recorded under different hosted timestamps; exact SQL revision and effective schema are not attested. |
| Local files without a matching hosted migration name | 131 | Complete list is the 14 candidates plus 117 older files below. This is not proof that all 131 scripts have never been executed manually. |
| Verified local candidates, recorded as not applied | 13 | R04-R11 and R17-R21. Their hosted ledger names are also absent. |
| Draft candidate, not applied | 1 | R22; complete verification/audit is still in progress. |
| Older files without a ledger-name match | 117 | Application status remains unverified; review baseline/manual history and schema before considering replay. |
| Hosted entries without a local filename-name match | 12 | Listed below; their effect may overlap local historical changes. |

**The known prepared backlog is 13 verified candidates plus one draft. The broader ledger-unmatched inventory is 131 files. These counts describe different evidence and must not be treated as an execution plan.**

The hosted ledger's earliest recorded version is `20260602094754`; its latest is `20260810120125`. Execution timestamps do not match repository version prefixes, so a simple version-only comparison would incorrectly flag all 163 local files. This report matches names after removing an optional `.sql` suffix and one leading numeric version prefix. Every one of the 32 matches is unambiguous; there are no duplicate hosted versions or empty hosted names.

## Known prepared candidates (14 files)

These 13 verified candidates remain OPEN under the no-migrations instruction. Local fixture verification does not establish hosted activation, complete replay, real JWT/RLS, independent-session concurrency or operator acceptance. R22 is a draft and is not included in the 13 verified candidates.

| Issue | Migration file | Local status | Purpose |
| --- | --- | --- | --- |
| R04 | `20261015000000_reservation_release_replay_integrity.sql` | LOCAL CANDIDATE VERIFIED; not applied | Preserve exact posted-consumption retries after the remaining hold is released. |
| R05 | `20261015010000_reservation_ledger_projection.sql` | LOCAL CANDIDATE VERIFIED; not applied | Derive remaining reservations and stock availability from the complete ledger. |
| R06 | `20261015020000_credit_settlement_exclusivity.sql` | LOCAL CANDIDATE VERIFIED; not applied | Prevent duplicate invoice settlement or refund entitlement from credit notes. |
| R07 | `20261015030000_credit_note_retry_binding.sql` | LOCAL CANDIDATE VERIFIED; not applied | Bind credit-note retry keys to the original dispatch and reason. |
| R08 | `20261015040000_direct_priced_orders.sql` | LOCAL CANDIDATE VERIFIED; not applied | Support direct priced-line orders alongside quotation-backed orders. |
| R09 | `20261015050000_dispatch_reservation_ledger.sql` | LOCAL CANDIDATE VERIFIED; not applied | Use the reservation ledger when posting dispatch consumption. |
| R10 | `20261015060000_order_cancellation_stock_integrity.sql` | LOCAL CANDIDATE VERIFIED; not applied | Release cancelled-order holds while retaining posted shipment and stock evidence. |
| R11 | `20261019000000_retained_dispatch_invoices.sql` | LOCAL CANDIDATE VERIFIED; not applied | Invoice verified retained shipments after the remaining order is cancelled. |
| R17 | `20261019010000_terminal_finishing_evidence.sql` | LOCAL CANDIDATE VERIFIED; not applied | Protect terminal finishing records and retain their original movement dates. |
| R18 | `20261019020000_finishing_accepted_dispositions.sql` | LOCAL CANDIDATE VERIFIED; not applied | Carry accepted portions of partial finishing receipts through QC, packaging and dispatch. |
| R19 | `20261019030000_packaging_material_evidence.sql` | LOCAL CANDIDATE VERIFIED; not applied | Preserve packaging material evidence and restrict ledger mutation. |
| R20 | `20261019040000_finishing_workload_projection.sql` | LOCAL CANDIDATE VERIFIED; not applied | Provide complete finishing workload totals, retry accounting and paginated reads. |
| R21 | `20261019050000_billet_link_repair_integrity.sql` | LOCAL CANDIDATE VERIFIED; not applied | Repair legacy billet requirement links using material/profile identity and actual link counts. |
| R22 | `20261020000000_manual_billet_requirement_lineage.sql` | DRAFT; verification in progress; not applied | Repair manual allocation/reallocation against the actual billet schema; verification is in progress. |

Status evidence: [BUGS-MEGA.md](../BUGS-MEGA.md), [15 October progress](BUGS_MEGA_PROGRESS_2026-10-15.md), and [19 October progress](BUGS_MEGA_PROGRESS_2026-10-19.md). R22's new local draft is listed even though its register entry still records reproduction and has not been advanced to verified.

## Older files without a hosted name match (117 files)

These files are absent from the inspected ledger by name. They may include manually applied scripts, baseline setup, superseded revisions or changes covered by other scripts. Their absence from history alone does not justify replay. None is labelled definitely unapplied here.

### Legacy migrations through 8 June (86 files)

- `0006_enterprise_phase_1.sql`
- `0007_enterprise_phase_2.sql`
- `0008_enterprise_phase_3.sql`
- `0009_enterprise_phase_4.sql`
- `0010_enterprise_phase_5.sql`
- `0011_enterprise_phase_6.sql`
- `0013_enterprise_phase_7.sql`
- `0014_phase6_schema_upgrade.sql`
- `0015_enterprise_phase_8.sql`
- `0016_enterprise_phase_9.sql`
- `0017_enterprise_phase_10.sql`
- `0018_enterprise_phase_11.sql`
- `0019_enterprise_phase_12.sql`
- `0020_enterprise_phase_13.sql`
- `0021_enterprise_phase_14.sql`
- `0022_enterprise_phase_15.sql`
- `0023_enterprise_phase_16.sql`
- `0024_enterprise_phase_17.sql`
- `0025_enterprise_phase_18.sql`
- `0026_enterprise_phase_19.sql`
- `0027_enterprise_phase_20.sql`
- `0028_enterprise_phase_21.sql`
- `0029_enterprise_phase_22.sql`
- `0030_systems_configurator_phase_1.sql`
- `0031_profile_stock_reservations.sql`
- `0032_enterprise_phase_23_security.sql`
- `0032_profile_stock_consumptions.sql`
- `0033_enterprise_phase_24_command_center.sql`
- `0034_enterprise_phase_23_24_hardening.sql`
- `0034_security_audit_fixes.sql`
- `0035_phase_23_security_limitations_fix.sql`
- `0036_fix_production_jobs_job_number.sql`
- `0037_quote_order_fulfillment_controls.sql`
- `0038_order_dealer_stock_fulfillment.sql`
- `0039_fix_system_configurations_status.sql`
- `0040_access_control_dealer_workflows.sql`
- `0041_dealer_roles_inventory_automation.sql`
- `0042_dealer_quote_order_isolation.sql`
- `0043_dealer_order_workflow_hardening.sql`
- `0044_order_production_requirements.sql`
- `0045_dealer_isolation_and_inventory_entry.sql`
- `0046_dealer_factory_status_and_tasks.sql`
- `0047_dealer_factory_collaboration.sql`
- `0048_security_advisor_function_hardening.sql`
- `0049_security_advisor_remaining_definer_cleanup.sql`
- `0050_production_pieces_and_foundry.sql`
- `0051_foundry_sources_scrap_billets_packaging.sql`
- `0052_packaging_queue_and_calculation_hardening.sql`
- `0053_vendors_created_by.sql`
- `0054_billet_diameter_vendor_source_scrap_workflow.sql`
- `0055_billet_inventory_and_outsourced_billets.sql`
- `0055_machines_and_foundry_enhancements.sql`
- `0056_order_billet_requirements_and_allocation.sql`
- `0057_foundry_furnace_mix_and_chemistry.sql`
- `0058_production_plan_slots.sql`
- `20260511_phase1_quote_engine.sql`
- `20260511_phase2_terminology_and_stages.sql`
- `20260512_audit_fixes.sql`
- `20260512_phase1_rls_fixes.sql`
- `20260512_phase3_operational_depth.sql`
- `20260512_phase4_quality_dispatch.sql`
- `20260512_phase5_financials_analytics.sql`
- `20260513_enterprise_phase1_foundation.sql`
- `20260513_enterprise_phase1_hardening.sql`
- `20260513_enterprise_phase2_ai_quotation_assistant.sql`
- `20260513_enterprise_phase2_nvidia_ai_provider.sql`
- `20260514_core_dealer_improvements.sql`
- `20260530000000_packaging_multiple_materials.sql`
- `20260530000001_machines_created_by.sql`
- `20260530000002_foundry_billet_allocation_repairs.sql`
- `20260530000003_production_jobs_created_by.sql`
- `20260531000000_expenses_module.sql`
- `20260531010000_expenses_phase2_packaging_and_controls.sql`
- `20260531020000_expenses_phase3_energy_maintenance_approval.sql`
- `20260601000000_pcda_die_profile_enrichment.sql`
- `20260601000001_pcda_master_data_catalogs.sql`
- `20260602000000_pcda_phase1_completion.sql`
- `20260602000001_add_label_to_qr_codes.sql`
- `20260602000002_security_definer_access_hardening.sql`
- `20260603000000_pcda_master_catalog_tables_consolidated.sql`
- `20260603100000_security_audit_fixes_june2026.sql`
- `20260604000000_pcda_quote_items_enrichment.sql`
- `20260604000001_pcda_order_items_enrichment.sql`
- `20260604000002_pcda_production_dispatch_enrichment.sql`
- `20260604000003_pcda_invoice_items.sql`
- `20260608000000_pcda_crm_enrichment.sql`

### 23 July workflow migrations (10 files)

- `20260723010000_production_schedule_integrity.sql`
- `20260723020000_atomic_dealer_quote_order_handoff.sql`
- `20260723030000_atomic_system_production_handoff.sql`
- `20260723040000_returned_dispatch_invoice_guard.sql`
- `20260723050000_subscription_entitlement_guard.sql`
- `20260723055000_canonical_factory_minimum_queue.sql`
- `20260723060000_exact_dispatch_manifest_and_consolidation.sql`
- `20260723070000_dispatch_return_credit_notes.sql`
- `20260723080000_production_completion_analytics.sql`
- `20260723090000_notification_read_receipts.sql`

### August migrations (10 files)

- `20260810000000_tenant_boundary_and_dealer_workflow_hardening.sql`
- `20260810010000_manufacturing_reference_and_material_guards.sql`
- `20260810020000_atomic_dealer_order_creation_and_workflow.sql`
- `20260810030000_quote_and_order_financial_integrity.sql`
- `20260810040000_storage_and_catalog_policy_alignment.sql`
- `20260810050000_factory_queue_weight_runtime_fix.sql`
- `20260812000000_security_and_notification_integrity.sql`
- `20260812010000_dispatch_return_and_manifest_integrity.sql`
- `20260812020000_invite_acceptance_integrity.sql`
- `20260812030000_profile_configuration_integrity.sql`

### September migrations (3 files)

- `20260918000000_production_source_line_integrity.sql`
- `20260929000000_business_logic_fixes.sql`
- `20260930000000_astra_audit_fixes.sql`

### 8-13 October migrations (8 files)

- `20261008000000_foundry_material_integrity.sql`
- `20261008010000_access_projection_integrity.sql`
- `20261008020000_factory_workflow_integrity.sql`
- `20261008030000_configuration_quote_integrity.sql`
- `20261008040000_management_metrics_integrity.sql`
- `20261008050000_operation_search_integrity.sql`
- `20261013000000_audit_workflow_followup.sql`
- `20261013010000_dealer_fulfillment_integrity.sql`

## Local files represented in the hosted ledger (32 files)

These are excluded from the 131-file unmatched list. The ledger records the listed names, but this check does not compare SQL contents or attest the currently effective object definitions.

| Local file | Hosted execution version | Hosted migration name |
| --- | --- | --- |
| `0012_enterprise_phase5_qr_update.sql` | `20260602094754` | `0012_enterprise_phase5_qr_update.sql` |
| `0036_phase_5_to_10_operational_hardening.sql` | `20260721090049` | `0036_phase_5_to_10_operational_hardening` |
| `0059_reports_storage_bucket.sql` | `20260721090051` | `0059_reports_storage_bucket` |
| `20260715000000_atomic_business_workflows.sql` | `20260721085917` | `20260715000000_atomic_business_workflows` |
| `20260715010000_role_aware_sensitive_rls.sql` | `20260721090106` | `20260715010000_role_aware_sensitive_rls` |
| `20260715011000_legacy_role_rls_observability.sql` | `20260721090108` | `20260715011000_legacy_role_rls_observability` |
| `20260715020000_documents_storage_bucket.sql` | `20260721090110` | `20260715020000_documents_storage_bucket` |
| `20260715030000_distributed_api_rate_limits.sql` | `20260721090112` | `20260715030000_distributed_api_rate_limits` |
| `20260715040000_documents_storage_role_rls.sql` | `20260721090114` | `20260715040000_documents_storage_role_rls` |
| `20260715041000_mixed_ownership_role_rls.sql` | `20260721090116` | `20260715041000_mixed_ownership_role_rls` |
| `20260718009999_financial_payment_compatibility.sql` | `20260721090232` | `20260718009999_financial_payment_compatibility` |
| `20260718010000_financial_closure.sql` | `20260721090243` | `20260718010000_financial_closure` |
| `20260718010100_financial_collection_analytics.sql` | `20260721090245` | `20260718010100_financial_collection_analytics` |
| `20260718020000_production_quality_packaging_handoffs.sql` | `20260721090247` | `20260718020000_production_quality_packaging_handoffs` |
| `20260718020500_finishing_route_and_quality_yield.sql` | `20260721090249` | `20260718020500_finishing_route_and_quality_yield` |
| `20260718021000_dispatch_readiness_and_delivery.sql` | `20260721090252` | `20260718021000_dispatch_readiness_and_delivery` |
| `20260718021500_floor_output_and_finishing_workflows.sql` | `20260721090254` | `20260718021500_floor_output_and_finishing_workflows` |
| `20260718040000_report_builder_data_sources.sql` | `20260721090256` | `20260718040000_report_builder_data_sources` |
| `20260718050000_customer_accepted_quote_orders.sql` | `20260721090258` | `20260718050000_customer_accepted_quote_orders` |
| `20260718051000_quote_status_transitions.sql` | `20260721090300` | `20260718051000_quote_status_transitions` |
| `20260718052000_invoice_packing_line_parity.sql` | `20260721090301` | `20260718052000_invoice_packing_line_parity` |
| `20260718053000_reservation_consumption_safety.sql` | `20260721090303` | `20260718053000_reservation_consumption_safety` |
| `20260718054000_dispatch_proof_upload.sql` | `20260721090305` | `20260718054000_dispatch_proof_upload` |
| `20260721091000_security_advisor_cleanup.sql` | `20260721090359` | `20260721091000_security_advisor_cleanup` |
| `20260721091224_performance_fk_indexes.sql` | `20260721091303` | `20260721091224_performance_fk_indexes` |
| `20260721091307_physical_dispatch_stock_provenance.sql` | `20260721092723` | `20260721091307_physical_dispatch_stock_provenance` |
| `20260721091327_advanced_analytics_aggregates.sql` | `20260721092352` | `20260721091327_advanced_analytics_aggregates` |
| `20260721091345_remove_duplicate_indexes.sql` | `20260721091400` | `20260721091345_remove_duplicate_indexes` |
| `20260721091534_restrict_trigger_function_execution.sql` | `20260721091552` | `20260721091534_restrict_trigger_function_execution` |
| `20260721091620_quote_atomic_dealer_lineage.sql` | `20260721092850` | `20260721091620_quote_atomic_dealer_lineage` |
| `20260721091808_atomic_company_onboarding.sql` | `20260721091932` | `20260721091808_atomic_company_onboarding` |
| `20260721093238_lineage_fk_indexes.sql` | `20260721093417` | `20260721093238_lineage_fk_indexes` |

## Hosted entries without a matching local name (12 rows)

| Hosted execution version | Hosted migration name |
| --- | --- |
| `20260809133129` | `widen_app_users_role_check` |
| `20260809133148` | `quote_conversion_status_gate_alignment` |
| `20260809133215` | `expense_approval_and_payment_hardening` |
| `20260809133237` | `billet_stock_integrity` |
| `20260809133311` | `production_billet_release_and_compat` |
| `20260809133328` | `invoice_reversal_status` |
| `20260809133453` | `revoke_trigger_fn_execute` |
| `20260809135011` | `process_scrap_recovery_loop` |
| `20260809135640` | `fix_source_expense_link_triggers` |
| `20260809140231` | `foundry_source_sync_recursion_guard` |
| `20260809140456` | `fix_billet_reconcile_status` |
| `20260810120125` | `expense_payment_update_guard` |

## Version collisions and prerequisites

These collisions remain unresolved. One version row cannot identify which of the colliding local files ran.

| Local version | Files |
| --- | --- |
| `0032` | `0032_enterprise_phase_23_security.sql`; `0032_profile_stock_consumptions.sql` |
| `0034` | `0034_enterprise_phase_23_24_hardening.sql`; `0034_security_audit_fixes.sql` |
| `0036` | `0036_fix_production_jobs_job_number.sql`; `0036_phase_5_to_10_operational_hardening.sql` |
| `0055` | `0055_billet_inventory_and_outsourced_billets.sql`; `0055_machines_and_foundry_enhancements.sql` |
| `20260511` | `20260511_phase1_quote_engine.sql`; `20260511_phase2_terminology_and_stages.sql` |
| `20260512` | `20260512_audit_fixes.sql`; `20260512_phase1_rls_fixes.sql`; `20260512_phase3_operational_depth.sql`; `20260512_phase4_quality_dispatch.sql`; `20260512_phase5_financials_analytics.sql` |
| `20260513  | `20260513_enterprise_phase1_foundation.sql`; `20260513_enterprise_phase1_hardening.sql`; `20260513_enterprise_phase2_ai_quotation_assistant.sql`; `20260513_enterprise_phase2_nvidia_ai_provider.sql` |

`supabase/schema.sql` and `supabase/rls.sql` are baseline prerequisites outside the migration directory, so they are not included in the 163-file count. Their hosted application state was not established by this inventory.

A00 remains OPEN: version/name metadata is now readable, but the historical lineage, SQL contents, baseline, effective schema, grants/RLS, dependency order and authenticated acceptance have not been reconciled. Do not rename migration versions, repair the ledger, or apply the unmatched files based on this report.

## Evidence and verification

- [Raw metadata snapshot: 44 hosted ledger rows](evidence/migration-ledger_2026-10-20.json). No credentials or business records are included.
- [Complete per-file inventory: all 163 local files](evidence/migration-inventory_2026-10-20.csv). Each local file has exactly one classification.
- Inventory partition checked: `163 = 32 name matches + 13 verified candidates + 1 draft + 117 older unmatched files`.
- Ledger partition checked: `44 = 32 matching names + 12 hosted-only names`.
- The read-only SQL count agrees with the 44 rows returned by `list_migrations`.
- No application code changed for this report. Application lint, typecheck, build and business regression suites were not rerun for this documentation-only inventory; existing R22 work remains under verification.

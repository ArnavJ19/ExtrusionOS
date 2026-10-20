# Current hosted database schema

Captured: 2026-10-20 06:36:50 UTC. Project: `pkawmdxtmsdgigsehcmb`. PostgreSQL 17.6.

Schema definitions below are confirmed from the hosted catalog after the 40 migration applications. Full columns, types, defaults, constraints, indexes, policies, triggers, function definitions and effective function grants are in [the final catalog JSON](evidence/schema-completed_2026-10-20.json).

| Schema | Tables | Views |
| --- | ---: | ---: |
| public | 175 | 23 |
| private | 7 | 0 |
| storage | 8 | 0 |

There are 293 functions in public/private, 600 policies and 288 non-internal triggers across public/private/storage. Supabase-managed auth and other system schemas are outside this business catalog export.

## Business tables

All 175 public tables below have RLS enabled. Policy counts alone do not establish correct authorization for every workflow.

| Table | Columns | Policies | RLS |
| --- | ---: | ---: | --- |
| `ai_interactions` | 10 | 5 | Enabled |
| `aluminium_profiles` | 113 | 4 | Enabled |
| `app_users` | 21 | 4 | Enabled |
| `audit_logs` | 10 | 2 | Enabled |
| `audit_logs_enterprise` | 26 | 2 | Enabled |
| `automation_rules` | 10 | 4 | Enabled |
| `automation_runs` | 9 | 2 | Enabled |
| `billet_batches` | 20 | 3 | Enabled |
| `branches` | 13 | 4 | Enabled |
| `breakdown_logs` | 30 | 4 | Enabled |
| `breakdown_spare_part_usage` | 9 | 3 | Enabled |
| `calibration_records` | 10 | 4 | Enabled |
| `checklist_responses` | 9 | 4 | Enabled |
| `checklist_templates` | 8 | 4 | Enabled |
| `companies` | 17 | 4 | Enabled |
| `company_settings` | 43 | 4 | Enabled |
| `company_subscriptions` | 10 | 1 | Enabled |
| `compliance_audit_records` | 11 | 4 | Enabled |
| `compliance_standards` | 8 | 4 | Enabled |
| `credit_notes` | 19 | 1 | Enabled |
| `customer_compliance_requirements` | 10 | 4 | Enabled |
| `customers` | 29 | 4 | Enabled |
| `data_exchange_jobs` | 13 | 3 | Enabled |
| `data_retention_settings` | 8 | 4 | Enabled |
| `dealer_order_comments` | 8 | 2 | Enabled |
| `dealer_order_items` | 12 | 2 | Enabled |
| `dealer_order_status_history` | 9 | 4 | Enabled |
| `dealer_orders` | 21 | 3 | Enabled |
| `dealer_receipt_items` | 10 | 2 | Enabled |
| `dealer_receipts` | 14 | 2 | Enabled |
| `dealers` | 19 | 2 | Enabled |
| `die_corrections` | 18 | 4 | Enabled |
| `die_health_metrics` | 16 | 4 | Enabled |
| `die_nitriding_history` | 24 | 1 | Enabled |
| `die_trials` | 30 | 4 | Enabled |
| `dies` | 84 | 4 | Enabled |
| `discrepancy_recounts` | 12 | 2 | Enabled |
| `dispatch_status_history` | 8 | 1 | Enabled |
| `dispatches` | 26 | 7 | Enabled |
| `document_pack_items` | 6 | 4 | Enabled |
| `document_packs` | 8 | 4 | Enabled |
| `document_versions` | 8 | 4 | Enabled |
| `documents` | 13 | 4 | Enabled |
| `drawing_reviews` | 7 | 4 | Enabled |
| `energy_readings` | 20 | 4 | Enabled |
| `energy_sources` | 10 | 4 | Enabled |
| `entity_revisions` | 8 | 2 | Enabled |
| `expense_ledger` | 50 | 1 | Enabled |
| `expense_payments` | 19 | 1 | Enabled |
| `expense_supplier_credits` | 19 | 1 | Enabled |
| `export_documents` | 7 | 4 | Enabled |
| `export_orders` | 22 | 4 | Enabled |
| `factory_load_consolidations` | 15 | 1 | Enabled |
| `feature_flags` | 9 | 4 | Enabled |
| `finish_options` | 12 | 4 | Enabled |
| `finishing_jobs` | 21 | 3 | Enabled |
| `finishing_status_history` | 8 | 1 | Enabled |
| `foundry_aluminium_scrap` | 29 | 3 | Enabled |
| `foundry_batches` | 38 | 4 | Enabled |
| `foundry_billets` | 21 | 1 | Enabled |
| `foundry_external_aluminium_sources` | 31 | 3 | Enabled |
| `glass_items` | 12 | 4 | Enabled |
| `hardware_items` | 14 | 4 | Enabled |
| `integrations` | 10 | 4 | Enabled |
| `inventory_discrepancies` | 22 | 2 | Enabled |
| `inventory_items` | 15 | 3 | Enabled |
| `inventory_locations` | 10 | 2 | Enabled |
| `inventory_movements` | 16 | 2 | Enabled |
| `inventory_transactions` | 23 | 2 | Enabled |
| `invitations` | 20 | 2 | Enabled |
| `invoice_items` | 76 | 1 | Enabled |
| `invoices` | 31 | 1 | Enabled |
| `leads` | 20 | 4 | Enabled |
| `login_events` | 7 | 5 | Enabled |
| `machines` | 18 | 3 | Enabled |
| `maintenance_schedules` | 14 | 4 | Enabled |
| `maintenance_spare_parts` | 14 | 4 | Enabled |
| `message_campaigns` | 9 | 2 | Enabled |
| `notification_read_receipts` | 4 | 1 | Enabled |
| `notifications` | 18 | 4 | Enabled |
| `opportunities` | 17 | 4 | Enabled |
| `order_billet_requirements` | 17 | 3 | Enabled |
| `order_cost_breakdown` | 31 | 4 | Enabled |
| `order_dealer_stock_fulfillments` | 18 | 2 | Enabled |
| `order_items` | 82 | 4 | Enabled |
| `order_stage_history` | 7 | 2 | Enabled |
| `orders` | 38 | 4 | Enabled |
| `outbound_messages` | 17 | 3 | Enabled |
| `outsourced_billet_batches` | 31 | 3 | Enabled |
| `packaging_job_materials` | 8 | 4 | Enabled |
| `packaging_jobs` | 15 | 3 | Enabled |
| `packaging_material_movements` | 8 | 1 | Enabled |
| `packaging_material_purchases` | 25 | 3 | Enabled |
| `packaging_materials` | 16 | 3 | Enabled |
| `packing_list_items` | 86 | 1 | Enabled |
| `payments` | 22 | 1 | Enabled |
| `pcda_master_alloy_standards` | 8 | 5 | Enabled |
| `pcda_master_alloys` | 8 | 5 | Enabled |
| `pcda_master_compliance_types` | 8 | 5 | Enabled |
| `pcda_master_cost_components` | 8 | 5 | Enabled |
| `pcda_master_defect_types` | 8 | 5 | Enabled |
| `pcda_master_die_types` | 8 | 5 | Enabled |
| `pcda_master_document_types` | 8 | 5 | Enabled |
| `pcda_master_finish_types` | 8 | 5 | Enabled |
| `pcda_master_machine_types` | 8 | 5 | Enabled |
| `pcda_master_packing_modes` | 8 | 5 | Enabled |
| `pcda_master_production_stages` | 9 | 5 | Enabled |
| `pcda_master_profile_categories` | 8 | 5 | Enabled |
| `pcda_master_qty_methods` | 8 | 5 | Enabled |
| `pcda_master_quality_parameters` | 9 | 5 | Enabled |
| `pcda_master_surface_treatments` | 8 | 5 | Enabled |
| `pcda_master_tempers` | 8 | 5 | Enabled |
| `pcda_master_uoms` | 8 | 5 | Enabled |
| `permissions` | 4 | 1 | Enabled |
| `portal_users` | 11 | 3 | Enabled |
| `product_standard_mappings` | 7 | 4 | Enabled |
| `production_efficiency_change_logs` | 7 | 1 | Enabled |
| `production_job_status_history` | 9 | 1 | Enabled |
| `production_jobs` | 91 | 3 | Enabled |
| `production_output_corrections` | 12 | 1 | Enabled |
| `production_plan_slots` | 15 | 4 | Enabled |
| `profile_defect_rules` | 12 | 1 | Enabled |
| `profile_optimization_runs` | 13 | 5 | Enabled |
| `profile_quality_plans` | 13 | 1 | Enabled |
| `profile_routing_steps` | 12 | 1 | Enabled |
| `profile_stock_batches` | 16 | 3 | Enabled |
| `profile_stock_consumptions` | 13 | 1 | Enabled |
| `profile_stock_reservations` | 17 | 3 | Enabled |
| `profitability_alerts` | 11 | 4 | Enabled |
| `qr_codes` | 12 | 4 | Enabled |
| `quality_inspections` | 20 | 4 | Enabled |
| `quality_rework_resolutions` | 13 | 1 | Enabled |
| `quote_items` | 112 | 4 | Enabled |
| `quote_requests` | 12 | 6 | Enabled |
| `quote_revisions` | 10 | 4 | Enabled |
| `quote_suggestions` | 11 | 8 | Enabled |
| `quotes` | 35 | 4 | Enabled |
| `report_exports` | 8 | 2 | Enabled |
| `role_permissions` | 4 | 2 | Enabled |
| `roles` | 10 | 2 | Enabled |
| `sales_activities` | 12 | 4 | Enabled |
| `sales_targets` | 13 | 4 | Enabled |
| `saved_reports` | 9 | 4 | Enabled |
| `scan_events` | 10 | 2 | Enabled |
| `scrap_records` | 15 | 2 | Enabled |
| `sensitive_action_logs` | 10 | 5 | Enabled |
| `shipment_items` | 10 | 2 | Enabled |
| `shipments` | 15 | 2 | Enabled |
| `subscription_plans` | 9 | 1 | Enabled |
| `support_tickets` | 14 | 6 | Enabled |
| `sync_logs` | 11 | 3 | Enabled |
| `system_beading_cuts` | 11 | 5 | Enabled |
| `system_components` | 10 | 2 | Enabled |
| `system_configurations` | 49 | 4 | Enabled |
| `system_glass_cuts` | 19 | 4 | Enabled |
| `system_hardware_bom` | 13 | 4 | Enabled |
| `system_material_summary` | 16 | 4 | Enabled |
| `system_panels` | 15 | 4 | Enabled |
| `system_profile_cuts` | 21 | 5 | Enabled |
| `system_profiles` | 17 | 5 | Enabled |
| `system_reports` | 7 | 4 | Enabled |
| `system_series` | 15 | 5 | Enabled |
| `system_templates` | 15 | 4 | Enabled |
| `tasks` | 17 | 4 | Enabled |
| `technical_documents` | 19 | 6 | Enabled |
| `technical_drawings` | 20 | 4 | Enabled |
| `technical_queries` | 14 | 4 | Enabled |
| `technical_reports` | 10 | 3 | Enabled |
| `tender_checklist_items` | 8 | 4 | Enabled |
| `tender_documents` | 9 | 4 | Enabled |
| `tenders` | 24 | 4 | Enabled |
| `user_invitations` | 12 | 4 | Enabled |
| `user_roles` | 11 | 2 | Enabled |
| `vendors` | 18 | 3 | Enabled |
| `whatsapp_templates` | 12 | 2 | Enabled |

## Business views

The 22 protected projections use explicit company/role filtering and security barriers; the die-amortization view uses invoker security. Supabase continues to flag the 22 owner-executed projections. Their missing-identity check returned zero rows for every view; that is not a complete cross-tenant/authenticated browser acceptance test.

| View | Options |
| --- | --- |
| `company_settings_authorized` | security_barrier=true |
| `die_amortization_status` | security_invoker=true |
| `expense_ledger_authorized` | security_barrier=true |
| `expense_ledger_reconciliation_issues` | security_barrier=true |
| `finish_options_authorized` | security_barrier=true |
| `finishing_accepted_outputs` | security_barrier=true |
| `glass_items_authorized` | security_barrier=true |
| `hardware_items_authorized` | security_barrier=true |
| `invoice_items_authorized` | security_barrier=true |
| `invoice_settlement_review` | security_barrier=true |
| `invoices_authorized` | security_barrier=true |
| `order_dealer_stock_fulfillments_authorized` | security_barrier=true |
| `order_items_authorized` | security_barrier=true |
| `orders_authorized` | security_barrier=true |
| `packing_list_items_authorized` | security_barrier=true |
| `production_jobs_authorized` | security_barrier=true |
| `quote_items_authorized` | security_barrier=true |
| `quotes_authorized` | security_barrier=true |
| `system_configurations_authorized` | security_barrier=true |
| `system_glass_cuts_authorized` | security_barrier=true |
| `system_hardware_bom_authorized` | security_barrier=true |
| `system_material_summary_authorized` | security_barrier=true |
| `system_templates_authorized` | security_barrier=true |

## Internal tables

| Table | Purpose boundary |
| --- | --- |
| `private.api_rate_limits` | Internal server authorization/request/rate-limit data; see catalog ACLs. |
| `private.direct_order_requests` | Internal server authorization/request/rate-limit data; see catalog ACLs. |
| `private.dispatch_activation_authorizations` | Internal server authorization/request/rate-limit data; see catalog ACLs. |
| `private.production_completion_authorizations` | Internal server authorization/request/rate-limit data; see catalog ACLs. |
| `private.production_output_correction_authorizations` | Internal server authorization/request/rate-limit data; see catalog ACLs. |
| `private.quality_resolution_authorizations` | Internal server authorization/request/rate-limit data; see catalog ACLs. |
| `private.quote_fulfillment_authorizations` | Internal server authorization/request/rate-limit data; see catalog ACLs. |

The previous latest ledger identifier was `20260810120125`. The latest application in this run is `20261020063338` (`2026-10-20 06:33:38 UTC` / `2026-10-20 12:03:38 IST`). A reliable historical last-created table/policy timestamp is unavailable; current definitions and the ledger were compared directly.

See [the application report](MIGRATION_RECONCILIATION_2026-10-20.md) for every applied file, decisions about superseded scripts, verification and remaining acceptance boundaries.

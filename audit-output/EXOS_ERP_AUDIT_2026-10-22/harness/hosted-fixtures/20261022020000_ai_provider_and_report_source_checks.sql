-- Restore two check values the application already offers but the live database rejects.
-- 20260513_enterprise_phase2_nvidia_ai_provider never ran live, so choosing NVIDIA in AI
-- settings fails. The saved_reports credit_notes source was added to
-- 20261020030000_finance_reporting_integrity after that file was applied, so saving a
-- credit-note report fails. Both lists are supersets of the live ones; existing rows stay valid.

begin;

alter table public.company_settings drop constraint if exists company_settings_ai_provider_check;
alter table public.company_settings add constraint company_settings_ai_provider_check
  check (ai_provider in ('local_rules','nvidia','openai','anthropic','azure_openai','other'));

alter table public.saved_reports drop constraint if exists saved_reports_data_source_check;
alter table public.saved_reports add constraint saved_reports_data_source_check
  check (data_source in (
    'customers', 'quotes', 'orders', 'dispatches', 'invoices', 'payments', 'credit_notes',
    'expenses', 'expense_payments', 'inventory', 'production_jobs',
    'scrap_records', 'dies', 'quality_tests', 'vendors', 'purchases',
    'packaging_material_purchases'
  ));

commit;

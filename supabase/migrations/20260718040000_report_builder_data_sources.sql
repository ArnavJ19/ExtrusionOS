-- Keep saved report validation aligned with the report sources exposed by the app.
alter table public.saved_reports
  drop constraint if exists saved_reports_data_source_check;

alter table public.saved_reports
  add constraint saved_reports_data_source_check
  check (data_source in (
    'customers', 'quotes', 'orders', 'dispatches', 'invoices', 'payments',
    'expenses', 'expense_payments', 'inventory', 'production_jobs',
    'scrap_records', 'dies', 'quality_tests', 'vendors', 'purchases',
    'packaging_material_purchases'
  ));

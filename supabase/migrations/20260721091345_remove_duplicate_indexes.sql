-- Remove redundant indexes reported by the Supabase performance advisor.
-- Constraint-backed indexes are retained.
drop index if exists public.dealer_orders_company_order_number_unique;
drop index if exists public.idx_pcda_alloy_standards_co;
drop index if exists public.idx_pcda_alloys_co;
drop index if exists public.idx_pcda_defect_types_co;
drop index if exists public.idx_pcda_finish_types_co;
drop index if exists public.idx_pcda_quality_params_co;
drop index if exists public.idx_pcda_tempers_co;
drop index if exists public.tasks_company_assigned_to_idx;

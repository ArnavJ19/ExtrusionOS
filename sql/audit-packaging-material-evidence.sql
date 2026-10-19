-- Read-only review of retained packaging material evidence.
-- Net movement agreement cannot prove historical authorship or a physical stock balance.
with movement_totals as (
  select company_id,packaging_job_id job_id,material_id,
    sum(case when movement_type='issue' then quantity else -quantity end) net_issued
  from public.packaging_material_movements group by company_id,packaging_job_id,material_id
), material_totals as (
  select company_id,job_id,material_id,sum(quantity_required) current_required
  from public.packaging_job_materials group by company_id,job_id,material_id
), sources as (
  select coalesce(m.company_id,r.company_id) company_id,coalesce(m.job_id,r.job_id) job_id,
    coalesce(m.material_id,r.material_id) material_id,coalesce(m.net_issued,0) net_issued,coalesce(r.current_required,0) current_required
  from movement_totals m full join material_totals r using(company_id,job_id,material_id)
), issues as (
  select s.company_id,s.job_id,s.material_id,s.net_issued,s.current_required,
    case when j.status='cancelled' then 0 else s.current_required end expected_net_issued,
    case when j.id is null or j.company_id is distinct from s.company_id then 'Missing or cross-company packaging source'
      when p.id is null or p.company_id is distinct from s.company_id then 'Missing or cross-company material source'
      else 'Retained movement total disagrees with the current material disposition' end review_reason
  from sources s left join public.packaging_jobs j on j.id=s.job_id left join public.packaging_materials p on p.id=s.material_id
  where j.id is null or j.company_id is distinct from s.company_id or p.id is null or p.company_id is distinct from s.company_id
    or abs(s.net_issued-case when j.status='cancelled' then 0 else s.current_required end)>0.001
)
select * from issues order by company_id,job_id,material_id;

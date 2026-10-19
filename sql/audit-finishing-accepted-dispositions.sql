-- Read-only historical review. No receipt links or quantities are inferred or changed.
-- to_jsonb keeps legacy packaging readable before finishing_job_id is present.
with source_totals as (
  select company_id,production_job_id,
    sum(input_weight_kg) filter(where retry_of_finishing_job_id is null) root_input_kg,
    sum(output_weight_kg) filter(where status in ('completed','rejected')) accepted_kg
  from public.finishing_jobs group by company_id,production_job_id
), issues as (
  select 'finishing_job'::text entity,f.id,f.company_id,f.production_job_id,
    'Invalid production, receipt or quantity evidence'::text review_reason
  from public.finishing_jobs f left join public.production_jobs j on j.id=f.production_job_id and j.company_id=f.company_id
  where j.id is null or j.status<>'completed' or j.order_id is distinct from f.order_id or j.finishing_type is distinct from f.finishing_type
    or coalesce(f.input_weight_kg,0)<=0 or coalesce(f.output_weight_kg,0)<0 or coalesce(f.rejection_weight_kg,0)<0
    or (f.status in ('completed','rejected') and (coalesce(f.output_weight_kg,0)+coalesce(f.rejection_weight_kg,0)>f.input_weight_kg+0.01
      or (f.output_weight_kg>0 and (f.received_date is null or f.received_date>(now() at time zone 'Asia/Kolkata')::date
        or (f.sent_date is not null and f.received_date<f.sent_date)))))
  union all
  select 'production_job',j.id,j.company_id,j.id,'Root input or total accepted finishing exceeds captured production'
  from public.production_jobs j join source_totals t on t.company_id=j.company_id and t.production_job_id=j.id
  where t.root_input_kg>j.actual_quantity_kg+0.001 or t.accepted_kg>j.actual_quantity_kg+0.001
  union all
  select 'finishing_retry',child.id,child.company_id,child.production_job_id,'Retry source or recoverable input requires review'
  from public.finishing_jobs child left join public.finishing_jobs parent on parent.id=child.retry_of_finishing_job_id
  where child.retry_of_finishing_job_id is not null and (parent.id is null or parent.company_id is distinct from child.company_id
    or parent.production_job_id is distinct from child.production_job_id or parent.order_id is distinct from child.order_id
    or parent.finishing_type is distinct from child.finishing_type or parent.status is distinct from 'rejected'
    or abs(child.input_weight_kg-least(coalesce(parent.rejection_weight_kg,0),greatest(parent.input_weight_kg-coalesce(parent.output_weight_kg,0),0)))>0.01)
  union all
  select 'packaging_job',p.id,p.company_id,p.production_job_id,
    case when nullif(to_jsonb(p)->>'finishing_job_id','') is null then 'Legacy packaging has no recorded finishing receipt link'
      else 'Packaging receipt identity or quantity requires review' end
  from public.packaging_jobs p join public.production_jobs j on j.id=p.production_job_id and j.company_id=p.company_id
    left join public.finishing_jobs f on f.id::text=to_jsonb(p)->>'finishing_job_id'
  where coalesce(j.finishing_type,'mill_finish')<>'mill_finish' and p.status<>'cancelled'
    and (f.id is null or f.company_id is distinct from p.company_id or f.production_job_id is distinct from p.production_job_id
      or f.order_id is distinct from p.order_id or f.status not in ('completed','rejected') or f.output_weight_kg<=0
      or p.profile_weight_kg<0 or p.profile_weight_kg>f.output_weight_kg+0.001)
  union all
  select 'packaging_receipt',f.id,f.company_id,f.production_job_id,'Combined active packages exceed accepted receipt output'
  from public.finishing_jobs f join public.packaging_jobs p on to_jsonb(p)->>'finishing_job_id'=f.id::text and p.company_id=f.company_id
  where p.status<>'cancelled' group by f.id,f.company_id,f.production_job_id,f.output_weight_kg
  having sum(p.profile_weight_kg)>f.output_weight_kg+0.001
)
select * from issues order by company_id,production_job_id,entity,id;

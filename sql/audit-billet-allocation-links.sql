-- Read-only historical review; no linkage, counter, status or physical stock correction.
-- Metadata/compatibility findings do not establish measured material adequacy or physical inventory.
select b.company_id,b.id billet_id,b.order_id,b.allocation_requirement_id,b.production_job_id,b.status,
  case when b.allocation_requirement_id is null then 'unlinked_legacy_billet'
    when r.id is null then 'missing_requirement'
    when b.company_id is distinct from r.company_id or b.order_id is distinct from r.order_id then 'inconsistent_scope'
    when b.production_job_id is not null and not exists(select 1 from public.production_jobs j where j.id=b.production_job_id
      and j.company_id=b.company_id and j.order_id is not distinct from b.order_id and j.profile_id=r.profile_id) then 'inconsistent_production_identity'
    else 'incompatible_material_identity' end review_reason
from public.foundry_billets b left join public.order_billet_requirements r on r.id=b.allocation_requirement_id
where b.status in ('allocated','issued','consumed') and (b.order_id is not null or b.allocation_requirement_id is not null)
  and (b.allocation_requirement_id is null or r.id is null
    or b.company_id is distinct from r.company_id or b.order_id is distinct from r.order_id
    or lower(btrim(coalesce(b.alloy,'')))<>lower(btrim(coalesce(r.alloy,'')))
    or lower(btrim(coalesce(b.temper,'')))<>lower(btrim(coalesce(r.temper,'')))
    or b.billet_diameter_inch is distinct from r.billet_diameter_inch
    or (b.production_job_id is not null and not exists(select 1 from public.production_jobs j where j.id=b.production_job_id
      and j.company_id=b.company_id and j.order_id is not distinct from b.order_id and j.profile_id=r.profile_id)))
order by b.company_id,b.order_id,b.id;

with counts as (
  select r.company_id,r.order_id,r.id requirement_id,r.billets_required,r.billets_allocated,r.billets_short,r.status,
    count(b.id)::integer actual_linked_count
  from public.order_billet_requirements r left join public.foundry_billets b
    on b.company_id=r.company_id and b.order_id=r.order_id and b.allocation_requirement_id=r.id
      and b.status in ('allocated','issued','consumed')
  group by r.id,r.company_id,r.order_id,r.billets_required,r.billets_allocated,r.billets_short,r.status
)
select * from counts where actual_linked_count>billets_required
  or billets_allocated is distinct from least(actual_linked_count,billets_required)
  or billets_short is distinct from greatest(billets_required-actual_linked_count,0)
order by company_id,order_id,requirement_id;

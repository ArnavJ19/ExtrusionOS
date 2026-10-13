-- Read-only deployment preflight for S01-S03. Run against isolated staging first.
-- A row requires investigation; this query never repairs or invents history.
-- A clean result cannot reconstruct earlier mass/source edits or prove live RLS.
with active_batches as (
  select * from public.foundry_batches where status <> 'cancelled'
), inventory_counts as (
  select b.company_id, b.id as batch_id, b.billet_count,
         count(fb.id) filter (where fb.status <> 'cancelled') as active_count,
         count(fb.id) filter (
           where fb.status <> 'cancelled'
             and (fb.billet_number < 1 or fb.billet_number > b.billet_count)
         ) as outside_count
  from active_batches b
  left join public.foundry_billets fb
    on fb.foundry_batch_id = b.id and fb.source_type = 'in_house'
  group by b.company_id, b.id, b.billet_count
), findings as (
  select 'S01_SCRAP_SOURCE_MISSING_OR_FOREIGN'::text as issue,
         b.company_id, b.id as batch_id, null::uuid as billet_id,
         jsonb_build_object('source_id', b.scrap_id, 'charge_kg', b.scrap_aluminium_kg) as details
  from active_batches b
  left join public.foundry_aluminium_scrap s
    on s.id = b.scrap_id and s.company_id = b.company_id
  where (coalesce(b.scrap_aluminium_kg, 0) > 0 or coalesce(b.scrap_percentage, 0) > 0)
    and s.id is null

  union all
  select 'S01_EXTERNAL_SOURCE_MISSING_OR_FOREIGN', b.company_id, b.id, null::uuid,
         jsonb_build_object('source_id', b.external_source_id, 'charge_kg', b.external_aluminium_kg)
  from active_batches b
  left join public.foundry_external_aluminium_sources s
    on s.id = b.external_source_id and s.company_id = b.company_id
  where (coalesce(b.external_aluminium_kg, 0) > 0 or coalesce(b.external_aluminium_percentage, 0) > 0)
    and s.id is null

  union all
  select 'S01_SCRAP_SOURCE_UNUSABLE', b.company_id, b.id, null::uuid,
         jsonb_build_object('source_id', s.id, 'source_status', s.status,
                            'charge_kg', b.scrap_aluminium_kg)
  from active_batches b
  join public.foundry_aluminium_scrap s
    on s.id = b.scrap_id and s.company_id = b.company_id
  where coalesce(b.scrap_aluminium_kg, 0) > 0
    and s.status not in ('available', 'reserved', 'used')

  union all
  select 'S01_EXTERNAL_SOURCE_UNUSABLE', b.company_id, b.id, null::uuid,
         jsonb_build_object('source_id', s.id, 'source_status', s.status,
                            'charge_kg', b.external_aluminium_kg)
  from active_batches b
  join public.foundry_external_aluminium_sources s
    on s.id = b.external_source_id and s.company_id = b.company_id
  where coalesce(b.external_aluminium_kg, 0) > 0
    and s.status not in ('available', 'reserved', 'used')

  union all
  select 'S02_BILLET_COUNT_MISMATCH', company_id, batch_id, null::uuid,
         jsonb_build_object('accepted_count', billet_count, 'active_count', active_count,
                            'outside_count', outside_count)
  from inventory_counts
  where active_count <> billet_count or outside_count > 0

  union all
  select 'S03_BILLET_PHYSICAL_MISMATCH', b.company_id, b.id, fb.id,
         jsonb_build_object('billet_number', fb.billet_number, 'status', fb.status,
                            'billet_weight_kg', fb.weight_kg,
                            'batch_weight_kg', b.billet_weight_density_kg)
  from public.foundry_batches b
  join public.foundry_billets fb on fb.foundry_batch_id = b.id and fb.source_type = 'in_house'
  where fb.status <> 'cancelled'
    and (fb.company_id is distinct from b.company_id
      or fb.weight_kg is distinct from b.billet_weight_density_kg
      or fb.billet_length_mm is distinct from b.billet_length_mm
      or fb.billet_diameter_mm is distinct from b.billet_diameter_mm
      or fb.billet_diameter_inch is distinct from b.billet_diameter_inch
      or fb.alloy is distinct from b.alloy
      or fb.temper is distinct from b.temper)

  union all
  select 'S03_CANCELLED_BATCH_COMMITTED_BILLET', b.company_id, b.id, fb.id,
         jsonb_build_object('billet_number', fb.billet_number, 'status', fb.status,
                            'order_id', fb.order_id, 'production_job_id', fb.production_job_id)
  from public.foundry_batches b
  join public.foundry_billets fb on fb.foundry_batch_id = b.id and fb.source_type = 'in_house'
  where b.status = 'cancelled'
    and (fb.status in ('allocated', 'issued', 'consumed', 'scrap')
      or fb.order_id is not null or fb.allocation_requirement_id is not null
      or fb.production_job_id is not null)

  union all
  select 'SOURCE_AVAILABLE_WEIGHT_OUT_OF_RANGE', company_id, null::uuid, null::uuid,
         jsonb_build_object('source_type', 'scrap', 'source_id', id,
                            'available_weight_kg', available_weight_kg)
  from public.foundry_aluminium_scrap
  where available_weight_kg < 0 or available_weight_kg > weight_kg

  union all
  select 'SOURCE_AVAILABLE_WEIGHT_OUT_OF_RANGE', company_id, null::uuid, null::uuid,
         jsonb_build_object('source_type', 'external', 'source_id', id,
                            'available_weight_kg', available_weight_kg)
  from public.foundry_external_aluminium_sources
  where available_weight_kg < 0 or available_weight_kg > weight_kg
)
select issue, company_id, batch_id, billet_id, details
from findings
order by issue, company_id, batch_id, billet_id;

-- Data repair found during the ERP audit (21 Oct 2026): foundry batch FB-2026-0001
-- is 'cancelled' (cancelled 30 May 2026, before the batch guards existed), yet its 24
-- billets (6,855.864 kg) stayed 'allocated' to order O-2026-0009. The batch was
-- charged with 300 kg of metal, so those billets never physically existed, but they
-- count as 24 of the order's 33 allocated billets and hide a real shortage.
--
-- guard_foundry_batch_material_integrity now rejects cancelling a batch that has
-- committed billets, so this cannot recur; this migration repairs the legacy rows.
--
-- Rule-based (no hard-coded ids): every in-house billet of a cancelled foundry batch
-- that is still 'cast' or 'allocated' and is not linked to a production job is
-- cancelled and unlinked from its order. Issued, consumed or job-linked billets would
-- mean metal really moved; none exist on hosted, and they are left untouched for review.
-- Each repaired billet is written to audit_logs (action 'data_repair'), then every
-- affected order's billet requirements are recounted by refresh_order_billet_allocations.
--
-- The in-house billet guard rejects cancelling a linked billet (correctly, for normal
-- use), so it is disabled for this one statement only and re-enabled in the same
-- transaction. All other triggers (lineage, allocation, updated_at) still run.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create temporary table phantom_billets on commit drop as
select b.id, b.company_id, b.order_id, b.allocation_requirement_id, b.billet_code, b.status, b.weight_kg,
  f.id as foundry_batch_id, f.batch_number
from public.foundry_billets b
join public.foundry_batches f on f.id = b.foundry_batch_id and f.company_id = b.company_id
where f.status = 'cancelled'
  and coalesce(b.source_type, 'in_house') <> 'outsourced'
  and b.status in ('cast', 'allocated')
  and b.production_job_id is null;

insert into public.audit_logs (company_id, actor_id, action, entity_type, entity_id, metadata_json)
select p.company_id, null, 'data_repair', 'foundry_billets', p.id,
  jsonb_build_object(
    'reason', 'Billet of a cancelled foundry batch was never cast; cancelled and released from its order (ERP audit 21-10-2026)',
    'billet_code', p.billet_code, 'previous_status', p.status, 'weight_kg', p.weight_kg,
    'foundry_batch', p.batch_number, 'order_id', p.order_id, 'allocation_requirement_id', p.allocation_requirement_id)
from phantom_billets p;

alter table public.foundry_billets disable trigger guard_foundry_billet_material_integrity;
update public.foundry_billets b
set status = 'cancelled', order_id = null, allocation_requirement_id = null,
    allocated_at = null, allocated_by = null, updated_at = now()
from phantom_billets p
where b.id = p.id;
alter table public.foundry_billets enable trigger guard_foundry_billet_material_integrity;

select public.refresh_order_billet_allocations(o.order_id)
from (select distinct order_id from phantom_billets where order_id is not null) o;

commit;

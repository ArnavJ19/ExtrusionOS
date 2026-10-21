-- Follow-up to EXOS-AUD-003 / 008 / 029: reconcile drifted metal-source rows and
-- validate the constraints Wave 1 added NOT VALID.
--
-- Rule-based (no hard-coded ids):
--   1. Any purchased metal receipt heavier than the company's per-receipt limit
--      (company_settings.metal_receipt_max_kg, default 60,000 kg) is implausible
--      (live: SCR-2026-0001/0002 at 1,000 t, EAS-2026-0003 at 100,000 t). Its true
--      weight cannot be derived, so it is put on a 'rejected' hold with a note: it
--      can no longer be charged until someone records the weighbridge weight and
--      releases it. The hold is reversible; nothing is deleted or re-weighed.
--   2. Remaining rows get the status their balance implies
--      (available / reserved / used), as the EXOS-AUD-003 guard now maintains.
--   3. The three NOT VALID CHECK constraints are validated (all live rows satisfy
--      them at the time of writing).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

update public.foundry_aluminium_scrap s
set status = 'rejected',
    notes = concat_ws(E'\n', nullif(s.notes, ''), concat('Held 21-10-2026 (ERP audit reconciliation): received weight ', s.weight_kg,
      ' kg exceeds the per-receipt limit; record the weighbridge weight before releasing.'))
from public.company_settings cs
where cs.company_id = s.company_id and coalesce(s.scrap_source, '') <> 'in_house'
  and s.weight_kg > coalesce(cs.metal_receipt_max_kg, 60000) and s.status <> 'rejected';

update public.foundry_external_aluminium_sources e
set status = 'rejected',
    notes = concat_ws(E'\n', nullif(e.notes, ''), concat('Held 21-10-2026 (ERP audit reconciliation): received weight ', e.weight_kg,
      ' kg exceeds the per-receipt limit; record the weighbridge weight before releasing.'))
from public.company_settings cs
where cs.company_id = e.company_id and e.weight_kg > coalesce(cs.metal_receipt_max_kg, 60000) and e.status not in ('rejected','returned');

update public.foundry_aluminium_scrap s
set status = case when coalesce(s.available_weight_kg, s.weight_kg) >= s.weight_kg then 'available'
  when coalesce(s.available_weight_kg, s.weight_kg) <= 0 then 'used' else 'reserved' end
where s.status in ('available','reserved','used')
  and s.status is distinct from case when coalesce(s.available_weight_kg, s.weight_kg) >= s.weight_kg then 'available'
    when coalesce(s.available_weight_kg, s.weight_kg) <= 0 then 'used' else 'reserved' end;

update public.foundry_external_aluminium_sources e
set status = case when coalesce(e.available_weight_kg, e.weight_kg) >= e.weight_kg then 'available'
  when coalesce(e.available_weight_kg, e.weight_kg) <= 0 then 'used' else 'reserved' end
where e.status in ('available','reserved','used')
  and e.status is distinct from case when coalesce(e.available_weight_kg, e.weight_kg) >= e.weight_kg then 'available'
    when coalesce(e.available_weight_kg, e.weight_kg) <= 0 then 'used' else 'reserved' end;

alter table public.foundry_aluminium_scrap validate constraint foundry_scrap_available_within_weight;
alter table public.foundry_external_aluminium_sources validate constraint foundry_external_available_within_weight;
alter table public.machines validate constraint machines_status_check;

commit;

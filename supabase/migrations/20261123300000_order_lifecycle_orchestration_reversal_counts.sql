-- Order lifecycle orchestration: QC quantities after a reversal (found while checking the Phase 4 screens).
--
--   1. "Produced but not yet inspected" summed every QC record of a job. A reversed approval and the child records that
--      carry its kilograms were then counted twice (and so were a resolved rework record and its approved/rejected
--      children), which understated uninspected output: the reproduction check saw too little supply, and a containment
--      could not be opened for output that was really still undispositioned. One helper now counts each kilogram once
--      (it leaves out reversed records and resolved rework sources), used by the order supply and the containment
--      "open" and "candidates" checks.
--   2. The containment "candidates" command (batch 2) failed on every call: its query used the alias "c", which is also
--      a variable of the function. The containment screen showed no job to hold. The alias is renamed.
--   3. The reversal command marked the approval reversed before writing its child records, and the engine evaluated
--      the order in between, so the reproduction task and its alert were raised with 0 kg accepted. The engine now waits
--      until the reversal is complete and evaluates once, with the final quantities.
-- The containment command (batch 2) and the reversal command (Phase 4) are patched in place: each replaced fragment is
-- checked to occur exactly once, so the migration stops instead of changing anything else.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '180s';

-- QC kilograms of a job's output (before finishing) already given a QC record, each kilogram once.
create or replace function private.olo_qc_dispositioned_kg(p_job uuid) returns numeric
language sql stable security definer set search_path = public, private as $$
  select coalesce(sum(q.quantity_checked_kg), 0) from public.quality_inspections q
  where q.production_job_id = p_job and q.finishing_job_id is null and q.status <> 'reversed'
    and not exists (select 1 from public.quality_rework_resolutions r where r.source_inspection_id = q.id)
$$;
revoke all on function private.olo_qc_dispositioned_kg(uuid) from public, anon, authenticated;

create or replace function private.olo_order_supply(p_company uuid, p_order uuid) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare o public.orders%rowtype; v_target numeric; v_ok numeric; v_pending numeric; v_rej numeric; v_held numeric; v_uninspected numeric; v_open numeric; v_short_closed boolean;
begin
  select * into o from public.orders where id = p_order and company_id = p_company;
  if not found then return null; end if;
  v_target := coalesce(nullif(o.manufacturing_weight_kg, 0), nullif(o.requested_weight_kg, 0), (select sum(i.quantity_kg) from public.order_items i where i.order_id = o.id), 0);
  select coalesce(sum(q.quantity_checked_kg) filter (where q.status = 'approved'), 0), coalesce(sum(q.quantity_checked_kg) filter (where q.status in ('pending','rework')), 0),
    coalesce(sum(q.quantity_checked_kg) filter (where q.status = 'rejected'), 0)
    into v_ok, v_pending, v_rej
  from public.quality_inspections q join public.production_jobs j on j.id = q.production_job_id where q.company_id = p_company and j.order_id = o.id and q.finishing_job_id is null;
  select coalesce(sum(c.scope_kg - c.released_accepted_kg - c.released_rejected_kg), 0) into v_held from public.quality_containments c
    where c.company_id = p_company and c.order_id = o.id and c.status in ('open','partially_resolved');
  -- Reversal fix: each kilogram that already has a QC record is counted once.
  select coalesce(sum(greatest(coalesce(j.actual_quantity_kg, 0) - private.olo_qc_dispositioned_kg(j.id)
      - coalesce((select sum(c.scope_kg) from public.quality_containments c where c.production_job_id = j.id and c.status in ('open','partially_resolved')), 0), 0)), 0)
    into v_uninspected from public.production_jobs j where j.company_id = p_company and j.order_id = o.id and j.status = 'completed';
  select coalesce(sum(greatest(coalesce(j.planned_quantity_kg, 0) - coalesce(j.actual_quantity_kg, 0), 0)), 0) into v_open
    from public.production_jobs j where j.company_id = p_company and j.order_id = o.id and j.status in ('planned','ready','on_hold','in_progress');
  v_short_closed := exists (select 1 from public.order_delivery_short_closures s where s.company_id = p_company and s.order_id = o.id);
  return jsonb_build_object('target', v_target, 'accepted', v_ok, 'pending', v_pending, 'held', v_held, 'rejected', v_rej, 'uninspected', v_uninspected, 'open_production', v_open,
    'shortfall', greatest(v_target - v_ok - v_pending - v_held - v_uninspected - v_open, 0), 'short_closed', v_short_closed,
    'active', o.deleted_at is null and o.current_stage not in ('closed','cancelled','delivered','payment_pending'));
end;
$$;

-- Patches a function's definition: every fragment must occur exactly once, or nothing is changed.
do $$
declare
  v_def text;
  v_patch record;
begin
  for v_patch in select * from (values
      ('private.olo_containment_command_b2(text,jsonb)',
       'coalesce((select sum(qi.quantity_checked_kg) from public.quality_inspections qi where qi.production_job_id = pj.id and qi.finishing_job_id is null), 0)',
       'private.olo_qc_dispositioned_kg(pj.id)'),
      ('private.olo_containment_command_b2(text,jsonb)',
       'coalesce((select sum(q.quantity_checked_kg) from public.quality_inspections q where q.production_job_id = j.id and q.finishing_job_id is null), 0)',
       'private.olo_qc_dispositioned_kg(j.id)'),
      -- Batch 2 bug: the candidates query aliased a table as "c", the name of a record variable of the function, so
      -- every call failed ("column reference is ambiguous") and the hold-a-lot form never offered a job.
      ('private.olo_containment_command_b2(text,jsonb)',
       'not exists (select 1 from public.quality_containments c where c.production_job_id = pj.id and c.status in (''open'',''partially_resolved''))',
       'not exists (select 1 from public.quality_containments hc where hc.production_job_id = pj.id and hc.status in (''open'',''partially_resolved''))'),
      ('public.quality_reversal_command(text,jsonb)',
       '  insert into private.quality_reversal_authorizations(transaction_id, inspection_id, reversal_id) values (txid_current(), q.id, v_id);',
       E'  -- Reversal fix: the engine evaluates once, after the approval and its child records are all written.\n  perform set_config(''olo.engine'', ''running'', true);\n  insert into private.quality_reversal_authorizations(transaction_id, inspection_id, reversal_id) values (txid_current(), q.id, v_id);')
    ) p(fn, old_text, new_text)
  loop
    v_def := pg_get_functiondef(v_patch.fn::regprocedure);
    if (length(v_def) - length(replace(v_def, v_patch.old_text, ''))) / length(v_patch.old_text) <> 1 then
      raise exception 'Reversal-count patch: the expected fragment of % was not found exactly once', v_patch.fn;
    end if;
    execute replace(v_def, v_patch.old_text, v_patch.new_text);
  end loop;
end;
$$;

commit;

-- Order lifecycle orchestration: a QC reversal is no longer blocked by a packaging job that is only queued.
--
-- Completing a mill-finish run creates a 'scheduled' packaging job for the run's full output ("queued after
-- extrusion"). Phase 3/4 counted every packaging job that was not cancelled as material that had moved on past QC, so
-- QA could not reverse any approval of a completed run until someone cancelled that queue entry, and a revoked
-- approval raised a recall alert for material that had not been packed. A scheduled packaging job has packed nothing
-- (packaging jobs carry no QC cap; bundles and dispatches are capped by approved kilograms), so:
--   1. Only packaging that has started ('in_progress' or 'completed') counts as moved on, for every caller: the QC
--      reversal limit, the revocation recall alert and the final QC after ageing.
--   2. After a reversal, when a still-queued packaging job of the job is larger than what remains approved (less
--      packaging already started), packaging and production planning are told to pack only QC-approved material and
--      to correct or cancel the queue entry. The packaging job itself is not changed.
--   3. The reversal history list gets server-side search (reversal, approval batch, job, order, reason, reference), an
--      outcome filter (rejected / rework) and sorting by date, kilograms or number.
-- Redefines olo_job_consumed_kg (marked "Queued packaging:") and wraps quality_reversal_command; nothing else changes.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '180s';

-- Queued packaging: a 'scheduled' packaging job is a queue entry, not packed material. During a final QC after ageing
-- the job's ageing loads are the material being dispositioned (Phase 5).
create or replace function private.olo_job_consumed_kg(p_company uuid, p_job uuid) returns numeric
language sql stable security definer set search_path = public, private as $$
  select greatest(
    coalesce((select sum(x.profile_weight_kg) from public.packaging_jobs x where x.company_id = p_company and x.production_job_id = p_job
      and x.status in ('in_progress','completed')), 0),
    coalesce((select sum(x.net_weight_kg) from public.packing_list_items x where x.company_id = p_company and x.source_kind = 'production' and x.source_line_id = p_job), 0)
      + coalesce((select sum(x.gross_weight_kg - x.tare_weight_kg) from public.prepared_physical_bundles x where x.company_id = p_company and x.source_kind = 'production'
          and x.source_line_id = p_job and x.dispatch_id is null), 0),
    case when coalesce(current_setting('olo.final_qc_job', true), '') = p_job::text then 0
      else coalesce((select sum(x.quantity_kg) from public.treatment_inputs x where x.company_id = p_company and x.production_job_id = p_job), 0) end)
$$;
revoke all on function private.olo_job_consumed_kg(uuid, uuid) from public, anon, authenticated;

-- The Phase 4 command keeps every rule; the wrapper flags a queued packaging job that the reversal left too large.
alter function public.quality_reversal_command(text, jsonb) rename to olo_quality_reversal_command_p4;
alter function public.olo_quality_reversal_command_p4(text, jsonb) set schema private;
revoke all on function private.olo_quality_reversal_command_p4(text, jsonb) from public, anon, authenticated;

create or replace function public.quality_reversal_command(p_command text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v jsonb; r public.quality_reversals%rowtype; v_job public.production_jobs%rowtype;
  v_approved numeric; v_started numeric; v_over numeric; v_room numeric; pk record; v_flagged jsonb := '[]'::jsonb;
  a jsonb; v_payload jsonb := coalesce(p_payload, '{}'::jsonb); v_page integer; v_rows jsonb; v_total bigint; v_search text; v_as text; v_sort text; v_dir text;
begin
  -- Reversal history: server-side search, outcome filter and sorting, 10 per page (the Phase 4 list had a page only).
  if p_command = 'list' then
    a := private.olo_actor(private.olo_reader_roles());
    perform private.olo_keys(v_payload, array['page','job_id','order_id','search','reversed_as','sort','direction']);
    v_page := private.olo_page(v_payload);
    v_search := lower(btrim(coalesce(v_payload ->> 'search', '')));
    if length(v_search) > 80 then raise exception 'Search for at most 80 characters' using errcode = '22023'; end if;
    v_as := nullif(v_payload ->> 'reversed_as', '');
    if v_as is not null and v_as not in ('rejected','rework') then raise exception 'Unknown outcome' using errcode = '22023'; end if;
    v_sort := coalesce(nullif(v_payload ->> 'sort', ''), 'reversed_at');
    if v_sort not in ('reversed_at','reversed_kg','reversal_number') then raise exception 'Unknown sort' using errcode = '22023'; end if;
    v_dir := coalesce(nullif(v_payload ->> 'direction', ''), 'desc');
    if v_dir not in ('asc','desc') then raise exception 'Unknown sort direction' using errcode = '22023'; end if;
    select coalesce(jsonb_agg(private.olo_reversal_json((a ->> 'company')::uuid, x.id) order by x.ord), '[]'::jsonb), max(x.total) into v_rows, v_total from (
      select y.id, count(*) over () total, row_number() over (order by
          case when v_sort = 'reversed_at' and v_dir = 'asc' then y.reversed_at end asc, case when v_sort = 'reversed_at' and v_dir = 'desc' then y.reversed_at end desc,
          case when v_sort = 'reversed_kg' and v_dir = 'asc' then y.reversed_kg end asc, case when v_sort = 'reversed_kg' and v_dir = 'desc' then y.reversed_kg end desc,
          case when v_sort = 'reversal_number' and v_dir = 'asc' then y.reversal_number end asc, case when v_sort = 'reversal_number' and v_dir = 'desc' then y.reversal_number end desc,
          y.reversed_at desc, y.id) ord
      from (select rv.id, rv.reversed_at, rv.reversed_kg, rv.reversal_number from public.quality_reversals rv
          left join public.quality_inspections qi on qi.id = rv.quality_inspection_id left join public.production_jobs pj on pj.id = rv.production_job_id
          left join public.orders od on od.id = rv.order_id
          where rv.company_id = (a ->> 'company')::uuid
            and (v_payload ->> 'job_id' is null or rv.production_job_id = (v_payload ->> 'job_id')::uuid)
            and (v_payload ->> 'order_id' is null or rv.order_id = (v_payload ->> 'order_id')::uuid)
            and (v_as is null or rv.reversed_as = v_as)
            and (v_search = '' or position(v_search in lower(concat_ws(' ', rv.reversal_number, qi.batch_number, pj.job_number, od.order_number, rv.reason, rv.reference))) > 0)) y
      order by ord offset (v_page - 1) * 10 limit 10) x;
    return jsonb_build_object('page', v_page, 'page_size', 10, 'total', coalesce(v_total, 0), 'rows', v_rows, 'can_reverse', (a ->> 'role') in ('owner','quality'),
      'search', v_search, 'reversed_as', v_as, 'sort', v_sort, 'direction', v_dir);
  end if;
  v := private.olo_quality_reversal_command_p4(p_command, p_payload);
  if p_command <> 'reverse' or v is null then return v; end if;
  select * into r from public.quality_reversals where id = (v ->> 'id')::uuid;
  -- Packaging jobs of a run's own output (not of a finishing job) are compared with that output's approved kilograms.
  if r.id is null or r.finishing_job_id is not null then return v; end if;
  select * into v_job from public.production_jobs where id = r.production_job_id;
  select coalesce(sum(q.quantity_checked_kg), 0) into v_approved from public.quality_inspections q
    where q.company_id = r.company_id and q.production_job_id = r.production_job_id and q.finishing_job_id is null and q.status = 'approved';
  select coalesce(sum(x.profile_weight_kg), 0) into v_started from public.packaging_jobs x
    where x.company_id = r.company_id and x.production_job_id = r.production_job_id and x.finishing_job_id is null and x.status in ('in_progress','completed');
  v_room := greatest(v_approved - v_started, 0);
  for pk in select x.id, x.packaging_number, x.profile_weight_kg from public.packaging_jobs x
      where x.company_id = r.company_id and x.production_job_id = r.production_job_id and x.finishing_job_id is null and x.status = 'scheduled'
      order by x.created_at, x.id loop
    v_over := round(pk.profile_weight_kg - v_room, 3);
    v_room := greatest(v_room - pk.profile_weight_kg, 0);
    continue when v_over <= 0.5;
    v_flagged := v_flagged || jsonb_build_array(jsonb_build_object('packaging_job_id', pk.id, 'packaging_number', pk.packaging_number, 'scheduled_kg', pk.profile_weight_kg, 'over_kg', v_over));
    perform private.olo_event(r.company_id, 'packaging.queue_over_approved', r.order_id, r.production_job_id, 'packaging',
      format('Packaging job %s is queued for %s but only %s of job %s stays QC-approved after %s', coalesce(pk.packaging_number, '-'), private.olo_fmt_kg(pk.profile_weight_kg),
        private.olo_fmt_kg(v_approved), coalesce(v_job.job_number, '-'), r.reversal_number),
      jsonb_build_object('reversal_id', r.id, 'packaging_job_id', pk.id, 'over_kg', v_over), 'pkg-over:' || pk.id || ':' || r.id);
    perform private.ap3_notify_roles(r.company_id, private.olo_uniq(private.olo_roles(r.company_id, 'packaging', 0) || private.olo_roles(r.company_id, 'production_planning', 0)),
      'olo_packaging_over_approved', 'warning', format('Packaging job larger than the approved material: %s', coalesce(pk.packaging_number, v_job.job_number)),
      format('QC reversal %s reduced the approved material of job %s to %s. Packaging job %s is still queued for %s, %s more than remains approved after packaging already started. Pack only QC-approved material — bundles beyond it are refused — and correct or cancel the packaging job.',
        r.reversal_number, coalesce(v_job.job_number, '-'), private.olo_fmt_kg(v_approved), coalesce(pk.packaging_number, '-'), private.olo_fmt_kg(pk.profile_weight_kg), private.olo_fmt_kg(v_over)),
      'packaging_job', pk.id, '/packaging', 'olo-pkg-over:' || pk.id || ':' || r.id, r.reversed_by);
  end loop;
  return v || jsonb_build_object('queued_packaging_over', v_flagged);
end;
$$;
revoke all on function public.quality_reversal_command(text, jsonb) from public, anon;
grant execute on function public.quality_reversal_command(text, jsonb) to authenticated;

commit;

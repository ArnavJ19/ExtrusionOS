-- UPGRADE_EOS feature 39: generated shift-handover summaries.
--
-- The outgoing supervisor chooses an explicit time window (presets are only suggestions). The
-- summary is assembled on the server from recorded activity, every production job appears once
-- with a single category, and the submitted snapshot is stored unchanged with the supervisor's
-- added context. A different supervisor acknowledges receipt exactly once.
-- Sources: production_jobs, production_job_holds, production_exceptions, breakdown_logs,
-- quality_inspections, profile_stock_batches, dispatches. Additive only.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.shift_handovers (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  period_start timestamptz not null,
  period_end timestamptz not null,
  shift_label text not null check (length(btrim(shift_label)) between 1 and 40),
  summary jsonb not null check (jsonb_typeof(summary) = 'object'),
  note text not null default '' check (length(note) <= 2000),
  prepared_by uuid not null references public.app_users(id),
  prepared_by_name text not null,
  prepared_at timestamptz not null default now(),
  status text not null default 'submitted' check (status in ('submitted','acknowledged')),
  acknowledged_by uuid references public.app_users(id),
  acknowledged_by_name text,
  acknowledged_at timestamptz,
  acknowledgement_note text check (acknowledgement_note is null or length(acknowledgement_note) <= 1000),
  check (period_end > period_start and period_end - period_start <= interval '24 hours'),
  check ((status = 'submitted' and acknowledged_by is null and acknowledged_at is null)
      or (status = 'acknowledged' and acknowledged_by is not null and acknowledged_at is not null and acknowledged_by <> prepared_by))
);
create unique index shift_handover_window_key on public.shift_handovers(company_id, period_start, period_end);
create index shift_handover_list_idx on public.shift_handovers(company_id, period_end desc, id);
create index shift_handover_prepared_by_idx on public.shift_handovers(prepared_by);
create index shift_handover_acknowledged_by_idx on public.shift_handovers(acknowledged_by);

alter table public.shift_handovers enable row level security;
revoke all on public.shift_handovers from public, anon, authenticated;
grant select on public.shift_handovers to authenticated;
create policy shift_handover_read on public.shift_handovers for select to authenticated
  using (company_id = private.get_current_user_company_id()
    and private.get_current_user_dealer_id() is null
    and private.get_current_user_role() in ('owner','admin','factory_manager','production_manager','production','quality','dispatch_manager','viewer'));

-- A resolved breakdown without an end time is treated as zero-length (its duration is unknown), so it
-- never inflates downtime; an unresolved one runs to the supplied open end.
create or replace function private.shift_breakdown_end(p_status text, p_start timestamptz, p_end timestamptz, p_resolved timestamptz, p_open_end timestamptz)
returns timestamptz language sql immutable set search_path = public, private as $$
  select coalesce(p_end, p_resolved, case when p_status = 'resolved' then p_start else p_open_end end)
$$;
revoke all on function private.shift_breakdown_end(text, timestamptz, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;

-- Every list is bounded; "truncated" tells the reader that more records exist than are shown.
create or replace function private.shift_handover_summary(p_company uuid, p_start timestamptz, p_end timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare
  v_limit constant integer := 100;
  v_jobs jsonb; v_jobs_total bigint;
  v_downtime jsonb; v_downtime_total bigint;
  v_exceptions jsonb; v_exceptions_total bigint;
  v_quality jsonb; v_quality_total bigint;
  v_stock_holds jsonb; v_stock_holds_total bigint;
  v_loads jsonb; v_loads_total bigint;
  v_business_end date := (p_end at time zone 'Asia/Kolkata')::date;
begin
  -- One row per job: completed inside the window, otherwise its current open state.
  with candidate as (
    select j.*, case when j.status = 'completed' then 'completed' when j.status = 'on_hold' then 'held' when j.status = 'in_progress' then 'running' else 'ready' end as category
    from public.production_jobs j
    where j.company_id = p_company
      and ((j.status = 'completed' and j.completed_at >= p_start and j.completed_at < p_end) or j.status in ('in_progress','on_hold','ready'))
  )
  select count(*) into v_jobs_total from candidate;
  with candidate as (
    select j.*, case when j.status = 'completed' then 'completed' when j.status = 'on_hold' then 'held' when j.status = 'in_progress' then 'running' else 'ready' end as category
    from public.production_jobs j
    where j.company_id = p_company
      and ((j.status = 'completed' and j.completed_at >= p_start and j.completed_at < p_end) or j.status in ('in_progress','on_hold','ready'))
  )
  select coalesce(jsonb_agg(row_data order by sort_key, job_number, id), '[]'::jsonb) into v_jobs from (
    select c.id, c.job_number,
      case c.category when 'held' then 1 when 'running' then 2 when 'ready' then 3 else 4 end as sort_key,
      jsonb_build_object(
        'id', c.id, 'job_number', c.job_number, 'category', c.category, 'status', c.status,
        'machine_name', m.machine_name, 'order_number', o.order_number,
        'planned_kg', c.planned_quantity_kg, 'actual_kg', c.actual_quantity_kg,
        'outstanding_kg', case when c.category = 'completed' or c.planned_quantity_kg is null then null
                               else greatest(c.planned_quantity_kg - coalesce(c.actual_quantity_kg, 0), 0) end,
        'completed_at', c.completed_at,
        'hold_reason', h.reason, 'hold_resume_condition', h.resume_condition, 'hold_responsible', h.responsible_name,
        'exceptions_in_window', (select count(*) from public.production_exceptions e where e.company_id = p_company and e.production_job_id = c.id and e.recorded_at >= p_start and e.recorded_at < p_end)
      ) as row_data
    from candidate c
    left join public.machines m on m.id = c.machine_id and m.company_id = p_company
    left join public.orders o on o.id = c.order_id and o.company_id = p_company
    left join public.production_job_holds h on h.production_job_id = c.id and h.company_id = p_company and h.status = 'active'
    order by sort_key, c.job_number, c.id
    limit v_limit
  ) jobs;

  -- Breakdowns overlapping the window; minutes are clipped to the window and an open one runs to its end.
  select count(*) into v_downtime_total from public.breakdown_logs b
  where b.company_id = p_company and b.start_time < p_end and private.shift_breakdown_end(b.status, b.start_time, b.end_time, b.resolved_at, 'infinity'::timestamptz) > p_start;
  select coalesce(jsonb_agg(row_data order by start_time, id), '[]'::jsonb) into v_downtime from (
    select b.id, b.start_time, jsonb_build_object(
      'id', b.id, 'machine_name', coalesce(m.machine_name, b.machine_id), 'status', b.status, 'issue', b.issue_description,
      'start_time', b.start_time, 'end_time', coalesce(b.end_time, b.resolved_at),
      'unresolved', b.status in ('open','in_progress','recurring'),
      'minutes_in_window', floor(extract(epoch from (least(private.shift_breakdown_end(b.status, b.start_time, b.end_time, b.resolved_at, p_end), p_end) - greatest(b.start_time, p_start))) / 60)::integer
    ) as row_data
    from public.breakdown_logs b
    left join public.machines m on m.id = b.machine_ref_id and m.company_id = p_company
    where b.company_id = p_company and b.start_time < p_end and private.shift_breakdown_end(b.status, b.start_time, b.end_time, b.resolved_at, 'infinity'::timestamptz) > p_start
    order by b.start_time, b.id limit v_limit
  ) d;

  select count(*) into v_exceptions_total from public.production_exceptions e where e.company_id = p_company and e.recorded_at >= p_start and e.recorded_at < p_end;
  select coalesce(jsonb_agg(row_data order by recorded_at, id), '[]'::jsonb) into v_exceptions from (
    select e.id, e.recorded_at, jsonb_build_object('id', e.id, 'job_id', e.production_job_id, 'job_number', j.job_number, 'reason', e.reason, 'note', e.note,
      'reporter_name', e.reporter_name, 'recorded_at', e.recorded_at) as row_data
    from public.production_exceptions e left join public.production_jobs j on j.id = e.production_job_id and j.company_id = p_company
    where e.company_id = p_company and e.recorded_at >= p_start and e.recorded_at < p_end
    order by e.recorded_at, e.id limit v_limit
  ) x;

  select count(*) into v_quality_total from public.quality_inspections q
  where q.company_id = p_company and q.inspection_date >= p_start and q.inspection_date < p_end and q.status in ('pending','rejected','rework');
  select coalesce(jsonb_agg(row_data order by inspection_date, id), '[]'::jsonb) into v_quality from (
    select q.id, q.inspection_date, jsonb_build_object('id', q.id, 'batch_number', q.batch_number, 'status', q.status, 'job_number', j.job_number,
      'quantity_checked_kg', q.quantity_checked_kg, 'inspection_date', q.inspection_date) as row_data
    from public.quality_inspections q left join public.production_jobs j on j.id = q.production_job_id and j.company_id = p_company
    where q.company_id = p_company and q.inspection_date >= p_start and q.inspection_date < p_end and q.status in ('pending','rejected','rework')
    order by q.inspection_date, q.id limit v_limit
  ) x;

  -- Current finished-stock quality holds (a state, not window activity).
  select count(*), coalesce(sum(total_weight_kg), 0) into v_stock_holds_total, v_stock_holds from public.profile_stock_batches s
  where s.company_id = p_company and s.qc_status = 'on_hold' and s.status in ('available','reserved');

  select count(*) into v_loads_total from public.dispatches d where d.company_id = p_company and d.delivery_status = 'pending' and d.dispatch_date <= v_business_end;
  select coalesce(jsonb_agg(row_data order by dispatch_date, id), '[]'::jsonb) into v_loads from (
    select d.id, d.dispatch_date, jsonb_build_object('id', d.id, 'dispatch_number', d.dispatch_number, 'dispatch_date', d.dispatch_date,
      'order_number', o.order_number, 'vehicle_number', d.vehicle_number, 'transporter_name', d.transporter_name, 'total_weight_kg', d.total_weight_kg,
      'overdue', d.dispatch_date < (p_start at time zone 'Asia/Kolkata')::date) as row_data
    from public.dispatches d left join public.orders o on o.id = d.order_id and o.company_id = p_company
    where d.company_id = p_company and d.delivery_status = 'pending' and d.dispatch_date <= v_business_end
    order by d.dispatch_date, d.id limit v_limit
  ) x;

  return jsonb_build_object(
    'period_start', p_start, 'period_end', p_end, 'generated_at', now(),
    'jobs', v_jobs, 'jobs_total', v_jobs_total,
    'downtime', v_downtime, 'downtime_total', v_downtime_total,
    'exceptions', v_exceptions, 'exceptions_total', v_exceptions_total,
    'quality', v_quality, 'quality_total', v_quality_total,
    'stock_holds_count', v_stock_holds_total, 'stock_holds_kg', v_stock_holds,
    'pending_loads', v_loads, 'pending_loads_total', v_loads_total);
end;
$$;
revoke all on function private.shift_handover_summary(uuid, timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public.shift_handover_command(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  v_actor uuid := auth.uid();
  v_company uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_name text;
  v_start timestamptz; v_end timestamptz;
  v_label text; v_note text; v_request uuid;
  v_row public.shift_handovers%rowtype;
  v_page integer; v_rows jsonb; v_total bigint;
begin
  if v_actor is null or v_company is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid handover request'; end if;
  select coalesce(nullif(full_name, ''), 'Employee') into v_name from public.app_users
  where id = v_actor and company_id = v_company and role = v_role and is_active and dealer_id is null;
  if not found
     or p_command not in ('handover.preview','handover.submit','handover.acknowledge','handover.list','handover.load')
     or (p_command in ('handover.submit','handover.acknowledge') and v_role not in ('owner','admin','factory_manager','production_manager','production'))
     or v_role not in ('owner','admin','factory_manager','production_manager','production','quality','dispatch_manager','viewer') then
    raise exception 'This action is not permitted for your role' using errcode = '42501';
  end if;

  if p_command in ('handover.preview','handover.submit') then
    begin
      v_start := (p_payload ->> 'period_start')::timestamptz;
      v_end := (p_payload ->> 'period_end')::timestamptz;
    exception when others then
      raise exception 'Choose a valid shift start and end';
    end;
    if v_start is null or v_end is null or v_end <= v_start or v_end - v_start > interval '24 hours'
       or v_start < now() - interval '31 days' or v_end > now() + interval '1 hour' then
      raise exception 'Choose a shift window of up to 24 hours that has ended within the last 31 days';
    end if;
    if p_command = 'handover.preview' then
      return private.shift_handover_summary(v_company, v_start, v_end);
    end if;
    v_label := btrim(coalesce(p_payload ->> 'shift_label', ''));
    v_note := btrim(coalesce(p_payload ->> 'note', ''));
    v_request := (p_payload ->> 'request_id')::uuid;
    if v_request is null then raise exception 'A request identity is required'; end if;
    if length(v_label) not between 1 and 40 or length(v_note) > 2000 or v_label ~ '[[:cntrl:]]' then raise exception 'Enter a shift name and a note of up to 2,000 characters'; end if;
    -- One lock per company: overlapping windows are checked against each other, not just identical ones.
    perform pg_advisory_xact_lock(hashtextextended(v_company::text || ':shift-handover', 0));
    select * into v_row from public.shift_handovers where id = v_request;
    if found then
      if v_row.company_id <> v_company or v_row.prepared_by <> v_actor or v_row.period_start <> v_start or v_row.period_end <> v_end or v_row.shift_label <> v_label or v_row.note <> v_note then
        raise exception 'The request identity was already used for different details';
      end if;
      return jsonb_build_object('id', v_row.id);
    end if;
    if exists (select 1 from public.shift_handovers where company_id = v_company and period_start < v_end and period_end > v_start) then
      raise exception 'A handover overlapping this shift window was already submitted';
    end if;
    insert into public.shift_handovers(id, company_id, period_start, period_end, shift_label, summary, note, prepared_by, prepared_by_name)
    values (v_request, v_company, v_start, v_end, v_label, private.shift_handover_summary(v_company, v_start, v_end), v_note, v_actor, v_name);
    return jsonb_build_object('id', v_request);
  elsif p_command = 'handover.acknowledge' then
    v_note := btrim(coalesce(p_payload ->> 'note', ''));
    if length(v_note) > 1000 then raise exception 'Keep the acknowledgement note under 1,000 characters'; end if;
    select * into v_row from public.shift_handovers where id = (p_payload ->> 'handover_id')::uuid and company_id = v_company for update;
    if not found then raise exception 'Handover is unavailable'; end if;
    if v_row.status = 'acknowledged' then
      if v_row.acknowledged_by = v_actor and coalesce(v_row.acknowledgement_note, '') = v_note then return jsonb_build_object('id', v_row.id); end if;
      raise exception 'This handover was already acknowledged';
    end if;
    if v_row.prepared_by = v_actor then raise exception 'The incoming supervisor must acknowledge the handover, not the person who prepared it'; end if;
    update public.shift_handovers set status = 'acknowledged', acknowledged_by = v_actor, acknowledged_by_name = v_name, acknowledged_at = now(), acknowledgement_note = nullif(v_note, '')
    where id = v_row.id;
    return jsonb_build_object('id', v_row.id);
  elsif p_command = 'handover.load' then
    select * into v_row from public.shift_handovers where id = (p_payload ->> 'handover_id')::uuid and company_id = v_company;
    if not found then raise exception 'Handover is unavailable'; end if;
    return jsonb_build_object('id', v_row.id, 'period_start', v_row.period_start, 'period_end', v_row.period_end, 'shift_label', v_row.shift_label,
      'summary', v_row.summary, 'note', v_row.note, 'prepared_by', v_row.prepared_by, 'prepared_by_name', v_row.prepared_by_name, 'prepared_at', v_row.prepared_at,
      'status', v_row.status, 'acknowledged_by_name', v_row.acknowledged_by_name, 'acknowledged_at', v_row.acknowledged_at, 'acknowledgement_note', v_row.acknowledgement_note);
  end if;

  -- handover.list
  v_page := coalesce((p_payload ->> 'page')::integer, 1);
  if v_page < 1 or v_page > 100000 then raise exception 'Invalid page'; end if;
  select count(*) into v_total from public.shift_handovers where company_id = v_company and (p_payload ->> 'status' is null or status = p_payload ->> 'status');
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows from (
    select id, shift_label, period_start, period_end, prepared_by_name, prepared_at, status, acknowledged_by_name, acknowledged_at,
      jsonb_array_length(summary -> 'jobs') as job_count,
      (select count(*) from jsonb_array_elements(summary -> 'jobs') j where j ->> 'category' in ('held','running')) as open_job_count
    from public.shift_handovers
    where company_id = v_company and (p_payload ->> 'status' is null or status = p_payload ->> 'status')
    order by period_end desc, id limit 10 offset (v_page - 1) * 10) r;
  return jsonb_build_object('rows', v_rows, 'total_count', v_total);
end;
$$;
revoke all on function public.shift_handover_command(text, jsonb) from public, anon;
grant execute on function public.shift_handover_command(text, jsonb) to authenticated;

commit;

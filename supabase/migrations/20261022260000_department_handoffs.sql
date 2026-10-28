-- UPGRADE_EOS feature 14: automatic department handoffs.
--
-- A confirmed event creates the next team's work as a task, in the same transaction as the event:
--   * QC release (an inspection becomes approved, including the approved child of a rework
--     resolution)            -> packaging team, quantity = released kg
--   * finishing receipt (a finishing job is received or completed with output)
--                            -> quality team, quantity = accepted output kg
--   * packaging completed    -> dispatch team, quantity = packed profile kg
-- Each handoff carries its source record, quantity, deadline (the order's expected dispatch date,
-- never in the past) and responsible team. A unique key per source event makes every retry,
-- replay or repeated status change create at most one task. Teams claim a handoff, then finish it
-- through the normal task flow. Additive: new nullable task columns, one partial unique index.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.tasks
  add column if not exists handoff_key text,
  add column if not exists handoff_team text,
  add column if not exists handoff_quantity_kg numeric(14,3),
  add column if not exists handoff_source_type text,
  add column if not exists handoff_source_id uuid;
alter table public.tasks drop constraint if exists tasks_handoff_shape_check;
alter table public.tasks add constraint tasks_handoff_shape_check check (
  (handoff_key is null and handoff_team is null and handoff_quantity_kg is null and handoff_source_type is null and handoff_source_id is null)
  or (handoff_key is not null and handoff_team in ('packaging','dispatch','quality') and handoff_quantity_kg >= 0
      and handoff_source_type in ('quality_inspection','finishing_job','packaging_job') and handoff_source_id is not null));
create unique index if not exists tasks_handoff_key_unique on public.tasks(company_id, handoff_key) where handoff_key is not null;
create index if not exists tasks_handoff_queue_idx on public.tasks(company_id, handoff_team, status, due_date) where handoff_key is not null;

create or replace function private.handoff_team_roles(p_team text)
returns text[] language sql immutable set search_path = public, private as $$
  select case p_team
    when 'packaging' then array['owner','admin','factory_manager','production_manager','production']
    when 'dispatch' then array['owner','admin','factory_manager','dispatch_manager','dispatch']
    when 'quality' then array['owner','admin','factory_manager','quality_manager','quality']
    else array[]::text[] end
$$;
revoke all on function private.handoff_team_roles(text) from public, anon, authenticated;

-- Creates the handoff once. Returns 'created' or 'existing'.
create or replace function private.raise_department_handoff(
  p_company uuid, p_key text, p_team text, p_source_type text, p_source_id uuid, p_quantity numeric,
  p_order uuid, p_title text, p_description text
) returns text language plpgsql security definer set search_path = public, private as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_order record;
  v_id uuid;
begin
  select o.id, o.priority, o.expected_dispatch_date into v_order from public.orders o where o.id = p_order and o.company_id = p_company;
  insert into public.tasks(company_id, task_type, title, description, priority, status, due_date, related_entity_type, related_entity_id, created_by,
    handoff_key, handoff_team, handoff_quantity_kg, handoff_source_type, handoff_source_id)
  values (p_company, 'department_handoff', left(p_title, 200), p_description, coalesce(v_order.priority, 'normal'), 'open',
    greatest(v_today, coalesce(v_order.expected_dispatch_date, v_today + 1)), p_source_type, p_source_id, auth.uid(),
    p_key, p_team, round(greatest(coalesce(p_quantity, 0), 0), 3), p_source_type, p_source_id)
  on conflict (company_id, handoff_key) where handoff_key is not null do nothing
  returning id into v_id;
  return case when v_id is null then 'existing' else 'created' end;
end;
$$;
revoke all on function private.raise_department_handoff(uuid, text, text, text, uuid, numeric, uuid, text, text) from public, anon, authenticated;

-- Event builders. Each returns 'created', 'existing' or 'not_eligible' so the same rule serves the
-- triggers and a manual reprocess.
create or replace function private.handoff_for_inspection(p_company uuid, p_inspection uuid)
returns text language plpgsql security definer set search_path = public, private as $$
declare
  v_q public.quality_inspections%rowtype;
  v_job record; v_order uuid; v_packaging text;
begin
  select * into v_q from public.quality_inspections where id = p_inspection and company_id = p_company;
  if not found or v_q.status <> 'approved' or coalesce(v_q.quantity_checked_kg, 0) <= 0 then return 'not_eligible'; end if;
  select j.id, j.job_number, j.order_id into v_job from public.production_jobs j where j.id = v_q.production_job_id and j.company_id = p_company;
  v_order := coalesce(v_job.order_id, (select fj.order_id from public.finishing_jobs fj where fj.id = v_q.finishing_job_id and fj.company_id = p_company));
  select string_agg(pk.packaging_number, ', ' order by pk.created_at) into v_packaging from public.packaging_jobs pk
  where pk.company_id = p_company and pk.production_job_id = v_q.production_job_id and pk.status in ('scheduled','in_progress');
  return private.raise_department_handoff(p_company, 'inspection_release:' || v_q.id, 'packaging', 'quality_inspection', v_q.id, v_q.quantity_checked_kg, v_order,
    concat('Pack ', to_char(v_q.quantity_checked_kg, 'FM999999990.000'), ' kg released by QC', coalesce(' · ' || v_job.job_number, ''), coalesce(' · ' || (select order_number from public.orders where id = v_order and company_id = p_company), '')),
    concat('QC released ', to_char(v_q.quantity_checked_kg, 'FM999999990.000'), ' kg', coalesce(' of batch ' || v_q.batch_number, ''),
      case when v_q.resolution_id is not null then ' after a rework resolution' else '' end, '.',
      coalesce(' Open packaging: ' || v_packaging || '.', ' No packaging job is open for this production job yet.')));
end;
$$;
revoke all on function private.handoff_for_inspection(uuid, uuid) from public, anon, authenticated;

create or replace function private.handoff_for_finishing(p_company uuid, p_finishing uuid)
returns text language plpgsql security definer set search_path = public, private as $$
declare v_f public.finishing_jobs%rowtype; v_job text;
begin
  select * into v_f from public.finishing_jobs where id = p_finishing and company_id = p_company;
  if not found or v_f.status not in ('received','completed') or coalesce(v_f.output_weight_kg, 0) <= 0 then return 'not_eligible'; end if;
  select job_number into v_job from public.production_jobs where id = v_f.production_job_id and company_id = p_company;
  return private.raise_department_handoff(p_company, 'finishing_receipt:' || v_f.id, 'quality', 'finishing_job', v_f.id, v_f.output_weight_kg, v_f.order_id,
    concat('Inspect ', to_char(v_f.output_weight_kg, 'FM999999990.000'), ' kg back from ', replace(coalesce(v_f.finishing_type, 'finishing'), '_', ' '), coalesce(' · ' || v_job, '')),
    concat('Finishing receipt recorded ', to_char(v_f.output_weight_kg, 'FM999999990.000'), ' kg accepted output',
      case when coalesce(v_f.rejection_weight_kg, 0) > 0 then concat(' and ', to_char(v_f.rejection_weight_kg, 'FM999999990.000'), ' kg rejected by the vendor') else '' end,
      coalesce(' (shade ' || v_f.shade_name || ')', ''), '. Inspect before packing.'));
end;
$$;
revoke all on function private.handoff_for_finishing(uuid, uuid) from public, anon, authenticated;

create or replace function private.handoff_for_packaging(p_company uuid, p_packaging uuid)
returns text language plpgsql security definer set search_path = public, private as $$
declare v_p public.packaging_jobs%rowtype;
begin
  select * into v_p from public.packaging_jobs where id = p_packaging and company_id = p_company;
  if not found or v_p.status <> 'completed' or coalesce(v_p.profile_weight_kg, 0) <= 0 then return 'not_eligible'; end if;
  return private.raise_department_handoff(p_company, 'packaging_complete:' || v_p.id, 'dispatch', 'packaging_job', v_p.id, v_p.profile_weight_kg, v_p.order_id,
    concat('Dispatch ', to_char(v_p.profile_weight_kg, 'FM999999990.000'), ' kg packed', coalesce(' · ' || v_p.packaging_number, ''), coalesce(' · ' || (select order_number from public.orders where id = v_p.order_id and company_id = p_company), '')),
    concat('Packaging ', coalesce(v_p.packaging_number, ''), ' completed: ', v_p.pieces, ' pcs, ', to_char(v_p.profile_weight_kg, 'FM999999990.000'), ' kg. Plan the vehicle and prepare the dispatch.'));
end;
$$;
revoke all on function private.handoff_for_packaging(uuid, uuid) from public, anon, authenticated;

-- Triggers fire after the source row is written, inside its transaction. No column list: an
-- "UPDATE OF status" trigger would miss writes that do not name the column.
create or replace function private.trigger_department_handoff()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then return new; end if;
  if tg_table_name = 'quality_inspections' and new.status = 'approved' then perform private.handoff_for_inspection(new.company_id, new.id);
  elsif tg_table_name = 'finishing_jobs' and new.status in ('received','completed') then perform private.handoff_for_finishing(new.company_id, new.id);
  elsif tg_table_name = 'packaging_jobs' and new.status = 'completed' then perform private.handoff_for_packaging(new.company_id, new.id);
  end if;
  return new;
end;
$$;
revoke all on function private.trigger_department_handoff() from public, anon, authenticated;
drop trigger if exists zz_department_handoff on public.quality_inspections;
create trigger zz_department_handoff after insert or update on public.quality_inspections for each row execute function private.trigger_department_handoff();
drop trigger if exists zz_department_handoff on public.finishing_jobs;
create trigger zz_department_handoff after insert or update on public.finishing_jobs for each row execute function private.trigger_department_handoff();
drop trigger if exists zz_department_handoff on public.packaging_jobs;
create trigger zz_department_handoff after insert or update on public.packaging_jobs for each row execute function private.trigger_department_handoff();

create or replace function public.department_handoff_command(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  v_actor uuid := auth.uid();
  v_company uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_task public.tasks%rowtype;
  v_team text; v_status text; v_page integer; v_total bigint; v_rows jsonb; v_outcome text; v_source uuid;
begin
  if v_actor is null or v_company is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid handoff request'; end if;
  if not exists (select 1 from public.app_users where id = v_actor and company_id = v_company and role = v_role and is_active and dealer_id is null)
     or p_command not in ('handoff.list','handoff.take','handoff.reprocess')
     or v_role not in ('owner','admin','factory_manager','production_manager','production','dispatch_manager','dispatch','quality_manager','quality','viewer')
     or (p_command = 'handoff.reprocess' and v_role not in ('owner','admin','factory_manager','production_manager','quality_manager','quality','dispatch_manager'))
     or (p_command = 'handoff.take' and v_role = 'viewer') then
    raise exception 'This action is not permitted for your role' using errcode = '42501';
  end if;

  if p_command = 'handoff.take' then
    select * into v_task from public.tasks where id = (p_payload ->> 'task_id')::uuid and company_id = v_company and handoff_key is not null for update;
    if not found then raise exception 'Handoff is unavailable'; end if;
    if not (v_role = any(private.handoff_team_roles(v_task.handoff_team))) then raise exception 'This handoff belongs to another team' using errcode = '42501'; end if;
    if v_task.assigned_to = v_actor and v_task.status = 'in_progress' then return jsonb_build_object('id', v_task.id, 'status', v_task.status); end if;
    if v_task.status <> 'open' or v_task.assigned_to is not null then raise exception 'This handoff was already taken or closed. Refresh the queue'; end if;
    update public.tasks set status = 'in_progress', assigned_to = v_actor, assigned_by_user_id = v_actor, updated_at = now() where id = v_task.id;
    return jsonb_build_object('id', v_task.id, 'status', 'in_progress');

  elsif p_command = 'handoff.reprocess' then
    v_source := (p_payload ->> 'source_id')::uuid;
    v_outcome := case p_payload ->> 'source_type'
      when 'quality_inspection' then private.handoff_for_inspection(v_company, v_source)
      when 'finishing_job' then private.handoff_for_finishing(v_company, v_source)
      when 'packaging_job' then private.handoff_for_packaging(v_company, v_source)
    end;
    if v_outcome is null then raise exception 'Choose a quality inspection, finishing job or packaging job'; end if;
    return jsonb_build_object('outcome', v_outcome);
  end if;

  -- handoff.list: the team's queue, open first, then by deadline. A role sees its own teams' work;
  -- owners, admins, factory managers and viewers see every team.
  v_team := nullif(p_payload ->> 'team', '');
  v_status := coalesce(nullif(p_payload ->> 'status', ''), 'active');
  v_page := coalesce((p_payload ->> 'page')::integer, 1);
  if (v_team is not null and v_team not in ('packaging','dispatch','quality')) or v_status not in ('active','open','in_progress','completed','cancelled','all')
     or v_page < 1 or v_page > 100000 then raise exception 'Invalid handoff queue request'; end if;
  with visible as (
    select t.* from public.tasks t
    where t.company_id = v_company and t.handoff_key is not null and t.dealership_id is null
      and (v_team is null or t.handoff_team = v_team)
      and (v_role in ('owner','admin','factory_manager','viewer') or v_role = any(private.handoff_team_roles(t.handoff_team)))
      and case v_status when 'active' then t.status in ('open','in_progress') when 'all' then true else t.status = v_status end
  )
  select (select count(*) from visible),
    coalesce((select jsonb_agg(to_jsonb(r)) from (
      select v.id, v.title, v.description, v.priority, v.status, v.due_date, v.handoff_team, v.handoff_quantity_kg, v.handoff_source_type, v.handoff_source_id,
        v.created_at, v.completed_at, u.full_name as assigned_to_name, (v.assigned_to = v_actor) as mine,
        (v.status = 'open' and v.assigned_to is null and v_role = any(private.handoff_team_roles(v.handoff_team))) as can_take
      from visible v left join public.app_users u on u.id = v.assigned_to and u.company_id = v_company
      order by case v.status when 'open' then 0 when 'in_progress' then 1 else 2 end, v.due_date nulls last,
        case v.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end, v.created_at, v.id
      limit 10 offset (v_page - 1) * 10) r), '[]'::jsonb)
  into v_total, v_rows;
  return jsonb_build_object('rows', v_rows, 'total_count', v_total);
end;
$$;
revoke all on function public.department_handoff_command(text, jsonb) from public, anon;
grant execute on function public.department_handoff_command(text, jsonb) to authenticated;

commit;

-- FABLE_SUGGESTIONS Phase 4, completion of the batch-1 partials:
--   FS-16  die correction loop (defect photo -> corrector's action -> trial result -> approved or back), per-die history.
--   FS-54  released development die terms reach the die record and the quotation die line (and through it the invoice
--          die-charge line that already exists for quoted die charges).
--   FS-26  the AP-061 auto-arrange skips presses that are broken down and dies that are away; a breakdown re-flow
--          releases the stopped press's unreleased slots and prepares new drafts for the planner to publish.
--   FS-38  the morning brief is delivered in-app and queued for email to each owner; weekly and monthly sections.
-- No schedule, quote or invoice is changed without a person's command. Additive; previous functions are replaced in place.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------------------------------------------
-- FS-16: the correction loop
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.die_correction_steps (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  correction_id uuid not null references public.die_corrections(id),
  die_id uuid not null references public.dies(id),
  step text not null check (step in ('defect', 'action', 'trial', 'approved', 'returned')),
  note text not null check (length(btrim(note)) between 3 and 500),
  photo_path text check (photo_path is null or (length(photo_path) between 10 and 400 and photo_path !~ '\.\.')),
  trial_id uuid references public.die_trials(id),
  trial_result text,
  recorded_by uuid not null references public.app_users(id),
  recorded_at timestamptz not null default clock_timestamp(),
  check (step <> 'trial' or trial_id is not null)
);
create index if not exists die_correction_steps_idx on public.die_correction_steps(company_id, correction_id, recorded_at);
create index if not exists die_correction_steps_die_idx on public.die_correction_steps(company_id, die_id, recorded_at desc);
alter table public.die_correction_steps enable row level security;
revoke all on public.die_correction_steps from public, anon, authenticated;

create or replace function private.fs4_guard_correction_steps()
returns trigger language plpgsql set search_path = public, private as $$
begin
  raise exception 'AP: Correction history cannot be changed.' using errcode = '23514';
end;
$$;
revoke all on function private.fs4_guard_correction_steps() from public, anon, authenticated;
drop trigger if exists fs4_correction_steps_immutable on public.die_correction_steps;
create trigger fs4_correction_steps_immutable before update or delete on public.die_correction_steps for each row execute function private.fs4_guard_correction_steps();

-- A photo belongs to this company's die-correction folder in the documents bucket, nowhere else.
create or replace function private.fs4_photo(p_company uuid, p_die uuid, p_path text)
returns text language plpgsql immutable set search_path = public, private as $$
begin
  if p_path is null or btrim(p_path) = '' then return null; end if;
  if p_path !~ ('^' || p_company::text || '/die-corrections/' || p_die::text || '/[A-Za-z0-9._-]{5,200}$') then raise exception 'AP: Upload the photo again.'; end if;
  return p_path;
end;
$$;
revoke all on function private.fs4_photo(uuid, uuid, text) from public, anon, authenticated;

-- The stage a correction has reached: the last step decides what may follow.
create or replace function private.fs4_correction_stage(p_correction uuid)
returns text language sql stable security definer set search_path = public, private as $$
  select coalesce((select s.step from public.die_correction_steps s where s.correction_id = p_correction order by s.recorded_at desc, s.id desc limit 1), 'none')
$$;
revoke all on function private.fs4_correction_stage(uuid) from public, anon, authenticated;

-- Per-die history: recent completed runs with recovery and rate (output / hours between first and last recorded push),
-- corrections with their loop, nitriding and trials.
create or replace function private.fs4_die_history(p_company uuid, p_die uuid)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object(
    'runs', coalesce((select jsonb_agg(r order by r ->> 'completed_on' desc) from (select jsonb_build_object('job_id', j.id, 'job_number', j.job_number,
        'completed_on', (j.completed_at at time zone 'Asia/Kolkata')::date, 'output_kg', j.actual_quantity_kg, 'input_kg', j.input_billet_weight,
        'recovery_percent', case when j.input_billet_weight > 0 then round(j.actual_quantity_kg * 100 / j.input_billet_weight, 1) end,
        'kg_per_hour', case when pe.hours > 0.05 then round(j.actual_quantity_kg / pe.hours, 1) end, 'pushes', pe.n) r
      from public.production_jobs j
      left join lateral (select count(*) n, extract(epoch from max(p.event_at) - min(p.event_at)) / 3600 hours from private.ap2_pushes p
        where p.company_id = p_company and p.production_job_id = j.id) pe on true
      where j.company_id = p_company and j.die_id = p_die and j.status = 'completed' order by j.completed_at desc nulls last limit 10) x), '[]'),
    'averages', (select jsonb_build_object('runs', count(*), 'recovery_percent', round(sum(j.actual_quantity_kg) filter (where j.input_billet_weight > 0) * 100
        / nullif(sum(j.input_billet_weight) filter (where j.input_billet_weight > 0), 0), 1))
      from public.production_jobs j where j.company_id = p_company and j.die_id = p_die and j.status = 'completed'),
    'corrections', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'date', c.correction_date, 'reason', c.correction_reason, 'vendor', c.correction_vendor,
        'result', c.result_status, 'stage', private.fs4_correction_stage(c.id),
        'steps', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'step', s.step, 'note', s.note, 'has_photo', s.photo_path is not null, 'trial_result', s.trial_result,
          'by', u.full_name, 'at', s.recorded_at) order by s.recorded_at) from public.die_correction_steps s join public.app_users u on u.id = s.recorded_by where s.correction_id = c.id), '[]'))
        order by c.correction_date desc, c.created_at desc) from public.die_corrections c where c.company_id = p_company and c.die_id = p_die), '[]'),
    'nitriding', coalesce((select jsonb_agg(jsonb_build_object('date', n.nitriding_date, 'vendor', n.nitriding_vendor, 'cycle', n.nitriding_cycle_number, 'status', n.status) order by n.nitriding_date desc)
      from public.die_nitriding_history n where n.company_id = p_company and n.die_id = p_die), '[]'),
    'trials', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'date', t.trial_date, 'result', t.trial_result, 'recovery_percent', t.trial_recovery_percent, 'remarks', t.remarks)
      order by t.trial_date desc) from public.die_trials t where t.company_id = p_company and t.die_id = p_die), '[]'))
$$;
revoke all on function private.fs4_die_history(uuid, uuid) from public, anon, authenticated;

-- fs_die_life gains the correction loop, history and QR label data; earlier commands are unchanged.
alter function public.fs_die_life(text, jsonb) rename to fs4_die_life_base;
revoke all on function public.fs4_die_life_base(text, jsonb) from public, anon, authenticated;
alter function public.fs4_die_life_base(text, jsonb) set schema private;

create function public.fs_die_life(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_die uuid; v_corr public.die_corrections%rowtype; v_stage text; v_trial public.die_trials%rowtype; v_step public.die_correction_steps%rowtype; v_decision text;
  v_reasons constant text[] := array['die_lines', 'dimensional', 'surface_pickup', 'slow_speed', 'bearing_issue', 'tongue_ratio', 'other'];
begin
  if p_command not in ('history', 'report_defect', 'record_action', 'record_trial', 'decide', 'photo', 'labels') then
    return private.fs4_die_life_base(p_command, p_payload);
  end if;
  if p_command = 'report_defect' then select * into c from private.ap_ctx(array['owner', 'admin', 'production_manager', 'production', 'quality', 'factory_manager']);
  elsif p_command = 'record_action' then select * into c from private.ap_ctx(array['owner', 'admin', 'production_manager', 'factory_manager']);
  elsif p_command in ('record_trial', 'decide') then select * into c from private.ap_ctx(array['owner', 'admin', 'production_manager', 'quality']);
  else select * into c from private.ap_ctx(array['owner', 'admin', 'production_manager', 'factory_manager', 'production', 'quality', 'sales_manager', 'accounts']); end if;

  if p_command = 'history' then
    perform private.ap_keys(p_payload, array['die_id']);
    v_die := private.ap_uuid(p_payload, 'die_id');
    if not exists (select 1 from public.dies where id = v_die and company_id = c.company_id and deleted_at is null) then raise exception 'AP: Die not found.'; end if;
    return private.fs4_die_history(c.company_id, v_die);
  elsif p_command = 'labels' then
    perform private.ap_keys(p_payload, array['search']);
    return jsonb_build_object('rows', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'die_number', d.die_number, 'profile_code', p.profile_code, 'rack_location', d.rack_location,
        'storage_bin', d.storage_bin) order by d.rack_location nulls last, d.die_number) from (select * from public.dies d where d.company_id = c.company_id and d.deleted_at is null
        and coalesce(d.die_status, '') not in ('retired', 'scrapped', 'dead')
        and (nullif(btrim(p_payload ->> 'search'), '') is null or d.die_number ilike '%' || btrim(p_payload ->> 'search') || '%' or d.rack_location ilike '%' || btrim(p_payload ->> 'search') || '%')
        order by d.rack_location nulls last, d.die_number limit 60) d left join public.aluminium_profiles p on p.id = d.profile_id), '[]'));
  elsif p_command = 'report_defect' then
    perform private.ap_keys(p_payload, array['die_id', 'reason', 'note', 'photo_path']);
    v_die := private.ap_uuid(p_payload, 'die_id');
    if not exists (select 1 from public.dies where id = v_die and company_id = c.company_id and deleted_at is null) then raise exception 'AP: Die not found.'; end if;
    if coalesce(p_payload ->> 'reason', '') <> all(v_reasons) then raise exception 'AP: Choose what is wrong with the profile.'; end if;
    if exists (select 1 from public.die_corrections x where x.company_id = c.company_id and x.die_id = v_die and coalesce(x.result_status, 'pending') = 'pending') then
      raise exception 'AP: This die already has an open correction. Add to it instead.'; end if;
    insert into public.die_corrections(company_id, die_id, correction_date, correction_reason, result_status, notes, created_by)
      values (c.company_id, v_die, private.ist_today(), p_payload ->> 'reason', 'pending', private.ap_text(p_payload ->> 'note', 'What was seen', 3, 500), c.actor_id) returning * into v_corr;
    insert into public.die_correction_steps(company_id, correction_id, die_id, step, note, photo_path, recorded_by)
      values (c.company_id, v_corr.id, v_die, 'defect', btrim(p_payload ->> 'note'), private.fs4_photo(c.company_id, v_die, p_payload ->> 'photo_path'), c.actor_id);
    insert into public.notifications(company_id, recipient_role, notification_type, severity, title, body, related_entity_type, related_entity_id, action_link, entity_reference)
      values (c.company_id, 'production_manager', 'die_correction', 'warning', 'Die defect reported: ' || (select die_number from public.dies where id = v_die),
        left(btrim(p_payload ->> 'note'), 300), 'die', v_die, '/dies/life', 'fs4:die-correction:' || v_corr.id);
    return jsonb_build_object('correction_id', v_corr.id, 'stage', 'defect');
  end if;

  -- The remaining loop commands act on one open correction.
  if p_command <> 'photo' then
    select * into v_corr from public.die_corrections where id = private.ap_uuid(p_payload, 'correction_id') and company_id = c.company_id for update;
    if v_corr.id is null then raise exception 'AP: Correction not found.'; end if;
    if coalesce(v_corr.result_status, 'pending') <> 'pending' then raise exception 'AP: This correction is closed.'; end if;
    v_stage := private.fs4_correction_stage(v_corr.id);
  end if;

  if p_command = 'record_action' then
    perform private.ap_keys(p_payload, array['correction_id', 'note', 'vendor', 'cost', 'photo_path']);
    if v_stage not in ('defect', 'returned', 'none') then raise exception 'AP: Record the trial result of the last correction first.'; end if;
    update public.die_corrections set correction_vendor = coalesce(private.ap_text(p_payload ->> 'vendor', 'Corrector', 2, 120, false), correction_vendor),
      cost = coalesce(cost, 0) + coalesce(private.ap4_num(p_payload, 'cost', 'Cost', 0, 10000000, false), 0) where id = v_corr.id;
    insert into public.die_correction_steps(company_id, correction_id, die_id, step, note, photo_path, recorded_by)
      values (c.company_id, v_corr.id, v_corr.die_id, 'action', private.ap_text(p_payload ->> 'note', 'What was corrected', 3, 500),
        private.fs4_photo(c.company_id, v_corr.die_id, p_payload ->> 'photo_path'), c.actor_id);
    return jsonb_build_object('correction_id', v_corr.id, 'stage', 'action');
  elsif p_command = 'record_trial' then
    perform private.ap_keys(p_payload, array['correction_id', 'trial_id', 'note']);
    if v_stage <> 'action' then raise exception 'AP: Record what was corrected before the trial.'; end if;
    select * into v_trial from public.die_trials where id = private.ap_uuid(p_payload, 'trial_id') and company_id = c.company_id and die_id = v_corr.die_id;
    if v_trial.id is null then raise exception 'AP: Choose a trial recorded on this die.'; end if;
    if exists (select 1 from public.die_correction_steps s where s.trial_id = v_trial.id) then raise exception 'AP: That trial is already linked to a correction.'; end if;
    if v_trial.trial_result = 'pending' then raise exception 'AP: The trial has no result yet.'; end if;
    insert into public.die_correction_steps(company_id, correction_id, die_id, step, note, trial_id, trial_result, recorded_by)
      values (c.company_id, v_corr.id, v_corr.die_id, 'trial', coalesce(private.ap_text(p_payload ->> 'note', 'Note', 3, 500, false), 'Trial ' || to_char(v_trial.trial_date, 'DD Mon') || ': ' || v_trial.trial_result),
        v_trial.id, v_trial.trial_result, c.actor_id);
    return jsonb_build_object('correction_id', v_corr.id, 'stage', 'trial', 'trial_result', v_trial.trial_result);
  elsif p_command = 'decide' then
    perform private.ap_keys(p_payload, array['correction_id', 'decision', 'note']);
    v_decision := p_payload ->> 'decision';
    if coalesce(v_decision, '') not in ('approved', 'returned') then raise exception 'AP: Approve the correction or send it back.'; end if;
    if v_stage <> 'trial' then raise exception 'AP: A trial result is needed before deciding.'; end if;
    select * into v_step from public.die_correction_steps where correction_id = v_corr.id and step = 'trial' order by recorded_at desc, id desc limit 1;
    if v_decision = 'approved' and v_step.trial_result = 'fail' then raise exception 'AP: The last trial failed; send the correction back.'; end if;
    insert into public.die_correction_steps(company_id, correction_id, die_id, step, note, recorded_by)
      values (c.company_id, v_corr.id, v_corr.die_id, v_decision, private.ap_text(p_payload ->> 'note', 'Decision note', 3, 500), c.actor_id);
    if v_decision = 'approved' then
      update public.die_corrections set result_status = case when v_step.trial_result = 'conditional' then 'partial' else 'success' end where id = v_corr.id;
      update public.notifications set resolved_at = clock_timestamp(), resolution = 'Correction approved' where company_id = c.company_id and entity_reference = 'fs4:die-correction:' || v_corr.id and resolved_at is null;
    end if;
    return jsonb_build_object('correction_id', v_corr.id, 'stage', v_decision);
  elsif p_command = 'photo' then
    perform private.ap_keys(p_payload, array['step_id']);
    select * into v_step from public.die_correction_steps where id = private.ap_uuid(p_payload, 'step_id') and company_id = c.company_id;
    if v_step.id is null or v_step.photo_path is null then raise exception 'AP: Photo not found.'; end if;
    return jsonb_build_object('path', v_step.photo_path);
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.fs_die_life(text, jsonb) from public, anon;
grant execute on function public.fs_die_life(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- FS-54: structured die terms that reach the die record and the quotation
-- ---------------------------------------------------------------------------------------------------------------
alter table public.development_projects add column if not exists customer_die_charge numeric(14,2) check (customer_die_charge is null or customer_die_charge >= 0);
alter table public.development_projects add column if not exists die_amortization_type text check (die_amortization_type is null or die_amortization_type in ('full_die_charge', 'per_kg', 'waived', 'customer_paid'));
alter table public.development_projects add column if not exists die_amortization_quantity_kg numeric(14,3) check (die_amortization_quantity_kg is null or die_amortization_quantity_kg > 0);
alter table public.development_projects add column if not exists die_record_update jsonb;

-- The die terms quoting uses for a die: from the latest released development that names it.
create or replace function private.fs4_die_terms(p_company uuid, p_die uuid)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('development_id', d.id, 'project_number', d.project_number, 'customer_id', d.customer_id, 'payer', d.die_cost_payer,
    'die_charge', coalesce(d.customer_die_charge, 0), 'amortization_type', coalesce(d.die_amortization_type, case d.die_cost_payer when 'company' then 'waived' else 'full_die_charge' end),
    'amortization_quantity_kg', d.die_amortization_quantity_kg, 'terms', d.amortisation_terms)
  from public.development_projects d where d.company_id = p_company and d.die_id = p_die and d.stage = 'released'
  order by d.updated_at desc limit 1
$$;
revoke all on function private.fs4_die_terms(uuid, uuid) from public, anon, authenticated;

alter function public.fs_development(text, jsonb) rename to fs4_development_base;
revoke all on function public.fs4_development_base(text, jsonb) from public, anon, authenticated;
alter function public.fs4_development_base(text, jsonb) set schema private;

create function public.fs_development(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; d public.development_projects%rowtype; v_out jsonb; v_die public.dies%rowtype; v_written jsonb := '{}'; v_type text; v_qty numeric; v_charge numeric; v_owner text;
begin
  if p_command = 'die_terms' then
    select * into c from private.ap_ctx(array['owner', 'admin', 'sales_manager', 'sales', 'accounts']);
    perform private.ap_keys(p_payload, array['die_id']);
    return coalesce(private.fs4_die_terms(c.company_id, private.ap_uuid(p_payload, 'die_id')), 'null'::jsonb);
  elsif p_command = 'set_die_terms' then
    select * into c from private.ap_ctx(array['owner', 'admin', 'sales_manager', 'sales']);
    perform private.ap_keys(p_payload, array['id', 'customer_die_charge', 'die_amortization_type', 'die_amortization_quantity_kg']);
    select * into d from public.development_projects where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id for update;
    if d.id is null then raise exception 'AP: Development not found.'; end if;
    if d.stage in ('released', 'dropped') then raise exception 'AP: A released or dropped development cannot be changed.'; end if;
    v_type := p_payload ->> 'die_amortization_type';
    if coalesce(v_type, '') not in ('full_die_charge', 'per_kg', 'waived', 'customer_paid') then raise exception 'AP: Choose how the die is charged.'; end if;
    v_charge := private.ap4_num(p_payload, 'customer_die_charge', 'Die charge to the customer', 0, 100000000, v_type in ('full_die_charge', 'per_kg'));
    v_qty := private.ap4_num(p_payload, 'die_amortization_quantity_kg', 'Amortise over kg', 1, 100000000, v_type = 'per_kg');
    update public.development_projects set customer_die_charge = v_charge, die_amortization_type = v_type, die_amortization_quantity_kg = case when v_type = 'per_kg' then v_qty end,
      updated_at = clock_timestamp() where id = d.id;
    return private.fs4_development_base('get', jsonb_build_object('id', d.id));
  elsif p_command = 'move' and p_payload ->> 'to_stage' = 'released' then
    select * into c from private.ap_ctx(array['owner', 'admin', 'sales_manager', 'sales', 'production_manager', 'factory_manager', 'quality']);
    select * into d from public.development_projects where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id for update;
    if d.id is not null and d.die_cost_payer in ('customer', 'shared') and d.die_amortization_type is null then
      raise exception 'AP: Record how the die is charged to the customer before release.'; end if;
    v_out := private.fs4_development_base(p_command, p_payload);
    -- On release the die record carries the agreed cost and ownership, where the die shop has not recorded them already.
    select * into v_die from public.dies where id = d.die_id and company_id = c.company_id for update;
    if v_die.id is not null then
      if v_die.die_cost is null and d.die_cost is not null then v_written := v_written || jsonb_build_object('die_cost', d.die_cost); end if;
      v_owner := case d.die_cost_payer when 'customer' then 'customer_owned' when 'shared' then 'shared' when 'company' then 'company_owned' end;
      if v_owner is not null and coalesce(v_die.ownership_type, 'company_owned') in ('company_owned', 'trial') and coalesce(v_die.ownership_type, 'company_owned') <> v_owner then
        v_written := v_written || jsonb_build_object('ownership_type', v_owner);
      end if;
      if v_die.customer_id is null and d.die_cost_payer in ('customer', 'shared') then v_written := v_written || jsonb_build_object('customer_id', d.customer_id); end if;
      update public.dies set die_cost = coalesce((v_written ->> 'die_cost')::numeric, die_cost), ownership_type = coalesce(v_written ->> 'ownership_type', ownership_type),
        customer_id = coalesce((v_written ->> 'customer_id')::uuid, customer_id), updated_at = now() where id = v_die.id and v_written <> '{}'::jsonb;
      update public.development_projects set die_record_update = v_written where id = d.id;
    end if;
    return v_out || jsonb_build_object('die_record_update', v_written);
  end if;
  return private.fs4_development_base(p_command, p_payload);
end;
$$;
revoke all on function public.fs_development(text, jsonb) from public, anon;
grant execute on function public.fs_development(text, jsonb) to authenticated;

-- The development row now shows the structured terms too.
create or replace function private.fs4_dev_row(p_company uuid, d public.development_projects)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select to_jsonb(d) - 'company_id' || jsonb_build_object(
    'customer_name', (select coalesce(nullif(btrim(cu.company_name), ''), cu.customer_name) from public.customers cu where cu.id = d.customer_id),
    'owner_name', (select full_name from public.app_users where id = d.owner_id),
    'die_number', (select die_number from public.dies where id = d.die_id),
    'profile_code', (select profile_code from public.aluminium_profiles where id = d.profile_id),
    'vendor_name', (select vendor_name from public.vendors where id = d.die_vendor_id),
    'age_days', (private.ist_today() - (d.stage_since at time zone 'Asia/Kolkata')::date),
    'trials', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'trial_date', t.trial_date, 'result', t.trial_result, 'correction_required', t.correction_required,
        'recovery_percent', t.trial_recovery_percent, 'remarks', t.remarks) order by t.trial_date, t.created_at) from public.die_trials t where t.company_id = p_company and t.die_id = d.die_id and d.die_id is not null), '[]'))
$$;
revoke all on function private.fs4_dev_row(uuid, public.development_projects) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- FS-26: constraint-aware auto-arrange and breakdown re-flow
-- ---------------------------------------------------------------------------------------------------------------
-- The AP-061 builder, unchanged except for two constraints: a press with an open breakdown is left out of the press set
-- (its work goes to the other compatible presses), and a job whose die is away over the plan date is listed as not
-- schedulable with the return date.
create or replace function private.ap6_plan_build(p_company uuid, p_day date, p_actor uuid, p_run uuid)
returns uuid language plpgsql security definer set search_path = public, private as $$
declare v_draft uuid; v_wd integer := extract(isodow from p_day)::integer; j record; w record; v_best record; v_remaining numeric; v_start timestamptz; v_kg numeric;
  v_rate numeric; v_minutes numeric; v_allow integer; v_reasons jsonb; v_un jsonb; v_due date; v_found boolean; v_block record; v_change boolean; v_end timestamptz;
  v_windows integer; v_placed integer := 0; v_skipped integer := 0;
begin
  create temporary table if not exists ap6_windows (machine_id uuid, machine_name text, shift text, starts_at timestamptz, ends_at timestamptz, capacity_kg numeric,
    used_kg numeric, cursor_at timestamptz, last_die uuid, last_alloy text, seq integer, allowance integer) on commit drop;
  truncate pg_temp.ap6_windows;
  insert into pg_temp.ap6_windows
  select m.id, m.machine_name, c.shift_name, ws, we, c.capacity_kg,
    coalesce((select sum(s.capacity_kg) from public.production_plan_slots s where s.company_id = p_company and s.machine_id = m.id and lower(s.shift) = lower(c.shift_name)
      and s.status in ('scheduled', 'released') and s.planned_start_at >= ws and s.planned_start_at < we), 0),
    greatest(ws, coalesce((select max(s.planned_end_at) from public.production_plan_slots s where s.company_id = p_company and s.machine_id = m.id
      and s.status in ('draft', 'scheduled', 'released') and s.planned_start_at < we and s.planned_end_at > ws), ws)),
    (select j2.die_id from public.production_plan_slots s join public.production_jobs j2 on j2.id = s.production_job_id where s.company_id = p_company and s.machine_id = m.id
      and s.status in ('scheduled', 'released') and s.planned_start_at < we order by s.planned_end_at desc limit 1),
    null, coalesce((select max(s.sequence_number) from public.production_plan_slots s where s.company_id = p_company and s.machine_id = m.id and s.planned_start_at >= ws and s.planned_start_at < we), 0),
    coalesce((select f.die_change_allowance_minutes from public.press_floor_settings f where f.company_id = p_company and f.machine_id = m.id), 0)
  from public.machines m join public.factory_shift_capacities c on c.machine_id = m.id and c.company_id = p_company and c.weekday = v_wd
    cross join lateral (select (p_day + c.starts_local) at time zone 'Asia/Kolkata' ws,
      (p_day + c.ends_local + case when c.ends_local <= c.starts_local then interval '1 day' else interval '0' end) at time zone 'Asia/Kolkata' we) t
  where m.company_id = p_company and m.machine_type = 'extrusion_press' and m.is_active and m.status in ('active', 'operational', 'idle')
    -- FS-26: a press with an open breakdown takes no new work.
    and not exists (select 1 from public.breakdown_logs bl where bl.company_id = p_company and bl.machine_ref_id = m.id and bl.status in ('open', 'in_progress'));
  select count(*) into v_windows from pg_temp.ap6_windows;

  insert into public.press_plan_drafts(company_id, plan_date, generated_by, job_run_id, schedule_fingerprint, basis)
    values (p_company, p_day, p_actor, p_run, private.factory_schedule_fingerprint(p_company, p_day, p_day),
      jsonb_build_object('rule', 'press-plan-heuristic-v1', 'weekday', v_wd, 'shift_windows', v_windows,
        'order', 'Earliest line promise, urgent first, then alloy/temper and die; same die on the same press avoids a die change.'))
    returning id into v_draft;

  for j in select pj.id, pj.job_number, pj.die_id, pj.profile_id, pj.planned_quantity_kg, pj.actual_quantity_kg, pj.status, d.die_number, d.die_status, d.profile_id die_profile,
      p.alloy, p.temper, p.compatible_presses, o.billets_short, o.billet_allocation_status, o.order_number, coalesce(lr.effective_date, o.expected_dispatch_date, pj.planned_date) due,
      coalesce(lr.effective_priority, o.priority, 'normal') priority
    from public.production_jobs pj join public.orders o on o.id = pj.order_id and o.company_id = p_company and o.deleted_at is null
      left join public.dies d on d.id = pj.die_id and d.company_id = p_company
      left join public.aluminium_profiles p on p.id = pj.profile_id and p.company_id = p_company
      left join private.order_line_requirements(p_company, null) lr on lr.order_item_id = pj.source_line_id
    where pj.company_id = p_company and pj.status in ('planned', 'ready') and o.current_stage not in ('closed', 'cancelled', 'delivered', 'dispatched', 'payment_pending')
      and not exists (select 1 from public.production_plan_slots s where s.company_id = p_company and s.production_job_id = pj.id and s.status in ('draft', 'scheduled', 'released'))
    order by coalesce(lr.effective_date, o.expected_dispatch_date, pj.planned_date) nulls last, case coalesce(lr.effective_priority, o.priority, 'normal') when 'urgent' then 0 when 'high' then 1 else 2 end,
      p.alloy nulls last, p.temper nulls last, pj.die_id, pj.job_number, pj.id loop
    v_remaining := greatest(coalesce(j.planned_quantity_kg, 0) - coalesce(j.actual_quantity_kg, 0), 0);
    v_un := '[]';
    if j.planned_quantity_kg is null or v_remaining <= 0 then v_un := v_un || to_jsonb('Planned quantity is missing or already produced.'::text); end if;
    if j.die_id is null or j.die_status not in ('active', 'approved') or j.die_profile is distinct from j.profile_id then
      v_un := v_un || to_jsonb(('Die ' || coalesce(j.die_number, 'not assigned') || ' is not available' || coalesce(' (' || j.die_status || ')', '') || '.')::text);
    end if;
    if coalesce(j.billets_short, 0) > 0 then v_un := v_un || to_jsonb(('Billets short: ' || j.billets_short || ' for order ' || j.order_number || '.')::text); end if;
    -- FS-26: a die that is away (AP-065 window open over the plan date) cannot be planned.
    if exists (select 1 from public.die_availability_windows dw where dw.company_id = p_company and dw.die_id = j.die_id and dw.status = 'open'
        and dw.starts_on <= p_day and (dw.expected_return is null or dw.expected_return > p_day)) then
      v_un := v_un || to_jsonb(('Die ' || coalesce(j.die_number, 'not assigned') || ' is away' || coalesce(' until ' || to_char((select max(dw.expected_return) from public.die_availability_windows dw
        where dw.company_id = p_company and dw.die_id = j.die_id and dw.status = 'open' and dw.starts_on <= p_day), 'DD Mon'), ' with no return date') || '.')::text);
    end if;
    if v_windows = 0 then v_un := v_un || to_jsonb(('No press shift capacity is configured for ' || to_char(p_day, 'Dy DD Mon') || '.')::text); end if;
    if jsonb_array_length(v_un) > 0 then
      insert into public.press_plan_unscheduled(company_id, draft_id, production_job_id, reasons) values (p_company, v_draft, j.id, v_un);
      v_skipped := v_skipped + 1; continue;
    end if;
    v_found := false;
    for w in select x.*, x.last_die is not distinct from j.die_id same_die, x.last_alloy is not distinct from j.alloy same_alloy from pg_temp.ap6_windows x
      where (coalesce(cardinality(j.compatible_presses), 0) = 0 or x.machine_name = any(j.compatible_presses)
          or exists (select 1 from public.machines mm where mm.id = x.machine_id and mm.machine_code = any(j.compatible_presses)))
        and x.used_kg < x.capacity_kg - 0.5 and x.cursor_at < x.ends_at
      order by (x.last_die is not distinct from j.die_id) desc, (x.last_alloy is not distinct from j.alloy) desc, x.cursor_at, x.machine_name, x.shift loop
      v_rate := extract(epoch from (w.ends_at - w.starts_at)) / 60 / w.capacity_kg;
      v_change := w.last_die is not null and w.last_die is distinct from j.die_id;
      v_start := w.cursor_at + make_interval(mins => case when v_change then w.allowance else 0 end);
      -- Skip past planned maintenance and the same die running on another press.
      loop
        select b.ends_at into v_block from public.factory_maintenance_blocks b where b.company_id = p_company and b.machine_id = w.machine_id and b.status = 'planned'
          and b.starts_at < w.ends_at and b.ends_at > v_start and b.starts_at < v_start + make_interval(mins => greatest(1, ceil(least(v_remaining, w.capacity_kg - w.used_kg) * v_rate)::integer))
          order by b.ends_at desc limit 1;
        exit when v_block is null;
        v_start := v_block.ends_at;
      end loop;
      v_minutes := floor(extract(epoch from (w.ends_at - v_start)) / 60);
      v_kg := round(least(v_remaining, w.capacity_kg - w.used_kg, greatest(v_minutes, 0) / v_rate), 3);
      if v_kg < least(v_remaining, 100) then continue; end if;
      v_end := v_start + make_interval(mins => greatest(1, ceil(v_kg * v_rate)::integer));
      if v_end > w.ends_at then v_end := w.ends_at; end if;
      if exists (select 1 from public.production_plan_slots s join public.production_jobs j2 on j2.id = s.production_job_id
          where s.company_id = p_company and j2.die_id = j.die_id and s.machine_id <> w.machine_id and s.status in ('draft', 'scheduled', 'released')
            and s.planned_start_at < v_end and s.planned_end_at > v_start)
        or exists (select 1 from public.press_plan_draft_lines l join public.production_jobs j2 on j2.id = l.production_job_id
          where l.draft_id = v_draft and j2.die_id = j.die_id and l.machine_id <> w.machine_id and l.planned_start_at < v_end and l.planned_end_at > v_start) then continue; end if;
      v_best := w; v_found := true; exit;
    end loop;
    if not v_found then
      insert into public.press_plan_unscheduled(company_id, draft_id, production_job_id, reasons)
        values (p_company, v_draft, j.id, jsonb_build_array('No compatible press has enough free capacity on ' || to_char(p_day, 'Dy DD Mon') || ' outside maintenance.'));
      v_skipped := v_skipped + 1; continue;
    end if;
    v_reasons := jsonb_build_array(case when j.due is null then 'No promise date recorded.' else 'Due ' || to_char(j.due, 'DD Mon') || ' (' || j.priority || ').' end,
      'Die ' || j.die_number || ' available; billets ' || coalesce(j.billet_allocation_status, 'not tracked') || '.',
      case when v_best.same_die then 'Same die as the previous job on ' || v_best.machine_name || ': no die change.'
        when v_best.last_die is null then 'First job in this shift on ' || v_best.machine_name || '.'
        else 'Die change on ' || v_best.machine_name || ' (' || v_best.allowance || ' min allowance).' end);
    if v_best.same_alloy and j.alloy is not null then v_reasons := v_reasons || to_jsonb(('Grouped with ' || j.alloy || coalesce(' ' || j.temper, '') || ' run.')::text); end if;
    if v_kg < v_remaining then v_reasons := v_reasons || to_jsonb(('Partial: ' || v_kg || ' of ' || v_remaining || ' kg fits this shift.')::text); end if;
    insert into public.press_plan_draft_lines(company_id, draft_id, production_job_id, machine_id, shift, planned_start_at, planned_end_at, capacity_kg, sequence_number, reasons, origin)
      values (p_company, v_draft, j.id, v_best.machine_id, v_best.shift, v_start, v_end, v_kg, v_best.seq + 1, v_reasons, 'system');
    update pg_temp.ap6_windows set used_kg = used_kg + v_kg, cursor_at = v_end, last_die = j.die_id, last_alloy = j.alloy, seq = seq + 1
      where machine_id = v_best.machine_id and shift = v_best.shift and starts_at = v_best.starts_at;
    v_placed := v_placed + 1;
  end loop;
  update public.press_plan_drafts set basis = basis || jsonb_build_object('placed', v_placed, 'unscheduled', v_skipped) where id = v_draft;
  return v_draft;
end;
$$;
revoke all on function private.ap6_plan_build(uuid, date, uuid, uuid) from public, anon, authenticated;

create table if not exists public.press_reflows (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  breakdown_id uuid not null references public.breakdown_logs(id),
  machine_id uuid not null references public.machines(id),
  released_slots jsonb not null check (jsonb_typeof(released_slots) = 'array'),
  kept_released jsonb not null check (jsonb_typeof(kept_released) = 'array'),
  drafts jsonb not null check (jsonb_typeof(drafts) = 'array'),
  reason text not null check (length(btrim(reason)) between 5 and 300),
  applied_by uuid not null references public.app_users(id),
  applied_at timestamptz not null default clock_timestamp()
);
alter table public.press_reflows enable row level security;
revoke all on public.press_reflows from public, anon, authenticated;

create or replace function private.fs4_reflow_slots(p_company uuid, p_breakdown uuid)
returns table(slot_id uuid, job_id uuid, job_number text, order_number text, planned_start_at timestamptz, planned_end_at timestamptz, status text, plan_date date)
language sql stable security definer set search_path = public, private as $$
  select s.id, j.id, j.job_number, o.order_number, s.planned_start_at, s.planned_end_at, s.status, (s.planned_start_at at time zone 'Asia/Kolkata')::date
  from public.breakdown_logs b join public.production_plan_slots s on s.company_id = p_company and s.machine_id = b.machine_ref_id
    and s.status in ('scheduled', 'released') and coalesce(s.planned_end_at, s.planned_start_at) >= coalesce(b.start_time, b.breakdown_date::timestamptz)
  join public.production_jobs j on j.id = s.production_job_id and j.status in ('planned', 'ready', 'on_hold')
  join public.orders o on o.id = j.order_id
  where b.id = p_breakdown and b.company_id = p_company and b.status in ('open', 'in_progress')
  order by s.planned_start_at
$$;
revoke all on function private.fs4_reflow_slots(uuid, uuid) from public, anon, authenticated;

-- A die that has failed (blocked, in correction or maintenance) or is away carries the scheduled work that now cannot run
-- as planned. At risk when the die has no return date or returns after the slot's planned end.
create or replace function private.fs4_die_reflow(p_company uuid)
returns jsonb language sql stable security definer set search_path = public, private as $$
  with dies as (
    select d.id, d.die_number, d.die_status,
      (select max(w.expected_return) from public.die_availability_windows w where w.company_id = p_company and w.die_id = d.id and w.status = 'open') back_on,
      exists (select 1 from public.die_availability_windows w where w.company_id = p_company and w.die_id = d.id and w.status = 'open') away
    from public.dies d where d.company_id = p_company and d.deleted_at is null
  ), out_of_service as (
    select * from dies where die_status in ('blocked', 'under_correction', 'under_maintenance', 'correction', 'nitriding', 'inactive', 'dead', 'retired', 'scrapped') or away
  )
  select coalesce(jsonb_agg(jsonb_build_object('die_id', x.id, 'die_number', x.die_number, 'status', x.die_status, 'back_on', x.back_on,
      'work', (select jsonb_agg(jsonb_build_object('job_id', j.id, 'job_number', j.job_number, 'order_id', o.id, 'order_number', o.order_number, 'slot_status', s.status,
          'planned_end', (s.planned_end_at at time zone 'Asia/Kolkata')::date, 'promise', coalesce(ls.required_date, o.expected_dispatch_date),
          'at_risk', x.back_on is null or x.back_on > (s.planned_end_at at time zone 'Asia/Kolkata')::date) order by s.planned_start_at)
        from public.production_plan_slots s join public.production_jobs j on j.id = s.production_job_id and j.die_id = x.id and j.status not in ('completed', 'cancelled')
        join public.orders o on o.id = j.order_id left join public.order_line_schedules ls on ls.order_item_id = j.source_line_id
        where s.company_id = p_company and s.status in ('scheduled', 'released') and s.planned_end_at >= clock_timestamp())) order by x.die_number), '[]')
  from out_of_service x
  where exists (select 1 from public.production_plan_slots s join public.production_jobs j on j.id = s.production_job_id and j.die_id = x.id and j.status not in ('completed', 'cancelled')
    where s.company_id = p_company and s.status in ('scheduled', 'released') and s.planned_end_at >= clock_timestamp())
$$;
revoke all on function private.fs4_die_reflow(uuid) from public, anon, authenticated;

alter function public.fs_promise(text, jsonb) rename to fs4_promise_base;
revoke all on function public.fs4_promise_base(text, jsonb) from public, anon, authenticated;
alter function public.fs4_promise_base(text, jsonb) set schema private;

create function public.fs_promise(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_break public.breakdown_logs%rowtype; v_rows jsonb; v_fp text; v_released jsonb; v_kept jsonb; v_drafts jsonb := '[]'; v_day date; v_id uuid;
begin
  if p_command = 'reflow' then
    -- Breakdowns (base) plus dies out of service with scheduled work.
    v_rows := private.fs4_promise_base(p_command, p_payload);
    select * into c from private.ap_ctx(array['owner', 'admin', 'sales_manager', 'sales', 'factory_manager', 'production_manager']);
    return v_rows || jsonb_build_object('dies', private.fs4_die_reflow(c.company_id));
  end if;
  if p_command not in ('reflow_preview', 'reflow_apply') then return private.fs4_promise_base(p_command, p_payload); end if;
  select * into c from private.ap_ctx(array['owner', 'admin', 'factory_manager', 'production_manager']);
  perform private.ap_keys(p_payload, array['breakdown_id', 'fingerprint', 'reason']);
  select * into v_break from public.breakdown_logs where id = private.ap_uuid(p_payload, 'breakdown_id') and company_id = c.company_id;
  if v_break.id is null then raise exception 'AP: Breakdown not found.'; end if;
  if v_break.status not in ('open', 'in_progress') or v_break.machine_ref_id is null then raise exception 'AP: Only an open breakdown on a recorded press can be re-planned.'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.planned_start_at), '[]') into v_rows from private.fs4_reflow_slots(c.company_id, v_break.id) x;
  v_fp := md5(v_rows::text);
  if p_command = 'reflow_preview' then
    return jsonb_build_object('breakdown_id', v_break.id, 'slots', v_rows, 'fingerprint', v_fp,
      'effect', 'Scheduled slots on this press are released back to planning and new drafts are prepared for their dates without this press. Slots already released to the floor stay; decide them on the floor. Nothing is published until the planner publishes the drafts.');
  end if;
  if v_fp <> coalesce(p_payload ->> 'fingerprint', '') then return jsonb_build_object('state', 'stale', 'message', 'The schedule on this press changed. Review it again.'); end if;
  perform pg_advisory_xact_lock(hashtextextended(c.company_id::text || ':fs4-reflow:' || v_break.machine_ref_id, 0));
  select coalesce(jsonb_agg(x) filter (where x ->> 'status' = 'scheduled'), '[]'), coalesce(jsonb_agg(x) filter (where x ->> 'status' = 'released'), '[]') into v_released, v_kept
    from jsonb_array_elements(v_rows) x;
  if jsonb_array_length(v_released) = 0 then raise exception 'AP: No scheduled slot on this press can be released.'; end if;
  update public.production_plan_slots set status = 'cancelled', updated_at = now()
    where company_id = c.company_id and id in (select (x ->> 'slot_id')::uuid from jsonb_array_elements(v_released) x) and status = 'scheduled';
  for v_day in select distinct greatest((x ->> 'plan_date')::date, private.ist_today()) from jsonb_array_elements(v_released) x where (x ->> 'plan_date')::date <= private.ist_today() + 14 order by 1 loop
    update public.press_plan_drafts set status = 'superseded' where company_id = c.company_id and plan_date = v_day and status = 'draft';
    v_id := private.ap6_plan_build(c.company_id, v_day, c.actor_id, null);
    v_drafts := v_drafts || jsonb_build_array(jsonb_build_object('draft_id', v_id, 'plan_date', v_day));
  end loop;
  insert into public.press_reflows(company_id, breakdown_id, machine_id, released_slots, kept_released, drafts, reason, applied_by)
    values (c.company_id, v_break.id, v_break.machine_ref_id, v_released, v_kept, v_drafts, private.ap_text(p_payload ->> 'reason', 'Reason', 5, 300), c.actor_id);
  insert into public.notifications(company_id, recipient_role, notification_type, severity, title, body, action_link, entity_reference)
    values (c.company_id, 'production_manager', 'press_reflow', 'warning', 'Re-plan drafts ready after a breakdown',
      jsonb_array_length(v_released) || ' slot(s) released; review and publish ' || jsonb_array_length(v_drafts) || ' draft(s).', '/production/schedule/draft', 'fs4:reflow:' || v_break.id);
  return jsonb_build_object('state', 'applied', 'released', jsonb_array_length(v_released), 'kept_released', v_kept, 'drafts', v_drafts);
end;
$$;
revoke all on function public.fs_promise(text, jsonb) from public, anon;
grant execute on function public.fs_promise(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- FS-38: the morning brief is delivered in-app and queued for email; Monday and the 1st add weekly and monthly totals
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.owner_brief_deliveries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  brief_date date not null,
  recipient_id uuid not null references public.app_users(id),
  channel text not null check (channel in ('email')),
  address text not null,
  subject text not null,
  message text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts integer not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (company_id, brief_date, recipient_id, channel)
);
alter table public.owner_brief_deliveries enable row level security;
revoke all on public.owner_brief_deliveries from public, anon, authenticated;

create or replace function private.fs4_brief_periods(p_company uuid)
returns text language sql stable security definer set search_path = public, private as $$
  with d as (select digest_date - 1 on_day, metrics m from public.owner_daily_digests where company_id = p_company and digest_date > private.ist_today() - 62),
  w as (select count(*) n, round(coalesce(sum((m ->> 'production_kg')::numeric), 0) / 1000, 2) t, round(coalesce(sum((m ->> 'dispatch_kg')::numeric), 0) / 1000, 2) dt,
          round(coalesce(sum((m ->> 'invoiced')::numeric), 0)) inv, round(coalesce(sum((m ->> 'collections')::numeric), 0)) col from d where on_day > private.ist_today() - 8),
  mo as (select count(*) n, round(coalesce(sum((m ->> 'production_kg')::numeric), 0) / 1000, 2) t, round(coalesce(sum((m ->> 'dispatch_kg')::numeric), 0) / 1000, 2) dt,
          round(coalesce(sum((m ->> 'invoiced')::numeric), 0)) inv, round(coalesce(sum((m ->> 'collections')::numeric), 0)) col
         from d where on_day >= (date_trunc('month', private.ist_today()) - interval '1 month')::date and on_day < date_trunc('month', private.ist_today())::date)
  select concat_ws(E'\n',
    case when extract(isodow from private.ist_today()) = 1 then (select 'Last 7 days (' || n || ' digests): production ' || t || ' t; dispatch ' || dt || ' t; invoiced INR ' || inv || '; collected INR ' || col from w) end,
    case when extract(day from private.ist_today()) = 1 then (select 'Last month (' || n || ' digests): production ' || t || ' t; dispatch ' || dt || ' t; invoiced INR ' || inv || '; collected INR ' || col from mo) end)
$$;
revoke all on function private.fs4_brief_periods(uuid) from public, anon, authenticated;

-- Morning: build the brief once, notify every active owner in-app with the WhatsApp link screen, and queue one email
-- per owner with an address. The email itself is sent by the morning cron route through the configured provider.
create or replace function private.fs4_brief_deliver(p_company uuid)
returns integer language plpgsql security definer set search_path = public, private as $$
declare v jsonb := private.fs4_cockpit(p_company); v_text text; v_extra text := private.fs4_brief_periods(p_company); u record; v_n integer := 0;
begin
  v_text := (v ->> 'message') || case when coalesce(v_extra, '') <> '' then E'\n' || v_extra else '' end;
  if not exists (select 1 from public.notifications where company_id = p_company and entity_reference = 'fs4:brief:' || private.ist_today()) then
    insert into public.notifications(company_id, recipient_role, notification_type, severity, title, body, action_link, entity_reference)
      values (p_company, 'owner', 'owner_brief', 'info', 'Morning brief ' || to_char(private.ist_today(), 'DD Mon'), left(v_text, 1500), '/insights/cockpit', 'fs4:brief:' || private.ist_today());
  end if;
  for u in select id, email from public.app_users where company_id = p_company and role = 'owner' and is_active and dealer_id is null and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' loop
    insert into public.owner_brief_deliveries(company_id, brief_date, recipient_id, channel, address, subject, message)
      values (p_company, private.ist_today(), u.id, 'email', u.email, 'Omalco owner brief ' || to_char(private.ist_today(), 'DD Mon YYYY'), v_text)
      on conflict (company_id, brief_date, recipient_id, channel) do nothing;
    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function private.fs4_brief_deliver(uuid) from public, anon, authenticated;

create or replace function private.fs4_morning_job(p_company uuid, p_run uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v jsonb; v_dies integer; v_brief integer;
begin
  v := private.fs4_exposure_snapshot(p_company);
  v_dies := private.fs4_die_alerts(p_company);
  v_brief := private.fs4_brief_deliver(p_company);
  return jsonb_build_object('examined', 1, 'proposals', 0, 'alerts', coalesce((v ->> 'alerts')::integer, 0) + v_dies, 'snapshots', coalesce((v ->> 'snapshots')::integer, 0), 'briefs_queued', v_brief);
end;
$$;
revoke all on function private.fs4_morning_job(uuid, uuid) from public, anon, authenticated;

-- The cron route (service role only) reads pending emails and records each outcome.
create or replace function public.fs_brief_outbox(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Not permitted' using errcode = '42501'; end if;
  if p_command = 'pending' then
    return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'address', d.address, 'subject', d.subject, 'message', d.message) order by d.created_at)
      from (select * from public.owner_brief_deliveries where status = 'pending' and attempts < 3 and brief_date >= private.ist_today() - 1 order by created_at limit 50) d), '[]');
  elsif p_command = 'mark' then
    v_id := (p_payload ->> 'id')::uuid;
    if coalesce(p_payload ->> 'state', '') not in ('sent', 'failed') then raise exception 'Invalid state'; end if;
    update public.owner_brief_deliveries set attempts = attempts + 1, status = case when p_payload ->> 'state' = 'sent' then 'sent' when attempts + 1 >= 3 then 'failed' else 'pending' end,
      sent_at = case when p_payload ->> 'state' = 'sent' then clock_timestamp() end, last_error = left(p_payload ->> 'error', 300) where id = v_id;
    return jsonb_build_object('id', v_id);
  end if;
  raise exception 'Unknown request';
end;
$$;
revoke all on function public.fs_brief_outbox(text, jsonb) from public, anon, authenticated;
grant execute on function public.fs_brief_outbox(text, jsonb) to service_role;

-- Owners see their brief deliveries on the cockpit.
alter function public.fs_cockpit(text, jsonb) rename to fs4_cockpit_base;
revoke all on function public.fs4_cockpit_base(text, jsonb) from public, anon, authenticated;
alter function public.fs4_cockpit_base(text, jsonb) set schema private;
create function public.fs_cockpit(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record;
begin
  if p_command = 'deliveries' then
    select * into c from private.ap_ctx(array['owner', 'admin']);
    perform private.ap_keys(p_payload, array[]::text[]);
    return jsonb_build_object('rows', coalesce((select jsonb_agg(jsonb_build_object('brief_date', d.brief_date, 'channel', d.channel, 'address', d.address, 'status', d.status,
      'attempts', d.attempts, 'last_error', d.last_error, 'sent_at', d.sent_at) order by d.brief_date desc, d.address) from (select * from public.owner_brief_deliveries
      where company_id = c.company_id order by brief_date desc limit 14) d), '[]'));
  elsif p_command = 'today' then
    select * into c from private.ap_ctx(array['owner', 'admin']);
    return private.fs4_cockpit_base(p_command, p_payload) || jsonb_build_object('periods', private.fs4_brief_periods(c.company_id));
  end if;
  return private.fs4_cockpit_base(p_command, p_payload);
end;
$$;
revoke all on function public.fs_cockpit(text, jsonb) from public, anon;
grant execute on function public.fs_cockpit(text, jsonb) to authenticated;

commit;

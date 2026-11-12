-- Autopilot batch 5 review fixes (PR #8, Codex review). Additive; the batch 5 file is already applied to hosted.
-- 1. AP-071: follow-ups are scheduled per sending. A revised quotation sent again (new sent_at) gets a fresh sequence
--    instead of colliding with the stopped steps of the earlier send; a validity extension of the same send restarts
--    its stopped steps that are still ahead. The morning job looks for quotations without steps for their current send.
-- 2. AP-072: approving a floor request whose lines changed returns a "superseded" result instead of raising, so the
--    supersession is kept and a new request can be made.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '180s';

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Follow-up steps belong to one sending of the quotation.
-- ---------------------------------------------------------------------------------------------------------------
alter table public.quote_followup_steps add column if not exists cycle_sent_at timestamptz;
update public.quote_followup_steps s set cycle_sent_at = coalesce(q.sent_at, q.created_at)
  from public.quotes q where q.id = s.quote_id and s.step_kind <> 'agreed' and s.cycle_sent_at is null;
alter table public.quote_followup_steps drop constraint if exists quote_followup_steps_cycle_check;
alter table public.quote_followup_steps add constraint quote_followup_steps_cycle_check check (step_kind = 'agreed' or cycle_sent_at is not null);
drop index if exists public.quote_followup_steps_once;
create unique index if not exists quote_followup_steps_once_per_send on public.quote_followup_steps(company_id, quote_id, step_kind, coalesce(offset_days, -1), cycle_sent_at)
  where step_kind <> 'agreed';

create or replace function private.ap5_schedule_followups(p_company uuid, p_quote uuid) returns integer language plpgsql security definer set search_path = public, private as $$
declare q public.quotes%rowtype; s public.quote_followup_settings%rowtype; v_cycle timestamptz; v_sent date; d integer; v_due date; v_n integer := 0;
begin
  select * into q from public.quotes where id = p_quote and company_id = p_company;
  if q.id is null or not private.ap5_open_quote(q) then return 0; end if;
  s := private.ap5_followup_settings(p_company);
  -- One sequence per sending: sent_at is cleared when a quotation goes back to draft and set again when it is resent.
  v_cycle := coalesce(q.sent_at, q.created_at);
  v_sent := (v_cycle at time zone 'Asia/Kolkata')::date;
  foreach d in array coalesce(s.day_steps, '{}') loop
    v_due := private.ap5_working_on_or_after(p_company, v_sent + d);
    continue when q.valid_until is not null and v_due > q.valid_until;
    -- A step of this sending stopped earlier (expiry, then a validity extension) restarts if it is still ahead.
    insert into public.quote_followup_steps(company_id, quote_id, step_kind, offset_days, due_date, cycle_sent_at) values (p_company, q.id, 'after_send', d, v_due, v_cycle)
      on conflict (company_id, quote_id, step_kind, coalesce(offset_days, -1), cycle_sent_at) where step_kind <> 'agreed'
      do update set status = 'pending', due_date = excluded.due_date, stopped_reason = null, task_id = null
      where public.quote_followup_steps.status = 'stopped' and excluded.due_date >= private.ist_today();
    if found then v_n := v_n + 1; end if;
  end loop;
  if s.before_expiry_days is not null and q.valid_until is not null then
    v_due := greatest(q.valid_until - s.before_expiry_days, v_sent + 1);
    if v_due <= q.valid_until then
      insert into public.quote_followup_steps(company_id, quote_id, step_kind, offset_days, due_date, cycle_sent_at) values (p_company, q.id, 'before_expiry', s.before_expiry_days, v_due, v_cycle)
        on conflict (company_id, quote_id, step_kind, coalesce(offset_days, -1), cycle_sent_at) where step_kind <> 'agreed'
        do update set status = 'pending', due_date = excluded.due_date, stopped_reason = null, task_id = null
        where public.quote_followup_steps.status = 'pending'
          or (public.quote_followup_steps.status = 'stopped' and excluded.due_date >= private.ist_today());
      if found then v_n := v_n + 1; end if;
    end if;
  end if;
  return v_n;
end;
$$;
revoke all on function private.ap5_schedule_followups(uuid, uuid) from public, anon, authenticated;

-- Morning job: unchanged except that it schedules quotations without steps for their current sending.
create or replace function private.ap5_followups_job(p_company uuid) returns jsonb language plpgsql security definer set search_path = public, private as $$
declare q record; qq public.quotes%rowtype; st record; v_scheduled integer := 0; v_stopped integer := 0; v_tasks integer := 0; v_task uuid; v_examined integer := 0;
begin
  for q in select x.* from public.quotes x where x.company_id = p_company and x.status = 'sent' and x.deleted_at is null
      and not exists (select 1 from public.quote_followup_steps s where s.company_id = p_company and s.quote_id = x.id
        and s.cycle_sent_at = coalesce(x.sent_at, x.created_at)) loop
    v_scheduled := v_scheduled + private.ap5_schedule_followups(p_company, q.id);
  end loop;
  for qq in select x.* from public.quotes x where x.company_id = p_company and exists (select 1 from public.quote_followup_steps s where s.quote_id = x.id and s.company_id = p_company and s.status in ('pending', 'task_created')) loop
    if not private.ap5_open_quote(qq) then
      v_stopped := v_stopped + private.ap5_stop_followups(p_company, qq.id, case when qq.status <> 'sent' then 'quotation ' || replace(qq.status, '_', ' ')
        when exists (select 1 from public.orders o where o.company_id = p_company and o.quote_id = qq.id) then 'an order was created' else 'an outcome was recorded' end);
    end if;
  end loop;
  for st in select s.*, x.quote_number, x.created_by owner_id, x.customer_id from public.quote_followup_steps s join public.quotes x on x.id = s.quote_id
      where s.company_id = p_company and s.status = 'pending' and s.due_date <= private.ist_today() order by s.due_date, s.id loop
    v_examined := v_examined + 1;
    insert into public.tasks(company_id, task_type, title, description, priority, status, assigned_to, due_date, related_entity_type, related_entity_id, created_by)
      values (p_company, 'quote_followup', left('Follow up quotation ' || coalesce(st.quote_number, '') || ' with ' || coalesce(private.ap3_customer_name(st.customer_id), 'the customer'), 200),
        'Call or message the customer and record the result on the quotation. Prepared message:' || chr(10) || private.ap5_followup_message(p_company, (select x from public.quotes x where x.id = st.quote_id)),
        'normal', 'open', st.owner_id, private.ist_today(), 'quote', st.quote_id, null)
      returning id into v_task;
    update public.quote_followup_steps set status = 'task_created', task_id = v_task where id = st.id;
    v_tasks := v_tasks + 1;
  end loop;
  return jsonb_build_object('examined', v_examined, 'proposals', 0, 'alerts', v_tasks, 'details', jsonb_build_object('scheduled', v_scheduled, 'stopped', v_stopped, 'tasks', v_tasks));
end;
$$;
revoke all on function private.ap5_followups_job(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Floor approval of changed lines: keep the supersession (unchanged otherwise).
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.ap_quote_sales(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_page integer := private.ap3_page(p_payload); v_total bigint; v_rows jsonb; q public.quotes%rowtype; s public.quote_followup_steps%rowtype; v_result text; v_next date;
  v_check jsonb; e public.quote_floor_exceptions%rowtype; v_id uuid; v_show text; fl public.price_floors%rowtype; v_set public.quote_followup_settings%rowtype;
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'sales_manager', 'sales', 'accounts']);
  -- AP-071 ------------------------------------------------------------------------------------------------------
  if p_command = 'followups' then
    perform private.ap_keys(p_payload, array['quote_id']);
    select * into q from public.quotes where id = private.ap_uuid(p_payload, 'quote_id') and company_id = c.company_id and deleted_at is null;
    if q.id is null then raise exception 'AP: Quotation not found.'; end if;
    return jsonb_build_object('open', private.ap5_open_quote(q), 'message', private.ap5_followup_message(c.company_id, q),
      'steps', coalesce((select jsonb_agg(private.ap5_followup_row(c.company_id, x) order by x.due_date, x.created_at) from public.quote_followup_steps x where x.company_id = c.company_id and x.quote_id = q.id), '[]'::jsonb),
      'next_due', (select min(x.due_date) from public.quote_followup_steps x where x.company_id = c.company_id and x.quote_id = q.id and x.status in ('pending', 'task_created')));
  elsif p_command = 'followup_queue' then
    perform private.ap_keys(p_payload, array['page', 'show', 'mine']);
    v_show := coalesce(nullif(p_payload ->> 'show', ''), 'due');
    if v_show not in ('due', 'upcoming') then raise exception 'AP: Invalid filter.'; end if;
    select coalesce(jsonb_agg(z.row order by z.d, z.k), '[]'::jsonb), max(z.total) into v_rows, v_total from (
      select private.ap5_followup_row(c.company_id, x) "row", x.due_date d, x.id k, count(*) over () total from public.quote_followup_steps x join public.quotes qq on qq.id = x.quote_id
      where x.company_id = c.company_id and x.status in ('pending', 'task_created') and qq.status = 'sent'
        and (case when v_show = 'due' then x.due_date <= private.ist_today() else x.due_date > private.ist_today() end)
        and (not coalesce((p_payload ->> 'mine')::boolean, false) or qq.created_by = c.actor_id)
      order by x.due_date, x.id limit 10 offset (v_page - 1) * 10) z;
    return jsonb_build_object('page', v_page, 'total_count', coalesce(v_total, 0), 'rows', v_rows,
      'coverage', (select jsonb_build_object('open', count(*), 'with_next', count(*) filter (where exists (select 1 from public.quote_followup_steps x where x.company_id = c.company_id and x.quote_id = qq.id and x.status in ('pending', 'task_created'))))
        from public.quotes qq where qq.company_id = c.company_id and qq.status = 'sent' and qq.deleted_at is null and private.ap5_open_quote(qq)));
  elsif p_command = 'record_followup' then
    perform private.ap4_need(c.role, array['owner', 'admin', 'sales_manager', 'sales']);
    perform private.ap_keys(p_payload, array['quote_id', 'result', 'note', 'next_date']);
    select * into q from public.quotes where id = private.ap_uuid(p_payload, 'quote_id') and company_id = c.company_id and deleted_at is null for update;
    if q.id is null then raise exception 'AP: Quotation not found.'; end if;
    v_result := p_payload ->> 'result';
    if coalesce(v_result, '') not in ('reached', 'no_answer', 'considering', 'revision_requested', 'ordered', 'lost') then raise exception 'AP: Choose what happened.'; end if;
    v_next := private.ap4_day(p_payload, 'next_date', false);
    if v_next is not null and (v_next <= private.ist_today() or v_next > private.ist_today() + 90) then raise exception 'AP: The next follow-up must be after today and within 90 days.'; end if;
    if v_next is not null and v_result in ('ordered', 'lost') then raise exception 'AP: An ordered or lost quotation needs no next follow-up.'; end if;
    -- The earliest open step is the one answered; an answer without a due step is recorded as an agreed step done today.
    select * into s from public.quote_followup_steps where company_id = c.company_id and quote_id = q.id and status in ('pending', 'task_created') and due_date <= private.ist_today()
      order by due_date, created_at limit 1 for update;
    if s.id is null then
      insert into public.quote_followup_steps(company_id, quote_id, step_kind, due_date, created_by) values (c.company_id, q.id, 'agreed', private.ist_today(), c.actor_id) returning * into s;
    end if;
    update public.quote_followup_steps set status = 'done', result = v_result, note = private.ap_text(p_payload ->> 'note', 'Note', 3, 300, false), done_by = c.actor_id, done_at = clock_timestamp()
      where id = s.id;
    if s.task_id is not null then update public.tasks set status = 'completed', completed_at = now(), updated_at = now() where id = s.task_id and status in ('open', 'in_progress'); end if;
    if v_result in ('ordered', 'lost') then
      perform private.ap5_stop_followups(c.company_id, q.id, case when v_result = 'ordered' then 'customer confirmed the order' else 'customer said no' end);
    elsif v_next is not null then
      insert into public.quote_followup_steps(company_id, quote_id, step_kind, due_date, created_by) values (c.company_id, q.id, 'agreed', v_next, c.actor_id);
    end if;
    return jsonb_build_object('state', 'recorded', 'result', v_result, 'record_outcome', v_result = 'lost',
      'next_due', (select min(x.due_date) from public.quote_followup_steps x where x.company_id = c.company_id and x.quote_id = q.id and x.status in ('pending', 'task_created')));
  elsif p_command = 'followup_settings' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return to_jsonb(private.ap5_followup_settings(c.company_id)) || jsonb_build_object('can_edit', c.role = any(array['owner', 'admin', 'sales_manager']));
  elsif p_command = 'save_followup_settings' then
    perform private.ap4_need(c.role, array['owner', 'admin', 'sales_manager']);
    perform private.ap_keys(p_payload, array['day_steps', 'before_expiry_days']);
    if jsonb_typeof(p_payload -> 'day_steps') <> 'array' or jsonb_array_length(p_payload -> 'day_steps') > 6
      or exists (select 1 from jsonb_array_elements(p_payload -> 'day_steps') x where jsonb_typeof(x) <> 'number' or (x #>> '{}')::numeric not between 1 and 60 or (x #>> '{}')::numeric <> trunc((x #>> '{}')::numeric)) then
      raise exception 'AP: Follow-up days are 1 to 60, at most six.';
    end if;
    insert into public.quote_followup_settings(company_id, day_steps, before_expiry_days, updated_by)
      values (c.company_id, array(select distinct (x #>> '{}')::integer from jsonb_array_elements(p_payload -> 'day_steps') x order by 1),
        private.ap4_num(p_payload, 'before_expiry_days', 'Days before expiry', 1, 30, false)::integer, c.actor_id)
      on conflict (company_id) do update set day_steps = excluded.day_steps, before_expiry_days = excluded.before_expiry_days, updated_by = excluded.updated_by, updated_at = clock_timestamp()
      returning * into v_set;
    return to_jsonb(v_set);
  -- AP-072 ------------------------------------------------------------------------------------------------------
  elsif p_command = 'floors' then
    perform private.ap4_need(c.role, array['owner', 'admin', 'sales_manager', 'sales']);
    perform private.ap_keys(p_payload, array['page', 'status']);
    select coalesce(jsonb_agg(z.row order by z.k), '[]'::jsonb), max(z.total) into v_rows, v_total from (
      select jsonb_build_object('id', f.id, 'alloy', f.alloy, 'finishing_type', f.finishing_type, 'min_kg', f.min_kg, 'max_kg', f.max_kg, 'floor_per_kg', f.floor_per_kg, 'status', f.status,
          'reason', f.reason, 'set_by', private.ap4_user_name(f.set_by), 'set_at', f.set_at) "row",
        row_number() over (order by f.status, f.alloy nulls first, f.finishing_type nulls first, f.min_kg) k, count(*) over () total
      from public.price_floors f where f.company_id = c.company_id and (coalesce(nullif(p_payload ->> 'status', ''), 'active') = 'all' or f.status = coalesce(nullif(p_payload ->> 'status', ''), 'active'))
      order by k limit 10 offset (v_page - 1) * 10) z;
    return jsonb_build_object('page', v_page, 'total_count', coalesce(v_total, 0), 'rows', v_rows, 'can_edit', c.role = any(array['owner', 'admin']));
  elsif p_command = 'save_floor' then
    perform private.ap4_need(c.role, array['owner', 'admin']);
    perform private.ap_keys(p_payload, array['alloy', 'finishing_type', 'min_kg', 'max_kg', 'floor_per_kg', 'reason']);
    if nullif(p_payload ->> 'alloy', '') is not null and upper(btrim(p_payload ->> 'alloy')) !~ '^[0-9A-Z]{3,8}$' then raise exception 'AP: Enter the alloy, for example 6063.'; end if;
    if nullif(p_payload ->> 'finishing_type', '') is not null and (p_payload ->> 'finishing_type') !~ '^[a-z_]{3,40}$' then raise exception 'AP: Choose the finish.'; end if;
    -- A new floor for the same alloy, finish and band start replaces the active one (kept as history).
    update public.price_floors set status = 'retired', retired_by = c.actor_id, retired_at = clock_timestamp()
      where company_id = c.company_id and status = 'active' and coalesce(alloy, '') = coalesce(upper(btrim(nullif(p_payload ->> 'alloy', ''))), '')
        and coalesce(finishing_type, '') = coalesce(nullif(p_payload ->> 'finishing_type', ''), '') and min_kg = coalesce(private.ap4_num(p_payload, 'min_kg', 'From kg', 0, 1000000, false), 0);
    insert into public.price_floors(company_id, alloy, finishing_type, min_kg, max_kg, floor_per_kg, reason, set_by)
      values (c.company_id, upper(btrim(nullif(p_payload ->> 'alloy', ''))), nullif(p_payload ->> 'finishing_type', ''), coalesce(private.ap4_num(p_payload, 'min_kg', 'From kg', 0, 1000000, false), 0),
        private.ap4_num(p_payload, 'max_kg', 'Up to kg', 0.001, 10000000, false), private.ap4_num(p_payload, 'floor_per_kg', 'Floor', 0.01, 10000), private.ap_text(p_payload ->> 'reason', 'Reason', 5, 300), c.actor_id)
      returning * into fl;
    if fl.max_kg is not null and fl.max_kg <= fl.min_kg then raise exception 'AP: The band must end above where it starts.'; end if;
    return jsonb_build_object('id', fl.id);
  elsif p_command = 'retire_floor' then
    perform private.ap4_need(c.role, array['owner', 'admin']);
    perform private.ap_keys(p_payload, array['id']);
    update public.price_floors set status = 'retired', retired_by = c.actor_id, retired_at = clock_timestamp() where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id and status = 'active'
      returning id into v_id;
    if v_id is null then raise exception 'AP: Only an active floor can be retired.'; end if;
    return jsonb_build_object('id', v_id);
  elsif p_command = 'floor_check' then
    perform private.ap4_need(c.role, array['owner', 'admin', 'sales_manager', 'sales']);
    perform private.ap_keys(p_payload, array['quote_id']);
    select * into q from public.quotes where id = private.ap_uuid(p_payload, 'quote_id') and company_id = c.company_id and deleted_at is null;
    if q.id is null then raise exception 'AP: Quotation not found.'; end if;
    v_check := private.ap5_floor_check(c.company_id, q.id);
    return v_check || jsonb_build_object('quote_status', q.status, 'revision', q.revision_number,
      'approved', exists (select 1 from public.quote_floor_exceptions x where x.company_id = c.company_id and x.quote_id = q.id and x.status = 'approved' and x.revision_number = q.revision_number
        and x.lines_fingerprint = v_check ->> 'fingerprint'),
      'requests', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'status', x.status, 'reason', x.reason, 'revision', x.revision_number, 'requested_by', private.ap4_user_name(x.requested_by),
          'requested_at', x.requested_at, 'decided_by', private.ap4_user_name(x.decided_by), 'decided_at', x.decided_at, 'decision_note', x.decision_note,
          'current', x.revision_number = q.revision_number and x.lines_fingerprint = v_check ->> 'fingerprint',
          'can_decide', x.status = 'requested' and c.role = any(array['owner', 'admin']) and x.requested_by <> c.actor_id) order by x.requested_at desc)
        from (select * from public.quote_floor_exceptions y where y.company_id = c.company_id and y.quote_id = q.id order by y.requested_at desc limit 10) x), '[]'::jsonb));
  elsif p_command = 'floor_request' then
    perform private.ap4_need(c.role, array['owner', 'admin', 'sales_manager', 'sales']);
    perform private.ap_keys(p_payload, array['quote_id', 'reason']);
    select * into q from public.quotes where id = private.ap_uuid(p_payload, 'quote_id') and company_id = c.company_id and deleted_at is null for update;
    if q.id is null then raise exception 'AP: Quotation not found.'; end if;
    v_check := private.ap5_floor_check(c.company_id, q.id);
    if jsonb_array_length(v_check -> 'below') = 0 then raise exception 'AP: No line is below its floor; no approval is needed.'; end if;
    update public.quote_floor_exceptions set status = 'superseded' where company_id = c.company_id and quote_id = q.id and status = 'requested';
    insert into public.quote_floor_exceptions(company_id, quote_id, revision_number, lines_fingerprint, lines, reason, requested_by)
      values (c.company_id, q.id, q.revision_number, v_check ->> 'fingerprint', v_check -> 'below', private.ap_text(p_payload ->> 'reason', 'Reason', 10, 500), c.actor_id) returning * into e;
    insert into public.notifications(company_id, recipient_user_id, notification_type, severity, title, body, related_entity_type, related_entity_id, action_link)
      select c.company_id, u.id, 'approval_request', 'warning', left('Floor price approval: ' || coalesce(q.quote_number, ''), 200),
        left(c.full_name || ' asks to send ' || jsonb_array_length(v_check -> 'below') || ' line(s) below the floor price: ' || e.reason, 500), 'quote', q.id, '/quotes/' || q.id || '#floor'
      from public.app_users u where u.company_id = c.company_id and u.is_active and u.role in ('owner', 'admin') and u.id <> c.actor_id;
    return jsonb_build_object('id', e.id, 'status', e.status);
  elsif p_command = 'floor_decide' then
    perform private.ap4_need(c.role, array['owner', 'admin']);
    perform private.ap_keys(p_payload, array['request_id', 'decision', 'note']);
    select * into e from public.quote_floor_exceptions where id = private.ap_uuid(p_payload, 'request_id') and company_id = c.company_id for update;
    if e.id is null or e.status <> 'requested' then raise exception 'AP: This request is no longer waiting.'; end if;
    if e.requested_by = c.actor_id then raise exception 'AP: Another approver decides a floor exception you requested.'; end if;
    if coalesce(p_payload ->> 'decision', '') not in ('approve', 'reject') then raise exception 'AP: Choose approve or reject.'; end if;
    select * into q from public.quotes where id = e.quote_id;
    v_check := private.ap5_floor_check(c.company_id, q.id);
    if p_payload ->> 'decision' = 'approve' and (q.revision_number <> e.revision_number or v_check ->> 'fingerprint' <> e.lines_fingerprint) then
      -- Returned, not raised, so the supersession commits and sales can request again for the current lines.
      update public.quote_floor_exceptions set status = 'superseded' where id = e.id;
      return jsonb_build_object('id', e.id, 'status', 'superseded',
        'message', 'The quotation lines changed after the request. Sales must request again for the current lines.');
    end if;
    update public.quote_floor_exceptions set status = case when p_payload ->> 'decision' = 'approve' then 'approved' else 'rejected' end, decided_by = c.actor_id, decided_at = clock_timestamp(),
      decision_note = private.ap_text(p_payload ->> 'note', 'Note', 3, 300, p_payload ->> 'decision' = 'reject') where id = e.id returning * into e;
    return jsonb_build_object('id', e.id, 'status', e.status);
  elsif p_command = 'floor_requests' then
    perform private.ap4_need(c.role, array['owner', 'admin', 'sales_manager']);
    perform private.ap_keys(p_payload, array['page', 'status']);
    select coalesce(jsonb_agg(z.row order by z.at desc), '[]'::jsonb), max(z.total) into v_rows, v_total from (
      select jsonb_build_object('id', x.id, 'quote_id', x.quote_id, 'quote_number', qq.quote_number, 'customer', private.ap3_customer_name(qq.customer_id), 'status', x.status, 'reason', x.reason,
          'lines', jsonb_array_length(x.lines), 'requested_by', private.ap4_user_name(x.requested_by), 'requested_at', x.requested_at, 'decided_by', private.ap4_user_name(x.decided_by),
          'decision_note', x.decision_note, 'can_decide', x.status = 'requested' and c.role = any(array['owner', 'admin']) and x.requested_by <> c.actor_id) "row", x.requested_at at, count(*) over () total
      from public.quote_floor_exceptions x join public.quotes qq on qq.id = x.quote_id
      where x.company_id = c.company_id and (coalesce(nullif(p_payload ->> 'status', ''), 'requested') = 'all' or x.status = coalesce(nullif(p_payload ->> 'status', ''), 'requested'))
      order by x.requested_at desc limit 10 offset (v_page - 1) * 10) z;
    return jsonb_build_object('page', v_page, 'total_count', coalesce(v_total, 0), 'rows', v_rows);
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_quote_sales(text, jsonb) from public, anon;
grant execute on function public.ap_quote_sales(text, jsonb) to authenticated;

commit;

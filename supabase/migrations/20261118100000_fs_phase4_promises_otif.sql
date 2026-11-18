-- FABLE_SUGGESTIONS Phase 4, FS-68: on-time-in-full measurement and promise tracking.
--
-- The first date promised on every order line is captured once and never overwritten. Every later change of the
-- line's effective date (its own required date, else the order's expected dispatch date) is appended with the cause,
-- the reason and who agreed. OTIF = lines dispatched in full on or before the FIRST promise / lines whose first promise
-- has fallen due. "In full" uses the line's ordered kg less the tolerance the owner sets (0% until Omalco sets one);
-- nothing here invents a weighing tolerance.
-- Additive only. Tables are reached through the security-definer gateway public.fs_otif; no direct table grants.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table if not exists public.order_line_first_promises (
  -- Soft keys to the order and line (validated when written): a hard key would make every captured promise block the
  -- cutover reversal of an opening order. Deleting a line (only possible before it is used) removes its promise records.
  order_item_id uuid primary key,
  company_id uuid not null references public.companies(id),
  order_id uuid not null,
  first_promised_date date not null,
  -- captured: recorded when the date was first set; backfill_*: reconstructed when this upgrade was applied.
  source text not null check (source in ('captured', 'backfill_schedule_history', 'backfill_current')),
  captured_at timestamptz not null default clock_timestamp()
);
create index if not exists order_line_first_promises_due_idx on public.order_line_first_promises(company_id, first_promised_date);
create index if not exists order_line_first_promises_order_idx on public.order_line_first_promises(company_id, order_id);

create table if not exists public.order_promise_changes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  order_id uuid not null,
  order_item_id uuid not null,
  previous_date date,
  new_date date,
  cause text not null check (cause in ('die', 'material', 'press_breakdown', 'finishing_vendor', 'credit_hold', 'transport', 'quality', 'capacity', 'customer_request', 'other', 'not_recorded')),
  reason text check (reason is null or length(btrim(reason)) between 1 and 500),
  agreed_with text check (agreed_with is null or length(btrim(agreed_with)) between 2 and 120),
  source text not null check (source in ('line_schedule', 'order_date')),
  changed_by uuid references public.app_users(id),
  changed_at timestamptz not null default clock_timestamp(),
  -- A change recorded without a cause may be annotated once, later; the annotation is attributed.
  annotated_by uuid references public.app_users(id),
  annotated_at timestamptz,
  check ((annotated_at is null) = (annotated_by is null))
);
create index if not exists order_promise_changes_line_idx on public.order_promise_changes(company_id, order_item_id, changed_at desc);
create index if not exists order_promise_changes_order_idx on public.order_promise_changes(company_id, order_id);

create table if not exists public.order_line_delay_causes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  order_item_id uuid not null,
  cause text not null check (cause in ('die', 'material', 'press_breakdown', 'finishing_vendor', 'credit_hold', 'transport', 'quality', 'capacity', 'customer_request', 'other')),
  note text check (note is null or length(btrim(note)) between 3 and 300),
  recorded_by uuid not null references public.app_users(id),
  recorded_at timestamptz not null default clock_timestamp()
);
create index if not exists order_line_delay_causes_line_idx on public.order_line_delay_causes(company_id, order_item_id, recorded_at desc);

create table if not exists public.otif_settings (
  company_id uuid primary key references public.companies(id),
  in_full_tolerance_percent numeric(5,2) not null default 0 check (in_full_tolerance_percent between 0 and 10),
  reason text not null check (length(btrim(reason)) between 5 and 300),
  updated_by uuid not null references public.app_users(id),
  updated_at timestamptz not null default clock_timestamp()
);
create table if not exists public.otif_setting_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  previous_percent numeric(5,2),
  new_percent numeric(5,2) not null,
  reason text not null,
  changed_by uuid not null references public.app_users(id),
  changed_at timestamptz not null default clock_timestamp()
);

alter table public.order_line_first_promises enable row level security;
alter table public.order_promise_changes enable row level security;
alter table public.order_line_delay_causes enable row level security;
alter table public.otif_settings enable row level security;
alter table public.otif_setting_events enable row level security;
revoke all on public.order_line_first_promises, public.order_promise_changes, public.order_line_delay_causes, public.otif_settings, public.otif_setting_events
  from public, anon, authenticated;

-- History is append-only: a first promise is never changed; a change row may only receive its one-time cause annotation.
create or replace function private.fs4_guard_promise_history()
returns trigger language plpgsql set search_path = public, private as $$
begin
  if tg_op = 'DELETE' then
    -- Only the removal of the order line itself (fs4_on_order_item_delete) takes its promise records with it.
    if current_setting('fs4.line_removed', true) = old.order_item_id::text then return old; end if;
    raise exception 'AP: Promise history cannot be deleted.' using errcode = '23514';
  end if;
  if tg_table_name = 'order_line_first_promises' or tg_table_name = 'order_line_delay_causes' then
    raise exception 'AP: Promise history cannot be changed.' using errcode = '23514';
  end if;
  -- order_promise_changes: only an unrecorded cause may be annotated, once.
  if old.cause <> 'not_recorded' or old.annotated_at is not null or new.annotated_at is null
     or (new.id, new.company_id, new.order_id, new.order_item_id, new.previous_date, new.new_date, new.source, new.changed_by, new.changed_at, new.reason)
        is distinct from (old.id, old.company_id, old.order_id, old.order_item_id, old.previous_date, old.new_date, old.source, old.changed_by, old.changed_at, old.reason) then
    raise exception 'AP: Promise history cannot be changed.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.fs4_guard_promise_history() from public, anon, authenticated;
drop trigger if exists fs4_first_promise_immutable on public.order_line_first_promises;
create trigger fs4_first_promise_immutable before update or delete on public.order_line_first_promises for each row execute function private.fs4_guard_promise_history();
drop trigger if exists fs4_promise_change_immutable on public.order_promise_changes;
create trigger fs4_promise_change_immutable before update or delete on public.order_promise_changes for each row execute function private.fs4_guard_promise_history();
drop trigger if exists fs4_delay_cause_immutable on public.order_line_delay_causes;
create trigger fs4_delay_cause_immutable before update or delete on public.order_line_delay_causes for each row execute function private.fs4_guard_promise_history();
drop trigger if exists fs4_otif_event_immutable on public.otif_setting_events;
-- otif_setting_events has no order_item_id; give the guard a dedicated delete refusal.
create or replace function private.fs4_guard_setting_events()
returns trigger language plpgsql set search_path = public, private as $$
begin
  raise exception 'AP: Promise history cannot be changed.' using errcode = '23514';
end;
$$;
revoke all on function private.fs4_guard_setting_events() from public, anon, authenticated;
create trigger fs4_otif_event_immutable before update or delete on public.otif_setting_events for each row execute function private.fs4_guard_setting_events();

-- The signed-in employee, or null for system work.
create or replace function private.fs4_actor(p_company uuid)
returns uuid language sql stable security definer set search_path = public, private as $$
  select u.id from public.app_users u where u.id = auth.uid() and u.company_id = p_company
$$;
revoke all on function private.fs4_actor(uuid) from public, anon, authenticated;

-- Records the first promise of a line, or appends a change of its effective date.
create or replace function private.fs4_capture_promise(p_company uuid, p_order uuid, p_line uuid, p_previous date, p_new date, p_source text, p_reason text, p_actor uuid)
returns void language plpgsql security definer set search_path = public, private as $$
begin
  if p_new is not null and not exists (select 1 from public.order_line_first_promises where order_item_id = p_line) then
    insert into public.order_line_first_promises(order_item_id, company_id, order_id, first_promised_date, source)
      values (p_line, p_company, p_order, p_new, 'captured') on conflict (order_item_id) do nothing;
    return;
  end if;
  if p_previous is distinct from p_new and exists (select 1 from public.order_line_first_promises where order_item_id = p_line) then
    insert into public.order_promise_changes(company_id, order_id, order_item_id, previous_date, new_date, cause, reason, source, changed_by)
      values (p_company, p_order, p_line, p_previous, p_new, 'not_recorded', nullif(left(btrim(coalesce(p_reason, '')), 500), ''), p_source, coalesce(p_actor, private.fs4_actor(p_company)));
  end if;
end;
$$;
revoke all on function private.fs4_capture_promise(uuid, uuid, uuid, date, date, text, text, uuid) from public, anon, authenticated;

-- A new line inherits the order's expected dispatch date until it is given its own.
create or replace function private.fs4_on_order_item_insert()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_date date;
begin
  select o.expected_dispatch_date into v_date from public.orders o where o.id = new.order_id;
  perform private.fs4_capture_promise(new.company_id, new.order_id, new.id, null, v_date, 'order_date', null, null);
  return null;
end;
$$;
revoke all on function private.fs4_on_order_item_insert() from public, anon, authenticated;
drop trigger if exists fs4_order_item_first_promise on public.order_items;
create trigger fs4_order_item_first_promise after insert on public.order_items for each row execute function private.fs4_on_order_item_insert();

-- A removed line (an opening order reversed at cut-over, or a line never used) takes its promise records with it.
create or replace function private.fs4_on_order_item_delete()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  perform set_config('fs4.line_removed', old.id::text, true);
  delete from public.order_line_delay_causes where order_item_id = old.id;
  delete from public.order_promise_changes where order_item_id = old.id;
  delete from public.order_line_first_promises where order_item_id = old.id;
  perform set_config('fs4.line_removed', '', true);
  return null;
end;
$$;
revoke all on function private.fs4_on_order_item_delete() from public, anon, authenticated;
drop trigger if exists fs4_order_item_promise_cleanup on public.order_items;
create trigger fs4_order_item_promise_cleanup after delete on public.order_items for each row execute function private.fs4_on_order_item_delete();

-- The order's date moves every line that has no date of its own.
create or replace function private.fs4_on_order_date()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare l record;
begin
  if new.expected_dispatch_date is not distinct from old.expected_dispatch_date then return null; end if;
  for l in select oi.id from public.order_items oi left join public.order_line_schedules s on s.order_item_id = oi.id
      where oi.order_id = new.id and oi.company_id = new.company_id and s.required_date is null loop
    perform private.fs4_capture_promise(new.company_id, new.id, l.id, old.expected_dispatch_date, new.expected_dispatch_date, 'order_date', null, null);
  end loop;
  return null;
end;
$$;
revoke all on function private.fs4_on_order_date() from public, anon, authenticated;
drop trigger if exists fs4_order_date_promise on public.orders;
create trigger fs4_order_date_promise after update of expected_dispatch_date on public.orders for each row execute function private.fs4_on_order_date();

-- A line's own required date is changed only through its audited schedule event, which carries the reason and the person.
create or replace function private.fs4_on_line_schedule_event()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_order_date date;
begin
  if new.previous_required_date is not distinct from new.new_required_date then return null; end if;
  select o.expected_dispatch_date into v_order_date from public.orders o where o.id = new.order_id;
  perform private.fs4_capture_promise(new.company_id, new.order_id, new.order_item_id, coalesce(new.previous_required_date, v_order_date),
    coalesce(new.new_required_date, v_order_date), 'line_schedule', new.reason, new.changed_by);
  return null;
end;
$$;
revoke all on function private.fs4_on_line_schedule_event() from public, anon, authenticated;
drop trigger if exists fs4_line_schedule_promise on public.order_line_schedule_events;
create trigger fs4_line_schedule_promise after insert on public.order_line_schedule_events for each row execute function private.fs4_on_line_schedule_event();

-- Backfill, labelled honestly: where a line's schedule history shows an earlier own date, that is its first promise;
-- otherwise today's effective date is the best evidence available and is marked as reconstructed.
insert into public.order_line_first_promises(order_item_id, company_id, order_id, first_promised_date, source, captured_at)
select oi.id, oi.company_id, oi.order_id,
  coalesce(h.previous_required_date, coalesce(s.required_date, o.expected_dispatch_date)),
  case when h.previous_required_date is not null then 'backfill_schedule_history' else 'backfill_current' end, clock_timestamp()
from public.order_items oi
join public.orders o on o.id = oi.order_id and o.company_id = oi.company_id
left join public.order_line_schedules s on s.order_item_id = oi.id
left join lateral (select e.previous_required_date from public.order_line_schedule_events e where e.order_item_id = oi.id and e.company_id = oi.company_id
  order by e.changed_at, e.id limit 1) h on true
where coalesce(h.previous_required_date, s.required_date, o.expected_dispatch_date) is not null
on conflict (order_item_id) do nothing;

-- ---------------------------------------------------------------------------------------------------------------
-- OTIF read model
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.fs4_otif_tolerance(p_company uuid)
returns numeric language sql stable security definer set search_path = public, private as $$
  select coalesce((select in_full_tolerance_percent from public.otif_settings where company_id = p_company), 0)
$$;
revoke all on function private.fs4_otif_tolerance(uuid) from public, anon, authenticated;

-- Every line whose first promise falls in [p_from, p_to] (and not after today). complete_on is the dispatch date on
-- which the line's dispatched kg first reached ordered kg less the tolerance.
create or replace function private.fs4_otif_lines(p_company uuid, p_from date, p_to date)
returns table(order_item_id uuid, order_id uuid, order_number text, customer_id uuid, customer_name text, salesperson_id uuid, salesperson text,
  profile_id uuid, profile_code text, ordered_kg numeric, dispatched_kg numeric, first_promised_date date, first_promise_source text, current_promise date,
  changes integer, complete_on date, outcome text, cause text)
language sql stable security definer set search_path = public, private as $$
  with tol as (select private.fs4_otif_tolerance(p_company) pct),
  lines as (
    select fp.order_item_id, fp.order_id, fp.first_promised_date, fp.source, o.order_number, o.customer_id, o.created_by,
      oi.profile_id, coalesce(s.required_date, o.expected_dispatch_date) current_promise,
      coalesce(oi.quantity_kg, case when (select count(*) from public.order_items x where x.order_id = o.id) = 1 then o.production_quantity_kg end) ordered_kg
    from public.order_line_first_promises fp
    join public.orders o on o.id = fp.order_id and o.company_id = p_company
    join public.order_items oi on oi.id = fp.order_item_id
    left join public.order_line_schedules s on s.order_item_id = fp.order_item_id
    where fp.company_id = p_company and fp.first_promised_date between p_from and least(p_to, private.ist_today())
      and o.deleted_at is null and coalesce(o.current_stage, '') not in ('cancelled')
  ),
  shipped as (
    select l.order_item_id, d.actual_dispatched_at, sum(pl.net_weight_kg) over (partition by l.order_item_id order by d.actual_dispatched_at, d.id) cum_kg
    from lines l join public.packing_list_items pl on pl.company_id = p_company and pl.order_item_id = l.order_item_id
    join public.dispatches d on d.id = pl.dispatch_id and d.company_id = p_company
    where d.actual_dispatched_at is not null and coalesce(d.delivery_status, '') not in ('cancelled', 'returned')
  )
  select l.order_item_id, l.order_id, l.order_number, l.customer_id, coalesce(nullif(btrim(cu.company_name), ''), cu.customer_name),
    l.created_by, coalesce(u.full_name, 'Not recorded'), l.profile_id, p.profile_code, l.ordered_kg,
    coalesce((select max(x.cum_kg) from shipped x where x.order_item_id = l.order_item_id), 0),
    l.first_promised_date, l.source, l.current_promise,
    (select count(*)::integer from public.order_promise_changes c where c.company_id = p_company and c.order_item_id = l.order_item_id),
    done.complete_on,
    case when l.ordered_kg is null or l.ordered_kg <= 0 then 'quantity_missing'
      when done.complete_on is null then 'open_late'
      when done.complete_on <= l.first_promised_date then 'otif'
      else 'late' end,
    coalesce(
      (select c.cause from public.order_line_delay_causes c where c.company_id = p_company and c.order_item_id = l.order_item_id order by c.recorded_at desc, c.id desc limit 1),
      (select c.cause from public.order_promise_changes c where c.company_id = p_company and c.order_item_id = l.order_item_id and c.cause <> 'not_recorded' order by c.changed_at desc, c.id desc limit 1),
      'not_recorded')
  from lines l
  join public.customers cu on cu.id = l.customer_id
  left join public.app_users u on u.id = l.created_by
  left join public.aluminium_profiles p on p.id = l.profile_id
  left join lateral (select (min(x.actual_dispatched_at) at time zone 'Asia/Kolkata')::date complete_on from shipped x
    where x.order_item_id = l.order_item_id and l.ordered_kg > 0 and x.cum_kg >= l.ordered_kg * (1 - (select pct from tol) / 100) - 0.001) done on true
$$;
revoke all on function private.fs4_otif_lines(uuid, date, date) from public, anon, authenticated;

create or replace function private.fs4_otif_summary(p_company uuid, p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = public, private as $$
  with l as (select * from private.fs4_otif_lines(p_company, p_from, p_to) where outcome <> 'quantity_missing'),
  grp as (
    select 'customer' dim, customer_id::text k, customer_name label, outcome, cause from l
    union all select 'salesperson', coalesce(salesperson_id::text, 'none'), salesperson, outcome, cause from l
    union all select 'profile', coalesce(profile_id::text, 'none'), coalesce(profile_code, 'No profile'), outcome, cause from l
    union all select 'cause', cause, cause, outcome, cause from l where outcome <> 'otif'
  ),
  agg as (select dim, k, max(label) label, count(*) due, count(*) filter (where outcome = 'otif') otif from grp group by dim, k)
  select jsonb_build_object('from', p_from, 'to', least(p_to, private.ist_today()), 'tolerance_percent', private.fs4_otif_tolerance(p_company),
    'due', (select count(*) from l), 'otif', (select count(*) from l where outcome = 'otif'),
    'late', (select count(*) from l where outcome = 'late'), 'open_late', (select count(*) from l where outcome = 'open_late'),
    'quantity_missing', (select count(*) from private.fs4_otif_lines(p_company, p_from, p_to) where outcome = 'quantity_missing'),
    'otif_percent', (select case when count(*) > 0 then round(count(*) filter (where outcome = 'otif') * 100.0 / count(*), 1) end from l),
    'reconstructed_first_promises', (select count(*) from l where first_promise_source <> 'captured'),
    'by', coalesce((select jsonb_object_agg(dim, rows) from (select dim, jsonb_agg(jsonb_build_object('key', k, 'label', label, 'due', due, 'otif', otif,
        'otif_percent', round(otif * 100.0 / nullif(due, 0), 1)) order by due desc, label) rows from agg group by dim) z), '{}'),
    'basis', 'Lines whose first promised date fell due in the period. On time in full: dispatched kg reached ordered kg less the in-full tolerance on or before the first promise. Later promise changes never move the target.')
$$;
revoke all on function private.fs4_otif_summary(uuid, date, date) from public, anon, authenticated;

create or replace function public.fs_otif(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_from date; v_to date; v_page integer := private.ap3_page(p_payload); v_rows jsonb; v_total bigint; v_line uuid;
  v_change public.order_promise_changes%rowtype; v_cause text; v_pct numeric; v_old numeric;
  v_causes constant text[] := array['die', 'material', 'press_breakdown', 'finishing_vendor', 'credit_hold', 'transport', 'quality', 'capacity', 'customer_request', 'other'];
begin
  if p_command in ('summary', 'lines', 'history', 'settings') then
    select * into c from private.ap_ctx(array['owner', 'admin', 'sales_manager', 'accounts', 'factory_manager', 'production_manager', 'dispatch_manager']);
  elsif p_command in ('set_cause', 'annotate_change') then
    select * into c from private.ap_ctx(array['owner', 'admin', 'sales_manager', 'factory_manager', 'production_manager', 'dispatch_manager']);
  elsif p_command = 'save_settings' then
    select * into c from private.ap_ctx(array['owner', 'admin']);
  else raise exception 'AP: Unknown request.'; end if;

  if p_command in ('summary', 'lines') then
    v_to := coalesce(nullif(p_payload ->> 'to', '')::date, private.ist_today());
    v_from := coalesce(nullif(p_payload ->> 'from', '')::date, v_to - 29);
    if v_from > v_to or v_to - v_from > 400 then raise exception 'AP: Choose a period of at most 400 days.'; end if;
  end if;

  if p_command = 'summary' then
    perform private.ap_keys(p_payload, array['from', 'to']);
    return private.fs4_otif_summary(c.company_id, v_from, v_to);
  elsif p_command = 'lines' then
    perform private.ap_keys(p_payload, array['from', 'to', 'page', 'outcome', 'customer_id', 'cause']);
    if coalesce(p_payload ->> 'outcome', 'all') not in ('all', 'otif', 'late', 'open_late', 'missed') then raise exception 'AP: Choose a valid outcome.'; end if;
    with l as (select * from private.fs4_otif_lines(c.company_id, v_from, v_to) x
      where (coalesce(p_payload ->> 'outcome', 'all') = 'all' or x.outcome = p_payload ->> 'outcome' or (p_payload ->> 'outcome' = 'missed' and x.outcome in ('late', 'open_late')))
        and (nullif(p_payload ->> 'customer_id', '') is null or x.customer_id = (p_payload ->> 'customer_id')::uuid)
        and (nullif(p_payload ->> 'cause', '') is null or x.cause = p_payload ->> 'cause')),
    n as (select l.*, row_number() over (order by l.first_promised_date desc, l.order_number, l.order_item_id) k from l)
    select coalesce(jsonb_agg(to_jsonb(n) - 'k' order by n.k) filter (where n.k > (v_page - 1) * 10 and n.k <= v_page * 10), '[]'), count(*) into v_rows, v_total from n;
    return jsonb_build_object('rows', v_rows, 'page', v_page, 'total_count', v_total);
  elsif p_command = 'history' then
    perform private.ap_keys(p_payload, array['order_item_id']);
    v_line := private.ap_uuid(p_payload, 'order_item_id');
    if not exists (select 1 from public.order_items where id = v_line and company_id = c.company_id) then raise exception 'AP: Order line not found.'; end if;
    return jsonb_build_object(
      'first', (select to_jsonb(f) - 'company_id' from public.order_line_first_promises f where f.order_item_id = v_line),
      'changes', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'previous_date', x.previous_date, 'new_date', x.new_date, 'cause', x.cause, 'reason', x.reason,
          'agreed_with', x.agreed_with, 'source', x.source, 'changed_by', u.full_name, 'changed_at', x.changed_at, 'annotated_by', a.full_name, 'annotated_at', x.annotated_at) order by x.changed_at, x.id)
        from public.order_promise_changes x left join public.app_users u on u.id = x.changed_by left join public.app_users a on a.id = x.annotated_by
        where x.company_id = c.company_id and x.order_item_id = v_line), '[]'),
      'causes', coalesce((select jsonb_agg(jsonb_build_object('cause', x.cause, 'note', x.note, 'recorded_by', u.full_name, 'recorded_at', x.recorded_at) order by x.recorded_at desc)
        from public.order_line_delay_causes x join public.app_users u on u.id = x.recorded_by where x.company_id = c.company_id and x.order_item_id = v_line), '[]'));
  elsif p_command = 'set_cause' then
    perform private.ap_keys(p_payload, array['order_item_id', 'cause', 'note']);
    v_line := private.ap_uuid(p_payload, 'order_item_id');
    v_cause := p_payload ->> 'cause';
    if v_cause is null or not (v_cause = any(v_causes)) then raise exception 'AP: Choose the cause of the delay.'; end if;
    if not exists (select 1 from public.order_line_first_promises f where f.order_item_id = v_line and f.company_id = c.company_id) then raise exception 'AP: This line has no promise yet.'; end if;
    insert into public.order_line_delay_causes(company_id, order_item_id, cause, note, recorded_by)
      values (c.company_id, v_line, v_cause, private.ap_text(p_payload ->> 'note', 'Note', 3, 300, false), c.actor_id);
    return jsonb_build_object('order_item_id', v_line, 'cause', v_cause);
  elsif p_command = 'annotate_change' then
    perform private.ap_keys(p_payload, array['id', 'cause', 'agreed_with']);
    v_cause := p_payload ->> 'cause';
    if v_cause is null or not (v_cause = any(v_causes)) then raise exception 'AP: Choose the cause of the change.'; end if;
    select * into v_change from public.order_promise_changes where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id for update;
    if v_change.id is null then raise exception 'AP: Promise change not found.'; end if;
    if v_change.cause <> 'not_recorded' or v_change.annotated_at is not null then raise exception 'AP: The cause of this change is already recorded.'; end if;
    update public.order_promise_changes set cause = v_cause, agreed_with = private.ap_text(p_payload ->> 'agreed_with', 'Agreed with', 2, 120, false),
      annotated_by = c.actor_id, annotated_at = clock_timestamp() where id = v_change.id;
    return jsonb_build_object('id', v_change.id, 'cause', v_cause);
  elsif p_command = 'settings' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return jsonb_build_object('in_full_tolerance_percent', private.fs4_otif_tolerance(c.company_id),
      'set', (select jsonb_build_object('reason', s.reason, 'updated_by', u.full_name, 'updated_at', s.updated_at) from public.otif_settings s join public.app_users u on u.id = s.updated_by where s.company_id = c.company_id));
  elsif p_command = 'save_settings' then
    perform private.ap_keys(p_payload, array['in_full_tolerance_percent', 'reason']);
    v_pct := private.ap4_num(p_payload, 'in_full_tolerance_percent', 'In-full tolerance', 0, 10);
    v_old := (select in_full_tolerance_percent from public.otif_settings where company_id = c.company_id);
    insert into public.otif_settings(company_id, in_full_tolerance_percent, reason, updated_by)
      values (c.company_id, v_pct, private.ap_text(p_payload ->> 'reason', 'Reason', 5, 300), c.actor_id)
      on conflict (company_id) do update set in_full_tolerance_percent = excluded.in_full_tolerance_percent, reason = excluded.reason, updated_by = excluded.updated_by, updated_at = clock_timestamp();
    insert into public.otif_setting_events(company_id, previous_percent, new_percent, reason, changed_by) values (c.company_id, v_old, v_pct, btrim(p_payload ->> 'reason'), c.actor_id);
    return jsonb_build_object('in_full_tolerance_percent', v_pct);
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.fs_otif(text, jsonb) from public, anon;
grant execute on function public.fs_otif(text, jsonb) to authenticated;

commit;

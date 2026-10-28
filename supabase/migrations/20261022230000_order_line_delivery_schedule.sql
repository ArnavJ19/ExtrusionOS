-- UPGRADE_EOS feature 38: delivery dates and priorities by order line.
--
-- A line may carry its own required date and priority; otherwise it inherits the order's
-- expected dispatch date and priority. Schedules live beside order_items (whose rows are guarded
-- by workflow triggers) so setting a date never rewrites the commercial line. Every change is an
-- audited event with the previous and new value and a reason; the order's stage and status
-- aggregation are unchanged. Production and dispatch queues read the effective line requirement.
-- Line progress uses the same bases as the order workspace (feature 6): ordered kg falls back to
-- the order-level production quantity for a single-line order, produced kg is completed jobs'
-- actual output, open planned kg is the planned quantity of live jobs, uncredited dealer-stock
-- fulfilment counts as supplied, and packed kg is packing history by source line on
-- non-returned dispatches. A cleared override keeps its row (both values null) so the version
-- never repeats and a stale editor is always detected.
-- Additive only.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.order_line_schedules (
  order_item_id uuid primary key references public.order_items(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  order_id uuid not null references public.orders(id) on delete cascade,
  required_date date,
  priority text check (priority is null or priority in ('low','normal','high','urgent')),
  version integer not null default 1 check (version >= 1),
  updated_by uuid not null references public.app_users(id),
  updated_by_name text not null,
  updated_at timestamptz not null default now()
);
create index order_line_schedules_order_idx on public.order_line_schedules(company_id, order_id);
create index order_line_schedules_due_idx on public.order_line_schedules(company_id, required_date);
create index order_line_schedules_updated_by_idx on public.order_line_schedules(updated_by);

create table public.order_line_schedule_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  order_id uuid not null references public.orders(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  request_id uuid not null,
  previous_required_date date,
  new_required_date date,
  previous_priority text,
  new_priority text,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  changed_by uuid not null references public.app_users(id),
  changed_by_name text not null,
  changed_at timestamptz not null default now()
);
create unique index order_line_schedule_events_request_key on public.order_line_schedule_events(company_id, request_id);
create index order_line_schedule_events_line_idx on public.order_line_schedule_events(company_id, order_item_id, changed_at desc);
create index order_line_schedule_events_order_idx on public.order_line_schedule_events(order_id);
create index order_line_schedule_events_changed_by_idx on public.order_line_schedule_events(changed_by);

-- Line progress reads packing history by source line; the existing index leads with source_record_id.
create index if not exists packing_list_items_company_source_line_idx on public.packing_list_items(company_id, source_line_id);

alter table public.order_line_schedules enable row level security;
alter table public.order_line_schedule_events enable row level security;
revoke all on public.order_line_schedules, public.order_line_schedule_events from public, anon, authenticated;
grant select on public.order_line_schedules, public.order_line_schedule_events to authenticated;
create policy order_line_schedules_read on public.order_line_schedules for select to authenticated
  using (company_id = private.get_current_user_company_id() and private.get_current_user_dealer_id() is null
    and private.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager','production','factory_manager','dispatch_manager','dispatch','inventory_manager','accounts','quality','viewer'));
create policy order_line_schedule_events_read on public.order_line_schedule_events for select to authenticated
  using (company_id = private.get_current_user_company_id() and private.get_current_user_dealer_id() is null
    and private.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager','production','factory_manager','dispatch_manager','dispatch','inventory_manager','accounts','quality','viewer'));

create or replace function private.order_line_priority_rank(p_priority text)
returns integer language sql immutable set search_path = public, private as $$
  select case p_priority when 'urgent' then 1 when 'high' then 2 when 'normal' then 3 when 'low' then 4 else 3 end
$$;
revoke all on function private.order_line_priority_rank(text) from public, anon, authenticated;

-- One row per order line with its effective requirement and progress. Callers filter by company.
create or replace function private.order_line_requirements(p_company uuid, p_order uuid)
returns table (
  order_item_id uuid, order_id uuid, order_number text, customer_name text, order_stage text, line_label text, profile_code text,
  ordered_kg numeric, from_stock_kg numeric, produced_kg numeric, planned_open_kg numeric, packed_kg numeric, dispatched_kg numeric,
  line_required_date date, line_priority text, effective_date date, effective_priority text, date_source text, priority_source text,
  version integer, updated_by_name text, updated_at timestamptz, order_closed boolean
) language sql stable security definer set search_path = public, private as $$
  select i.id, o.id, o.order_number, coalesce(c.company_name, c.customer_name), o.current_stage,
    coalesce(nullif(btrim(i.section_name), ''), nullif(btrim(i.component_description), ''), nullif(btrim(i.item_description), ''), p.profile_code, 'Order line'),
    p.profile_code,
    coalesce(i.quantity_kg, case when line_count.n = 1 then coalesce(o.production_quantity_kg, o.manufacturing_weight_kg) end),
    coalesce(stock.from_stock_kg, 0), coalesce(jobs.produced_kg, 0), coalesce(jobs.planned_open_kg, 0),
    coalesce(packs.packed_kg, 0), coalesce(packs.dispatched_kg, 0),
    s.required_date, s.priority,
    coalesce(s.required_date, o.expected_dispatch_date), coalesce(s.priority, o.priority),
    case when s.required_date is not null then 'line' when o.expected_dispatch_date is not null then 'order' else 'none' end,
    case when s.priority is not null then 'line' else 'order' end,
    coalesce(s.version, 0), s.updated_by_name, s.updated_at,
    o.current_stage in ('delivered','payment_pending','closed','cancelled')
  from public.order_items i
  join public.orders o on o.id = i.order_id and o.company_id = p_company and o.deleted_at is null
  left join public.customers c on c.id = o.customer_id and c.company_id = p_company
  left join public.aluminium_profiles p on p.id = i.profile_id and p.company_id = p_company
  left join public.order_line_schedules s on s.order_item_id = i.id and s.company_id = p_company
  cross join lateral (select count(*) as n from public.order_items x where x.company_id = p_company and x.order_id = o.id) line_count
  left join lateral (
    select sum(f.fulfilled_weight_kg) as from_stock_kg from public.order_dealer_stock_fulfillments f
    where f.company_id = p_company and f.order_item_id = i.id and f.credited_at is null
  ) stock on true
  left join lateral (
    select sum(j.actual_quantity_kg) filter (where j.status = 'completed' and j.actual_quantity_kg > 0) as produced_kg,
           sum(coalesce(j.planned_quantity_kg, 0)) filter (where not (j.status = 'completed' and j.actual_quantity_kg > 0)) as planned_open_kg
    from public.production_jobs j
    where j.company_id = p_company and j.order_id = o.id and j.source_line_id = i.id and j.status <> 'cancelled'
  ) jobs on true
  left join lateral (
    select sum(coalesce(pl.net_weight_kg, 0)) as packed_kg,
           sum(coalesce(pl.net_weight_kg, 0)) filter (where d.delivery_status in ('dispatched','in_transit','delivered','delayed','damaged')) as dispatched_kg
    from public.packing_list_items pl
    join public.dispatches d on d.id = pl.dispatch_id and d.company_id = p_company and d.order_id = o.id
    where pl.company_id = p_company and pl.source_line_id = i.id and d.delivery_status <> 'returned'
  ) packs on true
  where i.company_id = p_company and (p_order is null or i.order_id = p_order)
$$;
revoke all on function private.order_line_requirements(uuid, uuid) from public, anon, authenticated;

create or replace function public.order_line_schedule_command(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  v_actor uuid := auth.uid();
  v_company uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_name text;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_line record;
  v_schedule public.order_line_schedules%rowtype;
  v_event public.order_line_schedule_events%rowtype;
  v_request uuid; v_item uuid; v_order uuid;
  v_date date; v_priority text; v_reason text; v_expected integer;
  v_page integer; v_rows jsonb; v_total bigint; v_scope text; v_filter text;
begin
  if v_actor is null or v_company is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid schedule request'; end if;
  select coalesce(nullif(full_name, ''), 'Employee') into v_name from public.app_users
  where id = v_actor and company_id = v_company and role = v_role and is_active and dealer_id is null;
  if not found
     or p_command not in ('schedule.lines','schedule.set','schedule.history','schedule.queue')
     or (p_command = 'schedule.set' and v_role not in ('owner','admin','sales_manager','sales','production_manager','factory_manager'))
     or v_role not in ('owner','admin','sales_manager','sales','production_manager','production','factory_manager','dispatch_manager','dispatch','inventory_manager','accounts','quality','viewer') then
    raise exception 'This action is not permitted for your role' using errcode = '42501';
  end if;

  if p_command = 'schedule.lines' then
    v_order := (p_payload ->> 'order_id')::uuid;
    if not exists (select 1 from public.orders where id = v_order and company_id = v_company and deleted_at is null) then raise exception 'Order is unavailable'; end if;
    select count(*), coalesce(jsonb_agg(to_jsonb(r) order by r.effective_rank, r.effective_date nulls last, r.line_label, r.order_item_id), '[]'::jsonb) into v_total, v_rows
    from (
      select q.*, private.order_line_priority_rank(q.effective_priority) as effective_rank
      from private.order_line_requirements(v_company, v_order) q
      limit 200
    ) r;
    return jsonb_build_object('rows', v_rows, 'total_count', v_total, 'today', v_today);

  elsif p_command = 'schedule.set' then
    v_item := (p_payload ->> 'order_item_id')::uuid;
    v_request := (p_payload ->> 'request_id')::uuid;
    v_reason := btrim(coalesce(p_payload ->> 'reason', ''));
    v_priority := nullif(p_payload ->> 'priority', '');
    v_expected := (p_payload ->> 'expected_version')::integer;
    begin
      v_date := nullif(p_payload ->> 'required_date', '')::date;
    exception when others then
      raise exception 'Choose a valid required date';
    end;
    if v_request is null or v_item is null or v_expected is null then raise exception 'A request identity, line and version are required'; end if;
    if v_priority is not null and v_priority not in ('low','normal','high','urgent') then raise exception 'Choose a valid priority'; end if;
    if length(v_reason) not between 1 and 500 or v_reason ~ '[[:cntrl:]]' then raise exception 'Record why the line requirement is changing (up to 500 characters)'; end if;

    -- Idempotent retry: the same request returns its recorded result; reuse for other details is refused.
    select * into v_event from public.order_line_schedule_events where company_id = v_company and request_id = v_request;
    if found then
      if v_event.order_item_id <> v_item or v_event.new_required_date is distinct from v_date or v_event.new_priority is distinct from v_priority or v_event.reason <> v_reason or v_event.changed_by <> v_actor then
        raise exception 'The request identity was already used for different details';
      end if;
      select * into v_schedule from public.order_line_schedules where order_item_id = v_item and company_id = v_company;
      return jsonb_build_object('order_item_id', v_item, 'version', coalesce(v_schedule.version, 0));
    end if;

    perform pg_advisory_xact_lock(hashtextextended(v_company::text || ':order-line-schedule:' || v_item::text, 0));
    select i.id, i.order_id, o.current_stage, o.order_date, o.deleted_at, o.priority as order_priority, o.expected_dispatch_date
      into v_line
    from public.order_items i join public.orders o on o.id = i.order_id and o.company_id = v_company
    where i.id = v_item and i.company_id = v_company
    for update of o;
    if not found or v_line.deleted_at is not null then raise exception 'Order line is unavailable'; end if;
    if v_line.current_stage in ('delivered','payment_pending','closed','cancelled') then raise exception 'Delivery requirements cannot change on a delivered, closed or cancelled order'; end if;
    select * into v_schedule from public.order_line_schedules where order_item_id = v_item and company_id = v_company for update;
    if coalesce(v_schedule.version, 0) <> v_expected then raise exception 'The line requirement changed since you opened it. Refresh and review it'; end if;
    if v_date is not null and (v_date < v_line.order_date or v_date > v_line.order_date + 730) then raise exception 'The required date must fall between the order date and two years after it'; end if;
    if v_date is not null and v_date < v_today and v_date is distinct from v_schedule.required_date then raise exception 'Choose today or a later required date'; end if;
    if v_date is not distinct from v_schedule.required_date and v_priority is not distinct from v_schedule.priority then raise exception 'Nothing changed on this line'; end if;
    if exists (
      select 1 from private.order_line_requirements(v_company, v_line.order_id) q
      where q.order_item_id = v_item and q.ordered_kg is not null and q.ordered_kg > 0 and q.packed_kg + q.from_stock_kg >= q.ordered_kg
    ) then raise exception 'This line is fully packed. Its delivery requirement can no longer change'; end if;

    if v_schedule.order_item_id is null then
      insert into public.order_line_schedules(order_item_id, company_id, order_id, required_date, priority, version, updated_by, updated_by_name)
      values (v_item, v_company, v_line.order_id, v_date, v_priority, 1, v_actor, v_name);
    else
      update public.order_line_schedules set required_date = v_date, priority = v_priority, version = version + 1, updated_by = v_actor, updated_by_name = v_name, updated_at = now()
      where order_item_id = v_item and company_id = v_company;
    end if;
    insert into public.order_line_schedule_events(company_id, order_id, order_item_id, request_id, previous_required_date, new_required_date, previous_priority, new_priority, reason, changed_by, changed_by_name)
    values (v_company, v_line.order_id, v_item, v_request, v_schedule.required_date, v_date, v_schedule.priority, v_priority, v_reason, v_actor, v_name);
    return jsonb_build_object('order_item_id', v_item, 'version', coalesce(v_schedule.version, 0) + 1);

  elsif p_command = 'schedule.history' then
    v_item := (p_payload ->> 'order_item_id')::uuid;
    v_page := coalesce((p_payload ->> 'page')::integer, 1);
    if v_page < 1 or v_page > 100000 then raise exception 'Invalid page'; end if;
    if not exists (select 1 from public.order_items where id = v_item and company_id = v_company) then raise exception 'Order line is unavailable'; end if;
    select count(*) into v_total from public.order_line_schedule_events where company_id = v_company and order_item_id = v_item;
    select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows from (
      select id, previous_required_date, new_required_date, previous_priority, new_priority, reason, changed_by_name, changed_at
      from public.order_line_schedule_events where company_id = v_company and order_item_id = v_item
      order by changed_at desc, id limit 10 offset (v_page - 1) * 10) r;
    return jsonb_build_object('rows', v_rows, 'total_count', v_total);
  end if;

  -- schedule.queue: open lines still needing production or packing, overdue first, then priority and date.
  v_scope := coalesce(p_payload ->> 'scope', 'production');
  v_filter := coalesce(p_payload ->> 'filter', 'all');
  v_page := coalesce((p_payload ->> 'page')::integer, 1);
  if v_scope not in ('production','dispatch') or v_filter not in ('all','overdue','due_soon','line_set') or v_page < 1 or v_page > 100000 then raise exception 'Invalid queue request'; end if;
  with open_lines as (
    select q.*, private.order_line_priority_rank(q.effective_priority) as effective_rank,
      (q.effective_date is not null and q.effective_date < v_today) as overdue,
      case when v_scope = 'production' then case when q.ordered_kg is null then null else greatest(q.ordered_kg - q.from_stock_kg - q.produced_kg, 0) end
           else case when q.ordered_kg is null then null else greatest(q.ordered_kg - q.from_stock_kg - q.packed_kg, 0) end end as remaining_kg
    from private.order_line_requirements(v_company, null) q
    where not q.order_closed and q.order_stage <> 'dispatched'
  ), filtered as (
    select * from open_lines
    where (remaining_kg is null or remaining_kg > 0)
      and (v_filter = 'all'
        or (v_filter = 'overdue' and overdue)
        or (v_filter = 'due_soon' and effective_date between v_today and v_today + 3)
        or (v_filter = 'line_set' and (date_source = 'line' or priority_source = 'line')))
  )
  select (select count(*) from filtered),
    coalesce((select jsonb_agg(to_jsonb(r)) from (
      select * from filtered order by overdue desc, effective_rank, effective_date nulls last, order_number, order_item_id
      limit 10 offset (v_page - 1) * 10) r), '[]'::jsonb)
  into v_total, v_rows;
  return jsonb_build_object('rows', v_rows, 'total_count', v_total, 'today', v_today);
end;
$$;
revoke all on function public.order_line_schedule_command(text, jsonb) from public, anon;
grant execute on function public.order_line_schedule_command(text, jsonb) to authenticated;

commit;

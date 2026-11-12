-- Autopilot batch 5 (in progress, 4 of 10): AP-026 usual choices, AP-056 finishing vendor chase list, AP-071 quotation follow-ups, AP-072 floor prices.
-- vendors). Additive only. New tables have company_id, RLS, a role-scoped company read policy, a company-leading index and
-- no client grants; access goes through public.ap_usual and public.ap_finishing, which take the company and the actor
-- from auth.uid(). Nothing here changes a quotation, order or finishing record, and no message is sent.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '180s';

-- ---------------------------------------------------------------------------------------------------------------
-- AP-026: a customer's usual choices. From the customer's recent records, the most common value per field is proposed
-- with "used in k of the last n"; without a clear majority the field stays empty. Agreed values on the customer record
-- (payment terms, packing requirement, shipping address) always win over learned ones. People's answers are logged.
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.customer_usual_choice_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id),
  field text not null check (field in ('finish', 'payment_terms', 'delivery_timeline', 'packing', 'transporter', 'priority')),
  surface text not null check (surface in ('quote', 'order', 'loading')),
  source text not null check (source in ('learned', 'master')),
  suggested text not null check (length(suggested) between 1 and 300),
  decision text not null check (decision in ('used', 'dismissed')),
  decided_by uuid not null references public.app_users(id),
  decided_at timestamptz not null default clock_timestamp()
);
create index if not exists customer_usual_choice_events_company_idx on public.customer_usual_choice_events(company_id, field, decided_at desc);
create index if not exists customer_usual_choice_events_customer_idx on public.customer_usual_choice_events(customer_id);
create index if not exists customer_usual_choice_events_people_idx on public.customer_usual_choice_events(decided_by);

create or replace function private.ap5_norm(p text) returns text language sql immutable set search_path = public, private as $$
  select nullif(lower(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g'))), '') $$;
revoke all on function private.ap5_norm(text) from public, anon, authenticated;

-- The usual value among recent records: values (newest first) with blanks kept as nulls so n counts every record.
-- A value is proposed when it is used at least twice and in more than half of the records; the newest spelling is shown.
create or replace function private.ap5_mode(p_values text[]) returns jsonb language sql immutable set search_path = public, private as $$
  with v as (select x.val, x.ord, private.ap5_norm(x.val) k from unnest(p_values) with ordinality x(val, ord)),
  c as (select v.k, count(*) n, min(v.ord) newest from v where v.k is not null group by v.k),
  best as (select c.* from c order by c.n desc, c.newest limit 1)
  select case when cardinality(p_values) = 0 then null
    when (select n from best) >= 2 and (select n from best) * 2 > cardinality(p_values) then jsonb_build_object(
      'value', (select btrim(v.val) from v where v.k = (select k from best) order by v.ord limit 1), 'count', (select n from best), 'of', cardinality(p_values))
    else null end
$$;
revoke all on function private.ap5_mode(text[]) from public, anon, authenticated;

create or replace function private.ap5_usual(p_company uuid, p_customer uuid) returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare cu public.customers%rowtype; v_finish text[]; v_packing text[]; v_priority text[]; v_payment text[]; v_delivery text[]; v_transporter text[]; f jsonb := '{}'::jsonb; m jsonb;
begin
  select * into cu from public.customers where id = p_customer and company_id = p_company;
  if cu.id is null then return null; end if;
  -- Last five orders (newest first): each order's main finish (most weight) and packing requirement, and its priority.
  select coalesce(array_agg(o.finish order by o.order_date desc, o.created_at desc), '{}'), coalesce(array_agg(o.packing order by o.order_date desc, o.created_at desc), '{}'),
      coalesce(array_agg(o.priority order by o.order_date desc, o.created_at desc), '{}')
    into v_finish, v_packing, v_priority
    from (select x.order_date, x.created_at, x.priority,
        (select oi.finishing_type from public.order_items oi where oi.company_id = p_company and oi.order_id = x.id and oi.finishing_type is not null
          order by coalesce(oi.quantity_kg, oi.manufacturing_weight_kg, 0) desc, oi.created_at limit 1) finish,
        (select coalesce(nullif(btrim(oi.customer_packing_requirement), ''), nullif(btrim(oi.packing_instruction), '')) from public.order_items oi where oi.company_id = p_company and oi.order_id = x.id
          order by coalesce(oi.quantity_kg, 0) desc, oi.created_at limit 1) packing
      from public.orders x where x.company_id = p_company and x.customer_id = p_customer and x.deleted_at is null and x.current_stage <> 'cancelled' and x.opening_cutover_id is null
      order by x.order_date desc, x.created_at desc limit 5) o;
  -- Last five quotations: payment terms and delivery timeline.
  select coalesce(array_agg(q.payment_terms order by q.quote_date desc, q.created_at desc), '{}'), coalesce(array_agg(q.delivery_timeline order by q.quote_date desc, q.created_at desc), '{}')
    into v_payment, v_delivery
    from (select x.payment_terms, x.delivery_timeline, x.quote_date, x.created_at from public.quotes x where x.company_id = p_company and x.customer_id = p_customer and x.deleted_at is null
      order by x.quote_date desc, x.created_at desc limit 5) q;
  -- Last five dispatches to the customer: transporter.
  select coalesce(array_agg(d.transporter_name order by d.dispatch_date desc, d.created_at desc), '{}') into v_transporter
    from (select x.transporter_name, x.dispatch_date, x.created_at from public.dispatches x join public.orders o on o.id = x.order_id
      where x.company_id = p_company and o.customer_id = p_customer and x.delivery_status <> 'pending' order by x.dispatch_date desc, x.created_at desc limit 5) d;

  m := private.ap5_mode(v_finish);
  if m is not null then f := f || jsonb_build_object('finish', m || jsonb_build_object('source', 'learned', 'basis', 'orders')); end if;
  if nullif(btrim(cu.default_packing_requirements), '') is not null then
    f := f || jsonb_build_object('packing', jsonb_build_object('value', btrim(cu.default_packing_requirements), 'source', 'master'));
  else
    m := private.ap5_mode(v_packing);
    if m is not null then f := f || jsonb_build_object('packing', m || jsonb_build_object('source', 'learned', 'basis', 'orders')); end if;
  end if;
  m := private.ap5_mode(v_priority);
  if m is not null and m ->> 'value' <> 'normal' then f := f || jsonb_build_object('priority', m || jsonb_build_object('source', 'learned', 'basis', 'orders')); end if;
  -- Agreed payment terms on the customer record beat anything learned from quotations.
  if coalesce(nullif(btrim(cu.payment_terms), ''), nullif(btrim(cu.credit_terms), '')) is not null then
    f := f || jsonb_build_object('payment_terms', jsonb_build_object('value', coalesce(nullif(btrim(cu.payment_terms), ''), btrim(cu.credit_terms)), 'source', 'master'));
  else
    m := private.ap5_mode(v_payment);
    if m is not null then f := f || jsonb_build_object('payment_terms', m || jsonb_build_object('source', 'learned', 'basis', 'quotations')); end if;
  end if;
  m := private.ap5_mode(v_delivery);
  if m is not null then f := f || jsonb_build_object('delivery_timeline', m || jsonb_build_object('source', 'learned', 'basis', 'quotations')); end if;
  m := private.ap5_mode(v_transporter);
  if m is not null then f := f || jsonb_build_object('transporter', m || jsonb_build_object('source', 'learned', 'basis', 'dispatches')); end if;
  if nullif(btrim(cu.shipping_address), '') is not null then
    f := f || jsonb_build_object('delivery_address', jsonb_build_object('value', btrim(cu.shipping_address), 'source', 'master'));
  end if;
  return jsonb_build_object('customer_id', cu.id, 'customer', private.ap3_customer_name(cu.id), 'fields', f,
    'records', jsonb_build_object('orders', cardinality(v_finish), 'quotations', cardinality(v_payment), 'dispatches', cardinality(v_transporter)));
end;
$$;
revoke all on function private.ap5_usual(uuid, uuid) from public, anon, authenticated;

create or replace function public.ap_usual(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_customer uuid; v_total bigint; v_rows jsonb; v_days integer;
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'sales_manager', 'sales', 'dispatch_manager', 'dispatch', 'factory_manager', 'inventory_manager', 'accounts']);
  if p_command = 'customer' then
    perform private.ap_keys(p_payload, array['customer_id']);
    v_customer := private.ap_uuid(p_payload, 'customer_id');
    if not exists (select 1 from public.customers x where x.id = v_customer and x.company_id = c.company_id) then raise exception 'AP: Customer not found.'; end if;
    return private.ap5_usual(c.company_id, v_customer);
  elsif p_command = 'decide' then
    perform private.ap_keys(p_payload, array['customer_id', 'field', 'surface', 'source', 'suggested', 'decision']);
    v_customer := private.ap_uuid(p_payload, 'customer_id');
    if not exists (select 1 from public.customers x where x.id = v_customer and x.company_id = c.company_id) then raise exception 'AP: Customer not found.'; end if;
    if coalesce(p_payload ->> 'field', '') not in ('finish', 'payment_terms', 'delivery_timeline', 'packing', 'transporter', 'priority')
      or coalesce(p_payload ->> 'surface', '') not in ('quote', 'order', 'loading') or coalesce(p_payload ->> 'source', '') not in ('learned', 'master')
      or coalesce(p_payload ->> 'decision', '') not in ('used', 'dismissed') then raise exception 'AP: Invalid request.'; end if;
    insert into public.customer_usual_choice_events(company_id, customer_id, field, surface, source, suggested, decision, decided_by)
      values (c.company_id, v_customer, p_payload ->> 'field', p_payload ->> 'surface', p_payload ->> 'source', private.ap_text(p_payload ->> 'suggested', 'Suggested value', 1, 300), p_payload ->> 'decision', c.actor_id);
    return jsonb_build_object('recorded', true);
  elsif p_command = 'stats' then
    perform private.ap4_need(c.role, array['owner', 'admin', 'sales_manager']);
    perform private.ap_keys(p_payload, array['days']);
    v_days := coalesce(private.ap4_num(p_payload, 'days', 'Days', 7, 366, false), 90)::integer;
    return coalesce((select jsonb_agg(jsonb_build_object('field', x.field, 'source', x.source, 'used', x.used, 'dismissed', x.dismissed,
        'use_rate', round(100.0 * x.used / nullif(x.used + x.dismissed, 0), 1)) order by x.field, x.source)
      from (select e.field, e.source, count(*) filter (where e.decision = 'used') used, count(*) filter (where e.decision = 'dismissed') dismissed
        from public.customer_usual_choice_events e where e.company_id = c.company_id and e.decided_at > now() - make_interval(days => v_days) group by e.field, e.source) x), '[]'::jsonb);
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_usual(text, jsonb) from public, anon;
grant execute on function public.ap_usual(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-056: chase list for finishing vendors. Material at each vendor past its expected return (sent date + the finish's
-- lead time in factory working days) is listed per vendor with outstanding kg, the order's due date and a prepared
-- message. Copying the message is recorded as copied, never as sent; the vendor's promised date is recorded with it.
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.finishing_vendor_followups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  finishing_job_id uuid not null references public.finishing_jobs(id),
  vendor_id uuid not null references public.vendors(id),
  kind text not null check (kind in ('message_copied', 'promise')),
  promised_date date,
  channel text check (channel is null or channel in ('whatsapp', 'phone_call', 'email', 'visit', 'other')),
  note text check (note is null or length(note) between 3 and 300),
  recorded_by uuid not null references public.app_users(id),
  recorded_at timestamptz not null default clock_timestamp(),
  check ((kind = 'promise') = (promised_date is not null and channel is not null))
);
create index if not exists finishing_vendor_followups_job_idx on public.finishing_vendor_followups(company_id, finishing_job_id, recorded_at desc);
create index if not exists finishing_vendor_followups_jobs_fk on public.finishing_vendor_followups(finishing_job_id);
create index if not exists finishing_vendor_followups_vendor_idx on public.finishing_vendor_followups(vendor_id);
create index if not exists finishing_vendor_followups_people_idx on public.finishing_vendor_followups(recorded_by);

create or replace function private.ap5_finishing_roles() returns text[] language sql immutable set search_path = public, private as $$
  select array['owner', 'admin', 'production_manager', 'factory_manager', 'production'] $$;
revoke all on function private.ap5_finishing_roles() from public, anon, authenticated;

-- One row per finishing job still at a vendor (sent or in process), or received with weight still unaccounted.
create or replace function private.ap5_vendor_material(p_company uuid) returns table(job_id uuid, vendor_id uuid, vendor text, vendor_phone text, order_id uuid, order_number text,
  order_due date, job_number text, finishing_type text, shade text, status text, sent_date date, expected_back date, lead_days integer, outstanding_kg numeric, days_at_vendor integer,
  overdue_days integer, promised_date date, last_followup_at timestamptz, last_copied_at timestamptz, needs_chase boolean, reason text)
language sql stable security definer set search_path = public, private as $$
  with base as (
    select f.id, f.vendor_id, v.vendor_name, coalesce(nullif(btrim(v.phone), ''), null) phone, f.order_id, o.order_number, o.expected_dispatch_date, pj.job_number, f.finishing_type,
      nullif(btrim(concat_ws(' ', f.color_code, f.shade_name)), '') shade, f.status, coalesce(f.sent_date, (f.created_at at time zone 'Asia/Kolkata')::date) sent,
      lt.lead_days, private.control_custody(p_company, f.id) cust
    from public.finishing_jobs f join public.vendors v on v.id = f.vendor_id join public.orders o on o.id = f.order_id
    left join public.production_jobs pj on pj.id = f.production_job_id
    left join public.factory_finishing_lead_times lt on lt.company_id = p_company and lower(lt.finishing_type) = lower(f.finishing_type)
    where f.company_id = p_company and f.vendor_id is not null and f.status in ('sent_to_vendor', 'in_process', 'received', 'rejected')),
  m as (
    select b.*, case when b.status in ('sent_to_vendor', 'in_process') then round((b.cust ->> 'issued_kg')::numeric - (b.cust ->> 'explained_kg')::numeric, 3)
        else round((b.cust ->> 'unaccounted_kg')::numeric, 3) end outstanding,
      case when b.lead_days is null then null else private.factory_add_working_days(p_company, b.sent, b.lead_days) end expected,
      (select fu.promised_date from public.finishing_vendor_followups fu where fu.company_id = p_company and fu.finishing_job_id = b.id and fu.kind = 'promise' order by fu.recorded_at desc limit 1) promised,
      (select max(fu.recorded_at) from public.finishing_vendor_followups fu where fu.company_id = p_company and fu.finishing_job_id = b.id and fu.kind = 'promise') last_promise,
      (select max(fu.recorded_at) from public.finishing_vendor_followups fu where fu.company_id = p_company and fu.finishing_job_id = b.id and fu.kind = 'message_copied') last_copied
    from base b)
  select m.id, m.vendor_id, m.vendor_name, m.phone, m.order_id, m.order_number, m.expected_dispatch_date, m.job_number, m.finishing_type, m.shade, m.status, m.sent, m.expected, m.lead_days,
    m.outstanding, private.ist_today() - m.sent, case when m.expected is not null and m.expected < private.ist_today() then private.ist_today() - m.expected else 0 end,
    m.promised, m.last_promise, m.last_copied,
    -- Chase when the material is late (or unaccounted after receipt) and there is no promise for today or later.
    (m.outstanding > 0.5 and ((m.status in ('received', 'rejected')) or (m.expected is not null and m.expected < private.ist_today()))
      and (m.promised is null or m.promised < private.ist_today())),
    case when m.status in ('received', 'rejected') then 'Received, but weight is still unaccounted'
      when m.expected is null then 'No lead time set for this finish'
      when m.expected < private.ist_today() then 'Past the expected return'
      else 'Within the expected time' end
  from m where m.outstanding > 0.5
$$;
revoke all on function private.ap5_vendor_material(uuid) from public, anon, authenticated;

-- The vendor-safe message: our job references, finish, kilograms and sent dates. No customer names or prices.
create or replace function private.ap5_vendor_message(p_company uuid, p_vendor text, p_lines jsonb) returns text language sql stable security definer set search_path = public, private as $$
  select 'Namaste ' || coalesce(p_vendor, '') || ', this is ' || coalesce((select coalesce(nullif(btrim(co.name), ''), co.legal_name) from public.companies co where co.id = p_company), 'Omalco Extrusion')
    || '. Please share the status and the date you will return this material:' || chr(10)
    || string_agg('• ' || coalesce(l ->> 'job_number', l ->> 'order_number', 'Job') || ' – ' || initcap(replace(l ->> 'finishing_type', '_', ' ')) || coalesce(' ' || (l ->> 'shade'), '')
      || ': ' || trim_scale((l ->> 'outstanding_kg')::numeric)::text || ' kg sent on ' || to_char((l ->> 'sent_date')::date, 'DD Mon') || ' (' || (l ->> 'days_at_vendor') || ' days)', chr(10)
      order by (l ->> 'sent_date'))
    || chr(10) || 'Thank you.'
  from jsonb_array_elements(p_lines) l
$$;
revoke all on function private.ap5_vendor_message(uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.ap_finishing(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_page integer := private.ap3_page(p_payload); v_total bigint; v_rows jsonb; v_show text; v_vendor uuid; v_ids uuid[]; v_day date; v_n integer := 0; j record;
begin
  select * into c from private.ap_ctx(private.ap5_finishing_roles() || array['viewer']);
  if p_command = 'chase' then
    perform private.ap_keys(p_payload, array['page', 'show', 'vendor_id']);
    v_show := coalesce(nullif(p_payload ->> 'show', ''), 'chase');
    if v_show not in ('chase', 'all') then raise exception 'AP: Invalid filter.'; end if;
    v_vendor := private.ap_uuid(p_payload, 'vendor_id', false);
    select coalesce(jsonb_agg(z.row order by z.worst desc, z.vendor), '[]'::jsonb), max(z.total) into v_rows, v_total from (
      with lines as (select x.* from private.ap5_vendor_material(c.company_id) x where (v_show = 'all' or x.needs_chase) and (v_vendor is null or x.vendor_id = v_vendor)),
      g as (select l.vendor_id, min(l.vendor) vendor, min(l.vendor_phone) phone, sum(l.outstanding_kg) kg, max(l.overdue_days) worst, count(*) n,
          jsonb_agg(jsonb_build_object('job_id', l.job_id, 'order_id', l.order_id, 'order_number', l.order_number, 'order_due', l.order_due, 'job_number', l.job_number,
            'finishing_type', l.finishing_type, 'shade', l.shade, 'status', l.status, 'sent_date', l.sent_date, 'expected_back', l.expected_back, 'lead_days', l.lead_days,
            'outstanding_kg', l.outstanding_kg, 'days_at_vendor', l.days_at_vendor, 'overdue_days', l.overdue_days, 'promised_date', l.promised_date, 'last_copied_at', l.last_copied_at,
            'needs_chase', l.needs_chase, 'reason', l.reason) order by l.overdue_days desc, l.sent_date) lines
        from lines l group by l.vendor_id)
      select jsonb_build_object('vendor_id', g.vendor_id, 'vendor', g.vendor, 'phone', g.phone, 'outstanding_kg', round(g.kg, 3), 'worst_overdue_days', g.worst, 'jobs', g.n, 'lines', g.lines,
          'message', private.ap5_vendor_message(c.company_id, g.vendor, (select jsonb_agg(x) from jsonb_array_elements(g.lines) x where (x ->> 'needs_chase')::boolean or v_show = 'all'))) "row",
        g.worst, g.vendor, count(*) over () total
      from g order by g.worst desc, g.vendor limit 10 offset (v_page - 1) * 10) z;
    return jsonb_build_object('page', v_page, 'total_count', coalesce(v_total, 0), 'rows', v_rows,
      'coverage', (select jsonb_build_object('late', count(*) filter (where x.overdue_days > 0 or x.status in ('received', 'rejected')),
          'late_without_followup', count(*) filter (where (x.overdue_days > 0 or x.status in ('received', 'rejected')) and x.needs_chase),
          'no_lead_time', count(*) filter (where x.lead_days is null and x.status in ('sent_to_vendor', 'in_process')))
        from private.ap5_vendor_material(c.company_id) x));
  elsif p_command in ('copied', 'promise') then
    perform private.ap4_need(c.role, private.ap5_finishing_roles());
    perform private.ap_keys(p_payload, array['job_ids', 'promised_date', 'channel', 'note']);
    v_ids := array(select distinct jsonb_array_elements_text(coalesce(p_payload -> 'job_ids', '[]'::jsonb))::uuid);
    if cardinality(v_ids) < 1 or cardinality(v_ids) > 50 then raise exception 'AP: Choose 1 to 50 finishing jobs.'; end if;
    if p_command = 'promise' then
      v_day := private.ap4_day(p_payload, 'promised_date');
      if v_day < private.ist_today() or v_day > private.ist_today() + 120 then raise exception 'AP: The promised date must be today or within the next 120 days.'; end if;
      if coalesce(p_payload ->> 'channel', '') not in ('whatsapp', 'phone_call', 'email', 'visit', 'other') then raise exception 'AP: Say how the vendor gave the date.'; end if;
    end if;
    for j in select f.id, f.vendor_id from public.finishing_jobs f where f.company_id = c.company_id and f.id = any(v_ids) and f.vendor_id is not null loop
      insert into public.finishing_vendor_followups(company_id, finishing_job_id, vendor_id, kind, promised_date, channel, note, recorded_by)
        values (c.company_id, j.id, j.vendor_id, case when p_command = 'copied' then 'message_copied' else 'promise' end, v_day,
          case when p_command = 'promise' then p_payload ->> 'channel' end, private.ap_text(p_payload ->> 'note', 'Note', 3, 300, false), c.actor_id);
      v_n := v_n + 1;
    end loop;
    if v_n <> cardinality(v_ids) then raise exception 'AP: A finishing job was not found or has no vendor.'; end if;
    return jsonb_build_object('recorded', v_n, 'state', case when p_command = 'copied' then 'copied_not_sent' else 'promised' end);
  elsif p_command = 'history' then
    perform private.ap_keys(p_payload, array['job_id']);
    return coalesce((select jsonb_agg(jsonb_build_object('kind', x.kind, 'promised_date', x.promised_date, 'channel', x.channel, 'note', x.note, 'recorded_by', private.ap4_user_name(x.recorded_by),
        'recorded_at', x.recorded_at) order by x.recorded_at desc)
      from public.finishing_vendor_followups x where x.company_id = c.company_id and x.finishing_job_id = private.ap_uuid(p_payload, 'job_id')), '[]'::jsonb);
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_finishing(text, jsonb) from public, anon;
grant execute on function public.ap_finishing(text, jsonb) to authenticated;

do $$
declare t text; r text;
begin
  foreach t in array array['customer_usual_choice_events', 'finishing_vendor_followups'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('drop policy if exists %I on public.%I', 'ap5 company read', t);
    r := case when t = 'customer_usual_choice_events' then 'array[''owner'',''admin'',''sales_manager'']'
      else 'array[''owner'',''admin'',''production_manager'',''factory_manager'',''production'']' end;
    execute format('create policy %I on public.%I for select to authenticated using (company_id = (select public.get_current_user_company_id()) and (select public.get_current_user_role()) = any(%s))',
      'ap5 company read', t, r);
  end loop;
end $$;


-- ---------------------------------------------------------------------------------------------------------------
-- AP-071: quotation follow-ups on a schedule. Sending a quotation schedules follow-ups (default day 2 and day 7 after
-- sending, and 2 days before validity ends, moved to the next factory working day). Each morning the due ones become
-- tasks for the quotation's owner with a prepared message. Recording the result closes the step; "ordered" or "lost"
-- stops the sequence, as do an order, a customer decision, expiry or a recorded loss.
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.quote_followup_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  day_steps integer[] not null default array[2, 7] check (cardinality(day_steps) between 0 and 6),
  before_expiry_days integer check (before_expiry_days is null or before_expiry_days between 1 and 30),
  updated_by uuid references public.app_users(id),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.quote_followup_steps (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  quote_id uuid not null references public.quotes(id),
  step_kind text not null check (step_kind in ('after_send', 'before_expiry', 'agreed')),
  offset_days integer,
  due_date date not null,
  status text not null default 'pending' check (status in ('pending', 'task_created', 'done', 'stopped')),
  task_id uuid references public.tasks(id) on delete set null,
  result text check (result is null or result in ('reached', 'no_answer', 'considering', 'revision_requested', 'ordered', 'lost')),
  note text check (note is null or length(note) between 3 and 300),
  done_by uuid references public.app_users(id),
  done_at timestamptz,
  stopped_reason text check (stopped_reason is null or length(stopped_reason) <= 200),
  created_by uuid references public.app_users(id),
  created_at timestamptz not null default clock_timestamp(),
  check ((status = 'done') = (result is not null and done_at is not null)),
  check ((status = 'stopped') = (stopped_reason is not null))
);
create unique index if not exists quote_followup_steps_once on public.quote_followup_steps(company_id, quote_id, step_kind, coalesce(offset_days, -1)) where step_kind <> 'agreed';
create index if not exists quote_followup_steps_due_idx on public.quote_followup_steps(company_id, status, due_date);
create index if not exists quote_followup_steps_quote_idx on public.quote_followup_steps(quote_id);
create index if not exists quote_followup_steps_task_idx on public.quote_followup_steps(task_id);
create index if not exists quote_followup_steps_people_idx on public.quote_followup_steps(done_by);
create index if not exists quote_followup_steps_creator_idx on public.quote_followup_steps(created_by);

create or replace function private.ap5_followup_settings(p_company uuid) returns public.quote_followup_settings language plpgsql stable security definer set search_path = public, private as $$
declare s public.quote_followup_settings%rowtype;
begin
  select * into s from public.quote_followup_settings where company_id = p_company;
  if s.company_id is null then s.company_id := p_company; s.day_steps := array[2, 7]; s.before_expiry_days := 2; end if;
  return s;
end;
$$;
revoke all on function private.ap5_followup_settings(uuid) from public, anon, authenticated;

-- The next factory working day on or after a date (AP-004 calendar), looking at most two weeks ahead.
create or replace function private.ap5_working_on_or_after(p_company uuid, p_day date) returns date language plpgsql stable security definer set search_path = public, private as $$
declare d date := p_day; i integer := 0;
begin
  while i < 14 and not private.factory_is_working_day(p_company, d) loop d := d + 1; i := i + 1; end loop;
  return d;
end;
$$;
revoke all on function private.ap5_working_on_or_after(uuid, date) from public, anon, authenticated;

create or replace function private.ap5_open_quote(q public.quotes) returns boolean language sql stable security definer set search_path = public, private as $$
  select q.status = 'sent' and q.deleted_at is null
    and not exists (select 1 from public.quote_outcomes o where o.company_id = q.company_id and o.quote_id = q.id and o.status = 'active')
    and not exists (select 1 from public.orders o where o.company_id = q.company_id and o.quote_id = q.id and o.deleted_at is null) $$;
revoke all on function private.ap5_open_quote(public.quotes) from public, anon, authenticated;

create or replace function private.ap5_schedule_followups(p_company uuid, p_quote uuid) returns integer language plpgsql security definer set search_path = public, private as $$
declare q public.quotes%rowtype; s public.quote_followup_settings%rowtype; v_sent date; d integer; v_due date; v_n integer := 0;
begin
  select * into q from public.quotes where id = p_quote and company_id = p_company;
  if q.id is null or not private.ap5_open_quote(q) then return 0; end if;
  s := private.ap5_followup_settings(p_company);
  v_sent := coalesce((q.sent_at at time zone 'Asia/Kolkata')::date, private.ist_today());
  foreach d in array coalesce(s.day_steps, '{}') loop
    v_due := private.ap5_working_on_or_after(p_company, v_sent + d);
    continue when q.valid_until is not null and v_due > q.valid_until;
    insert into public.quote_followup_steps(company_id, quote_id, step_kind, offset_days, due_date) values (p_company, q.id, 'after_send', d, v_due) on conflict do nothing;
    if found then v_n := v_n + 1; end if;
  end loop;
  if s.before_expiry_days is not null and q.valid_until is not null then
    v_due := greatest(q.valid_until - s.before_expiry_days, v_sent + 1);
    if v_due <= q.valid_until then
      insert into public.quote_followup_steps(company_id, quote_id, step_kind, offset_days, due_date) values (p_company, q.id, 'before_expiry', s.before_expiry_days, v_due)
        on conflict (company_id, quote_id, step_kind, coalesce(offset_days, -1)) where step_kind <> 'agreed'
        do update set due_date = excluded.due_date where public.quote_followup_steps.status = 'pending';
      if found then v_n := v_n + 1; end if;
    end if;
  end if;
  return v_n;
end;
$$;
revoke all on function private.ap5_schedule_followups(uuid, uuid) from public, anon, authenticated;

-- Stops the open steps of a quotation and closes their tasks as resolved by the system.
create or replace function private.ap5_stop_followups(p_company uuid, p_quote uuid, p_reason text) returns integer language plpgsql security definer set search_path = public, private as $$
declare v_n integer;
begin
  update public.tasks t set status = 'completed', completed_at = now(), resolved_by_system_at = clock_timestamp(), system_resolution = left('Resolved by system: ' || p_reason, 300), updated_at = now()
    where t.company_id = p_company and t.status in ('open', 'in_progress')
      and t.id in (select s.task_id from public.quote_followup_steps s where s.company_id = p_company and s.quote_id = p_quote and s.status in ('pending', 'task_created') and s.task_id is not null);
  update public.quote_followup_steps set status = 'stopped', stopped_reason = left(p_reason, 200) where company_id = p_company and quote_id = p_quote and status in ('pending', 'task_created');
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function private.ap5_stop_followups(uuid, uuid, text) from public, anon, authenticated;

create or replace function private.ap5_followup_message(p_company uuid, q public.quotes) returns text language sql stable security definer set search_path = public, private as $$
  select 'Dear ' || coalesce((select coalesce(nullif(btrim(cu.contact_person), ''), private.ap3_customer_name(cu.id)) from public.customers cu where cu.id = q.customer_id), 'Sir/Madam') || ','
    || chr(10) || 'Following up on our quotation ' || coalesce(q.quote_number, '') || ' dated ' || to_char(q.quote_date, 'DD Mon YYYY')
    || ' for ' || (select count(*) from public.quote_items qi where qi.quote_id = q.id) || ' item(s), total ' || private.ap3_inr(q.grand_total) || ' including GST'
    || coalesce(', valid until ' || to_char(q.valid_until, 'DD Mon YYYY'), '') || '.'
    || chr(10) || 'Please let us know if you would like to go ahead or need any change.'
    || chr(10) || coalesce((select coalesce(nullif(btrim(co.name), ''), co.legal_name) from public.companies co where co.id = p_company), 'Omalco Extrusion')
$$;
revoke all on function private.ap5_followup_message(uuid, public.quotes) from public, anon, authenticated;

create or replace function private.ap5_on_quote_status() returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  begin
    if new.status = 'sent' and old.status is distinct from 'sent' then
      perform private.ap5_schedule_followups(new.company_id, new.id);
    elsif old.status = 'sent' and new.status <> 'sent' then
      perform private.ap5_stop_followups(new.company_id, new.id, 'quotation ' || replace(new.status, '_', ' '));
    elsif new.status = 'sent' and new.valid_until is distinct from old.valid_until then
      perform private.ap5_schedule_followups(new.company_id, new.id);
    end if;
  exception when others then null; -- follow-ups never block a quotation change; the morning job catches up
  end;
  return null;
end;
$$;
revoke all on function private.ap5_on_quote_status() from public, anon, authenticated;
drop trigger if exists zz_ap5_quote_followups on public.quotes;
create trigger zz_ap5_quote_followups after update of status, valid_until on public.quotes for each row execute function private.ap5_on_quote_status();

-- Morning job: schedule what is missing, stop what is closed, and turn today's due steps into tasks.
create or replace function private.ap5_followups_job(p_company uuid) returns jsonb language plpgsql security definer set search_path = public, private as $$
declare q record; qq public.quotes%rowtype; st record; v_scheduled integer := 0; v_stopped integer := 0; v_tasks integer := 0; v_task uuid; v_examined integer := 0;
begin
  for q in select x.* from public.quotes x where x.company_id = p_company and x.status = 'sent' and x.deleted_at is null
      and not exists (select 1 from public.quote_followup_steps s where s.company_id = p_company and s.quote_id = x.id) loop
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

create or replace function private.ap5_followup_row(p_company uuid, s public.quote_followup_steps) returns jsonb language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('id', s.id, 'quote_id', s.quote_id, 'quote_number', q.quote_number, 'customer', private.ap3_customer_name(q.customer_id), 'customer_id', q.customer_id,
    'step_kind', s.step_kind, 'offset_days', s.offset_days, 'due_date', s.due_date, 'status', s.status, 'result', s.result, 'note', s.note, 'done_by', private.ap4_user_name(s.done_by),
    'done_at', s.done_at, 'stopped_reason', s.stopped_reason, 'task_id', s.task_id, 'quote_total', q.grand_total, 'valid_until', q.valid_until, 'quote_status', q.status,
    'owner', private.ap4_user_name(q.created_by), 'overdue', s.status in ('pending', 'task_created') and s.due_date < private.ist_today(),
    'phone', (select coalesce(nullif(btrim(cu.whatsapp_number), ''), cu.phone) from public.customers cu where cu.id = q.customer_id),
    'message', private.ap5_followup_message(p_company, q))
  from public.quotes q where q.id = s.quote_id
$$;
revoke all on function private.ap5_followup_row(uuid, public.quote_followup_steps) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-072: floor conversion charges by alloy, finish and quantity band. A quotation with a line below its floor cannot
-- be approved for sending or sent until the owner (or an admin) other than the requester approves that exact set of
-- lines with a reason. Floors and the check are internal only.
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.price_floors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  alloy text check (alloy is null or alloy ~ '^[0-9A-Z]{3,8}$'),
  finishing_type text check (finishing_type is null or finishing_type ~ '^[a-z_]{3,40}$'),
  min_kg numeric(12,3) not null default 0 check (min_kg >= 0),
  max_kg numeric(12,3) check (max_kg is null or max_kg > min_kg),
  floor_per_kg numeric(10,2) not null check (floor_per_kg > 0 and floor_per_kg <= 10000),
  status text not null default 'active' check (status in ('active', 'retired')),
  reason text not null check (length(reason) between 5 and 300),
  set_by uuid not null references public.app_users(id),
  set_at timestamptz not null default clock_timestamp(),
  retired_by uuid references public.app_users(id),
  retired_at timestamptz,
  check ((status = 'retired') = (retired_at is not null))
);
create unique index if not exists price_floors_active on public.price_floors(company_id, coalesce(alloy, ''), coalesce(finishing_type, ''), min_kg) where status = 'active';
create index if not exists price_floors_company_idx on public.price_floors(company_id, status);
create index if not exists price_floors_people_idx on public.price_floors(set_by);
create index if not exists price_floors_retired_idx on public.price_floors(retired_by);

create table if not exists public.quote_floor_exceptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  quote_id uuid not null references public.quotes(id),
  revision_number integer not null,
  lines_fingerprint text not null check (lines_fingerprint ~ '^[0-9a-f]{32}$'),
  lines jsonb not null check (jsonb_typeof(lines) = 'array'),
  reason text not null check (length(reason) between 10 and 500),
  status text not null default 'requested' check (status in ('requested', 'approved', 'rejected', 'superseded')),
  requested_by uuid not null references public.app_users(id),
  requested_at timestamptz not null default clock_timestamp(),
  decided_by uuid references public.app_users(id),
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) between 3 and 300),
  check ((status in ('approved', 'rejected')) = (decided_by is not null and decided_at is not null)),
  check (decided_by is null or decided_by <> requested_by),
  check (status <> 'rejected' or decision_note is not null)
);
create unique index if not exists quote_floor_exceptions_open on public.quote_floor_exceptions(company_id, quote_id) where status = 'requested';
create index if not exists quote_floor_exceptions_company_idx on public.quote_floor_exceptions(company_id, status, requested_at desc);
create index if not exists quote_floor_exceptions_quote_idx on public.quote_floor_exceptions(quote_id);
create index if not exists quote_floor_exceptions_people_idx on public.quote_floor_exceptions(requested_by);
create index if not exists quote_floor_exceptions_decider_idx on public.quote_floor_exceptions(decided_by);

-- The floor for one line: alloy and finish beat alloy only, finish only and the general floor; the band must contain the line's kg.
create or replace function private.ap5_floor(p_company uuid, p_alloy text, p_finish text, p_kg numeric) returns public.price_floors
language sql stable security definer set search_path = public, private as $$
  select f.* from public.price_floors f where f.company_id = p_company and f.status = 'active'
    and (f.alloy is null or f.alloy = upper(btrim(coalesce(p_alloy, '')))) and (f.finishing_type is null or f.finishing_type = p_finish)
    and coalesce(p_kg, 0) >= f.min_kg and (f.max_kg is null or coalesce(p_kg, 0) < f.max_kg)
  order by (f.alloy is not null and f.finishing_type is not null) desc, (f.alloy is not null) desc, (f.finishing_type is not null) desc, f.min_kg desc limit 1 $$;
revoke all on function private.ap5_floor(uuid, text, text, numeric) from public, anon, authenticated;

-- Lines of a quotation checked against their floors. Only lines below the floor count toward the fingerprint.
create or replace function private.ap5_floor_check(p_company uuid, p_quote uuid) returns jsonb language sql stable security definer set search_path = public, private as $$
  with l as (select qi.id, ap.profile_code, upper(btrim(coalesce(ap.alloy, ''))) alloy, qi.finishing_type, coalesce(nullif(qi.effective_weight_kg, 0), nullif(qi.billing_weight_kg, 0), qi.total_weight_kg) kg,
      qi.conversion_charge_per_kg rate, (private.ap5_floor(p_company, ap.alloy, qi.finishing_type, coalesce(nullif(qi.effective_weight_kg, 0), nullif(qi.billing_weight_kg, 0), qi.total_weight_kg))) fl
    from public.quote_items qi left join public.aluminium_profiles ap on ap.id = qi.profile_id where qi.company_id = p_company and qi.quote_id = p_quote),
  r as (select l.*, (l.fl).floor_per_kg floor, (l.fl).id floor_id, (l.fl).floor_per_kg is not null and l.rate < (l.fl).floor_per_kg below from l)
  select jsonb_build_object('lines', coalesce((select jsonb_agg(jsonb_build_object('line_id', r.id, 'profile', r.profile_code, 'alloy', nullif(r.alloy, ''), 'finish', r.finishing_type, 'kg', round(r.kg, 3),
      'conversion_per_kg', r.rate, 'floor_per_kg', r.floor, 'floor_id', r.floor_id, 'below', r.below) order by r.profile_code, r.id) from r), '[]'::jsonb),
    'below', coalesce((select jsonb_agg(jsonb_build_object('line_id', r.id, 'rate', r.rate, 'floor', r.floor, 'kg', round(r.kg, 3)) order by r.id) from r where r.below), '[]'::jsonb),
    'fingerprint', md5(coalesce((select string_agg(r.id::text || ':' || r.rate::text || ':' || r.floor::text || ':' || round(r.kg, 3)::text, ',' order by r.id) from r where r.below), '')))
$$;
revoke all on function private.ap5_floor_check(uuid, uuid) from public, anon, authenticated;

create or replace function private.ap5_guard_price_floor() returns trigger language plpgsql security definer set search_path = public, private as $$
declare v jsonb; v_line jsonb;
begin
  if new.status is not distinct from old.status or new.status not in ('approved_for_sending', 'sent') then return new; end if;
  if old.status = 'approved_for_sending' and new.status = 'sent' and new.revision_number = old.revision_number
    and exists (select 1 from public.quote_floor_exceptions e where e.company_id = new.company_id and e.quote_id = new.id and e.status = 'approved' and e.revision_number = new.revision_number) then
    null; -- checked when it was approved for sending; the fingerprint is rechecked below anyway
  end if;
  if old.status = 'expired' and new.status = 'sent' then return new; end if; -- validity extension of an already-sent quotation
  v := private.ap5_floor_check(new.company_id, new.id);
  if jsonb_array_length(v -> 'below') = 0 then return new; end if;
  if exists (select 1 from public.quote_floor_exceptions e where e.company_id = new.company_id and e.quote_id = new.id and e.status = 'approved'
      and e.revision_number = new.revision_number and e.lines_fingerprint = v ->> 'fingerprint') then return new; end if;
  v_line := v -> 'below' -> 0;
  raise exception 'AP: % line(s) are below the floor price (for example ₹%/kg against a floor of ₹%/kg). Request a floor approval with a reason on the quotation; the owner approves it.',
    jsonb_array_length(v -> 'below'), v_line ->> 'rate', v_line ->> 'floor' using errcode = 'P0001';
end;
$$;
revoke all on function private.ap5_guard_price_floor() from public, anon, authenticated;
drop trigger if exists b_ap5_guard_price_floor on public.quotes;
create trigger b_ap5_guard_price_floor before update of status on public.quotes for each row execute function private.ap5_guard_price_floor();

-- ---------------------------------------------------------------------------------------------------------------
-- AP-001: the morning follow-up job (the registry keeps every earlier job unchanged).
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.ap_job_registry()
returns table(job_key text, schedule text, label text, description text)
language sql immutable set search_path = public, private as $$
  values
    ('proposals.refresh', 'hourly', 'Refresh open proposals', 'Marks proposals stale when their inputs changed and expired when their time passed.'),
    ('navigation.propose', 'nightly', 'Propose role navigation', 'After two weeks of visit counts, proposes the most used destinations for each role.'),
    ('series.propose', 'nightly', 'Propose financial-year numbering', 'Proposes a financial-year number series for each document type that has none.'),
    ('calendar.check', 'nightly', 'Check the factory calendar', 'Alerts the plant head when the coming months have no holidays or shutdowns entered.'),
    ('periods.propose_close', 'morning', 'Propose month close', 'Proposes closing the previous month once the close day is reached.'),
    ('press.idle_reconcile', 'nightly', 'Find unexplained press idle time', 'Records gaps between pushes that nobody explained, as unexplained (never with a guessed reason).'),
    ('dies.predict_service', 'hourly', 'Propose die service', 'Proposes nitriding or correction when a die reaches its approved interval.'),
    ('maintenance.propose_pm', 'hourly', 'Propose preventive maintenance', 'Proposes a maintenance window when a plan nears its running-hours or push interval.'),
    ('quality.sample_windows', 'hourly', 'Mark missed samples', 'Marks required quality samples as missed when their window has passed.'),
    ('quotes.expire', 'nightly', 'Expire stale quotations', 'Marks sent quotations expired when their validity ends, with history; sales can requote or extend.'),
    ('billing.prepare_drafts', 'hourly', 'Prepare invoice drafts', 'Prepares or refreshes an invoice draft for every dispatch that left the gate and is not invoiced.'),
    ('receivables.reminders', 'morning', 'Prepare payment reminders', 'Prepares the day''s reminder messages for invoices due soon or overdue; a person sends or skips each.'),
    ('alerts.reevaluate', 'hourly', 'Close cleared alerts', 'Re-checks condition-based alerts, tasks and credit holds and closes those whose condition cleared.'),
    ('bank.rematch', 'hourly', 'Rematch bank lines', 'Re-runs matching for unmatched bank credits after new invoices or learned remitters.'),
    ('quotes.followups', 'morning', 'Prepare quotation follow-ups', 'Schedules follow-ups for sent quotations, stops closed ones, and gives each quotation''s owner a task with a prepared message when one is due.')
$$;
revoke all on function private.ap_job_registry() from public, anon, authenticated;

create or replace function private.ap_job_execute(p_company uuid, p_job text, p_run uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
begin
  if p_job = 'quotes.followups' then
    return private.ap5_followups_job(p_company);
  end if;
  if p_job in ('quotes.expire', 'billing.prepare_drafts', 'receivables.reminders', 'alerts.reevaluate', 'bank.rematch') then
    return private.ap3_job_execute(p_company, p_job, p_run);
  end if;
  if p_job in ('press.idle_reconcile', 'dies.predict_service', 'maintenance.propose_pm', 'quality.sample_windows') then
    return private.ap2_job_execute(p_company, p_job, p_run);
  end if;
  return private.ap1_job_execute(p_company, p_job, p_run);
end;
$$;
revoke all on function private.ap_job_execute(uuid, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Client entry point: quotation follow-ups and floor prices (AP-071, AP-072).
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
      update public.quote_floor_exceptions set status = 'superseded' where id = e.id;
      raise exception 'AP: The quotation lines changed after the request. Sales must request again for the current lines.';
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

do $$
declare t text; r text;
begin
  foreach t in array array['quote_followup_settings', 'quote_followup_steps', 'price_floors', 'quote_floor_exceptions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('drop policy if exists %I on public.%I', 'ap5 company read', t);
    r := 'array[''owner'',''admin'',''sales_manager'',''sales'']';
    execute format('create policy %I on public.%I for select to authenticated using (company_id = (select public.get_current_user_company_id()) and (select public.get_current_user_role()) = any(%s))',
      'ap5 company read', t, r);
  end loop;
end $$;


-- AP-026: the loading session row also carries the customer id, so the loading screen can offer the usual transporter.
create or replace function private.ap4_session_row(p_company uuid, s public.loading_sessions, p_full boolean) returns jsonb language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('id', s.id, 'order_id', s.order_id, 'order_number', o.order_number, 'customer', private.ap3_customer_name(o.customer_id), 'customer_id', o.customer_id,
    'destination', nullif(btrim(c.city), ''), 'status', s.status, 'vehicle_number', s.vehicle_number, 'transporter_name', s.transporter_name, 'transporter_id', s.transporter_id,
    'driver_name', s.driver_name, 'driver_phone', s.driver_phone, 'lr_number', s.lr_number, 'started_at', s.started_at, 'started_by', private.ap4_user_name(s.started_by),
    'completed_at', s.completed_at, 'dispatch_id', s.dispatch_id, 'dispatch_number', (select d.dispatch_number from public.dispatches d where d.id = s.dispatch_id),
    'cancel_reason', s.cancel_reason, 'credit', private.ap4_credit_state(p_company, s.order_id), 'expected_dispatch_date', o.expected_dispatch_date)
  || case when p_full then jsonb_build_object('plan', private.ap4_session_plan(p_company, s),
    'scans', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'tag', x.raw_tag, 'bundle_id', x.bundle_id, 'outcome', x.outcome, 'warnings', to_jsonb(x.warnings), 'message', x.message,
      'confirm_note', x.confirm_note, 'net_kg', x.net_kg, 'pieces', x.pieces, 'scanned_at', x.scanned_at, 'scanned_by', private.ap4_user_name(x.scanned_by),
      'removed_at', x.removed_at, 'remove_reason', x.remove_reason) order by x.scanned_at desc)
      from (select * from public.loading_scans y where y.company_id = p_company and y.session_id = s.id order by y.scanned_at desc limit 60) x), '[]'::jsonb),
    'ready_here', (select count(*) from public.prepared_physical_bundles b where b.company_id = p_company and b.order_id = s.order_id and b.dispatch_id is null
      and not exists (select 1 from public.loading_scans y where y.company_id = p_company and y.bundle_id = b.id and y.outcome = 'loaded' and y.removed_at is null)))
    else '{}'::jsonb end
  from public.orders o join public.customers c on c.id = o.customer_id where o.id = s.order_id
$$;
revoke all on function private.ap4_session_row(uuid, public.loading_sessions, boolean) from public, anon, authenticated;

commit;

-- Autopilot batch 10: AP-055, 067, 088, 022, 023, 093, 021, 049, 068 and 070 (the last ten entries).
-- Additive. Depends on batches 1-9. AP-088 (arithmetic in numeric fields) and AP-023 (dictation) are screen and library
-- changes and need no schema. Nothing here posts stock, money, quality approval or a customer message: meter readings and
-- crew sign-ins are records, energy allocation and crew output are read models, equivalents, stock runs, coating runs and
-- combined cut patterns are proposals a person confirms, and a configurator project becomes an order only through the
-- normal order entry.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------------------------------------------
-- The IST window of a press shift on a day: the configured shift of that name, else the whole IST day.
create or replace function private.ap10_shift_window(p_company uuid, p_machine uuid, p_day date, p_shift text)
returns tstzrange language sql stable security definer set search_path = public, private as $$
  select coalesce(
    (select tstzrange((p_day + s.starts_local) at time zone 'Asia/Kolkata',
        ((p_day + case when s.ends_local <= s.starts_local then 1 else 0 end) + s.ends_local) at time zone 'Asia/Kolkata')
      from public.factory_shift_capacities s
      where s.company_id = p_company and s.machine_id = p_machine and s.weekday = extract(isodow from p_day) and lower(s.shift_name) = lower(p_shift) limit 1),
    tstzrange(p_day::timestamp at time zone 'Asia/Kolkata', (p_day + 1)::timestamp at time zone 'Asia/Kolkata'))
$$;
revoke all on function private.ap10_shift_window(uuid, uuid, date, text) from public, anon, authenticated;

create or replace function private.ap10_day(p_payload jsonb, p_key text, p_label text, p_required boolean default true)
returns date language plpgsql immutable set search_path = public, private as $$
declare v text := nullif(btrim(coalesce(p_payload ->> p_key, '')), '');
begin
  if v is null then
    if p_required then raise exception 'AP: % is required.', p_label; end if;
    return null;
  end if;
  if v !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'AP: % must be a date.', p_label; end if;
  begin return v::date; exception when others then raise exception 'AP: % must be a date.', p_label; end;
end;
$$;
revoke all on function private.ap10_day(jsonb, text, text, boolean) from public, anon, authenticated;

-- Free released stock of a profile at the factory: pieces and kg the reservation ledger still shows as available.
create or replace function private.ap10_profile_free(p_company uuid, p_profile uuid)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object(
    'pieces', coalesce(sum(q.pieces), 0), 'kg', coalesce(round(sum(q.kg), 3), 0),
    'lots', coalesce(jsonb_agg(jsonb_build_object('finish', q.finish, 'piece_length_m', q.piece_length_m, 'pieces', q.pieces, 'kg', round(q.kg, 3)) order by q.piece_length_m, q.finish)
      filter (where q.pieces > 0), '[]'))
  from (
    select coalesce(b.finish, 'mill_finish') finish, b.piece_length_m, sum(x.free) pieces,
      sum(x.free * coalesce(b.total_weight_kg / nullif(b.quantity_pieces, 0), 0)) kg
    from public.profile_stock_batches b
      cross join lateral (select floor(coalesce((private.profile_stock_balance(p_company, b.id) #>> '{available,pieces}')::numeric, 0)) free) x
    where b.company_id = p_company and b.profile_id = p_profile and b.dealer_id is null and b.status = 'available' and b.qc_status in ('released', 'not_required')
    group by 1, 2 having sum(x.free) > 0) q
$$;
revoke all on function private.ap10_profile_free(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-021: press meter readings per shift and energy allocated to jobs by their runtime (push events)
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.press_meter_readings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  machine_id uuid not null references public.machines(id),
  shift_day date not null,
  shift_name text not null check (length(btrim(shift_name)) between 1 and 40 and shift_name !~ '[[:cntrl:]]'),
  opening_kwh numeric(14,2) not null check (opening_kwh >= 0),
  closing_kwh numeric(14,2) check (closing_kwh is null or closing_kwh >= 0),
  window_start timestamptz not null,
  window_end timestamptz not null,
  source text not null default 'typed' check (source in ('typed', 'device')),
  note text check (note is null or (length(btrim(note)) between 3 and 300 and note !~ '[[:cntrl:]]')),
  opened_by uuid not null references public.app_users(id),
  opened_at timestamptz not null default clock_timestamp(),
  closed_by uuid references public.app_users(id),
  closed_at timestamptz,
  corrected_by uuid references public.app_users(id),
  corrected_at timestamptz,
  check (closing_kwh is null or closing_kwh >= opening_kwh),
  check ((closing_kwh is null) = (closed_at is null)),
  check (window_end > window_start),
  unique (company_id, machine_id, shift_day, shift_name)
);
create index if not exists press_meter_readings_company_idx on public.press_meter_readings(company_id, shift_day desc, machine_id);
create index if not exists press_meter_readings_machine_idx on public.press_meter_readings(machine_id);

-- One row per reading and job that pressed in its window. Runtime of a job = the time from each of its pushes to the next
-- push on the press (capped at 20 minutes, so a stoppage is not charged to the job); the reading's kWh is shared by runtime.
-- A reading without a closing value, or with no pushes in its window, gives no rows (blank, never zero).
create or replace function private.ap10_energy_alloc(p_company uuid, p_from date, p_to date)
returns table(reading_id uuid, machine_id uuid, shift_day date, shift_name text, reading_kwh numeric, job_id uuid, die_id uuid, pushes integer,
  billet_kg numeric, estimated_pushes integer, unweighed_pushes integer, runtime_s numeric, alloc_kwh numeric)
language sql stable security definer set search_path = public, private as $$
  with rd as (
    select r.id, r.machine_id, r.shift_day, r.shift_name, r.window_start, r.window_end, r.closing_kwh - r.opening_kwh kwh
    from public.press_meter_readings r
    where r.company_id = p_company and r.shift_day between p_from and p_to and r.closing_kwh is not null),
  pe as (
    select rd.id rid, e.production_job_id job, e.die_id, e.event_at, e.billet_kg, e.billet_kg_basis,
      lead(e.event_at) over (partition by rd.id order by e.event_at, e.seq) next_at
    from rd join public.production_push_events e on e.company_id = p_company and e.machine_id = rd.machine_id and e.kind = 'push'
      and e.event_at >= rd.window_start and e.event_at < rd.window_end
      and not exists (select 1 from public.production_push_events v where v.voids_event_id = e.id and v.company_id = p_company)),
  -- least() ignores nulls, so the last push of a shift (no next push) is kept null here and takes the shift's mean gap below.
  iv as (select pe.*, case when pe.next_at is not null then least(extract(epoch from pe.next_at - pe.event_at), 1200) end gap from pe),
  av as (select iv.rid, avg(iv.gap) filter (where iv.gap is not null) mean_gap from iv group by 1),
  per as (
    select iv.rid, iv.job, (array_agg(iv.die_id order by iv.event_at) filter (where iv.die_id is not null))[1] die, count(*)::integer pushes,
      sum(iv.billet_kg) billet_kg, count(*) filter (where iv.billet_kg_basis = 'estimated')::integer est, count(*) filter (where iv.billet_kg is null)::integer unweighed,
      sum(coalesce(iv.gap, av.mean_gap, 300)) runtime
    from iv join av on av.rid = iv.rid group by 1, 2)
  select rd.id, rd.machine_id, rd.shift_day, rd.shift_name, rd.kwh, per.job, per.die, per.pushes, per.billet_kg, per.est, per.unweighed, round(per.runtime, 0),
    round(rd.kwh * per.runtime / nullif(sum(per.runtime) over (partition by rd.id), 0), 2)
  from rd join per on per.rid = rd.id
$$;
revoke all on function private.ap10_energy_alloc(uuid, date, date) from public, anon, authenticated;

create or replace function public.ap_energy(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_day date; v_machine uuid; v_shift text; v_open numeric; v_close numeric; v_win tstzrange; rd public.press_meter_readings%rowtype;
  v_from date; v_to date; v_rows jsonb; v_job uuid; v_total bigint; v_page integer := private.ap3_page(p_payload);
  v_manage text[] := array['owner', 'admin', 'factory_manager', 'production_manager'];
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'factory_manager', 'production_manager', 'production', 'accounts']);
  if p_command = 'shifts' then
    perform private.ap_keys(p_payload, array['day']);
    v_day := coalesce(private.ap10_day(p_payload, 'day', 'Day', false), private.ist_today());
    if v_day > private.ist_today() then raise exception 'AP: Readings are entered for today or an earlier day.'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('machine_id', m.id, 'machine_name', m.machine_name, 'shift_name', sh.shift_name, 'configured', sh.configured,
        'starts_local', sh.starts_local, 'ends_local', sh.ends_local,
        'reading', (select jsonb_build_object('id', r.id, 'opening_kwh', r.opening_kwh, 'closing_kwh', r.closing_kwh, 'kwh', r.closing_kwh - r.opening_kwh, 'source', r.source, 'note', r.note,
            'opened_by', (select full_name from public.app_users where id = r.opened_by), 'closed_by', (select full_name from public.app_users where id = r.closed_by), 'closed_at', r.closed_at)
          from public.press_meter_readings r where r.company_id = c.company_id and r.machine_id = m.id and r.shift_day = v_day and lower(r.shift_name) = lower(sh.shift_name)),
        -- The last closing reading before this shift is the natural opening value; the person confirms it.
        'previous_closing', (select jsonb_build_object('kwh', r.closing_kwh, 'shift_day', r.shift_day, 'shift_name', r.shift_name) from public.press_meter_readings r
          where r.company_id = c.company_id and r.machine_id = m.id and r.closing_kwh is not null
            and r.window_start < lower(private.ap10_shift_window(c.company_id, m.id, v_day, sh.shift_name)) order by r.window_start desc limit 1))
      order by m.machine_name, sh.starts_local nulls first, sh.shift_name), '[]') into v_rows
    from public.machines m
      cross join lateral (
        select s.shift_name, true configured, s.starts_local, s.ends_local from public.factory_shift_capacities s
          where s.company_id = c.company_id and s.machine_id = m.id and s.weekday = extract(isodow from v_day)
        union all
        select 'Day', false, null::time, null::time where not exists (select 1 from public.factory_shift_capacities s2
          where s2.company_id = c.company_id and s2.machine_id = m.id and s2.weekday = extract(isodow from v_day))) sh
    where m.company_id = c.company_id and m.machine_type = 'extrusion_press' and m.is_active;
    return jsonb_build_object('day', v_day, 'today', private.ist_today(), 'rows', v_rows, 'can_correct', c.role = any(v_manage));
  elsif p_command = 'save' then
    perform private.ap4_need(c.role, array['owner', 'admin', 'factory_manager', 'production_manager', 'production']);
    perform private.ap_keys(p_payload, array['machine_id', 'shift_day', 'shift_name', 'opening_kwh', 'closing_kwh', 'note']);
    v_machine := private.ap_uuid(p_payload, 'machine_id');
    v_day := private.ap10_day(p_payload, 'shift_day', 'Shift day');
    v_shift := private.ap_text(p_payload ->> 'shift_name', 'Shift', 1, 40);
    if v_day > private.ist_today() or v_day < private.ist_today() - 45 then raise exception 'AP: Readings are entered for the last 45 days.'; end if;
    if not exists (select 1 from public.machines where id = v_machine and company_id = c.company_id and machine_type = 'extrusion_press') then raise exception 'AP: Press not found.'; end if;
    v_open := private.ap4_num(p_payload, 'opening_kwh', 'Opening reading', 0, 999999999, false);
    v_close := private.ap4_num(p_payload, 'closing_kwh', 'Closing reading', 0, 999999999, false);
    perform pg_advisory_xact_lock(hashtextextended(c.company_id::text || ':ap10-meter:' || v_machine::text || ':' || v_day::text || ':' || lower(v_shift), 0));
    select * into rd from public.press_meter_readings where company_id = c.company_id and machine_id = v_machine and shift_day = v_day and lower(shift_name) = lower(v_shift);
    if rd.id is null then
      if v_open is null then raise exception 'AP: Enter the opening reading.'; end if;
      if v_close is not null and v_close < v_open then raise exception 'AP: The closing reading cannot be below the opening reading.'; end if;
      v_win := private.ap10_shift_window(c.company_id, v_machine, v_day, v_shift);
      insert into public.press_meter_readings(company_id, machine_id, shift_day, shift_name, opening_kwh, closing_kwh, window_start, window_end, note, opened_by, closed_by, closed_at)
        values (c.company_id, v_machine, v_day, v_shift, v_open, v_close, lower(v_win), upper(v_win), private.ap_text(p_payload ->> 'note', 'Note', 3, 300, false), c.actor_id,
          case when v_close is not null then c.actor_id end, case when v_close is not null then clock_timestamp() end)
        returning * into rd;
    else
      -- A closed reading is a record: only a manager corrects it, and the correction is marked.
      if rd.closing_kwh is not null and not (c.role = any(v_manage)) then raise exception 'AP: This reading is closed. Ask a production manager to correct it.'; end if;
      v_open := coalesce(v_open, rd.opening_kwh); v_close := coalesce(v_close, rd.closing_kwh);
      if v_close is not null and v_close < v_open then raise exception 'AP: The closing reading cannot be below the opening reading.'; end if;
      if v_open is distinct from rd.opening_kwh and rd.opened_by <> c.actor_id and not (c.role = any(v_manage)) then raise exception 'AP: Only the person who entered the opening reading or a manager can change it.'; end if;
      update public.press_meter_readings set opening_kwh = v_open, closing_kwh = v_close,
          note = coalesce(private.ap_text(p_payload ->> 'note', 'Note', 3, 300, false), note),
          closed_by = case when v_close is null then null when rd.closing_kwh is null then c.actor_id else closed_by end,
          closed_at = case when v_close is null then null when rd.closing_kwh is null then clock_timestamp() else closed_at end,
          corrected_by = case when rd.closing_kwh is not null then c.actor_id else corrected_by end,
          corrected_at = case when rd.closing_kwh is not null then clock_timestamp() else corrected_at end
        where id = rd.id returning * into rd;
    end if;
    return jsonb_build_object('id', rd.id, 'opening_kwh', rd.opening_kwh, 'closing_kwh', rd.closing_kwh, 'kwh', rd.closing_kwh - rd.opening_kwh);
  elsif p_command = 'allocation' then
    perform private.ap_keys(p_payload, array['day']);
    v_day := coalesce(private.ap10_day(p_payload, 'day', 'Day', false), private.ist_today());
    return jsonb_build_object('day', v_day,
      'readings', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'machine_name', m.machine_name, 'shift_name', r.shift_name, 'opening_kwh', r.opening_kwh, 'closing_kwh', r.closing_kwh,
          'kwh', r.closing_kwh - r.opening_kwh,
          'jobs', coalesce((select jsonb_agg(jsonb_build_object('job_id', a.job_id, 'job_number', j.job_number, 'die_number', d.die_number, 'profile_code', p.profile_code, 'pushes', a.pushes,
              'billet_kg', a.billet_kg, 'estimated_pushes', a.estimated_pushes, 'unweighed_pushes', a.unweighed_pushes, 'runtime_min', round(a.runtime_s / 60, 1), 'kwh', a.alloc_kwh,
              'kwh_per_kg', case when a.billet_kg > 0 and a.unweighed_pushes = 0 then round(a.alloc_kwh / a.billet_kg, 3) end) order by a.alloc_kwh desc)
            from private.ap10_energy_alloc(c.company_id, v_day, v_day) a join public.production_jobs j on j.id = a.job_id
              left join public.dies d on d.id = a.die_id left join public.aluminium_profiles p on p.id = j.profile_id
            where a.reading_id = r.id), '[]')) order by m.machine_name, r.window_start), '[]')
        from public.press_meter_readings r join public.machines m on m.id = r.machine_id where r.company_id = c.company_id and r.shift_day = v_day),
      'basis', 'kWh of each closed reading is shared between the jobs that pressed in that shift by their running time (push to next push, stoppages over 20 minutes excluded). kWh per kg uses the billet kilograms pressed.');
  elsif p_command = 'monthly' then
    perform private.ap_keys(p_payload, array['month']);
    if p_payload ? 'month' and (p_payload ->> 'month') !~ '^\d{4}-\d{2}$' then raise exception 'AP: Choose a month.'; end if;
    v_from := coalesce(((p_payload ->> 'month') || '-01')::date, date_trunc('month', private.ist_today())::date);
    v_to := least((v_from + interval '1 month - 1 day')::date, private.ist_today());
    return jsonb_build_object('month', to_char(v_from, 'YYYY-MM'), 'from', v_from, 'to', v_to,
      'presses', (select coalesce(jsonb_agg(jsonb_build_object('machine_id', m.id, 'machine_name', m.machine_name,
          'readings_closed', coalesce(x.closed, 0), 'readings_open', coalesce(x.open, 0), 'kwh', x.kwh, 'allocated_kwh', y.kwh, 'billet_kg', y.kg, 'pushes', coalesce(y.pushes, 0),
          'unweighed_pushes', coalesce(y.unweighed, 0),
          -- kWh per kg only from actual readings and weighed billets: no reading, no figure.
          'kwh_per_kg', case when y.kg > 0 then round(y.kwh / y.kg, 3) end) order by m.machine_name), '[]')
        from public.machines m
          left join lateral (select count(*) filter (where r.closing_kwh is not null) closed, count(*) filter (where r.closing_kwh is null) open, sum(r.closing_kwh - r.opening_kwh) kwh
            from public.press_meter_readings r where r.company_id = c.company_id and r.machine_id = m.id and r.shift_day between v_from and v_to) x on true
          left join lateral (select sum(a.alloc_kwh) kwh, sum(a.billet_kg) kg, sum(a.pushes) pushes, sum(a.unweighed_pushes) unweighed
            from private.ap10_energy_alloc(c.company_id, v_from, v_to) a where a.machine_id = m.id) y on true
        where m.company_id = c.company_id and m.machine_type = 'extrusion_press' and m.is_active),
      'dies', (select coalesce(jsonb_agg(to_jsonb(q) order by q.kwh desc), '[]') from (
        select d.id die_id, d.die_number, sum(a.alloc_kwh) kwh, sum(a.billet_kg) billet_kg, case when sum(a.billet_kg) > 0 then round(sum(a.alloc_kwh) / sum(a.billet_kg), 3) end kwh_per_kg
          from private.ap10_energy_alloc(c.company_id, v_from, v_to) a join public.dies d on d.id = a.die_id group by d.id, d.die_number order by 3 desc limit 20) q));
  elsif p_command = 'job' then
    perform private.ap_keys(p_payload, array['job_id']);
    v_job := private.ap_uuid(p_payload, 'job_id');
    if not exists (select 1 from public.production_jobs where id = v_job and company_id = c.company_id) then raise exception 'AP: Production job not found.'; end if;
    select min(e.event_at at time zone 'Asia/Kolkata')::date, max(e.event_at at time zone 'Asia/Kolkata')::date into v_from, v_to
      from public.production_push_events e where e.company_id = c.company_id and e.production_job_id = v_job and e.kind = 'push';
    if v_from is null then return jsonb_build_object('job_id', v_job, 'shifts', '[]'::jsonb, 'kwh', null, 'billet_kg', null, 'kwh_per_kg', null); end if;
    select coalesce(jsonb_agg(jsonb_build_object('shift_day', a.shift_day, 'shift_name', a.shift_name, 'machine_name', (select machine_name from public.machines where id = a.machine_id),
        'kwh', a.alloc_kwh, 'billet_kg', a.billet_kg, 'pushes', a.pushes, 'runtime_min', round(a.runtime_s / 60, 1)) order by a.shift_day, a.shift_name), '[]'),
      sum(a.alloc_kwh), sum(a.billet_kg) into v_rows, v_open, v_close
      from private.ap10_energy_alloc(c.company_id, v_from - 1, v_to) a where a.job_id = v_job;
    return jsonb_build_object('job_id', v_job, 'shifts', v_rows, 'kwh', v_open, 'billet_kg', v_close, 'kwh_per_kg', case when v_close > 0 then round(v_open / v_close, 3) end,
      -- Shifts in which the job pressed but no closed reading exists: their energy is unknown, not zero.
      'shifts_without_reading', (select count(distinct (e.event_at at time zone 'Asia/Kolkata')::date) from public.production_push_events e
        where e.company_id = c.company_id and e.production_job_id = v_job and e.kind = 'push'
          and not exists (select 1 from public.press_meter_readings r where r.company_id = c.company_id and r.machine_id = e.machine_id and r.closing_kwh is not null
            and e.event_at >= r.window_start and e.event_at < r.window_end)));
  elsif p_command = 'list' then
    perform private.ap_keys(p_payload, array['page', 'machine_id', 'state']);
    with f as (select r.*, row_number() over (order by r.shift_day desc, r.window_start desc, r.id) k from public.press_meter_readings r
      where r.company_id = c.company_id and (nullif(p_payload ->> 'machine_id', '') is null or r.machine_id = (p_payload ->> 'machine_id')::uuid)
        and (coalesce(p_payload ->> 'state', 'all') = 'all' or (p_payload ->> 'state' = 'open' and r.closing_kwh is null) or (p_payload ->> 'state' = 'closed' and r.closing_kwh is not null)))
    select coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'machine_name', (select machine_name from public.machines where id = f.machine_id), 'shift_day', f.shift_day,
        'shift_name', f.shift_name, 'opening_kwh', f.opening_kwh, 'closing_kwh', f.closing_kwh, 'kwh', f.closing_kwh - f.opening_kwh, 'corrected', f.corrected_at is not null,
        'opened_by', (select full_name from public.app_users where id = f.opened_by)) order by f.k) from f where f.k > (v_page - 1) * 10 and f.k <= v_page * 10), '[]'),
      (select count(*) from f) into v_rows, v_total;
    return jsonb_build_object('rows', v_rows, 'page', v_page, 'total_count', v_total);
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_energy(text, jsonb) from public, anon;
grant execute on function public.ap_energy(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-022: press assignment from station sign-ins (not payroll attendance)
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.press_crew_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  machine_id uuid not null references public.machines(id),
  user_id uuid not null references public.app_users(id),
  crew_role text not null check (crew_role in ('operator', 'helper', 'puller', 'stretcher', 'saw', 'supervisor')),
  method text not null check (method in ('self', 'supervisor')),
  signed_in_by uuid not null references public.app_users(id),
  signed_in_at timestamptz not null default clock_timestamp(),
  signed_out_at timestamptz,
  signed_out_by uuid references public.app_users(id),
  sign_out_reason text check (sign_out_reason in ('self', 'supervisor', 'moved', 'auto_shift_end')),
  check (signed_out_at is null or signed_out_at > signed_in_at),
  check ((signed_out_at is null) = (sign_out_reason is null))
);
create unique index if not exists press_crew_sessions_one_open on public.press_crew_sessions(company_id, user_id) where signed_out_at is null;
create index if not exists press_crew_sessions_machine_idx on public.press_crew_sessions(company_id, machine_id, signed_in_at desc);
create index if not exists press_crew_sessions_user_idx on public.press_crew_sessions(user_id);

-- A sign-in nobody ended counts for at most 14 hours (one long shift); after that it is treated as ended.
create or replace function private.ap10_crew_end(s public.press_crew_sessions)
returns timestamptz language sql stable set search_path = public, private as $$
  select coalesce(s.signed_out_at, least(clock_timestamp(), s.signed_in_at + interval '14 hours'))
$$;
revoke all on function private.ap10_crew_end(public.press_crew_sessions) from public, anon, authenticated;

-- Whether a person holds the competency the plant requires to start production (none required = no flag).
create or replace function private.ap10_crew_competent(p_company uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public, private as $$
  select case when not exists (select 1 from public.competency_requirements q where q.company_id = p_company and q.action = 'production_start') then null
    else exists (select 1 from public.competency_requirements q join public.employee_competencies e on e.company_id = q.company_id and e.competency_id = q.competency_id
      where q.company_id = p_company and q.action = 'production_start' and e.employee_id = p_user and e.revoked_at is null and (e.expires_at is null or e.expires_at > now())) end
$$;
revoke all on function private.ap10_crew_competent(uuid, uuid) from public, anon, authenticated;

create or replace function private.ap10_crew_close_stale(p_company uuid, p_user uuid)
returns void language sql security definer set search_path = public, private as $$
  update public.press_crew_sessions set signed_out_at = signed_in_at + interval '14 hours', sign_out_reason = 'auto_shift_end'
    where company_id = p_company and user_id = p_user and signed_out_at is null and signed_in_at < clock_timestamp() - interval '14 hours'
$$;
revoke all on function private.ap10_crew_close_stale(uuid, uuid) from public, anon, authenticated;

create or replace function public.ap_crew(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_machine uuid; v_user uuid; v_role text; s public.press_crew_sessions%rowtype; v_day date; v_rows jsonb; v_job uuid; v_from timestamptz; v_to timestamptz;
  v_search text := lower(btrim(coalesce(p_payload ->> 'search', ''))); v_lead text[] := array['owner', 'admin', 'factory_manager', 'production_manager'];
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'factory_manager', 'production_manager', 'production', 'quality']);
  if p_command = 'station' then
    perform private.ap_keys(p_payload, array['machine_id']);
    v_machine := private.ap_uuid(p_payload, 'machine_id');
    if not exists (select 1 from public.machines where id = v_machine and company_id = c.company_id) then raise exception 'AP: Press not found.'; end if;
    return jsonb_build_object('machine_id', v_machine, 'can_lead', c.role = any(v_lead),
      'mine', (select jsonb_build_object('id', x.id, 'machine_id', x.machine_id, 'machine_name', (select machine_name from public.machines where id = x.machine_id), 'crew_role', x.crew_role, 'signed_in_at', x.signed_in_at)
        from public.press_crew_sessions x where x.company_id = c.company_id and x.user_id = c.actor_id and x.signed_out_at is null and x.signed_in_at >= clock_timestamp() - interval '14 hours'),
      'crew', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'user_id', x.user_id, 'name', coalesce(u.full_name, 'Employee'), 'crew_role', x.crew_role, 'method', x.method,
          'signed_in_at', x.signed_in_at, 'competent', private.ap10_crew_competent(c.company_id, x.user_id)) order by x.signed_in_at), '[]')
        from public.press_crew_sessions x join public.app_users u on u.id = x.user_id
        where x.company_id = c.company_id and x.machine_id = v_machine and x.signed_out_at is null and x.signed_in_at >= clock_timestamp() - interval '14 hours'),
      'competency_required', exists (select 1 from public.competency_requirements q where q.company_id = c.company_id and q.action = 'production_start'));
  elsif p_command in ('sign_in', 'add') then
    perform private.ap_keys(p_payload, case when p_command = 'add' then array['machine_id', 'user_id', 'crew_role'] else array['machine_id', 'crew_role'] end);
    v_machine := private.ap_uuid(p_payload, 'machine_id');
    v_role := coalesce(p_payload ->> 'crew_role', 'operator');
    if v_role not in ('operator', 'helper', 'puller', 'stretcher', 'saw', 'supervisor') then raise exception 'AP: Choose the work on the press.'; end if;
    if not exists (select 1 from public.machines where id = v_machine and company_id = c.company_id and machine_type = 'extrusion_press' and is_active) then raise exception 'AP: Press not found.'; end if;
    if p_command = 'add' then
      perform private.ap4_need(c.role, v_lead);
      v_user := private.ap_uuid(p_payload, 'user_id');
      if not exists (select 1 from public.app_users where id = v_user and company_id = c.company_id and is_active and dealer_id is null) then raise exception 'AP: Employee not found.'; end if;
    else
      v_user := c.actor_id;
    end if;
    perform pg_advisory_xact_lock(hashtextextended(c.company_id::text || ':ap10-crew:' || v_user::text, 0));
    perform private.ap10_crew_close_stale(c.company_id, v_user);
    select * into s from public.press_crew_sessions where company_id = c.company_id and user_id = v_user and signed_out_at is null;
    if s.id is not null and s.machine_id = v_machine and s.crew_role = v_role then
      return jsonb_build_object('id', s.id, 'state', 'already_signed_in');
    end if;
    if s.id is not null then
      -- One press at a time: signing in elsewhere ends the earlier assignment at this moment.
      update public.press_crew_sessions set signed_out_at = clock_timestamp(), signed_out_by = c.actor_id, sign_out_reason = 'moved' where id = s.id;
    end if;
    insert into public.press_crew_sessions(company_id, machine_id, user_id, crew_role, method, signed_in_by)
      values (c.company_id, v_machine, v_user, v_role, case when p_command = 'add' then 'supervisor' else 'self' end, c.actor_id) returning * into s;
    return jsonb_build_object('id', s.id, 'state', 'signed_in', 'competent', private.ap10_crew_competent(c.company_id, v_user));
  elsif p_command = 'sign_out' then
    perform private.ap_keys(p_payload, array['id']);
    if p_payload ? 'id' then
      select * into s from public.press_crew_sessions where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id and signed_out_at is null for update;
    else
      select * into s from public.press_crew_sessions where company_id = c.company_id and user_id = c.actor_id and signed_out_at is null for update;
    end if;
    if s.id is null then raise exception 'AP: No open press sign-in found.'; end if;
    if s.user_id <> c.actor_id and not (c.role = any(v_lead)) then raise exception 'Not permitted' using errcode = '42501'; end if;
    update public.press_crew_sessions set signed_out_at = least(clock_timestamp(), signed_in_at + interval '14 hours'), signed_out_by = c.actor_id,
      sign_out_reason = case when s.signed_in_at < clock_timestamp() - interval '14 hours' then 'auto_shift_end' when s.user_id = c.actor_id then 'self' else 'supervisor' end where id = s.id;
    return jsonb_build_object('id', s.id, 'state', 'signed_out');
  elsif p_command = 'people' then
    perform private.ap4_need(c.role, v_lead);
    perform private.ap_keys(p_payload, array['search']);
    return jsonb_build_object('rows', (select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'name', q.full_name, 'role', q.role, 'on_press', q.on_press) order by q.full_name), '[]') from (
      select u.id, coalesce(u.full_name, u.email, 'Employee') full_name, u.role,
        (select m.machine_name from public.press_crew_sessions x join public.machines m on m.id = x.machine_id
          where x.company_id = c.company_id and x.user_id = u.id and x.signed_out_at is null and x.signed_in_at >= clock_timestamp() - interval '14 hours') on_press
      from public.app_users u where u.company_id = c.company_id and u.is_active and u.dealer_id is null and u.role in ('production', 'production_manager', 'factory_manager', 'quality')
        and (v_search = '' or lower(coalesce(u.full_name, '') || ' ' || coalesce(u.email, '')) like '%' || v_search || '%')
      order by 2 limit 20) q));
  elsif p_command = 'shift' then
    perform private.ap_keys(p_payload, array['day']);
    v_day := coalesce(private.ap10_day(p_payload, 'day', 'Day', false), private.ist_today());
    select coalesce(jsonb_agg(jsonb_build_object('machine_id', m.id, 'machine_name', m.machine_name, 'shift_name', sh.shift_name,
        'window_start', lower(sh.win), 'window_end', upper(sh.win),
        'crew', (select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'name', coalesce(u.full_name, 'Employee'), 'crew_role', x.crew_role, 'method', x.method,
            'minutes', round(extract(epoch from least(private.ap10_crew_end(x), upper(sh.win)) - greatest(x.signed_in_at, lower(sh.win))) / 60),
            'competent', private.ap10_crew_competent(c.company_id, x.user_id)) order by x.signed_in_at), '[]')
          from public.press_crew_sessions x join public.app_users u on u.id = x.user_id
          where x.company_id = c.company_id and x.machine_id = m.id and x.signed_in_at < upper(sh.win) and private.ap10_crew_end(x) > lower(sh.win)),
        'pushes', o.pushes, 'billet_kg', o.billet_kg, 'jobs', o.jobs)
      order by m.machine_name, lower(sh.win)), '[]') into v_rows
    from public.machines m
      cross join lateral (
        select s2.shift_name, private.ap10_shift_window(c.company_id, m.id, v_day, s2.shift_name) win from public.factory_shift_capacities s2
          where s2.company_id = c.company_id and s2.machine_id = m.id and s2.weekday = extract(isodow from v_day)
        union all
        select 'Day', private.ap10_shift_window(c.company_id, m.id, v_day, 'Day') where not exists (select 1 from public.factory_shift_capacities s3
          where s3.company_id = c.company_id and s3.machine_id = m.id and s3.weekday = extract(isodow from v_day))) sh
      cross join lateral (
        select count(*)::integer pushes, sum(e.billet_kg) billet_kg,
          coalesce(jsonb_agg(distinct jsonb_build_object('job_id', e.production_job_id, 'job_number', (select job_number from public.production_jobs where id = e.production_job_id))), '[]') jobs
        from public.production_push_events e where e.company_id = c.company_id and e.machine_id = m.id and e.kind = 'push' and e.event_at >= lower(sh.win) and e.event_at < upper(sh.win)
          and not exists (select 1 from public.production_push_events v where v.voids_event_id = e.id and v.company_id = c.company_id)) o
    where m.company_id = c.company_id and m.machine_type = 'extrusion_press' and m.is_active;
    return jsonb_build_object('day', v_day, 'rows', v_rows, 'label', 'Press assignment from station sign-ins. This is not an attendance or payroll record.');
  elsif p_command = 'job' then
    perform private.ap_keys(p_payload, array['job_id']);
    v_job := private.ap_uuid(p_payload, 'job_id');
    select j.machine_id into v_machine from public.production_jobs j where j.id = v_job and j.company_id = c.company_id;
    if not found then raise exception 'AP: Production job not found.'; end if;
    select min(e.event_at), max(e.event_at) into v_from, v_to from public.production_push_events e where e.company_id = c.company_id and e.production_job_id = v_job and e.kind = 'push';
    if v_from is null then return jsonb_build_object('job_id', v_job, 'crew', '[]'::jsonb, 'from', null, 'to', null); end if;
    return jsonb_build_object('job_id', v_job, 'from', v_from, 'to', v_to,
      'crew', (select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'name', coalesce(u.full_name, 'Employee'), 'crew_role', x.crew_role,
          'machine_name', (select machine_name from public.machines where id = x.machine_id),
          'minutes', round(extract(epoch from least(private.ap10_crew_end(x), v_to) - greatest(x.signed_in_at, v_from)) / 60),
          'competent', private.ap10_crew_competent(c.company_id, x.user_id)) order by x.signed_in_at), '[]')
        from public.press_crew_sessions x join public.app_users u on u.id = x.user_id
        where x.company_id = c.company_id and x.signed_in_at <= v_to and private.ap10_crew_end(x) >= v_from
          and x.machine_id in (select distinct e.machine_id from public.production_push_events e where e.company_id = c.company_id and e.production_job_id = v_job and e.kind = 'push')));
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_crew(text, jsonb) from public, anon;
grant execute on function public.ap_crew(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-049: approved equivalent profiles, suggested when the requested profile is short; customer consent before substitution
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.profile_equivalents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.aluminium_profiles(id),
  equivalent_profile_id uuid not null references public.aluminium_profiles(id),
  basis text not null check (basis in ('same_section', 'customer_approved')),
  customer_id uuid references public.customers(id),
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'retired')),
  note text check (note is null or (length(btrim(note)) between 3 and 300 and note !~ '[[:cntrl:]]')),
  proposed_by uuid not null references public.app_users(id),
  proposed_at timestamptz not null default clock_timestamp(),
  approved_by uuid references public.app_users(id),
  approved_at timestamptz,
  retired_by uuid references public.app_users(id),
  retired_at timestamptz,
  retire_reason text check (retire_reason is null or length(btrim(retire_reason)) between 5 and 300),
  check (profile_id <> equivalent_profile_id),
  check ((basis = 'customer_approved') = (customer_id is not null)),
  check ((status = 'retired') = (retired_at is not null))
);
create unique index if not exists profile_equivalents_pair_key on public.profile_equivalents(company_id, least(profile_id, equivalent_profile_id), greatest(profile_id, equivalent_profile_id),
  coalesce(customer_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status <> 'retired';
create index if not exists profile_equivalents_company_idx on public.profile_equivalents(company_id, profile_id, status);
create index if not exists profile_equivalents_other_idx on public.profile_equivalents(company_id, equivalent_profile_id, status);
create index if not exists profile_equivalents_customer_idx on public.profile_equivalents(customer_id) where customer_id is not null;

create table if not exists public.profile_substitution_consents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id),
  equivalence_id uuid not null references public.profile_equivalents(id),
  equivalent_profile_id uuid not null references public.aluminium_profiles(id),
  customer_id uuid not null references public.customers(id),
  consent_by_name text not null check (length(btrim(consent_by_name)) between 2 and 80 and consent_by_name !~ '[[:cntrl:]]'),
  consent_channel text not null check (consent_channel in ('whatsapp', 'phone', 'email', 'in_person', 'written')),
  consent_reference text check (consent_reference is null or length(btrim(consent_reference)) between 1 and 120),
  consented_on date not null,
  note text check (note is null or (length(btrim(note)) between 3 and 300 and note !~ '[[:cntrl:]]')),
  status text not null default 'recorded' check (status in ('recorded', 'withdrawn')),
  recorded_by uuid not null references public.app_users(id),
  recorded_at timestamptz not null default clock_timestamp(),
  withdrawn_by uuid references public.app_users(id),
  withdrawn_at timestamptz,
  withdraw_reason text check (withdraw_reason is null or length(btrim(withdraw_reason)) between 5 and 300),
  check ((status = 'withdrawn') = (withdrawn_at is not null))
);
create unique index if not exists profile_substitution_consents_line_key on public.profile_substitution_consents(company_id, order_item_id) where status = 'recorded';
create index if not exists profile_substitution_consents_company_idx on public.profile_substitution_consents(company_id, recorded_at desc);
create index if not exists profile_substitution_consents_equivalence_idx on public.profile_substitution_consents(equivalence_id);

-- Approved equivalents of a profile for a customer (either direction of the pair), with their free released stock.
create or replace function private.ap10_equivalents_for(p_company uuid, p_profile uuid, p_customer uuid)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select coalesce(jsonb_agg(jsonb_build_object('equivalence_id', q.id, 'profile_id', q.other, 'profile_code', p.profile_code, 'profile_name', p.profile_name,
      'kg_per_m', p.section_weight_kg_per_m, 'basis', q.basis, 'note', q.note, 'free', private.ap10_profile_free(p_company, q.other)) order by q.basis, p.profile_code), '[]')
  from (select e.id, e.basis, e.note, case when e.profile_id = p_profile then e.equivalent_profile_id else e.profile_id end other
    from public.profile_equivalents e where e.company_id = p_company and e.status = 'approved' and (e.profile_id = p_profile or e.equivalent_profile_id = p_profile)
      and (e.basis = 'same_section' or e.customer_id = p_customer)) q
    join public.aluminium_profiles p on p.id = q.other and p.company_id = p_company and p.is_active and p.deleted_at is null
$$;
revoke all on function private.ap10_equivalents_for(uuid, uuid, uuid) from public, anon, authenticated;

-- Order lines still short: demand not covered by reserved stock or committed production, and the requested profile's own
-- free stock cannot cover the gap.
create or replace function private.ap10_short_lines(p_company uuid, p_order uuid)
returns table(order_item_id uuid, order_id uuid, order_number text, customer_id uuid, profile_id uuid, short_kg numeric, own_free_kg numeric, promise date)
language sql stable security definer set search_path = public, private as $$
  select i.id, o.id, o.order_number, o.customer_id, i.profile_id, round(x.short, 3), (private.ap10_profile_free(p_company, i.profile_id) ->> 'kg')::numeric, o.expected_dispatch_date
  from public.order_items i join public.orders o on o.id = i.order_id and o.company_id = p_company
    cross join lateral (select private.stock_line_quantities(p_company, i.id) v) q
    cross join lateral (select greatest(coalesce((q.v ->> 'demand_kg')::numeric, 0) - coalesce((q.v ->> 'stock_covered_kg')::numeric, 0) - coalesce((q.v ->> 'production_committed_kg')::numeric, 0), 0) short) x
  where i.company_id = p_company and i.profile_id is not null and o.deleted_at is null and o.dealer_id is null
    and o.current_stage not in ('dispatched', 'delivered', 'payment_pending', 'closed', 'cancelled')
    and (p_order is null or o.id = p_order) and x.short > 0.5
    and (private.ap10_profile_free(p_company, i.profile_id) ->> 'kg')::numeric < x.short
$$;
revoke all on function private.ap10_short_lines(uuid, uuid) from public, anon, authenticated;

create or replace function public.ap_equivalents(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; e public.profile_equivalents%rowtype; k public.profile_substitution_consents%rowtype; v_profile uuid; v_other uuid; v_customer uuid; v_basis text; v_line uuid;
  v_rows jsonb; v_total bigint; v_page integer := private.ap3_page(p_payload); li record;
  v_technical text[] := array['owner', 'admin', 'quality', 'production_manager', 'factory_manager']; v_sales text[] := array['owner', 'admin', 'sales_manager', 'sales'];
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'sales_manager', 'sales', 'quality', 'production_manager', 'factory_manager', 'inventory_manager']);
  if p_command = 'profile' then
    perform private.ap_keys(p_payload, array['profile_id']);
    v_profile := private.ap_uuid(p_payload, 'profile_id');
    if not exists (select 1 from public.aluminium_profiles where id = v_profile and company_id = c.company_id) then raise exception 'AP: Profile not found.'; end if;
    return jsonb_build_object('profile_id', v_profile, 'can_propose', true, 'can_approve', c.role = any(v_technical),
      'rows', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'status', x.status, 'basis', x.basis, 'note', x.note,
          'profile_id', q.other, 'profile_code', p.profile_code, 'profile_name', p.profile_name, 'kg_per_m', p.section_weight_kg_per_m,
          'customer', case when x.customer_id is not null then private.ap3_customer_name(x.customer_id) end,
          'proposed_by', (select full_name from public.app_users where id = x.proposed_by), 'proposed_at', x.proposed_at, 'own_proposal', x.proposed_by = c.actor_id,
          'approved_by', (select full_name from public.app_users where id = x.approved_by), 'approved_at', x.approved_at,
          'free', case when x.status = 'approved' then private.ap10_profile_free(c.company_id, q.other) end) order by (x.status = 'approved') desc, x.proposed_at desc), '[]')
        from public.profile_equivalents x cross join lateral (select case when x.profile_id = v_profile then x.equivalent_profile_id else x.profile_id end other) q
          join public.aluminium_profiles p on p.id = q.other
        where x.company_id = c.company_id and x.status <> 'retired' and (x.profile_id = v_profile or x.equivalent_profile_id = v_profile)));
  elsif p_command = 'propose' then
    perform private.ap_keys(p_payload, array['profile_id', 'equivalent_profile_id', 'basis', 'customer_id', 'note']);
    v_profile := private.ap_uuid(p_payload, 'profile_id'); v_other := private.ap_uuid(p_payload, 'equivalent_profile_id');
    v_basis := p_payload ->> 'basis'; v_customer := private.ap_uuid(p_payload, 'customer_id', false);
    if v_basis is null or v_basis not in ('same_section', 'customer_approved') then raise exception 'AP: Choose why the profiles are equivalent.'; end if;
    if v_profile = v_other then raise exception 'AP: Choose a different profile as the equivalent.'; end if;
    if (v_basis = 'customer_approved') <> (v_customer is not null) then raise exception 'AP: A customer-approved alternative names the customer; a same-section equivalent does not.'; end if;
    if (select count(*) from public.aluminium_profiles where id in (v_profile, v_other) and company_id = c.company_id and is_active and deleted_at is null) <> 2 then raise exception 'AP: Profile not found.'; end if;
    if v_customer is not null and not exists (select 1 from public.customers where id = v_customer and company_id = c.company_id and deleted_at is null) then raise exception 'AP: Customer not found.'; end if;
    if exists (select 1 from public.profile_equivalents x where x.company_id = c.company_id and x.status <> 'retired'
        and least(x.profile_id, x.equivalent_profile_id) = least(v_profile, v_other) and greatest(x.profile_id, x.equivalent_profile_id) = greatest(v_profile, v_other)
        and x.customer_id is not distinct from v_customer) then
      raise exception 'AP: These two profiles are already listed as equivalents.';
    end if;
    insert into public.profile_equivalents(company_id, profile_id, equivalent_profile_id, basis, customer_id, note, proposed_by)
      values (c.company_id, v_profile, v_other, v_basis, v_customer, private.ap_text(p_payload ->> 'note', 'Note', 3, 300, false), c.actor_id) returning * into e;
    return jsonb_build_object('id', e.id, 'status', e.status);
  elsif p_command = 'approve' then
    perform private.ap4_need(c.role, v_technical);
    perform private.ap_keys(p_payload, array['id']);
    select * into e from public.profile_equivalents where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id for update;
    if e.id is null or e.status <> 'proposed' then raise exception 'AP: This equivalence is not waiting for approval.'; end if;
    if e.proposed_by = c.actor_id and c.role <> 'owner' then raise exception 'AP: An equivalence is approved by someone other than the person who proposed it.'; end if;
    update public.profile_equivalents set status = 'approved', approved_by = c.actor_id, approved_at = clock_timestamp() where id = e.id;
    return jsonb_build_object('id', e.id, 'status', 'approved');
  elsif p_command = 'retire' then
    perform private.ap4_need(c.role, v_technical);
    perform private.ap_keys(p_payload, array['id', 'reason']);
    update public.profile_equivalents set status = 'retired', retired_by = c.actor_id, retired_at = clock_timestamp(), retire_reason = private.ap_text(p_payload ->> 'reason', 'Reason', 5, 300)
      where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id and status <> 'retired' returning * into e;
    if e.id is null then raise exception 'AP: Equivalence not found.'; end if;
    return jsonb_build_object('id', e.id, 'status', 'retired');
  elsif p_command = 'order' then
    perform private.ap_keys(p_payload, array['order_id']);
    if not exists (select 1 from public.orders where id = private.ap_uuid(p_payload, 'order_id') and company_id = c.company_id) then raise exception 'AP: Order not found.'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('order_item_id', s.order_item_id, 'profile_id', s.profile_id, 'profile_code', p.profile_code, 'short_kg', s.short_kg, 'own_free_kg', s.own_free_kg,
        'equivalents', private.ap10_equivalents_for(c.company_id, s.profile_id, s.customer_id),
        'consent', (select jsonb_build_object('id', n.id, 'equivalent_code', (select profile_code from public.aluminium_profiles where id = n.equivalent_profile_id), 'consent_by_name', n.consent_by_name,
            'consent_channel', n.consent_channel, 'consent_reference', n.consent_reference, 'consented_on', n.consented_on, 'recorded_by', (select full_name from public.app_users where id = n.recorded_by))
          from public.profile_substitution_consents n where n.company_id = c.company_id and n.order_item_id = s.order_item_id and n.status = 'recorded')) order by p.profile_code), '[]') into v_rows
      from private.ap10_short_lines(c.company_id, private.ap_uuid(p_payload, 'order_id')) s join public.aluminium_profiles p on p.id = s.profile_id;
    return jsonb_build_object('lines', v_rows, 'can_record', c.role = any(v_sales));
  elsif p_command = 'shortages' then
    perform private.ap_keys(p_payload, array['page']);
    with f as (select s.*, private.ap10_equivalents_for(c.company_id, s.profile_id, s.customer_id) eq from private.ap10_short_lines(c.company_id, null) s),
      g as (select f.*, row_number() over (order by f.promise nulls last, f.order_number, f.order_item_id) k from f
        where exists (select 1 from jsonb_array_elements(f.eq) v where (v.value #>> '{free,kg}')::numeric > 0))
    select coalesce((select jsonb_agg(jsonb_build_object('order_item_id', g.order_item_id, 'order_id', g.order_id, 'order_number', g.order_number, 'customer', private.ap3_customer_name(g.customer_id),
        'profile_code', (select profile_code from public.aluminium_profiles where id = g.profile_id), 'short_kg', g.short_kg, 'promise', g.promise, 'equivalents', g.eq,
        'consent_recorded', exists (select 1 from public.profile_substitution_consents n where n.company_id = c.company_id and n.order_item_id = g.order_item_id and n.status = 'recorded')) order by g.k)
      from g where g.k > (v_page - 1) * 10 and g.k <= v_page * 10), '[]'), (select count(*) from g) into v_rows, v_total;
    return jsonb_build_object('rows', v_rows, 'page', v_page, 'total_count', v_total);
  elsif p_command = 'consent' then
    perform private.ap4_need(c.role, v_sales);
    perform private.ap_keys(p_payload, array['order_item_id', 'equivalence_id', 'consent_by_name', 'consent_channel', 'consent_reference', 'consented_on', 'note']);
    v_line := private.ap_uuid(p_payload, 'order_item_id');
    select i.id, i.profile_id, o.customer_id into li from public.order_items i join public.orders o on o.id = i.order_id where i.id = v_line and i.company_id = c.company_id and o.company_id = c.company_id;
    if li.id is null then raise exception 'AP: Order line not found.'; end if;
    select * into e from public.profile_equivalents where id = private.ap_uuid(p_payload, 'equivalence_id') and company_id = c.company_id;
    if e.id is null or e.status <> 'approved' then raise exception 'AP: Only an approved equivalent can be offered to the customer.'; end if;
    if li.profile_id not in (e.profile_id, e.equivalent_profile_id) then raise exception 'AP: This equivalent does not belong to the order line''s profile.'; end if;
    if e.basis = 'customer_approved' and e.customer_id <> li.customer_id then raise exception 'AP: This alternative was approved for a different customer.'; end if;
    if (p_payload ->> 'consent_channel') is null or (p_payload ->> 'consent_channel') not in ('whatsapp', 'phone', 'email', 'in_person', 'written') then raise exception 'AP: Choose how the customer agreed.'; end if;
    if private.ap10_day(p_payload, 'consented_on', 'Consent date') > private.ist_today() then raise exception 'AP: The consent date cannot be in the future.'; end if;
    if exists (select 1 from public.profile_substitution_consents n where n.company_id = c.company_id and n.order_item_id = v_line and n.status = 'recorded') then
      raise exception 'AP: A consent is already recorded for this line. Withdraw it first to record another.';
    end if;
    insert into public.profile_substitution_consents(company_id, order_item_id, equivalence_id, equivalent_profile_id, customer_id, consent_by_name, consent_channel, consent_reference, consented_on, note, recorded_by)
      values (c.company_id, v_line, e.id, case when e.profile_id = li.profile_id then e.equivalent_profile_id else e.profile_id end, li.customer_id,
        private.ap_text(p_payload ->> 'consent_by_name', 'Person who agreed', 2, 80), p_payload ->> 'consent_channel', private.ap_text(p_payload ->> 'consent_reference', 'Reference', 1, 120, false),
        private.ap10_day(p_payload, 'consented_on', 'Consent date'), private.ap_text(p_payload ->> 'note', 'Note', 3, 300, false), c.actor_id) returning * into k;
    return jsonb_build_object('id', k.id, 'status', k.status, 'next', 'The order line is not changed here. Edit the order line to the agreed profile through the normal order edit.');
  elsif p_command = 'withdraw_consent' then
    perform private.ap4_need(c.role, v_sales);
    perform private.ap_keys(p_payload, array['id', 'reason']);
    update public.profile_substitution_consents set status = 'withdrawn', withdrawn_by = c.actor_id, withdrawn_at = clock_timestamp(), withdraw_reason = private.ap_text(p_payload ->> 'reason', 'Reason', 5, 300)
      where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id and status = 'recorded' returning * into k;
    if k.id is null then raise exception 'AP: Recorded consent not found.'; end if;
    return jsonb_build_object('id', k.id, 'status', 'withdrawn');
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_equivalents(text, jsonb) from public, anon;
grant execute on function public.ap_equivalents(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-068: make-to-stock suggestions for idle press capacity (fast movers below their target stock)
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.stock_targets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.aluminium_profiles(id),
  finish text not null default 'mill_finish' check (finish ~ '^[a-z_]{2,40}$'),
  piece_length_m numeric(8,3) not null check (piece_length_m > 0 and piece_length_m <= 100),
  target_kg numeric(14,3) not null check (target_kg > 0),
  max_kg numeric(14,3) not null check (max_kg > 0),
  is_active boolean not null default true,
  note text check (note is null or (length(btrim(note)) between 3 and 300 and note !~ '[[:cntrl:]]')),
  set_by uuid not null references public.app_users(id),
  set_at timestamptz not null default clock_timestamp(),
  check (max_kg >= target_kg),
  unique (company_id, profile_id, finish, piece_length_m)
);
create index if not exists stock_targets_company_idx on public.stock_targets(company_id, is_active, profile_id);
create index if not exists stock_targets_profile_idx on public.stock_targets(profile_id);

create table if not exists public.stock_run_suggestions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  target_id uuid not null references public.stock_targets(id),
  profile_id uuid not null references public.aluminium_profiles(id),
  week_start date not null,
  suggested_kg numeric(14,3) not null check (suggested_kg > 0),
  basis jsonb not null,
  status text not null default 'suggested' check (status in ('suggested', 'approved', 'dismissed', 'expired')),
  decided_by uuid references public.app_users(id),
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(btrim(decision_note)) between 3 and 300),
  task_id uuid references public.tasks(id) on delete set null,
  job_run_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  check ((status in ('approved', 'dismissed')) = (decided_by is not null))
);
create unique index if not exists stock_run_suggestions_live_key on public.stock_run_suggestions(company_id, target_id, week_start) where status in ('suggested', 'approved');
create index if not exists stock_run_suggestions_company_idx on public.stock_run_suggestions(company_id, status, week_start desc);
create index if not exists stock_run_suggestions_target_idx on public.stock_run_suggestions(target_id);
create index if not exists stock_run_suggestions_profile_idx on public.stock_run_suggestions(profile_id);

-- Ordered kilograms of a profile over the last 90 days (cancelled and deleted orders excluded).
create or replace function private.ap10_demand_90d(p_company uuid, p_profile uuid)
returns numeric language sql stable security definer set search_path = public, private as $$
  select coalesce(round(sum(coalesce(nullif(i.manufacturing_weight_kg, 0), i.quantity_kg, 0)), 1), 0)
  from public.order_items i join public.orders o on o.id = i.order_id and o.company_id = p_company
  where i.company_id = p_company and i.profile_id = p_profile and o.deleted_at is null and o.current_stage <> 'cancelled' and o.order_date >= private.ist_today() - 90
$$;
revoke all on function private.ap10_demand_90d(uuid, uuid) from public, anon, authenticated;

-- Free released stock of a target's profile, finish and piece length.
create or replace function private.ap10_target_stock(p_company uuid, p_profile uuid, p_finish text, p_length numeric)
returns numeric language sql stable security definer set search_path = public, private as $$
  select coalesce(sum((l.value ->> 'kg')::numeric), 0)
  from jsonb_array_elements(private.ap10_profile_free(p_company, p_profile) -> 'lots') l
  where l.value ->> 'finish' = p_finish and abs(coalesce((l.value ->> 'piece_length_m')::numeric, -1) - p_length) < 0.0015
$$;
revoke all on function private.ap10_target_stock(uuid, uuid, text, numeric) from public, anon, authenticated;

-- Free press capacity over this week and the next: kilograms from the capacity read model, hours from the shift pattern.
create or replace function private.ap10_idle_capacity(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare v_ids uuid[]; v_weeks jsonb; v_hours numeric; v_avail numeric; v_free numeric;
begin
  select array_agg(id) into v_ids from public.machines where company_id = p_company and machine_type = 'extrusion_press' and is_active;
  if v_ids is null then return jsonb_build_object('configured', false, 'weeks', '[]'::jsonb, 'free_kg', 0, 'available_kg', 0, 'idle_hours', null); end if;
  v_weeks := private.ap8_capacity_weeks(p_company, v_ids, true, 2);
  select coalesce(sum((w.value ->> 'available_kg')::numeric), 0), coalesce(sum((w.value ->> 'free_kg')::numeric), 0) into v_avail, v_free from jsonb_array_elements(v_weeks) w;
  select coalesce(sum(extract(epoch from s.ends_local - s.starts_local) / 3600 + case when s.ends_local <= s.starts_local then 24 else 0 end), 0) into v_hours
    from generate_series(private.ist_today()::timestamp, (private.ap8_week(private.ist_today()) + 13)::timestamp, interval '1 day') g
      join public.factory_shift_capacities s on s.company_id = p_company and s.machine_id = any(v_ids) and s.weekday = extract(isodow from g::date)
    where private.factory_is_working_day(p_company, g::date);
  return jsonb_build_object('configured', v_avail > 0, 'weeks', v_weeks, 'free_kg', v_free, 'available_kg', v_avail,
    'idle_hours', case when v_avail > 0 then round(v_hours * v_free / v_avail, 1) end, 'shift_hours', round(v_hours, 1));
end;
$$;
revoke all on function private.ap10_idle_capacity(uuid) from public, anon, authenticated;

-- Suggest runs for targets below their stock, fastest movers first, within the free capacity, the billets in stock of the
-- profile's alloy (at the profile's recovery target, else 80%) and the target's holding limit. Suggestions only.
create or replace function private.ap10_stock_suggest(p_company uuid, p_run uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_week date := private.ap8_week(private.ist_today()); v_idle jsonb; v_left numeric; t record; v_stock numeric; v_open numeric; v_need numeric; v_kg numeric;
  v_billets jsonb := '{}'::jsonb; v_alloy text; v_billet numeric; v_recovery numeric; v_n integer := 0; v_new integer := 0; v_hit uuid;
begin
  update public.stock_run_suggestions set status = 'expired' where company_id = p_company and status = 'suggested' and week_start < v_week;
  v_idle := private.ap10_idle_capacity(p_company);
  v_left := coalesce((v_idle ->> 'free_kg')::numeric, 0);
  for t in select st.id, st.profile_id, st.finish, st.piece_length_m, st.target_kg, st.max_kg, p.alloy, p.recovery_target_percent, p.minimum_order_quantity_kg,
      private.ap10_demand_90d(p_company, st.profile_id) demand_kg
    from public.stock_targets st join public.aluminium_profiles p on p.id = st.profile_id and p.is_active and p.deleted_at is null
    where st.company_id = p_company and st.is_active order by 10 desc, p.profile_code, st.id loop
    v_n := v_n + 1;
    exit when v_left <= 0;
    continue when t.demand_kg <= 0;
    v_stock := private.ap10_target_stock(p_company, t.profile_id, t.finish, t.piece_length_m);
    select coalesce(sum(sg.suggested_kg), 0) into v_open from public.stock_run_suggestions sg
      where sg.company_id = p_company and sg.target_id = t.id and sg.status = 'approved' and sg.decided_at >= now() - interval '21 days';
    v_need := least(t.target_kg, t.max_kg) - v_stock - v_open;
    continue when v_need <= 0;
    v_alloy := upper(coalesce(nullif(btrim(t.alloy), ''), '?'));
    if v_billets ? v_alloy then v_billet := (v_billets ->> v_alloy)::numeric;
    else select coalesce(sum(b.available_weight_kg), 0) into v_billet from public.billet_batches b where b.company_id = p_company and b.status = 'available' and upper(btrim(b.alloy)) = v_alloy;
    end if;
    v_recovery := least(greatest(coalesce(t.recovery_target_percent, 80), 40), 98) / 100.0;
    v_kg := round(least(v_need, v_left, v_billet * v_recovery), 0);
    v_billets := v_billets || jsonb_build_object(v_alloy, v_billet);
    continue when v_kg < greatest(coalesce(t.minimum_order_quantity_kg, 0), 50);
    v_hit := null;
    insert into public.stock_run_suggestions(company_id, target_id, profile_id, week_start, suggested_kg, basis, job_run_id)
      values (p_company, t.id, t.profile_id, v_week, v_kg, jsonb_build_object('demand_90d_kg', t.demand_kg, 'stock_kg', round(v_stock, 1), 'approved_open_kg', v_open, 'target_kg', t.target_kg,
        'max_kg', t.max_kg, 'free_capacity_kg', v_left, 'billet_free_kg', round(v_billet, 1), 'alloy', nullif(v_alloy, '?'), 'recovery_percent', v_recovery * 100,
        'idle_hours', v_idle -> 'idle_hours', 'limited_by', case when v_kg >= round(v_need, 0) then 'target' when v_kg >= round(v_left, 0) then 'capacity' else 'billets' end), p_run)
      on conflict (company_id, target_id, week_start) where status in ('suggested', 'approved') do nothing returning id into v_hit;
    if v_hit is not null then v_new := v_new + 1; end if;
    -- A live suggestion for this target (new or earlier this week) claims its capacity and billets either way.
    v_left := v_left - v_kg; v_billets := v_billets || jsonb_build_object(v_alloy, greatest(v_billet - v_kg / v_recovery, 0));
  end loop;
  return jsonb_build_object('examined', v_n, 'proposals', v_new, 'alerts', 0);
end;
$$;
revoke all on function private.ap10_stock_suggest(uuid, uuid) from public, anon, authenticated;

create or replace function public.ap_stock_runs(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; t public.stock_targets%rowtype; s public.stock_run_suggestions%rowtype; v_rows jsonb; v_total bigint; v_page integer := private.ap3_page(p_payload);
  v_search text := lower(btrim(coalesce(p_payload ->> 'search', ''))); v_profile uuid; v_len numeric; v_target numeric; v_max numeric; v_finish text; v_task uuid; v_code text;
  v_decide text[] := array['owner', 'admin', 'factory_manager', 'production_manager'];
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'factory_manager', 'production_manager', 'sales_manager', 'inventory_manager']);
  if p_command = 'idle' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return private.ap10_idle_capacity(c.company_id) || jsonb_build_object('can_decide', c.role = any(v_decide),
      'open_suggestions', (select count(*) from public.stock_run_suggestions x where x.company_id = c.company_id and x.status = 'suggested'),
      'active_targets', (select count(*) from public.stock_targets x where x.company_id = c.company_id and x.is_active));
  elsif p_command = 'targets' then
    perform private.ap_keys(p_payload, array['page', 'search']);
    with f as (select st.*, p.profile_code, p.profile_name, row_number() over (order by p.profile_code, st.piece_length_m, st.finish) k
      from public.stock_targets st join public.aluminium_profiles p on p.id = st.profile_id
      where st.company_id = c.company_id and st.is_active and (v_search = '' or lower(p.profile_code || ' ' || p.profile_name) like '%' || v_search || '%'))
    select coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'profile_id', f.profile_id, 'profile_code', f.profile_code, 'profile_name', f.profile_name, 'finish', f.finish,
        'piece_length_m', f.piece_length_m, 'target_kg', f.target_kg, 'max_kg', f.max_kg, 'note', f.note,
        'stock_kg', private.ap10_target_stock(c.company_id, f.profile_id, f.finish, f.piece_length_m),
        'demand_90d_kg', private.ap10_demand_90d(c.company_id, f.profile_id)) order by f.k) from f where f.k > (v_page - 1) * 10 and f.k <= v_page * 10), '[]'),
      (select count(*) from f) into v_rows, v_total;
    return jsonb_build_object('rows', v_rows, 'page', v_page, 'total_count', v_total, 'can_decide', c.role = any(v_decide));
  elsif p_command = 'fast_movers' then
    perform private.ap_keys(p_payload, array['page']);
    with d as (select i.profile_id, round(sum(coalesce(nullif(i.manufacturing_weight_kg, 0), i.quantity_kg, 0)), 1) kg, count(distinct o.id) orders
        from public.order_items i join public.orders o on o.id = i.order_id and o.company_id = c.company_id
        where i.company_id = c.company_id and i.profile_id is not null and o.deleted_at is null and o.current_stage <> 'cancelled' and o.order_date >= private.ist_today() - 90
        group by 1 having sum(coalesce(nullif(i.manufacturing_weight_kg, 0), i.quantity_kg, 0)) > 0),
      f as (select d.*, row_number() over (order by d.kg desc, d.profile_id) k from d)
    select coalesce((select jsonb_agg(jsonb_build_object('profile_id', f.profile_id, 'profile_code', p.profile_code, 'profile_name', p.profile_name, 'demand_90d_kg', f.kg, 'orders', f.orders,
        'free_stock_kg', (private.ap10_profile_free(c.company_id, f.profile_id) ->> 'kg')::numeric,
        'targets', (select count(*) from public.stock_targets st where st.company_id = c.company_id and st.profile_id = f.profile_id and st.is_active)) order by f.k)
      from f join public.aluminium_profiles p on p.id = f.profile_id where f.k > (v_page - 1) * 10 and f.k <= v_page * 10), '[]'), (select count(*) from f) into v_rows, v_total;
    return jsonb_build_object('rows', v_rows, 'page', v_page, 'total_count', v_total);
  elsif p_command = 'save_target' then
    perform private.ap4_need(c.role, v_decide);
    perform private.ap_keys(p_payload, array['profile_id', 'finish', 'piece_length_m', 'target_kg', 'max_kg', 'note']);
    v_profile := private.ap_uuid(p_payload, 'profile_id');
    if not exists (select 1 from public.aluminium_profiles where id = v_profile and company_id = c.company_id and is_active and deleted_at is null) then raise exception 'AP: Profile not found.'; end if;
    v_finish := coalesce(nullif(btrim(p_payload ->> 'finish'), ''), 'mill_finish');
    if v_finish !~ '^[a-z_]{2,40}$' then raise exception 'AP: Choose the finish.'; end if;
    v_len := private.ap4_num(p_payload, 'piece_length_m', 'Piece length', 0.1, 100);
    v_target := private.ap4_num(p_payload, 'target_kg', 'Target stock', 1, 10000000);
    v_max := coalesce(private.ap4_num(p_payload, 'max_kg', 'Holding limit', 1, 10000000, false), v_target);
    if v_max < v_target then raise exception 'AP: The holding limit cannot be below the target stock.'; end if;
    insert into public.stock_targets(company_id, profile_id, finish, piece_length_m, target_kg, max_kg, note, set_by)
      values (c.company_id, v_profile, v_finish, round(v_len, 3), v_target, v_max, private.ap_text(p_payload ->> 'note', 'Note', 3, 300, false), c.actor_id)
      on conflict (company_id, profile_id, finish, piece_length_m) do update set target_kg = excluded.target_kg, max_kg = excluded.max_kg, note = excluded.note, is_active = true,
        set_by = excluded.set_by, set_at = clock_timestamp() returning * into t;
    return jsonb_build_object('id', t.id, 'target_kg', t.target_kg, 'max_kg', t.max_kg);
  elsif p_command = 'retire_target' then
    perform private.ap4_need(c.role, v_decide);
    perform private.ap_keys(p_payload, array['id']);
    update public.stock_targets set is_active = false, set_by = c.actor_id, set_at = clock_timestamp() where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id and is_active returning * into t;
    if t.id is null then raise exception 'AP: Target not found.'; end if;
    update public.stock_run_suggestions set status = 'expired' where company_id = c.company_id and target_id = t.id and status = 'suggested';
    return jsonb_build_object('id', t.id, 'retired', true);
  elsif p_command = 'suggest' then
    perform private.ap4_need(c.role, v_decide);
    perform private.ap_keys(p_payload, array[]::text[]);
    return private.ap10_stock_suggest(c.company_id, null);
  elsif p_command = 'list' then
    perform private.ap_keys(p_payload, array['page', 'status']);
    if coalesce(p_payload ->> 'status', 'suggested') not in ('suggested', 'approved', 'dismissed', 'expired', 'all') then raise exception 'AP: Invalid request.'; end if;
    with f as (select x.*, row_number() over (order by (x.status = 'suggested') desc, x.created_at desc, x.id) k from public.stock_run_suggestions x
      where x.company_id = c.company_id and (coalesce(p_payload ->> 'status', 'suggested') = 'all' or x.status = coalesce(p_payload ->> 'status', 'suggested')))
    select coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'profile_id', f.profile_id, 'profile_code', p.profile_code, 'profile_name', p.profile_name, 'finish', st.finish,
        'piece_length_m', st.piece_length_m, 'week_start', f.week_start, 'suggested_kg', f.suggested_kg, 'basis', f.basis, 'status', f.status, 'decision_note', f.decision_note,
        'decided_by', (select full_name from public.app_users where id = f.decided_by), 'decided_at', f.decided_at, 'task_id', f.task_id) order by f.k)
      from f join public.aluminium_profiles p on p.id = f.profile_id join public.stock_targets st on st.id = f.target_id where f.k > (v_page - 1) * 10 and f.k <= v_page * 10), '[]'),
      (select count(*) from f) into v_rows, v_total;
    return jsonb_build_object('rows', v_rows, 'page', v_page, 'total_count', v_total, 'can_decide', c.role = any(v_decide));
  elsif p_command in ('approve', 'dismiss') then
    perform private.ap4_need(c.role, v_decide);
    perform private.ap_keys(p_payload, array['id', 'note']);
    select * into s from public.stock_run_suggestions where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id for update;
    if s.id is null or s.status <> 'suggested' then raise exception 'AP: This suggestion is no longer open.'; end if;
    if p_command = 'dismiss' then
      update public.stock_run_suggestions set status = 'dismissed', decided_by = c.actor_id, decided_at = clock_timestamp(), decision_note = private.ap_text(p_payload ->> 'note', 'Reason', 3, 300) where id = s.id;
      return jsonb_build_object('id', s.id, 'status', 'dismissed');
    end if;
    select profile_code into v_code from public.aluminium_profiles where id = s.profile_id;
    select * into t from public.stock_targets where id = s.target_id;
    -- Approval hands the run to the planner as a task; the job itself is created through normal production planning.
    insert into public.tasks(company_id, title, description, task_type, assigned_to, created_by, priority, status, due_date, related_entity_type, related_entity_id)
      values (c.company_id, 'Plan make-to-stock run: ' || coalesce(v_code, 'profile') || ' ' || trim_scale(s.suggested_kg) || ' kg',
        'Approved for idle press capacity in the week of ' || to_char(s.week_start, 'DD Mon YYYY') || '. ' || trim_scale(t.piece_length_m) || ' m, ' || replace(t.finish, '_', ' ')
          || '. Stock ' || coalesce(s.basis ->> 'stock_kg', '?') || ' kg against a target of ' || trim_scale(t.target_kg) || ' kg; 90-day demand ' || coalesce(s.basis ->> 'demand_90d_kg', '?')
          || ' kg. Plan it through production planning so billets and capacity are checked there.',
        'manual', private.ap6_assignee(c.company_id, array['production_manager', 'factory_manager'], c.actor_id), c.actor_id, 'normal', 'open', s.week_start + 6, 'aluminium_profile', s.profile_id)
      returning id into v_task;
    update public.stock_run_suggestions set status = 'approved', decided_by = c.actor_id, decided_at = clock_timestamp(),
      decision_note = private.ap_text(p_payload ->> 'note', 'Note', 3, 300, false), task_id = v_task where id = s.id;
    return jsonb_build_object('id', s.id, 'status', 'approved', 'task_id', v_task);
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_stock_runs(text, jsonb) from public, anon;
grant execute on function public.ap_stock_runs(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-055: powder coating runs batched by shade and powder brand
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.coating_line_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  capacity_kg_per_hour numeric(10,2) not null check (capacity_kg_per_hour > 0 and capacity_kg_per_hour <= 100000),
  changeover_minutes integer not null check (changeover_minutes between 0 and 480),
  day_start time not null default '08:00',
  hours_per_day numeric(4,1) not null default 8 check (hours_per_day between 1 and 24),
  include_vendor_jobs boolean not null default false,
  updated_by uuid not null references public.app_users(id),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.finishing_job_powder (
  finishing_job_id uuid primary key references public.finishing_jobs(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  powder_brand text not null check (length(btrim(powder_brand)) between 2 and 60 and powder_brand !~ '[[:cntrl:]]'),
  set_by uuid not null references public.app_users(id),
  set_at timestamptz not null default clock_timestamp()
);
create index if not exists finishing_job_powder_company_idx on public.finishing_job_powder(company_id, powder_brand);

create table if not exists public.coating_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  run_day date not null,
  status text not null default 'confirmed' check (status in ('confirmed', 'superseded')),
  groups jsonb not null check (jsonb_typeof(groups) = 'array'),
  job_ids uuid[] not null,
  total_kg numeric(14,3),
  shade_changes integer not null check (shade_changes >= 0),
  baseline_changes integer not null check (baseline_changes >= 0),
  breaches jsonb not null default '[]' check (jsonb_typeof(breaches) = 'array'),
  breach_note text check (breach_note is null or (length(btrim(breach_note)) between 5 and 300 and breach_note !~ '[[:cntrl:]]')),
  queue_fingerprint text not null,
  confirmed_by uuid not null references public.app_users(id),
  confirmed_at timestamptz not null default clock_timestamp(),
  check (jsonb_array_length(breaches) = 0 or breach_note is not null)
);
create unique index if not exists coating_runs_day_key on public.coating_runs(company_id, run_day) where status = 'confirmed';
create index if not exists coating_runs_company_idx on public.coating_runs(company_id, run_day desc);

-- Material waiting for powder coating, with the shade as recorded, the powder brand and the order's promised date.
create or replace function private.ap10_coating_queue(p_company uuid)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'status', f.status, 'order_id', o.id, 'order_number', o.order_number, 'customer', private.ap3_customer_name(o.customer_id),
      'shade_key', nullif(upper(regexp_replace(coalesce(nullif(btrim(f.color_code), ''), nullif(btrim(f.shade_name), ''), ''), '\s+', ' ', 'g')), ''),
      'shade', coalesce(nullif(btrim(f.color_code), ''), nullif(btrim(f.shade_name), '')), 'shade_name', nullif(btrim(f.shade_name), ''),
      'brand', (select pw.powder_brand from public.finishing_job_powder pw where pw.finishing_job_id = f.id),
      'kg', nullif(f.input_weight_kg, 0), 'due', o.expected_dispatch_date, 'priority', o.priority, 'planned_date', f.planned_date,
      'job_number', (select j.job_number from public.production_jobs j where j.id = f.production_job_id), 'vendor', f.vendor_id is not null)
    order by o.expected_dispatch_date nulls last, o.order_number, f.id), '[]')
  from public.finishing_jobs f join public.orders o on o.id = f.order_id and o.company_id = p_company
  where f.company_id = p_company and f.finishing_type = 'powder_coating' and f.status in ('planned', 'in_process') and o.deleted_at is null
    and (f.vendor_id is null or coalesce((select s.include_vendor_jobs from public.coating_line_settings s where s.company_id = p_company), false))
$$;
revoke all on function private.ap10_coating_queue(uuid) from public, anon, authenticated;

create or replace function public.ap_coating(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_queue jsonb; v_fp text; v_day date; v_rows jsonb; v_total bigint; v_page integer := private.ap3_page(p_payload); g jsonb; v_ids uuid[] := '{}'; v_id uuid; q jsonb;
  v_changes integer; v_base integer; r public.coating_runs%rowtype; v_job uuid; v_note text;
  v_lead text[] := array['owner', 'admin', 'factory_manager', 'production_manager'];
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'factory_manager', 'production_manager', 'production', 'quality', 'dispatch_manager']);
  if p_command = 'queue' then
    perform private.ap_keys(p_payload, array[]::text[]);
    v_queue := private.ap10_coating_queue(c.company_id);
    return jsonb_build_object('rows', v_queue, 'fingerprint', md5(v_queue::text), 'today', private.ist_today(), 'can_confirm', c.role = any(v_lead),
      'settings', (select jsonb_build_object('capacity_kg_per_hour', s.capacity_kg_per_hour, 'changeover_minutes', s.changeover_minutes, 'day_start', to_char(s.day_start, 'HH24:MI'),
        'hours_per_day', s.hours_per_day, 'include_vendor_jobs', s.include_vendor_jobs) from public.coating_line_settings s where s.company_id = c.company_id),
      'working_days', (select coalesce(jsonb_agg(d::date order by d), '[]') from generate_series(private.ist_today()::timestamp, (private.ist_today() + 20)::timestamp, interval '1 day') d
        where private.factory_is_working_day(c.company_id, d::date)),
      'confirmed', (select jsonb_build_object('id', x.id, 'run_day', x.run_day, 'groups', x.groups, 'shade_changes', x.shade_changes, 'baseline_changes', x.baseline_changes, 'breaches', x.breaches,
          'breach_note', x.breach_note, 'confirmed_by', (select full_name from public.app_users where id = x.confirmed_by), 'confirmed_at', x.confirmed_at, 'stale', x.queue_fingerprint <> md5(v_queue::text))
        from public.coating_runs x where x.company_id = c.company_id and x.status = 'confirmed' and x.run_day >= private.ist_today() order by x.run_day limit 1));
  elsif p_command = 'save_settings' then
    perform private.ap4_need(c.role, v_lead);
    perform private.ap_keys(p_payload, array['capacity_kg_per_hour', 'changeover_minutes', 'day_start', 'hours_per_day', 'include_vendor_jobs']);
    if coalesce(p_payload ->> 'day_start', '08:00') !~ '^([01]\d|2[0-3]):[0-5]\d$' then raise exception 'AP: Enter the line start time as HH:MM.'; end if;
    if private.ap9_int(p_payload, 'changeover_minutes', 'Colour change', 0, 480) is null then raise exception 'AP: Enter the minutes a colour change takes.'; end if;
    insert into public.coating_line_settings(company_id, capacity_kg_per_hour, changeover_minutes, day_start, hours_per_day, include_vendor_jobs, updated_by)
      values (c.company_id, private.ap4_num(p_payload, 'capacity_kg_per_hour', 'Line capacity', 1, 100000), private.ap9_int(p_payload, 'changeover_minutes', 'Colour change', 0, 480),
        coalesce(p_payload ->> 'day_start', '08:00')::time, coalesce(private.ap4_num(p_payload, 'hours_per_day', 'Hours per day', 1, 24, false), 8), coalesce((p_payload ->> 'include_vendor_jobs')::boolean, false), c.actor_id)
      on conflict (company_id) do update set capacity_kg_per_hour = excluded.capacity_kg_per_hour, changeover_minutes = excluded.changeover_minutes, day_start = excluded.day_start,
        hours_per_day = excluded.hours_per_day, include_vendor_jobs = excluded.include_vendor_jobs, updated_by = excluded.updated_by, updated_at = clock_timestamp();
    return jsonb_build_object('saved', true);
  elsif p_command = 'set_brand' then
    perform private.ap4_need(c.role, array['owner', 'admin', 'factory_manager', 'production_manager', 'production']);
    perform private.ap_keys(p_payload, array['finishing_job_id', 'powder_brand']);
    v_job := private.ap_uuid(p_payload, 'finishing_job_id');
    if not exists (select 1 from public.finishing_jobs where id = v_job and company_id = c.company_id and finishing_type = 'powder_coating') then raise exception 'AP: Powder coating job not found.'; end if;
    insert into public.finishing_job_powder(finishing_job_id, company_id, powder_brand, set_by) values (v_job, c.company_id, private.ap_text(p_payload ->> 'powder_brand', 'Powder brand', 2, 60), c.actor_id)
      on conflict (finishing_job_id) do update set powder_brand = excluded.powder_brand, set_by = excluded.set_by, set_at = clock_timestamp();
    return jsonb_build_object('saved', true);
  elsif p_command = 'confirm' then
    -- The run order is computed by the server from the same queue (lib/workflow/coating-batches); the database checks that
    -- it still describes the queue: every job waiting, each once, and one shade and brand per group.
    perform private.ap4_need(c.role, v_lead);
    perform private.ap_keys(p_payload, array['run_day', 'groups', 'shade_changes', 'baseline_changes', 'breaches', 'breach_note', 'fingerprint', 'total_kg']);
    v_day := private.ap10_day(p_payload, 'run_day', 'Run day');
    if v_day < private.ist_today() or v_day > private.ist_today() + 20 then raise exception 'AP: Choose a run day within the next three weeks.'; end if;
    if jsonb_typeof(p_payload -> 'groups') is distinct from 'array' or jsonb_array_length(p_payload -> 'groups') = 0 or jsonb_array_length(p_payload -> 'groups') > 200
      or jsonb_typeof(coalesce(p_payload -> 'breaches', '[]')) <> 'array' then raise exception 'AP: Invalid request.'; end if;
    perform pg_advisory_xact_lock(hashtextextended(c.company_id::text || ':ap10-coating', 0));
    v_queue := private.ap10_coating_queue(c.company_id); v_fp := md5(v_queue::text);
    if v_fp is distinct from (p_payload ->> 'fingerprint') then raise exception 'AP: The coating queue changed since this order was prepared. Reload and review it again.'; end if;
    for g in select value from jsonb_array_elements(p_payload -> 'groups') loop
      if jsonb_typeof(g -> 'job_ids') is distinct from 'array' or jsonb_array_length(g -> 'job_ids') = 0 then raise exception 'AP: Invalid request.'; end if;
      for v_id in select (x.value #>> '{}')::uuid from jsonb_array_elements(g -> 'job_ids') x loop
        if v_id = any(v_ids) then raise exception 'AP: A job is listed twice in the run order.'; end if;
        q := null;
        select value into q from jsonb_array_elements(v_queue) where value ->> 'id' = v_id::text;
        if q is null then raise exception 'AP: A job in the run order is no longer waiting for coating.'; end if;
        if (q ->> 'shade_key') is distinct from (g ->> 'shade_key') or upper(btrim(coalesce(q ->> 'brand', ''))) <> upper(btrim(coalesce(g ->> 'brand', ''))) then raise exception 'AP: A run mixes shades or powder brands.'; end if;
        v_ids := v_ids || v_id;
      end loop;
    end loop;
    v_changes := private.ap9_int(p_payload, 'shade_changes', 'Shade changes', 0, 1000); v_base := private.ap9_int(p_payload, 'baseline_changes', 'Baseline changes', 0, 1000);
    if v_changes is null or v_base is null or v_changes <> jsonb_array_length(p_payload -> 'groups') - 1 then raise exception 'AP: Invalid request.'; end if;
    v_note := private.ap_text(p_payload ->> 'breach_note', 'Reason for running late jobs', 5, 300, false);
    if jsonb_array_length(coalesce(p_payload -> 'breaches', '[]')) > 0 and v_note is null then
      raise exception 'AP: % job(s) would finish after the promised date in this order. Give the reason before confirming.', jsonb_array_length(p_payload -> 'breaches');
    end if;
    update public.coating_runs set status = 'superseded' where company_id = c.company_id and run_day = v_day and status = 'confirmed';
    insert into public.coating_runs(company_id, run_day, groups, job_ids, total_kg, shade_changes, baseline_changes, breaches, breach_note, queue_fingerprint, confirmed_by)
      values (c.company_id, v_day, p_payload -> 'groups', v_ids, private.ap4_num(p_payload, 'total_kg', 'Total', 0, 100000000, false), v_changes, v_base, coalesce(p_payload -> 'breaches', '[]'),
        case when jsonb_array_length(coalesce(p_payload -> 'breaches', '[]')) > 0 then v_note end, v_fp, c.actor_id)
      returning * into r;
    return jsonb_build_object('id', r.id, 'run_day', r.run_day, 'shade_changes', r.shade_changes, 'baseline_changes', r.baseline_changes, 'jobs', cardinality(r.job_ids));
  elsif p_command = 'runs' then
    perform private.ap_keys(p_payload, array['page']);
    with f as (select x.*, row_number() over (order by x.run_day desc, x.confirmed_at desc) k from public.coating_runs x where x.company_id = c.company_id and x.status = 'confirmed')
    select coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'run_day', f.run_day, 'jobs', cardinality(f.job_ids), 'runs', jsonb_array_length(f.groups), 'total_kg', f.total_kg,
        'shade_changes', f.shade_changes, 'baseline_changes', f.baseline_changes, 'late_jobs', jsonb_array_length(f.breaches), 'breach_note', f.breach_note,
        'confirmed_by', (select full_name from public.app_users where id = f.confirmed_by), 'confirmed_at', f.confirmed_at) order by f.k) from f where f.k > (v_page - 1) * 10 and f.k <= v_page * 10), '[]'),
      (select count(*) from f) into v_rows, v_total;
    return jsonb_build_object('rows', v_rows, 'page', v_page, 'total_count', v_total,
      'saved_changes_30d', (select coalesce(sum(x.baseline_changes - x.shade_changes), 0) from public.coating_runs x where x.company_id = c.company_id and x.status = 'confirmed' and x.run_day >= private.ist_today() - 30));
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_coating(text, jsonb) from public, anon;
grant execute on function public.ap_coating(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-067: one push pattern for several orders' cut lengths on the same die (order quantities and lengths never change)
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.cut_combinations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  die_id uuid not null references public.dies(id),
  machine_id uuid references public.machines(id),
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'superseded', 'cancelled')),
  job_ids uuid[] not null check (cardinality(job_ids) between 2 and 20),
  usable_m numeric(10,3) not null check (usable_m > 0),
  kerf_mm numeric(6,2) not null check (kerf_mm >= 0 and kerf_mm <= 50),
  billet_mm numeric(8,1),
  patterns jsonb not null check (jsonb_typeof(patterns) = 'array'),
  separate_pushes integer not null check (separate_pushes > 0),
  combined_pushes integer not null check (combined_pushes > 0),
  separate_recovery numeric(6,2) not null check (separate_recovery between 0 and 100),
  combined_recovery numeric(6,2) not null check (combined_recovery between 0 and 100),
  inputs jsonb not null,
  inputs_fingerprint text not null,
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default clock_timestamp(),
  decided_by uuid references public.app_users(id),
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(btrim(decision_note)) between 3 and 300),
  check (combined_pushes <= separate_pushes)
);
create index if not exists cut_combinations_company_idx on public.cut_combinations(company_id, status, created_at desc);
create index if not exists cut_combinations_die_idx on public.cut_combinations(company_id, die_id, status);
create index if not exists cut_combinations_jobs_idx on public.cut_combinations using gin (job_ids);

-- Jobs of a die that can still share a push pattern: planned or ready, with pieces and a cut length, and not yet pressed.
create or replace function private.ap10_cut_jobs(p_company uuid, p_die uuid)
returns table(job_id uuid, job_number text, order_number text, customer text, machine_id uuid, planned_date date, cut_length_m numeric, pieces integer, planned_kg numeric)
language sql stable security definer set search_path = public, private as $$
  select j.id, j.job_number, o.order_number, private.ap3_customer_name(o.customer_id), j.machine_id, j.planned_date, coalesce(j.length_per_piece_m, j.cl_meter), j.pieces, j.planned_quantity_kg
  from public.production_jobs j join public.orders o on o.id = j.order_id
  where j.company_id = p_company and j.die_id = p_die and j.status in ('planned', 'ready') and j.pieces > 0 and coalesce(j.length_per_piece_m, j.cl_meter) > 0
    and not exists (select 1 from public.production_push_events e where e.company_id = p_company and e.production_job_id = j.id)
$$;
revoke all on function private.ap10_cut_jobs(uuid, uuid) from public, anon, authenticated;

-- Everything the optimiser needs for a die and a set of its jobs: the section, the press's billet and run-out settings and the
-- approved scrap standard. Null when the die is not found; the fingerprint of this object guards a stale pattern.
create or replace function private.ap10_cut_inputs(p_company uuid, p_die uuid, p_jobs uuid[], p_machine uuid)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare d record; v_jobs jsonb; v_machine uuid; b public.press_billet_settings%rowtype; st public.scrap_standards%rowtype;
begin
  select di.id, di.die_number, di.extrusion_ratio, p.profile_code, p.profile_name, p.section_weight_kg_per_m kgm,
      coalesce(p.billet_diameter_mm, p.billet_diameter_required_inch * 25.4, di.billet_diameter_required_inch * 25.4) dia into d
    from public.dies di join public.aluminium_profiles p on p.id = di.profile_id where di.id = p_die and di.company_id = p_company;
  if d.id is null then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('job_id', x.job_id, 'job_number', x.job_number, 'order_number', x.order_number, 'customer', x.customer, 'machine_id', x.machine_id,
      'planned_date', x.planned_date, 'cut_length_m', x.cut_length_m, 'pieces', x.pieces, 'planned_kg', x.planned_kg) order by x.job_number, x.job_id), '[]') into v_jobs
    from private.ap10_cut_jobs(p_company, p_die) x where p_jobs is null or x.job_id = any(p_jobs);
  -- The press: the one asked for, else the press every chosen job is planned on, else none (the planner chooses).
  v_machine := coalesce(p_machine, (select case when count(distinct (j.value ->> 'machine_id')) = 1 then (max(j.value ->> 'machine_id'))::uuid end
    from jsonb_array_elements(v_jobs) j where j.value ->> 'machine_id' is not null));
  if v_machine is not null then
    select * into b from public.press_billet_settings where company_id = p_company and machine_id = v_machine;
    select * into st from private.ap2_standard(p_company, v_machine, p_die);
  end if;
  return jsonb_build_object('die_id', d.id, 'die_number', d.die_number, 'profile_code', d.profile_code, 'profile_name', d.profile_name, 'kg_per_m', d.kgm,
    'billet_diameter_mm', d.dia, 'extrusion_ratio', d.extrusion_ratio, 'jobs', v_jobs, 'machine_id', v_machine,
    'machine_name', (select machine_name from public.machines where id = v_machine),
    'press', case when b.machine_id is not null then jsonb_build_object('min_billet_mm', b.min_billet_mm, 'max_billet_mm', b.max_billet_mm, 'standard_billet_mm', b.standard_billet_mm,
      'butt_mm', b.butt_mm, 'runout_m', b.runout_m, 'front_crop_m', b.front_crop_m, 'back_crop_m', b.back_crop_m, 'container_diameter_mm', b.container_diameter_mm) end,
    'standard', case when st.id is not null then jsonb_build_object('version', st.version, 'saw_kerf_mm', st.saw_kerf_mm, 'density_kg_m3', st.density_kg_m3) end);
end;
$$;
revoke all on function private.ap10_cut_inputs(uuid, uuid, uuid[], uuid) from public, anon, authenticated;

create or replace function private.ap10_cut_row(x public.cut_combinations)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('id', x.id, 'status', x.status, 'die_id', x.die_id, 'die_number', (select die_number from public.dies where id = x.die_id),
    'machine_name', (select machine_name from public.machines where id = x.machine_id), 'usable_m', x.usable_m, 'kerf_mm', x.kerf_mm, 'billet_mm', x.billet_mm, 'patterns', x.patterns,
    'separate_pushes', x.separate_pushes, 'combined_pushes', x.combined_pushes, 'separate_recovery', x.separate_recovery, 'combined_recovery', x.combined_recovery,
    'jobs', x.inputs -> 'jobs', 'profile_code', x.inputs ->> 'profile_code',
    'created_by', (select full_name from public.app_users where id = x.created_by), 'created_at', x.created_at,
    'decided_by', (select full_name from public.app_users where id = x.decided_by), 'decided_at', x.decided_at, 'decision_note', x.decision_note,
    'stale', x.status in ('proposed', 'accepted') and x.inputs_fingerprint is distinct from md5(private.ap10_cut_inputs(x.company_id, x.die_id, x.job_ids, x.machine_id)::text))
$$;
revoke all on function private.ap10_cut_row(public.cut_combinations) from public, anon, authenticated;

create or replace function public.ap_cut_combine(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_die uuid; v_machine uuid; v_jobs uuid[]; v_in jsonb; x public.cut_combinations%rowtype; v_rows jsonb; v_total bigint; v_page integer := private.ap3_page(p_payload);
  v_usable numeric; v_kerf numeric; pat jsonb; cut jsonb; v_len numeric; v_used numeric; v_pushes integer := 0; v_sep integer; v_job jsonb; v_made integer;
  v_plan text[] := array['owner', 'admin', 'factory_manager', 'production_manager'];
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'factory_manager', 'production_manager', 'production']);
  if p_command = 'candidates' then
    perform private.ap_keys(p_payload, array['page']);
    with g as (select j.die_id, count(*) n, count(distinct coalesce(j.length_per_piece_m, j.cl_meter)) lengths, min(j.planned_date) first_day from public.production_jobs j
        where j.company_id = c.company_id and j.die_id is not null and j.status in ('planned', 'ready') and j.pieces > 0 and coalesce(j.length_per_piece_m, j.cl_meter) > 0
          and not exists (select 1 from public.production_push_events e where e.company_id = c.company_id and e.production_job_id = j.id)
        group by 1 having count(*) >= 2),
      f as (select g.*, row_number() over (order by g.first_day nulls last, g.die_id) k from g)
    select coalesce((select jsonb_agg(jsonb_build_object('die_id', f.die_id, 'die_number', d.die_number, 'profile_code', p.profile_code, 'jobs', f.n, 'cut_lengths', f.lengths, 'first_planned', f.first_day,
        'job_list', (select coalesce(jsonb_agg(to_jsonb(q) order by q.job_number), '[]') from private.ap10_cut_jobs(c.company_id, f.die_id) q),
        'live', (select jsonb_build_object('id', y.id, 'status', y.status, 'combined_recovery', y.combined_recovery, 'separate_recovery', y.separate_recovery)
          from public.cut_combinations y where y.company_id = c.company_id and y.die_id = f.die_id and y.status in ('proposed', 'accepted') order by y.created_at desc limit 1)) order by f.k)
      from f join public.dies d on d.id = f.die_id join public.aluminium_profiles p on p.id = d.profile_id where f.k > (v_page - 1) * 10 and f.k <= v_page * 10), '[]'),
      (select count(*) from f) into v_rows, v_total;
    return jsonb_build_object('rows', v_rows, 'page', v_page, 'total_count', v_total, 'can_plan', c.role = any(v_plan));
  elsif p_command = 'inputs' then
    perform private.ap_keys(p_payload, array['die_id', 'job_ids', 'machine_id']);
    v_die := private.ap_uuid(p_payload, 'die_id');
    if p_payload ? 'job_ids' then
      if jsonb_typeof(p_payload -> 'job_ids') <> 'array' or jsonb_array_length(p_payload -> 'job_ids') > 20 then raise exception 'AP: Invalid request.'; end if;
      select array_agg((j.value #>> '{}')::uuid) into v_jobs from jsonb_array_elements(p_payload -> 'job_ids') j;
    end if;
    v_in := private.ap10_cut_inputs(c.company_id, v_die, v_jobs, private.ap_uuid(p_payload, 'machine_id', false));
    if v_in is null then raise exception 'AP: Die not found.'; end if;
    return v_in || jsonb_build_object('fingerprint', md5(v_in::text),
      'presses', (select coalesce(jsonb_agg(jsonb_build_object('machine_id', m.id, 'machine_name', m.machine_name) order by m.machine_name), '[]') from public.machines m
        join public.press_billet_settings b on b.machine_id = m.id and b.company_id = c.company_id where m.company_id = c.company_id and m.machine_type = 'extrusion_press' and m.is_active));
  elsif p_command = 'record' then
    -- The pattern is computed by the server (lib/calculations/cut-combination). The database checks it against the jobs:
    -- every job gets exactly its pieces, no push is longer than the usable length, and combining never needs more pushes.
    perform private.ap4_need(c.role, v_plan);
    perform private.ap_keys(p_payload, array['die_id', 'machine_id', 'job_ids', 'fingerprint', 'usable_m', 'kerf_mm', 'billet_mm', 'patterns', 'separate_pushes', 'combined_pushes', 'separate_recovery', 'combined_recovery']);
    v_die := private.ap_uuid(p_payload, 'die_id'); v_machine := private.ap_uuid(p_payload, 'machine_id', false);
    if jsonb_typeof(p_payload -> 'job_ids') is distinct from 'array' or jsonb_array_length(p_payload -> 'job_ids') not between 2 and 20
      or jsonb_typeof(p_payload -> 'patterns') is distinct from 'array' or jsonb_array_length(p_payload -> 'patterns') not between 1 and 200 then raise exception 'AP: Choose at least two jobs of the die.'; end if;
    select array_agg(distinct (j.value #>> '{}')::uuid) into v_jobs from jsonb_array_elements(p_payload -> 'job_ids') j;
    v_in := private.ap10_cut_inputs(c.company_id, v_die, v_jobs, v_machine);
    if v_in is null then raise exception 'AP: Die not found.'; end if;
    if jsonb_array_length(v_in -> 'jobs') <> cardinality(v_jobs) or cardinality(v_jobs) <> jsonb_array_length(p_payload -> 'job_ids') then
      raise exception 'AP: A chosen job is no longer waiting on this die (it started, was cancelled or changed).';
    end if;
    if md5(v_in::text) is distinct from (p_payload ->> 'fingerprint') then raise exception 'AP: The jobs or the press settings changed since this pattern was prepared. Prepare it again.'; end if;
    v_usable := private.ap4_num(p_payload, 'usable_m', 'Usable length', 0.5, 200); v_kerf := private.ap4_num(p_payload, 'kerf_mm', 'Saw kerf', 0, 50);
    for pat in select value from jsonb_array_elements(p_payload -> 'patterns') loop
      if coalesce((pat ->> 'pushes')::integer, 0) < 1 or jsonb_typeof(pat -> 'cuts') is distinct from 'array' or jsonb_array_length(pat -> 'cuts') = 0 then raise exception 'AP: Invalid request.'; end if;
      v_used := 0; v_pushes := v_pushes + (pat ->> 'pushes')::integer;
      for cut in select value from jsonb_array_elements(pat -> 'cuts') loop
        v_job := null;
        select value into v_job from jsonb_array_elements(v_in -> 'jobs') where value ->> 'job_id' = cut ->> 'job_id';
        if v_job is null or coalesce((cut ->> 'pieces')::integer, 0) < 1 then raise exception 'AP: The pattern names a job that is not part of this combination.'; end if;
        v_len := (v_job ->> 'cut_length_m')::numeric;
        if abs(v_len - (cut ->> 'length_m')::numeric) > 0.0005 then raise exception 'AP: A cut length in the pattern differs from the job. Order lengths are never changed.'; end if;
        v_used := v_used + (cut ->> 'pieces')::integer * (v_len + v_kerf / 1000.0);
      end loop;
      if v_used - v_kerf / 1000.0 > v_usable + 0.001 then raise exception 'AP: A push in the pattern is longer than the usable length of % m.', trim_scale(v_usable); end if;
    end loop;
    for v_job in select value from jsonb_array_elements(v_in -> 'jobs') loop
      select coalesce(sum((pt.value ->> 'pushes')::integer * (ct.value ->> 'pieces')::integer), 0) into v_made
        from jsonb_array_elements(p_payload -> 'patterns') pt, jsonb_array_elements(pt.value -> 'cuts') ct where ct.value ->> 'job_id' = v_job ->> 'job_id';
      if v_made <> (v_job ->> 'pieces')::integer then
        raise exception 'AP: The pattern gives job % % pieces against % ordered. Order quantities are never changed.', v_job ->> 'job_number', v_made, v_job ->> 'pieces';
      end if;
    end loop;
    v_sep := private.ap9_int(p_payload, 'separate_pushes', 'Separate pushes', 1, 1000000);
    if v_sep is null or v_pushes <> private.ap9_int(p_payload, 'combined_pushes', 'Combined pushes', 1, 1000000) then raise exception 'AP: Invalid request.'; end if;
    if v_pushes > v_sep then raise exception 'AP: Combining these jobs does not save a push; plan them separately.'; end if;
    update public.cut_combinations set status = 'superseded' where company_id = c.company_id and die_id = v_die and status = 'proposed' and job_ids && v_jobs;
    insert into public.cut_combinations(company_id, die_id, machine_id, job_ids, usable_m, kerf_mm, billet_mm, patterns, separate_pushes, combined_pushes, separate_recovery, combined_recovery, inputs, inputs_fingerprint, created_by)
      values (c.company_id, v_die, (v_in ->> 'machine_id')::uuid, v_jobs, v_usable, v_kerf, private.ap4_num(p_payload, 'billet_mm', 'Billet length', 50, 3000, false), p_payload -> 'patterns', v_sep, v_pushes,
        private.ap4_num(p_payload, 'separate_recovery', 'Separate recovery', 0, 100), private.ap4_num(p_payload, 'combined_recovery', 'Combined recovery', 0, 100), v_in, md5(v_in::text), c.actor_id)
      returning * into x;
    return private.ap10_cut_row(x);
  elsif p_command in ('accept', 'cancel') then
    perform private.ap4_need(c.role, v_plan);
    perform private.ap_keys(p_payload, array['id', 'note']);
    select * into x from public.cut_combinations where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id for update;
    if x.id is null then raise exception 'AP: Combined pattern not found.'; end if;
    if p_command = 'cancel' then
      if x.status not in ('proposed', 'accepted') then raise exception 'AP: This pattern is already closed.'; end if;
      update public.cut_combinations set status = 'cancelled', decided_by = c.actor_id, decided_at = clock_timestamp(), decision_note = private.ap_text(p_payload ->> 'note', 'Reason', 3, 300) where id = x.id returning * into x;
      return private.ap10_cut_row(x);
    end if;
    if x.status <> 'proposed' then raise exception 'AP: This pattern is not waiting for acceptance.'; end if;
    if x.inputs_fingerprint is distinct from md5(private.ap10_cut_inputs(c.company_id, x.die_id, x.job_ids, x.machine_id)::text) then
      raise exception 'AP: The jobs or the press settings changed since this pattern was prepared. Prepare it again.';
    end if;
    update public.cut_combinations set status = 'superseded' where company_id = c.company_id and die_id = x.die_id and status = 'accepted' and job_ids && x.job_ids;
    update public.cut_combinations set status = 'accepted', decided_by = c.actor_id, decided_at = clock_timestamp(), decision_note = private.ap_text(p_payload ->> 'note', 'Note', 3, 300, false) where id = x.id returning * into x;
    return private.ap10_cut_row(x);
  elsif p_command = 'get' then
    perform private.ap_keys(p_payload, array['id']);
    select * into x from public.cut_combinations where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id;
    if x.id is null then raise exception 'AP: Combined pattern not found.'; end if;
    return private.ap10_cut_row(x) || jsonb_build_object('can_plan', c.role = any(v_plan));
  elsif p_command = 'job' then
    perform private.ap_keys(p_payload, array['job_id']);
    select * into x from public.cut_combinations y where y.company_id = c.company_id and y.status in ('proposed', 'accepted') and y.job_ids @> array[private.ap_uuid(p_payload, 'job_id')]
      order by (y.status = 'accepted') desc, y.created_at desc limit 1;
    return jsonb_build_object('combination', case when x.id is not null then private.ap10_cut_row(x) end);
  elsif p_command = 'list' then
    perform private.ap_keys(p_payload, array['page', 'status']);
    if coalesce(p_payload ->> 'status', 'all') not in ('proposed', 'accepted', 'superseded', 'cancelled', 'all') then raise exception 'AP: Invalid request.'; end if;
    with f as (select y.*, row_number() over (order by y.created_at desc, y.id) k from public.cut_combinations y
      where y.company_id = c.company_id and (coalesce(p_payload ->> 'status', 'all') = 'all' or y.status = p_payload ->> 'status'))
    select coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'status', f.status, 'die_number', (select die_number from public.dies where id = f.die_id), 'profile_code', f.inputs ->> 'profile_code',
        'jobs', cardinality(f.job_ids), 'separate_pushes', f.separate_pushes, 'combined_pushes', f.combined_pushes, 'separate_recovery', f.separate_recovery, 'combined_recovery', f.combined_recovery,
        'created_at', f.created_at, 'created_by', (select full_name from public.app_users where id = f.created_by)) order by f.k) from f where f.k > (v_page - 1) * 10 and f.k <= v_page * 10), '[]'),
      (select count(*) from f) into v_rows, v_total;
    return jsonb_build_object('rows', v_rows, 'page', v_page, 'total_count', v_total);
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_cut_combine(text, jsonb) from public, anon;
grant execute on function public.ap_cut_combine(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-070: a configurator project opened as a direct order (off until the owner confirms Omalco sells systems)
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.systems_order_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  enabled boolean not null default false,
  note text check (note is null or (length(btrim(note)) between 3 and 300 and note !~ '[[:cntrl:]]')),
  decided_by uuid not null references public.app_users(id),
  decided_at timestamptz not null default clock_timestamp()
);

create table if not exists public.system_order_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  configuration_id uuid not null unique references public.system_configurations(id),
  order_id uuid not null references public.orders(id),
  lines jsonb not null default '[]' check (jsonb_typeof(lines) = 'array'),
  configuration_updated boolean not null default false,
  linked_by uuid not null references public.app_users(id),
  linked_at timestamptz not null default clock_timestamp()
);
create index if not exists system_order_links_company_idx on public.system_order_links(company_id, linked_at desc);
create unique index if not exists system_order_links_order_key on public.system_order_links(order_id);

create or replace function public.ap_systems_order(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_on boolean; cfg public.system_configurations%rowtype; v_id uuid; v_order public.orders%rowtype; v_updated boolean := false; v_why text;
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'sales_manager', 'sales']);
  select enabled into v_on from public.systems_order_settings where company_id = c.company_id;
  v_on := coalesce(v_on, false);
  if p_command = 'settings' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return jsonb_build_object('enabled', v_on, 'can_decide', c.role in ('owner', 'admin'),
      'decision', (select jsonb_build_object('note', s.note, 'decided_by', (select full_name from public.app_users where id = s.decided_by), 'decided_at', s.decided_at)
        from public.systems_order_settings s where s.company_id = c.company_id));
  elsif p_command = 'save_settings' then
    perform private.ap4_need(c.role, array['owner', 'admin']);
    perform private.ap_keys(p_payload, array['enabled', 'note']);
    if jsonb_typeof(p_payload -> 'enabled') is distinct from 'boolean' then raise exception 'AP: Choose whether Omalco sells window and door systems.'; end if;
    insert into public.systems_order_settings(company_id, enabled, note, decided_by) values (c.company_id, (p_payload ->> 'enabled')::boolean, private.ap_text(p_payload ->> 'note', 'Note', 3, 300, false), c.actor_id)
      on conflict (company_id) do update set enabled = excluded.enabled, note = excluded.note, decided_by = excluded.decided_by, decided_at = clock_timestamp();
    return jsonb_build_object('enabled', (p_payload ->> 'enabled')::boolean);
  end if;
  if p_command not in ('draft', 'link', 'status') then raise exception 'AP: Unknown request.'; end if;
  perform private.ap_keys(p_payload, case when p_command = 'link' then array['configuration_id', 'order_id', 'lines'] else array['configuration_id'] end);
  v_id := private.ap_uuid(p_payload, 'configuration_id');
  select * into cfg from public.system_configurations where id = v_id and company_id = c.company_id;
  if cfg.id is null then raise exception 'AP: Configurator project not found.'; end if;
  if p_command = 'status' then
    return jsonb_build_object('enabled', v_on, 'order_id', cfg.order_id, 'status', cfg.status,
      'link', (select jsonb_build_object('order_id', l.order_id, 'order_number', (select order_number from public.orders where id = l.order_id), 'linked_at', l.linked_at,
        'linked_by', (select full_name from public.app_users where id = l.linked_by), 'configuration_updated', l.configuration_updated)
        from public.system_order_links l where l.configuration_id = cfg.id),
      'blocked', case when not v_on then 'Turned off: the owner has not confirmed that Omalco sells window and door systems.'
        when cfg.order_id is not null or exists (select 1 from public.system_order_links l where l.configuration_id = cfg.id) then 'This project already has an order.'
        when cfg.quote_id is not null then 'This project has a quotation; convert that quotation to an order.'
        when cfg.customer_id is null then 'Choose the customer on the project first.'
        when cfg.status::text in ('draft', 'cancelled', 'archived') then 'Calculate the project before ordering.' end);
  end if;
  if not v_on then raise exception 'AP: Ordering from configurator projects is turned off until the owner confirms that Omalco sells window and door systems.'; end if;
  if p_command = 'draft' then
    if cfg.order_id is not null or exists (select 1 from public.system_order_links l where l.configuration_id = cfg.id) then raise exception 'AP: This project already has an order.'; end if;
    if cfg.quote_id is not null then raise exception 'AP: This project has a quotation; convert that quotation to an order.'; end if;
    if cfg.customer_id is null then raise exception 'AP: Choose the customer on the project first.'; end if;
    if cfg.status::text in ('draft', 'cancelled', 'archived') then raise exception 'AP: Calculate the project before ordering.'; end if;
    return jsonb_build_object('configuration', jsonb_build_object('id', cfg.id, 'number', cfg.configuration_number, 'project_name', cfg.project_name, 'status', cfg.status, 'finish_type', cfg.finish_type,
        'width_mm', cfg.width_mm, 'height_mm', cfg.height_mm, 'quantity', cfg.quantity, 'location_label', cfg.location_label),
      'customer', (select jsonb_build_object('id', cu.id, 'customer_name', cu.customer_name, 'company_name', cu.company_name, 'gst_number', cu.gst_number, 'billing_address', cu.billing_address,
        'shipping_address', cu.shipping_address, 'state', cu.state) from public.customers cu where cu.id = cfg.customer_id and cu.company_id = c.company_id),
      'cuts', (select coalesce(jsonb_agg(jsonb_build_object('profile_id', k.profile_id, 'profile_code', k.profile_code, 'profile_name', k.profile_name, 'cut_length_mm', k.cut_length_mm, 'quantity', k.quantity,
          'stock_length_mm', k.stock_length_mm, 'kg_per_m', nullif(k.section_weight_kg_per_m, 0), 'component_role', k.component_role::text) order by k.sort_order, k.id), '[]')
        from public.system_profile_cuts k where k.configuration_id = cfg.id and k.company_id = c.company_id),
      'profiles', (select coalesce(jsonb_object_agg(p.id, jsonb_build_object('profile_code', p.profile_code, 'profile_name', p.profile_name, 'section_weight_kg_per_m', p.section_weight_kg_per_m,
          'hsn_code', p.hsn_code, 'is_active', p.is_active and p.deleted_at is null, 'free', private.ap10_profile_free(c.company_id, p.id))), '{}')
        from public.aluminium_profiles p where p.company_id = c.company_id and p.id in (select k.profile_id from public.system_profile_cuts k where k.configuration_id = cfg.id and k.profile_id is not null)),
      'hardware', (select coalesce(jsonb_agg(jsonb_build_object('item_code', h.item_code, 'item_name', h.item_name, 'category', h.hardware_category::text, 'quantity', h.quantity, 'unit', h.unit) order by h.item_code), '[]')
        from public.system_hardware_bom h where h.configuration_id = cfg.id and h.company_id = c.company_id),
      'materials', (select coalesce(jsonb_agg(jsonb_build_object('material_type', m.material_type::text, 'item_code', m.item_code, 'item_name', m.item_name, 'quantity', m.quantity, 'unit', m.unit) order by m.material_type::text, m.item_name), '[]')
        from public.system_material_summary m where m.configuration_id = cfg.id and m.company_id = c.company_id and m.material_type::text not in ('profile', 'hardware')));
  end if;
  -- link: the order was saved through the normal order entry; record it on the project.
  if jsonb_typeof(coalesce(p_payload -> 'lines', '[]')) <> 'array' or jsonb_array_length(coalesce(p_payload -> 'lines', '[]')) > 200 then raise exception 'AP: Invalid request.'; end if;
  select * into v_order from public.orders where id = private.ap_uuid(p_payload, 'order_id') and company_id = c.company_id and deleted_at is null;
  if v_order.id is null then raise exception 'AP: Order not found.'; end if;
  if v_order.customer_id is distinct from cfg.customer_id then raise exception 'AP: The order belongs to a different customer than the project.'; end if;
  if v_order.created_at < now() - interval '1 day' or v_order.created_at < cfg.created_at then raise exception 'AP: Only the order just saved from this project can be linked to it.'; end if;
  if exists (select 1 from public.system_order_links l where l.order_id = v_order.id) then raise exception 'AP: This order is already linked to a project.'; end if;
  if cfg.order_id is not null or exists (select 1 from public.system_order_links l where l.configuration_id = cfg.id) then raise exception 'AP: This project already has an order.'; end if;
  begin
    update public.system_configurations set order_id = v_order.id, status = 'converted_to_order', updated_at = now() where id = cfg.id;
    v_updated := true;
  exception when others then
    -- The project's own lifecycle rules decide whether its status may move; the link below is kept either way and says so.
    v_why := sqlerrm;
  end;
  insert into public.system_order_links(company_id, configuration_id, order_id, lines, configuration_updated, linked_by)
    values (c.company_id, cfg.id, v_order.id, coalesce(p_payload -> 'lines', '[]'), v_updated, c.actor_id);
  return jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number, 'configuration_updated', v_updated, 'reason', v_why);
end;
$$;
revoke all on function public.ap_systems_order(text, jsonb) from public, anon;
grant execute on function public.ap_systems_order(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-093: undo of low-risk actions. The inverse runs through the action's own authorised path; this records its use and
-- provides the one inverse that did not exist (marking the person's own notification unread again).
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.undo_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  kind text not null check (kind in ('task.status', 'saved_view.delete', 'saved_view.default', 'notification.read')),
  target text not null check (length(target) between 1 and 80),
  undone_at timestamptz not null default clock_timestamp()
);
create index if not exists undo_events_company_idx on public.undo_events(company_id, kind, undone_at desc);
create index if not exists undo_events_user_idx on public.undo_events(user_id);

create or replace function public.ap_undo(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_kind text; v_id uuid; v_n integer;
begin
  select * into c from private.ap_ctx(null);
  if p_command = 'record' then
    perform private.ap_keys(p_payload, array['kind', 'target']);
    v_kind := p_payload ->> 'kind';
    if v_kind is null or v_kind not in ('task.status', 'saved_view.delete', 'saved_view.default', 'notification.read') then raise exception 'AP: This action cannot be undone.'; end if;
    insert into public.undo_events(company_id, user_id, kind, target) values (c.company_id, c.actor_id, v_kind, private.ap_text(p_payload ->> 'target', 'Target', 1, 80));
    return jsonb_build_object('recorded', true);
  elsif p_command = 'notification_unread' then
    -- Only the person's own notification, and only within two minutes of reading it.
    perform private.ap_keys(p_payload, array['id']);
    v_id := private.ap_uuid(p_payload, 'id');
    update public.notifications set is_read = false, read_at = null, updated_at = now()
      where id = v_id and company_id = c.company_id and recipient_user_id = c.actor_id and is_read and read_at >= now() - interval '2 minutes';
    get diagnostics v_n = row_count;
    if v_n = 0 then raise exception 'AP: This notification can no longer be marked unread.'; end if;
    insert into public.undo_events(company_id, user_id, kind, target) values (c.company_id, c.actor_id, 'notification.read', v_id::text);
    return jsonb_build_object('unread', true);
  elsif p_command = 'summary' then
    perform private.ap4_need(c.role, array['owner', 'admin']);
    perform private.ap_keys(p_payload, array[]::text[]);
    return jsonb_build_object('days', 30, 'kinds', (select coalesce(jsonb_agg(jsonb_build_object('kind', q.kind, 'count', q.n) order by q.n desc), '[]')
      from (select kind, count(*) n from public.undo_events where company_id = c.company_id and undone_at >= now() - interval '30 days' group by 1) q));
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_undo(text, jsonb) from public, anon;
grant execute on function public.ap_undo(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-001 job: nightly make-to-stock suggestions
-- ---------------------------------------------------------------------------------------------------------------
alter function private.ap_job_registry() rename to ap10_previous_job_registry;
create function private.ap_job_registry() returns table(job_key text, schedule text, label text, description text)
language sql immutable set search_path = public, private as $$
  select * from private.ap10_previous_job_registry() union all values
    ('stock.make_to_stock', 'nightly', 'Suggest make-to-stock runs', 'Suggests runs of fast-moving profiles below their target stock when press capacity is free. Suggestions only; a planner approves.')
$$;
revoke all on function private.ap_job_registry() from public, anon, authenticated;

alter function private.ap_job_execute(uuid, text, uuid) rename to ap10_previous_job_execute;
create function private.ap_job_execute(p_company uuid, p_job text, p_run uuid) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if p_job = 'stock.make_to_stock' then return private.ap10_stock_suggest(p_company, p_run); end if;
  return private.ap10_previous_job_execute(p_company, p_job, p_run);
end;
$$;
revoke all on function private.ap_job_execute(uuid, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Row security: every new table is company-scoped and readable by its working roles; writes go through the gateways.
-- Undo events are readable only by the person who made them.
-- ---------------------------------------------------------------------------------------------------------------
do $$ declare t text; roles text; begin
  foreach t in array array['press_meter_readings', 'press_crew_sessions', 'profile_equivalents', 'profile_substitution_consents', 'stock_targets', 'stock_run_suggestions',
    'coating_line_settings', 'finishing_job_powder', 'coating_runs', 'cut_combinations', 'systems_order_settings', 'system_order_links'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    roles := case
      when t = 'press_meter_readings' then 'array[''owner'',''admin'',''factory_manager'',''production_manager'',''production'',''accounts'']'
      when t = 'press_crew_sessions' then 'array[''owner'',''admin'',''factory_manager'',''production_manager'',''production'',''quality'']'
      when t in ('profile_equivalents', 'profile_substitution_consents') then 'array[''owner'',''admin'',''sales_manager'',''sales'',''quality'',''production_manager'',''factory_manager'',''inventory_manager'']'
      when t in ('stock_targets', 'stock_run_suggestions') then 'array[''owner'',''admin'',''factory_manager'',''production_manager'',''sales_manager'',''inventory_manager'']'
      when t in ('coating_line_settings', 'finishing_job_powder', 'coating_runs') then 'array[''owner'',''admin'',''factory_manager'',''production_manager'',''production'',''quality'',''dispatch_manager'']'
      when t = 'cut_combinations' then 'array[''owner'',''admin'',''factory_manager'',''production_manager'',''production'']'
      else 'array[''owner'',''admin'',''sales_manager'',''sales'']' end;
    execute format('drop policy if exists ap10_read on public.%I', t);
    execute format('create policy ap10_read on public.%I for select to authenticated using (company_id = (select public.get_current_user_company_id()) and (select public.get_current_user_role()) = any(%s))', t, roles);
  end loop;
end $$;
alter table public.undo_events enable row level security;
revoke all on public.undo_events from public, anon, authenticated;
drop policy if exists ap10_own_undo on public.undo_events;
create policy ap10_own_undo on public.undo_events for select to authenticated using (company_id = (select public.get_current_user_company_id()) and user_id = (select auth.uid()));

commit;

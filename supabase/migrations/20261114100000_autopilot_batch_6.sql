-- Autopilot batch 6: AP-027, 030, 100, 033, 053, 077, 082, 029, 094 and 061.
-- Additive. Depends on batches 1-5 (including the batch 5 completion and correctness files). Nothing here posts stock,
-- money, quality approval or a customer message by itself: jobs prepare drafts and proposals; people confirm.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.ap6_bool(p_payload jsonb, p_key text, p_default boolean default false)
returns boolean language plpgsql immutable set search_path = public, private as $$
begin
  if p_payload ? p_key and jsonb_typeof(p_payload -> p_key) = 'boolean' then return (p_payload ->> p_key)::boolean; end if;
  if p_payload ? p_key and jsonb_typeof(p_payload -> p_key) <> 'null' then raise exception 'AP: Invalid request.'; end if;
  return p_default;
end;
$$;
revoke all on function private.ap6_bool(jsonb, text, boolean) from public, anon, authenticated;

create or replace function private.ap6_uuids(p_payload jsonb, p_key text, p_max integer)
returns uuid[] language plpgsql immutable set search_path = public, private as $$
declare v uuid[] := '{}'; e jsonb;
begin
  if not (p_payload ? p_key) or jsonb_typeof(p_payload -> p_key) = 'null' then return v; end if;
  if jsonb_typeof(p_payload -> p_key) <> 'array' or jsonb_array_length(p_payload -> p_key) > p_max then raise exception 'AP: Invalid request.'; end if;
  for e in select value from jsonb_array_elements(p_payload -> p_key) loop
    if jsonb_typeof(e) <> 'string' or (e #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'AP: Invalid identifier.'; end if;
    v := v || (e #>> '{}')::uuid;
  end loop;
  return v;
end;
$$;
revoke all on function private.ap6_uuids(jsonb, text, integer) from public, anon, authenticated;

-- Indian financial-year quarter: Apr-Jun = 1, Jul-Sep = 2, Oct-Dec = 3, Jan-Mar = 4.
create or replace function private.ap6_fy_quarter(p_day date)
returns integer language sql immutable set search_path = public, private as $$
  select ((extract(month from p_day)::integer + 8) % 12) / 3 + 1
$$;
revoke all on function private.ap6_fy_quarter(date) from public, anon, authenticated;

-- Deterministic UUID from text (for retry-safe child request identities).
create or replace function private.ap6_uuid_of(p text)
returns uuid language sql immutable set search_path = public, private as $$
  select (substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-4' || substr(h, 14, 3) || '-8' || substr(h, 18, 3) || '-' || substr(h, 21, 12))::uuid
  from (select md5(p) h) x
$$;
revoke all on function private.ap6_uuid_of(text) from public, anon, authenticated;

-- First active employee with one of the roles (oldest id first), for assigning prepared work.
create or replace function private.ap6_assignee(p_company uuid, p_roles text[], p_fallback uuid)
returns uuid language sql stable security definer set search_path = public, private as $$
  select coalesce((select u.id from public.app_users u where u.company_id = p_company and u.is_active and u.dealer_id is null
    and u.role = any(p_roles) order by array_position(p_roles, u.role), u.id limit 1), p_fallback)
$$;
revoke all on function private.ap6_assignee(uuid, text[], uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-027: section-weight drift from weighed bundles
-- ---------------------------------------------------------------------------------------------------------------
create table public.section_weight_settings (
  company_id uuid primary key references public.companies(id),
  tolerance_percent numeric(6,3) check (tolerance_percent is null or (tolerance_percent > 0 and tolerance_percent <= 25)),
  window_bundles integer not null default 10 check (window_bundles between 3 and 100),
  min_bundles integer not null default 3 check (min_bundles between 2 and 50),
  updated_by uuid not null references public.app_users(id), updated_at timestamptz not null default clock_timestamp(),
  check (min_bundles <= window_bundles)
);

-- Actual kg/m of each measured production bundle of a die: net weight / net length, newest first.
create or replace function private.ap6_die_points(p_company uuid, p_die uuid, p_limit integer)
returns table(bundle_id uuid, recorded_at timestamptz, bundle_number text, job_id uuid, job_number text, net_kg numeric, net_length_m numeric, kgm numeric)
language sql stable security definer set search_path = public, private as $$
  select b.id, b.recorded_at, b.bundle_number, j.id, j.job_number, round(b.gross_weight_kg - b.tare_weight_kg, 3), b.net_length_m,
    round((b.gross_weight_kg - b.tare_weight_kg) / b.net_length_m, 4)
  from public.prepared_physical_bundles b
  join public.production_jobs j on j.id = b.source_line_id and j.company_id = p_company
  where b.company_id = p_company and b.source_kind = 'production' and j.die_id = p_die
    and b.net_length_m > 0 and b.tare_weight_kg >= 0 and b.gross_weight_kg > b.tare_weight_kg
  order by b.recorded_at desc, b.id desc
  limit greatest(1, least(p_limit, 200))
$$;
revoke all on function private.ap6_die_points(uuid, uuid, integer) from public, anon, authenticated;

-- Drift of one die: the rolling average of the newest bundles against the profile master's theoretical kg/m.
create or replace function private.ap6_die_drift(p_company uuid, p_die uuid, p_points integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare d record; s public.section_weight_settings%rowtype; v_window integer; v_min integer; v_tol numeric; v_tol_source text;
  v_avg numeric; v_n integer; v_drift numeric; v_state text; v_points jsonb; v_last uuid; v_last_at timestamptz;
begin
  select di.id, di.die_number, di.die_status, p.id profile_id, p.profile_code, p.profile_name, p.section_weight_kg_per_m theo,
    p.weight_tolerance_percent tol into d
  from public.dies di left join public.aluminium_profiles p on p.id = di.profile_id and p.company_id = p_company
  where di.id = p_die and di.company_id = p_company;
  if d.id is null then return null; end if;
  select * into s from public.section_weight_settings where company_id = p_company;
  v_window := coalesce(s.window_bundles, 10); v_min := coalesce(s.min_bundles, 3);
  if d.tol is not null and d.tol > 0 then v_tol := d.tol; v_tol_source := 'profile';
  elsif s.tolerance_percent is not null then v_tol := s.tolerance_percent; v_tol_source := 'factory';
  else v_tol := null; v_tol_source := 'not_set'; end if;
  select round(avg(x.kgm), 4), count(*)::integer into v_avg, v_n from (select kgm from private.ap6_die_points(p_company, p_die, v_window)) x;
  select x.bundle_id, x.recorded_at into v_last, v_last_at from private.ap6_die_points(p_company, p_die, 1) x;
  select coalesce(jsonb_agg(jsonb_build_object('bundle_id', x.bundle_id, 'recorded_at', x.recorded_at, 'bundle_number', x.bundle_number,
      'job_id', x.job_id, 'job_number', x.job_number, 'net_kg', x.net_kg, 'net_length_m', x.net_length_m, 'kgm', x.kgm) order by x.recorded_at, x.bundle_id), '[]')
    into v_points from private.ap6_die_points(p_company, p_die, p_points) x;
  if d.theo is null or d.theo <= 0 then v_state := 'no_theoretical';
  elsif v_n < v_min then v_state := 'insufficient';
  else
    v_drift := round((v_avg - d.theo) / d.theo * 100, 3);
    v_state := case when v_tol is null then 'no_tolerance' when v_drift > v_tol then 'heavy' when v_drift < -v_tol then 'light' else 'within' end;
  end if;
  return jsonb_build_object('die_id', d.id, 'die_number', d.die_number, 'die_status', d.die_status, 'profile_id', d.profile_id, 'profile_code', d.profile_code,
    'profile_name', d.profile_name, 'theoretical_kgm', d.theo, 'tolerance_percent', v_tol, 'tolerance_source', v_tol_source, 'window_bundles', v_window,
    'min_bundles', v_min, 'bundles_used', v_n, 'actual_kgm', v_avg, 'drift_percent', v_drift, 'state', v_state, 'last_bundle_id', v_last,
    'last_bundle_at', v_last_at, 'points', v_points, 'rule', 'rolling-bundle-kgm-v1',
    'basis', 'Each production bundle: (gross - tare) / net length. Average of the newest ' || v_window || ' bundles of this die against the profile master.');
end;
$$;
revoke all on function private.ap6_die_drift(uuid, uuid, integer) from public, anon, authenticated;

create or replace function private.ap6_weight_job(p_company uuid, p_run uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare r record; v jsonb; v_id uuid; v_n integer := 0; v_p integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company::text || ':ap6-weight', 0));
  for r in select id from public.dies where company_id = p_company and deleted_at is null and die_status in ('active', 'approved') order by die_number, id loop
    v := private.ap6_die_drift(p_company, r.id, 1); v_n := v_n + 1;
    if v ->> 'state' not in ('heavy', 'light') then continue; end if;
    if exists (select 1 from public.proposals p where p.company_id = p_company and p.proposal_type = 'die.weight_drift' and p.target_key = r.id::text
      and p.status in ('accepted', 'edited') and exists (select 1 from public.tasks t where t.company_id = p_company and t.id = (p.outcome ->> 'task_id')::uuid
        and t.status not in ('completed', 'cancelled'))) then continue; end if;
    v_id := private.ap_proposal_create(p_company, 'die.weight_drift', r.id::text,
      'Section weight ' || (v ->> 'state') || ' on die ' || (v ->> 'die_number'),
      jsonb_build_object('die_id', r.id, 'profile_id', v -> 'profile_id', 'direction', v ->> 'state', 'drift_percent', v -> 'drift_percent',
        'actual_kgm', v -> 'actual_kgm', 'theoretical_kgm', v -> 'theoretical_kgm', 'route', 'inspect_die'),
      v - 'points', 'rolling-bundle-kgm-v1',
      'The average of the newest weighed bundles is ' || (v ->> 'drift_percent') || '% from the master weight; tolerance is ' || (v ->> 'tolerance_percent') || '%.',
      null, array['owner', 'admin', 'factory_manager', 'production_manager', 'quality'], 72, p_run);
    if v_id is not null then v_p := v_p + 1; end if;
  end loop;
  return jsonb_build_object('examined', v_n, 'proposals', v_p, 'alerts', 0);
end;
$$;
revoke all on function private.ap6_weight_job(uuid, uuid) from public, anon, authenticated;

create or replace function public.ap_weight(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_page integer := private.ap3_page(p_payload); v_search text := lower(coalesce(p_payload ->> 'search', '')); v_rows jsonb; v_total bigint; v_counts jsonb; v_show text;
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'factory_manager', 'production_manager', 'production', 'quality', 'sales_manager']);
  if p_command = 'die' then
    perform private.ap_keys(p_payload, array['die_id']);
    v_rows := private.ap6_die_drift(c.company_id, private.ap_uuid(p_payload, 'die_id'), 30);
    if v_rows is null then raise exception 'AP: Die not found.'; end if;
    return v_rows;
  elsif p_command = 'list' then
    perform private.ap_keys(p_payload, array['page', 'search', 'show', 'sort']);
    v_show := coalesce(p_payload ->> 'show', 'attention');
    with all_dies as (
      select private.ap6_die_drift(c.company_id, d.id, 12) v from public.dies d
      where d.company_id = c.company_id and d.deleted_at is null and d.die_status in ('active', 'approved')
    ), filtered as (
      select v, row_number() over (order by case v ->> 'state' when 'heavy' then 0 when 'light' then 0 when 'no_tolerance' then 1 when 'insufficient' then 2 when 'no_theoretical' then 3 else 4 end,
        case when p_payload ->> 'sort' = 'name' then v ->> 'die_number' end, abs(coalesce((v ->> 'drift_percent')::numeric, 0)) desc, v ->> 'die_number') k
      from all_dies
      where (v_search = '' or lower(coalesce(v ->> 'die_number', '') || ' ' || coalesce(v ->> 'profile_code', '')) like '%' || v_search || '%')
        and (v_show = 'all' or v ->> 'state' in ('heavy', 'light', 'no_tolerance', 'no_theoretical'))
    )
    select coalesce((select jsonb_agg(v order by k) from filtered where k > (v_page - 1) * 10 and k <= v_page * 10), '[]'), (select count(*) from filtered),
      (select jsonb_object_agg(s, n) from (select v ->> 'state' s, count(*) n from all_dies group by 1) q)
      into v_rows, v_total, v_counts;
    return jsonb_build_object('rows', v_rows, 'page', v_page, 'total_count', v_total, 'states', coalesce(v_counts, '{}'),
      'settings', (select to_jsonb(s) - 'company_id' - 'updated_by' from public.section_weight_settings s where s.company_id = c.company_id));
  elsif p_command = 'settings' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return coalesce((select to_jsonb(s) - 'company_id' - 'updated_by' from public.section_weight_settings s where s.company_id = c.company_id),
      jsonb_build_object('tolerance_percent', null, 'window_bundles', 10, 'min_bundles', 3));
  elsif p_command = 'save_settings' then
    perform private.ap4_need(c.role, array['owner', 'admin', 'quality', 'factory_manager']);
    perform private.ap_keys(p_payload, array['tolerance_percent', 'window_bundles', 'min_bundles']);
    insert into public.section_weight_settings(company_id, tolerance_percent, window_bundles, min_bundles, updated_by)
      values (c.company_id, private.ap4_num(p_payload, 'tolerance_percent', 'Tolerance', 0.1, 25, false),
        private.ap4_num(p_payload, 'window_bundles', 'Bundles averaged', 3, 100)::integer, private.ap4_num(p_payload, 'min_bundles', 'Minimum bundles', 2, 50)::integer, c.actor_id)
      on conflict (company_id) do update set tolerance_percent = excluded.tolerance_percent, window_bundles = excluded.window_bundles,
        min_bundles = excluded.min_bundles, updated_by = excluded.updated_by, updated_at = clock_timestamp();
    return jsonb_build_object('saved', true);
  elsif p_command = 'prepare' then
    perform private.ap4_need(c.role, array['owner', 'admin', 'quality', 'factory_manager', 'production_manager']);
    perform private.ap_keys(p_payload, array[]::text[]);
    return private.ap6_weight_job(c.company_id, null);
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_weight(text, jsonb) from public, anon;
grant execute on function public.ap_weight(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-030: reprice open drafts from the approved billet rate
-- ---------------------------------------------------------------------------------------------------------------
create table public.quote_reprice_runs (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  rate_day date not null, fingerprint text not null, quote_count integer not null, line_count integer not null,
  old_total numeric(14,2) not null, new_total numeric(14,2) not null, source text not null check (source in ('manual', 'proposal')),
  proposal_id uuid references public.proposals(id), excluded_quote_ids uuid[] not null default '{}',
  applied_by uuid not null references public.app_users(id), applied_at timestamptz not null default clock_timestamp()
);
create index quote_reprice_runs_company_idx on public.quote_reprice_runs(company_id, applied_at desc, id);
create table public.quote_reprice_lines (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  run_id uuid not null references public.quote_reprice_runs(id), quote_id uuid not null references public.quotes(id),
  quote_number text, customer_name text, quote_item_id uuid not null, item_label text, rate_id uuid references public.costing_rates(id),
  old_rate numeric(14,2), new_rate numeric(14,2) not null, old_line_total numeric(14,2), new_line_total numeric(14,2),
  old_grand_total numeric(14,2), new_grand_total numeric(14,2)
);
create index quote_reprice_lines_company_idx on public.quote_reprice_lines(company_id, run_id, quote_number, id);

-- Draft and internal-review quotations whose lines differ from today's approved billet rate.
-- New totals come from the canonical quote_items trigger in a rolled-back trial update, so no second formula exists.
create or replace function private.ap6_reprice_impact(p_company uuid)
returns jsonb language plpgsql volatile security definer set search_path = public, private as $$
declare v_today date := private.ist_today(); q record; l record; v_lines jsonb; v_drafts jsonb := '[]'; v_new numeric; v_old numeric; v_gst numeric;
  v_line_new jsonb; v_no_rate integer; v_sent jsonb; v_approved jsonb; v_fp jsonb := '[]'; v_rates jsonb; v_blocked text;
begin
  for q in select qu.id, qu.quote_number, qu.status, qu.updated_at, qu.grand_total, qu.gst_percent, coalesce(cu.company_name, cu.customer_name) customer, qu.customer_id
    from public.quotes qu left join public.customers cu on cu.id = qu.customer_id and cu.company_id = p_company
    where qu.company_id = p_company and qu.deleted_at is null and qu.status in ('draft', 'internal_review') order by qu.quote_number, qu.id loop
    v_lines := '[]'; v_no_rate := 0;
    for l in select i.id, i.billet_rate_per_kg old_rate, i.line_total_before_gst old_total, coalesce(p.profile_code, i.item_description, 'Line') label, p.alloy,
        (private.applicable_costing_rate(p_company, 'billet', 'per_kg', v_today, q.customer_id, p.alloy, null)).id rate_id,
        (private.applicable_costing_rate(p_company, 'billet', 'per_kg', v_today, q.customer_id, p.alloy, null)).rate new_rate
      from public.quote_items i left join public.aluminium_profiles p on p.id = i.profile_id and p.company_id = p_company
      where i.company_id = p_company and i.quote_id = q.id order by i.created_at, i.id loop
      if l.rate_id is null then v_no_rate := v_no_rate + 1; continue; end if;
      if l.old_rate is not distinct from l.new_rate then continue; end if;
      v_lines := v_lines || jsonb_build_object('quote_item_id', l.id, 'item_label', l.label, 'alloy', l.alloy, 'rate_id', l.rate_id,
        'old_rate', l.old_rate, 'new_rate', l.new_rate, 'old_line_total', l.old_total);
    end loop;
    if jsonb_array_length(v_lines) = 0 and v_no_rate = 0 then continue; end if;
    v_new := q.grand_total; v_line_new := '{}';
    if jsonb_array_length(v_lines) > 0 then
      -- Trial: the existing line and header triggers price the change; the block is always rolled back, including the
      -- cleared session identity that lets the owner-only cost guard accept a write that is never kept.
      begin
        perform set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);
        update public.quote_items i set billet_rate_per_kg = (x ->> 'new_rate')::numeric
          from jsonb_array_elements(v_lines) x where i.id = (x ->> 'quote_item_id')::uuid and i.company_id = p_company;
        select jsonb_object_agg(i.id::text, i.line_total_before_gst) into v_line_new from public.quote_items i where i.company_id = p_company and i.quote_id = q.id;
        select qu.grand_total into v_new from public.quotes qu where qu.id = q.id;
        raise exception using errcode = 'P0099', message = 'ap6 trial';
      exception when sqlstate 'P0099' then v_blocked := null;
        when others then v_blocked := regexp_replace(sqlerrm, '^AP: ', '');
      end;
      if v_blocked is not null then
        v_drafts := v_drafts || jsonb_build_object('quote_id', q.id, 'quote_number', q.quote_number, 'customer', q.customer, 'status', q.status, 'updated_at', q.updated_at,
          'lines', '[]'::jsonb, 'blocked_lines', v_lines, 'blocked', v_blocked, 'lines_without_rate', v_no_rate, 'old_grand_total', q.grand_total, 'new_grand_total', null, 'change', null);
        continue;
      end if;
      select jsonb_agg(x || jsonb_build_object('new_line_total', (v_line_new ->> (x ->> 'quote_item_id'))::numeric)) into v_lines from jsonb_array_elements(v_lines) x;
    end if;
    v_drafts := v_drafts || jsonb_build_object('quote_id', q.id, 'quote_number', q.quote_number, 'customer', q.customer, 'status', q.status,
      'updated_at', q.updated_at, 'lines', v_lines, 'lines_without_rate', v_no_rate, 'old_grand_total', q.grand_total, 'new_grand_total', v_new,
      'change', round(v_new - coalesce(q.grand_total, 0), 2));
    if jsonb_array_length(v_lines) > 0 then
      v_fp := v_fp || jsonb_build_array(q.id, q.updated_at, (select jsonb_agg(jsonb_build_array(x ->> 'quote_item_id', x -> 'old_rate', x -> 'new_rate', x ->> 'rate_id') order by x ->> 'quote_item_id') from jsonb_array_elements(v_lines) x));
    end if;
  end loop;
  -- Sent quotations within validity keep their bound rate; they are only listed.
  select coalesce(jsonb_agg(jsonb_build_object('quote_id', qu.id, 'quote_number', qu.quote_number, 'customer', coalesce(cu.company_name, cu.customer_name),
      'valid_until', qu.valid_until, 'sent_rate', b.rate, 'today_rate', r.rate, 'change_percent', case when b.rate > 0 then round((r.rate - b.rate) / b.rate * 100, 2) end)
      order by qu.valid_until, qu.quote_number), '[]') into v_sent
    from public.quotes qu join public.quote_rate_bindings b on b.quote_id = qu.id and b.company_id = p_company and b.rate_type = 'billet' and b.revision_number = qu.revision_number
      left join public.customers cu on cu.id = qu.customer_id and cu.company_id = p_company
      cross join lateral (select (private.applicable_costing_rate(p_company, 'billet', 'per_kg', v_today, qu.customer_id, null, null)).rate) r(rate)
    where qu.company_id = p_company and qu.deleted_at is null and qu.status = 'sent' and (qu.valid_until is null or qu.valid_until >= v_today)
      and r.rate is not null and r.rate is distinct from b.rate;
  select coalesce(jsonb_agg(jsonb_build_object('quote_id', qu.id, 'quote_number', qu.quote_number) order by qu.quote_number), '[]') into v_approved
    from public.quotes qu where qu.company_id = p_company and qu.deleted_at is null and qu.status = 'approved_for_sending'
      and exists (select 1 from public.quote_items i where i.quote_id = qu.id and i.company_id = p_company
        and i.billet_rate_per_kg is distinct from (private.applicable_costing_rate(p_company, 'billet', 'per_kg', v_today, qu.customer_id, null, null)).rate);
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'rate', r.rate, 'alloy', r.alloy, 'customer_specific', r.customer_id is not null, 'effective_from', r.effective_from) order by r.effective_from desc), '[]')
    into v_rates from public.costing_rates r where r.company_id = p_company and r.rate_type = 'billet' and r.basis = 'per_kg' and r.status = 'approved'
      and r.effective_from <= v_today and (r.effective_to is null or r.effective_to >= v_today);
  return jsonb_build_object('today', v_today, 'fingerprint', md5(v_fp::text), 'drafts', v_drafts, 'sent', v_sent, 'approved_unsent', v_approved, 'rates', v_rates,
    'quote_count', (select count(*) from jsonb_array_elements(v_drafts) x where jsonb_array_length(x -> 'lines') > 0),
    'line_count', (select coalesce(sum(jsonb_array_length(x -> 'lines')), 0) from jsonb_array_elements(v_drafts) x),
    'basis', 'Draft and internal-review quotations use today''s approved billet rate (customer-specific first, then alloy, then general). Sent quotations keep their bound rate.');
end;
$$;
revoke all on function private.ap6_reprice_impact(uuid) from public, anon, authenticated;

create or replace function private.ap6_reprice_apply(p_company uuid, p_actor uuid, p_fingerprint text, p_exclude uuid[], p_source text, p_proposal uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v jsonb; q jsonb; l jsonb; v_run uuid; v_sub numeric; v_profit numeric; v_low boolean; v_gst numeric; v_quotes integer := 0; v_lines integer := 0;
  v_old_total numeric := 0; v_new_total numeric := 0; v_qrow public.quotes%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company::text || ':ap6-reprice', 0));
  perform 1 from public.quotes where company_id = p_company and status in ('draft', 'internal_review') and deleted_at is null order by id for update;
  v := private.ap6_reprice_impact(p_company);
  if v ->> 'fingerprint' <> p_fingerprint then
    return jsonb_build_object('state', 'stale', 'message', 'Quotations or rates changed after the impact list was prepared. Review the new list.');
  end if;
  if (v ->> 'line_count')::integer = 0 then return jsonb_build_object('state', 'nothing', 'message', 'No draft needs repricing.'); end if;
  insert into public.quote_reprice_runs(company_id, rate_day, fingerprint, quote_count, line_count, old_total, new_total, source, proposal_id, excluded_quote_ids, applied_by)
    values (p_company, (v ->> 'today')::date, p_fingerprint, 0, 0, 0, 0, p_source, p_proposal, coalesce(p_exclude, '{}'), p_actor) returning id into v_run;
  for q in select x from jsonb_array_elements(v -> 'drafts') x where jsonb_array_length(x -> 'lines') > 0 and not ((x ->> 'quote_id')::uuid = any(coalesce(p_exclude, '{}'))) loop
    select * into v_qrow from public.quotes where id = (q ->> 'quote_id')::uuid and company_id = p_company;
    for l in select x from jsonb_array_elements(q -> 'lines') x loop
      update public.quote_items set billet_rate_per_kg = (l ->> 'new_rate')::numeric, updated_at = now()
        where id = (l ->> 'quote_item_id')::uuid and company_id = p_company and quote_id = v_qrow.id;
      insert into public.quote_reprice_lines(company_id, run_id, quote_id, quote_number, customer_name, quote_item_id, item_label, rate_id, old_rate, new_rate, old_line_total, new_line_total, old_grand_total, new_grand_total)
        values (p_company, v_run, v_qrow.id, v_qrow.quote_number, q ->> 'customer', (l ->> 'quote_item_id')::uuid, l ->> 'item_label', (l ->> 'rate_id')::uuid,
          (l ->> 'old_rate')::numeric, (l ->> 'new_rate')::numeric, (l ->> 'old_line_total')::numeric, (l ->> 'new_line_total')::numeric,
          (q ->> 'old_grand_total')::numeric, (q ->> 'new_grand_total')::numeric);
      v_lines := v_lines + 1;
    end loop;
    -- The existing quote triggers re-derive the header from the lines (derive_quote_header_financials).
    select grand_total into v_sub from public.quotes where id = v_qrow.id;
    v_quotes := v_quotes + 1; v_old_total := v_old_total + coalesce(v_qrow.grand_total, 0); v_new_total := v_new_total + coalesce(v_sub, 0);
  end loop;
  update public.quote_reprice_runs set quote_count = v_quotes, line_count = v_lines, old_total = v_old_total, new_total = v_new_total where id = v_run;
  return jsonb_build_object('state', 'applied', 'run_id', v_run, 'quotes', v_quotes, 'lines', v_lines, 'old_total', v_old_total, 'new_total', v_new_total);
end;
$$;
revoke all on function private.ap6_reprice_apply(uuid, uuid, text, uuid[], text, uuid) from public, anon, authenticated;

create or replace function private.ap6_reprice_job(p_company uuid, p_run uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v jsonb; v_id uuid;
begin
  v := private.ap6_reprice_impact(p_company);
  if (v ->> 'line_count')::integer = 0 then return jsonb_build_object('examined', jsonb_array_length(v -> 'drafts'), 'proposals', 0, 'alerts', 0); end if;
  v_id := private.ap_proposal_create(p_company, 'quote.reprice', 'drafts', 'Reprice ' || (v ->> 'quote_count') || ' draft quotation(s) to today''s billet rate',
    jsonb_build_object('fingerprint', v ->> 'fingerprint', 'quotes', (v ->> 'quote_count')::integer, 'lines', (v ->> 'line_count')::integer, 'rate_day', v ->> 'today'),
    jsonb_build_object('rates', v -> 'rates', 'sent_rate_moved', jsonb_array_length(v -> 'sent'), 'approved_unsent', jsonb_array_length(v -> 'approved_unsent')),
    'billet-rate-reprice-v1', 'Draft lines use a billet rate different from today''s approved rate. Sent quotations are not changed.', null,
    array['owner', 'admin'], 24, p_run);
  return jsonb_build_object('examined', jsonb_array_length(v -> 'drafts'), 'proposals', case when v_id is null then 0 else 1 end, 'alerts', 0);
end;
$$;
revoke all on function private.ap6_reprice_job(uuid, uuid) from public, anon, authenticated;

create or replace function public.ap_reprice(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_page integer := private.ap3_page(p_payload); v_rows jsonb; v_total bigint; r public.quote_reprice_runs%rowtype;
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'sales_manager', 'sales', 'accounts']);
  if p_command = 'impact' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return private.ap6_reprice_impact(c.company_id);
  elsif p_command = 'apply' then
    -- Priced quotation lines may be changed only by owners and admins (private.guard_quote_cost_writes).
    perform private.ap4_need(c.role, array['owner', 'admin']);
    perform private.ap_keys(p_payload, array['fingerprint', 'exclude_quote_ids']);
    if coalesce(p_payload ->> 'fingerprint', '') !~ '^[a-f0-9]{32}$' then raise exception 'AP: Invalid request.'; end if;
    return private.ap6_reprice_apply(c.company_id, c.actor_id, p_payload ->> 'fingerprint', private.ap6_uuids(p_payload, 'exclude_quote_ids', 200), 'manual', null);
  elsif p_command = 'runs' then
    perform private.ap_keys(p_payload, array['page']);
    select coalesce(jsonb_agg(to_jsonb(x) - 'k' order by x.k), '[]') into v_rows from (
      select r.id, r.rate_day, r.quote_count, r.line_count, r.old_total, r.new_total, r.source, r.applied_at, u.full_name applied_by, row_number() over (order by r.applied_at desc, r.id) k
      from public.quote_reprice_runs r left join public.app_users u on u.id = r.applied_by where r.company_id = c.company_id) x
      where x.k > (v_page - 1) * 10 and x.k <= v_page * 10;
    select count(*) into v_total from public.quote_reprice_runs where company_id = c.company_id;
    return jsonb_build_object('rows', v_rows, 'page', v_page, 'total_count', v_total);
  elsif p_command = 'run' then
    perform private.ap_keys(p_payload, array['id']);
    select * into r from public.quote_reprice_runs where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id;
    if r.id is null then raise exception 'AP: Reprice record not found.'; end if;
    return jsonb_build_object('run', to_jsonb(r) - 'company_id' || jsonb_build_object('applied_by_name', (select full_name from public.app_users where id = r.applied_by)),
      'lines', coalesce((select jsonb_agg(to_jsonb(l) - 'company_id' - 'run_id' order by l.quote_number, l.item_label, l.id) from public.quote_reprice_lines l where l.run_id = r.id and l.company_id = c.company_id), '[]'));
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_reprice(text, jsonb) from public, anon;
grant execute on function public.ap_reprice(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-100: system health read model
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.ap6_health(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare v_today date := private.ist_today(); v_day_start timestamptz := (private.ist_today()::timestamp at time zone 'Asia/Kolkata');
  v_jobs jsonb; v_props jsonb; v_exports jsonb; v_errors jsonb; v_cron jsonb := null; v_offline integer := 0;
begin
  select coalesce(jsonb_agg(jsonb_build_object('job_key', r.job_key, 'schedule', r.schedule, 'label', r.label,
      'last_status', l.status, 'last_started_at', l.started_at, 'last_error', l.error_message, 'last_success_at', s.finished_at,
      'failed_24h', coalesce(f.n, 0),
      'state', case when l.id is null then 'never_run' when l.status = 'failed' then 'failed'
        when s.finished_at is null or s.finished_at < now() - case r.schedule when 'hourly' then interval '2 hours' else interval '26 hours' end then 'overdue'
        when l.status = 'running' and l.started_at < now() - interval '30 minutes' then 'stuck' else 'ok' end)
      order by case when l.status = 'failed' then 0 else 1 end, r.schedule, r.job_key), '[]') into v_jobs
  from private.ap_job_registry() r
  left join lateral (select x.* from public.system_job_runs x where x.company_id = p_company and x.job_key = r.job_key order by x.started_at desc, x.id desc limit 1) l on true
  left join lateral (select x.finished_at from public.system_job_runs x where x.company_id = p_company and x.job_key = r.job_key and x.status = 'succeeded' order by x.finished_at desc limit 1) s on true
  left join lateral (select count(*) n from public.system_job_runs x where x.company_id = p_company and x.job_key = r.job_key and x.status = 'failed' and x.started_at > now() - interval '24 hours') f on true;
  select coalesce(jsonb_agg(jsonb_build_object('proposal_type', t, 'open', n, 'under_1_day', a, 'one_to_3_days', b, 'over_3_days', o, 'oldest_at', oldest) order by o desc, n desc), '[]') into v_props
  from (select proposal_type t, count(*) n, count(*) filter (where created_at > now() - interval '1 day') a,
      count(*) filter (where created_at <= now() - interval '1 day' and created_at > now() - interval '3 days') b,
      count(*) filter (where created_at <= now() - interval '3 days') o, min(created_at) oldest
    from public.proposals where company_id = p_company and status = 'open' group by proposal_type) q;
  v_exports := jsonb_build_object(
    'tally', (select jsonb_build_object('at', max(generated_at), 'count_30d', count(*) filter (where generated_at > now() - interval '30 days')) from public.tally_export_batches where company_id = p_company),
    'eway', (select jsonb_build_object('at', max(generated_at), 'count_30d', count(*) filter (where generated_at > now() - interval '30 days')) from public.eway_exports where company_id = p_company),
    'einvoice', (select jsonb_build_object('at', max(generated_at), 'count_30d', count(*) filter (where generated_at > now() - interval '30 days')) from public.einvoice_exports where company_id = p_company),
    'irn_import', (select jsonb_build_object('at', max(imported_at)) from public.invoice_irns where company_id = p_company),
    'tds_statement', (select jsonb_build_object('at', max(imported_at)) from public.tds_statement_imports where company_id = p_company));
  select count(*) into v_offline from public.offline_receipts where company_id = p_company and state = 'conflict' and resolved_at is null;
  v_errors := jsonb_build_object(
    'failed_job_runs_today', (select count(*) from public.system_job_runs where company_id = p_company and status = 'failed' and started_at >= v_day_start),
    'offline_conflicts_today', (select count(*) from public.offline_receipts where company_id = p_company and state = 'conflict' and received_at >= v_day_start),
    'offline_conflicts_open', v_offline);
  -- pg_cron run history, where the scheduler extension is installed (hosted Supabase); local replays have none.
  if to_regclass('cron.job_run_details') is not null and to_regclass('cron.job') is not null then
    begin
      execute $q$select coalesce(jsonb_agg(jsonb_build_object('job', j.jobname, 'schedule', j.schedule, 'active', j.active, 'last_status', d.status, 'last_start', d.start_time, 'last_message', left(d.return_message, 200)) order by j.jobname), '[]')
        from cron.job j left join lateral (select x.status, x.start_time, x.return_message from cron.job_run_details x where x.jobid = j.jobid order by x.start_time desc limit 1) d on true
        where j.jobname like 'autopilot-%'$q$ into v_cron;
    exception when others then v_cron := null;
    end;
  end if;
  return jsonb_build_object('as_of', clock_timestamp(), 'today', v_today, 'jobs', v_jobs, 'proposals', v_props, 'exports', v_exports, 'errors', v_errors,
    'scheduler', v_cron,
    'backups', jsonb_build_object('available', false, 'message', 'The database cannot read Supabase backup status. Check Project → Database → Backups in the Supabase dashboard.'),
    'summary', jsonb_build_object(
      'failed_jobs', (select count(*) from jsonb_array_elements(v_jobs) j where j ->> 'state' in ('failed', 'stuck')),
      'overdue_jobs', (select count(*) from jsonb_array_elements(v_jobs) j where j ->> 'state' in ('overdue', 'never_run')),
      'old_proposals', (select coalesce(sum((p ->> 'over_3_days')::integer), 0) from jsonb_array_elements(v_props) p)));
end;
$$;
revoke all on function private.ap6_health(uuid) from public, anon, authenticated;

create or replace function public.ap_health(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record;
begin
  select * into c from private.ap_ctx(array['owner', 'admin']);
  if p_command = 'overview' then perform private.ap_keys(p_payload, array[]::text[]); return private.ap6_health(c.company_id); end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_health(text, jsonb) from public, anon;
grant execute on function public.ap_health(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-033: reorder points from 90-day consumption
-- ---------------------------------------------------------------------------------------------------------------
create table public.reorder_policies (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  source_table text not null check (source_table in ('inventory_items', 'packaging_materials')), source_id uuid not null,
  lead_days integer check (lead_days is null or lead_days between 1 and 365), safety_days integer check (safety_days is null or safety_days between 0 and 365),
  review_days integer not null default 30 check (review_days between 1 and 180),
  approved_min numeric(14,3) check (approved_min is null or approved_min >= 0), approved_qty numeric(14,3) check (approved_qty is null or approved_qty > 0),
  approved_basis jsonb, approval_reason text, approved_by uuid references public.app_users(id), approved_at timestamptz,
  updated_by uuid not null references public.app_users(id), updated_at timestamptz not null default clock_timestamp(),
  unique (company_id, source_table, source_id), check ((approved_min is null) = (approved_qty is null)), check ((approved_min is null) = (approved_by is null))
);
create index reorder_policies_company_idx on public.reorder_policies(company_id, source_table, source_id);
create table public.purchase_requisitions (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  source_table text not null check (source_table in ('inventory_items', 'packaging_materials')), source_id uuid not null,
  item_label text not null, unit text, quantity numeric(14,3) not null check (quantity > 0), need_by date,
  status text not null default 'open' check (status in ('open', 'ordered', 'cancelled')), reference text, status_note text,
  proposal_id uuid references public.proposals(id), task_id uuid references public.tasks(id),
  created_by uuid not null references public.app_users(id), created_at timestamptz not null default clock_timestamp(),
  decided_by uuid references public.app_users(id), decided_at timestamptz
);
create index purchase_requisitions_company_idx on public.purchase_requisitions(company_id, status, created_at desc, id);
create unique index purchase_requisitions_one_open on public.purchase_requisitions(company_id, source_table, source_id) where status = 'open';

-- One consumable's consumption, stock and suggested levels. Unknown inputs stay null.
create or replace function private.ap6_reorder_row(p_company uuid, p_source text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare v_today date := private.ist_today(); v_label text; v_code text; v_unit text; v_stock numeric; v_current_level numeric; v_active boolean; v_first date;
  v_qty numeric; v_days integer; pol public.reorder_policies%rowtype; v_avg numeric; v_safety integer; v_min numeric; v_rq numeric; v_state text; v_open integer;
begin
  if p_source = 'inventory_items' then
    select item_name, item_code, unit, current_stock, reorder_level, is_active, created_at::date into v_label, v_code, v_unit, v_stock, v_current_level, v_active, v_first
      from public.inventory_items where id = p_id and company_id = p_company;
    select coalesce(sum(abs(quantity)) filter (where movement_type in ('production_issue', 'dispatch_out', 'scrap_out') and movement_date > v_today - 90), 0), least(v_first, min(movement_date))
      into v_qty, v_first from public.inventory_movements where company_id = p_company and inventory_item_id = p_id;
  elsif p_source = 'packaging_materials' then
    select material_name, material_code, unit, current_stock, reorder_level, is_active, created_at::date into v_label, v_code, v_unit, v_stock, v_current_level, v_active, v_first
      from public.packaging_materials where id = p_id and company_id = p_company;
    select coalesce(sum(m.quantity_required) filter (where (j.updated_at at time zone 'Asia/Kolkata')::date > v_today - 90), 0), least(v_first, min(j.created_at::date))
      into v_qty, v_first from public.packaging_job_materials m join public.packaging_jobs j on j.id = m.job_id and j.company_id = p_company and j.status = 'completed'
      where m.company_id = p_company and m.material_id = p_id;
  else raise exception 'AP: Invalid request.'; end if;
  if v_label is null then return null; end if;
  select * into pol from public.reorder_policies where company_id = p_company and source_table = p_source and source_id = p_id;
  v_days := greatest(0, least(90, v_today - coalesce(v_first, v_today)));
  select count(*) into v_open from public.purchase_requisitions where company_id = p_company and source_table = p_source and source_id = p_id and status = 'open';
  if v_days < 14 then v_state := 'insufficient_history';
  elsif v_qty = 0 then v_state := 'not_consumed';
  elsif pol.lead_days is null then v_state := 'lead_time_missing';
  else
    v_avg := v_qty / v_days;
    v_safety := coalesce(pol.safety_days, ceil(pol.lead_days / 2.0)::integer);
    v_min := ceil(v_avg * (pol.lead_days + v_safety) * 1000) / 1000;
    v_rq := ceil(v_avg * pol.review_days * 1000) / 1000;
    v_state := 'suggested';
  end if;
  return jsonb_build_object('source', p_source, 'id', p_id, 'label', v_label, 'code', v_code, 'unit', v_unit, 'stock', v_stock, 'active', v_active,
    'current_reorder_level', v_current_level, 'consumed_90d', v_qty, 'window_days', v_days, 'avg_daily', case when v_days > 0 then round(v_qty / v_days, 4) end,
    'lead_days', pol.lead_days, 'safety_days', coalesce(pol.safety_days, case when pol.lead_days is not null then ceil(pol.lead_days / 2.0)::integer end),
    'safety_basis', case when pol.safety_days is null and pol.lead_days is not null then 'Half the lead time (default until stores sets it)' end,
    'review_days', coalesce(pol.review_days, 30), 'suggested_min', v_min, 'suggested_qty', v_rq, 'state', v_state,
    'approved_min', pol.approved_min, 'approved_qty', pol.approved_qty, 'approved_at', pol.approved_at,
    'approved_by', (select full_name from public.app_users where id = pol.approved_by),
    'below_min', pol.approved_min is not null and v_stock <= pol.approved_min, 'open_requisitions', v_open,
    'differs', pol.approved_min is not null and v_min is not null and (pol.approved_min <> v_min or pol.approved_qty <> v_rq),
    'basis', case p_source when 'inventory_items' then 'Production issues, dispatch-out and scrap-out movements in the last 90 days'
      else 'Materials of packaging jobs completed in the last 90 days' end,
    'rule', 'reorder-90d-v1');
end;
$$;
revoke all on function private.ap6_reorder_row(uuid, text, uuid) from public, anon, authenticated;

create or replace function private.ap6_reorder_job(p_company uuid, p_run uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare p public.reorder_policies%rowtype; v jsonb; v_id uuid; v_n integer := 0; v_c integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company::text || ':ap6-reorder', 0));
  for p in select * from public.reorder_policies where company_id = p_company and approved_min is not null order by source_table, source_id loop
    v := private.ap6_reorder_row(p_company, p.source_table, p.source_id); v_n := v_n + 1;
    if v is null or not coalesce((v ->> 'active')::boolean, false) or not (v ->> 'below_min')::boolean or (v ->> 'open_requisitions')::integer > 0 then continue; end if;
    v_id := private.ap_proposal_create(p_company, 'stock.reorder', p.source_table || ':' || p.source_id,
      'Reorder ' || (v ->> 'label'), jsonb_build_object('source', p.source_table, 'item_id', p.source_id, 'item', v ->> 'label', 'unit', v ->> 'unit',
        'quantity', p.approved_qty, 'need_by', private.factory_add_working_days(p_company, private.ist_today(), coalesce(p.lead_days, 0))),
      v, 'approved-reorder-point-v1', 'Stock ' || (v ->> 'stock') || ' is at or below the approved reorder point ' || p.approved_min || '.', null,
      array['owner', 'admin', 'inventory_manager', 'factory_manager'], 48, p_run);
    if v_id is not null then v_c := v_c + 1; end if;
  end loop;
  return jsonb_build_object('examined', v_n, 'proposals', v_c, 'alerts', 0);
end;
$$;
revoke all on function private.ap6_reorder_job(uuid, uuid) from public, anon, authenticated;

create or replace function public.ap_reorder(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_page integer := private.ap3_page(p_payload); v_search text := lower(coalesce(p_payload ->> 'search', '')); v_rows jsonb; v_total bigint;
  v jsonb; v_source text; v_id uuid; v_min numeric; v_qty numeric; v_reason text; r public.purchase_requisitions%rowtype; v_cov jsonb; v_show text; v_kind text;
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'inventory_manager', 'factory_manager', 'production_manager', 'accounts']);
  if p_command = 'suggestions' then
    perform private.ap_keys(p_payload, array['page', 'search', 'show', 'kind', 'sort']);
    v_show := coalesce(p_payload ->> 'show', 'attention'); v_kind := coalesce(p_payload ->> 'kind', 'all');
    with items as (
      select private.ap6_reorder_row(c.company_id, 'inventory_items', i.id) rw from public.inventory_items i where i.company_id = c.company_id and i.is_active and v_kind in ('all', 'inventory')
      union all
      select private.ap6_reorder_row(c.company_id, 'packaging_materials', m.id) from public.packaging_materials m where m.company_id = c.company_id and m.is_active and v_kind in ('all', 'packaging')
    ), filtered as (
      select rw, row_number() over (order by case when (rw ->> 'below_min')::boolean then 0 when rw ->> 'approved_min' is null and rw ->> 'state' = 'suggested' then 1
        when (rw ->> 'differs')::boolean then 2 when rw ->> 'state' = 'lead_time_missing' then 3 else 4 end,
        case when p_payload ->> 'sort' = 'name' then rw ->> 'label' end, rw ->> 'label', rw ->> 'id') k
      from items where (v_search = '' or lower(coalesce(rw ->> 'label', '') || ' ' || coalesce(rw ->> 'code', '')) like '%' || v_search || '%')
        and (v_show = 'all' or (rw ->> 'below_min')::boolean or (rw ->> 'approved_min' is null and rw ->> 'state' in ('suggested', 'lead_time_missing')) or (rw ->> 'differs')::boolean)
    )
    select coalesce((select jsonb_agg(rw order by k) from filtered where k > (v_page - 1) * 10 and k <= v_page * 10), '[]'), (select count(*) from filtered),
      (select jsonb_build_object('active', count(*), 'approved', count(*) filter (where rw ->> 'approved_min' is not null), 'below_min', count(*) filter (where (rw ->> 'below_min')::boolean),
        'lead_time_missing', count(*) filter (where rw ->> 'state' = 'lead_time_missing'), 'not_consumed', count(*) filter (where rw ->> 'state' = 'not_consumed')) from items)
      into v_rows, v_total, v_cov;
    return jsonb_build_object('rows', v_rows, 'page', v_page, 'total_count', v_total, 'coverage', v_cov,
      'basis', 'Suggested reorder point = average daily use × (supplier lead time + safety days). Reorder quantity = average daily use × review days. Levels act only after stores approves them.');
  elsif p_command = 'save_lead' then
    perform private.ap4_need(c.role, array['owner', 'admin', 'inventory_manager']);
    perform private.ap_keys(p_payload, array['source', 'id', 'lead_days', 'safety_days', 'review_days']);
    v_source := p_payload ->> 'source'; v_id := private.ap_uuid(p_payload, 'id');
    if private.ap6_reorder_row(c.company_id, coalesce(v_source, ''), v_id) is null then raise exception 'AP: Item not found.'; end if;
    insert into public.reorder_policies(company_id, source_table, source_id, lead_days, safety_days, review_days, updated_by)
      values (c.company_id, v_source, v_id, private.ap4_num(p_payload, 'lead_days', 'Lead time', 1, 365)::integer, private.ap4_num(p_payload, 'safety_days', 'Safety days', 0, 365, false)::integer,
        coalesce(private.ap4_num(p_payload, 'review_days', 'Review days', 1, 180, false)::integer, 30), c.actor_id)
      on conflict (company_id, source_table, source_id) do update set lead_days = excluded.lead_days, safety_days = excluded.safety_days,
        review_days = excluded.review_days, updated_by = excluded.updated_by, updated_at = clock_timestamp();
    return jsonb_build_object('saved', true, 'row', private.ap6_reorder_row(c.company_id, v_source, v_id));
  elsif p_command = 'approve' then
    perform private.ap4_need(c.role, array['owner', 'admin', 'inventory_manager']);
    perform private.ap_keys(p_payload, array['source', 'id', 'min_level', 'reorder_qty', 'reason']);
    v_source := p_payload ->> 'source'; v_id := private.ap_uuid(p_payload, 'id');
    v := private.ap6_reorder_row(c.company_id, coalesce(v_source, ''), v_id);
    if v is null then raise exception 'AP: Item not found.'; end if;
    perform 1 from public.reorder_policies where company_id = c.company_id and source_table = v_source and source_id = v_id for update;
    v_min := private.ap4_num(p_payload, 'min_level', 'Reorder point', 0, 100000000); v_qty := private.ap4_num(p_payload, 'reorder_qty', 'Reorder quantity', 0.001, 100000000);
    v_reason := private.ap_text(p_payload ->> 'reason', 'Reason', 10, 300, false);
    if (v ->> 'suggested_min') is null and v_reason is null then raise exception 'AP: There is no calculated suggestion for this item. Give a reason for the level you set.'; end if;
    if (v ->> 'suggested_min') is not null and (v_min <> (v ->> 'suggested_min')::numeric or v_qty <> (v ->> 'suggested_qty')::numeric) and v_reason is null then
      raise exception 'AP: These levels differ from the suggestion. Give a reason.';
    end if;
    insert into public.reorder_policies(company_id, source_table, source_id, approved_min, approved_qty, approved_basis, approval_reason, approved_by, approved_at, updated_by)
      values (c.company_id, v_source, v_id, v_min, v_qty, v, v_reason, c.actor_id, clock_timestamp(), c.actor_id)
      on conflict (company_id, source_table, source_id) do update set approved_min = excluded.approved_min, approved_qty = excluded.approved_qty,
        approved_basis = excluded.approved_basis, approval_reason = excluded.approval_reason, approved_by = excluded.approved_by, approved_at = excluded.approved_at,
        updated_by = excluded.updated_by, updated_at = clock_timestamp();
    -- The item master's reorder level follows the approved point (reorder_level is not a guarded stock quantity).
    if v_source = 'inventory_items' then update public.inventory_items set reorder_level = v_min, updated_at = now() where id = v_id and company_id = c.company_id;
    else update public.packaging_materials set reorder_level = v_min, updated_at = now() where id = v_id and company_id = c.company_id; end if;
    return jsonb_build_object('approved', true, 'row', private.ap6_reorder_row(c.company_id, v_source, v_id));
  elsif p_command = 'requisitions' then
    perform private.ap_keys(p_payload, array['page', 'status']);
    select coalesce(jsonb_agg(to_jsonb(x) - 'k' - 'total' order by x.k), '[]'), coalesce(max(x.total), 0) into v_rows, v_total from (
      select r.id, r.source_table, r.source_id, r.item_label, r.unit, r.quantity, r.need_by, r.status, r.reference, r.status_note, r.created_at, u.full_name created_by_name,
        row_number() over (order by r.status = 'open' desc, r.need_by nulls last, r.created_at desc, r.id) k, count(*) over () total
      from public.purchase_requisitions r left join public.app_users u on u.id = r.created_by
      where r.company_id = c.company_id and (coalesce(p_payload ->> 'status', 'open') = 'all' or r.status = coalesce(p_payload ->> 'status', 'open'))) x
      where x.k > (v_page - 1) * 10 and x.k <= v_page * 10;
    return jsonb_build_object('rows', v_rows, 'page', v_page, 'total_count', v_total);
  elsif p_command = 'update_requisition' then
    perform private.ap4_need(c.role, array['owner', 'admin', 'inventory_manager', 'factory_manager']);
    perform private.ap_keys(p_payload, array['id', 'status', 'reference', 'note']);
    select * into r from public.purchase_requisitions where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id for update;
    if r.id is null then raise exception 'AP: Requisition not found.'; end if;
    if r.status <> 'open' then raise exception 'AP: This requisition is already %.', r.status; end if;
    if coalesce(p_payload ->> 'status', '') not in ('ordered', 'cancelled') then raise exception 'AP: Choose ordered or cancelled.'; end if;
    update public.purchase_requisitions set status = p_payload ->> 'status',
      reference = case when p_payload ->> 'status' = 'ordered' then private.ap_text(p_payload ->> 'reference', 'Purchase order reference', 2, 60) end,
      status_note = private.ap_text(p_payload ->> 'note', 'Note', 3, 300, p_payload ->> 'status' = 'cancelled'), decided_by = c.actor_id, decided_at = clock_timestamp()
      where id = r.id;
    if r.task_id is not null then update public.tasks set status = 'completed', completed_at = now(), updated_at = now() where id = r.task_id and company_id = c.company_id and status not in ('completed', 'cancelled'); end if;
    return jsonb_build_object('id', r.id, 'status', p_payload ->> 'status');
  elsif p_command = 'prepare' then
    perform private.ap4_need(c.role, array['owner', 'admin', 'inventory_manager', 'factory_manager']);
    perform private.ap_keys(p_payload, array[]::text[]);
    return private.ap6_reorder_job(c.company_id, null);
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_reorder(text, jsonb) from public, anon;
grant execute on function public.ap_reorder(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-053: draft NCRs from rejections and complaints
-- ---------------------------------------------------------------------------------------------------------------
create table public.ncr_settings (
  company_id uuid primary key references public.companies(id),
  job_reject_percent numeric(6,3) check (job_reject_percent is null or (job_reject_percent > 0 and job_reject_percent <= 100)),
  job_reject_kg numeric(14,3) check (job_reject_kg is null or job_reject_kg > 0),
  receipt_reject_percent numeric(6,3) check (receipt_reject_percent is null or (receipt_reject_percent > 0 and receipt_reject_percent <= 100)),
  updated_by uuid not null references public.app_users(id), updated_at timestamptz not null default clock_timestamp()
);
create table public.customer_complaints (
  id uuid primary key, company_id uuid not null references public.companies(id), customer_id uuid not null references public.customers(id),
  order_id uuid references public.orders(id), dispatch_id uuid references public.dispatches(id), description text not null,
  logged_by uuid not null references public.app_users(id), logged_at timestamptz not null default clock_timestamp(), fingerprint text not null, ncr_id uuid
);
create index customer_complaints_company_idx on public.customer_complaints(company_id, logged_at desc, id);
create table public.quality_ncrs (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), ncr_number text not null,
  status text not null default 'draft' check (status in ('draft', 'open', 'closed', 'dismissed')),
  source_kind text not null check (source_kind in ('job', 'receipt', 'complaint')), source_id uuid not null,
  production_job_id uuid references public.production_jobs(id), die_id uuid references public.dies(id), profile_id uuid references public.aluminium_profiles(id),
  order_id uuid references public.orders(id), customer_id uuid references public.customers(id), purchase_receipt_line_id uuid references public.purchase_receipt_lines(id),
  complaint_id uuid references public.customer_complaints(id), title text not null, rejected_qty numeric(14,3), checked_qty numeric(14,3), reject_percent numeric(7,3), unit text,
  threshold jsonb, evidence jsonb not null default '{}', description text, cause text, action text,
  created_by uuid references public.app_users(id), created_at timestamptz not null default clock_timestamp(),
  confirmed_by uuid references public.app_users(id), confirmed_at timestamptz, closed_by uuid references public.app_users(id), closed_at timestamptz,
  dismissed_by uuid references public.app_users(id), dismissed_at timestamptz, dismiss_reason text, updated_at timestamptz not null default clock_timestamp(),
  unique (company_id, source_kind, source_id), unique (company_id, ncr_number),
  check (status <> 'dismissed' or dismiss_reason is not null), check (status <> 'closed' or (cause is not null and action is not null))
);
create index quality_ncrs_company_idx on public.quality_ncrs(company_id, status, created_at desc, id);
alter table public.customer_complaints add constraint customer_complaints_ncr_fk foreign key (ncr_id) references public.quality_ncrs(id);

create or replace function private.ap6_ncr_number(p_company uuid)
returns text language plpgsql security definer set search_path = public, private as $$
declare v_fy text := private.ap_fy_label(private.ist_today()); v_n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company::text || ':ap6-ncr-number', 0));
  select count(*) + 1 into v_n from public.quality_ncrs where company_id = p_company and ncr_number like 'NCR/' || v_fy || '/%';
  return 'NCR/' || v_fy || '/' || lpad(v_n::text, 4, '0');
end;
$$;
revoke all on function private.ap6_ncr_number(uuid) from public, anon, authenticated;

-- Rejected and checked weight of one production job. The larger of the job's recorded rejection and the sum of rejected
-- inspections and rework rejections is used, so the same rejection is never counted twice.
create or replace function private.ap6_job_rejects(p_company uuid, p_job uuid)
returns table(rejected_kg numeric, checked_kg numeric)
language sql stable security definer set search_path = public, private as $$
  with j as (select * from public.production_jobs where id = p_job and company_id = p_company),
  insp as (select coalesce(sum(quantity_checked_kg) filter (where status = 'rejected' and resolution_id is null), 0) rej from public.quality_inspections where company_id = p_company and production_job_id = p_job),
  rw as (select coalesce(sum(rejected_weight_kg), 0) rej from public.quality_rework_resolutions where company_id = p_company and production_job_id = p_job)
  select greatest(coalesce(j.rejected_weight, 0), insp.rej + rw.rej), greatest(coalesce(j.actual_quantity_kg, 0), 0) + greatest(coalesce(j.rejected_weight, 0), insp.rej + rw.rej)
  from j, insp, rw
$$;
revoke all on function private.ap6_job_rejects(uuid, uuid) from public, anon, authenticated;

create or replace function private.ap6_job_evidence(p_company uuid, p_job uuid)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object(
    'billet_lots', coalesce((select jsonb_agg(jsonb_build_object('billet_id', fb.id, 'reference', coalesce(to_jsonb(fb) ->> 'billet_code', to_jsonb(fb) ->> 'batch_number', fb.id::text), 'issued_at', bi.issued_at) order by bi.issued_at)
      from public.production_billet_issues bi join public.foundry_billets fb on fb.id = bi.billet_id where bi.company_id = p_company and bi.production_job_id = p_job), '[]'),
    'inspections', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'status', q.status, 'checked_kg', q.quantity_checked_kg, 'hardness_webster', q.hardness_webster,
      'weight_per_meter_actual', q.weight_per_meter_actual, 'surface_finish_ok', q.surface_finish_ok, 'dimensional_variance', q.dimensional_variance, 'inspected_at', q.inspection_date) order by q.inspection_date)
      from public.quality_inspections q where q.company_id = p_company and q.production_job_id = p_job), '[]'),
    'sample_readings', coalesce((select jsonb_agg(jsonb_build_object('requirement_id', r.id, 'kind', r.kind, 'status', r.status, 'observed', s.observed, 'visual_ok', s.visual_ok, 'outcome', s.outcome, 'recorded_at', s.recorded_at) order by s.recorded_at)
      from public.qc_sample_requirements r join public.qc_sample_results s on s.requirement_id = r.id and s.company_id = p_company where r.company_id = p_company and r.production_job_id = p_job), '[]'))
$$;
revoke all on function private.ap6_job_evidence(uuid, uuid) from public, anon, authenticated;

create or replace function private.ap6_ncr_detect(p_company uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare s public.ncr_settings%rowtype; j record; rr record; v_n integer := 0; v_new integer := 0; v_pct numeric;
begin
  select * into s from public.ncr_settings where company_id = p_company;
  if s.company_id is null then return jsonb_build_object('examined', 0, 'proposals', 0, 'alerts', 0, 'details', jsonb_build_object('reason', 'QC has not set thresholds')); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company::text || ':ap6-ncr', 0));
  if s.job_reject_percent is not null or s.job_reject_kg is not null then
    for j in select pj.id, pj.job_number, pj.die_id, pj.profile_id, pj.order_id, o.customer_id, x.rejected_kg, x.checked_kg
      from public.production_jobs pj left join public.orders o on o.id = pj.order_id and o.company_id = p_company
        cross join lateral private.ap6_job_rejects(p_company, pj.id) x
      where pj.company_id = p_company and pj.status in ('in_progress', 'completed', 'on_hold') and pj.updated_at > now() - interval '60 days' and x.rejected_kg > 0 loop
      v_n := v_n + 1;
      v_pct := case when j.checked_kg > 0 then round(j.rejected_kg / j.checked_kg * 100, 3) end;
      if not ((s.job_reject_percent is not null and v_pct > s.job_reject_percent) or (s.job_reject_kg is not null and j.rejected_kg > s.job_reject_kg)) then continue; end if;
      insert into public.quality_ncrs(company_id, ncr_number, source_kind, source_id, production_job_id, die_id, profile_id, order_id, customer_id, title,
          rejected_qty, checked_qty, reject_percent, unit, threshold, evidence)
        select p_company, private.ap6_ncr_number(p_company), 'job', j.id, j.id, j.die_id, j.profile_id, j.order_id, j.customer_id,
          'Rejections above threshold on job ' || coalesce(j.job_number, j.id::text), j.rejected_kg, j.checked_kg, v_pct, 'kg',
          jsonb_build_object('job_reject_percent', s.job_reject_percent, 'job_reject_kg', s.job_reject_kg), private.ap6_job_evidence(p_company, j.id)
        where not exists (select 1 from public.quality_ncrs n where n.company_id = p_company and n.source_kind = 'job' and n.source_id = j.id);
      if found then v_new := v_new + 1; end if;
    end loop;
  end if;
  if s.receipt_reject_percent is not null then
    for rr in select l.id, l.received_quantity, l.rejected_quantity, l.note, pol.description, po.po_number, po.vendor_name_snapshot, r.receipt_date
      from public.purchase_receipt_lines l join public.purchase_receipts r on r.id = l.receipt_id and r.company_id = p_company
        left join public.purchase_order_lines pol on pol.id = l.purchase_order_line_id and pol.company_id = p_company
        left join public.purchase_orders po on po.id = l.purchase_order_id and po.company_id = p_company
      where l.company_id = p_company and l.rejected_quantity > 0 and l.received_quantity > 0 and r.receipt_date > private.ist_today() - 60 loop
      v_n := v_n + 1;
      v_pct := round(rr.rejected_quantity / rr.received_quantity * 100, 3);
      if v_pct <= s.receipt_reject_percent then continue; end if;
      insert into public.quality_ncrs(company_id, ncr_number, source_kind, source_id, purchase_receipt_line_id, title, rejected_qty, checked_qty, reject_percent, threshold, evidence)
        select p_company, private.ap6_ncr_number(p_company), 'receipt', rr.id, rr.id, 'Rejections above threshold on receipt of ' || coalesce(rr.description, 'purchased material'),
          rr.rejected_quantity, rr.received_quantity, v_pct, jsonb_build_object('receipt_reject_percent', s.receipt_reject_percent),
          jsonb_build_object('purchase_order', rr.po_number, 'supplier', rr.vendor_name_snapshot, 'receipt_date', rr.receipt_date, 'note', rr.note)
        where not exists (select 1 from public.quality_ncrs n where n.company_id = p_company and n.source_kind = 'receipt' and n.source_id = rr.id);
      if found then v_new := v_new + 1; end if;
    end loop;
  end if;
  return jsonb_build_object('examined', v_n, 'proposals', v_new, 'alerts', 0);
end;
$$;
revoke all on function private.ap6_ncr_detect(uuid) from public, anon, authenticated;

create or replace function private.ap6_ncr_row(n public.quality_ncrs)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select to_jsonb(n) - 'company_id' || jsonb_build_object(
    'job_number', (select job_number from public.production_jobs where id = n.production_job_id),
    'die_number', (select die_number from public.dies where id = n.die_id),
    'profile_code', (select profile_code from public.aluminium_profiles where id = n.profile_id),
    'order_number', (select order_number from public.orders where id = n.order_id),
    'customer', (select coalesce(company_name, customer_name) from public.customers where id = n.customer_id),
    'complaint', (select description from public.customer_complaints where id = n.complaint_id),
    'created_by_name', coalesce((select full_name from public.app_users where id = n.created_by), 'System'),
    'confirmed_by_name', (select full_name from public.app_users where id = n.confirmed_by),
    'closed_by_name', (select full_name from public.app_users where id = n.closed_by),
    'dismissed_by_name', (select full_name from public.app_users where id = n.dismissed_by))
$$;
revoke all on function private.ap6_ncr_row(public.quality_ncrs) from public, anon, authenticated;

create or replace function public.ap_ncr(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; n public.quality_ncrs%rowtype; v_page integer := private.ap3_page(p_payload); v_search text := lower(coalesce(p_payload ->> 'search', ''));
  v_rows jsonb; v_total bigint; v_id uuid; v_fp text; cc public.customer_complaints%rowtype; v_status text; v_order public.orders%rowtype; v_dispatch uuid; v_dorder uuid; v_dcustomer uuid; s public.ncr_settings%rowtype;
  qc text[] := array['owner', 'admin', 'quality', 'factory_manager'];
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'quality', 'factory_manager', 'production_manager', 'sales_manager', 'sales', 'dispatch_manager']);
  if p_command = 'log_complaint' then
    perform private.ap4_need(c.role, array['owner', 'admin', 'quality', 'factory_manager', 'sales_manager', 'sales', 'dispatch_manager']);
    perform private.ap_keys(p_payload, array['request_id', 'customer_id', 'order_id', 'dispatch_id', 'description']);
    v_id := private.ap_uuid(p_payload, 'request_id'); v_fp := md5((p_payload - 'request_id')::text);
    perform pg_advisory_xact_lock(hashtextextended(c.company_id::text || ':' || v_id::text, 0));
    select * into cc from public.customer_complaints where id = v_id and company_id = c.company_id;
    if cc.id is not null then
      if cc.fingerprint <> v_fp or cc.logged_by <> c.actor_id then raise exception 'AP: This retry has different details.'; end if;
      return jsonb_build_object('complaint_id', cc.id, 'ncr_id', cc.ncr_id, 'repeated', true);
    end if;
    if not exists (select 1 from public.customers where id = private.ap_uuid(p_payload, 'customer_id') and company_id = c.company_id and deleted_at is null) then raise exception 'AP: Customer not found.'; end if;
    if p_payload ? 'order_id' then
      select * into v_order from public.orders where id = private.ap_uuid(p_payload, 'order_id') and company_id = c.company_id;
      if v_order.id is null or v_order.customer_id <> (p_payload ->> 'customer_id')::uuid then raise exception 'AP: That order is not this customer''s.'; end if;
    end if;
    if p_payload ? 'dispatch_id' then
      select d.id, d.order_id, o.customer_id into v_dispatch, v_dorder, v_dcustomer from public.dispatches d join public.orders o on o.id = d.order_id and o.company_id = c.company_id
        where d.id = private.ap_uuid(p_payload, 'dispatch_id') and d.company_id = c.company_id;
      if v_dispatch is null or v_dcustomer <> (p_payload ->> 'customer_id')::uuid or (v_order.id is not null and v_dorder <> v_order.id) then
        raise exception 'AP: That dispatch is not this customer''s.';
      end if;
    end if;
    insert into public.customer_complaints(id, company_id, customer_id, order_id, dispatch_id, description, logged_by, fingerprint)
      values (v_id, c.company_id, (p_payload ->> 'customer_id')::uuid, coalesce(v_order.id, v_dorder), v_dispatch, private.ap_text(p_payload ->> 'description', 'Complaint', 10, 1000), c.actor_id, v_fp)
      returning * into cc;
    insert into public.quality_ncrs(company_id, ncr_number, source_kind, source_id, complaint_id, customer_id, order_id, title, description, evidence, created_by)
      values (c.company_id, private.ap6_ncr_number(c.company_id), 'complaint', cc.id, cc.id, cc.customer_id, cc.order_id, 'Customer complaint',
        cc.description, jsonb_build_object('dispatch_id', cc.dispatch_id,
          'jobs', coalesce((select jsonb_agg(jsonb_build_object('job_id', j.id, 'job_number', j.job_number, 'die_id', j.die_id)) from public.production_jobs j where j.company_id = c.company_id and j.order_id = cc.order_id), '[]')),
        c.actor_id) returning id into v_id;
    update public.customer_complaints set ncr_id = v_id where id = cc.id;
    return jsonb_build_object('complaint_id', cc.id, 'ncr_id', v_id);
  end if;
  perform private.ap4_need(c.role, array['owner', 'admin', 'quality', 'factory_manager', 'production_manager']);
  if p_command = 'settings' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return coalesce((select to_jsonb(x) - 'company_id' || jsonb_build_object('updated_by_name', (select full_name from public.app_users where id = x.updated_by)) from public.ncr_settings x where x.company_id = c.company_id), '{}'::jsonb);
  elsif p_command = 'save_settings' then
    perform private.ap4_need(c.role, array['owner', 'admin', 'quality']);
    perform private.ap_keys(p_payload, array['job_reject_percent', 'job_reject_kg', 'receipt_reject_percent']);
    insert into public.ncr_settings(company_id, job_reject_percent, job_reject_kg, receipt_reject_percent, updated_by)
      values (c.company_id, private.ap4_num(p_payload, 'job_reject_percent', 'Job rejection %', 0.01, 100, false), private.ap4_num(p_payload, 'job_reject_kg', 'Job rejection kg', 0.001, 1000000, false),
        private.ap4_num(p_payload, 'receipt_reject_percent', 'Receipt rejection %', 0.01, 100, false), c.actor_id)
      on conflict (company_id) do update set job_reject_percent = excluded.job_reject_percent, job_reject_kg = excluded.job_reject_kg,
        receipt_reject_percent = excluded.receipt_reject_percent, updated_by = excluded.updated_by, updated_at = clock_timestamp();
    return jsonb_build_object('saved', true);
  elsif p_command = 'list' then
    perform private.ap_keys(p_payload, array['page', 'status', 'search', 'sort']);
    v_status := coalesce(p_payload ->> 'status', 'attention');
    select coalesce(jsonb_agg(x.r order by x.k), '[]'), coalesce(max(x.total), 0) into v_rows, v_total from (
      select private.ap6_ncr_row(q) r, row_number() over (order by case q.status when 'draft' then 0 when 'open' then 1 else 2 end,
          case when p_payload ->> 'sort' = 'name' then q.ncr_number end, q.created_at desc, q.id) k, count(*) over () total
      from public.quality_ncrs q where q.company_id = c.company_id
        and (v_status = 'all' or (v_status = 'attention' and q.status in ('draft', 'open')) or q.status = v_status)
        and (v_search = '' or lower(q.ncr_number || ' ' || q.title || ' ' || coalesce(q.description, '')) like '%' || v_search || '%')) x
      where x.k > (v_page - 1) * 10 and x.k <= v_page * 10;
    return jsonb_build_object('rows', v_rows, 'page', v_page, 'total_count', v_total);
  elsif p_command = 'get' then
    perform private.ap_keys(p_payload, array['id']);
    select * into n from public.quality_ncrs where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id;
    if n.id is null then raise exception 'AP: NCR not found.'; end if;
    return private.ap6_ncr_row(n);
  elsif p_command = 'coverage' then
    perform private.ap_keys(p_payload, array[]::text[]);
    select * into s from public.ncr_settings where company_id = c.company_id;
    return jsonb_build_object('thresholds_set', s.company_id is not null,
      'jobs_above', (select count(*) from public.production_jobs pj cross join lateral private.ap6_job_rejects(c.company_id, pj.id) x
        where pj.company_id = c.company_id and pj.updated_at > now() - interval '60 days' and x.rejected_kg > 0
          and ((s.job_reject_percent is not null and x.checked_kg > 0 and x.rejected_kg / x.checked_kg * 100 > s.job_reject_percent) or (s.job_reject_kg is not null and x.rejected_kg > s.job_reject_kg))),
      'jobs_covered', (select count(*) from public.quality_ncrs where company_id = c.company_id and source_kind = 'job'),
      'drafts', (select count(*) from public.quality_ncrs where company_id = c.company_id and status = 'draft'),
      'open', (select count(*) from public.quality_ncrs where company_id = c.company_id and status = 'open'),
      'dismissed', (select count(*) from public.quality_ncrs where company_id = c.company_id and status = 'dismissed'),
      'complaints_30d', (select count(*) from public.customer_complaints where company_id = c.company_id and logged_at > now() - interval '30 days'));
  elsif p_command = 'detect' then
    perform private.ap4_need(c.role, qc);
    perform private.ap_keys(p_payload, array[]::text[]);
    return private.ap6_ncr_detect(c.company_id);
  end if;
  perform private.ap4_need(c.role, qc);
  perform private.ap_keys(p_payload, array['id', 'title', 'description', 'cause', 'action', 'reason']);
  select * into n from public.quality_ncrs where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id for update;
  if n.id is null then raise exception 'AP: NCR not found.'; end if;
  if p_command = 'confirm' then
    if n.status <> 'draft' then raise exception 'AP: This NCR is already %.', n.status; end if;
    update public.quality_ncrs set status = 'open', title = coalesce(private.ap_text(p_payload ->> 'title', 'Title', 5, 160, false), title),
      description = coalesce(private.ap_text(p_payload ->> 'description', 'Description', 5, 2000, false), description),
      confirmed_by = c.actor_id, confirmed_at = clock_timestamp(), updated_at = clock_timestamp() where id = n.id returning * into n;
  elsif p_command = 'dismiss' then
    if n.status <> 'draft' then raise exception 'AP: Only a draft NCR can be dismissed.'; end if;
    update public.quality_ncrs set status = 'dismissed', dismiss_reason = private.ap_text(p_payload ->> 'reason', 'Reason', 10, 500), dismissed_by = c.actor_id,
      dismissed_at = clock_timestamp(), updated_at = clock_timestamp() where id = n.id returning * into n;
  elsif p_command = 'update' then
    if n.status <> 'open' then raise exception 'AP: Confirm the NCR before recording cause and action.'; end if;
    update public.quality_ncrs set cause = coalesce(private.ap_text(p_payload ->> 'cause', 'Cause', 5, 2000, false), cause),
      action = coalesce(private.ap_text(p_payload ->> 'action', 'Corrective action', 5, 2000, false), action),
      description = coalesce(private.ap_text(p_payload ->> 'description', 'Description', 5, 2000, false), description), updated_at = clock_timestamp()
      where id = n.id returning * into n;
  elsif p_command = 'close' then
    if n.status <> 'open' then raise exception 'AP: Only an open NCR can be closed.'; end if;
    if n.cause is null or n.action is null then raise exception 'AP: Record the cause and the corrective action before closing.'; end if;
    update public.quality_ncrs set status = 'closed', closed_by = c.actor_id, closed_at = clock_timestamp(), updated_at = clock_timestamp() where id = n.id returning * into n;
  else raise exception 'AP: Unknown request.'; end if;
  return private.ap6_ncr_row(n);
end;
$$;
revoke all on function public.ap_ncr(text, jsonb) from public, anon;
grant execute on function public.ap_ncr(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-077: customer TDS deductions and quarterly reconciliation
-- ---------------------------------------------------------------------------------------------------------------
create table public.tds_settings (
  company_id uuid primary key references public.companies(id),
  sections text[] not null check (cardinality(sections) between 1 and 10),
  default_section text not null, default_rate_percent numeric(6,3) check (default_rate_percent is null or (default_rate_percent > 0 and default_rate_percent <= 30)),
  basis text not null default 'taxable' check (basis in ('taxable', 'gross')), tolerance_inr numeric(10,2) not null default 1 check (tolerance_inr between 0 and 1000),
  updated_by uuid not null references public.app_users(id), updated_at timestamptz not null default clock_timestamp(),
  check (default_section = any(sections))
);
create table public.customer_tax_profiles (
  company_id uuid not null references public.companies(id), customer_id uuid not null references public.customers(id),
  tan text check (tan is null or tan ~ '^[A-Z]{4}[0-9]{5}[A-Z]$'), pan text check (pan is null or pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  updated_by uuid not null references public.app_users(id), updated_at timestamptz not null default clock_timestamp(),
  primary key (company_id, customer_id)
);
create unique index customer_tax_profiles_tan on public.customer_tax_profiles(company_id, tan) where tan is not null;
create table public.tds_deductions (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  customer_id uuid not null references public.customers(id), invoice_id uuid not null references public.invoices(id),
  receipt_event_id uuid not null references public.financial_receipt_events(id), payment_id uuid not null references public.payments(id),
  section text not null, amount numeric(14,2) not null check (amount > 0), deducted_on date not null, fy text not null, quarter integer not null check (quarter between 1 and 4),
  certificate_ref text, status text not null default 'recorded' check (status in ('recorded', 'matched')), matched_line_id uuid,
  recorded_by uuid not null references public.app_users(id), recorded_at timestamptz not null default clock_timestamp(), unique (payment_id)
);
create index tds_deductions_company_idx on public.tds_deductions(company_id, customer_id, fy, quarter, id);
create table public.tds_statement_imports (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  file_name text not null, file_sha256 text not null check (file_sha256 ~ '^[a-f0-9]{64}$'), source_text text not null,
  row_count integer not null, unmatched_tan integer not null default 0,
  imported_by uuid not null references public.app_users(id), imported_at timestamptz not null default clock_timestamp(), unique (company_id, file_sha256)
);
create index tds_statement_imports_company_idx on public.tds_statement_imports(company_id, imported_at desc, id);
create table public.tds_statement_lines (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), import_id uuid not null references public.tds_statement_imports(id),
  row_number integer not null, tan text not null, deductor_name text, section text, transaction_date date not null, amount_credited numeric(14,2), tds_amount numeric(14,2) not null,
  booking_status text, customer_id uuid references public.customers(id), fy text not null, quarter integer not null, raw jsonb not null,
  match_status text not null default 'unmatched' check (match_status in ('matched', 'unmatched', 'unknown_tan', 'superseded'))
);
create index tds_statement_lines_company_idx on public.tds_statement_lines(company_id, customer_id, fy, quarter, id);
alter table public.tds_deductions add constraint tds_deductions_line_fk foreign key (matched_line_id) references public.tds_statement_lines(id);

-- A recorded deduction counts while its receipt stands; reversing the receipt (normal receipt workflow) removes it.
create or replace function private.ap6_tds_live(p_payment uuid)
returns boolean language sql stable security definer set search_path = public, private as $$
  select exists (select 1 from public.payments p where p.id = p_payment and p.reversed_at is null)
$$;
revoke all on function private.ap6_tds_live(uuid) from public, anon, authenticated;

create or replace function private.ap6_tds_rematch(p_company uuid, p_customer uuid, p_fy text, p_quarter integer)
returns void language plpgsql security definer set search_path = public, private as $$
declare l record; v_tol numeric := coalesce((select tolerance_inr from public.tds_settings where company_id = p_company), 1); v_d uuid;
begin
  update public.tds_deductions set status = 'recorded', matched_line_id = null where company_id = p_company and customer_id = p_customer and fy = p_fy and quarter = p_quarter;
  update public.tds_statement_lines set match_status = 'unmatched' where company_id = p_company and customer_id = p_customer and fy = p_fy and quarter = p_quarter and match_status = 'matched';
  for l in select * from public.tds_statement_lines where company_id = p_company and customer_id = p_customer and fy = p_fy and quarter = p_quarter and match_status = 'unmatched'
    order by transaction_date, row_number, id loop
    select d.id into v_d from public.tds_deductions d where d.company_id = p_company and d.customer_id = p_customer and d.fy = p_fy and d.quarter = p_quarter
      and d.status = 'recorded' and private.ap6_tds_live(d.payment_id) and abs(d.amount - l.tds_amount) <= v_tol and (l.section is null or d.section = l.section)
      order by abs(d.deducted_on - l.transaction_date), d.recorded_at, d.id limit 1;
    if v_d is not null then
      update public.tds_deductions set status = 'matched', matched_line_id = l.id where id = v_d;
      update public.tds_statement_lines set match_status = 'matched' where id = l.id;
    end if;
  end loop;
end;
$$;
revoke all on function private.ap6_tds_rematch(uuid, uuid, text, integer) from public, anon, authenticated;

create or replace function public.ap_tds(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; s public.tds_settings%rowtype; v_page integer := private.ap3_page(p_payload); v_rows jsonb; v_total bigint; v_id uuid; v_day date; v_section text;
  v_alloc jsonb := '[]'; v_sum numeric := 0; e jsonb; v_result jsonb; a jsonb; v_cust uuid; v_imp uuid; v_unknown integer := 0; v_n integer := 0; g record; v_fy text; v_q integer;
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'accounts']);
  select * into s from public.tds_settings where company_id = c.company_id;
  if p_command = 'settings' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return coalesce(to_jsonb(s) - 'company_id', '{}'::jsonb) || jsonb_build_object('configured', s.company_id is not null,
      'note', 'Sections, rates and the basis are set by accounts. The system records what the customer deducted; it does not give tax advice.');
  elsif p_command = 'save_settings' then
    perform private.ap_keys(p_payload, array['sections', 'default_section', 'default_rate_percent', 'basis', 'tolerance_inr']);
    if jsonb_typeof(p_payload -> 'sections') <> 'array' or exists (select 1 from jsonb_array_elements_text(p_payload -> 'sections') x where x !~ '^[0-9]{3}[A-Z]{0,2}$') then
      raise exception 'AP: Enter TDS sections such as 194Q.';
    end if;
    insert into public.tds_settings(company_id, sections, default_section, default_rate_percent, basis, tolerance_inr, updated_by)
      values (c.company_id, array(select distinct x from jsonb_array_elements_text(p_payload -> 'sections') x order by 1), private.ap_text(p_payload ->> 'default_section', 'Default section', 3, 6),
        private.ap4_num(p_payload, 'default_rate_percent', 'Rate', 0.001, 30, false), coalesce(p_payload ->> 'basis', 'taxable'), coalesce(private.ap4_num(p_payload, 'tolerance_inr', 'Tolerance', 0, 1000, false), 1), c.actor_id)
      on conflict (company_id) do update set sections = excluded.sections, default_section = excluded.default_section, default_rate_percent = excluded.default_rate_percent,
        basis = excluded.basis, tolerance_inr = excluded.tolerance_inr, updated_by = excluded.updated_by, updated_at = clock_timestamp();
    return jsonb_build_object('saved', true);
  elsif p_command = 'customer_tax' then
    perform private.ap_keys(p_payload, array['customer_id']);
    return coalesce((select to_jsonb(t) - 'company_id' from public.customer_tax_profiles t where t.company_id = c.company_id and t.customer_id = private.ap_uuid(p_payload, 'customer_id')), '{}'::jsonb);
  elsif p_command = 'save_customer_tax' then
    perform private.ap_keys(p_payload, array['customer_id', 'tan', 'pan']);
    v_cust := private.ap_uuid(p_payload, 'customer_id');
    if not exists (select 1 from public.customers where id = v_cust and company_id = c.company_id) then raise exception 'AP: Customer not found.'; end if;
    if coalesce(upper(p_payload ->> 'tan'), '') !~ '^([A-Z]{4}[0-9]{5}[A-Z])?$' then raise exception 'AP: TAN must look like PNEA12345B.'; end if;
    if coalesce(upper(p_payload ->> 'pan'), '') !~ '^([A-Z]{5}[0-9]{4}[A-Z])?$' then raise exception 'AP: PAN must look like ABCDE1234F.'; end if;
    insert into public.customer_tax_profiles(company_id, customer_id, tan, pan, updated_by)
      values (c.company_id, v_cust, nullif(upper(p_payload ->> 'tan'), ''), nullif(upper(p_payload ->> 'pan'), ''), c.actor_id)
      on conflict (company_id, customer_id) do update set tan = excluded.tan, pan = excluded.pan, updated_by = excluded.updated_by, updated_at = clock_timestamp();
    return jsonb_build_object('saved', true);
  elsif p_command = 'open_invoices' then
    perform private.ap_keys(p_payload, array['customer_id']);
    v_cust := private.ap_uuid(p_payload, 'customer_id');
    select coalesce(jsonb_agg(jsonb_build_object('invoice_id', i.id, 'invoice_number', i.invoice_number, 'invoice_date', i.invoice_date, 'subtotal', i.subtotal, 'grand_total', i.grand_total,
        'balance_due', i.balance_due, 'tds_recorded', coalesce((select sum(d.amount) from public.tds_deductions d where d.invoice_id = i.id and d.company_id = c.company_id and private.ap6_tds_live(d.payment_id)), 0),
        'suggested_tds', case when s.default_rate_percent is not null then round(case when s.basis = 'gross' then i.grand_total else i.subtotal end * s.default_rate_percent / 100, 2) end)
        order by i.invoice_date, i.invoice_number), '[]') into v_rows
      from public.invoices i where i.company_id = c.company_id and i.customer_id = v_cust and i.deleted_at is null and i.status in ('generated', 'sent', 'partially_paid', 'overdue') and i.balance_due > 0;
    return jsonb_build_object('rows', v_rows, 'settings', coalesce(to_jsonb(s) - 'company_id', '{}'::jsonb));
  elsif p_command = 'record' then
    perform private.ap_keys(p_payload, array['request_id', 'customer_id', 'deducted_on', 'section', 'certificate_ref', 'lines']);
    if s.company_id is null then raise exception 'AP: Accounts must set the TDS sections first.'; end if;
    v_id := private.ap_uuid(p_payload, 'request_id'); v_cust := private.ap_uuid(p_payload, 'customer_id'); v_day := private.ap4_day(p_payload, 'deducted_on');
    v_section := coalesce(p_payload ->> 'section', s.default_section);
    if not (v_section = any(s.sections)) then raise exception 'AP: Choose a configured TDS section.'; end if;
    if v_day > private.ist_today() then raise exception 'AP: The deduction date cannot be in the future.'; end if;
    if jsonb_typeof(p_payload -> 'lines') <> 'array' or jsonb_array_length(p_payload -> 'lines') not between 1 and 50 then raise exception 'AP: Enter TDS for at least one invoice.'; end if;
    for e in select value from jsonb_array_elements(p_payload -> 'lines') loop
      if not exists (select 1 from public.invoices where id = private.ap_uuid(e, 'invoice_id') and company_id = c.company_id and customer_id = v_cust) then
        raise exception 'AP: An invoice is not this customer''s.';
      end if;
      v_alloc := v_alloc || jsonb_build_object('invoice_id', e ->> 'invoice_id', 'amount', private.ap4_num(e, 'amount', 'TDS amount', 0.01, 100000000));
      v_sum := v_sum + (e ->> 'amount')::numeric;
    end loop;
    v_fy := private.ap_fy_label(v_day); v_q := private.ap6_fy_quarter(v_day);
    -- The canonical receipt writer settles the invoices; the TDS register links each resulting payment.
    v_result := private.post_financial_receipt_atomic(jsonb_build_object('amount', v_sum, 'payment_date', v_day, 'payment_method', 'other',
      'reference_number', 'TDS ' || v_section || ' ' || v_fy || ' Q' || v_q || ' ' || left(v_id::text, 8),
      'notes', 'TDS deducted by the customer (u/s ' || v_section || ')' || coalesce('; certificate ' || private.ap_text(p_payload ->> 'certificate_ref', 'Certificate', 3, 60, false), '')), v_alloc, v_id);
    for a in select value from jsonb_array_elements(v_result -> 'allocations') loop
      insert into public.tds_deductions(company_id, customer_id, invoice_id, receipt_event_id, payment_id, section, amount, deducted_on, fy, quarter, certificate_ref, recorded_by)
        values (c.company_id, v_cust, (a ->> 'invoice_id')::uuid, (v_result ->> 'receipt_id')::uuid, (a ->> 'payment_id')::uuid, v_section, (a ->> 'amount')::numeric,
          v_day, v_fy, v_q, nullif(btrim(coalesce(p_payload ->> 'certificate_ref', '')), ''), c.actor_id)
        on conflict (payment_id) do nothing;
    end loop;
    perform private.ap6_tds_rematch(c.company_id, v_cust, v_fy, v_q);
    return jsonb_build_object('receipt_id', v_result -> 'receipt_id', 'allocations', v_result -> 'allocations', 'repeated', coalesce((v_result ->> 'idempotent_replay')::boolean, false), 'fy', v_fy, 'quarter', v_q);
  elsif p_command = 'likely' then
    perform private.ap_keys(p_payload, array['page']);
    if s.company_id is null or s.default_rate_percent is null then return jsonb_build_object('rows', '[]'::jsonb, 'page', 1, 'total_count', 0, 'configured', false); end if;
    select coalesce(jsonb_agg(to_jsonb(x) - 'k' - 'total' order by x.k), '[]'), coalesce(max(x.total), 0) into v_rows, v_total from (
      select i.id invoice_id, i.invoice_number, i.invoice_date, i.customer_id, coalesce(cu.company_name, cu.customer_name) customer, i.balance_due, i.amount_paid,
        round(case when s.basis = 'gross' then i.grand_total else i.subtotal end * s.default_rate_percent / 100, 2) expected_tds,
        row_number() over (order by i.invoice_date, i.invoice_number) k, count(*) over () total
      from public.invoices i left join public.customers cu on cu.id = i.customer_id and cu.company_id = c.company_id
      where i.company_id = c.company_id and i.deleted_at is null and i.status in ('partially_paid', 'overdue', 'sent', 'generated') and i.balance_due > 0 and i.amount_paid > 0
        and abs(i.balance_due - round(case when s.basis = 'gross' then i.grand_total else i.subtotal end * s.default_rate_percent / 100, 2)) <= s.tolerance_inr
        and not exists (select 1 from public.tds_deductions d where d.invoice_id = i.id and d.company_id = c.company_id and private.ap6_tds_live(d.payment_id))) x
      where x.k > (v_page - 1) * 10 and x.k <= v_page * 10;
    return jsonb_build_object('rows', v_rows, 'page', v_page, 'total_count', v_total, 'configured', true,
      'basis', 'Part-paid invoices whose open balance equals the configured TDS on ' || s.basis || ' value (±' || s.tolerance_inr || ' INR) and have no TDS recorded.');
  elsif p_command = 'register' then
    perform private.ap_keys(p_payload, array['page', 'fy', 'quarter', 'customer_id', 'show']);
    select coalesce(jsonb_agg(to_jsonb(x) - 'k' - 'total' order by x.k), '[]'), coalesce(max(x.total), 0) into v_rows, v_total from (
      select gg.customer_id, coalesce(cu.company_name, cu.customer_name) customer, t.tan, gg.fy, gg.quarter, gg.recorded, gg.statement, round(gg.recorded - gg.statement, 2) difference,
        gg.unmatched_recorded, gg.unmatched_statement,
        case when gg.statement = 0 and gg.recorded > 0 then 'not_in_statement' when abs(gg.recorded - gg.statement) <= coalesce(s.tolerance_inr, 1) and gg.unmatched_recorded = 0 then 'matched'
          when gg.recorded > gg.statement then 'short_in_statement' else 'not_recorded' end state,
        row_number() over (order by gg.fy desc, gg.quarter desc, coalesce(cu.company_name, cu.customer_name)) k, count(*) over () total
      from (select customer_id, fy, quarter, sum(rec) recorded, sum(stm) statement, sum(ur) unmatched_recorded, sum(us) unmatched_statement from (
          select d.customer_id, d.fy, d.quarter, d.amount rec, 0 stm, (d.status = 'recorded')::int ur, 0 us from public.tds_deductions d where d.company_id = c.company_id and private.ap6_tds_live(d.payment_id)
          union all
          select l.customer_id, l.fy, l.quarter, 0, l.tds_amount, 0, (l.match_status = 'unmatched')::int from public.tds_statement_lines l where l.company_id = c.company_id and l.customer_id is not null and l.match_status in ('matched', 'unmatched')
        ) z group by customer_id, fy, quarter) gg
        left join public.customers cu on cu.id = gg.customer_id and cu.company_id = c.company_id
        left join public.customer_tax_profiles t on t.customer_id = gg.customer_id and t.company_id = c.company_id
      where (p_payload ->> 'fy' is null or gg.fy = p_payload ->> 'fy') and (p_payload ->> 'quarter' is null or gg.quarter = (p_payload ->> 'quarter')::integer)
        and (p_payload ->> 'customer_id' is null or gg.customer_id = private.ap_uuid(p_payload, 'customer_id'))) x
      where (coalesce(p_payload ->> 'show', 'all') = 'all' or x.state <> 'matched') and x.k > (v_page - 1) * 10 and x.k <= v_page * 10;
    return jsonb_build_object('rows', v_rows, 'page', v_page, 'total_count', v_total,
      'unknown_tan_lines', (select count(*) from public.tds_statement_lines where company_id = c.company_id and match_status = 'unknown_tan'));
  elsif p_command = 'deductions' then
    perform private.ap_keys(p_payload, array['page', 'customer_id', 'fy', 'quarter']);
    select coalesce(jsonb_agg(to_jsonb(x) - 'k' - 'total' order by x.k), '[]'), coalesce(max(x.total), 0) into v_rows, v_total from (
      select d.id, d.invoice_id, i.invoice_number, d.section, d.amount, d.deducted_on, d.fy, d.quarter, d.status, d.certificate_ref, d.recorded_at,
        row_number() over (order by d.deducted_on desc, d.id) k, count(*) over () total
      from public.tds_deductions d join public.invoices i on i.id = d.invoice_id and i.company_id = c.company_id
      where d.company_id = c.company_id and (p_payload ->> 'customer_id' is null or d.customer_id = private.ap_uuid(p_payload, 'customer_id'))
        and (p_payload ->> 'fy' is null or d.fy = p_payload ->> 'fy') and (p_payload ->> 'quarter' is null or d.quarter = (p_payload ->> 'quarter')::integer)) x
      where x.k > (v_page - 1) * 10 and x.k <= v_page * 10;
    return jsonb_build_object('rows', v_rows, 'page', v_page, 'total_count', v_total);
  elsif p_command = 'import_statement' then
    perform private.ap_keys(p_payload, array['file_name', 'file_sha256', 'source_text', 'rows']);
    if coalesce(p_payload ->> 'file_sha256', '') !~ '^[a-f0-9]{64}$' then raise exception 'AP: Invalid request.'; end if;
    if exists (select 1 from public.tds_statement_imports where company_id = c.company_id and file_sha256 = p_payload ->> 'file_sha256') then raise exception 'AP: This statement file was already imported.'; end if;
    if jsonb_typeof(p_payload -> 'rows') <> 'array' or jsonb_array_length(p_payload -> 'rows') not between 1 and 5000 then raise exception 'AP: The statement has no readable rows.'; end if;
    if length(coalesce(p_payload ->> 'source_text', '')) > 2000000 then raise exception 'AP: The statement file is too large.'; end if;
    insert into public.tds_statement_imports(company_id, file_name, file_sha256, source_text, row_count, imported_by)
      values (c.company_id, private.ap_text(p_payload ->> 'file_name', 'File name', 1, 200), p_payload ->> 'file_sha256', coalesce(p_payload ->> 'source_text', ''), jsonb_array_length(p_payload -> 'rows'), c.actor_id)
      returning id into v_imp;
    for e in select value from jsonb_array_elements(p_payload -> 'rows') loop
      v_n := v_n + 1; v_day := private.ap4_day(e, 'transaction_date');
      if coalesce(e ->> 'tan', '') !~ '^[A-Z]{4}[0-9]{5}[A-Z]$' then raise exception 'AP: Row %: the TAN is not readable.', v_n; end if;
      select customer_id into v_cust from public.customer_tax_profiles where company_id = c.company_id and tan = e ->> 'tan';
      if v_cust is null then v_unknown := v_unknown + 1; end if;
      -- A deduction already listed in an earlier statement for the same customer, date and amount is replaced by this one.
      update public.tds_statement_lines set match_status = 'superseded' where company_id = c.company_id and tan = e ->> 'tan' and transaction_date = v_day
        and tds_amount = (e ->> 'tds_amount')::numeric and coalesce(section, '') = coalesce(e ->> 'section', '') and import_id <> v_imp and match_status <> 'superseded';
      insert into public.tds_statement_lines(company_id, import_id, row_number, tan, deductor_name, section, transaction_date, amount_credited, tds_amount, booking_status, customer_id, fy, quarter, raw, match_status)
        values (c.company_id, v_imp, coalesce(nullif(e ->> 'row_number', '')::integer, v_n), e ->> 'tan', left(e ->> 'deductor_name', 200), nullif(e ->> 'section', ''), v_day,
          private.ap4_num(e, 'amount_credited', 'Amount credited', 0, 100000000000, false), private.ap4_num(e, 'tds_amount', 'Tax deducted', 0.01, 1000000000),
          left(e ->> 'booking_status', 20), v_cust, private.ap_fy_label(v_day), private.ap6_fy_quarter(v_day), e, case when v_cust is null then 'unknown_tan' else 'unmatched' end);
    end loop;
    update public.tds_statement_imports set unmatched_tan = v_unknown where id = v_imp;
    for g in select distinct customer_id, fy, quarter from public.tds_statement_lines where import_id = v_imp and customer_id is not null loop
      perform private.ap6_tds_rematch(c.company_id, g.customer_id, g.fy, g.quarter);
    end loop;
    return jsonb_build_object('import_id', v_imp, 'rows', v_n, 'unknown_tan', v_unknown,
      'matched', (select count(*) from public.tds_statement_lines where import_id = v_imp and match_status = 'matched'));
  elsif p_command = 'imports' then
    perform private.ap_keys(p_payload, array['page']);
    select coalesce(jsonb_agg(to_jsonb(x) - 'k' order by x.k), '[]') into v_rows from (
      select i.id, i.file_name, i.row_count, i.unmatched_tan, i.imported_at, u.full_name imported_by, row_number() over (order by i.imported_at desc, i.id) k
      from public.tds_statement_imports i left join public.app_users u on u.id = i.imported_by where i.company_id = c.company_id) x where x.k > (v_page - 1) * 10 and x.k <= v_page * 10;
    return jsonb_build_object('rows', v_rows, 'page', v_page, 'total_count', (select count(*) from public.tds_statement_imports where company_id = c.company_id));
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_tds(text, jsonb) from public, anon;
grant execute on function public.ap_tds(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-082: e-invoice export and IRN import
-- ---------------------------------------------------------------------------------------------------------------
create table public.einvoice_settings (
  company_id uuid primary key references public.companies(id), applicable boolean not null, applicable_from date,
  reason text not null, confirmed_by uuid not null references public.app_users(id), confirmed_at timestamptz not null default clock_timestamp(),
  check (not applicable or applicable_from is not null)
);
create table public.einvoice_exports (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), schema_version text not null,
  file_sha256 text not null check (file_sha256 ~ '^[a-f0-9]{64}$'), invoice_count integer not null check (invoice_count > 0),
  generated_by uuid not null references public.app_users(id), generated_at timestamptz not null default clock_timestamp()
);
create index einvoice_exports_company_idx on public.einvoice_exports(company_id, generated_at desc, id);
create table public.einvoice_export_items (
  export_id uuid not null references public.einvoice_exports(id), company_id uuid not null references public.companies(id),
  invoice_id uuid not null references public.invoices(id), doc_no text not null, primary key (export_id, invoice_id)
);
create index einvoice_export_items_company_idx on public.einvoice_export_items(company_id, invoice_id);
create table public.invoice_irns (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), invoice_id uuid not null references public.invoices(id),
  irn text not null check (irn ~ '^[0-9a-f]{64}$'), ack_no text not null check (ack_no ~ '^[0-9]{10,20}$'), ack_date timestamptz not null,
  signed_qr text not null check (length(signed_qr) between 20 and 8000), source_sha256 text not null,
  imported_by uuid not null references public.app_users(id), imported_at timestamptz not null default clock_timestamp()
);
create unique index invoice_irns_invoice on public.invoice_irns(company_id, invoice_id);
create unique index invoice_irns_irn on public.invoice_irns(company_id, irn);

create or replace function public.ap_einvoice(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; s public.einvoice_settings%rowtype; v_page integer := private.ap3_page(p_payload); v_rows jsonb; v_total bigint; v_ids uuid[]; v_id uuid; e jsonb;
  i public.invoices%rowtype; v_results jsonb := '[]'; v_n integer := 0; v_existing public.invoice_irns%rowtype; v_show text;
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'accounts']);
  select * into s from public.einvoice_settings where company_id = c.company_id;
  if p_command = 'settings' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return coalesce(to_jsonb(s) - 'company_id' || jsonb_build_object('confirmed_by_name', (select full_name from public.app_users where id = s.confirmed_by)), jsonb_build_object('applicable', null));
  elsif p_command = 'save_settings' then
    perform private.ap_keys(p_payload, array['applicable', 'applicable_from', 'reason']);
    if jsonb_typeof(p_payload -> 'applicable') <> 'boolean' then raise exception 'AP: Say whether e-invoicing applies.'; end if;
    insert into public.einvoice_settings(company_id, applicable, applicable_from, reason, confirmed_by)
      values (c.company_id, (p_payload ->> 'applicable')::boolean, private.ap4_day(p_payload, 'applicable_from', (p_payload ->> 'applicable')::boolean),
        private.ap_text(p_payload ->> 'reason', 'Reason', 10, 500), c.actor_id)
      on conflict (company_id) do update set applicable = excluded.applicable, applicable_from = excluded.applicable_from, reason = excluded.reason,
        confirmed_by = excluded.confirmed_by, confirmed_at = clock_timestamp();
    return jsonb_build_object('saved', true);
  end if;
  if p_command in ('queue', 'sources', 'record_export', 'import_irn') and not coalesce(s.applicable, false) then
    raise exception 'AP: Accounts has not confirmed that e-invoicing applies. Confirm applicability first.';
  end if;
  if p_command = 'queue' then
    perform private.ap_keys(p_payload, array['page', 'show', 'search']);
    v_show := coalesce(p_payload ->> 'show', 'pending');
    select coalesce(jsonb_agg(to_jsonb(x) - 'k' - 'total' order by x.k), '[]'), coalesce(max(x.total), 0) into v_rows, v_total from (
      select inv.id, inv.invoice_number, inv.invoice_date, inv.grand_total, coalesce(cu.company_name, cu.customer_name) customer, inv.customer_snapshot ->> 'gst_number' buyer_gstin,
        r.irn, r.ack_no, r.ack_date, (select max(x.generated_at) from public.einvoice_export_items ei join public.einvoice_exports x on x.id = ei.export_id where ei.invoice_id = inv.id and ei.company_id = c.company_id) exported_at,
        row_number() over (order by inv.invoice_date, inv.invoice_number) k, count(*) over () total
      from public.invoices inv left join public.customers cu on cu.id = inv.customer_id and cu.company_id = c.company_id
        left join public.invoice_irns r on r.invoice_id = inv.id and r.company_id = c.company_id
      where inv.company_id = c.company_id and inv.deleted_at is null and inv.status not in ('draft', 'cancelled') and inv.issued_at is not null and inv.invoice_date >= s.applicable_from
        and (v_show = 'all' or (v_show = 'pending' and r.id is null) or (v_show = 'with_irn' and r.id is not null))
        and (coalesce(p_payload ->> 'search', '') = '' or lower(inv.invoice_number || ' ' || coalesce(cu.company_name, cu.customer_name, '')) like '%' || lower(p_payload ->> 'search') || '%')) x
      where x.k > (v_page - 1) * 10 and x.k <= v_page * 10;
    return jsonb_build_object('rows', v_rows, 'page', v_page, 'total_count', v_total, 'applicable_from', s.applicable_from);
  elsif p_command = 'sources' then
    perform private.ap_keys(p_payload, array['invoice_ids']);
    v_ids := private.ap6_uuids(p_payload, 'invoice_ids', 100);
    if cardinality(v_ids) = 0 then raise exception 'AP: Choose invoices.'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('invoice_id', inv.id, 'invoice_number', inv.invoice_number, 'invoice_date', inv.invoice_date, 'status', inv.status,
        'supplier_state_code', inv.supplier_state_code, 'place_of_supply_state_code', inv.place_of_supply_state_code, 'subtotal', inv.subtotal, 'tax_total', inv.tax_total,
        'grand_total', inv.grand_total, 'cgst_amount', inv.cgst_amount, 'sgst_amount', inv.sgst_amount, 'utgst_amount', inv.utgst_amount, 'igst_amount', inv.igst_amount,
        'supplier', inv.supplier_snapshot, 'customer', inv.customer_snapshot, 'has_irn', exists (select 1 from public.invoice_irns r where r.invoice_id = inv.id and r.company_id = c.company_id),
        'items', coalesce((select jsonb_agg(jsonb_build_object('description', it.item_description, 'hsn_code', it.hsn_code, 'quantity', it.quantity, 'unit_rate', it.unit_rate,
          'line_total', it.line_total, 'gst_percent', it.gst_percent, 'line_kind', it.line_kind) order by it.created_at, it.id)
          from public.invoice_items it where it.invoice_id = inv.id and it.company_id = c.company_id), '[]')) order by inv.invoice_number), '[]') into v_rows
      from public.invoices inv where inv.company_id = c.company_id and inv.id = any(v_ids) and inv.deleted_at is null and inv.status not in ('draft', 'cancelled') and inv.issued_at is not null;
    return jsonb_build_object('invoices', v_rows);
  elsif p_command = 'record_export' then
    perform private.ap_keys(p_payload, array['schema_version', 'file_sha256', 'invoices']);
    if coalesce(p_payload ->> 'file_sha256', '') !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_payload -> 'invoices') <> 'array' or jsonb_array_length(p_payload -> 'invoices') not between 1 and 100 then
      raise exception 'AP: Invalid request.';
    end if;
    insert into public.einvoice_exports(company_id, schema_version, file_sha256, invoice_count, generated_by)
      values (c.company_id, private.ap_text(p_payload ->> 'schema_version', 'Schema', 1, 20), p_payload ->> 'file_sha256', jsonb_array_length(p_payload -> 'invoices'), c.actor_id) returning id into v_id;
    for e in select value from jsonb_array_elements(p_payload -> 'invoices') loop
      select * into i from public.invoices where id = private.ap_uuid(e, 'invoice_id') and company_id = c.company_id and status not in ('draft', 'cancelled') and issued_at is not null;
      if i.id is null or i.invoice_number <> e ->> 'doc_no' then raise exception 'AP: An exported invoice no longer matches its record.'; end if;
      insert into public.einvoice_export_items(export_id, company_id, invoice_id, doc_no) values (v_id, c.company_id, i.id, i.invoice_number);
    end loop;
    return jsonb_build_object('export_id', v_id);
  elsif p_command = 'import_irn' then
    perform private.ap_keys(p_payload, array['file_sha256', 'rows']);
    if coalesce(p_payload ->> 'file_sha256', '') !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_payload -> 'rows') <> 'array' or jsonb_array_length(p_payload -> 'rows') not between 1 and 500 then
      raise exception 'AP: Invalid request.';
    end if;
    for e in select value from jsonb_array_elements(p_payload -> 'rows') loop
      v_n := v_n + 1;
      select * into i from public.invoices where company_id = c.company_id and invoice_number = e ->> 'doc_no' and deleted_at is null and status not in ('draft', 'cancelled') and issued_at is not null;
      if i.id is null then v_results := v_results || jsonb_build_object('row', v_n, 'doc_no', e ->> 'doc_no', 'state', 'not_found', 'message', 'No issued invoice has this number.'); continue; end if;
      if coalesce(e ->> 'irn', '') !~ '^[0-9a-f]{64}$' or coalesce(e ->> 'ack_no', '') !~ '^[0-9]{10,20}$' or length(coalesce(e ->> 'signed_qr', '')) not between 20 and 8000 then
        v_results := v_results || jsonb_build_object('row', v_n, 'doc_no', e ->> 'doc_no', 'state', 'invalid', 'message', 'IRN, acknowledgement number or signed QR is missing or malformed.'); continue;
      end if;
      select * into v_existing from public.invoice_irns where company_id = c.company_id and (invoice_id = i.id or irn = e ->> 'irn');
      if v_existing.id is not null then
        v_results := v_results || jsonb_build_object('row', v_n, 'doc_no', e ->> 'doc_no', 'state',
          case when v_existing.invoice_id = i.id and v_existing.irn = e ->> 'irn' then 'already_recorded' else 'conflict' end,
          'message', case when v_existing.invoice_id = i.id and v_existing.irn = e ->> 'irn' then 'Already recorded.' else 'A different IRN is already recorded for this invoice, or this IRN belongs to another invoice.' end);
        continue;
      end if;
      insert into public.invoice_irns(company_id, invoice_id, irn, ack_no, ack_date, signed_qr, source_sha256, imported_by)
        values (c.company_id, i.id, e ->> 'irn', e ->> 'ack_no', (e ->> 'ack_date')::timestamptz, e ->> 'signed_qr', p_payload ->> 'file_sha256', c.actor_id);
      v_results := v_results || jsonb_build_object('row', v_n, 'doc_no', e ->> 'doc_no', 'state', 'recorded', 'invoice_id', i.id);
    end loop;
    return jsonb_build_object('results', v_results, 'recorded', (select count(*) from jsonb_array_elements(v_results) r where r ->> 'state' = 'recorded'));
  elsif p_command = 'irn' then
    perform private.ap_keys(p_payload, array['invoice_id']);
    return coalesce((select jsonb_build_object('irn', r.irn, 'ack_no', r.ack_no, 'ack_date', r.ack_date, 'signed_qr', r.signed_qr, 'imported_at', r.imported_at)
      from public.invoice_irns r where r.company_id = c.company_id and r.invoice_id = private.ap_uuid(p_payload, 'invoice_id')), '{}'::jsonb);
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_einvoice(text, jsonb) from public, anon;
grant execute on function public.ap_einvoice(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-029: billet length per job (press limits + recorded planner choice; the optimiser is lib/calculations/billet-length.ts)
-- ---------------------------------------------------------------------------------------------------------------
create table public.press_billet_settings (
  company_id uuid not null references public.companies(id), machine_id uuid not null references public.machines(id),
  min_billet_mm numeric(8,1) not null check (min_billet_mm > 0), max_billet_mm numeric(8,1) not null, standard_billet_mm numeric(8,1),
  container_diameter_mm numeric(7,2) check (container_diameter_mm is null or container_diameter_mm > 0), butt_mm numeric(7,1) not null check (butt_mm >= 0),
  runout_m numeric(7,2) not null check (runout_m > 0), front_crop_m numeric(6,3) not null default 0 check (front_crop_m >= 0),
  back_crop_m numeric(6,3) not null default 0 check (back_crop_m >= 0), step_mm numeric(6,1) not null default 10 check (step_mm between 1 and 200),
  updated_by uuid not null references public.app_users(id), updated_at timestamptz not null default clock_timestamp(),
  primary key (company_id, machine_id), check (max_billet_mm > min_billet_mm), check (standard_billet_mm is null or standard_billet_mm between min_billet_mm and max_billet_mm)
);
create table public.job_billet_length_choices (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), production_job_id uuid not null references public.production_jobs(id),
  machine_id uuid not null references public.machines(id), chosen_mm numeric(8,1) not null, recommended_mm numeric(8,1) not null, standard_mm numeric(8,1),
  chosen_recovery numeric(7,3), recommended_recovery numeric(7,3), standard_recovery numeric(7,3), options jsonb not null, inputs jsonb not null, inputs_fingerprint text not null,
  chosen_by uuid not null references public.app_users(id), chosen_at timestamptz not null default clock_timestamp(), superseded_at timestamptz
);
create index job_billet_length_choices_company_idx on public.job_billet_length_choices(company_id, production_job_id, chosen_at desc);
create unique index job_billet_length_choices_current on public.job_billet_length_choices(company_id, production_job_id) where superseded_at is null;

create or replace function private.ap6_billet_inputs(p_company uuid, p_job uuid)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('job_id', j.id, 'job_number', j.job_number, 'status', j.status, 'machine_id', j.machine_id,
    'kg_per_m', coalesce(j.section_weight_kg_per_m, p.section_weight_kg_per_m), 'cut_length_m', coalesce(j.length_per_piece_m, j.cl_meter),
    'billet_diameter_mm', coalesce(p.billet_diameter_mm, p.billet_diameter_required_inch * 25.4, d.billet_diameter_required_inch * 25.4),
    'extrusion_ratio', d.extrusion_ratio, 'die_number', d.die_number, 'profile_code', p.profile_code, 'alloy', p.alloy, 'planned_quantity_kg', j.planned_quantity_kg,
    'presses', coalesce((select jsonb_agg(jsonb_build_object('machine_id', m.id, 'machine_name', m.machine_name, 'min_billet_mm', b.min_billet_mm, 'max_billet_mm', b.max_billet_mm,
      'standard_billet_mm', b.standard_billet_mm, 'container_diameter_mm', b.container_diameter_mm, 'butt_mm', b.butt_mm, 'runout_m', b.runout_m, 'front_crop_m', b.front_crop_m,
      'back_crop_m', b.back_crop_m, 'step_mm', b.step_mm, 'updated_at', b.updated_at) order by (m.id = j.machine_id) desc, m.machine_name)
      from public.machines m join public.press_billet_settings b on b.machine_id = m.id and b.company_id = p_company
      where m.company_id = p_company and m.machine_type = 'extrusion_press' and m.is_active and (j.machine_id is null or m.id = j.machine_id)), '[]'),
    'current', (select jsonb_build_object('chosen_mm', x.chosen_mm, 'recommended_mm', x.recommended_mm, 'standard_mm', x.standard_mm, 'chosen_recovery', x.chosen_recovery,
      'recommended_recovery', x.recommended_recovery, 'standard_recovery', x.standard_recovery, 'chosen_at', x.chosen_at, 'machine_id', x.machine_id,
      'chosen_by', (select full_name from public.app_users where id = x.chosen_by))
      from public.job_billet_length_choices x where x.company_id = p_company and x.production_job_id = j.id and x.superseded_at is null))
  from public.production_jobs j left join public.aluminium_profiles p on p.id = j.profile_id and p.company_id = p_company
    left join public.dies d on d.id = j.die_id and d.company_id = p_company
  where j.id = p_job and j.company_id = p_company
$$;
revoke all on function private.ap6_billet_inputs(uuid, uuid) from public, anon, authenticated;

create or replace function public.ap_billet_length(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v jsonb; v_job uuid; v_machine uuid; b public.press_billet_settings%rowtype; v_chosen numeric; v_rows jsonb;
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'factory_manager', 'production_manager', 'production']);
  if p_command = 'presses' then
    perform private.ap_keys(p_payload, array[]::text[]);
    select coalesce(jsonb_agg(jsonb_build_object('machine_id', m.id, 'machine_name', m.machine_name, 'settings', to_jsonb(b) - 'company_id' - 'machine_id') order by m.machine_name), '[]') into v_rows
      from public.machines m left join public.press_billet_settings b on b.machine_id = m.id and b.company_id = c.company_id
      where m.company_id = c.company_id and m.machine_type = 'extrusion_press' and m.is_active;
    return jsonb_build_object('rows', v_rows);
  elsif p_command = 'save_press' then
    perform private.ap4_need(c.role, array['owner', 'admin', 'factory_manager', 'production_manager']);
    perform private.ap_keys(p_payload, array['machine_id', 'min_billet_mm', 'max_billet_mm', 'standard_billet_mm', 'container_diameter_mm', 'butt_mm', 'runout_m', 'front_crop_m', 'back_crop_m', 'step_mm']);
    v_machine := private.ap_uuid(p_payload, 'machine_id');
    if not exists (select 1 from public.machines where id = v_machine and company_id = c.company_id and machine_type = 'extrusion_press') then raise exception 'AP: Press not found.'; end if;
    insert into public.press_billet_settings(company_id, machine_id, min_billet_mm, max_billet_mm, standard_billet_mm, container_diameter_mm, butt_mm, runout_m, front_crop_m, back_crop_m, step_mm, updated_by)
      values (c.company_id, v_machine, private.ap4_num(p_payload, 'min_billet_mm', 'Shortest billet', 50, 3000), private.ap4_num(p_payload, 'max_billet_mm', 'Longest billet', 50, 3000),
        private.ap4_num(p_payload, 'standard_billet_mm', 'Standard billet', 50, 3000, false), private.ap4_num(p_payload, 'container_diameter_mm', 'Container diameter', 50, 600, false),
        private.ap4_num(p_payload, 'butt_mm', 'Butt length', 0, 200), private.ap4_num(p_payload, 'runout_m', 'Run-out table length', 5, 200),
        coalesce(private.ap4_num(p_payload, 'front_crop_m', 'Front crop', 0, 10, false), 0), coalesce(private.ap4_num(p_payload, 'back_crop_m', 'Back crop', 0, 10, false), 0),
        coalesce(private.ap4_num(p_payload, 'step_mm', 'Saw step', 1, 200, false), 10), c.actor_id)
      on conflict (company_id, machine_id) do update set min_billet_mm = excluded.min_billet_mm, max_billet_mm = excluded.max_billet_mm, standard_billet_mm = excluded.standard_billet_mm,
        container_diameter_mm = excluded.container_diameter_mm, butt_mm = excluded.butt_mm, runout_m = excluded.runout_m, front_crop_m = excluded.front_crop_m,
        back_crop_m = excluded.back_crop_m, step_mm = excluded.step_mm, updated_by = excluded.updated_by, updated_at = clock_timestamp();
    return jsonb_build_object('saved', true);
  elsif p_command = 'job_inputs' then
    perform private.ap_keys(p_payload, array['job_id']);
    v := private.ap6_billet_inputs(c.company_id, private.ap_uuid(p_payload, 'job_id'));
    if v is null then raise exception 'AP: Production job not found.'; end if;
    return v || jsonb_build_object('fingerprint', md5((v - 'current')::text));
  elsif p_command = 'record_choice' then
    perform private.ap4_need(c.role, array['owner', 'admin', 'factory_manager', 'production_manager']);
    perform private.ap_keys(p_payload, array['job_id', 'machine_id', 'chosen_mm', 'recommended_mm', 'standard_mm', 'chosen_recovery', 'recommended_recovery', 'standard_recovery', 'options', 'inputs_fingerprint']);
    v_job := private.ap_uuid(p_payload, 'job_id'); v_machine := private.ap_uuid(p_payload, 'machine_id');
    perform 1 from public.production_jobs where id = v_job and company_id = c.company_id and status in ('planned', 'ready', 'on_hold') for update;
    if not found then raise exception 'AP: Billet length can be chosen only before the job runs.'; end if;
    v := private.ap6_billet_inputs(c.company_id, v_job);
    if md5((v - 'current')::text) <> coalesce(p_payload ->> 'inputs_fingerprint', '') then raise exception 'AP: The job, die or press settings changed. Reload the options.'; end if;
    select * into b from public.press_billet_settings where company_id = c.company_id and machine_id = v_machine;
    if b.machine_id is null then raise exception 'AP: Set the billet limits for this press first.'; end if;
    v_chosen := private.ap4_num(p_payload, 'chosen_mm', 'Billet length', b.min_billet_mm, b.max_billet_mm);
    if jsonb_typeof(p_payload -> 'options') <> 'array' or not exists (select 1 from jsonb_array_elements(p_payload -> 'options') o where (o ->> 'billet_mm')::numeric = v_chosen) then
      raise exception 'AP: Choose one of the listed lengths.';
    end if;
    update public.job_billet_length_choices set superseded_at = clock_timestamp() where company_id = c.company_id and production_job_id = v_job and superseded_at is null;
    insert into public.job_billet_length_choices(company_id, production_job_id, machine_id, chosen_mm, recommended_mm, standard_mm, chosen_recovery, recommended_recovery, standard_recovery, options, inputs, inputs_fingerprint, chosen_by)
      values (c.company_id, v_job, v_machine, v_chosen, private.ap4_num(p_payload, 'recommended_mm', 'Recommended length', b.min_billet_mm, b.max_billet_mm),
        private.ap4_num(p_payload, 'standard_mm', 'Standard length', 0, 3000, false), private.ap4_num(p_payload, 'chosen_recovery', 'Recovery', 0, 100, false),
        private.ap4_num(p_payload, 'recommended_recovery', 'Recovery', 0, 100, false), private.ap4_num(p_payload, 'standard_recovery', 'Recovery', 0, 100, false),
        p_payload -> 'options', v - 'current', p_payload ->> 'inputs_fingerprint', c.actor_id);
    return jsonb_build_object('saved', true, 'chosen_mm', v_chosen);
  elsif p_command = 'summary' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return (select jsonb_build_object('jobs', count(*), 'with_standard', count(*) filter (where standard_recovery is not null),
        'avg_chosen_recovery', round(avg(chosen_recovery), 2), 'avg_standard_recovery', round(avg(standard_recovery) filter (where standard_recovery is not null), 2),
        'improved', count(*) filter (where standard_recovery is not null and chosen_recovery > standard_recovery))
      from (select * from public.job_billet_length_choices where company_id = c.company_id and superseded_at is null order by chosen_at desc limit 20) x);
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_billet_length(text, jsonb) from public, anon;
grant execute on function public.ap_billet_length(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-094: exactly-once delivery of entries queued on a phone while offline
-- ---------------------------------------------------------------------------------------------------------------
create table public.offline_receipts (
  company_id uuid not null references public.companies(id), request_id uuid not null, actor_id uuid not null references public.app_users(id),
  rpc text not null, command text not null, payload_hash text not null, state text not null check (state in ('applied', 'conflict')),
  result jsonb, message text, queued_at timestamptz, received_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz, resolution text check (resolution is null or resolution in ('discarded', 'redone')),
  primary key (company_id, request_id)
);
create index offline_receipts_company_idx on public.offline_receipts(company_id, actor_id, state, received_at desc);

create or replace function public.ap_offline(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; r public.offline_receipts%rowtype; v_id uuid; v_rpc text; v_cmd text; v_hash text; v_result jsonb; v_msg text; v_state text; v_page integer := private.ap3_page(p_payload); v_rows jsonb;
begin
  select * into c from private.ap_ctx();
  if p_command = 'submit' then
    perform private.ap_keys(p_payload, array['request_id', 'rpc', 'command', 'payload', 'queued_at']);
    v_id := private.ap_uuid(p_payload, 'request_id'); v_rpc := p_payload ->> 'rpc'; v_cmd := p_payload ->> 'command';
    if (v_rpc, v_cmd) not in (('ap_press', 'push'), ('ap_dispatch', 'scan'), ('ap_sampling', 'sample_record')) or jsonb_typeof(p_payload -> 'payload') <> 'object' then
      raise exception 'AP: This entry cannot be sent from the offline queue.';
    end if;
    v_hash := md5(jsonb_build_array(v_rpc, v_cmd, p_payload -> 'payload')::text);
    perform pg_advisory_xact_lock(hashtextextended(c.company_id::text || ':offline:' || v_id::text, 0));
    select * into r from public.offline_receipts where company_id = c.company_id and request_id = v_id;
    if r.request_id is not null then
      if r.actor_id <> c.actor_id or r.payload_hash <> v_hash then raise exception 'AP: This entry identity was already used for different details.'; end if;
      return jsonb_build_object('state', r.state, 'result', r.result, 'message', r.message, 'replayed', true);
    end if;
    begin
      execute format('select public.%I($1, $2)', v_rpc) into v_result using v_cmd, p_payload -> 'payload';
      v_state := 'applied';
    exception when sqlstate 'P0001' or sqlstate '23514' or sqlstate '23505' or sqlstate '23503' or sqlstate '42501' or sqlstate '22P02' or sqlstate '23P01' then
      v_state := 'conflict'; v_msg := regexp_replace(sqlerrm, '^AP: ', '');
      if sqlstate = '42501' then v_msg := 'This record or action is not available to your current session.'; end if;
    end;
    insert into public.offline_receipts(company_id, request_id, actor_id, rpc, command, payload_hash, state, result, message, queued_at)
      values (c.company_id, v_id, c.actor_id, v_rpc, v_cmd, v_hash, v_state, v_result, v_msg, nullif(p_payload ->> 'queued_at', '')::timestamptz);
    return jsonb_build_object('state', v_state, 'result', v_result, 'message', v_msg, 'replayed', false);
  elsif p_command = 'conflicts' then
    perform private.ap_keys(p_payload, array['page']);
    select coalesce(jsonb_agg(to_jsonb(x) - 'k' order by x.k), '[]') into v_rows from (
      select o.request_id, o.rpc, o.command, o.message, o.queued_at, o.received_at, row_number() over (order by o.received_at desc, o.request_id) k
      from public.offline_receipts o where o.company_id = c.company_id and o.actor_id = c.actor_id and o.state = 'conflict' and o.resolved_at is null) x
      where x.k > (v_page - 1) * 10 and x.k <= v_page * 10;
    return jsonb_build_object('rows', v_rows, 'page', v_page, 'total_count', (select count(*) from public.offline_receipts where company_id = c.company_id and actor_id = c.actor_id and state = 'conflict' and resolved_at is null));
  elsif p_command = 'resolve' then
    perform private.ap_keys(p_payload, array['request_id', 'resolution']);
    if coalesce(p_payload ->> 'resolution', '') not in ('discarded', 'redone') then raise exception 'AP: Choose discard or redone.'; end if;
    update public.offline_receipts set resolved_at = clock_timestamp(), resolution = p_payload ->> 'resolution'
      where company_id = c.company_id and request_id = private.ap_uuid(p_payload, 'request_id') and actor_id = c.actor_id and state = 'conflict' and resolved_at is null;
    if not found then raise exception 'AP: This conflict is already resolved.'; end if;
    return jsonb_build_object('resolved', true);
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_offline(text, jsonb) from public, anon;
grant execute on function public.ap_offline(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-061: overnight draft press plan
-- ---------------------------------------------------------------------------------------------------------------
create table public.press_plan_drafts (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), plan_date date not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'superseded', 'discarded')),
  generated_at timestamptz not null default clock_timestamp(), generated_by uuid references public.app_users(id), job_run_id uuid references public.system_job_runs(id),
  schedule_fingerprint text not null, edit_count integer not null default 0, basis jsonb not null default '{}',
  published_by uuid references public.app_users(id), published_at timestamptz, publish_result jsonb, discard_reason text
);
create index press_plan_drafts_company_idx on public.press_plan_drafts(company_id, plan_date desc, generated_at desc);
create unique index press_plan_drafts_one_open on public.press_plan_drafts(company_id, plan_date) where status = 'draft';
create table public.press_plan_draft_lines (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), draft_id uuid not null references public.press_plan_drafts(id),
  production_job_id uuid not null references public.production_jobs(id), machine_id uuid not null references public.machines(id), shift text not null,
  planned_start_at timestamptz not null, planned_end_at timestamptz not null, capacity_kg numeric(14,3) not null check (capacity_kg > 0), sequence_number integer not null,
  reasons jsonb not null default '[]', origin text not null check (origin in ('system', 'planner')), edited boolean not null default false, removed boolean not null default false,
  check (planned_end_at > planned_start_at)
);
create index press_plan_draft_lines_company_idx on public.press_plan_draft_lines(company_id, draft_id, machine_id, planned_start_at);
create unique index press_plan_draft_lines_job on public.press_plan_draft_lines(draft_id, production_job_id) where not removed;
create table public.press_plan_unscheduled (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), draft_id uuid not null references public.press_plan_drafts(id),
  production_job_id uuid not null references public.production_jobs(id), reasons jsonb not null
);
create index press_plan_unscheduled_company_idx on public.press_plan_unscheduled(company_id, draft_id);

-- Heuristic: earliest promise first, urgent before normal, then alloy/temper and die so runs of one die stay together.
-- Each job goes to the compatible press shift that avoids a die change, otherwise the earliest free time, within
-- configured shift capacity, outside planned maintenance and without the same die on two presses at once.
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
  where m.company_id = p_company and m.machine_type = 'extrusion_press' and m.is_active and m.status in ('active', 'operational', 'idle');
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

create or replace function private.ap6_plan_day(p_company uuid) returns date language sql stable security definer set search_path = public, private as $$
  select private.factory_add_working_days(p_company, private.ist_today(), 1)
$$;
revoke all on function private.ap6_plan_day(uuid) from public, anon, authenticated;

create or replace function private.ap6_plan_job(p_company uuid, p_run uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_day date := private.ap6_plan_day(p_company); d public.press_plan_drafts%rowtype; v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company::text || ':ap6-plan', 0));
  select * into d from public.press_plan_drafts where company_id = p_company and plan_date = v_day and status in ('draft', 'published') order by generated_at desc limit 1;
  if d.id is not null and (d.status = 'published' or d.edit_count > 0) then
    return jsonb_build_object('examined', 0, 'proposals', 0, 'alerts', 0, 'details', jsonb_build_object('kept', d.id, 'reason', case when d.status = 'published' then 'already published' else 'planner has edited the draft' end));
  end if;
  if d.id is not null then update public.press_plan_drafts set status = 'superseded' where id = d.id; end if;
  v_id := private.ap6_plan_build(p_company, v_day, null, p_run);
  return jsonb_build_object('examined', (select count(*) from public.press_plan_draft_lines where draft_id = v_id) + (select count(*) from public.press_plan_unscheduled where draft_id = v_id),
    'proposals', 1, 'alerts', 0, 'details', jsonb_build_object('draft_id', v_id, 'plan_date', v_day));
end;
$$;
revoke all on function private.ap6_plan_job(uuid, uuid) from public, anon, authenticated;

create or replace function private.ap6_plan_view(p_company uuid, p_draft uuid)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('draft', to_jsonb(d) - 'company_id' || jsonb_build_object('generated_by_name', coalesce((select full_name from public.app_users where id = d.generated_by), 'Overnight job'),
      'published_by_name', (select full_name from public.app_users where id = d.published_by),
      'inputs_changed', d.status = 'draft' and private.factory_schedule_fingerprint(p_company, d.plan_date, d.plan_date) <> d.schedule_fingerprint),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'job_id', l.production_job_id, 'job_number', j.job_number, 'order_number', o.order_number,
        'profile_code', p.profile_code, 'die_number', di.die_number, 'alloy', p.alloy, 'machine_id', l.machine_id, 'machine_name', m.machine_name, 'shift', l.shift,
        'planned_start_at', l.planned_start_at, 'planned_end_at', l.planned_end_at, 'capacity_kg', l.capacity_kg, 'sequence_number', l.sequence_number, 'reasons', l.reasons,
        'origin', l.origin, 'edited', l.edited, 'removed', l.removed) order by m.machine_name, l.planned_start_at, l.sequence_number)
      from public.press_plan_draft_lines l join public.production_jobs j on j.id = l.production_job_id join public.machines m on m.id = l.machine_id
        left join public.orders o on o.id = j.order_id left join public.aluminium_profiles p on p.id = j.profile_id left join public.dies di on di.id = j.die_id
      where l.draft_id = d.id and l.company_id = p_company), '[]'),
    'unscheduled', coalesce((select jsonb_agg(jsonb_build_object('job_id', u.production_job_id, 'job_number', j.job_number, 'order_number', o.order_number, 'reasons', u.reasons,
        'planned_quantity_kg', j.planned_quantity_kg) order by j.job_number)
      from public.press_plan_unscheduled u join public.production_jobs j on j.id = u.production_job_id left join public.orders o on o.id = j.order_id
      where u.draft_id = d.id and u.company_id = p_company
        and not exists (select 1 from public.press_plan_draft_lines l where l.draft_id = d.id and l.production_job_id = u.production_job_id and not l.removed)), '[]'),
    'published', coalesce((select jsonb_agg(jsonb_build_object('slot_id', s.id, 'job_number', j.job_number, 'machine_name', m.machine_name, 'shift', s.shift, 'planned_start_at', s.planned_start_at,
        'planned_end_at', s.planned_end_at, 'capacity_kg', s.capacity_kg, 'status', s.status) order by m.machine_name, s.planned_start_at)
      from public.production_plan_slots s join public.production_jobs j on j.id = s.production_job_id join public.machines m on m.id = s.machine_id
      where s.company_id = p_company and s.status in ('scheduled', 'released') and (s.planned_start_at at time zone 'Asia/Kolkata')::date = d.plan_date), '[]'),
    'machines', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'machine_name', m.machine_name) order by m.machine_name) from public.machines m
      where m.company_id = p_company and m.machine_type = 'extrusion_press' and m.is_active), '[]'),
    'shifts', coalesce((select jsonb_agg(distinct c.shift_name) from public.factory_shift_capacities c where c.company_id = p_company and c.weekday = extract(isodow from d.plan_date)::integer), '[]'))
  from public.press_plan_drafts d where d.id = p_draft and d.company_id = p_company
$$;
revoke all on function private.ap6_plan_view(uuid, uuid) from public, anon, authenticated;

create or replace function public.ap_press_plan(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; d public.press_plan_drafts%rowtype; l public.press_plan_draft_lines%rowtype; v_day date; v_id uuid; v_rows jsonb; v_page integer := private.ap3_page(p_payload);
  v_start timestamptz; v_end timestamptz; v_kg numeric; v_machine uuid; v_shift text; v_results jsonb := '[]'; v_r jsonb; v_job text; v_total bigint;
  planners text[] := array['owner', 'admin', 'factory_manager', 'production_manager'];
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'factory_manager', 'production_manager', 'production', 'viewer']);
  if p_command = 'draft' then
    perform private.ap_keys(p_payload, array['date', 'id']);
    if p_payload ? 'id' then select * into d from public.press_plan_drafts where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id;
    else
      v_day := coalesce(private.ap4_day(p_payload, 'date', false), private.ap6_plan_day(c.company_id));
      select * into d from public.press_plan_drafts where company_id = c.company_id and plan_date = v_day and status in ('draft', 'published') order by generated_at desc limit 1;
    end if;
    if d.id is null then return jsonb_build_object('draft', null, 'plan_date', coalesce(v_day, private.ap6_plan_day(c.company_id))); end if;
    return private.ap6_plan_view(c.company_id, d.id) || jsonb_build_object('plan_date', d.plan_date, 'can_plan', c.role = any(planners));
  elsif p_command = 'history' then
    perform private.ap_keys(p_payload, array['page']);
    select coalesce(jsonb_agg(to_jsonb(x) - 'k' - 'total' order by x.k), '[]'), coalesce(max(x.total), 0) into v_rows, v_total from (
      select d2.id, d2.plan_date, d2.status, d2.generated_at, d2.edit_count, d2.published_at, (select full_name from public.app_users where id = d2.published_by) published_by,
        (d2.basis ->> 'placed')::integer placed, (d2.basis ->> 'unscheduled')::integer unscheduled, row_number() over (order by d2.plan_date desc, d2.generated_at desc) k, count(*) over () total
      from public.press_plan_drafts d2 where d2.company_id = c.company_id and d2.status in ('published', 'draft', 'discarded')) x where x.k > (v_page - 1) * 10 and x.k <= v_page * 10;
    return jsonb_build_object('rows', v_rows, 'page', v_page, 'total_count', v_total,
      'published_last_10', (select jsonb_build_object('count', count(*), 'under_five_edits', count(*) filter (where edit_count < 5), 'median_edits', percentile_cont(0.5) within group (order by edit_count))
        from (select edit_count from public.press_plan_drafts where company_id = c.company_id and status = 'published' order by published_at desc limit 10) z));
  end if;
  perform private.ap4_need(c.role, planners);
  if p_command = 'prepare' then
    perform private.ap_keys(p_payload, array['date']);
    v_day := coalesce(private.ap4_day(p_payload, 'date', false), private.ap6_plan_day(c.company_id));
    if v_day < private.ist_today() or v_day > private.ist_today() + 14 then raise exception 'AP: Choose a plan date from today to 14 days ahead.'; end if;
    perform pg_advisory_xact_lock(hashtextextended(c.company_id::text || ':ap6-plan', 0));
    update public.press_plan_drafts set status = 'superseded' where company_id = c.company_id and plan_date = v_day and status = 'draft';
    v_id := private.ap6_plan_build(c.company_id, v_day, c.actor_id, null);
    return private.ap6_plan_view(c.company_id, v_id) || jsonb_build_object('plan_date', v_day, 'can_plan', true);
  end if;
  if p_command in ('edit_line', 'add_line') then
    perform private.ap_keys(p_payload, array['line_id', 'draft_id', 'job_id', 'machine_id', 'shift', 'planned_start_at', 'planned_end_at', 'capacity_kg', 'remove']);
    if p_command = 'edit_line' then
      select * into l from public.press_plan_draft_lines where id = private.ap_uuid(p_payload, 'line_id') and company_id = c.company_id for update;
      if l.id is null then raise exception 'AP: Plan line not found.'; end if;
      select * into d from public.press_plan_drafts where id = l.draft_id for update;
    else
      select * into d from public.press_plan_drafts where id = private.ap_uuid(p_payload, 'draft_id') and company_id = c.company_id for update;
    end if;
    if d.id is null or d.status <> 'draft' then raise exception 'AP: Only an open draft can be changed.'; end if;
    if private.ap6_bool(p_payload, 'remove') then
      update public.press_plan_draft_lines set removed = not removed, edited = true where id = l.id;
    else
      v_machine := private.ap_uuid(p_payload, 'machine_id'); v_shift := private.ap_text(p_payload ->> 'shift', 'Shift', 1, 40);
      v_start := nullif(p_payload ->> 'planned_start_at', '')::timestamptz; v_end := nullif(p_payload ->> 'planned_end_at', '')::timestamptz;
      v_kg := private.ap4_num(p_payload, 'capacity_kg', 'Quantity', 0.001, 10000000);
      if v_start is null or v_end is null or v_end <= v_start then raise exception 'AP: The end must be after the start.'; end if;
      if (v_start at time zone 'Asia/Kolkata')::date not in (d.plan_date, d.plan_date + 1) then raise exception 'AP: Keep the line on the plan date.'; end if;
      if not exists (select 1 from public.machines where id = v_machine and company_id = c.company_id and machine_type = 'extrusion_press' and is_active) then raise exception 'AP: Press not found.'; end if;
      if p_command = 'edit_line' then
        update public.press_plan_draft_lines set machine_id = v_machine, shift = v_shift, planned_start_at = v_start, planned_end_at = v_end, capacity_kg = v_kg, edited = true where id = l.id;
      else
        if not exists (select 1 from public.production_jobs where id = private.ap_uuid(p_payload, 'job_id') and company_id = c.company_id and status in ('planned', 'ready')) then raise exception 'AP: That job cannot be planned.'; end if;
        if exists (select 1 from public.press_plan_draft_lines where draft_id = d.id and production_job_id = (p_payload ->> 'job_id')::uuid and not removed) then raise exception 'AP: That job is already in the draft.'; end if;
        insert into public.press_plan_draft_lines(company_id, draft_id, production_job_id, machine_id, shift, planned_start_at, planned_end_at, capacity_kg, sequence_number, reasons, origin, edited)
          values (c.company_id, d.id, (p_payload ->> 'job_id')::uuid, v_machine, v_shift, v_start, v_end, v_kg,
            coalesce((select max(sequence_number) from public.press_plan_draft_lines where draft_id = d.id and machine_id = v_machine), 0) + 1, jsonb_build_array('Added by the planner.'), 'planner', true);
      end if;
    end if;
    update public.press_plan_drafts set edit_count = edit_count + 1 where id = d.id;
    return private.ap6_plan_view(c.company_id, d.id) || jsonb_build_object('plan_date', d.plan_date, 'can_plan', true);
  elsif p_command = 'discard' then
    perform private.ap_keys(p_payload, array['draft_id', 'reason']);
    update public.press_plan_drafts set status = 'discarded', discard_reason = private.ap_text(p_payload ->> 'reason', 'Reason', 5, 300)
      where id = private.ap_uuid(p_payload, 'draft_id') and company_id = c.company_id and status = 'draft';
    if not found then raise exception 'AP: Only an open draft can be discarded.'; end if;
    return jsonb_build_object('discarded', true);
  elsif p_command = 'publish' then
    perform private.ap_keys(p_payload, array['draft_id']);
    select * into d from public.press_plan_drafts where id = private.ap_uuid(p_payload, 'draft_id') and company_id = c.company_id for update;
    if d.id is null then raise exception 'AP: Draft not found.'; end if;
    if d.status = 'published' then return jsonb_build_object('state', 'published', 'repeated', true, 'result', d.publish_result); end if;
    if d.status <> 'draft' then raise exception 'AP: This draft is %.', d.status; end if;
    -- Each line goes through the existing schedule writer and its capacity, maintenance, die and press checks.
    for l in select * from public.press_plan_draft_lines where draft_id = d.id and not removed order by machine_id, planned_start_at, sequence_number loop
      select job_number into v_job from public.production_jobs where id = l.production_job_id;
      begin
        v_r := public.commit_factory_schedule_move(jsonb_build_object('request_id', private.ap6_uuid_of(d.id::text || ':' || l.id::text || ':' || d.edit_count),
          'production_job_id', l.production_job_id, 'slot_id', null, 'machine_id', l.machine_id, 'planned_start_at', l.planned_start_at, 'planned_end_at', l.planned_end_at,
          'shift', l.shift, 'capacity_kg', l.capacity_kg, 'sequence_number', l.sequence_number, 'from_date', d.plan_date, 'through_date', d.plan_date,
          'fingerprint', private.factory_schedule_fingerprint(c.company_id, d.plan_date, d.plan_date)));
      exception when others then
        raise exception 'AP: Job % cannot be scheduled as drafted: %. Nothing was published; edit or remove the line.', coalesce(v_job, l.production_job_id::text), regexp_replace(sqlerrm, '^AP: ', '');
      end;
      v_results := v_results || jsonb_build_object('line_id', l.id, 'slot_id', v_r ->> 'slot_id');
    end loop;
    if jsonb_array_length(v_results) = 0 then raise exception 'AP: The draft has no lines to publish.'; end if;
    update public.press_plan_drafts set status = 'published', published_by = c.actor_id, published_at = clock_timestamp(), publish_result = v_results where id = d.id;
    return jsonb_build_object('state', 'published', 'slots', jsonb_array_length(v_results), 'edit_count', d.edit_count, 'result', v_results);
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_press_plan(text, jsonb) from public, anon;
grant execute on function public.ap_press_plan(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-002 proposal types and AP-001 jobs
-- ---------------------------------------------------------------------------------------------------------------
alter table public.proposals drop constraint proposals_proposal_type_check;
alter table public.proposals add constraint proposals_proposal_type_check check(proposal_type in
  ('navigation.role_layout','period.close_month','series.adopt','production.expected_output','die.service_due','maintenance.pm_due','bank.receipt_match','freight.estimate','billet.shortage',
   'die.weight_drift','quote.reprice','stock.reorder'));

alter function private.ap_proposal_versions(uuid, text, text) rename to ap6_previous_proposal_versions;
create function private.ap_proposal_versions(p_company uuid, p_type text, p_target text) returns jsonb
language plpgsql volatile security definer set search_path = public, private as $$
declare v jsonb; v_source text; v_id uuid;
begin
  if p_type = 'die.weight_drift' then
    v := private.ap6_die_drift(p_company, p_target::uuid, 1);
    return jsonb_build_object('theoretical', v -> 'theoretical_kgm', 'tolerance', v -> 'tolerance_percent', 'last_bundle', v -> 'last_bundle_id', 'state', v -> 'state');
  elsif p_type = 'quote.reprice' then
    return jsonb_build_object('fingerprint', private.ap6_reprice_impact(p_company) ->> 'fingerprint');
  elsif p_type = 'stock.reorder' then
    v_source := split_part(p_target, ':', 1); v_id := split_part(p_target, ':', 2)::uuid;
    v := private.ap6_reorder_row(p_company, v_source, v_id);
    return jsonb_build_object('stock', v -> 'stock', 'approved_min', v -> 'approved_min', 'approved_qty', v -> 'approved_qty', 'open_requisitions', v -> 'open_requisitions');
  end if;
  return private.ap6_previous_proposal_versions(p_company, p_type, p_target);
end;
$$;
revoke all on function private.ap_proposal_versions(uuid, text, text) from public, anon, authenticated;

alter function private.ap_proposal_editable(text) rename to ap6_previous_proposal_editable;
create function private.ap_proposal_editable(p_type text) returns text[] language sql immutable set search_path = public, private as $$
  select case p_type when 'die.weight_drift' then array['route'] when 'stock.reorder' then array['quantity'] when 'quote.reprice' then array[]::text[]
    else private.ap6_previous_proposal_editable(p_type) end
$$;
revoke all on function private.ap_proposal_editable(text) from public, anon, authenticated;

alter function private.ap_proposal_apply(uuid, uuid, text, public.proposals, jsonb) rename to ap6_previous_proposal_apply;
create function private.ap_proposal_apply(p_company uuid, p_actor uuid, p_role text, p_proposal public.proposals, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare v_task uuid; v_req uuid; v_qty numeric; v_route text; v_result jsonb;
begin
  if p_proposal.proposal_type = 'die.weight_drift' then
    if p_role not in ('owner', 'admin', 'factory_manager', 'production_manager', 'quality') then raise exception 'Not permitted' using errcode = '42501'; end if;
    v_route := p_payload ->> 'route';
    if coalesce(v_route, '') not in ('inspect_die', 'update_master') then raise exception 'AP: Choose inspect die or update the master weight.'; end if;
    insert into public.tasks(company_id, title, description, task_type, assigned_to, created_by, priority, status, due_date, related_entity_type, related_entity_id)
      values (p_company,
        case when v_route = 'inspect_die' then 'Inspect die for section-weight drift' else 'Review the profile master and selling weight' end,
        'Weighed bundles average ' || (p_payload ->> 'actual_kgm') || ' kg/m against ' || (p_payload ->> 'theoretical_kgm') || ' kg/m (' || (p_payload ->> 'drift_percent') || '%). ' ||
          case when v_route = 'inspect_die' then 'Check bearing wear and correction history before the next run.'
            else 'Change the master weight only through the profile edit, which keeps its history. Issued quotations keep their weight snapshot.' end,
        'manual', case when v_route = 'inspect_die' then private.ap6_assignee(p_company, array['production_manager', 'factory_manager'], p_actor) else p_actor end,
        p_actor, 'high', 'open', private.factory_add_working_days(p_company, private.ist_today(), 2),
        case when v_route = 'inspect_die' then 'die' else 'profile' end, case when v_route = 'inspect_die' then (p_payload ->> 'die_id')::uuid else (p_payload ->> 'profile_id')::uuid end)
      returning id into v_task;
    return jsonb_build_object('task_id', v_task, 'route', v_route,
      'href', case when v_route = 'inspect_die' then '/dies/' || (p_payload ->> 'die_id') else '/profiles/' || (p_payload ->> 'profile_id') || '/edit' end);
  elsif p_proposal.proposal_type = 'quote.reprice' then
    if p_role not in ('owner', 'admin') then raise exception 'Not permitted' using errcode = '42501'; end if;
    v_result := private.ap6_reprice_apply(p_company, p_actor, p_payload ->> 'fingerprint', '{}', 'proposal', p_proposal.id);
    if v_result ->> 'state' <> 'applied' then raise exception 'AP: %', v_result ->> 'message'; end if;
    return v_result;
  elsif p_proposal.proposal_type = 'stock.reorder' then
    if p_role not in ('owner', 'admin', 'inventory_manager', 'factory_manager') then raise exception 'Not permitted' using errcode = '42501'; end if;
    perform private.ap_keys(p_payload, array['source', 'item_id', 'item', 'unit', 'quantity', 'need_by']);
    v_qty := private.ap4_num(p_payload, 'quantity', 'Quantity', 0.001, 100000000);
    insert into public.tasks(company_id, title, description, task_type, assigned_to, created_by, priority, status, due_date, related_entity_type, related_entity_id)
      values (p_company, 'Purchase ' || (p_payload ->> 'item'), 'Accepted requisition: ' || v_qty || ' ' || coalesce(p_payload ->> 'unit', '') || ', needed by ' || coalesce(p_payload ->> 'need_by', 'the lead time') ||
        '. Raise the purchase order through the normal purchasing workflow. No stock has been posted.', 'manual',
        private.ap6_assignee(p_company, array['inventory_manager', 'factory_manager'], p_actor), p_actor, 'normal', 'open', nullif(p_payload ->> 'need_by', '')::date, null, null)
      returning id into v_task;
    insert into public.purchase_requisitions(company_id, source_table, source_id, item_label, unit, quantity, need_by, proposal_id, task_id, created_by)
      values (p_company, p_payload ->> 'source', (p_payload ->> 'item_id')::uuid, p_payload ->> 'item', p_payload ->> 'unit', v_qty, nullif(p_payload ->> 'need_by', '')::date, p_proposal.id, v_task, p_actor)
      returning id into v_req;
    return jsonb_build_object('requisition_id', v_req, 'task_id', v_task, 'message', 'Requisition raised; create the purchase order through the normal workflow.');
  end if;
  return private.ap6_previous_proposal_apply(p_company, p_actor, p_role, p_proposal, p_payload);
end;
$$;
revoke all on function private.ap_proposal_apply(uuid, uuid, text, public.proposals, jsonb) from public, anon, authenticated;

alter function private.ap_job_registry() rename to ap6_previous_job_registry;
create function private.ap_job_registry() returns table(job_key text, schedule text, label text, description text)
language sql immutable set search_path = public, private as $$
  select * from private.ap6_previous_job_registry() union all values
    ('dies.weight_drift', 'nightly', 'Check section-weight drift', 'Compares weighed bundle kg/m per die with the profile master and proposes die inspection or a master review.'),
    ('quotes.reprice_check', 'nightly', 'Check draft quotation rates', 'Proposes repricing draft quotations to today''s approved billet rate. Sent quotations are not changed.'),
    ('stock.reorder', 'nightly', 'Propose purchase requisitions', 'Proposes a requisition when stock of an item reaches its approved reorder point.'),
    ('quality.ncr_detect', 'hourly', 'Draft NCRs from rejections', 'Drafts an NCR when job or receipt rejections exceed the QC thresholds.'),
    ('press.plan_draft', 'nightly', 'Draft tomorrow''s press plan', 'Builds a draft press plan for the next working day. The planner reviews and publishes it.')
$$;
revoke all on function private.ap_job_registry() from public, anon, authenticated;

alter function private.ap_job_execute(uuid, text, uuid) rename to ap6_previous_job_execute;
create function private.ap_job_execute(p_company uuid, p_job text, p_run uuid) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if p_job = 'dies.weight_drift' then return private.ap6_weight_job(p_company, p_run);
  elsif p_job = 'quotes.reprice_check' then return private.ap6_reprice_job(p_company, p_run);
  elsif p_job = 'stock.reorder' then return private.ap6_reorder_job(p_company, p_run);
  elsif p_job = 'quality.ncr_detect' then return private.ap6_ncr_detect(p_company);
  elsif p_job = 'press.plan_draft' then return private.ap6_plan_job(p_company, p_run); end if;
  return private.ap6_previous_job_execute(p_company, p_job, p_run);
end;
$$;
revoke all on function private.ap_job_execute(uuid, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Row security: every new table is company-scoped, readable by its working roles, and written only through the gateways.
-- ---------------------------------------------------------------------------------------------------------------
do $$ declare t text; roles text; begin
  foreach t in array array['section_weight_settings', 'quote_reprice_runs', 'quote_reprice_lines', 'reorder_policies', 'purchase_requisitions', 'ncr_settings', 'customer_complaints',
    'quality_ncrs', 'tds_settings', 'customer_tax_profiles', 'tds_deductions', 'tds_statement_imports', 'tds_statement_lines', 'einvoice_settings', 'einvoice_exports',
    'einvoice_export_items', 'invoice_irns', 'press_billet_settings', 'job_billet_length_choices', 'offline_receipts', 'press_plan_drafts', 'press_plan_draft_lines', 'press_plan_unscheduled'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    roles := case
      when t in ('quote_reprice_runs', 'quote_reprice_lines') then 'array[''owner'',''admin'',''sales_manager'',''sales'',''accounts'']'
      when t in ('reorder_policies', 'purchase_requisitions') then 'array[''owner'',''admin'',''inventory_manager'',''factory_manager'',''production_manager'',''accounts'']'
      when t in ('ncr_settings', 'quality_ncrs') then 'array[''owner'',''admin'',''quality'',''factory_manager'',''production_manager'']'
      when t = 'customer_complaints' then 'array[''owner'',''admin'',''quality'',''factory_manager'',''production_manager'',''sales_manager'',''sales'',''dispatch_manager'']'
      -- The IRN prints on the invoice, so everyone who may print the invoice may read it.
      when t = 'invoice_irns' then 'array[''owner'',''admin'',''accounts'',''sales_manager'',''viewer'']'
      when t in ('tds_settings', 'customer_tax_profiles', 'tds_deductions', 'tds_statement_imports', 'tds_statement_lines', 'einvoice_settings', 'einvoice_exports', 'einvoice_export_items')
        then 'array[''owner'',''admin'',''accounts'']'
      when t in ('press_billet_settings', 'job_billet_length_choices', 'press_plan_drafts', 'press_plan_draft_lines', 'press_plan_unscheduled')
        then 'array[''owner'',''admin'',''factory_manager'',''production_manager'',''production'']'
      when t = 'section_weight_settings' then 'array[''owner'',''admin'',''factory_manager'',''production_manager'',''production'',''quality'',''sales_manager'']'
      else 'array[''owner'',''admin'']' end;
    if t = 'offline_receipts' then
      execute format('create policy ap6_read on public.%I for select to authenticated using (company_id = (select public.get_current_user_company_id()) and actor_id = (select auth.uid()))', t);
    else
      execute format('create policy ap6_read on public.%I for select to authenticated using (company_id = (select public.get_current_user_company_id()) and (select public.get_current_user_role()) = any(%s))', t, roles);
    end if;
  end loop;
end $$;
-- The invoice PDF route reads the IRN directly (row security above still limits it to the company and roles).
grant select on public.invoice_irns to authenticated;

commit;

-- FABLE_SUGGESTIONS Phase 4: FS-16 (die life prediction), FS-27 (material requirements plan), FS-26 stage (promise-date
-- calculator and breakdown re-flow), FS-54 (new-profile/new-die development pipeline), FS-38 (owner cockpit) and FS-36
-- (live screens: Realtime publication for the five high-value screens).
--
-- Rules kept: no die life, lead time, recovery standard, tolerance or price is invented. A die life comes from the die's
-- recorded rated life or from the median of at least three retired dies of the same type; a lead time from the die
-- vendor's own history or from a value a named person sets. Suggestions are approved by a person; nothing is bought,
-- cast or rescheduled by itself.
-- Additive. New tables are reached only through security-definer gateways.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------------------------------------------
-- FS-16: die life prediction, replacement warning, die-maker ranking, amortisation recovered
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.die_life_settings (
  company_id uuid primary key references public.companies(id),
  replacement_lead_days integer check (replacement_lead_days is null or replacement_lead_days between 1 and 365),
  reason text not null check (length(btrim(reason)) between 5 and 300),
  updated_by uuid not null references public.app_users(id),
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.die_life_settings enable row level security;
revoke all on public.die_life_settings from public, anon, authenticated;

-- Lifetime output of a die: its recorded opening production plus completed jobs run on it.
create or replace function private.fs4_die_used_kg(p_company uuid, p_die uuid)
returns numeric language sql stable security definer set search_path = public, private as $$
  select coalesce((select d.opening_production_kg from public.dies d where d.id = p_die and d.company_id = p_company), 0)
    + coalesce((select sum(coalesce(j.actual_quantity_kg, 0)) from public.production_jobs j where j.company_id = p_company and j.die_id = p_die and j.status = 'completed'), 0)
$$;
revoke all on function private.fs4_die_used_kg(uuid, uuid) from public, anon, authenticated;

create or replace function private.fs4_die_life(p_company uuid, p_die uuid default null)
returns table(die_id uuid, die_number text, profile_id uuid, profile_code text, die_type text, die_status text, ownership_type text, maker text,
  used_kg numeric, life_kg numeric, life_basis text, remaining_kg numeric, weekly_kg numeric, weeks_left numeric, open_demand_kg numeric,
  lead_days integer, lead_basis text, replace_flag boolean, replace_reason text, open_corrections integer, oldest_open_correction_days integer,
  last_correction_result text, die_cost numeric, recovered_amount numeric, rack_location text)
language sql stable security definer set search_path = public, private as $$
  with dies as (
    select d.*, coalesce(v.vendor_name, nullif(btrim(d.die_manufacturer), ''), 'Not recorded') maker_name
    from public.dies d left join public.vendors v on v.id = d.die_vendor_id
    where d.company_id = p_company and d.deleted_at is null and (p_die is null or d.id = p_die)
      and coalesce(d.die_status, '') not in ('retired', 'scrapped', 'dead')
  ),
  retired as (
    select d.die_type, private.fs4_die_used_kg(p_company, d.id) kg from public.dies d
    where d.company_id = p_company and d.deleted_at is null and d.die_status in ('retired', 'scrapped', 'dead')
  ),
  type_life as (select die_type, count(*) n, percentile_cont(0.5) within group (order by kg)::numeric kg from retired where kg > 0 group by die_type),
  vendor_lead as (
    select coalesce(d.die_vendor_id::text, lower(btrim(d.die_manufacturer))) k, count(*) n, round(avg(d.receipt_date - d.purchase_date))::integer days
    from public.dies d where d.company_id = p_company and d.purchase_date is not null and d.receipt_date >= d.purchase_date
    group by 1
  ),
  demand as (
    select oi.die_id, oi.profile_id, greatest(coalesce(r.ordered_kg, 0) - coalesce(r.produced_kg, 0) - coalesce(r.from_stock_kg, 0), 0) kg
    from private.order_line_requirements(p_company, null) r join public.order_items oi on oi.id = r.order_item_id
    where not r.order_closed
  ),
  base as (
    select d.*, private.fs4_die_used_kg(p_company, d.id) used,
      case when d.die_life_tons > 0 then d.die_life_tons * 1000 when tl.n >= 3 then tl.kg end life,
      case when d.die_life_tons > 0 then 'Recorded rated life of this die' when tl.n >= 3 then 'Median life of ' || tl.n || ' retired ' || replace(coalesce(d.die_type, 'unknown'), '_', ' ') || ' dies'
        else 'Not known: record the rated life or retire at least three dies of this type' end life_src,
      coalesce((select sum(coalesce(j.actual_quantity_kg, 0)) from public.production_jobs j where j.company_id = p_company and j.die_id = d.id and j.status = 'completed'
        and j.completed_at >= clock_timestamp() - interval '56 days'), 0) / 8 weekly,
      coalesce((select sum(x.kg) from demand x where x.die_id = d.id), 0)
        -- Lines without a die count against a profile's only usable die.
        + case when (select count(*) from public.dies y where y.company_id = p_company and y.profile_id = d.profile_id and y.deleted_at is null
            and coalesce(y.die_status, '') not in ('retired', 'scrapped', 'dead')) = 1
          then coalesce((select sum(x.kg) from demand x where x.die_id is null and x.profile_id = d.profile_id), 0) else 0 end demand_kg,
      case when vl.n >= 2 then vl.days else ls.replacement_lead_days end lead,
      case when vl.n >= 2 then 'Average of ' || vl.n || ' dies from this maker (order to receipt)' when ls.replacement_lead_days is not null then 'Set by the die shop' else 'Not known' end lead_src
    from dies d
    left join type_life tl on tl.die_type is not distinct from d.die_type
    left join vendor_lead vl on vl.k = coalesce(d.die_vendor_id::text, lower(btrim(d.die_manufacturer)))
    left join public.die_life_settings ls on ls.company_id = p_company
  )
  select b.id, b.die_number, b.profile_id, p.profile_code, b.die_type, b.die_status, b.ownership_type, b.maker_name,
    round(b.used, 1), round(b.life, 1), b.life_src, case when b.life is not null then round(b.life - b.used, 1) end, round(b.weekly, 1),
    case when b.life is not null and b.weekly > 0 then round(greatest(b.life - b.used, 0) / b.weekly, 1) end, round(b.demand_kg, 1), b.lead, b.lead_src,
    b.life is not null and (b.life - b.used) < b.demand_kg + coalesce(b.weekly * b.lead / 7.0, 0),
    case when b.life is null then null
      when (b.life - b.used) < b.demand_kg then 'Remaining life is less than open order demand on this die'
      when b.lead is not null and (b.life - b.used) < b.demand_kg + b.weekly * b.lead / 7.0 then 'Remaining life runs out within the replacement lead time at the current rate'
      end,
    (select count(*)::integer from public.die_corrections c where c.company_id = p_company and c.die_id = b.id and coalesce(c.result_status, 'pending') = 'pending'),
    (select (private.ist_today() - min(c.correction_date))::integer from public.die_corrections c where c.company_id = p_company and c.die_id = b.id and coalesce(c.result_status, 'pending') = 'pending'),
    (select c.result_status from public.die_corrections c where c.company_id = p_company and c.die_id = b.id order by c.correction_date desc, c.created_at desc limit 1),
    b.die_cost,
    case when b.ownership_type in ('customer_owned', 'shared') or b.die_cost is not null then
      coalesce((select sum(ii.line_total) from public.invoice_items ii join public.invoices i on i.id = ii.invoice_id and i.company_id = p_company
        where ii.company_id = p_company and ii.die_id = b.id and ii.line_kind = 'die_charge' and i.deleted_at is null and i.status not in ('cancelled', 'draft')), 0) end,
    b.rack_location
  from base b left join public.aluminium_profiles p on p.id = b.profile_id
$$;
revoke all on function private.fs4_die_life(uuid, uuid) from public, anon, authenticated;

create or replace function private.fs4_die_makers(p_company uuid)
returns jsonb language sql stable security definer set search_path = public, private as $$
  with d as (
    select coalesce(v.vendor_name, nullif(btrim(d.die_manufacturer), ''), 'Not recorded') maker, d.die_status in ('retired', 'scrapped', 'dead') retired,
      private.fs4_die_used_kg(p_company, d.id) kg, d.die_cost
    from public.dies d left join public.vendors v on v.id = d.die_vendor_id where d.company_id = p_company and d.deleted_at is null
  )
  select coalesce(jsonb_agg(jsonb_build_object('maker', maker, 'dies', n, 'retired', r, 'total_kg', round(kg, 1), 'average_retired_life_kg', round(rl, 1),
      'costed_dies', cn, 'kg_per_1000_inr', case when cost > 0 then round(ckg / cost * 1000, 1) end) order by case when cost > 0 then ckg / cost end desc nulls last, maker), '[]')
  from (select maker, count(*) n, count(*) filter (where retired) r, sum(kg) kg, avg(kg) filter (where retired) rl,
      count(*) filter (where die_cost > 0) cn, sum(die_cost) filter (where die_cost > 0) cost, sum(kg) filter (where die_cost > 0) ckg from d group by maker) x
$$;
revoke all on function private.fs4_die_makers(uuid) from public, anon, authenticated;

-- Morning: a warning for each die whose remaining life is short of demand plus lead time; cleared when it no longer is.
create or replace function private.fs4_die_alerts(p_company uuid)
returns integer language plpgsql security definer set search_path = public, private as $$
declare r record; v_n integer := 0;
begin
  for r in select * from private.fs4_die_life(p_company, null) loop
    if r.replace_flag then
      if not exists (select 1 from public.notifications where company_id = p_company and condition_key = 'fs4:die-replace:' || r.die_id and resolved_at is null) then
        insert into public.notifications(company_id, recipient_role, notification_type, severity, title, body, related_entity_type, related_entity_id, action_link, entity_reference, condition_key)
          values (p_company, 'production_manager', 'die_replacement', 'warning', 'Order a replacement for die ' || r.die_number,
            r.replace_reason || '. Remaining about ' || to_char(r.remaining_kg, 'FM999,999,990') || ' kg; open demand ' || to_char(r.open_demand_kg, 'FM999,999,990') || ' kg.',
            'die', r.die_id, '/dies/life', 'fs4:die-replace:' || r.die_id, 'fs4:die-replace:' || r.die_id);
        v_n := v_n + 1;
      end if;
    else
      update public.notifications set resolved_at = clock_timestamp(), resolution = 'Remaining life now covers demand'
        where company_id = p_company and condition_key = 'fs4:die-replace:' || r.die_id and resolved_at is null;
    end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function private.fs4_die_alerts(uuid) from public, anon, authenticated;

create or replace function public.fs_die_life(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_rows jsonb; v_total bigint; v_page integer := private.ap3_page(p_payload); v_filter text := coalesce(p_payload ->> 'filter', 'all');
begin
  if p_command = 'save_settings' then select * into c from private.ap_ctx(array['owner', 'admin', 'production_manager']);
  else select * into c from private.ap_ctx(array['owner', 'admin', 'production_manager', 'factory_manager', 'production', 'quality', 'sales_manager', 'accounts']); end if;
  if p_command = 'dies' then
    perform private.ap_keys(p_payload, array['page', 'filter', 'search']);
    if v_filter not in ('all', 'replace', 'unknown_life', 'open_corrections', 'customer_owned') then raise exception 'AP: Choose a valid filter.'; end if;
    with q as (select x.*, row_number() over (order by x.replace_flag desc, x.weeks_left nulls last, x.die_number) k from private.fs4_die_life(c.company_id, null) x
      where (v_filter = 'all' or (v_filter = 'replace' and x.replace_flag) or (v_filter = 'unknown_life' and x.life_kg is null)
        or (v_filter = 'open_corrections' and x.open_corrections > 0) or (v_filter = 'customer_owned' and x.ownership_type in ('customer_owned', 'shared')))
        and (nullif(btrim(p_payload ->> 'search'), '') is null or x.die_number ilike '%' || btrim(p_payload ->> 'search') || '%' or x.profile_code ilike '%' || btrim(p_payload ->> 'search') || '%'))
    select coalesce(jsonb_agg(to_jsonb(q) - 'k' - case when c.role in ('owner', 'admin', 'accounts') then '' else 'die_cost' end
        - case when c.role in ('owner', 'admin', 'accounts') then '' else 'recovered_amount' end order by q.k) filter (where q.k > (v_page - 1) * 10 and q.k <= v_page * 10), '[]'), count(*)
      into v_rows, v_total from q;
    return jsonb_build_object('rows', v_rows, 'page', v_page, 'total_count', v_total,
      'flagged', (select count(*) from private.fs4_die_life(c.company_id, null) where replace_flag),
      'basis', 'Used = opening production + completed jobs on the die. Life = the die''s recorded rated life, else the median of at least three retired dies of its type. Rate = completed output over the last eight weeks. Flag when remaining life is below open order demand plus the output expected during the replacement lead time.');
  elsif p_command = 'makers' then
    perform private.ap_keys(p_payload, array[]::text[]);
    if c.role not in ('owner', 'admin', 'production_manager', 'factory_manager', 'accounts') then raise exception 'Not permitted' using errcode = '42501'; end if;
    return jsonb_build_object('rows', private.fs4_die_makers(c.company_id), 'basis', 'Kg produced per ₹1,000 of recorded die cost, over dies with a cost. Life of retired dies only.');
  elsif p_command = 'settings' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return coalesce((select to_jsonb(s) - 'company_id' || jsonb_build_object('updated_by_name', u.full_name) from public.die_life_settings s join public.app_users u on u.id = s.updated_by where s.company_id = c.company_id),
      jsonb_build_object('replacement_lead_days', null));
  elsif p_command = 'save_settings' then
    perform private.ap_keys(p_payload, array['replacement_lead_days', 'reason']);
    insert into public.die_life_settings(company_id, replacement_lead_days, reason, updated_by)
      values (c.company_id, private.ap9_int(p_payload, 'replacement_lead_days', 'Replacement lead time', 1, 365), private.ap_text(p_payload ->> 'reason', 'Reason', 5, 300), c.actor_id)
      on conflict (company_id) do update set replacement_lead_days = excluded.replacement_lead_days, reason = excluded.reason, updated_by = excluded.updated_by, updated_at = clock_timestamp();
    return jsonb_build_object('saved', true, 'new_alerts', private.fs4_die_alerts(c.company_id));
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.fs_die_life(text, jsonb) from public, anon;
grant execute on function public.fs_die_life(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- FS-27: weekly material requirements plan (billet, consumables, dies) for the owner to approve
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.mrp_weekly_plans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  week_start date not null,
  status text not null default 'approved' check (status in ('approved', 'superseded')),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{32}$'),
  lines jsonb not null check (jsonb_typeof(lines) = 'array'),
  note text check (note is null or length(btrim(note)) between 3 and 300),
  approved_by uuid not null references public.app_users(id),
  approved_at timestamptz not null default clock_timestamp(),
  superseded_at timestamptz,
  check ((status = 'superseded') = (superseded_at is not null))
);
create unique index if not exists mrp_weekly_plans_one_approved on public.mrp_weekly_plans(company_id, week_start) where status = 'approved';
create table if not exists public.mrp_plan_actions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  plan_id uuid not null references public.mrp_weekly_plans(id),
  line_key text not null check (length(line_key) between 3 and 160),
  action text not null check (action in ('po_raised', 'cast_planned', 'not_needed')),
  reference text check (reference is null or length(btrim(reference)) between 2 and 120),
  note text check (note is null or length(btrim(note)) between 3 and 300),
  recorded_by uuid not null references public.app_users(id),
  recorded_at timestamptz not null default clock_timestamp(),
  check (action = 'not_needed' or reference is not null),
  unique (plan_id, line_key)
);
alter table public.mrp_weekly_plans enable row level security;
alter table public.mrp_plan_actions enable row level security;
revoke all on public.mrp_weekly_plans, public.mrp_plan_actions from public, anon, authenticated;

-- Billet requirement by alloy, diameter and week. Firm: live production jobs (billet input, else planned output / the
-- recorded recovery, less billets already linked). Uncertain: open order lines not yet on a live job (still to make /
-- the order's recorded billet recovery), needed in the week before their promise. Rows without alloy, diameter or a
-- recorded recovery are returned with kg null and are listed, never guessed.
create or replace function private.fs4_mrp_demand(p_company uuid)
returns table(alloy text, diameter numeric, week_start date, kg numeric, firm boolean, reference text, href text, billet_kg numeric)
language sql stable security definer set search_path = public, private as $$
  with today as (select private.ap8_week(private.ist_today()) w0)
  select upper(coalesce(r.alloy, p.alloy)), coalesce(r.billet_diameter_inch, p.billet_diameter_required_inch),
    greatest(private.ap8_week(coalesce(s.need_day, j.planned_date, private.ist_today())), (select w0 from today)),
    case when inp.kg is not null then greatest(inp.kg - coalesce(al.kg, 0), 0) end, true, coalesce(j.job_number, 'Job'), '/production/' || j.id, r.billet_weight_kg
  from public.production_jobs j join public.aluminium_profiles p on p.id = j.profile_id
  left join lateral (select min((x.planned_start_at at time zone 'Asia/Kolkata')::date) need_day from public.production_plan_slots x
    where x.company_id = p_company and x.production_job_id = j.id and x.status in ('scheduled', 'released')) s on true
  left join lateral (select x.* from public.order_billet_requirements x where x.company_id = p_company and x.order_id = j.order_id and x.profile_id = j.profile_id
    and x.status <> 'cancelled' order by x.id limit 1) r on true
  cross join lateral (select case when j.input_billet_weight > 0 then j.input_billet_weight
    when j.planned_quantity_kg > 0 and coalesce(j.extrusion_efficiency_percent, r.extrusion_efficiency_percent) > 0
    then round(j.planned_quantity_kg / (coalesce(j.extrusion_efficiency_percent, r.extrusion_efficiency_percent) / 100), 3) end kg) inp
  left join lateral (select sum(coalesce(b.measured_weight_kg, b.weight_kg)) kg from public.foundry_billets b where b.company_id = p_company
    and b.production_job_id = j.id and b.status in ('allocated', 'issued', 'consumed')) al on true
  where j.company_id = p_company and j.status in ('planned', 'ready', 'on_hold', 'in_progress')
  union all
  select upper(coalesce(r.alloy, p.alloy)), coalesce(r.billet_diameter_inch, p.billet_diameter_required_inch),
    greatest(private.ap8_week(coalesce(l.effective_date, private.ist_today()) - 7), (select w0 from today)),
    case when r.extrusion_efficiency_percent > 0 then round(greatest(coalesce(l.ordered_kg, 0) - coalesce(l.produced_kg, 0) - coalesce(l.from_stock_kg, 0) - coalesce(l.planned_open_kg, 0), 0)
      / (r.extrusion_efficiency_percent / 100), 3) end, false, l.order_number, '/orders/' || l.order_id, r.billet_weight_kg
  from private.order_line_requirements(p_company, null) l join public.order_items oi on oi.id = l.order_item_id
  join public.aluminium_profiles p on p.id = oi.profile_id
  left join lateral (select x.* from public.order_billet_requirements x where x.company_id = p_company and x.order_id = l.order_id and x.profile_id = oi.profile_id
    and x.status <> 'cancelled' order by x.id limit 1) r on true
  where not l.order_closed and l.ordered_kg is not null
    and coalesce(l.ordered_kg, 0) - coalesce(l.produced_kg, 0) - coalesce(l.from_stock_kg, 0) - coalesce(l.planned_open_kg, 0) > 0.0005
$$;
revoke all on function private.fs4_mrp_demand(uuid) from public, anon, authenticated;

create or replace function private.fs4_mrp(p_company uuid, p_weeks integer)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare v_w0 date := private.ap8_week(private.ist_today()); v_billet jsonb; v_unknown jsonb; v_cons jsonb; v_dies jsonb; v_lines jsonb;
begin
  with d as (select * from private.fs4_mrp_demand(p_company) where week_start < v_w0 + p_weeks * 7),
  g as (select alloy, diameter, min(billet_kg) filter (where billet_kg > 0) billet_kg from d where alloy is not null and diameter is not null and kg is not null group by alloy, diameter),
  wk as (select v_w0 + n * 7 w from generate_series(0, p_weeks - 1) n),
  grid as (
    select g.alloy, g.diameter, g.billet_kg, wk.w,
      coalesce((select sum(x.kg) from d x where x.alloy = g.alloy and x.diameter = g.diameter and x.week_start = wk.w and x.firm and x.kg is not null), 0) firm_kg,
      coalesce((select sum(x.kg) from d x where x.alloy = g.alloy and x.diameter = g.diameter and x.week_start = wk.w and not x.firm and x.kg is not null), 0) uncertain_kg,
      coalesce((select sum(greatest(l.ordered_quantity - coalesce((select sum(rl.received_quantity) from public.purchase_receipt_lines rl where rl.company_id = p_company and rl.purchase_order_line_id = l.id), 0), 0))
        from public.procurement_supply_links sl join public.purchase_order_lines l on l.id = sl.purchase_order_line_id and l.company_id = p_company
        join public.purchase_orders po on po.id = l.purchase_order_id and po.company_id = p_company
        join public.supplier_commitments sc on sc.purchase_order_id = po.id and sc.company_id = p_company
        where sl.company_id = p_company and upper(btrim(sl.alloy)) = g.alloy and sl.diameter_inch = g.diameter and po.status = 'open' and l.unit = 'kg'
          and greatest(private.ap8_week(sc.current_date_promised), v_w0) = wk.w), 0)
      + coalesce((select sum(coalesce(b.total_billet_weight_density_kg, b.total_billet_weight_kg)) from public.foundry_batches b where b.company_id = p_company
          and b.status in ('planned', 'melting') and greatest(private.ap8_week(b.production_date), v_w0) = wk.w and upper(btrim(b.alloy)) = g.alloy
          and abs(b.billet_diameter_mm - g.diameter * 25.4) <= 1), 0) incoming_kg,
      coalesce((select sum(b.available_weight_kg) from public.billet_batches b where b.company_id = p_company and b.status = 'available' and upper(btrim(b.alloy)) = g.alloy
          and abs(b.diameter_mm - g.diameter * 25.4) <= 1), 0)
      + coalesce((select sum(coalesce(b.measured_weight_kg, b.weight_kg)) from public.foundry_billets b where b.company_id = p_company and b.status = 'cast' and b.order_id is null
          and b.production_job_id is null and upper(btrim(b.alloy)) = g.alloy and abs(b.billet_diameter_mm - g.diameter * 25.4) <= 1), 0) free_kg
    from g cross join wk
  ),
  run as (select *, sum(firm_kg) over w cf, sum(uncertain_kg) over w cu, sum(incoming_kg) over w ci from grid window w as (partition by alloy, diameter order by w)),
  agg as (
    select alloy, diameter, max(billet_kg) billet_kg, max(free_kg) free_kg,
      jsonb_agg(jsonb_build_object('week_start', w, 'firm_kg', round(firm_kg, 1), 'uncertain_kg', round(uncertain_kg, 1), 'incoming_kg', round(incoming_kg, 1),
        'firm_shortfall_kg', round(greatest(cf - free_kg - ci, 0), 1), 'total_shortfall_kg', round(greatest(cf + cu - free_kg - ci, 0), 1)) order by w) weeks,
      max(greatest(cf - free_kg - ci, 0)) firm_peak, max(greatest(cf + cu - free_kg - ci, 0)) total_peak,
      min(w) filter (where cf > free_kg + ci) firm_need_by, min(w) filter (where cf + cu > free_kg + ci) need_by
    from run group by alloy, diameter
  )
  select coalesce(jsonb_agg(jsonb_build_object('line_key', 'billet:' || a.alloy || ':' || a.diameter, 'alloy', a.alloy, 'diameter_inch', a.diameter, 'free_kg', round(a.free_kg, 1),
      'weeks', a.weeks, 'firm_shortfall_kg', round(a.firm_peak, 1), 'total_shortfall_kg', round(a.total_peak, 1), 'need_by', a.need_by, 'firm_need_by', a.firm_need_by,
      'suggest_kg', case when a.total_peak > 0.0005 then round(a.total_peak, 1) end,
      'suggest_billets', case when a.total_peak > 0.0005 and a.billet_kg > 0 then ceil(a.total_peak / a.billet_kg) end,
      'action', case when a.total_peak <= 0.0005 then 'none'
        when exists (select 1 from public.foundry_batches b where b.company_id = p_company and upper(btrim(b.alloy)) = a.alloy and abs(b.billet_diameter_mm - a.diameter * 25.4) <= 1
          and b.production_date >= private.ist_today() - 180) then 'cast' else 'buy' end,
      'action_basis', case when exists (select 1 from public.foundry_batches b where b.company_id = p_company and upper(btrim(b.alloy)) = a.alloy and abs(b.billet_diameter_mm - a.diameter * 25.4) <= 1
          and b.production_date >= private.ist_today() - 180) then 'This alloy and diameter was cast in-house in the last 180 days' else 'Not cast in-house in the last 180 days' end,
      'drivers', coalesce((select jsonb_agg(jsonb_build_object('reference', x.reference, 'href', x.href, 'week_start', x.week_start, 'kg', round(x.kg, 1), 'firm', x.firm) order by x.week_start, x.kg desc)
        from (select * from private.fs4_mrp_demand(p_company) y where y.alloy = a.alloy and y.diameter = a.diameter and y.kg > 0 and y.week_start < v_w0 + p_weeks * 7 order by y.week_start, y.kg desc limit 25) x), '[]'))
      order by a.need_by nulls last, a.alloy, a.diameter), '[]') into v_billet from agg a;

  select coalesce(jsonb_agg(jsonb_build_object('reference', x.reference, 'href', x.href, 'firm', x.firm,
      'missing', concat_ws(', ', case when x.alloy is null then 'alloy' end, case when x.diameter is null then 'billet diameter' end, case when x.kg is null then 'billet input or recorded recovery' end))
      order by x.firm desc, x.reference), '[]') into v_unknown
    from (select * from private.fs4_mrp_demand(p_company) where (alloy is null or diameter is null or kg is null) limit 50) x;

  -- Packaging and consumables at or below their reorder point: the approved reorder quantity when one exists (AP-033), else back up to the reorder level.
  select coalesce(jsonb_agg(jsonb_build_object('line_key', 'item:' || i.id, 'item_id', i.id, 'item_code', i.item_code, 'item_name', i.item_name, 'category', i.item_category, 'unit', i.unit,
      'current_stock', i.current_stock, 'reorder_point', coalesce(rp.approved_min, i.reorder_level),
      'suggest_quantity', round(coalesce(rp.approved_qty, coalesce(rp.approved_min, i.reorder_level) - i.current_stock), 3),
      'basis', case when rp.approved_qty is not null then 'Approved reorder quantity' else 'Back up to the reorder level' end) order by i.item_category, i.item_name), '[]')
    into v_cons
  from public.inventory_items i left join public.reorder_policies rp on rp.company_id = p_company and rp.source_table = 'inventory_items' and rp.source_id = i.id
  where i.company_id = p_company and coalesce(i.is_active, true) and coalesce(rp.approved_min, i.reorder_level) > 0 and i.current_stock <= coalesce(rp.approved_min, i.reorder_level)
    and coalesce(rp.approved_qty, coalesce(rp.approved_min, i.reorder_level) - i.current_stock) > 0;

  select coalesce(jsonb_agg(jsonb_build_object('line_key', 'die:' || x.die_id, 'die_id', x.die_id, 'die_number', x.die_number, 'profile_code', x.profile_code, 'maker', x.maker,
      'remaining_kg', x.remaining_kg, 'open_demand_kg', x.open_demand_kg, 'lead_days', x.lead_days, 'reason', x.replace_reason) order by x.weeks_left nulls last), '[]')
    into v_dies from private.fs4_die_life(p_company, null) x where x.replace_flag;

  v_lines := (select coalesce(jsonb_agg(l), '[]') from (
    select jsonb_build_object('line_key', b ->> 'line_key', 'kind', 'billet', 'action', b ->> 'action', 'label', (b ->> 'alloy') || ' billet ' || (b ->> 'diameter_inch') || '"',
      'quantity', b -> 'suggest_kg', 'unit', 'kg', 'need_by', b -> 'need_by') l from jsonb_array_elements(v_billet) b where b ->> 'action' <> 'none'
    union all select jsonb_build_object('line_key', x ->> 'line_key', 'kind', 'consumable', 'action', 'buy', 'label', x ->> 'item_name', 'quantity', x -> 'suggest_quantity', 'unit', x -> 'unit') from jsonb_array_elements(v_cons) x
    union all select jsonb_build_object('line_key', x ->> 'line_key', 'kind', 'die', 'action', 'buy', 'label', 'Replacement die for ' || coalesce(x ->> 'profile_code', x ->> 'die_number'), 'quantity', 1, 'unit', 'die') from jsonb_array_elements(v_dies) x
  ) z);

  return jsonb_build_object('week_start', v_w0, 'weeks', p_weeks, 'billet', v_billet, 'unknown', v_unknown, 'consumables', v_cons, 'dies', v_dies, 'lines', v_lines,
    'fingerprint', md5(v_lines::text),
    'basis', 'Billet: firm demand from live jobs, uncertain demand from order lines not yet on a job (in the week before their promise), against free stock, billet purchase lines with a supplier date and planned casts. Consumables: at or below their reorder point. Dies: remaining life short of demand plus lead time.');
end;
$$;
revoke all on function private.fs4_mrp(uuid, integer) from public, anon, authenticated;

create or replace function public.fs_mrp(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v jsonb; p public.mrp_weekly_plans%rowtype; v_key text; v_action text; v_rows jsonb; v_total bigint; v_page integer := private.ap3_page(p_payload);
begin
  if p_command = 'approve' then select * into c from private.ap_ctx(array['owner', 'admin']);
  elsif p_command = 'action' then select * into c from private.ap_ctx(array['owner', 'admin', 'factory_manager', 'inventory_manager', 'accounts', 'production_manager']);
  else select * into c from private.ap_ctx(array['owner', 'admin', 'factory_manager', 'inventory_manager', 'accounts', 'production_manager']); end if;
  if p_command = 'plan' then
    perform private.ap_keys(p_payload, array['weeks']);
    v := private.fs4_mrp(c.company_id, coalesce(private.ap9_int(p_payload, 'weeks', 'Weeks', 1, 13), 8));
    select * into p from public.mrp_weekly_plans where company_id = c.company_id and week_start = (v ->> 'week_start')::date and status = 'approved';
    return v || jsonb_build_object('approved', case when p.id is null then null else jsonb_build_object('id', p.id, 'approved_at', p.approved_at, 'note', p.note,
      'approved_by', (select full_name from public.app_users where id = p.approved_by), 'lines', p.lines, 'current', p.fingerprint = v ->> 'fingerprint',
      'actions', coalesce((select jsonb_object_agg(a.line_key, jsonb_build_object('action', a.action, 'reference', a.reference, 'note', a.note, 'recorded_at', a.recorded_at,
        'recorded_by', (select full_name from public.app_users where id = a.recorded_by))) from public.mrp_plan_actions a where a.plan_id = p.id), '{}')) end);
  elsif p_command = 'approve' then
    perform private.ap_keys(p_payload, array['fingerprint', 'note', 'weeks']);
    perform pg_advisory_xact_lock(hashtextextended(c.company_id::text || ':fs4-mrp', 0));
    v := private.fs4_mrp(c.company_id, coalesce(private.ap9_int(p_payload, 'weeks', 'Weeks', 1, 13), 8));
    if v ->> 'fingerprint' <> coalesce(p_payload ->> 'fingerprint', '') then
      return jsonb_build_object('state', 'stale', 'message', 'The requirements changed since you opened them. Review the new plan and approve again.');
    end if;
    if jsonb_array_length(v -> 'lines') = 0 then raise exception 'AP: Nothing to buy or cast this week.'; end if;
    update public.mrp_weekly_plans set status = 'superseded', superseded_at = clock_timestamp() where company_id = c.company_id and week_start = (v ->> 'week_start')::date and status = 'approved';
    insert into public.mrp_weekly_plans(company_id, week_start, fingerprint, lines, note, approved_by)
      values (c.company_id, (v ->> 'week_start')::date, v ->> 'fingerprint', v -> 'lines', private.ap_text(p_payload ->> 'note', 'Note', 3, 300, false), c.actor_id) returning * into p;
    insert into public.notifications(company_id, recipient_role, notification_type, severity, title, body, action_link, entity_reference)
      values (c.company_id, 'inventory_manager', 'mrp_plan', 'info', 'This week''s buy and cast plan is approved',
        jsonb_array_length(p.lines) || ' line(s) to action. Record the purchase order or cast against each.', '/production/material-plan', 'fs4:mrp:' || p.id);
    return jsonb_build_object('state', 'approved', 'id', p.id, 'lines', jsonb_array_length(p.lines));
  elsif p_command = 'action' then
    perform private.ap_keys(p_payload, array['plan_id', 'line_key', 'action', 'reference', 'note']);
    select * into p from public.mrp_weekly_plans where id = private.ap_uuid(p_payload, 'plan_id') and company_id = c.company_id and status = 'approved';
    if p.id is null then raise exception 'AP: Approved plan not found.'; end if;
    v_key := p_payload ->> 'line_key';
    if not exists (select 1 from jsonb_array_elements(p.lines) l where l ->> 'line_key' = v_key) then raise exception 'AP: This line is not in the approved plan.'; end if;
    v_action := p_payload ->> 'action';
    if coalesce(v_action, '') not in ('po_raised', 'cast_planned', 'not_needed') then raise exception 'AP: Choose what was done.'; end if;
    if v_action <> 'not_needed' and nullif(btrim(p_payload ->> 'reference'), '') is null then raise exception 'AP: Give the purchase order or cast reference.'; end if;
    if v_action = 'not_needed' and nullif(btrim(p_payload ->> 'note'), '') is null then raise exception 'AP: Say why it is not needed.'; end if;
    insert into public.mrp_plan_actions(company_id, plan_id, line_key, action, reference, note, recorded_by)
      values (c.company_id, p.id, v_key, v_action, private.ap_text(p_payload ->> 'reference', 'Reference', 2, 120, false), private.ap_text(p_payload ->> 'note', 'Note', 3, 300, false), c.actor_id)
      on conflict (plan_id, line_key) do nothing;
    if not found then raise exception 'AP: This line is already actioned.'; end if;
    return jsonb_build_object('plan_id', p.id, 'line_key', v_key, 'action', v_action);
  elsif p_command = 'history' then
    perform private.ap_keys(p_payload, array['page']);
    with q as (select x.id, x.week_start, x.status, x.approved_at, jsonb_array_length(x.lines) lines, u.full_name approved_by,
        (select count(*) from public.mrp_plan_actions a where a.plan_id = x.id) actioned, row_number() over (order by x.approved_at desc) k
      from public.mrp_weekly_plans x join public.app_users u on u.id = x.approved_by where x.company_id = c.company_id)
    select coalesce(jsonb_agg(to_jsonb(q) - 'k' order by q.k) filter (where q.k > (v_page - 1) * 10 and q.k <= v_page * 10), '[]'), count(*) into v_rows, v_total from q;
    return jsonb_build_object('rows', v_rows, 'page', v_page, 'total_count', v_total);
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.fs_mrp(text, jsonb) from public, anon;
grant execute on function public.fs_mrp(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- FS-26 stage: promise-date calculator and breakdown re-flow (reuses AP-069 capacity and AP-065 die windows)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.fs4_promise_estimate(p_company uuid, p_profile uuid, p_kg numeric, p_finishing text)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare cap jsonb; v_die_ready date; v_dies integer; v_capacity_day date; v_ready date; v_dispatch date; v_constraints jsonb := '[]'; v_alloy text; v_dia numeric; v_free numeric;
begin
  cap := private.ap8_capacity_for(p_company, p_profile, p_kg, 13, p_finishing);
  select count(*) into v_dies from public.dies d where d.company_id = p_company and d.profile_id = p_profile and d.deleted_at is null and d.die_status in ('active', 'approved');
  -- The earliest a usable die is back: a die without an open availability window is ready today.
  select min(coalesce((select max(w.expected_return) from public.die_availability_windows w where w.company_id = p_company and w.die_id = d.id and w.status = 'open'), private.ist_today()))
    into v_die_ready from public.dies d where d.company_id = p_company and d.profile_id = p_profile and d.deleted_at is null and d.die_status in ('active', 'approved');
  if v_dies = 0 then v_constraints := v_constraints || jsonb_build_array(jsonb_build_object('kind', 'die', 'blocking', true, 'text', 'No active or approved die for this profile.')); end if;
  if v_die_ready > private.ist_today() then v_constraints := v_constraints || jsonb_build_array(jsonb_build_object('kind', 'die', 'blocking', false, 'text', 'The die is away until ' || to_char(v_die_ready, 'DD Mon') || '.')); end if;
  if not (cap ->> 'configured')::boolean then v_constraints := v_constraints || jsonb_build_array(jsonb_build_object('kind', 'capacity', 'blocking', true, 'text', 'Shift capacity is not set for the presses that run this profile.')); end if;
  if (cap ->> 'beyond_horizon')::boolean then v_constraints := v_constraints || jsonb_build_array(jsonb_build_object('kind', 'capacity', 'blocking', true, 'text', 'No free capacity within thirteen weeks.')); end if;
  if cap ->> 'finishing_lead_days' is null and coalesce(nullif(p_finishing, ''), 'mill_finish') <> 'mill_finish' then
    v_constraints := v_constraints || jsonb_build_array(jsonb_build_object('kind', 'finishing', 'blocking', true, 'text', 'The finishing lead time is not recorded.'));
  end if;
  select upper(p.alloy), p.billet_diameter_required_inch into v_alloy, v_dia from public.aluminium_profiles p where p.id = p_profile and p.company_id = p_company;
  v_free := coalesce((select sum(b.available_weight_kg) from public.billet_batches b where b.company_id = p_company and b.status = 'available' and upper(btrim(b.alloy)) = v_alloy and abs(b.diameter_mm - v_dia * 25.4) <= 1), 0)
    + coalesce((select sum(coalesce(b.measured_weight_kg, b.weight_kg)) from public.foundry_billets b where b.company_id = p_company and b.status = 'cast' and b.order_id is null and b.production_job_id is null
      and upper(btrim(b.alloy)) = v_alloy and abs(b.billet_diameter_mm - v_dia * 25.4) <= 1), 0);
  if v_free < p_kg then v_constraints := v_constraints || jsonb_build_array(jsonb_build_object('kind', 'billet', 'blocking', false,
    'text', 'Free billet of this alloy and diameter (' || round(v_free) || ' kg) is below the finished quantity; see the material plan.')); end if;
  -- Earliest production: the later of the capacity week (end of that week, conservatively) and the die's return.
  if cap ->> 'earliest_week' is not null then v_capacity_day := (cap ->> 'earliest_week')::date + 6; end if;
  if v_capacity_day is not null and v_dies > 0 then
    v_ready := greatest(v_capacity_day, v_die_ready);
    v_ready := case when coalesce(nullif(p_finishing, ''), 'mill_finish') = 'mill_finish' then v_ready
      when cap ->> 'finishing_lead_days' is null then null else private.factory_add_working_days(p_company, v_ready, (cap ->> 'finishing_lead_days')::integer) end;
    -- Packing: one working day, the same fallback AP-063 uses when fewer than three packing observations exist.
    if v_ready is not null then v_dispatch := private.factory_add_working_days(p_company, v_ready, 1); end if;
  end if;
  return jsonb_build_object('earliest_dispatch', v_dispatch, 'production_by', v_capacity_day, 'die_ready', v_die_ready, 'usable_dies', v_dies, 'free_billet_kg', round(v_free, 1),
    'constraints', v_constraints, 'capacity', cap,
    'basis', 'Capacity: the press group''s free shift capacity after work already promised (week end, conservatively). Die: the later return of an away die. Finishing: the recorded lead time. Packing: one working day. Indicative; the order''s delivery promise check still applies.');
end;
$$;
revoke all on function private.fs4_promise_estimate(uuid, uuid, numeric, text) from public, anon, authenticated;

-- Work scheduled on a press with an open breakdown, with each order's promise and slack.
create or replace function private.fs4_breakdown_reflow(p_company uuid)
returns jsonb language sql stable security definer set search_path = public, private as $$
  with b as (
    select bl.id, bl.machine_ref_id machine_id, m.machine_name, bl.start_time, bl.breakdown_date, bl.issue_description, bl.status,
      greatest(1, ceil(extract(epoch from clock_timestamp() - coalesce(bl.start_time, bl.breakdown_date::timestamptz)) / 86400))::integer days_down
    from public.breakdown_logs bl join public.machines m on m.id = bl.machine_ref_id and m.company_id = p_company
    where bl.company_id = p_company and bl.status in ('open', 'in_progress') and bl.machine_ref_id is not null
  ),
  w as (
    select b.id breakdown_id, j.id job_id, j.job_number, j.order_id, o.order_number, (s.planned_end_at at time zone 'Asia/Kolkata')::date planned_end,
      coalesce(ls.required_date, o.expected_dispatch_date) promise, b.days_down,
      coalesce(ls.required_date, o.expected_dispatch_date) - (s.planned_end_at at time zone 'Asia/Kolkata')::date slack_days
    from b join public.production_plan_slots s on s.company_id = p_company and s.machine_id = b.machine_id and s.status in ('scheduled', 'released')
      and s.planned_end_at >= coalesce(b.start_time, b.breakdown_date::timestamptz)
    join public.production_jobs j on j.id = s.production_job_id and j.status not in ('completed', 'cancelled')
    join public.orders o on o.id = j.order_id
    left join public.order_line_schedules ls on ls.order_item_id = j.source_line_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('breakdown_id', b.id, 'machine_id', b.machine_id, 'press', b.machine_name, 'since', coalesce(b.start_time, b.breakdown_date::timestamptz),
      'days_down', b.days_down, 'issue', b.issue_description, 'status', b.status,
      'work', coalesce((select jsonb_agg(jsonb_build_object('job_id', w.job_id, 'job_number', w.job_number, 'order_id', w.order_id, 'order_number', w.order_number,
          'planned_end', w.planned_end, 'promise', w.promise, 'slack_days', w.slack_days, 'at_risk', w.promise is not null and w.slack_days < w.days_down) order by w.planned_end)
        from w where w.breakdown_id = b.id), '[]')) order by b.start_time), '[]')
  from b
$$;
revoke all on function private.fs4_breakdown_reflow(uuid) from public, anon, authenticated;

create or replace function public.fs_promise(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_profile uuid;
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'sales_manager', 'sales', 'factory_manager', 'production_manager']);
  if p_command = 'estimate' then
    perform private.ap_keys(p_payload, array['profile_id', 'quantity_kg', 'finishing_type']);
    v_profile := private.ap_uuid(p_payload, 'profile_id');
    if not exists (select 1 from public.aluminium_profiles where id = v_profile and company_id = c.company_id) then raise exception 'AP: Profile not found.'; end if;
    return private.fs4_promise_estimate(c.company_id, v_profile, private.ap4_num(p_payload, 'quantity_kg', 'Quantity', 1, 10000000),
      private.ap_text(p_payload ->> 'finishing_type', 'Finish', 2, 40, false));
  elsif p_command = 'reflow' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return jsonb_build_object('breakdowns', private.fs4_breakdown_reflow(c.company_id),
      'basis', 'Scheduled work on a press with an open breakdown. At risk when the days left between the slot''s planned end and the order promise are fewer than the days the press has been down.');
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.fs_promise(text, jsonb) from public, anon;
grant execute on function public.fs_promise(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- FS-54: new-profile and new-die development pipeline
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.development_projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_number text not null check (project_number ~ '^DEV-[0-9]{4}-[0-9]{3,}$'),
  title text not null check (length(btrim(title)) between 3 and 160),
  customer_id uuid not null references public.customers(id),
  drawing_reference text check (drawing_reference is null or length(btrim(drawing_reference)) between 2 and 120),
  stage text not null default 'enquiry' check (stage in ('enquiry', 'feasibility', 'die_quotation', 'die_ordered', 'die_received', 'trial', 'sample_submitted', 'customer_approval', 'released', 'dropped')),
  stage_since timestamptz not null default clock_timestamp(),
  owner_id uuid not null references public.app_users(id),
  feasibility jsonb check (feasibility is null or jsonb_typeof(feasibility) = 'object'),
  die_cost numeric(14,2) check (die_cost is null or die_cost >= 0),
  die_cost_payer text check (die_cost_payer is null or die_cost_payer in ('company', 'customer', 'shared')),
  amortisation_terms text check (amortisation_terms is null or length(btrim(amortisation_terms)) between 3 and 300),
  die_cost_approved_by_customer_at date,
  die_vendor_id uuid references public.vendors(id),
  expected_die_date date,
  die_id uuid references public.dies(id),
  profile_id uuid references public.aluminium_profiles(id),
  trial_count integer not null default 0 check (trial_count >= 0),
  sample_reference text check (sample_reference is null or length(btrim(sample_reference)) between 2 and 120),
  customer_approval_reference text check (customer_approval_reference is null or length(btrim(customer_approval_reference)) between 2 and 120),
  drop_reason text,
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (company_id, project_number),
  check (stage <> 'dropped' or length(btrim(drop_reason)) between 5 and 300)
);
create index if not exists development_projects_stage_idx on public.development_projects(company_id, stage, stage_since);
create table if not exists public.development_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.development_projects(id),
  from_stage text,
  to_stage text not null,
  note text not null check (length(btrim(note)) between 3 and 500),
  evidence jsonb not null default '{}' check (jsonb_typeof(evidence) = 'object'),
  owner_id uuid references public.app_users(id),
  recorded_by uuid not null references public.app_users(id),
  recorded_at timestamptz not null default clock_timestamp()
);
create index if not exists development_events_project_idx on public.development_events(company_id, project_id, recorded_at);
alter table public.development_projects enable row level security;
alter table public.development_events enable row level security;
revoke all on public.development_projects, public.development_events from public, anon, authenticated;

create or replace function private.fs4_guard_development_events()
returns trigger language plpgsql set search_path = public, private as $$
begin
  raise exception 'AP: Development history cannot be changed.' using errcode = '23514';
end;
$$;
revoke all on function private.fs4_guard_development_events() from public, anon, authenticated;
drop trigger if exists fs4_development_events_immutable on public.development_events;
create trigger fs4_development_events_immutable before update or delete on public.development_events for each row execute function private.fs4_guard_development_events();

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

create or replace function public.fs_development(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; d public.development_projects%rowtype; v_to text; v_note text; v_owner uuid; v_rows jsonb; v_total bigint; v_page integer := private.ap3_page(p_payload);
  v_order constant text[] := array['enquiry', 'feasibility', 'die_quotation', 'die_ordered', 'die_received', 'trial', 'sample_submitted', 'customer_approval', 'released'];
  v_seq integer; v_f jsonb; v_trials integer;
begin
  if p_command in ('board', 'list', 'get') then
    select * into c from private.ap_ctx(array['owner', 'admin', 'sales_manager', 'sales', 'production_manager', 'factory_manager', 'quality', 'production']);
  else select * into c from private.ap_ctx(array['owner', 'admin', 'sales_manager', 'sales', 'production_manager', 'factory_manager', 'quality']); end if;

  if p_command = 'board' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return jsonb_build_object('stages', (select jsonb_agg(jsonb_build_object('stage', s.stage, 'count', (select count(*) from public.development_projects x where x.company_id = c.company_id and x.stage = s.stage),
      'projects', coalesce((select jsonb_agg(private.fs4_dev_row(c.company_id, y.r) order by (y.r).stage_since) from (select x r from public.development_projects x
        where x.company_id = c.company_id and x.stage = s.stage order by x.stage_since limit 10) y), '[]')) order by s.n) from unnest(v_order) with ordinality s(stage, n)));
  elsif p_command = 'list' then
    perform private.ap_keys(p_payload, array['page', 'stage', 'search']);
    with q as (select x r, row_number() over (order by x.updated_at desc) k from public.development_projects x where x.company_id = c.company_id
      and (nullif(p_payload ->> 'stage', '') is null or x.stage = p_payload ->> 'stage')
      and (nullif(btrim(p_payload ->> 'search'), '') is null or x.title ilike '%' || btrim(p_payload ->> 'search') || '%' or x.project_number ilike '%' || btrim(p_payload ->> 'search') || '%'))
    select coalesce(jsonb_agg(private.fs4_dev_row(c.company_id, q.r) order by q.k) filter (where q.k > (v_page - 1) * 10 and q.k <= v_page * 10), '[]'), count(*) into v_rows, v_total from q;
    return jsonb_build_object('rows', v_rows, 'page', v_page, 'total_count', v_total);
  elsif p_command = 'get' then
    perform private.ap_keys(p_payload, array['id']);
    select * into d from public.development_projects where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id;
    if d.id is null then raise exception 'AP: Development not found.'; end if;
    return private.fs4_dev_row(c.company_id, d) || jsonb_build_object('events', coalesce((select jsonb_agg(jsonb_build_object('from_stage', e.from_stage, 'to_stage', e.to_stage, 'note', e.note,
      'evidence', e.evidence, 'owner', (select full_name from public.app_users where id = e.owner_id), 'recorded_by', u.full_name, 'recorded_at', e.recorded_at) order by e.recorded_at)
      from public.development_events e join public.app_users u on u.id = e.recorded_by where e.project_id = d.id), '[]'));
  elsif p_command = 'create' then
    perform private.ap_keys(p_payload, array['title', 'customer_id', 'drawing_reference', 'owner_id', 'note']);
    if not exists (select 1 from public.customers where id = private.ap_uuid(p_payload, 'customer_id') and company_id = c.company_id and deleted_at is null) then raise exception 'AP: Customer not found.'; end if;
    v_owner := coalesce(private.ap_uuid(p_payload, 'owner_id', false), c.actor_id);
    if not exists (select 1 from public.app_users where id = v_owner and company_id = c.company_id and is_active and dealer_id is null) then raise exception 'AP: Choose an active employee as owner.'; end if;
    perform pg_advisory_xact_lock(hashtextextended(c.company_id::text || ':fs4-dev-number', 0));
    insert into public.development_projects(company_id, project_number, title, customer_id, drawing_reference, owner_id, created_by)
      values (c.company_id, 'DEV-' || to_char(private.ist_today(), 'YYYY') || '-' || lpad((coalesce((select max(substring(project_number from '[0-9]+$')::integer) from public.development_projects
          where company_id = c.company_id and project_number like 'DEV-' || to_char(private.ist_today(), 'YYYY') || '-%'), 0) + 1)::text, 3, '0'),
        private.ap_text(p_payload ->> 'title', 'Title', 3, 160), (p_payload ->> 'customer_id')::uuid, private.ap_text(p_payload ->> 'drawing_reference', 'Drawing reference', 2, 120, false), v_owner, c.actor_id)
      returning * into d;
    insert into public.development_events(company_id, project_id, from_stage, to_stage, note, owner_id, recorded_by)
      values (c.company_id, d.id, null, 'enquiry', coalesce(private.ap_text(p_payload ->> 'note', 'Note', 3, 500, false), 'Enquiry recorded'), v_owner, c.actor_id);
    return private.fs4_dev_row(c.company_id, d);
  elsif p_command = 'update' then
    -- Facts a later stage needs; recorded once, changed only before the project is released.
    perform private.ap_keys(p_payload, array['id', 'feasibility', 'die_cost', 'die_cost_payer', 'amortisation_terms', 'die_cost_approved_by_customer_at', 'die_vendor_id', 'expected_die_date',
      'die_id', 'profile_id', 'sample_reference', 'customer_approval_reference', 'drawing_reference', 'owner_id']);
    select * into d from public.development_projects where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id for update;
    if d.id is null then raise exception 'AP: Development not found.'; end if;
    if d.stage in ('released', 'dropped') then raise exception 'AP: A released or dropped development cannot be changed.'; end if;
    if p_payload ? 'feasibility' then
      v_f := p_payload -> 'feasibility';
      if jsonb_typeof(v_f) <> 'object' or exists (select 1 from jsonb_object_keys(v_f) k where k not in ('ccd_mm', 'weight_kg_per_m', 'min_wall_mm', 'tongue_ratio', 'press_id', 'verdict', 'note')) then
        raise exception 'AP: Invalid feasibility details.'; end if;
      if coalesce(v_f ->> 'verdict', 'pending') not in ('pending', 'feasible', 'not_feasible') then raise exception 'AP: Choose a feasibility verdict.'; end if;
      if v_f ? 'press_id' and nullif(v_f ->> 'press_id', '') is not null and not exists (select 1 from public.machines where id = (v_f ->> 'press_id')::uuid and company_id = c.company_id) then
        raise exception 'AP: Press not found.'; end if;
      perform private.ap4_num(v_f, 'ccd_mm', 'Circumscribing circle', 1, 1000, false); perform private.ap4_num(v_f, 'weight_kg_per_m', 'Weight per metre', 0.001, 100, false);
      perform private.ap4_num(v_f, 'min_wall_mm', 'Minimum wall', 0.1, 100, false); perform private.ap4_num(v_f, 'tongue_ratio', 'Tongue ratio', 0, 50, false);
    end if;
    if p_payload ? 'die_cost_payer' and coalesce(p_payload ->> 'die_cost_payer', '') not in ('', 'company', 'customer', 'shared') then raise exception 'AP: Choose who pays for the die.'; end if;
    if nullif(p_payload ->> 'die_vendor_id', '') is not null and not exists (select 1 from public.vendors where id = (p_payload ->> 'die_vendor_id')::uuid and company_id = c.company_id) then raise exception 'AP: Die maker not found.'; end if;
    if nullif(p_payload ->> 'die_id', '') is not null and not exists (select 1 from public.dies where id = (p_payload ->> 'die_id')::uuid and company_id = c.company_id and deleted_at is null) then raise exception 'AP: Die not found.'; end if;
    if nullif(p_payload ->> 'profile_id', '') is not null and not exists (select 1 from public.aluminium_profiles where id = (p_payload ->> 'profile_id')::uuid and company_id = c.company_id) then raise exception 'AP: Profile not found.'; end if;
    if nullif(p_payload ->> 'owner_id', '') is not null and not exists (select 1 from public.app_users where id = (p_payload ->> 'owner_id')::uuid and company_id = c.company_id and is_active and dealer_id is null) then
      raise exception 'AP: Choose an active employee as owner.'; end if;
    update public.development_projects set
      feasibility = case when p_payload ? 'feasibility' then v_f else feasibility end,
      die_cost = case when p_payload ? 'die_cost' then private.ap4_num(p_payload, 'die_cost', 'Die cost', 0, 100000000, false) else die_cost end,
      die_cost_payer = case when p_payload ? 'die_cost_payer' then nullif(p_payload ->> 'die_cost_payer', '') else die_cost_payer end,
      amortisation_terms = case when p_payload ? 'amortisation_terms' then private.ap_text(p_payload ->> 'amortisation_terms', 'Amortisation terms', 3, 300, false) else amortisation_terms end,
      die_cost_approved_by_customer_at = case when p_payload ? 'die_cost_approved_by_customer_at' then nullif(p_payload ->> 'die_cost_approved_by_customer_at', '')::date else die_cost_approved_by_customer_at end,
      die_vendor_id = case when p_payload ? 'die_vendor_id' then nullif(p_payload ->> 'die_vendor_id', '')::uuid else die_vendor_id end,
      expected_die_date = case when p_payload ? 'expected_die_date' then nullif(p_payload ->> 'expected_die_date', '')::date else expected_die_date end,
      die_id = case when p_payload ? 'die_id' then nullif(p_payload ->> 'die_id', '')::uuid else die_id end,
      profile_id = case when p_payload ? 'profile_id' then nullif(p_payload ->> 'profile_id', '')::uuid else profile_id end,
      sample_reference = case when p_payload ? 'sample_reference' then private.ap_text(p_payload ->> 'sample_reference', 'Sample reference', 2, 120, false) else sample_reference end,
      customer_approval_reference = case when p_payload ? 'customer_approval_reference' then private.ap_text(p_payload ->> 'customer_approval_reference', 'Customer approval reference', 2, 120, false) else customer_approval_reference end,
      drawing_reference = case when p_payload ? 'drawing_reference' then private.ap_text(p_payload ->> 'drawing_reference', 'Drawing reference', 2, 120, false) else drawing_reference end,
      owner_id = coalesce(nullif(p_payload ->> 'owner_id', '')::uuid, owner_id), updated_at = clock_timestamp()
      where id = d.id returning * into d;
    return private.fs4_dev_row(c.company_id, d);
  elsif p_command = 'move' then
    perform private.ap_keys(p_payload, array['id', 'to_stage', 'note', 'owner_id']);
    select * into d from public.development_projects where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id for update;
    if d.id is null then raise exception 'AP: Development not found.'; end if;
    if d.stage in ('released', 'dropped') then raise exception 'AP: This development is closed.'; end if;
    v_to := p_payload ->> 'to_stage';
    v_note := private.ap_text(p_payload ->> 'note', 'Note', 3, 500);
    v_owner := coalesce(nullif(p_payload ->> 'owner_id', '')::uuid, d.owner_id);
    if not exists (select 1 from public.app_users where id = v_owner and company_id = c.company_id and is_active and dealer_id is null) then raise exception 'AP: Choose an active employee as owner.'; end if;
    if v_to = 'dropped' then
      update public.development_projects set stage = 'dropped', stage_since = clock_timestamp(), drop_reason = v_note, updated_at = clock_timestamp() where id = d.id returning * into d;
    else
      v_seq := array_position(v_order, v_to);
      if v_seq is null then raise exception 'AP: Choose a stage.'; end if;
      -- Forward one stage at a time; back to any earlier stage (another trial, a revised quotation) with a note.
      if v_seq > array_position(v_order, d.stage) + 1 then raise exception 'AP: Move one stage at a time.'; end if;
      if v_seq = array_position(v_order, d.stage) and v_to <> 'trial' then raise exception 'AP: The development is already at this stage.'; end if;
      if v_seq > array_position(v_order, d.stage) or (v_to = 'trial' and d.stage = 'trial') then
        if v_to = 'die_quotation' and coalesce(d.feasibility ->> 'verdict', '') <> 'feasible' then raise exception 'AP: Record a feasible verdict before quoting the die.'; end if;
        if v_to = 'die_ordered' and (d.die_cost is null or d.die_cost_payer is null or d.expected_die_date is null) then raise exception 'AP: Record the die cost, who pays and the expected die date first.'; end if;
        if v_to = 'die_ordered' and d.die_cost_payer in ('customer', 'shared') and d.die_cost_approved_by_customer_at is null then raise exception 'AP: Record the customer''s approval of the die cost first.'; end if;
        if v_to = 'die_received' and d.die_id is null then raise exception 'AP: Link the received die record first.'; end if;
        if v_to = 'sample_submitted' then
          select count(*) into v_trials from public.die_trials t where t.company_id = c.company_id and t.die_id = d.die_id;
          if v_trials = 0 then raise exception 'AP: Record at least one trial on the die first.'; end if;
          if d.sample_reference is null then raise exception 'AP: Record the sample reference first.'; end if;
        end if;
        if v_to = 'released' and (d.customer_approval_reference is null or d.profile_id is null) then raise exception 'AP: Record the customer''s approval and link the profile first.'; end if;
      end if;
      update public.development_projects set stage = v_to, stage_since = clock_timestamp(), owner_id = v_owner,
        trial_count = trial_count + case when v_to = 'trial' then 1 else 0 end, updated_at = clock_timestamp() where id = d.id returning * into d;
    end if;
    insert into public.development_events(company_id, project_id, from_stage, to_stage, note, evidence, owner_id, recorded_by)
      values (c.company_id, d.id, (select e.to_stage from public.development_events e where e.project_id = d.id order by e.recorded_at desc, e.id desc limit 1), v_to, v_note,
        jsonb_strip_nulls(jsonb_build_object('die_cost', d.die_cost, 'die_cost_payer', d.die_cost_payer, 'amortisation_terms', d.amortisation_terms, 'die_id', d.die_id,
          'trial_count', d.trial_count, 'sample_reference', d.sample_reference, 'customer_approval_reference', d.customer_approval_reference)), v_owner, c.actor_id);
    if v_owner is distinct from c.actor_id then
      insert into public.notifications(company_id, recipient_user_id, notification_type, severity, title, body, action_link, entity_reference)
        values (c.company_id, v_owner, 'development_stage', 'info', d.project_number || ' is with you: ' || replace(v_to, '_', ' '), left(v_note, 300), '/profiles/development/' || d.id, 'fs4:dev:' || d.id);
    end if;
    return private.fs4_dev_row(c.company_id, d);
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.fs_development(text, jsonb) from public, anon;
grant execute on function public.fs_development(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- FS-38: owner cockpit. Yesterday's figures are the stored AP-080 digest, so the screen and the message always agree.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.fs4_cockpit(p_company uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_digest jsonb := private.ap5_digest(p_company); m jsonb; v_book jsonb; v_otif jsonb; v_metal jsonb; v_cash jsonb; v_today date := private.ist_today();
  v_free_billet numeric; v_daily_billet numeric; v_exceptions jsonb; v_text text; v_low jsonb;
begin
  m := v_digest -> 'metrics';
  v_book := private.fs4_order_book(p_company);
  v_otif := private.fs4_otif_summary(p_company, v_today - 29, v_today);
  v_metal := private.fs4_metal_exposure(p_company);
  v_cash := private.ap9_cash_forecast(p_company, 13);
  select w into v_low from jsonb_array_elements(v_cash -> 'weeks') w where w ? 'closing' order by (w ->> 'closing')::numeric limit 1;
  v_free_billet := coalesce((select sum(b.available_weight_kg) from public.billet_batches b where b.company_id = p_company and b.status = 'available'), 0)
    + coalesce((select sum(coalesce(b.measured_weight_kg, b.weight_kg)) from public.foundry_billets b where b.company_id = p_company and b.status = 'cast' and b.order_id is null and b.production_job_id is null), 0);
  v_daily_billet := (select sum(j.input_billet_weight) / 30 from public.production_jobs j where j.company_id = p_company and j.status = 'completed' and j.input_billet_weight > 0
    and j.completed_at >= clock_timestamp() - interval '30 days');
  v_exceptions := jsonb_build_array(
    jsonb_build_object('key', 'late_lines', 'label', 'Order lines likely late', 'count', coalesce((m ->> 'red_lines')::integer, 0), 'href', '/orders/at-risk'),
    jsonb_build_object('key', 'held_stock', 'label', 'Finished stock on quality hold', 'count', (select count(*) from public.profile_stock_batches s where s.company_id = p_company and s.qc_status = 'on_hold' and s.status = 'available'),
      'kg', (select round(coalesce(sum(s.total_weight_kg), 0), 1) from public.profile_stock_batches s where s.company_id = p_company and s.qc_status = 'on_hold' and s.status = 'available'), 'href', '/inventory'),
    jsonb_build_object('key', 'breakdowns', 'label', 'Presses broken down', 'count', (select count(*) from public.breakdown_logs b where b.company_id = p_company and b.status in ('open', 'in_progress')), 'href', '/production/promise'),
    jsonb_build_object('key', 'failed_heats', 'label', 'Heats failed chemistry (7 days)', 'count', (select count(distinct t.foundry_batch_id) from public.foundry_chemistry_tests t where t.company_id = p_company and t.result = 'fail'
      and t.tested_at >= clock_timestamp() - interval '7 days'), 'href', '/foundry'),
    jsonb_build_object('key', 'credit_holds', 'label', 'Orders held on credit', 'count', coalesce((m ->> 'credit_holds')::integer, 0), 'href', '/orders/credit'));
  v_text := 'Omalco owner brief - ' || to_char(v_today, 'DD Mon YYYY') || E'\n'
    || 'Yesterday: production ' || coalesce(round((m ->> 'production_kg')::numeric / 1000, 2)::text || ' t', 'unknown') || ', recovery ' || coalesce((m ->> 'recovery_percent') || '%', 'unknown')
    || '; dispatch ' || round(coalesce((m ->> 'dispatch_kg')::numeric, 0) / 1000, 2) || ' t; invoiced INR ' || to_char(coalesce((m ->> 'invoiced')::numeric, 0), 'FM99,99,99,99,990') || E'\n'
    || 'Cash in yesterday INR ' || to_char(coalesce((m ->> 'collections')::numeric, 0), 'FM99,99,99,99,990') || '; overdue INR ' || to_char(coalesce((m ->> 'overdue')::numeric, 0), 'FM99,99,99,99,990') || E'\n'
    || 'Order book ' || round(coalesce((v_book -> 'order_book' ->> 'open_kg')::numeric, 0) / 1000, 1) || ' t; billet stock ' || coalesce(round(v_free_billet / nullif(v_daily_billet, 0), 1)::text || ' days', 'days unknown') || E'\n'
    || 'OTIF (30 days) ' || coalesce((v_otif ->> 'otif_percent') || '%', 'no lines due') || '; metal position ' || round(abs((v_metal ->> 'net_kg')::numeric) / 1000, 1) || ' t ' || (v_metal ->> 'direction') || E'\n'
    || 'Exceptions: ' || coalesce((select string_agg((e ->> 'label') || ' ' || (e ->> 'count'), '; ') from jsonb_array_elements(v_exceptions) e where (e ->> 'count')::integer > 0), 'none') || E'\n'
    || 'Yesterday''s figures as of ' || to_char((v_digest ->> 'generated_at')::timestamptz at time zone 'Asia/Kolkata', 'DD Mon HH24:MI') || ' IST. Internal management summary.';
  return jsonb_build_object('as_of', clock_timestamp(), 'digest_generated_at', v_digest ->> 'generated_at', 'digest_date', v_digest ->> 'digest_date', 'yesterday', m,
    'order_book', jsonb_build_object('open_kg', v_book -> 'order_book' -> 'open_kg', 'presses', v_book -> 'presses'),
    'billet', jsonb_build_object('free_kg', round(v_free_billet, 1), 'daily_use_kg', round(v_daily_billet, 1), 'days', round(v_free_billet / nullif(v_daily_billet, 0), 1)),
    'otif', jsonb_build_object('percent', v_otif -> 'otif_percent', 'due', v_otif -> 'due', 'otif', v_otif -> 'otif'),
    'metal', jsonb_build_object('net_kg', v_metal -> 'net_kg', 'direction', v_metal -> 'direction', 'over_limit', v_metal -> 'over_limit', 'limit_kg', v_metal -> 'limit_kg'),
    'cash', jsonb_build_object('first_week_below_minimum', v_cash -> 'first_week_below_minimum', 'lowest_week', v_low ->> 'week_start', 'lowest_closing', v_low -> 'closing', 'opening_balance', v_cash -> 'opening_balance'),
    'exceptions', v_exceptions, 'message', v_text);
end;
$$;
revoke all on function private.fs4_cockpit(uuid) from public, anon, authenticated;

create or replace function public.fs_cockpit(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record;
begin
  select * into c from private.ap_ctx(array['owner', 'admin']);
  if p_command = 'today' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return private.fs4_cockpit(c.company_id);
  elsif p_command = 'trend' then
    perform private.ap_keys(p_payload, array[]::text[]);
    -- Weekly and monthly versions from the stored daily digests (each figure is yesterday's at its digest date).
    return (with d as (select digest_date - 1 as on_day, metrics from public.owner_daily_digests where company_id = c.company_id and digest_date > private.ist_today() - 62),
      per as (select case when on_day > private.ist_today() - 8 then 'this_week' when on_day > private.ist_today() - 15 then 'last_week' end wk,
        case when on_day > private.ist_today() - 31 then 'this_month' else 'last_month' end mo, metrics m from d)
      select jsonb_build_object('weeks', (select jsonb_object_agg(wk, jsonb_build_object('days', n, 'production_kg', p, 'dispatch_kg', dk, 'invoiced', inv, 'collections', col)) from
          (select wk, count(*) n, round(sum((m ->> 'production_kg')::numeric), 1) p, round(sum((m ->> 'dispatch_kg')::numeric), 1) dk, round(sum((m ->> 'invoiced')::numeric), 2) inv,
            round(sum((m ->> 'collections')::numeric), 2) col from per where wk is not null group by wk) x),
        'months', (select jsonb_object_agg(mo, jsonb_build_object('days', n, 'production_kg', p, 'dispatch_kg', dk, 'invoiced', inv, 'collections', col)) from
          (select mo, count(*) n, round(sum((m ->> 'production_kg')::numeric), 1) p, round(sum((m ->> 'dispatch_kg')::numeric), 1) dk, round(sum((m ->> 'invoiced')::numeric), 2) inv,
            round(sum((m ->> 'collections')::numeric), 2) col from per group by mo) x),
        'basis', 'Sums of the stored morning digests: this week = the last seven days, last week = the seven before; this month = the last thirty days, last month = the thirty before. Days without a digest are counted as missing, not zero.'));
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.fs_cockpit(text, jsonb) from public, anon;
grant execute on function public.fs_cockpit(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- FS-36: live screens. Realtime delivers row changes only to sessions whose RLS select policy admits the row; the
-- browser then re-reads through the usual server path. Only the tables behind the five live screens are published.
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['production_jobs', 'production_push_events', 'production_plan_slots', 'breakdown_logs', 'orders', 'dispatches', 'notifications', 'action_requests', 'approval_decisions'] loop
      if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = t)
         and not exists (select 1 from pg_publication_rel pr join pg_publication p on p.oid = pr.prpubid
           where p.pubname = 'supabase_realtime' and pr.prrelid = ('public.' || quote_ident(t))::regclass) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;

-- The production-office wall: each press, its current job, output rate against the current shift's target (AP-066
-- definitions: target from the plan, estimated output from recorded pushes), the next die and any stoppage.
create or replace function private.fs4_wall(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare m record; v_rows jsonb := '[]'; v_now timestamptz := clock_timestamp(); v_day date := private.ist_today(); v_start timestamptz; v_end timestamptz; v_shift text;
  v_target jsonb; v_actual jsonb; v_hours numeric; v_elapsed numeric; v_job record; v_next record; v_stop record;
begin
  for m in select x.id, x.machine_name, x.machine_code from public.machines x where x.company_id = p_company and coalesce(x.is_active, true)
      and x.machine_type = 'extrusion_press' order by x.machine_name loop
    v_start := null; v_end := null; v_shift := null; v_target := null; v_actual := null;
    select s.shift_name, (v_day + s.starts_local) at time zone 'Asia/Kolkata', ((v_day + case when s.ends_local <= s.starts_local then 1 else 0 end) + s.ends_local) at time zone 'Asia/Kolkata'
      into v_shift, v_start, v_end from public.factory_shift_capacities s
      where s.company_id = p_company and s.machine_id = m.id and s.weekday = extract(isodow from v_day)
        and v_now >= (v_day + s.starts_local) at time zone 'Asia/Kolkata'
        and v_now < ((v_day + case when s.ends_local <= s.starts_local then 1 else 0 end) + s.ends_local) at time zone 'Asia/Kolkata'
      order by s.starts_local limit 1;
    if v_start is not null then
      v_target := private.ap2_shift_target(p_company, m.id, v_start, v_end);
      v_actual := private.ap2_shift_actual(p_company, m.id, v_start, least(v_end, v_now));
      v_hours := extract(epoch from v_end - v_start) / 3600; v_elapsed := greatest(extract(epoch from least(v_end, v_now) - v_start) / 3600, 0.01);
    end if;
    select j.id, j.job_number, p.profile_code, d.die_number, j.planned_quantity_kg into v_job from public.production_jobs j
      left join public.aluminium_profiles p on p.id = j.profile_id left join public.dies d on d.id = j.die_id
      where j.company_id = p_company and j.machine_id = m.id and j.status = 'in_progress' order by j.updated_at desc limit 1;
    select j.job_number, d.die_number, s.planned_start_at into v_next from public.production_plan_slots s join public.production_jobs j on j.id = s.production_job_id
      left join public.dies d on d.id = j.die_id
      where s.company_id = p_company and s.machine_id = m.id and s.status in ('scheduled', 'released') and s.planned_start_at > v_now and j.status not in ('completed', 'cancelled')
        and (v_job.id is null or j.id <> v_job.id) order by s.planned_start_at limit 1;
    select b.id, b.issue_description, coalesce(b.start_time, b.breakdown_date::timestamptz) since into v_stop from public.breakdown_logs b
      where b.company_id = p_company and b.machine_ref_id = m.id and b.status in ('open', 'in_progress') order by b.start_time desc nulls last limit 1;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object('machine_id', m.id, 'press', m.machine_name, 'code', m.machine_code,
      'job', case when v_job.id is null then null else jsonb_build_object('id', v_job.id, 'job_number', v_job.job_number, 'profile_code', v_job.profile_code, 'die_number', v_job.die_number, 'planned_kg', v_job.planned_quantity_kg) end,
      'shift', v_shift, 'target_kg', v_target -> 'target_kg', 'output_kg', v_actual -> 'estimated_output_kg', 'pushes', v_actual -> 'pushes', 'last_push_at', v_actual -> 'last_push_at',
      'target_kg_per_hour', case when (v_target ->> 'target_kg') is not null and v_hours > 0 then round((v_target ->> 'target_kg')::numeric / v_hours, 1) end,
      'output_kg_per_hour', case when v_actual is not null then round(coalesce((v_actual ->> 'estimated_output_kg')::numeric, 0) / v_elapsed, 1) end,
      'next', case when v_next.job_number is null and v_next.planned_start_at is null then null else jsonb_build_object('job_number', v_next.job_number, 'die_number', v_next.die_number, 'starts_at', v_next.planned_start_at) end,
      'stoppage', case when v_stop.id is null then null else jsonb_build_object('since', v_stop.since, 'issue', v_stop.issue_description) end));
  end loop;
  return jsonb_build_object('as_of', v_now, 'presses', v_rows,
    'basis', 'Target: the current shift''s planned output (AP-066). Output: estimated good kg from recorded pushes this shift. Rates are per hour of the shift so far.');
end;
$$;
revoke all on function private.fs4_wall(uuid) from public, anon, authenticated;

create or replace function public.fs_wall(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record;
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'factory_manager', 'production_manager', 'production', 'quality', 'viewer', 'dispatch_manager', 'sales_manager']);
  if p_command = 'board' then perform private.ap_keys(p_payload, array[]::text[]); return private.fs4_wall(c.company_id); end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.fs_wall(text, jsonb) from public, anon;
grant execute on function public.fs_wall(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Morning job (AP-001 ledger): metal position snapshot and limit alert (FS-72), die replacement warnings (FS-16)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.fs4_morning_job(p_company uuid, p_run uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v jsonb; v_dies integer;
begin
  v := private.fs4_exposure_snapshot(p_company);
  v_dies := private.fs4_die_alerts(p_company);
  return jsonb_build_object('examined', 1, 'proposals', 0, 'alerts', coalesce((v ->> 'alerts')::integer, 0) + v_dies, 'snapshots', coalesce((v ->> 'snapshots')::integer, 0));
end;
$$;
revoke all on function private.fs4_morning_job(uuid, uuid) from public, anon, authenticated;

alter function private.ap_job_registry() rename to fs4_previous_job_registry;
create function private.ap_job_registry() returns table(job_key text, schedule text, label text, description text)
language sql immutable set search_path = public, private as $$
  select * from private.fs4_previous_job_registry() union all values
    ('intelligence.morning', 'morning', 'Check metal position and die life', 'Keeps the day''s metal position and alerts the owner when it passes the limit; warns the die shop when a die''s remaining life is short of demand plus lead time.')
$$;
revoke all on function private.ap_job_registry() from public, anon, authenticated;

alter function private.ap_job_execute(uuid, text, uuid) rename to fs4_previous_job_execute;
create function private.ap_job_execute(p_company uuid, p_job text, p_run uuid) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if p_job = 'intelligence.morning' then return private.fs4_morning_job(p_company, p_run); end if;
  return private.fs4_previous_job_execute(p_company, p_job, p_run);
end;
$$;
revoke all on function private.ap_job_execute(uuid, text, uuid) from public, anon, authenticated;

commit;

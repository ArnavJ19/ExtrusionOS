-- Autopilot batch 4: dispatch and compliance (AP-018, 019, 051, 081, 083, 017, 035, 036, 089, 060).
-- Additive only. Every new table has company_id, RLS, a role-scoped company read policy, a company-leading index and no
-- client write grant; reads and writes go through the security-definer entry points below, which take the company and
-- the actor from auth.uid(). Nothing here posts stock, money, quality approval or a customer message by itself: loading
-- sessions end in the existing dispatch writer, the gate records an exit, exports are files a person uploads.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '180s';

-- ---------------------------------------------------------------------------------------------------------------
-- Extend earlier check lists (supersets only)
-- ---------------------------------------------------------------------------------------------------------------
alter table public.proposals drop constraint if exists proposals_proposal_type_check;
alter table public.proposals add constraint proposals_proposal_type_check check (proposal_type in (
  'navigation.role_layout', 'period.close_month', 'series.adopt',
  'production.expected_output', 'die.service_due', 'maintenance.pm_due',
  'bank.receipt_match',
  'freight.estimate'));

-- ---------------------------------------------------------------------------------------------------------------
-- Settings (one row per company; defaults apply until a supervisor saves them)
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.dispatch_autopilot_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  eway_threshold numeric(15,2) not null default 50000 check (eway_threshold >= 0 and eway_threshold <= 100000000),
  eway_gate_policy text not null default 'warn' check (eway_gate_policy in ('warn', 'block')),
  status_link_days integer not null default 14 check (status_link_days between 1 and 90),
  updated_by uuid references public.app_users(id),
  updated_at timestamptz not null default clock_timestamp()
);

create or replace function private.ap4_settings(p_company uuid)
returns public.dispatch_autopilot_settings language plpgsql stable security definer set search_path = public, private as $$
declare s public.dispatch_autopilot_settings%rowtype;
begin
  select * into s from public.dispatch_autopilot_settings where company_id = p_company;
  if s.company_id is null then s.company_id := p_company; s.eway_threshold := 50000; s.eway_gate_policy := 'warn'; s.status_link_days := 14; end if;
  return s;
end;
$$;
revoke all on function private.ap4_settings(uuid) from public, anon, authenticated;

-- Role groups used across the batch.
create or replace function private.ap4_dispatch_roles() returns text[] language sql immutable set search_path = public, private as $$
  select array['owner', 'admin', 'factory_manager', 'dispatch_manager', 'dispatch', 'inventory_manager'] $$;
create or replace function private.ap4_supervisor_roles() returns text[] language sql immutable set search_path = public, private as $$
  select array['owner', 'admin', 'factory_manager', 'dispatch_manager'] $$;
create or replace function private.ap4_gate_roles() returns text[] language sql immutable set search_path = public, private as $$
  select array['owner', 'admin', 'factory_manager', 'dispatch_manager', 'dispatch'] $$;
create or replace function private.ap4_ready_roles() returns text[] language sql immutable set search_path = public, private as $$
  select array['owner', 'admin', 'factory_manager', 'dispatch_manager', 'dispatch', 'inventory_manager', 'sales_manager', 'sales', 'accounts', 'production_manager'] $$;
revoke all on function private.ap4_dispatch_roles() from public, anon, authenticated;
revoke all on function private.ap4_supervisor_roles() from public, anon, authenticated;
revoke all on function private.ap4_gate_roles() from public, anon, authenticated;
revoke all on function private.ap4_ready_roles() from public, anon, authenticated;

create or replace function private.ap4_need(p_role text, p_roles text[]) returns void language plpgsql immutable set search_path = public, private as $$
begin
  if not (p_role = any(p_roles)) then raise exception 'Not permitted' using errcode = '42501'; end if;
end;
$$;
revoke all on function private.ap4_need(text, text[]) from public, anon, authenticated;

/** Vehicle registration as compared at the gate: letters and digits only, upper case. */
create or replace function private.ap4_norm_vehicle(p text) returns text language sql immutable set search_path = public, private as $$
  select nullif(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')), '') $$;
revoke all on function private.ap4_norm_vehicle(text) from public, anon, authenticated;

create or replace function private.ap4_num(p_payload jsonb, p_key text, p_label text, p_min numeric, p_max numeric, p_required boolean default true)
returns numeric language plpgsql immutable set search_path = public, private as $$
declare v numeric; t text := nullif(btrim(coalesce(p_payload ->> p_key, '')), '');
begin
  if t is null then
    if p_required then raise exception 'AP: % is required.', p_label; end if;
    return null;
  end if;
  begin v := t::numeric; exception when others then raise exception 'AP: % must be a number.', p_label; end;
  if v::text in ('NaN', 'Infinity', '-Infinity') or v < p_min or v > p_max then raise exception 'AP: % must be between % and %.', p_label, p_min, p_max; end if;
  return v;
end;
$$;
revoke all on function private.ap4_num(jsonb, text, text, numeric, numeric, boolean) from public, anon, authenticated;

create or replace function private.ap4_day(p_payload jsonb, p_key text, p_required boolean default true)
returns date language plpgsql immutable set search_path = public, private as $$
declare t text := nullif(btrim(coalesce(p_payload ->> p_key, '')), '');
begin
  if t is null then
    if p_required then raise exception 'AP: Choose the % date.', replace(p_key, '_', ' '); end if;
    return null;
  end if;
  if t !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'AP: Use a valid date for %.', replace(p_key, '_', ' '); end if;
  return t::date;
end;
$$;
revoke all on function private.ap4_day(jsonb, text, boolean) from public, anon, authenticated;

create or replace function private.ap4_user_name(p_user uuid) returns text language sql stable security definer set search_path = public, private as $$
  select coalesce(nullif(btrim(u.full_name), ''), u.email, 'Employee') from public.app_users u where u.id = p_user $$;
revoke all on function private.ap4_user_name(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Bundle readiness. Mirrors private.assert_dispatch_ready per source so a scan or the ready list never promises a
-- bundle the dispatch writer would refuse: production needs QC-approved and packaged output (or accepted finishing),
-- a reservation needs a QC-released batch, dealer stock its open fulfilment. Returns what is still dispatchable.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.ap4_source_available(p_company uuid, p_order uuid, p_kind text, p_source uuid)
returns table(available_kg numeric, reason text) language plpgsql stable security definer set search_path = public, private as $$
declare v_quality boolean; j record; r record; f record; v_ready numeric := 0; v_used numeric := 0; v_approved numeric; v_packaged numeric; v_reason text; v_qc text;
begin
  select coalesce((select ff.is_enabled from public.feature_flags ff where ff.company_id = p_company and ff.module_name = 'quality_compliance' limit 1), true) into v_quality;
  if p_kind = 'reservation' then
    select x.id, x.status, x.reserved_weight_kg, x.profile_stock_batch_id into r from public.profile_stock_reservations x
      where x.id = p_source and x.company_id = p_company and x.order_id = p_order;
    if r.id is null or r.status <> 'active' then return query select 0::numeric, 'The stock reservation is no longer active.'; return; end if;
    select b.qc_status into v_qc from public.profile_stock_batches b where b.id = r.profile_stock_batch_id and b.company_id = p_company;
    if v_qc in ('on_hold', 'rejected') then return query select 0::numeric, 'The reserved stock batch is ' || replace(v_qc, '_', ' ') || ' by quality.'; return; end if;
    v_ready := r.reserved_weight_kg;
    select coalesce(sum(p.net_weight_kg), 0) into v_used from public.packing_list_items p where p.company_id = p_company and p.reservation_id = r.id;
  elsif p_kind = 'production' then
    select x.id, x.status, x.actual_quantity_kg, x.finishing_type, x.profile_id, x.job_number into j from public.production_jobs x
      where x.id = p_source and x.company_id = p_company and x.order_id = p_order;
    if j.id is null or j.status <> 'completed' or coalesce(j.actual_quantity_kg, 0) <= 0 then
      return query select 0::numeric, 'Production job ' || coalesce(j.job_number, '') || ' is not completed.'; return;
    end if;
    if coalesce(j.finishing_type, 'mill_finish') <> 'mill_finish' then
      begin
        v_ready := private.finishing_dispatch_ready_kg(p_company, p_order, j.id, v_quality);
      exception when others then v_ready := 0; v_reason := 'Finishing receipt, QC release or packaging is not complete.';
      end;
      if v_ready <= 0 and v_reason is null then v_reason := 'Waiting for accepted finishing, QC release and completed packaging.'; end if;
    else
      v_ready := j.actual_quantity_kg;
      if v_quality then
        select coalesce(sum(q.quantity_checked_kg), 0) into v_approved from public.quality_inspections q
          where q.company_id = p_company and q.production_job_id = j.id and q.profile_id = j.profile_id and q.status = 'approved' and q.finishing_job_id is null;
        v_ready := least(v_ready, v_approved);
        if v_approved <= 0 then v_reason := 'QC has not released this output yet.'; end if;
      end if;
      select coalesce(sum(p.profile_weight_kg), 0) into v_packaged from public.packaging_jobs p where p.company_id = p_company and p.order_id = p_order
        and p.production_job_id = j.id and p.status = 'completed'
        and exists (select 1 from public.packaging_job_materials m where m.company_id = p_company and m.job_id = p.id and m.quantity_required > 0);
      if v_packaged <= 0 and v_reason is null then v_reason := 'Packaging is not completed with issued material.'; end if;
      v_ready := least(v_ready, v_packaged);
    end if;
    select coalesce(sum(p.net_weight_kg), 0) into v_used from public.packing_list_items p where p.company_id = p_company and p.source_line_id = j.id;
  elsif p_kind = 'dealer_stock' then
    select x.id, x.fulfilled_weight_kg, x.credited_at into f from public.order_dealer_stock_fulfillments x
      where x.id = p_source and x.company_id = p_company and x.order_id = p_order;
    if f.id is null or f.credited_at is not null then return query select 0::numeric, 'The stock fulfilment is no longer open.'; return; end if;
    v_ready := f.fulfilled_weight_kg;
    select coalesce(sum(p.net_weight_kg), 0) into v_used from public.packing_list_items p where p.company_id = p_company and p.source_line_id = f.id;
  else
    return query select 0::numeric, 'Unknown material source.'; return;
  end if;
  return query select greatest(round(coalesce(v_ready, 0) - v_used, 3), 0), case when coalesce(v_ready, 0) - v_used > 0.01 then null else coalesce(v_reason, 'All released material from this source is already dispatched.') end;
end;
$$;
revoke all on function private.ap4_source_available(uuid, uuid, text, uuid) from public, anon, authenticated;

-- The order line a bundle belongs to: the job's order line, the fulfilment's order line, else the only line of the
-- order with the bundle's profile. Null when nothing identifies it.
create or replace function private.ap4_bundle_line(p_company uuid, p_order uuid, p_kind text, p_source uuid, p_profile uuid)
returns uuid language plpgsql stable security definer set search_path = public, private as $$
declare v uuid; n integer;
begin
  if p_kind = 'production' then
    select oi.id into v from public.production_jobs j join public.order_items oi on oi.id = j.source_line_id and oi.company_id = j.company_id and oi.order_id = p_order
      where j.id = p_source and j.company_id = p_company;
  elsif p_kind = 'dealer_stock' then
    select oi.id into v from public.order_dealer_stock_fulfillments x join public.order_items oi on oi.id = x.order_item_id and oi.company_id = x.company_id and oi.order_id = p_order
      where x.id = p_source and x.company_id = p_company;
  end if;
  if v is not null then return v; end if;
  select count(*), min(oi.id::text)::uuid into n, v from public.order_items oi where oi.company_id = p_company and oi.order_id = p_order and oi.profile_id = p_profile;
  return case when n = 1 then v else null end;
end;
$$;
revoke all on function private.ap4_bundle_line(uuid, uuid, text, uuid, uuid) from public, anon, authenticated;

-- Order lines with what was ordered and what earlier dispatches already shipped. Header-only production orders give
-- one line without an id.
create or replace function private.ap4_order_lines(p_company uuid, p_order uuid)
returns table(line_id uuid, profile_id uuid, profile_code text, profile_name text, finish text, ordered_pieces integer, ordered_kg numeric,
  shipped_pieces integer, shipped_kg numeric) language sql stable security definer set search_path = public, private as $$
  with shipped as (
    select coalesce(p.order_item_id, private.ap4_bundle_line(p_company, p_order, p.source_kind, p.source_line_id, p.profile_id)) line_id,
      sum(p.number_of_pieces)::integer pcs, sum(p.net_weight_kg) kg, p.profile_id
    from public.packing_list_items p join public.dispatches d on d.id = p.dispatch_id and d.company_id = p.company_id
    where p.company_id = p_company and d.order_id = p_order and d.delivery_status <> 'pending'
    group by 1, p.profile_id)
  select oi.id, oi.profile_id, ap.profile_code, ap.profile_name, replace(coalesce(oi.finishing_type, 'mill_finish'), '_', ' '),
    oi.quantity_pieces, coalesce(nullif(oi.quantity_kg, 0), nullif(oi.manufacturing_weight_kg, 0)),
    coalesce((select sum(s.pcs) from shipped s where s.line_id = oi.id), 0)::integer, coalesce((select sum(s.kg) from shipped s where s.line_id = oi.id), 0)
  from public.order_items oi left join public.aluminium_profiles ap on ap.id = oi.profile_id
  where oi.company_id = p_company and oi.order_id = p_order
  union all
  select null::uuid, o.production_profile_id, ap.profile_code, ap.profile_name, 'mill finish', o.production_pieces, o.production_quantity_kg,
    coalesce((select sum(s.pcs) from shipped s), 0)::integer, coalesce((select sum(s.kg) from shipped s), 0)
  from public.orders o left join public.aluminium_profiles ap on ap.id = o.production_profile_id
  where o.id = p_order and o.company_id = p_company and o.production_profile_id is not null
    and not exists (select 1 from public.order_items oi where oi.company_id = p_company and oi.order_id = p_order)
$$;
revoke all on function private.ap4_order_lines(uuid, uuid) from public, anon, authenticated;

-- Latest credit state of an order (AP-032): held, approved (unexpired), rejected or none.
create or replace function private.ap4_credit_state(p_company uuid, p_order uuid) returns text language sql stable security definer set search_path = public, private as $$
  select coalesce((select case when h.status = 'approved' and h.expires_at <= now() then 'expired' else h.status end
    from public.order_credit_holds h where h.company_id = p_company and h.order_id = p_order and h.status in ('held', 'approved', 'rejected')
    order by h.created_at desc limit 1), 'none') $$;
revoke all on function private.ap4_credit_state(uuid, uuid) from public, anon, authenticated;

-- Consignment value for the e-way bill check: the posted invoice for the dispatch, else the packing list at its rates
-- with GST. Null when any line has no rate (unknown value is treated as above the threshold).
create or replace function private.ap4_consignment_value(p_company uuid, p_dispatch uuid) returns numeric language sql stable security definer set search_path = public, private as $$
  select coalesce(
    (select i.grand_total from public.invoices i where i.company_id = p_company and i.dispatch_id = p_dispatch and i.deleted_at is null
      and i.status not in ('draft', 'cancelled') order by i.invoice_date desc, i.created_at desc limit 1),
    (select case when bool_or(p.net_rate is null) then null else round(sum(coalesce(p.net_weight_kg, 0) * p.net_rate * (1 + coalesce(p.gst_percent, 18) / 100)), 2) end
      from public.packing_list_items p where p.company_id = p_company and p.dispatch_id = p_dispatch)) $$;
revoke all on function private.ap4_consignment_value(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-018: loading sessions. The loader scans each bundle into the vehicle; the session shows planned vs loaded per
-- order line and ends in the existing dispatch writer (save_ready_dispatch_atomic) with the scanned bundles, so the
-- dispatch lines are never typed. A bundle can be on one active session only; QC-held bundles are refused.
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.loading_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid not null references public.orders(id),
  status text not null default 'open' check (status in ('open', 'completed', 'cancelled')),
  vehicle_number text check (vehicle_number is null or length(vehicle_number) between 4 and 20),
  transporter_name text check (transporter_name is null or length(transporter_name) <= 120),
  transporter_id uuid references public.vendors(id),
  driver_name text check (driver_name is null or length(driver_name) <= 80),
  driver_phone text check (driver_phone is null or driver_phone ~ '^[6-9][0-9]{9}$'),
  lr_number text check (lr_number is null or length(lr_number) <= 40),
  started_by uuid not null references public.app_users(id),
  started_at timestamptz not null default clock_timestamp(),
  completed_by uuid references public.app_users(id),
  completed_at timestamptz,
  dispatch_id uuid references public.dispatches(id),
  cancelled_by uuid references public.app_users(id),
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or length(cancel_reason) between 5 and 300),
  updated_at timestamptz not null default clock_timestamp(),
  check ((status = 'completed') = (dispatch_id is not null and completed_at is not null)),
  check ((status = 'cancelled') = (cancelled_at is not null and cancel_reason is not null))
);
create unique index if not exists loading_sessions_one_open on public.loading_sessions(company_id, order_id) where status = 'open';
create unique index if not exists loading_sessions_dispatch on public.loading_sessions(company_id, dispatch_id) where dispatch_id is not null;
create index if not exists loading_sessions_company_idx on public.loading_sessions(company_id, status, started_at desc);
create index if not exists loading_sessions_order_idx on public.loading_sessions(order_id);
create index if not exists loading_sessions_transporter_idx on public.loading_sessions(transporter_id);
create index if not exists loading_sessions_people_idx on public.loading_sessions(started_by);

create table if not exists public.loading_scans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  session_id uuid not null references public.loading_sessions(id) on delete cascade,
  bundle_id uuid references public.prepared_physical_bundles(id),
  raw_tag text not null check (length(raw_tag) between 1 and 160),
  outcome text not null check (outcome in ('loaded', 'refused')),
  warnings text[] not null default '{}',
  message text not null check (length(message) <= 400),
  confirm_note text check (confirm_note is null or length(confirm_note) between 5 and 300),
  line_id uuid,
  net_kg numeric(15,3),
  pieces integer,
  scanned_by uuid not null references public.app_users(id),
  scanned_at timestamptz not null default clock_timestamp(),
  removed_at timestamptz,
  removed_by uuid references public.app_users(id),
  remove_reason text check (remove_reason is null or length(remove_reason) between 5 and 300),
  check (outcome = 'refused' or bundle_id is not null),
  check ((removed_at is null) = (remove_reason is null))
);
-- A bundle can be on one vehicle at a time (two loaders scanning the same tag: the second insert fails).
create unique index if not exists loading_scans_bundle_active on public.loading_scans(company_id, bundle_id) where outcome = 'loaded' and removed_at is null;
create index if not exists loading_scans_session_idx on public.loading_scans(company_id, session_id, scanned_at desc);
create index if not exists loading_scans_bundle_idx on public.loading_scans(bundle_id);
create index if not exists loading_scans_people_idx on public.loading_scans(scanned_by);

-- Planned vs loaded per order line for one session.
create or replace function private.ap4_session_plan(p_company uuid, s public.loading_sessions) returns jsonb language sql stable security definer set search_path = public, private as $$
  with loaded as (select sc.line_id, count(*) n, sum(sc.pieces) pcs, sum(sc.net_kg) kg from public.loading_scans sc
      where sc.company_id = p_company and sc.session_id = s.id and sc.outcome = 'loaded' and sc.removed_at is null group by sc.line_id),
    lines as (select l.*, coalesce(ld.n, 0) bundles, coalesce(ld.pcs, 0) loaded_pcs, coalesce(ld.kg, 0) loaded_kg
      from private.ap4_order_lines(p_company, s.order_id) l left join loaded ld on ld.line_id is not distinct from l.line_id)
  select jsonb_build_object(
    'lines', coalesce((select jsonb_agg(jsonb_build_object('line_id', x.line_id, 'profile', concat_ws(' - ', x.profile_code, x.profile_name), 'finish', x.finish,
      'ordered_pieces', x.ordered_pieces, 'ordered_kg', x.ordered_kg, 'shipped_pieces', x.shipped_pieces, 'shipped_kg', round(x.shipped_kg, 3),
      'loaded_bundles', x.bundles, 'loaded_pieces', x.loaded_pcs, 'loaded_kg', round(x.loaded_kg, 3),
      'open_pieces', case when x.ordered_pieces is null then null else x.ordered_pieces - x.shipped_pieces - x.loaded_pcs end,
      'open_kg', case when x.ordered_kg is null then null else round(x.ordered_kg - x.shipped_kg - x.loaded_kg, 3) end) order by x.profile_code nulls last) from lines x), '[]'::jsonb),
    'unplanned', coalesce((select jsonb_build_object('bundles', ld.n, 'pieces', ld.pcs, 'kg', round(ld.kg, 3)) from loaded ld
      where ld.line_id is null and not exists (select 1 from lines x where x.line_id is null)), null),
    'totals', (select jsonb_build_object('bundles', coalesce(sum(ld.n), 0), 'pieces', coalesce(sum(ld.pcs), 0), 'kg', round(coalesce(sum(ld.kg), 0), 3),
      'gross_kg', round(coalesce((select sum(b.gross_weight_kg) from public.loading_scans sc join public.prepared_physical_bundles b on b.id = sc.bundle_id
        where sc.company_id = p_company and sc.session_id = s.id and sc.outcome = 'loaded' and sc.removed_at is null), 0), 3)) from loaded ld))
$$;
revoke all on function private.ap4_session_plan(uuid, public.loading_sessions) from public, anon, authenticated;

create or replace function private.ap4_session_row(p_company uuid, s public.loading_sessions, p_full boolean) returns jsonb language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('id', s.id, 'order_id', s.order_id, 'order_number', o.order_number, 'customer', private.ap3_customer_name(o.customer_id),
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

-- Validates one scanned tag against the session and records the outcome. Warnings that a person may accept (more than
-- the order line, or no order line for the profile) need confirm=true and a note; refusals are recorded and never load.
create or replace function private.ap4_scan(c record, p_payload jsonb) returns jsonb language plpgsql security definer set search_path = public, private as $$
declare s public.loading_sessions%rowtype; v_tag text; v_id uuid; b public.prepared_physical_bundles%rowtype; o public.orders%rowtype; bo public.orders%rowtype;
  v_line uuid; v_warn text[] := '{}'; v_msg text; v_note text; v_confirm boolean := coalesce((p_payload ->> 'confirm')::boolean, false); a record; v_session_kg numeric;
  l record; v_other record; v_tol numeric; v_dispatch text; v_scan uuid;
begin
  perform private.ap_keys(p_payload, array['session_id', 'tag', 'confirm', 'note']);
  select * into s from public.loading_sessions where id = private.ap_uuid(p_payload, 'session_id') and company_id = c.company_id for update;
  if s.id is null then raise exception 'AP: Loading session not found.'; end if;
  if s.status <> 'open' then raise exception 'AP: This loading session is %.', s.status; end if;
  v_tag := private.ap_text(p_payload ->> 'tag', 'Bundle tag', 1, 160);
  v_note := private.ap_text(p_payload ->> 'note', 'Note', 5, 300, false);
  select * into o from public.orders where id = s.order_id;
  -- Labels carry the bundle tag; NOV-017 QR payloads (EO2:dispatch_package:<id>:nonce) resolve by id.
  if v_tag ~* '^EO2:dispatch_package:[0-9a-f-]{36}:' then v_id := split_part(v_tag, ':', 3)::uuid; end if;
  select * into b from public.prepared_physical_bundles x where x.company_id = c.company_id and (x.id = v_id or upper(x.bundle_number) = upper(v_tag)) limit 1 for update;
  if b.id is null then
    select d.dispatch_number into v_dispatch from public.packing_list_items p join public.dispatches d on d.id = p.dispatch_id
      where p.company_id = c.company_id and upper(p.bundle_number) = upper(v_tag) limit 1;
    v_msg := case when v_dispatch is not null then 'Bundle ' || v_tag || ' already left on dispatch ' || v_dispatch || '.' else 'Unknown bundle tag ' || v_tag || '. Measure and tag the bundle before loading it.' end;
    v_warn := array[case when v_dispatch is not null then 'dispatched' else 'unknown' end];
  elsif b.dispatch_id is not null then
    v_msg := 'Bundle ' || b.bundle_number || ' already left on dispatch ' || coalesce((select d.dispatch_number from public.dispatches d where d.id = b.dispatch_id), '') || '.';
    v_warn := array['dispatched'];
  elsif exists (select 1 from public.loading_scans y where y.company_id = c.company_id and y.session_id = s.id and y.bundle_id = b.id and y.outcome = 'loaded' and y.removed_at is null) then
    return jsonb_build_object('state', 'already_loaded', 'message', 'Bundle ' || b.bundle_number || ' is already on this vehicle.', 'session', private.ap4_session_row(c.company_id, s, true));
  else
    select y.session_id, ls.vehicle_number, oo.order_number into v_other from public.loading_scans y join public.loading_sessions ls on ls.id = y.session_id
      join public.orders oo on oo.id = ls.order_id where y.company_id = c.company_id and y.bundle_id = b.id and y.outcome = 'loaded' and y.removed_at is null limit 1;
    if v_other.session_id is not null then
      v_msg := 'Bundle ' || b.bundle_number || ' is already loaded for order ' || v_other.order_number || coalesce(' on vehicle ' || v_other.vehicle_number, '') || '. Remove it there first.';
      v_warn := array['loaded_elsewhere'];
    elsif b.order_id <> s.order_id then
      select * into bo from public.orders where id = b.order_id;
      if bo.customer_id <> o.customer_id then
        v_msg := 'Do not load: bundle ' || b.bundle_number || ' belongs to ' || coalesce(private.ap3_customer_name(bo.customer_id), 'another customer') || ' (order ' || bo.order_number || ').';
        v_warn := array['other_customer'];
      else
        v_msg := 'Bundle ' || b.bundle_number || ' belongs to order ' || bo.order_number || ' of the same customer. Load it on that order''s dispatch.';
        v_warn := array['other_order'];
      end if;
    else
      select * into a from private.ap4_source_available(c.company_id, s.order_id, b.source_kind, b.source_line_id);
      select coalesce(sum(x.gross_weight_kg - x.tare_weight_kg), 0) into v_session_kg from public.loading_scans y join public.prepared_physical_bundles x on x.id = y.bundle_id
        where y.company_id = c.company_id and y.session_id = s.id and y.outcome = 'loaded' and y.removed_at is null and x.source_kind = b.source_kind and x.source_line_id = b.source_line_id;
      if a.available_kg - v_session_kg < (b.gross_weight_kg - b.tare_weight_kg) - 0.01 then
        v_msg := 'Held: bundle ' || b.bundle_number || ' is not released for dispatch. ' || coalesce(a.reason, 'Its released quantity is already on this vehicle or shipped.');
        v_warn := array['held'];
      else
        v_line := private.ap4_bundle_line(c.company_id, s.order_id, b.source_kind, b.source_line_id, b.profile_id);
        select coalesce(cs.delivery_completion_tolerance_percent, 0) into v_tol from public.company_settings cs where cs.company_id = c.company_id;
        select * into l from jsonb_to_recordset(private.ap4_session_plan(c.company_id, s) -> 'lines') as x(line_id uuid, ordered_pieces integer, ordered_kg numeric, open_pieces integer, open_kg numeric, profile text)
          where x.line_id is not distinct from v_line limit 1;
        if v_line is null and not exists (select 1 from private.ap4_order_lines(c.company_id, s.order_id) z where z.line_id is null and z.profile_id = b.profile_id) then
          v_warn := array['not_in_plan'];
          v_msg := 'No order line of ' || o.order_number || ' matches the profile of bundle ' || b.bundle_number || '.';
        elsif l.ordered_pieces is not null and l.ordered_pieces > 0 and b.number_of_pieces > l.open_pieces + floor(l.ordered_pieces * coalesce(v_tol, 0) / 100) then
          v_warn := array['over_plan'];
          v_msg := 'More than ordered: ' || coalesce(l.profile, 'this line') || ' has ' || greatest(l.open_pieces, 0) || ' piece(s) open and the bundle has ' || b.number_of_pieces || '.';
        elsif (l.ordered_pieces is null or l.ordered_pieces = 0) and l.ordered_kg is not null and (b.gross_weight_kg - b.tare_weight_kg) > l.open_kg + l.ordered_kg * coalesce(v_tol, 0) / 100 + 0.01 then
          v_warn := array['over_plan'];
          v_msg := 'More than ordered: ' || coalesce(l.profile, 'this line') || ' has ' || greatest(l.open_kg, 0) || ' kg open and the bundle has ' || round(b.gross_weight_kg - b.tare_weight_kg, 3) || ' kg.';
        end if;
        if cardinality(v_warn) > 0 and not v_confirm then
          return jsonb_build_object('state', 'confirm', 'warnings', to_jsonb(v_warn), 'message', v_msg || ' Load it anyway only with a note.', 'tag', b.bundle_number);
        end if;
        if cardinality(v_warn) > 0 and v_note is null then raise exception 'AP: Write why this bundle is loaded anyway (at least 5 characters).'; end if;
        begin
          insert into public.loading_scans(company_id, session_id, bundle_id, raw_tag, outcome, warnings, message, confirm_note, line_id, net_kg, pieces, scanned_by)
            values (c.company_id, s.id, b.id, v_tag, 'loaded', v_warn, coalesce(v_msg, 'Loaded ' || b.bundle_number || '.'), case when cardinality(v_warn) > 0 then v_note end,
              v_line, round(b.gross_weight_kg - b.tare_weight_kg, 3), b.number_of_pieces, c.actor_id) returning id into v_scan;
        exception when unique_violation then
          raise exception 'AP: Bundle % was just loaded by someone else. Refresh the session.', b.bundle_number;
        end;
        update public.loading_sessions set updated_at = clock_timestamp() where id = s.id;
        return jsonb_build_object('state', 'loaded', 'scan_id', v_scan, 'warnings', to_jsonb(v_warn), 'message', 'Loaded ' || b.bundle_number || ': ' || b.number_of_pieces || ' pcs, '
          || round(b.gross_weight_kg - b.tare_weight_kg, 3) || ' kg net.', 'session', private.ap4_session_row(c.company_id, s, true));
      end if;
    end if;
  end if;
  insert into public.loading_scans(company_id, session_id, bundle_id, raw_tag, outcome, warnings, message, scanned_by)
    values (c.company_id, s.id, b.id, v_tag, 'refused', v_warn, left(v_msg, 400), c.actor_id);
  return jsonb_build_object('state', 'refused', 'warnings', to_jsonb(v_warn), 'message', v_msg, 'session', private.ap4_session_row(c.company_id, s, true));
end;
$$;
revoke all on function private.ap4_scan(record, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-019: gate-out derived from the dispatch. Security taps "Vehicle out" for a loaded (activated) dispatch; the
-- vehicle number is checked, a missing e-way bill above the threshold warns (or blocks, per policy), and the
-- exit moves the dispatch to in transit. The gate register is a report of these rows.
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.dispatch_gate_exits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  dispatch_id uuid not null references public.dispatches(id),
  vehicle_number text not null check (length(vehicle_number) between 4 and 20),
  vehicle_check text not null check (vehicle_check in ('matched', 'filled', 'override')),
  override_reason text check (override_reason is null or length(override_reason) between 10 and 300),
  eway_state text not null check (eway_state in ('present', 'not_required', 'missing_acknowledged')),
  eway_reason text check (eway_reason is null or length(eway_reason) between 10 and 300),
  consignment_value numeric(15,2),
  exited_at timestamptz not null default clock_timestamp(),
  recorded_by uuid not null references public.app_users(id),
  check ((vehicle_check = 'override') = (override_reason is not null)),
  check ((eway_state = 'missing_acknowledged') = (eway_reason is not null))
);
create unique index if not exists dispatch_gate_exits_one on public.dispatch_gate_exits(company_id, dispatch_id);
create index if not exists dispatch_gate_exits_company_idx on public.dispatch_gate_exits(company_id, exited_at desc);
create index if not exists dispatch_gate_exits_dispatch_idx on public.dispatch_gate_exits(dispatch_id);
create index if not exists dispatch_gate_exits_people_idx on public.dispatch_gate_exits(recorded_by);

create or replace function private.ap4_gate_row(p_company uuid, d public.dispatches) returns jsonb language sql stable security definer set search_path = public, private as $$
  with v as (select private.ap4_consignment_value(p_company, d.id) val, private.ap4_settings(p_company) s)
  select jsonb_build_object('dispatch_id', d.id, 'dispatch_number', d.dispatch_number, 'order_number', o.order_number, 'customer', private.ap3_customer_name(o.customer_id),
    'vehicle_number', d.vehicle_number, 'transporter_name', d.transporter_name, 'lr_number', d.lr_number, 'eway_bill_number', d.eway_bill_number,
    'bundles', d.number_of_bundles, 'net_kg', d.total_weight_kg, 'loaded_at', d.actual_dispatched_at, 'value', v.val,
    'eway_required', v.val is null or v.val > (v.s).eway_threshold, 'eway_policy', (v.s).eway_gate_policy, 'eway_threshold', (v.s).eway_threshold)
  from public.orders o, v where o.id = d.order_id
$$;
revoke all on function private.ap4_gate_row(uuid, public.dispatches) from public, anon, authenticated;

create or replace function private.ap4_gate_out(c record, p_payload jsonb) returns jsonb language plpgsql security definer set search_path = public, private as $$
declare d public.dispatches%rowtype; v_seen text; v_rec text; v_check text; v_override text; v_eway text; v_eway_reason text; v_value numeric; s public.dispatch_autopilot_settings%rowtype; v_id uuid;
begin
  perform private.ap_keys(p_payload, array['dispatch_id', 'vehicle_number', 'override_reason', 'eway_reason']);
  select * into d from public.dispatches where id = private.ap_uuid(p_payload, 'dispatch_id') and company_id = c.company_id for update;
  if d.id is null then raise exception 'AP: Dispatch not found.'; end if;
  if exists (select 1 from public.dispatch_gate_exits g where g.company_id = c.company_id and g.dispatch_id = d.id) then
    return jsonb_build_object('state', 'already_out', 'message', 'Dispatch ' || d.dispatch_number || ' has already left the gate.');
  end if;
  if d.actual_dispatched_at is null or d.delivery_status <> 'dispatched' then raise exception 'AP: Dispatch % is not loaded and waiting at the gate.', coalesce(d.dispatch_number, ''); end if;
  v_seen := private.ap4_norm_vehicle(p_payload ->> 'vehicle_number');
  if v_seen is null or length(v_seen) < 4 or length(v_seen) > 12 then raise exception 'AP: Enter the vehicle number on the number plate.'; end if;
  v_rec := private.ap4_norm_vehicle(d.vehicle_number);
  v_override := private.ap_text(p_payload ->> 'override_reason', 'Override reason', 10, 300, false);
  if v_rec is null then v_check := 'filled'; v_override := null;
  elsif v_rec = v_seen then v_check := 'matched'; v_override := null;
  elsif v_override is not null and c.role = any(private.ap4_supervisor_roles()) then v_check := 'override';
  elsif v_override is not null then raise exception 'AP: Only a dispatch supervisor can let a different vehicle leave.';
  else raise exception 'AP: Vehicle % does not match the dispatch vehicle %. Stop the vehicle; a dispatch supervisor can record an exception with a reason.', v_seen, v_rec;
  end if;
  s := private.ap4_settings(c.company_id);
  v_value := private.ap4_consignment_value(c.company_id, d.id);
  v_eway_reason := private.ap_text(p_payload ->> 'eway_reason', 'E-way bill reason', 10, 300, false);
  if nullif(btrim(coalesce(d.eway_bill_number, '')), '') is not null then v_eway := 'present'; v_eway_reason := null;
  elsif v_value is not null and v_value <= s.eway_threshold then v_eway := 'not_required'; v_eway_reason := null;
  elsif s.eway_gate_policy = 'block' then raise exception 'AP: Dispatch % needs an e-way bill (value % above %). Record the e-way bill number before the vehicle leaves.', d.dispatch_number, coalesce(v_value::text, 'not priced'), s.eway_threshold;
  elsif v_eway_reason is null then raise exception 'AP: Dispatch % has no e-way bill number (value % above %). Give a reason to let it leave without one.', d.dispatch_number, coalesce(v_value::text, 'not priced'), s.eway_threshold;
  else v_eway := 'missing_acknowledged';
  end if;
  insert into public.dispatch_gate_exits(company_id, dispatch_id, vehicle_number, vehicle_check, override_reason, eway_state, eway_reason, consignment_value, recorded_by)
    values (c.company_id, d.id, v_seen, v_check, v_override, v_eway, v_eway_reason, v_value, c.actor_id) returning id into v_id;
  -- A blank vehicle number may be filled after activation (only recorded transport documents are frozen).
  update public.dispatches set vehicle_number = case when v_check = 'filled' then v_seen else vehicle_number end,
    delivery_status = 'in_transit', updated_at = now() where id = d.id;
  return jsonb_build_object('state', 'out', 'exit_id', v_id, 'vehicle_check', v_check, 'eway_state', v_eway,
    'message', 'Vehicle ' || v_seen || ' left with dispatch ' || d.dispatch_number || '.' || case when v_eway = 'missing_acknowledged' then ' E-way bill missing: reason recorded.' else '' end);
end;
$$;
revoke all on function private.ap4_gate_out(record, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-051: ready-to-ship list. Order lines with packed bundles not yet dispatched, split into QC-released and held
-- kilograms (the same readiness the dispatch writer checks), grouped by customer and destination, with due date and
-- credit state. Credit-held customers are shown and marked, never hidden.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.ap4_ready(p_company uuid, p_payload jsonb) returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare v_page integer := private.ap3_page(p_payload); v_search text := lower(nullif(btrim(coalesce(p_payload ->> 'search', '')), '')); v_due integer := nullif(p_payload ->> 'due_within_days', '')::integer;
  v_released_only boolean := coalesce((p_payload ->> 'released_only')::boolean, false); v_total bigint; v_rows jsonb;
begin
  if length(coalesce(v_search, '')) > 60 or (v_due is not null and (v_due < 0 or v_due > 365)) then raise exception 'AP: Invalid filter.'; end if;
  select coalesce(jsonb_agg(x.row order by x.first_due nulls last, x.customer, x.dest), '[]'::jsonb), max(x.total) into v_rows, v_total from (
    with b as (
      select pb.id, pb.order_id, pb.source_kind, pb.source_line_id, pb.profile_id, pb.recorded_at, round(pb.gross_weight_kg - pb.tare_weight_kg, 3) net, pb.gross_weight_kg gross, pb.number_of_pieces pcs,
        o.order_number, o.customer_id, o.expected_dispatch_date due, coalesce(nullif(btrim(cu.city), ''), 'No city recorded') dest
      from public.prepared_physical_bundles pb join public.orders o on o.id = pb.order_id and o.company_id = pb.company_id join public.customers cu on cu.id = o.customer_id
      where pb.company_id = p_company and pb.dispatch_id is null and o.deleted_at is null and o.current_stage not in ('cancelled', 'closed', 'delivered')
        and (v_due is null or o.expected_dispatch_date <= private.ist_today() + v_due)
        and (v_search is null or position(v_search in lower(o.order_number || ' ' || coalesce(cu.customer_name, '') || ' ' || coalesce(cu.company_name, '') || ' ' || coalesce(cu.city, ''))) > 0)),
    src as (select distinct b.order_id, b.source_kind, b.source_line_id from b),
    av as (select src.*, a.available_kg, a.reason from src cross join lateral private.ap4_source_available(p_company, src.order_id, src.source_kind, src.source_line_id) a),
    ranked as (select b.*, sum(b.net) over (partition by b.order_id, b.source_kind, b.source_line_id order by b.recorded_at, b.id) cum from b),
    st as (select r.*, case when r.cum <= av.available_kg + 0.01 then 'released' else 'held' end state, av.reason,
        private.ap4_bundle_line(p_company, r.order_id, r.source_kind, r.source_line_id, r.profile_id) line_id
      from ranked r join av on av.order_id = r.order_id and av.source_kind = r.source_kind and av.source_line_id = r.source_line_id),
    lines as (select st.customer_id, st.dest, st.order_id, st.order_number, st.due, st.line_id, st.profile_id, count(*) bundles, sum(st.pcs) pcs, sum(st.net) packed_kg,
        sum(st.net) filter (where st.state = 'released') released_kg, sum(st.net) filter (where st.state = 'held') held_kg, sum(st.gross) filter (where st.state = 'released') released_gross,
        min(st.reason) filter (where st.state = 'held') held_reason
      from st group by st.customer_id, st.dest, st.order_id, st.order_number, st.due, st.line_id, st.profile_id
      having not v_released_only or coalesce(sum(st.net) filter (where st.state = 'released'), 0) > 0),
    groups as (select l.customer_id, l.dest, min(l.due) first_due, sum(coalesce(l.released_kg, 0)) released_kg, sum(coalesce(l.held_kg, 0)) held_kg,
        sum(coalesce(l.released_gross, 0)) released_gross, count(distinct l.order_id) orders, private.ap3_customer_name(l.customer_id) customer from lines l group by l.customer_id, l.dest),
    paged as (select g.*, count(*) over () total from groups g order by g.first_due nulls last, g.customer, g.dest limit 10 offset (v_page - 1) * 10)
    select p.first_due, p.customer, p.dest, p.total, jsonb_build_object('customer_id', p.customer_id, 'customer', p.customer, 'destination', p.dest, 'first_due', p.first_due,
      'released_kg', round(p.released_kg, 3), 'released_gross_kg', round(p.released_gross, 3), 'held_kg', round(p.held_kg, 3), 'orders', p.orders,
      'lines', (select jsonb_agg(jsonb_build_object('order_id', l.order_id, 'order_number', l.order_number, 'due', l.due, 'line_id', l.line_id,
          'profile', (select concat_ws(' - ', ap.profile_code, ap.profile_name) from public.aluminium_profiles ap where ap.id = l.profile_id),
          'bundles', l.bundles, 'pieces', l.pcs, 'packed_kg', round(l.packed_kg, 3), 'released_kg', round(coalesce(l.released_kg, 0), 3), 'held_kg', round(coalesce(l.held_kg, 0), 3),
          'held_reason', l.held_reason, 'credit', private.ap4_credit_state(p_company, l.order_id), 'overdue', l.due is not null and l.due < private.ist_today(),
          'loading_session_id', (select ls.id from public.loading_sessions ls where ls.company_id = p_company and ls.order_id = l.order_id and ls.status = 'open'))
        order by l.due nulls last, l.order_number) from lines l where l.customer_id = p.customer_id and l.dest = p.dest)) "row"
    from paged p) x;
  return jsonb_build_object('page', v_page, 'total_count', coalesce(v_total, 0), 'rows', v_rows);
end;
$$;
revoke all on function private.ap4_ready(uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-017: label print queue. Recording a bundle queues its label (from the approved NOV-079 template, so only that
-- template's permitted fields) for the packing station; a station page set to auto-print prints it and confirms,
-- which writes the packing_label_prints row. Reprints need a reason and are logged.
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.label_stations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 60),
  location text check (location is null or length(location) <= 120),
  auto_print boolean not null default true,
  is_default boolean not null default false,
  active boolean not null default true,
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create unique index if not exists label_stations_name on public.label_stations(company_id, lower(btrim(name)));
create unique index if not exists label_stations_one_default on public.label_stations(company_id) where is_default and active;
create index if not exists label_stations_people_idx on public.label_stations(created_by);

create table if not exists public.label_print_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  station_id uuid references public.label_stations(id),
  bundle_id uuid not null references public.prepared_physical_bundles(id),
  reason text not null check (reason in ('initial', 'reprint', 'damaged', 'relabel')),
  note text check (note is null or length(note) between 5 and 300),
  status text not null default 'queued' check (status in ('queued', 'printed', 'blocked', 'cancelled')),
  template_id uuid references public.packing_label_templates(id),
  template_revision integer,
  fields jsonb not null default '{}'::jsonb check (jsonb_typeof(fields) = 'object'),
  missing text[] not null default '{}',
  blocked_reason text check (blocked_reason is null or length(blocked_reason) <= 300),
  queued_by uuid references public.app_users(id),
  queued_at timestamptz not null default clock_timestamp(),
  printed_at timestamptz,
  printed_by uuid references public.app_users(id),
  label_print_id uuid references public.packing_label_prints(id),
  cancelled_reason text check (cancelled_reason is null or length(cancelled_reason) between 5 and 300),
  check ((status = 'blocked') = (blocked_reason is not null)),
  check ((status = 'printed') = (printed_at is not null and label_print_id is not null)),
  check (reason = 'initial' or note is not null)
);
create unique index if not exists label_print_jobs_one_initial on public.label_print_jobs(company_id, bundle_id) where reason = 'initial' and status <> 'cancelled';
create index if not exists label_print_jobs_queue_idx on public.label_print_jobs(company_id, status, queued_at);
create index if not exists label_print_jobs_station_idx on public.label_print_jobs(station_id);
create index if not exists label_print_jobs_bundle_idx on public.label_print_jobs(bundle_id);
create index if not exists label_print_jobs_template_idx on public.label_print_jobs(template_id);
create index if not exists label_print_jobs_print_idx on public.label_print_jobs(label_print_id);
create index if not exists label_print_jobs_people_idx on public.label_print_jobs(queued_by);
create index if not exists label_print_jobs_printer_idx on public.label_print_jobs(printed_by);

-- Resolves the template and label fields for a job (initial or a re-evaluated blocked job).
create or replace function private.ap4_label_resolve(p_company uuid, p_bundle uuid)
returns table(template_id uuid, template_revision integer, fields jsonb, missing text[], blocked_reason text)
language plpgsql stable security definer set search_path = public, private as $$
declare b public.prepared_physical_bundles%rowtype; tp public.packing_label_templates%rowtype; v jsonb;
begin
  select * into b from public.prepared_physical_bundles where id = p_bundle and company_id = p_company;
  tp := private.label_template_for(p_company, b.order_id);
  if tp.id is null then
    return query select null::uuid, null::integer, '{}'::jsonb, '{}'::text[], 'No approved label template applies to this order. Approve a packing label template (company, customer, project or order).'::text;
    return;
  end if;
  v := private.label_payload(p_company, b.id, tp);
  return query select tp.id, tp.revision, coalesce(v -> 'fields', '{}'::jsonb),
    coalesce(array(select jsonb_array_elements_text(v -> 'missing')), '{}'::text[]), null::text;
end;
$$;
revoke all on function private.ap4_label_resolve(uuid, uuid) from public, anon, authenticated;

create or replace function private.ap4_label_enqueue(p_company uuid, p_bundle uuid, p_reason text, p_note text, p_actor uuid) returns uuid
language plpgsql security definer set search_path = public, private as $$
declare r record; v_station uuid; v_id uuid;
begin
  select st.id into v_station from public.label_stations st where st.company_id = p_company and st.active and st.is_default;
  select * into r from private.ap4_label_resolve(p_company, p_bundle);
  insert into public.label_print_jobs(company_id, station_id, bundle_id, reason, note, status, template_id, template_revision, fields, missing, blocked_reason, queued_by)
    values (p_company, v_station, p_bundle, p_reason, p_note, case when r.blocked_reason is null then 'queued' else 'blocked' end, r.template_id, r.template_revision,
      r.fields, r.missing, r.blocked_reason, p_actor)
    returning id into v_id;
  return v_id;
end;
$$;
revoke all on function private.ap4_label_enqueue(uuid, uuid, text, text, uuid) from public, anon, authenticated;

create or replace function private.ap4_label_printed(c record, p_job uuid) returns jsonb language plpgsql security definer set search_path = public, private as $$
declare j public.label_print_jobs%rowtype; lp public.packing_label_prints%rowtype; v_num integer; v_id uuid := gen_random_uuid();
begin
  select * into j from public.label_print_jobs where id = p_job and company_id = c.company_id for update;
  if j.id is null then raise exception 'AP: Label job not found.'; end if;
  if j.status = 'printed' then return jsonb_build_object('state', 'printed', 'repeated', true, 'label_print_id', j.label_print_id); end if;
  if j.status <> 'queued' then raise exception 'AP: This label is %.', j.status; end if;
  perform 1 from public.prepared_physical_bundles b where b.id = j.bundle_id for update;
  select * into lp from public.packing_label_prints where company_id = c.company_id and bundle_id = j.bundle_id and status = 'active' for update;
  if j.reason = 'initial' and lp.id is not null then
    -- Already labelled from the packing record (NOV-079): link that print instead of creating a second identity.
    update public.label_print_jobs set status = 'printed', printed_at = clock_timestamp(), printed_by = c.actor_id, label_print_id = lp.id where id = j.id;
    return jsonb_build_object('state', 'printed', 'label_print_id', lp.id, 'linked', true);
  end if;
  if lp.id is not null then update public.packing_label_prints set status = 'superseded' where id = lp.id; end if;
  select coalesce(max(x.print_number), 0) + 1 into v_num from public.packing_label_prints x where x.company_id = c.company_id and x.bundle_id = j.bundle_id;
  insert into public.packing_label_prints(id, company_id, bundle_id, template_id, template_revision, print_number, reason, payload, observations, deviation, printed_by, printed_role)
    values (v_id, c.company_id, j.bundle_id, j.template_id, j.template_revision, v_num,
      case when j.reason = 'initial' then 'initial' when lp.template_id is not null and lp.template_id <> j.template_id then 'relabel' else j.reason end,
      j.fields, jsonb_build_object('source', 'print_queue', 'job_id', j.id), null, c.actor_id, c.role);
  update public.label_print_jobs set status = 'printed', printed_at = clock_timestamp(), printed_by = c.actor_id, label_print_id = v_id where id = j.id;
  return jsonb_build_object('state', 'printed', 'label_print_id', v_id, 'print_number', v_num);
end;
$$;
revoke all on function private.ap4_label_printed(record, uuid) from public, anon, authenticated;

create or replace function private.ap4_label_job_row(j public.label_print_jobs) returns jsonb language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('id', j.id, 'bundle_id', j.bundle_id, 'bundle_number', b.bundle_number, 'order_number', o.order_number, 'customer', private.ap3_customer_name(o.customer_id),
    'station_id', j.station_id, 'station', (select st.name from public.label_stations st where st.id = j.station_id), 'reason', j.reason, 'note', j.note, 'status', j.status,
    'template_revision', j.template_revision, 'fields', j.fields, 'missing', to_jsonb(j.missing), 'blocked_reason', j.blocked_reason, 'queued_at', j.queued_at,
    'queued_by', case when j.queued_by is null then 'System' else private.ap4_user_name(j.queued_by) end, 'printed_at', j.printed_at,
    'printed_by', private.ap4_user_name(j.printed_by), 'seconds_to_print', case when j.printed_at is not null then round(extract(epoch from j.printed_at - j.queued_at)::numeric, 1) end,
    'dispatched', b.dispatch_id is not null)
  from public.prepared_physical_bundles b join public.orders o on o.id = b.order_id where b.id = j.bundle_id
$$;
revoke all on function private.ap4_label_job_row(public.label_print_jobs) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-035: packing standard. A versioned packing spec per customer (or the company default) gives the bundle limits and
-- the packaging materials; the plan proposes pieces per bundle and material per order line; each recorded bundle is
-- compared with it and deviations are recorded. Mirrored by lib/calculations/bundle-packing.ts (parity test).
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.customer_packing_specs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid references public.customers(id),
  revision integer not null check (revision >= 1),
  status text not null default 'active' check (status in ('active', 'superseded')),
  max_bundle_kg numeric(10,3) check (max_bundle_kg is null or (max_bundle_kg > 0 and max_bundle_kg <= 5000)),
  max_pieces integer check (max_pieces is null or max_pieces between 1 and 5000),
  wrapping text not null default 'stretch_film' check (wrapping in ('stretch_film', 'bubble_wrap', 'pp_woven_sheet', 'hdpe', 'paper', 'none')),
  interleaving_paper boolean not null default false,
  battens_per_bundle integer not null default 0 check (battens_per_bundle between 0 and 20),
  material_ids uuid[] not null default '{}' check (cardinality(material_ids) <= 12),
  notes text check (notes is null or length(notes) <= 500),
  reason text not null check (length(reason) between 5 and 300),
  set_by uuid not null references public.app_users(id),
  set_at timestamptz not null default clock_timestamp(),
  superseded_at timestamptz,
  check ((status = 'superseded') = (superseded_at is not null))
);
create unique index if not exists customer_packing_specs_active on public.customer_packing_specs(company_id, coalesce(customer_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status = 'active';
create unique index if not exists customer_packing_specs_revision on public.customer_packing_specs(company_id, coalesce(customer_id, '00000000-0000-0000-0000-000000000000'::uuid), revision);
create index if not exists customer_packing_specs_customer_idx on public.customer_packing_specs(customer_id);
create index if not exists customer_packing_specs_people_idx on public.customer_packing_specs(set_by);

create table if not exists public.packing_deviations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  bundle_id uuid not null references public.prepared_physical_bundles(id),
  order_id uuid not null references public.orders(id),
  line_id uuid,
  kind text not null check (kind in ('over_pieces', 'under_pieces', 'over_kg')),
  expected_pieces integer,
  actual_pieces integer not null,
  max_bundle_kg numeric(10,3),
  actual_kg numeric(15,3) not null,
  spec_id uuid references public.customer_packing_specs(id),
  spec_revision integer,
  note text check (note is null or length(note) between 5 and 300),
  noted_by uuid references public.app_users(id),
  noted_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);
create unique index if not exists packing_deviations_one on public.packing_deviations(company_id, bundle_id, kind);
create index if not exists packing_deviations_company_idx on public.packing_deviations(company_id, created_at desc);
create index if not exists packing_deviations_order_idx on public.packing_deviations(order_id);
create index if not exists packing_deviations_bundle_idx on public.packing_deviations(bundle_id);
create index if not exists packing_deviations_spec_idx on public.packing_deviations(spec_id);
create index if not exists packing_deviations_people_idx on public.packing_deviations(noted_by);

create or replace function private.ap4_pack_spec(p_company uuid, p_customer uuid) returns public.customer_packing_specs
language sql stable security definer set search_path = public, private as $$
  select s.* from public.customer_packing_specs s where s.company_id = p_company and s.status = 'active' and (s.customer_id = p_customer or s.customer_id is null)
  order by (s.customer_id is null), s.revision desc limit 1 $$;
revoke all on function private.ap4_pack_spec(uuid, uuid) from public, anon, authenticated;

-- One order line's bundle proposal. Blank stays blank: without a limit (spec or profile) there is no proposal.
create or replace function private.ap4_pack_line(p_pieces integer, p_length_m numeric, p_kg_per_m numeric, p_max_kg numeric, p_max_pieces integer, p_profile_per_bundle integer)
returns jsonb language plpgsql immutable set search_path = public, private as $$
declare v_piece numeric; v_by_kg integer; v_per integer; v_basis text; v_bundles integer; v_last integer; v_heavy boolean := false;
begin
  if p_length_m is not null and p_length_m > 0 and p_kg_per_m is not null and p_kg_per_m > 0 then v_piece := round(p_length_m * p_kg_per_m, 4); end if;
  if p_max_kg is not null and v_piece is not null then v_by_kg := floor(p_max_kg / v_piece)::integer; end if;
  if p_max_pieces is not null then v_per := p_max_pieces; v_basis := 'max_pieces'; end if;
  if v_by_kg is not null and (v_per is null or v_by_kg < v_per) then v_per := v_by_kg; v_basis := 'max_kg'; end if;
  if p_profile_per_bundle is not null and p_profile_per_bundle > 0 and (v_per is null or p_profile_per_bundle < v_per) then v_per := p_profile_per_bundle; v_basis := 'profile_standard'; end if;
  if v_per is not null and v_per < 1 then v_per := 1; v_heavy := true; end if;
  if v_per is not null and p_pieces is not null and p_pieces > 0 then
    v_bundles := ceil(p_pieces::numeric / v_per)::integer;
    v_last := p_pieces - (v_bundles - 1) * v_per;
  end if;
  return jsonb_build_object('piece_kg', v_piece, 'per_bundle', v_per, 'basis', v_basis, 'bundles', v_bundles, 'last_bundle_pieces', v_last,
    'bundle_kg', case when v_per is not null and v_piece is not null then round(v_per * v_piece, 3) end, 'heavy_piece', v_heavy);
end;
$$;
revoke all on function private.ap4_pack_line(integer, numeric, numeric, numeric, integer, integer) from public, anon, authenticated;

-- Standard material for a quantity of packing, from each chosen packaging material's own calculation method
-- ("fixed" is applied once per bundle, the packing unit). Battens are counted per bundle.
create or replace function private.ap4_pack_materials(p_company uuid, s public.customer_packing_specs, p_pieces numeric, p_metres numeric, p_kg numeric, p_bundles numeric)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select coalesce((select jsonb_agg(jsonb_build_object('material_id', m.id, 'code', m.material_code, 'name', m.material_name, 'unit', m.unit, 'method', m.calculation_method, 'rate', m.consumption_rate,
      'quantity', case when m.calculation_method = 'per_piece' then round(coalesce(p_pieces, 0) * m.consumption_rate, 3)
        when m.calculation_method = 'per_kg' then round(coalesce(p_kg, 0) * m.consumption_rate, 3)
        when m.calculation_method = 'fixed' then round(coalesce(p_bundles, 0) * m.consumption_rate, 3)
        else round(coalesce(p_metres, 0) * m.consumption_rate, 3) end) order by m.material_code)
    from public.packaging_materials m where m.company_id = p_company and m.id = any(coalesce(s.material_ids, '{}')) and m.is_active), '[]'::jsonb)
  || case when coalesce(s.battens_per_bundle, 0) > 0 and p_bundles is not null then jsonb_build_array(jsonb_build_object('material_id', null, 'code', 'BATTEN', 'name', 'Wooden battens',
      'unit', 'pcs', 'method', 'per_bundle_count', 'rate', s.battens_per_bundle, 'quantity', s.battens_per_bundle * p_bundles)) else '[]'::jsonb end
$$;
revoke all on function private.ap4_pack_materials(uuid, public.customer_packing_specs, numeric, numeric, numeric, numeric) from public, anon, authenticated;

create or replace function private.ap4_line_facts(p_company uuid, p_line uuid)
returns table(pieces integer, length_m numeric, kg_per_m numeric, profile_per_bundle integer) language sql stable security definer set search_path = public, private as $$
  select oi.quantity_pieces, coalesce(nullif(oi.length_per_piece_m, 0), nullif(oi.cut_length, 0) / 1000.0),
    coalesce(nullif(oi.section_weight_kg_per_m, 0), nullif(ap.section_weight_kg_per_m, 0)), nullif(ap.pieces_per_bundle, 0)
  from public.order_items oi left join public.aluminium_profiles ap on ap.id = oi.profile_id where oi.id = p_line and oi.company_id = p_company $$;
revoke all on function private.ap4_line_facts(uuid, uuid) from public, anon, authenticated;

create or replace function private.ap4_pack_plan(p_company uuid, p_order uuid) returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare o public.orders%rowtype; s public.customer_packing_specs%rowtype; v_lines jsonb := '[]'::jsonb; l record; f record; v_line jsonb; v_pieces numeric := 0; v_metres numeric := 0; v_kg numeric := 0; v_bundles numeric := 0; v_complete boolean := true;
begin
  select * into o from public.orders where id = p_order and company_id = p_company;
  if o.id is null then return null; end if;
  s := private.ap4_pack_spec(p_company, o.customer_id);
  for l in select oi.id, concat_ws(' - ', ap.profile_code, ap.profile_name) profile, replace(coalesce(oi.finishing_type, 'mill_finish'), '_', ' ') finish
      from public.order_items oi left join public.aluminium_profiles ap on ap.id = oi.profile_id where oi.company_id = p_company and oi.order_id = p_order order by ap.profile_code nulls last, oi.id loop
    select * into f from private.ap4_line_facts(p_company, l.id);
    v_line := private.ap4_pack_line(f.pieces, f.length_m, f.kg_per_m, s.max_bundle_kg, s.max_pieces, f.profile_per_bundle);
    if (v_line ->> 'bundles') is null then v_complete := false;
    else
      v_pieces := v_pieces + coalesce(f.pieces, 0); v_metres := v_metres + coalesce(f.pieces * f.length_m, 0);
      v_kg := v_kg + coalesce(f.pieces * (v_line ->> 'piece_kg')::numeric, 0); v_bundles := v_bundles + (v_line ->> 'bundles')::numeric;
    end if;
    v_lines := v_lines || jsonb_build_array(v_line || jsonb_build_object('line_id', l.id, 'profile', l.profile, 'finish', l.finish, 'pieces', f.pieces, 'length_m', f.length_m, 'kg_per_m', f.kg_per_m,
      'materials', case when (v_line ->> 'bundles') is null then '[]'::jsonb else private.ap4_pack_materials(p_company, s, f.pieces, f.pieces * f.length_m,
        f.pieces * (v_line ->> 'piece_kg')::numeric, (v_line ->> 'bundles')::numeric) end));
  end loop;
  return jsonb_build_object('order_id', o.id, 'customer_id', o.customer_id,
    'spec', case when s.id is null then null else jsonb_build_object('id', s.id, 'revision', s.revision, 'scope', case when s.customer_id is null then 'company' else 'customer' end,
      'max_bundle_kg', s.max_bundle_kg, 'max_pieces', s.max_pieces, 'wrapping', s.wrapping, 'interleaving_paper', s.interleaving_paper, 'battens_per_bundle', s.battens_per_bundle, 'notes', s.notes) end,
    'lines', v_lines, 'complete', v_complete,
    'materials', case when s.id is null then '[]'::jsonb else private.ap4_pack_materials(p_company, s, v_pieces, v_metres, v_kg, v_bundles) end,
    'totals', jsonb_build_object('pieces', v_pieces, 'metres', round(v_metres, 3), 'kg', round(v_kg, 3), 'bundles', v_bundles));
end;
$$;
revoke all on function private.ap4_pack_plan(uuid, uuid) from public, anon, authenticated;

-- Compares a recorded bundle with the plan of its order line and records deviations (never refuses the bundle).
create or replace function private.ap4_pack_check(p_company uuid, b public.prepared_physical_bundles) returns integer language plpgsql security definer set search_path = public, private as $$
declare o public.orders%rowtype; s public.customer_packing_specs%rowtype; v_line uuid; f record; v jsonb; v_per integer; v_net numeric := round(b.gross_weight_kg - b.tare_weight_kg, 3);
  v_before integer; v_n integer := 0;
begin
  select * into o from public.orders where id = b.order_id;
  s := private.ap4_pack_spec(p_company, o.customer_id);
  v_line := private.ap4_bundle_line(p_company, b.order_id, b.source_kind, b.source_line_id, b.profile_id);
  if v_line is not null then
    select * into f from private.ap4_line_facts(p_company, v_line);
    v := private.ap4_pack_line(f.pieces, f.length_m, f.kg_per_m, s.max_bundle_kg, s.max_pieces, f.profile_per_bundle);
    v_per := (v ->> 'per_bundle')::integer;
  end if;
  if v_per is not null and b.number_of_pieces > v_per then
    insert into public.packing_deviations(company_id, bundle_id, order_id, line_id, kind, expected_pieces, actual_pieces, max_bundle_kg, actual_kg, spec_id, spec_revision)
      values (p_company, b.id, b.order_id, v_line, 'over_pieces', v_per, b.number_of_pieces, s.max_bundle_kg, v_net, s.id, s.revision) on conflict do nothing;
    v_n := v_n + 1;
  elsif v_per is not null and b.number_of_pieces < v_per then
    select coalesce(sum(x.number_of_pieces), 0) into v_before from public.prepared_physical_bundles x where x.company_id = p_company and x.order_id = b.order_id and x.id <> b.id
      and private.ap4_bundle_line(p_company, x.order_id, x.source_kind, x.source_line_id, x.profile_id) = v_line;
    -- A short last bundle is normal; it is a deviation only while more pieces of the line remain to be packed.
    if f.pieces is not null and f.pieces - v_before - b.number_of_pieces > 0 then
      insert into public.packing_deviations(company_id, bundle_id, order_id, line_id, kind, expected_pieces, actual_pieces, max_bundle_kg, actual_kg, spec_id, spec_revision)
        values (p_company, b.id, b.order_id, v_line, 'under_pieces', v_per, b.number_of_pieces, s.max_bundle_kg, v_net, s.id, s.revision) on conflict do nothing;
      v_n := v_n + 1;
    end if;
  end if;
  if s.max_bundle_kg is not null and v_net > s.max_bundle_kg * 1.005 then
    insert into public.packing_deviations(company_id, bundle_id, order_id, line_id, kind, expected_pieces, actual_pieces, max_bundle_kg, actual_kg, spec_id, spec_revision)
      values (p_company, b.id, b.order_id, v_line, 'over_kg', v_per, b.number_of_pieces, s.max_bundle_kg, v_net, s.id, s.revision) on conflict do nothing;
    v_n := v_n + 1;
  end if;
  return v_n;
end;
$$;
revoke all on function private.ap4_pack_check(uuid, public.prepared_physical_bundles) from public, anon, authenticated;

-- On every recorded bundle: queue its label and compare it with the packing standard. Neither ever refuses the bundle;
-- a failure is reported to the owner instead.
create or replace function private.ap4_on_bundle_recorded() returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  begin
    perform private.ap4_label_enqueue(new.company_id, new.id, 'initial', null, null);
  exception when others then
    insert into public.notifications(company_id, recipient_user_id, notification_type, severity, title, body, related_entity_type, related_entity_id, action_link)
      select new.company_id, u.id, 'system', 'warning', 'Label not queued for bundle ' || new.bundle_number, left('The label could not be queued: ' || sqlerrm, 500), 'order', new.order_id, '/dispatches/labels'
      from public.app_users u where u.company_id = new.company_id and u.role = 'owner' and u.is_active limit 1;
  end;
  begin
    perform private.ap4_pack_check(new.company_id, new);
  exception when others then null;
  end;
  return new;
end;
$$;
revoke all on function private.ap4_on_bundle_recorded() from public, anon, authenticated;
drop trigger if exists zz_ap4_bundle_recorded on public.prepared_physical_bundles;
create trigger zz_ap4_bundle_recorded after insert on public.prepared_physical_bundles for each row execute function private.ap4_on_bundle_recorded();

-- ---------------------------------------------------------------------------------------------------------------
-- AP-036: freight from transporter rate cards. Cards are per kg or per vehicle type, by destination state (and city
-- when it differs). The estimate is an AP-002 proposal on the quote, the loading session or the dispatch; accepting
-- records the decision, an override needs a reason. Supplier freight rates are internal and never reach a customer
-- document. Estimated vs billed freight is reported per transporter.
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.transporter_rate_cards (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  transporter_id uuid not null references public.vendors(id),
  basis text not null check (basis in ('per_kg', 'per_vehicle')),
  vehicle_type text check (vehicle_type is null or length(btrim(vehicle_type)) between 2 and 40),
  vehicle_capacity_kg numeric(10,2) check (vehicle_capacity_kg is null or (vehicle_capacity_kg > 0 and vehicle_capacity_kg <= 60000)),
  destination_state text not null check (destination_state ~ '^[0-9]{2}$'),
  destination_city text check (destination_city is null or length(btrim(destination_city)) between 2 and 60),
  rate numeric(12,2) not null check (rate > 0 and rate <= 10000000),
  min_charge numeric(12,2) not null default 0 check (min_charge >= 0 and min_charge <= 10000000),
  effective_from date not null,
  effective_to date,
  status text not null default 'active' check (status in ('active', 'retired')),
  note text check (note is null or length(note) <= 300),
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default clock_timestamp(),
  retired_by uuid references public.app_users(id),
  retired_at timestamptz,
  retire_reason text check (retire_reason is null or length(retire_reason) between 5 and 300),
  check (effective_to is null or effective_to >= effective_from),
  check ((basis = 'per_vehicle') = (vehicle_type is not null and vehicle_capacity_kg is not null)),
  check ((status = 'retired') = (retired_at is not null and retire_reason is not null))
);
create index if not exists transporter_rate_cards_lookup on public.transporter_rate_cards(company_id, destination_state, status, effective_from);
create index if not exists transporter_rate_cards_transporter_idx on public.transporter_rate_cards(transporter_id);
create index if not exists transporter_rate_cards_people_idx on public.transporter_rate_cards(created_by);
create index if not exists transporter_rate_cards_retired_idx on public.transporter_rate_cards(retired_by);

create table if not exists public.freight_decisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  target_kind text not null check (target_kind in ('quote', 'loading', 'dispatch')),
  target_id uuid not null,
  proposal_id uuid references public.proposals(id) on delete set null,
  status text not null default 'current' check (status in ('current', 'superseded')),
  decision text not null check (decision in ('accepted', 'overridden')),
  transporter_id uuid references public.vendors(id),
  transporter_name text,
  basis text check (basis is null or basis in ('per_kg', 'per_vehicle')),
  vehicle_type text,
  vehicles integer check (vehicles is null or vehicles >= 1),
  card_id uuid references public.transporter_rate_cards(id),
  weight_kg numeric(15,3) not null,
  destination_state text,
  destination_city text,
  proposed_amount numeric(12,2) not null,
  chosen_amount numeric(12,2) not null check (chosen_amount >= 0),
  override_reason text check (override_reason is null or length(override_reason) between 5 and 300),
  decided_by uuid not null references public.app_users(id),
  decided_at timestamptz not null default clock_timestamp(),
  billed_amount numeric(12,2) check (billed_amount is null or billed_amount >= 0),
  billed_reference text check (billed_reference is null or length(billed_reference) <= 80),
  billed_source text check (billed_source is null or billed_source in ('expense', 'entered')),
  billed_by uuid references public.app_users(id),
  billed_at timestamptz,
  superseded_at timestamptz,
  check ((decision = 'overridden') = (override_reason is not null)),
  check ((status = 'superseded') = (superseded_at is not null)),
  check ((billed_amount is null) = (billed_source is null))
);
create unique index if not exists freight_decisions_current on public.freight_decisions(company_id, target_kind, target_id) where status = 'current';
create index if not exists freight_decisions_company_idx on public.freight_decisions(company_id, decided_at desc);
create index if not exists freight_decisions_transporter_idx on public.freight_decisions(transporter_id);
create index if not exists freight_decisions_card_idx on public.freight_decisions(card_id);
create index if not exists freight_decisions_proposal_idx on public.freight_decisions(proposal_id);
create index if not exists freight_decisions_people_idx on public.freight_decisions(decided_by);
create index if not exists freight_decisions_billed_idx on public.freight_decisions(billed_by);

create or replace function private.ap4_freight_roles() returns text[] language sql immutable set search_path = public, private as $$
  select array['owner', 'admin', 'dispatch_manager', 'dispatch', 'factory_manager', 'sales_manager', 'sales', 'accounts'] $$;
create or replace function private.ap4_card_roles() returns text[] language sql immutable set search_path = public, private as $$
  select array['owner', 'admin', 'dispatch_manager', 'accounts'] $$;
revoke all on function private.ap4_freight_roles() from public, anon, authenticated;
revoke all on function private.ap4_card_roles() from public, anon, authenticated;

-- Active cards for the destination on the day; a city card beats the state card of the same transporter and vehicle.
create or replace function private.ap4_freight_options(p_company uuid, p_weight numeric, p_state text, p_city text, p_day date) returns jsonb
language sql stable security definer set search_path = public, private as $$
  with cards as (
    select r.* from public.transporter_rate_cards r where r.company_id = p_company and r.status = 'active' and r.destination_state = p_state
      and (r.destination_city is null or lower(btrim(r.destination_city)) = lower(btrim(coalesce(p_city, ''))))
      and r.effective_from <= p_day and (r.effective_to is null or r.effective_to >= p_day)),
  best as (select distinct on (c.transporter_id, c.basis, coalesce(lower(c.vehicle_type), '')) c.* from cards c
    order by c.transporter_id, c.basis, coalesce(lower(c.vehicle_type), ''), (c.destination_city is null), c.effective_from desc, c.created_at desc),
  opt as (select b.*, case when b.basis = 'per_kg' then 1 else ceil(p_weight / b.vehicle_capacity_kg)::integer end vehicles,
      case when b.basis = 'per_kg' then greatest(round(b.rate * p_weight, 2), b.min_charge) else greatest(b.rate * ceil(p_weight / b.vehicle_capacity_kg), b.min_charge) end amount,
      v.vendor_name from best b join public.vendors v on v.id = b.transporter_id)
  select coalesce(jsonb_agg(jsonb_build_object('card_id', o.id, 'transporter_id', o.transporter_id, 'transporter', o.vendor_name, 'basis', o.basis, 'vehicle_type', o.vehicle_type,
      'capacity_kg', o.vehicle_capacity_kg, 'vehicles', o.vehicles, 'rate', o.rate, 'min_charge', o.min_charge, 'amount', o.amount, 'city_card', o.destination_city is not null)
    order by o.amount, o.vehicles, o.vendor_name), '[]'::jsonb) from opt o
$$;
revoke all on function private.ap4_freight_options(uuid, numeric, text, text, date) from public, anon, authenticated;

-- What is being moved and where: quote (billing kg of its lines), loading session (gross of loaded bundles) or
-- dispatch (net + tare). Destination from the customer's GSTIN or recorded state, and city.
create or replace function private.ap4_freight_target(p_company uuid, p_kind text, p_id uuid)
returns table(weight_kg numeric, state text, city text, customer_id uuid, label text, dispatch_id uuid) language plpgsql stable security definer set search_path = public, private as $$
declare v_customer uuid; v_weight numeric; v_label text; v_dispatch uuid; s public.loading_sessions%rowtype;
begin
  if p_kind = 'quote' then
    select q.customer_id, q.quote_number into v_customer, v_label from public.quotes q where q.id = p_id and q.company_id = p_company and q.deleted_at is null;
    select sum(coalesce(nullif(qi.billing_weight_kg, 0), qi.total_weight_kg)) into v_weight from public.quote_items qi where qi.company_id = p_company and qi.quote_id = p_id;
  elsif p_kind = 'loading' then
    select * into s from public.loading_sessions x where x.id = p_id and x.company_id = p_company;
    select o.customer_id, o.order_number into v_customer, v_label from public.orders o where o.id = s.order_id;
    v_weight := (private.ap4_session_plan(p_company, s) -> 'totals' ->> 'gross_kg')::numeric;
    v_dispatch := s.dispatch_id;
  elsif p_kind = 'dispatch' then
    select o.customer_id, d.dispatch_number, d.total_weight_kg + d.total_tare_weight_kg, d.id into v_customer, v_label, v_weight, v_dispatch
      from public.dispatches d join public.orders o on o.id = d.order_id where d.id = p_id and d.company_id = p_company;
  end if;
  if v_customer is null then return; end if;
  return query select round(v_weight, 3), private.ap3_derive_supply(p_company, v_customer) ->> 'state', (select nullif(btrim(cu.city), '') from public.customers cu where cu.id = v_customer),
    v_customer, v_label, v_dispatch;
end;
$$;
revoke all on function private.ap4_freight_target(uuid, text, uuid) from public, anon, authenticated;

create or replace function private.ap4_freight_versions(p_company uuid, p_target text) returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare t record;
begin
  select * into t from private.ap4_freight_target(p_company, split_part(p_target, ':', 1), split_part(p_target, ':', 2)::uuid);
  return jsonb_build_object('weight', t.weight_kg, 'state', t.state, 'city', lower(coalesce(t.city, '')),
    'cards', (select md5(coalesce(string_agg(r.id::text || r.rate::text || r.min_charge::text || r.status || coalesce(r.effective_to::text, ''), ',' order by r.id), ''))
      from public.transporter_rate_cards r where r.company_id = p_company and r.destination_state = t.state));
end;
$$;
revoke all on function private.ap4_freight_versions(uuid, text) from public, anon, authenticated;

create or replace function private.ap4_freight_propose(p_company uuid, p_kind text, p_id uuid) returns jsonb language plpgsql security definer set search_path = public, private as $$
declare t record; v_options jsonb; v_best jsonb; v_id uuid; v_target text := p_kind || ':' || p_id::text;
begin
  select * into t from private.ap4_freight_target(p_company, p_kind, p_id);
  if t.customer_id is null then raise exception 'AP: Record not found.'; end if;
  if t.weight_kg is null or t.weight_kg <= 0 then return jsonb_build_object('state', 'no_weight', 'message', 'There is no weight to move yet.'); end if;
  if t.state is null then return jsonb_build_object('state', 'no_destination', 'message', 'The customer has no GSTIN or state recorded, so the destination is unknown.'); end if;
  v_options := private.ap4_freight_options(p_company, t.weight_kg, t.state, t.city, private.ist_today());
  if jsonb_array_length(v_options) = 0 then
    return jsonb_build_object('state', 'no_card', 'message', 'No active rate card covers ' || coalesce(t.city || ', ', '') || coalesce(private.ap_gst_state(t.state), t.state) || '. Add one under Dispatches → Freight.');
  end if;
  v_best := v_options -> 0;
  v_id := private.ap_proposal_create(p_company, 'freight.estimate', v_target, left('Freight for ' || coalesce(t.label, p_kind) || ': ' || (v_best ->> 'transporter'), 200),
    jsonb_build_object('option_index', 0, 'amount', (v_best ->> 'amount')::numeric, 'transporter_id', v_best ->> 'transporter_id', 'transporter', v_best ->> 'transporter',
      'basis', v_best ->> 'basis', 'vehicle_type', v_best ->> 'vehicle_type', 'vehicles', (v_best ->> 'vehicles')::integer, 'card_id', v_best ->> 'card_id',
      'weight_kg', t.weight_kg, 'state', t.state, 'city', t.city, 'options', v_options, 'reason', null),
    jsonb_build_object('weight_kg', t.weight_kg, 'state', t.state, 'state_label', private.ap_gst_state(t.state), 'city', t.city, 'option_count', jsonb_array_length(v_options), 'target', t.label),
    'freight.cheapest_card.v1', 'Cheapest active rate card for ' || t.weight_kg || ' kg to ' || coalesce(t.city || ', ', '') || coalesce(private.ap_gst_state(t.state), t.state) || '.',
    case when (v_best ->> 'city_card')::boolean then 0.95 else 0.8 end, private.ap4_freight_roles(), 72, null);
  if v_id is null then
    select p.id into v_id from public.proposals p where p.company_id = p_company and p.proposal_type = 'freight.estimate' and p.target_key = v_target and p.status = 'open';
  end if;
  return jsonb_build_object('state', case when v_id is null then 'rejected_recently' else 'proposed' end, 'proposal_id', v_id, 'options', v_options,
    'message', case when v_id is null then 'The same estimate was rejected in the last 30 days.' else null end);
end;
$$;
revoke all on function private.ap4_freight_propose(uuid, text, uuid) from public, anon, authenticated;

create or replace function private.ap4_apply_freight(p_company uuid, p_actor uuid, p_role text, p public.proposals, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare v_idx integer; v_opt jsonb; v_amount numeric; v_reason text; v_kind text := split_part(p.target_key, ':', 1); v_tid uuid := split_part(p.target_key, ':', 2)::uuid;
  v_decision text := 'accepted'; v_id uuid;
begin
  if not (p_role = any(private.ap4_freight_roles())) then raise exception 'Not permitted' using errcode = '42501'; end if;
  begin v_idx := (p_payload ->> 'option_index')::integer; exception when others then raise exception 'AP: Choose one of the listed options.'; end;
  v_opt := p.payload -> 'options' -> v_idx;
  if v_idx is null or v_idx < 0 or v_opt is null then raise exception 'AP: Choose one of the listed options.'; end if;
  v_amount := private.ap4_num(p_payload, 'amount', 'Freight amount', 0, 10000000);
  if v_idx <> 0 or v_amount <> (p.payload ->> 'amount')::numeric then
    v_decision := 'overridden';
    v_reason := private.ap_text(p_payload ->> 'reason', 'Override reason', 5, 300);
  end if;
  update public.freight_decisions set status = 'superseded', superseded_at = clock_timestamp()
    where company_id = p_company and target_kind = v_kind and target_id = v_tid and status = 'current';
  insert into public.freight_decisions(company_id, target_kind, target_id, proposal_id, decision, transporter_id, transporter_name, basis, vehicle_type, vehicles, card_id,
      weight_kg, destination_state, destination_city, proposed_amount, chosen_amount, override_reason, decided_by)
    values (p_company, v_kind, v_tid, p.id, v_decision, (v_opt ->> 'transporter_id')::uuid, v_opt ->> 'transporter', v_opt ->> 'basis', v_opt ->> 'vehicle_type',
      (v_opt ->> 'vehicles')::integer, (v_opt ->> 'card_id')::uuid, (p.payload ->> 'weight_kg')::numeric, p.payload ->> 'state', p.payload ->> 'city',
      (p.payload ->> 'amount')::numeric, v_amount, v_reason, p_actor)
    returning id into v_id;
  -- The chosen transporter fills a blank transporter on the loading session or dispatch (never replaces one).
  if v_kind = 'loading' then
    update public.loading_sessions set transporter_id = coalesce(transporter_id, (v_opt ->> 'transporter_id')::uuid),
      transporter_name = coalesce(nullif(btrim(transporter_name), ''), v_opt ->> 'transporter'), updated_at = clock_timestamp()
      where id = v_tid and company_id = p_company and status = 'open';
  elsif v_kind = 'dispatch' then
    update public.dispatches set transporter_name = v_opt ->> 'transporter', updated_at = now()
      where id = v_tid and company_id = p_company and nullif(btrim(coalesce(transporter_name, '')), '') is null;
  end if;
  return jsonb_build_object('decision_id', v_id, 'decision', v_decision, 'amount', v_amount, 'transporter', v_opt ->> 'transporter');
end;
$$;
revoke all on function private.ap4_apply_freight(uuid, uuid, text, public.proposals, jsonb) from public, anon, authenticated;

-- Billed freight: the transporter's expense entries recorded against the dispatch, when there are any.
create or replace function private.ap4_freight_billed(p_company uuid, f public.freight_decisions) returns numeric language sql stable security definer set search_path = public, private as $$
  select sum(e.total_amount) from public.expense_ledger e
  where e.company_id = p_company and e.deleted_at is null and e.approval_status not in ('cancelled', 'reversed', 'rejected', 'draft')
    and e.source_table = 'dispatches' and e.vendor_id = f.transporter_id
    and e.source_record_id = case f.target_kind when 'dispatch' then f.target_id when 'loading' then (select s.dispatch_id from public.loading_sessions s where s.id = f.target_id) end
$$;
revoke all on function private.ap4_freight_billed(uuid, public.freight_decisions) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-081: e-way bill bulk upload file. The database supplies the facts (supplier, recipient, posted invoice, HSN lines,
-- vehicle, distance); lib/compliance/eway-bill.ts validates and builds the portal JSON; the export is recorded with
-- its schema version; the EWB numbers generated on the portal are pasted or imported back. No portal credentials.
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.dispatch_eway_inputs (
  dispatch_id uuid primary key references public.dispatches(id),
  company_id uuid not null references public.companies(id) on delete cascade,
  distance_km integer not null check (distance_km between 0 and 4000),
  transport_mode text not null default 'road' check (transport_mode in ('road', 'rail', 'air', 'ship')),
  vehicle_type text not null default 'regular' check (vehicle_type in ('regular', 'over_dimensional')),
  transporter_gstin text check (transporter_gstin is null or transporter_gstin ~ '^[0-9A-Z]{15}$'),
  updated_by uuid not null references public.app_users(id),
  updated_at timestamptz not null default clock_timestamp()
);
create index if not exists dispatch_eway_inputs_company_idx on public.dispatch_eway_inputs(company_id, updated_at desc);
create index if not exists dispatch_eway_inputs_people_idx on public.dispatch_eway_inputs(updated_by);

create table if not exists public.eway_distance_memory (
  company_id uuid not null references public.companies(id) on delete cascade,
  to_pincode text not null check (to_pincode ~ '^[1-9][0-9]{5}$'),
  distance_km integer not null check (distance_km between 0 and 4000),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (company_id, to_pincode)
);

create table if not exists public.eway_exports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  schema_version text not null check (length(schema_version) between 3 and 60),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  bill_count integer not null check (bill_count between 1 and 200),
  generated_by uuid not null references public.app_users(id),
  generated_at timestamptz not null default clock_timestamp()
);
create index if not exists eway_exports_company_idx on public.eway_exports(company_id, generated_at desc);
create index if not exists eway_exports_people_idx on public.eway_exports(generated_by);

create table if not exists public.eway_export_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  export_id uuid not null references public.eway_exports(id) on delete cascade,
  dispatch_id uuid not null references public.dispatches(id),
  doc_no text not null check (length(doc_no) between 1 and 16),
  doc_date date not null,
  total_value numeric(15,2) not null,
  status text not null default 'exported' check (status in ('exported', 'ewb_recorded', 'superseded')),
  ewb_number text check (ewb_number is null or ewb_number ~ '^[0-9]{12}$'),
  ewb_recorded_by uuid references public.app_users(id),
  ewb_recorded_at timestamptz,
  check ((status = 'ewb_recorded') = (ewb_number is not null))
);
create index if not exists eway_export_items_company_idx on public.eway_export_items(company_id, dispatch_id, status);
create index if not exists eway_export_items_doc_idx on public.eway_export_items(company_id, upper(doc_no));
create index if not exists eway_export_items_export_idx on public.eway_export_items(export_id);
create index if not exists eway_export_items_dispatch_idx on public.eway_export_items(dispatch_id);
create index if not exists eway_export_items_people_idx on public.eway_export_items(ewb_recorded_by);

create or replace function private.ap4_eway_roles() returns text[] language sql immutable set search_path = public, private as $$
  select array['owner', 'admin', 'accounts', 'dispatch_manager', 'dispatch'] $$;
revoke all on function private.ap4_eway_roles() from public, anon, authenticated;

-- Facts for one dispatch's e-way bill. Values come from the posted invoice of the dispatch (never re-priced here);
-- without one the source carries no document and validation asks for the invoice first.
create or replace function private.ap4_eway_source(p_company uuid, p_dispatch uuid) returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare d public.dispatches%rowtype; o public.orders%rowtype; cu public.customers%rowtype; co public.companies%rowtype; i public.invoices%rowtype; inp public.dispatch_eway_inputs%rowtype;
  v_supply jsonb; v_distance integer; v_transporter_gstin text;
begin
  select * into d from public.dispatches where id = p_dispatch and company_id = p_company;
  if d.id is null then return null; end if;
  select * into o from public.orders where id = d.order_id;
  select * into cu from public.customers where id = o.customer_id;
  select * into co from public.companies where id = p_company;
  select * into i from public.invoices x where x.company_id = p_company and x.dispatch_id = d.id and x.deleted_at is null and x.status not in ('draft', 'cancelled')
    order by x.invoice_date desc, x.created_at desc limit 1;
  select * into inp from public.dispatch_eway_inputs where dispatch_id = d.id and company_id = p_company;
  v_supply := private.ap3_derive_supply(p_company, cu.id);
  v_distance := coalesce(inp.distance_km, (select m.distance_km from public.eway_distance_memory m where m.company_id = p_company and m.to_pincode = btrim(coalesce(cu.pincode, ''))));
  select upper(nullif(btrim(v.gst_number), '')) into v_transporter_gstin from public.loading_sessions s join public.vendors v on v.id = s.transporter_id
    where s.company_id = p_company and s.dispatch_id = d.id;
  return jsonb_build_object(
    'dispatch_id', d.id, 'dispatch_number', d.dispatch_number, 'dispatch_date', d.dispatch_date, 'activated', d.actual_dispatched_at is not null,
    'vehicle_number', private.ap4_norm_vehicle(d.vehicle_number), 'transporter_name', d.transporter_name, 'lr_number', d.lr_number, 'eway_bill_number', nullif(btrim(coalesce(d.eway_bill_number, '')), ''),
    'supplier', jsonb_build_object('gstin', upper(nullif(btrim(co.gst_number), '')), 'name', coalesce(nullif(btrim(co.legal_name), ''), co.name), 'address', co.billing_address,
      'place', co.city, 'pincode', btrim(coalesce(co.pincode, '')), 'state_code', coalesce(nullif(co.gst_state_code, ''), left(upper(nullif(btrim(co.gst_number), '')), 2))),
    'recipient', jsonb_build_object('gstin', case when cu.gst_registration = 'registered' then upper(nullif(btrim(cu.gst_number), '')) end, 'name', private.ap3_customer_name(cu.id),
      'address', coalesce(nullif(btrim(cu.shipping_address), ''), cu.billing_address), 'place', cu.city, 'pincode', btrim(coalesce(cu.pincode, '')),
      'state_code', coalesce(i.place_of_supply_state_code, v_supply ->> 'state')),
    'invoice', case when i.id is null then null else jsonb_build_object('id', i.id, 'number', i.invoice_number, 'date', i.invoice_date, 'subtotal', i.subtotal,
      'cgst', i.cgst_amount, 'sgst', i.sgst_amount + i.utgst_amount, 'igst', i.igst_amount, 'total', i.grand_total,
      'items', coalesce((select jsonb_agg(jsonb_build_object('hsn', x.hsn, 'description', x.descr, 'quantity_kg', round(x.kg, 3), 'taxable', round(x.taxable, 2), 'gst_percent', x.rate) order by x.hsn, x.rate)
        from (select coalesce(nullif(btrim(ii.hsn_code), ''), ap.hsn_code) hsn, coalesce(ii.gst_percent, 18) rate,
                left(string_agg(distinct coalesce(ap.profile_code, ii.item_description, 'Aluminium profiles'), ', '), 100) descr,
                sum(coalesce(nullif(ii.quantity_kg, 0), ii.quantity, 0)) kg, sum(coalesce(ii.line_total, 0)) taxable
              from public.invoice_items ii left join public.aluminium_profiles ap on ap.id = ii.profile_id
              where ii.company_id = p_company and ii.invoice_id = i.id and ii.line_kind = 'goods' group by 1, 2) x), '[]'::jsonb),
      'other_value', coalesce((select round(sum(ii.line_total), 2) from public.invoice_items ii where ii.company_id = p_company and ii.invoice_id = i.id and ii.line_kind <> 'goods'), 0)) end,
    'inputs', jsonb_build_object('distance_km', v_distance, 'distance_saved', inp.dispatch_id is not null, 'transport_mode', coalesce(inp.transport_mode, 'road'),
      'vehicle_type', coalesce(inp.vehicle_type, 'regular'), 'transporter_gstin', coalesce(inp.transporter_gstin, v_transporter_gstin)),
    'last_export', (select jsonb_build_object('generated_at', e.generated_at, 'status', it.status) from public.eway_export_items it join public.eway_exports e on e.id = it.export_id
      where it.company_id = p_company and it.dispatch_id = d.id order by e.generated_at desc limit 1));
end;
$$;
revoke all on function private.ap4_eway_source(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-083: Tally export. Ledger names are mapped once (party ledgers default to the party's name); the database lists
-- posted vouchers not yet exported; lib/integrations/tally-xml.ts builds the Tally import XML; each voucher is
-- recorded as exported once and can only be exported again through an explicit re-export with a reason.
-- Opening (cut-over) invoices are never exported. On-account money is exported once as "On Account"; applying it to an
-- invoice later (a /OA receipt) is a bill adjustment and is not exported as new money.
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.tally_ledger_map (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (kind in ('customer', 'vendor', 'sales', 'purchase', 'output_cgst', 'output_sgst', 'output_igst', 'input_cgst', 'input_sgst', 'input_igst',
    'round_off', 'bank', 'cash', 'freight_inward', 'discount_received')),
  entity_id uuid,
  gst_rate numeric(5,2) check (gst_rate is null or gst_rate between 0 and 28),
  supply text check (supply is null or supply in ('local', 'interstate')),
  ledger_name text not null check (length(btrim(ledger_name)) between 1 and 100 and ledger_name !~ '[[:cntrl:]<>&]'),
  updated_by uuid not null references public.app_users(id),
  updated_at timestamptz not null default clock_timestamp(),
  check ((kind in ('customer', 'vendor')) = (entity_id is not null)),
  check (kind in ('sales', 'purchase') or (gst_rate is null and supply is null))
);
create unique index if not exists tally_ledger_map_key on public.tally_ledger_map(company_id, kind, coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(gst_rate, -1), coalesce(supply, ''));
create index if not exists tally_ledger_map_entity_idx on public.tally_ledger_map(entity_id);
create index if not exists tally_ledger_map_people_idx on public.tally_ledger_map(updated_by);

create table if not exists public.tally_export_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  from_date date not null,
  to_date date not null,
  voucher_count integer not null check (voucher_count between 1 and 2000),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  generated_by uuid not null references public.app_users(id),
  generated_at timestamptz not null default clock_timestamp(),
  check (to_date >= from_date and to_date - from_date <= 31)
);
create index if not exists tally_export_batches_company_idx on public.tally_export_batches(company_id, generated_at desc);
create index if not exists tally_export_batches_people_idx on public.tally_export_batches(generated_by);

create table if not exists public.tally_export_vouchers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  batch_id uuid not null references public.tally_export_batches(id) on delete cascade,
  voucher_kind text not null check (voucher_kind in ('sales', 'receipt', 'on_account', 'purchase', 'credit_note')),
  voucher_id uuid not null,
  voucher_number text not null,
  voucher_date date not null,
  amount numeric(15,2) not null,
  status text not null default 'exported' check (status in ('exported', 'superseded')),
  re_export boolean not null default false,
  superseded_at timestamptz,
  superseded_by uuid references public.app_users(id),
  supersede_reason text check (supersede_reason is null or length(supersede_reason) between 10 and 300),
  check ((status = 'superseded') = (superseded_at is not null and supersede_reason is not null))
);
create unique index if not exists tally_export_vouchers_once on public.tally_export_vouchers(company_id, voucher_kind, voucher_id) where status = 'exported';
create index if not exists tally_export_vouchers_batch_idx on public.tally_export_vouchers(batch_id);
create index if not exists tally_export_vouchers_company_idx on public.tally_export_vouchers(company_id, voucher_date);
create index if not exists tally_export_vouchers_people_idx on public.tally_export_vouchers(superseded_by);

-- Posted vouchers in a date range (with their export state). Amounts are the recorded document values.
create or replace function private.ap4_tally_vouchers(p_company uuid, p_from date, p_to date) returns table(kind text, id uuid, number text, voucher_date date, amount numeric, party_id uuid,
  party_name text, data jsonb) language sql stable security definer set search_path = public, private as $$
  select 'sales', i.id, i.invoice_number, i.invoice_date, i.grand_total, i.customer_id, private.ap3_customer_name(i.customer_id),
    jsonb_build_object('gstin', upper(nullif(btrim(cu.gst_number), '')), 'subtotal', i.subtotal, 'cgst', i.cgst_amount, 'sgst', i.sgst_amount + i.utgst_amount, 'igst', i.igst_amount,
      'supply', case when i.igst_amount > 0 then 'interstate' when i.cgst_amount > 0 then 'local'
        when i.place_of_supply_state_code is not null and i.supplier_state_code is not null and i.place_of_supply_state_code <> i.supplier_state_code then 'interstate' else 'local' end,
      'lines', coalesce((select jsonb_agg(jsonb_build_object('rate', x.rate, 'taxable', x.taxable) order by x.rate) from (
        select coalesce(ii.gst_percent, 18) rate, round(sum(coalesce(ii.line_total, 0)), 2) taxable from public.invoice_items ii where ii.company_id = p_company and ii.invoice_id = i.id group by 1) x), '[]'::jsonb))
  from public.invoices i join public.customers cu on cu.id = i.customer_id
  where i.company_id = p_company and i.deleted_at is null and i.opening_cutover_id is null and i.invoice_number is not null
    and i.status in ('generated', 'sent', 'partially_paid', 'paid', 'overdue', 'credited') and i.invoice_date between p_from and p_to
  union all
  select 'receipt', e.id, coalesce(nullif(btrim(e.reference_number), ''), 'RCPT-' || upper(left(e.id::text, 8))), e.payment_date, e.received_amount, x.customer_id,
    private.ap3_customer_name(x.customer_id),
    jsonb_build_object('method', e.payment_method, 'status', e.status, 'allocations', x.allocations)
  from public.financial_receipt_events e
  cross join lateral (select min(i.customer_id::text)::uuid customer_id, count(distinct i.customer_id) customers,
      jsonb_agg(jsonb_build_object('invoice_number', i.invoice_number, 'amount', p.amount) order by i.invoice_number) allocations
    from public.payments p join public.invoices i on i.id = p.invoice_id where p.company_id = p_company and p.receipt_event_id = e.id) x
  where e.company_id = p_company and e.status <> 'reversed' and e.payment_date between p_from and p_to and x.customer_id is not null
    and not exists (select 1 from public.customer_on_account_applications a where a.company_id = p_company and a.receipt_event_id = e.id)
  union all
  select 'on_account', oa.id, coalesce(nullif(btrim(oa.reference), ''), 'OA-' || upper(left(oa.id::text, 8))), oa.received_on, oa.amount, oa.customer_id, private.ap3_customer_name(oa.customer_id),
    jsonb_build_object('method', oa.payment_method, 'status', oa.status)
  from public.customer_on_account_credits oa where oa.company_id = p_company and oa.status <> 'reversed' and oa.received_on between p_from and p_to
  union all
  select 'purchase', b.id, b.invoice_number, b.invoice_date, b.total_amount, b.vendor_id, coalesce(nullif(btrim(v.vendor_name), ''), b.vendor_name_snapshot),
    jsonb_build_object('gstin', upper(nullif(btrim(v.gst_number), '')), 'tax', b.tax_amount, 'freight', b.freight_amount, 'discount', b.discount_amount,
      'taxable', b.total_amount - b.tax_amount - b.freight_amount + b.discount_amount,
      'supply', case when left(upper(coalesce(v.gst_number, '')), 2) ~ '^[0-9]{2}$' and left(upper(v.gst_number), 2) <> coalesce((select co.gst_state_code from public.companies co where co.id = p_company), '')
        then 'interstate' else 'local' end)
  from public.supplier_purchase_bills b left join public.vendors v on v.id = b.vendor_id
  where b.company_id = p_company and b.status = 'posted' and b.invoice_date between p_from and p_to
  union all
  select 'credit_note', n.id, n.credit_note_number, n.credit_date, n.grand_total, i.customer_id, private.ap3_customer_name(i.customer_id),
    jsonb_build_object('invoice_number', i.invoice_number, 'subtotal', n.subtotal, 'tax', n.tax_total, 'supply', case when i.igst_amount > 0 then 'interstate' else 'local' end,
      'rate', (select max(coalesce(ii.gst_percent, 18)) from public.invoice_items ii where ii.invoice_id = i.id))
  from public.credit_notes n join public.invoices i on i.id = n.invoice_id
  where n.company_id = p_company and n.status = 'issued' and n.credit_date between p_from and p_to
$$;
revoke all on function private.ap4_tally_vouchers(uuid, date, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-060: safe order-status links. A random 64-character token is shown once; only its SHA-256 is stored. The public
-- read returns a fixed projection (lines, produced/packed/dispatched quantities, vehicle, LR, expected date) with no
-- prices, cost, notes or other orders. Links expire and can be revoked.
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.order_status_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid not null references public.orders(id),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  token_hint text not null check (token_hint ~ '^[0-9a-f]{4}$'),
  expires_at timestamptz not null,
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  revoked_by uuid references public.app_users(id),
  revoke_reason text check (revoke_reason is null or length(revoke_reason) between 5 and 300),
  view_count integer not null default 0,
  last_viewed_at timestamptz,
  check ((revoked_at is null) = (revoke_reason is null))
);
create unique index if not exists order_status_links_token on public.order_status_links(token_hash);
create index if not exists order_status_links_order_idx on public.order_status_links(company_id, order_id, created_at desc);
create index if not exists order_status_links_orders_fk on public.order_status_links(order_id);
create index if not exists order_status_links_people_idx on public.order_status_links(created_by);
create index if not exists order_status_links_revoker_idx on public.order_status_links(revoked_by);

create or replace function private.ap4_share_roles() returns text[] language sql immutable set search_path = public, private as $$
  select array['owner', 'admin', 'sales_manager', 'sales', 'dispatch_manager', 'dispatch', 'accounts', 'factory_manager'] $$;
revoke all on function private.ap4_share_roles() from public, anon, authenticated;

create or replace function private.ap4_stage_label(p_stage text) returns text language sql immutable set search_path = public, private as $$
  select case when p_stage = 'order_confirmed' then 'Order confirmed'
    when p_stage in ('die_ready', 'billet_ready', 'billet_heating', 'extrusion_planned', 'extruded', 'stretching', 'cutting', 'aging', 'surface_treatment', 'finishing') then 'In production'
    when p_stage = 'packing' then 'Packing' when p_stage = 'dispatched' then 'Dispatched' when p_stage in ('delivered', 'payment_pending') then 'Delivered'
    when p_stage = 'closed' then 'Completed' when p_stage = 'cancelled' then 'Cancelled' else 'In progress' end $$;
revoke all on function private.ap4_stage_label(text) from public, anon, authenticated;

-- The customer-safe projection of one order (used by the public link and the customer summary).
create or replace function private.ap4_order_status_view(p_company uuid, p_order uuid) returns jsonb language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('order_number', o.order_number, 'order_date', o.order_date, 'expected_dispatch_date', o.expected_dispatch_date, 'stage', private.ap4_stage_label(o.current_stage),
    'customer', private.ap3_customer_name(o.customer_id), 'company', (select coalesce(nullif(btrim(co.name), ''), co.legal_name) from public.companies co where co.id = p_company),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('profile', concat_ws(' - ', l.profile_code, l.profile_name), 'finish', l.finish, 'ordered_pieces', l.ordered_pieces,
        'ordered_kg', round(l.ordered_kg, 1), 'produced_kg', round(coalesce((select sum(j.actual_quantity_kg) from public.production_jobs j where j.company_id = p_company and j.order_id = p_order
          and j.status = 'completed' and (j.source_line_id = l.line_id or (l.line_id is null))), 0), 1),
        'packed_kg', round(coalesce((select sum(b.gross_weight_kg - b.tare_weight_kg) from public.prepared_physical_bundles b where b.company_id = p_company and b.order_id = p_order
          and private.ap4_bundle_line(p_company, p_order, b.source_kind, b.source_line_id, b.profile_id) is not distinct from l.line_id), 0), 1),
        'dispatched_kg', round(l.shipped_kg, 1), 'dispatched_pieces', l.shipped_pieces) order by l.profile_code nulls last)
      from private.ap4_order_lines(p_company, p_order) l), '[]'::jsonb),
    'dispatches', coalesce((select jsonb_agg(jsonb_build_object('number', d.dispatch_number, 'date', d.dispatch_date, 'vehicle', d.vehicle_number, 'lr_number', d.lr_number,
        'transporter', d.transporter_name, 'status', initcap(replace(d.delivery_status, '_', ' ')), 'bundles', d.number_of_bundles, 'net_kg', round(d.total_weight_kg, 1),
        'delivered_at', d.delivered_at) order by d.dispatch_date, d.dispatch_number)
      from public.dispatches d where d.company_id = p_company and d.order_id = p_order and d.delivery_status <> 'pending'), '[]'::jsonb))
  from public.orders o where o.id = p_order and o.company_id = p_company
$$;
revoke all on function private.ap4_order_status_view(uuid, uuid) from public, anon, authenticated;

create or replace function public.ap_order_status(p_token text) returns jsonb language plpgsql security definer set search_path = public, private as $$
declare l public.order_status_links%rowtype; v_hash text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return jsonb_build_object('state', 'invalid'); end if;
  v_hash := encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');
  select * into l from public.order_status_links where token_hash = v_hash for update;
  if l.id is null then return jsonb_build_object('state', 'invalid'); end if;
  if l.revoked_at is not null then return jsonb_build_object('state', 'revoked'); end if;
  if l.expires_at <= now() then return jsonb_build_object('state', 'expired'); end if;
  if not exists (select 1 from public.orders o where o.id = l.order_id and o.company_id = l.company_id and o.deleted_at is null) then return jsonb_build_object('state', 'invalid'); end if;
  update public.order_status_links set view_count = view_count + 1, last_viewed_at = clock_timestamp() where id = l.id;
  return jsonb_build_object('state', 'ok', 'expires_at', l.expires_at, 'as_of', clock_timestamp(), 'order', private.ap4_order_status_view(l.company_id, l.order_id));
end;
$$;
revoke all on function public.ap_order_status(text) from public;
grant execute on function public.ap_order_status(text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-089: facts for the "Copy summary" button. The customer version is the safe projection; the internal version adds
-- operational status for the team. Neither contains cost, margin, supplier rates or freight rates.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.ap4_summary_roles(p_kind text, p_internal boolean) returns text[] language sql immutable set search_path = public, private as $$
  select array(select r from unnest(case p_kind
    when 'order' then array['owner', 'admin', 'sales_manager', 'sales', 'production_manager', 'production', 'factory_manager', 'dispatch_manager', 'dispatch', 'inventory_manager', 'accounts', 'quality', 'viewer']
    when 'dispatch' then array['owner', 'admin', 'sales_manager', 'sales', 'factory_manager', 'dispatch_manager', 'dispatch', 'inventory_manager', 'accounts', 'viewer']
    when 'invoice' then array['owner', 'admin', 'accounts', 'viewer']
    when 'job' then array['owner', 'admin', 'production_manager', 'production', 'factory_manager', 'viewer']
    when 'quote' then array['owner', 'admin', 'sales_manager', 'sales', 'accounts', 'viewer'] else array[]::text[] end) r where not (p_internal and r = 'viewer')) $$;
revoke all on function private.ap4_summary_roles(text, boolean) from public, anon, authenticated;

create or replace function private.ap4_summary(c record, p_kind text, p_id uuid, p_internal boolean) returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare v jsonb; o public.orders%rowtype; d public.dispatches%rowtype; i public.invoices%rowtype; j public.production_jobs%rowtype; q public.quotes%rowtype;
begin
  if not (c.role = any(private.ap4_summary_roles(p_kind, p_internal))) then raise exception 'Not permitted' using errcode = '42501'; end if;
  if p_kind = 'order' then
    select * into o from public.orders where id = p_id and company_id = c.company_id and deleted_at is null;
    if o.id is null then raise exception 'AP: Order not found.'; end if;
    v := private.ap4_order_status_view(c.company_id, o.id);
    if p_internal then
      v := v || jsonb_build_object('credit', private.ap4_credit_state(c.company_id, o.id), 'priority', o.priority,
        'jobs_open', (select count(*) from public.production_jobs x where x.company_id = c.company_id and x.order_id = o.id and x.status in ('planned', 'ready', 'in_progress', 'on_hold')),
        'bundles_waiting', (select count(*) from public.prepared_physical_bundles b where b.company_id = c.company_id and b.order_id = o.id and b.dispatch_id is null),
        'notes', left(nullif(btrim(coalesce(o.notes, '')), ''), 300));
    end if;
  elsif p_kind = 'dispatch' then
    select * into d from public.dispatches where id = p_id and company_id = c.company_id;
    if d.id is null then raise exception 'AP: Dispatch not found.'; end if;
    select * into o from public.orders where id = d.order_id;
    v := jsonb_build_object('number', d.dispatch_number, 'date', d.dispatch_date, 'order_number', o.order_number, 'customer', private.ap3_customer_name(o.customer_id),
      'bundles', d.number_of_bundles, 'net_kg', d.total_weight_kg, 'vehicle', d.vehicle_number, 'transporter', d.transporter_name, 'driver', d.driver_name,
      'driver_phone', d.driver_phone, 'lr_number', d.lr_number, 'eway_bill_number', d.eway_bill_number, 'status', initcap(replace(d.delivery_status, '_', ' ')));
    if p_internal then
      v := v || jsonb_build_object('gate_out', (select g.exited_at from public.dispatch_gate_exits g where g.company_id = c.company_id and g.dispatch_id = d.id),
        'invoice_number', (select x.invoice_number from public.invoices x where x.company_id = c.company_id and x.dispatch_id = d.id and x.deleted_at is null and x.status not in ('draft', 'cancelled') limit 1),
        'remarks', left(nullif(btrim(coalesce(d.remarks, '')), ''), 300));
    end if;
  elsif p_kind = 'invoice' then
    select * into i from public.invoices where id = p_id and company_id = c.company_id and deleted_at is null;
    if i.id is null then raise exception 'AP: Invoice not found.'; end if;
    v := jsonb_build_object('number', i.invoice_number, 'date', i.invoice_date, 'due_date', i.due_date, 'customer', private.ap3_customer_name(i.customer_id),
      'total', i.grand_total, 'paid', i.amount_paid, 'balance', coalesce(i.balance_due, i.grand_total - i.amount_paid), 'status', initcap(replace(i.status, '_', ' ')),
      'order_number', (select x.order_number from public.orders x where x.id = i.order_id), 'dispatch_number', (select x.dispatch_number from public.dispatches x where x.id = i.dispatch_id));
    if p_internal then
      v := v || jsonb_build_object('overdue_days', case when i.due_date < private.ist_today() and coalesce(i.balance_due, 0) > 0 then private.ist_today() - i.due_date end,
        'notes', left(nullif(btrim(coalesce(i.notes, '')), ''), 300));
    end if;
  elsif p_kind = 'job' then
    select * into j from public.production_jobs where id = p_id and company_id = c.company_id;
    if j.id is null then raise exception 'AP: Production job not found.'; end if;
    v := jsonb_build_object('number', j.job_number, 'order_number', (select x.order_number from public.orders x where x.id = j.order_id),
      'customer', (select private.ap3_customer_name(x.customer_id) from public.orders x where x.id = j.order_id),
      'profile', (select concat_ws(' - ', ap.profile_code, ap.profile_name) from public.aluminium_profiles ap where ap.id = j.profile_id),
      'planned_kg', j.planned_quantity_kg, 'actual_kg', nullif(j.actual_quantity_kg, 0), 'status', initcap(replace(j.status, '_', ' ')), 'planned_date', j.planned_date);
    if p_internal then
      v := v || jsonb_build_object('press', (select m.machine_name from public.machines m where m.id = j.machine_id), 'die', (select x.die_number from public.dies x where x.id = j.die_id),
        'shift', j.shift, 'remarks', left(nullif(btrim(coalesce(j.remarks, '')), ''), 300));
    end if;
  elsif p_kind = 'quote' then
    select * into q from public.quotes where id = p_id and company_id = c.company_id and deleted_at is null;
    if q.id is null then raise exception 'AP: Quotation not found.'; end if;
    v := jsonb_build_object('number', q.quote_number, 'revision', q.revision_number, 'date', q.quote_date, 'valid_until', q.valid_until, 'customer', private.ap3_customer_name(q.customer_id),
      'items', (select count(*) from public.quote_items x where x.quote_id = q.id), 'total_before_gst', q.total_before_gst, 'gst', q.gst_amount, 'total', q.grand_total,
      'delivery', q.delivery_timeline, 'payment_terms', q.payment_terms, 'status', initcap(replace(q.status, '_', ' ')));
    if p_internal then
      v := v || jsonb_build_object('approval_needed', q.low_margin_approval_required and q.approved_at is null, 'notes', left(nullif(btrim(coalesce(q.notes, '')), ''), 300));
    end if;
  else
    raise exception 'AP: Unknown record type.';
  end if;
  return jsonb_build_object('kind', p_kind, 'audience', case when p_internal then 'internal' else 'customer' end, 'facts', v,
    'phone', case when p_kind in ('order', 'dispatch', 'invoice', 'quote') then (select coalesce(nullif(btrim(cu.whatsapp_number), ''), cu.phone) from public.customers cu where cu.id =
      coalesce(o.customer_id, i.customer_id, q.customer_id)) end);
end;
$$;
revoke all on function private.ap4_summary(record, text, uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-002 hooks for the freight proposal (earlier batches dispatch to their own types unchanged).
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.ap_proposal_versions(p_company uuid, p_type text, p_target text)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select case when p_type = 'freight.estimate' then private.ap4_freight_versions(p_company, p_target)
    when p_type = 'bank.receipt_match' then private.ap3_proposal_versions(p_company, p_type, p_target)
    when p_type in ('production.expected_output', 'die.service_due', 'maintenance.pm_due') then private.ap2_proposal_versions(p_company, p_type, p_target)
    else private.ap1_proposal_versions(p_company, p_type, p_target) end
$$;
revoke all on function private.ap_proposal_versions(uuid, text, text) from public, anon, authenticated;

create or replace function private.ap_proposal_editable(p_type text)
returns text[] language sql immutable set search_path = public, private as $$
  select case p_type
    when 'freight.estimate' then array['option_index', 'amount', 'reason']
    when 'bank.receipt_match' then array[]::text[]
    when 'production.expected_output' then array['reject_pieces', 'reject_kg', 'reject_reason', 'good_pieces', 'good_kg']
    when 'die.service_due' then array['scheduled_for']
    when 'maintenance.pm_due' then array['window_start', 'window_end']
    else private.ap1_proposal_editable(p_type) end
$$;
revoke all on function private.ap_proposal_editable(text) from public, anon, authenticated;

create or replace function private.ap_proposal_apply(p_company uuid, p_actor uuid, p_role text, p_proposal public.proposals, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
begin
  if p_proposal.proposal_type = 'freight.estimate' then
    return private.ap4_apply_freight(p_company, p_actor, p_role, p_proposal, p_payload);
  elsif p_proposal.proposal_type = 'bank.receipt_match' then
    return private.ap3_apply_bank_match(p_company, p_actor, p_role, p_proposal, p_payload);
  end if;
  return private.ap2_proposal_apply(p_company, p_actor, p_role, p_proposal, p_payload);
end;
$$;
revoke all on function private.ap_proposal_apply(uuid, uuid, text, public.proposals, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- RLS on every new table: company read for the roles that use it; no client grants (all access through functions).
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare t text; r text;
begin
  foreach t in array array['dispatch_autopilot_settings', 'loading_sessions', 'loading_scans', 'dispatch_gate_exits', 'label_stations', 'label_print_jobs',
    'customer_packing_specs', 'packing_deviations', 'transporter_rate_cards', 'freight_decisions', 'dispatch_eway_inputs', 'eway_distance_memory', 'eway_exports',
    'eway_export_items', 'tally_ledger_map', 'tally_export_batches', 'tally_export_vouchers', 'order_status_links'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('drop policy if exists %I on public.%I', 'ap4 company read', t);
    r := case
      when t in ('tally_ledger_map', 'tally_export_batches', 'tally_export_vouchers') then 'array[''owner'',''admin'',''accounts'']'
      when t in ('dispatch_eway_inputs', 'eway_distance_memory', 'eway_exports', 'eway_export_items') then 'array[''owner'',''admin'',''accounts'',''dispatch_manager'',''dispatch'']'
      when t in ('transporter_rate_cards', 'freight_decisions') then 'array[''owner'',''admin'',''dispatch_manager'',''dispatch'',''factory_manager'',''sales_manager'',''sales'',''accounts'']'
      when t = 'order_status_links' then 'array[''owner'',''admin'',''sales_manager'',''sales'',''dispatch_manager'',''dispatch'',''accounts'',''factory_manager'']'
      when t in ('customer_packing_specs', 'packing_deviations') then 'array[''owner'',''admin'',''factory_manager'',''dispatch_manager'',''dispatch'',''inventory_manager'',''sales_manager'',''quality'',''production_manager'',''production'']'
      else 'array[''owner'',''admin'',''factory_manager'',''dispatch_manager'',''dispatch'',''inventory_manager'']' end;
    execute format('create policy %I on public.%I for select to authenticated using (company_id = (select public.get_current_user_company_id()) and (select public.get_current_user_role()) = any(%s))',
      'ap4 company read', t, r);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Client entry point: dispatch floor (AP-018 loading, AP-019 gate, AP-051 ready list, AP-017 labels, AP-035 packing).
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.ap4_vehicle_text(p_value text) returns text language plpgsql immutable set search_path = public, private as $$
declare v text := private.ap4_norm_vehicle(p_value);
begin
  if v is null then return null; end if;
  if length(v) < 4 or length(v) > 12 then raise exception 'AP: Enter the vehicle registration (for example MH12AB1234).'; end if;
  return v;
end;
$$;
revoke all on function private.ap4_vehicle_text(text) from public, anon, authenticated;

create or replace function public.ap_dispatch(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; s public.loading_sessions%rowtype; v_id uuid; v_page integer := private.ap3_page(p_payload); v_total bigint; v_rows jsonb; v_search text; v_status text;
  o public.orders%rowtype; v_transporter uuid; v_phone text; v_reason text; sc public.loading_scans%rowtype; d public.dispatches%rowtype; v_n integer; v_m integer;
  j public.label_print_jobs%rowtype; b public.prepared_physical_bundles%rowtype; r record; st public.label_stations%rowtype; sp public.customer_packing_specs%rowtype;
  v_customer uuid; v_rev integer; v_ids uuid[]; v_days integer; v_from date; v_to date; v_set public.dispatch_autopilot_settings%rowtype;
begin
  select * into c from private.ap_ctx(private.ap4_ready_roles() || array['quality', 'production']);
  v_search := lower(nullif(btrim(coalesce(p_payload ->> 'search', '')), ''));
  if length(coalesce(v_search, '')) > 60 then raise exception 'AP: Shorten the search.'; end if;

  -- AP-018 loading sessions ------------------------------------------------------------------------------------
  if p_command = 'sessions' then
    perform private.ap4_need(c.role, private.ap4_dispatch_roles());
    perform private.ap_keys(p_payload, array['status', 'search', 'page']);
    v_status := coalesce(nullif(p_payload ->> 'status', ''), 'open');
    if v_status not in ('open', 'completed', 'cancelled', 'all') then raise exception 'AP: Invalid filter.'; end if;
    select coalesce(jsonb_agg(z.row order by z.started_at desc), '[]'::jsonb), max(z.total) into v_rows, v_total from (
      select private.ap4_session_row(c.company_id, x, false) "row", x.started_at, count(*) over () total from public.loading_sessions x join public.orders oo on oo.id = x.order_id
      where x.company_id = c.company_id and (v_status = 'all' or x.status = v_status)
        and (v_search is null or position(v_search in lower(oo.order_number || ' ' || coalesce(x.vehicle_number, '') || ' ' || coalesce(private.ap3_customer_name(oo.customer_id), ''))) > 0)
      order by x.started_at desc limit 10 offset (v_page - 1) * 10) z;
    return jsonb_build_object('page', v_page, 'total_count', coalesce(v_total, 0), 'rows', v_rows);
  elsif p_command = 'session' then
    perform private.ap4_need(c.role, private.ap4_dispatch_roles());
    perform private.ap_keys(p_payload, array['id']);
    select * into s from public.loading_sessions where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id;
    if s.id is null then raise exception 'AP: Loading session not found.'; end if;
    return private.ap4_session_row(c.company_id, s, true);
  elsif p_command = 'order_session' then
    perform private.ap4_need(c.role, private.ap4_dispatch_roles());
    perform private.ap_keys(p_payload, array['order_id']);
    select * into s from public.loading_sessions where company_id = c.company_id and order_id = private.ap_uuid(p_payload, 'order_id') and status = 'open';
    return case when s.id is null then null else private.ap4_session_row(c.company_id, s, false) end;
  elsif p_command in ('start', 'update') then
    perform private.ap4_need(c.role, private.ap4_dispatch_roles());
    perform private.ap_keys(p_payload, array['order_id', 'id', 'vehicle_number', 'transporter_name', 'transporter_id', 'driver_name', 'driver_phone', 'lr_number']);
    v_transporter := private.ap_uuid(p_payload, 'transporter_id', false);
    if v_transporter is not null and not exists (select 1 from public.vendors v where v.id = v_transporter and v.company_id = c.company_id and v.vendor_type = 'transporter' and v.is_active) then
      raise exception 'AP: Choose an active transporter.';
    end if;
    v_phone := nullif(regexp_replace(coalesce(p_payload ->> 'driver_phone', ''), '\D', '', 'g'), '');
    if v_phone is not null then
      if length(v_phone) = 12 and left(v_phone, 2) = '91' then v_phone := right(v_phone, 10); end if;
      if v_phone !~ '^[6-9][0-9]{9}$' then raise exception 'AP: Enter the driver''s 10-digit mobile number.'; end if;
    end if;
    if p_command = 'start' then
      select * into o from public.orders where id = private.ap_uuid(p_payload, 'order_id') and company_id = c.company_id and deleted_at is null for update;
      if o.id is null then raise exception 'AP: Order not found.'; end if;
      if o.current_stage in ('cancelled', 'closed', 'delivered') then raise exception 'AP: Order % is %; nothing can be loaded for it.', o.order_number, replace(o.current_stage, '_', ' '); end if;
      select * into s from public.loading_sessions where company_id = c.company_id and order_id = o.id and status = 'open';
      if s.id is not null then return private.ap4_session_row(c.company_id, s, true) || jsonb_build_object('existing', true); end if;
      insert into public.loading_sessions(company_id, order_id, vehicle_number, transporter_name, transporter_id, driver_name, driver_phone, lr_number, started_by)
        values (c.company_id, o.id, private.ap4_vehicle_text(p_payload ->> 'vehicle_number'),
          coalesce(private.ap_text(p_payload ->> 'transporter_name', 'Transporter', 2, 120, false), (select v.vendor_name from public.vendors v where v.id = v_transporter)), v_transporter,
          private.ap_text(p_payload ->> 'driver_name', 'Driver name', 2, 80, false), v_phone, private.ap_text(p_payload ->> 'lr_number', 'LR number', 1, 40, false), c.actor_id)
        returning * into s;
      return private.ap4_session_row(c.company_id, s, true) || jsonb_build_object('existing', false);
    end if;
    select * into s from public.loading_sessions where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id for update;
    if s.id is null or s.status <> 'open' then raise exception 'AP: Only an open loading session can be changed.'; end if;
    update public.loading_sessions set vehicle_number = private.ap4_vehicle_text(p_payload ->> 'vehicle_number'),
      transporter_name = coalesce(private.ap_text(p_payload ->> 'transporter_name', 'Transporter', 2, 120, false), (select v.vendor_name from public.vendors v where v.id = v_transporter)),
      transporter_id = v_transporter, driver_name = private.ap_text(p_payload ->> 'driver_name', 'Driver name', 2, 80, false), driver_phone = v_phone,
      lr_number = private.ap_text(p_payload ->> 'lr_number', 'LR number', 1, 40, false), updated_at = clock_timestamp()
      where id = s.id returning * into s;
    return private.ap4_session_row(c.company_id, s, true);
  elsif p_command = 'scan' then
    perform private.ap4_need(c.role, private.ap4_dispatch_roles());
    return private.ap4_scan(c, p_payload);
  elsif p_command = 'remove' then
    perform private.ap4_need(c.role, private.ap4_dispatch_roles());
    perform private.ap_keys(p_payload, array['scan_id', 'reason']);
    v_reason := private.ap_text(p_payload ->> 'reason', 'Reason', 5, 300);
    select * into sc from public.loading_scans where id = private.ap_uuid(p_payload, 'scan_id') and company_id = c.company_id for update;
    select * into s from public.loading_sessions where id = sc.session_id for update;
    if sc.id is null or sc.outcome <> 'loaded' or sc.removed_at is not null then raise exception 'AP: That bundle is not on the vehicle.'; end if;
    if s.status <> 'open' then raise exception 'AP: The loading session is %.', s.status; end if;
    update public.loading_scans set removed_at = clock_timestamp(), removed_by = c.actor_id, remove_reason = v_reason where id = sc.id;
    return private.ap4_session_row(c.company_id, s, true);
  elsif p_command = 'cancel' then
    perform private.ap4_need(c.role, private.ap4_dispatch_roles());
    perform private.ap_keys(p_payload, array['id', 'reason']);
    v_reason := private.ap_text(p_payload ->> 'reason', 'Reason', 5, 300);
    select * into s from public.loading_sessions where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id for update;
    if s.id is null or s.status <> 'open' then raise exception 'AP: Only an open loading session can be cancelled.'; end if;
    update public.loading_scans set removed_at = clock_timestamp(), removed_by = c.actor_id, remove_reason = left('Session cancelled: ' || v_reason, 300)
      where session_id = s.id and outcome = 'loaded' and removed_at is null;
    update public.loading_sessions set status = 'cancelled', cancelled_by = c.actor_id, cancelled_at = clock_timestamp(), cancel_reason = v_reason, updated_at = clock_timestamp()
      where id = s.id returning * into s;
    return private.ap4_session_row(c.company_id, s, false);
  elsif p_command = 'bundles_for_dispatch' then
    perform private.ap4_need(c.role, private.ap4_dispatch_roles());
    perform private.ap_keys(p_payload, array['id']);
    select * into s from public.loading_sessions where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id;
    if s.id is null then raise exception 'AP: Loading session not found.'; end if;
    if s.status <> 'open' then raise exception 'AP: This loading session is %.', s.status; end if;
    select count(*), count(distinct x.dispatch_id), count(x.dispatch_id), min(x.dispatch_id::text)::uuid into v_n, v_m, v_total, v_id
      from public.loading_scans y join public.prepared_physical_bundles x on x.id = y.bundle_id where y.company_id = c.company_id and y.session_id = s.id and y.outcome = 'loaded' and y.removed_at is null;
    if v_n = 0 then raise exception 'AP: Scan at least one bundle before completing the load.'; end if;
    return jsonb_build_object('session_id', s.id, 'order_id', s.order_id, 'vehicle_number', s.vehicle_number, 'transporter_name', s.transporter_name, 'driver_name', s.driver_name,
      'driver_phone', s.driver_phone, 'lr_number', s.lr_number,
      'already_dispatched', case when v_total = v_n and v_m = 1 then v_id end,
      'bundles', (select jsonb_agg(jsonb_build_object('bundle_number', x.bundle_number, 'source_line_id', x.source_line_id, 'number_of_pieces', x.number_of_pieces,
          'net_length_m', x.net_length_m, 'gross_weight_kg', x.gross_weight_kg, 'tare_weight_kg', x.tare_weight_kg) order by y.scanned_at)
        from public.loading_scans y join public.prepared_physical_bundles x on x.id = y.bundle_id where y.company_id = c.company_id and y.session_id = s.id and y.outcome = 'loaded' and y.removed_at is null));
  elsif p_command = 'complete' then
    perform private.ap4_need(c.role, private.ap4_dispatch_roles());
    perform private.ap_keys(p_payload, array['id', 'dispatch_id']);
    select * into s from public.loading_sessions where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id for update;
    select * into d from public.dispatches where id = private.ap_uuid(p_payload, 'dispatch_id') and company_id = c.company_id;
    if s.id is null or d.id is null then raise exception 'AP: Loading session or dispatch not found.'; end if;
    if s.status = 'completed' and s.dispatch_id = d.id then return private.ap4_session_row(c.company_id, s, false) || jsonb_build_object('repeated', true); end if;
    if s.status <> 'open' then raise exception 'AP: This loading session is %.', s.status; end if;
    if d.order_id <> s.order_id or d.actual_dispatched_at is null then raise exception 'AP: That dispatch does not belong to this load.'; end if;
    select count(*), count(*) filter (where x.dispatch_id = d.id) into v_n, v_m from public.loading_scans y join public.prepared_physical_bundles x on x.id = y.bundle_id
      where y.company_id = c.company_id and y.session_id = s.id and y.outcome = 'loaded' and y.removed_at is null;
    if v_n = 0 or v_n <> v_m or v_n <> (select count(*) from public.packing_list_items p where p.company_id = c.company_id and p.dispatch_id = d.id) then
      raise exception 'AP: The dispatch bundles differ from the bundles scanned on this vehicle.';
    end if;
    update public.loading_sessions set status = 'completed', dispatch_id = d.id, completed_by = c.actor_id, completed_at = clock_timestamp(), updated_at = clock_timestamp()
      where id = s.id returning * into s;
    -- The freight decided while loading follows the dispatch for billed-freight variance.
    update public.freight_decisions set target_kind = 'dispatch', target_id = d.id
      where company_id = c.company_id and target_kind = 'loading' and target_id = s.id and status = 'current'
        and not exists (select 1 from public.freight_decisions f2 where f2.company_id = c.company_id and f2.target_kind = 'dispatch' and f2.target_id = d.id and f2.status = 'current');
    return private.ap4_session_row(c.company_id, s, false);

  -- AP-019 gate ------------------------------------------------------------------------------------------------
  elsif p_command = 'gate_queue' then
    perform private.ap4_need(c.role, private.ap4_gate_roles());
    perform private.ap_keys(p_payload, array['search', 'page']);
    select coalesce(jsonb_agg(z.row order by z.at), '[]'::jsonb), max(z.total) into v_rows, v_total from (
      select private.ap4_gate_row(c.company_id, x) "row", x.actual_dispatched_at at, count(*) over () total from public.dispatches x join public.orders oo on oo.id = x.order_id
      where x.company_id = c.company_id and x.actual_dispatched_at is not null and x.delivery_status = 'dispatched' and x.actual_dispatched_at > now() - interval '14 days'
        and not exists (select 1 from public.dispatch_gate_exits g where g.company_id = c.company_id and g.dispatch_id = x.id)
        and (v_search is null or position(v_search in lower(coalesce(x.dispatch_number, '') || ' ' || coalesce(x.vehicle_number, '') || ' ' || oo.order_number || ' '
          || coalesce(private.ap3_customer_name(oo.customer_id), ''))) > 0)
      order by x.actual_dispatched_at limit 10 offset (v_page - 1) * 10) z;
    return jsonb_build_object('page', v_page, 'total_count', coalesce(v_total, 0), 'rows', v_rows);
  elsif p_command = 'gate_out' then
    perform private.ap4_need(c.role, private.ap4_gate_roles());
    return private.ap4_gate_out(c, p_payload);
  elsif p_command = 'gate_register' then
    perform private.ap4_need(c.role, private.ap4_gate_roles() || array['accounts', 'inventory_manager']);
    perform private.ap_keys(p_payload, array['search', 'page', 'from', 'to']);
    v_from := coalesce(private.ap4_day(p_payload, 'from', false), private.ist_today() - 30); v_to := coalesce(private.ap4_day(p_payload, 'to', false), private.ist_today());
    if v_to < v_from or v_to - v_from > 366 then raise exception 'AP: Choose a range of at most a year.'; end if;
    select coalesce(jsonb_agg(z.row order by z.at desc), '[]'::jsonb), max(z.total) into v_rows, v_total from (
      select jsonb_build_object('id', g.id, 'dispatch_id', x.id, 'dispatch_number', x.dispatch_number, 'order_number', oo.order_number, 'customer', private.ap3_customer_name(oo.customer_id),
          'vehicle_number', g.vehicle_number, 'transporter_name', x.transporter_name, 'lr_number', x.lr_number, 'eway_bill_number', x.eway_bill_number, 'bundles', x.number_of_bundles,
          'net_kg', x.total_weight_kg, 'exited_at', g.exited_at, 'recorded_by', private.ap4_user_name(g.recorded_by), 'vehicle_check', g.vehicle_check, 'override_reason', g.override_reason,
          'eway_state', g.eway_state, 'eway_reason', g.eway_reason, 'loaded_at', x.actual_dispatched_at) "row", g.exited_at at, count(*) over () total
      from public.dispatch_gate_exits g join public.dispatches x on x.id = g.dispatch_id join public.orders oo on oo.id = x.order_id
      where g.company_id = c.company_id and (g.exited_at at time zone 'Asia/Kolkata')::date between v_from and v_to
        and (v_search is null or position(v_search in lower(coalesce(x.dispatch_number, '') || ' ' || g.vehicle_number || ' ' || coalesce(x.lr_number, '') || ' ' || oo.order_number)) > 0)
      order by g.exited_at desc limit 10 offset (v_page - 1) * 10) z;
    return jsonb_build_object('page', v_page, 'total_count', coalesce(v_total, 0), 'rows', v_rows, 'from', v_from, 'to', v_to);

  -- AP-051 ready to ship -----------------------------------------------------------------------------------------
  elsif p_command = 'ready' then
    perform private.ap4_need(c.role, private.ap4_ready_roles());
    perform private.ap_keys(p_payload, array['search', 'page', 'due_within_days', 'released_only']);
    return private.ap4_ready(c.company_id, p_payload);

  -- AP-017 labels ------------------------------------------------------------------------------------------------
  elsif p_command = 'stations' then
    perform private.ap4_need(c.role, private.ap4_dispatch_roles());
    perform private.ap_keys(p_payload, array[]::text[]);
    return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'location', x.location, 'auto_print', x.auto_print, 'is_default', x.is_default, 'active', x.active,
      'queued', (select count(*) from public.label_print_jobs q where q.company_id = c.company_id and q.status = 'queued' and (q.station_id = x.id or (q.station_id is null and x.is_default))
        and not exists (select 1 from public.prepared_physical_bundles pb where pb.id = q.bundle_id and pb.dispatch_id is not null)))
      order by x.is_default desc, x.name) from public.label_stations x where x.company_id = c.company_id), '[]'::jsonb);
  elsif p_command = 'save_station' then
    perform private.ap4_need(c.role, private.ap4_supervisor_roles());
    perform private.ap_keys(p_payload, array['id', 'name', 'location', 'auto_print', 'is_default', 'active']);
    v_id := private.ap_uuid(p_payload, 'id', false);
    if coalesce((p_payload ->> 'is_default')::boolean, false) then
      update public.label_stations set is_default = false, updated_at = clock_timestamp() where company_id = c.company_id and is_default and id is distinct from v_id;
    end if;
    if v_id is null then
      insert into public.label_stations(company_id, name, location, auto_print, is_default, active, created_by)
        values (c.company_id, private.ap_text(p_payload ->> 'name', 'Station name', 2, 60), private.ap_text(p_payload ->> 'location', 'Location', 2, 120, false),
          coalesce((p_payload ->> 'auto_print')::boolean, true), coalesce((p_payload ->> 'is_default')::boolean, false), true, c.actor_id) returning * into st;
      -- Labels queued before any station existed go to the first default station.
      if st.is_default then update public.label_print_jobs set station_id = st.id where company_id = c.company_id and station_id is null and status in ('queued', 'blocked'); end if;
    else
      update public.label_stations set name = private.ap_text(p_payload ->> 'name', 'Station name', 2, 60), location = private.ap_text(p_payload ->> 'location', 'Location', 2, 120, false),
        auto_print = coalesce((p_payload ->> 'auto_print')::boolean, auto_print), is_default = coalesce((p_payload ->> 'is_default')::boolean, is_default),
        active = coalesce((p_payload ->> 'active')::boolean, active), updated_at = clock_timestamp()
        where id = v_id and company_id = c.company_id returning * into st;
      if st.id is null then raise exception 'AP: Station not found.'; end if;
    end if;
    return jsonb_build_object('id', st.id, 'name', st.name);
  elsif p_command = 'label_queue' then
    perform private.ap4_need(c.role, private.ap4_dispatch_roles());
    perform private.ap_keys(p_payload, array['station_id', 'status', 'page']);
    v_id := private.ap_uuid(p_payload, 'station_id', false);
    v_status := coalesce(nullif(p_payload ->> 'status', ''), 'queued');
    if v_status not in ('queued', 'blocked', 'printed', 'cancelled', 'all') then raise exception 'AP: Invalid filter.'; end if;
    select coalesce(jsonb_agg(z.row order by z.k), '[]'::jsonb), max(z.total) into v_rows, v_total from (
      select private.ap4_label_job_row(x) "row", row_number() over (order by case when v_status in ('queued', 'blocked') then extract(epoch from x.queued_at) else -extract(epoch from coalesce(x.printed_at, x.queued_at)) end, x.id) k,
        count(*) over () total
      from public.label_print_jobs x where x.company_id = c.company_id and (v_status = 'all' or x.status = v_status)
        and (v_id is null or x.station_id = v_id or (x.station_id is null and exists (select 1 from public.label_stations y where y.id = v_id and y.is_default)))
        -- A bundle that already left needs no label printed now (the weekly audit still reports it as unlabelled).
        and (x.status not in ('queued', 'blocked') or not exists (select 1 from public.prepared_physical_bundles pb where pb.id = x.bundle_id and pb.dispatch_id is not null))
      order by k limit 10 offset (v_page - 1) * 10) z;
    return jsonb_build_object('page', v_page, 'total_count', coalesce(v_total, 0), 'rows', v_rows);
  elsif p_command = 'label_printed' then
    perform private.ap4_need(c.role, private.ap4_dispatch_roles());
    perform private.ap_keys(p_payload, array['job_id']);
    return private.ap4_label_printed(c, private.ap_uuid(p_payload, 'job_id'));
  elsif p_command = 'label_reprint' then
    perform private.ap4_need(c.role, private.ap4_dispatch_roles());
    perform private.ap_keys(p_payload, array['bundle_id', 'reason', 'note']);
    if coalesce(p_payload ->> 'reason', '') not in ('reprint', 'damaged', 'relabel') then raise exception 'AP: Choose why the label is printed again.'; end if;
    select * into b from public.prepared_physical_bundles where id = private.ap_uuid(p_payload, 'bundle_id') and company_id = c.company_id for update;
    if b.id is null then raise exception 'AP: Bundle not found.'; end if;
    if b.dispatch_id is not null then raise exception 'AP: Bundle % has already been dispatched; its label cannot be reprinted.', b.bundle_number; end if;
    if exists (select 1 from public.label_print_jobs q where q.company_id = c.company_id and q.bundle_id = b.id and q.status = 'queued') then raise exception 'AP: A label for % is already waiting to print.', b.bundle_number; end if;
    v_id := private.ap4_label_enqueue(c.company_id, b.id, p_payload ->> 'reason', private.ap_text(p_payload ->> 'note', 'Reason', 5, 300), c.actor_id);
    select * into j from public.label_print_jobs where id = v_id;
    return private.ap4_label_job_row(j);
  elsif p_command = 'label_retry' then
    perform private.ap4_need(c.role, private.ap4_dispatch_roles());
    perform private.ap_keys(p_payload, array['job_id']);
    select * into j from public.label_print_jobs where id = private.ap_uuid(p_payload, 'job_id') and company_id = c.company_id for update;
    if j.id is null or j.status <> 'blocked' then raise exception 'AP: Only a blocked label can be checked again.'; end if;
    select * into r from private.ap4_label_resolve(c.company_id, j.bundle_id);
    update public.label_print_jobs set status = case when r.blocked_reason is null then 'queued' else 'blocked' end, template_id = r.template_id, template_revision = r.template_revision,
      fields = r.fields, missing = r.missing, blocked_reason = r.blocked_reason where id = j.id returning * into j;
    return private.ap4_label_job_row(j);
  elsif p_command = 'label_cancel' then
    perform private.ap4_need(c.role, private.ap4_supervisor_roles());
    perform private.ap_keys(p_payload, array['job_id', 'reason']);
    select * into j from public.label_print_jobs where id = private.ap_uuid(p_payload, 'job_id') and company_id = c.company_id for update;
    if j.id is null or j.status not in ('queued', 'blocked') then raise exception 'AP: Only a waiting label can be cancelled.'; end if;
    update public.label_print_jobs set status = 'cancelled', blocked_reason = null, cancelled_reason = private.ap_text(p_payload ->> 'reason', 'Reason', 5, 300) where id = j.id returning * into j;
    return private.ap4_label_job_row(j);
  elsif p_command = 'label_audit' then
    perform private.ap4_need(c.role, private.ap4_dispatch_roles());
    perform private.ap_keys(p_payload, array['days', 'page']);
    v_days := coalesce(private.ap4_num(p_payload, 'days', 'Days', 1, 31, false), 7)::integer;
    select coalesce(jsonb_agg(z.row order by z.recorded_at desc), '[]'::jsonb), max(z.total) into v_rows, v_total from (
      select jsonb_build_object('bundle_id', x.id, 'bundle_number', x.bundle_number, 'order_number', oo.order_number, 'recorded_at', x.recorded_at, 'dispatched', x.dispatch_id is not null,
          'job_status', (select q.status from public.label_print_jobs q where q.company_id = c.company_id and q.bundle_id = x.id order by q.queued_at desc limit 1),
          'blocked_reason', (select q.blocked_reason from public.label_print_jobs q where q.company_id = c.company_id and q.bundle_id = x.id order by q.queued_at desc limit 1)) "row",
        x.recorded_at, count(*) over () total
      from public.prepared_physical_bundles x join public.orders oo on oo.id = x.order_id
      where x.company_id = c.company_id and x.recorded_at > now() - make_interval(days => v_days)
        and not exists (select 1 from public.packing_label_prints lp where lp.company_id = c.company_id and lp.bundle_id = x.id)
      order by x.recorded_at desc limit 10 offset (v_page - 1) * 10) z;
    return jsonb_build_object('page', v_page, 'total_count', coalesce(v_total, 0), 'rows', v_rows, 'days', v_days,
      'stats', (select jsonb_build_object('bundles', count(*), 'labelled', count(*) filter (where exists (select 1 from public.packing_label_prints lp where lp.company_id = c.company_id and lp.bundle_id = x.id)),
          'median_seconds', (select round((percentile_cont(0.5) within group (order by extract(epoch from q.printed_at - q.queued_at)))::numeric, 1) from public.label_print_jobs q
            where q.company_id = c.company_id and q.reason = 'initial' and q.status = 'printed' and q.queued_at > now() - make_interval(days => v_days)),
          'p90_seconds', (select round((percentile_cont(0.9) within group (order by extract(epoch from q.printed_at - q.queued_at)))::numeric, 1) from public.label_print_jobs q
            where q.company_id = c.company_id and q.reason = 'initial' and q.status = 'printed' and q.queued_at > now() - make_interval(days => v_days)),
          'reprints', (select count(*) from public.label_print_jobs q where q.company_id = c.company_id and q.reason <> 'initial' and q.queued_at > now() - make_interval(days => v_days)))
        from public.prepared_physical_bundles x where x.company_id = c.company_id and x.recorded_at > now() - make_interval(days => v_days)));

  -- AP-035 packing ---------------------------------------------------------------------------------------------
  elsif p_command = 'pack_plan' then
    perform private.ap_keys(p_payload, array['order_id']);
    select * into o from public.orders where id = private.ap_uuid(p_payload, 'order_id') and company_id = c.company_id and deleted_at is null;
    if o.id is null then raise exception 'AP: Order not found.'; end if;
    return private.ap4_pack_plan(c.company_id, o.id) || jsonb_build_object('deviations', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'bundle_number', b2.bundle_number, 'kind', x.kind,
        'expected_pieces', x.expected_pieces, 'actual_pieces', x.actual_pieces, 'max_bundle_kg', x.max_bundle_kg, 'actual_kg', x.actual_kg, 'note', x.note, 'created_at', x.created_at) order by x.created_at desc)
      from public.packing_deviations x join public.prepared_physical_bundles b2 on b2.id = x.bundle_id where x.company_id = c.company_id and x.order_id = o.id), '[]'::jsonb));
  elsif p_command = 'pack_specs' then
    perform private.ap_keys(p_payload, array['customer_id']);
    v_customer := private.ap_uuid(p_payload, 'customer_id', false);
    if v_customer is not null and not exists (select 1 from public.customers x where x.id = v_customer and x.company_id = c.company_id) then raise exception 'AP: Customer not found.'; end if;
    return jsonb_build_object('customer_id', v_customer, 'can_edit', c.role = any(array['owner', 'admin', 'sales_manager', 'dispatch_manager', 'factory_manager', 'quality']),
      'effective', (select to_jsonb(x) from private.ap4_pack_spec(c.company_id, v_customer) x where x.id is not null),
      'history', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'revision', x.revision, 'status', x.status, 'max_bundle_kg', x.max_bundle_kg, 'max_pieces', x.max_pieces,
          'wrapping', x.wrapping, 'interleaving_paper', x.interleaving_paper, 'battens_per_bundle', x.battens_per_bundle, 'material_ids', to_jsonb(x.material_ids), 'notes', x.notes,
          'reason', x.reason, 'set_by', private.ap4_user_name(x.set_by), 'set_at', x.set_at) order by x.revision desc)
        from (select * from public.customer_packing_specs y where y.company_id = c.company_id and y.customer_id is not distinct from v_customer order by y.revision desc limit 6) x), '[]'::jsonb),
      'materials', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'code', m.material_code, 'name', m.material_name, 'type', m.material_type, 'unit', m.unit,
          'method', m.calculation_method, 'rate', m.consumption_rate) order by m.material_code) from public.packaging_materials m where m.company_id = c.company_id and m.is_active), '[]'::jsonb));
  elsif p_command = 'save_pack_spec' then
    perform private.ap4_need(c.role, array['owner', 'admin', 'sales_manager', 'dispatch_manager', 'factory_manager', 'quality']);
    perform private.ap_keys(p_payload, array['customer_id', 'max_bundle_kg', 'max_pieces', 'wrapping', 'interleaving_paper', 'battens_per_bundle', 'material_ids', 'notes', 'reason']);
    v_customer := private.ap_uuid(p_payload, 'customer_id', false);
    if v_customer is not null and not exists (select 1 from public.customers x where x.id = v_customer and x.company_id = c.company_id) then raise exception 'AP: Customer not found.'; end if;
    if coalesce(p_payload ->> 'wrapping', 'stretch_film') not in ('stretch_film', 'bubble_wrap', 'pp_woven_sheet', 'hdpe', 'paper', 'none') then raise exception 'AP: Choose the wrapping.'; end if;
    v_ids := coalesce(array(select jsonb_array_elements_text(coalesce(p_payload -> 'material_ids', '[]'::jsonb))::uuid), '{}');
    if cardinality(v_ids) > 12 or exists (select 1 from unnest(v_ids) u where not exists (select 1 from public.packaging_materials m where m.id = u and m.company_id = c.company_id and m.is_active)) then
      raise exception 'AP: Choose active packaging materials (at most 12).';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(c.company_id::text || ':pack-spec:' || coalesce(v_customer::text, 'company'), 0));
    select coalesce(max(x.revision), 0) + 1 into v_rev from public.customer_packing_specs x where x.company_id = c.company_id and x.customer_id is not distinct from v_customer;
    update public.customer_packing_specs set status = 'superseded', superseded_at = clock_timestamp()
      where company_id = c.company_id and customer_id is not distinct from v_customer and status = 'active';
    insert into public.customer_packing_specs(company_id, customer_id, revision, max_bundle_kg, max_pieces, wrapping, interleaving_paper, battens_per_bundle, material_ids, notes, reason, set_by)
      values (c.company_id, v_customer, v_rev, private.ap4_num(p_payload, 'max_bundle_kg', 'Maximum bundle weight', 1, 5000, false),
        private.ap4_num(p_payload, 'max_pieces', 'Maximum pieces per bundle', 1, 5000, false)::integer, coalesce(p_payload ->> 'wrapping', 'stretch_film'),
        coalesce((p_payload ->> 'interleaving_paper')::boolean, false), coalesce(private.ap4_num(p_payload, 'battens_per_bundle', 'Battens per bundle', 0, 20, false), 0)::integer, v_ids,
        private.ap_text(p_payload ->> 'notes', 'Notes', 2, 500, false), private.ap_text(p_payload ->> 'reason', 'Reason', 5, 300), c.actor_id)
      returning * into sp;
    return jsonb_build_object('id', sp.id, 'revision', sp.revision);
  elsif p_command = 'deviations' then
    perform private.ap_keys(p_payload, array['page', 'order_id', 'open_only']);
    v_id := private.ap_uuid(p_payload, 'order_id', false);
    select coalesce(jsonb_agg(z.row order by z.created_at desc), '[]'::jsonb), max(z.total) into v_rows, v_total from (
      select jsonb_build_object('id', x.id, 'bundle_number', b2.bundle_number, 'order_id', x.order_id, 'order_number', oo.order_number, 'customer', private.ap3_customer_name(oo.customer_id),
          'kind', x.kind, 'expected_pieces', x.expected_pieces, 'actual_pieces', x.actual_pieces, 'max_bundle_kg', x.max_bundle_kg, 'actual_kg', x.actual_kg, 'spec_revision', x.spec_revision,
          'note', x.note, 'noted_by', private.ap4_user_name(x.noted_by), 'created_at', x.created_at) "row", x.created_at, count(*) over () total
      from public.packing_deviations x join public.prepared_physical_bundles b2 on b2.id = x.bundle_id join public.orders oo on oo.id = x.order_id
      where x.company_id = c.company_id and (v_id is null or x.order_id = v_id) and (not coalesce((p_payload ->> 'open_only')::boolean, false) or x.note is null)
      order by x.created_at desc limit 10 offset (v_page - 1) * 10) z;
    return jsonb_build_object('page', v_page, 'total_count', coalesce(v_total, 0), 'rows', v_rows);
  elsif p_command = 'deviation_note' then
    perform private.ap4_need(c.role, private.ap4_dispatch_roles() || array['production_manager', 'production', 'quality']);
    perform private.ap_keys(p_payload, array['id', 'note']);
    update public.packing_deviations set note = private.ap_text(p_payload ->> 'note', 'Note', 5, 300), noted_by = c.actor_id, noted_at = clock_timestamp()
      where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id returning id into v_id;
    if v_id is null then raise exception 'AP: Deviation not found.'; end if;
    return jsonb_build_object('id', v_id);
  elsif p_command = 'pack_report' then
    perform private.ap_keys(p_payload, array['page', 'days']);
    v_days := coalesce(private.ap4_num(p_payload, 'days', 'Days', 1, 90, false), 30)::integer;
    select coalesce(jsonb_agg(z.row order by z.last_at desc), '[]'::jsonb), max(z.total) into v_rows, v_total from (
      with ord as (select x.order_id, count(*) bundles, sum(x.number_of_pieces) pcs, sum(x.net_length_m) metres, sum(x.gross_weight_kg - x.tare_weight_kg) kg, max(x.recorded_at) last_at
        from public.prepared_physical_bundles x where x.company_id = c.company_id and x.recorded_at > now() - make_interval(days => v_days) group by x.order_id)
      select jsonb_build_object('order_id', ord.order_id, 'order_number', oo.order_number, 'customer', private.ap3_customer_name(oo.customer_id), 'bundles', ord.bundles, 'pieces', ord.pcs,
          'metres', round(ord.metres, 3), 'kg', round(ord.kg, 3),
          'spec_revision', (private.ap4_pack_spec(c.company_id, oo.customer_id)).revision,
          'standard', private.ap4_pack_materials(c.company_id, private.ap4_pack_spec(c.company_id, oo.customer_id), ord.pcs, ord.metres, ord.kg, ord.bundles),
          'issued', coalesce((select jsonb_agg(jsonb_build_object('material_id', mm.material_id, 'code', pm.material_code, 'name', pm.material_name, 'unit', pm.unit, 'quantity', round(mm.qty, 3)) order by pm.material_code)
            from (select mv.material_id, sum(case when mv.movement_type = 'issue' then mv.quantity else -mv.quantity end) qty from public.packaging_material_movements mv
              join public.packaging_jobs pj on pj.id = mv.packaging_job_id where mv.company_id = c.company_id and pj.order_id = ord.order_id group by mv.material_id) mm
            join public.packaging_materials pm on pm.id = mm.material_id), '[]'::jsonb)) "row", ord.last_at, count(*) over () total
      from ord join public.orders oo on oo.id = ord.order_id order by ord.last_at desc limit 10 offset (v_page - 1) * 10) z;
    return jsonb_build_object('page', v_page, 'total_count', coalesce(v_total, 0), 'rows', v_rows, 'days', v_days);

  -- Settings -----------------------------------------------------------------------------------------------------
  elsif p_command = 'settings' then
    perform private.ap_keys(p_payload, array[]::text[]);
    v_set := private.ap4_settings(c.company_id);
    return to_jsonb(v_set) || jsonb_build_object('can_edit', c.role = any(array['owner', 'admin', 'dispatch_manager', 'accounts']));
  elsif p_command = 'save_settings' then
    perform private.ap4_need(c.role, array['owner', 'admin', 'dispatch_manager', 'accounts']);
    perform private.ap_keys(p_payload, array['eway_threshold', 'eway_gate_policy', 'status_link_days']);
    v_set := private.ap4_settings(c.company_id);
    if coalesce(p_payload ->> 'eway_gate_policy', v_set.eway_gate_policy) not in ('warn', 'block') then raise exception 'AP: Choose warn or block.'; end if;
    insert into public.dispatch_autopilot_settings(company_id, eway_threshold, eway_gate_policy, status_link_days, updated_by)
      values (c.company_id, coalesce(private.ap4_num(p_payload, 'eway_threshold', 'E-way bill threshold', 0, 100000000, false), v_set.eway_threshold),
        coalesce(p_payload ->> 'eway_gate_policy', v_set.eway_gate_policy), coalesce(private.ap4_num(p_payload, 'status_link_days', 'Link validity', 1, 90, false)::integer, v_set.status_link_days), c.actor_id)
      on conflict (company_id) do update set eway_threshold = excluded.eway_threshold, eway_gate_policy = excluded.eway_gate_policy, status_link_days = excluded.status_link_days,
        updated_by = excluded.updated_by, updated_at = clock_timestamp();
    return to_jsonb(private.ap4_settings(c.company_id));
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_dispatch(text, jsonb) from public, anon;
grant execute on function public.ap_dispatch(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Client entry point: freight (AP-036).
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.ap_freight(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_page integer := private.ap3_page(p_payload); v_total bigint; v_rows jsonb; v_id uuid; rc public.transporter_rate_cards%rowtype; v_basis text; v_state text;
  v_kind text; f public.freight_decisions%rowtype; v_billed numeric; v_days integer; t record; v_weight numeric;
begin
  select * into c from private.ap_ctx(private.ap4_freight_roles());
  if p_command = 'cards' then
    perform private.ap_keys(p_payload, array['transporter_id', 'state', 'status', 'page']);
    v_state := nullif(p_payload ->> 'state', '');
    if v_state is not null and v_state !~ '^[0-9]{2}$' then raise exception 'AP: Choose a state.'; end if;
    select coalesce(jsonb_agg(z.row order by z.k), '[]'::jsonb), max(z.total) into v_rows, v_total from (
      select jsonb_build_object('id', r.id, 'transporter_id', r.transporter_id, 'transporter', v.vendor_name, 'basis', r.basis, 'vehicle_type', r.vehicle_type, 'capacity_kg', r.vehicle_capacity_kg,
          'state', r.destination_state, 'state_label', private.ap_gst_state(r.destination_state), 'city', r.destination_city, 'rate', r.rate, 'min_charge', r.min_charge,
          'effective_from', r.effective_from, 'effective_to', r.effective_to, 'status', r.status, 'note', r.note, 'retire_reason', r.retire_reason,
          'created_by', private.ap4_user_name(r.created_by), 'created_at', r.created_at) "row",
        row_number() over (order by r.status, v.vendor_name, r.destination_state, r.destination_city nulls first, r.basis, r.vehicle_type, r.effective_from desc) k, count(*) over () total
      from public.transporter_rate_cards r join public.vendors v on v.id = r.transporter_id
      where r.company_id = c.company_id and (nullif(p_payload ->> 'transporter_id', '') is null or r.transporter_id = private.ap_uuid(p_payload, 'transporter_id'))
        and (v_state is null or r.destination_state = v_state) and (coalesce(nullif(p_payload ->> 'status', ''), 'active') = 'all' or r.status = coalesce(nullif(p_payload ->> 'status', ''), 'active'))
      order by k limit 10 offset (v_page - 1) * 10) z;
    return jsonb_build_object('page', v_page, 'total_count', coalesce(v_total, 0), 'rows', v_rows, 'can_edit', c.role = any(private.ap4_card_roles()));
  elsif p_command = 'save_card' then
    perform private.ap4_need(c.role, private.ap4_card_roles());
    perform private.ap_keys(p_payload, array['transporter_id', 'basis', 'vehicle_type', 'vehicle_capacity_kg', 'destination_state', 'destination_city', 'rate', 'min_charge', 'effective_from', 'effective_to', 'note']);
    v_id := private.ap_uuid(p_payload, 'transporter_id');
    if not exists (select 1 from public.vendors v where v.id = v_id and v.company_id = c.company_id and v.vendor_type = 'transporter' and v.is_active) then raise exception 'AP: Choose an active transporter.'; end if;
    v_basis := p_payload ->> 'basis';
    if v_basis not in ('per_kg', 'per_vehicle') then raise exception 'AP: Choose per kg or per vehicle.'; end if;
    v_state := p_payload ->> 'destination_state';
    if coalesce(v_state, '') !~ '^[0-9]{2}$' or private.ap_gst_state(v_state) is null then raise exception 'AP: Choose the destination state.'; end if;
    insert into public.transporter_rate_cards(company_id, transporter_id, basis, vehicle_type, vehicle_capacity_kg, destination_state, destination_city, rate, min_charge, effective_from, effective_to, note, created_by)
      values (c.company_id, v_id, v_basis, case when v_basis = 'per_vehicle' then private.ap_text(p_payload ->> 'vehicle_type', 'Vehicle type', 2, 40) end,
        case when v_basis = 'per_vehicle' then private.ap4_num(p_payload, 'vehicle_capacity_kg', 'Vehicle capacity', 1, 60000) end, v_state,
        private.ap_text(p_payload ->> 'destination_city', 'City', 2, 60, false), private.ap4_num(p_payload, 'rate', 'Rate', 0.01, 10000000),
        coalesce(private.ap4_num(p_payload, 'min_charge', 'Minimum charge', 0, 10000000, false), 0), private.ap4_day(p_payload, 'effective_from'),
        private.ap4_day(p_payload, 'effective_to', false), private.ap_text(p_payload ->> 'note', 'Note', 2, 300, false), c.actor_id)
      returning * into rc;
    if rc.effective_to is not null and rc.effective_to < rc.effective_from then raise exception 'AP: The card must end on or after it starts.'; end if;
    return jsonb_build_object('id', rc.id);
  elsif p_command = 'retire_card' then
    perform private.ap4_need(c.role, private.ap4_card_roles());
    perform private.ap_keys(p_payload, array['id', 'reason']);
    update public.transporter_rate_cards set status = 'retired', retired_by = c.actor_id, retired_at = clock_timestamp(), retire_reason = private.ap_text(p_payload ->> 'reason', 'Reason', 5, 300)
      where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id and status = 'active' returning id into v_id;
    if v_id is null then raise exception 'AP: Only an active rate card can be retired.'; end if;
    return jsonb_build_object('id', v_id);
  elsif p_command = 'transporters' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.vendor_name, 'gstin', v.gst_number, 'city', v.city) order by v.vendor_name)
      from public.vendors v where v.company_id = c.company_id and v.vendor_type = 'transporter' and v.is_active), '[]'::jsonb);
  elsif p_command = 'estimate' then
    perform private.ap_keys(p_payload, array['weight_kg', 'state', 'city']);
    v_weight := private.ap4_num(p_payload, 'weight_kg', 'Weight', 1, 1000000);
    v_state := p_payload ->> 'state';
    if coalesce(v_state, '') !~ '^[0-9]{2}$' then raise exception 'AP: Choose the destination state.'; end if;
    return jsonb_build_object('options', private.ap4_freight_options(c.company_id, v_weight, v_state, nullif(btrim(coalesce(p_payload ->> 'city', '')), ''), private.ist_today()));
  elsif p_command in ('propose', 'decision') then
    perform private.ap_keys(p_payload, array['target_kind', 'target_id']);
    v_kind := p_payload ->> 'target_kind';
    if v_kind not in ('quote', 'loading', 'dispatch') then raise exception 'AP: Invalid request.'; end if;
    v_id := private.ap_uuid(p_payload, 'target_id');
    if p_command = 'propose' then return private.ap4_freight_propose(c.company_id, v_kind, v_id); end if;
    select * into t from private.ap4_freight_target(c.company_id, v_kind, v_id);
    if t.customer_id is null then raise exception 'AP: Record not found.'; end if;
    select * into f from public.freight_decisions x where x.company_id = c.company_id and x.target_kind = v_kind and x.target_id = v_id and x.status = 'current';
    return jsonb_build_object('target', jsonb_build_object('weight_kg', t.weight_kg, 'state', t.state, 'state_label', private.ap_gst_state(t.state), 'city', t.city, 'label', t.label),
      'decision', case when f.id is null then null else jsonb_build_object('id', f.id, 'decision', f.decision, 'transporter', f.transporter_name, 'vehicle_type', f.vehicle_type, 'vehicles', f.vehicles,
        'proposed_amount', f.proposed_amount, 'chosen_amount', f.chosen_amount, 'override_reason', f.override_reason, 'decided_by', private.ap4_user_name(f.decided_by), 'decided_at', f.decided_at,
        'billed_amount', f.billed_amount, 'billed_reference', f.billed_reference, 'billed_source', f.billed_source, 'weight_kg', f.weight_kg) end,
      'proposal_id', (select p.id from public.proposals p where p.company_id = c.company_id and p.proposal_type = 'freight.estimate' and p.target_key = v_kind || ':' || v_id::text and p.status = 'open'),
      'can_record_billed', c.role = any(private.ap3_accounts_roles()));
  elsif p_command in ('record_billed', 'refresh_billed') then
    perform private.ap4_need(c.role, private.ap3_accounts_roles());
    perform private.ap_keys(p_payload, array['decision_id', 'amount', 'reference']);
    select * into f from public.freight_decisions where id = private.ap_uuid(p_payload, 'decision_id') and company_id = c.company_id for update;
    if f.id is null then raise exception 'AP: Freight decision not found.'; end if;
    if p_command = 'refresh_billed' then
      v_billed := private.ap4_freight_billed(c.company_id, f);
      if v_billed is null then return jsonb_build_object('state', 'none', 'message', 'No approved transporter expense is recorded against this dispatch yet.'); end if;
      update public.freight_decisions set billed_amount = v_billed, billed_source = 'expense', billed_reference = null, billed_by = c.actor_id, billed_at = clock_timestamp() where id = f.id;
    else
      update public.freight_decisions set billed_amount = private.ap4_num(p_payload, 'amount', 'Billed amount', 0, 10000000), billed_source = 'entered',
        billed_reference = private.ap_text(p_payload ->> 'reference', 'Bill reference', 1, 80), billed_by = c.actor_id, billed_at = clock_timestamp() where id = f.id;
    end if;
    return jsonb_build_object('state', 'recorded', 'id', f.id);
  elsif p_command = 'variance' then
    perform private.ap_keys(p_payload, array['days', 'page']);
    v_days := coalesce(private.ap4_num(p_payload, 'days', 'Days', 7, 366, false), 90)::integer;
    select coalesce(jsonb_agg(z.row order by z.n desc), '[]'::jsonb), max(z.total) into v_rows, v_total from (
      select jsonb_build_object('transporter_id', x.transporter_id, 'transporter', max(x.transporter_name), 'decisions', count(*), 'billed', count(*) filter (where x.billed_amount is not null),
          'overridden', count(*) filter (where x.decision = 'overridden'), 'estimated', round(sum(x.proposed_amount) filter (where x.billed_amount is not null), 2),
          'chosen', round(sum(x.chosen_amount) filter (where x.billed_amount is not null), 2), 'billed_total', round(sum(x.billed_amount), 2),
          'variance', round(sum(x.billed_amount - x.chosen_amount) filter (where x.billed_amount is not null), 2),
          'variance_percent', case when sum(x.chosen_amount) filter (where x.billed_amount is not null) > 0 then
            round(100 * sum(x.billed_amount - x.chosen_amount) filter (where x.billed_amount is not null) / sum(x.chosen_amount) filter (where x.billed_amount is not null), 1) end) "row",
        count(*) n, count(*) over () total
      from public.freight_decisions x where x.company_id = c.company_id and x.status = 'current' and x.decided_at > now() - make_interval(days => v_days)
      group by x.transporter_id order by count(*) desc limit 10 offset (v_page - 1) * 10) z;
    return jsonb_build_object('page', v_page, 'total_count', coalesce(v_total, 0), 'rows', v_rows, 'days', v_days,
      'unbilled', (select count(*) from public.freight_decisions x where x.company_id = c.company_id and x.status = 'current' and x.target_kind = 'dispatch' and x.billed_amount is null
        and x.decided_at > now() - make_interval(days => v_days)));
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_freight(text, jsonb) from public, anon;
grant execute on function public.ap_freight(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Client entry point: e-way bills (AP-081).
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.ap_eway(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_page integer := private.ap3_page(p_payload); v_total bigint; v_rows jsonb; v_search text; v_ids uuid[]; v_id uuid; d public.dispatches%rowtype; e record; v_n integer := 0;
  v_results jsonb := '[]'::jsonb; v_ewb text; v_doc text; it public.eway_export_items%rowtype; v_pin text; s public.dispatch_autopilot_settings%rowtype; v_gstin text;
begin
  select * into c from private.ap_ctx(private.ap4_eway_roles());
  v_search := lower(nullif(btrim(coalesce(p_payload ->> 'search', '')), ''));
  if length(coalesce(v_search, '')) > 60 then raise exception 'AP: Shorten the search.'; end if;
  if p_command = 'queue' then
    perform private.ap_keys(p_payload, array['search', 'page', 'show']);
    s := private.ap4_settings(c.company_id);
    select coalesce(jsonb_agg(z.row order by z.at desc), '[]'::jsonb), max(z.total) into v_rows, v_total from (
      select jsonb_build_object('dispatch_id', x.id, 'dispatch_number', x.dispatch_number, 'dispatch_date', x.dispatch_date, 'order_number', oo.order_number,
          'customer', private.ap3_customer_name(oo.customer_id), 'vehicle_number', x.vehicle_number, 'eway_bill_number', x.eway_bill_number, 'value', private.ap4_consignment_value(c.company_id, x.id),
          'required', coalesce(private.ap4_consignment_value(c.company_id, x.id) > s.eway_threshold, true),
          'invoice_number', (select i.invoice_number from public.invoices i where i.company_id = c.company_id and i.dispatch_id = x.id and i.deleted_at is null and i.status not in ('draft', 'cancelled') limit 1),
          'distance_km', coalesce((select inp.distance_km from public.dispatch_eway_inputs inp where inp.dispatch_id = x.id),
            (select m.distance_km from public.eway_distance_memory m join public.customers cu on cu.id = oo.customer_id where m.company_id = c.company_id and m.to_pincode = btrim(coalesce(cu.pincode, '')))),
          'distance_saved', exists (select 1 from public.dispatch_eway_inputs inp where inp.dispatch_id = x.id),
          'last_export', (select max(ex.generated_at) from public.eway_export_items it2 join public.eway_exports ex on ex.id = it2.export_id where it2.dispatch_id = x.id and it2.company_id = c.company_id),
          'gate_out', exists (select 1 from public.dispatch_gate_exits g where g.dispatch_id = x.id)) "row", x.actual_dispatched_at at, count(*) over () total
      from public.dispatches x join public.orders oo on oo.id = x.order_id
      where x.company_id = c.company_id and x.actual_dispatched_at is not null and x.actual_dispatched_at > now() - interval '30 days'
        and (coalesce(p_payload ->> 'show', 'missing') = 'all' or nullif(btrim(coalesce(x.eway_bill_number, '')), '') is null)
        and (v_search is null or position(v_search in lower(coalesce(x.dispatch_number, '') || ' ' || oo.order_number || ' ' || coalesce(x.vehicle_number, '') || ' ' || coalesce(private.ap3_customer_name(oo.customer_id), ''))) > 0)
      order by x.actual_dispatched_at desc limit 10 offset (v_page - 1) * 10) z;
    return jsonb_build_object('page', v_page, 'total_count', coalesce(v_total, 0), 'rows', v_rows, 'threshold', s.eway_threshold);
  elsif p_command = 'sources' then
    perform private.ap_keys(p_payload, array['dispatch_ids']);
    v_ids := array(select distinct jsonb_array_elements_text(coalesce(p_payload -> 'dispatch_ids', '[]'::jsonb))::uuid);
    if cardinality(v_ids) < 1 or cardinality(v_ids) > 50 then raise exception 'AP: Choose 1 to 50 dispatches.'; end if;
    if exists (select 1 from unnest(v_ids) u where not exists (select 1 from public.dispatches x where x.id = u and x.company_id = c.company_id)) then raise exception 'AP: Dispatch not found.'; end if;
    return coalesce((select jsonb_agg(private.ap4_eway_source(c.company_id, u)) from unnest(v_ids) u), '[]'::jsonb);
  elsif p_command = 'save_inputs' then
    perform private.ap_keys(p_payload, array['dispatch_id', 'distance_km', 'transport_mode', 'vehicle_type', 'transporter_gstin']);
    select * into d from public.dispatches where id = private.ap_uuid(p_payload, 'dispatch_id') and company_id = c.company_id;
    if d.id is null then raise exception 'AP: Dispatch not found.'; end if;
    if coalesce(p_payload ->> 'transport_mode', 'road') not in ('road', 'rail', 'air', 'ship') or coalesce(p_payload ->> 'vehicle_type', 'regular') not in ('regular', 'over_dimensional') then
      raise exception 'AP: Choose the transport mode and vehicle type.';
    end if;
    v_gstin := upper(nullif(btrim(coalesce(p_payload ->> 'transporter_gstin', '')), ''));
    if v_gstin is not null and v_gstin !~ '^[0-9A-Z]{15}$' then raise exception 'AP: The transporter ID is a 15-character GSTIN or enrolment number.'; end if;
    insert into public.dispatch_eway_inputs(dispatch_id, company_id, distance_km, transport_mode, vehicle_type, transporter_gstin, updated_by)
      values (d.id, c.company_id, private.ap4_num(p_payload, 'distance_km', 'Distance', 0, 4000)::integer, coalesce(p_payload ->> 'transport_mode', 'road'),
        coalesce(p_payload ->> 'vehicle_type', 'regular'), v_gstin, c.actor_id)
      on conflict (dispatch_id) do update set distance_km = excluded.distance_km, transport_mode = excluded.transport_mode, vehicle_type = excluded.vehicle_type,
        transporter_gstin = excluded.transporter_gstin, updated_by = excluded.updated_by, updated_at = clock_timestamp();
    -- Remember the distance to this PIN code for the next dispatch there.
    select btrim(coalesce(cu.pincode, '')) into v_pin from public.orders oo join public.customers cu on cu.id = oo.customer_id where oo.id = d.order_id;
    if v_pin ~ '^[1-9][0-9]{5}$' then
      insert into public.eway_distance_memory(company_id, to_pincode, distance_km) values (c.company_id, v_pin, (p_payload ->> 'distance_km')::numeric::integer)
        on conflict (company_id, to_pincode) do update set distance_km = excluded.distance_km, updated_at = clock_timestamp();
    end if;
    return private.ap4_eway_source(c.company_id, d.id);
  elsif p_command = 'record_export' then
    perform private.ap_keys(p_payload, array['schema_version', 'file_sha256', 'docs']);
    if coalesce(p_payload ->> 'file_sha256', '') !~ '^[0-9a-f]{64}$' then raise exception 'AP: Invalid file fingerprint.'; end if;
    if jsonb_typeof(p_payload -> 'docs') <> 'array' or jsonb_array_length(p_payload -> 'docs') not between 1 and 50 then raise exception 'AP: Choose 1 to 50 dispatches.'; end if;
    insert into public.eway_exports(company_id, schema_version, file_sha256, bill_count, generated_by)
      values (c.company_id, private.ap_text(p_payload ->> 'schema_version', 'Schema version', 3, 60), p_payload ->> 'file_sha256', jsonb_array_length(p_payload -> 'docs'), c.actor_id) returning id into v_id;
    for e in select * from jsonb_to_recordset(p_payload -> 'docs') as x(dispatch_id uuid, doc_no text, doc_date date, total_value numeric) loop
      select * into d from public.dispatches where id = e.dispatch_id and company_id = c.company_id;
      if d.id is null or d.actual_dispatched_at is null then raise exception 'AP: Only loaded dispatches can be exported.'; end if;
      if nullif(btrim(coalesce(d.eway_bill_number, '')), '') is not null then raise exception 'AP: Dispatch % already has e-way bill %.', d.dispatch_number, d.eway_bill_number; end if;
      if not exists (select 1 from public.invoices i where i.company_id = c.company_id and i.dispatch_id = d.id and i.deleted_at is null and i.status not in ('draft', 'cancelled')
          and i.invoice_number = e.doc_no) then
        raise exception 'AP: % is not the posted invoice of dispatch %.', coalesce(e.doc_no, '—'), d.dispatch_number;
      end if;
      update public.eway_export_items set status = 'superseded' where company_id = c.company_id and dispatch_id = d.id and status = 'exported';
      insert into public.eway_export_items(company_id, export_id, dispatch_id, doc_no, doc_date, total_value) values (c.company_id, v_id, d.id, e.doc_no, e.doc_date, e.total_value);
    end loop;
    return jsonb_build_object('export_id', v_id);
  elsif p_command = 'record_ewb' then
    perform private.ap_keys(p_payload, array['entries']);
    if jsonb_typeof(p_payload -> 'entries') <> 'array' or jsonb_array_length(p_payload -> 'entries') not between 1 and 200 then raise exception 'AP: Paste 1 to 200 lines.'; end if;
    for e in select * from jsonb_to_recordset(p_payload -> 'entries') as x(doc text, ewb text) loop
      v_doc := upper(btrim(coalesce(e.doc, ''))); v_ewb := regexp_replace(coalesce(e.ewb, ''), '\s', '', 'g');
      if v_ewb !~ '^[0-9]{12}$' then v_results := v_results || jsonb_build_array(jsonb_build_object('doc', v_doc, 'state', 'invalid', 'message', 'An e-way bill number has 12 digits.')); continue; end if;
      select * into it from public.eway_export_items x where x.company_id = c.company_id and upper(x.doc_no) = v_doc order by (x.status = 'exported') desc, x.id desc limit 1;
      if it.id is null then
        select x.* into it from public.eway_export_items x join public.dispatches dd on dd.id = x.dispatch_id where x.company_id = c.company_id and upper(dd.dispatch_number) = v_doc
          order by (x.status = 'exported') desc, x.id desc limit 1;
      end if;
      if it.id is null then v_results := v_results || jsonb_build_array(jsonb_build_object('doc', v_doc, 'state', 'unknown', 'message', 'No exported e-way bill has this document number.')); continue; end if;
      select * into d from public.dispatches where id = it.dispatch_id for update;
      if nullif(btrim(coalesce(d.eway_bill_number, '')), '') = v_ewb then
        v_results := v_results || jsonb_build_array(jsonb_build_object('doc', v_doc, 'state', 'same', 'dispatch_number', d.dispatch_number)); continue;
      elsif nullif(btrim(coalesce(d.eway_bill_number, '')), '') is not null then
        v_results := v_results || jsonb_build_array(jsonb_build_object('doc', v_doc, 'state', 'conflict', 'dispatch_number', d.dispatch_number,
          'message', 'Dispatch already has e-way bill ' || d.eway_bill_number || '; record an amendment to change it.')); continue;
      end if;
      update public.dispatches set eway_bill_number = v_ewb, updated_at = now() where id = d.id;
      update public.eway_export_items set status = 'ewb_recorded', ewb_number = v_ewb, ewb_recorded_by = c.actor_id, ewb_recorded_at = clock_timestamp() where id = it.id;
      v_n := v_n + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object('doc', v_doc, 'state', 'recorded', 'dispatch_number', d.dispatch_number, 'ewb', v_ewb));
    end loop;
    return jsonb_build_object('recorded', v_n, 'results', v_results);
  elsif p_command = 'exports' then
    perform private.ap_keys(p_payload, array['page']);
    select coalesce(jsonb_agg(z.row order by z.at desc), '[]'::jsonb), max(z.total) into v_rows, v_total from (
      select jsonb_build_object('id', x.id, 'schema_version', x.schema_version, 'bill_count', x.bill_count, 'generated_at', x.generated_at, 'generated_by', private.ap4_user_name(x.generated_by),
          'recorded', (select count(*) from public.eway_export_items it2 where it2.export_id = x.id and it2.status = 'ewb_recorded'),
          'docs', (select jsonb_agg(jsonb_build_object('doc_no', it2.doc_no, 'status', it2.status, 'ewb', it2.ewb_number) order by it2.doc_no) from public.eway_export_items it2 where it2.export_id = x.id)) "row",
        x.generated_at at, count(*) over () total
      from public.eway_exports x where x.company_id = c.company_id order by x.generated_at desc limit 10 offset (v_page - 1) * 10) z;
    return jsonb_build_object('page', v_page, 'total_count', coalesce(v_total, 0), 'rows', v_rows);
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_eway(text, jsonb) from public, anon;
grant execute on function public.ap_eway(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Client entry point: Tally export (AP-083).
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.ap_tally(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_page integer := private.ap3_page(p_payload); v_total bigint; v_rows jsonb; v_from date; v_to date; v_kind text; v_id uuid; v_rate numeric; v_supply text; e record;
  v_kinds text[]; v_n integer := 0; v_reason text; tv public.tally_export_vouchers%rowtype;
begin
  select * into c from private.ap_ctx(private.ap3_accounts_roles());
  if p_command in ('pending', 'vouchers_data', 'record_export') then
    v_from := private.ap4_day(p_payload, 'from'); v_to := private.ap4_day(p_payload, 'to');
    if v_to < v_from or v_to - v_from > 31 then raise exception 'AP: Choose a range of at most 31 days.'; end if;
    v_kinds := coalesce(array(select jsonb_array_elements_text(coalesce(p_payload -> 'kinds', '[]'::jsonb))), '{}');
    if cardinality(v_kinds) = 0 then v_kinds := array['sales', 'receipt', 'on_account', 'purchase', 'credit_note']; end if;
    if exists (select 1 from unnest(v_kinds) k where k not in ('sales', 'receipt', 'on_account', 'purchase', 'credit_note')) then raise exception 'AP: Invalid voucher type.'; end if;
  end if;
  if p_command = 'mappings' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return jsonb_build_object('rows', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'entity_id', m.entity_id, 'gst_rate', m.gst_rate, 'supply', m.supply,
        'ledger_name', m.ledger_name, 'entity', case m.kind when 'customer' then private.ap3_customer_name(m.entity_id) when 'vendor' then (select v.vendor_name from public.vendors v where v.id = m.entity_id) end,
        'updated_at', m.updated_at, 'updated_by', private.ap4_user_name(m.updated_by)) order by m.kind, m.gst_rate nulls first, m.supply nulls first)
      from public.tally_ledger_map m where m.company_id = c.company_id), '[]'::jsonb));
  elsif p_command = 'save_mapping' then
    perform private.ap_keys(p_payload, array['kind', 'entity_id', 'gst_rate', 'supply', 'ledger_name']);
    v_kind := p_payload ->> 'kind';
    if v_kind not in ('customer', 'vendor', 'sales', 'purchase', 'output_cgst', 'output_sgst', 'output_igst', 'input_cgst', 'input_sgst', 'input_igst', 'round_off', 'bank', 'cash', 'freight_inward', 'discount_received') then
      raise exception 'AP: Choose a ledger type.';
    end if;
    v_id := private.ap_uuid(p_payload, 'entity_id', v_kind in ('customer', 'vendor'));
    if v_kind = 'customer' and not exists (select 1 from public.customers x where x.id = v_id and x.company_id = c.company_id) then raise exception 'AP: Customer not found.'; end if;
    if v_kind = 'vendor' and not exists (select 1 from public.vendors x where x.id = v_id and x.company_id = c.company_id) then raise exception 'AP: Supplier not found.'; end if;
    if v_kind not in ('customer', 'vendor') then v_id := null; end if;
    v_rate := case when v_kind in ('sales', 'purchase') then private.ap4_num(p_payload, 'gst_rate', 'GST rate', 0, 28, false) end;
    v_supply := case when v_kind in ('sales', 'purchase') then nullif(p_payload ->> 'supply', '') end;
    if v_supply is not null and v_supply not in ('local', 'interstate') then raise exception 'AP: Choose local or interstate.'; end if;
    if coalesce(p_payload ->> 'ledger_name', '') ~ '[<>&]' then raise exception 'AP: Ledger names cannot contain < > or &.'; end if;
    delete from public.tally_ledger_map m where m.company_id = c.company_id and m.kind = v_kind and m.entity_id is not distinct from v_id and m.gst_rate is not distinct from v_rate and m.supply is not distinct from v_supply;
    insert into public.tally_ledger_map(company_id, kind, entity_id, gst_rate, supply, ledger_name, updated_by)
      values (c.company_id, v_kind, v_id, v_rate, v_supply, private.ap_text(p_payload ->> 'ledger_name', 'Ledger name', 1, 100), c.actor_id) returning id into v_id;
    return jsonb_build_object('id', v_id);
  elsif p_command = 'remove_mapping' then
    perform private.ap_keys(p_payload, array['id']);
    delete from public.tally_ledger_map where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id returning id into v_id;
    if v_id is null then raise exception 'AP: Mapping not found.'; end if;
    return jsonb_build_object('id', v_id);
  elsif p_command = 'pending' then
    perform private.ap_keys(p_payload, array['from', 'to', 'kinds', 'page', 'show']);
    select coalesce(jsonb_agg(z.row order by z.d, z.k, z.num), '[]'::jsonb), max(z.total) into v_rows, v_total from (
      select jsonb_build_object('kind', x.kind, 'id', x.id, 'number', x.number, 'date', x.voucher_date, 'amount', x.amount, 'party', x.party_name,
          'exported_at', (select b.generated_at from public.tally_export_vouchers ev join public.tally_export_batches b on b.id = ev.batch_id
            where ev.company_id = c.company_id and ev.voucher_kind = x.kind and ev.voucher_id = x.id and ev.status = 'exported')) "row",
        x.voucher_date d, x.kind k, x.number num, count(*) over () total
      from private.ap4_tally_vouchers(c.company_id, v_from, v_to) x where x.kind = any(v_kinds)
        and (coalesce(p_payload ->> 'show', 'pending') = 'all' or not exists (select 1 from public.tally_export_vouchers ev where ev.company_id = c.company_id and ev.voucher_kind = x.kind and ev.voucher_id = x.id and ev.status = 'exported'))
      order by x.voucher_date, x.kind, x.number limit 10 offset (v_page - 1) * 10) z;
    return jsonb_build_object('page', v_page, 'total_count', coalesce(v_total, 0), 'rows', v_rows,
      'pending_by_kind', (select jsonb_object_agg(k.kind, k.n) from (select x.kind, count(*) n from private.ap4_tally_vouchers(c.company_id, v_from, v_to) x where x.kind = any(v_kinds)
        and not exists (select 1 from public.tally_export_vouchers ev where ev.company_id = c.company_id and ev.voucher_kind = x.kind and ev.voucher_id = x.id and ev.status = 'exported') group by x.kind) k));
  elsif p_command = 'vouchers_data' then
    perform private.ap_keys(p_payload, array['from', 'to', 'kinds']);
    return jsonb_build_object('company', (select jsonb_build_object('name', coalesce(nullif(btrim(co.legal_name), ''), co.name), 'state_code', co.gst_state_code) from public.companies co where co.id = c.company_id),
      'vouchers', coalesce((select jsonb_agg(jsonb_build_object('kind', x.kind, 'id', x.id, 'number', x.number, 'date', x.voucher_date, 'amount', x.amount, 'party_id', x.party_id, 'party', x.party_name, 'data', x.data)
          order by x.voucher_date, x.kind, x.number)
        from private.ap4_tally_vouchers(c.company_id, v_from, v_to) x where x.kind = any(v_kinds)
          and not exists (select 1 from public.tally_export_vouchers ev where ev.company_id = c.company_id and ev.voucher_kind = x.kind and ev.voucher_id = x.id and ev.status = 'exported')), '[]'::jsonb),
      'mappings', coalesce((select jsonb_agg(jsonb_build_object('kind', m.kind, 'entity_id', m.entity_id, 'gst_rate', m.gst_rate, 'supply', m.supply, 'ledger_name', m.ledger_name))
        from public.tally_ledger_map m where m.company_id = c.company_id), '[]'::jsonb));
  elsif p_command = 'record_export' then
    perform private.ap_keys(p_payload, array['from', 'to', 'kinds', 'file_sha256', 'vouchers']);
    if coalesce(p_payload ->> 'file_sha256', '') !~ '^[0-9a-f]{64}$' then raise exception 'AP: Invalid file fingerprint.'; end if;
    if jsonb_typeof(p_payload -> 'vouchers') <> 'array' or jsonb_array_length(p_payload -> 'vouchers') not between 1 and 2000 then raise exception 'AP: Nothing to export.'; end if;
    perform pg_advisory_xact_lock(hashtextextended(c.company_id::text || ':tally-export', 0));
    insert into public.tally_export_batches(company_id, from_date, to_date, voucher_count, file_sha256, generated_by)
      values (c.company_id, v_from, v_to, jsonb_array_length(p_payload -> 'vouchers'), p_payload ->> 'file_sha256', c.actor_id) returning id into v_id;
    for e in select v.kind, v.id, x.number, x.voucher_date, x.amount, (select count(*) from public.tally_export_vouchers h where h.company_id = c.company_id and h.voucher_kind = v.kind and h.voucher_id = v.id) prior
        from jsonb_to_recordset(p_payload -> 'vouchers') as v(kind text, id uuid)
        left join private.ap4_tally_vouchers(c.company_id, v_from, v_to) x on x.kind = v.kind and x.id = v.id loop
      if e.number is null then raise exception 'AP: A voucher in the file is not a posted voucher of this period. Reload and export again.'; end if;
      begin
        insert into public.tally_export_vouchers(company_id, batch_id, voucher_kind, voucher_id, voucher_number, voucher_date, amount, re_export)
          values (c.company_id, v_id, e.kind, e.id, e.number, e.voucher_date, e.amount, e.prior > 0);
      exception when unique_violation then
        raise exception 'AP: Voucher % was already exported. Use re-export with a reason to send it again.', e.number;
      end;
      v_n := v_n + 1;
    end loop;
    return jsonb_build_object('batch_id', v_id, 'vouchers', v_n);
  elsif p_command = 're_export' then
    perform private.ap_keys(p_payload, array['kind', 'voucher_id', 'reason']);
    v_reason := private.ap_text(p_payload ->> 'reason', 'Reason', 10, 300);
    update public.tally_export_vouchers set status = 'superseded', superseded_at = clock_timestamp(), superseded_by = c.actor_id, supersede_reason = v_reason
      where company_id = c.company_id and voucher_kind = p_payload ->> 'kind' and voucher_id = private.ap_uuid(p_payload, 'voucher_id') and status = 'exported' returning * into tv;
    if tv.id is null then raise exception 'AP: That voucher has not been exported.'; end if;
    return jsonb_build_object('state', 'pending_again', 'voucher_number', tv.voucher_number);
  elsif p_command = 'batches' then
    perform private.ap_keys(p_payload, array['page']);
    select coalesce(jsonb_agg(z.row order by z.at desc), '[]'::jsonb), max(z.total) into v_rows, v_total from (
      select jsonb_build_object('id', b.id, 'from', b.from_date, 'to', b.to_date, 'vouchers', b.voucher_count, 'generated_at', b.generated_at, 'generated_by', private.ap4_user_name(b.generated_by),
          're_exports', (select count(*) from public.tally_export_vouchers ev where ev.batch_id = b.id and ev.re_export),
          'superseded', (select count(*) from public.tally_export_vouchers ev where ev.batch_id = b.id and ev.status = 'superseded')) "row", b.generated_at at, count(*) over () total
      from public.tally_export_batches b where b.company_id = c.company_id order by b.generated_at desc limit 10 offset (v_page - 1) * 10) z;
    return jsonb_build_object('page', v_page, 'total_count', coalesce(v_total, 0), 'rows', v_rows);
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_tally(text, jsonb) from public, anon;
grant execute on function public.ap_tally(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Client entry point: status links and summaries (AP-060, AP-089).
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.ap_share(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; o public.orders%rowtype; v_days integer; v_token text; v_id uuid; l public.order_status_links%rowtype; v_kind text;
begin
  select * into c from private.ap_ctx(null);
  if p_command = 'summary' then
    perform private.ap_keys(p_payload, array['kind', 'id', 'audience']);
    v_kind := p_payload ->> 'kind';
    if coalesce(p_payload ->> 'audience', '') not in ('customer', 'internal') then raise exception 'AP: Choose the customer or internal version.'; end if;
    return private.ap4_summary(c, v_kind, private.ap_uuid(p_payload, 'id'), p_payload ->> 'audience' = 'internal');
  end if;
  perform private.ap4_need(c.role, private.ap4_share_roles());
  if p_command = 'create_link' then
    perform private.ap_keys(p_payload, array['order_id', 'days']);
    select * into o from public.orders where id = private.ap_uuid(p_payload, 'order_id') and company_id = c.company_id and deleted_at is null;
    if o.id is null then raise exception 'AP: Order not found.'; end if;
    if o.current_stage = 'cancelled' then raise exception 'AP: A cancelled order has no status to share.'; end if;
    v_days := coalesce(private.ap4_num(p_payload, 'days', 'Validity', 1, 90, false)::integer, (private.ap4_settings(c.company_id)).status_link_days);
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    insert into public.order_status_links(company_id, order_id, token_hash, token_hint, expires_at, created_by)
      values (c.company_id, o.id, encode(extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex'), right(v_token, 4), now() + make_interval(days => v_days), c.actor_id)
      returning * into l;
    -- The token is returned once and never stored; only its hash is kept.
    return jsonb_build_object('id', l.id, 'token', v_token, 'expires_at', l.expires_at, 'order_number', o.order_number,
      'phone', (select coalesce(nullif(btrim(cu.whatsapp_number), ''), cu.phone) from public.customers cu where cu.id = o.customer_id), 'customer', private.ap3_customer_name(o.customer_id));
  elsif p_command = 'links' then
    perform private.ap_keys(p_payload, array['order_id']);
    return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'hint', x.token_hint, 'expires_at', x.expires_at, 'created_at', x.created_at, 'created_by', private.ap4_user_name(x.created_by),
        'revoked_at', x.revoked_at, 'revoke_reason', x.revoke_reason, 'views', x.view_count, 'last_viewed_at', x.last_viewed_at,
        'state', case when x.revoked_at is not null then 'revoked' when x.expires_at <= now() then 'expired' else 'active' end) order by x.created_at desc)
      from (select * from public.order_status_links y where y.company_id = c.company_id and y.order_id = private.ap_uuid(p_payload, 'order_id') order by y.created_at desc limit 10) x), '[]'::jsonb);
  elsif p_command = 'revoke_link' then
    perform private.ap_keys(p_payload, array['id', 'reason']);
    update public.order_status_links set revoked_at = clock_timestamp(), revoked_by = c.actor_id, revoke_reason = private.ap_text(p_payload ->> 'reason', 'Reason', 5, 300)
      where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id and revoked_at is null returning id into v_id;
    if v_id is null then raise exception 'AP: That link is already revoked or does not exist.'; end if;
    return jsonb_build_object('id', v_id);
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_share(text, jsonb) from public, anon;
grant execute on function public.ap_share(text, jsonb) to authenticated;

commit;

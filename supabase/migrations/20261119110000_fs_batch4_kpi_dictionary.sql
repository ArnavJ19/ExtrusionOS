-- FABLE_SUGGESTIONS FS-77 (KPI dictionary) and FS-132 (one KPI path).
--
-- private.kpi_values is the one SQL definition of each management KPI over a business-date period. Command Center
-- reads it through public.fs_kpi; the analytics and dashboard snapshots compute the same figures and
-- tests/fs-batch4-sql.test.mjs requires them to be equal on a fixture. docs/KPI_DICTIONARY.md and
-- lib/insights/metrics.ts describe the same definitions in words.
--
-- Each KPI is {value, numerator, denominator, unit, status, note}. status is
--   measured        - computed from recorded data;
--   not_captured    - the definition applies but the period has no (or incomplete) input data;
--   not_measurable  - the inputs do not exist in the system yet (named in note). Never shown as zero.
-- No targets are stored here: a KPI is a measurement, not a standard.

create or replace function private.kpi_item(p_value numeric, p_numerator numeric, p_denominator numeric, p_unit text, p_status text, p_note text default null)
returns jsonb language sql immutable set search_path = pg_catalog as $$
  select jsonb_build_object('value', case when p_status = 'measured' then p_value end, 'numerator', p_numerator, 'denominator', p_denominator,
    'unit', p_unit, 'status', p_status, 'note', p_note)
$$;
revoke all on function private.kpi_item(numeric, numeric, numeric, text, text, text) from public, anon, authenticated;

create or replace function private.kpi_ratio(p_numerator numeric, p_denominator numeric, p_unit text, p_note_missing text)
returns jsonb language sql immutable set search_path = pg_catalog, private as $$
  select case when coalesce(p_denominator, 0) > 0
    then private.kpi_item(round(p_numerator * 100.0 / p_denominator, 2), p_numerator, p_denominator, p_unit, 'measured')
    else private.kpi_item(null, p_numerator, p_denominator, p_unit, 'not_captured', p_note_missing) end
$$;
revoke all on function private.kpi_ratio(numeric, numeric, text, text) from public, anon, authenticated;

-- Shipments the dictionary counts: activated (not pending), with a recorded movement time and positive net packed kg.
create or replace function private.kpi_shipments(p_company uuid, p_from date, p_to date)
returns table(dispatch_id uuid, movement_date date, expected_dispatch_date date, net_kg numeric)
language sql stable security definer set search_path = public, private as $$
  select d.id, (d.actual_dispatched_at at time zone 'Asia/Kolkata')::date, o.expected_dispatch_date,
    coalesce((select sum(p.net_weight_kg) from public.packing_list_items p where p.company_id = p_company and p.dispatch_id = d.id), 0)
  from public.dispatches d join public.orders o on o.id = d.order_id and o.company_id = d.company_id
  where d.company_id = p_company and o.deleted_at is null and d.delivery_status <> 'pending' and d.actual_dispatched_at is not null
    and (d.actual_dispatched_at at time zone 'Asia/Kolkata')::date between p_from and p_to
    and exists (select 1 from public.packing_list_items p where p.company_id = p_company and p.dispatch_id = d.id and p.net_weight_kg > 0)
$$;
revoke all on function private.kpi_shipments(uuid, date, date) from public, anon, authenticated;

-- Completed jobs in the period with billet input, QC rejection and process scrap per job.
create or replace function private.kpi_completed_jobs(p_company uuid, p_from date, p_to date)
returns table(job_id uuid, die_id uuid, actual_kg numeric, rejected_kg numeric, input_kg numeric, process_scrap_kg numeric)
language sql stable security definer set search_path = public, private as $$
  select j.id, j.die_id, coalesce(j.actual_quantity_kg, 0),
    coalesce((select sum(q.quantity_checked_kg) from public.quality_inspections q
      where q.company_id = p_company and q.production_job_id = j.id and q.status = 'rejected' and q.quantity_checked_kg > 0), 0),
    coalesce((select sum(coalesce(b.measured_weight_kg, b.weight_kg)) from public.foundry_billets b
      where b.company_id = p_company and b.production_job_id = j.id and b.status in ('issued', 'consumed') and coalesce(b.measured_weight_kg, b.weight_kg) > 0), 0),
    coalesce((select sum(s.weight_kg) from public.production_scrap_lines s where s.company_id = p_company and s.production_job_id = j.id), 0)
  from public.production_jobs j
  where j.company_id = p_company and j.status = 'completed' and j.completed_at is not null
    and (j.completed_at at time zone 'Asia/Kolkata')::date between p_from and p_to
$$;
revoke all on function private.kpi_completed_jobs(uuid, date, date) from public, anon, authenticated;

create or replace function private.kpi_values(p_company uuid, p_from date, p_to date, p_finance boolean)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare
  v jsonb := '{}'::jsonb;
  s record; j record; q record; f record; e record; dl record; otif jsonb;
  v_dso_from date := p_to - 89;
begin
  select coalesce(sum(net_kg), 0) shipped, count(*) filter (where expected_dispatch_date is not null) decided,
    count(*) filter (where expected_dispatch_date is not null and movement_date <= expected_dispatch_date) on_time
    into s from private.kpi_shipments(p_company, p_from, p_to);
  v := v || jsonb_build_object(
    'shipped_kg', private.kpi_item(s.shipped, null, null, 'kg', 'measured'),
    'on_time_dispatch', private.kpi_ratio(s.on_time, s.decided, '%', 'No activated shipment in the period had an expected dispatch date.'));

  v := v || jsonb_build_object(
    'production_planned_kg', private.kpi_item((select coalesce(sum(planned_quantity_kg), 0) from public.production_jobs
      where company_id = p_company and planned_date between p_from and p_to and status <> 'cancelled'), null, null, 'kg', 'measured'),
    'production_completed_kg', private.kpi_item((select coalesce(sum(actual_kg), 0) from private.kpi_completed_jobs(p_company, p_from, p_to)), null, null, 'kg', 'measured'));

  -- Recovery (= yield; one measure): good output / billet input, only when every completed job has billet input.
  select count(*) jobs, count(*) filter (where input_kg <= 0 or actual_kg - rejected_kg < 0) missing,
    coalesce(sum(actual_kg - rejected_kg) filter (where input_kg > 0 and actual_kg - rejected_kg >= 0), 0) good,
    coalesce(sum(input_kg) filter (where input_kg > 0 and actual_kg - rejected_kg >= 0), 0) input,
    coalesce(sum(actual_kg), 0) output, coalesce(sum(rejected_kg), 0) rejected,
    coalesce(sum(process_scrap_kg) filter (where input_kg > 0), 0) process_scrap
    into j from private.kpi_completed_jobs(p_company, p_from, p_to);
  v := v || jsonb_build_object(
    'recovery', case when j.jobs = 0 then private.kpi_item(null, 0, 0, '%', 'not_captured', 'No job was completed in the period.')
      when j.missing > 0 then private.kpi_item(null, j.good, j.input, '%', 'not_captured', j.missing || ' completed job(s) have no issued billet input.')
      else private.kpi_ratio(j.good, j.input, '%', 'No billet input recorded.') end || jsonb_build_object('jobs', j.jobs, 'missing_jobs', j.missing),
    'process_scrap_percent', case when j.jobs = 0 or j.input = 0 then private.kpi_item(null, j.process_scrap, j.input, '%', 'not_captured', 'No completed job with billet input in the period.')
      else private.kpi_ratio(j.process_scrap, j.input, '%', null) end,
    'qc_rejected_kg', private.kpi_item(j.rejected, null, null, 'kg', 'measured'),
    'scrap_kg', private.kpi_item((select coalesce(sum(r.weight_kg), 0) from public.scrap_records r
      where r.company_id = p_company and (r.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
        and not exists (select 1 from public.scrap_record_reversals x where x.company_id = p_company and x.scrap_record_id = r.id)), null, null, 'kg', 'measured'),
    -- OEE: only the quality part has data today. Availability needs press run and stop capture (FS-15); performance
    -- needs an approved ideal rate per press and profile. Neither is invented here.
    'oee_quality', case when j.output > 0 then private.kpi_ratio(j.output - j.rejected, j.output, '%', null)
      else private.kpi_item(null, 0, 0, '%', 'not_captured', 'No completed output in the period.') end,
    'oee_availability', private.kpi_item(null, null, null, '%', 'not_measurable', 'Needs press run and stop time from the press-side terminal (FS-15).'),
    'oee_performance', private.kpi_item(null, null, null, '%', 'not_measurable', 'Needs an approved ideal output rate per press and profile.'),
    'oee', private.kpi_item(null, null, null, '%', 'not_measurable', 'OEE = availability x performance x quality; availability and performance are not measurable yet.'),
    'conversion_cost_per_tonne', private.kpi_item(null, null, null, 'INR/t', 'not_measurable', 'Needs actual job costing (FS-12).'));

  -- kWh per tonne: electricity readings in the period / completed tonnes.
  select coalesce(sum(consumption), 0) kwh, count(*) n into e from public.energy_readings
    where company_id = p_company and reading_date between p_from and p_to
      and (lower(coalesce(energy_type, '')) in ('electricity', 'electric', 'power') or lower(coalesce(unit, '')) = 'kwh');
  v := v || jsonb_build_object('kwh_per_tonne', case
    when e.n = 0 then private.kpi_item(null, 0, null, 'kWh/t', 'not_captured', 'No electricity reading in the period.')
    when coalesce((v -> 'production_completed_kg' ->> 'value')::numeric, 0) <= 0 then private.kpi_item(null, e.kwh, 0, 'kWh/t', 'not_captured', 'No completed output in the period.')
    else private.kpi_item(round(e.kwh / ((v -> 'production_completed_kg' ->> 'value')::numeric / 1000), 2), e.kwh, (v -> 'production_completed_kg' ->> 'value')::numeric / 1000, 'kWh/t', 'measured') end);

  -- Quote win rate: converted / quotes past internal review, dated in the period.
  select count(*) filter (where status not in ('draft', 'internal_review')) eligible, count(*) filter (where status = 'converted_to_order') converted into q
    from public.quotes where company_id = p_company and deleted_at is null
      and coalesce(quote_date, (created_at at time zone 'Asia/Kolkata')::date) between p_from and p_to;
  v := v || jsonb_build_object('quote_win_rate', private.kpi_ratio(q.converted, q.eligible, '%', 'No quotation past internal review was dated in the period.'));

  -- Die life: median kg produced by the dies retired (status dead); the population is stated.
  select count(*) n, percentile_cont(0.5) within group (order by total_production_kg) median into dl
    from public.dies where company_id = p_company and die_status = 'dead' and coalesce(total_production_kg, 0) > 0;
  v := v || jsonb_build_object('die_life_kg', case when dl.n = 0 then private.kpi_item(null, null, 0, 'kg', 'not_captured', 'No retired die with recorded production yet.')
    else private.kpi_item(round(dl.median::numeric, 0), null, dl.n, 'kg', 'measured', 'Median of ' || dl.n || ' retired die(s).') end);

  otif := private.fs4_otif_summary(p_company, p_from, p_to);
  v := v || jsonb_build_object('otif', case when coalesce((otif ->> 'due')::int, 0) = 0
    then private.kpi_item(null, 0, 0, '%', 'not_captured', 'No order line had its first promise fall due in the period.')
    else private.kpi_ratio((otif ->> 'otif')::numeric, (otif ->> 'due')::numeric, '%', null) end);

  if p_finance then
    select
      (select coalesce(sum(order_value), 0) from public.orders where company_id = p_company and deleted_at is null and current_stage <> 'cancelled' and order_date between p_from and p_to) intake,
      (select coalesce(sum(case when payment_type = 'REFUND' then -amount else amount end), 0) from public.payments
        where company_id = p_company and payment_status = 'PAID' and payment_method <> 'credit_note' and payment_date between p_from and p_to) collected,
      (select coalesce(sum(balance_due), 0) from public.invoices where company_id = p_company and deleted_at is null and status in ('generated', 'sent', 'partially_paid', 'overdue')) receivable,
      (select coalesce(sum(balance_due), 0) from public.invoices where company_id = p_company and deleted_at is null and status in ('generated', 'sent', 'partially_paid', 'overdue') and balance_due > 0 and due_date < p_to) overdue,
      (select coalesce(sum(grand_total), 0) from public.invoices where company_id = p_company and deleted_at is null
        and status in ('generated', 'sent', 'partially_paid', 'paid', 'overdue', 'credited') and invoice_date between v_dso_from and p_to)
        - (select coalesce(sum(grand_total), 0) from public.credit_notes where company_id = p_company and status = 'issued' and credit_date between v_dso_from and p_to) invoiced90
      into f;
    v := v || jsonb_build_object(
      'order_intake', private.kpi_item(f.intake, null, null, 'INR', 'measured'),
      'collections', private.kpi_item(f.collected, null, null, 'INR', 'measured'),
      'receivables_outstanding', private.kpi_item(f.receivable, null, null, 'INR', 'measured'),
      'receivables_overdue', private.kpi_item(f.overdue, null, null, 'INR', 'measured'),
      'dso_days', case when f.invoiced90 > 0 then private.kpi_item(round(f.receivable / (f.invoiced90 / 90.0), 1), f.receivable, round(f.invoiced90 / 90.0, 2), 'days', 'measured', 'Outstanding / average daily net invoicing over the 90 days to ' || p_to || '.')
        else private.kpi_item(null, f.receivable, 0, 'days', 'not_captured', 'Nothing invoiced in the 90 days to ' || p_to || '.') end);
  end if;
  return v || jsonb_build_object('_period', jsonb_build_object('from', p_from, 'to', p_to, 'finance', p_finance));
end;
$$;
revoke all on function private.kpi_values(uuid, date, date, boolean) from public, anon, authenticated;

-- Gateway. values: {from, to} (business dates, at most 366 days, not after today). Finance KPIs for owner/admin/accounts.
create or replace function public.fs_kpi(p_command text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare c record; v_from date; v_to date; v_today date := private.business_today();
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'accounts', 'sales_manager', 'factory_manager', 'production_manager', 'quality', 'dispatch_manager']);
  if p_command <> 'values' then raise exception 'AP: Unknown KPI request.'; end if;
  begin
    v_from := coalesce(nullif(p_payload ->> 'from', '')::date, date_trunc('month', v_today)::date);
    v_to := coalesce(nullif(p_payload ->> 'to', '')::date, v_today);
  exception when others then raise exception 'AP: Use dates as YYYY-MM-DD.';
  end;
  if v_to > v_today then v_to := v_today; end if;
  if v_from > v_to or v_to - v_from > 366 then raise exception 'AP: Choose a period of up to 366 days that ends by today.'; end if;
  return private.kpi_values(c.company_id, v_from, v_to, c.role in ('owner', 'admin', 'accounts'));
end;
$$;
revoke all on function public.fs_kpi(text, jsonb) from public, anon;
grant execute on function public.fs_kpi(text, jsonb) to authenticated;

-- FABLE_SUGGESTIONS Phase 4: FS-73 (thirteen-week cash flow), FS-72 (metal price exposure and back-to-back booking) and
-- FS-71 (sales forecast and order-book analytics).
--
-- FS-73 extends the AP-076 forecast (same items, same accuracy record): up to thirteen weeks, open collection promises
-- (NOV coordination, FS-21) date the promised part of an invoice, and weeks closing below the minimum balance accounts
-- sets are flagged. FS-72 is visibility only: it never trades and gives no hedging advice. FS-71 uses only recorded
-- quotes, orders, invoices and shift capacities; every probability is either measured from history or set by a named
-- person with a reason.
-- Additive. New tables are reached only through security-definer gateways.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------------------------------------------
-- FS-73: thirteen weeks, collection promises and a minimum balance
-- ---------------------------------------------------------------------------------------------------------------
alter table public.cash_forecast_settings add column if not exists minimum_balance numeric(16,2) check (minimum_balance is null or minimum_balance between -1000000000 and 1000000000);
alter table public.cash_forecast_settings add column if not exists minimum_set_by uuid references public.app_users(id);
alter table public.cash_forecast_settings add column if not exists minimum_set_at timestamptz;

create or replace function private.ap9_cash_items(p_company uuid, p_from date, p_weeks integer)
returns table(kind text, direction text, expected_on date, amount numeric, label text, basis text, ref_id uuid)
language sql stable security definer set search_path = public, private as $$
  with horizon as (select p_from + p_weeks * 7 - 1 last_day),
  inv as (
    select i.id, i.customer_id, coalesce(i.due_date, i.invoice_date + 30) due_on,
      round(coalesce(i.balance_due, i.grand_total - i.amount_paid - coalesce(i.credited_amount, 0)), 2) balance,
      coalesce(i.invoice_number, 'Invoice') || ' · ' || coalesce(nullif(btrim(cu.company_name), ''), cu.customer_name) label,
      private.ap9_customer_delay(p_company, i.customer_id) delay,
      pr.due_date promise_on,
      -- The part of the promise not yet received: payments made since the promise was recorded count against it.
      case when pr.amount is not null then greatest(least(pr.amount - greatest(coalesce(i.amount_paid, 0) - coalesce(pr.baseline_paid, 0), 0),
        coalesce(i.balance_due, i.grand_total - i.amount_paid - coalesce(i.credited_amount, 0))), 0) end promised
    from public.invoices i join public.customers cu on cu.id = i.customer_id
    left join lateral (select x.due_date, x.amount, x.baseline_paid from public.collection_promises x
      where x.company_id = p_company and x.invoice_id = i.id and x.withdrawn_at is null order by x.created_at desc, x.id desc limit 1) pr on true
    where i.company_id = p_company and i.deleted_at is null and i.status in ('generated', 'sent', 'partially_paid', 'overdue')
      and coalesce(i.balance_due, i.grand_total - i.amount_paid - coalesce(i.credited_amount, 0)) > 0.005
  ), recv as (
    select 'receivable'::text kind, 'in'::text direction, v.promise_on expected_on, round(v.promised, 2) amount, v.label,
      'Customer promised to pay ' || to_char(v.promise_on, 'DD Mon YYYY') || case when v.promise_on < p_from then ' (promise date passed)' else '' end basis, v.id ref_id
    from inv v where coalesce(v.promised, 0) > 0.005
    union all
    select 'receivable', 'in', v.due_on + v.delay, round(v.balance - coalesce(v.promised, 0), 2), v.label,
      case when v.delay > 0 then 'Due date + ' || v.delay || ' days (this customer''s usual delay)' else 'Due date' end
        || case when coalesce(v.promised, 0) > 0.005 then '; balance beyond the promise' else '' end, v.id
    from inv v where v.balance - coalesce(v.promised, 0) > 0.005
  ), scrap as (
    select 'scrap_sale', 'in', s.invoice_date + 7, round(s.invoice_total - s.amount_received, 2), s.invoice_number || ' · scrap sale', 'Scrap invoice date + 7 days', s.id
    from public.scrap_sales s where s.company_id = p_company and s.status = 'invoiced' and s.invoice_total - s.amount_received > 0.005
  ), pay as (
    select 'payable', 'out', coalesce(e.due_date, e.invoice_date + 30, e.created_at::date + 30), round(e.balance_amount, 2),
      coalesce(e.vendor_name_snapshot, e.expense_category) || coalesce(' · ' || e.invoice_number, ''), case when e.due_date is null then 'Bill date + 30 days' else 'Due date' end, e.id
    from public.expense_ledger e where e.company_id = p_company and e.deleted_at is null and e.balance_amount > 0.005
      and e.approval_status = 'approved' and e.payment_status not in ('paid', 'cancelled', 'reversed')
  ), po as (
    select 'purchase_order', 'out', greatest(p_from, p.order_date + 15 + private.ap9_terms_days(v.payment_terms)),
      round(greatest(sum(l.ordered_quantity * l.unit_rate * (1 + coalesce(l.gst_percent, 0) / 100))
        - coalesce((select sum(b.total_amount) from public.supplier_purchase_bills b where b.company_id = p_company and b.purchase_order_id = p.id and b.status = 'posted'), 0), 0), 2),
      p.po_number || ' · ' || p.vendor_name_snapshot, 'Order date + 15 days delivery + ' || private.ap9_terms_days(v.payment_terms) || ' days credit (not yet billed)', p.id
    from public.purchase_orders p join public.purchase_order_lines l on l.purchase_order_id = p.id and l.company_id = p_company
      left join public.vendors v on v.id = p.vendor_id
    where p.company_id = p_company and p.status = 'open'
    group by p.id, p.order_date, p.po_number, p.vendor_name_snapshot, v.payment_terms
  ), fixed as (
    select 'fixed', 'out', d::date, f.amount, f.label, case when f.frequency = 'monthly' then 'Every month on day ' || f.day_of_month else 'Every week' end, f.id
    from public.cash_fixed_expenses f cross join generate_series(p_from, (select last_day from horizon), interval '1 day') d
    where f.company_id = p_company and f.status = 'active'
      and ((f.frequency = 'monthly' and extract(day from d)::integer = f.day_of_month) or (f.frequency = 'weekly' and extract(isodow from d)::integer = f.weekday))
  ), once as (
    select 'one_off', o.direction, o.on_date, o.amount, o.label, 'Entered by accounts', o.id
    from public.cash_one_offs o where o.company_id = p_company and o.status = 'active' and o.on_date <= (select last_day from horizon)
      and o.on_date >= p_from - 30
  )
  select x.kind, x.direction, greatest(x.expected_on, p_from), x.amount, x.label, x.basis, x.ref_id
  from (select * from recv union all select * from scrap union all select * from pay union all select * from po union all select * from fixed union all select * from once) x
  where x.amount > 0 and x.expected_on <= (select last_day from horizon)
$$;
revoke all on function private.ap9_cash_items(uuid, date, integer) from public, anon, authenticated;

create or replace function private.ap9_cash_forecast(p_company uuid, p_weeks integer)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare v_from date := private.ap8_week(private.ist_today()); s public.cash_forecast_settings%rowtype; v_weeks jsonb; v_running numeric; v_first_low date;
begin
  select * into s from public.cash_forecast_settings where company_id = p_company;
  with items as (select * from private.ap9_cash_items(p_company, v_from, p_weeks)),
  wk as (select (v_from + n * 7) week_start from generate_series(0, p_weeks - 1) n),
  agg as (
    select w.week_start,
      coalesce(sum(i.amount) filter (where i.direction = 'in'), 0) cash_in,
      coalesce(sum(i.amount) filter (where i.direction = 'out'), 0) cash_out,
      coalesce(sum(i.amount) filter (where i.kind = 'receivable' or i.kind = 'scrap_sale'), 0) receipts,
      coalesce(sum(i.amount) filter (where i.kind = 'receivable' and i.basis like 'Customer promised%'), 0) promised,
      coalesce(sum(i.amount) filter (where i.kind = 'payable'), 0) payables,
      coalesce(sum(i.amount) filter (where i.kind = 'purchase_order'), 0) purchase_orders,
      coalesce(sum(i.amount) filter (where i.kind = 'fixed'), 0) fixed,
      coalesce(sum(i.amount) filter (where i.kind = 'one_off' and i.direction = 'in'), 0) one_off_in,
      coalesce(sum(i.amount) filter (where i.kind = 'one_off' and i.direction = 'out'), 0) one_off_out,
      coalesce(jsonb_agg(jsonb_build_object('kind', i.kind, 'direction', i.direction, 'expected_on', i.expected_on, 'amount', i.amount, 'label', i.label, 'basis', i.basis, 'ref_id', i.ref_id)
        order by i.amount desc) filter (where i.kind is not null), '[]') items
    from wk w left join items i on i.expected_on between w.week_start and w.week_start + 6
    group by w.week_start
  )
  select jsonb_agg(jsonb_build_object('week_start', a.week_start, 'week_end', a.week_start + 6, 'cash_in', round(a.cash_in, 2), 'cash_out', round(a.cash_out, 2),
    'net', round(a.cash_in - a.cash_out, 2), 'receipts', a.receipts, 'promised', a.promised, 'payables', a.payables, 'purchase_orders', a.purchase_orders, 'fixed', a.fixed,
    'one_off_in', a.one_off_in, 'one_off_out', a.one_off_out, 'items', a.items) order by a.week_start) into v_weeks from agg a;
  -- A running balance only when accounts entered an opening balance; otherwise it stays blank, never zero.
  if s.opening_balance is not null then
    v_running := s.opening_balance;
    select jsonb_agg(q.w || jsonb_build_object('closing', round(v_running + q.cum, 2),
        'below_minimum', s.minimum_balance is not null and round(v_running + q.cum, 2) < s.minimum_balance) order by q.ws) into v_weeks
      from (select w, w ->> 'week_start' ws, sum((w ->> 'net')::numeric) over (order by w ->> 'week_start') cum from jsonb_array_elements(v_weeks) w) q;
    select min((w ->> 'week_start')::date) into v_first_low from jsonb_array_elements(v_weeks) w where (w ->> 'below_minimum')::boolean;
  end if;
  return jsonb_build_object('from', v_from, 'weeks', coalesce(v_weeks, '[]'), 'opening_balance', s.opening_balance, 'balance_as_of', s.balance_as_of,
    'minimum_balance', s.minimum_balance, 'first_week_below_minimum', v_first_low,
    'basis', 'Receipts: an open collection promise dates the promised part of an invoice; the rest arrives on its due date plus the customer''s usual delay. Payables: approved unpaid bills on their due date. Purchase orders: unbilled value after delivery and credit. Salaries, power, loan instalments and tax dates as entered by accounts.');
end;
$$;
revoke all on function private.ap9_cash_forecast(uuid, integer) from public, anon, authenticated;

create or replace function public.ap_cash_forecast(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_weeks integer; v_rows jsonb; v_total bigint; v_page integer := private.ap3_page(p_payload); f public.cash_fixed_expenses%rowtype; o public.cash_one_offs%rowtype; v_min numeric;
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'accounts']);
  if p_command = 'forecast' then
    perform private.ap_keys(p_payload, array['weeks']);
    v_weeks := coalesce(private.ap9_int(p_payload, 'weeks', 'Weeks', 1, 13), 4);
    return private.ap9_cash_forecast(c.company_id, v_weeks);
  elsif p_command = 'save_opening' then
    perform private.ap_keys(p_payload, array['opening_balance', 'balance_as_of']);
    insert into public.cash_forecast_settings(company_id, opening_balance, balance_as_of, updated_by)
      values (c.company_id, private.ap4_num(p_payload, 'opening_balance', 'Bank and cash balance', -1000000000, 1000000000, false),
        case when private.ap4_num(p_payload, 'opening_balance', 'Bank and cash balance', -1000000000, 1000000000, false) is null then null else coalesce(nullif(p_payload ->> 'balance_as_of', '')::date, private.ist_today()) end, c.actor_id)
      on conflict (company_id) do update set opening_balance = excluded.opening_balance, balance_as_of = excluded.balance_as_of, updated_by = excluded.updated_by, updated_at = clock_timestamp();
    return jsonb_build_object('saved', true);
  elsif p_command = 'save_minimum' then
    -- FS-73: weeks closing below this balance are highlighted. Owner and accounts decide it; clearing it is allowed.
    perform private.ap_keys(p_payload, array['minimum_balance']);
    v_min := private.ap4_num(p_payload, 'minimum_balance', 'Minimum balance', -1000000000, 1000000000, false);
    insert into public.cash_forecast_settings(company_id, minimum_balance, minimum_set_by, minimum_set_at, updated_by)
      values (c.company_id, v_min, c.actor_id, clock_timestamp(), c.actor_id)
      on conflict (company_id) do update set minimum_balance = excluded.minimum_balance, minimum_set_by = excluded.minimum_set_by, minimum_set_at = excluded.minimum_set_at, updated_at = clock_timestamp();
    return jsonb_build_object('minimum_balance', v_min);
  elsif p_command = 'fixed' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return jsonb_build_object('rows', (select coalesce(jsonb_agg(to_jsonb(x) - 'company_id' order by x.label), '[]') from public.cash_fixed_expenses x where x.company_id = c.company_id and x.status = 'active'),
      'one_offs', (select coalesce(jsonb_agg(to_jsonb(x) - 'company_id' order by x.on_date), '[]') from public.cash_one_offs x where x.company_id = c.company_id and x.status = 'active' and x.on_date >= private.ist_today() - 30));
  elsif p_command = 'save_fixed' then
    perform private.ap_keys(p_payload, array['label', 'amount', 'frequency', 'day_of_month', 'weekday']);
    if coalesce(p_payload ->> 'frequency', '') not in ('monthly', 'weekly') then raise exception 'AP: Choose monthly or weekly.'; end if;
    insert into public.cash_fixed_expenses(company_id, label, amount, frequency, day_of_month, weekday, created_by)
      values (c.company_id, private.ap_text(p_payload ->> 'label', 'Expense', 3, 80), private.ap4_num(p_payload, 'amount', 'Amount', 0.01, 100000000), p_payload ->> 'frequency',
        case when p_payload ->> 'frequency' = 'monthly' then coalesce(private.ap9_int(p_payload, 'day_of_month', 'Day of the month', 1, 28), 1) end,
        case when p_payload ->> 'frequency' = 'weekly' then coalesce(private.ap9_int(p_payload, 'weekday', 'Weekday', 1, 7), 1) end, c.actor_id)
      returning * into f;
    return to_jsonb(f) - 'company_id';
  elsif p_command = 'retire_fixed' then
    perform private.ap_keys(p_payload, array['id']);
    update public.cash_fixed_expenses set status = 'retired', retired_at = clock_timestamp() where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id and status = 'active' returning * into f;
    if f.id is null then raise exception 'AP: Expense not found.'; end if;
    return jsonb_build_object('id', f.id, 'status', f.status);
  elsif p_command = 'save_one_off' then
    perform private.ap_keys(p_payload, array['on_date', 'direction', 'amount', 'label']);
    if coalesce(p_payload ->> 'direction', '') not in ('in', 'out') then raise exception 'AP: Choose money in or money out.'; end if;
    insert into public.cash_one_offs(company_id, on_date, direction, amount, label, created_by)
      values (c.company_id, (p_payload ->> 'on_date')::date, p_payload ->> 'direction', private.ap4_num(p_payload, 'amount', 'Amount', 0.01, 1000000000), private.ap_text(p_payload ->> 'label', 'Description', 3, 120), c.actor_id)
      returning * into o;
    return to_jsonb(o) - 'company_id';
  elsif p_command = 'remove_one_off' then
    perform private.ap_keys(p_payload, array['id']);
    update public.cash_one_offs set status = 'removed' where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id and status = 'active' returning * into o;
    if o.id is null then raise exception 'AP: Entry not found.'; end if;
    return jsonb_build_object('id', o.id, 'status', o.status);
  elsif p_command = 'accuracy' then
    perform private.ap_keys(p_payload, array['page']);
    with snap as (select s.*, row_number() over (order by s.week_start desc) k from public.cash_forecast_snapshots s where s.company_id = c.company_id and s.week_start + 6 < private.ist_today())
    select coalesce((select jsonb_agg(jsonb_build_object('week_start', snap.week_start, 'expected_in', snap.expected_in, 'expected_out', snap.expected_out,
        'actual_in', round(coalesce((select sum(p.amount) from public.payments p where p.company_id = c.company_id and p.reversed_at is null and p.payment_method <> 'credit_note'
          and p.payment_date between snap.week_start and snap.week_start + 6), 0)
          + coalesce((select sum(r.amount) from public.scrap_sale_receipts r where r.company_id = c.company_id and r.received_on between snap.week_start and snap.week_start + 6), 0), 2),
        'actual_out', round(coalesce((select sum(p.amount_paid) from public.expense_payments p where p.company_id = c.company_id and p.status = 'posted'
          and p.payment_date between snap.week_start and snap.week_start + 6), 0), 2)) order by snap.k)
      from snap where snap.k > (v_page - 1) * 10 and snap.k <= v_page * 10), '[]'), (select count(*) from snap) into v_rows, v_total;
    return jsonb_build_object('rows', v_rows, 'page', v_page, 'total_count', v_total);
  elsif p_command = 'snapshot_now' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return private.ap9_cash_snapshot_job(c.company_id, null);
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_cash_forecast(text, jsonb) from public, anon;
grant execute on function public.ap_cash_forecast(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- FS-72: metal price exposure and back-to-back bookings (visibility only)
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.metal_exposure_settings (
  company_id uuid primary key references public.companies(id),
  open_position_limit_kg numeric(14,3) check (open_position_limit_kg is null or open_position_limit_kg > 0),
  price_step_per_kg numeric(10,2) not null default 5 check (price_step_per_kg > 0 and price_step_per_kg <= 1000),
  reason text not null check (length(btrim(reason)) between 5 and 300),
  updated_by uuid not null references public.app_users(id),
  updated_at timestamptz not null default clock_timestamp()
);

-- An order's metal basis. Absent means the metal is in a fixed selling price (Omalco's normal per-kg rate).
create table if not exists public.order_metal_terms (
  order_id uuid primary key,
  company_id uuid not null references public.companies(id),
  basis text not null check (basis in ('fixed', 'price_linked')),
  note text not null check (length(btrim(note)) between 5 and 300),
  set_by uuid not null references public.app_users(id),
  set_at timestamptz not null default clock_timestamp(),
  foreign key (company_id, order_id) references public.orders(company_id, id)
);

create table if not exists public.metal_bookings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  order_id uuid not null,
  purchase_order_id uuid references public.purchase_orders(id),
  supplier_reference text not null check (length(btrim(supplier_reference)) between 2 and 120),
  quantity_kg numeric(14,3) not null check (quantity_kg > 0),
  rate_per_kg numeric(12,2) not null check (rate_per_kg > 0),
  booked_on date not null,
  status text not null default 'open' check (status in ('open', 'cancelled')),
  note text check (note is null or length(btrim(note)) between 3 and 300),
  booked_by uuid not null references public.app_users(id),
  booked_at timestamptz not null default clock_timestamp(),
  cancelled_by uuid references public.app_users(id),
  cancelled_at timestamptz,
  cancel_reason text,
  check ((status = 'cancelled') = (cancelled_at is not null)),
  check (status <> 'cancelled' or length(btrim(cancel_reason)) between 5 and 300),
  foreign key (company_id, order_id) references public.orders(company_id, id)
);
create index if not exists metal_bookings_order_idx on public.metal_bookings(company_id, order_id, status);

create table if not exists public.metal_exposure_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  snapshot_date date not null,
  sold_open_kg numeric(14,3) not null,
  booked_kg numeric(14,3) not null,
  uncovered_kg numeric(14,3) not null,
  stock_kg numeric(14,3) not null,
  on_order_kg numeric(14,3) not null,
  net_kg numeric(14,3) not null,
  limit_kg numeric(14,3),
  reference_rate numeric(12,2),
  captured_at timestamptz not null default clock_timestamp(),
  unique (company_id, snapshot_date)
);

alter table public.metal_exposure_settings enable row level security;
alter table public.order_metal_terms enable row level security;
alter table public.metal_bookings enable row level security;
alter table public.metal_exposure_snapshots enable row level security;
revoke all on public.metal_exposure_settings, public.order_metal_terms, public.metal_bookings, public.metal_exposure_snapshots from public, anon, authenticated;

-- Open fixed-price metal per order: finished kg still to be produced (ordered - produced - supplied from stock), the
-- net metal it consumes once scrap is remelted. Billet input for recovery losses is not added.
create or replace function private.fs4_open_sales_metal(p_company uuid)
returns table(order_id uuid, order_number text, customer_name text, open_kg numeric, booked_kg numeric, uncovered_kg numeric, basis text, lines_missing_quantity integer)
language sql stable security definer set search_path = public, private as $$
  with lines as (
    select r.order_id, max(r.order_number) order_number, max(r.customer_name) customer_name,
      sum(greatest(coalesce(r.ordered_kg, 0) - coalesce(r.produced_kg, 0) - coalesce(r.from_stock_kg, 0), 0)) open_kg,
      count(*) filter (where r.ordered_kg is null)::integer missing
    from private.order_line_requirements(p_company, null) r
    where not r.order_closed group by r.order_id
  )
  select l.order_id, l.order_number, l.customer_name, round(l.open_kg, 3),
    round(coalesce(b.kg, 0), 3), round(greatest(l.open_kg - coalesce(b.kg, 0), 0), 3), coalesce(t.basis, 'fixed'), l.missing
  from lines l
  left join public.order_metal_terms t on t.order_id = l.order_id and t.company_id = p_company
  left join lateral (select sum(x.quantity_kg) kg from public.metal_bookings x where x.company_id = p_company and x.order_id = l.order_id and x.status = 'open') b on true
  where l.open_kg > 0.0005 or l.missing > 0
$$;
revoke all on function private.fs4_open_sales_metal(uuid) from public, anon, authenticated;

create or replace function private.fs4_metal_exposure(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare s public.metal_exposure_settings%rowtype; v_sold numeric; v_booked numeric; v_uncovered numeric; v_linked numeric; v_missing integer;
  v_billet numeric; v_cast numeric; v_allocated numeric; v_scrap numeric; v_on_order numeric; v_stock numeric; v_net numeric; v_rate numeric; v_top jsonb;
begin
  select * into s from public.metal_exposure_settings where company_id = p_company;
  select coalesce(sum(open_kg) filter (where basis = 'fixed'), 0), coalesce(sum(booked_kg) filter (where basis = 'fixed'), 0),
    coalesce(sum(uncovered_kg) filter (where basis = 'fixed'), 0), coalesce(sum(open_kg) filter (where basis = 'price_linked'), 0), coalesce(sum(lines_missing_quantity), 0)
    into v_sold, v_booked, v_uncovered, v_linked, v_missing from private.fs4_open_sales_metal(p_company);
  -- Metal held at a known price: purchased billet in stock, cast billets (free and allocated to jobs, not yet consumed) and the foundry scrap pool.
  v_billet := coalesce((select sum(b.available_weight_kg) from public.billet_batches b where b.company_id = p_company and b.status = 'available'), 0);
  v_cast := coalesce((select sum(coalesce(b.measured_weight_kg, b.weight_kg)) from public.foundry_billets b where b.company_id = p_company and b.status = 'cast'), 0);
  v_allocated := coalesce((select sum(coalesce(b.measured_weight_kg, b.weight_kg)) from public.foundry_billets b where b.company_id = p_company and b.status in ('allocated', 'issued')), 0);
  v_scrap := coalesce((select sum(x.available_weight_kg) from public.foundry_aluminium_scrap x where x.company_id = p_company and x.status = 'available'), 0);
  -- Metal bought at a fixed price but not yet received: billet purchase lines linked as billet supply, less what arrived.
  v_on_order := coalesce((select sum(greatest(l.ordered_quantity - coalesce((select sum(rl.received_quantity) from public.purchase_receipt_lines rl
      where rl.company_id = p_company and rl.purchase_order_line_id = l.id), 0), 0))
    from public.procurement_supply_links sl join public.purchase_order_lines l on l.id = sl.purchase_order_line_id and l.company_id = p_company
    join public.purchase_orders po on po.id = l.purchase_order_id and po.company_id = p_company
    where sl.company_id = p_company and po.status = 'open' and l.unit = 'kg'), 0);
  v_stock := v_billet + v_cast + v_allocated + v_scrap;
  -- Positive: sold at a fixed price and not covered by metal held or bought (exposed to a rising price).
  -- Negative: metal held or bought beyond what is sold (exposed to a falling price).
  v_net := v_uncovered - (v_stock + v_on_order);
  select r.rate into v_rate from public.costing_rates r where r.company_id = p_company and r.rate_type = 'billet' and r.status = 'approved' and r.customer_id is null
    and r.effective_from <= private.ist_today() and (r.effective_to is null or r.effective_to >= private.ist_today()) order by r.effective_from desc, r.approved_at desc nulls last limit 1;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.uncovered_kg desc), '[]') into v_top from (select * from private.fs4_open_sales_metal(p_company) where basis = 'fixed' order by uncovered_kg desc limit 10) x;
  return jsonb_build_object('as_of', clock_timestamp(), 'sold_open_kg', round(v_sold, 3), 'booked_kg', round(v_booked, 3), 'uncovered_kg', round(v_uncovered, 3),
    'price_linked_kg', round(v_linked, 3), 'lines_missing_quantity', v_missing,
    'stock', jsonb_build_object('billet_kg', round(v_billet, 3), 'cast_free_kg', round(v_cast, 3), 'cast_allocated_kg', round(v_allocated, 3), 'scrap_pool_kg', round(v_scrap, 3), 'total_kg', round(v_stock, 3)),
    'on_order_kg', round(v_on_order, 3), 'net_kg', round(v_net, 3), 'direction', case when v_net > 0.0005 then 'short' when v_net < -0.0005 then 'long' else 'flat' end,
    'price_step_per_kg', coalesce(s.price_step_per_kg, 5), 'impact_of_step', round(abs(v_net) * coalesce(s.price_step_per_kg, 5), 2),
    'limit_kg', s.open_position_limit_kg, 'over_limit', s.open_position_limit_kg is not null and abs(v_net) > s.open_position_limit_kg,
    'reference_rate', v_rate, 'orders', v_top,
    'basis', 'Sold: finished kg still to produce on open fixed-price orders, less back-to-back bookings against them. Held: billet in stock, cast billets not yet consumed and the foundry scrap pool. On order: open billet purchase lines not yet received. Net = sold uncovered - held - on order. Visibility only; no trading or hedging advice.');
end;
$$;
revoke all on function private.fs4_metal_exposure(uuid) from public, anon, authenticated;

-- Morning: keep the day's position and alert the owner when it passes the limit; the alert closes when it is back inside.
create or replace function private.fs4_exposure_snapshot(p_company uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v jsonb := private.fs4_metal_exposure(p_company); v_n integer := 0; v_alerts integer := 0;
begin
  insert into public.metal_exposure_snapshots(company_id, snapshot_date, sold_open_kg, booked_kg, uncovered_kg, stock_kg, on_order_kg, net_kg, limit_kg, reference_rate)
    values (p_company, private.ist_today(), (v ->> 'sold_open_kg')::numeric, (v ->> 'booked_kg')::numeric, (v ->> 'uncovered_kg')::numeric,
      (v -> 'stock' ->> 'total_kg')::numeric, (v ->> 'on_order_kg')::numeric, (v ->> 'net_kg')::numeric, nullif(v ->> 'limit_kg', '')::numeric, nullif(v ->> 'reference_rate', '')::numeric)
    on conflict (company_id, snapshot_date) do nothing;
  get diagnostics v_n = row_count;
  if (v ->> 'over_limit')::boolean then
    if not exists (select 1 from public.notifications where company_id = p_company and condition_key = 'fs4:metal-exposure' and resolved_at is null) then
      insert into public.notifications(company_id, recipient_role, notification_type, severity, title, body, action_link, entity_reference, condition_key)
        values (p_company, 'owner', 'metal_exposure', 'warning', 'Metal position above your limit',
          'Net open position ' || to_char(abs((v ->> 'net_kg')::numeric), 'FM999,999,990') || ' kg ' || (v ->> 'direction') || ' against a limit of '
            || to_char((v ->> 'limit_kg')::numeric, 'FM999,999,990') || ' kg.', '/insights/metal-exposure', 'fs4:metal-exposure', 'fs4:metal-exposure');
      v_alerts := 1;
    end if;
  else
    update public.notifications set resolved_at = clock_timestamp(), resolution = 'Position back within the limit'
      where company_id = p_company and condition_key = 'fs4:metal-exposure' and resolved_at is null;
  end if;
  return jsonb_build_object('examined', 1, 'proposals', 0, 'alerts', v_alerts, 'snapshots', v_n);
end;
$$;
revoke all on function private.fs4_exposure_snapshot(uuid) from public, anon, authenticated;

create or replace function public.fs_metal_exposure(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_order uuid; v_kg numeric; v_open numeric; v_booked numeric; b public.metal_bookings%rowtype; v_po uuid; v_rows jsonb; v_total bigint; v_page integer := private.ap3_page(p_payload);
begin
  if p_command = 'save_settings' then select * into c from private.ap_ctx(array['owner']);
  else select * into c from private.ap_ctx(array['owner', 'admin', 'accounts']); end if;
  if p_command = 'position' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return private.fs4_metal_exposure(c.company_id);
  elsif p_command = 'trend' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(x) - 'company_id' - 'id' order by x.snapshot_date) from (select * from public.metal_exposure_snapshots
      where company_id = c.company_id order by snapshot_date desc limit 30) x), '[]'));
  elsif p_command = 'bookings' then
    perform private.ap_keys(p_payload, array['page', 'status']);
    if coalesce(p_payload ->> 'status', 'open') not in ('open', 'cancelled', 'all') then raise exception 'AP: Choose open, cancelled or all.'; end if;
    with q as (select mb.*, o.order_number, po.po_number, u.full_name booked_by_name, row_number() over (order by mb.booked_on desc, mb.booked_at desc) k
      from public.metal_bookings mb join public.orders o on o.id = mb.order_id left join public.purchase_orders po on po.id = mb.purchase_order_id join public.app_users u on u.id = mb.booked_by
      where mb.company_id = c.company_id and (coalesce(p_payload ->> 'status', 'open') = 'all' or mb.status = coalesce(p_payload ->> 'status', 'open')))
    select coalesce(jsonb_agg(to_jsonb(q) - 'company_id' - 'k' order by q.k) filter (where q.k > (v_page - 1) * 10 and q.k <= v_page * 10), '[]'), count(*) into v_rows, v_total from q;
    return jsonb_build_object('rows', v_rows, 'page', v_page, 'total_count', v_total);
  elsif p_command = 'book' then
    perform private.ap_keys(p_payload, array['order_id', 'purchase_order_id', 'supplier_reference', 'quantity_kg', 'rate_per_kg', 'booked_on', 'note']);
    v_order := private.ap_uuid(p_payload, 'order_id');
    perform 1 from public.orders where id = v_order and company_id = c.company_id and deleted_at is null for update;
    if not found then raise exception 'AP: Order not found.'; end if;
    v_po := private.ap_uuid(p_payload, 'purchase_order_id', false);
    if v_po is not null and not exists (select 1 from public.purchase_orders where id = v_po and company_id = c.company_id) then raise exception 'AP: Purchase order not found.'; end if;
    v_kg := private.ap4_num(p_payload, 'quantity_kg', 'Quantity', 0.001, 100000000);
    select coalesce(open_kg, 0), coalesce(booked_kg, 0) into v_open, v_booked from private.fs4_open_sales_metal(c.company_id) where order_id = v_order;
    -- A booking covers metal the order still needs; it cannot cover more than that.
    if v_kg > coalesce(v_open, 0) - coalesce(v_booked, 0) + 0.0005 then
      raise exception 'AP: This order needs % kg more metal; % kg is already booked.', round(greatest(coalesce(v_open, 0) - coalesce(v_booked, 0), 0), 1), round(coalesce(v_booked, 0), 1);
    end if;
    insert into public.metal_bookings(company_id, order_id, purchase_order_id, supplier_reference, quantity_kg, rate_per_kg, booked_on, note, booked_by)
      values (c.company_id, v_order, v_po, private.ap_text(p_payload ->> 'supplier_reference', 'Supplier reference', 2, 120), v_kg,
        private.ap4_num(p_payload, 'rate_per_kg', 'Rate per kg', 1, 100000), coalesce(nullif(p_payload ->> 'booked_on', '')::date, private.ist_today()),
        private.ap_text(p_payload ->> 'note', 'Note', 3, 300, false), c.actor_id) returning * into b;
    return to_jsonb(b) - 'company_id';
  elsif p_command = 'cancel_booking' then
    perform private.ap_keys(p_payload, array['id', 'reason']);
    update public.metal_bookings set status = 'cancelled', cancelled_by = c.actor_id, cancelled_at = clock_timestamp(), cancel_reason = private.ap_text(p_payload ->> 'reason', 'Reason', 5, 300)
      where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id and status = 'open' returning * into b;
    if b.id is null then raise exception 'AP: Open booking not found.'; end if;
    return jsonb_build_object('id', b.id, 'status', b.status);
  elsif p_command = 'set_terms' then
    perform private.ap_keys(p_payload, array['order_id', 'basis', 'note']);
    v_order := private.ap_uuid(p_payload, 'order_id');
    if not exists (select 1 from public.orders where id = v_order and company_id = c.company_id and deleted_at is null) then raise exception 'AP: Order not found.'; end if;
    if coalesce(p_payload ->> 'basis', '') not in ('fixed', 'price_linked') then raise exception 'AP: Choose fixed or price-linked metal.'; end if;
    insert into public.order_metal_terms(order_id, company_id, basis, note, set_by) values (v_order, c.company_id, p_payload ->> 'basis', private.ap_text(p_payload ->> 'note', 'Note', 5, 300), c.actor_id)
      on conflict (order_id) do update set basis = excluded.basis, note = excluded.note, set_by = excluded.set_by, set_at = clock_timestamp();
    return jsonb_build_object('order_id', v_order, 'basis', p_payload ->> 'basis');
  elsif p_command = 'settings' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return coalesce((select to_jsonb(s) - 'company_id' || jsonb_build_object('updated_by_name', u.full_name) from public.metal_exposure_settings s join public.app_users u on u.id = s.updated_by
      where s.company_id = c.company_id), jsonb_build_object('open_position_limit_kg', null, 'price_step_per_kg', 5));
  elsif p_command = 'save_settings' then
    perform private.ap_keys(p_payload, array['open_position_limit_kg', 'price_step_per_kg', 'reason']);
    insert into public.metal_exposure_settings(company_id, open_position_limit_kg, price_step_per_kg, reason, updated_by)
      values (c.company_id, private.ap4_num(p_payload, 'open_position_limit_kg', 'Open position limit', 1, 100000000, false),
        coalesce(private.ap4_num(p_payload, 'price_step_per_kg', 'Price step', 0.5, 1000, false), 5), private.ap_text(p_payload ->> 'reason', 'Reason', 5, 300), c.actor_id)
      on conflict (company_id) do update set open_position_limit_kg = excluded.open_position_limit_kg, price_step_per_kg = excluded.price_step_per_kg, reason = excluded.reason,
        updated_by = excluded.updated_by, updated_at = clock_timestamp();
    return private.fs4_exposure_snapshot(c.company_id) || jsonb_build_object('saved', true);
  elsif p_command = 'snapshot_now' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return private.fs4_exposure_snapshot(c.company_id);
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.fs_metal_exposure(text, jsonb) from public, anon;
grant execute on function public.fs_metal_exposure(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- FS-71: weighted pipeline, order book, concentration, dropping customers and a seasonal projection
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.sales_forecast_settings (
  company_id uuid primary key references public.companies(id),
  -- Null = use the measured win rate. A set value is a named person's judgement with a reason.
  probability_unsent_percent numeric(5,2) check (probability_unsent_percent is null or probability_unsent_percent between 0 and 100),
  probability_sent_percent numeric(5,2) check (probability_sent_percent is null or probability_sent_percent between 0 and 100),
  drop_threshold_percent numeric(5,2) not null default 50 check (drop_threshold_percent between 5 and 95),
  reason text not null check (length(btrim(reason)) between 5 and 300),
  updated_by uuid not null references public.app_users(id),
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.sales_forecast_settings enable row level security;
revoke all on public.sales_forecast_settings from public, anon, authenticated;

-- Win rate per stage from the last year's decided quotes: won = approved by the customer or converted to an order;
-- decided = won + rejected + expired + recorded as lost. At least ten decided quotes, otherwise unknown.
create or replace function private.fs4_win_rates(p_company uuid)
returns jsonb language sql stable security definer set search_path = public, private as $$
  with q as (
    select q.id, q.sent_at is not null was_sent,
      q.status in ('customer_approved', 'converted_to_order') or exists (select 1 from public.orders o where o.quote_id = q.id and o.company_id = p_company and o.deleted_at is null) won,
      q.status in ('customer_approved', 'converted_to_order', 'customer_rejected', 'expired')
        or exists (select 1 from public.orders o where o.quote_id = q.id and o.company_id = p_company and o.deleted_at is null)
        or exists (select 1 from public.quote_outcomes x where x.company_id = p_company and x.quote_id = q.id and x.status = 'active') decided
    from public.quotes q where q.company_id = p_company and q.deleted_at is null and q.quote_date >= private.ist_today() - 365
  )
  select jsonb_build_object(
    'unsent', jsonb_build_object('decided', count(*) filter (where decided), 'won', count(*) filter (where decided and won),
      'percent', case when count(*) filter (where decided) >= 10 then round(count(*) filter (where decided and won) * 100.0 / count(*) filter (where decided), 1) end),
    'sent', jsonb_build_object('decided', count(*) filter (where decided and was_sent), 'won', count(*) filter (where decided and won and was_sent),
      'percent', case when count(*) filter (where decided and was_sent) >= 10 then round(count(*) filter (where decided and won and was_sent) * 100.0 / count(*) filter (where decided and was_sent), 1) end))
  from q
$$;
revoke all on function private.fs4_win_rates(uuid) from public, anon, authenticated;

create or replace function private.fs4_order_book(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare s public.sales_forecast_settings%rowtype; v_rates jsonb := private.fs4_win_rates(p_company); v_p_unsent numeric; v_p_sent numeric;
  v_pipeline jsonb; v_book jsonb; v_press jsonb; v_conc jsonb; v_drop jsonb; v_proj jsonb; v_today date := private.ist_today();
begin
  select * into s from public.sales_forecast_settings where company_id = p_company;
  v_p_unsent := coalesce(s.probability_unsent_percent, (v_rates -> 'unsent' ->> 'percent')::numeric);
  v_p_sent := coalesce(s.probability_sent_percent, (v_rates -> 'sent' ->> 'percent')::numeric);

  with open_q as (
    select q.id, q.quote_number, q.status, q.sent_at is not null was_sent, coalesce(q.total_before_gst, 0) value,
      coalesce((select sum(coalesce(qi.total_weight_kg, qi.quantity_kg)) from public.quote_items qi where qi.quote_id = q.id and qi.company_id = p_company), 0) kg
    from public.quotes q where q.company_id = p_company and q.deleted_at is null
      and q.status in ('draft', 'internal_review', 'approved_for_sending', 'sent') and (q.valid_until is null or q.valid_until >= v_today)
      and not exists (select 1 from public.orders o where o.quote_id = q.id and o.company_id = p_company and o.deleted_at is null)
      and not exists (select 1 from public.quote_outcomes x where x.company_id = p_company and x.quote_id = q.id and x.status = 'active')
  )
  select jsonb_build_object(
    'stages', jsonb_build_array(
      jsonb_build_object('stage', 'unsent', 'quotes', count(*) filter (where not was_sent), 'value', round(coalesce(sum(value) filter (where not was_sent), 0), 2),
        'kg', round(coalesce(sum(kg) filter (where not was_sent), 0), 1), 'probability_percent', v_p_unsent,
        'probability_source', case when s.probability_unsent_percent is not null then 'set' when v_p_unsent is not null then 'measured' else 'unknown' end,
        'weighted_value', case when v_p_unsent is not null then round(coalesce(sum(value) filter (where not was_sent), 0) * v_p_unsent / 100, 2) end,
        'weighted_kg', case when v_p_unsent is not null then round(coalesce(sum(kg) filter (where not was_sent), 0) * v_p_unsent / 100, 1) end),
      jsonb_build_object('stage', 'sent', 'quotes', count(*) filter (where was_sent), 'value', round(coalesce(sum(value) filter (where was_sent), 0), 2),
        'kg', round(coalesce(sum(kg) filter (where was_sent), 0), 1), 'probability_percent', v_p_sent,
        'probability_source', case when s.probability_sent_percent is not null then 'set' when v_p_sent is not null then 'measured' else 'unknown' end,
        'weighted_value', case when v_p_sent is not null then round(coalesce(sum(value) filter (where was_sent), 0) * v_p_sent / 100, 2) end,
        'weighted_kg', case when v_p_sent is not null then round(coalesce(sum(kg) filter (where was_sent), 0) * v_p_sent / 100, 1) end)),
    'win_rates', v_rates) into v_pipeline from open_q;

  -- Order book: kg still to dispatch on open lines.
  with l as (
    select r.order_item_id, greatest(coalesce(r.ordered_kg, 0) - coalesce(r.dispatched_kg, 0), 0) open_kg,
      greatest(coalesce(r.ordered_kg, 0) - coalesce(r.produced_kg, 0) - coalesce(r.from_stock_kg, 0), 0) to_make_kg,
      coalesce(upper(nullif(btrim(p.alloy), '')), 'Not set') alloy, coalesce(oi.finishing_type, 'mill_finish') finish
    from private.order_line_requirements(p_company, null) r join public.order_items oi on oi.id = r.order_item_id
    left join public.aluminium_profiles p on p.id = oi.profile_id
    where not r.order_closed and r.ordered_kg is not null
  )
  select jsonb_build_object('open_kg', round(coalesce(sum(open_kg), 0), 1), 'to_make_kg', round(coalesce(sum(to_make_kg), 0), 1),
    'lines', count(*) filter (where open_kg > 0),
    'by_alloy', coalesce((select jsonb_agg(jsonb_build_object('key', alloy, 'open_kg', round(k, 1)) order by k desc) from (select alloy, sum(open_kg) k from l group by alloy having sum(open_kg) > 0) a), '[]'),
    'by_finish', coalesce((select jsonb_agg(jsonb_build_object('key', finish, 'label', private.ap9_finish_label(finish), 'open_kg', round(k, 1)) order by k desc) from (select finish, sum(open_kg) k from l group by finish having sum(open_kg) > 0) a), '[]'))
    into v_book from l;

  -- Load by press: open job kg on each press against its recorded weekly shift capacity.
  with jobs as (
    select j.machine_id, sum(greatest(coalesce(j.planned_quantity_kg, 0) - coalesce(j.actual_quantity_kg, 0), 0)) kg
    from public.production_jobs j where j.company_id = p_company and j.status in ('planned', 'ready', 'in_progress', 'on_hold') group by j.machine_id
  ), cap as (select sc.machine_id, sum(sc.capacity_kg) kg from public.factory_shift_capacities sc where sc.company_id = p_company group by sc.machine_id)
  select coalesce(jsonb_agg(jsonb_build_object('machine_id', j.machine_id, 'press', coalesce(m.machine_name, 'Not yet on a press'), 'open_job_kg', round(j.kg, 1),
      'weekly_capacity_kg', round(c.kg, 1), 'weeks_of_load', case when c.kg > 0 then round(j.kg / c.kg, 1) end,
      'days_of_load', case when c.kg > 0 then round(j.kg / c.kg * 7, 1) end) order by m.machine_name nulls last), '[]')
    into v_press from jobs j left join public.machines m on m.id = j.machine_id left join cap c on c.machine_id = j.machine_id where j.kg > 0;

  -- Concentration over the last twelve months of invoiced value (before tax).
  with c as (select i.customer_id, sum(i.subtotal) v from public.invoices i where i.company_id = p_company and i.deleted_at is null and i.opening_cutover_id is null
      and i.status in ('generated', 'sent', 'partially_paid', 'paid', 'overdue') and i.invoice_date > v_today - 365 group by i.customer_id),
    r as (select c.*, row_number() over (order by c.v desc) k, sum(c.v) over () total from c)
  select jsonb_build_object('total_value', round(coalesce(max(total), 0), 2), 'customers', count(*),
    'top5_share_percent', case when max(total) > 0 then round(coalesce(sum(v) filter (where k <= 5), 0) * 100 / max(total), 1) end,
    'top5', coalesce(jsonb_agg(jsonb_build_object('customer_id', r.customer_id, 'name', (select coalesce(nullif(btrim(cu.company_name), ''), cu.customer_name) from public.customers cu where cu.id = r.customer_id),
      'value', round(r.v, 2), 'share_percent', round(r.v * 100 / nullif(r.total, 0), 1)) order by r.k) filter (where k <= 5), '[]')) into v_conc from r;

  -- Dropping customers: ordered kg in the last 90 days below the threshold share of their average 90 days over the 270 days before.
  with o as (select o.customer_id, o.order_date, coalesce((select sum(oi.quantity_kg) from public.order_items oi where oi.order_id = o.id), o.production_quantity_kg, 0) kg
      from public.orders o where o.company_id = p_company and o.deleted_at is null and coalesce(o.current_stage, '') <> 'cancelled' and o.order_date > v_today - 360),
    c as (select customer_id, sum(kg) filter (where order_date > v_today - 90) recent, sum(kg) filter (where order_date <= v_today - 90) / 3 baseline,
      count(*) filter (where order_date <= v_today - 90) prior_orders from o group by customer_id)
  select coalesce(jsonb_agg(jsonb_build_object('customer_id', c.customer_id, 'name', coalesce(nullif(btrim(cu.company_name), ''), cu.customer_name),
      'recent_90_kg', round(coalesce(c.recent, 0), 1), 'average_90_kg', round(c.baseline, 1), 'change_percent', round((coalesce(c.recent, 0) - c.baseline) * 100 / c.baseline, 1))
      order by (coalesce(c.recent, 0) - c.baseline) / c.baseline), '[]')
    into v_drop from c join public.customers cu on cu.id = c.customer_id
    where c.prior_orders >= 3 and c.baseline > 0 and coalesce(c.recent, 0) < c.baseline * coalesce(s.drop_threshold_percent, 50) / 100;

  -- Seasonal projection for the next three months: the same months last year x the customer's trailing growth (capped 0.5-2).
  with o as (select o.customer_id, date_trunc('month', o.order_date)::date m, coalesce((select sum(oi.quantity_kg) from public.order_items oi where oi.order_id = o.id), o.production_quantity_kg, 0) kg
      from public.orders o where o.company_id = p_company and o.deleted_at is null and coalesce(o.current_stage, '') <> 'cancelled' and o.order_date > v_today - 730),
    g as (select customer_id, sum(kg) filter (where m > v_today - 365) last12, sum(kg) filter (where m <= v_today - 365) prev12 from o group by customer_id),
    months as (select (date_trunc('month', v_today) + make_interval(months => n))::date m from generate_series(1, 3) n),
    p as (select mo.m, o.customer_id, sum(o.kg) * least(2, greatest(0.5, coalesce(g.last12 / nullif(g.prev12, 0), 1))) kg
      from months mo join o on o.m = (mo.m - interval '1 year')::date join g on g.customer_id = o.customer_id group by mo.m, o.customer_id, g.last12, g.prev12)
  select jsonb_build_object('months', coalesce((select jsonb_agg(jsonb_build_object('month', mo.m, 'projected_kg', round(coalesce((select sum(kg) from p where p.m = mo.m), 0), 1)) order by mo.m) from months mo), '[]'),
    'customers', coalesce((select jsonb_agg(x order by (x ->> 'projected_kg')::numeric desc) from (select jsonb_build_object('customer_id', p.customer_id,
      'name', (select coalesce(nullif(btrim(cu.company_name), ''), cu.customer_name) from public.customers cu where cu.id = p.customer_id), 'projected_kg', round(sum(p.kg), 1)) x
      from p group by p.customer_id order by sum(p.kg) desc limit 10) z), '[]')) into v_proj;

  return jsonb_build_object('as_of', clock_timestamp(), 'pipeline', v_pipeline, 'order_book', v_book, 'presses', v_press, 'concentration', v_conc,
    'dropping', v_drop, 'drop_threshold_percent', coalesce(s.drop_threshold_percent, 50), 'projection', v_proj,
    'settings', case when s.company_id is null then null else jsonb_build_object('reason', s.reason, 'updated_at', s.updated_at, 'updated_by', (select full_name from public.app_users where id = s.updated_by)) end,
    'basis', jsonb_build_object(
      'pipeline', 'Open quotes not yet ordered, lost or expired. Weighted = value x win rate: the last year''s decided quotes at that stage (at least ten), unless a person has set the probability.',
      'order_book', 'Ordered kg not yet dispatched on open order lines; to make = ordered - produced - supplied from stock.',
      'presses', 'Open production job kg on each press / the sum of its weekly shift capacities.',
      'concentration', 'Invoiced value before tax over the last twelve months.',
      'dropping', 'Customers with at least three orders in the 270 days before the last 90, whose last-90-day ordered kg is below the threshold share of their 90-day average.',
      'projection', 'For each customer: the same months last year x (last twelve months / the twelve before), capped between 0.5 and 2.'));
end;
$$;
revoke all on function private.fs4_order_book(uuid) from public, anon, authenticated;

create or replace function public.fs_order_book(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record;
begin
  if p_command = 'save_settings' then select * into c from private.ap_ctx(array['owner', 'admin', 'sales_manager']);
  else select * into c from private.ap_ctx(array['owner', 'admin', 'sales_manager', 'accounts', 'factory_manager']); end if;
  if p_command = 'overview' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return private.fs4_order_book(c.company_id);
  elsif p_command = 'save_settings' then
    perform private.ap_keys(p_payload, array['probability_unsent_percent', 'probability_sent_percent', 'drop_threshold_percent', 'reason']);
    insert into public.sales_forecast_settings(company_id, probability_unsent_percent, probability_sent_percent, drop_threshold_percent, reason, updated_by)
      values (c.company_id, private.ap4_num(p_payload, 'probability_unsent_percent', 'Probability for unsent quotes', 0, 100, false),
        private.ap4_num(p_payload, 'probability_sent_percent', 'Probability for sent quotes', 0, 100, false),
        coalesce(private.ap4_num(p_payload, 'drop_threshold_percent', 'Drop threshold', 5, 95, false), 50), private.ap_text(p_payload ->> 'reason', 'Reason', 5, 300), c.actor_id)
      on conflict (company_id) do update set probability_unsent_percent = excluded.probability_unsent_percent, probability_sent_percent = excluded.probability_sent_percent,
        drop_threshold_percent = excluded.drop_threshold_percent, reason = excluded.reason, updated_by = excluded.updated_by, updated_at = clock_timestamp();
    return jsonb_build_object('saved', true);
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.fs_order_book(text, jsonb) from public, anon;
grant execute on function public.fs_order_book(text, jsonb) to authenticated;

commit;

begin;

-- Return the owner analytics dashboard as one tenant-scoped aggregate. The
-- function remains SECURITY INVOKER so table RLS is still the final boundary.
create or replace function public.get_advanced_analytics_snapshot(
  p_as_of date default current_date,
  p_months integer default 6
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid := public.get_current_user_company_id();
  v_role text := public.get_current_user_role();
  v_month_start date;
  v_next_month date;
  v_trend_start date;
  v_result jsonb;
begin
  if auth.uid() is null or v_company_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if v_role not in ('owner', 'admin', 'accounts', 'sales_manager') then
    raise exception 'Permission denied for management analytics' using errcode = '42501';
  end if;

  if p_as_of is null then
    raise exception 'Analytics as-of date is required' using errcode = '22004';
  end if;

  if p_months is null or p_months < 1 or p_months > 24 then
    raise exception 'Analytics month range must be between 1 and 24' using errcode = '22023';
  end if;

  v_month_start := date_trunc('month', p_as_of)::date;
  v_next_month := (v_month_start + interval '1 month')::date;
  v_trend_start := (v_month_start - make_interval(months => p_months - 1))::date;

  with
  order_rows as materialized (
    select
      o.id,
      o.customer_id,
      o.order_date,
      coalesce(o.order_value, 0)::numeric as order_value,
      coalesce(o.current_stage, 'order_confirmed') as current_stage,
      o.expected_dispatch_date
    from public.orders o
    where o.company_id = v_company_id
      and o.deleted_at is null
  ),
  quote_rows as materialized (
    select
      q.id,
      coalesce(q.status, 'draft') as status,
      coalesce(q.grand_total, 0)::numeric as grand_total,
      coalesce(q.quote_date, q.created_at::date) as activity_date
    from public.quotes q
    where q.company_id = v_company_id
      and q.deleted_at is null
  ),
  production_rows as materialized (
    select
      p.id,
      coalesce(p.status, 'planned') as status,
      p.planned_date,
      coalesce(p.planned_quantity_kg, 0)::numeric as planned_quantity_kg,
      coalesce(p.actual_quantity_kg, 0)::numeric as actual_quantity_kg
    from public.production_jobs p
    where p.company_id = v_company_id
  ),
  dispatch_rows as materialized (
    select
      d.id,
      d.dispatch_date,
      coalesce(d.total_weight_kg, 0)::numeric as total_weight_kg,
      o.expected_dispatch_date
    from public.dispatches d
    join public.orders o
      on o.id = d.order_id
     and o.company_id = d.company_id
    where d.company_id = v_company_id
      and o.deleted_at is null
  ),
  invoice_rows as materialized (
    select
      i.id,
      i.customer_id,
      i.invoice_number,
      i.invoice_date,
      i.due_date,
      coalesce(i.status, 'draft') as status,
      coalesce(i.grand_total, 0)::numeric as grand_total,
      coalesce(i.balance_due, 0)::numeric as balance_due
    from public.invoices i
    where i.company_id = v_company_id
      and i.deleted_at is null
  ),
  expense_rows as materialized (
    select
      e.id,
      coalesce(e.invoice_date, e.created_at::date) as activity_date,
      coalesce(e.total_amount, 0)::numeric as total_amount,
      coalesce(e.amount_paid, 0)::numeric as amount_paid
    from public.expense_ledger e
    where e.company_id = v_company_id
      and e.deleted_at is null
  ),
  quality_rows as materialized (
    select
      qi.id,
      coalesce(qi.status, 'pending') as status,
      coalesce(qi.inspection_date::date, qi.created_at::date) as activity_date
    from public.quality_inspections qi
    where qi.company_id = v_company_id
  ),
  payment_rows as materialized (
    select event_id, payment_date, coalesce(amount, 0)::numeric as amount
    from public.get_financial_collection_events(v_trend_start)
  ),
  order_summary as (
    select
      coalesce(sum(order_value) filter (
        where order_date >= v_month_start
          and order_date < v_next_month
          and current_stage <> 'cancelled'
      ), 0)::numeric as booked_revenue_mtd,
      count(*) filter (where current_stage not in ('delivered', 'closed', 'cancelled'))::integer as active_orders,
      count(*) filter (
        where current_stage not in ('delivered', 'closed', 'cancelled')
          and expected_dispatch_date < p_as_of
      )::integer as delayed_orders
    from order_rows
  ),
  quote_summary as (
    select
      coalesce(sum(grand_total) filter (
        where activity_date >= v_month_start
          and activity_date < v_next_month
          and status in ('approved_for_sending', 'sent', 'customer_approved')
      ), 0)::numeric as pipeline_value_mtd,
      count(*) filter (
        where activity_date >= v_month_start
          and activity_date < v_next_month
          and status not in ('draft', 'internal_review')
      )::integer as eligible_mtd,
      count(*) filter (
        where activity_date >= v_month_start
          and activity_date < v_next_month
          and status = 'converted_to_order'
      )::integer as converted_mtd
    from quote_rows
  ),
  dispatch_summary as (
    select
      coalesce(sum(total_weight_kg) filter (
        where dispatch_date >= v_month_start and dispatch_date < v_next_month
      ), 0)::numeric as dispatch_weight_mtd,
      count(*) filter (
        where dispatch_date >= v_month_start
          and dispatch_date < v_next_month
          and expected_dispatch_date is not null
      )::integer as dispatch_decision_count,
      count(*) filter (
        where dispatch_date >= v_month_start
          and dispatch_date < v_next_month
          and expected_dispatch_date is not null
          and dispatch_date <= expected_dispatch_date
      )::integer as on_time_count
    from dispatch_rows
  ),
  production_summary as (
    select
      coalesce(sum(planned_quantity_kg) filter (
        where planned_date >= v_month_start
          and planned_date < v_next_month
          and status <> 'cancelled'
      ), 0)::numeric as planned_kg_mtd,
      coalesce(sum(actual_quantity_kg) filter (
        where planned_date >= v_month_start
          and planned_date < v_next_month
          and status <> 'cancelled'
      ), 0)::numeric as actual_kg_mtd
    from production_rows
  ),
  invoice_summary as (
    select
      coalesce(sum(grand_total) filter (
        where invoice_date >= v_month_start
          and invoice_date < v_next_month
          and status in ('generated', 'sent', 'partially_paid', 'paid', 'overdue')
      ), 0)::numeric as invoiced_value_mtd,
      coalesce(sum(balance_due) filter (
        where status in ('generated', 'sent', 'partially_paid', 'overdue')
      ), 0)::numeric as receivable_outstanding,
      count(*) filter (
        where status in ('generated', 'sent', 'partially_paid', 'overdue')
          and balance_due > 0
          and due_date < p_as_of
      )::integer as overdue_invoices
    from invoice_rows
  ),
  payment_summary as (
    select coalesce(sum(amount) filter (
      where payment_date >= v_month_start and payment_date < v_next_month
    ), 0)::numeric as collections_mtd
    from payment_rows
  ),
  expense_summary as (
    select
      coalesce(sum(total_amount) filter (
        where activity_date >= v_month_start and activity_date < v_next_month
      ), 0)::numeric as expense_run_rate_mtd,
      coalesce(sum(amount_paid) filter (
        where activity_date >= v_month_start and activity_date < v_next_month
      ), 0)::numeric as expense_paid_mtd
    from expense_rows
  ),
  quality_summary as (
    select
      count(*) filter (
        where activity_date >= v_month_start
          and activity_date < v_next_month
          and status in ('approved', 'rejected', 'rework')
      )::integer as quality_decision_count,
      count(*) filter (
        where activity_date >= v_month_start
          and activity_date < v_next_month
          and status = 'approved'
      )::integer as approved_count
    from quality_rows
  ),
  inventory_summary as (
    select
      count(*) filter (where reorder_level > 0 and current_stock <= reorder_level)::integer as at_risk_count,
      count(*) filter (where current_stock <= 0)::integer as out_of_stock_count
    from public.inventory_items
    where company_id = v_company_id
  ),
  task_summary as (
    select
      count(*) filter (where status in ('open', 'in_progress'))::integer as open_tasks,
      count(*) filter (
        where status in ('open', 'in_progress') and priority in ('urgent', 'high')
      )::integer as urgent_open_tasks
    from public.tasks
    where company_id = v_company_id
  ),
  month_axis as (
    select month_start::date
    from generate_series(v_trend_start, v_month_start, interval '1 month') as month_start
  ),
  order_trend as (
    select date_trunc('month', order_date)::date as month_start, sum(order_value)::numeric as value
    from order_rows
    where order_date >= v_trend_start and order_date < v_next_month and current_stage <> 'cancelled'
    group by 1
  ),
  dispatch_trend as (
    select date_trunc('month', dispatch_date)::date as month_start, sum(total_weight_kg)::numeric as value
    from dispatch_rows
    where dispatch_date >= v_trend_start and dispatch_date < v_next_month
    group by 1
  ),
  invoice_trend as (
    select date_trunc('month', invoice_date)::date as month_start, sum(grand_total)::numeric as value
    from invoice_rows
    where invoice_date >= v_trend_start
      and invoice_date < v_next_month
      and status in ('generated', 'sent', 'partially_paid', 'paid', 'overdue')
    group by 1
  ),
  expense_trend as (
    select date_trunc('month', activity_date)::date as month_start, sum(total_amount)::numeric as value
    from expense_rows
    where activity_date >= v_trend_start and activity_date < v_next_month
    group by 1
  ),
  payment_trend as (
    select date_trunc('month', payment_date)::date as month_start, sum(amount)::numeric as value
    from payment_rows
    where payment_date < v_next_month
    group by 1
  ),
  trend_json as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'key', to_char(axis.month_start, 'YYYY-MM'),
        'label', to_char(axis.month_start, 'Mon YY'),
        'ordersValue', coalesce(orders.value, 0),
        'dispatchWeight', coalesce(dispatches.value, 0),
        'invoicedValue', coalesce(invoices.value, 0),
        'expenseValue', coalesce(expenses.value, 0),
        'collectionValue', coalesce(payments.value, 0)
      ) order by axis.month_start
    ), '[]'::jsonb) as value
    from month_axis axis
    left join order_trend orders using (month_start)
    left join dispatch_trend dispatches using (month_start)
    left join invoice_trend invoices using (month_start)
    left join expense_trend expenses using (month_start)
    left join payment_trend payments using (month_start)
  ),
  top_customer_json as (
    select coalesce(jsonb_agg(
      jsonb_build_object('name', ranked.name, 'orderCount', ranked.order_count, 'value', ranked.value)
      order by ranked.value desc, ranked.name
    ), '[]'::jsonb) as value
    from (
      select
        coalesce(nullif(c.company_name, ''), nullif(c.customer_name, ''), 'Unknown Customer') as name,
        count(*)::integer as order_count,
        sum(o.order_value)::numeric as value
      from order_rows o
      left join public.customers c
        on c.id = o.customer_id
       and c.company_id = v_company_id
      where o.current_stage <> 'cancelled'
      group by 1
      order by value desc, name
      limit 8
    ) ranked
  ),
  stage_json as (
    select coalesce(jsonb_agg(
      jsonb_build_object('stage', ranked.stage, 'count', ranked.count)
      order by ranked.count desc, ranked.stage
    ), '[]'::jsonb) as value
    from (
      select current_stage as stage, count(*)::integer as count
      from order_rows
      where current_stage not in ('delivered', 'closed', 'cancelled')
      group by current_stage
      order by count desc, stage
      limit 8
    ) ranked
  ),
  low_stock_json as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'itemCode', ranked.item_code,
        'itemName', ranked.item_name,
        'unit', ranked.unit,
        'currentStock', ranked.current_stock,
        'reorderLevel', ranked.reorder_level,
        'shortagePct', ranked.shortage_pct
      ) order by ranked.shortage_pct desc, ranked.item_code
    ), '[]'::jsonb) as value
    from (
      select
        coalesce(nullif(item_code, ''), '-') as item_code,
        coalesce(nullif(item_name, ''), '-') as item_name,
        coalesce(nullif(unit, ''), 'unit') as unit,
        coalesce(current_stock, 0)::numeric as current_stock,
        coalesce(reorder_level, 0)::numeric as reorder_level,
        greatest(0, ((reorder_level - current_stock) / reorder_level) * 100)::numeric as shortage_pct
      from public.inventory_items
      where company_id = v_company_id
        and reorder_level > 0
        and current_stock <= reorder_level
      order by shortage_pct desc, item_code
      limit 10
    ) ranked
  ),
  overdue_json as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'invoiceNumber', ranked.invoice_number,
        'customer', ranked.customer,
        'dueDate', ranked.due_date,
        'balanceDue', ranked.balance_due,
        'status', ranked.status
      ) order by ranked.balance_due desc, ranked.invoice_number
    ), '[]'::jsonb) as value
    from (
      select
        coalesce(nullif(i.invoice_number, ''), left(i.id::text, 8)) as invoice_number,
        coalesce(nullif(c.company_name, ''), nullif(c.customer_name, ''), 'Unknown Customer') as customer,
        i.due_date,
        i.balance_due,
        i.status
      from invoice_rows i
      left join public.customers c
        on c.id = i.customer_id
       and c.company_id = v_company_id
      where i.status in ('generated', 'sent', 'partially_paid', 'overdue')
        and i.balance_due > 0
        and i.due_date < p_as_of
      order by i.balance_due desc, invoice_number
      limit 8
    ) ranked
  ),
  scalar_values as (
    select
      os.*,
      qs.*,
      ds.*,
      ps.*,
      ins.*,
      pays.*,
      es.*,
      qls.*,
      ivs.*,
      ts.*
    from order_summary os
    cross join quote_summary qs
    cross join dispatch_summary ds
    cross join production_summary ps
    cross join invoice_summary ins
    cross join payment_summary pays
    cross join expense_summary es
    cross join quality_summary qls
    cross join inventory_summary ivs
    cross join task_summary ts
  )
  select jsonb_build_object(
    'kpis', jsonb_build_object(
      'bookedRevenueMtd', metrics.booked_revenue_mtd,
      'quotePipelineValueMtd', metrics.pipeline_value_mtd,
      'quoteConversionRateMtd', case when metrics.eligible_mtd > 0 then metrics.converted_mtd::numeric * 100 / metrics.eligible_mtd else 0 end,
      'activeOrders', metrics.active_orders,
      'delayedOrders', metrics.delayed_orders,
      'dispatchWeightMtd', metrics.dispatch_weight_mtd,
      'dispatchOnTimeRate', case when metrics.dispatch_decision_count > 0 then metrics.on_time_count::numeric * 100 / metrics.dispatch_decision_count else 0 end,
      'productionPlannedKgMtd', metrics.planned_kg_mtd,
      'productionActualKgMtd', metrics.actual_kg_mtd,
      'productionAttainmentPctMtd', case when metrics.planned_kg_mtd > 0 then metrics.actual_kg_mtd * 100 / metrics.planned_kg_mtd else 0 end,
      'receivableOutstanding', metrics.receivable_outstanding,
      'overdueInvoices', metrics.overdue_invoices,
      'invoicedValueMtd', metrics.invoiced_value_mtd,
      'collectionsMtd', metrics.collections_mtd,
      'expenseRunRateMtd', metrics.expense_run_rate_mtd,
      'expensePaidRateMtd', case when metrics.expense_run_rate_mtd > 0 then metrics.expense_paid_mtd * 100 / metrics.expense_run_rate_mtd else 0 end,
      'qualityPassRateMtd', case when metrics.quality_decision_count > 0 then metrics.approved_count::numeric * 100 / metrics.quality_decision_count else 0 end,
      'inventoryAtRiskCount', metrics.at_risk_count,
      'inventoryOutOfStockCount', metrics.out_of_stock_count,
      'openTasks', metrics.open_tasks,
      'urgentOpenTasks', metrics.urgent_open_tasks
    ),
    'trends', trends.value,
    'topCustomers', customers.value,
    'stageBacklog', stages.value,
    'lowStock', stock.value,
    'overdueInvoiceList', overdue.value,
    'risks', to_jsonb(array_remove(array[
      case when metrics.delayed_orders > 0 then metrics.delayed_orders || ' delayed orders need dispatch recovery.' end,
      case when metrics.overdue_invoices > 0 then metrics.overdue_invoices || ' overdue invoices need receivable follow-up.' end,
      case when metrics.at_risk_count > 0 then metrics.at_risk_count || ' inventory items are at or below reorder level.' end,
      case when metrics.urgent_open_tasks > 0 then metrics.urgent_open_tasks || ' urgent/high-priority tasks are still open.' end,
      case when metrics.planned_kg_mtd > 0 and metrics.actual_kg_mtd * 100 / metrics.planned_kg_mtd < 85 then 'Production attainment is below 85% of monthly plan.' end
    ], null))
  )
  into v_result
  from scalar_values metrics
  cross join trend_json trends
  cross join top_customer_json customers
  cross join stage_json stages
  cross join low_stock_json stock
  cross join overdue_json overdue;

  return v_result;
end;
$$;

revoke all on function public.get_advanced_analytics_snapshot(date, integer) from public, anon;
grant execute on function public.get_advanced_analytics_snapshot(date, integer) to authenticated;

create index if not exists orders_company_order_date_idx
  on public.orders(company_id, order_date) where deleted_at is null;
create index if not exists orders_company_expected_dispatch_active_idx
  on public.orders(company_id, expected_dispatch_date)
  where deleted_at is null and current_stage not in ('delivered', 'closed', 'cancelled');
create index if not exists quotes_company_quote_date_idx
  on public.quotes(company_id, quote_date) where deleted_at is null;
create index if not exists production_jobs_company_planned_date_idx
  on public.production_jobs(company_id, planned_date);
create index if not exists dispatches_company_dispatch_date_idx
  on public.dispatches(company_id, dispatch_date);
create index if not exists invoices_company_invoice_date_idx
  on public.invoices(company_id, invoice_date) where deleted_at is null;
create index if not exists invoices_company_due_open_idx
  on public.invoices(company_id, due_date)
  where deleted_at is null and status in ('generated', 'sent', 'partially_paid', 'overdue');
create index if not exists expense_ledger_company_invoice_date_idx
  on public.expense_ledger(company_id, invoice_date) where deleted_at is null;
create index if not exists quality_inspections_company_inspection_date_idx
  on public.quality_inspections(company_id, inspection_date);
create index if not exists tasks_company_status_priority_idx
  on public.tasks(company_id, status, priority);

commit;

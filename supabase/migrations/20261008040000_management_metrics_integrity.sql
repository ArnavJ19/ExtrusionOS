begin;

create or replace function private.metric_quote_is_open(p_status text, p_valid_until date, p_as_of date)
returns boolean language sql immutable set search_path = pg_catalog as $$
  select p_status in ('approved_for_sending', 'sent', 'customer_approved')
    and (p_valid_until is null or p_valid_until >= p_as_of);
$$;
revoke all on function private.metric_quote_is_open(text,date,date) from public, anon, authenticated;

-- All amounts are aggregated before presentation limits. A definer boundary is
-- necessary after protected base-column grants are removed; identity and every
-- tenant predicate are explicit rather than depending on an owner's RLS bypass.
create or replace function public.get_advanced_analytics_snapshot(
  p_as_of date default ((now() at time zone 'Asia/Kolkata')::date),
  p_months integer default 6
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private as $$
declare
  v_company_id uuid;
  v_role text;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_start date;
  v_end date;
  v_trend_start date;
  v_result jsonb;
begin
  select company_id, role::text into v_company_id, v_role
  from public.app_users where id = auth.uid() and is_active = true;
  if auth.uid() is null or v_company_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if v_role not in ('owner','admin','accounts','sales_manager') then
    raise exception 'Permission denied for management analytics' using errcode = '42501';
  end if;
  if p_as_of is null or p_as_of > v_today or p_months is null or p_months not between 1 and 24 then
    raise exception 'Use an as-of date through today and between 1 and 24 trend months' using errcode = '22023';
  end if;
  v_start := date_trunc('month', p_as_of)::date;
  v_end := p_as_of + 1;
  v_trend_start := (v_start - make_interval(months => p_months - 1))::date;

  with orders as materialized (
    select o.id, o.customer_id, o.order_date, coalesce(o.order_value,0) as value,
      o.current_stage, o.expected_dispatch_date
    from public.orders o where o.company_id = v_company_id and o.deleted_at is null
      and o.order_date < v_end
  ), quotes as materialized (
    select q.id, q.status, q.valid_until, coalesce(q.grand_total,0) as value,
      coalesce(q.quote_date, (q.created_at at time zone 'Asia/Kolkata')::date) as activity_date
    from public.quotes q where q.company_id = v_company_id and q.deleted_at is null
  ), shipments as materialized (
    select d.id, d.delivery_status, o.expected_dispatch_date,
      (d.actual_dispatched_at at time zone 'Asia/Kolkata')::date as movement_date,
      coalesce((select sum(p.net_weight_kg) from public.packing_list_items p
        where p.company_id = v_company_id and p.dispatch_id = d.id),0) as weight
    from public.dispatches d join public.orders o on o.id = d.order_id and o.company_id = d.company_id
    where d.company_id = v_company_id and o.deleted_at is null
      and d.delivery_status <> 'pending' and d.actual_dispatched_at is not null
      and exists (select 1 from public.packing_list_items p where p.company_id = v_company_id and p.dispatch_id = d.id and p.net_weight_kg > 0)
  ), production as materialized (
    select p.status, p.planned_date, (p.completed_at at time zone 'Asia/Kolkata')::date as completion_date,
      coalesce(p.planned_quantity_kg,0) as planned, coalesce(p.actual_quantity_kg,0) as actual
    from public.production_jobs p where p.company_id = v_company_id
  ), invoices as materialized (
    select i.id,i.customer_id,i.invoice_number,i.invoice_date,i.due_date,i.status,
      coalesce(i.grand_total,0) as value,coalesce(i.balance_due,0) as balance
    from public.invoices i where i.company_id = v_company_id and i.deleted_at is null
  ), expenses as materialized (
    select coalesce(e.invoice_date,(e.created_at at time zone 'Asia/Kolkata')::date) as activity_date,
      coalesce(e.total_amount,0) as value,coalesce(e.amount_paid,0) as paid
    from public.expense_ledger e where e.company_id = v_company_id and e.deleted_at is null
  ), collections as materialized (
    select payment_date,coalesce(amount,0) as value
    from public.get_financial_collection_events(v_trend_start)
  ), quality as materialized (
    select q.status,coalesce((q.inspection_date at time zone 'Asia/Kolkata')::date,(q.created_at at time zone 'Asia/Kolkata')::date) as activity_date
    from public.quality_inspections q where q.company_id = v_company_id
  ), stock as materialized (
    select i.id,i.item_code,i.item_name,i.unit,coalesce(i.current_stock,0) as current_stock,
      coalesce(i.reorder_level,0) as reorder_level,
      case when i.reorder_level > 0 then greatest(0,100 * (i.reorder_level - i.current_stock) / i.reorder_level) else 0 end as shortage_pct
    from public.inventory_items i where i.company_id = v_company_id and i.is_active = true
  ), metrics as (
    select
      (select coalesce(sum(value),0) from orders where order_date >= v_start and current_stage <> 'cancelled') as booked,
      (select count(*) from orders where current_stage not in ('delivered','closed','cancelled')) as active,
      (select count(*) from orders where current_stage not in ('delivered','closed','cancelled') and expected_dispatch_date < v_today) as delayed,
      (select coalesce(sum(value),0) from quotes where activity_date < v_end and private.metric_quote_is_open(status,valid_until,p_as_of)) as pipeline,
      (select count(*) from quotes where activity_date >= v_start and activity_date < v_end and status not in ('draft','internal_review')) as eligible,
      (select count(*) from quotes where activity_date >= v_start and activity_date < v_end and status = 'converted_to_order') as converted,
      (select coalesce(sum(weight),0) from shipments where movement_date >= v_start and movement_date < v_end) as shipped,
      (select count(*) from shipments where movement_date >= v_start and movement_date < v_end and expected_dispatch_date is not null) as shipment_decisions,
      (select count(*) from shipments where movement_date >= v_start and movement_date < v_end and movement_date <= expected_dispatch_date) as on_time,
      (select coalesce(sum(planned),0) from production where planned_date >= v_start and planned_date < v_end and status <> 'cancelled') as planned,
      (select coalesce(sum(actual),0) from production where completion_date >= v_start and completion_date < v_end and status = 'completed') as actual,
      (select coalesce(sum(value),0) from invoices where invoice_date >= v_start and invoice_date < v_end and status in ('generated','sent','partially_paid','paid','overdue','credited')) as invoiced,
      (select coalesce(sum(balance),0) from invoices where status in ('generated','sent','partially_paid','overdue')) as receivable,
      (select count(*) from invoices where status in ('generated','sent','partially_paid','overdue') and balance > 0 and due_date < v_today) as overdue,
      (select coalesce(sum(value),0) from collections where payment_date >= v_start and payment_date < v_end) as collected,
      (select coalesce(sum(value),0) from expenses where activity_date >= v_start and activity_date < v_end) as expense,
      (select coalesce(sum(paid),0) from expenses where activity_date >= v_start and activity_date < v_end) as expense_paid,
      (select count(*) from quality where activity_date >= v_start and activity_date < v_end and status in ('approved','rejected','rework')) as quality_decisions,
      (select count(*) from quality where activity_date >= v_start and activity_date < v_end and status = 'approved') as quality_approved,
      (select count(*) from stock where reorder_level > 0 and current_stock <= reorder_level) as low_stock,
      (select count(*) from stock where current_stock <= 0) as out_of_stock,
      (select count(*) from public.tasks t where t.company_id = v_company_id and t.status in ('open','in_progress')) as tasks,
      (select count(*) from public.tasks t where t.company_id = v_company_id and t.status in ('open','in_progress') and t.priority in ('urgent','high')) as urgent,
      (select count(*) from public.dispatches d where d.company_id = v_company_id and d.delivery_status <> 'pending'
        and (d.actual_dispatched_at is null or not exists (select 1 from public.packing_list_items p where p.company_id = v_company_id and p.dispatch_id = d.id and p.net_weight_kg > 0))) as unknown_shipments
  ), trends as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'key',to_char(axis.month_start,'YYYY-MM'),'label',to_char(axis.month_start,'Mon YY'),
      'ordersValue',(select coalesce(sum(value),0) from orders where order_date >= axis.month_start and order_date < least(axis.month_start + interval '1 month',v_end::timestamp) and current_stage <> 'cancelled'),
      'dispatchWeight',(select coalesce(sum(weight),0) from shipments where movement_date >= axis.month_start and movement_date < least(axis.month_start + interval '1 month',v_end::timestamp)),
      'invoicedValue',(select coalesce(sum(value),0) from invoices where invoice_date >= axis.month_start and invoice_date < least(axis.month_start + interval '1 month',v_end::timestamp) and status in ('generated','sent','partially_paid','paid','overdue','credited')),
      'expenseValue',(select coalesce(sum(value),0) from expenses where activity_date >= axis.month_start and activity_date < least(axis.month_start + interval '1 month',v_end::timestamp)),
      'collectionValue',(select coalesce(sum(value),0) from collections where payment_date >= axis.month_start and payment_date < least(axis.month_start + interval '1 month',v_end::timestamp))
    ) order by axis.month_start),'[]'::jsonb) as value
    from generate_series(v_trend_start::timestamp,v_start::timestamp,interval '1 month') axis(month_start)
  ), top_customers as (
    select coalesce(jsonb_agg(jsonb_build_object('customerId',r.customer_id,'name',r.name,'orderCount',r.orders,'value',r.value) order by r.value desc,r.customer_id),'[]'::jsonb) as value
    from (
      select o.customer_id,coalesce(nullif(c.company_name,''),nullif(c.customer_name,''),'Unknown Customer') as name,
        count(*) as orders,sum(o.value) as value
      from orders o left join public.customers c on c.id = o.customer_id and c.company_id = v_company_id
      where o.current_stage <> 'cancelled'
      group by o.customer_id,c.company_name,c.customer_name order by value desc,o.customer_id limit 8
    ) r
  ), stages as (
    select coalesce(jsonb_agg(jsonb_build_object('stage',r.current_stage,'count',r.count) order by r.count desc,r.current_stage),'[]'::jsonb) as value
    from (select current_stage,count(*) as count from orders where current_stage not in ('delivered','closed','cancelled') group by current_stage) r
  ), low_stock as (
    select coalesce(jsonb_agg(jsonb_build_object('itemCode',r.item_code,'itemName',r.item_name,'unit',r.unit,
      'currentStock',r.current_stock,'reorderLevel',r.reorder_level,'shortagePct',r.shortage_pct) order by r.shortage_pct desc,r.id),'[]'::jsonb) as value
    from (select * from stock where reorder_level > 0 and current_stock <= reorder_level order by shortage_pct desc,id limit 10) r
  ), overdue as (
    select coalesce(jsonb_agg(jsonb_build_object('invoiceNumber',r.invoice_number,'customer',r.customer,'dueDate',r.due_date,'balanceDue',r.balance,'status',r.status) order by r.balance desc,r.id),'[]'::jsonb) as value
    from (
      select i.*,coalesce(nullif(c.company_name,''),nullif(c.customer_name,''),'Unknown Customer') as customer
      from invoices i left join public.customers c on c.id = i.customer_id and c.company_id = v_company_id
      where i.status in ('generated','sent','partially_paid','overdue') and i.balance > 0 and i.due_date < v_today
      order by i.balance desc,i.id limit 8
    ) r
  )
  select jsonb_build_object(
    'dataQuality',jsonb_build_object('version','20261008','asOf',p_as_of,'generatedAt',now(),
      'currentStateAt',now(),'unknownShipmentCount',m.unknown_shipments),
    'kpis',jsonb_build_object(
      'bookedRevenueMtd',m.booked,'quotePipelineValueMtd',m.pipeline,'quoteConversionRateMtd',case when m.eligible > 0 then 100.0 * m.converted / m.eligible else 0 end,
      'activeOrders',m.active,'delayedOrders',m.delayed,'dispatchWeightMtd',m.shipped,'dispatchOnTimeRate',case when m.shipment_decisions > 0 then 100.0 * m.on_time / m.shipment_decisions else 0 end,
      'productionPlannedKgMtd',m.planned,'productionActualKgMtd',m.actual,'productionAttainmentPctMtd',case when m.planned > 0 then 100.0 * m.actual / m.planned else 0 end,
      'receivableOutstanding',m.receivable,'overdueInvoices',m.overdue,'invoicedValueMtd',m.invoiced,'collectionsMtd',m.collected,
      'expenseRunRateMtd',m.expense,'expensePaidRateMtd',case when m.expense > 0 then 100.0 * m.expense_paid / m.expense else 0 end,
      'qualityPassRateMtd',case when m.quality_decisions > 0 then 100.0 * m.quality_approved / m.quality_decisions else 0 end,
      'inventoryAtRiskCount',m.low_stock,'inventoryOutOfStockCount',m.out_of_stock,'openTasks',m.tasks,'urgentOpenTasks',m.urgent
    ),'trends',trends.value,'topCustomers',top_customers.value,'stageBacklog',stages.value,'lowStock',low_stock.value,'overdueInvoiceList',overdue.value,
    'risks',to_jsonb(array_remove(array[
      case when m.delayed > 0 then m.delayed || ' current delayed orders need dispatch recovery.' end,
      case when m.overdue > 0 then m.overdue || ' current overdue invoices need receivable follow-up.' end,
      case when m.low_stock > 0 then m.low_stock || ' inventory items are at or below reorder level.' end,
      case when m.urgent > 0 then m.urgent || ' urgent/high-priority tasks are still open.' end,
      case when m.unknown_shipments > 0 then m.unknown_shipments || ' activated shipments lack verified movement timestamps and are excluded from shipment metrics.' end,
      case when m.planned > 0 and m.actual * 100 / m.planned < 85 then 'Production attainment is below 85% of the plan through the as-of date.' end
    ],null))
  ) into v_result from metrics m cross join trends cross join top_customers cross join stages cross join low_stock cross join overdue;
  return v_result;
end;
$$;
revoke all on function public.get_advanced_analytics_snapshot(date,integer) from public,anon;
grant execute on function public.get_advanced_analytics_snapshot(date,integer) to authenticated;

create or replace function public.get_dashboard_snapshot(p_as_of date default ((now() at time zone 'Asia/Kolkata')::date))
returns jsonb language plpgsql security definer
set search_path = pg_catalog,public,private as $$
declare
  v_company uuid;
  v_role text;
  v_start date;
  v_end date;
  v_commercial boolean;
  v_production boolean;
  v_dispatch boolean;
  v_inventory boolean;
  v_quality boolean;
  v_dies boolean;
  v_result jsonb;
begin
  select company_id,role::text into v_company,v_role from public.app_users where id = auth.uid() and is_active = true;
  if auth.uid() is null or v_company is null or v_role not in ('owner','admin','sales_manager','sales','accounts','factory_manager','production_manager','production','inventory_manager','dispatch_manager','dispatch','quality','viewer') then
    raise exception 'Permission denied for dashboard' using errcode = '42501';
  end if;
  if p_as_of is null or p_as_of > (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'Use an as-of date through today' using errcode = '22023';
  end if;
  v_start := date_trunc('month',p_as_of)::date;
  v_end := p_as_of + 1;
  v_commercial := v_role in ('owner','admin','sales_manager','sales','accounts');
  v_production := v_role in ('owner','admin','factory_manager','production_manager','production','quality','viewer');
  v_dispatch := v_role in ('owner','admin','factory_manager','inventory_manager','dispatch_manager','dispatch','viewer');
  v_inventory := v_role in ('owner','admin','factory_manager','production_manager','production','inventory_manager','quality','viewer');
  v_quality := v_role in ('owner','admin','production_manager','quality','viewer');
  v_dies := v_role in ('owner','admin','production_manager','production','viewer');

  with orders as materialized (
    select o.id,o.order_number,o.customer_id,o.order_value,o.order_date,o.expected_dispatch_date,o.current_stage,o.priority
    from public.orders o where o.company_id = v_company and o.deleted_at is null and o.order_date < v_end
  ), quotes as materialized (
    select q.id,q.quote_number,q.grand_total,q.quote_date,q.status,q.valid_until,q.customer_id
    from public.quotes q where q.company_id = v_company and q.deleted_at is null and q.quote_date < v_end
  ), shortages as materialized (
    select i.id,i.item_code,i.item_name,i.unit,i.current_stock,i.reorder_level,
      100.0 * (i.reorder_level - i.current_stock) / i.reorder_level as severity
    from public.inventory_items i where i.company_id = v_company and i.is_active = true
      and i.reorder_level > 0 and i.current_stock <= i.reorder_level
  ), order_preview as (
    select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'order_number',r.order_number,'order_value',r.order_value,
      'order_date',r.order_date,'expected_dispatch_date',r.expected_dispatch_date,'current_stage',r.current_stage,'priority',r.priority,
      'customers',jsonb_build_object('customer_name',c.customer_name,'company_name',c.company_name)) order by r.order_date desc,r.id),'[]'::jsonb) as value
    from (select * from orders order by order_date desc,id limit 8) r
    left join public.customers c on c.id = r.customer_id and c.company_id = v_company
  ), quote_preview as (
    select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'quote_number',r.quote_number,'grand_total',r.grand_total,
      'quote_date',r.quote_date,'status',r.status,'customers',jsonb_build_object('customer_name',c.customer_name,'company_name',c.company_name)) order by r.quote_date desc,r.id),'[]'::jsonb) as value
    from (select * from quotes order by quote_date desc,id limit 5) r
    left join public.customers c on c.id = r.customer_id and c.company_id = v_company
  ), distribution as (
    select coalesce(jsonb_agg(jsonb_build_object('stage',r.current_stage,'count',r.count) order by r.current_stage),'[]'::jsonb) as value
    from (select current_stage,count(*) as count from orders where current_stage <> 'cancelled' group by current_stage) r
  )
  select jsonb_build_object(
    'version','20261008','asOf',p_as_of,'generatedAt',now(),
    'unknownShipmentCount',case when v_dispatch then (select count(*) from public.dispatches d where d.company_id = v_company and d.delivery_status <> 'pending' and (d.actual_dispatched_at is null or not exists (select 1 from public.packing_list_items p where p.company_id = v_company and p.dispatch_id = d.id and p.net_weight_kg > 0))) else 0 end,
    'quoteRows',case when v_commercial then quote_preview.value else '[]'::jsonb end,
    'orderRows',case when v_commercial then order_preview.value else '[]'::jsonb end,
    'monthlyQuoteValue',case when v_commercial then (select coalesce(sum(grand_total),0) from quotes where private.metric_quote_is_open(status,valid_until,p_as_of)) end,
    'monthlyOrderValue',case when v_commercial then (select coalesce(sum(order_value),0) from orders where order_date >= v_start and current_stage <> 'cancelled') end,
    'monthlyQuoteCount',case when v_commercial then (select count(*) from quotes where quote_date >= v_start) end,
    'monthlyOrderCount',case when v_commercial then (select count(*) from orders where order_date >= v_start and current_stage <> 'cancelled') end,
    'activeCustomerCount',case when v_commercial then (select count(distinct customer_id) from orders where order_date >= v_start and current_stage <> 'cancelled') end,
    'pendingQuoteCount',case when v_commercial then (select count(*) from quotes where private.metric_quote_is_open(status,valid_until,p_as_of)) end,
    'productionCount',case when v_production then (select count(*) from public.production_jobs p where p.company_id = v_company and p.status not in ('completed','cancelled')) end,
    'todayJobCount',case when v_production then (select count(*) from public.production_jobs p where p.company_id = v_company and p.planned_date = p_as_of and p.status not in ('completed','cancelled')) end,
    'pendingDispatchCount',case when v_dispatch then (select count(*) from orders where current_stage not in ('delivered','closed','cancelled')) end,
    'dispatchCount',case when v_dispatch then (select count(*) from public.dispatches d where d.company_id = v_company and d.delivery_status <> 'pending' and (d.actual_dispatched_at at time zone 'Asia/Kolkata')::date >= v_start and (d.actual_dispatched_at at time zone 'Asia/Kolkata')::date < v_end and exists (select 1 from public.packing_list_items p where p.company_id = v_company and p.dispatch_id = d.id and p.net_weight_kg > 0)) end,
    'dieCorrectionCount',case when v_dies then (select count(*) from public.dies d where d.company_id = v_company and d.die_status = 'correction') end,
    'qualityHoldCount',case when v_quality then (select count(*) from public.quality_inspections q where q.company_id = v_company
      and (q.status='rejected' or (q.status='rework' and not exists(select 1 from public.quality_rework_resolutions r
        where r.company_id=q.company_id and r.source_inspection_id=q.id)))) end,
    'delayedOrderCount',(select count(*) from orders where expected_dispatch_date < p_as_of and current_stage not in ('delivered','closed','cancelled')),
    'delayedOrders',coalesce((select jsonb_agg(r order by r.expected_dispatch_date,r.id) from (select id,order_number,expected_dispatch_date from orders where expected_dispatch_date < p_as_of and current_stage not in ('delivered','closed','cancelled') order by expected_dispatch_date,id limit 5) r),'[]'::jsonb),
    'lowInventoryCount',case when v_inventory then (select count(*) from shortages) end,
    'lowInventoryRows',case when v_inventory then coalesce((select jsonb_agg(to_jsonb(r) - 'severity' order by r.severity desc,r.id) from (select * from shortages order by severity desc,id limit 5) r),'[]'::jsonb) else '[]'::jsonb end,
    'orderStageDistribution',case when v_role in ('owner','admin') then distribution.value else '[]'::jsonb end
  ) into v_result from order_preview cross join quote_preview cross join distribution;
  return v_result;
end;
$$;
revoke all on function public.get_dashboard_snapshot(date) from public,anon;
grant execute on function public.get_dashboard_snapshot(date) to authenticated;

create index if not exists dispatches_company_actual_dispatch_idx on public.dispatches(company_id,actual_dispatched_at) where actual_dispatched_at is not null;
commit;

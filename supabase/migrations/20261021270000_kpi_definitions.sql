-- EXOS-AUD-028: management KPIs used inconsistent definitions. In
-- get_advanced_analytics_snapshot:
--   * Shipped kg (MTD and the monthly trend) counted returned and damaged
--     shipments. It now counts only activated shipments that were not returned
--     or damaged.
--   * Production attainment divided kg completed this month (any job) by kg
--     planned this month (a different job set). It now divides the completed kg
--     of the jobs planned this month by their planned kg
--     (productionPlannedJobsActualKgMtd is returned alongside).
-- The command-centre recovery and scrap figures are corrected in the app
-- (lib/command-center/metrics.ts); definitions are in docs/KPI_DICTIONARY.md.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.get_advanced_analytics_snapshot(p_as_of date DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata'::text))::date, p_months integer DEFAULT 6)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_company_id uuid;
  v_role text;
  v_finance boolean;
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
  v_finance := v_role in ('owner','admin','accounts');
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
      -- KPI dictionary: shipped kg = net kg of activated shipments that were not returned or damaged.
      case when d.delivery_status in ('returned','damaged') then 0 else
      coalesce((select sum(p.net_weight_kg) from public.packing_list_items p
        where p.company_id = v_company_id and p.dispatch_id = d.id),0) end as weight
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
      coalesce(i.grand_total,0) as value,coalesce(i.balance_due,0) as balance,
      coalesce(i.customer_credit_due,0) as credit_due
    from public.invoices i where i.company_id = v_company_id and i.deleted_at is null
  ), credit_notes as materialized (
    select n.credit_date, coalesce(n.grand_total,0) as value
    from public.credit_notes n where n.company_id = v_company_id and n.status = 'issued'
  ), expenses as materialized (
    -- Booked spend is approved and undeleted; legacy 'paid' approval labels mean approved.
    select coalesce(e.invoice_date,(e.created_at at time zone 'Asia/Kolkata')::date) as activity_date,
      coalesce(e.total_amount,0) as value,
      coalesce(e.amount_paid,0) - coalesce(e.refunded_amount,0) as paid,
      coalesce(nullif(e.currency,''),'INR') as currency,
      case when e.approval_status in ('approved','paid') then 'booked'
        when e.approval_status = 'pending_approval' then 'commitment' else 'excluded' end as stage
    from public.expense_ledger e where e.company_id = v_company_id and e.deleted_at is null
  ), collections as materialized (
    select p.payment_date, case when p.payment_type = 'REFUND' then -coalesce(p.amount,0) else coalesce(p.amount,0) end as value
    from public.payments p
    where p.company_id = v_company_id and p.payment_status = 'PAID' and p.payment_method <> 'credit_note'
      and p.payment_date >= v_trend_start
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
      -- KPI dictionary: attainment compares the same job set (jobs planned this month).
      (select coalesce(sum(actual),0) from production where planned_date >= v_start and planned_date < v_end and status = 'completed') as planned_actual,
      (select coalesce(sum(value),0) from invoices where invoice_date >= v_start and invoice_date < v_end and status in ('generated','sent','partially_paid','paid','overdue','credited')) as invoiced,
      (select coalesce(sum(value),0) from credit_notes where credit_date >= v_start and credit_date < v_end) as credited,
      (select coalesce(sum(balance),0) from invoices where status in ('generated','sent','partially_paid','overdue')) as receivable,
      (select count(*) from invoices where status in ('generated','sent','partially_paid','overdue') and balance > 0 and due_date < v_today) as overdue,
      (select coalesce(sum(credit_due),0) from invoices where credit_due > 0 and status <> 'cancelled') as credit_due,
      (select count(*) from invoices where credit_due > 0 and status <> 'cancelled') as credit_due_count,
      (select coalesce(sum(value),0) from collections where payment_date >= v_start and payment_date < v_end) as collected,
      (select coalesce(sum(value),0) from expenses where stage = 'booked' and currency = 'INR' and activity_date >= v_start and activity_date < v_end) as expense,
      (select coalesce(sum(paid),0) from expenses where stage = 'booked' and currency = 'INR' and activity_date >= v_start and activity_date < v_end) as expense_paid,
      (select coalesce(sum(value),0) from expenses where stage = 'commitment' and currency = 'INR') as commitments,
      (select count(*) from expenses where stage = 'booked' and currency <> 'INR' and activity_date >= v_start and activity_date < v_end) as non_inr,
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
      'creditNoteValue',(select coalesce(sum(value),0) from credit_notes where credit_date >= axis.month_start and credit_date < least(axis.month_start + interval '1 month',v_end::timestamp)),
      'expenseValue',case when v_finance then (select coalesce(sum(value),0) from expenses where stage = 'booked' and currency = 'INR' and activity_date >= axis.month_start and activity_date < least(axis.month_start + interval '1 month',v_end::timestamp)) else 0 end,
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
      where v_finance and i.status in ('generated','sent','partially_paid','overdue') and i.balance > 0 and i.due_date < v_today
      order by i.balance desc,i.id limit 8
    ) r
  ), credit_due_list as (
    select coalesce(jsonb_agg(jsonb_build_object('invoiceId',r.id,'invoiceNumber',r.invoice_number,'customer',r.customer,'creditDue',r.credit_due,'status',r.status) order by r.credit_due desc,r.id),'[]'::jsonb) as value
    from (
      select i.*,coalesce(nullif(c.company_name,''),nullif(c.customer_name,''),'Unknown Customer') as customer
      from invoices i left join public.customers c on c.id = i.customer_id and c.company_id = v_company_id
      where v_finance and i.credit_due > 0 and i.status <> 'cancelled'
      order by i.credit_due desc,i.id limit 8
    ) r
  ), currency_spend as (
    select coalesce(jsonb_agg(jsonb_build_object('currency',r.currency,'bookedMtd',r.value,'count',r.count) order by r.currency),'[]'::jsonb) as value
    from (
      select currency,sum(value) as value,count(*) as count from expenses
      where v_finance and stage = 'booked' and activity_date >= v_start and activity_date < v_end group by currency
    ) r
  )
  select jsonb_build_object(
    'dataQuality',jsonb_build_object('version','20261020','asOf',p_as_of,'generatedAt',now(),
      'currentStateAt',now(),'unknownShipmentCount',m.unknown_shipments,'financeDetail',v_finance),
    'kpis',jsonb_build_object(
      'bookedRevenueMtd',m.booked,'quotePipelineValueMtd',m.pipeline,'quoteConversionRateMtd',case when m.eligible > 0 then 100.0 * m.converted / m.eligible else 0 end,
      'activeOrders',m.active,'delayedOrders',m.delayed,'dispatchWeightMtd',m.shipped,'dispatchOnTimeRate',case when m.shipment_decisions > 0 then 100.0 * m.on_time / m.shipment_decisions else 0 end,
      'productionPlannedKgMtd',m.planned,'productionActualKgMtd',m.actual,'productionAttainmentPctMtd',case when m.planned > 0 then 100.0 * m.planned_actual / m.planned else 0 end,'productionPlannedJobsActualKgMtd',m.planned_actual,
      'receivableOutstanding',m.receivable,'overdueInvoices',m.overdue,'invoicedValueMtd',m.invoiced,
      'creditNotesMtd',m.credited,'netInvoicedMtd',m.invoiced - m.credited,'collectionsMtd',m.collected,
      'customerCreditDue',case when v_finance then m.credit_due else 0 end,'customerCreditDueCount',case when v_finance then m.credit_due_count else 0 end,
      'expenseRunRateMtd',case when v_finance then m.expense else 0 end,
      'expensePaidRateMtd',case when v_finance and m.expense > 0 then 100.0 * m.expense_paid / m.expense else 0 end,
      'expenseCommitments',case when v_finance then m.commitments else 0 end,
      'expenseNonInrCountMtd',case when v_finance then m.non_inr else 0 end,
      'qualityPassRateMtd',case when m.quality_decisions > 0 then 100.0 * m.quality_approved / m.quality_decisions else 0 end,
      'inventoryAtRiskCount',m.low_stock,'inventoryOutOfStockCount',m.out_of_stock,'openTasks',m.tasks,'urgentOpenTasks',m.urgent
    ),'trends',trends.value,'topCustomers',top_customers.value,'stageBacklog',stages.value,'lowStock',low_stock.value,
    'overdueInvoiceList',overdue.value,'customerCreditList',credit_due_list.value,'expenseByCurrency',currency_spend.value,
    'risks',to_jsonb(array_remove(array[
      case when m.delayed > 0 then m.delayed || ' current delayed orders need dispatch recovery.' end,
      case when m.overdue > 0 then m.overdue || ' current overdue invoices need receivable follow-up.' end,
      case when v_finance and m.credit_due_count > 0 then m.credit_due_count || ' invoices carry customer credit or refunds due.' end,
      case when m.low_stock > 0 then m.low_stock || ' inventory items are at or below reorder level.' end,
      case when m.urgent > 0 then m.urgent || ' urgent/high-priority tasks are still open.' end,
      case when m.unknown_shipments > 0 then m.unknown_shipments || ' activated shipments lack verified movement timestamps and are excluded from shipment metrics.' end,
      case when v_finance and m.non_inr > 0 then m.non_inr || ' foreign-currency expenses this month are reported separately and excluded from INR spend.' end,
      case when m.planned > 0 and m.planned_actual * 100 / m.planned < 85 then 'Production attainment is below 85% of the plan through the as-of date.' end
    ],null))
  ) into v_result from metrics m cross join trends cross join top_customers cross join stages cross join low_stock
    cross join overdue cross join credit_due_list cross join currency_spend;
  return v_result;
end;
$function$;

commit;

-- Profitability aging by order. get_profitability_summary joined each order's pay days and open invoice age onto every
-- order_cost_breakdown line, so an order with several cost lines was counted, and weighted in the averages, once per
-- line. settledRows / openRows are shown as order counts and the averages as order-level aging, so aging is now
-- aggregated over distinct orders (per dimension value, and for the totals) before it is joined to the cost rows.
-- Revenue, cost, margin, weight and row counts are unchanged. Replaces one function body; no table or data changes.

create or replace function public.get_profitability_summary(p_dimension text default 'customer')
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private as $$
declare
  v_company_id uuid;
  v_role text;
  v_result jsonb;
begin
  select company_id, role::text into v_company_id, v_role from public.app_users where id = auth.uid() and is_active = true;
  if auth.uid() is null or v_company_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if v_role not in ('owner', 'admin', 'accounts') then
    raise exception 'Permission denied for profitability' using errcode = '42501';
  end if;
  if p_dimension is null or p_dimension not in ('customer','profile','die','salesperson','category','finishing','branch','month') then
    raise exception 'Unsupported profitability dimension' using errcode = '22023';
  end if;

  with base as materialized (
    select b.order_id, coalesce(b.revenue, 0) as revenue, coalesce(b.total_weight_kg, 0) as weight,
      coalesce(b.scrap_cost, 0) as scrap,
      -- Any unknown component makes the row's cost unknown; it is never treated as zero.
      (b.material_cost is null or b.conversion_cost is null or b.finishing_cost is null or b.packing_cost is null
        or b.transport_cost is null or b.scrap_cost is null or b.energy_cost is null or b.die_cost_allocated is null
        or b.overhead_cost is null or b.other_cost is null or b.revenue is null) as incomplete,
      coalesce(b.material_cost,0) + coalesce(b.conversion_cost,0) + coalesce(b.finishing_cost,0) + coalesce(b.packing_cost,0)
        + coalesce(b.transport_cost,0) + coalesce(b.scrap_cost,0) + coalesce(b.energy_cost,0) + coalesce(b.die_cost_allocated,0)
        + coalesce(b.overhead_cost,0) + coalesce(b.other_cost,0) as known_cost,
      coalesce(nullif(btrim(case p_dimension
        when 'customer' then b.customer_name when 'profile' then b.profile_name when 'die' then b.die_code
        when 'salesperson' then b.salesperson when 'category' then b.product_category when 'finishing' then b.finishing_type
        when 'branch' then b.branch else b.month_key end), ''), 'Unassigned') as dimension_key
    from public.order_cost_breakdown b
    where b.company_id = v_company_id
  ), settled as materialized (
    -- Pay days are measured from posted receipts: invoice date to the settling receipt date.
    select i.order_id, avg(i.paid_date - i.invoice_date)::numeric as pay_days
    from public.invoices i
    where i.company_id = v_company_id and i.status = 'paid' and i.paid_date is not null and i.invoice_date is not null
      and i.order_id is not null
    group by i.order_id
  ), outstanding as materialized (
    select i.order_id, avg(private.business_today() - i.invoice_date)::numeric as open_age
    from public.invoices i
    where i.company_id = v_company_id and i.status in ('generated','sent','partially_paid','overdue') and i.balance_due > 0
      and i.invoice_date is not null and i.order_id is not null
    group by i.order_id
  ), rows as materialized (
    select b.* from base b
  ), group_orders as materialized (
    -- Aging is per order. order_cost_breakdown can hold several cost lines for one order, so each order is counted once
    -- per dimension value (and once in the totals) before its pay days or open age are averaged.
    select distinct b.dimension_key, b.order_id from base b where b.order_id is not null
  ), group_aging as (
    select g.dimension_key, avg(s.pay_days) as avg_pay_days, count(s.pay_days) as settled_count,
      avg(o.open_age) as avg_open_age, count(o.open_age) as open_count
    from group_orders g
    left join settled s on s.order_id = g.order_id
    left join outstanding o on o.order_id = g.order_id
    group by g.dimension_key
  ), total_aging as (
    select avg(s.pay_days) as avg_pay_days, count(s.pay_days) as settled_count,
      avg(o.open_age) as avg_open_age, count(o.open_age) as open_count
    from (select distinct order_id from base where order_id is not null) d
    left join settled s on s.order_id = d.order_id
    left join outstanding o on o.order_id = d.order_id
  ), line_groups as (
    select dimension_key, count(*) as row_count,
      count(*) filter (where incomplete) as incomplete_count,
      sum(revenue) as revenue,
      sum(revenue) filter (where not incomplete) as complete_revenue,
      sum(known_cost) filter (where not incomplete) as total_cost,
      sum(revenue - known_cost) filter (where not incomplete) as margin,
      sum(scrap) as scrap_cost, sum(weight) as weight_kg
    from rows group by dimension_key
  ), groups as (
    select l.*, a.avg_pay_days, coalesce(a.settled_count, 0) as settled_count, a.avg_open_age, coalesce(a.open_count, 0) as open_count
    from line_groups l left join group_aging a on a.dimension_key = l.dimension_key
  )
  select jsonb_build_object(
    'dimension', p_dimension,
    'totals', (select jsonb_build_object(
      'rows', count(*), 'incompleteRows', count(*) filter (where incomplete),
      'revenue', coalesce(sum(revenue), 0), 'completeRevenue', coalesce(sum(revenue) filter (where not incomplete), 0),
      'totalCost', coalesce(sum(known_cost) filter (where not incomplete), 0),
      'margin', coalesce(sum(revenue - known_cost) filter (where not incomplete), 0),
      'weightKg', coalesce(sum(weight), 0), 'scrapCost', coalesce(sum(scrap), 0),
      'avgPayDays', (select round(avg_pay_days, 1) from total_aging), 'settledRows', (select settled_count from total_aging),
      'avgOpenAgeDays', (select round(avg_open_age, 1) from total_aging), 'openRows', (select open_count from total_aging)) from rows),
    'groups', coalesce((select jsonb_agg(jsonb_build_object(
      'key', dimension_key, 'rows', row_count, 'incompleteRows', incomplete_count, 'revenue', revenue,
      'completeRevenue', coalesce(complete_revenue, 0), 'totalCost', coalesce(total_cost, 0), 'margin', coalesce(margin, 0),
      'marginPct', case when coalesce(complete_revenue, 0) > 0 then round(100.0 * margin / complete_revenue, 2) end,
      'scrapCost', scrap_cost, 'weightKg', weight_kg,
      'avgPayDays', round(avg_pay_days, 1), 'settledRows', settled_count,
      'avgOpenAgeDays', round(avg_open_age, 1), 'openRows', open_count) order by revenue desc, dimension_key)
      from groups), '[]'::jsonb),
    'generatedAt', now()
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.get_profitability_summary(text) from public, anon;
grant execute on function public.get_profitability_summary(text) to authenticated;

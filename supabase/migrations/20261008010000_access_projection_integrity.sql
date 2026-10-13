begin;

alter table public.customers enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.profile_stock_reservations enable row level security;
alter table public.company_settings enable row level security;

-- Replace every effective policy on the audited relationship tables. PostgreSQL
-- combines permissive policies with OR, so dropping known names is not enough.
do $$
declare t text; p record;
begin
  foreach t in array array['customers','quotes','quote_items','orders','order_items'] loop
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
  end loop;
end;
$$;

create policy customers_access_read on public.customers for select using (
  auth.uid() is not null
  and company_id = private.get_current_user_company_id()
  and (
    private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts','production_manager','factory_manager','dispatch_manager','dispatch','inventory_manager','quality','viewer')
    or (
      private.get_current_user_role() in ('dealer_admin','dealer_staff')
      and exists (
        select 1 from public.quotes q
        where q.company_id = customers.company_id and q.customer_id = customers.id
          and q.dealer_id = private.get_current_user_dealer_id()
      )
      or private.get_current_user_role() in ('dealer_admin','dealer_staff')
      and exists (
        select 1 from public.orders o
        where o.company_id = customers.company_id and o.customer_id = customers.id
          and o.dealer_id = private.get_current_user_dealer_id()
      )
    )
  )
);
create policy customers_access_insert on public.customers for insert with check (
  auth.uid() is not null and company_id = private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner','admin','sales_manager','sales')
);
create policy customers_access_update on public.customers for update using (
  auth.uid() is not null and company_id = private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner','admin','sales_manager','sales')
) with check (
  company_id = private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner','admin','sales_manager','sales')
);
create policy customers_access_delete on public.customers for delete using (
  auth.uid() is not null and company_id = private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner','admin')
);

create policy quotes_access_read on public.quotes for select using (
  auth.uid() is not null and company_id = private.get_current_user_company_id()
  and (
    private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts','viewer')
    or (private.get_current_user_role() in ('dealer_admin','dealer_staff') and dealer_id = private.get_current_user_dealer_id())
  )
);
create policy quotes_access_insert on public.quotes for insert with check (
  auth.uid() is not null and company_id = private.get_current_user_company_id()
  and (
    private.get_current_user_role() in ('owner','admin','sales_manager','sales')
    or (private.get_current_user_role() in ('dealer_admin','dealer_staff') and dealer_id = private.get_current_user_dealer_id())
  )
);
create policy quotes_access_update on public.quotes for update using (
  auth.uid() is not null and company_id = private.get_current_user_company_id()
  and (
    private.get_current_user_role() in ('owner','admin','sales_manager','sales')
    or (private.get_current_user_role() in ('dealer_admin','dealer_staff') and dealer_id = private.get_current_user_dealer_id())
  )
) with check (
  company_id = private.get_current_user_company_id()
  and (
    private.get_current_user_role() in ('owner','admin','sales_manager','sales')
    or (private.get_current_user_role() in ('dealer_admin','dealer_staff') and dealer_id = private.get_current_user_dealer_id())
  )
);
create policy quotes_access_delete on public.quotes for delete using (
  auth.uid() is not null and company_id = private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner','admin')
);

create policy quote_items_access_read on public.quote_items for select using (
  auth.uid() is not null and company_id = private.get_current_user_company_id()
  and exists (
    select 1 from public.quotes q where q.id = quote_items.quote_id and q.company_id = quote_items.company_id
      and (private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts','viewer')
        or (private.get_current_user_role() in ('dealer_admin','dealer_staff') and q.dealer_id = private.get_current_user_dealer_id()))
  )
);
create policy quote_items_access_insert on public.quote_items for insert with check (
  auth.uid() is not null and company_id = private.get_current_user_company_id()
  and exists (
    select 1 from public.quotes q where q.id = quote_items.quote_id and q.company_id = quote_items.company_id
      and (private.get_current_user_role() in ('owner','admin','sales_manager','sales')
        or (private.get_current_user_role() in ('dealer_admin','dealer_staff') and q.dealer_id = private.get_current_user_dealer_id()))
  )
);
create policy quote_items_access_update on public.quote_items for update using (
  auth.uid() is not null and company_id = private.get_current_user_company_id()
  and exists (
    select 1 from public.quotes q where q.id = quote_items.quote_id and q.company_id = quote_items.company_id
      and (private.get_current_user_role() in ('owner','admin','sales_manager','sales')
        or (private.get_current_user_role() = 'dealer_admin' and q.dealer_id = private.get_current_user_dealer_id()))
  )
) with check (
  company_id = private.get_current_user_company_id()
  and exists (
    select 1 from public.quotes q where q.id = quote_items.quote_id and q.company_id = quote_items.company_id
      and (private.get_current_user_role() in ('owner','admin','sales_manager','sales')
        or (private.get_current_user_role() = 'dealer_admin' and q.dealer_id = private.get_current_user_dealer_id()))
  )
);
create policy quote_items_access_delete on public.quote_items for delete using (
  auth.uid() is not null and company_id = private.get_current_user_company_id()
  and exists (
    select 1 from public.quotes q where q.id = quote_items.quote_id and q.company_id = quote_items.company_id
      and (private.get_current_user_role() in ('owner','admin','sales_manager','sales')
        or (private.get_current_user_role() = 'dealer_admin' and q.dealer_id = private.get_current_user_dealer_id()))
  )
);

create policy orders_access_read on public.orders for select using (
  auth.uid() is not null and company_id = private.get_current_user_company_id()
  and (
    private.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager','production','factory_manager','dispatch_manager','dispatch','inventory_manager','accounts','quality','viewer')
    or (private.get_current_user_role() in ('dealer_admin','dealer_staff') and dealer_id = private.get_current_user_dealer_id())
  )
);
create policy orders_access_insert on public.orders for insert with check (
  auth.uid() is not null and company_id = private.get_current_user_company_id()
  and (
    private.get_current_user_role() in ('owner','admin','sales_manager','sales')
    or (private.get_current_user_role() in ('dealer_admin','dealer_staff') and dealer_id = private.get_current_user_dealer_id())
  )
);
create policy orders_access_update on public.orders for update using (
  auth.uid() is not null and company_id = private.get_current_user_company_id()
  and (
    private.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager','factory_manager','dispatch_manager','dispatch')
    or (private.get_current_user_role() = 'inventory_manager')
    or (private.get_current_user_role() in ('dealer_admin','dealer_staff') and dealer_id = private.get_current_user_dealer_id())
  )
) with check (
  company_id = private.get_current_user_company_id()
  and (
    private.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager','factory_manager','dispatch_manager','dispatch','inventory_manager')
    or (private.get_current_user_role() in ('dealer_admin','dealer_staff') and dealer_id = private.get_current_user_dealer_id())
  )
);
create policy orders_access_delete on public.orders for delete using (
  auth.uid() is not null and company_id = private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner','admin')
);

create policy order_items_access_read on public.order_items for select using (
  auth.uid() is not null and company_id = private.get_current_user_company_id()
  and exists (
    select 1 from public.orders o where o.id = order_items.order_id and o.company_id = order_items.company_id
      and (private.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager','production','factory_manager','dispatch_manager','dispatch','inventory_manager','accounts','quality','viewer')
        or (private.get_current_user_role() in ('dealer_admin','dealer_staff') and o.dealer_id = private.get_current_user_dealer_id()))
  )
);
create policy order_items_access_insert on public.order_items for insert with check (
  auth.uid() is not null and company_id = private.get_current_user_company_id()
  and exists (
    select 1 from public.orders o where o.id = order_items.order_id and o.company_id = order_items.company_id
      and (private.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager','factory_manager')
        or (private.get_current_user_role() in ('dealer_admin','dealer_staff') and o.dealer_id = private.get_current_user_dealer_id()))
  )
);
create policy order_items_access_update on public.order_items for update using (
  auth.uid() is not null and company_id = private.get_current_user_company_id()
  and exists (
    select 1 from public.orders o where o.id = order_items.order_id and o.company_id = order_items.company_id
      and (private.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager','factory_manager','dispatch_manager','dispatch','inventory_manager')
        or (private.get_current_user_role() = 'dealer_admin' and o.dealer_id = private.get_current_user_dealer_id()))
  )
) with check (
  company_id = private.get_current_user_company_id()
  and exists (
    select 1 from public.orders o where o.id = order_items.order_id and o.company_id = order_items.company_id
      and (private.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager','factory_manager','dispatch_manager','dispatch','inventory_manager')
        or (private.get_current_user_role() = 'dealer_admin' and o.dealer_id = private.get_current_user_dealer_id()))
  )
);
create policy order_items_access_delete on public.order_items for delete using (
  auth.uid() is not null and company_id = private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner','admin','sales_manager','sales')
  and exists (select 1 from public.orders o where o.id = order_items.order_id and o.company_id = order_items.company_id)
);

-- Role-safe, fixed-column projections. These owner-run views have explicit
-- tenant, active-user, role, and dealer-ownership predicates because base RLS is
-- bypassed by their owner. New table columns never enter these projections.
create or replace view public.orders_authorized with (security_barrier = true) as
select
  o.id, o.company_id, o.order_number, o.quote_id, o.customer_id, o.order_date,
  o.expected_dispatch_date, o.priority, o.current_stage,
  case when private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts')
         or (private.get_current_user_role() in ('dealer_admin','dealer_staff') and o.dealer_id = private.get_current_user_dealer_id())
       then o.order_value else null end as order_value,
  case when private.get_current_user_role() not in ('dealer_admin','dealer_staff') then o.notes end as notes,
  o.created_at, o.updated_at, o.created_by, o.deleted_at, o.deleted_by,
  o.dealer_id, o.requested_weight_kg, o.dealer_fulfilled_weight_kg,
  o.manufacturing_weight_kg,
  case when private.get_current_user_role() not in ('dealer_admin','dealer_staff') then o.fulfillment_notes end as fulfillment_notes,
  o.production_profile_id,
  o.production_die_id, o.production_quantity_kg,
  case when private.get_current_user_role() in ('owner','admin','production_manager','production','factory_manager','dispatch_manager','dispatch','inventory_manager','quality') then o.production_notes end as production_notes,
  o.production_pieces, o.billet_diameter_required_inch, o.billets_required,
  o.billets_allocated, o.billets_short, o.billet_allocation_status,
  o.branch_id, o.plant_id, o.created_by_user_id, o.created_by_role,
  o.created_by_organization_type, o.created_by_dealership_id, o.order_origin,
  cu.customer_name, cu.company_name,
  q.quote_number, q.revision_number as quote_revision_number,
  p.profile_code as production_profile_code, p.profile_name as production_profile_name,
  d.die_number as production_die_number
from public.orders o
left join public.customers cu on cu.id=o.customer_id and cu.company_id=o.company_id
left join public.quotes q on q.id=o.quote_id and q.company_id=o.company_id
left join public.aluminium_profiles p on p.id=o.production_profile_id and p.company_id=o.company_id
left join public.dies d on d.id=o.production_die_id and d.company_id=o.company_id
where auth.uid() is not null
  and o.company_id = private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager','production','factory_manager','dispatch_manager','dispatch','inventory_manager','accounts','quality','viewer','dealer_admin','dealer_staff')
  and (private.get_current_user_role() not in ('dealer_admin','dealer_staff') or o.dealer_id = private.get_current_user_dealer_id());

create or replace view public.order_items_authorized with (security_barrier = true) as
select
  i.id, i.company_id, i.order_id, i.profile_id, i.die_id, i.item_description,
  i.quantity_pieces, i.length_per_piece_m, i.total_meters, i.created_at, i.updated_at,
  i.source_record_id, i.source_line_id, i.section_number, i.section_code, i.section_name,
  i.customer_component_code, i.component_description, i.drawing_document_id,
  i.drawing_revision, i.drawing_approval_status, i.alloy_standard_id, i.alloy_id, i.temper_id,
  i.cl_uom, i.cl_per_uom, i.cl_meter, i.order_uom, i.order_quantity, i.quantity_kg,
  i.section_weight_kg_per_m, i.min_weight, i.max_weight, i.weight_tolerance,
  i.quantity_calculation_method, i.packing_mode_id, i.invoice_calc_uom, i.standard_length,
  i.cut_length, i.bundle_quantity, i.packing_instruction, i.customer_packing_requirement,
  i.packing_in_conversion, i.include_packing_in_basic, i.input_billet_weight,
  i.output_good_weight, i.rejected_weight, i.rework_weight, i.packing_weight,
  i.freight_weight, i.theoretical_weight, i.actual_weight, i.revision_number,
  i.hsn_code, i.quote_item_id, i.finishing_type, i.dealer_fulfilled_weight_kg,
  i.manufacturing_weight_kg,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.material_price end as material_price,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.value_added_service_price end as value_added_service_price,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.other_charges end as other_charges,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.basic_price end as basic_price,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.packing_charge end as packing_charge,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.freight_charge end as freight_charge,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.alloy_surcharge_per_kg end as alloy_surcharge_per_kg,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.re_cutting_charge_per_kg end as re_cutting_charge_per_kg,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.testing_service_charge_per_kg end as testing_service_charge_per_kg,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.die_cost end as die_cost,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.die_service_charge end as die_service_charge,
  case when private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts')
         or (private.get_current_user_role() in ('dealer_admin','dealer_staff') and o.dealer_id = private.get_current_user_dealer_id())
       then i.gst_percent end as gst_percent,
  case when private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts')
         or (private.get_current_user_role() in ('dealer_admin','dealer_staff') and o.dealer_id = private.get_current_user_dealer_id())
       then i.discount end as discount,
  case when private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts')
         or (private.get_current_user_role() in ('dealer_admin','dealer_staff') and o.dealer_id = private.get_current_user_dealer_id())
       then i.net_rate end as net_rate,
  case when private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts')
         or (private.get_current_user_role() in ('dealer_admin','dealer_staff') and o.dealer_id = private.get_current_user_dealer_id())
       then i.final_line_value end as final_line_value,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.margin end as margin,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.internal_cost end as internal_cost,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.supplier_rate end as supplier_rate,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.internal_note end as internal_note
from public.order_items i
join public.orders o on o.id = i.order_id and o.company_id = i.company_id
where auth.uid() is not null
  and i.company_id = private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager','production','factory_manager','dispatch_manager','dispatch','inventory_manager','accounts','quality','viewer','dealer_admin','dealer_staff')
  and (private.get_current_user_role() not in ('dealer_admin','dealer_staff') or o.dealer_id = private.get_current_user_dealer_id());

create or replace view public.quotes_authorized with (security_barrier = true) as
select
  q.id, q.company_id, q.quote_number, q.customer_id, q.quote_date, q.valid_until,
  q.status,
  case when private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts')
         or (private.get_current_user_role() in ('dealer_admin','dealer_staff') and q.dealer_id = private.get_current_user_dealer_id())
       then q.subtotal end as subtotal,
  case when private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts')
         or (private.get_current_user_role() in ('dealer_admin','dealer_staff') and q.dealer_id = private.get_current_user_dealer_id())
       then q.total_before_gst end as total_before_gst,
  case when private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts')
         or (private.get_current_user_role() in ('dealer_admin','dealer_staff') and q.dealer_id = private.get_current_user_dealer_id())
       then q.gst_percent end as gst_percent,
  case when private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts')
         or (private.get_current_user_role() in ('dealer_admin','dealer_staff') and q.dealer_id = private.get_current_user_dealer_id())
       then q.gst_amount end as gst_amount,
  case when private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts')
         or (private.get_current_user_role() in ('dealer_admin','dealer_staff') and q.dealer_id = private.get_current_user_dealer_id())
       then q.grand_total end as grand_total,
  q.terms_and_conditions, q.delivery_timeline, q.payment_terms,
  case when private.get_current_user_role() not in ('dealer_admin','dealer_staff') then q.notes end as notes,
  q.pdf_url,
  q.revision_number, q.low_margin_approval_required, q.approved_by, q.approved_at,
  case when private.get_current_user_role() in ('owner','admin','accounts') then q.total_margin_amount end as total_margin_amount,
  case when private.get_current_user_role() in ('owner','admin','accounts') then q.estimated_profit_amount end as estimated_profit_amount,
  case when private.get_current_user_role() in ('owner','admin','accounts') then q.estimated_profit_percent end as estimated_profit_percent,
  case when private.get_current_user_role() in ('owner','admin','accounts') then q.approval_notes end as approval_notes,
  q.sent_at, q.customer_decision_at, q.created_at, q.updated_at,
  q.created_by, q.deleted_at, q.deleted_by, q.dealer_id
from public.quotes q
where auth.uid() is not null
  and q.company_id = private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts','viewer','dealer_admin','dealer_staff')
  and (private.get_current_user_role() not in ('dealer_admin','dealer_staff') or q.dealer_id = private.get_current_user_dealer_id());

create or replace view public.quote_items_authorized with (security_barrier = true) as
select
  i.id, i.company_id, i.quote_id, i.profile_id, i.die_id, i.item_description,
  i.quantity_pieces, i.length_per_piece_m, i.total_meters, i.section_weight_kg_per_m,
  i.total_weight_kg, i.finishing_type, i.finishing_charge_type, i.costing_complete, i.created_at, i.updated_at,
  i.source_record_id, i.source_line_id, i.section_number, i.section_code, i.section_name,
  i.customer_component_code, i.component_description, i.drawing_document_id,
  i.drawing_revision, i.drawing_approval_status, i.alloy_standard_id, i.alloy_id, i.temper_id,
  i.cl_uom, i.cl_per_uom, i.cl_meter, i.order_uom, i.order_quantity, i.quantity_kg,
  i.min_weight, i.max_weight, i.weight_tolerance, i.quantity_calculation_method,
  i.packing_mode_id, i.invoice_calc_uom, i.standard_length, i.cut_length,
  i.bundle_quantity, i.packing_instruction, i.customer_packing_requirement,
  i.scrap_allowance_percent, i.expected_recovery_percent, i.effective_weight_kg,
  i.minimum_billing_weight_kg, i.billing_weight_kg, i.die_amortization_type,
  i.die_amortization_quantity_kg, i.packing_in_conversion, i.include_packing_in_basic,
  i.input_billet_weight, i.output_good_weight, i.rejected_weight, i.rework_weight,
  i.packing_weight, i.freight_weight, i.theoretical_weight, i.actual_weight, i.revision_number,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.billet_rate_per_kg end as billet_rate_per_kg,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.conversion_charge_per_kg end as conversion_charge_per_kg,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.finishing_charge end as finishing_charge,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.die_amortization_amount end as die_amortization_amount,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.packing_charge end as packing_charge,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.transport_charge end as transport_charge,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.other_charges end as other_charges,
  case when private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts')
         or (private.get_current_user_role() in ('dealer_admin','dealer_staff') and q.dealer_id = private.get_current_user_dealer_id())
       then i.sales_price_override end as sales_price_override,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.line_subtotal end as line_subtotal,
  case when private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts')
         or (private.get_current_user_role() in ('dealer_admin','dealer_staff') and q.dealer_id = private.get_current_user_dealer_id())
       then i.line_total_before_gst end as line_total_before_gst,
  case when private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts')
         or (private.get_current_user_role() in ('dealer_admin','dealer_staff') and q.dealer_id = private.get_current_user_dealer_id())
       then i.price_per_kg end as price_per_kg,
  case when private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts')
         or (private.get_current_user_role() in ('dealer_admin','dealer_staff') and q.dealer_id = private.get_current_user_dealer_id())
       then i.price_per_meter end as price_per_meter,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.material_price end as material_price,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.value_added_service_price end as value_added_service_price,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.basic_price end as basic_price,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.freight_charge end as freight_charge,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.alloy_surcharge_per_kg end as alloy_surcharge_per_kg,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.re_cutting_charge_per_kg end as re_cutting_charge_per_kg,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.testing_service_charge_per_kg end as testing_service_charge_per_kg,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.die_cost end as die_cost,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.die_service_charge end as die_service_charge,
  case when private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts')
         or (private.get_current_user_role() in ('dealer_admin','dealer_staff') and q.dealer_id = private.get_current_user_dealer_id())
       then i.gst_percent end as gst_percent,
  case when private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts')
         or (private.get_current_user_role() in ('dealer_admin','dealer_staff') and q.dealer_id = private.get_current_user_dealer_id())
       then i.discount end as discount,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.margin_percent end as margin_percent,
  case when private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts')
         or (private.get_current_user_role() in ('dealer_admin','dealer_staff') and q.dealer_id = private.get_current_user_dealer_id())
       then i.net_rate end as net_rate,
  case when private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts')
         or (private.get_current_user_role() in ('dealer_admin','dealer_staff') and q.dealer_id = private.get_current_user_dealer_id())
       then i.final_line_value end as final_line_value,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.raw_material_cost end as raw_material_cost,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.conversion_cost end as conversion_cost,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.finishing_cost end as finishing_cost,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.die_charge end as die_charge,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.margin_amount end as margin_amount,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.minimum_margin_percent end as minimum_margin_percent,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.approval_required end as approval_required,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.estimated_profit_amount end as estimated_profit_amount,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.estimated_profit_percent end as estimated_profit_percent,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.internal_cost end as internal_cost,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.supplier_rate end as supplier_rate,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.internal_note end as internal_note
from public.quote_items i
join public.quotes q on q.id = i.quote_id and q.company_id = i.company_id
where auth.uid() is not null
  and i.company_id = private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts','viewer','dealer_admin','dealer_staff')
  and (private.get_current_user_role() not in ('dealer_admin','dealer_staff') or q.dealer_id = private.get_current_user_dealer_id());

create or replace view public.order_dealer_stock_fulfillments_authorized with (security_barrier = true) as
select
  f.id, f.company_id, f.order_id, f.quote_id, f.quote_item_id, f.order_item_id,
  f.profile_id, f.profile_stock_batch_id, f.finishing_type,
  case when private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts')
         or (private.get_current_user_role() in ('dealer_admin','dealer_staff') and o.dealer_id = private.get_current_user_dealer_id())
       then f.unit_rate end as unit_rate,
  case when private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts')
         or (private.get_current_user_role() in ('dealer_admin','dealer_staff') and o.dealer_id = private.get_current_user_dealer_id())
       then f.quoted_line_value end as quoted_line_value,
  f.fulfilled_weight_kg, f.fulfilled_length_m, f.fulfilled_pieces,
  case when private.get_current_user_role() not in ('dealer_admin','dealer_staff') then f.notes end as notes,
  f.created_by, f.created_at, f.credited_at
from public.order_dealer_stock_fulfillments f
join public.orders o on o.id=f.order_id and o.company_id=f.company_id
where auth.uid() is not null and f.company_id=private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager','production','factory_manager','dispatch_manager','dispatch','inventory_manager','accounts','quality','viewer','dealer_admin','dealer_staff')
  and (private.get_current_user_role() not in ('dealer_admin','dealer_staff') or o.dealer_id=private.get_current_user_dealer_id());

create or replace view public.system_configurations_authorized with (security_barrier = true) as
select
  c.id, c.company_id, c.customer_id, c.series_id, c.width_mm, c.height_mm, c.no_of_panels,
  c.finish_type, c.glass_type, c.hardware_type,
  case when private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts') then c.calculated_price end as calculated_price,
  case when private.get_current_user_role() in ('owner','admin','accounts') then c.bom_json end as bom_json,
  case when private.get_current_user_role() in ('owner','admin','accounts') then c.cutting_list_json end as cutting_list_json,
  c.created_at, c.created_by, c.configuration_number, c.project_name, c.quote_id, c.order_id,
  c.system_type, c.template_id, c.design_reference, c.location_label, c.quantity,
  c.measurement_type, c.view_direction, c.panel_layout_json,
  case when private.get_current_user_role() in ('owner','admin','accounts') then c.options_json end as options_json,
  c.finish_id, c.glass_id, c.status,
  case when private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts') then c.subtotal end as subtotal,
  case when private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts') then c.gst_percent end as gst_percent,
  case when private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts') then c.gst_amount end as gst_amount,
  case when private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts') then c.grand_total end as grand_total,
  case when private.get_current_user_role() in ('owner','admin','accounts') then c.margin_percent end as margin_percent,
  case when private.get_current_user_role() in ('owner','admin','accounts') then c.internal_cost end as internal_cost,
  case when private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts') then c.selling_price end as selling_price,
  c.notes, c.updated_at
from public.system_configurations c
where auth.uid() is not null
  and c.company_id = private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager','production','factory_manager','inventory_manager','accounts','viewer');

create or replace view public.system_templates_authorized with (security_barrier = true) as
select t.id, t.company_id, t.template_code, t.template_name, t.system_type, t.series_id,
  t.formula_version,
  case when private.get_current_user_role() in ('owner','admin','accounts') then t.formula_json end as formula_json,
  case when private.get_current_user_role() in ('owner','admin','accounts') then t.validation_rules_json end as validation_rules_json,
  case when private.get_current_user_role() in ('owner','admin','accounts') then t.preview_config_json end as preview_config_json,
  t.is_default, t.is_active, t.created_at, t.updated_at, t.created_by
from public.system_templates t
where auth.uid() is not null and t.company_id=private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager','production','factory_manager','inventory_manager','accounts','viewer');

create or replace view public.system_material_summary_authorized with (security_barrier = true) as
select s.id, s.company_id, s.configuration_id, s.material_type, s.item_id, s.item_code,
  s.item_name, s.quantity, s.unit, s.total_weight_kg, s.total_length_m,
  s.total_area_sqft, s.total_area_sqm,
  case when private.get_current_user_role() in ('owner','admin','accounts') then s.rate end as rate,
  case when private.get_current_user_role() in ('owner','admin','accounts') then s.amount end as amount,
  s.created_at
from public.system_material_summary s
join public.system_configurations c on c.id=s.configuration_id and c.company_id=s.company_id
where auth.uid() is not null and s.company_id=private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager','production','factory_manager','inventory_manager','accounts','viewer');

create or replace view public.system_glass_cuts_authorized with (security_barrier = true) as
select g.id, g.company_id, g.configuration_id, g.glass_id, g.panel_index, g.glass_label,
  g.width_mm, g.height_mm, g.quantity, g.area_sqft, g.area_sqm, g.glass_type,
  g.thickness_mm,
  case when private.get_current_user_role() in ('owner','admin','accounts') then g.rate end as rate,
  case when private.get_current_user_role() in ('owner','admin','accounts') then g.amount end as amount,
  g.deduction_width_mm, g.deduction_height_mm, g.remarks, g.created_at
from public.system_glass_cuts g
join public.system_configurations c on c.id=g.configuration_id and c.company_id=g.company_id
where auth.uid() is not null and g.company_id=private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager','production','factory_manager','inventory_manager','accounts','viewer');

create or replace view public.system_hardware_bom_authorized with (security_barrier = true) as
select h.id, h.company_id, h.configuration_id, h.hardware_item_id, h.item_code, h.item_name,
  h.hardware_category, h.quantity, h.unit,
  case when private.get_current_user_role() in ('owner','admin','accounts') then h.rate end as rate,
  case when private.get_current_user_role() in ('owner','admin','accounts') then h.amount end as amount,
  h.remarks, h.created_at
from public.system_hardware_bom h
join public.system_configurations c on c.id=h.configuration_id and c.company_id=h.company_id
where auth.uid() is not null and h.company_id=private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager','production','factory_manager','inventory_manager','accounts','viewer');

create or replace view public.glass_items_authorized with (security_barrier = true) as
select g.id, g.company_id, g.glass_code, g.glass_name, g.glass_type, g.thickness_mm,
  g.composition,
  case when private.get_current_user_role() in ('owner','admin','accounts') then g.rate_per_sqft end as rate_per_sqft,
  case when private.get_current_user_role() in ('owner','admin','accounts') then g.rate_per_sqm end as rate_per_sqm,
  g.is_active, g.created_at, g.updated_at
from public.glass_items g
where auth.uid() is not null and g.company_id=private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager','production','factory_manager','inventory_manager','accounts','viewer');

create or replace view public.finish_options_authorized with (security_barrier = true) as
select f.id, f.company_id, f.finish_code, f.finish_name, f.finish_type, f.color_code,
  f.rate_type,
  case when private.get_current_user_role() in ('owner','admin','accounts') then f.rate end as rate,
  f.vendor_id, f.is_active, f.created_at, f.updated_at
from public.finish_options f
where auth.uid() is not null and f.company_id=private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager','production','factory_manager','inventory_manager','accounts','viewer');

create or replace view public.hardware_items_authorized with (security_barrier = true) as
select h.id, h.company_id, h.item_code, h.item_name, h.hardware_category, h.description, h.unit,
  case when private.get_current_user_role() in ('owner','admin','accounts') then h.default_rate end as default_rate,
  h.brand, h.finish, h.image_url, h.is_active, h.created_at, h.updated_at
from public.hardware_items h
where auth.uid() is not null and h.company_id=private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager','production','factory_manager','inventory_manager','accounts','viewer');

create or replace view public.company_settings_authorized with (security_barrier = true) as
select s.id, s.company_id, s.default_gst_percent,
  case when private.get_current_user_role() in ('owner','admin','accounts') then s.default_margin_percent end as default_margin_percent,
  case when private.get_current_user_role() in ('owner','admin','accounts') then s.default_conversion_charge_per_kg end as default_conversion_charge_per_kg,
  case when private.get_current_user_role() in ('owner','admin','accounts') then s.default_packing_charge end as default_packing_charge,
  case when private.get_current_user_role() in ('owner','admin','accounts') then s.default_transport_charge end as default_transport_charge,
  s.default_quote_validity_days, s.default_quote_terms, s.bank_details, s.signature_url,
  s.quote_prefix, s.order_prefix, s.dispatch_prefix, s.invoice_prefix,
  case when private.get_current_user_role() in ('owner','admin','accounts') then s.minimum_margin_percent end as minimum_margin_percent,
  case when private.get_current_user_role() in ('owner','admin','accounts') then s.require_approval_below_margin end as require_approval_below_margin,
  s.default_payment_terms, s.default_delivery_terms, s.default_bank_details,
  s.default_terms_and_conditions, s.enable_customer_portal, s.enable_inventory,
  s.enable_quality, s.enable_payments, s.created_at, s.updated_at, s.default_branch_id
from public.company_settings s
where auth.uid() is not null and s.company_id=private.get_current_user_company_id();

create or replace view public.production_jobs_authorized with (security_barrier = true) as
select
  p.id, p.company_id, p.order_id, p.machine_id, p.die_id, p.profile_id, p.job_number,
  p.planned_date, p.shift, p.planned_quantity_kg, p.actual_quantity_kg,
  p.planned_meters, p.actual_meters, p.status, p.operator_name, p.remarks,
  p.created_at, p.updated_at, p.completed_at, p.branch_id, p.plant_id, p.created_by,
  p.pieces, p.extrusion_efficiency_percent, p.required_billet_count, p.length_per_piece_m,
  p.actual_pieces, p.finishing_type,
  p.source_record_id, p.source_line_id, p.section_number, p.section_code, p.section_name,
  p.customer_component_code, p.component_description, p.drawing_document_id,
  p.drawing_revision, p.drawing_approval_status, p.alloy_standard_id, p.alloy_id, p.temper_id,
  p.cl_uom, p.cl_per_uom, p.cl_meter, p.order_uom, p.order_quantity, p.quantity_kg,
  p.section_weight_kg_per_m, p.min_weight, p.max_weight, p.weight_tolerance,
  p.quantity_calculation_method, p.packing_mode_id, p.invoice_calc_uom, p.standard_length,
  p.cut_length, p.bundle_quantity, p.pieces_per_m_per_kg_per_bundle,
  p.packing_instruction, p.customer_packing_requirement, p.packing_in_conversion,
  p.include_packing_in_basic, p.input_billet_weight, p.output_good_weight,
  p.rejected_weight, p.rework_weight, p.packing_weight, p.freight_weight,
  p.theoretical_weight, p.actual_weight, p.revision_number,
  case when private.get_current_user_role() in ('owner','admin','accounts') then p.material_price end as material_price,
  case when private.get_current_user_role() in ('owner','admin','accounts') then p.value_added_service_price end as value_added_service_price,
  case when private.get_current_user_role() in ('owner','admin','accounts') then p.basic_price end as basic_price,
  case when private.get_current_user_role() in ('owner','admin','accounts') then p.freight_charge end as freight_charge,
  case when private.get_current_user_role() in ('owner','admin','accounts') then p.alloy_surcharge_per_kg end as alloy_surcharge_per_kg,
  case when private.get_current_user_role() in ('owner','admin','accounts') then p.re_cutting_charge_per_kg end as re_cutting_charge_per_kg,
  case when private.get_current_user_role() in ('owner','admin','accounts') then p.testing_service_charge_per_kg end as testing_service_charge_per_kg,
  case when private.get_current_user_role() in ('owner','admin','accounts') then p.die_cost end as die_cost,
  case when private.get_current_user_role() in ('owner','admin','accounts') then p.die_service_charge end as die_service_charge,
  case when private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts') then p.gst_percent end as gst_percent,
  case when private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts') then p.discount end as discount,
  case when private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts') then p.net_rate end as net_rate,
  case when private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts') then p.final_line_value end as final_line_value,
  case when private.get_current_user_role() in ('owner','admin','accounts') then p.margin end as margin,
  case when private.get_current_user_role() in ('owner','admin','accounts') then p.internal_cost end as internal_cost,
  case when private.get_current_user_role() in ('owner','admin','accounts') then p.supplier_rate end as supplier_rate,
  case when private.get_current_user_role() in ('owner','admin','accounts') then p.internal_note end as internal_note
from public.production_jobs p
where auth.uid() is not null and p.company_id=private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager','production','factory_manager','dispatch_manager','dispatch','inventory_manager','accounts','quality','viewer');

create or replace view public.packing_list_items_authorized with (security_barrier = true) as
select
  p.id, p.company_id, p.dispatch_id, p.profile_id, p.bundle_number, p.number_of_pieces,
  p.gross_weight_kg, p.tare_weight_kg, p.net_weight_kg, p.notes, p.created_at,
  p.source_kind, p.reservation_id, p.profile_stock_batch_id,
  p.source_record_id, p.source_line_id, p.section_number, p.section_code, p.section_name,
  p.customer_component_code, p.component_description, p.drawing_document_id,
  p.drawing_revision, p.drawing_approval_status, p.alloy_standard_id, p.alloy_id, p.temper_id,
  p.cl_uom, p.cl_per_uom, p.cl_meter, p.order_uom, p.order_quantity, p.quantity_kg,
  p.min_weight, p.max_weight, p.weight_tolerance, p.quantity_calculation_method,
  p.packing_mode_id, p.invoice_calc_uom, p.standard_length, p.cut_length, p.bundle_quantity,
  p.pieces_per_bundle, p.meter_per_bundle, p.kg_per_bundle, p.packing_instruction,
  p.customer_packing_requirement, p.packing_in_conversion, p.include_packing_in_basic,
  p.input_billet_weight, p.output_good_weight, p.rejected_weight, p.rework_weight,
  p.packing_weight, p.freight_weight, p.theoretical_weight, p.actual_weight, p.revision_number,
  case when private.get_current_user_role() in ('owner','admin','accounts') then p.material_price end as material_price,
  case when private.get_current_user_role() in ('owner','admin','accounts') then p.value_added_service_price end as value_added_service_price,
  case when private.get_current_user_role() in ('owner','admin','accounts') then p.basic_price end as basic_price,
  case when private.get_current_user_role() in ('owner','admin','accounts') then p.freight_charge end as freight_charge,
  case when private.get_current_user_role() in ('owner','admin','accounts') then p.alloy_surcharge_per_kg end as alloy_surcharge_per_kg,
  case when private.get_current_user_role() in ('owner','admin','accounts') then p.re_cutting_charge_per_kg end as re_cutting_charge_per_kg,
  case when private.get_current_user_role() in ('owner','admin','accounts') then p.testing_service_charge_per_kg end as testing_service_charge_per_kg,
  case when private.get_current_user_role() in ('owner','admin','accounts') then p.die_cost end as die_cost,
  case when private.get_current_user_role() in ('owner','admin','accounts') then p.die_service_charge end as die_service_charge,
  case when private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts') then p.gst_percent end as gst_percent,
  case when private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts') then p.discount end as discount,
  case when private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts') then p.net_rate end as net_rate,
  case when private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts') then p.final_line_value end as final_line_value,
  case when private.get_current_user_role() in ('owner','admin','accounts') then p.margin end as margin,
  case when private.get_current_user_role() in ('owner','admin','accounts') then p.internal_cost end as internal_cost,
  case when private.get_current_user_role() in ('owner','admin','accounts') then p.supplier_rate end as supplier_rate,
  case when private.get_current_user_role() in ('owner','admin','accounts') then p.internal_note end as internal_note
from public.packing_list_items p
where auth.uid() is not null and p.company_id=private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager','production','factory_manager','dispatch_manager','dispatch','inventory_manager','accounts','quality','viewer');

create or replace view public.invoice_items_authorized with (security_barrier = true) as
select i.id, i.company_id, i.invoice_id, i.order_item_id, i.profile_id, i.die_id,
  i.item_description, i.quantity, i.hsn_code, i.created_at, i.updated_at,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.unit_rate end as unit_rate,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.line_total end as line_total,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.material_price end as material_price,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.value_added_service_price end as value_added_service_price,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.basic_price end as basic_price,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.freight_charge end as freight_charge,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.alloy_surcharge_per_kg end as alloy_surcharge_per_kg,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.re_cutting_charge_per_kg end as re_cutting_charge_per_kg,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.testing_service_charge_per_kg end as testing_service_charge_per_kg,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.die_cost end as die_cost,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.die_service_charge end as die_service_charge,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.gst_percent end as gst_percent,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.discount end as discount,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.margin end as margin,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.net_rate end as net_rate,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.final_line_value end as final_line_value,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.internal_cost end as internal_cost,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.supplier_rate end as supplier_rate,
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.internal_note end as internal_note
from public.invoice_items i
where auth.uid() is not null and i.company_id=private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner','admin','accounts');

revoke all on public.orders_authorized, public.order_items_authorized, public.quotes_authorized, public.quote_items_authorized,
  public.order_dealer_stock_fulfillments_authorized,
  public.system_configurations_authorized, public.system_material_summary_authorized,
  public.system_templates_authorized,
  public.system_glass_cuts_authorized, public.system_hardware_bom_authorized,
  public.glass_items_authorized, public.finish_options_authorized, public.hardware_items_authorized,
  public.company_settings_authorized, public.production_jobs_authorized,
  public.packing_list_items_authorized, public.invoice_items_authorized
  from public, anon, authenticated;
grant select on public.orders_authorized, public.order_items_authorized, public.quotes_authorized, public.quote_items_authorized,
  public.order_dealer_stock_fulfillments_authorized,
  public.system_configurations_authorized, public.system_material_summary_authorized,
  public.system_templates_authorized,
  public.system_glass_cuts_authorized, public.system_hardware_bom_authorized,
  public.glass_items_authorized, public.finish_options_authorized, public.hardware_items_authorized,
  public.company_settings_authorized, public.production_jobs_authorized,
  public.packing_list_items_authorized, public.invoice_items_authorized to authenticated;

-- Revoke table-wide grants before granting explicit safe columns. Restricted
-- columns stay unavailable through direct PostgREST selection for every user.
revoke select on public.orders, public.order_items, public.quotes, public.quote_items from public, anon, authenticated;
grant select (
  id, company_id, order_number, quote_id, customer_id, order_date,
  expected_dispatch_date, priority, current_stage, created_at, updated_at,
  created_by, deleted_at, deleted_by, dealer_id, requested_weight_kg,
  dealer_fulfilled_weight_kg, manufacturing_weight_kg,
  production_profile_id, production_die_id, production_quantity_kg,
  production_pieces, billet_diameter_required_inch,
  billets_required, billets_allocated, billets_short, billet_allocation_status,
  branch_id, plant_id, created_by_user_id, created_by_role,
  created_by_organization_type, created_by_dealership_id, order_origin
) on public.orders to authenticated;
grant select (
  id, company_id, order_id, profile_id, die_id, item_description,
  quantity_pieces, length_per_piece_m, total_meters, created_at, updated_at,
  source_record_id, source_line_id, section_number, section_code, section_name,
  customer_component_code, component_description, drawing_document_id,
  drawing_revision, drawing_approval_status, alloy_standard_id, alloy_id, temper_id,
  cl_uom, cl_per_uom, cl_meter, order_uom, order_quantity, quantity_kg,
  section_weight_kg_per_m, min_weight, max_weight, weight_tolerance,
  quantity_calculation_method, packing_mode_id, invoice_calc_uom, standard_length,
  cut_length, bundle_quantity, packing_instruction, customer_packing_requirement,
  packing_in_conversion, include_packing_in_basic, input_billet_weight,
  output_good_weight, rejected_weight, rework_weight, packing_weight,
  freight_weight, theoretical_weight, actual_weight, revision_number, hsn_code,
  quote_item_id, finishing_type, dealer_fulfilled_weight_kg, manufacturing_weight_kg
) on public.order_items to authenticated;
grant select (id, company_id, customer_id, dealer_id, status) on public.quotes to authenticated;
grant select (id, company_id, quote_id) on public.quote_items to authenticated;

-- Accounts may inspect calculation inputs needed to reconcile costing and PDFs.
-- These additive SELECT policies remain company-scoped and confer no write access.
do $$
declare t text;
begin
  foreach t in array array['system_series','system_profiles','system_profile_cuts','system_beading_cuts','profile_optimization_runs'] loop
    execute format('drop policy if exists accounts_costing_read on public.%I', t);
    execute format('create policy accounts_costing_read on public.%I for select to authenticated using (auth.uid() is not null and company_id = private.get_current_user_company_id() and private.get_current_user_role() = ''accounts'')', t);
  end loop;
end;
$$;

revoke select on public.order_dealer_stock_fulfillments from public, anon, authenticated;
grant select (
  id, company_id, order_id, quote_id, quote_item_id, order_item_id,
  profile_id, profile_stock_batch_id, finishing_type, fulfilled_weight_kg,
  fulfilled_length_m, fulfilled_pieces, created_by, created_at, credited_at
) on public.order_dealer_stock_fulfillments to authenticated;

revoke select on public.system_configurations, public.system_material_summary,
  public.system_glass_cuts, public.system_hardware_bom, public.glass_items,
  public.finish_options, public.hardware_items, public.system_templates from public, anon, authenticated;
grant select (id) on public.system_configurations, public.system_material_summary,
  public.system_glass_cuts, public.system_hardware_bom, public.glass_items,
  public.finish_options, public.hardware_items, public.system_templates to authenticated;
revoke select on public.production_jobs, public.packing_list_items, public.invoice_items from public, anon, authenticated;
grant select (
  id, company_id, order_id, machine_id, die_id, profile_id, job_number, planned_date,
  shift, planned_quantity_kg, actual_quantity_kg, planned_meters, actual_meters, status,
  operator_name, remarks, created_at, updated_at, completed_at, branch_id, plant_id, created_by, pieces,
  extrusion_efficiency_percent, required_billet_count, length_per_piece_m, actual_pieces, finishing_type, source_record_id,
  source_line_id, section_number, section_code, section_name, customer_component_code,
  component_description, drawing_document_id, drawing_revision, drawing_approval_status,
  alloy_standard_id, alloy_id, temper_id, cl_uom, cl_per_uom, cl_meter, order_uom,
  order_quantity, quantity_kg, section_weight_kg_per_m, min_weight, max_weight,
  weight_tolerance, quantity_calculation_method, packing_mode_id, invoice_calc_uom,
  standard_length, cut_length, bundle_quantity, pieces_per_m_per_kg_per_bundle,
  packing_instruction, customer_packing_requirement, packing_in_conversion,
  include_packing_in_basic, input_billet_weight, output_good_weight, rejected_weight,
  rework_weight, packing_weight, freight_weight, theoretical_weight, actual_weight, revision_number
) on public.production_jobs to authenticated;
grant select (
  id, company_id, dispatch_id, profile_id, bundle_number, number_of_pieces,
  gross_weight_kg, tare_weight_kg, net_weight_kg, notes, created_at, source_record_id,
  source_line_id, source_kind, reservation_id, profile_stock_batch_id, section_number, section_code, section_name, customer_component_code,
  component_description, drawing_document_id, drawing_revision, drawing_approval_status,
  alloy_standard_id, alloy_id, temper_id, cl_uom, cl_per_uom, cl_meter, order_uom,
  order_quantity, quantity_kg, min_weight, max_weight, weight_tolerance,
  quantity_calculation_method, packing_mode_id, invoice_calc_uom, standard_length,
  cut_length, bundle_quantity, pieces_per_bundle, meter_per_bundle, kg_per_bundle,
  packing_instruction, customer_packing_requirement, packing_in_conversion,
  include_packing_in_basic, input_billet_weight, output_good_weight, rejected_weight,
  rework_weight, packing_weight, freight_weight, theoretical_weight, actual_weight, revision_number
) on public.packing_list_items to authenticated;
grant select (id, company_id, invoice_id, order_item_id, profile_id, die_id, item_description, quantity, hsn_code, created_at, updated_at)
on public.invoice_items to authenticated;
revoke select on public.company_settings from public, anon, authenticated;
grant select (
  id, company_id, default_gst_percent, default_quote_validity_days, default_quote_terms,
  bank_details, signature_url, quote_prefix, order_prefix, dispatch_prefix, invoice_prefix,
  default_payment_terms, default_delivery_terms, default_bank_details,
  default_terms_and_conditions, enable_customer_portal, enable_inventory, enable_quality,
  enable_payments, created_at, updated_at, default_branch_id
) on public.company_settings to authenticated;

create or replace function private.guard_quote_cost_writes()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if auth.uid() is null or private.get_current_user_role() in ('owner','admin') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if private.get_current_user_role() not in ('owner','admin') then
    raise exception 'Only owners and admins may create or change priced quote lines' using errcode='42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.guard_quote_cost_writes() from public, anon, authenticated;
drop trigger if exists a_guard_quote_cost_writes on public.quote_items;
create trigger a_guard_quote_cost_writes before insert or update or delete on public.quote_items
for each row execute function private.guard_quote_cost_writes();

-- Order writes use checked SECURITY DEFINER workflows. Reject direct
-- authenticated table writes so broad operational UPDATE grants cannot be used
-- for blind edits to commercial totals, line costs, or workflow identity.
create or replace function private.guard_order_workflow_writes()
returns trigger language plpgsql set search_path = public, private as $$
declare
  v_role text := private.get_current_user_role();
begin
  if auth.uid() is null or v_role in ('owner','admin') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if current_user = 'authenticated' then
    raise exception 'Orders must be created or changed through an authorized order workflow' using errcode='42501';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Only owners and admins may delete orders' using errcode='42501';
  end if;
  if tg_op = 'UPDATE' and (
    new.company_id is distinct from old.company_id
    or new.order_number is distinct from old.order_number
    or new.quote_id is distinct from old.quote_id
    or new.customer_id is distinct from old.customer_id
    or new.dealer_id is distinct from old.dealer_id
    or new.order_date is distinct from old.order_date
    or new.order_value is distinct from old.order_value
    or new.requested_weight_kg is distinct from old.requested_weight_kg
    or new.manufacturing_weight_kg is distinct from old.manufacturing_weight_kg
    or new.production_profile_id is distinct from old.production_profile_id
    or new.production_die_id is distinct from old.production_die_id
    or new.production_quantity_kg is distinct from old.production_quantity_kg
    or new.production_pieces is distinct from old.production_pieces
    or new.billet_diameter_required_inch is distinct from old.billet_diameter_required_inch
  ) then
    raise exception 'Order value, source, identity, and production requirements cannot be changed through the operational order workflow' using errcode='42501';
  end if;
  if tg_op = 'INSERT' and v_role in ('production','production_manager','factory_manager','dispatch_manager','dispatch','inventory_manager')
    and new.quote_id is null and coalesce(new.order_value, 0) <> 0 then
    raise exception 'Operational order creation cannot set a manual commercial value; use an approved quote' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_order_workflow_writes() from public, anon, authenticated;
drop trigger if exists a_guard_order_workflow_writes on public.orders;
drop trigger if exists z_guard_order_workflow_writes on public.orders;
create trigger z_guard_order_workflow_writes before insert or update or delete on public.orders
for each row execute function private.guard_order_workflow_writes();

create or replace function private.guard_order_item_workflow_writes()
returns trigger language plpgsql set search_path = public, private as $$
declare
  v_role text := private.get_current_user_role();
begin
  if auth.uid() is null or v_role in ('owner','admin') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op <> 'INSERT' or current_user = 'authenticated' then
    raise exception 'Order lines must be created or changed through an authorized order workflow' using errcode='42501';
  end if;
  if new.quote_item_id is null or new.source_line_id is distinct from new.quote_item_id or not exists (
    select 1 from public.quote_items qi
    join public.orders o on o.id=new.order_id and o.company_id=new.company_id
    where qi.id=new.quote_item_id and qi.company_id=new.company_id
      and qi.quote_id=o.quote_id
  ) then
    raise exception 'Operational order lines must preserve the approved quote line source' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_order_item_workflow_writes() from public, anon, authenticated;
drop trigger if exists a_guard_order_item_workflow_writes on public.order_items;
drop trigger if exists z_guard_order_item_workflow_writes on public.order_items;
create trigger z_guard_order_item_workflow_writes before insert or update or delete on public.order_items
for each row execute function private.guard_order_item_workflow_writes();

create or replace function private.guard_quote_header_cost_writes()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if auth.uid() is null or private.get_current_user_role() in ('owner','admin') then return new; end if;
  if tg_op = 'INSERT' then
    if coalesce(new.subtotal,0) <> 0 or coalesce(new.total_before_gst,0) <> 0
      or coalesce(new.gst_amount,0) <> 0 or coalesce(new.grand_total,0) <> 0
      or coalesce(new.total_margin_amount,0) <> 0 or coalesce(new.estimated_profit_amount,0) <> 0
      or coalesce(new.estimated_profit_percent,0) <> 0 then
      raise exception 'Only owners and admins may set priced quote totals' using errcode='42501';
    end if;
    return new;
  end if;
  if new.subtotal is distinct from old.subtotal
    or new.total_before_gst is distinct from old.total_before_gst
    or new.gst_amount is distinct from old.gst_amount
    or new.grand_total is distinct from old.grand_total
    or new.total_margin_amount is distinct from old.total_margin_amount
    or new.estimated_profit_amount is distinct from old.estimated_profit_amount
    or new.estimated_profit_percent is distinct from old.estimated_profit_percent then
    raise exception 'Only owners and admins may change priced quote totals' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_quote_header_cost_writes() from public, anon, authenticated;
drop trigger if exists a_guard_quote_header_cost_writes on public.quotes;
create trigger a_guard_quote_header_cost_writes before insert or update on public.quotes
for each row execute function private.guard_quote_header_cost_writes();

create or replace function private.guard_quote_relationship_writes()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if auth.uid() is null or private.get_current_user_role() in ('owner','admin') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'Only owners and admins may create quotations' using errcode='42501';
  end if;
  if new.company_id is distinct from old.company_id
    or new.customer_id is distinct from old.customer_id
    or new.dealer_id is distinct from old.dealer_id
    or new.created_by is distinct from old.created_by then
    raise exception 'Quotation company, customer, dealer, and creator cannot be changed through the workflow' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_quote_relationship_writes() from public, anon, authenticated;
drop trigger if exists b_guard_quote_relationship_writes on public.quotes;
create trigger b_guard_quote_relationship_writes before insert or update on public.quotes
for each row execute function private.guard_quote_relationship_writes();

create or replace function private.guard_low_margin_quote_approval()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if auth.uid() is not null and old.low_margin_approval_required and new.status in ('approved_for_sending','sent','customer_approved')
    and private.get_current_user_role() not in ('owner','admin') then
    raise exception 'Only owners and admins may approve low-margin quotations' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_low_margin_quote_approval() from public, anon, authenticated;
drop trigger if exists a_guard_low_margin_quote_approval on public.quotes;
create trigger a_guard_low_margin_quote_approval before update of status on public.quotes
for each row execute function private.guard_low_margin_quote_approval();

-- Reservation is a distinct inventory capability. A user who can read or edit
-- a configuration does not thereby receive permission to reserve stock.
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='profile_stock_reservations' loop
    execute format('drop policy %I on public.profile_stock_reservations', p.policyname);
  end loop;
end;
$$;
create policy profile_stock_reservations_access_read on public.profile_stock_reservations for select using (
  auth.uid() is not null and company_id=private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner','admin','production_manager','production','factory_manager','inventory_manager','dispatch_manager','dispatch')
);
create policy profile_stock_reservations_access_insert on public.profile_stock_reservations for insert with check (
  auth.uid() is not null and company_id=private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner','admin','production_manager','factory_manager','inventory_manager')
);
create policy profile_stock_reservations_access_update on public.profile_stock_reservations for update using (
  auth.uid() is not null and company_id=private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner','admin','factory_manager','inventory_manager')
) with check (
  company_id=private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner','admin','factory_manager','inventory_manager')
);

-- Costing is an accounts capability, not a consequence of configurator draft
-- access. Keep draft editing separate from the privileged calculation mode.
create or replace function public.save_system_configuration_atomic(
  p_configuration_id uuid,
  p_mode text,
  p_expected_updated_at timestamptz,
  p_header jsonb,
  p_rows jsonb
)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  v_company uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  c public.system_configurations%rowtype;
  t text;
  r jsonb;
  h jsonb;
begin
  if auth.uid() is null or v_company is null then
    raise exception 'Permission denied' using errcode='42501';
  end if;
  if p_mode='calculation' and v_role not in ('owner','admin') then
    raise exception 'Only owners and admins may calculate internal system costing' using errcode='42501';
  end if;
  if p_mode='draft' and v_role not in ('owner','admin','sales_manager') then
    raise exception 'Permission denied' using errcode='42501';
  end if;
  if p_mode not in ('draft','calculation') or p_mode is null then
    raise exception 'Invalid save mode';
  end if;

  select * into c from public.system_configurations
  where id=p_configuration_id and company_id=v_company for update;
  if not found then raise exception 'Configuration not found'; end if;
  if c.order_id is not null or c.quote_id is not null or c.status::text in ('in_production','converted_to_order') then
    raise exception 'Linked configurations are immutable; create a new configuration for revisions';
  end if;
  if p_mode='calculation' and (p_expected_updated_at is null or p_expected_updated_at is distinct from c.updated_at) then
    raise exception 'Configuration changed; reload and calculate again';
  end if;
  if p_mode='draft' then
    h := private.keep_jsonb_keys(p_header,array['project_name','customer_id','system_type','series_id','template_id','design_reference','location_label','width_mm','height_mm','quantity','no_of_panels','measurement_type','view_direction','panel_layout_json','options_json','finish_id','glass_id','notes'])
      || jsonb_build_object('status','draft','subtotal',0,'gst_amount',0,'grand_total',0,'internal_cost',0,'selling_price',0);
  else
    if coalesce(p_header->>'status','') not in ('draft','calculated') then raise exception 'Invalid calculation status'; end if;
    h := private.keep_jsonb_keys(p_header,array['status','subtotal','gst_amount','grand_total','internal_cost','selling_price','margin_percent','gst_percent']);
  end if;
  foreach t in array array['system_profile_cuts','system_glass_cuts','system_beading_cuts','system_hardware_bom','system_material_summary','profile_optimization_runs'] loop
    execute format('delete from public.%I where configuration_id=$1 and company_id=$2',t) using c.id,v_company;
    if p_mode='calculation' and t <> 'profile_optimization_runs' then
      if jsonb_typeof(p_rows->t) is distinct from 'array' then raise exception 'Every calculation collection must be supplied'; end if;
      for r in select value from jsonb_array_elements(p_rows->t) loop
        perform private.insert_jsonb_row(('public.'||t)::regclass, (r - array['id','created_at','created_by']) || jsonb_build_object('company_id',v_company,'configuration_id',c.id));
      end loop;
    end if;
  end loop;
  perform private.update_jsonb_row('public.system_configurations'::regclass,c.id,v_company,h || jsonb_build_object('updated_at',clock_timestamp()));
end;
$$;
revoke all on function public.save_system_configuration_atomic(uuid,text,timestamptz,jsonb,jsonb) from public, anon;
grant execute on function public.save_system_configuration_atomic(uuid,text,timestamptz,jsonb,jsonb) to authenticated;

-- A01/A02 policies remain the authority for all direct base-table writes.

commit;

begin;

alter table public.quotes add column if not exists system_configuration_id uuid references public.system_configurations(id) on delete restrict;
create unique index if not exists quotes_one_system_configuration_idx on public.quotes(company_id,system_configuration_id) where system_configuration_id is not null;
alter table public.quote_items add column if not exists configuration_cut_snapshot jsonb;
alter table public.order_items add column if not exists configuration_cut_snapshot jsonb;
-- Aggregate cut lists can have different lengths. Preserve sufficient precision
-- in their explicitly labelled average without rounding the total metres.
do $$
declare v_dependency record;
begin
  if to_regclass('public.quote_items_authorized') is null or to_regclass('public.order_items_authorized') is null then
    raise exception 'Apply the access projection migration before widening configuration cut precision';
  end if;
  for v_dependency in
    select distinct n.nspname,c.relname
    from pg_depend d join pg_rewrite r on r.oid=d.objid and d.classid='pg_rewrite'::regclass
    join pg_class c on c.oid=r.ev_class join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=d.refobjid and a.attnum=d.refobjsubid
    where d.refobjid in ('public.quote_items'::regclass,'public.order_items'::regclass)
      and a.attname in ('length_per_piece_m','section_weight_kg_per_m')
  loop
    if v_dependency.nspname<>'public' or v_dependency.relname not in ('quote_items_authorized','order_items_authorized') then
      raise exception 'Unexpected precision-dependent view %.%; review its definition before applying this migration',v_dependency.nspname,v_dependency.relname;
    end if;
  end loop;
end;
$$;
-- Known SELECT-only projections are recreated explicitly with identical masks.
-- RESTRICT (the default) prevents silently removing any downstream dependency.
drop view public.quote_items_authorized;
drop view public.order_items_authorized;
alter table public.quote_items alter column length_per_piece_m type numeric(24,12),
  alter column section_weight_kg_per_m type numeric(24,12);
alter table public.order_items alter column length_per_piece_m type numeric(24,12),
  alter column section_weight_kg_per_m type numeric(24,12);

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
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.internal_note end as internal_note,
  i.configuration_cut_snapshot
from public.quote_items i
join public.quotes q on q.id = i.quote_id and q.company_id = i.company_id
where auth.uid() is not null
  and i.company_id = private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts','viewer','dealer_admin','dealer_staff')
  and (private.get_current_user_role() not in ('dealer_admin','dealer_staff') or q.dealer_id = private.get_current_user_dealer_id());

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
  case when private.get_current_user_role() in ('owner','admin','accounts') then i.internal_note end as internal_note,
  i.configuration_cut_snapshot
from public.order_items i
join public.orders o on o.id = i.order_id and o.company_id = i.company_id
where auth.uid() is not null
  and i.company_id = private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager','production','factory_manager','dispatch_manager','dispatch','inventory_manager','accounts','quality','viewer','dealer_admin','dealer_staff')
  and (private.get_current_user_role() not in ('dealer_admin','dealer_staff') or o.dealer_id = private.get_current_user_dealer_id());
revoke all on public.quote_items_authorized,public.order_items_authorized from public,anon,authenticated;
grant select on public.quote_items_authorized,public.order_items_authorized to authenticated;

create or replace function public.generate_system_quote_atomic(p_configuration_id uuid)
returns uuid language plpgsql security definer
set search_path = pg_catalog,public,private as $$
declare
  v_company uuid;
  v_role text;
  v_config public.system_configurations%rowtype;
  v_settings public.company_settings%rowtype;
  v_quote_id uuid;
  v_profile record;
  v_total_weight numeric;
  v_price numeric;
  v_cost numeric;
  v_tax numeric;
  v_target_price numeric;
  v_target_cost numeric;
  v_target_tax numeric;
  v_used_price numeric := 0;
  v_used_cost numeric := 0;
  v_line_count integer;
  v_index integer := 0;
  v_line_id uuid;
  v_allocations jsonb := '[]'::jsonb;
  v_pair record;
  v_iteration integer;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select company_id,role::text into v_company,v_role from public.app_users where id=auth.uid() and is_active=true;
  if auth.uid() is null or v_company is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if v_role not in ('owner','admin') then raise exception 'Only owners and admins can generate system quotes from internal costing' using errcode='42501'; end if;
  select * into v_config from public.system_configurations where id=p_configuration_id and company_id=v_company for update;
  if not found then raise exception 'Configuration not found for this company'; end if;
  if v_config.quote_id is not null then
    if not exists(select 1 from public.quotes where id=v_config.quote_id and company_id=v_company and system_configuration_id=v_config.id and customer_id=v_config.customer_id) then
      raise exception 'Existing quote link lacks verified configuration lineage; review the legacy conversion before continuing';
    end if;
    return v_config.quote_id;
  end if;
  if v_config.status <> 'calculated' or v_config.customer_id is null then
    raise exception 'Recalculate a valid configuration and link a customer before generating a quote';
  end if;
  perform 1 from public.customers where id=v_config.customer_id and company_id=v_company and deleted_at is null;
  if not found then raise exception 'Customer not found for this company'; end if;
  select * into v_settings from public.company_settings where company_id=v_company;
  v_target_price := round(coalesce(v_config.subtotal,v_config.selling_price,0),2);
  v_target_cost := round(coalesce(v_config.internal_cost,0),2);
  v_target_tax := round(coalesce(v_config.gst_amount,0),2);
  if v_target_price <= 0 or v_target_cost < 0 or v_config.internal_cost is null or v_config.gst_amount is null or v_config.grand_total is null
     or v_config.gst_percent is null or v_config.gst_percent not between 0 and 100
     or round(v_target_price*v_config.gst_percent/100,2) <> v_target_tax
     or round(v_target_price+v_target_tax,2) <> round(coalesce(v_config.grand_total,0),2) then
    raise exception 'Calculated assembly price, cost and GST must reconcile before generating a quote';
  end if;
  perform 1 from public.system_profile_cuts where company_id=v_company and configuration_id=v_config.id order by id for share;
  perform 1 from public.system_beading_cuts where company_id=v_company and configuration_id=v_config.id order by id for share;
  if exists(select 1 from public.system_profile_cuts c left join public.aluminium_profiles p on p.id=c.profile_id and p.company_id=c.company_id
    where c.company_id=v_company and c.configuration_id=v_config.id and (p.id is null or not p.is_active or p.deleted_at is not null or c.quantity <= 0 or c.total_length_m <= 0 or c.total_weight_kg <= 0
      or abs(c.total_length_m-round(c.quantity*c.cut_length_mm/1000,3)) > 0.001
      or abs(c.total_weight_kg-round(c.total_length_m*p.section_weight_kg_per_m,3)) > 0.001))
    or exists(select 1 from public.system_beading_cuts c left join public.aluminium_profiles p on p.id=c.profile_id and p.company_id=c.company_id
      where c.company_id=v_company and c.configuration_id=v_config.id and (p.id is null or not p.is_active or p.deleted_at is not null or c.quantity <= 0 or c.total_length_m <= 0 or abs(c.total_length_m-round(c.quantity*c.cut_length_mm/1000,3)) > 0.001)) then
    raise exception 'Every profile and beading cut must have valid same-company material and exact calculated quantities';
  end if;
  select sum(weight),count(distinct profile_id) into v_total_weight,v_line_count from (
    select c.profile_id,c.total_weight_kg as weight from public.system_profile_cuts c where c.company_id=v_company and c.configuration_id=v_config.id
    union all select c.profile_id,round(c.total_length_m*p.section_weight_kg_per_m,3) from public.system_beading_cuts c join public.aluminium_profiles p on p.id=c.profile_id and p.company_id=c.company_id where c.company_id=v_company and c.configuration_id=v_config.id
  ) cuts;
  if coalesce(v_total_weight,0) <= 0 or v_line_count <= 0 then raise exception 'Calculate all profile cuts before generating a quote'; end if;
  if v_target_price < v_line_count*0.01 then raise exception 'Assembly price must support a positive amount on every profile line'; end if;
  insert into public.quotes(company_id,quote_number,customer_id,quote_date,valid_until,status,gst_percent,
    terms_and_conditions,payment_terms,delivery_timeline,notes,created_by,system_configuration_id)
  values(v_company,private.next_business_number_locked('public.quotes'::regclass,'quote_number',v_company,'Q',v_today),v_config.customer_id,v_today,
    v_today+coalesce(v_settings.default_quote_validity_days,15),'draft',v_config.gst_percent,
    coalesce(v_settings.default_terms_and_conditions,v_settings.default_quote_terms),v_settings.default_payment_terms,v_settings.default_delivery_terms,
    format('Assembly %s / %s / %s x %s mm / quantity %s. Profile lines retain all cuts; shared aluminium, glass, hardware and service costs and selling price are allocated by profile weight, with the final line carrying rounding residuals.',coalesce(v_config.configuration_number,v_config.id::text),v_config.project_name,v_config.width_mm,v_config.height_mm,v_config.quantity),auth.uid(),v_config.id)
  returning id into v_quote_id;
  for v_profile in
    with cuts as (
      select c.id,c.profile_id,c.quantity,c.total_length_m as length,c.total_weight_kg as weight,c.cut_length_mm,'profile' as kind
      from public.system_profile_cuts c where c.company_id=v_company and c.configuration_id=v_config.id
      union all select c.id,c.profile_id,c.quantity,c.total_length_m,round(c.total_length_m*p.section_weight_kg_per_m,3),c.cut_length_mm,'beading'
      from public.system_beading_cuts c join public.aluminium_profiles p on p.id=c.profile_id and p.company_id=c.company_id where c.company_id=v_company and c.configuration_id=v_config.id
    ) select c.profile_id,sum(c.quantity)::integer as pieces,sum(c.length) as length,sum(c.weight) as weight,
      jsonb_agg(jsonb_build_object('cut_id',c.id,'kind',c.kind,'cut_length_mm',c.cut_length_mm,'pieces',c.quantity,'length_m',c.length,'weight_kg',c.weight) order by c.kind,c.id) as cut_snapshot,
      min(p.profile_code) as profile_code,min(p.profile_name) as profile_name
    from cuts c join public.aluminium_profiles p on p.id=c.profile_id and p.company_id=v_company
    group by c.profile_id order by sum(c.weight),c.profile_id
  loop
    v_index := v_index+1;
    v_price := case when v_index=v_line_count then v_target_price-v_used_price else greatest(0.01,floor(v_target_price*v_profile.weight/v_total_weight*100)/100) end;
    v_cost := case when v_index=v_line_count then v_target_cost-v_used_cost else floor(v_target_cost*v_profile.weight/v_total_weight*100)/100 end;
    if v_price <= 0 or v_cost < 0 then raise exception 'Profile price allocation cannot be represented without changing the assembly total; adjust the configuration price'; end if;
    v_allocations := v_allocations || jsonb_build_array(to_jsonb(v_profile)||jsonb_build_object('price',v_price,'cost',v_cost));
    v_used_price := v_used_price+v_price;
    v_used_cost := v_used_cost+v_cost;
  end loop;
  select sum(round((value->>'price')::numeric*v_config.gst_percent/100,2)) into v_tax from jsonb_array_elements(v_allocations);
  -- Move the few paise needed between selling lines before insertion. This
  -- preserves the agreed assembly subtotal and each line's normal GST formula.
  for v_iteration in 1..greatest(v_line_count*2,1) loop
    exit when v_tax=v_target_tax;
    with amounts as (
      select ordinality::integer as idx,(value->>'price')::numeric as price
      from jsonb_array_elements(v_allocations) with ordinality
    ), transfers as (
      select donor.idx as donor,receiver.idx as receiver,delta.cents,
        round((donor.price-delta.cents/100.0)*v_config.gst_percent/100,2)
        +round((receiver.price+delta.cents/100.0)*v_config.gst_percent/100,2)
        -round(donor.price*v_config.gst_percent/100,2)-round(receiver.price*v_config.gst_percent/100,2) as tax_delta
      from amounts donor cross join amounts receiver
      cross join generate_series(1,greatest(100,ceil(100/nullif(v_config.gst_percent,0))::integer)) delta(cents)
      where donor.idx<>receiver.idx and donor.price-delta.cents/100.0>=0.01
    ) select * into v_pair from transfers
      where abs(v_tax+tax_delta-v_target_tax)<abs(v_tax-v_target_tax)
      order by cents,donor,receiver limit 1;
    if not found then raise exception 'Assembly GST cannot be represented by positive profile prices at paise precision; review the calculated quote'; end if;
    v_allocations := jsonb_set(v_allocations,array[(v_pair.donor-1)::text,'price'],
      to_jsonb((v_allocations->(v_pair.donor-1)->>'price')::numeric-v_pair.cents/100.0));
    v_allocations := jsonb_set(v_allocations,array[(v_pair.receiver-1)::text,'price'],
      to_jsonb((v_allocations->(v_pair.receiver-1)->>'price')::numeric+v_pair.cents/100.0));
    v_tax := v_tax+v_pair.tax_delta;
  end loop;
  if v_tax<>v_target_tax then raise exception 'Assembly GST allocation did not converge'; end if;
  for v_profile in select * from jsonb_to_recordset(v_allocations) as allocation(
    profile_id uuid,pieces integer,length numeric,weight numeric,cut_snapshot jsonb,
    profile_code text,profile_name text,price numeric,cost numeric)
  loop
    v_price := v_profile.price;
    v_cost := v_profile.cost;
    insert into public.quote_items(company_id,quote_id,profile_id,item_description,quantity_pieces,length_per_piece_m,section_weight_kg_per_m,
      billet_rate_per_kg,conversion_charge_per_kg,finishing_type,finishing_charge_type,finishing_charge,die_charge,scrap_allowance_percent,
      expected_recovery_percent,minimum_billing_weight_kg,die_amortization_type,die_amortization_quantity_kg,packing_charge,transport_charge,other_charges,
      margin_percent,sales_price_override,minimum_margin_percent,gst_percent,source_record_id,configuration_cut_snapshot,internal_note)
    values(v_company,v_quote_id,v_profile.profile_id,
      format('%s / %s. %s profile pieces, %s m; scalar length is a planning average. Use the exact linked cut list. Shared assembly price allocated by kg.',v_profile.profile_code,v_profile.profile_name,v_profile.pieces,v_profile.length),
      v_profile.pieces,v_profile.length/v_profile.pieces,v_profile.weight/v_profile.length,
      0,0,'mill_finish','fixed',0,0,0,100,0,'waived',0,0,0,v_cost,0,v_price,coalesce(v_settings.minimum_margin_percent,0),v_config.gst_percent,
      v_config.id,v_profile.cut_snapshot,'Assembly internal cost allocated by profile weight; exact pieces/metres/kg retained in configuration cut snapshot')
    returning id into v_line_id;
    if exists(select 1 from public.quote_items where id=v_line_id and (abs(total_meters-v_profile.length)>0.001 or abs(total_weight_kg-v_profile.weight)>0.001 or line_total_before_gst<>v_price or line_subtotal<>v_cost)) then
      raise exception 'Quote line calculation changed its exact profile quantities or allocated price';
    end if;
  end loop;
  select round(coalesce(sum(round(line_total_before_gst*gst_percent/100,2)),0),2) into v_tax from public.quote_items where quote_id=v_quote_id and company_id=v_company;
  if v_tax <> v_target_tax then raise exception 'Per-profile GST rounding failed to preserve the assembly quote'; end if;
  update public.quotes set updated_at=now() where id=v_quote_id and company_id=v_company;
  if not exists(select 1 from public.quotes where id=v_quote_id and company_id=v_company and total_before_gst=v_target_price and gst_amount=v_target_tax and grand_total=v_config.grand_total) then
    raise exception 'Quote totals do not reconcile to the calculated assembly';
  end if;
  update public.system_configurations set quote_id=v_quote_id,status='quoted',updated_at=now() where id=v_config.id and company_id=v_company;
  insert into public.audit_logs(company_id,actor_id,action,entity_type,entity_id,metadata_json)
  values(v_company,auth.uid(),'system_quote_generated','system_configuration',v_config.id,jsonb_build_object('quote_id',v_quote_id,'profile_count',v_line_count,'allocation_basis','profile_weight','subtotal',v_target_price,'internal_cost',v_target_cost,'gst',v_target_tax));
  return v_quote_id;
end;
$$;
revoke all on function public.generate_system_quote_atomic(uuid) from public,anon;
grant execute on function public.generate_system_quote_atomic(uuid) to authenticated;

create or replace function private.guard_configuration_cut_snapshot()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare
  v_editable text[] := array['updated_at','drawing_document_id','drawing_revision','drawing_approval_status',
    'section_number','section_code','section_name','customer_component_code','component_description',
    'packing_instruction','customer_packing_requirement','internal_note','item_description'];
begin
  if old.configuration_cut_snapshot is null then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  if tg_op='DELETE' then raise exception 'Configuration cut lineage and allocated commercial totals are immutable; preserve the source quote'; end if;
  if (to_jsonb(new)-v_editable) is distinct from (to_jsonb(old)-v_editable) then
    raise exception 'Configuration cut lineage and allocated commercial totals are immutable; use an approved new configuration for revised quantities or pricing';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_configuration_cut_snapshot() from public,anon,authenticated;
drop trigger if exists zzzz_guard_configuration_cut_snapshot on public.quote_items;
create trigger zzzz_guard_configuration_cut_snapshot before update or delete on public.quote_items
for each row execute function private.guard_configuration_cut_snapshot();
drop trigger if exists zzzz_guard_configuration_cut_snapshot on public.order_items;
create trigger zzzz_guard_configuration_cut_snapshot before update or delete on public.order_items
for each row execute function private.guard_configuration_cut_snapshot();

create or replace function public.handoff_system_configuration_to_production_atomic(p_configuration_id uuid,p_jobs jsonb,p_remarks text)
returns uuid language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare
  v_company uuid := private.get_current_user_company_id();
  v_config public.system_configurations%rowtype;
  v_order public.orders%rowtype;
  v_job jsonb;
  v_line public.order_items%rowtype;
  v_profile uuid;
  v_order_id uuid;
  v_jobs jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or v_company is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if coalesce(private.get_current_user_role(),'') not in ('owner','admin','factory_manager','production_manager') then
    raise exception 'Permission denied for production handoff' using errcode='42501';
  end if;
  select * into v_config from public.system_configurations where id=p_configuration_id and company_id=v_company for update;
  if not found then raise exception 'System configuration not found for this company'; end if;
  if v_config.quote_id is not null then
    if (select count(*) from public.orders where company_id=v_company and quote_id=v_config.quote_id
      and (v_config.order_id is null or id=v_config.order_id)) <> 1 then
      raise exception 'Convert the approved linked quote to one unambiguous canonical order before production handoff';
    end if;
    select * into v_order from public.orders where company_id=v_company and quote_id=v_config.quote_id
      and (v_config.order_id is null or id=v_config.order_id) for update;
    if not found then raise exception 'Convert the approved linked quote to a canonical order before production handoff'; end if;
    if v_order.customer_id is distinct from v_config.customer_id then raise exception 'Configuration customer does not match its commercial order'; end if;
    if v_config.status='in_production' then
      return private.handoff_system_configuration_to_production_atomic(p_configuration_id,p_jobs,p_remarks);
    end if;
    if p_jobs is null or jsonb_typeof(p_jobs)<>'array' or jsonb_array_length(p_jobs)=0 or jsonb_array_length(p_jobs)>100 then
      raise exception 'Provide every profile exactly once for production handoff';
    end if;
    if (select count(*) from jsonb_array_elements(p_jobs)) <> (select count(distinct value->>'profile_id') from jsonb_array_elements(p_jobs))
      or jsonb_array_length(p_jobs) <> (select count(*) from public.order_items where company_id=v_company and order_id=v_order.id) then
      raise exception 'Provide every commercial profile exactly once for production handoff';
    end if;
    for v_job in select value from jsonb_array_elements(p_jobs) loop
      v_profile := nullif(v_job->>'profile_id','')::uuid;
      if (select count(*) from public.order_items where company_id=v_company and order_id=v_order.id and profile_id=v_profile) <> 1 then
        raise exception 'Each configuration profile requires one unambiguous canonical order line';
      end if;
      select * into v_line from public.order_items where company_id=v_company and order_id=v_order.id and profile_id=v_profile
        and (nullif(v_job->>'source_line_id','') is null or id=nullif(v_job->>'source_line_id','')::uuid) for update;
      if not found or v_line.configuration_cut_snapshot is null or v_line.quote_item_id is null or v_line.quantity_kg is null or v_line.total_meters is null
         or not exists(select 1 from public.quote_items qi join public.quotes q on q.id=qi.quote_id and q.company_id=qi.company_id
           where qi.id=v_line.quote_item_id and qi.company_id=v_company and q.id=v_config.quote_id and q.system_configuration_id=v_config.id
             and qi.configuration_cut_snapshot=v_line.configuration_cut_snapshot and qi.profile_id=v_line.profile_id)
         or abs(coalesce((v_job->>'planned_quantity_kg')::numeric,-1)-v_line.quantity_kg)>0.001
         or abs(coalesce((v_job->>'planned_meters')::numeric,-1)-v_line.total_meters)>0.001 then
        raise exception 'Each profile job must preserve the exact configuration cut snapshot and canonical order line kilograms/metres';
      end if;
      v_jobs := v_jobs || jsonb_build_array(v_job || jsonb_build_object('source_line_id',v_line.id,
        'remarks',format('System configuration %s / profile %s',coalesce(v_config.configuration_number,v_config.id::text),v_line.profile_id)));
    end loop;
    v_order_id := private.handoff_system_configuration_to_production_atomic(p_configuration_id,v_jobs,p_remarks);
    update public.production_jobs j set pieces=line.quantity_pieces,updated_at=now()
    from public.order_items line where j.company_id=v_company and j.order_id=v_order_id
      and line.id=j.source_line_id and line.company_id=v_company and line.order_id=v_order_id
      and j.remarks like 'System configuration ' || coalesce(v_config.configuration_number,v_config.id::text) || ' / profile %';
    return v_order_id;
  end if;
  return private.handoff_system_configuration_to_production_atomic(p_configuration_id,p_jobs,p_remarks);
end;
$$;
revoke all on function public.handoff_system_configuration_to_production_atomic(uuid,jsonb,text) from public,anon;
grant execute on function public.handoff_system_configuration_to_production_atomic(uuid,jsonb,text) to authenticated;
commit;

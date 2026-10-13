begin;

-- This fixed module manifest is derived from the existing module configuration
-- and read-role contract. Identifiers are never accepted from a caller.
create or replace function public.get_operation_database_page(
  p_module text, p_search text default '', p_filters jsonb default '{}'::jsonb,
  p_sort text default null, p_direction text default 'asc', p_page integer default 1,
  p_date_from date default null, p_date_to date default null
)
returns jsonb language plpgsql security invoker
set search_path = pg_catalog,public
set timezone = 'Asia/Kolkata' as $$
declare
  v_manifest constant jsonb := '{"orders":{"table":"orders","resource":"orders","search":["order_number","current_stage","priority","notes"],"customer":"customer_id","group":"current_stage","secondary":"priority","date":"expected_dispatch_date","sort":"expected_dispatch_date","sortFields":["expected_dispatch_date","order_number","order_origin","order_source_label","current_stage","priority","billets_required","billets_allocated","billet_allocation_status","order_date","expected_dispatch_date","order_value"],"roles":["owner","admin","sales_manager","sales","production_manager","production","factory_manager","inventory_manager","dispatch_manager","dispatch","quality","accounts","viewer"]},"quotes":{"table":"quotes","resource":"quotes","search":["quote_number","status","notes"],"customer":"customer_id","group":"status","date":"quote_date","sort":"created_at","sortFields":["created_at","quote_number","status","quote_date","valid_until","grand_total"],"roles":["owner","admin","sales_manager","sales","accounts","viewer","dealer_admin","dealer_staff"]},"dispatches":{"table":"dispatches","resource":"dispatches","search":["dispatch_number","delivery_status","transporter_name","vehicle_number","eway_bill_number","lr_number"],"order":"order_id","group":"delivery_status","date":"dispatch_date","sort":"dispatch_date","sortFields":["dispatch_date","dispatch_number","delivery_status","dispatch_date","vehicle_number","transporter_name","total_weight_kg"],"roles":["owner","admin","factory_manager","inventory_manager","dispatch_manager","dispatch","accounts","viewer"]},"production":{"table":"production_jobs","resource":"production","search":["job_number","status","shift","operator_name","remarks","notes"],"profile":"profile_id","order":"order_id","group":"status","date":"planned_date","sort":"planned_date","sortFields":["planned_date","job_number","status","planned_date","pieces","planned_quantity_kg"],"roles":["owner","admin","production_manager","production","factory_manager","quality","viewer"]},"foundry":{"table":"foundry_batches","resource":"foundry","search":["batch_number","furnace_number","furnace_name","alloy","temper","heat_number","status"],"group":"status","secondary":"alloy","date":"production_date","sort":"production_date","sortFields":["production_date","batch_number","furnace_number","status","alloy","temper","billet_count","furnace_efficiency_percent","required_furnace_charge_kg","total_billet_weight_density_kg","production_date"],"roles":["owner","admin","production_manager","production","factory_manager","quality"]},"foundry_external_sources":{"table":"foundry_external_aluminium_sources","resource":"foundry","search":["source_number","item_type","source_origin","alloy","quality_grade","status"],"group":"status","secondary":"item_type","date":"received_date","sort":"received_date","sortFields":["received_date","source_number","item_type","weight_kg","available_weight_kg","quantity","status","received_date"],"roles":["owner","admin","production_manager","production","factory_manager","quality"]},"foundry_billets":{"table":"foundry_billets","resource":"foundry","search":["billet_code","alloy","temper","status","source_type"],"group":"status","date":"created_at","sort":"created_at","sortFields":["created_at","billet_code","source_type","alloy","diameter","weight_kg","status","created_at"],"roles":["owner","admin","production_manager","production","factory_manager","quality"]},"machines":{"table":"machines","resource":"machine_maintenance","search":["machine_code","machine_name","manufacturer"],"group":"status","date":"created_at","sort":"machine_name","sortFields":["machine_name","machine_code","machine_name","machine_type","status","created_at"],"roles":["owner","admin"]},"outsourced_billets":{"table":"outsourced_billet_batches","resource":"foundry","search":["batch_number","alloy","temper","status"],"group":"status","date":"received_date","sort":"received_date","sortFields":["received_date","batch_number","alloy","billet_count","weight_kg","status","received_date"],"roles":["owner","admin","production_manager","production","factory_manager","quality"]},"foundry_scrap":{"table":"foundry_aluminium_scrap","resource":"foundry","search":["scrap_number","scrap_source","scrap_quality","origin_reference","status"],"group":"status","secondary":"scrap_quality","date":"received_date","sort":"received_date","sortFields":["received_date","scrap_number","scrap_source","weight_kg","scrap_quality","status","received_date"],"roles":["owner","admin","production_manager","production","factory_manager","quality"]},"packaging":{"table":"packaging_jobs","resource":"packaging","search":["packaging_number","status","notes"],"order":"order_id","group":"status","date":"scheduled_date","sort":"scheduled_date","sortFields":["scheduled_date","packaging_number","pieces","profile_weight_kg","status"],"roles":["owner","admin","production_manager","production","factory_manager","dispatch_manager","dispatch"]},"packaging_materials":{"table":"packaging_materials","resource":"packaging","search":["material_code","material_name","material_type","location"],"group":"material_type","secondary":"is_active","sort":"material_code","sortFields":["material_code","material_code","material_name","material_type","current_stock","reorder_level"],"roles":["owner","admin","production_manager","production","factory_manager","dispatch_manager","dispatch"]},"packaging_material_purchases":{"table":"packaging_material_purchases","resource":"packaging","search":["purchase_number","invoice_number","notes","payment_status"],"group":"payment_status","date":"received_date","sort":"received_date","sortFields":["received_date","purchase_number","received_date","material","vendor","quantity","rate","total_amount","payment_status"],"roles":["owner","admin","production_manager","production","factory_manager","dispatch_manager","dispatch"]},"packaging_job_materials":{"table":"packaging_job_materials","resource":"packaging","search":["packaging_materials.material_name","packaging_materials.material_code"],"sort":"created_at","sortFields":["created_at","job","quantity_required"],"roles":["owner","admin","production_manager","production","factory_manager","dispatch_manager","dispatch"]},"inventory":{"table":"inventory_items","resource":"inventory","search":["item_code","item_name","item_category","location"],"group":"item_category","secondary":"is_active","date":"updated_at","sort":"updated_at","sortFields":["updated_at","item_code","item_name","item_category","current_stock","reorder_level"],"roles":["owner","admin","sales_manager","sales","production_manager","production","factory_manager","inventory_manager","dispatch_manager","dispatch","quality","viewer","dealer_admin","dealer_staff"]},"customers":{"table":"customers","resource":"customers","search":["customer_name","company_name","contact_person","phone","whatsapp_number","email","gst_number","city","state","pincode","billing_address","shipping_address","customer_type","payment_terms","notes"],"group":"customer_type","secondary":"is_active","date":"created_at","sort":"created_at","sortFields":["created_at","customer_name","company_name","customer_type","city"],"roles":["owner","admin","sales_manager","sales","production_manager","factory_manager","accounts","viewer"]},"profiles":{"table":"aluminium_profiles","resource":"profiles","search":["profile_code","profile_name","application_category","alloy","temper"],"group":"application_category","secondary":"is_active","date":"created_at","sort":"profile_code","sortFields":["profile_code","profile_code","profile_name","application_category","section_weight_kg_per_m","billet_diameter_required_inch"],"roles":["owner","admin","production_manager","factory_manager","inventory_manager","viewer"]},"quality":{"table":"quality_inspections","resource":"quality","search":["batch_number","status","inspector_name","dimensional_variance"],"profile":"profile_id","group":"status","secondary":"surface_finish_ok","date":"inspection_date","sort":"inspection_date","sortFields":["inspection_date","batch_number","status","quantity_checked_kg","inspection_date"],"roles":["owner","admin","production_manager","quality","viewer"]},"invoices":{"table":"invoices","resource":"financials","search":["invoice_number","status","notes"],"customer":"customer_id","group":"status","date":"due_date","sort":"due_date","sortFields":["due_date","invoice_number","status","invoice_date","due_date","grand_total","balance_due"],"roles":["owner","admin","accounts"]},"vendors":{"table":"vendors","resource":"vendors","search":["vendor_name","vendor_type","contact_person","phone","gst_number","city"],"group":"vendor_type","secondary":"is_active","date":"created_at","sort":"created_at","sortFields":["created_at","vendor_name","vendor_type","city"],"roles":["owner","admin","sales_manager","production_manager","accounts"]},"tasks":{"table":"tasks","resource":"orders","search":["title","description","status"],"group":"status","date":"due_date","sort":"created_at","sortFields":["created_at","title","status","priority","due_date"],"roles":["owner","admin","sales_manager","sales","production_manager","production","factory_manager","inventory_manager","dispatch_manager","dispatch","quality","accounts","viewer"]},"payments":{"table":"payments","resource":"financials","search":["reference_number","payment_method","notes"],"group":"payment_status","date":"payment_date","sort":"payment_date","sortFields":["payment_date","payment_date","amount","payment_method","payment_type","payment_status"],"roles":["owner","admin","accounts"]},"expenses":{"table":"expense_ledger","resource":"financials","search":["expense_number","expense_category","expense_subcategory","invoice_number","description","source_module","source_submodule","source_label"],"group":"approval_status","secondary":"payment_status","date":"created_at","sort":"created_at","sortFields":["created_at","expense_number","created_at","expense_category","description","source_module","total_amount","amount_paid","balance_amount","payment_status","approval_status"],"roles":["owner","admin","accounts"]},"expense_payments":{"table":"expense_payments","resource":"financials","search":["reference_number","notes"],"date":"payment_date","sort":"payment_date","sortFields":["payment_date","payment_date","amount_paid","payment_method","reference_number"],"roles":["owner","admin","accounts"]}}'::jsonb;
  v_meta jsonb := v_manifest -> p_module;
  v_company uuid := public.get_current_user_company_id();
  v_role text := public.get_current_user_role();
  v_relation text;
  v_sort text;
  v_sort_expression text;
  v_sql text;
  v_where text;
  v_field text;
  v_value text;
  v_result jsonb;
  v_date_field text;
  v_joins text := '';
  v_projection text := '''{}''::jsonb';
  v_related_search text := '';
begin
  if auth.uid() is null or v_company is null or v_role is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  if v_meta is null or not (v_meta->'roles' ? v_role) then
    raise exception 'Permission denied for this database' using errcode='42501';
  end if;
  if p_page is null or p_page < 1 or p_page > 100000 or p_direction is null or p_direction not in ('asc','desc')
     or p_search is null or length(p_search) > 100 or p_filters is null or jsonb_typeof(p_filters) <> 'object'
     or (p_date_from is not null and p_date_to is not null and p_date_from > p_date_to) then
    raise exception 'Invalid search or pagination controls' using errcode='22023';
  end if;
  v_relation := v_meta->>'table';
  if v_relation in ('orders','quotes','production_jobs') then
    v_relation := v_relation || '_authorized';
  elsif to_regclass(format('public.%I',v_relation || '_authorized')) is not null then
    v_relation := v_relation || '_authorized';
  end if;
  v_sort := coalesce(nullif(p_sort,''),v_meta->>'sort');
  if not (v_meta->'sortFields' ? v_sort) then
    raise exception 'Unsupported sort column' using errcode='22023';
  end if;
  if exists (select 1 from pg_attribute where attrelid=to_regclass(format('public.%I',v_relation))
      and attname=v_sort and attnum>0 and not attisdropped) then
    v_sort_expression := format('t.%I',v_sort);
  else
    v_sort_expression := case v_sort
      when 'material' then 't.row_data->''packaging_materials''->>''material_name'''
      when 'vendor' then 't.row_data->''vendors''->>''vendor_name'''
      when 'job' then 't.row_data->''packaging_jobs''->>''packaging_number'''
      when 'diameter' then 't.billet_diameter_inch'
      when 'order_source_label' then 't.order_origin'
      else format('t.%I',v_meta->>'sort') end;
  end if;
  v_where := 't.company_id=$1 and (to_jsonb(t)->>''deleted_at'') is null';
  for v_field,v_value in select key,value from jsonb_each_text(p_filters) loop
    if v_field not in ('status','secondary','customer_id','profile_id','order_id','quote_id',
      'production_job_id','inventory_item_id','expense_ledger_id','source_record_id','material_id','job_id') then
      raise exception 'Unsupported filter' using errcode='22023';
    end if;
    if v_field='status' then v_field := v_meta->>'group';
    elsif v_field='secondary' then v_field := v_meta->>'secondary'; end if;
    if v_value is not null and v_value<>'' and v_field is not null then
      v_where := v_where || format(' and (to_jsonb(t)->>%L)=%L',v_field,v_value);
    end if;
  end loop;
  v_date_field := v_meta->>'date';
  if v_date_field is not null then
    if p_date_from is not null then
      v_where := v_where || format(' and (to_jsonb(t)->>%L)::timestamptz >= ($4::timestamp at time zone ''Asia/Kolkata'')',v_date_field);
    end if;
    if p_date_to is not null then
      v_where := v_where || format(' and (to_jsonb(t)->>%L)::timestamptz < (($5+1)::timestamp at time zone ''Asia/Kolkata'')',v_date_field);
    end if;
  end if;
  -- Each module references only its own lookup providers and their safe fields.
  -- An unrelated revoked provider must not make a permitted database unavailable.
  if v_meta ? 'order' or p_module='foundry_billets' then
    v_joins := v_joins || ' left join (select id,company_id,customer_id,order_number,priority from public.orders_authorized) o on o.company_id=$1 and o.id::text=(to_jsonb(t)->>''order_id'')';
    v_projection := v_projection || ' || jsonb_build_object(''orders'',case when o.id is not null then jsonb_build_object(''order_number'',o.order_number,''priority'',o.priority) end)';
    v_related_search := v_related_search || ' or strpos(lower(coalesce(o.order_number,'''')),lower($2))>0';
  end if;
  if v_meta ? 'customer' or v_meta ? 'order' or p_module='foundry_billets' then
    v_joins := v_joins || format(' left join (select id,company_id,customer_name,company_name,gst_number from public.customers) c on c.company_id=$1 and c.id::text=%s',
      case when v_meta ? 'customer' then '(to_jsonb(t)->>''customer_id'')' else 'o.customer_id::text' end);
    v_projection := v_projection || ' || jsonb_build_object(''customers'',case when c.id is not null then jsonb_build_object(''customer_name'',c.customer_name,''company_name'',c.company_name) end)';
    v_related_search := v_related_search || ' or strpos(lower(coalesce(c.customer_name,'''') || '' '' || coalesce(c.company_name,'''') || '' '' || coalesce(c.gst_number,'''')),lower($2))>0';
    if v_meta ? 'order' then
      v_projection := v_projection || ' || jsonb_build_object(''orders'',case when o.id is not null then jsonb_build_object(''order_number'',o.order_number,''priority'',o.priority,''customers'',case when c.id is not null then jsonb_build_object(''customer_name'',c.customer_name,''company_name'',c.company_name) end) end)';
    end if;
  end if;
  if v_meta ? 'profile' then
    v_joins := v_joins || ' left join (select id,company_id,profile_code,profile_name,section_weight_kg_per_m,alloy,temper from public.aluminium_profiles) p on p.company_id=$1 and p.id::text=(to_jsonb(t)->>''profile_id'')';
    v_projection := v_projection || ' || jsonb_build_object(''aluminium_profiles'',case when p.id is not null then jsonb_build_object(''profile_code'',p.profile_code,''profile_name'',p.profile_name,''section_weight_kg_per_m'',p.section_weight_kg_per_m,''alloy'',p.alloy,''temper'',p.temper) end)';
    v_related_search := v_related_search || ' or strpos(lower(coalesce(p.profile_code,'''') || '' '' || coalesce(p.profile_name,'''')),lower($2))>0';
  end if;
  if p_module in ('foundry_external_sources','outsourced_billets','foundry_scrap','packaging_materials','packaging_material_purchases','expenses') then
    v_joins := v_joins || ' left join (select id,company_id,vendor_name,vendor_type,phone from public.vendors) v on v.company_id=$1 and v.id::text=(to_jsonb(t)->>''vendor_id'')';
    v_projection := v_projection || ' || jsonb_build_object(''vendors'',case when v.id is not null then jsonb_build_object(''vendor_name'',v.vendor_name,''vendor_type'',v.vendor_type,''phone'',v.phone) end)';
  end if;
  if p_module in ('packaging_material_purchases','packaging_job_materials') then
    v_joins := v_joins || ' left join (select id,company_id,material_code,material_name,material_type,unit from public.packaging_materials) m on m.company_id=$1 and m.id::text=(to_jsonb(t)->>''material_id'')';
    v_projection := v_projection || ' || jsonb_build_object(''packaging_materials'',case when m.id is not null then jsonb_build_object(''material_code'',m.material_code,''material_name'',m.material_name,''material_type'',m.material_type,''unit'',m.unit) end)';
    v_related_search := v_related_search || ' or strpos(lower(coalesce(m.material_name,'''') || '' '' || coalesce(m.material_code,'''')),lower($2))>0';
  end if;
  if p_module='packaging_job_materials' then
    v_joins := v_joins || ' left join (select id,company_id,packaging_number from public.packaging_jobs) j on j.company_id=$1 and j.id::text=(to_jsonb(t)->>''job_id'')';
    v_projection := v_projection || ' || jsonb_build_object(''packaging_jobs'',case when j.id is not null then jsonb_build_object(''packaging_number'',j.packaging_number) end)';
  end if;
  if p_module in ('packaging','quality') then
    v_joins := v_joins || ' left join (select id,company_id,job_number,profile_id from public.production_jobs_authorized) pj on pj.company_id=$1 and pj.id::text=(to_jsonb(t)->>''production_job_id'')';
    v_projection := v_projection || ' || jsonb_build_object(''production_jobs'',case when pj.id is not null then jsonb_build_object(''job_number'',pj.job_number) end)';
  end if;
  if p_module='production' then
    v_joins := v_joins || ' left join (select id,company_id,machine_name from public.machines) ma on ma.company_id=$1 and ma.id::text=(to_jsonb(t)->>''machine_id'') left join (select id,company_id,die_number,rack_location from public.dies) d on d.company_id=$1 and d.id::text=(to_jsonb(t)->>''die_id'')';
    v_projection := v_projection || ' || jsonb_build_object(''profile'',case when p.id is not null then jsonb_build_object(''profile_code'',p.profile_code,''profile_name'',p.profile_name,''alloy'',p.alloy,''temper'',p.temper) end,''machine'',case when ma.id is not null then jsonb_build_object(''machine_name'',ma.machine_name) end,''die'',case when d.id is not null then jsonb_build_object(''die_number'',d.die_number,''rack_location'',d.rack_location) end,''order'',case when o.id is not null then jsonb_build_object(''order_number'',o.order_number,''priority'',o.priority,''customers'',case when c.id is not null then jsonb_build_object(''customer_name'',c.customer_name,''company_name'',c.company_name) end) end)';
  end if;
  if p_module='packaging' then
    v_joins := v_joins || ' left join (select id,company_id,profile_code,profile_name from public.aluminium_profiles) pp on pp.company_id=$1 and pp.id=pj.profile_id';
    v_projection := v_projection || ' || jsonb_build_object(''production_jobs'',case when pj.id is not null then jsonb_build_object(''job_number'',pj.job_number,''profile'',case when pp.id is not null then jsonb_build_object(''profile_code'',pp.profile_code,''profile_name'',pp.profile_name) end) end)';
  end if;
  if p_module='quality' then
    v_joins := v_joins || ' left join (select id,company_id,finishing_type,status from public.finishing_jobs) f on f.company_id=$1 and f.id::text=(to_jsonb(t)->>''finishing_job_id'')';
    v_projection := v_projection || ' || jsonb_build_object(''finishing_jobs'',case when f.id is not null then jsonb_build_object(''finishing_type'',f.finishing_type,''status'',f.status) end)';
  end if;
  if p_module='foundry_billets' then
    v_joins := v_joins || ' left join (select id,company_id,batch_number from public.foundry_batches) fb on fb.company_id=$1 and fb.id::text=(to_jsonb(t)->>''foundry_batch_id'') left join (select id,company_id,batch_number from public.outsourced_billet_batches) ob on ob.company_id=$1 and ob.id::text=(to_jsonb(t)->>''outsourced_batch_id'')';
    v_projection := v_projection || ' || jsonb_build_object(''foundry_batches'',case when fb.id is not null then jsonb_build_object(''batch_number'',fb.batch_number) end,''outsourced_billet_batches'',case when ob.id is not null then jsonb_build_object(''batch_number'',ob.batch_number) end)';
  end if;
  if p_module='expenses' then
    v_joins := v_joins || ' left join (select id,company_id,item_code,item_name from public.inventory_items) i on i.company_id=$1 and i.id::text=(to_jsonb(t)->>''inventory_item_id'') left join (select id,company_id,machine_name from public.machines) ma on ma.company_id=$1 and ma.id::text=(to_jsonb(t)->>''machine_id'')';
    v_projection := v_projection || ' || jsonb_build_object(''inventory_items'',case when i.id is not null then jsonb_build_object(''item_code'',i.item_code,''item_name'',i.item_name) end,''machines'',case when ma.id is not null then jsonb_build_object(''machine_name'',ma.machine_name) end)';
  end if;
  if p_module='expense_payments' then
    v_joins := v_joins || ' left join (select id,company_id,expense_number,description,total_amount from public.expense_ledger) e on e.company_id=$1 and e.id::text=(to_jsonb(t)->>''expense_ledger_id'')';
    v_projection := v_projection || ' || jsonb_build_object(''expense_ledger'',case when e.id is not null then jsonb_build_object(''expense_number'',e.expense_number,''description'',e.description,''total_amount'',e.total_amount) end)';
  end if;
  v_sql := format($query$
    with matched as materialized (
      select t.*, to_jsonb(t) || %s as row_data
      from public.%I t
      %s
      where %s and (
        $2='' or exists(select 1 from jsonb_array_elements_text($3->'search') field
          where strpos(lower(coalesce(to_jsonb(t)->>field,'')),lower($2))>0)
        %s
      )
    ), page as (
      select t.row_data from matched t order by %s %s nulls last,t.id asc limit 10 offset %s
    )
    select jsonb_build_object('rows',coalesce((select jsonb_agg(row_data) from page),'[]'::jsonb),
      'count',(select count(*) from matched))
  $query$,v_projection,v_relation,v_joins,v_where,v_related_search,v_sort_expression,p_direction,(p_page-1)*10);
  execute v_sql into v_result using v_company,p_search,v_meta,p_date_from,p_date_to;
  return v_result;
end;
$$;
revoke all on function public.get_operation_database_page(text,text,jsonb,text,text,integer,date,date) from public,anon;
grant execute on function public.get_operation_database_page(text,text,jsonb,text,text,integer,date,date) to authenticated;
commit;

begin;

-- Prepared only. This request record also authorizes the initial line snapshot
-- inside its one transaction. Browser roles receive no access to this table.
create table if not exists private.direct_order_requests (
  company_id uuid not null references public.companies(id),
  idempotency_key uuid not null,
  order_id uuid not null unique references public.orders(id) deferrable initially deferred,
  request_payload jsonb not null,
  material_snapshot jsonb not null,
  transaction_id bigint not null,
  actor_id uuid not null,
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (company_id, idempotency_key)
);
alter table private.direct_order_requests enable row level security;
revoke all on private.direct_order_requests from public, anon, authenticated;

create or replace function private.create_direct_order_atomic(p_order jsonb, p_items jsonb, p_idempotency_key uuid)
returns uuid
language plpgsql security definer set search_path = public, private as $$
declare
  v_company uuid := private.get_current_user_company_id();
  v_actor uuid := auth.uid();
  v_role text := private.get_current_user_role();
  v_organization text;
  v_customer uuid;
  v_date date;
  v_expected date;
  v_header jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_snapshots jsonb := '[]'::jsonb;
  v_materials jsonb := '[]'::jsonb;
  v_line jsonb;
  v_numeric text;
  v_profile public.aluminium_profiles%rowtype;
  v_die public.dies%rowtype;
  v_profile_id uuid;
  v_die_id uuid;
  v_pieces numeric;
  v_length numeric;
  v_rate numeric;
  v_gst numeric;
  v_metres numeric;
  v_kg numeric;
  v_subtotal numeric;
  v_tax numeric;
  v_weight numeric := 0;
  v_total numeric := 0;
  v_request jsonb;
  v_prior private.direct_order_requests%rowtype;
  v_order uuid := gen_random_uuid();
  v_number text;
  v_signature text;
  v_label text;
begin
  if v_actor is null or v_company is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if v_role is null or v_role not in ('owner','admin','sales_manager','sales')
    or private.get_current_user_dealer_id() is not null then
    raise exception 'Direct priced orders require an internal owner, admin or sales role' using errcode='42501';
  end if;
  if p_idempotency_key is null then raise exception 'A retry key is required' using errcode='22023'; end if;
  if jsonb_typeof(p_order) is distinct from 'object' or (p_order - array['customer_id','order_date','expected_dispatch_date','priority','notes']) <> '{}'::jsonb
    or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Enter order details and priced profile lines only' using errcode='22023';
  end if;
  if jsonb_array_length(p_items) not between 1 and 100 then raise exception 'Enter between 1 and 100 priced profile lines' using errcode='22023'; end if;
  v_customer := nullif(p_order->>'customer_id','')::uuid;
  if v_customer is null or coalesce(p_order->>'order_date','') !~ '^\d{4}-\d{2}-\d{2}$'
    or coalesce(p_order->>'priority','') not in ('low','normal','high','urgent')
    or (p_order->>'notes' is not null and jsonb_typeof(p_order->'notes') <> 'string')
    or length(btrim(coalesce(p_order->>'notes',''))) > 2000 then
    raise exception 'Check the customer, dates, priority and notes' using errcode='22023';
  end if;
  v_date := (p_order->>'order_date')::date;
  if nullif(p_order->>'expected_dispatch_date','') is not null then
    if (p_order->>'expected_dispatch_date') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Enter a valid expected dispatch date'; end if;
    v_expected := (p_order->>'expected_dispatch_date')::date;
    if v_expected < v_date then raise exception 'Expected dispatch cannot be before the order date'; end if;
  end if;
  v_header := jsonb_build_object('customer_id',v_customer,'order_date',v_date,'expected_dispatch_date',v_expected,
    'priority',p_order->>'priority','notes',btrim(coalesce(p_order->>'notes','')));
  for v_line in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_line) is distinct from 'object'
      or (v_line - array['profile_id','die_id','quantity_pieces','length_per_piece_m','expected_section_weight_kg_per_m','net_rate','gst_percent','hsn_code','finishing_type']) <> '{}'::jsonb then
      raise exception 'Each line must contain profile, dimensions, agreed rate, GST, HSN and finish only';
    end if;
    foreach v_numeric in array array['quantity_pieces','length_per_piece_m','expected_section_weight_kg_per_m','net_rate','gst_percent'] loop
      if jsonb_typeof(v_line->v_numeric) is distinct from 'number' then raise exception 'Line quantities, rates and GST must be finite numbers'; end if;
    end loop;
    v_profile_id := nullif(v_line->>'profile_id','')::uuid;
    v_die_id := nullif(v_line->>'die_id','')::uuid;
    v_pieces := (v_line->>'quantity_pieces')::numeric;
    v_length := (v_line->>'length_per_piece_m')::numeric;
    v_rate := (v_line->>'net_rate')::numeric;
    v_gst := (v_line->>'gst_percent')::numeric;
    if v_profile_id is null or v_pieces not between 1 and 1000000 or v_pieces <> trunc(v_pieces)
      or v_length not between 0.001 and 1000 or v_length <> round(v_length,3)
      or v_rate not between 0.01 and 10000000 or v_rate <> round(v_rate,2)
      or (v_line->>'expected_section_weight_kg_per_m')::numeric not between 0.001 and 10000
      or (v_line->>'expected_section_weight_kg_per_m')::numeric <> round((v_line->>'expected_section_weight_kg_per_m')::numeric,3)
      or v_gst not between 0 and 100 or v_gst <> round(v_gst,2)
      or jsonb_typeof(v_line->'hsn_code') is distinct from 'string'
      or btrim(coalesce(v_line->>'hsn_code','')) !~ '^(\d{4}|\d{6}|\d{8})$'
      or coalesce(v_line->>'finishing_type','') not in ('mill_finish','powder_coating','anodizing','anodized_silver','anodized_bronze','anodized_black','wood_finish','wood_grain','pvdf','other') then
      raise exception 'Check each line: whole pieces, positive length/rate, GST, HSN and finish';
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('profile_id',v_profile_id,'die_id',v_die_id,
      'quantity_pieces',v_pieces,'length_per_piece_m',v_length,'net_rate',v_rate,'gst_percent',v_gst,
      'expected_section_weight_kg_per_m',(v_line->>'expected_section_weight_kg_per_m')::numeric,
      'hsn_code',btrim(v_line->>'hsn_code'),'finishing_type',v_line->>'finishing_type'));
  end loop;
  v_request := jsonb_build_object('order',v_header,'items',v_lines);
  perform pg_advisory_xact_lock(hashtextextended(v_company::text||':direct-order:'||p_idempotency_key::text,0));
  select * into v_prior from private.direct_order_requests where company_id=v_company and idempotency_key=p_idempotency_key;
  if found then
    if v_prior.request_payload is distinct from v_request then
      raise exception 'This retry key already belongs to different order details. Restore the submitted details and retry to review the existing order.' using errcode='23514';
    end if;
    if not v_prior.completed or not exists(select 1 from public.orders where id=v_prior.order_id and company_id=v_company) then
      raise exception 'The original order confirmation needs review';
    end if;
    return v_prior.order_id;
  end if;

  perform 1 from public.customers where id=v_customer and company_id=v_company and deleted_at is null for share;
  if not found then raise exception 'Customer not found for this company' using errcode='42501'; end if;
  select organization_type into v_organization from public.app_users where id=v_actor and company_id=v_company;
  -- Re-read and lock master data; caller-supplied totals and company IDs are never accepted.
  for v_line in select value from jsonb_array_elements(v_lines) loop
    select * into v_profile from public.aluminium_profiles where id=(v_line->>'profile_id')::uuid and company_id=v_company and deleted_at is null for share;
    if not found or v_profile.is_active is distinct from true then raise exception 'Select an active profile from this company'; end if;
    if v_profile.section_weight_kg_per_m is null or v_profile.section_weight_kg_per_m not between 0.001 and 10000
      or nullif(btrim(v_profile.alloy),'') is null or nullif(btrim(v_profile.temper),'') is null
      or coalesce(v_profile.billet_diameter_required_inch,0) <= 0 then
      raise exception 'Complete the profile section weight, alloy, temper and billet diameter before creating a direct order';
    end if;
    if v_profile.section_weight_kg_per_m is distinct from (v_line->>'expected_section_weight_kg_per_m')::numeric then
      raise exception 'The profile section weight changed. Refresh the profile selection and review the line values before creating the order.';
    end if;
    v_die_id := (v_line->>'die_id')::uuid;
    if v_die_id is not null then
      select * into v_die from public.dies where id=v_die_id and company_id=v_company and deleted_at is null for share;
      if not found or v_die.profile_id is distinct from v_profile.id or v_die.die_status not in ('active','approved') or v_die.die_status is null
        or (v_die.billet_diameter_required_inch is not null and v_die.billet_diameter_required_inch <> v_profile.billet_diameter_required_inch) then
        raise exception 'Select an active, compatible die for this profile';
      end if;
    end if;
    v_metres := round((v_line->>'quantity_pieces')::numeric*(v_line->>'length_per_piece_m')::numeric,3);
    v_kg := round(v_metres*v_profile.section_weight_kg_per_m,3);
    v_subtotal := round(v_kg*(v_line->>'net_rate')::numeric,2);
    v_tax := round(v_subtotal*(v_line->>'gst_percent')::numeric/100,2);
    if v_kg <= 0 or v_kg > 99999999.999 or v_subtotal <= 0 or v_subtotal+v_tax > 999999999999.99 then
      raise exception 'This line is too small or too large to bill. Check its pieces, length and rate.';
    end if;
    v_weight := v_weight+v_kg;
    v_total := v_total+v_subtotal+v_tax;
    v_materials := v_materials || jsonb_build_array(jsonb_build_object('profile_id',v_profile.id,
      'alloy',btrim(v_profile.alloy),'temper',btrim(v_profile.temper),'billet_diameter_inch',v_profile.billet_diameter_required_inch,'weight_kg',v_kg));
    v_snapshots := v_snapshots || jsonb_build_array((v_line-'expected_section_weight_kg_per_m') || jsonb_build_object('section_weight_kg_per_m',v_profile.section_weight_kg_per_m,
      'total_meters',v_metres,'quantity_kg',v_kg,'manufacturing_weight_kg',v_kg,'dealer_fulfilled_weight_kg',0,
      'final_line_value',v_subtotal,'order_uom','kg','order_quantity',v_kg,'invoice_calc_uom','kg',
      'cut_length',(v_line->>'length_per_piece_m')::numeric,'section_code',v_profile.profile_code,
      'section_number',v_profile.section_number,'section_name',v_profile.profile_name,'item_description',v_profile.profile_name,
      'drawing_revision',v_profile.drawing_revision,'drawing_approval_status',case lower(v_profile.drawing_approval_status)
        when 'approved' then 'Approved' when 'rejected' then 'Rejected' else 'Pending' end,
      'alloy_standard_id',v_profile.alloy_standard_id,'alloy_id',v_profile.alloy_id,'temper_id',v_profile.temper_id));
  end loop;
  if v_total > 999999999999.99 or v_weight > 99999999.999 then raise exception 'The combined order exceeds the supported value or weight'; end if;
  insert into private.direct_order_requests(company_id,idempotency_key,order_id,request_payload,material_snapshot,transaction_id,actor_id)
    values(v_company,p_idempotency_key,v_order,v_request,v_materials,txid_current(),v_actor);
  v_number := private.next_business_number_locked('public.orders'::regclass,'order_number',v_company,'O',v_date);
  insert into public.orders(id,company_id,customer_id,quote_id,dealer_id,order_number,order_date,expected_dispatch_date,priority,current_stage,
    order_value,requested_weight_kg,manufacturing_weight_kg,dealer_fulfilled_weight_kg,notes,created_by,created_by_user_id,created_by_role,created_by_organization_type,order_origin)
    values(v_order,v_company,v_customer,null,null,v_number,v_date,v_expected,v_header->>'priority','order_confirmed',
      0,v_weight,v_weight,0,nullif(v_header->>'notes',''),v_actor,v_actor,v_role,v_organization,'FACTORY_DIRECT');
  for v_line in select value from jsonb_array_elements(v_snapshots) loop
    perform private.insert_jsonb_row('public.order_items'::regclass,v_line || jsonb_build_object('company_id',v_company,'order_id',v_order));
  end loop;
  perform public.rebuild_order_billet_requirements(v_order);
  if v_weight < 700 then
    select string_agg(signature_part,',' order by signature_part),string_agg(label_part,', ' order by signature_part)
      into v_signature,v_label from (select distinct
        concat_ws('|',upper(alloy),upper(temper),billet_diameter_inch::text) signature_part,
        concat_ws(' / ',alloy,temper,billet_diameter_inch::text||' in') label_part
        from public.order_billet_requirements where company_id=v_company and order_id=v_order and required_weight_kg>0) material;
    insert into public.factory_load_consolidations(company_id,order_id,manufacturing_weight_kg,compatibility_signature,compatibility_label,status,created_by)
      values(v_company,v_order,v_weight,coalesce(v_signature,'ORDER:'||v_order::text),coalesce(v_label,'Material requirement not captured'),'pending',v_actor);
  end if;
  if v_role in ('owner','admin') then perform public.allocate_billets_by_priority(v_company); end if;
  insert into public.order_stage_history(company_id,order_id,stage,changed_by,remarks)
    values(v_company,v_order,'order_confirmed',v_actor,case when v_weight<700 then 'Direct priced order; waiting for factory load consolidation' else 'Direct priced order created' end);
  insert into public.audit_logs(company_id,actor_id,action,entity_type,entity_id,metadata_json)
    values(v_company,v_actor,'direct_order_created','order',v_order,jsonb_build_object('source','direct','line_count',jsonb_array_length(v_lines),'weight_kg',v_weight));
  update private.direct_order_requests set completed=true where company_id=v_company and idempotency_key=p_idempotency_key;
  return v_order;
end;
$$;

create or replace function public.create_direct_order_atomic(p_order jsonb, p_items jsonb, p_idempotency_key uuid)
returns uuid language sql security definer set search_path=public,private as $$
  select private.create_direct_order_atomic(p_order,p_items,p_idempotency_key);
$$;
revoke all on function private.create_direct_order_atomic(jsonb,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.create_direct_order_atomic(jsonb,jsonb,uuid) from public,anon;
grant execute on function public.create_direct_order_atomic(jsonb,jsonb,uuid) to authenticated;

create or replace function private.guard_direct_order_snapshots()
returns trigger language plpgsql security definer set search_path=public,private as $$
declare
  v_order uuid;
  v_company uuid;
  v_allowed boolean;
begin
  if auth.uid() is null then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  if tg_table_name='orders' then
    if tg_op in ('UPDATE','DELETE') then v_order:=old.id; v_company:=old.company_id;
    else v_order:=new.id; v_company:=new.company_id; end if;
  else
    if tg_op='DELETE' then v_order:=old.order_id; v_company:=old.company_id;
    else v_order:=new.order_id; v_company:=new.company_id; end if;
    if tg_op='UPDATE' and exists(select 1 from private.direct_order_requests where order_id=old.order_id and company_id=old.company_id) then
      raise exception 'Direct order lines are immutable; create a corrected order after reviewing existing commitments';
    end if;
  end if;
  if not exists(select 1 from private.direct_order_requests where order_id=v_order and company_id=v_company) then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  select exists(select 1 from private.direct_order_requests where order_id=v_order and company_id=v_company
    and transaction_id=txid_current() and actor_id=auth.uid() and not completed) into v_allowed;
  if tg_op='INSERT' and v_allowed then return new; end if;
  if tg_table_name='orders' and tg_op='UPDATE' then
    if jsonb_build_array(new.id,new.company_id,new.customer_id,new.quote_id,new.dealer_id,new.order_number,new.order_date,
      new.requested_weight_kg,new.manufacturing_weight_kg,new.dealer_fulfilled_weight_kg,new.production_profile_id,new.production_die_id,
      new.production_quantity_kg,new.production_pieces,new.billet_diameter_required_inch)
      is not distinct from jsonb_build_array(old.id,old.company_id,old.customer_id,old.quote_id,old.dealer_id,old.order_number,old.order_date,
      old.requested_weight_kg,old.manufacturing_weight_kg,old.dealer_fulfilled_weight_kg,old.production_profile_id,old.production_die_id,
      old.production_quantity_kg,old.production_pieces,old.billet_diameter_required_inch)
      and (new.order_value is not distinct from old.order_value or v_allowed) then return new; end if;
  end if;
  raise exception 'Direct order commercial snapshots are immutable; review commitments and create a corrected order';
end;
$$;
revoke all on function private.guard_direct_order_snapshots() from public,anon,authenticated;
create trigger zy_guard_direct_order_snapshots before insert or update or delete on public.orders
  for each row execute function private.guard_direct_order_snapshots();
create trigger zy_guard_direct_order_line_snapshots before insert or update or delete on public.order_items
  for each row execute function private.guard_direct_order_snapshots();

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
  if tg_op='UPDATE' and exists(select 1 from private.direct_order_requests request
    where request.transaction_id=txid_current() and request.company_id=new.company_id
      and request.order_id=new.id and request.actor_id=auth.uid() and not request.completed)
    and (to_jsonb(new)-array['order_value','updated_at']) is not distinct from (to_jsonb(old)-array['order_value','updated_at']) then
    return new;
  end if;
  if tg_op='UPDATE' and exists(
    select 1 from private.quote_fulfillment_authorizations auth_record
    where auth_record.transaction_id=txid_current() and auth_record.company_id=new.company_id
      and auth_record.quote_id=new.quote_id and auth_record.actor_id=auth.uid()
  ) then
    if (to_jsonb(new)-array['dealer_fulfilled_weight_kg','manufacturing_weight_kg','fulfillment_notes','updated_at'])
      is distinct from (to_jsonb(old)-array['dealer_fulfilled_weight_kg','manufacturing_weight_kg','fulfillment_notes','updated_at'])
      or new.dealer_fulfilled_weight_kg < 0
      or new.manufacturing_weight_kg < 0
      or abs(new.requested_weight_kg-new.dealer_fulfilled_weight_kg-new.manufacturing_weight_kg)>0.001 then
      raise exception 'Quote fulfillment may only reconcile its authorized physical balances' using errcode='42501';
    end if;
    return new;
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

create or replace function private.guard_order_item_workflow_writes()
returns trigger language plpgsql set search_path = public, private as $$
declare
  v_role text := private.get_current_user_role();
begin
  if auth.uid() is null or v_role in ('owner','admin') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op='INSERT' and current_user<>'authenticated' then
    if exists(select 1 from private.direct_order_requests request
      where request.transaction_id=txid_current() and request.company_id=new.company_id
        and request.order_id=new.order_id and request.actor_id=auth.uid() and not request.completed) then
      return new;
    end if;
  end if;
  if tg_op='UPDATE' and current_user<>'authenticated' then
  if exists(
    select 1 from private.quote_fulfillment_authorizations auth_record
    join public.orders order_record on order_record.quote_id=auth_record.quote_id
      and order_record.company_id=auth_record.company_id
    where auth_record.transaction_id=txid_current() and auth_record.company_id=new.company_id
      and order_record.id=new.order_id and auth_record.actor_id=auth.uid()
  ) then
    if (to_jsonb(new)-array['dealer_fulfilled_weight_kg','manufacturing_weight_kg','updated_at'])
      is distinct from (to_jsonb(old)-array['dealer_fulfilled_weight_kg','manufacturing_weight_kg','updated_at'])
      or new.dealer_fulfilled_weight_kg < 0 or new.manufacturing_weight_kg < 0
      or not exists(
        select 1 from public.quote_items source
        where source.id=new.quote_item_id and source.company_id=new.company_id
          and abs(coalesce(source.billing_weight_kg,source.total_weight_kg,0)
            -new.dealer_fulfilled_weight_kg-new.manufacturing_weight_kg)<=0.001
      ) then
      raise exception 'Quote fulfillment may only reconcile its exact source-line balances' using errcode='42501';
    end if;
    return new;
  end if;
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
revoke all on function private.guard_order_workflow_writes() from public,anon,authenticated;
revoke all on function private.guard_order_item_workflow_writes() from public,anon,authenticated;

create or replace function private.rebuild_direct_order_billet_requirements(p_order_id uuid)
returns void language plpgsql security definer set search_path=public,private as $$
declare
  v_order public.orders%rowtype;
  v_group record;
  v_billet_weight numeric;
  v_count integer;
begin
  select * into v_order from public.orders where id=p_order_id;
  if not found then return; end if;
  delete from public.order_billet_requirements requirement
    where requirement.company_id=v_order.company_id and requirement.order_id=v_order.id
      and not exists(select 1 from public.foundry_billets billet where billet.company_id=requirement.company_id
        and billet.allocation_requirement_id=requirement.id and billet.status in ('allocated','issued','consumed'));
  if v_order.current_stage in ('closed','cancelled') then
    update public.order_billet_requirements set status='cancelled' where company_id=v_order.company_id and order_id=v_order.id;
    update public.orders set billets_required=0,billets_allocated=0,billets_short=0,billet_allocation_status='not_required'
      where id=v_order.id and company_id=v_order.company_id;
    return;
  end if;
  for v_group in
    select material.profile_id,material.alloy,material.temper,material.billet_diameter_inch diameter,round(sum(material.weight_kg),3) weight
    from private.direct_order_requests request
    cross join lateral jsonb_to_recordset(request.material_snapshot)
      material(profile_id uuid,alloy text,temper text,billet_diameter_inch numeric,weight_kg numeric)
    where request.company_id=v_order.company_id and request.order_id=v_order.id
    group by material.profile_id,material.alloy,material.temper,material.billet_diameter_inch
  loop
    if v_group.weight<=0 or v_group.alloy is null or v_group.temper is null or coalesce(v_group.diameter,0)<=0 then
      raise exception 'Direct order material requirements are incomplete';
    end if;
    v_billet_weight:=round((pi()*power(((v_group.diameter*25.4)/2000),2)*(5800/1000.0)*2700)::numeric,3);
    v_count:=greatest(1,ceil((v_group.weight/0.75)/v_billet_weight)::integer);
    insert into public.order_billet_requirements(company_id,order_id,profile_id,alloy,temper,billet_diameter_inch,billet_length_mm,
      required_weight_kg,billet_weight_kg,billets_required,extrusion_efficiency_percent)
      values(v_order.company_id,v_order.id,v_group.profile_id,v_group.alloy,v_group.temper,v_group.diameter,5800,v_group.weight,v_billet_weight,v_count,75)
      on conflict(company_id,order_id,profile_id,alloy,temper,billet_diameter_inch) do update set
        required_weight_kg=excluded.required_weight_kg,billet_weight_kg=excluded.billet_weight_kg,billets_required=excluded.billets_required,
        extrusion_efficiency_percent=75,status=case when public.order_billet_requirements.status='cancelled' then 'pending' else public.order_billet_requirements.status end,updated_at=now();
  end loop;
  with surplus as (
    select billet.id,row_number() over(partition by billet.allocation_requirement_id order by billet.allocated_at desc nulls last,billet.created_at desc) allocation_rank,
      requirement.billets_required
    from public.foundry_billets billet join public.order_billet_requirements requirement
      on requirement.id=billet.allocation_requirement_id and requirement.company_id=billet.company_id
    where requirement.company_id=v_order.company_id and requirement.order_id=v_order.id and billet.status='allocated'
  ) update public.foundry_billets billet set order_id=null,allocation_requirement_id=null,status='cast',allocated_at=null,allocated_by=null,updated_at=now()
    from surplus where billet.id=surplus.id and surplus.allocation_rank>surplus.billets_required;
  perform public.refresh_order_billet_allocations(v_order.id);
end;
$$;
revoke all on function private.rebuild_direct_order_billet_requirements(uuid) from public,anon,authenticated;

create or replace function public.rebuild_order_billet_requirements(p_order_id uuid)
returns void language plpgsql security definer set search_path=public,private as $$
declare
  v_order record;
  v_quote_total numeric;
  v_target_weight numeric;
  v_group record;
  v_required_weight numeric;
  v_billet_weight numeric;
  v_required_count integer;
begin
  if exists(select 1 from private.direct_order_requests where order_id=p_order_id) then
    perform private.rebuild_direct_order_billet_requirements(p_order_id);
    return;
  end if;
  select * into v_order from public.orders where id = p_order_id;
  if v_order.id is null then return; end if;

  delete from public.order_billet_requirements r
  where r.company_id = v_order.company_id
    and r.order_id = v_order.id
    and not exists (
      select 1 from public.foundry_billets b
      where b.company_id = r.company_id and b.allocation_requirement_id = r.id and b.status in ('allocated','issued','consumed')
    );

  if v_order.current_stage in ('closed','cancelled') then
    update public.order_billet_requirements set status = 'cancelled' where company_id = v_order.company_id and order_id = v_order.id;
    perform public.refresh_order_billet_allocations(v_order.id);
    return;
  end if;

  if v_order.quote_id is not null then
    select round(coalesce(sum(coalesce(qi.billing_weight_kg, qi.total_weight_kg, 0)), 0)::numeric, 3)
    into v_quote_total
    from public.quote_items qi
    where qi.company_id = v_order.company_id and qi.quote_id = v_order.quote_id and qi.profile_id is not null;

    v_target_weight := coalesce(nullif(v_order.manufacturing_weight_kg, 0), nullif(v_order.production_quantity_kg, 0), v_quote_total, 0);

    for v_group in
      select qi.profile_id,
             nullif(p.alloy, '') as alloy,
             nullif(p.temper, '') as temper,
             coalesce(v_order.billet_diameter_required_inch, d.billet_diameter_required_inch, p.billet_diameter_required_inch) as billet_diameter_inch,
             round(sum(coalesce(qi.billing_weight_kg, qi.total_weight_kg, 0))::numeric, 3) as group_weight
      from public.quote_items qi
      join public.aluminium_profiles p on p.id = qi.profile_id and p.company_id = qi.company_id
      left join public.dies d on d.id = coalesce(qi.die_id, v_order.production_die_id) and d.company_id = qi.company_id
      where qi.company_id = v_order.company_id and qi.quote_id = v_order.quote_id and qi.profile_id is not null
      group by qi.profile_id, nullif(p.alloy, ''), nullif(p.temper, ''), coalesce(v_order.billet_diameter_required_inch, d.billet_diameter_required_inch, p.billet_diameter_required_inch)
    loop
      v_required_weight := case when coalesce(v_quote_total, 0) > 0 then round((v_group.group_weight * v_target_weight / v_quote_total)::numeric, 3) else 0 end;
      v_billet_weight := round((pi() * power(((v_group.billet_diameter_inch * 25.4) / 2000), 2) * (5800 / 1000.0) * 2700)::numeric, 3);
      v_required_count := case when v_required_weight > 0 and v_billet_weight > 0 then greatest(1, ceil((v_required_weight / 0.75) / v_billet_weight)::integer) else 0 end;

      insert into public.order_billet_requirements(company_id, order_id, profile_id, alloy, temper, billet_diameter_inch, billet_length_mm, required_weight_kg, billet_weight_kg, billets_required, extrusion_efficiency_percent)
      values (v_order.company_id, v_order.id, v_group.profile_id, v_group.alloy, v_group.temper, v_group.billet_diameter_inch, 5800, v_required_weight, v_billet_weight, v_required_count, 75)
      on conflict (company_id, order_id, profile_id, alloy, temper, billet_diameter_inch) do update set
        required_weight_kg = excluded.required_weight_kg,
        billet_weight_kg = excluded.billet_weight_kg,
        billets_required = excluded.billets_required,
        extrusion_efficiency_percent = 75,
        status = case when public.order_billet_requirements.status = 'cancelled' then 'pending' else public.order_billet_requirements.status end,
        updated_at = now();
    end loop;
  elsif v_order.production_profile_id is not null and coalesce(v_order.production_quantity_kg, v_order.manufacturing_weight_kg, 0) > 0 then
    select coalesce(v_order.production_quantity_kg, v_order.manufacturing_weight_kg, 0) into v_required_weight;
    for v_group in
      select p.id as profile_id,
             nullif(p.alloy, '') as alloy,
             nullif(p.temper, '') as temper,
             coalesce(v_order.billet_diameter_required_inch, d.billet_diameter_required_inch, p.billet_diameter_required_inch) as billet_diameter_inch
      from public.aluminium_profiles p
      left join public.dies d on d.id = v_order.production_die_id and d.company_id = p.company_id
      where p.id = v_order.production_profile_id and p.company_id = v_order.company_id
    loop
      v_billet_weight := round((pi() * power(((v_group.billet_diameter_inch * 25.4) / 2000), 2) * (5800 / 1000.0) * 2700)::numeric, 3);
      v_required_count := case when v_required_weight > 0 and v_billet_weight > 0 then greatest(1, ceil((v_required_weight / 0.75) / v_billet_weight)::integer) else 0 end;
      insert into public.order_billet_requirements(company_id, order_id, profile_id, alloy, temper, billet_diameter_inch, billet_length_mm, required_weight_kg, billet_weight_kg, billets_required, extrusion_efficiency_percent)
      values (v_order.company_id, v_order.id, v_group.profile_id, v_group.alloy, v_group.temper, v_group.billet_diameter_inch, 5800, v_required_weight, v_billet_weight, v_required_count, 75)
      on conflict (company_id, order_id, profile_id, alloy, temper, billet_diameter_inch) do update set
        required_weight_kg = excluded.required_weight_kg,
        billet_weight_kg = excluded.billet_weight_kg,
        billets_required = excluded.billets_required,
        extrusion_efficiency_percent = 75,
        updated_at = now();
    end loop;
  end if;

  with surplus as (
    select b.id,
           row_number() over (partition by b.allocation_requirement_id order by b.allocated_at desc nulls last, b.created_at desc) as allocation_rank,
           r.billets_required
    from public.foundry_billets b
    join public.order_billet_requirements r on r.id = b.allocation_requirement_id and r.company_id = b.company_id
    where r.company_id = v_order.company_id
      and r.order_id = v_order.id
      and b.status = 'allocated'
  )
  update public.foundry_billets b
  set order_id = null,
      allocation_requirement_id = null,
      status = 'cast',
      allocated_at = null,
      allocated_by = null,
      updated_at = now()
  from surplus s
  where b.id = s.id and s.allocation_rank > s.billets_required;

  perform public.refresh_order_billet_allocations(v_order.id);
end;
$$;
revoke all on function public.rebuild_order_billet_requirements(uuid) from public,anon,authenticated;

create or replace function public.handle_order_billet_requirements()
returns trigger language plpgsql security definer set search_path=public,private as $$
begin
  perform public.rebuild_order_billet_requirements(new.id);
  -- Sales can capture a priced order; factory roles retain billet allocation.
  if not exists(select 1 from private.direct_order_requests where order_id=new.id and company_id=new.company_id)
    or auth.uid() is null or private.get_current_user_role() in ('owner','admin','factory_manager','production_manager','production') then
    perform public.allocate_billets_by_priority(new.company_id);
  end if;
  return new;
end;
$$;
revoke all on function public.handle_order_billet_requirements() from public,anon,authenticated;

-- New direct orders keep their agreed line tax even if a packing payload contains
-- a different percentage. The existing precedence remains for legacy sources.
create or replace function private.canonicalize_invoice_tax_line()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  select coalesce(nullif(oi.hsn_code, ''), nullif(qi.hsn_code, ''), nullif(p.hsn_code, '')),
    case when exists(select 1 from private.direct_order_requests request where request.order_id=oi.order_id and request.company_id=oi.company_id)
      then oi.gst_percent else coalesce(pl.gst_percent, oi.gst_percent, qi.gst_percent, q.gst_percent) end
  into new.hsn_code, new.gst_percent
  from public.packing_list_items pl
  left join public.order_items oi on oi.id = pl.order_item_id and oi.company_id = pl.company_id
  left join public.quote_items qi on qi.id = pl.quote_item_id and qi.company_id = pl.company_id
  left join public.quotes q on q.id = qi.quote_id and q.company_id = qi.company_id
  left join public.aluminium_profiles p on p.id = pl.profile_id and p.company_id = pl.company_id
  where pl.id = new.source_line_id and pl.company_id = new.company_id;
  if new.hsn_code is null or new.hsn_code !~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$' then
    raise exception 'Set a valid HSN code on every invoiced profile';
  end if;
  if new.gst_percent is null or new.gst_percent < 0 or new.gst_percent > 100 then
    raise exception 'Every invoiced source line requires a valid GST rate';
  end if;
  return new;
end;
$$;
revoke all on function private.canonicalize_invoice_tax_line() from public,anon,authenticated;

-- The older header-save endpoint remains for edits and quotation snapshots.
-- New direct orders must use the atomic priced-line workflow above.
create or replace function private.save_order_atomic(p_order_id uuid, p_order jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_customer_id uuid := nullif(p_order ->> 'customer_id', '')::uuid;
  v_quote_id uuid := nullif(p_order ->> 'quote_id', '')::uuid;
  v_payload jsonb;
  v_order_id uuid;
  v_item jsonb;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if private.get_current_user_role() is null then raise exception 'Permission denied for orders' using errcode = '42501'; end if;
  if p_order_id is null and v_quote_id is null then
    raise exception 'Use direct priced order entry with at least one complete priced profile line' using errcode='23514';
  end if;
  if p_order_id is null and private.get_current_user_role() not in ('owner','admin','sales','sales_manager','factory_manager','production_manager') then
    raise exception 'Permission denied for orders' using errcode = '42501';
  end if;
  if p_order_id is not null and private.get_current_user_role() not in ('owner','admin','sales_manager','factory_manager','production_manager','production','dispatch_manager') then
    raise exception 'Permission denied for orders' using errcode = '42501';
  end if;
  perform 1 from public.customers where id = v_customer_id and company_id = v_company_id;
  if not found then raise exception 'Customer not found for this company'; end if;
  if v_quote_id is not null and not exists (
    select 1 from public.quotes where id = v_quote_id and company_id = v_company_id and customer_id = v_customer_id
  ) then
    raise exception 'Quote not found for this customer and company';
  end if;

  v_payload := private.keep_jsonb_keys(p_order, array[
      'quote_id','customer_id','production_profile_id','production_die_id','production_quantity_kg',
      'production_pieces','billet_diameter_required_inch','production_notes','order_date',
      'expected_dispatch_date','priority','current_stage','order_value','notes','dealer_id'
    ])
    || jsonb_build_object('company_id', v_company_id, 'customer_id', v_customer_id);

  if p_order_id is null then
    v_payload := v_payload || jsonb_build_object(
      'order_number', private.next_business_number_locked(
        'public.orders'::regclass, 'order_number', v_company_id, 'O',
        coalesce(nullif(v_payload ->> 'order_date', '')::date, current_date)
      ), 'created_by', auth.uid()
    );
    v_order_id := private.insert_jsonb_row('public.orders'::regclass, v_payload);
  else
    perform 1 from public.orders where id = p_order_id and company_id = v_company_id for update;
    if not found then raise exception 'Order not found for this company'; end if;
    v_order_id := private.update_jsonb_row('public.orders'::regclass, p_order_id, v_company_id, v_payload || jsonb_build_object('updated_at', now()));
  end if;

  if p_order_id is null and v_quote_id is not null then
    for v_item in select to_jsonb(qi) from public.quote_items qi
      where qi.company_id = v_company_id and qi.quote_id = v_quote_id
      order by qi.created_at, qi.id
    loop
      perform private.insert_jsonb_row(
        'public.order_items'::regclass,
        (v_item - array['id','company_id','quote_id','created_at','updated_at'])
          || jsonb_build_object(
            'company_id', v_company_id, 'order_id', v_order_id,
            'source_record_id', v_quote_id,
            'source_line_id', nullif(v_item ->> 'id', '')::uuid,
            'quote_item_id', nullif(v_item ->> 'id', '')::uuid,
            'created_at', now(), 'updated_at', now()
          )
      );
    end loop;
  end if;
  return v_order_id;
end;
$$;
revoke all on function private.save_order_atomic(uuid,jsonb) from public,anon,authenticated;

commit;

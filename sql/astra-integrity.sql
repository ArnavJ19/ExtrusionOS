-- Audit follow-up. Existing records are neither renumbered nor repriced.
create or replace function private.next_business_number_locked(p_table regclass, p_number_column text, p_company_id uuid, p_prefix text, p_business_date date)
returns text language plpgsql set search_path = public, private as $$
declare
  v_stem text := p_prefix || '-' || extract(year from coalesce(p_business_date, (now() at time zone 'Asia/Kolkata')::date))::text || '-';
  v_sequence bigint;
begin
  if nullif(p_prefix, '') is null or p_company_id is null then raise exception 'Number prefix and company are required'; end if;
  if not exists (select 1 from pg_attribute where attrelid = p_table and attname = p_number_column and attnum > 0 and not attisdropped) then
    raise exception 'Invalid business number column';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':' || p_table::text || ':' || v_stem, 0));
  execute format('select coalesce(max(substring(%1$I from length($2) + 1)::bigint), 0) + 1 from %2$s where company_id = $1 and left(%1$I, length($2)) = $2 and substring(%1$I from length($2) + 1) ~ ''^[0-9]+$''', p_number_column, p_table)
    using p_company_id, v_stem into v_sequence;
  return v_stem || lpad(v_sequence::text, greatest(4, length(v_sequence::text)), '0');
end;
$$;
revoke all on function private.next_business_number_locked(regclass,text,uuid,text,date) from public, anon, authenticated;

create trigger aa_assign_business_number before insert on public.system_configurations
for each row execute function private.assign_business_number('configuration_number','SC','');
create trigger aa_lock_business_number before update on public.system_configurations
for each row execute function private.assign_business_number('configuration_number','SC','');

-- Remove permissive policies, including surviving legacy FOR ALL policies.
do $$
declare t text; p record;
begin
  foreach t in array array['system_configurations','system_panels','system_profile_cuts','system_glass_cuts','system_beading_cuts','system_hardware_bom','system_material_summary','profile_optimization_runs','system_reports','system_series','system_profiles','system_templates','hardware_items','glass_items','finish_options','profile_stock_reservations'] loop
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('create policy astra_read on public.%I for select to authenticated using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''sales_manager'',''sales'',''production_manager'',''production'',''factory_manager'',''inventory_manager'',''viewer''))', t);
    if t = 'profile_stock_reservations' then
      execute format('create policy astra_write on public.%I for all to authenticated using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''production_manager'',''factory_manager'',''inventory_manager'')) with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''production_manager'',''factory_manager'',''inventory_manager''))', t);
    else
      execute format('create policy astra_insert on public.%I for insert to authenticated with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''sales_manager''))', t);
      execute format('create policy astra_update on public.%I for update to authenticated using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''sales_manager'')) with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''sales_manager''))', t);
      execute format('create policy astra_delete on public.%I for delete to authenticated using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin''))', t);
    end if;
  end loop;
end;
$$;

create or replace function private.guard_configuration_lifecycle()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare ref record; valid_ref boolean;
begin
  if tg_op = 'DELETE' then
    if old.order_id is not null or old.quote_id is not null or old.status::text in ('in_production','converted_to_order') then
      raise exception 'Linked configurations cannot be deleted';
    end if;
    return old;
  end if;
  for ref in select * from (values ('customer_id','customers'),('series_id','system_series'),('template_id','system_templates'),('finish_id','finish_options'),('glass_id','glass_items'),('quote_id','quotes'),('order_id','orders')) as refs(col,tab) loop
    if nullif(to_jsonb(new)->>ref.col,'') is not null then
      execute format('select exists(select 1 from public.%I where id=$1 and company_id=$2)',ref.tab) into valid_ref using (to_jsonb(new)->>ref.col)::uuid,new.company_id;
      if not valid_ref then raise exception 'Configuration reference belongs to another company'; end if;
    end if;
  end loop;
  if tg_op = 'UPDATE' then
    if old.company_id is distinct from new.company_id then raise exception 'Configuration company is immutable'; end if;
    if (old.order_id is not null or old.quote_id is not null or old.status::text in ('in_production','converted_to_order'))
      and (to_jsonb(old) - array['updated_at','status','order_id'] is distinct from to_jsonb(new) - array['updated_at','status','order_id']
        or (old.order_id is not null and old.order_id is distinct from new.order_id)
        or new.status::text in ('draft','calculated')) then
      raise exception 'Linked configurations are immutable; create a new configuration for revisions';
    end if;
    if old.status::text = 'in_production' and new.status is distinct from old.status then raise exception 'Production-linked configuration cannot be reset'; end if;
  end if;
  if new.status::text = 'in_production' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    if coalesce(private.get_current_user_role(),'') not in ('owner','admin','production_manager','factory_manager') or new.order_id is null
      or not exists (select 1 from public.production_jobs where company_id=new.company_id and order_id=new.order_id) then
      raise exception 'Use the production handoff to enter production' using errcode='42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_configuration_lifecycle() from public, anon, authenticated;
create trigger astra_configuration_lifecycle before insert or update or delete on public.system_configurations
for each row execute function private.guard_configuration_lifecycle();

create or replace function private.guard_configuration_child()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare c public.system_configurations%rowtype; r jsonb; ref record; valid_ref boolean;
begin
  r := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if tg_op='UPDATE' and (new.company_id is distinct from old.company_id or new.configuration_id is distinct from old.configuration_id) then
    raise exception 'Calculation lineage is immutable';
  end if;
  select * into c from public.system_configurations where id=(r->>'configuration_id')::uuid and company_id=(r->>'company_id')::uuid for update;
  if not found then
    -- Parent deletion already passed the lifecycle guard before its FK cascade.
    if tg_op='DELETE' then return old; end if;
    raise exception 'Configuration not found for this company';
  end if;
  if c.order_id is not null or c.quote_id is not null or c.status::text in ('in_production','converted_to_order') then
    raise exception 'Linked configuration calculations are immutable';
  end if;
  for ref in select * from (values ('profile_id','aluminium_profiles'),('glass_id','glass_items'),('hardware_item_id','hardware_items')) as refs(col,tab) loop
    if nullif(r->>ref.col,'') is not null then
      execute format('select exists(select 1 from public.%I where id=$1 and company_id=$2)',ref.tab) into valid_ref using (r->>ref.col)::uuid, c.company_id;
      if not valid_ref then raise exception 'Calculation reference belongs to another company'; end if;
    end if;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.guard_configuration_child() from public, anon, authenticated;
do $$ declare t text; begin
  foreach t in array array['system_panels','system_profile_cuts','system_glass_cuts','system_beading_cuts','system_hardware_bom','system_material_summary','profile_optimization_runs'] loop
    execute format('create trigger astra_configuration_child before insert or update or delete on public.%I for each row execute function private.guard_configuration_child()',t);
  end loop;
end; $$;

create or replace function public.save_system_configuration_atomic(p_configuration_id uuid, p_mode text, p_expected_updated_at timestamptz, p_header jsonb, p_rows jsonb)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  v_company uuid := private.get_current_user_company_id();
  c public.system_configurations%rowtype; t text; r jsonb; h jsonb;
begin
  if auth.uid() is null or v_company is null or coalesce(private.get_current_user_role(),'') not in ('owner','admin','sales_manager') then raise exception 'Permission denied' using errcode='42501'; end if;
  select * into c from public.system_configurations where id=p_configuration_id and company_id=v_company for update;
  if not found then raise exception 'Configuration not found'; end if;
  if c.order_id is not null or c.quote_id is not null or c.status::text in ('in_production','converted_to_order') then raise exception 'Linked configurations are immutable; create a new configuration for revisions'; end if;
  if p_mode not in ('draft','calculation') or p_mode is null then raise exception 'Invalid save mode'; end if;
  if p_mode='calculation' and (p_expected_updated_at is null or p_expected_updated_at is distinct from c.updated_at) then raise exception 'Configuration changed; reload and calculate again'; end if;
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

create or replace function private.guard_profile_reservation_capacity()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare b public.profile_stock_batches%rowtype; reserved numeric; c public.system_configurations%rowtype;
begin
  if tg_op='UPDATE' and (new.company_id is distinct from old.company_id or new.profile_stock_batch_id is distinct from old.profile_stock_batch_id or new.profile_id is distinct from old.profile_id or new.order_id is distinct from old.order_id or new.configuration_id is distinct from old.configuration_id) then
    raise exception 'Reservation source is immutable';
  end if;
  if new.configuration_id is not null then
    select * into c from public.system_configurations where id=new.configuration_id and company_id=new.company_id for update;
    if not found or c.order_id is distinct from new.order_id then raise exception 'Reservation configuration must match its order and company'; end if;
  end if;
  select * into b from public.profile_stock_batches where id=new.profile_stock_batch_id and company_id=new.company_id for update;
  if not found or b.profile_id is distinct from new.profile_id then raise exception 'Reservation batch must match its profile and company'; end if;
  if not exists(select 1 from public.orders where id=new.order_id and company_id=new.company_id) then raise exception 'Reservation order not found'; end if;
  if new.status='active' then
    if b.status not in ('available','reserved') then raise exception 'Stock batch is not available'; end if;
    select coalesce(sum(reserved_weight_kg),0) into reserved from public.profile_stock_reservations where profile_stock_batch_id=b.id and company_id=b.company_id and status='active' and id<>new.id;
    if reserved + new.reserved_weight_kg > b.total_weight_kg then raise exception 'Insufficient stock: active reservations exceed batch capacity'; end if;
    new.reserved_length_m := case when b.total_weight_kg > 0 then round(coalesce(b.length_m,0) * new.reserved_weight_kg / b.total_weight_kg,3) else 0 end;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_profile_reservation_capacity() from public, anon, authenticated;
create trigger astra_reservation_capacity before insert or update on public.profile_stock_reservations
for each row execute function private.guard_profile_reservation_capacity();

create or replace function private.guard_reserved_stock_capacity()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare reserved numeric;
begin
  select coalesce(sum(reserved_weight_kg),0) into reserved from public.profile_stock_reservations where company_id=old.company_id and profile_stock_batch_id=old.id and status='active';
  if reserved > 0 and (new.company_id is distinct from old.company_id or new.profile_id is distinct from old.profile_id or new.total_weight_kg < reserved or new.status not in ('available','reserved')) then
    raise exception 'Release or consume active reservations before changing reserved stock';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_reserved_stock_capacity() from public, anon, authenticated;
create trigger astra_reserved_stock before update on public.profile_stock_batches for each row execute function private.guard_reserved_stock_capacity();

create or replace function private.canonicalize_packing_tax()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if new.order_item_id is not null then
    select gst_percent into new.gst_percent from public.order_items
    where id=new.order_item_id and company_id=new.company_id and profile_id=new.profile_id;
  elsif new.quote_item_id is not null then
    select coalesce(qi.gst_percent,q.gst_percent) into new.gst_percent
    from public.quote_items qi join public.quotes q on q.id=qi.quote_id and q.company_id=qi.company_id
    where qi.id=new.quote_item_id and qi.company_id=new.company_id and qi.profile_id=new.profile_id;
  else
    new.gst_percent := null;
  end if;
  if new.gst_percent is null or new.gst_percent < 0 or new.gst_percent > 100 then
    raise exception 'Packing requires an authoritative commercial source and GST rate';
  end if;
  return new;
end;
$$;
revoke all on function private.canonicalize_packing_tax() from public, anon, authenticated;
create trigger zzzz_canonicalize_packing_tax before insert or update on public.packing_list_items for each row execute function private.canonicalize_packing_tax();

alter table public.invoices add column if not exists supplier_snapshot jsonb, add column if not exists customer_snapshot jsonb;
create or replace function private.snapshot_invoice_parties()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if tg_op='INSERT' then
    select jsonb_build_object('name',name,'legal_name',legal_name,'gst_number',gst_number,'billing_address',billing_address) into new.supplier_snapshot from public.companies where id=new.company_id;
    select jsonb_build_object('customer_name',customer_name,'company_name',company_name,'gst_number',gst_number,'billing_address',billing_address,'shipping_address',shipping_address) into new.customer_snapshot from public.customers where id=new.customer_id and company_id=new.company_id;
    if new.supplier_snapshot is null or new.customer_snapshot is null then raise exception 'Invoice parties must belong to the authenticated company'; end if;
  elsif old.supplier_snapshot is distinct from new.supplier_snapshot or old.customer_snapshot is distinct from new.customer_snapshot or old.company_id is distinct from new.company_id or old.customer_id is distinct from new.customer_id then
    raise exception 'Invoice party snapshots and identities are immutable';
  end if;
  return new;
end;
$$;
revoke all on function private.snapshot_invoice_parties() from public, anon, authenticated;
create trigger zzzz_snapshot_invoice_parties before insert or update on public.invoices for each row execute function private.snapshot_invoice_parties();

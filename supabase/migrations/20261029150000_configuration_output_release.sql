begin;

create unique index if not exists system_configurations_company_id_pair
  on public.system_configurations(company_id,id);

create table public.configuration_rule_revisions (
  company_id uuid primary key references public.companies(id) on delete cascade,
  revision bigint not null default 0 check(revision >= 0),
  updated_at timestamptz not null default clock_timestamp()
);
insert into public.configuration_rule_revisions(company_id,revision)
select id,0 from public.companies on conflict(company_id) do nothing;

create table public.configuration_output_revisions (
  company_id uuid not null references public.companies(id) on delete cascade,
  configuration_id uuid not null,
  revision bigint not null default 0 check(revision >= 0),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(company_id,configuration_id),
  foreign key(company_id,configuration_id) references public.system_configurations(company_id,id) on delete cascade
);
insert into public.configuration_output_revisions(company_id,configuration_id,revision)
select company_id,id,0 from public.system_configurations on conflict(company_id,configuration_id) do nothing;

create table public.configuration_output_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  configuration_id uuid not null,
  revision integer not null check(revision > 0),
  request_id uuid not null,
  request_fingerprint text not null check(request_fingerprint ~ '^[0-9a-f]{32}$'),
  input_fingerprint text not null check(input_fingerprint ~ '^[0-9a-f]{64}$'),
  rules_fingerprint text not null check(rules_fingerprint ~ '^[0-9a-f]{64}$'),
  output_fingerprint text not null check(output_fingerprint ~ '^[0-9a-f]{64}$'),
  rules_revision bigint not null check(rules_revision >= 0),
  output_revision bigint not null check(output_revision >= 0),
  input_snapshot jsonb not null check(jsonb_typeof(input_snapshot)='object'),
  rules_snapshot jsonb not null check(jsonb_typeof(rules_snapshot)='object'),
  output_snapshot jsonb not null check(jsonb_typeof(output_snapshot)='object'),
  readiness text not null check(readiness in ('blocked','estimated','ready')),
  unresolved_reasons jsonb not null default '[]'::jsonb check(jsonb_typeof(unresolved_reasons)='array'),
  estimated_fields jsonb not null default '[]'::jsonb check(jsonb_typeof(estimated_fields)='array'),
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default clock_timestamp(),
  unique(company_id,configuration_id,revision),
  unique(company_id,request_id),
  unique(company_id,id),
  foreign key(company_id,configuration_id) references public.system_configurations(company_id,id) on delete cascade,
  check(pg_column_size(input_snapshot)+pg_column_size(rules_snapshot)+pg_column_size(output_snapshot) <= 5000000)
);
create index configuration_output_snapshot_latest on public.configuration_output_snapshots(company_id,configuration_id,revision desc);

create table public.configuration_output_reviews (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  configuration_id uuid not null,
  snapshot_id uuid not null,
  request_id uuid not null,
  request_fingerprint text not null check(request_fingerprint ~ '^[0-9a-f]{32}$'),
  output_fingerprint text not null check(output_fingerprint ~ '^[0-9a-f]{64}$'),
  decision text not null check(decision in ('approved','returned')),
  note text not null default '' check(length(note) <= 1000),
  reviewed_by uuid not null references public.app_users(id),
  reviewed_at timestamptz not null default clock_timestamp(),
  unique(company_id,request_id),
  unique(company_id,snapshot_id,reviewed_by),
  foreign key(company_id,configuration_id) references public.system_configurations(company_id,id) on delete cascade,
  foreign key(company_id,snapshot_id) references public.configuration_output_snapshots(company_id,id) on delete cascade
);
create index configuration_output_reviews_latest on public.configuration_output_reviews(company_id,snapshot_id,reviewed_at desc);

create table public.configuration_output_handoffs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  configuration_id uuid not null,
  snapshot_id uuid not null,
  order_id uuid not null references public.orders(id),
  handed_off_by uuid not null references public.app_users(id),
  handed_off_at timestamptz not null default clock_timestamp(),
  unique(company_id,configuration_id),
  foreign key(company_id,configuration_id) references public.system_configurations(company_id,id) on delete cascade,
  foreign key(company_id,snapshot_id) references public.configuration_output_snapshots(company_id,id) on delete restrict
);

alter table public.configuration_rule_revisions enable row level security;
alter table public.configuration_output_revisions enable row level security;
alter table public.configuration_output_snapshots enable row level security;
alter table public.configuration_output_reviews enable row level security;
alter table public.configuration_output_handoffs enable row level security;
revoke all on public.configuration_rule_revisions,public.configuration_output_revisions,
  public.configuration_output_snapshots,public.configuration_output_reviews,
  public.configuration_output_handoffs from public,anon,authenticated;

create function private.configuration_rule_revision(p_company uuid) returns bigint
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare v_revision bigint;
begin
  insert into public.configuration_rule_revisions(company_id,revision) values(p_company,0)
    on conflict(company_id) do nothing;
  select revision into v_revision from public.configuration_rule_revisions where company_id=p_company for update;
  return v_revision;
end;
$$;
revoke all on function private.configuration_rule_revision(uuid) from public,anon,authenticated;

create function private.configuration_output_revision(p_company uuid,p_configuration uuid) returns bigint
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare v_revision bigint;
begin
  insert into public.configuration_output_revisions(company_id,configuration_id,revision)
    values(p_company,p_configuration,0) on conflict(company_id,configuration_id) do nothing;
  select revision into v_revision from public.configuration_output_revisions
    where company_id=p_company and configuration_id=p_configuration for update;
  return v_revision;
end;
$$;
revoke all on function private.configuration_output_revision(uuid,uuid) from public,anon,authenticated;

create function private.configuration_release_input(p_configuration uuid,p_company uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,public,private as $$
  select jsonb_build_object(
    'configuration_id',c.id::text,'company_id',c.company_id::text,'customer_id',c.customer_id::text,
    'series_id',c.series_id::text,'template_id',c.template_id::text,'system_type',c.system_type::text,
    'project_name',coalesce(c.project_name,''),'design_reference',c.design_reference,'location_label',c.location_label,
    'width_mm',c.width_mm,'height_mm',c.height_mm,'no_of_panels',c.no_of_panels,'quantity',c.quantity,
    'measurement_type',c.measurement_type::text,'view_direction',c.view_direction::text,
    'panel_layout_json',coalesce(c.panel_layout_json,'{}'::jsonb),'options_json',coalesce(c.options_json,'{}'::jsonb),
    'finish_id',c.finish_id::text,'glass_id',c.glass_id::text)
  from public.system_configurations c where c.id=p_configuration and c.company_id=p_company;
$$;
revoke all on function private.configuration_release_input(uuid,uuid) from public,anon,authenticated;

create function private.configuration_release_rules(p_configuration uuid,p_company uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,public,private as $$
  select jsonb_build_object(
    'series',(select jsonb_build_object('id',s.id::text,'company_id',s.company_id::text,'series_code',s.series_code,
      'series_name',s.series_name,'system_type',s.system_type,'stock_length_mm',s.stock_length_mm,
      'wastage_percent_default',s.wastage_percent_default,'is_active',s.is_active,'updated_at',s.updated_at)
      from public.system_series s where s.id=c.series_id and s.company_id=p_company),
    'profiles',coalesce((select jsonb_agg(jsonb_build_object('id',sp.id::text,'company_id',sp.company_id::text,
      'series_id',sp.series_id::text,'profile_id',sp.profile_id::text,'component_role',sp.component_role::text,
      'display_name',sp.display_name,'is_required',sp.is_required,'is_active',sp.is_active,'sort_order',sp.sort_order,
      'deduction_mm',sp.deduction_mm,'addition_mm',sp.addition_mm,'default_quantity_formula',sp.default_quantity_formula,
      'default_length_formula',sp.default_length_formula,'applies_to_system_types',to_jsonb(sp.applies_to_system_types),
      'aluminium_profiles',case when ap.id is null then null else jsonb_build_object('id',ap.id::text,
        'profile_code',ap.profile_code,'profile_name',ap.profile_name,'section_weight_kg_per_m',ap.section_weight_kg_per_m,
        'is_active',ap.is_active) end) order by sp.sort_order,sp.id)
      from public.system_profiles sp left join public.aluminium_profiles ap on ap.id=sp.profile_id and ap.company_id=p_company
      where sp.company_id=p_company and sp.series_id=c.series_id),'[]'::jsonb),
    'template',(select jsonb_build_object('id',t.id::text,'company_id',t.company_id::text,'template_code',t.template_code,
      'template_name',t.template_name,'system_type',t.system_type::text,'series_id',t.series_id::text,
      'formula_version',t.formula_version,'formula_json',t.formula_json,'validation_rules_json',t.validation_rules_json,
      'preview_config_json',t.preview_config_json,'is_active',t.is_active,'updated_at',t.updated_at)
      from public.system_templates t where t.id=c.template_id and t.company_id=p_company),
    'hardware_items',coalesce((select jsonb_agg(jsonb_build_object('id',h.id::text,'company_id',h.company_id::text,
      'item_code',h.item_code,'item_name',h.item_name,'hardware_category',h.hardware_category::text,'unit',h.unit,
      'default_rate',h.default_rate,'is_active',h.is_active,'updated_at',h.updated_at) order by h.item_code,h.id)
      from public.hardware_items h where h.company_id=p_company and h.is_active),'[]'::jsonb),
    'glass_item',(select jsonb_build_object('id',g.id::text,'company_id',g.company_id::text,'glass_code',g.glass_code,
      'glass_name',g.glass_name,'glass_type',g.glass_type::text,'thickness_mm',g.thickness_mm,
      'rate_per_sqft',g.rate_per_sqft,'rate_per_sqm',g.rate_per_sqm,'is_active',g.is_active,'updated_at',g.updated_at)
      from public.glass_items g where g.id=c.glass_id and g.company_id=p_company),
    'finish_option',(select jsonb_build_object('id',f.id::text,'company_id',f.company_id::text,'finish_code',f.finish_code,
      'finish_name',f.finish_name,'finish_type',f.finish_type::text,'rate_type',f.rate_type::text,'rate',f.rate,
      'is_active',f.is_active,'updated_at',f.updated_at)
      from public.finish_options f where f.id=c.finish_id and f.company_id=p_company),
    'company_settings',(select jsonb_build_object('default_gst_percent',s.default_gst_percent,
      'default_margin_percent',s.default_margin_percent,'default_conversion_charge_per_kg',s.default_conversion_charge_per_kg,
      'default_transport_charge',s.default_transport_charge)
      from public.company_settings s where s.company_id=p_company order by s.id limit 1))
  from public.system_configurations c where c.id=p_configuration and c.company_id=p_company;
$$;
revoke all on function private.configuration_release_rules(uuid,uuid) from public,anon,authenticated;

create function private.configuration_release_fingerprint(p_value jsonb) returns text
language sql immutable security definer set search_path=pg_catalog,public,private as $$
  select encode(extensions.digest(convert_to(coalesce(p_value,'null'::jsonb)::text,'UTF8'),'sha256'),'hex');
$$;
revoke all on function private.configuration_release_fingerprint(jsonb) from public,anon,authenticated;

create function private.configuration_release_saved_rows(p_configuration uuid,p_company uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,public,private as $$
select jsonb_build_object(
  'system_profile_cuts',coalesce((select jsonb_agg(jsonb_build_object('profile_id',profile_id::text,'component_role',component_role::text,
    'profile_code',profile_code,'profile_name',profile_name,'cut_length_mm',cut_length_mm,'quantity',quantity,
    'total_length_m',total_length_m,'section_weight_kg_per_m',section_weight_kg_per_m,'total_weight_kg',total_weight_kg,
    'angle_left',angle_left,'angle_right',angle_right,'deduction_mm',deduction_mm,'addition_mm',addition_mm,
    'stock_length_mm',stock_length_mm,'wastage_percent',wastage_percent,'remarks',remarks,'sort_order',sort_order)
    order by sort_order,id) from public.system_profile_cuts where configuration_id=p_configuration and company_id=p_company),'[]'::jsonb),
  'system_glass_cuts',coalesce((select jsonb_agg(jsonb_build_object('glass_id',glass_id::text,'panel_index',panel_index,
    'glass_label',glass_label,'width_mm',width_mm,'height_mm',height_mm,'quantity',quantity,'area_sqft',area_sqft,
    'area_sqm',area_sqm,'glass_type',glass_type::text,'thickness_mm',thickness_mm,'rate',rate,'amount',amount,
    'deduction_width_mm',deduction_width_mm,'deduction_height_mm',deduction_height_mm,'remarks',remarks)
    order by panel_index,glass_label,id) from public.system_glass_cuts where configuration_id=p_configuration and company_id=p_company),'[]'::jsonb),
  'system_beading_cuts',coalesce((select jsonb_agg(jsonb_build_object('profile_id',profile_id::text,'panel_index',panel_index,
    'bead_position',bead_position::text,'cut_length_mm',cut_length_mm,'quantity',quantity,'total_length_m',total_length_m,'remarks',remarks)
    order by panel_index,bead_position::text,profile_id,id) from public.system_beading_cuts where configuration_id=p_configuration and company_id=p_company),'[]'::jsonb),
  'system_hardware_bom',coalesce((select jsonb_agg(jsonb_build_object('hardware_item_id',hardware_item_id::text,'item_code',item_code,
    'item_name',item_name,'hardware_category',hardware_category::text,'quantity',quantity,'unit',unit,'rate',rate,'amount',amount,'remarks',remarks)
    order by hardware_category::text,item_code,hardware_item_id,id) from public.system_hardware_bom where configuration_id=p_configuration and company_id=p_company),'[]'::jsonb),
  'system_material_summary',coalesce((select jsonb_agg(jsonb_build_object('material_type',material_type::text,'item_id',item_id::text,
    'item_code',item_code,'item_name',item_name,'quantity',quantity,'unit',unit,'total_weight_kg',total_weight_kg,
    'total_length_m',total_length_m,'total_area_sqft',total_area_sqft,'total_area_sqm',total_area_sqm,'rate',rate,'amount',amount)
    order by material_type::text,item_code,item_id,unit,rate,id) from public.system_material_summary where configuration_id=p_configuration and company_id=p_company),'[]'::jsonb)
);
$$;
revoke all on function private.configuration_release_saved_rows(uuid,uuid) from public,anon,authenticated;

create function private.configuration_release_normalize_rows(p_rows jsonb) returns jsonb
language sql immutable set search_path=pg_catalog as $$
  select jsonb_object_agg(collection.key,(select coalesce(jsonb_agg(item.value order by item.value::text),'[]'::jsonb)
    from jsonb_array_elements(collection.value) item)) from jsonb_each(p_rows) collection;
$$;
revoke all on function private.configuration_release_normalize_rows(jsonb) from public,anon,authenticated;

create function private.configuration_release_outputs_match(p_configuration uuid,p_company uuid,p_output jsonb) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,public,private as $$
declare v_config public.system_configurations%rowtype; v_totals jsonb;
begin
  if jsonb_typeof(p_output)<>'object' or jsonb_typeof(p_output->'persisted_rows')<>'object'
    or jsonb_typeof(p_output->'engine_result')<>'object' or jsonb_typeof(p_output->'reconciliation')<>'object' then return false; end if;
  -- Collection order may differ for PostgreSQL enums; row values and duplicate counts must match exactly.
  if private.configuration_release_normalize_rows(p_output->'persisted_rows')
    is distinct from private.configuration_release_normalize_rows(private.configuration_release_saved_rows(p_configuration,p_company)) then return false; end if;
  select * into v_config from public.system_configurations where id=p_configuration and company_id=p_company;
  if not found then return false; end if;
  v_totals:=p_output->'configuration_totals';
  if jsonb_typeof(v_totals)<>'object'
    or coalesce((v_totals->>'subtotal')::numeric,-1) is distinct from v_config.subtotal
    or coalesce((v_totals->>'gst_amount')::numeric,-1) is distinct from v_config.gst_amount
    or coalesce((v_totals->>'grand_total')::numeric,-1) is distinct from v_config.grand_total
    or coalesce((v_totals->>'internal_cost')::numeric,-1) is distinct from v_config.internal_cost
    or coalesce((v_totals->>'selling_price')::numeric,-1) is distinct from v_config.selling_price
    or coalesce((v_totals->>'gst_percent')::numeric,-1) is distinct from v_config.gst_percent
    or coalesce((v_totals->>'margin_percent')::numeric,-1) is distinct from v_config.margin_percent then return false; end if;
  return true;
exception when others then return false;
end;
$$;
revoke all on function private.configuration_release_outputs_match(uuid,uuid,jsonb) from public,anon,authenticated;

create function private.configuration_release_rules_complete(p_input jsonb,p_rules jsonb,p_output jsonb) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,public,private as $$
declare v_formula jsonb; v_profile_rules jsonb; v_hardware_rules jsonb; v_glass_required boolean; v_warning jsonb;
begin
  if coalesce((p_input->>'width_mm')::numeric,0) not between 1 and 30000
    or coalesce((p_input->>'height_mm')::numeric,0) not between 1 and 30000
    or coalesce((p_input->>'quantity')::numeric,0) not between 1 and 10000
    or nullif(p_input->>'customer_id','') is null
    or p_rules->'template'->>'system_type' is distinct from p_input->>'system_type'
    or jsonb_typeof(p_input->'panel_layout_json'->'panels') is distinct from 'array'
    or jsonb_array_length(p_input->'panel_layout_json'->'panels') not between 1 and 50 then return false; end if;
  if jsonb_typeof(p_rules->'series')<>'object' or coalesce((p_rules->'series'->>'is_active')::boolean,false) is not true
    or jsonb_typeof(p_rules->'template')<>'object' or coalesce((p_rules->'template'->>'is_active')::boolean,false) is not true
    or coalesce((p_rules->'template'->>'formula_version')::integer,0)<1 then return false; end if;
  v_formula:=p_rules->'template'->'formula_json';
  v_profile_rules:=v_formula->'profileRules';
  v_hardware_rules:=v_formula->'hardwareRules';
  if jsonb_typeof(v_profile_rules)<>'array' or jsonb_array_length(v_profile_rules)=0 then return false; end if;
  if (jsonb_typeof(v_hardware_rules)='array' and jsonb_array_length(v_hardware_rules)=0)
    or (jsonb_typeof(v_hardware_rules)='object' and v_hardware_rules='{}'::jsonb)
    or jsonb_typeof(v_hardware_rules) not in ('array','object') then return false; end if;
  if exists(select 1 from jsonb_array_elements(v_profile_rules) r where not exists(
      select 1 from jsonb_array_elements(coalesce(p_rules->'profiles','[]'::jsonb)) sp
      where coalesce((sp->>'is_active')::boolean,false)
        and (sp->>'component_role'=coalesce(r->>'componentRole',r->>'component_role')
          or (nullif(coalesce(r->>'profileCode',r->>'profile_code'),'') is not null
            and sp->'aluminium_profiles'->>'profile_code'=coalesce(r->>'profileCode',r->>'profile_code')))
        and sp->'aluminium_profiles'->>'is_active'='true'
        and coalesce((sp->'aluminium_profiles'->>'section_weight_kg_per_m')::numeric,0)>0
    )) then return false; end if;
  if exists(select 1 from jsonb_array_elements(v_profile_rules) r where
      coalesce(nullif(r->>'quantityFormula',''),nullif(r->>'quantity_formula','')) is null
      or coalesce(nullif(r->>'lengthFormula',''),nullif(r->>'length_formula','')) is null) then return false; end if;
  if jsonb_typeof(p_input->'panel_layout_json'->'panels')='array' then
    select exists(select 1 from jsonb_array_elements(p_input->'panel_layout_json'->'panels') panel where panel->>'function'='glass') into v_glass_required;
  else v_glass_required:=false; end if;
  if v_glass_required then
    if jsonb_typeof(v_formula->'glassRules')<>'object'
      or coalesce(nullif(v_formula->'glassRules'->>'widthFormula',''),nullif(v_formula->'glassRules'->>'width_formula','')) is null
      or coalesce(nullif(v_formula->'glassRules'->>'heightFormula',''),nullif(v_formula->'glassRules'->>'height_formula','')) is null
      or jsonb_typeof(p_rules->'glass_item')<>'object'
      or coalesce((p_rules->'glass_item'->>'is_active')::boolean,false) is not true
      or greatest(coalesce((p_rules->'glass_item'->>'rate_per_sqft')::numeric,0),coalesce((p_rules->'glass_item'->>'rate_per_sqm')::numeric,0))<=0
      or coalesce((v_formula->'beadingRules'->>'version')::integer,0)<>1
      or v_formula->'beadingRules'->>'method'<>'all_four_edges'
      or (select count(*) from jsonb_array_elements(coalesce(p_rules->'profiles','[]'::jsonb)) sp
        where coalesce((sp->>'is_active')::boolean,false) and sp->>'component_role' in ('glazing_bead_vertical','glazing_bead_horizontal')
          and sp->'aluminium_profiles'->>'is_active'='true'
          and coalesce((sp->'aluminium_profiles'->>'section_weight_kg_per_m')::numeric,0)>0)<>2 then return false; end if;
  end if;
  if jsonb_typeof(p_output->'persisted_rows'->'system_profile_cuts') is distinct from 'array'
    or jsonb_array_length(p_output->'persisted_rows'->'system_profile_cuts')=0
    or jsonb_typeof(p_output->'reconciliation'->'checks') is distinct from 'array'
    or jsonb_array_length(p_output->'reconciliation'->'checks')=0
    or exists(select 1 from jsonb_array_elements(p_output->'reconciliation'->'checks') x where x->>'status' is distinct from 'pass') then return false; end if;
  if exists(select 1 from jsonb_array_elements(p_output->'persisted_rows'->'system_profile_cuts') x
    where coalesce((x->>'cut_length_mm')::numeric,0)<=0 or coalesce((x->>'quantity')::numeric,0)<=0
      or coalesce((x->>'total_weight_kg')::numeric,0)<=0
      or abs((x->>'total_length_m')::numeric-(x->>'cut_length_mm')::numeric*(x->>'quantity')::numeric/1000)>0.002
      or abs((x->>'total_weight_kg')::numeric-(x->>'total_length_m')::numeric*(x->>'section_weight_kg_per_m')::numeric)>0.002) then return false; end if;
  if v_glass_required and (jsonb_array_length(coalesce(p_output->'persisted_rows'->'system_glass_cuts','[]'::jsonb))=0
    or exists(select 1 from jsonb_array_elements(p_output->'persisted_rows'->'system_glass_cuts') x
      where coalesce((x->>'width_mm')::numeric,0)<=0 or coalesce((x->>'height_mm')::numeric,0)<=0
        or coalesce((x->>'quantity')::numeric,0)<=0
        or abs((x->>'area_sqm')::numeric-(x->>'width_mm')::numeric*(x->>'height_mm')::numeric*(x->>'quantity')::numeric/1000000)>0.00051
        or abs((x->>'amount')::numeric-(x->>'area_sqft')::numeric*(x->>'rate')::numeric)>0.02)) then return false; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(p_output->'persisted_rows'->'system_hardware_bom','[]'::jsonb)) x
    where coalesce((x->>'quantity')::numeric,0)<=0 or coalesce((x->>'rate')::numeric,0)<=0
      or abs((x->>'amount')::numeric-(x->>'quantity')::numeric*(x->>'rate')::numeric)>0.02) then return false; end if;
  if jsonb_typeof(p_rules->'finish_option')<>'object' or coalesce((p_rules->'finish_option'->>'is_active')::boolean,false) is not true
    or coalesce((p_rules->'finish_option'->>'rate')::numeric,0)<=0 then return false; end if;
  if jsonb_typeof(p_output->'engine_result'->'warnings')='array' then
    for v_warning in select value from jsonb_array_elements(p_output->'engine_result'->'warnings') loop
      if v_warning->>'severity'='error' or v_warning->>'code' in ('missing_profile','missing_required_profile','missing_section_weight',
        'missing_beading_profile','missing_hardware','missing_glass','missing_rate','invalid_cut','cut_exceeds_stock','invalid_glass_size') then return false; end if;
    end loop;
  else return false; end if;
  return true;
exception when others then return false;
end;
$$;
revoke all on function private.configuration_release_rules_complete(jsonb,jsonb,jsonb) from public,anon,authenticated;

create function private.bump_configuration_rule_revision() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare v_old_company uuid; v_new_company uuid;
begin
  if tg_op<>'INSERT' then v_old_company:=old.company_id; end if;
  if tg_op<>'DELETE' then v_new_company:=new.company_id; end if;
  if v_old_company is not null then
    insert into public.configuration_rule_revisions(company_id,revision) values(v_old_company,1)
      on conflict(company_id) do update set revision=public.configuration_rule_revisions.revision+1,updated_at=clock_timestamp();
  end if;
  if v_new_company is not null and v_new_company is distinct from v_old_company then
    insert into public.configuration_rule_revisions(company_id,revision) values(v_new_company,1)
      on conflict(company_id) do update set revision=public.configuration_rule_revisions.revision+1,updated_at=clock_timestamp();
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.bump_configuration_rule_revision() from public,anon,authenticated;

do $$
declare t text;
begin
  foreach t in array array['system_series','system_profiles','aluminium_profiles','system_templates','hardware_items','glass_items','finish_options','company_settings'] loop
    execute format('drop trigger if exists configuration_rule_revision on public.%I',t);
    execute format('create trigger configuration_rule_revision after insert or update or delete on public.%I for each row execute function private.bump_configuration_rule_revision()',t);
  end loop;
end;
$$;

create function private.bump_configuration_output_revision() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare v_company uuid; v_configuration uuid;
begin
  if tg_op='DELETE' then v_company:=old.company_id;v_configuration:=old.configuration_id;
  else v_company:=new.company_id;v_configuration:=new.configuration_id; end if;
  insert into public.configuration_output_revisions(company_id,configuration_id,revision)
    values(v_company,v_configuration,1)
    on conflict(company_id,configuration_id) do update set revision=public.configuration_output_revisions.revision+1,updated_at=clock_timestamp();
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.bump_configuration_output_revision() from public,anon,authenticated;

do $$
declare t text;
begin
  foreach t in array array['system_profile_cuts','system_glass_cuts','system_beading_cuts','system_hardware_bom','system_material_summary','profile_optimization_runs'] loop
    execute format('drop trigger if exists configuration_output_revision on public.%I',t);
    execute format('create trigger configuration_output_revision after insert or update or delete on public.%I for each row execute function private.bump_configuration_output_revision()',t);
  end loop;
end;
$$;

create function private.keep_configuration_release_history() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,private as $$
begin
  raise exception 'Configurator release history is immutable' using errcode='55000';
end;
$$;
revoke all on function private.keep_configuration_release_history() from public,anon,authenticated;
create trigger keep_configuration_output_snapshots before update or delete on public.configuration_output_snapshots for each row execute function private.keep_configuration_release_history();
create trigger keep_configuration_output_reviews before update or delete on public.configuration_output_reviews for each row execute function private.keep_configuration_release_history();
create trigger keep_configuration_output_handoffs before update or delete on public.configuration_output_handoffs for each row execute function private.keep_configuration_release_history();

create function private.assert_configuration_output_release(p_configuration uuid,p_company uuid) returns uuid
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare v_config public.system_configurations%rowtype; v_snapshot public.configuration_output_snapshots%rowtype;
  v_review public.configuration_output_reviews%rowtype; v_input jsonb; v_rules jsonb; v_rules_revision bigint; v_output_revision bigint;
begin
  select * into v_config from public.system_configurations where id=p_configuration and company_id=p_company for update;
  if not found then raise exception 'System configuration not found for this company' using errcode='23514'; end if;
  select * into v_snapshot from public.configuration_output_snapshots where company_id=p_company and configuration_id=p_configuration order by revision desc limit 1;
  if not found then raise exception 'Calculate and save a versioned configurator release before production handoff' using errcode='23514'; end if;
  v_input:=private.configuration_release_input(p_configuration,p_company);
  v_rules:=private.configuration_release_rules(p_configuration,p_company);
  v_rules_revision:=private.configuration_rule_revision(p_company);
  v_output_revision:=private.configuration_output_revision(p_company,p_configuration);
  if v_snapshot.readiness<>'ready' or jsonb_array_length(v_snapshot.unresolved_reasons)>0 or jsonb_array_length(v_snapshot.estimated_fields)>0 then
    raise exception 'Configurator release is blocked or estimated and cannot enter fabrication' using errcode='23514';
  end if;
  if v_snapshot.input_fingerprint<>private.configuration_release_fingerprint(v_input)
    or v_snapshot.rules_fingerprint<>private.configuration_release_fingerprint(v_rules)
    or v_snapshot.output_revision<>v_output_revision
    or v_snapshot.output_fingerprint<>private.configuration_release_fingerprint(v_snapshot.output_snapshot)
    or not private.configuration_release_outputs_match(p_configuration,p_company,v_snapshot.output_snapshot) then
    raise exception 'Configurator input, rules, or outputs changed after review; recalculate and obtain a new independent approval' using errcode='23514';
  end if;
  select * into v_review from public.configuration_output_reviews where company_id=p_company and snapshot_id=v_snapshot.id
    and decision='approved' and reviewed_by is distinct from v_snapshot.created_by order by reviewed_at desc,id desc limit 1;
  if not found or v_review.output_fingerprint<>v_snapshot.output_fingerprint then
    raise exception 'A separate owner or admin must approve this exact configurator output before production handoff' using errcode='23514';
  end if;
  return v_snapshot.id;
end;
$$;
revoke all on function private.assert_configuration_output_release(uuid,uuid) from public,anon,authenticated;

create function private.guard_configuration_output_release_handoff() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare v_snapshot uuid;
begin
  if new.status::text='in_production' and (tg_op='INSERT' or old.status::text is distinct from 'in_production') then
    v_snapshot:=private.assert_configuration_output_release(new.id,new.company_id);
  end if;
  return new;
end;
$$;
revoke all on function private.guard_configuration_output_release_handoff() from public,anon,authenticated;
drop trigger if exists zzzz_configuration_output_release_gate on public.system_configurations;
create trigger zzzz_configuration_output_release_gate before insert or update of status,order_id on public.system_configurations
for each row execute function private.guard_configuration_output_release_handoff();

create function private.record_configuration_output_release_handoff() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare v_snapshot uuid;
begin
  if old.status::text is distinct from 'in_production' and new.status::text='in_production' then
    select id into v_snapshot from public.configuration_output_snapshots where company_id=new.company_id and configuration_id=new.id order by revision desc limit 1;
    insert into public.configuration_output_handoffs(company_id,configuration_id,snapshot_id,order_id,handed_off_by)
      values(new.company_id,new.id,v_snapshot,new.order_id,auth.uid());
  end if;
  return new;
end;
$$;
revoke all on function private.record_configuration_output_release_handoff() from public,anon,authenticated;
drop trigger if exists zzzz_configuration_output_release_handoff on public.system_configurations;
create trigger zzzz_configuration_output_release_handoff after update of status,order_id on public.system_configurations
for each row execute function private.record_configuration_output_release_handoff();

create function public.configuration_release_command(p_command text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare
  v_company uuid; v_role text:=private.get_current_user_role(); v_actor uuid:=auth.uid();
  v_config uuid; v_config_row public.system_configurations%rowtype; v_snapshot public.configuration_output_snapshots%rowtype; v_existing public.configuration_output_snapshots%rowtype;
  v_review public.configuration_output_reviews%rowtype; v_input jsonb; v_rules jsonb; v_input_fp text; v_rules_fp text;
  v_rules_revision bigint; v_output_revision bigint; v_request_id uuid; v_request_fp text; v_next_revision integer;
  v_readiness text; v_reasons jsonb; v_estimated jsonb; v_output jsonb; v_json jsonb; v_state text;
  v_latest public.configuration_output_snapshots%rowtype; v_handoff public.configuration_output_handoffs%rowtype;
begin
  if p_command='release.load' then
    if p_payload- array['configuration_id']<>'{}' then raise exception 'Invalid configurator release read request'; end if;
    v_company:=private.commercial_actor(array['owner','admin','factory_manager','production_manager','sales_manager','sales','accounts','viewer']);
    v_config:=(p_payload->>'configuration_id')::uuid;
    if not exists(select 1 from public.system_configurations where id=v_config and company_id=v_company) then raise exception 'Configuration not found'; end if;
    v_rules_revision:=private.configuration_rule_revision(v_company); v_output_revision:=private.configuration_output_revision(v_company,v_config);
    select * into v_latest from public.configuration_output_snapshots where company_id=v_company and configuration_id=v_config order by revision desc limit 1;
    if not found then
      return jsonb_build_object('kind','release_state','configuration_id',v_config,'status','not_calculated',
        'current_rules_revision',v_rules_revision,'current_output_revision',v_output_revision,'latest',null,
        'unresolved_reasons',jsonb_build_array('Calculate this project to capture exact inputs, rules, and outputs.'));
    end if;
    v_input:=private.configuration_release_input(v_config,v_company); v_rules:=private.configuration_release_rules(v_config,v_company);
    v_input_fp:=private.configuration_release_fingerprint(v_input);
    v_rules_fp:=private.configuration_release_fingerprint(v_rules);
    select * into v_review from public.configuration_output_reviews where company_id=v_company and snapshot_id=v_latest.id and decision='approved'
      and reviewed_by is distinct from v_latest.created_by order by reviewed_at desc,id desc limit 1;
    select * into v_handoff from public.configuration_output_handoffs where company_id=v_company and configuration_id=v_config;
    if found then v_state:='handed_off';
    elsif v_latest.input_fingerprint<>v_input_fp or v_latest.rules_fingerprint<>v_rules_fp
      or v_latest.output_revision<>v_output_revision or v_latest.output_fingerprint<>private.configuration_release_fingerprint(v_latest.output_snapshot)
      or not private.configuration_release_outputs_match(v_config,v_company,v_latest.output_snapshot) then v_state:='stale';
    elsif v_review.id is not null and v_review.output_fingerprint=v_latest.output_fingerprint then v_state:='approved';
    elsif v_latest.readiness='ready' then v_state:='pending_approval';
    else v_state:=v_latest.readiness;
    end if;
    v_reasons:=v_latest.unresolved_reasons;
    if v_state='stale' then v_reasons:=v_reasons||jsonb_build_array('Configuration inputs, source rules, or saved output changed after this snapshot; calculate and review a new version.'); end if;
    return jsonb_build_object('kind','release_state','configuration_id',v_config,'status',v_state,
      'current_rules_revision',v_rules_revision,'current_output_revision',v_output_revision,
      'latest',jsonb_build_object('id',v_latest.id,'revision',v_latest.revision,'author_id',v_latest.created_by,'created_at',v_latest.created_at,
        'input_fingerprint',v_latest.input_fingerprint,'rules_fingerprint',v_latest.rules_fingerprint,'output_fingerprint',v_latest.output_fingerprint,
        'rules_revision',v_latest.rules_revision,'output_revision',v_latest.output_revision,'readiness',v_latest.readiness,'release_status',v_state,
        'unresolved_reasons',v_reasons,'estimated_fields',v_latest.estimated_fields,
        'approved_by',case when v_review.output_fingerprint=v_latest.output_fingerprint then v_review.reviewed_by end,
        'approved_at',case when v_review.output_fingerprint=v_latest.output_fingerprint then v_review.reviewed_at end,
        'approval_note',case when v_review.output_fingerprint=v_latest.output_fingerprint then v_review.note end,
        'handoff_order_id',v_handoff.order_id,'handed_off_at',v_handoff.handed_off_at),
      'unresolved_reasons',v_reasons);
  elsif p_command='source.capture' then
    v_company:=private.commercial_actor(array['owner','admin']);
    if p_payload- array['configuration_id']<>'{}' then raise exception 'Invalid configurator source request'; end if;
    v_config:=(p_payload->>'configuration_id')::uuid;
    v_input:=private.configuration_release_input(v_config,v_company); v_rules:=private.configuration_release_rules(v_config,v_company);
    if v_input is null or v_rules is null then raise exception 'Configuration source is unavailable'; end if;
    v_rules_revision:=private.configuration_rule_revision(v_company); v_output_revision:=private.configuration_output_revision(v_company,v_config);
    v_input_fp:=private.configuration_release_fingerprint(v_input);
    v_rules_fp:=private.configuration_release_fingerprint(v_rules);
    return jsonb_build_object('kind','release_source','configuration_id',v_config,'input_snapshot',v_input,'input_fingerprint',v_input_fp,
      'rules_snapshot',v_rules,'rules_fingerprint',v_rules_fp,'rules_revision',v_rules_revision,'output_revision',v_output_revision);
  elsif p_command='snapshot.create' then
    v_company:=private.commercial_actor(array['owner','admin']);
    if p_payload- array['configuration_id','request_id','expected_input_fingerprint','expected_rules_fingerprint','expected_rules_revision','expected_output_revision','readiness','unresolved_reasons','estimated_fields','output_snapshot']<>'{}' then
      raise exception 'Invalid configurator snapshot request'; end if;
    if jsonb_typeof(p_payload->'output_snapshot')<>'object' or jsonb_typeof(p_payload->'unresolved_reasons')<>'array'
      or jsonb_typeof(p_payload->'estimated_fields')<>'array' or p_payload->>'readiness' not in ('blocked','estimated','ready') then
      raise exception 'Configurator snapshot details are invalid'; end if;
    v_config:=(p_payload->>'configuration_id')::uuid; v_request_id:=(p_payload->>'request_id')::uuid;
    v_input_fp:=lower(p_payload->>'expected_input_fingerprint'); v_rules_fp:=lower(p_payload->>'expected_rules_fingerprint');
    if v_input_fp !~ '^[0-9a-f]{64}$' or v_rules_fp !~ '^[0-9a-f]{64}$' then raise exception 'Configurator source fingerprint is invalid'; end if;
    v_request_fp:=md5((p_payload-'request_id')::text);
    select * into v_existing from public.configuration_output_snapshots where company_id=v_company and request_id=v_request_id;
    if found then
      if v_existing.request_fingerprint<>v_request_fp then raise exception 'Configurator snapshot retry key was used for different details'; end if;
      return jsonb_build_object('kind','snapshot_saved','id',v_existing.id,'revision',v_existing.revision,'readiness',v_existing.readiness,
        'input_fingerprint',v_existing.input_fingerprint,'rules_fingerprint',v_existing.rules_fingerprint,'output_fingerprint',v_existing.output_fingerprint,'idempotent_replay',true);
    end if;
    select * into strict v_config_row from public.system_configurations where id=v_config and company_id=v_company for update;
    if v_config_row.quote_id is not null or v_config_row.order_id is not null or v_config_row.status::text in ('in_production','converted_to_order') then
      raise exception 'Create a new configurator project for revised inputs after a quote or order exists'; end if;
    v_input:=private.configuration_release_input(v_config,v_company); v_rules:=private.configuration_release_rules(v_config,v_company);
    v_rules_revision:=private.configuration_rule_revision(v_company); v_output_revision:=private.configuration_output_revision(v_company,v_config);
    if v_input_fp<>private.configuration_release_fingerprint(v_input)
      or v_rules_fp<>private.configuration_release_fingerprint(v_rules)
      or v_rules_revision<>(p_payload->>'expected_rules_revision')::bigint
      or v_output_revision<>(p_payload->>'expected_output_revision')::bigint then
      raise exception 'Configurator input, rules, or output changed during calculation; calculate again'; end if;
    v_output:=p_payload->'output_snapshot';
    if not private.configuration_release_outputs_match(v_config,v_company,v_output) then
      raise exception 'Saved configurator output does not match the exact calculation rows'; end if;
    v_readiness:=p_payload->>'readiness'; v_reasons:=p_payload->'unresolved_reasons'; v_estimated:=p_payload->'estimated_fields';
    if v_readiness='ready' and (jsonb_array_length(v_reasons)>0 or jsonb_array_length(v_estimated)>0 or v_output->>'readiness'<>'ready') then
      raise exception 'A release with unresolved or estimated inputs cannot be marked fabrication-ready'; end if;
    if v_readiness='ready' and not private.configuration_release_rules_complete(v_input,v_rules,v_output) then
      raise exception 'Required versioned rules, materials, or rates are incomplete for fabrication release'; end if;
    select coalesce(max(revision),0)+1 into v_next_revision from public.configuration_output_snapshots where company_id=v_company and configuration_id=v_config;
    insert into public.configuration_output_snapshots(company_id,configuration_id,revision,request_id,request_fingerprint,
      input_fingerprint,rules_fingerprint,output_fingerprint,rules_revision,output_revision,input_snapshot,rules_snapshot,
      output_snapshot,readiness,unresolved_reasons,estimated_fields,created_by)
    values(v_company,v_config,v_next_revision,v_request_id,v_request_fp,private.configuration_release_fingerprint(v_input),
      private.configuration_release_fingerprint(v_rules),
      private.configuration_release_fingerprint(v_output),v_rules_revision,v_output_revision,v_input,v_rules,v_output,
      v_readiness,v_reasons,v_estimated,v_actor) returning * into v_snapshot;
    return jsonb_build_object('kind','snapshot_saved','id',v_snapshot.id,'revision',v_snapshot.revision,'readiness',v_snapshot.readiness,
      'input_fingerprint',v_snapshot.input_fingerprint,'rules_fingerprint',v_snapshot.rules_fingerprint,'output_fingerprint',v_snapshot.output_fingerprint,'idempotent_replay',false);
  elsif p_command='release.approve' then
    v_company:=private.commercial_actor(array['owner','admin']);
    if p_payload- array['snapshot_id','output_fingerprint','request_id','note']<>'{}' then raise exception 'Invalid configurator review request'; end if;
    if length(coalesce(p_payload->>'note',''))>1000 or lower(p_payload->>'output_fingerprint') !~ '^[0-9a-f]{64}$' then raise exception 'Configurator review fields are invalid'; end if;
    v_request_id:=(p_payload->>'request_id')::uuid; v_request_fp:=md5((p_payload-'request_id')::text);
    select * into v_review from public.configuration_output_reviews where company_id=v_company and request_id=v_request_id;
    if found then
      if v_review.request_fingerprint<>v_request_fp then raise exception 'Configurator review retry key was used for different details'; end if;
      return jsonb_build_object('kind','release_reviewed','snapshot_id',v_review.snapshot_id,'approved_by',v_review.reviewed_by,'approved_at',v_review.reviewed_at,'idempotent_replay',true);
    end if;
    select * into v_snapshot from public.configuration_output_snapshots where id=(p_payload->>'snapshot_id')::uuid and company_id=v_company for share;
    if not found then raise exception 'Configurator snapshot is not available'; end if;
    if v_snapshot.output_fingerprint<>p_payload->>'output_fingerprint' then raise exception 'Configurator output changed; reload before review'; end if;
    if v_actor=v_snapshot.created_by then raise exception 'The snapshot author cannot approve their own configurator release'; end if;
    if v_snapshot.readiness<>'ready' or jsonb_array_length(v_snapshot.unresolved_reasons)>0 or jsonb_array_length(v_snapshot.estimated_fields)>0 then
      raise exception 'Blocked or estimated configurator output cannot be approved'; end if;
    if not exists(select 1 from public.configuration_output_snapshots s where s.company_id=v_company and s.configuration_id=v_snapshot.configuration_id and s.id=v_snapshot.id
      and s.revision=(select max(latest.revision) from public.configuration_output_snapshots latest where latest.company_id=v_company and latest.configuration_id=v_snapshot.configuration_id)) then
      raise exception 'Review the latest configurator snapshot'; end if;
    -- Serialize rule reads, while semantic validity depends only on this project's relevant rules.
    perform private.configuration_rule_revision(v_company);
    if v_snapshot.input_fingerprint<>private.configuration_release_fingerprint(private.configuration_release_input(v_snapshot.configuration_id,v_company))
      or v_snapshot.rules_fingerprint<>private.configuration_release_fingerprint(private.configuration_release_rules(v_snapshot.configuration_id,v_company))
      or v_snapshot.output_revision<>private.configuration_output_revision(v_company,v_snapshot.configuration_id)
      or v_snapshot.output_fingerprint<>private.configuration_release_fingerprint(v_snapshot.output_snapshot)
      or not private.configuration_release_outputs_match(v_snapshot.configuration_id,v_company,v_snapshot.output_snapshot) then
      raise exception 'Configurator input, rules, or outputs are stale; calculate again before approval'; end if;
    insert into public.configuration_output_reviews(company_id,configuration_id,snapshot_id,request_id,request_fingerprint,
      output_fingerprint,decision,note,reviewed_by)
    values(v_company,v_snapshot.configuration_id,v_snapshot.id,v_request_id,v_request_fp,v_snapshot.output_fingerprint,'approved',coalesce(p_payload->>'note',''),v_actor)
    returning * into v_review;
    return jsonb_build_object('kind','release_reviewed','snapshot_id',v_review.snapshot_id,'approved_by',v_review.reviewed_by,'approved_at',v_review.reviewed_at,'idempotent_replay',false);
  end if;
  raise exception 'Unknown configurator release command';
end;
$$;
revoke all on function public.configuration_release_command(text,jsonb) from public,anon;
grant execute on function public.configuration_release_command(text,jsonb) to authenticated;

alter function public.handoff_system_configuration_to_production_atomic(uuid,jsonb,text)
  rename to handoff_system_configuration_before_release_gate;
alter function public.handoff_system_configuration_before_release_gate(uuid,jsonb,text) set schema private;
revoke all on function private.handoff_system_configuration_before_release_gate(uuid,jsonb,text) from public,anon,authenticated;

create function public.handoff_system_configuration_to_production_atomic(p_configuration_id uuid,p_jobs jsonb,p_remarks text)
returns uuid language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare c uuid;v_config public.system_configurations%rowtype;
begin
  c:=private.commercial_actor(array['owner','admin','factory_manager','production_manager']);
  select * into v_config from public.system_configurations where id=p_configuration_id and company_id=c for update;
  if not found then raise exception 'System configuration is unavailable';end if;
  if v_config.status::text<>'in_production' then
    if v_config.order_id is null and not exists(select 1 from public.orders where company_id=c and quote_id=v_config.quote_id and customer_id=v_config.customer_id) then
      raise exception 'Convert the approved system quotation to a canonical customer order before production handoff';end if;
    perform private.assert_configuration_output_release(v_config.id,c);
  end if;
  return private.handoff_system_configuration_before_release_gate(p_configuration_id,p_jobs,p_remarks);
end;
$$;
revoke all on function public.handoff_system_configuration_to_production_atomic(uuid,jsonb,text) from public,anon;
grant execute on function public.handoff_system_configuration_to_production_atomic(uuid,jsonb,text) to authenticated;

commit;

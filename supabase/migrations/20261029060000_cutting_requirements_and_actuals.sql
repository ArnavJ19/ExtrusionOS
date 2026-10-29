begin;
create table public.cutting_rule_versions(
  id uuid primary key,company_id uuid not null references public.companies(id),name text not null,version integer not null,
  rule jsonb not null,status text not null check(status in ('draft','approved')),created_by uuid not null references public.app_users(id),
  approved_by uuid references public.app_users(id),created_at timestamptz not null default now(),approved_at timestamptz,
  unique(company_id,name,version),check(approved_by is null or approved_by<>created_by)
);
create index cutting_rules_company_status_idx on public.cutting_rule_versions(company_id,status,id);
create index cutting_rules_author_idx on public.cutting_rule_versions(created_by);
create index cutting_rules_approver_idx on public.cutting_rule_versions(approved_by);
create table public.cutting_actual_runs(
  id uuid primary key,company_id uuid not null references public.companies(id),order_item_id uuid not null references public.order_items(id),
  source_batch_id uuid not null references public.profile_stock_batches(id),rule_id uuid not null references public.cutting_rule_versions(id),
  cut_count integer not null,source_weight_kg numeric(14,3) not null,source_length_m numeric(14,3) not null,
  output_batch_id uuid references public.profile_stock_batches(id),remnant_batch_id uuid references public.profile_stock_batches(id),
  payload jsonb not null,rule_snapshot jsonb not null,line_snapshot jsonb not null,source_snapshot jsonb not null,
  recorded_by uuid not null references public.app_users(id),recorded_at timestamptz not null default now()
);
create index cutting_runs_company_line_idx on public.cutting_actual_runs(company_id,order_item_id);
create index cutting_runs_source_idx on public.cutting_actual_runs(source_batch_id);
create index cutting_runs_rule_idx on public.cutting_actual_runs(rule_id);
create index cutting_runs_output_idx on public.cutting_actual_runs(output_batch_id);
create index cutting_runs_remnant_idx on public.cutting_actual_runs(remnant_batch_id);
create index cutting_runs_actor_idx on public.cutting_actual_runs(recorded_by);
alter table public.cutting_rule_versions enable row level security;
alter table public.cutting_actual_runs enable row level security;
revoke all on public.cutting_rule_versions,public.cutting_actual_runs from public,anon,authenticated;
create trigger keep_cutting_actuals before update or delete on public.cutting_actual_runs for each row execute function private.keep_commercial_history();
alter table public.profile_stock_batches drop constraint profile_stock_batches_origin_type_check;
alter table public.profile_stock_batches add constraint profile_stock_batches_origin_type_check check(origin_type in ('production_surplus','customer_return','opening_balance','dealer_manual','dealer_receipt','legacy_unverified','cutting_output','cutting_remnant'));

create function public.cutting_workspace_command(p_command text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,private as $$
declare v_company uuid;v_role text;v_rule public.cutting_rule_versions%rowtype;v_line public.order_items%rowtype;v_order public.orders%rowtype;v_batch public.profile_stock_batches%rowtype;v_profile public.aluminium_profiles%rowtype;
  v_run public.cutting_actual_runs%rowtype;v_rows jsonb;v_inputs jsonb;v_source jsonb;v_balance jsonb;v_id uuid;v_page integer:=coalesce((p_payload->>'page')::integer,1);
  v_name text;v_rule_data jsonb;v_version integer;v_cut integer;v_left integer;v_output numeric;v_remnant numeric;v_remnant_weight numeric;v_waste numeric;v_scrap numeric;v_input_weight numeric;v_min_waste numeric;v_stock_mm numeric;v_output_id uuid;v_remnant_id uuid;
begin
  v_company:=private.commercial_actor(array['owner','admin','production_manager','production','factory_manager','inventory_manager','quality']);v_role:=private.get_current_user_role();
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or v_page<1 or v_page>10000 then raise exception 'Invalid cutting request'; end if;
  if p_command='lines.list' then
    if p_payload-array['order_id','page']<>'{}' then raise exception 'Invalid cutting line request'; end if;
    perform 1 from public.orders where id=(p_payload->>'order_id')::uuid and company_id=v_company and deleted_at is null;
    if not found then raise exception 'Order is unavailable'; end if;
    select coalesce(jsonb_agg(to_jsonb(r)),'[]') into v_rows from(select id,coalesce(item_description,section_code,'Order line') label from public.order_items where company_id=v_company and order_id=(p_payload->>'order_id')::uuid order by id limit 10 offset (v_page-1)*10)r;
    return jsonb_build_object('kind','lines','page',v_page,'items',v_rows);
  end if;
  if p_command='rules.list' then
    if p_payload-array['page']<>'{}' then raise exception 'Invalid rule search'; end if;
    select coalesce(jsonb_agg(to_jsonb(r)),'[]') into v_rows from(select id,name,status,version,created_by,rule from public.cutting_rule_versions where company_id=v_company order by created_at desc,id limit 10 offset (v_page-1)*10)r;
    return jsonb_build_object('kind','rules','page',v_page,'items',v_rows);
  elsif p_command='rule.create' then
    if v_role not in ('owner','admin','production_manager') or p_payload-array['id','rule']<>'{}' then raise exception 'Rule authoring is not permitted'; end if;
    v_id:=(p_payload->>'id')::uuid;v_rule_data:=p_payload->'rule';v_name:=trim(v_rule_data->>'name');
    if jsonb_typeof(v_rule_data) is distinct from 'object' or v_rule_data-array['name','saw_kerf_mm','trim_end_mm','cut_allowance_mm','min_remnant_mm']<>'{}' or length(coalesce(v_name,'')) not between 3 and 80
      or exists(select 1 from jsonb_each(v_rule_data-'name') where jsonb_typeof(value)<>'number' or (value#>>'{}')::numeric<0 or (value#>>'{}')::numeric>30000)
      or not(v_rule_data?&array['saw_kerf_mm','trim_end_mm','cut_allowance_mm','min_remnant_mm']) or (v_rule_data->>'saw_kerf_mm')::numeric>50 or (v_rule_data->>'trim_end_mm')::numeric>100 or (v_rule_data->>'cut_allowance_mm')::numeric>100 then raise exception 'Capture approved cutting allowances and kerf'; end if;
    perform pg_advisory_xact_lock(hashtextextended(v_company::text||v_name,0));
    select * into v_rule from public.cutting_rule_versions where id=v_id;
    if found then
      if v_rule.company_id<>v_company or v_rule.rule<>v_rule_data then raise exception 'Rule identity has different content'; end if;
      return jsonb_build_object('kind','saved','id',v_id,'replayed',true);
    end if;
    select coalesce(max(version),0)+1 into v_version from public.cutting_rule_versions where company_id=v_company and name=v_name;
    insert into public.cutting_rule_versions(id,company_id,name,version,rule,status,created_by) values(v_id,v_company,v_name,v_version,v_rule_data,'draft',auth.uid());
    return jsonb_build_object('kind','saved','id',v_id);
  elsif p_command='rule.approve' then
    if v_role not in ('owner','admin','production_manager','quality') or p_payload-array['id']<>'{}' then raise exception 'Independent rule review is not permitted'; end if;
    select * into v_rule from public.cutting_rule_versions where id=(p_payload->>'id')::uuid and company_id=v_company for update;
    if not found or v_rule.created_by=auth.uid() then raise exception 'Another authorized reviewer must approve this cutting rule'; end if;
    update public.cutting_rule_versions set status='approved',approved_by=auth.uid(),approved_at=now() where id=v_rule.id and status='draft';
    return jsonb_build_object('kind','saved','id',v_rule.id);
  end if;
  if p_command not in ('inputs.load','cut.record') then raise exception 'Invalid cutting command'; end if;
  if p_command='cut.record' then
    if v_role not in ('owner','admin','production_manager','production','factory_manager','inventory_manager') then raise exception 'Cutting recording is not permitted'; end if;
    v_id:=(p_payload->>'id')::uuid;perform pg_advisory_xact_lock(hashtextextended(v_company::text||v_id::text,0));
    select * into v_run from public.cutting_actual_runs where id=v_id;
    if found then
      if v_run.company_id<>v_company or v_run.payload<>p_payload then raise exception 'Cutting identity has different observations'; end if;
      return jsonb_build_object('kind','saved','id',v_id,'replayed',true,'output_batch_id',v_run.output_batch_id,'remnant_batch_id',v_run.remnant_batch_id);
    end if;
  end if;
  select * into v_line from public.order_items where id=(p_payload->>'order_item_id')::uuid and company_id=v_company;
  if not found then raise exception 'Order line is unavailable'; end if;
  select * into v_order from public.orders where id=v_line.order_id and company_id=v_company and deleted_at is null for update;
  if not found or v_order.current_stage in ('cancelled','delivered') then raise exception 'Order is unavailable'; end if;
  select * into v_line from public.order_items where id=v_line.id for update;
  select * into v_rule from public.cutting_rule_versions where id=(p_payload->>'rule_id')::uuid and company_id=v_company and status='approved' for share;
  if not found then raise exception 'An independently approved cutting rule is required'; end if;
  select * into v_profile from public.aluminium_profiles where company_id=v_company and id=v_line.profile_id for share;
  if v_line.quantity_pieces is null or v_line.quantity_pieces<=0 or v_line.length_per_piece_m is null or v_line.length_per_piece_m<=0 then raise exception 'Recorded cut lengths and counts are required'; end if;
  select v_line.quantity_pieces-coalesce(sum(cut_count),0) into v_left from public.cutting_actual_runs where company_id=v_company and order_item_id=v_line.id;
  if p_command='inputs.load' then
    if p_payload-array['order_item_id','rule_id','page']<>'{}' then raise exception 'Invalid cutting input request'; end if;
    with candidates as(select b.*,private.profile_stock_balance(v_company,b.id) balance from public.profile_stock_batches b where b.company_id=v_company and b.profile_id=v_line.profile_id and b.dealer_id is null
      and b.qc_status in ('released','not_required') and b.status in ('available','reserved') and b.piece_length_m>0 and b.quantity_pieces>0 and b.total_weight_kg>0
      and coalesce(b.finish,'mill_finish')=coalesce(v_line.finishing_type,'mill_finish')
      and nullif(b.alloy,'') is not null and nullif(b.temper,'') is not null
      and regexp_replace(lower(b.alloy),'[^a-z0-9]','','g')=regexp_replace(lower(coalesce(v_line.technical_spec_snapshot->>'alloy',v_profile.alloy)),'[^a-z0-9]','','g')
      and regexp_replace(lower(b.temper),'[^a-z0-9]','','g')=regexp_replace(lower(coalesce(v_line.technical_spec_snapshot->>'temper',v_profile.temper)),'[^a-z0-9]','','g'))
    select coalesce(jsonb_agg(to_jsonb(r)),'[]') into v_rows from(select id,bundle_number,location,piece_length_m*1000 stock_length_mm,round(total_weight_kg/quantity_pieces,3) bar_weight_kg,
      greatest(0,floor(least((balance#>>'{available,pieces}')::numeric,(balance#>>'{available,weight_kg}')::numeric/(total_weight_kg/quantity_pieces),(balance#>>'{available,length_m}')::numeric/piece_length_m))) available_bars,
      md5(to_jsonb(candidates)::text||to_jsonb(v_line)::text||v_rule.rule::text||v_left::text) fingerprint from candidates order by id limit 10 offset (v_page-1)*10)r;
    return jsonb_build_object('kind','inputs','order_item_id',v_line.id,'cut_length_mm',v_line.length_per_piece_m*1000,'remaining_pieces',greatest(v_left,0),'rule_id',v_rule.id,'rule',v_rule.rule,'page',v_page,'stock',v_rows);
  end if;
  if p_payload-array['id','order_item_id','rule_id','batch_id','page','fingerprint','cut_count','output_weight_kg','remnant_mm','remnant_weight_kg','waste_mm','scrap_weight_kg']<>'{}' then raise exception 'Invalid actual cutting observations'; end if;
  select * into v_batch from public.profile_stock_batches where id=(p_payload->>'batch_id')::uuid and company_id=v_company for update;
  if not found then raise exception 'Source stock is unavailable'; end if;
  v_inputs:=public.cutting_workspace_command('inputs.load',jsonb_build_object('order_item_id',v_line.id,'rule_id',v_rule.id,'page',v_page));
  select value into v_source from jsonb_array_elements(v_inputs->'stock') where value->>'id'=v_batch.id::text;
  if v_source is null or (v_source->>'available_bars')::integer<1 or v_source->>'fingerprint' is distinct from p_payload->>'fingerprint' then raise exception 'Cutting source or demand changed. Review again'; end if;
  v_cut:=(p_payload->>'cut_count')::integer;v_output:=(p_payload->>'output_weight_kg')::numeric;v_remnant:=(p_payload->>'remnant_mm')::numeric;
  v_remnant_weight:=(p_payload->>'remnant_weight_kg')::numeric;v_waste:=(p_payload->>'waste_mm')::numeric;v_scrap:=(p_payload->>'scrap_weight_kg')::numeric;
  if exists(select 1 from jsonb_each(p_payload) where key=any(array['cut_count','output_weight_kg','remnant_mm','remnant_weight_kg','waste_mm','scrap_weight_kg']) and (jsonb_typeof(value)<>'number' or (value#>>'{}')::numeric<0 or (value#>>'{}')::numeric>1000000))
    or not(p_payload?&array['cut_count','output_weight_kg','remnant_mm','remnant_weight_kg','waste_mm','scrap_weight_kg']) then raise exception 'Capture finite non-negative physical observations'; end if;
  v_input_weight:=(v_source->>'bar_weight_kg')::numeric;v_stock_mm:=v_batch.piece_length_m*1000;
  v_min_waste:=2*(v_rule.rule->>'trim_end_mm')::numeric+v_cut*((v_rule.rule->>'saw_kerf_mm')::numeric+(v_rule.rule->>'cut_allowance_mm')::numeric);
  if v_cut<=0 or v_cut>v_left or v_cut>5000 or v_output<=0 or v_remnant<>trunc(v_remnant)
    or abs(v_cut*v_line.length_per_piece_m*1000+v_remnant+v_waste-v_stock_mm)>0.001 or v_waste<v_min_waste
    or abs(v_output+v_remnant_weight+v_scrap-v_input_weight)>0.001
    or (v_remnant=0) is distinct from (v_remnant_weight=0) or (v_remnant>0 and v_remnant<(v_rule.rule->>'min_remnant_mm')::numeric) then raise exception 'Actual cuts, allowances, remnant and scrap do not reconcile to one source bar'; end if;
  update public.profile_stock_batches set quantity_pieces=quantity_pieces-1,length_m=round(length_m-v_batch.piece_length_m,3),total_weight_kg=round(total_weight_kg-v_input_weight,3),updated_at=now() where id=v_batch.id;
  insert into public.profile_stock_batches(company_id,profile_id,finish,piece_length_m,length_m,quantity_pieces,total_weight_kg,location,status,origin_type,origin_reference,qc_status,alloy,temper,bundle_number)
    values(v_company,v_batch.profile_id,v_batch.finish,v_line.length_per_piece_m,v_cut*v_line.length_per_piece_m,v_cut,v_output,v_batch.location,'available','cutting_output',v_id::text,'on_hold',v_batch.alloy,v_batch.temper,'CUT-'||v_id::text) returning id into v_output_id;
  if v_remnant>0 then
    insert into public.profile_stock_batches(company_id,profile_id,finish,piece_length_m,length_m,quantity_pieces,total_weight_kg,location,status,origin_type,origin_reference,qc_status,alloy,temper,bundle_number)
      values(v_company,v_batch.profile_id,v_batch.finish,v_remnant/1000,v_remnant/1000,1,v_remnant_weight,v_batch.location,'available','cutting_remnant',v_id::text,'on_hold',v_batch.alloy,v_batch.temper,'REM-'||v_id::text) returning id into v_remnant_id;
  end if;
  insert into public.cutting_actual_runs(id,company_id,order_item_id,source_batch_id,rule_id,cut_count,source_weight_kg,source_length_m,output_batch_id,remnant_batch_id,payload,rule_snapshot,line_snapshot,source_snapshot,recorded_by)
    values(v_id,v_company,v_line.id,v_batch.id,v_rule.id,v_cut,v_input_weight,v_batch.piece_length_m,v_output_id,v_remnant_id,p_payload,v_rule.rule,to_jsonb(v_line),to_jsonb(v_batch),auth.uid());
  return jsonb_build_object('kind','saved','id',v_id,'replayed',false,'output_batch_id',v_output_id,'remnant_batch_id',v_remnant_id);
end;
$$;
revoke all on function public.cutting_workspace_command(text,jsonb) from public,anon;
grant execute on function public.cutting_workspace_command(text,jsonb) to authenticated;

alter function private.profile_stock_balance(uuid,uuid) rename to profile_stock_balance_before_cutting;
create function private.profile_stock_balance(p_company uuid,p_batch uuid) returns jsonb
language plpgsql stable security definer set search_path=public,private as $$
declare v_result jsonb;v_rows jsonb;v_w numeric;v_l numeric;v_n integer;
begin
  v_result:=private.profile_stock_balance_before_cutting(p_company,p_batch);if v_result is null then return null; end if;
  select count(*)::integer,coalesce(sum(source_weight_kg),0),coalesce(sum(source_length_m),0),coalesce(jsonb_agg(jsonb_build_object('kind','cutting','id',id,'at',recorded_at,'reference','Cutting run','reference_id',order_item_id,'order_number',null,'weight_kg',-source_weight_kg,'pieces',-1,'length_m',-source_length_m) order by recorded_at desc),'[]') into v_n,v_w,v_l,v_rows from public.cutting_actual_runs where company_id=p_company and source_batch_id=p_batch;
  select coalesce(jsonb_agg(value),'[]') into v_rows from(select value from jsonb_array_elements((v_result->'withdrawals')||v_rows) order by (value->>'at')::timestamptz desc limit 100)r;
  return v_result||jsonb_build_object('withdrawals',v_rows,'withdrawals_total',(v_result->>'withdrawals_total')::integer+v_n,
    'net_withdrawn',jsonb_build_object('weight_kg',(v_result#>>'{net_withdrawn,weight_kg}')::numeric-v_w,'pieces',(v_result#>>'{net_withdrawn,pieces}')::numeric-v_n,'length_m',(v_result#>>'{net_withdrawn,length_m}')::numeric-v_l),
    'before_recorded_withdrawals',jsonb_build_object('weight_kg',(v_result#>>'{before_recorded_withdrawals,weight_kg}')::numeric+v_w,'pieces',(v_result#>>'{before_recorded_withdrawals,pieces}')::numeric+v_n,'length_m',(v_result#>>'{before_recorded_withdrawals,length_m}')::numeric+v_l));
end;
$$;
revoke all on function private.profile_stock_balance(uuid,uuid) from public,anon,authenticated;
commit;

begin;
create table public.source_change_reviews (
  id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),task_id uuid not null references public.tasks(id),
  source_type text not null,source_id uuid not null,before_snapshot jsonb not null,after_snapshot jsonb not null,source_fingerprint text not null,
  previous_task_status text not null,previous_completed_at timestamptz,changed_by uuid references auth.users(id),changed_at timestamptz not null default clock_timestamp(),
  status text not null default 'requires_review' check(status in ('requires_review','accepted','repeat_required','superseded')),reviewed_by uuid references public.app_users(id),
  reviewed_at timestamptz,review_note text,followup_task_id uuid references public.tasks(id),check(reviewed_by is null or reviewed_by is distinct from changed_by)
);
create index source_change_company_queue on public.source_change_reviews(company_id,status,changed_at,id);
create index source_change_task on public.source_change_reviews(company_id,task_id,status);
create table public.boundary_reconciliation_policies(company_id uuid not null references public.companies(id),source_type text not null check(source_type in ('dispatch','invoice')),enabled_by uuid not null references public.app_users(id),primary key(company_id,source_type));
create table public.boundary_reconciliations(id uuid primary key,company_id uuid not null references public.companies(id),source_type text not null,source_id uuid not null,source_fingerprint text not null,snapshot jsonb not null,decision text not null check(decision in ('hold','reconciled')),note text not null,recorded_by uuid not null references public.app_users(id),recorded_at timestamptz not null default clock_timestamp(),request_payload jsonb not null);
create index boundary_reconciliation_company_source on public.boundary_reconciliations(company_id,source_type,source_id,recorded_at,id);
alter table public.source_change_reviews enable row level security;alter table public.boundary_reconciliation_policies enable row level security;alter table public.boundary_reconciliations enable row level security;
revoke all on public.source_change_reviews,public.boundary_reconciliation_policies,public.boundary_reconciliations from public,anon,authenticated;
create trigger keep_boundary_history before update or delete on public.boundary_reconciliations for each row execute function private.keep_commercial_history();

create function private.assurance_basis(p_table text,r jsonb) returns jsonb language sql immutable set search_path=public,private as $$
  select case p_table
    when 'aluminium_profiles' then jsonb_build_object('id',r->'id','drawing_revision',r->'drawing_revision','drawing_approval_status',r->'drawing_approval_status','alloy',r->'alloy','temper',r->'temper','section_weight_kg_per_m',r->'section_weight_kg_per_m','is_active',r->'is_active')
    when 'quality_inspections' then jsonb_build_object('id',r->'id','status',r->'status','quantity_checked_kg',r->'quantity_checked_kg','production_job_id',r->'production_job_id','dimensional_variance',r->'dimensional_variance','hardness_webster',r->'hardness_webster','surface_finish_ok',r->'surface_finish_ok','weight_per_meter_actual',r->'weight_per_meter_actual')
    when 'payments' then jsonb_build_object('id',r->'id','payment_status',r->'payment_status','amount',r->'amount','invoice_id',r->'invoice_id','entry_type',r->'entry_type')
    when 'task_criterion_evidence' then jsonb_build_object('id',r->'id','task_id',r->'task_id','superseded_at',r->'superseded_at','value',r->'value')
  end;
$$;
create function private.capture_important_source_change() returns trigger language plpgsql security definer set search_path=public,private as $$
declare a jsonb:=private.assurance_basis(tg_table_name,to_jsonb(old));b jsonb:=private.assurance_basis(tg_table_name,to_jsonb(new));v_order uuid;v_job uuid;v_invoice uuid;v_task uuid;
begin
  if a is not distinct from b then return new; end if;
  if tg_table_name='quality_inspections' then v_job:=new.production_job_id;select order_id into v_order from public.production_jobs where id=v_job and company_id=new.company_id;
  elsif tg_table_name='payments' then v_invoice:=(to_jsonb(new)->>'invoice_id')::uuid;select order_id into v_order from public.invoices where id=v_invoice and company_id=new.company_id;
  elsif tg_table_name='task_criterion_evidence' then v_task:=new.task_id;end if;
  insert into public.source_change_reviews(company_id,task_id,source_type,source_id,before_snapshot,after_snapshot,source_fingerprint,previous_task_status,previous_completed_at,changed_by)
    select new.company_id,t.id,tg_table_name,new.id,a,b,md5(b::text),t.status,t.completed_at,auth.uid() from public.tasks t where t.company_id=new.company_id and t.dealership_id is null and t.status<>'cancelled' and (
      t.id=v_task or (t.related_entity_type in ('order','orders') and t.related_entity_id=v_order) or (t.related_entity_type in ('invoice','invoices') and t.related_entity_id=v_invoice) or (t.related_entity_type in ('production_job','production') and t.related_entity_id=v_job)
      or (tg_table_name='aluminium_profiles' and ((t.related_entity_type in ('profile','aluminium_profile') and t.related_entity_id=new.id)
        or (t.related_entity_type in ('production_job','production') and exists(select 1 from public.production_jobs j where j.id=t.related_entity_id and j.company_id=new.company_id and j.profile_id=new.id))
        or (t.related_entity_type in ('order','orders') and exists(select 1 from public.order_items i where i.order_id=t.related_entity_id and i.company_id=new.company_id and i.profile_id=new.id)))));
  return new;
end $$;
revoke all on function private.assurance_basis(text,jsonb),private.capture_important_source_change() from public,anon,authenticated;
create trigger record_profile_source_change after update on public.aluminium_profiles for each row execute function private.capture_important_source_change();
create trigger record_quality_source_change after update on public.quality_inspections for each row execute function private.capture_important_source_change();
create trigger record_payment_source_change after update on public.payments for each row execute function private.capture_important_source_change();
create trigger record_criterion_source_change after update on public.task_criterion_evidence for each row execute function private.capture_important_source_change();

create function private.boundary_snapshot(c uuid,p_type text,p_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare result jsonb;v_expected numeric;v_recorded numeric;v_count int;v_valid boolean;v_source jsonb;v_difference numeric;
begin
  if p_type='dispatch' then
    select jsonb_build_object('id',d.id,'total_weight_kg',d.total_weight_kg,'delivery_status',d.delivery_status,'actual_dispatched_at',d.actual_dispatched_at),d.total_weight_kg into v_source,v_expected from public.dispatches d where d.id=p_id and d.company_id=c;
    if v_source is null then raise exception 'Dispatch is unavailable'; end if;
    select sum(net_weight_kg),count(*),coalesce(bool_and(net_weight_kg>0 and net_weight_kg::text not in ('NaN','Infinity','-Infinity') and operator_verified_by is not null and operator_verified_at is not null),false),
      v_source||jsonb_build_object('packing',coalesce(jsonb_agg(jsonb_build_object('id',id,'kg',net_weight_kg,'pieces',number_of_pieces,'m',net_length_m,'line',order_item_id) order by id),'[]')) into v_recorded,v_count,v_valid,v_source from public.packing_list_items where company_id=c and dispatch_id=p_id;
  elsif p_type='invoice' then
    select jsonb_build_object('id',id,'grand_total',grand_total,'status',status,'dispatch_id',dispatch_id),grand_total into v_source,v_expected from public.invoices where id=p_id and company_id=c and deleted_at is null;
    if v_source is null then raise exception 'Invoice is unavailable'; end if;
    select sum(round(line_total,2)+round(line_total*coalesce(gst_percent,0)/100,2)),count(*),coalesce(bool_and(line_total>0 and line_total::text not in ('NaN','Infinity','-Infinity') and quantity>0 and unit_rate>0),false),
      v_source||jsonb_build_object('lines',coalesce(jsonb_agg(jsonb_build_object('id',id,'quantity',quantity,'line_total',line_total,'gst_percent',gst_percent,'source',source_line_id) order by id),'[]')) into v_recorded,v_count,v_valid,v_source from public.invoice_items where company_id=c and invoice_id=p_id;
  else raise exception 'Choose a supported process boundary'; end if;
  v_valid:=coalesce(v_valid and v_count>0 and v_expected is not null and v_expected>=0 and v_expected::text not in ('NaN','Infinity','-Infinity') and v_recorded is not null and v_recorded::text not in ('NaN','Infinity','-Infinity'),false);
  v_difference:=case when v_valid then abs(v_expected-v_recorded) end;
  result:=jsonb_build_object('source_type',p_type,'source_id',p_id,'expected',v_expected,'recorded',v_recorded,'unexplained',v_difference,'unit',case p_type when 'dispatch' then 'kg' else 'INR' end,'evidence_complete',v_valid,'source_count',v_count,'reconciled',v_valid and v_difference<=case p_type when 'dispatch' then 0.001 else 0.01 end,'fingerprint',md5(v_source::text),'sources',v_source);
  return result;
end $$;
revoke all on function private.boundary_snapshot(uuid,text,uuid) from public,anon,authenticated;

create function public.operational_assurance_command(p_command text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare c uuid;v_role text;v_page int:=coalesce((p_payload->>'page')::int,1);v_rows jsonb;r public.source_change_reviews;v_current jsonb;v_followup uuid;s jsonb;v_id uuid;v_previous public.boundary_reconciliations;
begin
  c:=private.commercial_actor(array['owner','admin','sales_manager','production_manager','factory_manager','inventory_manager','dispatch_manager','quality','accounts']);v_role:=private.get_current_user_role();
  if p_command is null or jsonb_typeof(p_payload) is distinct from 'object' or v_page not between 1 and 10000 then raise exception 'Invalid assurance request'; end if;
  if p_command='reviews.list' then
    if p_payload-array['page']<>'{}' then raise exception 'Invalid review page'; end if;
    select coalesce(jsonb_agg(to_jsonb(x)),'[]') into v_rows from(select cr.id,cr.task_id,t.title,cr.source_type,cr.source_id,cr.source_fingerprint,cr.before_snapshot,cr.after_snapshot,cr.previous_task_status,cr.changed_by,cr.changed_at,cr.status,cr.review_note,cr.followup_task_id from public.source_change_reviews cr join public.tasks t on t.id=cr.task_id and t.company_id=cr.company_id where cr.company_id=c and (cr.source_type<>'payments' or v_role in ('owner','admin','accounts')) order by (cr.status='requires_review') desc,cr.changed_at desc,cr.id limit 10 offset (v_page-1)*10)x;
    return jsonb_build_object('kind','reviews','page',v_page,'items',v_rows);
  end if;
  if p_command='review.resolve' then
    if p_payload-array['id','fingerprint','decision','note']<>'{}' or p_payload->>'decision' is null or p_payload->>'decision' not in ('accepted','repeat_required') or length(btrim(coalesce(p_payload->>'note',''))) not between 10 and 1000 then raise exception 'Record the review decision and evidence'; end if;
    select * into r from public.source_change_reviews where id=(p_payload->>'id')::uuid and company_id=c for update;
    if not found or r.changed_by=auth.uid() or r.status<>'requires_review' then raise exception 'Another authorized reviewer must decide this open change'; end if;
    if r.source_type='payments' and v_role not in ('owner','admin','accounts') then raise exception 'Finance source review is restricted to accounts'; end if;
    execute format('select private.assurance_basis($1,to_jsonb(x)) from public.%I x where id=$2 and company_id=$3',r.source_type) into v_current using r.source_type,r.source_id,c;
    if md5(v_current::text) is distinct from r.source_fingerprint or r.source_fingerprint is distinct from p_payload->>'fingerprint' then raise exception 'The important source changed again; review its latest evidence'; end if;
    if p_payload->>'decision'='repeat_required' then insert into public.tasks(company_id,task_type,title,description,priority,status,assigned_to,related_entity_type,related_entity_id,created_by) select c,'general',left('Repeat check: '||title,200),'Source change review '||r.id::text||': '||btrim(p_payload->>'note'),'high','open',assigned_to,related_entity_type,related_entity_id,auth.uid() from public.tasks where id=r.task_id returning id into v_followup;end if;
    update public.source_change_reviews set status=p_payload->>'decision',reviewed_by=auth.uid(),reviewed_at=clock_timestamp(),review_note=btrim(p_payload->>'note'),followup_task_id=v_followup where id=r.id;
    update public.source_change_reviews set status='superseded',reviewed_at=clock_timestamp(),review_note='Current source rechecked in review '||r.id::text where company_id=c and task_id=r.task_id and source_type=r.source_type and source_id=r.source_id and status='requires_review' and id<>r.id and changed_at<=r.changed_at;
    return jsonb_build_object('kind','saved','id',r.id);
  end if;
  if p_command not in ('sources.list','boundary.enable','boundary.evaluate','boundary.record') or p_payload->>'source_type' is null or p_payload->>'source_type' not in ('dispatch','invoice') then raise exception 'Choose a supported boundary action'; end if;
  if p_payload->>'source_type'='invoice' and v_role not in ('owner','admin','accounts') then raise exception 'Finance reconciliation is restricted to accounts'; end if;
  if p_command='sources.list' then
    if p_payload-array['source_type','search','page']<>'{}' or length(coalesce(p_payload->>'search',''))>80 then raise exception 'Invalid boundary source search';end if;
    execute format('select coalesce(jsonb_agg(to_jsonb(x)),''[]'') from(select id,%I label from public.%I where company_id=$1 and position(lower($2) in lower(coalesce(%I,'''')))>0 order by created_at desc,id limit 10 offset $3)x',case p_payload->>'source_type' when 'dispatch' then 'dispatch_number' else 'invoice_number' end,case p_payload->>'source_type' when 'dispatch' then 'dispatches' else 'invoices' end,case p_payload->>'source_type' when 'dispatch' then 'dispatch_number' else 'invoice_number' end) into v_rows using c,coalesce(p_payload->>'search',''),(v_page-1)*10;
    return jsonb_build_object('kind','sources','items',v_rows,'page',v_page);
  end if;
  if p_command='boundary.enable' then
    if v_role not in ('owner','admin') or p_payload-array['source_type']<>'{}' then raise exception 'An administrator enables process-boundary checks'; end if;
    insert into public.boundary_reconciliation_policies(company_id,source_type,enabled_by) values(c,p_payload->>'source_type',auth.uid()) on conflict do nothing;
    return jsonb_build_object('kind','saved','id',c);
  end if;
  if p_command='boundary.evaluate' and p_payload-array['source_type','source_id']<>'{}' then raise exception 'Invalid boundary query'; end if;
  if p_command='boundary.record' then
    if p_payload-array['id','source_type','source_id','fingerprint','decision','note']<>'{}' or length(btrim(coalesce(p_payload->>'note',''))) not between 8 and 1000 then raise exception 'Record the boundary decision with source evidence'; end if;
    v_id:=(p_payload->>'id')::uuid;perform pg_advisory_xact_lock(hashtextextended(c::text||':boundary:'||v_id::text,0));
    select * into v_previous from public.boundary_reconciliations where id=v_id;if found then if v_previous.company_id<>c or v_previous.request_payload<>p_payload then raise exception 'Boundary identity has different evidence';end if;return jsonb_build_object('kind','saved','id',v_id);end if;
  end if;
  execute format('select 1 from public.%I where company_id=$1 and id=$2 for update',case p_payload->>'source_type' when 'dispatch' then 'dispatches' else 'invoices' end) using c,(p_payload->>'source_id')::uuid;
  s:=private.boundary_snapshot(c,p_payload->>'source_type',(p_payload->>'source_id')::uuid);
  if p_command='boundary.evaluate' then return jsonb_build_object('kind','boundary','snapshot',s); end if;
  if s->>'fingerprint' is distinct from p_payload->>'fingerprint' then raise exception 'The boundary evidence changed; evaluate it again'; end if;
  if p_payload->>'decision' is null or p_payload->>'decision' not in ('hold','reconciled') or (p_payload->>'decision'='reconciled' and (s->>'reconciled')::boolean is not true) then raise exception 'An unexplained difference or incomplete source must remain on hold'; end if;
  insert into public.boundary_reconciliations(id,company_id,source_type,source_id,source_fingerprint,snapshot,decision,note,recorded_by,request_payload) values(v_id,c,p_payload->>'source_type',(p_payload->>'source_id')::uuid,s->>'fingerprint',s,p_payload->>'decision',btrim(p_payload->>'note'),auth.uid(),p_payload);
  return jsonb_build_object('kind','saved','id',v_id);
end $$;
revoke all on function public.operational_assurance_command(text,jsonb) from public,anon;
grant execute on function public.operational_assurance_command(text,jsonb) to authenticated;

create function private.guard_task_source_assurance() returns trigger language plpgsql security definer set search_path=public,private as $$
declare s jsonb;v_latest public.boundary_reconciliations;
begin
  if tg_op='UPDATE' and old.status='completed' and (new.related_entity_type,new.related_entity_id,new.company_id) is distinct from (old.related_entity_type,old.related_entity_id,old.company_id) then raise exception 'Completed task lineage cannot be changed; create a new reviewed task';end if;
  if new.status in ('in_progress','completed') and (tg_op='INSERT' or new.status is distinct from old.status or (new.related_entity_type,new.related_entity_id,new.company_id) is distinct from (old.related_entity_type,old.related_entity_id,old.company_id)) then
    if exists(select 1 from public.source_change_reviews r where r.company_id=new.company_id and r.task_id=new.id and (r.status='requires_review' or (r.status='repeat_required' and not exists(select 1 from public.tasks t where t.id=r.followup_task_id and t.status='completed')))) then raise exception 'Important source changes require independent review and any repeated check before relying on this task'; end if;
    if new.status='completed' and exists(select 1 from public.boundary_reconciliation_policies where company_id=new.company_id and source_type=new.related_entity_type) then
      s:=private.boundary_snapshot(new.company_id,new.related_entity_type,new.related_entity_id);
      select * into v_latest from public.boundary_reconciliations where company_id=new.company_id and source_type=new.related_entity_type and source_id=new.related_entity_id order by recorded_at desc,id desc limit 1;
      if (s->>'reconciled')::boolean is not true or v_latest.decision is distinct from 'reconciled' or v_latest.source_fingerprint is distinct from s->>'fingerprint' then raise exception 'Reconcile the current process boundary before completing this task';end if;
    end if;
  end if;return new;
end $$;
revoke all on function private.guard_task_source_assurance() from public,anon,authenticated;
create trigger zz_guard_task_source_assurance before insert or update of status,related_entity_type,related_entity_id,company_id on public.tasks for each row execute function private.guard_task_source_assurance();

alter function private.sop_evidence_state(public.tasks,text,uuid,text) rename to sop_evidence_state_before_source_review;
create function private.sop_evidence_state(t public.tasks,p_type text,p_id uuid,p_role text) returns text language plpgsql stable security definer set search_path=public,private as $$
begin
  if exists(select 1 from public.source_change_reviews r where r.company_id=t.company_id and r.task_id=t.id and (r.status='requires_review' or (r.status='repeat_required' and not exists(select 1 from public.tasks f where f.id=r.followup_task_id and f.status='completed')))) then return 'requires_review';end if;
  return private.sop_evidence_state_before_source_review(t,p_type,p_id,p_role);
end $$;
revoke all on function private.sop_evidence_state(public.tasks,text,uuid,text),private.sop_evidence_state_before_source_review(public.tasks,text,uuid,text) from public,anon,authenticated;
commit;

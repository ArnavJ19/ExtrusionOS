-- Feature 57: customer requirements at production, quality, packing and dispatch.
-- Existing compliance masters remain authoritative. Acknowledgements name the exact
-- requirement revision and order, and become stale when the master changes.
begin;
alter table public.customer_compliance_requirements add column work_stages text[] not null default array['quality','dispatch'];
alter table public.customer_compliance_requirements add column revision integer not null default 1;
alter table public.customer_compliance_requirements add constraint customer_requirements_valid_stages check(cardinality(work_stages) between 1 and 4 and work_stages <@ array['production','quality','packing','dispatch']);
create table public.order_requirement_acknowledgements (
  id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),order_id uuid not null references public.orders(id),
  requirement_id uuid not null references public.customer_compliance_requirements(id),revision integer not null,work_stage text not null,
  acknowledged_by uuid not null references public.app_users(id),acknowledged_by_name text not null,acknowledged_at timestamptz not null default clock_timestamp(),
  note text not null check(length(btrim(note)) between 3 and 500),requirement_snapshot jsonb not null,
  unique(order_id,requirement_id,revision,work_stage)
);
create index order_requirement_ack_company on public.order_requirement_acknowledgements(company_id,order_id);
alter table public.order_requirement_acknowledgements enable row level security;
revoke all on public.order_requirement_acknowledgements from public,anon,authenticated;
create policy requirement_ack_company on public.order_requirement_acknowledgements for select to authenticated using(company_id=(select private.get_current_user_company_id()) and (select private.get_current_user_dealer_id()) is null);
create function private.revise_customer_requirement() returns trigger language plpgsql set search_path=public,private as $$
begin
  if new.company_id is distinct from old.company_id or new.customer_id is distinct from old.customer_id then raise exception 'A customer requirement cannot move to another customer or company';end if;
  if (new.certificate_type,new.description,new.work_stages,new.is_mandatory,new.is_active) is distinct from (old.certificate_type,old.description,old.work_stages,old.is_mandatory,old.is_active) then new.revision:=old.revision+1;new.updated_at:=clock_timestamp();
  else new.revision:=old.revision;end if;
  return new;
end $$;
create trigger a_revise_customer_requirement before update on public.customer_compliance_requirements for each row execute function private.revise_customer_requirement();
create function private.requirement_stage_role(p_role text,p_stage text) returns boolean language sql immutable as $$
select coalesce(p_role in ('owner','admin','factory_manager') or case p_stage
 when 'production' then p_role in ('production_manager','production') when 'quality' then p_role='quality'
 when 'packing' then p_role in ('production_manager','production','dispatch_manager','dispatch') when 'dispatch' then p_role in ('dispatch_manager','dispatch') else false end,false)
$$;
create function private.require_order_requirements(p_company uuid,p_order uuid,p_stage text) returns void language plpgsql security definer set search_path=public,private as $$
declare missing text;
begin
  perform 1 from public.customer_compliance_requirements req join public.orders ord on ord.customer_id=req.customer_id and ord.company_id=req.company_id
    where ord.id=p_order and ord.company_id=p_company and req.is_active and p_stage=any(req.work_stages) order by req.id for share of req;
  select string_agg(c.certificate_type,', ' order by c.certificate_type) into missing from public.customer_compliance_requirements c join public.orders o on o.customer_id=c.customer_id and o.company_id=c.company_id
  where o.id=p_order and o.company_id=p_company and c.is_active and c.is_mandatory and p_stage=any(c.work_stages)
   and not exists(select 1 from public.order_requirement_acknowledgements a where a.order_id=p_order and a.requirement_id=c.id and a.revision=c.revision and a.work_stage=p_stage);
  if missing is not null then raise exception 'Review current customer requirements for % before proceeding: %',p_stage,left(missing,140) using errcode='23514';end if;
end $$;
create function private.guard_customer_step_requirements() returns trigger language plpgsql security definer set search_path=public,private as $$
declare v_order uuid;stage_name text;transitioned boolean;
begin
  if tg_table_name='production_jobs' then
    stage_name:='production';v_order:=new.order_id;transitioned:=new.status='in_progress' and (tg_op='INSERT' or old.status is distinct from new.status);
  elsif tg_table_name='quality_inspections' then
    stage_name:='quality';select order_id into v_order from public.production_jobs where id=new.production_job_id and company_id=new.company_id;
    if v_order is null then select order_id into v_order from public.finishing_jobs where id=new.finishing_job_id and company_id=new.company_id;end if;
    transitioned:=new.status='approved' and (tg_op='INSERT' or old.status is distinct from new.status);
  elsif tg_table_name='packaging_jobs' then
    stage_name:='packing';v_order:=new.order_id;transitioned:=new.status='completed' and (tg_op='INSERT' or old.status is distinct from new.status);
  else stage_name:='dispatch';v_order:=new.order_id;transitioned:=new.delivery_status='dispatched' and (tg_op='INSERT' or old.delivery_status is distinct from new.delivery_status);end if;
  if transitioned and v_order is not null then perform private.require_order_requirements(new.company_id,v_order,stage_name);end if;
  return new;
end $$;
create trigger zy_customer_requirements before insert or update on public.production_jobs for each row execute function private.guard_customer_step_requirements();
create trigger zy_customer_requirements before insert or update on public.quality_inspections for each row execute function private.guard_customer_step_requirements();
create trigger zy_customer_requirements before insert or update on public.packaging_jobs for each row execute function private.guard_customer_step_requirements();
create trigger zy_customer_requirements before insert or update on public.dispatches for each row execute function private.guard_customer_step_requirements();
create trigger a_keep_requirement_ack before update or delete on public.order_requirement_acknowledgements for each row execute function private.keep_sop_event();

create function public.customer_requirement_command(p_command text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare actor uuid:=auth.uid();company uuid:=private.get_current_user_company_id();role_name text:=private.get_current_user_role();actor_name text;
  o public.orders;c public.customer_compliance_requirements;v_stage text;v_rows jsonb;v_page int;v_total int;v_stages text[];v_id uuid;v_search text;v_status text;v_sort text;
begin
  if actor is null or company is null then raise exception 'Authentication required' using errcode='42501';end if;
  select coalesce(nullif(full_name,''),'Employee') into actor_name from public.app_users where id=actor and company_id=company and role=role_name and is_active and dealer_id is null;
  if actor_name is null or role_name in ('dealer_admin','dealer_staff') or jsonb_typeof(p_payload) is distinct from 'object' or p_command is null or p_command not in ('order.list','acknowledge','customer.list','requirement.load','requirement.save') then raise exception 'Action not permitted' using errcode='42501';end if;
  v_stage:=p_payload->>'stage';
  if p_command in ('order.list','acknowledge') then
    if not private.requirement_stage_role(role_name,v_stage) then raise exception 'This work stage is outside your role' using errcode='42501';end if;
    select * into o from public.orders where id=(p_payload->>'order_id')::uuid and company_id=company and deleted_at is null for update;
    if o.id is null then raise exception 'Order is unavailable';end if;
  else
    if role_name not in ('owner','admin','sales_manager','quality','factory_manager') then raise exception 'Only customer requirement managers can use this action' using errcode='42501';end if;
    if not exists(select 1 from public.customers where id=(p_payload->>'customer_id')::uuid and company_id=company) then raise exception 'Customer is unavailable';end if;
  end if;
  if p_command in ('order.list','customer.list') then
    v_page:=coalesce((p_payload->>'page')::int,1);if v_page not between 1 and 100000 then raise exception 'Invalid page';end if;
    v_search:=lower(btrim(coalesce(p_payload->>'search','')));v_status:=coalesce(p_payload->>'status','all');v_sort:=coalesce(p_payload->>'sort','name');
    if length(v_search)>80 or v_status not in ('all','active','inactive','required','advisory','reviewed','needs_review') or v_sort not in ('name','revision') then raise exception 'Invalid customer requirement request';end if;
    with eligible as (select req.id,req.customer_id,req.certificate_type,req.description,req.is_mandatory,req.is_active,req.work_stages,req.revision,
      (select jsonb_build_object('by',a.acknowledged_by_name,'at',a.acknowledged_at,'note',a.note) from public.order_requirement_acknowledgements a where a.order_id=o.id and a.requirement_id=req.id and a.revision=req.revision and a.work_stage=v_stage) as acknowledgement
      from public.customer_compliance_requirements req where req.company_id=company and req.customer_id=coalesce(o.customer_id,(p_payload->>'customer_id')::uuid)
      and (p_command='customer.list' or (req.is_active and v_stage=any(req.work_stages)))
      and (v_search='' or position(v_search in lower(req.certificate_type||' '||coalesce(req.description,'')))>0)
    ), filtered as (select * from eligible where case v_status when 'active' then is_active when 'inactive' then not is_active when 'required' then is_mandatory
      when 'advisory' then not is_mandatory when 'reviewed' then acknowledgement is not null when 'needs_review' then acknowledgement is null else true end)
    select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(x)) from (select * from filtered order by case when v_sort='revision' then revision end desc,is_mandatory desc,lower(certificate_type),id limit 10 offset (v_page-1)*10)x),'[]'::jsonb),'total_count',(select count(*) from filtered)) into v_rows;
    return v_rows;
  end if;
  if p_command='acknowledge' then
    select * into c from public.customer_compliance_requirements where id=(p_payload->>'requirement_id')::uuid and company_id=company and customer_id=o.customer_id and is_active and v_stage=any(work_stages) for share;
    if c.id is null then raise exception 'Requirement is unavailable';end if;
    if c.revision is distinct from (p_payload->>'expected_revision')::int then raise exception 'The customer requirement changed. Reload it before confirming';end if;
    if length(btrim(coalesce(p_payload->>'note',''))) not between 3 and 500 then raise exception 'Record how this requirement will be met';end if;
    insert into public.order_requirement_acknowledgements(company_id,order_id,requirement_id,revision,work_stage,acknowledged_by,acknowledged_by_name,note,requirement_snapshot)
      values(company,o.id,c.id,c.revision,v_stage,actor,actor_name,btrim(p_payload->>'note'),to_jsonb(c)-'company_id') on conflict(order_id,requirement_id,revision,work_stage) do nothing;
    return jsonb_build_object('acknowledged',true);
  end if;
  if p_command='requirement.load' then
    select * into c from public.customer_compliance_requirements where id=(p_payload->>'id')::uuid and company_id=company and customer_id=(p_payload->>'customer_id')::uuid;
    if c.id is null then raise exception 'Requirement is unavailable';end if;
    return jsonb_build_object('id',c.id,'customer_id',c.customer_id,'certificate_type',c.certificate_type,'description',c.description,'is_mandatory',c.is_mandatory,
      'is_active',c.is_active,'work_stages',to_jsonb(c.work_stages),'revision',c.revision,'acknowledgement',null);
  end if;
  v_id:=(p_payload->>'id')::uuid;
  select * into c from public.customer_compliance_requirements where id=v_id for update;
  if c.id is not null and (c.company_id<>company or c.customer_id<>(p_payload->>'customer_id')::uuid) then raise exception 'Requirement is unavailable';end if;
  if c.id is not null and c.revision is distinct from (p_payload->>'expected_revision')::int then raise exception 'The customer requirement changed. Reload it before saving';end if;
  v_stages:=array(select jsonb_array_elements_text(p_payload->'stages'));
  if cardinality(v_stages) not between 1 and 4 or not v_stages <@ array['production','quality','packing','dispatch'] then raise exception 'Choose the relevant work stages';end if;
  if length(btrim(coalesce(p_payload->>'title',''))) not between 3 and 120 or length(btrim(coalesce(p_payload->>'description',''))) not between 3 and 1000 then raise exception 'Describe the customer requirement and its acceptance condition';end if;
  insert into public.customer_compliance_requirements(id,company_id,customer_id,certificate_type,description,is_mandatory,is_active,work_stages)
    values(v_id,company,(p_payload->>'customer_id')::uuid,btrim(p_payload->>'title'),btrim(p_payload->>'description'),(p_payload->>'is_mandatory')::boolean,(p_payload->>'is_active')::boolean,v_stages)
    on conflict(id) do update set certificate_type=excluded.certificate_type,description=excluded.description,is_mandatory=excluded.is_mandatory,is_active=excluded.is_active,work_stages=excluded.work_stages
      -- A competing insert must not inherit the earlier ownership check.
      where c.id is not null and customer_compliance_requirements.company_id=company
        and customer_compliance_requirements.customer_id=(p_payload->>'customer_id')::uuid
        and customer_compliance_requirements.revision=(p_payload->>'expected_revision')::int returning * into c;
  if not found then raise exception 'The customer requirement changed. Reload it before saving';end if;
  return jsonb_build_object('id',c.id,'revision',c.revision);
exception when invalid_text_representation or numeric_value_out_of_range or not_null_violation then raise exception 'Invalid customer requirement request';
end $$;
revoke all on function private.revise_customer_requirement(),private.requirement_stage_role(text,text),private.require_order_requirements(uuid,uuid,text),private.guard_customer_step_requirements() from public,anon,authenticated;
revoke all on function public.customer_requirement_command(text,jsonb) from public,anon;
grant execute on function public.customer_requirement_command(text,jsonb) to authenticated;
commit;

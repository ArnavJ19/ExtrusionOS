-- R18 local candidate only; not applied. Requires the complete reconciled prerequisite chain,
-- including R17 terminal evidence protection. Review legacy receipt provenance before activation.
begin;

alter table public.packaging_jobs add column if not exists finishing_job_id uuid
  references public.finishing_jobs(id) on delete restrict;

drop index if exists public.packaging_jobs_one_active_production_source_idx;
create unique index if not exists packaging_jobs_one_active_unfinished_source_idx
  on public.packaging_jobs(company_id, production_job_id)
  where production_job_id is not null and finishing_job_id is null and status <> 'cancelled';
create index if not exists packaging_jobs_finishing_source_idx
  on public.packaging_jobs(company_id, production_job_id, finishing_job_id, status);

create or replace function private.assert_finishing_material_lineage(p_company_id uuid, p_job_id uuid)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  v_job public.production_jobs%rowtype;
  v_input numeric;
  v_accepted numeric;
  v_rows bigint;
  v_reachable bigint;
begin
  select * into v_job from public.production_jobs where id=p_job_id and company_id=p_company_id;
  if not found or v_job.status<>'completed' or coalesce(v_job.actual_quantity_kg,0)<=0 then
    raise exception 'Finishing must reference captured completed production for this company';
  end if;
  if exists(select 1 from public.finishing_jobs f where f.company_id=p_company_id and f.production_job_id=p_job_id
    and (f.order_id is distinct from v_job.order_id or f.finishing_type is distinct from v_job.finishing_type
      or f.status is null or f.status not in ('planned','sent_to_vendor','in_process','received','completed','rejected','not_required')
      or coalesce(f.input_weight_kg,0)<=0 or coalesce(f.output_weight_kg,0)<0 or coalesce(f.rejection_weight_kg,0)<0
      or (f.status in ('completed','rejected') and (coalesce(f.output_weight_kg,0)+coalesce(f.rejection_weight_kg,0)>f.input_weight_kg+0.01
        or (coalesce(f.output_weight_kg,0)>0 and (f.received_date is null
          or f.received_date>(now() at time zone 'Asia/Kolkata')::date
          or (f.sent_date is not null and f.received_date<f.sent_date))))))) then
    raise exception 'Finishing source, receipt or quantity evidence needs review';
  end if;
  select coalesce(sum(input_weight_kg) filter(where retry_of_finishing_job_id is null),0),
    coalesce(sum(output_weight_kg) filter(where status in ('completed','rejected')),0),count(*)
  into v_input,v_accepted,v_rows from public.finishing_jobs where company_id=p_company_id and production_job_id=p_job_id;
  if v_input>v_job.actual_quantity_kg+0.001 or v_accepted>v_job.actual_quantity_kg+0.001 then
    raise exception 'Finishing root input or accepted output exceeds captured production';
  end if;
  if exists(select 1 from public.finishing_jobs child left join public.finishing_jobs parent on parent.id=child.retry_of_finishing_job_id
    where child.company_id=p_company_id and child.production_job_id=p_job_id and child.retry_of_finishing_job_id is not null
      and (parent.id is null or parent.company_id is distinct from child.company_id or parent.order_id is distinct from child.order_id
        or parent.production_job_id is distinct from child.production_job_id or parent.finishing_type is distinct from child.finishing_type
        or parent.status is distinct from 'rejected'
        or abs(child.input_weight_kg-least(coalesce(parent.rejection_weight_kg,0),greatest(parent.input_weight_kg-coalesce(parent.output_weight_kg,0),0)))>0.01))
    or exists(select 1 from public.finishing_jobs where company_id=p_company_id and production_job_id=p_job_id
      and retry_of_finishing_job_id is not null group by retry_of_finishing_job_id having count(*)>1) then
    raise exception 'Finishing corrective retry lineage or recoverable input needs review';
  end if;
  with recursive source_tree(id) as (
    select id from public.finishing_jobs where company_id=p_company_id and production_job_id=p_job_id and retry_of_finishing_job_id is null
    union
    select child.id from public.finishing_jobs child join source_tree parent on child.retry_of_finishing_job_id=parent.id
      where child.company_id=p_company_id and child.production_job_id=p_job_id
  ) select count(*) into v_reachable from source_tree;
  if v_reachable<>v_rows then raise exception 'Finishing retry lineage has no verified original source'; end if;
end;
$$;

create or replace function private.guard_finishing_material_lineage()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if tg_op='UPDATE' and (to_jsonb(new)-'updated_at') is not distinct from (to_jsonb(old)-'updated_at') then return new; end if;
  perform 1 from public.production_jobs where id=new.production_job_id and company_id=new.company_id for update nowait;
  if not found then raise exception 'Finishing production source is unavailable'; end if;
  perform private.assert_finishing_material_lineage(new.company_id,new.production_job_id);
  return new;
exception when lock_not_available then
  raise exception 'Production material is being updated; refresh and retry finishing' using errcode='55P03';
end;
$$;
drop trigger if exists aa_guard_finishing_material_lineage on public.finishing_jobs;
create trigger aa_guard_finishing_material_lineage after insert or update on public.finishing_jobs
for each row execute function private.guard_finishing_material_lineage();

create or replace function private.finishing_accepted_output_kg(p_company_id uuid,p_job_id uuid,p_finishing_id uuid)
returns numeric language plpgsql security definer set search_path = public, private as $$
declare v_output numeric;
begin
  perform private.assert_finishing_material_lineage(p_company_id,p_job_id);
  select output_weight_kg into v_output from public.finishing_jobs where id=p_finishing_id and company_id=p_company_id
    and production_job_id=p_job_id and status in ('completed','rejected') and received_date is not null and output_weight_kg>0;
  return coalesce(v_output,0);
end;
$$;

create or replace view public.finishing_accepted_outputs with (security_barrier=true) as
select f.id,f.company_id,f.order_id,f.production_job_id,f.finishing_type,f.status,f.output_weight_kg,f.received_date,f.created_at,
  case when f.retry_of_finishing_job_id is null then 'Original receipt' else 'Corrective retry' end receipt_kind
from public.finishing_jobs f join public.production_jobs j on j.id=f.production_job_id and j.company_id=f.company_id
  and j.order_id=f.order_id and j.finishing_type=f.finishing_type
where auth.uid() is not null and f.company_id=private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner','admin','factory_manager','production_manager','production','quality','viewer','dispatch_manager','dispatch','inventory_manager')
  and j.status='completed' and f.status in ('completed','rejected') and f.received_date is not null
  and f.received_date<=(now() at time zone 'Asia/Kolkata')::date and (f.sent_date is null or f.received_date>=f.sent_date)
  and f.output_weight_kg>0 and f.input_weight_kg>0 and f.rejection_weight_kg>=0
  and f.output_weight_kg+f.rejection_weight_kg<=f.input_weight_kg+0.01;
revoke all on public.finishing_accepted_outputs from public,anon,authenticated;
grant select on public.finishing_accepted_outputs to authenticated;

create or replace function private.guard_packaging_finishing_source()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_job public.production_jobs%rowtype;v_output numeric;v_other numeric;
begin
  select * into v_job from public.production_jobs where id=new.production_job_id and company_id=new.company_id for update nowait;
  if not found or v_job.order_id is distinct from new.order_id or v_job.status<>'completed' then
    raise exception 'Packaging source must be completed production for this company and order';
  end if;
  if tg_op='UPDATE' and (old.company_id is distinct from new.company_id or old.order_id is distinct from new.order_id
    or old.production_job_id is distinct from new.production_job_id
    or (old.finishing_job_id is not null and old.finishing_job_id is distinct from new.finishing_job_id)) then
    raise exception 'Packaging receipt source cannot be changed after assignment';
  end if;
  if new.status='cancelled' then return new; end if;
  if coalesce(v_job.finishing_type,'mill_finish')='mill_finish' then
    if new.finishing_job_id is not null then raise exception 'Mill-finish packaging must not claim a finishing receipt'; end if;
    return new;
  end if;
  if new.finishing_job_id is null then raise exception 'Choose the queued package or accepted finishing receipt before saving packaging'; end if;
  v_output:=private.finishing_accepted_output_kg(new.company_id,new.production_job_id,new.finishing_job_id);
  if v_output<=0 then raise exception 'Packaging requires a final accepted finishing receipt for this production job'; end if;
  select coalesce(sum(profile_weight_kg),0) into v_other from public.packaging_jobs
    where company_id=new.company_id and production_job_id=new.production_job_id and finishing_job_id=new.finishing_job_id
      and status<>'cancelled' and id<>coalesce(new.id,'00000000-0000-0000-0000-000000000000'::uuid);
  if coalesce(new.profile_weight_kg,0)<0 or v_other+coalesce(new.profile_weight_kg,0)>v_output+0.001
    or (new.status='completed' and coalesce(new.profile_weight_kg,0)<=0) then
    raise exception 'Packaging weight exceeds or lacks its recorded accepted finishing portion';
  end if;
  return new;
exception when lock_not_available then
  raise exception 'Production material is being updated; refresh and retry packaging' using errcode='55P03';
end;
$$;
drop trigger if exists zz_guard_packaging_finishing_source on public.packaging_jobs;
create trigger zz_guard_packaging_finishing_source before insert or update on public.packaging_jobs
for each row execute function private.guard_packaging_finishing_source();

create or replace function public.route_completed_finishing_to_packaging()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_job public.production_jobs%rowtype;v_number text;
begin
  if new.status in ('completed','rejected') and coalesce(new.output_weight_kg,0)>0
    and (tg_op='INSERT' or old.status is distinct from new.status) then
    perform private.assert_finishing_material_lineage(new.company_id,new.production_job_id);
    if exists(select 1 from public.packaging_jobs where company_id=new.company_id and production_job_id=new.production_job_id
      and finishing_job_id is null and status<>'cancelled') then
      raise exception 'Existing packaging has no finishing receipt link; review its source before finalizing another receipt';
    end if;
    if exists(select 1 from public.packaging_jobs where company_id=new.company_id and finishing_job_id=new.id) then return new; end if;
    select * into v_job from public.production_jobs where id=new.production_job_id and company_id=new.company_id;
    v_number:=private.next_business_number_locked('public.packaging_jobs'::regclass,'packaging_number',new.company_id,'PKG',current_date);
    insert into public.packaging_jobs(company_id,packaging_number,order_id,production_job_id,finishing_job_id,scheduled_date,pieces,
      profile_weight_kg,profile_length_m,status,notes,created_by)
    values(new.company_id,v_number,new.order_id,new.production_job_id,new.id,current_date,
      round(coalesce(nullif(v_job.actual_pieces,0),v_job.pieces,0)*new.output_weight_kg/v_job.actual_quantity_kg)::integer,
      new.output_weight_kg,
      coalesce(nullif(v_job.actual_meters,0),coalesce(v_job.length_per_piece_m,0)*coalesce(nullif(v_job.actual_pieces,0),v_job.pieces,0))*new.output_weight_kg/v_job.actual_quantity_kg,
      'scheduled','Accepted finishing portion. Verify packing quantities and complete QC/material release.',auth.uid());
    perform private.advance_order_stage(new.company_id,new.order_id,'finishing',
      concat('Finishing receipt retained ',new.output_weight_kg,' kg accepted output; rejected material remains separate.'));
  end if;
  return new;
end;
$$;

create or replace function private.finishing_dispatch_ready_kg(p_company_id uuid,p_order_id uuid,p_job_id uuid,p_quality_required boolean)
returns numeric language plpgsql security definer set search_path = public, private as $$
declare v_finishing record;v_job public.production_jobs%rowtype;v_approved numeric;v_packaged numeric;v_ready numeric:=0;
  v_accepted_count integer;v_legacy_count integer;
begin
  perform private.assert_finishing_material_lineage(p_company_id,p_job_id);
  select * into v_job from public.production_jobs where id=p_job_id and company_id=p_company_id and order_id=p_order_id;
  if not found or coalesce(v_job.finishing_type,'mill_finish')='mill_finish' then raise exception 'Accepted finishing source does not match this order'; end if;
  select count(*) into v_accepted_count from public.finishing_jobs where company_id=p_company_id and production_job_id=p_job_id
    and status in ('completed','rejected') and output_weight_kg>0 and received_date is not null;
  select count(*) into v_legacy_count from public.packaging_jobs where company_id=p_company_id and production_job_id=p_job_id
    and finishing_job_id is null and status<>'cancelled';
  if v_legacy_count>0 and (v_legacy_count<>1 or v_accepted_count<>1 or exists(select 1 from public.packaging_jobs where company_id=p_company_id
    and production_job_id=p_job_id and finishing_job_id is not null and status<>'cancelled')) then
    raise exception 'Legacy packaging has ambiguous finishing receipt provenance; review before dispatch';
  end if;
  for v_finishing in select id,output_weight_kg from public.finishing_jobs where company_id=p_company_id and production_job_id=p_job_id
    and order_id=p_order_id and status in ('completed','rejected') and output_weight_kg>0 and received_date is not null order by id
  loop
    select coalesce(sum(quantity_checked_kg),0) into v_approved from public.quality_inspections where company_id=p_company_id
      and production_job_id=p_job_id and profile_id=v_job.profile_id and finishing_job_id=v_finishing.id and status='approved';
    if v_approved>v_finishing.output_weight_kg+0.01 then raise exception 'QC approval exceeds its accepted finishing portion'; end if;
    select coalesce(sum(p.profile_weight_kg),0) into v_packaged from public.packaging_jobs p where p.company_id=p_company_id
      and p.order_id=p_order_id and p.production_job_id=p_job_id and p.status='completed'
      and (p.finishing_job_id=v_finishing.id or (v_legacy_count=1 and p.finishing_job_id is null))
      and exists(select 1 from public.packaging_job_materials m where m.company_id=p_company_id and m.job_id=p.id and m.quantity_required>0);
    if v_packaged>v_finishing.output_weight_kg+0.001 then raise exception 'Packaged weight exceeds its accepted finishing portion'; end if;
    v_ready:=v_ready+least(v_finishing.output_weight_kg,v_packaged,
      case when coalesce(p_quality_required,true) then v_approved else v_finishing.output_weight_kg end);
  end loop;
  if v_ready>v_job.actual_quantity_kg+0.001 then raise exception 'Released finishing output exceeds captured production'; end if;
  return v_ready;
end;
$$;

drop trigger if exists route_completed_finishing_to_packaging on public.finishing_jobs;
create trigger route_completed_finishing_to_packaging after insert or update of status on public.finishing_jobs
for each row execute function public.route_completed_finishing_to_packaging();

create or replace function public.get_finished_production_readiness(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_company uuid:=private.get_current_user_company_id();v_job record;v_quality boolean;v_rows jsonb:='[]'::jsonb;
begin
  if v_company is null or auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if coalesce(private.get_current_user_role(),'') not in ('owner','admin','factory_manager','inventory_manager','dispatch_manager','dispatch') then
    raise exception 'Permission denied for finished production readiness' using errcode='42501';
  end if;
  if not exists(select 1 from public.orders where id=p_order_id and company_id=v_company) then raise exception 'Order not found for this company'; end if;
  select coalesce((select is_enabled from public.feature_flags where company_id=v_company and module_name='quality_compliance' limit 1),true) into v_quality;
  for v_job in select id from public.production_jobs where company_id=v_company and order_id=p_order_id and status='completed'
    and coalesce(finishing_type,'mill_finish')<>'mill_finish' order by id
  loop
    v_rows:=v_rows||jsonb_build_array(jsonb_build_object('production_job_id',v_job.id,
      'ready_weight_kg',private.finishing_dispatch_ready_kg(v_company,p_order_id,v_job.id,v_quality)));
  end loop;
  return jsonb_build_object('company_id',v_company,'order_id',p_order_id,'total_count',jsonb_array_length(v_rows),'rows',v_rows);
end;
$$;

revoke all on function private.assert_finishing_material_lineage(uuid,uuid),private.guard_finishing_material_lineage(),
  private.finishing_accepted_output_kg(uuid,uuid,uuid),private.guard_packaging_finishing_source(),
  public.route_completed_finishing_to_packaging(),private.finishing_dispatch_ready_kg(uuid,uuid,uuid,boolean)
  from public,anon,authenticated;
revoke all on function public.get_finished_production_readiness(uuid) from public,anon;
grant execute on function public.get_finished_production_readiness(uuid) to authenticated;

create or replace function public.validate_quality_production_link()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_job record;
  v_finishing record;
  v_source_kg numeric;
  v_disposed_kg numeric;
begin
  if new.production_job_id is null then
    if tg_op = 'INSERT' or new.status in ('approved','rejected','rework') then raise exception 'Select the completed production job inspected by this QC record' using errcode = '23514'; end if;
    return new;
  end if;
  select id, company_id, order_id, profile_id, status, actual_quantity_kg, finishing_type
  into v_job from public.production_jobs where id = new.production_job_id for update nowait;
  if not found or v_job.company_id <> new.company_id or v_job.profile_id <> new.profile_id or v_job.status <> 'completed' then
    raise exception 'QC must link to completed production for the same company/profile' using errcode = '23514';
  end if;
  v_source_kg := v_job.actual_quantity_kg;
  if coalesce(v_job.finishing_type,'mill_finish') <> 'mill_finish' then
    if new.finishing_job_id is null then raise exception 'Post-finishing QC must link a final accepted finishing receipt' using errcode = '23514'; end if;
    select id, company_id, production_job_id, status, output_weight_kg into v_finishing from public.finishing_jobs where id = new.finishing_job_id;
    if not found or v_finishing.company_id <> new.company_id or v_finishing.production_job_id <> new.production_job_id or v_finishing.status not in ('completed','rejected') then
      raise exception 'QC requires a final accepted finishing receipt for this production job' using errcode = '23514';
    end if;
    v_source_kg := private.finishing_accepted_output_kg(new.company_id,new.production_job_id,new.finishing_job_id);
    if v_source_kg<=0 then raise exception 'QC requires a final accepted finishing receipt'; end if;
  elsif new.finishing_job_id is not null then raise exception 'Mill-finish QC must not link an unrelated finishing job' using errcode = '23514'; end if;

  if new.status in ('approved','rejected','rework') then
    if coalesce(new.quantity_checked_kg,0) <= 0 then raise exception 'QC disposition quantity must be greater than zero' using errcode = '23514'; end if;
    perform pg_advisory_xact_lock(hashtextextended('qc-disposition:' || new.company_id::text || ':' || new.production_job_id::text || ':' || coalesce(new.finishing_job_id::text,'mill-finish'),0));
    select coalesce(sum(q.quantity_checked_kg),0) into v_disposed_kg from public.quality_inspections q
    where q.company_id=new.company_id and q.production_job_id=new.production_job_id
      and coalesce(q.finishing_job_id,'00000000-0000-0000-0000-000000000000'::uuid)=coalesce(new.finishing_job_id,'00000000-0000-0000-0000-000000000000'::uuid)
      and q.status in ('approved','rejected','rework') and q.id <> coalesce(new.id,'00000000-0000-0000-0000-000000000000'::uuid)
      and not exists(select 1 from public.quality_rework_resolutions resolution where resolution.source_inspection_id=q.id);
    if v_disposed_kg + new.quantity_checked_kg > v_source_kg + 0.01 then raise exception 'QC disposition exceeds available source output (%)',v_source_kg using errcode='23514'; end if;
  end if;
  if new.status='approved' then
    if coalesce(btrim(new.inspector_name),'')='' then raise exception 'Approved QC requires an inspector name' using errcode='23514'; end if;
    if new.surface_finish_ok is distinct from true then raise exception 'QC cannot be approved while surface finish is marked failed' using errcode='23514'; end if;
  end if;
  if new.resolution_id is not null and not exists(select 1 from public.quality_rework_resolutions r where r.id=new.resolution_id
    and r.company_id=new.company_id and r.production_job_id=new.production_job_id and r.finishing_job_id is not distinct from new.finishing_job_id and r.profile_id=new.profile_id
    and ((new.status='approved' and new.quantity_checked_kg <= r.approved_weight_kg) or (new.status='rejected' and new.quantity_checked_kg <= r.rejected_weight_kg))) then
    raise exception 'Resolved QC disposition must match its immutable rework resolution';
  end if;
  return new;
exception when lock_not_available then
  raise exception 'Production output is being corrected; retry quality disposition after refresh' using errcode='55P03';
end;
$$;

create or replace function private.save_packaging_job_atomic(
  p_job_id uuid,
  p_job jsonb,
  p_materials jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_order_id uuid := nullif(p_job ->> 'order_id', '')::uuid;
  v_production_job_id uuid := nullif(p_job ->> 'production_job_id', '')::uuid;
  v_job_id uuid;
  v_payload jsonb;
  v_material jsonb;
  v_material_id uuid;
  v_quantity numeric;
  v_requested_status text := coalesce(nullif(p_job ->> 'status', ''), 'scheduled');
  v_existing_status text;
  v_source record;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if private.get_current_user_role() not in ('owner','admin','production_manager','production','dispatch_manager','dispatch') then
    raise exception 'Permission denied for packaging' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_materials, '[]'::jsonb)) <> 'array' then
    raise exception 'Packaging materials must be an array';
  end if;

  select actual_pieces, pieces
  into v_source
  from public.production_jobs
  where id = v_production_job_id
    and company_id = v_company_id
    and order_id = v_order_id
    and status = 'completed'
  for update;
  if not found then
    raise exception 'Packaging must link to a completed production job for the selected order';
  end if;
  if p_job ->> 'status' = 'completed' and jsonb_array_length(coalesce(p_materials, '[]'::jsonb)) = 0 then
    raise exception 'Select at least one packaging material before completing packaging';
  end if;

  v_payload := private.keep_jsonb_keys(p_job, array[
    'packaging_number','order_id','production_job_id','finishing_job_id','scheduled_date','pieces',
    'profile_weight_kg','profile_length_m','status','notes'
  ]) || jsonb_build_object(
    'company_id', v_company_id,
    'order_id', v_order_id,
    'production_job_id', v_production_job_id,
    'pieces', case
      when coalesce(nullif(p_job ->> 'pieces', '')::integer, 0) > 0
        then nullif(p_job ->> 'pieces', '')::integer
      else coalesce(nullif(v_source.actual_pieces, 0), v_source.pieces, 0)
    end
  );

  if p_job_id is null then
    if nullif(v_payload ->> 'packaging_number', '') is null then
      v_payload := v_payload || jsonb_build_object(
        'packaging_number', private.next_business_number_locked(
          'public.packaging_jobs'::regclass,
          'packaging_number',
          v_company_id,
          'PKG',
          coalesce(nullif(v_payload ->> 'scheduled_date', '')::date, current_date)
        )
      );
    end if;
    if v_requested_status in ('completed', 'cancelled') then
      v_payload := v_payload || jsonb_build_object('status', 'scheduled');
    end if;
    v_job_id := private.insert_jsonb_row(
      'public.packaging_jobs'::regclass,
      v_payload || jsonb_build_object('created_by', auth.uid())
    );
  else
    select status into v_existing_status
    from public.packaging_jobs
    where id = p_job_id and company_id = v_company_id
    for update;
    if not found then raise exception 'Packaging job not found for this company'; end if;
    if v_existing_status in ('completed', 'cancelled') then
      raise exception 'Completed or cancelled packaging jobs cannot be edited; use a reversal record';
    end if;
    if v_requested_status in ('completed', 'cancelled') then
      v_payload := v_payload || jsonb_build_object('status', v_existing_status);
    end if;
    v_job_id := private.update_jsonb_row(
      'public.packaging_jobs'::regclass,
      p_job_id,
      v_company_id,
      (v_payload - 'packaging_number') || jsonb_build_object('updated_at', now())
    );
  end if;

  delete from public.packaging_job_materials
  where job_id = v_job_id and company_id = v_company_id;

  for v_material in
    select value from jsonb_array_elements(coalesce(p_materials, '[]'::jsonb))
  loop
    v_material_id := nullif(v_material ->> 'material_id', '')::uuid;
    v_quantity := coalesce(nullif(v_material ->> 'quantity_required', '')::numeric, 0);
    if v_material_id is null or v_quantity <= 0 then
      raise exception 'Every packaging material requires a positive quantity';
    end if;
    perform 1 from public.packaging_materials
    where id = v_material_id and company_id = v_company_id and is_active = true
    for update;
    if not found then raise exception 'Packaging material is unavailable for this company'; end if;

    insert into public.packaging_job_materials(
      company_id, job_id, material_id, quantity_required, created_by
    ) values (
      v_company_id, v_job_id, v_material_id, v_quantity, auth.uid()
    );
  end loop;

  if v_requested_status in ('completed', 'cancelled') then
    update public.packaging_jobs
    set status = v_requested_status, updated_at = now()
    where id = v_job_id and company_id = v_company_id;
  end if;

  return v_job_id;
end;
$$;

create or replace function private.assert_dispatch_ready(p_dispatch_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_dispatch record;
  v_item record;
  v_job record;
  v_fulfillment record;
  v_reservation record;
  v_packaged_kg numeric;
  v_tare_kg numeric;
  v_source_used_kg numeric;
  v_ready_kg numeric;
  v_approved_kg numeric;
  v_quality_required boolean;
  v_item_count integer;
begin
  select * into v_dispatch
  from public.dispatches
  where id = p_dispatch_id
  for update;
  if not found then return; end if;

  perform 1 from public.orders
  where id = v_dispatch.order_id and company_id = v_dispatch.company_id
  for update;
  if not found then raise exception 'Dispatch order is unavailable for this company'; end if;
  if coalesce(v_dispatch.total_weight_kg, 0) <= 0 then
    raise exception 'Dispatch net aluminium weight must be greater than zero';
  end if;

  select count(*), coalesce(sum(net_weight_kg), 0), coalesce(sum(tare_weight_kg), 0)
  into v_item_count, v_packaged_kg, v_tare_kg
  from public.packing_list_items
  where dispatch_id = p_dispatch_id and company_id = v_dispatch.company_id;
  if v_item_count = 0 then raise exception 'A dispatch requires at least one physical bundle'; end if;
  if v_item_count <> v_dispatch.number_of_bundles then
    raise exception 'Physical bundle count (%) must equal dispatch bundle count (%)', v_item_count, v_dispatch.number_of_bundles;
  end if;
  if abs(v_packaged_kg - v_dispatch.total_weight_kg) > 0.01 then
    raise exception 'Packing net aluminium weight (%) must equal dispatch net weight (%)', v_packaged_kg, v_dispatch.total_weight_kg;
  end if;
  if abs(v_tare_kg - v_dispatch.total_tare_weight_kg) > 0.01 then
    raise exception 'Packing tare weight (%) must equal dispatch tare weight (%)', v_tare_kg, v_dispatch.total_tare_weight_kg;
  end if;

  select coalesce((
    select is_enabled from public.feature_flags
    where company_id = v_dispatch.company_id and module_name = 'quality_compliance'
    limit 1
  ), true) into v_quality_required;

  for v_item in
    select * from public.packing_list_items
    where dispatch_id = p_dispatch_id and company_id = v_dispatch.company_id
  loop
    if coalesce(v_item.gross_weight_kg, 0) <= 0
       or coalesce(v_item.tare_weight_kg, 0) < 0
       or coalesce(v_item.net_weight_kg, 0) <= 0 then
      raise exception 'Every bundle requires positive gross/net weight and non-negative tare';
    end if;
    if v_item.source_record_id is distinct from v_dispatch.order_id
       or v_item.source_line_id is null
       or v_item.source_kind is null then
      raise exception 'Every bundle must identify its order, source type, and source row';
    end if;

    if v_item.source_kind = 'reservation' then
      select id, company_id, order_id, profile_id, profile_stock_batch_id,
             reserved_weight_kg, reserved_length_m, status
      into v_reservation
      from public.profile_stock_reservations
      where id = v_item.reservation_id
      for update;
      if not found
         or v_item.source_line_id <> v_reservation.id
         or v_reservation.company_id <> v_dispatch.company_id
         or v_reservation.order_id <> v_dispatch.order_id
         or v_reservation.profile_id <> v_item.profile_id
         or v_reservation.profile_stock_batch_id <> v_item.profile_stock_batch_id
         or v_reservation.status not in ('active','consumed') then
        raise exception 'Reserved-stock bundle is not linked to an eligible reservation and stock batch';
      end if;
      select coalesce(sum(pli.net_weight_kg), 0) into v_source_used_kg
      from public.packing_list_items pli
      where pli.company_id = v_dispatch.company_id
        and pli.reservation_id = v_reservation.id;
      if v_source_used_kg > v_reservation.reserved_weight_kg + 0.01 then
        raise exception 'Dispatch packing exceeds reserved stock weight';
      end if;
      continue;
    end if;

    select id, company_id, order_id, profile_id, status, actual_quantity_kg, job_number, finishing_type
    into v_job
    from public.production_jobs
    where id = v_item.source_line_id;

    if v_item.source_kind = 'production' and found then
      if v_item.reservation_id is not null or v_item.profile_stock_batch_id is not null
         or v_job.company_id <> v_dispatch.company_id
         or v_job.order_id <> v_dispatch.order_id
         or v_job.profile_id <> v_item.profile_id
         or v_job.status <> 'completed'
         or coalesce(v_job.actual_quantity_kg, 0) <= 0 then
        raise exception 'Production bundle source is not completed production for this order/profile';
      end if;
      perform 1 from public.production_jobs where id=v_job.id and company_id=v_dispatch.company_id for update nowait;
      if coalesce(v_job.finishing_type,'mill_finish')<>'mill_finish' then
        v_ready_kg:=private.finishing_dispatch_ready_kg(v_dispatch.company_id,v_dispatch.order_id,v_job.id,v_quality_required);
        if v_ready_kg<=0 then raise exception 'Production job % needs accepted finishing, QC release and completed packaging',coalesce(v_job.job_number,v_job.id::text); end if;
      else
        v_ready_kg:=v_job.actual_quantity_kg;
        if v_quality_required then
          select coalesce(sum(quantity_checked_kg),0) into v_approved_kg from public.quality_inspections
          where company_id=v_dispatch.company_id and production_job_id=v_job.id and profile_id=v_job.profile_id
            and status='approved' and finishing_job_id is null;
          v_ready_kg:=least(v_ready_kg,v_approved_kg);
          if v_ready_kg<=0 then raise exception 'Production job % needs QC-approved released quantity before dispatch',coalesce(v_job.job_number,v_job.id::text); end if;
        end if;
        if not exists(select 1 from public.packaging_jobs p where p.company_id=v_dispatch.company_id
          and p.order_id=v_dispatch.order_id and p.production_job_id=v_job.id and p.status='completed'
          and exists(select 1 from public.packaging_job_materials m where m.company_id=v_dispatch.company_id and m.job_id=p.id and m.quantity_required>0)) then
          raise exception 'Production job % must have completed packaging with issued materials before dispatch',coalesce(v_job.job_number,v_job.id::text);
        end if;
      end if;
      select coalesce(sum(pli.net_weight_kg), 0) into v_source_used_kg
      from public.packing_list_items pli
      where pli.company_id = v_dispatch.company_id and pli.source_line_id = v_job.id;
      if v_source_used_kg > v_ready_kg + 0.01 then
        raise exception 'Dispatch packing exceeds QC-released output for production job %', coalesce(v_job.job_number, v_job.id::text);
      end if;
      continue;
    end if;

    select id, company_id, order_id, profile_id, profile_stock_batch_id, fulfilled_weight_kg, credited_at
    into v_fulfillment
    from public.order_dealer_stock_fulfillments
    where id = v_item.source_line_id;
    if v_item.source_kind <> 'dealer_stock'
       or not found
       or v_item.reservation_id is not null
       or v_fulfillment.company_id <> v_dispatch.company_id
       or v_fulfillment.order_id <> v_dispatch.order_id
       or v_fulfillment.profile_id <> v_item.profile_id
       or v_fulfillment.profile_stock_batch_id <> v_item.profile_stock_batch_id
       or v_fulfillment.credited_at is not null then
      raise exception 'Dealer-stock bundle is not linked to its exact fulfillment and stock batch';
    end if;
    select coalesce(sum(pli.net_weight_kg), 0) into v_source_used_kg
    from public.packing_list_items pli
    where pli.company_id = v_dispatch.company_id and pli.source_line_id = v_fulfillment.id;
    if v_source_used_kg > v_fulfillment.fulfilled_weight_kg + 0.01 then
      raise exception 'Dispatch packing exceeds dealer-stock fulfillment weight';
    end if;
  end loop;
end;
$$;

revoke all on function public.validate_quality_production_link(),private.save_packaging_job_atomic(uuid,jsonb,jsonb),private.assert_dispatch_ready(uuid) from public,anon,authenticated;
create or replace function public.refresh_packaging_job_material()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_method text;
  v_rate numeric;
  v_stock numeric;
begin
  if coalesce(new.profile_length_m,0)=0 and new.production_job_id is not null then
    if new.finishing_job_id is not null then
      select coalesce(nullif(new.profile_length_m,0),coalesce(nullif(j.actual_meters,0),coalesce(j.length_per_piece_m,0)*coalesce(nullif(j.actual_pieces,0),j.pieces,0))*coalesce(nullif(new.profile_weight_kg,0),f.output_weight_kg)/nullif(j.actual_quantity_kg,0)),
        coalesce(nullif(new.profile_weight_kg,0),f.output_weight_kg),
        coalesce(nullif(new.pieces,0),round(coalesce(nullif(j.actual_pieces,0),j.pieces,0)*coalesce(nullif(new.profile_weight_kg,0),f.output_weight_kg)/nullif(j.actual_quantity_kg,0))::integer)
      into new.profile_length_m,new.profile_weight_kg,new.pieces from public.production_jobs j
      join public.finishing_jobs f on f.id=new.finishing_job_id and f.company_id=j.company_id and f.production_job_id=j.id
      where j.id=new.production_job_id and j.company_id=new.company_id;
      if not found then raise exception 'Accepted finishing receipt is unavailable for packaging'; end if;
    else
      select coalesce(length_per_piece_m,0)*coalesce(pieces,0),coalesce(actual_quantity_kg,planned_quantity_kg,0),coalesce(pieces,0)
      into new.profile_length_m,new.profile_weight_kg,new.pieces from public.production_jobs
      where id=new.production_job_id and company_id=new.company_id;
    end if;
  end if;
  -- Later schemas issue multiple materials through their own movement trigger.
  if not (to_jsonb(new) ? 'material_id') then return new; end if;

  if new.material_id is null then
    new.material_quantity_required := 0;
    return new;
  end if;

  select calculation_method, consumption_rate, current_stock
  into v_method, v_rate, v_stock
  from public.packaging_materials
  where id = new.material_id and company_id = new.company_id and is_active = true;

  if not found then
    raise exception 'Active packaging material not found for this company' using errcode = '23503';
  end if;

  new.material_quantity_required := round((case v_method
    when 'per_piece' then coalesce(new.pieces, 0) * v_rate
    when 'per_kg' then coalesce(new.profile_weight_kg, 0) * v_rate
    when 'fixed' then v_rate
    else coalesce(new.profile_length_m, 0) * v_rate
  end)::numeric, 3);

  if tg_op = 'INSERT' and new.status <> 'cancelled' and v_stock < new.material_quantity_required then
    raise exception 'Not enough packaging material stock' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.refresh_packaging_job_material() from public,anon,authenticated;

-- The deferred check runs for two different row types; resolve their keys separately.
create or replace function public.validate_completed_packaging_materials()
returns trigger language plpgsql set search_path = public as $$
declare v_job_id uuid;v_status text;
begin
  if tg_table_name='packaging_jobs' then
    v_job_id:=new.id;
  elsif tg_op='DELETE' then
    v_job_id:=old.job_id;
  else
    v_job_id:=new.job_id;
  end if;
  select status into v_status from public.packaging_jobs where id=v_job_id;
  if v_status='completed' and not exists(select 1 from public.packaging_job_materials
    where job_id=v_job_id and quantity_required>0) then
    raise exception 'Completed packaging requires at least one issued material' using errcode='23514';
  end if;
  return coalesce(new,old);
end;
$$;
revoke all on function public.validate_completed_packaging_materials() from public,anon,authenticated;
commit;

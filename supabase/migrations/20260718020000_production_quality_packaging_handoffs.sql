begin;
alter table public.production_jobs
  add column if not exists actual_pieces integer not null default 0;

do $$
begin
  if exists (
    select 1
    from public.packaging_jobs
    where production_job_id is not null
      and status <> 'cancelled'
    group by company_id, production_job_id
    having count(*) > 1
  ) then
    raise exception 'Resolve duplicate active packaging jobs before applying packaging source uniqueness';
  end if;
end;
$$;

create unique index if not exists packaging_jobs_one_active_production_source_idx
  on public.packaging_jobs(company_id, production_job_id)
  where production_job_id is not null and status <> 'cancelled';

-- Keep operational stage changes monotonic and write history only when the
-- derived order stage actually changes.
create or replace function private.advance_order_stage(
  p_company_id uuid,
  p_order_id uuid,
  p_stage text,
  p_remarks text
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_current_stage text;
  v_stages constant text[] := array[
    'order_confirmed','die_ready','billet_ready','billet_heating','extrusion_planned',
    'extruded','stretching','cutting','aging','surface_treatment','finishing','packing',
    'dispatched','delivered','payment_pending','closed'
  ];
begin
  select current_stage
  into v_current_stage
  from public.orders
  where id = p_order_id and company_id = p_company_id
  for update;

  if not found or v_current_stage in ('cancelled','closed') then
    return;
  end if;
  if array_position(v_stages, p_stage) is null then
    raise exception 'Unsupported derived order stage: %', p_stage;
  end if;
  if coalesce(array_position(v_stages, v_current_stage), 0) >= array_position(v_stages, p_stage) then
    return;
  end if;

  update public.orders
  set current_stage = p_stage, updated_at = now()
  where id = p_order_id and company_id = p_company_id;

  insert into public.order_stage_history(company_id, order_id, stage, changed_by, remarks)
  values (p_company_id, p_order_id, p_stage, auth.uid(), p_remarks);
end;
$$;

revoke all on function private.advance_order_stage(uuid, uuid, text, text) from public, anon, authenticated;

-- The multi-material migration removed packaging_jobs.material_id. Redefine
-- the production completion handoff so it creates a queue header only.
create or replace function public.link_billets_to_production_job()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.status = 'completed'
     and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    if coalesce(new.actual_quantity_kg, 0) <= 0 then
      raise exception 'Capture actual production output before completing the job'
        using errcode = '23514';
    end if;

    update public.foundry_billets
    set status = 'consumed', updated_at = now()
    where company_id = new.company_id
      and production_job_id = new.id
      and status in ('allocated','issued');

    insert into public.packaging_jobs(
      company_id, packaging_number, order_id, production_job_id,
      scheduled_date, pieces, profile_weight_kg, profile_length_m,
      status, notes, created_by
    )
    select
      new.company_id,
      concat('PKG-', to_char(current_date, 'YYYY'), '-', substring(new.id::text, 1, 8)),
      new.order_id,
      new.id,
      current_date,
      coalesce(nullif(new.actual_pieces, 0), new.pieces, 0),
      new.actual_quantity_kg,
      coalesce(nullif(new.actual_meters, 0), coalesce(new.length_per_piece_m, 0) * coalesce(nullif(new.actual_pieces, 0), new.pieces, 0)),
      'scheduled',
      'Auto-created after production completion. Select and issue packaging materials before completion.',
      auth.uid()
    where not exists (
      select 1
      from public.packaging_jobs existing
      where existing.company_id = new.company_id
        and existing.production_job_id = new.id
    )
    on conflict (company_id, packaging_number) do nothing;

    perform private.advance_order_stage(
      new.company_id,
      new.order_id,
      'extruded',
      concat('Production job ', coalesce(new.job_number, new.id::text), ' completed with ', new.actual_quantity_kg, ' kg actual output.')
    );
  end if;
  return new;
end;
$$;

drop trigger if exists link_billets_to_production_job on public.production_jobs;
create trigger link_billets_to_production_job
after insert or update of order_id, required_billet_count, status, actual_quantity_kg
on public.production_jobs
for each row execute function public.link_billets_to_production_job();

create or replace function public.validate_production_completion()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'completed' and coalesce(new.actual_quantity_kg, 0) <= 0 then
    raise exception 'Actual output must be greater than zero before production can be completed'
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.status = 'completed' and new.status <> 'completed' then
    raise exception 'A completed production job cannot be reopened; create a corrective job instead'
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'A cancelled production job cannot be reopened'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_production_completion on public.production_jobs;
create trigger validate_production_completion
before insert or update of status, actual_quantity_kg
on public.production_jobs
for each row execute function public.validate_production_completion();

-- Every new QC decision must trace to the completed production output it
-- approves. Legacy pending rows remain readable and can be linked on edit.
create or replace function public.validate_quality_production_link()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_job record;
begin
  if new.production_job_id is null then
    if tg_op = 'INSERT' or new.status = 'approved' then
      raise exception 'Select the completed production job inspected by this QC record'
        using errcode = '23514';
    end if;
    return new;
  end if;

  select id, company_id, profile_id, status, actual_quantity_kg
  into v_job
  from public.production_jobs
  where id = new.production_job_id;
  if not found
     or v_job.company_id <> new.company_id
     or v_job.profile_id <> new.profile_id then
    raise exception 'QC production job must belong to the same company and profile'
      using errcode = '23514';
  end if;
  if v_job.status <> 'completed' then
    raise exception 'QC can only inspect a completed production job'
      using errcode = '23514';
  end if;
  if new.status = 'approved' then
    if coalesce(new.quantity_checked_kg, 0) <= 0 then
      raise exception 'Approved QC requires a checked quantity greater than zero'
        using errcode = '23514';
    end if;
    if coalesce(btrim(new.inspector_name), '') = '' then
      raise exception 'Approved QC requires an inspector name'
        using errcode = '23514';
    end if;
    if new.surface_finish_ok is distinct from true then
      raise exception 'QC cannot be approved while surface finish is marked failed'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_quality_production_link on public.quality_inspections;
create trigger validate_quality_production_link
before insert or update of company_id, production_job_id, profile_id, status,
  quantity_checked_kg, inspector_name, surface_finish_ok
on public.quality_inspections
for each row execute function public.validate_quality_production_link();

drop policy if exists "quality_inspections tenant insert" on public.quality_inspections;
drop policy if exists "quality_inspections tenant update" on public.quality_inspections;
drop policy if exists "quality_inspections tenant delete" on public.quality_inspections;
create policy "quality inspections role insert"
on public.quality_inspections for insert
with check (
  company_id = public.get_current_user_company_id()
  and public.get_current_user_role() in ('owner','admin','production_manager','quality')
);
create policy "quality inspections role update"
on public.quality_inspections for update
using (
  company_id = public.get_current_user_company_id()
  and public.get_current_user_role() in ('owner','admin','production_manager','quality')
)
with check (company_id = public.get_current_user_company_id());
create policy "quality inspections admin delete"
on public.quality_inspections for delete
using (
  company_id = public.get_current_user_company_id()
  and public.get_current_user_role() in ('owner','admin')
);

create or replace function public.guard_terminal_packaging_job()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status in ('completed', 'cancelled') then
    raise exception 'Completed or cancelled packaging jobs are immutable; use a reversal record for corrections'
      using errcode = '23514';
  end if;
  if new.status = 'cancelled'
     and new.production_job_id is not null
     and exists (
       select 1
       from public.packing_list_items item
       where item.company_id = new.company_id
         and item.source_line_id = new.production_job_id
     ) then
    raise exception 'Packaging cannot be cancelled after its production output is allocated to a packing list'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_terminal_packaging_job on public.packaging_jobs;
create trigger guard_terminal_packaging_job
before update on public.packaging_jobs
for each row execute function public.guard_terminal_packaging_job();

create or replace function public.guard_terminal_packaging_material()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_status text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select status into v_status
    from public.packaging_jobs
    where id = old.job_id;
    if v_status in ('completed', 'cancelled') then
      raise exception 'Materials on completed or cancelled packaging jobs are immutable'
        using errcode = '23514';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select status into v_status
    from public.packaging_jobs
    where id = new.job_id;
    if v_status in ('completed', 'cancelled') then
      raise exception 'Materials on completed or cancelled packaging jobs are immutable'
        using errcode = '23514';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists guard_terminal_packaging_material on public.packaging_job_materials;
create trigger guard_terminal_packaging_material
before insert or update or delete on public.packaging_job_materials
for each row execute function public.guard_terminal_packaging_material();

create or replace function public.validate_completed_packaging_materials()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_job_id uuid := case when tg_table_name = 'packaging_jobs' then new.id else coalesce(new.job_id, old.job_id) end;
  v_status text;
begin
  select status into v_status from public.packaging_jobs where id = v_job_id;
  if v_status = 'completed' and not exists (
    select 1 from public.packaging_job_materials
    where job_id = v_job_id and quantity_required > 0
  ) then
    raise exception 'Completed packaging requires at least one issued material'
      using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists validate_completed_packaging_job on public.packaging_jobs;
create constraint trigger validate_completed_packaging_job
after insert or update of status on public.packaging_jobs
deferrable initially deferred
for each row execute function public.validate_completed_packaging_materials();

drop trigger if exists validate_completed_packaging_material on public.packaging_job_materials;
create constraint trigger validate_completed_packaging_material
after insert or update or delete on public.packaging_job_materials
deferrable initially deferred
for each row execute function public.validate_completed_packaging_materials();

create or replace function public.sync_packaging_order_stage()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.status = 'completed'
     and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    perform private.advance_order_stage(
      new.company_id,
      new.order_id,
      'packing',
      concat('Packaging job ', coalesce(new.packaging_number, new.id::text), ' completed with issued materials.')
    );
  end if;
  return new;
end;
$$;

drop trigger if exists sync_packaging_order_stage on public.packaging_jobs;
create trigger sync_packaging_order_stage
after insert or update of status on public.packaging_jobs
for each row execute function public.sync_packaging_order_stage();

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
    'packaging_number','order_id','production_job_id','scheduled_date','pieces',
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

create or replace function public.save_packaging_job_atomic(
  p_job_id uuid,
  p_job jsonb,
  p_materials jsonb
)
returns uuid
language sql
security definer
set search_path = public, private
as $$ select private.save_packaging_job_atomic(p_job_id, p_job, p_materials) $$;

revoke all on function private.save_packaging_job_atomic(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.save_packaging_job_atomic(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_packaging_job_atomic(uuid, jsonb, jsonb) to authenticated;

commit;

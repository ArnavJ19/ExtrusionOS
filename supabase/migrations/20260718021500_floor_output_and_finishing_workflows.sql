begin;

alter table public.finishing_jobs
  add column if not exists retry_of_finishing_job_id uuid
    references public.finishing_jobs(id) on delete restrict;

create unique index if not exists finishing_jobs_one_retry_per_rejection_idx
  on public.finishing_jobs(company_id, retry_of_finishing_job_id)
  where retry_of_finishing_job_id is not null;
create index if not exists finishing_jobs_retry_source_idx
  on public.finishing_jobs(company_id, retry_of_finishing_job_id, status);

create table if not exists public.finishing_status_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  finishing_job_id uuid not null references public.finishing_jobs(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by uuid references auth.users(id),
  remarks text,
  created_at timestamptz not null default now()
);

create index if not exists finishing_status_history_job_idx
  on public.finishing_status_history(company_id, finishing_job_id, created_at desc);

alter table public.finishing_status_history enable row level security;
drop policy if exists "finishing status history tenant read" on public.finishing_status_history;
create policy "finishing status history tenant read"
on public.finishing_status_history for select
using (company_id = public.get_current_user_company_id());

create or replace function public.validate_production_completion()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.status not in ('planned', 'ready') then
    raise exception 'New production jobs must start as planned or ready'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    if old.status = 'planned' and new.status not in ('ready', 'on_hold', 'cancelled') then
      raise exception 'Planned production can only move to ready, on hold, or cancelled'
        using errcode = '23514';
    elsif old.status = 'ready' and new.status not in ('in_progress', 'on_hold', 'cancelled') then
      raise exception 'Ready production can only start, go on hold, or be cancelled'
        using errcode = '23514';
    elsif old.status = 'in_progress' and new.status not in ('on_hold', 'completed', 'cancelled') then
      raise exception 'Running production can only go on hold, complete, or be cancelled'
        using errcode = '23514';
    elsif old.status = 'on_hold' and new.status not in ('ready', 'in_progress', 'cancelled') then
      raise exception 'On-hold production can only return to ready/running or be cancelled'
        using errcode = '23514';
    elsif old.status in ('completed', 'cancelled') then
      raise exception 'Completed or cancelled production cannot be reopened'
        using errcode = '23514';
    end if;
  end if;

  if new.status = 'completed' then
    if coalesce(new.actual_quantity_kg, 0) <= 0 then
      raise exception 'Actual output must be greater than zero before production can be completed'
        using errcode = '23514';
    end if;
    if coalesce(new.pieces, 0) > 0 and coalesce(new.actual_pieces, 0) <= 0 then
      raise exception 'Capture actual pieces before completing this production job'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.complete_production_job_atomic(
  p_job_id uuid,
  p_actual_weight_kg numeric,
  p_actual_pieces integer,
  p_actual_meters numeric,
  p_scrap_weight_kg numeric,
  p_remarks text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_job record;
  v_actual_meters numeric;
  v_linked_billet_count integer := 0;
  v_input_weight_kg numeric := 0;
  v_existing_scrap_kg numeric := 0;
  v_accounted_weight_kg numeric := 0;
  v_tolerance_kg numeric := 0;
  v_has_allocation_requirement boolean := false;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if private.get_current_user_role() not in (
    'owner', 'admin', 'factory_manager', 'production_manager', 'production'
  ) then
    raise exception 'Permission denied for production completion' using errcode = '42501';
  end if;

  select id, company_id, order_id, profile_id, die_id, status, pieces,
    length_per_piece_m, job_number, required_billet_count
  into v_job
  from public.production_jobs
  where id = p_job_id and company_id = v_company_id
  for update;
  if not found then
    raise exception 'Production job not found for this company';
  end if;
  if v_job.status <> 'in_progress' then
    raise exception 'Start the production job before recording final output';
  end if;
  if coalesce(p_actual_weight_kg, 0) <= 0 then
    raise exception 'Actual output weight must be greater than zero';
  end if;
  if coalesce(p_actual_pieces, 0) < 0 then
    raise exception 'Actual pieces cannot be negative';
  end if;
  if coalesce(v_job.pieces, 0) > 0 and coalesce(p_actual_pieces, 0) <= 0 then
    raise exception 'Actual pieces are required for a piece-planned production job';
  end if;
  if coalesce(p_scrap_weight_kg, 0) < 0 then
    raise exception 'Scrap weight cannot be negative';
  end if;

  perform 1
  from public.foundry_billets
  where company_id = v_company_id
    and production_job_id = p_job_id
    and status in ('allocated', 'issued', 'consumed')
  for update;

  select count(*), coalesce(sum(weight_kg), 0)
  into v_linked_billet_count, v_input_weight_kg
  from public.foundry_billets
  where company_id = v_company_id
    and production_job_id = p_job_id
    and status in ('allocated', 'issued', 'consumed');

  select exists (
    select 1
    from public.order_billet_requirements requirement
    where requirement.company_id = v_company_id
      and requirement.order_id = v_job.order_id
      and requirement.profile_id = v_job.profile_id
      and requirement.billets_required > 0
      and requirement.status <> 'cancelled'
  ) into v_has_allocation_requirement;

  if v_linked_billet_count = 0 then
    if coalesce(v_job.required_billet_count, 0) > 0 or v_has_allocation_requirement then
      raise exception 'Allocate the required billets to this production job before completion'
        using errcode = '23514';
    end if;
  else
    if exists (
      select 1
      from public.scrap_records
      where company_id = v_company_id
        and production_job_id = p_job_id
        and weight_kg < 0
    ) then
      raise exception 'Production scrap records cannot contain negative weight'
        using errcode = '23514';
    end if;
    select coalesce(sum(weight_kg), 0)
    into v_existing_scrap_kg
    from public.scrap_records
    where company_id = v_company_id
      and production_job_id = p_job_id;

    v_accounted_weight_kg := round((
      p_actual_weight_kg + v_existing_scrap_kg + coalesce(p_scrap_weight_kg, 0)
    )::numeric, 3);
    v_tolerance_kg := greatest(0.5, round((v_input_weight_kg * 0.01)::numeric, 3));

    if abs(v_input_weight_kg - v_accounted_weight_kg) > v_tolerance_kg then
      raise exception 'Billet mass balance failed: linked input % kg, accounted output and scrap % kg, tolerance % kg',
        v_input_weight_kg, v_accounted_weight_kg, v_tolerance_kg
        using errcode = '23514';
    end if;
  end if;

  v_actual_meters := coalesce(
    p_actual_meters,
    case
      when coalesce(p_actual_pieces, 0) > 0 and coalesce(v_job.length_per_piece_m, 0) > 0
        then p_actual_pieces * v_job.length_per_piece_m
      else 0
    end
  );
  if v_actual_meters < 0 then
    raise exception 'Actual metres cannot be negative';
  end if;

  update public.production_jobs
  set actual_quantity_kg = p_actual_weight_kg,
      actual_pieces = coalesce(p_actual_pieces, 0),
      actual_meters = v_actual_meters,
      status = 'completed',
      remarks = case
        when coalesce(btrim(p_remarks), '') = '' then remarks
        when coalesce(btrim(remarks), '') = '' then btrim(p_remarks)
        else concat(remarks, E'\nCompletion: ', btrim(p_remarks))
      end,
      updated_at = now()
  where id = p_job_id and company_id = v_company_id;

  if coalesce(p_scrap_weight_kg, 0) > 0 then
    insert into public.scrap_records(
      company_id, order_id, production_job_id, profile_id, die_id,
      scrap_type, weight_kg, reason, recorded_date, recorded_by, notes
    ) values (
      v_company_id, v_job.order_id, v_job.id, v_job.profile_id, v_job.die_id,
      'process_scrap', p_scrap_weight_kg, 'Production completion loss',
      current_date, auth.uid(),
      concat('Recorded while completing ', coalesce(v_job.job_number, v_job.id::text))
    );
  end if;

  return p_job_id;
end;
$$;

create or replace function public.complete_production_job_atomic(
  p_job_id uuid,
  p_actual_weight_kg numeric,
  p_actual_pieces integer,
  p_actual_meters numeric default null,
  p_scrap_weight_kg numeric default 0,
  p_remarks text default null
)
returns uuid
language sql
security definer
set search_path = public, private
as $$
  select private.complete_production_job_atomic(
    p_job_id, p_actual_weight_kg, p_actual_pieces,
    p_actual_meters, p_scrap_weight_kg, p_remarks
  )
$$;

revoke all on function private.complete_production_job_atomic(uuid, numeric, integer, numeric, numeric, text)
  from public, anon, authenticated;
revoke all on function public.complete_production_job_atomic(uuid, numeric, integer, numeric, numeric, text)
  from public, anon;
grant execute on function public.complete_production_job_atomic(uuid, numeric, integer, numeric, numeric, text)
  to authenticated;

create or replace function public.validate_finishing_transition()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_retry_source record;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'planned' then
      raise exception 'New finishing jobs must start as planned' using errcode = '23514';
    end if;
  end if;

  if new.retry_of_finishing_job_id is not null then
    select id, company_id, order_id, production_job_id, finishing_type,
      status, input_weight_kg, output_weight_kg, rejection_weight_kg
    into v_retry_source
    from public.finishing_jobs
    where id = new.retry_of_finishing_job_id;
    if not found
       or v_retry_source.company_id <> new.company_id
       or v_retry_source.order_id <> new.order_id
       or v_retry_source.production_job_id is distinct from new.production_job_id
       or v_retry_source.finishing_type <> new.finishing_type
       or v_retry_source.status <> 'rejected' then
      raise exception 'Finishing retry must reference a rejected job for the same company and source'
        using errcode = '23514';
    end if;
    if coalesce(new.input_weight_kg, 0) <= 0
       or abs(new.input_weight_kg - least(
         coalesce(v_retry_source.rejection_weight_kg, 0),
         greatest(
           coalesce(v_retry_source.input_weight_kg, 0)
             - coalesce(v_retry_source.output_weight_kg, 0),
           0
         )
       )) > 0.01 then
      raise exception 'Finishing retry input must equal recoverable rejected weight'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'INSERT' then return new; end if;

  if old.company_id is distinct from new.company_id
     or old.order_id is distinct from new.order_id
     or old.production_job_id is distinct from new.production_job_id
     or old.finishing_type is distinct from new.finishing_type
     or old.retry_of_finishing_job_id is distinct from new.retry_of_finishing_job_id then
    raise exception 'Finishing source and route cannot be changed after creation'
      using errcode = '23514';
  end if;

  if old.status = 'rejected'
     and (
       old.input_weight_kg is distinct from new.input_weight_kg
       or old.output_weight_kg is distinct from new.output_weight_kg
       or old.rejection_weight_kg is distinct from new.rejection_weight_kg
       or old.remarks is distinct from new.remarks
     ) then
    raise exception 'Rejected finishing evidence is immutable; record a new finishing job for corrections'
      using errcode = '23514';
  end if;

  if old.status is distinct from new.status then
    if old.status = 'planned' and new.status not in ('sent_to_vendor', 'in_process', 'rejected') then
      raise exception 'Planned finishing can only be sent, started in-house, or rejected'
        using errcode = '23514';
    elsif old.status = 'sent_to_vendor' and new.status not in ('in_process', 'received', 'rejected') then
      raise exception 'Sent finishing can only move in process, received, or rejected'
        using errcode = '23514';
    elsif old.status = 'in_process' and new.status not in ('received', 'completed', 'rejected') then
      raise exception 'Finishing in process can only be received, completed, or rejected'
        using errcode = '23514';
    elsif old.status = 'received' and new.status not in ('completed', 'rejected') then
      raise exception 'Received finishing can only be completed or rejected'
        using errcode = '23514';
    elsif old.status in ('completed', 'rejected', 'not_required') then
      raise exception 'Terminal finishing jobs cannot be reopened'
        using errcode = '23514';
    end if;
  end if;

  if new.status = 'sent_to_vendor' then
    if new.vendor_id is null then
      raise exception 'Select a finishing vendor before recording dispatch to vendor'
        using errcode = '23514';
    end if;
    if new.sent_date is null then
      raise exception 'Record the date material was sent to the finishing vendor'
        using errcode = '23514';
    end if;
  end if;
  if new.status in ('received', 'completed') and new.received_date is null then
    raise exception 'Record the finishing receipt date before this transition'
      using errcode = '23514';
  end if;
  if new.status = 'rejected' then
    if coalesce(new.rejection_weight_kg, 0) <= 0 then
      raise exception 'Rejected finishing requires a positive rejection weight'
        using errcode = '23514';
    end if;
    if coalesce(new.input_weight_kg, 0) <= 0
       or coalesce(new.output_weight_kg, 0) < 0
       or new.rejection_weight_kg
          > greatest(new.input_weight_kg - coalesce(new.output_weight_kg, 0), 0) + 0.01 then
      raise exception 'Finishing rejection cannot exceed input weight remaining after accepted output'
        using errcode = '23514';
    end if;
    if coalesce(btrim(new.remarks), '') = '' then
      raise exception 'Rejected finishing requires remarks explaining the disposition'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_finishing_transition on public.finishing_jobs;
create trigger validate_finishing_transition
before insert or update of company_id, order_id, production_job_id, finishing_type,
  retry_of_finishing_job_id, status, vendor_id, sent_date, received_date,
  input_weight_kg, output_weight_kg, rejection_weight_kg, remarks
on public.finishing_jobs
for each row execute function public.validate_finishing_transition();

create or replace function public.log_finishing_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status then
    insert into public.finishing_status_history(
      company_id, finishing_job_id, from_status, to_status, changed_by, remarks
    ) values (
      new.company_id, new.id, old.status, new.status, auth.uid(), new.remarks
    );
  end if;
  return new;
end;
$$;

drop trigger if exists log_finishing_status_change on public.finishing_jobs;
create trigger log_finishing_status_change
after update of status on public.finishing_jobs
for each row execute function public.log_finishing_status_change();

create or replace function private.transition_finishing_job_atomic(
  p_job_id uuid,
  p_status text,
  p_vendor_id uuid,
  p_sent_date date,
  p_received_date date,
  p_output_weight_kg numeric,
  p_rejection_weight_kg numeric,
  p_remarks text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_job public.finishing_jobs%rowtype;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if private.get_current_user_role() not in (
    'owner', 'admin', 'factory_manager', 'production_manager', 'production'
  ) then
    raise exception 'Permission denied for finishing updates' using errcode = '42501';
  end if;
  if p_status not in (
    'planned', 'sent_to_vendor', 'in_process', 'received', 'rejected', 'completed'
  ) then
    raise exception 'Unsupported finishing status';
  end if;

  select *
  into v_job
  from public.finishing_jobs
  where id = p_job_id and company_id = v_company_id
  for update;
  if not found then
    raise exception 'Finishing job not found for this company';
  end if;

  if p_vendor_id is not null and not exists (
    select 1 from public.vendors
    where id = p_vendor_id and company_id = v_company_id
  ) then
    raise exception 'Selected vendor is not available for this company';
  end if;

  update public.finishing_jobs
  set status = p_status,
      vendor_id = coalesce(p_vendor_id, v_job.vendor_id),
      sent_date = case
        when p_status = 'sent_to_vendor' then coalesce(p_sent_date, current_date)
        else coalesce(p_sent_date, v_job.sent_date)
      end,
      received_date = case
        when p_status in ('received', 'completed') then coalesce(p_received_date, current_date)
        else coalesce(p_received_date, v_job.received_date)
      end,
      output_weight_kg = coalesce(p_output_weight_kg, v_job.output_weight_kg),
      rejection_weight_kg = coalesce(p_rejection_weight_kg, v_job.rejection_weight_kg),
      remarks = case
        when p_remarks is null then v_job.remarks
        else nullif(btrim(p_remarks), '')
      end,
      updated_at = now()
  where id = p_job_id and company_id = v_company_id;

  return p_job_id;
end;
$$;

create or replace function public.transition_finishing_job_atomic(
  p_job_id uuid,
  p_status text,
  p_vendor_id uuid default null,
  p_sent_date date default null,
  p_received_date date default null,
  p_output_weight_kg numeric default null,
  p_rejection_weight_kg numeric default null,
  p_remarks text default null
)
returns uuid
language sql
security definer
set search_path = public, private
as $$
  select private.transition_finishing_job_atomic(
    p_job_id, p_status, p_vendor_id, p_sent_date, p_received_date,
    p_output_weight_kg, p_rejection_weight_kg, p_remarks
  )
$$;

revoke all on function private.transition_finishing_job_atomic(uuid, text, uuid, date, date, numeric, numeric, text)
  from public, anon, authenticated;
revoke all on function public.transition_finishing_job_atomic(uuid, text, uuid, date, date, numeric, numeric, text)
  from public, anon;
grant execute on function public.transition_finishing_job_atomic(uuid, text, uuid, date, date, numeric, numeric, text)
  to authenticated;

create or replace function private.retry_rejected_finishing_job_atomic(
  p_rejected_job_id uuid,
  p_planned_date date,
  p_remarks text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_source public.finishing_jobs%rowtype;
  v_retry_id uuid;
  v_recoverable_weight_kg numeric;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if private.get_current_user_role() not in (
    'owner', 'admin', 'factory_manager', 'production_manager', 'production'
  ) then
    raise exception 'Permission denied for finishing retry' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('finishing-retry:' || p_rejected_job_id::text, 0)
  );
  select * into v_source
  from public.finishing_jobs
  where id = p_rejected_job_id and company_id = v_company_id
  for update;
  if not found then
    raise exception 'Rejected finishing job not found for this company';
  end if;
  if v_source.status <> 'rejected' then
    raise exception 'Only a rejected finishing job can create a retry'
      using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.finishing_jobs retry
    where retry.company_id = v_company_id
      and retry.retry_of_finishing_job_id = v_source.id
  ) then
    raise exception 'A retry already exists for this rejected finishing job'
      using errcode = '23505';
  end if;

  v_recoverable_weight_kg := least(
    coalesce(v_source.rejection_weight_kg, 0),
    greatest(
      coalesce(v_source.input_weight_kg, 0) - coalesce(v_source.output_weight_kg, 0),
      0
    )
  );
  if v_recoverable_weight_kg <= 0 then
    raise exception 'Rejected finishing job has no recoverable input weight'
      using errcode = '23514';
  end if;

  insert into public.finishing_jobs(
    company_id, order_id, production_job_id, finishing_type,
    color_code, shade_name, planned_date, input_weight_kg,
    output_weight_kg, rejection_weight_kg, status, remarks,
    retry_of_finishing_job_id
  ) values (
    v_company_id, v_source.order_id, v_source.production_job_id, v_source.finishing_type,
    v_source.color_code, v_source.shade_name, coalesce(p_planned_date, current_date),
    v_recoverable_weight_kg, 0, 0, 'planned',
    concat(
      'Retry of rejected finishing job ', v_source.id::text, '.',
      case
        when nullif(btrim(coalesce(p_remarks, '')), '') is null then ''
        else concat(' ', btrim(p_remarks))
      end
    ),
    v_source.id
  )
  returning id into v_retry_id;

  insert into public.finishing_status_history(
    company_id, finishing_job_id, from_status, to_status, changed_by, remarks
  ) values (
    v_company_id, v_retry_id, 'rejected', 'planned', auth.uid(),
    concat('Retry created from rejected finishing job ', v_source.id::text, '.')
  );

  return v_retry_id;
end;
$$;

create or replace function public.retry_rejected_finishing_job_atomic(
  p_rejected_job_id uuid,
  p_planned_date date default null,
  p_remarks text default null
)
returns uuid
language sql
security definer
set search_path = public, private
as $$
  select private.retry_rejected_finishing_job_atomic(
    p_rejected_job_id, p_planned_date, p_remarks
  )
$$;

revoke all on function private.retry_rejected_finishing_job_atomic(uuid, date, text)
  from public, anon, authenticated;
revoke all on function public.retry_rejected_finishing_job_atomic(uuid, date, text)
  from public, anon;
grant execute on function public.retry_rejected_finishing_job_atomic(uuid, date, text)
  to authenticated;

drop policy if exists "finishing_jobs tenant insert" on public.finishing_jobs;
drop policy if exists "finishing_jobs tenant update" on public.finishing_jobs;
drop policy if exists "finishing jobs role insert" on public.finishing_jobs;
drop policy if exists "finishing jobs role update" on public.finishing_jobs;
create policy "finishing jobs role insert"
on public.finishing_jobs for insert
with check (
  company_id = public.get_current_user_company_id()
  and public.get_current_user_role() in (
    'owner', 'admin', 'factory_manager', 'production_manager', 'production'
  )
);
create policy "finishing jobs role update"
on public.finishing_jobs for update
using (
  company_id = public.get_current_user_company_id()
  and public.get_current_user_role() in (
    'owner', 'admin', 'factory_manager', 'production_manager', 'production'
  )
)
with check (company_id = public.get_current_user_company_id());

commit;

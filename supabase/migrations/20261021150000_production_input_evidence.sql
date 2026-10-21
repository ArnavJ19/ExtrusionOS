-- EXOS-AUD-014: a production job with no linked billets and no billet
-- requirement could be completed with any output weight, and the completion
-- trigger then created packaging (finished goods) from it.
--
-- Completion now needs input evidence: linked billets (mass balance as before),
-- or an "input not tracked" exception recorded by a manager with a reason
-- (public.record_production_input_exception). Exceptions live in
-- public.production_input_exceptions, which clients can read but not write, so
-- exception jobs can be reported separately in recovery.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.production_input_exceptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  production_job_id uuid not null references public.production_jobs(id) on delete cascade,
  reason text not null check (length(btrim(reason)) >= 10),
  input_source text not null default 'not_tracked' check (input_source in ('not_tracked','customer_supplied','external_billets')),
  recorded_by uuid not null references auth.users(id),
  recorded_by_role text not null,
  recorded_at timestamptz not null default now(),
  unique (company_id, production_job_id)
);
create index if not exists production_input_exceptions_company_job_idx on public.production_input_exceptions(company_id, production_job_id);
alter table public.production_input_exceptions enable row level security;
drop policy if exists "production input exceptions tenant read" on public.production_input_exceptions;
create policy "production input exceptions tenant read" on public.production_input_exceptions
  for select using (company_id = public.get_current_user_company_id());
revoke all on public.production_input_exceptions from public, anon, authenticated;
grant select on public.production_input_exceptions to authenticated;

create or replace function private.record_production_input_exception(p_job_id uuid, p_reason text, p_input_source text default 'not_tracked')
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_status text;
  v_id uuid;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if v_role not in ('owner','admin','factory_manager','production_manager') then
    raise exception 'Only an owner, admin, factory manager or production manager can record a production input exception' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Give an input exception reason of at least 10 characters' using errcode = '23514';
  end if;
  if coalesce(p_input_source, 'not_tracked') not in ('not_tracked','customer_supplied','external_billets') then
    raise exception 'Unknown input source %', p_input_source using errcode = '23514';
  end if;
  select status into v_status from public.production_jobs where id = p_job_id and company_id = v_company_id for update;
  if not found then raise exception 'Production job not found for this company' using errcode = '23514'; end if;
  if v_status in ('completed','cancelled') then
    raise exception 'An input exception can only be recorded before the job is completed' using errcode = '23514';
  end if;
  if exists (select 1 from public.foundry_billets b where b.company_id = v_company_id and b.production_job_id = p_job_id
      and b.status in ('allocated','issued','consumed')) then
    raise exception 'This job already has linked billets; complete it against them' using errcode = '23514';
  end if;
  insert into public.production_input_exceptions(company_id, production_job_id, reason, input_source, recorded_by, recorded_by_role)
  values (v_company_id, p_job_id, btrim(p_reason), coalesce(p_input_source, 'not_tracked'), auth.uid(), v_role)
  on conflict (company_id, production_job_id) do update
    set reason = excluded.reason, input_source = excluded.input_source, recorded_by = excluded.recorded_by,
        recorded_by_role = excluded.recorded_by_role, recorded_at = now()
  returning id into v_id;
  insert into public.production_job_status_history(company_id, production_job_id, previous_status, new_status, reason, changed_by, changed_by_role)
  values (v_company_id, p_job_id, v_status, v_status, concat('Input exception (', coalesce(p_input_source, 'not_tracked'), '): ', btrim(p_reason)), auth.uid(), v_role);
  return v_id;
end;
$$;
revoke all on function private.record_production_input_exception(uuid, text, text) from public, anon, authenticated;

create or replace function public.record_production_input_exception(p_job_id uuid, p_reason text, p_input_source text default 'not_tracked')
returns uuid
language sql
security definer
set search_path = public, private
as $$ select private.record_production_input_exception(p_job_id, p_reason, p_input_source) $$;
revoke all on function public.record_production_input_exception(uuid, text, text) from public, anon;
grant execute on function public.record_production_input_exception(uuid, text, text) to authenticated;

CREATE OR REPLACE FUNCTION private.complete_production_job_atomic(p_job_id uuid, p_actual_weight_kg numeric, p_actual_pieces integer, p_actual_meters numeric, p_scrap_weight_kg numeric, p_remarks text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
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
    -- EXOS-AUD-014: output without metal input needs an audited manager exception.
    if not exists (select 1 from public.production_input_exceptions exception_record
      where exception_record.company_id = v_company_id and exception_record.production_job_id = p_job_id) then
      raise exception 'Link the billets used by this job, or have a manager record an input exception, before completing it'
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
$function$;

commit;

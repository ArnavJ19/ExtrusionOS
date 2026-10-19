-- R17 local candidate. Not applied.
begin;

create or replace function private.guard_terminal_finishing_evidence()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('completed', 'rejected', 'not_required') then
      raise exception 'Terminal finishing evidence cannot be deleted; retain the original movement and disposition'
        using errcode = '23514';
    end if;
    return old;
  end if;

  if old.status in ('completed', 'rejected', 'not_required')
     and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    raise exception 'Terminal finishing evidence is immutable; retain the original movement and disposition'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_terminal_finishing_evidence() from public, anon, authenticated;

drop trigger if exists guard_terminal_finishing_evidence on public.finishing_jobs;
create trigger guard_terminal_finishing_evidence
before update or delete on public.finishing_jobs
for each row execute function private.guard_terminal_finishing_evidence();

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

  select * into v_job
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
      -- Keep a recorded movement date when a retry or completion omits it.
      sent_date = coalesce(p_sent_date, v_job.sent_date,
        case when p_status = 'sent_to_vendor' then current_date end),
      received_date = coalesce(p_received_date, v_job.received_date,
        case when p_status in ('received', 'completed') then current_date end),
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

revoke all on function private.transition_finishing_job_atomic(uuid, text, uuid, date, date, numeric, numeric, text)
  from public, anon, authenticated;

commit;

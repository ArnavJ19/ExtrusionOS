begin;

create or replace function private.handoff_system_configuration_to_production_atomic(
  p_configuration_id uuid,
  p_jobs jsonb,
  p_remarks text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_configuration public.system_configurations%rowtype;
  v_quote_status text;
  v_order_id uuid;
  v_order_number text;
  v_job_number text;
  v_job jsonb;
  v_profile_id uuid;
  v_die_id uuid;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if v_role not in ('owner', 'admin', 'factory_manager', 'production_manager') then
    raise exception 'Permission denied for production handoff' using errcode = '42501';
  end if;

  select * into v_configuration
  from public.system_configurations
  where id = p_configuration_id and company_id = v_company_id
  for update;
  if not found then
    raise exception 'System configuration not found for this company' using errcode = '23514';
  end if;

  if v_configuration.status = 'in_production'
     and v_configuration.order_id is not null
     and exists (
       select 1 from public.production_jobs job
       where job.company_id = v_company_id
         and job.order_id = v_configuration.order_id
         and job.remarks ilike '%' || coalesce(v_configuration.configuration_number, 'System configuration') || '%'
     ) then
    return v_configuration.order_id;
  end if;
  if v_configuration.customer_id is null then
    raise exception 'Link a customer before creating production jobs' using errcode = '23514';
  end if;
  if v_configuration.status::text not in ('calculated', 'quoted', 'approved', 'converted_to_order') then
    raise exception 'Calculate and approve the configuration before production handoff' using errcode = '23514';
  end if;
  if jsonb_typeof(p_jobs) <> 'array' or jsonb_array_length(p_jobs) = 0 then
    raise exception 'At least one profile cut with positive weight is required for production jobs' using errcode = '23514';
  end if;

  if v_configuration.quote_id is not null then
    select status into v_quote_status
    from public.quotes
    where id = v_configuration.quote_id and company_id = v_company_id
    for update;
    if not found then
      raise exception 'Linked quote is not available for this company' using errcode = '23514';
    end if;
    if v_quote_status not in ('customer_approved', 'converted_to_order') then
      raise exception 'Customer approval is required before this configuration can enter production' using errcode = '23514';
    end if;
  end if;

  v_order_id := v_configuration.order_id;
  if v_order_id is null and v_configuration.quote_id is not null then
    select id into v_order_id
    from public.orders
    where company_id = v_company_id and quote_id = v_configuration.quote_id
    order by created_at
    limit 1
    for update;
  end if;

  if v_order_id is null then
    v_order_number := private.next_business_number_locked(
      'public.orders'::regclass, 'order_number', v_company_id, 'O', (now() at time zone 'Asia/Kolkata')::date
    );
    insert into public.orders (
      company_id, order_number, quote_id, customer_id, order_date, priority,
      current_stage, order_value, notes, created_by
    ) values (
      v_company_id, v_order_number, v_configuration.quote_id,
      v_configuration.customer_id, (now() at time zone 'Asia/Kolkata')::date, 'normal', 'extrusion_planned',
      coalesce(v_configuration.grand_total, 0),
      'Generated from ' || coalesce(p_remarks, 'system configuration'), auth.uid()
    ) returning id into v_order_id;
  else
    perform 1 from public.orders
    where id = v_order_id and company_id = v_company_id
    for update;
    if not found then
      raise exception 'Linked order is not available for this company' using errcode = '23514';
    end if;
  end if;

  if exists (
    select 1 from public.production_jobs job
    where job.company_id = v_company_id
      and job.order_id = v_order_id
      and job.remarks ilike '%' || coalesce(v_configuration.configuration_number, 'System configuration') || '%'
  ) then
    raise exception 'Production handoff already exists for this configuration' using errcode = '23505';
  end if;

  for v_job in select value from jsonb_array_elements(p_jobs)
  loop
    v_profile_id := nullif(v_job ->> 'profile_id', '')::uuid;
    v_die_id := nullif(v_job ->> 'die_id', '')::uuid;
    if v_profile_id is null or v_die_id is null or coalesce((v_job ->> 'planned_quantity_kg')::numeric, 0) <= 0 then
      raise exception 'Every production job requires a profile, usable die, and positive planned weight' using errcode = '23514';
    end if;
    perform 1
    from public.aluminium_profiles profile
    join public.dies die
      on die.id = v_die_id
     and die.company_id = profile.company_id
     and die.profile_id = profile.id
    where profile.id = v_profile_id
      and profile.company_id = v_company_id
      and profile.is_active is distinct from false
      and die.die_status not in ('inactive', 'dead', 'blocked', 'retired', 'scrapped', 'under_maintenance');
    if not found then
      raise exception 'Every system profile needs a usable matching die before production handoff' using errcode = '23514';
    end if;

    v_job_number := private.next_business_number_locked(
      'public.production_jobs'::regclass, 'job_number', v_company_id, 'J', (now() at time zone 'Asia/Kolkata')::date
    );
    insert into public.production_jobs (
      company_id, order_id, job_number, profile_id, die_id,
      planned_quantity_kg, planned_meters, planned_date, status, remarks, created_by
    ) values (
      v_company_id, v_order_id, v_job_number, v_profile_id, v_die_id,
      (v_job ->> 'planned_quantity_kg')::numeric,
      greatest(coalesce((v_job ->> 'planned_meters')::numeric, 0), 0),
      (now() at time zone 'Asia/Kolkata')::date, 'planned', nullif(v_job ->> 'remarks', ''), auth.uid()
    );
  end loop;

  update public.orders
  set current_stage = 'extrusion_planned', updated_at = now()
  where id = v_order_id and company_id = v_company_id;

  insert into public.order_stage_history (company_id, order_id, stage, changed_by, remarks)
  values (
    v_company_id, v_order_id, 'extrusion_planned', auth.uid(),
    'Production jobs created from ' || coalesce(v_configuration.configuration_number, 'system configuration')
  );

  update public.system_configurations
  set order_id = v_order_id, status = 'in_production', updated_at = now()
  where id = p_configuration_id and company_id = v_company_id;

  if v_configuration.quote_id is not null and v_quote_status = 'customer_approved' then
    update public.quotes
    set status = 'converted_to_order', updated_at = now()
    where id = v_configuration.quote_id and company_id = v_company_id;
  end if;

  return v_order_id;
end;
$$;

create or replace function public.handoff_system_configuration_to_production_atomic(
  p_configuration_id uuid,
  p_jobs jsonb,
  p_remarks text
)
returns uuid
language sql
security definer
set search_path = public, private
as $$
  select private.handoff_system_configuration_to_production_atomic(
    p_configuration_id, p_jobs, p_remarks
  )
$$;

revoke all on function private.handoff_system_configuration_to_production_atomic(uuid, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.handoff_system_configuration_to_production_atomic(uuid, jsonb, text)
  from public, anon;
grant execute on function public.handoff_system_configuration_to_production_atomic(uuid, jsonb, text)
  to authenticated;

commit;

begin;
create table public.machine_usage_meters(id uuid primary key,company_id uuid not null references public.companies(id),machine_id uuid not null references public.machines(id),name text not null,counter_modulus numeric(18,3),created_by uuid not null references public.app_users(id),created_at timestamptz not null default now(),check(counter_modulus is null or counter_modulus>0));
create index usage_meters_company_machine_idx on public.machine_usage_meters(company_id,machine_id);
create index usage_meters_actor_idx on public.machine_usage_meters(created_by);
create table public.machine_usage_tariffs(id uuid primary key,company_id uuid not null references public.companies(id),meter_id uuid not null references public.machine_usage_meters(id),effective_from date not null,rate_per_kwh numeric(14,4) not null check(rate_per_kwh>=0),status text not null check(status in ('draft','approved')),created_by uuid not null references public.app_users(id),approved_by uuid references public.app_users(id),approved_at timestamptz,unique(company_id,meter_id,effective_from),check(approved_by is null or approved_by<>created_by));
create index usage_tariff_meter_idx on public.machine_usage_tariffs(meter_id);
create index usage_tariff_author_idx on public.machine_usage_tariffs(created_by);
create index usage_tariff_approver_idx on public.machine_usage_tariffs(approved_by);
create table public.machine_usage_runs(id uuid primary key,company_id uuid not null references public.companies(id),meter_id uuid not null references public.machine_usage_meters(id),operator_id uuid not null references public.app_users(id),tariff_id uuid not null references public.machine_usage_tariffs(id),rate_snapshot numeric(14,4) not null,
  status text not null check(status in ('running','paused','requires_review','closed')),started_at timestamptz not null default now(),stopped_at timestamptz,opening_reading numeric(18,3) not null,closing_reading numeric(18,3),runtime_seconds numeric,downtime_seconds numeric,energy_used numeric(18,3),cost numeric(18,2),review_reason text);
create unique index one_active_meter_run on public.machine_usage_runs(company_id,meter_id) where status<>'closed';
create index usage_runs_actor_idx on public.machine_usage_runs(operator_id);
create index usage_runs_tariff_idx on public.machine_usage_runs(tariff_id);
create table public.machine_usage_events(id uuid primary key,event_sequence bigint generated always as identity,company_id uuid not null references public.companies(id),run_id uuid not null references public.machine_usage_runs(id),command text not null,payload jsonb not null,recorded_by uuid not null references public.app_users(id),recorded_at timestamptz not null default clock_timestamp());
create index usage_events_company_run_idx on public.machine_usage_events(company_id,run_id,recorded_at,id);
create index usage_events_actor_idx on public.machine_usage_events(recorded_by);
alter table public.machine_usage_meters enable row level security;alter table public.machine_usage_tariffs enable row level security;alter table public.machine_usage_runs enable row level security;alter table public.machine_usage_events enable row level security;
revoke all on public.machine_usage_meters,public.machine_usage_tariffs,public.machine_usage_runs,public.machine_usage_events from public,anon,authenticated;
create trigger keep_usage_events before update or delete on public.machine_usage_events for each row execute function private.keep_commercial_history();

create function private.machine_usage_view(p_company uuid,p_run uuid,p_cost boolean) returns jsonb
language sql stable security definer set search_path=public,private as $$
  select jsonb_build_object('id',id,'meter_id',meter_id,'status',status,'operator_id',operator_id,'started_at',started_at,'stopped_at',stopped_at,'opening_reading',opening_reading,'closing_reading',closing_reading,'runtime_seconds',runtime_seconds,'downtime_seconds',downtime_seconds,'energy_used',energy_used,'review_reason',review_reason,'allocation_basis','Machine total; no job allocation',
    'events',coalesce((select jsonb_agg(to_jsonb(e)) from(select id,command,recorded_at as at,coalesce((payload->>'closing_reading')::numeric,(payload->>'opening_reading')::numeric) reading,payload->>'reason' reason from public.machine_usage_events where company_id=p_company and run_id=p_run order by recorded_at desc,id limit 10)e),'[]'::jsonb))||case when p_cost then jsonb_build_object('cost',cost) else '{}'::jsonb end from public.machine_usage_runs where company_id=p_company and id=p_run;
$$;
revoke all on function private.machine_usage_view(uuid,uuid,boolean) from public,anon,authenticated;
create function public.machine_usage_command(p_command text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,private as $$
declare v_company uuid;v_role text;v_cost boolean;v_id uuid;v_meter public.machine_usage_meters%rowtype;v_tariff public.machine_usage_tariffs%rowtype;v_run public.machine_usage_runs%rowtype;v_event public.machine_usage_events%rowtype;
  v_rows jsonb;v_tariffs jsonb;v_page integer:=coalesce((p_payload->>'page')::integer,1);v_reading numeric;v_energy numeric;v_runtime numeric;v_total numeric;v_rollovers integer;v_at timestamptz;
begin
  v_company:=private.commercial_actor(array['owner','admin','production_manager','production','factory_manager','accounts']);v_role:=private.get_current_user_role();v_cost:=v_role in ('owner','admin','production_manager','accounts');
  if p_command is null or p_payload is null or jsonb_typeof(p_payload)<>'object' or v_page<1 or v_page>10000 then raise exception 'Invalid machine usage request'; end if;
  if p_command='machines.list' then
    if v_role not in ('owner','admin','production_manager') or p_payload-array['page']<>'{}' then raise exception 'Machine configuration is not permitted'; end if;
    select coalesce(jsonb_agg(to_jsonb(r)),'[]') into v_rows from(select id,machine_name name from public.machines where company_id=v_company and is_active order by machine_name,id limit 10 offset (v_page-1)*10)r;
    return jsonb_build_object('kind','machines','page',v_page,'items',v_rows);
  end if;
  if p_command='meters.list' then
    if p_payload-array['page']<>'{}' then raise exception 'Invalid meter search'; end if;
    select coalesce(jsonb_agg(to_jsonb(r)),'[]') into v_rows from(select u.id,u.name,u.machine_id,m.machine_name,u.counter_modulus from public.machine_usage_meters u join public.machines m on m.id=u.machine_id and m.company_id=u.company_id where u.company_id=v_company order by u.id limit 10 offset (v_page-1)*10)r;
    if v_cost then select coalesce(jsonb_agg(to_jsonb(r)),'[]') into v_tariffs from(select id,meter_id,effective_from,status,created_by,rate_per_kwh from public.machine_usage_tariffs where company_id=v_company order by effective_from desc,id limit 10 offset (v_page-1)*10)r;end if;
    return jsonb_build_object('kind','meters','page',v_page,'items',v_rows)||case when v_cost then jsonb_build_object('tariffs',v_tariffs) else '{}'::jsonb end;
  end if;
  v_id:=nullif(p_payload->>'id','')::uuid;
  if p_command='meter.create' then
    if v_role not in ('owner','admin','production_manager') or p_payload-array['id','machine_id','name','counter_modulus']<>'{}' or length(trim(coalesce(p_payload->>'name',''))) not between 3 and 80 then raise exception 'Meter configuration is not permitted'; end if;
    perform 1 from public.machines where id=(p_payload->>'machine_id')::uuid and company_id=v_company and is_active for share;if not found then raise exception 'Active machine is unavailable'; end if;
    v_reading:=nullif(p_payload->>'counter_modulus','')::numeric;
    if v_reading is not null and (v_reading<=0 or v_reading>1000000000 or v_reading::text in ('NaN','Infinity','-Infinity')) then raise exception 'Counter modulus must be a finite positive reading'; end if;
    insert into public.machine_usage_meters(id,company_id,machine_id,name,counter_modulus,created_by) values(v_id,v_company,(p_payload->>'machine_id')::uuid,trim(p_payload->>'name'),v_reading,auth.uid());
    return jsonb_build_object('kind','saved','id',v_id);
  elsif p_command='tariff.create' then
    if not v_cost or p_payload-array['id','meter_id','effective_from','rate_per_kwh']<>'{}' then raise exception 'Tariff authoring is not permitted'; end if;
    perform 1 from public.machine_usage_meters where id=(p_payload->>'meter_id')::uuid and company_id=v_company for share;if not found then raise exception 'Meter is unavailable'; end if;
    v_reading:=(p_payload->>'rate_per_kwh')::numeric;
    if v_reading is null or v_reading<0 or v_reading>1000000 or v_reading::text in ('NaN','Infinity','-Infinity') then raise exception 'Tariff must be finite and non-negative'; end if;
    insert into public.machine_usage_tariffs(id,company_id,meter_id,effective_from,rate_per_kwh,status,created_by) values(v_id,v_company,(p_payload->>'meter_id')::uuid,(p_payload->>'effective_from')::date,v_reading,'draft',auth.uid());
    return jsonb_build_object('kind','saved','id',v_id);
  elsif p_command='tariff.approve' then
    if not v_cost or p_payload-array['id']<>'{}' then raise exception 'Tariff approval is not permitted'; end if;
    select * into v_tariff from public.machine_usage_tariffs where id=v_id and company_id=v_company for update;
    if not found or v_tariff.created_by=auth.uid() then raise exception 'Another authorized reviewer must approve this tariff'; end if;
    update public.machine_usage_tariffs set status='approved',approved_by=auth.uid(),approved_at=now() where id=v_id and status='draft';return jsonb_build_object('kind','saved','id',v_id);
  elsif p_command='usage.load' then
    if p_payload-array['meter_id']<>'{}' then raise exception 'Invalid meter state request'; end if;
    perform 1 from public.machine_usage_meters where id=(p_payload->>'meter_id')::uuid and company_id=v_company;if not found then raise exception 'Meter is unavailable'; end if;
    select * into v_run from public.machine_usage_runs where company_id=v_company and meter_id=(p_payload->>'meter_id')::uuid order by started_at desc,id limit 1;
    return jsonb_build_object('kind','state','run',case when v_run.id is not null then private.machine_usage_view(v_company,v_run.id,v_cost) else null end);
  end if;
  if p_command not in ('usage.start','usage.pause','usage.resume','usage.stop','usage.resolve') then raise exception 'Invalid usage event'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_company::text||v_id::text,0));
  select * into v_event from public.machine_usage_events where id=v_id;
  if found then
    if v_event.company_id<>v_company or v_event.command<>p_command or v_event.payload<>p_payload then raise exception 'Event identity has different observations'; end if;
    return jsonb_build_object('kind','state','run',private.machine_usage_view(v_company,v_event.run_id,v_cost));
  end if;
  if p_command='usage.start' then
    if v_role='accounts' or p_payload-array['id','meter_id','opening_reading']<>'{}' then raise exception 'Usage recording is not permitted'; end if;
    select * into v_meter from public.machine_usage_meters where id=(p_payload->>'meter_id')::uuid and company_id=v_company for update;if not found then raise exception 'Meter is unavailable'; end if;
    perform 1 from public.machines where id=v_meter.machine_id and company_id=v_company and is_active and coalesce(status,'active')='active';if not found then raise exception 'Machine is unavailable'; end if;
    select * into v_tariff from public.machine_usage_tariffs where company_id=v_company and meter_id=v_meter.id and status='approved' and effective_from<=(now() at time zone 'Asia/Kolkata')::date order by effective_from desc,id limit 1 for share;
    if not found then raise exception 'An approved applicable tariff is required'; end if;
    v_reading:=(p_payload->>'opening_reading')::numeric;
    if v_reading is null or v_reading<0 or v_reading>1000000000 or v_reading::text in ('NaN','Infinity','-Infinity') or (v_meter.counter_modulus is not null and v_reading>=v_meter.counter_modulus) then raise exception 'Opening reading is invalid'; end if;
    v_at:=clock_timestamp();
    insert into public.machine_usage_runs(id,company_id,meter_id,operator_id,tariff_id,rate_snapshot,status,opening_reading,started_at) values(v_id,v_company,v_meter.id,auth.uid(),v_tariff.id,v_tariff.rate_per_kwh,'running',v_reading,v_at) returning * into v_run;
  else
    select * into v_run from public.machine_usage_runs where id=(p_payload->>'run_id')::uuid and company_id=v_company for update;if not found then raise exception 'Usage run is unavailable'; end if;
    v_at:=clock_timestamp();
    select * into v_meter from public.machine_usage_meters where id=v_run.meter_id and company_id=v_company for share;
    if p_command='usage.resolve' then
      if not v_cost or v_run.operator_id=auth.uid() or v_run.status<>'requires_review' or p_payload-array['id','run_id','closing_reading','rollovers','reason']<>'{}' or length(trim(coalesce(p_payload->>'reason',''))) not between 8 and 1000 then raise exception 'Independent meter resolution is required'; end if;
    elsif v_run.operator_id<>auth.uid() or v_role='accounts' then raise exception 'Only the identified operator records this run'; end if;
    if p_command='usage.pause' then
      if p_payload-array['id','run_id']<>'{}' or v_run.status<>'running' then raise exception 'Only a running interval can pause'; end if;
      update public.machine_usage_runs set status='paused' where id=v_run.id;
    elsif p_command='usage.resume' then
      if p_payload-array['id','run_id']<>'{}' or v_run.status<>'paused' then raise exception 'Only a paused interval can resume'; end if;
      update public.machine_usage_runs set status='running' where id=v_run.id;
    else
      if p_command='usage.stop' and (p_payload-array['id','run_id','closing_reading']<>'{}' or v_run.status not in ('running','paused')) then raise exception 'Only an active interval can stop'; end if;
      v_reading:=(p_payload->>'closing_reading')::numeric;
      if v_reading is null or v_reading<0 or v_reading>1000000000 or v_reading::text in ('NaN','Infinity','-Infinity') or (v_meter.counter_modulus is not null and v_reading>=v_meter.counter_modulus) then raise exception 'Closing reading is invalid'; end if;
      v_rollovers:=case when p_command='usage.resolve' then (p_payload->>'rollovers')::integer else 0 end;
      if v_rollovers is null or v_rollovers not in (0,1) then raise exception 'Resolve at most one verified rollover'; end if;
      if v_rollovers=1 then
        if v_meter.counter_modulus is null or v_reading>=v_run.opening_reading then raise exception 'A configured counter and decreased reading are required for rollover'; end if;
        v_energy:=v_meter.counter_modulus-v_run.opening_reading+v_reading;
      elsif v_reading>=v_run.opening_reading then v_energy:=v_reading-v_run.opening_reading;else v_energy:=null;end if;
      if p_command='usage.stop' then
        with intervals as(select command,recorded_at,lead(recorded_at,1,v_at) over(order by recorded_at,event_sequence) next_at from public.machine_usage_events where company_id=v_company and run_id=v_run.id)
        select coalesce(sum(extract(epoch from next_at-recorded_at)) filter(where command in ('usage.start','usage.resume')),0) into v_runtime from intervals;
        v_total:=extract(epoch from v_at-v_run.started_at);
        if v_runtime<0 or v_total<0 or v_runtime>v_total+0.001 then raise exception 'Machine event times require independent reconciliation'; end if;
        update public.machine_usage_runs set stopped_at=v_at,closing_reading=v_reading,runtime_seconds=greatest(v_runtime,0),downtime_seconds=greatest(v_total-v_runtime,0),status=case when v_energy is null then 'requires_review' else 'closed' end,
          energy_used=v_energy,cost=case when v_energy is not null then round(v_energy*rate_snapshot,2) end,review_reason=case when v_energy is null then 'Meter decreased; independent rollover or correction evidence is required' end where id=v_run.id;
      else
        if v_energy is null then raise exception 'Resolved readings must produce non-negative consumption'; end if;
        update public.machine_usage_runs set closing_reading=v_reading,energy_used=v_energy,cost=round(v_energy*rate_snapshot,2),status='closed',review_reason=trim(p_payload->>'reason') where id=v_run.id;
      end if;
    end if;
  end if;
  insert into public.machine_usage_events(id,company_id,run_id,command,payload,recorded_by,recorded_at) values(v_id,v_company,v_run.id,p_command,p_payload,auth.uid(),v_at);
  return jsonb_build_object('kind','state','run',private.machine_usage_view(v_company,v_run.id,v_cost));
end;
$$;
revoke all on function public.machine_usage_command(text,jsonb) from public,anon;
grant execute on function public.machine_usage_command(text,jsonb) to authenticated;
commit;

-- EOS 31 / 37: explicit press-shift capacity, maintenance blocks and finishing lead times.
-- Schedule changes remain on production_plan_slots; these records add planning assumptions.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.factory_shift_capacities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  machine_id uuid not null references public.machines(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  shift_name text not null check (length(btrim(shift_name)) between 1 and 40),
  starts_local time not null,
  ends_local time not null,
  capacity_kg numeric(14,3) not null check (capacity_kg > 0 and capacity_kg <= 10000000),
  created_by uuid not null references public.app_users(id),
  updated_at timestamptz not null default now(),
  unique (company_id, machine_id, weekday, shift_name),
  check (starts_local <> ends_local)
);
create index factory_shift_capacity_company_machine_idx on public.factory_shift_capacities(company_id,machine_id,weekday);
alter table public.factory_shift_capacities enable row level security;
revoke all on public.factory_shift_capacities from public,anon,authenticated;

create table public.factory_maintenance_blocks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  machine_id uuid not null references public.machines(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null check (length(btrim(reason)) between 3 and 240),
  status text not null default 'planned' check (status in ('planned','cancelled')),
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index factory_maintenance_blocks_company_machine_time_idx on public.factory_maintenance_blocks(company_id,machine_id,starts_at,ends_at) where status='planned';
alter table public.factory_maintenance_blocks enable row level security;
revoke all on public.factory_maintenance_blocks from public,anon,authenticated;

create table public.factory_finishing_lead_times (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  finishing_type text not null check (length(btrim(finishing_type)) between 1 and 60),
  lead_days smallint not null check (lead_days between 0 and 365),
  updated_by uuid not null references public.app_users(id),
  updated_at timestamptz not null default now(),
  unique (company_id, finishing_type)
);
create index factory_finishing_lead_times_company_idx on public.factory_finishing_lead_times(company_id,finishing_type);
alter table public.factory_finishing_lead_times enable row level security;
revoke all on public.factory_finishing_lead_times from public,anon,authenticated;

create table public.factory_schedule_requests (
  company_id uuid not null references public.companies(id) on delete cascade,
  request_id uuid not null,
  payload_hash text not null,
  slot_id uuid not null references public.production_plan_slots(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  primary key (company_id,request_id)
);
alter table public.factory_schedule_requests enable row level security;
revoke all on public.factory_schedule_requests from public,anon,authenticated;

create or replace function private.factory_planning_actor(p_roles text[])
returns uuid
language plpgsql stable security definer
set search_path = public, private
as $$
declare v_company uuid:=private.get_current_user_company_id(); v_role text:=private.get_current_user_role();
begin
  if auth.uid() is null or v_company is null or private.get_current_user_dealer_id() is not null
    or not exists(select 1 from public.app_users u where u.id=auth.uid() and u.company_id=v_company and u.role::text=v_role and u.is_active and u.dealer_id is null)
    or not (v_role=any(p_roles)) then
    raise exception 'This action is not permitted for your role' using errcode='42501';
  end if;
  return v_company;
end;
$$;
revoke all on function private.factory_planning_actor(text[]) from public,anon,authenticated;

create or replace function private.factory_schedule_fingerprint(p_company uuid,p_from date,p_through date)
returns text language sql stable security definer set search_path=public,private as $$
  select md5(jsonb_build_object(
    'slots',coalesce((select jsonb_agg(jsonb_build_array(s.id,s.production_job_id,s.machine_id,s.planned_start_at,s.planned_end_at,s.shift,s.capacity_kg,s.status)
      order by s.id) from public.production_plan_slots s where s.company_id=p_company and s.status<>'cancelled'
        and s.planned_start_at < ((p_through+1)::timestamp at time zone 'Asia/Kolkata')
        and s.planned_end_at > (p_from::timestamp at time zone 'Asia/Kolkata')),'[]'::jsonb),
    'jobs',coalesce((select jsonb_agg(jsonb_build_array(j.id,j.status,j.planned_quantity_kg,j.actual_quantity_kg,j.machine_id,j.finishing_type,j.updated_at) order by j.id)
      from public.production_jobs j where j.company_id=p_company and j.status in ('planned','ready','in_progress','on_hold')),'[]'::jsonb),
    'machines',coalesce((select jsonb_agg(jsonb_build_array(m.id,m.status,m.is_active) order by m.id)
      from public.machines m where m.company_id=p_company and m.machine_type='extrusion_press'),'[]'::jsonb),
    'shifts',coalesce((select jsonb_agg(jsonb_build_array(c.id,c.machine_id,c.weekday,c.shift_name,c.starts_local,c.ends_local,c.capacity_kg,c.updated_at) order by c.id)
      from public.factory_shift_capacities c where c.company_id=p_company),'[]'::jsonb),
    'blocks',coalesce((select jsonb_agg(jsonb_build_array(b.id,b.machine_id,b.starts_at,b.ends_at,b.reason,b.status) order by b.id)
      from public.factory_maintenance_blocks b where b.company_id=p_company and b.status='planned'
        and b.starts_at < ((p_through+1)::timestamp at time zone 'Asia/Kolkata')
        and b.ends_at > (p_from::timestamp at time zone 'Asia/Kolkata')),'[]'::jsonb),
    'breakdowns',coalesce((select jsonb_agg(jsonb_build_array(b.id,b.machine_ref_id,b.start_time,b.resolved_at,b.end_time) order by b.id)
      from public.breakdown_logs b where b.company_id=p_company and b.machine_ref_id is not null
        and b.start_time < ((p_through+1)::timestamp at time zone 'Asia/Kolkata')
        and coalesce(b.resolved_at,b.end_time,now()) > (p_from::timestamp at time zone 'Asia/Kolkata')),'[]'::jsonb)
  )::text)
$$;
revoke all on function private.factory_schedule_fingerprint(uuid,date,date) from public,anon,authenticated;

create or replace function private.enforce_factory_slot_capacity()
returns trigger language plpgsql security definer set search_path=public,private as $$
declare
  v_local_start timestamp; v_local_end timestamp; v_shift_start timestamp; v_shift_end timestamp;
  v_shift_start_at timestamptz; v_shift_end_at timestamptz; v_weekday integer;
  v_capacity public.factory_shift_capacities%rowtype; v_candidates integer; v_used numeric;
begin
  if new.status not in ('scheduled','released') then return new; end if;
  if new.planned_end_at is null or new.capacity_kg is null or new.capacity_kg<=0 then
    raise exception 'Active press slots need an end time and a positive planned kg amount' using errcode='23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('production-slot-machine:'||new.company_id::text||':'||new.machine_id::text,0));
  v_local_start:=new.planned_start_at at time zone 'Asia/Kolkata';
  v_local_end:=new.planned_end_at at time zone 'Asia/Kolkata';
  v_weekday:=extract(isodow from v_local_start)::integer;
  select c.* into v_capacity
  from public.factory_shift_capacities c
  where c.company_id=new.company_id and c.machine_id=new.machine_id and lower(c.shift_name)=lower(coalesce(new.shift,''))
    and c.weekday in (v_weekday,case when v_weekday=1 then 7 else v_weekday-1 end)
    and v_local_start >= (case when c.weekday=v_weekday then v_local_start::date else (v_local_start::date-1) end + c.starts_local)
    and v_local_start < (case when c.weekday=v_weekday then v_local_start::date else (v_local_start::date-1) end + c.ends_local
      + case when c.ends_local<=c.starts_local then interval '1 day' else interval '0' end)
    and v_local_end <= (case when c.weekday=v_weekday then v_local_start::date else (v_local_start::date-1) end + c.ends_local
      + case when c.ends_local<=c.starts_local then interval '1 day' else interval '0' end)
  order by c.id limit 1;
  if not found then raise exception 'Configure a matching machine and shift capacity before confirming this slot' using errcode='23514'; end if;
  v_shift_start:=(case when v_capacity.weekday=v_weekday then v_local_start::date else (v_local_start::date-1) end + v_capacity.starts_local);
  v_shift_end:=(case when v_capacity.weekday=v_weekday then v_local_start::date else (v_local_start::date-1) end + v_capacity.ends_local
    + case when v_capacity.ends_local<=v_capacity.starts_local then interval '1 day' else interval '0' end);
  v_shift_start_at:=v_shift_start at time zone 'Asia/Kolkata';
  v_shift_end_at:=v_shift_end at time zone 'Asia/Kolkata';
  if exists(select 1 from public.factory_maintenance_blocks b where b.company_id=new.company_id and b.machine_id=new.machine_id and b.status='planned'
      and b.starts_at<new.planned_end_at and b.ends_at>new.planned_start_at)
    or exists(select 1 from public.breakdown_logs b where b.company_id=new.company_id and b.machine_ref_id=new.machine_id
      and b.start_time<new.planned_end_at and coalesce(b.resolved_at,b.end_time,now())>new.planned_start_at) then
    raise exception 'This slot overlaps a planned maintenance window or unresolved breakdown' using errcode='23P01';
  end if;
  select coalesce(sum(s.capacity_kg),0) into v_used from public.production_plan_slots s
  where s.company_id=new.company_id and s.machine_id=new.machine_id and lower(s.shift)=lower(new.shift)
    and s.status in ('scheduled','released') and s.id<>coalesce(new.id,'00000000-0000-0000-0000-000000000000'::uuid)
    and s.planned_start_at>=v_shift_start_at and s.planned_start_at<v_shift_end_at;
  if v_used+new.capacity_kg>v_capacity.capacity_kg+0.001 then
    raise exception 'This machine shift exceeds its configured kg capacity' using errcode='23514';
  end if;
  if exists(select 1 from public.machines m where m.id=new.machine_id and m.company_id=new.company_id
      and (m.machine_type<>'extrusion_press' or not m.is_active or m.status not in ('active','operational','idle'))) then
    raise exception 'Selected extrusion press is not available for planning' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_factory_slot_capacity() from public,anon,authenticated;
drop trigger if exists enforce_factory_slot_capacity on public.production_plan_slots;
create trigger enforce_factory_slot_capacity before insert or update of company_id,machine_id,planned_start_at,planned_end_at,shift,capacity_kg,status
on public.production_plan_slots for each row execute function private.enforce_factory_slot_capacity();

create or replace function public.factory_planning_snapshot(p_from date,p_through date)
returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare v_company uuid;v_role text;v_from date:=coalesce(p_from,(now() at time zone 'Asia/Kolkata')::date-1);v_through date:=coalesce(p_through,(now() at time zone 'Asia/Kolkata')::date+30);
  v_machines jsonb;v_jobs jsonb;v_slots jsonb;v_capacities jsonb;v_blocks jsonb;v_leads jsonb;
begin
  v_role:=private.get_current_user_role();
  v_company:=private.factory_planning_actor(array['owner','admin','production_manager','production','factory_manager','viewer']);
  if v_through<v_from or v_through>v_from+60 then raise exception 'Planning window must be 1 to 61 days' using errcode='23514'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'machine_name',m.machine_name,'status',m.status,'is_active',m.is_active) order by m.machine_name,m.id),'[]') into v_machines
    from public.machines m where m.company_id=v_company and m.machine_type='extrusion_press';
  select coalesce(jsonb_agg(to_jsonb(q) order by q.planned_date nulls last,q.job_number,q.id),'[]') into v_jobs from (
    select j.id,j.job_number,j.order_id,o.order_number,coalesce(c.company_name,c.customer_name) customer_name,p.profile_code,d.die_number,d.die_status,
      j.status,j.machine_id,j.planned_quantity_kg,j.actual_quantity_kg,j.planned_date,coalesce(j.finishing_type,'mill_finish') finishing_type,j.source_line_id,
      coalesce(o.billet_allocation_status,'not_required') billet_allocation_status,coalesce(o.billets_short,0) billets_short
    from public.production_jobs j join public.orders o on o.id=j.order_id and o.company_id=v_company and o.deleted_at is null
      left join public.customers c on c.id=o.customer_id and c.company_id=v_company
      left join public.aluminium_profiles p on p.id=j.profile_id and p.company_id=v_company
      left join public.dies d on d.id=j.die_id and d.company_id=v_company
    where j.company_id=v_company and j.status in ('planned','ready','in_progress','on_hold') and o.current_stage not in ('cancelled','closed','delivered','dispatched')
    order by j.planned_date nulls last,j.job_number,j.id limit 200
  ) q;
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'production_job_id',s.production_job_id,'machine_id',s.machine_id,'planned_start_at',s.planned_start_at,
    'planned_end_at',s.planned_end_at,'shift',s.shift,'sequence_number',s.sequence_number,'capacity_kg',s.capacity_kg,'status',s.status) order by s.planned_start_at,s.machine_id,s.sequence_number,s.id),'[]') into v_slots
    from public.production_plan_slots s where s.company_id=v_company and s.status<>'cancelled'
      and s.planned_start_at<((v_through+1)::timestamp at time zone 'Asia/Kolkata') and coalesce(s.planned_end_at,s.planned_start_at)> (v_from::timestamp at time zone 'Asia/Kolkata');
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'machine_id',c.machine_id,'weekday',c.weekday,'shift_name',c.shift_name,'starts_local',c.starts_local,'ends_local',c.ends_local,'capacity_kg',c.capacity_kg) order by c.machine_id,c.weekday,c.starts_local,c.id),'[]') into v_capacities
    from public.factory_shift_capacities c where c.company_id=v_company;
  select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'machine_id',b.machine_id,'starts_at',b.starts_at,'ends_at',b.ends_at,'reason',b.reason,'status',b.status) order by b.starts_at,b.id),'[]') into v_blocks
    from public.factory_maintenance_blocks b where b.company_id=v_company and b.status='planned'
      and b.starts_at<((v_through+1)::timestamp at time zone 'Asia/Kolkata') and b.ends_at>(v_from::timestamp at time zone 'Asia/Kolkata');
  select coalesce(jsonb_agg(jsonb_build_object('finishing_type',l.finishing_type,'lead_days',l.lead_days) order by l.finishing_type),'[]') into v_leads
    from public.factory_finishing_lead_times l where l.company_id=v_company;
  return jsonb_build_object('company_id',v_company,'from_date',v_from,'through_date',v_through,'today',(now() at time zone 'Asia/Kolkata')::date,
    'fingerprint',private.factory_schedule_fingerprint(v_company,v_from,v_through),'machines',v_machines,'jobs',v_jobs,'slots',v_slots,
    'shift_capacities',v_capacities,'maintenance_blocks',v_blocks,'finishing_lead_times',v_leads);
end;
$$;
revoke all on function public.factory_planning_snapshot(date,date) from public,anon;
grant execute on function public.factory_planning_snapshot(date,date) to authenticated;

create or replace function public.save_factory_shift_capacity(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_company uuid;v_id uuid;v_machine uuid;v_weekday integer;v_name text;v_start time;v_end time;v_capacity numeric;v_row public.factory_shift_capacities%rowtype;
begin
  v_company:=private.factory_planning_actor(array['owner','admin','production_manager','factory_manager']);
  if jsonb_typeof(p_payload) is distinct from 'object' or p_payload-array['machine_id','weekday','shift_name','starts_local','ends_local','capacity_kg']<>'{}' then raise exception 'Invalid shift capacity request'; end if;
  v_machine:=(p_payload->>'machine_id')::uuid;v_weekday:=(p_payload->>'weekday')::integer;v_name:=btrim(coalesce(p_payload->>'shift_name',''));
  if p_payload->>'starts_local' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or p_payload->>'ends_local' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or p_payload->>'capacity_kg' !~ '^([0-9]{1,8})(\.[0-9]{1,3})?$' then raise exception 'Enter a valid shift time and kg capacity'; end if;
  v_start:=(p_payload->>'starts_local')::time;v_end:=(p_payload->>'ends_local')::time;v_capacity:=(p_payload->>'capacity_kg')::numeric;
  if v_weekday not between 1 and 7 or length(v_name) not between 1 and 40 or v_start=v_end or v_capacity<=0 or v_capacity>10000000 then raise exception 'Shift capacity details are outside valid limits'; end if;
  if not exists(select 1 from public.machines m where m.id=v_machine and m.company_id=v_company and m.machine_type='extrusion_press') then raise exception 'Select an extrusion press from this company'; end if;
  perform pg_advisory_xact_lock(hashtextextended('production-slot-machine:'||v_company::text||':'||v_machine::text,0));
  -- Reject overlapping weekly windows, including the previous day's overnight shift.
  if exists(
    with candidate_days as (
      select d::date local_day from generate_series((now() at time zone 'Asia/Kolkata')::date-1,
        (now() at time zone 'Asia/Kolkata')::date+14,interval '1 day') d where extract(isodow from d)=v_weekday
    ), existing as (
      select c.* from public.factory_shift_capacities c where c.company_id=v_company and c.machine_id=v_machine
        and c.id<>coalesce((select id from public.factory_shift_capacities where company_id=v_company and machine_id=v_machine and weekday=v_weekday and lower(shift_name)=lower(v_name)),
          '00000000-0000-0000-0000-000000000000'::uuid)
    )
    select 1 from candidate_days d cross join existing c
      cross join lateral generate_series(d.local_day-interval '1 day',d.local_day+interval '1 day',interval '1 day') existing_day(day_start)
    where extract(isodow from existing_day.day_start)=c.weekday
      and tstzrange((d.local_day+v_start) at time zone 'Asia/Kolkata',
        ((d.local_day+v_end)+case when v_end<=v_start then interval '1 day' else interval '0' end) at time zone 'Asia/Kolkata','[)')
        && tstzrange((existing_day.day_start::date+c.starts_local) at time zone 'Asia/Kolkata',
          ((existing_day.day_start::date+c.ends_local)+case when c.ends_local<=c.starts_local then interval '1 day' else interval '0' end) at time zone 'Asia/Kolkata','[)')
  ) then raise exception 'This shift overlaps another configured shift on the same press' using errcode='23P01'; end if;
  insert into public.factory_shift_capacities(company_id,machine_id,weekday,shift_name,starts_local,ends_local,capacity_kg,created_by)
  values(v_company,v_machine,v_weekday,v_name,v_start,v_end,v_capacity,auth.uid())
  on conflict(company_id,machine_id,weekday,shift_name) do update set starts_local=excluded.starts_local,ends_local=excluded.ends_local,capacity_kg=excluded.capacity_kg,updated_at=now()
  returning * into v_row;
  if exists(
    with local_slots as (
      select (s.planned_start_at at time zone 'Asia/Kolkata') local_start,(s.planned_end_at at time zone 'Asia/Kolkata') local_end,s.capacity_kg
      from public.production_plan_slots s where s.company_id=v_company and s.machine_id=v_machine and lower(s.shift)=lower(v_name) and s.status in ('scheduled','released')
    ), windows as (
      select case when extract(isodow from l.local_start)::integer=v_row.weekday then l.local_start::date
        else (l.local_start::date-1) end shift_day,l.local_start,l.local_end,l.capacity_kg
      from local_slots l where extract(isodow from l.local_start)::integer=v_row.weekday
        or (v_row.ends_local<=v_row.starts_local and extract(isodow from l.local_start-interval '1 day')::integer=v_row.weekday)
    ), used as (
      select w.shift_day,sum(w.capacity_kg) kg from windows w
      where w.local_start>=w.shift_day+v_row.starts_local
        and w.local_start<w.shift_day+v_row.ends_local+case when v_row.ends_local<=v_row.starts_local then interval '1 day' else interval '0' end
        and w.local_end<=w.shift_day+v_row.ends_local+case when v_row.ends_local<=v_row.starts_local then interval '1 day' else interval '0' end
      group by w.shift_day
    ) select 1 from used where kg>v_capacity+0.001
  ) then raise exception 'This shift capacity is below the kg already scheduled. Resolve those slots first' using errcode='23514'; end if;
  if exists(
    select 1 from public.production_plan_slots s
    cross join lateral (select s.planned_start_at at time zone 'Asia/Kolkata' local_start,s.planned_end_at at time zone 'Asia/Kolkata' local_end) l
    where s.company_id=v_company and s.machine_id=v_machine and lower(s.shift)=lower(v_name) and s.status in ('scheduled','released')
      and (extract(isodow from l.local_start)::integer=v_row.weekday
        or (v_row.ends_local<=v_row.starts_local and extract(isodow from l.local_start-interval '1 day')::integer=v_row.weekday))
      and (l.local_start < (case when extract(isodow from l.local_start)::integer=v_row.weekday then l.local_start::date else l.local_start::date-1 end)+v_row.starts_local
        or l.local_end > (case when extract(isodow from l.local_start)::integer=v_row.weekday then l.local_start::date else l.local_start::date-1 end)+v_row.ends_local
          +case when v_row.ends_local<=v_row.starts_local then interval '1 day' else interval '0' end)
  ) then raise exception 'Shift time changes would place active press slots outside the configured window' using errcode='23514'; end if;
  return jsonb_build_object('id',v_row.id,'machine_id',v_row.machine_id,'weekday',v_row.weekday,'shift_name',v_row.shift_name,'starts_local',to_char(v_row.starts_local,'HH24:MI'),'ends_local',to_char(v_row.ends_local,'HH24:MI'),'capacity_kg',v_row.capacity_kg);
end;
$$;
revoke all on function public.save_factory_shift_capacity(jsonb) from public,anon;
grant execute on function public.save_factory_shift_capacity(jsonb) to authenticated;

create or replace function public.create_factory_maintenance_block(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_company uuid;v_id uuid;v_machine uuid;v_start timestamptz;v_end timestamptz;v_reason text;v_row public.factory_maintenance_blocks%rowtype;
begin
  v_company:=private.factory_planning_actor(array['owner','admin','production_manager','factory_manager']);
  if jsonb_typeof(p_payload) is distinct from 'object' or p_payload-array['id','machine_id','starts_at','ends_at','reason']<>'{}' then raise exception 'Invalid maintenance block request'; end if;
  v_id:=(p_payload->>'id')::uuid;v_machine:=(p_payload->>'machine_id')::uuid;v_start:=(p_payload->>'starts_at')::timestamptz;v_end:=(p_payload->>'ends_at')::timestamptz;v_reason:=btrim(coalesce(p_payload->>'reason',''));
  if v_start is null or v_end is null or v_end<=v_start or v_end>v_start+interval '31 days' or length(v_reason) not between 3 and 240 or v_reason~'[[:cntrl:]]' then raise exception 'Enter a valid maintenance window and reason'; end if;
  if not exists(select 1 from public.machines m where m.id=v_machine and m.company_id=v_company and m.machine_type='extrusion_press') then raise exception 'Select an extrusion press from this company'; end if;
  perform pg_advisory_xact_lock(hashtextextended('production-slot-machine:'||v_company::text||':'||v_machine::text,0));
  if exists(select 1 from public.production_plan_slots s where s.company_id=v_company and s.machine_id=v_machine and s.status in ('scheduled','released') and s.planned_start_at<v_end and s.planned_end_at>v_start) then
    raise exception 'Resolve the scheduled press slot before adding this maintenance block' using errcode='23P01';
  end if;
  if exists(select 1 from public.factory_maintenance_blocks b where b.company_id=v_company and b.machine_id=v_machine and b.status='planned'
      and b.id<>v_id and b.starts_at<v_end and b.ends_at>v_start) then
    raise exception 'This maintenance window overlaps an existing planned maintenance block' using errcode='23P01';
  end if;
  select * into v_row from public.factory_maintenance_blocks where id=v_id and company_id=v_company;
  if found then
    if v_row.machine_id<>v_machine or v_row.starts_at<>v_start or v_row.ends_at<>v_end or v_row.reason<>v_reason then raise exception 'Maintenance block identity was used for different details'; end if;
  else
    insert into public.factory_maintenance_blocks(id,company_id,machine_id,starts_at,ends_at,reason,created_by) values(v_id,v_company,v_machine,v_start,v_end,v_reason,auth.uid()) returning * into v_row;
  end if;
  return jsonb_build_object('id',v_row.id,'machine_id',v_row.machine_id,'starts_at',v_row.starts_at,'ends_at',v_row.ends_at,'reason',v_row.reason,'status',v_row.status);
end;
$$;
revoke all on function public.create_factory_maintenance_block(jsonb) from public,anon;
grant execute on function public.create_factory_maintenance_block(jsonb) to authenticated;

create or replace function public.save_factory_finishing_lead_time(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_company uuid;v_type text;v_days integer;v_row public.factory_finishing_lead_times%rowtype;
begin
  v_company:=private.factory_planning_actor(array['owner','admin','production_manager','factory_manager']);
  if jsonb_typeof(p_payload) is distinct from 'object' or p_payload-array['finishing_type','lead_days']<>'{}' then raise exception 'Invalid finishing lead-time request'; end if;
  v_type:=btrim(coalesce(p_payload->>'finishing_type',''));v_days:=(p_payload->>'lead_days')::integer;
  if length(v_type) not between 1 and 60 or v_type~'[[:cntrl:]]' or v_days not between 0 and 365 then raise exception 'Enter a valid finishing type and lead time'; end if;
  insert into public.factory_finishing_lead_times(company_id,finishing_type,lead_days,updated_by)
    values(v_company,v_type,v_days,auth.uid()) on conflict(company_id,finishing_type) do update set lead_days=excluded.lead_days,updated_by=excluded.updated_by,updated_at=now() returning * into v_row;
  return jsonb_build_object('finishing_type',v_row.finishing_type,'lead_days',v_row.lead_days);
end;
$$;
revoke all on function public.save_factory_finishing_lead_time(jsonb) from public,anon;
grant execute on function public.save_factory_finishing_lead_time(jsonb) to authenticated;

create or replace function public.commit_factory_schedule_move(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare
  v_company uuid;v_request uuid;v_job uuid;v_machine uuid;v_slot uuid;v_start timestamptz;v_end timestamptz;v_shift text;v_capacity numeric;v_seq integer;
  v_from date;v_through date;v_fingerprint text;v_hash text;v_existing public.production_plan_slots%rowtype;v_saved uuid;
begin
  v_company:=private.factory_planning_actor(array['owner','admin','production_manager','production','factory_manager']);
  if jsonb_typeof(p_payload) is distinct from 'object' or p_payload-array['request_id','production_job_id','slot_id','machine_id','planned_start_at','planned_end_at','shift','capacity_kg','sequence_number','from_date','through_date','fingerprint']<>'{}' then raise exception 'Invalid schedule move request'; end if;
  v_request:=(p_payload->>'request_id')::uuid;v_job:=(p_payload->>'production_job_id')::uuid;v_slot:=nullif(p_payload->>'slot_id','')::uuid;v_machine:=(p_payload->>'machine_id')::uuid;
  v_start:=(p_payload->>'planned_start_at')::timestamptz;v_end:=(p_payload->>'planned_end_at')::timestamptz;v_shift:=btrim(coalesce(p_payload->>'shift',''));
  v_capacity:=(p_payload->>'capacity_kg')::numeric;v_seq:=(p_payload->>'sequence_number')::integer;v_from:=(p_payload->>'from_date')::date;v_through:=(p_payload->>'through_date')::date;v_fingerprint:=p_payload->>'fingerprint';
  if v_request is null or v_job is null or v_machine is null or v_start is null or v_end is null or v_end<=v_start or v_capacity is null or v_capacity<=0 or v_capacity>10000000
    or v_capacity::text in ('NaN','Infinity','-Infinity') or v_capacity<>round(v_capacity,3)
    or length(v_shift) not between 1 and 40 or v_seq is null or v_seq<0 or v_seq>1000000 or v_from is null or v_through is null or v_through<v_from or v_through>v_from+60 or length(coalesce(v_fingerprint,''))<>32 then raise exception 'Enter valid schedule details'; end if;
  v_hash:=md5(p_payload::text);
  perform pg_advisory_xact_lock(hashtextextended('factory-schedule-request:'||v_company::text||':'||v_request::text,0));
  if exists(select 1 from public.factory_schedule_requests r where r.company_id=v_company and r.request_id=v_request) then
    if (select r.payload_hash from public.factory_schedule_requests r where r.company_id=v_company and r.request_id=v_request)<>v_hash then raise exception 'Request identity was used for different schedule details'; end if;
    return jsonb_build_object('slot_id',(select r.slot_id from public.factory_schedule_requests r where r.company_id=v_company and r.request_id=v_request),'replayed',true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('production-slot-job:'||v_company::text||':'||v_job::text,0));
  perform pg_advisory_xact_lock(hashtextextended('production-slot-machine:'||v_company::text||':'||m.id::text,0)) from public.machines m where m.company_id=v_company and m.machine_type='extrusion_press' order by m.id;
  if private.factory_schedule_fingerprint(v_company,v_from,v_through)<>v_fingerprint then raise exception 'The factory schedule changed while you reviewed this move. Refresh and review it again' using errcode='40001'; end if;
  if v_slot is not null then
    select * into v_existing from public.production_plan_slots where id=v_slot and company_id=v_company for update;
    if not found or v_existing.production_job_id<>v_job or v_existing.status='released' then raise exception 'This press slot cannot be moved'; end if;
  end if;
  perform 1 from public.production_jobs j join public.orders o on o.id=j.order_id and o.company_id=v_company
    join public.dies d on d.id=j.die_id and d.company_id=v_company and d.profile_id=j.profile_id
    where j.id=v_job and j.company_id=v_company and j.status in ('planned','ready','on_hold') and o.deleted_at is null
      and o.current_stage not in ('closed','cancelled','dispatched','delivered') and d.die_status not in ('inactive','dead','blocked','retired','scrapped','under_maintenance') for update of j;
  if not found then raise exception 'Production job is not eligible for press scheduling' using errcode='23514'; end if;
  if not exists(select 1 from public.machines m where m.id=v_machine and m.company_id=v_company and m.machine_type='extrusion_press' and m.is_active and m.status in ('active','operational','idle')) then raise exception 'Selected extrusion press is not available for planning' using errcode='23514'; end if;
  v_saved:=private.save_production_schedule_slot_atomic(v_slot,jsonb_build_object('production_job_id',v_job,'machine_id',v_machine,'planned_start_at',v_start,
    'planned_end_at',v_end,'shift',v_shift,'sequence_number',v_seq,'capacity_kg',v_capacity,'status','scheduled'));
  insert into public.factory_schedule_requests(company_id,request_id,payload_hash,slot_id) values(v_company,v_request,v_hash,v_saved);
  return jsonb_build_object('slot_id',v_saved,'replayed',false);
end;
$$;
revoke all on function public.commit_factory_schedule_move(jsonb) from public,anon;
grant execute on function public.commit_factory_schedule_move(jsonb) to authenticated;

commit;

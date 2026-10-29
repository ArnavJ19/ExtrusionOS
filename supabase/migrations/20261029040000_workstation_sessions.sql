begin;
create table public.workstation_sessions (
  id uuid primary key,company_id uuid not null references public.companies(id),operator_id uuid not null references public.app_users(id),
  machine_id uuid not null references public.machines(id),opened_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '10 minutes'),ended_at timestamptz
);
create index workstation_company_operator_idx on public.workstation_sessions(company_id,operator_id,expires_at);
create index workstation_machine_idx on public.workstation_sessions(machine_id);
alter table public.workstation_sessions enable row level security;
revoke all on public.workstation_sessions from public,anon,authenticated;
create function public.workstation_command(p_command text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,private as $$
declare v_company uuid;v_session public.workstation_sessions%rowtype;v_machine public.machines%rowtype;v_items jsonb;v_page integer:=coalesce((p_payload->>'page')::integer,1);
begin
  v_company:=private.commercial_actor(array['owner','admin','production_manager','production','factory_manager']);
  if p_command is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Invalid workstation request'; end if;
  if p_command='stations.list' then
    if p_payload-array['page','search']<>'{}' or v_page<1 or v_page>10000 or length(coalesce(p_payload->>'search',''))>80 then raise exception 'Invalid station search'; end if;
    select coalesce(jsonb_agg(to_jsonb(r)),'[]') into v_items from (
      select m.id,coalesce(to_jsonb(m)->>'machine_name',to_jsonb(m)->>'name',m.id::text) name,m.machine_type
      from public.machines m where m.company_id=v_company and m.is_active and m.machine_type='extrusion_press'
        and coalesce(m.status,'active')='active' and position(lower(coalesce(p_payload->>'search','')) in lower(coalesce(to_jsonb(m)->>'machine_name',to_jsonb(m)->>'name','')))>0
      order by m.id limit 10 offset (v_page-1)*10
    )r;return jsonb_build_object('kind','stations','page',v_page,'items',v_items);
  end if;
  if p_command='station.open' then
    if p_payload-array['id','machine_id']<>'{}' then raise exception 'Invalid station request'; end if;
    select * into v_machine from public.machines where id=(p_payload->>'machine_id')::uuid and company_id=v_company and is_active and machine_type='extrusion_press' and coalesce(status,'active')='active' for share;
    if not found then raise exception 'An active company press is required'; end if;
    insert into public.workstation_sessions(id,company_id,operator_id,machine_id) values((p_payload->>'id')::uuid,v_company,auth.uid(),v_machine.id) on conflict(id) do nothing;
    select * into v_session from public.workstation_sessions where id=(p_payload->>'id')::uuid and company_id=v_company and operator_id=auth.uid() and machine_id=v_machine.id for update;
    if not found or v_session.ended_at is not null or v_session.expires_at<=now() then raise exception 'Workstation identity is unavailable or expired'; end if;
    return jsonb_build_object('kind','session','id',v_session.id,'machine_id',v_machine.id,'name',coalesce(to_jsonb(v_machine)->>'machine_name',to_jsonb(v_machine)->>'name',v_machine.id::text),'expires_at',v_session.expires_at,'operator_id',auth.uid());
  end if;
  if p_payload-array['id']<>'{}' then raise exception 'Invalid station request'; end if;
  select * into v_session from public.workstation_sessions where id=(p_payload->>'id')::uuid and company_id=v_company and operator_id=auth.uid() for update;
  if not found then raise exception 'Workstation identity is unavailable or expired'; end if;
  if p_command='station.end' then
    update public.workstation_sessions set ended_at=coalesce(ended_at,now()) where id=v_session.id;
    return jsonb_build_object('kind','ended');
  end if;
  if p_command<>'station.queue' or v_session.ended_at is not null or v_session.expires_at<=now() then raise exception 'Workstation identity is unavailable or expired'; end if;
  perform 1 from public.machines where id=v_session.machine_id and company_id=v_company and is_active and coalesce(status,'active')='active';
  if not found then raise exception 'The selected press is unavailable'; end if;
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into v_items from (
    select id,job_number,status,order_id,profile_id,planned_quantity_kg from public.production_jobs
      where company_id=v_company and machine_id=v_session.machine_id and status in ('planned','ready','released','in_progress','on_hold')
      order by case when status='in_progress' then 0 else 1 end,planned_date nulls last,id limit 10
  )r;
  return jsonb_build_object('kind','queue','items',v_items,'expires_at',v_session.expires_at);
end;
$$;
revoke all on function public.workstation_command(text,jsonb) from public,anon;
grant execute on function public.workstation_command(text,jsonb) to authenticated;
commit;

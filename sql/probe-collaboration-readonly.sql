-- Read-only session-claim simulation, not proof of a signed-in employee JWT.
begin read only;
select set_config('request.jwt.claim.sub',id::text,true),set_config('request.jwt.claims',jsonb_build_object('sub',id,'role','authenticated')::text,true)
from public.app_users where is_active and role='owner' and dealer_id is null order by id limit 1;
set local role authenticated;
do $$
declare v_data jsonb;
begin
 if auth.uid() is null then raise exception 'An active internal owner is required for the read probe';end if;
 v_data:=public.collaboration_workflow_command('procedures.list','{"page":1}'::jsonb);
 if jsonb_typeof(v_data->'rows')<>'array' then raise exception 'Procedure projection is unavailable';end if;
 v_data:=public.collaboration_workflow_command('routines.list','{"page":1}'::jsonb);
 if jsonb_typeof(v_data->'rows')<>'array' then raise exception 'Routine projection is unavailable';end if;
 perform id from public.customers where company_id=private.get_current_user_company_id() limit 1;
 perform id,company_id,status from public.quotes where company_id=private.get_current_user_company_id() limit 1;
 begin
  perform grand_total from public.quotes limit 1;
  raise exception 'Pricing unexpectedly readable through the base table';
 exception when insufficient_privilege then null;end;
 begin
  perform id from public.operating_procedures limit 1;
  raise exception 'Procedure base table unexpectedly readable';
 exception when insufficient_privilege then null;end;
end;$$;
commit;
begin read only;
set local role anon;
do $$begin
 begin
  perform public.collaboration_workflow_command('procedures.list','{}'::jsonb);
  raise exception 'Anonymous RPC execution unexpectedly permitted';
 exception when insufficient_privilege then null;end;
end;$$;
commit;
select true as collaboration_readonly_role_probes_passed;

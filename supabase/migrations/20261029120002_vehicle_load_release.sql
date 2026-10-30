begin;
create function public.release_factory_vehicle_load_bundles(p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare c uuid;v_request uuid;v_load public.factory_vehicle_loads;v_previous public.factory_vehicle_load_requests;v_ids uuid[];v_hash text;v_count int;
begin
  c:=private.factory_vehicle_actor(array['owner','admin','factory_manager','dispatch_manager','dispatch']);
  if jsonb_typeof(p_payload) is distinct from 'object' or p_payload-array['request_id','load_id','expected_version','bundle_ids','reason']<>'{}' or jsonb_typeof(p_payload->'bundle_ids') is distinct from 'array' or jsonb_array_length(p_payload->'bundle_ids') not between 1 and 500 or length(btrim(coalesce(p_payload->>'reason',''))) not between 8 and 1000 then raise exception 'Select saved load bundles and explain their release';end if;
  v_request:=(p_payload->>'request_id')::uuid;if v_request is null then raise exception 'A release identity is required';end if;
  select array_agg(value::uuid order by value::uuid) into v_ids from jsonb_array_elements_text(p_payload->'bundle_ids');
  if cardinality(v_ids)<>(select count(distinct x) from unnest(v_ids)x) then raise exception 'Each bundle can be released once';end if;
  v_hash:=md5('release:'||p_payload::text);perform pg_advisory_xact_lock(hashtextextended('factory-load-request:'||c::text||':'||v_request::text,0));
  select * into v_previous from public.factory_vehicle_load_requests where company_id=c and request_id=v_request;
  if found then if v_previous.payload_hash<>v_hash then raise exception 'Request identity has different load-release details';end if;return jsonb_build_object('load',private.factory_vehicle_load_result(c,v_previous.load_id),'replayed',true);end if;
  select * into v_load from public.factory_vehicle_loads where company_id=c and id=(p_payload->>'load_id')::uuid for update;
  if not found or v_load.version is distinct from (p_payload->>'expected_version')::int then raise exception 'This saved load changed; reload before releasing its bundles' using errcode='40001';end if;
  perform 1 from public.factory_vehicle_load_items where company_id=c and load_id=v_load.id and bundle_id=any(v_ids) order by bundle_id for update;
  select count(*) into v_count from public.factory_vehicle_load_items where company_id=c and load_id=v_load.id and bundle_id=any(v_ids) and status='active';
  if v_count<>cardinality(v_ids) then raise exception 'Only active bundles of this exact load can be released';end if;
  update public.factory_vehicle_load_items set status='removed',updated_at=clock_timestamp() where company_id=c and load_id=v_load.id and bundle_id=any(v_ids) and status='active';
  update public.factory_vehicle_loads set version=version+1,updated_at=clock_timestamp() where id=v_load.id returning * into v_load;
  insert into public.factory_vehicle_load_requests(company_id,request_id,payload_hash,load_id,version) values(c,v_request,v_hash,v_load.id,v_load.version);
  insert into public.audit_logs(company_id,actor_id,action,entity_type,entity_id,metadata_json) values(c,auth.uid(),'vehicle_load_bundles_released','vehicle_load',v_load.id,jsonb_build_object('bundle_ids',v_ids,'reason',btrim(p_payload->>'reason'),'request_id',v_request));
  return jsonb_build_object('load',private.factory_vehicle_load_result(c,v_load.id),'replayed',false);
end $$;
revoke all on function public.release_factory_vehicle_load_bundles(jsonb) from public,anon;
grant execute on function public.release_factory_vehicle_load_bundles(jsonb) to authenticated;
commit;

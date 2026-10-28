-- EOS 12: bounded suggestions derived from current authoritative stock balances.
begin;
create function public.material_suggestion_command(p_payload jsonb) returns jsonb
language plpgsql stable security definer set search_path=public,private as $$
declare v_company uuid;v_profile public.aluminium_profiles%rowtype;v_page integer:=coalesce((p_payload->>'page')::integer,1);
  v_finish text:=p_payload->>'finish';v_length numeric:=nullif(p_payload->>'cut_length_m','')::numeric;
  v_customer uuid:=nullif(p_payload->>'customer_id','')::uuid;v_stock jsonb;v_dies jsonb;v_alloy text;v_temper text;v_option public.profile_technical_options%rowtype;
begin
  v_company:=private.commercial_actor(array['owner','admin','sales','sales_manager','production_manager','production','factory_manager','inventory_manager','dispatch_manager','dispatch','quality']);
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or p_payload-array['profile_id','finish','cut_length_m','customer_id','page','technical_option_id']<>'{}'
    or v_page<1 or v_page>10000 or length(coalesce(v_finish,''))>60 or v_length is null or v_length<=0 or v_length>1000
    or v_length::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid material suggestion request'; end if;
  select * into v_profile from public.aluminium_profiles where id=(p_payload->>'profile_id')::uuid and company_id=v_company and is_active;
  if not found then raise exception 'Active profile is unavailable'; end if;
  v_alloy:=v_profile.alloy;v_temper:=v_profile.temper;
  if nullif(p_payload->>'technical_option_id','') is not null then
    select * into v_option from public.profile_technical_options where company_id=v_company and profile_id=v_profile.id and id=(p_payload->>'technical_option_id')::uuid
      and status='approved' and source_fingerprint=private.technical_option_fingerprint(v_profile,alloy_id,temper_id);
    if not found then raise exception 'Selected technical option is stale or unavailable'; end if;
    v_alloy:=v_option.snapshot->>'alloy';v_temper:=v_option.snapshot->>'temper';
  end if;
  with candidates as (
    select b.id,b.bundle_number,b.location,b.finish,b.piece_length_m,b.updated_at,
      private.profile_stock_balance(v_company,b.id) balance,
      case when b.dealer_id is not null then 'Dealer-owned stock requires its dealer workflow'
        when b.qc_status not in ('released','not_required') then 'Quality release is required'
        when b.status not in ('available','reserved') then 'Batch status excludes allocation'
        when nullif(b.alloy,'') is null or nullif(b.temper,'') is null or nullif(v_alloy,'') is null or nullif(v_temper,'') is null then 'Alloy or temper provenance is not captured'
        when regexp_replace(lower(b.alloy),'[^a-z0-9]','','g')<>regexp_replace(lower(v_alloy),'[^a-z0-9]','','g') or regexp_replace(lower(b.temper),'[^a-z0-9]','','g')<>regexp_replace(lower(v_temper),'[^a-z0-9]','','g') then 'Alloy or temper does not match'
        when regexp_replace(lower(b.finish),'[^a-z0-9]','','g') is distinct from regexp_replace(lower(v_finish),'[^a-z0-9]','','g') then 'Finish does not match'
        when b.piece_length_m is null then 'Individual stock length is not captured'
        when b.piece_length_m<v_length then 'Stock pieces are shorter than the cut length'
        else null end exclusion
    from public.profile_stock_batches b where b.company_id=v_company and b.profile_id=v_profile.id
  ), projected as (
    select *,coalesce(exclusion,case when (balance#>>'{available,weight_kg}')::numeric<=0 or (balance#>>'{available,pieces}')::numeric<=0 then 'No unreserved stock remains'
      when (balance#>>'{shortfall,weight_kg}')::numeric>0 or (balance#>>'{shortfall,pieces}')::numeric>0 then 'Reservations exceed recorded stock' end) reason from candidates
  )
  select coalesce(jsonb_agg(to_jsonb(s)),'[]') into v_stock from (
    select id,bundle_number,location,finish,piece_length_m,updated_at,reason,reason is null as eligible,
      balance->'available' as available,balance->'open_reserved' as reserved,md5(id::text||balance::text||coalesce(updated_at::text,'')) as fingerprint
    from projected order by (reason is null) desc,id offset((v_page-1)*10) limit 10)s;
  select coalesce(jsonb_agg(to_jsonb(d)),'[]') into v_dies from (
    select id,die_number,rack_location,die_status,
      case when die_status not in ('active','approved') then 'Die is not released for production'
        when ownership_type='customer_owned' and (customer_id is null or v_customer is null or customer_id is distinct from v_customer) then 'Die ownership does not match the selected customer'
        when ownership_type='archived' then 'Die ownership is archived' else null end as reason
    from public.dies where company_id=v_company and profile_id=v_profile.id
    order by (die_status in ('active','approved')) desc,die_number,id offset((v_page-1)*10) limit 10)d;
  return jsonb_build_object('profile_id',v_profile.id,'page',v_page,'stock',v_stock,'dies',v_dies,'calculated_at',now(),
    'basis','Recorded profile, finish, cut length, quality release and open reservations. Suggestions do not reserve stock. Recheck alloy/temper provenance and availability in the committing workflow.');
end;
$$;
revoke all on function public.material_suggestion_command(jsonb) from public,anon;
grant execute on function public.material_suggestion_command(jsonb) to authenticated;
commit;
